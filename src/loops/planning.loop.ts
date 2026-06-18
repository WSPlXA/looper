import type { Agent } from "../core/agent/agent.js";
import type { MigrationPlan } from "../schemas/migration-plan.schema.js";
import type { MigrationState } from "../schemas/migration-state.schema.js";
import { detectUnsupportedFeatures } from "../skills/cobol/detect-features.skill.js";

export function buildPlanningLoop(plan: Agent<{ cobolSource: string }, MigrationPlan>) {
  return async (state: MigrationState): Promise<MigrationState> => {
    const unsupportedFeatures = detectUnsupportedFeatures(state.cobolSource);
    if (unsupportedFeatures.length) {
      return {
        ...state,
        status: "UNSUPPORTED",
        plan: { summary: "Unsupported V1 COBOL features detected", entryPoint: "N/A", variables: [], unsupportedFeatures },
        failureReason: `Unsupported features: ${unsupportedFeatures.join(", ")}`,
      };
    }
    const generatedPlan = await plan({ cobolSource: state.cobolSource });
    if (generatedPlan.unsupportedFeatures.length) {
      return { ...state, plan: generatedPlan, status: "UNSUPPORTED", failureReason: `Unsupported features: ${generatedPlan.unsupportedFeatures.join(", ")}` };
    }
    return { ...state, plan: generatedPlan };
  };
}
