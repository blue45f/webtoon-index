/**
 * Thin auto-color hints product panel.
 *
 * Plans connected regions from line art + scribble seeds, then can apply a ready plan through
 * the Advanced Fill batch bridge (label-authoritative paint). Never silently overwrites —
 * apply requires an explicit user action and an `onApplyResult` parent handler.
 */

import { Copy, Crosshair, Info, Loader2, Paintbrush, Sparkles, TriangleAlert } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import {
  planStudioAutoColorHints,
  type StudioAutoColorHintPlan,
  type StudioAutoColorHintRequest,
  type StudioAutoColorHintRgba,
  type StudioAutoColorHintSeed,
  type StudioAutoColorHintImageDataLike,
} from "./studio-auto-color-hints";
import {
  appendStudioAutoColorScribbleSeed,
  applyStudioAutoColorHintsAdvancedFillBatch,
  applyStudioAutoColorHintsToPaintTarget,
  createStudioAutoColorBlankPaintTarget,
  STUDIO_AUTO_COLOR_APPLY_TARGET_MODES,
  STUDIO_AUTO_COLOR_SCRIBBLE_PALETTE,
  studioAutoColorScribbleSeedFromRecommendation,
  type StudioAutoColorApplyTargetMode,
} from "./studio-auto-color-hints-advanced-fill";
import {
  studioAutoColorCanvasSeedId,
} from "./studio-auto-color-hints-canvas-seed";
import {
  encodeStudioAutoColorHintImageToPngDataUrl,
  loadStudioAutoColorHintImageFromSrc,
} from "./studio-auto-color-hints-image-source";
import {
  createStudioAutoColorHintsDemoRequest,
  summarizeStudioAutoColorHintPlan,
  type StudioAutoColorHintPlanSummary,
} from "./studio-auto-color-hints-summary";

import { cx } from "@/shared/lib/cx";

export interface StudioAutoColorCanvasSeedHit {
  readonly x: number;
  readonly y: number;
  /** Monotonic nonce so the same pixel can be re-seeded after a clear. */
  readonly nonce: number;
}

const controlFocusClass =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

export interface StudioAutoColorHintsPanelProps {
  /** Optional line-art pixels. When omitted, the panel plans against a demo fixture. */
  readonly image?: StudioAutoColorHintImageDataLike | null;
  /**
   * Selected image layer `src` (data URL / same-origin URL). When `image`/`request` are absent,
   * pixels are decoded on Run (with auto-color max-pixel downscale). Browser only.
   */
  readonly imageSrc?: string | null;
  /** Optional color seeds; when omitted, the panel uses its scribble seed list. */
  readonly seeds?: readonly StudioAutoColorHintSeed[];
  /** Optional full request override (image/seeds/options). Wins over image/seeds props. */
  readonly request?: StudioAutoColorHintRequest | null;
  /** Notified after a successful plan (never mutates document). */
  readonly onPlan?: (plan: StudioAutoColorHintPlan) => void;
  /** Optional external runner; defaults to sync pure planner. */
  readonly onRun?: (request: StudioAutoColorHintRequest) => StudioAutoColorHintPlan | Promise<StudioAutoColorHintPlan>;
  /**
   * Explicit apply path: parent patches the selected image `src` with the painted PNG.
   * Without this handler the apply button stays hidden (plan-only safety).
   */
  readonly onApplyResult?: (dataUrl: string) => void;
  /**
   * Multi-layer path: parent inserts a new transparent paint image above the line art.
   * When omitted, only "선택 레이어" apply remains available.
   */
  readonly onApplyNewLayer?: (payload: {
    readonly dataUrl: string;
    readonly width: number;
    readonly height: number;
    readonly name: string;
  }) => void;
  /**
   * When true (or toggled via UI), the parent should intercept canvas clicks and feed
   * `canvasSeedHit` image-local samples. Omitted handlers keep arming local-only (UI still works
   * for demo, but stage clicks need the page wiring).
   */
  readonly scribbleCanvasArmed?: boolean;
  readonly onScribbleCanvasArmedChange?: (armed: boolean) => void;
  /** One-shot canvas seed from StudioPage stage click (image-local planner pixels). */
  readonly canvasSeedHit?: StudioAutoColorCanvasSeedHit | null;
  /** Batch of freehand-stroke samples (processed once per nonce set). */
  readonly canvasSeedHits?: readonly StudioAutoColorCanvasSeedHit[] | null;
  readonly onCanvasSeedHitConsumed?: () => void;
  /** Planner pixel size of the last resolved line-art image (for parent stage mapping). */
  readonly onPlanImageSize?: (size: { width: number; height: number } | null) => void;
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through
  }
  return false;
}

