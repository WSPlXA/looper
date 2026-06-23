import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { LegacyProgram, SourceAdapter } from "../../../core/adapters/source-adapter.js";
import { analyzeProgramVariables } from "../../../skills/cobol/analyze-variables.skill.js";
import { expandCopybooks } from "../../../skills/cobol/expand-copybooks.skill.js";
import { extractSubprogramInfo } from "../../../skills/cobol/extract-call-graph.skill.js";

export function buildCobolSourceAdapter(): SourceAdapter {
  return {
    id: "cobol",
    async discover(sourceRoot) {
      const entries = await readdir(sourceRoot, { recursive: true });
      const cobFiles = entries.filter(name => /\.(?:cob|cbl)$/i.test(name)).map(name => join(sourceRoot, name));
      const copybookFiles = entries.filter(name => /\.cpy$/i.test(name)).map(name => join(sourceRoot, name));
      const programs: LegacyProgram[] = [];
      const risks: string[] = [];

      for (const sourceFile of cobFiles) {
        const raw = await readFile(sourceFile, "utf8");
        const { expanded, unresolvedNames } = await expandCopybooks(raw, copybookFiles);
        const subprogram = extractSubprogramInfo(sourceFile, expanded);
        const variables = analyzeProgramVariables(sourceFile, expanded);
        if (!subprogram || !variables) {
          risks.push(`Unable to identify PROGRAM-ID: ${sourceFile}`);
          continue;
        }
        risks.push(...unresolvedNames.map(name => `Unresolved COPY ${name} in ${sourceFile}`));
        programs.push({
          programId: subprogram.programId,
          sourceFile,
          expandedSource: expanded,
          callees: subprogram.callees,
          linkage: subprogram.linkageParams,
          workingStorageNames: variables.declarations.filter(item => item.section === "WORKING-STORAGE").map(item => item.name),
          linkageNames: variables.declarations.filter(item => item.section === "LINKAGE").map(item => item.name),
        });
      }

      return { sourceKind: "cobol", sourceRoot, programs, copybookFiles, risks };
    },
  };
}
