import { matchesStudioToolSearch, normalizeStudioToolSearch, studioToolSearchTerms } from "../studio-tool-search";

import { STUDIO_BRUSH_DISCOVERY } from "./studio-brush-discovery";

export interface SearchableStudioShortcutBrush {
  readonly id: string;
  readonly name: string;
  readonly hint?: string;
  readonly categoryLabel?: string;
  readonly searchAliases?: readonly string[];
}

/**
 * Only ambiguous former product names have an explicit redirect. Discovery aliases
 * also contain broad purposes such as "선화" and "잉크워시": those must NEVER
 * suppress other matching tools. Keep this map separate from ordinary search tags.
 */
const FORMER_SHORTCUT_NAME_TARGETS: ReadonlyMap<string, string> = new Map([
  ["스크린톤", "screentone"],
]);

export function searchStudioShortcutBrushes<T extends SearchableStudioShortcutBrush>(
  tools: readonly T[],
  query: string,
): T[] {
  const normalized = normalizeStudioToolSearch(query);
  const terms = studioToolSearchTerms(query);
  if (!terms.length) return [...tools];
  const formerNameTarget = FORMER_SHORTCUT_NAME_TARGETS.get(normalized);
  if (formerNameTarget) {
    const exact = tools.filter((tool) => tool.id === formerNameTarget);
    if (exact.length) return exact;
  }
  return tools.filter((tool) => matchesStudioToolSearch(terms, [
    tool.name,
    tool.id,
    tool.hint,
    tool.categoryLabel,
    ...(tool.searchAliases ?? []),
    ...(STUDIO_BRUSH_DISCOVERY[tool.id]?.aliases ?? []),
  ]));
}
