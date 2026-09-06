import assert from "node:assert/strict";

import { test } from "vitest";

import {
  clearReferenceDraft, MAX_REFERENCE_DRAFTS, MAX_REFERENCE_DRAFT_BYTES,
  parseReferenceDrafts, persistReferenceDraft, readReferenceDrafts, REFERENCE_DRAFT_STORAGE_KEY,
} from "../../../domains/catalog/references/reference-drafts";
import { previewReferenceImport, reduceReferenceNotes } from "../../../domains/catalog/references/reference-storage";
import { normalizeReferenceItem } from "../kmas-reference";

import type { ReferenceDraft } from "../../../domains/catalog/references/reference-drafts";
import type { ReferenceNote } from "../../../domains/catalog/references/reference-storage";

const now = "2026-09-06T00:00:00.000Z";
const item = normalizeReferenceItem({ mastrId: 1, title: "검증 자료", outline: "원문", imageDownloadUrl: "https://example.invalid/cover" })!;
const saved: ReferenceNote = { item, note: "저장된 메모", savedAt: now };
const draft: ReferenceDraft = { item, note: "미저장 초안", baseline: saved, updatedAt: now };
function memoryStore(initial: string | null = null) {
  let raw = initial;
  let writes = 0;
  return { getItem: (key: string) => { assert.equal(key, REFERENCE_DRAFT_STORAGE_KEY); return raw; },
    setItem: (key: string, value: string) => { assert.equal(key, REFERENCE_DRAFT_STORAGE_KEY); raw = value; writes++; },
    raw: () => raw, writes: () => writes };
}
const otherNote = (id: number): ReferenceNote => ({ ...saved, item: { ...item, id: `kmas:${id}` } });

test("draft survives reopening the tab's storage reader", () => {
  const storage = memoryStore();
  assert.equal(persistReferenceDraft(draft, storage).ok, true);
  const recovered = readReferenceDrafts(storage);
  assert.equal(recovered.unavailable, false);
  assert.equal(recovered.drafts[0].note, draft.note);
  assert.equal(recovered.drafts[0].baseline?.note, saved.note);
});

test("drafts and baselines exclude remote synopsis and extra fields", () => {
  const storage = memoryStore();
  persistReferenceDraft({ ...draft, item: { ...item, hidden: "must not persist" } as typeof item }, storage);
  const raw = storage.raw()!;
  assert.equal(raw.includes("원문"), false);
  assert.equal(raw.includes("must not persist"), false);
  assert.equal(readReferenceDrafts(storage).drafts[0].item.outline, "");
});

test("new unsaved work retains a null baseline instead of silently adopting live data", () => {
  const storage = memoryStore(); persistReferenceDraft({ ...draft, baseline: null }, storage);
  assert.equal(readReferenceDrafts(storage).drafts[0].baseline, null);
});

test("recovering an old baseline cannot overwrite a newer stored note", () => {
  const storage = memoryStore(); persistReferenceDraft(draft, storage);
  const recovered = readReferenceDrafts(storage).drafts[0];
  const result = reduceReferenceNotes([{ ...saved, note: "別のタブ" }], {
    kind: "save", item, note: recovered.note, expected: recovered.baseline,
  }, now);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "conflict");
});

test("clearing a submitted draft preserves text typed later", () => {
  const storage = memoryStore(); persistReferenceDraft({ ...draft, note: "newer text" }, storage);
  assert.equal(clearReferenceDraft(item.id, draft.note, storage).ok, true);
  assert.equal(readReferenceDrafts(storage).drafts[0].note, "newer text");
});

test("clearing the submitted text removes only that draft", () => {
  const storage = memoryStore(); persistReferenceDraft(draft, storage);
  persistReferenceDraft({ ...draft, item: otherNote(2).item, baseline: null }, storage);
  assert.equal(clearReferenceDraft(item.id, draft.note, storage).ok, true);
  assert.deepEqual(readReferenceDrafts(storage).drafts.map((entry) => entry.item.id), ["kmas:2"]);
});

test("missing draft cleanup does not write an empty document", () => {
  const storage = memoryStore(); clearReferenceDraft(item.id, undefined, storage);
  assert.equal(storage.writes(), 0);
});

test("a corrupt recovery store is not replaced on write or clear", () => {
  const storage = memoryStore("{corrupt");
  assert.equal(readReferenceDrafts(storage).unavailable, true);
  assert.equal(persistReferenceDraft(draft, storage).ok, false);
  assert.equal(clearReferenceDraft(item.id, undefined, storage).ok, false);
  assert.equal(storage.raw(), "{corrupt"); assert.equal(storage.writes(), 0);
});

