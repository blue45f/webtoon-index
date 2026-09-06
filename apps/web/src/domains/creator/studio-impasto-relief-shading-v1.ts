/**
 * dli/paint impasto relief lighting — CPU port for the settled oil lane.
 *
 * Ported from David Li's Fluid Paint (github.com/dli/paint, MIT License,
 * © 2017 David Li, http://david.li — verbatim permission notice checked in at
 * `third_party/dli-paint/LICENSE` and embedded into
 * `dist/legal/THIRD_PARTY_NOTICES.generated.md`) `shaders/painting.frag`: Sobel
 * height→normal, GGX distribution + "GGGX" Smith-style visibility + Schlick
 * fresnel specular, and the wrapped diffuse `d·diffuseScale + (1−diffuseScale)`.
 * Default parameters are paint.js verbatim: NORMAL_SCALE 7.0 (divided by the
 * quality resolutionScale, paint.js:652), ROUGHNESS 0.075, F0 0.05,
 * SPECULAR_SCALE 0.5, DIFFUSE_SCALE 0.15, LIGHT_DIRECTION (0, 1, 1).
 *
 * Differences from the shader, by design:
 * - Pure function on typed arrays — no canvas, no GPU, deterministic.
 * - Output is a per-pixel *shading multiplier* buffer normalized so a flat
 *   tile is exactly 1.0: `shade(p) / shade(flat)`. dli composites
 *   `color·diffuse + specular·specularScale` directly into the framebuffer;
 *   a multiplier is what a Konva/canvas overlay can actually apply on top of
 *   already-painted color without owning the color pipeline.
 * - Coordinates are image-space: x = column (right), y = row (down). dli's
 *   GL default light (0, 1, 1) ("from the top of the screen") is therefore
 *   (0, −1, 1) here; that flip is applied in the exported default.
 * - A flagged 2-tap emboss fallback approximates the relief for low-power
 *   devices at two height taps per pixel instead of eight plus a BRDF.
 */

export const STUDIO_IMPASTO_RELIEF_SHADING_V1_VERSION =
  "studio-impasto-relief-shading-v1" as const;

export const STUDIO_IMPASTO_RELIEF_SHADING_PROVENANCE = Object.freeze({
  license: "MIT (dli/paint LICENSE, © 2017 David Li)",
  source:
    "dli/paint shaders/painting.frag — computeGradient/GGX/GGGX/fresnel/specularBRDF",
  parameters:
    "paint.js NORMAL_SCALE 7.0 / ROUGHNESS 0.075 / F0 0.05 / SPECULAR_SCALE 0.5 / DIFFUSE_SCALE 0.15 / LIGHT_DIRECTION (0,1,1)",
  adaptation:
    "flat-normalized shading multiplier on typed arrays; image-space y-down light; flagged 2-tap emboss fallback",
} as const);

export type StudioImpastoReliefShadingQuality = "ggx" | "emboss-2tap";

/**
 * dli LIGHT_DIRECTION (0, 1, 1) expressed in image space (y grows downward):
 * light shining from above the canvas top edge, tilted 45° toward the viewer.
 */
export const STUDIO_IMPASTO_RELIEF_LIGHT_DIRECTION_DEFAULT: readonly [
  number,
  number,
  number,
] = Object.freeze([0, -1, 1] as const);

export const STUDIO_IMPASTO_RELIEF_SHADING_DEFAULTS = Object.freeze({
  normalScale: 7.0,
  resolutionScale: 1.0,
  roughness: 0.075,
  f0: 0.05,
  specularScale: 0.5,
  diffuseScale: 0.15,
  quality: "ggx" as StudioImpastoReliefShadingQuality,
  /** Specular peaks are unbounded in the BRDF; the multiplier buffer is not. */
  maxShadingMultiplier: 4,
  heightScale: 1,
} as const);

export class StudioImpastoReliefShadingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StudioImpastoReliefShadingError";
  }
}

