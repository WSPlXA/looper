import type { GraphNode } from "../core/graph/graph.node.js";
import type { MigrationState } from "../schemas/migration-state.schema.js";
import { detectUnsupportedFeatures } from "../skills/cobol/detect-features.skill.js";

export const capabilityGateNode: GraphNode<MigrationState> = {
  name: "capabilityGate",
  async run(state) {
    const features = detectUnsupportedFeatures(state.cobolSource);
    if (features.includes("COPY")) {
      const reason = "COPY statement requires copybook resolution.";
      return {
        state: {
          ...state,
          status: "INTERRUPTED",
          currentNode: "capabilityGate",
          failureReason: reason,
          interrupt: { reason, requiredInput: { copybookSearchPath: "Path to directory containing COBOL copybooks." }, resumeFrom: "capabilityGate" },
          terminal: { status: "INTERRUPTED", reason },
        },
        next: "report",
        status: "SUCCEEDED",
      };
    }
    if (features.length) {
      const reason = `Unsupported features: ${features.join(", ")}`;
      return { state: { ...state, status: "UNSUPPORTED", currentNode: "capabilityGate", failureReason: reason, terminal: { status: "UNSUPPORTED", reason } }, next: "report", status: "SUCCEEDED" };
    }
    return { state: { ...state, currentNode: "capabilityGate" }, next: "analyzeCobol", status: "SUCCEEDED" };
  },
};
