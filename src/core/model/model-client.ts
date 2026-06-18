import type { ChatMessage } from "./chat-message.js";
import type { ChatResponse } from "./chat-response.js";

export type ChatTool = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type ChatRequest = {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  responseFormat?: "text" | "json";
  tools?: ChatTool[];
  signal?: AbortSignal;
};

export interface ModelClient {
  chat(input: ChatRequest): Promise<ChatResponse>;
}
