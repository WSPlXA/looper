export function summarizeCompilerError(stderr: string, maxChars = 4096): string {
  const normalized = stderr.replace(/\r\n/g, "\n").trim();
  return normalized.length <= maxChars ? normalized : `${normalized.slice(0, maxChars)}\n...[truncated]`;
}
