import { buildJsonlAppender } from "../storage/jsonl-store.js";

export type TraceEvent = {
  timestamp: string;
  runId: string;
  type: string;
  data?: unknown;
};

export function buildTraceLogger(filePath: string, runId: string) {
  const append = buildJsonlAppender(filePath);
  return (type: string, data?: unknown) => append({ timestamp: new Date().toISOString(), runId, type, data } satisfies TraceEvent);
}
