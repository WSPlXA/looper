import { z } from "zod";

export const batchFileResultSchema = z.object({
  sourceFile: z.string().min(1),
  className: z.string().min(1),
  runId: z.string().min(1),
  status: z.enum(["SUCCESS", "FAILED", "UNSUPPORTED", "INTERRUPTED"]),
  attempts: z.number().int().nonnegative(),
  reportPath: z.string().optional(),
  durationMs: z.number().nonnegative(),
  failureReason: z.string().optional(),
});

export const batchReportSchema = z.object({
  batchRunId: z.string().min(1),
  sourceDir: z.string().min(1),
  outputDir: z.string().min(1),
  generatedAt: z.string().datetime(),
  processingOrder: z.array(z.string()),
  summary: z.object({
    total: z.number().int().nonnegative(),
    succeeded: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    unsupported: z.number().int().nonnegative(),
    interrupted: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
  }),
  files: z.array(batchFileResultSchema),
  skippedFiles: z.array(z.string()),
  hasDependencyCycle: z.boolean(),
});

export type BatchFileResult = z.infer<typeof batchFileResultSchema>;
export type BatchReport = z.infer<typeof batchReportSchema>;
