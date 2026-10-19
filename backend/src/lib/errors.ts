/** Error with a stable machine-readable code and a message safe to show to the user. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (code: string, message: string, details?: unknown) => new AppError(400, code, message, details);
export const unauthorized = (message = "Please sign in again.") => new AppError(401, "UNAUTHENTICATED", message);
export const forbidden = (message = "You do not have permission to do this.") => new AppError(403, "FORBIDDEN", message);
export const notFound = (what = "Record") => new AppError(404, "NOT_FOUND", `${what} not found.`);
export const conflict = (code: string, message: string, details?: unknown) => new AppError(409, code, message, details);
