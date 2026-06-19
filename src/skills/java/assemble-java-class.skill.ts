import type { JavaMethodTranslation } from "../../schemas/assembly-state.schema.js";
import { countNetBraces } from "./count-net-braces.skill.js";

// Match: // TODO call PROGRAM-ID(args) — handles nested parens in args via greedy .*
// Anchored to end-of-line so (.*) captures everything up to the last ) on the line.
const TODO_CALL_RE = /\/\/ TODO call ([A-Za-z0-9_$#@-]+)\((.*)\)\s*$/gm;

// if (/* any comment */) → if (false /* UNRESOLVED: any comment */)
const COMMENTED_IF_RE = /if\s*\(\/\*([^*]*(?:\*(?!\/)[^*]*)*)\*\/\s*\)/g;

// x = /* expr */; → x = 0 /* UNRESOLVED: expr */;
// Prevents assignments where the LLM put a comment in place of an unresolvable expression.
const ASSIGN_COMMENT_RE = /(\b\w+)\s*=\s*\/\*([^*]*(?:\*(?!\/)[^*]*)*)\*\/\s*;/g;

// Strip access/static modifiers from declarations inside method body (8+ spaces indent = inside method).
// "        public static final int X = 0;" → "        final int X = 0;"
// "        static boolean initDone = false;" → "        boolean initDone = false;"
// Java has no static local variables; public/private/protected are also illegal inside method bodies.
const METHOD_LEVEL_MODIFIER_RE = /^( {8,})((?:(?:public|private|protected|static)\s+)+)/gm;

// Strip English prose lines leaked from LLM reasoning chains.
// A prose line: 8+ spaces indent, starts with capital letter, no Java operators, 25+ chars.
// Example: "        Given the complexity, I'll assume we are to translate..."
const PROSE_LINE_RE = /^( {8,})([A-Z][a-zA-Z][^;{}()=\[\]<>@\n]{25,})\s*$/gm;

function sanitizeBody(body: string): string {
  return body
    .replace(COMMENTED_IF_RE, (_, inner: string) => `if (false /* UNRESOLVED: ${inner.trim()} */)`)
    .replace(ASSIGN_COMMENT_RE, (_, varName: string, inner: string) => `${varName} = 0; /* UNRESOLVED: ${inner.trim()} */`)
    .replace(METHOD_LEVEL_MODIFIER_RE, "$1")  // strip modifiers, keep indentation
    .replace(PROSE_LINE_RE, (_, indent: string, text: string) => `${indent}// [REASONING-STRIPPED] ${text.trim().slice(0, 80)}`);
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
  extraClassFields: readonly string[] = [],
): AssembleResult {
  // Deduplicate method names: if two programs chose the same name+signature, append _2, _3, …
  const seenSignatures = new Map<string, number>(); // "name(types)" → count
  const deduped = translatedMethods.map(m => {
    const sig = `${m.methodName}(${m.params.map(p => p.type).join(",")})`;
    const count = (seenSignatures.get(sig) ?? 0) + 1;
    seenSignatures.set(sig, count);
    if (count === 1) return m;
    return { ...m, methodName: `${m.methodName}_${count}` };
  });

  const methodMap = new Map(
    deduped.map(m => [m.programId.toUpperCase(), m.methodName]),
  );

  const entryMethod = deduped.find(
    m => m.programId.toUpperCase() === entryProgramId.toUpperCase(),
  );
  const entryMethodName = entryMethod?.methodName ?? deduped[0]?.methodName ?? "run";
  const entryParams = entryMethod?.params ?? deduped[0]?.params ?? [];

  const mainBody =
    entryParams.length === 0
      ? `        new ${className}().${entryMethodName}();`
      : `        // Entry: ${entryMethodName}(${entryParams.map(p => p.type).join(", ")})`;

  const lines: string[] = [];
  lines.push(`public class ${className} {`);
  lines.push("");

  if (extraClassFields.length > 0) {
    lines.push("    // Class-level fields (COBOL EXTERNAL / shared WORKING-STORAGE)");
    for (const decl of extraClassFields) lines.push(`    ${decl.trim()}`);
    lines.push("");
  }

  if (failedTranslations.length > 0) {
    lines.push(`    // ${failedTranslations.length} subprogram(s) failed translation and are omitted:`);
    lines.push(`    // ${failedTranslations.join(", ")}`);
    lines.push("");
  }

  lines.push("    public static void main(String[] args) {");
  lines.push(mainBody);
  lines.push("    }");

  const methodLineStarts: Record<string, number> = {};

  for (const m of deduped) {
    lines.push("");
    const params = m.params.map(p => `${p.type} ${p.name}`).join(", ");
    const signatureLine = `    public ${m.returnType} ${m.methodName}(${params}) {`;
    // +1 because line numbers are 1-based and we haven't pushed this line yet
    methodLineStarts[m.methodName] = lines.length + 1;
    lines.push(signatureLine);
    const resolvedBody = sanitizeBody(resolveCallPlaceholders(m.body, methodMap));
    const net = countNetBraces(resolvedBody);
    const safeBody = net === 0
      ? resolvedBody
      : `        // WARNING: body had unbalanced braces (net ${net > 0 ? "+" : ""}${net}) — body suppressed\n        throw new UnsupportedOperationException("${m.methodName}: translation produced unbalanced braces");`;
    lines.push(net === 0 ? indentLines(resolvedBody, "        ") : safeBody);
    lines.push("    }");
  }

  lines.push("");
  lines.push("}");

  return { source: lines.join("\n"), methodLineStarts };
}
