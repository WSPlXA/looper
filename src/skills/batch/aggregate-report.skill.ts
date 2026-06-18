import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { batchReportSchema, type BatchFileResult, type BatchReport } from "../../schemas/batch-report.schema.js";

export async function writeAggregateReport(input: {
  batchRunDir: string;
  batchRunId: string;
  sourceDir: string;
  outputDir: string;
  processingOrder: string[];
  files: BatchFileResult[];
  skippedFiles: string[];
  hasDependencyCycle: boolean;
}): Promise<string> {
  await mkdir(input.batchRunDir, { recursive: true });

  const report: BatchReport = batchReportSchema.parse({
    batchRunId: input.batchRunId,
    sourceDir: input.sourceDir,
    outputDir: input.outputDir,
    generatedAt: new Date().toISOString(),
    processingOrder: input.processingOrder,
    summary: {
      total: input.files.length + input.skippedFiles.length,
      succeeded: input.files.filter(r => r.status === "SUCCESS").length,
      failed: input.files.filter(r => r.status === "FAILED").length,
      unsupported: input.files.filter(r => r.status === "UNSUPPORTED").length,
      interrupted: input.files.filter(r => r.status === "INTERRUPTED").length,
      skipped: input.skippedFiles.length,
    },
    files: input.files,
    skippedFiles: input.skippedFiles,
    hasDependencyCycle: input.hasDependencyCycle,
  });

  const reportPath = join(input.batchRunDir, "batch-report.json");
  await writeFile(reportPath, JSON.stringify(report, null, 2), "utf-8");
  return reportPath;
}
