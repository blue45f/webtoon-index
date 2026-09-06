import type { InkWash } from "../brush/studio-ink-wash";
import type { StudioGlitchFx, StudioVignetteFx } from "../filter/studio-filter-pack";
import type { StudioFilterUnionWave } from "../filter/studio-filter-union-wave";
import type { StudioLayerBorderEffectSettings } from "../layer/studio-layer-border-effect";
import type {
  StudioAdjustmentEngineId,
  StudioAdjustmentFilterOperation,
  StudioAdjustmentStack,
} from "../studio-adjustment-stack";
import type {
  StudioFieldIrisBlurOptions,
  StudioLensBlurOptions,
  StudioSelectiveGaussianBlurOptions,
  StudioTiltShiftBlurOptions,
} from "../studio-advanced-blur-filter-kernels";
import type {
  StudioClouds,
  StudioConvolution,
  StudioExposureAdjustment,
  StudioMorphology,
  StudioPixelOffset,
  StudioUnsharpMask,
} from "../studio-advanced-pixel-filters";
import type { AutoAdjust } from "../studio-auto-adjust";
import type { BlurFx } from "../studio-blur";
import type { ChannelMixer } from "../studio-channel-mixer";
import type { Clarity } from "../studio-clarity";
import type { ColorBalance } from "../studio-color-balance";
import type { ColorToAlpha } from "../studio-color-to-alpha";
import type { CurvePoint, CurveRgbChannels } from "../studio-curves";
import type { Detail } from "../studio-detail";
import type { Distort } from "../studio-distort";
import type { Glow } from "../studio-glow";
import type { GradientMap } from "../studio-gradient-map";
import type { Grain } from "../studio-grain";
import type { Halftone } from "../studio-halftone";
import type { LevelsRgbChannels } from "../studio-levels";
import type { Light } from "../studio-light";
import type { LineArtCleanupOptions } from "../studio-line-cleanup";
import type { Outline } from "../studio-outline";
import type { PhotoFilter } from "../studio-photo-filter";
import type {
  StudioDifferenceOfGaussiansOptions,
  StudioDustScratchesOptions,
  StudioTileableBlurOptions,
} from "../studio-professional-filter-kernels";
import type { SelectiveHsl } from "../studio-selective-hsl";
import type { ShadowHighlight } from "../studio-shadow-highlight";
import type { Sketch } from "../studio-sketch";
import type { Stylize } from "../studio-stylize";
import type {
  StudioEdgeAwareDenoiseOptions,
  StudioJpegArtifactReductionOptions,
  StudioScreentoneRemovalOptions,
} from "../studio-tone-artifact-filter-kernels";
import type { Vibrance } from "../studio-vibrance";

