import { applyImageFilters, buildImageFilters, registerStudioKonvaFilters, type KonvaLike } from "./render/studio-konva-filters";
import {
  listEnabledStudioAdjustmentOperations,
  normalizeStudioAdjustmentFilterOperations,
} from "./studio-adjustment-stack";
import {
  StudioAdvancedBlurWorkerRequiredError,
  studioAdvancedBlurRequiresWorker,
} from "./studio-advanced-blur-filters";
import {
  STUDIO_IMAGE_FILTER_WORKER_PROTOCOL_VERSION,
  assertStudioImageFilterImageData,
  studioImageFilterRequestTransfers,
  studioImageFilterSourceLoadTransfers,
  type StudioImageFilterWorkerLoadSourceMessage,
  type StudioImageFilterWorkerRequestMessage,
  type StudioImageFilterWorkerResponseMessage,
  type StudioImageFilterWorkerRunMessage,
  type StudioImageFilterWorkerRunRequest,
  type StudioImageFilterWorkerRunSourceMessage,
} from "./studio-image-filter-worker-protocol";
import {
  StudioProfessionalFilterWorkerRequiredError,
  studioProfessionalFilterRequiresWorker,
} from "./studio-professional-filters";
import {
  StudioToneArtifactWorkerRequiredError,
  studioToneArtifactRequiresWorker,
} from "./studio-tone-artifact-filters";

import type { ImageFilterFields } from "./render/studio-konva-filter-fields";
import type { StudioImageDataLike } from "./studio-filters";

export interface StudioImageFilterWorkerLike {
  onmessage: ((event: MessageEvent<StudioImageFilterWorkerResponseMessage>) => void) | null;
  onerror:
    | ((event: {
        readonly error?: unknown;
        readonly message?: string;
        preventDefault?(): void;
      }) => void)
    | null;
  /** Deserialization failures do not dispatch `error`; settle them explicitly. */
  onmessageerror?: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: StudioImageFilterWorkerRequestMessage, transfer: Transferable[]): void;
  terminate(): void;
}

export type StudioImageFilterWorkerFactory = () => StudioImageFilterWorkerLike | null;

export type StudioImageFilterExecutionMode = "worker" | "direct";

export interface StudioImageFilterWorkerClientOptions {
  signal?: AbortSignal;
  /** Execution authority is selected before the request starts and never changes afterward. */
  executionMode?: StudioImageFilterExecutionMode;
  /** Test/integration seam for the selected Worker mode. `null` means unavailable, not direct. */
  workerFactory?: StudioImageFilterWorkerFactory | null;
}

export interface StudioImageFilterWorkerClientResult {
  execution: "worker" | "direct";
  imageData: StudioImageDataLike;
}

export interface StudioImageFilterWorkerSession {
  run(
    request: StudioImageFilterWorkerRunRequest,
    options?: Pick<StudioImageFilterWorkerClientOptions, "signal">,
  ): Promise<StudioImageFilterWorkerClientResult>;
  dispose(): void;
}

export type StudioImageFilterSourceRevision = string | number;

export interface StudioImageFilterResidentWorkerRunOptions {
  signal?: AbortSignal;
  /**
   * Caller-owned immutable source revision. Change it whenever pixels change. The client also
   * checks typed-array identity and dimensions so an accidentally reused revision cannot bind a
   * different source without reloading it.
   */
  sourceRevision: StudioImageFilterSourceRevision;
}

export interface StudioImageFilterResidentWorkerSession {
  run(
    request: StudioImageFilterWorkerRunRequest,
    options: StudioImageFilterResidentWorkerRunOptions,
  ): Promise<StudioImageFilterWorkerClientResult>;
  dispose(): void;
}

/** Vite statically discovers this exact URL pattern and emits an isolated module-worker chunk. */
export function createStudioImageFilterModuleWorker(): StudioImageFilterWorkerLike | null {
  if (typeof Worker !== "function") return null;
  return new Worker(new URL("./studio-image-filter.worker.ts", import.meta.url), {
    type: "module",
    name: "toonspectrum-image-filter",
  }) as unknown as StudioImageFilterWorkerLike;
}

function createAbortError(): Error {
  if (typeof DOMException === "function") {
    return new DOMException("이미지 필터 계산을 취소했습니다.", "AbortError");
  }
  const error = new Error("이미지 필터 계산을 취소했습니다.");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw createAbortError();
}

function createWorkerUnavailableError(message: string, cause?: unknown): Error {
  const error = new Error(
    message,
    cause === undefined ? undefined : { cause },
  );
  error.name = "StudioImageFilterWorkerUnavailableError";
  return error;
}

type ExhaustiveImageFilterFieldProjection = ImageFilterFields & Record<keyof ImageFilterFields, unknown>;

/**
 * Studio 이미지 요소처럼 더 넓은 객체에서 Worker/필터 엔진에 필요한 필드만 새 객체로 투영한다.
 * 이 코드는 의도 기반 Worker 청크 안에 둬 정적 Studio 경로에 공용 청크 요청을 추가하지 않는다.
 * 객체 열거·spread를 쓰지 않으므로 src, frame, 3D/VRM, provenance 같은 메타데이터가
 * structured clone 경계로 새어 나가지 않으며, 필드 추가 시 exhaustive 타입이 누락을 잡는다.
 */
