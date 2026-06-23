import { z } from "zod";

export const sessionStageSchema = z.enum([
  "DISCOVERY",
  "ARCHITECTURE_REVIEW",
  "CRITERIA_REVIEW",
  "READY",
  "RUNNING",
  "NEEDS_REVIEW",
  "BLOCKED",
  "PAUSED",
  "COMPLETED",
]);

export const migrationSessionSchema = z.object({
  id: z.string().min(1),
  workspace: z.string().min(1),
  stage: sessionStageSchema,
  iteration: z.number().int().nonnegative(),
  architectureDecisionId: z.string().min(1).optional(),
  criteriaRevision: z.number().int().nonnegative(),
  approvedCriteriaRevision: z.number().int().nonnegative().optional(),
  scoreHistory: z.array(
    z.object({
      iteration: z.number().int().positive(),
      score: z.number().min(0).max(100),
      decision: z.enum(["PASSED", "FAILED", "NEEDS_REVIEW", "BLOCKED"]),
    }),
  ),
  completedTaskIds: z.array(z.string()),
  activeTaskId: z.string().optional(),
  risks: z.array(z.string()),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type MigrationSession = z.infer<typeof migrationSessionSchema>;
