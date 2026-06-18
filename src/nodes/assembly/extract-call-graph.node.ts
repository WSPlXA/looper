import type { GraphNode } from "../../core/graph/graph.node.js";
import type { AssemblyMigrationState } from "../../schemas/assembly-state.schema.js";
import { buildCallOrder } from "../../skills/cobol/extract-call-graph.skill.js";

export const extractCallGraphNode: GraphNode<AssemblyMigrationState> = {
  name: "extractCallGraph",
  async run(state, context) {
    const { order, hasCycle } = buildCallOrder(state.subprograms);
    await context.trace("call-graph.built", { programCount: order.length, hasCycle });
    return {
      state: { ...state, callOrder: order, hasCycle, status: "EXTRACTING" },
      next: "translateSubprograms",
      status: "SUCCEEDED",
    };
  },
};
