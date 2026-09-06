/**
 * Recent brush slots (1–6).
 * Stores the canonical engine id plus the exact source preset and dynamics for quick recall.
 * Pure model plus legacy browser-storage helpers.
 *
 * V12 product durability is owned by studio-brush-slots-sqlite-repository.ts. The storage
 * helpers below remain an explicit legacy/test seam only; the SQLite repository never reads or
 * automatically imports either key (LEGACY_DATA_MIGRATION=false).
 */

import { BRUSH_PRESETS } from "../studio-brush";

import {
  normalizeStudioBrushDynamicsSettings,
  studioBrushDynamicsSettingsEqual,
  type NormalizedStudioBrushDynamicsSettings,
} from "./studio-brush-dynamics";
import {
  BRUSH_OPACITY_RANGE,
  BRUSH_STROKE_WIDTH_RANGE,
  normalizeStudioBrushSourcePresetMetadata,
  type StudioBrushSourcePresetMetadata,
} from "./studio-brush-library";

export const STUDIO_BRUSH_SLOT_COUNT = 6;
export const STUDIO_BRUSH_SLOTS_LEGACY_STORAGE_KEY = "toonspectrum-studio-brush-slots:v1";
export const STUDIO_BRUSH_SLOTS_STORAGE_KEY = "toonspectrum-studio-brush-slots:v2";
export const STUDIO_BRUSH_SLOTS_LEGACY_AUTO_MIGRATION = false as const;

export interface StudioBrushSlot extends StudioBrushSourcePresetMetadata {
  /** 실제 렌더러는 언제나 설치된 BRUSH_PRESETS id만 사용한다. */
  brushId: string;
  strokeWidth: number;
  brushOpacity: number;
  /** 팩 프리셋의 압력·산포·팁을 포함한 전체 동역학. v1 슬롯은 이 필드가 없다. */
  brushDynamics?: NormalizedStudioBrushDynamicsSettings;
}

export interface StudioBrushSlotsState {
  slots: (StudioBrushSlot | null)[];
}

export interface StudioBrushSlotsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function clampWidth(n: number): number {
  if (!Number.isFinite(n)) return BRUSH_STROKE_WIDTH_RANGE[0];
  return Math.min(BRUSH_STROKE_WIDTH_RANGE[1], Math.max(BRUSH_STROKE_WIDTH_RANGE[0], Math.round(n)));
}

function clampOpacity(n: number): number {
  if (!Number.isFinite(n)) return BRUSH_OPACITY_RANGE[1];
  return Math.min(BRUSH_OPACITY_RANGE[1], Math.max(BRUSH_OPACITY_RANGE[0], Math.round(n * 100) / 100));
}

function knownBrushId(id: string): boolean {
  return BRUSH_PRESETS.some((p) => p.id === id);
}

export function emptyStudioBrushSlots(): StudioBrushSlotsState {
  return { slots: Array.from({ length: STUDIO_BRUSH_SLOT_COUNT }, () => null) };
}

export function normalizeStudioBrushSlot(value: unknown): StudioBrushSlot | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.brushId !== "string" || !knownBrushId(record.brushId)) return null;
  const sourcePresetMetadata = normalizeStudioBrushSourcePresetMetadata(record);
  const brushDynamics = record.brushDynamics === undefined || record.brushDynamics === null
    ? undefined
    : normalizeStudioBrushDynamicsSettings(record.brushDynamics);
  return {
    ...sourcePresetMetadata,
    brushId: record.brushId,
    strokeWidth: clampWidth(Number(record.strokeWidth)),
    brushOpacity: clampOpacity(Number(record.brushOpacity)),
    ...(brushDynamics ? { brushDynamics } : {}),
  };
}

export function normalizeStudioBrushSlotsState(value?: unknown): StudioBrushSlotsState {
  const empty = emptyStudioBrushSlots();
  if (!value || typeof value !== "object") return empty;
  const record = value as Record<string, unknown>;
  const raw = Array.isArray(record.slots) ? record.slots : Array.isArray(value) ? value : [];
  const slots = empty.slots.map((_, index) => normalizeStudioBrushSlot(raw[index]));
  return { slots };
}

export function loadStudioBrushSlotsState(
  storage: StudioBrushSlotsStorage | null | undefined
): StudioBrushSlotsState {
  if (!storage) return emptyStudioBrushSlots();
  try {
    const raw = storage.getItem(STUDIO_BRUSH_SLOTS_STORAGE_KEY)
      ?? storage.getItem(STUDIO_BRUSH_SLOTS_LEGACY_STORAGE_KEY);
    if (!raw) return emptyStudioBrushSlots();
    return normalizeStudioBrushSlotsState(JSON.parse(raw));
  } catch {
    return emptyStudioBrushSlots();
  }
}

function studioBrushSlotsEqual(left: StudioBrushSlot, right: StudioBrushSlot): boolean {
  const dynamicsEqual = left.brushDynamics === undefined && right.brushDynamics === undefined
    || left.brushDynamics !== undefined
      && right.brushDynamics !== undefined
      && studioBrushDynamicsSettingsEqual(left.brushDynamics, right.brushDynamics);
  return left.brushId === right.brushId
    && left.strokeWidth === right.strokeWidth
    && left.brushOpacity === right.brushOpacity
    && left.sourcePresetId === right.sourcePresetId
    && left.sourcePresetName === right.sourcePresetName
    && dynamicsEqual;
}

export function saveStudioBrushSlotsState(
  storage: StudioBrushSlotsStorage | null | undefined,
  state: StudioBrushSlotsState
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(
      STUDIO_BRUSH_SLOTS_STORAGE_KEY,
      JSON.stringify(normalizeStudioBrushSlotsState(state))
    );
    return true;
  } catch {
    return false;
  }
}

/** Push current brush to the front of recent slots (quick recall). */
export function rememberStudioBrushSlot(
  state: StudioBrushSlotsState,
  next: StudioBrushSlot
): StudioBrushSlotsState {
  const slot = normalizeStudioBrushSlot(next);
  if (!slot) return normalizeStudioBrushSlotsState(state);
  const rest = normalizeStudioBrushSlotsState(state).slots.filter(
    (item) => item && !studioBrushSlotsEqual(item, slot)
  );
  return normalizeStudioBrushSlotsState({
    slots: [slot, ...rest].slice(0, STUDIO_BRUSH_SLOT_COUNT),
  });
}

/** Assign current brush into a numbered slot (1–6). */
export function assignStudioBrushSlot(
  state: StudioBrushSlotsState,
  index: number,
  next: StudioBrushSlot
): StudioBrushSlotsState {
  if (!Number.isInteger(index) || index < 0 || index >= STUDIO_BRUSH_SLOT_COUNT) {
    return normalizeStudioBrushSlotsState(state);
  }
  const slot = normalizeStudioBrushSlot(next);
  const slots = [...normalizeStudioBrushSlotsState(state).slots];
  slots[index] = slot;
  return { slots };
}

export function studioBrushSlotAt(
  state: StudioBrushSlotsState,
  index: number
): StudioBrushSlot | null {
  if (!Number.isInteger(index) || index < 0 || index >= STUDIO_BRUSH_SLOT_COUNT) return null;
  return normalizeStudioBrushSlotsState(state).slots[index] ?? null;
}
