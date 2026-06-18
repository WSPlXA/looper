import { mkdir, appendFile } from "node:fs/promises";
import { dirname } from "node:path";

export function buildJsonlAppender(filePath: string): (value: unknown) => Promise<void> {
  let tail = Promise.resolve();
  return (value) => {
    tail = tail.then(async () => {
      await mkdir(dirname(filePath), { recursive: true });
      await appendFile(filePath, `${JSON.stringify(value)}\n`, "utf8");
    });
    return tail;
  };
}
