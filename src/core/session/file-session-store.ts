import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { migrationSessionSchema, type MigrationSession } from "./migration-session.js";

export type SessionStore = {
  load(): Promise<MigrationSession | null>;
  save(session: MigrationSession): Promise<void>;
};

export function buildFileSessionStore(workspace: string): SessionStore {
  const directory = resolve(workspace, ".looper");
  const filePath = join(directory, "session.json");

  async function existingDirectoryRealpath(): Promise<string | null> {
    try {
      const stats = await lstat(directory);
      if (stats.isSymbolicLink()) throw new Error(".looper directory must not be a symlink");
      return realpath(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async function ensureDirectoryRealpath(): Promise<string> {
    const existing = await existingDirectoryRealpath();
    if (existing) return existing;
    await mkdir(directory, { recursive: true });
    const stats = await lstat(directory);
    if (stats.isSymbolicLink()) throw new Error(".looper directory must not be a symlink");
    return realpath(directory);
  }

  async function assertSessionFileIsNotSymlink(): Promise<boolean> {
    try {
      const stats = await lstat(filePath);
      if (stats.isSymbolicLink()) throw new Error("Session file must not be a symlink");
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }

  return {
    async load() {
      const rootRealpath = await existingDirectoryRealpath();
      if (!rootRealpath) return null;
      if (!(await assertSessionFileIsNotSymlink())) return null;
      return migrationSessionSchema.parse(JSON.parse(await readFile(filePath, "utf8")));
    },

    async save(session) {
      await ensureDirectoryRealpath();
      await assertSessionFileIsNotSymlink();
      const validated = migrationSessionSchema.parse(session);
      const temporary = `${filePath}.${randomUUID()}.tmp`;
      await writeFile(temporary, `${JSON.stringify(validated, null, 2)}\n`, "utf8");
      await rename(temporary, filePath);
    },
  };
}
