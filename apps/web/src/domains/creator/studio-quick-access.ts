/**
 * Studio Quick Access — CLIP STUDIO-style command sets for a future dockable palette.
 *
 * This is deliberately separate from `studio-quick-actions`, which models the radial
 * pointer/pen menu. Quick Access is an ordered, durable command collection. The module
 * is pure: callers inject both command metadata and ID creation, and no DOM, storage,
 * account, project, provider, credential, or executor data crosses the durable boundary.
 */

import {
  studioSearchTextMatches,
  tokenizeStudioSearchQuery,
} from "./studio-search-text";

export const STUDIO_QUICK_ACCESS_VERSION = 1 as const;
export const STUDIO_QUICK_ACCESS_MAX_SETS = 12;
export const STUDIO_QUICK_ACCESS_MAX_COMMANDS = 64;
export const STUDIO_QUICK_ACCESS_MAX_SET_NAME_LENGTH = 64;
export const STUDIO_QUICK_ACCESS_MAX_ID_LENGTH = 128;
export const STUDIO_QUICK_ACCESS_MAX_SERIALIZED_LENGTH = 128 * 1024;

export const STUDIO_QUICK_ACCESS_DISPLAY_MODES = ["tiles", "list"] as const;
export const STUDIO_QUICK_ACCESS_DENSITIES = [
  "compact",
  "comfortable",
  "large",
] as const;

export type StudioQuickAccessDisplayMode =
  (typeof STUDIO_QUICK_ACCESS_DISPLAY_MODES)[number];
export type StudioQuickAccessDensity =
  (typeof STUDIO_QUICK_ACCESS_DENSITIES)[number];
export type StudioQuickAccessIdFactory = () => string;

export interface StudioQuickAccessSet {
  readonly id: string;
  readonly name: string;
  readonly commandIds: readonly string[];
}

/**
 * Exact durable allowlist. Metadata and command handlers belong to the injected catalog,
 * never to this state.
 */
export interface StudioQuickAccessState {
  readonly version: typeof STUDIO_QUICK_ACCESS_VERSION;
  readonly sets: readonly StudioQuickAccessSet[];
  readonly activeSetId: string;
  readonly displayMode: StudioQuickAccessDisplayMode;
  readonly density: StudioQuickAccessDensity;
}

export interface StudioQuickAccessCommandMeta {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly category?: string;
  readonly keywords?: readonly string[];
  readonly shortcut?: string;
  /** A registered command can still be unavailable in the current editor context. */
  readonly available?: boolean;
}

export interface StudioQuickAccessProjectedCommand {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly category?: string;
  readonly keywords: readonly string[];
  readonly shortcut?: string;
  readonly available: boolean;
}

export interface StudioQuickAccessProjection {
  readonly setId: string;
  readonly setName: string;
  readonly active: boolean;
  readonly commands: readonly StudioQuickAccessProjectedCommand[];
}

export type StudioQuickAccessExecutionPlan =
  | Readonly<{
    ok: true;
    setId: string;
    commandId: string;
  }>
  | Readonly<{
    ok: false;
    reason: "invalid-command" | "set-unavailable" | "not-in-set" | "unavailable";
  }>;

export const DEFAULT_STUDIO_QUICK_ACCESS_COMMAND_IDS = Object.freeze([
  "undo",
  "redo",
  "save",
  "pen",
  "eraser",
  "fill",
  "eyedropper",
  "select",
  "transform",
  "fit-canvas",
] as const);

const DEFAULT_SET_ID = "quick-access-default";
const DEFAULT_SET_NAME = "빠른 액세스 1";
const MAX_SET_INPUT_SCAN = STUDIO_QUICK_ACCESS_MAX_SETS * 8;
const MAX_COMMAND_INPUT_SCAN = STUDIO_QUICK_ACCESS_MAX_COMMANDS * 4;
const MAX_ID_FACTORY_ATTEMPTS = 24;
const MAX_CATALOG_ENTRIES = 4_096;
const MAX_CATALOG_INPUT_SCAN = MAX_CATALOG_ENTRIES * 2;
const MAX_CATALOG_TEXT_LENGTH = 256;
const MAX_CATALOG_KEYWORDS = 32;
const MAX_QUERY_LENGTH = 512;
const SAFE_OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/~-]*$/u;
const DISPLAY_MODE_SET = new Set<string>(STUDIO_QUICK_ACCESS_DISPLAY_MODES);
const DENSITY_SET = new Set<string>(STUDIO_QUICK_ACCESS_DENSITIES);
const CANONICAL_STATE_INSTANCES = new WeakSet<object>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readOwn(record: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

function normalizeOpaqueId(value: unknown): string | null {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > STUDIO_QUICK_ACCESS_MAX_ID_LENGTH
    || value.trim() !== value
    || !SAFE_OPAQUE_ID.test(value)
  ) {
    return null;
  }
  return value;
}

