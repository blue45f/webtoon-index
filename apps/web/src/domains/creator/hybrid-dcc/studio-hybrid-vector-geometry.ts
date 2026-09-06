/**
 * ToonSpectrum-owned hybrid vector geometry boundary.
 *
 * History, collaboration, save and replay see only the serializable contracts in this file.
 * Vendor modules stay behind lazy, private ports:
 *
 * - pressure outline: perfect-freehand 1.2.x
 * - requested topology repair/union: polygon-clipping 0.15.x
 * - explicit sketch presentation only: roughjs 4.6.x
 *
 * No vendor Drawable, option type, function or class crosses the returned artifact boundary.
 */

import { loadStudioGeometryNodesPlanarBooleanBackend } from "../studio-geometry-nodes-boolean";
import { loadStudioPerfectFreehandStroker } from "../studio-perfect-freehand";
import { loadStudioRoughGenerator } from "../studio-rough-shape";

export const STUDIO_HYBRID_VECTOR_CONTRACT_ID = "toonspectrum.hybrid-vector-geometry";
export const STUDIO_HYBRID_VECTOR_CONTRACT_VERSION = 1 as const;

export type StudioHybridVectorCapabilityId =
  | "pressure-outline"
  | "robust-topology"
  | "seeded-sketch";

export interface StudioHybridVectorCapability {
  readonly id: StudioHybridVectorCapabilityId;
  readonly version: number;
  readonly deterministic: true;
}

export interface StudioHybridVectorBackendReceipt {
  readonly capability: StudioHybridVectorCapabilityId;
  readonly backendId: string;
  readonly packageName: string;
  readonly packageVersion: string;
  readonly licenseSpdx: "MIT";
  readonly licenseNoticeRequired: true;
  readonly publicRepository: string;
  readonly provenance: "installed-public-package-api";
  readonly provenanceEvidence: readonly ["package.json", "LICENSE", "public-api"];
  readonly integrationBoundary: "existing-studio-lazy-wrapper";
  readonly sourceKind: "open-source";
  readonly replaceability: "owned-port-independent-reimplementation";
  readonly replacementFeasibility: "high" | "medium";
  readonly replacementBasis: "public-behavior-specification-only";
  readonly vendorTypesPersisted: false;
}

export interface StudioHybridVectorCleanRoomPolicy {
  readonly version: number;
  readonly executionAdmission: "permissive-oss-only";
  readonly allowedInputs: readonly [
    "public-api",
    "public-documentation",
    "public-behavior-specification",
  ];
  readonly prohibitedInputs: readonly [
    "proprietary-source",
    "decompiled-or-obfuscated-code",
    "paid-asset-copy",
  ];
  readonly proprietaryReplacement: "independent-implementation-through-owned-contract";
  readonly restrictedImplementationClassification: "clean-room-spec-only";
  readonly directPortClassification: "prohibited-direct-port";
  readonly goldenCorpusOwnership: "toonspectrum-independent-behavior-corpus";
}

export interface StudioHybridVectorCapabilityReceipt {
  readonly contractId: typeof STUDIO_HYBRID_VECTOR_CONTRACT_ID;
  readonly contractVersion: typeof STUDIO_HYBRID_VECTOR_CONTRACT_VERSION;
  readonly adapterVersion: string;
  readonly capabilities: readonly StudioHybridVectorCapability[];
  readonly backends: readonly StudioHybridVectorBackendReceipt[];
  readonly cleanRoomPolicy: StudioHybridVectorCleanRoomPolicy;
}

const STUDIO_HYBRID_VECTOR_CLEAN_ROOM_POLICY: StudioHybridVectorCleanRoomPolicy = Object.freeze({
  version: 1,
  executionAdmission: "permissive-oss-only",
  allowedInputs: Object.freeze([
    "public-api",
    "public-documentation",
    "public-behavior-specification",
  ] as const),
  prohibitedInputs: Object.freeze([
    "proprietary-source",
    "decompiled-or-obfuscated-code",
    "paid-asset-copy",
  ] as const),
  proprietaryReplacement: "independent-implementation-through-owned-contract",
  restrictedImplementationClassification: "clean-room-spec-only",
  directPortClassification: "prohibited-direct-port",
  goldenCorpusOwnership: "toonspectrum-independent-behavior-corpus",
});

