
import { Command, MapPin, Search, Sparkles, Sun, Moon } from "lucide-react";
import { useEffect, useState } from "react";

import { CountUp } from "@/shared/components/count-up";
import { Container } from "@/shared/components/section";
import { Button } from "@/shared/components/ui/button";
import { buttonClass } from "@/shared/components/ui/button-utils";
import { Badge, GenreChip, TagChip } from "@/shared/components/ui/chip";
import { Segmented, UnderlineTabs } from "@/shared/components/ui/segmented";
import { Select } from "@/shared/components/ui/select";
import { DistributionBars, GenreSpectrum, MeterBar } from "@/shared/components/ui/spectrum-bar";
import { RatingInline, Stars } from "@/shared/components/ui/stars";
import { useTheme } from "@/shared/lib/theme";
import { cn } from "@/shared/lib/utils";

// 살아있는 디자인 시스템 — /design.
// 이 프로젝트의 실제 토큰(globals.css)과 실제 컴포넌트(components/*)만 보여준다.
// 새 팔레트·새 컴포넌트를 만들지 않는다. DESIGN.md "활자와 스펙트럼"을 그대로 전시한다.

// ── 색 스와치: 토큰명 + getComputedStyle 로 해석된 실제 OKLCH 값 ──
function useResolvedToken(variable: string): string {
  const [value, setValue] = useState("");
  // 테마 토글 시 값이 바뀌므로 data-theme 변화를 구독한다.
  const theme = useTheme((s) => s.theme);
  useEffect(() => {
    const read = () =>
      setValue(getComputedStyle(document.documentElement).getPropertyValue(variable).trim());
    read();
  }, [variable, theme]);
  return value;
}

function Swatch({ token, label, ring }: { token: string; label: string; ring?: boolean }) {
  const value = useResolvedToken(token);
  return (
    <div className="flex items-center gap-3">
      <span
        className={cn(
          "size-11 shrink-0 rounded-xl border border-line surface-hl",
          ring && "ring-1 ring-inset ring-accent/40"
        )}
        style={{ backgroundColor: `var(${token})` }}
        aria-hidden
      />
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-fg">{label}</p>
        <code className="block truncate font-display text-[0.7rem] text-fg-3">{token}</code>
        <code className="block truncate font-display text-[0.7rem] text-fg-2 tnum">{value || "—"}</code>
      </div>
    </div>
  );
}

const NEUTRALS = [
  { token: "--color-canvas", label: "Canvas · 페이지 바탕" },
  { token: "--color-panel", label: "Panel · 상단바·시트" },
  { token: "--color-card", label: "Card · 카드 표면" },
  { token: "--color-raised", label: "Raised · 카드 위 요소" },
  { token: "--color-line", label: "Line · 기본 보더" },
  { token: "--color-line-strong", label: "Line-strong · 강조 보더" },
];

const TEXTS = [
  { token: "--color-fg", label: "Fg · 본문 크림" },
  { token: "--color-fg-2", label: "Fg-2 · 보조" },
  { token: "--color-fg-3", label: "Fg-3 · 희미 (AA)" },
];

const SEMANTICS = [
  { token: "--color-cool", label: "Cool · info" },
  { token: "--color-good", label: "Good · 성공·무료" },
  { token: "--color-warn", label: "Warn · 주의" },
  { token: "--color-bad", label: "Bad · 오류·19금" },
];

const NAV = [
  { id: "foundations", label: "파운데이션" },
  { id: "typography", label: "타이포그래피" },
  { id: "spacing", label: "여백·반경·깊이" },
  { id: "motion", label: "모션" },
  { id: "components", label: "컴포넌트" },
] as const;

const TYPE_SCALE = [
  { cls: "text-5xl font-display font-bold tracking-[-0.04em]", label: "Display / 3rem · Space Grotesk", sample: "ToonSpectrum 042" },
  { cls: "text-3xl font-bold tracking-tight", label: "Heading 1 / 1.875rem · Pretendard", sample: "통합 인덱스" },
  { cls: "text-2xl font-bold tracking-tight", label: "Heading 2 / 1.5rem", sample: "오늘의 정주행" },
  { cls: "text-base font-semibold", label: "Heading 3 / 1rem", sample: "어디서 봐" },
  { cls: "text-sm text-fg-2", label: "Body / 0.875rem", sample: "무엇을, 어디서, 왜 볼지 한 곳에서." },
  { cls: "eyebrow text-accent", label: "Eyebrow / 0.7rem · uppercase tracking", sample: "GETTING STARTED" },
];

