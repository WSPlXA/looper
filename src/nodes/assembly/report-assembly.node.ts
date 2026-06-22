import { join } from "node:path";
import type { GraphNode } from "../../core/graph/graph.node.js";
import type { AssemblyMigrationState } from "../../schemas/assembly-state.schema.js";
import { writeTextFileTool } from "../../tools/filesystem.tool.js";
import { runTracedCall } from "../../core/trace/traced-call.js";

export const reportAssemblyNode: GraphNode<AssemblyMigrationState> = {
  name: "reportAssembly",
  async run(state, context) {
    const reportPath = join(state.runDir, "assembly-report.json");
    const lastCompile = state.compileAttempts.at(-1);
    const report = {
      runId: state.runId,
      outputClassName: state.outputClassName,
      targetProfile: state.targetProfile,
      targetPackage: state.targetPackage,
      sourceDir: state.sourceDir,
      status: state.status === "SUCCESS" ? "SUCCESS" : "FAILED",
      subprogramCount: state.subprograms.length,
      translatedCount: state.translatedMethods.length,
      failedTranslations: state.failedTranslations,
      compileAttempts: state.compileAttempts.length,
      compilePassed: lastCompile?.success ?? false,
      assembledFilePath: state.assembledFilePath,
      generatedProjectDir: state.generatedProjectDir,
      generatedFileCount: state.generatedSourceFiles.length,
      verification: state.verification,
      hasCycle: state.hasCycle,
      ...(state.failureReason ? { failureReason: state.failureReason } : {}),
      generatedAt: new Date().toISOString(),
    };
    await runTracedCall(context.trace, "tool.call", { tool: "write-text-file", path: reportPath }, () =>
      writeTextFileTool.execute({ path: reportPath, content: `${JSON.stringify(report, null, 2)}\n` }),
    );
    return { state: { ...state, reportPath }, next: "END", status: "SUCCEEDED" };
  },
};
