import type { TargetArchitectureProfile } from "./target-profile.js";

export type ArchitectureDecision = {
  id: string;
  profileId: string;
  revision: number;
  approvedBy: string;
  approvedAt: string;
};

export function approveArchitecture(
  profile: TargetArchitectureProfile,
  approvedBy: string,
  approvedAt = new Date().toISOString(),
): ArchitectureDecision {
  return {
    id: `architecture-${profile.id}-r1`,
    profileId: profile.id,
    revision: 1,
    approvedBy,
    approvedAt,
  };
}

export function requireApprovedArchitecture(decision: ArchitectureDecision | undefined): string {
  if (!decision) throw new Error("Architecture approval is required before code generation");
  return decision.profileId;
}
