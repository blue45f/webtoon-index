import * as Y from "yjs";

import {
  normalizeStudioBrushR8TextureGrainSource,
  serializeStudioBrushR8TextureGrainSourceCanonical,
} from "../../../../web/src/shared/lib/studio-brush-r8-grain-asset-contract";
import { readStudioCrdtRasterDocument } from "../../../../web/src/shared/lib/studio-crdt-raster-document-contract";
import {
  STUDIO_FILTER_MASK_REFERENCE_EDIT_KEYS,
  isStudioFilterMaskReferenceProps,
  isStudioFilterMaskSurfaceId,
  isStudioFilterMaskSurfaceSpec,
} from "../../../../web/src/shared/lib/studio-filter-mask-surface-contract";
import {
  STUDIO_INK_INPUT_V2_MAX_CONTACT_DIMENSION,
  STUDIO_INK_INPUT_V2_MAX_TIME_OFFSET_MS,
  isStudioInkInputContractV2,
  normalizeStudioInkInputContract,
} from "../../../../web/src/shared/lib/studio-ink-input-contract";
import {
  STUDIO_WORK_ASSET_BOOLEAN_EDIT_KEYS,
  STUDIO_WORK_ASSET_REFERENCE_EDIT_KEYS,
  STUDIO_WORK_ASSET_SCALAR_FILTER_RANGES,
  STUDIO_WORK_ASSET_STRUCTURED_EDIT_KEYS,
  STUDIO_WORK_ASSET_TYPES,
  StudioWorkAssetElementSchema,
  parseStudioWorkAssetStructuredEditValue,
  studioWorkAssetReferenceKey,
} from "../../../../web/src/shared/lib/studio-work-asset-contract";

import type { StudioBrushR8TextureGrainSource } from "../../../../web/src/shared/lib/studio-brush-r8-grain-asset-contract";
import type { StudioWorkAssetReference } from "../../../../web/src/shared/lib/studio-work-asset-contract";

export const STUDIO_CRDT_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const STUDIO_CRDT_STROKE_SAMPLE_MAX_COUNT = 100_000;
const STUDIO_CRDT_STROKE_BASE_SAMPLE_KEYS = [
  "points",
  "pressures",
  "tiltXs",
  "tiltYs",
  "twists",
  "speeds",
  "tangentialPressures",
] as const;
const STUDIO_CRDT_STROKE_EXTENDED_INK_SAMPLE_KEYS = [
  "altitudeAngles",
  "azimuthAngles",
  "contactWidths",
  "contactHeights",
  "sampleTimeOffsets",
] as const;
const STUDIO_CRDT_STROKE_SAMPLE_KEYS = [
  ...STUDIO_CRDT_STROKE_BASE_SAMPLE_KEYS,
  ...STUDIO_CRDT_STROKE_EXTENDED_INK_SAMPLE_KEYS,
] as const;
const STUDIO_CRDT_STROKE_JSON_KEYS = [
  "gradient",
  "pattern",
  "brushDynamics",
  "brushTip",
  "strokeStyle",
  "shapeParams",
  "symmetry",
  "extensions",
] as const;
const STUDIO_CRDT_STROKE_OPTIONAL_STRING_LIMITS = {
  fill: 512,
  brush: 512,
  blendMode: 512,
  brushCatalogId: 160,
  brushCatalogName: 120,
} as const;
const STUDIO_CRDT_STROKE_OPTIONAL_STRING_KEYS = Object.keys(
  STUDIO_CRDT_STROKE_OPTIONAL_STRING_LIMITS
) as Array<keyof typeof STUDIO_CRDT_STROKE_OPTIONAL_STRING_LIMITS>;
const STUDIO_CRDT_STROKE_RECORD_KEYS = new Set([
  "id",
  "pageId",
  "layerId",
  "status",
  "deleted",
  "payloadVersion",
  "type",
  "kind",
  "mode",
  "stroke",
  "strokeWidth",
  "opacity",
  "sampleSpacing",
  ...STUDIO_CRDT_STROKE_OPTIONAL_STRING_KEYS,
  ...STUDIO_CRDT_STROKE_JSON_KEYS,
  ...STUDIO_CRDT_STROKE_SAMPLE_KEYS,
]);
const STUDIO_CRDT_STROKE_METADATA_MAX_BYTES = 16 * 1_024;
const STUDIO_CRDT_STROKE_WIDTH_MAX = 8_192;
const STUDIO_CRDT_LEGACY_STROKE_PAYLOAD_VERSION = 1;
const STUDIO_CRDT_LAYERED_FLOW_STROKE_PAYLOAD_VERSION = 2;
const STUDIO_CRDT_MATERIAL_STROKE_PAYLOAD_VERSION = 3;
const STUDIO_CRDT_STROKE_PAYLOAD_VERSION = 4;
const STUDIO_CRDT_LAYERED_FLOW_PAINT_MODEL = "layered-flow-v1";
const STUDIO_CRDT_BOUNDED_FLOW_PAINT_MODEL = "bounded-flow-v2";
const STUDIO_CRDT_MATERIAL_PRESSURE_MODEL = "canonical-material-v1";
const STUDIO_CRDT_SEGMENTED_CAUSAL_DEPOSIT_PIPELINE =
  "causal-deposit-v3-segmented";
// Fresh-authoring dry-media routing marker (`brushDynamics.dryMediaKernelProgram`, browser
// `studioDryMediaKernelDabProgramPin`). It travels inside the bounded brushDynamics JSON and is
// intentionally admitted by the bounded-JSON rules without a key whitelist — tightening
// brushDynamics admission must keep accepting it or freshly authored core dry-media strokes
// would be dropped server-side while the author still sees them (oracle-pinned in the service
// test alongside the browser paint contract).
const STUDIO_CRDT_CAUSAL_PRESSURE_MODELS = new Set([
  "linear-full-v1",
  "linear-residual-v2",
  "linear-residual-path-v3",
]);
const STUDIO_CRDT_LAYERED_FLOW_COMPATIBLE_BRUSH_IDS = new Set([
  "pen",
  "fineliner",
  "ballpoint",
  "gel-pen",
  "glass-pen",
  "ruling-pen",
  "technical-pen",
  "kneaded-eraser",
  "marker",
  "felt-tip",
  "marker-bold",
  "alcohol-marker",
]);
const STUDIO_CRDT_KNOWN_INCOMPATIBLE_LAYERED_FLOW_BRUSH_IDS = new Set([
  "pixel-grid-v1",
  "gpen",
  "school-pen",
  "maru-pen",
  "liner",
  "mapping-pen",
  "kaburapen",
  "ink-brush",
  "airbrush-fine",
  "pencil-grain",
  "wash-brush",
  "calligraphy",
  "fountain-pen",
  "parallel-pen",
  "brush-pen",
  "perfect-ink",
  "perfect-marker",
  "highlighter",
  "chisel-highlighter",
  "pastel-highlighter",
  "neon",
  "glow",
  "soft-glow",
  "glitter",
  "star-dust",
  "sparkle-star",
  "brush",
  "flat-brush",
  "watercolor",
  "ink-wash",
  "inkwash-pen",
  "inkwash-water-brush",
  "inkwash-bleed-wash",
  "inkwash-white-ink",
  "gouache",
  "oil",
  "acrylic",
  "paint-tube",
  "pastel",
  "oil-pastel",
  "ink-particle",
  "tangent-normal-brush",
  "airbrush",
  "hard-airbrush",
  "spray",
  "splatter",
  "soft-brush",
  "dry-media",
  "crayon",
  "chalk",
  "charcoal",
  "pencil",
  "erodible-pencil",
  "soft-pencil",
  "pencil-2b",
  "pencil-6b",
  "colored-pencil",
  "screentone",
  "crosshatch",
  // Dynamic / non pen-marker families must not claim layered-flow-v1 (browser mirror).
  "sketchpad-tile",
  "web-multi-agent",
  "web-gravity-drip",
  "web-soft-cloud",
  "web-calligraphy-ribbon",
  "web-scatter-stamp",
  "web-blend-softener",
  "web-dot-tone",
  "web-kaleido-ink",
  "web-fur-strand",
  "web-radial-burst",
  "web-spiro-orbit",
  "web-neon-tube",
  "web-smudge-trail",
]);
const STUDIO_CRDT_BOUNDED_FLOW_DYNAMIC_BRUSH_IDS = new Set([
  "ink-particle",
  "airbrush",
  "dry-media",
  "soft-brush",
  "spray",
  "splatter",
  "hard-airbrush",
  "erodible-pencil",
  "paint-tube",
  "tangent-normal-brush",
  "crayon",
  "chalk",
  "charcoal",
  "pastel",
  "oil-pastel",
  "sketchpad-tile",
  "sketchpad-mirror",
  "sketchpad-soft-marker",
  "web-multi-agent",
  "web-rough-ink",
  "web-gravity-drip",
  "web-soft-cloud",
  "web-calligraphy-ribbon",
  "web-dash-stitch",
  "web-scatter-stamp",
  "web-rainbow-flow",
  "web-lazy-ink",
  "web-hatch-color",
  "web-cel-flat",
  "web-blend-softener",
  "web-dot-tone",
  "web-kaleido-ink",
  "web-fur-strand",
  "web-contour-double",
  "web-radial-burst",
  "web-mirror-ink",
  "web-grid-ink",
  "web-spiro-orbit",
  "web-zigzag-edge",
  "web-neon-tube",
  "web-pressure-flat",
  "web-smudge-trail",
  "web-cross-hatch-pen",
  // Engine-lane dynamic twins (bounded-flow-v2 only; mirrors browser dynamics resolver).
  "oil--tube-extrude",
  "oil--knife-edge",
  "acrylic--polymer-flat",
  "charcoal--vine-soft",
  "charcoal--compressed-edge",
  "crayon--wax-scrape",
  "chalk--klecks-powder",
  "pastel--cake-soft",
  "oil-pastel--waxy-film",
  "pencil--erodible-wear",
  "airbrush--klecks-grit",
  "airbrush--hard-envelope",
  "spray--equal-area",
  "splatter--burst-cloud",
  "marker--soft-dynamic",
  "brush--dry-rake",
  "ink-particle--scatter-cloud",
  // 2026-08-13 brush quality wave: the only new dynamic-dabs lane (stamp/wet/oil-ribbon lanes
  // stay off bounded-flow-v2 by both mirrors, matching the browser dynamics resolver).
  "oil-pastel--wgm-mix",
  // 2026-08-13 wave 3 mirror audit: all 17 new engine lanes (mypaint-cc0--* stamp pool, croquis
  // capsule-outline pair, living-ink bake wet lanes, bristle-physics oil lane) execute on
  // stamp/capsule/wet/oil engines — zero dynamic-dabs lanes, so this set deliberately gains no
  // ids and the generic `--` fail-closed rule below keeps admitting them nowhere else.
]);
const STUDIO_CRDT_SCENE_INDEX_ROOT = "scene-elements";
const STUDIO_CRDT_PAGE_INDEX_ROOT = "studio-pages";
const STUDIO_CRDT_LAYER_GROUP_INDEX_ROOT = "layer-groups";
const STUDIO_CRDT_SCENE_ROOT_PREFIX = "scene-element:";
const STUDIO_CRDT_PAGE_ROOT_PREFIX = "studio-page:";
const STUDIO_CRDT_LAYER_GROUP_ROOT_PREFIX = "layer-group:";
const STUDIO_CRDT_PAGE_ORDER_ROOT = "page-order";
const STUDIO_CRDT_DELETION_OPS_ROOT = "studio-deletion-ops";
const STUDIO_CRDT_DELETION_ACKS_ROOT = "studio-deletion-acks";
export const STUDIO_CRDT_SHARED_3D_STAGE_RECORDS_ROOT =
  "studio-shared-3d-stage-records-v1";
export const STUDIO_CRDT_SHARED_3D_STAGE_VISIBILITY_RECEIPTS_ROOT =
  "studio-shared-3d-stage-visibility-receipts-v1";
export const STUDIO_CRDT_SHARED_3D_STAGE_RECORD_ROOT_PREFIX =
  "studio-shared-3d-stage-record:";
export const STUDIO_CRDT_SHARED_3D_STAGE_VISIBILITY_RECEIPT_ROOT_PREFIX =
  "studio-shared-3d-stage-visibility-receipt:";
const STUDIO_CRDT_PROPERTY_PREFIXES = ["base:", "prop:", "unset:"] as const;
const STUDIO_CRDT_SCENE_PAYLOAD_MAX_BYTES = 16 * 1_024;
const STUDIO_CRDT_PAGE_PAYLOAD_MAX_BYTES = 8 * 1_024;
const STUDIO_CRDT_LAYER_GROUP_PAYLOAD_MAX_BYTES = 2 * 1_024;
const STUDIO_CRDT_COLLECTION_MAX_ENTRIES = 100_000;
const STUDIO_CRDT_LAYER_GROUP_MAX_ENTRIES = 4_096;
const STUDIO_CRDT_ACTIVE_ORDER_ENTRY_MAX_COUNT = 256;
const STUDIO_CRDT_JSON_MAX_DEPTH = 10;
const STUDIO_CRDT_JSON_MAX_ENTRIES = 4_096;
const STUDIO_CRDT_JSON_MAX_STRING_LENGTH = 64 * 1_024;
const STUDIO_CRDT_MAX_COORDINATE = 10_000_000;
const STUDIO_CRDT_DRAWING_ASSIST_LEGACY_VERSION = 1;
const STUDIO_CRDT_DRAWING_ASSIST_VERSION = 2;
const STUDIO_CRDT_DRAWING_ASSIST_MAX_VANISHING_POINTS = 3;
const STUDIO_CRDT_DRAWING_ASSIST_ANGLE_MIN_DEG = 1;
const STUDIO_CRDT_DRAWING_ASSIST_ANGLE_MAX_DEG = 89;
const STUDIO_CRDT_DRAWING_ASSIST_CELL_SIZE_MIN = 8;
const STUDIO_CRDT_DRAWING_ASSIST_CELL_SIZE_MAX = 200;
const STUDIO_CRDT_ADVANCED_RULER_VERSION = 1;
const STUDIO_CRDT_ADVANCED_RULER_MAX_COUNT = 12;
const STUDIO_CRDT_ADVANCED_RULER_MAX_BYTES = 6 * 1_024;
const STUDIO_CRDT_ADVANCED_RULER_MAX_NAME_LENGTH = 80;
const STUDIO_CRDT_ADVANCED_RULER_MAX_OFFSET = 1_000_000;
const STUDIO_CRDT_ADVANCED_RULER_MIN_CONTROL_POLYGON_LENGTH = 1e-6;
const STUDIO_CRDT_DELETION_TARGET_MAX_LENGTH = 384;
const STUDIO_CRDT_SHARED_3D_STAGE_PAYLOAD_VERSION = 1;
const STUDIO_CRDT_SHARED_3D_STAGE_DOCUMENT_MAX_BYTES = 8 * 1_024;
const STUDIO_CRDT_SHARED_3D_STAGE_ENTRY_MAX_BYTES = 12 * 1_024;
const STUDIO_CRDT_SHARED_3D_STAGE_COLLECTION_MAX_BYTES = 1_024 * 1_024;
const STUDIO_CRDT_SHARED_3D_STAGE_PAGE_SIZE = 64;
const STUDIO_CRDT_SHARED_3D_RECEIPT_PAGE_SIZE = 256;
const STUDIO_CRDT_SHARED_3D_MAX_PAGE_COUNT = 1_024;
const STUDIO_CRDT_SHARED_3D_MAX_CHARACTERS = 12;
const STUDIO_CRDT_SHARED_3D_SAFE_ID_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/u;
const STUDIO_CRDT_SHARED_3D_SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const STUDIO_CRDT_SHARED_3D_MODEL_RUNTIME_KEY_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}:sha256:[a-f0-9]{64}$/u;
const STUDIO_CRDT_SHARED_3D_FORBIDDEN_IDS = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);
const STUDIO_CRDT_TEXT_ENCODER = new TextEncoder();
const STUDIO_WORK_ASSET_TYPE_SET = new Set<string>(STUDIO_WORK_ASSET_TYPES);
const STUDIO_WORK_ASSET_BOOLEAN_EDIT_KEY_SET = new Set<string>(
  STUDIO_WORK_ASSET_BOOLEAN_EDIT_KEYS
);
const STUDIO_WORK_ASSET_STRUCTURED_EDIT_KEY_SET = new Set<string>(
  STUDIO_WORK_ASSET_STRUCTURED_EDIT_KEYS
);

