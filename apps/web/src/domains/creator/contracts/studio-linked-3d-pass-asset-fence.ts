/**
 * Server-safe authority fence for Canvas-linked 3D raster passes.
 *
 * This module deliberately has no DOM or Studio renderer dependency.  It recognizes only the
 * persisted v2 linked-render receipt and the deterministic immutable work-asset row that carries
 * the PNG across devices.  Everything in the reserved `studio-opfs-cas:` namespace fails closed
 * unless it is the exact main-line element/receipt pair described below.
 */

import {
  STUDIO_WORK_ASSET_MAX_BYTES_BY_TYPE,
  STUDIO_WORK_ASSET_MAX_IMAGE_AXIS,
  STUDIO_WORK_ASSET_MAX_IMAGE_DECODED_BYTES,
} from "./studio-work-asset-contract";

export const STUDIO_LINKED_3D_PASS_SERVER_LOCATOR_PREFIX =
  "studio-opfs-cas:sha256:" as const;
export const STUDIO_LINKED_3D_PASS_SERVER_ASSET_ID_PREFIX =
  "linked3d-pass-sha256-" as const;

const RESERVED_LOCATOR_PREFIX = "studio-opfs-cas:";
const LOCATOR_PATTERN = /^studio-opfs-cas:sha256:([a-f0-9]{64})$/u;
const CLOUD_ASSET_ID_PATTERN = /^linked3d-pass-sha256-[a-f0-9]{64}$/u;
const SHA256_PATTERN = /^sha256:([a-f0-9]{64})$/u;
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:~-]{0,127}$/u;
const OBJECT_ID_PATTERN = /^obj\/[A-Za-z0-9][A-Za-z0-9._~-]{0,79}$/u;
const FORBIDDEN_IDS = new Set(["__proto__", "constructor", "prototype"]);
const LINKED_RENDER_ROLES = new Set(["color", "tone", "texture-line", "main-line"]);
const LINKED_RENDER_MAX_BYTES_PER_PAGE = 192 * 1024;
const LINKED_RENDER_MAX_CORRECTIONS_PER_LINK = 512;
const LINKED_RENDER_MAX_OBJECT_IDS = 512;
const MAX_TRAVERSED_CONTAINERS = 1_000_000;
const MAX_TRAVERSED_VALUES = 1_000_000;
const MAX_TRAVERSAL_DEPTH = 128;
const TEXT_ENCODER = new TextEncoder();

const LINK_KEYS = [
  "bundleId",
  "shotId",
  "sourceShotId",
  "stageSourceHash",
  "layers",
  "passRevision",
  "corrections",
] as const;
const PASS_REVISION_KEYS = [
  "revision",
  "sourceHash",
  "sceneHash",
  "cameraHash",
  "baseGeometryHash",
  "topologyHash",
  "objectIdentityHash",
  "objectStableIds",
  "passRootHash",
  "artifact",
] as const;
const ARTIFACT_KEYS = [
  "pass",
  "role",
  "contentHash",
  "byteSize",
  "mime",
  "width",
  "height",
  "locator",
] as const;

export type StudioLinked3dPassAssetFenceErrorCode =
  | "invalid-document"
  | "invalid-reserved-locator"
  | "receipt-mismatch"
  | "limit-exceeded"
  | "asset-missing"
  | "asset-mismatch";

export class StudioLinked3dPassAssetFenceError extends Error {
  public constructor(
    public readonly code: StudioLinked3dPassAssetFenceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "StudioLinked3dPassAssetFenceError";
  }
}

export interface CreatorWorkLinked3dJsonEnvelope {
  readonly cover: unknown;
  readonly pages: unknown;
  readonly doc: unknown;
}

export interface StudioLinked3dPassAssetRequirement {
  readonly assetId: `${typeof STUDIO_LINKED_3D_PASS_SERVER_ASSET_ID_PREFIX}${string}`;
  readonly contentHash: `sha256:${string}`;
  readonly rawSha256: string;
  readonly locator: `${typeof STUDIO_LINKED_3D_PASS_SERVER_LOCATOR_PREFIX}${string}`;
  readonly byteSize: number;
  readonly width: number;
  readonly height: number;
  readonly decodedRgbaBytes: number;
}

