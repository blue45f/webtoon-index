/**
 * THESIS: A flattened webtoon cut becomes editable through one protected review flow, never a
 * surprise destructive action. The canvas remains the hero and settings recede to a compact rail.
 *
 * OWN-WORLD: ToonSpectrum warm-ink surfaces, persimmon matte overlays, hairline partitions and
 * familiar professional-editor tabs. No decorative glass, nested cards or remote-AI spectacle.
 *
 * STORY: The artist sees what is local, reviews the exact foreground boundary, corrects uncertain
 * pixels, compares source/background/composite, then applies one reversible layer group.
 *
 * FIRST VIEWPORT: Large image comparison left, concise extraction state and controls right,
 * persistent Cancel/Apply actions below. Mobile turns into a full-screen preview-first sheet.
 *
 * FORM: An established Studio-world extension: protected visual review rather than a settings
 * modal, optimized for repeated production work and coarse-pointer correction.
 */
import {
  Check,
  CircleDashed,
  Eraser,
  Eye,
  Image,
  Layers3,
  Loader2,
  Paintbrush,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  X,
} from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from "react";
import { createPortal } from "react-dom";

import {
  STUDIO_EASE,
  STUDIO_FOCUS_RING,
} from "../studio-panel-ui";
import { useStudioModalSheet } from "../useStudioModalSheet";

import {
  STUDIO_LAYER_LIFT_CORRECTION_MAX_POINTS,
  type StudioLayerLiftCorrectionMode,
  type StudioLayerLiftCorrectionPoint,
  type StudioLayerLiftCorrectionStroke,
} from "./studio-layer-lift-correction";

import { cn } from "@/shared/lib/utils";

export type StudioLayerLiftDialogPhase =
  | "analyzing"
  | "review"
  | "applying"
  | "error";

export type StudioLayerLiftReviewView =
  | "composite"
  | "source"
  | "mask"
  | "background"
  | "foreground";

export interface StudioLayerLiftReviewOptions {
  readonly threshold: number;
  readonly feather: number;
}

export interface StudioLayerLiftReviewDiagnostic {
  readonly id: string;
  readonly tone: "info" | "warning";
  readonly message: string;
}

export interface StudioLayerLiftReviewPreview {
  readonly width: number;
  readonly height: number;
  readonly sourceSrc: string;
  readonly compositeSrc: string;
  readonly maskSrc: string;
  readonly backgroundSrc: string;
  readonly foregroundSrc: string;
  readonly maskAlpha: Uint8Array<ArrayBuffer>;
  readonly confidenceScore: number;
  readonly confidenceBand: "low" | "medium" | "high";
  readonly backgroundRepairQuality: "good" | "review";
  readonly diagnostics: readonly StudioLayerLiftReviewDiagnostic[];
}

export interface StudioLayerLiftDialogProps {
  readonly open: boolean;
  readonly activeKey: string;
  readonly sourceName: string;
  readonly sourceSrc: string;
  readonly phase: StudioLayerLiftDialogPhase;
  readonly progressLabel?: string | null;
  readonly error?: string | null;
  readonly preview?: StudioLayerLiftReviewPreview | null;
  readonly options: StudioLayerLiftReviewOptions;
  readonly mutationLocked?: boolean;
  readonly mutationLockReason?: string | null;
  readonly onOptionsChange: (options: StudioLayerLiftReviewOptions) => void;
  readonly onAnalyze: () => void;
  readonly onCorrectionCommit: (
    stroke: StudioLayerLiftCorrectionStroke,
  ) => void | Promise<void>;
  readonly onApply: () => void;
  readonly onCancel: () => void;
}

const REVIEW_VIEWS: readonly {
  readonly id: StudioLayerLiftReviewView;
  readonly label: string;
}[] = Object.freeze([
  { id: "composite", label: "합성" },
  { id: "source", label: "원본" },
  { id: "mask", label: "경계 보정" },
  { id: "background", label: "배경" },
  { id: "foreground", label: "전경" },
]);

