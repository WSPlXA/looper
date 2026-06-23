import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

export type WorkspaceArtifactStore = {
  saveJson(relativePath: string, value: unknown): Promise<string>;
  loadJson(relativePath: string): Promise<unknown>;
};

export function buildWorkspaceArtifactStore(workspace: string): WorkspaceArtifactStore {
  const root = resolve(workspace, ".looper");

  function isInsideRoot(realRoot: string, candidate: string): boolean {
    const rel = relative(realRoot, candidate);
    return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
  }

  function target(relativePath: string): string {
    if (isAbsolute(relativePath)) throw new Error("Artifact path must be relative");
    const resolved = resolve(root, relativePath);
    const rel = relative(root, resolved);
    if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      throw new Error("Artifact path escapes .looper");
    }
    return resolved;
  }

  async function existingRootRealpath(): Promise<string | null> {
    try {
      const stats = await lstat(root);
      if (stats.isSymbolicLink()) throw new Error(".looper directory must not be a symlink");
      return realpath(root);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async function ensureRootRealpath(): Promise<string> {
    const existing = await existingRootRealpath();
    if (existing) return existing;
    await mkdir(root, { recursive: true });
    const stats = await lstat(root);
    if (stats.isSymbolicLink()) throw new Error(".looper directory must not be a symlink");
    return realpath(root);
  }

  async function assertParentInsideRoot(realRoot: string, filePath: string): Promise<void> {
    const parent = await realpath(dirname(filePath));
    if (!isInsideRoot(realRoot, parent)) throw new Error("Artifact path escapes .looper through symlink");
  }

  async function assertFileIsNotSymlink(filePath: string): Promise<boolean> {
    try {
      const stats = await lstat(filePath);
      if (stats.isSymbolicLink()) throw new Error("Artifact path must not be a symlink");
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }

  return {
    async saveJson(relativePath, value) {
      const filePath = target(relativePath);
      const serialized = JSON.stringify(value, null, 2);
      if (serialized === undefined) throw new Error("Artifact value must be valid JSON");
      const rootRealpath = await ensureRootRealpath();
      await mkdir(dirname(filePath), { recursive: true });
      await assertParentInsideRoot(rootRealpath, filePath);
      await assertFileIsNotSymlink(filePath);
      const temporary = `${filePath}.${randomUUID()}.tmp`;
      await writeFile(temporary, `${serialized}\n`, "utf8");
      await rename(temporary, filePath);
      return filePath;
    },

    async loadJson(relativePath) {
      const filePath = target(relativePath);
      const rootRealpath = await existingRootRealpath();
      if (!rootRealpath) throw new Error(".looper directory does not exist");
      await assertParentInsideRoot(rootRealpath, filePath);
      await assertFileIsNotSymlink(filePath);
      return JSON.parse(await readFile(filePath, "utf8")) as unknown;
    },
  };
}
