import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildFileSessionStore } from "../../src/core/session/file-session-store.js";
import { migrationSessionSchema } from "../../src/core/session/migration-session.js";
import { buildWorkspaceArtifactStore } from "../../src/core/session/workspace-artifact-store.js";

describe("file session store", () => {
  it("saves and resumes the last durable session", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "looper-session-"));
    const store = buildFileSessionStore(workspace);
    const session = migrationSessionSchema.parse({
      id: "session-1",
      workspace,
      stage: "DISCOVERY",
      iteration: 0,
      criteriaRevision: 0,
      scoreHistory: [],
      completedTaskIds: [],
      risks: [],
      createdAt: "2026-06-23T00:00:00.000Z",
      updatedAt: "2026-06-23T00:00:00.000Z",
    });

    await store.save(session);
    await expect(store.load()).resolves.toEqual(session);
    expect(JSON.parse(await readFile(join(workspace, ".looper/session.json"), "utf8"))).toEqual(session);

    const artifacts = buildWorkspaceArtifactStore(workspace);
    await artifacts.saveJson("decisions/target-architecture.yaml", { profileId: "hollow-skinny-v1" });
    await expect(artifacts.loadJson("decisions/target-architecture.yaml")).resolves.toEqual({
      profileId: "hollow-skinny-v1",
    });
    await expect(artifacts.saveJson("../escape.json", {})).rejects.toThrow("escapes .looper");
  });
});
