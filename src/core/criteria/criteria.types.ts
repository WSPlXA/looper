export type CriterionKind = "HARD_GATE" | "SCORE" | "HUMAN_REVIEW";
export type CriterionCategory = "SEMANTIC" | "BUILD" | "ARCHITECTURE" | "MAINTAINABILITY" | "EVIDENCE";

export type Criterion = {
  id: string;
  kind: CriterionKind;
  category: CriterionCategory;
  weight: number;
  requiredConfidence: number;
};

export type CriterionEvidence = {
  criterionId: string;
  passed: boolean;
  score?: number;
  confidence: number;
  evidence: string[];
};

export type CriteriaEvaluation = {
  score: number;
  confidence: number;
  hardGatesPassed: boolean;
  decision: "PASSED" | "FAILED" | "NEEDS_REVIEW" | "BLOCKED";
  results: CriterionEvidence[];
};
