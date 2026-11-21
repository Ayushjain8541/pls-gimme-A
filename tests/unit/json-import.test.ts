import { test, expect } from "vitest";
import { portablePaper } from "../fixtures/portable-paper";
import {
  validatePaperJson,
  buildRepairPrompt,
  conversionPrompt,
  formatExample,
} from "../../src/features/json-import/contract";

test("portable papers retain exact leaf numbers and explicit answer provenance", () => {
  const result = validatePaperJson(JSON.stringify(portablePaper()));
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.paper.questions.map((q) => q.number)).toEqual(["1", "19(a)"]);
    expect(result.paper.questions[1].answer?.origin).toBe("external_ai");
  }
  expect(validatePaperJson(JSON.stringify(formatExample)).ok).toBe(true);
});
test("syntax errors return a copyable repair request with a location and full output contract", () => {
  const r = validatePaperJson('{"questions":');
  expect(r.ok).toBe(false);
  if (r.ok) return;
  expect(r.issues[0].path).toBe("$");
  const prompt = buildRepairPrompt(r.issues);
  expect(prompt).toContain("formatVersion");
  expect(prompt).toContain("correctOptionIds");
  expect(prompt).toContain(r.issues[0].message);
  expect(conversionPrompt).toContain("19(a)");
  expect(conversionPrompt).toContain("external_ai");
});
test("conversion and repair preserve original diagram images by default", () => {
  for (const prompt of [conversionPrompt, buildRepairPrompt([])]) {
    expect(prompt).toContain("DEFAULT MODE: PDF-BACKED");
    expect(prompt).toContain("Do NOT replace an original diagram with a prose description");
    expect(prompt).toContain('"kind":"page","document":"question"');
    expect(prompt).toContain("Question PDF (optional)");
    expect(prompt).not.toContain("DEFAULT MODE: SELF-CONTAINED JSON ONLY");
    expect(prompt).not.toContain("provide a faithful text representation only if");
    expect(prompt).not.toContain("Preserve PDF-backed blocks only when I explicitly ask");
  }
});
test.each([
  "number",
  "key",
  "optionExplanation",
  "blankAnswer",
  "unknownField",
  "answerPageInQuestion",
  "duplicateOptions",
])("invalid %s is rejected with field paths", (issue) => {
  const p = portablePaper();
  if (issue === "number") p.questions[1].number = "Q1";
  if (issue === "key") p.questions[0].answer.correctOptionIds = ["Z"];
  if (issue === "optionExplanation") p.questions[0].options[1].explanation = [];
  if (issue === "blankAnswer") p.questions[0].answer.content[0].text = "  ";
  if (issue === "unknownField")
    Object.assign(p, { secretAssetId: "not portable" });
  if (issue === "answerPageInQuestion")
    Object.assign(p.questions[0], {
      context: [
        { kind: "page", document: "solution", page: 1, alt: "Do not leak" },
      ],
    });
  if (issue === "duplicateOptions") p.questions[0].options[1].id = "A";
  const r = validatePaperJson(JSON.stringify(p));
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.issues.some((i) => i.path.startsWith("$"))).toBe(true);
});
test("drawing exclusions need no answer while supported questions need prepared explanations", () => {
  const p = portablePaper();
  Object.assign(p.questions[1], {
    kind: "unsupported",
    answer: undefined,
    explanation: [],
  });
  expect(validatePaperJson(JSON.stringify(p)).ok).toBe(true);
  p.questions[0].explanation = [];
  expect(validatePaperJson(JSON.stringify(p)).ok).toBe(false);
});
