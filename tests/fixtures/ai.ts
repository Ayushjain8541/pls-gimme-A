import type { z } from "zod";
import type { AiInput } from "../../src/server/ai/gateway";
import type { AiGateway } from "../../src/server/ai/gateway";
import { fixtureRevision } from "./paper";
export class FixtureAi implements AiGateway {
  async structured<T>(
    schema: z.ZodType<T>,
    name: string,
    _instructions: string,
    input: AiInput,
  ): Promise<T> {
    const r = fixtureRevision();
    if (name === "paper_questions") {
      const candidates = r.questions.map((q) => {
        const { id, revisionId, order, ...rest } = q;
        void id;
        void revisionId;
        void order;
        return rest;
      });
      return schema.parse({
        questions: candidates,
        notes: JSON.stringify(input).includes("NOTES_ONLY")
          ? [
              "Marks were not printed; marks are null.",
              "The diagram is preserved as a source image.",
            ]
          : [],
        warnings: JSON.stringify(input).includes("FLAG_REVIEW")
          ? ["Check question 2(a) against the supplied solution."]
          : [],
      });
    }
    if (name === "paper_solutions")
      return schema.parse({
        entries: r.answers.map((a) => {
          const { questionId, origin, rubricOrigin, ...rest } = a;
          void origin;
          void rubricOrigin;
          return {
            ...rest,
            number: r.questions.find((q) => q.id === questionId)!.number,
          };
        }),
        warnings: [],
      });
    const msg = input[0] as { content: string };
    const data = JSON.parse(msg.content);
    if (name === "prepared_explanations")
      return schema.parse({
        explanations: data.questions
          .filter((q: { kind: string }) => q.kind !== "unsupported")
          .map((q: { id: string; number: string }) => {
            const original = r.questions.find((x) => x.number === q.number)!;
            const e = r.explanations.find((e) => e.questionId === original.id)!;
            return {
              ...e,
              questionId: q.id,
              options: Object.entries(e.byOption).map(
                ([optionId, content]) => ({ optionId, content }),
              ),
            };
          }),
      });
    if (name === "written_assessment")
      return schema.parse({
        verdict: "partly_correct",
        strengths: ["Identifies zero"],
        issues: [
          {
            criterionId: "c1",
            evidence: "Zero",
            explanation: "Explain how this affects the two ranges.",
          },
        ],
        worked: [
          {
            kind: "markdown",
            text: "Zero occupies one nonnegative representation.",
          },
        ],
        score: { earned: 1, possible: 2 },
      });
    return schema.parse({
      reply:
        "255 is the unsigned maximum. Signed 8-bit values range from -128 to 127.",
    });
  }
}
