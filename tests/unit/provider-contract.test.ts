import { test, expect } from "vitest";
import { zodTextFormat } from "openai/helpers/zod";
import {
  QuestionsOutput,
  SolutionsOutput,
  ExplanationsOutput,
} from "../../src/features/ingestion/pipeline";
import { AssessmentSchema } from "../../src/domain/feedback";
test("ingestion and evaluation schemas can be sent as strict OpenAI structured outputs", () => {
  for (const [name, schema] of [
    ["questions", QuestionsOutput],
    ["solutions", SolutionsOutput],
    ["assessment", AssessmentSchema],
    ["explanations", ExplanationsOutput],
  ] as const) {
    expect(() => zodTextFormat(schema, name)).not.toThrow();
  }
});