type StudioCrdtDeletionTarget =
  | { kind: "stroke"; id: string }
  | { kind: "scene"; id: string }
  | { kind: "page"; id: string }
  | { kind: "group"; pageId: string; id: string };

const STUDIO_CRDT_COMMON_SCENE_KEYS = [
  "name",
  "hidden",
  "locked",
  "noClip",
  "opacity",
  "blendMode",
  "lockAspect",
  "groupId",
  "clipBelow",
  "alphaLocked",
  "maskSrc",
  "maskEnabled",
  "layerRole",
  "layerColor",
  "emeresSourceId",
] as const;

const STUDIO_CRDT_SCENE_KEYS_BY_TYPE = {
  text: new Set([
    ...STUDIO_CRDT_COMMON_SCENE_KEYS,
    "text", "x", "y", "width", "fontSize", "fill", "rotation", "font", "stroke",
    "strokeWidth", "letterSpacing", "lineHeight", "vertical", "align", "fontStyle",
    "shadowColor", "shadowBlur", "shadowOffsetX", "shadowOffsetY", "shadowOpacity",
    "fillType", "gradientColorStart", "gradientColorEnd", "gradientDirection", "gradient",
    "textPath", "skewX", "skewY", "stickyNotePresetId", "stickyNoteFill",
  ]),
  bubble: new Set([
    ...STUDIO_CRDT_COMMON_SCENE_KEYS,
    "variant", "text", "x", "y", "width", "height", "fill", "textFill", "rotation",
    "tail", "tailDirection", "extraTails", "font", "fontSize", "lineHeight", "vertical",
    "align", "fontStyle", "tailXRatio", "tailHeight", "tailBase", "tailBend",
    "tailAnchorId", "tailAnchorPoint", "stroke", "strokeWidth", "strokeStyle", "gradient",
    "autoShrinkText", "autoShrinkMinFontSize", "starAmplitude", "shadowColor", "shadowBlur",
    "shadowOffsetX", "shadowOffsetY", "shadowOpacity", "customShapePoints",
  ]),
  sticker: new Set([
    ...STUDIO_CRDT_COMMON_SCENE_KEYS,
    "text", "x", "y", "fontSize", "rotation", "skewX", "skewY",
  ]),
  frame: new Set([
    ...STUDIO_CRDT_COMMON_SCENE_KEYS,
    "x", "y", "width", "height", "bg", "bgColor", "stroke", "strokeWidth", "dashStyle",
    "storyBeat", "aiProvenance", "points",
  ]),
  focusLines: new Set([
    ...STUDIO_CRDT_COMMON_SCENE_KEYS,
    "x", "y", "width", "height", "lineCount", "innerRadius", "outerRadius", "stroke",
    "strokeWidth", "noise", "rotation", "centerXRatio", "centerYRatio",
  ]),
  speedLines: new Set([
    ...STUDIO_CRDT_COMMON_SCENE_KEYS,
    "x", "y", "width", "height", "lineCount", "direction", "stroke", "strokeWidth",
    "noise", "rotation",
  ]),
  // Wire-only topology and bounded edit state for admitted image/VRM/3D bodies. Source bytes stay
  // in work-scoped private storage; this record owns placement, filters, page/layer, and tombstone.
  reference: new Set([
    "elementType",
    ...STUDIO_WORK_ASSET_REFERENCE_EDIT_KEYS,
    ...STUDIO_FILTER_MASK_REFERENCE_EDIT_KEYS,
  ]),
} as const;

type StudioCrdtSceneType = keyof typeof STUDIO_CRDT_SCENE_KEYS_BY_TYPE;

const STUDIO_CRDT_REQUIRED_SCENE_KEYS: Record<StudioCrdtSceneType, readonly string[]> = {
  text: ["text", "x", "y", "width", "fontSize", "fill", "rotation"],
  bubble: ["variant", "text", "x", "y", "width", "height", "fill", "textFill", "rotation"],
  sticker: ["text", "x", "y", "fontSize", "rotation"],
  frame: ["x", "y", "width", "height"],
  focusLines: [
    "x", "y", "width", "height", "lineCount", "innerRadius", "outerRadius", "stroke",
    "strokeWidth", "noise", "rotation",
  ],
  speedLines: [
    "x", "y", "width", "height", "lineCount", "direction", "stroke", "strokeWidth",
    "rotation",
  ],
  reference: ["elementType"],
};

const STUDIO_CRDT_PAGE_KEYS = new Set([
  "bg",
  "bgGrad",
  "canvasH",
  "name",
  "note",
  "hideMaster",
  "shotType",
  "cameraAngle",
  "drawingAssist",
  "paperSurface",
  "paperGrainVisible",
]);

const STUDIO_CRDT_PAPER_GRAIN_KINDS = new Set([
  "hot-press",
  "cold-press",
  "rough",
  "bristol",
  "washi",
  "kraft",
  "canvas",
  "charcoal",
  "newsprint",
  "pastel-board",
  "cotton-rag",
  "watercolor-block",
  "linen-canvas",
  "marker-pad",
  "manga-paper",
  "toned-tan",
  "toned-gray",
  "sanded-pastel",
  "rice-paper",
  "mulberry",
  "vellum",
]);
const STUDIO_CRDT_PAPER_SURFACE_KEYS = new Set(["kind", "seed"]);
const STUDIO_CRDT_PAPER_SURFACE_MAX_SEED = 0xffff_ffff;

const STUDIO_CRDT_LAYER_GROUP_KEYS = new Set(["name", "hidden", "locked"]);

export function isBoundedStudioCrdtId(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 160) return false;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 31 || (codePoint >= 127 && codePoint <= 159)) return false;
  }
  return true;
}

function hasOnlyKeys(value: Y.Map<unknown>, allowed: ReadonlySet<string>): boolean {
  for (const key of value.keys()) {
    if (!allowed.has(key)) return false;
  }
  return true;
}

function materializeExistingMapRoot(
  doc: Y.Doc,
  rootName: string
): Y.Map<unknown> | null | undefined {
  if (!doc.share.has(rootName)) return undefined;
  try {
    return doc.getMap<unknown>(rootName);
  } catch {
    return null;
  }
}

function materializeExistingArrayRoot(
  doc: Y.Doc,
  rootName: string
): Y.Array<unknown> | null | undefined {
  if (!doc.share.has(rootName)) return undefined;
  try {
    return doc.getArray<unknown>(rootName);
  } catch {
    return null;
  }
}

function isBoundedJsonValue(
  value: unknown,
  state = { entries: 0, seen: new WeakSet<object>() },
  depth = 0
): boolean {
  if (depth > STUDIO_CRDT_JSON_MAX_DEPTH || ++state.entries > STUDIO_CRDT_JSON_MAX_ENTRIES) {
    return false;
  }
  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") {
    return value.length <= STUDIO_CRDT_JSON_MAX_STRING_LENGTH && !value.includes("\0");
  }
  if (typeof value !== "object" || value instanceof Y.AbstractType || state.seen.has(value)) {
    return false;
  }
  state.seen.add(value);
  if (Array.isArray(value)) {
    return value.every((item) => isBoundedJsonValue(item, state, depth + 1));
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  for (const [key, item] of Object.entries(value)) {
    if (
      key.length === 0 ||
      key.length > 512 ||
      key.includes("\0") ||
      !isBoundedJsonValue(item, state, depth + 1)
    ) {
      return false;
    }
  }
  return true;
}

function encodedJsonByteLength(value: unknown): number | null {
  try {
    return STUDIO_CRDT_TEXT_ENCODER.encode(JSON.stringify(value)).byteLength;
  } catch {
    return null;
  }
}

function finiteNumberInRange(value: unknown, minimum: number, maximum: number): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function boundedString(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length <= maximum && !value.includes("\0");
}

function boundedExactText(value: unknown, maximum: number): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) return false;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 31 || (codePoint >= 127 && codePoint <= 159)) return false;
  }
  return true;
}

function isExactJsonObject(
  value: unknown,
  requiredKeys: ReadonlySet<string>
): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const keys = Object.keys(value);
  return keys.length === requiredKeys.size && keys.every((key) => requiredKeys.has(key));
}

interface StudioCrdtShared3dStageIdentity {
  readonly key: string;
  readonly pageId: string;
  readonly id: string;
}

interface StudioCrdtShared3dStageCharacter {
  readonly elementId: string;
  readonly modelRuntimeKey: string;
  readonly sourceHash: string;
  readonly placement?: {
    readonly position: readonly [number, number, number];
    readonly rotationY: number;
  };
}

interface StudioCrdtShared3dStageEntry {
  readonly id: string;
  readonly capturePolicy: "require-all-linked" | "background-only";
  readonly background: {
    readonly bundleId: string;
    readonly sourceHash: string;
  };
  readonly characters: readonly StudioCrdtShared3dStageCharacter[];
  readonly dccSource?: {
    readonly sourceDocumentId: string;
    readonly sourceStateHash: string;
    readonly sourceWorkspaceHash: string;
    readonly sourceBridgeSetHash: string;
    readonly sourceCommandCount: number;
    readonly sourceBridgeCommandSequence: number;
  };
}

interface StudioCrdtShared3dActiveStage {
  readonly order: number;
  readonly entry: StudioCrdtShared3dStageEntry;
}

function compareStudioCrdtShared3dIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isStudioCrdtShared3dSafeId(value: unknown): value is string {
  return typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 128 &&
    STUDIO_CRDT_SHARED_3D_SAFE_ID_PATTERN.test(value) &&
    !STUDIO_CRDT_SHARED_3D_FORBIDDEN_IDS.has(value.toLowerCase());
}

function isStudioCrdtShared3dHash(value: unknown): value is string {
  return typeof value === "string" &&
    value.length === 71 &&
    STUDIO_CRDT_SHARED_3D_SHA256_PATTERN.test(value);
}

function hasStudioCrdtShared3dUnsafeText(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
      continue;
    }
    if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) return true;
    const codePoint = value.codePointAt(index) ?? 0;
    if (
      codePoint <= 0x1f ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      (codePoint >= 0x202a && codePoint <= 0x202e) ||
      (codePoint >= 0x2066 && codePoint <= 0x2069)
    ) return true;
  }
  return false;
}

function isStudioCrdtShared3dProvenanceText(value: unknown): value is string {
  return typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 160 &&
    !hasStudioCrdtShared3dUnsafeText(value);
}

function isStudioCrdtShared3dRuntimeKey(
  value: unknown,
  elementId: string
): value is string {
  return typeof value === "string" &&
    value.length <= 200 &&
    STUDIO_CRDT_SHARED_3D_MODEL_RUNTIME_KEY_PATTERN.test(value) &&
    value.startsWith(`${elementId}:`);
}

function hasOnlyJsonKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function parseStudioCrdtShared3dPlacement(value: unknown): {
  readonly position: readonly [number, number, number];
  readonly rotationY: number;
} | null {
  if (!isExactJsonObject(value, new Set(["position", "rotationY"]))) return null;
  if (!Array.isArray(value.position) || value.position.length !== 3) return null;
  if (Object.keys(value.position).some((key) => key !== "0" && key !== "1" && key !== "2")) {
    return null;
  }
  const position = value.position;
  if (
    position.some((component) => !finiteNumberInRange(component, -10, 10)) ||
    !finiteNumberInRange(value.rotationY, -Math.PI, Math.PI)
  ) return null;
  return {
    position: [
      Object.is(position[0], -0) ? 0 : position[0] as number,
      Object.is(position[1], -0) ? 0 : position[1] as number,
      Object.is(position[2], -0) ? 0 : position[2] as number,
    ],
    rotationY: Object.is(value.rotationY, -0) ? 0 : value.rotationY as number,
  };
}

function parseStudioCrdtShared3dStageEntry(value: unknown): StudioCrdtShared3dStageEntry | null {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !hasOnlyJsonKeys(value as Record<string, unknown>, new Set([
      "id",
      "capturePolicy",
      "background",
      "characters",
      "dccSource",
    ]))
  ) return null;
  const candidate = value as Record<string, unknown>;
  if (
    !isStudioCrdtShared3dSafeId(candidate.id) ||
    (candidate.capturePolicy !== "require-all-linked" &&
      candidate.capturePolicy !== "background-only") ||
    !isExactJsonObject(candidate.background, new Set(["bundleId", "sourceHash"])) ||
    !isStudioCrdtShared3dSafeId(candidate.background.bundleId) ||
    !isStudioCrdtShared3dHash(candidate.background.sourceHash) ||
    !Array.isArray(candidate.characters) ||
    candidate.characters.length > STUDIO_CRDT_SHARED_3D_MAX_CHARACTERS ||
    (candidate.capturePolicy === "background-only" && candidate.characters.length > 0)
  ) return null;

  const characters: StudioCrdtShared3dStageCharacter[] = [];
  const elementIds = new Set<string>();
  for (const rawCharacter of candidate.characters) {
    if (
      rawCharacter === null ||
      typeof rawCharacter !== "object" ||
      Array.isArray(rawCharacter) ||
      !hasOnlyJsonKeys(rawCharacter as Record<string, unknown>, new Set([
        "elementId",
        "modelRuntimeKey",
        "sourceHash",
        "placement",
      ]))
    ) return null;
    const character = rawCharacter as Record<string, unknown>;
    if (
      !isStudioCrdtShared3dSafeId(character.elementId) ||
      elementIds.has(character.elementId) ||
      !isStudioCrdtShared3dRuntimeKey(character.modelRuntimeKey, character.elementId) ||
      !isStudioCrdtShared3dHash(character.sourceHash)
    ) return null;
    const placement = character.placement === undefined
      ? undefined
      : parseStudioCrdtShared3dPlacement(character.placement);
    if (character.placement !== undefined && !placement) return null;
    elementIds.add(character.elementId);
    characters.push({
      elementId: character.elementId,
      modelRuntimeKey: character.modelRuntimeKey,
      sourceHash: character.sourceHash,
      ...(placement ? { placement } : {}),
    });
  }

  let dccSource: StudioCrdtShared3dStageEntry["dccSource"];
  if (candidate.dccSource !== undefined) {
    const rawDccSource = candidate.dccSource;
    const keys = new Set([
      "sourceDocumentId",
      "sourceStateHash",
      "sourceWorkspaceHash",
      "sourceBridgeSetHash",
      "sourceCommandCount",
      "sourceBridgeCommandSequence",
    ]);
    if (
      !isExactJsonObject(rawDccSource, keys) ||
      !isStudioCrdtShared3dProvenanceText(rawDccSource.sourceDocumentId) ||
      !isStudioCrdtShared3dProvenanceText(rawDccSource.sourceStateHash) ||
      !isStudioCrdtShared3dHash(rawDccSource.sourceWorkspaceHash) ||
      !isStudioCrdtShared3dProvenanceText(rawDccSource.sourceBridgeSetHash) ||
      !Number.isSafeInteger(rawDccSource.sourceCommandCount) ||
      (rawDccSource.sourceCommandCount as number) < 0 ||
      !Number.isSafeInteger(rawDccSource.sourceBridgeCommandSequence) ||
      (rawDccSource.sourceBridgeCommandSequence as number) < 0
    ) return null;
    dccSource = {
      sourceDocumentId: rawDccSource.sourceDocumentId,
      sourceStateHash: rawDccSource.sourceStateHash,
      sourceWorkspaceHash: rawDccSource.sourceWorkspaceHash,
      sourceBridgeSetHash: rawDccSource.sourceBridgeSetHash,
      sourceCommandCount: rawDccSource.sourceCommandCount as number,
      sourceBridgeCommandSequence: rawDccSource.sourceBridgeCommandSequence as number,
    };
  }

  const entry: StudioCrdtShared3dStageEntry = {
    id: candidate.id,
    capturePolicy: candidate.capturePolicy,
    background: {
      bundleId: candidate.background.bundleId,
      sourceHash: candidate.background.sourceHash,
    },
    characters,
    ...(dccSource ? { dccSource } : {}),
  };
  // The browser collection parser first projects every placement-aware entry through its legacy
  // reference-only v1 document. Keep that stricter 8 KiB gate as well as the v3 entry's 12 KiB
  // envelope or the server could admit a sidecar that every client aggregate reader rejects.
  const referenceOnlyDocument = {
    kind: "toonspectrum.studio-shared-3d-stage",
    version: 1,
    authority: "page-background-with-linked-character-sources",
    capturePolicy: entry.capturePolicy,
    background: entry.background,
    characters: entry.characters.map(({ placement: _placement, ...character }) => character),
    ...(entry.dccSource ? { dccSource: entry.dccSource } : {}),
  };
  const referenceOnlyByteLength = encodedJsonByteLength(referenceOnlyDocument);
  const byteLength = encodedJsonByteLength(entry);
  return referenceOnlyByteLength !== null &&
    referenceOnlyByteLength <= STUDIO_CRDT_SHARED_3D_STAGE_DOCUMENT_MAX_BYTES &&
    byteLength !== null &&
    byteLength <= STUDIO_CRDT_SHARED_3D_STAGE_ENTRY_MAX_BYTES
    ? entry
    : null;
}

