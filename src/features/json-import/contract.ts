import { z } from "zod";
import { canonicalQuestionNumber } from "../ingestion/align";
export const MAX_JSON_BYTES = 4 * 1024 * 1024;
const text = z.string().trim().min(1).max(100000);
export const PortableBlockSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("markdown"), text }),
  z.strictObject({
    kind: z.literal("page"),
    document: z.enum(["question", "solution"]),
    page: z.number().int().min(1).max(100),
    alt: z.string().max(500),
  }),
]);
const blocks = z.array(PortableBlockSchema).max(100);
const pages = z.array(z.number().int().min(1).max(100)).max(100).default([]);
export const PortablePaperSchema = z.strictObject({
  formatVersion: z.literal(1),
  title: z.string().trim().min(1).max(180),
  questions: z
    .array(
      z.strictObject({
        number: z.string().trim().min(1).max(60),
        kind: z.enum([
          "single_select",
          "multi_select",
          "written",
          "unsupported",
        ]),
        marks: z.number().nonnegative().nullable().default(null),
        context: blocks.default([]),
        prompt: blocks.min(1),
        options: z
          .array(
            z.strictObject({
              id: z.string().trim().min(1).max(20),
              content: blocks.min(1),
              explanation: blocks.min(1),
            }),
          )
          .max(20)
          .default([]),
        answer: z
          .strictObject({
            origin: z.enum(["official", "external_ai"]),
            content: blocks.min(1),
            correctOptionIds: z
              .array(z.string().min(1).max(20))
              .max(20)
              .nullable()
              .default(null),
            rubric: z
              .array(
                z.strictObject({
                  id: z.string().min(1).max(60),
                  text,
                  maxMarks: z.number().positive(),
                }),
              )
              .max(100)
              .nullable()
              .default(null),
          })
          .optional(),
        explanation: blocks.default([]),
        questionPages: pages,
        answerPages: pages,
      }),
    )
    .min(1)
    .max(500),
});
export type PortablePaper = z.infer<typeof PortablePaperSchema>;
export type PortableBlock = z.infer<typeof PortableBlockSchema>;
export type ImportIssue = { path: string; message: string };
export type JsonValidation =
  { ok: true; paper: PortablePaper } | { ok: false; issues: ImportIssue[] };
