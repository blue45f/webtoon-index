import {
  sanitizeBrushSnapshot,
  type StudioSavedBrush,
} from "./brush/studio-brush-library";
import {
  STUDIO_MARKETPLACE_PACKAGE_SCHEMA,
  evaluateStudioMarketplaceCompatibility,
  type StudioMarketplaceLicense,
  type StudioMarketplaceOrigin,
  type StudioMarketplacePackage,
} from "./studio-marketplace-packages";
import {
  STUDIO_MARKETPLACE_COMPATIBILITY_VERSION,
} from "./studio-marketplace-runtime-compatibility";
import {
  findStudioOriginalFreeAsset,
  type StudioOriginalFreeAsset,
} from "./studio-original-free-asset-packs";
import {
  SCENE_TEMPLATES,
} from "./studio-scene-templates";
import { sha256HexPortable } from "./studio-sha256";

import type {
  StudioCreatorPackDefinition,
  StudioCreatorPackEntry,
  StudioCreatorPackKind,
} from "./studio-creator-pack-catalog";
import type {
  StudioCreatorInstalledFilterPreset,
  StudioCreatorPackStorage,
} from "./studio-creator-pack-runtime";
import type { StudioNamedPalette } from "./studio-palette-library";
import type {
  CreatorMarketplaceJsonValue,
  CreatorMarketplaceResourceEngine,
  CreatorMarketplaceResourceLicense,
  CreatorMarketplaceResourceManifest,
  CreatorMarketplaceResourceRecord,
} from "@/shared/lib/creator-marketplace-resource-contract";

import { creatorMarketplaceStudioPackId } from "@/shared/lib/creator-marketplace-package-identity";
import {
  isCreatorMarketplaceSemver,
  normalizeCreatorMarketplaceLegacySemver,
} from "@/shared/lib/creator-marketplace-semver";
import {
  createCreatorMarketplacePortableDelivery,
} from "@/src/infrastructure/creator-marketplace-client";

const LICENSE_METADATA: Readonly<
  Record<CreatorMarketplaceResourceLicense, Omit<StudioMarketplaceLicense, "sourceVerifiedAt">>
> = Object.freeze({
  "toonspectrum-standard": {
    id: "toonspectrum-standard",
    label: "ToonSpectrum 표준 사용권",
    url: null,
    commercialUse: true,
    attributionRequired: false,
    derivativesAllowed: true,
    redistributionAllowed: false,
    summary: "작품에는 사용할 수 있지만 리소스 파일 자체의 재배포는 허용하지 않습니다.",
  },
  "cc0-1.0": {
    id: "cc0-1.0",
    label: "CC0 1.0",
    url: "https://creativecommons.org/publicdomain/zero/1.0/",
    commercialUse: true,
    attributionRequired: false,
    derivativesAllowed: true,
    redistributionAllowed: true,
    summary: "상업 이용·수정·재배포가 가능한 공개 리소스입니다.",
  },
  "cc-by-4.0": {
    id: "cc-by-4.0",
    label: "CC BY 4.0",
    url: "https://creativecommons.org/licenses/by/4.0/",
    commercialUse: true,
    attributionRequired: true,
    derivativesAllowed: true,
    redistributionAllowed: true,
    summary: "저작자 표시를 유지하면 상업 이용·수정·재배포할 수 있습니다.",
  },
  "cc-by-nc-4.0": {
    id: "cc-by-nc-4.0",
    label: "CC BY-NC 4.0",
    url: "https://creativecommons.org/licenses/by-nc/4.0/",
    commercialUse: false,
    attributionRequired: true,
    derivativesAllowed: true,
    redistributionAllowed: true,
    summary: "저작자 표시가 필요하며 상업 작품에는 사용할 수 없습니다.",
  },
});

const COMMUNITY_INSTALLABLE_KINDS = new Set<StudioCreatorPackKind>([
  "brush",
  "filter",
  "palette",
  "template",
  "3d-preset",
  "3d-asset",
]);

const FORMAT_BY_KIND: Readonly<Record<StudioCreatorPackKind, string>> =
  Object.freeze({
    brush: "application/vnd.toonspectrum.brush+json",
    filter: "application/vnd.toonspectrum.filter+json",
    palette: "application/vnd.toonspectrum.palette+json",
    template: "application/vnd.toonspectrum.template+json",
    "3d-preset": "application/vnd.toonspectrum.3d-preset+json",
    "3d-asset": "application/vnd.toonspectrum.3d-asset+json",
  });

