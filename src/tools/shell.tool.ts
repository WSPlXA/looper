import { execa } from "execa";
import type { Tool } from "../core/tool/tool.js";

export type ProcessResult = {
  success: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

export const shellTool: Tool<{
  executable: string;
  args: readonly string[];
  cwd?: string;
  timeoutMs?: number;
  maxBuffer?: number;
}, ProcessResult> = {
  name: "process",
  description: "Execute a program directly with an argv array; no shell is created.",
  async execute(input) {
    try {
      const result = await execa(input.executable, input.args, {
        ...(input.cwd ? { cwd: input.cwd } : {}),
        timeout: input.timeoutMs ?? 30_000,
        maxBuffer: input.maxBuffer ?? 2 * 1024 * 1024,
        reject: false,
        shell: false,
        windowsHide: true,
      });
      return {
        success: result.exitCode === 0,
        exitCode: result.exitCode ?? null,
        stdout: result.stdout,
        stderr: result.stderr,
        timedOut: result.timedOut,
      };
    } catch (error) {
      const value = error as { exitCode?: number; stdout?: string; stderr?: string; timedOut?: boolean; message?: string };
      return {
        success: false,
        exitCode: value.exitCode ?? null,
        stdout: value.stdout ?? "",
        stderr: value.stderr ?? value.message ?? String(error),
        timedOut: value.timedOut ?? false,
      };
    }
  },
};
