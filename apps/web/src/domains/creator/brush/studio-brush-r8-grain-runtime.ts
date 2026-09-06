import { sha256HexPortable } from "../studio-sha256";

import {
  STUDIO_BRUSH_R8_GRAIN_ASSET_LIMITS,
  normalizeStudioBrushR8TextureGrainSource,
  serializeStudioBrushR8TextureGrainSourceCanonical,
  type StudioBrushR8TextureGrainSource,
} from "./studio-brush-r8-grain-asset-contract";

import type { NormalizedStudioBrushGrainSettings } from "./studio-brush-material-dynamics";
import type { StudioBrushTipAlphaMap } from "./studio-brush-tip-stamp";

export const STUDIO_BRUSH_R8_GRAIN_REGISTRY_DEFAULTS = Object.freeze({
  maxEntries: 32,
  maxBytes: STUDIO_BRUSH_R8_GRAIN_ASSET_LIMITS.maxDecodedByteLength,
});

export interface StudioBrushR8GrainSampleInput {
  readonly x: number;
  readonly y: number;
  readonly strokeOriginX: number;
  readonly strokeOriginY: number;
  readonly strokeSeed: number;
  readonly space: "canvas-fixed" | "stroke-fixed";
  /** CSS pixels per complete R8 texture repeat. */
  readonly scale: number;
  readonly amount: number;
  readonly contrast: number;
  readonly seed: number;
}

export interface StudioBrushR8GrainSampler {
  readonly sourceKey: string;
  readonly source: Readonly<StudioBrushR8TextureGrainSource>;
  sampleAlphaMultiplierAt(input: StudioBrushR8GrainSampleInput): number;
}

export interface StudioBrushR8GrainHydrationReceipt {
  readonly sourceKey: string;
  readonly assetId: string;
  readonly encodedSha256: string;
  readonly decodedSha256: string;
  readonly decodedByteLength: number;
  readonly cached: boolean;
}

export type StudioBrushR8GrainHydrationResult =
  | Readonly<{
      status: "ready";
      receipt: Readonly<StudioBrushR8GrainHydrationReceipt>;
    }>
  | Readonly<{
      status: "rejected";
      reason:
        | "invalid-source"
        | "invalid-decoded-bytes"
        | "decoded-dimension-mismatch"
        | "decoded-hash-mismatch"
        | "registry-budget";
    }>;

export interface StudioBrushR8GrainRegistryOptions {
  readonly maxEntries?: number;
  readonly maxBytes?: number;
}

export interface StudioBrushR8GrainRegistryStats {
  readonly entries: number;
  readonly bytes: number;
  readonly maxEntries: number;
  readonly maxBytes: number;
  readonly hits: number;
  readonly misses: number;
  readonly hydrations: number;
  readonly evictions: number;
}

/**
 * Structured-clone/transfer boundary for worker renderers. `decodedBytes` is always a private
 * copy; transferring or mutating it cannot detach or corrupt the realm-local registry entry.
 */
export interface StudioBrushR8GrainTransferSnapshotEntry {
  readonly sourceKey: string;
  readonly source: Readonly<StudioBrushR8TextureGrainSource>;
  readonly decodedBytes: Uint8Array;
}

export interface StudioBrushR8GrainTransferSnapshot {
  readonly entries: readonly Readonly<StudioBrushR8GrainTransferSnapshotEntry>[];
  readonly totalDecodedBytes: number;
}

interface StudioBrushR8GrainRegistryEntry {
  readonly sourceKey: string;
  readonly source: Readonly<StudioBrushR8TextureGrainSource>;
  readonly bytes: Uint8Array;
  readonly sampler: Readonly<StudioBrushR8GrainSampler>;
}

export interface StudioBrushR8TipPaperCompositionInput {
  readonly tip: StudioBrushTipAlphaMap;
  readonly sampler: StudioBrushR8GrainSampler;
  readonly grain: NormalizedStudioBrushGrainSettings;
  readonly centerX: number;
  readonly centerY: number;
  readonly radiusX: number;
  readonly radiusY: number;
  readonly angleRadians: number;
  readonly strokeOriginX: number;
  readonly strokeOriginY: number;
  readonly strokeSeed: number;
}