export type StudioCommunityPackProjection =
  | Readonly<{
      status: "installable";
      pack: StudioCreatorPackDefinition;
      reason: null;
    }>
  | Readonly<{
      status: "unsupported";
      pack: null;
      reason: string;
    }>;

export interface StudioCommunityAssetProjection {
  readonly assets: readonly StudioOriginalFreeAsset[];
  readonly unsupportedCount: number;
  readonly reason: string | null;
}

export interface StudioCommunityMarketplaceCompatibilityContext {
  /** Authoritative compatibility version; omit until the Studio build publishes one. */
  readonly currentStudioVersion?: string | null;
  /** Positively measured engine support; omit rather than guessing from browser identity. */
  readonly supportedEngines?: readonly CreatorMarketplaceResourceEngine[] | null;
  /** Engines whose measurement was inconclusive; resources requiring them remain fail-closed. */
  readonly unverifiedEngines?: readonly CreatorMarketplaceResourceEngine[] | null;
}

export type StudioCommunityShareCandidateKind = "brush" | "filter" | "palette";

export interface StudioCommunityShareCandidate {
  readonly id: string;
  readonly kind: StudioCommunityShareCandidateKind;
  readonly name: string;
  readonly definition: Record<string, CreatorMarketplaceJsonValue>;
}

export interface StudioCommunityPublishOptions {
  readonly description?: string;
  readonly releaseNotes?: string;
  readonly resourceVersion: string;
  readonly license: CreatorMarketplaceResourceLicense;
  readonly attributionText?: string;
  readonly containsAi: boolean;
  readonly creatorOwnsRights: boolean;
  readonly recognizableMarketplaceDerivative: boolean;
  readonly resolvedIdentity?: StudioCommunityShareCandidateIdentity;
}

export interface StudioCommunityShareCandidateIdentity {
  readonly scheme: "legacy" | "v2";
  readonly packageId: string;
  readonly entryId: string;
}

function licenseForRecord(
  record: Pick<CreatorMarketplaceResourceRecord, "license" | "updatedAt">,
): StudioMarketplaceLicense {
  return Object.freeze({
    ...LICENSE_METADATA[record.license],
    sourceVerifiedAt: record.updatedAt,
  });
}

function originForRecord(
  record: Pick<CreatorMarketplaceResourceRecord, "provenance">,
): StudioMarketplaceOrigin {
  return record.provenance.origin === "original"
    ? "original-handmade"
    : "permissive";
}

function rendererForRecord(
  record: Pick<CreatorMarketplaceResourceRecord, "compatibility">,
): StudioMarketplacePackage["compatibility"]["renderer"] {
  const renderers = new Set<"canvas2d" | "svg" | "webgl" | "webgpu">();
  for (const engine of record.compatibility.engines) {
    if (engine === "canvas2d") renderers.add("canvas2d");
    if (engine === "webgl2" || engine === "three") renderers.add("webgl");
    if (engine === "webgpu") renderers.add("webgpu");
  }
  if (renderers.size === 0) renderers.add("canvas2d");
  return [...renderers];
}

function portableDefinition(
  entry: CreatorMarketplaceResourceRecord["entries"][number],
): Record<string, unknown> | null {
  if (
    entry.delivery.mode !== "portable-json"
    && entry.delivery.mode !== "procedural-recipe"
  ) {
    return null;
  }
  return entry.delivery.payload.definition;
}

