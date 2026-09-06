/**
 * Cooperative main-thread helpers for destructive pixel-edit bake paths.
 *
 * Selection adjust / content transform / fill / crop still run canvas work on the page thread.
 * The two freezes users feel most often are:
 *   1) a long uninterrupted canvas compose (mask + apply)
 *   2) synchronous `canvas.toDataURL("image/png")` after that compose
 *
 * Retouch/liquify already encode via `toBlob` + FileReader (see encodeStudioRetouchCanvasPng).
 * These helpers let the same selection bake paths yield between stages and share that async
 * encode contract without pulling the retouch worker graph into every caller.
 */

export type StudioMainThreadYield = () => Promise<void>;

type SchedulerWithYield = {
  yield?: () => Promise<void>;
};

/**
 * Yield control so the browser can paint, handle input, and run other tasks.
 * Prefers `scheduler.yield()` when present, otherwise one animation frame / macrotask.
 */
export function yieldStudioMainThread(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: SchedulerWithYield }).scheduler;
  if (typeof scheduler?.yield === "function") {
    return scheduler.yield();
  }
  return new Promise<void>((resolve) => {
    if (typeof globalThis.requestAnimationFrame === "function") {
      globalThis.requestAnimationFrame(() => resolve());
      return;
    }
    setTimeout(resolve, 0);
  });
}

export interface StudioPixelEditBakePipelineInput<TMask, TOut> {
  /** Build the selection (or other) mask. May allocate a full-resolution canvas. */
  rasterize: () => TMask | null | undefined;
  /** Apply the destructive edit using the mask. May allocate more full-resolution canvases. */
  apply: (mask: TMask) => TOut | null | undefined;
  /** Async PNG encode (toBlob preferred). */
  encode: (output: TOut) => Promise<string>;
  /** Optional cooperative yield. Defaults to {@link yieldStudioMainThread}. */
  yieldControl?: StudioMainThreadYield;
  /**
   * When true (default), yield after rasterize and after apply so UI can breathe before/after
   * the heaviest canvas stages. Set false only for tiny unit fixtures.
   */
  yieldBetweenStages?: boolean;
}

/**
 * Run rasterize → (yield) → apply → (yield) → encode without changing pixel math.
 * Returns null when rasterize or apply produce no output (caller decides whether that is an error).
 */
export async function runStudioPixelEditBakePipeline<TMask, TOut>(
  input: StudioPixelEditBakePipelineInput<TMask, TOut>,
): Promise<string | null> {
  const yieldControl = input.yieldControl ?? yieldStudioMainThread;
  const yieldBetween = input.yieldBetweenStages !== false;

  const mask = input.rasterize();
  if (mask == null) return null;
  if (yieldBetween) await yieldControl();

  const output = input.apply(mask);
  if (output == null) return null;
  if (yieldBetween) await yieldControl();

  return input.encode(output);
}

/**
 * Encode a bake canvas to a PNG data URL without blocking on synchronous toDataURL when
 * `toBlob` is available. Mirrors encodeStudioRetouchCanvasPng but does not touch the raster
 * surface cache — callers that want cache hits should use the retouch encoder instead.
 */
export async function encodeStudioPixelEditCanvasPng(
  canvas: HTMLCanvasElement,
  options: { signal?: AbortSignal } = {},
): Promise<string> {
  throwIfAborted(options.signal);
  if (typeof canvas.toBlob !== "function") {
    const src = canvas.toDataURL("image/png");
    throwIfAborted(options.signal);
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
    const onAbort = () => finish(() => reject(createAbortError()));
    options.signal?.addEventListener("abort", onAbort, { once: true });
    if (options.signal?.aborted) {
      onAbort();
      return;
    }
    canvas.toBlob((value) => finish(() => {
      if (value) resolve(value);
      else reject(new Error("픽셀 편집 PNG 인코딩에 실패했습니다."));
    }), "image/png");
  });
  throwIfAborted(options.signal);
  return blobToDataUrl(blob, options.signal);
}

function createAbortError(): Error {
  if (typeof DOMException === "function") {
    return new DOMException("픽셀 편집을 취소했습니다.", "AbortError");
  }
  const error = new Error("픽셀 편집을 취소했습니다.");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw createAbortError();
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
      finish(() => reject(createAbortError()));
    };
    reader.onerror = () => finish(() => reject(
      reader.error ?? new Error("픽셀 편집 PNG를 읽지 못했습니다."),
    ));
    reader.onload = () => finish(() => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("픽셀 편집 PNG를 data URL로 만들지 못했습니다."));
    });
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }
    reader.readAsDataURL(blob);
  });
}
