import type { GraphNode } from "./graph.node.js";
import type { GraphContext, GraphNodeName, GraphNext, NodeResult } from "./graph.types.js";

export class GraphExecutionError<S> extends Error {
  constructor(message: string, readonly state: S, readonly node: GraphNodeName, options?: ErrorOptions) {
    super(message, options);
    this.name = "GraphExecutionError";
  }
}

export class GraphRunner<S> {
  constructor(
    private readonly nodes: Partial<Record<GraphNodeName, GraphNode<S>>>,
    private readonly start: GraphNodeName,
    private readonly maxTransitions = 1_024,
  ) {}

  async run(initialState: S, context: GraphContext<S>): Promise<S> {
    let state = initialState;
    let current: GraphNext = this.start;
    for (let transition = 0; current !== "END"; transition++) {
      const currentNode: GraphNodeName = current;
      if (transition >= this.maxTransitions) throw new GraphExecutionError("Graph transition budget exceeded", state, currentNode);
      const node: GraphNode<S> | undefined = this.nodes[currentNode];
      if (!node) throw new GraphExecutionError(`Graph node is not registered: ${currentNode}`, state, currentNode);
      const started = performance.now();
      await context.trace("node.start", { node: currentNode, transition });
      try {
        const result: NodeResult<S> = await node.run(state, context);
        state = result.state;
        await context.stateStore.save(state);
        await context.checkpointStore.save(context.runId, `${currentNode}-${result.status.toLowerCase()}`, state);
        await context.trace("checkpoint.write", { node: currentNode, transition });
        await context.trace("state.transition", { from: currentNode, to: result.next, status: result.status });
        await context.trace("node.end", { node: currentNode, status: result.status, durationMs: performance.now() - started });
        if (result.status === "FAILED" || result.status === "INTERRUPTED") return state;
        current = result.next;
      } catch (cause) {
        await context.stateStore.save(state);
        await context.checkpointStore.save(context.runId, `${currentNode}-error`, state);
        await context.trace("node.error", { node: currentNode, durationMs: performance.now() - started, error: cause instanceof Error ? cause.message : String(cause) });
        throw new GraphExecutionError(`Graph node failed: ${currentNode}`, state, currentNode, { cause });
      }
    }
    return state;
  }
}
