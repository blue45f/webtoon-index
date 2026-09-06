/**
 * Contract for rasterising the atomic prefix owned by `StudioEngineTileAuthority`.
 *
 * Scope is intentionally narrower than a Studio page. The authority contains ordered RGBA16F
 * raster layers, but it does not contain Konva/vector nodes, text, imported images, layer
 * visibility/opacity/blend metadata, page grade, or watermarks. A receipt from this boundary
 * therefore proves a tile-authority raster projection only; it must not be presented as a complete
 * Studio-page render until the canonical document model delegates those remaining fields to it.
 */

import {
  STUDIO_ENGINE_TILE_AUTHORITY_VERSION,
  type StudioEngineTileCommitReceipt,
  type StudioEngineTileDeviceLossReplaySource,
} from "./studio-engine-tile-authority";

import type {
  StudioOffscreenRasterRunInput,
  StudioOffscreenRasterRunOptions,
  StudioOffscreenRasterRunResult,
} from "../studio-offscreen-raster-worker-client";
import type {
  StudioOffscreenRasterFailureCode,
  StudioOffscreenRasterOutput,
  StudioOffscreenRasterResultPayload,
} from "../studio-offscreen-raster-worker-protocol";

export const STUDIO_ENGINE_SETTLED_TILE_RASTER_VERSION = 1 as const;
export const STUDIO_ENGINE_SETTLED_TILE_RASTER_BACKEND =
  "studio-engine-tile-authority/offscreen-raster-worker" as const;
export const STUDIO_ENGINE_SETTLED_TILE_RASTER_CONVERSION =
  "linear-premultiplied-rgba16f-to-straight-srgb-rgba8" as const;
export const STUDIO_ENGINE_SETTLED_TILE_RASTER_COMPOSITE =
  "authority-layer-order-normal-source-over" as const;
export const STUDIO_ENGINE_SETTLED_TILE_RASTER_SOURCE_COLOR_SPACE =
  "linear-srgb" as const;

/**
 * The existing authority already implements this structure. `deviceLossReplaySource()` is
 * currently its only complete, defensive, atomically captured tile snapshot.
 */
export interface StudioEngineSettledTileAuthorityBoundary {
  readonly documentId: string;
  readonly documentWidth: number;
  readonly documentHeight: number;
  readonly tileSize: number;
  readonly tileByteLength: number;
  readonly shardBytes: bigint;
  deviceLossReplaySource(): StudioEngineTileDeviceLossReplaySource;
}

/** Structural seam used by tests and by the real `StudioOffscreenRasterSession`. */
export interface StudioEngineSettledTileRasterSessionBoundary {
  run(
    jobKey: string,
    input: StudioOffscreenRasterRunInput,
    options?: StudioOffscreenRasterRunOptions,
  ): Promise<StudioOffscreenRasterRunResult>;
  dispose(): void;
}

/**
 * Optional compare token. Supplying one makes a render fail closed if the authority has advanced
 * (or has been replaced) since the caller selected the settled revision.
 */
export interface StudioEngineSettledTileRevision {
  readonly kind: "studio-engine-settled-tile-revision";
  readonly version: typeof STUDIO_ENGINE_SETTLED_TILE_RASTER_VERSION;
  readonly documentId: string;
  readonly documentRevision: number;
  readonly journalHeadDigest: string;
}

export interface StudioEngineSettledTileRasterRequest {
  readonly jobKey: string;
  /**
   * Output pixels per authority document pixel. Defaults to 1. The adapter preserves aspect ratio
   * and rounds each final output dimension once.
   */
  readonly scale?: number;
  /** Defaults to transparent. JPEG callers should provide an opaque CSS background. */
  readonly background?: string | null;
  readonly output: StudioOffscreenRasterOutput;
  readonly expectedRevision?: StudioEngineSettledTileRevision;
  readonly signal?: AbortSignal;
}

export interface StudioEngineSettledTileRasterReceipt {
  readonly kind: "studio-engine-settled-tile-raster-receipt";
  readonly version: typeof STUDIO_ENGINE_SETTLED_TILE_RASTER_VERSION;
  readonly backend: typeof STUDIO_ENGINE_SETTLED_TILE_RASTER_BACKEND;
  readonly conversion: typeof STUDIO_ENGINE_SETTLED_TILE_RASTER_CONVERSION;
  readonly composite: typeof STUDIO_ENGINE_SETTLED_TILE_RASTER_COMPOSITE;
  readonly sourceColorSpace: typeof STUDIO_ENGINE_SETTLED_TILE_RASTER_SOURCE_COLOR_SPACE;
  readonly documentId: string;
  readonly documentRevision: number;
  readonly journalHeadDigest: string;
  readonly nativeWidth: number;
  readonly nativeHeight: number;
  readonly outputWidth: number;
  readonly outputHeight: number;
  readonly layerCount: number;
  /** Number of authoritative layer-tile payloads read and digest-verified. */
  readonly authorityTileCount: number;
  /** Number of materialised document coordinates after all authority layers were flattened. */
  readonly flattenedTileCount: number;
  /** Includes the one transparent protocol sentinel used for an empty authority. */
  readonly workerSourceCount: number;
  readonly sourcePixelBytes: number;
  readonly outputKind: StudioOffscreenRasterOutput["kind"];
  readonly runId: number;
  /** This route never reads a Konva stage or full-page canvas. */
  readonly konvaCapture: false;
}

export type StudioEngineSettledTileRasterRejectionReason =
  | "disposed"
  | "aborted"
  | "invalid-request"
  | "authority-unavailable"
  | "stale-authority-revision"
  | "invalid-authority-snapshot"
  | "invalid-authority-pixels"
  | "source-budget"
  | "worker-rejected"
  | "worker-failed";

export type StudioEngineSettledTileRasterResult =
  | Readonly<{
      status: "rendered";
      receipt: StudioEngineSettledTileRasterReceipt;
      payload: StudioOffscreenRasterResultPayload;
    }>
  | Readonly<{
      status: "rejected";
      reason: StudioEngineSettledTileRasterRejectionReason;
      message: string;
      runId: number | null;
      workerCode?: StudioOffscreenRasterFailureCode;
    }>;

function validDocumentId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 160;
}

function validDigest(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 512;
}

/**
 * Turns a successful atomic authority commit into the compare token accepted by the raster
 * adapter. The authority journal digest is the snapshot's head digest at that exact revision.
 */
export function studioEngineSettledTileRevisionFromCommitReceipt(
  receipt: StudioEngineTileCommitReceipt,
): StudioEngineSettledTileRevision {
  if (
    !receipt
    || receipt.kind !== "studio-engine-tile-commit-receipt"
    || receipt.version !== STUDIO_ENGINE_TILE_AUTHORITY_VERSION
    || !validDocumentId(receipt.documentId)
    || !Number.isSafeInteger(receipt.documentRevision)
    || receipt.documentRevision <= 0
    || !validDigest(receipt.journalDigest)
  ) {
    throw new TypeError("Studio engine tile commit receipt is invalid.");
  }
  return Object.freeze({
    kind: "studio-engine-settled-tile-revision",
    version: STUDIO_ENGINE_SETTLED_TILE_RASTER_VERSION,
    documentId: receipt.documentId,
    documentRevision: receipt.documentRevision,
    journalHeadDigest: receipt.journalDigest,
  });
}
