/**
 * Count net `{` minus `}` in Java source, correctly ignoring braces inside:
 * - Line comments  (// ...)
 * - Block comments (/* ... *‌/)
 * - String literals ("...")
 * - Char literals  ('.')
 *
 * Returns 0 for balanced code, >0 if more open braces, <0 if more close braces.
 */
export function countNetBraces(source: string): number {
  let depth = 0;
  let i = 0;
  const n = source.length;

  while (i < n) {
    const ch = source[i];
    const next = i + 1 < n ? source[i + 1] : "";

    // Line comment
    if (ch === "/" && next === "/") {
      i += 2;
      while (i < n && source[i] !== "\n") i++;
      continue;
    }

    // Block comment
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < n - 1 && !(source[i] === "*" && source[i + 1] === "/")) i++;
      i += 2;
      continue;
    }

    // String literal
    if (ch === '"') {
      i++;
      while (i < n) {
        if (source[i] === "\\" ) { i += 2; continue; }
        if (source[i] === '"') { i++; break; }
        i++;
      }
      continue;
    }

    // Char literal
    if (ch === "'") {
      i++;
      while (i < n) {
        if (source[i] === "\\") { i += 2; continue; }
        if (source[i] === "'") { i++; break; }
        i++;
      }
      continue;
    }

    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    i++;
  }

  return depth;
}
