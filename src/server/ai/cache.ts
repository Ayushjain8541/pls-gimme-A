import { createHash } from "node:crypto";
import type { z } from "zod";
import type { AiInput } from "./gateway";
import type { AppDb } from "../db/client";
import { one } from "../db/queries";
import { aiModel } from "../config";
import type { AiGateway } from "./gateway";
/** Cache only document preparation, never student assessments or follow-up chat. */
export class CachedIngestionGateway implements AiGateway {
  constructor(
    private db: AppDb,
    private delegate: AiGateway,
    private model = aiModel("INGEST"),
  ) {}
  async structured<T>(
    schema: z.ZodType<T>,
    name: string,
    instructions: string,
    input: AiInput,
    task: "INGEST" | "FEEDBACK" | "CHAT",
  ): Promise<T> {
    if (task !== "INGEST")
      return this.delegate.structured(schema, name, instructions, input, task);
    const key = createHash("sha256")
      .update(
        JSON.stringify({
          provider: "anthropic",
          model: this.model,
          name,
          instructions,
          input,
        }),
      )
      .digest("hex");
    const cached = one<{ contentJson: string }>(
      this.db,
      "SELECT contentJson FROM aiArtifacts WHERE cacheKey=?",
      key,
    );
    if (cached) {
      const parsed = schema.safeParse(JSON.parse(cached.contentJson));
      if (parsed.success) return parsed.data;
      // A stricter output contract must not keep replaying a previously accepted bad result.
      this.db.prepare("DELETE FROM aiArtifacts WHERE cacheKey=?").run(key);
    }
    const output = schema.parse(
      await this.delegate.structured(schema, name, instructions, input, task),
    );
    this.db
      .prepare("INSERT OR IGNORE INTO aiArtifacts VALUES(?,?,?,?,?,?)")
      .run(
        key,
        task,
        name,
        this.model,
        JSON.stringify(output),
        new Date().toISOString(),
      );
    return output;
  }
}
