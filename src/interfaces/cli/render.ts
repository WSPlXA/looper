import type { MigrationTask } from "../../core/adapters/target-adapter.js";
import type { TargetArchitectureProfile } from "../../core/architecture/target-profile.js";
import type { CriteriaEvaluation, Criterion } from "../../core/criteria/criteria.types.js";
import type { MigrationLoopContext } from "../../core/loop/migration-loop.js";
import type { MigrationSession } from "../../core/session/migration-session.js";

function indent(lines: readonly string[], prefix = "  "): string {
  return lines.map(line => `${prefix}${line}`).join("\n");
}

function renderRisks(risks: readonly string[]): string {
  if (risks.length === 0) return "Risks: none recorded";
  return `Risks:\n${indent(risks.map(risk => `- ${risk}`))}`;
}

function nextActionFor(session: MigrationSession): string {
  if (!session.architectureDecisionId) return "Next action: review /architectures, then /approve architecture <profile-id>";
  if (session.approvedCriteriaRevision !== session.criteriaRevision) return `Next action: review /criteria, then /approve criteria ${session.criteriaRevision}`;
  if (session.stage === "PAUSED") return "Next action: /resume";
  if (session.stage === "COMPLETED") return "Next action: inspect .looper/evidence and generated project output";
  if (session.stage === "NEEDS_REVIEW") return "Next action: inspect /score evidence and decide whether to continue";
  if (session.stage === "BLOCKED") return "Next action: inspect /score blocked reasons and resolve the blocker";
  return "Next action: /run <task-id> to execute one migration iteration";
}

export function renderHelp(): string {
  return [
    "Looper terminal agent commands:",
    "  /architectures                 list target architecture candidates",
    "  /approve architecture <id>      approve a target architecture profile",
    "  /criteria                      show executable criteria",
    "  /approve criteria <revision>    approve criteria before execution",
    "  /plan                          show and persist the current migration plan",
    "  /run <task-id>                  run exactly one migration-loop iteration",
    "  /diff                          show files changed by the last iteration",
    "  /score                         show the last score, decision, and evidence",
    "  /status                        show durable session status",
    "  /pause                         save durable PAUSED state",
    "  /resume                        reload the last saved session",
    "  /exit                          close the terminal session",
  ].join("\n");
}

export function renderSession(session: MigrationSession): string {
  const lastScore = session.scoreHistory.at(-1);
  return [
    `Session: ${session.id}`,
    `Workspace: ${session.workspace}`,
    `Stage: ${session.stage}`,
    `Iteration: ${session.iteration}`,
    `Architecture: ${session.architectureDecisionId ?? "not approved"}`,
    `Criteria revision: ${session.criteriaRevision}${session.approvedCriteriaRevision === session.criteriaRevision ? " (approved)" : " (pending approval)"}`,
    `Active task: ${session.activeTaskId ?? "none"}`,
    `Completed tasks: ${session.completedTaskIds.length}`,
    `Last score: ${lastScore ? `${lastScore.score} (${lastScore.decision})` : "none"}`,
    renderRisks(session.risks),
    nextActionFor(session),
  ].join("\n");
}

export function renderArchitectures(profiles: readonly TargetArchitectureProfile[]): string {
  return [
    "Target architecture candidates:",
    ...profiles.map(profile => [
      `- ${profile.id}: ${profile.name}`,
      `  ${profile.description}`,
      ...profile.moduleBoundaries.map(boundary => `  boundary: ${boundary}`),
    ].join("\n")),
  ].join("\n");
}

export function renderCriteria(criteria: readonly Criterion[], session: MigrationSession): string {
  return [
    `Criteria revision ${session.criteriaRevision}${session.approvedCriteriaRevision === session.criteriaRevision ? " (approved)" : " (pending approval)"}`,
    ...criteria.map(criterion =>
      `- ${criterion.id} [${criterion.kind}/${criterion.category}] weight=${criterion.weight} confidence>=${criterion.requiredConfidence}`,
    ),
    `Approve with: /approve criteria ${session.criteriaRevision}`,
  ].join("\n");
}

export function renderPlan(tasks: readonly MigrationTask[], session: MigrationSession): string {
  if (!session.architectureDecisionId) {
    return [
      "No executable plan yet: architecture approval is required first.",
      "Use /architectures, then /approve architecture <profile-id>.",
    ].join("\n");
  }
  if (tasks.length === 0) return "Plan: no migration tasks were discovered.";
  return [
    "Migration plan:",
    ...tasks.map(task => [
      `- ${task.id}`,
      `  programs: ${task.programIds.join(", ") || "none"}`,
      `  allowed paths: ${task.allowedPaths.join(", ") || "none"}`,
      `  status: ${session.completedTaskIds.includes(task.id) ? "completed" : task.id === session.activeTaskId ? "active" : "pending"}`,
    ].join("\n")),
    nextActionFor(session),
  ].join("\n");
}

export function renderEvaluation(evaluation: CriteriaEvaluation | undefined): string {
  if (!evaluation) return "No score is available yet. Run /run after approvals.";
  const evidence = evaluation.results.flatMap(result =>
    result.evidence.map(item => `- ${result.criterionId}: ${item}`),
  );
  return [
    `Score: ${evaluation.score}`,
    `Decision: ${evaluation.decision}`,
    `Confidence: ${evaluation.confidence}`,
    `Hard gates passed: ${evaluation.hardGatesPassed}`,
    evaluation.blockedReasons.length ? `Blocked reasons:\n${indent(evaluation.blockedReasons.map(reason => `- ${reason}`))}` : "Blocked reasons: none",
    evaluation.missingCriterionIds.length ? `Missing criteria:\n${indent(evaluation.missingCriterionIds.map(id => `- ${id}`))}` : "Missing criteria: none",
    evidence.length ? `Evidence:\n${indent(evidence)}` : "Evidence: none",
  ].join("\n");
}

export function renderRunResult(context: MigrationLoopContext): string {
  return [
    "Iteration finished.",
    renderSession(context.session),
    renderEvaluation(context.lastEvaluation),
  ].join("\n\n");
}

export function renderDiff(context: MigrationLoopContext): string {
  const changedFiles = context.lastExecution?.changedFiles ?? [];
  if (changedFiles.length === 0) return "No changed files recorded for the last iteration.";
  return `Changed files:\n${indent(changedFiles.map(file => `- ${file}`))}`;
}
