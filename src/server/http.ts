import { z } from "zod";
import { AppError } from "./errors";
export function checkLocalRequest(req: Request) {
  const url = new URL(req.url);
  const host = req.headers.get("host") || url.host;
  const name = host.startsWith("[")
    ? host.slice(0, host.indexOf("]") + 1)
    : host.split(":")[0];
  if (!["localhost", "127.0.0.1", "[::1]"].includes(name))
    throw new AppError(
      "forbidden",
      "This app accepts local requests only.",
      403,
    );
  const origin = req.headers.get("origin");
  if (origin && origin !== url.origin && origin !== `http://${host}`)
    throw new AppError("forbidden", "Requests must come from this app.", 403);
}
export function errorResponse(e: unknown) {
  if (e instanceof z.ZodError)
    return Response.json(
      {
        error: {
          code: "invalid_input",
          message: e.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; "),
          retryable: false,
        },
      },
      { status: 400 },
    );
  if (e instanceof AppError)
    return Response.json(
      { error: { code: e.code, message: e.message, retryable: e.retryable } },
      { status: e.status },
    );
  console.error(
    "Request failed:",
    e instanceof Error ? e.name : "Unknown error",
  );
  return Response.json(
    {
      error: {
        code: "internal_error",
        message: "Something went wrong. Your saved work is still available.",
        retryable: true,
      },
    },
    { status: 500 },
  );
}
export async function readJson(req: Request, maxBytes = 2 * 1024 * 1024) {
  const text = await req.text();
  if (Buffer.byteLength(text) > maxBytes)
    throw new AppError("too_large", "This request is too large.", 413);
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError("invalid_json", "Expected a JSON request.");
  }
}
