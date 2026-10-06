/**
 * Single error shape for the whole app. Internal database errors are logged
 * server-side (never with diary content) and replaced with a short public message.
 */

export class AppError extends Error {
  status: number;
  code: string;

  constructor(message: string, status = 400, code = "bad_request") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const badRequest = (m = "Invalid request") => new AppError(m, 400, "bad_request");
export const unauthorized = (m = "Not signed in") => new AppError(m, 401, "unauthorized");
export const forbidden = (m = "Not allowed") => new AppError(m, 403, "forbidden");
export const notFound = (m = "Not found") => new AppError(m, 404, "not_found");
export const conflict = (m = "Conflicts with existing data") => new AppError(m, 409, "conflict");

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Log an error without ever dumping request bodies or diary text. */
export function logError(scope: string, error: unknown): void {
  console.error(`[${scope}] ${messageOf(error)}`);
}
