import { buildJsonAgent } from "../core/agent/agent.js";
import type { ModelClient } from "../core/model/model-client.js";
import { writeFileActionSchema } from "../core/actions/agent-action.types.js";
import { migrationPlanSchema, type MigrationPlan } from "../schemas/migration-plan.schema.js";
import { describeTargetJavaProfile, type TargetJavaProfile } from "../architecture/java/target-java-profile.js";

const migrationSystem = `You are a code migration agent.
Translate simple COBOL programs into plain Java.
Return JSON only. Do not use markdown. Output exactly one Java class.
The Java class name must match the requested className. Do not use external libraries.
Preserve COBOL business intent. Never claim compilation success; tools decide it.`;

export function buildPlanningAgent(model: ModelClient) {
  return buildJsonAgent<{ cobolSource: string; targetJavaProfile: TargetJavaProfile; className: string }, MigrationPlan>({
    model,
    systemPrompt: `${migrationSystem}\nProduce a migration plan with summary, entryPoint, variables, and unsupportedFeatures.`,
    buildUserPrompt: ({ cobolSource, targetJavaProfile, className }) => `Analyze this COBOL source and return the plan JSON. The plan must obey this deterministic target architecture profile:\n${describeTargetJavaProfile(targetJavaProfile, className)}\nCOBOL source:\n${cobolSource}`,
    parse: migrationPlanSchema.parse,
  });
}

export function buildCobolMigrationAgent(model: ModelClient) {
  return buildJsonAgent<{ cobolSource: string; plan: MigrationPlan; className: string; targetJavaProfile: TargetJavaProfile }, ReturnType<typeof writeFileActionSchema.parse>>({
    model,
    systemPrompt: migrationSystem,
    buildUserPrompt: ({ cobolSource, plan, className, targetJavaProfile }) =>
      `TargetJavaProfile (mandatory): ${describeTargetJavaProfile(targetJavaProfile, className)}\nplan: ${JSON.stringify(plan)}\nCOBOL source:\n${cobolSource}\nPropose exactly one action: {"type":"WRITE_FILE","path":"${className}.java","content":"public class ..."}.`,
    parse: writeFileActionSchema.parse,
  });
}
