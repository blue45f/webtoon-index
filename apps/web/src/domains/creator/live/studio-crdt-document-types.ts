import type { StudioCrdtStrokePayloadVersion } from "./studio-crdt-protocol";
import type {
  StudioCrdtJsonObject,
  StudioCrdtLayerGroupPayload,
  StudioCrdtPagePayload,
  StudioCrdtSceneElementPayload,
} from "./studio-crdt-scene-schema";
import type { StudioRasterCompactionCheckpoint } from "@/shared/lib/studio-crdt-raster-compaction";
import type { StudioRasterOperationLog } from "@/shared/lib/studio-crdt-raster-ops";
import type { StudioShared3dStageCollectionDocument } from "../studio-shared-3d-stage-collection";

export const SAMPLE_ARRAY_KEYS = [
  "points", "pressures", "tiltXs", "tiltYs", "twists", "speeds",
  "tangentialPressures", "altitudeAngles", "azimuthAngles",
  "contactWidths", "contactHeights", "sampleTimeOffsets",
] as const;

export const OPTIONAL_STRING_PAYLOAD_KEYS = [
  "fill", "brush", "blendMode", "brushCatalogId", "brushCatalogName",
] as const;

export const STROKE_PAYLOAD_KEYS = [
  "version", "type", "kind", "mode", "stroke", "strokeWidth", "opacity", "sampleSpacing",
  ...OPTIONAL_STRING_PAYLOAD_KEYS,
  "gradient", "pattern", "brushDynamics", "brushTip", "strokeStyle", "shapeParams", "sketch",
  "symmetry", "extensions", ...SAMPLE_ARRAY_KEYS,
] as const;

export type StudioCrdtSampleArrayKey = (typeof SAMPLE_ARRAY_KEYS)[number];
export type StudioCrdtStringPayloadKey = (typeof OPTIONAL_STRING_PAYLOAD_KEYS)[number];
export type StudioCrdtStrokePayloadKey = (typeof STROKE_PAYLOAD_KEYS)[number];

export interface StudioCrdtStrokeSamples {
  points: number[];
  pressures?: number[];
  tiltXs?: number[];
  tiltYs?: number[];
  twists?: number[];
  speeds?: number[];
  tangentialPressures?: number[];
  altitudeAngles?: number[];
  azimuthAngles?: number[];
  contactWidths?: number[];
  contactHeights?: number[];
  sampleTimeOffsets?: number[];
}

export interface StudioCrdtDrawStrokePayload extends StudioCrdtStrokeSamples {
  version: StudioCrdtStrokePayloadVersion;
  type: "draw";
  kind: string;
  mode: "pen" | "eraser";
  stroke: string;
  strokeWidth: number;
  opacity?: number;
  fill?: string;
  gradient?: StudioCrdtJsonObject;
  pattern?: StudioCrdtJsonObject;
  brush?: string;
  brushCatalogId?: string;
  brushCatalogName?: string;
  sampleSpacing?: number;
  brushDynamics?: StudioCrdtJsonObject;
  brushTip?: StudioCrdtJsonObject;
  strokeStyle?: StudioCrdtJsonObject;
  shapeParams?: StudioCrdtJsonObject;
  sketch?: StudioCrdtJsonObject;
  symmetry?: StudioCrdtJsonObject;
  blendMode?: string;
  extensions?: StudioCrdtJsonObject;
}

export interface StudioCrdtStrokeInput {
  id: string;
  pageId: string;
  layerId: string;
  payload: StudioCrdtDrawStrokePayload;
}

export interface StudioCrdtStrokeRecord extends StudioCrdtStrokeInput {
  status: "drawing" | "finalized";
  deleted: boolean;
  orderIndex: number;
}

export interface StudioCrdtSceneElementInput {
  id: string;
  pageId: string;
  layerId: string;
  payload: StudioCrdtSceneElementPayload;
}

export interface StudioCrdtSceneElementRecord extends StudioCrdtSceneElementInput {
  deleted: boolean;
  orderIndex: number;
}

export interface StudioCrdtSceneElementQuery {
  pageId?: string;
  layerId?: string;
  includeDeleted?: boolean;
}

export interface StudioCrdtSceneElementPatch {
  pageId?: string;
  layerId?: string;
  set?: StudioCrdtJsonObject;
  unset?: readonly string[];
}

export interface StudioCrdtSceneElementUpsertOptions {
  beforeElementId?: string | null;
  resurrect?: boolean;
  baselineProps?: StudioCrdtJsonObject;
  changedProps?: readonly string[];
  unsetProps?: readonly string[];
}

export interface StudioCrdtPageInput {
  id: string;
  payload: StudioCrdtPagePayload;
}

export interface StudioCrdtPageRecord extends StudioCrdtPageInput {
  deleted: boolean;
  orderIndex: number;
  /** True when the per-entry Shared 3D Stage sidecar owns this page, including tombstone-only pages. */
  shared3dStageManaged?: boolean;
  /** Canonical aggregate rebuilt from active sidecar entries; never stored in `payload.props`. */
  shared3dStage?: StudioShared3dStageCollectionDocument;
}

