import type { ArchitecturePolicy, ArchitectureValidation, ArchitectureViolation } from "../../core/architecture/architecture-policy.js";
import type { TargetJavaProfile } from "./target-java-profile.js";

export type JavaSourceArtifact = { className: string; source: string };

function maskCommentsAndLiterals(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\r\n]*/g, " ")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])'/g, "''");
}

function add(violations: ArchitectureViolation[], condition: boolean, code: string, message: string): void {
  if (condition) violations.push({ code, message });
}

export function buildJavaArchitecturePolicy(profile: TargetJavaProfile): ArchitecturePolicy<TargetJavaProfile, JavaSourceArtifact> {
  return {
    profile,
    validate({ className, source }): ArchitectureValidation {
      const violations: ArchitectureViolation[] = [];
      const code = maskCommentsAndLiterals(source);
      add(violations, Buffer.byteLength(source, "utf8") > profile.maxSourceBytes, "SOURCE_TOO_LARGE", `Java source exceeds ${profile.maxSourceBytes} bytes`);
      add(violations, /^\s*package\s+[\w.]+\s*;/m.test(code), "PACKAGE_FORBIDDEN", "V1 forbids package declarations");

      for (const match of code.matchAll(/^\s*import\s+(?:static\s+)?([\w.]+(?:\*)?)\s*;/gm)) {
        const imported = match[1] ?? "";
        add(violations, !profile.allowedImportPrefixes.some((prefix) => imported.startsWith(prefix)), "EXTERNAL_IMPORT_FORBIDDEN", `External import is forbidden: ${imported}`);
      }
      for (const symbol of profile.forbiddenSymbols) {
        add(violations, code.toLowerCase().includes(symbol.toLowerCase()), "FRAMEWORK_SYMBOL_FORBIDDEN", `Forbidden framework/build symbol: ${symbol}`);
      }
      add(violations, /\b(?:com|org|io|net)\.[A-Za-z_$][\w$.]*/.test(code), "EXTERNAL_SYMBOL_FORBIDDEN", "Fully qualified external symbols are forbidden");

      const declaredTypes = [...code.matchAll(/\b(?:class|interface|enum|record)\s+([A-Za-z_$][\w$]*)/g)].map((match) => match[1]);
      add(violations, declaredTypes.length !== 1, "SINGLE_TYPE_REQUIRED", `Expected one Java type, found ${declaredTypes.length}`);
      add(violations, declaredTypes[0] !== className, "CLASS_NAME_MISMATCH", `Expected class ${className}, found ${declaredTypes[0] ?? "none"}`);

      const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      add(violations, !new RegExp(`\\bpublic\\s+(?:final\\s+)?class\\s+${escaped}\\b`).test(code), "PUBLIC_CLASS_REQUIRED", `Expected public class ${className}`);
      add(violations, !/\bpublic\s+void\s+run\s*\(\s*\)/.test(code), "RUN_METHOD_REQUIRED", "PROCEDURE DIVISION must map to public void run()");
      add(violations, !/\bpublic\s+static\s+void\s+main\s*\(\s*String\s*\[\s*]\s+\w+\s*\)/.test(code), "MAIN_METHOD_REQUIRED", "A plain javac-compatible main method is required");
      add(violations, !new RegExp(`new\\s+${escaped}\\s*\\(\\s*\\)\\s*\\.\\s*run\\s*\\(`).test(code), "MAIN_MUST_DELEGATE_TO_RUN", `main must delegate to new ${className}().run()`);

      return { passed: violations.length === 0, profileId: profile.id, violations };
    },
  };
}