const CONFIDENCE_LABELS = Object.freeze({
  low: "낮은 신뢰도",
  medium: "검토 권장",
  high: "좋은 경계",
});

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function sourcePixelPoint(
  event: ReactPointerEvent<HTMLCanvasElement>,
  width: number,
  height: number,
): StudioLayerLiftCorrectionPoint | null {
  const rect = event.currentTarget.getBoundingClientRect();
  if (!(rect.width > 0 && rect.height > 0)) return null;
  return Object.freeze({
    x: clamp((event.clientX - rect.left) / rect.width * width, 0, width),
    y: clamp((event.clientY - rect.top) / rect.height * height, 0, height),
  });
}

function paintMaskOverlay(
  canvas: HTMLCanvasElement,
  mask: Uint8Array<ArrayBuffer>,
  width: number,
  height: number,
): void {
  if (
    width < 1
    || height < 1
    || mask.byteLength !== width * height
  ) {
    canvas.width = 1;
    canvas.height = 1;
    return;
  }
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return;
  const image = context.createImageData(width, height);
  for (let index = 0; index < mask.length; index += 1) {
    const alpha = mask[index]!;
    const offset = index * 4;
    image.data[offset] = 235;
    image.data[offset + 1] = 111;
    image.data[offset + 2] = 43;
    image.data[offset + 3] = Math.round(alpha * 0.58);
  }
  context.clearRect(0, 0, width, height);
  context.putImageData(image, 0, 0);
}

