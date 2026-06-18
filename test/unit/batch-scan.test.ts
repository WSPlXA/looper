import { describe, it, expect } from "vitest";
import { join, resolve } from "node:path";
import { cobolNameToClassName, scanProjectDirectory } from "../../src/skills/batch/scan-project.skill.js";

describe("cobolNameToClassName", () => {
  it.each([
    ["HELLO.cob", "Hello"],
    ["CALC.cob", "Calc"],
    ["ACCOUNT_PROC.cob", "AccountProc"],
    ["MY-PROG.cob", "MyProg"],
    ["hello.cob", "Hello"],
    ["UTILS.COB", "Utils"],
    ["MAIN_WITH_COPY.cob", "MainWithCopy"],
  ])("%s → %s", (filename, expected) => {
    expect(cobolNameToClassName(filename)).toBe(expected);
  });
});

describe("scanProjectDirectory", () => {
  const fixturesDir = resolve("test/fixtures/cobol");

  it("finds all .cob files and derives class names", async () => {
    const { files, skipped } = await scanProjectDirectory(fixturesDir);
    expect(files.length).toBeGreaterThanOrEqual(2);
    expect(skipped).toBeInstanceOf(Array);
    const classNames = files.map(f => f.className);
    expect(classNames).toContain("Hello");
    expect(classNames).toContain("Calc");
  });

  it("returns absolute paths for source files", async () => {
    const { files } = await scanProjectDirectory(fixturesDir);
    for (const f of files) {
      expect(f.sourceFile).toBe(resolve(f.sourceFile));
    }
  });

  it("returns no duplicate class names", async () => {
    const { files } = await scanProjectDirectory(fixturesDir);
    const names = files.map(f => f.className);
    expect(new Set(names).size).toBe(names.length);
  });
});
