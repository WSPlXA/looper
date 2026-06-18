import type { Tool } from "../core/tool/tool.js";
import type { CompileResult } from "../schemas/migration-state.schema.js";
import { shellTool } from "./shell.tool.js";

export function buildJavacTool(timeoutMs = 30_000): Tool<{ javaFilePath: string; outputDir: string }, CompileResult> {
  return {
    name: "javac",
    description: "Compile one Java source file with the real javac executable.",
    execute: ({ javaFilePath, outputDir }) => shellTool.execute({
      executable: "javac",
      args: ["-encoding", "UTF-8", "-d", outputDir, javaFilePath],
      timeoutMs,
    }),
  };
}
