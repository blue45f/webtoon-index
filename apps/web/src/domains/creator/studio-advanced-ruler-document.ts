import {
  canonicalizeStudioConcentricRuler,
  canonicalizeStudioParallelRuler,
  canonicalizeStudioRadialRuler,
  mirrorStudioConcentricRulerHorizontally,
  mirrorStudioParallelRulerHorizontally,
  mirrorStudioRadialRulerHorizontally,
} from "./studio-advanced-ruler-guide-snap";
import {
  canonicalizeStudioCurveRuler,
  mirrorStudioCurveRulerHorizontally,
  type StudioCurvePoint,
} from "./studio-curve-ruler";
import {
  canonicalizeStudioFisheyeRuler,
  mirrorStudioFisheyeRulerHorizontally,
  type StudioFisheyeOutsidePolicy,
} from "./studio-fisheye-ruler";

/**
 * Bounded page-owned collection for authored curve and fisheye rulers.
 *
 * Only one ruler owns snapping for a stroke, but any number of guides may remain visible. A ruler
 * can apply to the whole page or to elements in one layer group. This keeps scope explicit without
 * turning transient selection state into document state.
 */

export const STUDIO_ADVANCED_RULER_DOCUMENT_VERSION = 1 as const;
export const STUDIO_ADVANCED_RULER_MAX_COUNT = 12;
export const STUDIO_ADVANCED_RULER_MAX_SERIALIZED_BYTES = 6 * 1_024;

const MAX_ID_LENGTH = 160;
const MAX_NAME_LENGTH = 80;
const MAX_OFFSET = 1_000_000;
const ROOT_KEYS = ["version", "rulers", "activeSnapRulerId", "selectedRulerId"] as const;
const SCOPE_KEYS = ["kind", "groupId"] as const;
const POINT_KEYS = ["x", "y"] as const;
const CURVE_KEYS = [
  "id", "type", "name", "enabled", "visible", "scope", "snapMode", "fixedOffset",
  "p0", "p1", "p2", "p3",
] as const;
const FISHEYE_KEYS = [
  "id", "type", "name", "enabled", "visible", "scope", "guideFamily", "centerX",
  "centerY", "radius", "rotationDeg", "fovDeg", "strength", "outsidePolicy",
] as const;
const PARALLEL_KEYS = [
  "id", "type", "name", "enabled", "visible", "scope", "angleDeg", "originX",
  "originY", "guideSpacing",
] as const;
const CONCENTRIC_KEYS = [
  "id", "type", "name", "enabled", "visible", "scope", "centerX", "centerY", "guideSpacing",
] as const;
const RADIAL_KEYS = [
  "id", "type", "name", "enabled", "visible", "scope", "centerX", "centerY",
] as const;

export interface StudioAdvancedRulerScope {
  kind: "page" | "group";
  groupId: string | null;
}

interface StudioAdvancedRulerBase {
  id: string;
  name: string;
  enabled: boolean;
  visible: boolean;
  scope: StudioAdvancedRulerScope;
}

export type StudioCurveRulerSnapMode = "through-start" | "on-curve" | "fixed";

export interface StudioAuthoredCurveRuler extends StudioAdvancedRulerBase {
  type: "curve";
  snapMode: StudioCurveRulerSnapMode;
  fixedOffset: number;
  p0: StudioCurvePoint;
  p1: StudioCurvePoint;
  p2: StudioCurvePoint;
  p3: StudioCurvePoint;
}

export type StudioFisheyeGuideFamilySelection = "auto" | "radial" | "spherical";

export interface StudioAuthoredFisheyeRuler extends StudioAdvancedRulerBase {
  type: "fisheye";
  guideFamily: StudioFisheyeGuideFamilySelection;
  centerX: number;
  centerY: number;
  radius: number;
  rotationDeg: number;
  fovDeg: number;
  strength: number;
  outsidePolicy: StudioFisheyeOutsidePolicy;
}

