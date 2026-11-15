import { afterEach, test, expect, vi } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { AnthropicGateway } from "../../src/server/ai/anthropic";
import { aiConfigured, aiModel } from "../../src/server/config";
afterEach(() => vi.unstubAllEnvs());
function message(text: string, stop_reason = "end_turn") {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-haiku-5-5",
    content: [{ type: "text", text }],
    stop_reason,
    stop_sequence: null,
    usage: {
      input_tokens: 20,
      output_tokens: 5,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  };
}
test("one Anthropic key configures Haiku defaults with optional task overrides", () => {
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  vi.stubEnv("OPENAI_API_KEY", "old-provider-key");
  expect(aiConfigured()).toBe(false);
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  vi.stubEnv("ANTHROPIC_MODEL_INGEST", "");
  vi.stubEnv("ANTHROPIC_MODEL_FEEDBACK", "");
  expect(aiConfigured()).toBe(true);
  expect(aiModel("INGEST")).toBe("claude-haiku-5-5");
  vi.stubEnv("ANTHROPIC_MODEL_FEEDBACK", "claude-sonnet-5-5");
  expect(aiModel("FEEDBACK")).toBe("claude-sonnet-5-5");
});
test("official SDK sends schema-constrained Claude requests and preserves figure bytes", async () => {
  let payload: Record<string, unknown> | undefined;
  const client = new Anthropic({
    apiKey: "test-key",
    maxRetries: 0,
    fetch: async (_url, init) => {
      payload = JSON.parse(String(init?.body));
      return new Response(JSON.stringify(message('{"answer":"127"}')), {
        headers: { "content-type": "application/json" },
      });
    },
  });
  const result = await new AnthropicGateway(client).structured(
    z.object({ answer: z.string() }),
    "answer",
    "Use the supplied reference.",
    [
      {
        role: "user",
        content: [
          { type: "input_text", text: "Question and source context" },
          {
            type: "input_image",
            image_url: "data:image/png;base64,aGVsbG8=",
            detail: "auto",
          },
        ],
      },
    ],
    "INGEST",
  );
  expect(result).toEqual({ answer: "127" });
  expect(payload?.model).toBe("claude-haiku-5-5");
  expect(payload?.system).toBe("Use the supplied reference.");
  expect(payload?.output_config).toMatchObject({
    format: { type: "json_schema" },
  });
  expect(payload?.messages).toEqual([
    {
      role: "user",
      content: [
        { type: "text", text: "Question and source context" },
        {
          type: "image",
          source: { type: "base64", media_type: "image/png", data: "aGVsbG8=" },
        },
      ],
    },
  ]);
});
test.each(["max_tokens", "refusal"])(
  "incomplete or refused Claude output (%s) never becomes a usable assessment",
  async (stop) => {
    const client = new Anthropic({
      apiKey: "test-key",
      maxRetries: 0,
      fetch: async () =>
        new Response(JSON.stringify(message('{"answer":"partial"}', stop)), {
          headers: { "content-type": "application/json" },
        }),
    });
    await expect(
      new AnthropicGateway(client).structured(
        z.object({ answer: z.string() }),
        "answer",
        "Explain",
        [],
        "FEEDBACK",
      ),
    ).rejects.toThrow();
  },
);
test("authentication errors produce a safe actionable error without exposing credentials", async () => {
  const client = new Anthropic({
    apiKey: "secret-test-value",
    maxRetries: 0,
    fetch: async () =>
      new Response(
        JSON.stringify({
          type: "error",
          error: { type: "authentication_error", message: "invalid x-api-key" },
        }),
        { status: 401, headers: { "content-type": "application/json" } },
      ),
  });
  await expect(
    new AnthropicGateway(client).structured(
      z.object({ answer: z.string() }),
      "answer",
      "Explain",
      [],
      "CHAT",
    ),
  ).rejects.toMatchObject({
    code: "ai_credentials",
    status: 503,
    retryable: false,
  });
});
