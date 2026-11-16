import { questionDependencies } from "../ingestion/context";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AppDb } from "../../server/db/client";
import { one, all } from "../../server/db/queries";
import { requireValue, AppError } from "../../server/errors";
import { getPaper } from "../documents/service";
import { getRevision } from "../review/repository";
import {
  ResponseSchema,
  computeProgress,
  type StudentResponse,
} from "../../domain/practice";
import type { Feedback } from "../../domain/feedback";
import { gradeMcq } from "../feedback/mcq";
import { enqueueJob, retryJob } from "../jobs/service";
import { aiConfigured } from "../../server/config";
export type Session = {
  id: string;
  paperId: string;
  revisionId: string;
  position: number;
};
type ItemRow = {
  sessionId: string;
  questionId: string;
  draftJson: string | null;
  draftVersion: number;
  skipReason: string | null;
  excluded: number;
};
type AttemptRow = {
  id: string;
  sessionId: string;
  questionId: string;
  requestId: string;
  responseJson: string;
  status: "pending" | "succeeded" | "failed";
  feedbackJson: string | null;
  disputed: number;
  createdAt: string;
};
export function getAttempt(db: AppDb, id: string) {
  const a = requireValue(
    one<AttemptRow>(db, "SELECT * FROM attempts WHERE id=?", id),
  );
  getSessionRow(db, a.sessionId);
  return {
    id: a.id,
    sessionId: a.sessionId,
    questionId: a.questionId,
    response: JSON.parse(a.responseJson) as StudentResponse,
    status: a.status,
    feedback: a.feedbackJson ? (JSON.parse(a.feedbackJson) as Feedback) : null,
    disputed: !!a.disputed,
    createdAt: a.createdAt,
    job:
      one<{
        id: string;
        status: string;
        stage: string;
        errorMessage: string | null;
      }>(
        db,
        "SELECT id,status,stage,errorMessage FROM jobs WHERE dedupeKey=?",
        `evaluate:${id}`,
      ) || null,
  };
}
export type AttemptView = ReturnType<typeof getAttempt>;
export function getSessionRow(db: AppDb, id: string) {
  const s = requireValue(
    one<Session>(db, "SELECT * FROM sessions WHERE id=?", id),
  );
  getPaper(db, s.paperId);
  return s;
}
export function startSession(db: AppDb, paperId: string, restart = false) {
  const p = getPaper(db, paperId);
  const old = one<Session>(
    db,
    "SELECT * FROM sessions WHERE paperId=? ORDER BY rowid DESC LIMIT 1",
    paperId,
  );
  if (old && !restart) return getSession(db, old.id);
  if (p.state !== "ready" || !p.activeRevisionId)
    throw new AppError(
      "paper_not_ready",
      "This paper is still being prepared or needs solutions.",
      409,
    );
  return db.transaction(() => {
    const id = randomUUID();
    db.prepare("INSERT INTO sessions VALUES(?,?,?,?,?)").run(
      id,
      paperId,
      p.activeRevisionId,
      0,
      new Date().toISOString(),
    );
    for (const q of getRevision(db, p.activeRevisionId!).content.questions)
      db.prepare(
        "INSERT INTO sessionItems(sessionId,questionId,excluded) VALUES(?,?,?)",
      ).run(id, q.id, q.kind === "unsupported" ? 1 : 0);
    return getSession(db, id);
  })();
}
export function getSession(db: AppDb, id: string) {
  const s = getSessionRow(db, id);
  const paper = getPaper(db, s.paperId);
  const r = getRevision(db, s.revisionId).content;
  const items = all<ItemRow>(
    db,
    "SELECT * FROM sessionItems WHERE sessionId=?",
    id,
  );
  const attempts = all<AttemptRow>(
    db,
    "SELECT * FROM attempts WHERE sessionId=? ORDER BY rowid DESC",
    id,
  );
  const questions = r.questions.map((q) => {
    const item = requireValue(items.find((i) => i.questionId === q.id));
    const last = attempts.find((a) => a.questionId === q.id);
    return {
      ...q,
      draft: item.draftJson
        ? (JSON.parse(item.draftJson) as StudentResponse)
        : null,
      draftVersion: item.draftVersion,
      skipReason: item.skipReason,
      excluded: !!item.excluded,
      attempt: last ? getAttempt(db, last.id) : null,
    };
  });
  return {
    id: s.id,
    paperId: s.paperId,
    revisionId: s.revisionId,
    position: s.position,
    title: paper.title,
    moduleId: paper.moduleId,
    hasNewRevision: paper.activeRevisionId !== s.revisionId,
    questions,
    progress: computeProgress(
      questions.map((q) => ({
        questionId: q.id,
        excluded: q.excluded,
        skipped: !!q.skipReason,
        submitted: !!q.attempt,
        assessed:
          q.attempt?.status === "succeeded" ||
          q.attempt?.feedback?.assessmentMode === "self_review",
      })),
    ),
  };
}
export const SaveItemSchema = z.object({
  expectedDraftVersion: z.number().int().nonnegative(),
  draft: ResponseSchema.nullable().optional(),
  position: z.number().int().nonnegative().optional(),
  skipReason: z.enum(["later", "drawing"]).nullable().optional(),
  excluded: z.boolean().optional(),
});
export function saveItem(
  db: AppDb,
  sessionId: string,
  questionId: string,
  raw: z.infer<typeof SaveItemSchema>,
) {
  const input = SaveItemSchema.parse(raw),
    s = getSessionRow(db, sessionId);
  const r = getRevision(db, s.revisionId).content;
  const q = requireValue(r.questions.find((q) => q.id === questionId));
  if (input.position !== undefined && input.position >= r.questions.length)
    throw new AppError("invalid_position", "Question does not exist.");
  if (
    input.draft &&
    q.kind.includes("select") !== (input.draft.kind === "selection")
  )
    throw new AppError(
      "invalid_response",
      "Answer type does not match this question.",
    );
  return db.transaction(() => {
    const changed = db
      .prepare(
        "UPDATE sessionItems SET draftJson=CASE WHEN ? THEN ? ELSE draftJson END,skipReason=CASE WHEN ? THEN ? ELSE skipReason END,excluded=CASE WHEN ? THEN ? ELSE excluded END,draftVersion=draftVersion+1 WHERE sessionId=? AND questionId=? AND draftVersion=?",
      )
      .run(
        input.draft !== undefined ? 1 : 0,
        input.draft ? JSON.stringify(input.draft) : null,
        input.skipReason !== undefined ? 1 : 0,
        input.skipReason ?? null,
        input.excluded !== undefined ? 1 : 0,
        input.excluded ? 1 : 0,
        sessionId,
        questionId,
        input.expectedDraftVersion,
      );
    if (!changed.changes)
      throw new AppError(
        "version_conflict",
        "This answer changed in another tab. Reload to use the saved answer.",
        409,
      );
    if (input.position !== undefined)
      db.prepare("UPDATE sessions SET position=? WHERE id=?").run(
        input.position,
        sessionId,
      );
    return { draftVersion: input.expectedDraftVersion + 1 };
  })();
}
export const SubmitSchema = z.object({
  questionId: z.string(),
  response: ResponseSchema,
  requestId: z.string().min(1).max(100),
});
export function submitAttempt(
  db: AppDb,
  sessionId: string,
  raw: z.infer<typeof SubmitSchema>,
) {
  const input = SubmitSchema.parse(raw);
  return db.transaction(() => {
    const previous = one<AttemptRow>(
      db,
      "SELECT * FROM attempts WHERE requestId=?",
      input.requestId,
    );
    if (previous) {
      if (
        previous.sessionId !== sessionId ||
        previous.questionId !== input.questionId ||
        previous.responseJson !== JSON.stringify(input.response)
      )
        throw new AppError(
          "idempotency_conflict",
          "This submission ID was already used for another answer.",
          409,
        );
      return getAttempt(db, previous.id);
    }
    const s = getSessionRow(db, sessionId),
      r = getRevision(db, s.revisionId).content;
    const q = requireValue(r.questions.find((q) => q.id === input.questionId));
    if (q.kind === "unsupported")
      throw new AppError(
        "unsupported_question",
        "This question requires manual review.",
      );
    if (
      (q.kind.includes("select") && input.response.kind !== "selection") ||
      (q.kind === "written" && input.response.kind !== "written")
    )
      throw new AppError(
        "invalid_response",
        "Answer type does not match this question.",
      );
    const a = requireValue(r.answers.find((a) => a.questionId === q.id)),
      e = requireValue(r.explanations.find((e) => e.questionId === q.id));
    const feedback: Feedback | null = q.kind.includes("select")
      ? gradeMcq(q, input.response, a, e)
      : one(db, "SELECT paperId FROM jsonImports WHERE paperId=?", s.paperId)
        ? {
            assessmentMode: "self_review" as const,
            verdict: "unable_to_assess" as const,
            provisional: true,
            strengths: [],
            issues: [],
            worked: e.worked,
            score: null,
            reference: a,
          }
        : null;
    if (
      feedback &&
      one(db, "SELECT paperId FROM jsonImports WHERE paperId=?", s.paperId)
    )
      feedback.explanationOrigin = "imported";
    const id = randomUUID();
    db.prepare(
      "INSERT INTO attempts(id,sessionId,questionId,requestId,responseJson,status,feedbackJson,createdAt) VALUES(?,?,?,?,?,?,?,?)",
    ).run(
      id,
      sessionId,
      q.id,
      input.requestId,
      JSON.stringify(input.response),
      feedback ? "succeeded" : "pending",
      feedback ? JSON.stringify(feedback) : null,
      new Date().toISOString(),
    );
    db.prepare(
      "UPDATE sessionItems SET draftJson=?,draftVersion=draftVersion+1,skipReason=NULL,excluded=0 WHERE sessionId=? AND questionId=?",
    ).run(JSON.stringify(input.response), sessionId, q.id);
    if (!feedback)
      enqueueJob(db, "evaluate", `evaluate:${id}`, { attemptId: id });
    return getAttempt(db, id);
  })();
}
export function attemptContext(db: AppDb, attemptId: string) {
  const attempt = getAttempt(db, attemptId),
    s = getSessionRow(db, attempt.sessionId),
    r = getRevision(db, s.revisionId).content;
  const question = requireValue(
    r.questions.find((q) => q.id === attempt.questionId),
  );
  return {
    attempt,
    question,
    relatedQuestions: questionDependencies(r.questions, [question]),
    answer: requireValue(
      r.answers.find((a) => a.questionId === attempt.questionId),
    ),
    prepared: requireValue(
      r.explanations.find((e) => e.questionId === attempt.questionId),
    ),
    response: attempt.response,
  };
}

/** JSON imports always reveal written references locally; paid assessment is explicit. */
export function requestAiAssessment(db: AppDb, attemptId: string) {
  const attempt = getAttempt(db, attemptId),
    session = getSessionRow(db, attempt.sessionId);
  if (
    attempt.response.kind !== "written" ||
    !one(db, "SELECT paperId FROM jsonImports WHERE paperId=?", session.paperId)
  )
    throw new AppError(
      "invalid_assessment",
      "Optional assessment is available for imported written answers.",
      409,
    );
  if (
    attempt.status === "succeeded" &&
    attempt.feedback?.assessmentMode !== "self_review"
  )
    return attempt;
  if (!aiConfigured())
    throw new AppError(
      "ai_setup_required",
      "Optional AI assessment needs ANTHROPIC_API_KEY. Your answer and reference are already available for self-review.",
      503,
    );
  return db.transaction(() => {
    const job = enqueueJob(db, "evaluate", `evaluate:${attemptId}`, {
      attemptId,
    });
    if (job.status === "failed") retryJob(db, job.id);
    db.prepare("UPDATE attempts SET status='pending' WHERE id=?").run(
      attemptId,
    );
    return getAttempt(db, attemptId);
  })();
}
