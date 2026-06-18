import type { GraphNode } from "../core/graph/graph.node.js";
import type { MigrationState } from "../schemas/migration-state.schema.js";

export const analyzeCobolNode: GraphNode<MigrationState> = {
  name: "analyzeCobol",
  async run(state) {
    return { state: { ...state, status: "ANALYZING", currentNode: "analyzeCobol" }, next: "resolveJavaArchitecture", status: "SUCCEEDED" };
  },
};