function projectEntry(
  kind: StudioCreatorPackKind,
  entry: CreatorMarketplaceResourceRecord["entries"][number],
): StudioCreatorPackEntry | null {
  if (entry.kind !== kind) return null;
  if (kind === "brush" || kind === "filter" || kind === "palette") {
    const definition = portableDefinition(entry);
    if (!definition || entry.delivery.mode !== "portable-json") return null;
    return {
      id: entry.id,
      name: entry.name,
      kind,
      delivery: {
        mode: "portable-json",
        definition,
      },
    };
  }
  if (kind === "template") {
    if (entry.delivery.mode === "builtin-ref") {
      return {
        id: entry.id,
        name: entry.name,
        kind,
        delivery: {
          mode: "builtin-ref",
          runtimeRef: entry.delivery.runtimeRef,
        },
      };
    }
    const definition = portableDefinition(entry);
    const templateId = definition?.templateId;
    if (
      typeof templateId !== "string"
      || !SCENE_TEMPLATES.some((template) => template.id === templateId)
    ) {
      return null;
    }
    return {
      id: entry.id,
      name: entry.name,
      kind,
      delivery: {
        mode: "builtin-ref",
        runtimeRef: `studio-scene-template:${templateId}`,
      },
    };
  }
  if (entry.delivery.mode === "builtin-ref") {
    return {
      id: entry.id,
      name: entry.name,
      kind,
      delivery: {
        mode: "builtin-ref",
        runtimeRef: entry.delivery.runtimeRef,
      },
    };
  }
  const definition = portableDefinition(entry);
  return typeof definition?.recipeId === "string" && definition.recipeId.trim().length > 0
    ? {
        id: entry.id,
        name: entry.name,
        kind,
        delivery: {
          mode: "builtin-ref",
          runtimeRef: definition.recipeId,
        },
      }
    : null;
}

function metadataForRecord(
  record: CreatorMarketplaceResourceRecord,
  kind: StudioCreatorPackKind,
  normalizedResourceVersion: string,
  normalizedMinimumStudioVersion: string,
): StudioMarketplacePackage {
  const format = FORMAT_BY_KIND[kind];
  return Object.freeze({
    schema: STUDIO_MARKETPLACE_PACKAGE_SCHEMA,
    id: creatorMarketplaceStudioPackId(record),
    name: record.name,
    summary: record.description || `${record.publisher.name}님의 공유 리소스`,
    category: `community-${kind}`,
    tags: Object.freeze([...record.tags]),
    kind,
    access: "free",
    accessLabel: "무료 공유",
    origin: originForRecord(record),
    creator: Object.freeze({
      id: record.publisher.id,
      name: record.publisher.name,
      verified: false,
    }),
    version: normalizedResourceVersion,
    packageFingerprint: record.manifestHash,
    compatibility: Object.freeze({
      studioVersion: normalizedMinimumStudioVersion,
      renderer: Object.freeze(rendererForRecord(record)),
      devices: Object.freeze(["desktop", "tablet", "mobile"] as const),
      formats: Object.freeze([format]),
    }),
    license: licenseForRecord(record),
    includedItems: Object.freeze(record.entries.map((entry) => ({
      id: entry.id,
      name: entry.name,
      kind,
      format,
      contentFingerprint: entry.delivery.sha256,
      tags: Object.freeze([...record.tags]),
    }))),
    changelog: Object.freeze([{
      version: normalizedResourceVersion,
      releasedAt: record.updatedAt,
      changes: Object.freeze(["커뮤니티 공유 버전"]),
    }]),
    placementPresets: Object.freeze([]),
    availability: Object.freeze({
      catalog: "server-required",
      library: "local-only",
      payment: "unavailable",
      cloudSync: "unavailable",
      exportManifest: "local-only",
    }),
    updatedAt: record.updatedAt,
  });
}