/** Metadata-only row projection. The payload is intentionally never materialized by this fence. */
export interface StudioLinked3dPassAssetRow {
  readonly workId: string;
  readonly assetId: string;
  readonly elementType: string;
  readonly mimeType: string;
  readonly descriptor: unknown;
  readonly byteSize: number;
  readonly sha256: string;
  readonly intrinsicWidth: number | null;
  readonly intrinsicHeight: number | null;
  readonly decodedRgbaBytes: number | null;
}

/** Linked-pass rows are retained until the owning work is deleted; generic upload GC cannot prove
 * absence from every retained creator_work_revision without replaying the complete revision set. */
export function isStudioLinked3dPassServerAssetId(
  value: unknown,
): value is `${typeof STUDIO_LINKED_3D_PASS_SERVER_ASSET_ID_PREFIX}${string}` {
  return typeof value === "string" && CLOUD_ASSET_ID_PATTERN.test(value);
}

interface ReservedOccurrence {
  readonly path: string;
  readonly value: string;
}

interface LinkedArtifactReceipt {
  readonly requirement: StudioLinked3dPassAssetRequirement;
  readonly elementPath: string;
  readonly artifactPath: string;
}

function fenceError(
  code: StudioLinked3dPassAssetFenceErrorCode,
  message: string,
): never {
  throw new StudioLinked3dPassAssetFenceError(code, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length
    && actual.every((key, index) => key === sortedExpected[index]);
}

function safeId(value: unknown): value is string {
  return typeof value === "string"
    && SAFE_ID_PATTERN.test(value)
    && !FORBIDDEN_IDS.has(value.toLowerCase());
}

function safeHash(value: unknown): value is `sha256:${string}` {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}

function finitePositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function serializedJsonByteLength(value: unknown): number {
  try {
    const serialized = JSON.stringify(value);
    if (typeof serialized !== "string") {
      fenceError("invalid-document", "linked 3D render index is not JSON serializable");
    }
    return TEXT_ENCODER.encode(serialized).byteLength;
  } catch (error) {
    if (error instanceof StudioLinked3dPassAssetFenceError) throw error;
    fenceError("invalid-document", "linked 3D render index is not JSON serializable");
  }
}

function pointerSegment(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function childPath(parent: string, key: string | number): string {
  return `${parent}/${pointerSegment(String(key))}`;
}

/**
 * Reads the same own data properties that JSON persistence can carry without invoking accessors.
 * Candidate work JSON must be cycle-free and accessor-free; either shape is outside the persisted
 * JSON authority and therefore fails closed before reserved-locator validation.
 */
function collectReservedOccurrences(value: unknown): readonly ReservedOccurrence[] {
  const occurrences: ReservedOccurrence[] = [];
  const ancestors = new Set<object>();
  let containers = 0;
  let traversedValues = 0;

  const visit = (candidate: unknown, path: string, depth: number): void => {
    traversedValues += 1;
    if (traversedValues > MAX_TRAVERSED_VALUES) {
      fenceError("limit-exceeded", "creator work JSON exceeds the linked-pass traversal budget");
    }
    if (typeof candidate === "string") {
      if (candidate.startsWith(RESERVED_LOCATOR_PREFIX)) {
        occurrences.push(Object.freeze({ path, value: candidate }));
      }
      return;
    }
    if (typeof candidate !== "object" || candidate === null) return;
    if (depth > MAX_TRAVERSAL_DEPTH) {
      fenceError("limit-exceeded", "creator work JSON nesting exceeds the linked-pass audit limit");
    }
    containers += 1;
    if (containers > MAX_TRAVERSED_CONTAINERS) {
      fenceError("limit-exceeded", "creator work JSON exceeds the linked-pass audit limit");
    }
    if (ancestors.has(candidate)) {
      fenceError("invalid-document", "creator work JSON contains a cycle");
    }
    ancestors.add(candidate);
    const descriptors = Object.getOwnPropertyDescriptors(candidate);
    const keys = Array.isArray(candidate)
      ? Object.keys(descriptors)
          .filter((key) => /^(?:0|[1-9]\d*)$/u.test(key))
          .sort((left, right) => Number(left) - Number(right))
      : Object.keys(descriptors).sort();
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor || !("value" in descriptor)) {
        fenceError("invalid-document", "creator work JSON contains an accessor property");
      }
      visit(descriptor.value, childPath(path, key), depth + 1);
    }
    ancestors.delete(candidate);
  };

  visit(value, "", 0);
  return Object.freeze(occurrences);
}

