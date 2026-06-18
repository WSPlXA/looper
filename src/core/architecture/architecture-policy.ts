export type ArchitectureViolation = {
  code: string;
  message: string;
};

export type ArchitectureValidation = {
  passed: boolean;
  profileId: string;
  violations: ArchitectureViolation[];
};

export interface ArchitecturePolicy<TProfile, TArtifact> {
  readonly profile: TProfile;
  validate(artifact: TArtifact): ArchitectureValidation;
}

export class ArchitecturePolicyError extends Error {
  constructor(readonly validation: ArchitectureValidation) {
    super(`Architecture policy rejected generated artifact: ${validation.violations.map((item) => item.code).join(", ")}`);
    this.name = "ArchitecturePolicyError";
  }
}

export function enforceArchitecture(validation: ArchitectureValidation): void {
  if (!validation.passed) throw new ArchitecturePolicyError(validation);
}
