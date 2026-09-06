/** Canvas-factory orchestration for the pure Liquify engine. */
import {
  LIQUIFY_MAX_DISPLACEMENT_RADIUS_RATIO,
  normalizeStudioLiquifyMode,
  type StudioLiquifyBrushDynamics,
  type StudioLiquifyMode,
} from "./studio-liquify-contract";
import {
  runStudioLiquifyWorker,
  type StudioLiquifyExecutionMode,
} from "./studio-liquify-worker-client";
import { flipNormalizedPoint } from "./studio-magic-wand";

import type { StudioImageDataLike } from "./studio-filters";
import type {
  LiquifyDisplacementField,
  LiquifyPixelPoint,
} from "./studio-liquify";
import type {
  StudioLiquifyWorkerRunRequest,
  StudioLiquifyWorkerStrokePlan,
} from "./studio-liquify-worker-protocol";
import type { MaskCanvasLike, MaskCtx2DLike, MaskImageSource } from "./studio-selection-tools";

/**
 * studio-selection-tools.ts의 MaskCtx2DLike를 확장 — 픽셀을 읽고 쓰려면 get/putImageData가
 * 필요하다(heal-clone의 HealCloneCtx2DLike와 동일한 이유로 별도 정의 — 브러시 도구마다 이
 * 확장을 독립적으로 선언하는 게 이 세션의 선례다). StudioPage.tsx의 createPixelEditCanvas는
 * 이미 진짜 CanvasRenderingContext2D를 반환하므로 **수정 없이 그대로** 이 자리에 넘길 수 있다.
 */
export type LiquifyCtx2DLike = MaskCtx2DLike & {
  getImageData(sx: number, sy: number, sw: number, sh: number): StudioImageDataLike;
  putImageData(imageData: StudioImageDataLike, dx: number, dy: number): void;
};

/** 오프스크린 캔버스 팩토리 — DOM 의존부를 호출자(StudioPage)가 주입한다. */
export type LiquifyCanvasFactory = (
  width: number,
  height: number
) => { canvas: MaskCanvasLike & MaskImageSource; ctx: LiquifyCtx2DLike } | null;

export type LiquifyRasterRegion = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

function clampRegionCoordinate(value: number, maximum: number): number {
  if (!Number.isFinite(value)) return value < 0 ? 0 : maximum;
  return Math.max(0, Math.min(maximum, value));
}

function regionWithSamplingHalo(
  outputStartX: number,
  outputStartY: number,
  outputEndX: number,
  outputEndY: number,
  haloX: number,
  haloY: number,
  width: number,
  height: number,
): LiquifyRasterRegion {
  const maxX = width - 1;
  const maxY = height - 1;
  const startX = clampRegionCoordinate(outputStartX, maxX);
  const startY = clampRegionCoordinate(outputStartY, maxY);
  const endX = clampRegionCoordinate(outputEndX, maxX);
  const endY = clampRegionCoordinate(outputEndY, maxY);
  const x = clampRegionCoordinate(startX - haloX, maxX);
  const y = clampRegionCoordinate(startY - haloY, maxY);
  const inclusiveEndX = clampRegionCoordinate(endX + haloX, maxX);
  const inclusiveEndY = clampRegionCoordinate(endY + haloY, maxY);
  return {
    x,
    y,
    width: inclusiveEndX - x + 1,
    height: inclusiveEndY - y + 1,
  };
}

/**
 * Stroke field의 가능한 출력 영역과 backward bilinear sampling halo를 함께 잡는다. 실제 field
 * 생성은 계속 Worker가 담당한다. Stabilize/resample은 입력 점의 축별 최솟값/최댓값 바깥으로
 * 나가지 않고 pressure dynamics는 base radius를 키우지 않으므로 이 계획은 모든 mode에 보수적이다.
 */
export function planLiquifyStrokeRasterRegion(
  points: readonly LiquifyPixelPoint[],
  radiusPx: number,
  width: number,
  height: number,
): LiquifyRasterRegion {
  const full = { x: 0, y: 0, width, height };
  if (points.length === 0 || !Number.isFinite(radiusPx) || radiusPx <= 0) return full;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return full;
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  const maximumDisplacement = Math.max(
    1,
    radiusPx * LIQUIFY_MAX_DISPLACEMENT_RADIUS_RATIO,
  );
  // +1은 bilinear sample의 floor 좌표 오른쪽/아래 이웃까지 포함한다.
  const halo = Math.ceil(maximumDisplacement) + 1;
  return regionWithSamplingHalo(
    Math.floor(minX - radiusPx),
    Math.floor(minY - radiusPx),
    Math.ceil(maxX + radiusPx),
    Math.ceil(maxY + radiusPx),
    halo,
    halo,
    width,
    height,
  );
}

