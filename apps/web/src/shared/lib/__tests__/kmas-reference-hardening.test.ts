import assert from "node:assert/strict";

import { test } from "vitest";

import { createKmasReferenceSearch } from "../../../../../../apps/api/src/server/kmas-reference";
import { fetchReferenceResult, validateReferenceResult } from "../../../domains/catalog/references/reference-api";
import {
  MAX_REFERENCE_BACKUP_BYTES, mutateReferenceNotes, parseReferenceBackup, parseReferenceNotes,
  reduceReferenceNotes, referenceNotesBackup, REFERENCE_STORAGE_KEY, sameReferenceNote,
} from "../../../domains/catalog/references/reference-storage";
import { normalizeReferenceItem, normalizeReferenceResponse, ReferenceError } from "../kmas-reference";

import type { ReferenceNote, ReferenceStoreDependencies } from "../../../domains/catalog/references/reference-storage";

const now = "2026-09-06T00:00:00.000Z";
const query = { field: "title" as const, q: "검증용", page: 1 };
const rawItem = { mastrId: "fixture-1", title: "검증용 작품", outline: "원문 줄거리", imageDownloadUrl: "https://example.invalid/cover" };
const item = normalizeReferenceItem(rawItem)!;
const other = normalizeReferenceItem({ ...rawItem, mastrId: "fixture-2", title: "두 번째 검증용 작품" })!;
const saved = (text = "기존 메모", value = item): ReferenceNote => ({ item: { ...value, outline: "" }, note: text, savedAt: now });
const envelope = () => ({ result: { resultState: "success", totalCount: "1" }, itemlist: [rawItem] });
const response = () => new Response(JSON.stringify(envelope()), { headers: { "Content-Type": "application/json" } });
const failure = (code: string) => (error: unknown) => error instanceof ReferenceError && error.code === code;
function memoryStore(notes: ReferenceNote[] = []) {
  let raw = JSON.stringify({ version: 1, notes });
  let writes = 0;
  let queue = Promise.resolve();
  const dependencies: ReferenceStoreDependencies = {
    storage: { getItem: () => raw, setItem: (_key, value) => { raw = value; writes++; } },
    exclusive: <T>(operation: () => T): Promise<T> => {
      const result = queue.then(operation);
      queue = result.then(() => undefined, () => undefined);
      return result;
    },
    now: () => now,
  };
  return { dependencies, read: () => parseReferenceNotes(raw), raw: () => raw, writes: () => writes,
    replace: (value: string) => { raw = value; } };
}

test("bookmarking an already-saved item cannot blank its personal note", () => {
  const current = [saved()];
  const result = reduceReferenceNotes(current, { kind: "bookmark", item }, now);
  assert.equal(result.ok, true);
  if (result.ok) { assert.equal(result.changed, false); assert.equal(result.notes[0].note, "기존 메모"); }
});

test("editing merges into freshly loaded storage rather than overwriting another note", async () => {
  const store = memoryStore([saved(), saved("다른 탭의 메모", other)]);
  const result = await mutateReferenceNotes({ kind: "save", item, note: "나의 편집", expected: saved() }, store.dependencies);
  assert.equal(result.ok, true);
  assert.deepEqual(store.read().map((entry) => entry.note), ["나의 편집", "다른 탭의 메모"]);
});

test("concurrent additions in the exclusive operation preserve both notes", async () => {
  const store = memoryStore();
  const results = await Promise.all([
    mutateReferenceNotes({ kind: "bookmark", item }, store.dependencies),
    mutateReferenceNotes({ kind: "bookmark", item: other }, store.dependencies),
  ]);
  assert.equal(results.every((result) => result.ok), true);
  assert.equal(store.read().length, 2);
});

