/**
 * studio-ai-shading-assist.ts
 *
 * AI Shading & Cel Shadow Assistance Engine.
 * Benchmarks Clip Studio Paint Shading Assist and Naver Webtoon AI Painter.
 *
 * - Allows artists to position a virtual 2D light source around character lineart.
 * - Computes light vector projection, shadow offset direction, and 2-step cel shade thresholds.
 * - Auto-adjusts ambient color temperature (warm dawn, neutral daylight, cold moonlight, dramatic backlight).
 */

export type LightDirectionPreset =
  | "top-left"
  | "top"
  | "top-right"
  | "right"
  | "bottom-right"
  | "bottom"
  | "bottom-left"
  | "left"
  | "backlight-rim";

export type AmbientLightingTemperature = "warm-dawn" | "neutral-day" | "cool-moon" | "sunset-golden";

export interface LightSourceConfig {
  readonly direction: LightDirectionPreset;
  readonly intensityPercent: number; // 0..100%
  readonly softnessPercent: number; // 0% (hard sharp cel) ~ 100% (soft gradient)
  readonly temperature: AmbientLightingTemperature;
  readonly enableRimLight: boolean;
}

export interface ComputedShadingParams {
  readonly lightAngleRad: number;
  readonly lightVector: { x: number; y: number };
  readonly shadowOffsetPx: { dx: number; dy: number };
  readonly shadow1Opacity: number; // 0..1
  readonly shadow2Opacity: number;
  readonly shadow1ColorHex: string;
  readonly shadow2ColorHex: string;
  readonly rimLightColorHex?: string;
  readonly promptInstruction: string;
}

export const LIGHT_DIRECTION_ANGLES_DEG: Record<LightDirectionPreset, number> = {
  "top-left": 135,
  top: 90,
  "top-right": 45,
  right: 0,
  "bottom-right": 315,
  bottom: 270,
  "bottom-left": 225,
  left: 180,
  "backlight-rim": 90, // Special inverted back-projected light
};

export class StudioAiShadingAssistEngine {
  /**
   * Computes shading parameters from a given light configuration.
   */
  public compute(config: LightSourceConfig): ComputedShadingParams {
    const angleDeg = LIGHT_DIRECTION_ANGLES_DEG[config.direction] ?? 135;
    const angleRad = (angleDeg * Math.PI) / 180;

    // Light direction vector pointing from light toward origin
    const vx = Math.cos(angleRad);
    const vy = Math.sin(angleRad);

    // Shadow casts in the opposite direction (-vx, -vy)
    const intensity = Math.max(0.1, Math.min(1.0, config.intensityPercent / 100));
    const offsetMagnitude = 18 * intensity;
    const shadowOffsetPx = {
      dx: Math.round(-vx * offsetMagnitude),
      dy: Math.round(-vy * offsetMagnitude),
    };

    // Shadow opacities based on intensity and softness
    const shadow1Opacity = Number((0.35 * intensity).toFixed(2));
    const shadow2Opacity = Number((0.6 * intensity).toFixed(2));

    // Determine shadow tint from ambient temperature
    const colors = this.resolveShadowColors(config.temperature);

    // Build instruction prompt for AI inpainting/generative shading
    const promptInstruction = this.buildPromptInstruction(config);

    return {
      lightAngleRad: angleRad,
      lightVector: { x: Number(vx.toFixed(3)), y: Number(vy.toFixed(3)) },
      shadowOffsetPx,
      shadow1Opacity,
      shadow2Opacity,
      shadow1ColorHex: colors.shadow1,
      shadow2ColorHex: colors.shadow2,
      rimLightColorHex: config.enableRimLight ? colors.rimLight : undefined,
      promptInstruction,
    };
  }

  private resolveShadowColors(temp: AmbientLightingTemperature): {
    shadow1: string;
    shadow2: string;
    rimLight: string;
  } {
    switch (temp) {
      case "warm-dawn":
        return { shadow1: "#701a75", shadow2: "#4a044e", rimLight: "#fde047" };
      case "cool-moon":
        return { shadow1: "#1e1b4b", shadow2: "#0f172a", rimLight: "#38bdf8" };
      case "sunset-golden":
        return { shadow1: "#831843", shadow2: "#4c0519", rimLight: "#fb923c" };
      case "neutral-day":
      default:
        return { shadow1: "#334155", shadow2: "#0f172a", rimLight: "#ffffff" };
    }
  }

  private buildPromptInstruction(config: LightSourceConfig): string {
    const dirLabel = config.direction.replace("-", " ");
    const rimDesc = config.enableRimLight ? "with intense sharp rim lighting highlighting character contours" : "";
    const softDesc = config.softnessPercent < 30 ? "crisp sharp cel shaded webtoon shadow cuts" : "soft blended ambient shadows";

    return `Shading assist: light source positioned at ${dirLabel}, ${config.intensityPercent}% intensity, ${softDesc}, ambient mood ${config.temperature} ${rimDesc}`.trim();
  }
}
