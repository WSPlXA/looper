import { buildLoopRunner } from "../core/loop/loop-runner.js";
import type { ModelClient } from "../core/model/model-client.js";
import type { SubprogramInfo, JavaMethodTranslation } from "../schemas/assembly-state.schema.js";
import { buildSubprogramTranslatorAgent } from "../agents/subprogram-translator.agent.js";
import { buildMethodSignature } from "../agents/program-assembler.agent.js";

type TranslationState = {
  subprogram: SubprogramInfo;
  knownSignatures: string;
  result: Omit<JavaMethodTranslation, "programId" | "attempts"> | null;
};

const VALID_METHOD_NAME = /^[a-z][A-Za-z0-9_$]*$/;

function buildSubprogramTranslationLoop(model: ModelClient, maxAttempts: number) {
  const translate = buildSubprogramTranslatorAgent(model);
  return buildLoopRunner<TranslationState>({
    maxAttempts,
    async step(state, _attemptNo) {
      const raw = await translate({ subprogram: state.subprogram, knownSignatures: state.knownSignatures });
      return { ...state, result: raw };
    },
    evaluator: {
      name: "subprogram-translation-evaluator",
      async evaluate(state) {
        const r = state.result;
        if (!r) return { passed: false, reason: "No translation produced" };
        if (!VALID_METHOD_NAME.test(r.methodName)) {
          return { passed: false, reason: `Invalid methodName: "${r.methodName}" — must be camelCase starting with lowercase letter` };
        }
        if (!r.body.trim()) {
          return { passed: false, reason: "body is empty" };
        }
        const expected = state.subprogram.linkageParams.length;
        if (r.params.length !== expected) {
          return { passed: false, reason: `params count mismatch: got ${r.params.length}, expected ${expected} (from LINKAGE SECTION)` };
        }
        return { passed: true, reason: "Method structure is valid" };
      },
    },
  });
}

export type SubprogramTranslationResult =
  | { ok: true; method: Omit<JavaMethodTranslation, "programId" | "attempts">; attempts: number }
  | { ok: false; attempts: number; reason: string };

export async function runSubprogramTranslationLoop(
  subprogram: SubprogramInfo,
  knownSignatures: string,
  model: ModelClient,
  maxAttempts: number,
): Promise<SubprogramTranslationResult> {
  const runLoop = buildSubprogramTranslationLoop(model, maxAttempts);
  const { state, attempts, evaluation, stopped } = await runLoop({
    subprogram,
    knownSignatures,
    result: null,
  });
  if (stopped === "PASSED" && state.result) {
    return { ok: true, method: state.result, attempts };
  }
  return { ok: false, attempts, reason: evaluation.reason };
}

export function buildKnownSignatures(translatedMethods: JavaMethodTranslation[]): string {
  return translatedMethods
    .map(m => buildMethodSignature(m))
    .join("\n");
}
