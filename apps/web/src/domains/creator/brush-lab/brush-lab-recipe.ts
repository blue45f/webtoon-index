/** Pure, bounded recipe planning. A recipe selects traits, never executable code or renderer URLs. */
export const BRUSH_LAB_SLOT_IDS = [
  "tip", "dual-tip", "surface", "pigment", "size-opacity", "flow-spacing", "scatter-orientation", "taper",
] as const;

export type BrushLabSlotId = (typeof BRUSH_LAB_SLOT_IDS)[number];
export interface BrushLabSlot {
  readonly id: BrushLabSlotId;
  readonly sourceId: string | null;
  readonly locked: boolean;
}
export interface BrushLabRecipe {
  readonly version: 1;
  readonly carrierId: string;
  readonly seed: number;
  readonly slots: readonly BrushLabSlot[];
}
export const BRUSH_LAB_MAX_VARIANTS = 12;
export const BRUSH_LAB_MAX_DONORS = 256;
export const BRUSH_LAB_MAX_RECIPE_CHARS = 32768;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("레시피 객체가 올바르지 않습니다.");
  return value as Record<string, unknown>;
}
function brushId(value: unknown): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9:_/-]{0,159}$/u.test(value)) {
    throw new Error("브러시 식별자가 올바르지 않습니다.");
  }
  return value;
}

/** Reject unknown schemas and ambiguous slot ordering instead of silently changing a recipe. */
export function parseBrushLabRecipe(text: string): BrushLabRecipe {
  if (text.length > BRUSH_LAB_MAX_RECIPE_CHARS) throw new Error("레시피 파일이 너무 큽니다.");
  const source = record(JSON.parse(text) as unknown);
  if (source.version !== 1) throw new Error("지원하지 않는 레시피 버전입니다.");
  const carrierId = brushId(source.carrierId);
  if (typeof source.seed !== "number" || !Number.isInteger(source.seed) || source.seed < 0 || source.seed > 0xffffffff) {
    throw new Error("시드는 0부터 4294967295 사이의 정수여야 합니다.");
  }
  if (!Array.isArray(source.slots) || source.slots.length !== BRUSH_LAB_SLOT_IDS.length) {
    throw new Error("레시피에는 8개의 독립 속성이 필요합니다.");
  }
  const slots = BRUSH_LAB_SLOT_IDS.map((id): BrushLabSlot => {
    const matches = (source.slots as unknown[]).map(record).filter((slot) => slot.id === id);
    if (matches.length !== 1) throw new Error("알 수 없거나 중복된 속성이 있습니다.");
    const slot = matches[0]!;
    if (typeof slot.locked !== "boolean") throw new Error("속성 잠금 값이 올바르지 않습니다.");
    return { id, sourceId: slot.sourceId === null ? null : brushId(slot.sourceId), locked: slot.locked };
  });
  return { version: 1, carrierId, seed: source.seed, slots };
}

export function createBrushLabRecipe(carrierId: string, seed = 20260906): BrushLabRecipe {
  return parseBrushLabRecipe(JSON.stringify({
    version: 1, carrierId, seed,
    slots: BRUSH_LAB_SLOT_IDS.map((id) => ({ id, sourceId: null, locked: false })),
  }));
}

export function updateBrushLabSlot(recipe: BrushLabRecipe, id: BrushLabSlotId, patch: Partial<Pick<BrushLabSlot, "sourceId" | "locked">>): BrushLabRecipe {
  return parseBrushLabRecipe(JSON.stringify({
    ...recipe, slots: recipe.slots.map((slot) => slot.id === id ? { ...slot, ...patch } : slot),
  }));
}

