import { parseReferenceNotes } from "./reference-storage";

import type { ReferenceNote } from "./reference-storage";
import type { ReferenceItem } from "../../../shared/lib/kmas-reference";

/** Tab-scoped recovery only: never syncs drafts to an account or another tab. */
export const REFERENCE_DRAFT_STORAGE_KEY = "toonstudio:kmas-reference-drafts:v1";
export const MAX_REFERENCE_DRAFTS = 20;
export const MAX_REFERENCE_DRAFT_BYTES = 256 * 1024;
export interface ReferenceDraft {
  item: ReferenceItem;
  note: string;
  baseline: ReferenceNote | null;
  updatedAt: string;
}
type DraftStorage = Pick<Storage, "getItem" | "setItem">;
export type DraftWriteResult = { ok: true } | { ok: false; reason: "storage" | "limit" | "invalid" };
export interface ReferenceDraftState { drafts: ReferenceDraft[]; unavailable: boolean }

export function parseReferenceDrafts(raw: string | null): ReferenceDraft[] {
  if (raw === null) return [];
  if (raw.length > MAX_REFERENCE_DRAFT_BYTES || new TextEncoder().encode(raw).byteLength > MAX_REFERENCE_DRAFT_BYTES) {
    throw new Error("drafts too large");
  }
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid drafts");
  const data = value as { version?: unknown; drafts?: unknown };
  if (data.version !== 1 || !Array.isArray(data.drafts) || data.drafts.length > MAX_REFERENCE_DRAFTS) throw new Error("invalid drafts");
  const ids = new Set<string>();
  return data.drafts.map((rawDraft: unknown) => {
    if (!rawDraft || typeof rawDraft !== "object") throw new Error("invalid draft");
    const draft = rawDraft as Partial<ReferenceDraft>;
    const [checked] = parseReferenceNotes(JSON.stringify({ version: 1, notes: [{
      item: draft.item, note: draft.note, savedAt: draft.updatedAt,
    }] }));
    if (ids.has(checked.item.id)) throw new Error("duplicate draft");
    ids.add(checked.item.id);
    const baseline = draft.baseline === null ? null : parseReferenceNotes(JSON.stringify({ version: 1, notes: [draft.baseline] }))[0];
    if (baseline && baseline.item.id !== checked.item.id) throw new Error("draft identity mismatch");
    return { item: checked.item, note: checked.note, updatedAt: checked.savedAt, baseline };
  });
}

export function readReferenceDrafts(storage?: DraftStorage): ReferenceDraftState {
  try {
    return { drafts: parseReferenceDrafts((storage ?? sessionStorage).getItem(REFERENCE_DRAFT_STORAGE_KEY)), unavailable: false };
  } catch {
    return { drafts: [], unavailable: true };
  }
}

export function persistReferenceDraft(draft: ReferenceDraft, storage?: DraftStorage): DraftWriteResult {
  let checked: ReferenceDraft;
  try { [checked] = parseReferenceDrafts(JSON.stringify({ version: 1, drafts: [draft] })); }
  catch { return { ok: false, reason: "invalid" }; }
  try {
    const target = storage ?? sessionStorage;
    const current = parseReferenceDrafts(target.getItem(REFERENCE_DRAFT_STORAGE_KEY));
    const others = current.filter((entry) => entry.item.id !== checked.item.id);
    // Never evict another unsaved draft silently to make room.
    if (others.length >= MAX_REFERENCE_DRAFTS) return { ok: false, reason: "limit" };
    const raw = JSON.stringify({ version: 1, drafts: [checked, ...others] });
    if (new TextEncoder().encode(raw).byteLength > MAX_REFERENCE_DRAFT_BYTES) return { ok: false, reason: "limit" };
    target.setItem(REFERENCE_DRAFT_STORAGE_KEY, raw);
    return { ok: true };
  } catch { return { ok: false, reason: "storage" }; }
}

/** Retain newer text if a previously-started save finishes after another edit. */
export function clearReferenceDraft(id: string, expectedText?: string, storage?: DraftStorage): DraftWriteResult {
  try {
    const target = storage ?? sessionStorage;
    const current = parseReferenceDrafts(target.getItem(REFERENCE_DRAFT_STORAGE_KEY));
    const existing = current.find((draft) => draft.item.id === id);
    if (!existing || (expectedText !== undefined && existing.note !== expectedText)) return { ok: true };
    target.setItem(REFERENCE_DRAFT_STORAGE_KEY, JSON.stringify({ version: 1, drafts: current.filter((draft) => draft.item.id !== id) }));
    return { ok: true };
  } catch { return { ok: false, reason: "storage" }; }
}
