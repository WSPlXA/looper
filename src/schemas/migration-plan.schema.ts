import { z } from "zod";

export const unsupportedFeatureSchema = z.enum([
  "COPY",
  "EXEC_SQL",
  "JCL",
  "FILE_SECTION",
  "INDEXED_FILE_IO",
  "CICS",
]);

export const migrationPlanSchema = z.object({
  summary: z.string().min(1),
  entryPoint: z.string().min(1),
  variables: z.array(z.object({ cobolName: z.string(), javaName: z.string(), javaType: z.string() })).default([]),
  unsupportedFeatures: z.array(unsupportedFeatureSchema).default([]),
});

export type MigrationPlan = z.infer<typeof migrationPlanSchema>;
export type UnsupportedFeature = z.infer<typeof unsupportedFeatureSchema>;