function rgbaCss(color: StudioAutoColorHintRgba): string {
  return `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${(color[3] / 255).toFixed(3)})`;
}

async function resolveRequest(input: {
  image?: StudioAutoColorHintImageDataLike | null;
  imageSrc?: string | null;
  seeds: readonly StudioAutoColorHintSeed[];
  request?: StudioAutoColorHintRequest | null;
}): Promise<{
  request: StudioAutoColorHintRequest;
  usingDemo: boolean;
  image: StudioAutoColorHintImageDataLike;
}> {
  if (input.request) {
    return {
      request: input.request,
      usingDemo: false,
      image: input.request.image,
    };
  }
  if (input.image) {
    return {
      request: {
        image: input.image,
        seeds: input.seeds,
      },
      usingDemo: false,
      image: input.image,
    };
  }
  if (typeof input.imageSrc === "string" && input.imageSrc.length > 0) {
    const image = await loadStudioAutoColorHintImageFromSrc(input.imageSrc);
    return {
      request: {
        image,
        seeds: input.seeds,
      },
      usingDemo: false,
      image,
    };
  }
  const demo = createStudioAutoColorHintsDemoRequest();
  const seeds = input.seeds.length > 0 ? input.seeds : demo.seeds;
  return {
    request: {
      ...demo,
      seeds,
    },
    usingDemo: true,
    image: demo.image,
  };
}

