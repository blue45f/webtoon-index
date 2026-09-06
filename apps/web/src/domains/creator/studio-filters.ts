/**
 * Studio Image Adjustment Engine
 * 포토샵급 이미지 보정 — 순수 픽셀 필터(색온도/샤픈/먹선/듀오톤), 원클릭 필터 프리셋,
 * 페이지 전체 컬러 그레이드(CSS filter + 비네트)를 한 모듈에 모았다.
 * Konva/DOM 의존 없음 — StudioPage 캔버스 로직과 단위 테스트가 공유한다.
 */

// ImageData 호환 최소 형태(테스트에서 가짜 객체 사용 가능).
export type StudioImageDataLike = { data: Uint8ClampedArray; width: number; height: number };

// Interactive page-composite previews repeatedly run neighborhood filters over the same
// dimensions. Retain a small exact-size CPU scratch working set so slider ticks do not allocate
// and collect another full-frame typed array per filter. Leases are synchronous and re-entrant:
// nested filter execution receives another entry instead of aliasing an in-use buffer.
const STUDIO_FILTER_SCRATCH_POOL_MAX_BYTES = 128 * 1024 * 1024;
const STUDIO_FILTER_SCRATCH_POOL_MAX_ENTRIES = 4;

interface StudioFilterScratchEntry {
  readonly data: Uint8ClampedArray;
  inUse: boolean;
  lastUsed: number;
}

const studioFilterScratchPool: StudioFilterScratchEntry[] = [];
let studioFilterScratchPoolBytes = 0;
let studioFilterScratchClock = 0;

function evictStudioFilterScratch(byteLength: number): void {
  while (
    studioFilterScratchPool.length >= STUDIO_FILTER_SCRATCH_POOL_MAX_ENTRIES
    || studioFilterScratchPoolBytes + byteLength > STUDIO_FILTER_SCRATCH_POOL_MAX_BYTES
  ) {
    let oldestIndex = -1;
    for (let index = 0; index < studioFilterScratchPool.length; index += 1) {
      const candidate = studioFilterScratchPool[index]!;
      if (candidate.inUse) continue;
      if (
        oldestIndex < 0
        || candidate.lastUsed < studioFilterScratchPool[oldestIndex]!.lastUsed
      ) {
        oldestIndex = index;
      }
    }
    if (oldestIndex < 0) return;
    const [evicted] = studioFilterScratchPool.splice(oldestIndex, 1);
    if (evicted) studioFilterScratchPoolBytes -= evicted.data.byteLength;
  }
}

/**
 * Borrows an exact-size Uint8ClampedArray for one synchronous filter pass.
 * Buffers larger than the bounded pool are intentionally transient.
 */
export function withStudioFilterScratchBuffer<T>(
  byteLength: number,
  run: (scratch: Uint8ClampedArray) => T,
): T {
  if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
    throw new RangeError("필터 스크래치 버퍼 크기가 올바르지 않습니다.");
  }
  let entry = studioFilterScratchPool.find(
    (candidate) => !candidate.inUse && candidate.data.byteLength === byteLength,
  );
  if (!entry && byteLength <= STUDIO_FILTER_SCRATCH_POOL_MAX_BYTES) {
    evictStudioFilterScratch(byteLength);
    if (
      studioFilterScratchPool.length < STUDIO_FILTER_SCRATCH_POOL_MAX_ENTRIES
      && studioFilterScratchPoolBytes + byteLength <= STUDIO_FILTER_SCRATCH_POOL_MAX_BYTES
    ) {
      entry = {
        data: new Uint8ClampedArray(byteLength),
        inUse: false,
        lastUsed: 0,
      };
      studioFilterScratchPool.push(entry);
      studioFilterScratchPoolBytes += byteLength;
    }
  }
  const scratch = entry?.data ?? new Uint8ClampedArray(byteLength);
  if (entry) entry.inUse = true;
  try {
    return run(scratch);
  } finally {
    if (entry) {
      entry.inUse = false;
      entry.lastUsed = ++studioFilterScratchClock;
    }
  }
}

// ---------------------------------------------------------------------------
// 색 유틸
// ---------------------------------------------------------------------------