function parseCanonicalStudioCrdtShared3dStagePayload(
  value: unknown,
  stageId: string
): StudioCrdtShared3dStageEntry | null {
  if (typeof value !== "string" || value.length === 0) return null;
  try {
    const entry = parseStudioCrdtShared3dStageEntry(JSON.parse(value));
    return entry && entry.id === stageId && JSON.stringify(entry) === value ? entry : null;
  } catch {
    return null;
  }
}

export function encodeStudioCrdtShared3dCompositeKey(pageId: string, id: string): string {
  return `${pageId.length}:${pageId}${id.length}:${id}`;
}

function parseStudioCrdtShared3dCompositeKey(
  key: string,
  validateId: (value: unknown) => value is string
): StudioCrdtShared3dStageIdentity | null {
  if (key.length < 5 || key.length > 328) return null;
  const readPart = (offset: number): { value: string; nextOffset: number } | null => {
    const separator = key.indexOf(":", offset);
    if (separator < 0) return null;
    const lengthToken = key.slice(offset, separator);
    if (!/^(?:0|[1-9][0-9]*)$/u.test(lengthToken)) return null;
    const length = Number(lengthToken);
    if (!Number.isSafeInteger(length) || length <= 0 || length > 160) return null;
    const start = separator + 1;
    const end = start + length;
    return end <= key.length ? { value: key.slice(start, end), nextOffset: end } : null;
  };
  const page = readPart(0);
  if (!page) return null;
  const id = readPart(page.nextOffset);
  if (
    !id ||
    id.nextOffset !== key.length ||
    !isBoundedStudioCrdtId(page.value) ||
    !validateId(id.value)
  ) return null;
  const canonical = encodeStudioCrdtShared3dCompositeKey(page.value, id.value);
  return canonical === key
    ? { key, pageId: page.value, id: id.value }
    : null;
}

function studioCrdtShared3dPageExists(doc: Y.Doc, pageId: string): boolean {
  const pageIndex = materializeExistingMapRoot(doc, STUDIO_CRDT_PAGE_INDEX_ROOT);
  const page = materializeExistingMapRoot(
    doc,
    `${STUDIO_CRDT_PAGE_ROOT_PREFIX}${encodeURIComponent(pageId)}`
  );
  return pageIndex instanceof Y.Map &&
    pageIndex.get(pageId) === true &&
    page instanceof Y.Map &&
    validatePageRoot(pageId, page);
}