export function StudioAutoColorHintsPanel({
  image = null,
  imageSrc = null,
  seeds: seedsProp,
  request = null,
  onPlan,
  onRun,
  onApplyResult,
  onApplyNewLayer,
  scribbleCanvasArmed,
  onScribbleCanvasArmedChange,
  canvasSeedHit = null,
  canvasSeedHits = null,
  onCanvasSeedHitConsumed,
  onPlanImageSize,
}: StudioAutoColorHintsPanelProps) {
  const titleId = useId();
  const helpId = useId();
  const summaryId = useId();

  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<StudioAutoColorHintPlanSummary | null>(null);
  const planRef = useRef<StudioAutoColorHintPlan | null>(null);
  const plannedImageRef = useRef<StudioAutoColorHintImageDataLike | null>(null);
  const canvasSeedSequenceRef = useRef(0);
  const lastCanvasSeedNonceRef = useRef<number | null>(null);
  const [usingDemo, setUsingDemo] = useState(false);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [applyStatus, setApplyStatus] = useState<string | null>(null);
  const [scribbleSeeds, setScribbleSeeds] = useState<StudioAutoColorHintSeed[]>([]);
  const [activePaletteId, setActivePaletteId] = useState(
    STUDIO_AUTO_COLOR_SCRIBBLE_PALETTE[0]!.id,
  );
  const [applyTargetMode, setApplyTargetMode] = useState<StudioAutoColorApplyTargetMode>("selected");
  const [localCanvasArmed, setLocalCanvasArmed] = useState(false);

  const activePalette =
    STUDIO_AUTO_COLOR_SCRIBBLE_PALETTE.find((entry) => entry.id === activePaletteId)
    ?? STUDIO_AUTO_COLOR_SCRIBBLE_PALETTE[0]!;
  const effectiveSeeds = seedsProp ?? scribbleSeeds;
  const canvasArmed = scribbleCanvasArmed ?? localCanvasArmed;

  function setCanvasArmed(next: boolean) {
    setLocalCanvasArmed(next);
    onScribbleCanvasArmedChange?.(next);
  }

  // Ingest one-shot / freehand-stroke canvas seed hits without re-processing the same nonce.
  useEffect(() => {
    const batch: StudioAutoColorCanvasSeedHit[] = [];
    if (canvasSeedHits && canvasSeedHits.length > 0) {
      for (const hit of canvasSeedHits) batch.push(hit);
    } else if (canvasSeedHit) {
      batch.push(canvasSeedHit);
    }
    if (batch.length === 0) return;

    const fresh = batch.filter((hit) => {
      if (lastCanvasSeedNonceRef.current !== null && hit.nonce <= lastCanvasSeedNonceRef.current) {
        return false;
      }
      return true;
    });
    if (fresh.length === 0) {
      onCanvasSeedHitConsumed?.();
      return;
    }
    lastCanvasSeedNonceRef.current = fresh[fresh.length - 1]!.nonce;

    if (seedsProp) {
      onCanvasSeedHitConsumed?.();
      return;
    }

    setScribbleSeeds((prev) => {
      let next = prev;
      for (const hit of fresh) {
        const id = studioAutoColorCanvasSeedId(canvasSeedSequenceRef.current);
        canvasSeedSequenceRef.current += 1;
        next = appendStudioAutoColorScribbleSeed(next, {
          id,
          x: hit.x,
          y: hit.y,
          color: [
            activePalette.color[0],
            activePalette.color[1],
            activePalette.color[2],
            activePalette.color[3],
          ],
        });
      }
      return next;
    });
    const last = fresh[fresh.length - 1]!;
    setApplyStatus(
      fresh.length === 1
        ? `캔버스 시드 · ${activePalette.label} @ (${Math.round(last.x)}, ${Math.round(last.y)})`
        : `스트로크 시드 ${fresh.length.toLocaleString("ko-KR")}개 · ${activePalette.label}`,
    );
    onCanvasSeedHitConsumed?.();
  }, [canvasSeedHit, canvasSeedHits, seedsProp, activePalette, onCanvasSeedHitConsumed]);
  // Enable from summary metrics only (refs are set synchronously before summary state).
  const canApplySelected =
    Boolean(onApplyResult)
    && summary?.status === "ready"
    && (summary.operationCount ?? 0) > 0;
  const canApplyNewLayer =
    Boolean(onApplyNewLayer)
    && summary?.status === "ready"
    && (summary.operationCount ?? 0) > 0;
  const canApply =
    applyTargetMode === "new-paint-layer" ? canApplyNewLayer : canApplySelected;

  async function runPlanner() {
    if (busy || applying) return;
    setBusy(true);
    setError(null);
    setCopyStatus(null);
    setApplyStatus(null);
    try {
      const resolved = await resolveRequest({
        image,
        imageSrc,
        seeds: effectiveSeeds,
        request,
      });
      setUsingDemo(resolved.usingDemo);
      plannedImageRef.current = resolved.image;
      onPlanImageSize?.({
        width: resolved.image.width,
        height: resolved.image.height,
      });
      const nextPlan = await Promise.resolve(
        onRun ? onRun(resolved.request) : planStudioAutoColorHints(resolved.request),
      );
      planRef.current = nextPlan;
      setSummary(summarizeStudioAutoColorHintPlan(nextPlan));
      onPlan?.(nextPlan);
    } catch (caught) {
      setSummary(null);
      planRef.current = null;
      plannedImageRef.current = null;
      onPlanImageSize?.(null);
      setError(
        caught instanceof Error
          ? caught.message
          : "자동 채색 힌트 계획을 계산하지 못했어요.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function applyPlan() {
    const activePlan = planRef.current;
    const plannedImage = plannedImageRef.current;
    if (!activePlan || !plannedImage) {
      setError("적용할 계획이 없어요. 먼저 힌트 계획을 실행하세요.");
      return;
    }
    if (activePlan.status !== "ready" || activePlan.operations.length === 0) {
      setError("준비된 연산이 없어 적용할 수 없어요. 시드를 조정한 뒤 다시 계획하세요.");
      return;
    }
    const useNewLayer = applyTargetMode === "new-paint-layer";
    if (useNewLayer && !onApplyNewLayer) {
      setError("새 채색 레이어 적용 경로가 연결되지 않았어요.");
      return;
    }
    if (!useNewLayer && !onApplyResult) {
      setError("선택 레이어 적용 경로가 연결되지 않았어요.");
      return;
    }
    setApplying(true);
    setError(null);
    setApplyStatus(null);
    try {
      const batch = useNewLayer
        ? applyStudioAutoColorHintsToPaintTarget({
            plan: activePlan,
            paintTarget: createStudioAutoColorBlankPaintTarget(
              plannedImage.width,
              plannedImage.height,
            ),
            referenceImage: plannedImage,
          })
        : applyStudioAutoColorHintsAdvancedFillBatch({
            plan: activePlan,
            target: plannedImage,
            referenceImage: plannedImage,
          });
      if (!batch.ok) {
        setError(batch.reason);
        return;
      }
      if (batch.status === "noop") {
        setApplyStatus("칠할 픽셀이 없어 적용을 건너뛰었어요.");
        return;
      }
      const dataUrl = encodeStudioAutoColorHintImageToPngDataUrl(batch.imageData);
      if (useNewLayer) {
        onApplyNewLayer!({
          dataUrl,
          width: batch.imageData.width,
          height: batch.imageData.height,
          name: "채색",
        });
        setApplyStatus(
          `새 채색 레이어 생성 · 연산 ${batch.jobCount.toLocaleString("ko-KR")} · 픽셀 ${batch.paintedPixelCount.toLocaleString("ko-KR")}`,
        );
      } else {
        onApplyResult!(dataUrl);
        setApplyStatus(
          `선택 레이어 적용 · 연산 ${batch.jobCount.toLocaleString("ko-KR")} · 픽셀 ${batch.paintedPixelCount.toLocaleString("ko-KR")}`,
        );
      }
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "고급 채우기 배치를 적용하지 못했어요.",
      );
    } finally {
      setApplying(false);
    }
  }

  function addRecommendationSeed(componentLabel: number, x: number, y: number) {
    if (seedsProp) return;
    const seed = studioAutoColorScribbleSeedFromRecommendation({
      componentLabel,
      x,
      y,
      color: activePalette.color,
    });
    setScribbleSeeds((prev) => appendStudioAutoColorScribbleSeed(prev, seed));
    setApplyStatus(
      `스크리블 시드 추가 · ${activePalette.label} @ (${x}, ${y}) · 다시 계획하세요`,
    );
  }

  async function copyPlan() {
    if (!summary) return;
    const ok = await copyTextToClipboard(summary.copyText);
    setCopyStatus(ok ? "요약을 클립보드에 복사했어요." : "클립보드에 복사하지 못했어요. 요약을 직접 선택해 복사하세요.");
  }

  return (
    <section
      data-studio-auto-color-hints-panel="true"
      data-testid="studio-auto-color-hints-panel"
      aria-labelledby={titleId}
      aria-busy={busy || applying}
      className="w-full min-w-0 overflow-hidden rounded-xl border border-line bg-panel/60"
    >
      <header className="border-b border-line px-3 py-3">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
          <div className="flex min-w-0 items-start gap-2">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
              <Sparkles size={16} aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h3 id={titleId} className="text-sm font-bold text-fg">
                자동 채색 힌트
              </h3>
              <p className="mt-0.5 text-[0.68rem] leading-relaxed text-fg-3">
                스크리블 시드로 영역을 지정한 뒤 계획하고, 확인 후에만 고급 채우기 배치로 적용합니다.
              </p>
            </div>
          </div>
          <span
            role="status"
            className="inline-flex min-h-7 shrink-0 items-center gap-1 rounded-full border border-accent/30 bg-accent-soft/60 px-2 text-[0.64rem] font-semibold text-accent"
            title="자동 덮어쓰기 없음 · 적용은 명시 버튼"
            aria-label="계획 전용 — 픽셀 자동 적용 없음"
          >
            계획 전용
          </span>
        </div>
      </header>

      <div className="space-y-3 p-3">
        <p
          id={helpId}
          className="flex min-h-11 min-w-0 items-start gap-2 rounded-lg border border-line bg-card/40 px-3 py-2 text-[0.68rem] leading-relaxed text-fg-3"
        >
          <Info size={15} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
          <span className="min-w-0 break-words">
            색을 고른 뒤 권장 영역에 스크리블 시드를 붙이고 계획을 실행하세요. 적용은 아래
            「고급 채우기로 적용」에서만 일어나며, 충돌이 있으면 차단됩니다.
          </span>
        </p>

        {/* Scribble seed brush palette + optional canvas arm */}
        <div
          data-studio-auto-color-scribble="true"
          className="space-y-2 rounded-lg border border-line bg-card/40 p-2.5"
        >
          <div className="flex items-center gap-2 text-[0.68rem] font-semibold text-fg-2">
            <Paintbrush size={14} className="text-accent" aria-hidden="true" />
            스크리블 시드 색
          </div>
          <button
            type="button"
            data-studio-auto-color-canvas-scribble="true"
            aria-pressed={canvasArmed}
            disabled={
              Boolean(seedsProp) ||
              ((busy || applying) && !canvasArmed)
            }
            onClick={() => setCanvasArmed(!canvasArmed)}
            className={cx(
              "flex min-h-11 w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-[0.68rem] font-semibold transition-colors",
              canvasArmed
                ? "border-accent/50 bg-accent-soft/40 text-accent"
                : "border-line bg-card text-fg-2 hover:bg-raised",
              "disabled:cursor-not-allowed disabled:opacity-40",
              controlFocusClass,
            )}
          >
            <Crosshair size={15} aria-hidden="true" />
            <span className="min-w-0">
              <span className="block">캔버스에 시드 찍기</span>
              <span className="mt-0.5 block font-normal leading-snug text-fg-3">
                {canvasArmed
                  ? "켜짐 · 선화 위를 드래그하면 스트로크를 따라 시드가 찍힙니다"
                  : "축 정렬·반전 선화 위에 클릭·드래그해 시드를 찍습니다"}
              </span>
            </span>
          </button>
          <div
            role="radiogroup"
            aria-label="스크리블 시드 색"
            className="flex flex-wrap gap-1.5"
          >
            {STUDIO_AUTO_COLOR_SCRIBBLE_PALETTE.map((entry) => {
              const active = entry.id === activePalette.id;
              return (
                <button
                  key={entry.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  aria-label={entry.label}
                  title={entry.label}
                  onClick={() => setActivePaletteId(entry.id)}
                  className={cx(
                    "grid size-9 place-items-center rounded-lg border transition-colors",
                    active
                      ? "border-accent ring-2 ring-accent/35"
                      : "border-line hover:border-line-strong",
                    controlFocusClass,
                  )}
                  style={{ background: rgbaCss(entry.color) }}
                />
              );
            })}
          </div>
          <p className="text-[0.64rem] leading-relaxed text-fg-3">
            활성: <span className="font-semibold text-fg-2">{activePalette.label}</span>
            {" · "}
            시드 {effectiveSeeds.length.toLocaleString("ko-KR")}개
            {!seedsProp && scribbleSeeds.length > 0 ? (
              <>
                {" · "}
                <button
                  type="button"
                  className={cx("font-semibold text-accent underline-offset-2 hover:underline", controlFocusClass)}
                  onClick={() => setScribbleSeeds([])}
                >
                  시드 비우기
                </button>
              </>
            ) : null}
          </p>
        </div>

        <button
          type="button"
          aria-describedby={helpId}
          onClick={() => {
            void runPlanner();
          }}
          disabled={busy || applying}
          className={cx(
            "inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-accent bg-accent px-3 text-xs font-bold text-on-accent transition-colors hover:bg-accent-2",
            "disabled:cursor-not-allowed disabled:border-line disabled:bg-raised disabled:text-fg-3 disabled:opacity-60",
            controlFocusClass,
          )}
        >
          {busy ? (
            <Loader2
              size={16}
              className="animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
          ) : (
            <Sparkles size={16} aria-hidden="true" />
          )}
          {busy ? "계획 계산 중…" : "힌트 계획 실행"}
        </button>

        {usingDemo && summary ? (
          <p className="text-center text-[0.64rem] leading-relaxed text-fg-3">
            데모 선화로 계산했습니다. 이미지 레이어를 선택한 뒤 다시 실행하면 선택 선화를 사용합니다.
          </p>
        ) : null}

        {error ? (
          <p
            role="alert"
            className="flex min-h-11 min-w-0 items-start gap-2 rounded-lg border border-warn/35 bg-warn/10 px-3 py-2 text-[0.68rem] leading-relaxed text-warn"
          >
            <TriangleAlert size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span className="min-w-0 break-words">{error}</span>
          </p>
        ) : null}

        {summary ? (
          <div
            id={summaryId}
            className="space-y-2 rounded-lg border border-line bg-card/50 p-3"
            aria-live="polite"
          >
            <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
              <p className="min-w-0 text-xs font-semibold text-fg-1">{summary.headline}</p>
              <span
                className={cx(
                  "inline-flex min-h-7 shrink-0 items-center rounded-full border px-2 text-[0.64rem] font-semibold",
                  summary.status === "ready"
                    ? "border-good/30 bg-good/10 text-good"
                    : "border-warn/35 bg-warn/10 text-warn",
                )}
              >
                {summary.statusLabel}
              </span>
            </div>

            <dl className="grid grid-cols-2 gap-2 text-[0.68rem] tabular-nums">
              <div className="rounded-md border border-line bg-panel/40 px-2 py-1.5">
                <dt className="text-fg-3">영역</dt>
                <dd className="font-semibold text-fg-1">{summary.regionCount.toLocaleString("ko-KR")}</dd>
              </div>
              <div className="rounded-md border border-line bg-panel/40 px-2 py-1.5">
                <dt className="text-fg-3">제안 연산</dt>
                <dd className="font-semibold text-fg-1">
                  {summary.operationCount.toLocaleString("ko-KR")}
                </dd>
              </div>
              <div className="rounded-md border border-line bg-panel/40 px-2 py-1.5">
                <dt className="text-fg-3">충돌</dt>
                <dd className="font-semibold text-fg-1">
                  {summary.conflictCount.toLocaleString("ko-KR")}
                </dd>
              </div>
              <div className="rounded-md border border-line bg-panel/40 px-2 py-1.5">
                <dt className="text-fg-3">권장 시드</dt>
                <dd className="font-semibold text-fg-1">
                  {summary.recommendationCount.toLocaleString("ko-KR")}
                </dd>
              </div>
            </dl>

            <ul className="max-h-40 space-y-1 overflow-y-auto text-[0.66rem] leading-relaxed text-fg-3">
              {summary.detailLines.map((line, index) => (
                <li key={`${index}:${line.slice(0, 24)}`} className="break-words">
                  {line}
                </li>
              ))}
            </ul>

            {planRef.current && planRef.current.recommendations.length > 0 && !seedsProp ? (
              <div className="space-y-1.5 rounded-md border border-line bg-panel/30 p-2">
                <p className="text-[0.64rem] font-semibold text-fg-2">권장 영역에 스크리블 시드</p>
                <div className="flex flex-wrap gap-1.5">
                  {planRef.current.recommendations.slice(0, 8).map((rec) => (
                    <button
                      key={`rec-${rec.componentLabel}`}
                      type="button"
                      data-studio-auto-color-scribble-add="true"
                      onClick={() =>
                        addRecommendationSeed(rec.componentLabel, rec.seed.x, rec.seed.y)
                      }
                      className={cx(
                        "inline-flex min-h-9 items-center rounded-md border border-line bg-card px-2 text-[0.64rem] font-semibold text-fg-2 hover:border-accent/50 hover:text-accent",
                        controlFocusClass,
                      )}
                    >
                      영역 #{rec.componentLabel} · {activePalette.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="grid gap-2">
              <button
                type="button"
                onClick={() => {
                  void copyPlan();
                }}
                className={cx(
                  "inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-line bg-raised px-3 text-xs font-semibold text-fg-2 transition-colors hover:border-line-strong hover:bg-card",
                  controlFocusClass,
                )}
              >
                <Copy size={14} aria-hidden="true" />
                계획 복사
              </button>

              {onApplyResult || onApplyNewLayer ? (
                <div
                  data-studio-auto-color-apply-target="true"
                  className="space-y-2 rounded-lg border border-line bg-panel/30 p-2"
                >
                  <p className="text-[0.64rem] font-semibold text-fg-2">적용 대상</p>
                  <div
                    role="radiogroup"
                    aria-label="자동 채색 적용 대상"
                    className="grid grid-cols-2 gap-1.5"
                  >
                    {STUDIO_AUTO_COLOR_APPLY_TARGET_MODES.map((mode) => {
                      const available =
                        mode.id === "new-paint-layer" ? Boolean(onApplyNewLayer) : Boolean(onApplyResult);
                      const active = applyTargetMode === mode.id;
                      return (
                        <button
                          key={mode.id}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          disabled={!available}
                          title={mode.description}
                          onClick={() => setApplyTargetMode(mode.id)}
                          className={cx(
                            "min-h-11 rounded-md border px-2 py-1.5 text-left text-[0.64rem] font-semibold transition-colors",
                            active
                              ? "border-accent/50 bg-accent-soft/40 text-accent"
                              : "border-line bg-card text-fg-2 hover:bg-raised",
                            "disabled:cursor-not-allowed disabled:opacity-40",
                            controlFocusClass,
                          )}
                        >
                          <span className="block">{mode.label}</span>
                          <span className="mt-0.5 block font-normal leading-snug text-fg-3">
                            {mode.description}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <button
                    type="button"
                    data-studio-auto-color-apply="true"
                    disabled={!canApply || applying || busy}
                    onClick={() => {
                      void applyPlan();
                    }}
                    className={cx(
                      "inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-good/50 bg-good/15 px-3 text-xs font-bold text-good transition-colors hover:bg-good/25",
                      "disabled:cursor-not-allowed disabled:border-line disabled:bg-raised disabled:text-fg-3 disabled:opacity-60",
                      controlFocusClass,
                    )}
                  >
                    {applying ? (
                      <Loader2
                        size={16}
                        className="animate-spin motion-reduce:animate-none"
                        aria-hidden="true"
                      />
                    ) : (
                      <Paintbrush size={16} aria-hidden="true" />
                    )}
                    {applying
                      ? "적용 중…"
                      : applyTargetMode === "new-paint-layer"
                        ? "새 채색 레이어에 적용"
                        : "선택 레이어에 적용"}
                  </button>
                </div>
              ) : null}
            </div>

            {copyStatus ? (
              <p className="text-center text-[0.64rem] text-fg-3" role="status">
                {copyStatus}
              </p>
            ) : null}
            {applyStatus ? (
              <p className="text-center text-[0.64rem] text-fg-3" role="status">
                {applyStatus}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