function projectImageFilterFields(el: ImageFilterFields): ImageFilterFields {
  const finite = (value: number | undefined): number | undefined =>
    typeof value === "number" && Number.isFinite(value) ? value : undefined;
  const projection = {
    blur: finite(el.blur),
    brightness: finite(el.brightness),
    contrast: finite(el.contrast),
    grayscale: el.grayscale,
    sepia: el.sepia,
    screentone: el.screentone,
    lineart: el.lineart,
    lineCleanup: el.lineCleanup,
    screentoneRemoval: el.screentoneRemoval,
    jpegArtifactReduction: el.jpegArtifactReduction,
    edgeAwareDenoise: el.edgeAwareDenoise,
    lensBlur: el.lensBlur,
    fieldIrisBlur: el.fieldIrisBlur,
    tiltShiftBlur: el.tiltShiftBlur,
    selectiveGaussianBlur: el.selectiveGaussianBlur,
    differenceOfGaussians: el.differenceOfGaussians,
    dustScratches: el.dustScratches,
    tileableBlur: el.tileableBlur,
    chromatic: finite(el.chromatic),
    posterize: finite(el.posterize),
    noise: finite(el.noise),
    noiseSeed: finite(el.noiseSeed),
    saturation: finite(el.saturation),
    hue: finite(el.hue),
    temperature: finite(el.temperature),
    sharpen: finite(el.sharpen),
    pixelate: finite(el.pixelate),
    invert: el.invert,
    inkThreshold: finite(el.inkThreshold),
    duotoneShadow: el.duotoneShadow,
    duotoneHighlight: el.duotoneHighlight,
    levelsBlack: finite(el.levelsBlack),
    levelsWhite: finite(el.levelsWhite),
    levelsGamma: finite(el.levelsGamma),
    levelsOutBlack: finite(el.levelsOutBlack),
    levelsOutWhite: finite(el.levelsOutWhite),
    levelsCh: el.levelsCh,
    curve: el.curve,
    curveCh: el.curveCh,
    colorBalance: el.colorBalance,
    channelMixer: el.channelMixer,
    selectiveHsl: el.selectiveHsl,
    vibrance: el.vibrance,
    gradientMap: el.gradientMap,
    photoFilter: el.photoFilter,
    colorToAlpha: el.colorToAlpha,
    autoAdjust: el.autoAdjust,
    clarity: el.clarity,
    shadowHighlight: el.shadowHighlight,
    outline: el.outline,
    borderEffect: el.borderEffect,
    glow: el.glow,
    halftone: el.halftone,
    grain: el.grain,
    inkWash: el.inkWash,
    blurFx: el.blurFx,
    distort: el.distort,
    stylize: el.stylize,
    light: el.light,
    sketch: el.sketch,
    detail: el.detail,
    exposureAdjustment: el.exposureAdjustment,
    unsharpMask: el.unsharpMask,
    morphology: el.morphology,
    pixelOffset: el.pixelOffset,
    convolution: el.convolution,
    clouds: el.clouds,
    glitchFx: el.glitchFx,
    vignetteFx: el.vignetteFx,
    filterUnionWave: el.filterUnionWave,
    // The persisted stack can carry disabled/corrupt entries. Send only one normalized ordered
    // program across the clone boundary so the Worker cannot apply it twice.
    smartFilters: undefined,
    smartFilterOperations: el.smartFilterOperations !== undefined
      ? normalizeStudioAdjustmentFilterOperations(el.smartFilterOperations)
      : listEnabledStudioAdjustmentOperations(el.smartFilters),
  } satisfies ExhaustiveImageFilterFieldProjection;

  return projection;
}

/** Narrows the input to the protocol's clone-safe contract — drops any caller-attached helpers. */
function cloneSafeWorkerRequest(request: StudioImageFilterWorkerRunRequest): StudioImageFilterWorkerRunRequest {
  assertStudioImageFilterImageData(request.imageData);
  const sourceData = request.imageData.data;
  // 부분 view를 그대로 transfer하면 같은 ArrayBuffer의 무관한 바이트까지 Worker로 노출되고
  // 형제 view도 함께 detach된다. SharedArrayBuffer도 transferable이 아니므로 전용 버퍼로 복제한다.
  const hasDedicatedTransferableBuffer =
    sourceData.buffer instanceof ArrayBuffer
    && sourceData.byteOffset === 0
    && sourceData.byteLength === sourceData.buffer.byteLength;
  return {
    imageData: {
      data: hasDedicatedTransferableBuffer ? sourceData : new Uint8ClampedArray(sourceData),
      width: request.imageData.width,
      height: request.imageData.height,
    },
    el: projectImageFilterFields(request.el),
  };
}

const directFilterRegistry: KonvaLike = { Filters: {} };
registerStudioKonvaFilters(directFilterRegistry);

/** Shared policy used by the client and the React node before considering a synchronous fallback. */
export function studioImageFilterRequiresWorker(
  el: ImageFilterFields,
  width: number,
  height: number,
): boolean {
  return studioAdvancedBlurRequiresWorker(el, width, height)
    || studioProfessionalFilterRequiresWorker(el, width, height)
    || studioToneArtifactRequiresWorker(el, width, height);
}