function serializedStudioCrdtShared3dFingerprint(serialized: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function studioCrdtShared3dCollectionPageId(
  prefix: "stage" | "receipt",
  index: number,
  items: unknown
): string {
  const serialized = JSON.stringify(items);
  return `${prefix}-page-${index.toString(36).padStart(4, "0")}-${
    serializedStudioCrdtShared3dFingerprint(serialized)
  }`;
}

function chunkStudioCrdtShared3dCollection<T>(
  values: readonly T[],
  size: number,
  prefix: "stage" | "receipt"
): Array<{ readonly id: string; readonly items: readonly T[] }> {
  const pages: Array<{ readonly id: string; readonly items: readonly T[] }> = [];
  for (let offset = 0; offset < values.length; offset += size) {
    const items = values.slice(offset, offset + size);
    pages.push({ id: studioCrdtShared3dCollectionPageId(prefix, pages.length, items), items });
  }
  return pages;
}

function hasValidStudioCrdtShared3dAggregate(
  stages: readonly StudioCrdtShared3dActiveStage[],
  receipts: readonly { readonly elementId: string; readonly modelRuntimeKey: string }[]
): boolean {
  // The caller has already proved that this page owns at least one Stage record. Active receipts
  // without a matching active Stage are dormant grow-only history, not an invalid receipt-only page.
  if (stages.length === 0) return true;
  const bundleIds = new Set<string>();
  const characterAuthorities = new Set<string>();
  const entries = stages
    .slice()
    .sort((left, right) => (
      left.order - right.order || compareStudioCrdtShared3dIds(left.entry.id, right.entry.id)
    ))
    .map(({ entry }) => entry);
  for (const entry of entries) {
    if (bundleIds.has(entry.background.bundleId)) return false;
    bundleIds.add(entry.background.bundleId);
    for (const character of entry.characters) {
      characterAuthorities.add(`${character.elementId}\0${character.modelRuntimeKey}`);
    }
  }
  const orderedReceipts = receipts
    .filter((receipt) => characterAuthorities.has(
      `${receipt.elementId}\0${receipt.modelRuntimeKey}`
    ))
    .sort((left, right) => compareStudioCrdtShared3dIds(left.elementId, right.elementId));

  let collection: unknown;
  if (entries.length <= STUDIO_CRDT_SHARED_3D_STAGE_PAGE_SIZE) {
    collection = {
      kind: "toonspectrum.studio-shared-3d-stage-collection",
      version: 3,
      authority: "page-shared-3d-stage-collection",
      stages: entries,
      visibilityReceipts: orderedReceipts,
    };
  } else {
    const stagePages = chunkStudioCrdtShared3dCollection(
      entries,
      STUDIO_CRDT_SHARED_3D_STAGE_PAGE_SIZE,
      "stage"
    );
    const visibilityReceiptPages = chunkStudioCrdtShared3dCollection(
      orderedReceipts,
      STUDIO_CRDT_SHARED_3D_RECEIPT_PAGE_SIZE,
      "receipt"
    );
    if (
      stagePages.length > STUDIO_CRDT_SHARED_3D_MAX_PAGE_COUNT ||
      visibilityReceiptPages.length > STUDIO_CRDT_SHARED_3D_MAX_PAGE_COUNT
    ) return false;
    collection = {
      kind: "toonspectrum.studio-shared-3d-stage-collection",
      version: 4,
      authority: "page-shared-3d-stage-collection",
      stagePages,
      visibilityReceiptPages,
    };
  }
  const byteLength = encodedJsonByteLength(collection);
  return byteLength !== null &&
    byteLength <= STUDIO_CRDT_SHARED_3D_STAGE_COLLECTION_MAX_BYTES;
}

const STUDIO_CRDT_SHARED_3D_STAGE_RECORD_KEYS = new Set([
  "pageId",
  "stageId",
  "payloadVersion",
  "order",
  "payload",
]);
const STUDIO_CRDT_SHARED_3D_RECEIPT_RECORD_KEYS = new Set([
  "pageId",
  "elementId",
  "payloadVersion",
  "modelRuntimeKey",
]);
const STUDIO_CRDT_SHARED_3D_EVENT_KEY_PATTERN = /^(activate|deactivate):(0|[1-9][0-9]*)$/u;
const STUDIO_CRDT_SHARED_3D_EVENT_MAX_PER_RECORD = 256;
const STUDIO_CRDT_SHARED_3D_EVENT_MAX_GENERATION = 255;
const STUDIO_CRDT_SHARED_3D_EVENT_MAX_TOTAL = STUDIO_CRDT_COLLECTION_MAX_ENTRIES;

interface StudioCrdtShared3dEvents {
  readonly eventKeys: ReadonlySet<string>;
  readonly maxActivate: number;
  readonly maxDeactivate: number;
}

interface StudioCrdtShared3dValidatedStageRecord extends StudioCrdtShared3dEvents {
  readonly identity: StudioCrdtShared3dStageIdentity;
  readonly order: number;
  readonly entry: StudioCrdtShared3dStageEntry;
}

interface StudioCrdtShared3dValidatedReceiptRecord extends StudioCrdtShared3dEvents {
  readonly identity: StudioCrdtShared3dStageIdentity;
  readonly modelRuntimeKey: string;
}

function readStudioCrdtShared3dEvents(
  record: Y.Map<unknown>,
  fixedKeys: ReadonlySet<string>
): StudioCrdtShared3dEvents | null {
  const eventKeys = new Set<string>();
  let maxActivate = -1;
  let maxDeactivate = -1;
  for (const [key, value] of record) {
    if (fixedKeys.has(key)) continue;
    const match = STUDIO_CRDT_SHARED_3D_EVENT_KEY_PATTERN.exec(key);
    if (!match || value !== true) return null;
    const generation = Number(match[2]);
    if (
      !Number.isSafeInteger(generation) ||
      generation < 0 ||
      generation > STUDIO_CRDT_SHARED_3D_EVENT_MAX_GENERATION
    ) return null;
    eventKeys.add(key);
    if (eventKeys.size > STUDIO_CRDT_SHARED_3D_EVENT_MAX_PER_RECORD) return null;
    if (match[1] === "activate") maxActivate = Math.max(maxActivate, generation);
    else maxDeactivate = Math.max(maxDeactivate, generation);
  }
  if (eventKeys.size === 0) return null;
  for (const key of eventKeys) {
    const match = STUDIO_CRDT_SHARED_3D_EVENT_KEY_PATTERN.exec(key)!;
    const generation = Number(match[2]);
    if (
      (match[1] === "activate" && generation > 0 &&
        !eventKeys.has(`deactivate:${generation - 1}`)) ||
      (match[1] === "deactivate" && generation > 0 &&
        !eventKeys.has(`activate:${generation}`))
    ) return null;
  }
  // The final bounded-history slot is reserved for a remove-wins deactivation. Accepting an active
  // record at the cap would make that Stage/receipt impossible to unlink for the rest of the room.
  if (
    eventKeys.size === STUDIO_CRDT_SHARED_3D_EVENT_MAX_PER_RECORD
    && maxActivate > maxDeactivate
  ) return null;
  return { eventKeys, maxActivate, maxDeactivate };
}

function isStudioCrdtShared3dRecordActive(record: StudioCrdtShared3dEvents): boolean {
  return record.maxActivate > record.maxDeactivate;
}

function hasRequiredStudioCrdtShared3dFields(
  record: Y.Map<unknown>,
  requiredKeys: ReadonlySet<string>
): boolean {
  for (const key of requiredKeys) {
    if (!record.has(key)) return false;
  }
  return true;
}

function studioCrdtShared3dDynamicRootName(prefix: string, key: string): string {
  return `${prefix}${encodeURIComponent(key)}`;
}

function parseStudioCrdtShared3dDynamicRootIdentity(
  rootName: string,
  prefix: string
): StudioCrdtShared3dStageIdentity | null {
  if (!rootName.startsWith(prefix)) return null;
  const encodedKey = rootName.slice(prefix.length);
  if (!encodedKey) return null;
  try {
    const key = decodeURIComponent(encodedKey);
    return encodeURIComponent(key) === encodedKey
      ? parseStudioCrdtShared3dCompositeKey(key, isStudioCrdtShared3dSafeId)
      : null;
  } catch {
    return null;
  }
}

function validateStudioCrdtShared3dStageRecord(
  identity: StudioCrdtShared3dStageIdentity,
  record: Y.Map<unknown>
): StudioCrdtShared3dValidatedStageRecord | null {
  const events = readStudioCrdtShared3dEvents(
    record,
    STUDIO_CRDT_SHARED_3D_STAGE_RECORD_KEYS
  );
  if (
    !hasRequiredStudioCrdtShared3dFields(record, STUDIO_CRDT_SHARED_3D_STAGE_RECORD_KEYS) ||
    record.get("pageId") !== identity.pageId ||
    record.get("stageId") !== identity.id ||
    record.get("payloadVersion") !== STUDIO_CRDT_SHARED_3D_STAGE_PAYLOAD_VERSION ||
    !Number.isSafeInteger(record.get("order")) ||
    (record.get("order") as number) < 0 ||
    !events
  ) return null;
  const entry = parseCanonicalStudioCrdtShared3dStagePayload(record.get("payload"), identity.id);
  return entry
    ? { identity, order: record.get("order") as number, entry, ...events }
    : null;
}

function validateStudioCrdtShared3dReceiptRecord(
  identity: StudioCrdtShared3dStageIdentity,
  record: Y.Map<unknown>
): StudioCrdtShared3dValidatedReceiptRecord | null {
  const events = readStudioCrdtShared3dEvents(
    record,
    STUDIO_CRDT_SHARED_3D_RECEIPT_RECORD_KEYS
  );
  const modelRuntimeKey = record.get("modelRuntimeKey");
  return hasRequiredStudioCrdtShared3dFields(
    record,
    STUDIO_CRDT_SHARED_3D_RECEIPT_RECORD_KEYS
  ) &&
    record.get("pageId") === identity.pageId &&
    record.get("elementId") === identity.id &&
    record.get("payloadVersion") === STUDIO_CRDT_SHARED_3D_STAGE_PAYLOAD_VERSION &&
    events &&
    isStudioCrdtShared3dRuntimeKey(modelRuntimeKey, identity.id)
    ? { identity, modelRuntimeKey, ...events }
    : null;
}

function validateStudioCrdtShared3dStageRoots(doc: Y.Doc): boolean {
  const stageIndex = materializeExistingMapRoot(doc, STUDIO_CRDT_SHARED_3D_STAGE_RECORDS_ROOT);
  const receiptIndex = materializeExistingMapRoot(
    doc,
    STUDIO_CRDT_SHARED_3D_STAGE_VISIBILITY_RECEIPTS_ROOT
  );
  if (
    stageIndex === null ||
    receiptIndex === null ||
    (stageIndex?.size ?? 0) > STUDIO_CRDT_COLLECTION_MAX_ENTRIES ||
    (receiptIndex?.size ?? 0) > STUDIO_CRDT_COLLECTION_MAX_ENTRIES
  ) return false;

  const stagesByPage = new Map<string, StudioCrdtShared3dActiveStage[]>();
  const receiptsByPage = new Map<string, Array<{
    readonly elementId: string;
    readonly modelRuntimeKey: string;
  }>>();
  const trackedStageKeys = new Set<string>();
  const trackedReceiptKeys = new Set<string>();
  const managedPages = new Set<string>();
  let totalEventCount = 0;

  for (const [key, tracked] of stageIndex ?? []) {
    const identity = parseStudioCrdtShared3dCompositeKey(key, isStudioCrdtShared3dSafeId);
    const record = identity
      ? materializeExistingMapRoot(
          doc,
          studioCrdtShared3dDynamicRootName(
            STUDIO_CRDT_SHARED_3D_STAGE_RECORD_ROOT_PREFIX,
            key
          )
        )
      : null;
    const validated = identity && tracked === true && record instanceof Y.Map
      ? validateStudioCrdtShared3dStageRecord(identity, record)
      : null;
    if (!validated) return false;
    totalEventCount += validated.eventKeys.size;
    if (totalEventCount > STUDIO_CRDT_SHARED_3D_EVENT_MAX_TOTAL) return false;
    trackedStageKeys.add(key);
    managedPages.add(validated.identity.pageId);
    if (isStudioCrdtShared3dRecordActive(validated)) {
      const stages = stagesByPage.get(validated.identity.pageId) ?? [];
      stages.push({ order: validated.order, entry: validated.entry });
      stagesByPage.set(validated.identity.pageId, stages);
    }
  }

  for (const [key, tracked] of receiptIndex ?? []) {
    const identity = parseStudioCrdtShared3dCompositeKey(key, isStudioCrdtShared3dSafeId);
    const record = identity
      ? materializeExistingMapRoot(
          doc,
          studioCrdtShared3dDynamicRootName(
            STUDIO_CRDT_SHARED_3D_STAGE_VISIBILITY_RECEIPT_ROOT_PREFIX,
            key
          )
        )
      : null;
    const validated = identity && tracked === true && record instanceof Y.Map
      ? validateStudioCrdtShared3dReceiptRecord(identity, record)
      : null;
    if (!validated || !managedPages.has(validated.identity.pageId)) return false;
    totalEventCount += validated.eventKeys.size;
    if (totalEventCount > STUDIO_CRDT_SHARED_3D_EVENT_MAX_TOTAL) return false;
    trackedReceiptKeys.add(key);
    if (isStudioCrdtShared3dRecordActive(validated)) {
      const receipts = receiptsByPage.get(validated.identity.pageId) ?? [];
      receipts.push({
        elementId: validated.identity.id,
        modelRuntimeKey: validated.modelRuntimeKey,
      });
      receiptsByPage.set(validated.identity.pageId, receipts);
    }
  }

  let dynamicStageCount = 0;
  let dynamicReceiptCount = 0;
  for (const [rootName, value] of doc.share) {
    if (rootName.startsWith(STUDIO_CRDT_SHARED_3D_STAGE_RECORD_ROOT_PREFIX)) {
      dynamicStageCount += 1;
      const identity = parseStudioCrdtShared3dDynamicRootIdentity(
        rootName,
        STUDIO_CRDT_SHARED_3D_STAGE_RECORD_ROOT_PREFIX
      );
      if (
        dynamicStageCount > STUDIO_CRDT_COLLECTION_MAX_ENTRIES ||
        !identity ||
        !trackedStageKeys.has(identity.key) ||
        !(value instanceof Y.Map) ||
        !validateStudioCrdtShared3dStageRecord(identity, value)
      ) return false;
    }
    if (rootName.startsWith(STUDIO_CRDT_SHARED_3D_STAGE_VISIBILITY_RECEIPT_ROOT_PREFIX)) {
      dynamicReceiptCount += 1;
      const identity = parseStudioCrdtShared3dDynamicRootIdentity(
        rootName,
        STUDIO_CRDT_SHARED_3D_STAGE_VISIBILITY_RECEIPT_ROOT_PREFIX
      );
      if (
        dynamicReceiptCount > STUDIO_CRDT_COLLECTION_MAX_ENTRIES ||
        !identity ||
        !trackedReceiptKeys.has(identity.key) ||
        !(value instanceof Y.Map) ||
        !validateStudioCrdtShared3dReceiptRecord(identity, value)
      ) return false;
    }
  }
  if (
    dynamicStageCount !== trackedStageKeys.size ||
    dynamicReceiptCount !== trackedReceiptKeys.size
  ) return false;

  for (const pageId of managedPages) {
    if (
      !studioCrdtShared3dPageExists(doc, pageId) ||
      !hasValidStudioCrdtShared3dAggregate(
        stagesByPage.get(pageId) ?? [],
        receiptsByPage.get(pageId) ?? []
      )
    ) return false;
  }
  return true;
}

interface StudioCrdtShared3dImmutableRecordSnapshot extends StudioCrdtShared3dEvents {
  readonly pageId: unknown;
  readonly id: unknown;
  readonly payloadVersion: unknown;
}

export interface StudioCrdtShared3dRootSnapshot {
  readonly stageRootExisted: boolean;
  readonly receiptRootExisted: boolean;
  readonly stages: ReadonlyMap<string, StudioCrdtShared3dImmutableRecordSnapshot>;
  readonly receipts: ReadonlyMap<string, StudioCrdtShared3dImmutableRecordSnapshot>;
}

function snapshotStudioCrdtShared3dRecord(
  record: Y.Map<unknown>,
  idKey: "stageId" | "elementId"
): StudioCrdtShared3dImmutableRecordSnapshot | null {
  const events = readStudioCrdtShared3dEvents(
    record,
    idKey === "stageId"
      ? STUDIO_CRDT_SHARED_3D_STAGE_RECORD_KEYS
      : STUDIO_CRDT_SHARED_3D_RECEIPT_RECORD_KEYS
  );
  return events
    ? {
        pageId: record.get("pageId"),
        id: record.get(idKey),
        payloadVersion: record.get("payloadVersion"),
        ...events,
      }
    : null;
}

export function snapshotStudioCrdtShared3dStageRoots(
  doc: Y.Doc
): StudioCrdtShared3dRootSnapshot | null {
  const stageIndex = materializeExistingMapRoot(doc, STUDIO_CRDT_SHARED_3D_STAGE_RECORDS_ROOT);
  const receiptIndex = materializeExistingMapRoot(
    doc,
    STUDIO_CRDT_SHARED_3D_STAGE_VISIBILITY_RECEIPTS_ROOT
  );
  if (stageIndex === null || receiptIndex === null) return null;
  const stages = new Map<string, StudioCrdtShared3dImmutableRecordSnapshot>();
  for (const [key, tracked] of stageIndex ?? []) {
    const record = materializeExistingMapRoot(
      doc,
      studioCrdtShared3dDynamicRootName(STUDIO_CRDT_SHARED_3D_STAGE_RECORD_ROOT_PREFIX, key)
    );
    const snapshot = tracked === true && record instanceof Y.Map
      ? snapshotStudioCrdtShared3dRecord(record, "stageId")
      : null;
    if (!snapshot) return null;
    stages.set(key, snapshot);
  }
  const receipts = new Map<string, StudioCrdtShared3dImmutableRecordSnapshot>();
  for (const [key, tracked] of receiptIndex ?? []) {
    const record = materializeExistingMapRoot(
      doc,
      studioCrdtShared3dDynamicRootName(
        STUDIO_CRDT_SHARED_3D_STAGE_VISIBILITY_RECEIPT_ROOT_PREFIX,
        key
      )
    );
    const snapshot = tracked === true && record instanceof Y.Map
      ? snapshotStudioCrdtShared3dRecord(record, "elementId")
      : null;
    if (!snapshot) return null;
    receipts.set(key, snapshot);
  }
  return {
    stageRootExisted: stageIndex !== undefined,
    receiptRootExisted: receiptIndex !== undefined,
    stages,
    receipts,
  };
}

function preservesStudioCrdtShared3dRecord(
  previous: StudioCrdtShared3dImmutableRecordSnapshot,
  current: Y.Map<unknown>,
  idKey: "stageId" | "elementId"
): boolean {
  return current.get("pageId") === previous.pageId &&
    current.get(idKey) === previous.id &&
    current.get("payloadVersion") === previous.payloadVersion &&
    [...previous.eventKeys].every((key) => current.get(key) === true);
}

export function preservesStudioCrdtShared3dStageRoots(
  snapshot: StudioCrdtShared3dRootSnapshot | null,
  doc: Y.Doc
): boolean {
  if (!snapshot) return false;
  const stageIndex = materializeExistingMapRoot(doc, STUDIO_CRDT_SHARED_3D_STAGE_RECORDS_ROOT);
  const receiptIndex = materializeExistingMapRoot(
    doc,
    STUDIO_CRDT_SHARED_3D_STAGE_VISIBILITY_RECEIPTS_ROOT
  );
  if (
    stageIndex === null ||
    receiptIndex === null ||
    (snapshot.stageRootExisted && stageIndex === undefined) ||
    (snapshot.receiptRootExisted && receiptIndex === undefined)
  ) return false;
  for (const [key, previous] of snapshot.stages) {
    const current = materializeExistingMapRoot(
      doc,
      studioCrdtShared3dDynamicRootName(STUDIO_CRDT_SHARED_3D_STAGE_RECORD_ROOT_PREFIX, key)
    );
    if (
      stageIndex?.get(key) !== true ||
      !(current instanceof Y.Map) ||
      !preservesStudioCrdtShared3dRecord(previous, current, "stageId")
    ) return false;
  }
  for (const [key, previous] of snapshot.receipts) {
    const current = materializeExistingMapRoot(
      doc,
      studioCrdtShared3dDynamicRootName(
        STUDIO_CRDT_SHARED_3D_STAGE_VISIBILITY_RECEIPT_ROOT_PREFIX,
        key
      )
    );
    if (
      receiptIndex?.get(key) !== true ||
      !(current instanceof Y.Map) ||
      !preservesStudioCrdtShared3dRecord(previous, current, "elementId")
    ) return false;
  }
  return true;
}

function admitsStudioCrdtShared3dRecordEvents(
  previous: StudioCrdtShared3dImmutableRecordSnapshot | undefined,
  current: StudioCrdtShared3dEvents
): boolean {
  const newEventKeys = [...current.eventKeys].filter((key) => !previous?.eventKeys.has(key));
  if (!previous) return newEventKeys.length > 0;
  const maxBefore = Math.max(previous.maxActivate, previous.maxDeactivate);
  for (const key of newEventKeys) {
    const match = STUDIO_CRDT_SHARED_3D_EVENT_KEY_PATTERN.exec(key);
    if (!match) return false;
    const generation = Number(match[2]);
    if (generation <= maxBefore) continue;
    // Offline/reconnect updates may contain several complete transitions. Accept the aggregate
    // suffix only when every event carries its causal predecessor in the same grow-only record;
    // readStudioCrdtShared3dEvents already enforces the same shape for the full current set.
    const predecessor = match[1] === "activate"
      ? generation === 0 ? null : `deactivate:${generation - 1}`
      : generation === 0 ? null : `activate:${generation}`;
    if (predecessor && !current.eventKeys.has(predecessor)) return false;
  }
  return true;
}

/**
 * Admission guard for a staged update. Call after root-schema validation and preservation checks;
 * it rejects generation gaps while still accepting late non-winning concurrent history.
 */
export function admitsStudioCrdtShared3dStageEvents(
  snapshot: StudioCrdtShared3dRootSnapshot | null,
  doc: Y.Doc
): boolean {
  if (!snapshot || !preservesStudioCrdtShared3dStageRoots(snapshot, doc)) return false;
  const stageIndex = materializeExistingMapRoot(doc, STUDIO_CRDT_SHARED_3D_STAGE_RECORDS_ROOT);
  const receiptIndex = materializeExistingMapRoot(
    doc,
    STUDIO_CRDT_SHARED_3D_STAGE_VISIBILITY_RECEIPTS_ROOT
  );
  if (stageIndex === null || receiptIndex === null) return false;
  for (const [key, tracked] of stageIndex ?? []) {
    const record = materializeExistingMapRoot(
      doc,
      studioCrdtShared3dDynamicRootName(STUDIO_CRDT_SHARED_3D_STAGE_RECORD_ROOT_PREFIX, key)
    );
    const current = tracked === true && record instanceof Y.Map
      ? readStudioCrdtShared3dEvents(
          record,
          STUDIO_CRDT_SHARED_3D_STAGE_RECORD_KEYS
        )
      : null;
    if (!current || !admitsStudioCrdtShared3dRecordEvents(snapshot.stages.get(key), current)) {
      return false;
    }
  }
  for (const [key, tracked] of receiptIndex ?? []) {
    const record = materializeExistingMapRoot(
      doc,
      studioCrdtShared3dDynamicRootName(
        STUDIO_CRDT_SHARED_3D_STAGE_VISIBILITY_RECEIPT_ROOT_PREFIX,
        key
      )
    );
    const current = tracked === true && record instanceof Y.Map
      ? readStudioCrdtShared3dEvents(
          record,
          STUDIO_CRDT_SHARED_3D_RECEIPT_RECORD_KEYS
        )
      : null;
    if (!current || !admitsStudioCrdtShared3dRecordEvents(snapshot.receipts.get(key), current)) {
      return false;
    }
  }
  return true;
}

function isValidStudioCrdtPaperSurface(value: unknown): boolean {
  if (!isExactJsonObject(value, STUDIO_CRDT_PAPER_SURFACE_KEYS)) return false;
  return typeof value.kind === "string" &&
    STUDIO_CRDT_PAPER_GRAIN_KINDS.has(value.kind) &&
    typeof value.seed === "number" &&
    Number.isInteger(value.seed) &&
    value.seed >= 0 &&
    value.seed <= STUDIO_CRDT_PAPER_SURFACE_MAX_SEED;
}

const STUDIO_CRDT_DRAWING_ASSIST_LEGACY_KEYS = new Set([
  "version",
  "perspective",
  "isometric",
]);
const STUDIO_CRDT_DRAWING_ASSIST_KEYS = new Set([
  "version",
  "perspective",
  "isometric",
  "advanced",
]);
const STUDIO_CRDT_PERSPECTIVE_ASSIST_KEYS_LEGACY = new Set(["active", "points"]);
/** Canonical: independent eye-level horizon + optional VP horizon lock (CSP-class). */
const STUDIO_CRDT_PERSPECTIVE_ASSIST_KEYS = new Set([
  "active",
  "points",
  "eyeLevelY",
  "lockHorizon",
]);
const STUDIO_CRDT_VANISHING_POINT_KEYS = new Set(["id", "x", "y"]);
const STUDIO_CRDT_ISOMETRIC_ASSIST_KEYS = new Set([
  "active",
  "angleDeg",
  "cellSize",
  "originX",
  "originY",
]);
const STUDIO_CRDT_ADVANCED_RULER_KEYS = new Set([
  "version",
  "rulers",
  "activeSnapRulerId",
  "selectedRulerId",
]);
const STUDIO_CRDT_ADVANCED_RULER_SCOPE_KEYS = new Set(["kind", "groupId"]);
const STUDIO_CRDT_ADVANCED_RULER_POINT_KEYS = new Set(["x", "y"]);
const STUDIO_CRDT_ADVANCED_CURVE_RULER_KEYS = new Set([
  "id",
  "type",
  "name",
  "enabled",
  "visible",
  "scope",
  "snapMode",
  "fixedOffset",
  "p0",
  "p1",
  "p2",
  "p3",
]);
const STUDIO_CRDT_ADVANCED_FISHEYE_RULER_KEYS = new Set([
  "id",
  "type",
  "name",
  "enabled",
  "visible",
  "scope",
  "guideFamily",
  "centerX",
  "centerY",
  "radius",
  "rotationDeg",
  "fovDeg",
  "strength",
  "outsidePolicy",
]);

function isValidStudioCrdtAdvancedRulerScope(value: unknown): boolean {
  if (!isExactJsonObject(value, STUDIO_CRDT_ADVANCED_RULER_SCOPE_KEYS)) return false;
  return (value.kind === "page" && value.groupId === null) ||
    (value.kind === "group" && isBoundedStudioCrdtId(value.groupId));
}

function isValidStudioCrdtAdvancedRulerPoint(value: unknown): value is {
  x: number;
  y: number;
} {
  return isExactJsonObject(value, STUDIO_CRDT_ADVANCED_RULER_POINT_KEYS) &&
    finiteNumberInRange(value.x, -STUDIO_CRDT_MAX_COORDINATE, STUDIO_CRDT_MAX_COORDINATE) &&
    finiteNumberInRange(value.y, -STUDIO_CRDT_MAX_COORDINATE, STUDIO_CRDT_MAX_COORDINATE);
}

function hasValidStudioCrdtAdvancedRulerBase(value: Record<string, unknown>): boolean {
  return isBoundedStudioCrdtId(value.id) &&
    boundedExactText(value.name, STUDIO_CRDT_ADVANCED_RULER_MAX_NAME_LENGTH) &&
    typeof value.enabled === "boolean" &&
    typeof value.visible === "boolean" &&
    isValidStudioCrdtAdvancedRulerScope(value.scope);
}

function isValidStudioCrdtAdvancedCurveRuler(value: unknown): value is Record<string, unknown> {
  if (
    !isExactJsonObject(value, STUDIO_CRDT_ADVANCED_CURVE_RULER_KEYS) ||
    value.type !== "curve" ||
    !hasValidStudioCrdtAdvancedRulerBase(value) ||
    !["through-start", "on-curve", "fixed"].includes(value.snapMode as string) ||
    !finiteNumberInRange(
      value.fixedOffset,
      -STUDIO_CRDT_ADVANCED_RULER_MAX_OFFSET,
      STUDIO_CRDT_ADVANCED_RULER_MAX_OFFSET
    ) ||
    !isValidStudioCrdtAdvancedRulerPoint(value.p0) ||
    !isValidStudioCrdtAdvancedRulerPoint(value.p1) ||
    !isValidStudioCrdtAdvancedRulerPoint(value.p2) ||
    !isValidStudioCrdtAdvancedRulerPoint(value.p3)
  ) {
    return false;
  }
  const controlPolygonLength = Math.hypot(value.p1.x - value.p0.x, value.p1.y - value.p0.y) +
    Math.hypot(value.p2.x - value.p1.x, value.p2.y - value.p1.y) +
    Math.hypot(value.p3.x - value.p2.x, value.p3.y - value.p2.y);
  return controlPolygonLength >= STUDIO_CRDT_ADVANCED_RULER_MIN_CONTROL_POLYGON_LENGTH;
}

function isValidStudioCrdtAdvancedFisheyeRuler(value: unknown): value is Record<string, unknown> {
  return isExactJsonObject(value, STUDIO_CRDT_ADVANCED_FISHEYE_RULER_KEYS) &&
    value.type === "fisheye" &&
    hasValidStudioCrdtAdvancedRulerBase(value) &&
    ["auto", "radial", "spherical"].includes(value.guideFamily as string) &&
    finiteNumberInRange(
      value.centerX,
      -STUDIO_CRDT_MAX_COORDINATE,
      STUDIO_CRDT_MAX_COORDINATE
    ) &&
    finiteNumberInRange(
      value.centerY,
      -STUDIO_CRDT_MAX_COORDINATE,
      STUDIO_CRDT_MAX_COORDINATE
    ) &&
    finiteNumberInRange(value.radius, 8, STUDIO_CRDT_MAX_COORDINATE) &&
    finiteNumberInRange(value.rotationDeg, 0, 360) &&
    value.rotationDeg !== 360 &&
    finiteNumberInRange(value.fovDeg, 30, 220) &&
    finiteNumberInRange(value.strength, 0.25, 4) &&
    ["reject", "clamp", "passthrough"].includes(value.outsidePolicy as string);
}

function isValidStudioCrdtAdvancedRulerDocument(value: unknown): value is Record<string, unknown> {
  if (
    !isExactJsonObject(value, STUDIO_CRDT_ADVANCED_RULER_KEYS) ||
    value.version !== STUDIO_CRDT_ADVANCED_RULER_VERSION ||
    !Array.isArray(value.rulers) ||
    value.rulers.length > STUDIO_CRDT_ADVANCED_RULER_MAX_COUNT
  ) {
    return false;
  }
  const ids = new Set<string>();
  const enabledIds = new Set<string>();
  for (const ruler of value.rulers) {
    if (
      (!isValidStudioCrdtAdvancedCurveRuler(ruler) &&
        !isValidStudioCrdtAdvancedFisheyeRuler(ruler)) ||
      ids.has(ruler.id as string)
    ) {
      return false;
    }
    ids.add(ruler.id as string);
    if (ruler.enabled === true) enabledIds.add(ruler.id as string);
  }
  if (
    value.activeSnapRulerId !== null &&
    (!isBoundedStudioCrdtId(value.activeSnapRulerId) ||
      !enabledIds.has(value.activeSnapRulerId))
  ) {
    return false;
  }
  if (
    value.selectedRulerId !== null &&
    (!isBoundedStudioCrdtId(value.selectedRulerId) || !ids.has(value.selectedRulerId))
  ) {
    return false;
  }
  const byteLength = encodedJsonByteLength(value);
  return byteLength !== null && byteLength <= STUDIO_CRDT_ADVANCED_RULER_MAX_BYTES;
}

function isValidStudioCrdtDrawingAssist(value: unknown): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const version = (value as Record<string, unknown>).version;
  const expectedKeys = version === STUDIO_CRDT_DRAWING_ASSIST_LEGACY_VERSION
    ? STUDIO_CRDT_DRAWING_ASSIST_LEGACY_KEYS
    : version === STUDIO_CRDT_DRAWING_ASSIST_VERSION
      ? STUDIO_CRDT_DRAWING_ASSIST_KEYS
      : null;
  if (!expectedKeys || !isExactJsonObject(value, expectedKeys)) return false;
  const { perspective, isometric } = value;
  const perspectiveKeysOk = isExactJsonObject(perspective, STUDIO_CRDT_PERSPECTIVE_ASSIST_KEYS)
    || isExactJsonObject(perspective, STUDIO_CRDT_PERSPECTIVE_ASSIST_KEYS_LEGACY);
  if (
    !perspectiveKeysOk ||
    !isExactJsonObject(isometric, STUDIO_CRDT_ISOMETRIC_ASSIST_KEYS) ||
    typeof perspective.active !== "boolean" ||
    typeof isometric.active !== "boolean" ||
    (perspective.active && isometric.active) ||
    !Array.isArray(perspective.points) ||
    perspective.points.length > STUDIO_CRDT_DRAWING_ASSIST_MAX_VANISHING_POINTS ||
    !finiteNumberInRange(
      isometric.angleDeg,
      STUDIO_CRDT_DRAWING_ASSIST_ANGLE_MIN_DEG,
      STUDIO_CRDT_DRAWING_ASSIST_ANGLE_MAX_DEG
    ) ||
    !finiteNumberInRange(
      isometric.cellSize,
      STUDIO_CRDT_DRAWING_ASSIST_CELL_SIZE_MIN,
      STUDIO_CRDT_DRAWING_ASSIST_CELL_SIZE_MAX
    ) ||
    !finiteNumberInRange(
      isometric.originX,
      -STUDIO_CRDT_MAX_COORDINATE,
      STUDIO_CRDT_MAX_COORDINATE
    ) ||
    !finiteNumberInRange(
      isometric.originY,
      -STUDIO_CRDT_MAX_COORDINATE,
      STUDIO_CRDT_MAX_COORDINATE
    )
  ) {
    return false;
  }
  if (Object.prototype.hasOwnProperty.call(perspective, "eyeLevelY")) {
    const eyeLevelY = (perspective as { eyeLevelY: unknown }).eyeLevelY;
    if (
      eyeLevelY !== null
      && !finiteNumberInRange(eyeLevelY, -STUDIO_CRDT_MAX_COORDINATE, STUDIO_CRDT_MAX_COORDINATE)
    ) {
      return false;
    }
  }
  if (Object.prototype.hasOwnProperty.call(perspective, "lockHorizon")) {
    if (typeof (perspective as { lockHorizon: unknown }).lockHorizon !== "boolean") {
      return false;
    }
  }

  const pointIds = new Set<string>();
  for (const point of perspective.points) {
    if (
      !isExactJsonObject(point, STUDIO_CRDT_VANISHING_POINT_KEYS) ||
      !isBoundedStudioCrdtId(point.id) ||
      pointIds.has(point.id) ||
      !finiteNumberInRange(point.x, -STUDIO_CRDT_MAX_COORDINATE, STUDIO_CRDT_MAX_COORDINATE) ||
      !finiteNumberInRange(point.y, -STUDIO_CRDT_MAX_COORDINATE, STUDIO_CRDT_MAX_COORDINATE)
    ) {
      return false;
    }
    pointIds.add(point.id);
  }
  if (value.version === STUDIO_CRDT_DRAWING_ASSIST_VERSION) {
    if (!isValidStudioCrdtAdvancedRulerDocument(value.advanced)) return false;
    if (
      value.advanced.activeSnapRulerId !== null &&
      (perspective.active || isometric.active)
    ) {
      return false;
    }
  }
  const byteLength = encodedJsonByteLength(value);
  return byteLength !== null && byteLength <= STUDIO_CRDT_PAGE_PAYLOAD_MAX_BYTES;
}

