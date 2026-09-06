import type { ReferenceItem } from "../../../shared/lib/kmas-reference";

export const REFERENCE_STORAGE_KEY = "toonstudio:kmas-reference-notes:v1";
export const MAX_REFERENCE_NOTES = 100;
export const MAX_REFERENCE_BACKUP_BYTES = 2 * 1024 * 1024;
export interface ReferenceNote { item: ReferenceItem; note: string; savedAt: string }
const ITEM_KEYS: (keyof ReferenceItem)[] = [
  "id", "title", "subtitle", "illustrator", "writer", "publisher", "platform", "genre", "age", "isbn", "outline",
];
export function isReferenceItem(value: unknown): value is ReferenceItem {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return ITEM_KEYS.every((key) => typeof candidate[key] === "string")
    && String(candidate.id).startsWith("kmas:") && String(candidate.id).length <= 3000
    && String(candidate.title).length > 0 && String(candidate.title).length <= 300
    && ITEM_KEYS.every((key) => String(candidate[key]).length <= (key === "outline" ? 6000 : 3000));
}
function storedMetadata(item: ReferenceItem): ReferenceItem {
  return Object.fromEntries(ITEM_KEYS.map((key) => [key, key === "outline" ? "" : item[key]])) as unknown as ReferenceItem;
}
export function parseReferenceNotes(raw: string | null): ReferenceNote[] {
  if (raw === null) return [];
  if (raw.length > MAX_REFERENCE_BACKUP_BYTES || new TextEncoder().encode(raw).byteLength > MAX_REFERENCE_BACKUP_BYTES) throw new Error("invalid notes");
  const data = JSON.parse(raw) as { version?: unknown; notes?: unknown };
  if (!data || data.version !== 1 || !Array.isArray(data.notes) || data.notes.length > MAX_REFERENCE_NOTES) {
    throw new Error("invalid notes");
  }
  const unique = new Map<string, ReferenceNote>();
  for (const value of data.notes) {
    const entry = value as Partial<ReferenceNote> | null;
    if (!entry || !isReferenceItem(entry.item) || typeof entry.note !== "string"
      || entry.note.length > 4000 || typeof entry.savedAt !== "string"
      || !Number.isFinite(Date.parse(entry.savedAt))) throw new Error("invalid note");
    const checked = { item: storedMetadata(entry.item), note: entry.note, savedAt: entry.savedAt };
    const previous = unique.get(entry.item.id);
    // Identical duplicates can be coalesced. Different notes sharing an ID are ambiguous:
    // reject the document rather than silently choosing which personal content to discard.
    if (previous && !sameReferenceNote(previous, checked)) throw new Error("conflicting reference notes");
    unique.set(entry.item.id, checked);
  }
  return [...unique.values()];
}
export function readReferenceNotes(): { notes: ReferenceNote[]; unavailable: boolean } {
  try {
    return { notes: parseReferenceNotes(localStorage.getItem(REFERENCE_STORAGE_KEY)), unavailable: false };
  } catch {
    return { notes: [], unavailable: true };
  }
}
export function writeReferenceNotes(notes: ReferenceNote[]): boolean {
  try {
    const validated = parseReferenceNotes(JSON.stringify({ version: 1, notes }));
    localStorage.setItem(REFERENCE_STORAGE_KEY, JSON.stringify({ version: 1, notes: validated }));
    return true;
  } catch {
    return false;
  }
}
export function referenceCitation(item: ReferenceItem): string {
  return [item.title, item.writer, item.illustrator, item.publisher, item.platform,
    item.isbn ? `ISBN ${item.isbn}` : "", "Source: KMAS / 한국만화영상진흥원 만화규장각",
    "https://www.kmas.or.kr"].filter(Boolean).join(" · ");
}
function markdownText(value: string): string {
  return value.replace(/[\\`*_{}[\]()#+.!<>|~-]/gu, "\\$&");
}
export function referenceNotesMarkdown(notes: ReferenceNote[]): string {
  return ["# ToonStudio — Reference notes", "", "Source: KMAS / 한국만화영상진흥원 만화규장각",
    "https://www.kmas.or.kr/guide/openapi", "", ...notes.flatMap(({ item, note, savedAt }) => [
      `## ${markdownText(item.title)}`, "", markdownText(referenceCitation(item)), "",
      `Saved: ${savedAt}`, "", ...note.split("\n").map((line) => `> ${markdownText(line)}`), "",
    ])].join("\n");
}


