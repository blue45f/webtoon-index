/**
 * One folding rule for every search box in the studio.
 *
 * `docs/rewrite/ux-audit-v5.md` §2.8 measured four surfaces with four different
 * ideas of what "matches": shortcut help stripped all whitespace and did a
 * single substring test, Quick Access did NFKC + AND over tokens, the inspector
 * navigator did `toLocaleLowerCase("ko-KR")` + AND over tokens, and the
 * tutorial hub did a locale-aware substring. Typing the same words into two of
 * them gave different answers.
 *
 * This module is a leaf on purpose — it imports only the registry's term
 * folding, so any surface can depend on it without pulling in the catalog, the
 * tutorials or React.
 */

import { normalizeTerminologyTerm } from "@toonspectrum/studio-command-registry";

/**
 * Fold a term to its lookup key. Reuses the registry's folding so a query typed
 * as "paint-bucket", "Paint Bucket" or "PAINTBUCKET" lands on the same key as
 * the indexed alias.
 */
export function normalizeStudioSearchText(value: string): string {
  return normalizeTerminologyTerm(value);
}

/** Split on whitespace *before* folding, so "bucket fill" stays two tokens. */
export function tokenizeStudioSearchQuery(query: string): string[] {
  return query
    .normalize("NFKC")
    .split(/\s+/u)
    .map((token) => normalizeTerminologyTerm(token))
    .filter((token) => token.length > 0);
}

/**
 * AND over tokens, OR over fields: every word the user typed has to appear
 * somewhere in the row, but not necessarily in the same field. An empty query
 * matches everything, which is what a list filter wants.
 */
export function studioSearchTextMatches(
  query: string,
  fields: readonly (string | undefined | null)[],
): boolean {
  const tokens = tokenizeStudioSearchQuery(query);
  if (tokens.length === 0) return true;
  const haystack = fields
    .filter((field): field is string => typeof field === "string")
    .map((field) => normalizeStudioSearchText(field));
  return tokens.every((token) =>
    haystack.some((field) => field.includes(token)),
  );
}