const STUDIO_HYBRID_VECTOR_BACKENDS: readonly StudioHybridVectorBackendReceipt[] = Object.freeze([
  Object.freeze({
    capability: "pressure-outline",
    backendId: "pressure-outline-js",
    packageName: "perfect-freehand",
    packageVersion: "1.2.3",
    licenseSpdx: "MIT",
    licenseNoticeRequired: true,
    publicRepository: "https://github.com/steveruizok/perfect-freehand",
    provenance: "installed-public-package-api",
    provenanceEvidence: Object.freeze(["package.json", "LICENSE", "public-api"] as const),
    integrationBoundary: "existing-studio-lazy-wrapper",
    sourceKind: "open-source",
    replaceability: "owned-port-independent-reimplementation",
    replacementFeasibility: "high",
    replacementBasis: "public-behavior-specification-only",
    vendorTypesPersisted: false,
  }),
  Object.freeze({
    capability: "robust-topology",
    backendId: "sweep-line-polygon-topology-js",
    packageName: "polygon-clipping",
    packageVersion: "0.15.7",
    licenseSpdx: "MIT",
    licenseNoticeRequired: true,
    publicRepository: "https://github.com/mfogel/polygon-clipping",
    provenance: "installed-public-package-api",
    provenanceEvidence: Object.freeze(["package.json", "LICENSE", "public-api"] as const),
    integrationBoundary: "existing-studio-lazy-wrapper",
    sourceKind: "open-source",
    replaceability: "owned-port-independent-reimplementation",
    replacementFeasibility: "medium",
    replacementBasis: "public-behavior-specification-only",
    vendorTypesPersisted: false,
  }),
  Object.freeze({
    capability: "seeded-sketch",
    backendId: "seeded-sketch-geometry-js",
    packageName: "roughjs",
    packageVersion: "4.6.6",
    licenseSpdx: "MIT",
    licenseNoticeRequired: true,
    publicRepository: "https://github.com/pshihn/rough",
    provenance: "installed-public-package-api",
    provenanceEvidence: Object.freeze(["package.json", "LICENSE", "public-api"] as const),
    integrationBoundary: "existing-studio-lazy-wrapper",
    sourceKind: "open-source",
    replaceability: "owned-port-independent-reimplementation",
    replacementFeasibility: "high",
    replacementBasis: "public-behavior-specification-only",
    vendorTypesPersisted: false,
  }),
]);

export const STUDIO_HYBRID_VECTOR_CAPABILITY_RECEIPT: StudioHybridVectorCapabilityReceipt =
  Object.freeze({
    contractId: STUDIO_HYBRID_VECTOR_CONTRACT_ID,
    contractVersion: STUDIO_HYBRID_VECTOR_CONTRACT_VERSION,
    adapterVersion: "2026.07.28.1",
    capabilities: Object.freeze([
      Object.freeze({ id: "pressure-outline", version: 1, deterministic: true }),
      Object.freeze({ id: "robust-topology", version: 1, deterministic: true }),
      Object.freeze({ id: "seeded-sketch", version: 1, deterministic: true }),
    ]),
    backends: STUDIO_HYBRID_VECTOR_BACKENDS,
    cleanRoomPolicy: STUDIO_HYBRID_VECTOR_CLEAN_ROOM_POLICY,
  });

export interface StudioHybridVectorSample {
  readonly x: number;
  readonly y: number;
  readonly pressure?: number;
}

export interface StudioHybridVectorStroke {
  readonly id: string;
  readonly points: readonly StudioHybridVectorSample[];
}

export type StudioHybridVectorPressureCurve =
  | "linear"
  | "ease-in"
  | "ease-out"
  | "smoothstep";

export type StudioHybridVectorTopology =
  | "preserve"
  | "repair-self-intersections"
  | "union-overlaps";

export interface StudioHybridVectorBaseStyle {
  readonly size: number;
  readonly thinning?: number;
  readonly smoothing?: number;
  readonly streamline?: number;
  readonly simulatePressure?: boolean;
  readonly pressureCurve?: StudioHybridVectorPressureCurve;
  readonly startCap?: boolean;
  readonly endCap?: boolean;
  readonly startTaper?: number;
  readonly endTaper?: number;
  readonly topology?: StudioHybridVectorTopology;
}

export interface StudioHybridVectorInkStyle extends StudioHybridVectorBaseStyle {
  readonly mode: "ink";
}

export interface StudioHybridVectorSketchStyle extends StudioHybridVectorBaseStyle {
  readonly mode: "sketch";
  /** Must be non-zero; rough.js seed zero delegates to Math.random and is forbidden. */
  readonly seed: number;
  readonly roughness?: number;
  readonly bowing?: number;
  readonly sketchStrokeWidth?: number;
  readonly preserveVertices?: boolean;
}

export type StudioHybridVectorStyle =
  | StudioHybridVectorInkStyle
  | StudioHybridVectorSketchStyle;

