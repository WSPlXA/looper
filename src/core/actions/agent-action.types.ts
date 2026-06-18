import { z } from "zod";

export const writeFileActionSchema = z.object({ type: z.literal("WRITE_FILE"), path: z.string().min(1), content: z.string() });
export const patchFileActionSchema = z.object({ type: z.literal("PATCH_FILE"), path: z.string().min(1), unifiedDiff: z.string().min(1) });

export const agentActionSchema = z.discriminatedUnion("type", [
  writeFileActionSchema,
  patchFileActionSchema,
  z.object({ type: z.literal("FINAL_REPORT"), status: z.enum(["SUCCESS", "FAILED"]), summary: z.string() }),
  z.object({ type: z.literal("ASK_HUMAN"), reason: z.string().min(1), requiredInput: z.record(z.string()) }),
]);

export type AgentAction = z.infer<typeof agentActionSchema>;
export type FileAction = Extract<AgentAction, { type: "WRITE_FILE" | "PATCH_FILE" }>;
