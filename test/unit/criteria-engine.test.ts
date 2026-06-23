import { describe, expect, it } from "vitest";
import { evaluateCriteria } from "../../src/core/criteria/criteria-engine.js";
import type { Criterion } from "../../src/core/criteria/criteria.types.js";

const rubric: Criterion[] = [
  { id: "behavior", kind: "SCORE", category: "SEMANTIC", weight: 40, requiredConfidence: 0.8 },
  { id: "tests", kind: "SCORE", category: "BUILD", weight: 25, requiredConfidence: 1 },
  { id: "dependency", kind: "HARD_GATE", category: "ARCHITECTURE", weight: 0, requiredConfidence: 1 },
];

describe("criteria engine", () => {
  it("returns PASSED when gates pass and weighted score reaches threshold", () => {
    const result = evaluateCriteria(rubric, [
      { criterionId: "behavior", passed: true, score: 95, confidence: 0.9, evidence: ["behavior-test.xml"] },
      { criterionId: "tests", passed: true, score: 100, confidence: 1, evidence: ["mvn-test.log"] },
      { criterionId: "dependency", passed: true, confidence: 1, evidence: ["jdeps.log"] },
    ], 90);
    expect(result.decision).toBe("PASSED");
    expect(result.score).toBe(97);
  });

  it("lets a failed hard gate veto a high score", () => {
    const result = evaluateCriteria(rubric, [
      { criterionId: "behavior", passed: true, score: 100, confidence: 1, evidence: ["behavior-test.xml"] },
      { criterionId: "tests", passed: true, score: 100, confidence: 1, evidence: ["mvn-test.log"] },
      { criterionId: "dependency", passed: false, confidence: 1, evidence: ["forbidden import"] },
    ], 90);
    expect(result).toMatchObject({ score: 100, hardGatesPassed: false, decision: "FAILED" });
  });

  it("requires review when evidence confidence is below the approved floor", () => {
    const result = evaluateCriteria(rubric, [
      { criterionId: "behavior", passed: true, score: 95, confidence: 0.5, evidence: ["model-review.json"] },
      { criterionId: "tests", passed: true, score: 100, confidence: 1, evidence: ["mvn-test.log"] },
      { criterionId: "dependency", passed: true, confidence: 1, evidence: ["jdeps.log"] },
    ], 90);
    expect(result.decision).toBe("NEEDS_REVIEW");
  });

  it("blocks duplicate evidence instead of silently overwriting it", () => {
    const result = evaluateCriteria(rubric, [
      { criterionId: "behavior", passed: true, score: 95, confidence: 0.9, evidence: ["behavior-test.xml"] },
      { criterionId: "tests", passed: true, score: 100, confidence: 1, evidence: ["mvn-test.log"] },
      { criterionId: "dependency", passed: true, confidence: 1, evidence: ["jdeps.log"] },
      { criterionId: "dependency", passed: false, confidence: 1, evidence: ["forbidden import"] },
    ], 90);

    expect(result.decision).toBe("BLOCKED");
    expect(result.duplicateEvidenceCriterionIds).toEqual(["dependency"]);
    expect(result.blockedReasons).toContain("Duplicate evidence for criterion: dependency");
  });

  it("blocks missing evidence and reports missing criteria", () => {
    const result = evaluateCriteria(rubric, [
      { criterionId: "behavior", passed: true, score: 95, confidence: 0.9, evidence: ["behavior-test.xml"] },
      { criterionId: "dependency", passed: true, confidence: 1, evidence: ["jdeps.log"] },
    ], 90);

    expect(result.decision).toBe("BLOCKED");
    expect(result.score).toBe(0);
    expect(result.missingCriterionIds).toEqual(["tests"]);
    expect(result.blockedReasons).toContain("Missing evidence for criterion: tests");
  });

  it("blocks invalid score, confidence, threshold, and SCORE weight ranges without emitting an out-of-range score", () => {
    const invalidRubric: Criterion[] = [
      { id: "behavior", kind: "SCORE", category: "SEMANTIC", weight: 0, requiredConfidence: 1.2 },
      { id: "tests", kind: "SCORE", category: "BUILD", weight: Number.POSITIVE_INFINITY, requiredConfidence: 1 },
      { id: "dependency", kind: "HARD_GATE", category: "ARCHITECTURE", weight: -1, requiredConfidence: 1 },
    ];

    const result = evaluateCriteria(invalidRubric, [
      { criterionId: "behavior", passed: true, score: 101, confidence: -0.1, evidence: ["behavior-test.xml"] },
      { criterionId: "tests", passed: true, confidence: 1.1, evidence: ["mvn-test.log"] },
      { criterionId: "dependency", passed: true, confidence: 1, evidence: ["jdeps.log"] },
    ], 101);

    expect(result.decision).toBe("BLOCKED");
    expect(result.score).toBe(0);
    expect(result.blockedReasons).toEqual(expect.arrayContaining([
      "passThreshold must be between 0 and 100",
      "Criterion behavior SCORE weight must be greater than 0",
      "Criterion behavior requiredConfidence must be between 0 and 1",
      "Criterion tests weight must be finite and non-negative",
      "Criterion tests SCORE weight must be greater than 0",
      "Criterion dependency weight must be finite and non-negative",
      "Evidence behavior confidence must be between 0 and 1",
      "Evidence behavior score must be between 0 and 100",
      "Evidence tests confidence must be between 0 and 1",
      "Evidence tests score is required for SCORE criterion",
    ]));
  });
});
