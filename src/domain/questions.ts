import { z } from "zod";
import { BlocksSchema, SourceSchema } from "./content";
export const QuestionSchema = z.object({
  id: z.string(),
  revisionId: z.string(),
  number: z.string().min(1),
  order: z.number().int().nonnegative(),
  parentNumbers: z.array(z.string()),
  context: BlocksSchema,
  prompt: BlocksSchema.min(1),
  marks: z.number().nonnegative().nullable(),
  source: z.array(SourceSchema),
  requiresDrawing: z.boolean(),
  kind: z.enum(["single_select", "multi_select", "written", "unsupported"]),
  options: z.array(z.object({ id: z.string(), content: BlocksSchema.min(1) })),
});
export const AnswerSchema = z.object({
  questionId: z.string(),
  origin: z.enum(["official", "external_ai"]),
  content: BlocksSchema.min(1),
  source: z.array(SourceSchema),
  correctOptionIds: z.array(z.string()).nullable(),
  rubric: z
    .array(
      z.object({
        id: z.string(),
        text: z.string(),
        maxMarks: z.number().positive(),
      }),
    )
    .nullable(),
  rubricOrigin: z.enum(["supplied", "ai_generated"]).nullable(),
});
export const ExplanationSchema = z.object({
  questionId: z.string(),
  worked: BlocksSchema.min(1),
  byOption: z.record(z.string(), BlocksSchema),
  status: z.enum(["ready", "needs_review"]),
});
export const RevisionSchema = z.object({
  questions: z.array(QuestionSchema).min(1),
  answers: z.array(AnswerSchema),
  explanations: z.array(ExplanationSchema),
  issues: z.array(z.string()),
  notes: z.array(z.string()).optional(),
});
export type Question = z.infer<typeof QuestionSchema>;
export type ReferenceAnswer = z.infer<typeof AnswerSchema>;
export type PreparedExplanation = z.infer<typeof ExplanationSchema>;
export type ParsedRevision = z.infer<typeof RevisionSchema>;
export function validateRevision(input: unknown, requireExplanations = false) {
  const parsed = RevisionSchema.safeParse(input);
  if (!parsed.success)
    return {
      ok: false as const,
      issues: parsed.error.issues.map(
        (i) => `${i.path.join(".")}: ${i.message}`,
      ),
    };
  const r = parsed.data;
  const issues = [...r.issues];
  for (const field of ["id", "number", "order"] as const) {
    if (new Set(r.questions.map((q) => q[field])).size !== r.questions.length)
      issues.push(`Duplicate question ${field}`);
  }
  for (const q of r.questions) {
    if (q.kind === "unsupported") continue;
    const a = r.answers.filter((a) => a.questionId === q.id);
    if (a.length !== 1) {
      issues.push(`Question ${q.number}: missing or ambiguous solution`);
      continue;
    }
    if (q.kind.includes("select")) {
      const ids = q.options.map((o) => o.id);
      if (ids.length < 2 || new Set(ids).size !== ids.length)
        issues.push(`Question ${q.number}: invalid options`);
      const keys = a[0].correctOptionIds;
      if (
        !keys?.length ||
        keys.some((id) => !ids.includes(id)) ||
        new Set(keys).size !== keys.length ||
        (q.kind === "single_select" && keys.length !== 1)
      )
        issues.push(`Question ${q.number}: invalid answer options`);
    }
    if (
      a[0].rubric &&
      q.marks !== null &&
      Math.abs(a[0].rubric.reduce((s, c) => s + c.maxMarks, 0) - q.marks) >
        0.001
    )
      issues.push(`Question ${q.number}: rubric marks do not match`);
    if (requireExplanations) {
      const e = r.explanations.find((e) => e.questionId === q.id);
      if (
        !e ||
        (q.kind.includes("select") &&
          q.options.some((o) => !e.byOption[o.id]?.length))
      )
        issues.push(`Question ${q.number}: explanation not ready`);
    }
  }
  return issues.length
    ? { ok: false as const, issues }
    : { ok: true as const, revision: r, issues: [] };
}
