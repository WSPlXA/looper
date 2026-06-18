import { buildJsonAgent } from "../core/agent/agent.js";
import type { ModelClient } from "../core/model/model-client.js";
import { writeFileActionSchema } from "../core/actions/agent-action.types.js";

const SYSTEM = `You repair a Java class that failed to compile.

Rules:
- Return JSON only. No markdown.
- Output exactly one WRITE_FILE action: {"type":"WRITE_FILE","path":"<ClassName>.java","content":"..."}
- Fix only the errors indicated by the compiler stderr.
- Do not restructure unrelated code.
- Do not add external library imports.
- Preserve all method bodies.
- The class must compile with plain javac after your fix.`;

type Input = {
  className: string;
  currentSource: string;
  compilerStderr: string;
  attemptNo: number;
};

export function buildAssemblyRepairAgent(model: ModelClient) {
  return buildJsonAgent<Input, ReturnType<typeof writeFileActionSchema.parse>>({
    model,
    systemPrompt: SYSTEM,
    buildUserPrompt: ({ className, currentSource, compilerStderr, attemptNo }) =>
      `Repair attempt ${attemptNo} for class ${className}.\n\n` +
      `Compiler errors:\n${compilerStderr}\n\n` +
      `Current source:\n${currentSource}\n\n` +
      `Return: {"type":"WRITE_FILE","path":"${className}.java","content":"...fixed source..."}`,
    parse: writeFileActionSchema.parse,
  });
}
