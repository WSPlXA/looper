import { describe, expect, it } from "vitest";
import { buildJsonAgent } from "../../src/core/agent/agent.js";
import type { ModelClient } from "../../src/core/model/model-client.js";
import { javaGenerationSchema } from "../../src/schemas/java-generation.schema.js";

describe("structured model output", () => {
  it("rejects invalid JSON", async () => {
    const model: ModelClient = { chat: async () => ({ content: "not json", toolCalls: [], raw: {} }) };
    const agent = buildJsonAgent({ model, systemPrompt: "json", buildUserPrompt: () => "input", parse: javaGenerationSchema.parse });
    await expect(agent(undefined)).rejects.toThrow("invalid JSON");
  });

  it("rejects structurally invalid JSON", () => {
    expect(() => javaGenerationSchema.parse({ className: "1Bad", javaCode: "" })).toThrow();
  });
});
