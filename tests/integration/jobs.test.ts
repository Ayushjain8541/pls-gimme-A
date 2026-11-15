import { test, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { openDb } from "../../src/server/db/client";
import {
  enqueueJob,
  claimJob,
  finishJob,
} from "../../src/features/jobs/service";
test("only one worker owns a job and expired workers cannot commit results", () => {
  const db = openDb(mkdtempSync(`${tmpdir()}/jobs-`) + "/db");
  const a = enqueueJob(db, "ingest", "paper1", { paperId: "p" });
  expect(enqueueJob(db, "ingest", "paper1", {}).id).toBe(a.id);
  const now = Date.now();
  const first = claimJob(db, now)!;
  expect(claimJob(db, now + 1)).toBeNull();
  const second = claimJob(db, now + 100000)!;
  expect(second.id).toBe(first.id);
  expect(() => finishJob(db, first, () => {})).toThrow();
  let committed = false;
  finishJob(db, second, () => {
    committed = true;
  });
  expect(committed).toBe(true);
  db.close();
});

test("an expired lease cannot commit even before another worker reclaims it", () => {
  const db = openDb(mkdtempSync(`${tmpdir()}/lease-`) + "/db");
  enqueueJob(db, "ingest", "expired", { paperId: "none" });
  const job = claimJob(db)!;
  db.prepare("UPDATE jobs SET leaseUntil=? WHERE id=?").run(
    Date.now() - 1,
    job.id,
  );
  expect(() => finishJob(db, job, () => {})).toThrow();
  db.close();
});
