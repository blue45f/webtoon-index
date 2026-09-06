/**
 * VRM 텍스처 페인팅 — 순수 래스터 연산(영역 헬퍼 · 블렌드 · dab 합성).
 *
 * "페인트 op" 는 백엔드 중립 값이다: 캔버스 2D, ImageData, 향후 WebGPU 컴퓨트 어디서 실행해도
 * 같은 결과가 나오도록 좌표·커버리지·합성 수식을 여기서만 정의한다. 이 모듈은 DOM/GPU/three 를
 * 전혀 참조하지 않으므로 GPU 없이 픽셀 단위로 검증할 수 있다.
 *
 * 버퍼 규약: 타이트 패킹된 **스트레이트(비프리멀티플라이드) RGBA8**. Studio 의 LT 래스터
 * 레이어(`StudioBg3dLtRasterLayer`)와 동일한 규약이라 두 파이프라인 사이에 변환이 없다.
 */

import {
  isStudioVrmTextureSize,
  type StudioVrmTextureRect,
  type StudioVrmTextureSize,
  type StudioVrmTextureWrapMode,
} from "./studio-vrm-texture-uv";

/** W3C compositing 의 separable 블렌드 모드 중 웹툰 작업에 실제로 쓰이는 집합. */
export type StudioVrmTexturePaintBlendMode =
  | "normal"
  | "multiply"
  | "screen"
  | "overlay"
  | "erase";

/** dab 이 텍스처 경계를 넘을 때의 처리. glTF sampler의 세 모드를 축별로 그대로 보존한다. */
export type StudioVrmTexturePaintWrap = StudioVrmTextureWrapMode;

export interface StudioVrmTexturePaintOp {
  /** 연속 텍셀 좌표(픽셀). 텍셀 (i, j) 의 중심은 (i + 0.5, j + 0.5). */
  readonly x: number;
  readonly y: number;
  /** 텍셀 단위 반지름. */
  readonly radius: number;
  /** 0 = 최대 페더, 1 = 최대 선명(그래도 반텍셀 안티에일리어싱은 남는다). */
  readonly hardness: number;
  readonly color: string;
  /** dab 중심의 소스 알파(획 opacity × flow). */
  readonly opacity: number;
  readonly blend: StudioVrmTexturePaintBlendMode;
}

export interface StudioVrmTexturePaintApplyOptions {
  /** Legacy shorthand that applies the same sampler mode to both axes. */
  readonly wrap?: StudioVrmTexturePaintWrap;
  readonly wrapU?: StudioVrmTexturePaintWrap;
  readonly wrapV?: StudioVrmTexturePaintWrap;
  /**
   * Optional immutable baseline for non-destructive erase.
   *
   * A valid, non-overlapping full-size RGBA buffer makes an erase dab restore each destination
   * channel toward this baseline by the dab coverage × opacity. Missing, malformed, or aliased
   * buffers intentionally retain the legacy destination-out contract.
   */
  readonly originalPixels?: Uint8ClampedArray;
}

export interface StudioVrmRgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

export const EMPTY_STUDIO_VRM_TEXTURE_RECT: StudioVrmTextureRect = Object.freeze({
  x: 0,
  y: 0,
  width: 0,
  height: 0,
});

const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/iu;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** `#rrggbb` → 0..255 정수 3채널. 다른 표기는 전부 거부한다(무음 오작동 방지). */
export function parseStudioVrmTextureColor(value: unknown): StudioVrmRgba | null {
  if (typeof value !== "string" || !HEX_COLOR_PATTERN.test(value)) return null;
  const hex = Number.parseInt(value.slice(1), 16);
  return { r: (hex >> 16) & 0xff, g: (hex >> 8) & 0xff, b: hex & 0xff, a: 255 };
}

export function isStudioVrmTextureBuffer(
  buffer: unknown,
  size: StudioVrmTextureSize,
): buffer is Uint8ClampedArray {
  if (!isStudioVrmTextureSize(size)) return false;
  if (!(buffer instanceof Uint8ClampedArray)) return false;
  return buffer.length === size.width * size.height * 4;
}

export function createStudioVrmTextureBuffer(
  size: StudioVrmTextureSize,
): Uint8ClampedArray | null {
  if (!isStudioVrmTextureSize(size)) return null;
  return new Uint8ClampedArray(size.width * size.height * 4);
}

