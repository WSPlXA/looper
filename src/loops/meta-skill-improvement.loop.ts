import { buildLoopRunner } from "../core/loop/loop-runner.js";
import type { ModelClient } from "../core/model/model-client.js";
import type { SkillRule } from "../agents/skill-improver.agent.js";
import { buildSkillImproverAgent, formatSkillRulesForPrompt } from "../agents/skill-improver.agent.js";
import { runCobolCallGraphToJavaWorkflow } from "../workflows/cobol-call-graph-to-java.workflow.js";

type TranslationFailureInfo = {
  programId: string;
  cobolSnippet: string;
  failureReasons: string[];
  lastAttemptBody?: string;
};

type MetaState = {
  // Immutable config
  sourceDir: string;
  outputDir: string;
  outputClassName: string;
  maxTranslationAttempts: number;
  maxRepairAttempts: number;
  translationConcurrency: number;
  // Grows each round
  accumulatedRules: SkillRule[];
  // Set after each round
  lastRoundCompiled: boolean;
  lastRoundTranslationFailures: TranslationFailureInfo[];
  lastRoundReportPath?: string;
  lastRoundAssembledFilePath?: string;
  roundsCompleted: number;
};

export type MetaMigrationResult = {
  compiled: boolean;
  roundsCompleted: number;
  rulesAccumulated: number;
  lastRoundReportPath: string | undefined;
  lastRoundAssembledFilePath: string | undefined;
  accumulatedRules: SkillRule[];
};

export async function runMetaSkillImprovementLoop(
  input: {
    sourceDir: string;
    outputDir: string;
    outputClassName: string;
    maxRounds?: number;
    maxTranslationAttempts?: number;
    maxRepairAttempts?: number;
    translationConcurrency?: number;
  },
  deps: {
    model: ModelClient;
    runsDir?: string;
    javacTimeoutMs?: number;
    onRoundComplete?: (round: number, compiled: boolean, rulesCount: number) => void;
  },
): Promise<MetaMigrationResult> {
  const maxRounds = input.maxRounds ?? 3;
  const skillImprover = buildSkillImproverAgent(deps.model);

  const runLoop = buildLoopRunner<MetaState>({
    maxAttempts: maxRounds,
    async step(state, round) {
      // From round 2 onward: generate new skill rules from the previous round's failures
      let accumulatedRules = state.accumulatedRules;
      if (round > 1 && state.lastRoundTranslationFailures.length > 0) {
        const existingRulesText = formatSkillRulesForPrompt(accumulatedRules);
        try {
          const improved = await skillImprover({
            failureInfos: state.lastRoundTranslationFailures,
            existingRules: existingRulesText,
            round,
          });
          accumulatedRules = [...accumulatedRules, ...improved.rules];
        } catch (err) {
          // If the SkillImprover fails, continue with existing rules rather than crashing
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`  [meta] SkillImprover failed in round ${round}: ${msg} — using existing rules`);
        }
      }

      const rulesText = formatSkillRulesForPrompt(accumulatedRules);

      const result = await runCobolCallGraphToJavaWorkflow(
        {
          sourceDir: state.sourceDir,
          outputDir: state.outputDir,
          outputClassName: state.outputClassName,
          maxTranslationAttempts: state.maxTranslationAttempts,
          maxRepairAttempts: state.maxRepairAttempts,
          injectedSkillRules: rulesText,
        },
        {
          model: deps.model,
          ...(deps.runsDir !== undefined ? { runsDir: deps.runsDir } : {}),
          ...(deps.javacTimeoutMs !== undefined ? { javacTimeoutMs: deps.javacTimeoutMs } : {}),
          translationConcurrency: state.translationConcurrency,
        },
      );

      // Remap Zod optional fields to exactOptionalPropertyTypes-safe objects
      const lastRoundTranslationFailures: TranslationFailureInfo[] =
        result.state.translationFailures.map(f => ({
          programId: f.programId,
          cobolSnippet: f.cobolSnippet,
          failureReasons: [...f.failureReasons],
          ...(f.lastAttemptBody !== undefined ? { lastAttemptBody: f.lastAttemptBody } : {}),
        }));

      return {
        ...state,
        accumulatedRules,
        lastRoundCompiled: result.state.status === "SUCCESS",
        lastRoundTranslationFailures,
        lastRoundReportPath: result.reportPath,
        ...(result.state.assembledFilePath !== undefined
          ? { lastRoundAssembledFilePath: result.state.assembledFilePath }
          : {}),
        roundsCompleted: state.roundsCompleted + 1,
      };
    },
    evaluator: {
      name: "meta-compilation-evaluator",
      async evaluate(state) {
        if (state.lastRoundCompiled) {
          return { passed: true, reason: "compilation succeeded" };
        }
        const failCount = state.lastRoundTranslationFailures.length;
        return {
          passed: false,
          reason: `compilation failed (${failCount} translation failures in round ${state.roundsCompleted})`,
        };
      },
    },
    onAttempt: async (state, evaluation, round) => {
      deps.onRoundComplete?.(round, evaluation.passed, state.accumulatedRules.length);
    },
  });

  const initial: MetaState = {
    sourceDir: input.sourceDir,
    outputDir: input.outputDir,
    outputClassName: input.outputClassName,
    maxTranslationAttempts: input.maxTranslationAttempts ?? 3,
    maxRepairAttempts: input.maxRepairAttempts ?? 5,
    translationConcurrency: input.translationConcurrency ?? 10,
    accumulatedRules: [],
    lastRoundCompiled: false,
    lastRoundTranslationFailures: [],
    roundsCompleted: 0,
  };

  const { state, evaluation } = await runLoop(initial);

  return {
    compiled: evaluation.passed,
    roundsCompleted: state.roundsCompleted,
    rulesAccumulated: state.accumulatedRules.length,
    lastRoundReportPath: state.lastRoundReportPath,
    lastRoundAssembledFilePath: state.lastRoundAssembledFilePath,
    accumulatedRules: state.accumulatedRules,
  };
}