export interface StudioAuthoredParallelRuler extends StudioAdvancedRulerBase {
  type: "parallel";
  /** Line direction in degrees, canonical range [0, 180). */
  angleDeg: number;
  /** Display anchor for overlay guides and handles; snapping ignores it. */
  originX: number;
  originY: number;
  /** Display-only guide density: spacing between neighboring guide lines. */
  guideSpacing: number;
}

export interface StudioAuthoredConcentricRuler extends StudioAdvancedRulerBase {
  type: "concentric";
  centerX: number;
  centerY: number;
  /** Display-only guide density: spacing between neighboring guide circles. */
  guideSpacing: number;
}

export interface StudioAuthoredRadialRuler extends StudioAdvancedRulerBase {
  type: "radial";
  centerX: number;
  centerY: number;
}

export type StudioAdvancedRuler =
  | StudioAuthoredCurveRuler
  | StudioAuthoredFisheyeRuler
  | StudioAuthoredParallelRuler
  | StudioAuthoredConcentricRuler
  | StudioAuthoredRadialRuler;

export const STUDIO_ADVANCED_RULER_NAME_PREFIXES: Record<StudioAdvancedRuler["type"], string> = {
  curve: "곡선",
  fisheye: "어안",
  parallel: "평행선",
  concentric: "동심원",
  radial: "방사선",
};

export interface StudioAdvancedRulerDocument {
  version: typeof STUDIO_ADVANCED_RULER_DOCUMENT_VERSION;
  rulers: StudioAdvancedRuler[];
  activeSnapRulerId: string | null;
  selectedRulerId: string | null;
}

function ownDataRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    return value as Record<string, unknown>;
  } catch {
    return null;
  }
}

function strictDataRecord(
  value: unknown,
  expectedKeys: readonly string[]
): Record<string, unknown> | null {
  const record = ownDataRecord(value);
  if (!record) return null;
  try {
    const keys = Reflect.ownKeys(record);
    if (
      keys.length !== expectedKeys.length ||
      keys.some((key) => typeof key !== "string" || !expectedKeys.includes(key))
    ) return null;
    for (const key of expectedKeys) {
      const descriptor = Object.getOwnPropertyDescriptor(record, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return null;
    }
    return record;
  } catch {
    return null;
  }
}

function strictArray(value: unknown): unknown[] | null {
  if (!Array.isArray(value)) return null;
  const output: unknown[] = [];
  try {
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return null;
      output.push(descriptor.value);
    }
  } catch {
    return null;
  }
  return output;
}

function validText(value: unknown, maxLength: number, allowEmpty = false): value is string {
  if (
    typeof value !== "string" ||
    (!allowEmpty && value.length === 0) ||
    value.length > maxLength
  ) return false;
  return ![...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 31 || (code >= 127 && code <= 159);
  });
}

function validId(value: unknown): value is string {
  return validText(value, MAX_ID_LENGTH);
}

function canonicalScope(value: unknown): StudioAdvancedRulerScope | null {
  const record = ownDataRecord(value);
  if (!record) return null;
  if (record.kind === "page") return { kind: "page", groupId: null };
  if (record.kind === "group" && validId(record.groupId)) {
    return { kind: "group", groupId: record.groupId };
  }
  return null;
}

function strictScope(value: unknown): StudioAdvancedRulerScope | null {
  const record = strictDataRecord(value, SCOPE_KEYS);
  if (!record) return null;
  if (record.kind === "page" && record.groupId === null) return { kind: "page", groupId: null };
  if (record.kind === "group" && validId(record.groupId)) {
    return { kind: "group", groupId: record.groupId };
  }
  return null;
}

function pointEqual(left: StudioCurvePoint, right: StudioCurvePoint): boolean {
  return left.x === right.x && left.y === right.y;
}

function normalizedName(value: unknown, fallback: string): string {
  return validText(value, MAX_NAME_LENGTH) ? value : fallback;
}

