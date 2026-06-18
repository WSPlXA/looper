import type { UnsupportedFeature } from "../../schemas/migration-plan.schema.js";

const detectors: ReadonlyArray<readonly [UnsupportedFeature, RegExp]> = [
  ["COPY", /^\s*COPY\b/im],
  ["EXEC_SQL", /\bEXEC\s+SQL\b/i],
  ["JCL", /^\/\/\S+\s+(?:JOB|EXEC|DD)\b/im],
  ["FILE_SECTION", /\bFILE\s+SECTION\s*\./i],
  ["INDEXED_FILE_IO", /\bORGANIZATION\s+IS\s+INDEXED\b/i],
  ["CICS", /\b(?:EXEC\s+)?CICS\b/i],
];

export function detectUnsupportedFeatures(cobolSource: string): UnsupportedFeature[] {
  const found: UnsupportedFeature[] = [];
  for (const [feature, pattern] of detectors) if (pattern.test(cobolSource)) found.push(feature);
  return found;
}
