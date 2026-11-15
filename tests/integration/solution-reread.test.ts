import { test, expect } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import type { z } from "zod";
import type { AiGateway, AiInput, AiTask } from "../../src/server/ai/gateway";
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

test.each([false, true])(
  "conflicting overlap is reread from originals or stays blocked (unreadable=%s)",
  async (unreadable) => {
    const dir = mkdtempSync(`${tmpdir()}/reread-`),
      db = openDb(dir + "/db");
    const mod = createModule(db, { code: "TEST", title: "Reread" }),
      docs: { id: string }[] = [];
    for (const role of ["question", "solution"] as const) {
      const file = dir + "/" + role + ".pdf";
      execFileSync(".venv/bin/python", [
        "-c",
        "import pymupdf,sys;d=pymupdf.open();[(lambda p:p.insert_text((72,72),'Original source '+str(i)))(d.new_page()) for i in range(21)];d.save(sys.argv[1])",
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
      title: "Reread",
      questionDocumentId: docs[0].id,
      solutionDocumentId: docs[1].id,
      solutionOrigin: "official",
    });
    const fallback: AiGateway = new FixtureAi();
    let questionCalls = 0,
      solutionCalls = 0,
      rereadCalls = 0;
    const entry = (text: string, pages: number[]) => ({
      number: "1",
      content: [{ kind: "markdown", text }],
      source: pages.map((page) => ({
        documentId: docs[1].id,
        page,
        bbox: null,
      })),
      correctOptionIds: ["A"],
      rubric: null,
    });
    const gateway: AiGateway = {
      async structured<T>(
        schema: z.ZodType<T>,
        name: string,
        instructions: string,
        input: AiInput,
        task: AiTask,
      ) {
        if (name === "paper_questions") {
          questionCalls++;
          const { id, revisionId, order, ...q } =
            fixtureRevision().questions[0];
          void id;
          void revisionId;
          void order;
          return schema.parse({
            questions:
              questionCalls === 1
                ? [
                    {
                      ...q,
                      source: [{ documentId: docs[0].id, page: 4, bbox: null }],
                    },
                  ]
                : [],
            warnings: [],
          });
        }
        if (name === "paper_solutions") {
          solutionCalls++;
          return schema.parse({
            entries:
              solutionCalls === 1
                ? [entry("Correct original result.", [4])]
                : solutionCalls === 2
                  ? [
                      entry(
                        "Adjacent subpart working wrongly copied here.",
                        [4, 5],
                      ),
                    ]
                  : [],
            warnings: [],
          });
        }
        if (name === "reconcile_solutions") {
          rereadCalls++;
          const meta = JSON.parse(input[0].content as string);
          expect(meta.expectedQuestionNumbers).toEqual(["1"]);
          expect(
            meta.questions.map((q: { number: string }) => q.number),
          ).toEqual(["1"]);
          const pages = (
            input.find((m) => Array.isArray(m.content))!.content as {
              type: string;
              text?: string;
            }[]
          )
            .filter((p) => p.type === "input_text")
            .map((p) => JSON.parse(p.text!).page);
          expect(pages).toEqual([4, 5]);
          expect(JSON.stringify(input)).toContain("input_image");
          return schema.parse({
            entries: unreadable
              ? []
              : [entry("Correct original result.", [4, 5])],
            warnings: unreadable ? ["The original result is unreadable."] : [],
          });
        }
        return fallback.structured(schema, name, instructions, input, task);
      },
    };
    await runNextJob(db, gateway);
    expect(rereadCalls).toBe(1);
    const content = getLatestRevision(db, paper.id).content;
    if (unreadable) {
      expect(getPaper(db, paper.id).state).toBe("needs_review");
      expect(content.issues.join(" ")).toContain("unreadable");
    } else {
      expect(getPaper(db, paper.id).state).toBe("ready");
      expect(content.issues).toEqual([]);
      expect(content.answers[0].content).toEqual([
        { kind: "markdown", text: "Correct original result." },
      ]);
      expect(content.answers[0].source.map((s) => s.page)).toEqual([4, 5]);
    }
    db.close();
  },
);
