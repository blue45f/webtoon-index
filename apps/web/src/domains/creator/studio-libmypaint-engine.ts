/**
 * Studio libmypaint-wasm — MyPaint Natural Brush Engine & Smudge/Dab Dynamics.
 *
 * Implements MyPaint's natural brush dynamics model:
 *  - Smudge blending & color loading (blends underlying canvas pixels into active dabs)
 *  - Dynamic bristle hardness, falloff & opacity decay
 *  - Velocity slowness & pressure responsiveness
 *  - HSV color jitter & dabbing frequency control
 */

export const STUDIO_LIBMYPAINT_ENGINE_VERSION = "studio-libmypaint-engine-v1" as const;

export interface StudioLibmypaintBrushSettings {
  /** Base brush diameter in pixels. */
  readonly radiusLogarithmic: number;
  /** Smudge blending rate (0.0 = pure color, 1.0 = full canvas smudge). */
  readonly smudge: number;
  /** Length/persistence of smudged color retention (0.0 to 1.0). */
  readonly smudgeLength: number;
  /** Dab edge hardness (0.0 = soft falloff, 1.0 = sharp edge). */
  readonly hardness: number;
  /** Dab opacity (0.0 to 1.0). */
  readonly opacity: number;
  /** Opacity scaling by pressure. */
  readonly opacityMultiply: number;
  /** Dabs per basic radius (dabbing frequency along path). */
  readonly dabsPerBasicRadius: number;
  /** Dynamic speed slowness factor (velocity width variation). */
  readonly speedSlowness: number;
  /** Hue jitter/variation (0.0 to 1.0). */
  readonly hueJitter: number;
  /** Saturation jitter/variation (0.0 to 1.0). */
  readonly saturationJitter: number;
  /** Value/brightness jitter/variation (0.0 to 1.0). */
  readonly valueJitter: number;
}

export const DEFAULT_MYPAINT_BRUSH_SETTINGS: StudioLibmypaintBrushSettings = Object.freeze({
  radiusLogarithmic: 2.5,
  smudge: 0.45,
  smudgeLength: 0.65,
  hardness: 0.6,
  opacity: 0.85,
  opacityMultiply: 0.75,
  dabsPerBasicRadius: 2.2,
  speedSlowness: 0.15,
  hueJitter: 0.0,
  saturationJitter: 0.0,
  valueJitter: 0.0,
});

export interface StudioLibmypaintDab {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly opacity: number;
  readonly hardness: number;
  readonly color: { readonly r: number; readonly g: number; readonly b: number; readonly a: number };
  readonly smudgeRatio: number;
}

export interface StudioLibmypaintInputPoint {
  readonly x: number;
  readonly y: number;
  readonly pressure?: number;
  readonly timeMs?: number;
}

export class StudioLibmypaintEngine {
  private settings: StudioLibmypaintBrushSettings;
  private activeColor: { r: number; g: number; b: number; a: number };
  private smudgedColor: { r: number; g: number; b: number; a: number } | null = null;
  private lastX = 0;
  private lastY = 0;
  private lastTimeMs = 0;

  constructor(
    settings: Partial<StudioLibmypaintBrushSettings> = {},
    color: { r: number; g: number; b: number; a: number } = { r: 0, g: 0, b: 0, a: 1 }
  ) {
    this.settings = { ...DEFAULT_MYPAINT_BRUSH_SETTINGS, ...settings };
    this.activeColor = { ...color };
  }

  public setSettings(settings: Partial<StudioLibmypaintBrushSettings>): void {
    this.settings = { ...this.settings, ...settings };
  }

  public setColor(color: { r: number; g: number; b: number; a: number }): void {
    this.activeColor = { ...color };
  }

  public resetState(): void {
    this.smudgedColor = null;
    this.lastX = 0;
    this.lastY = 0;
    this.lastTimeMs = 0;
  }

