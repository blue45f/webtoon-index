import {
  STUDIO_ISOMETRIC_COORDINATE_MAX,
  STUDIO_ISOMETRIC_CYLINDER_SEGMENTS_MAX,
  STUDIO_ISOMETRIC_CYLINDER_SEGMENTS_MIN,
  STUDIO_ISOMETRIC_PRIMITIVE_DIMENSION_MAX,
  STUDIO_ISOMETRIC_PRIMITIVE_DIMENSION_MIN,
  STUDIO_ISOMETRIC_STAIRS_STEPS_MAX,
  STUDIO_ISOMETRIC_STAIRS_STEPS_MIN,
  type StudioIsometricPrimitiveKind,
  type StudioIsometricPrimitiveSpec,
} from "./studio-isometric-primitive-contract";

import type { DrawEl } from "./studio-element-model";

export {
  STUDIO_ISOMETRIC_COORDINATE_MAX,
  STUDIO_ISOMETRIC_CYLINDER_SEGMENTS_MAX,
  STUDIO_ISOMETRIC_CYLINDER_SEGMENTS_MIN,
  STUDIO_ISOMETRIC_PRIMITIVE_DIMENSION_MAX,
  STUDIO_ISOMETRIC_PRIMITIVE_DIMENSION_MIN,
  STUDIO_ISOMETRIC_STAIRS_STEPS_MAX,
  STUDIO_ISOMETRIC_STAIRS_STEPS_MIN,
  type StudioIsometricPrimitiveKind,
  type StudioIsometricPrimitiveSpec,
} from "./studio-isometric-primitive-contract";

/**
 * Editable isometric primitive generation.
 *
 * This deliberately produces ordinary Studio draw elements instead of a private 3D payload. Each
 * visible face can therefore be recoloured, node-edited, duplicated and exported by the existing
 * document pipeline. It is a drafting primitive, not a hidden perspective renderer.
 */

export interface StudioIsometricPoint3 {
  x: number;
  y: number;
  z: number;
}
export interface StudioIsometricPoint2 {
  x: number;
  y: number;
}

export interface StudioIsometricSolidInput {
  originX: number;
  originY: number;
  angleDeg: number;
  width: number;
  depth: number;
  height: number;
}

export type StudioIsometricFaceId = "left" | "right" | "top";

export interface StudioIsometricSolidFace {
  id: StudioIsometricFaceId;
  points: readonly [
    StudioIsometricPoint2,
    StudioIsometricPoint2,
    StudioIsometricPoint2,
    StudioIsometricPoint2,
  ];
}

export interface StudioIsometricSolidPlan {
  input: StudioIsometricSolidInput;
  vertices: Readonly<Record<
    "origin" | "x" | "y" | "xy" | "z" | "xz" | "yz" | "xyz",
    StudioIsometricPoint2
  >>;
  faces: readonly [StudioIsometricSolidFace, StudioIsometricSolidFace, StudioIsometricSolidFace];
  bounds: { x: number; y: number; width: number; height: number };
}

export interface StudioIsometricSolidElementOptions {
  ids: readonly [string, string, string];
  baseColor: string;
  strokeColor?: string;
  strokeWidth?: number;
  opacity?: number;
  namePrefix?: string;
}

export type StudioIsometricPrimitiveInput = StudioIsometricPrimitiveSpec & Pick<
  StudioIsometricSolidInput,
  "originX" | "originY" | "angleDeg"
>;

export type StudioIsometricPrimitiveFaceRole =
  | "side"
  | "top"
  | "riser"
  | "tread"
  | "slope";

export interface StudioIsometricPrimitiveFace {
  /** Stable semantic id inside one generated primitive; document element ids remain caller-owned. */
  id: string;
  label: string;
  role: StudioIsometricPrimitiveFaceRole;
  /** Clockwise in screen coordinates (whose positive Y axis points down). */
  points: readonly StudioIsometricPoint2[];
  /** Larger values paint earlier. The key includes explicit cap/side occlusion constraints. */
  paintDepth: number;
  /** Signed blend against the base colour: negative darkens, positive lightens. */
  shadeAmount: number;
}

export interface StudioIsometricPrimitivePlan {
  kind: StudioIsometricPrimitiveKind;
  input: StudioIsometricPrimitiveInput;
  /** Ordinary vector faces in deterministic back-to-front painter order. */
  faces: readonly StudioIsometricPrimitiveFace[];
  bounds: { x: number; y: number; width: number; height: number };
}

