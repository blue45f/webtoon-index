import { sha256HexPortable } from "../studio-sha256";

import {
  STUDIO_DRY_MEDIA_UNION_COMPOSABLE_PROGRAM_DIGEST,
  STUDIO_DRY_MEDIA_UNION_COMPOSABLE_PROGRAM_VERSION,
} from "./studio-brush-dynamics";
import {
  STUDIO_DRY_MEDIA_UNION_CONTINUATION_MAX_GROUP_BYTES,
  STUDIO_DRY_MEDIA_UNION_CONTINUATION_TILE_SIZE,
  hydrateStudioDryMediaUnionContinuationPage,
  validateStudioDryMediaUnionContinuationPage,
  type StudioDryMediaUnionContinuationPage,
  type StudioDryMediaUnionPagedRootReceipt,
} from "./studio-dry-media-union-continuation-protocol";

import type { StudioFreehandInputBinaryCasStore } from "../studio-freehand-input-binary-spool-opfs-store";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true });
const SHA256_HEX = /^[a-f0-9]{64}$/u;
const MERKLE_FANOUT = 64;
const MAX_ROOT_BYTES = 64 * 1024;
const MAX_INDEX_BYTES = 1024 * 1024;
const MAX_METADATA_BYTES = 8 * 1024 * 1024;
const MAX_MERKLE_DEPTH = 16;
const STROKE_ID = /^[a-zA-Z0-9._-]{1,192}$/u;

export interface StudioDryMediaUnionContinuationStoredPage {
  readonly digest: string;
  readonly byteLength: number;
  readonly pageIndex: number;
  readonly firstGroupIndex: number;
  readonly groupCount: number;
  readonly contourCount: number;
  readonly coordinateCount: number;
}

export interface StudioDryMediaUnionContinuationStoredBitmapPage {
  readonly digest: string;
  readonly byteLength: number;
  readonly tileX: number;
  readonly tileY: number;
  readonly width: number;
  readonly height: number;
}

export interface StudioDryMediaUnionContinuationHydratedBitmapPage
  extends StudioDryMediaUnionContinuationStoredBitmapPage {
  readonly rgba: Uint8ClampedArray<ArrayBuffer>;
}

export interface StudioDryMediaUnionContinuationPresentationMetadata {
  readonly width: number;
  readonly height: number;
  readonly transform: readonly [number, number, number, number, number, number];
  readonly color: string;
}

export interface StudioDryMediaUnionContinuationOpenedRoot {
  readonly receipt: StudioDryMediaUnionPagedRootReceipt;
  readonly metadata: StudioDryMediaUnionContinuationPresentationMetadata;
  readonly contourPages: readonly StudioDryMediaUnionContinuationStoredPage[];
  readonly bitmapPages: readonly StudioDryMediaUnionContinuationStoredBitmapPage[];
}

export interface StudioDryMediaUnionContinuationReadOptions {
  readonly signal?: AbortSignal;
}

export interface StudioDryMediaUnionContinuationSealInput {
  readonly strokeId: string;
  readonly generation: number;
  readonly sequence: number;
  readonly presentationGeneration: number;
  readonly contourPages: readonly StudioDryMediaUnionContinuationStoredPage[];
  readonly bitmapPages: readonly StudioDryMediaUnionContinuationStoredBitmapPage[];
  readonly logicalByteLength: number;
  readonly slabCapacityByteLength: number;
  readonly residentByteLength: number;
  readonly metadata: StudioDryMediaUnionContinuationPresentationMetadata;
}

export interface StudioDryMediaUnionContinuationStore {
  putContourPage(
    page: StudioDryMediaUnionContinuationPage,
  ): Promise<StudioDryMediaUnionContinuationStoredPage>;
  putBitmapPage(input: Readonly<{
    tileX: number;
    tileY: number;
    width: number;
    height: number;
    rgba: Uint8ClampedArray;
  }>): Promise<StudioDryMediaUnionContinuationStoredBitmapPage>;
  getContourPage(
    page: StudioDryMediaUnionContinuationStoredPage,
    options?: StudioDryMediaUnionContinuationReadOptions,
  ): Promise<StudioDryMediaUnionContinuationPage | null>;
  getBitmapPage(
    page: StudioDryMediaUnionContinuationStoredBitmapPage,
    options?: StudioDryMediaUnionContinuationReadOptions,
  ): Promise<StudioDryMediaUnionContinuationHydratedBitmapPage | null>;
  seal(input: StudioDryMediaUnionContinuationSealInput): Promise<StudioDryMediaUnionPagedRootReceipt>;
  open(
    rootDigest: string,
    options?: StudioDryMediaUnionContinuationReadOptions,
  ): Promise<StudioDryMediaUnionContinuationOpenedRoot | null>;
  /** Streams every referenced page through its bounded decoder without retaining the stroke. */
  verify(
    rootDigest: string,
    options?: StudioDryMediaUnionContinuationReadOptions,
  ): Promise<StudioDryMediaUnionPagedRootReceipt | null>;
  reopen(
    rootDigest: string,
    options?: StudioDryMediaUnionContinuationReadOptions,
  ): Promise<StudioDryMediaUnionPagedRootReceipt | null>;
  close(): Promise<void>;
}

