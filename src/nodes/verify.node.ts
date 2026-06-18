import { access } from "node:fs/promises";
import { join } from "node:path";
import type { GraphNode } from "../core/graph/graph.node.js";
import type { MigrationState } from "../schemas/migration-state.schema.js";
import { writeTextFileTool } from "../tools/filesystem.tool.js";
import type { MigrationGraphDependencies } from "./migration-node.dependencies.js";
import { runTracedCall } from "../core/trace/traced-call.js";

export function buildVerifyNode(dependencies: Pick<MigrationGraphDependencies, "optionalVerify" | "architecturePolicy">): GraphNode<MigrationState> {
  return {
    name: "verify",
    async run(state, context) {
      const lastCompile = state.attempts.at(-1)?.compileResult;
      const sourcePath = join(state.runDir, "output", `${state.className}.java`);
      let sourceExists = true;
      try { await access(sourcePath); } catch { sourceExists = false; }
      const escapedClassName = state.className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const classNameMatches = new RegExp(`\\bpublic\\s+(?:final\\s+)?class\\s+${escapedClassName}\\b`).test(state.currentJavaCode ?? "");
      const compilePassed = lastCompile?.success === true && lastCompile.exitCode === 0;
      const architectureValidation = dependencies.architecturePolicy.validate({ className: state.className, source: state.currentJavaCode ?? "" });
      const architecturePassed = architectureValidation.passed;
      const optional = dependencies.optionalVerify
        ? await runTracedCall(context.trace, "tool.call", { tool: "optional-verifier" }, () => dependencies.optionalVerify!(state))
        : { passed: true, reason: "optional tests not configured" };
      await context.trace("verification.result", { compilePassed, sourceExists, classNameMatches, architecturePassed, optionalTestsPassed: optional.passed });
      const passed = compilePassed && sourceExists && classNameMatches && architecturePassed && optional.passed;
      const reason = passed ? "javac passed, generated source exists, class name matches, and configured verification passed" : [
        compilePassed ? undefined : "javac did not pass",
        sourceExists ? undefined : "generated source is missing",
        classNameMatches ? undefined : "public class name does not match target",
        architecturePassed ? undefined : `architecture policy failed: ${architectureValidation.violations.map((item) => item.code).join(", ")}`,
        optional.passed ? undefined : optional.reason,
      ].filter(Boolean).join("; ");
      if (passed) {
        await runTracedCall(context.trace, "tool.call", { tool: writeTextFileTool.name, operation: "publish" }, () => writeTextFileTool.execute({ path: join(state.outputDir, `${state.className}.java`), content: state.currentJavaCode! }));
      }
      const status = passed ? "SUCCESS" : "FAILED";
      return {
        state: {
          ...state,
          status,
          currentNode: "verify",
          architectureValidation,
          verification: { compilePassed, sourceExists, classNameMatches, architecturePassed, optionalTests: dependencies.optionalVerify ? (optional.passed ? "PASSED" : "FAILED") : "SKIPPED", reason },
          terminal: { status, reason },
          ...(passed ? {} : { failureReason: reason }),
        },
        next: "report",
        status: "SUCCEEDED",
      };
    },
  };
}