export type ReferenceMutation =
  | { kind: "bookmark"; item: ReferenceItem }
  | { kind: "save"; item: ReferenceItem; note: string; expected: ReferenceNote | null }
  | { kind: "remove"; id: string; expected: ReferenceNote }
  | { kind: "import"; notes: ReferenceNote[] };
export type ReferenceMutationFailure = "conflict" | "storage" | "limit" | "unsupported" | "invalid";
export type ReferenceMutationResult =
  | { ok: true; notes: ReferenceNote[]; added: number; skipped: number; changed: boolean }
  | { ok: false; reason: ReferenceMutationFailure; notes?: ReferenceNote[] };
export interface ReferenceStoreDependencies {
  storage?: Pick<Storage, "getItem" | "setItem">;
  exclusive?: <T>(operation: () => T) => Promise<T>;
  now?: () => string;
}

/** Compare the editor's base document, not its most recently received props. */
export function sameReferenceNote(left: ReferenceNote | null, right: ReferenceNote | null): boolean {
  if (left === null || right === null) return left === right;
  return left.note === right.note && left.savedAt === right.savedAt
    && JSON.stringify(storedMetadata(left.item)) === JSON.stringify(storedMetadata(right.item));
}

function validatedNotes(notes: ReferenceNote[]): ReferenceNote[] {
  return parseReferenceNotes(JSON.stringify({ version: 1, notes }));
}

/** Pure operation reducer. Imports never replace an existing user's note. */
export function reduceReferenceNotes(
  current: ReferenceNote[], mutation: ReferenceMutation, timestamp: string,
): ReferenceMutationResult {
  const fail = (reason: ReferenceMutationFailure): ReferenceMutationResult => ({ ok: false, reason, notes: current });
  const done = (notes: ReferenceNote[], added = 0, skipped = 0, changed = true): ReferenceMutationResult =>
    ({ ok: true, notes, added, skipped, changed });
  if (mutation.kind === "import") {
    let incoming: ReferenceNote[];
    try { incoming = validatedNotes(mutation.notes); } catch { return fail("invalid"); }
    const ids = new Set(current.map((entry) => entry.item.id));
    const additions = incoming.filter((entry) => !ids.has(entry.item.id));
    if (current.length + additions.length > MAX_REFERENCE_NOTES) return fail("limit");
    return done([...additions, ...current], additions.length, incoming.length - additions.length, additions.length > 0);
  }
  const id = mutation.kind === "remove" ? mutation.id : mutation.item.id;
  const existing = current.find((entry) => entry.item.id === id) ?? null;
  if (mutation.kind === "bookmark" && existing) return done(current, 0, 1, false);
  if (mutation.kind !== "bookmark" && !sameReferenceNote(existing, mutation.expected)) return fail("conflict");
  if (mutation.kind === "remove") return done(current.filter((entry) => entry.item.id !== id));
  if (!existing && current.length >= MAX_REFERENCE_NOTES) return fail("limit");
  let entry: ReferenceNote;
  try {
    [entry] = validatedNotes([{
      item: mutation.item, note: mutation.kind === "bookmark" ? "" : mutation.note,
      savedAt: existing?.savedAt ?? timestamp,
    }]);
  } catch { return fail("invalid"); }
  const notes = existing ? current.map((note) => note.item.id === id ? entry : note) : [entry, ...current];
  return done(notes, existing ? 0 : 1);
}

class ReferenceStoreError extends Error {
  constructor(readonly reason: ReferenceMutationFailure) { super(reason); }
}

