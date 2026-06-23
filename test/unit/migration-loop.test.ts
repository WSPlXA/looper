import { describe, expect, it, vi } from "vitest";
import { buildMigrationLoop } from "../../src/core/loop/migration-loop.js";
import type { ArchitectureDecision } from "../../src/core/architecture/architecture-decision.js";
import type { CriterionEvidence } from "../../src/core/criteria/criteria.types.js";
import type { MigrationSession } from "../../src/core/session/migration-session.js";

const approvedDecision: ArchitectureDecision = {
  id: "architecture-spring-boot-r1",
  profileId: "spring-boot",
  revision: 1,
  approvedBy: "reviewer",
  approvedAt: "2026-06-23T00:00:00.000Z",
};

function buildSession(overrides: Partial<MigrationSession> = {}): MigrationSession {
  return {
    id: "s1",
    workspace: "/tmp/work",
    stage: "READY",
    iteration: 0,
    criteriaRevision: 1,
    approvedCriteriaRevision: 1,
    scoreHistory: [],
    completedTaskIds: [],
    risks: [],
    createdAt: "2026-06-23T00:00:00.000Z",
    updatedAt: "2026-06-23T00:00:00.000Z",
    ...overrides,
  };
}

function buildLoop(evidence: CriterionEvidence[], overrides: { maxRepairAttempts?: number } = {}) {
  const sessionSave = vi.fn();
  const artifactSave = vi.fn();
  const checkpointSave = vi.fn();
  const trace = vi.fn();
  const task = { id: "task-1", programIds: ["MAIN"], allowedPaths: ["target/**"] };
  const execution = { changedFiles: ["target/Main.java"] };
  const loop = buildMigrationLoop({
    sessionStore: { load: vi.fn(), save: sessionSave },
    source: { id: "cobol", discover: vi.fn() },
    target: {
      id: "spring-boot",
      plan: vi.fn().mockResolvedValue([task]),
      execute: vi.fn().mockResolvedValue(execution),
      verify: vi.fn().mockResolvedValue(evidence),
    },
    criteria: [{ id: "build", kind: "SCORE", category: "BUILD", weight: 100, requiredConfidence: 1 }],
    passThreshold: 90,
    maxRepairAttempts: overrides.maxRepairAttempts ?? 3,
    maxStagnantIterations: 2,
    checkpointStore: { save: checkpointSave, loadLatest: vi.fn() },
    artifacts: { saveJson: artifactSave, loadJson: vi.fn() },
    trace,
  });

  return { loop, sessionSave, artifactSave, checkpointSave, trace, task, execution };
}

describe("migration loop", () => {
  it("blocks before approvals and persists evidence after one iteration", async () => {
    const save = vi.fn();
    const loop = buildMigrationLoop({
      sessionStore: { load: vi.fn(), save },
      source: { id: "cobol", discover: vi.fn() },
      target: {
        id: "spring-boot",
        plan: vi.fn().mockResolvedValue([{ id: "task-1", programIds: ["MAIN"], allowedPaths: ["target/**"] }]),
        execute: vi.fn().mockResolvedValue({ changedFiles: ["target/Main.java"] }),
        verify: vi.fn().mockResolvedValue([
          { criterionId: "build", passed: true, score: 100, confidence: 1, evidence: ["mvn.log"] },
        ]),
      },
      criteria: [{ id: "build", kind: "SCORE", category: "BUILD", weight: 100, requiredConfidence: 1 }],
      passThreshold: 90,
      maxRepairAttempts: 3,
      maxStagnantIterations: 2,
      checkpointStore: { save: vi.fn(), loadLatest: vi.fn() },
      artifacts: { saveJson: vi.fn(), loadJson: vi.fn() },
      trace: vi.fn(),
    });

    await expect(loop.runNext({
      session: {
        id: "s1", workspace: "/tmp/work", stage: "ARCHITECTURE_REVIEW", iteration: 0,
        criteriaRevision: 1, scoreHistory: [], completedTaskIds: [], risks: [],
        createdAt: "2026-06-23T00:00:00.000Z", updatedAt: "2026-06-23T00:00:00.000Z",
      },
      inventory: { sourceKind: "cobol", sourceRoot: "/tmp/work", programs: [], copybookFiles: [], risks: [] },
      tasks: [],
    })).rejects.toThrow("Architecture approval is required");
  });

  it("persists evidence and completes a passing task after one approved iteration", async () => {
    const evidence = [
      { criterionId: "build", passed: true, score: 100, confidence: 1, evidence: ["mvn.log"] },
    ];
    const { loop, sessionSave, artifactSave, checkpointSave, trace, task, execution } = buildLoop(evidence);

    const result = await loop.runNext({
      session: buildSession(),
      inventory: { sourceKind: "cobol", sourceRoot: "/tmp/work", programs: [], copybookFiles: [], risks: [] },
      architectureDecision: approvedDecision,
      tasks: [],
    });

    expect(result.session).toMatchObject({
      id: "s1",
      stage: "READY",
      iteration: 1,
      completedTaskIds: ["task-1"],
      scoreHistory: [{ iteration: 1, score: 100, decision: "PASSED" }],
      architectureDecisionId: "architecture-spring-boot-r1",
    });
    expect(result.session.activeTaskId).toBeUndefined();
    expect(result.lastExecution).toEqual(execution);
    expect(result.lastEvaluation).toMatchObject({ score: 100, decision: "PASSED" });
    expect(sessionSave).toHaveBeenCalledWith(result.session);
    expect(artifactSave).toHaveBeenCalledWith("evidence/iteration-000001.json", expect.objectContaining({
      sessionId: "s1",
      iteration: 1,
      task,
      execution,
      evaluation: expect.objectContaining({ score: 100, decision: "PASSED", results: evidence }),
    }));
    expect(checkpointSave).toHaveBeenCalledWith("s1", "iteration-1", result);
    expect(trace).toHaveBeenCalledWith("iteration.completed", {
      sessionId: "s1",
      iteration: 1,
      taskId: "task-1",
      decision: "PASSED",
      score: 100,
    });
  });

  it("blocks when three failed scores stagnate across the configured window", async () => {
    const evidence = [
      { criterionId: "build", passed: true, score: 70, confidence: 1, evidence: ["mvn.log"] },
    ];
    const { loop, task } = buildLoop(evidence, { maxRepairAttempts: 10 });

    const result = await loop.runNext({
      session: buildSession({
        iteration: 2,
        scoreHistory: [
          { iteration: 1, score: 70, decision: "FAILED" },
          { iteration: 2, score: 70, decision: "FAILED" },
        ],
      }),
      inventory: { sourceKind: "cobol", sourceRoot: "/tmp/work", programs: [], copybookFiles: [], risks: [] },
      architectureDecision: approvedDecision,
      tasks: [task],
    });

    expect(result.session).toMatchObject({
      stage: "BLOCKED",
      iteration: 3,
      activeTaskId: "task-1",
      completedTaskIds: [],
      scoreHistory: [
        { iteration: 1, score: 70, decision: "FAILED" },
        { iteration: 2, score: 70, decision: "FAILED" },
        { iteration: 3, score: 70, decision: "FAILED" },
      ],
    });
  });
});
