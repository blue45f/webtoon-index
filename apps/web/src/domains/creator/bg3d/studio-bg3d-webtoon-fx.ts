/**
 * Renderer-neutral contract for a depth-aware 3D webtoon FX specialist.
 *
 * The interactive Three/R3F scene remains authoritative. A specialist such as Babylon.js receives
 * a canonical scene snapshot plus this bounded recipe, renders in an isolated canvas/job, and
 * returns a regular capture DTO. Engine materials, scene nodes, textures, and GPU resources never
 * cross the runtime-adapter boundary.
 */

export const STUDIO_BG3D_WEBTOON_FX_MAX_PASSES = 8;
export const STUDIO_BG3D_WEBTOON_FX_RECIPE_VERSION = 1 as const;
export const STUDIO_BG3D_WEBTOON_FX_MAX_PREVIEW_PIXELS = 4_194_304;
export const STUDIO_BG3D_WEBTOON_FX_MAX_FINAL_PIXELS = 16_777_216;
/** Kept equal to STUDIO_BG3D_LT_RENDER_MAX_PIXELS by a contract test without a runtime import. */
export const STUDIO_BG3D_WEBTOON_FX_MAX_LT_PIXELS = 8_388_608;
export const STUDIO_BG3D_WEBTOON_FX_MAX_TIME_SECONDS = 3_600;
export const STUDIO_BG3D_WEBTOON_FX_OUTPUT_PROFILE =
  "studio-bg3d-webtoon-fx-rgba8-straight-srgb-topdown-scene-depth-f32-v1" as const;

export type StudioBg3dWebtoonFxQuality = "preview" | "final";
export type StudioBg3dWebtoonFxOutputIntent = "beauty" | "lt-source";
export type StudioBg3dWeatherParticlePreset =
  | "rain"
  | "snow"
  | "petals"
  | "dust"
  | "embers";

export type StudioBg3dWebtoonFxPass =
  | {
    readonly kind: "toon-outline";
    readonly thicknessPx: number;
    readonly depthThreshold: number;
    readonly normalThreshold: number;
    readonly color: string;
    readonly opacity: number;
  }
  | {
    readonly kind: "depth-atmosphere";
    readonly startDepth: number;
    readonly endDepth: number;
    readonly density: number;
    readonly color: string;
    readonly opacity: number;
  }
  | {
    readonly kind: "emissive-bloom";
    readonly threshold: number;
    readonly intensity: number;
    readonly radiusPx: number;
  }
  | {
    readonly kind: "depth-of-field";
    readonly focusDepth: number;
    readonly focusRange: number;
    readonly maxBlurPx: number;
  }
  | {
    readonly kind: "weather-particles";
    readonly preset: StudioBg3dWeatherParticlePreset;
    readonly density: number;
    readonly speed: number;
    readonly sizePx: number;
    readonly wind: readonly [number, number];
    readonly seed: number;
  }
  | {
    readonly kind: "speed-lines";
    readonly density: number;
    readonly strength: number;
    readonly center: readonly [number, number];
    readonly color: string;
    readonly opacity: number;
    readonly seed: number;
  };

export interface StudioBg3dWebtoonFxCaptureRequest {
  readonly kind: "webtoon-fx-capture";
  readonly version: typeof STUDIO_BG3D_WEBTOON_FX_RECIPE_VERSION;
  readonly width: number;
  readonly height: number;
  /** Deterministic timeline sample; adapters must not read wall-clock time. */
  readonly timeSeconds: number;
  /** Deterministic base seed shared by particles and procedural screen-space effects. */
  readonly seed: number;
  readonly quality: StudioBg3dWebtoonFxQuality;
  readonly outputIntent: StudioBg3dWebtoonFxOutputIntent;
  /**
   * When present, depth is the normalized base-scene depth before screen-space FX, not particle or
   * post-process depth. LT output always requires it.
   */
  readonly includeDepth: boolean;
  readonly outputProfile: typeof STUDIO_BG3D_WEBTOON_FX_OUTPUT_PROFILE;
  readonly effects: readonly StudioBg3dWebtoonFxPass[];
}

const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/iu;
const WEATHER_PRESETS = new Set<StudioBg3dWeatherParticlePreset>([
  "rain",
  "snow",
  "petals",
  "dust",
  "embers",
]);

function finiteInRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isFinite(value) &&
    value >= minimum && value <= maximum;
}

function uint32(value: unknown): value is number {
  return Number.isSafeInteger(value) && typeof value === "number" &&
    value >= 0 && value <= 0xffff_ffff;
}

function hexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_COLOR_PATTERN.test(value);
}

function tuple2(
  value: unknown,
  minimum: number,
  maximum: number,
): readonly [number, number] | null {
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    !finiteInRange(value[0], minimum, maximum) ||
    !finiteInRange(value[1], minimum, maximum)
  ) {
    return null;
  }
  return Object.freeze([value[0], value[1]]);
}