function normalizeHumanText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string" || value.length > maxLength * 16) return null;
  const normalized = value
    .normalize("NFKC")
    .replace(/[\p{Cc}\p{Cf}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (!normalized) return null;
  return Array.from(normalized).slice(0, maxLength).join("");
}

function fallbackSetName(index: number): string {
  return `빠른 액세스 ${index + 1}`;
}

function normalizeCommandIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const commandIds: string[] = [];
  const seen = new Set<string>();
  const scanLength = Math.min(value.length, MAX_COMMAND_INPUT_SCAN);
  for (let index = 0; index < scanLength; index += 1) {
    const commandId = normalizeOpaqueId(value[index]);
    if (!commandId || seen.has(commandId)) continue;
    seen.add(commandId);
    commandIds.push(commandId);
    if (commandIds.length >= STUDIO_QUICK_ACCESS_MAX_COMMANDS) break;
  }
  return commandIds;
}

function createCanonicalState(input: {
  sets: readonly StudioQuickAccessSet[];
  activeSetId: string;
  displayMode: StudioQuickAccessDisplayMode;
  density: StudioQuickAccessDensity;
}): StudioQuickAccessState {
  const state = deepFreeze({
    version: STUDIO_QUICK_ACCESS_VERSION,
    sets: input.sets.map((set) => ({
      id: set.id,
      name: set.name,
      commandIds: [...set.commandIds],
    })),
    activeSetId: input.activeSetId,
    displayMode: input.displayMode,
    density: input.density,
  });
  CANONICAL_STATE_INSTANCES.add(state);
  return state;
}

function createDefaultState(): StudioQuickAccessState {
  return createCanonicalState({
    sets: [{
      id: DEFAULT_SET_ID,
      name: DEFAULT_SET_NAME,
      commandIds: DEFAULT_STUDIO_QUICK_ACCESS_COMMAND_IDS,
    }],
    activeSetId: DEFAULT_SET_ID,
    displayMode: "tiles",
    density: "comfortable",
  });
}

export const DEFAULT_STUDIO_QUICK_ACCESS_STATE = createDefaultState();

function decodeDurableInput(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  if (raw.length > STUDIO_QUICK_ACCESS_MAX_SERIALIZED_LENGTH) return null;
  return JSON.parse(raw) as unknown;
}

function normalizeDecodedState(decoded: unknown): StudioQuickAccessState | null {
  if (!isRecord(decoded) || readOwn(decoded, "version") !== STUDIO_QUICK_ACCESS_VERSION) {
    return null;
  }
  const rawSets = readOwn(decoded, "sets");
  if (!Array.isArray(rawSets)) return null;

  const sets: StudioQuickAccessSet[] = [];
  const seenSetIds = new Set<string>();
  const scanLength = Math.min(rawSets.length, MAX_SET_INPUT_SCAN);
  for (let index = 0; index < scanLength; index += 1) {
    const rawSet = rawSets[index];
    if (!isRecord(rawSet)) continue;
    const id = normalizeOpaqueId(readOwn(rawSet, "id"));
    if (!id || seenSetIds.has(id)) continue;
    seenSetIds.add(id);
    const name = normalizeHumanText(
      readOwn(rawSet, "name"),
      STUDIO_QUICK_ACCESS_MAX_SET_NAME_LENGTH
    ) ?? fallbackSetName(sets.length);
    sets.push({
      id,
      name,
      commandIds: normalizeCommandIds(readOwn(rawSet, "commandIds")),
    });
    if (sets.length >= STUDIO_QUICK_ACCESS_MAX_SETS) break;
  }
  if (sets.length === 0) return null;

  const requestedActiveSetId = normalizeOpaqueId(readOwn(decoded, "activeSetId"));
  const activeSetId = requestedActiveSetId
    && sets.some((set) => set.id === requestedActiveSetId)
    ? requestedActiveSetId
    : sets[0]!.id;
  const rawDisplayMode = readOwn(decoded, "displayMode");
  const displayMode = typeof rawDisplayMode === "string" && DISPLAY_MODE_SET.has(rawDisplayMode)
    ? rawDisplayMode as StudioQuickAccessDisplayMode
    : "tiles";
  const rawDensity = readOwn(decoded, "density");
  const density = typeof rawDensity === "string" && DENSITY_SET.has(rawDensity)
    ? rawDensity as StudioQuickAccessDensity
    : "comfortable";

  return createCanonicalState({ sets, activeSetId, displayMode, density });
}

