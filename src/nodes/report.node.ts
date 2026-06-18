import type { GraphNode } from "../core/graph/graph.node.js";
import type { MigrationState } from "../schemas/migration-state.schema.js";
import { reportTool } from "../tools/report.tool.js";
import { runTracedCall } from "../core/trace/traced-call.js";

export const reportNode: GraphNode<MigrationState> = {
  name: "report",
  async run(state, context) {
    const terminalState = state.terminal ? state : {
      ...state,
      status: "FAILED" as const,
      failureReason: state.failureReason ?? "Graph reached ReportNode without a terminal decision",
      terminal: { status: "FAILED" as const, reason: state.failureReason ?? "Graph reached ReportNode without a terminal decision" },
    };
    const reportPath = await runTracedCall(context.trace, "tool.call", { tool: reportTool.name }, () => reportTool.execute({ state: terminalState }));
    return { state: { ...terminalState, reportPath, currentNode: "report" }, next: "END", status: "SUCCEEDED" };
  },
};
