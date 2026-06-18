import { z } from "zod";

export const compileErrorClassSchema = z.enum([
  "MissingImport",
  "MissingSymbol",
  "TypeMismatch",
  "SyntaxError",
  "MethodSignatureMismatch",
  "PackagePathMismatch",
  "UnsupportedTranslation",
  "Unknown",
]);

export const compileErrorClassificationSchema = z.object({
  errorClass: compileErrorClassSchema,
  confidence: z.number().min(0).max(1),
  summary: z.string().min(1),
  repairHint: z.string().min(1),
});

export type CompileErrorClass = z.infer<typeof compileErrorClassSchema>;
export type CompileErrorClassification = z.infer<typeof compileErrorClassificationSchema>;
