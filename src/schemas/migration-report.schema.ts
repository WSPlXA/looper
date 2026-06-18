import { z } from "zod";
import { migrationStateSchema } from "./migration-state.schema.js";

export const migrationReportSchema = migrationStateSchema.pick({
  runId: true,
  sourceFile: true,
  className: true,
  status: true,
  attempts: true,
  failureReason: true,
  terminal: true,
  interrupt: true,
  verification: true,
  classifications: true,
  targetJavaProfile: true,
  architectureValidation: true,
}).extend({
  generatedAt: z.string().datetime(),
  errorClassDistribution: z.record(z.number().int().nonnegative()).default({}),
});

export type MigrationReport = z.infer<typeof migrationReportSchema>;
