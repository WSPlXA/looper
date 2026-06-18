import { describe, expect, it } from "vitest";
import { buildLoopRunner } from "../../src/core/loop/loop-runner.js";

describe("buildLoopRunner", () => {
  it("stops when evaluator passes", async () => {
    const run = buildLoopRunner<number>({
      maxAttempts: 5,
      step: async (value) => value + 1,
      evaluator: { name: "three", evaluate: async (value) => ({ passed: value === 3, reason: String(value) }) },
    });
    const result = await run(0);
    expect(result).toMatchObject({ state: 3, attempts: 3, stopped: "PASSED" });
  });

  it("stops at maxAttempts without silent success", async () => {
    const run = buildLoopRunner<number>({
      maxAttempts: 2,
      step: async (value) => value + 1,
      evaluator: { name: "never", evaluate: async () => ({ passed: false, reason: "failed" }) },
    });
    expect(await run(0)).toMatchObject({ state: 2, attempts: 2, stopped: "MAX_ATTEMPTS", evaluation: { passed: false } });
  });
});
