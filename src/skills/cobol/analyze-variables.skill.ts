import { basename } from "node:path";

export interface VariableDeclaration {
  name: string;
  level: string;
  details: string;
  lineNumber: number;
  section: "WORKING-STORAGE" | "LINKAGE" | "FILE" | "UNKNOWN";
}

export interface VariableReference {
  programId: string;
  sourceFile: string;
  lineNumber: number;
  lineContent: string;
}

export interface VariableXref {
  name: string;
  declaredIn: {
    programId: string;
    sourceFile: string;
    lineNumber: number;
    level: string;
    details: string;
    section: string;
  };
  references: VariableReference[];
}

export interface ProgramAnalysis {
  programId: string;
  sourceFile: string;
  declarations: VariableDeclaration[];
  references: { [varName: string]: VariableReference[] };
  callees: string[];
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cleanDetails(details: string): string {
  if (!details) return "";
  let cleaned = details.trim();
  if (cleaned.endsWith(".")) {
    cleaned = cleaned.substring(0, cleaned.length - 1).trim();
  }
  return cleaned;
}

/**
 * Checks if a line is a COBOL comment line.
 */
function isCommentLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.startsWith("*>")) return true;
  // Fixed-format comment check: column 7 (index 6) is '*' or '/'
  if (line.length >= 7 && (line[6] === "*" || line[6] === "/")) return true;
  return false;
}

/**
 * Strips comments from a line.
 */
function stripComments(line: string): string {
  if (isCommentLine(line)) return "";
  const index = line.indexOf("*>");
  if (index !== -1) {
    return line.substring(0, index);
  }
  // Strip columns 1-6 and column 7 indicator if in fixed format
  if (line.length >= 7) {
    return line.substring(7);
  }
  return line;
}

export function analyzeProgramVariables(
  sourceFile: string,
  expandedSource: string,
): ProgramAnalysis | null {
  const lines = expandedSource.split(/\r?\n/);
  
  // Extract PROGRAM-ID
  let programId: string | null = null;
  for (const line of lines) {
    if (isCommentLine(line)) continue;
    const match = /PROGRAM-ID\.\s+([A-Za-z0-9_$#@-]+)/i.exec(line);
    if (match?.[1]) {
      programId = match[1].trim();
      break;
    }
  }
  if (!programId) {
    // Fallback to filename
    programId = basename(sourceFile).split(".")[0] || "UNKNOWN";
  }

  const declarations: VariableDeclaration[] = [];
  const references: { [varName: string]: VariableReference[] } = {};
  const callees: string[] = [];

  let inDataDivision = false;
  let inProcedureDivision = false;
  let currentSection: VariableDeclaration["section"] = "UNKNOWN";
  
  const procedureLines: { lineNum: number; content: string }[] = [];

  const skipKeywords = new Set([
    "DIVISION", "SECTION", "COPY", "PROGRAM-ID", "PROCEDURE", 
    "FILLER", "USING", "RETURNING", "BY", "REFERENCE", "CONTENT", "VALUE"
  ]);

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i]!;
    const lineNum = i + 1;

    if (isCommentLine(rawLine)) continue;
    const line = stripComments(rawLine).trim();
    if (!line) continue;

    // Detect section transitions
    if (/DATA\s+DIVISION/i.test(line)) {
      inDataDivision = true;
      inProcedureDivision = false;
      continue;
    }
    if (/WORKING-STORAGE\s+SECTION/i.test(line)) {
      inDataDivision = true;
      inProcedureDivision = false;
      currentSection = "WORKING-STORAGE";
      continue;
    }
    if (/LINKAGE\s+SECTION/i.test(line)) {
      inDataDivision = true;
      inProcedureDivision = false;
      currentSection = "LINKAGE";
      continue;
    }
    if (/FILE\s+SECTION/i.test(line)) {
      inDataDivision = true;
      inProcedureDivision = false;
      currentSection = "FILE";
      continue;
    }
    if (/PROCEDURE\s+DIVISION/i.test(line)) {
      inDataDivision = false;
      inProcedureDivision = true;
      continue;
    }

    if (inDataDivision) {
      // Matches declaration: "01 VAR-NAME [PIC ...]."
      // Allowing details to span, we will parse level and name from start of line
      const declMatch = /^\s*(0[1-9]|[1-4][0-9]|77|88)\s+([A-Za-z0-9_$#@-]+)(?:\s+([\s\S]+))?$/i.exec(line);
      if (declMatch) {
        const level = declMatch[1]!;
        const name = declMatch[2]!.trim();
        const details = cleanDetails(declMatch[3] || "");

        if (!skipKeywords.has(name.toUpperCase())) {
          declarations.push({
            name,
            level,
            details,
            lineNumber: lineNum,
            section: currentSection,
          });
        }
      }
    }

    if (inProcedureDivision) {
      procedureLines.push({ lineNum, content: line });

      // Trace calls to other programs
      const callMatch = /\bCALL\s+"([^"]+)"/gi.exec(line);
      if (callMatch?.[1]) {
        callees.push(callMatch[1].trim());
      }
    }
  }

  // Trace references to declared variables in the procedure division
  for (const decl of declarations) {
    references[decl.name] = [];
    
    // Lookaround regex to avoid matching variable subparts (e.g. A in A-VAR)
    const regex = new RegExp(
      `(?<![A-Za-z0-9_$#@-])` + escapeRegExp(decl.name) + `(?![A-Za-z0-9_$#@-])`,
      "gi"
    );

    for (const procLine of procedureLines) {
      regex.lastIndex = 0;
      if (regex.test(procLine.content)) {
        references[decl.name]!.push({
          programId,
          sourceFile,
          lineNumber: procLine.lineNum,
          lineContent: procLine.content,
        });
      }
    }
  }

  return {
    programId,
    sourceFile,
    declarations,
    references,
    callees: [...new Set(callees)],
  };
}

