type ClassToken =
  | string
  | number
  | false
  | null
  | undefined
  | ClassToken[]
  | Record<string, boolean | null | undefined>;

function appendClassToken(token: ClassToken, out: string[]) {
  if (!token) return;
  if (typeof token === "string" || typeof token === "number") {
    out.push(String(token));
    return;
  }
  if (Array.isArray(token)) {
    for (const item of token) appendClassToken(item, out);
    return;
  }
  for (const [className, enabled] of Object.entries(token)) {
    if (enabled) out.push(className);
  }
}

export function cx(...tokens: ClassToken[]): string {
  const out: string[] = [];
  for (const token of tokens) appendClassToken(token, out);
  return out.join(" ");
}
