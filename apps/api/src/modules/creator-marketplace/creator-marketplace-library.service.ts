import { createHash } from "node:crypto";

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { z } from "zod";

import {
  CREATOR_MARKETPLACE_CLOUD_LIBRARY_CURSOR_MAX_CHARACTERS,
  CreatorMarketplaceAcquisitionTargetSchema,
  CreatorMarketplaceAcquireReceiptSchema,
  CreatorMarketplaceArchiveReceiptSchema,
  CreatorMarketplaceCloudLibraryItemSchema,
  CreatorMarketplaceCloudLibraryPageSchema,
  CreatorMarketplaceStudioInstallConfirmationReceiptSchema,
  creatorMarketplaceLogicalPackIdFromPackageKeyHex,
  creatorMarketplacePackageIdentityPreimage,
} from "../../../../web/src/shared/lib/creator-marketplace-cloud-library-contract";

import {
  CREATOR_MARKETPLACE_LIBRARY_REPOSITORY,
  CreatorMarketplaceLibraryAcquisitionRejectedError,
  CreatorMarketplaceLibraryInactiveUserError,
  CreatorMarketplaceLibraryIntegrityError,
  CreatorMarketplaceLibraryReleaseNotFoundError,
  CreatorMarketplaceLibraryUnsupportedKindError,
} from "./creator-marketplace-library.repository-contract";

import type {
  ConfirmCreatorMarketplaceStudioInstallDto,
  CreatorMarketplaceLibraryListQueryDto,
  SetCreatorMarketplaceLibraryArchiveDto,
} from "./creator-marketplace-library.dto";
import type {
  CreatorMarketplaceCloudLibraryRepository,
  CreatorMarketplaceLibraryCatalogHeadRow,
  CreatorMarketplaceLibraryStoredRow,
} from "./creator-marketplace-library.repository-contract";
import type {
  CreatorMarketplaceAcquireReceipt,
  CreatorMarketplaceAcquisitionTarget,
  CreatorMarketplaceArchiveReceipt,
  CreatorMarketplaceCloudLibraryItem,
  CreatorMarketplaceCloudLibraryPage,
  CreatorMarketplaceStudioInstallConfirmationReceipt,
} from "../../../../web/src/shared/lib/creator-marketplace-cloud-library-contract";

const CursorEnvelopeSchema = z
  .object({
    version: z.literal(1),
    queryHash: z.string().regex(/^[0-9a-f]{64}$/u),
    addedAt: z.iso.datetime({ offset: true }),
    id: z.string().uuid(),
  })
  .strict();

type LibraryOperation = "acquire" | "archive" | "confirm" | "list" | "resolve-target";

