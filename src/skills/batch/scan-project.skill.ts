import { readdir, stat } from "node:fs/promises";
import { join, basename, extname } from "node:path";

const COBOL_EXTENSIONS = new Set([".cob", ".cbl"]);
const MAX_FILE_SIZE_BYTES = 1_048_576; // 1 MiB

export type CobolFileEntry = {
  sourceFile: string;
  className: string;
};

export function cobolNameToClassName(filename: string): string {
  const base = basename(filename, extname(filename));
  return base
    .split(/[-_\s]+/)
    .filter(part => part.length > 0)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join("");
}

export async function scanProjectDirectory(
  sourceDir: string,
  maxFileSizeBytes = MAX_FILE_SIZE_BYTES,
): Promise<{ files: CobolFileEntry[]; skipped: string[] }> {
  const entries = await readdir(sourceDir, { withFileTypes: true });
  const files: CobolFileEntry[] = [];
  const skipped: string[] = [];
  const seenClassNames = new Set<string>();

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!COBOL_EXTENSIONS.has(extname(entry.name).toLowerCase())) continue;

    const fullPath = join(sourceDir, entry.name);
    const info = await stat(fullPath);
    if (info.size > maxFileSizeBytes) {
      skipped.push(fullPath);
      continue;
    }

    const className = cobolNameToClassName(entry.name);
    if (!/^[A-Za-z_$][A-Za-z\d_$]*$/.test(className)) {
      skipped.push(fullPath);
      continue;
    }
    if (seenClassNames.has(className)) {
      skipped.push(fullPath);
      continue;
    }

    seenClassNames.add(className);
    files.push({ sourceFile: fullPath, className });
  }

  return { files, skipped };
}
