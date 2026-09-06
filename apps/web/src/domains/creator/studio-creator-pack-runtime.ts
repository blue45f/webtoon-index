
import {
  STUDIO_BG3D_PROCEDURAL_STARTER_PACK,
  STUDIO_BG3D_PROCEDURAL_STARTER_PACK_ID,
} from "./bg3d/studio-bg3d-procedural-starter-pack";
import {
  BRUSH_LIBRARY_KEY,
  MAX_BRUSHES,
  deleteBrushWithRecord,
  listBrushes,
  sanitizeBrushSnapshot,
  saveBrushBatchWithResult,
  type StudioSavedBrush,
} from "./brush/studio-brush-library";
import {
  STUDIO_FILTER_PACK_DEFS,
  isStudioFilterPackKind,
  normalizeStudioFilterPackValues,
  studioFilterPackValuesToPatch,
  type StudioFilterPackKind,
  type StudioFilterPackPatch,
  type StudioFilterPackValues,
} from "./filter/studio-filter-pack";
import {
  STUDIO_MARKETPLACE_LIBRARY_STORAGE_KEY,
  cloneStudioMarketplacePackageToLibrary,
  loadStudioMarketplaceLibrary,
  removeStudioMarketplacePackageFromLibrary,
  resolveStudioMarketplaceImport,
  saveStudioMarketplaceLibrary,
} from "./studio-marketplace-packages";
import {
  MAX_COLORS_PER_PALETTE,
  MAX_PALETTES,
  PALETTE_LIBRARY_KEY,
  deletePalette,
  listPalettes,
  savePalette,
  type StudioNamedPalette,
} from "./studio-palette-library";
import { SCENE_TEMPLATES } from "./studio-scene-templates";

import type {
  StudioCreatorPackDefinition,
  StudioCreatorPackEntry,
} from "./studio-creator-pack-catalog";
import type {
  CreatorMarketplaceJsonValue,
  CreatorMarketplaceResourceKind,
} from "@/shared/lib/creator-marketplace-resource-contract";

import {
  CREATOR_MARKETPLACE_RESOURCE_MAX_ENTRY_BYTES,
  CREATOR_MARKETPLACE_RUNTIME_BY_KIND,
  CreatorMarketplaceResourceManifestSchema,
  canonicalizeCreatorMarketplaceJson,
  creatorMarketplaceJsonByteSize,
} from "@/shared/lib/creator-marketplace-resource-contract";
import {
  createCreatorMarketplacePortableDelivery,
} from "@/src/infrastructure/creator-marketplace-client";

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

export interface StudioCreatorPackValidation {
  readonly valid: boolean;
  readonly issues: readonly string[];
  readonly byteSize: number;
}

export type StudioCreatorBundledCatalogTarget =
  | Readonly<{
      kind: "scene-template-catalog";
      templateId: string;
    }>
  | Readonly<{
      kind: "bg3d-procedural-catalog";
      runtimeRef: string;
    }>
  | Readonly<{
      kind: "3d-asset-catalog";
      runtimeRef: string;
    }>;

export type StudioCreatorBundledCatalogResolution =
  | Readonly<{
      status: "supported";
      target: StudioCreatorBundledCatalogTarget;
    }>
  | Readonly<{
      status: "unsupported";
      reason: string;
    }>;

export type StudioCreatorPackInstallState =
  | "available"
  | "installed"
  | "update"
  | "repair-required"
  | "conflict"
  | "downgrade-blocked"
  | "bundled"
  | "invalid";

export type StudioCreatorPackInstallStatus =
  | "installed"
  | "already-installed"
  | "uninstalled"
  | "already-uninstalled"
  | "bundled"
  | "invalid"
  | "conflict"
  | "full"
  | "storage-error";

export interface StudioCreatorPackInstallResult {
  readonly status: StudioCreatorPackInstallStatus;
  readonly installedCount: number;
  readonly message: string;
}

