import type { SubprogramInfo, LinkageParam } from "../../schemas/assembly-state.schema.js";

function extractProgramId(source: string): string | null {
  return /PROGRAM-ID\.\s+([A-Za-z0-9_$#@-]+)/i.exec(source)?.[1] ?? null;
}

function extractLinkageParams(source: string): LinkageParam[] {
  const params: LinkageParam[] = [];
  const section = /LINKAGE\s+SECTION\s*\.([\s\S]*?)(?=(?:PROCEDURE|END)\s+DIVISION|$)/i.exec(source)?.[1];
  if (!section) return params;
  // Match 01-level items: "01 NAME  PIC ..." or "01 NAME  BINARY-..."
  const pattern = /^\s{0,10}01\s+([A-Za-z0-9_$#@-]+)\s+([\s\S]+?)(?=\n\s{0,10}(?:01|77|88|\*>)|$)/gim;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(section)) !== null) {
    if (m[1] && m[2]) params.push({ name: m[1].trim(), pic: m[2].replace(/\s+/g, " ").trim() });
  }
  return params;
}

function extractCallees(source: string): string[] {
  const targets: string[] = [];
  // Only string-literal CALL targets; CALL via PROGRAM-POINTER is not traceable
  const pattern = /\bCALL\s+"([^"]+)"/gi;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(source)) !== null) {
    if (m[1]) targets.push(m[1]);
  }
  return [...new Set(targets)];
}

export function extractSubprogramInfo(
  sourceFile: string,
  expandedSource: string,
): SubprogramInfo | null {
  const programId = extractProgramId(expandedSource);
  if (!programId) return null;
  return {
    programId,
    sourceFile,
    expandedSource,
    linkageParams: extractLinkageParams(expandedSource),
    callees: extractCallees(expandedSource),
  };
}

export function buildCallOrder(subprograms: SubprogramInfo[]): {
  order: string[];
  hasCycle: boolean;
} {
  const ids = subprograms.map(s => s.programId);
  const idSet = new Set(ids);
  const deps = new Map<string, string[]>(
    subprograms.map(s => [s.programId, s.callees.filter(c => idSet.has(c))]),
  );

  // Kahn's topological sort: callees before callers
  const inDegree = new Map<string, number>(ids.map(id => [id, 0]));
  const reverseDeps = new Map<string, string[]>(ids.map(id => [id, []]));
  for (const [id, callees] of deps) {
    for (const callee of callees) {
      inDegree.set(id, (inDegree.get(id) ?? 0) + 1);
      reverseDeps.get(callee)!.push(id);
    }
  }

  const queue = ids.filter(id => (inDegree.get(id) ?? 0) === 0);
  const order: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    order.push(id);
    for (const caller of reverseDeps.get(id) ?? []) {
      const next = (inDegree.get(caller) ?? 0) - 1;
      inDegree.set(caller, next);
      if (next === 0) queue.push(caller);
    }
  }

  const hasCycle = order.length < ids.length;
  if (hasCycle) {
    const seen = new Set(order);
    for (const id of ids) if (!seen.has(id)) order.push(id);
  }
  return { order, hasCycle };
}