export interface StudioIsometricPrimitiveElementOptions {
  /** Must contain one unique document id for every face in plan.faces, in the same order. */
  ids: readonly string[];
  baseColor: string;
  strokeColor?: string;
  strokeWidth?: number;
  opacity?: number;
  namePrefix?: string;
}

const MIN_ANGLE_DEG = 1;
const MAX_ANGLE_DEG = 89;
const MIN_DIMENSION = STUDIO_ISOMETRIC_PRIMITIVE_DIMENSION_MIN;
const MAX_DIMENSION = STUDIO_ISOMETRIC_PRIMITIVE_DIMENSION_MAX;
const MAX_COORDINATE = STUDIO_ISOMETRIC_COORDINATE_MAX;

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function coordinate(value: unknown): number {
  return clamp(finite(value, 0), -MAX_COORDINATE, MAX_COORDINATE);
}

function dimension(value: unknown): number {
  return clamp(Math.abs(finite(value, MIN_DIMENSION)), MIN_DIMENSION, MAX_DIMENSION);
}

function integer(value: unknown, fallback: number, min: number, max: number): number {
  return clamp(Math.round(finite(value, fallback)), min, max);
}

function cylinderSegments(value: unknown): number {
  const rounded = integer(
    value,
    24,
    STUDIO_ISOMETRIC_CYLINDER_SEGMENTS_MIN,
    STUDIO_ISOMETRIC_CYLINDER_SEGMENTS_MAX
  );
  // An even segment count gives the visible half-cylinder an exact, deterministic number of bands.
  return rounded % 2 === 0
    ? rounded
    : Math.min(STUDIO_ISOMETRIC_CYLINDER_SEGMENTS_MAX, rounded + 1);
}

function projectionOffset(
  point: StudioIsometricPoint3,
  angleDeg: number
): StudioIsometricPoint2 {
  const angle = clamp(finite(angleDeg, 30), MIN_ANGLE_DEG, MAX_ANGLE_DEG)
    * Math.PI / 180;
  const x = coordinate(point.x);
  const depth = coordinate(point.y);
  const z = coordinate(point.z);
  return {
    x: (x - depth) * Math.cos(angle),
    y: (x + depth) * Math.sin(angle) - z,
  };
}

function fitOriginAxisToCoordinateBudget(
  origin: number,
  minimumOffset: number,
  maximumOffset: number
): number {
  return clamp(
    coordinate(origin),
    -MAX_COORDINATE - minimumOffset,
    MAX_COORDINATE - maximumOffset
  );
}

export function normalizeStudioIsometricSolidInput(
  input: StudioIsometricSolidInput
): StudioIsometricSolidInput {
  const angleDeg = clamp(finite(input.angleDeg, 30), MIN_ANGLE_DEG, MAX_ANGLE_DEG);
  const width = dimension(input.width);
  const depth = dimension(input.depth);
  const height = dimension(input.height);
  const angle = angleDeg * Math.PI / 180;
  const minimumXOffset = -depth * Math.cos(angle);
  const maximumXOffset = width * Math.cos(angle);
  const minimumYOffset = -height;
  const maximumYOffset = (width + depth) * Math.sin(angle);
  return {
    originX: fitOriginAxisToCoordinateBudget(
      input.originX,
      minimumXOffset,
      maximumXOffset
    ),
    originY: fitOriginAxisToCoordinateBudget(
      input.originY,
      minimumYOffset,
      maximumYOffset
    ),
    angleDeg,
    width,
    depth,
    height,
  };
}

/** Projects drafting-space x/y/depth and z/height onto the Studio canvas. */
export function projectStudioIsometricPoint(
  point: StudioIsometricPoint3,
  input: Pick<StudioIsometricSolidInput, "originX" | "originY" | "angleDeg">
): StudioIsometricPoint2 {
  const safeOriginX = coordinate(input.originX);
  const safeOriginY = coordinate(input.originY);
  const offset = projectionOffset(point, input.angleDeg);
  return {
    // Standalone callers can project arbitrary bounded points without first planning a primitive.
    // Keep that public edge inside the same coordinate budget enforced by stroke CRDT admission.
    x: coordinate(safeOriginX + offset.x),
    y: coordinate(safeOriginY + offset.y),
  };
}

