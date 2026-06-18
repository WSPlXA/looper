import type { GraphNode } from "../../core/graph/graph.node.js";
import type { JavaMethodTranslation, AssemblyMigrationState } from "../../schemas/assembly-state.schema.js";
import { runSubprogramTranslationLoop } from "../../loops/subprogram-translation.loop.js";
import { assembleJavaClass } from "../../skills/java/assemble-java-class.skill.js";
import { writeTextFileTool } from "../../tools/filesystem.tool.js";
import { runTracedCall } from "../../core/trace/traced-call.js";
import type { AssemblyGraphDependencies } from "./assembly-node.dependencies.js";

/** Parse javac stderr → set of 1-based line numbers that have errors */
function parseErrorLines(stderr: string): Set<number> {
  const lines = new Set<number>();
  // javac format: "path/File.java:42: error: ..."
  for (const m of stderr.matchAll(/:(\d+): /g)) {
    const n = Number(m[1]);
    if (n > 0) lines.add(n);
  }
  return lines;
}

/**
 * Given error line numbers and the method-start map, return the method names
 * whose bodies contain at least one error line.
 * The method starting at or before an error line and closest to it owns the error.
 */
function findFailingMethods(
  errorLines: Set<number>,
  methodLineStarts: Record<string, number>,
): Set<string> {
  // Build sorted list of [startLine, methodName]
  const sorted = Object.entries(methodLineStarts).sort((a, b) => a[1] - b[1]);
  const failing = new Set<string>();
  for (const errLine of errorLines) {
    // Find the method whose start is <= errLine and closest
    let owner: string | undefined;
    for (const [name, start] of sorted) {
      if (start <= errLine) owner = name;
      else break;
    }
    if (owner) failing.add(owner);
  }
  return failing;
}

export function buildRepairAssemblyNode(
  deps: Pick<AssemblyGraphDependencies, "model">,
): GraphNode<AssemblyMigrationState> {
  return {
    name: "repairAssembly",
    async run(state, context) {
      const lastAttempt = state.compileAttempts.at(-1);
      if (!lastAttempt || !state.assembledFilePath || !state.assembledMethodRanges) {
        throw new Error("repairAssembly: missing compile attempt or method ranges in state");
      }

      const errorLines = parseErrorLines(lastAttempt.stderr);
      const failingMethodNames = findFailingMethods(errorLines, state.assembledMethodRanges);

      await context.trace("repair.start", {
        errorLineCount: errorLines.size,
        failingMethods: [...failingMethodNames],
      });

      // Map methodName → programId
      const methodToProgramId = new Map(
        state.translatedMethods.map(m => [m.methodName, m.programId]),
      );
      const subprogramMap = new Map(state.subprograms.map(s => [s.programId, s]));

      // Determine which programIds need re-translation
      const failingProgramIds = new Set<string>();
      for (const methodName of failingMethodNames) {
        const programId = methodToProgramId.get(methodName);
        if (programId) failingProgramIds.add(programId);
      }

      // If we can't map errors to specific methods, fall back to re-translating all
      const programIdsToRetranslate =
        failingProgramIds.size > 0
          ? [...failingProgramIds]
          : state.translatedMethods.map(m => m.programId);

      await context.trace("repair.retranslate", { programIds: programIdsToRetranslate });

      // Re-translate only the failing subprograms
      const updatedMethods = new Map(state.translatedMethods.map(m => [m.programId, m]));

      for (const programId of programIdsToRetranslate) {
        const subprogram = subprogramMap.get(programId);
        if (!subprogram) continue;

        const errorContext = lastAttempt.stderr.slice(0, 800);
        const loopResult = await runTracedCall(
          context.trace,
          "model.call",
          { operation: "retranslateSubprogram", programId },
          () => runSubprogramTranslationLoop(subprogram, "", deps.model, state.maxTranslationAttempts, errorContext),
        );

        if (loopResult.ok) {
          const updated: JavaMethodTranslation = {
            programId,
            ...loopResult.method,
            attempts: loopResult.attempts,
          };
          updatedMethods.set(programId, updated);
          await context.trace("repair.retranslated", { programId });
        } else {
          await context.trace("repair.retranslation-failed", { programId, reason: loopResult.reason });
        }
      }

      // Preserve original callOrder for method ordering
      const translatedMethods = state.callOrder
        .map(id => updatedMethods.get(id))
        .filter((m): m is JavaMethodTranslation => m !== undefined);

      // Re-assemble deterministically
      const entryProgramId =
        state.callOrder.at(-1) ??
        translatedMethods.at(-1)?.programId ??
        state.outputClassName;

      const { source: newSource, methodLineStarts } = assembleJavaClass(
        state.outputClassName,
        entryProgramId,
        translatedMethods,
        state.failedTranslations,
      );

      await runTracedCall(
        context.trace,
        "tool.call",
        { tool: "write-text-file", path: state.assembledFilePath },
        () => writeTextFileTool.execute({ path: state.assembledFilePath!, content: newSource }),
      );

      // Mark last compile attempt with repair notes
      const updatedAttempts = state.compileAttempts.map((a, i) =>
        i === state.compileAttempts.length - 1
          ? { ...a, repairNotes: `Retranslated: ${programIdsToRetranslate.join(", ")}` }
          : a,
      );

      const { pendingAssemblyError: _, ...stateWithoutPending } = state;
      return {
        state: {
          ...stateWithoutPending,
          translatedMethods,
          assembledSource: newSource,
          assembledMethodRanges: methodLineStarts,
          compileAttempts: updatedAttempts,
          status: "REPAIRING",
        },
        next: "compileAssembly",
        status: "SUCCEEDED",
      };
    },
  };
}
