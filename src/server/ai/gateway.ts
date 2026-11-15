import type { z } from "zod";
import type { ResponseInput } from "openai/resources/responses/responses";
export interface AiGateway {
  structured<T>(
    schema: z.ZodType<T>,
    name: string,
    instructions: string,
    input: ResponseInput,
    task: "INGEST" | "FEEDBACK" | "CHAT",
  ): Promise<T>;
}
