/**
 * Detects undeclared identifiers on javac error lines and generates class-level
 * field declarations for them. Handles COBOL EXTERNAL / cross-program shared
 * WORKING-STORAGE that the LLM translated as per-method locals but is referenced
 * across multiple methods.
 */

const JAVA_KEYWORDS: ReadonlySet<string> = new Set([
  "abstract","assert","boolean","break","byte","case","catch","char","class",
  "const","continue","default","do","double","else","enum","extends","final",
  "finally","float","for","goto","if","implements","import","instanceof","int",
  "interface","long","native","new","package","private","protected","public",
  "return","short","static","strictfp","super","switch","synchronized","this",
  "throw","throws","transient","try","void","volatile","while",
  "true","false","null",
  "String","Integer","Long","Double","Float","Boolean","Byte","Character","Short",
  "Math","System","Object","StringBuilder","Arrays","Collections","List","Map",
  "UnsupportedOperationException","Override","Deprecated",
  "main","args","length","charAt","substring","indexOf","contains",
  "equals","isEmpty","trim","toUpperCase","toLowerCase","replace","startsWith",
  "endsWith","format","println","parseInt","parseDouble","toString","valueOf",
  "random","abs","max","min","pow","sqrt","floor","ceil","round",
]);

export type FieldDeclaration = {
  name: string;
  type: string;
  initializer: string;
  declaration: string;
};

/** Extract all line numbers mentioned in javac stderr (locale-independent). */
function parseErrorLineNumbers(stderr: string): Set<number> {
  const lines = new Set<number>();
  const re = /\.java:(\d+):/g;
  let m;
  while ((m = re.exec(stderr)) !== null) {
    const raw = m[1];
    if (raw !== undefined) lines.add(parseInt(raw));
  }
  return lines;
}

/**
 * Collect names already declared at CLASS level only (4-space indent + access modifier).
 * Intentionally excludes local variables inside methods (8+ space indent).
 * This prevents local vars in one method from blocking the same name from becoming a class field.
 */