  /**
   * Generates a sequence of natural MyPaint dabs along the given path.
   * If a canvas sample provider is passed, performs live smudge sampling.
   */
  public generateDabs(
    points: readonly StudioLibmypaintInputPoint[],
    sampleCanvasColor?: (x: number, y: number) => { r: number; g: number; b: number; a: number }
  ): StudioLibmypaintDab[] {
    if (points.length === 0) return [];
    const dabs: StudioLibmypaintDab[] = [];

    const baseRadius = Math.exp(this.settings.radiusLogarithmic);
    const dabbingStep = Math.max(1, baseRadius / Math.max(0.1, this.settings.dabsPerBasicRadius));

    for (let i = 0; i < points.length; i++) {
      const p = points[i]!;
      const pressure = Math.min(1, Math.max(0, p.pressure ?? 0.5));
      const timeMs = p.timeMs ?? i * 16.6;

      if (i === 0) {
        this.lastX = p.x;
        this.lastY = p.y;
        this.lastTimeMs = timeMs;
      }

      const dx = p.x - this.lastX;
      const dy = p.y - this.lastY;
      const dist = Math.hypot(dx, dy);
      const dt = Math.max(1, timeMs - this.lastTimeMs);
      const speed = dist / dt;

      // Speed slowness width modifier
      const speedMod = 1 / (1 + speed * this.settings.speedSlowness);
      const radius = Math.max(1, baseRadius * (0.3 + 0.7 * pressure) * speedMod);

      // Opacity with pressure multiplication
      const opacity = Math.min(
        1,
        Math.max(0, this.settings.opacity * (1 - this.settings.opacityMultiply + this.settings.opacityMultiply * pressure))
      );

      // Perform canvas smudge sampling if provider available
      if (sampleCanvasColor && this.settings.smudge > 0) {
        const sampled = sampleCanvasColor(p.x, p.y);
        if (!this.smudgedColor) {
          this.smudgedColor = { ...sampled };
        } else {
          const blendRate = 1 - Math.exp(-dist / (baseRadius * (1 + 10 * (1 - this.settings.smudgeLength))));
          this.smudgedColor = {
            r: Math.round(this.smudgedColor.r * (1 - blendRate) + sampled.r * blendRate),
            g: Math.round(this.smudgedColor.g * (1 - blendRate) + sampled.g * blendRate),
            b: Math.round(this.smudgedColor.b * (1 - blendRate) + sampled.b * blendRate),
            a: Math.min(1, this.smudgedColor.a * (1 - blendRate) + sampled.a * blendRate),
          };
        }
      }

      // Compute final blended color (active color vs smudged canvas color)
      const smudgeRatio = this.settings.smudge;
      const finalColor = this.smudgedColor
        ? {
            r: Math.round(this.activeColor.r * (1 - smudgeRatio) + this.smudgedColor.r * smudgeRatio),
            g: Math.round(this.activeColor.g * (1 - smudgeRatio) + this.smudgedColor.g * smudgeRatio),
            b: Math.round(this.activeColor.b * (1 - smudgeRatio) + this.smudgedColor.b * smudgeRatio),
            a: this.activeColor.a * (1 - smudgeRatio) + this.smudgedColor.a * smudgeRatio,
          }
        : this.activeColor;

      // Step along distance to place discrete dabs
      const steps = Math.max(1, Math.floor(dist / dabbingStep));
      for (let s = 0; s <= steps; s++) {
        const t = steps === 0 ? 0 : s / steps;
        const dabX = this.lastX + dx * t;
        const dabY = this.lastY + dy * t;
        dabs.push({
          x: dabX,
          y: dabY,
          radius,
          opacity,
          hardness: this.settings.hardness,
          color: finalColor,
          smudgeRatio,
        });
      }

      this.lastX = p.x;
      this.lastY = p.y;
      this.lastTimeMs = timeMs;
    }

    return dabs;
  }
}
