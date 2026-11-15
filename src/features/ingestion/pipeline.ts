import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { z } from "zod";
import type {
  ResponseInput,
  ResponseInputContent,
} from "openai/resources/responses/responses";
import type { AppDb } from "../../server/db/client";
import type { AiGateway } from "../../server/ai/gateway";
import {
  QuestionSchema,
  AnswerSchema,
  validateRevision,
  type ParsedRevision,
  type Question,
} from "../../domain/questions";
import { BlocksSchema } from "../../domain/content";
import {
  PARSE_QUESTIONS,
  PARSE_SOLUTIONS,
  EXPLAIN,
} from "../../server/ai/prompts";
import { getPaper, getDocument, storageDir } from "../documents/service";
import { extractPdf, type ExtractedPage } from "./pdf";
import { alignAnswers, type SolutionEntry } from "./align";
import {
  saveRevision,
  publishRevision,
  getRevision,
} from "../review/repository";
import { one, all } from "../../server/db/queries";
import { AppError } from "../../server/errors";
import path from "node:path";
export const QuestionsOutput = z.object({
  questions: z.array(
    QuestionSchema.omit({ id: true, revisionId: true, order: true }),
  ),
  warnings: z.array(z.string()),
});
export const SolutionsOutput = z.object({
  entries: z.array(
    AnswerSchema.omit({
      questionId: true,
      origin: true,
      rubricOrigin: true,
    }).extend({ number: z.string() }),
  ),
  warnings: z.array(z.string()),
});
export const ExplanationsOutput = z.object({
  explanations: z.array(
    z.object({
      questionId: z.string(),
      worked: BlocksSchema.min(1),
      options: z.array(
        z.object({ optionId: z.string(), content: BlocksSchema.min(1) }),
      ),
      status: z.enum(["ready", "needs_review"]),
    }),
  ),
});
function pageInput(documentId: string, pages: ExtractedPage[]): ResponseInput {
  const content: ResponseInputContent[] = [];
  for (const page of pages) {
    content.push({
      type: "input_text",
      text: JSON.stringify({
        documentId,
        page: page.page,
        pageAssetId: page.pageAssetId,
        text: page.text,
      }),
    });
    content.push({
      type: "input_image",
      image_url: `data:image/png;base64,${readFileSync(page.imagePath).toString("base64")}`,
      detail: "auto",
    });
  }
  return [{ role: "user", content }];
}
export async function prepareExplanations(
  content: ParsedRevision,
  ai: AiGateway,
) {
  const explanations: ParsedRevision["explanations"] = [];
  const supported = content.questions.filter((q) => q.kind !== "unsupported");
  for (let i = 0; i < supported.length; i += 4) {
    const qs = supported.slice(i, i + 4),
      ids = new Set(qs.map((q) => q.id));
    const output = await ai.structured(
      ExplanationsOutput,
      "prepared_explanations",
      EXPLAIN,
      [
        {
          role: "user",
          content: JSON.stringify({
            questions: qs,
            answers: content.answers.filter((a) => ids.has(a.questionId)),
          }),
        },
      ],
      "INGEST",
    );
    for (const e of output.explanations) {
      if (!ids.has(e.questionId))
        throw new AppError(
          "invalid_ai_ids",
          "Explanation referred to an unknown question.",
          500,
          true,
        );
      explanations.push({
        questionId: e.questionId,
        worked: e.worked,
        byOption: Object.fromEntries(
          e.options.map((o) => [o.optionId, o.content]),
        ),
        status: e.status,
      });
    }
  }
  return { ...content, explanations };
}
export function validateSources(
  db: AppDb,
  content: ParsedRevision,
  paperId: string,
) {
  const paper = getPaper(db, paperId);
  const issues: string[] = [];
  for (const q of content.questions) {
    for (const ref of q.source) {
      if (
        ref.documentId !== paper.questionDocumentId ||
        !one(
          db,
          "SELECT id FROM assets WHERE documentId=? AND page=?",
          ref.documentId,
          ref.page,
        )
      )
        issues.push(`Question ${q.number}: invalid source page`);
    }
    for (const block of [
      ...q.context,
      ...q.prompt,
      ...q.options.flatMap((o) => o.content),
    ])
      if (
        block.kind === "asset" &&
        !one(
          db,
          "SELECT id FROM assets WHERE id=? AND documentId=? AND role='question'",
          block.assetId,
          paper.questionDocumentId,
        )
      )
        issues.push(`Question ${q.number}: missing question image`);
  }
  for (const answer of content.answers) {
    for (const ref of answer.source)
      if (
        ref.documentId !== paper.solutionDocumentId ||
        !one(
          db,
          "SELECT id FROM assets WHERE documentId=? AND page=?",
          ref.documentId,
          ref.page,
        )
      )
        issues.push("Invalid solution source");
    for (const b of answer.content)
      if (
        b.kind === "asset" &&
        !one(
          db,
          "SELECT id FROM assets WHERE id=? AND documentId=? AND role='solution'",
          b.assetId,
          paper.solutionDocumentId,
        )
      )
        issues.push("Missing solution image");
  }
  return issues;
}
export async function ingestPaper(
  db: AppDb,
  paperId: string,
  ai: AiGateway,
  stage: (name: string) => void,
  commit: (write: () => void) => void,
) {
  const p = getPaper(db, paperId);
  if (!p.solutionDocumentId)
    throw new AppError(
      "needs_solutions",
      "Attach a solution file before preparation.",
    );
  stage("Reading PDF pages");
  const questionDoc = await extractPdf(db, p.questionDocumentId);
  stage("Converting questions");
  const questions: Question[] = [],
    warnings: string[] = [];
  for (let i = 0; i < questionDoc.pages.length; i += 4) {
    const pages = questionDoc.pages.slice(Math.max(0, i - 1), i + 4);
    const output = await ai.structured(
      QuestionsOutput,
      "paper_questions",
      PARSE_QUESTIONS,
      pageInput(questionDoc.documentId, pages),
      "INGEST",
    );
    warnings.push(...output.warnings);
    for (const q of output.questions) {
      const old = questions.find((x) => x.number === q.number);
      if (old) {
        if (JSON.stringify(old.prompt) !== JSON.stringify(q.prompt)) {
          old.prompt.push(...q.prompt);
          old.source.push(...q.source);
          for (const o of q.options)
            if (!old.options.some((x) => x.id === o.id)) old.options.push(o);
        }
        continue;
      }
      questions.push({
        ...q,
        id: stableQuestionId(p.id, q.number),
        revisionId: "pending",
        order: questions.length,
      });
    }
  }
  if (!questions.length)
    throw new AppError(
      "empty_conversion",
      "No questions could be extracted. Check the source PDF.",
    );
  stage("Matching reference solutions");
  const solution = getDocument(db, p.solutionDocumentId);
  const entries: SolutionEntry[] = [];
  if (solution.mime === "application/pdf") {
    const doc = await extractPdf(db, solution.id);
    for (let i = 0; i < doc.pages.length; i += 4) {
      const output = await ai.structured(
        SolutionsOutput,
        "paper_solutions",
        PARSE_SOLUTIONS,
        pageInput(doc.documentId, doc.pages.slice(Math.max(0, i - 1), i + 4)),
        "INGEST",
      );
      warnings.push(...output.warnings);
      for (const e of output.entries)
        if (!entries.some((a) => a.number === e.number)) entries.push(e);
    }
  } else {
    const text = readFileSync(
      path.join(storageDir(db), solution.storageKey),
      "utf8",
    );
    const output = await ai.structured(
      SolutionsOutput,
      "paper_solutions",
      PARSE_SOLUTIONS,
      [{ role: "user", content: text }],
      "INGEST",
    );
    entries.push(...output.entries.map((e) => ({ ...e, source: [] })));
    warnings.push(...output.warnings);
  }
  const aligned = alignAnswers(questions, entries, p.solutionOrigin!);
  let content: ParsedRevision = {
    questions,
    answers: aligned.answers,
    explanations: [],
    issues: [...warnings, ...aligned.issues],
  };
  content.issues.push(...validateSources(db, content, p.id));
  const valid = validateRevision(content);
  if (valid.ok) {
    stage("Preparing explanations");
    content = await prepareExplanations(content, ai);
  }
  const final = validateRevision(content, true);
  commit(() => {
    const revision = saveRevision(db, p.id, content);
    if (final.ok) publishRevision(db, p.id, revision.id, revision.version);
    else
      db.prepare("UPDATE papers SET state='needs_review' WHERE id=?").run(p.id);
  });
}
export function getLatestRevision(db: AppDb, paperId: string) {
  getPaper(db, paperId);
  const row = one<{ id: string }>(
    db,
    "SELECT id FROM revisions WHERE paperId=? ORDER BY rowid DESC LIMIT 1",
    paperId,
  );
  if (!row)
    throw new AppError(
      "no_revision",
      "Conversion has not produced questions yet.",
      409,
    );
  return getRevision(db, row.id);
}
export function assetManifest(db: AppDb, paperId: string) {
  const p = getPaper(db, paperId);
  return all<{ id: string; page: number; role: string; documentId: string }>(
    db,
    "SELECT id,page,role,documentId FROM assets WHERE documentId IN (?,?)",
    p.questionDocumentId,
    p.solutionDocumentId,
  );
}

function stableQuestionId(paperId: string, number: string) {
  const h = createHash("sha256").update(`${paperId}:${number}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
