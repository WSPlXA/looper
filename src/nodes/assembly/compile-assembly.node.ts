import { join } from "node:path";
import type { GraphNode } from "../../core/graph/graph.node.js";
import type { AssemblyMigrationState, ProgramCompileAttempt } from "../../schemas/assembly-state.schema.js";
import { runTracedCall } from "../../core/trace/traced-call.js";
import type { AssemblyGraphDependencies } from "./assembly-node.dependencies.js";

export function buildCompileAssemblyNode(
  deps: Pick<AssemblyGraphDependencies, "javac">,
): GraphNode<AssemblyMigrationState> {
  return {
    name: "compileAssembly",
    async run(state, context) {
      if (!state.assembledFilePath || !state.assembledSource) {
        return {
          state: { ...state, status: "FAILED", failureReason: "compileAssembly: no assembled source available" },
          next: "reportAssembly",
          status: "SUCCEEDED",
        };
      }

      const attemptNo = state.compileAttempts.length + 1;
      const outputDir = join(state.runDir, "output");
      const startedAt = new Date().toISOString();

      const compileResult = await runTracedCall(
        context.trace,
        "tool.call",
        { tool: "javac", attemptNo },
        () => deps.javac.execute({ javaFilePath: state.assembledFilePath!, outputDir }),
      );

      const attempt: ProgramCompileAttempt = {
        attemptNo,
        javaFilePath: state.assembledFilePath,
        success: compileResult.success,
        exitCode: compileResult.exitCode,
        stdout: compileResult.stdout,
        stderr: compileResult.stderr,
        startedAt,
        endedAt: new Date().toISOString(),
      };

      const nextCompileAttempts = [...state.compileAttempts, attempt];

      if (compileResult.success && compileResult.exitCode === 0) {
        await context.trace("compile.passed", { attemptNo });
        return {
          state: { ...state, compileAttempts: nextCompileAttempts, status: "SUCCESS" },
          next: "reportAssembly",
          status: "SUCCEEDED",
        };
      }

      await context.trace("compile.failed", { attemptNo, exitCode: compileResult.exitCode });

      // Budget exceeded → go straight to report
      if (nextCompileAttempts.length >= state.maxRepairAttempts) {
        return {
          state: {
            ...state,
            compileAttempts: nextCompileAttempts,
            status: "FAILED",
            failureReason: `Compilation did not succeed after ${state.maxRepairAttempts} repair attempts`,
          },
          next: "reportAssembly",
          status: "SUCCEEDED",
        };
      }

      return {
        state: { ...state, compileAttempts: nextCompileAttempts, status: "COMPILING" },
        next: "classifyAssemblyError",
        status: "SUCCEEDED",
      };
    },
  };
}