export function planStudioIsometricSolid(
  input: StudioIsometricSolidInput
): StudioIsometricSolidPlan {
  const safe = normalizeStudioIsometricSolidInput(input);
  const project = (x: number, y: number, z: number) => projectStudioIsometricPoint(
    { x, y, z },
    safe
  );
  const vertices = {
    origin: project(0, 0, 0),
    x: project(safe.width, 0, 0),
    y: project(0, safe.depth, 0),
    xy: project(safe.width, safe.depth, 0),
    z: project(0, 0, safe.height),
    xz: project(safe.width, 0, safe.height),
    yz: project(0, safe.depth, safe.height),
    xyz: project(safe.width, safe.depth, safe.height),
  } as const;

  // Far faces are intentionally omitted: the output is the three visible drafting faces.
  const faces = [
    { id: "left", points: [vertices.origin, vertices.y, vertices.yz, vertices.z] },
    { id: "right", points: [vertices.origin, vertices.z, vertices.xz, vertices.x] },
    { id: "top", points: [vertices.z, vertices.yz, vertices.xyz, vertices.xz] },
  ] as const satisfies readonly StudioIsometricSolidFace[];
  const all = Object.values(vertices);
  const xs = all.map((point) => point.x);
  const ys = all.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    input: safe,
    vertices,
    faces,
    bounds: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
  };
}

interface StudioIsometricRawPrimitiveFace {
  id: string;
  label: string;
  role: StudioIsometricPrimitiveFaceRole;
  points: readonly StudioIsometricPoint3[];
  shadeAmount: number;
  sourceOrder: number;
}

function normalizeStudioIsometricPrimitiveInput(
  input: StudioIsometricPrimitiveInput
): StudioIsometricPrimitiveInput {
  const common = normalizeStudioIsometricSolidInput(input);
  const dimensions = {
    originX: common.originX,
    originY: common.originY,
    angleDeg: common.angleDeg,
    width: common.width,
    depth: common.depth,
    height: common.height,
  };
  switch (input.kind) {
    case "cylinder":
      return { ...dimensions, kind: input.kind, segments: cylinderSegments(input.segments) };
    case "stairs":
      return {
        ...dimensions,
        kind: input.kind,
        steps: integer(
          input.steps,
          6,
          STUDIO_ISOMETRIC_STAIRS_STEPS_MIN,
          STUDIO_ISOMETRIC_STAIRS_STEPS_MAX
        ),
      };
    case "wedge":
    case "box":
      return { ...dimensions, kind: input.kind };
  }
}

function point3(x: number, y: number, z: number): StudioIsometricPoint3 {
  return { x, y, z };
}

function screenSignedArea(points: readonly StudioIsometricPoint2[]): number {
  let doubledArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!;
    const next = points[(index + 1) % points.length]!;
    doubledArea += current.x * next.y - next.x * current.y;
  }
  return doubledArea / 2;
}

function ensureClockwiseScreenWinding(
  points: readonly StudioIsometricPoint2[]
): readonly StudioIsometricPoint2[] {
  if (screenSignedArea(points) >= 0 || points.length < 3) return points;
  // Preserve the semantic anchor at index zero while reversing the remaining winding.
  return [points[0]!, ...points.slice(1).reverse()];
}

function rawFace(
  id: string,
  label: string,
  role: StudioIsometricPrimitiveFaceRole,
  points: readonly StudioIsometricPoint3[],
  shadeAmount: number,
  sourceOrder: number
): StudioIsometricRawPrimitiveFace {
  return { id, label, role, points, shadeAmount, sourceOrder };
}

function boxRawFaces(
  width: number,
  depth: number,
  height: number
): StudioIsometricRawPrimitiveFace[] {
  const origin = point3(0, 0, 0);
  const x = point3(width, 0, 0);
  const y = point3(0, depth, 0);
  const z = point3(0, 0, height);
  const xz = point3(width, 0, height);
  const yz = point3(0, depth, height);
  const xyz = point3(width, depth, height);
  return [
    rawFace("left", "왼쪽 면", "side", [origin, y, yz, z], -0.2, 0),
    rawFace("right", "오른쪽 면", "side", [origin, z, xz, x], -0.08, 1),
    rawFace("top", "윗면", "top", [z, yz, xyz, xz], 0.22, 2),
  ];
}

