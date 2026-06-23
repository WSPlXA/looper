import { requireApprovedArchitecture } from "../architecture/architecture-decision.js";
import type { ArchitectureDecision } from "../architecture/architecture-decision.js";
import { evaluateCriteria } from "../criteria/criteria-engine.js";
import type { Criterion, CriteriaEvaluation } from "../criteria/criteria.types.js";
import { migrationSessionSchema, type MigrationSession } from "../session/migration-session.js";
import type { SessionStore } from "../session/file-session-store.js";
import type { WorkspaceArtifactStore } from "../session/workspace-artifact-store.js";
import type { LegacyInventory, SourceAdapter } from "../adapters/source-adapter.js";
import type { MigrationTask, TargetAdapter } from "../adapters/target-adapter.js";
import type { CheckpointStore } from "../checkpoint/checkpoint.store.js";
import { shouldStopRepair } from "./loop-policy.js";

export type MigrationLoopContext = {
  session: MigrationSession;
  inventory: LegacyInventory;
  architectureDecision?: ArchitectureDecision;
  tasks: MigrationTask[];
  lastExecution?: { changedFiles: string[] };
  lastEvaluation?: CriteriaEvaluation;
};

export type MigrationLoopDependencies = {
  sessionStore: SessionStore;
  source: SourceAdapter;
  target: TargetAdapter;
  criteria: Criterion[];
  passThreshold: number;
  maxRepairAttempts: number;
  maxStagnantIterations: number;
  checkpointStore: CheckpointStore<MigrationLoopContext>;
  artifacts: WorkspaceArtifactStore;
  trace(type: string, data?: unknown): Promise<void>;
};

function formatIteration(iteration: number): string {
  return iteration.toString().padStart(6, "0");
}

function nextStage(input: {
  exhausted: boolean;
  evaluation: CriteriaEvaluation;
}): MigrationSession["stage"] {
  if (input.exhausted) return "BLOCKED";
  if (input.evaluation.decision === "PASSED") return "READY";
  if (input.evaluation.decision === "NEEDS_REVIEW") return "NEEDS_REVIEW";
  if (input.evaluation.decision === "BLOCKED") return "BLOCKED";
  return "RUNNING";
}

function selectTask(session: MigrationSession, tasks: readonly MigrationTask[]): MigrationTask | undefined {
  const completedTaskIds = new Set(session.completedTaskIds);

  if (session.activeTaskId && !completedTaskIds.has(session.activeTaskId)) {
    const activeTask = tasks.find(candidate => candidate.id === session.activeTaskId);
    if (!activeTask) throw new Error(`Active task ${session.activeTaskId} is not available`);
    return activeTask;
  }

  return tasks.find(candidate => !completedTaskIds.has(candidate.id));
}

function activeRepairScores(scoreHistory: MigrationSession["scoreHistory"]): number[] {
  let streakStart = scoreHistory.length;
  for (let index = scoreHistory.length - 1; index >= 0; index--) {
    if (scoreHistory[index]!.decision !== "FAILED") {
      break;
    }
    streakStart = index;
  }
  return scoreHistory.slice(streakStart).map(entry => entry.score);
}

export function buildMigrationLoop(dependencies: MigrationLoopDependencies): {
  runNext(context: MigrationLoopContext): Promise<MigrationLoopContext>;
} {
  return {
    async runNext(context) {
      const profileId = requireApprovedArchitecture(context.architectureDecision);

      if (context.session.approvedCriteriaRevision !== context.session.criteriaRevision) {
        throw new Error("Criteria approval is required before execution");
      }

      const tasks = context.tasks.length > 0
        ? context.tasks
        : await dependencies.target.plan(context.inventory, context.architectureDecision!);
      const task = selectTask(context.session, tasks);

      if (!task) {
        const completedSession = migrationSessionSchema.parse({
          ...context.session,
          stage: "COMPLETED",
          activeTaskId: undefined,
          updatedAt: new Date().toISOString(),
        });
        const completedContext: MigrationLoopContext = {
          ...context,
          session: completedSession,
          tasks,
        };
        await dependencies.checkpointStore.save(completedSession.id, "session-completed", completedContext);
        await dependencies.trace("session.completed", {
          sessionId: completedSession.id,
          completedTaskIds: completedSession.completedTaskIds,
        });
        await dependencies.sessionStore.save(completedSession);
        return completedContext;
      }

      const execution = await dependencies.target.execute(task, context.inventory);
      const evidence = await dependencies.target.verify(task);
      const evaluation = evaluateCriteria(dependencies.criteria, evidence, dependencies.passThreshold);
      const iteration = context.session.iteration + 1;
      const scoreHistory = [
        ...context.session.scoreHistory,
        { iteration, score: evaluation.score, decision: evaluation.decision },
      ];
      const scores = activeRepairScores(scoreHistory);
      const exhausted = evaluation.decision === "FAILED" && shouldStopRepair({
        attempt: scores.length,
        maxAttempts: dependencies.maxRepairAttempts,
        scores,
        maxStagnantIterations: dependencies.maxStagnantIterations,
      });
      const completedTaskIds = evaluation.decision === "PASSED"
        ? [...context.session.completedTaskIds, task.id]
        : context.session.completedTaskIds;
      const session = migrationSessionSchema.parse({
        ...context.session,
        iteration,
        stage: nextStage({ exhausted, evaluation }),
        scoreHistory,
        completedTaskIds,
        activeTaskId: evaluation.decision === "PASSED" ? undefined : task.id,
        architectureDecisionId: context.architectureDecision?.id,
        updatedAt: new Date().toISOString(),
      });
      const nextContext: MigrationLoopContext = {
        ...context,
        session,
        tasks,
        lastExecution: execution,
        lastEvaluation: evaluation,
      };
      const iterationId = `iteration-${iteration}`;
      const artifactPath = `evidence/iteration-${formatIteration(iteration)}.json`;

      await dependencies.artifacts.saveJson(artifactPath, {
        sessionId: session.id,
        iteration,
        profileId,
        task,
        execution,
        evaluation,
      });
      await dependencies.checkpointStore.save(session.id, iterationId, nextContext);
      await dependencies.trace("iteration.completed", {
        iteration,
        taskId: task.id,
        evaluation,
      });
      await dependencies.sessionStore.save(session);

      return nextContext;
    },
  };
}
