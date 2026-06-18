import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";

export type DependencyGraph = Map<string, string[]>;

function extractCopyTargets(source: string): string[] {
  const targets: string[] = [];
  const pattern = /^\s*COPY\s+([A-Za-z0-9_$#@-]+)/gim;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    if (match[1]) targets.push(match[1].toUpperCase());
  }
  return [...new Set(targets)];
}

function fileKey(filePath: string): string {
  return basename(filePath, extname(filePath)).toUpperCase();
}

export async function buildDependencyGraph(filePaths: readonly string[]): Promise<{
  order: string[];
  hasCycle: boolean;
  graph: DependencyGraph;
}> {
  const keyToPath = new Map<string, string>();
  for (const f of filePaths) keyToPath.set(fileKey(f), f);

  // adjacency: file → files it depends on (must be processed before it)
  const graph: DependencyGraph = new Map();
  for (const f of filePaths) {
    const source = await readFile(f, "utf-8");
    const resolved = extractCopyTargets(source)
      .map(t => keyToPath.get(t))
      .filter((p): p is string => p !== undefined);
    graph.set(f, resolved);
  }

  // Kahn's topological sort: dependencies come first
  const inDegree = new Map<string, number>(filePaths.map(f => [f, 0]));
  const dependents = new Map<string, string[]>(filePaths.map(f => [f, []]));

  for (const [f, deps] of graph) {
    for (const dep of deps) {
      inDegree.set(f, (inDegree.get(f) ?? 0) + 1);
      dependents.get(dep)!.push(f);
    }
  }

  const queue: string[] = filePaths.filter(f => (inDegree.get(f) ?? 0) === 0).slice();
  const order: string[] = [];

  while (queue.length > 0) {
    const f = queue.shift()!;
    order.push(f);
    for (const dep of dependents.get(f) ?? []) {
      const next = (inDegree.get(dep) ?? 0) - 1;
      inDegree.set(dep, next);
      if (next === 0) queue.push(dep);
    }
  }

  const hasCycle = order.length < filePaths.length;
  if (hasCycle) {
    const seen = new Set(order);
    for (const f of filePaths) {
      if (!seen.has(f)) order.push(f);
    }
  }

  return { order, hasCycle, graph };
}
