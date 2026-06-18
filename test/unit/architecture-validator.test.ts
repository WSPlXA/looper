import { describe, expect, it } from "vitest";
import { buildJavaArchitecturePolicy } from "../../src/architecture/java/architecture-validator.js";
import { plainJavaSingleClassV1 } from "../../src/architecture/java/target-java-profile.js";

const policy = buildJavaArchitecturePolicy(plainJavaSingleClassV1);

describe("plain Java single-class architecture policy", () => {
  it("accepts the deterministic V1 class layout", () => {
    const source = `public class Hello {
  public static void main(String[] args) { new Hello().run(); }
  public void run() { System.out.println("HELLO"); }
}`;
    expect(policy.validate({ className: "Hello", source })).toMatchObject({ passed: true, profileId: "plain-java-single-class-v1", violations: [] });
  });

  it.each([
    ["package declaration", "package demo; public class Hello { public static void main(String[] args) { new Hello().run(); } public void run() {} }", "PACKAGE_FORBIDDEN"],
    ["additional type", "public class Hello { public static void main(String[] args) { new Hello().run(); } public void run() {} } class Extra {}", "SINGLE_TYPE_REQUIRED"],
    ["framework annotation", "@org.springframework.stereotype.Component public class Hello { public static void main(String[] args) { new Hello().run(); } public void run() {} }", "FRAMEWORK_SYMBOL_FORBIDDEN"],
    ["missing run method", "public class Hello { public static void main(String[] args) {} }", "RUN_METHOD_REQUIRED"],
  ])("rejects %s", (_name, source, expectedCode) => {
    expect(policy.validate({ className: "Hello", source }).violations.map((item) => item.code)).toContain(expectedCode);
  });
});