/* ── 영역(rect) 헬퍼 ──────────────────────────────────────────────────── */

export function isStudioVrmTextureRectEmpty(rect: StudioVrmTextureRect): boolean {
  return !(rect.width > 0) || !(rect.height > 0);
}

/** 실수 경계를 정수 텍셀 사각형으로 바깥쪽 반올림한 뒤 텍스처 범위로 자른다. */
export function clipStudioVrmTextureRect(
  rect: StudioVrmTextureRect,
  size: StudioVrmTextureSize,
): StudioVrmTextureRect {
  if (!isStudioVrmTextureSize(size)) return EMPTY_STUDIO_VRM_TEXTURE_RECT;
  if (
    !Number.isFinite(rect.x) ||
    !Number.isFinite(rect.y) ||
    !Number.isFinite(rect.width) ||
    !Number.isFinite(rect.height)
  ) {
    return EMPTY_STUDIO_VRM_TEXTURE_RECT;
  }
  const left = Math.max(0, Math.floor(rect.x));
  const top = Math.max(0, Math.floor(rect.y));
  const right = Math.min(size.width, Math.ceil(rect.x + rect.width));
  const bottom = Math.min(size.height, Math.ceil(rect.y + rect.height));
  if (right <= left || bottom <= top) return EMPTY_STUDIO_VRM_TEXTURE_RECT;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function unionStudioVrmTextureRect(
  first: StudioVrmTextureRect,
  second: StudioVrmTextureRect,
): StudioVrmTextureRect {
  if (isStudioVrmTextureRectEmpty(first)) return second;
  if (isStudioVrmTextureRectEmpty(second)) return first;
  const left = Math.min(first.x, second.x);
  const top = Math.min(first.y, second.y);
  const right = Math.max(first.x + first.width, second.x + second.width);
  const bottom = Math.max(first.y + first.height, second.y + second.height);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function expandStudioVrmTextureRect(
  rect: StudioVrmTextureRect,
  amount: number,
): StudioVrmTextureRect {
  if (isStudioVrmTextureRectEmpty(rect)) return rect;
  const grow = Math.max(0, Math.floor(amount));
  return {
    x: rect.x - grow,
    y: rect.y - grow,
    width: rect.width + grow * 2,
    height: rect.height + grow * 2,
  };
}

function isInsideTexture(rect: StudioVrmTextureRect, size: StudioVrmTextureSize): boolean {
  if (isStudioVrmTextureRectEmpty(rect)) return false;
  if (!Number.isSafeInteger(rect.x) || !Number.isSafeInteger(rect.y)) return false;
  if (!Number.isSafeInteger(rect.width) || !Number.isSafeInteger(rect.height)) return false;
  if (rect.x < 0 || rect.y < 0) return false;
  return rect.x + rect.width <= size.width && rect.y + rect.height <= size.height;
}

/**
 * 텍스처에서 rect 크기의 RGBA 사본을 뜬다(원본 불변).
 * rect 는 이미 정수·텍스처 내부여야 한다(`clipStudioVrmTextureRect` 로 먼저 정규화할 것).
 */
export function readStudioVrmTextureRegion(
  source: Uint8ClampedArray,
  size: StudioVrmTextureSize,
  rect: StudioVrmTextureRect,
): Uint8ClampedArray | null {
  if (!isStudioVrmTextureBuffer(source, size)) return null;
  if (!isInsideTexture(rect, size)) return null;
  const out = new Uint8ClampedArray(rect.width * rect.height * 4);
  for (let row = 0; row < rect.height; row += 1) {
    const sourceOffset = ((rect.y + row) * size.width + rect.x) * 4;
    out.set(source.subarray(sourceOffset, sourceOffset + rect.width * 4), row * rect.width * 4);
  }
  return out;
}

/** rect 크기의 RGBA 를 텍스처에 그대로 덮어쓴다(합성 없음). */
export function writeStudioVrmTextureRegion(
  target: Uint8ClampedArray,
  size: StudioVrmTextureSize,
  rect: StudioVrmTextureRect,
  data: Uint8ClampedArray,
): boolean {
  if (!isStudioVrmTextureBuffer(target, size)) return false;
  if (!isInsideTexture(rect, size)) return false;
  if (data.length !== rect.width * rect.height * 4) return false;
  for (let row = 0; row < rect.height; row += 1) {
    const targetOffset = ((rect.y + row) * size.width + rect.x) * 4;
    const sourceOffset = row * rect.width * 4;
    target.set(data.subarray(sourceOffset, sourceOffset + rect.width * 4), targetOffset);
  }
  return true;
}

/* ── 커버리지 · 블렌드 ────────────────────────────────────────────────── */

/**
 * dab 중심에서 거리 `distance` 인 지점의 커버리지(0..1).
 * hardness 1 이라도 반텍셀 페더를 남겨 작은 브러시에서 계단이 보이지 않게 한다.
 */
export function studioVrmDabCoverage(
  distance: number,
  radius: number,
  hardness: number,
): number {
  if (!Number.isFinite(distance) || !Number.isFinite(radius) || !(radius > 0)) return 0;
  if (distance < 0) return 0;
  const normalized = distance / radius;
  if (normalized >= 1) return 0;
  const minimumFeather = Math.min(0.5, radius * 0.5) / radius;
  const inner = Math.min(clamp01(hardness), 1 - minimumFeather);
  if (normalized <= inner) return 1;
  const t = (normalized - inner) / (1 - inner);
  return 1 - t * t * (3 - 2 * t);
}

function blendChannel(
  mode: StudioVrmTexturePaintBlendMode,
  source: number,
  destination: number,
): number {
  switch (mode) {
    case "multiply":
      return source * destination;
    case "screen":
      return source + destination - source * destination;
    case "overlay":
      return destination <= 0.5
        ? 2 * source * destination
        : 1 - 2 * (1 - source) * (1 - destination);
    default:
      return source;
  }
}

/**
 * 스트레이트 알파 합성(W3C compositing 일반식).
 * co = as(1-ad)·cs + as·ad·B(cs,cd) + (1-as)·ad·cd,  ao = as + ad(1-as)
 * erase 는 destination-out: ao = ad(1-as), 색은 대상 그대로.
 * 모든 성분은 0..1 정규화 값이다.
 */
export function blendStudioVrmTexel(
  mode: StudioVrmTexturePaintBlendMode,
  source: StudioVrmRgba,
  destination: StudioVrmRgba,
): StudioVrmRgba {
  const sourceAlpha = clamp01(source.a);
  const destinationAlpha = clamp01(destination.a);

  if (mode === "erase") {
    const alpha = destinationAlpha * (1 - sourceAlpha);
    if (alpha <= 0) return { r: 0, g: 0, b: 0, a: 0 };
    return { r: destination.r, g: destination.g, b: destination.b, a: alpha };
  }

  const outAlpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha);
  if (outAlpha <= 0) return { r: 0, g: 0, b: 0, a: 0 };

  const channel = (cs: number, cd: number): number => {
    const premultiplied =
      sourceAlpha * (1 - destinationAlpha) * cs +
      sourceAlpha * destinationAlpha * blendChannel(mode, cs, cd) +
      (1 - sourceAlpha) * destinationAlpha * cd;
    return clamp01(premultiplied / outAlpha);
  };

  return {
    r: channel(clamp01(source.r), clamp01(destination.r)),
    g: channel(clamp01(source.g), clamp01(destination.g)),
    b: channel(clamp01(source.b), clamp01(destination.b)),
    a: outAlpha,
  };
}

/* ── dab 적용 ─────────────────────────────────────────────────────────── */

interface WrapSegment {
  readonly from: number;
  readonly to: number;
}

/**
 * 언랩 인덱스 구간 [from, to] 을 텍스처 범위 안의 세그먼트로 접는다.
 * clamp 는 잘라내고, repeat/mirror 는 실제로 대응하는 destination 인덱스의 연속 구간으로 접는다.
 */
function wrapSegments(
  from: number,
  to: number,
  extent: number,
  wrap: StudioVrmTexturePaintWrap,
): WrapSegment[] {
  if (to < from) return [];
  if (wrap === "clamp") {
    const start = Math.max(0, from);
    const end = Math.min(extent - 1, to);
    return end < start ? [] : [{ from: start, to: end }];
  }
  const length = to - from + 1;
  if (length >= extent) return [{ from: 0, to: extent - 1 }];
  if (wrap === "mirror") {
    const mapped = new Set<number>();
    for (let index = from; index <= to; index += 1) {
      mapped.add(wrapTextureIndex(index, extent, wrap));
    }
    const sorted = [...mapped].sort((left, right) => left - right);
    const segments: WrapSegment[] = [];
    for (const index of sorted) {
      const previous = segments.at(-1);
      if (previous && previous.to + 1 === index) {
        segments[segments.length - 1] = { from: previous.from, to: index };
      } else {
        segments.push({ from: index, to: index });
      }
    }
    return segments;
  }
  const start = ((from % extent) + extent) % extent;
  if (start + length <= extent) return [{ from: start, to: start + length - 1 }];
  return [
    { from: start, to: extent - 1 },
    { from: 0, to: start + length - extent - 1 },
  ];
}

function wrapTextureIndex(
  index: number,
  extent: number,
  wrap: Exclude<StudioVrmTexturePaintWrap, "clamp">,
): number {
  if (wrap === "repeat") return ((index % extent) + extent) % extent;
  const period = extent * 2;
  const mirrored = ((index % period) + period) % period;
  return mirrored < extent ? mirrored : period - mirrored - 1;
}

function axisWrap(
  options: StudioVrmTexturePaintApplyOptions,
  axis: "u" | "v",
): StudioVrmTexturePaintWrap {
  return (axis === "u" ? options.wrapU : options.wrapV) ?? options.wrap ?? "clamp";
}

function textureBuffersOverlap(
  first: Uint8ClampedArray,
  second: Uint8ClampedArray,
): boolean {
  if (first.buffer !== second.buffer) return false;
  const firstEnd = first.byteOffset + first.byteLength;
  const secondEnd = second.byteOffset + second.byteLength;
  return first.byteOffset < secondEnd && second.byteOffset < firstEnd;
}

function safeOriginalPixels(
  target: Uint8ClampedArray,
  size: StudioVrmTextureSize,
  candidate: unknown,
): Uint8ClampedArray | null {
  if (!isStudioVrmTextureBuffer(candidate, size)) return null;
  return textureBuffersOverlap(target, candidate) ? null : candidate;
}

function paintOpBounds(
  op: StudioVrmTexturePaintOp,
): { readonly minX: number; readonly maxX: number; readonly minY: number; readonly maxY: number } | null {
  if (!Number.isFinite(op.x) || !Number.isFinite(op.y)) return null;
  if (!Number.isFinite(op.radius) || !(op.radius > 0)) return null;
  return {
    minX: Math.floor(op.x - op.radius - 0.5),
    maxX: Math.ceil(op.x + op.radius + 0.5),
    minY: Math.floor(op.y - op.radius - 0.5),
    maxY: Math.ceil(op.y + op.radius + 0.5),
  };
}

/**
 * dab 하나가 실제로 건드릴 수 있는 텍셀 사각형 목록. 언두 레코더에 "칠하기 전"을 알려주는
 * 용도라 실제 커버리지보다 넉넉할 수는 있어도 절대 모자라선 안 된다.
 */
export function studioVrmTexturePaintOpRects(
  op: StudioVrmTexturePaintOp,
  size: StudioVrmTextureSize,
  options: StudioVrmTexturePaintApplyOptions = {},
): readonly StudioVrmTextureRect[] {
  if (!isStudioVrmTextureSize(size)) return [];
  const bounds = paintOpBounds(op);
  if (!bounds) return [];
  const xs = wrapSegments(bounds.minX, bounds.maxX, size.width, axisWrap(options, "u"));
  const ys = wrapSegments(bounds.minY, bounds.maxY, size.height, axisWrap(options, "v"));
  const rects: StudioVrmTextureRect[] = [];
  for (const y of ys) {
    for (const x of xs) {
      rects.push({ x: x.from, y: y.from, width: x.to - x.from + 1, height: y.to - y.from + 1 });
    }
  }
  return rects;
}

/**
 * dab 하나를 버퍼에 합성한다. 반환값은 실제로 값이 바뀐 텍셀 수.
 * 대상 버퍼는 호출자 소유이며 이 함수만이 유일하게 그것을 변경한다.
 */
export function applyStudioVrmTexturePaintOp(
  target: Uint8ClampedArray,
  size: StudioVrmTextureSize,
  op: StudioVrmTexturePaintOp,
  options: StudioVrmTexturePaintApplyOptions = {},
): number {
  if (!isStudioVrmTextureBuffer(target, size)) return 0;
  const bounds = paintOpBounds(op);
  if (!bounds) return 0;
  const opacity = clamp01(op.opacity);
  if (opacity <= 0) return 0;
  const color = parseStudioVrmTextureColor(op.color);
  if (!color && op.blend !== "erase") return 0;

  const wrapU = axisWrap(options, "u");
  const wrapV = axisWrap(options, "v");
  const originalPixels =
    op.blend === "erase"
      ? safeOriginalPixels(target, size, options.originalPixels)
      : null;
  const sourceRed = (color?.r ?? 0) / 255;
  const sourceGreen = (color?.g ?? 0) / 255;
  const sourceBlue = (color?.b ?? 0) / 255;
  let touched = 0;

  for (let py = bounds.minY; py <= bounds.maxY; py += 1) {
    let ty: number;
    if (wrapV !== "clamp") {
      ty = wrapTextureIndex(py, size.height, wrapV);
    } else {
      if (py < 0 || py >= size.height) continue;
      ty = py;
    }
    const dy = py + 0.5 - op.y;
    for (let px = bounds.minX; px <= bounds.maxX; px += 1) {
      let tx: number;
      if (wrapU !== "clamp") {
        tx = wrapTextureIndex(px, size.width, wrapU);
      } else {
        if (px < 0 || px >= size.width) continue;
        tx = px;
      }
      const dx = px + 0.5 - op.x;
      const coverage = studioVrmDabCoverage(Math.hypot(dx, dy), op.radius, op.hardness);
      if (coverage <= 0) continue;
      const sourceAlpha = coverage * opacity;
      if (sourceAlpha <= 0) continue;

      const offset = (ty * size.width + tx) * 4;
      if (originalPixels) {
        target[offset] = Math.round(
          target[offset]! + (originalPixels[offset]! - target[offset]!) * sourceAlpha,
        );
        target[offset + 1] = Math.round(
          target[offset + 1]!
            + (originalPixels[offset + 1]! - target[offset + 1]!) * sourceAlpha,
        );
        target[offset + 2] = Math.round(
          target[offset + 2]!
            + (originalPixels[offset + 2]! - target[offset + 2]!) * sourceAlpha,
        );
        target[offset + 3] = Math.round(
          target[offset + 3]!
            + (originalPixels[offset + 3]! - target[offset + 3]!) * sourceAlpha,
        );
        touched += 1;
        continue;
      }
      const blended = blendStudioVrmTexel(
        op.blend,
        { r: sourceRed, g: sourceGreen, b: sourceBlue, a: sourceAlpha },
        {
          r: target[offset]! / 255,
          g: target[offset + 1]! / 255,
          b: target[offset + 2]! / 255,
          a: target[offset + 3]! / 255,
        },
      );
      target[offset] = Math.round(blended.r * 255);
      target[offset + 1] = Math.round(blended.g * 255);
      target[offset + 2] = Math.round(blended.b * 255);
      target[offset + 3] = Math.round(blended.a * 255);
      touched += 1;
    }
  }
  return touched;
}

export function applyStudioVrmTexturePaintOps(
  target: Uint8ClampedArray,
  size: StudioVrmTextureSize,
  ops: readonly StudioVrmTexturePaintOp[],
  options: StudioVrmTexturePaintApplyOptions = {},
): number {
  let touched = 0;
  for (const op of ops) {
    touched += applyStudioVrmTexturePaintOp(target, size, op, options);
  }
  return touched;
}

/** 여러 op 이 건드릴 사각형 전체의 합집합(언두 레코더 · 딜레이션 범위 계산용). */
export function studioVrmTexturePaintOpsBounds(
  ops: readonly StudioVrmTexturePaintOp[],
  size: StudioVrmTextureSize,
  options: StudioVrmTexturePaintApplyOptions = {},
): StudioVrmTextureRect {
  let bounds = EMPTY_STUDIO_VRM_TEXTURE_RECT;
  for (const op of ops) {
    for (const rect of studioVrmTexturePaintOpRects(op, size, options)) {
      bounds = unionStudioVrmTextureRect(bounds, rect);
    }
  }
  return bounds;
}