export interface StudioCrdtPagePatch {
  set?: StudioCrdtJsonObject;
  unset?: readonly string[];
}

export interface StudioCrdtPageUpsertOptions {
  beforePageId?: string | null;
  resurrect?: boolean;
  baselineProps?: StudioCrdtJsonObject;
  changedProps?: readonly string[];
  unsetProps?: readonly string[];
}

export interface StudioCrdtLayerGroupInput {
  id: string;
  pageId: string;
  payload: StudioCrdtLayerGroupPayload;
}

export interface StudioCrdtLayerGroupRecord extends StudioCrdtLayerGroupInput {
  deleted: boolean;
}

export interface StudioCrdtLayerGroupQuery {
  pageId?: string;
  includeDeleted?: boolean;
}

export interface StudioCrdtLayerGroupPatch {
  set?: StudioCrdtJsonObject;
  unset?: readonly string[];
}

export interface StudioCrdtLayerGroupUpsertOptions {
  resurrect?: boolean;
  baselineProps?: StudioCrdtJsonObject;
  changedProps?: readonly string[];
  unsetProps?: readonly string[];
}

export interface StudioCrdtStrokeQuery {
  pageId?: string;
  layerId?: string;
  includeDeleted?: boolean;
}

export interface StudioCrdtUpsertOptions {
  beforeStrokeId?: string | null;
  resurrect?: boolean;
  status?: StudioCrdtStrokeRecord["status"];
}

export interface StudioCrdtStrokePatch {
  pageId?: string;
  layerId?: string;
  payload?: StudioCrdtDrawStrokePayload;
  changedPayloadKeys?: readonly StudioCrdtStrokePayloadKey[];
}

export interface StudioCrdtChangeSummary {
  origin: unknown;
  local: boolean;
  changedStrokeIds: ReadonlySet<string>;
  changedSceneElementIds: ReadonlySet<string>;
  changedPageIds: ReadonlySet<string>;
  changedLayerGroupIds: ReadonlySet<string>;
  changedRasterSurfaceIds: ReadonlySet<string>;
  changedRasterOperationIds: ReadonlySet<string>;
  changedRasterUndoOperationIds: ReadonlySet<string>;
  changedRasterUndoAcknowledgementIds: ReadonlySet<string>;
  changedRasterCheckpointIds: ReadonlySet<string>;
}

export interface StudioCrdtChangeSnapshot {
  strokes: StudioCrdtStrokeRecord[];
  sceneElements: StudioCrdtSceneElementRecord[];
  pages: StudioCrdtPageRecord[];
  layerGroups: StudioCrdtLayerGroupRecord[];
  rasterOperationLogs: StudioRasterOperationLog[];
  rasterCheckpoints: StudioRasterCompactionCheckpoint[];
}

export const STUDIO_CRDT_CHANGE_SNAPSHOT_FIELDS = Object.freeze([
  "strokes",
  "sceneElements",
  "pages",
  "layerGroups",
  "rasterOperationLogs",
  "rasterCheckpoints",
] as const satisfies readonly (keyof StudioCrdtChangeSnapshot)[]);

export type StudioCrdtChangeSnapshotField =
  (typeof STUDIO_CRDT_CHANGE_SNAPSHOT_FIELDS)[number];

export interface StudioCrdtChange extends StudioCrdtChangeSummary, StudioCrdtChangeSnapshot {}

export interface StudioCrdtProjectedChange<
  Fields extends readonly StudioCrdtChangeSnapshotField[] =
    readonly StudioCrdtChangeSnapshotField[]
> extends StudioCrdtChangeSummary {
  snapshotMode: "projected";
  snapshotFields: Readonly<Fields>;
  snapshot: Readonly<Pick<StudioCrdtChangeSnapshot, Fields[number]>>;
}

export interface StudioCrdtChangeSubscriptionOptions {
  includeOrigin?: (origin: unknown) => boolean;
  includeChange?: (summary: StudioCrdtChangeSummary) => boolean;
  snapshotFields?: undefined;
}

export type StudioCrdtProjectedChangeSubscriptionOptions<
  Fields extends readonly StudioCrdtChangeSnapshotField[] =
    readonly StudioCrdtChangeSnapshotField[]
> = Omit<StudioCrdtChangeSubscriptionOptions, "snapshotFields"> & {
  snapshotFields: Fields;
};

export type StudioCrdtUpdateHandler = (update: Uint8Array, origin: unknown) => void;
export type StudioCrdtChangeHandler = (change: StudioCrdtChange) => void;
export type StudioCrdtProjectedChangeHandler<
  Fields extends readonly StudioCrdtChangeSnapshotField[] =
    readonly StudioCrdtChangeSnapshotField[]
> = (change: StudioCrdtProjectedChange<Fields>) => void;

export interface StudioCrdtBatchedUpdate {
  update: Uint8Array;
  origins: ReadonlySet<unknown>;
}

export interface StudioCrdtBatchOptions {
  delayMs?: number;
  maxBytes?: number;
  includeOrigin?: (origin: unknown) => boolean;
  setTimeout?: (handler: () => void, delay: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
}

export interface StudioCrdtBatchSubscription {
  flush(): void;
  unsubscribe(): void;
}
