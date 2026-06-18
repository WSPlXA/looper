import { readFile } from "node:fs/promises";
import type { GraphNode } from "../../core/graph/graph.node.js";
import type { AssemblyMigrationState } from "../../schemas/assembly-state.schema.js";
import { expandCopybooks } from "../../skills/cobol/expand-copybooks.skill.js";
import { extractSubprogramInfo } from "../../skills/cobol/extract-call-graph.skill.js";

export const expandCopybooksNode: GraphNode<AssemblyMigrationState> = {
  name: "expandCopybooks",
  async run(state, context) {
    await context.trace("expand.start", { cobCount: state.cobFiles.length, cpyCount: state.cpyFiles.length });
    const subprograms: AssemblyMigrationState["subprograms"] = [];
    const skipped: string[] = [];
    for (const sourceFile of state.cobFiles) {
      let raw: string;
      try {
        raw = await readFile(sourceFile, "utf-8");
      } catch {
        skipped.push(sourceFile);
        continue;
      }
      const { expanded, unresolvedNames } = await expandCopybooks(raw, state.cpyFiles);
      if (unresolvedNames.length > 0) {
        await context.trace("expand.unresolved", { sourceFile, unresolvedNames });
      }
      const info = extractSubprogramInfo(sourceFile, expanded);
      if (!info) {
        skipped.push(sourceFile);
        continue;
      }
      subprograms.push(info);
    }
    await context.trace("expand.complete", { extracted: subprograms.length, skipped: skipped.length });
    if (subprograms.length === 0) {
      return {
        state: { ...state, subprograms, status: "FAILED", failureReason: "No valid COBOL subprograms found (no PROGRAM-ID)" },
        next: "reportAssembly",
        status: "SUCCEEDED",
      };
    }
    return { state: { ...state, subprograms, status: "EXPANDING" }, next: "extractCallGraph", status: "SUCCEEDED" };
  },
};
