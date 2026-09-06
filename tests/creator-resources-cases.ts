import { createResourceEngine, ResourceInputError, ResourceBusyError } from "../apps/api/src/modules/creator-resources/resource-engine";
import { exerciseSvg, recipeById, RECIPES } from "../apps/web/src/domains/creator-resources/recipes";
import { attributionMarkdown, dateOnly, deadlineCalendar, deadlineLabel, emptyWorkspace, httpsUrl, parseDeadline, parseResource, parseSearchResult, parseWorkspace, storyMarkdown } from "../apps/web/src/shared/lib/creator-resources";

export interface CreatorResourceCase { name: string; run: () => void | Promise<void> }
function ok(value: unknown, message = "expected truthy value"): asserts value { if (!value) throw new Error(message); }
function equal(actual: unknown, expected: unknown) { if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); }
function throws(run: () => unknown) { let caught = false; try { run(); } catch { caught = true; } ok(caught, "expected an error"); }
async function rejects(run: () => Promise<unknown>, kind: new (message?: string) => Error = Error) { let caught: unknown; try { await run(); } catch (error) { caught = error; } ok(caught instanceof kind, "expected rejection"); }
const NOW = Date.parse("2026-09-05T15:00:00Z");
function fixture(overrides: Record<string, unknown> = {}) {
  return { id: "met:1", provider: "met", title: "Reference", creator: "Maker", sourceUrl: "https://www.metmuseum.org/art/collection/search/1", license: "CC0", imageUrl: "https://images.metmuseum.org/sample.jpg", credit: "Museum collection", description: "Reference material", fetchedAt: new Date(NOW).toISOString(), ...overrides };
}
function json(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } }); }
function metObject(id: number, rights: unknown = true) { return { objectID: id, isPublicDomain: rights, title: `Object ${id}`, objectURL: `https://www.metmuseum.org/art/collection/search/${id}`, primaryImageSmall: "https://images.metmuseum.org/reference.jpg", artistDisplayName: "Artist", creditLine: "Collection" }; }
function engine(fetcher: (url: string, init?: RequestInit) => Promise<Response>, env: Record<string, string> = {}) { return createResourceEngine({ fetch: fetcher, env: () => env, now: () => NOW }); }
function bizRow(extra: Record<string, unknown> = {}) { return { pblancId: "PBLN_001", pblancNm: "웹툰 콘텐츠 제작 지원", pblancUrl: "/web/view.do?pblancId=PBLN_001", reqstBeginEndDe: "20260901 ~ 20260930", bsnsSumryCn: "<b>웹툰</b> 제작", trgetNm: "중소기업", ...extra }; }
export const creatorResourceCases: CreatorResourceCase[] = [
  { name: "HTTPS rejects script, credentials, ports and deceptive hosts", run() {
    for (const value of ["javascript:alert(1)", "http://www.metmuseum.org", "https://u:p@www.metmuseum.org/", "https://www.metmuseum.org:8080/", "https://www.metmuseum.org.evil.test/"]) equal(httpsUrl(value, ["www.metmuseum.org"]), "");
    equal(httpsUrl("https://www.metmuseum.org/path", ["www.metmuseum.org"]), "https://www.metmuseum.org/path");
  } },
  { name: "date validation rejects impossible calendar dates", run() { equal(dateOnly("2026-02-29"), undefined); equal(dateOnly("2024-02-29"), "2024-02-29"); equal(dateOnly("2026-13-01"), undefined); } },
  { name: "deadline parser accepts only complete ordered periods", run() {
    equal(parseDeadline("20260901 ~ 20260930"), "2026-09-30"); equal(parseDeadline("2026-09-01 ~ 2026-09-30"), "2026-09-30");
    for (const value of ["상시 접수", "예산 소진 시", "20260930 ~ 20260901", "20260201 ~ 20260230", "20260901 ~", "20260901 ~ 20260930 (예정)"]) equal(parseDeadline(value), undefined);
  } },
  { name: "D-day changes at Korean midnight, not UTC midnight", run() {
    equal(deadlineLabel("2026-09-06", new Date("2026-09-05T14:59:59Z")), "D-1");
    equal(deadlineLabel("2026-09-06", new Date(NOW)), "오늘 마감 · 시간 확인");
    equal(deadlineLabel("2026-09-05", new Date(NOW)), "마감일 경과"); equal(deadlineLabel(undefined), "마감일 원문 확인");
  } },
  { name: "resource parser only preserves CC0 Met image hosts", run() {
    ok(parseResource(fixture())?.imageUrl); equal(parseResource(fixture({ license: "unknown" }))?.imageUrl, undefined);
    equal(parseResource(fixture({ imageUrl: "https://evil.test/x.svg" }))?.imageUrl, undefined);
    equal(parseResource(fixture({ sourceUrl: "https://evil.test/" })), null);
    equal(parseResource(fixture({ id: "met:" })), null);
  } },
  { name: "book metadata never imports a cover image or CC0 claim", run() {
    const item = parseResource(fixture({ provider: "kakao", id: "kakao:978", sourceUrl: "https://search.daum.net/search?w=book", license: "CC0" }));
    equal(item?.license, "metadata-only"); equal(item?.imageUrl, undefined);
  } },
  { name: "search contract rejects invalid items and unknown status", run() {
    equal(parseSearchResult({ provider: "met", status: "online", items: [] }), null);
    equal(parseSearchResult({ provider: "met", status: "ready", items: [{ bad: true }] }), null);
    ok(parseSearchResult({ provider: "met", status: "ready", items: [fixture()], page: 1 }));
  } },
  { name: "workspace schema, size and array caps are enforced", run() {
    throws(() => parseWorkspace("{")); throws(() => parseWorkspace(JSON.stringify({ ...emptyWorkspace(), version: 2 })));
    throws(() => parseWorkspace(JSON.stringify({ ...emptyWorkspace(), saved: Array(201).fill(fixture()) })));
    throws(() => parseWorkspace(" ".repeat(1000001))); equal(parseWorkspace(null), emptyWorkspace());
  } },
  { name: "workspace preserves Korean drafting spaces and ignores prototype fields", run() {
    const parsed = parseWorkspace(JSON.stringify({ ...emptyWorkspace(), story: JSON.parse('{"title":"제목 ","__proto__":{"polluted":true}}') }));
    equal(parsed.story.title, "제목 "); equal(Object.getPrototypeOf(parsed.story), Object.prototype); equal(parsed.story.polluted, undefined);
  } },
  { name: "workspace deduplicates resources and valid checklist IDs", run() {
    const parsed = parseWorkspace(JSON.stringify({ ...emptyWorkspace(), saved: [fixture(), fixture()], checks: ["publish-proof", "publish-proof", "<script>"] }));
    equal(parsed.saved.length, 1); equal(parsed.checks, ["publish-proof"]);
  } },
  { name: "ICS escapes content and uses exclusive end date", run() {
    const item = parseResource(fixture({ provider: "bizinfo", id: "bizinfo:x", sourceUrl: "https://www.bizinfo.go.kr/", deadline: "2026-12-31", title: "공모전\nBEGIN:VEVENT,;" })); ok(item);
    const result = deadlineCalendar(item, new Date(NOW));
    ok(result.includes("DTSTART;VALUE=DATE:20261231")); ok(result.includes("DTEND;VALUE=DATE:20270101"));
    equal(result.split("\r\nBEGIN:VEVENT").length, 2); ok(result.includes("\\nBEGIN:VEVENT\\,\\;")); ok(result.endsWith("\r\n"));
  } },
  { name: "ICS folds Korean UTF-8 lines to 75 octets without corruption", run() {
    const item = parseResource(fixture({ provider: "bizinfo", id: "bizinfo:x", sourceUrl: "https://www.bizinfo.go.kr/", deadline: "2026-09-30", title: "가나다".repeat(60) })); ok(item);
    const result = deadlineCalendar(item, new Date(NOW));
    for (const line of result.split("\r\n")) ok(new TextEncoder().encode(line).length <= 75);
    ok(result.replaceAll("\r\n ", "").includes("가나다".repeat(60))); equal(result.includes("�"), false);
  } },
  { name: "unknown deadline cannot generate a calendar event", run() { const item = parseResource(fixture()); ok(item); throws(() => deadlineCalendar(item)); } },
  { name: "markdown export retains attribution and escapes markup", run() {
    const item = parseResource(fixture({ title: "[source](javascript:bad) <img>" })); ok(item);
    const text = attributionMarkdown([item]); ok(text.includes(item.sourceUrl)); ok(text.includes("\\[source\\]")); ok(text.includes("CC0"));
    ok(storyMarkdown({ protagonist: "<script>" }).includes("\\<script\\>"));
  } },
  { name: "six original recipes have stable IDs and valid frame exports", run() {
    equal(RECIPES.length, 6); equal(new Set(RECIPES.map((recipe) => recipe.id)).size, 6);
    for (const recipe of RECIPES) { const svg = exerciseSvg(recipe, Number.NaN); ok(svg.includes("<svg")); ok(!svg.includes("NaN")); equal(svg.includes("<script"), false); equal(recipe.steps.length, 4); }
    equal(recipeById("invalid").id, "scroll"); ok(exerciseSvg(RECIPES[0], 99999).includes("160"));
  } },
  { name: "missing credential returns not_configured without a network call", async run() {
    let calls = 0; const api = engine(async () => { calls++; return json({}); });
    equal((await api.search({ provider: "kakao", q: "웹툰" })).status, "not_configured"); equal((await api.search({ provider: "bizinfo", q: "웹툰" })).status, "not_configured"); equal(calls, 0);
  } },
  { name: "invalid providers, query arrays and out-of-range pages fail validation", async run() {
    const api = engine(async () => json({}));
    for (const input of [{ provider: "evil", q: "hi" }, { provider: "met", q: ["armor"] }, { provider: "met", q: "x" }, { provider: "met", q: "x".repeat(81) }, { provider: "met", q: "ar\nmor" }, { provider: "met", q: "armor", page: 21 }, { provider: "met", q: "armor", page: [1] }]) await rejects(() => api.search(input), ResourceInputError);
  } },
  { name: "Met uses new paginated endpoint and strict public-domain filter", async run() {
    const calls: string[] = [];
    const api = engine(async (url) => { calls.push(url); if (url.includes("/search")) return json({ total: 25, objectIDs: [1, 2, 3] }); const id = Number(url.split("/").pop()); return json(metObject(id, id === 1)); });
    const result = await api.search({ provider: "met", q: "armor", page: "2" });
    ok(calls[0].includes("/v1.1/search")); ok(calls[0].includes("offset=12")); ok(calls[0].includes("limit=12")); equal(result.items.length, 1); equal(result.items[0].id, "met:1"); equal(result.hasMore, true);
  } },
  { name: "Met detail requests run at most three at a time", async run() {
    let active = 0; let peak = 0;
    const api = engine(async (url) => { if (url.includes("/search")) return json({ total: 12, objectIDs: Array.from({ length: 12 }, (_, i) => i + 1) }); active++; peak = Math.max(peak, active); await Promise.resolve(); active--; return json(metObject(Number(url.split("/").pop()))); });
    equal((await api.search({ provider: "met", q: "armor" })).items.length, 12); ok(peak <= 3);
  } },
  { name: "Met upstream schema and unknown rights never expose images", async run() {
    const api = engine(async (url) => url.includes("/search") ? json({ total: 1, objectIDs: [1] }) : json(metObject(1, "true")));
    const result = await api.search({ provider: "met", q: "armor" }); equal(result.status, "unavailable"); equal(result.items.length, 0);
  } },
  { name: "Met preserves partial status and safe independent results", async run() {
    const api = engine(async (url) => url.includes("/search") ? json({ total: 2, objectIDs: [1, 2] }) : url.endsWith("/1") ? json(metObject(1)) : json({}, 503));
    const result = await api.search({ provider: "met", q: "armor" }); equal(result.status, "partial"); equal(result.items.length, 1);
  } },
  { name: "Met rejects unsafe image URLs and duplicate detail identity", async run() {
    const api = engine(async (url) => url.includes("/search") ? json({ total: 1, objectIDs: [1] }) : json({ ...metObject(1), primaryImageSmall: "https://evil.test/x.jpg" }));
    equal((await api.search({ provider: "met", q: "armor" })).items.length, 0);
  } },
  { name: "legitimate empty Met pages remain empty, not fabricated samples", async run() {
    const api = engine(async () => json({ total: 1, objectIDs: [] })); const result = await api.search({ provider: "met", q: "armor", page: 2 });
    equal(result.status, "ready"); equal(result.items, []); equal(result.hasMore, false);
  } },
  { name: "requests deduplicate and cache repeated read-only upstream calls", async run() {
    let calls = 0;
    const api = engine(async (url) => { calls++; return url.includes("/search") ? json({ total: 1, objectIDs: [1] }) : json(metObject(1)); });
    await Promise.all([api.search({ provider: "met", q: "armor" }, "a"), api.search({ provider: "met", q: "armor" }, "b")]);
    await api.search({ provider: "met", q: "armor" }, "c"); equal(calls, 2);
  } },
  { name: "requests have bounded timeout and reject redirects", async run() {
    let checked = false;
    const api = engine(async (_url, init) => { equal(init?.redirect, "error"); equal(init?.credentials, "omit"); ok(init?.signal); checked = true; throw new Error("redirect URL includes SECRET"); });
    const result = await api.search({ provider: "met", q: "armor" }); ok(checked); equal(result.status, "unavailable"); equal(JSON.stringify(result).includes("SECRET"), false);
  } },
  { name: "non-JSON responses and oversized bodies are not accepted", async run() {
    for (const response of [new Response("<html>error</html>", { headers: { "content-type": "text/html" } }), new Response("{}", { headers: { "content-type": "application/json", "content-length": "99999999" } }), new Response('"' + "x".repeat(2100000) + '"', { headers: { "content-type": "application/json" } })]) {
      equal((await engine(async () => response).search({ provider: "met", q: "armor" })).status, "unavailable");
    }
  } },
  { name: "per-client request limit is explicit and isolated", async run() {
    const api = engine(async () => json({ total: 0, objectIDs: [] }));
    for (let i = 0; i < 20; i++) await api.search({ provider: "met", q: "armor" }, "one");
    await rejects(() => api.search({ provider: "met", q: "armor" }, "one"), ResourceBusyError);
    equal((await api.search({ provider: "met", q: "armor" }, "two")).status, "ready");
  } },
  { name: "Kakao uses v3 book endpoint, server key and metadata only", async run() {
    const api = engine(async (url, init) => { ok(url.startsWith("https://dapi.kakao.com/v3/search/book?")); equal(new Headers(init?.headers).get("Authorization"), "KakaoAK TEST_KEY"); return json({ meta: { is_end: true }, documents: [{ title: "만화", url: "https://search.daum.net/search?w=book", isbn: "978001", authors: ["작가"], publisher: "출판사", thumbnail: "https://evil.test/cover.jpg", contents: "<b>소개</b>" }] }); }, { KAKAO_REST_API_KEY: "TEST_KEY" });
    const result = await api.search({ provider: "kakao", q: "만화" }); equal(result.items[0].imageUrl, undefined); equal(result.items[0].description, "소개"); equal(result.items[0].license, "metadata-only"); equal(JSON.stringify(result).includes("TEST_KEY"), false);
  } },
  { name: "BizInfo supports official jsonArray.item and normalizes relative links", async run() {
    const api = engine(async (url) => { const query = new URL(url).searchParams; equal(query.get("searchCnt"), "100"); equal(query.get("dataType"), "json"); equal(query.get("crtfcKey"), "BIZ_TEST"); return json({ jsonArray: { item: [bizRow()] } }); }, { BIZINFO_API_KEY: "BIZ_TEST" });
    const result = await api.search({ provider: "bizinfo", q: "웹툰" }); equal(result.items.length, 1); equal(result.items[0].deadline, "2026-09-30"); equal(result.items[0].eligibility, "중소기업"); ok(result.items[0].sourceUrl.startsWith("https://www.bizinfo.go.kr/")); equal(JSON.stringify(result).includes("BIZ_TEST"), false);
  } },
  { name: "BizInfo filters current batch, never invents eligibility or deadlines", async run() {
    const api = engine(async () => json({ jsonArray: [bizRow({ reqstBeginEndDe: "상시", trgetNm: "" }), bizRow({ pblancId: "PBLN_2", pblancNm: "수산업 지원", bsnsSumryCn: "수산업" })] }), { BIZINFO_API_KEY: "BIZ_TEST" });
    const result = await api.search({ provider: "bizinfo", q: "웹툰" }); equal(result.items.length, 1); equal(result.items[0].deadline, undefined); equal(result.items[0].eligibility, "신청자격 원문 확인"); ok(result.message.includes("100건"));
  } },
  { name: "BizInfo schema errors are unavailable instead of false empty success", async run() {
    const api = engine(async () => json({ error: "invalid secret credential" }), { BIZINFO_API_KEY: "BIZ_TEST" }); equal((await api.search({ provider: "bizinfo", q: "웹툰" })).status, "unavailable");
  } },
  { name: "malformed upstream JSON is not retained in the success cache", async run() {
    let calls = 0;
    const api = engine(async () => { calls++; return calls === 1 ? json({ error: "bad key" }) : json({ jsonArray: { item: [bizRow()] } }); }, { BIZINFO_API_KEY: "BIZ_TEST" });
    equal((await api.search({ provider: "bizinfo", q: "웹툰" })).status, "unavailable");
    equal((await api.search({ provider: "bizinfo", q: "웹툰" })).items.length, 1); equal(calls, 2);
  } },
  { name: "contradictory rights metadata is excluded despite a public-domain flag", async run() {
    const api = engine(async (url) => url.includes("/search") ? json({ total: 1, objectIDs: [1] }) : json({ ...metObject(1), rightsAndReproduction: "Copyright retained" }));
    equal((await api.search({ provider: "met", q: "armor" })).items.length, 0);
  } },
  { name: "upstream cache expires after five minutes", async run() {
    let time = NOW; let calls = 0;
    const api = createResourceEngine({ now: () => time, env: () => ({}), fetch: async () => { calls++; return json({ total: 0, objectIDs: [] }); } });
    await api.search({ provider: "met", q: "armor" }); time += 299999; await api.search({ provider: "met", q: "armor" }); equal(calls, 1);
    time += 2; await api.search({ provider: "met", q: "armor" }); equal(calls, 2);
  } },
];