/** Retained reconstruct/smooth field도 field footprint와 실제 최대 변위만큼만 읽는다. */
export function planLiquifyFieldRasterRegion(
  field: LiquifyDisplacementField,
  width: number,
  height: number,
): LiquifyRasterRegion {
  const full = { x: 0, y: 0, width, height };
  const cells = field.width * field.height;
  if (
    !Number.isSafeInteger(field.originX)
    || !Number.isSafeInteger(field.originY)
    || !Number.isSafeInteger(field.width)
    || !Number.isSafeInteger(field.height)
    || field.width <= 0
    || field.height <= 0
    || !Number.isSafeInteger(cells)
    || field.dx.length < cells
    || field.dy.length < cells
  ) {
    return full;
  }
  const rawEndX = field.originX + field.width - 1;
  const rawEndY = field.originY + field.height - 1;
  if (!Number.isSafeInteger(rawEndX) || !Number.isSafeInteger(rawEndY)) return full;
  if (rawEndX < 0 || rawEndY < 0 || field.originX >= width || field.originY >= height) {
    // 유효 field지만 canvas와 만나지 않으면 기존 applied=true/no-change 계약을 1px로 재현한다.
    return { x: 0, y: 0, width: 1, height: 1 };
  }
  let maximumX = 0;
  let maximumY = 0;
  for (let index = 0; index < cells; index += 1) {
    const dx = field.dx[index]!;
    const dy = field.dy[index]!;
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) continue;
    maximumX = Math.max(maximumX, Math.abs(dx));
    maximumY = Math.max(maximumY, Math.abs(dy));
  }
  return regionWithSamplingHalo(
    field.originX,
    field.originY,
    rawEndX,
    rawEndY,
    Math.ceil(maximumX) + 1,
    Math.ceil(maximumY) + 1,
    width,
    height,
  );
}

export function liquifyRasterRegionWorkerBytes(region: LiquifyRasterRegion): number {
  return region.width * region.height * 4 * 2;
}

/**
 * Structured-cloning an ImageData-like payload through a Worker preserves its typed pixel buffer,
 * but browsers are not required to recreate the ImageData prototype. Canvas putImageData is stricter
 * than our pure pixel engines and rejects that otherwise-valid plain object, so restore the native
 * wrapper at the browser boundary while keeping non-DOM test environments supported.
 */
function restoreCanvasImageData(image: StudioImageDataLike): StudioImageDataLike {
  if (typeof globalThis.ImageData !== "function" || image instanceof globalThis.ImageData) {
    return image;
  }
  // ImageData requires an ArrayBuffer-backed view; the pure engine deliberately accepts the
  // wider ArrayBufferLike shape, so copy once at this final canvas boundary.
  const pixels = new Uint8ClampedArray(image.data.length);
  pixels.set(image.data);
  return new globalThis.ImageData(pixels, image.width, image.height);
}

function throwIfLiquifyAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  if (typeof DOMException === "function") {
    throw new DOMException("리퀴파이 계산을 취소했습니다.", "AbortError");
  }
  const error = new Error("리퀴파이 계산을 취소했습니다.");
  error.name = "AbortError";
  throw error;
}

/**
 * Applies an already-planned displacement field through the same frozen/work Worker pipeline.
 * Session-based Reconstruct/Smooth can therefore refine a retained field without inventing a
 * second raster implementation or changing the caller's one-commit Undo boundary.
 */
export async function bakeLiquifyFieldToCanvas(
  source: MaskImageSource,
  width: number,
  height: number,
  field: LiquifyDisplacementField,
  createCanvas: LiquifyCanvasFactory,
  options: {
    readonly executionMode?: StudioLiquifyExecutionMode;
    readonly signal?: AbortSignal;
  } = {}
): Promise<(MaskCanvasLike & MaskImageSource) | null> {
  throwIfLiquifyAborted(options.signal);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  return bakeLiquifyRequestToCanvas(
    source,
    w,
    h,
    { field },
    createCanvas,
    options.signal,
    options.executionMode ?? "worker",
  );
}

