import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { buildFileStateStore } from "../../src/core/storage/file-state-store.js";
import { buildCompileRepairLoop } from "../../src/loops/compile-repair.loop.js";
import type { CompileResult, MigrationState } from "../../src/schemas/migration-state.schema.js";

describe("compile repair loop", () => {
  it("records stderr, repairs, and retries", async () => {
    const root = await mkdtemp(join(tmpdir(), "loop-engine-"));
    const results: CompileResult[] = [
      { success: false, exitCode: 1, stdout: "", stderr: "Hello.java:1: error: ';' expected", timedOut: false },
      { success: true, exitCode: 0, stdout: "", stderr: "", timedOut: false },
    ];
    const javac = { name: "javac", description: "test", execute: vi.fn(async () => results.shift()!) };
    const repair = vi.fn(async (_input: unknown) => ({ type: "WRITE_FILE" as const, path: "Hello.java", content: "public class Hello { public static void main(String[] args) { new Hello().run(); } public void run() {} }" }));
    const initial: MigrationState = {
      runId: "run", runDir: join(root, "run"), sourceFile: "HELLO.cob", outputDir: join(root, "out"), className: "Hello",
      cobolSource: "DISPLAY 'HELLO'.", currentJavaCode: "public class Hello {", attempts: [], status: "RUNNING", maxAttempts: 3,
    };
    const state = await buildCompileRepairLoop({
      javac,
      repair,
      stateStore: buildFileStateStore(join(root, "run", "state.json")),
      trace: async () => undefined,
    })(initial);
    expect(state.status).toBe("SUCCESS");
    expect(state.attempts).toHaveLength(2);
    expect(state.attempts[0]?.compileResult?.stderr).toContain("';' expected");
    expect(state.classifications?.[0]?.classification.errorClass).toBe("SyntaxError");
    expect(repair).toHaveBeenCalledOnce();
    expect(repair.mock.calls[0]?.[0]).toMatchObject({ error: { errorClass: "SyntaxError" } });
    expect(repair.mock.calls[0]?.[0]).not.toHaveProperty("compilerStderr");
    const checkpoints = await readdir(join(root, "run", "checkpoints"));
    expect(checkpoints.some((name) => name.includes("classifyError"))).toBe(true);
    expect(checkpoints.some((name) => name.includes("verify"))).toBe(true);
  });

  it("fails after maxAttempts and never repairs beyond the bound", async () => {
    const root = await mkdtemp(join(tmpdir(), "loop-max-attempts-"));
    const failed: CompileResult = { success: false, exitCode: 1, stdout: "", stderr: "error: cannot find symbol", timedOut: false };
    const javac = { name: "javac", description: "test", execute: vi.fn(async () => failed) };
    const repair = vi.fn(async (_input: unknown) => ({ type: "WRITE_FILE" as const, path: "Hello.java", content: "public class Hello { public static void main(String[] args) { new Hello().run(); } public void run() {} }" }));
    const initial: MigrationState = {
      runId: "run", runDir: join(root, "run"), sourceFile: "HELLO.cob", outputDir: join(root, "out"), className: "Hello",
      cobolSource: "DISPLAY 'HELLO'.", currentJavaCode: "public class Hello { Missing x; }", attempts: [], status: "RUNNING", maxAttempts: 2,
    };
    const state = await buildCompileRepairLoop({
      javac, repair, stateStore: buildFileStateStore(join(root, "run", "state.json")), trace: async () => undefined,
    })(initial);
    expect(state.status).toBe("FAILED");
    expect(state.attempts).toHaveLength(2);
    expect(javac.execute).toHaveBeenCalledTimes(2);
    expect(repair).toHaveBeenCalledTimes(1);
    expect(state.failureReason).toContain("after 2 attempts");
    expect(state.classifications).toHaveLength(2);
  });
});