function canonicalBytes(value: unknown): Uint8Array {
  return textEncoder.encode(JSON.stringify(value));
}

function dataRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (
      Object.getOwnPropertySymbols(value).length > 0
      || Object.values(descriptors).some((descriptor) => !("value" in descriptor))
    ) return null;
    return Object.fromEntries(
      Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]),
    );
  } catch {
    return null;
  }
}

function exactDataRecord(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> | null {
  const record = dataRecord(value);
  if (!record) return null;
  const actualKeys = Object.keys(record);
  return actualKeys.length === keys.length && actualKeys.every((key) => keys.includes(key))
    ? record
    : null;
}

function denseDataArray(value: unknown, maximumLength: number): readonly unknown[] | null {
  if (!Array.isArray(value)) return null;
  let descriptors: Record<string, PropertyDescriptor>;
  try {
    descriptors = Object.getOwnPropertyDescriptors(value) as Record<
      string,
      PropertyDescriptor
    >;
  } catch {
    return null;
  }
  const lengthDescriptor = descriptors.length;
  if (!lengthDescriptor || !("value" in lengthDescriptor)) return null;
  const length = lengthDescriptor.value;
  if (!Number.isSafeInteger(length) || length < 0 || length > maximumLength) return null;
  if (Object.keys(descriptors).length !== length + 1) return null;
  const result: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor)) return null;
    result.push(descriptor.value);
  }
  return result;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  throw new DOMException("Dry-media continuation read was aborted.", "AbortError");
}

function parseCanonical(bytes: Uint8Array, maximumByteLength: number): unknown | null {
  if (bytes.byteLength <= 0 || bytes.byteLength > maximumByteLength) return null;
  try {
    return JSON.parse(textDecoder.decode(bytes));
  } catch {
    return null;
  }
}

async function putCanonical(
  store: StudioFreehandInputBinaryCasStore,
  kind: "index" | "metadata" | "root",
  value: unknown,
  maximumByteLength: number,
): Promise<Readonly<{ digest: string; bytes: Uint8Array }>> {
  const bytes = canonicalBytes(value);
  if (bytes.byteLength <= 0 || bytes.byteLength > maximumByteLength) {
    throw new RangeError(`Dry-media ${kind} payload exceeds its canonical byte budget.`);
  }
  const digest = sha256HexPortable(bytes);
  await store.putCas(kind, digest, bytes);
  return { digest, bytes };
}

function validNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function snapshotRootReceipt(value: unknown): StudioDryMediaUnionPagedRootReceipt | null {
  const keys = [
    "contract",
    "version",
    "strokeId",
    "generation",
    "sequence",
    "programVersion",
    "programDigest",
    "rootDigest",
    "contentDigest",
    "metadataDigest",
    "pageCount",
    "indexPageCount",
    "bitmapPageCount",
    "groupCount",
    "contourCount",
    "coordinateCount",
    "logicalByteLength",
    "pagedByteLength",
    "residentByteLength",
    "hydratedByteLength",
    "inflightByteLength",
    "slabCapacityByteLength",
    "fragmentationByteLength",
    "presentationGeneration",
  ] as const;
  const receipt = exactDataRecord(value, keys);
  if (
    !receipt
    ||
    receipt.contract !== "studio-dry-media-union-paged-root-v1"
    || receipt.version !== 1
    || typeof receipt.strokeId !== "string"
    || !STROKE_ID.test(receipt.strokeId)
    || !validNonNegativeSafeInteger(receipt.generation)
    || !validNonNegativeSafeInteger(receipt.sequence)
    || receipt.programVersion !== STUDIO_DRY_MEDIA_UNION_COMPOSABLE_PROGRAM_VERSION
    || receipt.programDigest !== STUDIO_DRY_MEDIA_UNION_COMPOSABLE_PROGRAM_DIGEST
    || typeof receipt.rootDigest !== "string"
    || !SHA256_HEX.test(receipt.rootDigest)
    || typeof receipt.contentDigest !== "string"
    || !SHA256_HEX.test(receipt.contentDigest)
    || typeof receipt.metadataDigest !== "string"
    || !SHA256_HEX.test(receipt.metadataDigest)
  ) return null;
  for (const field of [
    "pageCount",
    "indexPageCount",
    "bitmapPageCount",
    "groupCount",
    "contourCount",
    "coordinateCount",
    "logicalByteLength",
    "pagedByteLength",
    "residentByteLength",
    "hydratedByteLength",
    "inflightByteLength",
    "slabCapacityByteLength",
    "fragmentationByteLength",
    "presentationGeneration",
  ] as const) {
    if (!validNonNegativeSafeInteger(receipt[field])) return null;
  }
  return Object.freeze(receipt as unknown as StudioDryMediaUnionPagedRootReceipt);
}

