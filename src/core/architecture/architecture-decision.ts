import { z } from "zod";
import { assertValidProfile } from "./target-profile.js";
import type { TargetArchitectureProfile } from "./target-profile.js";

export type ArchitectureDecision = {
  id: string;
  profileId: string;
  revision: number;
  approvedBy: string;
  approvedAt: string;
};

export const architectureDecisionSchema = z.object({
  id: z.string().trim().min(1),
  profileId: z.string().trim().min(1),
  revision: z.number().int().positive(),
  approvedBy: z.string().trim().min(1),
  approvedAt: z.string().datetime(),
});

export function approveArchitecture(
  profile: TargetArchitectureProfile,
  approvedBy: string,
  approvedAt = new Date().toISOString(),
): ArchitectureDecision {
  assertValidProfile(profile);
  const result = architectureDecisionSchema.safeParse({
    id: `architecture-${profile.id}-r1`,
    profileId: profile.id,
    revision: 1,
    approvedBy,
    approvedAt,
  });
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue?.path.join(".") || "decision";
    throw new Error(`Invalid architecture ${path}`);
  }
  return result.data;
}

export function requireApprovedArchitecture(decision: ArchitectureDecision | undefined): string {
  if (!decision) throw new Error("Architecture approval is required before code generation");
  const result = architectureDecisionSchema.safeParse(decision);
  if (!result.success) throw new Error("Invalid architecture decision");
  return result.data.profileId;
}