// 이미지 요소의 보정 관련 필드(StudioPage의 ImageEl 부분집합).
// type-only import와 가벼운 판정만 담아 /studio 첫 청크가 픽셀 필터 엔진을 당겨오지 않게 한다.
export type ImageFilterFields = {
  blur?: number;
  brightness?: number;
  contrast?: number;
  grayscale?: boolean;
  sepia?: boolean;
  screentone?: boolean;
  lineart?: boolean;
  /** Composite grayscale/contrast/sharpen/threshold pass for scanned or authored line art. */
  lineCleanup?: LineArtCleanupOptions;
  /** Removes periodic screentone dots while protecting authored dark ink. */
  screentoneRemoval?: StudioScreentoneRemovalOptions;
  /** Reduces JPEG block seams and ringing without flattening protected edges. */
  jpegArtifactReduction?: StudioJpegArtifactReductionOptions;
  /** Bounded edge-aware color denoise for imported and rasterized artwork. */
  edgeAwareDenoise?: StudioEdgeAwareDenoiseOptions;
  /** Aperture-shaped, alpha-preserving photographic blur. */
  lensBlur?: StudioLensBlurOptions;
  /** Radial focus field with an aperture-shaped out-of-focus region. */
  fieldIrisBlur?: StudioFieldIrisBlurOptions;
  /** Directional focus band with a feathered out-of-focus region. */
  tiltShiftBlur?: StudioTiltShiftBlurOptions;
  /** Edge-aware Gaussian blur for line-art-safe smoothing. */
  selectiveGaussianBlur?: StudioSelectiveGaussianBlurOptions;
  /** Two-scale Gaussian edge response rendered as clean black line art. */
  differenceOfGaussians?: StudioDifferenceOfGaussiansOptions;
  /** Thresholded median restoration that changes only isolated defects. */
  dustScratches?: StudioDustScratchesOptions;
  /** Wrap-boundary Gaussian blur for seamless texture and background tiles. */
  tileableBlur?: StudioTileableBlurOptions;
  chromatic?: number;
  posterize?: number;
  noise?: number;
  /** Stable seed for the scalar noise filter. */
  noiseSeed?: number;
  saturation?: number;
  hue?: number;
  temperature?: number;
  sharpen?: number;
  pixelate?: number;
  invert?: boolean;
  inkThreshold?: number;
  duotoneShadow?: string;
  duotoneHighlight?: string;
  levelsBlack?: number;
  levelsWhite?: number;
  levelsGamma?: number;
  levelsOutBlack?: number;
  levelsOutWhite?: number;
  levelsCh?: LevelsRgbChannels; // r/g/b 개별 채널 레벨(마스터는 levels* 스칼라)
  curve?: CurvePoint[];
  curveCh?: CurveRgbChannels; // r/g/b 개별 채널 곡선(마스터는 curve)
  colorBalance?: ColorBalance;
  channelMixer?: ChannelMixer;
  selectiveHsl?: SelectiveHsl;
  vibrance?: Vibrance;
  gradientMap?: GradientMap;
  photoFilter?: PhotoFilter;
  colorToAlpha?: ColorToAlpha;
  autoAdjust?: AutoAdjust;
  clarity?: Clarity;
  /** 섀도우/하이라이트 — 휘도 LUT 기반 명암 복구(studio-shadow-highlight). */
  shadowHighlight?: ShadowHighlight;
  outline?: Outline;
  /** CSP 경계 효과(fuchi) — 실루엣 EDT 거리 기반 비파괴 레이어 테두리(2026-08-20). */
  borderEffect?: StudioLayerBorderEffectSettings;
  glow?: Glow;
  halftone?: Halftone;
  /**
   * 그레인/텍스처 — chroma(색 노이즈, 2026-07-24) 포함 객체 전체가 imageFilterCacheKey에
   * JSON 직렬화되므로 Grain에 필드가 늘어도 캐시 키가 자동으로 함께 바뀐다(stale 캐시 없음).
   */
  grain?: Grain;
  /** 수묵/수채 번짐, 한지 섬유, 안료 과립을 함께 합성하는 비파괴 재질 효과. */
  inkWash?: InkWash;
  blurFx?: BlurFx;
  distort?: Distort;
  stylize?: Stylize;
  /** 글리치 — 시드 기반 row-slice 오프셋 + RGB 분리(studio-filter-pack, type-only 의존). */
  glitchFx?: StudioGlitchFx;
  /** 비네트 — smoothstep 가장자리 어둡히기(studio-filter-pack, type-only 의존). */
  vignetteFx?: StudioVignetteFx;
  /** Deterministic inverse-warp/noise/stylize union wave. */
  filterUnionWave?: StudioFilterUnionWave;
  light?: Light;
  sketch?: Sketch;
  detail?: Detail;
  /** Worker-first bounded pixel filters exposed through the non-destructive smart-filter stack. */
  exposureAdjustment?: StudioExposureAdjustment;
  unsharpMask?: StudioUnsharpMask;
  morphology?: StudioMorphology;
  pixelOffset?: StudioPixelOffset;
  convolution?: StudioConvolution;
  clouds?: StudioClouds;
  /** Persisted non-destructive program on Studio image elements. */
  smartFilters?: StudioAdjustmentStack;
  /** Normalized Worker projection; preserves exact order and duplicate engines. */
  smartFilterOperations?: readonly StudioAdjustmentFilterOperation[];
};

function isActiveNumber(value: number | undefined): boolean {
  return typeof value === "number" && Number.isFinite(value) && value !== 0;
}

