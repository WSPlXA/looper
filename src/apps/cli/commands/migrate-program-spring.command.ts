import type { AppConfig } from "../../../config/env.js";
import { DeepSeekClient } from "../../../models/deepseek/deepseek-client.js";
import { runCobolCallGraphToJavaWorkflow } from "../../../workflows/cobol-call-graph-to-java.workflow.js";

export async function migrateProgramSpringCommand(args: string[], config: AppConfig): Promise<number> {
  const [sourceDir, outputDir, outputClassName, packageName = "generated.cobol", translationAttempts, repairAttempts, concurrency, springBootVersion = "3.4.5"] = args;
  if (!sourceDir || !outputDir || !outputClassName) {
    console.error("Usage: npm run migrate-program-spring -- <source-dir> <output-dir> <ClassName> [package] [translation-attempts] [repair-attempts] [concurrency] [spring-boot-version]");
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

  console.log(`Translating call graph into Spring Boot project: ${sourceDir}`);
  console.log(`  Application: ${packageName}.${outputClassName}Application`);
  console.log(`  Spring Boot: ${springBootVersion}`);

  const result = await runCobolCallGraphToJavaWorkflow(
    {
      sourceDir,
      outputDir,
      outputClassName,
      maxTranslationAttempts,
      maxRepairAttempts,
      targetProfile: "spring-boot-multi-class-v1",
      targetPackage: packageName,
      springBootVersion,
    },
    {
      model,
      runsDir: config.RUNS_DIR,
      javacTimeoutMs: config.JAVAC_TIMEOUT_MS,
      translationConcurrency,
    },
  );

  const state = result.state;
  console.log(`${state.status === "SUCCESS" ? "SUCCESS" : "FAILED"}`);
  console.log(`  Programs: ${state.translatedMethods.length}/${state.subprograms.length}`);
  console.log(`  Generated files: ${state.generatedSourceFiles.length}`);
  console.log(`  Compile attempts: ${state.compileAttempts.length}`);
  console.log(`  Project: ${state.generatedProjectDir ?? "not generated"}`);
  console.log(`  Report: ${result.reportPath}`);
  if (state.failureReason) console.log(`  Reason: ${state.failureReason}`);
  return state.status === "SUCCESS" ? 0 : 1;
}
