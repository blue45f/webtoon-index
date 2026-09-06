import {
  canonicalStudioLivingInkDisplayRgba8,
  STUDIO_LIVING_INK_EXECUTION_ENGINE_VERSION,
  STUDIO_LIVING_INK_EXECUTION_LIMITS,
  STUDIO_LIVING_INK_EXECUTION_PROTOCOL_VERSION,
  STUDIO_LIVING_INK_GRANULATION_MULTIPLIER_BOUNDS,
  STUDIO_LIVING_INK_MAXIMUM_OPTICAL_DENSITY,
  type StudioLivingInkExecutionApplyOptions,
  type StudioLivingInkExecutionApplied,
  type StudioLivingInkExecutionApplyResult,
  type StudioLivingInkExecutionCapabilities,
  type StudioLivingInkExecutionConfig,
  type StudioLivingInkExecutionFrame,
  type StudioLivingInkExecutionReceipt,
} from "./studio-living-ink-execution-protocol";
import {
  studioLivingInkChromaBleedMultipliers,
  studioLivingInkDepositionPathLength,
  studioLivingInkMeanMarkRadius,
  studioLivingInkPigmentCoatFactor,
  studioLivingInkPigmentDiffusionRates,
  studioLivingInkPigmentOpticalDensity,
  STUDIO_LIVING_INK_PIGMENT_COAT,
  STUDIO_LIVING_INK_SURFACE_COVERAGE,
  STUDIO_LIVING_INK_WHITE_GOUACHE_EXTINCTION,
  STUDIO_LIVING_INK_WHITE_GOUACHE_LOAD_GAIN,
} from "./studio-living-ink-field";
import { studioLivingInkVelocityDampingForStep } from "./studio-living-ink-wgsl-shaders";
import { sha256HexPortable } from "./studio-sha256";

import type {
  StudioLivingInkBounds,
  StudioLivingInkOperation,
  StudioLivingInkSelectionMask,
} from "./studio-living-ink-field";
import type { StudioLivingInkDisplayMode } from "./studio-living-ink-gpu-protocol";

type GlSurface = Readonly<{
  texture: WebGLTexture;
  framebuffer: WebGLFramebuffer;
  width: number;
  height: number;
}>;

type GlDoubleSurface = {
  read: GlSurface;
  write: GlSurface;
  swap: () => void;
};

type Program = Readonly<{
  program: WebGLProgram;
  uniforms: Readonly<Record<string, WebGLUniformLocation | null>>;
}>;

type ExecutionResources = Readonly<{
  mobile: GlDoubleSurface;
  /**
   * Per-request continuous capsule coverage. Marks are unioned here before one physical pigment
   * deposit is merged into `mobile`; accumulating every overlapping dab directly into pigment
   * makes long strokes reveal dark circular joints.
   */
  strokeDeposit: GlDoubleSurface;
  fixed: GlDoubleSurface;
  wet: GlDoubleSurface;
  velocity: GlDoubleSurface;
  pressure: GlDoubleSurface;
  divergence: GlSurface;
  curl: GlSurface;
  selection: GlSurface;
  /** RGBA8 staging is the portable readback/hash authority; half-float readPixels is not. */
  display: GlSurface;
}>;

type Programs = Readonly<{
  copy: Program;
  mergeDeposit: Program;
  splat: Program;
  clearMasked: Program;
  velocity: Program;
  curl: Program;
  vorticity: Program;
  divergence: Program;
  pressure: Program;
  gradient: Program;
  wet: Program;
  pigment: Program;
  exchange: Program;
  display: Program;
}>;

export const STUDIO_LIVING_INK_WEBGL2_DISPLAY_GRANULATION_SEDIMENT_GAIN = 2.35;
export const STUDIO_LIVING_INK_WEBGL2_DILUTE_SEDIMENT_RESPONSE = Object.freeze({
  additionalGain: 4.6,
  fullStrengthDensity: 0.035,
  fadeOutDensity: 0.2,
} as const);

/** CPU-readable form of the GLSL dilute-wash response, used to pin its physical density envelope. */
export function studioLivingInkWebGlDiluteSedimentBoost(centerDensity: number): number {
  if (!Number.isFinite(centerDensity)) {
    throw new RangeError("Living Ink sediment density must be finite.");
  }
  const response = STUDIO_LIVING_INK_WEBGL2_DILUTE_SEDIMENT_RESPONSE;
  const normalized = clamp(
    (centerDensity - response.fullStrengthDensity)
      / (response.fadeOutDensity - response.fullStrengthDensity),
    0,
    1,
  );
  const faded = normalized * normalized * (3 - 2 * normalized);
  return 1 + (1 - faded) * response.additionalGain;
}

export interface StudioLivingInkWebGlGranulationSample {
  readonly grain: number;
  readonly tooth: number;
  readonly granulationAmount: number;
  readonly centerDensity: number;
}

function smoothstepNumber(edge0: number, edge1: number, value: number): number {
  const normalized = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return normalized * normalized * (3 - 2 * normalized);
}

/** CPU oracle for the exact bounded multiplier embedded in the display shader. */
export function studioLivingInkWebGlGranulationMultiplier(
  sample: StudioLivingInkWebGlGranulationSample,
): number {
  for (const [name, value, minimum] of [
    ["grain", sample.grain, 0],
    ["tooth", sample.tooth, 0],
    ["granulationAmount", sample.granulationAmount, 0],
    ["centerDensity", sample.centerDensity, 0],
  ] as const) {
    const maximum = name === "centerDensity" ? Number.POSITIVE_INFINITY : 1;
    if (!Number.isFinite(value) || value < minimum || value > maximum) {
      throw new RangeError(`Living Ink ${name} is outside its physical range.`);
    }
  }
  const granulationGate = smoothstepNumber(0.005, 0.24, sample.centerDensity)
    * (1 - smoothstepNumber(0.38, 1.15, sample.centerDensity) * 0.74);
  const sediment = (sample.grain - 0.5) * 2 + (sample.tooth - 0.5) * 0.7;
  const rawMultiplier = 1
    + sediment * sample.granulationAmount
      * STUDIO_LIVING_INK_WEBGL2_DISPLAY_GRANULATION_SEDIMENT_GAIN
      * granulationGate
      * studioLivingInkWebGlDiluteSedimentBoost(sample.centerDensity);
  return clamp(
    rawMultiplier,
    STUDIO_LIVING_INK_GRANULATION_MULTIPLIER_BOUNDS.minimum,
    STUDIO_LIVING_INK_GRANULATION_MULTIPLIER_BOUNDS.maximum,
  );
}

const FULLSCREEN_VERTEX = `#version 300 es
precision highp float;
layout(location=0) in vec2 position;
out vec2 uv;
void main(){
  uv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}`;

const COPY_FRAGMENT = `#version 300 es
precision highp float;
in vec2 uv; out vec4 outColor;
uniform sampler2D sourceTexture;
uniform float multiplier;
void main(){ outColor = texture(sourceTexture, uv) * multiplier; }`;

const MERGE_DEPOSIT_FRAGMENT = `#version 300 es
precision highp float;
in vec2 uv; out vec4 outColor;
uniform sampler2D baseTexture;
uniform sampler2D depositTexture;
void main(){
  outColor = max(texture(baseTexture, uv), vec4(0.0))
    + max(texture(depositTexture, uv), vec4(0.0));
}`;

const SPLAT_FRAGMENT = `#version 300 es
precision highp float;
in vec2 uv; out vec4 outColor;
uniform sampler2D sourceTexture;
uniform sampler2D selectionTexture;
uniform vec2 start;
uniform vec2 center;
uniform vec4 startAmount;
uniform vec4 amount;
uniform float startRadius;
uniform float radius;
uniform float aspect;
uniform float selectionEnabled;
uniform float maximumBlend;
uniform float falloff;
uniform float radialVector;
void main(){
  vec2 point = uv;
  vec2 from = start;
  vec2 to = center;
  point.x *= aspect;
  from.x *= aspect;
  to.x *= aspect;
  vec2 segment = to - from;
  float along = clamp(dot(point - from, segment) / max(dot(segment, segment), 1e-9), 0.0, 1.0);
  vec2 delta = point - (from + segment * along);
  float localRadius = mix(startRadius, radius, along);
  vec4 localAmount = mix(startAmount, amount, along);
  float normalizedDistance = dot(delta, delta) / max(localRadius * localRadius, 1e-9);
  float gaussian = exp(-falloff * normalizedDistance);
  float mask = mix(1.0, texture(selectionTexture, uv).r, selectionEnabled);
  vec4 source = texture(sourceTexture, uv);
  vec2 radialDirection = normalize(delta + vec2(1e-7));
  vec4 deposited = radialVector > 0.5
    ? vec4(radialDirection * localAmount.x, 0.0, 0.0) * gaussian * mask
    : localAmount * gaussian * mask;
  outColor = maximumBlend > 0.5 ? max(source, deposited) : source + deposited;
}`;

const CLEAR_MASKED_FRAGMENT = `#version 300 es
precision highp float;
in vec2 uv; out vec4 outColor;
uniform sampler2D sourceTexture;
uniform sampler2D selectionTexture;
void main(){
  float keep = 1.0 - clamp(texture(selectionTexture, uv).r, 0.0, 1.0);
  outColor = texture(sourceTexture, uv) * keep;
}`;

const VELOCITY_FRAGMENT = `#version 300 es
precision highp float;
in vec2 uv; out vec4 outColor;
uniform sampler2D velocityTexture;
uniform sampler2D wetTexture;
uniform float dt;
uniform float damping;
void main(){
  vec2 currentVelocity = texture(velocityTexture, uv).xy;
  vec2 origin = clamp(uv - currentVelocity * dt, vec2(0.0), vec2(1.0));
  vec2 transported = texture(velocityTexture, origin).xy;
  float wetness = texture(wetTexture, uv).r;
  float wetGate = smoothstep(0.004, 0.24, wetness);
  outColor = vec4(transported * damping * wetGate, 0.0, 1.0);
}`;

const CURL_FRAGMENT = `#version 300 es
precision highp float;
in vec2 uv; out vec4 outColor;
uniform sampler2D velocityTexture;
uniform vec2 texel;
void main(){
  float leftY = texture(velocityTexture, uv - vec2(texel.x, 0.0)).y;
  float rightY = texture(velocityTexture, uv + vec2(texel.x, 0.0)).y;
  float lowerX = texture(velocityTexture, uv - vec2(0.0, texel.y)).x;
  float upperX = texture(velocityTexture, uv + vec2(0.0, texel.y)).x;
  outColor = vec4(0.5 * ((rightY - leftY) - (upperX - lowerX)), 0.0, 0.0, 1.0);
}`;

const VORTICITY_FRAGMENT = `#version 300 es
precision highp float;
in vec2 uv; out vec4 outColor;
uniform sampler2D velocityTexture;
uniform sampler2D curlTexture;
uniform vec2 texel;
uniform float dt;
uniform float strength;
void main(){
  float centerCurl = texture(curlTexture, uv).r;
  float left = abs(texture(curlTexture, uv - vec2(texel.x, 0.0)).r);
  float right = abs(texture(curlTexture, uv + vec2(texel.x, 0.0)).r);
  float lower = abs(texture(curlTexture, uv - vec2(0.0, texel.y)).r);
  float upper = abs(texture(curlTexture, uv + vec2(0.0, texel.y)).r);
  vec2 ridge = vec2(upper - lower, right - left);
  ridge /= max(length(ridge), 1e-5);
  vec2 force = vec2(ridge.x, -ridge.y) * centerCurl * strength;
  vec2 velocity = texture(velocityTexture, uv).xy + force * dt;
  outColor = vec4(clamp(velocity, vec2(-3.0), vec2(3.0)), 0.0, 1.0);
}`;

const DIVERGENCE_FRAGMENT = `#version 300 es
precision highp float;
in vec2 uv; out vec4 outColor;
uniform sampler2D velocityTexture;
uniform vec2 texel;
void main(){
  float left = texture(velocityTexture, uv - vec2(texel.x, 0.0)).x;
  float right = texture(velocityTexture, uv + vec2(texel.x, 0.0)).x;
  float lower = texture(velocityTexture, uv - vec2(0.0, texel.y)).y;
  float upper = texture(velocityTexture, uv + vec2(0.0, texel.y)).y;
  outColor = vec4(0.5 * (right - left + upper - lower), 0.0, 0.0, 1.0);
}`;

const PRESSURE_FRAGMENT = `#version 300 es
precision highp float;
in vec2 uv; out vec4 outColor;
uniform sampler2D pressureTexture;
uniform sampler2D divergenceTexture;
uniform vec2 texel;
void main(){
  float left = texture(pressureTexture, uv - vec2(texel.x, 0.0)).r;
  float right = texture(pressureTexture, uv + vec2(texel.x, 0.0)).r;
  float lower = texture(pressureTexture, uv - vec2(0.0, texel.y)).r;
  float upper = texture(pressureTexture, uv + vec2(0.0, texel.y)).r;
  float divergence = texture(divergenceTexture, uv).r;
  outColor = vec4((left + right + lower + upper - divergence) * 0.25, 0.0, 0.0, 1.0);
}`;