function isActivePositiveNumber(value: number | undefined): boolean {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isFiniteNonDefault(value: number | undefined, defaultValue: number): boolean {
  return typeof value === "number" && Number.isFinite(value) && value !== defaultValue;
}

function isNonDefaultLevelFields(el: ImageFilterFields): boolean {
  return !!(
    isFiniteNonDefault(el.levelsBlack, 0) ||
    isFiniteNonDefault(el.levelsWhite, 255) ||
    isFiniteNonDefault(el.levelsGamma, 1) ||
    isFiniteNonDefault(el.levelsOutBlack, 0) ||
    isFiniteNonDefault(el.levelsOutWhite, 255)
  );
}

function hasObjectFilter(value: unknown): boolean {
  return value != null;
}

// 수묵 재질은 strength만 0이어도 기본 파라미터 객체가 남을 수 있다. 이 파일은 /studio 첫
// 청크에서 읽히므로 무거운 픽셀 엔진을 import하지 않고, 효과를 켜는 최소 조건만 가볍게 판별한다.
// 누락/잘못된 strength는 normalizeInkWash에서 기본 0으로 돌아가므로 캐시를 켤 이유가 없다.
function hasActiveInkWashCandidate(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const strength = (value as { strength?: unknown }).strength;
  return typeof strength === "number" && Number.isFinite(strength) && strength > 0;
}

function candidateRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function candidateFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function candidateNumberField(value: unknown, key: string, fallback = 0): number | null {
  if (!value) return null;
  const source = candidateRecord(value);
  const raw = source?.[key];
  return candidateFinite(raw) ? raw : fallback;
}

function hasActivePositiveFieldCandidate(value: unknown, key: string): boolean {
  const amount = candidateNumberField(value, key);
  return amount !== null && amount > 0;
}

function hasActiveSignedFieldCandidate(value: unknown, key: string): boolean {
  const amount = candidateNumberField(value, key);
  return amount !== null && amount !== 0;
}

function normalizedLevelCandidate(
  source: Record<string, unknown> | null,
  key: string,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  const raw = source?.[key];
  return candidateFinite(raw) ? Math.min(maximum, Math.max(minimum, raw)) : fallback;
}

function hasActiveLevelsObjectCandidate(value: unknown): boolean {
  const source = candidateRecord(value);
  let blackPoint = normalizedLevelCandidate(source, "blackPoint", 0, 254, 0);
  let whitePoint = normalizedLevelCandidate(source, "whitePoint", 1, 255, 255);
  if (whitePoint <= blackPoint) {
    blackPoint = 0;
    whitePoint = 255;
  }
  return blackPoint !== 0
    || whitePoint !== 255
    || normalizedLevelCandidate(source, "gamma", 0.1, 9.9, 1) !== 1
    || normalizedLevelCandidate(source, "outBlack", 0, 255, 0) !== 0
    || normalizedLevelCandidate(source, "outWhite", 0, 255, 255) !== 255;
}

function hasActiveLevelsChannelsCandidate(value: unknown): boolean {
  if (!value) return false;
  const source = candidateRecord(value);
  return hasActiveLevelsObjectCandidate(source?.r)
    || hasActiveLevelsObjectCandidate(source?.g)
    || hasActiveLevelsObjectCandidate(source?.b);
}

function hasActiveCurveCandidate(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  const points: Array<{ x: number; y: number }> = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const point = raw as { x?: unknown; y?: unknown };
    if (!candidateFinite(point.x) || !candidateFinite(point.y)) continue;
    points.push({
      x: Math.round(Math.min(255, Math.max(0, point.x))),
      y: Math.round(Math.min(255, Math.max(0, point.y))),
    });
  }
  if (points.length === 0) return false;
  points.sort((left, right) => left.x - right.x);
  const normalized: Array<{ x: number; y: number }> = [];
  for (const point of points) {
    const previous = normalized[normalized.length - 1];
    if (previous?.x === point.x) previous.y = point.y;
    else normalized.push(point);
  }
  if (normalized[0]!.x !== 0) normalized.unshift({ x: 0, y: normalized[0]!.y });
  const tail = normalized[normalized.length - 1]!;
  if (tail.x !== 255) normalized.push({ x: 255, y: tail.y });

  const lut = new Uint8ClampedArray(256);
  let segment = 0;
  for (let input = 0; input < 256; input += 1) {
    while (segment < normalized.length - 2 && input > normalized[segment + 1]!.x) {
      segment += 1;
    }
    const left = normalized[segment]!;
    const right = normalized[segment + 1]!;
    lut[input] = input <= left.x
      ? left.y
      : input >= right.x
        ? right.y
        : left.y + ((right.y - left.y) * (input - left.x)) / (right.x - left.x);
    if (lut[input] !== input) return true;
  }
  return false;
}

