import { Swords, ArrowRight } from "lucide-react";
import { motion } from "motion/react";
import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";

import { METRICS } from "./compare-view-constants";
import { Picker } from "./compare-view-picker";
import { GenreChip } from "./ui/chip";
import { GenreSpectrum } from "./ui/spectrum-bar";

import type { Title } from "@/shared/lib/types";

import { computeCompareVerdict } from "@/shared/lib/compare-verdict";
import { statsAreEstimated } from "@/shared/lib/estimate";
import { STATUS_LABEL } from "@/shared/lib/taxonomy";
import { cn } from "@/shared/lib/utils";
import Link from "@/src/compat/router-link";

// 정적 모드의 목록 응답(/api/titles)은 경량 카드(보러가기 URL·시놉시스 원문·평점분포 생략)라,
// 비교 대상으로 확정된 작품은 상세 엔드포인트로 풀 데이터를 보강한다(요금 매트릭스의 '이동' 링크,
// 시놉시스 원문). API 폴백 모드에서도 같은 shape 의 title 을 돌려주므로 무해한 중복 보강이다.
function useHydratedPick(set: Dispatch<SetStateAction<Title | null>>) {
  return useCallback(
    (picked: Title | null) => {
      set(picked);
      if (!picked) return;
      fetch(`/api/titles/${encodeURIComponent(picked.slug)}`, { cache: "no-store" })
        .then((res) => (res.ok ? (res.json() as Promise<{ title?: Title }>) : null))
        .then((detail) => {
          if (!detail?.title) return;
          set((current) => (current && current.id === picked.id ? { ...current, ...detail.title } : current));
        })
        .catch(() => {
          // 보강 실패 시 경량 카드 그대로 사용(링크만 생략됨)
        });
    },
    [set]
  );
}