export interface StudioImpastoReliefShadingOptions {
  readonly width: number;
  readonly height: number;
  /** dli quality factor; the effective normal scale is `normalScale / resolutionScale`. */
  readonly resolutionScale?: number;
  readonly normalScale?: number;
  readonly roughness?: number;
  readonly f0?: number;
  readonly specularScale?: number;
  readonly diffuseScale?: number;
  /** Image-space light (x right, y down, z toward viewer). Default (0, −1, 1). */
  readonly lightDirection?: readonly [number, number, number];
  /** `"ggx"` = full dli BRDF; `"emboss-2tap"` = flagged low-power fallback. */
  readonly quality?: StudioImpastoReliefShadingQuality;
  readonly maxShadingMultiplier?: number;
  /** Extra height gain. Uint8 tiles are first normalized by 1/255. */
  readonly heightScale?: number;
  /** Optional output buffer (length must be width×height). */
  readonly into?: Float32Array;
  /**
   * Recompute only this rectangle of the tile, leaving the rest of `into` untouched.
   *
   * Every output cell here is a pure function of the height tile through a fixed stencil — a
   * 3×3 Sobel window, or two taps along the light in `emboss-2tap` — and the only other inputs
   * are option constants. There is no normalization over the data, so restricting the write
   * region does not change a single value it does write: it is the same arithmetic on the same
   * neighbourhood. That is what lets a caller holding a retained tile re-shade just the cells
   * whose neighbourhood actually moved.
   *
   * The caller owns the dilation. A cell's value depends on its NEIGHBOURS, so a region covering
   * exactly the changed height cells is one ring too small; widen it by the stencil radius (1)
   * before passing it in. Requires `into` — there is nothing to preserve without it.
   */
  readonly region?: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
}

interface ResolvedReliefOptions {
  readonly width: number;
  readonly height: number;
  readonly normalScale: number;
  readonly roughness: number;
  readonly f0: number;
  readonly specularScale: number;
  readonly diffuseScale: number;
  readonly lightX: number;
  readonly lightY: number;
  readonly lightZ: number;
  readonly quality: StudioImpastoReliefShadingQuality;
  readonly maxShadingMultiplier: number;
  readonly heightScale: number;
}

function requireFinite(name: string, value: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new StudioImpastoReliefShadingError(
      `${name} must be a finite number, got ${String(value)}`,
    );
  }
  return value;
}

function resolveOptions(
  heights: ArrayLike<number>,
  options: StudioImpastoReliefShadingOptions,
): ResolvedReliefOptions {
  const defaults = STUDIO_IMPASTO_RELIEF_SHADING_DEFAULTS;
  const width = requireFinite("options.width", options.width);
  const height = requireFinite("options.height", options.height);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new StudioImpastoReliefShadingError(
      `tile dimensions must be positive integers, got ${width}x${height}`,
    );
  }
  if (heights.length !== width * height) {
    throw new StudioImpastoReliefShadingError(
      `heights length ${heights.length} does not match ${width}x${height}`,
    );
  }
  const resolutionScale = requireFinite(
    "options.resolutionScale",
    options.resolutionScale ?? defaults.resolutionScale,
  );
  if (resolutionScale <= 0) {
    throw new StudioImpastoReliefShadingError(
      `options.resolutionScale must be positive, got ${resolutionScale}`,
    );
  }
  const quality = options.quality ?? defaults.quality;
  if (quality !== "ggx" && quality !== "emboss-2tap") {
    throw new StudioImpastoReliefShadingError(
      `options.quality must be "ggx" or "emboss-2tap", got ${String(quality)}`,
    );
  }
  const light = options.lightDirection ?? STUDIO_IMPASTO_RELIEF_LIGHT_DIRECTION_DEFAULT;
  const lightX = requireFinite("options.lightDirection[0]", light[0]);
  const lightY = requireFinite("options.lightDirection[1]", light[1]);
  const lightZ = requireFinite("options.lightDirection[2]", light[2]);
  const lightLength = Math.sqrt(lightX * lightX + lightY * lightY + lightZ * lightZ);
  if (lightLength <= 1e-9) {
    throw new StudioImpastoReliefShadingError(
      "options.lightDirection must not be the zero vector",
    );
  }
  const maxShadingMultiplier = requireFinite(
    "options.maxShadingMultiplier",
    options.maxShadingMultiplier ?? defaults.maxShadingMultiplier,
  );
  if (maxShadingMultiplier < 1) {
    throw new StudioImpastoReliefShadingError(
      `options.maxShadingMultiplier must be ≥ 1, got ${maxShadingMultiplier}`,
    );
  }
  const normalScale = requireFinite(
    "options.normalScale",
    options.normalScale ?? defaults.normalScale,
  );
  if (normalScale <= 0) {
    throw new StudioImpastoReliefShadingError(
      `options.normalScale must be positive, got ${normalScale}`,
    );
  }
  const roughness = requireFinite(
    "options.roughness",
    options.roughness ?? defaults.roughness,
  );
  if (roughness <= 0) {
    // roughness 0 makes GGX evaluate 0/0 at a perfectly aligned half vector.
    throw new StudioImpastoReliefShadingError(
      `options.roughness must be positive, got ${roughness}`,
    );
  }
  const f0 = requireFinite("options.f0", options.f0 ?? defaults.f0);
  const specularScale = requireFinite(
    "options.specularScale",
    options.specularScale ?? defaults.specularScale,
  );
  const diffuseScale = requireFinite(
    "options.diffuseScale",
    options.diffuseScale ?? defaults.diffuseScale,
  );
  if (f0 < 0 || f0 > 1 || specularScale < 0 || diffuseScale < 0 || diffuseScale > 1) {
    throw new StudioImpastoReliefShadingError(
      "options.f0/diffuseScale must be within [0, 1] and options.specularScale ≥ 0",
    );
  }
  return {
    width,
    height,
    normalScale: normalScale / resolutionScale,
    roughness,
    f0,
    specularScale,
    diffuseScale,
    lightX: lightX / lightLength,
    lightY: lightY / lightLength,
    lightZ: lightZ / lightLength,
    quality,
    maxShadingMultiplier,
    heightScale: requireFinite(
      "options.heightScale",
      options.heightScale ?? defaults.heightScale,
    ),
  };
}