function isValidStudioWorkAssetReferenceCandidate(
  property: string,
  value: unknown
): boolean {
  if (property === "elementType") {
    return isValidLegacyStudioCrdtReferenceType(value);
  }
  if (property === "x" || property === "y") {
    return finiteNumberInRange(value, -STUDIO_CRDT_MAX_COORDINATE, STUDIO_CRDT_MAX_COORDINATE);
  }
  if (property === "width" || property === "height") {
    return finiteNumberInRange(value, Number.MIN_VALUE, STUDIO_CRDT_MAX_COORDINATE);
  }
  if (property === "rotation") return finiteNumberInRange(value, -360_000, 360_000);
  if (property === "opacity") return finiteNumberInRange(value, 0, 1);
  if (property === "filterMaskSurfaceId") return isStudioFilterMaskSurfaceId(value);
  if (property === "filterMaskEnabled") return typeof value === "boolean";
  if (STUDIO_WORK_ASSET_BOOLEAN_EDIT_KEY_SET.has(property)) return typeof value === "boolean";
  if (STUDIO_WORK_ASSET_STRUCTURED_EDIT_KEY_SET.has(property)) {
    try {
      parseStudioWorkAssetStructuredEditValue(
        property as (typeof STUDIO_WORK_ASSET_STRUCTURED_EDIT_KEYS)[number],
        value
      );
      return true;
    } catch {
      return false;
    }
  }
  const range = STUDIO_WORK_ASSET_SCALAR_FILTER_RANGES[
    property as keyof typeof STUDIO_WORK_ASSET_SCALAR_FILTER_RANGES
  ];
  return Boolean(range && finiteNumberInRange(value, range.minimum, range.maximum));
}

function isValidLegacyStudioCrdtReferenceType(value: unknown): value is string {
  return boundedExactText(value, 160) && value !== "draw" && !isStudioCrdtSceneType(value);
}

function hasLegacyStudioCrdtReferenceProps(
  props: Record<string, unknown>
): boolean {
  return Object.keys(props).length === 1 &&
    isValidLegacyStudioCrdtReferenceType(props.elementType);
}

function studioFilterMaskReferenceProps(
  props: Record<string, unknown>
): Record<string, unknown> {
  const candidate: Record<string, unknown> = {};
  for (const key of STUDIO_FILTER_MASK_REFERENCE_EDIT_KEYS) {
    if (Object.hasOwn(props, key)) candidate[key] = props[key];
  }
  return candidate;
}

function hasStudioFilterMaskReferenceState(
  props: Record<string, unknown>
): boolean {
  return STUDIO_FILTER_MASK_REFERENCE_EDIT_KEYS.some((key) => Object.hasOwn(props, key));
}

function hasImageAuxiliaryStudioCrdtReferenceProps(
  props: Record<string, unknown>
): boolean {
  const keys = Object.keys(props);
  if (
    props.elementType !== "image" ||
    keys.length <= 1 ||
    keys.some((key) => (
      key !== "elementType" &&
      key !== "hidden" &&
      !(STUDIO_FILTER_MASK_REFERENCE_EDIT_KEYS as readonly string[]).includes(key)
    )) ||
    (Object.hasOwn(props, "hidden") && typeof props.hidden !== "boolean")
  ) {
    return false;
  }
  const filterMaskProps = studioFilterMaskReferenceProps(props);
  return Object.keys(filterMaskProps).length === 0 ||
    isStudioFilterMaskReferenceProps(filterMaskProps);
}

function hasTopologyStudioCrdtReferenceProps(
  props: Record<string, unknown>
): boolean {
  return hasLegacyStudioCrdtReferenceProps(props) ||
    hasImageAuxiliaryStudioCrdtReferenceProps(props);
}

function hasValidStudioWorkAssetReferenceProps(
  id: string,
  props: Record<string, unknown>
): boolean {
  if (hasTopologyStudioCrdtReferenceProps(props)) return true;
  const { elementType, ...referenceProps } = props;
  const filterMaskProps = studioFilterMaskReferenceProps(props);
  if (
    hasStudioFilterMaskReferenceState(props) &&
    (
      elementType !== "image" ||
      !isStudioFilterMaskReferenceProps(filterMaskProps)
    )
  ) {
    return false;
  }
  const editProps: Record<string, unknown> = { ...referenceProps };
  for (const key of STUDIO_FILTER_MASK_REFERENCE_EDIT_KEYS) delete editProps[key];
  return typeof elementType === "string" && STUDIO_WORK_ASSET_TYPE_SET.has(elementType) &&
    StudioWorkAssetElementSchema.safeParse({
      id,
      type: elementType,
      ...editProps,
    }).success;
}

function isStudioCrdtSceneType(value: unknown): value is StudioCrdtSceneType {
  return typeof value === "string" && Object.hasOwn(STUDIO_CRDT_SCENE_KEYS_BY_TYPE, value);
}

function readReservedProperties(
  record: Y.Map<unknown>,
  allowedProperties: ReadonlySet<string>,
  metadataKeys: ReadonlySet<string>
): Record<string, unknown> | null {
  const baseline: Record<string, unknown> = {};
  const properties: Record<string, unknown> = {};
  const unset = new Set<string>();
  for (const [key, value] of record) {
    if (metadataKeys.has(key)) continue;
    const prefix = STUDIO_CRDT_PROPERTY_PREFIXES.find((candidate) => key.startsWith(candidate));
    if (!prefix) return null;
    const property = key.slice(prefix.length);
    if (!allowedProperties.has(property)) return null;
    if (prefix === "unset:") {
      if (typeof value !== "boolean") return null;
      if (value) unset.add(property);
      continue;
    }
    if (!isBoundedJsonValue(value)) return null;
    if (prefix === "base:") baseline[property] = value;
    else properties[property] = value;
  }
  const effective = { ...baseline, ...properties };
  for (const property of unset) delete effective[property];
  // The browser validates the effective payload as one JSON tree after resolving base/prop/unset.
  // Re-validating the whole object here is essential: validating each property with a fresh entry
  // counter would allow several individually-small values to exceed the shared 4,096-entry limit
  // and create a durable document that every conforming client refuses to materialize.
  return isBoundedJsonValue(effective) ? effective : null;
}

export interface StudioCrdtWorkAssetReferenceSnapshot {
  identities: ReadonlyMap<string, string>;
  admittedReferences: ReadonlyMap<string, StudioWorkAssetReference>;
  activeCount: number;
}

export interface StudioCrdtR8GrainReferenceSnapshot {
  /** Canonical immutable source keyed by the durable stroke identity that owns it. */
  byStrokeId: ReadonlyMap<string, Readonly<StudioBrushR8TextureGrainSource>>;
  /** One canonical source per durable work-asset identity. */
  byAssetId: ReadonlyMap<string, Readonly<StudioBrushR8TextureGrainSource>>;
  /** True when one asset ID was poisoned with two different canonical content identities. */
  hasConflictingAssetId: boolean;
}

