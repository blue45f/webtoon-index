import {
  STUDIO_HOKUSAI_LIVE_ADAPTER_VERSION,
  STUDIO_HOKUSAI_LIVE_BRUSH_PROTOCOL_VERSION,
  isStudioHokusaiLiveSha256,
  type StudioHokusaiLiveCanonicalReceipt,
} from "./studio-hokusai-live-brush-protocol";
import {
  STUDIO_HOKUSAI_NATURAL_MEDIA_PRESETS,
  studioHokusaiDefaultMaterialProfileId,
  studioHokusaiMaterialProfileIsCompatible,
} from "./studio-hokusai-natural-media-contract";

export const STUDIO_HOKUSAI_LIVE_DOCUMENT_RECEIPT_VERSION = 2 as const;

const STUDIO_HOKUSAI_LEGACY_LIVE_DOCUMENT_RECEIPT_VERSION = 1 as const;
const STUDIO_HOKUSAI_LEGACY_LIVE_BRUSH_PROTOCOL_VERSION = 1 as const;
const STUDIO_HOKUSAI_LEGACY_LIVE_ADAPTER_VERSION =
  "0.3.0-packed-dirty-live-adapter.2" as const;

/**
 * Small, JSON-safe authority sidecar stored on the canonical PNG ImageEl.
 * The hidden DrawEl remains recoverable, while this receipt proves which exact
 * live input/pixel/PNG hashes produced the visible layer after a save/reload.
 */
export interface StudioHokusaiLiveDocumentReceipt {
  readonly kind: "studio-hokusai-live/document-receipt";
  readonly version: typeof STUDIO_HOKUSAI_LIVE_DOCUMENT_RECEIPT_VERSION;
  readonly liveAdapterVersion: typeof STUDIO_HOKUSAI_LIVE_ADAPTER_VERSION;
  readonly sourceElementId: string;
  readonly sourceRevision: `hokusai-source-v1:${string}`;
  readonly canonical: StudioHokusaiLiveCanonicalReceipt;
}

const SOURCE_REVISION_PATTERN = /^hokusai-source-v1:[a-f0-9]{16}$/u;
const PRESET_IDS = new Set<string>(
  STUDIO_HOKUSAI_NATURAL_MEDIA_PRESETS.map(({ id }) => id),
);

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function integer(value: unknown, minimum = 0): value is number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= minimum;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function snapshotPlacement(value: unknown): Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
}> | null {
  if (!record(value)) return null;
  if (
    !finite(value.x)
    || !finite(value.y)
    || !finite(value.width)
    || !finite(value.height)
    || value.width <= 0
    || value.height <= 0
  ) return null;
  return Object.freeze({
    x: value.x,
    y: value.y,
    width: value.width,
    height: value.height,
  });
}

function snapshotCanonicalReceipt(
  value: unknown,
  wireVersion: typeof STUDIO_HOKUSAI_LIVE_BRUSH_PROTOCOL_VERSION
    | typeof STUDIO_HOKUSAI_LEGACY_LIVE_BRUSH_PROTOCOL_VERSION,
): StudioHokusaiLiveCanonicalReceipt | null {
  if (!record(value)) return null;
  const presetId = value.presetId as StudioHokusaiLiveCanonicalReceipt["presetId"];
  const legacy = wireVersion === STUDIO_HOKUSAI_LEGACY_LIVE_BRUSH_PROTOCOL_VERSION;
  const materialProfileId = legacy
    ? value.materialProfileId ?? studioHokusaiDefaultMaterialProfileId(presetId)
    : value.materialProfileId;
  if (
    value.kind !== "studio-hokusai-live/canonical-receipt"
    || value.version !== wireVersion
    || !integer(value.requestId, 1)
    || !integer(value.engineEpoch, 1)
    || typeof value.strokeId !== "string"
    || value.strokeId.length === 0
    || value.strokeId.length > 512
    || !PRESET_IDS.has(String(value.presetId))
    || !studioHokusaiMaterialProfileIsCompatible(
      presetId,
      materialProfileId,
    )
    || !integer(value.seed)
    || value.seed > 0xffff_ffff
    || !integer(value.sampleCount, 1)
    || !integer(value.finalSequence, 1)
    || value.segmentCount !== 1
    || !Array.isArray(value.segments)
    || value.segments.length !== 1
    || !Array.isArray(value.dirtyBounds)
    || value.dirtyBounds.length !== 4
    || !integer(value.dirtyBounds[0])
    || !integer(value.dirtyBounds[1])
    || !integer(value.dirtyBounds[2], 1)
    || !integer(value.dirtyBounds[3], 1)
    || value.pixelLayout !== "packed-dirty-rgba8"
    || !isStudioHokusaiLiveSha256(value.inputHash)
    || !isStudioHokusaiLiveSha256(value.lastLivePixelHash)
    || !isStudioHokusaiLiveSha256(value.settledPixelHash)
    || !isStudioHokusaiLiveSha256(value.pngHash)
    || value.lastLivePixelHash !== value.settledPixelHash
    || value.exactLiveCommitParity !== true
    || value.execution !== "dedicated-worker-wasm-packed-dirty-live"
    || value.materialTexture !== "studio-hokusai-material-texture-v2"
    || value.endpointPolicy !== "tapered-start-no-dab-carrier-v1"
    || value.colorOpacityApplication !== "worker-once-before-material-transfer-v1"
    || value.canonicalAuthority !== "settled-png-receipt-v1"
    || value.undoAuthority !== "single-stroke-transaction-v1"
    || value.saveAuthority !== "canonical-png-plus-versioned-receipt-v1"
    || value.complete !== true
  ) return null;

  const segmentCandidate = value.segments[0];
  if (!record(segmentCandidate)) return null;
  const logicalPlacement = snapshotPlacement(segmentCandidate.logicalPlacement);
  if (
    !logicalPlacement
    || !integer(segmentCandidate.segmentIndex)
    || !isStudioHokusaiLiveSha256(segmentCandidate.pixelHash)
    || !isStudioHokusaiLiveSha256(segmentCandidate.pngHash)
    || segmentCandidate.pixelHash !== value.settledPixelHash
    || segmentCandidate.pngHash !== value.pngHash
  ) return null;

  return Object.freeze({
    kind: "studio-hokusai-live/canonical-receipt",
    version: STUDIO_HOKUSAI_LIVE_BRUSH_PROTOCOL_VERSION,
    requestId: value.requestId,
    engineEpoch: value.engineEpoch,
    strokeId: value.strokeId,
    presetId,
    materialProfileId,
    seed: value.seed,
    sampleCount: value.sampleCount,
    finalSequence: value.finalSequence,
    segmentCount: 1,
    segments: Object.freeze([Object.freeze({
      segmentIndex: segmentCandidate.segmentIndex,
      logicalPlacement,
      pixelHash: segmentCandidate.pixelHash,
      pngHash: segmentCandidate.pngHash,
    })]),
    dirtyBounds: Object.freeze([
      value.dirtyBounds[0],
      value.dirtyBounds[1],
      value.dirtyBounds[2],
      value.dirtyBounds[3],
    ]) as readonly [number, number, number, number],
    pixelLayout: "packed-dirty-rgba8",
    inputHash: value.inputHash,
    lastLivePixelHash: value.lastLivePixelHash,
    settledPixelHash: value.settledPixelHash,
    pngHash: value.pngHash,
    exactLiveCommitParity: true,
    execution: "dedicated-worker-wasm-packed-dirty-live",
    materialTexture: "studio-hokusai-material-texture-v2",
    endpointPolicy: "tapered-start-no-dab-carrier-v1",
    colorOpacityApplication: "worker-once-before-material-transfer-v1",
    canonicalAuthority: "settled-png-receipt-v1",
    undoAuthority: "single-stroke-transaction-v1",
    saveAuthority: "canonical-png-plus-versioned-receipt-v1",
    complete: true,
  });
}