function canonicalCurve(value: unknown, strict: boolean): StudioAuthoredCurveRuler | null {
  const source = strict
    ? strictDataRecord(value, CURVE_KEYS)
    : ownDataRecord(value);
  if (!source || source.type !== "curve" || !validId(source.id)) return null;
  if (strict) {
    for (const key of ["p0", "p1", "p2", "p3"] as const) {
      if (!strictDataRecord(source[key], POINT_KEYS)) return null;
    }
  }
  const curve = canonicalizeStudioCurveRuler(source);
  const scope = strict ? strictScope(source.scope) : canonicalScope(source.scope);
  if (!curve || !scope) return null;
  const snapMode = source.snapMode === "on-curve" || source.snapMode === "fixed"
    ? source.snapMode
    : "through-start";
  const fixedOffset = typeof source.fixedOffset === "number" && Number.isFinite(source.fixedOffset)
    ? Math.min(MAX_OFFSET, Math.max(-MAX_OFFSET, source.fixedOffset))
    : 0;
  if (
    strict && (
      !validText(source.name, MAX_NAME_LENGTH) ||
      typeof source.enabled !== "boolean" ||
      typeof source.visible !== "boolean" ||
      source.snapMode !== snapMode ||
      source.fixedOffset !== fixedOffset ||
      !pointEqual(source.p0 as unknown as StudioCurvePoint, curve.p0) ||
      !pointEqual(source.p1 as unknown as StudioCurvePoint, curve.p1) ||
      !pointEqual(source.p2 as unknown as StudioCurvePoint, curve.p2) ||
      !pointEqual(source.p3 as unknown as StudioCurvePoint, curve.p3)
    )
  ) return null;
  return {
    id: curve.id,
    type: "curve",
    name: normalizedName(source.name, "곡선자"),
    enabled: source.enabled !== false,
    visible: source.visible !== false,
    scope,
    snapMode,
    fixedOffset,
    p0: { ...curve.p0 },
    p1: { ...curve.p1 },
    p2: { ...curve.p2 },
    p3: { ...curve.p3 },
  };
}

function canonicalFisheye(value: unknown, strict: boolean): StudioAuthoredFisheyeRuler | null {
  const source = strict
    ? strictDataRecord(value, FISHEYE_KEYS)
    : ownDataRecord(value);
  if (!source || source.type !== "fisheye" || !validId(source.id)) return null;
  const scope = strict ? strictScope(source.scope) : canonicalScope(source.scope);
  if (!scope) return null;
  const ruler = canonicalizeStudioFisheyeRuler(source);
  const guideFamily = source.guideFamily === "radial" || source.guideFamily === "spherical"
    ? source.guideFamily
    : "auto";
  if (
    strict && (
      !validText(source.name, MAX_NAME_LENGTH) ||
      typeof source.enabled !== "boolean" ||
      typeof source.visible !== "boolean" ||
      source.guideFamily !== guideFamily ||
      source.centerX !== ruler.centerX ||
      source.centerY !== ruler.centerY ||
      source.radius !== ruler.radius ||
      source.rotationDeg !== ruler.rotationDeg ||
      source.fovDeg !== ruler.fovDeg ||
      source.strength !== ruler.strength ||
      source.outsidePolicy !== ruler.outsidePolicy
    )
  ) return null;
  return {
    id: ruler.id,
    type: "fisheye",
    name: normalizedName(source.name, "어안자"),
    enabled: source.enabled !== false,
    visible: source.visible !== false,
    scope,
    guideFamily,
    centerX: ruler.centerX,
    centerY: ruler.centerY,
    radius: ruler.radius,
    rotationDeg: ruler.rotationDeg,
    fovDeg: ruler.fovDeg,
    strength: ruler.strength,
    outsidePolicy: ruler.outsidePolicy,
  };
}

