/** Local, literal discovery search. Never changes renderer IDs or saved document values. */
export function normalizeStudioToolSearch(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("ko-KR").trim();
}

export function studioToolSearchTerms(query: string): readonly string[] {
  return normalizeStudioToolSearch(query).split(/\s+/u).filter(Boolean);
}

/** All words must match; punctuation remains literal, never a regular expression. */
export function matchesStudioToolSearch(
  terms: readonly string[],
  fields: readonly (string | undefined)[],
): boolean {
  const haystack = normalizeStudioToolSearch(fields.filter(Boolean).join(" "));
  return terms.every((term) => haystack.includes(term));
}