function hasActiveCurveChannelsCandidate(value: unknown): boolean {
  if (!value) return false;
  const source = candidateRecord(value);
  return hasActiveCurveCandidate(source?.r)
    || hasActiveCurveCandidate(source?.g)
    || hasActiveCurveCandidate(source?.b);
}

const COLOR_BALANCE_ZONES = ["shadows", "midtones", "highlights"] as const;

function hasActiveColorBalanceCandidate(value: unknown): boolean {
  if (!value) return false;
  const source = candidateRecord(value);
  return COLOR_BALANCE_ZONES.some((zone) => {
    const shift = source?.[zone];
    return Array.isArray(shift)
      && shift.slice(0, 3).some((channel) => candidateFinite(channel) && channel !== 0);
  });
}

const CHANNEL_MIXER_DEFAULTS = {
  red: [1, 0, 0, 0],
  green: [0, 1, 0, 0],
  blue: [0, 0, 1, 0],
} as const;

function hasActiveChannelMixerCandidate(value: unknown): boolean {
  if (!value) return false;
  const source = candidateRecord(value);
  if (source?.monochrome === true) return true;
  return (Object.keys(CHANNEL_MIXER_DEFAULTS) as Array<keyof typeof CHANNEL_MIXER_DEFAULTS>)
    .some((channel) => {
      const row = candidateRecord(source?.[channel]);
      return (["r", "g", "b", "constant"] as const).some((key, index) => {
        const raw = row?.[key];
        return candidateFinite(raw) && raw !== CHANNEL_MIXER_DEFAULTS[channel][index];
      });
    });
}

const SELECTIVE_HSL_BANDS = [
  "red", "orange", "yellow", "green", "aqua", "blue", "purple", "magenta",
] as const;

function hasActiveSelectiveHslCandidate(value: unknown): boolean {
  if (!value) return false;
  const source = candidateRecord(value);
  return SELECTIVE_HSL_BANDS.some((band) => {
    const adjustment = candidateRecord(source?.[band]);
    return [adjustment?.hue, adjustment?.sat, adjustment?.lum]
      .some((channel) => candidateFinite(channel) && channel !== 0);
  });
}

function hasActiveVibranceCandidate(value: unknown): boolean {
  return hasActiveSignedFieldCandidate(value, "vibrance")
    || hasActiveSignedFieldCandidate(value, "saturation");
}

function hasActiveShadowHighlightCandidate(value: unknown): boolean {
  return hasActivePositiveFieldCandidate(value, "shadows")
    || hasActivePositiveFieldCandidate(value, "highlights")
    || hasActiveSignedFieldCandidate(value, "midtoneContrast");
}

function hasActiveExposureCandidate(value: unknown): boolean {
  const source = candidateRecord(value);
  if (!source) return false;
  return (candidateFinite(source.exposure) && source.exposure !== 0)
    || (candidateFinite(source.gamma) && source.gamma !== 1)
    || (candidateFinite(source.offset) && source.offset !== 0);
}

function hasActiveAmountCandidate(value: unknown): boolean {
  const source = candidateRecord(value);
  return !!source && candidateFinite(source.amount) && source.amount > 0;
}

function hasActiveSignedAmountCandidate(value: unknown): boolean {
  const source = candidateRecord(value);
  return !!source && candidateFinite(source.amount) && source.amount !== 0;
}

function hasActiveIntensityCandidate(value: unknown): boolean {
  const source = candidateRecord(value);
  return !!source && candidateFinite(source.intensity) && source.intensity > 0;
}

function hasActiveClarityCandidate(value: unknown): boolean {
  const source = candidateRecord(value);
  if (!source) return false;
  return (candidateFinite(source.clarity) && source.clarity !== 0)
    || (candidateFinite(source.dehaze) && source.dehaze > 0);
}

/**
 * CSP 경계 효과 경량 판정 — normalize와 같은 결론(enabled === true && 유효 굵기 > 0)만
 * 낸다. normalize는 무효 굵기를 0(항등)으로 두므로 여기서 기본값을 채우면 안 된다.
 */
function hasActiveBorderEffectCandidate(value: unknown): boolean {
  const source = candidateRecord(value);
  if (!source || source.enabled !== true) return false;
  return candidateFinite(source.thickness) && source.thickness > 0;
}

