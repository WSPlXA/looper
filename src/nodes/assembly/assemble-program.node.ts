import { join } from "node:path";
import type { GraphNode } from "../../core/graph/graph.node.js";
import type { AssemblyMigrationState } from "../../schemas/assembly-state.schema.js";
import { buildProgramAssemblerAgent, buildMethodSignature } from "../../agents/program-assembler.agent.js";
import { writeTextFileTool } from "../../tools/filesystem.tool.js";
import { runTracedCall } from "../../core/trace/traced-call.js";
import type { AssemblyGraphDependencies } from "./assembly-node.dependencies.js";

export function buildAssembleProgramNode(
  deps: Pick<AssemblyGraphDependencies, "model">,
): GraphNode<AssemblyMigrationState> {
  const assemble = buildProgramAssemblerAgent(deps.model);
  return {
    name: "assembleProgram",
    async run(state, context) {
      const entryProgramId =
        state.callOrder.at(-1) ??
        state.translatedMethods.at(-1)?.programId ??
        state.outputClassName;

      const methods = state.translatedMethods.map(m => ({
        programId: m.programId,
        signature: buildMethodSignature(m),
        body: m.body,
      }));

      const action = await runTracedCall(
        context.trace,
        "model.call",
        { operation: "assembleProgram", className: state.outputClassName, methodCount: methods.length },
        () => assemble({
          className: state.outputClassName,
          entryProgramId,
          methods,
          failedTranslations: state.failedTranslations,
        }),
      );

      const outputDir = join(state.runDir, "output");
      const assembledFilePath = join(outputDir, `${state.outputClassName}.java`);
      await runTracedCall(context.trace, "tool.call", { tool: "write-text-file", path: assembledFilePath }, () =>
        writeTextFileTool.execute({ path: assembledFilePath, content: action.content }),
      );

      return {
        state: {
          ...state,
          assembledSource: action.content,
          assembledFilePath,
          status: "ASSEMBLING",
        },
        next: "compileAssembly",
        status: "SUCCEEDED",
      };
    },
  };
}
