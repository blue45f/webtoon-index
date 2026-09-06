/**
 * Studio Konva Filter Registry
 * StudioPage가 모듈 최상단에서 인라인으로 정의하던 커스텀 Konva 픽셀 필터
 * (Screentone/Lineart/Chromatic/Posterize/Noise)와 studio-filters의 순수 픽셀 필터
 * (Temperature/Sharpen/InkThreshold/Duotone)를 한 곳에서 konva.Filters에 부착한다.
 * Konva 노드(`this`)에서 attrs를 읽는 래퍼 등록 + 보정 필드→{filters, attrs} 선택 로직을 묶었다.
 * 픽셀 수학과 상수는 studio-filters / 기존 StudioPage 구현 그대로(verbatim).
 */

import { Grayscale } from "konva/lib/filters/Grayscale";
import { Invert } from "konva/lib/filters/Invert";
import { Sepia } from "konva/lib/filters/Sepia";

import { inkWashKonvaFilter, normalizeInkWash, isIdentityInkWash } from "../brush/studio-ink-wash";
import {
  glitchFxKonvaFilter,
  isIdentityGlitchFx,
  isIdentityVignetteFx,
  normalizeGlitchFx,
  normalizeVignetteFx,
  vignetteFxKonvaFilter,
} from "../filter/studio-filter-pack";
import {
  isIdentityStudioFilterUnionWave,
  normalizeStudioFilterUnionWave,
  studioFilterUnionWaveKonvaFilter,
  type StudioFilterUnionWave,
} from "../filter/studio-filter-union-wave";
import {
  listEnabledStudioAdjustmentOperations,
  normalizeStudioAdjustmentFilterOperations,
  studioAdjustmentOperationToFilterFields,
} from "../studio-adjustment-stack";
import {
  fieldIrisBlurKonvaFilter,
  lensBlurKonvaFilter,
  normalizeStudioFieldIrisBlurOptions,
  normalizeStudioLensBlurOptions,
  normalizeStudioSelectiveGaussianBlurOptions,
  normalizeStudioTiltShiftBlurOptions,
  selectiveGaussianBlurKonvaFilter,
  tiltShiftBlurKonvaFilter,
  type StudioAdvancedBlurExecution,
} from "../studio-advanced-blur-filters";
import {
  cloudsKonvaFilter,
  convolutionKonvaFilter,
  exposureAdjustmentKonvaFilter,
  isIdentityStudioClouds,
  isIdentityStudioConvolution,
  isIdentityStudioExposureAdjustment,
  isIdentityStudioMorphology,
  isIdentityStudioPixelOffset,
  isIdentityStudioUnsharpMask,
  morphologyKonvaFilter,
  normalizeStudioClouds,
  normalizeStudioConvolution,
  normalizeStudioExposureAdjustment,
  normalizeStudioMorphology,
  normalizeStudioPixelOffset,
  normalizeStudioUnsharpMask,
  pixelOffsetKonvaFilter,
  unsharpMaskKonvaFilter,
} from "../studio-advanced-pixel-filters";
import { autoAdjustKonvaFilter, normalizeAutoAdjust, isIdentityAutoAdjust } from "../studio-auto-adjust";
import { blurFxKonvaFilter, normalizeBlurFx, isIdentityBlurFx } from "../studio-blur";
import { channelMixerKonvaFilter, normalizeChannelMixer, isIdentityChannelMixer, channelMixerToFlat } from "../studio-channel-mixer";
import { clarityKonvaFilter, normalizeClarity, isIdentityClarity } from "../studio-clarity";
import { colorBalanceKonvaFilter, normalizeColorBalance, isIdentityColorBalance } from "../studio-color-balance";
import { normalizeColorToAlpha, isIdentityColorToAlpha } from "../studio-color-to-alpha";
import { curveKonvaFilter, normalizeCurve, normalizeCurveChannels, isIdentityCurve, isIdentityCurveChannels, curveToFlat } from "../studio-curves";
import { detailKonvaFilter, normalizeDetail, isIdentityDetail } from "../studio-detail";
import { distortKonvaFilter, normalizeDistort, isIdentityDistort } from "../studio-distort";
import { STUDIO_PIXEL_FILTERS, type StudioImageDataLike } from "../studio-filters";
import { glowKonvaFilter, normalizeGlow, isIdentityGlow } from "../studio-glow";
import { gradientMapKonvaFilter, normalizeGradientMap, gradientMapToFlat } from "../studio-gradient-map";
import { grainKonvaFilter, normalizeGrain, isIdentityGrain } from "../studio-grain";
import { halftoneKonvaFilter, normalizeHalftone, isIdentityHalftone } from "../studio-halftone";
import { levelsKonvaFilter, normalizeLevels, normalizeLevelsChannels, isIdentityLevels, isIdentityLevelsChannels, levelsToFlat } from "../studio-levels";
import { lightKonvaFilter, normalizeLight, isIdentityLight } from "../studio-light";
import {
  lineArtCleanupKonvaFilter,
  normalizeLineArtCleanup,
} from "../studio-line-cleanup";
import { outlineKonvaFilter, normalizeOutline, isIdentityOutline, outlineCachePad } from "../studio-outline";
import { photoFilterKonvaFilter, normalizePhotoFilter, isIdentityPhotoFilter } from "../studio-photo-filter";
import {
  normalizeStudioDifferenceOfGaussiansOptions,
  normalizeStudioDustScratchesOptions,
  normalizeStudioTileableBlurOptions,
} from "../studio-professional-filter-kernels";
import {
  differenceOfGaussiansKonvaFilter,
  dustScratchesKonvaFilter,
  professionalColorToAlphaKonvaFilter,
  tileableBlurKonvaFilter,
} from "../studio-professional-filters";
import { selectiveHslKonvaFilter, normalizeSelectiveHsl, isIdentitySelectiveHsl, selectiveHslToFlat } from "../studio-selective-hsl";
import { shadowHighlightKonvaFilter, normalizeShadowHighlight, isIdentityShadowHighlight } from "../studio-shadow-highlight";
import { sketchKonvaFilter, normalizeSketch, isIdentitySketch } from "../studio-sketch";
import { stylizeKonvaFilter, normalizeStylize, isIdentityStylize } from "../studio-stylize";
import {
  normalizeStudioEdgeAwareDenoiseOptions,
  normalizeStudioJpegArtifactReductionOptions,
  normalizeStudioScreentoneRemovalOptions,
} from "../studio-tone-artifact-filter-kernels";
import {
  edgeAwareDenoiseKonvaFilter,
  isIdentityStudioEdgeAwareDenoise,
  isIdentityStudioJpegArtifactReduction,
  isIdentityStudioScreentoneRemoval,
  jpegArtifactReductionKonvaFilter,
  screentoneRemovalKonvaFilter,
} from "../studio-tone-artifact-filters";
import { vibranceKonvaFilter, normalizeVibrance, isIdentityVibrance } from "../studio-vibrance";

import {
  nativeBlur,
  nativeBrighten,
  nativeContrast,
  nativeHSL,
  nativePixelate,
} from "./studio-konva-native-filters";
import {
  hasActiveStudioLayerBorderEffect,
  layerBorderEffectKonvaFilter,
  studioLayerBorderEffectCachePad,
  studioLayerBorderEffectFilterAttrs,
} from "./studio-layer-border-effect-compositor";

import type { ImageFilterFields } from "./studio-konva-filter-fields";

export type { ImageFilterFields } from "./studio-konva-filter-fields";

