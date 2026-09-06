import {
  rememberStudioRasterEditSurface,
  takeStudioRasterEditSurface,
} from "./render/studio-raster-edit-surface-cache";
import { loadFloodFillSourceImage } from "./studio-flood-fill";
import { runStudioRetouchWorker } from "./studio-retouch-worker-client";

import type {
  WetMixPixelPoint,
  WetMixSettings,
} from "./brush/studio-wet-mix";
import type {
  DodgeBurnPixelPoint,
  DodgeBurnSettings,
} from "./studio-dodge-burn";

export interface StudioRetouchBrowserOptions {
  readonly signal?: AbortSignal;
}

function createRetouchAbortError(): Error {
  if (typeof DOMException === "function") {
    return new DOMException("리터치 처리를 취소했습니다.", "AbortError");
  }
  const error = new Error("리터치 처리를 취소했습니다.");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw createRetouchAbortError();
}

export type StudioRetouchSourceImage = HTMLImageElement | HTMLCanvasElement;

export function studioRetouchSourceDimensions(source: StudioRetouchSourceImage): {
  readonly height: number;
  readonly width: number;
} {
  const naturalWidth = "naturalWidth" in source ? Number(source.naturalWidth) : 0;
  const naturalHeight = "naturalHeight" in source ? Number(source.naturalHeight) : 0;
  return {
    width: naturalWidth || Number(source.width),
    height: naturalHeight || Number(source.height),
  };
}

/** Uses the exact just-encoded surface when possible, otherwise decodes the authoritative PNG. */
export async function loadStudioRetouchSourceImage(
  src: string,
  signal?: AbortSignal,
): Promise<StudioRetouchSourceImage> {
  throwIfAborted(signal);
  const cached = takeStudioRasterEditSurface(src);
  if (cached) return cached;
  return loadFloodFillSourceImage(src, signal);
}

export async function runStudioDodgeBurnRetouch(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  points: readonly DodgeBurnPixelPoint[],
  settings: DodgeBurnSettings,
  options: StudioRetouchBrowserOptions = {},
): Promise<Uint8ClampedArray> {
  const result = await runStudioRetouchWorker(
    { kind: "dodge-burn", data, w, h, points, settings },
    { executionMode: "worker", signal: options.signal },
  );
  return result.data;
}

export async function runStudioWetMixRetouch(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  points: readonly WetMixPixelPoint[],
  settings: WetMixSettings,
  options: StudioRetouchBrowserOptions = {},
): Promise<Uint8ClampedArray> {
  const result = await runStudioRetouchWorker(
    { kind: "wet-mix", data, w, h, points, settings },
    { executionMode: "worker", signal: options.signal },
  );
  return result.data;
}

function blobToDataUrl(blob: Blob, signal: AbortSignal | undefined): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    let settled = false;
    const cleanup = () => signal?.removeEventListener("abort", onAbort);
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const onAbort = () => {
      reader.abort();
      finish(() => reject(createRetouchAbortError()));
    };
    reader.onerror = () => finish(() => reject(
      reader.error ?? new Error("리터치 PNG를 읽지 못했습니다."),
    ));
    reader.onload = () => finish(() => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("리터치 PNG를 data URL로 만들지 못했습니다."));
    });
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }
    reader.readAsDataURL(blob);
  });
}

/** Uses asynchronous browser PNG encoding; synchronous toDataURL remains legacy-only fallback. */
export async function encodeStudioRetouchCanvasPng(
  canvas: HTMLCanvasElement,
  options: StudioRetouchBrowserOptions = {},
): Promise<string> {
  throwIfAborted(options.signal);
  if (typeof canvas.toBlob !== "function") {
    const src = canvas.toDataURL("image/png");
    throwIfAborted(options.signal);
    rememberStudioRasterEditSurface(src, canvas);
    return src;
  }
  const blob = await new Promise<Blob>((resolve, reject) => {
    let settled = false;
    const cleanup = () => options.signal?.removeEventListener("abort", onAbort);
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const onAbort = () => finish(() => reject(createRetouchAbortError()));
    options.signal?.addEventListener("abort", onAbort, { once: true });
    if (options.signal?.aborted) {
      onAbort();
      return;
    }
    canvas.toBlob((value) => finish(() => {
      if (value) resolve(value);
      else reject(new Error("리터치 PNG 인코딩에 실패했습니다."));
    }), "image/png");
  });
  throwIfAborted(options.signal);
  const src = await blobToDataUrl(blob, options.signal);
  throwIfAborted(options.signal);
  rememberStudioRasterEditSurface(src, canvas);
  return src;
}