function snapshotStoredContourPage(
  value: unknown,
): StudioDryMediaUnionContinuationStoredPage | null {
  const page = exactDataRecord(value, [
    "digest",
    "byteLength",
    "pageIndex",
    "firstGroupIndex",
    "groupCount",
    "contourCount",
    "coordinateCount",
  ]);
  if (
    !page
    || typeof page.digest !== "string"
    || !SHA256_HEX.test(page.digest)
    || !validNonNegativeSafeInteger(page.byteLength)
    || page.byteLength <= 0
    || page.byteLength > STUDIO_DRY_MEDIA_UNION_CONTINUATION_MAX_GROUP_BYTES
    || !validNonNegativeSafeInteger(page.pageIndex)
    || page.pageIndex > 0xffff_ffff
    || !validNonNegativeSafeInteger(page.firstGroupIndex)
    || page.firstGroupIndex > 0xffff_ffff
    || !validNonNegativeSafeInteger(page.groupCount)
    || page.groupCount <= 0
    || !validNonNegativeSafeInteger(page.contourCount)
    || page.contourCount <= 0
    || !validNonNegativeSafeInteger(page.coordinateCount)
    || page.coordinateCount < 6
  ) return null;
  return Object.freeze(page as unknown as StudioDryMediaUnionContinuationStoredPage);
}

function snapshotStoredBitmapPage(
  value: unknown,
): StudioDryMediaUnionContinuationStoredBitmapPage | null {
  const page = exactDataRecord(value, [
    "digest",
    "byteLength",
    "tileX",
    "tileY",
    "width",
    "height",
  ]);
  if (
    !page
    || typeof page.digest !== "string"
    || !SHA256_HEX.test(page.digest)
    || !validNonNegativeSafeInteger(page.byteLength)
    || page.byteLength <= 0
    || page.byteLength > MAX_ROOT_BYTES
      + STUDIO_DRY_MEDIA_UNION_CONTINUATION_TILE_SIZE ** 2 * 4 + 4
    || !validNonNegativeSafeInteger(page.tileX)
    || !validNonNegativeSafeInteger(page.tileY)
    || !validNonNegativeSafeInteger(page.width)
    || !validNonNegativeSafeInteger(page.height)
    || page.width <= 0
    || page.height <= 0
    || page.width > STUDIO_DRY_MEDIA_UNION_CONTINUATION_TILE_SIZE
    || page.height > STUDIO_DRY_MEDIA_UNION_CONTINUATION_TILE_SIZE
  ) return null;
  return Object.freeze(page as unknown as StudioDryMediaUnionContinuationStoredBitmapPage);
}

function snapshotPresentationMetadata(
  value: unknown,
): StudioDryMediaUnionContinuationPresentationMetadata | null {
  const metadata = exactDataRecord(value, ["width", "height", "transform", "color"]);
  const transform = metadata ? denseDataArray(metadata.transform, 6) : null;
  if (
    !metadata
    || !validNonNegativeSafeInteger(metadata.width)
    || metadata.width <= 0
    || !validNonNegativeSafeInteger(metadata.height)
    || metadata.height <= 0
    || !transform
    || transform.length !== 6
    || !transform.every((entry) => typeof entry === "number" && Number.isFinite(entry))
    || typeof metadata.color !== "string"
    || metadata.color.length <= 0
    || metadata.color.length > 128
  ) return null;
  return Object.freeze({
    width: metadata.width,
    height: metadata.height,
    transform: Object.freeze([...transform]) as unknown as readonly [
      number,
      number,
      number,
      number,
      number,
      number,
    ],
    color: metadata.color,
  });
}

function bitmapPageFitsPresentation(
  page: StudioDryMediaUnionContinuationStoredBitmapPage,
  presentation: StudioDryMediaUnionContinuationPresentationMetadata,
): boolean {
  const x = page.tileX * STUDIO_DRY_MEDIA_UNION_CONTINUATION_TILE_SIZE;
  const y = page.tileY * STUDIO_DRY_MEDIA_UNION_CONTINUATION_TILE_SIZE;
  return validNonNegativeSafeInteger(x)
    && validNonNegativeSafeInteger(y)
    && validNonNegativeSafeInteger(x + page.width)
    && validNonNegativeSafeInteger(y + page.height)
    && x < presentation.width
    && y < presentation.height
    && x + page.width <= presentation.width
    && y + page.height <= presentation.height;
}

interface MerkleLeaf {
  readonly digest: string;
  readonly byteLength: number;
  readonly kind: "contour" | "bitmap";
}

interface VerifiedMerkle {
  readonly indexPageCount: number;
  readonly indexByteLength: number;
  readonly leaves: readonly MerkleLeaf[];
}

