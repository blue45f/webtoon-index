import { parseWorkspace, STORY_FIELDS } from "./creator-resources";

import type { CreatorResource, CreatorWorkspace, ResourceProvider } from "./creator-resources";

export interface ProviderAvailability {
  provider: ResourceProvider;
  availability: "keyless" | "configured" | "not_configured";
}
/** Public configuration summary only; it is not a health check or a credential endpoint. */
export function providerAvailability(configured: { kakao: boolean; bizinfo: boolean }): ProviderAvailability[] {
  return [
    { provider: "met", availability: "keyless" },
    { provider: "kakao", availability: configured.kakao ? "configured" : "not_configured" },
    { provider: "bizinfo", availability: configured.bizinfo ? "configured" : "not_configured" },
  ];
}
export function parseProviderAvailability(value: unknown): ProviderAvailability[] | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const entries: ProviderAvailability[] = [];
  for (const raw of value) {
    if (raw === null || typeof raw !== "object") return null;
    const item = raw as Record<string, unknown>;
    if (item.provider !== "met" && item.provider !== "kakao" && item.provider !== "bizinfo") return null;
    if (item.availability !== "keyless" && item.availability !== "configured" && item.availability !== "not_configured") return null;
    if ((item.provider === "met") !== (item.availability === "keyless")) return null;
    if (entries.some((entry) => entry.provider === item.provider)) return null;
    entries.push({ provider: item.provider, availability: item.availability });
  }
  return entries;
}
/** Non-destructive restore: current resources/filled draft fields win; completion steps are unioned. */
export function mergeCreatorWorkspaces(current: CreatorWorkspace, incoming: CreatorWorkspace): CreatorWorkspace {
  const local = parseWorkspace(JSON.stringify(current));
  const backup = parseWorkspace(JSON.stringify(incoming));
  const saved = new Map(local.saved.map((item) => [item.id, item]));
  for (const item of backup.saved) if (!saved.has(item.id)) saved.set(item.id, item);
  const story = { ...local.story };
  for (const field of STORY_FIELDS) if (!story[field]?.trim()) story[field] = backup.story[field] ?? "";
  // Validate the combined size before writing. Never silently drop overflowed user data.
  return parseWorkspace(JSON.stringify({ version: 1, saved: [...saved.values()], story,
    checks: [...new Set([...local.checks, ...backup.checks])],
  }));
}
export type BoardSort = "saved" | "recent" | "title" | "deadline";
export type DeadlineFilter = "all" | "upcoming" | "expired" | "unknown";
export interface BoardQuery {
  query?: string;
  provider?: ResourceProvider | "all";
  sort?: BoardSort;
  deadline?: DeadlineFilter;
}
export function selectBoardResources(items: readonly CreatorResource[], options: BoardQuery, now = new Date()): CreatorResource[] {
  const terms = (options.query ?? "").normalize("NFKC").toLocaleLowerCase("ko").trim().split(/\s+/u).filter(Boolean);
  const today = new Date(now.getTime() + 9 * 3600000).toISOString().slice(0, 10);
  const selected = items.filter((item) => {
    if (options.provider && options.provider !== "all" && options.provider !== item.provider) return false;
    if (options.deadline && options.deadline !== "all") {
      if (item.provider !== "bizinfo") return false;
      if (options.deadline === "unknown" ? Boolean(item.deadline) : !item.deadline) return false;
      if (options.deadline === "upcoming" && item.deadline! < today) return false;
      if (options.deadline === "expired" && item.deadline! >= today) return false;
    }
    const haystack = [item.title, item.creator, item.description, item.credit, item.isbn, item.eligibility]
      .filter(Boolean).join(" ").normalize("NFKC").toLocaleLowerCase("ko");
    return terms.every((term) => haystack.includes(term));
  });
  if (options.sort === "saved" || !options.sort) return selected.reverse();
  return selected.sort((a, b) => {
    if (options.sort === "title") return a.title.localeCompare(b.title, "ko") || a.id.localeCompare(b.id);
    if (options.sort === "deadline") {
      const order = (a.deadline ?? "9999-12-31").localeCompare(b.deadline ?? "9999-12-31");
      if (order) return order;
    }
    return Date.parse(b.fetchedAt) - Date.parse(a.fetchedAt) || a.id.localeCompare(b.id);
  });
}
/** Retry-After may be seconds or an HTTP date. Always bound per-process backoff. */
export function upstreamRetrySeconds(value: string | null, now: number): number {
  if (!value?.trim()) return 30;
  const input = value.trim();
  const seconds = /^\d+$/u.test(input) ? Number(input) : (Date.parse(input) - now) / 1000;
  return Number.isFinite(seconds) ? Math.min(120, Math.max(1, Math.ceil(seconds))) : 30;
}