const GRADIENT_FRAGMENT = `#version 300 es
precision highp float;
in vec2 uv; out vec4 outColor;
uniform sampler2D velocityTexture;
uniform sampler2D pressureTexture;
uniform vec2 texel;
void main(){
  float left = texture(pressureTexture, uv - vec2(texel.x, 0.0)).r;
  float right = texture(pressureTexture, uv + vec2(texel.x, 0.0)).r;
  float lower = texture(pressureTexture, uv - vec2(0.0, texel.y)).r;
  float upper = texture(pressureTexture, uv + vec2(0.0, texel.y)).r;
  vec2 velocity = texture(velocityTexture, uv).xy - 0.5 * vec2(right - left, upper - lower);
  outColor = vec4(velocity, 0.0, 1.0);
}`;

const WET_FRAGMENT = `#version 300 es
precision highp float;
in vec2 uv; out vec4 outColor;
uniform sampler2D wetTexture;
uniform sampler2D velocityTexture;
uniform vec2 fineTexel;
uniform float dt;
uniform float evaporation;
uniform float creep;
uniform float fiberAnisotropy;
uniform float seed;
void main(){
  vec2 velocity = texture(velocityTexture, uv).xy;
  vec2 origin = clamp(uv - velocity * dt * 0.6, vec2(0.0), vec2(1.0));
  float center = texture(wetTexture, origin).r;
  // Slowly varying paper fibres make capillary spread elongated but continuous. Sampling a fibre
  // axis plus its perpendicular avoids grid diamonds and exposes real paper-direction response.
  vec2 fieldSize = 1.0 / fineTexel;
  vec2 fibreCell = floor(uv * fieldSize / 28.0);
  float fibreNoise = fract(sin(dot(fibreCell + seed, vec2(41.73, 97.11))) * 43758.5453);
  float fibreAngle = (fibreNoise - 0.5) * 1.4 + 0.34;
  vec2 fibre = vec2(cos(fibreAngle), sin(fibreAngle));
  vec2 perpendicular = vec2(-fibre.y, fibre.x);
  vec2 parallelReach = fibre * fineTexel * (1.0 + creep * (3.0 + 3.0 * fiberAnisotropy));
  vec2 perpendicularReach = perpendicular * fineTexel * (1.0 + creep * 1.6);
  vec2 farParallelReach = parallelReach * 1.4;
  vec2 farPerpendicularReach = perpendicularReach * 1.25;
  float parallelWeight = 0.5 + fiberAnisotropy * 0.22;
  float perpendicularWeight = 1.0 - parallelWeight;
  float neighborhood = parallelWeight * 0.5 * (
    texture(wetTexture, origin + parallelReach).r +
    texture(wetTexture, origin - parallelReach).r
  ) + perpendicularWeight * 0.5 * (
    texture(wetTexture, origin + perpendicularReach).r +
    texture(wetTexture, origin - perpendicularReach).r
  );
  float frontierSource = max(max(
    texture(wetTexture, origin + farParallelReach).r,
    texture(wetTexture, origin - farParallelReach).r
  ), max(
    texture(wetTexture, origin + farPerpendicularReach).r,
    texture(wetTexture, origin - farPerpendicularReach).r
  ));
  // Porous paper advances a continuous capillary front. A bounded maximum-principle source grows
  // the wet boundary without stamping circles or creating the square/diamond diffusion of a
  // four-neighbour Laplacian.
  float frontAdvance = max(0.0, frontierSource - center)
    * creep * (0.105 + fiberAnisotropy * 0.045);
  float capillary = mix(center, neighborhood, clamp(creep * 0.29, 0.0, 0.38))
    + frontAdvance;
  outColor = vec4(clamp(capillary * evaporation, 0.0, 4.0), 0.0, 0.0, 1.0);
}`;

const PIGMENT_FRAGMENT = `#version 300 es
precision highp float;
in vec2 uv; out vec4 outColor;
uniform sampler2D pigmentTexture;
uniform sampler2D wetTexture;
uniform sampler2D velocityTexture;
uniform vec2 fineTexel;
uniform float dt;
uniform float bleed;
uniform float chromatography;
uniform float capillaryTransport;
uniform float edgeDeposition;
// Active brush footprint (uv center + radius in aspect-corrected space). radius <= 0 disables.
uniform vec3 brushFootprint;
uniform float aspect;
// Channel bleed rates from studioLivingInkChromaBleedMultipliers / pigmentDiffusionRates (TS).
uniform vec3 chromaMultipliers;
uniform vec4 separatedDiffusionQuiet;
uniform vec4 separatedDiffusionTip;
void main(){
  vec4 current = texture(pigmentTexture, uv);
  float wetness = texture(wetTexture, uv).r;
  float mobility = smoothstep(0.015, 0.46, wetness);
  if (mobility < 0.001){ outColor = current; return; }
  vec2 velocity = texture(velocityTexture, uv).xy;
  float wetLeft = texture(wetTexture, uv - vec2(fineTexel.x, 0.0)).r;
  float wetRight = texture(wetTexture, uv + vec2(fineTexel.x, 0.0)).r;
  float wetLower = texture(wetTexture, uv - vec2(0.0, fineTexel.y)).r;
  float wetUpper = texture(wetTexture, uv + vec2(0.0, fineTexel.y)).r;
  vec2 wetGradient = 0.5 * vec2(wetRight - wetLeft, wetUpper - wetLower);
  vec2 towardWetCenter = normalize(wetGradient + vec2(1e-6));
  float capillaryReach = 0.22 + capillaryTransport * 0.68;
  vec2 capillaryBacktrace = towardWetCenter * fineTexel * capillaryReach * mobility;
  vec2 baseOrigin = clamp(
    uv - velocity * dt * mobility + capillaryBacktrace,
    vec2(0.0),
    vec2(1.0)
  );
  // InkWash §06 chemistry: channel-asymmetric advection samples + TS-uploaded diffusion rates so
  // wet edges chromatograph into a dark core with a cool halo rather than a monochrome blur.
  float C = clamp(chromatography, 0.0, 1.0);
  vec3 chroma = chromaMultipliers;
  vec2 separationDirection = normalize(velocity + wetGradient * 4.0 + vec2(1e-5));
  vec2 chromaShift = separationDirection
    * fineTexel * C * mobility * dt * 20.0;
  float red = texture(pigmentTexture, clamp(baseOrigin - chromaShift * chroma.r, vec2(0.0), vec2(1.0))).r;
  float green = texture(pigmentTexture, clamp(baseOrigin - chromaShift * chroma.g * 0.15, vec2(0.0), vec2(1.0))).g;
  float blue = texture(pigmentTexture, clamp(baseOrigin + chromaShift * chroma.b * 1.35, vec2(0.0), vec2(1.0))).b;
  float white = texture(pigmentTexture, baseOrigin).a;
  vec4 transported = vec4(red, green, blue, white);
  vec2 axialTexel = fineTexel * (1.0 + bleed * 3.8);
  vec2 diagonalTexel = axialTexel * 0.70710678;
  vec4 axialNeighbors = 0.25 * (
    texture(pigmentTexture, baseOrigin + vec2(axialTexel.x, 0.0)) +
    texture(pigmentTexture, baseOrigin - vec2(axialTexel.x, 0.0)) +
    texture(pigmentTexture, baseOrigin + vec2(0.0, axialTexel.y)) +
    texture(pigmentTexture, baseOrigin - vec2(0.0, axialTexel.y))
  );
  vec4 diagonalNeighbors = 0.25 * (
    texture(pigmentTexture, baseOrigin + diagonalTexel) +
    texture(pigmentTexture, baseOrigin + vec2(diagonalTexel.x, -diagonalTexel.y)) +
    texture(pigmentTexture, baseOrigin + vec2(-diagonalTexel.x, diagonalTexel.y)) +
    texture(pigmentTexture, baseOrigin - diagonalTexel)
  );
  vec4 neighbors = mix(axialNeighbors, diagonalNeighbors, 0.5);
  // Scrubbing under the active brush accelerates bleed. Rates are computed in TS
  // (studioLivingInkPigmentDiffusionRates) for footprint 0 and 1, then mixed by the tip gaussian.
  float brush = 0.0;
  if (brushFootprint.z > 0.0){
    vec2 brushDelta = uv - brushFootprint.xy;
    brushDelta.x *= aspect;
    brush = exp(-dot(brushDelta, brushDelta) / max(brushFootprint.z * brushFootprint.z, 1e-8));
  }
  // Rates are precomputed at mobility=1; scale by local wet mobility so dry paper stays frozen.
  vec4 separatedDiffusion = clamp(
    mix(separatedDiffusionQuiet, separatedDiffusionTip, brush) * mobility,
    vec4(0.0),
    vec4(0.92)
  );
  vec4 evolved = mix(transported, neighbors, separatedDiffusion);
  float wetGradientStrength = length(wetGradient);
  float evaporationFront = smoothstep(0.004, 0.095, wetness)
    * (1.0 - smoothstep(0.18, 0.62, wetness));
  float edgePool = edgeDeposition * evaporationFront
    * (1.0 + clamp(wetGradientStrength * 18.0, 0.0, 1.8));
  evolved.rgb *= 1.0 + edgePool * dt * 2.4;
  float saturatedWashCenter = smoothstep(0.26, 0.7, wetness);
  evolved.rgb *= 1.0 - bleed * saturatedWashCenter * dt * 0.42;
  // Deegan transport (the "coffee ring") — why a dwell mark must empty its own centre.
  // capillaryBacktrace above already carries pigment down the wetness gradient: water leaving the
  // puddle to replace what evaporates at the pinned front drags its suspended pigment outward.
  // But pigment here is an *areal density*, and semi-Lagrangian advection transports a sampled
  // value, which silently drops the compressibility term of the conservation law
  //   dc/dt = -c * div(u).
  // For a radial dwell flow div(u) > 0 everywhere inside the front (the same annulus of water
  // spreads over a larger circumference), so omitting it is exactly what leaves the darkest
  // pigment sitting dead centre and reads as an ink dot instead of a wash. The velocity solver
  // cannot supply this term either: an evaporation-driven flux is divergent by construction —
  // mass leaves the film as vapour, not sideways — and pressure projection deletes precisely that
  // component. So it belongs here, on the pigment field.
  //
  // The divergence of that displacement field d = A*n is available almost for free, and it splits
  // into exactly the two things a wash does:
  //   div(d) = A * div(n)      geometric spreading — the same ring of water covers a longer
  //                            circumference as it moves out, so the interior thins. This is the
  //                            term that stops a dwell mark from reading as a dot.
  //          + grad(A) . n     deceleration — transport weakens as the film thins toward the
  //                            front, so pigment piles into the drying edge (the hard rim).
  // div(n) is the curvature of the wet level set, (laplacian(wet) - d2wet/dn2) / |grad wet|, and
  // equals -1/r around a round dwell mark, so it is singular at the crest of a puddle. The bound
  // below is not cosmetic: the wet pass advances its capillary front with a stencil several texels
  // wide (parallelReach and its far probe), so a front curvature tighter than roughly twice that
  // reach is not represented in the wetness field at all — measuring it there returns paper grain,
  // not surface shape, and would turn fibre noise into a pigment sink.
  // grad(A).n reduces to reach * dMobility/dWet * |grad wet|, because A varies only through the
  // mobility ramp and n is the unit wetness gradient.
  float wetLaplacian = wetLeft + wetRight + wetLower + wetUpper - 4.0 * wetness;
  vec2 frontNormalStep = towardWetCenter * fineTexel;
  float wetSecondDerivativeAlongNormal =
    texture(wetTexture, clamp(uv + frontNormalStep, vec2(0.0), vec2(1.0))).r
    + texture(wetTexture, clamp(uv - frontNormalStep, vec2(0.0), vec2(1.0))).r
    - 2.0 * wetness;
  float resolvedFrontCurvature = 0.08;
  float frontCurvature = clamp(
    (wetLaplacian - wetSecondDerivativeAlongNormal) / max(wetGradientStrength, 1e-5),
    -resolvedFrontCurvature,
    resolvedFrontCurvature
  );
  float mobilityRamp = clamp((wetness - 0.015) / 0.445, 0.0, 1.0);
  float mobilitySlope = 6.0 * mobilityRamp * (1.0 - mobilityRamp) / 0.445;
  float displacementDivergence = capillaryReach
    * (mobility * frontCurvature + mobilitySlope * wetGradientStrength);
  evolved.rgb *= clamp(1.0 + displacementDivergence, 0.8, 1.3);
  // Advection is a rate over the fixed step. Replacing most of the pigment texture every tick
  // bleaches the water path and piles all colour at the two ends of a stroke. A dt-scaled blend
  // retains resident pigment while still moving a bounded fraction toward the capillary front.
  float transportBlend = clamp(mobility * dt * (6.0 + bleed * 9.0), 0.0, 0.24);
  outColor = mix(current, evolved, transportBlend);
}`;

