/** Safe, exact migration from release-scoped community pack ids to logical package ids. */

import {
  sanitizeBrushSnapshot,
  type StudioSavedBrush,
} from "./brush/studio-brush-library";
import {
  notifyStudioBrushLibraryChanged,
  readAllBrushesFromRepository,
  type ProductBrushLibraryRepository,
} from "./brush/studio-brush-library-sqlite-repository";
import {
  notifyStudioFilterLibraryChanged,
  normalizeStudioFilterLibraryPreset,
  readAllFilterPresetsFromRepository,
  type ProductFilterLibraryRepository,
  type StudioFilterLibraryPreset,
} from "./filter/studio-filter-library-sqlite-repository";
import {
  normalizeStudioFilterPackValues,
  type StudioFilterPackKind,
  type StudioFilterPackValues,
} from "./filter/studio-filter-pack";
import { projectCreatorMarketplaceRecordToStudioPack } from "./studio-community-marketplace";

import type { StudioCreatorPackDefinition } from "./studio-creator-pack-catalog";
import type { StudioLocalDatabase } from "./studio-local-database";
import type { StudioNamedPalette } from "./studio-palette-library";
import type { StudioPaletteSqliteRepository } from "./studio-palette-sqlite-repository";

import {
  writeCreatorMarketplaceInstallReceipt,
  type CreatorMarketplaceInstallReceiptStorage,
} from "@/shared/lib/creator-marketplace-install-receipt";
import { creatorMarketplaceStudioPackId } from "@/shared/lib/creator-marketplace-package-identity";
import {
  canonicalizeCreatorMarketplaceJson,
  CreatorMarketplaceResourceIdentitySchema,
  CreatorMarketplaceResourceRecordSchema,
  type CreatorMarketplaceResourceIdentity,
  type CreatorMarketplaceResourceRecord,
} from "@/shared/lib/creator-marketplace-resource-contract";
import { normalizeCreatorMarketplaceLegacySemver } from "@/shared/lib/creator-marketplace-semver";
import {
  getCreatorMarketplaceResource,
  getCreatorMarketplaceResourceIdentity,
} from "@/src/infrastructure/creator-marketplace-client";

export const STUDIO_CREATOR_PACK_SQLITE_NAMESPACE = "studio-creator-pack-v12";

type MigratableKind = "brush" | "filter" | "palette";

export interface StudioCreatorPackSqliteReceipt {
  readonly version: 1;
  readonly packageId: string;
  readonly packageVersion: string;
  readonly packageFingerprint: string;
  readonly kind: "brush" | "palette";
  readonly updatedAt: number;
}

export type StudioCommunityPackLegacyMigrationResult =
  | Readonly<{ status: "none" }>
  | Readonly<{
      status: "migrated";
      installedVersion: string;
      installedFingerprint: string;
    }>
  | Readonly<{
      status: "conflict" | "repair-required";
      reason: string;
    }>;

export interface StudioCommunityPackLegacyMigrationOptions {
  readonly acquireBrushRepository: () => Promise<ProductBrushLibraryRepository>;
  readonly acquireFilterRepository: () => Promise<ProductFilterLibraryRepository>;
  readonly acquirePaletteRepository: () => Promise<StudioPaletteSqliteRepository>;
  readonly acquireDatabase: () => Promise<StudioLocalDatabase>;
  readonly loadResource?: (
    id: string,
    signal?: AbortSignal,
  ) => Promise<CreatorMarketplaceResourceRecord>;
  readonly loadResourceIdentity?: (
    id: string,
    signal?: AbortSignal,
  ) => Promise<CreatorMarketplaceResourceIdentity>;
  readonly installReceiptStorage?: CreatorMarketplaceInstallReceiptStorage | null;
  readonly signal?: AbortSignal;
  readonly now?: () => number;
  readonly assertCurrent: () => void;
}

interface LegacyRuntimeGroup<Row> {
  readonly releaseId: string;
  readonly legacyPackageId: string;
  readonly rows: readonly Row[];
}

interface VerifiedLegacyCandidate<Row> {
  readonly group: LegacyRuntimeGroup<Row>;
  readonly record: CreatorMarketplaceResourceRecord;
  readonly pack: StudioCreatorPackDefinition;
}

const LEGACY_RUNTIME_ID_PATTERN =
  /^creator-pack:(community:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})):(.+)$/u;
const RESOURCE_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

export function studioCreatorPackReceiptKey(
  kind: StudioCreatorPackSqliteReceipt["kind"],
  packageId: string,
): string {
  return `${kind}:${packageId}`;
}

