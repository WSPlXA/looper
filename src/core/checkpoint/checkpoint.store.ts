export interface CheckpointStore<S> {
  save(runId: string, node: string, state: S): Promise<void>;
  loadLatest(runId: string): Promise<S | null>;
}
