import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { Image as KImage } from "react-konva/lib/ReactKonvaCore";

import {
  planStudioFilterIslandLanes,
} from "./filter/studio-filter-island-plan";
import {
  applyFilterMaskToPixels,
  computeFilterMaskCoverage,
  shouldApplyFilterMask,
  wrapKonvaFiltersWithFilterMask,
  type FilterMaskCoverage,
  type FilterMaskKonvaFilterFn,
} from "./filter/studio-filter-mask";
import {
  captureStudioFilterExecutionRouteSnapshot,
  recordStudioFilterExecutionShadow,
} from "./render/studio-filter-plan-shadow";
import {
  ensureStudioGpuFilterLaneAdmission,
  readStudioGpuFilterLaneAdmission,
  type StudioGpuFilterLaneAdmission,
} from "./render/studio-gpu-filter-lane-admission";
import {
  hasActiveImageFilters,
  imageFilterCacheKey,
  type ImageFilterFields,
} from "./render/studio-konva-filter-fields";
import { studioKonvaRuntime as KonvaRuntime } from "./render/studio-konva-runtime";
import {
  getStudioRasterEditSurfaceSnapshot,
  subscribeStudioRasterEditSurfaces,
} from "./render/studio-raster-edit-surface-cache";
import {
  acknowledgeStudioRasterImagePresentation,
  acknowledgeStudioRasterImagePresentationDraw,
  expectedStudioRasterImagePresentation,
  registerStudioMountedRasterImagePresentation,
  type StudioRasterImagePresentationExpectation,
} from "./render/studio-raster-image-presentation";
import {
  evaluateStudioAnimatedImageFilterCapability,
  startStudioAnimatedImageFilterFrameLoop,
  type StudioAnimatedImageFilterStatus,
} from "./studio-animated-image-filter-runtime";
import { resizableNodeProps } from "./studio-node-props";
import { computePanelAutoFitPatch } from "./studio-panel-autofit";
import { sha256HexPortable } from "./studio-sha256";
import { toKonvaSkewAttrs } from "./studio-skew";

import type { StudioGpuFilterPreviewFrame } from "./render/studio-gpu-filter-apply";
import type { StudioGpuFilterPresentationSurface } from "./render/studio-gpu-filter-presentation";
import type { FrameEl, ImageEl } from "./studio-element-model";
import type Konva from "konva";

import { toast } from "@/shared/lib/toast-store";

const IMAGE_FILTER_BUILD_CACHE_LIMIT = 200;
const IMAGE_FILTER_WORKER_DEBOUNCE_MS = 80;
// ── Slider-drag scheduling ────────────────────────────────────────────────────────────────────
// Measured 2026-08-09 (headless Chromium, page-composite radial blur): dragging the strength
// slider produced 5.8–9.4 s before the first pixel moved and 8.7–9.0 s more after release. The
// cause is not the main thread (longtask stayed under 150 ms) — it is that every slider value
// dispatched a full-resolution job, and aborting an already-posted Worker request only rejects
// the promise: the Worker keeps computing, so each new value queued behind the last one.
//
// The fix is scheduling, not arithmetic. An eligible GPU chain renders each drag frame into one
// retained GPUCanvas surface; no staging map or pixel readback occurs while the pointer is moving.
// The same in-flight frame handle performs the sole canonical readback after settle. Unsupported,
// masked or unsupported programs are assigned to a declared compatibility boundary before work;
// a visibly failed GPU operation preserves the previous frame without starting another engine.
/** A value this soon after the previous one is a drag frame, not a decision. */
const IMAGE_FILTER_DRAG_WINDOW_MS = 450;
/** Full-resolution recompute waits for the drag to stop; the proxy carries the frames until then. */
const IMAGE_FILTER_DRAG_SETTLE_MS = 220;
/** One frame — the proxy exists to answer the pointer, so it must not sit behind a debounce. */
const IMAGE_FILTER_PROXY_DEBOUNCE_MS = 16;
/** Drag-preview budget. 512² is an order of magnitude cheaper than a full page composite. */
const IMAGE_FILTER_PROXY_MAX_PIXELS = 512 * 512;
/** Below this the full-resolution pass is already interactive and a proxy would only add a hop. */
const IMAGE_FILTER_PROXY_MIN_SOURCE_PIXELS = 4 * IMAGE_FILTER_PROXY_MAX_PIXELS;
/**
 * An abandoned request still occupies the Worker until it finishes. Past this age the session is
 * torn down instead, so the settle pass starts on a free Worker rather than behind a dead job.
 */
const IMAGE_FILTER_STALE_REQUEST_TEARDOWN_MS = 250;
const IMAGE_FILTER_WORKER_RESULT_CACHE_LIMIT = 4;
const PAGE_COMPOSITE_FILTER_RESULT_CACHE_LIMIT = 1;
// One RGBA input plus transfer/result/intermediate buffers can coexist. Keep interactive filtering
// at 16 MP / 64 MiB per surface. The Worker protocol independently enforces its broader 64 MP hard
// boundary; keeping this stricter UI budget local avoids eagerly loading the optional Worker
// protocol solely to read a constant before the user applies an image filter.
const IMAGE_FILTER_INTERACTIVE_MAX_PIXELS = 16 * 1024 * 1024;
// HiDPI 필터 슈퍼샘플 상한 — 3D 인서트 캡처와 같은 이유로 2를 넘기지 않는다(픽셀 4× 메모리 캡).
const IMAGE_FILTER_SUPERSAMPLE_MAX = 2;

/** Monotonic effect clock kept outside the component body for React purity. */
function studioImageFilterClockMs(): number {
  return globalThis.performance.now();
}

// eslint-disable-next-line react-refresh/only-export-components -- pure handoff verifier is tested independently from the Konva node
export function verifyStudioLivingInkPngDataUrlHash(
  src: string,
  expected: `sha256:${string}` | undefined,
): `sha256:${string}` | null {
  if (!expected || !src.startsWith("data:image/png;base64,")) return null;
  try {
    const binary = globalThis.atob(src.slice("data:image/png;base64,".length));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    const actual = `sha256:${sha256HexPortable(bytes)}` as const;
    return actual === expected ? actual : null;
  } catch {
    return null;
  }
}

/**
 * 밀도 불변이 증명된 buildImageFilters attrs 화이트리스트(명시적 per-attr 목록).
 *
 * 여기 있는 attr 는 전부 픽셀 단위 기하가 전혀 없는 per-pixel 포인트(색/톤) 연산이거나
 * 정규화 좌표(치수 상대) 연산(비네트)이다 — 슈퍼샘플 버퍼에서 실행해도 수학적으로 같은 룩이
 * 나오고 픽셀만 촘촘해진다. 목록에 없는 attr 가 하나라도 있으면 기본 거부(1× 밀도)로 남는다:
 * px 단위 파라미터(블러 반경·망점 도트 px·테두리 굵기·그레인 크기·픽셀레이트 셀·왜곡 스케일,
 * 커널 풋프린트 등)는 Konva 캐시/Worker 버퍼가 커지면 콘텐츠 대비 효과가 줄어들기 때문이다.
 * 새 필터가 추가되어도 여기 등재 전까지는 자동으로 기존 1× 동작을 유지한다(default-deny).
 */
// eslint-disable-next-line react-refresh/only-export-components -- 밀도 화이트리스트는 이 노드의 캐시 소유권과 한 경계이며 계약 테스트가 직접 대조한다
export const STUDIO_DENSITY_INVARIANT_FILTER_ATTRS: ReadonlySet<string> = new Set([
  // 밝기/대비 — per-pixel 포인트 연산.
  "brightness",
  "contrast",
  // HSL — per-pixel 색 변환(luminance 는 항상 0 으로 부착된다).
  "saturation",
  "hue",
  "luminance",
  // 색온도 — per-pixel 채널 시프트.
  "temperature",
  // 레벨(마스터 + r/g/b 채널) — 256칸 LUT 포인트 연산.
  "levelsBlack",
  "levelsWhite",
  "levelsGamma",
  "levelsOutBlack",
  "levelsOutWhite",
  "levelsR",
  "levelsG",
  "levelsB",
  // 톤 커브(마스터 + r/g/b 채널) — LUT 포인트 연산.
  "curvePoints",
  "curvePointsR",
  "curvePointsG",
  "curvePointsB",
  // 컬러 밸런스 — per-pixel 톤 영역 가중 시프트.
  "cbShadows",
  "cbMidtones",
  "cbHighlights",
  // 채널 믹서 — per-pixel 3×3 색 행렬.
  "channelMixer",
  // 선택 색상(HSL 밴드) — per-pixel 색상 분류·보정.
  "selectiveHsl",
  // 생동감 — per-pixel 채도 곡선.
  "vibrance",
  "vibranceSat",
  // 그라디언트 맵 — 휘도 LUT 포인트 연산.
  "gradientMap",
  // 포토 필터 — per-pixel 색 오버레이.
  "pfColor",
  "pfDensity",
  "pfPreserve",
  // 색상 투명화 — per-pixel 키 컬러 거리 → 알파.
  "ctaColor",
  "ctaStrength",
  // 전문 필터 실행 경계 표식 자체는 픽셀 값을 바꾸지 않는다. px 기반 전문 필터는
  // 각자의 radius/sigma attrs 가 화이트리스트 밖이므로 계속 1×로 default-deny 된다.
  "professionalFilterExecution",
  // 듀오톤 — 휘도 → 2색 매핑 포인트 연산.
  "duotoneShadow",
  "duotoneHighlight",
  // 잉크 스레숄드 — per-pixel 휘도 임계.
  "inkThreshold",
  // 포스터라이즈 — per-pixel 양자화.
  "posterize",
  // 노출 — per-pixel EV/감마/오프셋.
  "exposureEv",
  "exposureGamma",
  "exposureOffset",
  // 섀도우/하이라이트 — 휘도 LUT 포인트 연산(width 파라미터는 톤 범위이지 px 가 아니다).
  "shShadows",
  "shShadowsWidth",
  "shHighlights",
  "shHighlightsWidth",
  "shMidtoneContrast",
  // 비네트 — half-dimension 정규화 좌표 기하(절대 px 없음).
  "vignetteDarkness",
  "vignetteSize",
  "vignetteRoundness",
  "vignetteFeather",
]);

/**
 * 이미지 필터 슈퍼샘플 밀도를 결정한다 — 활성 보정 프로그램 전체가 밀도 불변으로 증명된
 * 경우에만 min(2, devicePixelRatio), 그 외에는 1(기존 룩 그대로).
 *
 * 판정 재료는 buildImageFilters 가 실제로 부착한 attrs(default-deny 화이트리스트)와,
 * attrs 없이 filters 배열에만 나타나는 px 단위 플래그 필터(screentone/lineart — 6px 타일·
 * 3×3 소벨 커널), 그리고 attrs 가 래퍼 클로저에 숨는 스마트 필터 스택(내용 검사가 불가하므로
 * 보수적으로 제외)이다. Grayscale/Sepia/Invert 도 attrs 가 없지만 포인트 연산이라 안전하다.
 * Konva 캐시(pixelRatio)와 Worker 스냅샷이 같은 값을 써야 두 경로의 룩이 일치한다.
 */