// 데모용 정적 데이터(외부 fetch 없음 — 페이지는 자기완결적이어야 한다)
const DEMO_GENRES = ["로맨스", "판타지", "액션", "스릴러", "일상"];
const DEMO_DIST: [number, number, number, number, number] = [12, 9, 22, 64, 140];

function StateRow({ caption, children }: { caption: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line/70 bg-card/40 p-3.5">
      <p className="eyebrow text-fg-3">{caption}</p>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}

export function DesignSystemPage() {
  const theme = useTheme((s) => s.theme);
  const toggle = useTheme((s) => s.toggle);
  const isDark = theme === "dark";

  const [seg, setSeg] = useState("rank");
  const [tab, setTab] = useState("all");
  const [platform, setPlatform] = useState("all");
  const [tag, setTag] = useState(true);

  useEffect(() => {
    document.title = "디자인 시스템 · 툰스펙트럼";
  }, []);

  return (
    <Container size="wide" className="py-10 sm:py-14">
      {/* ── 헤더 ── */}
      <header className="flex flex-col gap-5 border-b border-line pb-8 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-[60ch]">
          <p className="eyebrow text-accent">툰스펙트럼 · DESIGN SYSTEM</p>
          <h1 className="mt-2 text-balance font-display text-4xl font-bold tracking-[-0.04em] text-fg sm:text-5xl">
            활자와 스펙트럼
          </h1>
          <p className="mt-3 text-pretty text-sm leading-relaxed text-fg-2">
            따뜻한 잉크-블랙 위의 에디토리얼 다크. 이 페이지는 실제 토큰과 실제 컴포넌트를 그대로
            전시하는 살아있는 가이드입니다. 값은 <code className="font-display text-fg">getComputedStyle</code>로
            현재 테마에서 직접 읽어옵니다.
          </p>
        </div>
        <button
          type="button"
          onClick={toggle}
          aria-label={isDark ? "주간 모드로 전환" : "야간 모드로 전환"}
          className={cn(
            "inline-flex shrink-0 items-center gap-2 rounded-full border border-line bg-panel px-3.5 py-2 text-sm font-medium text-fg-2 transition-colors hover:text-fg",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/80 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          )}
        >
          {isDark ? <Sun size={15} /> : <Moon size={15} />}
          {isDark ? "야간 모드" : "주간 모드"}
        </button>
      </header>

      {/* ── 인-페이지 스티키 내비 ── */}
      <nav
        aria-label="디자인 시스템 섹션"
        className="sticky top-2 z-30 mt-6 flex gap-1 overflow-x-auto rounded-full border border-line bg-panel/85 p-1 backdrop-blur rail"
      >
        {NAV.map((n) => (
          <a
            key={n.id}
            href={`#${n.id}`}
            className="shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium text-fg-2 transition-colors hover:bg-raised hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
          >
            {n.label}
          </a>
        ))}
      </nav>

      {/* ── 파운데이션: 색 ── */}
      <section id="foundations" className="scroll-mt-20 pt-14">
        <h2 className="text-2xl font-bold tracking-tight text-fg">색 · OKLCH 토큰</h2>
        <p className="mt-1.5 max-w-[65ch] text-sm leading-relaxed text-fg-2">
          중립은 따뜻한 잉크(hue ≈ 64–70)에만 둡니다. <code className="font-display text-fg">#000/#fff</code> 금지.
          persimmon 악센트는 라이브·액티브·프라이머리 신호 전용입니다.
        </p>

        <div className="mt-6 grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
          {NEUTRALS.map((s) => (
            <Swatch key={s.token} {...s} />
          ))}
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-[1.1fr_1fr]">
          <div className="rounded-2xl border border-line bg-card/40 p-5">
            <p className="eyebrow text-fg-3">악센트 · PERSIMMON</p>
            <div className="mt-3 flex flex-wrap items-stretch gap-3">
              <div
                className="grid h-20 flex-1 min-w-[8rem] place-items-center rounded-xl text-sm font-semibold"
                style={{ backgroundColor: "var(--color-accent)", color: "var(--color-on-accent)" }}
              >
                accent · on-accent
              </div>
              <div className="grid h-20 flex-1 min-w-[8rem] place-items-center rounded-xl bg-accent-soft text-sm font-semibold text-accent">
                accent-soft
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3">
              <Swatch token="--color-accent" label="Accent" ring />
              <Swatch token="--color-accent-2" label="Accent-2 · hover" />
            </div>
          </div>

          <div className="rounded-2xl border border-line bg-card/40 p-5">
            <p className="eyebrow text-fg-3">텍스트</p>
            <div className="mt-3 grid gap-3">
              {TEXTS.map((s) => (
                <Swatch key={s.token} {...s} />
              ))}
            </div>
          </div>
        </div>

        <div className="mt-6">
          <p className="eyebrow text-fg-3">시맨틱</p>
          <div className="mt-3 grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
            {SEMANTICS.map((s) => (
              <Swatch key={s.token} {...s} />
            ))}
          </div>
        </div>
      </section>

      {/* ── 타이포그래피 ── */}
      <section id="typography" className="scroll-mt-20 pt-16">
        <h2 className="text-2xl font-bold tracking-tight text-fg">타이포그래피</h2>
        <p className="mt-1.5 max-w-[65ch] text-sm leading-relaxed text-fg-2">
          grotesque = 데이터/인덱스 voice, serif = 문학 voice, sans = UI·한국어. 세 패밀리는 대비
          축에서만 짝지웁니다.
        </p>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-line bg-card/40 p-5">
            <p className="font-display text-3xl font-bold tracking-tight">Aa 한글 042</p>
            <p className="mt-3 text-sm font-medium text-fg">Space Grotesk</p>
            <p className="text-xs text-fg-3">데이터·인덱스 넘버럴·영문 라벨</p>
          </div>
          <div className="rounded-2xl border border-line bg-card/40 p-5">
            <p className="text-3xl font-bold tracking-tight">Aa 가나다 042</p>
            <p className="mt-3 text-sm font-medium text-fg">Pretendard Variable</p>
            <p className="text-xs text-fg-3">모든 한국어 본문·UI·라벨</p>
          </div>
          <div className="rounded-2xl border border-line bg-card/40 p-5">
            <p className="font-serif text-3xl font-bold">Aa 가나다 042</p>
            <p className="mt-3 text-sm font-medium text-fg">Nanum Myeongjo</p>
            <p className="text-xs text-fg-3">웹소설 인용·문학 hero (절제)</p>
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-4 rounded-2xl border border-line bg-card/40 p-5 sm:p-6">
          {TYPE_SCALE.map((t) => (
            <div key={t.label} className="flex flex-col gap-1 border-b border-line/50 pb-4 last:border-0 last:pb-0 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6">
              <span className={cn("min-w-0 text-balance", t.cls)}>{t.sample}</span>
              <code className="shrink-0 font-display text-[0.7rem] text-fg-3">{t.label}</code>
            </div>
          ))}
        </div>

        <figure className="mt-6 rounded-2xl border border-line bg-panel/40 p-5 sm:p-6">
          <figcaption className="eyebrow text-fg-3">본문 행폭 65–75ch</figcaption>
          <p className="mt-2 max-w-[68ch] text-sm leading-relaxed text-fg-2">
            툰스펙트럼은 작품을 직접 서비스하지 않습니다. 대신 네이버·카카오·리디를 비롯한 국내
            웹툰·웹소설 플랫폼을 가로질러 고르는 단계를 책임지는 통합 인덱스입니다. 흩어진 작품을
            하나로 묶고, 어디서 가장 좋게 볼 수 있는지 알려주며, 믿을 수 있는 데이터로 순위를
            매깁니다. 본문은 한 줄에 65–75자 사이를 유지해 눈의 회귀 부담을 줄입니다.
          </p>
          <blockquote className="mt-4 max-w-[60ch] border-l-2 border-accent/50 pl-4 font-serif text-lg leading-relaxed text-fg">
            “새벽 1시, 폰으로 다음 정주행작을 고르는 순간을 위해.”
          </blockquote>
        </figure>
      </section>

      {/* ── 여백·반경·깊이 ── */}
      <section id="spacing" className="scroll-mt-20 pt-16">
        <h2 className="text-2xl font-bold tracking-tight text-fg">여백 · 반경 · 깊이</h2>

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border border-line bg-card/40 p-5">
            <p className="eyebrow text-fg-3">스페이싱 스케일</p>
            <div className="mt-4 flex flex-col gap-2.5">
              {[
                ["1", "0.25rem"],
                ["2", "0.5rem"],
                ["3", "0.75rem"],
                ["4", "1rem"],
                ["6", "1.5rem"],
                ["10", "2.5rem"],
              ].map(([step, rem]) => (
                <div key={step} className="flex items-center gap-3">
                  <span className="tnum w-8 shrink-0 text-right text-xs text-fg-3">{step}</span>
                  <span className="h-3 rounded bg-accent/80" style={{ width: rem }} />
                  <code className="font-display text-[0.7rem] text-fg-3">{rem}</code>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-line bg-card/40 p-5">
            <p className="eyebrow text-fg-3">반경 & 깊이</p>
            <div className="mt-4 flex flex-wrap gap-4">
              {[
                ["rounded-lg", "0.5rem"],
                ["rounded-xl", "--radius-xl · 1.1rem"],
                ["rounded-2xl", "--radius-2xl · 1.4rem"],
              ].map(([cls, label]) => (
                <div key={cls} className="flex flex-col items-center gap-1.5">
                  <span className={cn("size-16 border border-line bg-raised surface-hl", cls)} />
                  <code className="font-display text-[0.66rem] text-fg-3">{label}</code>
                </div>
              ))}
            </div>
            <p className="mt-5 eyebrow text-fg-3">표면 깊이 (보더 우선 · 그림자 절제)</p>
            <div className="mt-3 grid grid-cols-4 gap-2 text-center text-[0.62rem] text-fg-3">
              {["canvas", "panel", "card", "raised"].map((surf) => (
                <div key={surf} className="flex flex-col items-center gap-1.5">
                  <span
                    className="size-12 rounded-lg border border-line surface-hl"
                    style={{ backgroundColor: `var(--color-${surf})` }}
                  />
                  {surf}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── 모션 ── */}
      <section id="motion" className="scroll-mt-20 pt-16">
        <h2 className="text-2xl font-bold tracking-tight text-fg">모션</h2>
        <p className="mt-1.5 max-w-[65ch] text-sm leading-relaxed text-fg-2">
          150–250ms, ease-out-expo. 상태 전달 전용. 모든 데모는{" "}
          <code className="font-display text-fg">prefers-reduced-motion</code>을 존중합니다(전역 base 레이어가
          애니메이션을 무력화).
        </p>

        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <div className="flex flex-col gap-3 rounded-2xl border border-line bg-card/40 p-5">
            <p className="eyebrow text-fg-3">shimmer · 스켈레톤</p>
            <div className="skeleton h-4 w-3/4" />
            <div className="skeleton h-4 w-1/2" />
            <div className="skeleton aspect-[3/4] w-full rounded-xl" />
          </div>

          <div className="flex flex-col gap-3 rounded-2xl border border-line bg-card/40 p-5">
            <p className="eyebrow text-fg-3">pulse-soft · 라이브</p>
            <div className="flex items-center gap-2 text-sm text-fg">
              <span className="size-2.5 animate-pulse-soft rounded-full bg-accent" aria-hidden />
              연재중 · LIVE
            </div>
            <p className="mt-auto eyebrow text-fg-3">count-up · 수치</p>
            <span className="numeral text-4xl text-accent">
              <CountUp value={30412} />
            </span>
          </div>

          <div className="flex flex-col gap-3 rounded-2xl border border-line bg-card/40 p-5">
            <p className="eyebrow text-fg-3">fill-in · 스펙트럼 바</p>
            <DistributionBars dist={DEMO_DIST} />
            <MeterBar value={86} label="완독률" suffix="%" className="mt-2" />
          </div>
        </div>
      </section>

      {/* ── 컴포넌트 갤러리 ── */}
      <section id="components" className="scroll-mt-20 pt-16">
        <h2 className="text-2xl font-bold tracking-tight text-fg">컴포넌트</h2>
        <p className="mt-1.5 max-w-[65ch] text-sm leading-relaxed text-fg-2">
          <code className="font-display text-fg">components/ui/*</code>의 실제 프리미티브입니다. 상태 캡션을
          달아 default / hover / active / disabled 를 함께 보여줍니다.
        </p>

        <div className="mt-6 grid gap-3 md:grid-cols-2">
          <StateRow caption="Button · variants">
            <Button variant="solid">Solid</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="quiet">Quiet</Button>
            <Button variant="solid" disabled>
              Disabled
            </Button>
          </StateRow>

          <StateRow caption="Button · sizes">
            <Button size="sm">Small</Button>
            <Button size="md">Medium</Button>
            <Button size="lg">Large</Button>
            <button type="button" className={buttonClass({ variant: "solid", className: "gap-1.5" })}>
              <Sparkles size={15} />
              아이콘
            </button>
          </StateRow>

          <StateRow caption="Badge · tone">
            <Badge tone="neutral">기본</Badge>
            <Badge tone="accent">LIVE</Badge>
            <Badge tone="good">무료</Badge>
            <Badge tone="warn">기다무</Badge>
            <Badge tone="bad">19세</Badge>
            <Badge tone="cool">정보</Badge>
          </StateRow>

          <StateRow caption="Chip · 장르 스펙트럼 / 태그">
            {DEMO_GENRES.slice(0, 3).map((g) => (
              <GenreChip key={g} genre={g} />
            ))}
            <TagChip label="회귀" active={tag} onClick={() => setTag((v) => !v)} />
            <TagChip label="먼치킨" active={false} onClick={() => undefined} />
          </StateRow>

          <StateRow caption="Stars · 0.5 단위 / RatingInline">
            <Stars value={4.5} size="md" />
            <RatingInline value={4.7} count={1820} />
            <RatingInline value={4.2} estimated />
          </StateRow>

          <StateRow caption="Select · Radix 포털(오버플로 탈출)">
            <Select
              value={platform}
              onValueChange={setPlatform}
              ariaLabel="플랫폼"
              triggerClassName="h-9 rounded-lg border border-line bg-card px-3 text-sm text-fg"
              options={[
                { value: "all", label: "전체 플랫폼" },
                { value: "naver", label: "네이버 웹툰" },
                { value: "kakao", label: "카카오페이지" },
                { value: "ridi", label: "리디" },
              ]}
            />
          </StateRow>

          <StateRow caption="Segmented · layoutId 슬라이딩">
            <Segmented
              value={seg}
              onChange={setSeg}
              items={[
                { value: "rank", label: "랭킹" },
                { value: "new", label: "신작" },
                { value: "free", label: "무료" },
              ]}
            />
          </StateRow>

          <StateRow caption="UnderlineTabs · 텍스트 내비">
            <UnderlineTabs
              value={tab}
              onChange={setTab}
              items={[
                { value: "all", label: "전체" },
                { value: "toon", label: "웹툰" },
                { value: "novel", label: "웹소설" },
              ]}
            />
          </StateRow>
        </div>

        {/* 시그니처 컴포넌트 */}
        <h3 className="mt-10 text-base font-semibold text-fg">시그니처</h3>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div className="rounded-2xl border border-line bg-card/40 p-5">
            <p className="eyebrow text-fg-3">스펙트럼 바 · 장르 믹스 (호버 스크럽)</p>
            <GenreSpectrum
              genres={DEMO_GENRES}
              height={8}
              interactive
              label="데모 장르 스펙트럼"
              className="mt-4"
            />
            <div className="mt-4 flex flex-wrap gap-1.5">
              {DEMO_GENRES.map((g) => (
                <GenreChip key={g} genre={g} size="sm" />
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-line bg-card/40 p-5">
            <p className="eyebrow text-fg-3">커맨드 팔레트 · 통합 검색 진입점</p>
            <button
              type="button"
              onClick={() => window.dispatchEvent(new Event("toonspectrum:search"))}
              className="mt-4 flex w-full items-center gap-2.5 rounded-xl border border-line bg-panel px-3.5 py-2.5 text-left text-sm text-fg-3 transition-colors hover:border-line-strong hover:text-fg-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
            >
              <Search size={15} className="shrink-0" />
              <span className="flex-1">작품·작가·태그 검색…</span>
              <kbd className="inline-flex items-center gap-0.5 rounded-md border border-line bg-card px-1.5 py-0.5 font-display text-[0.66rem] text-fg-3">
                <Command size={11} />K
              </kbd>
            </button>
            <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-fg-3">
              <MapPin size={12} className="text-accent" />
              실제 ⌘K 팔레트를 엽니다.
            </p>
          </div>
        </div>
      </section>

      {/* 푸터 보조 링크 — 주 내비 아님 */}
      <p className="mt-16 border-t border-line pt-6 text-xs text-fg-3">
        이 페이지는 <code className="font-display text-fg-2">src/styles/globals.css</code>와{" "}
        <code className="font-display text-fg-2">DESIGN.md</code>를 단일 출처로 합니다. 디자인 변경은
        토큰에서 시작합니다.
      </p>
    </Container>
  );
}
