import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Tool } from "../core/tool/tool.js";

export const readTextFileTool: Tool<{ path: string }, string> = {
  name: "read-text-file",
  description: "Read a UTF-8 text file.",
  execute: ({ path }) => readFile(path, "utf8"),
};

export const writeTextFileTool: Tool<{ path: string; content: string }, void> = {
  name: "write-text-file",
  description: "Atomically write a UTF-8 text file after creating its parent directory.",
  async execute({ path, content }) {
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${process.pid}.tmp`;
    await writeFile(temporary, content, "utf8");
    const { rename } = await import("node:fs/promises");
    await rename(temporary, path);
  },
};
