/**
 * Studio Scroll Preview Panel — 세로 스크롤 미리보기(폰 프레임 시뮬레이션).
 *
 * StudioStoryboardGridPanel과 같은 전체화면 오버레이 뼈대(role="dialog"/aria-modal, Esc·스크림
 * 클릭으로 닫힘)를 재사용하되, 격자가 아니라 좁은 고정 폭 컬럼에 전체 페이지를 세로로 이어 붙여
 * "실제 독자가 읽는 화면비"를 시뮬레이션한다. 페이지 렌더는 StudioPageThumbnail(SVG 프록시)을
 * 그대로 재사용한다 — 새 렌더 스위치문을 다시 만들지 않는다.
 *
 * "웹툰 연합 스크롤" 다운로드(handleDownloadAll, 파일 내보내기)·스토리보드 그리드(격자 비교)와는
 * 목적이 다르다 — 이 패널은 다운로드 없이 에디터 안에서 즉시 "가독성/컷 간 호흡"을 확인하는
 * 인터랙티브 열람 전용 화면이다(docs/studio-scroll-preview-integration.md §0 참고).
 *
 * 이 패널 자신은 상태를 거의 소유하지 않는다 — 프레임 폭(좁게/보통/넓게)만 예외(데이터에 영향
 * 없는 순수 표시 취향, StudioStoryboardGridPanel의 칸 크기 S/M/L과 동일한 성격).
 *
 * 각 페이지 <section> 에 style={{aspectRatio}} 를 직접 주는 이유: canvasH 는 페이지마다 달라
 * Tailwind 의 정적 클래스 스캔으로는 표현할 수 없는 값이라(런타임 임의값), 인라인 style 로 줘야
 * 안전하다. StudioPageThumbnail 자신에는 h-full/w-full(고정 클래스, Tailwind 가 정상 생성)만
 * 넘겨 그 section 의 aspect-ratio 로 확정된 박스를 레터박스 없이 정확히 채우게 한다.
 */
import { Activity, LocateFixed, Pause, Play, Smartphone, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactElement } from "react";
import { createPortal } from "react-dom";

import { CANVAS_W } from "./studio-assets";
import { pageDisplayName } from "./studio-page-meta";
import {
  analyzeStudioScrollRhythm,
  planStudioAutoScrollStep,
  type StudioScrollRhythmAnalysis,
  type StudioScrollRhythmInsightSeverity,
} from "./studio-scroll-rhythm";
import { StudioPageThumbnail } from "./StudioPageThumbnails";

import type { ThumbPageLike } from "./studio-page-thumbs";

import { cn } from "@/shared/lib/utils";

/** ThumbPageLike + 표시용 메타(이름) — StudioStoryboardGridPanel의 StoryboardGridPage와 동일한
 *  성격의 위스닝(widening)이다. composeThumbPage 결과(PageState 기반)는 실제로 name 을 그대로
 *  들고 있지만, ThumbPageLike 자신은 순환 임포트 방지를 위해 그 필드를 선언하지 않는다 — 여기서
 *  표시(pageDisplayName)에 필요한 만큼만 옵셔널로 얹는다. */
export type ScrollPreviewPage = ThumbPageLike & { name?: string };

export interface StudioScrollPreviewPanelProps {
  open: boolean;
  onClose: () => void;
  /** composeThumbPage(master, p)가 이미 적용된 상태로 호출측(StudioPage)이 전달 — 이 패널은
   *  DocumentMaster 타입을 몰라도 된다(StudioStoryboardGridPanel과 동일 계약). */
  pages: ScrollPreviewPage[];
  /** 현재 편집 중인 페이지 — 열릴 때 그 페이지 위치로 자동 스크롤한다. */
  currentPageId: string;
  /** 페이지 클릭 시 그 페이지로 점프 + 패널 닫기. 생략하면 클릭 핸들러 자체가 붙지 않는다
   *  (순수 열람 모드). */
  onSelectPage?: (pageId: string) => void;
}