/**
 * Decodes an object or JSON string into the exact v1 durable allowlist.
 * Malformed, oversized, cyclic, getter-throwing, or unsupported-version input falls back safely.
 */
export function normalizeStudioQuickAccessState(raw: unknown): StudioQuickAccessState {
  if (
    typeof raw === "object"
    && raw !== null
    && CANONICAL_STATE_INSTANCES.has(raw)
  ) {
    return raw as StudioQuickAccessState;
  }
  try {
    return normalizeDecodedState(decodeDurableInput(raw)) ?? createDefaultState();
  } catch {
    return createDefaultState();
  }
}

/** Serializes only the documented durable fields after canonical normalization. */
export function encodeStudioQuickAccessState(raw: unknown): string {
  const state = normalizeStudioQuickAccessState(raw);
  return JSON.stringify({
    version: state.version,
    sets: state.sets.map((set) => ({
      id: set.id,
      name: set.name,
      commandIds: [...set.commandIds],
    })),
    activeSetId: state.activeSetId,
    displayMode: state.displayMode,
    density: state.density,
  });
}

function canonicalInput(state: StudioQuickAccessState): StudioQuickAccessState {
  return normalizeStudioQuickAccessState(state);
}

function withSets(
  state: StudioQuickAccessState,
  sets: readonly StudioQuickAccessSet[],
  activeSetId = state.activeSetId
): StudioQuickAccessState {
  return createCanonicalState({
    sets,
    activeSetId,
    displayMode: state.displayMode,
    density: state.density,
  });
}

function allocateSetId(
  state: StudioQuickAccessState,
  idFactory: StudioQuickAccessIdFactory
): string | null {
  const usedIds = new Set(state.sets.map((set) => set.id));
  for (let attempt = 0; attempt < MAX_ID_FACTORY_ATTEMPTS; attempt += 1) {
    try {
      const candidate = normalizeOpaqueId(idFactory());
      if (candidate && !usedIds.has(candidate)) return candidate;
    } catch {
      return null;
    }
  }
  return null;
}

/** Creates an empty set, selects it, and uses only the injected deterministic ID source. */
export function createStudioQuickAccessSet(
  state: StudioQuickAccessState,
  name: string,
  idFactory: StudioQuickAccessIdFactory
): StudioQuickAccessState {
  const current = canonicalInput(state);
  if (current.sets.length >= STUDIO_QUICK_ACCESS_MAX_SETS) return current;
  const id = allocateSetId(current, idFactory);
  if (!id) return current;
  const normalizedName = normalizeHumanText(name, STUDIO_QUICK_ACCESS_MAX_SET_NAME_LENGTH)
    ?? fallbackSetName(current.sets.length);
  return withSets(
    current,
    [...current.sets, { id, name: normalizedName, commandIds: [] }],
    id
  );
}

export function renameStudioQuickAccessSet(
  state: StudioQuickAccessState,
  setId: string,
  name: string
): StudioQuickAccessState {
  const current = canonicalInput(state);
  const normalizedName = normalizeHumanText(name, STUDIO_QUICK_ACCESS_MAX_SET_NAME_LENGTH);
  const targetId = normalizeOpaqueId(setId);
  if (!targetId || !normalizedName) return current;
  const index = current.sets.findIndex((set) => set.id === targetId);
  if (index < 0 || current.sets[index]!.name === normalizedName) return current;
  const sets = [...current.sets];
  sets[index] = { ...sets[index]!, name: normalizedName };
  return withSets(current, sets);
}

