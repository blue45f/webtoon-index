import {
  hydrateStudioAiImageReferenceDocument,
  type StudioAiImageReferenceDocument,
  type StudioAiImageReferenceRole,
} from "./studio-ai-image-reference-roles";

import type {
  StudioAiResolvedImageReference,
} from "./studio-ai-client";

export interface StudioAiImageReferenceAssetSource {
  readonly id: string;
  readonly name: string;
  readonly dataUrl: string;
  readonly contentHash?: string;
}

export interface StudioAiMissingImageReference {
  readonly referenceId: string;
  readonly role: StudioAiImageReferenceRole;
  readonly label: string;
}

export interface StudioAiImageReferenceResolution {
  readonly references: readonly StudioAiResolvedImageReference[];
  readonly missing: readonly StudioAiMissingImageReference[];
  readonly trackingAssetIds: readonly string[];
  readonly hasCharacterReference: boolean;
}

function normalizeSha256(value: string | undefined): string | null {
  if (!value) return null;
  const match = /^(?:sha256:)?([a-f0-9]{64})$/iu.exec(value.trim());
  return match ? `sha256:${match[1].toLowerCase()}` : null;
}

function resolveReferenceAsset(
  requestedId: string | undefined,
  requestedHash: string | null,
  byId: ReadonlyMap<string, StudioAiImageReferenceAssetSource>,
  byHash: ReadonlyMap<string, StudioAiImageReferenceAssetSource>,
): StudioAiImageReferenceAssetSource | undefined {
  const idMatch = requestedId ? byId.get(requestedId) : undefined;
  if (!requestedHash) return idMatch;

  // A stored content hash is authoritative. Reusing an asset ID for different pixels must never
  // silently upload those pixels; a matching hash under another ID is a safe rename recovery.
  if (
    idMatch
    && normalizeSha256(idMatch.contentHash) === requestedHash
  ) {
    return idMatch;
  }
  return byHash.get(requestedHash);
}

/**
 * Resolves the metadata-only reference document against the current project asset library.
 *
 * Binary image data deliberately enters only this short-lived request boundary. Persistence keeps
 * asset IDs and hashes, so removing an asset cannot silently send stale or unrelated pixels.
 */
export function resolveStudioAiImageReferences(
  document: StudioAiImageReferenceDocument,
  assets: readonly StudioAiImageReferenceAssetSource[],
): StudioAiImageReferenceResolution {
  const canonical = hydrateStudioAiImageReferenceDocument(document);
  const byId = new Map<string, StudioAiImageReferenceAssetSource>();
  const byHash = new Map<string, StudioAiImageReferenceAssetSource>();
  for (const asset of assets) {
    if (!asset?.id || !asset.dataUrl) continue;
    byId.set(asset.id, asset);
    const hash = normalizeSha256(asset.contentHash);
    if (hash && !byHash.has(hash)) byHash.set(hash, asset);
  }

  const references: StudioAiResolvedImageReference[] = [];
  const missing: StudioAiMissingImageReference[] = [];
  const trackingAssetIds: string[] = [];
  const trackedIds = new Set<string>();

  for (const reference of canonical.references) {
    const requestedId = reference.asset.assetId;
    const requestedHash = normalizeSha256(reference.asset.sha256);
    const asset = resolveReferenceAsset(
      requestedId,
      requestedHash,
      byId,
      byHash,
    );
    if (!asset) {
      missing.push({
        referenceId: reference.id,
        role: reference.role,
        label: reference.label ?? requestedId ?? "삭제된 참조 에셋",
      });
      continue;
    }
    references.push({
      referenceId: reference.id,
      role: reference.role,
      dataUrl: asset.dataUrl,
      label: reference.label ?? asset.name,
      ...(reference.guidance ? { guidance: reference.guidance } : {}),
    });
    if (!trackedIds.has(asset.id)) {
      trackedIds.add(asset.id);
      trackingAssetIds.push(asset.id);
    }
  }

  return {
    references,
    missing,
    trackingAssetIds,
    hasCharacterReference: references.some(({ role }) => role === "character"),
  };
}
