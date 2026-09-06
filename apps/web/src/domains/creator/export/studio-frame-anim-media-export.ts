/**
 * Frame Animation GIF/APNG 내보내기 오케스트레이션 — 프레임 이미지를 오프스크린 캔버스에
 * 렌더한 뒤 순수 인코더(studio-gif-encoder/studio-apng-encoder)로 넘기는 브라우저 층.
 *
 * WebM 경로(studio-frame-animation-export)와 같은 핸들 규약({done, cancel})과 MotionExport
 * 취소 규약(MotionExportCancelledError → isMotionExportCancelled)을 그대로 따르므로 패널은
 * 포맷과 무관하게 동일한 진행률/취소 UI를 쓴다. 캔버스·PNG 인코딩·양보는 전부 deps 주입형이라
 * node 테스트에서 가짜로 대체할 수 있다. 이 모듈은 이미 lazy한 Frame Animation 패널 청크
 * 뒤에만 로드된다(studio-frame-animation-export를 통해서만 재수출).
 */
import { assembleApng, isApngEncodeCancelled } from "../studio-apng-encoder";
import {
  encodeGif,
  gifDelayCentiseconds,
  isGifEncodeCancelled,
  type GifDitherMode,
} from "../studio-gif-encoder";

import { MotionExportCancelledError } from "./studio-motion-export";

import type { MotionCutImage } from "./studio-motion-export";

export { GIF_DITHER_PRESETS } from "../studio-gif-encoder";
export type { GifDitherMode } from "../studio-gif-encoder";

export type FrameAnimMediaFormat = "apng" | "gif";

export const FRAME_ANIM_MEDIA_MIME: Record<FrameAnimMediaFormat, string> = {
  gif: "image/gif",
  apng: "image/apng",
};

export interface FrameAnimMediaProgress {
  phase: "assemble" | "encode" | "quantize" | "render";
  frameIndex: number;
  totalFrames: number;
  ratio: number; // 0..1 — 전체 내보내기 기준
}

// 테스트에서 가짜로 대체 가능한 최소 캔버스 서브셋(MotionCanvasLike와 같은 결).
export interface FrameAnimMediaCanvas2d {
  globalAlpha: number;
  fillStyle: string | CanvasGradient | CanvasPattern;
  clearRect(x: number, y: number, width: number, height: number): void;
  fillRect(x: number, y: number, width: number, height: number): void;
  drawImage(image: CanvasImageSource, dx: number, dy: number, dw: number, dh: number): void;
  getImageData(x: number, y: number, width: number, height: number): { data: Uint8ClampedArray };
}

export interface FrameAnimMediaCanvasLike {
  width: number;
  height: number;
  getContext(contextId: "2d"): FrameAnimMediaCanvas2d | null;
}

export interface FrameAnimMediaDeps {
  createCanvas(width: number, height: number): FrameAnimMediaCanvasLike;
  canvasToPngBytes(canvas: FrameAnimMediaCanvasLike): Promise<Uint8Array>;
  yieldToUi(): Promise<void>;
}

