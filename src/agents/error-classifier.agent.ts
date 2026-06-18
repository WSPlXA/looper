import type { CompileErrorClassification } from "../schemas/compile-error.schema.js";
import { summarizeCompilerError } from "../skills/repair/parse-compiler-error.skill.js";

const rules: ReadonlyArray<readonly [RegExp, CompileErrorClassification["errorClass"], string]> = [
  [/package\s+[\w.]+\s+does not exist|cannot find symbol\s*\r?\n\s*symbol:\s*class/i, "MissingImport", "Add or correct the required JDK import; do not add external dependencies."],
  [/cannot find symbol/i, "MissingSymbol", "Reconcile generated identifiers with the COBOL variable mapping."],
  [/incompatible types|cannot be converted/i, "TypeMismatch", "Reconcile Java types while preserving COBOL numeric and text semantics."],
  [/';' expected|illegal start|reached end of file|not a statement|expected$/im, "SyntaxError", "Apply the smallest syntax-only correction."],
  [/cannot be applied to given types|method .* in class .* cannot be applied/i, "MethodSignatureMismatch", "Match the invoked method signature and argument types."],
  [/class .* is public, should be declared in a file named/i, "PackagePathMismatch", "Align the public class name and source file path."],
  [/unsupported|not supported/i, "UnsupportedTranslation", "Stop automatic repair and request human review."],
];

export function classifyCompileError(stderr: string): CompileErrorClassification {
  for (const [pattern, errorClass, repairHint] of rules) {
    if (pattern.test(stderr)) return { errorClass, confidence: 0.9, summary: summarizeCompilerError(stderr, 1024), repairHint };
  }
  return { errorClass: "Unknown", confidence: 0.3, summary: summarizeCompilerError(stderr, 1024) || "javac failed without stderr", repairHint: "Inspect the structured compiler summary and make a minimal localized repair." };
}
