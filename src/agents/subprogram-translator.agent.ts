import { buildJsonAgent } from "../core/agent/agent.js";
import type { ModelClient } from "../core/model/model-client.js";
import { javaMethodTranslationSchema, type SubprogramInfo, type JavaMethodTranslation } from "../schemas/assembly-state.schema.js";

const SYSTEM = `You are a COBOL subprogram translator. Translate one COBOL subprogram into one Java method.

Rules:
- Return JSON only. No markdown.
- LINKAGE SECTION parameters → Java method parameters (exact count must match).
- WORKING-STORAGE SECTION variables → Java local variables inside the method body.
- CALL "X" USING A B → leave as comment: // TODO call X(a, b)
- methodName must be camelCase, start with a lowercase letter.
- returnType is "void" unless the program clearly computes and returns a single scalar.
- params must use exactly these field names: name, type
- body must contain only the Java method body (no signature line, no outer braces).

Output JSON shape:
{
  "methodName": "camelCaseName",
  "params": [{"name": "paramName", "type": "JavaType"}],
  "returnType": "void",
  "body": "int x = 0;\n// ...",
  "notes": "brief translation notes"
}`;

type Input = {
  subprogram: SubprogramInfo;
  knownSignatures: string;   // signatures of already-translated callees
};

type RawOutput = Omit<JavaMethodTranslation, "programId" | "attempts">;

export function buildSubprogramTranslatorAgent(model: ModelClient) {
  return buildJsonAgent<Input, RawOutput>({
    model,
    systemPrompt: SYSTEM,
    buildUserPrompt: ({ subprogram, knownSignatures }) =>
      `Translate this subprogram to a Java method.\n` +
      `PROGRAM-ID: ${subprogram.programId}\n` +
      `LINKAGE params (${subprogram.linkageParams.length}): ${JSON.stringify(subprogram.linkageParams)}\n` +
      (knownSignatures ? `Known callee signatures:\n${knownSignatures}\n` : "") +
      `COBOL source:\n${subprogram.expandedSource}`,
    parse: (raw) =>
      javaMethodTranslationSchema
        .pick({ methodName: true, params: true, returnType: true, body: true, notes: true })
        .parse(raw),
  });
}
