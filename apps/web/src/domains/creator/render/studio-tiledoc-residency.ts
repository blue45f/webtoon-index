/**
 * LRU residency policy for decoded tile pixels.
 *
 * The store keeps every alive tile buffer accounted; this module decides which of them may stay
 * decoded in RAM under a byte budget. It is a **pure planner**: it takes descriptors, returns an
 * eviction plan, and never touches the store. That keeps the ordering fully deterministic and
 * assertable without any timers or heuristics.
 *
 * Eviction order (ascending priority to keep):
 *   1. history-only buffers (reachable only from undo snapshots) — losing their decoded form costs
 *      one blob read on undo, and undo is not a per-frame path;
 *   2. current-document buffers that the caller did not pin (offscreen tiles);
 *   3. pinned buffers are never evicted.
 * Within a tier: least-recently-used first, then buffer id ascending. No ties are left to chance.
 *
 * **Interaction with undo — the hard rule.** A buffer may only be evicted once it is persisted
 * (`persisted: true`, i.e. the store holds a durable blob key for it). An unpersisted buffer is the
 * only copy of that pixel content anywhere; dropping it would delete an undo step. The planner
 * therefore reports `blockedUnpersistedBytes` and a `shortfall` instead of over-evicting. The
 * correct response to a shortfall is to flush pending tiles to the blob store and re-plan, not to
 * relax the rule.
 */

/** 256 MiB = 256 tiles at the default tile size. See `studioTileDocRecommendedBudgetBytes`. */
export const STUDIO_TILEDOC_DEFAULT_BUDGET_BYTES = 256 * 1024 * 1024;

/** Floor for the derived budget: below this a single viewport cannot stay resident. */
export const STUDIO_TILEDOC_MIN_BUDGET_BYTES = 64 * 1024 * 1024;

export interface StudioTileDocResidencyEntry {
  readonly bufferId: number;
  readonly byteLength: number;
  readonly resident: boolean;
  readonly lastUsed: number;
  readonly pinned: boolean;
  readonly historyOnly: boolean;
  readonly persisted: boolean;
}

export interface StudioTileDocEvictionOptions {
  readonly budgetBytes?: number;
  /** Extra buffers to protect for this frame (for example the tiles a pending draw needs). */
  readonly pinnedBufferIds?: Iterable<number>;
}

export interface StudioTileDocEvictionPlan {
  readonly evictBufferIds: readonly number[];
  readonly budgetBytes: number;
  readonly residentBytesBefore: number;
  readonly residentBytesAfter: number;
  /** Bytes still over budget after every legal eviction. Zero means the budget was met. */
  readonly shortfallBytes: number;
  /** Resident bytes that could not be evicted because their content is not durable yet. */
  readonly blockedUnpersistedBytes: number;
  /** Resident bytes held by pinned buffers. */
  readonly pinnedBytes: number;
}

export interface StudioTileDocBudgetInput {
  /** Tiles one viewport needs for one layer, from `queryViewport` on the visible rect. */
  readonly viewportTilesPerLayer: number;
  readonly visibleLayerCount: number;
  readonly tileBytes: number;
  /** Device RAM hint in GiB (`navigator.deviceMemory`), passed in so this stays pure. */
  readonly deviceMemoryGiB?: number;
  /** Extra viewport-fulls to keep for scroll overscan. Default 2 (one ahead, one behind). */
  readonly viewportMultiplier?: number;
}

function safeBudget(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return STUDIO_TILEDOC_DEFAULT_BUDGET_BYTES;
  }
  return Math.floor(value);
}

/**
 * Derives a budget from what the viewport actually needs, clamped by the device RAM hint.
 *
 * The working set that must stay resident is `viewportTiles × layers × multiplier`. A desktop
 * 2560×1440 viewport over a 4000-wide page at fit zoom is 8×3 = 24 tiles per layer; with 20 layers
 * and a 2× overscan that is 960 tiles = 960 MiB, which no phone can hold — hence the device clamp:
 * a quarter of device RAM, never below `STUDIO_TILEDOC_MIN_BUDGET_BYTES`. When the clamp bites,
 * the planner evicts offscreen and history tiles first, so scrolling costs blob reads rather than
 * a tab kill.
 */