function parseArtifactRequirement(value: unknown): StudioLinked3dPassAssetRequirement {
  if (!isRecord(value) || !hasExactKeys(value, ARTIFACT_KEYS)) {
    fenceError("receipt-mismatch", "linked 3D pass artifact receipt is not exact");
  }
  const locatorMatch = typeof value.locator === "string"
    ? LOCATOR_PATTERN.exec(value.locator)
    : null;
  const contentHashMatch = typeof value.contentHash === "string"
    ? SHA256_PATTERN.exec(value.contentHash)
    : null;
  const decodedRgbaBytes = typeof value.width === "number" && typeof value.height === "number"
    ? value.width * value.height * 4
    : Number.NaN;
  if (
    value.pass !== "line"
    || value.role !== "main-line"
    || value.mime !== "image/png"
    || !locatorMatch
    || !contentHashMatch
    || locatorMatch[1] !== contentHashMatch[1]
    || !finitePositiveInteger(value.byteSize)
    || value.byteSize > STUDIO_WORK_ASSET_MAX_BYTES_BY_TYPE.image
    || !finitePositiveInteger(value.width)
    || !finitePositiveInteger(value.height)
    || value.width > STUDIO_WORK_ASSET_MAX_IMAGE_AXIS
    || value.height > STUDIO_WORK_ASSET_MAX_IMAGE_AXIS
    || !Number.isSafeInteger(decodedRgbaBytes)
    || decodedRgbaBytes > STUDIO_WORK_ASSET_MAX_IMAGE_DECODED_BYTES
  ) {
    fenceError("receipt-mismatch", "linked 3D pass artifact receipt does not match cloud PNG limits");
  }
  const rawSha256 = locatorMatch[1]!;
  return Object.freeze({
    assetId: `${STUDIO_LINKED_3D_PASS_SERVER_ASSET_ID_PREFIX}${rawSha256}`,
    contentHash: `sha256:${rawSha256}`,
    rawSha256,
    locator: `${STUDIO_LINKED_3D_PASS_SERVER_LOCATOR_PREFIX}${rawSha256}`,
    byteSize: value.byteSize,
    width: value.width,
    height: value.height,
    decodedRgbaBytes,
  });
}

function assertPassRevisionShape(value: unknown): asserts value is Record<string, unknown> {
  if (!isRecord(value) || !hasExactKeys(value, PASS_REVISION_KEYS)) {
    fenceError("receipt-mismatch", "linked 3D pass revision receipt is not exact");
  }
  if (
    !finitePositiveInteger(value.revision)
    || !safeHash(value.sourceHash)
    || !safeHash(value.sceneHash)
    || !safeHash(value.cameraHash)
    || !safeHash(value.baseGeometryHash)
    || !safeHash(value.topologyHash)
    || !safeHash(value.objectIdentityHash)
    || !safeHash(value.passRootHash)
    || !Array.isArray(value.objectStableIds)
    || value.objectStableIds.length > LINKED_RENDER_MAX_OBJECT_IDS
    || value.objectStableIds.some((id) => typeof id !== "string" || !OBJECT_ID_PATTERN.test(id))
    || new Set(value.objectStableIds).size !== value.objectStableIds.length
  ) {
    fenceError("receipt-mismatch", "linked 3D pass revision identity is malformed");
  }
}