function cylinderRawFaces(
  width: number,
  depth: number,
  height: number,
  segments: number
): StudioIsometricRawPrimitiveFace[] {
  const radiusX = width / 2;
  const radiusY = depth / 2;
  const ring = Array.from({ length: segments }, (_, index) => {
    const angle = index / segments * Math.PI * 2;
    return point3(radiusX * Math.cos(angle), radiusY * Math.sin(angle), 0);
  });
  const faces: StudioIsometricRawPrimitiveFace[] = [];
  // Begin at the projected right silhouette and walk over the front/lower half of the ellipse.
  // A fixed 3/8 turn selected the back arc (and was only geometrically correct for a circle), so
  // squat cylinders painted their cap first and then covered it with the wrong side bands.
  const silhouetteAngle = Math.atan2(-radiusY, radiusX);
  const normalizedSilhouetteAngle = (
    silhouetteAngle + Math.PI * 2
  ) % (Math.PI * 2);
  const visibleStart = Math.round(
    normalizedSilhouetteAngle / (Math.PI * 2) * segments
  ) % segments;
  const visibleBandCount = segments / 2;
  for (let band = 0; band < visibleBandCount; band += 1) {
    const startIndex = (visibleStart + band) % segments;
    const endIndex = (startIndex + 1) % segments;
    const bottomStart = ring[startIndex]!;
    const bottomEnd = ring[endIndex]!;
    const midpointAngle = (visibleStart + band + 0.5) / segments * Math.PI * 2;
    const light = (-Math.cos(midpointAngle) * 0.6) + (-Math.sin(midpointAngle) * 0.4);
    faces.push(rawFace(
      `side-${String(band + 1).padStart(2, "0")}`,
      `곡면 ${band + 1}`,
      "side",
      [
        bottomStart,
        bottomEnd,
        point3(bottomEnd.x, bottomEnd.y, height),
        point3(bottomStart.x, bottomStart.y, height),
      ],
      clamp(-0.18 + light * 0.12, -0.32, -0.04),
      band
    ));
  }
  faces.push(rawFace(
    "top",
    "윗면",
    "top",
    ring.map(({ x, y }) => point3(x, y, height)),
    0.22,
    visibleBandCount
  ));
  return faces;
}

function stairsRawFaces(
  width: number,
  depth: number,
  height: number,
  steps: number
): StudioIsometricRawPrimitiveFace[] {
  const stepDepth = depth / steps;
  const stepHeight = height / steps;
  const sideProfile: StudioIsometricPoint3[] = [point3(0, 0, 0)];
  const faces: StudioIsometricRawPrimitiveFace[] = [];

  for (let step = 0; step < steps; step += 1) {
    const nearY = step * stepDepth;
    const farY = (step + 1) * stepDepth;
    const lowerZ = step * stepHeight;
    const upperZ = (step + 1) * stepHeight;
    sideProfile.push(point3(0, nearY, upperZ), point3(0, farY, upperZ));
    faces.push(
      rawFace(
        `riser-${String(step + 1).padStart(2, "0")}`,
        `챌면 ${step + 1}`,
        "riser",
        [
          point3(0, nearY, lowerZ),
          point3(0, nearY, upperZ),
          point3(width, nearY, upperZ),
          point3(width, nearY, lowerZ),
        ],
        -0.1,
        step * 2
      ),
      rawFace(
        `tread-${String(step + 1).padStart(2, "0")}`,
        `디딤판 ${step + 1}`,
        "tread",
        [
          point3(0, nearY, upperZ),
          point3(0, farY, upperZ),
          point3(width, farY, upperZ),
          point3(width, nearY, upperZ),
        ],
        0.2,
        step * 2 + 1
      )
    );
  }
  sideProfile.push(point3(0, depth, 0));
  faces.push(rawFace("left", "계단 옆면", "side", sideProfile, -0.22, steps * 2));
  return faces;
}

function wedgeRawFaces(
  width: number,
  depth: number,
  height: number
): StudioIsometricRawPrimitiveFace[] {
  const origin = point3(0, 0, 0);
  const x = point3(width, 0, 0);
  const y = point3(0, depth, 0);
  const xy = point3(width, depth, 0);
  const nearTop = point3(0, 0, height);
  const nearTopX = point3(width, 0, height);
  return [
    rawFace("left", "삼각 옆면", "side", [origin, y, nearTop], -0.2, 0),
    rawFace("front", "앞면", "side", [origin, nearTop, nearTopX, x], -0.08, 1),
    rawFace("slope", "경사면", "slope", [nearTop, y, xy, nearTopX], 0.2, 2),
  ];
}

