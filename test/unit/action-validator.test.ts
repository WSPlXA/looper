import { describe, expect, it } from "vitest";
import { validateFileAction } from "../../src/core/actions/action.validator.js";
import { applyUnifiedDiff } from "../../src/core/actions/unified-diff.js";

describe("agent actions", () => {
  it("rejects paths outside the controlled output directory", () => {
    expect(() => validateFileAction({ type: "WRITE_FILE", path: "../escape.java", content: "" }, "C:/safe/output", "Hello.java")).toThrow("escapes outputDir");
    expect(() => validateFileAction({ type: "WRITE_FILE", path: "Other.java", content: "" }, "C:/safe/output", "Hello.java")).toThrow("exactly Hello.java");
  });

  it("applies a matching unified diff without invoking a shell", () => {
    const source = "class Hello {\n  int value = 1;\n}";
    const diff = "--- a/Hello.java\n+++ b/Hello.java\n@@ -1,3 +1,3 @@\n class Hello {\n-  int value = 1;\n+  int value = 2;\n }";
    expect(applyUnifiedDiff(source, diff)).toBe("class Hello {\n  int value = 2;\n}");
  });
});
