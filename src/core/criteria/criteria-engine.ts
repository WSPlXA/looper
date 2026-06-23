import type { CriteriaEvaluation, Criterion, CriterionEvidence } from "./criteria.types.js";

function isBetween(value: number, min: number, max: number): boolean {
  return Number.isFinite(value) && value >= min && value <= max;
}

export function evaluateCriteria(
  criteria: readonly Criterion[],
  evidence: readonly CriterionEvidence[],
  passThreshold: number,
): CriteriaEvaluation {
  const blockedReasons: string[] = [];
  const duplicateEvidenceCriterionIds: string[] = [];
  const seenEvidenceIds = new Set<string>();
  const duplicateEvidenceIds = new Set<string>();
  const byId = new Map<string, CriterionEvidence>();

  if (!isBetween(passThreshold, 0, 100)) {
    blockedReasons.push("passThreshold must be between 0 and 100");
  }

  for (const result of evidence) {
    if (seenEvidenceIds.has(result.criterionId)) {
      duplicateEvidenceIds.add(result.criterionId);
      continue;
    }

    seenEvidenceIds.add(result.criterionId);
    byId.set(result.criterionId, result);
  }

  duplicateEvidenceCriterionIds.push(...duplicateEvidenceIds);
  for (const duplicateId of duplicateEvidenceCriterionIds) {
    blockedReasons.push(`Duplicate evidence for criterion: ${duplicateId}`);
  }

  const missingCriterionIds = criteria
    .filter(criterion => !seenEvidenceIds.has(criterion.id))
    .map(criterion => criterion.id);
  for (const missingId of missingCriterionIds) {
    blockedReasons.push(`Missing evidence for criterion: ${missingId}`);
  }

  for (const criterion of criteria) {
    if (!Number.isFinite(criterion.weight) || criterion.weight < 0) {
      blockedReasons.push(`Criterion ${criterion.id} weight must be finite and non-negative`);
    }

    if (criterion.kind === "SCORE" && (!Number.isFinite(criterion.weight) || criterion.weight <= 0)) {
      blockedReasons.push(`Criterion ${criterion.id} SCORE weight must be greater than 0`);
    }

    if (!isBetween(criterion.requiredConfidence, 0, 1)) {
      blockedReasons.push(`Criterion ${criterion.id} requiredConfidence must be between 0 and 1`);
    }

    const result = byId.get(criterion.id);
    if (result === undefined) {
      continue;
    }

    if (!isBetween(result.confidence, 0, 1)) {
      blockedReasons.push(`Evidence ${criterion.id} confidence must be between 0 and 1`);
    }

    if (criterion.kind !== "SCORE") {
      continue;
    }

    if (result.score === undefined) {
      blockedReasons.push(`Evidence ${criterion.id} score is required for SCORE criterion`);
      continue;
    }

    if (!isBetween(result.score, 0, 100)) {
      blockedReasons.push(`Evidence ${criterion.id} score must be between 0 and 100`);
    }
  }

  const results = criteria
    .map(criterion => byId.get(criterion.id))
    .filter((result): result is CriterionEvidence => result !== undefined);

  if (blockedReasons.length > 0) {
    return {
      score: 0,
      confidence: 0,
      hardGatesPassed: false,
      decision: "BLOCKED",
      results: [...evidence],
      blockedReasons,
      missingCriterionIds,
      duplicateEvidenceCriterionIds,
    };
  }

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
  return {
    score,
    confidence,
    hardGatesPassed,
    decision,
    results,
    blockedReasons: [],
    missingCriterionIds: [],
    duplicateEvidenceCriterionIds: [],
  };
}
