import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildCobolSourceAdapter } from "../../src/adapters/source/cobol/cobol-source-adapter.js";
import { buildSpringBootTargetAdapter } from "../../src/adapters/target/spring-boot/spring-boot-target-adapter.js";
import { approveArchitecture } from "../../src/core/architecture/architecture-decision.js";
import { buildFileCheckpointStore } from "../../src/core/checkpoint/file-checkpoint.store.js";
import { buildMigrationLoop, type MigrationLoopContext } from "../../src/core/loop/migration-loop.js";
import type { ModelClient } from "../../src/core/model/model-client.js";
import { buildFileSessionStore } from "../../src/core/session/file-session-store.js";
import { migrationSessionSchema } from "../../src/core/session/migration-session.js";
import { buildWorkspaceArtifactStore } from "../../src/core/session/workspace-artifact-store.js";
import { hollowSkinnyProfile } from "../../src/profiles/hollow-skinny/hollow-skinny.profile.js";
import { buildMavenTestTool } from "../../src/tools/maven.tool.js";

const fixtureRoot = fileURLToPath(new URL("../fixtures/legacy-project", import.meta.url));

function methodNameFor(programId: string): string {
  const parts = programId.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return parts.map((part, index) =>
    index === 0 ? part : `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`,
  ).join("") || "translated";
}

function buildDeterministicModel(): ModelClient {
  return {
    async chat(input) {
      const prompt = input.messages.at(-1)?.content ?? "";
      const programId = /PROGRAM-ID:\s*([^\n]+)/.exec(prompt)?.[1]?.trim() ?? "UNKNOWN";
      const linkageRaw = /LINKAGE params \(\d+\):\s*([^\n]+)/.exec(prompt)?.[1] ?? "[]";
      const linkage = JSON.parse(linkageRaw) as Array<{ name: string }>;
      const params = linkage.map(item => ({
        name: item.name.toLowerCase().replace(/[^a-z0-9]+(.)?/g, (_match, next: string | undefined) =>
          next ? next.toUpperCase() : "",
        ),
        type: "int",
      }));
      const body = programId === "MAIN"
        ? [
          "context.put(\"MAIN.status\", \"S\");",
          "context.put(\"MAIN.amount\", 100);",
          "// TODO call PRICE()",
          "return 0;",
        ].join("\n")
        : [
          "int basePrice = 100;",
          "int finalPrice = basePrice + 25;",
          "context.put(\"PRICE.finalPrice\", finalPrice);",
          "return finalPrice;",
        ].join("\n");

      return {
        content: JSON.stringify({
          methodName: methodNameFor(programId),
          params,
          returnType: "int",
          body,
          notes: `deterministic ${programId} translation`,
        }),
        toolCalls: [],
        raw: {},
      };
    },
  };
}

describe("legacy migration loop", () => {
  it("migrates a legacy COBOL project through the approved hollow/skinny loop", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "looper-legacy-workspace-"));
    const outputDir = join(workspace, ".looper", "generated");
    await mkdir(dirname(outputDir), { recursive: true });

    const source = buildCobolSourceAdapter();
    const sessionStore = buildFileSessionStore(workspace);
    const artifacts = buildWorkspaceArtifactStore(workspace);
    const checkpointStore = buildFileCheckpointStore<MigrationLoopContext>(join(workspace, ".looper"));
    const target = buildSpringBootTargetAdapter({
      model: buildDeterministicModel(),
      outputDir,
      profile: hollowSkinnyProfile,
      maven: buildMavenTestTool(),
    });
    const loop = buildMigrationLoop({
      sessionStore,
      source,
      target,
      criteria: hollowSkinnyProfile.criteria,
      passThreshold: 90,
      maxRepairAttempts: 3,
      maxStagnantIterations: 2,
      checkpointStore,
      artifacts,
      trace: async () => {},
    });

    const inventory = await source.discover(fixtureRoot);
    const unapprovedSession = migrationSessionSchema.parse({
      id: "legacy-loop-session",
      workspace,
      stage: "ARCHITECTURE_REVIEW",
      iteration: 0,
      criteriaRevision: 1,
      scoreHistory: [],
      completedTaskIds: [],
      risks: inventory.risks,
      createdAt: "2026-06-23T00:00:00.000Z",
      updatedAt: "2026-06-23T00:00:00.000Z",
    });
    await sessionStore.save(unapprovedSession);
    const unapproved = { session: (await sessionStore.load())! };

    expect(unapproved.session.stage).toBe("ARCHITECTURE_REVIEW");

    const architectureDecision = approveArchitecture(
      hollowSkinnyProfile,
      "integration-test",
      "2026-06-23T00:00:00.000Z",
    );
    const approvedSession = migrationSessionSchema.parse({
      ...unapproved.session,
      architectureDecisionId: architectureDecision.id,
      approvedCriteriaRevision: 1,
      stage: "READY",
      updatedAt: "2026-06-23T00:00:01.000Z",
    });
    await sessionStore.save(approvedSession);
    const tasks = await target.plan(inventory, architectureDecision);
    let context: MigrationLoopContext = {
      session: approvedSession,
      inventory,
      architectureDecision,
      tasks,
    };

    const firstApprovedIteration = await loop.runNext(context);
    expect(firstApprovedIteration.session.completedTaskIds).toHaveLength(1);

    context = firstApprovedIteration;
    while (context.session.stage !== "COMPLETED") {
      expect(context.session.stage).not.toBe("BLOCKED");
      context = await loop.runNext(context);
    }
    const finalSession = context.session;

    expect(finalSession.stage).toBe("COMPLETED");
    expect(finalSession.scoreHistory.every(item => item.score >= 90)).toBe(true);
    expect(await readFile(join(outputDir, "pom.xml"), "utf8")).toContain("<module>hollow</module>");
    expect(await readFile(join(outputDir, "pom.xml"), "utf8")).toContain("<module>skinny</module>");
    expect(await readFile(join(outputDir, "skinny/src/main/resources/META-INF/services/generated.cobol.api.ProgramPlugin"), "utf8"))
      .toContain("MainPlugin");
    expect(await buildMavenTestTool().execute({ projectDir: outputDir })).toMatchObject({ success: true });
  }, 240_000);
});