/** Duplicates immediately after the source and activates the copy. */
export function duplicateStudioQuickAccessSet(
  state: StudioQuickAccessState,
  setId: string,
  idFactory: StudioQuickAccessIdFactory,
  name?: string
): StudioQuickAccessState {
  const current = canonicalInput(state);
  if (current.sets.length >= STUDIO_QUICK_ACCESS_MAX_SETS) return current;
  const sourceIndex = current.sets.findIndex((set) => set.id === setId);
  if (sourceIndex < 0) return current;
  const id = allocateSetId(current, idFactory);
  if (!id) return current;
  const source = current.sets[sourceIndex]!;
  const duplicateName = normalizeHumanText(
    name ?? `${source.name} 복사본`,
    STUDIO_QUICK_ACCESS_MAX_SET_NAME_LENGTH
  ) ?? fallbackSetName(current.sets.length);
  const sets = [...current.sets];
  sets.splice(sourceIndex + 1, 0, {
    id,
    name: duplicateName,
    commandIds: [...source.commandIds],
  });
  return withSets(current, sets, id);
}

/** Keeps the invariant of at least one set and selects the nearest surviving set. */
export function deleteStudioQuickAccessSet(
  state: StudioQuickAccessState,
  setId: string
): StudioQuickAccessState {
  const current = canonicalInput(state);
  if (current.sets.length <= 1) return current;
  const index = current.sets.findIndex((set) => set.id === setId);
  if (index < 0) return current;
  const sets = current.sets.filter((set) => set.id !== setId);
  const activeSetId = current.activeSetId === setId
    ? sets[Math.min(index, sets.length - 1)]!.id
    : current.activeSetId;
  return withSets(current, sets, activeSetId);
}

function clampIndex(index: number, length: number): number | null {
  if (!Number.isInteger(index) || length <= 0) return null;
  return Math.max(0, Math.min(length - 1, index));
}

export function reorderStudioQuickAccessSet(
  state: StudioQuickAccessState,
  setId: string,
  toIndex: number
): StudioQuickAccessState {
  const current = canonicalInput(state);
  const fromIndex = current.sets.findIndex((set) => set.id === setId);
  const targetIndex = clampIndex(toIndex, current.sets.length);
  if (fromIndex < 0 || targetIndex === null || fromIndex === targetIndex) return current;
  const sets = [...current.sets];
  const [moved] = sets.splice(fromIndex, 1);
  sets.splice(targetIndex, 0, moved!);
  return withSets(current, sets);
}

export function activateStudioQuickAccessSet(
  state: StudioQuickAccessState,
  setId: string
): StudioQuickAccessState {
  const current = canonicalInput(state);
  if (current.activeSetId === setId || !current.sets.some((set) => set.id === setId)) {
    return current;
  }
  return withSets(current, current.sets, setId);
}

export function configureStudioQuickAccessView(
  state: StudioQuickAccessState,
  view: Readonly<{
    displayMode?: StudioQuickAccessDisplayMode;
    density?: StudioQuickAccessDensity;
  }>
): StudioQuickAccessState {
  const current = canonicalInput(state);
  const displayMode = typeof view.displayMode === "string" && DISPLAY_MODE_SET.has(view.displayMode)
    ? view.displayMode
    : current.displayMode;
  const density = typeof view.density === "string" && DENSITY_SET.has(view.density)
    ? view.density
    : current.density;
  if (displayMode === current.displayMode && density === current.density) return current;
  return createCanonicalState({
    sets: current.sets,
    activeSetId: current.activeSetId,
    displayMode,
    density,
  });
}

function updateSetCommands(
  state: StudioQuickAccessState,
  setId: string,
  updater: (commandIds: readonly string[]) => readonly string[] | null
): StudioQuickAccessState {
  const current = canonicalInput(state);
  const index = current.sets.findIndex((set) => set.id === setId);
  if (index < 0) return current;
  const commandIds = updater(current.sets[index]!.commandIds);
  if (!commandIds) return current;
  const previousCommandIds = current.sets[index]!.commandIds;
  if (
    commandIds.length === previousCommandIds.length
    && commandIds.every((commandId, commandIndex) => (
      commandId === previousCommandIds[commandIndex]
    ))
  ) {
    return current;
  }
  const sets = [...current.sets];
  sets[index] = { ...sets[index]!, commandIds };
  return withSets(current, sets);
}

