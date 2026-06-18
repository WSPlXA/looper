import { join } from "node:path";
import type { GraphNode } from "../../core/graph/graph.node.js";
import type { AssemblyMigrationState } from "../../schemas/assembly-state.schema.js";
import { assembleJavaClass } from "../../skills/java/assemble-java-class.skill.js";
import { writeTextFileTool } from "../../tools/filesystem.tool.js";
import { runTracedCall } from "../../core/trace/traced-call.js";

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

    const { source, methodLineStarts } = assembleJavaClass(
      state.outputClassName,
      entryProgramId,
      state.translatedMethods,
      state.failedTranslations,
    );

    const outputDir = join(state.runDir, "output");
    const assembledFilePath = join(outputDir, `${state.outputClassName}.java`);

    await runTracedCall(
      context.trace,
      "tool.call",
      { tool: "write-text-file", path: assembledFilePath },
      () => writeTextFileTool.execute({ path: assembledFilePath, content: source }),
    );

    await context.trace("assemble.complete", {
      bytes: Buffer.byteLength(source, "utf-8"),
      methodCount: Object.keys(methodLineStarts).length,
    });

    return {
      state: {
        ...state,
        assembledSource: source,
        assembledFilePath,
        assembledMethodRanges: methodLineStarts,
        status: "ASSEMBLING",
      },
      next: "compileAssembly",
      status: "SUCCEEDED",
    };
  },
};