const HEX_COLOR = /^#[0-9a-f]{6}$/u;
const MAX_RUNTIME_BUDGET = Object.freeze({
  entries: 32,
  elements: 512,
  nodes: 2_048,
  triangles: 250_000,
  drawCalls: 4_096,
  materials: 4_096,
  textures: 64,
});
const MEDIA_TYPE_BY_KIND = {
  brush: "application/vnd.toonspectrum.brush+json",
  filter: "application/vnd.toonspectrum.filter+json",
  palette: "application/vnd.toonspectrum.palette+json",
  template: "application/vnd.toonspectrum.template+json",
  "3d-preset": "application/vnd.toonspectrum.3d-preset+json",
  "3d-asset": "application/vnd.toonspectrum.3d-asset+json",
} as const;
const SNAPSHOT_KEYS = new Set([
  "sourcePresetId",
  "sourcePresetName",
  "brushId",
  "strokeWidth",
  "brushOpacity",
  "color",
  "stabilizer",
  "stabilizerMode",
  "postCorrection",
  "preserveCorners",
  "pressureCurve",
  "pressureMinSize",
  "useVelocityPressure",
  "velocitySensitivity",
  "tiltEnabled",
  "tipAngle",
  "tipRoundness",
  "brushDynamics",
  "stampTuning",
  "enginePrograms",
]);
/**
 * `enginePrograms` is admitted but NOT required. Every pack published before engine program sets
 * existed omits the key, and those packs must keep installing - a missing key means "use the
 * brush id's own program combination", which is exactly what those packs have always painted.
 */
const OPTIONAL_SNAPSHOT_KEYS = new Set([
  "sourcePresetId",
  "sourcePresetName",
  "enginePrograms",
]);
const REQUIRED_SNAPSHOT_KEYS = [...SNAPSHOT_KEYS].filter(
  (key) => !OPTIONAL_SNAPSHOT_KEYS.has(key),
);
const TRANSACTION_KEYS = [
  BRUSH_LIBRARY_KEY,
  PALETTE_LIBRARY_KEY,
  STUDIO_CREATOR_FILTER_PRESET_LIBRARY_KEY,
  STUDIO_MARKETPLACE_LIBRARY_STORAGE_KEY,
] as const;

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  allowed: ReadonlySet<string> = new Set(required),
): boolean {
  return required.every((key) => key in value)
    && Object.keys(value).every((key) => allowed.has(key));
}

function envelopeFor(
  kind: CreatorMarketplaceResourceKind,
  definition: Record<string, unknown>,
) {
  return {
    schemaVersion: 1 as const,
    resourceKind: kind,
    runtime: CREATOR_MARKETPLACE_RUNTIME_BY_KIND[kind],
    definition,
  };
}

function contractIssues(
  pack: StudioCreatorPackDefinition,
  entry: StudioCreatorPackEntry,
): string[] {
  if (entry.delivery.mode !== "portable-json") return [];
  const payload = envelopeFor(
    pack.resourceKind,
    entry.delivery.definition,
  );
  const bytes = creatorMarketplaceJsonByteSize(payload);
  const parsed = CreatorMarketplaceResourceManifestSchema.safeParse({
    schemaVersion: 1,
    packageId: pack.metadata.id,
    name: pack.metadata.name,
    description: pack.metadata.summary,
    kind: pack.resourceKind,
    resourceVersion: pack.metadata.version,
    minimumStudioVersion: pack.metadata.compatibility.studioVersion,
    tags: pack.metadata.tags.slice(0, 8),
    license: "cc0-1.0",
    attributionText: "",
    containsAi: false,
    rightsConfirmed: true,
    provenance: { origin: "original", authoredByPublisher: true },
    compatibility: { engines: pack.runtimeDescriptor.engines },
    entries: [{
      id: entry.id,
      kind: pack.resourceKind,
      name: entry.name,
      delivery: {
        mode: "portable-json",
        mediaType: MEDIA_TYPE_BY_KIND[pack.resourceKind],
        payload,
        byteSize: bytes,
        sha256: "0".repeat(64),
      },
    }],
  });
  return parsed.success
    ? []
    : parsed.error.issues.map((issue) => issue.message);
}

