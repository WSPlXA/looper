import { describe, expect, it } from "vitest";
import type { JavaMethodTranslation, SubprogramInfo } from "../../src/schemas/assembly-state.schema.js";
import { assembleSpringBootProject } from "../../src/skills/java/assemble-spring-boot-project.skill.js";

const subprograms: SubprogramInfo[] = [
  {
    programId: "HELLO",
    sourceFile: "hello.cob",
    expandedSource: "PROGRAM-ID. HELLO.",
    linkageParams: [],
    callees: ["FORMAT-NAME"],
  },
  {
    programId: "FORMAT-NAME",
    sourceFile: "format-name.cob",
    expandedSource: "PROGRAM-ID. FORMAT-NAME.",
    linkageParams: [{ name: "LK-NAME", pic: "PIC X(20)." }],
    callees: [],
  },
];

const methods: JavaMethodTranslation[] = [
  {
    programId: "HELLO",
    methodName: "hello",
    params: [],
    returnType: "void",
    body: "// TODO call FORMAT-NAME(\"Ada\")\nFORMAT_NAME(\"Grace\");",
    notes: "",
    attempts: 1,
  },
  {
    programId: "FORMAT-NAME",
    methodName: "formatName",
    params: [{ name: "lkName", type: "String" }],
    returnType: "void",
    body: "System.out.println(lkName);",
    notes: "",
    attempts: 1,
  },
];

describe("Spring Boot multi-class project assembler", () => {
  it("emits one program class per PROGRAM-ID and keeps Spring out of the hot path", () => {
    const project = assembleSpringBootProject({
      applicationClassName: "CobolCraftApplication",
      packageName: "generated.cobolcraft",
      entryProgramId: "HELLO",
      subprograms,
      translatedMethods: methods,
      failedTranslations: [],
      extraClassFields: ["private int[] counters = new int[1000];"],
      springBootVersion: "3.4.5",
    });

    const files = new Map(project.files.map(file => [file.relativePath, file.content]));
    expect(files.get("pom.xml")).toContain("<version>3.4.5</version>");
    expect(files.get("src/main/java/generated/cobolcraft/CobolCraftApplication.java"))
      .toContain("@SpringBootApplication");
    expect(files.get("src/main/java/generated/cobolcraft/runtime/CobolRuntimeState.java"))
      .toContain("protected static int[] counters = new int[1000];");
    expect(files.get("src/main/java/generated/cobolcraft/runtime/Pointer.java"))
      .toContain("public record Pointer(long address)");

    const hello = files.get("src/main/java/generated/cobolcraft/programs/HelloProgram.java");
    const formatName = files.get("src/main/java/generated/cobolcraft/programs/FormatNameProgram.java");
    expect(hello).toContain("public final class HelloProgram extends CobolRuntimeState");
    expect(hello).toContain("runtime.formatName(\"Ada\");");
    expect(hello).toContain("runtime.formatName(\"Grace\");");
    expect(hello).not.toContain("@Component");
    expect(formatName).toContain("public void formatName(String lkName)");
    expect(project.programFilePaths).toEqual({
      HELLO: "src/main/java/generated/cobolcraft/programs/HelloProgram.java",
      "FORMAT-NAME": "src/main/java/generated/cobolcraft/programs/FormatNameProgram.java",
    });
  });

  it("rejects unsafe package names before writing files", () => {
    expect(() => assembleSpringBootProject({
      applicationClassName: "App",
      packageName: "generated.cobol;evil",
      entryProgramId: "HELLO",
      subprograms,
      translatedMethods: methods,
      failedTranslations: [],
      extraClassFields: [],
      springBootVersion: "3.4.5",
    })).toThrow("Invalid Java package name");
  });
});
