import { test, expect } from "vitest";
import { z } from "zod";
import { readyPaper } from "../fixtures/ready-paper";
import { CachedIngestionGateway } from "../../src/server/ai/cache";
import type { AiGateway } from "../../src/server/ai/gateway";
test("successful conversion stages survive a later provider failure and model changes invalidate cache", async () => {
  const { db } = await readyPaper();
  let attempts = 0;
  const delegate: AiGateway = {
    async structured<T>(schema: z.ZodType<T>) {
      attempts++;
      if (attempts > 1) throw new Error("provider unavailable");
      return schema.parse({ questions: ["original Q1"] });
    },
  };
  const schema = z.object({ questions: z.array(z.string()) });
  const ai = new CachedIngestionGateway(db, delegate, "model-a");
  const first = await ai.structured(
    schema,
    "questions",
    "preserve source",
    [],
    "INGEST",
  );
  const cached = await ai.structured(
    schema,
    "questions",
    "preserve source",
    [],
    "INGEST",
  );
  expect(cached).toEqual(first);
  await expect(
    new CachedIngestionGateway(db, delegate, "model-b").structured(
      schema,
      "questions",
      "preserve source",
      [],
      "INGEST",
    ),
  ).rejects.toThrow("provider unavailable");
  db.close();
});