function parsePageReceipts(
  doc: Record<string, unknown>,
): readonly LinkedArtifactReceipt[] {
  if (!Array.isArray(doc.pagesList)) {
    fenceError("receipt-mismatch", "reserved linked 3D locators require a pagesList");
  }
  const receipts: LinkedArtifactReceipt[] = [];
  for (let pageIndex = 0; pageIndex < doc.pagesList.length; pageIndex += 1) {
    const page = doc.pagesList[pageIndex];
    if (!isRecord(page) || page.linked3dRender === undefined) continue;
    const linked = page.linked3dRender;
    if (
      !isRecord(linked)
      || !hasExactKeys(linked, ["kind", "version", "authority", "links"])
      || linked.kind !== "toonspectrum.studio-linked-3d-render"
      || linked.version !== 2
      || linked.authority !== "studio-project-linked-3d-pass-index"
      || !Array.isArray(linked.links)
      || serializedJsonByteLength(linked) > LINKED_RENDER_MAX_BYTES_PER_PAGE
      || !Array.isArray(page.elements)
    ) {
      fenceError("receipt-mismatch", "linked 3D render index is malformed");
    }
    const elementIndexesById = new Map<string, number[]>();
    for (let elementIndex = 0; elementIndex < page.elements.length; elementIndex += 1) {
      const element = page.elements[elementIndex];
      if (!isRecord(element) || typeof element.id !== "string") continue;
      const indexes = elementIndexesById.get(element.id) ?? [];
      indexes.push(elementIndex);
      elementIndexesById.set(element.id, indexes);
    }
    const claimedElementIds = new Set<string>();
    for (let linkIndex = 0; linkIndex < linked.links.length; linkIndex += 1) {
      const link = linked.links[linkIndex];
      if (
        !isRecord(link)
        || !hasExactKeys(link, LINK_KEYS)
        || !safeId(link.bundleId)
        || !safeId(link.shotId)
        || (link.sourceShotId !== null && !safeId(link.sourceShotId))
        || !safeHash(link.stageSourceHash)
        || !Array.isArray(link.layers)
        || link.layers.length < 1
        || link.layers.length > LINKED_RENDER_ROLES.size
        || !Array.isArray(link.corrections)
        || link.corrections.length > LINKED_RENDER_MAX_CORRECTIONS_PER_LINK
      ) {
        fenceError("receipt-mismatch", "linked 3D render link is malformed");
      }
      const layerIds = new Set<string>();
      const layerRoles = new Set<string>();
      let mainLineElementId: string | null = null;
      for (const layer of link.layers) {
        if (
          !isRecord(layer)
          || !hasExactKeys(layer, ["elementId", "role"])
          || !safeId(layer.elementId)
          || typeof layer.role !== "string"
          || !LINKED_RENDER_ROLES.has(layer.role)
          || layerIds.has(layer.elementId)
          || layerRoles.has(layer.role)
        ) {
          fenceError("receipt-mismatch", "linked 3D render layer reference is malformed");
        }
        layerIds.add(layer.elementId);
        layerRoles.add(layer.role);
        if (layer.role === "main-line") mainLineElementId = layer.elementId;
      }
      if (!mainLineElementId || claimedElementIds.has(mainLineElementId)) {
        fenceError("receipt-mismatch", "linked 3D main-line element ownership is ambiguous");
      }
      claimedElementIds.add(mainLineElementId);
      assertPassRevisionShape(link.passRevision);
      if (link.passRevision.sourceHash !== link.stageSourceHash) {
        fenceError("receipt-mismatch", "linked 3D stage and pass source hashes differ");
      }
      const requirement = parseArtifactRequirement(link.passRevision.artifact);
      const elementIndexes = elementIndexesById.get(mainLineElementId);
      if (elementIndexes?.length !== 1) {
        fenceError("receipt-mismatch", "linked 3D main-line element is missing or duplicated");
      }
      const elementIndex = elementIndexes[0]!;
      const element = page.elements[elementIndex];
      if (
        !isRecord(element)
        || element.type !== "image"
        || element.src !== requirement.locator
      ) {
        fenceError("receipt-mismatch", "linked 3D main-line source does not match its receipt");
      }
      receipts.push(Object.freeze({
        requirement,
        elementPath: `/doc/pagesList/${pageIndex}/elements/${elementIndex}/src`,
        artifactPath:
          `/doc/pagesList/${pageIndex}/linked3dRender/links/${linkIndex}/passRevision/artifact/locator`,
      }));
    }
  }
  return Object.freeze(receipts);
}

function sameRequirement(
  left: StudioLinked3dPassAssetRequirement,
  right: StudioLinked3dPassAssetRequirement,
): boolean {
  return left.assetId === right.assetId
    && left.contentHash === right.contentHash
    && left.rawSha256 === right.rawSha256
    && left.locator === right.locator
    && left.byteSize === right.byteSize
    && left.width === right.width
    && left.height === right.height
    && left.decodedRgbaBytes === right.decodedRgbaBytes;
}

/**
 * Deep-scans all JSON-bearing creator_work fields and returns the unique immutable PNG rows that
 * must already exist.  A valid locator occurs exactly twice per link: the main-line `src` and its
 * page-owned `passRevision.artifact.locator` receipt.
 */
