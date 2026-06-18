import { access, mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { ModelClient } from "../../src/core/model/model-client.js";
import { runCobolToJavaSingleFileWorkflow } from "../../src/workflows/cobol-to-java-single-file.workflow.js";

function buildModel(): ModelClient {
  return {
    async chat(input) {
      const prompt = input.messages.at(-1)?.content ?? "";
      const content = prompt.includes("return the plan JSON")
        ? JSON.stringify({ summary: "Display a greeting", entryPoint: "main", variables: [], unsupportedFeatures: [] })
        : JSON.stringify({ type: "WRITE_FILE", path: "Hello.java", content: "public class Hello { public static void main(String[] args) { new Hello().run(); } public void run() { System.out.println(\"HELLO, WORLD!\"); } }" });
      return { content, toolCalls: [], raw: {} };
    },
  };
}

describe("single-file workflow", () => {
  it("uses real javac and writes state, trace, report, attempts, and final source", async () => {
    const root = await mkdtemp(join(tmpdir(), "loop-integration-"));
    const result = await runCobolToJavaSingleFileWorkflow({
      sourceFile: resolve("examples/cobol/HELLO.cob"), outputDir: join(root, "final"), className: "Hello", maxAttempts: 2,
    }, { model: buildModel(), runsDir: join(root, "runs") });
    expect(result.state.status).toBe("SUCCESS");
    expect(result.state.attempts).toHaveLength(1);
    await Promise.all([
      access(result.reportPath), access(join(result.state.runDir, "state.json")), access(join(result.state.runDir, "trace.jsonl")),
      access(join(result.state.runDir, "attempts", "attempt-1.java")), access(join(root, "final", "Hello.java")),
    ]);
    expect(JSON.parse(await readFile(result.reportPath, "utf8"))).toMatchObject({ status: "SUCCESS" });
    const checkpoints = await readdir(join(result.state.runDir, "checkpoints"));
    expect(checkpoints.some((name) => name.includes("sourceIntake"))).toBe(true);
    expect(checkpoints.some((name) => name.includes("resolveJavaArchitecture"))).toBe(true);
    expect(checkpoints.some((name) => name.includes("verify"))).toBe(true);
    expect(checkpoints.some((name) => name.includes("report"))).toBe(true);
    const trace = await readFile(join(result.state.runDir, "trace.jsonl"), "utf8");
    expect(trace).toContain('"type":"model.call"');
    expect(trace).toContain('"type":"tool.call"');
    expect(result.state.targetJavaProfile?.id).toBe("plain-java-single-class-v1");
    expect(result.state.architectureValidation?.passed).toBe(true);
  }, 20_000);

  it("stops unsupported COBOL before any model call", async () => {
    const root = await mkdtemp(join(tmpdir(), "loop-unsupported-"));
    const sourceFile = join(root, "COPY.cob");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(sourceFile, "       COPY CUSTOMER.\n", "utf8");
    const chat = vi.fn();
    const result = await runCobolToJavaSingleFileWorkflow({ sourceFile, outputDir: join(root, "out"), className: "Copy", maxAttempts: 2 }, {
      model: { chat }, runsDir: join(root, "runs"),
    });
    expect(result.state.status).toBe("INTERRUPTED");
    expect(result.state.interrupt?.requiredInput).toHaveProperty("copybookSearchPath");
    expect(chat).not.toHaveBeenCalled();
    await access(result.reportPath);
  });

  it("writes a failed report when source loading fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "loop-missing-source-"));
    const result = await runCobolToJavaSingleFileWorkflow({
      sourceFile: join(root, "missing.cob"), outputDir: join(root, "out"), className: "Missing", maxAttempts: 1,
    }, { model: buildModel(), runsDir: join(root, "runs") });
    expect(result.state.status).toBe("FAILED");
    expect(result.state.failureReason).toContain("ENOENT");
    await access(result.reportPath);
  });

  it("does not allow an agent action to escape or rename the target file", async () => {
    const root = await mkdtemp(join(tmpdir(), "loop-invalid-action-"));
    const model: ModelClient = {
      async chat(input) {
        const planning = (input.messages.at(-1)?.content ?? "").includes("return the plan JSON");
        return {
          content: planning
            ? JSON.stringify({ summary: "plan", entryPoint: "main", variables: [], unsupportedFeatures: [] })
            : JSON.stringify({ type: "WRITE_FILE", path: "../Escape.java", content: "public class Escape {}" }),
          toolCalls: [], raw: {},
        };
      },
    };
    const result = await runCobolToJavaSingleFileWorkflow({
      sourceFile: resolve("examples/cobol/HELLO.cob"), outputDir: join(root, "out"), className: "Hello", maxAttempts: 1,
    }, { model, runsDir: join(root, "runs") });
    expect(result.state.status).toBe("FAILED");
    expect(result.state.failureReason).toContain("escapes outputDir");
    await access(result.reportPath);
  });

  it("lets optional verification veto SUCCESS", async () => {
    const root = await mkdtemp(join(tmpdir(), "loop-verification-fail-"));
    const result = await runCobolToJavaSingleFileWorkflow({
      sourceFile: resolve("examples/cobol/HELLO.cob"), outputDir: join(root, "out"), className: "Hello", maxAttempts: 1,
    }, { model: buildModel(), runsDir: join(root, "runs"), optionalVerify: async () => ({ passed: false, reason: "sample output mismatch" }) });
    expect(result.state.status).toBe("FAILED");
    expect(result.state.verification).toMatchObject({ compilePassed: true, architecturePassed: true, optionalTests: "FAILED" });
    expect(result.state.failureReason).toContain("sample output mismatch");
  });

  it("rejects architecture violations before javac", async () => {
    const root = await mkdtemp(join(tmpdir(), "loop-architecture-reject-"));
    const model: ModelClient = {
      async chat(input) {
        const planning = (input.messages.at(-1)?.content ?? "").includes("return the plan JSON");
        return {
          content: planning
            ? JSON.stringify({ summary: "plan", entryPoint: "main", variables: [], unsupportedFeatures: [] })
            : JSON.stringify({ type: "WRITE_FILE", path: "Hello.java", content: "package demo; public class Hello { public static void main(String[] args) { new Hello().run(); } public void run() {} }" }),
          toolCalls: [], raw: {},
        };
      },
    };
    const result = await runCobolToJavaSingleFileWorkflow({
      sourceFile: resolve("examples/cobol/HELLO.cob"), outputDir: join(root, "out"), className: "Hello", maxAttempts: 1,
    }, { model, runsDir: join(root, "runs") });
    expect(result.state.status).toBe("FAILED");
    expect(result.state.failureReason).toContain("PACKAGE_FORBIDDEN");
    expect(result.state.architectureValidation).toMatchObject({ passed: false, profileId: "plain-java-single-class-v1" });
    expect(result.state.attempts).toHaveLength(0);
    expect(JSON.parse(await readFile(result.reportPath, "utf8"))).toMatchObject({ architectureValidation: { passed: false } });
  });
});