test("two edits from the same baseline produce one success and one conflict", async () => {
  const store = memoryStore([saved()]);
  const results = await Promise.all(["탭 A", "탭 B"].map((note) =>
    mutateReferenceNotes({ kind: "save", item, note, expected: saved() }, store.dependencies)));
  assert.equal(results.filter((result) => result.ok).length, 1);
  assert.equal(results.filter((result) => !result.ok && result.reason === "conflict").length, 1);
  assert.equal(store.read()[0].note, "탭 A");
});

test("a stale editor cannot resurrect a note deleted in another tab", async () => {
  const store = memoryStore([]);
  const result = await mutateReferenceNotes({ kind: "save", item, note: "stale", expected: saved() }, store.dependencies);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "conflict");
  assert.equal(store.writes(), 0);
});

test("delete compares the document shown at confirmation time", async () => {
  const store = memoryStore([saved("새 메모")]);
  const result = await mutateReferenceNotes({ kind: "remove", id: item.id, expected: saved() }, store.dependencies);
  assert.equal(result.ok, false);
  assert.equal(store.read()[0].note, "새 메모");
  assert.equal(store.writes(), 0);
});

test("a deliberate deletion with the current baseline succeeds", async () => {
  const store = memoryStore([saved()]);
  const result = await mutateReferenceNotes({ kind: "remove", id: item.id, expected: saved() }, store.dependencies);
  assert.equal(result.ok, true); assert.equal(store.read().length, 0);
});

test("corruption introduced after initial page load is not overwritten", async () => {
  const store = memoryStore([saved()]);
  store.replace("malformed-after-initial-read");
  const result = await mutateReferenceNotes({ kind: "bookmark", item: other }, store.dependencies);
  assert.deepEqual(result, { ok: false, reason: "storage" });
  assert.equal(store.raw(), "malformed-after-initial-read"); assert.equal(store.writes(), 0);
});

test("quota failure does not expose an optimistic saved result", async () => {
  const store = memoryStore();
  const dependencies = { ...store.dependencies, storage: {
    getItem: () => store.raw(), setItem: () => { throw new Error("QuotaExceededError"); },
  } };
  assert.deepEqual(await mutateReferenceNotes({ kind: "bookmark", item }, dependencies), { ok: false, reason: "storage" });
  assert.equal(store.read().length, 0);
});

test("a rejected lock does not perform an unlocked fallback write", async () => {
  const store = memoryStore();
  const result = await mutateReferenceNotes({ kind: "bookmark", item }, {
    ...store.dependencies, exclusive: async () => { throw new Error("lock unavailable"); },
  });
  assert.equal(result.ok, false); assert.equal(store.writes(), 0);
});

test("JSON backup round-trips personal notes but excludes synopsis and unknown fields", () => {
  const text = referenceNotesBackup([{ ...saved(), item: { ...item, extra: "not-exported" } as typeof item }], now);
  const notes = parseReferenceBackup(text);
  assert.equal(notes[0].note, "기존 메모"); assert.equal(notes[0].item.outline, "");
  assert.equal(text.includes("原文"), false); assert.equal(text.includes("원문 줄거리"), false);
  assert.equal(text.includes("not-exported"), false); assert.equal(text.includes("imageDownloadUrl"), false);
});

test("restore is additive and preserves an existing different note", async () => {
  const store = memoryStore([saved("사용자의 최신 메모")]);
  const result = await mutateReferenceNotes({ kind: "import", notes: [saved("오래된 백업"), saved("추가 자료", other)] }, store.dependencies);
  assert.equal(result.ok, true);
  if (result.ok) { assert.equal(result.added, 1); assert.equal(result.skipped, 1); }
  assert.equal(store.read().find((entry) => entry.item.id === item.id)?.note, "사용자의 최신 메모");
});

test("import of duplicate existing notes is idempotent and does not write", async () => {
  const store = memoryStore([saved()]);
  const result = await mutateReferenceNotes({ kind: "import", notes: [saved()] }, store.dependencies);
  assert.equal(result.ok, true); assert.equal(store.writes(), 0);
});

