import type { ModelClient } from "../../core/model/model-client.js";
import type { Tool } from "../../core/tool/tool.js";
import type { CompileResult } from "../../schemas/migration-state.schema.js";

export type AssemblyGraphDependencies = {
  model: ModelClient;
  javac: Tool<{ javaFilePath: string; outputDir: string }, CompileResult>;
  maven: Tool<{ projectDir: string }, CompileResult>;
  translationConcurrency?: number;
};
