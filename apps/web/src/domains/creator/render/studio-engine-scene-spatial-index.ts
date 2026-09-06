/**
 * Renderer-neutral dynamic scene spatial index.
 *
 * RBush owns only private, detached copies of document IDs and bounding boxes.
 * Public mutations and queries accept/return frozen plain data, and all result
 * ordering is explicitly defined instead of depending on RBush traversal order.
 */

import RBush, { type BBox } from "rbush";

export const STUDIO_ENGINE_SCENE_SPATIAL_INDEX_VERSION = 1 as const;

export const STUDIO_ENGINE_SCENE_SPATIAL_INDEX_LIMITS = Object.freeze({
  maxEntries: 262_144,
  maxIdentifierCodeUnits: 256,
  maxCoordinateAbsolute: 10_000_000,
  maxZOrderAbsolute: 2_147_483_647,
  maxSearchCandidates: 65_536,
  maxSearchResults: 16_384,
  rbushMaxEntries: 16,
} as const);

export interface StudioEngineSceneSpatialBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export interface StudioEngineSceneSpatialEntryCandidate {
  readonly id: string;
  readonly bounds: StudioEngineSceneSpatialBounds;
  readonly zOrder: number;
  readonly locked?: boolean;
  readonly hidden?: boolean;
  readonly interactive?: boolean;
}

export interface StudioEngineSceneSpatialEntry {
  readonly id: string;
  readonly bounds: StudioEngineSceneSpatialBounds;
  readonly zOrder: number;
  readonly locked: boolean;
  readonly hidden: boolean;
  readonly interactive: boolean;
}

export interface StudioEngineSceneSpatialPoint {
  readonly x: number;
  readonly y: number;
}

export interface StudioEngineSceneSpatialSearchOptions {
  /** Hidden entries are excluded unless explicitly requested. */
  readonly includeHidden?: boolean;
  /** Locked entries are included in area searches by default. */
  readonly includeLocked?: boolean;
  /** When true, non-interactive entries are excluded. */
  readonly interactiveOnly?: boolean;
  /** Result count after deterministic topmost-first ordering. */
  readonly limit?: number;
}

export interface StudioEngineSceneSpatialPointHitOptions {
  /** Hidden entries are excluded unless explicitly requested. */
  readonly includeHidden?: boolean;
  /** Locked entries are excluded from point interaction unless explicitly requested. */
  readonly includeLocked?: boolean;
}

export interface StudioEngineSceneSpatialIndexLimits {
  readonly maxEntries?: number;
  readonly maxIdentifierCodeUnits?: number;
  readonly maxCoordinateAbsolute?: number;
  readonly maxZOrderAbsolute?: number;
  readonly maxSearchCandidates?: number;
  readonly maxSearchResults?: number;
  readonly rbushMaxEntries?: number;
}

export interface StudioEngineSceneSpatialIndexOptions {
  readonly limits?: StudioEngineSceneSpatialIndexLimits;
}

export type StudioEngineSceneSpatialFailureReason =
  | "invalid-input"
  | "duplicate-id"
  | "budget-exceeded"
  | "disposed"
  | "index-failure";

export type StudioEngineSceneSpatialUpsertResult =
  | Readonly<{
      readonly ok: true;
      readonly replaced: boolean;
      readonly entry: StudioEngineSceneSpatialEntry;
      readonly size: number;
    }>
  | StudioEngineSceneSpatialFailure;

export type StudioEngineSceneSpatialRemoveResult =
  | Readonly<{
      readonly ok: true;
      readonly removed: boolean;
      readonly size: number;
    }>
  | StudioEngineSceneSpatialFailure;

export type StudioEngineSceneSpatialRebuildResult =
  | Readonly<{
      readonly ok: true;
      readonly entryCount: number;
      readonly size: number;
    }>
  | StudioEngineSceneSpatialFailure;