function canonicalParallel(value: unknown, strict: boolean): StudioAuthoredParallelRuler | null {
  const source = strict
    ? strictDataRecord(value, PARALLEL_KEYS)
    : ownDataRecord(value);
  if (!source || source.type !== "parallel" || !validId(source.id)) return null;
  const scope = strict ? strictScope(source.scope) : canonicalScope(source.scope);
  if (!scope) return null;
  const ruler = canonicalizeStudioParallelRuler(source);
  if (
    strict && (
      !validText(source.name, MAX_NAME_LENGTH) ||
      typeof source.enabled !== "boolean" ||
      typeof source.visible !== "boolean" ||
      source.angleDeg !== ruler.angleDeg ||
      source.originX !== ruler.originX ||
      source.originY !== ruler.originY ||
      source.guideSpacing !== ruler.guideSpacing
    )
  ) return null;
  return {
    id: ruler.id,
    type: "parallel",
    name: normalizedName(source.name, "평행선자"),
    enabled: source.enabled !== false,
    visible: source.visible !== false,
    scope,
    angleDeg: ruler.angleDeg,
    originX: ruler.originX,
    originY: ruler.originY,
    guideSpacing: ruler.guideSpacing,
  };
}

function canonicalConcentric(
  value: unknown,
  strict: boolean
): StudioAuthoredConcentricRuler | null {
  const source = strict
    ? strictDataRecord(value, CONCENTRIC_KEYS)
    : ownDataRecord(value);
  if (!source || source.type !== "concentric" || !validId(source.id)) return null;
  const scope = strict ? strictScope(source.scope) : canonicalScope(source.scope);
  if (!scope) return null;
  const ruler = canonicalizeStudioConcentricRuler(source);
  if (
    strict && (
      !validText(source.name, MAX_NAME_LENGTH) ||
      typeof source.enabled !== "boolean" ||
      typeof source.visible !== "boolean" ||
      source.centerX !== ruler.centerX ||
      source.centerY !== ruler.centerY ||
      source.guideSpacing !== ruler.guideSpacing
    )
  ) return null;
  return {
    id: ruler.id,
    type: "concentric",
    name: normalizedName(source.name, "동심원자"),
    enabled: source.enabled !== false,
    visible: source.visible !== false,
    scope,
    centerX: ruler.centerX,
    centerY: ruler.centerY,
    guideSpacing: ruler.guideSpacing,
  };
}

function canonicalRadial(value: unknown, strict: boolean): StudioAuthoredRadialRuler | null {
  const source = strict
    ? strictDataRecord(value, RADIAL_KEYS)
    : ownDataRecord(value);
  if (!source || source.type !== "radial" || !validId(source.id)) return null;
  const scope = strict ? strictScope(source.scope) : canonicalScope(source.scope);
  if (!scope) return null;
  const ruler = canonicalizeStudioRadialRuler(source);
  if (
    strict && (
      !validText(source.name, MAX_NAME_LENGTH) ||
      typeof source.enabled !== "boolean" ||
      typeof source.visible !== "boolean" ||
      source.centerX !== ruler.centerX ||
      source.centerY !== ruler.centerY
    )
  ) return null;
  return {
    id: ruler.id,
    type: "radial",
    name: normalizedName(source.name, "방사선자"),
    enabled: source.enabled !== false,
    visible: source.visible !== false,
    scope,
    centerX: ruler.centerX,
    centerY: ruler.centerY,
  };
}

function canonicalRuler(value: unknown, strict: boolean): StudioAdvancedRuler | null {
  const source = ownDataRecord(value);
  if (!source) return null;
  if (source.type === "curve") return canonicalCurve(value, strict);
  if (source.type === "fisheye") return canonicalFisheye(value, strict);
  if (source.type === "parallel") return canonicalParallel(value, strict);
  if (source.type === "concentric") return canonicalConcentric(value, strict);
  if (source.type === "radial") return canonicalRadial(value, strict);
  return null;
}

function serializedByteLength(value: StudioAdvancedRulerDocument): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function normalizedDocumentSelection(
  rulers: StudioAdvancedRuler[],
  source: Record<string, unknown>
): StudioAdvancedRulerDocument {
  const ids = new Set(rulers.map((ruler) => ruler.id));
  const active = validId(source.activeSnapRulerId) && rulers.some((ruler) => (
    ruler.id === source.activeSnapRulerId && ruler.enabled
  )) ? source.activeSnapRulerId : null;
  const selected = validId(source.selectedRulerId) && ids.has(source.selectedRulerId)
    ? source.selectedRulerId
    : null;
  return {
    version: STUDIO_ADVANCED_RULER_DOCUMENT_VERSION,
    rulers,
    activeSnapRulerId: active,
    selectedRulerId: selected,
  };
}

