import type { GraphNode } from "../core/graph/graph.node.js";
import type { MigrationState } from "../schemas/migration-state.schema.js";
import { readTextFileTool } from "../tools/filesystem.tool.js";
import { runTracedCall } from "../core/trace/traced-call.js";

export const sourceIntakeNode: GraphNode<MigrationState> = {
  name: "sourceIntake",
  async run(state, context) {
    const cobolSource = await runTracedCall(context.trace, "tool.call", { tool: readTextFileTool.name }, () => readTextFileTool.execute({ path: state.sourceFile }));
    return { state: { ...state, cobolSource, status: "RUNNING", currentNode: "sourceIntake" }, next: "capabilityGate", status: "SUCCEEDED" };
  },
};
