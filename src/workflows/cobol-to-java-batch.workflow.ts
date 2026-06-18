import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { resolve, join, basename } from "node:path";
import type { ModelClient } from "../core/model/model-client.js";
import { scanProjectDirectory, type CobolFileEntry } from "../skills/batch/scan-project.skill.js";
import { buildDependencyGraph } from "../skills/batch/build-dependency-graph.skill.js";
import { writeAggregateReport } from "../skills/batch/aggregate-report.skill.js";
import { runCobolToJavaSingleFileWorkflow } from "./cobol-to-java-single-file.workflow.js";
import type { BatchFileResult } from "../schemas/batch-report.schema.js";

export type BatchWorkflowResult = {
  batchRunId: string;
  batchRunDir: string;
  batchReportPath: string;
  total: number;
  succeeded: number;
  failed: number;
  unsupported: number;
  interrupted: number;
  skipped: number;
};

function terminalStatus(status: string): BatchFileResult["status"] {
  if (status === "SUCCESS" || status === "FAILED" || status === "UNSUPPORTED" || status === "INTERRUPTED") {
    return status;
  }
  return "FAILED";
}

function buildBatchRunId(): string {
  const prefix = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  return `batch-${prefix}-${randomUUID().slice(0, 8)}`;
}

export async function runCobolToJavaBatchWorkflow(
  input: {
    sourceDir: string;
    outputDir: string;
    maxAttemptsPerFile?: number;
  },
  dependencies: {
    model: ModelClient;
    runsDir?: string;
    javacTimeoutMs?: number;
    onFileStart?: (sourceFile: string, className: string, index: number, total: number) => void;
    onFileComplete?: (result: BatchFileResult, index: number, total: number) => void;
  },
): Promise<BatchWorkflowResult> {
  const sourceDir = resolve(input.sourceDir);
  const outputDir = resolve(input.outputDir);
  const runsDir = resolve(dependencies.runsDir ?? "./runs");
  const maxAttemptsPerFile = input.maxAttemptsPerFile ?? 5;

  const batchRunId = buildBatchRunId();
  const batchRunDir = join(runsDir, batchRunId);
  await mkdir(batchRunDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });

  // 1. Scan
  const { files, skipped } = await scanProjectDirectory(sourceDir);

  // 2. Dependency ordering
  const { order, hasCycle } = await buildDependencyGraph(files.map(f => f.sourceFile));
  const fileMap = new Map(files.map(f => [f.sourceFile, f]));
  const orderedFiles: CobolFileEntry[] = [];
  for (const p of order) {
    const entry = fileMap.get(p);
    if (entry) orderedFiles.push(entry);
  }

  // 3. Sequential migration — concurrency is intentionally 1
  const fileResults: BatchFileResult[] = [];
  for (const [i, { sourceFile, className }] of orderedFiles.entries()) {
    const started = performance.now();
    dependencies.onFileStart?.(sourceFile, className, i, orderedFiles.length);
    try {
      const result = await runCobolToJavaSingleFileWorkflow(
        { sourceFile, outputDir, className, maxAttempts: maxAttemptsPerFile },
        {
          model: dependencies.model,
          runsDir: batchRunDir,
          ...(dependencies.javacTimeoutMs !== undefined ? { javacTimeoutMs: dependencies.javacTimeoutMs } : {}),
        },
      );
      const fileResult: BatchFileResult = {
        sourceFile,
        className,
        runId: result.state.runId,
        status: terminalStatus(result.state.terminal?.status ?? result.state.status),
        attempts: result.state.attempts.length,
        reportPath: result.reportPath,
        durationMs: Math.round(performance.now() - started),
        failureReason: result.state.failureReason,
      };
      fileResults.push(fileResult);
      dependencies.onFileComplete?.(fileResult, i, orderedFiles.length);
    } catch (error) {
      const fileResult: BatchFileResult = {
        sourceFile,
        className,
        runId: "unknown",
        status: "FAILED",
        attempts: 0,
        durationMs: Math.round(performance.now() - started),
        failureReason: error instanceof Error ? error.message : String(error),
      };
      fileResults.push(fileResult);
      dependencies.onFileComplete?.(fileResult, i, orderedFiles.length);
    }
  }

  // 4. Aggregate report
  const batchReportPath = await writeAggregateReport({
    batchRunDir,
    batchRunId,
    sourceDir,
    outputDir,
    processingOrder: order.map(p => basename(p)),
    files: fileResults,
    skippedFiles: skipped,
    hasDependencyCycle: hasCycle,
  });

  return {
    batchRunId,
    batchRunDir,
    batchReportPath,
    total: orderedFiles.length,
    succeeded: fileResults.filter(r => r.status === "SUCCESS").length,
    failed: fileResults.filter(r => r.status === "FAILED").length,
    unsupported: fileResults.filter(r => r.status === "UNSUPPORTED").length,
    interrupted: fileResults.filter(r => r.status === "INTERRUPTED").length,
    skipped: skipped.length,
  };
}