// 하프톤이 항등(세기0)이 아니면 활성.
function hasActiveHalftone(el: ImageFilterFields): boolean {
  return !!el.halftone && !isIdentityHalftone(normalizeHalftone(el.halftone));
}
// 그레인이 항등(세기0)이 아니면 활성.
function hasActiveGrain(el: ImageFilterFields): boolean {
  return !!el.grain && !isIdentityGrain(normalizeGrain(el.grain));
}
// 수묵/수채 번짐 재질이 항등(세기 0)이 아니면 활성.
function hasActiveInkWash(el: ImageFilterFields): boolean {
  return !!el.inkWash && !isIdentityInkWash(normalizeInkWash(el.inkWash));
}
// 흐림 갤러리가 항등(세기0)이 아니면 활성.
function hasActiveBlurFx(el: ImageFilterFields): boolean {
  return !!el.blurFx && !isIdentityBlurFx(normalizeBlurFx(el.blurFx));
}
// 기하 왜곡이 항등(amount0)이 아니면 활성.
function hasActiveDistort(el: ImageFilterFields): boolean {
  return !!el.distort && !isIdentityDistort(normalizeDistort(el.distort));
}
// 스타일라이즈가 항등(세기0)이 아니면 활성.
function hasActiveStylize(el: ImageFilterFields): boolean {
  return !!el.stylize && !isIdentityStylize(normalizeStylize(el.stylize));
}
// 글리치가 항등(강도0)이 아니면 활성.
function hasActiveGlitchFx(el: ImageFilterFields): boolean {
  return !!el.glitchFx && !isIdentityGlitchFx(normalizeGlitchFx(el.glitchFx));
}
// 비네트가 항등(어둡기0)이 아니면 활성.
function hasActiveVignetteFx(el: ImageFilterFields): boolean {
  return !!el.vignetteFx && !isIdentityVignetteFx(normalizeVignetteFx(el.vignetteFx));
}
function activeFilterUnionWave(el: ImageFilterFields): StudioFilterUnionWave | null {
  const normalized = normalizeStudioFilterUnionWave(el.filterUnionWave);
  return isIdentityStudioFilterUnionWave(normalized) ? null : normalized;
}
function filterUnionWaveStage(
  effect: StudioFilterUnionWave,
): "geometry" | "texture" | "stylize" | "light" {
  switch (effect.kind) {
    case "wave-warp":
    case "ripple-warp":
    case "fisheye":
    case "twirl":
    case "pinch-bloat":
    case "lens-distortion":
      return "geometry";
    case "film-grain-pro":
    case "salt-pepper":
    case "rgb-noise":
    case "perlin-texture":
      return "texture";
    case "god-rays":
      return "light";
    default:
      return "stylize";
  }
}
// 조명 효과가 항등(세기0)이 아니면 활성.
function hasActiveLight(el: ImageFilterFields): boolean {
  return !!el.light && !isIdentityLight(normalizeLight(el.light));
}
// 스케치/잉크가 항등(세기0)이 아니면 활성.
function hasActiveSketch(el: ImageFilterFields): boolean {
  return !!el.sketch && !isIdentitySketch(normalizeSketch(el.sketch));
}
// 디테일/샤픈이 항등(amount0)이 아니면 활성.
function hasActiveDetail(el: ImageFilterFields): boolean {
  return !!el.detail && !isIdentityDetail(normalizeDetail(el.detail));
}
function hasActiveLineCleanup(el: ImageFilterFields): boolean {
  return el.lineCleanup != null;
}
function hasActiveScreentoneRemoval(el: ImageFilterFields): boolean {
  return !!el.screentoneRemoval
    && !isIdentityStudioScreentoneRemoval(el.screentoneRemoval);
}
function hasActiveJpegArtifactReduction(el: ImageFilterFields): boolean {
  return !!el.jpegArtifactReduction
    && !isIdentityStudioJpegArtifactReduction(el.jpegArtifactReduction);
}
function hasActiveEdgeAwareDenoise(el: ImageFilterFields): boolean {
  return !!el.edgeAwareDenoise
    && !isIdentityStudioEdgeAwareDenoise(el.edgeAwareDenoise);
}
function hasActiveLensBlur(el: ImageFilterFields): boolean {
  return el.lensBlur != null;
}
function hasActiveFieldIrisBlur(el: ImageFilterFields): boolean {
  return el.fieldIrisBlur != null;
}
function hasActiveTiltShiftBlur(el: ImageFilterFields): boolean {
  return el.tiltShiftBlur != null;
}
function hasActiveSelectiveGaussianBlur(el: ImageFilterFields): boolean {
  return el.selectiveGaussianBlur != null;
}
function hasActiveExposureAdjustment(el: ImageFilterFields): boolean {
  return !!el.exposureAdjustment && !isIdentityStudioExposureAdjustment(el.exposureAdjustment);
}
function hasActiveUnsharpMask(el: ImageFilterFields): boolean {
  return !!el.unsharpMask && !isIdentityStudioUnsharpMask(el.unsharpMask);
}
function hasActiveMorphology(el: ImageFilterFields): boolean {
  return !!el.morphology && !isIdentityStudioMorphology(el.morphology);
}
function hasActivePixelOffset(el: ImageFilterFields): boolean {
  return !!el.pixelOffset && !isIdentityStudioPixelOffset(el.pixelOffset);
}
function hasActiveConvolution(el: ImageFilterFields): boolean {
  return !!el.convolution && !isIdentityStudioConvolution(el.convolution);
}
function hasActiveClouds(el: ImageFilterFields): boolean {
  return !!el.clouds && !isIdentityStudioClouds(el.clouds);
}
function smartFilterOperationsOf(el: ImageFilterFields) {
  return el.smartFilterOperations !== undefined
    ? normalizeStudioAdjustmentFilterOperations(el.smartFilterOperations)
    : listEnabledStudioAdjustmentOperations(el.smartFilters);
}
function hasActiveSmartFilterProgram(el: ImageFilterFields): boolean {
  return smartFilterOperationsOf(el).length > 0;
}
// 색상 투명화가 항등(strength0)이 아니면 활성.
function hasActiveColorToAlpha(el: ImageFilterFields): boolean {
  return !!el.colorToAlpha && !isIdentityColorToAlpha(normalizeColorToAlpha(el.colorToAlpha));
}
function hasActiveDifferenceOfGaussians(el: ImageFilterFields): boolean {
  return !!el.differenceOfGaussians
    && normalizeStudioDifferenceOfGaussiansOptions(el.differenceOfGaussians).strength > 0;
}
function hasActiveDustScratches(el: ImageFilterFields): boolean {
  return !!el.dustScratches
    && normalizeStudioDustScratchesOptions(el.dustScratches).strength > 0;
}
function hasActiveTileableBlur(el: ImageFilterFields): boolean {
  return !!el.tileableBlur
    && normalizeStudioTileableBlurOptions(el.tileableBlur).strength > 0;
}

// 스티커 테두리가 항등(굵기0/불투명0)이 아니면 활성.
function hasActiveOutline(el: ImageFilterFields): boolean {
  return !!el.outline && !isIdentityOutline(normalizeOutline(el.outline));
}
// 글로우가 항등(세기0)이 아니면 활성.
function hasActiveGlow(el: ImageFilterFields): boolean {
  return !!el.glow && !isIdentityGlow(normalizeGlow(el.glow));
}

// 자동 보정이 항등(none/강도0)이 아니면 활성.
function hasActiveAutoAdjust(el: ImageFilterFields): boolean {
  return !!el.autoAdjust && !isIdentityAutoAdjust(normalizeAutoAdjust(el.autoAdjust));
}
// 선명도/디테일이 항등이 아니면 활성.
function hasActiveClarity(el: ImageFilterFields): boolean {
  return !!el.clarity && !isIdentityClarity(normalizeClarity(el.clarity));
}
// 섀도우/하이라이트가 항등(양·대비 0)이 아니면 활성.
function hasActiveShadowHighlight(el: ImageFilterFields): boolean {
  return !!el.shadowHighlight && !isIdentityShadowHighlight(normalizeShadowHighlight(el.shadowHighlight));
}

// 그라디언트 맵은 설정되면 항상 활성(기본 흑→백도 흑백 변환이므로).
function hasActiveGradientMap(el: ImageFilterFields): boolean {
  return !!el.gradientMap;
}
// 포토 필터는 농도 > 0이면 활성.
function hasActivePhotoFilter(el: ImageFilterFields): boolean {
  return !!el.photoFilter && !isIdentityPhotoFilter(normalizePhotoFilter(el.photoFilter));
}

// 선택 색상(HSL)이 항등이 아니면 활성.
function hasActiveSelectiveHsl(el: ImageFilterFields): boolean {
  return !!el.selectiveHsl && !isIdentitySelectiveHsl(normalizeSelectiveHsl(el.selectiveHsl));
}
// 생동감(Vibrance)이 항등이 아니면 활성.
function hasActiveVibrance(el: ImageFilterFields): boolean {
  return !!el.vibrance && !isIdentityVibrance(normalizeVibrance(el.vibrance));
}