/**
 * Snapshots every canonical renderer-significant R8 source from the durable stroke map.
 *
 * Root-schema validation runs before callers consume this snapshot, but this helper still
 * normalizes independently and ignores malformed candidates so it is safe to use while comparing
 * a pre-update document with a candidate update.
 */
export function snapshotStudioCrdtR8GrainReferences(
  doc: Y.Doc
): StudioCrdtR8GrainReferenceSnapshot {
  const byStrokeId = new Map<string, Readonly<StudioBrushR8TextureGrainSource>>();
  const byAssetId = new Map<string, Readonly<StudioBrushR8TextureGrainSource>>();
  let hasConflictingAssetId = false;
  const strokes = materializeExistingMapRoot(doc, "strokes");
  if (!(strokes instanceof Y.Map)) {
    return { byStrokeId, byAssetId, hasConflictingAssetId };
  }
  for (const [strokeId, value] of strokes) {
    if (!isBoundedStudioCrdtId(strokeId) || !(value instanceof Y.Map)) continue;
    const brushDynamics = value.get("brushDynamics");
    if (!brushDynamics || typeof brushDynamics !== "object" || Array.isArray(brushDynamics)) {
      continue;
    }
    const grain = (brushDynamics as Record<string, unknown>).grain;
    if (!grain || typeof grain !== "object" || Array.isArray(grain)) continue;
    const source = normalizeStudioBrushR8TextureGrainSource(
      (grain as Record<string, unknown>).source
    );
    if (!source) continue;
    byStrokeId.set(strokeId, source);
    const existing = byAssetId.get(source.asset.assetId);
    if (
      existing
      && serializeStudioBrushR8TextureGrainSourceCanonical(existing)
        !== serializeStudioBrushR8TextureGrainSourceCanonical(source)
    ) {
      hasConflictingAssetId = true;
      continue;
    }
    byAssetId.set(source.asset.assetId, source);
  }
  return { byStrokeId, byAssetId, hasConflictingAssetId };
}

/** Returns every materialized identity plus the non-tombstoned count in a valid document. */
export function snapshotStudioWorkAssetReferences(
  doc: Y.Doc
): StudioCrdtWorkAssetReferenceSnapshot {
  const identities = new Map<string, string>();
  const admittedReferences = new Map<string, StudioWorkAssetReference>();
  const index = materializeExistingMapRoot(doc, STUDIO_CRDT_SCENE_INDEX_ROOT);
  if (!(index instanceof Y.Map)) return { identities, admittedReferences, activeCount: 0 };
  let activeCount = 0;
  const metadataKeys = new Set(["id", "pageId", "layerId", "payloadVersion", "type", "deleted"]);
  for (const [id, tracked] of index) {
    if (tracked !== true) continue;
    const record = materializeExistingMapRoot(
      doc,
      `${STUDIO_CRDT_SCENE_ROOT_PREFIX}${encodeURIComponent(id)}`
    );
    if (
      !(record instanceof Y.Map) ||
      record.get("type") !== "reference"
    ) continue;
    const props = readReservedProperties(
      record,
      STUDIO_CRDT_SCENE_KEYS_BY_TYPE.reference,
      metadataKeys
    );
    if (!props) continue;
    const elementType = props.elementType;
    if (!isValidLegacyStudioCrdtReferenceType(elementType)) continue;
    identities.set(id, elementType);
    if (
      hasTopologyStudioCrdtReferenceProps(props) ||
      !STUDIO_WORK_ASSET_TYPE_SET.has(elementType)
    ) continue;
    const reference = {
      assetId: id,
      elementType: elementType as StudioWorkAssetReference["elementType"],
    };
    admittedReferences.set(studioWorkAssetReferenceKey(reference), reference);
    if (record.get("deleted") !== true) activeCount += 1;
  }
  return { identities, admittedReferences, activeCount };
}

function canonicalReservedRootId(rootName: string, prefix: string): string | null {
  if (!rootName.startsWith(prefix)) return null;
  const encodedId = rootName.slice(prefix.length);
  if (encodedId.length === 0) return null;
  try {
    const id = decodeURIComponent(encodedId);
    return isBoundedStudioCrdtId(id) && encodeURIComponent(id) === encodedId ? id : null;
  } catch {
    return null;
  }
}

interface StudioCrdtLayerGroupIdentity {
  key: string;
  pageId: string;
  groupId: string;
}

function parseStudioCrdtLayerGroupKey(key: string): StudioCrdtLayerGroupIdentity | null {
  if (key.length < 5 || key.length > 328) return null;
  const readPart = (offset: number): { value: string; nextOffset: number } | null => {
    const separator = key.indexOf(":", offset);
    if (separator < 0) return null;
    const lengthToken = key.slice(offset, separator);
    if (!/^(?:0|[1-9][0-9]*)$/u.test(lengthToken)) return null;
    const length = Number(lengthToken);
    if (!Number.isSafeInteger(length) || length <= 0 || length > 160) return null;
    const start = separator + 1;
    const end = start + length;
    if (end > key.length) return null;
    return { value: key.slice(start, end), nextOffset: end };
  };
  const page = readPart(0);
  if (!page) return null;
  const group = readPart(page.nextOffset);
  if (
    !group ||
    group.nextOffset !== key.length ||
    !isBoundedStudioCrdtId(page.value) ||
    !isBoundedStudioCrdtId(group.value) ||
    group.value === "page-root"
  ) {
    return null;
  }
  const canonical = `${page.value.length}:${page.value}${group.value.length}:${group.value}`;
  return canonical === key
    ? { key, pageId: page.value, groupId: group.value }
    : null;
}

function canonicalReservedLayerGroupKey(rootName: string): StudioCrdtLayerGroupIdentity | null {
  if (!rootName.startsWith(STUDIO_CRDT_LAYER_GROUP_ROOT_PREFIX)) return null;
  const encodedKey = rootName.slice(STUDIO_CRDT_LAYER_GROUP_ROOT_PREFIX.length);
  if (!encodedKey) return null;
  try {
    const key = decodeURIComponent(encodedKey);
    if (encodeURIComponent(key) !== encodedKey) return null;
    return parseStudioCrdtLayerGroupKey(key);
  } catch {
    return null;
  }
}

function encodeStudioCrdtDeletionTarget(target: StudioCrdtDeletionTarget): string {
  return target.kind === "group"
    ? JSON.stringify([target.kind, target.pageId, target.id])
    : JSON.stringify([target.kind, target.id]);
}

function parseStudioCrdtDeletionTarget(value: unknown): StudioCrdtDeletionTarget | null {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > STUDIO_CRDT_DELETION_TARGET_MAX_LENGTH
  ) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return null;
    if (
      parsed.length === 2 &&
      (parsed[0] === "stroke" || parsed[0] === "scene" || parsed[0] === "page") &&
      isBoundedStudioCrdtId(parsed[1])
    ) {
      const target = { kind: parsed[0], id: parsed[1] } satisfies StudioCrdtDeletionTarget;
      return encodeStudioCrdtDeletionTarget(target) === value ? target : null;
    }
    if (
      parsed.length === 3 &&
      parsed[0] === "group" &&
      isBoundedStudioCrdtId(parsed[1]) &&
      isBoundedStudioCrdtId(parsed[2]) &&
      parsed[2] !== "page-root"
    ) {
      const target = {
        kind: "group",
        pageId: parsed[1],
        id: parsed[2],
      } satisfies StudioCrdtDeletionTarget;
      return encodeStudioCrdtDeletionTarget(target) === value ? target : null;
    }
  } catch {
    return null;
  }
  return null;
}

function studioCrdtDeletionTargetExists(doc: Y.Doc, target: StudioCrdtDeletionTarget): boolean {
  if (target.kind === "stroke") {
    const strokes = materializeExistingMapRoot(doc, "strokes");
    return strokes instanceof Y.Map && strokes.get(target.id) instanceof Y.Map;
  }
  if (target.kind === "scene") {
    const index = materializeExistingMapRoot(doc, STUDIO_CRDT_SCENE_INDEX_ROOT);
    const record = materializeExistingMapRoot(
      doc,
      `${STUDIO_CRDT_SCENE_ROOT_PREFIX}${encodeURIComponent(target.id)}`
    );
    return index instanceof Y.Map && index.get(target.id) === true && record instanceof Y.Map;
  }
  if (target.kind === "page") {
    const index = materializeExistingMapRoot(doc, STUDIO_CRDT_PAGE_INDEX_ROOT);
    const record = materializeExistingMapRoot(
      doc,
      `${STUDIO_CRDT_PAGE_ROOT_PREFIX}${encodeURIComponent(target.id)}`
    );
    return index instanceof Y.Map && index.get(target.id) === true && record instanceof Y.Map;
  }
  const key = `${target.pageId.length}:${target.pageId}${target.id.length}:${target.id}`;
  const index = materializeExistingMapRoot(doc, STUDIO_CRDT_LAYER_GROUP_INDEX_ROOT);
  const record = materializeExistingMapRoot(
    doc,
    `${STUDIO_CRDT_LAYER_GROUP_ROOT_PREFIX}${encodeURIComponent(key)}`
  );
  return index instanceof Y.Map && index.get(key) === true && record instanceof Y.Map;
}

function validateStudioCrdtDeletionRoots(doc: Y.Doc): boolean {
  const operations = materializeExistingMapRoot(doc, STUDIO_CRDT_DELETION_OPS_ROOT);
  const acknowledgements = materializeExistingMapRoot(doc, STUDIO_CRDT_DELETION_ACKS_ROOT);
  if (
    operations === null ||
    acknowledgements === null ||
    (operations?.size ?? 0) > STUDIO_CRDT_COLLECTION_MAX_ENTRIES ||
    (acknowledgements?.size ?? 0) > STUDIO_CRDT_COLLECTION_MAX_ENTRIES
  ) return false;
  if (operations) {
    for (const [operationId, encodedTarget] of operations) {
      const target = parseStudioCrdtDeletionTarget(encodedTarget);
      if (!STUDIO_CRDT_UUID_PATTERN.test(operationId) || !target || !studioCrdtDeletionTargetExists(doc, target)) {
        return false;
      }
    }
  }
  if (acknowledgements) {
    for (const [operationId, encodedTarget] of acknowledgements) {
      if (
        !STUDIO_CRDT_UUID_PATTERN.test(operationId) ||
        !parseStudioCrdtDeletionTarget(encodedTarget) ||
        !operations ||
        operations.get(operationId) !== encodedTarget
      ) return false;
    }
  }
  return true;
}

export interface StudioCrdtDeletionRootSnapshot {
  operations: ReadonlyMap<string, unknown>;
  acknowledgements: ReadonlyMap<string, unknown>;
}

export function snapshotStudioCrdtDeletionRoots(doc: Y.Doc): StudioCrdtDeletionRootSnapshot | null {
  const operations = materializeExistingMapRoot(doc, STUDIO_CRDT_DELETION_OPS_ROOT);
  const acknowledgements = materializeExistingMapRoot(doc, STUDIO_CRDT_DELETION_ACKS_ROOT);
  if (operations === null || acknowledgements === null) return null;
  return {
    operations: new Map(operations ?? []),
    acknowledgements: new Map(acknowledgements ?? []),
  };
}

export function preservesStudioCrdtDeletionRoots(
  snapshot: StudioCrdtDeletionRootSnapshot | null,
  doc: Y.Doc
): boolean {
  if (!snapshot) return false;
  const operations = materializeExistingMapRoot(doc, STUDIO_CRDT_DELETION_OPS_ROOT);
  const acknowledgements = materializeExistingMapRoot(doc, STUDIO_CRDT_DELETION_ACKS_ROOT);
  if (operations === null || acknowledgements === null) return false;
  for (const [operationId, target] of snapshot.operations) {
    if (!operations || operations.get(operationId) !== target) return false;
  }
  for (const [operationId, target] of snapshot.acknowledgements) {
    if (!acknowledgements || acknowledgements.get(operationId) !== target) return false;
  }
  return true;
}

function validateSceneElementRoot(id: string, record: Y.Map<unknown>): boolean {
  const metadataKeys = new Set(["id", "pageId", "layerId", "payloadVersion", "type", "deleted"]);
  const type = record.get("type");
  if (
    record.get("id") !== id ||
    !isBoundedStudioCrdtId(record.get("pageId")) ||
    !isBoundedStudioCrdtId(record.get("layerId")) ||
    record.get("payloadVersion") !== 1 ||
    !isStudioCrdtSceneType(type) ||
    (record.has("deleted") && typeof record.get("deleted") !== "boolean")
  ) {
    return false;
  }
  const props = readReservedProperties(record, STUDIO_CRDT_SCENE_KEYS_BY_TYPE[type], metadataKeys);
  if (!props) return false;
  for (const key of STUDIO_CRDT_REQUIRED_SCENE_KEYS[type]) {
    if (!(key in props)) return false;
  }
  if (
    type === "reference" &&
    !hasValidStudioWorkAssetReferenceProps(id, props)
  ) return false;
  if (type === "reference") {
    // Validate losing baseline/override candidates too. Otherwise a valid effective `prop:` value
    // could hide an invalid `base:` candidate which becomes active after a later unset operation.
    for (const [key, value] of record) {
      const prefix = key.startsWith("base:")
        ? "base:"
        : key.startsWith("prop:")
          ? "prop:"
          : null;
      if (!prefix) continue;
      const property = key.slice(prefix.length);
      if (!isValidStudioWorkAssetReferenceCandidate(property, value)) return false;
    }
  }
  for (const key of ["x", "y"]) {
    if (key in props && !finiteNumberInRange(props[key], -STUDIO_CRDT_MAX_COORDINATE, STUDIO_CRDT_MAX_COORDINATE)) {
      return false;
    }
  }
  for (const key of ["width", "height", "fontSize", "strokeWidth"]) {
    if (key in props && !finiteNumberInRange(props[key], 0, STUDIO_CRDT_MAX_COORDINATE)) return false;
  }
  for (const key of [
    "letterSpacing",
    "lineHeight",
    "shadowBlur",
    "shadowOffsetX",
    "shadowOffsetY",
    "shadowOpacity",
    "skewX",
    "skewY",
    "tailXRatio",
    "tailHeight",
    "tailBase",
    "tailBend",
    "autoShrinkMinFontSize",
    "starAmplitude",
    "lineCount",
    "innerRadius",
    "outerRadius",
    "noise",
    "centerXRatio",
    "centerYRatio",
  ]) {
    if (
      key in props &&
      !finiteNumberInRange(
        props[key],
        -STUDIO_CRDT_MAX_COORDINATE,
        STUDIO_CRDT_MAX_COORDINATE
      )
    ) return false;
  }
  if ("rotation" in props && !finiteNumberInRange(props.rotation, -1_000_000, 1_000_000)) return false;
  if ("opacity" in props && !finiteNumberInRange(props.opacity, 0, 1)) return false;
  for (const key of [
    "hidden",
    "locked",
    "noClip",
    "lockAspect",
    "clipBelow",
    "alphaLocked",
    "maskEnabled",
    "vertical",
    "autoShrinkText",
  ]) {
    if (key in props && typeof props[key] !== "boolean") return false;
  }
  if ("text" in props && !boundedString(props.text, STUDIO_CRDT_JSON_MAX_STRING_LENGTH)) return false;
  if ("stickyNotePresetId" in props && !boundedExactText(props.stickyNotePresetId, 160)) {
    return false;
  }
  for (const key of [
    "fill", "textFill", "stroke", "variant", "direction", "stickyNoteFill",
  ]) {
    if (key in props && !boundedString(props[key], 512)) return false;
  }
  const enumValues: Readonly<Record<string, readonly string[]>> = {
    align: ["left", "center", "right"],
    fontStyle: ["normal", "bold", "italic", "bold italic"],
    fillType: ["solid", "gradient"],
    gradientDirection: ["vertical", "horizontal"],
    tail: ["left", "right", "none"],
    tailDirection: ["bottom", "top", "left", "right"],
    dashStyle: ["solid", "dashed"],
    direction: ["horizontal", "vertical"],
  };
  for (const [key, values] of Object.entries(enumValues)) {
    if (key in props && !values.includes(props[key] as string)) return false;
  }
  if (
    "lineCount" in props &&
    (!Number.isInteger(props.lineCount) || (props.lineCount as number) < 1)
  ) return false;
  for (const key of ["points", "customShapePoints"] as const) {
    if (!(key in props)) continue;
    const values = props[key];
    if (
      !Array.isArray(values) ||
      values.length % 2 !== 0 ||
      (key === "points" ? values.length !== 8 : values.length < 6) ||
      values.some(
        (value) =>
          typeof value !== "number" ||
          !Number.isFinite(value) ||
          Math.abs(value) > STUDIO_CRDT_MAX_COORDINATE
      )
    ) return false;
  }
  const byteLength = encodedJsonByteLength({ version: 1, type, props });
  return byteLength !== null && byteLength <= STUDIO_CRDT_SCENE_PAYLOAD_MAX_BYTES;
}