test("over-limit restore is rejected atomically, not partially imported", async () => {
  const notes = Array.from({ length: 100 }, (_, index) => saved(String(index), { ...item, id: `kmas:${index}` }));
  const store = memoryStore(notes);
  const result = await mutateReferenceNotes({ kind: "import", notes: [saved("new", other)] }, store.dependencies);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "limit");
  assert.equal(store.writes(), 0); assert.equal(store.read().length, 100);
});

for (const raw of ["null", "[]", "{}", "{", JSON.stringify({ version: 1, notes: [] }),
  JSON.stringify({ format: "toonstudio-kmas-references", version: 99, notes: [] }),
  JSON.stringify({ format: "toonstudio-kmas-references", version: 1, notes: [{ ...saved(), note: "x".repeat(4001) }] }),
]) {
  test(`invalid backup cannot reach storage: ${raw.slice(0, 80)}`, () => assert.throws(() => parseReferenceBackup(raw)));
}

test("backup size is bounded by UTF-8 bytes, not UTF-16 character count", () => {
  const raw = JSON.stringify({ format: "toonstudio-kmas-references", version: 1, notes: [], padding: "한".repeat(750_000) });
  assert.ok(raw.length < MAX_REFERENCE_BACKUP_BYTES);
  assert.ok(new TextEncoder().encode(raw).byteLength > MAX_REFERENCE_BACKUP_BYTES);
  assert.throws(() => parseReferenceBackup(raw));
});

test("baseline equality detects metadata edits and note creation or deletion", () => {
  assert.equal(sameReferenceNote(null, null), true);
  assert.equal(sameReferenceNote(saved(), null), false);
  assert.equal(sameReferenceNote(saved(), saved()), true);
  assert.equal(sameReferenceNote(saved(), saved("changed")), false);
  assert.equal(sameReferenceNote(saved(), saved("기존 메모", { ...item, publisher: "changed" })), false);
});

test("a response must match the query and page that initiated the request", () => {
  const result = normalizeReferenceResponse(envelope(), query, now);
  assert.equal(validateReferenceResult(result, query).items.length, 1);
  for (const mismatch of [{ ...query, q: "other" }, { ...query, page: 2 }, { ...query, field: "writer" as const }]) {
    assert.throws(() => validateReferenceResult({ ...result, query: mismatch }, query), failure("KMAS_UNAVAILABLE"));
  }
});

test("malformed, duplicate and contradictory API results fail closed", () => {
  const result = normalizeReferenceResponse(envelope(), query, now);
  for (const value of [null, {}, { ...result, query: undefined }, { ...result, items: [item, item] },
    { ...result, total: 0 }, { ...result, total: -1 }, { ...result, hasNext: "yes" },
    { ...result, items: [], hasNext: true }, { ...result, fetchedAt: "not-a-date" },
  ]) assert.throws(() => validateReferenceResult(value, query), failure("KMAS_UNAVAILABLE"));
});

test("browser client preserves explicit errors and rejects an HTML proxy error", async () => {
  const controller = new AbortController();
  await assert.rejects(fetchReferenceResult("/api/kmas/references", query, controller.signal,
    async () => new Response("<html>upstream</html>", { status: 502 })), failure("KMAS_UNAVAILABLE"));
  await assert.rejects(fetchReferenceResult("/api/kmas/references", query, controller.signal,
    async () => new Response(JSON.stringify({ code: "KMAS_NOT_CONFIGURED" }), { status: 503 })), failure("KMAS_NOT_CONFIGURED"));
});

test("browser client encodes a query and forwards its cancellation signal", async () => {
  const controller = new AbortController();
  const result = normalizeReferenceResponse(envelope(), query, now);
  await fetchReferenceResult("/api/kmas/references", query, controller.signal, async (input, init) => {
    const url = new URL(String(input), "https://example.invalid");
    assert.equal(url.searchParams.get("q"), query.q); assert.equal(init?.signal, controller.signal);
    return new Response(JSON.stringify(result));
  });
});