// 톤 커브가 항등(보정 없음)이 아니면 활성 — 마스터(curve) 또는 r/g/b 채널(curveCh) 중 하나라도.
function hasActiveCurve(el: ImageFilterFields): boolean {
  if (el.curve && !isIdentityCurve(normalizeCurve(el.curve))) return true;
  return !!el.curveCh && !isIdentityCurveChannels(el.curveCh);
}
// 컬러 밸런스가 항등이 아니면 활성.
function hasActiveColorBalance(el: ImageFilterFields): boolean {
  return !!el.colorBalance && !isIdentityColorBalance(normalizeColorBalance(el.colorBalance));
}
// 채널 믹서가 항등이 아니면 활성.
function hasActiveChannelMixer(el: ImageFilterFields): boolean {
  return !!el.channelMixer && !isIdentityChannelMixer(normalizeChannelMixer(el.channelMixer));
}

// 이미지 요소의 레벨 필드 → studio-levels LevelsParams로 정규화.
function levelsParamsOf(el: ImageFilterFields) {
  return normalizeLevels({
    blackPoint: el.levelsBlack,
    whitePoint: el.levelsWhite,
    gamma: el.levelsGamma,
    outBlack: el.levelsOutBlack,
    outWhite: el.levelsOutWhite,
  });
}
// 레벨 보정이 항등(보정 없음)이 아니면 활성 — 마스터(levels*) 또는 r/g/b 채널(levelsCh) 중 하나라도.
function hasActiveLevels(el: ImageFilterFields): boolean {
  if (!isIdentityLevels(levelsParamsOf(el))) return true;
  return !!el.levelsCh && !isIdentityLevelsChannels(el.levelsCh);
}

// Konva 필터 함수가 호출될 때의 `this` — node.attrs에서 보정 파라미터를 읽는다.
type FilterThis = { attrs?: Record<string, unknown> };

// Konva 필터 함수 시그니처(in-place로 StudioImageDataLike를 변형).
type KonvaFilterFn = (imageData: StudioImageDataLike) => void;

// 최소 Konva 형태(테스트에서 가짜 객체 주입 가능). Filters는 필터 함수 맵(Konva 내장 + 커스텀 혼재).
// 값 타입은 unknown 인덱스 시그니처: 실제 Konva.Filters(값이 FilterFunction | string)도,
// 테스트 가짜 객체도 그대로 대입된다(any 회피). 등록 후 호출되는 커스텀 필터 키는
// KonvaFilterFn 으로 명시해 호출부(.call 등)가 좁혀 읽을 수 있게 한다.
export type KonvaLike = {
  Filters: {
    [key: string]: unknown;
    Temperature?: KonvaFilterFn;
  };
};

// Blur/Brighten/Contrast/HSL/Pixelate는 attrs 기반 순수 포팅(studio-konva-native-filters) —
// 실제 Konva 노드가 this일 때도 this.attrs로 동일한 값을 읽으므로 결과는 동일하다(패리티
// 테스트로 검증됨). Grayscale/Sepia/Invert는 this를 전혀 쓰지 않아 그대로 재사용한다.
const BUILT_IN_KONVA_FILTERS: Record<string, unknown> = {
  Blur: nativeBlur,
  Brighten: nativeBrighten,
  Contrast: nativeContrast,
  Grayscale,
  HSL: nativeHSL,
  Invert,
  Pixelate: nativePixelate,
  Sepia,
};

// 보정값이 "활성"인지: 유한한 숫자만 허용한다. 손상된 저장본의 NaN/Infinity가
// Worker/Konva 필터로 흘러가 픽셀을 검게 만들거나 과도한 루프를 만들면 안 된다.
function isActiveNumber(value: number | undefined): boolean {
  return typeof value === "number" && Number.isFinite(value) && value !== 0;
}

function isActivePositive(value: number | undefined): boolean {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function clampFinite(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value);
}

function deterministicNoiseUnit(seed: number, pixelIndex: number): number {
  let hash = Math.imul((Math.trunc(seed) >>> 0) ^ pixelIndex, 0x45d9f3b);
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b);
  hash ^= hash >>> 16;
  return (hash >>> 0) / 4_294_967_295;
}

/**
 * konva.Filters에 커스텀 필터(Screentone/Lineart/Chromatic/Posterize/Noise
 * + Temperature/Sharpen/InkThreshold/Duotone)를 부착. 멱등(여러 번 호출해도 안전).
 * Konva 내장 필터(Blur/Brighten/Contrast/Grayscale/Sepia/HSL/Pixelate/Invert)는
 * konva가 제공하므로 절대 덮어쓰지 않는다.
 */