function hasActiveOutlineCandidate(value: unknown): boolean {
  const source = candidateRecord(value);
  if (!source) return false;
  const hasWidth = (candidateFinite(source.width) && source.width > 0)
    || (candidateFinite(source.secondWidth) && source.secondWidth > 0);
  if (!hasWidth) return false;
  // normalizeOutline defaults a missing/non-finite opacity to 100 and clamps finite values to 0..100.
  return !candidateFinite(source.opacity) || source.opacity > 0;
}

const ACTIVE_AUTO_ADJUST_MODES = new Set(["contrast", "tone", "color", "whiteBalance"]);

function hasActiveAutoAdjustCandidate(value: unknown): boolean {
  const source = candidateRecord(value);
  if (!source || typeof source.mode !== "string" || !ACTIVE_AUTO_ADJUST_MODES.has(source.mode)) {
    return false;
  }
  // normalizeAutoAdjust defaults a missing/non-finite strength to 100 and clamps finite values.
  return !candidateFinite(source.strength) || source.strength > 0;
}

function hasActiveDarknessCandidate(value: unknown): boolean {
  const source = candidateRecord(value);
  return !!source && candidateFinite(source.darkness) && source.darkness > 0;
}

function hasActiveRadiusCandidate(value: unknown): boolean {
  const source = candidateRecord(value);
  return !!source && candidateFinite(source.radius) && source.radius > 0;
}

function hasActivePixelOffsetCandidate(value: unknown): boolean {
  const source = candidateRecord(value);
  if (!source) return false;
  return (candidateFinite(source.x) && source.x !== 0)
    || (candidateFinite(source.y) && source.y !== 0);
}

function hasActiveConvolutionCandidate(value: unknown): boolean {
  const source = candidateRecord(value);
  if (!source || !Array.isArray(source.kernel) || source.kernel.length !== 9) return false;
  const identity = [0, 0, 0, 0, 1, 0, 0, 0, 0];
  const kernelChanged = source.kernel.some((coefficient, index) =>
    candidateFinite(coefficient) && coefficient !== identity[index]
  );
  const divisorChanged = candidateFinite(source.divisor) && source.divisor !== 1;
  const biasChanged = candidateFinite(source.bias) && source.bias !== 0;
  return kernelChanged || divisorChanged || biasChanged;
}

function hasActiveStrengthCandidate(value: unknown): boolean {
  const source = candidateRecord(value);
  return !!source && candidateFinite(source.strength) && source.strength > 0;
}

function hasActiveJpegArtifactCandidate(value: unknown): boolean {
  const source = candidateRecord(value);
  if (!source) return false;
  return (candidateFinite(source.deblockStrength) && source.deblockStrength > 0)
    || (candidateFinite(source.deringStrength) && source.deringStrength > 0);
}

const LIGHTWEIGHT_ADJUSTMENT_ENGINES = new Set<StudioAdjustmentEngineId>([
  "curves",
  "levels",
  "brightness-contrast",
  "shadow-highlight",
  "hue-saturation",
  "color-balance",
  "channel-mixer",
  "gradient-map",
  "blur",
  "gaussian-blur",
  "motion-blur",
  "spin-blur",
  "zoom-blur",
  "sharpen",
  "smart-sharpen",
  "median-despeckle",
  "high-pass",
  "noise",
  "invert",
  "grayscale",
  "sepia",
  "pixelate",
  "posterize",
  "ink-threshold",
  "line-extraction",
  "line-cleanup",
  "screentone-removal",
  "jpeg-artifact-reduction",
  "edge-aware-denoise",
  "lens-blur",
  "field-iris-blur",
  "tilt-shift-blur",
  "selective-gaussian-blur",
  "screentone",
  "color-halftone",
  "chromatic-aberration",
  "edge-detect",
  "emboss",
  "solarize",
  "oil-paint",
  "exposure",
  "unsharp-mask",
  "morphology",
  "offset",
  "custom-convolution",
  "clouds",
  "surface-blur",
  "crystal-mosaic",
  "pencil-sketch",
  "crosshatch",
  "ordered-dither",
  "glowing-edges",
  "cutout",
  "retro-film",
  "watercolor",
  "diffuse-glow",
]);

function lightweightSmartFilterParams(value: unknown): Record<string, number | string | boolean> {
  const source = candidateRecord(value);
  if (!source) return {};
  const params: Record<string, number | string | boolean> = {};
  for (const [key, raw] of Object.entries(source)) {
    if (key.length > 48) continue;
    if (typeof raw === "number" && Number.isFinite(raw)) params[key] = raw;
    else if (typeof raw === "boolean") params[key] = raw;
    else if (typeof raw === "string" && raw.length <= 128) params[key] = raw;
  }
  return params;
}