export function createDefaultStudioAdvancedRulerDocument(): StudioAdvancedRulerDocument {
  return {
    version: STUDIO_ADVANCED_RULER_DOCUMENT_VERSION,
    rulers: [],
    activeSnapRulerId: null,
    selectedRulerId: null,
  };
}

export interface StudioAdvancedRulerFactoryOptions {
  id: string;
  name: string;
  canvasWidth: number;
  canvasHeight: number;
}

/**
 * Canonical page-editor defaults for a newly added ruler of any kind. Keeping the per-kind
 * literals here lets the page shell add future kinds without knowing their fields.
 */
export function createStudioAdvancedRulerOfType(
  type: StudioAdvancedRuler["type"],
  options: StudioAdvancedRulerFactoryOptions
): StudioAdvancedRuler {
  const width = Number.isFinite(options.canvasWidth) ? options.canvasWidth : 0;
  const height = Number.isFinite(options.canvasHeight) ? options.canvasHeight : 0;
  const base = {
    id: options.id,
    name: options.name,
    enabled: true,
    visible: true,
    scope: { kind: "page", groupId: null } as StudioAdvancedRulerScope,
  };
  switch (type) {
    case "curve":
      return {
        ...base,
        type: "curve",
        snapMode: "through-start",
        fixedOffset: 0,
        p0: { x: width * 0.2, y: height * 0.55 },
        p1: { x: width * 0.38, y: height * 0.35 },
        p2: { x: width * 0.62, y: height * 0.75 },
        p3: { x: width * 0.8, y: height * 0.55 },
      };
    case "fisheye":
      return {
        ...base,
        type: "fisheye",
        guideFamily: "auto",
        centerX: width / 2,
        centerY: height / 2,
        radius: Math.max(80, Math.min(width, height) * 0.38),
        rotationDeg: 0,
        fovDeg: 180,
        strength: 1,
        outsidePolicy: "clamp",
      };
    case "parallel":
      return {
        ...base,
        type: "parallel",
        angleDeg: 0,
        originX: width / 2,
        originY: height / 2,
        guideSpacing: 96,
      };
    case "concentric":
      return {
        ...base,
        type: "concentric",
        centerX: width / 2,
        centerY: height / 2,
        guideSpacing: 96,
      };
    case "radial":
      return {
        ...base,
        type: "radial",
        centerX: width / 2,
        centerY: height / 2,
      };
  }
}

type StudioAdvancedRulerJsonValue =
  | string
  | number
  | boolean
  | null
  | { [key: string]: StudioAdvancedRulerJsonValue };

export type StudioAdvancedRulerJsonObject = { [key: string]: StudioAdvancedRulerJsonValue };

/**
 * Deep JSON-safe copy of one authored ruler for CRDT/export payload builders, so those builders
 * stay kind-agnostic when new ruler kinds are added.
 */
export function copyStudioAdvancedRulerAsJson(
  ruler: StudioAdvancedRuler
): StudioAdvancedRulerJsonObject {
  const common: StudioAdvancedRulerJsonObject = {
    id: ruler.id,
    type: ruler.type,
    name: ruler.name,
    enabled: ruler.enabled,
    visible: ruler.visible,
    scope: {
      kind: ruler.scope.kind,
      groupId: ruler.scope.groupId,
    },
  };
  if (ruler.type === "curve") {
    return {
      ...common,
      snapMode: ruler.snapMode,
      fixedOffset: ruler.fixedOffset,
      p0: { x: ruler.p0.x, y: ruler.p0.y },
      p1: { x: ruler.p1.x, y: ruler.p1.y },
      p2: { x: ruler.p2.x, y: ruler.p2.y },
      p3: { x: ruler.p3.x, y: ruler.p3.y },
    };
  }
  if (ruler.type === "fisheye") {
    return {
      ...common,
      guideFamily: ruler.guideFamily,
      centerX: ruler.centerX,
      centerY: ruler.centerY,
      radius: ruler.radius,
      rotationDeg: ruler.rotationDeg,
      fovDeg: ruler.fovDeg,
      strength: ruler.strength,
      outsidePolicy: ruler.outsidePolicy,
    };
  }
  if (ruler.type === "parallel") {
    return {
      ...common,
      angleDeg: ruler.angleDeg,
      originX: ruler.originX,
      originY: ruler.originY,
      guideSpacing: ruler.guideSpacing,
    };
  }
  if (ruler.type === "concentric") {
    return {
      ...common,
      centerX: ruler.centerX,
      centerY: ruler.centerY,
      guideSpacing: ruler.guideSpacing,
    };
  }
  return {
    ...common,
    centerX: ruler.centerX,
    centerY: ruler.centerY,
  };
}

