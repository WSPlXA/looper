import { buildJsonAgent } from "../core/agent/agent.js";
import type { ModelClient } from "../core/model/model-client.js";
import { writeFileActionSchema } from "../core/actions/agent-action.types.js";
import type { JavaMethodTranslation } from "../schemas/assembly-state.schema.js";

const SYSTEM = `You are a Java program assembler. Assemble translated COBOL subprogram methods into a single compilable Java class.

Rules:
- Return JSON only. No markdown.
- Output exactly one WRITE_FILE action: {"type":"WRITE_FILE","path":"<ClassName>.java","content":"..."}
- The class must contain ALL provided methods.
- Replace "// TODO call X(a, b)" placeholders with actual method calls using the correct method name from the provided signature list.
- Add instance fields for any shared state if methods reference common variables.
- Add public static void main(String[] args) that calls the entry point method.
- Use only java.* and javax.* imports. No external libraries.
- The class must compile with plain javac.`;

type Input = {
  className: string;
  entryProgramId: string;
  methods: Array<{ programId: string; signature: string; body: string }>;
  failedTranslations: string[];
};

export function buildProgramAssemblerAgent(model: ModelClient) {
  return buildJsonAgent<Input, ReturnType<typeof writeFileActionSchema.parse>>({
    model,
    systemPrompt: SYSTEM,
    buildUserPrompt: ({ className, entryProgramId, methods, failedTranslations }) => {
      const methodDefs = methods.map(m => `// ${m.programId}\n${m.signature} {\n${m.body}\n}`).join("\n\n");
      return (
        `Assemble these ${methods.length} methods into class ${className}.\n` +
        `Entry point program: ${entryProgramId}\n` +
        (failedTranslations.length
          ? `Note: ${failedTranslations.length} subprograms failed translation and are omitted: ${failedTranslations.join(", ")}\n`
          : "") +
        `\nMethods:\n${methodDefs}\n\n` +
        `Return: {"type":"WRITE_FILE","path":"${className}.java","content":"public class ${className} { ... }"}`
      );
    },
    parse: writeFileActionSchema.parse,
  });
}

export function buildMethodSignature(m: JavaMethodTranslation): string {
  const params = m.params.map(p => `${p.type} ${p.name}`).join(", ");
  return `public ${m.returnType} ${m.methodName}(${params})`;
}
