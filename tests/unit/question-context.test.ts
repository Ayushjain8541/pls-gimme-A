import { test, expect } from "vitest";
import { fixtureRevision } from "../fixtures/paper";
import { questionDependencies } from "../../src/features/ingestion/context";
test("later questions receive original shared-question context referenced by number", () => {
  const r = fixtureRevision();
  const code = {
    ...r.questions[0],
    id: "code",
    number: "21(a)",
    context: [
      {
        kind: "markdown" as const,
        text: "Inst1 to Inst15: original MIPS listing",
      },
    ],
  };
  const target = {
    ...r.questions[1],
    id: "cache",
    number: "23(g)",
    context: [
      { kind: "markdown" as const, text: "Use the same program as Q21." },
    ],
  };
  const sibling = { ...r.questions[2], id: "cache-setup", number: "23(a)" };
  expect(
    questionDependencies([code, target, sibling], [target]).map((q) => q.id),
  ).toEqual(["code", "cache-setup"]);
});
