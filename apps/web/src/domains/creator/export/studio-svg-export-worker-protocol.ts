import {
  normalizeStudioBrushR8TextureGrainSource,
  serializeStudioBrushR8TextureGrainSourceCanonical,
  type StudioBrushR8TextureGrainSource,
} from "../brush/studio-brush-r8-grain-asset-contract";

import type { SvgExportPageInput, SvgExportResult } from "./studio-svg-export";

export const STUDIO_SVG_EXPORT_WORKER_PROTOCOL_VERSION = 2 as const;

/**
 * The shared renderer registry has the same default ceiling. Keeping an explicit wire ceiling
 * prevents a compromised or stale caller from turning one export into an unbounded structured
 * clone even if the in-realm registry grows in a future release.
 */
export const STUDIO_SVG_EXPORT_WORKER_R8_TRANSFER_LIMITS = Object.freeze({
  maxEntries: 32,
  maxDecodedBytes: 64 * 1_024 * 1_024,
});

export interface StudioSvgExportWorkerR8GrainEntry {
  /** Canonical JSON identity; the worker recomputes and cross-checks this before hydration. */
  readonly sourceKey: string;
  readonly source: Readonly<StudioBrushR8TextureGrainSource>;
  /** Private, exact-length copy whose ArrayBuffer is transferred to the short-lived worker. */
  readonly decodedBytes: Uint8Array;
}

export interface StudioSvgExportReferencedR8GrainSource {
  readonly sourceKey: string;
  readonly source: Readonly<StudioBrushR8TextureGrainSource>;
}

function ownEnumerableDataValue(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && "value" in descriptor && descriptor.enumerable === true
      ? descriptor.value
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Finds only canonical R8 sources that are actually persisted on draw elements. Accessor-backed,
 * inherited and malformed candidates are ignored, and canonical identity removes duplicates.
 */
export function collectStudioSvgExportReferencedR8GrainSources(
  input: SvgExportPageInput,
): readonly Readonly<StudioSvgExportReferencedR8GrainSource>[] {
  const collected = new Map<string, Readonly<StudioSvgExportReferencedR8GrainSource>>();
  const elements = Array.isArray(input.elements) ? input.elements : [];
  const hiddenGroupIds = new Set<string>();
  const groups = Array.isArray(input.groups) ? input.groups : [];
  for (const group of groups) {
    const groupId = ownEnumerableDataValue(group, "id");
    if (
      typeof groupId === "string"
      && ownEnumerableDataValue(group, "hidden") === true
    ) {
      hiddenGroupIds.add(groupId);
    }
  }
  for (const element of elements) {
    if (ownEnumerableDataValue(element, "type") !== "draw") continue;
    const groupId = ownEnumerableDataValue(element, "groupId");
    if (
      ownEnumerableDataValue(element, "hidden") === true
      || ownEnumerableDataValue(element, "mode") === "eraser"
      || (typeof groupId === "string" && hiddenGroupIds.has(groupId))
    ) {
      continue;
    }
    const dynamics = ownEnumerableDataValue(element, "brushDynamics");
    const grain = ownEnumerableDataValue(dynamics, "grain");
    const amount = ownEnumerableDataValue(grain, "amount");
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
      continue;
    }
    const sourceCandidate = ownEnumerableDataValue(grain, "source");
    const source = normalizeStudioBrushR8TextureGrainSource(sourceCandidate);
    if (!source) continue;
    const sourceKey = serializeStudioBrushR8TextureGrainSourceCanonical(source);
    if (!sourceKey || collected.has(sourceKey)) continue;
    collected.set(sourceKey, Object.freeze({ sourceKey, source }));
  }
  return Object.freeze([...collected.values()]);
}

export interface StudioSvgExportWorkerRunMessage {
  type: "studio-svg-export/run";
  version: typeof STUDIO_SVG_EXPORT_WORKER_PROTOCOL_VERSION;
  input: SvgExportPageInput;
  /**
   * Verified snapshots for the exact canonical R8 sources referenced by `input`. Missing entries
   * deliberately remain missing so the renderer emits its existing fail-closed SVG caveat.
   */
  r8GrainAssets: readonly Readonly<StudioSvgExportWorkerR8GrainEntry>[];
}

export interface StudioSvgExportWorkerSuccessMessage {
  type: "studio-svg-export/success";
  version: typeof STUDIO_SVG_EXPORT_WORKER_PROTOCOL_VERSION;
  result: SvgExportResult;
}

export interface StudioSvgExportWorkerReadyMessage {
  type: "studio-svg-export/ready";
  version: typeof STUDIO_SVG_EXPORT_WORKER_PROTOCOL_VERSION;
}

export interface StudioSvgExportWorkerFailureMessage {
  type: "studio-svg-export/failure";
  version: typeof STUDIO_SVG_EXPORT_WORKER_PROTOCOL_VERSION;
  error: {
    name: string;
    message: string;
  };
}

export type StudioSvgExportWorkerResponseMessage =
  | StudioSvgExportWorkerReadyMessage
  | StudioSvgExportWorkerSuccessMessage
  | StudioSvgExportWorkerFailureMessage;
