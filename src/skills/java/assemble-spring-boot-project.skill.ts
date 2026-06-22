import type { JavaMethodTranslation, SubprogramInfo } from "../../schemas/assembly-state.schema.js";
import { countNetBraces } from "./count-net-braces.skill.js";
import { resolveCallPlaceholders, sanitizeJavaMethodBody } from "./assemble-java-class.skill.js";

const JAVA_PACKAGE_RE = /^[a-z_$][A-Za-z\d_$]*(?:\.[a-z_$][A-Za-z\d_$]*)*$/;
const JAVA_TYPE_RE = /^[A-Za-z_$][A-Za-z\d_$]*$/;
const VERSION_RE = /^\d+\.\d+\.\d+(?:[-.A-Za-z\d]+)?$/;

export type GeneratedProjectFile = {
  relativePath: string;
  content: string;
};

export type SpringBootProject = {
  files: GeneratedProjectFile[];
  programFilePaths: Record<string, string>;
  entrypointRelativePath: string;
  pomRelativePath: string;
};

type ProjectInput = {
  applicationClassName: string;
  packageName: string;
  entryProgramId: string;
  subprograms: readonly SubprogramInfo[];
  translatedMethods: readonly JavaMethodTranslation[];
  failedTranslations: readonly string[];
  extraClassFields: readonly string[];
  springBootVersion: string;
};

function toJavaTypeName(value: string): string {
  const parts = value.split(/[^A-Za-z\d_$]+/).filter(Boolean);
  const joined = parts.map(part => {
    const lower = part.toLowerCase();
    return `${lower[0]?.toUpperCase() ?? ""}${lower.slice(1)}`;
  }).join("");
  const candidate = joined || "Generated";
  return /^[A-Za-z_$]/.test(candidate) ? candidate : `P${candidate}`;
}

function indentLines(text: string, indent: string): string {
  return text.split("\n").map(line => line.trim() ? `${indent}${line}` : "").join("\n");
}

function dedupeMethods(methods: readonly JavaMethodTranslation[]): JavaMethodTranslation[] {
  const seen = new Map<string, number>();
  return methods.map(method => {
    const signature = `${method.methodName}(${method.params.map(param => param.type).join(",")})`;
    const count = (seen.get(signature) ?? 0) + 1;
    seen.set(signature, count);
    return count === 1 ? { ...method } : { ...method, methodName: `${method.methodName}_${count}` };
  });
}

