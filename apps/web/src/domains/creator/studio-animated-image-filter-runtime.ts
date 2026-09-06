/**
 * Animated GIF filters have a separate presentation owner from the static-image GPU/Worker
 * tournament. The browser owns GIF decoding and advances the live HTMLImageElement; this owner
 * periodically rebuilds Konva's cache from that current frame. It never submits tournament cost
 * samples and never reads pixels back from a GPU surface.
 */
export const STUDIO_ANIMATED_IMAGE_FILTER_OWNER = "konva-live-gif-frame-cache-v1";
export const STUDIO_ANIMATED_IMAGE_FILTER_FRAME_INTERVAL_MS = 80;
export const STUDIO_ANIMATED_IMAGE_FILTER_MAX_PIXELS = 2 * 1024 * 1024;
export const STUDIO_ANIMATED_IMAGE_FILTER_MAX_PIXEL_PASSES = 8 * 1024 * 1024;

export type StudioAnimatedImageFilterState =
  | "inactive"
  | "preparing"
  | "active"
  | "degraded";

export type StudioAnimatedImageFilterReason =
  | "not-requested"
  | "source-loading"
  | "filter-runtime-loading"
  | "filter-runtime-unavailable"
  | "filter-capability-runtime-loading"
  | "filter-capability-runtime-unavailable"
  | "filter-mask-loading"
  | "filter-mask-unavailable"
  | "multi-frame-playback-owner"
  | "empty-filter-program"
  | "offthread-provider-required"
  | "invalid-surface-dimensions"
  | "pixel-budget-exceeded"
  | "pixel-pass-budget-exceeded"
  | "live-frame-cache"
  | "density-capped"
  | "runtime-cache-failed";

export interface StudioAnimatedImageFilterStatus {
  readonly cacheConfig?: {
    readonly offset?: number;
    readonly pixelRatio: number;
  };
  readonly density: number;
  readonly message: string;
  readonly owner: typeof STUDIO_ANIMATED_IMAGE_FILTER_OWNER;
  readonly pixelCount: number;
  readonly pixelPasses: number;
  readonly reason: StudioAnimatedImageFilterReason;
  readonly state: StudioAnimatedImageFilterState;
}

export interface StudioAnimatedImageFilterCapabilityInput {
  readonly cachePad: number;
  readonly filterCapabilityRuntime: "loading" | "ready" | "unavailable";
  readonly filterCount: number;
  readonly filterMask: "none" | "loading" | "ready" | "unavailable";
  readonly filterRequested: boolean;
  readonly filterRuntime: "loading" | "ready" | "unavailable";
  readonly height: number;
  readonly isAnimatedGif: boolean;
  readonly multiFramePlayback: boolean;
  readonly requestedDensity: number;
  readonly requiresOffthreadProvider: boolean;
  readonly runtimeFailure?: string;
  readonly sourceReady: boolean;
  readonly width: number;
}

function status(
  state: StudioAnimatedImageFilterState,
  reason: StudioAnimatedImageFilterReason,
  message: string,
  extras?: Partial<Pick<
    StudioAnimatedImageFilterStatus,
    "cacheConfig" | "density" | "pixelCount" | "pixelPasses"
  >>,
): StudioAnimatedImageFilterStatus {
  return {
    density: extras?.density ?? 1,
    message,
    owner: STUDIO_ANIMATED_IMAGE_FILTER_OWNER,
    pixelCount: extras?.pixelCount ?? 0,
    pixelPasses: extras?.pixelPasses ?? 0,
    reason,
    state,
    ...(extras?.cacheConfig ? { cacheConfig: extras.cacheConfig } : {}),
  };
}

function boundedSurface(input: StudioAnimatedImageFilterCapabilityInput, density: number): {
  readonly pixelCount: number;
  readonly pixelPasses: number;
} | null {
  const paddedWidth = input.width + Math.max(0, input.cachePad) * 2;
  const paddedHeight = input.height + Math.max(0, input.cachePad) * 2;
  const width = Math.ceil(paddedWidth * density);
  const height = Math.ceil(paddedHeight * density);
  if (
    !Number.isSafeInteger(width)
    || !Number.isSafeInteger(height)
    || width <= 0
    || height <= 0
  ) return null;
  const pixelCount = width * height;
  const pixelPasses = pixelCount * Math.max(1, input.filterCount);
  if (!Number.isSafeInteger(pixelCount) || !Number.isSafeInteger(pixelPasses)) return null;
  return { pixelCount, pixelPasses };
}