export function parseStudioCreatorPackSqliteReceipt(
  raw: string | null,
  kind: StudioCreatorPackSqliteReceipt["kind"],
): StudioCreatorPackSqliteReceipt | null {
  if (raw === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new Error("Creator Pack SQLite receipt is corrupt", { cause: error });
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Creator Pack SQLite receipt is corrupt");
  }
  const receipt = value as Partial<StudioCreatorPackSqliteReceipt>;
  if (
    receipt.version !== 1
    || typeof receipt.packageId !== "string"
    || typeof receipt.packageVersion !== "string"
    || typeof receipt.packageFingerprint !== "string"
    || receipt.kind !== kind
    || typeof receipt.updatedAt !== "number"
    || !Number.isFinite(receipt.updatedAt)
  ) {
    throw new Error("Creator Pack SQLite receipt has an unsupported shape");
  }
  return receipt as StudioCreatorPackSqliteReceipt;
}

export function serializeStudioCreatorPackSqliteReceipt(input: {
  readonly packageId: string;
  readonly packageVersion: string;
  readonly packageFingerprint: string;
  readonly kind: StudioCreatorPackSqliteReceipt["kind"];
  readonly updatedAt: number;
}): string {
  return JSON.stringify({
    version: 1,
    ...input,
  } satisfies StudioCreatorPackSqliteReceipt);
}

function runtimeItemId(packageId: string, entryId: string): string {
  return `creator-pack:${packageId}:${entryId}`;
}

function legacyRuntimeIdentity(id: string): {
  readonly releaseId: string;
  readonly packageId: string;
} | null {
  const match = LEGACY_RUNTIME_ID_PATTERN.exec(id);
  if (!match) return null;
  return { releaseId: match[2]!, packageId: match[1]! };
}

function groupLegacyRows<Row extends { readonly id: string }>(
  rows: readonly Row[],
): LegacyRuntimeGroup<Row>[] {
  const groups = new Map<string, { packageId: string; rows: Row[] }>();
  for (const row of rows) {
    const identity = legacyRuntimeIdentity(row.id);
    if (!identity) continue;
    const existing = groups.get(identity.releaseId);
    if (existing && existing.packageId !== identity.packageId) {
      return [{
        releaseId: identity.releaseId,
        legacyPackageId: "",
        rows: [],
      }];
    }
    if (existing) existing.rows.push(row);
    else groups.set(identity.releaseId, { packageId: identity.packageId, rows: [row] });
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([releaseId, group]) => ({
      releaseId,
      legacyPackageId: group.packageId,
      rows: group.rows,
    }));
}

function issue(
  status: "conflict" | "repair-required",
  reason: string,
): StudioCommunityPackLegacyMigrationResult {
  return { status, reason };
}

function sameJson(left: unknown, right: unknown): boolean {
  try {
    return canonicalizeCreatorMarketplaceJson(left)
      === canonicalizeCreatorMarketplaceJson(right);
  } catch {
    return false;
  }
}

function logicalPrefix(pack: StudioCreatorPackDefinition): string {
  return `creator-pack:${pack.metadata.id}:`;
}

function legacyPack(
  candidate: StudioCreatorPackDefinition,
  legacyPackageId: string,
): StudioCreatorPackDefinition {
  return {
    ...candidate,
    metadata: { ...candidate.metadata, id: legacyPackageId },
  };
}

function validCurrentSource(pack: StudioCreatorPackDefinition): boolean {
  const source = pack.marketplaceSource;
  if (
    !source
    || source.schema !== "creator-marketplace-resource-v1"
    || !RESOURCE_UUID_PATTERN.test(source.releaseId)
    || source.publisherId.length === 0
    || source.packageId.length === 0
    || pack.metadata.creator.id !== source.publisherId
  ) return false;
  try {
    return creatorMarketplaceStudioPackId({
      packageId: source.packageId,
      publisher: { id: source.publisherId },
    }) === pack.metadata.id;
  } catch {
    return false;
  }
}

async function resolveMatchingCandidate<Row extends { readonly id: string }>(
  currentPack: StudioCreatorPackDefinition,
  groups: readonly LegacyRuntimeGroup<Row>[],
  options: StudioCommunityPackLegacyMigrationOptions,
): Promise<
  | { readonly status: "none" }
  | { readonly status: "candidate"; readonly candidate: VerifiedLegacyCandidate<Row> }
  | { readonly status: "conflict" | "repair-required"; readonly reason: string }
