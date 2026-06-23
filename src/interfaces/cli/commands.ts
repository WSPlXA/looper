export type CliCommandName = "plan" | "architectures" | "approve" | "criteria" | "run" | "diff" | "score" | "status" | "pause" | "resume" | "exit" | "help" | "tree";
export type CliCommand = { name: CliCommandName; args: string[] };

const names = new Set<CliCommandName>([
  "plan", "architectures", "approve", "criteria", "run", "diff",
  "score", "status", "pause", "resume", "exit", "help", "tree"
]);

export function parseCliCommand(input: string): CliCommand {
  const [rawName, ...args] = input.trim().split(/\s+/);
  if (!rawName?.startsWith("/")) throw new Error("Commands must start with /");
  const name = rawName.slice(1) as CliCommandName;
  if (!names.has(name)) throw new Error(`Unknown command: ${rawName}`);
  return { name, args };
}