function validateBrushDefinition(definition: Record<string, unknown>): string[] {
  if (!exactKeys(definition, ["snapshot"])) return ["브러시 definition 필드가 올바르지 않습니다."];
  const snapshot = record(definition.snapshot);
  if (
    !snapshot
    || !exactKeys(snapshot, REQUIRED_SNAPSHOT_KEYS, SNAPSHOT_KEYS)
  ) {
    return ["브러시 snapshot 필드가 누락되었거나 알 수 없는 필드가 있습니다."];
  }
  const normalized = sanitizeBrushSnapshot(snapshot);
  if (
    normalized.adjustedFields.length > 0
    || canonicalizeCreatorMarketplaceJson(snapshot)
      !== canonicalizeCreatorMarketplaceJson(normalized.snapshot)
  ) {
    return ["브러시 값이 Studio 런타임 범위를 벗어났습니다."];
  }
  return [];
}

function validateFilterDefinition(definition: Record<string, unknown>): string[] {
  if (!exactKeys(definition, ["engine", "values"])) {
    return ["필터 definition 필드가 올바르지 않습니다."];
  }
  if (typeof definition.engine !== "string" || !isStudioFilterPackKind(definition.engine)) {
    return ["지원하지 않는 Studio 필터 엔진입니다."];
  }
  const values = record(definition.values);
  if (!values) return ["필터 values는 객체여야 합니다."];
  const expected = new Set(
    STUDIO_FILTER_PACK_DEFS[definition.engine].params.map((param) => param.key),
  );
  if (!exactKeys(values, [...expected], expected)) {
    return ["필터 파라미터가 누락되었거나 알 수 없는 값이 있습니다."];
  }
  const normalized = normalizeStudioFilterPackValues(
    definition.engine,
    values as StudioFilterPackValues,
  );
  return canonicalizeCreatorMarketplaceJson(values)
    === canonicalizeCreatorMarketplaceJson(normalized)
    ? []
    : ["필터 값이 Studio 런타임 범위를 벗어났습니다."];
}

function validatePaletteDefinition(definition: Record<string, unknown>): string[] {
  if (!exactKeys(definition, ["colors"])) return ["팔레트 definition 필드가 올바르지 않습니다."];
  if (
    !Array.isArray(definition.colors)
    || definition.colors.length === 0
    || definition.colors.length > Math.min(64, MAX_COLORS_PER_PALETTE)
    || definition.colors.some((color) => typeof color !== "string" || !HEX_COLOR.test(color))
    || new Set(definition.colors).size !== definition.colors.length
  ) {
    return ["팔레트는 중복 없는 소문자 #rrggbb 색상 1~64개여야 합니다."];
  }
  return [];
}

function validateRuntimeDescriptor(pack: StudioCreatorPackDefinition): string[] {
  const issues: string[] = [];
  for (const [key, max] of Object.entries(MAX_RUNTIME_BUDGET)) {
    const value = pack.runtimeDescriptor.budget[key as keyof typeof MAX_RUNTIME_BUDGET];
    if (value !== undefined && (!Number.isInteger(value) || value < 0 || value > max)) {
      issues.push(`${key} 예산이 허용 범위를 벗어났습니다.`);
    }
  }
  if (pack.runtimeDescriptor.budget.entries !== pack.entries.length) {
    issues.push("선언한 entry 예산과 실제 항목 수가 다릅니다.");
  }
  return issues;
}

function validateBuiltinEntry(entry: StudioCreatorPackEntry): string[] {
  if (entry.delivery.mode !== "builtin-ref") return [];
  if (entry.kind === "template") {
    const prefix = "studio-scene-template:";
    const templateId = entry.delivery.runtimeRef.startsWith(prefix)
      ? entry.delivery.runtimeRef.slice(prefix.length)
      : "";
    return SCENE_TEMPLATES.some((template) => template.id === templateId)
      ? []
      : ["알 수 없는 내장 장면 템플릿 참조입니다."];
  }
  if (entry.kind === "3d-preset") {
    return entry.delivery.runtimeRef === STUDIO_BG3D_PROCEDURAL_STARTER_PACK_ID
      ? []
      : ["알 수 없는 내장 3D 팩 참조입니다."];
  }
  return ["이 종류는 builtin-ref 설치를 지원하지 않습니다."];
}

