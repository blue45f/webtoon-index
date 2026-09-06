import { FunctionSquare, ShieldAlert, ShieldCheck } from "lucide-react";

import { CountUp } from "./count-up";
import { confidenceTone } from "./ranking-board-utils";
import { PlatformMark } from "./visual-marks";

import type { RankingInsights, RankingMeta } from "./ranking-board-types";

import { genreColor, genreTint, spectrumGradient } from "@/shared/lib/genre-color";
import { PLATFORMS } from "@/shared/lib/platforms";
import { cn } from "@/shared/lib/utils";


export function SignalWorkbench({
  insights,
  meta,
}: {
  insights: RankingInsights | null;
  meta: RankingMeta | null;
}) {
  const genres = insights?.topGenres.map((g) => g.name) ?? [];
  const gradient = spectrumGradient(genres);
  const reliability = meta?.reliability;
  const TrustIcon = reliability?.level === "low" ? ShieldAlert : ShieldCheck;
  const trustTone = confidenceTone(reliability?.level);

  return (
    <section className="relative overflow-hidden rounded-2xl border border-line bg-gradient-to-br from-card to-panel p-4 surface-hl">
      <div className="absolute inset-x-0 top-0 h-1" style={{ background: gradient }} />
      <div className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-line/70 bg-canvas/55 px-2.5 py-1 text-xs font-medium text-fg-2">
        <FunctionSquare size={12} className="text-accent" />
        <span>신호 관측대</span>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <div className="min-w-0 rounded-lg border border-line bg-canvas/35 p-3">
          <p className="eyebrow text-[0.58rem] text-fg-3">CONFIDENCE</p>
          <div className="mt-1 flex items-end gap-2">
            <TrustIcon size={18} className={cn("mb-0.5 shrink-0", trustTone)} />
            <p className={cn("font-display text-2xl font-bold leading-none tnum", trustTone)}>
              {/* 신뢰도 카운트업 — 값이 바뀔 때만 재카운트(폴링 시 동일 값이면 정지 상태 유지). */}
              <CountUp value={reliability?.confidence ?? 0} duration={0.9} />
            </p>
            <span className="pb-0.5 text-xs text-fg-3">/100</span>
          </div>
          <p className="mt-1 text-xs text-fg-3">{reliability?.label ?? "신호 대기"}</p>
        </div>
        <div className="min-w-0">
          <p className="eyebrow text-[0.58rem] text-fg-3">SOURCE</p>
          {/* 스냅샷 산식 전용 운영 — 외부 실시간 소스는 폐기됨. */}
          <p className="mt-1 truncate text-sm font-semibold text-fg">스냅샷 산식</p>
          <p className="mt-0.5 text-xs text-fg-3">{reliability?.fallbackReason ?? "산식 기반 폴백"}</p>
        </div>
        <div className="min-w-0">
          <p className="eyebrow text-[0.58rem] text-fg-3">RISING</p>
          <p className="mt-1 truncate text-sm font-semibold text-fg">{insights?.rising?.title ?? "대기 중"}</p>
          <p className="mt-0.5 text-xs text-fg-3">
            {insights?.rising ? `#${insights.rising.rank} · ${insights.rising.delta > 0 ? "+" : ""}${insights.rising.delta}` : "상승 신호 없음"}
          </p>
        </div>
        <div className="min-w-0">
          <p className="eyebrow text-[0.58rem] text-fg-3">SPREAD</p>
          <p className="mt-1 font-display text-xl font-bold text-fg tnum">
            <CountUp value={insights?.scoreSpread ?? 0} duration={0.9} />
          </p>
          <p className="mt-0.5 text-xs text-fg-3">1위와 하위권 점수 간격</p>
        </div>
      </div>

      <div className="mt-4 border-t border-line pt-4">
        <p className="eyebrow mb-2 text-[0.58rem] text-fg-3">EVIDENCE</p>
        <div className="flex flex-wrap gap-1.5">
          {(reliability?.basis ?? ["랭킹 신호 계산 대기"]).map((item) => (
            <span
              key={item}
              className="rounded-md border border-line/80 bg-canvas/55 px-2 py-1 text-[0.7rem] text-fg-2"
            >
              {item}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-[1.15fr_0.85fr]">
        <div>
          <div className="flex h-2 overflow-hidden rounded-full bg-raised">
            {(insights?.topGenres.length ? insights.topGenres : [{ name: "판타지", share: 100, count: 0 }]).map(
              (genre, index) => (
              <span
                key={`${genre.name}-${index}`}
                className="h-full"
                style={{
                  width: `${Math.max(genre.share, 6)}%`,
                  backgroundColor: genreColor(genre.name, 0.72),
                }}
              />
              )
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {insights?.topGenres.slice(0, 5).map((genre, index) => (
              <span
                key={`${genre.name}-${index}`}
                className="rounded-md border px-2 py-1 text-[0.7rem] text-fg-2"
                style={{
                  borderColor: genreColor(genre.name, 0.42),
                  backgroundColor: genreTint(genre.name, 0.14),
                }}
              >
                {genre.name} {genre.share}%
              </span>
            ))}
          </div>
        </div>
        <div className="mt-1 flex flex-wrap items-start gap-1.5 lg:justify-end">
          {insights?.platformMix.map((platform) => (
            <span
              key={platform.id}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-canvas/50 px-2 py-1 text-[0.7rem] text-fg-2"
            >
              <PlatformMark platform={PLATFORMS[platform.id]} size="sm" />
              {platform.label} {platform.share}%
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