> {
  const source = currentPack.marketplaceSource!;
  const matches: VerifiedLegacyCandidate<Row>[] = [];
  const loadResource = options.loadResource ?? getCreatorMarketplaceResource;
  const loadResourceIdentity = options.loadResourceIdentity
    ?? getCreatorMarketplaceResourceIdentity;
  for (const group of groups) {
    if (!group.legacyPackageId) {
      return {
        status: "conflict",
        reason: "레거시 Creator Pack UUID가 서로 다른 로컬 package ID로 중복되어 있습니다.",
      };
    }
    options.assertCurrent();
    let identity: CreatorMarketplaceResourceIdentity;
    try {
      identity = CreatorMarketplaceResourceIdentitySchema.parse(
        await loadResourceIdentity(group.releaseId, options.signal),
      );
    } catch {
      options.assertCurrent();
      return {
        status: "repair-required",
        reason: "레거시 Creator Pack 릴리스 식별자를 서버에서 확인할 수 없어 자동 이전하지 않았습니다.",
      };
    }
    options.assertCurrent();
    if (
      identity.id !== group.releaseId
      || group.legacyPackageId !== `community:${identity.id}`
    ) {
      return {
        status: "conflict",
        reason: "로컬 레거시 UUID와 서버 릴리스 식별자가 정확히 일치하지 않습니다.",
      };
    }
    if (
      identity.publisherId !== source.publisherId
      || identity.packageId !== source.packageId
    ) continue;
    if (identity.kind !== currentPack.metadata.kind) {
      return {
        status: "conflict",
        reason: "같은 Creator Market package의 로컬 종류와 서버 종류가 일치하지 않습니다.",
      };
    }
    if (identity.availability !== "listed") {
      return {
        status: "repair-required",
        reason: "같은 Creator Market package의 레거시 릴리스가 현재 공개 설치 대상이 아니어서 자동 이전하지 않았습니다.",
      };
    }
    let record: CreatorMarketplaceResourceRecord;
    try {
      record = CreatorMarketplaceResourceRecordSchema.parse(
        await loadResource(group.releaseId, options.signal),
      );
    } catch {
      options.assertCurrent();
      return {
        status: "repair-required",
        reason: "레거시 Creator Pack 릴리스를 서버에서 확인할 수 없어 자동 이전하지 않았습니다.",
      };
    }
    options.assertCurrent();
    if (
      record.id !== group.releaseId
      || group.legacyPackageId !== `community:${record.id}`
      || record.publisher.id !== identity.publisherId
      || record.packageId !== identity.packageId
      || record.kind !== identity.kind
    ) {
      return {
        status: "conflict",
        reason: "레거시 릴리스 식별자와 공개 릴리스의 정확한 메타데이터가 일치하지 않습니다.",
      };
    }
    const projection = projectCreatorMarketplaceRecordToStudioPack(record);
    if (
      projection.status !== "installable"
      || projection.pack.metadata.id !== currentPack.metadata.id
      || projection.pack.marketplaceSource?.publisherId !== source.publisherId
      || projection.pack.marketplaceSource.packageId !== source.packageId
    ) {
      return {
        status: "conflict",
        reason: "서버 릴리스를 현재 Studio 논리 팩으로 안전하게 투영할 수 없습니다.",
      };
    }
    matches.push({ group, record, pack: projection.pack });
  }
  if (matches.length === 0) return { status: "none" };
  if (matches.length !== 1) {
    return {
      status: "conflict",
      reason: "같은 논리 팩에 속한 레거시 릴리스가 둘 이상 설치되어 자동 병합하지 않았습니다.",
    };
  }
  return { status: "candidate", candidate: matches[0]! };
}

function verifyReceipt(
  raw: string | null,
  legacyPackageId: string,
  candidate: StudioCreatorPackDefinition,
  kind: "brush" | "palette",
): StudioCreatorPackSqliteReceipt | StudioCommunityPackLegacyMigrationResult {
  if (raw === null) {
    return issue("repair-required", "레거시 Creator Pack 설치 영수증이 없습니다.");
  }
  let receipt: StudioCreatorPackSqliteReceipt;
  try {
    receipt = parseStudioCreatorPackSqliteReceipt(raw, kind)!;
  } catch {
    return issue("repair-required", "레거시 Creator Pack 설치 영수증이 손상되었습니다.");
  }
  const normalizedVersion = normalizeCreatorMarketplaceLegacySemver(
    receipt.packageVersion,
  );
  if (
    receipt.packageId !== legacyPackageId
    || normalizedVersion !== candidate.metadata.version
    || receipt.packageFingerprint !== candidate.metadata.packageFingerprint
    || receipt.kind !== kind
    || !Number.isSafeInteger(receipt.updatedAt)
    || receipt.updatedAt < 0
  ) {
    return issue("conflict", "레거시 Creator Pack 영수증이 서버 릴리스와 일치하지 않습니다.");
  }
  return receipt;
}

function brushFromEntry(
  pack: StudioCreatorPackDefinition,
  entryIndex: number,
  previous: StudioSavedBrush,
): StudioSavedBrush {
  const entry = pack.entries[entryIndex]!;
  if (entry.delivery.mode !== "portable-json") {
    throw new Error(`Brush pack entry ${entry.id} is not portable JSON`);
  }
  const snapshot = sanitizeBrushSnapshot(entry.delivery.definition.snapshot).snapshot;
  const id = runtimeItemId(pack.metadata.id, entry.id);
  return {
    ...snapshot,
    id,
    name: entry.name,
    sourcePresetId: id,
    sourcePresetName: entry.name,
    createdAt: previous.createdAt,
    updatedAt: previous.updatedAt,
    pinned: previous.pinned,
    lastUsedAt: previous.lastUsedAt,
  };
}

