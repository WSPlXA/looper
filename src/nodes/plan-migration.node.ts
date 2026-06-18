import type { GraphNode } from "../core/graph/graph.node.js";
import type { MigrationState } from "../schemas/migration-state.schema.js";
import type { MigrationGraphDependencies } from "./migration-node.dependencies.js";
import { runTracedCall } from "../core/trace/traced-call.js";

export function buildPlanMigrationNode(dependencies: MigrationGraphDependencies): GraphNode<MigrationState> {
  return {
    name: "planMigration",
    async run(state, context) {
      const plan = await runTracedCall(context.trace, "model.call", { operation: "planMigration", profileId: dependencies.architecturePolicy.profile.id }, () => dependencies.plan({
        cobolSource: state.cobolSource,
        targetJavaProfile: dependencies.architecturePolicy.profile,
        className: state.className,
      }));
      if (plan.unsupportedFeatures.length) {
        const reason = `Unsupported features: ${plan.unsupportedFeatures.join(", ")}`;
        return { state: { ...state, plan, status: "UNSUPPORTED", currentNode: "planMigration", failureReason: reason, terminal: { status: "UNSUPPORTED", reason } }, next: "report", status: "SUCCEEDED" };
      }
      return { state: { ...state, plan, status: "PLANNING", currentNode: "planMigration" }, next: "generateJava", status: "SUCCEEDED" };
    },
  };
}
