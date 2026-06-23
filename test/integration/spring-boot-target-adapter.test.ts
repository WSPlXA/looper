import { access, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { buildSpringBootTargetAdapter } from "../../src/adapters/target/spring-boot/spring-boot-target-adapter.js";
import { approveArchitecture } from "../../src/core/architecture/architecture-decision.js";
import type { LegacyInventory } from "../../src/core/adapters/source-adapter.js";
import type { ModelClient } from "../../src/core/model/model-client.js";
import { hollowSkinnyProfile } from "../../src/profiles/hollow-skinny/hollow-skinny.profile.js";

function buildFakeModel(): ModelClient {
  return {
    async chat(input) {
      const prompt = input.messages.at(-1)?.content ?? "";
      const programId = /PROGRAM-ID:\s*([^\n]+)/.exec(prompt)?.[1]?.trim() ?? "UNKNOWN";
      const methodName = programId.toLowerCase().replace(/[^a-z0-9]+(.)?/g, (_match, next: string | undefined) =>
        next ? next.toUpperCase() : "",
      );
      return {
        content: JSON.stringify({
          methodName,
          params: [],
          returnType: "void",
          body: `context.put(${JSON.stringify(`${programId}.translated`)}, Boolean.TRUE);`,
          notes: `deterministic translation for ${programId}`,
        }),
        toolCalls: [],
        raw: {},
      };
    },
  };
}

function buildInventory(): LegacyInventory {
  return {
    sourceKind: "cobol",
    sourceRoot: "fixtures/cobol",
    copybookFiles: [],
    risks: [],
    programs: [
      {
        programId: "ORDER-MAIN",
        sourceFile: "ORDER-MAIN.cob",
        expandedSource: `       IDENTIFICATION DIVISION.
       PROGRAM-ID. ORDER-MAIN.
       PROCEDURE DIVISION.
           CALL "FORMAT-NAME".
           GOBACK.`,
        callees: ["FORMAT-NAME"],
        linkage: [],
        workingStorageNames: [],
        linkageNames: [],
      },
      {
        programId: "FORMAT-NAME",
        sourceFile: "FORMAT-NAME.cob",
        expandedSource: `       IDENTIFICATION DIVISION.
       PROGRAM-ID. FORMAT-NAME.
       PROCEDURE DIVISION.
           GOBACK.`,
        callees: [],
        linkage: [],
        workingStorageNames: [],
        linkageNames: [],
      },
    ],
  };
}

describe("Spring Boot target adapter", () => {
  it("plans COBOL programs in dependency order, emits hollow/skinny plugins, and verifies the generated project", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "spring-boot-target-"));
    const inventory = buildInventory();
    const architectureDecision = approveArchitecture(hollowSkinnyProfile, "integration-test", "2026-06-23T00:00:00.000Z");
    const maven = {
      execute: vi.fn().mockResolvedValue({ success: true, exitCode: 0, stdout: "", stderr: "" }),
    };
    const adapter = buildSpringBootTargetAdapter({
      model: buildFakeModel(),
      outputDir,
      profile: hollowSkinnyProfile,
      maven,
    });

    const tasks = await adapter.plan(inventory, architectureDecision);

    expect(tasks).toHaveLength(inventory.programs.length);
    expect(tasks.map(task => task.programIds[0])).toEqual(["FORMAT-NAME", "ORDER-MAIN"]);
    expect(tasks[0]).toMatchObject({
      id: "migrate-format-name",
      programIds: ["FORMAT-NAME"],
      allowedPaths: ["pom.xml", "hollow/**", "skinny/**"],
    });

    await adapter.execute(tasks[0]!, inventory);
    await access(join(outputDir, "pom.xml"));
    await access(join(outputDir, "hollow", "pom.xml"));
    await access(join(outputDir, "skinny", "pom.xml"));
    const services = await readFile(
      join(outputDir, "skinny", "src", "main", "resources", "META-INF", "services", "generated.cobol.api.ProgramPlugin"),
      "utf8",
    );
    expect(services).toContain("generated.cobol.skinny.FormatNamePlugin");

    const evidence = await adapter.verify(tasks[0]!);

    expect(maven.execute).toHaveBeenCalledWith({ projectDir: outputDir });
    expect(evidence.find(item => item.criterionId === "architecture.plugin-loads")?.passed).toBe(true);
    expect(evidence).toEqual(expect.arrayContaining(
      hollowSkinnyProfile.criteria.map(criterion => expect.objectContaining({ criterionId: criterion.id })),
    ));
  });
});