export interface StudioHybridVectorRequest {
  readonly contractVersion: typeof STUDIO_HYBRID_VECTOR_CONTRACT_VERSION;
  readonly strokes: readonly StudioHybridVectorStroke[];
  readonly style: StudioHybridVectorStyle;
  /** Decimal places retained in vendor-neutral geometry. Default 3, range 0..6. */
  readonly precision?: number;
}

export type StudioHybridVectorPoint = readonly [number, number];
export type StudioHybridVectorRing = readonly StudioHybridVectorPoint[];
export type StudioHybridVectorPolygon = readonly StudioHybridVectorRing[];
export type StudioHybridVectorMultiPolygon = readonly StudioHybridVectorPolygon[];

export type StudioHybridVectorPathCommand =
  | readonly ["M", number, number]
  | readonly ["L", number, number]
  | readonly ["C", number, number, number, number, number, number];

export interface StudioHybridVectorSketchPath {
  readonly id: string;
  readonly role: "outline" | "fill";
  readonly commands: readonly StudioHybridVectorPathCommand[];
}

export interface StudioHybridVectorBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface StudioHybridVectorArtifactReceipt {
  readonly contractId: typeof STUDIO_HYBRID_VECTOR_CONTRACT_ID;
  readonly contractVersion: typeof STUDIO_HYBRID_VECTOR_CONTRACT_VERSION;
  readonly adapterVersion: string;
  readonly usedCapabilities: readonly StudioHybridVectorCapabilityId[];
  readonly backends: readonly StudioHybridVectorBackendReceipt[];
  readonly cleanRoomPolicyVersion: number;
}

export interface StudioHybridVectorArtifact {
  readonly kind: "studio-hybrid-vector-artifact";
  readonly mode: StudioHybridVectorStyle["mode"];
  readonly topology: StudioHybridVectorTopology;
  readonly sourceStrokeIds: readonly string[];
  readonly polygons: StudioHybridVectorMultiPolygon;
  readonly sketchPaths: readonly StudioHybridVectorSketchPath[];
  readonly bounds: StudioHybridVectorBounds;
  readonly vertexCount: number;
  readonly receipt: StudioHybridVectorArtifactReceipt;
}

export type StudioHybridVectorErrorCode =
  | "budget-exceeded"
  | "empty-output"
  | "invalid-request"
  | "outline-failed"
  | "sketch-failed"
  | "topology-failed";

export interface StudioHybridVectorFailure {
  readonly ok: false;
  readonly error: {
    readonly code: StudioHybridVectorErrorCode;
    readonly stage: "validation" | "outline" | "topology" | "sketch";
  };
}

export interface StudioHybridVectorSuccess {
  readonly ok: true;
  readonly artifact: StudioHybridVectorArtifact;
}

export type StudioHybridVectorResult =
  | StudioHybridVectorFailure
  | StudioHybridVectorSuccess;

interface NormalizedStyle {
  readonly mode: "ink" | "sketch";
  readonly size: number;
  readonly thinning: number;
  readonly smoothing: number;
  readonly streamline: number;
  readonly simulatePressure: boolean | null;
  readonly pressureCurve: StudioHybridVectorPressureCurve;
  readonly startCap: boolean;
  readonly endCap: boolean;
  readonly startTaper: number;
  readonly endTaper: number;
  readonly topology: StudioHybridVectorTopology;
  readonly seed: number;
  readonly roughness: number;
  readonly bowing: number;
  readonly sketchStrokeWidth: number;
  readonly preserveVertices: boolean;
}

type MutablePoint = [number, number];
type MutableRing = MutablePoint[];
type MutablePolygon = MutableRing[];
type MutableMultiPolygon = MutablePolygon[];

interface PerfectFreehandPort {
  getStroke(
    points: Array<number[] | { x: number; y: number; pressure?: number }>,
    options: {
      readonly size: number;
      readonly thinning: number;
      readonly smoothing: number;
      readonly streamline: number;
      readonly simulatePressure: boolean;
      readonly easing: (pressure: number) => number;
      readonly last: true;
      readonly start: {
        readonly cap: boolean;
        readonly taper: number;
      };
      readonly end: {
        readonly cap: boolean;
        readonly taper: number;
      };
    }
  ): number[][];
}

interface PolygonClippingPort {
  union(polygons: MutableMultiPolygon): MutableMultiPolygon;
}

interface RoughOperation {
  readonly op: string;
  readonly data: readonly number[];
}

interface RoughOperationSet {
  readonly type: string;
  readonly ops: readonly RoughOperation[];
}

