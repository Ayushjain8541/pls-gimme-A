import { parseArgs } from "node:util";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { openDb } from "../src/server/db/client";
import { listModules, createModule } from "../src/features/library/service";
import { saveDocument, createPaper } from "../src/features/documents/service";
import { AnthropicGateway } from "../src/server/ai/anthropic";
import { runNextJob } from "../src/worker/runner";
import { aiConfigured } from "../src/server/config";
import { getPaper } from "../src/features/documents/service";
const { values } = parseArgs({
  options: {
    question: { type: "string" },
    solution: { type: "string" },
    origin: { type: "string", default: "official" },
    module: { type: "string", default: "CS2100" },
  },
});
if (
  !values.question ||
  !values.solution ||
  !["official", "external_ai"].includes(values.origin)
)
  throw new Error(
    "Provide --question, --solution, --origin official|external_ai and --module.",
  );
if (!aiConfigured())
  throw new Error(
    "Set ANTHROPIC_API_KEY in .env.local before running live verification.",
  );
const db = openDb();
try {
  const code = values.module.replace(/\s+/g, "").toUpperCase();
  const mod =
    listModules(db).find((m) => m.code === code) ||
    createModule(db, { code, title: code });
  const docs = [];
  for (const [role, file] of [
    ["question", values.question],
    ["solution", values.solution],
  ] as const) {
    const bytes = await readFile(file);
    docs.push(
      await saveDocument(db, mod.id, {
        name: path.basename(file),
        mime: "application/pdf",
        role,
        stream: new Blob([bytes]).stream(),
      }),
    );
  }
  const p = createPaper(db, mod.id, {
    title: path.basename(values.question, ".pdf"),
    questionDocumentId: docs[0].id,
    solutionDocumentId: docs[1].id,
    solutionOrigin: values.origin as "official" | "external_ai",
  });
  const ai = new AnthropicGateway(),
    until = Date.now() + 10 * 60000;
  while (Date.now() < until) {
    const current = getPaper(db, p.id);
    if (["ready", "needs_review", "failed"].includes(current.state)) {
      console.log(
        `Preparation: ${current.state}\nModule: http://127.0.0.1:3000/modules/${mod.id}\nInspect: http://127.0.0.1:3000/papers/${p.id}/${current.state === "ready" ? "practice" : "review"}`,
      );
      break;
    }
    if (!(await runNextJob(db, ai))) await pause(1000);
  }
} finally {
  db.close();
}