test("quota and access failures return a failure instead of claiming recovery", () => {
  const storage = { getItem: () => null, setItem: () => { throw new Error("QuotaExceededError"); } };
  assert.equal(persistReferenceDraft(draft, storage).ok, false);
  assert.equal(readReferenceDrafts({ getItem: () => { throw new Error("SecurityError"); }, setItem: () => {} }).unavailable, true);
});

test("draft limit never evicts another unsaved entry", () => {
  const storage = memoryStore();
  for (let id = 0; id < MAX_REFERENCE_DRAFTS; id++) {
    assert.equal(persistReferenceDraft({ ...draft, item: otherNote(id).item, baseline: null }, storage).ok, true);
  }
  const before = storage.raw();
  assert.deepEqual(persistReferenceDraft({ ...draft, item: otherNote(100).item, baseline: null }, storage), { ok: false, reason: "limit" });
  assert.equal(storage.raw(), before);
  assert.equal(persistReferenceDraft({ ...draft, item: otherNote(0).item, note: "updated", baseline: null }, storage).ok, true);
});

test("malformed draft, wrong version, duplicate id and baseline mismatch are rejected", () => {
  for (const value of [
    { version: 9, drafts: [] }, { version: 1, drafts: [null] }, { version: 1, drafts: [draft, draft] },
    { version: 1, drafts: [{ ...draft, baseline: otherNote(2) }] },
    { version: 1, drafts: [{ ...draft, updatedAt: "not-a-date" }] },
    { version: 1, drafts: [{ ...draft, note: "x".repeat(4001) }] },
    { version: 1, drafts: [{ ...draft, baseline: undefined }] },
  ]) assert.throws(() => parseReferenceDrafts(JSON.stringify(value)));
});

test("UTF-8 draft byte limit rejects large multibyte data", () => {
  assert.throws(() => parseReferenceDrafts("가".repeat(Math.ceil(MAX_REFERENCE_DRAFT_BYTES / 3) + 1)));
});

test("draft recovery is isolated between two storage instances", () => {
  const left = memoryStore(); const right = memoryStore(); persistReferenceDraft(draft, left);
  assert.equal(readReferenceDrafts(right).drafts.length, 0);
});

test("import preview separates additions, duplicates and different existing text without mutation", () => {
  const current = [saved]; const incoming = [{ ...saved, note: "백업의 다른 메모" }, otherNote(2)];
  const before = JSON.stringify({ current, incoming });
  const preview = previewReferenceImport(current, incoming);
  assert.equal(preview.additions.length, 1); assert.equal(preview.duplicates, 1); assert.equal(preview.differentNotes, 1);
  assert.equal(preview.resultingCount, 2); assert.equal(preview.withinLimit, true);
  assert.equal(JSON.stringify({ current, incoming }), before);
});

test("duplicate-only preview makes no additions and does not change the user's note", () => {
  const preview = previewReferenceImport([saved], [{ ...saved, note: "different" }]);
  assert.equal(preview.additions.length, 0); assert.equal(preview.resultingCount, 1);
});

test("preview reports capacity overflow before confirmation", () => {
  const current = Array.from({ length: 100 }, (_, i) => otherNote(i));
  const preview = previewReferenceImport(current, [otherNote(101)]);
  assert.equal(preview.withinLimit, false); assert.equal(preview.resultingCount, 101);
});

test("a note added in another tab after preview is retained by the final import", () => {
  const incoming = [otherNote(2)]; const preview = previewReferenceImport([], incoming);
  assert.equal(preview.additions.length, 1);
  const newer = { ...otherNote(2), note: "live note" };
  const result = reduceReferenceNotes([newer], { kind: "import", notes: incoming }, now);
  assert.equal(result.ok, true);
  if (result.ok) { assert.equal(result.notes[0].note, "live note"); assert.equal(result.changed, false); }
});

test("capacity changed after preview cannot cause a partial import", () => {
  const incoming = [otherNote(200), otherNote(201)];
  const current = Array.from({ length: 99 }, (_, i) => otherNote(i));
  const result = reduceReferenceNotes(current, { kind: "import", notes: incoming }, now);
  assert.equal(result.ok, false);
  if (!result.ok) { assert.equal(result.reason, "limit"); assert.equal(result.notes?.length, 99); }
});
