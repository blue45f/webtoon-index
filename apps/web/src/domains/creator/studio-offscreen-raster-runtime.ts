/**
 * 래스터 합성 실행기 + OffscreenCanvas 주입 seam.
 *
 * 실제 픽셀 작업은 전부 `StudioOffscreenRasterHost` 인터페이스 뒤에 있다. 그래서
 *  - Worker 는 `createStudioOffscreenCanvasHost()` 로 진짜 OffscreenCanvas 를 꽂고,
 *  - 테스트는 draw 호출을 기록하는 가짜 host 를 꽂아 헤드리스로 결정성을 검증한다.
 *
 * 실행기는 예외를 밖으로 던지지 않는다 — 모든 실패는 프로토콜의 타입 있는 failure 메시지로
 * 환원된다(호출자가 catch 로 코드를 잃어버리지 않게).
 */

import {
  STUDIO_OFFSCREEN_RASTER_WORKER_PROTOCOL_VERSION,
  isStudioOffscreenRasterEncodedBlobExact,
  isStudioOffscreenRasterRunMessage,
  studioOffscreenRasterFailure,
  type StudioOffscreenOwnedBitmap,
  type StudioOffscreenOwnedBuffer,
  type StudioOffscreenRasterEncodeMime,
  type StudioOffscreenRasterFailureMessage,
  type StudioOffscreenRasterPlacement,
  type StudioOffscreenRasterResultMessage,
  type StudioOffscreenRasterRunMessage,
} from "./studio-offscreen-raster-worker-protocol";

/** host 가 그릴 수 있는 이미지 소스. 브라우저에서는 ImageBitmap/OffscreenCanvas 다. */
export type StudioOffscreenRasterDrawable = object;

export interface StudioOffscreenRasterSurface {
  readonly width: number;
  readonly height: number;
  fill(color: string): void;
  drawSource(
    source: StudioOffscreenRasterDrawable,
    sourceWidth: number,
    sourceHeight: number,
    placement: StudioOffscreenRasterPlacement,
  ): void;
  /** 새 전용 ArrayBuffer(RGBA8). 표면 내부 메모리를 다시 노출하지 않는다. */
  readPixels(): StudioOffscreenOwnedBuffer;
  /** 표면 백킹을 그대로 넘긴다 — 호출 후 표면은 비워진 것으로 취급한다. */
  transferToBitmap(): StudioOffscreenOwnedBitmap;
  encode(mime: StudioOffscreenRasterEncodeMime, quality: number | undefined): Promise<Blob>;
  release(): void;
}

export interface StudioOffscreenRasterHost {
  createSurface(width: number, height: number): StudioOffscreenRasterSurface;
  /** 전송받은 RGBA 버퍼를 그릴 수 있는 소스로 만든다. 버퍼 소유권은 host 로 넘어간다. */
  adoptPixels(
    pixels: StudioOffscreenOwnedBuffer,
    width: number,
    height: number,
  ): Promise<StudioOffscreenRasterDrawable>;
  /** 그리기가 끝난 소스를 해제한다(ImageBitmap.close 등). */
  releaseDrawable(drawable: StudioOffscreenRasterDrawable): void;
}

export interface StudioOffscreenRasterExecuteInput {
  readonly host: StudioOffscreenRasterHost;
  readonly request: unknown;
  /** 소스 하나를 그릴 때마다, 그리고 인코딩 직전에 호출된다. true 면 즉시 cancelled 로 끝낸다. */
  readonly isCancelled?: () => boolean;
}

export type StudioOffscreenRasterExecuteResult =
  | StudioOffscreenRasterResultMessage
  | StudioOffscreenRasterFailureMessage;

function runIdOf(value: unknown): number {
  if (typeof value !== "object" || value === null) return 1;
  const runId = (value as { runId?: unknown }).runId;
  return typeof runId === "number" && Number.isSafeInteger(runId) && runId > 0 ? runId : 1;
}

