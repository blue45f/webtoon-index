import type { StudioCreatorPackDefinition } from "./studio-creator-pack-catalog";
import type {
  StudioMarketplaceDeepLinkDependencies,
  StudioMarketplaceDeepLinkResult,
  StudioMarketplaceInstallGuard,
} from "./studio-marketplace-deep-link";
import type { CreatorMarketplaceResourceRecord } from "@/shared/lib/creator-marketplace-resource-contract";

const SUCCESSFUL_INSTALL_STATUSES = new Set([
  "installed",
  "already-installed",
  "bundled",
]);

function isAccountConfirmableKind(
  kind: CreatorMarketplaceResourceRecord["kind"],
): boolean {
  // The dynamically loaded synchronizer validates the same closed set again before any request.
  return kind === "brush" || kind === "filter" || kind === "palette";
}

function caughtMessage(caught: unknown): string {
  if (
    caught instanceof Error
    && (caught.name === "NotFoundError" || caught.message === "not-found")
  ) {
    return "마켓 리소스를 찾지 못했어요. 삭제되었거나 공개가 종료되었을 수 있습니다.";
  }
  if (caught instanceof Error && caught.message.trim()) return caught.message;
  return "네트워크와 기기 저장소 상태를 확인한 뒤 마켓에서 다시 시도해 주세요.";
}

function staleResult(resourceId: string): StudioMarketplaceDeepLinkResult {
  return {
    status: "stale",
    message: "종료된 Studio 작업의 마켓 설치 결과를 무시했습니다.",
    resourceId,
  };
}

class StudioMarketplaceStaleInstallError extends Error {
  constructor() {
    super("Studio marketplace install operation is stale");
    this.name = "StudioMarketplaceStaleInstallError";
  }
}

/**
 * 실제 마켓 레코드 투영·설치는 딥링크가 존재할 때만 필요하다. Studio 기본 엔트리는
 * query 소비와 수명주기 guard만 보유하고, 이 실행기는 dependency 로딩과 병렬로 가져온다.
 */