function primitiveRawFaces(input: StudioIsometricPrimitiveInput): StudioIsometricRawPrimitiveFace[] {
  switch (input.kind) {
    case "box":
      return boxRawFaces(input.width, input.depth, input.height);
    case "cylinder":
      return cylinderRawFaces(input.width, input.depth, input.height, input.segments);
    case "stairs":
      return stairsRawFaces(input.width, input.depth, input.height, input.steps);
    case "wedge":
      return wedgeRawFaces(input.width, input.depth, input.height);
  }
}

function fitPrimitiveInputToCoordinateBudget<TInput extends StudioIsometricPrimitiveInput>(
  input: TInput,
  faces: readonly StudioIsometricRawPrimitiveFace[]
): TInput {
  let minimumXOffset = Number.POSITIVE_INFINITY;
  let maximumXOffset = Number.NEGATIVE_INFINITY;
  let minimumYOffset = Number.POSITIVE_INFINITY;
  let maximumYOffset = Number.NEGATIVE_INFINITY;
  for (const face of faces) {
    for (const point of face.points) {
      const offset = projectionOffset(point, input.angleDeg);
      minimumXOffset = Math.min(minimumXOffset, offset.x);
      maximumXOffset = Math.max(maximumXOffset, offset.x);
      minimumYOffset = Math.min(minimumYOffset, offset.y);
      maximumYOffset = Math.max(maximumYOffset, offset.y);
    }
  }
  return {
    ...input,
    originX: fitOriginAxisToCoordinateBudget(
      input.originX,
      minimumXOffset,
      maximumXOffset
    ),
    originY: fitOriginAxisToCoordinateBudget(
      input.originY,
      minimumYOffset,
      maximumYOffset
    ),
  };
}

interface StudioIsometricDepthPlannedFace {
  id: string;
  label: string;
  role: StudioIsometricPrimitiveFaceRole;
  points: readonly StudioIsometricPoint2[];
  shadeAmount: number;
  sourceOrder: number;
  paintDepth: number;
}

function enforceCylinderCapPainterOrder(
  faces: readonly StudioIsometricDepthPlannedFace[]
): StudioIsometricDepthPlannedFace[] {
  const minimumSideDepth = Math.min(
    ...faces.filter((face) => face.role === "side").map((face) => face.paintDepth)
  );
  return faces.map((face) => face.role === "top"
    ? {
        ...face,
        // The cap must close over the side seam even for very short or highly elliptical inputs.
        paintDepth: Math.min(face.paintDepth, minimumSideDepth - 1),
      }
    : face);
}

/**
 * Plans a bounded drafting primitive as independently editable, closed vector faces. The returned
 * order is the painter order: centroid x+y-z supplies the base key and explicit occlusion rules
 * keep covering faces (such as a cylinder cap) after the faces they must cover.
 */
export function planStudioIsometricPrimitive(
  input: StudioIsometricPrimitiveInput
): StudioIsometricPrimitivePlan {
  const normalized = normalizeStudioIsometricPrimitiveInput(input);
  const rawFaces = primitiveRawFaces(normalized);
  const safe = fitPrimitiveInputToCoordinateBudget(normalized, rawFaces);
  const depthPlannedFaces: StudioIsometricDepthPlannedFace[] = rawFaces.map((face) => {
    const paintDepth = face.points.reduce(
      (total, point) => total + point.x + point.y - point.z,
      0
    ) / face.points.length;
    const points = ensureClockwiseScreenWinding(
      face.points.map((point) => projectStudioIsometricPoint(point, safe))
    );
    return { ...face, points, paintDepth };
  });
  const projectedFaces = (
    safe.kind === "cylinder"
      ? enforceCylinderCapPainterOrder(depthPlannedFaces)
      : depthPlannedFaces
  ).sort((left, right) => (
    right.paintDepth - left.paintDepth || left.sourceOrder - right.sourceOrder
  ));
  const faces = projectedFaces.map(({ sourceOrder: _sourceOrder, ...face }) => face);
  const allPoints = faces.flatMap((face) => face.points);
  const minX = Math.min(...allPoints.map((point) => point.x));
  const maxX = Math.max(...allPoints.map((point) => point.x));
  const minY = Math.min(...allPoints.map((point) => point.y));
  const maxY = Math.max(...allPoints.map((point) => point.y));
  return {
    kind: safe.kind,
    input: safe,
    faces,
    bounds: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
  };
}

