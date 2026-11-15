import { setTimeout as pause } from "node:timers/promises";
import { getDb } from "../server/db/client";
import { AnthropicGateway } from "../server/ai/anthropic";
import { runNextJob } from "./runner";
const db = getDb(),
  ai = new AnthropicGateway();
console.log("Paper worker is running.");
let running = true;
process.on("SIGTERM", () => {
  running = false;
});
process.on("SIGINT", () => {
  running = false;
});
while (running) {
  if (!(await runNextJob(db, ai))) await pause(1000);
}
db.close();
