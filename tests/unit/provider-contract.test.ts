import { test, expect } from "vitest";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import {
  QuestionsOutput,
  SolutionsOutput,
  ExplanationsOutput,
} from "../../src/features/ingestion/pipeline";
import { AssessmentSchema } from "../../src/domain/feedback";
test("ingestion and evaluation schemas can be sent as Claude structured outputs", () => {
  for (const schema of [
    QuestionsOutput,
    SolutionsOutput,
    AssessmentSchema,
    ExplanationsOutput,
  ] as const) {
    expect(() => zodOutputFormat(schema)).not.toThrow();
  }
});
