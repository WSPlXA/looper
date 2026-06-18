export interface Tool<I, O> {
  readonly name: string;
  readonly description: string;
  execute(input: I): Promise<O>;
}
