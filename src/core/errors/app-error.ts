export class AppError extends Error {
  constructor(message: string, readonly code: string, readonly details?: unknown, options?: ErrorOptions) {
    super(message, options);
    this.name = "AppError";
  }
}
