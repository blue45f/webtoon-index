/**
 * Studio color-quality specialist.
 *
 * Color.js owns standards-oriented parsing, linear-light conversion, gamut checks/mapping and
 * Delta-E. Culori independently owns perceptual ramp interpolation and acts as a conversion oracle.
 * Only plain numbers cross this module boundary; library objects never enter the document model.
 */

import Color from "colorjs.io";
import {
  converter as createCuloriConverter,
  interpolate as createCuloriInterpolator,
  parse as parseCuloriColor,
  type Color as CuloriColor,
} from "culori";

export type StudioLinearColorSpace =
  | "linear-srgb"
  | "linear-display-p3";

export interface StudioLinearColor {
  readonly space: StudioLinearColorSpace;
  readonly components: readonly [number, number, number, number];
}

export type StudioColorGamutMapping = "none" | "css";

export type StudioColorQualityFailureReason =
  | "invalid-color"
  | "invalid-linear-color"
  | "invalid-step-count"
  | "conversion-failed"
  | "oracle-divergence";

export type StudioColorQualityResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly reason: StudioColorQualityFailureReason;
      readonly detail: string;
    };

export interface StudioColorConversionReceipt {
  readonly color: StudioLinearColor;
  readonly sourceInTargetGamut: boolean;
  readonly gamutMapping: StudioColorGamutMapping;
  /** Maximum encoded-channel delta between Color.js and Culori. */
  readonly oracleMaxEncodedChannelDelta: number;
}

export interface StudioPerceptualRampRequest {
  readonly stops: readonly string[];
  readonly steps: number;
  readonly targetSpace: StudioLinearColorSpace;
  readonly gamutMapping?: StudioColorGamutMapping;
}

const MAX_COLOR_TEXT_LENGTH = 8_192;
const MAX_RAMP_STOPS = 64;
const MAX_RAMP_STEPS = 4_096;
const ORACLE_CHANNEL_TOLERANCE = 2e-5;

const culoriSrgb = createCuloriConverter("rgb");
const culoriP3 = createCuloriConverter("p3");

function targetColorJsSpace(space: StudioLinearColorSpace): {
  readonly encoded: "srgb" | "p3";
  readonly linear: "srgb-linear" | "p3-linear";
} {
  return space === "linear-srgb"
    ? { encoded: "srgb", linear: "srgb-linear" }
    : { encoded: "p3", linear: "p3-linear" };
}

function finiteAlpha(value: number): number | null {
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
}

function isFiniteLinearColor(value: unknown): value is StudioLinearColor {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<StudioLinearColor>;
  if (
    candidate.space !== "linear-srgb"
    && candidate.space !== "linear-display-p3"
  ) {
    return false;
  }
  if (!Array.isArray(candidate.components) || candidate.components.length !== 4) {
    return false;
  }
  return (
    candidate.components.slice(0, 3).every(Number.isFinite)
    && finiteAlpha(candidate.components[3]!) !== null
  );
}

function colorJsFromLinear(color: StudioLinearColor): Color {
  const sourceSpace = targetColorJsSpace(color.space).linear;
  return new Color(
    sourceSpace,
    [color.components[0], color.components[1], color.components[2]],
    color.components[3],
  );
}

function encodedCuloriChannels(
  color: CuloriColor | undefined,
  target: "srgb" | "p3",
): readonly [number, number, number] | null {
  if (!color) return null;
  const converted = target === "srgb" ? culoriSrgb(color) : culoriP3(color);
  if (!converted) return null;
  const candidate = converted as {
    r?: number;
    g?: number;
    b?: number;
  };
  if (
    !Number.isFinite(candidate.r)
    || !Number.isFinite(candidate.g)
    || !Number.isFinite(candidate.b)
  ) {
    return null;
  }
  return [candidate.r!, candidate.g!, candidate.b!];
}

function maxChannelDelta(
  left: readonly number[],
  right: readonly number[],
): number {
  let max = 0;
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    max = Math.max(max, Math.abs(left[index]! - right[index]!));
  }
  return max;
}

function convertColorJs(
  source: Color,
  targetSpace: StudioLinearColorSpace,
  gamutMapping: StudioColorGamutMapping,
  culoriSource: CuloriColor | undefined,
): StudioColorQualityResult<StudioColorConversionReceipt> {
  try {
    const target = targetColorJsSpace(targetSpace);
    const encodedUnmapped = source.to(target.encoded);
    const sourceInTargetGamut = encodedUnmapped.inGamut();
    const encoded = gamutMapping === "css"
      ? encodedUnmapped.clone().toGamut({
          space: target.encoded,
          method: "css",
        })
      : encodedUnmapped;
    const linear = encoded.to(target.linear);
    const alpha = finiteAlpha(linear.alpha);
    if (
      alpha === null
      || linear.coords.length < 3
      || linear.coords.slice(0, 3).some((component) => !Number.isFinite(component))
    ) {
      return {
        ok: false,
        reason: "conversion-failed",
        detail: "색 변환 결과가 유한한 선형 RGBA가 아닙니다.",
      };
    }

    let oracleMaxEncodedChannelDelta = 0;
    if (gamutMapping === "none" && culoriSource) {
      const oracle = encodedCuloriChannels(culoriSource, target.encoded);
      if (oracle) {
        const encodedChannels = [
          encoded.coords[0]!,
          encoded.coords[1]!,
          encoded.coords[2]!,
        ] as const;
        oracleMaxEncodedChannelDelta = maxChannelDelta(
          encodedChannels,
          oracle,
        );
        if (oracleMaxEncodedChannelDelta > ORACLE_CHANNEL_TOLERANCE) {
          return {
            ok: false,
            reason: "oracle-divergence",
            detail:
              `Color.js/Culori 변환 차이가 허용치 ${ORACLE_CHANNEL_TOLERANCE}를 넘었습니다(${oracleMaxEncodedChannelDelta}).`,
          };
        }
      }
    }

    return {
      ok: true,
      value: {
        color: {
          space: targetSpace,
          components: [
            linear.coords[0]!,
            linear.coords[1]!,
            linear.coords[2]!,
            alpha,
          ],
        },
        sourceInTargetGamut,
        gamutMapping,
        oracleMaxEncodedChannelDelta,
      },
    };
  } catch {
    return {
      ok: false,
      reason: "conversion-failed",
      detail: "색 공간 변환 또는 gamut mapping에 실패했습니다.",
    };
  }
}

