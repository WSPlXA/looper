import type { GraphNext, GraphNodeName, NodeStatus } from "./graph.types.js";

export type GraphTransition = {
  from: GraphNodeName;
  to: GraphNext;
  status: NodeStatus;
};
