import { join } from "node:path";
import type { GraphNode } from "../core/graph/graph.node.js";
import type { MigrationAttempt, MigrationState } from "../schemas/migration-state.schema.js";
import { summarizeCompilerError } from "../skills/repair/parse-compiler-error.skill.js";
import { writeTextFileTool } from "../tools/filesystem.tool.js";
import type { MigrationGraphDependencies } from "./migration-node.dependencies.js";
import { runTracedCall } from "../core/trace/traced-call.js";

export function buildCompileNode(dependencies: Pick<MigrationGraphDependencies, "javac">): GraphNode<MigrationState> {
  return {
    name: "compile",
    async run(state, context) {
      if (!state.currentJavaCode) throw new Error("CompileNode requires current Java code");
      const javaCode = state.currentJavaCode;
      const attemptNo = state.attempts.length + 1;
      if (attemptNo > state.maxAttempts) {
        const reason = `Compilation did not succeed after ${state.maxAttempts} attempts`;
        return { state: { ...state, status: "FAILED", currentNode: "compile", failureReason: reason, terminal: { status: "FAILED", reason } }, next: "report", status: "SUCCEEDED" };
      }
      const compileDir = join(state.runDir, "output");
      const liveJavaPath = join(compileDir, `${state.className}.java`);
      const snapshotPath = join(state.runDir, "attempts", `attempt-${attemptNo}.java`);
      const startedAt = new Date().toISOString();
      await runTracedCall(context.trace, "tool.call", { tool: writeTextFileTool.name, operation: "snapshot", attemptNo }, () => Promise.all([
        writeTextFileTool.execute({ path: snapshotPath, content: javaCode }),
        writeTextFileTool.execute({ path: liveJavaPath, content: javaCode }),
      ]).then(() => undefined));
      const compileStarted = performance.now();
      const compileResult = await runTracedCall(context.trace, "tool.call", { tool: dependencies.javac.name, attemptNo }, () => dependencies.javac.execute({ javaFilePath: liveJavaPath, outputDir: compileDir }));
      const durationMs = performance.now() - compileStarted;
      await context.trace("compile.result", { attemptNo, durationMs, exitCode: compileResult.exitCode, stderrBytes: Buffer.byteLength(compileResult.stderr, "utf8") });
      const attempt: MigrationAttempt = {
        attemptNo,
        loopName: "compile-repair-graph",
        javaCode,
        javaFilePath: snapshotPath,
        compileResult,
        durationMs,
        ...(compileResult.success ? {} : { errorSummary: summarizeCompilerError(compileResult.stderr) }),
        ...(state.pendingRepairAction ? { repairAction: state.pendingRepairAction } : {}),
        startedAt,
        endedAt: new Date().toISOString(),
      };
      const { pendingRepairAction: _, ...stateWithoutPendingAction } = state;
      const nextState: MigrationState = {
        ...stateWithoutPendingAction,
        attempts: [...state.attempts, attempt],
        status: compileResult.success && compileResult.exitCode === 0 ? "COMPILE_PASSED" : "COMPILING",
        currentNode: "compile",
      };
      return { state: nextState, next: compileResult.success && compileResult.exitCode === 0 ? "verify" : "classifyError", status: "SUCCEEDED" };
    },
  };
}