function validatePageRoot(id: string, record: Y.Map<unknown>): boolean {
  const metadataKeys = new Set(["id", "payloadVersion", "deleted"]);
  if (
    record.get("id") !== id ||
    record.get("payloadVersion") !== 1 ||
    (record.has("deleted") && typeof record.get("deleted") !== "boolean")
  ) {
    return false;
  }
  const props = readReservedProperties(record, STUDIO_CRDT_PAGE_KEYS, metadataKeys);
  if (!props || !boundedString(props.bg, 512)) return false;
  if (!finiteNumberInRange(props.canvasH, 1, STUDIO_CRDT_MAX_COORDINATE)) return false;
  if (
    props.bgGrad !== null &&
    (!Array.isArray(props.bgGrad) ||
      props.bgGrad.length > 32 ||
      props.bgGrad.some((color) => !boundedString(color, 512)))
  ) {
    return false;
  }
  for (const key of ["name", "note", "shotType", "cameraAngle"]) {
    if (key in props && !boundedString(props[key], key === "note" ? 8_192 : 512)) return false;
  }
  if ("hideMaster" in props && typeof props.hideMaster !== "boolean") return false;
  if ("paperGrainVisible" in props && typeof props.paperGrainVisible !== "boolean") return false;
  if ("paperSurface" in props && !isValidStudioCrdtPaperSurface(props.paperSurface)) return false;
  if ("drawingAssist" in props && !isValidStudioCrdtDrawingAssist(props.drawingAssist)) {
    return false;
  }
  // A valid `prop:` winner can hide an invalid `base:` candidate until a later unset. Validate
  // both candidates now so every future effective page payload remains safe to materialize.
  for (const [key, value] of record) {
    if (
      (key === "base:drawingAssist" || key === "prop:drawingAssist") &&
      !isValidStudioCrdtDrawingAssist(value)
    ) {
      return false;
    }
    if (
      (key === "base:paperSurface" || key === "prop:paperSurface") &&
      !isValidStudioCrdtPaperSurface(value)
    ) {
      return false;
    }
    if (
      (key === "base:paperGrainVisible" || key === "prop:paperGrainVisible") &&
      typeof value !== "boolean"
    ) {
      return false;
    }
  }
  const byteLength = encodedJsonByteLength({ version: 1, props });
  return byteLength !== null && byteLength <= STUDIO_CRDT_PAGE_PAYLOAD_MAX_BYTES;
}

function validateLayerGroupRoot(
  identity: StudioCrdtLayerGroupIdentity,
  record: Y.Map<unknown>
): boolean {
  const metadataKeys = new Set(["id", "pageId", "payloadVersion", "deleted"]);
  if (
    record.get("id") !== identity.groupId ||
    record.get("pageId") !== identity.pageId ||
    record.get("payloadVersion") !== 1 ||
    (record.has("deleted") && typeof record.get("deleted") !== "boolean") ||
    record.get("unset:name") === true
  ) {
    return false;
  }
  for (const [key, value] of record) {
    if (metadataKeys.has(key) || key.startsWith("unset:")) continue;
    const separator = key.indexOf(":");
    const property = separator >= 0 ? key.slice(separator + 1) : "";
    if (property === "name") {
      if (!boundedExactText(value, 512)) return false;
    } else if ((property === "hidden" || property === "locked") && typeof value !== "boolean") {
      return false;
    }
  }
  const props = readReservedProperties(record, STUDIO_CRDT_LAYER_GROUP_KEYS, metadataKeys);
  if (!props || !boundedExactText(props.name, 512)) return false;
  for (const key of ["hidden", "locked"] as const) {
    if (key in props && typeof props[key] !== "boolean") return false;
  }
  const byteLength = encodedJsonByteLength({ version: 1, props });
  return byteLength !== null && byteLength <= STUDIO_CRDT_LAYER_GROUP_PAYLOAD_MAX_BYTES;
}

function validateTrackedLayerGroupRoots(doc: Y.Doc): boolean {
  const root = materializeExistingMapRoot(doc, STUDIO_CRDT_LAYER_GROUP_INDEX_ROOT);
  const trackedKeys = new Set<string>();
  if (root !== undefined) {
    if (root === null || root.size > STUDIO_CRDT_LAYER_GROUP_MAX_ENTRIES) return false;
    for (const [key, active] of root) {
      const identity = parseStudioCrdtLayerGroupKey(key);
      if (!identity || active !== true) return false;
      const record = materializeExistingMapRoot(
        doc,
        `${STUDIO_CRDT_LAYER_GROUP_ROOT_PREFIX}${encodeURIComponent(key)}`
      );
      if (!record || !validateLayerGroupRoot(identity, record)) return false;
      trackedKeys.add(key);
    }
  }
  let dynamicRootCount = 0;
  for (const [rootName, value] of doc.share) {
    if (!rootName.startsWith(STUDIO_CRDT_LAYER_GROUP_ROOT_PREFIX)) continue;
    dynamicRootCount += 1;
    if (dynamicRootCount > STUDIO_CRDT_LAYER_GROUP_MAX_ENTRIES) return false;
    const identity = canonicalReservedLayerGroupKey(rootName);
    if (
      !identity ||
      !trackedKeys.has(identity.key) ||
      !(value instanceof Y.Map) ||
      !validateLayerGroupRoot(identity, value)
    ) {
      return false;
    }
  }
  return true;
}

function hasValidStudioFilterMaskSurfaceReferences(
  doc: Y.Doc,
  surfaces: ReadonlyMap<string, unknown>
): boolean {
  const index = materializeExistingMapRoot(doc, STUDIO_CRDT_SCENE_INDEX_ROOT);
  if (index === undefined) return true;
  if (!(index instanceof Y.Map)) return false;
  const metadataKeys = new Set(["id", "pageId", "layerId", "payloadVersion", "type", "deleted"]);
  for (const [id, tracked] of index) {
    if (tracked !== true || !isBoundedStudioCrdtId(id)) return false;
    const record = materializeExistingMapRoot(
      doc,
      `${STUDIO_CRDT_SCENE_ROOT_PREFIX}${encodeURIComponent(id)}`
    );
    if (!(record instanceof Y.Map) || record.get("type") !== "reference") continue;
    const props = readReservedProperties(
      record,
      STUDIO_CRDT_SCENE_KEYS_BY_TYPE.reference,
      metadataKeys
    );
    if (!props) return false;
    const candidates = new Set<unknown>();
    if (Object.hasOwn(props, "filterMaskSurfaceId")) {
      candidates.add(props.filterMaskSurfaceId);
    }
    for (const [key, value] of record) {
      if (
        key === "base:filterMaskSurfaceId" ||
        key === "prop:filterMaskSurfaceId"
      ) {
        candidates.add(value);
      }
    }
    for (const candidate of candidates) {
      if (!isStudioFilterMaskSurfaceId(candidate)) return false;
      const surface = surfaces.get(candidate);
      if (!isStudioFilterMaskSurfaceSpec(surface)) return false;
    }
  }
  return true;
}

export interface StudioCrdtStrokePaintContractInput {
  payloadVersion: unknown;
  paintModel: unknown;
  kind?: unknown;
  mode?: unknown;
  brush?: unknown;
  sampleSpacing?: unknown;
  pressureModel?: unknown;
  fill?: unknown;
  brushDynamics?: unknown;
  stampPipeline?: unknown;
  watercolorPipeline?: unknown;
  symmetry?: unknown;
}

function hasCausalStrokePaintGeometry(
  input: StudioCrdtStrokePaintContractInput
): boolean {
  return (
    typeof input.sampleSpacing === "number"
    && Number.isFinite(input.sampleSpacing)
    && input.sampleSpacing >= 0
  ) || (
    typeof input.pressureModel === "string"
    && STUDIO_CRDT_CAUSAL_PRESSURE_MODELS.has(input.pressureModel)
  );
}

function hasNonIdentityStrokeSymmetry(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value !== "object" || Array.isArray(value)) return true;
  const type = (value as Record<string, unknown>).type;
  return type !== undefined && type !== "none";
}

function isBoundedFlowStrokeSymmetryCompatible(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value !== "object" || Array.isArray(value)) return false;
  const source = value as Record<string, unknown>;
  if (source.type === undefined || source.type === "none") return true;
  if (
    source.type !== "vertical"
    && source.type !== "horizontal"
    && source.type !== "radial"
    && source.type !== "kaleidoscope"
  ) return false;
  if (
    typeof source.centerX !== "number"
    || !Number.isFinite(source.centerX)
    || typeof source.centerY !== "number"
    || !Number.isFinite(source.centerY)
  ) return false;
  if (source.type === "vertical" || source.type === "horizontal") return true;
  return typeof source.radialCount === "number"
    && Number.isInteger(source.radialCount)
    && source.radialCount >= 1
    && source.radialCount <= 32;
}

function isLayeredFlowStrokeBrushCompatible(brush: unknown): boolean {
  if (typeof brush !== "string" || brush.length === 0) return true;
  if (STUDIO_CRDT_LAYERED_FLOW_COMPATIBLE_BRUSH_IDS.has(brush)) return true;
  if (STUDIO_CRDT_KNOWN_INCOMPATIBLE_LAYERED_FLOW_BRUSH_IDS.has(brush)) return false;
  // Engine-lane ids (`{base}--{lane}`) mirror browser render-family admission:
  // only causal pen lanes stay on layered-flow-v1; oil/wet/perfect/stamp lanes fail closed.
  if (brush.includes("--")) {
    return brush === "gpen--causal-round";
  }
  return true;
}

function rendererSignificantR8GrainAdmission(
  brushDynamics: unknown,
): "absent" | "valid" | "invalid" {
  if (!brushDynamics || typeof brushDynamics !== "object" || Array.isArray(brushDynamics)) {
    return "absent";
  }
  const grain = (brushDynamics as Record<string, unknown>).grain;
  if (!grain || typeof grain !== "object" || Array.isArray(grain)) return "absent";
  if (!Object.prototype.hasOwnProperty.call(grain, "source")) return "absent";
  const source = (grain as Record<string, unknown>).source;
  if (source == null) return "absent";
  const canonical = serializeStudioBrushR8TextureGrainSourceCanonical(source);
  return canonical !== null && canonical === JSON.stringify(source)
    ? "valid"
    : "invalid";
}

/**
 * Server mirror of the browser's pure stroke-paint admission contract. Runtime imports stay
 * one-way at the API boundary; the service test pins this mirror against the browser oracle.
 */
export function hasValidStudioCrdtStrokePaintContract(
  input: StudioCrdtStrokePaintContractInput
): boolean {
  if (
    input.payloadVersion !== STUDIO_CRDT_LAYERED_FLOW_STROKE_PAYLOAD_VERSION
    && input.payloadVersion !== STUDIO_CRDT_MATERIAL_STROKE_PAYLOAD_VERSION
    && input.payloadVersion !== STUDIO_CRDT_STROKE_PAYLOAD_VERSION
  ) return false;
  const brushDynamics = input.brushDynamics !== null
    && typeof input.brushDynamics === "object"
    && !Array.isArray(input.brushDynamics)
    ? input.brushDynamics as Record<string, unknown>
    : undefined;
  const r8GrainAdmission = rendererSignificantR8GrainAdmission(input.brushDynamics);
  if (
    r8GrainAdmission === "invalid"
    || (
      r8GrainAdmission === "valid"
      && input.payloadVersion !== STUDIO_CRDT_STROKE_PAYLOAD_VERSION
    )
  ) return false;
  if (
    brushDynamics?.depositPipeline === STUDIO_CRDT_SEGMENTED_CAUSAL_DEPOSIT_PIPELINE
    && input.payloadVersion !== STUDIO_CRDT_STROKE_PAYLOAD_VERSION
  ) return false;
  if ((input.kind ?? "freehand") !== "freehand" || (input.mode ?? "pen") !== "pen") {
    return false;
  }
  if (input.fill !== undefined && input.fill !== null) return false;
  if (input.stampPipeline !== undefined && input.stampPipeline !== null) return false;
  if (input.watercolorPipeline !== undefined && input.watercolorPipeline !== null) return false;
  if (!hasCausalStrokePaintGeometry(input)) return false;

  if (input.paintModel === STUDIO_CRDT_LAYERED_FLOW_PAINT_MODEL) {
    return (
      (input.brushDynamics === undefined || input.brushDynamics === null)
      && !hasNonIdentityStrokeSymmetry(input.symmetry)
      && isLayeredFlowStrokeBrushCompatible(input.brush)
    );
  }
  if (input.paintModel === STUDIO_CRDT_BOUNDED_FLOW_PAINT_MODEL) {
    return (
      typeof input.brushDynamics === "object"
      && input.brushDynamics !== null
      && typeof input.brush === "string"
      && STUDIO_CRDT_BOUNDED_FLOW_DYNAMIC_BRUSH_IDS.has(input.brush)
      && isBoundedFlowStrokeSymmetryCompatible(input.symmetry)
    );
  }
  return false;
}

