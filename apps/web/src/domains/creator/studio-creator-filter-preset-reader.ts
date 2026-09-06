import {
  STUDIO_FILTER_PACK_DEFS,
  isStudioFilterPackKind,
  normalizeStudioFilterPackValues,
  type StudioFilterPackKind,
  type StudioFilterPackValues,
} from "./filter/studio-filter-pack";

export const STUDIO_CREATOR_FILTER_PRESET_LIBRARY_KEY =
  "toonspectrum.studio-creator-filter-presets.v1" as const;

export interface StudioCreatorPackStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface StudioCreatorInstalledFilterPreset {
  readonly id: string;
  readonly packageId: string;
  readonly entryId: string;
  readonly name: string;
  readonly engine: StudioFilterPackKind;
  readonly values: StudioFilterPackValues;
  readonly installedAt: number;
  readonly updatedAt: number;
}

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function isExactNormalizedFilterValues(
  engine: StudioFilterPackKind,
  value: unknown,
): value is StudioFilterPackValues {
  const values = record(value);
  if (!values) return false;
  const params = STUDIO_FILTER_PACK_DEFS[engine].params;
  if (
    Object.keys(values).length !== params.length
    || params.some((param) => !(param.key in values))
  ) {
    return false;
  }
  const normalized = normalizeStudioFilterPackValues(
    engine,
    values as StudioFilterPackValues,
  );
  return params.every((param) => normalized[param.key] === values[param.key]);
}

export function isStudioCreatorInstalledFilterPreset(
  value: unknown,
): value is StudioCreatorInstalledFilterPreset {
  const item = record(value);
  if (
    !item
    || typeof item.id !== "string"
    || item.id.length === 0
    || typeof item.packageId !== "string"
    || item.packageId.length === 0
    || typeof item.entryId !== "string"
    || item.entryId.length === 0
    || typeof item.name !== "string"
    || item.name.length === 0
    || typeof item.engine !== "string"
    || !isStudioFilterPackKind(item.engine)
    || typeof item.installedAt !== "number"
    || !Number.isFinite(item.installedAt)
    || typeof item.updatedAt !== "number"
    || !Number.isFinite(item.updatedAt)
  ) {
    return false;
  }
  return isExactNormalizedFilterValues(item.engine, item.values);
}

export function browserStudioCreatorPackStorage(): StudioCreatorPackStorage | null {
  try {
    return typeof globalThis.localStorage === "undefined"
      ? null
      : globalThis.localStorage;
  } catch {
    return null;
  }
}

export function listStudioCreatorFilterPresets(
  storage: Pick<StudioCreatorPackStorage, "getItem"> | null | undefined,
): StudioCreatorInstalledFilterPreset[] {
  if (!storage) return [];
  try {
    const serialized =
      storage.getItem(STUDIO_CREATOR_FILTER_PRESET_LIBRARY_KEY) ?? "[]";
    const parsed = JSON.parse(serialized) as unknown;
    if (!Array.isArray(parsed)) return [];

    const presets: StudioCreatorInstalledFilterPreset[] = [];
    for (const candidate of parsed) {
      if (isStudioCreatorInstalledFilterPreset(candidate)) presets.push(candidate);
    }
    return presets;
  } catch {
    return [];
  }
}