export function registerStudioKonvaFilters(konva: KonvaLike): void {
  const F = konva.Filters;

  // 진짜 konva 패키지가 제공하는 레지스트리(F.Blur 등이 이미 있음)에는 이 블록이 손대지 않는다 —
  // Worker처럼 빈 레지스트리로 호출될 때만 attrs 기반 순수 포팅(nativeBlur 등)이 채워진다.
  for (const [name, filter] of Object.entries(BUILT_IN_KONVA_FILTERS)) {
    if (!F[name]) F[name] = filter;
  }

  // --- StudioPage에서 옮겨온 5개(픽셀 수학·상수 그대로) ---

  F.Screentone = function (imageData: StudioImageDataLike) {
    const data = imageData.data;
    const width = imageData.width;
    const height = imageData.height;
    const size = 6;

    for (let y = 0; y < height; y += size) {
      for (let x = 0; x < width; x += size) {
        let totalLuminance = 0;
        let count = 0;
        for (let dy = 0; dy < size && y + dy < height; dy++) {
          for (let dx = 0; dx < size && x + dx < width; dx++) {
            const idx = ((y + dy) * width + (x + dx)) * 4;
            const r = data[idx]!;
            const g = data[idx + 1]!;
            const b = data[idx + 2]!;
            const lum = 0.299 * r + 0.587 * g + 0.114 * b;
            totalLuminance += lum;
            count++;
          }
        }

        const avgLum = totalLuminance / count;
        const radius = (1 - avgLum / 255) * (size / 2) * 1.2;
        const cx = x + size / 2;
        const cy = y + size / 2;

        for (let dy = 0; dy < size && y + dy < height; dy++) {
          for (let dx = 0; dx < size && x + dx < width; dx++) {
            const px = x + dx;
            const py = y + dy;
            const idx = (py * width + px) * 4;

            const dist = Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
            if (dist < radius) {
              data[idx] = 40;
              data[idx + 1] = 40;
              data[idx + 2] = 40;
            } else {
              data[idx] = 255;
              data[idx + 1] = 255;
              data[idx + 2] = 255;
            }
          }
        }
      }
    }
  };

  F.Lineart = function (imageData: StudioImageDataLike) {
    const data = imageData.data;
    const width = imageData.width;
    const height = imageData.height;
    const src = new Uint8ClampedArray(data);

    const kernelX = [
      [-1, 0, 1],
      [-2, 0, 2],
      [-1, 0, 1],
    ];
    const kernelY = [
      [-1, -2, -1],
      [0, 0, 0],
      [1, 2, 1],
    ];

    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        let pixelX = 0;
        let pixelY = 0;

        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            const idx = ((y + ky) * width + (x + kx)) * 4;
            const val = 0.299 * src[idx]! + 0.587 * src[idx + 1]! + 0.114 * src[idx + 2]!;
            pixelX += val * kernelX[ky + 1]![kx + 1]!;
            pixelY += val * kernelY[ky + 1]![kx + 1]!;
          }
        }

        const magnitude = Math.sqrt(pixelX * pixelX + pixelY * pixelY);
        const currentIdx = (y * width + x) * 4;

        if (magnitude > 45) {
          data[currentIdx] = 0;
          data[currentIdx + 1] = 0;
          data[currentIdx + 2] = 0;
        } else {
          data[currentIdx] = 255;
          data[currentIdx + 1] = 255;
          data[currentIdx + 2] = 255;
        }
      }
    }
  };

  F.Chromatic = function (this: FilterThis, imageData: StudioImageDataLike) {
    const data = imageData.data;
    const width = imageData.width;
    const height = imageData.height;
    // `this`는 Konva.Node — node.attrs에서 색수차 오프셋을 읽는다.
    const rawOffset = this.attrs?.chromatic;
    if (typeof rawOffset !== "number" || !Number.isFinite(rawOffset) || rawOffset <= 0) return;
    // 실수 오프셋 + 가로 선형 보간 — 강도 슬라이더가 1px 단위로 끊기지 않는다.
    // 정수 오프셋은 보간 가중치가 0이라 기존 정수 시프트와 바이트 동일(레거시 문서 보존).
    const offset = Math.min(12, Math.max(1, rawOffset));
    const src = new Uint8ClampedArray(data);

    for (let y = 0; y < height; y++) {
      const row = y * width;
      for (let x = 0; x < width; x++) {
        const idx = (row + x) * 4;
        const rx = Math.max(0, x - offset);
        const rx0 = Math.floor(rx);
        const rx1 = Math.min(width - 1, rx0 + 1);
        const rf = rx - rx0;
        const bx = Math.min(width - 1, x + offset);
        const bx0 = Math.floor(bx);
        const bx1 = Math.min(width - 1, bx0 + 1);
        const bf = bx - bx0;

        data[idx] = src[(row + rx0) * 4]! * (1 - rf) + src[(row + rx1) * 4]! * rf;
        data[idx + 1] = src[idx + 1]!;
        data[idx + 2] = src[(row + bx0) * 4 + 2]! * (1 - bf) + src[(row + bx1) * 4 + 2]! * bf;
      }
    }
  };

  F.Posterize = function (this: FilterThis, imageData: StudioImageDataLike) {
    const data = imageData.data;
    // `this`는 Konva.Node — node.attrs에서 포스터화 레벨을 읽는다.
    const rawLevels = this.attrs?.posterize;
    if (typeof rawLevels !== "number" || !Number.isFinite(rawLevels) || rawLevels <= 0) return;
    // 1단계 포스터화는 수학적으로 정의되지 않는다(255 / 0). 활성값은 최소 2단계.
    const levels = Math.min(8, Math.max(2, Math.round(rawLevels)));
    const step = 255 / (levels - 1);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = Math.round(data[i]! / step) * step;
      data[i + 1] = Math.round(data[i + 1]! / step) * step;
      data[i + 2] = Math.round(data[i + 2]! / step) * step;
    }
  };

  F.Noise = function (this: FilterThis, imageData: StudioImageDataLike) {
    const data = imageData.data;
    // `this`는 Konva.Node — node.attrs에서 노이즈 강도를 읽는다.
    const rawAmount = this.attrs?.noise;
    if (typeof rawAmount !== "number" || !Number.isFinite(rawAmount) || rawAmount <= 0) return;
    const amount = Math.min(100, rawAmount);
    const rawSeed = this.attrs?.noiseSeed;
    const seed = typeof rawSeed === "number" && Number.isFinite(rawSeed) ? rawSeed : 1_337;
    for (let i = 0; i < data.length; i += 4) {
      const noiseVal = (deterministicNoiseUnit(seed, i >>> 2) - 0.5) * amount * 2.55;
      data[i] = Math.min(255, Math.max(0, data[i]! + noiseVal));
      data[i + 1] = Math.min(255, Math.max(0, data[i + 1]! + noiseVal));
      data[i + 2] = Math.min(255, Math.max(0, data[i + 2]! + noiseVal));
    }
  };

  // --- studio-filters의 순수 픽셀 필터를 this.attrs 기반 Konva 래퍼로 등록 ---
  // 각 래퍼의 `this`는 Konva.Node — node.attrs를 STUDIO_PIXEL_FILTERS에 넘긴다.

  F.Temperature = function (this: FilterThis, imageData: StudioImageDataLike) {
    STUDIO_PIXEL_FILTERS.Temperature!(imageData, this.attrs ?? {});
  };
  F.Sharpen = function (this: FilterThis, imageData: StudioImageDataLike) {
    STUDIO_PIXEL_FILTERS.Sharpen!(imageData, this.attrs ?? {});
  };
  F.InkThreshold = function (this: FilterThis, imageData: StudioImageDataLike) {
    STUDIO_PIXEL_FILTERS.InkThreshold!(imageData, this.attrs ?? {});
  };
  F.Duotone = function (this: FilterThis, imageData: StudioImageDataLike) {
    STUDIO_PIXEL_FILTERS.Duotone!(imageData, this.attrs ?? {});
  };
  // 레벨 보정 — this.attrs의 levels* 값을 읽어 적용(studio-levels).
  F.Levels = levelsKonvaFilter;
  // 톤 커브 — this.attrs.curvePoints(flat) 적용(studio-curves).
  F.Curve = curveKonvaFilter;
  // 컬러 밸런스 — this.attrs.cbShadows/cbMidtones/cbHighlights 적용(studio-color-balance).
  F.ColorBalance = colorBalanceKonvaFilter;
  // 채널 믹서 — this.attrs.channelMixer(flat 13) 적용(studio-channel-mixer).
  F.ChannelMixer = channelMixerKonvaFilter;
  // 선택 색상(HSL) — this.attrs.selectiveHsl(flat 24) 적용(studio-selective-hsl).
  F.SelectiveHsl = selectiveHslKonvaFilter;
  // 생동감 — this.attrs.vibrance/vibranceSat 적용(studio-vibrance).
  F.Vibrance = vibranceKonvaFilter;
  // 그라디언트 맵 — this.attrs.gradientMap(flat) 적용(studio-gradient-map).
  F.GradientMap = gradientMapKonvaFilter;
  // 포토 필터 — this.attrs.pfColor/pfDensity/pfPreserve 적용(studio-photo-filter).
  F.PhotoFilter = photoFilterKonvaFilter;
  // 색상 투명화 — this.attrs.ctaColor/ctaStrength 적용(studio-color-to-alpha).
  F.ColorToAlpha = professionalColorToAlphaKonvaFilter;
  // 자동 보정 — this.attrs.autoMode/autoStrength 적용(studio-auto-adjust).
  F.AutoAdjust = autoAdjustKonvaFilter;
  // 선명도/디테일 — this.attrs.clarity/dehaze 적용(studio-clarity).
  F.Clarity = clarityKonvaFilter;
  // 섀도우/하이라이트 — this.attrs.shShadows/shShadowsWidth/shHighlights/shHighlightsWidth/
  // shMidtoneContrast 적용(studio-shadow-highlight).
  F.ShadowHighlight = shadowHighlightKonvaFilter;
  // 스티커 테두리 — this.attrs.outlineColor/outlineWidth/outlineOpacity 적용(studio-outline). 캐시 offset 패딩 필요.
  F.Outline = outlineKonvaFilter;
  // CSP 경계 효과(fuchi) — this.attrs.layerBorder* 적용(studio-layer-border-effect-compositor). 캐시 offset 패딩 필요.
  F.LayerBorderEffect = layerBorderEffectKonvaFilter;
  // 글로우/블룸 — this.attrs.glowStrength/glowSize/glowThreshold/glowColor 적용(studio-glow).
  F.Glow = glowKonvaFilter;
  // 컬러 하프톤 — this.attrs.htDot/htAngle/htMode/htStrength 적용(studio-halftone).
  F.Halftone = halftoneKonvaFilter;
  // 그레인/텍스처 — this.attrs.grainType/grainAmount/grainSize/grainSeed/grainChroma 적용(studio-grain).
  F.Grain = grainKonvaFilter;
  // 수묵/수채 번짐 — this.attrs.inkWash*로 안료 확산·한지 종이결·과립을 비파괴 적용.
  F.InkWash = inkWashKonvaFilter;
  // 흐림 갤러리 — this.attrs.bfType/bfStrength/bfRadius/bfAngle 적용(studio-blur).
  F.BlurFx = blurFxKonvaFilter;
  // 기하 왜곡 — this.attrs.dsType/dsAmount/dsScale 적용(studio-distort).
  F.Distort = distortKonvaFilter;
  // 스타일라이즈 — this.attrs.stType/stStrength/stDetail 적용(studio-stylize).
  F.Stylize = stylizeKonvaFilter;
  // 조명 효과 — this.attrs.ltType/ltIntensity/ltX/ltY/ltHue 적용(studio-light).
  F.Light = lightKonvaFilter;
  // 스케치/잉크 — this.attrs.skType/skStrength/skDetail 적용(studio-sketch).
  F.Sketch = sketchKonvaFilter;
  // 디테일/샤픈 — this.attrs.dtType/dtAmount/dtRadius 적용(studio-detail).
  F.Detail = detailKonvaFilter;
  // 결정적·범위 제한 고급 필터 — Konva 캐시와 Worker가 같은 구현을 공유한다.
  F.ExposureAdjustment = exposureAdjustmentKonvaFilter;
  F.UnsharpMask = unsharpMaskKonvaFilter;
  F.Morphology = morphologyKonvaFilter;
  F.PixelOffset = pixelOffsetKonvaFilter;
  F.Convolution = convolutionKonvaFilter;
  F.Clouds = cloudsKonvaFilter;
  F.LineCleanup = lineArtCleanupKonvaFilter;
  F.ScreentoneRemoval = screentoneRemovalKonvaFilter;
  F.JpegArtifactReduction = jpegArtifactReductionKonvaFilter;
  F.EdgeAwareDenoise = edgeAwareDenoiseKonvaFilter;
  F.LensBlur = lensBlurKonvaFilter;
  F.FieldIrisBlur = fieldIrisBlurKonvaFilter;
  F.TiltShiftBlur = tiltShiftBlurKonvaFilter;
  F.SelectiveGaussianBlur = selectiveGaussianBlurKonvaFilter;
  F.DifferenceOfGaussians = differenceOfGaussiansKonvaFilter;
  F.DustScratches = dustScratchesKonvaFilter;
  F.TileableBlur = tileableBlurKonvaFilter;
  // 필터 팩 — this.attrs.glitch*/vignette* 적용(studio-filter-pack).
  F.GlitchFx = glitchFxKonvaFilter;
  F.VignetteFx = vignetteFxKonvaFilter;
  F.FilterUnionWave = studioFilterUnionWaveKonvaFilter;
}

