export function keepInlineText(value: string): string {
  return value.replace(/\s+/g, "\u00a0");
}