export function buildXrefDatabase(analyses: ProgramAnalysis[]): VariableXref[] {
  const xrefMap = new Map<string, VariableXref>();

  for (const analysis of analyses) {
    for (const decl of analysis.declarations) {
      const key = decl.name.toUpperCase();
      if (!xrefMap.has(key)) {
        xrefMap.set(key, {
          name: decl.name,
          declaredIn: {
            programId: analysis.programId,
            sourceFile: analysis.sourceFile,
            lineNumber: decl.lineNumber,
            level: decl.level,
            details: decl.details,
            section: decl.section,
          },
          references: [],
        });
      }
    }
  }

  for (const analysis of analyses) {
    for (const [varName, refs] of Object.entries(analysis.references)) {
      const key = varName.toUpperCase();
      const entry = xrefMap.get(key);
      if (entry) {
        entry.references.push(...refs);
      }
    }
  }

  return Array.from(xrefMap.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export function generateMarkdownReport(
  analyses: ProgramAnalysis[],
  xrefDb: VariableXref[],
  sourceDir: string,
): string {
  let md = `# COBOL 变量交叉引用分析报告 (Variable Cross-Reference Report)\n\n`;
  md += `> 本文档由 COBOL 变量分析工具自动生成。它提取了数据部的变量声明，并追踪了过程部中的所有引用。\n\n`;
  
  md += `## 1. 总体数据概览 (Summary)\n\n`;
  md += `* **源文件目录**: \`${sourceDir}\`\n`;
  md += `* **分析程序数量**: ${analyses.length}\n`;
  md += `* **声明变量总数**: ${xrefDb.length}\n`;
  md += `* **总引用次数**: ${xrefDb.reduce((acc, curr) => acc + curr.references.length, 0)}\n\n`;

  md += `## 2. 变量交叉引用目录 (Variable Directory)\n\n`;
  md += `| 变量名 | 声明程序 | 声明位置 | 声明层级与详情 | 引用次数 |\n`;
  md += `| :--- | :--- | :--- | :--- | :--- |\n`;
  for (const entry of xrefDb) {
    const fileLink = `[${basename(entry.declaredIn.sourceFile)}:L${entry.declaredIn.lineNumber}](file://${entry.declaredIn.sourceFile}#L${entry.declaredIn.lineNumber})`;
    md += `| **${entry.name}** | \`${entry.declaredIn.programId}\` | ${fileLink} | \`${entry.declaredIn.level} ${entry.name} ${entry.declaredIn.details}\` | ${entry.references.length} |\n`;
  }
  md += `\n`;

  md += `## 3. 详细交叉引用详情 (Cross-Reference Details)\n\n`;
  for (const entry of xrefDb) {
    md += `### 3.${xrefDb.indexOf(entry) + 1} 变量: \`${entry.name}\`\n\n`;
    md += `* **类型与声明**: \`${entry.declaredIn.level} ${entry.name} ${entry.declaredIn.details}\` (在 \`${entry.declaredIn.section}\` 节)\n`;
    md += `* **定义程序**: \`${entry.declaredIn.programId}\` (${basename(entry.declaredIn.sourceFile)})\n`;
    
    if (entry.references.length === 0) {
      md += `* **引用情况**: *该变量在过程部 (PROCEDURE DIVISION) 中没有任何引用。*\n\n`;
    } else {
      md += `* **引用次数**: 共被引用 ${entry.references.length} 次\n\n`;
      md += `| 引用程序 | 引用行号 | 代码片段 (Line Content) |\n`;
      md += `| :--- | :--- | :--- |\n`;
      for (const ref of entry.references) {
        const refLink = `[L${ref.lineNumber}](file://${ref.sourceFile}#L${ref.lineNumber})`;
        md += `| \`${ref.programId}\` | ${refLink} | \`${ref.lineContent}\` |\n`;
      }
      md += `\n`;
    }
  }

  return md;
}
