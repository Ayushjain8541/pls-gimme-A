import { test, expect, afterEach, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { openDb } from "../../src/server/db/client";
import { createModule } from "../../src/features/library/service";
import { handleRequest } from "../../src/server/router";
import { portablePaper } from "../fixtures/portable-paper";
import { runNextJob } from "../../src/worker/runner";
import type { AiGateway } from "../../src/server/ai/gateway";
const req = (url: string, body: unknown) =>
  new Request("http://127.0.0.1/api" + url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
afterEach(() => vi.unstubAllEnvs());
test("written JSON practice reveals explanations without a provider and AI assessment requires an explicit action", async () => {
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  const db = openDb(mkdtempSync(`${tmpdir()}/self-review-`) + "/db");
  const mod = createModule(db, { code: "CS1", title: "Practice" });
  const r = await handleRequest(
    req(`/modules/${mod.id}/json-import/confirm`, {
      text: JSON.stringify(portablePaper()),
    }),
    db,
  );
  const paper = await r.json();
  const s = await (
    await handleRequest(req(`/papers/${paper.id}/sessions`, {}), db)
  ).json();
  const q = s.questions.find((q: { number: string }) => q.number === "19(a)");
  const attempt = await (
    await handleRequest(
      req(`/sessions/${s.id}/attempts`, {
        questionId: q.id,
        response: { kind: "written", text: "Zero occupies a representation." },
        requestId: "typed-import",
      }),
      db,
    )
  ).json();
  expect(attempt.status).toBe("succeeded");
  expect(attempt.feedback).toMatchObject({
    assessmentMode: "self_review",
    verdict: "unable_to_assess",
    score: null,
    reference: { origin: "external_ai" },
  });
  expect(attempt.feedback.worked[0].text).toContain("extra negative");
  expect(db.prepare("SELECT COUNT(*) n FROM jobs").get()).toEqual({ n: 0 });
  const noKey = await handleRequest(
    req(`/attempts/${attempt.id}/assess`, {}),
    db,
  );
  expect(noKey.status).toBe(503);
  expect(db.prepare("SELECT COUNT(*) n FROM jobs").get()).toEqual({ n: 0 });
  vi.stubEnv("ANTHROPIC_API_KEY", "local-test-key");
  const optional = await handleRequest(
    req(`/attempts/${attempt.id}/assess`, {}),
    db,
  );
  expect(optional.status).toBe(202);
  expect((await optional.json()).status).toBe("pending");
  await handleRequest(req(`/attempts/${attempt.id}/assess`, {}), db);
  expect(db.prepare("SELECT COUNT(*) n FROM jobs").get()).toEqual({ n: 1 });
  const fake: AiGateway = {
    async structured(schema) {
      return schema.parse({
        verdict: "partly_correct",
        strengths: ["Mentions zero."],
        issues: [],
        worked: [{ kind: "markdown", text: "Zero is nonnegative." }],
        score: null,
      });
    },
  };
  await runNextJob(db, fake);
  const assessed = await (
    await handleRequest(
      new Request(`http://127.0.0.1/api/attempts/${attempt.id}`),
      db,
    )
  ).json();
  expect(assessed.status).toBe("succeeded");
  expect(assessed.feedback.verdict).toBe("partly_correct");
  expect(assessed.feedback.assessmentMode).toBeUndefined();
  db.close();
});
