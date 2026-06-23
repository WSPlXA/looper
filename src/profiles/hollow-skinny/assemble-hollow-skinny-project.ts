const JAVA_PACKAGE_RE = /^[a-z_$][A-Za-z\d_$]*(?:\.[a-z_$][A-Za-z\d_$]*)*$/;
const JAVA_TYPE_RE = /^[A-Za-z_$][A-Za-z\d_$]*$/;
const VERSION_RE = /^\d+\.\d+\.\d+(?:[-.A-Za-z\d]+)?$/;

export type HollowSkinnyPlugin = {
  programId: string;
  className: string;
  methodBody: string;
};

export type HollowSkinnyProject = {
  files: Array<{ relativePath: string; content: string }>;
};

type HollowSkinnyInput = {
  groupId: string;
  springBootVersion: string;
  javaVersion: number;
  plugins: HollowSkinnyPlugin[];
};

function assertValidInput(input: HollowSkinnyInput): void {
  if (!JAVA_PACKAGE_RE.test(input.groupId)) {
    throw new Error(`Invalid Java groupId/package name: ${input.groupId}`);
  }
  if (!VERSION_RE.test(input.springBootVersion)) {
    throw new Error(`Invalid Spring Boot version: ${input.springBootVersion}`);
  }
  if (!Number.isInteger(input.javaVersion) || input.javaVersion < 17) {
    throw new Error(`Invalid Java version: ${input.javaVersion}`);
  }
  for (const plugin of input.plugins) {
    if (!plugin.programId.trim()) {
      throw new Error("Plugin programId is required");
    }
    if (!JAVA_TYPE_RE.test(plugin.className)) {
      throw new Error(`Invalid Java plugin class name: ${plugin.className}`);
    }
  }
}

function javaString(value: string): string {
  return JSON.stringify(value);
}

function indentJavaBody(body: string): string {
  const trimmed = body.trim();
  return (trimmed || "return 0;").split("\n").map(line => `        ${line}`).join("\n");
}

function packagePath(packageName: string): string {
  return packageName.replaceAll(".", "/");
}

function buildParentPom(input: HollowSkinnyInput): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>
  <parent>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-parent</artifactId>
    <version>${input.springBootVersion}</version>
    <relativePath/>
  </parent>
  <groupId>${input.groupId}</groupId>
  <artifactId>cobol-hollow-skinny</artifactId>
  <version>0.0.1-SNAPSHOT</version>
  <packaging>pom</packaging>
  <modules>
    <module>hollow</module>
    <module>skinny</module>
  </modules>
  <properties>
    <java.version>${input.javaVersion}</java.version>
  </properties>
</project>
`;
}

function buildModulePom(input: HollowSkinnyInput, artifactId: "hollow" | "skinny"): string {
  const skinnyDependency = artifactId === "skinny"
    ? `  <dependencies>
    <dependency>
      <groupId>\${project.groupId}</groupId>
      <artifactId>hollow</artifactId>
      <version>\${project.version}</version>
    </dependency>
  </dependencies>
`
    : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>
  <parent>
    <groupId>${input.groupId}</groupId>
    <artifactId>cobol-hollow-skinny</artifactId>
    <version>0.0.1-SNAPSHOT</version>
    <relativePath>../pom.xml</relativePath>
  </parent>
  <artifactId>${artifactId}</artifactId>
${skinnyDependency}</project>
`;
}

function buildProgramPlugin(apiPackage: string): string {
  return `package ${apiPackage};

public interface ProgramPlugin {
    String programId();
    int execute(ProgramContext context);
}
`;
}

function buildProgramContext(apiPackage: string): string {
  return `package ${apiPackage};

import java.util.HashMap;
import java.util.Map;

public final class ProgramContext {
    private final Map<String, Object> values = new HashMap<>();

    public Object get(String name) { return values.get(name); }
    public void put(String name, Object value) { values.put(name, value); }
}
`;
}

function buildPluginLoader(runtimePackage: string, apiPackage: string): string {
  return `package ${runtimePackage};

import ${apiPackage}.ProgramPlugin;
import java.util.ServiceLoader;

public final class PluginLoader {
    public Iterable<ProgramPlugin> load() {
        return ServiceLoader.load(ProgramPlugin.class);
    }
}
`;
}

function buildPluginClass(pluginPackage: string, apiPackage: string, plugin: HollowSkinnyPlugin): string {
  return `package ${pluginPackage};

import ${apiPackage}.ProgramContext;
import ${apiPackage}.ProgramPlugin;

public final class ${plugin.className} implements ProgramPlugin {
    @Override
    public String programId() {
        return ${javaString(plugin.programId)};
    }

    @Override
    public int execute(ProgramContext context) {
${indentJavaBody(plugin.methodBody)}
    }
}
`;
}

export function assembleHollowSkinnyProject(input: HollowSkinnyInput): HollowSkinnyProject {
  assertValidInput(input);

  const apiPackage = `${input.groupId}.api`;
  const runtimePackage = `${input.groupId}.runtime`;
  const pluginPackage = `${input.groupId}.skinny`;
  const apiSourceRoot = `hollow/src/main/java/${packagePath(apiPackage)}`;
  const runtimeSourceRoot = `hollow/src/main/java/${packagePath(runtimePackage)}`;
  const pluginSourceRoot = `skinny/src/main/java/${packagePath(pluginPackage)}`;
  const servicePath = `skinny/src/main/resources/META-INF/services/${apiPackage}.ProgramPlugin`;
  const pluginClassNames = input.plugins.map(plugin => `${pluginPackage}.${plugin.className}`);

  return {
    files: [
      { relativePath: "pom.xml", content: buildParentPom(input) },
      { relativePath: "hollow/pom.xml", content: buildModulePom(input, "hollow") },
      { relativePath: "skinny/pom.xml", content: buildModulePom(input, "skinny") },
      { relativePath: `${apiSourceRoot}/ProgramPlugin.java`, content: buildProgramPlugin(apiPackage) },
      { relativePath: `${apiSourceRoot}/ProgramContext.java`, content: buildProgramContext(apiPackage) },
      { relativePath: `${runtimeSourceRoot}/PluginLoader.java`, content: buildPluginLoader(runtimePackage, apiPackage) },
      ...input.plugins.map(plugin => ({
        relativePath: `${pluginSourceRoot}/${plugin.className}.java`,
        content: buildPluginClass(pluginPackage, apiPackage, plugin),
      })),
      { relativePath: servicePath, content: `${pluginClassNames.join("\n")}\n` },
    ],
  };
}
