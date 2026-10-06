import { z } from "zod";
import { AppError, logError, messageOf } from "./errors";

export type ApiSuccess<T> = { data: T };

/**
 * Wrap a route handler: turns AppError into a clean JSON response, converts
 * unknown errors into a generic 500 (details logged server-side only) and
 * never leaks database messages to the client.
 */
export function apiHandler<Args extends unknown[]>(
  scope: string,
  handler: (...args: Args) => Promise<Response>,
) {
  return async (...args: Args): Promise<Response> => {
    try {
      return await handler(...args);
    } catch (error) {
      if (error instanceof AppError) {
        return Response.json(
          { error: { code: error.code, message: error.message } },
          { status: error.status },
        );
      }
      logError(scope, error);
      return Response.json(
        { error: { code: "internal_error", message: "Something went wrong on our side." } },
        { status: 500 },
      );
    }
  };
}

export function json<T>(data: T, init?: ResponseInit): Response {
  return Response.json({ data }, init);
}

/** Parse and validate a JSON body with a zod schema. */
export async function parseBody<S extends z.ZodType>(
  request: Request,
  schema: S,
): Promise<z.output<S>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new AppError("Request body must be valid JSON", 400, "invalid_json");
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const first = result.error.issues[0];
    const path = first.path.map(String).join(".") || "body";
    throw new AppError(`${path}: ${first.message}`, 422, "validation_failed");
  }
  return result.data;
}

export function parseQuery<S extends z.ZodType>(request: Request, schema: S): z.output<S> {
  const url = new URL(request.url);
  const raw = Object.fromEntries(url.searchParams.entries());
  const result = schema.safeParse(raw);
  if (!result.success) {
    const first = result.error.issues[0];
    throw new AppError(
      `${first.path.map(String).join(".") || "query"}: ${first.message}`,
      422,
      "validation_failed",
    );
  }
  return result.data;
}

/** Fixed-window rate limiter, per process. Adequate for a single-user app. */
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, limit: number, windowMs: number): void {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  bucket.count += 1;
  if (bucket.count > limit) {
    throw new AppError("Too many requests, slow down.", 429, "rate_limited");
  }
}

export { messageOf };
