import { test, expect } from "vitest";
import { readyPaper } from "../fixtures/ready-paper";
import { handleRequest } from "../../src/server/router";
test("foreign origins cannot mutate local records and player responses do not expose unsubmitted keys", async () => {
  const { db, paper } = await readyPaper();
  const hostile = await handleRequest(
    new Request("http://127.0.0.1/api/modules", {
      method: "POST",
      headers: {
        origin: "https://evil.example",
        "content-type": "application/json",
      },
      body: JSON.stringify({ code: "EVIL", title: "No" }),
    }),
    db,
  );
  expect(hostile.status).toBe(403);
  const s = await handleRequest(
    new Request(`http://127.0.0.1/api/papers/${paper.id}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }),
    db,
  );
  const session = await s.json();
  const payload = await handleRequest(
    new Request(`http://127.0.0.1/api/sessions/${session.id}`),
    db,
  );
  expect(JSON.stringify(await payload.json())).not.toContain(
    "correctOptionIds",
  );
  db.close();
});