export function addStudioQuickAccessCommand(
  state: StudioQuickAccessState,
  setId: string,
  commandId: string,
  toIndex = Number.POSITIVE_INFINITY
): StudioQuickAccessState {
  const normalizedCommandId = normalizeOpaqueId(commandId);
  if (!normalizedCommandId) return canonicalInput(state);
  return updateSetCommands(state, setId, (commandIds) => {
    if (
      commandIds.includes(normalizedCommandId)
      || commandIds.length >= STUDIO_QUICK_ACCESS_MAX_COMMANDS
    ) {
      return null;
    }
    const targetIndex = Number.isFinite(toIndex)
      ? Math.max(0, Math.min(commandIds.length, Math.trunc(toIndex)))
      : commandIds.length;
    const next = [...commandIds];
    next.splice(targetIndex, 0, normalizedCommandId);
    return next;
  });
}

export function removeStudioQuickAccessCommand(
  state: StudioQuickAccessState,
  setId: string,
  commandId: string
): StudioQuickAccessState {
  return updateSetCommands(state, setId, (commandIds) => (
    commandIds.includes(commandId)
      ? commandIds.filter((id) => id !== commandId)
      : null
  ));
}

export function reorderStudioQuickAccessCommand(
  state: StudioQuickAccessState,
  setId: string,
  commandId: string,
  toIndex: number
): StudioQuickAccessState {
  return updateSetCommands(state, setId, (commandIds) => {
    const fromIndex = commandIds.indexOf(commandId);
    const targetIndex = clampIndex(toIndex, commandIds.length);
    if (fromIndex < 0 || targetIndex === null || fromIndex === targetIndex) return null;
    const next = [...commandIds];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(targetIndex, 0, moved!);
    return next;
  });
}

/**
 * Restores the active set's command contents while preserving that user set's stable ID/name
 * and the palette view. Full restoration below resets the entire durable model.
 */
export function restoreActiveStudioQuickAccessSetDefaults(
  state: StudioQuickAccessState
): StudioQuickAccessState {
  const current = canonicalInput(state);
  return updateSetCommands(current, current.activeSetId, () => [
    ...DEFAULT_STUDIO_QUICK_ACCESS_COMMAND_IDS,
  ]);
}

export function restoreAllStudioQuickAccessDefaults(): StudioQuickAccessState {
  return createDefaultState();
}

function normalizeCatalogText(value: unknown): string | undefined {
  return normalizeHumanText(value, MAX_CATALOG_TEXT_LENGTH) ?? undefined;
}

function normalizeCatalogKeywords(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const keywords: string[] = [];
  const seen = new Set<string>();
  const scanLength = Math.min(value.length, MAX_CATALOG_KEYWORDS * 4);
  for (let index = 0; index < scanLength; index += 1) {
    const keyword = normalizeCatalogText(value[index]);
    const key = keyword?.normalize("NFKC").toLowerCase();
    if (!keyword || !key || seen.has(key)) continue;
    seen.add(key);
    keywords.push(keyword);
    if (keywords.length >= MAX_CATALOG_KEYWORDS) break;
  }
  return keywords;
}

function normalizeCommandCatalog(
  catalog: readonly StudioQuickAccessCommandMeta[]
): readonly StudioQuickAccessCommandMeta[] {
  const entries: StudioQuickAccessCommandMeta[] = [];
  try {
    if (!Array.isArray(catalog)) return Object.freeze(entries);
    const seen = new Set<string>();
    const scanLength = Math.min(catalog.length, MAX_CATALOG_INPUT_SCAN);
    for (let index = 0; index < scanLength; index += 1) {
      try {
        const raw = catalog[index];
        if (!isRecord(raw)) continue;
        const id = normalizeOpaqueId(readOwn(raw, "id"));
        if (!id || seen.has(id)) continue;
        const label = normalizeCatalogText(readOwn(raw, "label")) ?? id;
        const description = normalizeCatalogText(readOwn(raw, "description"));
        const category = normalizeCatalogText(readOwn(raw, "category"));
        const keywords = normalizeCatalogKeywords(readOwn(raw, "keywords"));
        const shortcut = normalizeCatalogText(readOwn(raw, "shortcut"));
        const available = readOwn(raw, "available") !== false;
        seen.add(id);
        entries.push({
          id,
          label,
          ...(description ? { description } : {}),
          ...(category ? { category } : {}),
          keywords,
          ...(shortcut ? { shortcut } : {}),
          available,
        });
        if (entries.length >= MAX_CATALOG_ENTRIES) break;
      } catch {
        // A hostile metadata getter invalidates only that entry, not the whole palette.
      }
    }
  } catch {
    // Revoked proxies and hostile array traps yield the safe prefix collected so far.
  }
  return deepFreeze(entries);
}

