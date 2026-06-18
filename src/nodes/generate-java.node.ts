import { join } from "node:path";
import { validateFileAction } from "../core/actions/action.validator.js";
import type { GraphNode } from "../core/graph/graph.node.js";
import type { MigrationState } from "../schemas/migration-state.schema.js";
import { writeTextFileTool } from "../tools/filesystem.tool.js";
import type { MigrationGraphDependencies } from "./migration-node.dependencies.js";
import { runTracedCall } from "../core/trace/traced-call.js";

export function buildGenerateJavaNode(dependencies: MigrationGraphDependencies): GraphNode<MigrationState> {
  return {
    name: "generateJava",
    async run(state, context) {
      if (!state.plan) throw new Error("GenerateJavaNode requires a migration plan");
      const compileDir = join(state.runDir, "output");
      const proposed = await runTracedCall(context.trace, "model.call", { operation: "generateJava", profileId: dependencies.architecturePolicy.profile.id }, () => dependencies.generate({
        cobolSource: state.cobolSource,
        plan: state.plan!,
        className: state.className,
        targetJavaProfile: dependencies.architecturePolicy.profile,
      }));
      const action = validateFileAction(proposed, compileDir, `${state.className}.java`);
      if (action.type !== "WRITE_FILE") throw new Error("GenerateJavaNode accepts WRITE_FILE only");
      const architectureValidation = dependencies.architecturePolicy.validate({ className: state.className, source: action.content });
      await context.trace("architecture.validation", architectureValidation);
      if (!architectureValidation.passed) {
        const reason = `Architecture policy rejected generated source: ${architectureValidation.violations.map((item) => item.code).join(", ")}`;
        return {
          state: { ...state, architectureValidation, status: "FAILED", currentNode: "generateJava", failureReason: reason, terminal: { status: "FAILED", reason } },
          next: "report",
          status: "SUCCEEDED",
        };
      }
      await runTracedCall(context.trace, "tool.call", { tool: writeTextFileTool.name, operation: "WRITE_FILE" }, () => writeTextFileTool.execute({ path: action.resolvedPath, content: action.content }));
      return { state: { ...state, currentJavaCode: action.content, architectureValidation, status: "GENERATING", currentNode: "generateJava" }, next: "compile", status: "SUCCEEDED" };
    },
  };
}