function filterFromEntry(
  pack: StudioCreatorPackDefinition,
  entryIndex: number,
  previous: StudioFilterLibraryPreset,
): StudioFilterLibraryPreset {
  const entry = pack.entries[entryIndex]!;
  if (entry.delivery.mode !== "portable-json") {
    throw new Error(`Filter pack entry ${entry.id} is not portable JSON`);
  }
  const definition = entry.delivery.definition;
  const engine = definition.engine as StudioFilterPackKind;
  return normalizeStudioFilterLibraryPreset({
    id: runtimeItemId(pack.metadata.id, entry.id),
    packageId: pack.metadata.id,
    entryId: entry.id,
    name: entry.name,
    engine,
    values: normalizeStudioFilterPackValues(
      engine,
      definition.values as StudioFilterPackValues,
    ),
    installedAt: previous.installedAt,
    updatedAt: previous.updatedAt,
    category: pack.metadata.category,
    favorite: previous.favorite,
    sortOrder: previous.sortOrder,
    packageVersion: pack.metadata.version,
    packageFingerprint: pack.metadata.packageFingerprint,
  });
}

function paletteFromEntry(
  pack: StudioCreatorPackDefinition,
  entryIndex: number,
  previous: StudioNamedPalette,
): StudioNamedPalette {
  const entry = pack.entries[entryIndex]!;
  if (entry.delivery.mode !== "portable-json") {
    throw new Error(`Palette pack entry ${entry.id} is not portable JSON`);
  }
  return {
    id: runtimeItemId(pack.metadata.id, entry.id),
    name: entry.name,
    createdAt: previous.createdAt,
    updatedAt: previous.updatedAt,
    colors: [...entry.delivery.definition.colors as string[]],
  };
}

function candidateRowsByEntry<Row extends { readonly id: string }>(
  candidate: VerifiedLegacyCandidate<Row>,
): Map<string, Row> | null {
  if (candidate.group.rows.length !== candidate.pack.entries.length) return null;
  const byId = new Map(candidate.group.rows.map((row) => [row.id, row]));
  if (byId.size !== candidate.group.rows.length) return null;
  for (const entry of candidate.pack.entries) {
    if (!byId.has(runtimeItemId(candidate.group.legacyPackageId, entry.id))) return null;
  }
  return byId;
}

function publishLightweightReceipt(
  pack: StudioCreatorPackDefinition,
  options: StudioCommunityPackLegacyMigrationOptions,
): void {
  const now = (options.now ?? Date.now)();
  writeCreatorMarketplaceInstallReceipt({
    logicalPackId: pack.metadata.id,
    packageVersion: pack.metadata.version,
    packageFingerprint: pack.metadata.packageFingerprint,
    kind: pack.metadata.kind as MigratableKind,
    installedAt: now,
  }, options.installReceiptStorage, now);
}