async function bakeLiquifyRequestToCanvas(
  source: MaskImageSource,
  width: number,
  height: number,
  operation: { readonly field: LiquifyDisplacementField } | { readonly stroke: StudioLiquifyWorkerStrokePlan },
  createCanvas: LiquifyCanvasFactory,
  signal: AbortSignal | undefined,
  executionMode: StudioLiquifyExecutionMode,
): Promise<(MaskCanvasLike & MaskImageSource) | null> {
  throwIfLiquifyAborted(signal);
  const region = "field" in operation
    ? planLiquifyFieldRasterRegion(operation.field, width, height)
    : planLiquifyStrokeRasterRegion(operation.stroke.points, operation.stroke.radiusPx, width, height);

  // 결과 canvas는 기존 문서/PNG 계약 때문에 full-size지만, pixel snapshot과 Worker 왕복은
  // sampling halo를 포함한 ROI 하나뿐이다. work는 원본이 이미 그려져 있어 ROI 밖도 자동 보존된다.
  const work = createCanvas(width, height);
  if (!work) return null;
  work.ctx.drawImage(source, 0, 0);

  const frozenData = work.ctx.getImageData(region.x, region.y, region.width, region.height);
  const workData: StudioImageDataLike = {
    data: new Uint8ClampedArray(frozenData.data),
    width: frozenData.width,
    height: frozenData.height,
  };

  const request: StudioLiquifyWorkerRunRequest = "field" in operation
    ? {
        src: frozenData,
        dst: workData,
        region: { originX: region.x, originY: region.y, canvasWidth: width, canvasHeight: height },
        field: operation.field,
      }
    : {
        src: frozenData,
        dst: workData,
        region: { originX: region.x, originY: region.y, canvasWidth: width, canvasHeight: height },
        stroke: operation.stroke,
      };
  const { applied, dst } = await runStudioLiquifyWorker(
    request,
    { executionMode, signal }
  );
  if (!applied) return null;

  work.ctx.putImageData(restoreCanvasImageData(dst), region.x, region.y);
  return work.canvas;
}

/**
 * 스트로크 전체를 원본에 구워 결과 캔버스를 만든다. 변위 필드가 null이면(스트로크가 너무 짧거나
 * 반경/강도가 0) null — 이 경우 캔버스를 아예 만들지 않는다(불필요한 DOM 작업 방지, 호출자는
 * patchEl을 생략해야 한다는 신호). radiusPx는 **디바이스(자연) px**여야 한다(호출자가 target.width
 * 기준 배율로 변환해서 넘긴다 — heal-clone의 관례와 동일).
 * points는 화면에 표시된 상태의 디바이스 px 좌표다. opts.flipX/flipY가 켜져 있으면 정규화한 뒤
 * flipNormalizedPoint로 원본(비반전) 좌표계에 되돌리고, 다시 자연 px로 스케일해 순수 코어에 넘긴다.
 *
 * 변위 필드 생성(buildLiquifyDisplacementField)과 적용(applyLiquifyDisplacement)은 대형 이미지에서
 * 모두 무거우므로 points+settings만 넘겨 Worker 안에서 연속 실행한다. 제품 기본값은 Worker이며,
 * Worker 실패 뒤 같은 요청을 direct로 다시 실행하지 않는다.
 */
function prepareLiquifyStrokePoints(
  points: readonly LiquifyPixelPoint[],
  width: number,
  height: number,
  radiusPx: number,
  strength: number,
  opts?: StudioLiquifyBrushDynamics & {
    flipX?: boolean;
    flipY?: boolean;
    mode?: StudioLiquifyMode;
    signal?: AbortSignal;
  },
): {
  readonly w: number;
  readonly h: number;
  readonly mode: StudioLiquifyMode;
  readonly sourcePoints: readonly LiquifyPixelPoint[];
  readonly stroke: StudioLiquifyWorkerStrokePlan;
} | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  throwIfLiquifyAborted(opts?.signal);

  const mode = normalizeStudioLiquifyMode(opts?.mode);
  const minimumPointCount = mode === "push" ? 2 : 1;
  if (
    points.length < minimumPointCount
    || !Number.isFinite(radiusPx)
    || radiusPx <= 0
    || !Number.isFinite(strength)
    || strength <= 0
  ) {
    return null;
  }

  const flipX = opts?.flipX ?? false;
  const flipY = opts?.flipY ?? false;
  const sourcePoints: readonly LiquifyPixelPoint[] =
    flipX || flipY
      ? points.map((point) => {
          const unflipped = flipNormalizedPoint({ x: point.x / w, y: point.y / h }, flipX, flipY);
          return {
            x: unflipped.x * w,
            y: unflipped.y * h,
            ...(point.pressure === undefined ? {} : { pressure: point.pressure }),
          };
        })
      : points;

  return {
    w,
    h,
    mode,
    sourcePoints,
    stroke: {
      points: sourcePoints,
      radiusPx,
      strength,
      options: {
        mode,
        hardness: opts?.hardness,
        minimumRadiusRatio: opts?.minimumRadiusRatio,
        pressureAffectsRadius: opts?.pressureAffectsRadius,
        pressureAffectsStrength: opts?.pressureAffectsStrength,
        stabilizer: opts?.stabilizer,
        spacingRatio: opts?.spacingRatio,
      },
    },
  };
}

