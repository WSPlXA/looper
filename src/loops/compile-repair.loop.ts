import { buildFileCheckpointStore } from "../core/checkpoint/file-checkpoint.store.js";
import { GraphRunner } from "../core/graph/graph.runner.js";
import type { StateStore } from "../core/storage/state-store.js";
import type { MigrationState } from "../schemas/migration-state.schema.js";
import { buildClassifyRepairGraphNodes } from "./compile-repair.nodes.js";
import type { MigrationGraphDependencies } from "../nodes/migration-node.dependencies.js";
import { buildJavaArchitecturePolicy } from "../architecture/java/architecture-validator.js";
import { plainJavaSingleClassV1 } from "../architecture/java/target-java-profile.js";

export function buildCompileRepairLoop(options: Pick<MigrationGraphDependencies, "javac" | "repair" | "optionalVerify"> & {
  stateStore: StateStore<MigrationState>;
  trace: (type: string, data?: unknown) => Promise<void>;
}) {
  return async (initialState: MigrationState): Promise<MigrationState> => {
    if (!initialState.currentJavaCode) throw new Error("Compile repair requires generated Java code");
    const nodes = buildClassifyRepairGraphNodes({ ...options, architecturePolicy: buildJavaArchitecturePolicy(plainJavaSingleClassV1) });
    const runner = new GraphRunner<MigrationState>(nodes, "compile", initialState.maxAttempts * 4 + 4);
    return runner.run(initialState, {
      runId: initialState.runId,
      stateStore: options.stateStore,
      checkpointStore: buildFileCheckpointStore(initialState.runDir),
      trace: options.trace,
    });
  };
}