export type StudioEngineSceneSpatialSearchResult =
  | Readonly<{
      readonly ok: true;
      readonly entries: readonly StudioEngineSceneSpatialEntry[];
      readonly candidateCount: number;
    }>
  | StudioEngineSceneSpatialFailure;

export type StudioEngineSceneSpatialPointHitResult =
  | Readonly<{
      readonly ok: true;
      readonly entry: StudioEngineSceneSpatialEntry | null;
      readonly candidateCount: number;
    }>
  | StudioEngineSceneSpatialFailure;

export interface StudioEngineSceneSpatialFailure {
  readonly ok: false;
  readonly reason: StudioEngineSceneSpatialFailureReason;
  readonly detail: string;
}

export interface StudioEngineSceneSpatialIndexSnapshot {
  readonly kind: "studio-engine-scene-spatial-index";
  readonly version: typeof STUDIO_ENGINE_SCENE_SPATIAL_INDEX_VERSION;
  readonly phase: "ready" | "disposed";
  readonly size: number;
  readonly mutationSequence: number;
}

interface ResolvedLimits {
  readonly maxEntries: number;
  readonly maxIdentifierCodeUnits: number;
  readonly maxCoordinateAbsolute: number;
  readonly maxZOrderAbsolute: number;
  readonly maxSearchCandidates: number;
  readonly maxSearchResults: number;
  readonly rbushMaxEntries: number;
}

interface SceneTreeItem extends BBox {
  readonly entry: StudioEngineSceneSpatialEntry;
}

interface ParsedSearchOptions {
  readonly includeHidden: boolean;
  readonly includeLocked: boolean;
  readonly interactiveOnly: boolean;
  readonly limit: number;
}

const LIMIT_KEYS = [
  "maxEntries",
  "maxIdentifierCodeUnits",
  "maxCoordinateAbsolute",
  "maxZOrderAbsolute",
  "maxSearchCandidates",
  "maxSearchResults",
  "rbushMaxEntries",
] as const;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(
  value: Readonly<Record<string, unknown>>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const keys = Object.keys(value);
  if (keys.length < required.length || keys.length > required.length + optional.length) {
    return false;
  }
  return required.every((key) => Object.hasOwn(value, key))
    && keys.every((key) => required.includes(key) || optional.includes(key));
}

function positiveIntegerLimit(
  candidate: number | undefined,
  fallback: number,
  name: string,
): number {
  const value = candidate ?? fallback;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
  return value;
}

