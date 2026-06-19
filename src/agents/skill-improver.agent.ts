import { z } from "zod";
import { buildJsonAgent } from "../core/agent/agent.js";
import type { ModelClient } from "../core/model/model-client.js";

const SYSTEM = `You are a COBOL-to-Java translation skill engineer.

You receive:
1. A list of COBOL subprogram translations that failed evaluation (wrong structure, bad syntax patterns)
2. javac compile errors from the assembled Java class — these come from translations that PASSED evaluation but still produced invalid Java

Your job is to produce new translation rules that will prevent both types of failures in future rounds.

Each rule must be:
- Specific to a concrete pattern visible in the failure reason or compile error
- Actionable: "when you see X in COBOL, write Y in Java" (not just "avoid Z")
- Illustrated with a short COBOL snippet, the WRONG Java output, and the CORRECT Java output

Return JSON only. No markdown.`;

const skillRuleSchema = z.object({
  title: z.string().min(1),
  instruction: z.string().min(1),
  cobolExample: z.string().optional(),
  wrongJava: z.string().optional(),
  correctJava: z.string().optional(),
});

const outputSchema = z.object({
  rules: z.array(skillRuleSchema).max(12),
});

export type SkillRule = z.infer<typeof skillRuleSchema>;

type Input = {
  failureInfos: Array<{
    programId: string;
    cobolSnippet: string;
    failureReasons: string[];
    lastAttemptBody?: string | undefined;
  }>;
  compileErrors: string;   // javac stderr from last compile attempt (may be empty)
  existingRules: string;
  round: number;
};

export function buildSkillImproverAgent(model: ModelClient) {
  return buildJsonAgent<Input, z.infer<typeof outputSchema>>({
    model,
    systemPrompt: SYSTEM,
    buildUserPrompt: ({ failureInfos, compileErrors, existingRules, round }) => {
      const parts: string[] = [`Round ${round} feedback:`];

      if (failureInfos.length > 0) {
        const failureSummary = failureInfos.slice(0, 12).map(f =>
          `PROGRAM-ID: ${f.programId}\n` +
          `Failure reasons:\n${f.failureReasons.map(r => `  - ${r}`).join("\n")}\n` +
          (f.lastAttemptBody ? `Last generated body (first 300 chars):\n${f.lastAttemptBody.slice(0, 300)}\n` : "") +
          `COBOL snippet (first 400 chars):\n${f.cobolSnippet.slice(0, 400)}`
        ).join("\n---\n");
        parts.push(`\n## Evaluator failures (${failureInfos.length} total, showing first 12):\n${failureSummary}`);
      }

      if (compileErrors) {
        parts.push(`\n## javac compile errors (translations that passed evaluation but failed to compile):\n${compileErrors.slice(0, 2000)}`);
      }

      if (existingRules) {
        parts.push(`\n## Existing rules (do not duplicate):\n${existingRules}`);
      }

      parts.push(`\nAnalyze BOTH the evaluator failures AND the compile errors. For each distinct failure pattern, generate a rule. Return: {"rules": [{"title":"...","instruction":"...","cobolExample":"...","wrongJava":"...","correctJava":"..."}]}`);

      return parts.join("\n");
    },
    parse: outputSchema.parse,
  });
}

export function formatSkillRulesForPrompt(rules: SkillRule[]): string {
  if (rules.length === 0) return "";
  return rules.map((r, i) =>
    `Rule ${i + 1}: ${r.title}\n` +
    `  ${r.instruction}\n` +
    (r.cobolExample ? `  COBOL: ${r.cobolExample}\n` : "") +
    (r.wrongJava ? `  WRONG: ${r.wrongJava}\n` : "") +
    (r.correctJava ? `  CORRECT: ${r.correctJava}` : "")
  ).join("\n\n");
}
