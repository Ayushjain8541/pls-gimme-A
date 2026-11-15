import { createServer } from "node:http";
import { setTimeout as pause } from "node:timers/promises";
import { getDb } from "../../src/server/db/client";
import { runNextJob } from "../../src/worker/runner";
import { FixtureAi } from "../fixtures/ai";

const db = getDb();
const server = createServer((_req, res) => res.end("ready")).listen(
  3101,
  "127.0.0.1",
);
process.on("SIGTERM", () => {
  server.close();
  process.exit();
});
const ai = new FixtureAi();
while (true) {
  if (!(await runNextJob(db, ai))) await pause(100);
}