/** A read/compare/write unit is synchronous inside a same-origin, cross-tab lock. */
async function browserExclusive<T>(operation: () => T): Promise<T> {
  if (typeof navigator === "undefined" || !navigator.locks?.request) throw new ReferenceStoreError("unsupported");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    return await navigator.locks.request(REFERENCE_STORAGE_KEY, { mode: "exclusive", signal: controller.signal }, operation);
  } finally { clearTimeout(timer); }
}

/**
 * All UI writes use this entry point. A failed write never reports saved data;
 * malformed existing data is not replaced. Browsers without Web Locks are
 * read/export-only, rather than pretending localStorage is transactional.
 */
export async function mutateReferenceNotes(
  mutation: ReferenceMutation, dependencies: ReferenceStoreDependencies = {},
): Promise<ReferenceMutationResult> {
  // Capture exactly what the user submitted before waiting for another tab's lock.
  // Callers must not be able to change the text, metadata or conflict baseline in flight.
  let submitted: ReferenceMutation;
  try { submitted = structuredClone(mutation); }
  catch { return { ok: false, reason: "invalid" }; }
  try {
    const storage = dependencies.storage ?? localStorage;
    const exclusive = dependencies.exclusive ?? browserExclusive;
    return await exclusive(() => {
      const current = parseReferenceNotes(storage.getItem(REFERENCE_STORAGE_KEY));
      const result = reduceReferenceNotes(current, submitted, (dependencies.now ?? (() => new Date().toISOString()))());
      if (!result.ok || !result.changed) return result;
      const notes = validatedNotes(result.notes);
      const serialized = JSON.stringify({ version: 1, notes });
      storage.setItem(REFERENCE_STORAGE_KEY, serialized);
      return { ...result, notes };
    });
  } catch (error) {
    return { ok: false, reason: error instanceof ReferenceStoreError ? error.reason : "storage" };
  }
}

export function referenceNotesBackup(notes: ReferenceNote[], exportedAt = new Date().toISOString()): string {
  // Compact JSON keeps the exported document within the same validated size bound.
  const backup = JSON.stringify({ format: "toonstudio-kmas-references", version: 1, exportedAt, notes: validatedNotes(notes) });
  if (new TextEncoder().encode(backup).byteLength > MAX_REFERENCE_BACKUP_BYTES) throw new Error("backup too large");
  return backup;
}

export function parseReferenceBackup(raw: string): ReferenceNote[] {
  if (raw.length > MAX_REFERENCE_BACKUP_BYTES || new TextEncoder().encode(raw).byteLength > MAX_REFERENCE_BACKUP_BYTES) throw new Error("backup too large");
  const document: unknown = JSON.parse(raw);
  if (!document || typeof document !== "object" || Array.isArray(document)
    || (document as { format?: unknown }).format !== "toonstudio-kmas-references") throw new Error("invalid backup");
  return parseReferenceNotes(raw);
}

export interface ReferenceImportPreview {
  additions: ReferenceNote[];
  duplicates: number;
  differentNotes: number;
  resultingCount: number;
  withinLimit: boolean;
}

/** Presentation-only preview; commit always re-reads storage under the exclusive lock. */
export function previewReferenceImport(current: ReferenceNote[], incoming: ReferenceNote[]): ReferenceImportPreview {
  const existing = new Map(validatedNotes(current).map((entry) => [entry.item.id, entry]));
  const additions: ReferenceNote[] = [];
  let duplicates = 0;
  let differentNotes = 0;
  for (const entry of validatedNotes(incoming)) {
    const saved = existing.get(entry.item.id);
    if (saved) {
      duplicates++;
      if (saved.note !== entry.note) differentNotes++;
    } else additions.push(entry);
  }
  const resultingCount = current.length + additions.length;
  return { additions, duplicates, differentNotes, resultingCount, withinLimit: resultingCount <= MAX_REFERENCE_NOTES };
}
