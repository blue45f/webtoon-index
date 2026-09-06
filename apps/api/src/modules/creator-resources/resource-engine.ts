import { providerAvailability, upstreamRetrySeconds } from "../../../../web/src/shared/lib/creator-resource-workflow";
import {
  httpsUrl, isProvider, parseDeadline, parseResource, recordOf, textOf,
} from "../../../../web/src/shared/lib/creator-resources";

import type { CreatorResource, ResourceProvider, ResourceSearchResult } from "../../../../web/src/shared/lib/creator-resources";

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
export interface ResourceEngineOptions {
  fetch: Fetcher;
  env: () => Record<string, string | undefined>;
  now?: () => number;
}
export class ResourceInputError extends Error {}
export class ResourceBusyError extends Error {}
const PAGE_SIZE = 12;
const MAX_BODY = 2 * 1024 * 1024;
const MAX_CACHE = 256;
const LIMIT = 20;
const PROVIDER_KEY = { met: "", kakao: "KAKAO_REST_API_KEY", bizinfo: "BIZINFO_API_KEY" } as const;
function plainText(value: unknown, max = 1200): string {
  return textOf(value, 20000).replace(/<[^>]*>/gu, " ").replace(/&(nbsp|amp|lt|gt|quot);/gu, " ").replace(/\s+/gu, " ").trim().slice(0, max);
}
function bizinfoLink(value: unknown): string {
  const raw = textOf(value, 2048);
  return raw.startsWith("/") && !raw.startsWith("//") ? new URL(raw, "https://www.bizinfo.go.kr").href : raw;
}
function rowsOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
async function limitedJson(response: Response): Promise<unknown> {
  if (!response.ok || response.redirected || !response.headers.get("content-type")?.toLowerCase().includes("json")) { await response.body?.cancel(); throw new Error("upstream_response"); }
  const size = Number(response.headers.get("content-length"));
  if (Number.isFinite(size) && size > MAX_BODY) { await response.body?.cancel(); throw new Error("upstream_size"); }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("upstream_body");
  let bytes = 0; let output = "";
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_BODY) throw new Error("upstream_size");
      output += decoder.decode(chunk.value, { stream: true });
    }
    output += decoder.decode();
    return JSON.parse(output) as unknown;
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
export function createResourceEngine(options: ResourceEngineOptions) {
  const now = options.now ?? Date.now;
  const cache = new Map<string, { until: number; value: unknown; fetchedAt: string; bytes: number }>();
  const pending = new Map<string, Promise<{ value: unknown; fetchedAt: string }>>();
  const cooldowns = new Map<string, number>();
  const clients = new Map<string, { until: number; count: number }>();
  let active = 0; let budgetStart = 0; let budget = 0; let cacheBytes = 0;
  function removeCached(key: string) {
    const previous = cache.get(key);
    if (previous) cacheBytes -= previous.bytes;
    cache.delete(key);
  }
  function takeClient(clientId: string) {
    const time = now();
    for (const [key, value] of clients) if (value.until <= time) clients.delete(key);
    const key = clientId.slice(0, 100);
    const current = clients.get(key);
    if (current) {
      if (current.count >= LIMIT) throw new ResourceBusyError("요청이 많습니다. 1분 후 다시 검색하세요.");
      current.count += 1;
    } else {
      if (clients.size >= 500) throw new ResourceBusyError("검색이 혼잡합니다. 잠시 후 다시 검색하세요.");
      clients.set(key, { until: time + 60000, count: 1 });
    }
  }
  async function request(url: URL, headers: Record<string, string> = {}) {
    // Keys only exist in the outbound URL/header. Never return/log URL, headers or upstream errors.
    const identity = url.origin + url.pathname + "?" + [...url.searchParams].filter(([key]) => key !== "crtfcKey").map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join("&");
    const time = now();
    const hit = cache.get(identity);
    if (hit && hit.until > time) return hit;
    removeCached(identity);
    const running = pending.get(identity);
    if (running) return running;
    if ((cooldowns.get(url.hostname) ?? 0) > time) throw new Error("upstream_cooldown");
    if (active >= 6) throw new Error("upstream_busy");
    if (time - budgetStart >= 60000) { budgetStart = time; budget = 0; }
    if (budget >= 120) throw new Error("upstream_budget");
    budget += 1; active += 1;
    const task = (async () => {
      const response = await options.fetch(url.href, { headers: { Accept: "application/json", ...headers }, signal: AbortSignal.timeout(4500), redirect: "error", credentials: "omit" });
      if (response.status === 429 || response.status === 503) {
        cooldowns.set(url.hostname, now() + upstreamRetrySeconds(response.headers.get("retry-after"), now()) * 1000);
        await response.body?.cancel();
        throw new Error("upstream_cooldown");
      }
      const value = await limitedJson(response);
      const shape = recordOf(value);
      const valid = url.hostname === "www.bizinfo.go.kr"
        ? Array.isArray(shape.jsonArray) || Array.isArray(recordOf(shape.jsonArray).item)
        : url.hostname === "dapi.kakao.com"
          ? Array.isArray(shape.documents) && typeof recordOf(shape.meta).is_end === "boolean"
          : url.pathname.endsWith("/search")
            ? typeof shape.total === "number" && Number.isSafeInteger(shape.total) && shape.total >= 0 && (Array.isArray(shape.objectIDs) || shape.objectIDs === null)
            : typeof shape.objectID === "number" && typeof shape.isPublicDomain === "boolean";
      if (!valid) throw new Error("upstream_schema");
      const fetchedAt = new Date(now()).toISOString();
      const bytes = new TextEncoder().encode(JSON.stringify(value)).length;
      while (cache.size > 0 && (cache.size >= MAX_CACHE || cacheBytes + bytes > 8 * 1024 * 1024)) removeCached(cache.keys().next().value as string);
      cacheBytes += bytes;
      cache.set(identity, { value, fetchedAt, bytes, until: now() + 300000 });
      return { value, fetchedAt };
    })().finally(() => { active -= 1; pending.delete(identity); });
    pending.set(identity, task);
    return task;
  }
  async function met(query: string, page: number): Promise<ResourceSearchResult> {
    const url = new URL("https://collectionapi.metmuseum.org/public/collection/v1.1/search");
    url.search = new URLSearchParams({ q: query, hasImages: "true", offset: String((page - 1) * PAGE_SIZE), limit: String(PAGE_SIZE) }).toString();
    const source = await request(url);
    const data = recordOf(source.value);
    if (typeof data.total !== "number" || !Number.isFinite(data.total) || (data.objectIDs !== null && !Array.isArray(data.objectIDs))) throw new Error("upstream_schema");
    const ids = [...new Set(rowsOf(data.objectIDs).filter((id): id is number => typeof id === "number" && Number.isSafeInteger(id) && id > 0 && id < 1000000000))].slice(0, PAGE_SIZE);
    if (data.total > (page - 1) * PAGE_SIZE && ids.length === 0) throw new Error("upstream_schema");
    const items: CreatorResource[] = [];
    let failed = 0;
    // Three detail requests at a time. Unknown rights are excluded even when hasImages=true.
    for (let offset = 0; offset < ids.length; offset += 3) {
      const group = await Promise.all(ids.slice(offset, offset + 3).map(async (id) => {
        try {
          const detail = await request(new URL(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`));
          const item = recordOf(detail.value);
          if (item.objectID !== id || typeof item.isPublicDomain !== "boolean") throw new Error("upstream_schema");
          if (item.isPublicDomain !== true || textOf(item.rightsAndReproduction)) return null;
          const imageUrl = httpsUrl(item.primaryImageSmall, ["images.metmuseum.org"]);
          if (!imageUrl) return null;
          return parseResource({ id: `met:${id}`, provider: "met", title: item.title,
            creator: item.artistDisplayName, sourceUrl: item.objectURL, imageUrl,
            description: [item.culture, item.period, item.medium].map((value) => textOf(value)).filter(Boolean).join(" · "),
            license: "CC0", credit: item.creditLine, dateLabel: item.objectDate, fetchedAt: detail.fetchedAt });
        } catch { failed += 1; return null; }
      }));
      items.push(...group.filter((item): item is CreatorResource => item !== null));
    }
    return { provider: "met", status: failed === ids.length && ids.length > 0 ? "unavailable" : failed ? "partial" : "ready", items,
      page, hasMore: page < 20 && data.total > page * PAGE_SIZE, fetchedAt: source.fetchedAt,
      message: failed ? "일부 자료를 조회하지 못했습니다. 다음 검색에서 다시 확인하세요." : "검색 결과 중 공개 이용과 미리보기가 확인된 자료만 표시합니다. 결과가 적어도 다음 페이지에 자료가 있을 수 있습니다." };
  }
  async function kakao(query: string, page: number, key: string): Promise<ResourceSearchResult> {
    const url = new URL("https://dapi.kakao.com/v3/search/book");
    url.search = new URLSearchParams({ query, page: String(page), size: String(PAGE_SIZE), sort: "accuracy" }).toString();
    const source = await request(url, { Authorization: `KakaoAK ${key}` });
    const data = recordOf(source.value); const meta = recordOf(data.meta);
    if (!Array.isArray(data.documents) || typeof meta.is_end !== "boolean") throw new Error("upstream_schema");
    const items = data.documents.slice(0, PAGE_SIZE).map((raw) => {
      const item = recordOf(raw);
      const sourceUrl = httpsUrl(item.url, ["search.daum.net", "book.daum.net", "m.search.daum.net"]);
      return parseResource({ id: `kakao:${textOf(item.isbn, 100) || sourceUrl.slice(-150)}`, provider: "kakao", title: plainText(item.title, 300),
        sourceUrl, description: plainText(item.contents), creator: rowsOf(item.authors).map((author) => textOf(author, 100)).join(", "),
        credit: textOf(item.publisher, 300), dateLabel: textOf(item.datetime, 10), isbn: textOf(item.isbn, 100),
        license: "metadata-only", fetchedAt: source.fetchedAt });
    }).filter((item): item is CreatorResource => item !== null);
    return { provider: "kakao", status: items.length < Math.min(data.documents.length, PAGE_SIZE) ? "partial" : "ready", items,
      page, hasMore: !meta.is_end && page < 20, fetchedAt: source.fetchedAt,
      message: "카카오 도서 검색 메타데이터입니다. 표지·본문 재배포 또는 각색 권한을 제공하지 않으며, 같은 제목을 같은 작품으로 자동 병합하지 않습니다." };
  }
  async function bizinfo(query: string, page: number, key: string): Promise<ResourceSearchResult> {
    const url = new URL("https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do");
    url.search = new URLSearchParams({ crtfcKey: key, dataType: "json", searchCnt: "100", pageUnit: "100", pageIndex: "1" }).toString();
    const source = await request(url); const data = recordOf(source.value);
    const root = recordOf(data.jsonArray);
    const candidates = Array.isArray(data.jsonArray) ? data.jsonArray : root.item;
    if (!Array.isArray(candidates)) throw new Error("upstream_schema");
    const terms = query.toLocaleLowerCase().split(/\s+/u);
    const mapped = candidates.slice(0, 100).map((raw) => {
      const item = recordOf(raw);
      const title = plainText(item.pblancNm ?? item.title, 300);
      const description = plainText(item.bsnsSumryCn ?? item.description);
      const tags = plainText(item.hashTags);
      if (!terms.every((term) => `${title} ${description} ${tags}`.toLocaleLowerCase().includes(term))) return null;
      const period = textOf(item.reqstBeginEndDe ?? item.reqstDt, 100);
      return parseResource({ id: `bizinfo:${textOf(item.pblancId ?? item.seq, 100)}`, provider: "bizinfo", title, description,
        sourceUrl: bizinfoLink(item.pblancUrl ?? item.link), creator: item.jrsdInsttNm ?? item.author, credit: item.excInsttNm,
        dateLabel: period, deadline: parseDeadline(period), eligibility: textOf(item.trgetNm, 300) || "신청자격 원문 확인",
        license: "metadata-only", fetchedAt: source.fetchedAt });
    }).filter((item): item is CreatorResource => item !== null);
    const unique = [...new Map(mapped.map((item) => [item.id, item])).values()];
    return { provider: "bizinfo", status: "ready", items: unique.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), page,
      hasMore: unique.length > page * PAGE_SIZE, fetchedAt: source.fetchedAt,
      message: "기업마당 최근 최대 100건 안에서 검색합니다. 전체 웹툰 공모전 목록이 아닙니다. 접수 상태·정확한 마감 시간·신청 자격은 원문에서 확인하세요." };
  }
  return {
    describe() {
      const env = options.env();
      return providerAvailability({ kakao: Boolean(env.KAKAO_REST_API_KEY?.trim()), bizinfo: Boolean(env.BIZINFO_API_KEY?.trim()) });
    },
    async search(raw: unknown, clientId = "anonymous"): Promise<ResourceSearchResult> {
      const input = recordOf(raw);
      if (!isProvider(input.provider)) throw new ResourceInputError("지원하지 않는 데이터 제공처입니다.");
      if (typeof input.q !== "string" || input.q.trim().length < 2 || input.q.length > 80 || Array.from(input.q).some((character) => character.charCodeAt(0) < 32)) throw new ResourceInputError("검색어는 2~80자로 입력하세요.");
      const page = input.page === undefined ? 1 : Number(input.page);
      if ((typeof input.page !== "string" && input.page !== undefined && typeof input.page !== "number") || !Number.isInteger(page) || page < 1 || page > 20) throw new ResourceInputError("페이지는 1~20 범위여야 합니다.");
      takeClient(clientId);
      const provider: ResourceProvider = input.provider;
      const result = (status: "not_configured" | "unavailable", message: string): ResourceSearchResult => ({ provider, status, items: [], page, hasMore: false, fetchedAt: null, message });
      const key = options.env()[PROVIDER_KEY[provider]]?.trim() ?? "";
      if (provider !== "met" && !key) return result("not_configured", "서버 API 인증키가 등록되지 않았습니다. 공식 사이트에서 직접 확인할 수 있습니다.");
      try {
        if (provider === "met") return await met(input.q.trim(), page);
        if (provider === "kakao") return await kakao(input.q.trim(), page, key);
        return await bizinfo(input.q.trim(), page, key);
      } catch {
        return result("unavailable", "제공처 응답을 확인하지 못했습니다. 잠시 후 다시 검색하거나 공식 사이트를 이용하세요.");
      }
    },
  };
}
export type ResourceEngine = ReturnType<typeof createResourceEngine>;