export function validateStudioCreatorPack(
  pack: StudioCreatorPackDefinition,
): StudioCreatorPackValidation {
  const issues = [
    ...validateRuntimeDescriptor(pack),
    ...(pack.entries.length === 0 ? ["팩에 설치할 항목이 없습니다."] : []),
  ];
  for (const entry of pack.entries) {
    if (entry.kind !== pack.metadata.kind || entry.kind !== pack.resourceKind) {
      issues.push(`${entry.name}: 패키지와 항목 종류가 다릅니다.`);
      continue;
    }
    issues.push(...contractIssues(pack, entry).map((issue) => `${entry.name}: ${issue}`));
    if (entry.delivery.mode === "builtin-ref") {
      issues.push(...validateBuiltinEntry(entry).map((issue) => `${entry.name}: ${issue}`));
      continue;
    }
    const definition = entry.delivery.definition;
    const kindIssues = entry.kind === "brush"
      ? validateBrushDefinition(definition)
      : entry.kind === "filter"
        ? validateFilterDefinition(definition)
        : entry.kind === "palette"
          ? validatePaletteDefinition(definition)
          : ["이 종류는 portable-json 설치를 지원하지 않습니다."];
    issues.push(...kindIssues.map((issue) => `${entry.name}: ${issue}`));
  }
  const byteSize = pack.entries.reduce(
    (total, entry) => total + (
      entry.delivery.mode === "portable-json"
        ? creatorMarketplaceJsonByteSize(
          envelopeFor(pack.resourceKind, entry.delivery.definition),
        )
        : 0
    ),
    0,
  );
  if (byteSize > CREATOR_MARKETPLACE_RESOURCE_MAX_ENTRY_BYTES * pack.entries.length) {
    issues.push("팩의 portable JSON 크기가 허용 범위를 벗어났습니다.");
  }
  return { valid: issues.length === 0, issues, byteSize };
}

/**
 * Resolves only a validated, single-entry builtin reference into a non-mutating catalog target.
 * Multi-entry packs stay unsupported because one market click cannot truthfully identify which
 * referenced template the user intended to inspect.
 */