export function validatePaperJson(raw: string): JsonValidation {
  if (new TextEncoder().encode(raw).length > MAX_JSON_BYTES)
    return {
      ok: false,
      issues: [
        {
          path: "$",
          message:
            "JSON limit is 4 MiB. Split multiple papers into separate files.",
        },
      ],
    };
  let value: unknown;
  try {
    value = JSON.parse(raw.replace(/^\uFEFF/, ""));
  } catch (e) {
    return {
      ok: false,
      issues: [
        {
          path: "$",
          message: `Invalid JSON: ${e instanceof Error ? e.message : "syntax error"}. Return one complete JSON object without Markdown fences or surrounding prose.`,
        },
      ],
    };
  }
  const parsed = PortablePaperSchema.safeParse(value);
  if (!parsed.success)
    return {
      ok: false,
      issues: parsed.error.issues
        .slice(0, 100)
        .map((i) => ({
          path:
            "$" +
            i.path
              .map((p) => (typeof p === "number" ? `[${p}]` : `.${String(p)}`))
              .join(""),
          message: i.message,
        })),
    };
  const paper = parsed.data,
    issues: ImportIssue[] = [],
    numbers = new Set<string>();
  paper.questions.forEach((q, i) => {
    const path = `$.questions[${i}]`,
      add = (field: string, message: string) =>
        issues.push({ path: path + field, message });
    q.number = canonicalQuestionNumber(q.number);
    if (numbers.has(q.number))
      add(
        ".number",
        `Duplicate question number ${q.number}. Keep one item per exact leaf subpart.`,
      );
    numbers.add(q.number);
    const visible = [
      ...q.context,
      ...q.prompt,
      ...q.options.flatMap((o) => o.content),
    ];
    if (visible.some((b) => b.kind === "page" && b.document === "solution"))
      add(
        ".prompt",
        "Question-facing content cannot contain answer-key PDF pages. Move them to answer.content or explanation.",
      );
    if (q.kind === "unsupported") return;
    if (!q.answer)
      add(
        ".answer",
        "Supply a reference answer, or mark the item unsupported if a reliable reference cannot be provided.",
      );
    if (!q.explanation.length)
      add(
        ".explanation",
        "Supply a full worked explanation for this supported question.",
      );
    if (q.kind.includes("select")) {
      const ids = q.options.map((o) => o.id),
        keys = q.answer?.correctOptionIds;
      if (ids.length < 2 || new Set(ids).size !== ids.length)
        add(".options", "MCQs need at least two options with distinct IDs.");
      if (
        !keys?.length ||
        new Set(keys).size !== keys.length ||
        keys.some((k) => !ids.includes(k)) ||
        (q.kind === "single_select" && keys.length !== 1)
      )
        add(
          ".answer.correctOptionIds",
          "Use exact existing option IDs; a single_select question requires exactly one correct ID.",
        );
    } else if (q.options.length || q.answer?.correctOptionIds?.length)
      add(
        ".options",
        "Written questions use empty options and null correctOptionIds.",
      );
    const rubric = q.answer?.rubric;
    if (rubric) {
      if (new Set(rubric.map((c) => c.id)).size !== rubric.length)
        add(".answer.rubric", "Rubric criterion IDs must be unique.");
      if (
        q.marks !== null &&
        Math.abs(rubric.reduce((s, c) => s + c.maxMarks, 0) - q.marks) > 0.001
      )
        add(
          ".answer.rubric",
          "Supplied rubric marks must total the question marks.",
        );
    }
  });
  return issues.length
    ? { ok: false, issues: issues.slice(0, 100) }
    : { ok: true, paper };
}
export const formatExample: PortablePaper = PortablePaperSchema.parse({
  formatVersion: 1,
  title: "CS2100 — practice paper",
  questions: [
    {
      number: "1",
      kind: "single_select",
      marks: 1,
      context: [],
      prompt: [
        { kind: "markdown", text: "What is the largest signed 8-bit integer?" },
      ],
      options: [
        {
          id: "A",
          content: [{ kind: "markdown", text: "127" }],
          explanation: [
            {
              kind: "markdown",
              text: "Correct: the signed range ends at 127.",
            },
          ],
        },
        {
          id: "B",
          content: [{ kind: "markdown", text: "255" }],
          explanation: [
            {
              kind: "markdown",
              text: "255 is the maximum unsigned 8-bit value.",
            },
          ],
        },
      ],
      answer: {
        origin: "official",
        content: [{ kind: "markdown", text: "A: 127" }],
        correctOptionIds: ["A"],
      },
      explanation: [
        {
          kind: "markdown",
          text: "A signed 8-bit two’s complement integer ranges from $-2^7$ to $2^7-1$, so its maximum is 127.",
        },
      ],
    },
    {
      number: "19(a)",
      kind: "written",
      marks: null,
      context: [],
      prompt: [
        {
          kind: "markdown",
          text: "Explain why two’s complement has one extra negative value.",
        },
      ],
      options: [],
      answer: {
        origin: "official",
        content: [
          { kind: "markdown", text: "Zero uses one nonnegative encoding." },
        ],
        correctOptionIds: null,
      },
      explanation: [
        {
          kind: "markdown",
          text: "Half the bit patterns represent negative values. The other half include zero, leaving one fewer strictly positive value.",
        },
      ],
    },
  ],
});
export const portableJsonSchema = z.toJSONSchema(PortablePaperSchema);
const contractText = JSON.stringify(portableJsonSchema, null, 2);
export const conversionPrompt = `Convert my attached exam question paper and answer key into ONE complete downloadable UTF-8 .json file for Gimme A. Use formatVersion 1 and follow the JSON Schema below exactly. Return JSON only: no Markdown fences or commentary. One file represents one paper.

Preserve EVERY original question and exact answerable leaf subpart, such as 19(a), 19(b), 19(c), 2(a)(ii). Never combine them under a parent. Copy parent instructions/shared code into context wherever needed. Preserve original order, options/IDs, mathematical notation, tables and code. Do not replace original questions. Verify loop labels and diagram polarities against the PDF images rather than guessing from extracted text. Use Markdown and LaTeX inside markdown blocks; escape backslashes correctly for JSON.

Include reference answers AND full worked explanations. Every MCQ option needs its own explanation of why it is right or wrong; correctOptionIds must match actual option IDs. For written questions supply the answer and explanation; the app initially uses self-review. Preserve supplied rubrics only; do not invent marks or rubrics. If marks are absent use null. Label answers copied from my course key origin=official. If I have no key and explicitly ask you to generate solutions, use origin=external_ai for every generated answer and independently check your reasoning. Never label generated solutions official. If a reliable answer cannot be provided, use kind=unsupported and explain why in the prompt/context rather than inventing a key.

For diagrams, use {"kind":"page","document":"question","page":3,"alt":"Original circuit diagram"} blocks with the physical PDF page index (first PDF page=1), never printed page numbers, URLs, base64, file paths or application asset IDs. I must attach the same source PDFs when importing if these page blocks are used. Put question images only in question-facing context/prompt/options; solution pages belong only in answer/explanation/option explanation blocks. If I do not want to attach source PDFs, transcribe faithfully into Markdown where possible or mark image-dependent items unsupported. Drawing responses are kind=unsupported. Use neutral diagram descriptions, not inferred wiring. questionPages/answerPages are optional source citations and also require their corresponding PDFs when supplied. Do not include answer-key pages in question-facing content. Do not put correct answers in the question prompt.

Use distinct nonempty question numbers and option IDs. Supported kinds: single_select, multi_select, written. Unsupported items may omit answer and explanation. Preserve valid supplied reference material; clearly explain any unresolved ambiguity instead of silently guessing. Check the completed file against the schema and verify answer alignment before returning it. Structural validation cannot establish mathematical correctness.

JSON Schema:\n${contractText}\n\nSmall valid example (illustrates the format, not my paper):\n${JSON.stringify(formatExample, null, 2)}`;
export function buildRepairPrompt(issues: ImportIssue[]): string {
  return `Repair the Gimme A JSON file I attach using the validation errors below. Also use my original PDFs if needed. Return the ENTIRE corrected .json file, not a patch, with no Markdown fences or surrounding prose. Preserve valid question content, original leaf numbering, official reference answers and answer provenance. Do not drop questions or fabricate solutions just to pass validation. Fix field paths exactly. If an error asks for a source PDF, tell me to attach it in Gimme A or use a faithful text representation; never invent file IDs, URLs or images. Structural validation does not prove answer correctness.\n\nValidation errors:\n${issues.map((i) => `- ${i.path}: ${i.message}`).join("\n")}\n\nRequired JSON Schema:\n${contractText}`;
}
