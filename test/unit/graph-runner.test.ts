import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { buildFileCheckpointStore } from "../../src/core/checkpoint/file-checkpoint.store.js";
import { GraphRunner } from "../../src/core/graph/graph.runner.js";
import type { GraphNode } from "../../src/core/graph/graph.node.js";
import { buildFileStateStore } from "../../src/core/storage/file-state-store.js";

describe("GraphRunner", () => {
  it("persists state and a checkpoint after every node", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "graph-runner-"));
    type State = { count: number };
    const first: GraphNode<State> = { name: "sourceIntake", run: async (state) => ({ state: { count: state.count + 1 }, next: "report", status: "SUCCEEDED" }) };
    const report: GraphNode<State> = { name: "report", run: async (state) => ({ state: { count: state.count + 1 }, next: "END", status: "SUCCEEDED" }) };
    const checkpointStore = buildFileCheckpointStore<State>(runDir);
    const trace = vi.fn(async () => undefined);
    const result = await new GraphRunner({ sourceIntake: first, report }, "sourceIntake").run({ count: 0 }, {
      runId: "run", stateStore: buildFileStateStore(join(runDir, "state.json")), checkpointStore, trace,
    });
    expect(result.count).toBe(2);
    expect((await readdir(join(runDir, "checkpoints"))).filter((name) => name.endsWith(".json"))).toHaveLength(2);
    await expect(checkpointStore.loadLatest("run")).resolves.toEqual({ count: 2 });
    expect(trace).toHaveBeenCalledWith("state.transition", expect.objectContaining({ from: "sourceIntake", to: "report" }));
  });
});