/** 활성 보정이 하나라도 있으면 true (캐시 on/off 판단용). */
export function hasActiveImageFilters(el: ImageFilterFields): boolean {
  return !!(
    isActivePositive(el.blur) ||
    isActiveNumber(el.brightness) ||
    isActiveNumber(el.contrast) ||
    el.grayscale ||
    el.sepia ||
    hasActiveLevels(el) ||
    hasActiveCurve(el) ||
    hasActiveColorBalance(el) ||
    hasActiveChannelMixer(el) ||
    hasActiveSelectiveHsl(el) ||
    hasActiveVibrance(el) ||
    hasActiveGradientMap(el) ||
    hasActivePhotoFilter(el) ||
    hasActiveAutoAdjust(el) ||
    hasActiveClarity(el) ||
    hasActiveShadowHighlight(el) ||
    hasActiveOutline(el) ||
    hasActiveStudioLayerBorderEffect(el) ||
    hasActiveGlow(el) ||
    hasActiveHalftone(el) ||
    hasActiveGrain(el) ||
    hasActiveInkWash(el) ||
    hasActiveBlurFx(el) ||
    hasActiveDistort(el) ||
    hasActiveStylize(el) ||
    hasActiveLight(el) ||
    hasActiveSketch(el) ||
    hasActiveDetail(el) ||
    hasActiveLineCleanup(el) ||
    hasActiveScreentoneRemoval(el) ||
    hasActiveJpegArtifactReduction(el) ||
    hasActiveEdgeAwareDenoise(el) ||
    hasActiveLensBlur(el) ||
    hasActiveFieldIrisBlur(el) ||
    hasActiveTiltShiftBlur(el) ||
    hasActiveSelectiveGaussianBlur(el) ||
    hasActiveDifferenceOfGaussians(el) ||
    hasActiveDustScratches(el) ||
    hasActiveTileableBlur(el) ||
    hasActiveExposureAdjustment(el) ||
    hasActiveUnsharpMask(el) ||
    hasActiveMorphology(el) ||
    hasActivePixelOffset(el) ||
    hasActiveConvolution(el) ||
    hasActiveClouds(el) ||
    hasActiveGlitchFx(el) ||
    hasActiveVignetteFx(el) ||
    activeFilterUnionWave(el) !== null ||
    hasActiveSmartFilterProgram(el) ||
    hasActiveColorToAlpha(el) ||
    isActiveNumber(el.saturation) ||
    isActiveNumber(el.hue) ||
    isActiveNumber(el.temperature) ||
    isActivePositive(el.sharpen) ||
    isActivePositive(el.pixelate) ||
    el.invert ||
    isActivePositive(el.inkThreshold) ||
    (isHexColor(el.duotoneShadow) && isHexColor(el.duotoneHighlight)) ||
    el.screentone ||
    el.lineart ||
    isActivePositive(el.chromatic) ||
    isActivePositive(el.posterize) ||
    isActivePositive(el.noise)
  );
}

/**
 * Konva.Image에 적용할 { filters, attrs }.
 * filters는 konva.Filters에서 고른 함수 배열(순서: 색조정→스타일라이즈),
 * attrs는 노드에 펼쳐 넣을 속성(활성값만 + Konva 내장 필터용 blurRadius/brightness/contrast).
 */