export function projectCreatorMarketplaceRecordToStudioPack(
  record: CreatorMarketplaceResourceRecord,
  compatibilityContext: StudioCommunityMarketplaceCompatibilityContext = {},
): StudioCommunityPackProjection {
  if (!COMMUNITY_INSTALLABLE_KINDS.has(record.kind as StudioCreatorPackKind)) {
    return {
      status: "unsupported",
      pack: null,
      reason: "2D 에셋은 이 카드에서 바로 삽입하며 로컬 팩 설치 대상이 아닙니다.",
    };
  }
  const normalizedMinimumStudioVersion = normalizeCreatorMarketplaceLegacySemver(
    record.minimumStudioVersion,
  );
  if (!normalizedMinimumStudioVersion) {
    return {
      status: "unsupported",
      pack: null,
      reason: "이 리소스의 최소 Studio 버전을 안전하게 해석할 수 없습니다.",
    };
  }
  const compatibility = evaluateStudioMarketplaceCompatibility({
    minimumStudioVersion: normalizedMinimumStudioVersion,
    currentStudioVersion: compatibilityContext.currentStudioVersion,
    declaredEngines: record.compatibility.engines,
    supportedEngines: compatibilityContext.supportedEngines,
    unverifiedEngines: compatibilityContext.unverifiedEngines,
  });
  const productContextSupplied = "currentStudioVersion" in compatibilityContext
    || "supportedEngines" in compatibilityContext
    || "unverifiedEngines" in compatibilityContext;
  if (
    compatibility.status === "unsupported"
    || (productContextSupplied && compatibility.status === "unverified")
  ) {
    return {
      status: "unsupported",
      pack: null,
      reason: compatibility.reason,
    };
  }
  // An omitted context remains an explicit test/legacy seam. Product callers pass at least one
  // context field and therefore fail closed above when either authority could not be measured.
  const kind = record.kind as StudioCreatorPackKind;
  const normalizedResourceVersion = normalizeCreatorMarketplaceLegacySemver(
    record.resourceVersion,
  );
  if (!normalizedResourceVersion) {
    return {
      status: "unsupported",
      pack: null,
      reason: "이 리소스의 릴리스 버전을 안전하게 해석할 수 없습니다.",
    };
  }
  const entries = record.entries.map((entry) => projectEntry(kind, entry));
  if (entries.some((entry) => entry === null)) {
    return {
      status: "unsupported",
      pack: null,
      reason: "현재 Studio에서 안전하게 실행할 수 없는 엔진 또는 내장 참조가 포함되어 있습니다.",
    };
  }
  const pack: StudioCreatorPackDefinition = Object.freeze({
    metadata: metadataForRecord(
      record,
      kind,
      normalizedResourceVersion,
      normalizedMinimumStudioVersion,
    ),
    resourceKind: kind,
    entries: Object.freeze(entries as StudioCreatorPackEntry[]),
    marketplaceSource: Object.freeze({
      schema: "creator-marketplace-resource-v1",
      releaseId: record.id,
      publisherId: record.publisher.id,
      packageId: record.packageId,
    }),
    runtimeDescriptor: Object.freeze({
      engines: Object.freeze([...record.compatibility.engines]),
      budget: Object.freeze({
        entries: entries.length,
        ...(kind === "3d-preset"
          ? { nodes: 2_048, triangles: 250_000, textures: 64 }
          : {}),
      }),
    }),
  });
  return { status: "installable", pack, reason: null };
}

function originalAssetIdFromEntry(
  entry: CreatorMarketplaceResourceRecord["entries"][number],
): string | null {
  if (entry.kind !== "asset") return null;
  if (entry.delivery.mode === "builtin-ref") {
    const prefix = "studio-asset:";
    return entry.delivery.runtimeRef.startsWith(prefix)
      ? entry.delivery.runtimeRef.slice(prefix.length)
      : null;
  }
  const definition = portableDefinition(entry);
  return typeof definition?.recipeId === "string"
    ? definition.recipeId
    : null;
}

export function projectCreatorMarketplaceRecordToAssets(
  record: CreatorMarketplaceResourceRecord,
  compatibilityContext: StudioCommunityMarketplaceCompatibilityContext = {},
): StudioCommunityAssetProjection {
  if (record.kind !== "asset") {
    return {
      assets: [],
      unsupportedCount: record.entries.length,
      reason: "2D 에셋 패키지가 아닙니다.",
    };
  }
  const normalizedMinimumStudioVersion = normalizeCreatorMarketplaceLegacySemver(
    record.minimumStudioVersion,
  );
  if (!normalizedMinimumStudioVersion) {
    return {
      assets: [],
      unsupportedCount: record.entries.length,
      reason: "이 리소스의 최소 Studio 버전을 안전하게 해석할 수 없습니다.",
    };
  }
  const compatibility = evaluateStudioMarketplaceCompatibility({
    minimumStudioVersion: normalizedMinimumStudioVersion,
    currentStudioVersion: compatibilityContext.currentStudioVersion,
    declaredEngines: record.compatibility.engines,
    supportedEngines: compatibilityContext.supportedEngines,
    unverifiedEngines: compatibilityContext.unverifiedEngines,
  });
  const productContextSupplied = "currentStudioVersion" in compatibilityContext
    || "supportedEngines" in compatibilityContext
    || "unverifiedEngines" in compatibilityContext;
  if (
    compatibility.status === "unsupported"
    || (productContextSupplied && compatibility.status === "unverified")
  ) {
    return {
      assets: [],
      unsupportedCount: record.entries.length,
      reason: compatibility.reason,
    };
  }
  // See the pack projection above: product calls never guess a missing runtime authority.
  const assets: StudioOriginalFreeAsset[] = [];
  let unsupportedCount = 0;
  for (const entry of record.entries) {
    const assetId = originalAssetIdFromEntry(entry);
    const asset = assetId ? findStudioOriginalFreeAsset(assetId) : null;
    if (!asset) {
      unsupportedCount += 1;
      continue;
    }
    if (!assets.some((candidate) => candidate.id === asset.id)) assets.push(asset);
  }
  return {
    assets,
    unsupportedCount,
    reason: assets.length > 0
      ? null
      : "현재 기기에 검증된 절차형 2D recipe가 없어 삽입할 수 없습니다.",
  };
}