/**
 * Lightweight mirror of the ordered-operation wire normalization. This module intentionally has
 * no runtime imports: it is evaluated before the heavyweight filter engine is intent-loaded.
 */
function lightweightSmartFilterProgram(value: unknown): readonly StudioAdjustmentFilterOperation[] {
  const source = candidateRecord(value);
  const list = Array.isArray(value)
    ? value
    : source && Array.isArray(source.entries)
      ? source.entries
      : [];
  const entries: StudioAdjustmentFilterOperation[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < list.length; index += 1) {
    const candidate = candidateRecord(list[index]);
    if (!candidate || typeof candidate.engine !== "string") continue;
    if (!LIGHTWEIGHT_ADJUSTMENT_ENGINES.has(candidate.engine as StudioAdjustmentEngineId)) continue;
    let id = typeof candidate.id === "string" && candidate.id.trim().length > 0
      ? candidate.id.trim().slice(0, 80)
      : `adj-${index + 1}`;
    if (seen.has(id)) id = `${id}-${index}`;
    seen.add(id);
    entries.push({
      id,
      engine: candidate.engine as StudioAdjustmentEngineId,
      enabled: candidate.enabled !== false,
      params: lightweightSmartFilterParams(candidate.params),
    });
  }
  return entries.filter((entry) => entry.enabled);
}

function hasActiveSmartFilterProgram(el: ImageFilterFields): boolean {
  return lightweightSmartFilterProgram(
    el.smartFilterOperations !== undefined ? el.smartFilterOperations : el.smartFilters
  ).length > 0;
}

/** 가벼운 활성 판정. true면 고급 필터 엔진을 동적 로드하고, 엔진이 최종 identity 여부를 다시 판정한다. */
export function hasActiveImageFilters(el: ImageFilterFields): boolean {
  return !!(
    isActivePositiveNumber(el.blur) ||
    isActiveNumber(el.brightness) ||
    isActiveNumber(el.contrast) ||
    el.grayscale ||
    el.sepia ||
    isNonDefaultLevelFields(el) ||
    hasActiveLevelsChannelsCandidate(el.levelsCh) ||
    hasActiveCurveCandidate(el.curve) ||
    hasActiveCurveChannelsCandidate(el.curveCh) ||
    hasActiveColorBalanceCandidate(el.colorBalance) ||
    hasActiveChannelMixerCandidate(el.channelMixer) ||
    hasActiveSelectiveHslCandidate(el.selectiveHsl) ||
    hasActiveVibranceCandidate(el.vibrance) ||
    hasObjectFilter(el.gradientMap) ||
    hasActivePositiveFieldCandidate(el.photoFilter, "density") ||
    hasActiveAutoAdjustCandidate(el.autoAdjust) ||
    hasActiveClarityCandidate(el.clarity) ||
    hasActiveShadowHighlightCandidate(el.shadowHighlight) ||
    hasActiveOutlineCandidate(el.outline) ||
    hasActiveBorderEffectCandidate(el.borderEffect) ||
    hasActiveStrengthCandidate(el.glow) ||
    hasActiveStrengthCandidate(el.halftone) ||
    hasActiveAmountCandidate(el.grain) ||
    hasActiveInkWashCandidate(el.inkWash) ||
    hasActiveStrengthCandidate(el.blurFx) ||
    hasActiveSignedAmountCandidate(el.distort) ||
    hasActiveStrengthCandidate(el.stylize) ||
    hasActiveIntensityCandidate(el.light) ||
    hasActiveStrengthCandidate(el.sketch) ||
    hasActiveAmountCandidate(el.detail) ||
    hasActiveExposureCandidate(el.exposureAdjustment) ||
    hasActiveAmountCandidate(el.unsharpMask) ||
    hasActiveRadiusCandidate(el.morphology) ||
    hasActivePixelOffsetCandidate(el.pixelOffset) ||
    hasActiveConvolutionCandidate(el.convolution) ||
    hasActiveAmountCandidate(el.clouds) ||
    hasActiveIntensityCandidate(el.glitchFx) ||
    hasActiveDarknessCandidate(el.vignetteFx) ||
    hasActiveSignedAmountCandidate(el.filterUnionWave) ||
    hasActiveSmartFilterProgram(el) ||
    hasActiveStrengthCandidate(el.colorToAlpha) ||
    isActiveNumber(el.saturation) ||
    isActiveNumber(el.hue) ||
    isActiveNumber(el.temperature) ||
    isActivePositiveNumber(el.sharpen) ||
    isActivePositiveNumber(el.pixelate) ||
    el.invert ||
    isActivePositiveNumber(el.inkThreshold) ||
    (el.duotoneShadow && el.duotoneHighlight) ||
    el.screentone ||
    el.lineart ||
    hasObjectFilter(el.lineCleanup) ||
    hasActiveStrengthCandidate(el.screentoneRemoval) ||
    hasActiveJpegArtifactCandidate(el.jpegArtifactReduction) ||
    hasActiveStrengthCandidate(el.edgeAwareDenoise) ||
    hasObjectFilter(el.lensBlur) ||
    hasObjectFilter(el.fieldIrisBlur) ||
    hasObjectFilter(el.tiltShiftBlur) ||
    hasObjectFilter(el.selectiveGaussianBlur) ||
    hasActiveStrengthCandidate(el.differenceOfGaussians) ||
    hasActiveStrengthCandidate(el.dustScratches) ||
    hasActiveStrengthCandidate(el.tileableBlur) ||
    isActivePositiveNumber(el.chromatic) ||
    isActivePositiveNumber(el.posterize) ||
    isActivePositiveNumber(el.noise)
  );
}

