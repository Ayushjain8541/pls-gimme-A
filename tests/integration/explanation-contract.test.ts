import { test, expect } from "vitest";
import type { z } from "zod";
import { readyPaper } from "../fixtures/ready-paper";
import { fixtureRevision } from "../fixtures/paper";
import { FixtureAi } from "../fixtures/ai";
import type { AiGateway, AiInput } from "../../src/server/ai/gateway";
import { prepareExplanations } from "../../src/features/ingestion/pipeline";

test("explanation output excludes context-only IDs, duplicates and omissions", async () => {
  const { db } = await readyPaper();
  const content = fixtureRevision();
  const fake: AiGateway = new FixtureAi();
  const gateway: AiGateway = {
    async structured<T>(
      schema: z.ZodType<T>,
      name: string,
      instructions: string,
      input: AiInput,
      task: "INGEST" | "FEEDBACK" | "CHAT",
    ) {
      const good = {
        questionId: "q1",
        worked: [{ kind: "markdown", text: "Worked explanation." }],
        options: [
          { optionId: "A", content: [{ kind: "markdown", text: "Correct." }] },
          {
            optionId: "B",
            content: [{ kind: "markdown", text: "Incorrect." }],
          },
        ],
        status: "ready",
      };
      const targets = JSON.parse(input[0].content as string).questions.length;
      if (targets === 1)
        expect(
          schema.safeParse({ explanations: [{ ...good, questionId: "q2" }] })
            .success,
        ).toBe(false);
      else {
        expect(
          schema.safeParse({
            explanations: [good, { ...good, questionId: "q3" }],
          }).success,
        ).toBe(false);
        expect(schema.safeParse({ explanations: [good, good] }).success).toBe(
          false,
        );
        expect(schema.safeParse({ explanations: [good] }).success).toBe(false);
      }
      expect(schema.safeParse({ explanations: [] }).success).toBe(false);
      return fake.structured(schema, name, instructions, input, task);
    },
  };
  const result = await prepareExplanations(db, content, gateway, undefined, [
    "q1",
  ]);
  expect(result.explanations.map((e) => e.questionId).sort()).toEqual([
    "q1",
    "q2",
  ]);
  const all = await prepareExplanations(db, content, gateway);
  expect(all.explanations.map((e) => e.questionId).sort()).toEqual([
    "q1",
    "q2",
  ]);
  db.close();
});
