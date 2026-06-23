import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

export type WorkspaceArtifactStore = {
  saveJson(relativePath: string, value: unknown): Promise<string>;
  loadJson(relativePath: string): Promise<unknown>;
};

export function buildWorkspaceArtifactStore(workspace: string): WorkspaceArtifactStore {
  const root = resolve(workspace, ".looper");

  function target(relativePath: string): string {
    if (isAbsolute(relativePath)) throw new Error("Artifact path must be relative");
    const resolved = resolve(root, relativePath);
    const rel = relative(root, resolved);
    if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("Artifact path escapes .looper");
    return resolved;
  }

  return {
    async saveJson(relativePath, value) {
      const filePath = target(relativePath);
      await mkdir(dirname(filePath), { recursive: true });
      const temporary = `${filePath}.${process.pid}.tmp`;
      await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
      await rename(temporary, filePath);
      return filePath;
    },

    async loadJson(relativePath) {
      return JSON.parse(await readFile(target(relativePath), "utf8")) as unknown;
    },
  };
}
