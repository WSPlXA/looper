import { z } from "zod";

export const linkageParamSchema = z.object({
  name: z.string().min(1),
  pic: z.string(),
});

export const subprogramInfoSchema = z.object({
  programId: z.string().min(1),
  sourceFile: z.string().min(1),
  expandedSource: z.string(),
  linkageParams: z.array(linkageParamSchema),
  callees: z.array(z.string()),
});

export const javaParamSchema = z.object({
  name: z.string().min(1),
  type: z.string().min(1),
});

export const javaMethodTranslationSchema = z.object({
  programId: z.string().min(1),
  methodName: z.string().min(1),
  params: z.array(javaParamSchema),
  returnType: z.string().min(1),
  body: z.string().min(1),
  notes: z.string(),
  attempts: z.number().int().nonnegative(),
});

export const programCompileAttemptSchema = z.object({
  attemptNo: z.number().int().positive(),
  javaFilePath: z.string().min(1),
  success: z.boolean(),
  exitCode: z.number().nullable(),
  stdout: z.string(),
  stderr: z.string(),
  repairNotes: z.string().optional(),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime(),
});

export const assemblyMigrationStateSchema = z.object({
  runId: z.string().min(1),
  runDir: z.string().min(1),
  sourceDir: z.string().min(1),
  outputDir: z.string().min(1),
  outputClassName: z.string().regex(/^[A-Za-z_$][A-Za-z\d_$]*/),

  /** Rules injected by the meta-loop from previous rounds */
  injectedSkillRules: z.string().default(""),

  cobFiles: z.array(z.string()).default([]),
  cpyFiles: z.array(z.string()).default([]),
  subprograms: z.array(subprogramInfoSchema).default([]),
  callOrder: z.array(z.string()).default([]),   // programIds in dependency order
  hasCycle: z.boolean().default(false),

  translatedMethods: z.array(javaMethodTranslationSchema).default([]),
  failedTranslations: z.array(z.string()).default([]),  // programIds that exhausted attempts

  /** Per-failure detail for the SkillImprover */
  translationFailures: z.array(z.object({
    programId: z.string(),
    cobolSnippet: z.string(),
    failureReasons: z.array(z.string()),
    lastAttemptBody: z.string().optional(),
  })).default([]),

  assembledSource: z.string().optional(),
  assembledFilePath: z.string().optional(),
  /** methodName → 1-based line number of the method signature in the assembled file */
  assembledMethodRanges: z.record(z.number()).optional(),

  compileAttempts: z.array(programCompileAttemptSchema).default([]),

  status: z.enum([
    "CREATED", "SCANNING", "EXPANDING", "EXTRACTING",
    "TRANSLATING", "ASSEMBLING", "COMPILING", "REPAIRING",
    "SUCCESS", "FAILED",
  ]),

  maxTranslationAttempts: z.number().int().positive().default(3),
  maxRepairAttempts: z.number().int().positive().default(5),

  pendingAssemblyError: z.object({
    errorClass: z.string(),
    summary: z.string(),
    repairHint: z.string(),
  }).optional(),

  failureReason: z.string().optional(),
  reportPath: z.string().optional(),
});

export type LinkageParam = z.infer<typeof linkageParamSchema>;
export type SubprogramInfo = z.infer<typeof subprogramInfoSchema>;
export type JavaParam = z.infer<typeof javaParamSchema>;
export type JavaMethodTranslation = z.infer<typeof javaMethodTranslationSchema>;
export type ProgramCompileAttempt = z.infer<typeof programCompileAttemptSchema>;
export type AssemblyMigrationState = z.infer<typeof assemblyMigrationStateSchema>;