export function resolveStudioCreatorBundledCatalogTarget(
  pack: StudioCreatorPackDefinition,
): StudioCreatorBundledCatalogResolution {
  const validation = validateStudioCreatorPack(pack);
  if (!validation.valid) {
    return {
      status: "unsupported",
      reason: validation.issues[0] ?? "내장 리소스 참조 검증에 실패했습니다.",
    };
  }
  if (pack.entries.length !== 1) {
    return {
      status: "unsupported",
      reason: "내장 참조가 하나인 팩만 Studio 카탈로그에서 바로 열 수 있어요.",
    };
  }

  const [entry] = pack.entries;
  if (!entry || entry.delivery.mode !== "builtin-ref") {
    return {
      status: "unsupported",
      reason: "이 팩은 Studio 내장 카탈로그 참조가 아닙니다.",
    };
  }

  if (entry.kind === "template") {
    const prefix = "studio-scene-template:";
    const templateId = entry.delivery.runtimeRef.startsWith(prefix)
      ? entry.delivery.runtimeRef.slice(prefix.length)
      : "";
    if (SCENE_TEMPLATES.some((template) => template.id === templateId)) {
      return {
        status: "supported",
        target: { kind: "scene-template-catalog", templateId },
      };
    }
  }

  if (entry.kind === "3d-preset" || entry.kind === "3d-asset") {
    return {
      status: "supported",
      target: {
        kind: entry.kind === "3d-asset" ? "3d-asset-catalog" : "bg3d-procedural-catalog",
        runtimeRef: entry.delivery.runtimeRef,
      },
    };
  }

  return {
    status: "unsupported",
    reason: "이 내장 참조를 여는 안전한 Studio 카탈로그가 없습니다.",
  };
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

function runtimeItemId(packageId: string, entryId: string): string {
  return `creator-pack:${packageId}:${entryId}`;
}

function isFilterPreset(value: unknown): value is StudioCreatorInstalledFilterPreset {
  const item = record(value);
  if (
    !item
    || typeof item.id !== "string"
    || typeof item.packageId !== "string"
    || typeof item.entryId !== "string"
    || typeof item.name !== "string"
    || typeof item.engine !== "string"
    || !isStudioFilterPackKind(item.engine)
    || typeof item.installedAt !== "number"
    || typeof item.updatedAt !== "number"
  ) return false;
  const values = record(item.values);
  return Boolean(values) && validateFilterDefinition({
    engine: item.engine,
    values,
  }).length === 0;
}

export function listStudioCreatorFilterPresets(
  storage: Pick<StudioCreatorPackStorage, "getItem"> | null | undefined,
): StudioCreatorInstalledFilterPreset[] {
  if (!storage) return [];
  try {
    const parsed = JSON.parse(
      storage.getItem(STUDIO_CREATOR_FILTER_PRESET_LIBRARY_KEY) ?? "[]",
    ) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter(isFilterPreset)
      : [];
  } catch {
    return [];
  }
}

function saveFilterPresets(
  storage: StudioCreatorPackStorage,
  presets: readonly StudioCreatorInstalledFilterPreset[],
): boolean {
  try {
    storage.setItem(
      STUDIO_CREATOR_FILTER_PRESET_LIBRARY_KEY,
      JSON.stringify(presets),
    );
    return listStudioCreatorFilterPresets(storage).length === presets.length;
  } catch {
    return false;
  }
}

function hasRuntimeItems(
  pack: StudioCreatorPackDefinition,
  storage: StudioCreatorPackStorage,
): boolean {
  if (pack.metadata.kind === "brush") {
    const ids = new Set(listBrushes(storage).map((brush) => brush.id));
    return pack.entries.every((entry) => ids.has(runtimeItemId(pack.metadata.id, entry.id)));
  }
  if (pack.metadata.kind === "palette") {
    const ids = new Set(listPalettes(storage).map((palette) => palette.id));
    return pack.entries.every((entry) => ids.has(runtimeItemId(pack.metadata.id, entry.id)));
  }
  if (pack.metadata.kind === "filter") {
    const ids = new Set(listStudioCreatorFilterPresets(storage).map((preset) => preset.id));
    return pack.entries.every((entry) => ids.has(runtimeItemId(pack.metadata.id, entry.id)));
  }
  return validateStudioCreatorPack(pack).valid;
}

export function inspectStudioCreatorPackInstallState(
  pack: StudioCreatorPackDefinition,
  storage: StudioCreatorPackStorage | null | undefined,
): StudioCreatorPackInstallState {
  if (!validateStudioCreatorPack(pack).valid) return "invalid";
  if (pack.entries.every((entry) => entry.delivery.mode === "builtin-ref")) return "bundled";
  if (!storage) return "available";
  const marker = loadStudioMarketplaceLibrary(storage).packages.find(
    (entry) => entry.packageId === pack.metadata.id,
  );
  const runtimeInstalled = hasRuntimeItems(pack, storage);
  if (!marker) return runtimeInstalled ? "repair-required" : "available";
  const resolution = resolveStudioMarketplaceImport(pack.metadata, marker);
  if (resolution.status === "update") return "update";
  if (resolution.status === "content-conflict") return "conflict";
  if (resolution.status === "downgrade-blocked") return "downgrade-blocked";
  return runtimeInstalled && resolution.status === "duplicate"
    ? "installed"
    : "repair-required";
}

function captureStorage(
  storage: StudioCreatorPackStorage,
): Map<string, string | null> | null {
  try {
    return new Map(TRANSACTION_KEYS.map((key) => [key, storage.getItem(key)]));
  } catch {
    return null;
  }
}

function restoreStorage(
  storage: StudioCreatorPackStorage,
  snapshot: ReadonlyMap<string, string | null>,
): void {
  for (const [key, value] of snapshot) {
    try {
      if (value === null) storage.removeItem(key);
      else storage.setItem(key, value);
    } catch {
      // Best-effort rollback. Verification after install still fails closed.
    }
  }
}

function installBrushes(
  pack: StudioCreatorPackDefinition,
  storage: StudioCreatorPackStorage,
  now: number,
): StudioCreatorPackInstallStatus {
  const current = listBrushes(storage);
  const existing = new Map(current.map((brush) => [brush.id, brush]));
  const incoming: StudioSavedBrush[] = pack.entries.map((entry) => {
    const id = runtimeItemId(pack.metadata.id, entry.id);
    const previous = existing.get(id);
    const definition = (entry.delivery as { definition: Record<string, unknown> }).definition;
    const snapshot = sanitizeBrushSnapshot(definition.snapshot).snapshot;
    return {
      ...snapshot,
      id,
      name: entry.name,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
      pinned: previous?.pinned ?? false,
      lastUsedAt: previous?.lastUsedAt ?? null,
    };
  });
  const newCount = incoming.filter((brush) => !existing.has(brush.id)).length;
  if (current.length + newCount > MAX_BRUSHES) return "full";
  const result = saveBrushBatchWithResult(storage, incoming);
  return result.status === "saved" ? "installed" : result.status === "full" ? "full" : "storage-error";
}

function installPalettes(
  pack: StudioCreatorPackDefinition,
  storage: StudioCreatorPackStorage,
  now: number,
): StudioCreatorPackInstallStatus {
  const current = listPalettes(storage);
  const existing = new Map(current.map((palette) => [palette.id, palette]));
  const newCount = pack.entries.filter(
    (entry) => !existing.has(runtimeItemId(pack.metadata.id, entry.id)),
  ).length;
  if (current.length + newCount > MAX_PALETTES) return "full";
  for (const entry of [...pack.entries].reverse()) {
    const id = runtimeItemId(pack.metadata.id, entry.id);
    const previous = existing.get(id);
    const definition = (entry.delivery as { definition: Record<string, unknown> }).definition;
    const palette: StudioNamedPalette = {
      id,
      name: entry.name,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
      colors: [...definition.colors as string[]],
    };
    savePalette(storage, palette);
  }
  return hasRuntimeItems(pack, storage) ? "installed" : "storage-error";
}

function installFilters(
  pack: StudioCreatorPackDefinition,
  storage: StudioCreatorPackStorage,
  now: number,
): StudioCreatorPackInstallStatus {
  const current = listStudioCreatorFilterPresets(storage);
  const existing = new Map(current.map((preset) => [preset.id, preset]));
  const incoming = pack.entries.map((entry) => {
    const id = runtimeItemId(pack.metadata.id, entry.id);
    const previous = existing.get(id);
    const definition = (entry.delivery as { definition: Record<string, unknown> }).definition;
    const engine = definition.engine as StudioFilterPackKind;
    return {
      id,
      packageId: pack.metadata.id,
      entryId: entry.id,
      name: entry.name,
      engine,
      values: normalizeStudioFilterPackValues(
        engine,
        definition.values as StudioFilterPackValues,
      ),
      installedAt: previous?.installedAt ?? now,
      updatedAt: now,
    } satisfies StudioCreatorInstalledFilterPreset;
  });
  const incomingIds = new Set(incoming.map((preset) => preset.id));
  return saveFilterPresets(
    storage,
    [...incoming, ...current.filter((preset) => !incomingIds.has(preset.id))],
  ) ? "installed" : "storage-error";
}

export function installStudioCreatorPack(
  pack: StudioCreatorPackDefinition,
  storage: StudioCreatorPackStorage | null | undefined = browserStudioCreatorPackStorage(),
  now = Date.now(),
): StudioCreatorPackInstallResult {
  const validation = validateStudioCreatorPack(pack);
  if (!validation.valid) {
    return { status: "invalid", installedCount: 0, message: validation.issues[0] ?? "팩 검증에 실패했습니다." };
  }
  if (pack.entries.every((entry) => entry.delivery.mode === "builtin-ref")) {
    return { status: "bundled", installedCount: pack.entries.length, message: "이미 Studio에 내장된 안정적인 참조입니다." };
  }
  if (!storage) {
    return { status: "storage-error", installedCount: 0, message: "브라우저 로컬 저장소를 사용할 수 없습니다." };
  }
  const marker = loadStudioMarketplaceLibrary(storage).packages.find(
    (entry) => entry.packageId === pack.metadata.id,
  );
  const markerResolution = marker
    ? resolveStudioMarketplaceImport(pack.metadata, marker)
    : null;
  if (
    markerResolution?.status === "content-conflict"
    || markerResolution?.status === "downgrade-blocked"
  ) {
    return {
      status: "conflict",
      installedCount: 0,
      message: markerResolution.message,
    };
  }
  if (inspectStudioCreatorPackInstallState(pack, storage) === "installed") {
    return { status: "already-installed", installedCount: pack.entries.length, message: "동일한 버전이 이미 실제 도구 라이브러리에 설치되어 있습니다." };
  }

  const snapshot = captureStorage(storage);
  if (!snapshot) {
    return {
      status: "storage-error",
      installedCount: 0,
      message: "브라우저 로컬 저장소를 안전하게 읽을 수 없어 설치하지 않았습니다.",
    };
  }
  const runtimeStatus = pack.metadata.kind === "brush"
    ? installBrushes(pack, storage, now)
    : pack.metadata.kind === "palette"
      ? installPalettes(pack, storage, now)
      : pack.metadata.kind === "filter"
        ? installFilters(pack, storage, now)
        : "invalid";
  if (runtimeStatus !== "installed") {
    restoreStorage(storage, snapshot);
    return {
      status: runtimeStatus,
      installedCount: 0,
      message: runtimeStatus === "full"
        ? "해당 Studio 라이브러리가 가득 차서 아무 항목도 설치하지 않았습니다."
        : "설치를 완료하지 못해 기존 로컬 라이브러리 상태로 되돌렸습니다.",
    };
  }

  const nextLibrary = cloneStudioMarketplacePackageToLibrary(
    loadStudioMarketplaceLibrary(storage),
    pack.metadata,
    new Date(now).toISOString(),
  );
  if (
    !saveStudioMarketplaceLibrary(storage, nextLibrary)
    || !hasRuntimeItems(pack, storage)
  ) {
    restoreStorage(storage, snapshot);
    return { status: "storage-error", installedCount: 0, message: "설치 확인에 실패해 기존 상태로 되돌렸습니다." };
  }
  return {
    status: "installed",
    installedCount: pack.entries.length,
    message: `${pack.entries.length}개 항목을 실제 Studio 라이브러리에 설치했습니다.`,
  };
}

function creatorPackRuntimeIds(pack: StudioCreatorPackDefinition): Set<string> {
  return new Set(
    pack.entries.map((entry) => runtimeItemId(pack.metadata.id, entry.id)),
  );
}

function countInstalledRuntimeItems(
  pack: StudioCreatorPackDefinition,
  storage: StudioCreatorPackStorage,
): number {
  const ids = creatorPackRuntimeIds(pack);
  if (pack.metadata.kind === "brush") {
    return listBrushes(storage).filter((brush) => ids.has(brush.id)).length;
  }
  if (pack.metadata.kind === "palette") {
    return listPalettes(storage).filter((palette) => ids.has(palette.id)).length;
  }
  if (pack.metadata.kind === "filter") {
    return listStudioCreatorFilterPresets(storage)
      .filter((preset) => ids.has(preset.id)).length;
  }
  return 0;
}

function removeCreatorPackRuntimeItems(
  pack: StudioCreatorPackDefinition,
  storage: StudioCreatorPackStorage,
): boolean {
  const ids = creatorPackRuntimeIds(pack);
  if (pack.metadata.kind === "brush") {
    for (const id of ids) {
      const result = deleteBrushWithRecord(storage, id);
      if (
        result.status !== "deleted"
        && result.status !== "missing"
      ) return false;
    }
    return countInstalledRuntimeItems(pack, storage) === 0;
  }
  if (pack.metadata.kind === "palette") {
    for (const id of ids) deletePalette(storage, id);
    return countInstalledRuntimeItems(pack, storage) === 0;
  }
  if (pack.metadata.kind === "filter") {
    const retained = listStudioCreatorFilterPresets(storage)
      .filter((preset) => !ids.has(preset.id));
    return saveFilterPresets(storage, retained)
      && countInstalledRuntimeItems(pack, storage) === 0;
  }
  return false;
}

/**
 * Removes only deterministic IDs owned by this pack. User-created brushes, palettes and presets
 * survive, and every local key is restored when any runtime or marker write fails.
 */
export function uninstallStudioCreatorPack(
  pack: StudioCreatorPackDefinition,
  storage: StudioCreatorPackStorage | null | undefined = browserStudioCreatorPackStorage(),
): StudioCreatorPackInstallResult {
  const validation = validateStudioCreatorPack(pack);
  if (!validation.valid) {
    return {
      status: "invalid",
      installedCount: 0,
      message: validation.issues[0] ?? "팩 검증에 실패했습니다.",
    };
  }
  if (pack.entries.every((entry) => entry.delivery.mode === "builtin-ref")) {
    return {
      status: "bundled",
      installedCount: 0,
      message: "Studio 내장 참조는 로컬 라이브러리에서 제거하지 않습니다.",
    };
  }
  if (!storage) {
    return {
      status: "storage-error",
      installedCount: 0,
      message: "브라우저 로컬 저장소를 사용할 수 없습니다.",
    };
  }

  const installedCount = countInstalledRuntimeItems(pack, storage);
  const library = loadStudioMarketplaceLibrary(storage);
  const hasMarker = library.packages.some(
    (entry) => entry.packageId === pack.metadata.id,
  );
  if (installedCount === 0 && !hasMarker) {
    return {
      status: "already-uninstalled",
      installedCount: 0,
      message: "이 팩이 만든 로컬 항목이 없습니다.",
    };
  }

  const snapshot = captureStorage(storage);
  if (!snapshot) {
    return {
      status: "storage-error",
      installedCount: 0,
      message: "브라우저 로컬 저장소를 안전하게 읽을 수 없어 제거하지 않았습니다.",
    };
  }
  const nextLibrary = removeStudioMarketplacePackageFromLibrary(
    library,
    pack.metadata.id,
  );
  if (
    !removeCreatorPackRuntimeItems(pack, storage)
    || !saveStudioMarketplaceLibrary(storage, nextLibrary, {
      removedPackageIds: [pack.metadata.id],
    })
    || countInstalledRuntimeItems(pack, storage) !== 0
    || loadStudioMarketplaceLibrary(storage).packages.some(
      (entry) => entry.packageId === pack.metadata.id,
    )
  ) {
    restoreStorage(storage, snapshot);
    return {
      status: "storage-error",
      installedCount: 0,
      message: "제거를 완료하지 못해 기존 로컬 라이브러리 상태로 되돌렸습니다.",
    };
  }
  return {
    status: "uninstalled",
    installedCount,
    message: `${installedCount}개 팩 항목과 설치 마커를 이 기기에서 제거했습니다.`,
  };
}

export function materializeStudioCreatorFilterPresetPatch(
  presetId: string,
  storage: Pick<StudioCreatorPackStorage, "getItem"> | null | undefined,
): StudioFilterPackPatch | null {
  const preset = listStudioCreatorFilterPresets(storage).find(
    (candidate) => candidate.id === presetId,
  );
  return preset
    ? studioFilterPackValuesToPatch(preset.engine, preset.values)
    : null;
}

export async function createStudioCreatorPackPortableDelivery(
  entry: StudioCreatorPackEntry,
) {
  if (entry.delivery.mode !== "portable-json") {
    throw new Error("portable JSON 항목만 전송 delivery를 만들 수 있습니다.");
  }
  const kind = entry.kind as Exclude<CreatorMarketplaceResourceKind, "asset" | "template" | "3d-preset">;
  const definition = entry.delivery.definition as Record<string, CreatorMarketplaceJsonValue>;
  return createCreatorMarketplacePortableDelivery(kind, definition);
}

export function studioCreatorPackRuntimeSummary(
  pack: StudioCreatorPackDefinition,
): string {
  const budget = pack.runtimeDescriptor.budget;
  if (pack.metadata.kind === "3d-preset") {
    return `${STUDIO_BG3D_PROCEDURAL_STARTER_PACK.assets.length}개 프리셋 · ${budget.nodes ?? 0} nodes · ${budget.triangles ?? 0} tris · 텍스처 ${budget.textures ?? 0}`;
  }
  return `${pack.entries.length}개 항목 · ${pack.runtimeDescriptor.engines.join(" · ")}`;
}
