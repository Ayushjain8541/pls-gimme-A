import type { Question } from "../../domain/questions";
import { canonicalQuestionNumber } from "./align";
/** Resolve original sibling/earlier-question context without adding any answer keys. */
export function questionDependencies(
  all: Question[],
  targets: Question[],
): Question[] {
  const targetIds = new Set(targets.map((q) => q.id));
  const base = (q: Question) =>
    canonicalQuestionNumber(q.number).match(/^\d+/)?.[0];
  const needed = new Set(targets.map(base).filter((n): n is string => !!n));
  const visited = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const q of all) {
      if (!needed.has(base(q) || "") || visited.has(q.id)) continue;
      visited.add(q.id);
      for (const block of [...q.context, ...q.prompt])
        if (block.kind === "markdown") {
          for (const ref of block.text.matchAll(
            /\b(?:Q(?:uestion)?\.?\s*)(\d+)/gi,
          )) {
            if (!needed.has(ref[1])) {
              needed.add(ref[1]);
              changed = true;
            }
          }
        }
    }
  }
  return all.filter((q) => !targetIds.has(q.id) && needed.has(base(q) || ""));
}
