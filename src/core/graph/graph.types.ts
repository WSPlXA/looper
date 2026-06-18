import type { CheckpointStore } from "../checkpoint/checkpoint.store.js";
import type { StateStore } from "../storage/state-store.js";

export type NodeStatus = "READY" | "RUNNING" | "SUCCEEDED" | "FAILED" | "INTERRUPTED";

export type GraphNodeName =
  | "sourceIntake"
  | "capabilityGate"
  | "analyzeCobol"
  | "resolveJavaArchitecture"
  | "planMigration"
  | "generateJava"
  | "compile"
  | "classifyError"
  | "repair"
  | "verify"
  | "report";

export type GraphNext = GraphNodeName | "END";

export type NodeResult<S> = { state: S; next: GraphNext; status: NodeStatus };

export type GraphContext<S> = {
  runId: string;
  stateStore: StateStore<S>;
  checkpointStore: CheckpointStore<S>;
  trace: (type: string, data?: unknown) => Promise<void>;
  signal?: AbortSignal;
};