// eslint-disable-next-line react-refresh/only-export-components -- 순수 밀도 판정은 이 노드의 캐시 구성과 분리할 수 없는 공개 계약이다
export function studioImageFilterSupersampleDensity(input: {
  readonly attrs: Record<string, unknown>;
  readonly el: Pick<
    ImageFilterFields,
    "screentone" | "lineart" | "smartFilters" | "smartFilterOperations"
  >;
  readonly devicePixelRatio: number;
}): number {
  const dpr = input.devicePixelRatio;
  if (typeof dpr !== "number" || !Number.isFinite(dpr) || dpr <= 1) return 1;
  if (input.el.screentone || input.el.lineart) return 1;
  if (
    input.el.smartFilters != null
    || (Array.isArray(input.el.smartFilterOperations) && input.el.smartFilterOperations.length > 0)
  ) {
    return 1;
  }
  for (const key of Object.keys(input.attrs)) {
    if (!STUDIO_DENSITY_INVARIANT_FILTER_ATTRS.has(key)) return 1;
  }
  return Math.min(IMAGE_FILTER_SUPERSAMPLE_MAX, dpr);
}
type StudioKonvaFiltersModule = typeof import( "./render/studio-konva-filters");
type StudioImageFilterWorkerClientModule = typeof import("./studio-image-filter-worker-client");
type StudioGpuFilterApplyModule = typeof import("./render/studio-gpu-filter-apply");
type StudioImageFilterWorkerSession = ReturnType<
  StudioImageFilterWorkerClientModule["createStudioImageFilterResidentWorkerSession"]
>;
type ImageFilterBuild = ReturnType<StudioKonvaFiltersModule["buildImageFilters"]>;
const EMPTY_IMAGE_FILTER_BUILD: ImageFilterBuild = { filters: [], attrs: {}, cachePad: 0 };
const imageFilterBuildCache = new Map<string, ImageFilterBuild>();
let studioKonvaFiltersPromise: Promise<StudioKonvaFiltersModule> | null = null;

interface LoadedImageState {
  image: HTMLImageElement;
  src: string;
}

type StudioRasterDisplaySource = HTMLImageElement | HTMLCanvasElement;

interface DisplayImageState {
  flipped: boolean;
  flippedY: boolean;
  image: CanvasImageSource;
  isAnimatedGif: boolean;
  loadedImage: StudioRasterDisplaySource;
  src: string;
}

function studioRasterDisplaySourceDimensions(source: StudioRasterDisplaySource): {
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

function createStudioRasterFlippedDisplaySource(
  source: StudioRasterDisplaySource,
  flipped: boolean,
  flippedY: boolean,
): StudioRasterDisplaySource {
  const scaleX = flipped ? -1 : 1;
  const scaleY = flippedY ? -1 : 1;
  if (scaleX === 1 && scaleY === 1) return source;
  try {
    const { width, height } = studioRasterDisplaySourceDimensions(source);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return source;
    context.translate(scaleX === -1 ? width : 0, scaleY === -1 ? height : 0);
    context.scale(scaleX, scaleY);
    context.drawImage(source, 0, 0);
    return canvas;
  } catch (error) {
    console.error("[studio] image flip canvas failed, using original image:", error);
    return source;
  }
}

interface WorkerFilteredCanvasState {
  canvas: HTMLCanvasElement;
  filterKey: string;
  height: number;
  source: CanvasImageSource;
  src: string;
  width: number;
}

interface GpuFilteredCanvasState extends WorkerFilteredCanvasState {
  readonly frame: StudioGpuFilterPreviewFrame;
  readonly revision: number;
}

interface WorkerSourcePixelsState {
  data: Uint8ClampedArray;
  height: number;
  revision: number;
  source: CanvasImageSource;
  width: number;
}

interface WorkerResultCacheState {
  canvases: Map<string, HTMLCanvasElement>;
  height: number;
  source: CanvasImageSource;
  width: number;
}

interface FilterMaskDecodedState {
  coverage: FilterMaskCoverage;
  src: string;
}

interface KonvaFilterPresentationReadyState {
  readonly requestKey: string;
  readonly source: CanvasImageSource;
}

function isStudioFilterWorkerRequiredError(error: unknown): boolean {
  const code = (
    error !== null && typeof error === "object"
      ? (error as { code?: unknown }).code
      : undefined
  );
  return code === "STUDIO_ADVANCED_BLUR_WORKER_REQUIRED"
    || code === "STUDIO_PROFESSIONAL_FILTER_WORKER_REQUIRED"
    || code === "STUDIO_TONE_ARTIFACT_WORKER_REQUIRED";
}

function releaseWorkerResultCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = 0;
  canvas.height = 0;
}

function releaseWorkerResultCache(cache: WorkerResultCacheState | null): void {
  if (!cache) return;
  for (const canvas of cache.canvases.values()) {
    releaseWorkerResultCanvas(canvas);
  }
  cache.canvases.clear();
}

function trimWorkerResultCache(
  cache: WorkerResultCacheState | null,
  limit: number,
  retainedKey?: string,
): void {
  if (!cache) return;
  while (cache.canvases.size > limit) {
    let evictionKey: string | undefined;
    for (const key of cache.canvases.keys()) {
      if (key !== retainedKey) {
        evictionKey = key;
        break;
      }
    }
    evictionKey ??= cache.canvases.keys().next().value;
    if (!evictionKey) return;
    const evictedCanvas = cache.canvases.get(evictionKey);
    if (evictedCanvas) releaseWorkerResultCanvas(evictedCanvas);
    cache.canvases.delete(evictionKey);
  }
}

function loadStudioKonvaFilters(): Promise<StudioKonvaFiltersModule> {
  if (!studioKonvaFiltersPromise) {
    studioKonvaFiltersPromise = import( "./render/studio-konva-filters")
      .then((mod) => {
        mod.registerStudioKonvaFilters(KonvaRuntime);
        return mod;
      })
      .catch((error) => {
        studioKonvaFiltersPromise = null;
        throw error;
      });
  }
  return studioKonvaFiltersPromise;
}

function cachedBuildImageFilters(el: ImageEl, key: string, mod: StudioKonvaFiltersModule): ImageFilterBuild {
  const cached = imageFilterBuildCache.get(key);
  if (cached) return cached;
  const built = mod.buildImageFilters(el, KonvaRuntime);
  if (imageFilterBuildCache.size >= IMAGE_FILTER_BUILD_CACHE_LIMIT) {
    const oldest = imageFilterBuildCache.keys().next().value;
    if (oldest) imageFilterBuildCache.delete(oldest);
  }
  imageFilterBuildCache.set(key, built);
  return built;
}

export interface StudioKonvaImageNodeProps {
  el: ImageEl;
  draggable: boolean;
  innerRef: (n: Konva.Image | null) => void;
  onSelect: () => void;
  onChange: (patch: Partial<ImageEl>) => void;
  dragBoundFunc?: (pos: Konva.Vector2d) => Konva.Vector2d;
  autoFitFrames: FrameEl[] | null;
  onInteractionBegin?: () => boolean;
  onInteractionEnd?: () => void;
  /** 라이브 스트로크가 진행 중이면 GIF 재생 batchDraw 를 쉬어 포인터 프레임 예산을 지킨다. */
  liveStrokeRef?: { readonly current: unknown };
  /**
   * Browser-decoded animated GIF filter authority. Consumers can surface active/preparing/degraded
   * state without inferring success from a filter toggle; the same state is also pinned on KImage.
   */
  onAnimatedImageFilterStatus?: (status: StudioAnimatedImageFilterStatus) => void;
  /**
   * Hokusai 라이브 표면을 canonical PNG로 넘기는 실제 표시 영수증.
   * 이미지 decode만으로는 충분하지 않다. 이 노드가 정확한 PNG를 메인 Konva 레이어에
   * 동기 drawScene한 뒤에만 호출되어, 상위 편집기가 임시 라이브 표면을 빈 프레임 없이 해제한다.
   */
  onHokusaiCanonicalImageReady?: (
    elementId: string,
    pngHash: `sha256:${string}`,
  ) => void;
  /** Same synchronous main-layer receipt for the flattened Living Ink physical layer. */
  onLivingInkCanonicalImageReady?: (
    elementId: string,
    pngHash: `sha256:${string}`,
    routeKey: string,
  ) => void;
  /** False for mask/preview copies that must never satisfy the canonical raster draw fence. */
  rasterPresentationEligible?: boolean;
}

