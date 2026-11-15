import { randomUUID } from "node:crypto";
import { CachedIngestionGateway } from "../server/ai/cache";
import { z } from "zod";
import type { AppDb } from "../server/db/client";
import type { AiGateway } from "../server/ai/gateway";
import {
  claimJob,
  finishJob,
  failJob,
  jobStage,
  assertLease,
} from "../features/jobs/service";
import {
  ingestPaper,
  prepareExplanations,
  validateSources,
} from "../features/ingestion/pipeline";
import { getRevision, publishRevision } from "../features/review/repository";
import { attemptContext } from "../features/practice/service";
import { AssessmentSchema } from "../domain/feedback";
import { validateAssessment } from "../features/feedback/evaluate";
import { EVALUATE, REPLY } from "../server/ai/prompts";
import { getMessages } from "../features/followup/service";
import { getPaper } from "../features/documents/service";
import { AppError } from "../server/errors";
export async function runNextJob(db: AppDb, ai: AiGateway): Promise<boolean> {
  ai = new CachedIngestionGateway(db, ai);
  const job = claimJob(db);
  if (!job) return false;
  const timer = setInterval(() => {
    db.prepare(
      "UPDATE jobs SET leaseUntil=? WHERE id=? AND leaseToken=? AND status=? AND leaseUntil>?",
    ).run(Date.now() + 90000, job.id, job.leaseToken, "running", Date.now());
  }, 20000);
  try {
    const payload = JSON.parse(job.payload);
    const stage = (name: string) => jobStage(db, job, name);
    if (job.kind === "ingest") {
      if (payload.draftId) {
        const r = getRevision(db, payload.draftId);
        if (r.version !== payload.expectedVersion)
          throw new AppError(
            "version_conflict",
            "This draft changed. Save and prepare it again.",
            409,
          );
        stage("Preparing explanations");
        const content = await prepareExplanations(r.content, ai);
        finishJob(db, job, () => {
          const latest = getRevision(db, r.id);
          if (latest.version !== r.version)
            throw new AppError(
              "version_conflict",
              "This draft changed during preparation.",
              409,
            );
          const issues = validateSources(db, content, r.paperId);
          if (issues.length)
            throw new AppError("needs_review", issues.join("\n"), 409);
          db.prepare("UPDATE revisions SET contentJson=? WHERE id=?").run(
            JSON.stringify(content),
            r.id,
          );
          publishRevision(db, r.paperId, r.id, r.version);
        });
      } else {
        assertLease(db, job);
        getPaper(db, payload.paperId);
        db.prepare("UPDATE papers SET state='processing' WHERE id=?").run(
          payload.paperId,
        );
        await ingestPaper(db, payload.paperId, ai, stage, (write) =>
          finishJob(db, job, write),
        );
      }
    } else if (job.kind === "evaluate") {
      stage("Assessing your answer");
      const c = attemptContext(db, payload.attemptId);
      const raw = await ai.structured(
        AssessmentSchema,
        "written_assessment",
        EVALUATE,
        [{ role: "user", content: JSON.stringify(c) }],
        "FEEDBACK",
      );
      const feedback = validateAssessment(raw, c);
      finishJob(db, job, () => {
        db.prepare(
          "UPDATE attempts SET status='succeeded',feedbackJson=? WHERE id=?",
        ).run(JSON.stringify(feedback), payload.attemptId);
      });
    } else {
      stage("Explaining your question");
      const c = attemptContext(db, payload.attemptId);
      const messages = getMessages(db, payload.attemptId)
        .filter((m) => m.status === "succeeded" || m.id === payload.messageId)
        .slice(-12);
      const output = await ai.structured(
        z.object({ reply: z.string().min(1) }),
        "question_followup",
        REPLY,
        [{ role: "user", content: JSON.stringify({ ...c, messages }) }],
        "CHAT",
      );
      finishJob(db, job, () => {
        db.prepare("UPDATE messages SET status='succeeded' WHERE id=?").run(
          payload.messageId,
        );
        db.prepare("INSERT INTO messages VALUES(?,?,?,?,?,?,?)").run(
          randomUUID(),
          payload.attemptId,
          "assistant",
          output.reply,
          "succeeded",
          null,
          new Date().toISOString(),
        );
      });
    }
  } catch (e) {
    try {
      failJob(db, job, e);
    } catch (stale) {
      if (!(stale instanceof AppError && stale.code === "stale_job"))
        throw stale;
    }
  } finally {
    clearInterval(timer);
  }
  return true;
}
