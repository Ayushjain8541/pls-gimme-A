import type { Question, ReferenceAnswer } from "../../domain/questions";
export type SolutionEntry = Omit<
  ReferenceAnswer,
  "questionId" | "origin" | "rubricOrigin"
> & { number: string };
export function alignAnswers(
  questions: Question[],
  entries: SolutionEntry[],
  origin: ReferenceAnswer["origin"],
) {
  const answers: ReferenceAnswer[] = [],
    issues: string[] = [];
  for (const q of questions) {
    if (q.kind === "unsupported") continue;
    const matched = entries.filter((e) => e.number.trim() === q.number.trim());
    if (matched.length !== 1) {
      issues.push(`Question ${q.number}: missing or ambiguous solution`);
      continue;
    }
    const a = matched[0];
    answers.push({
      questionId: q.id,
      origin,
      content: a.content,
      source: a.source,
      correctOptionIds: a.correctOptionIds,
      rubric: a.rubric,
      rubricOrigin: a.rubric ? "supplied" : null,
    });
  }
  return { answers, issues };
}
