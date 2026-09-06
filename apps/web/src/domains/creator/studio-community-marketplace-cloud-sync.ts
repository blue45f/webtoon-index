/** Exact account-library synchronization after a durable local Creator Market install. */

import type { StudioCreatorPackDefinition } from "./studio-creator-pack-catalog";
import type { CreatorMarketplaceResourceRecord } from "@/shared/lib/creator-marketplace-resource-contract";

import {
  CREATOR_MARKETPLACE_STUDIO_CONFIRMABLE_KINDS,
  type ConfirmCreatorMarketplaceStudioInstall,
  type CreatorMarketplaceStudioInstallConfirmationReceipt,
} from "@/shared/lib/creator-marketplace-cloud-library-contract";
import {
  confirmCreatorMarketplaceStudioInstall,
} from "@/src/infrastructure/creator-marketplace-client";

export interface StudioCommunityMarketplaceCloudSyncDependencies {
  readonly confirm: (
    releaseId: string,
    input: ConfirmCreatorMarketplaceStudioInstall,
    signal?: AbortSignal,
  ) => Promise<CreatorMarketplaceStudioInstallConfirmationReceipt>;
}

export type StudioCommunityMarketplaceCloudSyncResult = Readonly<
  | {
      status: "synchronized";
      changed: boolean;
      message: string;
    }
  | {
      status: "not-confirmable";
      changed: false;
      message: string;
    }
>;

const DEFAULT_DEPENDENCIES: StudioCommunityMarketplaceCloudSyncDependencies = {
  confirm: confirmCreatorMarketplaceStudioInstall,
};

function isConfirmableKind(
  kind: CreatorMarketplaceResourceRecord["kind"],
): kind is "brush" | "filter" | "palette" {
  return CREATOR_MARKETPLACE_STUDIO_CONFIRMABLE_KINDS.some(
    (candidate) => candidate === kind,
  );
}

function assertExactLocalEvidence(
  record: CreatorMarketplaceResourceRecord,
  pack: StudioCreatorPackDefinition,
): void {
  const source = pack.marketplaceSource;
  if (
    pack.metadata.kind !== record.kind
    || pack.metadata.packageFingerprint !== record.manifestHash
    || pack.metadata.creator.id !== record.publisher.id
    || !source
    || source.schema !== "creator-marketplace-resource-v1"
    || source.releaseId !== record.id
    || source.publisherId !== record.publisher.id
    || source.packageId !== record.packageId
  ) {
    throw new Error("공개 릴리스와 로컬 설치 패키지의 정확한 증거가 일치하지 않습니다.");
  }
}

export async function synchronizeStudioCommunityMarketplaceInstalledPack(
  record: CreatorMarketplaceResourceRecord,
  pack: StudioCreatorPackDefinition,
  options: Readonly<{
    signal?: AbortSignal;
    dependencies?: StudioCommunityMarketplaceCloudSyncDependencies;
  }> = {},
): Promise<StudioCommunityMarketplaceCloudSyncResult> {
  if (!isConfirmableKind(record.kind)) {
    return {
      status: "not-confirmable",
      changed: false,
      message: "이 리소스 종류는 계정 Studio 설치 확인 대상이 아닙니다.",
    };
  }
  assertExactLocalEvidence(record, pack);
  const dependencies = options.dependencies ?? DEFAULT_DEPENDENCIES;
  const confirmationInput = {
    schemaVersion: 1,
    logicalPackId: pack.metadata.id,
    packageFingerprint: pack.metadata.packageFingerprint,
  } as const;
  const confirmation = options.signal
    ? await dependencies.confirm(record.id, confirmationInput, options.signal)
    : await dependencies.confirm(record.id, confirmationInput);
  if (
    confirmation.logicalPackId !== pack.metadata.id
    || confirmation.acknowledgement.releaseId !== record.id
    || confirmation.acknowledgement.manifestHash !== pack.metadata.packageFingerprint
  ) {
    throw new Error("서버 설치 확인 증거가 로컬 설치와 일치하지 않습니다.");
  }
  return {
    status: "synchronized",
    changed: confirmation.changed,
    message: confirmation.confirmation.releaseId !== record.id
      ? "정확한 로컬 설치를 확인했고, 계정 설치 이력은 더 최신 버전을 유지합니다."
      : confirmation.changed
        ? "이 계정에 실제 Studio 설치를 확인했습니다."
        : "이 계정의 Studio 설치 확인은 이미 최신입니다.",
  };
}
