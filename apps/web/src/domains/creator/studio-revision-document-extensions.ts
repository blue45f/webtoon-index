/**
 * Internal comparison-only carrier for document keys that this Studio build does not know yet.
 * Values have already crossed the bounded/private revision projection before comparison; this
 * module deliberately keeps them only as comparator inputs and never copies them into a change
 * descriptor.
 */
export const STUDIO_REVISION_DOCUMENT_EXTENSIONS_FIELD =
  "__toonspectrumRevisionDocumentExtensions" as const;

export type StudioRevisionDocumentExtensionEntry = readonly [key: string, value: unknown];

/**
 * Document fields consumed by either the current editor, its registered extensions, or the legacy
 * single-page adapter. They already have a semantic comparison path and must not be counted again
 * as unknown extensions.
 */
const KNOWN_STUDIO_WORK_DOCUMENT_FIELDS = new Set([
  "aiProvenance",
  "bg",
  "bgGrad",
  "characterBible",
  "comments",
  "currentPageId",
  "elements",
  "format",
  "fx",
  "height",
  "master",
  "pageMeta",
  "pagesList",
  "panelGutter",
  "publicationAnalytics",
  "publishPack",
  "releaseSchedule",
  "webtoonTheme",
  "width",
  "writerRoom",
]);

/**
 * Retains future document extensions without projecting them into the public diff result. Object
 * keys are represented as tuple values (rather than properties) to avoid prototype-key hazards.
 * The upstream revision projection owns graph/key/string limits and privacy redaction.
 */
export function collectStudioRevisionDocumentExtensions(
  doc: Readonly<Record<string, unknown>>
): readonly StudioRevisionDocumentExtensionEntry[] {
  return Object.keys(doc)
    .filter((key) => !KNOWN_STUDIO_WORK_DOCUMENT_FIELDS.has(key) && doc[key] !== undefined)
    .sort()
    .map((key) => [key, doc[key]] as const);
}

/** Canonicalizes the internal carrier defensively without cloning or exposing extension values. */
export function canonicalStudioRevisionDocumentExtensions(
  value: unknown
): readonly StudioRevisionDocumentExtensionEntry[] {
  if (!Array.isArray(value)) return [];
  const byKey = new Map<string, unknown>();
  for (const candidate of value) {
    if (
      !Array.isArray(candidate)
      || candidate.length !== 2
      || typeof candidate[0] !== "string"
      || candidate[1] === undefined
    ) {
      continue;
    }
    byKey.set(candidate[0], candidate[1]);
  }
  return [...byKey]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, extensionValue]) => [key, extensionValue] as const);
}
