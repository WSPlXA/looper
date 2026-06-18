import type { JavaMethodTranslation } from "../../schemas/assembly-state.schema.js";

// Match: // TODO call PROGRAM-ID(args) — handles nested parens in args via greedy .*
// Anchored to end-of-line so (.*) captures everything up to the last ) on the line.
const TODO_CALL_RE = /\/\/ TODO call ([A-Za-z0-9_$#@-]+)\((.*)\)\s*$/gm;

// if (/* any comment */) → if (false /* UNRESOLVED: any comment */)
// Prevents "empty if condition" compile errors caused by unresolved COBOL return-code checks.
const COMMENTED_IF_RE = /if\s*\(\/\*([^*]*(?:\*(?!\/)[^*]*)*)\*\/\s*\)/g;

function sanitizeBody(body: string): string {
  return body.replace(COMMENTED_IF_RE, (_, inner: string) => `if (false /* UNRESOLVED: ${inner.trim()} */)`);
}

function resolveCallPlaceholders(body: string, methodMap: Map<string, string>): string {
  return body.replace(TODO_CALL_RE, (_, programId: string, args: string) => {
    const methodName = methodMap.get(programId.toUpperCase());
    if (!methodName) return `/* UNRESOLVED: ${programId}(${args}) */`;
    return `${methodName}(${args});`;
  });
}

function indentLines(text: string, indent: string): string {
  return text
    .split("\n")
    .map(line => (line.trim() ? `${indent}${line}` : ""))
    .join("\n");
}

export type AssembleResult = {
  source: string;
  /** methodName → 1-based start line of the method signature in the assembled file */
  methodLineStarts: Record<string, number>;
};

export function assembleJavaClass(
  className: string,
  entryProgramId: string,
  translatedMethods: readonly JavaMethodTranslation[],
  failedTranslations: readonly string[],
): AssembleResult {
  const methodMap = new Map(
    translatedMethods.map(m => [m.programId.toUpperCase(), m.methodName]),
  );

  const entryMethod = translatedMethods.find(
    m => m.programId.toUpperCase() === entryProgramId.toUpperCase(),
  );
  const entryMethodName = entryMethod?.methodName ?? translatedMethods[0]?.methodName ?? "run";
  const entryParams = entryMethod?.params ?? translatedMethods[0]?.params ?? [];

  const mainBody =
    entryParams.length === 0
      ? `        new ${className}().${entryMethodName}();`
      : `        // Entry: ${entryMethodName}(${entryParams.map(p => p.type).join(", ")})`;

  const lines: string[] = [];
  lines.push(`public class ${className} {`);
  lines.push("");

  if (failedTranslations.length > 0) {
    lines.push(`    // ${failedTranslations.length} subprogram(s) failed translation and are omitted:`);
    lines.push(`    // ${failedTranslations.join(", ")}`);
    lines.push("");
  }

  lines.push("    public static void main(String[] args) {");
  lines.push(mainBody);
  lines.push("    }");

  const methodLineStarts: Record<string, number> = {};

  for (const m of translatedMethods) {
    lines.push("");
    const params = m.params.map(p => `${p.type} ${p.name}`).join(", ");
    const signatureLine = `    public ${m.returnType} ${m.methodName}(${params}) {`;
    // +1 because line numbers are 1-based and we haven't pushed this line yet
    methodLineStarts[m.methodName] = lines.length + 1;
    lines.push(signatureLine);
    const resolved = sanitizeBody(resolveCallPlaceholders(m.body, methodMap));
    lines.push(indentLines(resolved, "        "));
    lines.push("    }");
  }

  lines.push("");
  lines.push("}");

  return { source: lines.join("\n"), methodLineStarts };
}
