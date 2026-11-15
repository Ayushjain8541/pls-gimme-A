import { test, expect } from "vitest";
import { writeFileSync } from "node:fs";
import path from "node:path";
import type { z } from "zod";
import type { AiInput } from "../../src/server/ai/gateway";
import { readyPaper } from "../fixtures/ready-paper";
import { FixtureAi } from "../fixtures/ai";
import { fixtureRevision } from "../fixtures/paper";
import { storageDir } from "../../src/features/documents/service";
import { prepareExplanations } from "../../src/features/ingestion/pipeline";
import {
  saveRevision,
  publishRevision,
} from "../../src/features/review/repository";
import {
  startSession,
  submitAttempt,
  getAttempt,
} from "../../src/features/practice/service";
import { runNextJob } from "../../src/worker/runner";
import { askFollowup, getMessages } from "../../src/features/followup/service";
import type { AiGateway } from "../../src/server/ai/gateway";
test("figure evidence reaches explanation, written assessment and follow-up model calls", async () => {
  const { db, paper } = await readyPaper();
  const image = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/nGsAAAAASUVORK5CYII=",
    "base64",
  );
  writeFileSync(path.join(storageDir(db), "circuit.png"), image);
  db.prepare("INSERT INTO assets VALUES(?,?,?,?,?)").run(
    "circuit",
    paper.questionDocumentId,
    "question",
    1,
    "circuit.png",
  );
  const content = fixtureRevision();
  content.questions[1].context.push({
    kind: "asset",
    assetId: "circuit",
    alt: "Circuit needed for reasoning",
  });
  const seen: string[] = [];
  const fake: AiGateway = new FixtureAi();
  const gateway: AiGateway = {
    async structured<T>(
      schema: z.ZodType<T>,
      name: string,
      instructions: string,
      input: AiInput,
      task: "INGEST" | "FEEDBACK" | "CHAT",
    ) {
      if (
        [
          "prepared_explanations",
          "written_assessment",
          "question_followup",
        ].includes(name)
      ) {
        expect(JSON.stringify(input)).toContain('"type":"input_image"');
        expect(JSON.stringify(input)).toContain(image.toString("base64"));
        seen.push(name);
      }
      return fake.structured(schema, name, instructions, input, task);
    },
  };
  const explained = await prepareExplanations(db, content, gateway);
  const revision = saveRevision(db, paper.id, explained);
  publishRevision(db, paper.id, revision.id, revision.version);
  db.prepare("DELETE FROM jobs").run();
  const session = startSession(db, paper.id, true);
  const attempt = submitAttempt(db, session.id, {
    questionId: "q2",
    response: { kind: "written", text: "Zero occupies a representation." },
    requestId: "visual",
  });
  await runNextJob(db, gateway);
  expect(getAttempt(db, attempt.id).status).toBe("succeeded");
  askFollowup(db, attempt.id, {
    text: "Explain the circuit",
    requestId: "visual-chat",
  });
  await runNextJob(db, gateway);
  expect(getMessages(db, attempt.id).map((m) => m.role)).toEqual([
    "user",
    "assistant",
  ]);
  expect(seen).toEqual([
    "prepared_explanations",
    "written_assessment",
    "question_followup",
  ]);
  db.close();
});