export function extractStudioLinked3dPassAssetRequirements(
  envelope: CreatorWorkLinked3dJsonEnvelope,
): readonly StudioLinked3dPassAssetRequirement[] {
  const occurrences = collectReservedOccurrences(envelope);
  if (occurrences.length === 0) return Object.freeze([]);
  if (!isRecord(envelope.doc)) {
    fenceError("invalid-reserved-locator", "reserved linked 3D locator is outside a Studio document");
  }
  const receipts = parsePageReceipts(envelope.doc);
  const allowed = new Map<string, string>();
  const byAssetId = new Map<string, StudioLinked3dPassAssetRequirement>();
  for (const receipt of receipts) {
    if (allowed.has(receipt.elementPath) || allowed.has(receipt.artifactPath)) {
      fenceError("receipt-mismatch", "linked 3D locator path is claimed more than once");
    }
    allowed.set(receipt.elementPath, receipt.requirement.locator);
    allowed.set(receipt.artifactPath, receipt.requirement.locator);
    const existing = byAssetId.get(receipt.requirement.assetId);
    if (existing && !sameRequirement(existing, receipt.requirement)) {
      fenceError("receipt-mismatch", "one linked 3D content hash has conflicting receipts");
    }
    byAssetId.set(receipt.requirement.assetId, receipt.requirement);
  }
  if (occurrences.length !== allowed.size) {
    fenceError("invalid-reserved-locator", "reserved linked 3D locator is not an exact receipt pair");
  }
  for (const occurrence of occurrences) {
    if (allowed.get(occurrence.path) !== occurrence.value || !LOCATOR_PATTERN.test(occurrence.value)) {
      fenceError(
        "invalid-reserved-locator",
        `reserved linked 3D locator is not allowed at ${occurrence.path || "/"}`,
      );
    }
  }
  return Object.freeze([...byAssetId.values()].sort((left, right) =>
    left.assetId.localeCompare(right.assetId)));
}

function exactCloudDescriptor(
  value: unknown,
  requirement: StudioLinked3dPassAssetRequirement,
): boolean {
  if (!isRecord(value) || !hasExactKeys(value, ["version", "element"]) || value.version !== 1) {
    return false;
  }
  const element = value.element;
  return isRecord(element)
    && hasExactKeys(element, ["id", "type", "x", "y", "width", "height", "rotation"])
    && element.id === requirement.assetId
    && element.type === "image"
    && element.x === 0
    && element.y === 0
    && element.width === requirement.width
    && element.height === requirement.height
    && element.rotation === 0;
}

/** Verifies the exact same-work immutable metadata rows returned inside the caller's transaction. */
export function assertStudioLinked3dPassAssetRows(input: {
  readonly workId: string;
  readonly requirements: readonly StudioLinked3dPassAssetRequirement[];
  readonly rows: readonly StudioLinked3dPassAssetRow[];
}): void {
  const requiredById = new Map<string, StudioLinked3dPassAssetRequirement>(
    input.requirements.map((requirement) => [
      requirement.assetId,
      requirement,
    ] as const),
  );
  const rowsById = new Map<string, StudioLinked3dPassAssetRow>();
  for (const row of input.rows) {
    if (
      row.workId !== input.workId
      || !requiredById.has(row.assetId)
      || rowsById.has(row.assetId)
    ) {
      fenceError("asset-mismatch", "linked 3D asset query returned an unexpected row");
    }
    rowsById.set(row.assetId, row);
  }
  for (const requirement of input.requirements) {
    const row = rowsById.get(requirement.assetId);
    if (!row) {
      fenceError("asset-missing", "linked 3D pass immutable cloud asset is missing");
    }
    if (
      row.elementType !== "image"
      || row.mimeType !== "image/png"
      || row.byteSize !== requirement.byteSize
      || row.sha256 !== requirement.rawSha256
      || row.intrinsicWidth !== requirement.width
      || row.intrinsicHeight !== requirement.height
      || row.decodedRgbaBytes !== requirement.decodedRgbaBytes
      || !exactCloudDescriptor(row.descriptor, requirement)
    ) {
      fenceError("asset-mismatch", "linked 3D pass immutable cloud asset does not match its receipt");
    }
  }
}
