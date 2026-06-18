import type { ModelClient } from "../model/model-client.js";

export type Agent<I, O> = (input: I) => Promise<O>;

export function buildJsonAgent<I, O>(options: {
  model: ModelClient;
  systemPrompt: string;
  buildUserPrompt: (input: I) => string;
  parse: (value: unknown) => O;
}): Agent<I, O> {
  return async (input) => {
    const response = await options.model.chat({
      messages: [
        { role: "system", content: options.systemPrompt },
        { role: "user", content: options.buildUserPrompt(input) },
      ],
      responseFormat: "json",
      temperature: 0.2,
    });
    let value: unknown;
    try {
      value = JSON.parse(response.content);
    } catch (cause) {
      throw new Error("Model returned invalid JSON", { cause });
    }
    return options.parse(value);
  };
}
