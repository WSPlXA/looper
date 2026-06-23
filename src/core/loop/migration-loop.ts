import { requireApprovedArchitecture } from "../architecture/architecture-decision.js";
import type { ArchitectureDecision } from "../architecture/architecture-decision.js";
import { evaluateCriteria } from "../criteria/criteria-engine.js";
import type { Criterion, CriteriaEvaluation } from "../criteria/criteria.types.js";
import type { MigrationSession } from "../session/migration-session.js";
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
      const task = tasks.find(candidate => !context.session.completedTaskIds.includes(candidate.id));

      if (!task) {
        const completedSession: MigrationSession = {
          ...context.session,
          stage: "COMPLETED",
          activeTaskId: undefined,
          updatedAt: new Date().toISOString(),
        };
        const completedContext: MigrationLoopContext = {
          ...context,
          session: completedSession,
          tasks,
        };
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
      const exhausted = evaluation.decision !== "PASSED" && shouldStopRepair({
        attempt: iteration,
        maxAttempts: dependencies.maxRepairAttempts,
        scores: scoreHistory.map(score => score.score),
        maxStagnantIterations: dependencies.maxStagnantIterations,
      });
      const completedTaskIds = evaluation.decision === "PASSED"
        ? [...context.session.completedTaskIds, task.id]
        : context.session.completedTaskIds;
      const session: MigrationSession = {
        ...context.session,
        iteration,
        stage: nextStage({ exhausted, evaluation }),
        scoreHistory,
        completedTaskIds,
        activeTaskId: evaluation.decision === "PASSED" ? undefined : task.id,
        architectureDecisionId: context.architectureDecision?.id,
        updatedAt: new Date().toISOString(),
      };
      const nextContext: MigrationLoopContext = {
        ...context,
        session,
        tasks,
        lastExecution: execution,
        lastEvaluation: evaluation,
      };
      const iterationId = `iteration-${iteration}`;
      const artifactPath = `evidence/iteration-${formatIteration(iteration)}.json`;

      await dependencies.sessionStore.save(session);
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
        sessionId: session.id,
        iteration,
        taskId: task.id,
        decision: evaluation.decision,
        score: evaluation.score,
      });

      return nextContext;
    },
  };
}
