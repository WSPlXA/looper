export type TargetJavaProfile = Readonly<{
  id: string;
  version: number;
  layout: "SINGLE_SOURCE_FILE";
  packageDeclaration: "FORBIDDEN";
  externalDependencies: "FORBIDDEN";
  className: "MATCH_TARGET_CLASS_NAME";
  procedureDivision: "INSTANCE_RUN_METHOD";
  entryPoint: "MAIN_DELEGATES_TO_RUN";
  display: "SYSTEM_OUT";
  allowedImportPrefixes: readonly string[];
  forbiddenSymbols: readonly string[];
  maxSourceBytes: number;
}>;

export const plainJavaSingleClassV1: TargetJavaProfile = Object.freeze({
  id: "plain-java-single-class-v1",
  version: 1,
  layout: "SINGLE_SOURCE_FILE",
  packageDeclaration: "FORBIDDEN",
  externalDependencies: "FORBIDDEN",
  className: "MATCH_TARGET_CLASS_NAME",
  procedureDivision: "INSTANCE_RUN_METHOD",
  entryPoint: "MAIN_DELEGATES_TO_RUN",
  display: "SYSTEM_OUT",
  allowedImportPrefixes: Object.freeze(["java.", "javax."]),
  forbiddenSymbols: Object.freeze([
    "org.springframework",
    "lombok.",
    "jakarta.persistence",
    "javax.persistence",
    "org.hibernate",
    "java.sql",
    "javax.sql",
    "pom.xml",
    "build.gradle",
  ]),
  maxSourceBytes: 256 * 1024,
});

export function describeTargetJavaProfile(profile: TargetJavaProfile, className: string): string {
  return JSON.stringify({
    ...profile,
    targetClassName: className,
    requiredShape: `public class ${className} with public void run() and public static void main(String[] args) delegating to new ${className}().run()`,
  });
}