async function verifyMerkleIndexes(
  store: StudioFreehandInputBinaryCasStore,
  rootDigest: string,
  expectedIndexPageCount: number,
  expectedLeafCount: number,
  signal: AbortSignal | undefined,
): Promise<VerifiedMerkle | null> {
  if (
    !SHA256_HEX.test(rootDigest)
    || !validNonNegativeSafeInteger(expectedIndexPageCount)
    || expectedIndexPageCount <= 0
    || !validNonNegativeSafeInteger(expectedLeafCount)
    || expectedLeafCount <= 0
  ) return null;
  const visited = new Set<string>();
  const leaves: MerkleLeaf[] = [];
  let indexPageCount = 0;
  let indexByteLength = 0;
  const walk = async (
    digest: string,
    expectedLevel: number | null,
  ): Promise<Readonly<{ leafCount: number; byteLength: number }> | null> => {
    throwIfAborted(signal);
    if (
      !SHA256_HEX.test(digest)
      || visited.has(digest)
      || indexPageCount >= expectedIndexPageCount
    ) return null;
    visited.add(digest);
    const bytes = await store.getCas("index", digest);
    throwIfAborted(signal);
    if (
      !bytes
      || bytes.byteLength <= 0
      || bytes.byteLength > MAX_INDEX_BYTES
      || sha256HexPortable(bytes) !== digest
    ) return null;
    const parsed = parseCanonical(bytes, MAX_INDEX_BYTES);
    const node = exactDataRecord(parsed, ["domain", "programDigest", "level", "children"]);
    const children = node ? denseDataArray(node.children, MERKLE_FANOUT) : null;
    if (
      !node
      || node.domain !== "toonspectrum/studio-dry-media-union/index-v1"
      || node.programDigest !== STUDIO_DRY_MEDIA_UNION_COMPOSABLE_PROGRAM_DIGEST
      || !validNonNegativeSafeInteger(node.level)
      || node.level > MAX_MERKLE_DEPTH
      || (expectedLevel !== null && node.level !== expectedLevel)
      || !children
      || children.length === 0
    ) return null;
    indexPageCount += 1;
    indexByteLength += bytes.byteLength;
    if (!Number.isSafeInteger(indexByteLength)) return null;
    let leafCount = 0;
    for (const rawChild of children) {
      const child = exactDataRecord(rawChild, ["digest", "byteLength", "leafCount", "kind"]);
      if (
        !child
        || typeof child.digest !== "string"
        || !SHA256_HEX.test(child.digest)
        || !validNonNegativeSafeInteger(child.byteLength)
        || child.byteLength <= 0
        || !validNonNegativeSafeInteger(child.leafCount)
        || child.leafCount <= 0
      ) return null;
      if (node.level === 0) {
        if (
          child.leafCount !== 1
          || (child.kind !== "contour" && child.kind !== "bitmap")
          || leaves.length >= expectedLeafCount
        ) return null;
        leaves.push(Object.freeze({
          digest: child.digest,
          byteLength: child.byteLength,
          kind: child.kind,
        }));
        leafCount += 1;
      } else {
        if (child.kind !== "index") return null;
        const nested = await walk(child.digest, node.level - 1);
        if (
          !nested
          || nested.leafCount !== child.leafCount
          || nested.byteLength !== child.byteLength
        ) return null;
        leafCount += nested.leafCount;
      }
      if (!Number.isSafeInteger(leafCount) || leafCount > expectedLeafCount) return null;
    }
    return Object.freeze({ leafCount, byteLength: bytes.byteLength });
  };
  const root = await walk(rootDigest, null);
  if (
    !root
    || root.leafCount !== expectedLeafCount
    || indexPageCount !== expectedIndexPageCount
    || leaves.length !== expectedLeafCount
  ) return null;
  return Object.freeze({
    indexPageCount,
    indexByteLength,
    leaves: Object.freeze(leaves),
  });
}

async function buildMerkleIndexes(
  store: StudioFreehandInputBinaryCasStore,
  leaves: readonly MerkleLeaf[],
): Promise<Readonly<{
  digest: string;
  indexPageCount: number;
  indexByteLength: number;
}>> {
  let level = 0;
  let nodes: Readonly<{
    digest: string;
    byteLength: number;
    leafCount: number;
    kind: "contour" | "bitmap" | "index";
  }>[] = leaves.map((leaf) => ({
    digest: leaf.digest,
    byteLength: leaf.byteLength,
    leafCount: 1,
    kind: leaf.kind,
  }));
  let indexPageCount = 0;
  let indexByteLength = 0;
  while (nodes.length !== 1 || level === 0) {
    const next: typeof nodes = [];
    for (let cursor = 0; cursor < nodes.length; cursor += MERKLE_FANOUT) {
      const children = nodes.slice(cursor, cursor + MERKLE_FANOUT);
      const encoded = await putCanonical(store, "index", {
        domain: "toonspectrum/studio-dry-media-union/index-v1",
        programDigest: STUDIO_DRY_MEDIA_UNION_COMPOSABLE_PROGRAM_DIGEST,
        level,
        children,
      }, MAX_INDEX_BYTES);
      indexPageCount += 1;
      indexByteLength += encoded.bytes.byteLength;
      next.push({
        digest: encoded.digest,
        byteLength: encoded.bytes.byteLength,
        leafCount: children.reduce((sum, child) => sum + child.leafCount, 0),
        kind: "index",
      });
    }
    nodes = next;
    level += 1;
  }
  return {
    digest: nodes[0]!.digest,
    indexPageCount,
    indexByteLength,
  };
}

