export type EvaluationResult = { passed: boolean; reason: string };

export interface Evaluator<S> {
  readonly name: string;
  evaluate(state: S): Promise<EvaluationResult>;
}
