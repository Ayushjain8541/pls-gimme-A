import { test, expect } from "vitest";
import { computeProgress } from "../../src/domain/practice";
import { validateRevision } from "../../src/domain/questions";
import { gradeMcq } from "../../src/features/feedback/mcq";
import { fixtureRevision } from "../fixtures/paper";
test("skips stay incomplete and drawing exclusions do not count against progress", () => {
  expect(
    computeProgress([
      {
        questionId: "a",
        excluded: false,
        skipped: false,
        submitted: true,
        assessed: true,
      },
      {
        questionId: "b",
        excluded: false,
        skipped: true,
        submitted: false,
        assessed: false,
      },
      {
        questionId: "c",
        excluded: true,
        skipped: true,
        submitted: false,
        assessed: false,
      },
    ]),
  ).toEqual({
    submitted: 1,
    assessed: 1,
    included: 2,
    excluded: 1,
    skipped: 1,
    state: "in_progress",
  });
  expect(computeProgress([]).state).toBe("not_started");
});
test("duplicate numbering and invalid option keys cannot pass conversion", () => {
  const r = fixtureRevision();
  r.questions[1].number = "1";
  expect(validateRevision(r).ok).toBe(false);
  const other = fixtureRevision();
  other.answers[0].correctOptionIds = ["missing"];
  expect(validateRevision(other).ok).toBe(false);
});
test("wrong MCQ explains the selected distractor and external keys stay provisional", () => {
  const r = fixtureRevision();
  const answer = { ...r.answers[0], origin: "external_ai" as const };
  const feedback = gradeMcq(
    r.questions[0],
    { kind: "selection", optionIds: ["B"] },
    answer,
    r.explanations[0],
  );
  expect(feedback.verdict).toBe("incorrect");
  expect(feedback.provisional).toBe(true);
  expect(JSON.stringify(feedback.worked)).toContain("signed");
});
test("blank reference content cannot become a usable answer key", () => {
  const r = fixtureRevision();
  r.answers[0].content = [{ kind: "markdown", text: "   " }];
  expect(validateRevision(r).ok).toBe(false);
});
