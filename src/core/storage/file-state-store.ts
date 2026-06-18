import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { StateStore } from "./state-store.js";

export function buildFileStateStore<S>(filePath: string): StateStore<S> {
  return {
    async save(state) {
      await mkdir(dirname(filePath), { recursive: true });
      const temporary = `${filePath}.${process.pid}.tmp`;
      await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
      await rename(temporary, filePath);
    },
  };
}
