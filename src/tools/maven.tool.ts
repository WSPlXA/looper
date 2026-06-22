import type { Tool } from "../core/tool/tool.js";
import type { CompileResult } from "../schemas/migration-state.schema.js";
import { shellTool } from "./shell.tool.js";

export function buildMavenTestTool(timeoutMs = 180_000): Tool<{ projectDir: string }, CompileResult> {
  return {
    name: "maven-test",
    description: "Compile and test one generated Maven project without creating a shell.",
    execute: ({ projectDir }) => shellTool.execute({
      executable: "mvn",
      args: ["-q", "test"],
      cwd: projectDir,
      timeoutMs,
    }),
  };
}