function normalizeStateField(declaration: string): string {
  const trimmed = declaration.trim();
  const withoutAccess = trimmed.replace(/^(?:public|private|protected)\s+/, "");
  return withoutAccess.startsWith("static ")
    ? `protected ${withoutAccess}`
    : `protected static ${withoutAccess}`;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function qualifyDeclaredCalls(
  body: string,
  declaredCallees: readonly string[],
  methodMap: ReadonlyMap<string, string>,
): string {
  let qualified = resolveCallPlaceholders(body, methodMap, "runtime.");
  for (const callee of declaredCallees) {
    const targetMethod = methodMap.get(callee.toUpperCase());
    if (!targetMethod) continue;
    const candidates = new Set([targetMethod, callee.replaceAll("-", "_")]);
    for (const candidate of candidates) {
      qualified = qualified.replace(
        new RegExp(`(?<![.A-Za-z\\d_$])${escapeRegex(candidate)}\\s*\\(`, "g"),
        `runtime.${targetMethod}(`,
      );
    }
  }
  return qualified;
}

function buildPom(version: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>
  <parent>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-parent</artifactId>
    <version>${version}</version>
    <relativePath/>
  </parent>
  <groupId>generated.cobol</groupId>
  <artifactId>cobol-migration</artifactId>
  <version>0.0.1-SNAPSHOT</version>
  <properties>
    <java.version>17</java.version>
  </properties>
  <dependencies>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter</artifactId>
    </dependency>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-test</artifactId>
      <scope>test</scope>
    </dependency>
  </dependencies>
  <build>
    <plugins>
      <plugin>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-maven-plugin</artifactId>
      </plugin>
    </plugins>
  </build>
</project>
`;
}

export function assembleSpringBootProject(input: ProjectInput): SpringBootProject {
  if (!JAVA_PACKAGE_RE.test(input.packageName)) {
    throw new Error(`Invalid Java package name: ${input.packageName}`);
  }
  if (!JAVA_TYPE_RE.test(input.applicationClassName)) {
    throw new Error(`Invalid Java application class name: ${input.applicationClassName}`);
  }
  if (!VERSION_RE.test(input.springBootVersion)) {
    throw new Error(`Invalid Spring Boot version: ${input.springBootVersion}`);
  }

  const packagePath = input.packageName.replaceAll(".", "/");
  const sourceRoot = `src/main/java/${packagePath}`;
  const methods = dedupeMethods(input.translatedMethods);
  const methodMap = new Map(methods.map(method => [method.programId.toUpperCase(), method.methodName]));
  const subprogramMap = new Map(input.subprograms.map(subprogram => [subprogram.programId.toUpperCase(), subprogram]));
  const usedClassNames = new Map<string, number>();
  const classNameByProgram = new Map<string, string>();

  for (const method of methods) {
    const baseName = `${toJavaTypeName(method.programId)}Program`;
    const count = (usedClassNames.get(baseName) ?? 0) + 1;
    usedClassNames.set(baseName, count);
    classNameByProgram.set(method.programId.toUpperCase(), count === 1 ? baseName : `${baseName}${count}`);
  }

  const files: GeneratedProjectFile[] = [{ relativePath: "pom.xml", content: buildPom(input.springBootVersion) }];
  const programFilePaths: Record<string, string> = {};

  const stateFields = input.extraClassFields.map(normalizeStateField);
  files.push({
    relativePath: `${sourceRoot}/runtime/CobolRuntimeState.java`,
    content: `package ${input.packageName}.runtime;

public abstract class CobolRuntimeState {
${stateFields.length > 0 ? stateFields.map(field => `    ${field}`).join("\n") : "    // No shared COBOL state was inferred."}
}
`,
  });
  files.push({
    relativePath: `${sourceRoot}/runtime/Pointer.java`,
    content: `package ${input.packageName}.runtime;

public record Pointer(long address) {
    public static final Pointer NULL = new Pointer(0L);
}
`,
  });

  for (const method of methods) {
    const className = classNameByProgram.get(method.programId.toUpperCase())!;
    const relativePath = `${sourceRoot}/programs/${className}.java`;
    programFilePaths[method.programId] = relativePath;
    const params = method.params.map(param => `${param.type} ${param.name}`).join(", ");
    const declaredCallees = subprogramMap.get(method.programId.toUpperCase())?.callees ?? [];
    const resolvedBody = sanitizeJavaMethodBody(qualifyDeclaredCalls(method.body, declaredCallees, methodMap));
    const netBraces = countNetBraces(resolvedBody);
    const safeBody = netBraces === 0
      ? indentLines(resolvedBody, "        ")
      : `        throw new UnsupportedOperationException("${method.methodName}: unbalanced translated body");`;
    files.push({
      relativePath,
      content: `package ${input.packageName}.programs;

import ${input.packageName}.runtime.CobolRuntime;
import ${input.packageName}.runtime.CobolRuntimeState;
import ${input.packageName}.runtime.Pointer;

public final class ${className} extends CobolRuntimeState {
    private final CobolRuntime runtime;

    public ${className}(CobolRuntime runtime) {
        this.runtime = runtime;
    }

    // COBOL callees: ${declaredCallees.length > 0 ? declaredCallees.join(", ") : "none"}
    public ${method.returnType} ${method.methodName}(${params}) {
${safeBody}
    }
}
`,
    });
  }

  const runtimeFields = methods.map((method, index) => {
    const className = classNameByProgram.get(method.programId.toUpperCase())!;
    return `    private final ${className} program${index};`;
  });
  const runtimeInitializers = methods.map((method, index) => {
    const className = classNameByProgram.get(method.programId.toUpperCase())!;
    return `        this.program${index} = new ${className}(this);`;
  });
  const runtimeImports = [...new Set(methods.map(method => classNameByProgram.get(method.programId.toUpperCase())!))]
    .map(className => `import ${input.packageName}.programs.${className};`);
  const delegates = methods.map((method, index) => {
    const params = method.params.map(param => `${param.type} ${param.name}`).join(", ");
    const args = method.params.map(param => param.name).join(", ");
    const invocation = `program${index}.${method.methodName}(${args})`;
    const statement = method.returnType === "void" ? `${invocation};` : `return ${invocation};`;
    return `    public ${method.returnType} ${method.methodName}(${params}) {
        ${statement}
    }`;
  });

  files.push({
    relativePath: `${sourceRoot}/runtime/CobolRuntime.java`,
    content: `package ${input.packageName}.runtime;

${runtimeImports.join("\n")}

public final class CobolRuntime extends CobolRuntimeState {
${runtimeFields.join("\n")}

    public CobolRuntime() {
${runtimeInitializers.join("\n")}
    }

${delegates.join("\n\n")}
}
`,
  });

  const entryMethod = methods.find(method => method.programId.toUpperCase() === input.entryProgramId.toUpperCase()) ?? methods[0];
  const entryInvocation = entryMethod && entryMethod.params.length === 0
    ? `runtime.${entryMethod.methodName}();`
    : `throw new IllegalStateException("Entry requires parameters: ${entryMethod?.methodName ?? "missing"}");`;
  const entrypointRelativePath = `${sourceRoot}/${input.applicationClassName}.java`;
  files.push({
    relativePath: entrypointRelativePath,
    content: `package ${input.packageName};

import ${input.packageName}.runtime.CobolRuntime;
import org.springframework.boot.CommandLineRunner;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Bean;

@SpringBootApplication
public class ${input.applicationClassName} {
    public static void main(String[] args) {
        SpringApplication.run(${input.applicationClassName}.class, args);
    }

    @Bean
    CobolRuntime cobolRuntime() {
        return new CobolRuntime();
    }

    @Bean
    CommandLineRunner runCobol(CobolRuntime runtime) {
        return args -> ${entryInvocation}
    }
}
`,
  });

  files.push({
    relativePath: "README.md",
    content: `# Generated COBOL migration project

- Programs generated: ${methods.length}
- Failed translations omitted: ${input.failedTranslations.length}
- Entry program: ${input.entryProgramId}
- Runtime model: single Spring singleton with preallocated program dispatchers
`,
  });

  return { files, programFilePaths, entrypointRelativePath, pomRelativePath: "pom.xml" };
}
