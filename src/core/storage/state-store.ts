export interface StateStore<S> {
  save(state: S): Promise<void>;
}
