import { ChevronUp, ChevronDown, Minus, HelpCircle, Sparkles } from "lucide-react";
import { useState } from "react";

import { AdultOverlay } from "./adult-overlay";
import { PlatformTags } from "./availability";
import { CountUp } from "./count-up";
import { CoverImage } from "./cover-image";
import { GenreChip } from "./ui/chip";
import { RatingInline } from "./ui/stars";

import { statsAreEstimated } from "@/shared/lib/estimate";
import { useT } from "@/shared/lib/i18n";
import { type RankedTitle, explainScore, type RankAxis } from "@/shared/lib/ranking";
import { TYPE_LABEL, STATUS_LABEL } from "@/shared/lib/taxonomy";
import { cn, formatCount } from "@/shared/lib/utils";
import Link from "@/src/compat/router-link";

// 미니 표지 썸네일
export function MiniPoster({
  title,
  className,
}: {
  title: { title: string; cover: [string, string]; type: string; coverImage?: string; ageRating?: string };
  className?: string;
}) {
  return (
    <span
      className={cn(
        "relative grid aspect-[3/4] place-items-center overflow-hidden rounded-md border border-[oklch(0.95_0.01_85/0.14)] font-display text-sm font-bold text-[oklch(0.97_0.012_85)] shadow-[inset_0_1px_0_oklch(1_0_0/0.12)]",
        title.type === "webnovel" && "font-serif",
        className
      )}
      style={{
        background: `linear-gradient(145deg, color-mix(in oklch, ${title.cover[0]} 88%, oklch(0.24 0.012 66)), color-mix(in oklch, ${title.cover[1]} 82%, oklch(0.15 0.008 70)))`,
      }}
    >
      {title.coverImage ? (
        <CoverImage
          src={title.coverImage}
          alt=""
          fallback={title.title.charAt(0)}
          className="absolute inset-0 size-full object-cover contrast-[1.03] saturate-[1.04]"
        />
      ) : (
        <span className="relative">{title.title.charAt(0)}</span>
      )}
      <span className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_top,oklch(0.13_0.012_70/0.62),transparent_58%)]" />
      <span className="pointer-events-none absolute inset-x-1.5 top-1.5 h-px bg-[oklch(0.95_0.01_85/0.24)]" />
      {title.ageRating === "19" && <AdultOverlay compact />}
    </span>
  );
}

// 목록 진입 스태거 — 첫 화면 분량(12행)까지만 순차 등장시키고, 이후 행은 즉시 표시한다.
// 200행짜리 긴 리스트에서 아래 행들이 하염없이 늦게 나타나는 느낌을 방지(캡 밖은 애니메이션 자체 생략).
export const RANK_ENTRY_STAGGER_CAP = 12;
export const RANK_ENTRY_STAGGER_STEP_MS = 45;
export const RANK_ENTRY_ANIMATION_CLASS =
  "motion-safe:[animation:fade-up_0.45s_var(--ease-out-expo)_both]";

// Top3 메달 글로 톤 — 금/은/동. rank-medal-pulse 키프레임이 --medal-glow 로 소비한다.
const MEDAL_GLOW: Record<number, string> = {
  1: "oklch(0.84 0.16 85 / 0.5)", // 금
  2: "oklch(0.85 0.02 250 / 0.4)", // 은
  3: "oklch(0.7 0.12 55 / 0.45)", // 동
};

function Delta({ delta }: { delta: number }) {
  if (delta > 0)
    return (
      <span className="flex items-center text-[0.7rem] font-semibold text-good tnum">
        <ChevronUp size={12} strokeWidth={3} />
        {delta}
      </span>
    );
  if (delta < 0)
    return (
      <span className="flex items-center text-[0.7rem] font-semibold text-bad tnum">
        <ChevronDown size={12} strokeWidth={3} />
        {Math.abs(delta)}
      </span>
    );
  return <Minus size={12} className="text-fg-3" />;
}

