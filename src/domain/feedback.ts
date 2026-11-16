import { z } from "zod";
import { BlocksSchema } from "./content";
import type { ReferenceAnswer } from "./questions";
export const AssessmentSchema = z.object({
  verdict: z.enum([
    "correct",
    "partly_correct",
    "incorrect",
    "unable_to_assess",
  ]),
  strengths: z.array(z.string()),
  issues: z.array(
    z.object({
      criterionId: z.string().nullable(),
      evidence: z.string(),
      explanation: z.string(),
    }),
  ),
  worked: BlocksSchema.min(1),
  score: z.object({ earned: z.number(), possible: z.number() }).nullable(),
});
export type Assessment = z.infer<typeof AssessmentSchema>;
export type Feedback = Assessment & {
  provisional: boolean;
  assessmentMode?: "self_review";
  explanationNeedsReview?: boolean;
  reference: ReferenceAnswer;
};
