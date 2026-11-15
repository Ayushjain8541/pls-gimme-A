import { z } from "zod";
export const ResponseSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("selection"),
    optionIds: z.array(z.string()).min(1),
  }),
  z.object({
    kind: z.literal("written"),
    text: z.string().trim().min(1).max(30000),
  }),
]);
export type StudentResponse = z.infer<typeof ResponseSchema>;
export type ProgressItem = {
  questionId: string;
  excluded: boolean;
  skipped: boolean;
  submitted: boolean;
  assessed: boolean;
};
export function computeProgress(items: ProgressItem[]) {
  const eligible = items.filter((x) => !x.excluded);
  const submitted = eligible.filter((x) => x.submitted).length,
    assessed = eligible.filter((x) => x.assessed).length;
  return {
    submitted,
    assessed,
    included: eligible.length,
    excluded: items.length - eligible.length,
    skipped: eligible.filter((x) => x.skipped && !x.submitted).length,
    state: (eligible.length > 0 && assessed === eligible.length
      ? "completed"
      : submitted > 0 || items.some((x) => x.skipped)
        ? "in_progress"
        : "not_started") as "completed" | "in_progress" | "not_started",
  };
}
