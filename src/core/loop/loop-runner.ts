import type { EvaluationResult, Evaluator } from "../evaluator/evaluator.js";

export type LoopResult<S> = {
  state: S;
  attempts: number;
  evaluation: EvaluationResult;
  stopped: "PASSED" | "POLICY" | "MAX_ATTEMPTS";
};

export function buildLoopRunner<S>(options: {
  maxAttempts: number;
  step: (state: S, attemptNo: number) => Promise<S>;
  evaluator: Evaluator<S>;
  shouldStop?: (state: S, evaluation: EvaluationResult) => boolean;
  onAttempt?: (state: S, evaluation: EvaluationResult, attemptNo: number) => Promise<void>;
}): (initialState: S) => Promise<LoopResult<S>> {
  if (!Number.isInteger(options.maxAttempts) || options.maxAttempts < 1) {
    throw new RangeError("maxAttempts must be a positive integer");
  }
  return async (initialState) => {
    let state = initialState;
    let evaluation: EvaluationResult = { passed: false, reason: "not evaluated" };
    for (let attemptNo = 1; attemptNo <= options.maxAttempts; attemptNo++) {
      state = await options.step(state, attemptNo);
      evaluation = await options.evaluator.evaluate(state);
      await options.onAttempt?.(state, evaluation, attemptNo);
      const policyStop = options.shouldStop?.(state, evaluation);
      if (policyStop ?? evaluation.passed) {
        return { state, attempts: attemptNo, evaluation, stopped: evaluation.passed ? "PASSED" : "POLICY" };
      }
    }
    return { state, attempts: options.maxAttempts, evaluation, stopped: "MAX_ATTEMPTS" };
  };
}
