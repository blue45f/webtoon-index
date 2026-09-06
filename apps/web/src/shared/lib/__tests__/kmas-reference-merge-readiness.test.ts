import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { test } from "vitest";

import { appRoutes } from "../../../app/routes/route-manifest";
import {
  mutateReferenceNotes, parseReferenceBackup, parseReferenceNotes, previewReferenceImport,
  REFERENCE_STORAGE_KEY,
} from "../../../domains/catalog/references/reference-storage";
import { normalizeReferenceItem } from "../kmas-reference";

import type { ReferenceMutation, ReferenceNote } from "../../../domains/catalog/references/reference-storage";

const item = normalizeReferenceItem({ mastrId: "merge-fixture", title: "검증용 자료" })!;
const note: ReferenceNote = { item, note: "원본 메모", savedAt: "2026-09-06T00:00:00.000Z" };
const document = (notes: ReferenceNote[]) => JSON.stringify({ version: 1, notes });

for (const variant of [
  { ...note, note: "서로 다른 메모" },
  { ...note, item: { ...item, title: "서로 다른 제목" } },
  { ...note, savedAt: "2026-09-07T00:00:00.000Z" },
]) {
  test(`rejects ambiguous duplicate note ${JSON.stringify(variant)}`, () => {
    assert.throws(() => parseReferenceNotes(document([note, variant])), /conflicting/u);
  });
}

test("identical duplicate notes are safely coalesced", () => {
  assert.deepEqual(parseReferenceNotes(document([note, structuredClone(note)])), [note]);
});

test("conflicting backup rows are rejected before an import preview", () => {
  const raw = JSON.stringify({ format: "toonstudio-kmas-references", version: 1,
    notes: [note, { ...note, note: "보존해야 할 다른 메모" }] });
  assert.throws(() => previewReferenceImport([], parseReferenceBackup(raw)), /conflicting/u);
});

test("ambiguous current storage is preserved without any writes", async () => {
  const raw = document([note, { ...note, note: "보존해야 할 다른 메모" }]);
  let writes = 0;
  const result = await mutateReferenceNotes({ kind: "bookmark", item: { ...item, id: "kmas:other" } }, {
    storage: { getItem: () => raw, setItem: () => { writes++; } },
    exclusive: async (operation) => operation(),
  });
  assert.equal(result.ok, false);
  assert.equal(writes, 0);
});

test("a queued save uses the submitted text and metadata, not later mutations", async () => {
  const mutation: ReferenceMutation = { kind: "save", item: { ...item }, note: "확인한 메모", expected: null };
  let stored = "";
  const result = await mutateReferenceNotes(mutation, {
    storage: { getItem: () => null, setItem: (key, value) => { assert.equal(key, REFERENCE_STORAGE_KEY); stored = value; } },
    exclusive: async (operation) => {
      mutation.note = "클릭 후 변경된 메모";
      mutation.item.title = "클릭 후 변경된 제목";
      return operation();
    },
    now: () => note.savedAt,
  });
  assert.equal(result.ok, true);
  const persisted = parseReferenceNotes(stored)[0];
  assert.equal(persisted.note, "확인한 메모");
  assert.equal(persisted.item.title, item.title);
});

test("a queued save cannot silently adopt a newer conflict baseline", async () => {
  const live = { ...note, note: "다른 탭의 최신 메모" };
  const mutation: ReferenceMutation = { kind: "save", item, note: "오래된 초안", expected: structuredClone(note) };
  let writes = 0;
  const result = await mutateReferenceNotes(mutation, {
    storage: { getItem: () => document([live]), setItem: () => { writes++; } },
    exclusive: async (operation) => {
      mutation.expected!.note = live.note;
      return operation();
    },
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "conflict");
  assert.equal(writes, 0);
});


test("reference discovery has one labeled route in the public manifest", () => {
  assert.deepEqual(appRoutes.filter((route) => route.path === "/references"), [
    { path: "/references", label: "route.references" },
  ]);
});

test("reference discovery remains reachable from the public sitemap", () => {
  const source = readFileSync(resolve(process.cwd(), "apps/web/src/domains/legal/SitemapPage.tsx"), "utf8");
  assert.equal(source.split('["/references",').length - 1, 1);
});