/** #rgb / #rrggbb 헥스 파싱. 실패 시 검정 {0,0,0} 폴백. */
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  if (typeof hex === "string") {
    const m6 = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
    if (m6) {
      return { r: parseInt(m6[1]!, 16), g: parseInt(m6[2]!, 16), b: parseInt(m6[3]!, 16) };
    }
    const m3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(hex);
    if (m3) {
      // #abc → #aabbcc 와 동일하게 확장.
      return {
        r: parseInt(m3[1]! + m3[1]!, 16),
        g: parseInt(m3[2]! + m3[2]!, 16),
        b: parseInt(m3[3]! + m3[3]!, 16),
      };
    }
  }
  return { r: 0, g: 0, b: 0 };
}

// ---------------------------------------------------------------------------
// 순수 픽셀 필터(제자리 변형) — Uint8ClampedArray가 0-255 클램프/반올림을 보장한다.
// ---------------------------------------------------------------------------

/**
 * 색온도 — amount -100..100. 양수=따뜻하게(r↑ b↓), 음수=차갑게(r↓ b↑).
 * 채널당 약 0.6*amount 쉬프트. amount 0이면 no-op. 알파 보존.
 */
export function applyTemperature(img: StudioImageDataLike, amount: number): void {
  if (!Number.isFinite(amount) || amount === 0) return;
  const shift = amount * 0.6;
  const data = img.data;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = data[i]! + shift;
    data[i + 2] = data[i + 2]! - shift;
  }
}

/**
 * 샤픈 — amount 0..1. 3x3 언샤프 마스크(중앙 1+4a, 상하좌우 -a).
 * 가장자리 픽셀은 원본 유지, 알파 보존. amount 0이면 no-op.
 */
export function applySharpen(img: StudioImageDataLike, amount: number): void {
  if (!Number.isFinite(amount) || amount <= 0) return;
  const a = Math.min(1, amount);
  const { data, width, height } = img;
  if (width < 3 || height < 3) return;

  withStudioFilterScratchBuffer(data.length, (src) => {
    src.set(data);
    const center = 1 + 4 * a;
    const rowStride = width * 4;

    for (let y = 1; y < height - 1; y++) {
      let i = (y * width + 1) * 4;
      for (let x = 1; x < width - 1; x++, i += 4) {
        // r/g/b만 보정, 알파(+3)는 건드리지 않는다.
        data[i] = src[i]! * center - a * (src[i - 4]! + src[i + 4]! + src[i - rowStride]! + src[i + rowStride]!);
        data[i + 1] =
          src[i + 1]! * center - a * (src[i - 3]! + src[i + 5]! + src[i + 1 - rowStride]! + src[i + 1 + rowStride]!);
        data[i + 2] =
          src[i + 2]! * center - a * (src[i - 2]! + src[i + 6]! + src[i + 2 - rowStride]! + src[i + 2 + rowStride]!);
      }
    }
  });
}

/**
 * 먹선 잉크 — level 0..1 (0이면 no-op).
 * 휘도(0.299r+0.587g+0.114b) < level*255 → 순흑, 아니면 순백. 알파 보존.
 */
export function applyInkThreshold(img: StudioImageDataLike, level: number): void {
  if (!Number.isFinite(level) || level <= 0) return;
  const cut = Math.min(1, level) * 255;
  const data = img.data;
  for (let i = 0; i < data.length; i += 4) {
    const lum = 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!;
    const v = lum < cut ? 0 : 255;
    data[i] = v;
    data[i + 1] = v;
    data[i + 2] = v;
  }
}

/**
 * 듀오톤(그라디언트 맵) — 픽셀 휘도 t(0..1)로 shadow→highlight 색을 선형보간.
 * c = shadow + (highlight - shadow) * t. 알파 보존.
 */
export function applyDuotone(img: StudioImageDataLike, shadow: string, highlight: string): void {
  const lo = hexToRgb(shadow);
  const hi = hexToRgb(highlight);
  const dr = hi.r - lo.r;
  const dg = hi.g - lo.g;
  const db = hi.b - lo.b;
  const data = img.data;
  for (let i = 0; i < data.length; i += 4) {
    const t = (0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!) / 255;
    data[i] = lo.r + dr * t;
    data[i + 1] = lo.g + dg * t;
    data[i + 2] = lo.b + db * t;
  }
}