const FRAME_WIDTH_PRESETS = [
  { id: "narrow", label: "좁게", px: 360 },
  { id: "normal", label: "보통", px: 400 },
  { id: "wide", label: "넓게", px: 480 },
] as const;

type FrameWidthId = (typeof FRAME_WIDTH_PRESETS)[number]["id"];

const AUTO_SCROLL_SPEED_PRESETS = [
  { id: "slow", label: "천천히", pxPerSecond: 120 },
  { id: "normal", label: "보통", pxPerSecond: 240 },
  { id: "fast", label: "빠르게", pxPerSecond: 420 },
] as const;

// "웹툰 연합 스크롤" 다운로드(handleDownloadAll(24) 호출부)의 기본 페이지 간격과 의도적으로
// 맞춘 값 — 화면에서 본 리듬과 다운로드한 결과물의 리듬이 최대한 비슷하게 느껴지도록 한다.
const PAGE_GAP_PX = 24;

function insightTone(severity: StudioScrollRhythmInsightSeverity): string {
  if (severity === "critical") return "bg-danger";
  if (severity === "warning") return "bg-amber-400";
  return "bg-accent";
}

/**
 * 진단 줄에 붙일 "사람이 읽는" 페이지 이름. 분석기는 안정적인 참조를 위해 내부 페이지 id
 * (UUID)를 들고 다니지만, 그 id 는 사용자 화면에 낼 물건이 아니다 — 화면에는
 * `pageDisplayName`("3페이지" / 사용자가 지은 이름)만 내고, id 는 아래 `data-page-id`
 * 속성(DOM·자동화·버그리포트가 읽는 자리)에 그대로 남긴다. 정보를 지우는 게 아니라
 * 청중을 나누는 것.
 */
function buildPageLabelMap(pages: readonly ScrollPreviewPage[]): ReadonlyMap<string, string> {
  return new Map(pages.map((page, index) => [page.id, pageDisplayName(page, index)]));
}