const UINT32_RANGE = 0x1_0000_0000;
const MAX_REGISTRY_ENTRIES = 256;
const MAX_REGISTRY_BYTES = 256 * 1_024 * 1_024;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function finiteNumber(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

function mixedUnit(seed: number, salt: number): number {
  let value = ((Math.trunc(seed) >>> 0) ^ salt) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb_352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846c_a68b);
  value ^= value >>> 16;
  return (value >>> 0) / UINT32_RANGE;
}

function safeRegistryLimit(
  value: number | undefined,
  fallback: number,
  maximum: number,
): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? Math.min(value, maximum)
    : fallback;
}

function canonicalSourceKey(source: unknown): string | null {
  return serializeStudioBrushR8TextureGrainSourceCanonical(source);
}

function exactUint8Copy(value: unknown): Uint8Array | null {
  if (!(value instanceof Uint8Array) || Object.getPrototypeOf(value) !== Uint8Array.prototype) {
    return null;
  }
  if (
    typeof SharedArrayBuffer !== "undefined"
    && value.buffer instanceof SharedArrayBuffer
  ) {
    return null;
  }
  try {
    const copy = new Uint8Array(value.byteLength);
    copy.set(value);
    return copy;
  } catch {
    return null;
  }
}

function sampleRepeatedBilinearR8(
  bytes: Uint8Array,
  width: number,
  height: number,
  u: number,
  v: number,
): number {
  const texelX = positiveModulo(u, 1) * width - 0.5;
  const texelY = positiveModulo(v, 1) * height - 0.5;
  const x0 = Math.floor(texelX);
  const y0 = Math.floor(texelY);
  const tx = texelX - x0;
  const ty = texelY - y0;
  const wrappedX0 = positiveModulo(x0, width);
  const wrappedY0 = positiveModulo(y0, height);
  const wrappedX1 = (wrappedX0 + 1) % width;
  const wrappedY1 = (wrappedY0 + 1) % height;
  const topLeft = bytes[wrappedY0 * width + wrappedX0]! / 255;
  const topRight = bytes[wrappedY0 * width + wrappedX1]! / 255;
  const bottomLeft = bytes[wrappedY1 * width + wrappedX0]! / 255;
  const bottomRight = bytes[wrappedY1 * width + wrappedX1]! / 255;
  const top = topLeft + (topRight - topLeft) * tx;
  const bottom = bottomLeft + (bottomRight - bottomLeft) * tx;
  return top + (bottom - top) * ty;
}

function createSampler(
  sourceKey: string,
  source: Readonly<StudioBrushR8TextureGrainSource>,
  bytes: Uint8Array,
): Readonly<StudioBrushR8GrainSampler> {
  const { width, height } = source.asset;
  return Object.freeze({
    sourceKey,
    source,
    sampleAlphaMultiplierAt(input: StudioBrushR8GrainSampleInput): number {
      if (
        !Number.isFinite(input.x)
        || !Number.isFinite(input.y)
        || !Number.isFinite(input.scale)
        || input.scale <= 0
      ) {
        return 1;
      }
      const amount = clamp01(finiteNumber(input.amount, 0));
      if (amount <= 0) return 1;
      const contrast = clamp01(finiteNumber(input.contrast, 0));
      const anchorX = input.space === "stroke-fixed"
        ? finiteNumber(input.strokeOriginX, 0)
        : 0;
      const anchorY = input.space === "stroke-fixed"
        ? finiteNumber(input.strokeOriginY, 0)
        : 0;
      const phaseSeed = (
        (Math.trunc(finiteNumber(input.strokeSeed, 1)) >>> 0)
        ^ (Math.trunc(finiteNumber(input.seed, 1)) >>> 0)
      ) >>> 0;
      const phaseX = mixedUnit(phaseSeed, 0x9e37_79b9);
      const phaseY = mixedUnit(phaseSeed, 0x243f_6a88);
      const sampled = sampleRepeatedBilinearR8(
        bytes,
        width,
        height,
        (input.x - anchorX) / input.scale + phaseX,
        (input.y - anchorY) / input.scale + phaseY,
      );
      const contrasted = clamp01((sampled - 0.5) * (1 + contrast * 4) + 0.5);
      return clamp01(1 - amount * (1 - contrasted));
    },
  });
}

