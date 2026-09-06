import { STUDIO_CRDT_CHANGE_SNAPSHOT_FIELDS } from "./studio-crdt-document-types";

export const STUDIO_CRDT_STROKE_MAX_SAMPLES = 100_000;
export const STUDIO_CRDT_APPEND_MAX_SAMPLES = 4_096;
export const STUDIO_CRDT_REPLACE_CHUNK_SAMPLES = 256;
/** Inline CRDT metadata is intentionally small; large masks/assets must use an external reference. */
export const STUDIO_CRDT_METADATA_MAX_BYTES = 16 * 1024;
/**
 * Delete-wins observed-remove protocol roots. Each delete owns a unique, immutable operation ID;
 * explicit restore only acknowledges deletion IDs already visible to that peer.
 */
export const STUDIO_CRDT_DELETION_OPS_ROOT = "studio-deletion-ops";
export const STUDIO_CRDT_DELETION_ACKS_ROOT = "studio-deletion-acks";
export const STUDIO_CRDT_DELETION_OPERATION_MAX_ENTRIES = 100_000;
/**
 * Operation-keyed canonical R8 render provenance plus a grow-only content index. The second map
 * preserves concurrent conflicting hashes that a plain Y.Map last-writer-wins value would hide,
 * allowing every reader to reject the conflicted operation instead of silently accepting a winner.
 */
export const STUDIO_CRDT_BRUSH_RENDER_PROVENANCE_ROOT =
  "studio-brush-render-provenance-v1";
export const STUDIO_CRDT_BRUSH_RENDER_PROVENANCE_CONTENT_INDEX_ROOT =
  "studio-brush-render-provenance-content-index-v1";
export const STUDIO_CRDT_BRUSH_RENDER_PROVENANCE_MAX_ENTRIES = 4_096;
export const STUDIO_CRDT_BRUSH_RENDER_PROVENANCE_MAX_BYTES = 16 * 1_024 * 1_024;
export const MAX_ID_LENGTH = 160;
export const MAX_LAYER_GROUP_KEY_LENGTH = MAX_ID_LENGTH * 2 + 32;
export const MAX_TEXT_LENGTH = 512;
export const MAX_COORDINATE = 10_000_000;
export const MAX_STROKE_WIDTH = 8_192;
export const MAX_JSON_DEPTH = 10;
export const MAX_JSON_ENTRIES = 4_096;
export const MAX_JSON_STRING_LENGTH = 64 * 1024;
export const MAX_ACTIVE_ORDER_ENTRIES_PER_STROKE = 256;
export const MAX_DELETION_TARGET_LENGTH = MAX_ID_LENGTH * 2 + 64;
export const BATCH_MIN_DELAY_MS = 30;
export const BATCH_MAX_DELAY_MS = 50;
export const DEFAULT_BATCH_DELAY_MS = 40;
export const DEFAULT_BATCH_MAX_BYTES = 32 * 1024;
export const TEXT_ENCODER = new TextEncoder();
export const SCENE_ELEMENT_ROOT_PREFIX = "scene-element:";
export const PAGE_ROOT_PREFIX = "studio-page:";
export const LAYER_GROUP_ROOT_PREFIX = "layer-group:";
export const PROPERTY_PREFIX = "prop:";
export const BASELINE_PROPERTY_PREFIX = "base:";
export const UNSET_PROPERTY_PREFIX = "unset:";
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
export const RASTER_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
export const RASTER_SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@-]*$/u;
// A probe update starts at clock zero. Actual Yjs client/clock varuints can be a few bytes wider.
export const RASTER_LOCAL_UPDATE_ENCODING_HEADROOM_BYTES = 64;

export type StudioCrdtDeletionTarget =
  | { kind: "stroke"; id: string }
  | { kind: "scene"; id: string }
  | { kind: "page"; id: string }
  | { kind: "group"; pageId: string; id: string };

export const BASE_SAMPLE_ARRAY_KEYS = [
  "points",
  "pressures",
  "tiltXs",
  "tiltYs",
  "twists",
  "speeds",
  "tangentialPressures",
] as const;

export const EXTENDED_INK_SAMPLE_ARRAY_KEYS = [
  "altitudeAngles",
  "azimuthAngles",
  "contactWidths",
  "contactHeights",
  "sampleTimeOffsets",
] as const;

export const STUDIO_CRDT_CHANGE_SNAPSHOT_FIELD_SET: ReadonlySet<string> =
  new Set(STUDIO_CRDT_CHANGE_SNAPSHOT_FIELDS);

export const JSON_PAYLOAD_KEYS = [
  "gradient",
  "pattern",
  "brushDynamics",
  "brushTip",
  "strokeStyle",
  "shapeParams",
  "sketch",
  "symmetry",
  "extensions",
] as const;