interface RoughGeneratorPort {
  polygon(
    points: readonly MutablePoint[],
    options: {
      readonly seed: number;
      readonly roughness: number;
      readonly bowing: number;
      readonly strokeWidth: number;
      readonly fill: undefined;
      readonly preserveVertices: boolean;
      readonly fixedDecimalPlaceDigits: number;
    }
  ): { readonly sets: readonly RoughOperationSet[] };
}

interface HybridVendorPorts {
  readonly outline: PerfectFreehandPort;
  readonly topology?: PolygonClippingPort;
  readonly sketch?: RoughGeneratorPort;
}

const MAX_STROKES = 256;
const MAX_POINTS = 100_000;
const MAX_OUTPUT_VERTICES = 500_000;
const MAX_COORDINATE = 1_000_000_000;
const MAX_SEED = 2_147_483_646;
const EMPTY_POLYGONS = Object.freeze([]) as StudioHybridVectorMultiPolygon;
const EMPTY_SKETCH_PATHS = Object.freeze([]) as readonly StudioHybridVectorSketchPath[];

let pressurePortPromise: Promise<PerfectFreehandPort> | null = null;
let topologyPortPromise: Promise<PolygonClippingPort> | null = null;
let sketchPortPromise: Promise<RoughGeneratorPort> | null = null;

function failure(
  code: StudioHybridVectorErrorCode,
  stage: StudioHybridVectorFailure["error"]["stage"]
): StudioHybridVectorFailure {
  return Object.freeze({ ok: false, error: Object.freeze({ code, stage }) });
}

function finiteInRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number"
    && Number.isFinite(value)
    && value >= minimum
    && value <= maximum;
}

function validId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 1_024;
}

function normalizedStyle(style: StudioHybridVectorStyle): NormalizedStyle | null {
  if (!style || (style.mode !== "ink" && style.mode !== "sketch")) return null;
  if (!finiteInRange(style.size, 0.1, 4_096)) return null;
  const thinning = style.thinning ?? 0.72;
  const smoothing = style.smoothing ?? 0.65;
  const streamline = style.streamline ?? 0.2;
  const pressureCurve = style.pressureCurve ?? "smoothstep";
  const startTaper = style.startTaper ?? 0;
  const endTaper = style.endTaper ?? 0;
  const topology = style.topology ?? "repair-self-intersections";
  if (
    !finiteInRange(thinning, -1, 1)
    || !finiteInRange(smoothing, 0, 1)
    || !finiteInRange(streamline, 0, 1)
    || !["linear", "ease-in", "ease-out", "smoothstep"].includes(pressureCurve)
    || !finiteInRange(startTaper, 0, 1_000_000)
    || !finiteInRange(endTaper, 0, 1_000_000)
    || !["preserve", "repair-self-intersections", "union-overlaps"].includes(topology)
    || (style.simulatePressure !== undefined && typeof style.simulatePressure !== "boolean")
    || (style.startCap !== undefined && typeof style.startCap !== "boolean")
    || (style.endCap !== undefined && typeof style.endCap !== "boolean")
  ) {
    return null;
  }

  if (style.mode === "ink") {
    return Object.freeze({
      mode: "ink",
      size: style.size,
      thinning,
      smoothing,
      streamline,
      simulatePressure: style.simulatePressure ?? null,
      pressureCurve,
      startCap: style.startCap !== false,
      endCap: style.endCap !== false,
      startTaper,
      endTaper,
      topology,
      seed: 1,
      roughness: 0,
      bowing: 0,
      sketchStrokeWidth: 1,
      preserveVertices: false,
    });
  }

  const roughness = style.roughness ?? 1;
  const bowing = style.bowing ?? 1;
  const sketchStrokeWidth = style.sketchStrokeWidth ?? Math.max(0.5, style.size * 0.08);
  if (
    !Number.isSafeInteger(style.seed)
    || style.seed <= 0
    || style.seed > MAX_SEED
    || !finiteInRange(roughness, 0, 10)
    || !finiteInRange(bowing, 0, 10)
    || !finiteInRange(sketchStrokeWidth, 0.1, 512)
    || (style.preserveVertices !== undefined && typeof style.preserveVertices !== "boolean")
  ) {
    return null;
  }
  return Object.freeze({
    mode: "sketch",
    size: style.size,
    thinning,
    smoothing,
    streamline,
    simulatePressure: style.simulatePressure ?? null,
    pressureCurve,
    startCap: style.startCap !== false,
    endCap: style.endCap !== false,
    startTaper,
    endTaper,
    topology,
    seed: style.seed,
    roughness,
    bowing,
    sketchStrokeWidth,
    preserveVertices: style.preserveVertices === true,
  });
}

