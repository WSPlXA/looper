import type { AppConfig } from "../../../config/env.js";
import { DeepSeekClient } from "../../../models/deepseek/deepseek-client.js";
import { runCobolToJavaSingleFileWorkflow } from "../../../workflows/cobol-to-java-single-file.workflow.js";

export async function migrateOneCommand(args: string[], config: AppConfig): Promise<number> {
  const [sourceFile, outputDir, className, attempts] = args;
  if (!sourceFile || !outputDir || !className) {
    console.error("Usage: npm run migrate -- <source.cob> <output-dir> <ClassName> [max-attempts]");
    return 2;
  }
  const maxAttempts = attempts === undefined ? 5 : Number(attempts);
  const model = new DeepSeekClient({
    apiKey: config.DEEPSEEK_API_KEY,
    baseUrl: config.DEEPSEEK_BASE_URL,
    model: config.DEEPSEEK_MODEL,
    timeoutMs: config.MODEL_TIMEOUT_MS,
  });
  const result = await runCobolToJavaSingleFileWorkflow(
    { sourceFile, outputDir, className, maxAttempts },
    { model, runsDir: config.RUNS_DIR, javacTimeoutMs: config.JAVAC_TIMEOUT_MS },
  );
  console.log(`Run ID: ${result.state.runId}`);
  console.log(`Source: ${result.state.sourceFile}`);
  console.log(`Class: ${result.state.className}`);
  console.log(`Status: ${result.state.status}`);
  console.log(`Attempts: ${result.state.attempts.length}`);
  console.log(`Report: ${result.reportPath}`);
  return result.state.status === "SUCCESS" ? 0 : 1;
}