function tipMapIsValid(map: StudioBrushTipAlphaMap): boolean {
  if (
    !Number.isSafeInteger(map.size)
    || map.size <= 0
    || !(map.alphas instanceof Float32Array)
    || map.alphas.length !== map.size * map.size
  ) {
    return false;
  }
  for (const alpha of map.alphas) {
    if (!Number.isFinite(alpha)) return false;
  }
  return true;
}

function tipContentIdentity(map: StudioBrushTipAlphaMap): string {
  if (typeof map.revision === "string" || typeof map.revision === "number") {
    return `${typeof map.revision}:${String(map.revision)}`;
  }
  const bytes = new Uint8Array(map.alphas.length);
  for (let index = 0; index < map.alphas.length; index += 1) {
    bytes[index] = Math.round(clamp01(map.alphas[index]!) * 255);
  }
  return `sha256:${sha256HexPortable(bytes)}`;
}

function compositionRevision(input: StudioBrushR8TipPaperCompositionInput): string {
  const canonical = JSON.stringify({
    version: 1,
    tip: tipContentIdentity(input.tip),
    source: input.sampler.sourceKey,
    space: input.grain.space,
    scale: input.grain.scale,
    amount: input.grain.amount,
    contrast: input.grain.contrast,
    seed: input.grain.seed,
    centerX: input.centerX,
    centerY: input.centerY,
    radiusX: input.radiusX,
    radiusY: input.radiusY,
    angleRadians: input.angleRadians,
    strokeOriginX: input.strokeOriginX,
    strokeOriginY: input.strokeOriginY,
    strokeSeed: input.strokeSeed,
  });
  return `r8-tip-paper-v1:sha256:${sha256HexPortable(new TextEncoder().encode(canonical))}`;
}

/**
 * Multiplies a tip alpha map by verified paper samples in document space. The resulting immutable
 * revision is shared by live, committed and SVG consumers of the coverage mark plan.
 */
export function composeStudioBrushR8TipPaperAlphaMap(
  input: StudioBrushR8TipPaperCompositionInput,
): StudioBrushTipAlphaMap | null {
  if (
    !tipMapIsValid(input.tip)
    || !input.grain.source
    || canonicalSourceKey(input.grain.source) !== input.sampler.sourceKey
    || !Number.isFinite(input.centerX)
    || !Number.isFinite(input.centerY)
    || !Number.isFinite(input.radiusX)
    || !Number.isFinite(input.radiusY)
    || input.radiusX <= 0
    || input.radiusY <= 0
    || !Number.isFinite(input.angleRadians)
  ) {
    return null;
  }
  const size = input.tip.size;
  const alphas = new Float32Array(input.tip.alphas.length);
  const cosine = Math.cos(input.angleRadians);
  const sine = Math.sin(input.angleRadians);
  for (let y = 0; y < size; y += 1) {
    const unitY = ((y + 0.5) / size) * 2 - 1;
    for (let x = 0; x < size; x += 1) {
      const index = y * size + x;
      const tipAlpha = clamp01(input.tip.alphas[index]!);
      if (tipAlpha <= 0) continue;
      const unitX = ((x + 0.5) / size) * 2 - 1;
      const localX = unitX * input.radiusX;
      const localY = unitY * input.radiusY;
      const worldX = input.centerX + localX * cosine - localY * sine;
      const worldY = input.centerY + localX * sine + localY * cosine;
      alphas[index] = tipAlpha * input.sampler.sampleAlphaMultiplierAt({
        x: worldX,
        y: worldY,
        strokeOriginX: input.strokeOriginX,
        strokeOriginY: input.strokeOriginY,
        strokeSeed: input.strokeSeed,
        space: input.grain.space,
        scale: input.grain.scale,
        amount: input.grain.amount,
        contrast: input.grain.contrast,
        seed: input.grain.seed,
      });
    }
  }
  return {
    size,
    alphas,
    shape: input.tip.shape,
    softness: input.tip.softness,
    custom: true,
    revision: compositionRevision(input),
  };
}

/**
 * Realm-local verified decoded-R8 cache. Hydration owns a private byte copy; lookups expose only a
 * sampler closure, never the backing bytes or a mutable view.
 */
export class StudioBrushR8GrainRegistry {
  private readonly entries = new Map<string, StudioBrushR8GrainRegistryEntry>();
  private readonly maxEntries: number;
  private readonly maxBytes: number;
  private byteLength = 0;
  private hits = 0;
  private misses = 0;
  private hydrations = 0;
  private evictions = 0;

