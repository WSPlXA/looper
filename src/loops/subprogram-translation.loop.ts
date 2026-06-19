import { buildLoopRunner } from "../core/loop/loop-runner.js";
import type { ModelClient } from "../core/model/model-client.js";
import type { SubprogramInfo, JavaMethodTranslation } from "../schemas/assembly-state.schema.js";
import { buildSubprogramTranslatorAgent } from "../agents/subprogram-translator.agent.js";
import { buildMethodSignature } from "../agents/program-assembler.agent.js";
import { countNetBraces } from "../skills/java/count-net-braces.skill.js";

type TranslationState = {
  subprogram: SubprogramInfo;
  knownSignatures: string;
  skillRules: string;
  result: Omit<JavaMethodTranslation, "programId" | "attempts"> | null;
  failureReasons: string[];
  lastAttemptBody?: string;
};

const VALID_METHOD_NAME = /^[a-z][A-Za-z0-9_$]*$/;
const NESTED_METHOD_RE = /^\s*(?:public|private|protected|static|void|int|long|boolean|String|byte|char|double|float)\s+\w+\s*\(/m;
const COMMENTED_IF_RE = /if\s*\(\/\*/;

function buildSubprogramTranslationLoop(model: ModelClient, maxAttempts: number) {
  const translate = buildSubprogramTranslatorAgent(model);
  return buildLoopRunner<TranslationState>({
    maxAttempts,
    async step(state, _attemptNo) {
      const raw = await translate({
        subprogram: state.subprogram,
        knownSignatures: state.knownSignatures,
        skillRules: state.skillRules,
      });
      return { ...state, result: raw, lastAttemptBody: raw.body };
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
        if (NESTED_METHOD_RE.test(r.body)) {
          return { passed: false, reason: "body contains a nested method definition — use inline code or switch statements instead" };
        }
        if (COMMENTED_IF_RE.test(r.body)) {
          return { passed: false, reason: "body contains 'if (/* ... */)' with empty condition — use 'if (false /* UNRESOLVED */)'" };
        }
        const net = countNetBraces(r.body);
        if (net !== 0) {
          return { passed: false, reason: `body has unbalanced braces: net ${net > 0 ? "+" : ""}${net}` };
        }
        return { passed: true, reason: "Method structure is valid" };
      },
    },
    onAttempt: async (state, evaluation, _attemptNo) => {
      if (!evaluation.passed) {
        (state.failureReasons as string[]).push(evaluation.reason);
      }
    },
  });
}

export type SubprogramTranslationResult =
  | { ok: true; method: Omit<JavaMethodTranslation, "programId" | "attempts">; attempts: number }
  | { ok: false; attempts: number; failureReasons: string[]; lastAttemptBody?: string };

export async function runSubprogramTranslationLoop(
  subprogram: SubprogramInfo,
  knownSignatures: string,
  model: ModelClient,
  maxAttempts: number,
  skillRules = "",
  errorContext?: string,
): Promise<SubprogramTranslationResult> {
  const runLoop = buildSubprogramTranslationLoop(model, maxAttempts);
  const extendedSignatures = errorContext
    ? `${knownSignatures}\nPrevious translation caused compile error: ${errorContext}\nAvoid this mistake.`
    : knownSignatures;

  const { state, attempts, evaluation, stopped } = await runLoop({
    subprogram,
    knownSignatures: extendedSignatures,
    skillRules,
    result: null,
    failureReasons: [],
  });

  if (stopped === "PASSED" && state.result) {
    return { ok: true, method: state.result, attempts };
  }
  return {
    ok: false,
    attempts,
    failureReasons: evaluation.passed ? [] : [...state.failureReasons, evaluation.reason],
    ...(state.lastAttemptBody !== undefined ? { lastAttemptBody: state.lastAttemptBody } : {}),
  };
}

export function buildKnownSignatures(translatedMethods: JavaMethodTranslation[]): string {
  return translatedMethods.map(m => buildMethodSignature(m)).join("\n");
}
