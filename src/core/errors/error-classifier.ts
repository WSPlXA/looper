import { AppError } from "./app-error.js";

export type ErrorClass = "MODEL" | "TOOL" | "VALIDATION" | "INTERNAL";

export function classifyError(error: unknown): ErrorClass {
  if (error instanceof AppError && error.code.startsWith("MODEL_")) return "MODEL";
  if (error && typeof error === "object" && "issues" in error) return "VALIDATION";
  return "INTERNAL";
}
