import { z } from "zod";
import type { Criterion } from "../criteria/criteria.types.js";

export type TargetArchitectureProfile = {
  id: string;
  name: string;
  description: string;
  moduleBoundaries: string[];
  criteria: Criterion[];
};

export const targetArchitectureProfileSchema = z
  .object({
    id: z.string().trim().min(1),
    name: z.string().trim().min(1),
    description: z.string().trim().min(1),
    moduleBoundaries: z.array(z.string()),
    criteria: z.array(z.unknown()).nonempty(),
  })
  .passthrough();

export function assertValidProfile(profile: TargetArchitectureProfile): void {
  const result = targetArchitectureProfileSchema.safeParse(profile);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue?.path.length ? `profile.${issue.path.join(".")}` : "profile";
    throw new Error(`Invalid architecture ${path}`);
  }
}
