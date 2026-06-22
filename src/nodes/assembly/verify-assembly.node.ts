import { access } from "node:fs/promises";
import type { GraphNode } from "../../core/graph/graph.node.js";
import type { AssemblyMigrationState } from "../../schemas/assembly-state.schema.js";

async function allFilesExist(paths: readonly string[]): Promise<boolean> {
  try {
    await Promise.all(paths.map(path => access(path)));
    return true;
  } catch {
    return false;
  }
}

export const verifyAssemblyNode: GraphNode<AssemblyMigrationState> = {
  name: "verifyAssembly",
  async run(state, context) {
    const compilePassed = state.compileAttempts.at(-1)?.success === true;
    const generatedFilesPresent = state.generatedSourceFiles.length > 0
      && await allFilesExist(state.generatedSourceFiles);
    const programFileCountMatches = state.targetProfile === "spring-boot-multi-class-v1"
      ? Object.keys(state.programFilePaths).length === state.translatedMethods.length
      : state.generatedSourceFiles.length === 1;
    const passed = compilePassed && generatedFilesPresent && programFileCountMatches;
    const reason = passed
      ? "Compilation and deterministic generated-project checks passed"
      : `compilePassed=${compilePassed}, generatedFilesPresent=${generatedFilesPresent}, programFileCountMatches=${programFileCountMatches}`;

    await context.trace("verify.assembly", {
      compilePassed,
      generatedFilesPresent,
      programFileCountMatches,
      targetProfile: state.targetProfile,
    });

    return {
      state: {
        ...state,
        status: passed ? "SUCCESS" : "FAILED",
        verification: { compilePassed, generatedFilesPresent, programFileCountMatches, reason },
        ...(!passed ? { failureReason: reason } : {}),
      },
      next: "reportAssembly",
      status: "SUCCEEDED",
    };
  },
};
