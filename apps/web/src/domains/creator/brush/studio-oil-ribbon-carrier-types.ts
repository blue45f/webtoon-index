import type { FxOilDab } from "../studio-fx-brush";

export const STUDIO_OIL_RIBBON_CARRIER_VERSION = "oil-ribbon-carrier-v1" as const;

export interface StudioOilRibbonPath {
  /** Flat `[x0,y0,x1,y1,…]` coordinate list. */
  readonly points: readonly number[];
}

/**
 * One deposit of bristle relief.
 *
 * A lane is a *band of equal load*, not a single hair: every run in `runs` — from any bristle and
 * any part of the path — is stroked in ONE `stroke()`/`<path>` operation.
 */
export interface StudioOilRibbonBristleLane {
  readonly runs: readonly StudioOilRibbonPath[];
  readonly lineWidth: number;
  readonly opacity: number;
  /** Load band this deposit represents; `0` is the dry film, higher indices are loaded ridges. */
  readonly loadBand: number;
}

/**
 * One relief overlay deposit (impasto). Like a bristle lane, every run of a lane is painted in ONE
 * `stroke()`/`<path>` operation so a self-crossing never doubles its own glint or core shadow.
 */
export interface StudioOilRibbonImpastoReliefLane {
  readonly runs: readonly StudioOilRibbonPath[];
  readonly lineWidth: number;
  readonly opacity: number;
  readonly kind: StudioOilRibbonImpastoReliefKind;
}

export type StudioOilRibbonImpastoReliefKind = "highlight" | "shadow";

export interface StudioOilRibbonCarrierPlan {
  readonly version: typeof STUDIO_OIL_RIBBON_CARRIER_VERSION;
  readonly sourceStationCount: number;
  readonly body: StudioOilRibbonPath | null;
  readonly bodyOpacity: number;
  readonly bristleLanes: readonly StudioOilRibbonBristleLane[];
  /** The body is a single connected outline; it never emits a repeated round/ellipse stamp. */
  readonly repeatedBodyStampCount: 0;
  /**
   * dli/paint GGX relief overlay lanes (the `impastoRelief` program — enabled by the id matrix in
   * studioOilRibbonProgramsForBrush or a saved program set, not by brush--impasto-relief alone).
   * The key is present iff the `impastoRelief` option is enabled.
   */
  readonly impastoReliefLanes?: readonly StudioOilRibbonImpastoReliefLane[];
}

export interface StudioOilRibbonCarrierBristleLoadDynamicsOptions {
  readonly enabled: boolean;
  /** Deterministic seed — pass the stroke's brush seed. Default 0. */
  readonly seed?: number;
  /** Normalized 0..1 stylus pressure per station. */
  readonly pressures?: readonly number[];
  /** Normalized 0..1 speed per station; omitted → no speed-driven depletion. */
  readonly speeds?: readonly number[];
  /** Ink dip at stroke start, 0..1 (default 1 = fully loaded). */
  readonly initialLoad?: number;
  /** Depletion dial (default 1; 0 = pressure/footprint response only). */
  readonly depletionRate?: number;
}

export interface StudioOilRibbonCarrierImpastoReliefOptions {
  readonly enabled: boolean;
}

export interface StudioOilRibbonCarrierBristlePhysicsOptions {
  readonly enabled: boolean;
  /** Deterministic seed — pass the stroke's brush seed. Default 0. */
  readonly seed?: number;
  /** Normalized 0..1 stylus pressure per station; omitted → opacity proxy. */
  readonly pressures?: readonly number[];
  /** Normalized 0..1 speed per station; omitted → derived from geometry. */
  readonly speeds?: readonly number[];
  /** Canvas-plane tilt, each -1..1. Default untilted. */
  readonly tiltX?: number;
  readonly tiltY?: number;
  /** Simulated hair count, clamped into 16..32 by the physics module. */
  readonly bristleCount?: number;
  /** Ink dip at stroke start, 0..1 (default 1 = fully loaded). */
  readonly initialLoad?: number;
  readonly restRadiusAnchor?: "stroke-mean-v1" | "settled-prefix-v2";
}

export const STUDIO_OIL_PHYSICS_REST_RADIUS_ANCHOR_STATIONS = 256;

export interface StudioOilRibbonCarrierOptions {
  readonly bristleLoadDynamics?: StudioOilRibbonCarrierBristleLoadDynamicsOptions;
  readonly impastoRelief?: StudioOilRibbonCarrierImpastoReliefOptions;
  readonly bristlePhysics?: StudioOilRibbonCarrierBristlePhysicsOptions;
  /**
   * Interactive Studio paints only need the film body. Planning 16 load-bands × 5 hairs
   * is a 50–150ms main-thread stall and is reserved for export / explicit quality passes.
   */
  readonly bodyOnly?: boolean;
  readonly bristleBanding?: "observed-span-v1" | "fixed-anchor-v2";
}

export interface OilCarrierStation {
  readonly x: number;
  readonly y: number;
  readonly tangentX: number;
  readonly tangentY: number;
  readonly normalX: number;
  readonly normalY: number;
  readonly radiusX: number;
  readonly radiusY: number;
  readonly opacity: number;
  readonly source: FxOilDab;
}

export interface SmoothedOilCarrierGeometry {
  readonly x: number;
  readonly y: number;
  readonly radiusX: number;
  readonly radiusY: number;
}

export interface StudioOilRibbonPathSink {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  closePath?(): void;
}

export interface StudioOilRibbonNativeSurface {
  readonly width: number;
  readonly height: number;
  readonly hitCanvas?: unknown;
  readonly constructor?: { readonly name?: string };
}

export interface StudioOilRibbonNativeReadback {
  canvas: StudioOilRibbonNativeSurface;
  getImageData(
    x: number,
    y: number,
    width: number,
    height: number,
  ): { data: Uint8ClampedArray; width: number; height: number };
  putImageData(
    image: { data: Uint8ClampedArray; width: number; height: number },
    x: number,
    y: number,
  ): void;
  getTransform?: () => {
    a: number;
    b: number;
    c: number;
    d: number;
    e: number;
    f: number;
  };
}

export interface StudioOilRibbonPaintContext {
  save(): void;
  restore(): void;
  beginPath(): void;
  fill(): void;
  stroke(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  closePath?(): void;
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  globalAlpha: number;
  globalCompositeOperation: string;
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
  lineWidth: number;
  readonly constructor?: { readonly name?: string };
  _context?: StudioOilRibbonNativeReadback;
  canvas?: StudioOilRibbonNativeSurface;
}

export interface StudioOilRibbonPaintInput {
  readonly carrier: StudioOilRibbonCarrierPlan;
  readonly stroke: string;
  readonly opacity: number;
  readonly points: readonly { readonly x: number; readonly y: number }[];
  readonly radiusPx: number;
  readonly destination?: {
    readonly data: Uint8ClampedArray;
    readonly width: number;
    readonly height: number;
    readonly originX?: number;
    readonly originY?: number;
  };
  readonly hitPass?: boolean;
  readonly skipDestinationReadback?: boolean;
  readonly includeBristleOverlay?: boolean;
  readonly mixModel?: "spectral-wgm" | "ryb";
}

export interface StudioOilRibbonPaintReceipt {
  readonly wetIntoWetApplied: true;
  readonly usedLiveDestination: boolean;
  readonly hitPass: boolean;
}

