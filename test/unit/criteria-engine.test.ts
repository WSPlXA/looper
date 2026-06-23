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
});
