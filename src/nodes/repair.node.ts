import { join } from "node:path";
import { validateFileAction } from "../core/actions/action.validator.js";
import { applyUnifiedDiff } from "../core/actions/unified-diff.js";
import type { GraphNode } from "../core/graph/graph.node.js";
import type { MigrationState } from "../schemas/migration-state.schema.js";
import { writeTextFileTool } from "../tools/filesystem.tool.js";
import type { MigrationGraphDependencies } from "./migration-node.dependencies.js";
import { runTracedCall } from "../core/trace/traced-call.js";

export function buildRepairNode(dependencies: Pick<MigrationGraphDependencies, "repair" | "architecturePolicy">): GraphNode<MigrationState> {
  return {
    name: "repair",
    async run(state, context) {
      if (!state.currentJavaCode || !state.pendingErrorClassification) throw new Error("RepairNode requires Java code and classified error");
      const previousJavaCode = state.currentJavaCode;
      const error = state.pendingErrorClassification;
      const proposed = await runTracedCall(context.trace, "model.call", { operation: "repairJava", errorClass: error.errorClass }, () => dependencies.repair({
        cobolSource: state.cobolSource,
        className: state.className,
        previousJavaCode,
        error,
        targetJavaProfile: dependencies.architecturePolicy.profile,
      }));
      const compileDir = join(state.runDir, "output");
      const action = validateFileAction(proposed, compileDir, `${state.className}.java`);
      const content = action.type === "WRITE_FILE" ? action.content : applyUnifiedDiff(previousJavaCode, action.unifiedDiff);
      const architectureValidation = dependencies.architecturePolicy.validate({ className: state.className, source: content });
      await context.trace("architecture.validation", architectureValidation);
      if (!architectureValidation.passed) {
        const reason = `Architecture policy rejected repaired source: ${architectureValidation.violations.map((item) => item.code).join(", ")}`;
        return {
          state: { ...state, architectureValidation, status: "FAILED", currentNode: "repair", failureReason: reason, terminal: { status: "FAILED", reason } },
          next: "report",
          status: "SUCCEEDED",
        };
      }
      await runTracedCall(context.trace, "tool.call", { tool: writeTextFileTool.name, operation: action.type }, () => writeTextFileTool.execute({ path: action.resolvedPath, content }));
      const { pendingErrorClassification: _, ...stateWithoutPendingError } = state;
      return {
        state: { ...stateWithoutPendingError, currentJavaCode: content, architectureValidation, pendingRepairAction: proposed, status: "REPAIRING", currentNode: "repair" },
        next: "compile",
        status: "SUCCEEDED",
      };
    },
  };
}
