import type { AppConfig } from "../../../config/env.js";
import { DeepSeekClient } from "../../../models/deepseek/deepseek-client.js";
import { runMetaSkillImprovementLoop } from "../../../loops/meta-skill-improvement.loop.js";

export async function migrateProgramMetaCommand(args: string[], config: AppConfig): Promise<number> {
  const [sourceDir, outputDir, outputClassName, maxRoundsStr, translationAttemptsStr, repairAttemptsStr, concurrencyStr] = args;
  if (!sourceDir || !outputDir || !outputClassName) {
    console.error(
      "Usage: npm run migrate-program-meta -- <source-dir> <output-dir> <ClassName>" +
      " [max-rounds] [translation-attempts] [repair-attempts] [concurrency]",
    );
    return 2;
  }

  const maxRounds = maxRoundsStr === undefined ? 3 : Number(maxRoundsStr);
  const maxTranslationAttempts = translationAttemptsStr === undefined ? 3 : Number(translationAttemptsStr);
  const maxRepairAttempts = repairAttemptsStr === undefined ? 5 : Number(repairAttemptsStr);
  const translationConcurrency = concurrencyStr === undefined ? 10 : Number(concurrencyStr);

  if (!Number.isInteger(maxRounds) || maxRounds < 1) { console.error("max-rounds must be a positive integer"); return 2; }
  if (!Number.isInteger(maxTranslationAttempts) || maxTranslationAttempts < 1) { console.error("translation-attempts must be a positive integer"); return 2; }
  if (!Number.isInteger(maxRepairAttempts) || maxRepairAttempts < 1) { console.error("repair-attempts must be a positive integer"); return 2; }
  if (!Number.isInteger(translationConcurrency) || translationConcurrency < 1) { console.error("concurrency must be a positive integer"); return 2; }

  const model = new DeepSeekClient({
    apiKey: config.DEEPSEEK_API_KEY,
    baseUrl: config.DEEPSEEK_BASE_URL,
    model: config.DEEPSEEK_MODEL,
    timeoutMs: config.MODEL_TIMEOUT_MS,
  });

  console.log(`Meta skill improvement loop`);
  console.log(`  Source:              ${sourceDir}`);
  console.log(`  Output class:        ${outputClassName}.java → ${outputDir}`);
  console.log(`  Max rounds:          ${maxRounds}`);
  console.log(`  Translation attempts: ${maxTranslationAttempts} / repair attempts: ${maxRepairAttempts} / concurrency: ${translationConcurrency}`);
  console.log();

  const started = performance.now();
  const result = await runMetaSkillImprovementLoop(
    { sourceDir, outputDir, outputClassName, maxRounds, maxTranslationAttempts, maxRepairAttempts, translationConcurrency },
    {
      model,
      runsDir: config.RUNS_DIR,
      javacTimeoutMs: config.JAVAC_TIMEOUT_MS,
      onRoundComplete: (round, compiled, rulesCount) => {
        const icon = compiled ? "✓" : "✗";
        const elapsed = Math.round(performance.now() - started);
        console.log(`  Round ${round}: ${icon} ${compiled ? "COMPILED" : "failed"} — rules accumulated: ${rulesCount} — ${elapsed}ms elapsed`);
      },
    },
  );

  const elapsed = Math.round(performance.now() - started);
  const icon = result.compiled ? "✓" : "✗";
  console.log();
  console.log(`${icon} ${result.compiled ? "SUCCESS" : "FAILED"} — ${elapsed}ms`);
  console.log(`  Rounds completed:    ${result.roundsCompleted}`);
  console.log(`  Rules accumulated:   ${result.rulesAccumulated}`);
  if (result.lastRoundReportPath) console.log(`  Report:  ${result.lastRoundReportPath}`);
  if (result.lastRoundAssembledFilePath) console.log(`  Output:  ${result.lastRoundAssembledFilePath}`);

  if (result.accumulatedRules.length > 0) {
    console.log();
    console.log("Learned rules:");
    for (const rule of result.accumulatedRules) {
      console.log(`  • ${rule.title}: ${rule.instruction}`);
    }
  }

  return result.compiled ? 0 : 1;
}
