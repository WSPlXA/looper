import { z } from "zod";
import { migrationPlanSchema } from "./migration-plan.schema.js";
import { compileErrorClassificationSchema } from "./compile-error.schema.js";
import { agentActionSchema } from "../core/actions/agent-action.types.js";

export const compileResultSchema = z.object({
  success: z.boolean(),
  exitCode: z.number().int().nullable(),
  stdout: z.string(),
  stderr: z.string(),
  timedOut: z.boolean().default(false),
});

export const migrationAttemptSchema = z.object({
  attemptNo: z.number().int().positive(),
  loopName: z.string(),
  javaCode: z.string().optional(),
  javaFilePath: z.string().optional(),
  compileResult: compileResultSchema.optional(),
  errorSummary: z.string().optional(),
  fixSummary: z.string().optional(),
  durationMs: z.number().nonnegative().optional(),
  errorClassification: compileErrorClassificationSchema.optional(),
  repairAction: agentActionSchema.optional(),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime(),
});

export const migrationStateSchema = z.object({
  runId: z.string().min(1),
  runDir: z.string().min(1),
  sourceFile: z.string().min(1),
  outputDir: z.string().min(1),
  className: z.string().regex(/^[A-Za-z_$][A-Za-z\d_$]*$/),
  cobolSource: z.string(),
  plan: migrationPlanSchema.optional(),
  currentJavaCode: z.string().optional(),
  attempts: z.array(migrationAttemptSchema),
  status: z.enum(["CREATED", "RUNNING", "ANALYZING", "PLANNING", "GENERATING", "COMPILING", "COMPILE_PASSED", "REPAIRING", "VERIFYING", "SUCCESS", "FAILED", "UNSUPPORTED", "INTERRUPTED"]),
  maxAttempts: z.number().int().positive(),
  failureReason: z.string().optional(),
  currentNode: z.string().optional(),
  pendingErrorClassification: compileErrorClassificationSchema.optional(),
  pendingRepairAction: agentActionSchema.optional(),
  classifications: z.array(z.object({ attemptNo: z.number().int().positive(), classification: compileErrorClassificationSchema })).optional(),
  interrupt: z.object({ reason: z.string(), requiredInput: z.record(z.string()), resumeFrom: z.string() }).optional(),
  verification: z.object({
    compilePassed: z.boolean(),
    sourceExists: z.boolean(),
    classNameMatches: z.boolean(),
    architecturePassed: z.boolean(),
    optionalTests: z.enum(["SKIPPED", "PASSED", "FAILED"]),
    reason: z.string(),
  }).optional(),
  terminal: z.object({ status: z.enum(["SUCCESS", "FAILED", "UNSUPPORTED", "INTERRUPTED"]), reason: z.string() }).optional(),
  reportPath: z.string().optional(),
  targetJavaProfile: z.object({ id: z.string(), version: z.number().int().positive() }).optional(),
  architectureValidation: z.object({
    passed: z.boolean(),
    profileId: z.string(),
    violations: z.array(z.object({ code: z.string(), message: z.string() })),
  }).optional(),
});

export type CompileResult = z.infer<typeof compileResultSchema>;
export type MigrationAttempt = z.infer<typeof migrationAttemptSchema>;
export type MigrationState = z.infer<typeof migrationStateSchema>;