function validateRequest(
  request: StudioHybridVectorRequest
): { readonly style: NormalizedStyle; readonly precision: number } | StudioHybridVectorFailure {
  if (
    !request
    || request.contractVersion !== STUDIO_HYBRID_VECTOR_CONTRACT_VERSION
    || !Array.isArray(request.strokes)
    || request.strokes.length === 0
    || request.strokes.length > MAX_STROKES
  ) {
    return failure("invalid-request", "validation");
  }
  const style = normalizedStyle(request.style);
  if (!style) return failure("invalid-request", "validation");
  const precision = request.precision ?? 3;
  if (!Number.isInteger(precision) || precision < 0 || precision > 6) {
    return failure("invalid-request", "validation");
  }

  const ids = new Set<string>();
  let totalPoints = 0;
  for (const stroke of request.strokes) {
    if (!stroke || !validId(stroke.id) || ids.has(stroke.id) || !Array.isArray(stroke.points)) {
      return failure("invalid-request", "validation");
    }
    ids.add(stroke.id);
    if (stroke.points.length === 0) return failure("invalid-request", "validation");
    totalPoints += stroke.points.length;
    if (totalPoints > MAX_POINTS) return failure("budget-exceeded", "validation");
    for (const point of stroke.points) {
      if (
        !point
        || !finiteInRange(point.x, -MAX_COORDINATE, MAX_COORDINATE)
        || !finiteInRange(point.y, -MAX_COORDINATE, MAX_COORDINATE)
        || (
          point.pressure !== undefined
          && !finiteInRange(point.pressure, 0, 1)
        )
      ) {
        return failure("invalid-request", "validation");
      }
    }
  }
  return Object.freeze({ style, precision });
}

function pressureEasing(
  curve: StudioHybridVectorPressureCurve
): (pressure: number) => number {
  if (curve === "ease-in") return (pressure) => pressure * pressure;
  if (curve === "ease-out") return (pressure) => 1 - (1 - pressure) * (1 - pressure);
  if (curve === "smoothstep") return (pressure) => pressure * pressure * (3 - 2 * pressure);
  return (pressure) => pressure;
}

function roundCoordinate(value: number, precision: number): number {
  const scale = 10 ** precision;
  const rounded = Math.round(value * scale) / scale;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function samePoint(left: readonly number[], right: readonly number[]): boolean {
  return Object.is(left[0], right[0]) && Object.is(left[1], right[1]);
}

function signedArea(ring: readonly (readonly number[])[]): number {
  let area = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const current = ring[index]!;
    const next = ring[(index + 1) % ring.length]!;
    area += current[0]! * next[1]! - next[0]! * current[1]!;
  }
  return area / 2;
}

function rotateRingToCanonicalStart(ring: readonly MutablePoint[]): MutableRing {
  let start = 0;
  for (let index = 1; index < ring.length; index += 1) {
    const point = ring[index]!;
    const candidate = ring[start]!;
    if (point[0] < candidate[0] || (point[0] === candidate[0] && point[1] < candidate[1])) {
      start = index;
    }
  }
  return [...ring.slice(start), ...ring.slice(0, start)];
}

function canonicalRing(
  raw: readonly (readonly number[])[],
  precision: number,
  clockwise: boolean
): StudioHybridVectorRing | null {
  const points: MutablePoint[] = [];
  for (const point of raw) {
    if (
      !Array.isArray(point)
      || point.length < 2
      || !finiteInRange(point[0], -MAX_COORDINATE, MAX_COORDINATE)
      || !finiteInRange(point[1], -MAX_COORDINATE, MAX_COORDINATE)
    ) {
      return null;
    }
    const normalized: MutablePoint = [
      roundCoordinate(point[0], precision),
      roundCoordinate(point[1], precision),
    ];
    if (!points.length || !samePoint(points[points.length - 1]!, normalized)) {
      points.push(normalized);
    }
  }
  if (points.length > 1 && samePoint(points[0]!, points[points.length - 1]!)) points.pop();
  if (points.length < 3) return null;
  const area = signedArea(points);
  if (!Number.isFinite(area) || Math.abs(area) <= 10 ** (-precision * 2) * 0.5) return null;
  const shouldReverse = clockwise ? area > 0 : area < 0;
  const oriented = shouldReverse ? [...points].reverse() : points;
  return Object.freeze(
    rotateRingToCanonicalStart(oriented).map((point) => Object.freeze(point))
  );
}

