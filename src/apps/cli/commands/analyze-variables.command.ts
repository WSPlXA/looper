import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import type { AppConfig } from "../../../config/env.js";
import { expandCopybooks } from "../../../skills/cobol/expand-copybooks.skill.js";
import {
  analyzeProgramVariables,
  buildXrefDatabase,
  generateMarkdownReport,
  type ProgramAnalysis,
} from "../../../skills/cobol/analyze-variables.skill.js";

export async function analyzeVariablesCommand(args: string[], config: AppConfig): Promise<number> {
  const [sourceDir, outputMdFile, outputJsonFile] = args;
  if (!sourceDir || !outputMdFile) {
    console.error("Usage: npm run analyze-variables -- <source-dir> <output-markdown-file> [output-json-file]");
    return 2;
  }

  const resolvedSourceDir = resolve(sourceDir);
  const resolvedOutputMdFile = resolve(outputMdFile);
  const resolvedOutputJsonFile = outputJsonFile ? resolve(outputJsonFile) : null;

  console.log(`[Variable Analyzer] Scanning source directory: ${resolvedSourceDir}`);

  let entries: string[];
  try {
    entries = await readdir(resolvedSourceDir, { recursive: true });
  } catch (error) {
    console.error(`Error reading source directory: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }

  const cobFiles = entries
    .filter(f => /\.(cob|cbl)$/i.test(f))
    .map(f => join(resolvedSourceDir, f));
  const cpyFiles = entries
    .filter(f => /\.cpy$/i.test(f))
    .map(f => join(resolvedSourceDir, f));

  console.log(`[Variable Analyzer] Found ${cobFiles.length} COBOL source files and ${cpyFiles.length} copybooks.`);

  if (cobFiles.length === 0) {
    console.error("No COBOL source files (*.cob, *.cbl) found.");
    return 1;
  }

  const analyses: ProgramAnalysis[] = [];
  for (const sourceFile of cobFiles) {
    let raw: string;
    try {
      raw = await readFile(sourceFile, "utf-8");
    } catch (error) {
      console.warn(`[Variable Analyzer] Failed to read ${sourceFile}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }

    // Expand copybooks
    const { expanded } = await expandCopybooks(raw, cpyFiles);
    
    // Analyze variables
    const programAnalysis = analyzeProgramVariables(sourceFile, expanded);
    if (programAnalysis) {
      analyses.push(programAnalysis);
    }
  }

  console.log(`[Variable Analyzer] Successfully analyzed ${analyses.length} programs.`);

  const xrefDb = buildXrefDatabase(analyses);
  const markdownReport = generateMarkdownReport(analyses, xrefDb, resolvedSourceDir);

  try {
    await mkdir(dirname(resolvedOutputMdFile), { recursive: true });
    await writeFile(resolvedOutputMdFile, markdownReport, "utf-8");
    console.log(`[Variable Analyzer] Markdown report saved to: ${resolvedOutputMdFile}`);
  } catch (error) {
    console.error(`Error saving Markdown report: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }

  if (resolvedOutputJsonFile) {
    try {
      await mkdir(dirname(resolvedOutputJsonFile), { recursive: true });
      const jsonContent = JSON.stringify({
        summary: {
          sourceDir: resolvedSourceDir,
          totalPrograms: analyses.length,
          totalVariables: xrefDb.length,
        },
        programs: analyses.map(a => ({
          programId: a.programId,
          sourceFile: a.sourceFile,
          declarations: a.declarations,
          callees: a.callees,
        })),
        xref: xrefDb,
      }, null, 2);
      await writeFile(resolvedOutputJsonFile, jsonContent, "utf-8");
      console.log(`[Variable Analyzer] JSON database saved to: ${resolvedOutputJsonFile}`);
    } catch (error) {
      console.error(`Error saving JSON database: ${error instanceof Error ? error.message : String(error)}`);
      return 1;
    }
  }

  return 0;
}
