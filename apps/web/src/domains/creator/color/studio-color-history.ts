/**
 * studio-color-history.ts
 *
 * Clip Studio Paint Color History Palette (컬러 히스토리 팔레트) model.
 * Maintains an immutable list of recently used painting colors, ensuring deduplication
 * at the top of the stack and capping at a configurable capacity (default 32 swatches).
 */

export const DEFAULT_COLOR_HISTORY_CAPACITY = 32;

export const INITIAL_COLOR_HISTORY: readonly string[] = Object.freeze([
  "#000000",
  "#ffffff",
  "#fcd5b5",
  "#e89a7a",
  "#7c5cfc",
  "#3b82f6",
  "#10b981",
  "#ef4444",
  "#f59e0b",
  "#1e293b",
]);

/**
 * Adds a new hex color to the front of the color history list.
 * Deduplicates existing instances so the most recently used color stays at index 0.
 */
export function addColorToHistory(
  history: readonly string[],
  color: string,
  capacity: number = DEFAULT_COLOR_HISTORY_CAPACITY,
): readonly string[] {
  const normalized = color.trim().toLowerCase();
  if (!/^#[0-9a-f]{6}$/i.test(normalized)) {
    return history;
  }

  const filtered = history.filter((c) => c.toLowerCase() !== normalized);
  const next = [normalized, ...filtered].slice(0, capacity);
  return Object.freeze(next);
}

/**
 * Clears the color history, optionally preserving default starter colors.
 */
export function clearColorHistory(): readonly string[] {
  return Object.freeze([]);
}