function positiveFiniteLimit(
  candidate: number | undefined,
  fallback: number,
  name: string,
): number {
  const value = candidate ?? fallback;
  if (!Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive finite number`);
  }
  return value;
}

function resolveLimits(
  candidate: StudioEngineSceneSpatialIndexLimits | undefined,
): ResolvedLimits {
  if (
    candidate !== undefined
    && (!isPlainRecord(candidate) || !hasExactKeys(candidate, [], LIMIT_KEYS))
  ) {
    throw new TypeError("Spatial-index limits must be a plain object");
  }
  const limits = (candidate ?? {}) as StudioEngineSceneSpatialIndexLimits;
  const resolved = {
    maxEntries: positiveIntegerLimit(
      limits.maxEntries,
      STUDIO_ENGINE_SCENE_SPATIAL_INDEX_LIMITS.maxEntries,
      "maxEntries",
    ),
    maxIdentifierCodeUnits: positiveIntegerLimit(
      limits.maxIdentifierCodeUnits,
      STUDIO_ENGINE_SCENE_SPATIAL_INDEX_LIMITS.maxIdentifierCodeUnits,
      "maxIdentifierCodeUnits",
    ),
    maxCoordinateAbsolute: positiveFiniteLimit(
      limits.maxCoordinateAbsolute,
      STUDIO_ENGINE_SCENE_SPATIAL_INDEX_LIMITS.maxCoordinateAbsolute,
      "maxCoordinateAbsolute",
    ),
    maxZOrderAbsolute: positiveIntegerLimit(
      limits.maxZOrderAbsolute,
      STUDIO_ENGINE_SCENE_SPATIAL_INDEX_LIMITS.maxZOrderAbsolute,
      "maxZOrderAbsolute",
    ),
    maxSearchCandidates: positiveIntegerLimit(
      limits.maxSearchCandidates,
      STUDIO_ENGINE_SCENE_SPATIAL_INDEX_LIMITS.maxSearchCandidates,
      "maxSearchCandidates",
    ),
    maxSearchResults: positiveIntegerLimit(
      limits.maxSearchResults,
      STUDIO_ENGINE_SCENE_SPATIAL_INDEX_LIMITS.maxSearchResults,
      "maxSearchResults",
    ),
    rbushMaxEntries: positiveIntegerLimit(
      limits.rbushMaxEntries,
      STUDIO_ENGINE_SCENE_SPATIAL_INDEX_LIMITS.rbushMaxEntries,
      "rbushMaxEntries",
    ),
  } satisfies ResolvedLimits;
  if (resolved.rbushMaxEntries < 4 || resolved.rbushMaxEntries > 64) {
    throw new TypeError("rbushMaxEntries must be from four to sixty-four");
  }
  return Object.freeze(resolved);
}

function failure(
  reason: StudioEngineSceneSpatialFailureReason,
  detail: string,
): StudioEngineSceneSpatialFailure {
  return Object.freeze({ ok: false, reason, detail });
}

function hasIdentifierControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

function parseIdentifier(
  value: unknown,
  limits: ResolvedLimits,
): string | null {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > limits.maxIdentifierCodeUnits
    || value !== value.trim()
    || hasIdentifierControlCharacter(value)
  ) {
    return null;
  }
  return value;
}

function parseBounds(
  value: unknown,
  limits: ResolvedLimits,
): StudioEngineSceneSpatialBounds | null {
  if (
    !isPlainRecord(value)
    || !hasExactKeys(value, ["minX", "minY", "maxX", "maxY"])
  ) {
    return null;
  }
  const { minX, minY, maxX, maxY } = value;
  if (
    typeof minX !== "number"
    || typeof minY !== "number"
    || typeof maxX !== "number"
    || typeof maxY !== "number"
    || !Number.isFinite(minX)
    || !Number.isFinite(minY)
    || !Number.isFinite(maxX)
    || !Number.isFinite(maxY)
    || Math.abs(minX) > limits.maxCoordinateAbsolute
    || Math.abs(minY) > limits.maxCoordinateAbsolute
    || Math.abs(maxX) > limits.maxCoordinateAbsolute
    || Math.abs(maxY) > limits.maxCoordinateAbsolute
    || minX > maxX
    || minY > maxY
  ) {
    return null;
  }
  return Object.freeze({ minX, minY, maxX, maxY });
}

function parseEntry(
  value: unknown,
  limits: ResolvedLimits,
): StudioEngineSceneSpatialEntry | null {
  if (
    !isPlainRecord(value)
    || !hasExactKeys(
      value,
      ["id", "bounds", "zOrder"],
      ["locked", "hidden", "interactive"],
    )
  ) {
    return null;
  }
  const id = parseIdentifier(value.id, limits);
  const bounds = parseBounds(value.bounds, limits);
  if (
    id === null
    || bounds === null
    || typeof value.zOrder !== "number"
    || !Number.isSafeInteger(value.zOrder)
    || Math.abs(value.zOrder) > limits.maxZOrderAbsolute
    || (value.locked !== undefined && typeof value.locked !== "boolean")
    || (value.hidden !== undefined && typeof value.hidden !== "boolean")
    || (value.interactive !== undefined && typeof value.interactive !== "boolean")
  ) {
    return null;
  }
  return Object.freeze({
    id,
    bounds,
    zOrder: value.zOrder,
    locked: value.locked ?? false,
    hidden: value.hidden ?? false,
    interactive: value.interactive ?? true,
  });
}

function treeItem(entry: StudioEngineSceneSpatialEntry): SceneTreeItem {
  return Object.freeze({
    minX: entry.bounds.minX,
    minY: entry.bounds.minY,
    maxX: entry.bounds.maxX,
    maxY: entry.bounds.maxY,
    entry,
  });
}

function deterministicTopmostOrder(
  left: SceneTreeItem,
  right: SceneTreeItem,
): number {
  if (left.entry.zOrder !== right.entry.zOrder) {
    return left.entry.zOrder > right.entry.zOrder ? -1 : 1;
  }
  if (left.entry.id === right.entry.id) return 0;
  return left.entry.id < right.entry.id ? -1 : 1;
}

function parseBooleanOption(
  value: unknown,
  fallback: boolean,
): boolean | null {
  if (value === undefined) return fallback;
  return typeof value === "boolean" ? value : null;
}

function parseSearchOptions(
  value: unknown,
  limits: ResolvedLimits,
): ParsedSearchOptions | null {
  if (
    value === undefined
    || (
      isPlainRecord(value)
      && hasExactKeys(
        value,
        [],
        ["includeHidden", "includeLocked", "interactiveOnly", "limit"],
      )
    )
  ) {
    const options = value ?? {};
    const includeHidden = parseBooleanOption(options.includeHidden, false);
    const includeLocked = parseBooleanOption(options.includeLocked, true);
    const interactiveOnly = parseBooleanOption(options.interactiveOnly, false);
    const limit = options.limit ?? limits.maxSearchResults;
    if (
      includeHidden === null
      || includeLocked === null
      || interactiveOnly === null
      || !Number.isSafeInteger(limit)
      || typeof limit !== "number"
      || limit <= 0
      || limit > limits.maxSearchResults
    ) {
      return null;
    }
    return Object.freeze({
      includeHidden,
      includeLocked,
      interactiveOnly,
      limit,
    });
  }
  return null;
}

function parsePointHitOptions(
  value: unknown,
): Readonly<{ includeHidden: boolean; includeLocked: boolean }> | null {
  if (
    value !== undefined
    && (
      !isPlainRecord(value)
      || !hasExactKeys(value, [], ["includeHidden", "includeLocked"])
    )
  ) {
    return null;
  }
  const options = value ?? {};
  const includeHidden = parseBooleanOption(options.includeHidden, false);
  const includeLocked = parseBooleanOption(options.includeLocked, false);
  if (includeHidden === null || includeLocked === null) return null;
  return Object.freeze({ includeHidden, includeLocked });
}

function passesSearchPolicy(
  item: SceneTreeItem,
  options: ParsedSearchOptions,
): boolean {
  return (options.includeHidden || !item.entry.hidden)
    && (options.includeLocked || !item.entry.locked)
    && (!options.interactiveOnly || item.entry.interactive);
}

function containsPoint(
  item: SceneTreeItem,
  point: StudioEngineSceneSpatialPoint,
): boolean {
  return point.x >= item.minX
    && point.x <= item.maxX
    && point.y >= item.minY
    && point.y <= item.maxY;
}

export class StudioEngineSceneSpatialIndex {
  private tree: RBush<SceneTreeItem>;
  private entriesById = new Map<string, SceneTreeItem>();
  private readonly limits: ResolvedLimits;
  private disposed = false;
  private mutationSequence = 0;

  constructor(options: StudioEngineSceneSpatialIndexOptions = {}) {
    if (!isPlainRecord(options) || !hasExactKeys(options, [], ["limits"])) {
      throw new TypeError("Spatial-index options contain unknown fields");
    }
    this.limits = resolveLimits(
      (options as StudioEngineSceneSpatialIndexOptions).limits,
    );
    this.tree = new RBush<SceneTreeItem>(this.limits.rbushMaxEntries);
  }

  public get size(): number {
    return this.entriesById.size;
  }

  public upsert(candidate: unknown): StudioEngineSceneSpatialUpsertResult {
    if (this.disposed) {
      return failure("disposed", "Scene spatial index is disposed");
    }
    const entry = parseEntry(candidate, this.limits);
    if (entry === null) {
      return failure("invalid-input", "Scene spatial entry is invalid");
    }
    const existing = this.entriesById.get(entry.id);
    if (existing === undefined && this.entriesById.size >= this.limits.maxEntries) {
      return failure("budget-exceeded", "Scene spatial entry budget exceeded");
    }
    const replacement = treeItem(entry);
    try {
      if (existing !== undefined) this.tree.remove(existing);
      this.tree.insert(replacement);
    } catch {
      if (existing !== undefined) {
        try {
          this.tree.insert(existing);
        } catch {
          return failure("index-failure", "RBush rollback failed");
        }
      }
      return failure("index-failure", "RBush upsert failed");
    }
    this.entriesById.set(entry.id, replacement);
    this.mutationSequence += 1;
    return Object.freeze({
      ok: true,
      replaced: existing !== undefined,
      entry,
      size: this.entriesById.size,
    });
  }

  public remove(idCandidate: unknown): StudioEngineSceneSpatialRemoveResult {
    if (this.disposed) {
      return failure("disposed", "Scene spatial index is disposed");
    }
    const id = parseIdentifier(idCandidate, this.limits);
    if (id === null) {
      return failure("invalid-input", "Scene spatial ID is invalid");
    }
    const existing = this.entriesById.get(id);
    if (existing === undefined) {
      return Object.freeze({ ok: true, removed: false, size: this.entriesById.size });
    }
    try {
      this.tree.remove(existing);
    } catch {
      return failure("index-failure", "RBush remove failed");
    }
    this.entriesById.delete(id);
    this.mutationSequence += 1;
    return Object.freeze({ ok: true, removed: true, size: this.entriesById.size });
  }

  public rebuild(candidates: unknown): StudioEngineSceneSpatialRebuildResult {
    if (this.disposed) {
      return failure("disposed", "Scene spatial index is disposed");
    }
    if (!Array.isArray(candidates)) {
      return failure("invalid-input", "Scene spatial rebuild input must be an array");
    }
    if (candidates.length > this.limits.maxEntries) {
      return failure("budget-exceeded", "Scene spatial rebuild exceeds the entry budget");
    }

    const nextEntries = new Map<string, SceneTreeItem>();
    const nextItems: SceneTreeItem[] = [];
    for (const candidate of candidates) {
      const entry = parseEntry(candidate, this.limits);
      if (entry === null) {
        return failure("invalid-input", "Scene spatial rebuild contains an invalid entry");
      }
      if (nextEntries.has(entry.id)) {
        return failure("duplicate-id", "Scene spatial rebuild contains a duplicate ID");
      }
      const item = treeItem(entry);
      nextEntries.set(entry.id, item);
      nextItems.push(item);
    }

    let nextTree: RBush<SceneTreeItem>;
    try {
      nextTree = new RBush<SceneTreeItem>(this.limits.rbushMaxEntries);
      nextTree.load(nextItems);
    } catch {
      return failure("index-failure", "RBush bulk rebuild failed");
    }
    this.tree = nextTree;
    this.entriesById = nextEntries;
    this.mutationSequence += 1;
    return Object.freeze({
      ok: true,
      entryCount: nextItems.length,
      size: this.entriesById.size,
    });
  }

  public bulkRebuild(candidates: unknown): StudioEngineSceneSpatialRebuildResult {
    return this.rebuild(candidates);
  }

  public search(
    boundsCandidate: unknown,
    optionsCandidate?: StudioEngineSceneSpatialSearchOptions,
  ): StudioEngineSceneSpatialSearchResult {
    if (this.disposed) {
      return failure("disposed", "Scene spatial index is disposed");
    }
    const bounds = parseBounds(boundsCandidate, this.limits);
    const options = parseSearchOptions(optionsCandidate, this.limits);
    if (bounds === null || options === null) {
      return failure("invalid-input", "Scene spatial search input is invalid");
    }

    let candidates: SceneTreeItem[];
    try {
      candidates = this.tree.search(bounds);
    } catch {
      return failure("index-failure", "RBush search failed");
    }
    if (candidates.length > this.limits.maxSearchCandidates) {
      return failure("budget-exceeded", "Scene spatial search candidate budget exceeded");
    }
    const entries = candidates
      .filter((item) => passesSearchPolicy(item, options))
      .sort(deterministicTopmostOrder)
      .slice(0, options.limit)
      .map((item) => item.entry);
    return Object.freeze({
      ok: true,
      entries: Object.freeze(entries),
      candidateCount: candidates.length,
    });
  }

  public hitTestPoint(
    pointCandidate: unknown,
    optionsCandidate?: StudioEngineSceneSpatialPointHitOptions,
  ): StudioEngineSceneSpatialPointHitResult {
    if (this.disposed) {
      return failure("disposed", "Scene spatial index is disposed");
    }
    if (
      !isPlainRecord(pointCandidate)
      || !hasExactKeys(pointCandidate, ["x", "y"])
      || typeof pointCandidate.x !== "number"
      || typeof pointCandidate.y !== "number"
      || !Number.isFinite(pointCandidate.x)
      || !Number.isFinite(pointCandidate.y)
      || Math.abs(pointCandidate.x) > this.limits.maxCoordinateAbsolute
      || Math.abs(pointCandidate.y) > this.limits.maxCoordinateAbsolute
    ) {
      return failure("invalid-input", "Scene spatial hit-test point is invalid");
    }
    const options = parsePointHitOptions(optionsCandidate);
    if (options === null) {
      return failure("invalid-input", "Scene spatial hit-test options are invalid");
    }
    const point = Object.freeze({ x: pointCandidate.x, y: pointCandidate.y });

    let candidates: SceneTreeItem[];
    try {
      candidates = this.tree.search({
        minX: point.x,
        minY: point.y,
        maxX: point.x,
        maxY: point.y,
      });
    } catch {
      return failure("index-failure", "RBush point search failed");
    }
    if (candidates.length > this.limits.maxSearchCandidates) {
      return failure("budget-exceeded", "Scene spatial hit-test candidate budget exceeded");
    }
    const topmost = candidates
      .filter((item) => (
        containsPoint(item, point)
        && item.entry.interactive
        && (options.includeHidden || !item.entry.hidden)
        && (options.includeLocked || !item.entry.locked)
      ))
      .sort(deterministicTopmostOrder)[0];
    return Object.freeze({
      ok: true,
      entry: topmost?.entry ?? null,
      candidateCount: candidates.length,
    });
  }

  public clear(): StudioEngineSceneSpatialRebuildResult {
    return this.rebuild([]);
  }

  public getSnapshot(): StudioEngineSceneSpatialIndexSnapshot {
    return Object.freeze({
      kind: "studio-engine-scene-spatial-index",
      version: STUDIO_ENGINE_SCENE_SPATIAL_INDEX_VERSION,
      phase: this.disposed ? "disposed" : "ready",
      size: this.entriesById.size,
      mutationSequence: this.mutationSequence,
    });
  }

  public dispose(): void {
    if (this.disposed) return;
    this.tree.clear();
    this.entriesById.clear();
    this.mutationSequence += 1;
    this.disposed = true;
  }
}

export function createStudioEngineSceneSpatialIndex(
  options?: StudioEngineSceneSpatialIndexOptions,
): StudioEngineSceneSpatialIndex {
  return new StudioEngineSceneSpatialIndex(options);
}
