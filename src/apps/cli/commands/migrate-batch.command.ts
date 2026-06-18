import { basename } from "node:path";
import type { AppConfig } from "../../../config/env.js";
import { DeepSeekClient } from "../../../models/deepseek/deepseek-client.js";
import { runCobolToJavaBatchWorkflow } from "../../../workflows/cobol-to-java-batch.workflow.js";
import type { BatchFileResult } from "../../../schemas/batch-report.schema.js";

const STATUS_ICON: Record<BatchFileResult["status"], string> = {
  SUCCESS: "✓",
  FAILED: "✗",
  UNSUPPORTED: "~",
  INTERRUPTED: "!",
};

export async function migrateBatchCommand(args: string[], config: AppConfig): Promise<number> {
  const [sourceDir, outputDir, attempts] = args;
  if (!sourceDir || !outputDir) {
    console.error("Usage: npm run migrate-batch -- <source-dir> <output-dir> [max-attempts-per-file]");
    return 2;
  }
  const maxAttemptsPerFile = attempts === undefined ? 5 : Number(attempts);
  if (!Number.isInteger(maxAttemptsPerFile) || maxAttemptsPerFile < 1) {
    console.error("max-attempts-per-file must be a positive integer");
    return 2;
  }

  const model = new DeepSeekClient({
    apiKey: config.DEEPSEEK_API_KEY,
    baseUrl: config.DEEPSEEK_BASE_URL,
    model: config.DEEPSEEK_MODEL,
    timeoutMs: config.MODEL_TIMEOUT_MS,
  });

  console.log(`Scanning: ${sourceDir}`);

  const result = await runCobolToJavaBatchWorkflow(
    { sourceDir, outputDir, maxAttemptsPerFile },
    {
      model,
      runsDir: config.RUNS_DIR,
      javacTimeoutMs: config.JAVAC_TIMEOUT_MS,
      onFileStart(_sourceFile, _className, index, total) {
        process.stdout.write(`[${index + 1}/${total}] `);
      },
      onFileComplete(fileResult, _index, _total) {
        const icon = STATUS_ICON[fileResult.status];
        const attempts = fileResult.attempts === 1 ? "1 attempt" : `${fileResult.attempts} attempts`;
        console.log(
          `${icon} ${basename(fileResult.sourceFile)} → ${fileResult.className}` +
          ` (${fileResult.status}, ${attempts}, ${fileResult.durationMs}ms)`,
        );
      },
    },
  );

  console.log(`\nBatch Run ID: ${result.batchRunId}`);
  console.log(
    `Total: ${result.total}  ` +
    `Succeeded: ${result.succeeded}  ` +
    `Failed: ${result.failed}  ` +
    `Unsupported: ${result.unsupported}  ` +
    `Interrupted: ${result.interrupted}  ` +
    `Skipped: ${result.skipped}`,
  );
  console.log(`Report: ${result.batchReportPath}`);

  return result.succeeded === result.total ? 0 : 1;
}
