import { randomUUID, createHash } from "node:crypto";
import { mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { AppDb } from "../../server/db/client";
import { one } from "../../server/db/queries";
import { getModule } from "../library/service";
import {
  getPaper,
  getDocument,
  storageDir,
  type DocumentMeta,
} from "../documents/service";
import { extractPdf, type ExtractedDocument } from "../ingestion/pdf";
import { saveRevision, publishRevision } from "../review/repository";
import { validateSources } from "../ingestion/pipeline";
import { validateRevision, type ParsedRevision } from "../../domain/questions";
import type { Block, SourceRef } from "../../domain/content";
import {
  validatePaperJson,
  buildRepairPrompt,
  type ImportIssue,
  type PortableBlock,
} from "./contract";
const RequestSchema = z.strictObject({
  text: z.string(),
  questionDocumentId: z.string().optional(),
  solutionDocumentId: z.string().optional(),
});
export const failedImport = (issues: ImportIssue[]) => ({
  ok: false as const,
  issues,
  repairPrompt: buildRepairPrompt(issues),
});
export function isJsonPaper(db: AppDb, paperId: string) {
  return !!one(db, "SELECT paperId FROM jsonImports WHERE paperId=?", paperId);
}
export async function prepareJsonImport(
  db: AppDb,
  moduleId: string,
  raw: unknown,
) {
  getModule(db, moduleId);
  const req = RequestSchema.safeParse(raw);
  if (!req.success)
    return failedImport(
      req.error.issues.map((i) => ({
        path: "$." + i.path.join("."),
        message: i.message,
      })),
    );
  const validated = validatePaperJson(req.data.text);
  if (!validated.ok) return failedImport(validated.issues);
  const paper = validated.paper,
    issues: ImportIssue[] = [];
  const docs: Partial<Record<"question" | "solution", ExtractedDocument>> = {};
  const metadata: Partial<Record<"question" | "solution", DocumentMeta>> = {};
  for (const role of ["question", "solution"] as const) {
    const id = req.data[`${role}DocumentId`];
    if (!id) continue;
    let doc: DocumentMeta;
    try {
      doc = getDocument(db, id);
    } catch {
      issues.push({
        path: `$.${role}DocumentId`,
        message: `Attach the original ${role} PDF in this module.`,
      });
      continue;
    }
    if (
      doc.role !== role ||
      doc.moduleId !== moduleId ||
      doc.mime !== "application/pdf"
    ) {
      issues.push({
        path: `$.${role}DocumentId`,
        message: `Use a ${role} PDF from this module.`,
      });
      continue;
    }
    try {
      docs[role] = await extractPdf(db, id);
      metadata[role] = doc;
    } catch (e) {
      issues.push({
        path: `$.${role}DocumentId`,
        message: e instanceof Error ? e.message : "The PDF could not be read.",
      });
    }
  }
  function checkPage(
    role: "question" | "solution",
    page: number,
    where: string,
  ) {
    if (!docs[role])
      issues.push({
        path: where,
        message: `Attach the original ${role} PDF to resolve page ${page}, or replace this page reference with faithful Markdown.`,
      });
    else if (!docs[role]!.pages.some((p) => p.page === page))
      issues.push({
        path: where,
        message: `${role} PDF has ${docs[role]!.pages.length} pages; page ${page} does not exist. Use physical PDF page indices.`,
      });
  }
  paper.questions.forEach((q, i) => {
    const prefix = `$.questions[${i}]`;
    const collections: [string, PortableBlock[]][] = [
      ["context", q.context],
      ["prompt", q.prompt],
      ["answer.content", q.answer?.content || []],
      ["explanation", q.explanation],
      ...q.options.flatMap((o, j): [string, PortableBlock[]][] => [
        [`options[${j}].content`, o.content],
        [`options[${j}].explanation`, o.explanation],
      ]),
    ];
    for (const [field, blocks] of collections)
      blocks.forEach((b, j) => {
        if (b.kind === "page") {
          checkPage(b.document, b.page, `${prefix}.${field}[${j}]`);
          if (field === "answer.content" && b.document !== "solution")
            issues.push({
              path: `${prefix}.${field}[${j}]`,
              message:
                "Reference answer page images must use the solution PDF. Put question images in context or explanation.",
            });
        }
      });
    q.questionPages.forEach((page, j) =>
      checkPage("question", page, `${prefix}.questionPages[${j}]`),
    );
    q.answerPages.forEach((page, j) =>
      checkPage("solution", page, `${prefix}.answerPages[${j}]`),
    );
  });
  if (issues.length) return failedImport(issues.slice(0, 100));
  const convert = (blocks: PortableBlock[]): Block[] =>
    blocks.map((b) =>
      b.kind === "markdown"
        ? b
        : {
            kind: "asset",
            assetId: docs[b.document]!.pages.find((p) => p.page === b.page)!
              .pageAssetId,
            alt: b.alt,
          },
    );
  const content: ParsedRevision = {
    questions: [],
    answers: [],
    explanations: [],
    issues: [],
    notes: [],
  };
  paper.questions.forEach((q, order) => {
    const id = randomUUID();
    const all = [
      ...q.context,
      ...q.prompt,
      ...q.options.flatMap((o) => [...o.content, ...o.explanation]),
      ...q.explanation,
      ...(q.answer?.content || []),
    ];
    const refs = (
      role: "question" | "solution",
      given: number[],
    ): SourceRef[] =>
      [
        ...new Set([
          ...given,
          ...all.flatMap((b) =>
            b.kind === "page" && b.document === role ? [b.page] : [],
          ),
        ]),
      ].map((page) => ({
        documentId: docs[role]!.documentId,
        page,
        bbox: null,
      }));
    content.questions.push({
      id,
      revisionId: "pending",
      number: q.number,
      order,
      parentNumbers: [],
      kind: q.kind,
      requiresDrawing: false,
      marks: q.marks,
      context: convert(q.context),
      prompt: convert(q.prompt),
      options: q.options.map((o) => ({
        id: o.id,
        content: convert(o.content),
      })),
      source: refs("question", q.questionPages),
    });
    if (q.kind === "unsupported") return;
    const a = q.answer!;
    content.answers.push({
      questionId: id,
      origin: a.origin,
      content: convert(a.content),
      correctOptionIds: a.correctOptionIds,
      rubric: a.rubric,
      rubricOrigin: a.rubric ? "supplied" : null,
      source: refs("solution", q.answerPages),
    });
    content.explanations.push({
      questionId: id,
      worked: convert(q.explanation),
      status: "ready",
      byOption: Object.fromEntries(
        q.options.map((o) => [o.id, convert(o.explanation)]),
      ),
    });
  });
  const contract = validateRevision(content, true);
  if (!contract.ok)
    return failedImport(
      contract.issues.map((message) => ({ path: "$", message })),
    );
  return {
    ok: true as const,
    input: req.data,
    paper,
    content,
    metadata,
    summary: {
      title: paper.title,
      questions: paper.questions.length,
      supported: content.answers.length,
      excluded: paper.questions.length - content.answers.length,
      externalAnswers: content.answers.filter((a) => a.origin === "external_ai")
        .length,
    },
  };
}
export async function importJsonPaper(
  db: AppDb,
  moduleId: string,
  raw: unknown,
) {
  const prepared = await prepareJsonImport(db, moduleId, raw);
  if (!prepared.ok) return prepared;
  const { paper, content, input, metadata } = prepared;
  const hash = createHash("sha256")
    .update(
      JSON.stringify({
        paper,
        question: input.questionDocumentId || null,
        solution: input.solutionDocumentId || null,
      }),
    )
    .digest("hex");
  let createdFile: string | undefined;
  try {
    return db.transaction(() => {
      const old = one<{ paperId: string }>(
        db,
        "SELECT paperId FROM jsonImports WHERE moduleId=? AND inputHash=?",
        moduleId,
        hash,
      );
      if (old)
        return {
          ok: true as const,
          paper: getPaper(db, old.paperId),
          reused: true,
        };
      const digest = createHash("sha256").update(input.text).digest("hex");
      let original = one<{ id: string }>(
        db,
        "SELECT id FROM documents WHERE ownerId='local' AND moduleId=? AND role='import' AND hash=?",
        moduleId,
        digest,
      );
      if (!original) {
        const id = randomUUID();
        mkdirSync(storageDir(db), { recursive: true });
        createdFile = path.join(storageDir(db), id);
        writeFileSync(createdFile, input.text, { flag: "wx" });
        db.prepare("INSERT INTO documents VALUES(?,?,?,?,?,?,?,?,?,?)").run(
          id,
          "local",
          moduleId,
          digest,
          "application/json",
          "import",
          id,
          "paper.json",
          Buffer.byteLength(input.text),
          new Date().toISOString(),
        );
        original = { id };
      }
      const id = randomUUID();
      db.prepare("INSERT INTO papers VALUES(?,?,?,?,?,?,?,?,?,?)").run(
        id,
        "local",
        moduleId,
        paper.title,
        metadata.question?.id || original.id,
        metadata.solution?.id || null,
        content.answers.some((a) => a.origin === "external_ai")
          ? "external_ai"
          : "official",
        "needs_review",
        null,
        new Date().toISOString(),
      );
      const sourceIssues = validateSources(db, content, id);
      if (sourceIssues.length) throw new Error(sourceIssues.join("; "));
      const revision = saveRevision(db, id, content);
      publishRevision(db, id, revision.id, revision.version);
      db.prepare("INSERT INTO jsonImports VALUES(?,?,?,?)").run(
        id,
        moduleId,
        hash,
        original.id,
      );
      return { ok: true as const, paper: getPaper(db, id), reused: false };
    })();
  } catch (e) {
    if (createdFile) unlinkSync(createdFile);
    throw e;
  }
}
