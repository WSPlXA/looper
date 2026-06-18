import { isAbsolute, relative, resolve } from "node:path";
import type { AgentAction, FileAction } from "./agent-action.types.js";

export function validateFileAction(action: AgentAction, rootDir: string, expectedFileName: string): FileAction & { resolvedPath: string } {
  if (action.type !== "WRITE_FILE" && action.type !== "PATCH_FILE") throw new Error(`File action required; received ${action.type}`);
  if (isAbsolute(action.path)) throw new Error("Agent action path must be relative");
  const resolvedPath = resolve(rootDir, action.path);
  const rel = relative(rootDir, resolvedPath);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("Agent action path escapes outputDir");
  if (rel.replace(/\\/g, "/") !== expectedFileName) throw new Error(`Agent action path must be exactly ${expectedFileName}`);
  return { ...action, resolvedPath };
}
