import type { GraphNode } from "../../core/graph/graph.node.js";
import type { JavaMethodTranslation, AssemblyMigrationState } from "../../schemas/assembly-state.schema.js";
import { runSubprogramTranslationLoop } from "../../loops/subprogram-translation.loop.js";
import { runConcurrent } from "../../core/util/concurrency.js";
import { runTracedCall } from "../../core/trace/traced-call.js";
import type { AssemblyGraphDependencies } from "./assembly-node.dependencies.js";

const DEFAULT_CONCURRENCY = 10;

export function buildTranslateSubprogramsNode(
  deps: Pick<AssemblyGraphDependencies, "model" | "translationConcurrency">,
): GraphNode<AssemblyMigrationState> {
  return {
    name: "translateSubprograms",
    async run(state, context) {
      const concurrency = deps.translationConcurrency ?? DEFAULT_CONCURRENCY;
      const subprogramMap = new Map(state.subprograms.map(s => [s.programId, s]));
      const skillRules = state.injectedSkillRules;

      await context.trace("translate.start", { total: state.callOrder.length, concurrency });

      type SlotResult =
        | { ok: true; method: JavaMethodTranslation }
        | { ok: false; programId: string; failureReasons: string[]; lastAttemptBody?: string; cobolSnippet: string };

      const slotResults = await runConcurrent(
        state.callOrder,
        async (programId) => {
          const subprogram = subprogramMap.get(programId);
          if (!subprogram) return null;

          try {
            const loopResult = await runTracedCall(
              context.trace,
              "model.call",
              { operation: "translateSubprogram", programId },
              () => runSubprogramTranslationLoop(subprogram, "", deps.model, state.maxTranslationAttempts, skillRules),
            );

            if (loopResult.ok) {
              await context.trace("translation.succeeded", { programId, attempts: loopResult.attempts });
              return { ok: true as const, method: { programId, ...loopResult.method, attempts: loopResult.attempts } };
            }
            await context.trace("translation.failed", { programId, attempts: loopResult.attempts, reasons: loopResult.failureReasons });
            return {
              ok: false as const,
              programId,
              failureReasons: loopResult.failureReasons,
              lastAttemptBody: loopResult.lastAttemptBody,
              cobolSnippet: subprogram.expandedSource.slice(0, 600),
            };
          } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            await context.trace("translation.error", { programId, error: reason });
            return {
              ok: false as const,
              programId,
              failureReasons: [reason],
              cobolSnippet: subprogram.expandedSource.slice(0, 600),
            };
          }
        },
        concurrency,
      );

      const translatedMethods: JavaMethodTranslation[] = [];
      const failedTranslations: string[] = [];
      const translationFailures: AssemblyMigrationState["translationFailures"] = [];

      for (const result of slotResults) {
        if (!result) continue;
        if (result.ok) {
          translatedMethods.push(result.method);
        } else {
          failedTranslations.push(result.programId);
          translationFailures.push({
            programId: result.programId,
            cobolSnippet: result.cobolSnippet,
            failureReasons: result.failureReasons,
            ...(result.lastAttemptBody ? { lastAttemptBody: result.lastAttemptBody } : {}),
          });
        }
      }

      await context.trace("translate.complete", { translated: translatedMethods.length, failed: failedTranslations.length });

      if (translatedMethods.length === 0) {
        return {
          state: { ...state, translatedMethods, failedTranslations, translationFailures, status: "FAILED", failureReason: "All subprogram translations failed" },
          next: "reportAssembly",
          status: "SUCCEEDED",
        };
      }

      return {
        state: { ...state, translatedMethods, failedTranslations, translationFailures, status: "TRANSLATING" },
        next: "assembleProgram",
        status: "SUCCEEDED",
      };
    },
  };
}
