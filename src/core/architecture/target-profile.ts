import type { Criterion } from "../criteria/criteria.types.js";

export type TargetArchitectureProfile = {
  id: string;
  name: string;
  description: string;
  moduleBoundaries: string[];
  criteria: Criterion[];
};
