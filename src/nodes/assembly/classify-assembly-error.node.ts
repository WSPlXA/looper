import type { GraphNode } from "../../core/graph/graph.node.js";
import type { AssemblyMigrationState } from "../../schemas/assembly-state.schema.js";
import { classifyCompileError } from "../../agents/error-classifier.agent.js";

export const classifyAssemblyErrorNode: GraphNode<AssemblyMigrationState> = {
  name: "classifyAssemblyError",
  async run(state, context) {
    const lastAttempt = state.compileAttempts.at(-1);
    if (!lastAttempt) throw new Error("classifyAssemblyError: no compile attempts in state");

    const classification = classifyCompileError(lastAttempt.stderr);
    await context.trace("classify.result", { errorClass: classification.errorClass });

    if (classification.errorClass === "UnsupportedTranslation") {
      return {
        state: {
          ...state,
          pendingAssemblyError: classification,
          status: "FAILED",
          failureReason: `Unsupported translation pattern: ${classification.summary}`,
        },
        next: "reportAssembly",
        status: "SUCCEEDED",
      };
    }

    return {
      state: { ...state, pendingAssemblyError: classification, status: "REPAIRING" },
      next: "repairAssembly",
      status: "SUCCEEDED",
    };
  },
};
