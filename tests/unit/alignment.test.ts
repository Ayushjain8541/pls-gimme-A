import { test, expect } from "vitest";
import { alignAnswers } from "../../src/features/ingestion/align";
import { fixtureRevision } from "../fixtures/paper";
test("unmatched numbering is flagged instead of borrowing another answer", () => {
  const r = fixtureRevision();
  const result = alignAnswers(
    r.questions,
    [
      {
        number: "2(b)",
        content: r.answers[1].content,
        correctOptionIds: null,
        source: [],
        rubric: null,
      },
    ],
    "official",
  );
  expect(result.issues.join(" ")).toContain("2(a)");
  expect(result.answers).toHaveLength(0);
});

test("answer-key labels such as Q1 and spaced subparts match their original question numbers", () => {
  const r = fixtureRevision();
  const result = alignAnswers(
    r.questions,
    [
      {
        number: "Q1",
        content: r.answers[0].content,
        correctOptionIds: ["A"],
        source: [],
        rubric: null,
      },
      {
        number: "Question 2 (a)",
        content: r.answers[1].content,
        correctOptionIds: null,
        source: [],
        rubric: null,
      },
    ],
    "official",
  );
  expect(result.answers.map((a) => a.questionId)).toEqual(["q1", "q2"]);
  expect(result.issues).toEqual([]);
});

test("solution conversion is constrained to the exact question/subpart identifiers", async () => {
  const { solutionOutputFor } =
    await import("../../src/features/ingestion/pipeline");
  const questions = fixtureRevision().questions;
  const schema = solutionOutputFor(questions);
  expect(
    schema.safeParse({
      entries: [
        {
          number: "2",
          content: [
            { kind: "markdown", text: "Grouped answer to multiple subparts" },
          ],
          source: [],
          correctOptionIds: null,
          rubric: null,
        },
      ],
      warnings: [],
    }).success,
  ).toBe(false);
  expect(
    schema.safeParse({
      entries: [
        {
          number: "2(a)",
          content: [
            { kind: "markdown", text: "The individual subpart answer" },
          ],
          source: [],
          correctOptionIds: null,
          rubric: null,
        },
      ],
      warnings: [],
    }).success,
  ).toBe(true);
});
