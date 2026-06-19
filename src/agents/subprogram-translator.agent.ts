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
- NEVER write nested method definitions inside body — Java does not allow this. Use inline code or switch statements.
- NEVER write if (/* comment */) — an if condition must be a real boolean expression. If a condition is unresolvable, write if (false /* UNRESOLVED: original condition */).
- If a COBOL CALL target is an OS function (CBL_CREATE_FILE etc.), write /* UNRESOLVED: CALL X(args) */ and skip the return-code check.
- Every { you open in body MUST be closed with } before the end of body. Count carefully — the body must have exactly equal { and } characters (outside string/char literals and comments).

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
  knownSignatures: string;
  skillRules: string;  // accumulated rules from meta-loop's SkillImprover
};

type RawOutput = Omit<JavaMethodTranslation, "programId" | "attempts">;

export function buildSubprogramTranslatorAgent(model: ModelClient) {
  return buildJsonAgent<Input, RawOutput>({
    model,
    systemPrompt: SYSTEM,
    buildUserPrompt: ({ subprogram, knownSignatures, skillRules }) =>
      (skillRules ? `## Learned rules from previous rounds:\n${skillRules}\n\n` : "") +
      `Translate this subprogram to a Java method.\n` +
      `PROGRAM-ID: ${subprogram.programId}\n` +
      `LINKAGE params (${subprogram.linkageParams.length}): ${JSON.stringify(subprogram.linkageParams)}\n` +
      (knownSignatures ? `Known callee signatures:\n${knownSignatures}\n` : "") +
      `COBOL source:\n${subprogram.expandedSource}`,
    parse: (raw) =>
      javaMethodTranslationSchema
        .pick({ methodName: true, params: true, returnType: true, body: true, notes: true })
        .extend({
          returnType: javaMethodTranslationSchema.shape.returnType.default("void"),
          notes: javaMethodTranslationSchema.shape.notes.default(""),
        })
        .parse(raw),
  });
}
