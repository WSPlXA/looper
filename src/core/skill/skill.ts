export type Skill<I, O, C = void> = (input: I, context: C) => Promise<O>;