function randomSource(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** Counts recipe identity, NOT distinct visual appearances. Rendering is a separate authority. */
export function brushLabRecipeKey(recipe: BrushLabRecipe): string {
  return JSON.stringify([recipe.carrierId, ...recipe.slots.map((slot) => [slot.id, slot.sourceId])]);
}

/** Same seed + same set of donors => same results regardless of catalogue arrival order. */
export function generateBrushLabVariants(
  recipe: BrushLabRecipe,
  donorIds: readonly string[],
  requested = 8,
  mutationCount = 2,
): BrushLabRecipe[] {
  const base = parseBrushLabRecipe(JSON.stringify(recipe));
  const donors = [...new Set(donorIds.map(brushId))].sort().slice(0, BRUSH_LAB_MAX_DONORS);
  const mutable = base.slots.filter((slot) => !slot.locked && donors.some((id) => id !== slot.sourceId));
  const count = Number.isFinite(requested) ? Math.max(0, Math.min(BRUSH_LAB_MAX_VARIANTS, Math.floor(requested))) : 0;
  const mutations = Number.isFinite(mutationCount) ? Math.max(1, Math.min(mutable.length, Math.floor(mutationCount))) : 1;
  if (!donors.length || !mutable.length || !count) return [];
  const random = randomSource(base.seed);
  const seen = new Set([brushLabRecipeKey(base)]);
  const result: BrushLabRecipe[] = [];
  // Strict budget also covers exhausted tiny search spaces and fully equivalent recipes.
  for (let attempt = 0; attempt < count * 48 && result.length < count; attempt++) {
    const available = [...mutable];
    const replacements = new Map<BrushLabSlotId, string>();
    for (let index = 0; index < mutations && available.length; index++) {
      const selected = available.splice(Math.floor(random() * available.length), 1)[0]!;
      const alternatives = donors.filter((id) => id !== selected.sourceId);
      replacements.set(selected.id, alternatives[Math.floor(random() * alternatives.length)]!);
    }
    const variant: BrushLabRecipe = {
      ...base,
      slots: base.slots.map((slot) => replacements.has(slot.id) ? { ...slot, sourceId: replacements.get(slot.id)! } : { ...slot }),
    };
    const key = brushLabRecipeKey(variant);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(variant);
  }
  return result;
}

export interface BrushLabHistory<T> {
  readonly past: readonly T[];
  readonly present: T;
  readonly future: readonly T[];
}
export const BRUSH_LAB_HISTORY_LIMIT = 24;
/** UTF-16 serialized estimate for past + future, not a claim about measured JS heap usage. */
export const BRUSH_LAB_HISTORY_ESTIMATED_BYTES = 2 * 1024 * 1024;

function serialized(value: unknown): string | undefined {
  try { return JSON.stringify(value); } catch { return undefined; }
}

function trimHistorySide<T>(entries: readonly T[], newestAtEnd: boolean): T[] {
  const kept: T[] = [];
  let bytes = 0;
  // Preserve adjacent undo/redo states. Never skip an oversized state to jump across it.
  const nearest = newestAtEnd ? [...entries].reverse() : entries;
  for (const entry of nearest) {
    if (kept.length === BRUSH_LAB_HISTORY_LIMIT) break;
    const text = serialized(entry);
    if (text === undefined || bytes + text.length * 2 > BRUSH_LAB_HISTORY_ESTIMATED_BYTES / 2) break;
    bytes += text.length * 2;
    kept.push(entry);
  }
  return newestAtEnd ? kept.reverse() : kept;
}

export function commitBrushLabHistory<T>(history: BrushLabHistory<T>, next: T): BrushLabHistory<T> {
  if (Object.is(history.present, next)) return history;
  const currentText = serialized(history.present);
  if (currentText !== undefined && currentText === serialized(next)) return history;
  return { past: trimHistorySide([...history.past, history.present], true), present: next, future: [] };
}
export function moveBrushLabHistory<T>(history: BrushLabHistory<T>, direction: "undo" | "redo"): BrushLabHistory<T> {
  if (direction === "undo") {
    if (!history.past.length) return history;
    return {
      past: trimHistorySide(history.past.slice(0, -1), true), present: history.past[history.past.length - 1]!,
      future: trimHistorySide([history.present, ...history.future], false),
    };
  }
  if (!history.future.length) return history;
  return {
    past: trimHistorySide([...history.past, history.present], true),
    present: history.future[0]!, future: trimHistorySide(history.future.slice(1), false),
  };
}

function assertNotAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error("브러시 조합을 취소했습니다.");
  error.name = "AbortError";
  throw error;
}

/** Dependency-injected transaction: missing donors never produce a partially applied mixture. */
export async function resolveBrushLabTraits<T>(
  recipe: BrushLabRecipe,
  baseline: T,
  load: (sourceId: string) => Promise<T | null>,
  merge: (slot: BrushLabSlotId, current: T, source: T) => T,
  signal?: AbortSignal,
): Promise<T> {
  assertNotAborted(signal);
  const valid = parseBrushLabRecipe(JSON.stringify(recipe));
  const sources = new Map<string, T>();
  // At most eight donors, deliberately sequential to bound optional chunk/texture work.
  for (const slot of valid.slots) {
    if (slot.sourceId === null || sources.has(slot.sourceId)) continue;
    assertNotAborted(signal);
    const source = await load(slot.sourceId);
    assertNotAborted(signal);
    if (source == null) throw new Error(`조합할 수 없는 속성 소스입니다: ${slot.sourceId}`);
    sources.set(slot.sourceId, source);
  }
  assertNotAborted(signal);
  let result = baseline;
  for (const slot of valid.slots) {
    if (slot.sourceId !== null) result = merge(slot.id, result, sources.get(slot.sourceId)!);
  }
  return result;
}
