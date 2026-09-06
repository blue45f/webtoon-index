/**
 * Format-independent sparse physical atlas allocator for retained WebGPU brush tiles.
 *
 * Logical document tiles are mapped onto a bounded set of physical atlas slots. A prepared frame
 * owns a private tentative mapping until it is completed, so allocation failure or cancellation
 * cannot partially mutate the visible residency set. Requested mappings are pinned for the whole
 * frame and inactive mappings are evicted by deterministic LRU order.
 */
export const STUDIO_GPU_SPARSE_TILE_ATLAS_REVISION = 1 as const;
export const STUDIO_GPU_SPARSE_TILE_ATLAS_DEFAULT_TILE_SIZE = 128;
export const STUDIO_GPU_SPARSE_TILE_ATLAS_DEFAULT_BLEED = 2;
export const STUDIO_GPU_SPARSE_TILE_ATLAS_DEFAULT_MAX_TEXTURE_DIMENSION = 16_384;
export const STUDIO_GPU_SPARSE_TILE_ATLAS_MAX_SLOTS = 1_048_576;

const STUDIO_GPU_SPARSE_TILE_ATLAS_TOKEN: unique symbol = Symbol(
  "StudioGpuSparseTileAtlasFrameToken",
);

export interface StudioGpuSparseTileAtlasOptions {
  readonly columns: number;
  readonly rows: number;
  readonly tileSize?: number;
  readonly bleed?: number;
  readonly maximumTextureDimension2D?: number;
}

export interface StudioGpuSparseTileAtlasAssignment {
  readonly logicalTileId: string;
  readonly slot: number;
  readonly column: number;
  readonly row: number;
  readonly pixelX: number;
  readonly pixelY: number;
  readonly physicalExtent: number;
}

export interface StudioGpuSparseTileAtlasFrameToken {
  readonly frameId: string;
  readonly deviceGeneration: number;
  readonly [STUDIO_GPU_SPARSE_TILE_ATLAS_TOKEN]: true;
}

export interface StudioGpuSparseTileAtlasPreparedFrame {
  readonly kind: "studio-gpu-sparse-tile-atlas-frame";
  readonly revision: typeof STUDIO_GPU_SPARSE_TILE_ATLAS_REVISION;
  readonly frameId: string;
  readonly deviceGeneration: number;
  readonly token: StudioGpuSparseTileAtlasFrameToken;
  readonly assignments: readonly Readonly<StudioGpuSparseTileAtlasAssignment>[];
  readonly hits: number;
  readonly misses: number;
  readonly evictions: number;
}

export type StudioGpuSparseTileAtlasPrepareResult =
  | Readonly<{
      status: "prepared";
      frame: Readonly<StudioGpuSparseTileAtlasPreparedFrame>;
    }>
  | Readonly<{
      status: "rejected";
      reason: "invalid-input" | "capacity" | "busy" | "disposed";
      activeFrameId?: string;
    }>;

export type StudioGpuSparseTileAtlasSettlementResult =
  | Readonly<{
      status: "completed" | "aborted";
      frameId: string;
      residentTiles: number;
      deviceGeneration: number;
    }>
  | Readonly<{
      status: "rejected";
      reason: "invalid-token" | "stale-generation" | "disposed";
    }>;

export interface StudioGpuSparseTileAtlasStats {
  readonly columns: number;
  readonly rows: number;
  readonly capacity: number;
  readonly tileSize: number;
  readonly bleed: number;
  readonly physicalExtent: number;
  readonly atlasWidth: number;
  readonly atlasHeight: number;
  readonly residentTiles: number;
  readonly hits: number;
  readonly misses: number;
  readonly evictions: number;
  readonly deviceGeneration: number;
  readonly activeFrameId: string | null;
  readonly disposed: boolean;
}

interface AtlasEntry {
  readonly logicalTileId: string;
  readonly slot: number;
  lastUsedSequence: number;
}

interface ActiveAtlasFrame {
  readonly token: StudioGpuSparseTileAtlasFrameToken;
  readonly entries: Map<string, AtlasEntry>;
  readonly sequence: number;
  readonly hits: number;
  readonly misses: number;
  readonly evictions: number;
  readonly prepared: Readonly<StudioGpuSparseTileAtlasPreparedFrame>;
}

interface NormalizedAtlasOptions {
  readonly columns: number;
  readonly rows: number;
  readonly capacity: number;
  readonly tileSize: number;
  readonly bleed: number;
  readonly physicalExtent: number;
  readonly atlasWidth: number;
  readonly atlasHeight: number;
}

function positiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function nonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function normalizeOptions(
  options: StudioGpuSparseTileAtlasOptions,
): Readonly<NormalizedAtlasOptions> {
  const tileSize = options?.tileSize
    ?? STUDIO_GPU_SPARSE_TILE_ATLAS_DEFAULT_TILE_SIZE;
  const bleed = options?.bleed
    ?? STUDIO_GPU_SPARSE_TILE_ATLAS_DEFAULT_BLEED;
  const maximumTextureDimension2D = options?.maximumTextureDimension2D
    ?? STUDIO_GPU_SPARSE_TILE_ATLAS_DEFAULT_MAX_TEXTURE_DIMENSION;
  if (
    !options
    || !positiveSafeInteger(options.columns)
    || !positiveSafeInteger(options.rows)
    || !positiveSafeInteger(tileSize)
    || !nonNegativeSafeInteger(bleed)
    || !positiveSafeInteger(maximumTextureDimension2D)
  ) throw new TypeError("invalid sparse tile atlas options");
  const capacity = options.columns * options.rows;
  const physicalExtent = tileSize + bleed * 2;
  const atlasWidth = options.columns * physicalExtent;
  const atlasHeight = options.rows * physicalExtent;
  if (
    !Number.isSafeInteger(capacity)
    || capacity > STUDIO_GPU_SPARSE_TILE_ATLAS_MAX_SLOTS
    || !Number.isSafeInteger(physicalExtent)
    || !Number.isSafeInteger(atlasWidth)
    || !Number.isSafeInteger(atlasHeight)
    || atlasWidth > maximumTextureDimension2D
    || atlasHeight > maximumTextureDimension2D
  ) throw new RangeError("sparse tile atlas exceeds device limits");
  return Object.freeze({
    columns: options.columns,
    rows: options.rows,
    capacity,
    tileSize,
    bleed,
    physicalExtent,
    atlasWidth,
    atlasHeight,
  });
}

function validLogicalTileId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 256;
}

function cloneEntries(entries: ReadonlyMap<string, AtlasEntry>): Map<string, AtlasEntry> {
  return new Map<string, AtlasEntry>(
    [...entries].map(([logicalTileId, entry]) => [
      logicalTileId,
      { ...entry },
    ] as const),
  );
}

export class StudioGpuSparseTileAtlas {
  readonly #options: Readonly<NormalizedAtlasOptions>;
  #entries = new Map<string, AtlasEntry>();
  #active: ActiveAtlasFrame | null = null;
  #sequence = 0;
  #hits = 0;
  #misses = 0;
  #evictions = 0;
  #deviceGeneration = 1;
  #disposed = false;

  public constructor(options: StudioGpuSparseTileAtlasOptions) {
    this.#options = normalizeOptions(options);
  }