export function normalizeStudioAdvancedRulerDocument(value: unknown): StudioAdvancedRulerDocument {
  const source = ownDataRecord(value);
  if (!source || (source.version !== undefined && source.version !== STUDIO_ADVANCED_RULER_DOCUMENT_VERSION)) {
    return createDefaultStudioAdvancedRulerDocument();
  }
  const input = Array.isArray(source.rulers) ? source.rulers : [];
  const rulers: StudioAdvancedRuler[] = [];
  const ids = new Set<string>();
  for (const candidate of input) {
    if (rulers.length >= STUDIO_ADVANCED_RULER_MAX_COUNT) break;
    const ruler = canonicalRuler(candidate, false);
    if (!ruler || ids.has(ruler.id)) continue;
    ids.add(ruler.id);
    rulers.push(ruler);
  }
  let normalized = normalizedDocumentSelection(rulers, source);
  while (
    normalized.rulers.length > 0 &&
    serializedByteLength(normalized) > STUDIO_ADVANCED_RULER_MAX_SERIALIZED_BYTES
  ) {
    rulers.pop();
    normalized = normalizedDocumentSelection(rulers, source);
  }
  return normalized;
}

/** Strict import/CRDT boundary. Unknown keys and accessor-backed values fail closed. */
export function parseStudioAdvancedRulerDocument(value: unknown): StudioAdvancedRulerDocument | null {
  const source = strictDataRecord(value, ROOT_KEYS);
  if (!source || source.version !== STUDIO_ADVANCED_RULER_DOCUMENT_VERSION) return null;
  const values = strictArray(source.rulers);
  if (!values || values.length > STUDIO_ADVANCED_RULER_MAX_COUNT) return null;
  const rulers: StudioAdvancedRuler[] = [];
  const ids = new Set<string>();
  for (const candidate of values) {
    const ruler = canonicalRuler(candidate, true);
    if (!ruler || ids.has(ruler.id)) return null;
    ids.add(ruler.id);
    rulers.push(ruler);
  }
  const active = source.activeSnapRulerId;
  const selected = source.selectedRulerId;
  if (
    active !== null && (
      !validId(active) || !rulers.some((ruler) => ruler.id === active && ruler.enabled)
    )
  ) return null;
  if (selected !== null && (!validId(selected) || !ids.has(selected))) return null;
  const parsed: StudioAdvancedRulerDocument = {
    version: STUDIO_ADVANCED_RULER_DOCUMENT_VERSION,
    rulers,
    activeSnapRulerId: active as string | null,
    selectedRulerId: selected as string | null,
  };
  if (
    serializedByteLength(parsed) > STUDIO_ADVANCED_RULER_MAX_SERIALIZED_BYTES
  ) return null;
  return parsed;
}

export function studioAdvancedRulerAppliesToGroup(
  ruler: StudioAdvancedRuler,
  groupId: string | null | undefined
): boolean {
  return ruler.scope.kind === "page" || ruler.scope.groupId === groupId;
}

export function resolveActiveStudioAdvancedRuler(
  document: StudioAdvancedRulerDocument,
  groupId?: string | null
): StudioAdvancedRuler | null {
  return document.rulers.find((ruler) => (
    ruler.id === document.activeSnapRulerId &&
    ruler.enabled &&
    studioAdvancedRulerAppliesToGroup(ruler, groupId)
  )) ?? null;
}