function ringSortKey(ring: StudioHybridVectorRing): string {
  const first = ring[0]!;
  return `${first[0]},${first[1]}:${Math.abs(signedArea(ring))}:${ring.length}`;
}

function canonicalMultiPolygon(
  raw: readonly (readonly (readonly (readonly number[])[])[])[],
  precision: number
): StudioHybridVectorMultiPolygon | null {
  const polygons: StudioHybridVectorPolygon[] = [];
  let vertexCount = 0;
  for (const rawPolygon of raw) {
    if (!Array.isArray(rawPolygon) || rawPolygon.length === 0) return null;
    const outer = canonicalRing(rawPolygon[0]!, precision, false);
    if (!outer) continue;
    const holes: StudioHybridVectorRing[] = [];
    for (const rawHole of rawPolygon.slice(1)) {
      const hole = canonicalRing(rawHole, precision, true);
      if (hole) holes.push(hole);
    }
    holes.sort((left, right) => ringSortKey(left).localeCompare(ringSortKey(right)));
    vertexCount += outer.length + holes.reduce((total, ring) => total + ring.length, 0);
    if (vertexCount > MAX_OUTPUT_VERTICES) return null;
    polygons.push(Object.freeze([outer, ...holes]));
  }
  polygons.sort((left, right) => ringSortKey(left[0]!).localeCompare(ringSortKey(right[0]!)));
  return polygons.length === 0 ? EMPTY_POLYGONS : Object.freeze(polygons);
}

function mutablePolygon(polygon: StudioHybridVectorPolygon): MutablePolygon {
  return polygon.map((ring) => ring.map(([x, y]) => [x, y]));
}

function mutableMultiPolygon(polygons: StudioHybridVectorMultiPolygon): MutableMultiPolygon {
  return polygons.map(mutablePolygon);
}

function outlinePolygons(
  port: PerfectFreehandPort,
  request: StudioHybridVectorRequest,
  style: NormalizedStyle,
  precision: number
): StudioHybridVectorMultiPolygon | null {
  const rawPolygons: MutableMultiPolygon = [];
  for (const stroke of request.strokes) {
    const allPressuresPresent = stroke.points.every((point) => point.pressure !== undefined);
    const simulatePressure = style.simulatePressure ?? !allPressuresPresent;
    const samples = stroke.points.map((point): number[] => [
      point.x,
      point.y,
      point.pressure ?? 0.5,
    ]);
    const outline = port.getStroke(samples, {
      size: style.size,
      thinning: style.thinning,
      smoothing: style.smoothing,
      streamline: style.streamline,
      simulatePressure,
      easing: pressureEasing(style.pressureCurve),
      last: true,
      start: { cap: style.startCap, taper: style.startTaper },
      end: { cap: style.endCap, taper: style.endTaper },
    });
    if (!Array.isArray(outline)) return null;
    rawPolygons.push([outline.map((point) => [point[0]!, point[1]!])]);
  }
  return canonicalMultiPolygon(rawPolygons, precision);
}

async function loadPressurePort(): Promise<PerfectFreehandPort> {
  pressurePortPromise ??= loadStudioPerfectFreehandStroker()
    .then((stroker): PerfectFreehandPort => ({
      getStroke: (points, options) => stroker(points, options),
    }))
    .catch((error: unknown) => {
      pressurePortPromise = null;
      throw error;
    });
  return pressurePortPromise;
}

async function loadTopologyPort(): Promise<PolygonClippingPort> {
  topologyPortPromise ??= loadStudioGeometryNodesPlanarBooleanBackend()
    .then((backend) => {
      const port: PolygonClippingPort = {
        union: (polygons) => {
          if (polygons.length === 0) return [];
          if (polygons.length === 1) {
            // Unioning a self-crossing polygon with itself asks the existing robust backend to
            // canonicalize it under the same non-zero fill rule without adding foreign geometry.
            return backend.combine([polygons[0]!], [polygons[0]!], "union") as MutableMultiPolygon;
          }
          let combined = [polygons[0]!] as MutableMultiPolygon;
          for (const polygon of polygons.slice(1)) {
            combined = backend.combine(combined, [polygon], "union") as MutableMultiPolygon;
          }
          return combined;
        },
      };
      return port;
    })
    .catch((error: unknown) => {
      topologyPortPromise = null;
      throw error;
    });
  return topologyPortPromise;
}

async function loadSketchPort(): Promise<RoughGeneratorPort> {
  sketchPortPromise ??= loadStudioRoughGenerator()
    .then((generator) => generator as RoughGeneratorPort)
    .catch((error: unknown) => {
      sketchPortPromise = null;
      throw error;
    });
  return sketchPortPromise;
}

