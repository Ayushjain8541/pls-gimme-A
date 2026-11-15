import { test, expect } from "vitest";
import {
  saveRevision,
  publishRevision,
  getRevision,
} from "../../src/features/review/repository";
import { fixtureRevision } from "../fixtures/paper";
import { readyPaper } from "../fixtures/ready-paper";

test("published content is immutable and stale version updates are rejected", async () => {
  const { db, paper, revision } = await readyPaper();
  const changed = fixtureRevision();
  changed.questions[0].prompt = [
    { kind: "markdown", text: "Updated question" },
  ];
  const next = saveRevision(
    db,
    paper.id,
    changed,
    revision.id,
    revision.version,
  );
  expect(next.id).not.toBe(revision.id);
  expect(getRevision(db, revision.id).content.questions[0].prompt[0]).toEqual({
    kind: "markdown",
    text: "What is the largest signed 8-bit integer?",
  });
  expect(() => publishRevision(db, paper.id, next.id, 999)).toThrow();
  db.close();
});

test("a failed repair does not make the published paper unavailable", async () => {
  const { db, paper, revision } = await readyPaper();
  db.prepare("DELETE FROM jobs").run();
  const { enqueueJob, claimJob, failJob } =
    await import("../../src/features/jobs/service");
  const { AppError } = await import("../../src/server/errors");
  const { getPaper } = await import("../../src/features/documents/service");
  enqueueJob(db, "ingest", "repair", {
    paperId: paper.id,
    draftId: revision.id,
    expectedVersion: 0,
  });
  const job = claimJob(db)!;
  failJob(db, job, new AppError("version_conflict", "The draft changed.", 409));
  expect(getPaper(db, paper.id).state).toBe("ready");
  expect(getPaper(db, paper.id).activeRevisionId).toBe(revision.id);
  db.close();
});

test("reprocessing an existing upload queues one job without replacing saved revisions", async () => {
  const { db, paper, revision } = await readyPaper();
  db.prepare("DELETE FROM jobs").run();
  const { reprocessPaper } =
    await import("../../src/features/ingestion/reprocess");
  const first = reprocessPaper(db, paper.id);
  expect(reprocessPaper(db, paper.id).jobId).toBe(first.jobId);
  expect(getRevision(db, revision.id).status).toBe("published");
  expect(
    (db.prepare("SELECT count(*) AS n FROM papers").get() as { n: number }).n,
  ).toBe(1);
  db.close();
});