function normalizePass(value: unknown): StudioBg3dWebtoonFxPass | null {
  if (!value || typeof value !== "object") return null;
  const pass = value as Record<string, unknown>;
  switch (pass.kind) {
    case "toon-outline":
      if (
        !finiteInRange(pass.thicknessPx, 0.25, 16) ||
        !finiteInRange(pass.depthThreshold, 0, 1) ||
        !finiteInRange(pass.normalThreshold, 0, 1) ||
        !hexColor(pass.color) ||
        !finiteInRange(pass.opacity, 0, 1)
      ) {
        return null;
      }
      return Object.freeze({
        kind: pass.kind,
        thicknessPx: pass.thicknessPx,
        depthThreshold: pass.depthThreshold,
        normalThreshold: pass.normalThreshold,
        color: pass.color.toLowerCase(),
        opacity: pass.opacity,
      });
    case "depth-atmosphere":
      if (
        !finiteInRange(pass.startDepth, 0, 1) ||
        !finiteInRange(pass.endDepth, 0, 1) ||
        pass.endDepth <= pass.startDepth ||
        !finiteInRange(pass.density, 0, 8) ||
        !hexColor(pass.color) ||
        !finiteInRange(pass.opacity, 0, 1)
      ) {
        return null;
      }
      return Object.freeze({
        kind: pass.kind,
        startDepth: pass.startDepth,
        endDepth: pass.endDepth,
        density: pass.density,
        color: pass.color.toLowerCase(),
        opacity: pass.opacity,
      });
    case "emissive-bloom":
      if (
        !finiteInRange(pass.threshold, 0, 32) ||
        !finiteInRange(pass.intensity, 0, 16) ||
        !finiteInRange(pass.radiusPx, 0, 256)
      ) {
        return null;
      }
      return Object.freeze({
        kind: pass.kind,
        threshold: pass.threshold,
        intensity: pass.intensity,
        radiusPx: pass.radiusPx,
      });
    case "depth-of-field":
      if (
        !finiteInRange(pass.focusDepth, 0, 1) ||
        !finiteInRange(pass.focusRange, 0.0001, 1) ||
        !finiteInRange(pass.maxBlurPx, 0, 128)
      ) {
        return null;
      }
      return Object.freeze({
        kind: pass.kind,
        focusDepth: pass.focusDepth,
        focusRange: pass.focusRange,
        maxBlurPx: pass.maxBlurPx,
      });
    case "weather-particles": {
      const wind = tuple2(pass.wind, -32, 32);
      if (
        !WEATHER_PRESETS.has(pass.preset as StudioBg3dWeatherParticlePreset) ||
        !finiteInRange(pass.density, 0, 1) ||
        !finiteInRange(pass.speed, 0, 32) ||
        !finiteInRange(pass.sizePx, 0.25, 128) ||
        !wind ||
        !uint32(pass.seed)
      ) {
        return null;
      }
      return Object.freeze({
        kind: pass.kind,
        preset: pass.preset as StudioBg3dWeatherParticlePreset,
        density: pass.density,
        speed: pass.speed,
        sizePx: pass.sizePx,
        wind,
        seed: pass.seed,
      });
    }
    case "speed-lines": {
      const center = tuple2(pass.center, 0, 1);
      if (
        !finiteInRange(pass.density, 0, 1) ||
        !finiteInRange(pass.strength, 0, 8) ||
        !center ||
        !hexColor(pass.color) ||
        !finiteInRange(pass.opacity, 0, 1) ||
        !uint32(pass.seed)
      ) {
        return null;
      }
      return Object.freeze({
        kind: pass.kind,
        density: pass.density,
        strength: pass.strength,
        center,
        color: pass.color.toLowerCase(),
        opacity: pass.opacity,
        seed: pass.seed,
      });
    }
    default:
      return null;
  }
}

/**
 * Copies only the canonical bounded fields. Unknown keys, getters that throw, unsupported effects,
 * NaN/Infinity, and work-amplifying values fail closed.
 */
export function normalizeStudioBg3dWebtoonFxCaptureRequest(
  value: unknown,
): StudioBg3dWebtoonFxCaptureRequest | null {
  try {
    if (!value || typeof value !== "object") return null;
    const request = value as Record<string, unknown>;
    if (
      request.kind !== "webtoon-fx-capture" ||
      request.version !== STUDIO_BG3D_WEBTOON_FX_RECIPE_VERSION ||
      !Number.isSafeInteger(request.width) ||
      !Number.isSafeInteger(request.height) ||
      (request.width as number) < 1 ||
      (request.height as number) < 1 ||
      !finiteInRange(request.timeSeconds, 0, STUDIO_BG3D_WEBTOON_FX_MAX_TIME_SECONDS) ||
      !uint32(request.seed) ||
      (request.quality !== "preview" && request.quality !== "final") ||
      (request.outputIntent !== "beauty" && request.outputIntent !== "lt-source") ||
      typeof request.includeDepth !== "boolean" ||
      request.outputProfile !== STUDIO_BG3D_WEBTOON_FX_OUTPUT_PROFILE ||
      !Array.isArray(request.effects) ||
      request.effects.length < 1 ||
      request.effects.length > STUDIO_BG3D_WEBTOON_FX_MAX_PASSES
    ) {
      return null;
    }
    const effects = request.effects.map(normalizePass);
    if (effects.some((effect) => effect === null)) return null;
    const pixels = (request.width as number) * (request.height as number);
    if (
      !Number.isSafeInteger(pixels) ||
      pixels > STUDIO_BG3D_WEBTOON_FX_MAX_FINAL_PIXELS ||
      (request.quality === "preview" && pixels > STUDIO_BG3D_WEBTOON_FX_MAX_PREVIEW_PIXELS) ||
      (
        request.outputIntent === "lt-source" &&
        (
          request.includeDepth !== true ||
          pixels > STUDIO_BG3D_WEBTOON_FX_MAX_LT_PIXELS ||
          effects.some((effect) => effect?.kind !== "toon-outline")
        )
      )
    ) {
      return null;
    }
    return Object.freeze({
      kind: request.kind,
      version: request.version,
      width: request.width as number,
      height: request.height as number,
      timeSeconds: request.timeSeconds,
      seed: request.seed,
      quality: request.quality,
      outputIntent: request.outputIntent,
      includeDepth: request.includeDepth,
      outputProfile: request.outputProfile,
      effects: Object.freeze(effects as StudioBg3dWebtoonFxPass[]),
    });
  } catch {
    return null;
  }
}
