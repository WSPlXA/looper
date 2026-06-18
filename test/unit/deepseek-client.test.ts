import { describe, expect, it, vi } from "vitest";
import { DeepSeekClient } from "../../src/models/deepseek/deepseek-client.js";

describe("DeepSeekClient", () => {
  it("normalizes JSON responses and configurable model", async () => {
    const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({ model: "provider-v4-pro", response_format: { type: "json_object" }, stream: false });
      return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: "{\"ok\":true}" } }] }), { status: 200 });
    });
    const client = new DeepSeekClient({ apiKey: "secret", baseUrl: "https://example.test/", model: "provider-v4-pro", fetch });
    await expect(client.chat({ messages: [{ role: "user", content: "x" }], responseFormat: "json" })).resolves.toMatchObject({ content: "{\"ok\":true}", finishReason: "stop" });
  });

  it("surfaces API error details", async () => {
    const client = new DeepSeekClient({
      apiKey: "secret",
      baseUrl: "https://example.test",
      model: "x",
      fetch: async () => new Response(JSON.stringify({ error: { message: "rate limited" } }), { status: 429 }),
    });
    await expect(client.chat({ messages: [{ role: "user", content: "x" }] })).rejects.toMatchObject({ code: "MODEL_HTTP_ERROR", message: "rate limited" });
  });
});
