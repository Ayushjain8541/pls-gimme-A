export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
    public retryable = false,
  ) {
    super(message);
  }
}
export function requireValue<T>(
  value: T | null | undefined,
  message = "Not found",
): T {
  if (value == null) throw new AppError("not_found", message, 404);
  return value;
}
