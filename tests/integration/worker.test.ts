import { test, expect } from "vitest";
import { readyPaper } from "../fixtures/ready-paper";
import {
  startSession,
  submitAttempt,
  getAttempt,
} from "../../src/features/practice/service";
import { runNextJob } from "../../src/worker/runner";
import { FixtureAi } from "../fixtures/ai";
import { getMessages, askFollowup } from "../../src/features/followup/service";
test("worker completes written assessment and follow-up without changing its grade", async () => {
  const { db, paper } = await readyPaper();
  db.prepare("DELETE FROM jobs WHERE kind='ingest'").run();
  const s = startSession(db, paper.id);
  const a = submitAttempt(db, s.id, {
    questionId: "q2",
    response: { kind: "written", text: "Zero takes one representation." },
    requestId: "typed",
  });
  expect(a.status).toBe("pending");
  await runNextJob(db, new FixtureAi());
  const done = getAttempt(db, a.id);
  expect(done.status).toBe("succeeded");
  expect(done.feedback?.verdict).toBe("partly_correct");
  askFollowup(db, a.id, { text: "Explain more", requestId: "followup" });
  await runNextJob(db, new FixtureAi());
  expect(getMessages(db, a.id).map((m) => m.role)).toEqual([
    "user",
    "assistant",
  ]);
  expect(getAttempt(db, a.id).feedback).toEqual(done.feedback);
  db.close();
});
