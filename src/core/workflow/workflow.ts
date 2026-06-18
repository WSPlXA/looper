export type Workflow<I, O> = (input: I) => Promise<O>;