async function migrateBrush(
  currentPack: StudioCreatorPackDefinition,
  options: StudioCommunityPackLegacyMigrationOptions,
): Promise<StudioCommunityPackLegacyMigrationResult> {
  const product = await options.acquireBrushRepository();
  options.assertCurrent();
  const allRows = await readAllBrushesFromRepository(product.repository);
  const resolved = await resolveMatchingCandidate(
    currentPack,
    groupLegacyRows(allRows),
    options,
  );
  if (resolved.status !== "candidate") return resolved;
  const candidate = resolved.candidate;
  const database = await options.acquireDatabase();
  options.assertCurrent();
  const logicalRows = allRows.filter((row) => row.id.startsWith(logicalPrefix(currentPack)));
  const logicalReceiptRaw = await database.kvGet(
    STUDIO_CREATOR_PACK_SQLITE_NAMESPACE,
    studioCreatorPackReceiptKey("brush", currentPack.metadata.id),
  );
  if (logicalRows.length > 0 || logicalReceiptRaw !== null) {
    return issue("conflict", "논리 ID와 레거시 ID의 브러시 설치가 동시에 존재합니다.");
  }
  const rowsById = candidateRowsByEntry(candidate);
  if (!rowsById) {
    return issue("repair-required", "레거시 브러시 행이 서버 entry 집합과 완전하게 일치하지 않습니다.");
  }
  const oldPack = legacyPack(candidate.pack, candidate.group.legacyPackageId);
  const oldRows: StudioSavedBrush[] = [];
  const newRows: StudioSavedBrush[] = [];
  for (const [index, entry] of candidate.pack.entries.entries()) {
    const oldId = runtimeItemId(candidate.group.legacyPackageId, entry.id);
    const row = rowsById.get(oldId)!;
    const expected = brushFromEntry(oldPack, index, row);
    if (!sameJson(row, expected)) {
      return issue("conflict", "레거시 브러시 정의가 서버 릴리스와 일치하지 않습니다.");
    }
    oldRows.push(row);
    newRows.push(brushFromEntry(candidate.pack, index, row));
  }
  const oldReceiptKey = studioCreatorPackReceiptKey(
    "brush",
    candidate.group.legacyPackageId,
  );
  const oldReceiptRaw = await database.kvGet(
    STUDIO_CREATOR_PACK_SQLITE_NAMESPACE,
    oldReceiptKey,
  );
  const receipt = verifyReceipt(
    oldReceiptRaw,
    candidate.group.legacyPackageId,
    candidate.pack,
    "brush",
  );
  if (!("version" in receipt)) return receipt;
  if (!product.compareAndRestoreInstallSnapshot || !product.insertMissingInstallSnapshot) {
    return issue("repair-required", "브러시 저장소가 안전한 원자 이전을 지원하지 않습니다.");
  }
  const newReceiptKey = studioCreatorPackReceiptKey("brush", candidate.pack.metadata.id);
  const newReceiptRaw = serializeStudioCreatorPackSqliteReceipt({
    packageId: candidate.pack.metadata.id,
    packageVersion: candidate.pack.metadata.version,
    packageFingerprint: candidate.pack.metadata.packageFingerprint,
    kind: "brush",
    updatedAt: receipt.updatedAt,
  });
  const oldReceiptIdentity = `${STUDIO_CREATOR_PACK_SQLITE_NAMESPACE}\u0000${oldReceiptKey}`;
  const newReceiptIdentity = `${STUDIO_CREATOR_PACK_SQLITE_NAMESPACE}\u0000${newReceiptKey}`;
  const createdNewRows: StudioSavedBrush[] = [];
  let createdNewReceipt = false;
  let removedOldRows: StudioSavedBrush[] = [];
  let removedOldReceipt = false;
  const rollback = async (): Promise<void> => {
    await product.insertMissingInstallSnapshot!(removedOldRows);
    const restoreOld = await product.compareAndRestoreInstallSnapshot!(
      [],
      removedOldReceipt
        ? [{
            namespace: STUDIO_CREATOR_PACK_SQLITE_NAMESPACE,
            key: oldReceiptKey,
            expected: null,
            restore: oldReceiptRaw,
          }]
        : [],
    );
    const removeNew = await product.compareAndRestoreInstallSnapshot!(
      createdNewRows.map((row) => ({ id: row.id, expected: row, restore: null })),
      createdNewReceipt
        ? [{
            namespace: STUDIO_CREATOR_PACK_SQLITE_NAMESPACE,
            key: newReceiptKey,
            expected: newReceiptRaw,
            restore: null,
          }]
        : [],
    );
    if (restoreOld.conflictIds.length > 0 || removeNew.conflictIds.length > 0) {
      throw new Error("브러시 레거시 이전 rollback이 새 사용자 변경과 충돌했습니다.");
    }
    const restoredOld = await Promise.all(
      removedOldRows.map((row) => product.repository.getById(row.id)),
    );
    if (
      restoredOld.some((row, index) =>
        row === null || !sameJson(row, removedOldRows[index]))
    ) {
      throw new Error("브러시 레거시 이전 rollback을 완전하게 검증하지 못했습니다.");
    }
  };
  try {
    options.assertCurrent();
    for (const row of newRows) {
      if (await product.insertMissingInstallSnapshot([row]) !== 1) {
        throw new Error("논리 ID 브러시가 이전 중 먼저 생성되어 덮어쓰지 않았습니다.");
      }
      createdNewRows.push(row);
      options.assertCurrent();
    }
    const receiptWrite = await product.compareAndRestoreInstallSnapshot([], [{
      namespace: STUDIO_CREATOR_PACK_SQLITE_NAMESPACE,
      key: newReceiptKey,
      expected: logicalReceiptRaw,
      restore: newReceiptRaw,
    }]);
    createdNewReceipt = receiptWrite.restoredIds.includes(newReceiptIdentity);
    if (receiptWrite.conflictIds.length > 0 || !createdNewReceipt) {
      throw new Error("논리 ID 브러시 영수증이 이전 중 먼저 생성되어 덮어쓰지 않았습니다.");
    }
    options.assertCurrent();
    const verifiedNew = await Promise.all(
      newRows.map((row) => product.repository.getById(row.id)),
    );
    const verifiedReceipt = await database.kvGet(
      STUDIO_CREATOR_PACK_SQLITE_NAMESPACE,
      newReceiptKey,
    );
    if (
      verifiedReceipt !== newReceiptRaw
      || verifiedNew.some((row, index) => row === null || !sameJson(row, newRows[index]))
    ) throw new Error("새 논리 ID 브러시를 완전하게 검증하지 못했습니다.");
    const removed = await product.compareAndRestoreInstallSnapshot(
      oldRows.map((row) => ({ id: row.id, expected: row, restore: null })),
      [{
        namespace: STUDIO_CREATOR_PACK_SQLITE_NAMESPACE,
        key: oldReceiptKey,
        expected: oldReceiptRaw,
        restore: null,
      }],
    );
    const removedIds = new Set(removed.restoredIds);
    removedOldRows = oldRows.filter((row) => removedIds.has(row.id));
    removedOldReceipt = removedIds.has(oldReceiptIdentity);
    if (
      removed.conflictIds.length > 0
      || removedOldRows.length !== oldRows.length
      || !removedOldReceipt
    ) {
      throw new Error("레거시 브러시가 이전 중 변경되어 제거하지 않았습니다.");
    }
    options.assertCurrent();
    const oldRemaining = await Promise.all(
      oldRows.map((row) => product.repository.getById(row.id)),
    );
    if (
      oldRemaining.some((row) => row !== null)
      || await database.kvGet(STUDIO_CREATOR_PACK_SQLITE_NAMESPACE, oldReceiptKey) !== null
    ) throw new Error("레거시 브러시 제거를 완전하게 검증하지 못했습니다.");
  } catch (error) {
    try {
      await rollback();
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        "브러시 레거시 이전 rollback 실패",
        { cause: rollbackError },
      );
    }
    throw error;
  }
  notifyStudioBrushLibraryChanged();
  publishLightweightReceipt(candidate.pack, options);
  return {
    status: "migrated",
    installedVersion: candidate.pack.metadata.version,
    installedFingerprint: candidate.pack.metadata.packageFingerprint,
  };
}

