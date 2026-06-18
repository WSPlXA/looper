import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CheckpointStore } from "./checkpoint.store.js";

type CheckpointEnvelope<S> = {
  sequence: number;
  runId: string;
  node: string;
  savedAt: string;
  state: S;
};

export function buildFileCheckpointStore<S>(runDir: string): CheckpointStore<S> {
  const checkpointDir = join(runDir, "checkpoints");
  let nextSequence: number | undefined;

  async function discoverNextSequence(): Promise<number> {
    try {
      const names = await readdir(checkpointDir);
      const last = names.filter((name) => /^\d{6}-/.test(name)).sort().at(-1);
      return last ? Number.parseInt(last.slice(0, 6), 10) + 1 : 0;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
      throw error;
    }
  }

  return {
    async save(runId, node, state) {
      await mkdir(checkpointDir, { recursive: true });
      nextSequence ??= await discoverNextSequence();
      const sequence = nextSequence++;
      const safeNode = node.replace(/[^A-Za-z0-9_-]/g, "_");
      const filePath = join(checkpointDir, `${String(sequence).padStart(6, "0")}-${safeNode}.json`);
      const temporary = `${filePath}.${process.pid}.tmp`;
      const envelope: CheckpointEnvelope<S> = { sequence, runId, node, savedAt: new Date().toISOString(), state };
      await writeFile(temporary, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");
      await rename(temporary, filePath);
    },
    async loadLatest() {
      try {
        const name = (await readdir(checkpointDir)).filter((entry) => /^\d{6}-.*\.json$/.test(entry)).sort().at(-1);
        if (!name) return null;
        const envelope = JSON.parse(await readFile(join(checkpointDir, name), "utf8")) as CheckpointEnvelope<S>;
        return envelope.state;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    },
  };
}