/**
 * Searches injected metadata using NFKC/case-insensitive AND-token matching.
 * Results contain only bounded, inert metadata; handlers and arbitrary catalog fields are dropped.
 */
export function searchStudioQuickAccessCommands(
  catalog: readonly StudioQuickAccessCommandMeta[],
  query: string
): readonly StudioQuickAccessCommandMeta[] {
  const entries = normalizeCommandCatalog(catalog);
  const safeQuery = typeof query === "string" ? query.slice(0, MAX_QUERY_LENGTH) : "";
  // 매칭 규칙은 통합 Command Search 와 같은 `studio-search-text` 를 쓴다.
  // 신뢰 경계(길이 제한·메타데이터 정규화)는 여기 그대로 남는다.
  if (tokenizeStudioSearchQuery(safeQuery).length === 0) return entries;
  return deepFreeze(entries.filter((entry) =>
    studioSearchTextMatches(safeQuery, [
      entry.id,
      entry.label,
      entry.description ?? "",
      entry.category ?? "",
      ...(entry.keywords ?? []),
      entry.shortcut ?? "",
    ])
  ));
}

function catalogMap(
  catalog: readonly StudioQuickAccessCommandMeta[]
): ReadonlyMap<string, StudioQuickAccessCommandMeta> {
  return new Map(normalizeCommandCatalog(catalog).map((entry) => [entry.id, entry]));
}

function resolveSet(
  state: StudioQuickAccessState,
  setId?: string
): StudioQuickAccessSet | null {
  const requestedId = setId ?? state.activeSetId;
  return state.sets.find((set) => set.id === requestedId) ?? null;
}

/**
 * Projects durable IDs for UI. Unknown IDs stay in position but are visibly unavailable.
 */
export function projectStudioQuickAccessSet(
  state: StudioQuickAccessState,
  catalog: readonly StudioQuickAccessCommandMeta[],
  setId?: string
): StudioQuickAccessProjection | null {
  const current = canonicalInput(state);
  const set = resolveSet(current, setId);
  if (!set) return null;
  const metadataById = catalogMap(catalog);
  const commands = set.commandIds.map((id): StudioQuickAccessProjectedCommand => {
    const metadata = metadataById.get(id);
    if (!metadata) {
      return {
        id,
        label: id,
        keywords: [],
        available: false,
      };
    }
    return {
      id,
      label: metadata.label,
      ...(metadata.description ? { description: metadata.description } : {}),
      ...(metadata.category ? { category: metadata.category } : {}),
      keywords: [...(metadata.keywords ?? [])],
      ...(metadata.shortcut ? { shortcut: metadata.shortcut } : {}),
      available: metadata.available !== false,
    };
  });
  return deepFreeze({
    setId: set.id,
    setName: set.name,
    active: set.id === current.activeSetId,
    commands,
  });
}

/**
 * Fail-closed execution boundary. A command must be valid, present in the selected set,
 * registered in the injected catalog, and currently available. The caller then resolves
 * the returned ID through its trusted executor registry.
 */
export function planStudioQuickAccessExecution(
  state: StudioQuickAccessState,
  catalog: readonly StudioQuickAccessCommandMeta[],
  commandId: string,
  setId?: string
): StudioQuickAccessExecutionPlan {
  const normalizedCommandId = normalizeOpaqueId(commandId);
  if (!normalizedCommandId) {
    return Object.freeze({ ok: false, reason: "invalid-command" });
  }
  const current = canonicalInput(state);
  const set = resolveSet(current, setId);
  if (!set) return Object.freeze({ ok: false, reason: "set-unavailable" });
  if (!set.commandIds.includes(normalizedCommandId)) {
    return Object.freeze({ ok: false, reason: "not-in-set" });
  }
  const metadata = catalogMap(catalog).get(normalizedCommandId);
  if (!metadata || metadata.available === false) {
    return Object.freeze({ ok: false, reason: "unavailable" });
  }
  return Object.freeze({
    ok: true,
    setId: set.id,
    commandId: normalizedCommandId,
  });
}
