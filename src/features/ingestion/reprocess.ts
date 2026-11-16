import type { AppDb } from "../../server/db/client";
import { one } from "../../server/db/queries";
import { AppError } from "../../server/errors";
import { getPaper } from "../documents/service";
import { enqueueJob, retryJob } from "../jobs/service";
import { VERSION } from "../../server/ai/prompts";
/** Retry conversion from the stored originals, preserving all prior revisions/attempts. */
export function reprocessPaper(db: AppDb, paperId: string) {
  const paper = getPaper(db, paperId);
  if (one(db, "SELECT paperId FROM jsonImports WHERE paperId=?", paperId))
    throw new AppError(
      "json_import",
      "This paper was imported from JSON. Import a corrected JSON file instead of running PDF conversion.",
      409,
    );
  if (!paper.solutionDocumentId)
    throw new AppError("needs_solutions", "Attach a solution file first.", 409);
  return db.transaction(() => {
    const active = one<{ id: string }>(
      db,
      "SELECT id FROM jobs WHERE kind='ingest' AND status IN ('queued','running') AND json_extract(payload,'$.paperId')=? ORDER BY rowid DESC LIMIT 1",
      paperId,
    );
    if (active) return { jobId: active.id };
    const last = one<{ id: string; version: number }>(
      db,
      "SELECT id,version FROM revisions WHERE paperId=? ORDER BY rowid DESC LIMIT 1",
      paperId,
    );
    const job = enqueueJob(
      db,
      "ingest",
      `reprocess:${paperId}:${VERSION}:${last?.id || "original"}:${last?.version || 0}`,
      { paperId },
    );
    if (job.status === "failed") retryJob(db, job.id);
    db.prepare("UPDATE papers SET state='queued' WHERE id=?").run(paperId);
    return { jobId: job.id };
  })();
}
