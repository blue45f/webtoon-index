/**
 * Studio Six Engine Filter Service — Unified Filter & Dynamics Registry.
 *
 * Integrates all specialist filters across the 6 engines:
 *  1. MyPaint: Smudge Blend, Speed Slowness, HSV Jitter
 *  2. Krita Core: Parametric Tip, Dual Brush Masking, Texture Grain
 *  3. Glance: Wet Edge Gloss, Paper Bump, Tone & Bloom Preview
 *  4. Vello: WGPU Tile Binning & Subpixel Anti-Aliased Vector Pathing
 *  5. Pathfinder: Path Outline Offset & Boolean Operation Filters
 *  6. Perfect Freehand: Streamline Smoothing & Tapering Filters
 */

import { StudioVelloVectorEngine, type StudioVelloPathSegment, type StudioVelloStrokeStyle, type StudioVelloTile } from "./render/studio-vello-vector-engine";
import { StudioGlanceEngine, type StudioGlanceFilterParams } from "./studio-glance-engine";
import { StudioKritaCoreEngine, type StudioKritaDualBlendMode, type StudioKritaParametricTipConfig } from "./studio-krita-core-engine";
import { StudioLibmypaintEngine, type StudioLibmypaintBrushSettings } from "./studio-libmypaint-engine";
import { StudioPathfinderVectorEngine, type StudioPathfinderPoint, type StudioPathfinderPolygon } from "./studio-pathfinder-vector-engine";
import { STUDIO_PERFECT_FREEHAND_PROFILES } from "./studio-perfect-freehand";

export const STUDIO_SIX_ENGINE_FILTER_SERVICE_VERSION = "studio-six-engine-filter-service-v1" as const;

export interface StudioSixEngineFilterSet {
  readonly mypaintSmudge: boolean;
  readonly mypaintHsvJitter: boolean;
  readonly kritaParametricTip: boolean;
  readonly kritaDualBrush: boolean;
  readonly kritaTextureGrain: boolean;
  readonly glanceWetGloss: boolean;
  readonly glancePaperBump: boolean;
  readonly glanceBloomTone: boolean;
  readonly velloTileRaster: boolean;
  readonly pathfinderOffset: boolean;
  readonly freehandStreamline: boolean;
}

export class StudioSixEngineFilterService {
  /**
   * Applies Glance GPU Preview Filters (Wet-edge gloss, Paper bump, Contrast, Bloom).
   */
  public static applyGlanceFilters(
    rgba: Uint8ClampedArray,
    width: number,
    height: number,
    params?: Partial<StudioGlanceFilterParams>
  ): Uint8ClampedArray {
    const engine = new StudioGlanceEngine(params);
    return engine.applyPreviewFilter(rgba, width, height);
  }

  /**
   * Generates a Krita Parametric Tip Mask with optional Dual Brush blending.
   */
  public static createKritaTipMask(
    primaryConfig: StudioKritaParametricTipConfig,
    dualConfig?: { config: StudioKritaParametricTipConfig; mode: StudioKritaDualBlendMode }
  ) {
    const primary = StudioKritaCoreEngine.generateParametricTipMask(primaryConfig);
    if (!dualConfig) return primary;
    const secondary = StudioKritaCoreEngine.generateParametricTipMask(dualConfig.config);
    return StudioKritaCoreEngine.blendDualBrushMask(primary, secondary, dualConfig.mode);
  }

  /**
   * Generates MyPaint Smudge & Velocity Dabs.
   */
  public static generateMyPaintDabs(
    points: readonly { x: number; y: number; pressure?: number; timeMs?: number }[],
    settings?: Partial<StudioLibmypaintBrushSettings>,
    sampleCanvasColor?: (x: number, y: number) => { r: number; g: number; b: number; a: number }
  ) {
    const engine = new StudioLibmypaintEngine(settings);
    return engine.generateDabs(points, sampleCanvasColor);
  }

  /**
   * Performs Pathfinder GPU Vector Path Offsetting.
   */
  public static offsetVectorPath(
    points: readonly StudioPathfinderPoint[],
    radius: number
  ): StudioPathfinderPolygon {
    return StudioPathfinderVectorEngine.offsetPathOutline(points, radius);
  }

  /**
   * Generates Vello WGPU Coarse/Fine Stroke Tile Binning.
   */
  public static binVelloTiles(
    segments: readonly StudioVelloPathSegment[],
    style: StudioVelloStrokeStyle,
    tileSize = 16
  ): StudioVelloTile[] {
    const engine = new StudioVelloVectorEngine(tileSize);
    return engine.generateTiles(segments, style);
  }

  /**
   * Resolves Perfect Freehand Stroke Outline Profile.
   */
  public static getFreehandProfile(brushId: "perfect-ink" | "perfect-marker" | "gpen") {
    return STUDIO_PERFECT_FREEHAND_PROFILES[brushId];
  }
}