  constructor(options: StudioBrushR8GrainRegistryOptions = {}) {
    this.maxEntries = safeRegistryLimit(
      options.maxEntries,
      STUDIO_BRUSH_R8_GRAIN_REGISTRY_DEFAULTS.maxEntries,
      MAX_REGISTRY_ENTRIES,
    );
    this.maxBytes = safeRegistryLimit(
      options.maxBytes,
      STUDIO_BRUSH_R8_GRAIN_REGISTRY_DEFAULTS.maxBytes,
      MAX_REGISTRY_BYTES,
    );
  }

  hydrate(
    sourceValue: unknown,
    decodedBytesValue: unknown,
  ): StudioBrushR8GrainHydrationResult {
    const source = normalizeStudioBrushR8TextureGrainSource(sourceValue);
    const sourceKey = source ? canonicalSourceKey(source) : null;
    if (!source || !sourceKey) {
      return { status: "rejected", reason: "invalid-source" };
    }
    const decodedBytes = exactUint8Copy(decodedBytesValue);
    if (!decodedBytes) {
      return { status: "rejected", reason: "invalid-decoded-bytes" };
    }
    if (decodedBytes.byteLength !== source.asset.width * source.asset.height) {
      decodedBytes.fill(0);
      return { status: "rejected", reason: "decoded-dimension-mismatch" };
    }
    if (decodedBytes.byteLength > this.maxBytes) {
      decodedBytes.fill(0);
      return { status: "rejected", reason: "registry-budget" };
    }
    const decodedSha256 = `sha256:${sha256HexPortable(decodedBytes)}`;
    if (decodedSha256 !== source.asset.decodedSha256) {
      decodedBytes.fill(0);
      return { status: "rejected", reason: "decoded-hash-mismatch" };
    }

    const existing = this.entries.get(sourceKey);
    if (existing) {
      decodedBytes.fill(0);
      this.touch(existing);
      return {
        status: "ready",
        receipt: this.receipt(existing, true),
      };
    }

    const entry: StudioBrushR8GrainRegistryEntry = {
      sourceKey,
      source,
      bytes: decodedBytes,
      sampler: createSampler(sourceKey, source, decodedBytes),
    };
    this.entries.set(sourceKey, entry);
    this.byteLength += decodedBytes.byteLength;
    this.hydrations += 1;
    this.evictToBudget();
    if (!this.entries.has(sourceKey)) {
      return { status: "rejected", reason: "registry-budget" };
    }
    return {
      status: "ready",
      receipt: this.receipt(entry, false),
    };
  }

  resolve(sourceValue: unknown): Readonly<StudioBrushR8GrainSampler> | null {
    const sourceKey = canonicalSourceKey(sourceValue);
    if (!sourceKey) {
      this.misses += 1;
      return null;
    }
    const entry = this.entries.get(sourceKey);
    if (!entry) {
      this.misses += 1;
      return null;
    }
    this.hits += 1;
    this.touch(entry);
    return entry.sampler;
  }

  snapshotForTransfer(
    sourceValue: unknown,
  ): Readonly<StudioBrushR8GrainTransferSnapshotEntry> | null {
    const sourceKey = canonicalSourceKey(sourceValue);
    if (!sourceKey) return null;
    const entry = this.entries.get(sourceKey);
    if (!entry) return null;
    const decodedBytes = new Uint8Array(entry.bytes.byteLength);
    decodedBytes.set(entry.bytes);
    return Object.freeze({
      sourceKey,
      source: entry.source,
      decodedBytes,
    });
  }

  snapshotManyForTransfer(
    sourceValues: readonly unknown[],
  ): Readonly<StudioBrushR8GrainTransferSnapshot> {
    const entries: Readonly<StudioBrushR8GrainTransferSnapshotEntry>[] = [];
    const seen = new Set<string>();
    let totalDecodedBytes = 0;
    for (const sourceValue of sourceValues) {
      const sourceKey = canonicalSourceKey(sourceValue);
      if (!sourceKey || seen.has(sourceKey)) continue;
      seen.add(sourceKey);
      const entry = this.entries.get(sourceKey);
      if (!entry) continue;
      const nextTotal = totalDecodedBytes + entry.bytes.byteLength;
      // The registry itself is bounded, but keep this worker boundary fail-closed if its internal
      // accounting is ever changed independently.
      if (!Number.isSafeInteger(nextTotal) || nextTotal > this.maxBytes) break;
      const decodedBytes = new Uint8Array(entry.bytes.byteLength);
      decodedBytes.set(entry.bytes);
      entries.push(Object.freeze({
        sourceKey,
        source: entry.source,
        decodedBytes,
      }));
      totalDecodedBytes = nextTotal;
    }
    return Object.freeze({
      entries: Object.freeze(entries),
      totalDecodedBytes,
    });
  }

