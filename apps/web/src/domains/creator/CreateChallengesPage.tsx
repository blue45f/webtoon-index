// 창작 챌린지 — 진행중 주제 카드(D-day) + 챌린지별 참여작 그리드 (툰스푼 창작 작업실 스타일).
import { useFx } from "@toonspectrum/core/fx";
import { ArrowLeft, CalendarClock, PenLine, Sparkles, Trophy, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { WorkCard, WorkGridSkeleton } from "./creator-community-ui";
import { buildStudioHref } from "./creator-studio-links";

import { CountUp } from "@/shared/components/count-up";
import { RevealOnScroll } from "@/shared/components/reveal-on-scroll";
import { Container } from "@/shared/components/section";
import { ShimmerTitle } from "@/shared/components/shimmer-title";
import { buttonClass } from "@/shared/components/ui/button-utils";
import { cn, formatCount } from "@/shared/lib/utils";
import Link from "@/src/compat/router-link";
import { ErrorState } from "@/src/components/error-state";
import { useDocumentTitle } from "@/src/hooks/use-document-title";
import {
  challengeDday,
  getChallenge,
  listChallenges,
  type ChallengeSummary,
  type WorkSummary,
} from "@/src/infrastructure/creator-client";


// 마감 D-day 칩 — 마감 임박(3일 이내)은 경고 톤.
function DdayChip({ endsAt }: { endsAt: string | null }) {
  const dday = challengeDday(endsAt);
  if (dday == null) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-line bg-raised px-1.5 py-0.5 text-[0.7rem] font-medium leading-none text-fg-2">
        <CalendarClock size={11} /> 상시
      </span>
    );
  }
  if (dday < 0) {
    return (
      <span className="inline-flex items-center rounded-md border border-line bg-raised px-1.5 py-0.5 text-[0.7rem] font-medium leading-none text-fg-3">
        종료
      </span>
    );
  }
  const urgent = dday <= 3;
  return (
    <span
      className={cn(
        "numeral inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[0.7rem] font-bold leading-none",
        urgent
          ? "border-[color:oklch(0.82_0.15_80/0.3)] bg-[oklch(0.82_0.15_80/0.12)] text-warn"
          : "border-accent/30 bg-accent-soft text-accent"
      )}
    >
      <CalendarClock size={11} />
      {dday === 0 ? "오늘 마감" : `D-${dday}`}
    </span>
  );
}