export function buildImageFilters(
  el: ImageFilterFields,
  konva: KonvaLike,
  execution: StudioAdvancedBlurExecution = "direct",
): { filters: Array<(imageData: StudioImageDataLike) => void>; attrs: Record<string, number | string | number[]>; cachePad: number } {
  // 이 시점에 읽는 필터들은 모두 등록된 함수다(Konva 내장 + registerStudioKonvaFilters로 부착).
  // unknown 인덱스 값을 필터 함수 맵으로 좁혀 읽는다.
  const F = konva.Filters as Record<string, KonvaFilterFn>;
  const filters: Array<(imageData: StudioImageDataLike) => void> = [];
  const attrs: Record<string, number | string | number[]> = {};
  const filterUnionWave = activeFilterUnionWave(el);
  const appendFilterUnionWave = () => {
    if (!filterUnionWave) return;
    filters.push(F.FilterUnionWave!);
    attrs.filterUnionKind = filterUnionWave.kind;
    attrs.filterUnionAmount = filterUnionWave.amount;
    attrs.filterUnionScale = filterUnionWave.scale;
    attrs.filterUnionDetail = filterUnionWave.detail;
    attrs.filterUnionSeed = filterUnionWave.seed;
    attrs.filterUnionCenterX = filterUnionWave.centerX;
    attrs.filterUnionCenterY = filterUnionWave.centerY;
    attrs.filterUnionAngle = filterUnionWave.angle;
  };

  // --- 픽셀 이동·기하 왜곡 → 흐림을 가장 먼저 ---
  if (hasActivePixelOffset(el)) {
    filters.push(F.PixelOffset!);
    const offset = normalizeStudioPixelOffset(el.pixelOffset);
    attrs.pixelOffsetX = offset.x;
    attrs.pixelOffsetY = offset.y;
    attrs.pixelOffsetEdge = offset.edge;
  }
  if (hasActiveDistort(el)) {
    filters.push(F.Distort!);
    const ds = normalizeDistort(el.distort);
    attrs.dsType = ds.type;
    attrs.dsAmount = ds.amount;
    attrs.dsScale = ds.scale;
  }
  if (filterUnionWave && filterUnionWaveStage(filterUnionWave) === "geometry") {
    appendFilterUnionWave();
  }
  // 글리치 — 픽셀 이동 계열이라 기하 왜곡 직후에 태운다(색 보정 전에 조각이 흩어져야 자연).
  if (hasActiveGlitchFx(el)) {
    filters.push(F.GlitchFx!);
    const gf = normalizeGlitchFx(el.glitchFx);
    attrs.glitchIntensity = gf.intensity;
    attrs.glitchSlices = gf.slices;
    attrs.glitchSplit = gf.split;
    attrs.glitchSeed = gf.seed;
  }
  if (hasActiveBlurFx(el)) {
    filters.push(F.BlurFx!);
    const bf = normalizeBlurFx(el.blurFx);
    attrs.bfType = bf.type;
    attrs.bfStrength = bf.strength;
    attrs.bfRadius = bf.radius;
    attrs.bfAngle = bf.angle;
  }
  // Advanced photographic/edge-aware blurs share one deterministic CPU oracle. The caller fixes
  // `worker` or `direct` before execution; a Worker failure never re-enters this function as a
  // direct Konva substitute for the same operation.
  if (hasActiveLensBlur(el)) {
    filters.push(F.LensBlur!);
    const blur = normalizeStudioLensBlurOptions(el.lensBlur);
    attrs.advancedBlurExecution = execution;
    attrs.lensBlurRadius = blur.radius;
    attrs.lensBlurSampleCount = blur.sampleCount;
    attrs.lensBlurApertureBlades = blur.apertureBlades;
    attrs.lensBlurApertureRotation = blur.apertureRotationRadians;
  }
  if (hasActiveFieldIrisBlur(el)) {
    filters.push(F.FieldIrisBlur!);
    const blur = normalizeStudioFieldIrisBlurOptions(el.fieldIrisBlur);
    attrs.advancedBlurExecution = execution;
    attrs.fieldIrisFocusCenterX = blur.focusCenterX;
    attrs.fieldIrisFocusCenterY = blur.focusCenterY;
    attrs.fieldIrisFocusRadius = blur.focusRadius;
    attrs.fieldIrisFeather = blur.feather;
    attrs.fieldIrisMaximumRadius = blur.maximumBlurRadius;
    attrs.fieldIrisSampleCount = blur.sampleCount;
    attrs.fieldIrisApertureBlades = blur.apertureBlades;
  }
  if (hasActiveTiltShiftBlur(el)) {
    filters.push(F.TiltShiftBlur!);
    const blur = normalizeStudioTiltShiftBlurOptions(el.tiltShiftBlur);
    attrs.advancedBlurExecution = execution;
    attrs.tiltShiftAxis = blur.axisRadians;
    attrs.tiltShiftFocusWidth = blur.focusWidth;
    attrs.tiltShiftFeather = blur.feather;
    attrs.tiltShiftMaximumRadius = blur.maximumBlurRadius;
    attrs.tiltShiftSampleCount = blur.sampleCount;
  }
  if (hasActiveSelectiveGaussianBlur(el)) {
    filters.push(F.SelectiveGaussianBlur!);
    const blur = normalizeStudioSelectiveGaussianBlurOptions(el.selectiveGaussianBlur);
    attrs.advancedBlurExecution = execution;
    attrs.selectiveGaussianRadius = blur.radius;
    attrs.selectiveGaussianSpatialSigma = blur.spatialSigma;
    attrs.selectiveGaussianEdgeThreshold = blur.edgeThreshold;
    attrs.selectiveGaussianEdgeSoftness = blur.edgeSoftness;
  }
  if (hasActiveTileableBlur(el)) {
    filters.push(F.TileableBlur!);
    const blur = normalizeStudioTileableBlurOptions(el.tileableBlur);
    attrs.professionalFilterExecution = execution;
    attrs.tileableBlurRadius = blur.radius;
    attrs.tileableBlurSigma = blur.sigma;
    attrs.tileableBlurStrength = blur.strength;
  }
  // 디테일(하이패스/미디언/스마트샤픈) — 색·스타일라이즈 전에 원본 질감을 다듬는 컨디셔닝.
  if (hasActiveDetail(el)) {
    filters.push(F.Detail!);
    const dt = normalizeDetail(el.detail);
    attrs.dtType = dt.type;
    attrs.dtAmount = dt.amount;
    attrs.dtRadius = dt.radius;
  }
  if (hasActiveMorphology(el)) {
    filters.push(F.Morphology!);
    const morphology = normalizeStudioMorphology(el.morphology);
    attrs.morphMode = morphology.mode;
    attrs.morphRadius = morphology.radius;
  }
  if (hasActiveUnsharpMask(el)) {
    filters.push(F.UnsharpMask!);
    const unsharp = normalizeStudioUnsharpMask(el.unsharpMask);
    attrs.unsharpAmount = unsharp.amount;
    attrs.unsharpRadius = unsharp.radius;
    attrs.unsharpThreshold = unsharp.threshold;
  }
  if (hasActiveConvolution(el)) {
    filters.push(F.Convolution!);
    const convolution = normalizeStudioConvolution(el.convolution);
    attrs.convKernel = [...convolution.kernel];
    attrs.convDivisor = convolution.divisor;
    attrs.convBias = convolution.bias;
  }
  // Imported-art conditioning: block/ringing cleanup first, then periodic tone removal, then
  // edge-aware chroma denoise. These are atomic so direct, Worker and ordered smart stacks share
  // the exact immutable kernel math and never flatten duplicate operations.
  if (hasActiveJpegArtifactReduction(el)) {
    filters.push(F.JpegArtifactReduction!);
    const jpeg = normalizeStudioJpegArtifactReductionOptions(el.jpegArtifactReduction);
    attrs.toneArtifactExecution = execution;
    attrs.jpegDeblockStrength = jpeg.deblockStrength;
    attrs.jpegDeringStrength = jpeg.deringStrength;
    attrs.jpegBoundaryThreshold = jpeg.boundaryThreshold;
    attrs.jpegProtectedEdgeThreshold = jpeg.protectedEdgeThreshold;
    attrs.jpegRingingThreshold = jpeg.ringingThreshold;
    attrs.jpegInkThreshold = jpeg.inkLumaThreshold;
  }
  if (hasActiveScreentoneRemoval(el)) {
    filters.push(F.ScreentoneRemoval!);
    const tone = normalizeStudioScreentoneRemovalOptions(el.screentoneRemoval);
    attrs.toneArtifactExecution = execution;
    attrs.toneRemovalRadius = tone.radius;
    attrs.toneRemovalStrength = tone.strength;
    attrs.toneRemovalInkThreshold = tone.inkLumaThreshold;
  }
  if (hasActiveEdgeAwareDenoise(el)) {
    filters.push(F.EdgeAwareDenoise!);
    const denoise = normalizeStudioEdgeAwareDenoiseOptions(el.edgeAwareDenoise);
    attrs.toneArtifactExecution = execution;
    attrs.edgeDenoiseRadius = denoise.radius;
    attrs.edgeDenoiseStrength = denoise.strength;
    attrs.edgeDenoiseRangeThreshold = denoise.rangeThreshold;
  }
  if (hasActiveDustScratches(el)) {
    filters.push(F.DustScratches!);
    const cleanup = normalizeStudioDustScratchesOptions(el.dustScratches);
    attrs.professionalFilterExecution = execution;
    attrs.dustScratchRadius = cleanup.radius;
    attrs.dustScratchThreshold = cleanup.threshold;
    attrs.dustScratchStrength = cleanup.strength;
  }
  if (hasActiveDifferenceOfGaussians(el)) {
    filters.push(F.DifferenceOfGaussians!);
    const dog = normalizeStudioDifferenceOfGaussiansOptions(el.differenceOfGaussians);
    attrs.professionalFilterExecution = execution;
    attrs.dogSmallSigma = dog.smallSigma;
    attrs.dogLargeSigma = dog.largeSigma;
    attrs.dogThreshold = dog.threshold;
    attrs.dogStrength = dog.strength;
  }
  // 선화 정리는 내부 순서(그레이스케일→자동 대비→샤픈→임계)를 하나의 원자적 필터로
  // 유지한다. 개별 필드로 펼치면 고정 카테고리 순서가 달라져 라이브/Worker 결과가 어긋난다.
  if (hasActiveLineCleanup(el)) {
    filters.push(F.LineCleanup!);
    const cleanup = normalizeLineArtCleanup(el.lineCleanup);
    attrs.lineCleanupThreshold = cleanup.threshold;
    attrs.lineCleanupStrength = cleanup.strength;
  }
  // --- 색/톤 보정 먼저 ---
  if (hasActiveExposureAdjustment(el)) {
    filters.push(F.ExposureAdjustment!);
    const exposure = normalizeStudioExposureAdjustment(el.exposureAdjustment);
    attrs.exposureEv = exposure.exposure;
    attrs.exposureGamma = exposure.gamma;
    attrs.exposureOffset = exposure.offset;
  }
  if (isActiveNumber(el.brightness)) {
    filters.push(F.Brighten as (imageData: StudioImageDataLike) => void);
    attrs.brightness = clampFinite(el.brightness!, -0.8, 0.8);
  }
  if (isActiveNumber(el.contrast)) {
    filters.push(F.Contrast as (imageData: StudioImageDataLike) => void);
    attrs.contrast = clampFinite(el.contrast!, -80, 80);
  }
  if (isActivePositive(el.blur)) {
    filters.push(F.Blur as (imageData: StudioImageDataLike) => void);
    attrs.blurRadius = clampFinite(el.blur!, 0, 30);
  }
  if (isActiveNumber(el.saturation) || isActiveNumber(el.hue)) {
    filters.push(F.HSL as (imageData: StudioImageDataLike) => void);
    // Konva HSL: saturation -1..1, hue 0..359(도), luminance 0이 중립.
    attrs.saturation = isActiveNumber(el.saturation) ? clampFinite(el.saturation!, -1, 1) : 0;
    attrs.hue = isActiveNumber(el.hue) ? (((el.hue! % 360) + 360) % 360) : 0;
    attrs.luminance = 0;
  }
  if (isActiveNumber(el.temperature)) {
    filters.push(F.Temperature!);
    attrs.temperature = clampFinite(el.temperature!, -100, 100);
  }
  if (isActivePositive(el.sharpen)) {
    filters.push(F.Sharpen!);
    attrs.sharpen = clampFinite(el.sharpen!, 0, 1);
  }
  if (hasActiveLevels(el)) {
    filters.push(F.Levels!);
    const lv = levelsParamsOf(el);
    attrs.levelsBlack = lv.blackPoint;
    attrs.levelsWhite = lv.whitePoint;
    attrs.levelsGamma = lv.gamma;
    attrs.levelsOutBlack = lv.outBlack;
    attrs.levelsOutWhite = lv.outWhite;
    // r/g/b 개별 채널 레벨 — 항등이 아닌 채널만 평탄 5칸으로 부착(studio-levels).
    if (el.levelsCh) {
      const lch = normalizeLevelsChannels(el.levelsCh);
      if (!isIdentityLevels(lch.r)) attrs.levelsR = levelsToFlat(lch.r);
      if (!isIdentityLevels(lch.g)) attrs.levelsG = levelsToFlat(lch.g);
      if (!isIdentityLevels(lch.b)) attrs.levelsB = levelsToFlat(lch.b);
    }
  }
  if (hasActiveCurve(el)) {
    filters.push(F.Curve!);
    attrs.curvePoints = curveToFlat(normalizeCurve(el.curve));
    // r/g/b 개별 채널 곡선 — 항등이 아닌 채널만 평탄 배열로 부착(studio-curves).
    if (el.curveCh) {
      const cch = normalizeCurveChannels(el.curveCh);
      if (!isIdentityCurve(cch.r)) attrs.curvePointsR = curveToFlat(cch.r);
      if (!isIdentityCurve(cch.g)) attrs.curvePointsG = curveToFlat(cch.g);
      if (!isIdentityCurve(cch.b)) attrs.curvePointsB = curveToFlat(cch.b);
    }
  }
  if (hasActiveColorBalance(el)) {
    filters.push(F.ColorBalance!);
    const cb = normalizeColorBalance(el.colorBalance);
    attrs.cbShadows = cb.shadows;
    attrs.cbMidtones = cb.midtones;
    attrs.cbHighlights = cb.highlights;
  }
  if (hasActiveChannelMixer(el)) {
    filters.push(F.ChannelMixer!);
    attrs.channelMixer = channelMixerToFlat(normalizeChannelMixer(el.channelMixer));
  }
  if (hasActiveSelectiveHsl(el)) {
    filters.push(F.SelectiveHsl!);
    attrs.selectiveHsl = selectiveHslToFlat(normalizeSelectiveHsl(el.selectiveHsl));
  }
  if (hasActiveVibrance(el)) {
    filters.push(F.Vibrance!);
    const vb = normalizeVibrance(el.vibrance);
    attrs.vibrance = vb.vibrance;
    attrs.vibranceSat = vb.saturation;
  }
  if (hasActiveAutoAdjust(el)) {
    filters.push(F.AutoAdjust!);
    const aa = normalizeAutoAdjust(el.autoAdjust);
    attrs.autoMode = aa.mode;
    attrs.autoStrength = aa.strength;
  }
  if (hasActiveClarity(el)) {
    filters.push(F.Clarity!);
    const cl = normalizeClarity(el.clarity);
    attrs.clarity = cl.clarity;
    attrs.dehaze = cl.dehaze;
  }
  if (hasActiveShadowHighlight(el)) {
    filters.push(F.ShadowHighlight!);
    const sh = normalizeShadowHighlight(el.shadowHighlight);
    attrs.shShadows = sh.shadows;
    attrs.shShadowsWidth = sh.shadowsWidth;
    attrs.shHighlights = sh.highlights;
    attrs.shHighlightsWidth = sh.highlightsWidth;
    attrs.shMidtoneContrast = sh.midtoneContrast;
  }
  if (hasActivePhotoFilter(el)) {
    filters.push(F.PhotoFilter!);
    const pf = normalizePhotoFilter(el.photoFilter);
    attrs.pfColor = pf.color;
    attrs.pfDensity = pf.density;
    attrs.pfPreserve = pf.preserveLuminosity ? 1 : 0;
  }
  if (hasActiveGradientMap(el)) {
    filters.push(F.GradientMap!);
    attrs.gradientMap = gradientMapToFlat(normalizeGradientMap(el.gradientMap));
  }
  if (el.grayscale) {
    filters.push(F.Grayscale as (imageData: StudioImageDataLike) => void);
  }
  if (el.sepia) {
    filters.push(F.Sepia as (imageData: StudioImageDataLike) => void);
  }
  if (el.invert) {
    filters.push(F.Invert as (imageData: StudioImageDataLike) => void);
  }

  // --- 스타일라이즈 ---
  // 색상 투명화(Color to Alpha) — 알파를 새로 punching하므로 이 알파에 의존하는 이후 단계
  // (특히 실루엣 경계를 읽는 Outline)보다 먼저 적용해야 한다. 색 보정(레벨/커브/컬러밸런스/
  // 포토필터/그레이스케일/세피아/반전)은 이미 다 끝난 뒤라, 사용자가 라이브 프리뷰에서 스포이드로
  // 뽑은 키 색상이 실제로 이 시점의 픽셀 값과 일치한다.
  if (hasActiveColorToAlpha(el)) {
    filters.push(F.ColorToAlpha!);
    const cta = normalizeColorToAlpha(el.colorToAlpha);
    attrs.professionalFilterExecution = execution;
    attrs.ctaColor = cta.keyColor;
    attrs.ctaStrength = cta.strength;
  }
  // 수묵/수채 재질 — 색/톤 보정과 색상 투명화 뒤, 하프톤·스타일라이즈·스케치보다 앞.
  // 따라서 사용자가 고른 키 색상/톤을 보존한 다음 안료와 종이로 변환하고, 이후 잉크/망점
  // 효과는 이미 변환된 결과를 기준으로 자연스럽게 겹친다.
  if (hasActiveInkWash(el)) {
    filters.push(F.InkWash!);
    const iw = normalizeInkWash(el.inkWash);
    attrs.inkWashStrength = iw.strength;
    attrs.inkWashSpread = iw.spread;
    attrs.inkWashEdgeBleed = iw.edgeBleed;
    attrs.inkWashGranulation = iw.granulation;
    attrs.inkWashPaper = iw.paper;
    attrs.inkWashColor = iw.inkColor;
    attrs.inkWashSeed = iw.seed;
  }
  if (isActivePositive(el.inkThreshold)) {
    filters.push(F.InkThreshold!);
    attrs.inkThreshold = clampFinite(el.inkThreshold!, 0, 1);
  }
  if (isHexColor(el.duotoneShadow) && isHexColor(el.duotoneHighlight)) {
    filters.push(F.Duotone!);
    attrs.duotoneShadow = el.duotoneShadow;
    attrs.duotoneHighlight = el.duotoneHighlight;
  }
  if (el.screentone) {
    filters.push(F.Screentone!);
  }
  if (el.lineart) {
    filters.push(F.Lineart!);
  }
  if (isActivePositive(el.chromatic)) {
    filters.push(F.Chromatic!);
    // 의도적 변경(2026-07-24): 서브픽셀 색수차 — 반올림 없이 실수 오프셋을 그대로 전달한다.
    attrs.chromatic = clampFinite(el.chromatic!, 1, 12);
  }
  if (isActivePositive(el.posterize)) {
    filters.push(F.Posterize!);
    attrs.posterize = clampFinite(Math.round(el.posterize!), 2, 8);
  }
  if (isActivePositive(el.noise)) {
    filters.push(F.Noise!);
    attrs.noise = clampFinite(el.noise!, 0, 100);
    attrs.noiseSeed = typeof el.noiseSeed === "number" && Number.isFinite(el.noiseSeed)
      ? Math.trunc(el.noiseSeed) >>> 0
      : 1_337;
  }
  if (isActivePositive(el.pixelate)) {
    filters.push(F.Pixelate as (imageData: StudioImageDataLike) => void);
    attrs.pixelSize = clampFinite(Math.round(el.pixelate!), 1, 40);
  }
  // 하프톤(망점) → 그레인(질감) → 글로우 → 테두리 순으로 스타일라이즈를 마무리한다.
  if (hasActiveHalftone(el)) {
    filters.push(F.Halftone!);
    const ht = normalizeHalftone(el.halftone);
    attrs.htDot = ht.dotSize;
    attrs.htAngle = ht.angle;
    attrs.htMode = ht.mode;
    attrs.htStrength = ht.strength;
  }
  if (hasActiveGrain(el)) {
    filters.push(F.Grain!);
    const gr = normalizeGrain(el.grain);
    attrs.grainType = gr.type;
    attrs.grainAmount = gr.amount;
    attrs.grainSize = gr.size;
    attrs.grainSeed = gr.seed;
    // 크로마(채널 분리) 노이즈 — normalize가 0/누락을 키 생략으로 접으므로 존재=활성(>0).
    // 0일 때 attrs를 아예 싣지 않아 기존 문서의 attrs 형태가 바이트 동일하게 유지된다.
    if (gr.chroma !== undefined) attrs.grainChroma = gr.chroma;
  }
  if (hasActiveClouds(el)) {
    filters.push(F.Clouds!);
    const clouds = normalizeStudioClouds(el.clouds);
    attrs.cloudAmount = clouds.amount;
    attrs.cloudScale = clouds.scale;
    attrs.cloudSeed = clouds.seed;
    attrs.cloudMode = clouds.mode;
  }
  if (filterUnionWave && filterUnionWaveStage(filterUnionWave) === "texture") {
    appendFilterUnionWave();
  }
  // 스타일라이즈(엠보스/외곽선/솔라리/유화) — 톤·질감 위에 얹는 스타일 변환.
  if (hasActiveStylize(el)) {
    filters.push(F.Stylize!);
    const st = normalizeStylize(el.stylize);
    attrs.stType = st.type;
    attrs.stStrength = st.strength;
    attrs.stDetail = st.detail;
  }
  // 스케치/잉크(포토카피/크로스해치/스탬프/메조틴트) — 잉크 스타일화라 스타일라이즈 바로 뒤.
  if (hasActiveSketch(el)) {
    filters.push(F.Sketch!);
    const sk = normalizeSketch(el.sketch);
    attrs.skType = sk.type;
    attrs.skStrength = sk.strength;
    attrs.skDetail = sk.detail;
  }
  if (filterUnionWave && filterUnionWaveStage(filterUnionWave) === "stylize") {
    appendFilterUnionWave();
  }
  // 글로우는 최종 밝은 영역에서 번지므로 늦게, 테두리는 실루엣 바깥에 그리므로 가장 마지막.
  if (hasActiveGlow(el)) {
    filters.push(F.Glow!);
    const gl = normalizeGlow(el.glow);
    attrs.glowStrength = gl.strength;
    attrs.glowSize = gl.size;
    attrs.glowThreshold = gl.threshold;
    attrs.glowColor = gl.color;
  }
  // 조명 효과(렌즈 플레어/햇살/라이트릭/광선) — 가산광이라 거의 마지막에 얹는다(테두리 직전).
  if (hasActiveLight(el)) {
    filters.push(F.Light!);
    const lt = normalizeLight(el.light);
    attrs.ltType = lt.type;
    attrs.ltIntensity = lt.intensity;
    attrs.ltX = lt.x;
    attrs.ltY = lt.y;
    attrs.ltHue = lt.hue;
  }
  if (filterUnionWave && filterUnionWaveStage(filterUnionWave) === "light") {
    appendFilterUnionWave();
  }
  // 비네트 — 조명까지 끝난 결과의 가장자리를 어둡히는 마무리 연출(테두리 직전).
  if (hasActiveVignetteFx(el)) {
    filters.push(F.VignetteFx!);
    const vf = normalizeVignetteFx(el.vignetteFx);
    attrs.vignetteDarkness = vf.darkness;
    attrs.vignetteSize = vf.size;
    attrs.vignetteRoundness = vf.roundness;
    attrs.vignetteFeather = vf.feather;
  }
  let cachePad = 0;
  if (hasActiveOutline(el)) {
    filters.push(F.Outline!);
    const ol = normalizeOutline(el.outline);
    attrs.outlineColor = ol.color;
    attrs.outlineWidth = ol.width;
    attrs.outlineOpacity = ol.opacity;
    // 이중 외곽선 — attrs 레코드가 undefined를 허용하지 않으므로 값이 있을 때만 싣는다.
    if (ol.secondColor !== undefined) attrs.outlineSecondColor = ol.secondColor;
    if (ol.secondWidth !== undefined) attrs.outlineSecondWidth = ol.secondWidth;
    cachePad = outlineCachePad(ol); // 테두리가 실루엣 밖으로 자라도록 캐시 offset 패딩.
  }
  // CSP 경계 효과 — 최종 실루엣 알파의 EDT 거리에서 fuchi를 그리므로 테두리처럼 맨 마지막.
  if (hasActiveStudioLayerBorderEffect(el)) {
    filters.push(F.LayerBorderEffect!);
    const border = studioLayerBorderEffectFilterAttrs(el.borderEffect);
    attrs.layerBorderThickness = border.layerBorderThickness;
    attrs.layerBorderColor = border.layerBorderColor;
    attrs.layerBorderType = border.layerBorderType;
    attrs.layerBorderAntiAliased = border.layerBorderAntiAliased;
    cachePad = Math.max(cachePad, studioLayerBorderEffectCachePad(el.borderEffect));
  }

  // The ordinary image fields above keep their established category order. The non-destructive
  // smart-filter stack is then painted bottom → top exactly as stored. Each operation receives a
  // private attrs bag captured by a wrapper; this is what lets duplicate engines retain distinct
  // parameters instead of every duplicate reading the final value from one Konva node attrs map.
  for (const operation of smartFilterOperationsOf(el)) {
    const operationBuild = buildImageFilters(
      studioAdjustmentOperationToFilterFields(operation),
      konva,
      execution,
    );
    const operationAttrs = operationBuild.attrs;
    for (const operationFilter of operationBuild.filters) {
      filters.push(function orderedStudioSmartFilter(imageData: StudioImageDataLike): void {
        operationFilter.call({ attrs: operationAttrs }, imageData);
      });
    }
    cachePad = Math.max(cachePad, operationBuild.cachePad);
  }

  return { filters, attrs, cachePad };
}

/**
 * buildImageFilters가 돌려준 {filters, attrs}를 실제 픽셀에 순서대로 적용한다 — Konva가
 * `_getCachedSceneCanvas` 내부에서 하는 `filter.call(this, imageData)` 루프와 동일하다
 * (studio-konva-filters.test.ts에서 병행 검증). Konva 노드 없이도 동작하므로 메인 스레드
 * 동기 폴백과 Worker 양쪽에서 이 함수 하나를 공유한다.
 */
export function applyImageFilters(
  imageData: StudioImageDataLike,
  filters: ReadonlyArray<(imageData: StudioImageDataLike) => void>,
  attrs: Record<string, unknown>,
): void {
  const filterThis: FilterThis = { attrs };
  for (const filter of filters) filter.call(filterThis, imageData);
}
