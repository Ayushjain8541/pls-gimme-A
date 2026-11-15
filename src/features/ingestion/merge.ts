import type { Block, SourceRef } from "../../domain/content";
import type { Question } from "../../domain/questions";
import type { SolutionEntry } from "./align";
function unique<T>(values: T[]): T[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = JSON.stringify(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
/** A later fragment may contain the full earlier text. Prefer that complete block. */
function blocks(first: Block[], next: Block[]) {
  const result = structuredClone(first);
  let ambiguous = false;
  for (const item of next) {
    if (result.some((b) => JSON.stringify(b) === JSON.stringify(item)))
      continue;
    if (item.kind === "markdown") {
      const covering = result.find(
        (b) => b.kind === "markdown" && b.text.includes(item.text),
      );
      if (covering) continue;
      const shorter = result.findIndex(
        (b) => b.kind === "markdown" && item.text.includes(b.text),
      );
      if (shorter >= 0) {
        result[shorter] = item;
        continue;
      }
      if (result.some((b) => b.kind === "markdown")) ambiguous = true;
    }
    result.push(item);
  }
  return { content: unique(result), ambiguous };
}
function overlap(a: SourceRef[], b: SourceRef[]) {
  return a.some((x) =>
    b.some((y) => x.documentId === y.documentId && x.page === y.page),
  );
}
export function mergeQuestionFragments(
  first: Question,
  next: Question,
  continuation = false,
) {
  const issues: string[] = [];
  const prompt = blocks(first.prompt, next.prompt);
  const context = blocks(first.context, next.context);
  if (!continuation && context.ambiguous && overlap(first.source, next.source))
    issues.push(
      `Question ${first.number}: conflicting shared context on overlapping pages. Check the original.`,
    );
  if (!continuation && prompt.ambiguous && overlap(first.source, next.source))
    issues.push(
      `Question ${first.number}: conflicting text on overlapping source pages. Check the original.`,
    );
  const options = structuredClone(first.options);
  for (const option of next.options) {
    const index = options.findIndex((o) => o.id === option.id);
    if (index < 0) options.push(option);
    else {
      const merged = blocks(options[index].content, option.content);
      if (
        JSON.stringify(options[index].content) !==
          JSON.stringify(option.content) &&
        merged.ambiguous
      )
        issues.push(
          `Question ${first.number}: conflicting option ${option.id}.`,
        );
      options[index].content = merged.content;
    }
  }
  if (first.kind !== next.kind)
    issues.push(
      `Question ${first.number}: conflicting answer types. Check the original.`,
    );
  if (first.marks !== null && next.marks !== null && first.marks !== next.marks)
    issues.push(`Question ${first.number}: conflicting marks.`);
  return {
    question: {
      ...first,
      prompt: prompt.content,
      context: context.content,
      parentNumbers: unique([...first.parentNumbers, ...next.parentNumbers]),
      source: unique([...first.source, ...next.source]),
      marks: first.marks ?? next.marks,
      requiresDrawing: first.requiresDrawing || next.requiresDrawing,
      options,
    },
    issues,
  };
}
export function mergeSolutionFragments(
  first: SolutionEntry,
  next: SolutionEntry,
  continuation = false,
) {
  const issues: string[] = [];
  const merged = blocks(first.content, next.content);
  if (!continuation && merged.ambiguous && overlap(first.source, next.source))
    issues.push(
      `Solution ${first.number}: differing steps on overlapping pages. Check the complete reference.`,
    );
  const a = first.correctOptionIds,
    b = next.correctOptionIds;
  if (a && b && (a.length !== b.length || a.some((id) => !b.includes(id))))
    issues.push(`Solution ${first.number}: conflicting correct options.`);
  const rubric = first.rubric ? structuredClone(first.rubric) : next.rubric;
  if (first.rubric && next.rubric && rubric) {
    for (const criterion of next.rubric) {
      const old = rubric.find((c) => c.id === criterion.id);
      if (!old) rubric.push(criterion);
      else if (JSON.stringify(old) !== JSON.stringify(criterion))
        issues.push(
          `Solution ${first.number}: conflicting rubric criterion ${criterion.id}.`,
        );
    }
  }
  return {
    entry: {
      ...first,
      content: merged.content,
      source: unique([...first.source, ...next.source]),
      correctOptionIds: a ?? b,
      rubric,
    },
    issues,
  };
}
