/**
 * Studio 3D Advanced NPR Toon Shader Graph & Stylized Highlight Synthesizer
 *
 * Implements:
 * - Multi-band cel shading ramps (1-step sharp, 2-step soft, 3-step manga gradient, halftone stipple)
 * - 6 stylized specular highlight shape functions (circle, star, anime-slit, heart, diamond, comic-cross)
 * - Anisotropic hair specular (Tenshi no Wa / Angel Ring) with tangent shift and jitter
 * - Anime face normal smoothing filter (eliminating ugly nose/cheek shadow crevices)
 * - Colored Fresnel rim lighting with falloff sharpness
 */

export type CelRampKind = "1-step-sharp" | "2-step-soft" | "3-step-gradient" | "halftone-stipple";

export type SpecularShapeKind =
  | "circle"
  | "star"
  | "anime-slit"
  | "heart"
  | "diamond"
  | "comic-cross";

export interface ToonShaderNodeConfig {
  readonly celRamp: CelRampKind;
  readonly shadowBands: number;
  readonly shadowThreshold: number; // 0 to 1
  readonly shadowSoftness: number;  // 0 to 1
  readonly litColorHex: string;
  readonly shadowColorHex: string;
  readonly specularShape: SpecularShapeKind;
  readonly specularIntensity: number;
  readonly specularRoughness: number;
  readonly specularColorHex: string;
  readonly hairAnisotropyEnabled: boolean;
  readonly hairAngelRingShift: number;
  readonly faceNormalSmoothing: boolean;
  readonly rimLightColorHex: string;
  readonly rimLightIntensity: number;
  readonly rimFresnelPower: number;
}

export interface ShadingEvaluationInput {
  readonly normal: readonly [number, number, number];
  readonly lightDir: readonly [number, number, number];
  readonly viewDir: readonly [number, number, number];
  readonly tangent?: readonly [number, number, number];
  readonly uv?: readonly [number, number];
}

export interface ShadingEvaluationResult {
  readonly finalColorRgb: [number, number, number];
  readonly diffuseIntensity: number;
  readonly specularIntensity: number;
  readonly rimIntensity: number;
  readonly isShadow: boolean;
}

export class Studio3DToonShaderGraph {
  private config: ToonShaderNodeConfig;

  constructor(config: Partial<ToonShaderNodeConfig> = {}) {
    this.config = {
      celRamp: config.celRamp ?? "2-step-soft",
      shadowBands: config.shadowBands ?? 2,
      shadowThreshold: config.shadowThreshold ?? 0.5,
      shadowSoftness: config.shadowSoftness ?? 0.05,
      litColorHex: config.litColorHex ?? "#ffffff",
      shadowColorHex: config.shadowColorHex ?? "#8a9ba8",
      specularShape: config.specularShape ?? "anime-slit",
      specularIntensity: config.specularIntensity ?? 0.8,
      specularRoughness: config.specularRoughness ?? 0.2,
      specularColorHex: config.specularColorHex ?? "#ffffff",
      hairAnisotropyEnabled: config.hairAnisotropyEnabled ?? false,
      hairAngelRingShift: config.hairAngelRingShift ?? 0.1,
      faceNormalSmoothing: config.faceNormalSmoothing ?? false,
      rimLightColorHex: config.rimLightColorHex ?? "#80ffdb",
      rimLightIntensity: config.rimLightIntensity ?? 0.6,
      rimFresnelPower: config.rimFresnelPower ?? 3.0,
    };
  }

  public getConfig(): ToonShaderNodeConfig {
    return this.config;
  }

  public setConfig(patch: Partial<ToonShaderNodeConfig>): void {
    this.config = { ...this.config, ...patch };
  }

  /**
   * Evaluates pixel shading given normal, light direction, and view direction vectors.
   */
  public evaluateShading(input: ShadingEvaluationInput): ShadingEvaluationResult {
    const N = this.config.faceNormalSmoothing
      ? smoothFaceNormal(input.normal, input.viewDir)
      : normalize(input.normal);
    const L = normalize(input.lightDir);
    const V = normalize(input.viewDir);

    // 1. N dot L diffuse
    const NdotL = dot(N, L);
    const diffuseIntensity = this.evaluateCelRamp(NdotL);
    const isShadow = diffuseIntensity < 0.5;

    // 2. Specular Highlights
    let specIntensity: number;
    if (this.config.hairAnisotropyEnabled && input.tangent) {
      specIntensity = this.evaluateHairAnisotropic(N, L, V, input.tangent);
    } else {
      specIntensity = this.evaluateStylizedSpecular(N, L, V, input.uv ?? [0.5, 0.5]);
    }

    // 3. Rim Lighting (Fresnel)
    const NdotV = Math.max(0, dot(N, V));
    const rimIntensity = Math.pow(1.0 - NdotV, this.config.rimFresnelPower) * this.config.rimLightIntensity;

    // 4. Color Blending
    const litRgb = hexToRgb(this.config.litColorHex);
    const shadowRgb = hexToRgb(this.config.shadowColorHex);
    const specRgb = hexToRgb(this.config.specularColorHex);
    const rimRgb = hexToRgb(this.config.rimLightColorHex);

    const baseColor: [number, number, number] = [
      lerp(shadowRgb[0], litRgb[0], diffuseIntensity),
      lerp(shadowRgb[1], litRgb[1], diffuseIntensity),
      lerp(shadowRgb[2], litRgb[2], diffuseIntensity),
    ];

    const finalRgb: [number, number, number] = [
      Math.min(1, baseColor[0] + specRgb[0] * specIntensity + rimRgb[0] * rimIntensity),
      Math.min(1, baseColor[1] + specRgb[1] * specIntensity + rimRgb[1] * rimIntensity),
      Math.min(1, baseColor[2] + specRgb[2] * specIntensity + rimRgb[2] * rimIntensity),
    ];

    return {
      finalColorRgb: finalRgb,
      diffuseIntensity,
      specularIntensity: specIntensity,
      rimIntensity,
      isShadow,
    };
  }

