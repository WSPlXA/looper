import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { ModelClient } from "../core/model/model-client.js";
import { GraphExecutionError, GraphRunner } from "../core/graph/graph.runner.js";
import type { GraphNode } from "../core/graph/graph.node.js";
import type { GraphNodeName } from "../core/graph/graph.types.js";
import { buildFileStateStore } from "../core/storage/file-state-store.js";
import { buildFileCheckpointStore } from "../core/checkpoint/file-checkpoint.store.js";
import { buildTraceLogger } from "../core/trace/trace-logger.js";
import { assemblyMigrationStateSchema, type AssemblyMigrationState } from "../schemas/assembly-state.schema.js";
import { buildJavacTool } from "../tools/javac.tool.js";
import type { AssemblyGraphDependencies } from "../nodes/assembly/assembly-node.dependencies.js";
import { scanSubprogramsNode } from "../nodes/assembly/scan-subprograms.node.js";
import { expandCopybooksNode } from "../nodes/assembly/expand-copybooks.node.js";
import { extractCallGraphNode } from "../nodes/assembly/extract-call-graph.node.js";
import { buildTranslateSubprogramsNode } from "../nodes/assembly/translate-subprograms.node.js";
import { assembleProgramNode } from "../nodes/assembly/assemble-program.node.js";
import { buildCompileAssemblyNode } from "../nodes/assembly/compile-assembly.node.js";
import { classifyAssemblyErrorNode } from "../nodes/assembly/classify-assembly-error.node.js";
import { buildRepairAssemblyNode } from "../nodes/assembly/repair-assembly.node.js";
import { reportAssemblyNode } from "../nodes/assembly/report-assembly.node.js";

export type CallGraphWorkflowResult = {
  state: AssemblyMigrationState;
  reportPath: string;
};

function buildAssemblyRunId(): string {
  const prefix = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  return `assembly-${prefix}-${randomUUID().slice(0, 8)}`;
}

function buildAssemblyNodes(
  deps: AssemblyGraphDependencies,
): Partial<Record<GraphNodeName, GraphNode<AssemblyMigrationState>>> {
  return {
    scanSubprograms: scanSubprogramsNode,
    expandCopybooks: expandCopybooksNode,
    extractCallGraph: extractCallGraphNode,
    translateSubprograms: buildTranslateSubprogramsNode(deps),
    assembleProgram: assembleProgramNode,
    compileAssembly: buildCompileAssemblyNode(deps),
    classifyAssemblyError: classifyAssemblyErrorNode,
    repairAssembly: buildRepairAssemblyNode(deps),
    reportAssembly: reportAssemblyNode,
  };
}

// maxTransitions budget: translation loop is internal — each top-level node counts once.
// scan → expand → extract → translate → assemble → (compile → classify → repair) * N → report
// = 5 + 3 * maxRepairAttempts + 2 headroom
function calcMaxTransitions(maxRepairAttempts: number): number {
  return 5 + 3 * maxRepairAttempts + 5;
}

export async function runCobolCallGraphToJavaWorkflow(
  input: {
    sourceDir: string;
    outputDir: string;
    outputClassName: string;
    maxTranslationAttempts?: number;
    maxRepairAttempts?: number;
  },
  dependencies: {
    model: ModelClient;
    runsDir?: string;
    javacTimeoutMs?: number;
    translationConcurrency?: number;
  },
): Promise<CallGraphWorkflowResult> {
  const sourceDir = resolve(input.sourceDir);
  const outputDir = resolve(input.outputDir);
  const runId = buildAssemblyRunId();
  const runDir = resolve(dependencies.runsDir ?? "./runs", runId);

  await mkdir(runDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });

  const maxRepairAttempts = input.maxRepairAttempts ?? 5;
  const stateStore = buildFileStateStore<AssemblyMigrationState>(join(runDir, "state.json"));
  const checkpointStore = buildFileCheckpointStore<AssemblyMigrationState>(runDir);
  const trace = buildTraceLogger(join(runDir, "trace.jsonl"), runId);

  let state = assemblyMigrationStateSchema.parse({
    runId,
    runDir,
    sourceDir,
    outputDir,
    outputClassName: input.outputClassName,
    status: "CREATED",
    maxTranslationAttempts: input.maxTranslationAttempts ?? 3,
    maxRepairAttempts,
  });

  const javac = buildJavacTool(dependencies.javacTimeoutMs);
  const deps: AssemblyGraphDependencies = {
    model: dependencies.model,
    javac,
    ...(dependencies.translationConcurrency !== undefined ? { translationConcurrency: dependencies.translationConcurrency } : {}),
  };
  const context = { runId, stateStore, checkpointStore, trace };

  await stateStore.save(state);
  await trace("workflow.started", { sourceDir, outputClassName: input.outputClassName });

  try {
    state = await new GraphRunner(
      buildAssemblyNodes(deps),
      "scanSubprograms",
      calcMaxTransitions(maxRepairAttempts),
    ).run(state, context);
  } catch (error) {
    const failedState = error instanceof GraphExecutionError ? (error.state as AssemblyMigrationState) : state;
    const message =
      error instanceof GraphExecutionError && error.cause instanceof Error
        ? `${error.message}: ${error.cause.message}`
        : error instanceof Error ? error.message : String(error);
    state = { ...failedState, status: "FAILED", failureReason: message };
    await trace("workflow.failed", { error: message });
    state = await new GraphRunner<AssemblyMigrationState>(
      { reportAssembly: reportAssemblyNode },
      "reportAssembly",
      1,
    ).run(state, context);
  }

  if (!state.reportPath) throw new Error("reportAssemblyNode completed without reportPath");
  await trace("workflow.completed", { status: state.status, reportPath: state.reportPath });
  return { state, reportPath: state.reportPath };
}