export function evaluateStudioAnimatedImageFilterCapability(
  input: StudioAnimatedImageFilterCapabilityInput,
): StudioAnimatedImageFilterStatus {
  if (!input.isAnimatedGif || !input.filterRequested) {
    return status("inactive", "not-requested", "실시간 GIF 필터가 요청되지 않았습니다.");
  }
  if (!input.sourceReady) {
    return status("preparing", "source-loading", "GIF 원본 프레임을 불러오는 중입니다.");
  }
  if (input.multiFramePlayback) {
    return status(
      "degraded",
      "multi-frame-playback-owner",
      "다중 프레임 셀 재생기가 이 이미지를 소유해 GIF 실시간 필터를 적용하지 않았습니다.",
    );
  }
  if (input.filterRuntime === "loading") {
    return status("preparing", "filter-runtime-loading", "GIF 필터 런타임을 불러오는 중입니다.");
  }
  if (input.filterRuntime === "unavailable") {
    return status(
      "degraded",
      "filter-runtime-unavailable",
      "GIF 필터 런타임을 사용할 수 없어 필터 표시를 중단했습니다.",
    );
  }
  if (input.filterCapabilityRuntime === "loading") {
    return status(
      "preparing",
      "filter-capability-runtime-loading",
      "필터의 안전한 실시간 실행 가능 여부를 확인하는 중입니다.",
    );
  }
  if (input.filterCapabilityRuntime === "unavailable") {
    return status(
      "degraded",
      "filter-capability-runtime-unavailable",
      "필터 안전성 검사 런타임을 사용할 수 없어 필터 표시를 중단했습니다.",
    );
  }
  if (input.filterMask === "loading") {
    return status("preparing", "filter-mask-loading", "GIF 필터 마스크를 불러오는 중입니다.");
  }
  if (input.filterMask === "unavailable") {
    return status(
      "degraded",
      "filter-mask-unavailable",
      "필터 마스크를 읽을 수 없어 필터 표시를 중단했습니다.",
    );
  }
  if (input.runtimeFailure) {
    return status(
      "degraded",
      "runtime-cache-failed",
      `GIF 프레임 필터 캐시를 갱신하지 못해 필터 표시를 중단했습니다: ${input.runtimeFailure}`,
    );
  }
  if (input.filterCount <= 0) {
    return status(
      "degraded",
      "empty-filter-program",
      "요청한 GIF 효과에 실행 가능한 필터 프로그램이 없어 필터 표시를 중단했습니다.",
    );
  }
  if (input.requiresOffthreadProvider) {
    return status(
      "degraded",
      "offthread-provider-required",
      "이 효과는 전용 Worker가 필요해 현재 GIF 프레임에 안전하게 실시간 적용할 수 없습니다.",
    );
  }
  if (
    !Number.isFinite(input.width)
    || !Number.isFinite(input.height)
    || input.width <= 0
    || input.height <= 0
    || !Number.isFinite(input.requestedDensity)
    || input.requestedDensity <= 0
    || !Number.isFinite(input.cachePad)
    || input.cachePad < 0
  ) {
    return status(
      "degraded",
      "invalid-surface-dimensions",
      "GIF 필터 표면의 크기가 올바르지 않아 필터 표시를 중단했습니다.",
    );
  }

  const requestedDensity = Math.max(1, input.requestedDensity);
  const requested = boundedSurface(input, requestedDensity);
  const fallback = requestedDensity > 1 ? boundedSurface(input, 1) : requested;
  if (!requested || !fallback) {
    return status(
      "degraded",
      "invalid-surface-dimensions",
      "GIF 필터 표면의 크기가 안전한 정수 범위를 벗어났습니다.",
    );
  }

  const requestedFits = requested.pixelCount <= STUDIO_ANIMATED_IMAGE_FILTER_MAX_PIXELS
    && requested.pixelPasses <= STUDIO_ANIMATED_IMAGE_FILTER_MAX_PIXEL_PASSES;
  const chosenDensity = requestedFits ? requestedDensity : 1;
  const chosen = requestedFits ? requested : fallback;
  if (chosen.pixelCount > STUDIO_ANIMATED_IMAGE_FILTER_MAX_PIXELS) {
    return status(
      "degraded",
      "pixel-budget-exceeded",
      "GIF 실시간 필터의 2MP 프레임 예산을 초과해 필터 표시를 중단했습니다.",
      { density: chosenDensity, ...chosen },
    );
  }
  if (chosen.pixelPasses > STUDIO_ANIMATED_IMAGE_FILTER_MAX_PIXEL_PASSES) {
    return status(
      "degraded",
      "pixel-pass-budget-exceeded",
      "GIF 실시간 필터의 8M pixel-pass 예산을 초과해 필터 표시를 중단했습니다.",
      { density: chosenDensity, ...chosen },
    );
  }

  const cacheConfig = {
    ...(input.cachePad > 0 ? { offset: input.cachePad } : {}),
    pixelRatio: chosenDensity,
  };
  if (chosenDensity !== requestedDensity) {
    return status(
      "active",
      "density-capped",
      "GIF 애니메이션과 필터를 유지하기 위해 실시간 캐시 밀도를 1×로 제한했습니다.",
      { cacheConfig, density: chosenDensity, ...chosen },
    );
  }
  return status(
    "active",
    "live-frame-cache",
    "현재 GIF 프레임을 약 12fps로 다시 캐시해 필터와 애니메이션을 함께 표시합니다.",
    { cacheConfig, density: chosenDensity, ...chosen },
  );
}