/** Parses any Color.js-supported CSS color into explicit scene-linear RGBA. */
export function parseStudioColorToLinear(
  input: string,
  targetSpace: StudioLinearColorSpace,
  gamutMapping: StudioColorGamutMapping = "none",
): StudioColorQualityResult<StudioColorConversionReceipt> {
  if (
    typeof input !== "string"
    || input.trim().length === 0
    || input.length > MAX_COLOR_TEXT_LENGTH
  ) {
    return {
      ok: false,
      reason: "invalid-color",
      detail: "색 문자열이 비어 있거나 허용 길이를 넘었습니다.",
    };
  }
  try {
    const source = new Color(input);
    return convertColorJs(
      source,
      targetSpace,
      gamutMapping,
      parseCuloriColor(input),
    );
  } catch {
    return {
      ok: false,
      reason: "invalid-color",
      detail: "지원하지 않거나 잘못된 색 문자열입니다.",
    };
  }
}

/** Converts canonical linear data without silently clipping wide-gamut components. */
export function convertStudioLinearColor(
  input: StudioLinearColor,
  targetSpace: StudioLinearColorSpace,
  gamutMapping: StudioColorGamutMapping = "none",
): StudioColorQualityResult<StudioColorConversionReceipt> {
  if (!isFiniteLinearColor(input)) {
    return {
      ok: false,
      reason: "invalid-linear-color",
      detail: "선형 색은 유한한 RGB와 0..1 알파를 가져야 합니다.",
    };
  }
  const source = colorJsFromLinear(input);
  return convertColorJs(source, targetSpace, gamutMapping, undefined);
}

/**
 * Builds an OKLCH perceptual ramp with Culori, then converts every stop through Color.js.
 * The endpoints are included exactly and output remains plain scene-linear RGBA.
 */
export function buildStudioPerceptualColorRamp(
  request: StudioPerceptualRampRequest,
): StudioColorQualityResult<readonly StudioLinearColor[]> {
  if (
    !Number.isInteger(request.steps)
    || request.steps < 2
    || request.steps > MAX_RAMP_STEPS
    || request.stops.length < 2
    || request.stops.length > MAX_RAMP_STOPS
  ) {
    return {
      ok: false,
      reason: "invalid-step-count",
      detail: `색상 램프는 2..${MAX_RAMP_STOPS}개 정지점과 2..${MAX_RAMP_STEPS}개 샘플이 필요합니다.`,
    };
  }
  if (
    request.stops.some(
      (stop) => typeof stop !== "string" || stop.length > MAX_COLOR_TEXT_LENGTH,
    )
  ) {
    return {
      ok: false,
      reason: "invalid-color",
      detail: "램프 정지점에 잘못된 색 문자열이 있습니다.",
    };
  }

  try {
    const interpolator = createCuloriInterpolator([...request.stops], "oklch");
    const colors: StudioLinearColor[] = [];
    for (let index = 0; index < request.steps; index += 1) {
      const t = index / (request.steps - 1);
      const interpolated = interpolator(t);
      if (
        !interpolated
        || interpolated.mode !== "oklch"
        || !Number.isFinite(interpolated.l)
        || !Number.isFinite(interpolated.c)
        || (interpolated.h !== undefined && !Number.isFinite(interpolated.h))
      ) {
        return {
          ok: false,
          reason: "conversion-failed",
          detail: `OKLCH 램프 ${index}번 샘플을 만들지 못했습니다.`,
        };
      }
      const color = new Color(
        "oklch",
        [
          interpolated.l,
          interpolated.c,
          interpolated.h ?? 0,
        ],
        interpolated.alpha ?? 1,
      );
      const converted = convertColorJs(
        color,
        request.targetSpace,
        request.gamutMapping ?? "none",
        undefined,
      );
      if (!converted.ok) return converted;
      colors.push(converted.value.color);
    }
    return { ok: true, value: colors };
  } catch {
    return {
      ok: false,
      reason: "invalid-color",
      detail: "램프 정지점 색을 해석하지 못했습니다.",
    };
  }
}

/** Standards-oriented perceptual color difference for palette matching and regression gates. */
export function studioColorDeltaE2000(
  left: StudioLinearColor,
  right: StudioLinearColor,
): StudioColorQualityResult<number> {
  if (!isFiniteLinearColor(left) || !isFiniteLinearColor(right)) {
    return {
      ok: false,
      reason: "invalid-linear-color",
      detail: "Delta-E 입력은 유한한 정규 선형 색이어야 합니다.",
    };
  }
  try {
    const delta = colorJsFromLinear(left).deltaE(
      colorJsFromLinear(right),
      "2000",
    );
    return Number.isFinite(delta)
      ? { ok: true, value: delta }
      : {
          ok: false,
          reason: "conversion-failed",
          detail: "Delta-E 결과가 유한하지 않습니다.",
        };
  } catch {
    return {
      ok: false,
      reason: "conversion-failed",
      detail: "Delta-E 계산에 실패했습니다.",
    };
  }
}
