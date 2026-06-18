/**
 * Run `fn` over all `items` with at most `limit` concurrent executions.
 * Returns results in the same order as `items`.
 */
export async function runConcurrent<T, R>(
  items: readonly T[],
  fn: (item: T, index: number) => Promise<R>,
  limit: number,
): Promise<R[]> {
  const results: R[] = new Array(items.length) as R[];
  const queue = items.map((item, i) => ({ item, i }));

  async function worker(): Promise<void> {
    for (;;) {
      const entry = queue.shift();
      if (!entry) return;
      results[entry.i] = await fn(entry.item, entry.i);
    }
  }

  const slots = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: slots }, () => worker()));
  return results;
}