function collectDeclaredNames(javaSource: string): Set<string> {
  const names = new Set<string>();
  // Method names
  for (const m of javaSource.matchAll(/\b(?:public|private|protected)\s+\S+\s+(\w+)\s*\(/g)) {
    const n = m[1]; if (n) names.add(n);
  }
  // Class-level fields: exactly 4 spaces + access/static modifier
  for (const m of javaSource.matchAll(/^ {4}(?:private|public|protected|static)\s+(?:final\s+)?(?:\w+(?:\[\])*)\s+(\w+)\s*[=;]/gm)) {
    const n = m[1]; if (n) names.add(n);
  }
  return names;
}

/** Infer array dimensionality from usage patterns like `name[i][j]`. */
function inferArrayDims(name: string, source: string): number {
  const re = new RegExp(`\\b${name}((?:\\s*\\[[^\\]]*\\])+)`, "g");
  let maxDims = 0;
  for (const m of source.matchAll(re)) {
    const capture = m[1];
    if (!capture) continue;
    const dims = (capture.match(/\[/g) ?? []).length;
    if (dims > maxDims) maxDims = dims;
  }
  return maxDims;
}

/** Find the largest literal array index used with `name` (for array sizing). */
function findMaxLiteralIndex(name: string, source: string): number {
  const re = new RegExp(`\\b${name}\\[(\\d+)\\]`, "g");
  let max = 0;
  for (const m of source.matchAll(re)) {
    const raw = m[1];
    if (!raw) continue;
    const n = parseInt(raw);
    if (n > max) max = n;
  }
  return max;
}

/**
 * Check if a variable is assigned to a value that comes from a String variable or String literal.
 * Used to detect when an array should be String[] instead of int[].
 */
function isAssignedStringValue(name: string, source: string): boolean {
  // Direct string literal assignment: name = "..." or name[i] = "..."
  if (new RegExp(`\\b${name}(?:\\[\\w+\\])*\\s*=\\s*"`).test(source)) return true;
  if (new RegExp(`\\b${name}\\s*\\+=\\s*"`).test(source)) return true;
  // String method calls on the variable itself
  if (new RegExp(`\\b${name}\\s*\\.\\s*(?:length\\(|charAt\\(|substring\\(|indexOf\\(|contains\\(|equals\\(|isEmpty\\(|trim\\(|replace\\(|startsWith\\(|endsWith\\(|toUpper|toLower|format\\()`).test(source)) return true;
  // String method calls on array element: name[i].method()
  if (new RegExp(`\\b${name}\\[\\w+\\]\\s*\\.\\s*(?:length\\(|charAt\\(|equals\\(|trim\\(|isEmpty\\()`).test(source)) return true;

  // name[i] = someVar where someVar is a String parameter or local
  const arrAssignRe = new RegExp(`\\b${name}(?:\\[\\w+\\])+\\s*=\\s*(\\w+)`, "g");
  for (const m of source.matchAll(arrAssignRe)) {
    const assignedVar = m[1];
    if (!assignedVar) continue;
    // Check if assignedVar is declared as String anywhere in the source
    if (new RegExp(`\\bString(?:\\[\\])*\\s+${assignedVar}\\b`).test(source)) return true;
    // Or if it's passed as a parameter with String type
    if (new RegExp(`\\bString\\s+${assignedVar}[,)]`).test(source)) return true;
  }
  // Also: name = someStringVar (non-array)
  const directAssignRe = new RegExp(`\\b${name}\\s*=\\s*(\\w+)\\s*;`, "g");
  for (const m of source.matchAll(directAssignRe)) {
    const assignedVar = m[1];
    if (!assignedVar) continue;
    if (new RegExp(`\\bString(?:\\[\\])*\\s+${assignedVar}\\b`).test(source)) return true;
  }
  return false;
}

/** Infer Java type and initializer for a symbol based on usage in the full source. */
function inferFieldDeclaration(name: string, source: string): FieldDeclaration {
  const dims = inferArrayDims(name, source);

  const isDouble = new RegExp(`\\b${name}\\s*=\\s*\\d+\\.\\d`).test(source);
  const isString = !isDouble && isAssignedStringValue(name, source);

  const baseType = isString ? "String" : isDouble ? "double" : "int";
  const scalarInit = isString ? '""' : isDouble ? "0.0" : "0";

  if (dims === 0) {
    return {
      name, type: baseType, initializer: scalarInit,
      declaration: `private ${baseType} ${name} = ${scalarInit};`,
    };
  }

  const maxIdx = findMaxLiteralIndex(name, source);
  const size1 = Math.max(maxIdx + 10, 1000);
  const arrayType = `${baseType}${"[]".repeat(dims)}`;
  let init: string;
  if (dims === 1) init = `new ${baseType}[${size1}]`;
  else if (dims === 2) init = `new ${baseType}[256][256]`;
  else init = `new ${baseType}[64][64][64]`;

  return {
    name, type: arrayType, initializer: init,
    declaration: `private ${arrayType} ${name} = ${init};`,
  };
}

/**
 * Given javac stderr and the assembled Java source, identify undeclared
 * identifiers on error lines and return field declarations to inject into the class.
 */
export function declareClassFields(
  javaSource: string,
  stderr: string,
): { addedFields: FieldDeclaration[]; updatedSource: string } {
  const errorLines = parseErrorLineNumbers(stderr);
  if (errorLines.size === 0) return { addedFields: [], updatedSource: javaSource };

  const sourceLines = javaSource.split("\n");
  const declared = collectDeclaredNames(javaSource);

  const candidates = new Set<string>();
  for (const lineNo of errorLines) {
    const line = sourceLines[lineNo - 1] ?? "";
    for (const m of line.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\b(?!\s*\()/g)) {
      const name = m[1];
      if (!name) continue;
      if (JAVA_KEYWORDS.has(name)) continue;
      if (declared.has(name)) continue;
      if (/^[A-Z][a-z]/.test(name)) continue; // PascalCase = Java class name
      candidates.add(name);
    }
  }

  if (candidates.size === 0) return { addedFields: [], updatedSource: javaSource };

  const addedFields: FieldDeclaration[] = [...candidates]
    .sort()
    .map(name => inferFieldDeclaration(name, javaSource));

  // Inject after the class opening line
  const fieldBlock = [
    "",
    "    // Auto-declared class fields (COBOL EXTERNAL / shared WORKING-STORAGE)",
    ...addedFields.map(f => `    ${f.declaration}`),
  ].join("\n");

  const updatedSource = javaSource.replace(
    /^(public class \w+ \{)$/m,
    `$1${fieldBlock}`,
  );

  return { addedFields, updatedSource };
}
