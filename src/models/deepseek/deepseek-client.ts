import { AppError } from "../../core/errors/app-error.js";
import type { ChatRequest, ModelClient } from "../../core/model/model-client.js";
import type { ChatResponse } from "../../core/model/chat-response.js";
import type { DeepSeekResponse } from "./deepseek-types.js";

type Fetch = typeof globalThis.fetch;

export class DeepSeekClient implements ModelClient {
  constructor(private readonly options: {
    apiKey: string;
    baseUrl: string;
    model: string;
    timeoutMs?: number;
    fetch?: Fetch;
  }) {}

  async chat(input: ChatRequest): Promise<ChatResponse> {
    const controller = new AbortController();
    const forwardAbort = () => controller.abort(input.signal?.reason);
    input.signal?.addEventListener("abort", forwardAbort, { once: true });
    const timer = setTimeout(() => controller.abort(new Error("model request timed out")), this.options.timeoutMs ?? 120_000);
    try {
      const body: Record<string, unknown> = {
        model: input.model ?? this.options.model,
        messages: input.messages.map(({ toolCallId, ...message }) => toolCallId ? { ...message, tool_call_id: toolCallId } : message),
        temperature: input.temperature ?? 0.2,
        stream: false,
      };
      if (input.responseFormat === "json") body.response_format = { type: "json_object" };
      if (input.tools?.length) {
        body.tools = input.tools.map((tool) => ({ type: "function", function: tool }));
      }
      const response = await (this.options.fetch ?? fetch)(`${this.options.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.options.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const rawText = await response.text();
      let json: DeepSeekResponse;
      try {
        json = JSON.parse(rawText) as DeepSeekResponse;
      } catch (cause) {
        throw new AppError("DeepSeek returned non-JSON response", "MODEL_INVALID_RESPONSE", { status: response.status }, { cause });
      }
      if (!response.ok) {
        throw new AppError(json.error?.message ?? `DeepSeek API failed with HTTP ${response.status}`, "MODEL_HTTP_ERROR", { status: response.status, error: json.error });
      }
      const choice = json.choices?.[0];
      const message = choice?.message;
      if (!message) throw new AppError("DeepSeek response has no choice message", "MODEL_INVALID_RESPONSE");
      return {
        content: message.content ?? "",
        toolCalls: (message.tool_calls ?? []).map((call) => ({ id: call.id, name: call.function.name, arguments: call.function.arguments })),
        ...(choice.finish_reason ? { finishReason: choice.finish_reason } : {}),
        raw: json,
      };
    } catch (cause) {
      if (cause instanceof AppError) throw cause;
      if (controller.signal.aborted) throw new AppError("DeepSeek request aborted or timed out", "MODEL_TIMEOUT", undefined, { cause });
      throw new AppError("DeepSeek request failed", "MODEL_NETWORK_ERROR", undefined, { cause });
    } finally {
      clearTimeout(timer);
      input.signal?.removeEventListener("abort", forwardAbort);
    }
  }
}
