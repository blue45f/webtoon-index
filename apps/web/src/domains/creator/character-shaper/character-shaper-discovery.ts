/** Catalog discovery only. Never writes model, pose, recipe, or history state. */
export type CharacterShelfCollection = "all" | "favorites" | "selected";
export type CharacterDiscoveryAvailability = "available" | "partial" | "unavailable";

export interface CharacterDiscoveryEntry {
  readonly id: string;
  readonly label: string;
  readonly labelEn?: string;
  readonly hint: string;
  readonly keywords: readonly string[];
  readonly tags: readonly string[];
}

export interface CharacterDiscoveryOptions {
  readonly query: string;
  readonly tag: string | null;
  readonly collection: CharacterShelfCollection;
  readonly favorites: ReadonlySet<string>;
  readonly selected: ReadonlySet<string>;
  readonly onlyAvailable: boolean;
  readonly availability: ReadonlyMap<string, CharacterDiscoveryAvailability>;
  readonly tagLabels: Readonly<Record<string, string>>;
}

export function normalizeCharacterSearch(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
}

/** Modern Hangul choseong; NFKC also maps keyboard compatibility jamo to this alphabet. */
function initials(text: string): string {
  return Array.from(text, (character) => {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0xac00 || code > 0xd7a3) return character;
    return String.fromCodePoint(0x1100 + Math.floor((code - 0xac00) / 588));
  }).join("");
}

/** AND across query words, OR across fields. Preserves the curated catalog order and identities. */
export function discoverCharacterEntries<T extends CharacterDiscoveryEntry>(
  entries: readonly T[],
  options: CharacterDiscoveryOptions,
): readonly T[] {
  // Bound work from unusually long pasted queries; this is not fuzzy/AI semantic search.
  const tokens = normalizeCharacterSearch(options.query.slice(0, 512)).split(" ").filter(Boolean);
  return entries.filter((entry) => {
    if (options.tag !== null && !entry.tags.includes(options.tag)) return false;
    if (options.collection === "favorites" && !options.favorites.has(entry.id)) return false;
    if (options.collection === "selected" && !options.selected.has(entry.id)) return false;
    // Unknown capability is not "fully supported". Partial support remains visibly distinct.
    if (options.onlyAvailable && options.availability.get(entry.id) !== "available") return false;
    if (tokens.length === 0) return true;
    const fields = [entry.label, entry.labelEn ?? "", entry.hint, ...entry.keywords,
      ...entry.tags.flatMap((tag) => [tag, options.tagLabels[tag] ?? ""])].map(normalizeCharacterSearch);
    return tokens.every((token) => /^[\u1100-\u1112]+$/u.test(token)
      ? fields.some((field) => initials(field).includes(token))
      : fields.some((field) => field.includes(token)));
  });
}

export function countCharacterAvailability(
  ids: readonly string[],
  availability: ReadonlyMap<string, CharacterDiscoveryAvailability>,
): Readonly<Record<CharacterDiscoveryAvailability, number>> {
  const counts = { available: 0, partial: 0, unavailable: 0 };
  for (const id of ids) {
    const status = availability.get(id);
    counts[status === "available" || status === "partial" ? status : "unavailable"] += 1;
  }
  return counts;
}
