import type { GraphNode } from "../../core/graph/graph.node.js";
import type { AssemblyMigrationState } from "../../schemas/assembly-state.schema.js";
import { writeAssembledOutput } from "./assemble-output.js";

export const assembleProgramNode: GraphNode<AssemblyMigrationState> = {
  name: "assembleProgram",
  async run(state, context) {
    const entryProgramId =
      state.callOrder.at(-1) ??
      state.translatedMethods.at(-1)?.programId ??
      state.outputClassName;

    await context.trace("assemble.start", {
      className: state.outputClassName,
      methodCount: state.translatedMethods.length,
      entryProgramId,
    });

    const assembled = await writeAssembledOutput(state, context);

    await context.trace("assemble.complete", {
      bytes: assembled.generatedSourceFiles.length === 1
        ? Buffer.byteLength(assembled.assembledSource, "utf-8")
        : undefined,
      generatedFiles: assembled.generatedSourceFiles.length,
      methodCount: state.translatedMethods.length,
      targetProfile: state.targetProfile,
    });

    return {
      state: {
        ...state,
        ...assembled,
        status: "ASSEMBLING",
      },
      next: "compileAssembly",
      status: "SUCCEEDED",
    };
  },
};
