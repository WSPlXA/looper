import type { AppConfig } from "../../../config/env.js";
import { DeepSeekClient } from "../../../models/deepseek/deepseek-client.js";
import { runCobolCallGraphToJavaWorkflow } from "../../../workflows/cobol-call-graph-to-java.workflow.js";

export async function migrateProgramCommand(args: string[], config: AppConfig): Promise<number> {
  const [sourceDir, outputDir, outputClassName, translationAttempts, repairAttempts, concurrency] = args;
  if (!sourceDir || !outputDir || !outputClassName) {
    console.error("Usage: npm run migrate-program -- <source-dir> <output-dir> <ClassName> [translation-attempts] [repair-attempts] [concurrency]");
    return 2;
  }

  const maxTranslationAttempts = translationAttempts === undefined ? 3 : Number(translationAttempts);
  const maxRepairAttempts = repairAttempts === undefined ? 5 : Number(repairAttempts);
  const translationConcurrency = concurrency === undefined ? 10 : Number(concurrency);
  if (!Number.isInteger(maxTranslationAttempts) || maxTranslationAttempts < 1) {
    console.error("translation-attempts must be a positive integer");
    return 2;
  }
  if (!Number.isInteger(maxRepairAttempts) || maxRepairAttempts < 1) {
    console.error("repair-attempts must be a positive integer");
    return 2;
  }
  if (!Number.isInteger(translationConcurrency) || translationConcurrency < 1) {
    console.error("concurrency must be a positive integer");
    return 2;
  }

  const model = new DeepSeekClient({
    apiKey: config.DEEPSEEK_API_KEY,
    baseUrl: config.DEEPSEEK_BASE_URL,
    model: config.DEEPSEEK_MODEL,
    timeoutMs: config.MODEL_TIMEOUT_MS,
  });

  console.log(`Translating call graph in: ${sourceDir}`);
  console.log(`Output class: ${outputClassName}.java → ${outputDir}`);
  console.log(`Translation attempts per subprogram: ${maxTranslationAttempts}, repair attempts: ${maxRepairAttempts}, concurrency: ${translationConcurrency}`);
  console.log();

  const started = performance.now();
  const result = await runCobolCallGraphToJavaWorkflow(
    { sourceDir, outputDir, outputClassName, maxTranslationAttempts, maxRepairAttempts },
    { model, runsDir: config.RUNS_DIR, javacTimeoutMs: config.JAVAC_TIMEOUT_MS, translationConcurrency },
  );
  const elapsed = Math.round(performance.now() - started);

  const s = result.state;
  const icon = s.status === "SUCCESS" ? "✓" : "✗";
  console.log(`${icon} ${s.status} — ${elapsed}ms`);
  console.log(`  Subprograms scanned:   ${s.subprograms.length}`);
  console.log(`  Methods translated:    ${s.translatedMethods.length}`);
  console.log(`  Translations failed:   ${s.failedTranslations.length}`);
  console.log(`  Compile attempts:      ${s.compileAttempts.length}`);
  if (s.hasCycle) console.log("  WARNING: call graph contains a cycle — translation order approximated");
  if (s.failureReason) console.log(`  Reason: ${s.failureReason}`);
  console.log(`  Run ID:  ${s.runId}`);
  console.log(`  Report:  ${result.reportPath}`);
  if (s.assembledFilePath) console.log(`  Output:  ${s.assembledFilePath}`);

  return s.status === "SUCCESS" ? 0 : 1;
}
