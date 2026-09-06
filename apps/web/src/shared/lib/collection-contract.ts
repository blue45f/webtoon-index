export const MAX_COLLECTION_ID_LENGTH = 120;
export const MAX_COLLECTION_NAME_LENGTH = 80;
export const MAX_COLLECTION_EMOJI_LENGTH = 16;

export const COLLECTION_CLIENT_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function normalizeCollectionName(value: unknown): string {
  return String(value ?? "").trim().slice(0, MAX_COLLECTION_NAME_LENGTH);
}

export function normalizeCollectionEmoji(value: unknown): string {
  return String(value ?? "").trim().slice(0, MAX_COLLECTION_EMOJI_LENGTH) || "📚";
}

export function normalizeCollectionClientId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim().toLowerCase();
  return COLLECTION_CLIENT_ID_RE.test(id) ? id : null;
}
