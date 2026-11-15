import { test, expect } from "vitest";
import { readyPaper } from "../fixtures/ready-paper";
import {
  startSession,
  getSession,
  saveItem,
  submitAttempt,
  getAttempt,
} from "../../src/features/practice/service";
test("player hides answers, saves drafts and gives immediate MCQ feedback without duplicating attempts", async () => {
  const { db, paper } = await readyPaper();
  const session = startSession(db, paper.id, false);
  const before = JSON.stringify(getSession(db, session.id));
  expect(before).not.toContain("correctOptionIds");
  expect(before).not.toContain("unsigned maximum");
  saveItem(db, session.id, "q1", {
    expectedDraftVersion: 0,
    draft: { kind: "selection", optionIds: ["B"] },
  });
  expect(() =>
    saveItem(db, session.id, "q1", {
      expectedDraftVersion: 0,
      draft: { kind: "selection", optionIds: ["A"] },
    }),
  ).toThrow();
  const first = submitAttempt(db, session.id, {
    questionId: "q1",
    response: { kind: "selection", optionIds: ["B"] },
    requestId: "same",
  });
  expect(first.feedback?.verdict).toBe("incorrect");
  expect(JSON.stringify(first.feedback)).toContain("unsigned maximum");
  expect(
    submitAttempt(db, session.id, {
      questionId: "q1",
      response: { kind: "selection", optionIds: ["B"] },
      requestId: "same",
    }).id,
  ).toBe(first.id);
  expect(getSession(db, session.id).progress.submitted).toBe(1);
  expect(getAttempt(db, first.id).response).toEqual({
    kind: "selection",
    optionIds: ["B"],
  });
  db.close();
});
test("ordinary skips stay incomplete while explicit drawing skips are excluded", async () => {
  const { db, paper } = await readyPaper();
  const s = startSession(db, paper.id, false);
  saveItem(db, s.id, "q2", { expectedDraftVersion: 0, skipReason: "later" });
  saveItem(db, s.id, "q3", {
    expectedDraftVersion: 0,
    skipReason: "drawing",
    excluded: true,
  });
  expect(getSession(db, s.id).progress).toMatchObject({
    included: 2,
    excluded: 1,
    skipped: 1,
    state: "in_progress",
  });
  db.close();
});
