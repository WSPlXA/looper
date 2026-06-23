import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildFileSessionStore } from "../../src/core/session/file-session-store.js";
import { migrationSessionSchema, type MigrationSession } from "../../src/core/session/migration-session.js";
import { buildWorkspaceArtifactStore } from "../../src/core/session/workspace-artifact-store.js";

function buildSession(workspace: string, overrides: Partial<MigrationSession> = {}): MigrationSession {
  return migrationSessionSchema.parse({
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
    ...overrides,
  });
}

describe("file session store", () => {
  it("saves and resumes the last durable session", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "looper-session-"));
    const store = buildFileSessionStore(workspace);
    const session = buildSession(workspace);

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

  it("does not let a symlinked .looper directory escape session persistence", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "looper-session-"));
    const outside = await mkdtemp(join(tmpdir(), "looper-outside-"));
    await symlink(outside, join(workspace, ".looper"), "dir");

    const store = buildFileSessionStore(workspace);
    await expect(store.save(buildSession(workspace))).rejects.toThrow(/symlink|escapes \.looper/);

    await writeFile(join(outside, "session.json"), `${JSON.stringify(buildSession(workspace))}\n`, "utf8");
    await expect(store.load()).rejects.toThrow(/symlink|escapes \.looper/);
  });

  it("does not let symlinked artifact paths escape the workspace", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "looper-session-"));
    const outside = await mkdtemp(join(tmpdir(), "looper-outside-"));
    await mkdir(join(workspace, ".looper"));
    await symlink(outside, join(workspace, ".looper/decisions"), "dir");
    await writeFile(join(outside, "leak.json"), JSON.stringify({ secret: true }), "utf8");

    const artifacts = buildWorkspaceArtifactStore(workspace);
    await expect(artifacts.saveJson("decisions/result.json", {})).rejects.toThrow(/symlink|escapes \.looper/);
    await expect(artifacts.loadJson("decisions/leak.json")).rejects.toThrow(/symlink|escapes \.looper/);
  });

  it("uses unique temporary files for concurrent session saves", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "looper-session-"));
    const store = buildFileSessionStore(workspace);
    const sessions = Array.from({ length: 50 }, (_, index) =>
      buildSession(workspace, {
        id: `session-${index}`,
        iteration: index,
        updatedAt: `2026-06-23T00:00:${String(index).padStart(2, "0")}.000Z`,
      }),
    );

    await expect(Promise.all(sessions.map((session) => store.save(session)))).resolves.toHaveLength(sessions.length);
    await expect(store.load()).resolves.toSatisfy((session) => sessions.some(({ id }) => id === session?.id));
  });

  it("allows artifact names beginning with two dots without allowing parent traversal", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "looper-session-"));
    const artifacts = buildWorkspaceArtifactStore(workspace);

    await artifacts.saveJson("..metadata.json", { ok: true });
    await expect(artifacts.loadJson("..metadata.json")).resolves.toEqual({ ok: true });
    await expect(artifacts.saveJson("../escape.json", {})).rejects.toThrow("escapes .looper");
  });

  it("rejects undefined artifact values before writing invalid JSON", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "looper-session-"));
    const artifacts = buildWorkspaceArtifactStore(workspace);

    await expect(artifacts.saveJson("undefined.json", undefined)).rejects.toThrow("Artifact value must be valid JSON");
  });
});