function filterSnapshot(brush: StudioSavedBrush): Record<string, CreatorMarketplaceJsonValue> {
  return sanitizeBrushSnapshot(brush).snapshot as unknown as Record<
    string,
    CreatorMarketplaceJsonValue
  >;
}

/**
 * Product pack entries retain a `creator-pack:` id in every SQLite library. Their source
 * licence/provenance is intentionally not flattened into the editable brush/filter/palette
 * record, so treating them as an authored local resource would silently relabel marketplace
 * content as `provenance: original`. Keep the publish boundary fail-closed until an explicit,
 * verifiable derivative/redistribution contract is available.
 */
export function isStudioCommunityShareableLocalResourceId(id: string): boolean {
  const normalized = id.trim().toLowerCase();
  return normalized.length > 0 && !normalized.startsWith("creator-pack:");
}

export function listStudioCommunityShareCandidates(input: {
  readonly brushes?: readonly StudioSavedBrush[];
  readonly filters?: readonly StudioCreatorInstalledFilterPreset[];
  readonly palettes?: readonly StudioNamedPalette[];
} = {}): StudioCommunityShareCandidate[] {
  // Product callers hydrate all three arrays from the SQLite repositories. Omitted inputs are
  // intentionally empty; this pure projection must never discover pre-V12 localStorage data.
  const brushes = input.brushes ?? [];
  const filters = input.filters ?? [];
  const palettes = input.palettes ?? [];
  return [
    ...brushes
      .filter((brush) =>
        isStudioCommunityShareableLocalResourceId(brush.id)
        && (
          brush.sourcePresetId === undefined
          || isStudioCommunityShareableLocalResourceId(brush.sourcePresetId)
        ))
      .map((brush) => ({
      id: brush.id,
      kind: "brush" as const,
      name: brush.name,
      definition: { snapshot: filterSnapshot(brush) },
      })),
    ...filters
      .filter((filter) => isStudioCommunityShareableLocalResourceId(filter.id))
      .map((filter) => ({
      id: filter.id,
      kind: "filter" as const,
      name: filter.name,
      definition: {
        engine: filter.engine,
        values: filter.values as Record<string, CreatorMarketplaceJsonValue>,
      },
      })),
    ...palettes
      .filter((palette) => isStudioCommunityShareableLocalResourceId(palette.id))
      .map((palette) => ({
        ...palette,
        colors: [...new Set(
          palette.colors
            .map((color) => color.toLowerCase())
            .filter((color) => /^#[0-9a-f]{6}$/u.test(color)),
        )].slice(0, 64),
      }))
      .filter((palette) => palette.colors.length > 0)
      .map((palette) => ({
        id: palette.id,
        kind: "palette" as const,
        name: palette.name,
        definition: { colors: palette.colors },
      })),
  ];
}

export function browserStudioCreatorStorage(): StudioCreatorPackStorage | null {
  try {
    return typeof globalThis.localStorage === "undefined"
      ? null
      : globalThis.localStorage;
  } catch {
    return null;
  }
}

function hashText(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/** Stable logical package identity for every release published from one local candidate. */
export function studioCommunityShareCandidateLegacyPackageId(
  candidate: Pick<StudioCommunityShareCandidate, "id" | "kind">,
): string {
  return `community/${candidate.kind}/${hashText(`${candidate.kind}:${candidate.id}`)}`;
}

export function studioCommunityShareCandidateLegacyIdentity(
  candidate: Pick<StudioCommunityShareCandidate, "id" | "kind">,
): StudioCommunityShareCandidateIdentity {
  const suffix = hashText(`${candidate.kind}:${candidate.id}`);
  return {
    scheme: "legacy",
    packageId: `community/${candidate.kind}/${suffix}`,
    entryId: `${candidate.kind}/${suffix}`,
  };
}

/** Collision-resistant identity used for candidates that have never been published before. */
export function studioCommunityShareCandidateIdentity(
  candidate: Pick<StudioCommunityShareCandidate, "id" | "kind">,
): StudioCommunityShareCandidateIdentity {
  const digest = sha256HexPortable(
    new TextEncoder().encode(`${candidate.kind}\0${candidate.id}`),
  );
  const suffix = `v2-${digest}`;
  return {
    scheme: "v2",
    packageId: `community/${candidate.kind}/${suffix}`,
    entryId: `${candidate.kind}/${suffix}`,
  };
}

export function studioCommunityShareCandidatePackageId(
  candidate: Pick<StudioCommunityShareCandidate, "id" | "kind">,
): string {
  return studioCommunityShareCandidateIdentity(candidate).packageId;
}

function resolveStudioCommunityShareCandidateIdentity(
  candidate: Pick<StudioCommunityShareCandidate, "id" | "kind">,
  requested: StudioCommunityShareCandidateIdentity | undefined,
): StudioCommunityShareCandidateIdentity {
  const v2 = studioCommunityShareCandidateIdentity(candidate);
  const legacy = studioCommunityShareCandidateLegacyIdentity(candidate);
  const identity = requested ?? v2;
  const expected = identity.scheme === "legacy" ? legacy : v2;
  if (
    identity.packageId !== expected.packageId
    || identity.entryId !== expected.entryId
  ) {
    throw new Error("게시 후보와 일치하지 않는 package identity입니다.");
  }
  return expected;
}

export async function createStudioCommunityPublishManifest(
  candidate: StudioCommunityShareCandidate,
  options: StudioCommunityPublishOptions,
): Promise<CreatorMarketplaceResourceManifest> {
  if (!isStudioCommunityShareableLocalResourceId(candidate.id)) {
    throw new Error(
      "마켓이나 Creator Pack에서 설치한 자료는 원본 출처·재배포 권한을 보존한 게시 경로가 없어 다시 공유할 수 없습니다.",
    );
  }
  if (!options.creatorOwnsRights) {
    throw new Error("직접 제작했거나 게시·재배포 권리를 보유한 리소스만 공유할 수 있습니다.");
  }
  if (options.recognizableMarketplaceDerivative) {
    throw new Error("다른 마켓 상품의 복제·식별 가능한 변형은 공유할 수 없습니다.");
  }
  const resourceVersion = options.resourceVersion.trim();
  if (!isCreatorMarketplaceSemver(resourceVersion)) {
    throw new Error(
      "릴리스 버전은 1.2.3 형식의 정확한 SemVer여야 합니다. 숫자 prerelease에는 선행 0을 사용할 수 없습니다.",
    );
  }
  const delivery = await createCreatorMarketplacePortableDelivery(
    candidate.kind,
    candidate.definition,
  );
  const identity = resolveStudioCommunityShareCandidateIdentity(
    candidate,
    options.resolvedIdentity,
  );
  const releaseNotes = options.releaseNotes?.trim();
  const attributionText = options.attributionText?.trim() ?? "";
  return {
    schemaVersion: 1,
    packageId: identity.packageId,
    name: candidate.name.slice(0, 80),
    description: (options.description?.trim() ?? "").slice(0, 1_000),
    ...(releaseNotes ? { releaseNotes } : {}),
    kind: candidate.kind,
    resourceVersion,
    minimumStudioVersion: STUDIO_MARKETPLACE_COMPATIBILITY_VERSION,
    tags: [candidate.kind, "community"],
    license: options.license,
    attributionText,
    containsAi: options.containsAi,
    rightsConfirmed: true,
    provenance: { origin: "original", authoredByPublisher: true },
    compatibility: { engines: ["canvas2d"] },
    entries: [{
      id: identity.entryId,
      kind: candidate.kind,
      name: candidate.name.slice(0, 80),
      delivery,
    }],
  };
}