async function migrateFilter(
  currentPack: StudioCreatorPackDefinition,
  options: StudioCommunityPackLegacyMigrationOptions,
): Promise<StudioCommunityPackLegacyMigrationResult> {
  const product = await options.acquireFilterRepository();
  options.assertCurrent();
  const allRows = await readAllFilterPresetsFromRepository(product.repository);
  const resolved = await resolveMatchingCandidate(
    currentPack,
    groupLegacyRows(allRows),
    options,
  );
  if (resolved.status !== "candidate") return resolved;
  const candidate = resolved.candidate;
  if (allRows.some((row) => row.id.startsWith(logicalPrefix(currentPack)))) {
    return issue("conflict", "논리 ID와 레거시 ID의 필터 설치가 동시에 존재합니다.");
  }
  const rowsById = candidateRowsByEntry(candidate);
  if (!rowsById) {
    return issue("repair-required", "레거시 필터 행이 서버 entry 집합과 완전하게 일치하지 않습니다.");
  }
  const oldPack = legacyPack(candidate.pack, candidate.group.legacyPackageId);
  const oldRows: StudioFilterLibraryPreset[] = [];
  const newRows: StudioFilterLibraryPreset[] = [];
  for (const [index, entry] of candidate.pack.entries.entries()) {
    const oldId = runtimeItemId(candidate.group.legacyPackageId, entry.id);
    const row = rowsById.get(oldId)!;
    if (
      row.packageId !== candidate.group.legacyPackageId
      || row.entryId !== entry.id
      || normalizeCreatorMarketplaceLegacySemver(row.packageVersion)
        !== candidate.pack.metadata.version
      || row.packageFingerprint !== candidate.pack.metadata.packageFingerprint
    ) {
      return issue("conflict", "레거시 필터 영수증 필드가 서버 릴리스와 일치하지 않습니다.");
    }
    const expected = {
      ...filterFromEntry(oldPack, index, row),
      packageVersion: row.packageVersion,
    };
    if (!sameJson(row, expected)) {
      return issue("conflict", "레거시 필터 정의가 서버 릴리스와 일치하지 않습니다.");
    }
    oldRows.push(row);
    newRows.push(filterFromEntry(candidate.pack, index, row));
  }
  if (!product.compareAndRestoreInstallSnapshot || !product.insertMissingInstallSnapshot) {
    return issue("repair-required", "필터 저장소가 안전한 원자 이전을 지원하지 않습니다.");
  }
  const createdNewRows: StudioFilterLibraryPreset[] = [];
  let removedOldRows: StudioFilterLibraryPreset[] = [];
  const rollback = async (): Promise<void> => {
    await product.insertMissingInstallSnapshot!(removedOldRows);
    const removeNew = await product.compareAndRestoreInstallSnapshot!(
      createdNewRows.map((row) => ({ id: row.id, expected: row, restore: null })),
    );
    if (removeNew.conflictIds.length > 0) {
      throw new Error("필터 레거시 이전 rollback이 새 사용자 변경과 충돌했습니다.");
    }
    const restoredOld = await Promise.all(
      removedOldRows.map((row) => product.repository.getById(row.id)),
    );
    if (
      restoredOld.some((row, index) =>
        row === null || !sameJson(row, removedOldRows[index]))
    ) {
      throw new Error("필터 레거시 이전 rollback을 완전하게 검증하지 못했습니다.");
    }
  };
  try {
    options.assertCurrent();
    for (const row of newRows) {
      if (await product.insertMissingInstallSnapshot([row]) !== 1) {
        throw new Error("논리 ID 필터가 이전 중 먼저 생성되어 덮어쓰지 않았습니다.");
      }
      createdNewRows.push(row);
      options.assertCurrent();
    }
    const verifiedNew = await Promise.all(
      newRows.map((row) => product.repository.getById(row.id)),
    );
    if (verifiedNew.some((row, index) => row === null || !sameJson(row, newRows[index]))) {
      throw new Error("새 논리 ID 필터를 완전하게 검증하지 못했습니다.");
    }
    const removed = await product.compareAndRestoreInstallSnapshot(
      oldRows.map((row) => ({ id: row.id, expected: row, restore: null })),
    );
    const removedIds = new Set(removed.restoredIds);
    removedOldRows = oldRows.filter((row) => removedIds.has(row.id));
    if (
      removed.conflictIds.length > 0
      || removedOldRows.length !== oldRows.length
    ) {
      throw new Error("레거시 필터가 이전 중 변경되어 제거하지 않았습니다.");
    }
    options.assertCurrent();
    const oldRemaining = await Promise.all(
      oldRows.map((row) => product.repository.getById(row.id)),
    );
    if (oldRemaining.some((row) => row !== null)) {
      throw new Error("레거시 필터 제거를 완전하게 검증하지 못했습니다.");
    }
  } catch (error) {
    try {
      await rollback();
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        "필터 레거시 이전 rollback 실패",
        { cause: rollbackError },
      );
    }
    throw error;
  }
  notifyStudioFilterLibraryChanged();
  publishLightweightReceipt(candidate.pack, options);
  return {
    status: "migrated",
    installedVersion: candidate.pack.metadata.version,
    installedFingerprint: candidate.pack.metadata.packageFingerprint,
  };
}

