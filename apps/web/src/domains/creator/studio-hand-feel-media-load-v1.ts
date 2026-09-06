/**
 * Shared hand-feel media load (속도·필압 → 안료/물/피복).
 *
 * Reference mechanics (parameter-only, no vendor code):
 * - Adobe Fresco Live Brushes: fast travel lays a thinner wet film; dwell soaks more.
 * - Infinite Painter: speed thins coverage so canvas tooth shows through (갈필).
 * - Rebelle: quick strokes soak less; slow strokes wet the sheet.
 * - Kleki / Klecks wash: station spacing vs radius is the practical speed signal.
 *
 * Identity at rest: speed 0 and mid pressure return scales of 1 so existing
 * equally-spaced, mid-speed plans stay within a couple percent of the prior look.
 */

export const STUDIO_HAND_FEEL_MEDIA_LOAD_V1 = "studio-hand-feel-media-load-v1" as const;

export type StudioHandFeelMediaFamilyV1 = "wash" | "sumi" | "oil" | "dry";

export interface StudioHandFeelMediaLoadInputV1 {
  readonly pressure?: number;
  /** 0 = rest / dwell, 1 = flick. */
  readonly speed?: number;
  readonly family?: StudioHandFeelMediaFamilyV1;
}

export interface StudioHandFeelMediaLoadV1 {
  readonly version: typeof STUDIO_HAND_FEEL_MEDIA_LOAD_V1;
  readonly speed: number;
  readonly pressure: number;
  readonly pigmentScale: number;
  readonly waterScale: number;
  readonly wetnessScale: number;
  readonly coverageScale: number;
  readonly widthScale: number;
}

const FAMILY_PIGMENT_SKIP = {
  wash: 0.48,
  sumi: 0.62,
  oil: 0.38,
  dry: 0.7,
} as const;

const FAMILY_WATER_SKIP = {
  wash: 0.22,
  sumi: 0.18,
  oil: 0.12,
  dry: 0,
} as const;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * Convert station travel (px) and local radius (px) into a 0..1 speed.
 * Rest spacing (≤ 0.25·radius) is 0; a flick of 1.75·radius is 1.
 */
export function studioHandFeelTravelSpeedV1(
  travelPx: number,
  radiusPx: number,
): number {
  const radius = Number.isFinite(radiusPx) && radiusPx > 1e-6 ? radiusPx : 1;
  const travel = Number.isFinite(travelPx) && travelPx > 0 ? travelPx : 0;
  return clamp01((travel / radius - 0.25) / 1.5);
}

export function resolveStudioHandFeelMediaLoadV1(
  input: StudioHandFeelMediaLoadInputV1 = {},
): StudioHandFeelMediaLoadV1 {
  const speed = clamp01(input.speed ?? 0);
  const pressure = clamp01(
    typeof input.pressure === "number" && Number.isFinite(input.pressure)
      ? input.pressure
      : 0.55,
  );
  const family = input.family ?? "wash";
  const speedCurve = speed ** 1.15;
  const pressureHold = 0.28 + 0.72 * pressure;
  const pigmentSkip = FAMILY_PIGMENT_SKIP[family] * speedCurve * (1.15 - pressureHold);
  const waterSkip = FAMILY_WATER_SKIP[family] * speedCurve;
  const pigmentScale = clamp01(1 - pigmentSkip);
  const waterScale = clamp01(1 - waterSkip);
  const wetnessScale = clamp01(1 - 0.42 * speedCurve);
  const coverageScale = clamp01(1 - FAMILY_PIGMENT_SKIP[family] * 0.85 * speedCurve);
  const widthScale = clamp01(0.72 + 0.28 * pressure - 0.16 * speedCurve);
  return Object.freeze({
    version: STUDIO_HAND_FEEL_MEDIA_LOAD_V1,
    speed,
    pressure,
    pigmentScale,
    waterScale,
    wetnessScale,
    coverageScale,
    widthScale,
  });
}
