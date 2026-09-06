/**
 * Optional WebM/GIF/APNG export runtime for frame animation cells.
 *
 * The always-on Studio route only needs frame editing and preview timing. MediaRecorder, motion
 * export helpers, their BGM graph, and the pure GIF/APNG encoders (via
 * studio-frame-anim-media-export) stay behind the already-lazy Frame Animation panel.
 */
import {
  frameDurationsMs,
  frameIndexAtElapsed,
} from "../studio-frame-animation-timing";

import {
  MotionExportCancelledError,
  createDefaultMotionExportDeps,
  isMotionExportCancelled,
  isMotionExportSupported,
  loadMotionCutImages,
  pickMotionVideoMime,
  recommendVideoBitsPerSecond,
  type MotionCutImage,
  type MotionExportDeps,
  type MotionExportProgress,
  type MotionExportResult,
} from "./studio-motion-export";

import type { StudioAnimFrame } from "../studio-frame-animation";

export { isMotionExportCancelled, isMotionExportSupported, loadMotionCutImages };
export type {
  MotionCutImage,
  MotionExportProgress,
  MotionExportResult,
};

// GIF/APNG 경로 — 패널은 이 모듈만 임포트하므로 인코더도 같은 lazy 청크에 남는다.
export {
  FRAME_ANIM_MEDIA_MIME,
  GIF_DITHER_PRESETS,
  frameAnimMediaFileName,
  isFrameAnimMediaExportSupported,
  startFrameAnimMediaExport,
} from "./studio-frame-anim-media-export";
export type {
  FrameAnimMediaExportHandle,
  FrameAnimMediaExportRequest,
  FrameAnimMediaExportResult,
  FrameAnimMediaFormat,
  FrameAnimMediaProgress,
  GifDitherMode,
} from "./studio-frame-anim-media-export";

export const FRAME_ANIM_EXPORT_SCALE_PRESETS = [
  { id: "1x", label: "표준 화질 (1x)", pixelRatio: 1 },
  { id: "2x", label: "고화질 (2x, 권장)", pixelRatio: 2 },
] as const;

export const FRAME_ANIM_LOOP_COUNT_PRESETS = [
  { id: "x3", label: "3회 반복", loopCount: 3 },
  { id: "x5", label: "5회 반복", loopCount: 5 },
  { id: "x10", label: "10회 반복 (짧은 루프에 추천)", loopCount: 10 },
] as const;

const FRAME_ANIM_CAPTURE_FPS = 30;

export interface FrameAnimationExportOptions {
  loopCount: number;
  pixelRatio: number;
  background: string;
}

export const DEFAULT_FRAME_ANIMATION_EXPORT_OPTIONS: FrameAnimationExportOptions = {
  loopCount: 3,
  pixelRatio: 2,
  background: "#ffffff",
};