function validateStrokeRoot(id: string, record: Y.Map<unknown>): boolean {
  const strokeWidth = record.get("strokeWidth");
  const payloadVersion = record.get("payloadVersion");
  if (
    !hasOnlyKeys(record, STUDIO_CRDT_STROKE_RECORD_KEYS) ||
    record.get("id") !== id ||
    !isBoundedStudioCrdtId(record.get("pageId")) ||
    !isBoundedStudioCrdtId(record.get("layerId")) ||
    (record.get("status") !== "drawing" && record.get("status") !== "finalized") ||
    (record.has("deleted") && typeof record.get("deleted") !== "boolean") ||
    (payloadVersion !== STUDIO_CRDT_LEGACY_STROKE_PAYLOAD_VERSION &&
      payloadVersion !== STUDIO_CRDT_LAYERED_FLOW_STROKE_PAYLOAD_VERSION &&
      payloadVersion !== STUDIO_CRDT_MATERIAL_STROKE_PAYLOAD_VERSION &&
      payloadVersion !== STUDIO_CRDT_STROKE_PAYLOAD_VERSION) ||
    record.get("type") !== "draw" ||
    (record.get("mode") !== "pen" && record.get("mode") !== "eraser") ||
    !boundedExactText(record.get("kind"), 80) ||
    !boundedExactText(record.get("stroke"), 256) ||
    !finiteNumberInRange(strokeWidth, 0.01, STUDIO_CRDT_STROKE_WIDTH_MAX)
  ) {
    return false;
  }
  const opacity = record.get("opacity");
  if (record.has("opacity") && !finiteNumberInRange(opacity, 0, 1)) return false;
  const sampleSpacing = record.get("sampleSpacing");
  if (
    record.has("sampleSpacing") &&
    !finiteNumberInRange(sampleSpacing, 0, STUDIO_CRDT_STROKE_WIDTH_MAX)
  ) return false;
  for (const key of STUDIO_CRDT_STROKE_OPTIONAL_STRING_KEYS) {
    const value = record.get(key);
    if (
      record.has(key)
      && (
        !boundedExactText(value, STUDIO_CRDT_STROKE_OPTIONAL_STRING_LIMITS[key])
        || ((key === "brushCatalogId" || key === "brushCatalogName") && value.trim() !== value)
      )
    ) return false;
  }
  for (const key of STUDIO_CRDT_STROKE_JSON_KEYS) {
    const value = record.get(key);
    if (
      record.has(key) &&
      (value === null || typeof value !== "object" || Array.isArray(value) ||
        !isBoundedJsonValue(value))
    ) return false;
  }
  const extensionsValue = record.get("extensions");
  const extensions = extensionsValue !== null && typeof extensionsValue === "object"
    && !Array.isArray(extensionsValue)
    ? extensionsValue as Record<string, unknown>
    : undefined;
  const brushDynamicsValue = record.get("brushDynamics");
  const brushDynamics = brushDynamicsValue !== null
    && typeof brushDynamicsValue === "object"
    && !Array.isArray(brushDynamicsValue)
    ? brushDynamicsValue as Record<string, unknown>
    : undefined;
  const hasMaterialPressureModel = extensions !== undefined
    && Object.prototype.hasOwnProperty.call(extensions, "materialPressureModel");
  const hasMaterialMinimumDiameterRatio = extensions !== undefined
    && Object.prototype.hasOwnProperty.call(extensions, "materialMinimumDiameterRatio");
  const hasDynamicMinimumDiameterRatio = brushDynamics !== undefined
    && Object.prototype.hasOwnProperty.call(brushDynamics, "minimumDiameterRatio");
  const hasSegmentedCausalDeposit =
    brushDynamics?.depositPipeline === STUDIO_CRDT_SEGMENTED_CAUSAL_DEPOSIT_PIPELINE;
  const r8GrainAdmission = rendererSignificantR8GrainAdmission(brushDynamicsValue);
  if (
    payloadVersion !== STUDIO_CRDT_MATERIAL_STROKE_PAYLOAD_VERSION
    && payloadVersion !== STUDIO_CRDT_STROKE_PAYLOAD_VERSION
    && (
      hasMaterialPressureModel
      || hasMaterialMinimumDiameterRatio
      || hasDynamicMinimumDiameterRatio
    )
  ) return false;
  if (
    (
      payloadVersion === STUDIO_CRDT_MATERIAL_STROKE_PAYLOAD_VERSION
      || payloadVersion === STUDIO_CRDT_STROKE_PAYLOAD_VERSION
    )
    && (
      hasMaterialPressureModel !== hasMaterialMinimumDiameterRatio
      || (hasMaterialPressureModel
        && extensions?.materialPressureModel !== STUDIO_CRDT_MATERIAL_PRESSURE_MODEL)
      || (hasMaterialMinimumDiameterRatio
        && !finiteNumberInRange(extensions?.materialMinimumDiameterRatio, 0, 1))
      || (hasDynamicMinimumDiameterRatio
        && !finiteNumberInRange(brushDynamics?.minimumDiameterRatio, 0, 1))
    )
  ) return false;
  if (
    hasSegmentedCausalDeposit
    && payloadVersion !== STUDIO_CRDT_STROKE_PAYLOAD_VERSION
  ) return false;
  if (
    r8GrainAdmission === "invalid"
    || (
      r8GrainAdmission === "valid"
      && payloadVersion !== STUDIO_CRDT_STROKE_PAYLOAD_VERSION
    )
  ) return false;
  const paintModel = extensions?.paintModel;
  if (
    paintModel !== undefined
    && !hasValidStudioCrdtStrokePaintContract({
      payloadVersion,
      paintModel,
      kind: record.get("kind"),
      mode: record.get("mode"),
      brush: record.get("brush"),
      sampleSpacing: record.get("sampleSpacing"),
      pressureModel: extensions?.pressureModel,
      fill: record.get("fill"),
      brushDynamics: brushDynamicsValue,
      stampPipeline: extensions?.stampPipeline,
      watercolorPipeline: extensions?.watercolorPipeline,
      symmetry: record.get("symmetry"),
    })
  ) return false;
  const inkInput = extensions?.inkInput;
  const normalizedInkInput = inkInput === undefined
    ? null
    : normalizeStudioInkInputContract(inkInput);
  if (
    inkInput !== undefined
    && normalizedInkInput === null
  ) return false;
  const requiresExtendedInkChannels =
    isStudioInkInputContractV2(normalizedInkInput);
  const metadata: Record<string, unknown> = {
    version: payloadVersion,
    type: "draw",
    kind: record.get("kind"),
    mode: record.get("mode"),
    stroke: record.get("stroke"),
    strokeWidth,
  };
  for (const key of [
    "opacity",
    "sampleSpacing",
    ...STUDIO_CRDT_STROKE_OPTIONAL_STRING_KEYS,
    ...STUDIO_CRDT_STROKE_JSON_KEYS,
  ]) {
    if (record.has(key)) metadata[key] = record.get(key);
  }
  const metadataBytes = encodedJsonByteLength(metadata);
  if (metadataBytes === null || metadataBytes > STUDIO_CRDT_STROKE_METADATA_MAX_BYTES) return false;

  const arrays = Object.fromEntries(
    STUDIO_CRDT_STROKE_SAMPLE_KEYS.map((key) => [key, record.get(key)])
  ) as Record<(typeof STUDIO_CRDT_STROKE_SAMPLE_KEYS)[number], unknown>;
  if (
    STUDIO_CRDT_STROKE_BASE_SAMPLE_KEYS.some(
      (key) => !(arrays[key] instanceof Y.Array),
    )
    || (
      requiresExtendedInkChannels
      && STUDIO_CRDT_STROKE_EXTENDED_INK_SAMPLE_KEYS.some(
        (key) => !(arrays[key] instanceof Y.Array),
      )
    )
    || STUDIO_CRDT_STROKE_EXTENDED_INK_SAMPLE_KEYS.some(
      (key) => arrays[key] !== undefined && !(arrays[key] instanceof Y.Array),
    )
  ) {
    return false;
  }
  const points = arrays.points as Y.Array<unknown>;
  if (
    points.length % 2 !== 0 ||
    points.length / 2 > STUDIO_CRDT_STROKE_SAMPLE_MAX_COUNT
  ) return false;
  const sampleCount = points.length / 2;
  if (
    STUDIO_CRDT_STROKE_BASE_SAMPLE_KEYS.slice(1).some(
      (key) => (arrays[key] as Y.Array<unknown>).length !== sampleCount
    )
    || STUDIO_CRDT_STROKE_EXTENDED_INK_SAMPLE_KEYS.some(
      (key) => (
        arrays[key] instanceof Y.Array
        && arrays[key].length !== sampleCount
      ),
    )
  ) return false;
  const ranges: Record<(typeof STUDIO_CRDT_STROKE_SAMPLE_KEYS)[number], readonly [number, number]> = {
    points: [-STUDIO_CRDT_MAX_COORDINATE, STUDIO_CRDT_MAX_COORDINATE],
    pressures: [0, 1],
    tiltXs: [-90, 90],
    tiltYs: [-90, 90],
    twists: [0, 359],
    speeds: [0, 1_000_000],
    tangentialPressures: [-1, 1],
    altitudeAngles: [0, Math.PI / 2],
    azimuthAngles: [0, Math.PI * 2],
    contactWidths: [0, STUDIO_INK_INPUT_V2_MAX_CONTACT_DIMENSION],
    contactHeights: [0, STUDIO_INK_INPUT_V2_MAX_CONTACT_DIMENSION],
    sampleTimeOffsets: [0, STUDIO_INK_INPUT_V2_MAX_TIME_OFFSET_MS],
  };
  for (const key of STUDIO_CRDT_STROKE_SAMPLE_KEYS) {
    if (!(arrays[key] instanceof Y.Array)) continue;
    const [minimum, maximum] = ranges[key];
    const values = arrays[key].toArray();
    if (
      values.some(
        (value) => (
          !finiteNumberInRange(value, minimum, maximum)
          || (key === "azimuthAngles" && value === maximum)
        )
      )
    ) return false;
  }
  const sampleTimeOffsets = arrays.sampleTimeOffsets;
  if (sampleTimeOffsets instanceof Y.Array) {
    const values = sampleTimeOffsets.toArray();
    if (requiresExtendedInkChannels && sampleCount > 0 && values[0] !== 0) {
      return false;
    }
    for (let index = 1; index < values.length; index += 1) {
      if ((values[index] as number) < (values[index - 1] as number)) return false;
    }
  }
  return true;
}

function validateTrackedDynamicRoots(
  doc: Y.Doc,
  indexRootName: string,
  dynamicPrefix: string,
  validateRecord: (id: string, record: Y.Map<unknown>) => boolean,
  maximumEntries = STUDIO_CRDT_COLLECTION_MAX_ENTRIES
): boolean {
  const root = materializeExistingMapRoot(doc, indexRootName);
  const trackedIds = new Set<string>();
  if (root !== undefined) {
    if (root === null || root.size > maximumEntries) return false;
    for (const [id, active] of root) {
      if (!isBoundedStudioCrdtId(id) || active !== true) return false;
      const record = materializeExistingMapRoot(doc, `${dynamicPrefix}${encodeURIComponent(id)}`);
      if (!record || !validateRecord(id, record)) return false;
      trackedIds.add(id);
    }
  }
  let dynamicRootCount = 0;
  for (const [rootName, value] of doc.share) {
    if (!rootName.startsWith(dynamicPrefix)) continue;
    dynamicRootCount += 1;
    if (dynamicRootCount > maximumEntries) return false;
    const id = canonicalReservedRootId(rootName, dynamicPrefix);
    if (!id || !trackedIds.has(id) || !(value instanceof Y.Map) || !validateRecord(id, value)) {
      return false;
    }
  }
  return true;
}

/** Rejects valid Yjs syntax that would poison the Studio document's runtime collection contract. */
export function hasValidStudioCrdtRootSchema(doc: Y.Doc): boolean {
  const strokesRoot = materializeExistingMapRoot(doc, "strokes");
  if (strokesRoot !== undefined) {
    if (strokesRoot === null) return false;
    for (const [id, value] of strokesRoot) {
      if (
        !isBoundedStudioCrdtId(id) ||
        !(value instanceof Y.Map) ||
        !validateStrokeRoot(id, value)
      ) return false;
    }
  }

  const orderRoot = materializeExistingArrayRoot(doc, "stroke-order");
  if (orderRoot !== undefined) {
    if (orderRoot === null || orderRoot.length > STUDIO_CRDT_COLLECTION_MAX_ENTRIES) {
      return false;
    }
    const activeCounts = new Map<string, number>();
    const matchingActiveCoordinates = new Set<string>();
    const sceneIndexRoot = materializeExistingMapRoot(doc, STUDIO_CRDT_SCENE_INDEX_ROOT);
    for (const value of orderRoot) {
      if (!(value instanceof Y.Map)) return false;
      const strokeId = value.get("strokeId");
      const elementId = value.get("elementId");
      const isStroke = isBoundedStudioCrdtId(strokeId) && elementId === undefined;
      const isScene = isBoundedStudioCrdtId(elementId) && strokeId === undefined;
      if (!isStroke && !isScene) return false;
      const allowedKeys = isStroke
        ? new Set(["strokeId", "pageId", "layerId", "active"])
        : new Set(["elementId", "pageId", "layerId", "kind", "active"]);
      if (
        !hasOnlyKeys(value, allowedKeys) ||
        !isBoundedStudioCrdtId(value.get("pageId")) ||
        !isBoundedStudioCrdtId(value.get("layerId")) ||
        typeof value.get("active") !== "boolean" ||
        (isScene && value.get("kind") !== "scene")
      ) return false;
      const targetId = (isStroke ? strokeId : elementId) as string;
      const target = isStroke
        ? strokesRoot?.get(targetId)
        : materializeExistingMapRoot(
            doc,
            `${STUDIO_CRDT_SCENE_ROOT_PREFIX}${encodeURIComponent(targetId)}`
          );
      const active = value.get("active") === true;
      if (
        !(target instanceof Y.Map) ||
        target.get("id") !== targetId ||
        (isScene && (!sceneIndexRoot || sceneIndexRoot.get(targetId) !== true))
      ) return false;
      if (active) {
        const countKey = `${isStroke ? "stroke" : "scene"}:${targetId}`;
        const count = (activeCounts.get(countKey) ?? 0) + 1;
        if (count > STUDIO_CRDT_ACTIVE_ORDER_ENTRY_MAX_COUNT) return false;
        activeCounts.set(countKey, count);
        if (
          target.get("pageId") === value.get("pageId") &&
          target.get("layerId") === value.get("layerId")
        ) matchingActiveCoordinates.add(countKey);
      }
    }
    // Concurrent reparents can leave multiple active entries with different coordinates. Y.Map
    // deterministically chooses one record owner while Y.Array retains both operations, so losing
    // active entries are valid history. At least one active entry must still describe the winning
    // record coordinate; otherwise the order log cannot place the current record coherently.
    for (const countKey of activeCounts.keys()) {
      if (!matchingActiveCoordinates.has(countKey)) return false;
    }
  }

  if (
    !validateTrackedDynamicRoots(
      doc,
      STUDIO_CRDT_SCENE_INDEX_ROOT,
      STUDIO_CRDT_SCENE_ROOT_PREFIX,
      validateSceneElementRoot
    ) ||
    !validateTrackedDynamicRoots(
      doc,
      STUDIO_CRDT_PAGE_INDEX_ROOT,
      STUDIO_CRDT_PAGE_ROOT_PREFIX,
      validatePageRoot
    ) ||
    !validateTrackedLayerGroupRoots(doc) ||
    !validateStudioCrdtShared3dStageRoots(doc)
  ) {
    return false;
  }

  const pageOrderRoot = materializeExistingArrayRoot(doc, STUDIO_CRDT_PAGE_ORDER_ROOT);
  if (pageOrderRoot !== undefined) {
    if (
      pageOrderRoot === null ||
      pageOrderRoot.length > STUDIO_CRDT_COLLECTION_MAX_ENTRIES
    ) return false;
    const allowedKeys = new Set(["pageId", "active"]);
    const activeCounts = new Map<string, number>();
    const pageIndexRoot = materializeExistingMapRoot(doc, STUDIO_CRDT_PAGE_INDEX_ROOT);
    for (const value of pageOrderRoot) {
      const pageId = value instanceof Y.Map ? value.get("pageId") : undefined;
      const pageRecord = isBoundedStudioCrdtId(pageId)
        ? materializeExistingMapRoot(
            doc,
            `${STUDIO_CRDT_PAGE_ROOT_PREFIX}${encodeURIComponent(pageId)}`
          )
        : undefined;
      if (
        !(value instanceof Y.Map) ||
        !hasOnlyKeys(value, allowedKeys) ||
        !isBoundedStudioCrdtId(pageId) ||
        typeof value.get("active") !== "boolean" ||
        !pageIndexRoot ||
        pageIndexRoot.get(pageId) !== true ||
        !(pageRecord instanceof Y.Map) ||
        pageRecord.get("id") !== pageId
      ) return false;
      if (value.get("active") === true) {
        const count = (activeCounts.get(pageId) ?? 0) + 1;
        if (count > STUDIO_CRDT_ACTIVE_ORDER_ENTRY_MAX_COUNT) return false;
        activeCounts.set(pageId, count);
      }
    }
  }
  if (!validateStudioCrdtDeletionRoots(doc)) return false;
  try {
    const raster = readStudioCrdtRasterDocument(doc);
    return hasValidStudioFilterMaskSurfaceReferences(doc, raster.surfaces);
  } catch {
    return false;
  }
}