function runImageFilterDirect(
  request: StudioImageFilterWorkerRunRequest,
  signal: AbortSignal | undefined,
): StudioImageFilterWorkerClientResult {
  throwIfAborted(signal);
  if (
    studioAdvancedBlurRequiresWorker(
      request.el,
      request.imageData.width,
      request.imageData.height,
    )
  ) {
    throw new StudioAdvancedBlurWorkerRequiredError();
  }
  if (
    studioProfessionalFilterRequiresWorker(
      request.el,
      request.imageData.width,
      request.imageData.height,
    )
  ) {
    throw new StudioProfessionalFilterWorkerRequiredError();
  }
  if (
    studioToneArtifactRequiresWorker(
      request.el,
      request.imageData.width,
      request.imageData.height,
    )
  ) {
    throw new StudioToneArtifactWorkerRequiredError();
  }
  const { filters, attrs } = buildImageFilters(request.el, directFilterRegistry);
  applyImageFilters(request.imageData, filters, attrs);
  return { execution: "direct", imageData: request.imageData };
}

function deserializeWorkerError(response: {
  readonly error?: unknown;
}): Error {
  const payload = response.error;
  if (!payload || typeof payload !== "object"
    || !("message" in payload) || typeof payload.message !== "string") {
    return createWorkerUnavailableError("이미지 필터 Worker의 오류 응답 형식이 올바르지 않습니다.");
  }
  const error = new Error(payload.message);
  error.name = "name" in payload && typeof payload.name === "string" && payload.name
    ? payload.name
    : "Error";
  return error;
}

function assertResultDimensions(
  result: StudioImageDataLike,
  source: StudioImageDataLike,
): void {
  assertStudioImageFilterImageData(result, "이미지 필터 Worker 결과");
  if (result.width !== source.width || result.height !== source.height) {
    throw new RangeError("이미지 필터 Worker 결과 크기가 원본과 일치하지 않습니다.");
  }
}

function runImageFilterWithWorker(
  worker: StudioImageFilterWorkerLike,
  request: StudioImageFilterWorkerRunRequest,
  signal: AbortSignal | undefined,
): Promise<StudioImageFilterWorkerClientResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let requestPosted = false;
    let readyTimer: ReturnType<typeof setTimeout> | null = null;
    let runTimer: ReturnType<typeof setTimeout> | null = null;
    const message: StudioImageFilterWorkerRunMessage = {
      type: "studio-image-filter/run",
      version: STUDIO_IMAGE_FILTER_WORKER_PROTOCOL_VERSION,
      request,
    };

    const cleanup = () => {
      if (readyTimer !== null) clearTimeout(readyTimer);
      if (runTimer !== null) clearTimeout(runTimer);
      signal?.removeEventListener("abort", onAbort);
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
    };
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const onAbort = () => finish(() => reject(createAbortError()));
    worker.onmessage = (event) => {
      if (settled) return;
      const response = event.data;
      if (
        !response
        || typeof response !== "object"
        || response.version !== STUDIO_IMAGE_FILTER_WORKER_PROTOCOL_VERSION
      ) {
        finish(() => reject(new Error("이미지 필터 Worker가 알 수 없는 응답을 반환했습니다.")));
        return;
      }
      if (response.type === "studio-image-filter/ready") {
        if (requestPosted) return;
        if (readyTimer !== null) {
          clearTimeout(readyTimer);
          readyTimer = null;
        }
        try {
          requestPosted = true;
          runTimer = setTimeout(
            () => finish(() => reject(new Error("이미지 필터 Worker 계산 시간이 초과되었습니다."))),
            30_000,
          );
          worker.postMessage(message, studioImageFilterRequestTransfers(message));
        } catch (error) {
          requestPosted = false;
          finish(() => reject(createWorkerUnavailableError(
            "이미지 필터 Worker에 요청을 전달하지 못했습니다.",
            error,
          )));
        }
        return;
      }
      if (!requestPosted) {
        finish(() => reject(new Error("이미지 필터 Worker가 준비 전에 결과를 반환했습니다.")));
        return;
      }
      if (response.type === "studio-image-filter/failure") {
        finish(() => reject(deserializeWorkerError(response)));
        return;
      }
      if (response.type !== "studio-image-filter/success") {
        finish(() => reject(new Error("이미지 필터 Worker가 알 수 없는 응답을 반환했습니다.")));
        return;
      }
      try {
        assertResultDimensions(response.imageData, request.imageData);
      } catch (error) {
        finish(() => reject(error));
        return;
      }
      finish(() => resolve({ execution: "worker", imageData: response.imageData }));
    };
    worker.onerror = (event) => {
      event.preventDefault?.();
      const error =
        event.error instanceof Error
          ? event.error
          : createWorkerUnavailableError(
              event.message || (requestPosted
                ? "이미지 필터 Worker 실행 중 오류가 발생했습니다."
                : "이미지 필터 Worker를 준비하지 못했습니다."),
            );
      finish(() => reject(error));
    };

    worker.onmessageerror = () => finish(() => reject(createWorkerUnavailableError(
      "이미지 필터 Worker 응답을 읽지 못했습니다.",
    )));

    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }
    readyTimer = setTimeout(
      () => finish(() => reject(createWorkerUnavailableError(
        "이미지 필터 Worker가 준비 시간 안에 응답하지 않았습니다.",
      ))),
      3_000,
    );
  });
}