  public prepareFrame(
    frameId: string,
    logicalTileIds: readonly string[],
  ): StudioGpuSparseTileAtlasPrepareResult {
    if (this.#disposed) {
      return Object.freeze({ status: "rejected", reason: "disposed" });
    }
    if (this.#active) {
      return Object.freeze({
        status: "rejected",
        reason: "busy",
        activeFrameId: this.#active.prepared.frameId,
      });
    }
    const exceedsCapacity = Array.isArray(logicalTileIds)
      && logicalTileIds.length > this.#options.capacity;
    if (
      !validLogicalTileId(frameId)
      || !Array.isArray(logicalTileIds)
      || exceedsCapacity
      || logicalTileIds.some((id) => !validLogicalTileId(id))
      || new Set(logicalTileIds).size !== logicalTileIds.length
    ) {
      return Object.freeze({
        status: "rejected",
        reason: exceedsCapacity ? "capacity" : "invalid-input",
      });
    }

    const entries = cloneEntries(this.#entries);
    const slotOwners: Array<string | null> = Array.from(
      { length: this.#options.capacity },
      () => null,
    );
    for (const entry of entries.values()) {
      if (
        entry.slot < 0
        || entry.slot >= slotOwners.length
        || slotOwners[entry.slot] !== null
      ) return Object.freeze({ status: "rejected", reason: "invalid-input" });
      slotOwners[entry.slot] = entry.logicalTileId;
    }

    const protectedIds = new Set(logicalTileIds);
    const assignments: StudioGpuSparseTileAtlasAssignment[] = [];
    let sequence = this.#sequence;
    let hits = 0;
    let misses = 0;
    let evictions = 0;
    for (const logicalTileId of logicalTileIds) {
      let entry = entries.get(logicalTileId);
      if (entry) {
        hits += 1;
      } else {
        misses += 1;
        let slot = slotOwners.indexOf(null);
        if (slot < 0) {
          let candidate: AtlasEntry | null = null;
          for (const resident of entries.values()) {
            if (protectedIds.has(resident.logicalTileId)) continue;
            if (
              !candidate
              || resident.lastUsedSequence < candidate.lastUsedSequence
              || (
                resident.lastUsedSequence === candidate.lastUsedSequence
                && (
                  resident.slot < candidate.slot
                  || (
                    resident.slot === candidate.slot
                    && resident.logicalTileId < candidate.logicalTileId
                  )
                )
              )
            ) candidate = resident;
          }
          if (!candidate) {
            return Object.freeze({ status: "rejected", reason: "capacity" });
          }
          entries.delete(candidate.logicalTileId);
          slot = candidate.slot;
          slotOwners[slot] = null;
          evictions += 1;
        }
        entry = {
          logicalTileId,
          slot,
          lastUsedSequence: sequence,
        };
        entries.set(logicalTileId, entry);
        slotOwners[slot] = logicalTileId;
      }
      if (sequence === Number.MAX_SAFE_INTEGER) {
        return Object.freeze({ status: "rejected", reason: "capacity" });
      }
      sequence += 1;
      entry.lastUsedSequence = sequence;
      const column = entry.slot % this.#options.columns;
      const row = Math.floor(entry.slot / this.#options.columns);
      assignments.push(Object.freeze({
        logicalTileId,
        slot: entry.slot,
        column,
        row,
        pixelX: column * this.#options.physicalExtent,
        pixelY: row * this.#options.physicalExtent,
        physicalExtent: this.#options.physicalExtent,
      }));
    }

    const token = Object.freeze<StudioGpuSparseTileAtlasFrameToken>({
      frameId,
      deviceGeneration: this.#deviceGeneration,
      [STUDIO_GPU_SPARSE_TILE_ATLAS_TOKEN]: true,
    });
    const prepared: StudioGpuSparseTileAtlasPreparedFrame = Object.freeze({
      kind: "studio-gpu-sparse-tile-atlas-frame",
      revision: STUDIO_GPU_SPARSE_TILE_ATLAS_REVISION,
      frameId,
      deviceGeneration: this.#deviceGeneration,
      token,
      assignments: Object.freeze(assignments),
      hits,
      misses,
      evictions,
    });
    this.#active = {
      token,
      entries,
      sequence,
      hits,
      misses,
      evictions,
      prepared,
    };
    return Object.freeze({ status: "prepared", frame: prepared });
  }

  public completeFrame(
    token: StudioGpuSparseTileAtlasFrameToken,
  ): StudioGpuSparseTileAtlasSettlementResult {
    const valid = this.#validateToken(token);
    if (valid !== true) return valid;
    const active = this.#active!;
    this.#entries = active.entries;
    this.#sequence = active.sequence;
    this.#hits += active.hits;
    this.#misses += active.misses;
    this.#evictions += active.evictions;
    this.#active = null;
    return Object.freeze({
      status: "completed",
      frameId: token.frameId,
      residentTiles: this.#entries.size,
      deviceGeneration: this.#deviceGeneration,
    });
  }

  public abortFrame(
    token: StudioGpuSparseTileAtlasFrameToken,
  ): StudioGpuSparseTileAtlasSettlementResult {
    const valid = this.#validateToken(token);
    if (valid !== true) return valid;
    this.#active = null;
    return Object.freeze({
      status: "aborted",
      frameId: token.frameId,
      residentTiles: this.#entries.size,
      deviceGeneration: this.#deviceGeneration,
    });
  }

  public lookup(logicalTileId: string): Readonly<StudioGpuSparseTileAtlasAssignment> | null {
    if (this.#disposed || !validLogicalTileId(logicalTileId)) return null;
    const entry = this.#entries.get(logicalTileId);
    if (!entry) return null;
    const column = entry.slot % this.#options.columns;
    const row = Math.floor(entry.slot / this.#options.columns);
    return Object.freeze({
      logicalTileId,
      slot: entry.slot,
      column,
      row,
      pixelX: column * this.#options.physicalExtent,
      pixelY: row * this.#options.physicalExtent,
      physicalExtent: this.#options.physicalExtent,
    });
  }

  /** Revokes every mapping and prepared token after device loss or atlas texture replacement. */
  public resetDevice(): number {
    if (this.#disposed) return this.#deviceGeneration;
    this.#active = null;
    this.#entries.clear();
    this.#sequence = 0;
    if (this.#deviceGeneration < Number.MAX_SAFE_INTEGER) {
      this.#deviceGeneration += 1;
    }
    return this.#deviceGeneration;
  }

  public stats(): Readonly<StudioGpuSparseTileAtlasStats> {
    return Object.freeze({
      ...this.#options,
      residentTiles: this.#entries.size,
      hits: this.#hits,
      misses: this.#misses,
      evictions: this.#evictions,
      deviceGeneration: this.#deviceGeneration,
      activeFrameId: this.#active?.prepared.frameId ?? null,
      disposed: this.#disposed,
    });
  }

  public dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#active = null;
    this.#entries.clear();
  }

  #validateToken(
    token: StudioGpuSparseTileAtlasFrameToken,
  ): true | Extract<StudioGpuSparseTileAtlasSettlementResult, { status: "rejected" }> {
    if (this.#disposed) {
      return Object.freeze({ status: "rejected", reason: "disposed" });
    }
    if (
      !token
      || token[STUDIO_GPU_SPARSE_TILE_ATLAS_TOKEN] !== true
      || token.deviceGeneration !== this.#deviceGeneration
    ) return Object.freeze({ status: "rejected", reason: "stale-generation" });
    if (!this.#active || this.#active.token !== token) {
      return Object.freeze({ status: "rejected", reason: "invalid-token" });
    }
    return true;
  }
}