export function RankRow({
  ranked,
  axis = "popular",
  metric,
  className,
  entryIndex,
}: {
  ranked: RankedTitle;
  axis?: RankAxis;
  metric?: (t: RankedTitle["title"]) => {
    label: string;
    value: string;
    /** 정수 지표(트렌드·몰입·완독률)일 때 진입 카운트업용 원시값. 없으면 문자열 그대로 표시. */
    countTo?: number;
    countSuffix?: string;
  };
  className?: string;
  /** 목록 진입 스태거 인덱스 — 캡(12) 미만이면 순차 fade-up + 지표 카운트업. */
  entryIndex?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const { title, rank, delta } = ranked;
  const top3 = rank <= 3;
  const m = metric?.(title);
  const live = ranked.evidence?.liveMatched ? ranked.evidence : null;
  const t = useT();
  // 추정 작품의 비-별점 지표(조회·관심·완독률·몰입·트렌드)엔 ≈ 표시.
  // 별점 축(rating·hidden)은 RatingInline이 이미 ≈를 붙이므로 중복 표기를 피한다.
  const estimated = statsAreEstimated(title);
  const metricEstimated = estimated && axis !== "rating" && axis !== "hidden";
  // 진입 스태거 대상(첫 화면 분량)만 모션·카운트업 — 캡 밖 행은 즉시 정적 표시(rAF 낭비 방지).
  const staggered = entryIndex !== undefined && entryIndex < RANK_ENTRY_STAGGER_CAP;

  return (
    <div
      className={cn(
        "group/row flex flex-col rounded-xl border border-line/45 bg-card/35 transition-all duration-150 hover:border-line hover:bg-card mb-2 last:mb-0 overflow-hidden",
        staggered && RANK_ENTRY_ANIMATION_CLASS,
        expanded && "border-accent/40 bg-card shadow-sm",
        className
      )}
      style={staggered ? { animationDelay: `${entryIndex * RANK_ENTRY_STAGGER_STEP_MS}ms` } : undefined}
    >
      {/* Main Row Content — 좁은 화면(320px)에선 표지/메트릭 칼럼을 좁히고 gap을 줄여 제목 폭을 확보 */}
      <div className="grid grid-cols-[2.5rem_2.25rem_1fr_auto] items-center gap-2 px-2 py-2.5 sm:grid-cols-[2.75rem_2.5rem_1fr_auto] sm:gap-4 sm:px-3">
        {/* 인덱스 넘버럴 */}
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          title={t("ranking.detailTitle")}
          className={cn(
            "relative flex min-h-11 flex-col items-center justify-center rounded-xl border px-1.5 py-1 transition-all cursor-pointer hover:border-accent hover:bg-accent-soft/30",
            top3 ? "border-accent/45 bg-accent/10 text-accent" : "border-line/70 bg-canvas/40 text-fg-3",
            // Top3 메달 글로 — 은은한 무한 맥동. ring 도 box-shadow 라 확장 시(ring 표시)엔 꺼서 충돌 회피.
            top3 && !expanded && "motion-safe:[animation:rank-medal-pulse_2.8s_ease-in-out_infinite]",
            expanded && "border-accent bg-accent-soft/40 ring-2 ring-accent/10"
          )}
          style={top3 ? ({ "--medal-glow": MEDAL_GLOW[rank] } as React.CSSProperties) : undefined}
        >
          <span
            className={cn(
              "numeral leading-none",
              top3 ? "text-3xl text-accent" : "text-2xl text-fg-3"
            )}
          >
            {rank}
          </span>
          <Delta delta={delta} />
          {top3 && (
            <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-accent shadow-[0_0_0_2px_oklch(0.205_0.01_66)]" />
          )}
        </button>

        <Link href={`/title/${title.slug}`} className="w-9 sm:w-10">
          <MiniPoster title={title} className="w-9 transition-transform group-hover/row:scale-105 sm:w-10" />
        </Link>

        <Link href={`/title/${title.slug}`} className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-fg transition-colors group-hover/row:text-accent">
              {title.title}
            </h3>
            <span className="shrink-0 rounded-full border border-line bg-canvas/45 px-1.5 py-0.5 text-[0.6rem] font-medium uppercase tracking-wide text-fg-3">
              {TYPE_LABEL[title.type]}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            <RatingInline value={title.stats.ratingAvg} estimated={statsAreEstimated(title)} size="xs" />
            <span className="hidden text-line-strong sm:inline">·</span>
            <span className="hidden text-xs text-fg-3 sm:inline">
              {title.author} · {STATUS_LABEL[title.status]}
            </span>
            <PlatformTags availability={title.availability} max={2} />
            {live && (
              <span className="rounded-md border border-good/30 bg-[oklch(0.8_0.15_150/0.1)] px-1.5 py-0.5 text-[0.65rem] font-medium text-good">
                LIVE #{live.liveRank} · {live.livePlatform}
              </span>
            )}
          </div>
          <p className="mt-1 line-clamp-1 max-w-3xl text-xs leading-relaxed text-fg-3 sm:line-clamp-2">
            {title.synopsis}
          </p>
        </Link>

        <div className="flex items-center gap-2.5 sm:gap-3">
          <div className="hidden items-center gap-1.5 md:flex">
            {title.genres.slice(0, 2).map((g, index) => (
              <GenreChip key={`${g}-${index}`} genre={g} size="sm" className="hidden lg:inline-flex first:inline-flex" />
            ))}
          </div>
          
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            title={t("ranking.detailTitle")}
            className={cn(
              "flex items-center gap-2 rounded-md border text-right px-2 py-1 transition-all cursor-pointer hover:border-accent hover:bg-accent-soft/20",
              expanded ? "border-accent/40 bg-accent-soft/20" : "border-line/70 bg-canvas/30"
            )}
          >
            <div className="text-right">
              <div className="numeral tnum text-sm text-fg font-semibold">
                {metricEstimated && <span className="text-fg-3" aria-hidden>≈</span>}
                {/* 정수 지표 + 스태거 구간이면 카운트업(첫 화면만 — 캡 밖 행은 정적 표시). */}
                {m?.countTo !== undefined && staggered ? (
                  <CountUp value={m.countTo} suffix={m.countSuffix ?? ""} duration={0.85} />
                ) : m ? (
                  m.value
                ) : (
                  formatCount(title.stats.views)
                )}
              </div>
              <div className="text-[0.62rem] text-fg-3">{m ? m.label : t("ranking.metric.views")}</div>
            </div>
            <div className="flex flex-col items-center justify-center border-l border-line/50 pl-2 text-fg-3 hover:text-accent">
              <HelpCircle size={13} className={cn("transition-transform duration-200", expanded && "rotate-180 text-accent")} />
              <span className="text-[0.55rem] font-semibold mt-0.5">{t("ranking.why")}</span>
            </div>
          </button>
        </div>
      </div>

      {/* Expanded Score breakdown panel */}
      {expanded && (
        <div className="border-t border-line/45 bg-canvas/40 px-3 py-3 text-xs rounded-b-xl animate-fade-in">
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1 font-semibold text-accent text-[0.7rem] uppercase tracking-wider">
                <Sparkles size={11} />
                {t("ranking.breakdownTitle")}
              </span>
              <span className="font-mono text-[10px] text-fg-3">
                {t("ranking.totalScore")}: <strong className="text-fg font-semibold">{ranked.score.toFixed(2)}</strong>
              </span>
            </div>
            
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {explainScore(title, axis).map((factor, i) => (
                <div key={i} className="rounded-lg border border-line bg-card/80 p-2">
                  <div className="text-[0.62rem] text-fg-3 leading-snug">{factor.label}</div>
                  <div className="mt-0.5 font-mono text-[11px] font-bold text-fg-2">{factor.value}</div>
                </div>
              ))}
            </div>
            
            <p className="text-[0.65rem] text-fg-3 leading-relaxed">
              {t("ranking.breakdownDescription")}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
