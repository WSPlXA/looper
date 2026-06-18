import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";

const MAX_DEPTH = 10;

async function buildCopybookIndex(copybookPaths: readonly string[]): Promise<Map<string, string>> {
  const index = new Map<string, string>();
  for (const path of copybookPaths) {
    const key = basename(path, extname(path)).toUpperCase();
    index.set(key, await readFile(path, "utf-8"));
  }
  return index;
}

function inlineExpand(source: string, index: Map<string, string>, depth: number): string {
  if (depth >= MAX_DEPTH) return source;
  return source.replace(
    /^\s*COPY\s+([A-Za-z0-9_$#@-]+)(?:\s+IN\s+\S+)?\s*\./gim,
    (_, name: string) => {
      const content = index.get(name.toUpperCase());
      return content ? inlineExpand(content, index, depth + 1) : `*> COPY ${name} -- NOT FOUND`;
    },
  );
}

export async function expandCopybooks(
  source: string,
  copybookPaths: readonly string[],
): Promise<{ expanded: string; unresolvedNames: string[] }> {
  const index = await buildCopybookIndex(copybookPaths);
  const expanded = inlineExpand(source, index, 0);
  const unresolvedNames = (expanded.match(/\*> COPY (\S+) -- NOT FOUND/g) ?? [])
    .map(line => line.replace("*> COPY ", "").replace(" -- NOT FOUND", "").trim());
  return { expanded, unresolvedNames };
}