export function createDefaultFrameAnimMediaDeps(): FrameAnimMediaDeps {
  return {
    createCanvas(width, height) {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      return canvas;
    },
    canvasToPngBytes(canvas) {
      const element = canvas as unknown as HTMLCanvasElement;
      return new Promise((resolve, reject) => {
        element.toBlob((blob) => {
          if (!blob) {
            reject(new Error("PNG 프레임 인코딩에 실패했어요. 다시 시도해주세요."));
            return;
          }
          blob.arrayBuffer().then((buffer) => resolve(new Uint8Array(buffer)), reject);
        }, "image/png");
      });
    },
    yieldToUi() {
      return new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}

/** GIF/APNG 내보내기 지원 여부 — 캔버스 2D와 브라우저 PNG encoder(toBlob)만 있으면 된다. */
export function isFrameAnimMediaExportSupported(): boolean {
  return (
    typeof document !== "undefined" &&
    typeof HTMLCanvasElement !== "undefined" &&
    typeof HTMLCanvasElement.prototype.toBlob === "function"
  );
}

/** 내보내기 파일명 — WebM 경로의 `<제목>-frames.webm` 규칙과 나란한 `.gif`/`.apng`. */
export function frameAnimMediaFileName(title: string, format: FrameAnimMediaFormat): string {
  return `${title.trim() || "toonspectrum-frame-anim"}-frames.${format}`;
}

export interface FrameAnimMediaExportRequest {
  format: FrameAnimMediaFormat;
  width: number;
  height: number;
  /** 프레임별 노출 시간(ms) — studio-frame-animation-timing의 frameDurationsMs 산출값. */
  frameDurations: number[];
  images: MotionCutImage[];
  /** 채울 배경색. null이면 투명 배경(GIF 1비트 투명 · APNG 알파). */
  background: string | null;
  dither?: GifDitherMode; // GIF 전용
  onProgress?: (progress: FrameAnimMediaProgress) => void;
  deps?: Partial<FrameAnimMediaDeps>;
}

export interface FrameAnimMediaExportResult {
  blob: Blob;
  mimeType: string;
  byteLength: number;
}

export interface FrameAnimMediaExportHandle {
  done: Promise<FrameAnimMediaExportResult>;
  cancel(): void;
}

interface MediaRunState {
  cancelled: boolean;
}

const RENDER_PROGRESS_SPAN = 0.35;

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/**
 * GIF/APNG 내보내기를 시작한다. 반환 핸들의 done을 await — 취소 시 WebM 경로와 동일하게
 * MotionExportCancelledError로 reject된다(isMotionExportCancelled로 판별).
 */
export function startFrameAnimMediaExport(
  request: FrameAnimMediaExportRequest
): FrameAnimMediaExportHandle {
  const deps: FrameAnimMediaDeps = {
    ...createDefaultFrameAnimMediaDeps(),
    ...request.deps,
  };
  const state: MediaRunState = { cancelled: false };
  return {
    done: runFrameAnimMediaExport(request, deps, state),
    cancel() {
      state.cancelled = true; // 인코더가 다음 양보 지점에서 폴링해 중단한다
    },
  };
}

async function runFrameAnimMediaExport(
  request: FrameAnimMediaExportRequest,
  deps: FrameAnimMediaDeps,
  state: MediaRunState
): Promise<FrameAnimMediaExportResult> {
  const totalFrames = request.frameDurations.length;
  if (totalFrames < 2) throw new Error("내보낼 프레임이 2장 이상 필요해요.");
  if (request.images.length < totalFrames) {
    throw new Error("프레임 이미지 수가 플랜과 맞지 않아요. 다시 시도해주세요.");
  }
  const width = Math.max(1, Math.round(request.width));
  const height = Math.max(1, Math.round(request.height));
  const canvas = deps.createCanvas(width, height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("캔버스 컨텍스트를 만들지 못했어요.");

  const throwIfCancelled = (): void => {
    if (state.cancelled) throw new MotionExportCancelledError();
  };
  const renderFrame = (index: number): void => {
    context.globalAlpha = 1;
    context.clearRect(0, 0, width, height);
    if (request.background !== null) {
      context.fillStyle = request.background;
      context.fillRect(0, 0, width, height);
    }
    const image = request.images[index];
    if (image) context.drawImage(image.source, 0, 0, width, height);
  };
  const reportRender = (index: number): void => {
    request.onProgress?.({
      phase: "render",
      frameIndex: index,
      totalFrames,
      ratio: clamp01(RENDER_PROGRESS_SPAN * ((index + 1) / totalFrames)),
    });
  };
  const forwardEncoderProgress = (progress: {
    phase: FrameAnimMediaProgress["phase"];
    frameIndex: number;
    totalFrames: number;
    ratio: number;
  }): void => {
    request.onProgress?.({
      phase: progress.phase,
      frameIndex: progress.frameIndex,
      totalFrames: progress.totalFrames,
      ratio: clamp01(RENDER_PROGRESS_SPAN + progress.ratio * (1 - RENDER_PROGRESS_SPAN)),
    });
  };

  try {
    if (request.format === "gif") {
      const gifFrames: { rgba: Uint8ClampedArray; delayCs: number }[] = [];
      for (let index = 0; index < totalFrames; index += 1) {
        throwIfCancelled();
        renderFrame(index);
        gifFrames.push({
          rgba: context.getImageData(0, 0, width, height).data,
          delayCs: gifDelayCentiseconds(request.frameDurations[index] ?? 0),
        });
        reportRender(index);
        await deps.yieldToUi();
      }
      throwIfCancelled();
      const bytes = await encodeGif({
        width,
        height,
        frames: gifFrames,
        loopForever: true,
        dither: request.dither ?? "none",
        transparency: request.background === null,
        onProgress: forwardEncoderProgress,
        isCancelled: () => state.cancelled,
        yieldToUi: deps.yieldToUi,
      });
      return {
        blob: new Blob([bytes], { type: FRAME_ANIM_MEDIA_MIME.gif }),
        mimeType: FRAME_ANIM_MEDIA_MIME.gif,
        byteLength: bytes.byteLength,
      };
    }

    const apngFrames: { png: Uint8Array; delayMs: number }[] = [];
    for (let index = 0; index < totalFrames; index += 1) {
      throwIfCancelled();
      renderFrame(index);
      apngFrames.push({
        png: await deps.canvasToPngBytes(canvas),
        delayMs: Math.max(1, Math.round(request.frameDurations[index] ?? 0)),
      });
      reportRender(index);
      await deps.yieldToUi();
    }
    throwIfCancelled();
    const bytes = await assembleApng({
      frames: apngFrames,
      loopForever: true,
      onProgress: forwardEncoderProgress,
      isCancelled: () => state.cancelled,
      yieldToUi: deps.yieldToUi,
    });
    return {
      blob: new Blob([bytes], { type: FRAME_ANIM_MEDIA_MIME.apng }),
      mimeType: FRAME_ANIM_MEDIA_MIME.apng,
      byteLength: bytes.byteLength,
    };
  } catch (err) {
    // 인코더 자체 취소 오류를 WebM 경로와 동일한 취소 규약으로 통일한다.
    if (state.cancelled || isGifEncodeCancelled(err) || isApngEncodeCancelled(err)) {
      throw new MotionExportCancelledError();
    }
    throw err;
  }
}
