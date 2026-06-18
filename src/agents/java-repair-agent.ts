import { buildJsonAgent } from "../core/agent/agent.js";
import type { ModelClient } from "../core/model/model-client.js";
import { agentActionSchema, type FileAction } from "../core/actions/agent-action.types.js";
import type { CompileErrorClassification } from "../schemas/compile-error.schema.js";
import { describeTargetJavaProfile, type TargetJavaProfile } from "../architecture/java/target-java-profile.js";

export function buildJavaRepairAgent(model: ModelClient) {
  return buildJsonAgent<{
    cobolSource: string;
    className: string;
    previousJavaCode: string;
    error: CompileErrorClassification;
    targetJavaProfile: TargetJavaProfile;
  }, FileAction>({
    model,
    systemPrompt: `You repair Java generated from COBOL.
Return JSON only. Modify the previous Java code; do not regenerate unrelated code.
Fix only the classified compiler error and preserve COBOL business logic.
The class name must match className. Never claim compilation success.`,
    buildUserPrompt: ({ cobolSource, className, previousJavaCode, error, targetJavaProfile }) =>
      `TargetJavaProfile (mandatory): ${describeTargetJavaProfile(targetJavaProfile, className)}\nCOBOL source:\n${cobolSource}\nPrevious Java:\n${previousJavaCode}\nClassified error:\n${JSON.stringify(error)}\nReturn one WRITE_FILE or PATCH_FILE action targeting ${className}.java. The repaired source must still obey the profile.`,
    parse: (value) => {
      const action = agentActionSchema.parse(value);
      if (action.type !== "WRITE_FILE" && action.type !== "PATCH_FILE") throw new Error(`Repair requires a file action; received ${action.type}`);
      return action;
    },
  });
}