export function createStudioDryMediaUnionContinuationStore(
  cas: StudioFreehandInputBinaryCasStore,
): StudioDryMediaUnionContinuationStore {
  let closed = false;
  const issuedContourPages = new WeakSet<object>();
  const issuedBitmapPages = new WeakSet<object>();
  const assertOpen = (): void => {
    if (closed) throw new Error("studio-dry-media-union-store-closed");
  };
  return {
    async putContourPage(page) {
      assertOpen();
      if (!validateStudioDryMediaUnionContinuationPage(page)) {
        throw new TypeError("Invalid dry-media contour page.");
      }
      const bytes = new Uint8Array(page.buffer.slice(0));
      const digest = sha256HexPortable(bytes);
      const stored = Object.freeze({
        digest,
        byteLength: bytes.byteLength,
        pageIndex: page.pageIndex,
        firstGroupIndex: page.firstGroupIndex,
        groupCount: page.stationIndexes.length,
        contourCount: page.contourCoordinateOffsets.length - 1,
        coordinateCount: page.coordinates.length,
      });
      await cas.putCas("page", digest, bytes);
      issuedContourPages.add(stored);
      return stored;
    },
    async putBitmapPage(inputCandidate) {
      assertOpen();
      const input = exactDataRecord(inputCandidate, [
        "tileX",
        "tileY",
        "width",
        "height",
        "rgba",
      ]);
      if (
        !input
        || !validNonNegativeSafeInteger(input.tileX)
        || !validNonNegativeSafeInteger(input.tileY)
        || !validNonNegativeSafeInteger(input.width)
        || !validNonNegativeSafeInteger(input.height)
        || input.width <= 0
        || input.height <= 0
        || input.width > STUDIO_DRY_MEDIA_UNION_CONTINUATION_TILE_SIZE
        || input.height > STUDIO_DRY_MEDIA_UNION_CONTINUATION_TILE_SIZE
        || !(input.rgba instanceof Uint8ClampedArray)
        || input.rgba.length !== input.width * input.height * 4
      ) throw new TypeError("Invalid dry-media bitmap tile page.");
      const header = canonicalBytes({
        domain: "toonspectrum/studio-dry-media-union/bitmap-page-v1",
        programDigest: STUDIO_DRY_MEDIA_UNION_COMPOSABLE_PROGRAM_DIGEST,
        tileX: input.tileX,
        tileY: input.tileY,
        width: input.width,
        height: input.height,
      });
      const bytes = new Uint8Array(4 + header.byteLength + input.rgba.byteLength);
      new DataView(bytes.buffer).setUint32(0, header.byteLength, true);
      bytes.set(header, 4);
      bytes.set(input.rgba, 4 + header.byteLength);
      const digest = sha256HexPortable(bytes);
      await cas.putCas("page", digest, bytes);
      const stored = Object.freeze({
        digest,
        byteLength: bytes.byteLength,
        tileX: input.tileX,
        tileY: input.tileY,
        width: input.width,
        height: input.height,
      });
      issuedBitmapPages.add(stored);
      return stored;
    },
    async getContourPage(pageCandidate, options = {}) {
      assertOpen();
      const page = snapshotStoredContourPage(pageCandidate);
      throwIfAborted(options.signal);
      if (!page) return null;
      const bytes = await cas.getCas("page", page.digest);
      throwIfAborted(options.signal);
      if (
        !bytes
        || bytes.byteLength !== page.byteLength
        || sha256HexPortable(bytes) !== page.digest
      ) return null;
      const exactBuffer = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
        ? bytes.buffer
        : bytes.slice().buffer;
      const hydrated = hydrateStudioDryMediaUnionContinuationPage(exactBuffer);
      if (
        !hydrated
        || hydrated.pageIndex !== page.pageIndex
        || hydrated.firstGroupIndex !== page.firstGroupIndex
        || hydrated.stationIndexes.length !== page.groupCount
        || hydrated.contourCoordinateOffsets.length - 1 !== page.contourCount
        || hydrated.coordinates.length !== page.coordinateCount
      ) return null;
      return hydrated;
    },
    async getBitmapPage(pageCandidate, options = {}) {
      assertOpen();
      const page = snapshotStoredBitmapPage(pageCandidate);
      throwIfAborted(options.signal);
      if (
        !page
      ) return null;
      const bytes = await cas.getCas("page", page.digest);
      throwIfAborted(options.signal);
      if (
        !bytes
        || bytes.byteLength !== page.byteLength
        || sha256HexPortable(bytes) !== page.digest
        || bytes.byteLength < 5
      ) return null;
      const headerLength = new DataView(
        bytes.buffer,
        bytes.byteOffset,
        Math.min(bytes.byteLength, 4),
      ).getUint32(0, true);
      if (
        headerLength <= 0
        || headerLength > MAX_ROOT_BYTES
        || 4 + headerLength > bytes.byteLength
      ) return null;
      let header: unknown;
      try {
        header = JSON.parse(textDecoder.decode(bytes.subarray(4, 4 + headerLength)));
      } catch {
        return null;
      }
      const metadata = exactDataRecord(header, [
        "domain",
        "programDigest",
        "tileX",
        "tileY",
        "width",
        "height",
      ]);
      if (
        !metadata
        || metadata.domain !== "toonspectrum/studio-dry-media-union/bitmap-page-v1"
        || metadata.programDigest !== STUDIO_DRY_MEDIA_UNION_COMPOSABLE_PROGRAM_DIGEST
        || metadata.tileX !== page.tileX
        || metadata.tileY !== page.tileY
        || metadata.width !== page.width
        || metadata.height !== page.height
      ) return null;
      const pixelBytes = bytes.subarray(4 + headerLength);
      if (pixelBytes.byteLength !== page.width * page.height * 4) return null;
      const rgba = new Uint8ClampedArray(pixelBytes.byteLength);
      rgba.set(pixelBytes);
      return Object.freeze({ ...page, rgba });
    },
    async seal(inputCandidate) {
      assertOpen();
      const input = exactDataRecord(inputCandidate, [
        "strokeId",
        "generation",
        "sequence",
        "presentationGeneration",
        "contourPages",
        "bitmapPages",
        "logicalByteLength",
        "slabCapacityByteLength",
        "residentByteLength",
        "metadata",
      ]);
      const rawContourPages = input
        ? denseDataArray(input.contourPages, Math.floor(MAX_METADATA_BYTES / 64))
        : null;
      const rawBitmapPages = input
        ? denseDataArray(input.bitmapPages, Math.floor(MAX_METADATA_BYTES / 64))
        : null;
      const presentation = input ? snapshotPresentationMetadata(input.metadata) : null;
      if (
        !input
        || typeof input.strokeId !== "string"
        || !STROKE_ID.test(input.strokeId)
        || !validNonNegativeSafeInteger(input.generation)
        || !validNonNegativeSafeInteger(input.sequence)
        || !validNonNegativeSafeInteger(input.presentationGeneration)
        || !validNonNegativeSafeInteger(input.logicalByteLength)
        || input.logicalByteLength <= 0
        || !validNonNegativeSafeInteger(input.slabCapacityByteLength)
        || input.slabCapacityByteLength < input.logicalByteLength
        || !validNonNegativeSafeInteger(input.residentByteLength)
        || input.residentByteLength !== 0
        || !rawContourPages
        || rawContourPages.length === 0
        || !rawBitmapPages
        || !presentation
      ) throw new TypeError("Invalid dry-media seal input.");
      const contourPages: StudioDryMediaUnionContinuationStoredPage[] = [];
      let nextPageIndex = 0;
      let nextGroupIndex = 0;
      let contourLogicalByteLength = 0;
      for (const rawPage of rawContourPages) {
        const page = snapshotStoredContourPage(rawPage);
        if (
          !page
          || rawPage === null
          || typeof rawPage !== "object"
          || !issuedContourPages.has(rawPage)
          || page.pageIndex !== nextPageIndex
          || page.firstGroupIndex !== nextGroupIndex
        ) throw new TypeError("Dry-media seal contour sequence is invalid.");
        nextPageIndex += 1;
        nextGroupIndex += page.groupCount;
        contourLogicalByteLength += page.byteLength;
        if (
          !Number.isSafeInteger(nextGroupIndex)
          || !Number.isSafeInteger(contourLogicalByteLength)
        ) throw new RangeError("Dry-media seal contour totals overflowed.");
        contourPages.push(page);
      }
      if (contourLogicalByteLength !== input.logicalByteLength) {
        throw new TypeError("Dry-media seal logical byte receipt is inconsistent.");
      }
      const bitmapPages: StudioDryMediaUnionContinuationStoredBitmapPage[] = [];
      const bitmapKeys = new Set<string>();
      for (const rawPage of rawBitmapPages) {
        const page = snapshotStoredBitmapPage(rawPage);
        const tileKey = page ? `${page.tileX}:${page.tileY}` : "";
        if (
          !page
          || rawPage === null
          || typeof rawPage !== "object"
          || !issuedBitmapPages.has(rawPage)
          || !bitmapPageFitsPresentation(page, presentation)
          || bitmapKeys.has(tileKey)
        ) throw new TypeError("Dry-media seal bitmap sequence is invalid.");
        bitmapKeys.add(tileKey);
        bitmapPages.push(page);
      }
      const leaves: MerkleLeaf[] = [
        ...contourPages.map((page) => ({
          digest: page.digest,
          byteLength: page.byteLength,
          kind: "contour" as const,
        })),
        ...bitmapPages.map((page) => ({
          digest: page.digest,
          byteLength: page.byteLength,
          kind: "bitmap" as const,
        })),
      ];
      const content = await buildMerkleIndexes(cas, leaves);
      const metadata = await putCanonical(cas, "metadata", {
        domain: "toonspectrum/studio-dry-media-union/metadata-v1",
        programVersion: STUDIO_DRY_MEDIA_UNION_COMPOSABLE_PROGRAM_VERSION,
        programDigest: STUDIO_DRY_MEDIA_UNION_COMPOSABLE_PROGRAM_DIGEST,
        strokeId: input.strokeId,
        generation: input.generation,
        sequence: input.sequence,
        presentationGeneration: input.presentationGeneration,
        presentation,
        contourPages,
        bitmapPages,
      }, MAX_METADATA_BYTES);
      const pageBytes = leaves.reduce((sum, leaf) => sum + leaf.byteLength, 0);
      const groupCount = contourPages.reduce(
        (sum, page) => sum + page.groupCount,
        0,
      );
      const contourCount = contourPages.reduce(
        (sum, page) => sum + page.contourCount,
        0,
      );
      const coordinateCount = contourPages.reduce(
        (sum, page) => sum + page.coordinateCount,
        0,
      );
      const rootWithoutDigest = {
        contract: "studio-dry-media-union-paged-root-v1" as const,
        version: 1 as const,
        strokeId: input.strokeId,
        generation: input.generation,
        sequence: input.sequence,
        programVersion: STUDIO_DRY_MEDIA_UNION_COMPOSABLE_PROGRAM_VERSION,
        programDigest: STUDIO_DRY_MEDIA_UNION_COMPOSABLE_PROGRAM_DIGEST,
        contentDigest: content.digest,
        metadataDigest: metadata.digest,
        pageCount: leaves.length,
        indexPageCount: content.indexPageCount,
        bitmapPageCount: bitmapPages.length,
        groupCount,
        contourCount,
        coordinateCount,
        logicalByteLength: input.logicalByteLength,
        pagedByteLength: pageBytes
          + content.indexByteLength + metadata.bytes.byteLength,
        residentByteLength: input.residentByteLength,
        hydratedByteLength: 0,
        inflightByteLength: 0,
        slabCapacityByteLength: input.slabCapacityByteLength,
        fragmentationByteLength: Math.max(
          0,
          input.slabCapacityByteLength - input.logicalByteLength,
        ),
        presentationGeneration: input.presentationGeneration,
      };
      const rootPayload = {
        domain: "toonspectrum/studio-dry-media-union/root-v1",
        receipt: rootWithoutDigest,
      };
      const persistedRoot = await putCanonical(cas, "root", rootPayload, MAX_ROOT_BYTES);
      return Object.freeze({
        ...rootWithoutDigest,
        rootDigest: persistedRoot.digest,
      });
    },
    async open(rootDigest, options = {}) {
      assertOpen();
      throwIfAborted(options.signal);
      if (!SHA256_HEX.test(rootDigest)) return null;
      const bytes = await cas.getCas("root", rootDigest);
      throwIfAborted(options.signal);
      if (!bytes || bytes.byteLength <= 0 || bytes.byteLength > MAX_ROOT_BYTES) return null;
      if (sha256HexPortable(bytes) !== rootDigest) return null;
      const envelope = exactDataRecord(parseCanonical(bytes, MAX_ROOT_BYTES), [
        "domain",
        "receipt",
      ]);
      const persistedReceipt = envelope ? dataRecord(envelope.receipt) : null;
      if (
        !envelope
        || envelope.domain !== "toonspectrum/studio-dry-media-union/root-v1"
        || !persistedReceipt
        || Object.prototype.hasOwnProperty.call(persistedReceipt, "rootDigest")
      ) return null;
      const receipt = snapshotRootReceipt({
        ...persistedReceipt,
        rootDigest,
      });
      if (!receipt) return null;
      const metadataBytes = await cas.getCas("metadata", receipt.metadataDigest);
      throwIfAborted(options.signal);
      if (
        !metadataBytes
        || metadataBytes.byteLength <= 0
        || metadataBytes.byteLength > MAX_METADATA_BYTES
        || sha256HexPortable(metadataBytes) !== receipt.metadataDigest
      ) return null;
      const metadataEnvelope = exactDataRecord(
        parseCanonical(metadataBytes, MAX_METADATA_BYTES),
        [
          "domain",
          "programVersion",
          "programDigest",
          "strokeId",
          "generation",
          "sequence",
          "presentationGeneration",
          "presentation",
          "contourPages",
          "bitmapPages",
        ],
      );
      const rawContourPages = metadataEnvelope
        ? denseDataArray(
            metadataEnvelope.contourPages,
            Math.floor(MAX_METADATA_BYTES / 64),
          )
        : null;
      const rawBitmapPages = metadataEnvelope
        ? denseDataArray(
            metadataEnvelope.bitmapPages,
            Math.floor(MAX_METADATA_BYTES / 64),
          )
        : null;
      const presentation = metadataEnvelope
        ? snapshotPresentationMetadata(metadataEnvelope.presentation)
        : null;
      if (
        !metadataEnvelope
        || metadataEnvelope.domain !== "toonspectrum/studio-dry-media-union/metadata-v1"
        || metadataEnvelope.programVersion
          !== STUDIO_DRY_MEDIA_UNION_COMPOSABLE_PROGRAM_VERSION
        || metadataEnvelope.programDigest !== STUDIO_DRY_MEDIA_UNION_COMPOSABLE_PROGRAM_DIGEST
        || metadataEnvelope.strokeId !== receipt.strokeId
        || metadataEnvelope.generation !== receipt.generation
        || metadataEnvelope.sequence !== receipt.sequence
        || metadataEnvelope.presentationGeneration !== receipt.presentationGeneration
        || !rawContourPages
        || rawContourPages.length === 0
        || !rawBitmapPages
        || !presentation
      ) return null;
      const contourPages: StudioDryMediaUnionContinuationStoredPage[] = [];
      let nextPageIndex = 0;
      let nextGroupIndex = 0;
      let contourCount = 0;
      let coordinateCount = 0;
      let pageByteLength = 0;
      for (const rawPage of rawContourPages) {
        const page = snapshotStoredContourPage(rawPage);
        if (
          !page
          || page.pageIndex !== nextPageIndex
          || page.firstGroupIndex !== nextGroupIndex
        ) return null;
        nextPageIndex += 1;
        nextGroupIndex += page.groupCount;
        contourCount += page.contourCount;
        coordinateCount += page.coordinateCount;
        pageByteLength += page.byteLength;
        if (
          !Number.isSafeInteger(nextGroupIndex)
          || !Number.isSafeInteger(contourCount)
          || !Number.isSafeInteger(coordinateCount)
          || !Number.isSafeInteger(pageByteLength)
        ) return null;
        contourPages.push(page);
      }
      const bitmapPages: StudioDryMediaUnionContinuationStoredBitmapPage[] = [];
      const bitmapKeys = new Set<string>();
      for (const rawPage of rawBitmapPages) {
        const page = snapshotStoredBitmapPage(rawPage);
        if (!page || !bitmapPageFitsPresentation(page, presentation)) return null;
        const tileKey = `${page.tileX}:${page.tileY}`;
        if (bitmapKeys.has(tileKey)) return null;
        bitmapKeys.add(tileKey);
        pageByteLength += page.byteLength;
        if (!Number.isSafeInteger(pageByteLength)) return null;
        bitmapPages.push(page);
      }
      if (
        receipt.pageCount !== contourPages.length + bitmapPages.length
        || receipt.bitmapPageCount !== bitmapPages.length
        || receipt.groupCount !== nextGroupIndex
        || receipt.contourCount !== contourCount
        || receipt.coordinateCount !== coordinateCount
        || receipt.logicalByteLength !== contourPages.reduce(
          (sum, page) => sum + page.byteLength,
          0,
        )
        || receipt.slabCapacityByteLength < receipt.logicalByteLength
        || receipt.fragmentationByteLength
          !== receipt.slabCapacityByteLength - receipt.logicalByteLength
        || receipt.residentByteLength !== 0
        || receipt.hydratedByteLength !== 0
        || receipt.inflightByteLength !== 0
      ) return null;
      const expectedLeaves: MerkleLeaf[] = [
        ...contourPages.map((page) => ({
          digest: page.digest,
          byteLength: page.byteLength,
          kind: "contour" as const,
        })),
        ...bitmapPages.map((page) => ({
          digest: page.digest,
          byteLength: page.byteLength,
          kind: "bitmap" as const,
        })),
      ];
      const merkle = await verifyMerkleIndexes(
        cas,
        receipt.contentDigest,
        receipt.indexPageCount,
        expectedLeaves.length,
        options.signal,
      );
      if (
        !merkle
        || merkle.leaves.some((leaf, index) => (
          leaf.digest !== expectedLeaves[index]!.digest
          || leaf.byteLength !== expectedLeaves[index]!.byteLength
          || leaf.kind !== expectedLeaves[index]!.kind
        ))
        || receipt.pagedByteLength
          !== pageByteLength + merkle.indexByteLength + metadataBytes.byteLength
      ) return null;
      return Object.freeze({
        receipt,
        metadata: presentation,
        contourPages: Object.freeze(contourPages),
        bitmapPages: Object.freeze(bitmapPages),
      });
    },
    async reopen(rootDigest, options = {}) {
      return (await this.open(rootDigest, options))?.receipt ?? null;
    },
    async verify(rootDigest, options = {}) {
      const opened = await this.open(rootDigest, options);
      if (!opened) return null;
      for (const page of opened.contourPages) {
        throwIfAborted(options.signal);
        if (!await this.getContourPage(page, options)) return null;
      }
      for (const page of opened.bitmapPages) {
        throwIfAborted(options.signal);
        if (!await this.getBitmapPage(page, options)) return null;
      }
      throwIfAborted(options.signal);
      return opened.receipt;
    },
    async close() {
      if (closed) return;
      closed = true;
      await cas.close();
    },
  };
}
