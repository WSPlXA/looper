import type { TargetArchitectureProfile } from "../../core/architecture/target-profile.js";

export const hollowSkinnyProfile: TargetArchitectureProfile = {
  id: "hollow-skinny-v1",
  name: "Hollow base with Skinny business plugins",
  description: "A stable hollow.jar runtime exposes public plugin contracts; skinny.jar contains COBOL-derived business implementations.",
  moduleBoundaries: [
    "hollow must not depend on skinny",
    "skinny may depend only on hollow public API",
    "mutable COBOL state must be scoped through ProgramContext or SharedStateStore",
  ],
  criteria: [
    { id: "build.hollow", kind: "HARD_GATE", category: "BUILD", weight: 0, requiredConfidence: 1 },
    { id: "build.skinny", kind: "HARD_GATE", category: "BUILD", weight: 0, requiredConfidence: 1 },
    { id: "architecture.no-reverse-dependency", kind: "HARD_GATE", category: "ARCHITECTURE", weight: 0, requiredConfidence: 1 },
    { id: "architecture.plugin-loads", kind: "HARD_GATE", category: "ARCHITECTURE", weight: 0, requiredConfidence: 1 },
    { id: "semantic.fidelity", kind: "SCORE", category: "SEMANTIC", weight: 40, requiredConfidence: 0.8 },
    { id: "build.tests", kind: "SCORE", category: "BUILD", weight: 25, requiredConfidence: 1 },
    { id: "architecture.conformance", kind: "SCORE", category: "ARCHITECTURE", weight: 20, requiredConfidence: 1 },
    { id: "code.maintainability", kind: "SCORE", category: "MAINTAINABILITY", weight: 10, requiredConfidence: 0.8 },
    { id: "evidence.completeness", kind: "SCORE", category: "EVIDENCE", weight: 5, requiredConfidence: 1 },
  ],
};
