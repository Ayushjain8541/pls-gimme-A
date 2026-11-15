import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { AiInput, AiInputContent } from "../../server/ai/gateway";
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
import {
  alignAnswers,
  canonicalQuestionNumber,
  type SolutionEntry,
} from "./align";
import {
  saveRevision,
  publishRevision,
  getRevision,
} from "../review/repository";
import { one, all } from "../../server/db/queries";
import { AppError } from "../../server/errors";
import path from "node:path";
import { mergeQuestionFragments, mergeSolutionFragments } from "./merge";
import { visualInputs } from "../../server/ai/images";
import { documentWindows } from "./windows";
import { questionDependencies } from "./context";
const ContinuationSchema = z
  .enum(["complete", "from_previous", "to_next", "both"])
  .default("complete");
export const QuestionsOutput = z.object({
  questions: z.array(
    QuestionSchema.omit({ id: true, revisionId: true, order: true }).extend({
      continuation: ContinuationSchema,
    }),
  ),
  warnings: z.array(z.string()),
  notes: z.array(z.string()).default([]),
});
export const SolutionsOutput = z.object({
  entries: z.array(
    AnswerSchema.omit({
      questionId: true,
      origin: true,
      rubricOrigin: true,
    }).extend({ number: z.string(), continuation: ContinuationSchema }),
  ),
  warnings: z.array(z.string()),
  notes: z.array(z.string()).default([]),
});
export function solutionOutputFor(questions: Question[]) {
  const numbers = questions.map((q) => q.number);
  if (!numbers.length)
    throw new AppError(
      "empty_conversion",
      "No question identifiers are available.",
    );
  return SolutionsOutput.extend({
    entries: z.array(
      SolutionsOutput.shape.entries.element.extend({
        number: z.enum(numbers as [string, ...string[]]),
      }),
    ),
  });
}
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
function pageInput(
  documentId: string,
  pages: ExtractedPage[],
  scope: {
    completeDocument: boolean;
    totalPages: number;
    firstPrimaryPage: number;
    lastPrimaryPage: number;
    openQuestionNumbers?: string[];
  },
): AiInput {
  const content: AiInputContent[] = [];
  for (const page of pages) {
    content.push({
      type: "input_text",
      text: JSON.stringify({
        documentId,
        page: page.page,
        pageAssetId: page.pageAssetId,
        text: page.text,
        completeDocument: scope.completeDocument,
        documentPageCount: scope.totalPages,
        primaryPageRange: [scope.firstPrimaryPage, scope.lastPrimaryPage],
        openQuestionNumbers: scope.openQuestionNumbers || [],
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
function explanationOutputFor(questions: Question[]) {
  const ids = questions.map((q) => q.id) as [string, ...string[]];
  return ExplanationsOutput.extend({
    explanations: z
      .array(
        ExplanationsOutput.shape.explanations.element.extend({
          questionId: z
            .enum(ids)
            .describe(
              "Only target question IDs; relatedQuestions are context, not output targets.",
            ),
        }),
      )
      .length(ids.length),
  }).superRefine((value, ctx) => {
    if (
      new Set(value.explanations.map((e) => e.questionId)).size !== ids.length
    )
      ctx.addIssue({
        code: "custom",
        path: ["explanations"],
        message: "Return exactly one explanation per target question.",
      });
  });
}
export async function prepareExplanations(
  db: AppDb,
  content: ParsedRevision,
  ai: AiGateway,
  progress?: (done: number, total: number) => void,
  onlyQuestionIds?: string[],
) {
  const targets = onlyQuestionIds ? new Set(onlyQuestionIds) : null;
  const explanations: ParsedRevision["explanations"] = targets
    ? content.explanations.filter((e) => !targets.has(e.questionId))
    : [];
  const supported = content.questions.filter(
    (q) => q.kind !== "unsupported" && (!targets || targets.has(q.id)),
  );
  for (let i = 0; i < supported.length; i += 4) {
    progress?.(i, supported.length);
    const qs = supported.slice(i, i + 4),
      ids = new Set(qs.map((q) => q.id));
    const relatedQuestions = questionDependencies(content.questions, qs);
    const input = {
      questions: qs,
      relatedQuestions,
      answers: content.answers.filter((a) => ids.has(a.questionId)),
    };
    const output = await ai.structured(
      explanationOutputFor(qs),
      "prepared_explanations",
      EXPLAIN,
      [
        {
          role: "user",
          content: JSON.stringify(input),
        },
        ...visualInputs(db, input),
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
  progress?.(supported.length, supported.length);
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
    warnings: string[] = [],
    notes: string[] = [];
  const openQuestions = new Set<string>();
  for (const window of documentWindows(questionDoc.pages)) {
    const pages = window.pages;
    stage(
      window.completeDocument
        ? `Converting all ${window.totalPages} question pages`
        : `Converting question pages ${window.firstPrimaryPage}–${window.lastPrimaryPage}`,
    );
    const output = await ai.structured(
      QuestionsOutput,
      "paper_questions",
      PARSE_QUESTIONS,
      pageInput(questionDoc.documentId, pages, {
        ...window,
        openQuestionNumbers: [...openQuestions],
      }),
      "INGEST",
    );
    warnings.push(...output.warnings);
    notes.push(...output.notes);
    for (const rawQuestion of output.questions) {
      const q = {
        ...rawQuestion,
        number: canonicalQuestionNumber(rawQuestion.number),
      };
      // A complete repeated item from context pages belongs to its earlier window.
      if (
        !window.completeDocument &&
        !openQuestions.has(q.number) &&
        q.continuation === "complete" &&
        q.source.length &&
        q.source.every(
          (source) =>
            source.page < window.firstPrimaryPage ||
            source.page > window.lastPrimaryPage,
        )
      )
        continue;
      const continuing =
        openQuestions.has(q.number) &&
        (q.continuation === "from_previous" || q.continuation === "both");
      if (q.continuation === "to_next" || q.continuation === "both")
        openQuestions.add(q.number);
      else openQuestions.delete(q.number);
      const index = questions.findIndex((x) => x.number === q.number);
      const candidate: Question = {
        ...q,
        id: stableQuestionId(p.id, q.number),
        revisionId: "pending",
        order: index >= 0 ? questions[index].order : questions.length,
      };
      if (index >= 0) {
        const merged = mergeQuestionFragments(
          questions[index],
          candidate,
          continuing,
        );
        questions[index] = merged.question;
        warnings.push(...merged.issues);
      } else questions.push(candidate);
    }
  }
  if (!questions.length)
    throw new AppError(
      "empty_conversion",
      "No questions could be extracted. Check the source PDF.",
    );
  for (const number of openQuestions)
    warnings.push(
      `Question ${number}: continuation was not completed. Check the remaining source pages.`,
    );
  stage("Matching reference solutions");
  const solution = getDocument(db, p.solutionDocumentId);
  const entries: SolutionEntry[] = [];
  const openSolutions = new Set<string>();
  const solutionConflicts = new Map<string, string[]>();
  const solutionSchema = solutionOutputFor(questions);
  const expectedQuestions = {
    expectedQuestionNumbers: questions.map((q) => q.number),
    instruction:
      "Return one separate entry per exact leaf question number. Never combine subparts under a parent number.",
    choices: questions
      .filter((q) => q.options.length)
      .map((q) => ({
        number: q.number,
        optionIds: q.options.map((o) => o.id),
      })),
  };
  if (solution.mime === "application/pdf") {
    const doc = await extractPdf(db, solution.id);
    for (const window of documentWindows(doc.pages)) {
      stage(
        window.completeDocument
          ? `Converting all ${window.totalPages} solution pages`
          : `Converting solution pages ${window.firstPrimaryPage}–${window.lastPrimaryPage}`,
      );
      const output = await ai.structured(
        solutionSchema,
        "paper_solutions",
        PARSE_SOLUTIONS,
        [
          { role: "user", content: JSON.stringify(expectedQuestions) },
          ...pageInput(doc.documentId, window.pages, {
            ...window,
            openQuestionNumbers: [...openSolutions],
          }),
        ],
        "INGEST",
      );
      warnings.push(...output.warnings);
      notes.push(...output.notes);
      for (const rawEntry of output.entries) {
        const entry = {
          ...rawEntry,
          number: canonicalQuestionNumber(rawEntry.number),
        };
        if (
          !window.completeDocument &&
          !openSolutions.has(entry.number) &&
          entry.continuation === "complete" &&
          entry.source.length &&
          entry.source.every(
            (source) =>
              source.page < window.firstPrimaryPage ||
              source.page > window.lastPrimaryPage,
          )
        )
          continue;
        const continuing =
          openSolutions.has(entry.number) &&
          (entry.continuation === "from_previous" ||
            entry.continuation === "both");
        if (entry.continuation === "to_next" || entry.continuation === "both")
          openSolutions.add(entry.number);
        else openSolutions.delete(entry.number);
        const index = entries.findIndex((e) => e.number === entry.number);
        if (index < 0) entries.push(entry);
        else {
          const merged = mergeSolutionFragments(
            entries[index],
            entry,
            continuing,
          );
          entries[index] = merged.entry;
          if (merged.issues.length)
            solutionConflicts.set(entry.number, [
              ...new Set([
                ...(solutionConflicts.get(entry.number) || []),
                ...merged.issues,
              ]),
            ]);
        }
      }
    }
    // Re-read only disputed leaves with all of their original source pages together.
    // Never suppress a conflict just because the extracted answers look similar.
    for (const [number, conflicts] of solutionConflicts) {
      const index = entries.findIndex((e) => e.number === number);
      const target = questions.find((q) => q.number === number)!;
      const sourcePages = new Set(entries[index].source.map((ref) => ref.page));
      const pages = doc.pages.filter((page) => sourcePages.has(page.page));
      if (!pages.length || documentWindows(pages).length !== 1) {
        warnings.push(...conflicts);
        continue;
      }
      stage(`Checking solution ${number} against original pages`);
      const output = await ai.structured(
        solutionOutputFor([target]),
        "reconcile_solutions",
        `${PARSE_SOLUTIONS} This is a focused re-extraction after overlapping passes disagreed. Read the supplied ORIGINAL source pages afresh, including summary keys and worked solutions. Extract ONLY the requested leaf subpart. Assign working to its exact subpart label; never attach an adjacent subpart's derivation. Related questions are context only. Return one complete entry if the originals resolve the ambiguity. If the originals genuinely conflict or are unreadable, return a warning instead of guessing.`,
        [
          {
            role: "user",
            content: JSON.stringify({
              expectedQuestionNumbers: [number],
              questions: [target],
              relatedQuestions: questionDependencies(questions, [target]),
            }),
          },
          ...pageInput(doc.documentId, pages, {
            completeDocument: false,
            totalPages: doc.pages.length,
            firstPrimaryPage: pages[0].page,
            lastPrimaryPage: pages.at(-1)!.page,
          }),
        ],
        "INGEST",
      );
      notes.push(...output.notes);
      const resolved = output.entries[0];
      if (
        output.warnings.length ||
        output.entries.length !== 1 ||
        resolved?.continuation !== "complete"
      )
        warnings.push(...conflicts, ...output.warnings);
      else {
        entries[index] = resolved;
        openSolutions.delete(number);
      }
    }
  } else {
    const text = readFileSync(
      path.join(storageDir(db), solution.storageKey),
      "utf8",
    );
    const output = await ai.structured(
      solutionSchema,
      "paper_solutions",
      PARSE_SOLUTIONS,
      [
        { role: "user", content: JSON.stringify(expectedQuestions) },
        { role: "user", content: text },
      ],
      "INGEST",
    );
    entries.push(...output.entries.map((e) => ({ ...e, source: [] })));
    warnings.push(...output.warnings);
    notes.push(...output.notes);
  }
  for (const number of openSolutions)
    warnings.push(
      `Solution ${number}: continuation was not completed. Check the remaining source pages.`,
    );
  const aligned = alignAnswers(questions, entries, p.solutionOrigin!);
  let content: ParsedRevision = {
    questions,
    answers: aligned.answers,
    explanations: [],
    issues: [...new Set([...warnings, ...aligned.issues])],
    notes: [...new Set(notes)],
  };
  content.issues.push(...validateSources(db, content, p.id));
  const valid = validateRevision(content);
  if (valid.ok) {
    stage("Preparing explanations");
    content = await prepareExplanations(db, content, ai, (done, total) =>
      stage(`Preparing explanations (${done}/${total})`),
    );
  }
  const final = valid.ok ? validateRevision(content, true) : valid;
  if (!final.ok)
    content.issues = [...new Set([...content.issues, ...final.issues])];
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