// ---------------------------------------------------------------------------
// Konva 등록용 레지스트리 — StudioPage가 Konva.Filters에 부착할 때 fn(imageData, node.attrs)로 호출.
// attrs는 외부 입력이므로 타입 가드 후 범위 클램프, 무효 값은 no-op.
// ---------------------------------------------------------------------------

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export const STUDIO_PIXEL_FILTERS: Record<
  string,
  (img: StudioImageDataLike, attrs: Record<string, unknown>) => void
> = {
  Temperature: (img, attrs) => {
    const amount = finiteNumber(attrs.temperature);
    if (amount === null) return;
    applyTemperature(img, Math.max(-100, Math.min(100, amount)));
  },
  Sharpen: (img, attrs) => {
    const amount = finiteNumber(attrs.sharpen);
    if (amount === null) return;
    applySharpen(img, Math.max(0, Math.min(1, amount)));
  },
  InkThreshold: (img, attrs) => {
    const level = finiteNumber(attrs.inkThreshold);
    if (level === null) return;
    applyInkThreshold(img, Math.max(0, Math.min(1, level)));
  },
  Duotone: (img, attrs) => {
    const shadow = attrs.duotoneShadow;
    const highlight = attrs.duotoneHighlight;
    if (typeof shadow !== "string" || typeof highlight !== "string") return;
    const hex = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
    if (!hex.test(shadow) || !hex.test(highlight)) return;
    applyDuotone(img, shadow, highlight);
  },
};

// ---------------------------------------------------------------------------
// 이미지 보정 범위(인스펙터 슬라이더용)
// ---------------------------------------------------------------------------

export const IMAGE_ADJUSTMENT_RANGES = {
  saturation: { min: -1, max: 1, step: 0.05 }, // Konva HSL 필터에 전달
  hue: { min: -180, max: 180, step: 5 },
  temperature: { min: -100, max: 100, step: 5 },
  sharpen: { min: 0, max: 1, step: 0.05 },
  pixelate: { min: 0, max: 40, step: 1 }, // Konva Pixelate pixelSize
  inkThreshold: { min: 0, max: 1, step: 0.02 },
} as const;

// ---------------------------------------------------------------------------
// 원클릭 필터 프리셋 — 이미지 한 장에 적용할 보정값 묶음(patch)
// ---------------------------------------------------------------------------

export type ImageFilterPatch = {
  blur?: number;
  brightness?: number;
  contrast?: number;
  grayscale?: boolean;
  sepia?: boolean;
  screentone?: boolean;
  lineart?: boolean;
  chromatic?: number;
  posterize?: number;
  noise?: number;
  saturation?: number;
  hue?: number;
  temperature?: number;
  sharpen?: number;
  pixelate?: number;
  invert?: boolean;
  inkThreshold?: number;
  duotoneShadow?: string;
  duotoneHighlight?: string;
};

/** 모든 보정 키를 명시적으로 undefined로 채운 패치 — 기존 보정 제거(원본 복귀)용. */
export function imageFilterResetPatch(): ImageFilterPatch {
  return {
    blur: undefined,
    brightness: undefined,
    contrast: undefined,
    grayscale: undefined,
    sepia: undefined,
    screentone: undefined,
    lineart: undefined,
    chromatic: undefined,
    posterize: undefined,
    noise: undefined,
    saturation: undefined,
    hue: undefined,
    temperature: undefined,
    sharpen: undefined,
    pixelate: undefined,
    invert: undefined,
    inkThreshold: undefined,
    duotoneShadow: undefined,
    duotoneHighlight: undefined,
  };
}

export type ImageFilterPreset = { id: string; label: string; tip: string; patch: ImageFilterPatch };