test("callers cannot mutate shared cache entries or coalesced responses", async () => {
  let calls = 0;
  const search = createKmasReferenceSearch({ env: { KMAS_PRV_KEY: "test-only-key" }, fetcher: async () => { calls++; return response(); } });
  const [first, second] = await Promise.all([search(query), search(query)]);
  first.items[0].title = "tampered"; first.query.q = "tampered";
  assert.equal(second.items[0].title, rawItem.title);
  const cached = await search(query); cached.items.length = 0;
  const next = await search(query);
  assert.equal(next.items.length, 1); assert.equal(next.query.q, query.q); assert.equal(calls, 1);
});

test("removing a key invalidates cache even when the same key is later restored", async () => {
  let calls = 0;
  const env = { KMAS_PRV_KEY: "test-only-key" };
  const search = createKmasReferenceSearch({ env, fetcher: async () => { calls++; return response(); } });
  await search(query); env.KMAS_PRV_KEY = "";
  await assert.rejects(search(query), failure("KMAS_NOT_CONFIGURED"));
  env.KMAS_PRV_KEY = "test-only-key";
  assert.equal((await search(query)).cached, false); assert.equal(calls, 2);
});

test("configuration change is validated before an old cached response can be returned", async () => {
  const env = { KMAS_PRV_KEY: "test-only-key", KMAS_BASE_URL: "https://www.kmas.or.kr" };
  const search = createKmasReferenceSearch({ env, fetcher: async () => response() });
  await search(query); env.KMAS_BASE_URL = "http://not-allowed.invalid";
  await assert.rejects(search(query), failure("KMAS_NOT_CONFIGURED"));
});

test("an A-to-B-to-A credential race cannot repopulate the current cache with an old result", async () => {
  let finishOld: ((value: Response) => void) | undefined;
  let calls = 0;
  const env = { KMAS_PRV_KEY: "fixture-A" };
  const search = createKmasReferenceSearch({ env, fetcher: async () => {
    calls++;
    if (calls === 1) return new Promise<Response>((resolve) => { finishOld = resolve; });
    return response();
  } });
  const old = search(query);
  env.KMAS_PRV_KEY = "fixture-B"; await search(query);
  env.KMAS_PRV_KEY = "fixture-A"; await search(query);
  finishOld!(new Response(JSON.stringify({ result: envelope().result, itemlist: [{ ...rawItem, title: "obsolete" }] })));
  await old;
  assert.equal((await search(query)).items[0].title, rawItem.title); assert.equal(calls, 3);
});

test("HTTP and Content-Length failures release their upstream signal", async () => {
  for (const build of [() => new Response("error", { status: 500 }), () => new Response("body", { headers: { "Content-Length": "9999999" } })]) {
    let signal: AbortSignal | null | undefined;
    const search = createKmasReferenceSearch({ env: { KMAS_PRV_KEY: "test-only-key" }, fetcher: async (_input, init) => { signal = init?.signal; return build(); } });
    await assert.rejects(search(query), failure("KMAS_UNAVAILABLE"));
    assert.equal(signal?.aborted, true);
  }
});

test("the cache has an aggregate byte limit in addition to an entry count", async () => {
  let calls = 0;
  const search = createKmasReferenceSearch({ env: { KMAS_PRV_KEY: "test-only-key" }, fetcher: async () => {
    calls++;
    return new Response(JSON.stringify({ result: { resultState: "success", totalCount: 100 },
      itemlist: Array.from({ length: 100 }, (_, index) => ({ ...rawItem, mastrId: String(index), outline: "한".repeat(6000) })) }));
  } });
  for (let i = 0; i < 6; i++) await search({ ...query, q: `large-${i}` });
  assert.equal((await search({ ...query, q: "large-0" })).cached, false);
  assert.equal(calls, 7);
});

test("restored documents retain the original v1 storage key for migration compatibility", () => {
  assert.equal(REFERENCE_STORAGE_KEY, "toonstudio:kmas-reference-notes:v1");
});
