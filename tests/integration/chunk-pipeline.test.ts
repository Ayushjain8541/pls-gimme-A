import { test, expect } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import type { z } from "zod";
import type { AiInput } from "../../src/server/ai/gateway";
import { openDb } from "../../src/server/db/client";
import { createModule } from "../../src/features/library/service";
import {
  saveDocument,
  createPaper,
  getPaper,
} from "../../src/features/documents/service";
import { getLatestRevision } from "../../src/features/ingestion/pipeline";
import { runNextJob } from "../../src/worker/runner";
import { fixtureRevision } from "../fixtures/paper";
import { FixtureAi } from "../fixtures/ai";
import type { AiGateway } from "../../src/server/ai/gateway";
test("large-paper conversion retains page-five question figures and completed reference steps", async () => {
  const dir = mkdtempSync(`${tmpdir()}/chunk-paper-`),
    db = openDb(dir + "/db"),
    mod = createModule(db, { code: "CS2100", title: "Chunk test" });
  const docs = [];
  for (const role of ["question", "solution"] as const) {
    const file = dir + `/${role}.pdf`;
    execFileSync(".venv/bin/python", [
      "-c",
      "import pymupdf,sys;d=pymupdf.open();[(lambda p:p.insert_text((72,72),'Source page '+str(i)))(d.new_page()) for i in range(21)];d.save(sys.argv[1])",
      file,
    ]);
    docs.push(
      await saveDocument(db, mod.id, {
        name: role + ".pdf",
        role,
        mime: "application/pdf",
        stream: new Blob([readFileSync(file)]).stream(),
      }),
    );
  }
  const paper = createPaper(db, mod.id, {
    title: "Large paper",
    questionDocumentId: docs[0].id,
    solutionDocumentId: docs[1].id,
    solutionOrigin: "official",
  });
  let questionRound = 0,
    solutionRound = 0;
  const fallback: AiGateway = new FixtureAi();
  const gateway: AiGateway = {
    async structured<T>(
      schema: z.ZodType<T>,
      name: string,
      instructions: string,
      input: AiInput,
      task: "INGEST" | "FEEDBACK" | "CHAT",
    ) {
      if (name === "paper_questions" || name === "paper_solutions") {
        const message = JSON.parse(
          JSON.stringify(input.find((item) => Array.isArray(item.content))),
        ) as {
          content: { type: string; text?: string }[];
        };
        const pages = message.content
          .filter((c) => c.type === "input_text")
          .map(
            (c) =>
              JSON.parse(c.text!) as {
                documentId: string;
                page: number;
                pageAssetId: string;
              },
          );
        const docId = pages[0].documentId;
        if (name === "paper_questions") {
          questionRound++;
          const original = fixtureRevision().questions[0];
          const { id, revisionId, order, ...q } = original;
          void id;
          void revisionId;
          void order;
          if (questionRound > 2)
            return schema.parse({ questions: [], warnings: [] });
          const later = questionRound === 2;
          return schema.parse({
            questions: [
              {
                ...q,
                context: later
                  ? [
                      {
                        kind: "asset",
                        assetId: pages.find((p) => p.page === 5)!.pageAssetId,
                        alt: "Required later-page figure",
                      },
                    ]
                  : [],
                parentNumbers: later ? ["Section A"] : [],
                source: [
                  { documentId: docId, page: later ? 5 : 4, bbox: null },
                ],
              },
            ],
            warnings: [],
          });
        }
        solutionRound++;
        return schema.parse({
          entries: [
            {
              number: "1",
              content: [
                {
                  kind: "markdown",
                  text:
                    solutionRound === 1
                      ? "Step one."
                      : "Step one.\nComplete final result.",
                },
              ],
              source: [
                {
                  documentId: docId,
                  page: solutionRound === 1 ? 4 : 5,
                  bbox: null,
                },
              ],
              correctOptionIds: ["A"],
              rubric: null,
            },
          ],
          warnings: [],
        });
      }
      return fallback.structured(schema, name, instructions, input, task);
    },
  };
  await runNextJob(db, gateway);
  expect(getPaper(db, paper.id).state).toBe("ready");
  const converted = getLatestRevision(db, paper.id).content;
  expect(converted.questions[0].source.map((s) => s.page)).toEqual([4, 5]);
  expect(converted.questions[0].context[0]).toMatchObject({
    kind: "asset",
    alt: "Required later-page figure",
  });
  expect(converted.questions[0].parentNumbers).toEqual(["Section A"]);
  expect(converted.answers[0].content).toEqual([
    { kind: "markdown", text: "Step one.\nComplete final result." },
  ]);
  expect(converted.answers[0].source.map((s) => s.page)).toEqual([4, 5]);
  expect(converted.issues).toEqual([]);
  db.close();
});
