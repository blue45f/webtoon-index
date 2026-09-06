/** KMAS reference metadata contract. No API keys, remote images or catalog ranking fields. */
export const REFERENCE_PAGE_SIZE = 24;
export const REFERENCE_FIELDS = {
  title: "title",
  illustrator: "pictrWritrNm",
  writer: "sntncWritrNm",
  publisher: "plscmpnIdNm",
  platform: "pltfomCdNm",
  isbn: "isbn",
} as const;
export type ReferenceField = keyof typeof REFERENCE_FIELDS;
export interface ReferenceQuery { field: ReferenceField; q: string; page: number }
export interface ReferenceItem {
  id: string;
  title: string;
  subtitle: string;
  illustrator: string;
  writer: string;
  publisher: string;
  platform: string;
  genre: string;
  age: string;
  isbn: string;
  outline: string;
}
export interface ReferenceResult {
  source: "kmas";
  query: ReferenceQuery;
  items: ReferenceItem[];
  total: number | null;
  hasNext: boolean;
  fetchedAt: string;
  cached: boolean;
}
export type ReferenceErrorCode =
  | "INVALID_QUERY" | "KMAS_NOT_CONFIGURED" | "KMAS_RATE_LIMITED"
  | "KMAS_TIMEOUT" | "KMAS_UNAVAILABLE";
export class ReferenceError extends Error {
  constructor(readonly code: ReferenceErrorCode, readonly status: number) {
    super(code);
    this.name = "ReferenceError";
  }
}
export function isReferenceField(value: unknown): value is ReferenceField {
  return typeof value === "string" && Object.hasOwn(REFERENCE_FIELDS, value);
}
export function parseReferenceQuery(raw: Record<string, unknown>): ReferenceQuery {
  if (Object.keys(raw).some((key) => !["field", "q", "page"].includes(key))) {
    throw new ReferenceError("INVALID_QUERY", 400);
  }
  const field = raw.field ?? "title";
  if (!isReferenceField(field) || typeof raw.q !== "string") {
    throw new ReferenceError("INVALID_QUERY", 400);
  }
  let q = raw.q.trim().normalize("NFC");
  if (!q || q.length > 120 || [...q].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) {
    throw new ReferenceError("INVALID_QUERY", 400);
  }
  if (field === "isbn") {
    q = q.replace(/[\s-]/gu, "").toUpperCase();
    if (!/^(?:\d{13}|\d{9}[\dX])$/u.test(q)) throw new ReferenceError("INVALID_QUERY", 400);
  }
  if (raw.page !== undefined && typeof raw.page !== "string" && typeof raw.page !== "number") {
    throw new ReferenceError("INVALID_QUERY", 400);
  }
  const pageText = String(raw.page ?? "1");
  if (!/^\d{1,4}$/u.test(pageText)) throw new ReferenceError("INVALID_QUERY", 400);
  const page = Number(pageText);
  if (page < 1 || page > 1000) throw new ReferenceError("INVALID_QUERY", 400);
  return { field, q, page };
}
export function referenceSearchParams(query: ReferenceQuery): URLSearchParams {
  return new URLSearchParams({ field: query.field, q: query.q, page: String(query.page) });
}
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}
function text(value: unknown, limit = 300): string {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}
export function normalizeReferenceItem(value: unknown): ReferenceItem | null {
  const item = record(value);
  if (!item) return null;
  const title = text(item.title) || text(item.prdctNm);
  if (!title) return null;
  const isbn = text(item.isbn, 40);
  const illustrator = text(item.pictrWritrNm);
  const writer = text(item.sntncWritrNm);
  const publisher = text(item.plscmpnIdNm);
  const master = typeof item.mastrId === "number" ? String(item.mastrId) : text(item.mastrId, 80);
  const identity = master ? ["id", master] : isbn ? ["isbn", isbn] :
    ["metadata", title, text(item.subtitl), text(item.edtn), illustrator, writer, publisher, text(item.pltfomCdNm)];
  return {
    id: `kmas:${JSON.stringify(identity)}`,
    title, subtitle: text(item.subtitl), illustrator, writer, publisher,
    platform: text(item.pltfomCdNm), genre: text(item.mainGenreCdNm),
    age: text(item.ageGradCdNm), isbn, outline: text(item.outline, 6000),
  };
}
export function normalizeReferenceResponse(
  value: unknown, query: ReferenceQuery, fetchedAt: string,
): ReferenceResult {
  const root = record(value);
  const result = record(root?.result);
  if (!root || !result || result.resultState !== "success") {
    throw new ReferenceError("KMAS_UNAVAILABLE", 502);
  }
  const candidates = [root.itemlist, root.itemList, result.itemlist, result.itemList];
  const rawItems = candidates.find(Array.isArray);
  const countValue = result.totalCount;
  const count = typeof countValue === "number" ||
    (typeof countValue === "string" && /^\d+$/u.test(countValue)) ? Number(countValue) : NaN;
  const total = Number.isSafeInteger(count) && count >= 0 ? count : null;
  // A successful empty result may omit the array, but a nonempty result may not.
  if (!rawItems && total !== 0) throw new ReferenceError("KMAS_UNAVAILABLE", 502);
  const list = (rawItems ?? []) as unknown[];
  if (list.length > 100) throw new ReferenceError("KMAS_UNAVAILABLE", 502);
  const unique = new Map<string, ReferenceItem>();
  for (const entry of list) {
    const item = normalizeReferenceItem(entry);
    if (item) unique.set(item.id, item);
  }
  if (list.length > 0 && unique.size === 0) throw new ReferenceError("KMAS_UNAVAILABLE", 502);
  return {
    source: "kmas", query, items: [...unique.values()], total,
    hasNext: list.length > 0 && (total === null ? list.length >= REFERENCE_PAGE_SIZE : query.page * REFERENCE_PAGE_SIZE < total),
    fetchedAt, cached: false,
  };
}
