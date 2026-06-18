import type { Workflow } from "./workflow.js";

export function buildWorkflowRunner<I, O>(workflow: Workflow<I, O>, onError?: (error: unknown) => Promise<void>) {
  return async (input: I): Promise<O> => {
    try {
      return await workflow(input);
    } catch (error) {
      await onError?.(error);
      throw error;
    }
  };
}