// 비동기 로드가 필요한 이미지 노드 — src 가 바뀌면 다시 로드한다.
export function StudioKonvaImageNode({
  el,
  draggable,
  innerRef,
  onSelect,
  onChange,
  dragBoundFunc,
  autoFitFrames,
  onInteractionBegin,
  onInteractionEnd,
  liveStrokeRef,
  onAnimatedImageFilterStatus,
  onHokusaiCanonicalImageReady,
  onLivingInkCanonicalImageReady,
  rasterPresentationEligible = true,
}: StudioKonvaImageNodeProps) {
  const [loadedImage, setLoadedImage] = useState<LoadedImageState>();
  const [displayImage, setDisplayImage] = useState<DisplayImageState>();
  const [filterModule, setFilterModule] = useState<StudioKonvaFiltersModule | null>(null);
  const [filterModuleSettled, setFilterModuleSettled] = useState(false);
  const [filterWorkerClient, setFilterWorkerClient] = useState<StudioImageFilterWorkerClientModule | null>(null);
  const [filterWorkerClientSettled, setFilterWorkerClientSettled] = useState(false);
  const [gpuFilterLoad, setGpuFilterLoad] = useState<{
    module: StudioGpuFilterApplyModule | null;
    settled: boolean;
  }>({ module: null, settled: false });
  const gpuFilterModule = gpuFilterLoad.module;
  const gpuFilterModuleSettled = gpuFilterLoad.settled;
  const [gpuLaneAdmission, setGpuLaneAdmission] = useState<StudioGpuFilterLaneAdmission>(
    readStudioGpuFilterLaneAdmission,
  );
  const [workerFilteredCanvas, setWorkerFilteredCanvas] = useState<WorkerFilteredCanvasState>();
  const [proxyFilteredCanvas, setProxyFilteredCanvas] = useState<WorkerFilteredCanvasState>();
  const [gpuFilteredCanvas, setGpuFilteredCanvas] = useState<GpuFilteredCanvasState>();
  const [workerRequiredFailureKey, setWorkerRequiredFailureKey] = useState<string>();
  const [animatedFilterRuntimeFailure, setAnimatedFilterRuntimeFailure] = useState<{
    message: string;
    requestKey: string;
  }>();
  const [animatedFilterPresentationKey, setAnimatedFilterPresentationKey] = useState<string>();
  const [konvaFilterPresentationReady, setKonvaFilterPresentationReady] =
    useState<KonvaFilterPresentationReadyState>();
  const [verifiedLivingInkHash, setVerifiedLivingInkHash] = useState<`sha256:${string}` | null>(null);
  const imageRef = useRef<Konva.Image | null>(null);
  const filterWorkerSessionRef = useRef<StudioImageFilterWorkerSession | null>(null);
  // Drag previews get their own Worker on purpose: the expensive full-resolution job cannot be
  // preempted once posted, so sharing a session would make the proxy queue behind exactly the
  // computation it exists to hide.
  const filterProxySessionRef = useRef<StudioImageFilterWorkerSession | null>(null);
  const gpuFilterPresentationSurfaceRef = useRef<StudioGpuFilterPresentationSurface | null>(null);
  const gpuFilterPreviewFrameRef = useRef<StudioGpuFilterPreviewFrame | null>(null);
  const proxySourcePixelsRef = useRef<WorkerSourcePixelsState | null>(null);
  const proxyCanvasRef = useRef<HTMLCanvasElement | null>(null);
  // The first request is a settled edit, never a drag continuation. `0` misclassified it on a
  // freshly opened page (and under deterministic clocks), sending the first full frame to proxy.
  const filterRequestAtRef = useRef(Number.NEGATIVE_INFINITY);
  const workerSourcePixelsRef = useRef<WorkerSourcePixelsState | null>(null);
  const workerSourceRevisionRef = useRef(0);
  const workerResultCacheRef = useRef<WorkerResultCacheState | null>(null);
  const workerFailureNoticeRef = useRef<{ key: string } | null>(null);
  const animatedFilterNoticeRef = useRef<string | null>(null);
  const hokusaiPresentationReceiptRef = useRef<string | null>(null);
  const livingInkPresentationReceiptRef = useRef<string | null>(null);
  const rasterImagePresentationReceiptRef =
    useRef<StudioRasterImagePresentationExpectation | null>(null);
  // 최신 el을 담아두는 ref — 아래 Worker 필터 effect가 좌표 드래그 등 필터와 무관한 el 변경마다
  // 재실행되지 않도록(의존성은 filterCacheKey/width/height만) 최신 값만 읽어들이는 용도.
  const elRef = useRef(el);
  elRef.current = el;

  useLayoutEffect(() => {
    if (
      !rasterPresentationEligible
      || !el.src.startsWith("studio-opfs-cas:sha256:")
    ) return;
    return registerStudioMountedRasterImagePresentation({ elementId: el.id, src: el.src });
  }, [el.id, el.src, rasterPresentationEligible]);

  useEffect(() => {
    const src = el.src;
    const im = new globalThis.Image();
    let active = true;
    let releaseResolvedSource: (() => void) | null = null;
    im.onload = () => {
      if (active) setLoadedImage({ image: im, src });
    };
    im.onerror = () => {
      if (!active) return;
      // 현재 src의 재로딩까지 실패했다면 이전 성공 이미지를 남기지 않는다. 다른 src가 이미
      // 성공한 뒤 도착한 오래된 error는 그 상태를 지우지 않는다.
      setLoadedImage((current) => current?.src === src ? undefined : current);
    };
    // Canonical linked-3D pass bytes stay in OPFS/CAS. Acquire the shared, verified presentation
    // lease only for decode/presentation; ordinary sources retain their synchronous assignment
    // path. The lease owns both the bounded CAS read and the ref-counted Blob URL lifetime.
    if (src.startsWith("studio-opfs-cas:sha256:")) {
      void import("./render/studio-raster-source-lease")
        .then(({ acquireStudioRasterSourceLease }) =>
          acquireStudioRasterSourceLease(src, {
            consumer: "studio-konva-image-node",
          }))
        .then((lease) => {
          if (!active) {
            lease.release();
            return;
          }
          if (lease.kind !== "linked-3d-cas") {
            lease.release();
            im.onerror?.(new Event("error"));
            return;
          }
          releaseResolvedSource = lease.release;
          im.src = lease.src;
        })
        .catch(() => {
          if (active) im.onerror?.(new Event("error"));
        });
    } else {
      // Cached data/blob URLs can complete in the assignment tick, so handlers are attached first.
      im.src = src;
    }
    return () => {
      active = false;
      im.onload = null;
      im.onerror = null;
      setLoadedImage((current) => current?.src === src ? undefined : current);
      try {
        im.removeAttribute("src");
      } catch {
        // A non-DOM Image shim may not expose attributes; dropping handlers and state still fences it.
      }
      releaseResolvedSource?.();
    };
  }, [el.src]);

  const rasterEditSurfaceSnapshot = useSyncExternalStore(
    subscribeStudioRasterEditSurfaces,
    () => getStudioRasterEditSurfaceSnapshot(el.src),
    () => null,
  );
  // Cache eviction drops global ownership, but a mounted node must not swap an equivalent source
  // identity mid-frame: doing so invalidates exact Worker/GPU-filter results and briefly exposes
  // raw pixels. This short handoff lease is released as soon as the canonical decoded/flip-ready
  // source can replace it; it must not outlive the global cache lease for the component mount.
  const [mountedRasterEditSurface, setMountedRasterEditSurface] = useState<{
    readonly src: string;
    readonly surface: HTMLCanvasElement;
  } | null>(null);
  useLayoutEffect(() => {
    if (rasterEditSurfaceSnapshot) {
      setMountedRasterEditSurface((current) => (
        current?.src === el.src && current.surface === rasterEditSurfaceSnapshot
          ? current
          : { src: el.src, surface: rasterEditSurfaceSnapshot }
      ));
    } else {
      setMountedRasterEditSurface((current) => current?.src === el.src ? current : null);
    }
  }, [el.src, rasterEditSurfaceSnapshot]);
  const rasterEditSurface = rasterEditSurfaceSnapshot
    ?? (
      mountedRasterEditSurface?.src === el.src
        ? mountedRasterEditSurface.surface
        : null
    );
  // The exact just-encoded canvas can render immediately while the canonical PNG continues
  // decoding above. A different src never reuses it, so undo/remote edits fail closed.
  const decodedImg = loadedImage?.src === el.src ? loadedImage.image : undefined;
  const img: StudioRasterDisplaySource | undefined = rasterEditSurface ?? decodedImg;
  const flipped = !!el.flipped;
  const flippedY = !!el.flippedY;
  const isAnimatedGif = !!el.isAnimatedGif;
  const requiresBakedFlip = !isAnimatedGif && (flipped || flippedY);
  const displayImg = requiresBakedFlip
    ? (
        displayImage?.src === el.src
        && displayImage.loadedImage === img
        && displayImage.flipped === flipped
        && displayImage.flippedY === flippedY
        && displayImage.isAnimatedGif === isAnimatedGif
          ? displayImage.image
          : undefined
      )
    : img;

  useEffect(() => {
    if (!img) {
      setDisplayImage(undefined);
      return;
    }
    const commitDisplayImage = (image: CanvasImageSource) => {
      setDisplayImage({
        flipped,
        flippedY,
        image,
        isAnimatedGif,
        loadedImage: img,
        src: el.src,
      });
    };
    if (!requiresBakedFlip) {
      // 반전은 캔버스에 한 프레임을 구워야만 가능한데, 그러면 애니메이션이 멈춘다 — 재생 보존이
      // 우선이므로 이 경로를 건너뛰고 항상 라이브 img를 그대로 쓴다(알려진 한계: 애니메이션 GIF는
      // 좌우/상하 반전이 적용되지 않는다). 정적 비반전 이미지도 render-time에 그대로 전달해
      // 캐시 표면이 effect 한 번을 기다리지 않고 첫 Konva draw에 참여하게 한다.
      setDisplayImage(undefined);
      return;
    }
    if (
      displayImage?.src === el.src
      && displayImage.loadedImage === img
      && displayImage.flipped === flipped
      && displayImage.flippedY === flippedY
      && displayImage.isAnimatedGif === isAnimatedGif
    ) return;
    commitDisplayImage(createStudioRasterFlippedDisplaySource(img, flipped, flippedY));
  }, [displayImage, img, el.src, flipped, flippedY, isAnimatedGif, requiresBakedFlip]);

  const hasFilters = hasActiveImageFilters(el);
  const filterCacheKey = imageFilterCacheKey(el);

  // ── 필터 마스크(비파괴 필터 부분 적용) — 디코드된 커버리지 맵. 마스크가 요청된 동안에는
  // 그 정확한 src의 커버리지가 준비되기 전까지 필터 전체를 fail-closed 한다. 직전 마스크를
  // 계속 쓰거나 마스크 없이 전체 이미지에 필터를 적용하면, 새 마스크 스트로크/교체/디코드
  // 실패 순간에 사용자가 지정하지 않은 픽셀까지 비파괴 보정이 번지는 더 큰 데이터 오류가 된다.
  // 마스크가 제거되거나 명시적으로 꺼지면 요청 자체가 없으므로 기존 전체 적용 동작을 보존한다.
  const filterMaskRequested = hasFilters && shouldApplyFilterMask(el);
  const filterMaskWantedSrc = filterMaskRequested ? el.filterMaskSrc : undefined;
  const [decodedFilterMask, setDecodedFilterMask] = useState<FilterMaskDecodedState | null>(null);
  const [failedFilterMaskSrc, setFailedFilterMaskSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!filterMaskWantedSrc) {
      setDecodedFilterMask(null);
      setFailedFilterMaskSrc(null);
      return;
    }
    const src = filterMaskWantedSrc;
    setFailedFilterMaskSrc((current) => current === src ? current : null);
    const im = new globalThis.Image();
    let active = true;
    const clearCurrentDecodedMask = () => {
      if (!active) return;
      setDecodedFilterMask((current) => current?.src === src ? null : current);
    };
    im.onload = () => {
      if (!active) return;
      try {
        const w = im.naturalWidth || im.width;
        const h = im.naturalHeight || im.height;
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          clearCurrentDecodedMask();
          setFailedFilterMaskSrc(src);
          return;
        }
        ctx.drawImage(im, 0, 0);
        const pixels = ctx.getImageData(0, 0, w, h);
        const coverage = computeFilterMaskCoverage(pixels.data, w, h);
        if (!coverage) {
          clearCurrentDecodedMask();
          setFailedFilterMaskSrc(src);
          return;
        }
        if (active) {
          setFailedFilterMaskSrc(null);
          setDecodedFilterMask({ coverage, src });
        }
      } catch (error) {
        clearCurrentDecodedMask();
        if (active) setFailedFilterMaskSrc(src);
        console.error("[studio] filter mask decode failed, preserving the unfiltered source:", error);
      }
    };
    im.onerror = () => {
      clearCurrentDecodedMask();
      if (active) setFailedFilterMaskSrc(src);
    };
    // 캐시된 data URL은 대입과 같은 tick에 완료될 수 있으므로 handler를 먼저 연결한다.
    im.src = src;
    return () => {
      active = false;
      im.onload = null;
      im.onerror = null;
    };
  }, [filterMaskWantedSrc]);
  // 비동기 effect 정리보다 렌더가 먼저 일어나도 오래된 src의 coverage가 단 한 프레임도
  // 활성화되지 않도록 렌더 경계에서 정체성을 다시 대조한다.
  const activeFilterMask =
    filterMaskWantedSrc && decodedFilterMask?.src === filterMaskWantedSrc
      ? decodedFilterMask
      : null;
  // A durable surface reference is intentionally projected to a Blob URL only after exact
  // hydration. During that gap `filterMaskSrc` is absent, but the request still exists. Blocking
  // on the request (rather than only on the URL) prevents a whole-image filter flash while a
  // referenced mask is loading, missing, malformed, or rejected.
  const filterMaskActivationBlocked = filterMaskRequested && !activeFilterMask;
  // 마스크가 섞인 필터 결과는 별도 정체성으로 캐시한다 — imageFilterCacheKey(다른 소유자의
  // 파일)는 건드리지 않고, 이 노드가 소유한 모든 결과 캐시 키에 마스크 data URL을 함께 섞는다
  // (el.src를 키에 그대로 쓰는 기존 관례와 동일 — 내용이 곧 정체성).
  const maskedFilterKey = filterMaskWantedSrc
    ? JSON.stringify([filterCacheKey, filterMaskWantedSrc])
    : filterCacheKey;
  useEffect(() => {
    if (!hasFilters || filterModule) return;
    let active = true;
    loadStudioKonvaFilters()
      .then((mod) => {
        if (active) {
          setFilterModule(mod);
          setFilterModuleSettled(true);
        }
      })
      .catch((error) => {
        console.error("Failed to load studio image filters:", error);
        if (active) setFilterModuleSettled(true);
      });
    return () => {
      active = false;
    };
  }, [filterModule, hasFilters]);

  // Program-expressible AND actually runnable here. Splitting these two questions is the whole point
  // of the admission gate: the first is about the filter, the second about the machine.
  const gpuFilterProgramEligible =
    gpuLaneAdmission === "admitted"
    && gpuFilterModule?.isStudioGpuFilterChainEligible(el) === true;

  // Probed once per session, alongside the GPU chunk import so the two settle together rather than
  // in series. Until it settles the filter effect waits, exactly as it already waits for the chunk.
  useEffect(() => {
    if (!hasFilters || gpuLaneAdmission !== "unknown") return;
    let active = true;
    void ensureStudioGpuFilterLaneAdmission().then((next) => {
      if (active) setGpuLaneAdmission(next);
    });
    return () => {
      active = false;
    };
  }, [gpuLaneAdmission, hasFilters]);
  // Worker 코드는 GPU 모듈이 정상 로드된 뒤 현재 프로그램을 지원하지 않는다고 판정했을 때만
  // 가져온다. GPU provider가 선택된 요청은 Worker 청크의 준비 여부와 완전히 독립적이다.
  useEffect(() => {
    if (
      !hasFilters
      || !gpuFilterModuleSettled
      || !gpuFilterModule
      || gpuFilterProgramEligible
      || filterWorkerClient
    ) return;
    let active = true;
    import("./studio-image-filter-worker-client")
      .then((mod) => {
        if (active) {
          setFilterWorkerClient(mod);
          setFilterWorkerClientSettled(true);
        }
      })
      .catch((error) => {
        console.error("Failed to load studio image filter worker client:", error);
        if (active) setFilterWorkerClientSettled(true);
      });
    return () => {
      active = false;
    };
  }, [
    filterWorkerClient,
    gpuFilterModule,
    gpuFilterModuleSettled,
    gpuFilterProgramEligible,
    hasFilters,
  ]);

  // M1 GPU(WGSL) 필터 경로 — 지원 5필드 전용. 실패는 선택 엔진 사용 불가로 노출되며
  // Worker/Konva 실행 권한을 부여하지 않는다.
  // konva 미의존 별도 청크라 첫 청크 예산 무영향(worker client 로드와 동일한 이유).
  useEffect(() => {
    if (!hasFilters || gpuFilterModuleSettled) return;
    let active = true;
    import("./render/studio-gpu-filter-apply")
      .then((mod) => {
        if (!active) return;
        // One state transition keeps "settled" and the module namespace causally atomic. A split
        // update can let the first Worker timer capture `module=null` and bypass the GPU candidate.
        setGpuFilterLoad({ module: mod, settled: true });
      })
      .catch((error) => {
        console.error("Failed to load studio GPU filter module:", error);
        if (active) setGpuFilterLoad({ module: null, settled: true });
      });
    return () => {
      active = false;
    };
  }, [gpuFilterModuleSettled, hasFilters]);

  useEffect(() => () => {
    filterWorkerSessionRef.current?.dispose();
    filterWorkerSessionRef.current = null;
    filterProxySessionRef.current?.dispose();
    filterProxySessionRef.current = null;
    proxySourcePixelsRef.current = null;
    gpuFilterPreviewFrameRef.current?.dispose();
    gpuFilterPreviewFrameRef.current = null;
    gpuFilterPresentationSurfaceRef.current?.dispose();
    gpuFilterPresentationSurfaceRef.current = null;
    if (proxyCanvasRef.current) releaseWorkerResultCanvas(proxyCanvasRef.current);
    proxyCanvasRef.current = null;
    releaseWorkerResultCache(workerResultCacheRef.current);
    workerResultCacheRef.current = null;
  }, [filterWorkerClient]);

  // 보정값 → Konva 필터 배열 + 노드 속성. 캐시 의존성은 직렬화 키로 비교(좌표 드래그 시 재캐시 방지).
  const built = hasFilters && filterModule
    ? cachedBuildImageFilters(el, filterCacheKey, filterModule)
    : EMPTY_IMAGE_FILTER_BUILD;
  // HiDPI 필터 밀도 — 활성 보정이 전부 밀도 불변(포인트/정규화 연산)일 때만 min(2, dpr)로
  // 슈퍼샘플링한다("같은 룩, 더 선명한 픽셀"). px 단위 필터가 하나라도 있으면 1× 유지.
  const requestedFilterDensity = hasFilters && filterModule
    ? studioImageFilterSupersampleDensity({
        attrs: built.attrs,
        el,
        devicePixelRatio: globalThis.devicePixelRatio || 1,
      })
    : 1;
  const workerBaseWidth = Math.max(1, Math.round(el.width));
  const workerBaseHeight = Math.max(1, Math.round(el.height));
  const densifiedWidth = Math.max(1, Math.round(el.width * requestedFilterDensity));
  const densifiedHeight = Math.max(1, Math.round(el.height * requestedFilterDensity));
  // 슈퍼샘플 결과가 인터랙티브 픽셀 예산을 넘으면 기존 1× 밀도로 되돌린다(예산이 우선).
  const filterDensity = requestedFilterDensity > 1
    && Number.isSafeInteger(densifiedWidth * densifiedHeight)
    && densifiedWidth * densifiedHeight <= IMAGE_FILTER_INTERACTIVE_MAX_PIXELS
      ? requestedFilterDensity
      : 1;
  const workerWidth = filterDensity > 1 ? densifiedWidth : workerBaseWidth;
  const workerHeight = filterDensity > 1 ? densifiedHeight : workerBaseHeight;
  const workerPixelCount = workerWidth * workerHeight;
  const workerDimensionsSafe = Number.isSafeInteger(workerWidth)
    && Number.isSafeInteger(workerHeight)
    && Number.isSafeInteger(workerPixelCount)
    && workerPixelCount <= IMAGE_FILTER_INTERACTIVE_MAX_PIXELS;
  // react-konva filters prop 타입(Konva.NodeConfig["filters"])과 맞춘다.
  const filters: NonNullable<Konva.NodeConfig["filters"]> =
    (workerDimensionsSafe ? built.filters : []) as NonNullable<Konva.NodeConfig["filters"]>;
  const filterAttrs = built.attrs;
  // 필터 패스 수 — 레인 비용 모델의 체인 길이 입력(CPU 레인은 픽셀×패스에 선형).
  const filterChainSteps = built.filters.length;
  const cachePad = built.cachePad; // 테두리(outline)가 실루엣 밖으로 자라도록 캐시에 추가할 여백(px).
  const workerRequiredForSafeExecution =
    typeof filterWorkerClient?.studioImageFilterRequiresWorker === "function"
    && filterWorkerClient.studioImageFilterRequiresWorker(el, workerWidth, workerHeight);

  const animatedFilterRequestKey = JSON.stringify([
    el.src,
    maskedFilterKey,
    el.width,
    el.height,
    requestedFilterDensity,
    cachePad,
  ]);
  const animatedFilterStatus = evaluateStudioAnimatedImageFilterCapability({
    cachePad,
    filterCapabilityRuntime: filterWorkerClient
      ? "ready"
      : filterWorkerClientSettled
        ? "unavailable"
        : "loading",
    filterCount: filterChainSteps,
    filterMask: !filterMaskRequested
      ? "none"
      : activeFilterMask
        ? "ready"
        : failedFilterMaskSrc === filterMaskWantedSrc
          ? "unavailable"
          : "loading",
    filterRequested: hasFilters,
    filterRuntime: filterModule
      ? "ready"
      : filterModuleSettled
        ? "unavailable"
        : "loading",
    height: el.height,
    isAnimatedGif,
    multiFramePlayback: !!el.frames && el.frames.length > 1,
    requestedDensity: requestedFilterDensity,
    requiresOffthreadProvider: workerRequiredForSafeExecution,
    runtimeFailure:
      animatedFilterRuntimeFailure?.requestKey === animatedFilterRequestKey
        ? animatedFilterRuntimeFailure.message
        : undefined,
    sourceReady: !!displayImg,
    width: el.width,
  });
  const animatedFilterActive = animatedFilterStatus.state === "active";
  const publishedAnimatedFilterStatus: StudioAnimatedImageFilterStatus =
    animatedFilterActive && animatedFilterPresentationKey !== animatedFilterRequestKey
      ? {
          ...animatedFilterStatus,
          message: "현재 GIF 프레임에 필터 캐시를 처음 적용하는 중입니다.",
          state: "preparing",
        }
      : animatedFilterStatus;
  const animatedFilterStatusRef = useRef(publishedAnimatedFilterStatus);
  animatedFilterStatusRef.current = publishedAnimatedFilterStatus;
  const animatedFilterStatusKey = JSON.stringify([
    animatedFilterRequestKey,
    publishedAnimatedFilterStatus.state,
    publishedAnimatedFilterStatus.reason,
    publishedAnimatedFilterStatus.density,
    publishedAnimatedFilterStatus.pixelCount,
    publishedAnimatedFilterStatus.pixelPasses,
  ]);
  useEffect(() => {
    const current = animatedFilterStatusRef.current;
    onAnimatedImageFilterStatus?.(current);
    const needsNotice = current.state === "degraded"
      || (current.state === "active" && current.reason === "density-capped");
    if (!needsNotice) {
      animatedFilterNoticeRef.current = null;
      return;
    }
    const noticeKey = `${animatedFilterRequestKey}:${current.reason}`;
    if (animatedFilterNoticeRef.current === noticeKey) return;
    animatedFilterNoticeRef.current = noticeKey;
    toast(current.message, { tone: "info", durationMs: 6_000 });
    console.error(
      `[studio] animated GIF filter ${current.state}: ${current.reason}; owner=${current.owner}`,
    );
  }, [animatedFilterRequestKey, animatedFilterStatusKey, onAnimatedImageFilterStatus]);

  // Worker 오프로드 경로 — cachePad>0(테두리 필터 활성)은 Konva의 cache({offset}) 위치 보정을
  // 정확히 복제하기 까다로워 제외하고 기존 Konva 내장 cache+filters 경로로 둔다. 애니메이션 GIF는
  // 이 static-image tournament에 들어오지 않고 아래 전용 live-frame cache owner가 담당한다.
  const workerPipelineRequested =
    workerDimensionsSafe
    && hasFilters
    && !!filterModule
    && cachePad === 0
    && !el.isAnimatedGif
    && !filterMaskActivationBlocked;
  // Planning needs both the GPU chunk AND the verdict on whether this machine can run it. Choosing
  // a lane while admission is still "unknown" would be a guess, and a wrong guess dead-ends: the
  // GPU branch returns instead of continuing to the Worker dispatch below it.
  const filterPipelinePlanningReady = workerPipelineRequested
    && gpuFilterModuleSettled
    && gpuLaneAdmission !== "unknown";
  const workerRequestKey = JSON.stringify([
    el.src,
    filterCacheKey,
    workerWidth,
    workerHeight,
    // 필터 마스크 정체성 — 마스크가 바뀌면(스트로크/반전/삭제) 결과 픽셀이 달라지므로 같은
    // 요청으로 취급하면 안 된다(fail-closed 폴백 키와 결과 상태 매칭이 함께 이 키를 쓴다).
    filterMaskWantedSrc ?? null,
  ]);
  // Once this operation enters the GPU/Worker filter boundary, failure keeps that boundary active
  // so Konva's synchronous filter cache cannot become an automatic replacement renderer.
  const filterPipelineActive = workerPipelineRequested;
  // Drag-preview surface. A masked filter is excluded on purpose: its blend reads the exact
  // full-resolution source, so approximating it would put unrequested pixels on screen.
  const proxyPreviewEligible =
    filterPipelinePlanningReady
    && !gpuFilterProgramEligible
    && !!filterWorkerClient
    && !filterMaskWantedSrc
    && workerPixelCount >= IMAGE_FILTER_PROXY_MIN_SOURCE_PIXELS;
  const proxyScale = proxyPreviewEligible
    ? Math.sqrt(IMAGE_FILTER_PROXY_MAX_PIXELS / workerPixelCount)
    : 1;
  const proxyWidth = Math.max(1, Math.round(workerWidth * proxyScale));
  const proxyHeight = Math.max(1, Math.round(workerHeight * proxyScale));
  const paddedWorkerRequiredBlocked = cachePad > 0 && workerRequiredForSafeExecution;
  const workerResultCacheLimit = el.filterPageComposite === true
    ? PAGE_COMPOSITE_FILTER_RESULT_CACHE_LIMIT
    : IMAGE_FILTER_WORKER_RESULT_CACHE_LIMIT;

  const currentWorkerFilteredCanvas =
    workerFilteredCanvas?.src === el.src
    && workerFilteredCanvas.source === displayImg
    && workerFilteredCanvas.filterKey === maskedFilterKey
    && workerFilteredCanvas.width === workerWidth
    && workerFilteredCanvas.height === workerHeight
      ? workerFilteredCanvas.canvas
      : undefined;
  const retainedWorkerFilteredCanvas =
    workerRequiredFailureKey === workerRequestKey
    && workerFilteredCanvas?.src === el.src
    && workerFilteredCanvas.source === displayImg
    && workerFilteredCanvas.width === workerWidth
    && workerFilteredCanvas.height === workerHeight
      ? workerFilteredCanvas.canvas
      : undefined;

  useEffect(() => {
    if (
      rasterEditSurfaceSnapshot
      || mountedRasterEditSurface?.src !== el.src
      || !decodedImg
    ) return;

    const leasedSurface = mountedRasterEditSurface.surface;
    // The canonical Image is decoded before the short mounted lease is released. Flipped images
    // prepare their replacement canvas first, then all source identities move in one React batch;
    // there is never a render where the node has neither the cached source nor a flip-ready source.
    const previousSource = displayImg;
    const canonicalDisplaySource = requiresBakedFlip
      ? createStudioRasterFlippedDisplaySource(decodedImg, flipped, flippedY)
      : decodedImg;
    // Canvas allocation/context recovery can fail under memory pressure. In that case the decoded
    // image is not flip-ready, so keep the fail-closed handoff lease instead of replacing a
    // correctly flipped visible source with raw canonical pixels.
    if (requiresBakedFlip && canonicalDisplaySource === decodedImg) return;

    if (previousSource) {
      const sourcePixels = workerSourcePixelsRef.current;
      if (sourcePixels?.source === previousSource) {
        workerSourcePixelsRef.current = { ...sourcePixels, source: canonicalDisplaySource };
      }
      const proxySourcePixels = proxySourcePixelsRef.current;
      if (proxySourcePixels?.source === previousSource) {
        proxySourcePixelsRef.current = { ...proxySourcePixels, source: canonicalDisplaySource };
      }
      const resultCache = workerResultCacheRef.current;
      if (resultCache?.source === previousSource) {
        // Both sources represent the same immutable PNG authority. Rebinding preserves exact
        // filtered canvases across the handoff instead of exposing raw pixels or scheduling a full
        // filter pass solely because Canvas/Image object identity changed.
        workerResultCacheRef.current = { ...resultCache, source: canonicalDisplaySource };
      }
      setWorkerFilteredCanvas((current) => (
        current?.source === previousSource && current.src === el.src
          ? { ...current, source: canonicalDisplaySource }
          : current
      ));
      setProxyFilteredCanvas((current) => (
        current?.source === previousSource && current.src === el.src
          ? { ...current, source: canonicalDisplaySource }
          : current
      ));
      setGpuFilteredCanvas((current) => (
        current?.source === previousSource && current.src === el.src
          ? { ...current, source: canonicalDisplaySource }
          : current
      ));
      // A synchronous Konva cache is rebuilt for the canonical source below. Do not let the old
      // source's readiness token acknowledge an unrelated layer draw during that rebuild.
      setKonvaFilterPresentationReady((current) => (
        current?.source === previousSource ? undefined : current
      ));
    }

    setDisplayImage(requiresBakedFlip
      ? {
          flipped,
          flippedY,
          image: canonicalDisplaySource,
          isAnimatedGif,
          loadedImage: decodedImg,
          src: el.src,
        }
      : undefined);
    setMountedRasterEditSurface((current) => (
      current?.src === el.src && current.surface === leasedSurface ? null : current
    ));
  }, [
    decodedImg,
    displayImg,
    el.src,
    flipped,
    flippedY,
    isAnimatedGif,
    mountedRasterEditSurface,
    rasterEditSurfaceSnapshot,
    requiresBakedFlip,
  ]);

  useEffect(() => {
    if (!paddedWorkerRequiredBlocked) return;
    if (!workerFailureNoticeRef.current) {
      const notice = { key: workerRequestKey };
      workerFailureNoticeRef.current = notice;
      toast(
        "대형 고급 필터와 바깥 테두리를 함께 처리할 Worker 경로가 필요해 이전 화면을 유지합니다.",
        { tone: "info", durationMs: 5_000 },
      );
      globalThis.setTimeout(() => {
        if (workerFailureNoticeRef.current === notice) {
          workerFailureNoticeRef.current = null;
        }
      }, 5_000);
    }
    console.error(
      "[studio] blocked an oversized synchronous compatibility filter while outline padding is active",
    );
  }, [paddedWorkerRequiredBlocked, workerRequestKey]);

  // Interactive Worker path: debounce slider bursts, keep one Worker session alive, and cache the
  // source RGBA snapshot. The resident session transfers one private source copy on revision
  // changes; parameter-only ticks send only projected filter fields.
  useEffect(() => {
    if (!filterPipelinePlanningReady || !displayImg) {
      filterWorkerSessionRef.current?.dispose();
      filterWorkerSessionRef.current = null;
      filterProxySessionRef.current?.dispose();
      filterProxySessionRef.current = null;
      gpuFilterPreviewFrameRef.current?.dispose();
      gpuFilterPreviewFrameRef.current = null;
      gpuFilterPresentationSurfaceRef.current?.dispose();
      gpuFilterPresentationSurfaceRef.current = null;
      proxySourcePixelsRef.current = null;
      if (proxyCanvasRef.current) releaseWorkerResultCanvas(proxyCanvasRef.current);
      proxyCanvasRef.current = null;
      setWorkerFilteredCanvas(undefined);
      setProxyFilteredCanvas(undefined);
      setGpuFilteredCanvas(undefined);
      if (!paddedWorkerRequiredBlocked && !workerPipelineRequested) {
        setWorkerRequiredFailureKey(undefined);
      }
      workerSourcePixelsRef.current = null;
      releaseWorkerResultCache(workerResultCacheRef.current);
      workerResultCacheRef.current = null;
      return;
    }
    const src = el.src;
    const source = displayImg;
    const filterKey = maskedFilterKey;
    const width = workerWidth;
    const height = workerHeight;
    const requestKey = workerRequestKey;
    // 필터 마스크 — Worker/GPU 공통 커밋에서 원본(sourcePixels)과 블렌드한다. 표시 스냅샷은
    // 반전이 이미 구워져 있으므로 마스크 샘플 쪽을 같은 방향으로 뒤집는다.
    const maskCoverage = activeFilterMask?.coverage ?? null;
    const maskTransform = maskCoverage
      ? { flipX: !!elRef.current.flipped, flipY: !!elRef.current.flippedY }
      : undefined;
    let controller: AbortController | null = null;
    let cancelled = false;
    // A request that is still posted when this effect is torn down keeps the Worker busy, so the
    // teardown below has to know whether one was actually dispatched and for how long.
    let dispatchedAt = 0;
    let dispatchSettled = false;
    // Drag detection: how long since the previous parameter change reached this effect.
    const requestAt = studioImageFilterClockMs();
    const previousRequestAt = filterRequestAtRef.current;
    const sincePreviousRequest = previousRequestAt === null
      ? Number.POSITIVE_INFINITY
      : requestAt - previousRequestAt;
    filterRequestAtRef.current = requestAt;
    const draggingParameters =
      proxyPreviewEligible
      && previousRequestAt !== null
      && sincePreviousRequest <= IMAGE_FILTER_DRAG_WINDOW_MS;
    setWorkerRequiredFailureKey((current) => current === requestKey ? current : undefined);
    // A regular image can retain several recent filter results. If the same source becomes a
    // full-page composite, enforce its stricter one-canvas budget as soon as the mode changes,
    // without waiting for another Worker result to arrive.
    trimWorkerResultCache(workerResultCacheRef.current, workerResultCacheLimit, filterKey);

    const markSelectedFilterUnavailable = (message: string, cause?: unknown): void => {
      console.error(`[studio] selected image filter engine unavailable: ${message}`, cause);
      setWorkerRequiredFailureKey(requestKey);
      if (!workerFailureNoticeRef.current) {
        const notice = { key: requestKey };
        workerFailureNoticeRef.current = notice;
        toast(
          `선택한 이미지 필터 엔진을 사용할 수 없습니다. ${message}`,
          { tone: "info", durationMs: 5_000 },
        );
        globalThis.setTimeout(() => {
          if (workerFailureNoticeRef.current === notice) workerFailureNoticeRef.current = null;
        }, 5_000);
      }
    };

    if (!gpuFilterModule) {
      markSelectedFilterUnavailable("WebGPU 필터 모듈을 불러오지 못해 이전 화면을 유지합니다.");
      return;
    }

    const filterProgram = elRef.current;
    const gpuChainEligible =
      gpuLaneAdmission === "admitted"
      && gpuFilterModule?.isStudioGpuFilterChainEligible(filterProgram) === true;
    const filterIslandInput = {
      gpuChainEligible,
      workload: { width, height, chainSteps: filterChainSteps },
    } as const;
    const filterIslandPlan = planStudioFilterIslandLanes(filterIslandInput);
    // Filter masks currently require an exact source/filtered blend. Until that blend also lives in
    // the GPU presentation shader, the masked lane stays on Worker/Konva rather than reading the GPU
    // frame back during pointer movement.
    const selectedFilterLane = filterIslandPlan.selectedLane;
    if (filterIslandPlan.status === "unavailable") {
      markSelectedFilterUnavailable("선택한 provider가 비활성화되어 이전 화면을 유지합니다.");
      return;
    }
    const useRetainedGpuPreview =
      selectedFilterLane === "gpu-chain"
      && maskCoverage === null
      && typeof gpuFilterModule.presentGpuFilterChain === "function"
      && typeof gpuFilterModule.createStudioGpuFilterPresentationSurface === "function";
    // V11 필터 planner 위임 — 섀도 관측 전용. 위 게이트가 실행 권한을 그대로 유지한 채, 같은
    // 스냅샷에 대한 HybridExecutionPlanner 의 결정을 나란히 계산해 영수증(카운터)으로 비교한다.
    // 계획 계산만 있고 GPU 작업은 없다. 불완전 입력은 miss 로만 기록되며 절대 던지지 않는다.
    recordStudioFilterExecutionShadow(
      captureStudioFilterExecutionRouteSnapshot({
        islandHeadLane: selectedFilterLane,
        gpuFilterModule,
        maskActive: maskCoverage !== null,
      }),
      selectedFilterLane,
    );
    if (selectedFilterLane === "gpu-chain" && !useRetainedGpuPreview) {
      markSelectedFilterUnavailable("WebGPU presentation 계약을 충족하지 못해 이전 화면을 유지합니다.");
      return;
    }
    if (selectedFilterLane === "worker" && !filterWorkerClientSettled) {
      // The explicitly selected Worker provider is still loading. Do not run GPU/Konva while its
      // own chunk settles; this effect reruns when the load reaches a terminal state.
      return;
    }
    const selectedWorkerClient = selectedFilterLane === "worker"
      ? filterWorkerClient
      : null;
    if (selectedFilterLane === "worker" && !selectedWorkerClient) {
      markSelectedFilterUnavailable("필터 Worker 모듈을 불러오지 못해 이전 화면을 유지합니다.");
      return;
    }
    if (!useRetainedGpuPreview) {
      gpuFilterPreviewFrameRef.current?.dispose();
      gpuFilterPreviewFrameRef.current = null;
      setGpuFilteredCanvas(undefined);
    }

    const ensureSourcePixels = (): WorkerSourcePixelsState | null => {
      let sourcePixels = workerSourcePixelsRef.current;
      if (
        sourcePixels
        && sourcePixels.source === source
        && sourcePixels.width === width
        && sourcePixels.height === height
      ) {
        return sourcePixels;
      }
      try {
        // One-time source admission. Parameter-only slider ticks reuse this immutable snapshot; the
        // interactive GPU presentation path itself never calls a pixel-read API.
        const sourceCanvas = document.createElement("canvas");
        sourceCanvas.width = width;
        sourceCanvas.height = height;
        const sourceCtx = sourceCanvas.getContext("2d");
        if (!sourceCtx) return null;
        sourceCtx.drawImage(source, 0, 0, width, height);
        const captured = sourceCtx.getImageData(0, 0, width, height);
        sourcePixels = {
          data: captured.data,
          height,
          revision: ++workerSourceRevisionRef.current,
          source,
          width,
        };
        workerSourcePixelsRef.current = sourcePixels;
        return sourcePixels;
      } catch (error) {
        markSelectedFilterUnavailable("원본 픽셀을 준비하지 못해 이전 화면을 유지합니다.", error);
        return null;
      }
    };

    const gpuController = new AbortController();
    let gpuPreviewPromise: Promise<StudioGpuFilterPreviewFrame | null> | null = null;
    const runGpuPreview = (): Promise<StudioGpuFilterPreviewFrame | null> => {
      if (gpuPreviewPromise) return gpuPreviewPromise;
      if (!useRetainedGpuPreview || !gpuFilterModule) return Promise.resolve(null);
      const sourcePixels = ensureSourcePixels();
      if (!sourcePixels) return Promise.resolve(null);
      const surface = gpuFilterPresentationSurfaceRef.current
        ?? gpuFilterModule.createStudioGpuFilterPresentationSurface();
      gpuFilterPresentationSurfaceRef.current = surface;
      gpuPreviewPromise = gpuFilterModule.presentGpuFilterChain(
        { data: sourcePixels.data, width, height },
        filterProgram,
        {
          signal: gpuController.signal,
          sourceRevision: sourcePixels.revision,
          isSourceRevisionCurrent: (revision) => (
            !cancelled && workerSourcePixelsRef.current?.revision === revision
          ),
          surface,
          onFailure: (failure) => {
            markSelectedFilterUnavailable(
              `WebGPU ${failure.phase} 단계가 실패해 이전 화면을 유지합니다.`,
              failure.message,
            );
          },
        },
      ).then((frame) => {
        if (!frame || cancelled) {
          frame?.dispose();
          return null;
        }
        const previous = gpuFilterPreviewFrameRef.current;
        gpuFilterPreviewFrameRef.current = frame;
        previous?.dispose();
        setGpuFilteredCanvas({
          canvas: frame.canvas,
          filterKey,
          frame,
          height,
          revision: frame.revision,
          source,
          src,
          width,
        });
        imageRef.current?.getLayer()?.batchDraw();
        return frame;
      }).catch((error) => {
        if (!cancelled) {
          markSelectedFilterUnavailable("WebGPU 미리보기가 실패해 이전 화면을 유지합니다.", error);
        }
        return null;
      });
      return gpuPreviewPromise;
    };

    const timer = setTimeout(() => {
      let resultCache = workerResultCacheRef.current;
      if (
        !resultCache
        || resultCache.source !== source
        || resultCache.width !== width
        || resultCache.height !== height
      ) {
        releaseWorkerResultCache(resultCache);
        resultCache = { canvases: new Map(), height, source, width };
        workerResultCacheRef.current = resultCache;
      }
      const cachedCanvas = resultCache.canvases.get(filterKey);
      if (cachedCanvas) {
        resultCache.canvases.delete(filterKey);
        resultCache.canvases.set(filterKey, cachedCanvas);
        setWorkerFilteredCanvas({ canvas: cachedCanvas, filterKey, height, source, src, width });
        return;
      }

      const sourcePixels = ensureSourcePixels();
      if (!sourcePixels) return;

      // 결과 커밋 경로 — Worker/GPU 어느 쪽 결과든 같은 캐시·상태 갱신을 탄다(verbatim 추출).
      const commitFilteredPixels = (filtered: { data: Uint8ClampedArray; width: number; height: number }): boolean => {
        if (cancelled) return false;
        if (filtered.width !== width || filtered.height !== height) return false;
        // 필터 마스크 블렌드 — Worker/GPU 어느 결과든 여기 한 곳에서 out = filtered·m +
        // original·(1−m)로 섞는다. filtered.data는 이 요청 전용 버퍼(전송/GPU 산출)라 제자리
        // 변형이 안전하고, sourcePixels.data는 읽기 전용으로만 쓴다(스냅샷 캐시 보존).
        if (maskCoverage) {
          applyFilterMaskToPixels({
            target: filtered.data,
            original: sourcePixels.data,
            width,
            height,
            coverage: maskCoverage,
            transform: maskTransform,
          });
        }
        try {
          const outCanvas = document.createElement("canvas");
          outCanvas.width = filtered.width;
          outCanvas.height = filtered.height;
          const outCtx = outCanvas.getContext("2d");
          if (!outCtx) return false;
          const clamped = filtered.data instanceof Uint8ClampedArray
            ? filtered.data
            : new Uint8ClampedArray(filtered.data);
          const imageData = new ImageData(
            clamped as unknown as Uint8ClampedArray<ArrayBuffer>,
            filtered.width,
            filtered.height,
          );
          outCtx.putImageData(imageData, 0, 0);
          resultCache.canvases.set(filterKey, outCanvas);
          trimWorkerResultCache(resultCache, workerResultCacheLimit, filterKey);
          setWorkerRequiredFailureKey((current) => current === requestKey ? undefined : current);
          if (gpuFilterPreviewFrameRef.current) {
            gpuFilterPreviewFrameRef.current.dispose();
            gpuFilterPreviewFrameRef.current = null;
          }
          setGpuFilteredCanvas(undefined);
          setWorkerFilteredCanvas({ canvas: outCanvas, filterKey, height, source, src, width });
          return true;
        } catch (error) {
          markSelectedFilterUnavailable("필터 결과를 표시 표면에 확정하지 못했습니다.", error);
          return false;
        }
      };

      let workerRequestDispatched = false;
      const dispatchWorkerRequest = (): void => {
        if (workerRequestDispatched || cancelled) return;
        workerRequestDispatched = true;
        controller = new AbortController();
        dispatchedAt = studioImageFilterClockMs();
        if (!filterWorkerSessionRef.current) {
          const createSession = selectedWorkerClient?.createStudioImageFilterResidentWorkerSession;
          if (typeof createSession === "function") {
            filterWorkerSessionRef.current = createSession({ executionMode: "worker" });
          }
        }
        const request = {
          imageData: {
            data: sourcePixels.data,
            width,
            height,
          },
          el: elRef.current,
        };
        const pending = filterWorkerSessionRef.current
          ? filterWorkerSessionRef.current.run(request, {
              signal: controller.signal,
              sourceRevision: sourcePixels.revision,
            })
          : selectedWorkerClient!.runStudioImageFilterWorker({
              ...request,
              // Same-provider one-shot execution for an older/lazily mismatched Worker client.
              // It owns its transfer buffer and must not detach the cached immutable snapshot.
              imageData: {
                ...request.imageData,
                data: new Uint8ClampedArray(sourcePixels.data),
              },
            }, { executionMode: "worker", signal: controller.signal });
        pending
          .then((result) => {
            dispatchSettled = true;
            commitFilteredPixels(result.imageData);
          })
          .catch((error) => {
            dispatchSettled = true;
            if ((error as { name?: string })?.name === "AbortError") return;
            if (isStudioFilterWorkerRequiredError(error)) {
              console.error(
                "[studio] image filter Worker is required; retaining the last successful result:",
                error,
              );
              setWorkerRequiredFailureKey(requestKey);
              if (!workerFailureNoticeRef.current) {
                const notice = { key: requestKey };
                workerFailureNoticeRef.current = notice;
                toast(
                  "고급 필터 Worker를 사용할 수 없어 마지막으로 계산된 화면을 유지합니다.",
                  { tone: "info", durationMs: 5_000 },
                );
                globalThis.setTimeout(() => {
                  if (workerFailureNoticeRef.current === notice) {
                    workerFailureNoticeRef.current = null;
                  }
                }, 5_000);
              }
              return;
            }
            markSelectedFilterUnavailable("필터 Worker 실행이 실패해 이전 화면을 유지합니다.", error);
          });
      };
      // The same in-flight preview promise is consumed by the immediate presentation and this
      // settle path. This prevents the old duplicate invocation (preview compute + final compute)
      // and makes readbackFinal the only canonical GPU→CPU transition.
      if (useRetainedGpuPreview) {
        void runGpuPreview().then(async (frame) => {
          if (!frame || cancelled) {
            if (!cancelled) {
              markSelectedFilterUnavailable("WebGPU 프레임을 만들지 못해 이전 화면을 유지합니다.");
            }
            return;
          }
          const finalPixels = await frame.readbackFinal();
          if (cancelled) return;
          if (!finalPixels) {
            markSelectedFilterUnavailable("WebGPU 최종 readback이 실패해 이전 화면을 유지합니다.");
            return;
          }
          commitFilteredPixels(finalPixels);
        }).catch((error) => {
          if (!cancelled) {
            markSelectedFilterUnavailable("WebGPU 필터 실행이 실패해 이전 화면을 유지합니다.", error);
          }
        });
        return;
      }
      if (selectedFilterLane === "worker") dispatchWorkerRequest();
    }, draggingParameters ? IMAGE_FILTER_DRAG_SETTLE_MS : IMAGE_FILTER_WORKER_DEBOUNCE_MS);

    // The retained GPU surface answers the slider at presentation cadence. The settle timer above
    // consumes this exact Promise/frame, so it cannot launch a duplicate compute invocation.
    const gpuPreviewTimer = useRetainedGpuPreview
      ? setTimeout(() => { void runGpuPreview(); }, IMAGE_FILTER_PROXY_DEBOUNCE_MS)
      : null;

    // ── Drag proxy. Same filter program, a much smaller surface, its own Worker. It only ever
    // writes `proxyFilteredCanvas`, which the render below drops the instant the exact
    // full-resolution result for this key exists — so it can approximate without ever becoming
    // the pixels the artist keeps.
    let proxyController: AbortController | null = null;
    const proxyTimer = draggingParameters && selectedFilterLane === "worker"
      ? setTimeout(() => {
          if (cancelled) return;
          let proxyPixels = proxySourcePixelsRef.current;
          if (
            !proxyPixels
            || proxyPixels.source !== source
            || proxyPixels.width !== proxyWidth
            || proxyPixels.height !== proxyHeight
          ) {
            try {
              const proxyCanvas = document.createElement("canvas");
              proxyCanvas.width = proxyWidth;
              proxyCanvas.height = proxyHeight;
              const proxyCtx = proxyCanvas.getContext("2d");
              if (!proxyCtx) return;
              proxyCtx.drawImage(source, 0, 0, proxyWidth, proxyHeight);
              proxyPixels = {
                data: proxyCtx.getImageData(0, 0, proxyWidth, proxyHeight).data,
                height: proxyHeight,
                revision: ++workerSourceRevisionRef.current,
                source,
                width: proxyWidth,
              };
              proxySourcePixelsRef.current = proxyPixels;
            } catch {
              // A drag preview is optional by construction; the settle pass still runs.
              return;
            }
          }
          if (!filterProxySessionRef.current) {
            const createSession = selectedWorkerClient?.createStudioImageFilterResidentWorkerSession;
            if (typeof createSession !== "function") return;
            filterProxySessionRef.current = createSession({ executionMode: "worker" });
          }
          const proxySession = filterProxySessionRef.current;
          const proxySource = proxyPixels;
          if (!proxySession || !proxySource) return;
          proxyController = new AbortController();
          proxySession
            .run(
              {
                imageData: {
                  data: proxySource.data,
                  width: proxySource.width,
                  height: proxySource.height,
                },
                el: elRef.current,
              },
              { signal: proxyController.signal, sourceRevision: proxySource.revision },
            )
            .then((result) => {
              if (cancelled) return;
              const filtered = result.imageData;
              if (filtered.width !== proxySource.width || filtered.height !== proxySource.height) {
                return;
              }
              const outCanvas = document.createElement("canvas");
              outCanvas.width = filtered.width;
              outCanvas.height = filtered.height;
              const outCtx = outCanvas.getContext("2d");
              if (!outCtx) return;
              const clamped = filtered.data instanceof Uint8ClampedArray
                ? filtered.data
                : new Uint8ClampedArray(filtered.data);
              outCtx.putImageData(
                new ImageData(
                  clamped as unknown as Uint8ClampedArray<ArrayBuffer>,
                  filtered.width,
                  filtered.height,
                ),
                0,
                0,
              );
              if (proxyCanvasRef.current) releaseWorkerResultCanvas(proxyCanvasRef.current);
              proxyCanvasRef.current = outCanvas;
              setProxyFilteredCanvas({
                canvas: outCanvas,
                filterKey,
                height: filtered.height,
                source,
                src,
                width: filtered.width,
              });
            })
            .catch(() => {
              // Preview-only lane: a failure just means this frame keeps the previous pixels.
            });
        }, IMAGE_FILTER_PROXY_DEBOUNCE_MS)
      : null;

    return () => {
      cancelled = true;
      clearTimeout(timer);
      gpuController.abort();
      if (gpuPreviewTimer !== null) clearTimeout(gpuPreviewTimer);
      if (proxyTimer !== null) clearTimeout(proxyTimer);
      if (proxyController !== null) proxyController.abort();
      if (controller !== null) controller.abort();
      // Abort only rejects the promise — an already-posted request keeps the Worker busy until it
      // finishes, which is what made every dragged value queue behind the last one. Past the
      // teardown age the session is closed so the next pass starts on a free Worker.
      if (
        dispatchedAt > 0
        && !dispatchSettled
        && studioImageFilterClockMs() - dispatchedAt >= IMAGE_FILTER_STALE_REQUEST_TEARDOWN_MS
      ) {
        filterWorkerSessionRef.current?.dispose();
        filterWorkerSessionRef.current = null;
      }
    };
  }, [
    filterPipelinePlanningReady,
    workerPipelineRequested,
    displayImg,
    maskedFilterKey,
    activeFilterMask,
    filterWorkerClient,
    filterWorkerClientSettled,
    gpuFilterModule,
    gpuLaneAdmission,
    el.src,
    workerWidth,
    workerHeight,
    proxyPreviewEligible,
    proxyWidth,
    proxyHeight,
    filterChainSteps,
    workerRequestKey,
    workerResultCacheLimit,
    paddedWorkerRequiredBlocked,
    liveStrokeRef,
  ]);

  // The drag proxy is the same source and the same filter key at a smaller size, so it is only
  // ever consulted when the exact result for this key is not on hand. Konva scales it into the
  // element's box; the settle pass replaces it with the exact pixels a moment later.
  const currentProxyFilteredCanvas =
    proxyFilteredCanvas?.src === el.src
    && proxyFilteredCanvas.source === displayImg
    && proxyFilteredCanvas.filterKey === maskedFilterKey
      ? proxyFilteredCanvas.canvas
      : undefined;
  const currentGpuFilteredCanvas =
    gpuFilteredCanvas?.src === el.src
    && gpuFilteredCanvas.source === displayImg
    && gpuFilteredCanvas.filterKey === maskedFilterKey
    && gpuFilteredCanvas.width === workerWidth
    && gpuFilteredCanvas.height === workerHeight
      ? gpuFilteredCanvas.canvas
      : undefined;
  const visibleComputedCanvas =
    currentWorkerFilteredCanvas
    ?? currentGpuFilteredCanvas
    ?? retainedWorkerFilteredCanvas
    ?? currentProxyFilteredCanvas;
  const showComputedCanvas = filterPipelineActive && !!visibleComputedCanvas;
  const synchronousCompatibilityBlocked =
    filterMaskActivationBlocked
    || paddedWorkerRequiredBlocked
    || workerRequiredFailureKey === workerRequestKey;

  useEffect(() => {
    const node = imageRef.current;
    if (!node) return;
    // The live GIF loop below is the sole cache owner for animated sources. Letting this static
    // effect clear its freshly rebuilt cache after layout would expose an unfiltered frame.
    if (el.isAnimatedGif) return;
    let ready: KonvaFilterPresentationReadyState | undefined;
    if (displayImg) {
      node.clearCache();
      // Worker 경로가 선택된 동안은 pending 상태에서도 동기 full-filter를 중복 실행하지 않는다.
      // 준비/실행 오류로 fail-closed 된 요청은 차단 상태를 유지한다. 이 분기는 작업 전에
      // Worker가 필요하지 않다고 판정된 동기 호환 경로에서만 기존 Konva 캐시를 사용한다.
      if (
        workerDimensionsSafe
        && hasFilters
        && filterModule
        && !el.isAnimatedGif
        && !filterPipelineActive
        && !synchronousCompatibilityBlocked
      ) {
        // 테두리가 있으면 offset만큼 캐시 캔버스를 키워 실루엣 바깥에 테두리를 그릴 자리를 만든다.
        // Animated GIF cache ownership lives in the bounded 12fps loop below; this static cache
        // effect must not freeze one decoded frame or double-own its cache.
        // cachePad === 0 이면 pixelRatio 를 명시해 Worker 스냅샷 밀도와 정확히 일치시킨다 —
        // Konva 10 은 미지정 시 기기 dpr 를 암묵 사용해 px 단위 필터가 Worker 경로와 다르게
        // 보였다(HiDPI에서 효과가 절반으로 줄어듦). 테두리(cachePad>0) 경로는 기존 동작 유지.
        node.cache(cachePad > 0 ? { offset: cachePad } : { pixelRatio: filterDensity });
        ready = { requestKey: workerRequestKey, source: displayImg };
      }
      setKonvaFilterPresentationReady((current) => (
        current?.requestKey === ready?.requestKey && current?.source === ready?.source
          ? current
          : ready
      ));
      node.getLayer()?.batchDraw();
    } else {
      setKonvaFilterPresentationReady(undefined);
    }
  }, [displayImg, el.width, el.height, maskedFilterKey, hasFilters, filterModule, cachePad, el.isAnimatedGif, filterPipelineActive, workerDimensionsSafe, filterDensity, synchronousCompatibilityBlocked, workerRequestKey]);

  // Browser-decoded GIF presentation owner. The filter-free mode is the original 12fps batchDraw
  // loop. An admitted filtered GIF additionally clears/rebuilds the Konva cache from the current
  // HTMLImageElement frame on each tick. It is deliberately outside the static GPU/Worker
  // tournament: no synthetic provider latency, shadow race, or GPU readback is recorded here.
  useLayoutEffect(() => {
    if (!el.isAnimatedGif || !displayImg) return;
    if (el.frames && el.frames.length > 1) return;
    const node = imageRef.current;
    if (!node) return;
    const source = displayImg;
    const src = el.src;
    const admittedStatus = animatedFilterStatusRef.current;
    const cacheConfig = animatedFilterActive
      ? admittedStatus.cacheConfig
      : undefined;
    if (!animatedFilterActive) {
      // A filter removal releases the filtered snapshot back to the browser-driven GIF owner.
      // A still-selected filter that is preparing/unavailable keeps the image explicitly hidden;
      // it must not turn this same operation into a raw-GIF renderer switch.
      try {
        node.clearCache();
      } catch {
        // Canvas loss has no successful filtered-cache claim to release.
      }
      setKonvaFilterPresentationReady((current) => (
        current?.source === source ? undefined : current
      ));
      setAnimatedFilterPresentationKey(undefined);
      if (hasFilters) {
        node.visible(false);
        node.getLayer()?.batchDraw();
        return;
      }
    }
    const loop = startStudioAnimatedImageFilterFrameLoop({
      cacheConfig,
      cancelFrame: (id) => globalThis.cancelAnimationFrame(id),
      filterFrames: animatedFilterActive,
      isCurrent: () => (
        imageRef.current === node
        && elRef.current.src === src
        && node.image() === source
      ),
      isPenDown: () => !!liveStrokeRef?.current,
      node,
      onFilteredFrame: () => {
        setAnimatedFilterPresentationKey((current) => (
          current === animatedFilterRequestKey ? current : animatedFilterRequestKey
        ));
        setKonvaFilterPresentationReady((current) => (
          current?.requestKey === workerRequestKey && current.source === source
            ? current
            : { requestKey: workerRequestKey, source }
        ));
      },
      onRuntimeFailure: (error) => {
        if (imageRef.current !== node || elRef.current.src !== src) return;
        // Hide synchronously before publishing React state so another layer redraw cannot expose
        // the raw browser frame between the cache failure and the unavailable render.
        node.visible(false);
        node.getLayer()?.batchDraw();
        const message = error instanceof Error
          ? `${error.name}: ${error.message}`
          : String(error);
        setAnimatedFilterRuntimeFailure({ message, requestKey: animatedFilterRequestKey });
        setAnimatedFilterPresentationKey((current) => (
          current === animatedFilterRequestKey ? undefined : current
        ));
      },
      requestFrame: (callback) => globalThis.requestAnimationFrame(callback),
    });
    return () => loop.stop();
  }, [
    animatedFilterActive,
    animatedFilterRequestKey,
    displayImg,
    el.frames,
    el.isAnimatedGif,
    el.src,
    hasFilters,
    liveStrokeRef,
    workerRequestKey,
  ]);

  const hokusaiPngHash = el.hokusaiLiveReceipt?.canonical.pngHash;
  useLayoutEffect(() => {
    if (!displayImg || !hokusaiPngHash || !onHokusaiCanonicalImageReady) return;
    const node = imageRef.current;
    const layer = node?.getLayer();
    if (!node || !layer) return;
    const receiptKey = `${el.id}:${hokusaiPngHash}`;
    if (hokusaiPresentationReceiptRef.current === receiptKey) return;
    // React-Konva has already applied `image={displayImg}` by layout-effect time. drawScene is
    // synchronous, so returning from this call is the first point at which the main surface is
    // guaranteed to contain the decoded canonical pixels (batchDraw would only schedule them).
    layer.drawScene();
    hokusaiPresentationReceiptRef.current = receiptKey;
    onHokusaiCanonicalImageReady(el.id, hokusaiPngHash);
  }, [displayImg, el.id, hokusaiPngHash, onHokusaiCanonicalImageReady]);

  const livingInkPngHash = el.livingInkReceipt?.canonicalPngSha256;
  const livingInkRouteKey = el.livingInkReceipt?.routeKey;
  useEffect(() => {
    setVerifiedLivingInkHash(verifyStudioLivingInkPngDataUrlHash(el.src, livingInkPngHash));
  }, [el.src, livingInkPngHash]);
  useLayoutEffect(() => {
    if (
      !displayImg
      || !livingInkPngHash
      || !livingInkRouteKey
      || verifiedLivingInkHash !== livingInkPngHash
      || !onLivingInkCanonicalImageReady
    ) return;
    const node = imageRef.current;
    const layer = node?.getLayer();
    if (!node || !layer) return;
    const receiptKey = `${el.id}:${livingInkPngHash}:${livingInkRouteKey}`;
    if (livingInkPresentationReceiptRef.current === receiptKey) return;
    layer.drawScene();
    livingInkPresentationReceiptRef.current = receiptKey;
    onLivingInkCanonicalImageReady(el.id, livingInkPngHash, livingInkRouteKey);
  }, [
    displayImg,
    el.id,
    livingInkPngHash,
    livingInkRouteKey,
    onLivingInkCanonicalImageReady,
    verifiedLivingInkHash,
  ]);

  // Worker/GPU-backed filters replace the raw decoded/cached source at the actual Konva image
  // prop. Keep the receipt tied to that concrete visible source: a proxy or retained GPU canvas is
  // valid for responsive drag presentation, but only the exact settled CPU canvas may close a
  // canonical raster presentation fence.
  const imageSource: CanvasImageSource | undefined = displayImg
    ? (showComputedCanvas ? visibleComputedCanvas! : displayImg)
    : undefined;
  const rasterPresentationSource = !imageSource
    ? undefined
    : filterPipelineActive
      // A proxy canvas is intentionally approximate and a retained canvas may belong to a prior
      // parameter revision. `readbackFinal()` commits the exact result into
      // currentWorkerFilteredCanvas, and only that full-resolution Worker result closes the fence.
      ? (currentWorkerFilteredCanvas === imageSource ? imageSource : undefined)
      : hasFilters
        // Konva's synchronous filter path is exact only after node.cache() completed for this
        // concrete source and filter request. A module-ready flag alone can race the passive cache
        // effect and acknowledge an old/unfiltered layer draw.
        ? (
            konvaFilterPresentationReady?.requestKey === workerRequestKey
            && konvaFilterPresentationReady.source === imageSource
              ? imageSource
              : undefined
          )
        : imageSource;

  useLayoutEffect(() => {
    if (!rasterPresentationSource || !rasterPresentationEligible) return;
    const identity = {
      elementId: el.id,
      src: el.src,
    } as const;
    const expected = expectedStudioRasterImagePresentation(identity);
    const linkedPassPresentation = el.src.startsWith("studio-opfs-cas:sha256:");
    // The verifier installs a fresh probe for each cold/warm operation, so its numeric epoch may
    // restart at 1. Dedupe by the expectation object owned by that probe, not by epoch alone.
    if (
      !linkedPassPresentation
      && (!expected || rasterImagePresentationReceiptRef.current === expected)
    ) return;
    const node = imageRef.current;
    const layer = node?.getLayer();
    if (!node || !layer) return;

    let active = true;
    const acknowledgeAfterDraw = () => {
      // React-Konva has applied this render's image prop before layout effects. A layer draw alone
      // is insufficient: an unrelated image may finish later and draw the same layer, so retain
      // the concrete CanvasImageSource identity in the receipt fence as well as element/src.
      if (
        !active
        || imageRef.current !== node
        || node.getLayer() !== layer
        || !node.isVisible()
        || node.image() !== rasterPresentationSource
        || elRef.current.id !== identity.elementId
        || elRef.current.src !== identity.src
      ) return;
      if (linkedPassPresentation) acknowledgeStudioRasterImagePresentationDraw(identity);
      const currentExpected = expectedStudioRasterImagePresentation(identity);
      const receipt = currentExpected
        ? acknowledgeStudioRasterImagePresentation(currentExpected)
        : null;
      if (receipt) {
        rasterImagePresentationReceiptRef.current = currentExpected;
      }
    };
    layer.on("draw.studioRasterPresentation", acknowledgeAfterDraw);
    // Coalesce with React-Konva's pending draw instead of forcing another synchronous full Stage
    // pass. `draw` fires only after drawScene completes, so the receipt is an actual presentation
    // fence; decode, React commit, another image, or a transient GPU preview cannot satisfy it.
    layer.batchDraw();
    return () => {
      active = false;
      layer.off("draw.studioRasterPresentation", acknowledgeAfterDraw);
    };
  }, [el.id, el.src, rasterPresentationEligible, rasterPresentationSource]);

  if (!displayImg || !imageSource) return null;

  // 계산 provider가 만든 최종 캔버스는 filters/filterAttrs를 비워 그대로 표시한다.
  // cachePad>0처럼 실행 전에 명시적으로 분리된 Konva compatibility 경계만 내장 필터 체인을
  // [원본 스냅샷, ...체인, 마스크 블렌드]로 감싼다. 선택된 GPU/Worker 실패는 이 경계로
  // 진입하지 않는다. 캐시 캔버스는 표시 반전이 구워져 있고 cachePad 만큼 패딩이 있으므로
  // 샘플 변환으로 콘텐츠 창을 되돌린다.
  const konvaCompatibilityFilters = activeFilterMask && filters.length > 0
    ? wrapKonvaFiltersWithFilterMask(
        filters as unknown as readonly FilterMaskKonvaFilterFn[],
        activeFilterMask.coverage,
        {
          flipX: !!el.flipped,
          flipY: !!el.flippedY,
          padRatioX: cachePad > 0 ? cachePad / (Math.max(1, el.width) + cachePad * 2) : 0,
          padRatioY: cachePad > 0 ? cachePad / (Math.max(1, el.height) + cachePad * 2) : 0,
        }
      ) as unknown as NonNullable<Konva.NodeConfig["filters"]>
    : filters;
  const animatedFilteredPresentationUnavailable = isAnimatedGif
    && hasFilters
    && publishedAnimatedFilterStatus.state !== "active";
  const activeFilters: Konva.NodeConfig["filters"] =
    filterPipelineActive
    || !workerDimensionsSafe
    || synchronousCompatibilityBlocked
    || animatedFilteredPresentationUnavailable
      ? undefined
      : konvaCompatibilityFilters;
  const activeFilterAttrs =
    filterPipelineActive
    || !workerDimensionsSafe
    || synchronousCompatibilityBlocked
    || animatedFilteredPresentationUnavailable
      ? {}
      : filterAttrs;

  return (
    <KImage
      studioElementId={el.id}
      studioAnimatedImageFilterOwner={
        isAnimatedGif && hasFilters ? publishedAnimatedFilterStatus.owner : undefined
      }
      studioAnimatedImageFilterStatus={
        isAnimatedGif && hasFilters ? publishedAnimatedFilterStatus.state : undefined
      }
      studioAnimatedImageFilterReason={
        isAnimatedGif && hasFilters ? publishedAnimatedFilterStatus.reason : undefined
      }
      // The canvas identity is retained across slider ticks; revision forces Konva to repaint the
      // browser-owned WebGPU surface without replacing it or copying its pixels to CPU memory.
      gpuFilterPresentationRevision={currentGpuFilteredCanvas ? gpuFilteredCanvas?.revision : undefined}
      // Large outline filters use this content/filter revision to reject stale Worker EDT
      // results before rebuilding the padded Konva cache. It is runtime-only and never persisted.
      outlineWorkerRevision={cachePad > 0 ? filterCacheKey : undefined}
      outlineWorkerMaskRevision={cachePad > 0 ? activeFilterMask?.coverage : undefined}
      ref={(n) => {
        imageRef.current = n;
        innerRef(n);
      }}
      image={imageSource}
      x={el.x}
      y={el.y}
      width={el.width}
      height={el.height}
      rotation={el.rotation}
      opacity={el.opacity ?? 1}
      visible={!animatedFilteredPresentationUnavailable}
      filters={activeFilters}
      {...activeFilterAttrs}
      shadowColor={el.shadowColor}
      shadowEnabled={!!el.shadowColor}
      shadowBlur={el.shadowBlur ?? 0}
      shadowOffsetX={el.shadowOffsetX ?? 0}
      shadowOffsetY={el.shadowOffsetY ?? 0}
      shadowOpacity={el.shadowOpacity ?? 1}
      cornerRadius={el.cornerRadius ?? 0}
      {...toKonvaSkewAttrs(el)}
      {...resizableNodeProps<Partial<ImageEl>>({
        draggable,
        dragBoundFunc,
        onSelect,
        onChange,
        onInteractionBegin,
        onInteractionEnd,
      })}
      onDragEnd={(e) => {
        // 패널 자동맞춤(studio-panel-autofit) — resizableNodeProps 의 기본 onDragEnd({x,y}만
        // 패치)를 이 이미지 한정으로 덮어쓴다. autoFitFrames 는 호출부(renderEl)가 이미 "그룹
        // 드래그 중이 아니고 자격도 있음"까지 걸러서 넘긴다 — null 이거나 빈 배열이면 시도조차
        // 하지 않고 기존과 완전히 동일하게 동작한다.
        try {
          const draggedX = e.target.x();
          const draggedY = e.target.y();
          const fit =
            autoFitFrames && autoFitFrames.length > 0
              ? computePanelAutoFitPatch(
                  { x: draggedX, y: draggedY, width: el.width, height: el.height },
                  autoFitFrames
                )
              : null;
          onChange(fit ?? { x: draggedX, y: draggedY });
        } finally {
          onInteractionEnd?.();
        }
      }}
    />
  );
}
