export type HollowSkinnyVerification = {
  passed: boolean;
  violations: string[];
};

type ProjectFile = {
  relativePath: string;
  content: string;
};

function hasMutableStaticField(content: string): boolean {
  return /^\s*(?:public|private|protected)?\s*static\s+(?!final\b)[^();=]+(?:=|;)/m.test(content);
}

function hasHollowDependency(content: string): boolean {
  return /<dependency>[\s\S]*?<artifactId>\s*hollow\s*<\/artifactId>[\s\S]*?<\/dependency>/m.test(content);
}

export function verifyHollowSkinnyProject(
  files: readonly ProjectFile[],
): HollowSkinnyVerification {
  const violations: string[] = [];
  const paths = new Set(files.map(file => file.relativePath));

  for (const file of files) {
    if (
      file.relativePath.startsWith("hollow/")
      && /^\s*import\s+[\w.]*\.skinny\.[\w.*]+\s*;/m.test(file.content)
    ) {
      violations.push(`${file.relativePath} imports a skinny package`);
    }
  }

  if (![...paths].some(path => path.startsWith("hollow/") && path.endsWith("/api/ProgramPlugin.java"))) {
    violations.push("Missing hollow ProgramPlugin.java");
  }

  if (![...paths].some(path => path.startsWith("skinny/src/main/resources/META-INF/services/") && path.endsWith(".api.ProgramPlugin"))) {
    violations.push("Missing ProgramPlugin service registration");
  }

  for (const file of files) {
    if (
      file.relativePath.startsWith("skinny/src/main/java/")
      && file.relativePath.endsWith(".java")
      && hasMutableStaticField(file.content)
    ) {
      violations.push(`${file.relativePath} declares a mutable static field`);
    }
  }

  const skinnyPom = files.find(file => file.relativePath === "skinny/pom.xml");
  if (!skinnyPom || !hasHollowDependency(skinnyPom.content)) {
    violations.push("skinny/pom.xml is missing a hollow dependency");
  }

  return {
    passed: violations.length === 0,
    violations,
  };
}
