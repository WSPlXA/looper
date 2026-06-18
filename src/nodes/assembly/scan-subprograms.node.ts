import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { GraphNode } from "../../core/graph/graph.node.js";
import type { AssemblyMigrationState } from "../../schemas/assembly-state.schema.js";

export const scanSubprogramsNode: GraphNode<AssemblyMigrationState> = {
  name: "scanSubprograms",
  async run(state, context) {
    await context.trace("scan.start", { sourceDir: state.sourceDir });
    let entries: string[];
    try {
      entries = await readdir(state.sourceDir, { recursive: true }) as string[];
    } catch (error) {
      const reason = `Cannot read source directory ${state.sourceDir}: ${error instanceof Error ? error.message : String(error)}`;
      return { state: { ...state, status: "FAILED", failureReason: reason }, next: "reportAssembly", status: "SUCCEEDED" };
    }
    const cobFiles = entries
      .filter(f => /\.(cob|cbl)$/i.test(f))
      .map(f => join(state.sourceDir, f));
    const cpyFiles = entries
      .filter(f => /\.cpy$/i.test(f))
      .map(f => join(state.sourceDir, f));
    await context.trace("scan.complete", { cobCount: cobFiles.length, cpyCount: cpyFiles.length });
    if (cobFiles.length === 0) {
      return {
        state: { ...state, cobFiles, cpyFiles, status: "FAILED", failureReason: "No COBOL source files found in source directory" },
        next: "reportAssembly",
        status: "SUCCEEDED",
      };
    }
    return { state: { ...state, cobFiles, cpyFiles, status: "SCANNING" }, next: "expandCopybooks", status: "SUCCEEDED" };
  },
};
