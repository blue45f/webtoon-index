import assert from "node:assert/strict";

import { test } from "vitest";

import { createKmasReferenceSearch, REFERENCE_CACHE_TTL_MS } from "../../../../../../apps/api/src/server/kmas-reference";
import { parseReferenceNotes, referenceNotesMarkdown, writeReferenceNotes } from "../../../domains/catalog/references/reference-storage";
import { normalizeReferenceItem, normalizeReferenceResponse, parseReferenceQuery, ReferenceError, REFERENCE_FIELDS } from "../kmas-reference";

import type { ReferenceField } from "../kmas-reference";

const query = { field: "title" as const, q: "검증용 가상 작품", page: 1 };
const rawItem = { mastrId: "fixture-01", title: "검증용 가상 작품", pictrWritrNm: "그림 작가", sntncWritrNm: "글 작가", outline: "테스트 전용 줄거리", imageDownloadUrl: "https://example.invalid/cover.png" };
const envelope = () => ({ result: { resultState: "success", totalCount: "1" }, itemlist: [rawItem] });
const response = () => new Response(JSON.stringify(envelope()), { headers: { "Content-Type": "application/json" } });
const failure = (code: string) => (error: unknown) => error instanceof ReferenceError && error.code === code;

test("validates and normalizes all documented search fields", () => {
  for (const field of Object.keys(REFERENCE_FIELDS) as ReferenceField[]) {
    const q = field === "isbn" ? "979-1169798488" : "  한글 검색  ";
    assert.deepEqual(parseReferenceQuery({ field, q, page: "2" }), { field, q: field === "isbn" ? "9791169798488" : "한글 검색", page: 2 });
  }
});
for (const raw of [
  {}, { q: "" }, { q: "  " }, { q: ["polluted"] }, { q: "x", field: "constructor" },
  { q: "x", field: "__proto__" }, { q: "x", page: "0" }, { q: "x", page: "1001" },
  { q: "x", page: ["1"] }, { q: "x", page: null }, { q: "x", page: "1.5" },
  { q: "x", page: "1e2" }, { q: "a".repeat(121) }, { q: "x\ny" }, { q: "x", prvKey: "client" },
  { q: "123", field: "isbn" },
]) {
  test(`rejects invalid query ${JSON.stringify(raw)}`, () => assert.throws(() => parseReferenceQuery(raw), failure("INVALID_QUERY")));
}
test("normalizes four observed item envelopes without copying remote image URLs", () => {
  for (const root of [
    envelope(), { result: envelope().result, itemList: [rawItem] },
    { result: { ...envelope().result, itemlist: [rawItem] } },
    { result: { ...envelope().result, itemList: [rawItem] } },
  ]) {
    const data = normalizeReferenceResponse(root, query, "2026-09-06T00:00:00Z");
    assert.equal(data.items.length, 1); assert.equal(data.total, 1); assert.equal(data.hasNext, false);
    assert.equal(JSON.stringify(data).includes("imageDownloadUrl"), false);
    assert.equal(data.items[0].publisher, "");
  }
});
test("does not turn upstream failure or malformed data into zero results", () => {
  for (const root of [null, {}, { result: { resultState: "error", totalCount: 0 } }, { result: { resultState: "success", totalCount: 2 } }, { result: { resultState: "success" }, itemlist: [{}] }]) {
    assert.throws(() => normalizeReferenceResponse(root, query, "2026-09-06T00:00:00Z"), failure("KMAS_UNAVAILABLE"));
  }
  const empty = normalizeReferenceResponse({ result: { resultState: "success", totalCount: 0 } }, query, "2026-09-06T00:00:00Z");
  assert.equal(empty.items.length, 0);
});
test("deduplicates identities and never fabricates an unknown total", () => {
  const data = normalizeReferenceResponse({ result: { resultState: "success" }, itemlist: [rawItem, rawItem] }, query, "2026-09-06T00:00:00Z");
  assert.equal(data.items.length, 1); assert.equal(data.total, null);
  assert.notEqual(normalizeReferenceItem({ title: "A", subtitl: "B" })?.id, normalizeReferenceItem({ title: "AB" })?.id);
});
test("missing server key never contacts upstream", async () => {
  const search = createKmasReferenceSearch({ env: {}, fetcher: async () => { throw new Error("must not fetch"); } });
  await assert.rejects(search(query), failure("KMAS_NOT_CONFIGURED"));
});
test("requests only approved HTTPS endpoint and documented parameters", async () => {
  let called = false;
  const search = createKmasReferenceSearch({ env: { KMAS_PRV_KEY: "test-only-key" }, fetcher: async (input, init) => {
    called = true;
    const url = new URL(String(input));
    assert.equal(url.origin, "https://www.kmas.or.kr");
    assert.equal(url.pathname, "/openapi/search/bookAndWebtoonList");
    assert.equal(url.searchParams.get("prvKey"), "test-only-key");
    assert.equal(url.searchParams.get("viewItemCnt"), "24");
    assert.equal(url.searchParams.get("pageNo"), "1");
    assert.equal(url.searchParams.get("title"), query.q); assert.equal(init?.redirect, "error");
    return response();
  } });
  const result = await search(query);
  assert.equal(called, true); assert.equal(JSON.stringify(result).includes("test-only-key"), false);
});
test("coalesces parallel searches, caches, expires and rotates credentials", async () => {
  let calls = 0; let clock = 1_000_000;
  const env = { KMAS_PRV_KEY: "fixture-key-a" };
  const search = createKmasReferenceSearch({ env, now: () => clock, fetcher: async () => { calls++; return response(); } });
  await Promise.all([search(query), search(query), search(query)]); assert.equal(calls, 1);
  assert.equal((await search(query)).cached, true); assert.equal(calls, 1);
  clock += REFERENCE_CACHE_TTL_MS + 1; await search(query); assert.equal(calls, 2);
  env.KMAS_PRV_KEY = "fixture-key-b"; await search(query); assert.equal(calls, 3);
});
test("rejects unapproved origins before fetch", async () => {
  for (const base of ["http://www.kmas.or.kr", "https://evil.invalid", "https://user:pass@www.kmas.or.kr", "https://www.kmas.or.kr:8443"]) {
    const search = createKmasReferenceSearch({ env: { KMAS_PRV_KEY: "fixture", KMAS_BASE_URL: base }, fetcher: async () => { throw new Error("must not fetch"); } });
    await assert.rejects(search(query), failure("KMAS_NOT_CONFIGURED"));
  }
});
test("sanitizes upstream failures and maps rate limiting", async () => {
  const search = createKmasReferenceSearch({ env: { KMAS_PRV_KEY: "fixture-secret" }, fetcher: async () => { throw new Error("https://www.kmas.or.kr?prvKey=fixture-secret"); } });
  await assert.rejects(search(query), (error: unknown) => failure("KMAS_UNAVAILABLE")(error) && !String(error).includes("fixture-secret"));
  const limited = createKmasReferenceSearch({ env: { KMAS_PRV_KEY: "fixture" }, fetcher: async () => new Response("", { status: 429 }) });
  await assert.rejects(limited(query), failure("KMAS_RATE_LIMITED"));
});
test("aborts timeout and rejects oversized or invalid responses", async () => {
  const slow = createKmasReferenceSearch({ env: { KMAS_PRV_KEY: "fixture" }, timeoutMs: 5, fetcher: async (_input, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  }) });
  await assert.rejects(slow(query), failure("KMAS_TIMEOUT"));
  for (const getResponse of [() => new Response("not json"), () => new Response("x".repeat(2 * 1024 * 1024 + 1)), () => new Response("x", { headers: { "Content-Length": "3000000" } })]) {
    const search = createKmasReferenceSearch({ env: { KMAS_PRV_KEY: "fixture" }, fetcher: async () => getResponse() });
    await assert.rejects(search(query), failure("KMAS_UNAVAILABLE"));
  }
});
test("bounds new upstream requests without penalizing a cache hit", async () => {
  let calls = 0;
  const search = createKmasReferenceSearch({ env: { KMAS_PRV_KEY: "fixture" }, now: () => 1_000_000, fetcher: async () => { calls++; return response(); } });
  for (let index = 0; index < 30; index++) await search({ ...query, q: `fixture-${index}` });
  await assert.rejects(search({ ...query, q: "over-limit" }), failure("KMAS_RATE_LIMITED"));
  await search({ ...query, q: "fixture-0" }); assert.equal(calls, 30);
});
test("note persistence excludes synopses and fails safely for malformed storage", () => {
  const item = normalizeReferenceItem(rawItem)!;
  const notes = [{ item, note: "연출 연구", savedAt: "2026-09-06T00:00:00Z" }];
  const parsed = parseReferenceNotes(JSON.stringify({ version: 1, notes }));
  assert.equal(parsed[0].item.outline, ""); assert.equal(parsed[0].note, "연출 연구");
  for (const text of ["{", "null", "{}", JSON.stringify({ version: 1, notes: [{ ...notes[0], note: "x".repeat(4001) }] })]) assert.throws(() => parseReferenceNotes(text));
  assert.deepEqual(parseReferenceNotes(null), []);
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  try {
    let written = "";
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { setItem: (_key: string, value: string) => { written = value; } } });
    assert.equal(writeReferenceNotes(notes), true); assert.equal(JSON.parse(written).notes[0].item.outline, "");
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { setItem: () => { throw new Error("quota"); } } });
    assert.equal(writeReferenceNotes(notes), false);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});
test("exports personal notes and attribution as escaped Markdown, not remote artwork", () => {
  const item = normalizeReferenceItem(rawItem)!;
  const md = referenceNotesMarkdown([{ item, note: "<script>unsafe</script>\n[link](javascript:alert(1))", savedAt: "2026-09-06T00:00:00Z" }]);
  assert.ok(md.includes("KMAS")); assert.ok(md.includes("\\<script\\>"));
  assert.equal(md.includes("테스트 전용 줄거리"), false); assert.equal(md.includes("imageDownloadUrl"), false);
});

test("stored notes discard unknown metadata fields", () => {
  const item = { ...normalizeReferenceItem(rawItem)!, imageDownloadUrl: "https://example.invalid/cover.png", unknownField: "not stored" };
  const notes = parseReferenceNotes(JSON.stringify({ version: 1, notes: [{ item, note: "own note", savedAt: "2026-09-06T00:00:00Z" }] }));
  assert.equal(Object.hasOwn(notes[0].item, "imageDownloadUrl"), false);
  assert.equal(Object.hasOwn(notes[0].item, "unknownField"), false);
});
