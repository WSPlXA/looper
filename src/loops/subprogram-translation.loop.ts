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
const ASSIGN_COMMENT_RE = /\b\w+\s*=\s*\/\*/;
// access/static modifiers on declarations inside method body — all illegal in Java method scope
// matches: "public static final int X", "private String x", "static boolean x", etc.
const PUBLIC_IN_BODY_RE = /^ {8,}(?:(?:public|private|protected)\s+(?:static\s+)?|static\s+)(?:final\s+)?(?:int|long|double|float|boolean|byte|short|char|String|\w+\[)\b/m;
// English prose lines: indented, starts uppercase, no Java operators, 25+ chars → leaked reasoning
const PROSE_IN_BODY_RE = /^ {8,}[A-Z][a-zA-Z][^;{}()=\[\]<>@\n]{25,}\s*$/m;

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
        if (ASSIGN_COMMENT_RE.test(r.body)) {
          return { passed: false, reason: "body contains 'x = /* ... */;' — assign a real value or 0, not a block comment: e.g. 'x = 0; /* UNRESOLVED: expr */'" };
        }
        if (PUBLIC_IN_BODY_RE.test(r.body)) {
          return { passed: false, reason: "body contains 'public/private/protected/static' modifier on a local declaration — Java has no static local variables and no access-modified locals; remove the modifier: 'int x = 0;' not 'static int x = 0;'" };
        }
        if (PROSE_IN_BODY_RE.test(r.body)) {
          return { passed: false, reason: "body contains English prose (leaked LLM reasoning text) — every non-blank, non-comment line must be valid Java; wrap reasoning in // comments or remove it entirely" };
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
  | { ok: true; method: Omit<JavaMethodTranslation, "programId" | "attempts">; attempts: number; quality: SubprogramTranslationQuality }
  | { ok: false; attempts: number; failureReasons: string[]; lastAttemptBody?: string };

export type SubprogramTranslationQuality = {
  evaluatorPassed: boolean;
  evaluatorReason: string;
  coverage: number;
  coverageEvidence: string[];
};

function clampCoverage(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function measureTranslationCoverage(
  subprogram: SubprogramInfo,
  method: Omit<JavaMethodTranslation, "programId" | "attempts">,
): Pick<SubprogramTranslationQuality, "coverage" | "coverageEvidence"> {
  const components: Array<{ name: string; score: number; evidence: string }> = [];
  const body = method.body.trim();
  components.push({
    name: "executable body",
    score: body.length > 0 ? 1 : 0,
    evidence: `executable body non-empty: ${body.length > 0}`,
  });

  const expectedParams = subprogram.linkageParams.length;
  const paramScore = expectedParams === 0
    ? (method.params.length === 0 ? 1 : 0)
    : Math.min(method.params.length, expectedParams) / expectedParams;
  components.push({
    name: "linkage params",
    score: method.params.length === expectedParams ? 1 : clampCoverage(paramScore),
    evidence: `linkage params matched: ${method.params.length}/${expectedParams}`,
  });

  const lowerBody = body.toLowerCase();
  const mentionedCallees = subprogram.callees.filter(callee => lowerBody.includes(callee.toLowerCase()));
  const callCoverage = subprogram.callees.length === 0
    ? 1
    : mentionedCallees.length / subprogram.callees.length;
  components.push({
    name: "CALL targets",
    score: clampCoverage(callCoverage),
    evidence: subprogram.callees.length === 0
      ? "CALL target coverage: no callees"
      : `CALL target coverage: ${mentionedCallees.length}/${subprogram.callees.length} (${mentionedCallees.join(", ") || "none"})`,
  });

  const coverage = clampCoverage(components.reduce((sum, component) => sum + component.score, 0) / components.length);
  return {
    coverage,
    coverageEvidence: [
      `coverage components: ${components.map(component => `${component.name}=${component.score.toFixed(2)}`).join(", ")}`,
      ...components.map(component => component.evidence),
    ],
  };
}

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
    const coverage = measureTranslationCoverage(subprogram, state.result);
    return {
      ok: true,
      method: state.result,
      attempts,
      quality: {
        evaluatorPassed: evaluation.passed,
        evaluatorReason: evaluation.reason,
        ...coverage,
      },
    };
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
