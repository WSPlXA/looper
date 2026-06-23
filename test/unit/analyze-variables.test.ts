import { describe, expect, it } from "vitest";
import {
  analyzeProgramVariables,
  buildXrefDatabase,
} from "../../src/skills/cobol/analyze-variables.skill.js";

describe("COBOL variable analysis", () => {
  it("maps declarations, references, sections, and callees", () => {
    const source = `       IDENTIFICATION DIVISION.
       PROGRAM-ID. ORDER-MAIN.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-TOTAL PIC 9(5).
       LINKAGE SECTION.
       01 LK-ORDER-ID PIC X(10).
       PROCEDURE DIVISION USING LK-ORDER-ID.
           MOVE 1 TO WS-TOTAL
           CALL "PRICE-CALC"
           GOBACK.`;

    const analysis = analyzeProgramVariables("ORDER-MAIN.cob", source);
    expect(analysis?.programId).toBe("ORDER-MAIN");
    expect(analysis?.declarations).toEqual([
      expect.objectContaining({ name: "WS-TOTAL", section: "WORKING-STORAGE" }),
      expect.objectContaining({ name: "LK-ORDER-ID", section: "LINKAGE" }),
    ]);
    expect(analysis?.references["WS-TOTAL"]).toHaveLength(1);
    expect(analysis?.callees).toEqual(["PRICE-CALC"]);
    expect(buildXrefDatabase([analysis!])).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "WS-TOTAL" })]),
    );
  });
});
