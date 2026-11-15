import { test, expect } from "vitest";
import { fixtureRevision } from "../fixtures/paper";
import {
  mergeQuestionFragments,
  mergeSolutionFragments,
} from "../../src/features/ingestion/merge";
const source = (page: number) => ({ documentId: "question", page, bbox: null });
test("a repeated question preserves later context, figures, options and source pages even when its prompt matches", () => {
  const q = fixtureRevision().questions[0];
  q.source = [source(4)];
  const next = {
    ...q,
    parentNumbers: ["Section A"],
    context: [
      { kind: "asset" as const, assetId: "figure-page-5", alt: "Circuit" },
    ],
    source: [source(5)],
    options: [
      ...q.options,
      { id: "C", content: [{ kind: "markdown" as const, text: "64" }] },
    ],
  };
  const { question, issues } = mergeQuestionFragments(q, next);
  expect(question.context).toEqual([
    { kind: "asset", assetId: "figure-page-5", alt: "Circuit" },
  ]);
  expect(question.parentNumbers).toEqual(["Section A"]);
  expect(question.source.map((s) => s.page)).toEqual([4, 5]);
  expect(question.options.map((o) => o.id)).toEqual(["A", "B", "C"]);
  expect(issues).toEqual([]);
});
test("complete solution continuations replace repeated prefixes and retain all source pages", () => {
  const first = {
    number: "2(a)",
    content: [{ kind: "markdown" as const, text: "Step one." }],
    source: [source(4)],
    correctOptionIds: null,
    rubric: null,
  };
  const next = {
    ...first,
    content: [
      {
        kind: "markdown" as const,
        text: "Step one.\nStep two gives the final result.",
      },
    ],
    source: [source(4), source(5)],
  };
  const { entry, issues } = mergeSolutionFragments(first, next);
  expect(entry.content).toEqual([
    { kind: "markdown", text: "Step one.\nStep two gives the final result." },
  ]);
  expect(entry.source.map((s) => s.page)).toEqual([4, 5]);
  expect(issues).toEqual([]);
});
test("conflicting keys and incompatible overlapping question text are flagged instead of silently choosing a version", () => {
  const a = {
    number: "1",
    content: [{ kind: "markdown" as const, text: "A is correct" }],
    source: [source(4)],
    correctOptionIds: ["A"],
    rubric: null,
  };
  expect(
    mergeSolutionFragments(a, { ...a, correctOptionIds: ["B"] }).issues.length,
  ).toBeGreaterThan(0);
  const q = fixtureRevision().questions[0];
  q.source = [source(4)];
  expect(
    mergeQuestionFragments(q, {
      ...q,
      prompt: [
        { kind: "markdown", text: "A different incompatible statement." },
      ],
    }).issues.length,
  ).toBeGreaterThan(0);
});