// 챌린지 카드 — 선택하면 아래에 참여작 그리드.
function ChallengeCard({
  challenge,
  active,
  onSelect,
}: {
  challenge: ChallengeSummary;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={cn(
        "sheen-sweep group relative flex h-full w-full flex-col rounded-2xl border p-4 text-left transition-[transform,background-color,border-color,box-shadow] duration-200 ease-out-expo hover:-translate-y-0.5 active:scale-[0.985]",
        active
          ? "border-accent/60 bg-accent-soft/40 shadow-[0_10px_30px_-14px_oklch(0.72_0.185_42/0.6)]"
          : "border-line bg-panel/30 hover:border-accent/40 hover:bg-panel/50"
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-accent">
          <Trophy size={12} className="transition-transform duration-200 ease-out-expo group-hover:-rotate-6 group-hover:scale-110" />
          {challenge.state === "ended" ? "지난 챌린지" : "주간 챌린지"}
        </span>
        <DdayChip endsAt={challenge.endsAt} />
      </div>
      <h3 className="mt-2 text-lg font-bold leading-tight text-fg transition-colors group-hover:text-accent">{challenge.title}</h3>
      <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-fg-3">{challenge.theme}</p>
      <span className="mt-3 inline-flex items-center gap-1 text-[0.72rem] text-fg-2">
        <Users size={12} />
        참여작 <span className="numeral font-semibold">{formatCount(challenge.entries)}</span>
      </span>
    </button>
  );
}

export function CreateChallengesPage() {
  useDocumentTitle("창작 챌린지");
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedKey = searchParams.get("c") ?? "";

  const [challenges, setChallenges] = useState<ChallengeSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [entries, setEntries] = useState<WorkSummary[]>([]);
  const [entriesLoading, setEntriesLoading] = useState(false);
  const fx = useFx();

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    listChallenges(controller.signal)
      .then((result) => {
        if (alive) setChallenges(result);
      })
      .catch((err: unknown) => {
        if (!alive || controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "챌린지 목록을 불러오지 못했습니다.");
        setChallenges([]);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [reloadKey]);

  const ongoing = challenges.filter((c) => c.state !== "ended");
  const ended = challenges.filter((c) => c.state === "ended");
  const selected =
    challenges.find((c) => c.slug === selectedKey || c.id === selectedKey) ?? ongoing[0] ?? challenges[0] ?? null;

  // 선택 챌린지의 참여작 로드 — slug 변경 시에만 재요청.
  const selectedSlug = selected?.slug ?? "";
  useEffect(() => {
    if (!selectedSlug) {
      setEntries([]);
      return;
    }
    let alive = true;
    const controller = new AbortController();
    setEntriesLoading(true);
    getChallenge(selectedSlug, controller.signal)
      .then((detail) => {
        if (alive) setEntries(detail.works);
      })
      .catch(() => {
        if (alive) setEntries([]);
      })
      .finally(() => {
        if (alive) setEntriesLoading(false);
      });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [selectedSlug]);

  const select = (challenge: ChallengeSummary) => {
    const params = new URLSearchParams(searchParams);
    params.set("c", challenge.slug);
    setSearchParams(params, { replace: true });
  };

  return (
    <Container size="wide" className="py-10">
      <Link
        href="/create"
        className="mb-5 inline-flex items-center gap-1.5 text-sm text-fg-3 transition-colors hover:text-fg"
      >
        <ArrowLeft size={15} />
        창작 게시판
      </Link>

      <header
        className="sheen-sweep relative mb-7 overflow-hidden rounded-2xl border border-line bg-panel/45 p-5 surface-hl shadow-lg shadow-black/15 sm:p-6"
        style={{ animation: "fade-up 0.6s var(--ease-out-expo) 0.04s both" }}
      >
        {/* warm-ink 깊이 — persimmon 상단 글로(호흡) + 우상단 따뜻한 블룸. hue 42 축 유지. */}
        <div
          aria-hidden
          className="pointer-events-none absolute -right-16 -top-16 size-72 rounded-full opacity-60 blur-3xl motion-safe:[animation:hero-bloom_11s_ease-in-out_infinite]"
          style={{ background: "radial-gradient(closest-side, oklch(0.72 0.185 42 / 0.2), transparent 72%)" }}
        />
        <div className="relative">
          <p className="eyebrow flex items-center gap-2 text-accent">
            <span aria-hidden className="pulse-dot shrink-0" />
            <Sparkles size={14} /> CREATOR CHALLENGE
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
            <ShimmerTitle as="span" particleCount={22} particleSpread={1.2}>
              창작 챌린지
            </ShimmerTitle>
          </h1>
          <p className="mt-2 max-w-2xl text-pretty text-sm leading-relaxed text-fg-2">
            매주 새로운 주제로 함께 그리는 창작 이벤트. ‘스튜디오에서 참여하기’를 누르면 챌린지가
            자동 연결된 상태로 작품을 만들고 바로 게시할 수 있어요.
          </p>
        </div>
      </header>

      {error ? (
        <ErrorState
          title="챌린지를 불러오지 못했습니다."
          message={error}
          onRetry={() => setReloadKey((value) => value + 1)}
        />
      ) : loading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="rounded-2xl border border-line bg-panel/30 p-4">
              <span className="skeleton block h-4 w-1/2" />
              <span className="skeleton mt-3 block h-6 w-3/4" />
              <span className="skeleton mt-2 block h-3 w-full" />
              <span className="skeleton mt-3 block h-3 w-1/3" />
            </div>
          ))}
        </div>
      ) : challenges.length === 0 ? (
        <div className="relative flex flex-col items-center overflow-hidden rounded-3xl border border-dashed border-line bg-gradient-to-b from-card/55 to-panel/30 p-12 text-center">
          <div
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-2 h-32 w-32 -translate-x-1/2 rounded-full opacity-50 blur-3xl"
            style={{ background: "radial-gradient(circle, oklch(0.72 0.185 42 / 0.32), transparent 70%)" }}
          />
          <span
            aria-hidden
            className="pf-glow relative mb-4 grid size-14 place-items-center rounded-2xl border border-accent/30 bg-accent-soft/60 text-accent"
          >
            <Trophy size={26} />
            <Sparkles size={12} className="pf-sparkle absolute -right-1 -top-1 text-warn" />
          </span>
          <p className="relative text-sm font-medium text-fg">진행 중인 챌린지가 없습니다.</p>
          <p className="relative mt-1 text-xs text-fg-3">새로운 주간 챌린지가 곧 열립니다.</p>
        </div>
      ) : (
        <>
          {/* 진행중 챌린지 카드 — 형제 카드 스태거 진입 */}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {(ongoing.length > 0 ? ongoing : challenges.slice(0, 4)).map((challenge, i) => (
              <RevealOnScroll key={challenge.id} delayMs={i * 70}>
                <ChallengeCard
                  challenge={challenge}
                  active={selected?.id === challenge.id}
                  onSelect={() => select(challenge)}
                />
              </RevealOnScroll>
            ))}
          </div>

          {/* 선택 챌린지 참여작 */}
          {selected && (
            <section className="mt-8">
              <div className="mb-4 flex flex-wrap items-center gap-3">
                <h2 className="flex items-center gap-1.5 text-base font-bold text-fg">
                  <Trophy size={16} className="text-accent" />
                  {selected.title} 참여작
                  <CountUp
                    key={`${selected.id}:${selected.entries}`}
                    value={selected.entries}
                    duration={0.7}
                    separator={selected.entries >= 1000}
                    className="numeral text-sm text-fg-3"
                  />
                </h2>
                <DdayChip endsAt={selected.endsAt} />
                <Link
                  href={buildStudioHref({ challengeId: selected.id })}
                  data-no-sfx
                  onClick={(event) => {
                    // 참여 시작은 작은 보상감 — 퍼시몬 파티클 "팡" + 'pop'.
                    fx.sfx("pop");
                    fx.burstAt(event.currentTarget, { count: 16, spread: 1.1 });
                  }}
                  className={buttonClass({ size: "sm", variant: "solid", className: "ml-auto gap-1.5 shadow-lg shadow-accent/25" })}
                >
                  <PenLine size={14} />
                  스튜디오에서 참여하기
                </Link>
              </div>
              {selected.theme && (
                <p className="mb-4 rounded-xl border border-line bg-card/50 px-3.5 py-3 text-sm leading-relaxed text-fg-2">
                  {selected.theme}
                </p>
              )}
              {entriesLoading ? (
                <WorkGridSkeleton count={5} />
              ) : entries.length === 0 ? (
                <div className="relative flex flex-col items-center overflow-hidden rounded-3xl border border-dashed border-line bg-gradient-to-b from-card/55 to-panel/30 p-12 text-center">
                  <div
                    aria-hidden
                    className="pointer-events-none absolute left-1/2 top-2 h-32 w-32 -translate-x-1/2 rounded-full opacity-50 blur-3xl"
                    style={{ background: "radial-gradient(circle, oklch(0.72 0.185 42 / 0.32), transparent 70%)" }}
                  />
                  <span
                    aria-hidden
                    className="pf-glow relative mb-4 grid size-14 place-items-center rounded-2xl border border-accent/30 bg-accent-soft/60 text-accent"
                  >
                    <PenLine size={24} />
                    <Sparkles size={12} className="pf-sparkle absolute -right-1 -top-1 text-warn" />
                  </span>
                  <p className="relative text-sm font-medium text-fg">아직 참여작이 없습니다.</p>
                  <p className="relative mt-1 text-xs text-fg-3">첫 번째 참여자가 되어 보세요!</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                  {entries.map((work) => (
                    <WorkCard key={work.id} work={work} />
                  ))}
                </div>
              )}
            </section>
          )}

          {/* 종료된 챌린지 */}
          {ended.length > 0 && (
            <section className="mt-10">
              <h2 className="mb-3 text-sm font-bold text-fg-2">지난 챌린지</h2>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {ended.map((challenge) => (
                  <ChallengeCard
                    key={challenge.id}
                    challenge={challenge}
                    active={selected?.id === challenge.id}
                    onSelect={() => select(challenge)}
                  />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </Container>
  );
}
