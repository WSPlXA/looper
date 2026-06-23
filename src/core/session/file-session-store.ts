import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { migrationSessionSchema, type MigrationSession } from "./migration-session.js";

export type SessionStore = {
  load(): Promise<MigrationSession | null>;
  save(session: MigrationSession): Promise<void>;
};

export function buildFileSessionStore(workspace: string): SessionStore {
  const directory = join(workspace, ".looper");
  const filePath = join(directory, "session.json");

  return {
    async load() {
      try {
        return migrationSessionSchema.parse(JSON.parse(await readFile(filePath, "utf8")));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    },

    async save(session) {
      await mkdir(directory, { recursive: true });
      const validated = migrationSessionSchema.parse(session);
      const temporary = `${filePath}.${process.pid}.tmp`;
      await writeFile(temporary, `${JSON.stringify(validated, null, 2)}\n`, "utf8");
      await rename(temporary, filePath);
    },
  };
}