export interface FrameAnimationExportPlan {
  width: number;
  height: number;
  captureFps: number;
  frameDurations: number[];
  loopDurationMs: number;
  loopCount: number;
  durationSec: number;
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

export function planFrameAnimationExport(
  elWidth: number,
  elHeight: number,
  frames: StudioAnimFrame[],
  fps: number,
  options?: Partial<FrameAnimationExportOptions>
): FrameAnimationExportPlan {
  const normalized = { ...DEFAULT_FRAME_ANIMATION_EXPORT_OPTIONS, ...options };
  const pixelRatio = clamp(normalized.pixelRatio, 1, 4);
  const loopCount = Math.round(clamp(normalized.loopCount, 1, 20));
  const frameDurations = frameDurationsMs(frames, fps);
  const loopDurationMs = frameDurations.reduce((sum, duration) => sum + duration, 0);
  return {
    width: Math.max(1, Math.round(elWidth * pixelRatio)),
    height: Math.max(1, Math.round(elHeight * pixelRatio)),
    captureFps: FRAME_ANIM_CAPTURE_FPS,
    frameDurations,
    loopDurationMs,
    loopCount,
    durationSec: (loopDurationMs * loopCount) / 1000,
  };
}

export function frameAnimationExportFileName(title: string): string {
  return `${title.trim() || "toonspectrum-frame-anim"}-frames.webm`;
}

export interface FrameAnimationExportRequest {
  plan: FrameAnimationExportPlan;
  images: MotionCutImage[];
  background?: string;
  onProgress?: (progress: MotionExportProgress) => void;
  deps?: Partial<MotionExportDeps>;
}

export interface FrameAnimationExportHandle {
  done: Promise<MotionExportResult>;
  cancel(): void;
}

interface FrameAnimRunState {
  cancelled: boolean;
  interrupt: (() => void) | null;
}

export function startFrameAnimationExport(
  request: FrameAnimationExportRequest
): FrameAnimationExportHandle {
  const deps: MotionExportDeps = {
    ...createDefaultMotionExportDeps(),
    ...request.deps,
  };
  const state: FrameAnimRunState = { cancelled: false, interrupt: null };
  return {
    done: runFrameAnimationExport(request, deps, state),
    cancel() {
      if (state.cancelled) return;
      state.cancelled = true;
      state.interrupt?.();
    },
  };
}

async function runFrameAnimationExport(
  request: FrameAnimationExportRequest,
  deps: MotionExportDeps,
  state: FrameAnimRunState
): Promise<MotionExportResult> {
  const { plan } = request;
  if (plan.frameDurations.length === 0 || plan.durationSec <= 0) {
    throw new Error("내보낼 프레임이 없어요.");
  }
  if (request.images.length < plan.frameDurations.length) {
    throw new Error("프레임 이미지 수가 플랜과 맞지 않아요. 다시 시도해주세요.");
  }
  const mimeType = pickMotionVideoMime(deps.isMimeSupported);
  if (!mimeType) {
    throw new Error("이 브라우저는 WebM 영상 인코딩을 지원하지 않아요.");
  }

  const canvas = deps.createCanvas(plan.width, plan.height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("캔버스 컨텍스트를 만들지 못했어요.");

  const background = request.background ?? "#ffffff";
  const draw = (elapsedMs: number) => {
    const index = frameIndexAtElapsed(
      plan.frameDurations,
      elapsedMs % plan.loopDurationMs,
      true
    );
    context.globalAlpha = 1;
    context.fillStyle = background;
    context.fillRect(0, 0, plan.width, plan.height);
    const image = request.images[index];
    if (image) context.drawImage(image.source, 0, 0, plan.width, plan.height);
  };
  draw(0);

  const stream = canvas.captureStream(plan.captureFps);
  const chunks: Blob[] = [];
  let recorderError: unknown = null;
  const recorder = deps.createRecorder(stream, {
    mimeType,
    videoBitsPerSecond: recommendVideoBitsPerSecond(
      plan.width,
      plan.height,
      plan.captureFps
    ),
  });
  let settleStopped: () => void = () => undefined;
  const stopped = new Promise<void>((resolve) => {
    settleStopped = resolve;
  });
  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) chunks.push(event.data);
  };
  recorder.onstop = () => settleStopped();
  recorder.onerror = (event) => {
    recorderError = event ?? new Error("recorder error");
    settleStopped();
  };

  let pendingFrame: number | null = null;
  const cleanup = () => {
    if (pendingFrame !== null) {
      deps.cancelFrame(pendingFrame);
      pendingFrame = null;
    }
    try {
      recorder.stop();
    } catch {
      // Recorder already stopped during finalize or cancellation.
    }
    for (const track of stream.getTracks()) {
      try {
        track.stop();
      } catch {
        // Browser-owned tracks may already be stopped.
      }
    }
  };

  try {
    if (state.cancelled) throw new MotionExportCancelledError();
    recorder.start(500);

    await new Promise<void>((resolve, reject) => {
      const startedAt = deps.now();
      state.interrupt = () => {
        if (pendingFrame !== null) {
          deps.cancelFrame(pendingFrame);
          pendingFrame = null;
        }
        reject(new MotionExportCancelledError());
      };
      const tick = () => {
        pendingFrame = null;
        if (state.cancelled) {
          reject(new MotionExportCancelledError());
          return;
        }
        const elapsedSec = (deps.now() - startedAt) / 1000;
        const timeSec = Math.min(elapsedSec, plan.durationSec);
        draw(timeSec * 1000);
        request.onProgress?.({
          phase: "record",
          ratio: clamp01(timeSec / plan.durationSec),
          timeSec,
          durationSec: plan.durationSec,
        });
        if (elapsedSec >= plan.durationSec) {
          resolve();
          return;
        }
        pendingFrame = deps.requestFrame(tick);
      };
      tick();
    });

    state.interrupt = () => settleStopped();
    request.onProgress?.({
      phase: "finalize",
      ratio: 1,
      timeSec: plan.durationSec,
      durationSec: plan.durationSec,
    });
    try {
      recorder.stop();
    } catch {
      // Recorder already stopped by a browser-level failure.
    }
    await stopped;
    if (state.cancelled) throw new MotionExportCancelledError();
    if (recorderError) {
      throw new Error("영상 인코딩 중 오류가 발생했어요. 다시 시도해주세요.");
    }
    if (chunks.length === 0) {
      throw new Error("녹화된 영상 데이터가 없어요. 다시 시도해주세요.");
    }
    return {
      blob: new Blob(chunks, { type: mimeType }),
      mimeType,
      durationSec: plan.durationSec,
      audio: "none",
    };
  } finally {
    state.interrupt = null;
    cleanup();
  }
}