function applyTopology(
  port: PolygonClippingPort,
  polygons: StudioHybridVectorMultiPolygon,
  topology: StudioHybridVectorTopology,
  precision: number
): StudioHybridVectorMultiPolygon | null {
  if (topology === "preserve") return polygons;
  try {
    if (topology === "union-overlaps") {
      const mutable = mutableMultiPolygon(polygons);
      if (mutable.length === 0) return EMPTY_POLYGONS;
      return canonicalMultiPolygon(port.union(mutable), precision);
    }
    const repaired: MutableMultiPolygon = [];
    for (const polygon of polygons) repaired.push(...port.union([mutablePolygon(polygon)]));
    return canonicalMultiPolygon(repaired, precision);
  } catch {
    return null;
  }
}

function stableSeed(base: number, polygon: number, ring: number): number {
  let value = base ^ Math.imul(polygon + 1, 0x45d9f3b) ^ Math.imul(ring + 1, 0x119de1f3);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value ^= value >>> 16;
  const positive = (value >>> 0) % MAX_SEED;
  return positive === 0 ? 1 : positive;
}

function roughCommands(
  operations: readonly RoughOperation[],
  precision: number
): readonly StudioHybridVectorPathCommand[] | null {
  const commands: StudioHybridVectorPathCommand[] = [];
  for (const operation of operations) {
    const data = operation.data;
    if (!Array.isArray(data) || !data.every(Number.isFinite)) return null;
    if (operation.op === "move" && data.length === 2) {
      commands.push(Object.freeze([
        "M",
        roundCoordinate(data[0]!, precision),
        roundCoordinate(data[1]!, precision),
      ]));
    } else if (operation.op === "lineTo" && data.length === 2) {
      commands.push(Object.freeze([
        "L",
        roundCoordinate(data[0]!, precision),
        roundCoordinate(data[1]!, precision),
      ]));
    } else if (operation.op === "bcurveTo" && data.length === 6) {
      commands.push(Object.freeze([
        "C",
        roundCoordinate(data[0]!, precision),
        roundCoordinate(data[1]!, precision),
        roundCoordinate(data[2]!, precision),
        roundCoordinate(data[3]!, precision),
        roundCoordinate(data[4]!, precision),
        roundCoordinate(data[5]!, precision),
      ]));
    } else {
      return null;
    }
  }
  return commands.length === 0 ? null : Object.freeze(commands);
}

function sketchPaths(
  port: RoughGeneratorPort,
  polygons: StudioHybridVectorMultiPolygon,
  style: NormalizedStyle,
  precision: number
): readonly StudioHybridVectorSketchPath[] | null {
  const paths: StudioHybridVectorSketchPath[] = [];
  for (let polygonIndex = 0; polygonIndex < polygons.length; polygonIndex += 1) {
    const polygon = polygons[polygonIndex]!;
    for (let ringIndex = 0; ringIndex < polygon.length; ringIndex += 1) {
      const ring = polygon[ringIndex]!;
      let drawable: ReturnType<RoughGeneratorPort["polygon"]>;
      try {
        drawable = port.polygon(
          ring.map(([x, y]) => [x, y]),
          {
            seed: stableSeed(style.seed, polygonIndex, ringIndex),
            roughness: style.roughness,
            bowing: style.bowing,
            strokeWidth: style.sketchStrokeWidth,
            fill: undefined,
            preserveVertices: style.preserveVertices,
            fixedDecimalPlaceDigits: precision,
          }
        );
      } catch {
        return null;
      }
      if (!drawable || !Array.isArray(drawable.sets)) return null;
      for (let setIndex = 0; setIndex < drawable.sets.length; setIndex += 1) {
        const set = drawable.sets[setIndex]!;
        const commands = roughCommands(set.ops, precision);
        if (!commands) return null;
        const role = set.type === "fillPath" || set.type === "fillSketch" ? "fill" : "outline";
        paths.push(Object.freeze({
          id: `sketch:${polygonIndex}:${ringIndex}:${setIndex}`,
          role,
          commands,
        }));
      }
    }
  }
  return paths.length === 0 ? null : Object.freeze(paths);
}

