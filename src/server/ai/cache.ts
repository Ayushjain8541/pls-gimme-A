import { createHash } from "node:crypto";
import type { z } from "zod";
import type { ResponseInput } from "openai/resources/responses/responses";
import type { AppDb } from "../db/client";
import { one } from "../db/queries";
import type { AiGateway } from "./gateway";
/** Cache only document preparation, never student assessments or follow-up chat. */
export class CachedIngestionGateway implements AiGateway {
  constructor(
    private db: AppDb,
    private delegate: AiGateway,
    private model = process.env.OPENAI_MODEL_INGEST || "unconfigured",
  ) {}
  async structured<T>(
    schema: z.ZodType<T>,
    name: string,
    instructions: string,
    input: ResponseInput,
    task: "INGEST" | "FEEDBACK" | "CHAT",
  ): Promise<T> {
    if (task !== "INGEST")
      return this.delegate.structured(schema, name, instructions, input, task);
    const key = createHash("sha256")
      .update(JSON.stringify({ model: this.model, name, instructions, input }))
      .digest("hex");
    const cached = one<{ contentJson: string }>(
      this.db,
      "SELECT contentJson FROM aiArtifacts WHERE cacheKey=?",
      key,
    );
    if (cached) return schema.parse(JSON.parse(cached.contentJson));
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
