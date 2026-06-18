import { z } from "zod";

export const javaGenerationSchema = z.object({
  className: z.string().regex(/^[A-Za-z_$][A-Za-z\d_$]*$/),
  javaCode: z.string().min(1),
  notes: z.string().default(""),
});

export type JavaGeneration = z.infer<typeof javaGenerationSchema>;