function polygonBounds(polygons: StudioHybridVectorMultiPolygon): StudioHybridVectorBounds | null {
  let minimumX = Number.POSITIVE_INFINITY;
  let minimumY = Number.POSITIVE_INFINITY;
  let maximumX = Number.NEGATIVE_INFINITY;
  let maximumY = Number.NEGATIVE_INFINITY;
  for (const polygon of polygons) {
    for (const ring of polygon) {
      for (const [x, y] of ring) {
        minimumX = Math.min(minimumX, x);
        minimumY = Math.min(minimumY, y);
        maximumX = Math.max(maximumX, x);
        maximumY = Math.max(maximumY, y);
      }
    }
  }
  if (![minimumX, minimumY, maximumX, maximumY].every(Number.isFinite)) return null;
  return Object.freeze({
    x: minimumX,
    y: minimumY,
    width: maximumX - minimumX,
    height: maximumY - minimumY,
  });
}

function artifactReceipt(style: NormalizedStyle): StudioHybridVectorArtifactReceipt {
  const capabilities: StudioHybridVectorCapabilityId[] = ["pressure-outline"];
  if (style.topology !== "preserve") capabilities.push("robust-topology");
  if (style.mode === "sketch") capabilities.push("seeded-sketch");
  const used = new Set(capabilities);
  return Object.freeze({
    contractId: STUDIO_HYBRID_VECTOR_CONTRACT_ID,
    contractVersion: STUDIO_HYBRID_VECTOR_CONTRACT_VERSION,
    adapterVersion: STUDIO_HYBRID_VECTOR_CAPABILITY_RECEIPT.adapterVersion,
    usedCapabilities: Object.freeze(capabilities),
    backends: Object.freeze(
      STUDIO_HYBRID_VECTOR_BACKENDS.filter((backend) => used.has(backend.capability))
    ),
    cleanRoomPolicyVersion: STUDIO_HYBRID_VECTOR_CLEAN_ROOM_POLICY.version,
  });
}

async function renderWithPorts(
  request: StudioHybridVectorRequest,
  style: NormalizedStyle,
  precision: number,
  ports: HybridVendorPorts
): Promise<StudioHybridVectorResult> {
  let polygons: StudioHybridVectorMultiPolygon | null;
  try {
    polygons = outlinePolygons(ports.outline, request, style, precision);
  } catch {
    return failure("outline-failed", "outline");
  }
  if (!polygons) return failure("outline-failed", "outline");
  if (polygons.length === 0) return failure("empty-output", "outline");

  if (style.topology !== "preserve") {
    if (!ports.topology) return failure("topology-failed", "topology");
    polygons = applyTopology(ports.topology, polygons, style.topology, precision);
    if (!polygons) return failure("topology-failed", "topology");
    if (polygons.length === 0) return failure("empty-output", "topology");
  }

  let paths = EMPTY_SKETCH_PATHS;
  if (style.mode === "sketch") {
    if (!ports.sketch) return failure("sketch-failed", "sketch");
    const planned = sketchPaths(ports.sketch, polygons, style, precision);
    if (!planned) return failure("sketch-failed", "sketch");
    paths = planned;
  }

  const bounds = polygonBounds(polygons);
  if (!bounds) return failure("empty-output", "outline");
  const vertexCount = polygons.reduce((polygonTotal, polygon) => (
    polygonTotal + polygon.reduce((ringTotal, ring) => ringTotal + ring.length, 0)
  ), 0);
  const artifact: StudioHybridVectorArtifact = Object.freeze({
    kind: "studio-hybrid-vector-artifact",
    mode: style.mode,
    topology: style.topology,
    sourceStrokeIds: Object.freeze(request.strokes.map((stroke) => stroke.id)),
    polygons,
    sketchPaths: paths,
    bounds,
    vertexCount,
    receipt: artifactReceipt(style),
  });
  return Object.freeze({ ok: true, artifact });
}

/**
 * Production entry point. Loading is capability-driven: simple ink/preserve never loads topology
 * or sketch providers, while sketch always starts from the same pressure-aware silhouette.
 */
export async function renderStudioHybridVectorGeometry(
  request: StudioHybridVectorRequest
): Promise<StudioHybridVectorResult> {
  const validated = validateRequest(request);
  if ("ok" in validated) return validated;

  let outline: PerfectFreehandPort;
  try {
    outline = await loadPressurePort();
  } catch {
    return failure("outline-failed", "outline");
  }

  let topology: PolygonClippingPort | undefined;
  if (validated.style.topology !== "preserve") {
    try {
      topology = await loadTopologyPort();
    } catch {
      return failure("topology-failed", "topology");
    }
  }

  let sketch: RoughGeneratorPort | undefined;
  if (validated.style.mode === "sketch") {
    try {
      sketch = await loadSketchPort();
    } catch {
      return failure("sketch-failed", "sketch");
    }
  }

  return renderWithPorts(request, validated.style, validated.precision, {
    outline,
    ...(topology ? { topology } : {}),
    ...(sketch ? { sketch } : {}),
  });
}
