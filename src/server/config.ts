import path from "node:path";
export const dataDir = () => path.resolve(process.env.DATA_DIR || ".data");
export const dbPath = () =>
  path.resolve(process.env.DATABASE_PATH || path.join(dataDir(), "app.sqlite"));
export const pythonBin = () => process.env.PYTHON_BIN || ".venv/bin/python";
export const DEFAULT_CLAUDE_MODEL = "claude-haiku-5-5";
export function aiModel(task: "INGEST" | "FEEDBACK" | "CHAT") {
  return process.env[`ANTHROPIC_MODEL_${task}`]?.trim() || DEFAULT_CLAUDE_MODEL;
}
export function aiConfigured() {
  return !!process.env.ANTHROPIC_API_KEY?.trim();
}
