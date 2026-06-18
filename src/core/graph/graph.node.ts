import type { GraphContext, GraphNodeName, NodeResult } from "./graph.types.js";

export interface GraphNode<S> {
  readonly name: GraphNodeName;
  run(state: S, context: GraphContext<S>): Promise<NodeResult<S>>;
}