export function createStudioHokusaiLiveDocumentReceipt(input: Readonly<{
  sourceElementId: string;
  sourceRevision: `hokusai-source-v1:${string}`;
  canonical: StudioHokusaiLiveCanonicalReceipt;
}>): StudioHokusaiLiveDocumentReceipt | null {
  return snapshotStudioHokusaiLiveDocumentReceipt({
    kind: "studio-hokusai-live/document-receipt",
    version: STUDIO_HOKUSAI_LIVE_DOCUMENT_RECEIPT_VERSION,
    liveAdapterVersion: STUDIO_HOKUSAI_LIVE_ADAPTER_VERSION,
    sourceElementId: input.sourceElementId,
    sourceRevision: input.sourceRevision,
    canonical: input.canonical,
  });
}

/** Re-validates persisted JSON instead of trusting a TypeScript cast after reload/CRDT sync. */
export function snapshotStudioHokusaiLiveDocumentReceipt(
  value: unknown,
): StudioHokusaiLiveDocumentReceipt | null {
  if (!record(value) || value.kind !== "studio-hokusai-live/document-receipt") {
    return null;
  }
  const currentWire = value.version === STUDIO_HOKUSAI_LIVE_DOCUMENT_RECEIPT_VERSION
    && value.liveAdapterVersion === STUDIO_HOKUSAI_LIVE_ADAPTER_VERSION;
  const legacyWire = value.version === STUDIO_HOKUSAI_LEGACY_LIVE_DOCUMENT_RECEIPT_VERSION
    && value.liveAdapterVersion === STUDIO_HOKUSAI_LEGACY_LIVE_ADAPTER_VERSION;
  if (
    (!currentWire && !legacyWire)
    || typeof value.sourceElementId !== "string"
    || value.sourceElementId.length === 0
    || value.sourceElementId.length > 512
    || typeof value.sourceRevision !== "string"
    || !SOURCE_REVISION_PATTERN.test(value.sourceRevision)
  ) return null;
  const canonical = snapshotCanonicalReceipt(
    value.canonical,
    currentWire
      ? STUDIO_HOKUSAI_LIVE_BRUSH_PROTOCOL_VERSION
      : STUDIO_HOKUSAI_LEGACY_LIVE_BRUSH_PROTOCOL_VERSION,
  );
  if (!canonical) return null;
  return Object.freeze({
    kind: "studio-hokusai-live/document-receipt",
    version: STUDIO_HOKUSAI_LIVE_DOCUMENT_RECEIPT_VERSION,
    liveAdapterVersion: STUDIO_HOKUSAI_LIVE_ADAPTER_VERSION,
    sourceElementId: value.sourceElementId,
    sourceRevision: value.sourceRevision as `hokusai-source-v1:${string}`,
    canonical,
  });
}
