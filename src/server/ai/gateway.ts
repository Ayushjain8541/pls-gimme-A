import type { z } from "zod";
export type AiTask = "INGEST" | "FEEDBACK" | "CHAT";
/** Application input format, independent of the API provider's SDK. */
export type AiInputContent =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string; detail: "auto" | "low" | "high" };
export type AiInput = Array<{
  role: "user" | "assistant";
  content: string | AiInputContent[];
}>;
export interface AiGateway {
  structured<T>(
    schema: z.ZodType<T>,
    name: string,
    instructions: string,
    input: AiInput,
    task: AiTask,
  ): Promise<T>;
}
