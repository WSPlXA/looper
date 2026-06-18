import { classifyCompileError } from "../agents/error-classifier.agent.js";
import type { GraphNode } from "../core/graph/graph.node.js";
import type { MigrationState } from "../schemas/migration-state.schema.js";

export const classifyErrorNode: GraphNode<MigrationState> = {
  name: "classifyError",
  async run(state) {
    const attempt = state.attempts.at(-1);
    if (!attempt?.compileResult || attempt.compileResult.success) throw new Error("ClassifyErrorNode requires a failed compile attempt");
    const classification = classifyCompileError(attempt.compileResult.stderr);
    const classifications = [...(state.classifications ?? []), { attemptNo: attempt.attemptNo, classification }];
    if (classification.errorClass === "UnsupportedTranslation" || state.attempts.length >= state.maxAttempts) {
      const reason = classification.errorClass === "UnsupportedTranslation"
        ? `Automatic repair stopped: ${classification.summary}`
        : `Compilation did not succeed after ${state.maxAttempts} attempts: ${classification.errorClass}`;
      return {
        state: { ...state, classifications, pendingErrorClassification: classification, status: "FAILED", currentNode: "classifyError", failureReason: reason, terminal: { status: "FAILED", reason } },
        next: "report",
        status: "SUCCEEDED",
      };
    }
    return { state: { ...state, classifications, pendingErrorClassification: classification, currentNode: "classifyError" }, next: "repair", status: "SUCCEEDED" };
  },
};