function drawCorrectionPreviewSegment(input: {
  readonly canvas: HTMLCanvasElement;
  readonly from: StudioLayerLiftCorrectionPoint;
  readonly to: StudioLayerLiftCorrectionPoint;
  readonly radius: number;
  readonly mode: StudioLayerLiftCorrectionMode;
}): void {
  const context = input.canvas.getContext("2d");
  if (!context) return;
  context.save();
  context.globalCompositeOperation =
    input.mode === "include" ? "source-over" : "destination-out";
  context.strokeStyle = "oklch(0.72 0.185 42 / 0.82)";
  context.fillStyle = "oklch(0.72 0.185 42 / 0.82)";
  context.lineWidth = input.radius * 2;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.beginPath();
  context.moveTo(input.from.x, input.from.y);
  context.lineTo(input.to.x, input.to.y);
  context.stroke();
  if (input.from.x === input.to.x && input.from.y === input.to.y) {
    context.beginPath();
    context.arc(input.to.x, input.to.y, input.radius, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();
}

function previewSource(
  preview: StudioLayerLiftReviewPreview,
  view: Exclude<StudioLayerLiftReviewView, "mask">,
): string {
  if (view === "source") return preview.sourceSrc;
  if (view === "background") return preview.backgroundSrc;
  if (view === "foreground") return preview.foregroundSrc;
  return preview.compositeSrc;
}

function StudioLayerLiftCorrectionCanvas({
  preview,
  mode,
  radius,
  busy,
  onCommit,
}: {
  readonly preview: StudioLayerLiftReviewPreview;
  readonly mode: StudioLayerLiftCorrectionMode;
  readonly radius: number;
  readonly busy: boolean;
  readonly onCommit: (
    stroke: StudioLayerLiftCorrectionStroke,
  ) => void | Promise<void>;
}): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const activePointerRef = useRef<number | null>(null);
  const pointsRef = useRef<StudioLayerLiftCorrectionPoint[]>([]);
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;
  const [committing, setCommitting] = useState(false);

  const restoreOverlay = () => {
    const canvas = canvasRef.current;
    if (canvas) {
      paintMaskOverlay(
        canvas,
        preview.maskAlpha,
        preview.width,
        preview.height,
      );
    }
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      paintMaskOverlay(
        canvas,
        preview.maskAlpha,
        preview.width,
        preview.height,
      );
    }
  }, [preview.maskAlpha, preview.width, preview.height]);

  const complete = async (
    event: ReactPointerEvent<HTMLCanvasElement>,
    cancelled: boolean,
  ) => {
    if (activePointerRef.current !== event.pointerId) return;
    activePointerRef.current = null;
    try {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    } catch {
      // A browser can release capture before pointercancel reaches React.
    }
    const points = pointsRef.current;
    pointsRef.current = [];
    if (cancelled || points.length === 0) {
      restoreOverlay();
      return;
    }
    setCommitting(true);
    try {
      await commitRef.current(Object.freeze({
        mode,
        radius,
        points: Object.freeze([...points]),
      }));
    } finally {
      setCommitting(false);
      restoreOverlay();
    }
  };

  const disabled = busy || committing;
  return (
    <div
      className="relative mx-auto max-h-full max-w-full overflow-hidden rounded-xl border border-line bg-canvas shadow-[0_8px_28px_oklch(0.08_0.01_70/0.32)]"
      style={{
        aspectRatio: `${preview.width} / ${preview.height}`,
        width: `min(100%, calc((100dvh - 15rem) * ${preview.width / preview.height}))`,
      }}
      data-studio-layer-lift-correction="true"
    >
      <img
        src={preview.sourceSrc}
        alt=""
        draggable={false}
        className="absolute inset-0 size-full select-none object-contain"
      />
      <canvas
        ref={canvasRef}
        width={preview.width}
        height={preview.height}
        aria-label={`${mode === "include" ? "전경에 포함" : "전경에서 제외"}할 영역을 칠하는 보정 캔버스`}
        aria-describedby="studio-layer-lift-correction-help"
        onPointerDown={(event) => {
          if (disabled || activePointerRef.current !== null) return;
          const point = sourcePixelPoint(event, preview.width, preview.height);
          if (!point) return;
          activePointerRef.current = event.pointerId;
          pointsRef.current = [point];
          try {
            event.currentTarget.setPointerCapture?.(event.pointerId);
          } catch {
            // Global pointer completion still ends the session in supporting browsers.
          }
          drawCorrectionPreviewSegment({
            canvas: event.currentTarget,
            from: point,
            to: point,
            radius,
            mode,
          });
        }}
        onPointerMove={(event) => {
          if (
            disabled
            || activePointerRef.current !== event.pointerId
            || pointsRef.current.length >= STUDIO_LAYER_LIFT_CORRECTION_MAX_POINTS
          ) {
            return;
          }
          const point = sourcePixelPoint(event, preview.width, preview.height);
          const previous = pointsRef.current.at(-1);
          if (!point || !previous) return;
          pointsRef.current.push(point);
          drawCorrectionPreviewSegment({
            canvas: event.currentTarget,
            from: previous,
            to: point,
            radius,
            mode,
          });
        }}
        onPointerUp={(event) => void complete(event, false)}
        onPointerCancel={(event) => void complete(event, true)}
        className={cn(
          "absolute inset-0 size-full touch-none",
          mode === "include"
            ? "cursor-cell"
            : "cursor-crosshair",
          disabled && "cursor-wait opacity-70",
          STUDIO_FOCUS_RING,
        )}
      />
      {committing ? (
        <div
          className="pointer-events-none absolute inset-x-3 bottom-3 flex items-center justify-center gap-2 rounded-xl bg-panel/95 px-3 py-2 text-xs font-semibold text-accent shadow-lg"
          role="status"
          aria-live="polite"
        >
          <Loader2 size={14} className="animate-spin motion-reduce:animate-none" aria-hidden />
          보정 경계를 다시 합성하는 중…
        </div>
      ) : null}
    </div>
  );
}

