export type DeepSeekToolCall = {
  id: string;
  function: { name: string; arguments: string };
};

export type DeepSeekResponse = {
  choices?: Array<{
    finish_reason?: string;
    message?: { content?: string | null; tool_calls?: DeepSeekToolCall[] };
  }>;
  error?: { message?: string; type?: string; code?: string };
};
