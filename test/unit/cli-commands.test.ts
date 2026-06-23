import { describe, expect, it } from "vitest";
import { parseCliCommand } from "../../src/interfaces/cli/commands.js";
import { parseMigrationPlanYaml } from "../../src/interfaces/cli/repl.js";

describe("terminal commands", () => {
  it.each([
    ["/plan", { name: "plan", args: [] }],
    ["/approve architecture hollow-skinny-v1", { name: "approve", args: ["architecture", "hollow-skinny-v1"] }],
    ["/run migrate-main", { name: "run", args: ["migrate-main"] }],
    ["/resume", { name: "resume", args: [] }],
  ])("parses %s", (input, expected) => {
    expect(parseCliCommand(input)).toEqual(expected);
  });

  it("parses persisted migration plan tasks", () => {
    expect(parseMigrationPlanYaml([
      'sessionId: "session-1"',
      "iteration: 2",
      "tasks:",
      '  - id: "migrate-main"',
      "    programIds:",
      '      - "MAIN"',
      "    allowedPaths:",
      '      - "pom.xml"',
      '      - "skinny/**"',
      '    status: "pending"',
    ].join("\n"))).toEqual([
      {
        id: "migrate-main",
        programIds: ["MAIN"],
        allowedPaths: ["pom.xml", "skinny/**"],
      },
    ]);
  });
});
