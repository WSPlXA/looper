import { isAbsolute, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildCobolSourceAdapter } from "../../src/adapters/source/cobol/cobol-source-adapter.js";

describe("COBOL source adapter", () => {
  it("discovers programs, calls, copybooks, variables, and risks", async () => {
    const inventory = await buildCobolSourceAdapter().discover(
      "test/fixtures/cobol",
    );
    expect(inventory.sourceKind).toBe("cobol");
    expect(inventory.sourceRoot).toBe(resolve("test/fixtures/cobol"));
    expect(inventory.programs.every(program => isAbsolute(program.sourceFile))).toBe(true);
    expect(inventory.copybookFiles.every(copybookFile => isAbsolute(copybookFile))).toBe(true);
    expect(inventory.programs.map(program => program.programId)).toEqual([
      "HELLO",
      "MAIN",
      "MAIN-WITH-COPY",
      "UNSUPPORTED-COPY",
      "UTILS",
    ]);
    expect(inventory.programs.find(program => program.programId === "MAIN")?.callees).toContain("UTILS");
    const mainWithCopy = inventory.programs.find(program => program.programId === "MAIN-WITH-COPY");
    expect(mainWithCopy?.callees).toEqual([]);
    expect(mainWithCopy?.workingStorageNames).toContain("COMMON-STATUS");
    expect(mainWithCopy?.expandedSource).toContain("COMMON-STATUS");
    expect(inventory.risks.some(risk => risk.includes("Unresolved COPY CUSTOMER"))).toBe(true);
    expect(inventory.copybookFiles.length).toBeGreaterThan(0);
  });
});