function describe(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

async function composite(
  input: StudioOffscreenRasterExecuteInput,
  request: StudioOffscreenRasterRunMessage,
): Promise<StudioOffscreenRasterExecuteResult> {
  const { host } = input;
  const cancelled = input.isCancelled ?? (() => false);
  let created: StudioOffscreenRasterSurface;
  try {
    created = host.createSurface(request.target.width, request.target.height);
  } catch (error) {
    return studioOffscreenRasterFailure(
      request.runId,
      "unsupported",
      describe(error, "OffscreenCanvas 표면을 만들 수 없습니다."),
    );
  }
  const surface = created;

  try {
    if (request.target.background !== null) surface.fill(request.target.background);

    for (const source of request.sources) {
      if (cancelled()) {
        return studioOffscreenRasterFailure(request.runId, "cancelled", "래스터화가 취소되었습니다.");
      }
      if (source.kind === "bitmap") {
        surface.drawSource(source.bitmap, source.bitmap.width, source.bitmap.height, source.placement);
        host.releaseDrawable(source.bitmap);
        continue;
      }
      const drawable = await host.adoptPixels(source.pixels, source.width, source.height);
      try {
        surface.drawSource(drawable, source.width, source.height, source.placement);
      } finally {
        host.releaseDrawable(drawable);
      }
    }

    if (cancelled()) {
      return studioOffscreenRasterFailure(request.runId, "cancelled", "래스터화가 취소되었습니다.");
    }

    if (request.output.kind === "pixels") {
      return {
        version: STUDIO_OFFSCREEN_RASTER_WORKER_PROTOCOL_VERSION,
        kind: "result",
        runId: request.runId,
        width: request.target.width,
        height: request.target.height,
        payload: { kind: "pixels", pixels: surface.readPixels() },
      };
    }
    if (request.output.kind === "bitmap") {
      return {
        version: STUDIO_OFFSCREEN_RASTER_WORKER_PROTOCOL_VERSION,
        kind: "result",
        runId: request.runId,
        width: request.target.width,
        height: request.target.height,
        payload: { kind: "bitmap", bitmap: surface.transferToBitmap() },
      };
    }
    const mime = request.output.mime;
    let blob: Blob;
    try {
      blob = await surface.encode(mime, request.output.quality);
    } catch (error) {
      return studioOffscreenRasterFailure(
        request.runId,
        "encode-failed",
        describe(error, "래스터 인코딩에 실패했습니다."),
      );
    }
    if (!await isStudioOffscreenRasterEncodedBlobExact(blob, mime)) {
      return studioOffscreenRasterFailure(
        request.runId,
        "encode-failed",
        `요청한 ${mime} 코덱이 정확한 컨테이너를 생성하지 못했습니다. 다른 형식으로 전환하지 않았습니다.`,
      );
    }
    return {
      version: STUDIO_OFFSCREEN_RASTER_WORKER_PROTOCOL_VERSION,
      kind: "result",
      runId: request.runId,
      width: request.target.width,
      height: request.target.height,
      payload: { kind: "encoded", mime, blob },
    };
  } catch (error) {
    return studioOffscreenRasterFailure(
      request.runId,
      "raster-failed",
      describe(error, "래스터 합성에 실패했습니다."),
    );
  } finally {
    try {
      surface.release();
    } catch {
      // 해제 실패는 결과를 바꾸지 않는다.
    }
  }
}

/**
 * 한 래스터 잡을 실행한다. 어떤 경로로도 throw 하지 않고, 항상 result 또는 failure 를 돌려준다.
 */
export async function executeStudioOffscreenRasterJob(
  input: StudioOffscreenRasterExecuteInput,
): Promise<StudioOffscreenRasterExecuteResult> {
  const request = input.request;
  if (!isStudioOffscreenRasterRunMessage(request)) {
    return studioOffscreenRasterFailure(
      runIdOf(request),
      "protocol",
      "OffscreenCanvas 래스터 요청 형식이 올바르지 않습니다.",
    );
  }
  if ((input.isCancelled ?? (() => false))()) {
    return studioOffscreenRasterFailure(request.runId, "cancelled", "래스터화가 취소되었습니다.");
  }
  return composite(input, request);
}

// ── 실제 OffscreenCanvas host ────────────────────────────────────────────────────

interface OffscreenContextLike {
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  rotate(radians: number): void;
  scale(x: number, y: number): void;
  clearRect(x: number, y: number, w: number, h: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  drawImage(image: CanvasImageSource, dx: number, dy: number, dw: number, dh: number): void;
  getImageData(x: number, y: number, w: number, h: number): ImageData;
  fillStyle: string;
  globalAlpha: number;
}

function drawPlaced(
  context: OffscreenContextLike,
  image: CanvasImageSource,
  placement: StudioOffscreenRasterPlacement,
): void {
  context.save();
  try {
    context.globalAlpha = placement.opacity;
    const centerX = placement.dx + placement.dw / 2;
    const centerY = placement.dy + placement.dh / 2;
    context.translate(centerX, centerY);
    if (placement.rotation !== 0) context.rotate((placement.rotation * Math.PI) / 180);
    if (placement.flipX || placement.flipY) {
      context.scale(placement.flipX ? -1 : 1, placement.flipY ? -1 : 1);
    }
    context.drawImage(image, -placement.dw / 2, -placement.dh / 2, placement.dw, placement.dh);
  } finally {
    context.restore();
  }
}

/**
 * 이 런타임이 OffscreenCanvas 2D 합성을 지원하는지 확인한다. Worker 는 이 결과로 ready 대신
 * unavailable 을 먼저 보내, 클라이언트가 선택된 provider 부재를 즉시 표시할 수 있게 한다.
 */
export function supportsStudioOffscreenCanvas2d(): boolean {
  try {
    const CanvasConstructor = (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas;
    if (typeof CanvasConstructor !== "function") return false;
    const probe = new OffscreenCanvas(1, 1);
    const context = probe.getContext("2d");
    const supported = context !== null && typeof probe.convertToBlob === "function";
    probe.width = 1;
    probe.height = 1;
    return supported;
  } catch {
    return false;
  }
}

/** 브라우저/Worker 전용 host. 지원되지 않으면 null(예외 대신 명시적 부재). */
export function createStudioOffscreenCanvasHost(): StudioOffscreenRasterHost | null {
  if (!supportsStudioOffscreenCanvas2d()) return null;
  const decode = (globalThis as { createImageBitmap?: typeof createImageBitmap }).createImageBitmap;
  if (typeof decode !== "function") return null;

  return {
    createSurface(width, height) {
      const canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext("2d") as OffscreenContextLike | null;
      if (!context) throw new Error("OffscreenCanvas 2D 컨텍스트를 만들 수 없습니다.");
      return {
        width,
        height,
        fill(color) {
          context.fillStyle = color;
          context.fillRect(0, 0, width, height);
        },
        drawSource(source, _sourceWidth, _sourceHeight, placement) {
          drawPlaced(context, source as CanvasImageSource, placement);
        },
        readPixels() {
          const imageData = context.getImageData(0, 0, width, height);
          // getImageData 는 매번 새 전용 버퍼를 준다 — 그대로 소유권을 넘겨도 안전하다.
          return imageData.data.buffer as StudioOffscreenOwnedBuffer;
        },
        transferToBitmap() {
          return canvas.transferToImageBitmap() as StudioOffscreenOwnedBitmap;
        },
        encode(mime, quality) {
          return canvas.convertToBlob(quality === undefined ? { type: mime } : { type: mime, quality });
        },
        release() {
          canvas.width = 1;
          canvas.height = 1;
        },
      };
    },
    async adoptPixels(pixels, width, height) {
      const imageData = new ImageData(new Uint8ClampedArray(pixels), width, height);
      return decode(imageData);
    },
    releaseDrawable(drawable) {
      const closable = drawable as { close?: unknown };
      if (typeof closable.close === "function") (closable.close as () => void).call(drawable);
    },
  };
}
