import { z } from "zod";
import { buildJsonAgent } from "../core/agent/agent.js";
import type { ModelClient } from "../core/model/model-client.js";

const SYSTEM = `You are a COBOL-to-Java translation skill engineer.

You receive a list of failed COBOL-to-Java subprogram translations and their failure reasons.
Your job is to produce new translation rules that will prevent these failures in future translation attempts.

Each rule must be:
- Specific to a pattern visible in the COBOL or failure reason
- Actionable (what to do, not what to avoid)
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
  rules: z.array(skillRuleSchema).max(10),
});

export type SkillRule = z.infer<typeof skillRuleSchema>;

type Input = {
  failureInfos: Array<{
    programId: string;
    cobolSnippet: string;
    failureReasons: string[];
    lastAttemptBody?: string | undefined;  // accepts both Zod and local types
  }>;
  existingRules: string;
  round: number;
};

export function buildSkillImproverAgent(model: ModelClient) {
  return buildJsonAgent<Input, z.infer<typeof outputSchema>>({
    model,
    systemPrompt: SYSTEM,
    buildUserPrompt: ({ failureInfos, existingRules, round }) => {
      const failureSummary = failureInfos.slice(0, 15).map(f =>
        `PROGRAM-ID: ${f.programId}\n` +
        `Failure reasons:\n${f.failureReasons.map(r => `  - ${r}`).join("\n")}\n` +
        (f.lastAttemptBody ? `Last generated body (first 300 chars):\n${f.lastAttemptBody.slice(0, 300)}\n` : "") +
        `COBOL snippet (first 400 chars):\n${f.cobolSnippet.slice(0, 400)}`
      ).join("\n---\n");

      return (
        `Round ${round} translation failures (${failureInfos.length} total, showing first 15):\n\n` +
        failureSummary +
        (existingRules ? `\n\nExisting rules (do not duplicate):\n${existingRules}` : "") +
        `\n\nGenerate new rules to prevent these failures. Return: {"rules": [{"title":"...","instruction":"...","cobolExample":"...","wrongJava":"...","correctJava":"..."}]}`
      );
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
