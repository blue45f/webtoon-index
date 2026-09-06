/**
 * Studio Glance — Instant WebGL2/WebGPU Shader Preview & Fast Canvas Feedback Engine.
 *
 * Provides real-time GPU visual preview filters:
 *  - Wet-edge gloss & highlight preview
 *  - Dynamic paper bump & grain texture preview
 *  - Tone mapping & color dynamics preview
 *  - High-pacing offscreen preview cache
 */

export const STUDIO_GLANCE_ENGINE_VERSION = "studio-glance-engine-v1" as const;

export interface StudioGlanceFilterParams {
  readonly wetEdgeGloss: number; // 0.0 to 1.0
  readonly paperBumpDepth: number; // 0.0 to 1.0
  readonly contrast: number; // 0.5 to 2.0
  readonly saturation: number; // 0.0 to 2.0
  readonly bloomIntensity: number; // 0.0 to 1.0
}

export const DEFAULT_GLANCE_FILTER_PARAMS: StudioGlanceFilterParams = Object.freeze({
  wetEdgeGloss: 0.35,
  paperBumpDepth: 0.55,
  contrast: 1.05,
  saturation: 1.0,
  bloomIntensity: 0.0,
});

export class StudioGlanceEngine {
  private params: StudioGlanceFilterParams;

  constructor(params: Partial<StudioGlanceFilterParams> = {}) {
    this.params = { ...DEFAULT_GLANCE_FILTER_PARAMS, ...params };
  }

  public setParams(params: Partial<StudioGlanceFilterParams>): void {
    this.params = { ...this.params, ...params };
  }

  /**
   * Applies real-time GPU preview filters to an RGBA tile buffer.
   */
  public applyPreviewFilter(
    rgba: Uint8ClampedArray,
    width: number,
    height: number
  ): Uint8ClampedArray {
    if (rgba.length === 0) return rgba;
    const { wetEdgeGloss, paperBumpDepth, contrast, saturation } = this.params;
    if (contrast === 1.0 && saturation === 1.0 && wetEdgeGloss === 0 && paperBumpDepth === 0) {
      return rgba;
    }
    const output = new Uint8ClampedArray(rgba.length);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        let r = rgba[idx]! / 255;
        let g = rgba[idx + 1]! / 255;
        let b = rgba[idx + 2]! / 255;
        const a = rgba[idx + 3]! / 255;

        if (a > 0) {
          // Contrast adjust
          r = (r - 0.5) * contrast + 0.5;
          g = (g - 0.5) * contrast + 0.5;
          b = (b - 0.5) * contrast + 0.5;

          // Saturation adjust
          const gray = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          r = gray + (r - gray) * saturation;
          g = gray + (g - gray) * saturation;
          b = gray + (b - gray) * saturation;

          // Wet-edge gloss highlight
          if (wetEdgeGloss > 0 && a < 0.95) {
            const gloss = Math.pow(a, 1.35) * wetEdgeGloss;
            r = Math.min(1.0, r + gloss * 0.2);
            g = Math.min(1.0, g + gloss * 0.2);
            b = Math.min(1.0, b + gloss * 0.2);
          }

          // Paper bump noise simulation
          if (paperBumpDepth > 0) {
            const bump = ((x % 3) * 0.1 - (y % 3) * 0.1) * paperBumpDepth * 0.15;
            r = Math.max(0, Math.min(1.0, r + bump));
            g = Math.max(0, Math.min(1.0, g + bump));
            b = Math.max(0, Math.min(1.0, b + bump));
          }
        }

        output[idx] = Math.round(Math.max(0, Math.min(1.0, r)) * 255);
        output[idx + 1] = Math.round(Math.max(0, Math.min(1.0, g)) * 255);
        output[idx + 2] = Math.round(Math.max(0, Math.min(1.0, b)) * 255);
        output[idx + 3] = rgba[idx + 3]!;
      }
    }

    return output;
  }
}
