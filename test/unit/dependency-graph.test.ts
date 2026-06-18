import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { buildDependencyGraph } from "../../src/skills/batch/build-dependency-graph.skill.js";

const UTILS = resolve("test/fixtures/cobol/UTILS.cob");
const MAIN_WITH_COPY = resolve("test/fixtures/cobol/MAIN_WITH_COPY.cob");
const HELLO = resolve("test/fixtures/cobol/HELLO.cob");

describe("buildDependencyGraph", () => {
  it("preserves order when no dependencies exist", async () => {
    const { order, hasCycle } = await buildDependencyGraph([HELLO, UTILS]);
    expect(hasCycle).toBe(false);
    expect(order).toEqual([HELLO, UTILS]);
  });

  it("places dependency before the file that COPYs it", async () => {
    const { order, hasCycle } = await buildDependencyGraph([MAIN_WITH_COPY, UTILS]);
    expect(hasCycle).toBe(false);
    expect(order.indexOf(UTILS)).toBeLessThan(order.indexOf(MAIN_WITH_COPY));
  });

  it("includes all files even when cycle detected", async () => {
    let tmpDir = "";
    try {
      tmpDir = await mkdtemp(join(tmpdir(), "dep-cycle-test-"));
      const a = join(tmpDir, "A.cob");
      const b = join(tmpDir, "B.cob");
      await writeFile(a, "       COPY B.\n");
      await writeFile(b, "       COPY A.\n");
      const { order, hasCycle } = await buildDependencyGraph([a, b]);
      expect(hasCycle).toBe(true);
      expect(order).toHaveLength(2);
      expect(order).toContain(a);
      expect(order).toContain(b);
    } finally {
      if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("ignores COPY targets not found in the file list", async () => {
    const { order, hasCycle } = await buildDependencyGraph([MAIN_WITH_COPY]);
    expect(hasCycle).toBe(false);
    expect(order).toEqual([MAIN_WITH_COPY]);
  });
});