export function studioTileDocRecommendedBudgetBytes(
  input: StudioTileDocBudgetInput
): number {
  const multiplier = Number.isFinite(input.viewportMultiplier) && (input.viewportMultiplier ?? 0) > 0
    ? (input.viewportMultiplier as number)
    : 2;
  const tiles = Math.max(0, Math.floor(input.viewportTilesPerLayer))
    * Math.max(0, Math.floor(input.visibleLayerCount))
    * multiplier;
  const want = Math.ceil(tiles * Math.max(1, Math.floor(input.tileBytes)));
  const deviceCap = Number.isFinite(input.deviceMemoryGiB) && (input.deviceMemoryGiB ?? 0) > 0
    ? Math.floor((input.deviceMemoryGiB as number) * 1024 * 1024 * 1024 * 0.25)
    : STUDIO_TILEDOC_DEFAULT_BUDGET_BYTES;
  return Math.max(STUDIO_TILEDOC_MIN_BUDGET_BYTES, Math.min(want, deviceCap));
}

function tier(entry: StudioTileDocResidencyEntry): number {
  return entry.historyOnly ? 0 : 1;
}

export function planStudioTileDocEviction(
  entries: readonly StudioTileDocResidencyEntry[],
  options: StudioTileDocEvictionOptions = {}
): StudioTileDocEvictionPlan {
  const budgetBytes = safeBudget(options.budgetBytes);
  const pinned = new Set<number>(options.pinnedBufferIds ?? []);

  let residentBytes = 0;
  let pinnedBytes = 0;
  let blockedUnpersistedBytes = 0;
  const candidates: StudioTileDocResidencyEntry[] = [];
  for (const entry of entries) {
    if (!entry.resident) continue;
    residentBytes += entry.byteLength;
    const isPinned = entry.pinned || pinned.has(entry.bufferId);
    if (isPinned) {
      pinnedBytes += entry.byteLength;
      continue;
    }
    if (!entry.persisted) {
      blockedUnpersistedBytes += entry.byteLength;
      continue;
    }
    candidates.push(entry);
  }

  const residentBytesBefore = residentBytes;
  const evictBufferIds: number[] = [];
  if (residentBytes > budgetBytes) {
    candidates.sort((left, right) => (
      tier(left) - tier(right)
      || left.lastUsed - right.lastUsed
      || left.bufferId - right.bufferId
    ));
    for (const candidate of candidates) {
      if (residentBytes <= budgetBytes) break;
      evictBufferIds.push(candidate.bufferId);
      residentBytes -= candidate.byteLength;
    }
  }

  return Object.freeze({
    evictBufferIds: Object.freeze(evictBufferIds),
    budgetBytes,
    residentBytesBefore,
    residentBytesAfter: residentBytes,
    shortfallBytes: Math.max(0, residentBytes - budgetBytes),
    blockedUnpersistedBytes,
    pinnedBytes,
  });
}

/**
 * Buffers that must be written to the blob store before eviction can make progress, most valuable
 * first (history-only, least recently used). Feeds `planStudioTileDocPersist`.
 */
export function planStudioTileDocSpillCandidates(
  entries: readonly StudioTileDocResidencyEntry[],
  options: StudioTileDocEvictionOptions = {}
): readonly number[] {
  const pinned = new Set<number>(options.pinnedBufferIds ?? []);
  const unpersisted = entries.filter((entry) => (
    entry.resident && !entry.persisted && !entry.pinned && !pinned.has(entry.bufferId)
  ));
  unpersisted.sort((left, right) => (
    tier(left) - tier(right)
    || left.lastUsed - right.lastUsed
    || left.bufferId - right.bufferId
  ));
  return Object.freeze(unpersisted.map((entry) => entry.bufferId));
}

/** Deterministic monotonic access clock — never reads a wall clock. */
export class StudioTileDocAccessClock {
  private sequence = 0;

  public touch(): number {
    this.sequence += 1;
    return this.sequence;
  }

  public get current(): number {
    return this.sequence;
  }
}
