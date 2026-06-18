import type { Agent } from "../core/agent/agent.js";
import type { FileAction } from "../core/actions/agent-action.types.js";
import type { EvaluationResult } from "../core/evaluator/evaluator.js";
import type { Tool } from "../core/tool/tool.js";
import type { CompileErrorClassification } from "../schemas/compile-error.schema.js";
import type { MigrationPlan } from "../schemas/migration-plan.schema.js";
import type { CompileResult, MigrationState } from "../schemas/migration-state.schema.js";
import type { TargetJavaProfile } from "../architecture/java/target-java-profile.js";
import type { ArchitecturePolicy } from "../core/architecture/architecture-policy.js";
import type { JavaSourceArtifact } from "../architecture/java/architecture-validator.js";

export type MigrationGraphDependencies = {
  architecturePolicy: ArchitecturePolicy<TargetJavaProfile, JavaSourceArtifact>;
  plan: Agent<{ cobolSource: string; targetJavaProfile: TargetJavaProfile; className: string }, MigrationPlan>;
  generate: Agent<{ cobolSource: string; plan: MigrationPlan; className: string; targetJavaProfile: TargetJavaProfile }, Extract<FileAction, { type: "WRITE_FILE" }>>;
  repair: Agent<{
    cobolSource: string;
    className: string;
    previousJavaCode: string;
    error: CompileErrorClassification;
    targetJavaProfile: TargetJavaProfile;
  }, FileAction>;
  javac: Tool<{ javaFilePath: string; outputDir: string }, CompileResult>;
  optionalVerify?: (state: MigrationState) => Promise<EvaluationResult>;
};
