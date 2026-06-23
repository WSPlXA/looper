import type { CriteriaEvaluation, Criterion, CriterionEvidence } from "./criteria.types.js";

export function evaluateCriteria(
  criteria: readonly Criterion[],
  evidence: readonly CriterionEvidence[],
  passThreshold: number,
): CriteriaEvaluation {
  const byId = new Map(evidence.map(result => [result.criterionId, result]));
  const missing = criteria.filter(criterion => !byId.has(criterion.id));
  if (missing.length > 0) {
    return { score: 0, confidence: 0, hardGatesPassed: false, decision: "BLOCKED", results: [...evidence] };
  }
  const results = criteria.map(criterion => byId.get(criterion.id)!);
  const hardGatesPassed = criteria
    .filter(criterion => criterion.kind === "HARD_GATE")
    .every(criterion => byId.get(criterion.id)!.passed);
  const requiresReview = criteria.some(criterion => {
    const result = byId.get(criterion.id)!;
    return (criterion.kind === "HUMAN_REVIEW" && !result.passed)
      || result.confidence < criterion.requiredConfidence;
  });
  const scored = criteria.filter(criterion => criterion.kind === "SCORE");
  const totalWeight = scored.reduce((sum, criterion) => sum + criterion.weight, 0);
  const weighted = scored.reduce((sum, criterion) => {
    return sum + (byId.get(criterion.id)!.score ?? 0) * criterion.weight;
  }, 0);
  const score = totalWeight === 0 ? 0 : Math.round(weighted / totalWeight);
  const confidence = results.length === 0
    ? 0
    : Math.min(...results.map(result => result.confidence));
  const decision = !hardGatesPassed
    ? "FAILED"
    : requiresReview
      ? "NEEDS_REVIEW"
      : score >= passThreshold ? "PASSED" : "FAILED";
  return { score, confidence, hardGatesPassed, decision, results };
}
