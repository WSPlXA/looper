import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { buildCobolMigrationAgent, buildPlanningAgent } from "../agents/cobol-migration-agent.js";
import { buildJavaRepairAgent } from "../agents/java-repair-agent.js";
import { buildFileCheckpointStore } from "../core/checkpoint/file-checkpoint.store.js";
import { GraphExecutionError, GraphRunner } from "../core/graph/graph.runner.js";
import type { GraphNode } from "../core/graph/graph.node.js";
import type { GraphNodeName } from "../core/graph/graph.types.js";
import type { ModelClient } from "../core/model/model-client.js";
import { buildFileStateStore } from "../core/storage/file-state-store.js";
import { buildTraceLogger } from "../core/trace/trace-logger.js";
import { analyzeCobolNode } from "../nodes/analyze-cobol.node.js";
import { capabilityGateNode } from "../nodes/capability-gate.node.js";
import { classifyErrorNode } from "../nodes/classify-error.node.js";
import { buildCompileNode } from "../nodes/compile.node.js";
import { buildGenerateJavaNode } from "../nodes/generate-java.node.js";
import type { MigrationGraphDependencies } from "../nodes/migration-node.dependencies.js";
import { buildPlanMigrationNode } from "../nodes/plan-migration.node.js";
import { buildRepairNode } from "../nodes/repair.node.js";
import { reportNode } from "../nodes/report.node.js";
import { sourceIntakeNode } from "../nodes/source-intake.node.js";
import { buildVerifyNode } from "../nodes/verify.node.js";
import { migrationStateSchema, type MigrationState } from "../schemas/migration-state.schema.js";
import { buildJavacTool } from "../tools/javac.tool.js";
import { buildJavaArchitecturePolicy } from "../architecture/java/architecture-validator.js";
import { plainJavaSingleClassV1, type TargetJavaProfile } from "../architecture/java/target-java-profile.js";
import { buildResolveJavaArchitectureNode } from "../nodes/resolve-java-architecture.node.js";

export type WorkflowResult = { state: MigrationState; reportPath: string };

function buildRunId(now = new Date()): string {
  const prefix = now.toISOString().replace(/[-:T]/g, "").slice(0, 14);
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

function buildMigrationGraphNodes(dependencies: MigrationGraphDependencies): Partial<Record<GraphNodeName, GraphNode<MigrationState>>> {
  return {
    sourceIntake: sourceIntakeNode,
    capabilityGate: capabilityGateNode,
    analyzeCobol: analyzeCobolNode,
    resolveJavaArchitecture: buildResolveJavaArchitectureNode(dependencies),
    planMigration: buildPlanMigrationNode(dependencies),
    generateJava: buildGenerateJavaNode(dependencies),
    compile: buildCompileNode(dependencies),
    classifyError: classifyErrorNode,
    repair: buildRepairNode(dependencies),
    verify: buildVerifyNode(dependencies),
    report: reportNode,
  };
}

export async function runCobolToJavaSingleFileWorkflow(input: {
  sourceFile: string;
  outputDir: string;
  className: string;
  maxAttempts?: number;
}, dependencies: {
  model: ModelClient;
  runsDir?: string;
  javacTimeoutMs?: number;
  optionalVerify?: MigrationGraphDependencies["optionalVerify"];
  targetJavaProfile?: TargetJavaProfile;
}): Promise<WorkflowResult> {
  const runId = buildRunId();
  const runDir = resolve(dependencies.runsDir ?? "./runs", runId);
  const stateStore = buildFileStateStore<MigrationState>(join(runDir, "state.json"));
  const checkpointStore = buildFileCheckpointStore<MigrationState>(runDir);
  const trace = buildTraceLogger(join(runDir, "trace.jsonl"), runId);
  let state = migrationStateSchema.parse({
    runId,
    runDir,
    sourceFile: resolve(input.sourceFile),
    outputDir: resolve(input.outputDir),
    className: input.className,
    cobolSource: "",
    attempts: [],
    classifications: [],
    status: "CREATED",
    maxAttempts: input.maxAttempts ?? 5,
  });
  const graphDependencies: MigrationGraphDependencies = {
    architecturePolicy: buildJavaArchitecturePolicy(dependencies.targetJavaProfile ?? plainJavaSingleClassV1),
    plan: buildPlanningAgent(dependencies.model),
    generate: buildCobolMigrationAgent(dependencies.model),
    repair: buildJavaRepairAgent(dependencies.model),
    javac: buildJavacTool(dependencies.javacTimeoutMs),
    ...(dependencies.optionalVerify ? { optionalVerify: dependencies.optionalVerify } : {}),
  };
  const context = { runId, stateStore, checkpointStore, trace };
  await stateStore.save(state);
  await trace("workflow.started", { sourceFile: state.sourceFile, className: state.className, maxAttempts: state.maxAttempts });
  try {
    state = await new GraphRunner(buildMigrationGraphNodes(graphDependencies), "sourceIntake", state.maxAttempts * 4 + 10).run(state, context);
  } catch (error) {
    const failedState = error instanceof GraphExecutionError ? error.state : state;
    const message = error instanceof GraphExecutionError && error.cause instanceof Error
      ? `${error.message}: ${error.cause.message}`
      : error instanceof Error ? error.message : String(error);
    state = { ...failedState, status: "FAILED", failureReason: message, terminal: { status: "FAILED", reason: message } };
    await trace("workflow.failed", { error: message });
    state = await new GraphRunner<MigrationState>({ report: reportNode }, "report", 1).run(state, context);
  }
  if (!state.reportPath) throw new Error("ReportNode completed without reportPath");
  await trace("workflow.completed", { status: state.status, reportPath: state.reportPath });
  return { state, reportPath: state.reportPath };
}