/**
 * 이미지 보정 필터 체인을 요청 전에 선택한 단일 실행 모드로 처리한다. Worker 모드는
 * ArrayBuffer 소유권을 이전하며, 준비/전송/실행 실패 뒤 direct 모드로 바뀌지 않는다.
 * Direct 모드는 호출자가 `executionMode: "direct"`를 명시한 독립 요청에서만 허용된다.
 */
export async function runStudioImageFilterWorker(
  request: StudioImageFilterWorkerRunRequest,
  options: StudioImageFilterWorkerClientOptions = {},
): Promise<StudioImageFilterWorkerClientResult> {
  throwIfAborted(options.signal);
  const cloneSafeRequest = cloneSafeWorkerRequest(request);
  const executionMode = options.executionMode ?? "worker";
  if (executionMode === "direct") {
    return runImageFilterDirect(cloneSafeRequest, options.signal);
  }
  const factory =
    options.workerFactory === undefined ? createStudioImageFilterModuleWorker : options.workerFactory;
  if (!factory) {
    throw createWorkerUnavailableError("이미지 필터 Worker를 사용할 수 없습니다.");
  }

  let worker: StudioImageFilterWorkerLike | null;
  try {
    worker = factory();
  } catch (error) {
    throw createWorkerUnavailableError("이미지 필터 Worker를 만들지 못했습니다.", error);
  }
  if (!worker) {
    throw createWorkerUnavailableError("이미지 필터 Worker를 사용할 수 없습니다.");
  }
  return runImageFilterWithWorker(worker, cloneSafeRequest, options.signal);
}

type StudioImageFilterSessionTask = {
  request: StudioImageFilterWorkerRunRequest;
  signal?: AbortSignal;
  resolve(result: StudioImageFilterWorkerClientResult): void;
  reject(error: unknown): void;
  onAbort: () => void;
  posted: boolean;
  settled: boolean;
};

/**
 * Reusable serial Worker session for interactive sliders. Protocol v1 has no request id, so one
 * request is posted at a time while the same ready Worker remains alive across completed ticks.
 * Pending ticks can be aborted without terminating the Worker; a bounded execution timeout still
 * recovers from a genuinely wedged runtime.
 */
