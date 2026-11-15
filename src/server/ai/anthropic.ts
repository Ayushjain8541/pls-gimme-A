import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type {
  MessageParam,
  ContentBlockParam,
} from "@anthropic-ai/sdk/resources/messages";
import { z } from "zod";
import { aiModel } from "../config";
import { AppError } from "../errors";
import type { AiGateway, AiInput, AiTask } from "./gateway";
function messages(input: AiInput): MessageParam[] {
  return input.map((message) => ({
    role: message.role,
    content:
      typeof message.content === "string"
        ? message.content
        : message.content.map((part): ContentBlockParam => {
            if (part.type === "input_text")
              return { type: "text", text: part.text };
            const match =
              /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=\r\n]+)$/.exec(
                part.image_url,
              );
            if (!match)
              throw new AppError(
                "invalid_image",
                "Claude requires a supported local image. Remote image URLs are not accepted.",
              );
            return {
              type: "image",
              source: {
                type: "base64",
                media_type: match[1] as
                  "image/png" | "image/jpeg" | "image/gif" | "image/webp",
                data: match[2],
              },
            };
          }),
  }));
}
export class AnthropicGateway implements AiGateway {
  constructor(private client?: Anthropic) {}
  async structured<T>(
    schema: z.ZodType<T>,
    _name: string,
    instructions: string,
    input: AiInput,
    task: AiTask,
  ): Promise<T> {
    if (!this.client && !process.env.ANTHROPIC_API_KEY)
      throw new AppError(
        "ai_setup_required",
        "Add ANTHROPIC_API_KEY to .env.local, then restart the app and worker. Haiku is configured by default.",
        503,
      );
    const client =
      this.client ||
      new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
        timeout: 120000,
        maxRetries: 0,
      });
    const requestMessages = messages(input);
    try {
      const response = await client.messages.parse(
        {
          model: aiModel(task),
          max_tokens:
            task === "INGEST" ? 32768 : task === "FEEDBACK" ? 8192 : 4096,
          system: instructions,
          messages: requestMessages,
          output_config: { format: zodOutputFormat(schema) },
        },
        { timeout: 120000, maxRetries: 0 },
      );
      if (response.stop_reason === "refusal")
        throw new AppError(
          "ai_refusal",
          "Claude could not complete this request. Inspect the source or revise your question.",
          422,
        );
      if (response.stop_reason !== "end_turn" || response.parsed_output == null)
        throw new AppError(
          "incomplete_ai",
          "Claude did not complete this step. Retry or inspect the source.",
          502,
          true,
        );
      return schema.parse(response.parsed_output);
    } catch (error) {
      if (error instanceof AppError) throw error;
      const status = (error as { status?: number }).status;
      if (status === 401 || status === 403)
        throw new AppError(
          "ai_credentials",
          "Claude rejected the API key or model access. Check ANTHROPIC_API_KEY and your model settings.",
          503,
        );
      if (status === 400 || status === 404)
        throw new AppError(
          "ai_configuration",
          "Claude rejected this request. Check the selected model supports image inputs and structured outputs.",
          503,
        );
      if (error instanceof z.ZodError || error instanceof SyntaxError)
        throw new AppError(
          "invalid_ai_output",
          "Claude returned an incomplete or unusable result. Your work is saved; retry this step.",
          502,
          true,
        );
      throw new AppError(
        "ai_unavailable",
        "Claude could not complete this request. Retry without uploading again.",
        502,
        true,
      );
    }
  }
}