function parseHexColor(value: string): [number, number, number] {
  const source = value.trim();
  const short = /^#([\da-f])([\da-f])([\da-f])$/i.exec(source);
  if (short) {
    return short.slice(1).map((part) => Number.parseInt(`${part}${part}`, 16)) as [number, number, number];
  }
  const full = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(source);
  if (!full) return [99, 102, 241];
  return full.slice(1).map((part) => Number.parseInt(part, 16)) as [number, number, number];
}

function shadeHexColor(value: string, amount: number): string {
  const channels = parseHexColor(value).map((channel) => (
    Math.round(clamp(channel + (amount >= 0 ? 255 - channel : channel) * amount, 0, 255))
  ));
  return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

/** Converts the three visible faces into ordinary closed, filled vector paths. */
export function createStudioIsometricSolidElements(
  plan: StudioIsometricSolidPlan,
  options: StudioIsometricSolidElementOptions
): DrawEl[] {
  const strokeWidth = clamp(finite(options.strokeWidth, 2), 0.25, 256);
  const opacity = clamp(finite(options.opacity, 1), 0, 1);
  const namePrefix = options.namePrefix?.trim() || "아이소메트릭 상자";
  const fills: Record<StudioIsometricFaceId, string> = {
    left: shadeHexColor(options.baseColor, -0.2),
    right: shadeHexColor(options.baseColor, -0.08),
    top: shadeHexColor(options.baseColor, 0.22),
  };
  const labels: Record<StudioIsometricFaceId, string> = {
    left: "왼쪽 면",
    right: "오른쪽 면",
    top: "윗면",
  };
  return plan.faces.map((face, index) => ({
    id: options.ids[index],
    type: "draw",
    kind: "freehand",
    mode: "pen",
    points: face.points.flatMap(({ x, y }) => [x, y]),
    stroke: options.strokeColor ?? shadeHexColor(options.baseColor, -0.52),
    strokeWidth,
    opacity,
    fill: fills[face.id],
    // Marks the path as an authored, already-clean vector. Canvas must not re-smooth its corners.
    sampleSpacing: 1,
    name: `${namePrefix} · ${labels[face.id]}`,
  }));
}

const PRIMITIVE_DEFAULT_NAMES: Readonly<Record<StudioIsometricPrimitiveKind, string>> = {
  box: "아이소메트릭 상자",
  cylinder: "아이소메트릭 원기둥",
  stairs: "아이소메트릭 계단",
  wedge: "아이소메트릭 쐐기",
};

/**
 * Materializes one complete primitive plan as a single caller-commit-ready element batch.
 * Every face is an ordinary closed freehand vector, so the existing editor and SVG exporter keep
 * fill, stroke, node editing and independent recolouring without a private 3D document payload.
 */
export function createStudioIsometricPrimitiveElements(
  plan: StudioIsometricPrimitivePlan,
  options: StudioIsometricPrimitiveElementOptions
): DrawEl[] {
  const idsAreValid = options.ids.length === plan.faces.length
    && options.ids.every((id) => typeof id === "string" && id.trim().length > 0)
    && new Set(options.ids).size === options.ids.length;
  if (!idsAreValid) {
    throw new RangeError("아이소메트릭 프리미티브의 각 면에는 서로 다른 문서 ID가 하나씩 필요합니다.");
  }

  const strokeWidth = clamp(finite(options.strokeWidth, 2), 0.25, 256);
  const opacity = clamp(finite(options.opacity, 1), 0, 1);
  const namePrefix = options.namePrefix?.trim() || PRIMITIVE_DEFAULT_NAMES[plan.kind];
  const stroke = options.strokeColor ?? shadeHexColor(options.baseColor, -0.52);
  return plan.faces.map((face, index) => ({
    id: options.ids[index]!,
    type: "draw",
    kind: "freehand",
    mode: "pen",
    points: face.points.flatMap(({ x, y }) => [x, y]),
    stroke,
    strokeWidth,
    opacity,
    fill: shadeHexColor(options.baseColor, face.shadeAmount),
    sampleSpacing: 1,
    name: `${namePrefix} · ${face.label}`,
  }));
}
