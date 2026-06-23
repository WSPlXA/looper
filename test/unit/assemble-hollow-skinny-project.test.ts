import { describe, expect, it } from "vitest";
import { assembleHollowSkinnyProject } from "../../src/profiles/hollow-skinny/assemble-hollow-skinny-project.js";
import { verifyHollowSkinnyProject } from "../../src/profiles/hollow-skinny/verify-hollow-skinny-project.js";

describe("hollow/skinny project assembly", () => {
  it("creates a parent build, public hollow contracts, and skinny service registration", () => {
    const project = assembleHollowSkinnyProject({
      groupId: "generated.cobol",
      springBootVersion: "3.4.5",
      javaVersion: 17,
      plugins: [{ programId: "ORDER-MAIN", className: "OrderMainPlugin", methodBody: "return 0;" }],
    });
    const paths = project.files.map(file => file.relativePath);
    expect(paths).toContain("pom.xml");
    expect(paths).toContain("hollow/pom.xml");
    expect(paths).toContain("skinny/pom.xml");
    expect(paths).toContain("hollow/src/main/java/generated/cobol/api/ProgramPlugin.java");
    expect(paths).toContain("skinny/src/main/resources/META-INF/services/generated.cobol.api.ProgramPlugin");
    expect(project.files.find(file => file.relativePath === "skinny/pom.xml")?.content)
      .toContain("<artifactId>hollow</artifactId>");
    expect(project.files.find(file => file.relativePath === "hollow/pom.xml")?.content)
      .not.toContain("<artifactId>skinny</artifactId>");

    const verification = verifyHollowSkinnyProject(project.files);
    expect(verification).toEqual({ passed: true, violations: [] });

    const invalid = project.files.map(file => file.relativePath.includes("/skinny/")
      ? file
      : { ...file, content: `${file.content}\nimport generated.cobol.skinny.Bad;` });
    expect(verifyHollowSkinnyProject(invalid).passed).toBe(false);
  });
});