  release(sourceValue: unknown): boolean {
    const sourceKey = canonicalSourceKey(sourceValue);
    if (!sourceKey) return false;
    const entry = this.entries.get(sourceKey);
    if (!entry) return false;
    this.deleteEntry(entry);
    return true;
  }

  reset(): void {
    for (const entry of this.entries.values()) entry.bytes.fill(0);
    this.entries.clear();
    this.byteLength = 0;
    this.hits = 0;
    this.misses = 0;
    this.hydrations = 0;
    this.evictions = 0;
  }

  stats(): Readonly<StudioBrushR8GrainRegistryStats> {
    return Object.freeze({
      entries: this.entries.size,
      bytes: this.byteLength,
      maxEntries: this.maxEntries,
      maxBytes: this.maxBytes,
      hits: this.hits,
      misses: this.misses,
      hydrations: this.hydrations,
      evictions: this.evictions,
    });
  }

  private touch(entry: StudioBrushR8GrainRegistryEntry): void {
    this.entries.delete(entry.sourceKey);
    this.entries.set(entry.sourceKey, entry);
  }

  private deleteEntry(entry: StudioBrushR8GrainRegistryEntry): void {
    if (this.entries.get(entry.sourceKey) !== entry) return;
    this.entries.delete(entry.sourceKey);
    this.byteLength = Math.max(0, this.byteLength - entry.bytes.byteLength);
    entry.bytes.fill(0);
  }

  private evictToBudget(): void {
    while (
      this.entries.size > this.maxEntries
      || this.byteLength > this.maxBytes
    ) {
      const oldest = this.entries.values().next().value as
        | StudioBrushR8GrainRegistryEntry
        | undefined;
      if (!oldest) break;
      this.deleteEntry(oldest);
      this.evictions += 1;
    }
  }

  private receipt(
    entry: StudioBrushR8GrainRegistryEntry,
    cached: boolean,
  ): Readonly<StudioBrushR8GrainHydrationReceipt> {
    return Object.freeze({
      sourceKey: entry.sourceKey,
      assetId: entry.source.asset.assetId,
      encodedSha256: entry.source.asset.encodedSha256,
      decodedSha256: entry.source.asset.decodedSha256,
      decodedByteLength: entry.bytes.byteLength,
      cached,
    });
  }
}

const sharedStudioBrushR8GrainRegistry = new StudioBrushR8GrainRegistry();

export function hydrateStudioBrushR8GrainAsset(
  source: unknown,
  decodedBytes: unknown,
): StudioBrushR8GrainHydrationResult {
  return sharedStudioBrushR8GrainRegistry.hydrate(source, decodedBytes);
}

export function resolveStudioBrushR8GrainSampler(
  source: unknown,
): Readonly<StudioBrushR8GrainSampler> | null {
  return sharedStudioBrushR8GrainRegistry.resolve(source);
}

export function snapshotStudioBrushR8GrainAssetForTransfer(
  source: unknown,
): Readonly<StudioBrushR8GrainTransferSnapshotEntry> | null {
  return sharedStudioBrushR8GrainRegistry.snapshotForTransfer(source);
}

export function snapshotStudioBrushR8GrainAssetsForTransfer(
  sources: readonly unknown[],
): Readonly<StudioBrushR8GrainTransferSnapshot> {
  return sharedStudioBrushR8GrainRegistry.snapshotManyForTransfer(sources);
}

export function releaseStudioBrushR8GrainAsset(source: unknown): boolean {
  return sharedStudioBrushR8GrainRegistry.release(source);
}

export function resetStudioBrushR8GrainRegistry(): void {
  sharedStudioBrushR8GrainRegistry.reset();
}

export function studioBrushR8GrainRegistryStats(): Readonly<StudioBrushR8GrainRegistryStats> {
  return sharedStudioBrushR8GrainRegistry.stats();
}
