import type { Tool } from "./tool.js";

export function buildToolRegistry(tools: readonly Tool<unknown, unknown>[]) {
  const byName = new Map<string, Tool<unknown, unknown>>();
  for (const tool of tools) {
    if (byName.has(tool.name)) throw new Error(`Duplicate tool name: ${tool.name}`);
    byName.set(tool.name, tool);
  }
  return {
    get(name: string) {
      const tool = byName.get(name);
      if (!tool) throw new Error(`Unknown tool: ${name}`);
      return tool;
    },
    names: () => [...byName.keys()],
  };
}
