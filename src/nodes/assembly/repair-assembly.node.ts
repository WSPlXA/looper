import type { GraphNode } from "../../core/graph/graph.node.js";
import type { AssemblyMigrationState } from "../../schemas/assembly-state.schema.js";
import { buildAssemblyRepairAgent } from "../../agents/assembly-repair.agent.js";
import { writeTextFileTool } from "../../tools/filesystem.tool.js";
import { runTracedCall } from "../../core/trace/traced-call.js";
import type { AssemblyGraphDependencies } from "./assembly-node.dependencies.js";

export function buildRepairAssemblyNode(
  deps: Pick<AssemblyGraphDependencies, "model">,
): GraphNode<AssemblyMigrationState> {
  const repair = buildAssemblyRepairAgent(deps.model);
  return {
    name: "repairAssembly",
    async run(state, context) {
      if (!state.assembledSource || !state.assembledFilePath || !state.pendingAssemblyError) {
        throw new Error("repairAssembly: missing assembled source or pending error classification");
      }
      const attemptNo = state.compileAttempts.length + 1;
      const errorInfo = state.pendingAssemblyError;

      const action = await runTracedCall(
        context.trace,
        "model.call",
        { operation: "repairAssembly", errorClass: errorInfo.errorClass, attemptNo },
        () => repair({
          className: state.outputClassName,
          currentSource: state.assembledSource!,
          compilerStderr: `${errorInfo.errorClass}: ${errorInfo.repairHint}\n\n${errorInfo.summary}`,
          attemptNo,
        }),
      );

      await runTracedCall(context.trace, "tool.call", { tool: "write-text-file", path: state.assembledFilePath }, () =>
        writeTextFileTool.execute({ path: state.assembledFilePath!, content: action.content }),
      );

      // Mark last compile attempt with repair notes
      const updatedAttempts = state.compileAttempts.map((a, i) =>
        i === state.compileAttempts.length - 1
          ? { ...a, repairNotes: errorInfo.repairHint }
          : a,
      );

      const { pendingAssemblyError: _, ...stateWithoutPending } = state;
      return {
        state: {
          ...stateWithoutPending,
          assembledSource: action.content,
          compileAttempts: updatedAttempts,
          status: "REPAIRING",
        },
        next: "compileAssembly",
        status: "SUCCEEDED",
      };
    },
  };
}