export async function applyStudioMarketplaceDeepLinkOperation<TPack, TAsset>(
  resourceId: string,
  dependencies: StudioMarketplaceDeepLinkDependencies<TPack, TAsset>,
  options: Readonly<{ isCurrent?: () => boolean }> = {},
): Promise<StudioMarketplaceDeepLinkResult> {
  const normalizedResourceId = resourceId.trim();
  const isCurrent = options.isCurrent ?? (() => true);
  if (!normalizedResourceId) {
    return {
      status: "error",
      message: "설치할 마켓 리소스 ID가 비어 있어요. 마켓에서 다시 선택해 주세요.",
      resourceId: normalizedResourceId,
    };
  }

  if (!isCurrent()) return staleResult(normalizedResourceId);

  try {
    const record = await dependencies.loadResource(normalizedResourceId);
    if (!isCurrent()) return staleResult(normalizedResourceId);
    if (!record) {
      return {
        status: "error",
        message: "마켓 리소스를 찾지 못했어요. 삭제되었거나 공개가 종료되었을 수 있습니다.",
        resourceId: normalizedResourceId,
      };
    }

    if (record.kind === "asset") {
      const projection = dependencies.projectAssets(record);
      const asset = projection.assets[0];
      if (!asset) {
        return {
          status: "error",
          message: `“${record.name}”을(를) 캔버스에 삽입할 수 없어요. ${
            projection.reason ?? "현재 Studio에서 안전하게 실행할 수 있는 에셋이 없습니다."
          }`,
          resourceId: normalizedResourceId,
        };
      }
      if (!isCurrent()) return staleResult(normalizedResourceId);
      if (!dependencies.insertAsset(asset)) {
        return {
          status: "error",
          message: `“${record.name}”을(를) 삽입하지 못했어요. 캔버스 잠금과 저장 상태를 확인해 주세요.`,
          resourceId: normalizedResourceId,
        };
      }
      return {
        status: "success",
        message: `“${record.name}” 에셋을 현재 캔버스에 삽입했어요.`,
        resourceId: normalizedResourceId,
      };
    }

    const projection = dependencies.projectPack(record);
    if (projection.status !== "installable") {
      return {
        status: "error",
        message: `“${record.name}”을(를) 설치할 수 없어요. ${projection.reason}`,
        resourceId: normalizedResourceId,
      };
    }

    const installGuard: StudioMarketplaceInstallGuard = {
      isCurrent,
      assertCurrent: () => {
        if (!isCurrent()) throw new StudioMarketplaceStaleInstallError();
      },
    };
    installGuard.assertCurrent();
    const installResult = await dependencies.installPack(projection.pack, installGuard);
    if (!isCurrent()) return staleResult(normalizedResourceId);
    if (!SUCCESSFUL_INSTALL_STATUSES.has(installResult.status)) {
      return {
        status: "error",
        message: `“${record.name}” 설치 실패 · ${installResult.message}`,
        resourceId: normalizedResourceId,
      };
    }

    if (installResult.status === "bundled") {
      const catalogResult = await dependencies.openBundledPackCatalog(
        projection.pack,
        record,
      );
      if (!isCurrent()) return staleResult(normalizedResourceId);
      if (catalogResult.status !== "opened") {
        return {
          status: "error",
          message: `“${record.name}”의 내장 카탈로그를 열 수 없어요. ${catalogResult.message}`,
          resourceId: normalizedResourceId,
        };
      }
      return {
        status: "success",
        message: `“${record.name}” · ${catalogResult.message}`,
        resourceId: normalizedResourceId,
      };
    }

    if (
      dependencies.synchronizeInstalledPack
      && isAccountConfirmableKind(record.kind)
    ) {
      try {
        const accountSync = await dependencies.synchronizeInstalledPack(
          record,
          projection.pack,
          installGuard,
        );
        if (!isCurrent()) return staleResult(normalizedResourceId);
        return {
          status: "success",
          message: `“${record.name}” · ${installResult.message} ${accountSync.message} 자산 메뉴의 커뮤니티 목록에서 상태를 확인할 수 있어요.`,
          resourceId: normalizedResourceId,
          accountSync,
        };
      } catch (caught) {
        if (caught instanceof StudioMarketplaceStaleInstallError || !isCurrent()) {
          return staleResult(normalizedResourceId);
        }
        const syncIssue = caughtMessage(caught);
        return {
          status: "success",
          message: `“${record.name}” · ${installResult.message} 로컬 설치는 유지되지만 계정 설치 확인은 동기화하지 못했어요. 아래 재시도로 계정 기록만 다시 맞출 수 있습니다.`,
          resourceId: normalizedResourceId,
          accountSync: {
            status: "retry-required",
            message: syncIssue,
          },
        };
      }
    }

    return {
      status: "success",
      message: `“${record.name}” · ${installResult.message} 자산 메뉴의 커뮤니티 목록에서 상태를 확인할 수 있어요.`,
      resourceId: normalizedResourceId,
    };
  } catch (caught) {
    if (caught instanceof StudioMarketplaceStaleInstallError || !isCurrent()) {
      return staleResult(normalizedResourceId);
    }
    return {
      status: "error",
      message: `마켓 리소스를 Studio로 가져오지 못했어요. ${caughtMessage(caught)}`,
      resourceId: normalizedResourceId,
    };
  }
}

/**
 * 로컬 패키지를 다시 확인한 뒤 계정 설치 영수증만 복구한다. 이 경로는 설치 후 동기화가
 * 실패해 사용자가 재시도 버튼을 누를 때만 필요하므로 Studio 기본 엔트리에 포함하지 않는다.
 */
export async function retryStudioMarketplaceCloudSyncOperation(
  record: CreatorMarketplaceResourceRecord,
  pack: StudioCreatorPackDefinition,
  signal: AbortSignal,
): Promise<Readonly<{ message: string }>> {
  const [
    { inspectStudioCreatorPackInstallStateProduct },
    { browserStudioCreatorPackStorage },
    { synchronizeStudioCommunityMarketplaceInstalledPack },
  ] = await Promise.all([
    import("./studio-creator-pack-product-runtime"),
    import("./studio-creator-pack-runtime"),
    import("./studio-community-marketplace-cloud-sync"),
  ]);
  signal.throwIfAborted();
  const localState = await inspectStudioCreatorPackInstallStateProduct(
    pack,
    {
      storage: browserStudioCreatorPackStorage(),
      signal,
      isInstallCurrent: () => !signal.aborted,
    },
  );
  signal.throwIfAborted();
  if (localState !== "installed") {
    throw new Error("현재 기기에서 이 정확한 패키지 설치를 더 이상 확인할 수 없습니다.");
  }
  return synchronizeStudioCommunityMarketplaceInstalledPack(
    record,
    pack,
    { signal },
  );
}
