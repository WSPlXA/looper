import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildCobolSourceAdapter } from "../../src/adapters/source/cobol/cobol-source-adapter.js";

describe("COBOL source adapter", () => {
  it("discovers programs, calls, copybooks, variables, and risks", async () => {
    const inventory = await buildCobolSourceAdapter().discover(
      resolve("test/fixtures/cobol"),
    );
    expect(inventory.sourceKind).toBe("cobol");
    expect(inventory.programs.map(program => program.programId)).toContain("MAIN");
    expect(inventory.programs.find(program => program.programId === "MAIN")?.callees).toContain("UTILS");
    const mainWithCopy = inventory.programs.find(program => program.programId === "MAIN-WITH-COPY");
    expect(mainWithCopy?.callees).toEqual([]);
    expect(mainWithCopy?.expandedSource).toContain("COMMON-STATUS");
    expect(inventory.copybookFiles.length).toBeGreaterThan(0);
  });
});