export interface StudioAnimatedImageFilterFrameNode {
  cache(config: { readonly offset?: number; readonly pixelRatio: number }): void;
  clearCache(): void;
  getLayer(): { batchDraw(): void } | null | undefined;
}

export interface StudioAnimatedImageFilterFrameLoopInput {
  readonly cacheConfig?: { readonly offset?: number; readonly pixelRatio: number };
  readonly cancelFrame: (id: number) => void;
  readonly filterFrames: boolean;
  readonly intervalMs?: number;
  readonly isCurrent: () => boolean;
  readonly isPenDown: () => boolean;
  readonly node: StudioAnimatedImageFilterFrameNode;
  readonly onFilteredFrame?: () => void;
  readonly onRuntimeFailure?: (error: unknown) => void;
  readonly requestFrame: (callback: FrameRequestCallback) => number;
}

export interface StudioAnimatedImageFilterFrameLoop {
  refreshNow(): boolean;
  stop(): void;
}

/**
 * Starts the browser-decoded GIF frame owner. `filterFrames=false` is deliberately the original
 * lightweight 12fps `batchDraw` path. With filters enabled, each admitted frame clears and rebuilds
 * the cache before the draw. A cache failure is terminal for this selected filtered presentation:
 * it is reported once and no raw-animation redraw is scheduled as an implicit replacement.
 */
export function startStudioAnimatedImageFilterFrameLoop(
  input: StudioAnimatedImageFilterFrameLoopInput,
): StudioAnimatedImageFilterFrameLoop {
  const intervalMs = input.intervalMs ?? STUDIO_ANIMATED_IMAGE_FILTER_FRAME_INTERVAL_MS;
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new RangeError("Animated GIF frame interval must be a positive finite number");
  }
  if (input.filterFrames && !input.cacheConfig) {
    throw new TypeError("Animated GIF filtered frame loop requires cacheConfig");
  }

  let frameId: number | null = null;
  let lastDrawAt = 0;
  let stopped = false;
  let filterHealthy = input.filterFrames;
  let failureReported = false;

  const drawCurrentFrame = (): boolean => {
    if (stopped || !input.isCurrent()) return false;
    let filtered = false;
    if (filterHealthy && input.cacheConfig) {
      try {
        input.node.clearCache();
        input.node.cache(input.cacheConfig);
        filtered = true;
      } catch (error) {
        filterHealthy = false;
        if (!failureReported) {
          failureReported = true;
          input.onRuntimeFailure?.(error);
        }
        return false;
      }
    }
    input.node.getLayer()?.batchDraw();
    if (filtered) input.onFilteredFrame?.();
    return filtered;
  };

  const requestNext = () => {
    if (stopped) return;
    frameId = input.requestFrame(tick);
  };
  const tick = (now: number) => {
    frameId = null;
    if (stopped) return;
    if (!input.isCurrent()) {
      stopped = true;
      return;
    }
    if (!input.isPenDown() && now - lastDrawAt >= intervalMs) {
      lastDrawAt = now;
      drawCurrentFrame();
    }
    if (!input.filterFrames || filterHealthy) requestNext();
  };

  // A filtered GIF must not advertise success while showing an unfiltered first frame. The
  // filter-free path intentionally preserves the old behavior and waits for its first 80ms tick.
  if (input.filterFrames && !input.isPenDown()) drawCurrentFrame();
  if (!input.filterFrames || filterHealthy) requestNext();

  return {
    refreshNow: drawCurrentFrame,
    stop() {
      if (stopped) return;
      stopped = true;
      if (frameId !== null) input.cancelFrame(frameId);
      frameId = null;
      if (input.filterFrames && filterHealthy) {
        try {
          input.node.clearCache();
          input.node.getLayer()?.batchDraw();
        } catch {
          // A lost Konva/canvas context during teardown has no remaining presentation authority.
        }
      }
    },
  };
}