const EXCHANGE_FRAGMENT = `#version 300 es
precision highp float;
in vec2 uv; out vec4 outColor;
uniform sampler2D mobileTexture;
uniform sampler2D fixedTexture;
uniform sampler2D selectionTexture;
uniform float settle;
uniform float outputFixed;
uniform float selectionEnabled;
void main(){
  vec4 mobile = max(texture(mobileTexture, uv), vec4(0.0));
  vec4 fixedPigment = max(texture(fixedTexture, uv), vec4(0.0));
  float coverage = mix(1.0, texture(selectionTexture, uv).r, selectionEnabled);
  float accepted = clamp(settle * coverage, 0.0, 1.0);
  if (outputFixed > 0.5){
    vec3 darkDeposit = mobile.rgb * accepted;
    float whiteDeposit = mobile.a * accepted;
    vec3 previousTransmittance = exp(-fixedPigment.rgb);
    float bleachCoverage = 1.0 - exp(-${STUDIO_LIVING_INK_WHITE_GOUACHE_EXTINCTION} * whiteDeposit);
    vec3 bleached = mix(previousTransmittance, vec3(1.0), clamp(bleachCoverage, 0.0, 1.0));
    vec3 fixedDensity = -log(clamp(bleached, vec3(1e-5), vec3(1.0))) + darkDeposit;
    outColor = vec4(fixedDensity, fixedPigment.a * (1.0 - accepted));
  } else {
    outColor = mobile * (1.0 - accepted);
  }
}`;

const DISPLAY_FRAGMENT = `#version 300 es
precision highp float;
in vec2 uv; out vec4 outColor;
uniform sampler2D mobileTexture;
uniform sampler2D fixedTexture;
uniform sampler2D wetTexture;
uniform sampler2D velocityTexture;
uniform vec2 fineTexel;
uniform vec2 displayResolution;
uniform float densityStrength;
uniform float fiberAmount;
uniform float toothAmount;
uniform float granulationAmount;
uniform float chromatographyAmount;
uniform float edgeAmount;
uniform float wetSheenAmount;
uniform float vignetteAmount;
uniform float seed;
uniform float displayMode;

float randomCell(vec2 cell){
  return fract(sin(dot(cell + seed, vec2(91.17, 17.31))) * 43758.5453);
}
float smoothNoise(vec2 point){
  vec2 cell = floor(point);
  vec2 local = fract(point);
  local = local * local * (3.0 - 2.0 * local);
  float a = randomCell(cell);
  float b = randomCell(cell + vec2(1.0, 0.0));
  float c = randomCell(cell + vec2(0.0, 1.0));
  float d = randomCell(cell + vec2(1.0, 1.0));
  return mix(mix(a, b, local.x), mix(c, d, local.x), local.y);
}
float layeredFiber(vec2 point){
  float result = 0.0;
  float amplitude = 0.55;
  for (int octave = 0; octave < 4; octave++){
    result += amplitude * smoothNoise(point);
    point = point * 2.03 + vec2(11.7, 3.9);
    amplitude *= 0.48;
  }
  return result;
}
vec4 mobilePigment(vec2 point){
  return displayMode > 1.5 ? vec4(0.0) : max(texture(mobileTexture, point), vec4(0.0));
}
vec4 fixedPigmentAt(vec2 point){
  return displayMode > 0.5 && displayMode < 1.5
    ? vec4(0.0)
    : max(texture(fixedTexture, point), vec4(0.0));
}
void main(){
  float wetness = max(0.0, texture(wetTexture, uv).r);
  if (displayMode > 3.5){
    vec2 velocity = texture(velocityTexture, uv).xy;
    outColor = vec4(clamp(vec3(0.5 + velocity.x * 0.35, 0.5 + velocity.y * 0.35, length(velocity)), 0.0, 1.0), 1.0);
    return;
  }
  if (displayMode > 2.5){
    outColor = vec4(vec3(clamp(wetness, 0.0, 1.0)), 1.0);
    return;
  }
  vec4 mobileContribution = mobilePigment(uv);
  vec4 fixedContribution = fixedPigmentAt(uv);
  vec4 combined = fixedContribution + mobileContribution;
  if (displayMode < 0.5 && wetness > 0.01){
    // Reconstruct the capillary plume from the authoritative mobile field at display time. The
    // rotated eight-tap kernel follows the local paper direction, avoiding both square Gaussian
    // blur and the circular dab joints of a stamp renderer.
    vec2 fieldPixel = uv / fineTexel;
    float plumeAngle = (smoothNoise(fieldPixel * 0.021 + vec2(23.0, 71.0)) - 0.5) * 1.7;
    vec2 axis = vec2(cos(plumeAngle), sin(plumeAngle));
    vec2 crossAxis = vec2(-axis.y, axis.x);
    float plumeRadius = (4.0 + smoothstep(0.025, 0.7, wetness) * 27.0)
      * mix(0.8, 1.2, smoothNoise(fieldPixel * 0.057 + vec2(3.0, 47.0)));
    vec2 plumeWarp = vec2(
      smoothNoise(fieldPixel * 0.039 + vec2(79.0, 13.0)) - 0.5,
      smoothNoise(fieldPixel * 0.043 + vec2(17.0, 101.0)) - 0.5
    ) * fineTexel * plumeRadius * 0.42;
    // A real wet edge does not expand as a mirror-symmetric lens. Two low-frequency curls plus a
    // bounded vertical paper drift place three deterministic, overlapping capillary lobes. The
    // frequencies stay well below dab spacing, so this changes the wash silhouette without adding
    // isolated dots, noisy scallops or frame-to-frame randomness.
    float lobeWaveA = sin(fieldPixel.x * 0.071 + fieldPixel.y * 0.019 + seed * 0.017);
    float lobeWaveB = sin(fieldPixel.x * 0.033 - fieldPixel.y * 0.027 + seed * 0.031 + 1.7);
    float verticalDrift = 0.14 + lobeWaveA * 0.17 + lobeWaveB * 0.09;
    plumeWarp += vec2(
      fineTexel.x * plumeRadius * lobeWaveB * 0.08,
      fineTexel.y * plumeRadius * verticalDrift
    );
    vec2 plumeUv = clamp(uv + plumeWarp, vec2(0.0), vec2(1.0));
    vec2 a = axis * fineTexel * plumeRadius;
    vec2 b = crossAxis * fineTexel * plumeRadius * 0.96;
    vec2 diagonalA = (a + b) * 0.70710678;
    vec2 diagonalB = (a - b) * 0.70710678;
    vec4 mobileCenter = mobileContribution;
    vec4 nearPlume = 0.125 * (
      texture(mobileTexture, clamp(plumeUv + a * 0.48, vec2(0.0), vec2(1.0))) +
      texture(mobileTexture, clamp(plumeUv - a * 0.48, vec2(0.0), vec2(1.0))) +
      texture(mobileTexture, clamp(plumeUv + b * 0.48, vec2(0.0), vec2(1.0))) +
      texture(mobileTexture, clamp(plumeUv - b * 0.48, vec2(0.0), vec2(1.0))) +
      texture(mobileTexture, clamp(plumeUv + diagonalA * 0.58, vec2(0.0), vec2(1.0))) +
      texture(mobileTexture, clamp(plumeUv - diagonalA * 0.58, vec2(0.0), vec2(1.0))) +
      texture(mobileTexture, clamp(plumeUv + diagonalB * 0.58, vec2(0.0), vec2(1.0))) +
      texture(mobileTexture, clamp(plumeUv - diagonalB * 0.58, vec2(0.0), vec2(1.0)))
    );
    vec4 farPlume = 0.25 * (
      texture(mobileTexture, clamp(plumeUv + a, vec2(0.0), vec2(1.0))) +
      texture(mobileTexture, clamp(plumeUv - a, vec2(0.0), vec2(1.0))) +
      texture(mobileTexture, clamp(plumeUv + b, vec2(0.0), vec2(1.0))) +
      texture(mobileTexture, clamp(plumeUv - b, vec2(0.0), vec2(1.0)))
    );
    vec2 lobeOffsetA = fineTexel * plumeRadius
      * vec2(0.34 + lobeWaveB * 0.08, -0.18 + lobeWaveA * 0.1);
    vec2 lobeOffsetB = fineTexel * plumeRadius
      * vec2(-0.23 + lobeWaveA * 0.07, 0.31 + lobeWaveB * 0.08);
    vec2 lobeOffsetC = fineTexel * plumeRadius
      * vec2(0.08 + lobeWaveB * 0.05, 0.48 + lobeWaveA * 0.06);
    vec4 lobePlume =
      texture(mobileTexture, clamp(plumeUv + lobeOffsetA, vec2(0.0), vec2(1.0))) * 0.42 +
      texture(mobileTexture, clamp(plumeUv + lobeOffsetB, vec2(0.0), vec2(1.0))) * 0.34 +
      texture(mobileTexture, clamp(plumeUv + lobeOffsetC, vec2(0.0), vec2(1.0))) * 0.24;
    // Smooth energy reconstruction removes the star/ridge faceting of a peak/max kernel. Paper
    // granulation is applied afterwards, so texture remains organic without encoding tap geometry.
    float lobeGain = 0.73 + lobeWaveA * 0.1 + lobeWaveB * 0.06;
    vec4 plume = max(
      mobileCenter * 0.9,
      nearPlume * 2.76 + farPlume * 1.02 + lobePlume * lobeGain
    );
    // Preserve the physical channel separation after broad plume reconstruction. Two bounded
    // channel-biased lobe probes keep the fringe spatial (rather than merely tinting the wash)
    // without producing a synthetic rainbow edge.
    vec2 chromaCurl = normalize(axis * 0.82 + crossAxis * 0.57)
      * fineTexel * plumeRadius * (0.15 + chromatographyAmount * 0.5);
    float redLobe = texture(
      mobileTexture,
      clamp(plumeUv + lobeOffsetA + chromaCurl, vec2(0.0), vec2(1.0))
    ).r;
    float blueLobe = texture(
      mobileTexture,
      clamp(plumeUv + lobeOffsetB - chromaCurl, vec2(0.0), vec2(1.0))
    ).b;
    plume.r += redLobe * chromatographyAmount * 1.05;
    plume.b += blueLobe * chromatographyAmount * 1.05;
    float plumeGate = smoothstep(0.018, 0.58, wetness) * 0.9;
    mobileContribution = mix(mobileCenter, plume, plumeGate);
    float saturatedCenterDilution = smoothstep(0.3, 1.1, wetness) * 0.64;
    mobileContribution.rgb *= 1.0 - saturatedCenterDilution;
    // Water may continue changing the paper and mobile pigment after Fix, but it must never
    // bleach the immutable fixed well. Compose fixed pigment only after every wet-dependent
    // plume and dilution operation has finished.
    combined = fixedContribution + mobileContribution;
  }
  if (displayMode > 0.5) wetness = 0.0;
  float centerDensity = dot(combined.rgb, vec3(0.333333));
  float mobileCenterDensity = dot(mobileContribution.rgb, vec3(0.333333));
  float mobileLeft = dot(mobilePigment(uv - vec2(fineTexel.x, 0.0)).rgb, vec3(0.333333));
  float mobileRight = dot(mobilePigment(uv + vec2(fineTexel.x, 0.0)).rgb, vec3(0.333333));
  float mobileLower = dot(mobilePigment(uv - vec2(0.0, fineTexel.y)).rgb, vec3(0.333333));
  float mobileUpper = dot(mobilePigment(uv + vec2(0.0, fineTexel.y)).rgb, vec3(0.333333));
  float mobilePigmentEdge = length(vec2(
    mobileRight - mobileLeft,
    mobileUpper - mobileLower
  ));
  float fixedLeft = dot(fixedPigmentAt(uv - vec2(fineTexel.x, 0.0)).rgb, vec3(0.333333));
  float fixedRight = dot(fixedPigmentAt(uv + vec2(fineTexel.x, 0.0)).rgb, vec3(0.333333));
  float fixedLower = dot(fixedPigmentAt(uv - vec2(0.0, fineTexel.y)).rgb, vec3(0.333333));
  float fixedUpper = dot(fixedPigmentAt(uv + vec2(0.0, fineTexel.y)).rgb, vec3(0.333333));
  float fixedPigmentEdge = length(vec2(fixedRight - fixedLeft, fixedUpper - fixedLower));
  vec2 pixel = uv * displayResolution;
  float fiber = layeredFiber(pixel * vec2(0.035, 0.085));
  float tooth = smoothNoise(pixel * 0.31 + vec2(7.3, 19.1));
  float grain = layeredFiber(pixel * 0.105 + vec2(41.0, 13.0));
  float coarseTooth = layeredFiber(pixel * vec2(0.017, 0.026) + vec2(5.7, 31.0));
  float microTooth = randomCell(floor(pixel * 0.92));
  vec3 paper = vec3(0.965, 0.956, 0.932);
  // Two-scale directional paper is visible on an empty page and therefore measurable instead of
  // being a pigment-only cosmetic effect. The amplitudes stay below one display code value when
  // users turn both material controls down to zero.
  paper -= (fiber - 0.5) * 0.12 * fiberAmount;
  paper -= (tooth - 0.5) * 0.085 * toothAmount;
  paper -= (coarseTooth - 0.5) * 0.05 * (0.35 + fiberAmount * 0.65);
  paper -= (microTooth - 0.5) * 0.05 * toothAmount;
  vec3 fixedOpticalDensity = fixedContribution.rgb * densityStrength;
  vec3 mobileOpticalDensity = mobileContribution.rgb * densityStrength;
  float granulationGate = smoothstep(0.005, 0.24, centerDensity)
    * (1.0 - smoothstep(0.38, 1.15, centerDensity) * 0.74);
  // Dilute radial washes expose pigment/fibre separation that concentrated ink optically masks.
  // Boost sediment while pigment is sparse, then return exactly to the shared baseline before a
  // dark continuous stroke reaches its centre density so paper tooth cannot cut periodic gaps.
  float diluteSedimentBoost = 1.0 + (
    1.0 - smoothstep(
      ${STUDIO_LIVING_INK_WEBGL2_DILUTE_SEDIMENT_RESPONSE.fullStrengthDensity.toFixed(3)},
      ${STUDIO_LIVING_INK_WEBGL2_DILUTE_SEDIMENT_RESPONSE.fadeOutDensity.toFixed(3)},
      centerDensity
    )
  ) * ${STUDIO_LIVING_INK_WEBGL2_DILUTE_SEDIMENT_RESPONSE.additionalGain.toFixed(2)};
  float sediment = (grain - 0.5) * 2.0 + (tooth - 0.5) * 0.7;
  float granulationMultiplier = clamp(
    1.0
      + sediment * granulationAmount
        * ${STUDIO_LIVING_INK_WEBGL2_DISPLAY_GRANULATION_SEDIMENT_GAIN.toFixed(2)}
        * granulationGate
        * diluteSedimentBoost,
    ${STUDIO_LIVING_INK_GRANULATION_MULTIPLIER_BOUNDS.minimum.toFixed(4)},
    ${STUDIO_LIVING_INK_GRANULATION_MULTIPLIER_BOUNDS.maximum.toFixed(1)}
  );
  fixedOpticalDensity *= granulationMultiplier;
  mobileOpticalDensity *= granulationMultiplier;
  float wetGradient = length(vec2(
    texture(wetTexture, uv + vec2(fineTexel.x, 0.0)).r - texture(wetTexture, uv - vec2(fineTexel.x, 0.0)).r,
    texture(wetTexture, uv + vec2(0.0, fineTexel.y)).r - texture(wetTexture, uv - vec2(0.0, fineTexel.y)).r
  ));
  float dryingFront = smoothstep(0.006, 0.12, wetness)
    * (1.0 - smoothstep(0.2, 0.62, wetness));
  // The dry baseline remains part of both media wells. Drying-front concentration is mobile-only:
  // clear water can move or settle unfixed pigment but cannot change already fixed optical density.
  fixedOpticalDensity *= 1.0 + fixedPigmentEdge * edgeAmount * 0.65;
  mobileOpticalDensity *= 1.0
    + mobilePigmentEdge * edgeAmount * (0.65 + dryingFront * 4.2)
    + dryingFront * mobileCenterDensity * edgeAmount * (0.9 + wetGradient * 7.0);
  vec3 opticalDensity = clamp(
    fixedOpticalDensity + mobileOpticalDensity,
    vec3(0.0),
    vec3(${STUDIO_LIVING_INK_MAXIMUM_OPTICAL_DENSITY.toFixed(1)})
  );
  vec3 color = paper * exp(-opticalDensity);
  float mobileWhiteCoverage = 1.0 - exp(-combined.a * ${STUDIO_LIVING_INK_WHITE_GOUACHE_EXTINCTION});
  vec3 gouache = vec3(0.986, 0.982, 0.968);
  color = mix(color, gouache, clamp(mobileWhiteCoverage, 0.0, 1.0));
  float wetGate = smoothstep(0.015, 0.62, wetness);
  // Clear water itself is subtle. Strong colour comes from transported pigment, preventing the
  // opaque blue/grey bar that appears when a wetness mask is mistaken for paint.
  color *= 1.0 - wetGate * vec3(0.018, 0.016, 0.012);
  color += vec3(0.035, 0.042, 0.052) * wetSheenAmount
    * wetGate * clamp(wetGradient * 6.0, 0.0, 1.0);
  vec2 centered = uv - vec2(0.5);
  color *= 1.0 - dot(centered, centered) * vignetteAmount;
  // Paper is paper only where the wash is. This surface is committed to the document as a
  // page-sized layer, so an opaque sheet repaints the whole page — one stroke used to turn a
  // 1440x2160 export from pure white to warm cream everywhere, baked into the delivered PNG.
  // Presence is the union of pigment, opaque white and standing water, so every mark the resolve
  // can draw still carries its own fibre, tooth and granulation, and nothing else does.
  float washPresence = 1.0 - exp(-${STUDIO_LIVING_INK_SURFACE_COVERAGE.presenceGain.toFixed(1)} * (
    max(max(opticalDensity.r, opticalDensity.g), opticalDensity.b)
    + clamp(mobileWhiteCoverage, 0.0, 1.0)
    + wetGate
  ));
  vec3 shown = mix(vec3(1.0), clamp(color, vec3(0.0), vec3(1.0)), clamp(washPresence, 0.0, 1.0));
  // Un-premultiply against the page so compositing this layer back over white reproduces "shown"
  // exactly, and so the layer's multiply blend reads as backdrop * shown over artwork underneath.
  float surfaceAlpha = 1.0 - min(shown.r, min(shown.g, shown.b));
  vec3 straight = surfaceAlpha > ${STUDIO_LIVING_INK_SURFACE_COVERAGE.alphaEpsilon}
    ? (shown - vec3(1.0 - surfaceAlpha)) / surfaceAlpha
    : vec3(1.0);
  outColor = vec4(clamp(straight, vec3(0.0), vec3(1.0)), surfaceAlpha);
}`;

