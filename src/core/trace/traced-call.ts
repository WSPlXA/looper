export async function runTracedCall<T>(
  trace: (type: string, data?: unknown) => Promise<void>,
  type: "model.call" | "tool.call",
  attributes: Record<string, unknown>,
  call: () => Promise<T>,
): Promise<T> {
  const started = performance.now();
  try {
    const result = await call();
    await trace(type, { ...attributes, success: true, durationMs: performance.now() - started });
    return result;
  } catch (error) {
    await trace(type, {
      ...attributes,
      success: false,
      durationMs: performance.now() - started,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