async function migratePalette(
  currentPack: StudioCreatorPackDefinition,
  options: StudioCommunityPackLegacyMigrationOptions,
): Promise<StudioCommunityPackLegacyMigrationResult> {
  const repository = await options.acquirePaletteRepository();
  options.assertCurrent();
  const allRows = await repository.list();
  const resolved = await resolveMatchingCandidate(
    currentPack,
    groupLegacyRows(allRows),
    options,
  );
  if (resolved.status !== "candidate") return resolved;
  const candidate = resolved.candidate;
  const logicalRows = allRows.filter((row) => row.id.startsWith(logicalPrefix(currentPack)));
  const newReceiptKey = studioCreatorPackReceiptKey("palette", currentPack.metadata.id);
  const logicalReceiptRaw = await repository.readSidecar(
    STUDIO_CREATOR_PACK_SQLITE_NAMESPACE,
    newReceiptKey,
  );
  if (logicalRows.length > 0 || logicalReceiptRaw !== null) {
    return issue("conflict", "논리 ID와 레거시 ID의 팔레트 설치가 동시에 존재합니다.");
  }
  const rowsById = candidateRowsByEntry(candidate);
  if (!rowsById) {
    return issue("repair-required", "레거시 팔레트 행이 서버 entry 집합과 완전하게 일치하지 않습니다.");
  }
  const oldPack = legacyPack(candidate.pack, candidate.group.legacyPackageId);
  const oldRows: StudioNamedPalette[] = [];
  const newRows: StudioNamedPalette[] = [];
  for (const [index, entry] of candidate.pack.entries.entries()) {
    const oldId = runtimeItemId(candidate.group.legacyPackageId, entry.id);
    const row = rowsById.get(oldId)!;
    if (!sameJson(row, paletteFromEntry(oldPack, index, row))) {
      return issue("conflict", "레거시 팔레트 정의가 서버 릴리스와 일치하지 않습니다.");
    }
    oldRows.push(row);
    newRows.push(paletteFromEntry(candidate.pack, index, row));
  }
  const oldReceiptKey = studioCreatorPackReceiptKey(
    "palette",
    candidate.group.legacyPackageId,
  );
  const oldReceiptRaw = await repository.readSidecar(
    STUDIO_CREATOR_PACK_SQLITE_NAMESPACE,
    oldReceiptKey,
  );
  const receipt = verifyReceipt(
    oldReceiptRaw,
    candidate.group.legacyPackageId,
    candidate.pack,
    "palette",
  );
  if (!("version" in receipt)) return receipt;
  const newReceiptRaw = serializeStudioCreatorPackSqliteReceipt({
    packageId: candidate.pack.metadata.id,
    packageVersion: candidate.pack.metadata.version,
    packageFingerprint: candidate.pack.metadata.packageFingerprint,
    kind: "palette",
    updatedAt: receipt.updatedAt,
  });
  try {
    options.assertCurrent();
    await repository.commitBatch({
      upsert: newRows,
      deleteIds: oldRows.map((row) => row.id),
      sidecars: [
        {
          namespace: STUDIO_CREATOR_PACK_SQLITE_NAMESPACE,
          key: newReceiptKey,
          value: newReceiptRaw,
        },
        {
          namespace: STUDIO_CREATOR_PACK_SQLITE_NAMESPACE,
          key: oldReceiptKey,
          value: null,
        },
      ],
      expected: {
        items: [
          ...oldRows.map((row) => ({ id: row.id, value: row })),
          ...newRows.map((row) => ({ id: row.id, value: null })),
        ],
        sidecars: [
          {
            namespace: STUDIO_CREATOR_PACK_SQLITE_NAMESPACE,
            key: oldReceiptKey,
            value: oldReceiptRaw,
          },
          {
            namespace: STUDIO_CREATOR_PACK_SQLITE_NAMESPACE,
            key: newReceiptKey,
            value: logicalReceiptRaw,
          },
        ],
      },
      assertCurrent: options.assertCurrent,
    });
    options.assertCurrent();
    const verifiedRows = await repository.list();
    const byId = new Map(verifiedRows.map((row) => [row.id, row]));
    if (
      newRows.some((row) => !sameJson(byId.get(row.id), row))
      || oldRows.some((row) => byId.has(row.id))
      || await repository.readSidecar(
        STUDIO_CREATOR_PACK_SQLITE_NAMESPACE,
        newReceiptKey,
      ) !== newReceiptRaw
      || await repository.readSidecar(
        STUDIO_CREATOR_PACK_SQLITE_NAMESPACE,
        oldReceiptKey,
      ) !== null
    ) throw new Error("팔레트 레거시 이전을 완전하게 검증하지 못했습니다.");
  } catch (error) {
    try {
      const rollbackRows = await repository.list();
      const rollbackById = new Map(rollbackRows.map((row) => [row.id, row]));
      const rollbackOldReceipt = await repository.readSidecar(
        STUDIO_CREATOR_PACK_SQLITE_NAMESPACE,
        oldReceiptKey,
      );
      const rollbackNewReceipt = await repository.readSidecar(
        STUDIO_CREATOR_PACK_SQLITE_NAMESPACE,
        newReceiptKey,
      );
      const alreadyOriginal = oldRows.every((row) =>
        sameJson(rollbackById.get(row.id), row))
        && newRows.every((row) => !rollbackById.has(row.id))
        && rollbackOldReceipt === oldReceiptRaw
        && rollbackNewReceipt === logicalReceiptRaw;
      if (!alreadyOriginal) {
        const stillMigrated = oldRows.every((row) => !rollbackById.has(row.id))
          && newRows.every((row) => sameJson(rollbackById.get(row.id), row))
          && rollbackOldReceipt === null
          && rollbackNewReceipt === newReceiptRaw;
        if (!stillMigrated) {
          throw new Error(
            "팔레트 레거시 이전 rollback이 새 사용자 변경과 충돌했습니다.",
            { cause: error },
          );
        }
        await repository.commitBatch({
          upsert: oldRows,
          deleteIds: newRows.map((row) => row.id),
          sidecars: [
            {
              namespace: STUDIO_CREATOR_PACK_SQLITE_NAMESPACE,
              key: oldReceiptKey,
              value: oldReceiptRaw,
            },
            {
              namespace: STUDIO_CREATOR_PACK_SQLITE_NAMESPACE,
              key: newReceiptKey,
              value: logicalReceiptRaw,
            },
          ],
          expected: {
            items: [
              ...oldRows.map((row) => ({ id: row.id, value: null })),
              ...newRows.map((row) => ({ id: row.id, value: row })),
            ],
            sidecars: [
              {
                namespace: STUDIO_CREATOR_PACK_SQLITE_NAMESPACE,
                key: oldReceiptKey,
                value: null,
              },
              {
                namespace: STUDIO_CREATOR_PACK_SQLITE_NAMESPACE,
                key: newReceiptKey,
                value: newReceiptRaw,
              },
            ],
          },
        });
      }
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        "팔레트 레거시 이전 rollback 실패",
        { cause: rollbackError },
      );
    }
    throw error;
  }
  publishLightweightReceipt(candidate.pack, options);
  return {
    status: "migrated",
    installedVersion: candidate.pack.metadata.version,
    installedFingerprint: candidate.pack.metadata.packageFingerprint,
  };
}

export async function migrateStudioCommunityPackLegacyIdentity(
  pack: StudioCreatorPackDefinition,
  options: StudioCommunityPackLegacyMigrationOptions,
): Promise<StudioCommunityPackLegacyMigrationResult> {
  if (
    !validCurrentSource(pack)
    || !(["brush", "filter", "palette"] as const).includes(
      pack.metadata.kind as MigratableKind,
    )
  ) return { status: "none" };
  options.assertCurrent();
  if (pack.metadata.kind === "brush") return migrateBrush(pack, options);
  if (pack.metadata.kind === "filter") return migrateFilter(pack, options);
  return migratePalette(pack, options);
}