function integer(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= minimum
    && value <= maximum;
}

function finite(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number"
    && Number.isFinite(value)
    && value >= minimum
    && value <= maximum;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => (
    `${JSON.stringify(key)}:${stableJson(record[key])}`
  )).join(",")}}`;
}

function sha256(value: Uint8Array | string): `sha256:${string}` {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  return `sha256:${sha256HexPortable(bytes)}`;
}

export type StudioLivingInkWebGlPresentationEnvironment = Readonly<{
  createImageBitmap: (
    source: ImageData,
    options: ImageBitmapOptions,
  ) => Promise<ImageBitmap>;
  stillOwnsFrame: () => boolean;
}>;

const WEB_GL_READBACK_BITMAP_OPTIONS = Object.freeze({
  colorSpaceConversion: "none",
  imageOrientation: "none",
  premultiplyAlpha: "none",
}) satisfies ImageBitmapOptions;

/**
 * Converts WebGL's bottom-left row-major readback to ImageData's top-left row-major order.
 *
 * A fresh array is intentional: the receipt continues to hash the untouched WebGL byte order,
 * while the bitmap receives the same RGBA8 values with only their row addresses changed.
 */
export function studioLivingInkWebGlReadbackToTopDownRgba8(
  pixels: Uint8Array,
  width: number,
  height: number,
): Uint8ClampedArray<ArrayBuffer> {
  const expectedByteLength = width * height * 4;
  if (
    !Number.isSafeInteger(width)
    || width <= 0
    || !Number.isSafeInteger(height)
    || height <= 0
    || !Number.isSafeInteger(expectedByteLength)
    || pixels.byteLength !== expectedByteLength
  ) throw new Error("Living Ink RGBA8 display readback dimensions are malformed.");

  const stride = width * 4;
  const topDown = new Uint8ClampedArray(expectedByteLength);
  for (let sourceRow = 0; sourceRow < height; sourceRow += 1) {
    const targetRow = height - 1 - sourceRow;
    topDown.set(
      pixels.subarray(sourceRow * stride, sourceRow * stride + stride),
      targetRow * stride,
    );
  }
  return topDown;
}

async function createBrowserImageBitmap(
  source: ImageData,
  options: ImageBitmapOptions,
): Promise<ImageBitmap> {
  if (typeof globalThis.createImageBitmap !== "function") {
    throw new Error("Living Ink requires createImageBitmap for RGBA8 presentation.");
  }
  return await globalThis.createImageBitmap(source, options);
}

function closeImageBitmapQuietly(bitmap: ImageBitmap): void {
  try {
    bitmap.close();
  } catch {
    // Ownership is already revoked. A browser close failure must not publish a stale GPU frame.
  }
}

/**
 * Builds the caller-owned bitmap from the exact RGBA8 staging readback used by the receipt.
 * Browser bitmap storage may internally premultiply alpha, but no alternate framebuffer, colour
 * conversion or implicit orientation transform is allowed into this authority boundary.
 */
export async function createStudioLivingInkWebGlReadbackBitmap(
  pixels: Uint8Array,
  width: number,
  height: number,
  environment: Partial<StudioLivingInkWebGlPresentationEnvironment> = {},
): Promise<ImageBitmap> {
  const topDown = studioLivingInkWebGlReadbackToTopDownRgba8(pixels, width, height);
  const imageData = new ImageData(topDown, width, height);
  const bitmap = await (environment.createImageBitmap ?? createBrowserImageBitmap)(
    imageData,
    WEB_GL_READBACK_BITMAP_OPTIONS,
  );

  let stillOwnsFrame: boolean;
  try {
    stillOwnsFrame = environment.stillOwnsFrame?.() ?? true;
  } catch (error) {
    closeImageBitmapQuietly(bitmap);
    throw error;
  }
  if (!stillOwnsFrame) {
    closeImageBitmapQuietly(bitmap);
    throw new Error("Living Ink RGBA8 presentation was invalidated before publication.");
  }
  return bitmap;
}

export function validateStudioLivingInkExecutionConfig(
  value: StudioLivingInkExecutionConfig,
): void {
  if (
    !integer(value.displayWidth, 1, STUDIO_LIVING_INK_EXECUTION_LIMITS.maximumDisplayDimension)
    || !integer(value.displayHeight, 1, STUDIO_LIVING_INK_EXECUTION_LIMITS.maximumDisplayDimension)
    || !integer(value.fieldWidth, 1, STUDIO_LIVING_INK_EXECUTION_LIMITS.maximumFineDimension)
    || !integer(value.fieldHeight, 1, STUDIO_LIVING_INK_EXECUTION_LIMITS.maximumFineDimension)
    || ![128, 192, 256].includes(value.coarseBase)
    || !integer(value.seed, 0, 0xffff_ffff)
  ) throw new Error("Living Ink execution config exceeds its reviewed GPU boundary.");
}

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Living Ink could not allocate a shader.");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const detail = gl.getShaderInfoLog(shader) ?? "unknown shader compile failure";
    gl.deleteShader(shader);
    throw new Error(`Living Ink shader compile failed: ${detail}`);
  }
  return shader;
}

function createProgram(
  gl: WebGL2RenderingContext,
  vertex: WebGLShader,
  fragmentSource: string,
): Program {
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  if (!program) throw new Error("Living Ink could not allocate a program.");
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const detail = gl.getProgramInfoLog(program) ?? "unknown program link failure";
    gl.deleteProgram(program);
    throw new Error(`Living Ink program link failed: ${detail}`);
  }
  const uniforms: Record<string, WebGLUniformLocation | null> = {};
  const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number;
  for (let index = 0; index < count; index += 1) {
    const active = gl.getActiveUniform(program, index);
    if (active) uniforms[active.name] = gl.getUniformLocation(program, active.name);
  }
  return Object.freeze({ program, uniforms: Object.freeze(uniforms) });
}

function createSurface(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  internalFormat: number,
  format: number,
  filter: number,
): GlSurface {
  const texture = gl.createTexture();
  const framebuffer = gl.createFramebuffer();
  if (!texture || !framebuffer) throw new Error("Living Ink could not allocate a GPU surface.");
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0, format, gl.HALF_FLOAT, null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error("Living Ink half-float framebuffer is incomplete.");
  }
  gl.viewport(0, 0, width, height);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  return Object.freeze({ texture, framebuffer, width, height });
}

function createMaskSurface(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
): GlSurface {
  const texture = gl.createTexture();
  const framebuffer = gl.createFramebuffer();
  if (!texture || !framebuffer) throw new Error("Living Ink could not allocate a mask surface.");
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, width, height, 0, gl.RED, gl.UNSIGNED_BYTE, null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error("Living Ink selection framebuffer is incomplete.");
  }
  gl.clearColor(1, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  return Object.freeze({ texture, framebuffer, width, height });
}

function createDisplaySurface(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
): GlSurface {
  const texture = gl.createTexture();
  const framebuffer = gl.createFramebuffer();
  if (!texture || !framebuffer) throw new Error("Living Ink could not allocate its display staging surface.");
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error("Living Ink RGBA8 display framebuffer is incomplete.");
  }
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  return Object.freeze({ texture, framebuffer, width, height });
}

function createDoubleSurface(a: GlSurface, b: GlSurface): GlDoubleSurface {
  let read = a;
  let write = b;
  return {
    get read() { return read; },
    get write() { return write; },
    swap() {
      const previous = read;
      read = write;
      write = previous;
    },
  };
}

function textureUnit(
  gl: WebGL2RenderingContext,
  surface: GlSurface,
  unit: number,
): number {
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, surface.texture);
  return unit;
}

function unionBounds(
  left: StudioLivingInkBounds | null,
  right: StudioLivingInkBounds,
  width: number,
  height: number,
): StudioLivingInkBounds {
  if (!left) return Object.freeze({ ...right });
  const x = Math.max(0, Math.min(left.x, right.x));
  const y = Math.max(0, Math.min(left.y, right.y));
  const farX = Math.min(width, Math.max(left.x + left.width, right.x + right.width));
  const farY = Math.min(height, Math.max(left.y + left.height, right.y + right.height));
  return Object.freeze({ x, y, width: farX - x, height: farY - y });
}

function expandBounds(
  bounds: StudioLivingInkBounds,
  halo: number,
  width: number,
  height: number,
): StudioLivingInkBounds {
  const x = Math.max(0, bounds.x - halo);
  const y = Math.max(0, bounds.y - halo);
  const farX = Math.min(width, bounds.x + bounds.width + halo);
  const farY = Math.min(height, bounds.y + bounds.height + halo);
  return Object.freeze({ x, y, width: farX - x, height: farY - y });
}

function boundsForSelection(
  selection: StudioLivingInkSelectionMask | null,
  fieldWidth: number,
  fieldHeight: number,
): StudioLivingInkBounds | null {
  if (!selection) return null;
  const { bounds } = selection;
  if (
    bounds.x < 0
    || bounds.y < 0
    || bounds.width <= 0
    || bounds.height <= 0
    || bounds.x + bounds.width > fieldWidth
    || bounds.y + bounds.height > fieldHeight
    || selection.coverage.length !== bounds.width * bounds.height
  ) throw new Error("Living Ink selection mask is malformed.");
  return bounds;
}

export class StudioLivingInkWebGl2Runtime {
  readonly capabilities: StudioLivingInkExecutionCapabilities;

  private readonly canvas: OffscreenCanvas;
  private readonly gl: WebGL2RenderingContext;
  private readonly config: StudioLivingInkExecutionConfig;
  private readonly resources: ExecutionResources;
  private readonly programs: Programs;
  private readonly coarseWidth: number;
  private readonly coarseHeight: number;
  private readonly vao: WebGLVertexArrayObject;
  private readonly vertexBuffer: WebGLBuffer;
  private contextLost = false;
  private revision = 0;
  private dirtyBounds: StudioLivingInkBounds | null = null;
  private disposed = false;
  private passCount = 0;
  private fixSelectionEnabled = false;
  /** Avoid allocating and uploading a full 1024² mask for the overwhelmingly common no-selection stroke. */
  private selectionTextureHasFullCoverage = true;
  /** Active brush footprint in field-cell space; radiusCells <= 0 disables scrubbing boost. */
  private brushFootprint: Readonly<{ x: number; y: number; radiusCells: number }> = Object.freeze({
    x: 0,
    y: 0,
    radiusCells: 0,
  });
  /**
   * Last deposited ink mark, kept across operations so a batch knows the path length it covers.
   *
   * Product code forwards a stroke as a run of suffix operations, so the distance a batch actually
   * travels includes the gap back to the previous batch's last mark. Journal replay applies the same
   * operations in the same order, so this stays deterministic.
   */
  private lastInkMark: Readonly<{ x: number; y: number }> | null = null;

  constructor(config: StudioLivingInkExecutionConfig) {
    validateStudioLivingInkExecutionConfig(config);
    this.config = Object.freeze({ ...config });
    this.canvas = new OffscreenCanvas(config.displayWidth, config.displayHeight);
    const gl = this.canvas.getContext("webgl2", {
      // The resolve writes wash coverage in alpha so an untouched page stays transparent; the
      // RGBA8 readback-derived ImageBitmap carries it straight, without a second framebuffer.
      alpha: true,
      premultipliedAlpha: false,
      antialias: false,
      depth: false,
      desynchronized: true,
      preserveDrawingBuffer: false,
      stencil: false,
    });
    if (!gl) throw new Error("Living Ink requires OffscreenCanvas WebGL2.");
    if (!gl.getExtension("EXT_color_buffer_float")) {
      throw new Error("Living Ink requires renderable half-float textures.");
    }
    this.gl = gl;
    this.canvas.addEventListener("webglcontextlost", this.onContextLost);
    this.canvas.addEventListener("webglcontextrestored", this.onContextRestored);
    const maximumTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    if (
      config.fieldWidth > maximumTextureSize
      || config.fieldHeight > maximumTextureSize
      || config.displayWidth > maximumTextureSize
      || config.displayHeight > maximumTextureSize
    ) throw new Error("Living Ink dimensions exceed the GPU texture limit.");
    this.capabilities = Object.freeze({
      backend: "webgl2-offscreen-half-float",
      worker: true,
      offscreenCanvas: true,
      webgl2: true,
      webgpu: false,
      halfFloatRenderable: true,
      rgba16Float: true,
      rg16Float: true,
      r16Float: true,
      maximumTextureSize,
      pressureIterations: Object.freeze({
        interactive: STUDIO_LIVING_INK_EXECUTION_LIMITS.interactivePressureIterations,
        settle: STUDIO_LIVING_INK_EXECUTION_LIMITS.settlePressureIterations,
      }),
    });
    const aspect = config.fieldWidth / config.fieldHeight;
    if (aspect >= 1) {
      this.coarseHeight = config.coarseBase;
      this.coarseWidth = Math.max(1, Math.round(config.coarseBase * aspect));
    } else {
      this.coarseWidth = config.coarseBase;
      this.coarseHeight = Math.max(1, Math.round(config.coarseBase / aspect));
    }
    const vertex = compileShader(gl, gl.VERTEX_SHADER, FULLSCREEN_VERTEX);
    this.programs = Object.freeze({
      copy: createProgram(gl, vertex, COPY_FRAGMENT),
      mergeDeposit: createProgram(gl, vertex, MERGE_DEPOSIT_FRAGMENT),
      splat: createProgram(gl, vertex, SPLAT_FRAGMENT),
      clearMasked: createProgram(gl, vertex, CLEAR_MASKED_FRAGMENT),
      velocity: createProgram(gl, vertex, VELOCITY_FRAGMENT),
      curl: createProgram(gl, vertex, CURL_FRAGMENT),
      vorticity: createProgram(gl, vertex, VORTICITY_FRAGMENT),
      divergence: createProgram(gl, vertex, DIVERGENCE_FRAGMENT),
      pressure: createProgram(gl, vertex, PRESSURE_FRAGMENT),
      gradient: createProgram(gl, vertex, GRADIENT_FRAGMENT),
      wet: createProgram(gl, vertex, WET_FRAGMENT),
      pigment: createProgram(gl, vertex, PIGMENT_FRAGMENT),
      exchange: createProgram(gl, vertex, EXCHANGE_FRAGMENT),
      display: createProgram(gl, vertex, DISPLAY_FRAGMENT),
    });
    gl.deleteShader(vertex);
    const vao = gl.createVertexArray();
    const vertexBuffer = gl.createBuffer();
    if (!vao || !vertexBuffer) throw new Error("Living Ink could not allocate fullscreen geometry.");
    this.vao = vao;
    this.vertexBuffer = vertexBuffer;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const fine = (internal: number, format: number, filter: number) => createSurface(
      gl, config.fieldWidth, config.fieldHeight, internal, format, filter,
    );
    const coarse = (internal: number, format: number, filter: number) => createSurface(
      gl, this.coarseWidth, this.coarseHeight, internal, format, filter,
    );
    this.resources = Object.freeze({
      mobile: createDoubleSurface(
        fine(gl.RGBA16F, gl.RGBA, gl.LINEAR),
        fine(gl.RGBA16F, gl.RGBA, gl.LINEAR),
      ),
      strokeDeposit: createDoubleSurface(
        fine(gl.RGBA16F, gl.RGBA, gl.LINEAR),
        fine(gl.RGBA16F, gl.RGBA, gl.LINEAR),
      ),
      fixed: createDoubleSurface(
        fine(gl.RGBA16F, gl.RGBA, gl.LINEAR),
        fine(gl.RGBA16F, gl.RGBA, gl.LINEAR),
      ),
      wet: createDoubleSurface(
        fine(gl.R16F, gl.RED, gl.LINEAR),
        fine(gl.R16F, gl.RED, gl.LINEAR),
      ),
      velocity: createDoubleSurface(
        coarse(gl.RG16F, gl.RG, gl.LINEAR),
        coarse(gl.RG16F, gl.RG, gl.LINEAR),
      ),
      pressure: createDoubleSurface(
        coarse(gl.R16F, gl.RED, gl.NEAREST),
        coarse(gl.R16F, gl.RED, gl.NEAREST),
      ),
      divergence: coarse(gl.R16F, gl.RED, gl.NEAREST),
      curl: coarse(gl.R16F, gl.RED, gl.NEAREST),
      selection: createMaskSurface(gl, config.fieldWidth, config.fieldHeight),
      display: createDisplaySurface(gl, config.displayWidth, config.displayHeight),
    });
    this.clearAll();
    // Force all physical shader programs through one bounded 1px dirty path while the Worker is
    // prewarming. Driver lazy compilation must not become a 700ms first-stroke hitch.
    this.dirtyBounds = Object.freeze({ x: 0, y: 0, width: 1, height: 1 });
    this.uploadSelection(null);
    this.step(STUDIO_LIVING_INK_EXECUTION_LIMITS.fixedTimeStepSeconds, true, 1);
    this.clearAll();
    this.render(config.displayMode);
    gl.finish();
    this.assertNoGlError("initialize-and-first-display");
  }

  private assertActive(): void {
    if (this.disposed) throw new Error("Living Ink runtime is disposed.");
    if (this.contextLost || this.gl.isContextLost()) {
      throw new Error("Living Ink WebGL context is lost; the Worker must rebuild and replay its journal.");
    }
  }

  /**
   * Drain GL errors. `gl.getError()` is a full GPU pipeline sync — calling it after every pass
   * made interactive strokes hitch hard. Only call at high-level stage boundaries.
   */
  private assertNoGlError(stage: string): void {
    const gl = this.gl;
    const first = gl.getError();
    if (first === gl.NO_ERROR) return;
    // Drain the error queue so a sticky flag does not poison the next frame.
    while (gl.getError() !== gl.NO_ERROR) {
      /* drain */
    }
    throw new Error(`Living Ink WebGL error ${first} during ${stage}.`);
  }

  private readonly onContextLost = (event: Event): void => {
    event.preventDefault();
    this.contextLost = true;
  };

  private readonly onContextRestored = (): void => {
    // GPU resources are not trusted after restoration. The Worker creates a fresh runtime and
    // deterministically replays the accepted operation journal before admitting more input.
    this.contextLost = true;
  };

  private bind(program: Program): void {
    this.gl.useProgram(program.program);
  }

  private draw(target: GlSurface | null): void {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target?.framebuffer ?? null);
    gl.viewport(0, 0, target?.width ?? this.config.displayWidth, target?.height ?? this.config.displayHeight);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.passCount += 1;
  }

  private clearSurface(surface: GlSurface, value = 0): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, surface.framebuffer);
    gl.viewport(0, 0, surface.width, surface.height);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(value, value, value, value);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  private clearDouble(surface: GlDoubleSurface): void {
    this.clearSurface(surface.read);
    this.clearSurface(surface.write);
  }

  private clearAll(): void {
    this.clearDouble(this.resources.mobile);
    this.clearDouble(this.resources.strokeDeposit);
    this.clearDouble(this.resources.fixed);
    this.clearDouble(this.resources.wet);
    this.clearDouble(this.resources.velocity);
    this.clearDouble(this.resources.pressure);
    this.clearSurface(this.resources.divergence);
    this.clearSurface(this.resources.curl);
    this.clearSurface(this.resources.selection, 1);
    this.selectionTextureHasFullCoverage = true;
    this.dirtyBounds = null;
    this.lastInkMark = null;
  }

  private uploadSelection(selection: StudioLivingInkSelectionMask | null): boolean {
    const gl = this.gl;
    const width = this.config.fieldWidth;
    const height = this.config.fieldHeight;
    // Full coverage is the steady-state path for ordinary strokes. Avoid allocating and uploading
    // the same width×height 255 mask for every operation; selected edits still invalidate this bit.
    if (!selection && this.selectionTextureHasFullCoverage) return false;
    const pixels = new Uint8Array(width * height);
    if (!selection) {
      pixels.fill(255);
    } else {
      boundsForSelection(selection, width, height);
      for (let row = 0; row < selection.bounds.height; row += 1) {
        for (let column = 0; column < selection.bounds.width; column += 1) {
          const sourceIndex = row * selection.bounds.width + column;
          // Selection coverage is top-to-bottom document order while WebGL upload row zero is the
          // bottom texture row. This explicit flip is required for non-symmetric masks.
          const textureRow = height - 1 - (selection.bounds.y + row);
          const destination = textureRow * width + selection.bounds.x + column;
          pixels[destination] = Math.round(clamp(selection.coverage[sourceIndex] ?? 0, 0, 1) * 255);
        }
      }
    }
    gl.bindTexture(gl.TEXTURE_2D, this.resources.selection.texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, gl.RED, gl.UNSIGNED_BYTE, pixels);
    this.selectionTextureHasFullCoverage = selection === null;
    return selection !== null;
  }

  private markDirty(bounds: StudioLivingInkBounds): void {
    this.dirtyBounds = unionBounds(
      this.dirtyBounds,
      expandBounds(bounds, 12, this.config.fieldWidth, this.config.fieldHeight),
      this.config.fieldWidth,
      this.config.fieldHeight,
    );
  }

  private advanceDirtyHalo(): void {
    if (!this.dirtyBounds) return;
    // One fine-grid texel is not enough: coarse velocity/vorticity samples, semi-Lagrangian
    // transport, four-neighbour capillary creep and display edge reads all cross the dirty edge.
    // Expanding every fixed tick prevents a stale ping-pong boundary from clipping a bloom.
    const coarseFootprint = Math.max(
      this.config.fieldWidth / this.coarseWidth,
      this.config.fieldHeight / this.coarseHeight,
    );
    const halo = Math.max(4, Math.ceil(coarseFootprint * 2 + 2));
    this.dirtyBounds = expandBounds(
      this.dirtyBounds,
      halo,
      this.config.fieldWidth,
      this.config.fieldHeight,
    );
  }

  private markBounds(x: number, y: number, radius: number): StudioLivingInkBounds {
    const left = Math.max(0, Math.floor(x - radius * 4));
    const top = Math.max(0, Math.floor(y - radius * 4));
    const right = Math.min(this.config.fieldWidth, Math.ceil(x + radius * 4));
    const bottom = Math.min(this.config.fieldHeight, Math.ceil(y + radius * 4));
    return Object.freeze({ x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) });
  }

  private splat(
    target: GlDoubleSurface,
    x: number,
    y: number,
    radiusCells: number,
    amount: readonly [number, number, number, number],
    maximumBlend: boolean,
    selectionEnabled: boolean,
    startPoint: readonly [number, number],
    falloff = 3.25,
    radialVector = false,
    startAmount: readonly [number, number, number, number] = amount,
    startRadiusCells = radiusCells,
  ): void {
    const gl = this.gl;
    const radiusUv = radiusCells / this.config.fieldHeight;
    const splatBounds = unionBounds(
      this.markBounds(x, y, radiusCells),
      this.markBounds(startPoint[0], startPoint[1], radiusCells),
      this.config.fieldWidth,
      this.config.fieldHeight,
    );
    this.bind(this.programs.splat);
    gl.uniform1i(this.programs.splat.uniforms.sourceTexture, textureUnit(gl, target.read, 0));
    gl.uniform1i(this.programs.splat.uniforms.selectionTexture, textureUnit(gl, this.resources.selection, 1));
    gl.uniform2f(
      this.programs.splat.uniforms.start,
      startPoint[0] / this.config.fieldWidth,
      1 - startPoint[1] / this.config.fieldHeight,
    );
    gl.uniform2f(this.programs.splat.uniforms.center, x / this.config.fieldWidth, 1 - y / this.config.fieldHeight);
    gl.uniform4f(this.programs.splat.uniforms.startAmount, ...startAmount);
    gl.uniform4f(this.programs.splat.uniforms.amount, ...amount);
    gl.uniform1f(this.programs.splat.uniforms.startRadius, startRadiusCells / this.config.fieldHeight);
    gl.uniform1f(this.programs.splat.uniforms.radius, radiusUv);
    gl.uniform1f(this.programs.splat.uniforms.aspect, this.config.fieldWidth / this.config.fieldHeight);
    gl.uniform1f(this.programs.splat.uniforms.selectionEnabled, selectionEnabled ? 1 : 0);
    gl.uniform1f(this.programs.splat.uniforms.maximumBlend, maximumBlend ? 1 : 0);
    gl.uniform1f(this.programs.splat.uniforms.falloff, falloff);
    gl.uniform1f(this.programs.splat.uniforms.radialVector, radialVector ? 1 : 0);
    this.drawDirty(target.write, splatBounds);
    target.swap();
    this.syncDoubleDirty(target, splatBounds);
  }

  private clearMasked(surface: GlDoubleSurface): void {
    const gl = this.gl;
    this.bind(this.programs.clearMasked);
    gl.uniform1i(this.programs.clearMasked.uniforms.sourceTexture, textureUnit(gl, surface.read, 0));
    gl.uniform1i(this.programs.clearMasked.uniforms.selectionTexture, textureUnit(gl, this.resources.selection, 1));
    this.draw(surface.write);
    surface.swap();
    this.bind(this.programs.copy);
    gl.uniform1i(this.programs.copy.uniforms.sourceTexture, textureUnit(gl, surface.read, 0));
    gl.uniform1f(this.programs.copy.uniforms.multiplier, 1);
    this.draw(surface.write);
  }

  private async applyDepositions(
    operation: Extract<StudioLivingInkOperation, { kind: "ink" | "water" }>,
    isCancelled: () => boolean,
    yieldControl: () => Promise<void>,
  ): Promise<void> {
    if (operation.marks.length > STUDIO_LIVING_INK_EXECUTION_LIMITS.maximumMarksPerRequest) {
      throw new Error("Living Ink mark budget exceeded.");
    }
    const selectionEnabled = this.uploadSelection(operation.selection);
    if (operation.kind === "ink") this.clearDouble(this.resources.strokeDeposit);
    const coat = studioLivingInkPigmentCoatFactor(
      studioLivingInkDepositionPathLength(operation.marks, this.lastInkMark),
      studioLivingInkMeanMarkRadius(operation.marks),
    );
    let previousX: number | null = null;
    let previousY: number | null = null;
    let previousRadius: number | null = null;
    let previousWetAmount: number | null = null;
    let previousDeposit: readonly [number, number, number, number] | null = null;
    for (let index = 0; index < operation.marks.length; index += 1) {
      if (isCancelled()) throw new DOMException("Living Ink request cancelled.", "AbortError");
      const mark = operation.marks[index]!;
      if (
        !finite(mark.x, 0, this.config.fieldWidth)
        || !finite(mark.y, 0, this.config.fieldHeight)
        || !finite(mark.radius, 0.25, 192)
        || !finite(mark.pressure, 0, 1)
        || !finite(mark.speed, 0, 100_000)
      ) throw new Error("Living Ink mark is outside the field contract.");
      const pressure = clamp(mark.pressure, 0.02, 1);
      const relativeSpeed = clamp(mark.speed / Math.max(1, this.config.fieldHeight * 3), 0, 1);
      const waterOnly = operation.kind === "water";
      const penTool = operation.kind === "ink" && operation.tool === "pen";
      const broad = waterOnly || (operation.kind === "ink" && operation.tool !== "pen");
      const radiusScale = broad
        ? (0.72 + Math.sqrt(pressure) * 0.58) * (1 + relativeSpeed * 0.22)
        : (0.55 + pressure * 0.72) * (1.08 - relativeSpeed * 0.38);
      const radius = Math.max(0.25, mark.radius * radiusScale);
      const speedLoad = broad ? 0.62 + (1 - relativeSpeed) * 0.38 : 0.5 + (1 - relativeSpeed) * 0.65;
      const load = (0.18 + pressure * 0.82) * speedLoad;
      // InkWash pen lays a faint wetness (~0.16) so a wash moments later can feather the line.
      const wetAmount = clamp(
        Math.max(mark.waterMass * load, penTool ? 0.16 * load : 0),
        0,
        4,
      );
      this.brushFootprint = Object.freeze({
        x: mark.x,
        y: mark.y,
        radiusCells: broad ? radius : radius * 2.35,
      });
      this.splat(
        this.resources.wet,
        mark.x,
        mark.y,
        broad ? radius : radius * 2.35,
        [wetAmount, 0, 0, 0],
        true,
        selectionEnabled,
        [previousX ?? mark.x, previousY ?? mark.y],
        3.25,
        false,
        [previousWetAmount ?? wetAmount, 0, 0, 0],
        broad ? (previousRadius ?? radius) : (previousRadius ?? radius) * 2.35,
      );
      if (operation.kind === "ink") {
        const pigmentMark = operation.marks[index]!;
        const pigment = pigmentMark.pigmentMass * load;
        // One pass is one coat: divide the batch by the path length it covers and by the measured
        // gain of the resolve, then scale by the stroke's own opacity as the CPU oracle already did.
        // Opaque white is a coverage well rather than an optical density, so it keeps the raw load.
        const pigmentCoat = pigment
          * clamp(pigmentMark.color[3], 0, 1)
          * coat
          / STUDIO_LIVING_INK_PIGMENT_COAT.resolveGain;
        const white = operation.tool === "white-gouache";
        const densityRed = studioLivingInkPigmentOpticalDensity(pigmentMark.color[0]) * pigmentCoat;
        const densityGreen = studioLivingInkPigmentOpticalDensity(pigmentMark.color[1]) * pigmentCoat;
        const densityBlue = studioLivingInkPigmentOpticalDensity(pigmentMark.color[2]) * pigmentCoat;
        const deposit: readonly [number, number, number, number] = white
          ? [
              0,
              0,
              0,
              pigment
                * STUDIO_LIVING_INK_WHITE_GOUACHE_LOAD_GAIN
                * clamp(pigmentMark.color[3], 0, 1),
            ]
          : [
              densityRed,
              densityGreen,
              densityBlue,
              0,
            ];
        this.splat(
          this.resources.strokeDeposit,
          mark.x,
          mark.y,
          white ? radius * 1.45 : radius,
          deposit,
          true,
          selectionEnabled,
          [previousX ?? mark.x, previousY ?? mark.y],
          white ? 0.9 : 3.25,
          false,
          previousDeposit ?? deposit,
          white ? (previousRadius ?? radius) * 1.45 : (previousRadius ?? radius),
        );
        previousDeposit = deposit;
      }
      if (broad) {
        const dx = previousX === null ? 0 : mark.x - previousX;
        const dy = previousY === null ? 0 : mark.y - previousY;
        const distance = Math.hypot(dx, dy);
        let velocityX: number;
        let velocityY: number;
        if (distance > 1e-4) {
          const tangentX = dx / distance;
          const tangentY = -dy / distance;
          const normalX = -tangentY;
          const normalY = tangentX;
          const tangentImpulse = (
            waterOnly
              ? 0.01 + this.config.material.flow * 0.035
              : 0.03 + this.config.material.flow * 0.16
          ) * pressure;
          const stirPhase = Math.sin(index * 0.47 + operation.sequence * 0.73);
          const stirImpulse = (
            waterOnly
              ? 0.004 + this.config.material.vorticity * 0.025
              : 0.003 + this.config.material.vorticity * 0.018
          ) * pressure * stirPhase;
          velocityX = tangentX * tangentImpulse + normalX * stirImpulse;
          velocityY = tangentY * tangentImpulse + normalY * stirImpulse;
        } else {
          const angle = ((operation.sequence * 131 + index * 977 + this.config.seed) % 6_283) / 1_000;
          const impulse = (
            waterOnly
              ? 0.006 + this.config.material.flow * 0.012
              : 0.003 + this.config.material.flow * 0.008
          ) * pressure;
          velocityX = Math.cos(angle) * impulse;
          velocityY = Math.sin(angle) * impulse;
        }
        this.splat(
          this.resources.velocity,
          mark.x,
          mark.y,
          radius * 1.15,
          [velocityX, velocityY, 0, 0],
          false,
          selectionEnabled,
          [previousX ?? mark.x, previousY ?? mark.y],
        );
        if (waterOnly) {
          // A continuous capsule-normal source moves pigment toward the wet boundary on a stroke;
          // for a dwell mark the same shader becomes a deterministic radial capillary impulse.
          const radialImpulse = (
            0.018
            + this.config.material.capillaryCreep * 0.055
          ) * pressure;
          this.splat(
            this.resources.velocity,
            mark.x,
            mark.y,
            radius * 1.45,
            [radialImpulse, 0, 0, 0],
            false,
            selectionEnabled,
            [previousX ?? mark.x, previousY ?? mark.y],
            2.1,
            true,
          );
        }
      }
      this.markDirty(this.markBounds(mark.x, mark.y, radius));
      previousX = mark.x;
      previousY = mark.y;
      previousRadius = radius;
      previousWetAmount = wetAmount;
      // Do NOT interleave full Stable Fluids steps per mark. Each step is ~10+ fullscreen passes
      // plus pressure Jacobi; doing that every few marks made interactive strokes hitch. InkWash
      // advances once per animation frame after stamps; we match that with the post-deposit
      // simulationTicks budget in apply() instead.
      if ((index + 1) % 32 === 0) {
        await yieldControl();
        if (isCancelled()) throw new DOMException("Living Ink request cancelled.", "AbortError");
      }
    }
    if (operation.kind === "ink" && operation.marks.length > 0) {
      const gl = this.gl;
      const bounds = this.simulationBounds();
      this.bind(this.programs.mergeDeposit);
      gl.uniform1i(
        this.programs.mergeDeposit.uniforms.baseTexture,
        textureUnit(gl, this.resources.mobile.read, 0),
      );
      gl.uniform1i(
        this.programs.mergeDeposit.uniforms.depositTexture,
        textureUnit(gl, this.resources.strokeDeposit.read, 1),
      );
      this.drawDirty(this.resources.mobile.write, bounds);
      this.resources.mobile.swap();
      this.syncDoubleDirty(this.resources.mobile, bounds);
      // continuous-stroke-deposit-merge: one physical pigment write after the capsule union pass.
      const last = operation.marks[operation.marks.length - 1]!;
      this.lastInkMark = Object.freeze({ x: last.x, y: last.y });
    }
    // Pen-up: clear the scrub tip so post-stroke settle/advance/fix ticks do not keep a ghost
    // brushFootprint localizing bleed forever (InkWash only boosts under the live pointer).
    this.clearBrushFootprint();
  }

  private clearBrushFootprint(): void {
    this.brushFootprint = Object.freeze({ x: 0, y: 0, radiusCells: 0 });
  }

  private simulationBounds(): StudioLivingInkBounds {
    return this.dirtyBounds ?? Object.freeze({
      x: 0,
      y: 0,
      width: this.config.fieldWidth,
      height: this.config.fieldHeight,
    });
  }

  private enableDirtyScissor(target: GlSurface, fineBounds: StudioLivingInkBounds): void {
    const gl = this.gl;
    const scaleX = target.width / this.config.fieldWidth;
    const scaleY = target.height / this.config.fieldHeight;
    const x = Math.max(0, Math.floor(fineBounds.x * scaleX));
    const yTop = Math.max(0, Math.floor(fineBounds.y * scaleY));
    const width = Math.min(target.width - x, Math.ceil(fineBounds.width * scaleX));
    const height = Math.min(target.height - yTop, Math.ceil(fineBounds.height * scaleY));
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(x, Math.max(0, target.height - yTop - height), Math.max(1, width), Math.max(1, height));
  }

  private drawDirty(target: GlSurface, bounds: StudioLivingInkBounds): void {
    this.enableDirtyScissor(target, bounds);
    this.draw(target);
    this.gl.disable(this.gl.SCISSOR_TEST);
  }

  private syncDoubleDirty(surface: GlDoubleSurface, bounds: StudioLivingInkBounds): void {
    const gl = this.gl;
    // Invariant: read and write are byte-equivalent before every ping-pong pass. After a dirty
    // compute and swap, synchronize only the changed rectangle back to the spare surface. This
    // prevents two-tick stale resurrection without a full-field copy.
    this.bind(this.programs.copy);
    gl.uniform1i(this.programs.copy.uniforms.sourceTexture, textureUnit(gl, surface.read, 0));
    gl.uniform1f(this.programs.copy.uniforms.multiplier, 1);
    this.drawDirty(surface.write, bounds);
  }

  private clearPressure(): void {
    const gl = this.gl;
    for (const surface of [this.resources.pressure.read, this.resources.pressure.write]) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, surface.framebuffer);
      gl.viewport(0, 0, surface.width, surface.height);
      gl.disable(gl.SCISSOR_TEST);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
  }

  private exchangeMobileIntoFixed(
    bounds: StudioLivingInkBounds,
    settle: number,
  ): void {
    const gl = this.gl;
    this.bind(this.programs.exchange);
    gl.uniform1i(this.programs.exchange.uniforms.mobileTexture, textureUnit(gl, this.resources.mobile.read, 0));
    gl.uniform1i(this.programs.exchange.uniforms.fixedTexture, textureUnit(gl, this.resources.fixed.read, 1));
    gl.uniform1i(this.programs.exchange.uniforms.selectionTexture, textureUnit(gl, this.resources.selection, 2));
    gl.uniform1f(this.programs.exchange.uniforms.settle, settle);
    gl.uniform1f(this.programs.exchange.uniforms.selectionEnabled, this.fixSelectionEnabled ? 1 : 0);
    gl.uniform1f(this.programs.exchange.uniforms.outputFixed, 1);
    this.drawDirty(this.resources.fixed.write, bounds);
    gl.uniform1f(this.programs.exchange.uniforms.outputFixed, 0);
    this.drawDirty(this.resources.mobile.write, bounds);
    this.resources.fixed.swap();
    this.resources.mobile.swap();
    this.syncDoubleDirty(this.resources.fixed, bounds);
    this.syncDoubleDirty(this.resources.mobile, bounds);
  }

  private step(
    dt: number,
    fixing: boolean,
    pressureIterations: number,
    velocitySettling = false,
  ): void {
    const gl = this.gl;
    this.advanceDirtyHalo();
    const bounds = this.simulationBounds();
    const material = this.config.material;
    this.bind(this.programs.velocity);
    gl.uniform1i(this.programs.velocity.uniforms.velocityTexture, textureUnit(gl, this.resources.velocity.read, 0));
    gl.uniform1i(this.programs.velocity.uniforms.wetTexture, textureUnit(gl, this.resources.wet.read, 1));
    gl.uniform1f(this.programs.velocity.uniforms.dt, dt);
    gl.uniform1f(
      this.programs.velocity.uniforms.damping,
      studioLivingInkVelocityDampingForStep(
        material.flow,
        dt,
        fixing,
        velocitySettling,
      ),
    );
    this.drawDirty(this.resources.velocity.write, bounds);
    this.resources.velocity.swap();
    this.syncDoubleDirty(this.resources.velocity, bounds);

    this.bind(this.programs.curl);
    gl.uniform1i(this.programs.curl.uniforms.velocityTexture, textureUnit(gl, this.resources.velocity.read, 0));
    gl.uniform2f(this.programs.curl.uniforms.texel, 1 / this.coarseWidth, 1 / this.coarseHeight);
    this.draw(this.resources.curl);

    this.bind(this.programs.vorticity);
    gl.uniform1i(this.programs.vorticity.uniforms.velocityTexture, textureUnit(gl, this.resources.velocity.read, 0));
    gl.uniform1i(this.programs.vorticity.uniforms.curlTexture, textureUnit(gl, this.resources.curl, 1));
    gl.uniform2f(this.programs.vorticity.uniforms.texel, 1 / this.coarseWidth, 1 / this.coarseHeight);
    gl.uniform1f(this.programs.vorticity.uniforms.dt, dt);
    gl.uniform1f(this.programs.vorticity.uniforms.strength, 0.6 + material.vorticity * 6);
    this.drawDirty(this.resources.velocity.write, bounds);
    this.resources.velocity.swap();
    this.syncDoubleDirty(this.resources.velocity, bounds);

    this.bind(this.programs.divergence);
    gl.uniform1i(this.programs.divergence.uniforms.velocityTexture, textureUnit(gl, this.resources.velocity.read, 0));
    gl.uniform2f(this.programs.divergence.uniforms.texel, 1 / this.coarseWidth, 1 / this.coarseHeight);
    this.draw(this.resources.divergence);
    this.clearPressure();

    // Jacobi: each iteration samples pressure.read and writes pressure.write then swaps.
    // Mid-iteration syncDoubleDirty was a full dirty-region copy per pass (×N) and is unnecessary
    // while we always read from the swapped read buffer for the next residual.
    this.bind(this.programs.pressure);
    gl.uniform1i(this.programs.pressure.uniforms.divergenceTexture, textureUnit(gl, this.resources.divergence, 1));
    gl.uniform2f(this.programs.pressure.uniforms.texel, 1 / this.coarseWidth, 1 / this.coarseHeight);
    for (let iteration = 0; iteration < pressureIterations; iteration += 1) {
      this.bind(this.programs.pressure);
      gl.uniform1i(this.programs.pressure.uniforms.pressureTexture, textureUnit(gl, this.resources.pressure.read, 0));
      this.drawDirty(this.resources.pressure.write, bounds);
      this.resources.pressure.swap();
    }
    // Restore spare buffer identity for later dirty scissor passes that assume ping-pong parity.
    this.syncDoubleDirty(this.resources.pressure, bounds);

    this.bind(this.programs.gradient);
    gl.uniform1i(this.programs.gradient.uniforms.velocityTexture, textureUnit(gl, this.resources.velocity.read, 0));
    gl.uniform1i(this.programs.gradient.uniforms.pressureTexture, textureUnit(gl, this.resources.pressure.read, 1));
    gl.uniform2f(this.programs.gradient.uniforms.texel, 1 / this.coarseWidth, 1 / this.coarseHeight);
    this.drawDirty(this.resources.velocity.write, bounds);
    this.resources.velocity.swap();
    this.syncDoubleDirty(this.resources.velocity, bounds);

    const dryWindow = 2 + (1 - material.dryRate) * 16;
    this.bind(this.programs.wet);
    gl.uniform1i(this.programs.wet.uniforms.wetTexture, textureUnit(gl, this.resources.wet.read, 0));
    gl.uniform1i(this.programs.wet.uniforms.velocityTexture, textureUnit(gl, this.resources.velocity.read, 1));
    gl.uniform2f(this.programs.wet.uniforms.fineTexel, 1 / this.config.fieldWidth, 1 / this.config.fieldHeight);
    gl.uniform1f(this.programs.wet.uniforms.dt, dt);
    gl.uniform1f(this.programs.wet.uniforms.evaporation, Math.exp(-dt / (fixing ? 0.25 : dryWindow)));
    gl.uniform1f(this.programs.wet.uniforms.creep, material.capillaryCreep);
    gl.uniform1f(this.programs.wet.uniforms.fiberAnisotropy, material.paperFiber);
    // Keep the procedural seed inside the exact low-magnitude float range. Adding a 24-bit-sized
    // seed to pixel cells destroys the low bits on some mobile/ANGLE shader compilers and turns
    // paper grain into a flat colour.
    gl.uniform1f(this.programs.wet.uniforms.seed, this.config.seed % 4_093);
    this.drawDirty(this.resources.wet.write, bounds);
    this.resources.wet.swap();
    this.syncDoubleDirty(this.resources.wet, bounds);

    this.bind(this.programs.pigment);
    gl.uniform1i(this.programs.pigment.uniforms.pigmentTexture, textureUnit(gl, this.resources.mobile.read, 0));
    gl.uniform1i(this.programs.pigment.uniforms.wetTexture, textureUnit(gl, this.resources.wet.read, 1));
    gl.uniform1i(this.programs.pigment.uniforms.velocityTexture, textureUnit(gl, this.resources.velocity.read, 2));
    gl.uniform2f(this.programs.pigment.uniforms.fineTexel, 1 / this.config.fieldWidth, 1 / this.config.fieldHeight);
    gl.uniform1f(this.programs.pigment.uniforms.dt, dt);
    gl.uniform1f(this.programs.pigment.uniforms.bleed, material.bleed);
    gl.uniform1f(this.programs.pigment.uniforms.chromatography, material.chromaticSeparation);
    gl.uniform1f(this.programs.pigment.uniforms.capillaryTransport, material.capillaryCreep);
    gl.uniform1f(this.programs.pigment.uniforms.edgeDeposition, material.dryingEdgeDeposition);
    gl.uniform1f(this.programs.pigment.uniforms.aspect, this.config.fieldWidth / this.config.fieldHeight);
    const brushRadiusUv = this.brushFootprint.radiusCells > 0
      ? this.brushFootprint.radiusCells / this.config.fieldHeight
      : 0;
    gl.uniform3f(
      this.programs.pigment.uniforms.brushFootprint,
      this.brushFootprint.x / this.config.fieldWidth,
      1 - this.brushFootprint.y / this.config.fieldHeight,
      brushRadiusUv,
    );
    // Shared InkWash §06 chemistry: same TS helpers compute quiet (no tip) and tip diffusion rates.
    const chroma = studioLivingInkChromaBleedMultipliers(material.chromaticSeparation);
    gl.uniform3f(
      this.programs.pigment.uniforms.chromaMultipliers,
      chroma[0],
      chroma[1],
      chroma[2],
    );
    // mobility=1 is the worst-case wet cell; the shader still gates transport by local mobility.
    const quietRates = studioLivingInkPigmentDiffusionRates({
      bleed: material.bleed,
      mobility: 1,
      dt,
      brushFootprint: 0,
      chromaticSeparation: material.chromaticSeparation,
    });
    const tipRates = studioLivingInkPigmentDiffusionRates({
      bleed: material.bleed,
      mobility: 1,
      dt,
      brushFootprint: 1,
      chromaticSeparation: material.chromaticSeparation,
    });
    gl.uniform4f(
      this.programs.pigment.uniforms.separatedDiffusionQuiet,
      quietRates[0],
      quietRates[1],
      quietRates[2],
      quietRates[3],
    );
    gl.uniform4f(
      this.programs.pigment.uniforms.separatedDiffusionTip,
      tipRates[0],
      tipRates[1],
      tipRates[2],
      tipRates[3],
    );
    this.drawDirty(this.resources.mobile.write, bounds);
    this.resources.mobile.swap();
    this.syncDoubleDirty(this.resources.mobile, bounds);

    if (fixing) {
      const settle = 1 - Math.exp(-dt * 5);
      this.exchangeMobileIntoFixed(bounds, settle);
    }
  }

  private render(displayMode: StudioLivingInkDisplayMode): void {
    const gl = this.gl;
    this.bind(this.programs.display);
    gl.uniform1i(this.programs.display.uniforms.mobileTexture, textureUnit(gl, this.resources.mobile.read, 0));
    gl.uniform1i(this.programs.display.uniforms.fixedTexture, textureUnit(gl, this.resources.fixed.read, 1));
    gl.uniform1i(this.programs.display.uniforms.wetTexture, textureUnit(gl, this.resources.wet.read, 2));
    gl.uniform1i(this.programs.display.uniforms.velocityTexture, textureUnit(gl, this.resources.velocity.read, 3));
    gl.uniform2f(this.programs.display.uniforms.fineTexel, 1 / this.config.fieldWidth, 1 / this.config.fieldHeight);
    gl.uniform2f(this.programs.display.uniforms.displayResolution, this.config.displayWidth, this.config.displayHeight);
    const material = this.config.material;
    gl.uniform1f(this.programs.display.uniforms.densityStrength, displayMode === "composite" ? material.beerLambertDensity * 2.2 : 1.5);
    gl.uniform1f(this.programs.display.uniforms.fiberAmount, material.paperFiber);
    gl.uniform1f(this.programs.display.uniforms.toothAmount, material.paperTooth);
    gl.uniform1f(this.programs.display.uniforms.granulationAmount, material.granulation);
    gl.uniform1f(this.programs.display.uniforms.chromatographyAmount, material.chromaticSeparation);
    gl.uniform1f(this.programs.display.uniforms.edgeAmount, material.edgeDarkening * 2.2);
    gl.uniform1f(this.programs.display.uniforms.wetSheenAmount, material.wetSheen);
    gl.uniform1f(this.programs.display.uniforms.vignetteAmount, material.vignette);
    gl.uniform1f(this.programs.display.uniforms.seed, this.config.seed % 4_093);
    gl.uniform1f(
      this.programs.display.uniforms.displayMode,
      displayMode === "mobile-pigment"
        ? 1
        : displayMode === "fixed-pigment"
          ? 2
          : displayMode === "water"
            ? 3
            : displayMode === "flow"
              ? 4
              : 0,
    );
    this.draw(this.resources.display);
  }

  private displayPixels(): Uint8Array {
    const gl = this.gl;
    const pixels = new Uint8Array(this.config.displayWidth * this.config.displayHeight * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.resources.display.framebuffer);
    gl.readPixels(
      0,
      0,
      this.config.displayWidth,
      this.config.displayHeight,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      pixels,
    );
    return pixels;
  }

  private async presentDisplayPixels(pixels: Uint8Array): Promise<ImageBitmap> {
    return await createStudioLivingInkWebGlReadbackBitmap(
      pixels,
      this.config.displayWidth,
      this.config.displayHeight,
      {
        stillOwnsFrame: () => (
          !this.disposed
          && !this.contextLost
          && !this.gl.isContextLost()
        ),
      },
    );
  }

  private operationBounds(operation: StudioLivingInkOperation): StudioLivingInkBounds {
    if (operation.kind === "clear" || operation.kind === "fix") {
      return operation.selection?.bounds ?? Object.freeze({
        x: 0,
        y: 0,
        width: this.config.fieldWidth,
        height: this.config.fieldHeight,
      });
    }
    if (operation.kind === "advance") return this.simulationBounds();
    let result: StudioLivingInkBounds | null = operation.selection?.bounds ?? null;
    for (const mark of operation.marks) {
      result = unionBounds(result, this.markBounds(mark.x, mark.y, mark.radius), this.config.fieldWidth, this.config.fieldHeight);
    }
    return result ?? Object.freeze({ x: 0, y: 0, width: 1, height: 1 });
  }

  async apply(
    requestId: number,
    operation: StudioLivingInkOperation,
    options: StudioLivingInkExecutionApplyOptions & Readonly<{ present: false }>,
    isCancelled: () => boolean,
    yieldControl: () => Promise<void>,
  ): Promise<StudioLivingInkExecutionApplied>;
  async apply(
    requestId: number,
    operation: StudioLivingInkOperation,
    options: StudioLivingInkExecutionApplyOptions,
    isCancelled: () => boolean,
    yieldControl: () => Promise<void>,
  ): Promise<StudioLivingInkExecutionApplyResult>;
  async apply(
    requestId: number,
    operation: StudioLivingInkOperation,
    options: StudioLivingInkExecutionApplyOptions,
    isCancelled: () => boolean,
    yieldControl: () => Promise<void>,
  ): Promise<StudioLivingInkExecutionApplyResult> {
    this.assertActive();
    if (!integer(requestId, 1, Number.MAX_SAFE_INTEGER)) throw new Error("Living Ink request id is invalid.");
    const started = performance.now();
    this.passCount = 0;
    const operationBounds = this.operationBounds(operation);
    this.markDirty(operationBounds);
    if (operation.kind === "ink" || operation.kind === "water") {
      await this.applyDepositions(operation, isCancelled, yieldControl);
      // applyDepositions already clears the tip; keep a defensive clear before the settle loop.
      this.clearBrushFootprint();
    } else {
      // advance/fix/clear never have a live tip — scrub boost must not revive a previous stroke.
      this.clearBrushFootprint();
      if (operation.kind === "clear") {
        if (operation.scope === "selection" && !operation.selection) {
          throw new Error("Living Ink selected clear requires a selection mask.");
        }
        if (operation.scope === "all") this.clearAll();
        else {
          this.uploadSelection(operation.selection);
          this.clearMasked(this.resources.mobile);
          this.clearMasked(this.resources.fixed);
          this.clearMasked(this.resources.wet);
          this.clearMasked(this.resources.velocity);
          this.clearMasked(this.resources.pressure);
        }
      } else if (operation.kind === "fix") {
        if (operation.scope === "selection" && !operation.selection) {
          throw new Error("Living Ink selected fix requires a selection mask.");
        }
        this.fixSelectionEnabled = this.uploadSelection(operation.selection);
      }
    }
    this.assertNoGlError("operation-deposition-or-mask");
    const quality = options.quality ?? (operation.kind === "fix" ? "settle" : "interactive");
    const pressureIterations = quality === "settle"
      ? STUDIO_LIVING_INK_EXECUTION_LIMITS.settlePressureIterations
      : STUDIO_LIVING_INK_EXECUTION_LIMITS.interactivePressureIterations;
    let ticks = options.simulationTicks ?? (operation.kind === "advance" ? operation.fixedTicks : 1);
    if (operation.kind === "fix") {
      // Match the reviewed InkWash Fix semantics: flash-dry, advect, then progressively transfer
      // mobile pigment into the immutable well for the declared 1.2-second fixation window.
      ticks = Math.round(
        STUDIO_LIVING_INK_EXECUTION_LIMITS.fixDurationSeconds
          / STUDIO_LIVING_INK_EXECUTION_LIMITS.fixedTimeStepSeconds,
      );
    }
    if (!integer(ticks, 0, STUDIO_LIVING_INK_EXECUTION_LIMITS.maximumAdvanceTicks)) {
      throw new Error("Living Ink simulation tick budget exceeded.");
    }
    const velocitySettling = operation.kind === "advance" && quality === "settle";
    // Settle/advance ticks after pen-up must not keep a ghost scrub tip from the last mark.
    this.clearBrushFootprint();
    for (let tick = 0; tick < ticks; tick += 1) {
      if (isCancelled()) throw new DOMException("Living Ink request cancelled.", "AbortError");
      this.step(
        STUDIO_LIVING_INK_EXECUTION_LIMITS.fixedTimeStepSeconds,
        operation.kind === "fix",
        pressureIterations,
        velocitySettling,
      );
      this.assertNoGlError("fixed-step-simulation");
      if ((tick + 1) % 6 === 0) await yieldControl();
    }
    if (isCancelled()) throw new DOMException("Living Ink request cancelled.", "AbortError");
    this.revision += 1;
    const dirtyBounds = this.simulationBounds();
    const tile = STUDIO_LIVING_INK_EXECUTION_LIMITS.dirtyTileSize;
    const dirtyTileCount = Math.ceil(dirtyBounds.width / tile) * Math.ceil(dirtyBounds.height / tile);
    const operationSha256 = sha256(stableJson(operation));
    if (options.present === false) {
      const applied: StudioLivingInkExecutionApplied = Object.freeze({
        kind: "living-ink/applied",
        version: STUDIO_LIVING_INK_EXECUTION_PROTOCOL_VERSION,
        engineVersion: STUDIO_LIVING_INK_EXECUTION_ENGINE_VERSION,
        requestId,
        revision: this.revision,
        operationKind: operation.kind,
        operationSha256,
        backend: "webgl2-offscreen-half-float",
        dirtyBounds,
        dirtyTileCount,
        passCount: this.passCount,
        pressureIterations,
        simulationTicks: ticks,
        elapsedMilliseconds: performance.now() - started,
        presented: false,
        displayReadbackCount: 0,
        imageBitmapCount: 0,
      });
      return applied;
    }
    const displayMode = options.displayMode ?? this.config.displayMode;
    this.render(displayMode);
    const pixels = this.displayPixels();
    this.assertNoGlError("rgba8-display-readback");
    const receipt: StudioLivingInkExecutionReceipt = Object.freeze({
      kind: "studio-living-ink-execution-receipt",
      version: STUDIO_LIVING_INK_EXECUTION_PROTOCOL_VERSION,
      engineVersion: STUDIO_LIVING_INK_EXECUTION_ENGINE_VERSION,
      requestId,
      revision: this.revision,
      operationKind: operation.kind,
      backend: "webgl2-offscreen-half-float",
      displaySha256: sha256(canonicalStudioLivingInkDisplayRgba8(pixels)),
      displayHashEncoding: "premultiplied-rgba8-v2",
      operationSha256,
      dirtyBounds,
      dirtyTileCount,
      passCount: this.passCount,
      pressureIterations,
      simulationTicks: ticks,
      elapsedMilliseconds: performance.now() - started,
      fixedPigmentPolicy: "immutable",
      dryingWindowSeconds: 2 + (1 - this.config.material.dryRate) * 16,
      fixDurationSeconds: 1.2,
      determinism: "same-runtime-replay",
      crossDeviceBitExact: false,
      cpuOperationHashCrossDeviceDeterministic: true,
      canonicalFrameAuthority: "first-rendered-rgba8-frame",
      replayValidation: "bounded-visual-parity",
      displayReadbackOrientation: "webgl-bottom-left-row-major",
      gpuError: 0,
      readbackFormat: "rgba8-staging-fbo",
      imageOwnership: "caller-must-close",
      contextRecovery: "worker-rebuild-journal-replay",
    });
    const image = await this.presentDisplayPixels(pixels);
    return Object.freeze({ image, receipt });
  }

  async renderFrame(
    requestId: number,
    displayMode: StudioLivingInkDisplayMode,
  ): Promise<StudioLivingInkExecutionFrame> {
    this.assertActive();
    const started = performance.now();
    this.passCount = 0;
    this.render(displayMode);
    const pixels = this.displayPixels();
    const receipt: StudioLivingInkExecutionReceipt = Object.freeze({
      kind: "studio-living-ink-execution-receipt",
      version: STUDIO_LIVING_INK_EXECUTION_PROTOCOL_VERSION,
      engineVersion: STUDIO_LIVING_INK_EXECUTION_ENGINE_VERSION,
      requestId,
      revision: this.revision,
      operationKind: "restore",
      backend: "webgl2-offscreen-half-float",
      displaySha256: sha256(canonicalStudioLivingInkDisplayRgba8(pixels)),
      displayHashEncoding: "premultiplied-rgba8-v2",
      operationSha256: sha256(`render:${displayMode}:${this.revision}`),
      dirtyBounds: this.simulationBounds(),
      dirtyTileCount: 0,
      passCount: this.passCount,
      pressureIterations: 0,
      simulationTicks: 0,
      elapsedMilliseconds: performance.now() - started,
      fixedPigmentPolicy: "immutable",
      dryingWindowSeconds: 2 + (1 - this.config.material.dryRate) * 16,
      fixDurationSeconds: 1.2,
      determinism: "same-runtime-replay",
      crossDeviceBitExact: false,
      cpuOperationHashCrossDeviceDeterministic: true,
      canonicalFrameAuthority: "first-rendered-rgba8-frame",
      replayValidation: "bounded-visual-parity",
      displayReadbackOrientation: "webgl-bottom-left-row-major",
      gpuError: 0,
      readbackFormat: "rgba8-staging-fbo",
      imageOwnership: "caller-must-close",
      contextRecovery: "worker-rebuild-journal-replay",
    });
    const image = await this.presentDisplayPixels(pixels);
    return Object.freeze({ image, receipt });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const gl = this.gl;
    const surfaces: GlSurface[] = [
      this.resources.mobile.read,
      this.resources.mobile.write,
      this.resources.strokeDeposit.read,
      this.resources.strokeDeposit.write,
      this.resources.fixed.read,
      this.resources.fixed.write,
      this.resources.wet.read,
      this.resources.wet.write,
      this.resources.velocity.read,
      this.resources.velocity.write,
      this.resources.pressure.read,
      this.resources.pressure.write,
      this.resources.divergence,
      this.resources.curl,
      this.resources.selection,
      this.resources.display,
    ];
    for (const surface of surfaces) {
      gl.deleteFramebuffer(surface.framebuffer);
      gl.deleteTexture(surface.texture);
    }
    for (const program of Object.values(this.programs)) gl.deleteProgram(program.program);
    gl.deleteBuffer(this.vertexBuffer);
    gl.deleteVertexArray(this.vao);
    this.canvas.removeEventListener("webglcontextlost", this.onContextLost);
    this.canvas.removeEventListener("webglcontextrestored", this.onContextRestored);
  }
}