function RhythmSummaryCard({
  analysis,
  pageLabels,
}: {
  analysis: StudioScrollRhythmAnalysis;
  pageLabels: ReadonlyMap<string, string>;
}): ReactElement {
  return (
    <aside
      aria-label="스크롤 리듬 분석"
      className="w-full shrink-0 rounded-xl border border-line bg-panel/95 p-3 shadow-lg lg:sticky lg:top-0 lg:w-72"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[0.68rem] font-bold uppercase tracking-[0.14em] text-fg-4">
            Scroll direction
          </p>
          <h3 className="mt-0.5 text-sm font-bold text-fg">연출 리듬 진단</h3>
        </div>
        <div
          className="grid size-11 shrink-0 place-items-center rounded-xl border border-accent/30 bg-accent-soft text-center"
          title={`리듬 점수 ${analysis.score}점`}
        >
          <span className="text-base font-black leading-none text-accent">{analysis.grade}</span>
          <span className="text-[0.58rem] font-semibold leading-none text-fg-3">
            {analysis.score}
          </span>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-1.5">
        {[
          { label: "분량", value: `${analysis.totalScreenCount}화면` },
          { label: "과밀", value: `${analysis.densePageCount}p` },
          { label: "호흡", value: `${analysis.breathingPageCount}p` },
        ].map((item) => (
          <div key={item.label} className="rounded-lg border border-line bg-card px-2 py-2 text-center">
            <p className="text-[0.62rem] text-fg-4">{item.label}</p>
            <p className="mt-0.5 text-[0.72rem] font-bold text-fg">{item.value}</p>
          </div>
        ))}
      </div>

      <div className="mt-2.5 rounded-lg border border-line bg-card px-2.5 py-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[0.68rem] text-fg-4">마지막 비트</span>
          <span className="text-[0.7rem] font-semibold text-fg-2">{analysis.ending.label}</span>
        </div>
        {analysis.ending.mode !== "none" && (
          <p className="mt-1 text-[0.64rem] leading-4 text-fg-4">
            뒤 여백 {analysis.ending.trailingWhitespaceScreens}화면
          </p>
        )}
      </div>

      <div className="mt-3 space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-[0.68rem] font-bold text-fg-2">우선 확인</p>
          <span className="text-[0.62rem] text-fg-4">{analysis.insights.length}건</span>
        </div>
        {analysis.insights.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line px-2.5 py-3 text-[0.68rem] leading-4 text-fg-3">
            현재 분석 예산 안에서 큰 리듬 문제를 찾지 못했습니다.
          </p>
        ) : (
          analysis.insights.slice(0, 5).map((insight, index) => (
            <div
              key={`${insight.code}-${insight.pageId ?? "document"}-${index}`}
              data-insight-code={insight.code}
              data-page-id={insight.pageId ?? undefined}
              className="rounded-lg border border-line bg-card px-2.5 py-2"
            >
              <div className="flex items-start gap-2">
                <span
                  aria-hidden
                  className={cn("mt-1 size-1.5 shrink-0 rounded-full", insightTone(insight.severity))}
                />
                <div className="min-w-0">
                  <p className="text-[0.68rem] font-semibold text-fg">
                    {insight.title}
                    {insight.pageId && pageLabels.has(insight.pageId) && (
                      <span className="ml-1 font-normal text-fg-4">
                        · {pageLabels.get(insight.pageId)}
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 text-[0.62rem] leading-4 text-fg-4">
                    {insight.suggestion}
                  </p>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}

export function StudioScrollPreviewPanel({
  open,
  onClose,
  pages,
  currentPageId,
  onSelectPage,
}: StudioScrollPreviewPanelProps): ReactElement | null {
  const [frameWidthId, setFrameWidthId] = useState<FrameWidthId>("normal");
  const [showRhythmAnalysis, setShowRhythmAnalysis] = useState(true);
  const [autoScrollSpeed, setAutoScrollSpeed] = useState(240);
  const [autoScrolling, setAutoScrolling] = useState(false);
  const pageRefs = useRef(new Map<string, HTMLDivElement>());
  const scrollViewportRef = useRef<HTMLDivElement>(null);
  // 마운트 시점의 currentPageId 스냅샷 — useRef(초기값)은 최초 렌더에서만 인자를 쓰므로 이후
  // currentPageId 가 바뀌어도 이 값은 그대로다("열릴 때 한 번만 그 위치로 스크롤"에 정확히 필요한
  // 의미론). "현재 페이지로" 버튼은 이 스냅샷이 아니라 최신 currentPageId prop 을 직접 읽는다.
  const initialPageId = useRef(currentPageId).current;

  useEffect(() => {
    if (!open) return;
    pageRefs.current.get(initialPageId)?.scrollIntoView({ block: "start", behavior: "auto" });
  }, [initialPageId, open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open || !autoScrolling) return;
    const viewport = scrollViewportRef.current;
    if (!viewport) return;
    let animationFrame = 0;
    let previousTimestamp: number | null = null;

    const advance = (timestamp: number) => {
      if (previousTimestamp !== null) {
        const step = planStudioAutoScrollStep({
          scrollTop: viewport.scrollTop,
          scrollHeight: viewport.scrollHeight,
          viewportHeight: viewport.clientHeight,
          speedPxPerSecond: autoScrollSpeed,
          elapsedMs: timestamp - previousTimestamp,
        });
        viewport.scrollTop = step.nextScrollTop;
        if (step.reachedEnd) {
          setAutoScrolling(false);
          return;
        }
      }
      previousTimestamp = timestamp;
      animationFrame = window.requestAnimationFrame(advance);
    };

    animationFrame = window.requestAnimationFrame(advance);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [autoScrollSpeed, autoScrolling, open]);

  if (!open) return null;

  const framePx = FRAME_WIDTH_PRESETS.find((p) => p.id === frameWidthId)?.px ?? 400;
  const rhythmAnalysis = analyzeStudioScrollRhythm(pages, {
    viewportHeightPx: 1_280,
    pageGapPx: PAGE_GAP_PX,
  });
  const pageLabels = buildPageLabelMap(pages);

  const modal = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="세로 스크롤 미리보기"
      className="fixed inset-0 z-[80] bg-[oklch(0.08_0.01_70/0.82)] p-2 text-fg backdrop-blur-sm sm:p-4"
    >
      {/* 스크림 클릭으로 닫기 — 실제 <button>(고유하게 키보드 접근 가능한 요소)로 구현해 div에
          onClick을 다는 jsx-a11y 비접근성 패턴을 피한다. aria-hidden + tabIndex=-1로 스크린리더/탭
          순서에서는 완전히 숨긴다(닫기는 Esc와 아래 보이는 "닫기" 버튼이 이미 접근성 있게 제공 —
          이 버튼은 마우스 전용 부가 편의일 뿐). z-0/z-10으로 명시적 스택 순서를 고정해 내용 패널이
          항상 스크림 위에 그려지게 한다(DOM 순서에 의존하지 않음). */}
      <button
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 z-0 cursor-default"
      />
      <div className="relative z-10 mx-auto flex h-full w-full max-w-[100rem] flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl">
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <Smartphone size={16} className="text-accent" aria-hidden />
          <h2 className="text-sm font-bold text-fg">세로 스크롤 미리보기</h2>
          <span className="text-xs text-fg-3">총 {pages.length}페이지</span>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 rounded-md border border-line bg-card/50 p-0.5">
              {FRAME_WIDTH_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => setFrameWidthId(preset.id)}
                  aria-pressed={frameWidthId === preset.id}
                  title={`프레임 폭 — ${preset.label}(${preset.px}px)`}
                  className={cn(
                    "min-h-6 rounded-md border border-line bg-card px-2 py-0.5 text-[0.72rem] text-fg-2 transition-colors hover:bg-raised hover:text-fg",
                    frameWidthId === preset.id && "border-accent bg-raised text-fg"
                  )}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setShowRhythmAnalysis((visible) => !visible)}
              aria-pressed={showRhythmAnalysis}
              className={cn(
                "flex min-h-8 items-center gap-1.5 rounded-lg border border-line bg-card px-2.5 py-1.5 text-xs font-medium text-fg-2 transition-colors hover:bg-raised",
                showRhythmAnalysis && "border-accent/50 bg-accent-soft text-accent"
              )}
              title="정보 밀도·대사량·컷 간 호흡·엔딩 여백을 원고 안에서 계산합니다"
            >
              <Activity size={13} aria-hidden /> 리듬 분석
            </button>
            <div
              role="group"
              aria-label="독자 스크롤 속도 시뮬레이션"
              className="flex min-h-8 items-center overflow-hidden rounded-lg border border-line bg-card"
            >
              <select
                aria-label="자동 스크롤 속도"
                value={autoScrollSpeed}
                onChange={(event) => setAutoScrollSpeed(Number(event.target.value))}
                className="min-h-8 border-0 bg-transparent px-2 text-[0.7rem] font-medium text-fg-2 outline-none"
              >
                {AUTO_SCROLL_SPEED_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.pxPerSecond}>
                    {preset.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                aria-label={autoScrolling ? "자동 스크롤 일시정지" : "자동 스크롤 재생"}
                aria-pressed={autoScrolling}
                onClick={() => {
                  const viewport = scrollViewportRef.current;
                  if (
                    !autoScrolling &&
                    viewport &&
                    viewport.scrollTop >= viewport.scrollHeight - viewport.clientHeight - 1
                  ) {
                    viewport.scrollTop = 0;
                  }
                  setAutoScrolling((playing) => !playing);
                }}
                className={cn(
                  "grid size-8 place-items-center border-l border-line text-fg-3 transition-colors hover:bg-raised hover:text-fg",
                  autoScrolling && "bg-accent-soft text-accent"
                )}
                title={autoScrolling ? "독자 스크롤 일시정지" : "선택한 속도로 독자 스크롤 재생"}
              >
                {autoScrolling ? <Pause size={13} aria-hidden /> : <Play size={13} aria-hidden />}
              </button>
            </div>
            <button
              type="button"
              onClick={() => pageRefs.current.get(currentPageId)?.scrollIntoView({ block: "start", behavior: "smooth" })}
              className="flex items-center gap-1 rounded-lg border border-line bg-card px-2.5 py-1.5 text-xs font-medium text-fg-2 transition-colors hover:bg-raised"
              title="현재 편집 중인 페이지로 이동"
            >
              <LocateFixed size={12} aria-hidden /> 현재 페이지로
            </button>
            <button
              type="button"
              aria-label="닫기"
              title="닫기 (Esc)"
              onClick={onClose}
              className="grid size-8 place-items-center rounded-lg border border-line bg-card text-fg-3 transition-colors hover:bg-accent-soft hover:text-accent"
            >
              <X size={15} aria-hidden />
            </button>
          </div>
        </div>

        <div
          ref={scrollViewportRef}
          className="min-h-0 flex-1 overflow-y-auto bg-raised/30 px-3 py-6"
        >
          <div
            className={cn(
              "mx-auto flex w-full items-start justify-center gap-4",
              showRhythmAnalysis ? "max-w-5xl flex-col lg:flex-row" : "max-w-max"
            )}
          >
            {showRhythmAnalysis && (
              <RhythmSummaryCard analysis={rhythmAnalysis} pageLabels={pageLabels} />
            )}
            <div className="mx-auto shrink-0" style={{ width: framePx, maxWidth: "100%" }}>
              {pages.length === 0 ? (
                <p className="rounded-lg border border-dashed border-line px-3 py-8 text-center text-xs text-fg-4">
                  표시할 페이지가 없어요.
                </p>
              ) : (
                pages.map((page, index) => {
                  const canvasH = page.canvasH > 0 ? page.canvasH : 1080;
                  const displayName = pageDisplayName(page, index);
                  const rhythmMetric = rhythmAnalysis.pages[index];
                  return (
                    <div
                      key={page.id}
                      ref={(el) => {
                        if (el) pageRefs.current.set(page.id, el);
                        else pageRefs.current.delete(page.id);
                      }}
                      className="relative"
                      style={{ marginBottom: index < pages.length - 1 ? PAGE_GAP_PX : 0 }}
                    >
                      <section
                        aria-label={`${index + 1}/${pages.length}페이지`}
                        className="w-full overflow-hidden rounded-lg shadow-sm"
                        style={{ aspectRatio: `${CANVAS_W} / ${canvasH}` }}
                      >
                        <StudioPageThumbnail page={page} className="h-full w-full rounded-none border-0" />
                      </section>
                      <span
                        aria-hidden
                        className="pointer-events-none absolute left-1.5 top-1.5 z-20 rounded bg-black/55 px-1.5 py-0.5 text-[10px] font-semibold leading-4 text-white"
                      >
                        {displayName}
                      </span>
                      {showRhythmAnalysis && rhythmMetric && (
                        <span
                          aria-label={`${displayName} 리듬 ${rhythmMetric.score}점, 화면당 밀도 ${rhythmMetric.densityPerScreen}`}
                          className="pointer-events-none absolute right-1.5 top-1.5 z-20 rounded border border-white/20 bg-black/65 px-1.5 py-0.5 text-[10px] font-semibold leading-4 text-white backdrop-blur-sm"
                        >
                          {rhythmMetric.score} · 밀도 {rhythmMetric.densityPerScreen}
                        </span>
                      )}
                      {onSelectPage && (
                        <button
                          type="button"
                          onClick={() => {
                            onSelectPage(page.id);
                            onClose();
                          }}
                          aria-label={`${displayName} 편집하기`}
                          className="absolute inset-0 z-10 cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                        />
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(modal, document.body);
}
