export function applyUnifiedDiff(original: string, diff: string): string {
  const source = original.replace(/\r\n/g, "\n").split("\n");
  const lines = diff.replace(/\r\n/g, "\n").split("\n");
  const output: string[] = [];
  let sourceIndex = 0;
  let index = lines.findIndex((line) => line.startsWith("@@"));
  if (index < 0) throw new Error("PATCH_FILE unifiedDiff has no hunk");
  while (index < lines.length) {
    const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(lines[index]!);
    if (!header) throw new Error("Invalid unified diff hunk header");
    const oldStart = Number(header[1]) - 1;
    if (oldStart < sourceIndex) throw new Error("Overlapping unified diff hunks");
    output.push(...source.slice(sourceIndex, oldStart));
    sourceIndex = oldStart;
    index++;
    while (index < lines.length && !lines[index]!.startsWith("@@")) {
      const line = lines[index]!;
      if (line.startsWith(" ")) {
        if (source[sourceIndex] !== line.slice(1)) throw new Error("Unified diff context does not match source");
        output.push(source[sourceIndex++]!);
      } else if (line.startsWith("-")) {
        if (source[sourceIndex] !== line.slice(1)) throw new Error("Unified diff removal does not match source");
        sourceIndex++;
      } else if (line.startsWith("+")) {
        output.push(line.slice(1));
      } else if (line !== "\\ No newline at end of file" && line !== "") {
        throw new Error("Invalid unified diff line");
      }
      index++;
    }
  }
  output.push(...source.slice(sourceIndex));
  return output.join("\n");
}
