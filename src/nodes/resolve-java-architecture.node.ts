import type { GraphNode } from "../core/graph/graph.node.js";
import type { MigrationState } from "../schemas/migration-state.schema.js";
import type { MigrationGraphDependencies } from "./migration-node.dependencies.js";

export function buildResolveJavaArchitectureNode(dependencies: Pick<MigrationGraphDependencies, "architecturePolicy">): GraphNode<MigrationState> {
  return {
    name: "resolveJavaArchitecture",
    async run(state, context) {
      const profile = dependencies.architecturePolicy.profile;
      await context.trace("architecture.resolved", { profileId: profile.id, version: profile.version });
      return {
        state: { ...state, targetJavaProfile: { id: profile.id, version: profile.version }, currentNode: "resolveJavaArchitecture" },
        next: "planMigration",
        status: "SUCCEEDED",
      };
    },
  };
}