export function mirrorStudioAdvancedRulerDocument(
  document: StudioAdvancedRulerDocument,
  canvasWidth: number
): StudioAdvancedRulerDocument {
  const rulers = document.rulers.map((ruler): StudioAdvancedRuler => {
    if (ruler.type === "curve") {
      const mirrored = mirrorStudioCurveRulerHorizontally(ruler, canvasWidth);
      return mirrored ? {
        ...ruler,
        ...mirrored,
        scope: { ...ruler.scope },
        fixedOffset: -ruler.fixedOffset,
      } : {
        ...ruler,
        scope: { ...ruler.scope },
        p0: { ...ruler.p0 },
        p1: { ...ruler.p1 },
        p2: { ...ruler.p2 },
        p3: { ...ruler.p3 },
      };
    }
    if (ruler.type === "parallel") {
      const mirrored = mirrorStudioParallelRulerHorizontally(ruler, canvasWidth);
      return { ...ruler, ...mirrored, scope: { ...ruler.scope } };
    }
    if (ruler.type === "concentric") {
      const mirrored = mirrorStudioConcentricRulerHorizontally(ruler, canvasWidth);
      return { ...ruler, ...mirrored, scope: { ...ruler.scope } };
    }
    if (ruler.type === "radial") {
      const mirrored = mirrorStudioRadialRulerHorizontally(ruler, canvasWidth);
      return { ...ruler, ...mirrored, scope: { ...ruler.scope } };
    }
    const mirrored = mirrorStudioFisheyeRulerHorizontally(ruler, canvasWidth);
    return { ...ruler, ...mirrored, scope: { ...ruler.scope } };
  });
  return { ...document, rulers };
}

export function areStudioAdvancedRulerDocumentsEqual(
  left: StudioAdvancedRulerDocument,
  right: StudioAdvancedRulerDocument
): boolean {
  if (
    left.version !== right.version ||
    left.activeSnapRulerId !== right.activeSnapRulerId ||
    left.selectedRulerId !== right.selectedRulerId ||
    left.rulers.length !== right.rulers.length
  ) {
    return false;
  }
  return left.rulers.every((ruler, index) => {
    const other = right.rulers[index];
    if (
      !other ||
      ruler.type !== other.type ||
      ruler.id !== other.id ||
      ruler.name !== other.name ||
      ruler.enabled !== other.enabled ||
      ruler.visible !== other.visible ||
      ruler.scope.kind !== other.scope.kind ||
      ruler.scope.groupId !== other.scope.groupId
    ) {
      return false;
    }
    if (ruler.type === "curve" && other.type === "curve") {
      return ruler.snapMode === other.snapMode &&
        ruler.fixedOffset === other.fixedOffset &&
        pointEqual(ruler.p0, other.p0) &&
        pointEqual(ruler.p1, other.p1) &&
        pointEqual(ruler.p2, other.p2) &&
        pointEqual(ruler.p3, other.p3);
    }
    if (ruler.type === "fisheye" && other.type === "fisheye") {
      return ruler.guideFamily === other.guideFamily &&
        ruler.centerX === other.centerX &&
        ruler.centerY === other.centerY &&
        ruler.radius === other.radius &&
        ruler.rotationDeg === other.rotationDeg &&
        ruler.fovDeg === other.fovDeg &&
        ruler.strength === other.strength &&
        ruler.outsidePolicy === other.outsidePolicy;
    }
    if (ruler.type === "parallel" && other.type === "parallel") {
      return ruler.angleDeg === other.angleDeg &&
        ruler.originX === other.originX &&
        ruler.originY === other.originY &&
        ruler.guideSpacing === other.guideSpacing;
    }
    if (ruler.type === "concentric" && other.type === "concentric") {
      return ruler.centerX === other.centerX &&
        ruler.centerY === other.centerY &&
        ruler.guideSpacing === other.guideSpacing;
    }
    if (ruler.type === "radial" && other.type === "radial") {
      return ruler.centerX === other.centerX &&
        ruler.centerY === other.centerY;
    }
    return false;
  });
}