function StudioLayerLiftPreviewPane({
  preview,
  view,
  correctionMode,
  correctionRadius,
  busy,
  onCorrectionCommit,
}: {
  readonly preview: StudioLayerLiftReviewPreview;
  readonly view: StudioLayerLiftReviewView;
  readonly correctionMode: StudioLayerLiftCorrectionMode;
  readonly correctionRadius: number;
  readonly busy: boolean;
  readonly onCorrectionCommit: (
    stroke: StudioLayerLiftCorrectionStroke,
  ) => void | Promise<void>;
}): ReactElement {
  if (view === "mask") {
    return (
      <StudioLayerLiftCorrectionCanvas
        preview={preview}
        mode={correctionMode}
        radius={correctionRadius}
        busy={busy}
        onCommit={onCorrectionCommit}
      />
    );
  }

  return (
    <div
      className="relative mx-auto grid max-h-full max-w-full place-items-center overflow-hidden rounded-xl border border-line bg-canvas shadow-[0_8px_28px_oklch(0.08_0.01_70/0.32)]"
      style={{
        aspectRatio: `${preview.width} / ${preview.height}`,
        width: `min(100%, calc((100dvh - 15rem) * ${preview.width / preview.height}))`,
        backgroundImage:
          view === "foreground"
            ? "conic-gradient(from 90deg at 1px 1px, oklch(0.24 0.011 64) 25%, oklch(0.19 0.009 68) 0)"
            : undefined,
        backgroundSize: view === "foreground" ? "16px 16px" : undefined,
      }}
    >
      <img
        src={previewSource(preview, view)}
        alt={
          view === "source"
            ? "분리 전 원본"
            : view === "background"
              ? "전경을 제거하고 복원한 배경"
              : view === "foreground"
                ? "투명 배경의 분리 전경"
                : "배경과 전경을 다시 합성한 결과"
        }
        draggable={false}
        className="max-h-full max-w-full select-none object-contain"
      />
    </div>
  );
}

function percent(value: number): string {
  return `${Math.round(clamp(value, 0, 1) * 100)}%`;
}