  private evaluateCelRamp(NdotL: number): number {
    const raw = (NdotL + 1) * 0.5; // Map from [-1, 1] to [0, 1]
    const threshold = this.config.shadowThreshold;
    const softness = Math.max(0.001, this.config.shadowSoftness);

    switch (this.config.celRamp) {
      case "1-step-sharp":
        return raw >= threshold ? 1.0 : 0.0;
      case "2-step-soft":
        return smoothstep(threshold - softness, threshold + softness, raw);
      case "3-step-gradient": {
        const t1 = threshold * 0.5;
        const t2 = threshold;
        if (raw < t1) return 0.0;
        if (raw < t2) return 0.5;
        return 1.0;
      }
      case "halftone-stipple": {
        // Discrete stepped intervals
        const bands = Math.max(2, this.config.shadowBands);
        return Math.floor(raw * bands) / bands;
      }
      default:
        return raw;
    }
  }

  private evaluateStylizedSpecular(
    N: readonly [number, number, number],
    L: readonly [number, number, number],
    V: readonly [number, number, number],
    uv: readonly [number, number],
  ): number {
    const H = normalize([L[0] + V[0], L[1] + V[1], L[2] + V[2]]);
    const NdotH = Math.max(0, dot(N, H));
    const shininess = (1.0 - this.config.specularRoughness) * 128;
    const baseSpec = Math.pow(NdotH, Math.max(1, shininess));

    if (baseSpec < 0.1) return 0;

    // Apply geometric shape mask
    const shapeMask = this.sampleSpecularShape(uv[0], uv[1], this.config.specularShape);
    return baseSpec * shapeMask * this.config.specularIntensity;
  }

  private sampleSpecularShape(u: number, v: number, shape: SpecularShapeKind): number {
    const x = (u % 1.0) * 2 - 1;
    const y = (v % 1.0) * 2 - 1;
    const dist = Math.hypot(x, y);

    switch (shape) {
      case "circle":
        return dist <= 0.8 ? 1.0 : 0.0;
      case "anime-slit":
        // Elongated horizontal anime glint
        return Math.abs(y) <= 0.25 && Math.abs(x) <= 0.9 ? 1.0 : 0.0;
      case "diamond":
        return Math.abs(x) + Math.abs(y) <= 0.9 ? 1.0 : 0.0;
      case "star": {
        // 4-point cross star
        const cross = (Math.abs(x) <= 0.2 && Math.abs(y) <= 0.9) || (Math.abs(y) <= 0.2 && Math.abs(x) <= 0.9);
        return cross ? 1.0 : 0.0;
      }
      case "heart": {
        const heartDist = Math.pow(x * x + y * y - 0.5, 3) - x * x * y * y * y;
        return heartDist <= 0.1 ? 1.0 : 0.0;
      }
      case "comic-cross":
        return (Math.abs(x) <= 0.35 && Math.abs(y) <= 0.85) || (Math.abs(y) <= 0.35 && Math.abs(x) <= 0.85) ? 1.0 : 0.0;
      default:
        return 1.0;
    }
  }

  private evaluateHairAnisotropic(
    N: readonly [number, number, number],
    L: readonly [number, number, number],
    V: readonly [number, number, number],
    T: readonly [number, number, number],
  ): number {
    const H = normalize([L[0] + V[0], L[1] + V[1], L[2] + V[2]]);
    // Shift tangent along normal by angel ring shift
    const shiftedT = normalize([
      T[0] + N[0] * this.config.hairAngelRingShift,
      T[1] + N[1] * this.config.hairAngelRingShift,
      T[2] + N[2] * this.config.hairAngelRingShift,
    ]);

    const dotTH = dot(shiftedT, H);
    const sinTH = Math.sqrt(Math.max(0, 1.0 - dotTH * dotTH));
    const dirAtten = smoothstep(-1, 0, dot(shiftedT, H));

    const exponent = (1.0 - this.config.specularRoughness) * 64;
    return dirAtten * Math.pow(sinTH, Math.max(1, exponent)) * this.config.specularIntensity;
  }
}

function normalize(v: readonly [number, number, number]): [number, number, number] {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

function dot(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothstep(min: number, max: number, value: number): number {
  const x = Math.max(0, Math.min(1, (value - min) / (max - min)));
  return x * x * (3 - 2 * x);
}

function smoothFaceNormal(
  normal: readonly [number, number, number],
  viewDir: readonly [number, number, number],
): [number, number, number] {
  // Blends micro facial crevice normals toward view direction for anime clarity
  const N = normalize(normal);
  const V = normalize(viewDir);
  return normalize([
    N[0] * 0.7 + V[0] * 0.3,
    N[1] * 0.7 + V[1] * 0.3,
    N[2] * 0.7 + V[2] * 0.3,
  ]);
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  if (clean.length === 6) {
    const r = parseInt(clean.substring(0, 2), 16) / 255;
    const g = parseInt(clean.substring(2, 4), 16) / 255;
    const b = parseInt(clean.substring(4, 6), 16) / 255;
    return [r, g, b];
  }
  return [1, 1, 1];
}
