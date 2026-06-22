import { describe, expect, it } from "vitest";
import { declareClassFields } from "../../src/skills/java/declare-class-fields.skill.js";

describe("declareClassFields", () => {
  it("reads Maven compiler line coordinates", () => {
    const source = `package generated.programs;
public final class HelloProgram {
    public void run() {
        sharedCount++;
    }
}`;
    const stderr = "[ERROR] C:/generated/HelloProgram.java:[4,9] cannot find symbol";
    expect(declareClassFields(source, stderr).addedFields).toEqual([
      expect.objectContaining({ name: "sharedCount", type: "int" }),
    ]);
  });
});
