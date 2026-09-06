/**
 * StudioFrameAnimationPanel — 선택한 이미지 셀을 프레임별로 그려 플립북 애니메이션으로 만드는
 * 자체완결 플로팅 패널(StudioHistoryPanel/StudioMotionExportPanel과 같은 층위). 프레임 배열
 * 자체는 studio-frame-animation(순수)이 소유하고, 이 패널은 그 함수들을 호출해 새 배열/설정을
 * 만들어 상위(StudioPage)로 올려보내기만 한다 — 로컬 상태는 재생 미리보기·내보내기 진행 상태뿐.
 * 어니언스키닝 실제 렌더(캔버스)는 StudioPage 몫이라 이 패널은 설정값만 컨트롤한다.
 */
import { ChevronLeft, ChevronRight, Copy, Download, Film, Ghost, Pause, Play, Square, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { downloadBlob } from "./export/studio-export";
import {
  FRAME_ANIM_EXPORT_SCALE_PRESETS,
  FRAME_ANIM_LOOP_COUNT_PRESETS,
  GIF_DITHER_PRESETS,
  frameAnimMediaFileName,
  frameAnimationExportFileName,
  isFrameAnimMediaExportSupported,
  isMotionExportCancelled,
  isMotionExportSupported,
  loadMotionCutImages,
  planFrameAnimationExport,
  startFrameAnimationExport,
  startFrameAnimMediaExport,
  type FrameAnimMediaProgress,
  type GifDitherMode,
  type MotionExportProgress,
} from "./export/studio-frame-animation-export";
import { confirmStudioDestructiveAction } from "./studio-destructive-action-preview";
import { studioRemoveFrameAnimationRequest } from "./studio-destructive-command-catalog";
import {
  DEFAULT_FRAME_FPS,
  MAX_ANIM_FRAMES,
  MAX_FRAME_FPS,
  MIN_FRAME_FPS,
  clampFrameIndex,
  duplicateFrame,
  frameDurationsMs,
  frameIndexAtElapsed,
  frameIndexOf,
  normalizeFrameFps,
  removeFrame,
  reorderFrame,
  setFrameDuration,
  type OnionSkinSettings,
  type StudioAnimFrame,
} from "./studio-frame-animation";
import { PANEL_LABEL_ROW, StudioSliderRow, StudioToggleChip } from "./studio-panel-ui";
import { StudioToolHintTarget } from "./StudioToolHint";

import type { ReactElement } from "react";

import { buttonClass } from "@/shared/components/ui/button-utils";
import { cn } from "@/shared/lib/utils";

// El의 구조 호환 최소 서브셋 — StudioPage.tsx의 ImageEl을 직접 import하지 않아 순환 의존을 피한다.
export interface StudioFrameAnimAnchorEl {
  id: string;
  src: string;
  width: number;
  height: number;
  rotation: number;
  frames?: StudioAnimFrame[];
  frameFps?: number;
  frameLoop?: boolean;
  activeFrameId?: string;
}

export interface StudioFrameAnimationPanelProps {
  element: StudioFrameAnimAnchorEl;
  title: string; // work.title 상당 — 내보내기 파일명용
  onClose: () => void;
  onFramesChange: (frames: StudioAnimFrame[]) => void; // 내용 변화 — 항상 undo 1스텝
  onSettingsChange: (patch: { frameFps?: number; frameLoop?: boolean }) => void; // undo 1스텝
  onActiveFrameChange: (frameId: string) => void; // 탐색 — 상위가 coalesce 커밋 처리
  onCaptureFrame: () => void; // 래스터화는 상위(StudioPage) 책임
  captureDisabledReason?: string | null; // 있으면 캡처 버튼 비활성 + 안내
  onRemoveAnimation: () => void; // 애니메이션 해제(정지 이미지로 되돌림)
  onionSkin: OnionSkinSettings;
  onOnionSkinChange: (settings: OnionSkinSettings) => void;
}

function formatSeconds(sec: number): string {
  if (sec <= 0) return "0초";
  const rounded = Math.round(sec * 10) / 10;
  return `${rounded}초`;
}

type StudioFrameAnimExportFormat = "apng" | "gif" | "webm";

const FRAME_ANIM_FORMAT_OPTIONS = [
  { id: "webm", label: "WebM 영상 (작은 용량)" },
  { id: "gif", label: "GIF 애니메이션 (어디서나 재생·256색)" },
  { id: "apng", label: "APNG (무손실·부드러운 투명)" },
] as const satisfies readonly { id: StudioFrameAnimExportFormat; label: string }[];

export function StudioFrameAnimationPanel({
  element,
  title,
  onClose,
  onFramesChange,
  onSettingsChange,
  onActiveFrameChange,
  onCaptureFrame,
  captureDisabledReason,
  onRemoveAnimation,
  onionSkin,
  onOnionSkinChange,
}: StudioFrameAnimationPanelProps): ReactElement {
  const frames = element.frames ?? [];
  const fps = normalizeFrameFps(element.frameFps ?? DEFAULT_FRAME_FPS);
  const loop = element.frameLoop ?? true;
  const activeIndex = clampFrameIndex(frames, frameIndexOf(frames, element.activeFrameId));
  const activeFrame = frames[activeIndex];

  // 재생 미리보기 상태 — activeFrameId(탐색 위치)와 별개. 재생 중엔 이 인덱스로만 미리보기를 갱신한다.
  const [playing, setPlaying] = useState(false);
  const [previewFrameId, setPreviewFrameId] = useState<string | null>(null);

  useEffect(() => {
    const activeFrames = element.frames ?? [];
    if (!playing) return;
    if (activeFrames.length < 2) {
      // 재생 중 프레임이 삭제되어 1장 이하로 줄면 애니메이션을 재생할 수 없다 — playing state 를
      // 정지로 되돌리지 않으면 재생 루프만 멈춘 채 버튼은 계속 "정지"(재생 중)로 표시된다.
      setPlaying(false);
      return;
    }
    const durations = frameDurationsMs(activeFrames, fps);
    const total = durations.reduce((sum, d) => sum + d, 0);
    const start = performance.now();
    let raf = 0;
    const tick = () => {
      const elapsed = performance.now() - start;
      const idx = frameIndexAtElapsed(durations, elapsed, loop);
      setPreviewFrameId(activeFrames[idx]?.id ?? null);
      if (!loop && elapsed >= total) {
        setPlaying(false);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, element.frames, fps, loop]);

  // Esc 로 닫기 — 입력 필드 안의 Esc 는 각 필드의 몫(StudioHistoryPanel과 동일 규약).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "TEXTAREA" || target.tagName === "INPUT" || target.isContentEditable)) {
        return;
      }
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const highlightId = playing ? (previewFrameId ?? activeFrame?.id) : activeFrame?.id;
  const highlightIndex = frameIndexOf(frames, highlightId);

  const atCap = frames.length >= MAX_ANIM_FRAMES;
  const captureReason = captureDisabledReason ?? (atCap ? `프레임은 최대 ${MAX_ANIM_FRAMES}장까지 만들 수 있어요.` : null);
  const playbackDisabledReason =
    frames.length < 2 ? "재생하려면 프레임이 2장 이상 필요해요." : undefined;
  const previousFrameDisabledReason = activeIndex === 0 ? "이미 첫 번째 프레임이에요." : undefined;
  const duplicateFrameDisabledReason = atCap
    ? `프레임은 최대 ${MAX_ANIM_FRAMES}장까지 만들 수 있어요.`
    : undefined;
  const deleteFrameDisabledReason =
    frames.length <= 1 ? "애니메이션을 유지하려면 프레임이 최소 1장 필요해요." : undefined;
  const nextFrameDisabledReason =
    activeIndex === frames.length - 1 ? "이미 마지막 프레임이에요." : undefined;

  function deleteActiveFrame() {
    if (!activeFrame) return;
    const next = removeFrame(frames, activeFrame.id);
    onFramesChange(next);
    const fallback = next[Math.min(activeIndex, next.length - 1)];
    if (fallback) onActiveFrameChange(fallback.id);
  }

  // ── 내보내기(WebM · GIF · APNG) — StudioMotionExportPanel과 동일한 아코디언 패턴 미러 ──
  const [exportOpen, setExportOpen] = useState(false);
  const [format, setFormat] = useState<StudioFrameAnimExportFormat>("webm");
  const [scaleId, setScaleId] = useState<string>(FRAME_ANIM_EXPORT_SCALE_PRESETS[1].id);
  const [loopId, setLoopId] = useState<string>(FRAME_ANIM_LOOP_COUNT_PRESETS[0].id);
  const [background, setBackground] = useState("#ffffff");
  const [transparentBg, setTransparentBg] = useState(false);
  const [ditherId, setDitherId] = useState<GifDitherMode>("none");
  const [preparing, setPreparing] = useState(false);
  const [progress, setProgress] = useState<MotionExportProgress | null>(null);
  const [mediaProgress, setMediaProgress] = useState<FrameAnimMediaProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [doneMsg, setDoneMsg] = useState<string | null>(null);
  const handleRef = useRef<{ cancel(): void } | null>(null);

  useEffect(() => {
    return () => {
      handleRef.current?.cancel();
      handleRef.current = null;
    };
  }, []);

  const webmSupported = isMotionExportSupported();
  const mediaSupported = isFrameAnimMediaExportSupported();
  const supported = format === "webm" ? webmSupported : mediaSupported;
  const scale = FRAME_ANIM_EXPORT_SCALE_PRESETS.find((s) => s.id === scaleId) ?? FRAME_ANIM_EXPORT_SCALE_PRESETS[1];
  const loopPreset = FRAME_ANIM_LOOP_COUNT_PRESETS.find((l) => l.id === loopId) ?? FRAME_ANIM_LOOP_COUNT_PRESETS[0];
  const plan = planFrameAnimationExport(element.width, element.height, frames, fps, {
    pixelRatio: scale.pixelRatio,
    loopCount: loopPreset.loopCount,
    background,
  });
  const exporting = preparing || progress != null || mediaProgress != null;

  async function exportAnimation() {
    if (exporting || !supported || frames.length < 2) return;
    setError(null);
    setDoneMsg(null);
    setPreparing(true);
    try {
      const images = await loadMotionCutImages(frames.map((f) => f.src));
      if (format === "webm") {
        const handle = startFrameAnimationExport({
          plan,
          images,
          background,
          onProgress: (p) => setProgress(p),
        });
        handleRef.current = handle;
        setPreparing(false);
        const result = await handle.done;
        downloadBlob(result.blob, frameAnimationExportFileName(title));
        setDoneMsg("애니메이션 영상을 저장했어요.");
      } else {
        const mediaFormat = format;
        const handle = startFrameAnimMediaExport({
          format: mediaFormat,
          width: plan.width,
          height: plan.height,
          frameDurations: plan.frameDurations,
          images,
          background: transparentBg ? null : background,
          dither: ditherId,
          onProgress: (p) => setMediaProgress(p),
        });
        handleRef.current = handle;
        setPreparing(false);
        const result = await handle.done;
        downloadBlob(result.blob, frameAnimMediaFileName(title, mediaFormat));
        setDoneMsg(mediaFormat === "gif" ? "GIF 애니메이션을 저장했어요." : "APNG 애니메이션을 저장했어요.");
      }
    } catch (err) {
      if (!isMotionExportCancelled(err)) {
        setError(err instanceof Error ? err.message : "애니메이션을 내보내지 못했어요.");
      }
    } finally {
      handleRef.current = null;
      setPreparing(false);
      setProgress(null);
      setMediaProgress(null);
    }
  }

  const progressPct = Math.round((mediaProgress?.ratio ?? progress?.ratio ?? 0) * 100);
  const mediaStatusLabel =
    mediaProgress == null
      ? null
      : mediaProgress.phase === "render"
        ? "프레임 그리는 중…"
        : mediaProgress.phase === "quantize"
          ? "색상 팔레트 계산 중…"
          : mediaProgress.phase === "assemble"
            ? "APNG 조립 중…"
            : "GIF 인코딩 중…";
  const statusLabel = preparing
    ? "프레임 이미지 준비 중…"
    : mediaStatusLabel ??
      (progress?.phase === "finalize" ? "영상 파일 생성 중…" : "녹화 중…");

  return (
    <section
      aria-label="프레임 애니메이션"
      className="absolute right-3 top-3 z-40 flex max-h-[calc(100%-5rem)] w-[min(19rem,calc(100%-1.5rem))] flex-col overflow-hidden rounded-xl border border-line bg-panel/95 shadow-xl backdrop-blur"
    >
      {/* 헤더 */}
      <div className="flex items-center justify-between gap-2 border-b border-line/60 px-3 py-2">
        <p className="flex items-center gap-1.5 text-xs font-bold text-fg">
          <Film size={13} className="shrink-0 text-fg-3" aria-hidden />
          프레임 애니메이션
          <span className="font-medium text-fg-3">{frames.length}장</span>
        </p>
        <button
          type="button"
          onClick={onClose}
          aria-label="프레임 애니메이션 패널 닫기"
          className="grid size-6 place-items-center rounded-lg border border-line text-fg-2 transition-colors hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        >
          <X size={13} />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-2.5">
        {frames.length === 0 && (
          <p className="text-[0.72rem] leading-relaxed text-fg-3" role="status">
            아래 버튼으로 현재 그림을 첫 프레임으로 캡처해 애니메이션을 시작하세요.
          </p>
        )}
        {frames.length > 0 && (
            /* 필름스트립 */
            <div className="flex gap-1.5 overflow-x-auto pb-1" role="listbox" aria-label="프레임 목록">
              {frames.map((f, i) => {
                const isHighlighted = f.id === highlightId;
                return (
                  <div key={f.id} className="relative shrink-0">
                    <button
                      type="button"
                      role="option"
                      aria-selected={isHighlighted}
                      onClick={() => onActiveFrameChange(f.id)}
                      title={`프레임 ${i + 1}`}
                      className={cn(
                        "block size-14 overflow-hidden rounded-lg border-2 bg-card/40 transition-colors",
                        isHighlighted ? "border-accent" : "border-line hover:border-line-strong"
                      )}
                    >
                      <img src={f.src} alt={`프레임 ${i + 1}`} className="size-full object-contain" draggable={false} />
                    </button>
                    <span className="pointer-events-none absolute left-0.5 top-0.5 rounded bg-canvas/80 px-1 text-[0.6rem] font-semibold tabular-nums text-fg-3">
                      {i + 1}
                    </span>
                  </div>
                );
              })}
            </div>
        )}

        {activeFrame ? (
          <div
            role="toolbar"
            aria-label={`선택 프레임 ${activeIndex + 1} 작업`}
            className="grid grid-cols-4 gap-1 rounded-xl border border-line bg-card/45 p-1"
          >
            <StudioToolHintTarget
              className="w-full"
              disabled={Boolean(previousFrameDisabledReason)}
              unavailableReason={previousFrameDisabledReason}
              preferredSide="bottom"
              hint={{
                id: "frame-reorder-previous",
                title: "프레임을 앞으로 이동",
                description: "선택 프레임을 필름스트립에서 한 칸 앞으로 옮겨 재생 순서를 바꿉니다.",
                preview: "frame-reorder",
              }}
            >
              <button
                type="button"
                aria-label="프레임을 앞으로 이동"
                onClick={() => onFramesChange(reorderFrame(frames, activeFrame.id, activeIndex - 1))}
                disabled={Boolean(previousFrameDisabledReason)}
                className="flex min-h-11 w-full flex-col items-center justify-center gap-0.5 rounded-lg text-[0.65rem] font-semibold text-fg-2 transition-colors hover:bg-raised hover:text-fg disabled:opacity-35"
              >
                <ChevronLeft size={14} aria-hidden />
                앞으로
              </button>
            </StudioToolHintTarget>
            <StudioToolHintTarget
              className="w-full"
              disabled={Boolean(duplicateFrameDisabledReason)}
              unavailableReason={duplicateFrameDisabledReason}
              preferredSide="bottom"
              hint={{
                id: "frame-duplicate",
                title: "프레임 복제",
                description: "선택 프레임을 바로 다음 칸에 복제해 이어지는 동작을 빠르게 만듭니다.",
                preview: "frame-duplicate",
              }}
            >
              <button
                type="button"
                aria-label="프레임 복제"
                onClick={() => onFramesChange(duplicateFrame(frames, activeFrame.id, crypto.randomUUID()))}
                disabled={Boolean(duplicateFrameDisabledReason)}
                className="flex min-h-11 w-full flex-col items-center justify-center gap-0.5 rounded-lg text-[0.65rem] font-semibold text-fg-2 transition-colors hover:bg-raised hover:text-fg disabled:opacity-35"
              >
                <Copy size={14} aria-hidden />
                복제
              </button>
            </StudioToolHintTarget>
            <StudioToolHintTarget
              className="w-full"
              disabled={Boolean(deleteFrameDisabledReason)}
              unavailableReason={deleteFrameDisabledReason}
              preferredSide="bottom"
              hint={{
                id: "frame-delete",
                title: "프레임 삭제",
                description: "선택 프레임을 애니메이션에서 제거하고 인접 프레임으로 이동합니다.",
                preview: "frame-delete",
              }}
            >
              <button
                type="button"
                aria-label="프레임 삭제"
                onClick={deleteActiveFrame}
                disabled={Boolean(deleteFrameDisabledReason)}
                className="flex min-h-11 w-full flex-col items-center justify-center gap-0.5 rounded-lg text-[0.65rem] font-semibold text-bad transition-colors hover:bg-bad/10 disabled:opacity-35"
              >
                <Trash2 size={14} aria-hidden />
                삭제
              </button>
            </StudioToolHintTarget>
            <StudioToolHintTarget
              className="w-full"
              disabled={Boolean(nextFrameDisabledReason)}
              unavailableReason={nextFrameDisabledReason}
              preferredSide="bottom"
              hint={{
                id: "frame-reorder-next",
                title: "프레임을 뒤로 이동",
                description: "선택 프레임을 필름스트립에서 한 칸 뒤로 옮겨 재생 순서를 바꿉니다.",
                preview: "frame-reorder",
              }}
            >
              <button
                type="button"
                aria-label="프레임을 뒤로 이동"
                onClick={() => onFramesChange(reorderFrame(frames, activeFrame.id, activeIndex + 1))}
                disabled={Boolean(nextFrameDisabledReason)}
                className="flex min-h-11 w-full flex-col items-center justify-center gap-0.5 rounded-lg text-[0.65rem] font-semibold text-fg-2 transition-colors hover:bg-raised hover:text-fg disabled:opacity-35"
              >
                <ChevronRight size={14} aria-hidden />
                뒤로
              </button>
            </StudioToolHintTarget>
          </div>
        ) : null}

        {/* 캡처 버튼 — 프레임이 없어도 항상 보여야 첫 프레임을 만들 수 있다. */}
        <div className="space-y-1">
          <StudioToolHintTarget
            className="w-full"
            disabled={Boolean(captureReason)}
            unavailableReason={captureReason ?? undefined}
            preferredSide="left"
            hint={{
              id: "frame-capture",
              title: "현재 그림을 새 프레임으로 캡처",
              description: "캔버스의 현재 모습을 래스터 프레임으로 저장해 필름스트립 끝에 추가합니다.",
              preview: "frame-capture",
              tip: "새 프레임에서 그림을 조금씩 바꾸고 다시 캡처하면 자연스러운 플립북 동작이 됩니다.",
            }}
          >
            <button
              type="button"
              onClick={onCaptureFrame}
              disabled={Boolean(captureReason)}
              className={cn(buttonClass({ size: "sm", variant: "solid" }), "w-full gap-1.5")}
            >
              <Film size={13} />
              현재 그림을 새 프레임으로 캡처
            </button>
          </StudioToolHintTarget>
          {captureReason && (
            <p className="text-[0.7rem] text-fg-3" role="status">
              {captureReason}
            </p>
          )}
        </div>

        {frames.length > 0 && (
          <>
            {/* 프레임 개별 시간 */}
            {activeFrame && (
              <label className={PANEL_LABEL_ROW}>
                이 프레임만 다르게 (ms)
                <input
                  type="number"
                  min={16}
                  max={60000}
                  step={10}
                  value={activeFrame.durationMs ?? ""}
                  placeholder={`${Math.round(1000 / fps)}`}
                  onChange={(e) => {
                    const raw = e.target.value;
                    onFramesChange(setFrameDuration(frames, activeFrame.id, raw === "" ? null : Number(raw)));
                  }}
                  className="w-20 rounded-md border border-line bg-canvas px-2 py-1 text-right text-xs text-fg outline-none focus:border-accent/50"
                />
              </label>
            )}

            {/* 재생 설정 + 미리보기 */}
            <div className="space-y-1.5 border-t border-line/60 pt-2">
              <StudioSliderRow
                label="재생 속도 (fps)"
                min={MIN_FRAME_FPS}
                max={MAX_FRAME_FPS}
                step={1}
                value={fps}
                onChange={(next) => onSettingsChange({ frameFps: next })}
                readout={`${fps}`}
              />
              <div className="flex items-center justify-between gap-2">
                <StudioToggleChip active={loop} onClick={() => onSettingsChange({ frameLoop: !loop })} title="반복 재생 켜기/끄기">
                  반복 재생
                </StudioToggleChip>
                <span className="text-[0.72rem] tabular-nums text-fg-3">
                  {highlightIndex >= 0 ? highlightIndex + 1 : activeIndex + 1} / {frames.length}
                </span>
              </div>
              <StudioToolHintTarget
                className="w-full"
                disabled={Boolean(playbackDisabledReason)}
                unavailableReason={playbackDisabledReason}
                preferredSide="left"
                hint={playing ? {
                  id: "frame-playback-pause",
                  title: "프레임 애니메이션 정지",
                  description: "현재 플립북 미리보기를 멈추고 재생헤드를 지금 확인 중인 프레임에 유지합니다.",
                  preview: "frame-playback",
                  previewVariant: "pause",
                  tip: "정지한 프레임에서 그림이나 개별 표시 시간을 바로 다듬을 수 있어요.",
                } : {
                  id: "frame-playback",
                  title: "프레임 애니메이션 재생",
                  description: "필름스트립을 프레임별 시간과 FPS 설정에 맞춰 플립북처럼 미리 재생합니다.",
                  preview: "frame-playback",
                  previewVariant: "play",
                  tip: "각 프레임에 개별 시간을 입력하면 강조할 동작만 더 오래 보여줄 수 있어요.",
                }}
              >
                <button
                  type="button"
                  onClick={() => setPlaying((v) => !v)}
                  disabled={Boolean(playbackDisabledReason)}
                  className={cn(buttonClass({ size: "sm", variant: "outline" }), "w-full gap-1.5")}
                >
                  {playing ? <Pause size={13} /> : <Play size={13} />}
                  {playing ? "정지" : "재생"}
                </button>
              </StudioToolHintTarget>
            </div>

            {/* 어니언스키닝 */}
            <div className="space-y-1.5 border-t border-line/60 pt-2">
              <p className="flex items-center gap-1.5 text-[0.72rem] font-semibold text-fg-3 uppercase tracking-wider">
                <Ghost size={12} aria-hidden />
                어니언스키닝
              </p>
              <StudioToolHintTarget
                preferredSide="left"
                hint={{
                  id: "frame-onion-skin",
                  title: "어니언스키닝",
                  description: "현재 프레임 앞뒤 그림을 반투명하게 겹쳐 포즈와 선의 이동 간격을 맞춥니다.",
                  preview: "onion-skin",
                  tip: "가까운 프레임 한 장부터 켜고 동작 간격을 잡은 뒤 필요할 때만 범위를 늘려보세요.",
                }}
              >
                <StudioToggleChip
                  active={onionSkin.enabled}
                  onClick={() => onOnionSkinChange({ ...onionSkin, enabled: !onionSkin.enabled })}
                >
                  어니언스키닝 사용
                </StudioToggleChip>
              </StudioToolHintTarget>
              {onionSkin.enabled && (
                <>
                  <StudioToolHintTarget
                    className="w-full [&>*]:w-full"
                    preferredSide="left"
                    hint={{
                      id: "frame-onion-prev-count",
                      title: "이전 프레임 수",
                      description: "현재 프레임보다 앞선 그림을 최대 3장까지 겹쳐 표시합니다.",
                      preview: "onion-skin",
                    }}
                  >
                    <StudioSliderRow
                      label="이전 프레임 수"
                      min={0}
                      max={3}
                      step={1}
                      value={onionSkin.prevCount}
                      onChange={(next) => onOnionSkinChange({ ...onionSkin, prevCount: next })}
                    />
                  </StudioToolHintTarget>
                  <StudioToolHintTarget
                    className="w-full [&>*]:w-full"
                    preferredSide="left"
                    hint={{
                      id: "frame-onion-next-count",
                      title: "다음 프레임 수",
                      description: "현재 프레임보다 뒤의 그림을 최대 3장까지 겹쳐 표시합니다.",
                      preview: "onion-skin",
                    }}
                  >
                    <StudioSliderRow
                      label="다음 프레임 수"
                      min={0}
                      max={3}
                      step={1}
                      value={onionSkin.nextCount}
                      onChange={(next) => onOnionSkinChange({ ...onionSkin, nextCount: next })}
                    />
                  </StudioToolHintTarget>
                  <StudioToolHintTarget
                    className="w-full [&>*]:w-full"
                    preferredSide="left"
                    hint={{
                      id: "frame-onion-opacity",
                      title: "어니언스킨 투명도",
                      description: "앞뒤 그림이 현재 프레임을 가리지 않도록 겹침 강도를 조절합니다.",
                      preview: "onion-skin",
                    }}
                  >
                    <StudioSliderRow
                      label="투명도"
                      min={0.1}
                      max={0.8}
                      step={0.05}
                      value={onionSkin.opacity}
                      onChange={(next) => onOnionSkinChange({ ...onionSkin, opacity: next })}
                      readout={`${Math.round(onionSkin.opacity * 100)}%`}
                    />
                  </StudioToolHintTarget>
                  <StudioToolHintTarget
                    className="w-full [&>*]:w-full"
                    preferredSide="left"
                    hint={{
                      id: "frame-onion-tint",
                      title: "앞뒤 프레임 색 구분",
                      description: "이전 그림은 빨강, 다음 그림은 파랑으로 표시해 시간 방향을 구분합니다.",
                      preview: "onion-skin",
                    }}
                  >
                    <label className="flex cursor-pointer items-center gap-1.5 text-xs text-fg-2">
                      <input
                        type="checkbox"
                        checked={onionSkin.tint}
                        onChange={(e) => onOnionSkinChange({ ...onionSkin, tint: e.target.checked })}
                        className="size-3.5 cursor-pointer accent-[var(--color-accent)]"
                      />
                      색으로 구분 (이전=빨강 · 다음=파랑)
                    </label>
                  </StudioToolHintTarget>
                </>
              )}
            </div>

            {/* 내보내기(WebM · GIF · APNG) */}
            <div className="rounded-xl border border-line bg-card/50">
              <button
                type="button"
                onClick={() => setExportOpen((v) => !v)}
                aria-expanded={exportOpen}
                className="flex w-full items-center gap-1.5 px-2.5 py-2 text-xs font-medium text-fg-2 transition-colors hover:text-fg"
              >
                <Download size={13} className="text-accent" />
                애니메이션 내보내기 (WebM · GIF · APNG)
              </button>
              {exportOpen &&
                (frames.length < 2 ? (
                  <p className="border-t border-line px-2.5 py-2 text-[0.7rem] text-fg-3">
                    프레임이 2장 이상일 때 애니메이션을 내보낼 수 있어요.
                  </p>
                ) : (
                  <div className="flex flex-col gap-2.5 border-t border-line px-2.5 py-2.5">
                    <label className="flex flex-col gap-1 text-xs text-fg-2">
                      포맷
                      <select
                        value={format}
                        onChange={(e) => setFormat(e.target.value as StudioFrameAnimExportFormat)}
                        disabled={exporting}
                        className="h-8 rounded-lg border border-line bg-canvas px-2 text-xs text-fg outline-none focus:border-accent/50 disabled:opacity-50"
                      >
                        {FRAME_ANIM_FORMAT_OPTIONS.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <p className="text-[0.7rem] text-fg-3">
                      {format === "webm"
                        ? `약 ${formatSeconds(plan.durationSec)} 분량으로 내보내요.`
                        : `한 루프 ${formatSeconds(plan.loopDurationMs / 1000)} — 무한 반복으로 저장돼요.`}
                    </p>

                    <label className="flex flex-col gap-1 text-xs text-fg-2">
                      화질
                      <select
                        value={scaleId}
                        onChange={(e) => setScaleId(e.target.value)}
                        disabled={exporting}
                        className="h-8 rounded-lg border border-line bg-canvas px-2 text-xs text-fg outline-none focus:border-accent/50 disabled:opacity-50"
                      >
                        {FRAME_ANIM_EXPORT_SCALE_PRESETS.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    {format === "webm" && (
                      <label className="flex flex-col gap-1 text-xs text-fg-2">
                        반복 횟수
                        <select
                          value={loopId}
                          onChange={(e) => setLoopId(e.target.value)}
                          disabled={exporting}
                          className="h-8 rounded-lg border border-line bg-canvas px-2 text-xs text-fg outline-none focus:border-accent/50 disabled:opacity-50"
                        >
                          {FRAME_ANIM_LOOP_COUNT_PRESETS.map((l) => (
                            <option key={l.id} value={l.id}>
                              {l.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}

                    {format === "gif" && (
                      <label className="flex flex-col gap-1 text-xs text-fg-2">
                        디더링 (256색 축소 방식)
                        <select
                          value={ditherId}
                          onChange={(e) => setDitherId(e.target.value as GifDitherMode)}
                          disabled={exporting}
                          className="h-8 rounded-lg border border-line bg-canvas px-2 text-xs text-fg outline-none focus:border-accent/50 disabled:opacity-50"
                        >
                          {GIF_DITHER_PRESETS.map((preset) => (
                            <option key={preset.id} value={preset.id}>
                              {preset.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}

                    {format !== "webm" && (
                      <label className="flex cursor-pointer items-center gap-1.5 text-xs text-fg-2">
                        <input
                          type="checkbox"
                          checked={transparentBg}
                          onChange={(e) => setTransparentBg(e.target.checked)}
                          disabled={exporting}
                          className="size-3.5 cursor-pointer accent-[var(--color-accent)]"
                        />
                        투명 배경으로 내보내기
                      </label>
                    )}

                    {(format === "webm" || !transparentBg) && (
                      <label className="flex items-center justify-between gap-2 text-xs text-fg-2">
                        {format === "webm" ? "배경색 (WebM은 투명 배경을 지원하지 않아요)" : "배경색"}
                        <input
                          type="color"
                          value={background}
                          onChange={(e) => setBackground(e.target.value)}
                          disabled={exporting}
                          className="h-7 w-10 cursor-pointer rounded border border-line bg-canvas disabled:opacity-50"
                        />
                      </label>
                    )}

                    {exporting && (
                      <div className="rounded-lg border border-line bg-panel/40 px-2 py-1.5">
                        <div className="flex items-center justify-between text-[0.7rem] text-fg-2">
                          <span aria-live="polite">{statusLabel}</span>
                          <span className="numeral">{progressPct}%</span>
                        </div>
                        <div
                          role="progressbar"
                          aria-label="애니메이션 내보내기 진행률"
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={progressPct}
                          className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-raised"
                        >
                          <div
                            className="h-full rounded-full bg-accent transition-[width] duration-150"
                            style={{ width: `${progressPct}%` }}
                          />
                        </div>
                      </div>
                    )}

                    {format === "webm" && !webmSupported && (
                      <p className="text-xs text-bad">
                        이 브라우저는 영상 녹화(MediaRecorder/WebM)를 지원하지 않아요. GIF나 APNG 포맷을
                        선택하면 계속 내보낼 수 있어요.
                      </p>
                    )}
                    {format !== "webm" && !mediaSupported && (
                      <p className="text-xs text-bad">
                        이 브라우저는 캔버스 이미지 내보내기를 지원하지 않아요. 크롬·엣지·파이어폭스에서
                        시도해주세요.
                      </p>
                    )}
                    {error && <p className="text-xs text-bad">{error}</p>}
                    {doneMsg && !error && <p className="text-xs text-good">{doneMsg}</p>}

                    <div className="flex items-center justify-end gap-2">
                      {exporting && (
                        <button
                          type="button"
                          onClick={() => handleRef.current?.cancel()}
                          disabled={preparing}
                          className={buttonClass({ size: "sm", variant: "outline", className: "gap-1.5" })}
                        >
                          <Square size={13} />
                          취소
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={exportAnimation}
                        disabled={exporting || !supported}
                        className={buttonClass({ size: "sm", variant: "solid", className: "gap-1.5" })}
                      >
                        <Download size={14} />
                        {format === "webm" ? "영상 내보내기" : format === "gif" ? "GIF 내보내기" : "APNG 내보내기"}
                      </button>
                    </div>
                  </div>
                ))}
            </div>

            {/* 애니메이션 해제 */}
            <button
              type="button"
              onClick={() => {
                void (async () => {
                  if (
                    !(await confirmStudioDestructiveAction(
                      studioRemoveFrameAnimationRequest(element.frames?.length)
                    ))
                  ) return;
                  onRemoveAnimation();
                })();
              }}
              className={cn(buttonClass({ size: "sm", variant: "quiet", className: "gap-1.5 text-bad hover:text-bad" }), "w-full")}
            >
              <Trash2 size={13} />
              애니메이션 해제
            </button>
          </>
        )}
      </div>
    </section>
  );
}
