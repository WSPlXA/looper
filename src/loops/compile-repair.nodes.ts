import type { GraphNode } from "../core/graph/graph.node.js";
import type { GraphNodeName } from "../core/graph/graph.types.js";
import { classifyErrorNode } from "../nodes/classify-error.node.js";
import { buildCompileNode } from "../nodes/compile.node.js";
import type { MigrationGraphDependencies } from "../nodes/migration-node.dependencies.js";
import { buildRepairNode } from "../nodes/repair.node.js";
import { reportNode } from "../nodes/report.node.js";
import { buildVerifyNode } from "../nodes/verify.node.js";
import type { MigrationState } from "../schemas/migration-state.schema.js";

export function buildClassifyRepairGraphNodes(
  dependencies: Pick<MigrationGraphDependencies, "javac" | "repair" | "optionalVerify" | "architecturePolicy">,
): Partial<Record<GraphNodeName, GraphNode<MigrationState>>> {
  return {
    compile: buildCompileNode(dependencies),
    classifyError: classifyErrorNode,
    repair: buildRepairNode(dependencies),
    verify: buildVerifyNode(dependencies),
    report: reportNode,
  };
}