/**
 * buildImageFilters의 attrs/filters가 바뀌는지 비교할 때 쓰는 캐시 의존성 키
 * (StudioPage useEffect deps용) — 모든 보정 필드를 안정적 순서로 직렬화한 문자열.
 */
export function imageFilterCacheKey(el: ImageFilterFields): string {
  const smartFilterProgram = lightweightSmartFilterProgram(
    el.smartFilterOperations !== undefined ? el.smartFilterOperations : el.smartFilters
  );
  return JSON.stringify([
    el.blur ?? null,
    el.brightness ?? null,
    el.contrast ?? null,
    el.grayscale ?? null,
    el.sepia ?? null,
    el.screentone ?? null,
    el.lineart ?? null,
    el.lineCleanup ?? null,
    el.screentoneRemoval ?? null,
    el.jpegArtifactReduction ?? null,
    el.edgeAwareDenoise ?? null,
    el.lensBlur ?? null,
    el.fieldIrisBlur ?? null,
    el.tiltShiftBlur ?? null,
    el.selectiveGaussianBlur ?? null,
    el.differenceOfGaussians ?? null,
    el.dustScratches ?? null,
    el.tileableBlur ?? null,
    el.chromatic ?? null,
    el.posterize ?? null,
    el.noise ?? null,
    el.noiseSeed ?? null,
    el.saturation ?? null,
    el.hue ?? null,
    el.temperature ?? null,
    el.sharpen ?? null,
    el.pixelate ?? null,
    el.invert ?? null,
    el.inkThreshold ?? null,
    el.duotoneShadow ?? null,
    el.duotoneHighlight ?? null,
    el.levelsBlack ?? null,
    el.levelsWhite ?? null,
    el.levelsGamma ?? null,
    el.levelsOutBlack ?? null,
    el.levelsOutWhite ?? null,
    el.curve ?? null,
    el.colorBalance ?? null,
    el.channelMixer ?? null,
    el.selectiveHsl ?? null,
    el.vibrance ?? null,
    el.gradientMap ?? null,
    el.photoFilter ?? null,
    el.autoAdjust ?? null,
    el.clarity ?? null,
    el.shadowHighlight ?? null,
    el.outline ?? null,
    el.borderEffect ?? null,
    el.glow ?? null,
    el.halftone ?? null,
    el.grain ?? null,
    el.inkWash ?? null,
    el.blurFx ?? null,
    el.distort ?? null,
    el.stylize ?? null,
    el.light ?? null,
    el.sketch ?? null,
    el.detail ?? null,
    el.colorToAlpha ?? null,
    el.levelsCh ?? null,
    el.curveCh ?? null,
    el.exposureAdjustment ?? null,
    el.unsharpMask ?? null,
    el.morphology ?? null,
    el.pixelOffset ?? null,
    el.convolution ?? null,
    el.clouds ?? null,
    el.glitchFx ?? null,
    el.vignetteFx ?? null,
    el.filterUnionWave ?? null,
    smartFilterProgram,
  ]);
}
