import type { RankedTitle } from "@/shared/lib/ranking";
import type { PlatformId } from "@/shared/lib/types";

export type View = "list" | "poster" | "compact";
export type LoadState = "loading" | "ready" | "refreshing" | "error";

export interface RankingMeta {
  generatedAt: string;
  refreshSeconds: number;
  total: number;
  source: "live-api" | "formula-api";
  availablePlatforms?: PlatformId[];
  live: {
    enabled: boolean;
    day: string | null;
    fetchedAt: string | null;
    nextRefreshAt: string | null;
    ttlSeconds: number | null;
    timeoutMs: number | null;
    fetched: number;
    matched: number;
    sources: string[];
    sourceStatuses: {
      name: string;
      ok: boolean;
      fetched: number;
      latencyMs: number;
      message: string;
    }[];
  };
  statusSignals: {
    enabled: boolean;
    fetchedAt: string | null;
    ttlSeconds: number | null;
    timeoutMs: number | null;
    fetched: number;
    matched: number;
    overridden: number;
    sources: string[];
    sourceStatuses: {
      name: string;
      ok: boolean;
      fetched: number;
      latencyMs: number;
      message: string;
    }[];
  };
  reliability: {
    confidence: number;
    level: "high" | "medium" | "low";
    label: string;
    fallbackReason: string | null;
    estimatedCount: number;
    estimatedShare: number;
    liveCoverage: number;
    okSources: number;
    sourceCount: number;
    liveTtlSeconds: number | null;
    timeoutMs: number | null;
    basis: string[];
  };
}

export interface RankingInsights {
  topGenres: { name: string; count: number; share: number }[];
  platformMix: { id: PlatformId; label: string; color: string; count: number; share: number }[];
  scoreSpread: number;
  leader: { title: string; rank: number; score: number } | null;
  rising: { title: string; delta: number; rank: number } | null;
  liveCoverage: number;
}

export interface RankingResponse {
  items: RankedTitle[];
  meta: RankingMeta;
  insights: RankingInsights;
}