export async function bakeLiquifyStrokeToCanvas(
  source: MaskImageSource,
  width: number,
  height: number,
  points: readonly LiquifyPixelPoint[],
  radiusPx: number,
  strength: number,
  createCanvas: LiquifyCanvasFactory,
  opts?: StudioLiquifyBrushDynamics & {
    flipX?: boolean;
    flipY?: boolean;
    /** 생략하면 기존과 동일한 Push 모드. */
    mode?: StudioLiquifyMode;
    /** Independent test/tooling mode selected before work. Product callers omit this for Worker. */
    executionMode?: StudioLiquifyExecutionMode;
    /** 필드 생성과 Worker 실행을 모두 취소한다. */
    signal?: AbortSignal;
  }
): Promise<(MaskCanvasLike & MaskImageSource) | null> {
  const prepared = prepareLiquifyStrokePoints(points, width, height, radiusPx, strength, opts);
  if (!prepared) return null;

  return bakeLiquifyRequestToCanvas(source, prepared.w, prepared.h, {
    stroke: prepared.stroke,
  }, createCanvas, opts?.signal, opts?.executionMode ?? "worker");
}

/**
 * Live-preview bake: full native pixel density inside the stroke dirty ROI only.
 * Avoids allocating/drawing a full-frame work canvas on every pointer sample.
 * Returns the ROI canvas plus its origin in source-pixel space for Konva placement.
 */
export async function bakeLiquifyStrokeRoiPreview(
  source: MaskImageSource,
  width: number,
  height: number,
  points: readonly LiquifyPixelPoint[],
  radiusPx: number,
  strength: number,
  createCanvas: LiquifyCanvasFactory,
  opts?: StudioLiquifyBrushDynamics & {
    flipX?: boolean;
    flipY?: boolean;
    mode?: StudioLiquifyMode;
    executionMode?: StudioLiquifyExecutionMode;
    signal?: AbortSignal;
    /** Soft cap on ROI pixels; oversized ROIs are rejected so the caller can fall back. */
    maxRoiPixels?: number;
  },
): Promise<{
  readonly canvas: MaskCanvasLike & MaskImageSource;
  readonly region: LiquifyRasterRegion;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
} | null> {
  const prepared = prepareLiquifyStrokePoints(points, width, height, radiusPx, strength, opts);
  if (!prepared) return null;
  throwIfLiquifyAborted(opts?.signal);

  const region = planLiquifyStrokeRasterRegion(
    prepared.sourcePoints,
    prepared.stroke.radiusPx,
    prepared.w,
    prepared.h,
  );
  const roiPixels = region.width * region.height;
  const maxRoiPixels = opts?.maxRoiPixels ?? 1_500_000;
  if (!Number.isSafeInteger(roiPixels) || roiPixels <= 0 || roiPixels > maxRoiPixels) {
    return null;
  }

  const work = createCanvas(region.width, region.height);
  if (!work) return null;
  // Copy only the dirty source patch into a ROI-sized work surface.
  // MaskCtx2DLike only types the 3-arg drawImage form; real 2d contexts accept the crop form.
  const ctx2d = work.ctx as LiquifyCtx2DLike & {
    drawImage(
      image: CanvasImageSource,
      sx: number,
      sy: number,
      sw: number,
      sh: number,
      dx: number,
      dy: number,
      dw: number,
      dh: number,
    ): void;
  };
  ctx2d.drawImage(
    source as CanvasImageSource,
    region.x,
    region.y,
    region.width,
    region.height,
    0,
    0,
    region.width,
    region.height,
  );

  const frozenData = work.ctx.getImageData(0, 0, region.width, region.height);
  const workData: StudioImageDataLike = {
    data: new Uint8ClampedArray(frozenData.data),
    width: frozenData.width,
    height: frozenData.height,
  };
  const request: StudioLiquifyWorkerRunRequest = {
    src: frozenData,
    dst: workData,
    region: {
      originX: region.x,
      originY: region.y,
      canvasWidth: prepared.w,
      canvasHeight: prepared.h,
    },
    stroke: prepared.stroke,
  };
  const { applied, dst } = await runStudioLiquifyWorker(request, {
    executionMode: opts?.executionMode ?? "worker",
    signal: opts?.signal,
  });
  if (!applied) return null;
  work.ctx.putImageData(restoreCanvasImageData(dst), 0, 0);
  return {
    canvas: work.canvas,
    region,
    sourceWidth: prepared.w,
    sourceHeight: prepared.h,
  };
}