// 웹툰 연출 중심 원클릭 프리셋. patch 값은 IMAGE_ADJUSTMENT_RANGES와
// 기존 범위(blur 0..30, brightness -0.8..0.8, contrast -80..80, chromatic 0..12, posterize 0..8, noise 0..100) 안.
export const IMAGE_FILTER_PRESETS: ImageFilterPreset[] = [
  { id: "original", label: "원본", tip: "모든 보정을 제거하고 원본으로 되돌립니다.", patch: imageFilterResetPatch() },
  {
    id: "recall",
    label: "회상",
    tip: "세피아 톤과 부드러운 대비로 과거 회상 장면을 연출합니다.",
    patch: { sepia: true, brightness: 0.08, contrast: -12, saturation: -0.15 },
  },
  {
    id: "mono-manuscript",
    label: "흑백 원고",
    tip: "흑백 변환과 대비 강화로 출판 원고 느낌을 냅니다.",
    patch: { grayscale: true, contrast: 25, brightness: 0.05 },
  },
  {
    id: "comic-print",
    label: "만화 인쇄",
    tip: "스크린톤 망점으로 인쇄 만화 질감을 입힙니다.",
    patch: { screentone: true, contrast: 10 },
  },
  {
    id: "night",
    label: "야간",
    tip: "어둡고 차가운 톤으로 밤 장면을 만듭니다.",
    patch: { brightness: -0.25, temperature: -40, saturation: -0.3, contrast: 8 },
  },
  {
    id: "dawn",
    label: "새벽",
    tip: "푸르스름하고 옅은 빛으로 새벽 공기를 표현합니다.",
    patch: { brightness: -0.05, temperature: -25, saturation: -0.2, hue: 10 },
  },
  {
    id: "dusk",
    label: "황혼",
    tip: "따뜻한 주황빛 노을 무드를 더합니다.",
    patch: { temperature: 45, brightness: -0.05, saturation: 0.15, hue: -10 },
  },
  {
    id: "horror",
    label: "호러",
    tip: "저채도·강한 대비·노이즈로 공포 분위기를 만듭니다.",
    patch: { saturation: -0.55, contrast: 30, noise: 35, brightness: -0.15 },
  },
  {
    id: "neon-glitch",
    label: "네온 글리치",
    tip: "색수차와 고채도로 사이버펑크 글리치를 연출합니다.",
    patch: { chromatic: 6, saturation: 0.5, contrast: 15 },
  },
  {
    id: "vintage-film",
    label: "빈티지 필름",
    tip: "세피아·필름 그레인·따뜻한 색온도로 오래된 필름 질감을 냅니다.",
    patch: { sepia: true, noise: 25, temperature: 20, contrast: -10 },
  },
  {
    id: "watercolor-pastel",
    label: "수채 파스텔",
    tip: "낮은 대비와 밝은 톤으로 수채화 같은 파스텔 무드를 만듭니다.",
    patch: { contrast: -25, brightness: 0.18, saturation: -0.35 },
  },
  {
    id: "action",
    label: "강렬 액션",
    tip: "샤픈과 대비·채도 강화로 액션 컷의 임팩트를 키웁니다.",
    patch: { sharpen: 0.6, contrast: 28, saturation: 0.35 },
  },
  {
    id: "ink",
    label: "먹선 잉크",
    tip: "휘도 임계값으로 순흑/순백 먹선 잉크 효과를 만듭니다.",
    patch: { inkThreshold: 0.55 },
  },
  {
    id: "duotone-mood",
    label: "듀오톤 무드",
    tip: "어둠은 남색, 빛은 분홍으로 물들이는 투톤 그라디언트 맵.",
    patch: { duotoneShadow: "#1a1a40", duotoneHighlight: "#ff8fb3" },
  },
  {
    id: "dreamy-soft",
    label: "몽환 소프트",
    tip: "옅은 블러와 밝은 톤으로 꿈결 같은 장면을 연출합니다.",
    patch: { blur: 2, brightness: 0.12, saturation: -0.1 },
  },
];

// 페이지 전체 색보정은 /studio 첫 청크에서 쓰이고, 이미지 픽셀 필터는 보정 패널/필터 적용 때만 필요하다.
// 기존 테스트/사용처 호환을 위해 이 모듈에서도 re-export 한다.
export {
  DEFAULT_PAGE_GRADE,
  PAGE_GRADE_PRESETS,
  PAGE_GRADE_RANGES,
  drawVignette,
  isDefaultPageGrade,
  normalizePageGrade,
  pageGradeToCssFilter,
  vignetteCss,
} from "./studio-page-grade";
export type { PageGrade, PageGradePreset, VignetteCtx } from "./studio-page-grade";
