import { createResourceEngine } from "../apps/api/src/modules/creator-resources/resource-engine";
import { mergeCreatorWorkspaces, parseProviderAvailability, providerAvailability, selectBoardResources, upstreamRetrySeconds } from "../apps/web/src/shared/lib/creator-resource-workflow";
import { emptyWorkspace, parseResource, parseSearchResult } from "../apps/web/src/shared/lib/creator-resources";

interface WorkflowCase { name: string; run: () => void | Promise<void> }
function ok(value: unknown, message = "expected truthy value"): asserts value { if (!value) throw new Error(message); }
function equal(actual: unknown, expected: unknown) { if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); }
function throws(run: () => unknown) { let caught = false; try { run(); } catch { caught = true; } ok(caught, "expected an error"); }
const NOW = Date.parse("2026-09-05T15:00:00Z");
function fixture(overrides: Record<string, unknown> = {}) {
  return { id: "met:1", provider: "met", title: "Reference", creator: "Maker", sourceUrl: "https://www.metmuseum.org/art/collection/search/1", license: "CC0", imageUrl: "https://images.metmuseum.org/sample.jpg", credit: "Museum collection", description: "Reference material", fetchedAt: new Date(NOW).toISOString(), ...overrides };
}
function json(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } }); }
function metObject(id: number) { return { objectID: id, isPublicDomain: true, title: `Object ${id}`, objectURL: `https://www.metmuseum.org/art/collection/search/${id}`, primaryImageSmall: "https://images.metmuseum.org/reference.jpg", artistDisplayName: "Artist", creditLine: "Collection" }; }
function engine(fetcher: (url: string, init?: RequestInit) => Promise<Response>, env: Record<string, string> = {}) { return createResourceEngine({ fetch: fetcher, env: () => env, now: () => NOW }); }
function resource(overrides: Record<string, unknown> = {}) { const item = parseResource(fixture(overrides)); ok(item); return item; }
function opportunity(id: string, deadline?: string) { return resource({ provider: "bizinfo", id: `bizinfo:${id}`, sourceUrl: "https://www.bizinfo.go.kr/", deadline }); }
export const creatorResourceWorkflowCases: WorkflowCase[] = [
  { name: "provider configuration reports booleans without exposing credentials", run() {
    const api = engine(async () => { throw new Error("must not fetch"); }, { KAKAO_REST_API_KEY: "PRIVATE_SECRET", BIZINFO_API_KEY: " " });
    equal(api.describe(), [{ provider: "met", availability: "keyless" }, { provider: "kakao", availability: "configured" }, { provider: "bizinfo", availability: "not_configured" }]);
    equal(JSON.stringify(api.describe()).includes("PRIVATE_SECRET"), false);
  } },
  { name: "provider configuration is re-read rather than cached forever", run() {
    const env: Record<string, string> = {};
    const api = engine(async () => json({}), env);
    equal(api.describe()[1].availability, "not_configured"); env.KAKAO_REST_API_KEY = "NEW_KEY";
    equal(api.describe()[1].availability, "configured");
  } },
  { name: "provider status parser rejects missing, duplicate and contradictory entries", run() {
    const all = providerAvailability({ kakao: false, bizinfo: true }); ok(parseProviderAvailability(all));
    equal(parseProviderAvailability(all.slice(1)), null);
    equal(parseProviderAvailability([all[0], all[0], all[2]]), null);
    equal(parseProviderAvailability([{ provider: "met", availability: "configured" }, all[1], all[2]]), null);
    equal(parseProviderAvailability([all[0], { provider: "kakao", availability: "keyless" }, all[2]]), null);
    equal(parseProviderAvailability([null, all[1], all[2]]), null);
  } },
  { name: "default restore merges resources without overwriting current records", run() {
    const local = { ...emptyWorkspace(), saved: [resource({ title: "현재 제목" })] };
    const incoming = { ...emptyWorkspace(), saved: [resource({ title: "백업 제목" }), resource({ id: "met:2" })] };
    const merged = mergeCreatorWorkspaces(local, incoming);
    equal(merged.saved.map((item) => item.id), ["met:1", "met:2"]); equal(merged.saved[0].title, "현재 제목");
    equal(local.saved.length, 1); equal(incoming.saved[0].title, "백업 제목");
  } },
  { name: "merge preserves filled draft fields, including whitespace, and fills only blanks", run() {
    const local = { ...emptyWorkspace(), story: { title: "현재 제목 ", desire: "   " }, checks: ["publish-pitch"] };
    const incoming = { ...emptyWorkspace(), story: { title: "오래된 제목", desire: "재회", obstacle: "거리" }, checks: ["publish-pitch", "publish-proof"] };
    const merged = mergeCreatorWorkspaces(local, incoming);
    equal(merged.story.title, "현재 제목 "); equal(merged.story.desire, "재회"); equal(merged.story.obstacle, "거리"); equal(merged.checks, ["publish-pitch", "publish-proof"]);
  } },
  { name: "restore merge rejects combined overflow rather than silently dropping data", run() {
    const local = { ...emptyWorkspace(), saved: Array.from({ length: 200 }, (_, id) => resource({ id: `met:${id + 1}` })) };
    throws(() => mergeCreatorWorkspaces(local, { ...emptyWorkspace(), saved: [resource({ id: "met:201" })] }));
    equal(local.saved.length, 200);
    throws(() => mergeCreatorWorkspaces({ ...emptyWorkspace(), checks: Array.from({ length: 200 }, (_, id) => `check-${id}`) }, { ...emptyWorkspace(), checks: ["another"] }));
  } },
  { name: "restoring the same backup repeatedly is idempotent", run() {
    const incoming = { ...emptyWorkspace(), saved: [resource()], story: { title: "작품" }, checks: ["publish-proof"] };
    const once = mergeCreatorWorkspaces(emptyWorkspace(), incoming);
    equal(mergeCreatorWorkspaces(once, incoming), once);
  } },
  { name: "board search matches Korean, creator and ISBN across all saved sources", run() {
    const items = [resource({ title: "의상 참고", creator: "작가" }), resource({ provider: "kakao", id: "kakao:978123", sourceUrl: "https://search.daum.net/", isbn: "978123", title: "만화 작법" })];
    equal(selectBoardResources(items, { query: "작가 의상" }).length, 1);
    equal(selectBoardResources(items, { query: "978123" })[0].provider, "kakao");
    equal(selectBoardResources(items, { query: "없는 단어" }).length, 0);
  } },
  { name: "board search handles normalized full-width and decomposed text", run() {
    const items = [resource({ title: "Armor 가구" })];
    equal(selectBoardResources(items, { query: "ＡＲＭＯＲ" }).length, 1);
    equal(selectBoardResources(items, { query: "가구".normalize("NFD") }).length, 1);
  } },
  { name: "board provider filtering and ordering do not mutate saved items", run() {
    const items = [resource({ id: "met:1", title: "나" }), resource({ id: "met:2", title: "가" }), opportunity("3")];
    equal(selectBoardResources(items, { provider: "met", sort: "title" }).map((item) => item.id), ["met:2", "met:1"]);
    equal(selectBoardResources(items, { sort: "saved" })[0].id, "bizinfo:3"); equal(items[0].id, "met:1");
  } },
  { name: "deadline filters use Korean midnight and exclude non-opportunities", run() {
    const items = [opportunity("past", "2026-09-05"), opportunity("today", "2026-09-06"), opportunity("later", "2026-09-07"), opportunity("unknown"), resource()];
    equal(selectBoardResources(items, { deadline: "upcoming" }, new Date(NOW)).map((item) => item.id), ["bizinfo:later", "bizinfo:today"]);
    equal(selectBoardResources(items, { deadline: "expired" }, new Date(NOW))[0].id, "bizinfo:past");
    equal(selectBoardResources(items, { deadline: "unknown" }, new Date(NOW)).map((item) => item.id), ["bizinfo:unknown"]);
    equal(selectBoardResources(items, { deadline: "upcoming" }, new Date(NOW - 1)).length, 3);
  } },
  { name: "deadline ordering puts unknown dates last; recent ordering uses retrieval time", run() {
    const items = [opportunity("unknown"), opportunity("later", "2026-09-30"), opportunity("first", "2026-09-10")];
    equal(selectBoardResources(items, { sort: "deadline" }).map((item) => item.id), ["bizinfo:first", "bizinfo:later", "bizinfo:unknown"]);
    equal(selectBoardResources([resource(), resource({ id: "met:2", fetchedAt: "2026-09-06T15:00:00Z" })], { sort: "recent" })[0].id, "met:2");
  } },
  { name: "Retry-After seconds and HTTP dates are bounded and malformed values use a safe default", run() {
    equal(upstreamRetrySeconds("60", NOW), 60); equal(upstreamRetrySeconds("9999999999", NOW), 120); equal(upstreamRetrySeconds("0", NOW), 1);
    equal(upstreamRetrySeconds(new Date(NOW + 90000).toUTCString(), NOW), 90);
    equal(upstreamRetrySeconds(new Date(NOW - 90000).toUTCString(), NOW), 1);
    equal(upstreamRetrySeconds("garbage", NOW), 30); equal(upstreamRetrySeconds(null, NOW), 30);
  } },
  { name: "upstream 429 stops repeated calls until Retry-After elapses", async run() {
    let time = NOW; let calls = 0;
    const api = createResourceEngine({ now: () => time, env: () => ({}), fetch: async () => { calls++; return calls === 1 ? new Response("busy", { status: 429, headers: { "Retry-After": "10" } }) : json({ total: 0, objectIDs: [] }); } });
    equal((await api.search({ provider: "met", q: "armor" })).status, "unavailable");
    time += 9999; equal((await api.search({ provider: "met", q: "costume" })).status, "unavailable"); equal(calls, 1);
    time += 2; equal((await api.search({ provider: "met", q: "costume" })).status, "ready"); equal(calls, 2);
  } },
  { name: "provider cooldown does not block another provider", async run() {
    const api = engine(async (url) => url.includes("metmuseum") ? json({}, 503) : json({ documents: [], meta: { is_end: true } }), { KAKAO_REST_API_KEY: "KEY" });
    equal((await api.search({ provider: "met", q: "armor" })).status, "unavailable");
    equal((await api.search({ provider: "kakao", q: "만화" })).status, "ready");
  } },
  { name: "duplicate Met IDs are fetched and displayed only once", async run() {
    let details = 0;
    const api = engine(async (url) => { if (url.includes("/search")) return json({ total: 3, objectIDs: [1, 1, 1] }); details++; return json(metObject(1)); });
    const result = await api.search({ provider: "met", q: "armor" }); equal(result.items.length, 1); equal(details, 1);
  } },
  { name: "negative and non-integer Met totals never enter the success cache", async run() {
    for (const total of [-1, 0.5]) {
      let calls = 0;
      const api = engine(async () => { calls++; return calls === 1 ? json({ total, objectIDs: [] }) : json({ total: 0, objectIDs: [] }); });
      equal((await api.search({ provider: "met", q: "armor" })).status, "unavailable");
      equal((await api.search({ provider: "met", q: "armor" })).status, "ready"); equal(calls, 2);
    }
  } },
  { name: "search contracts reject duplicate cards and unavailable results with content", run() {
    equal(parseSearchResult({ provider: "met", status: "ready", items: [fixture(), fixture()] }), null);
    equal(parseSearchResult({ provider: "met", status: "unavailable", items: [fixture()] }), null);
    equal(parseSearchResult({ provider: "met", status: "not_configured", items: [], hasMore: true }), null);
    // Met can know there are more IDs even when every detail request fails.
    ok(parseSearchResult({ provider: "met", status: "unavailable", items: [], hasMore: true }));
  } },

];