export function createStudioImageFilterWorkerSession(
  options: Pick<StudioImageFilterWorkerClientOptions, "executionMode" | "workerFactory"> = {},
): StudioImageFilterWorkerSession {
  const executionMode = options.executionMode ?? "worker";
  const factory = options.workerFactory === undefined
    ? createStudioImageFilterModuleWorker
    : options.workerFactory;
  const queue: StudioImageFilterSessionTask[] = [];
  let current: StudioImageFilterSessionTask | null = null;
  let worker: StudioImageFilterWorkerLike | null = null;
  let ready = false;
  let disposed = false;
  let readyTimer: ReturnType<typeof setTimeout> | null = null;
  let runTimer: ReturnType<typeof setTimeout> | null = null;

  const clearTimers = () => {
    if (readyTimer !== null) clearTimeout(readyTimer);
    if (runTimer !== null) clearTimeout(runTimer);
    readyTimer = null;
    runTimer = null;
  };

  const detachAbort = (task: StudioImageFilterSessionTask) => {
    task.signal?.removeEventListener("abort", task.onAbort);
  };

  const settle = (
    task: StudioImageFilterSessionTask,
    callback: () => void,
  ) => {
    if (task.settled) return;
    task.settled = true;
    detachAbort(task);
    callback();
  };

  const closeWorker = () => {
    clearTimers();
    if (worker) {
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
    }
    worker = null;
    ready = false;
  };

  const completeCurrent = (callback?: (task: StudioImageFilterSessionTask) => void) => {
    const task = current;
    if (!task) return;
    if (runTimer !== null) clearTimeout(runTimer);
    runTimer = null;
    current = null;
    callback?.(task);
    queueMicrotask(pump);
  };

  const runCurrentDirect = () => {
    completeCurrent((task) => {
      if (task.settled) return;
      try {
        const result = runImageFilterDirect(task.request, task.signal);
        settle(task, () => task.resolve(result));
      } catch (error) {
        settle(task, () => task.reject(error));
      }
    });
  };

  const rejectCurrentWorkerUnavailable = (message: string, cause?: unknown) => {
    closeWorker();
    completeCurrent((task) => settle(
      task,
      () => task.reject(createWorkerUnavailableError(message, cause)),
    ));
  };

  const postCurrent = () => {
    const task = current;
    if (!task || !worker || !ready || task.posted) return;
    if (task.signal?.aborted) {
      settle(task, () => task.reject(createAbortError()));
      completeCurrent();
      return;
    }
    const message: StudioImageFilterWorkerRunMessage = {
      type: "studio-image-filter/run",
      version: STUDIO_IMAGE_FILTER_WORKER_PROTOCOL_VERSION,
      request: task.request,
    };
    try {
      task.posted = true;
      runTimer = setTimeout(() => {
        const timedOut = current;
        if (!timedOut) return;
        closeWorker();
        completeCurrent((pending) => settle(
          pending,
          () => pending.reject(new Error("이미지 필터 Worker 계산 시간이 초과되었습니다.")),
        ));
      }, 30_000);
      worker.postMessage(message, studioImageFilterRequestTransfers(message));
    } catch (error) {
      task.posted = false;
      rejectCurrentWorkerUnavailable(
        "이미지 필터 Worker에 요청을 전달하지 못했습니다.",
        error,
      );
    }
  };

  const attachWorker = (nextWorker: StudioImageFilterWorkerLike) => {
    worker = nextWorker;
    ready = false;
    worker.onmessage = (event) => {
      if (disposed || worker !== nextWorker) return;
      const response = event.data;
      if (
        !response
        || typeof response !== "object"
        || response.version !== STUDIO_IMAGE_FILTER_WORKER_PROTOCOL_VERSION
      ) {
        const invalid = current;
        closeWorker();
        completeCurrent((task) => settle(
          task,
          () => task.reject(new Error("이미지 필터 Worker가 알 수 없는 응답을 반환했습니다.")),
        ));
        if (!invalid) queueMicrotask(pump);
        return;
      }
      if (response.type === "studio-image-filter/ready") {
        if (ready) return;
        if (readyTimer !== null) clearTimeout(readyTimer);
        readyTimer = null;
        ready = true;
        postCurrent();
        return;
      }
      const task = current;
      if (!task?.posted) {
        closeWorker();
        completeCurrent((pending) => settle(
          pending,
          () => pending.reject(new Error("이미지 필터 Worker가 준비 전에 결과를 반환했습니다.")),
        ));
        return;
      }
      if (response.type === "studio-image-filter/failure") {
        completeCurrent((pending) => settle(
          pending,
          () => pending.reject(deserializeWorkerError(response)),
        ));
        return;
      }
      if (response.type !== "studio-image-filter/success") {
        completeCurrent((pending) => settle(
          pending,
          () => pending.reject(new Error("이미지 필터 Worker가 알 수 없는 응답을 반환했습니다.")),
        ));
        return;
      }
      try {
        assertResultDimensions(response.imageData, task.request.imageData);
      } catch (error) {
        closeWorker();
        completeCurrent((pending) => settle(pending, () => pending.reject(error)));
        return;
      }
      completeCurrent((pending) => settle(
        pending,
        () => pending.resolve({ execution: "worker", imageData: response.imageData }),
      ));
    };
    worker.onerror = (event) => {
      if (disposed || worker !== nextWorker) return;
      event.preventDefault?.();
      const error = event.error instanceof Error
        ? event.error
        : createWorkerUnavailableError(
            event.message || "이미지 필터 Worker 실행 중 오류가 발생했습니다.",
          );
      closeWorker();
      completeCurrent((pending) => settle(pending, () => pending.reject(error)));
    };
    worker.onmessageerror = () => {
      if (disposed || worker !== nextWorker) return;
      rejectCurrentWorkerUnavailable("이미지 필터 Worker 응답을 읽지 못했습니다.");
    };
    readyTimer = setTimeout(
      () => rejectCurrentWorkerUnavailable(
        "이미지 필터 Worker가 준비 시간 안에 응답하지 않았습니다.",
      ),
      3_000,
    );
  };

  const ensureWorker = () => {
    if (worker || disposed) return;
    if (!factory) {
      rejectCurrentWorkerUnavailable("이미지 필터 Worker를 사용할 수 없습니다.");
      return;
    }
    try {
      const nextWorker = factory();
      if (!nextWorker) {
        rejectCurrentWorkerUnavailable("이미지 필터 Worker를 사용할 수 없습니다.");
        return;
      }
      attachWorker(nextWorker);
    } catch (error) {
      rejectCurrentWorkerUnavailable("이미지 필터 Worker를 만들지 못했습니다.", error);
    }
  };

  function pump(): void {
    if (disposed || current) return;
    while (queue.length > 0) {
      const task = queue.shift()!;
      if (task.settled || task.signal?.aborted) {
        settle(task, () => task.reject(createAbortError()));
        continue;
      }
      current = task;
      break;
    }
    if (!current) return;
    if (executionMode === "direct") {
      runCurrentDirect();
      return;
    }
    ensureWorker();
    if (ready) postCurrent();
  }

  return {
    run(request, runOptions = {}) {
      if (disposed) return Promise.reject(createAbortError());
      let cloneSafeRequest: StudioImageFilterWorkerRunRequest;
      try {
        throwIfAborted(runOptions.signal);
        cloneSafeRequest = cloneSafeWorkerRequest(request);
      } catch (error) {
        return Promise.reject(error);
      }
      return new Promise((resolve, reject) => {
        const task = {
          request: cloneSafeRequest,
          signal: runOptions.signal,
          resolve,
          reject,
          posted: false,
          settled: false,
          onAbort: () => {
            settle(task, () => reject(createAbortError()));
            if (current === task && !task.posted) {
              completeCurrent();
            } else if (current !== task) {
              // A busy Worker may take seconds. Do not retain cancelled full-size buffers
              // until it finishes while a slider keeps producing newer previews.
              const index = queue.indexOf(task);
              if (index !== -1) queue.splice(index, 1);
              queueMicrotask(pump);
            }
          },
        } satisfies StudioImageFilterSessionTask;
        task.signal?.addEventListener("abort", task.onAbort, { once: true });
        queue.push(task);
        pump();
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      closeWorker();
      if (current) {
        settle(current, () => current?.reject(createAbortError()));
        current = null;
      }
      for (const task of queue.splice(0)) {
        settle(task, () => task.reject(createAbortError()));
      }
    },
  };
}

type StudioImageFilterResidentSessionTask = {
  request: StudioImageFilterWorkerRunRequest;
  sourceRevision: StudioImageFilterSourceRevision;
  signal?: AbortSignal;
  resolve(result: StudioImageFilterWorkerClientResult): void;
  reject(error: unknown): void;
  onAbort: () => void;
  phase: "queued" | "loading-source" | "running";
  requestId?: number;
  sourceGeneration?: number;
  settled: boolean;
};

interface StudioImageFilterResidentSourceIdentity {
  readonly data: Uint8ClampedArray;
  readonly height: number;
  readonly revision: StudioImageFilterSourceRevision;
  readonly sourceGeneration: number;
  readonly width: number;
}

const STUDIO_IMAGE_FILTER_RESIDENT_SOURCE_ID = "studio-image-filter-resident-source";

function assertStudioImageFilterSourceRevision(
  revision: StudioImageFilterSourceRevision,
): void {
  if (
    typeof revision === "number"
    && Number.isSafeInteger(revision)
    && revision >= 0
  ) {
    return;
  }
  if (
    typeof revision === "string"
    && revision.length > 0
    && revision.length <= 512
  ) {
    return;
  }
  throw new TypeError("이미지 필터 상주 원본 revision 형식이 올바르지 않습니다.");
}

function residentSourceMatchesTask(
  source: StudioImageFilterResidentSourceIdentity | null,
  task: StudioImageFilterResidentSessionTask,
): source is StudioImageFilterResidentSourceIdentity {
  return !!source
    && source.data === task.request.imageData.data
    && source.width === task.request.imageData.width
    && source.height === task.request.imageData.height
    && Object.is(source.revision, task.sourceRevision);
}

/**
 * Interactive, source-resident image-filter session.
 *
 * The main thread transfers one private source copy only when source identity changes. Every
 * parameter-only slider tick then sends a small projected `ImageFilterFields` program. The Worker
 * keeps the immutable source and returns a fresh result buffer, so sequential ticks never compound
 * filters. A caller revision plus typed-array identity/dimensions guards against reusing pixels
 * from another source; Worker generation/request correlation rejects stale responses fail-closed.
 */
export function createStudioImageFilterResidentWorkerSession(
  options: Pick<StudioImageFilterWorkerClientOptions, "executionMode" | "workerFactory"> = {},
): StudioImageFilterResidentWorkerSession {
  const executionMode = options.executionMode ?? "worker";
  const factory = options.workerFactory === undefined
    ? createStudioImageFilterModuleWorker
    : options.workerFactory;
  const queue: StudioImageFilterResidentSessionTask[] = [];
  let current: StudioImageFilterResidentSessionTask | null = null;
  let worker: StudioImageFilterWorkerLike | null = null;
  let ready = false;
  let disposed = false;
  let readyTimer: ReturnType<typeof setTimeout> | null = null;
  let runTimer: ReturnType<typeof setTimeout> | null = null;
  let loadedSource: StudioImageFilterResidentSourceIdentity | null = null;
  let loadingSource: StudioImageFilterResidentSourceIdentity | null = null;
  let nextSourceGeneration = 0;
  let nextRequestId = 0;

  const clearTimers = () => {
    if (readyTimer !== null) clearTimeout(readyTimer);
    if (runTimer !== null) clearTimeout(runTimer);
    readyTimer = null;
    runTimer = null;
  };

  const detachAbort = (task: StudioImageFilterResidentSessionTask) => {
    task.signal?.removeEventListener("abort", task.onAbort);
  };

  const settle = (
    task: StudioImageFilterResidentSessionTask,
    callback: () => void,
  ) => {
    if (task.settled) return;
    task.settled = true;
    detachAbort(task);
    callback();
  };

  const closeWorker = () => {
    clearTimers();
    if (worker) {
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
    }
    worker = null;
    ready = false;
    loadedSource = null;
    loadingSource = null;
  };

  const completeCurrent = (
    callback?: (task: StudioImageFilterResidentSessionTask) => void,
  ) => {
    const task = current;
    if (!task) return;
    if (runTimer !== null) clearTimeout(runTimer);
    runTimer = null;
    current = null;
    callback?.(task);
    queueMicrotask(pump);
  };

  const runCurrentDirect = () => {
    completeCurrent((task) => {
      if (task.settled) return;
      try {
        assertStudioImageFilterImageData(task.request.imageData);
        const directRequest: StudioImageFilterWorkerRunRequest = {
          imageData: {
            data: new Uint8ClampedArray(task.request.imageData.data),
            width: task.request.imageData.width,
            height: task.request.imageData.height,
          },
          el: task.request.el,
        };
        const result = runImageFilterDirect(directRequest, task.signal);
        settle(task, () => task.resolve(result));
      } catch (error) {
        settle(task, () => task.reject(error));
      }
    });
  };

  const rejectCurrentWorkerUnavailable = (message: string, cause?: unknown) => {
    closeWorker();
    completeCurrent((task) => settle(
      task,
      () => task.reject(createWorkerUnavailableError(message, cause)),
    ));
  };

  const rejectCurrentProtocol = (message: string) => {
    closeWorker();
    completeCurrent((task) => settle(task, () => task.reject(new Error(message))));
  };

  const armRunTimer = () => {
    if (runTimer !== null) clearTimeout(runTimer);
    runTimer = setTimeout(() => {
      if (!current) return;
      closeWorker();
      completeCurrent((task) => settle(
        task,
        () => task.reject(new Error("이미지 필터 Worker 계산 시간이 초과되었습니다.")),
      ));
    }, 30_000);
  };

  const postCurrentRun = () => {
    const task = current;
    if (!task || !worker || !ready || task.settled) return;
    if (!residentSourceMatchesTask(loadedSource, task)) {
      rejectCurrentProtocol("이미지 필터 Worker 상주 원본 정체성이 일치하지 않습니다.");
      return;
    }
    if (task.signal?.aborted) {
      settle(task, () => task.reject(createAbortError()));
      completeCurrent();
      return;
    }
    const requestId = ++nextRequestId;
    task.requestId = requestId;
    task.sourceGeneration = loadedSource.sourceGeneration;
    task.phase = "running";
    const message: StudioImageFilterWorkerRunSourceMessage = {
      type: "studio-image-filter/run-source",
      version: STUDIO_IMAGE_FILTER_WORKER_PROTOCOL_VERSION,
      sourceId: STUDIO_IMAGE_FILTER_RESIDENT_SOURCE_ID,
      sourceGeneration: loadedSource.sourceGeneration,
      requestId,
      el: task.request.el,
    };
    try {
      armRunTimer();
      worker.postMessage(message, []);
    } catch (error) {
      if (runTimer !== null) clearTimeout(runTimer);
      runTimer = null;
      task.phase = "queued";
      rejectCurrentWorkerUnavailable(
        "이미지 필터 Worker에 실행 요청을 전달하지 못했습니다.",
        error,
      );
    }
  };

  const ensureCurrentSource = () => {
    const task = current;
    if (!task || !worker || !ready || task.settled) return;
    if (residentSourceMatchesTask(loadedSource, task)) {
      postCurrentRun();
      return;
    }
    try {
      assertStudioImageFilterImageData(task.request.imageData);
    } catch (error) {
      completeCurrent((pending) => settle(pending, () => pending.reject(error)));
      return;
    }
    const sourceGeneration = ++nextSourceGeneration;
    const source: StudioImageFilterResidentSourceIdentity = {
      data: task.request.imageData.data,
      width: task.request.imageData.width,
      height: task.request.imageData.height,
      revision: task.sourceRevision,
      sourceGeneration,
    };
    const message: StudioImageFilterWorkerLoadSourceMessage = {
      type: "studio-image-filter/load-source",
      version: STUDIO_IMAGE_FILTER_WORKER_PROTOCOL_VERSION,
      sourceId: STUDIO_IMAGE_FILTER_RESIDENT_SOURCE_ID,
      sourceGeneration,
      // The component retains its immutable snapshot for masks/GPU fallback. Transfer one private
      // copy only on a source revision/identity change; parameter ticks do not allocate this copy.
      imageData: {
        data: new Uint8ClampedArray(task.request.imageData.data),
        width: task.request.imageData.width,
        height: task.request.imageData.height,
      },
    };
    task.sourceGeneration = sourceGeneration;
    task.phase = "loading-source";
    loadingSource = source;
    try {
      armRunTimer();
      worker.postMessage(message, studioImageFilterSourceLoadTransfers(message));
    } catch (error) {
      if (runTimer !== null) clearTimeout(runTimer);
      runTimer = null;
      task.phase = "queued";
      loadingSource = null;
      rejectCurrentWorkerUnavailable(
        "이미지 필터 Worker에 원본을 전달하지 못했습니다.",
        error,
      );
    }
  };

  const attachWorker = (nextWorker: StudioImageFilterWorkerLike) => {
    worker = nextWorker;
    ready = false;
    loadedSource = null;
    loadingSource = null;
    worker.onmessage = (event) => {
      if (disposed || worker !== nextWorker) return;
      const response = event.data;
      if (
        !response
        || typeof response !== "object"
        || response.version !== STUDIO_IMAGE_FILTER_WORKER_PROTOCOL_VERSION
      ) {
        rejectCurrentProtocol("이미지 필터 Worker가 알 수 없는 응답을 반환했습니다.");
        return;
      }
      if (response.type === "studio-image-filter/ready") {
        if (ready) return;
        if (readyTimer !== null) clearTimeout(readyTimer);
        readyTimer = null;
        ready = true;
        ensureCurrentSource();
        return;
      }

      const task = current;
      if (!task || task.phase === "queued") {
        rejectCurrentProtocol("이미지 필터 Worker가 준비 전에 결과를 반환했습니다.");
        return;
      }

      if (response.type === "studio-image-filter/source-loaded") {
        const expected = loadingSource;
        if (
          task.phase !== "loading-source"
          || !expected
          || response.sourceId !== STUDIO_IMAGE_FILTER_RESIDENT_SOURCE_ID
          || response.sourceGeneration !== expected.sourceGeneration
          || task.sourceGeneration !== response.sourceGeneration
        ) {
          rejectCurrentProtocol("이미지 필터 Worker가 오래되었거나 잘못된 원본 응답을 반환했습니다.");
          return;
        }
        if (runTimer !== null) clearTimeout(runTimer);
        runTimer = null;
        loadedSource = expected;
        loadingSource = null;
        if (task.settled) {
          completeCurrent();
          return;
        }
        postCurrentRun();
        return;
      }

      if (response.type === "studio-image-filter/source-failure") {
        const sourceMatches =
          response.sourceId === STUDIO_IMAGE_FILTER_RESIDENT_SOURCE_ID
          && response.sourceGeneration === task.sourceGeneration;
        const requestMatches = task.phase === "loading-source"
          ? response.requestId === undefined
          : response.requestId === task.requestId;
        if (!sourceMatches || !requestMatches) {
          rejectCurrentProtocol("이미지 필터 Worker가 오래되었거나 잘못된 실패 응답을 반환했습니다.");
          return;
        }
        if (task.phase === "loading-source") {
          loadedSource = null;
          loadingSource = null;
        }
        completeCurrent((pending) => settle(
          pending,
          () => pending.reject(deserializeWorkerError(response)),
        ));
        return;
      }

      if (response.type !== "studio-image-filter/source-success") {
        rejectCurrentProtocol("이미지 필터 Worker가 알 수 없는 응답을 반환했습니다.");
        return;
      }
      if (
        task.phase !== "running"
        || response.sourceId !== STUDIO_IMAGE_FILTER_RESIDENT_SOURCE_ID
        || response.sourceGeneration !== task.sourceGeneration
        || response.requestId !== task.requestId
        || !residentSourceMatchesTask(loadedSource, task)
      ) {
        rejectCurrentProtocol("이미지 필터 Worker가 오래되었거나 잘못된 필터 결과를 반환했습니다.");
        return;
      }
      try {
        assertResultDimensions(response.imageData, task.request.imageData);
      } catch (error) {
        closeWorker();
        completeCurrent((pending) => settle(pending, () => pending.reject(error)));
        return;
      }
      completeCurrent((pending) => settle(
        pending,
        () => pending.resolve({ execution: "worker", imageData: response.imageData }),
      ));
    };
    worker.onerror = (event) => {
      if (disposed || worker !== nextWorker) return;
      event.preventDefault?.();
      const error = event.error instanceof Error
        ? event.error
        : createWorkerUnavailableError(
            event.message || "이미지 필터 Worker 실행 중 오류가 발생했습니다.",
          );
      closeWorker();
      completeCurrent((pending) => settle(pending, () => pending.reject(error)));
    };
    worker.onmessageerror = () => {
      if (disposed || worker !== nextWorker) return;
      rejectCurrentWorkerUnavailable("이미지 필터 Worker 응답을 읽지 못했습니다.");
    };
    readyTimer = setTimeout(
      () => rejectCurrentWorkerUnavailable(
        "이미지 필터 Worker가 준비 시간 안에 응답하지 않았습니다.",
      ),
      3_000,
    );
  };

  const ensureWorker = () => {
    if (worker || disposed) return;
    if (!factory) {
      rejectCurrentWorkerUnavailable("이미지 필터 Worker를 사용할 수 없습니다.");
      return;
    }
    try {
      const nextWorker = factory();
      if (!nextWorker) {
        rejectCurrentWorkerUnavailable("이미지 필터 Worker를 사용할 수 없습니다.");
        return;
      }
      attachWorker(nextWorker);
    } catch (error) {
      rejectCurrentWorkerUnavailable("이미지 필터 Worker를 만들지 못했습니다.", error);
    }
  };

  function pump(): void {
    if (disposed || current) return;
    while (queue.length > 0) {
      const task = queue.shift()!;
      if (task.settled || task.signal?.aborted) {
        settle(task, () => task.reject(createAbortError()));
        continue;
      }
      current = task;
      break;
    }
    if (!current) return;
    if (executionMode === "direct") {
      runCurrentDirect();
      return;
    }
    ensureWorker();
    if (ready) ensureCurrentSource();
  }

  return {
    run(request, runOptions) {
      if (disposed) return Promise.reject(createAbortError());
      let residentRequest: StudioImageFilterWorkerRunRequest;
      try {
        throwIfAborted(runOptions.signal);
        assertStudioImageFilterImageData(request.imageData);
        assertStudioImageFilterSourceRevision(runOptions.sourceRevision);
        residentRequest = {
          imageData: {
            data: request.imageData.data,
            width: request.imageData.width,
            height: request.imageData.height,
          },
          el: projectImageFilterFields(request.el),
        };
      } catch (error) {
        return Promise.reject(error);
      }
      return new Promise((resolve, reject) => {
        const task = {
          request: residentRequest,
          sourceRevision: runOptions.sourceRevision,
          signal: runOptions.signal,
          resolve,
          reject,
          phase: "queued",
          settled: false,
          onAbort: () => {
            settle(task, () => reject(createAbortError()));
            if (current === task && task.phase === "queued") {
              completeCurrent();
            } else if (current !== task) {
              const index = queue.indexOf(task);
              if (index !== -1) queue.splice(index, 1);
              queueMicrotask(pump);
            }
          },
        } satisfies StudioImageFilterResidentSessionTask;
        task.signal?.addEventListener("abort", task.onAbort, { once: true });
        queue.push(task);
        pump();
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      closeWorker();
      if (current) {
        settle(current, () => current?.reject(createAbortError()));
        current = null;
      }
      for (const task of queue.splice(0)) {
        settle(task, () => task.reject(createAbortError()));
      }
    },
  };
}