export function StudioLayerLiftDialog({
  open,
  activeKey,
  sourceName,
  sourceSrc,
  phase,
  progressLabel,
  error,
  preview,
  options,
  mutationLocked = false,
  mutationLockReason,
  onOptionsChange,
  onAnalyze,
  onCorrectionCommit,
  onApply,
  onCancel,
}: StudioLayerLiftDialogProps): ReactElement | null {
  const id = useId().replace(/:/gu, "");
  const dialogRef = useRef<HTMLElement>(null);
  const portalRootRef = useRef<HTMLElement | null>(
    typeof document === "undefined" ? null : document.body,
  );
  const [view, setView] = useState<StudioLayerLiftReviewView>("composite");
  const [correctionMode, setCorrectionMode] =
    useState<StudioLayerLiftCorrectionMode>("include");
  const [correctionRadius, setCorrectionRadius] = useState(24);
  const busy = phase === "analyzing" || phase === "applying";
  const canApply = phase === "review" && preview !== null && preview !== undefined
    && !mutationLocked;
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;
  const statusId = `${id}-status`;
  const mutationLockId = `${id}-mutation-lock`;
  const describedBy = [
    descriptionId,
    statusId,
    mutationLocked ? mutationLockId : null,
  ].filter(Boolean).join(" ");

  useStudioModalSheet({
    activeKey: open ? activeKey : null,
    dialogRef,
    onDismiss: onCancel,
    resolveInitialFocus: (dialog) =>
      dialog.querySelector<HTMLElement>("[data-autofocus='true']"),
    rootRef: portalRootRef,
  });

  if (!open || typeof document === "undefined") return null;

  const content = (
    <div className="fixed inset-0 z-[140] flex items-stretch justify-center pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] sm:items-center sm:p-4">
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        data-studio-modal-backdrop="true"
        onClick={onCancel}
        className="absolute inset-0 cursor-default bg-[oklch(0.08_0.01_70/0.86)] backdrop-blur-sm"
      />
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={describedBy}
        aria-busy={busy || undefined}
        data-studio-layer-lift-dialog="true"
        data-studio-shortcut-boundary="true"
        tabIndex={-1}
        className="relative flex h-[100dvh] min-h-0 w-full min-w-0 flex-col overflow-hidden border-line-strong bg-panel pb-[env(safe-area-inset-bottom)] text-fg shadow-2xl sm:h-[min(92dvh,58rem)] sm:max-w-6xl sm:rounded-2xl sm:border sm:pb-0"
      >
        <header className="flex shrink-0 items-start gap-3 border-b border-line px-3 py-3 sm:px-4">
          <span className="mt-0.5 grid size-10 shrink-0 place-items-center rounded-xl border border-accent/35 bg-accent-soft text-accent">
            <Layers3 size={19} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              <h2 id={titleId} className="truncate text-sm font-bold tracking-tight text-fg">
                컷 레이어 복원
              </h2>
              <span className="rounded-full border border-accent/40 bg-accent-soft px-2 py-0.5 text-[0.6rem] font-bold text-accent">
                로컬 Beta
              </span>
            </div>
            <p id={descriptionId} className="mt-0.5 truncate text-[0.7rem] leading-relaxed text-fg-3">
              {sourceName} · 원본을 보존하고 배경·전경 레이어를 만듭니다.
            </p>
          </div>
          <div className="hidden shrink-0 items-center gap-1.5 text-[0.66rem] text-fg-3 sm:flex">
            <span className={phase === "analyzing" ? "font-bold text-accent" : undefined}>분석</span>
            <span aria-hidden>·</span>
            <span className={phase === "review" ? "font-bold text-accent" : undefined}>보정</span>
            <span aria-hidden>·</span>
            <span className={phase === "applying" ? "font-bold text-accent" : undefined}>적용</span>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="컷 레이어 복원 닫기"
            className={cn(
              "grid size-11 shrink-0 place-items-center rounded-xl text-fg-3 hover:bg-raised hover:text-fg",
              STUDIO_EASE,
              STUDIO_FOCUS_RING,
            )}
          >
            <X size={18} aria-hidden />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_19rem]">
          <main className="flex min-h-[44dvh] min-w-0 flex-1 flex-col border-line lg:min-h-0 lg:border-r">
            <div
              role="tablist"
              aria-label="레이어 복원 미리보기"
              className="flex min-w-0 shrink-0 gap-1 overflow-x-auto border-b border-line px-2 py-2 [scrollbar-width:thin] sm:px-3"
            >
              {REVIEW_VIEWS.map((entry) => {
                const selected = view === entry.id;
                const disabled = !preview && entry.id !== "source";
                return (
                  <button
                    key={entry.id}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    disabled={disabled}
                    onClick={() => setView(entry.id)}
                    className={cn(
                      "inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl border px-3 text-[0.7rem] font-semibold",
                      selected
                        ? "border-accent/55 bg-accent-soft text-fg"
                        : "border-transparent text-fg-3 hover:border-line hover:bg-raised hover:text-fg",
                      "disabled:cursor-not-allowed disabled:opacity-35",
                      STUDIO_EASE,
                      STUDIO_FOCUS_RING,
                    )}
                  >
                    {entry.id === "mask" ? <Paintbrush size={14} aria-hidden /> : <Eye size={14} aria-hidden />}
                    {entry.label}
                  </button>
                );
              })}
            </div>

            <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-auto bg-canvas/75 p-3 sm:p-5">
              {preview ? (
                <StudioLayerLiftPreviewPane
                  preview={preview}
                  view={view}
                  correctionMode={correctionMode}
                  correctionRadius={correctionRadius}
                  busy={busy}
                  onCorrectionCommit={onCorrectionCommit}
                />
              ) : (
                <div className="relative grid max-h-full w-full max-w-3xl place-items-center overflow-hidden rounded-xl border border-line bg-canvas">
                  <img
                    src={sourceSrc}
                    alt="레이어 분리를 기다리는 원본"
                    draggable={false}
                    className="max-h-[60dvh] max-w-full object-contain opacity-55"
                  />
                  <div className="absolute inset-0 grid place-items-center bg-canvas/45">
                    <div className="max-w-[28rem] px-6 text-center">
                      {phase === "analyzing" ? (
                        <Loader2
                          size={32}
                          className="mx-auto animate-spin text-accent motion-reduce:animate-none"
                          aria-hidden
                        />
                      ) : phase === "error" ? (
                        <TriangleAlert size={32} className="mx-auto text-warn" aria-hidden />
                      ) : (
                        <CircleDashed size={32} className="mx-auto text-fg-3" aria-hidden />
                      )}
                      <p className="mt-3 text-sm font-bold text-fg">
                        {phase === "analyzing"
                          ? "인물·캐릭터 경계를 찾고 있어요"
                          : phase === "error"
                            ? "분석을 완료하지 못했습니다"
                            : "분석 준비 완료"}
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-fg-3">
                        {phase === "analyzing"
                          ? progressLabel ?? "첫 실행은 로컬 모델을 준비하느라 조금 더 걸릴 수 있습니다."
                          : error ?? "오른쪽에서 분석을 시작해 주세요."}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {view === "mask" && preview ? (
              <div className="shrink-0 border-t border-line bg-panel px-3 py-2.5">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <div role="group" aria-label="경계 보정 방식" className="flex items-center gap-1">
                    <button
                      type="button"
                      aria-pressed={correctionMode === "include"}
                      onClick={() => setCorrectionMode("include")}
                      disabled={busy}
                      className={cn(
                        "inline-flex min-h-11 items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold",
                        correctionMode === "include"
                          ? "border-accent/55 bg-accent-soft text-fg"
                          : "border-line bg-card text-fg-2 hover:bg-raised hover:text-fg",
                        STUDIO_EASE,
                        STUDIO_FOCUS_RING,
                      )}
                    >
                      <Paintbrush size={14} aria-hidden /> 전경에 포함
                    </button>
                    <button
                      type="button"
                      aria-pressed={correctionMode === "exclude"}
                      onClick={() => setCorrectionMode("exclude")}
                      disabled={busy}
                      className={cn(
                        "inline-flex min-h-11 items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold",
                        correctionMode === "exclude"
                          ? "border-accent/55 bg-accent-soft text-fg"
                          : "border-line bg-card text-fg-2 hover:bg-raised hover:text-fg",
                        STUDIO_EASE,
                        STUDIO_FOCUS_RING,
                      )}
                    >
                      <Eraser size={14} aria-hidden /> 전경에서 제외
                    </button>
                  </div>
                  <label className="ml-auto flex min-h-11 min-w-[11rem] items-center gap-2 text-[0.7rem] text-fg-2">
                    <span className="shrink-0">크기</span>
                    <input
                      type="range"
                      min={2}
                      max={128}
                      step={1}
                      value={correctionRadius}
                      disabled={busy}
                      onChange={(event) => setCorrectionRadius(Number(event.target.value))}
                      className="h-11 min-w-0 flex-1 cursor-pointer accent-accent"
                      aria-label="경계 보정 브러시 크기"
                    />
                    <span className="w-10 text-right tabular-nums text-fg-3">{correctionRadius}px</span>
                  </label>
                </div>
                <p id="studio-layer-lift-correction-help" className="mt-1 text-[0.65rem] leading-relaxed text-fg-3">
                  주황색은 전경으로 유지될 영역입니다. 빠르게 그어도 획 사이가 끊기지 않으며, 포인터를 놓을 때 한 번만 다시 합성합니다.
                </p>
              </div>
            ) : null}
          </main>

          <aside className="min-h-0 shrink-0 overflow-y-auto overscroll-contain bg-panel px-3 py-3 [scrollbar-width:thin] sm:px-4 lg:w-auto">
            <div
              id={statusId}
              className={cn(
                "flex items-start gap-2.5 rounded-xl border p-3",
                phase === "error"
                  ? "border-warn/40 bg-warn/10"
                  : preview?.confidenceBand === "high"
                    ? "border-good/35 bg-good/10"
                    : "border-accent/35 bg-accent-soft/55",
              )}
              role={phase === "error" ? "alert" : "status"}
              aria-live="polite"
              aria-atomic="true"
            >
              <span
                className={cn(
                  "grid size-9 shrink-0 place-items-center rounded-lg",
                  phase === "error" ? "text-warn" : "text-accent",
                )}
              >
                {phase === "analyzing" || phase === "applying" ? (
                  <Loader2 size={17} className="animate-spin motion-reduce:animate-none" aria-hidden />
                ) : phase === "error" ? (
                  <TriangleAlert size={17} aria-hidden />
                ) : (
                  <ShieldCheck size={17} aria-hidden />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold text-fg">
                  {phase === "analyzing"
                    ? "기기에서 분석 중"
                    : phase === "applying"
                      ? "레이어 그룹 적용 중"
                      : phase === "error"
                        ? "다시 확인이 필요해요"
                        : preview
                          ? `${CONFIDENCE_LABELS[preview.confidenceBand]} · ${percent(preview.confidenceScore)}`
                          : "분석 준비"}
                </p>
                <p className="mt-0.5 text-[0.68rem] leading-relaxed text-fg-2">
                  {phase === "error"
                    ? error ?? "이미지와 모델 상태를 확인한 뒤 다시 분석해 주세요."
                    : progressLabel ?? "이미지 픽셀은 추론 서버에 업로드하지 않습니다."}
                </p>
              </div>
            </div>

            <section className="mt-4 border-t border-line pt-4" aria-labelledby={`${id}-boundary-title`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 id={`${id}-boundary-title`} className="text-xs font-bold text-fg">
                    자동 경계
                  </h3>
                  <p className="mt-0.5 text-[0.66rem] leading-relaxed text-fg-3">
                    값을 바꾼 뒤 미리보기를 갱신합니다.
                  </p>
                </div>
                <Sparkles size={16} className="shrink-0 text-accent" aria-hidden />
              </div>
              <label className="mt-3 block text-[0.7rem] font-semibold text-fg-2">
                <span className="flex items-center justify-between gap-2">
                  전경 임계값
                  <span className="tabular-nums text-fg-3">{percent(options.threshold)}</span>
                </span>
                <input
                  type="range"
                  aria-label="전경 임계값"
                  min={0.05}
                  max={0.95}
                  step={0.01}
                  value={options.threshold}
                  disabled={busy}
                  onChange={(event) => onOptionsChange({
                    ...options,
                    threshold: Number(event.target.value),
                  })}
                  className="mt-1 h-11 w-full cursor-pointer accent-accent"
                />
              </label>
              <label className="mt-2 block text-[0.7rem] font-semibold text-fg-2">
                <span className="flex items-center justify-between gap-2">
                  경계 부드러움
                  <span className="tabular-nums text-fg-3">{percent(options.feather)}</span>
                </span>
                <input
                  type="range"
                  aria-label="경계 부드러움"
                  min={0}
                  max={0.4}
                  step={0.01}
                  value={options.feather}
                  disabled={busy}
                  onChange={(event) => onOptionsChange({
                    ...options,
                    feather: Number(event.target.value),
                  })}
                  className="mt-1 h-11 w-full cursor-pointer accent-accent"
                />
              </label>
              <button
                type="button"
                data-autofocus="true"
                onClick={onAnalyze}
                disabled={busy}
                className={cn(
                  "mt-2 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-line bg-card px-3 text-xs font-bold text-fg-2 hover:bg-raised hover:text-fg disabled:cursor-wait disabled:opacity-45",
                  STUDIO_EASE,
                  STUDIO_FOCUS_RING,
                )}
              >
                {phase === "analyzing" ? (
                  <Loader2 size={14} className="animate-spin motion-reduce:animate-none" aria-hidden />
                ) : (
                  <RefreshCw size={14} aria-hidden />
                )}
                {preview ? "미리보기 다시 만들기" : "분석 시작"}
              </button>
            </section>

            {preview ? (
              <section className="mt-4 border-t border-line pt-4" aria-labelledby={`${id}-result-title`}>
                <h3 id={`${id}-result-title`} className="text-xs font-bold text-fg">
                  생성될 레이어
                </h3>
                <ol className="mt-2 space-y-1.5 text-[0.7rem]" aria-label="적용될 레이어 순서">
                  {[
                    ["원본 백업", "숨김 · 잠금"],
                    ["분리 배경", preview.backgroundRepairQuality === "good" ? "자동 복원" : "경계 검토 필요"],
                    ["분리 전경", `신뢰도 ${percent(preview.confidenceScore)}`],
                  ].map(([label, detail], index) => (
                    <li key={label} className="flex min-h-9 items-center gap-2 rounded-lg bg-card/55 px-2.5">
                      <span className="grid size-5 shrink-0 place-items-center rounded-md bg-raised font-bold tabular-nums text-fg-3">
                        {index + 1}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-semibold text-fg-2">{label}</span>
                      <span className="shrink-0 text-[0.62rem] text-fg-3">{detail}</span>
                    </li>
                  ))}
                </ol>
                {preview.diagnostics.length > 0 ? (
                  <ul className="mt-2 space-y-1.5" aria-label="분리 검토 안내">
                    {preview.diagnostics.map((diagnostic) => (
                      <li
                        key={diagnostic.id}
                        className={cn(
                          "flex items-start gap-2 rounded-lg px-2.5 py-2 text-[0.66rem] leading-relaxed",
                          diagnostic.tone === "warning"
                            ? "bg-warn/10 text-warn"
                            : "bg-raised/70 text-fg-3",
                        )}
                      >
                        {diagnostic.tone === "warning" ? (
                          <TriangleAlert size={13} className="mt-0.5 shrink-0" aria-hidden />
                        ) : (
                          <Check size={13} className="mt-0.5 shrink-0" aria-hidden />
                        )}
                        <span>{diagnostic.message}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </section>
            ) : null}

            <div className="mt-4 flex items-start gap-2 border-t border-line pt-4 text-[0.66rem] leading-relaxed text-fg-3">
              <Image size={14} className="mt-0.5 shrink-0" aria-hidden />
              <p>
                현재 베타는 한 장의 정적 이미지에서 사람·캐릭터 전경을 찾습니다.
                원본 레이어는 숨김·잠금 상태로 보존됩니다.
              </p>
            </div>

            {mutationLocked ? (
              <p
                id={mutationLockId}
                role="status"
                aria-live="polite"
                className="mt-3 rounded-xl border border-warn/40 bg-warn/10 px-3 py-2 text-[0.68rem] leading-relaxed text-warn"
              >
                {mutationLockReason ?? "현재 문서 상태에서는 결과를 적용할 수 없습니다."}
              </p>
            ) : null}
          </aside>
        </div>

        <footer className="shrink-0 border-t border-line bg-panel/95 px-3 py-3 backdrop-blur sm:px-4">
          <div className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-[minmax(7rem,0.7fr)_minmax(10rem,1.3fr)]">
            <button
              type="button"
              onClick={onCancel}
              className={cn(
                "min-h-11 rounded-xl border border-line bg-card px-3 text-xs font-semibold text-fg-2 hover:bg-raised hover:text-fg",
                STUDIO_EASE,
                STUDIO_FOCUS_RING,
              )}
            >
              {busy ? "작업 중단" : "취소"}
            </button>
            <button
              type="button"
              onClick={onApply}
              disabled={!canApply}
              aria-describedby={mutationLocked ? mutationLockId : undefined}
              className={cn(
                "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-accent px-3 text-xs font-bold text-on-accent hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-45",
                STUDIO_EASE,
                STUDIO_FOCUS_RING,
              )}
            >
              {phase === "applying" ? (
                <Loader2 size={14} className="animate-spin motion-reduce:animate-none" aria-hidden />
              ) : (
                <Layers3 size={14} aria-hidden />
              )}
              {phase === "applying" ? "레이어를 적용하는 중…" : "원본을 보존하고 레이어로 적용"}
            </button>
          </div>
          <p className="mt-1.5 text-center text-[0.62rem] text-fg-3">
            적용 결과는 실행 취소 한 번으로 되돌릴 수 있습니다.
          </p>
        </footer>
      </section>
    </div>
  );

  return createPortal(content, document.body);
}