export function CompareView({ initialA, initialB }: { initialA?: string; initialB?: string }) {
  const [loading, setLoading] = useState(true);
  const [a, setA] = useState<Title | null>(null);
  const [b, setB] = useState<Title | null>(null);
  const pickA = useHydratedPick(setA);
  const pickB = useHydratedPick(setB);
  // 비교 두 작품 중 하나라도 합성 지표(카카오웹툰·웹소설)면 우열 강조를 끈다(추정값으로 우열 판정 방지)
  const eitherEstimated = !!a && !!b && (statsAreEstimated(a) || statsAreEstimated(b));

  useEffect(() => {
    const controller = new AbortController();

    async function loadInitial() {
      const ids = [initialA, initialB].filter(Boolean).join(",");
      const [exact, popular] = await Promise.all([
        ids
          ? fetch(`/api/titles?ids=${encodeURIComponent(ids)}`, {
              cache: "no-store",
              signal: controller.signal,
            }).then((res) => (res.ok ? res.json() : { items: [] }))
          : Promise.resolve({ items: [] }),
        fetch("/api/titles?sort=popular&limit=8", {
          cache: "no-store",
          signal: controller.signal,
        }).then((res) => (res.ok ? res.json() : { items: [] })),
      ]);

      const exactItems = (exact.items ?? []) as Title[];
      const popularItems = (popular.items ?? []) as Title[];
      const pickExact = (value?: string) =>
        value ? exactItems.find((t) => t.id === value || t.slug === value) ?? null : null;
      const first = pickExact(initialA) ?? popularItems[0] ?? null;
      const second =
        pickExact(initialB) ??
        popularItems.find((t) => t.id !== first?.id) ??
        exactItems.find((t) => t.id !== first?.id) ??
        null;

      pickA(first);
      pickB(second);
      setLoading(false);
    }

    loadInitial().catch((error) => {
      if ((error as Error).name !== "AbortError") {
        setA(null);
        setB(null);
        setLoading(false);
      }
    });

    return () => {
      controller.abort();
    };
  }, [initialA, initialB, pickA, pickB]);

  if (loading) {
    return (
      <div
        className="grid grid-cols-2 gap-6 sm:grid-cols-[1fr_auto_1fr]"
        role="status"
        aria-label="작품 비교 불러오는 중"
      >
        <div className="skeleton aspect-[3/4] rounded-2xl" />
        {/* 스피너 대신 스켈레톤 'VS' 칩 — 양옆 표지와 톤을 맞춰 로딩 상태를 일관되게(DESIGN.md). */}
        <div className="hidden items-center justify-center sm:flex">
          <span className="skeleton size-12 rounded-full" />
        </div>
        <div className="skeleton aspect-[3/4] rounded-2xl" />
      </div>
    );
  }

  return (
    <motion.div 
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className="flex flex-col gap-8"
    >
      <div className="grid min-w-0 grid-cols-1 items-start gap-3 sm:grid-cols-[1fr_auto_1fr] sm:gap-6">
        <Picker value={a} onPick={pickA} onClear={() => setA(null)} />
        <div className="group mx-auto grid size-11 shrink-0 rotate-90 place-items-center rounded-full border border-accent/40 bg-accent-soft text-accent shadow-[0_0_12px_var(--color-accent-soft)] transition-all duration-300 hover:scale-110 hover:bg-accent hover:text-on-accent sm:mx-0 sm:mt-16 sm:rotate-0 sm:hover:rotate-12">
          <Swords size={18} className="transition-transform group-hover:animate-pulse" />
        </div>
        <Picker value={b} onPick={pickB} onClear={() => setB(null)} />
      </div>

      {a && b && (
        <motion.div 
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3 }}
          className="space-y-6"
        >
          {/* 종합 우세 판정 — 추정값이 끼면 우열을 가리지 않는다(별점·조회 보정값 보호) */}
          {!eitherEstimated && <VerdictBanner a={a} b={b} />}

          {/* 주요 수치 대조 패널 */}
          <div className="overflow-hidden rounded-2xl border border-line bg-panel/40 backdrop-blur-sm p-2 sm:p-4">
            <h3 className="mb-4 px-2 text-xs font-bold text-fg-3 uppercase tracking-wider">주요 지표 비교분석</h3>
            <div className="space-y-4">
              {METRICS.map((m, i) => {
                const va = m.get(a);
                const vb = m.get(b);
                const aWin = m.better === "high" && va > vb && !eitherEstimated;
                const bWin = m.better === "high" && vb > va && !eitherEstimated;
                // 추정 가능 지표 셀에 한해 작품별 추정 여부로 ≈ 표기(피커 헤더와 일치).
                const aEst = !!m.estimable && statsAreEstimated(a);
                const bEst = !!m.estimable && statsAreEstimated(b);

                // 비교 바 비중 계산
                let pctA: number;
                let pctB: number;
                if (m.label === "별점") {
                  pctA = (va / 5) * 100;
                  pctB = (vb / 5) * 100;
                } else {
                  const sum = va + vb;
                  if (sum > 0) {
                    pctA = (va / sum) * 100;
                    pctB = (vb / sum) * 100;
                  } else {
                    pctA = 0;
                    pctB = 0;
                  }
                }

                return (
                  <div
                    key={m.label}
                    className={cn(
                      "flex flex-col gap-2 rounded-xl p-3 transition-colors hover:bg-card/45",
                      i % 2 === 1 && "bg-card/20"
                    )}
                  >
                    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                      {/* Left value (A) */}
                      <div className={cn("text-right numeral text-lg font-bold transition-all", aWin ? "text-accent text-xl" : "text-fg-2")}>
                        {aEst && <span className="text-fg-3" aria-hidden>≈</span>}
                        {m.fmt(va)}
                      </div>

                      {/* Metric Label */}
                      <div className="w-24 text-center text-xs font-semibold text-fg-3">{m.label}</div>

                      {/* Right value (B) */}
                      <div className={cn("text-left numeral text-lg font-bold transition-all", bWin ? "text-accent text-xl" : "text-fg-2")}>
                        {bEst && <span className="text-fg-3" aria-hidden>≈</span>}
                        {m.fmt(vb)}
                      </div>
                    </div>

                    {/* 양방향 비교 바 그래프 (Visual Spectrum Chart) */}
                    <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-line/20 px-2.5 sm:px-6">
                      <div className="flex w-full h-full gap-0.5">
                        {/* A Bar */}
                        <div className="flex justify-end flex-1">
                          <div 
                            className={cn(
                              "h-full rounded-l-full transition-all duration-500 origin-right",
                              aWin ? "bg-accent" : "bg-fg-3/50"
                            )}
                            style={{ width: `${pctA}%` }}
                          />
                        </div>
                        {/* Center Gap */}
                        <div className="w-1 bg-transparent" />
                        {/* B Bar */}
                        <div className="flex justify-start flex-1">
                          <div 
                            className={cn(
                              "h-full rounded-r-full transition-all duration-500 origin-left",
                              bWin ? "bg-accent" : "bg-fg-3/50"
                            )}
                            style={{ width: `${pctB}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {eitherEstimated && (
            <p className="text-center text-[0.68rem] text-fg-3 leading-relaxed">
              * 비교 작품 중 카카오웹툰·웹소설은 별점·조회 등이 보정된 추정값이라 우열 그래프 표시를 생략했어요.
            </p>
          )}

          {/* 에디토리얼 요약 및 플랫폼 가용성 가격 비교 표 */}
          <div className="grid gap-6 md:grid-cols-2">
            {/* 작품 A 디테일 */}
            <div className="rounded-2xl border border-line bg-card/30 p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-line/45 pb-3">
                <span className="text-xs font-bold text-accent">LEFT COLUMN</span>
                <span className="text-xs text-fg-3">{STATUS_LABEL[a.status]}</span>
              </div>
              <CompareExtra t={a} align="left" />
              <ComparePlatformPrice t={a} />
            </div>

            {/* 작품 B 디테일 */}
            <div className="rounded-2xl border border-line bg-card/30 p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-line/45 pb-3">
                <span className="text-xs font-bold text-accent">RIGHT COLUMN</span>
                <span className="text-xs text-fg-3">{STATUS_LABEL[b.status]}</span>
              </div>
              <CompareExtra t={b} align="left" />
              <ComparePlatformPrice t={b} />
            </div>
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}

function VerdictBanner({ a, b }: { a: Title; b: Title }) {
  const verdict = computeCompareVerdict(a, b);
  if (verdict.total === 0) return null;

  const tie = verdict.winner === "tie";
  const winnerTitle = verdict.winner === "a" ? a : verdict.winner === "b" ? b : null;
  const winnerWins = verdict.winner === "a" ? verdict.aWins : verdict.bWins;
  const loserWins = verdict.winner === "a" ? verdict.bWins : verdict.aWins;

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-accent/35 bg-accent-soft/40 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="eyebrow text-accent">종합 우세</p>
        {tie ? (
          <p className="mt-1 text-pretty text-sm font-semibold text-fg">
            막상막하예요 — 주요 지표 {verdict.total}개가 {verdict.aWins} : {verdict.bWins}로 팽팽합니다.
          </p>
        ) : (
          <p className="mt-1 text-pretty text-sm font-semibold text-fg">
            <span className="text-accent">{winnerTitle?.title}</span>이(가) 주요 지표 {verdict.total}개 중{" "}
            <span className="numeral">{winnerWins}</span>개에서 앞섭니다
            <span className="font-normal text-fg-3">
              {" "}
              ({winnerWins} : {loserWins}
              {verdict.ties > 0 ? `, 무승부 ${verdict.ties}` : ""})
            </span>
            .
          </p>
        )}
      </div>
      <div className="flex shrink-0 flex-wrap gap-1.5">
        {(verdict.winner === "b" ? verdict.bLabels : verdict.aLabels).slice(0, 4).map((label) => (
          <span
            key={`w-${label}`}
            className="rounded-full border border-accent/40 bg-card/60 px-2.5 py-0.5 text-[0.7rem] font-medium text-accent"
          >
            {label} 우세
          </span>
        ))}
      </div>
    </div>
  );
}

const PLATFORM_NAMES: Record<string, string> = {
  "naver-webtoon": "네이버웹툰",
  "naver-series": "네이버시리즈",
  "kakao-webtoon": "카카오웹툰",
  "kakao-page": "카카오페이지",
  lezhin: "레진코믹스",
  ridi: "리디북스",
  munpia: "문피아",
  joara: "조아라",
  novelpia: "노벨피아",
  bomtoon: "봄툰",
  toptoon: "탑툰",
  toomics: "투믹스",
  kyobo: "교보문고",
  yes24: "예스24",
  postype: "포스타입",
  mrblue: "미스터블루",
  bookcube: "북큐브",
  onestory: "원스토리",
};

const PRICING_BADGES: Record<string, { label: string; className: string }> = {
  free: { label: "무료 연재", className: "border-good/30 bg-[oklch(0.8_0.15_150/0.08)] text-good" },
  "wait-free": { label: "기다무 무료", className: "border-accent/30 bg-accent-soft/40 text-accent" },
  paid: { label: "유료 소장/대여", className: "border-line-strong bg-canvas/60 text-fg-2" },
};

function ComparePlatformPrice({ t }: { t: Title }) {
  return (
    <div className="rounded-xl border border-line/50 bg-canvas/30 p-3 space-y-2">
      <p className="text-[0.68rem] font-bold text-fg-3 uppercase tracking-wider mb-2">어디서 봐 (요금 매트릭스)</p>
      <div className="divide-y divide-line/35">
        {t.availability.map((av) => {
          const platName = PLATFORM_NAMES[av.platformId] ?? av.platformId;
          const badge = PRICING_BADGES[av.pricing] ?? { label: av.pricing, className: "border-line bg-card" };
          return (
            <div key={av.platformId} className="flex items-center justify-between py-2 first:pt-0 last:pb-0 text-xs">
              <span className="font-semibold text-fg">{platName}</span>
              <div className="flex items-center gap-2">
                <span className={cn("rounded border px-1.5 py-0.5 text-[0.62rem] font-medium uppercase tracking-wide", badge.className)}>
                  {badge.label}
                </span>
                {av.url && (
                  <a
                    href={`/api/go/${av.platformId}?to=${encodeURIComponent(av.url)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-0.5 text-[0.62rem] text-fg-3 hover:text-accent font-semibold transition-colors"
                  >
                    이동 <ArrowRight size={10} />
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CompareExtra({ t, align }: { t: Title; align: "left" | "right" }) {
  return (
    <div className={cn("flex flex-col gap-3", align === "right" ? "items-end" : "items-start")}>
      <GenreSpectrum genres={t.genres} height={5} />
      <div className={cn("flex flex-wrap gap-1.5", align === "right" && "justify-end")}>
        {t.genres.map((g) => (
          <GenreChip key={g} genre={g} size="sm" />
        ))}
      </div>
      <p className="text-xs text-fg-3 leading-relaxed mt-1 line-clamp-3">
        {t.synopsis}
      </p>
      <div className="w-full pt-1">
        <Link href={`/title/${t.slug}`} className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:text-accent-2 transition-colors">
          작품 상세 정보 바로가기 <ArrowRight size={12} />
        </Link>
      </div>
    </div>
  );
}