function saturate(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** painting.frag `GGX(alpha, nDotH)` — Trowbridge–Reitz distribution. */
function ggxDistribution(alpha: number, nDotH: number): number {
  const a2 = alpha * alpha;
  const d = nDotH * nDotH * (a2 - 1) + 1;
  return a2 / (Math.PI * d * d);
}

/** painting.frag `GGGX(alpha, nDotL, nDotV)` — Smith-style joint visibility. */
function gggxVisibility(alpha: number, nDotL: number, nDotV: number): number {
  const a2 = alpha * alpha;
  const gl = nDotL + Math.sqrt(a2 + (1 - a2) * nDotL * nDotL);
  const gv = nDotV + Math.sqrt(a2 + (1 - a2) * nDotV * nDotV);
  return 1 / (gl * gv);
}

/** painting.frag `fresnel(F0, lDotH)` — Schlick approximation. */
function schlickFresnel(f0: number, lDotH: number): number {
  const f = (1 - lDotH) ** 5;
  return (1 - f0) * f + f0;
}

interface ReliefLightTerms {
  readonly halfX: number;
  readonly halfY: number;
  readonly halfZ: number;
  readonly fresnel: number;
}

/**
 * The light, eye and material are constant for one tile (including a dirty-region update).
 * Resolve their half vector and Schlick term once, not once per non-flat cell. Keep the
 * original arithmetic order: reassociating the specular products can change Float32 output.
 * This is call-local rather than cached across tiles, so changing lights/materials cannot
 * reuse stale values. It changes neither the Sobel stencil nor the relief work budget.
 */
function resolveLightTerms(resolved: ResolvedReliefOptions): ReliefLightTerms {
  const halfLength = Math.sqrt(
    resolved.lightX * resolved.lightX
    + resolved.lightY * resolved.lightY
    + (resolved.lightZ + 1) * (resolved.lightZ + 1),
  );
  const halfX = resolved.lightX / halfLength;
  const halfY = resolved.lightY / halfLength;
  const halfZ = (resolved.lightZ + 1) / halfLength;

  const lDotH = saturate(
    resolved.lightX * halfX + resolved.lightY * halfY + resolved.lightZ * halfZ,
  );
  return { halfX, halfY, halfZ, fresnel: schlickFresnel(resolved.f0, lDotH) };
}

/** painting.frag `specularBRDF` + wrapped diffuse, with the eye fixed at (0, 0, 1). */
function shadeNormal(
  normalX: number,
  normalY: number,
  normalZ: number,
  resolved: ResolvedReliefOptions,
  light: ReliefLightTerms,
): number {
  const nDotL = saturate(
    normalX * resolved.lightX + normalY * resolved.lightY + normalZ * resolved.lightZ,
  );
  const nDotH = saturate(normalX * light.halfX + normalY * light.halfY + normalZ * light.halfZ);
  const nDotV = saturate(normalZ);

  const diffuse = nDotL * resolved.diffuseScale + (1 - resolved.diffuseScale);
  const specular =
    ggxDistribution(resolved.roughness, nDotH)
    * gggxVisibility(resolved.roughness, nDotL, nDotV)
    * light.fresnel
    * resolved.specularScale;
  return diffuse + specular;
}

function heightAt(
  heights: ArrayLike<number>,
  width: number,
  height: number,
  x: number,
  y: number,
  scale: number,
): number {
  // CLAMP_TO_EDGE, like the shader's texture sampling.
  const cx = x < 0 ? 0 : x >= width ? width - 1 : x;
  const cy = y < 0 ? 0 : y >= height ? height - 1 : y;
  return heights[cy * width + cx]! * scale;
}

/**
 * Relief-shade one height tile into a Float32 multiplier buffer.
 *
 * `heights` is row-major (y down); Uint8 tiles are treated as height/255 like
 * dli's 8-bit alpha channel, Float32 tiles are used as-is — both then scaled
 * by `heightScale`. A flat tile maps to exactly 1.0 everywhere; every output
 * is clamped into [0, maxShadingMultiplier]. Pure and deterministic.
 */
export function computeStudioImpastoReliefShading(
  heights: Float32Array | Float64Array | Uint8Array | Uint8ClampedArray,
  options: StudioImpastoReliefShadingOptions,
): Float32Array {
  const resolved = resolveOptions(heights, options);
  const { width, height } = resolved;
  const out = options.into ?? new Float32Array(width * height);
  if (out.length !== width * height) {
    throw new StudioImpastoReliefShadingError(
      `options.into length ${out.length} does not match ${width}x${height}`,
    );
  }
  if (options.region && !options.into) {
    throw new StudioImpastoReliefShadingError(
      "options.region requires options.into: there is nothing to preserve outside the region",
    );
  }
  // Clamped rather than validated: a caller deriving a region from a dirty rectangle legitimately
  // produces one that hangs off the tile edge, and clamping is what it would have to write itself.
  const fromX = options.region ? Math.max(0, Math.floor(options.region.x)) : 0;
  const fromY = options.region ? Math.max(0, Math.floor(options.region.y)) : 0;
  const toX = options.region
    ? Math.min(width, Math.ceil(options.region.x + options.region.width))
    : width;
  const toY = options.region
    ? Math.min(height, Math.ceil(options.region.y + options.region.height))
    : height;
  if (fromX >= toX || fromY >= toY) return out;
  const scale =
    (heights instanceof Uint8Array || heights instanceof Uint8ClampedArray
      ? 1 / 255
      : 1) * resolved.heightScale;

  // Flat reference: normal (0, 0, 1). Normalizing by it pins flat paint at 1.0
  // so the multiplier is identity outside relief instead of a global dim.
  const light = resolveLightTerms(resolved);
  const flatShade = shadeNormal(0, 0, 1, resolved, light);
  const maxMultiplier = resolved.maxShadingMultiplier;

  if (resolved.quality === "emboss-2tap") {
    // Low-power fallback: two taps along the light's image-plane projection.
    // `1 + gain·(h(p−L̂) − h(p+L̂))` lights the flank whose upslope faces the
    // light, matching the GGX path's ridge orientation at a fraction of the cost.
    const planar = Math.hypot(resolved.lightX, resolved.lightY);
    if (planar <= 1e-9) {
      for (let y = fromY; y < toY; y += 1) out.fill(1, y * width + fromX, y * width + toX);
      return out;
    }
    const offsetX = Math.round(resolved.lightX / planar) | 0;
    const offsetY = Math.round(resolved.lightY / planar) | 0;
    // 8/2 matches the Sobel row weight sum over the 2px central difference, so
    // both quality modes respond to normalScale with comparable slopes.
    const gain = ((8 / 2) / resolved.normalScale) * planar;
    for (let y = fromY; y < toY; y += 1) {
      for (let x = fromX; x < toX; x += 1) {
        const toward = heightAt(heights, width, height, x - offsetX, y - offsetY, scale);
        const away = heightAt(heights, width, height, x + offsetX, y + offsetY, scale);
        const value = 1 + gain * (toward - away);
        out[y * width + x] =
          value < 0 ? 0 : value > maxMultiplier ? maxMultiplier : value;
      }
    }
    return out;
  }

  // A cell whose Sobel sums both vanish has the flat normal (0, 0, 1), so `shade` is `flatShade`
  // and the quotient is exactly one. Writing that directly skips the whole BRDF for it. It is the
  // common case by a wide margin: a stroke tile is mostly paper, and the interior of thick paint
  // is flat too — before this, an entirely empty tile cost the same 246ns per cell as a full one.
  const flatValue = 1 > maxMultiplier ? maxMultiplier : 1;

  for (let y = fromY; y < toY; y += 1) {
    // CLAMP_TO_EDGE can only bind on the tile's own border, so everything inside it reads the
    // three rows straight out of the buffer instead of re-deriving the bounds on all eight taps.
    const rowInterior = y > 0 && y + 1 < height;
    const aboveRow = (y - 1) * width;
    const middleRow = y * width;
    const belowRow = (y + 1) * width;
    for (let x = fromX; x < toX; x += 1) {
      let topLeft: number;
      let top: number;
      let topRight: number;
      let left: number;
      let right: number;
      let bottomLeft: number;
      let bottom: number;
      let bottomRight: number;
      if (rowInterior && x > 0 && x + 1 < width) {
        topLeft = heights[aboveRow + x - 1]! * scale;
        top = heights[aboveRow + x]! * scale;
        topRight = heights[aboveRow + x + 1]! * scale;
        left = heights[middleRow + x - 1]! * scale;
        right = heights[middleRow + x + 1]! * scale;
        bottomLeft = heights[belowRow + x - 1]! * scale;
        bottom = heights[belowRow + x]! * scale;
        bottomRight = heights[belowRow + x + 1]! * scale;
      } else {
        topLeft = heightAt(heights, width, height, x - 1, y - 1, scale);
        top = heightAt(heights, width, height, x, y - 1, scale);
        topRight = heightAt(heights, width, height, x + 1, y - 1, scale);
        left = heightAt(heights, width, height, x - 1, y, scale);
        right = heightAt(heights, width, height, x + 1, y, scale);
        bottomLeft = heightAt(heights, width, height, x - 1, y + 1, scale);
        bottom = heightAt(heights, width, height, x, y + 1, scale);
        bottomRight = heightAt(heights, width, height, x + 1, y + 1, scale);
      }

      // painting.frag computeGradient (Sobel), re-labelled for image space
      // (rows grow downward): gradient = (−8·∂h/∂x, −8·∂h/∂y).
      const gradientX =
        topLeft - topRight + 2 * left - 2 * right + bottomLeft - bottomRight;
      const gradientY =
        topLeft + 2 * top + topRight - bottomLeft - 2 * bottom - bottomRight;

      if (gradientX === 0 && gradientY === 0) {
        out[middleRow + x] = flatValue;
        continue;
      }

      const normalLength = Math.sqrt(
        gradientX * gradientX
        + gradientY * gradientY
        + resolved.normalScale * resolved.normalScale,
      );
      const shade = shadeNormal(
        gradientX / normalLength,
        gradientY / normalLength,
        resolved.normalScale / normalLength,
        resolved,
        light,
      );
      const value = shade / flatShade;
      out[middleRow + x] =
        value < 0 ? 0 : value > maxMultiplier ? maxMultiplier : value;
    }
  }
  return out;
}