function sha256Hex(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function digestHex(digest: Uint8Array): string {
  if (digest.byteLength !== 32) {
    throw new CreatorMarketplaceLibraryIntegrityError("stored-state-invalid");
  }
  return Buffer.from(digest).toString("hex");
}

function logicalPackId(row: CreatorMarketplaceLibraryStoredRow): string {
  return creatorMarketplaceLogicalPackIdFromPackageKeyHex(
    digestHex(row.packageKeyHash),
  );
}

function membership(row: CreatorMarketplaceLibraryStoredRow): "active" | "archived" {
  return row.archivedAt === null ? "active" : "archived";
}

function cursorQueryHash(
  userId: string,
  query: Pick<CreatorMarketplaceLibraryListQueryDto, "view" | "logicalPackId">,
): string {
  return sha256Hex(JSON.stringify({
    version: 1,
    scope: "account",
    userHash: sha256Hex(userId),
    view: query.view,
    logicalPackId: query.logicalPackId ?? null,
  }));
}

function parseCursor(
  cursor: string | undefined,
  expectedQueryHash: string,
): { addedAt: Date; id: string } | null {
  if (!cursor) return null;
  try {
    const bytes = Buffer.from(cursor, "base64url");
    if (
      bytes.byteLength < 1
      || bytes.byteLength > CREATOR_MARKETPLACE_CLOUD_LIBRARY_CURSOR_MAX_CHARACTERS
    ) {
      throw new Error("cursor_size");
    }
    const envelope = CursorEnvelopeSchema.parse(
      JSON.parse(bytes.toString("utf8")),
    );
    if (envelope.queryHash !== expectedQueryHash) {
      throw new Error("cursor_query_mismatch");
    }
    const addedAt = new Date(envelope.addedAt);
    if (
      !Number.isFinite(addedAt.getTime())
      || addedAt.toISOString() !== envelope.addedAt
    ) {
      throw new Error("cursor_date");
    }
    return { addedAt, id: envelope.id };
  } catch {
    throw new BadRequestException({
      code: "creator_marketplace_library_cursor_invalid",
      message: "라이브러리 목록 커서가 현재 계정과 필터에 맞지 않습니다.",
    });
  }
}

function encodeCursor(
  row: CreatorMarketplaceLibraryStoredRow,
  queryHash: string,
): string {
  return Buffer.from(JSON.stringify({
    version: 1,
    queryHash,
    addedAt: row.addedAt.toISOString(),
    id: row.id,
  }), "utf8").toString("base64url");
}

function confirmationProjection(
  row: CreatorMarketplaceLibraryStoredRow,
): CreatorMarketplaceCloudLibraryItem["confirmation"] {
  if (row.lastConfirmedReleaseOrdinal === null) {
    if (
      row.lastConfirmedReleaseId !== null
      || row.lastConfirmedResourceVersion !== null
      || row.lastConfirmedManifestHash !== null
      || row.firstConfirmedAt !== null
      || row.lastConfirmedAt !== null
    ) {
      throw new CreatorMarketplaceLibraryIntegrityError("stored-state-invalid");
    }
    return { state: "none" };
  }
  if (
    row.lastConfirmedResourceVersion === null
    || row.lastConfirmedManifestHash === null
    || row.firstConfirmedAt === null
    || row.lastConfirmedAt === null
  ) {
    throw new CreatorMarketplaceLibraryIntegrityError("stored-state-invalid");
  }
  return {
    state: "confirmed",
    scope: "account-ever",
    releaseId: row.lastConfirmedReleaseId,
    resourceVersion: row.lastConfirmedResourceVersion,
    releaseOrdinal: row.lastConfirmedReleaseOrdinal,
    manifestHash: row.lastConfirmedManifestHash,
    firstConfirmedAt: row.firstConfirmedAt.toISOString(),
    lastConfirmedAt: row.lastConfirmedAt.toISOString(),
  };
}

function headMapKey(publisherId: string, packageId: string): string {
  return `${publisherId}\0${packageId}`;
}

function projectLibraryItem(
  row: CreatorMarketplaceLibraryStoredRow,
  head: CreatorMarketplaceLibraryCatalogHeadRow | undefined,
): CreatorMarketplaceCloudLibraryItem {
  const confirmation = confirmationProjection(row);
  let catalog: CreatorMarketplaceCloudLibraryItem["catalog"];
  if (row.publisherId === null) {
    catalog = { state: "unavailable", reason: "publisher-unavailable" };
  } else if (!head) {
    catalog = { state: "unavailable", reason: "removed" };
  } else if (head.publisherStatus !== "active") {
    catalog = { state: "unavailable", reason: "publisher-unavailable" };
  } else if (head.hidden) {
    catalog = { state: "unavailable", reason: "moderated" };
  } else if (head.delistedAt !== null) {
    catalog = { state: "unavailable", reason: "owner-delisted" };
  } else {
    catalog = {
      state: "available",
      head: {
        id: head.id,
        name: head.name,
        kind: head.kind,
        resourceVersion: head.resourceVersion,
        minimumStudioVersion: head.minimumStudioVersion,
        releaseOrdinal: head.releaseOrdinal,
        manifestHash: head.manifestHash,
      },
    };
  }

  let updateState: CreatorMarketplaceCloudLibraryItem["updateState"];
  if (catalog.state === "unavailable") {
    updateState = "catalog-unavailable";
  } else if (confirmation.state === "none") {
    updateState = "no-account-confirmation";
  } else if (confirmation.releaseOrdinal < catalog.head.releaseOrdinal) {
    updateState = "account-confirmed-update-available";
  } else {
    if (
      confirmation.releaseOrdinal > catalog.head.releaseOrdinal
      || confirmation.resourceVersion !== catalog.head.resourceVersion
      || confirmation.manifestHash !== catalog.head.manifestHash
      || (
        confirmation.releaseId !== null
        && confirmation.releaseId !== catalog.head.id
      )
      || catalog.head.kind !== row.kind
    ) {
      throw new CreatorMarketplaceLibraryIntegrityError("stored-state-invalid");
    }
    updateState = "account-confirmed-current-head";
  }

  return CreatorMarketplaceCloudLibraryItemSchema.parse({
    id: row.id,
    logicalPackId: logicalPackId(row),
    packageId: row.packageId,
    name: row.nameSnapshot,
    kind: row.kind,
    membership: membership(row),
    addedFrom: {
      releaseId: row.addedFromReleaseId,
      resourceVersion: row.addedFromResourceVersion,
      releaseOrdinal: row.addedFromReleaseOrdinal,
      manifestHash: row.addedFromManifestHash,
    },
    addedAt: row.addedAt.toISOString(),
    archivedAt: row.archivedAt?.toISOString() ?? null,
    confirmation,
    catalog,
    updateState,
  });
}

@Injectable()
export class CreatorMarketplaceLibraryService {
  private readonly logger = new Logger(CreatorMarketplaceLibraryService.name);

  constructor(
    @Inject(CREATOR_MARKETPLACE_LIBRARY_REPOSITORY)
    private readonly repository: CreatorMarketplaceCloudLibraryRepository,
  ) {}

  async resolveAcquisitionTarget(
    userId: string,
    releaseId: string,
  ): Promise<CreatorMarketplaceAcquisitionTarget> {
    try {
      const row = await this.repository.resolveAcquisitionTarget(userId, releaseId);
      if (row.currentHeadKind !== row.kind) {
        throw new CreatorMarketplaceLibraryIntegrityError("package-kind-continuity");
      }
      const logicalPackId = creatorMarketplaceLogicalPackIdFromPackageKeyHex(
        sha256Hex(creatorMarketplacePackageIdentityPreimage(
          row.publisherId,
          row.packageId,
        )),
      );
      const identity = {
        requestReleaseId: row.requestReleaseId,
        publisherId: row.publisherId,
        packageId: row.packageId,
        kind: row.kind,
        logicalPackId,
      } as const;
      if (row.packageState === "hidden") {
        return CreatorMarketplaceAcquisitionTargetSchema.parse({
          ...identity,
          state: "unavailable",
          reason: "moderated",
        });
      }
      if (row.publisherStatus !== "active") {
        return CreatorMarketplaceAcquisitionTargetSchema.parse({
          ...identity,
          state: "unavailable",
          reason: "publisher-unavailable",
        });
      }
      if (
        row.requestReleaseDelistedAt !== null
        || row.currentHeadDelistedAt !== null
      ) {
        return CreatorMarketplaceAcquisitionTargetSchema.parse({
          ...identity,
          state: "unavailable",
          reason: "owner-delisted",
        });
      }
      return CreatorMarketplaceAcquisitionTargetSchema.parse({
        ...identity,
        state: "available",
        currentHead: {
          id: row.currentHeadId,
          resourceVersion: row.currentHeadResourceVersion,
        },
      });
    } catch (error) {
      return this.handleError("resolve-target", error);
    }
  }

  async acquire(
    userId: string,
    releaseId: string,
  ): Promise<CreatorMarketplaceAcquireReceipt> {
    try {
      const result = await this.repository.acquire(userId, releaseId);
      return CreatorMarketplaceAcquireReceiptSchema.parse({
        operation: "acquire",
        changed: result.changed,
        membership: membership(result.row),
        libraryScope: "account",
        libraryItemId: result.row.id,
        logicalPackId: logicalPackId(result.row),
        updatedAt: result.row.updatedAt.toISOString(),
      });
    } catch (error) {
      return this.handleError("acquire", error);
    }
  }

  async confirmStudioInstall(
    userId: string,
    releaseId: string,
    input: ConfirmCreatorMarketplaceStudioInstallDto,
  ): Promise<CreatorMarketplaceStudioInstallConfirmationReceipt> {
    try {
      const result = await this.repository.confirmStudioInstall(
        userId,
        releaseId,
        input,
      );
      const row = result.row;
      if (
        row.lastConfirmedReleaseOrdinal === null
        || row.lastConfirmedResourceVersion === null
        || row.lastConfirmedManifestHash === null
        || row.lastConfirmedAt === null
      ) {
        throw new CreatorMarketplaceLibraryIntegrityError("stored-state-invalid");
      }
      return CreatorMarketplaceStudioInstallConfirmationReceiptSchema.parse({
        operation: "confirm-studio-install",
        changed: result.changed,
        membership: membership(row),
        libraryScope: "account",
        libraryItemId: row.id,
        logicalPackId: logicalPackId(row),
        updatedAt: row.updatedAt.toISOString(),
        acknowledgement: {
          releaseId,
          manifestHash: input.packageFingerprint,
        },
        confirmation: {
          scope: "account-ever",
          releaseId: row.lastConfirmedReleaseId,
          resourceVersion: row.lastConfirmedResourceVersion,
          releaseOrdinal: row.lastConfirmedReleaseOrdinal,
          manifestHash: row.lastConfirmedManifestHash,
          confirmedAt: row.lastConfirmedAt.toISOString(),
        },
      });
    } catch (error) {
      return this.handleError("confirm", error);
    }
  }

  async setArchived(
    userId: string,
    libraryItemId: string,
    input: SetCreatorMarketplaceLibraryArchiveDto,
  ): Promise<CreatorMarketplaceArchiveReceipt> {
    try {
      const result = await this.repository.setArchived(
        userId,
        libraryItemId,
        input.archived,
      );
      if (!result) {
        throw new NotFoundException({
          code: "creator_marketplace_library_item_not_found",
          message: "내 라이브러리 항목을 찾을 수 없습니다.",
        });
      }
      return CreatorMarketplaceArchiveReceiptSchema.parse({
        operation: "set-archive",
        changed: result.changed,
        membership: membership(result.row),
        libraryScope: "account",
        libraryItemId: result.row.id,
        logicalPackId: logicalPackId(result.row),
        updatedAt: result.row.updatedAt.toISOString(),
      });
    } catch (error) {
      return this.handleError("archive", error);
    }
  }

  async list(
    userId: string,
    query: CreatorMarketplaceLibraryListQueryDto,
  ): Promise<CreatorMarketplaceCloudLibraryPage> {
    try {
      const queryHash = cursorQueryHash(userId, query);
      const cursor = parseCursor(query.cursor, queryHash);
      const packageKeyHash = query.logicalPackId
        ? new Uint8Array(Buffer.from(query.logicalPackId.slice("community:".length), "hex"))
        : undefined;
      const result = await this.repository.list({
        userId,
        view: query.view,
        logicalPackId: query.logicalPackId,
        packageKeyHash,
        limit: query.limit,
        cursor,
      });
      const visibleRows = result.rows.slice(0, query.limit);
      const hasMore = result.rows.length > query.limit;
      const heads = new Map(result.catalogHeads.map((head) => [
        headMapKey(head.publisherId, head.packageId),
        head,
      ]));
      const items = visibleRows.map((row) => projectLibraryItem(
        row,
        row.publisherId === null
          ? undefined
          : heads.get(headMapKey(row.publisherId, row.packageId)),
      ));
      return CreatorMarketplaceCloudLibraryPageSchema.parse({
        items,
        limit: query.limit,
        hasMore,
        nextCursor: hasMore && visibleRows.length > 0
          ? encodeCursor(visibleRows[visibleRows.length - 1]!, queryHash)
          : null,
      });
    } catch (error) {
      return this.handleError("list", error);
    }
  }

  private handleError(operation: LibraryOperation, error: unknown): never {
    if (
      error instanceof BadRequestException
      || error instanceof ConflictException
      || error instanceof ForbiddenException
      || error instanceof NotFoundException
      || error instanceof ServiceUnavailableException
    ) {
      throw error;
    }
    if (error instanceof CreatorMarketplaceLibraryInactiveUserError) {
      throw new ForbiddenException({
        code: "creator_marketplace_library_active_account_required",
        message: "활성화된 계정으로만 마켓 라이브러리를 사용할 수 있습니다.",
      });
    }
    if (error instanceof CreatorMarketplaceLibraryAcquisitionRejectedError) {
      const messages = {
        "not-found": "획득할 마켓 릴리스를 찾을 수 없습니다.",
        moderated: "이 마켓 릴리스는 현재 획득할 수 없습니다.",
        "owner-delisted": "배급자가 내린 마켓 릴리스는 새로 획득할 수 없습니다.",
        "publisher-unavailable": "현재 활동 중인 배급자의 릴리스만 획득할 수 있습니다.",
        superseded: "이전 릴리스 대신 현재 패키지 버전을 라이브러리에 추가해 주세요.",
      } as const;
      throw new NotFoundException({
        code: `creator_marketplace_library_acquisition_${error.reason}`,
        message: messages[error.reason],
      });
    }
    if (error instanceof CreatorMarketplaceLibraryReleaseNotFoundError) {
      throw new NotFoundException({
        code: "creator_marketplace_library_confirmation_release_not_found",
        message: "설치 확인 대상 마켓 릴리스를 찾을 수 없습니다.",
      });
    }
    if (error instanceof CreatorMarketplaceLibraryUnsupportedKindError) {
      throw new BadRequestException({
        code: "creator_marketplace_library_studio_kind_unsupported",
        message: "Studio 설치 확인은 브러시, 필터, 팔레트에만 지원됩니다.",
      });
    }
    if (error instanceof CreatorMarketplaceLibraryIntegrityError) {
      if (error.reason === "logical-pack-id-mismatch") {
        throw new ConflictException({
          code: "creator_marketplace_library_logical_pack_id_mismatch",
          message: "설치된 Studio 팩 식별자가 마켓 패키지와 일치하지 않습니다.",
        });
      }
      if (error.reason === "manifest-hash-mismatch") {
        throw new ConflictException({
          code: "creator_marketplace_library_manifest_hash_mismatch",
          message: "설치된 패키지 지문이 마켓 릴리스와 일치하지 않습니다.",
        });
      }
      this.logger.error({
        operation,
        reason: error.reason,
      }, "Creator Marketplace library integrity failure");
      throw new ServiceUnavailableException({
        code: "creator_marketplace_library_integrity_failure",
        message: "마켓 라이브러리 무결성을 확인할 수 없어 요청을 완료하지 않았습니다.",
      });
    }
    this.logger.error({ operation, errorType: error instanceof Error ? error.name : typeof error },
      "Creator Marketplace library operation failed");
    throw new ServiceUnavailableException({
      code: "creator_marketplace_library_unavailable",
      message: "마켓 라이브러리를 일시적으로 사용할 수 없습니다.",
    });
  }
}
