export type ToolCall = {
  id: string;
  name: string;
  arguments: string;
};

export type ChatResponse = {
  content: string;
  toolCalls: ToolCall[];
  finishReason?: string;
  raw: unknown;
};
