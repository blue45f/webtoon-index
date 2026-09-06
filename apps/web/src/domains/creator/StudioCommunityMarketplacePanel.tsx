import {
  BadgeCheck,
  Box,
  Brush,
  ChevronDown,
  Cloud,
  CloudOff,
  Cuboid,
  Filter,
  LayoutTemplate,
  LoaderCircle,
  PackageCheck,
  Palette,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  UserRound,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
} from "react";

import {
  openProductBrushLibraryRepository,
  readAllBrushesFromRepository,
} from "./brush/studio-brush-library-sqlite-repository";
import {
  acquireProductFilterLibraryRepository,
  readAllFilterPresetsFromRepository,
  subscribeStudioFilterLibraryChanges,
  type StudioFilterLibraryPreset,
} from "./filter/studio-filter-library-sqlite-repository";
import {
  createStudioCommunityPublishManifest,
  listStudioCommunityShareCandidates,
  projectCreatorMarketplaceRecordToAssets,
  projectCreatorMarketplaceRecordToStudioPack,
  studioCommunityShareCandidateIdentity,
  studioCommunityShareCandidateLegacyIdentity,
  type StudioCommunityShareCandidateIdentity,
  type StudioCommunityShareCandidate,
  type StudioCommunityShareCandidateKind,
} from "./studio-community-marketplace";
import {
  synchronizeStudioCommunityMarketplaceInstalledPack,
} from "./studio-community-marketplace-cloud-sync";
import {
  inspectStudioCreatorPackInstallStateProduct,
  installStudioCreatorPackProduct,
  uninstallStudioCreatorPackProduct,
} from "./studio-creator-pack-product-runtime";
import {
  browserStudioCreatorPackStorage,
  inspectStudioCreatorPackInstallState,
  type StudioCreatorPackInstallState,
} from "./studio-creator-pack-runtime";
import {
  STUDIO_MARKETPLACE_REDISTRIBUTION_NOTICE,
} from "./studio-marketplace-packages";
import {
  getProductStudioMarketplaceRuntimeCompatibility,
  type StudioMarketplaceRuntimeCompatibilityContext,
} from "./studio-marketplace-runtime-compatibility";
import {
  createStudioOriginalFreeAssetRecord,
} from "./studio-original-free-asset-packs";
import {
  getProductStudioPaletteSqliteRepository,
} from "./studio-palette-sqlite-repository";
import {
  StudioOwnedLifecycleBadge,
  StudioOwnedPackageHistory,
  StudioOwnedReleaseLifecycleActions,
} from "./StudioCommunityMarketplaceLifecycle";

import type { StudioSavedBrush } from "./brush/studio-brush-library";
import type { StudioAsset } from "./studio-asset-library";
import type { StudioCommunityMarketplaceView } from "./studio-community-marketplace-view";
import type { StudioNamedPalette } from "./studio-palette-library";

import {
  CREATOR_MARKETPLACE_STUDIO_CONFIRMABLE_KINDS,
  type CreatorMarketplaceCloudLibraryItem,
  type CreatorMarketplaceCloudLibraryMembership,
  type CreatorMarketplaceCloudLibraryView,
} from "@/shared/lib/creator-marketplace-cloud-library-contract";
import { creatorMarketplaceStudioPackId } from "@/shared/lib/creator-marketplace-package-identity";
import {
  CREATOR_MARKETPLACE_RESOURCE_RELEASE_NOTES_MAX_CHARACTERS,
  CREATOR_MARKETPLACE_RESOURCE_QUERY_SEARCH_MAX_CHARACTERS,
  type CreatorMarketplaceOwnedRelease,
  type CreatorMarketplaceResourceRelistReceipt,
  type CreatorMarketplaceResourceKind,
  type CreatorMarketplaceResourceLicense,
  type CreatorMarketplaceResourceRecord,
} from "@/shared/lib/creator-marketplace-resource-contract";
import {
  CREATOR_MARKETPLACE_SEMVER_MAX_CHARACTERS,
  isCreatorMarketplaceSemver,
  suggestNextCreatorMarketplaceSemver,
} from "@/shared/lib/creator-marketplace-semver";
import { filterStarterMarketplaceResources } from "@/shared/lib/creator-marketplace-starter-catalog";
import { cx } from "@/shared/lib/cx";
import { useT } from "@/shared/lib/i18n";
import { useSession } from "@/src/compat/auth-session-store";
import { CreatorMarketplaceReportAction } from "@/src/domains/market/components/CreatorMarketplaceReportAction";
import {
  deleteCreatorMarketplaceResource,
  getCreatorMarketplaceResource,
  listCreatorMarketplaceCloudLibrary,
  listCreatorMarketplaceOwnedHeads,
  listCreatorMarketplaceOwnedHistory,
  listCreatorMarketplaceResources,
  publishCreatorMarketplaceResource,
  setCreatorMarketplaceCloudLibraryArchived,
} from "@/src/infrastructure/creator-marketplace-client";
import { NotFoundError } from "@/src/infrastructure/use-api-resource";


const FOCUS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-panel";
const CONTROL =
  `min-h-11 rounded-lg border border-line bg-card px-2.5 text-[0.65rem] font-semibold text-fg-2 transition-colors hover:border-line-strong hover:bg-raised ${FOCUS}`;
const PRIMARY =
  `min-h-11 rounded-lg bg-accent px-3 text-[0.65rem] font-bold text-on-accent transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-45 ${FOCUS}`;
const MARKETPLACE_VIEW_ORDER = [
  "community",
  "library",
  "mine",
  "share",
] as const satisfies readonly StudioCommunityMarketplaceView[];

function restoreButtonFocusIfUnclaimed(button: HTMLButtonElement | null): void {
  if (!button?.isConnected || button.disabled) return;
  const active = document.activeElement;
  if (active === button) return;
  if (
    active === null
    || active === document.body
    || active === document.documentElement
  ) {
    button.focus();
  }
}

function hasExactCreatorMarketplacePublicEvidence(
  expected: CreatorMarketplaceResourceRecord,
  current: CreatorMarketplaceResourceRecord,
): boolean {
  return current.id === expected.id
    && current.schemaVersion === expected.schemaVersion
    && current.publisher.id === expected.publisher.id
    && current.packageId === expected.packageId
    && current.kind === expected.kind
    && current.resourceVersion === expected.resourceVersion
    && current.minimumStudioVersion === expected.minimumStudioVersion
    && current.manifestHash === expected.manifestHash
    && current.manifestByteSize === expected.manifestByteSize
    && creatorMarketplaceStudioPackId(current) === creatorMarketplaceStudioPackId(expected);
}

function publicRevalidationError(
  record: CreatorMarketplaceResourceRecord,
  actionLabel: string,
  caught: unknown,
): Error {
  if (caught instanceof NotFoundError) {
    return new Error(
      `${record.name}은(는) 더 이상 공개 상태를 확인할 수 없어 ${actionLabel}을(를) 중단했습니다. `
      + "관리자 숨김, 배급자 목록 내림 또는 배급자 계정 상태 변경일 수 있습니다. 공개 목록을 새로고침한 뒤 다시 시도해 주세요.",
    );
  }
  return new Error(
    `${record.name}의 현재 공개 상태를 다시 확인하지 못해 ${actionLabel}을(를) 안전하게 중단했습니다. `
    + `${errorText(caught, "네트워크 상태를 확인해 주세요.")} 다시 시도해 주세요.`,
  );
}

type StudioCommunityT = (key: string, fallback?: string) => string;
function localizeText(t: StudioCommunityT, fallback: string, key: string): string {
  return t(key) === key ? fallback : t(key);
}

function interpolateText(message: string, values?: Record<string, string | number>): string {
  if (!values) return message;
  return Object.entries(values).reduce(
    (memo, [key, value]) => memo.replaceAll(`{${key}}`, String(value)),
    message,
  );
}

function tText(
  t: StudioCommunityT,
  fallback: string,
  key: string,
  values?: Record<string, string | number>,
): string {
  return interpolateText(localizeText(t, fallback, key), values);
}

const KIND_OPTIONS: readonly {
  id: CreatorMarketplaceResourceKind | "all";
  labelKey: string;
  labelFallback: string;
  Icon: typeof Brush;
}[] = [
  {
    id: "all",
    labelKey: "studio.community.kind.all",
    labelFallback: "전체",
    Icon: PackageCheck,
  },
  {
    id: "asset",
    labelKey: "studio.community.kind.asset",
    labelFallback: "에셋",
    Icon: BadgeCheck,
  },
  {
    id: "brush",
    labelKey: "studio.community.kind.brush",
    labelFallback: "브러시",
    Icon: Brush,
  },
  {
    id: "filter",
    labelKey: "studio.community.kind.filter",
    labelFallback: "필터",
    Icon: Filter,
  },
  {
    id: "palette",
    labelKey: "studio.community.kind.palette",
    labelFallback: "팔레트",
    Icon: Palette,
  },
  {
    id: "template",
    labelKey: "studio.community.kind.template",
    labelFallback: "템플릿",
    Icon: LayoutTemplate,
  },
  {
    id: "3d-preset",
    labelKey: "studio.community.kind.threeDPreset",
    labelFallback: "3D 프리셋",
    Icon: Box,
  },
  {
    id: "3d-asset",
    labelKey: "studio.community.kind.threeDAsset",
    labelFallback: "3D 에셋",
    Icon: Cuboid,
  },
];

const KIND_LABEL: Readonly<Record<CreatorMarketplaceResourceKind, string>> =
  Object.freeze({
    asset: "studio.community.kind.asset",
    brush: "studio.community.kind.brush",
    filter: "studio.community.kind.filter",
    palette: "studio.community.kind.palette",
    template: "studio.community.kind.template",
    "3d-preset": "studio.community.kind.threeDPreset",
    "3d-asset": "studio.community.kind.threeDAsset",
  });
const KIND_LABEL_FALLBACK: Readonly<Record<CreatorMarketplaceResourceKind, string>> =
  Object.freeze({
    asset: "에셋",
    brush: "브러시",
    filter: "필터",
    palette: "팔레트",
    template: "템플릿",
    "3d-preset": "3D",
    "3d-asset": "3D 에셋",
  });

const LICENSE_LABEL: Readonly<Record<CreatorMarketplaceResourceLicense, string>> =
  Object.freeze({
    "toonspectrum-standard": "studio.community.license.toonspectrumStandard",
    "cc0-1.0": "studio.community.license.cc0",
    "cc-by-4.0": "studio.community.license.ccBy4",
    "cc-by-nc-4.0": "studio.community.license.ccByNc4",
  });
const LICENSE_LABEL_FALLBACK: Readonly<Record<CreatorMarketplaceResourceLicense, string>> =
  Object.freeze({
    "toonspectrum-standard": "표준 · 파일 재배포 금지",
    "cc0-1.0": "CC0 · 제한 없이 허용",
    "cc-by-4.0": "CC BY · 출처 표시",
    "cc-by-nc-4.0": "CC BY-NC · 비상업",
  });

const LICENSE_OPTIONS: readonly {
  value: CreatorMarketplaceResourceLicense;
  labelKey: string;
  labelFallback: string;
}[] = [
  {
    value: "toonspectrum-standard",
    labelKey: "studio.community.license.toonspectrumStandard",
    labelFallback: "표준 · 파일 재배포 금지",
  },
  {
    value: "cc0-1.0",
    labelKey: "studio.community.license.cc0",
    labelFallback: "CC0 · 제한 없이 허용",
  },
  {
    value: "cc-by-4.0",
    labelKey: "studio.community.license.ccBy4",
    labelFallback: "CC BY · 출처 표시",
  },
  {
    value: "cc-by-nc-4.0",
    labelKey: "studio.community.license.ccByNc4",
    labelFallback: "CC BY-NC · 비상업",
  },
];

const SHARE_KIND_LABEL: Readonly<Record<StudioCommunityShareCandidateKind, string>> =
  Object.freeze({
    brush: "studio.community.kind.brush",
    filter: "studio.community.kind.filter",
    palette: "studio.community.kind.palette",
  });
const SHARE_KIND_LABEL_FALLBACK: Readonly<Record<StudioCommunityShareCandidateKind, string>> =
  Object.freeze({
    brush: "브러시",
    filter: "필터",
    palette: "팔레트",
  });

function errorText(caught: unknown, fallback: string): string {
  return caught instanceof Error && caught.message
    ? caught.message
    : fallback;
}

interface StudioCloudLibraryEntry {
  readonly item: CreatorMarketplaceCloudLibraryItem;
  readonly record: CreatorMarketplaceResourceRecord | null;
  readonly issue: string | null;
}

interface LibraryFocusRestoreRequest {
  readonly itemId: string;
  readonly origin: HTMLButtonElement;
  readonly target: "action" | CreatorMarketplaceCloudLibraryMembership;
}

async function loadStudioCloudLibraryEntries(
  input: {
    readonly view: CreatorMarketplaceCloudLibraryView;
    readonly limit: number;
    readonly cursor?: string;
  },
  signal: AbortSignal,
): Promise<{
  readonly entries: readonly StudioCloudLibraryEntry[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}> {
  const page = await listCreatorMarketplaceCloudLibrary(input, signal);
  const entries = await Promise.all(page.items.map(async (item) => {
    if (item.catalog.state === "unavailable") {
      return { item, record: null, issue: null };
    }
    try {
      const record = await getCreatorMarketplaceResource(item.catalog.head.id, signal);
      if (
        record.id !== item.catalog.head.id
        || record.packageId !== item.packageId
        || record.kind !== item.kind
        || record.resourceVersion !== item.catalog.head.resourceVersion
        || record.manifestHash !== item.catalog.head.manifestHash
        || creatorMarketplaceStudioPackId(record) !== item.logicalPackId
      ) {
        return {
          item,
          record: null,
          issue: "계정 라이브러리와 공개 카탈로그의 패키지 증거가 일치하지 않습니다.",
        };
      }
      return { item, record, issue: null };
    } catch (caught: unknown) {
      if (signal.aborted) throw caught;
      return {
        item,
        record: null,
        issue: errorText(caught, "현재 공개 릴리스를 불러오지 못했습니다."),
      };
    }
  }));
  return {
    entries,
    nextCursor: page.nextCursor,
    hasMore: page.hasMore,
  };
}

function StudioCloudLibraryUnavailableCard({
  entry,
  membershipPending,
  membershipButtonRef,
  onMembershipChange,
}: {
  readonly entry: StudioCloudLibraryEntry;
  readonly membershipPending: boolean;
  readonly membershipButtonRef?: (button: HTMLButtonElement | null) => void;
  readonly onMembershipChange: (
    item: CreatorMarketplaceCloudLibraryItem,
    trigger: HTMLButtonElement,
  ) => void;
}) {
  const { item, issue } = entry;
  const reason = item.catalog.state === "unavailable"
    ? ({
        moderated: "관리자 검수로 숨겨진 패키지입니다.",
        "owner-delisted": "배급자가 현재 공개 목록에서 내린 패키지입니다.",
        "publisher-unavailable": "배급자 계정을 현재 사용할 수 없습니다.",
        removed: "현재 공개 카탈로그에서 제거된 패키지입니다.",
      } as const)[item.catalog.reason]
    : issue ?? "현재 공개 릴리스를 사용할 수 없습니다.";
  return (
    <article className="rounded-lg border border-line bg-card p-2.5">
      <div className="flex items-start gap-2">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-line bg-panel text-fg-3">
          <Cloud size={16} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="break-words text-[0.7rem] font-black text-fg">{item.name}</h3>
          <p className="mt-0.5 break-all text-[0.55rem] text-fg-3">{item.packageId}</p>
        </div>
        <span className="rounded-full border border-line px-1.5 py-0.5 text-[0.52rem] font-semibold text-fg-3">
          {item.membership === "active" ? "계정 활성" : "계정 보관"}
        </span>
      </div>
      <p
        role={issue ? "alert" : "status"}
        className="mt-2 rounded-md border border-warn/25 bg-warn/10 px-2 py-1.5 text-[0.55rem] leading-relaxed text-warn"
      >
        {reason} 기존 계정 취득·설치 확인 이력은 보존되지만 이 카드에서는 설치할 수 없습니다.
      </p>
      <button
        ref={membershipButtonRef}
        type="button"
        disabled={membershipPending}
        onClick={(event) => onMembershipChange(item, event.currentTarget)}
        className={cx("mt-2 w-full", CONTROL)}
      >
        {membershipPending ? (
          <LoaderCircle size={13} className="mr-1 inline animate-spin" aria-hidden />
        ) : null}
        {membershipPending
          ? "계정 보관 상태 변경 중…"
          : item.membership === "active"
            ? "계정 라이브러리에 보관"
            : "계정 라이브러리로 복원"}
      </button>
    </article>
  );
}

function CommunityRecordCard({
  record,
  cloudLibraryItem,
  compatibilityContext,
  onUseAsset,
  ownedRelease,
  onDelist,
  onRelisted,
  onStatus,
  onInstallStateChanged,
  onCloudChanged,
  cloudMembershipPending = false,
  cloudMembershipButtonRef,
  onCloudMembershipChange,
  refreshToken,
}: {
  readonly record: CreatorMarketplaceResourceRecord;
  readonly cloudLibraryItem?: CreatorMarketplaceCloudLibraryItem;
  readonly compatibilityContext: StudioMarketplaceRuntimeCompatibilityContext | null;
  readonly onUseAsset?: (asset: StudioAsset) => boolean;
  readonly ownedRelease?: CreatorMarketplaceOwnedRelease;
  readonly onDelist?: (release: CreatorMarketplaceOwnedRelease) => Promise<boolean>;
  readonly onRelisted?: (
    release: CreatorMarketplaceOwnedRelease,
    receipt: CreatorMarketplaceResourceRelistReceipt,
  ) => void;
  readonly onStatus: (message: string, error: boolean) => void;
  readonly onInstallStateChanged: () => void;
  readonly onCloudChanged?: () => void;
  readonly cloudMembershipPending?: boolean;
  readonly cloudMembershipButtonRef?: (button: HTMLButtonElement | null) => void;
  readonly onCloudMembershipChange?: (
    item: CreatorMarketplaceCloudLibraryItem,
    trigger: HTMLButtonElement,
  ) => void;
  readonly refreshToken: number;
}) {
  const compatibilityPending = compatibilityContext === null;
  const pendingCompatibilityReason = "현재 Studio와 기기 엔진의 호환성을 확인하고 있어요.";
  const projection = compatibilityContext
    ? projectCreatorMarketplaceRecordToStudioPack(record, compatibilityContext)
    : {
        status: "unsupported" as const,
        pack: null,
        reason: pendingCompatibilityReason,
      };
  const assetProjection = compatibilityContext
    ? projectCreatorMarketplaceRecordToAssets(record, compatibilityContext)
    : {
        assets: [],
        unsupportedCount: record.entries.length,
        reason: pendingCompatibilityReason,
      };
  const [selectedAssetId, setSelectedAssetId] = useState(
    assetProjection.assets[0]?.id ?? "",
  );
  const storage = browserStudioCreatorPackStorage();
  const usesSqlCatalog = projection.status === "installable"
    && (
      projection.pack.metadata.kind === "filter"
      || projection.pack.metadata.kind === "brush"
      || projection.pack.metadata.kind === "palette"
    );
  const [installState, setInstallState] = useState<StudioCreatorPackInstallState | null>(() =>
    projection.status !== "installable"
      ? null
      : usesSqlCatalog
        ? "available"
        : inspectStudioCreatorPackInstallState(projection.pack, storage),
  );
  const [installPending, setInstallPending] = useState(
    compatibilityPending || usesSqlCatalog,
  );
  const [publicActionPending, setPublicActionPending] = useState<
    "asset" | "install" | null
  >(null);
  const [cloudSyncPending, setCloudSyncPending] = useState(false);
  const [cloudSyncIssue, setCloudSyncIssue] = useState<string | null>(null);
  const cloudOperationGenerationRef = useRef(0);
  const publicActionGenerationRef = useRef(0);
  const publicActionControllerRef = useRef<AbortController | null>(null);
  const assetActionButtonRef = useRef<HTMLButtonElement | null>(null);
  const assetFocusRestoreRef = useRef(false);
  const installActionButtonRef = useRef<HTMLButtonElement | null>(null);
  const installFocusRestoreRef = useRef(false);
  const cloudSyncButtonRef = useRef<HTMLButtonElement | null>(null);
  const cloudSyncFocusRestoreRef = useRef(false);
  const cloudSyncFocusOriginRef = useRef<HTMLButtonElement | null>(null);
  const cloudSyncSucceededRef = useRef(false);
  const { ready: sessionReady, status: sessionStatus } = useSession();
  const cloudAuthenticated = sessionReady && sessionStatus === "authenticated";
  useEffect(() => {
    const effectProjection = compatibilityContext
      ? projectCreatorMarketplaceRecordToStudioPack(record, compatibilityContext)
      : null;
    if (!effectProjection || effectProjection.status !== "installable") {
      setInstallState(null);
      setInstallPending(compatibilityContext === null);
      return;
    }
    let active = true;
    setInstallPending(true);
    void inspectStudioCreatorPackInstallStateProduct(effectProjection.pack, { storage })
      .then((state) => {
        if (active) setInstallState(state);
      })
      .catch((error: unknown) => {
        if (active) {
          onStatus(
            `${record.name} · ${
              usesSqlCatalog ? "로컬 SQL 카탈로그" : "기기 저장소"
            } 상태를 읽지 못했습니다: ${
              error instanceof Error ? error.message : String(error)
            }`,
            true,
          );
        }
      })
      .finally(() => {
        if (active) setInstallPending(false);
      });
    return () => {
      active = false;
    };
  }, [compatibilityContext, onStatus, record, refreshToken, storage, usesSqlCatalog]);
  const installed = installState === "installed";
  const bundled = installState === "bundled";
  const installBlocked = installState === "invalid"
    || installState === "conflict"
    || installState === "downgrade-blocked";
  const selectedAsset = assetProjection.assets.find(
    (asset) => asset.id === selectedAssetId,
  ) ?? assetProjection.assets[0] ?? null;
  const t = useT();
  const confirmableInStudio = CREATOR_MARKETPLACE_STUDIO_CONFIRMABLE_KINDS.some(
    (candidate) => candidate === record.kind,
  );
  const cloudConfirmationCurrent = cloudLibraryItem?.confirmation.state === "confirmed"
    && cloudLibraryItem.confirmation.releaseId === record.id
    && cloudLibraryItem.confirmation.manifestHash === record.manifestHash;
  const cloudConfirmationNeeded = Boolean(
    cloudLibraryItem
    && confirmableInStudio
    && !cloudConfirmationCurrent,
  );
  const publicEvidenceKey = [
    record.id,
    record.schemaVersion,
    record.publisher.id,
    record.packageId,
    record.kind,
    record.resourceVersion,
    record.minimumStudioVersion,
    record.manifestHash,
    record.manifestByteSize,
    creatorMarketplaceStudioPackId(record),
  ].join("\u0000");
  const installActionLabel = bundled
    ? localizeText(
      t,
      "Studio 내장됨",
      "studio.community.install.builtIn",
    )
    : installed
      ? localizeText(
        t,
        "기기에서 제거",
        "studio.community.install.remove",
      )
      : installState === "update"
        ? localizeText(
          t,
          "업데이트 설치",
          "studio.community.install.update",
        )
        : installState === "repair-required"
          ? localizeText(
            t,
            "설치 복구",
            "studio.community.install.repair",
          )
          : installBlocked
            ? localizeText(
              t,
              "호환성 확인 필요",
              "studio.community.install.compatibilityCheck",
            )
            : localizeText(
              t,
              "무료 설치",
              "studio.community.install.free",
            );

  useEffect(() => () => {
    cloudOperationGenerationRef.current += 1;
    publicActionGenerationRef.current += 1;
    publicActionControllerRef.current?.abort();
    publicActionControllerRef.current = null;
  }, [publicEvidenceKey]);

  async function revalidateExactPublicRecord(
    actionLabel: string,
    controller: AbortController,
    generation: number,
  ): Promise<CreatorMarketplaceResourceRecord | null> {
    let current: CreatorMarketplaceResourceRecord;
    try {
      current = await getCreatorMarketplaceResource(record.id, controller.signal);
    } catch (caught: unknown) {
      if (
        controller.signal.aborted
        || publicActionGenerationRef.current !== generation
      ) return null;
      throw publicRevalidationError(record, actionLabel, caught);
    }
    if (
      controller.signal.aborted
      || publicActionGenerationRef.current !== generation
    ) return null;
    if (!hasExactCreatorMarketplacePublicEvidence(record, current)) {
      throw new Error(
        `${record.name}의 현재 공개 릴리스 증거가 이 카드와 달라 ${actionLabel}을(를) 중단했습니다. `
        + "공개 목록을 새로고침한 뒤 정확한 최신 릴리스에서 다시 시도해 주세요.",
      );
    }
    return current;
  }

  async function synchronizeVerifiedLocalInstall(): Promise<string> {
    if (projection.status !== "installable") {
      throw new Error("설치 가능한 패키지 증거를 찾을 수 없습니다.");
    }
    const synchronized = await synchronizeStudioCommunityMarketplaceInstalledPack(
      record,
      projection.pack,
    );
    onCloudChanged?.();
    return synchronized.message;
  }

  async function retryCloudConfirmation(): Promise<void> {
    if (
      projection.status !== "installable"
      || !cloudAuthenticated
      || cloudSyncPending
    ) return;
    cloudSyncFocusOriginRef.current = cloudSyncButtonRef.current;
    cloudSyncFocusRestoreRef.current = document.activeElement === cloudSyncFocusOriginRef.current;
    cloudSyncSucceededRef.current = false;
    const generation = cloudOperationGenerationRef.current + 1;
    cloudOperationGenerationRef.current = generation;
    setCloudSyncPending(true);
    setCloudSyncIssue(null);
    try {
      const verifiedState = await inspectStudioCreatorPackInstallStateProduct(
        projection.pack,
        { storage },
      );
      if (verifiedState !== "installed") {
        throw new Error("현재 기기에서 이 정확한 패키지 설치를 확인할 수 없습니다.");
      }
      const synchronized = await synchronizeVerifiedLocalInstall();
      if (cloudOperationGenerationRef.current !== generation) return;
      cloudSyncSucceededRef.current = true;
      onStatus(`${record.name} · ${synchronized}`, false);
    } catch (caught: unknown) {
      if (cloudOperationGenerationRef.current !== generation) return;
      const issue = errorText(
        caught,
        "계정 라이브러리 설치 확인을 동기화하지 못했습니다.",
      );
      setCloudSyncIssue(issue);
      onStatus(
        `${record.name} · 로컬 설치는 그대로 유지됩니다. 계정 설치 확인 실패: ${issue}`,
        true,
      );
    } finally {
      if (cloudOperationGenerationRef.current === generation) {
        setCloudSyncPending(false);
      }
    }
  }

  async function handleInstall(): Promise<void> {
    if (
      projection.status !== "installable"
      || installPending
      || cloudSyncPending
      || publicActionControllerRef.current
    ) return;
    installFocusRestoreRef.current = document.activeElement === installActionButtonRef.current;
    const removing = installed;
    const operationGeneration = cloudOperationGenerationRef.current + 1;
    cloudOperationGenerationRef.current = operationGeneration;
    const publicGeneration = removing
      ? null
      : publicActionGenerationRef.current + 1;
    const publicController = removing ? null : new AbortController();
    if (publicGeneration !== null && publicController) {
      publicActionGenerationRef.current = publicGeneration;
      publicActionControllerRef.current = publicController;
      setPublicActionPending("install");
    }
    setInstallPending(true);
    setCloudSyncIssue(null);
    try {
      if (publicGeneration !== null && publicController) {
        const current = await revalidateExactPublicRecord(
          "로컬 설치",
          publicController,
          publicGeneration,
        );
        if (
          !current
          || cloudOperationGenerationRef.current !== operationGeneration
        ) return;
      }
      const result = removing
        ? await uninstallStudioCreatorPackProduct(projection.pack, { storage })
        : await installStudioCreatorPackProduct(projection.pack, { storage });
      if (cloudOperationGenerationRef.current !== operationGeneration) return;
      const localFailure = [
        "invalid",
        "conflict",
        "storage-error",
      ].includes(result.status);
      if (removing) {
        onStatus(
          `${record.name} · ${result.message} 계정 라이브러리 멤버십과 과거 설치 확인은 유지됩니다.`,
          localFailure,
        );
      } else if (
        (result.status === "installed" || result.status === "already-installed")
        && cloudAuthenticated
      ) {
        try {
          setCloudSyncPending(true);
          const synchronized = await synchronizeVerifiedLocalInstall();
          if (cloudOperationGenerationRef.current !== operationGeneration) return;
          onStatus(`${record.name} · ${result.message} ${synchronized}`, false);
        } catch (caught: unknown) {
          if (cloudOperationGenerationRef.current !== operationGeneration) return;
          const issue = errorText(
            caught,
            "계정 라이브러리 설치 확인을 동기화하지 못했습니다.",
          );
          setCloudSyncIssue(issue);
          onStatus(
            `${record.name} · ${result.message} 로컬 설치는 유지되지만 계정 동기화는 실패했습니다: ${issue}`,
            true,
          );
        } finally {
          if (cloudOperationGenerationRef.current === operationGeneration) {
            setCloudSyncPending(false);
          }
        }
      } else {
        onStatus(
          `${record.name} · ${result.message}${
            result.status === "installed" && !cloudAuthenticated
              ? " 로그인하지 않아 계정 라이브러리에는 기록하지 않았습니다."
              : ""
          }`,
          localFailure,
        );
      }
      onInstallStateChanged();
    } catch (caught: unknown) {
      if (cloudOperationGenerationRef.current !== operationGeneration) return;
      onStatus(
        `${record.name} · ${errorText(caught, "로컬 설치 작업을 완료하지 못했습니다.")}`,
        true,
      );
    } finally {
      if (publicActionControllerRef.current === publicController) {
        publicActionControllerRef.current = null;
      }
      if (
        publicGeneration !== null
        && publicActionGenerationRef.current === publicGeneration
      ) {
        setPublicActionPending(null);
      }
      if (cloudOperationGenerationRef.current === operationGeneration) {
        setInstallPending(false);
      }
    }
  }

  useEffect(() => {
    if (
      !installFocusRestoreRef.current
      || installPending
      || cloudSyncPending
      || publicActionPending !== null
    ) return;
    const button = installActionButtonRef.current;
    if (!button?.isConnected || button.disabled) return;
    restoreButtonFocusIfUnclaimed(button);
    installFocusRestoreRef.current = false;
  }, [
    cloudSyncPending,
    installPending,
    installState,
    publicActionPending,
    refreshToken,
  ]);

  useEffect(() => {
    if (
      !cloudSyncFocusRestoreRef.current
      || cloudSyncPending
      || installPending
    ) return;
    const button = cloudSyncSucceededRef.current
      ? installActionButtonRef.current
      : cloudSyncButtonRef.current;
    if (!button?.isConnected || button.disabled) return;
    const active = document.activeElement;
    if (active === cloudSyncFocusOriginRef.current && active !== button) {
      button.focus();
    } else {
      restoreButtonFocusIfUnclaimed(button);
    }
    cloudSyncFocusRestoreRef.current = false;
    cloudSyncFocusOriginRef.current = null;
  }, [cloudSyncIssue, cloudSyncPending, installPending]);

  useEffect(() => {
    if (!assetFocusRestoreRef.current || publicActionPending !== null) return;
    const button = assetActionButtonRef.current;
    if (!button?.isConnected || button.disabled) return;
    restoreButtonFocusIfUnclaimed(button);
    assetFocusRestoreRef.current = false;
  }, [publicActionPending]);

  async function handleUseAsset(): Promise<void> {
    if (
      !selectedAsset
      || !onUseAsset
      || publicActionPending
      || publicActionControllerRef.current
    ) return;
    assetFocusRestoreRef.current = document.activeElement === assetActionButtonRef.current;
    const generation = publicActionGenerationRef.current + 1;
    publicActionGenerationRef.current = generation;
    const controller = new AbortController();
    publicActionControllerRef.current = controller;
    setPublicActionPending("asset");
    try {
      const current = await revalidateExactPublicRecord(
        "에셋 삽입",
        controller,
        generation,
      );
      if (!current) return;
      const inserted = onUseAsset(createStudioOriginalFreeAssetRecord(selectedAsset));
      onStatus(
        inserted
          ? tText(
            t,
            `${selectedAsset.name}을(를) 현재 캔버스 위치에 삽입했습니다.`,
            "studio.community.useAsset.success",
            { resourceName: selectedAsset.name },
          )
          : tText(
            t,
            `${selectedAsset.name}을(를) 삽입하지 못했습니다. 캔버스 잠금과 저장 상태를 확인해주세요.`,
            "studio.community.useAsset.failed",
            { resourceName: selectedAsset.name },
          ),
        !inserted,
      );
    } catch (caught: unknown) {
      if (
        controller.signal.aborted
        || publicActionGenerationRef.current !== generation
      ) return;
      onStatus(
        errorText(caught, `${record.name} 에셋 삽입을 완료하지 못했습니다.`),
        true,
      );
    } finally {
      if (publicActionControllerRef.current === controller) {
        publicActionControllerRef.current = null;
      }
      if (publicActionGenerationRef.current === generation) {
        setPublicActionPending(null);
      }
    }
  }

  return (
    <article
      data-studio-community-resource={record.id}
      data-studio-community-refresh={refreshToken}
      className="rounded-lg border border-line bg-card p-2.5"
    >
      <div className="flex items-start gap-2">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-accent/25 bg-accent-soft text-accent">
          {record.kind === "asset" ? <BadgeCheck size={16} aria-hidden /> : null}
          {record.kind === "brush" ? <Brush size={16} aria-hidden /> : null}
          {record.kind === "filter" ? <Filter size={16} aria-hidden /> : null}
          {record.kind === "palette" ? <Palette size={16} aria-hidden /> : null}
          {record.kind === "template" ? <LayoutTemplate size={16} aria-hidden /> : null}
          {record.kind === "3d-preset" ? <Box size={16} aria-hidden /> : null}
        </span>
        <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1">
              <h3 className="text-[0.7rem] font-black text-fg">{record.name}</h3>
              <span className="rounded-full border border-good/30 bg-good/10 px-1.5 py-0.5 text-[0.52rem] font-black text-good">
              {t("studio.community.record.free")}
              </span>
              <span className="rounded-full border border-line px-1.5 py-0.5 text-[0.52rem] font-semibold text-fg-3">
              {localizeText(t, KIND_LABEL_FALLBACK[record.kind], KIND_LABEL[record.kind])}
              </span>
            {ownedRelease ? <StudioOwnedLifecycleBadge release={ownedRelease} /> : null}
            {record.containsAi ? (
              <span className="rounded-full border border-warn/30 bg-warn/10 px-1.5 py-0.5 text-[0.52rem] font-semibold text-warn">
                {t("studio.community.tag.aiIncluded")}
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 flex items-center gap-1 text-[0.56rem] text-fg-3">
            <UserRound size={10} aria-hidden />
            {record.publisher.name} · v{record.resourceVersion}
          </p>
        </div>
      </div>
      {record.description ? (
        <p className="mt-2 text-[0.6rem] leading-relaxed text-fg-2">
          {record.description}
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-1 text-[0.54rem]">
        <span className="rounded-md border border-line bg-panel px-1.5 py-1 text-fg-2">
          {localizeText(t, LICENSE_LABEL_FALLBACK[record.license], LICENSE_LABEL[record.license])}
        </span>
        <span className="rounded-md border border-line bg-panel px-1.5 py-1 text-fg-3">
          {tText(
            t,
            "{count}개 항목",
            "studio.community.record.entryCount",
            { count: record.entries.length },
          )}
        </span>
        {record.tags.slice(0, 3).map((tag) => (
          <span key={tag} className="rounded-md border border-line bg-panel px-1.5 py-1 text-fg-3">
            #{tag}
          </span>
        ))}
      </div>
      {cloudLibraryItem ? (
        <div className="mt-2 rounded-md border border-cool/25 bg-cool/10 px-2 py-1.5">
          <p className="flex items-start gap-1.5 text-[0.55rem] leading-relaxed text-fg-2">
            <Cloud size={12} className="mt-0.5 shrink-0 text-cool" aria-hidden />
            <span>
              계정 라이브러리 {cloudLibraryItem.membership === "active" ? "활성" : "보관"}
              {cloudLibraryItem.confirmation.state === "confirmed"
                ? ` · Studio v${cloudLibraryItem.confirmation.resourceVersion} 설치 확인 이력`
                : " · 확인된 Studio 설치 없음"}
              . 현재 기기의 설치 상태는 아래 로컬 버튼이 별도로 확인합니다.
            </span>
          </p>
          {onCloudMembershipChange ? (
            <button
              ref={cloudMembershipButtonRef}
              type="button"
              disabled={cloudMembershipPending}
              onClick={(event) => onCloudMembershipChange(
                cloudLibraryItem,
                event.currentTarget,
              )}
              className={cx(
                "mt-1.5 min-h-9 w-full rounded-md border border-cool/30 px-2 text-[0.55rem] font-bold text-cool hover:bg-cool/10 disabled:cursor-not-allowed disabled:opacity-50",
                FOCUS,
              )}
            >
              {cloudMembershipPending
                ? "계정 보관 상태 변경 중…"
                : cloudLibraryItem.membership === "active"
                  ? "계정 라이브러리에 보관"
                  : "계정 라이브러리로 복원"}
            </button>
          ) : null}
        </div>
      ) : null}
      {record.attributionText ? (
        <p className="mt-2 rounded-md border border-line bg-panel px-2 py-1.5 text-[0.55rem] leading-relaxed text-fg-3">
          {tText(
            t,
            "출처 표시: {value}",
            "studio.community.record.attribution",
            { value: record.attributionText },
          )}
        </p>
      ) : null}
      {record.license === "cc-by-nc-4.0" ? (
        <p className="mt-2 rounded-md border border-warn/25 bg-warn/10 px-2 py-1.5 text-[0.55rem] font-semibold text-warn">
          {t("studio.community.record.nonCommercialNotice")}
        </p>
      ) : null}
      {compatibilityPending ? (
        <p
          role="status"
          className="mt-2 flex items-center gap-1.5 rounded-md border border-line bg-panel px-2 py-1.5 text-[0.55rem] leading-relaxed text-fg-2"
        >
          <LoaderCircle size={12} className="shrink-0 animate-spin" aria-hidden />
          {pendingCompatibilityReason}
        </p>
      ) : record.kind === "asset" && assetProjection.assets.length > 0 ? (
        <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-1.5">
          <select
            value={selectedAsset?.id ?? ""}
            onChange={(event) => setSelectedAssetId(event.target.value)}
            disabled={publicActionPending === "asset"}
            aria-label={tText(
              t,
              "{resourceName} 에셋 선택",
              "studio.community.record.selectAssetAria",
              { resourceName: record.name },
            )}
            className={CONTROL}
          >
            {assetProjection.assets.map((asset) => (
              <option key={asset.id} value={asset.id}>{asset.name}</option>
            ))}
          </select>
          <button
            ref={assetActionButtonRef}
            type="button"
            onClick={() => void handleUseAsset()}
            disabled={!onUseAsset || publicActionPending === "asset"}
            className={PRIMARY}
          >
            {publicActionPending === "asset"
              ? "공개 상태 확인 중…"
              : t("studio.community.record.addToCanvas")}
          </button>
        </div>
      ) : projection.status === "installable" ? (
        <button
          ref={installActionButtonRef}
          type="button"
          onClick={() => void handleInstall()}
          disabled={
            bundled
            || installBlocked
            || installPending
            || cloudSyncPending
            || publicActionPending !== null
          }
          className={cx(
            "mt-2 w-full",
            installed
              ? `${CONTROL} border-bad/30 text-bad hover:bg-bad/10`
              : PRIMARY,
          )}
        >
          {publicActionPending === "install"
            ? "공개 상태 확인 중…"
            : installPending
            ? cloudSyncPending
              ? "로컬 설치 완료 · 계정 확인 중…"
              : "로컬 SQL 확인 중…"
            : installActionLabel}
        </button>
      ) : (
        <p className="mt-2 rounded-md border border-warn/25 bg-warn/10 px-2 py-1.5 text-[0.55rem] leading-relaxed text-warn">
          {record.kind === "asset"
            ? assetProjection.reason
            : projection.reason}
        </p>
      )}
      {projection.status === "installable"
        && installed
        && cloudAuthenticated
        && (cloudSyncIssue || cloudConfirmationNeeded) ? (
          <button
            ref={cloudSyncButtonRef}
            type="button"
            onClick={() => void retryCloudConfirmation()}
            disabled={cloudSyncPending || installPending}
            className={cx("mt-2 w-full", CONTROL)}
          >
            {cloudSyncPending ? (
              <LoaderCircle size={13} className="mr-1 inline animate-spin" aria-hidden />
            ) : (
              <Cloud size={13} className="mr-1 inline" aria-hidden />
            )}
            {cloudSyncPending ? "계정 설치 확인 중…" : "계정 설치 확인 다시 동기화"}
          </button>
        ) : null}
      {cloudSyncIssue ? (
        <p role="alert" className="mt-2 rounded-md border border-warn/25 bg-warn/10 px-2 py-1.5 text-[0.55rem] leading-relaxed text-warn">
          로컬 설치는 유지됩니다. 계정 동기화만 다시 시도하세요: {cloudSyncIssue}
        </p>
      ) : null}
      <CreatorMarketplaceReportAction
        record={record}
        compact
        className="mt-2"
      />
      {ownedRelease && onDelist && onRelisted ? (
        <>
          <StudioOwnedReleaseLifecycleActions
            release={ownedRelease}
            onDelist={onDelist}
            onRelisted={onRelisted}
          />
          <StudioOwnedPackageHistory head={ownedRelease} />
        </>
      ) : null}
    </article>
  );
}

export function ShareResourceForm({
  onPublished,
}: {
  readonly onPublished: (
    record: CreatorMarketplaceResourceRecord,
    successMessage: string,
  ) => void;
}) {
  const t = useT();
  const releaseVersionInputId = useId();
  const mountedRef = useRef(false);
  const submissionGenerationRef = useRef(0);
  const ownedHeadGenerationRef = useRef(0);
  const ownedHeadControllerRef = useRef<AbortController | null>(null);
  const versionTouchedRef = useRef(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const [filterPresets, setFilterPresets] = useState<
    readonly StudioFilterLibraryPreset[]
  >([]);
  const [brushes, setBrushes] = useState<readonly StudioSavedBrush[]>([]);
  const [palettes, setPalettes] = useState<readonly StudioNamedPalette[]>([]);
  const [filterLoadError, setFilterLoadError] = useState<string | null>(null);
  const [creativeLoadError, setCreativeLoadError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    async function loadFilters(): Promise<void> {
      try {
        const product = await acquireProductFilterLibraryRepository();
        const filters = await readAllFilterPresetsFromRepository(product.repository);
        if (active) {
          setFilterPresets(filters);
          setFilterLoadError(null);
        }
      } catch (error) {
        if (active) {
          setFilterPresets([]);
          setFilterLoadError(
            error instanceof Error ? error.message : String(error),
          );
        }
      }
    }
    void loadFilters();
    const unsubscribe = subscribeStudioFilterLibraryChanges(() => void loadFilters());
    return () => {
      active = false;
      unsubscribe();
    };
  }, [refreshToken]);
  useEffect(() => {
    let active = true;
    const paletteRepository = getProductStudioPaletteSqliteRepository();
    async function loadCreativeLibraries(): Promise<void> {
      try {
        const brushProduct = await openProductBrushLibraryRepository();
        if (brushProduct.authority !== "sqlite") {
          throw new Error("브러시 SQLite/OPFS 권위를 사용할 수 없습니다.");
        }
        const [storedBrushes, storedPalettes] = await Promise.all([
          readAllBrushesFromRepository(brushProduct.repository),
          paletteRepository.list(),
        ]);
        if (active) {
          setBrushes(storedBrushes);
          setPalettes(storedPalettes);
          setCreativeLoadError(null);
        }
      } catch (error) {
        if (active) {
          setBrushes([]);
          setPalettes([]);
          setCreativeLoadError(error instanceof Error ? error.message : String(error));
        }
      }
    }
    void loadCreativeLibraries();
    const unsubscribe = paletteRepository.subscribe(() => void loadCreativeLibraries());
    return () => {
      active = false;
      unsubscribe();
    };
  }, [refreshToken]);
  const candidates = listStudioCommunityShareCandidates({
    brushes,
    filters: filterPresets,
    palettes,
  });
  const candidateKey = (candidate: StudioCommunityShareCandidate) =>
    `${candidate.kind}:${candidate.id}`;
  const [selectedCandidateKey, setSelectedCandidateKey] = useState(
    candidates[0] ? candidateKey(candidates[0]) : "",
  );
  const [description, setDescription] = useState("");
  const [releaseNotes, setReleaseNotes] = useState("");
  const [resourceVersion, setResourceVersion] = useState("1.0.0");
  const [license, setLicense] =
    useState<CreatorMarketplaceResourceLicense>("toonspectrum-standard");
  const [attributionText, setAttributionText] = useState("");
  const [containsAi, setContainsAi] = useState(false);
  const [ownsRights, setOwnsRights] = useState(false);
  const [notMarketplaceDerivative, setNotMarketplaceDerivative] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [status, setStatus] = useState<{ message: string; error: boolean } | null>(null);
  const [ownedHead, setOwnedHead] = useState<CreatorMarketplaceOwnedRelease | null>(null);
  const [ownedHeadStatus, setOwnedHeadStatus] = useState<
    "idle" | "loading" | "ready" | "error" | "conflict"
  >("idle");
  const [ownedHeadError, setOwnedHeadError] = useState<string | null>(null);
  const [ownedHeadRetryToken, setOwnedHeadRetryToken] = useState(0);
  const [resolvedIdentity, setResolvedIdentity] =
    useState<StudioCommunityShareCandidateIdentity | null>(null);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      submissionGenerationRef.current += 1;
      ownedHeadGenerationRef.current += 1;
      ownedHeadControllerRef.current?.abort();
    };
  }, []);
  const candidate = candidates.find(
    (item) => candidateKey(item) === selectedCandidateKey,
  )
    ?? candidates[0]
    ?? null;
  const candidateId = candidate?.id ?? null;
  const candidateKind = candidate?.kind ?? null;
  const candidateV2Identity = candidateId && candidateKind
    ? studioCommunityShareCandidateIdentity({ id: candidateId, kind: candidateKind })
    : null;
  const candidateLegacyIdentity = candidateId && candidateKind
    ? studioCommunityShareCandidateLegacyIdentity({ id: candidateId, kind: candidateKind })
    : null;
  const candidatePackageId = candidateV2Identity?.packageId ?? null;
  const candidateEntryId = candidateV2Identity?.entryId ?? null;
  const candidateLegacyPackageId = candidateLegacyIdentity?.packageId ?? null;
  const candidateLegacyEntryId = candidateLegacyIdentity?.entryId ?? null;
  useEffect(() => {
    ownedHeadControllerRef.current?.abort();
    ownedHeadControllerRef.current = null;
    const generation = ownedHeadGenerationRef.current + 1;
    ownedHeadGenerationRef.current = generation;
    setOwnedHead(null);
    setResolvedIdentity(null);
    setOwnedHeadError(null);
    if (
      !candidatePackageId
      || !candidateLegacyPackageId
      || !candidateEntryId
      || !candidateLegacyEntryId
    ) {
      setOwnedHeadStatus("idle");
      return undefined;
    }

    const controller = new AbortController();
    ownedHeadControllerRef.current = controller;
    setOwnedHeadStatus("loading");
    const loadExactHead = async (packageId: string) => {
      try {
        const page = await listCreatorMarketplaceOwnedHistory({
          packageId,
          limit: 1,
        }, controller.signal);
        return page.items[0] ?? null;
      } catch (caught) {
        if (caught instanceof NotFoundError) return null;
        throw caught;
      }
    };
    void Promise.all([
      loadExactHead(candidatePackageId),
      loadExactHead(candidateLegacyPackageId),
    ]).then(([v2Head, legacyHead]) => {
      if (controller.signal.aborted || ownedHeadGenerationRef.current !== generation) return;
      if (v2Head && legacyHead) {
        setOwnedHeadStatus("conflict");
        setOwnedHeadError(
          "이 후보에 v2와 legacy package 이력이 모두 있어 안전한 후속 릴리스를 결정할 수 없습니다. 두 패키지 이력을 확인해 주세요.",
        );
        return;
      }
      const exactHead = v2Head ?? legacyHead;
      setResolvedIdentity(legacyHead
        ? {
            scheme: "legacy",
            packageId: candidateLegacyPackageId,
            entryId: candidateLegacyEntryId,
          }
        : {
            scheme: "v2",
            packageId: candidatePackageId,
            entryId: candidateEntryId,
          });
      setOwnedHead(exactHead);
      setOwnedHeadStatus("ready");
      if (!versionTouchedRef.current) {
        setResourceVersion(exactHead
          ? suggestNextCreatorMarketplaceSemver(exactHead.resource.resourceVersion) ?? ""
          : "1.0.0");
      }
    }).catch((caught: unknown) => {
      if (controller.signal.aborted || ownedHeadGenerationRef.current !== generation) return;
      setOwnedHeadStatus("error");
      setOwnedHeadError(errorText(caught, "현재 패키지 릴리스를 확인하지 못했습니다."));
    });

    return () => controller.abort();
  }, [
    candidateEntryId,
    candidateLegacyEntryId,
    candidateLegacyPackageId,
    candidatePackageId,
    ownedHeadRetryToken,
  ]);
  const attributionRequired =
    license === "cc-by-4.0" || license === "cc-by-nc-4.0";
  const normalizedResourceVersion = resourceVersion.trim();
  const resourceVersionValid = isCreatorMarketplaceSemver(
    normalizedResourceVersion,
  );
  const ready = Boolean(candidate)
    && ownedHeadStatus === "ready"
    && resolvedIdentity !== null
    && !ownedHead?.hidden
    && resourceVersionValid
    && ownsRights
    && notMarketplaceDerivative
    && (!attributionRequired || attributionText.trim().length > 0)
    && !publishing;

  async function handlePublish(event: FormEvent) {
    event.preventDefault();
    if (!candidate || !resolvedIdentity || !ready) return;
    const submissionGeneration = submissionGenerationRef.current + 1;
    submissionGenerationRef.current = submissionGeneration;
    const canApplySubmissionResult = () =>
      mountedRef.current
      && submissionGenerationRef.current === submissionGeneration;
    setPublishing(true);
    setStatus(null);
    try {
      const manifest = await createStudioCommunityPublishManifest(candidate, {
        resourceVersion: normalizedResourceVersion,
        description,
        releaseNotes,
        license,
        attributionText,
        containsAi,
        creatorOwnsRights: ownsRights,
        recognizableMarketplaceDerivative: !notMarketplaceDerivative,
        resolvedIdentity,
      });
      const published = await publishCreatorMarketplaceResource(manifest);
      if (!canApplySubmissionResult()) return;
      const successMessage = tText(
        t,
        '"{resourceName}"을(를) 무료 공유 마켓에 게시했습니다.',
        "studio.community.share.publishSuccess",
        { resourceName: published.name },
      );
      setStatus({
        message: successMessage,
        error: false,
      });
      onPublished(published, successMessage);
    } catch (caught) {
      if (!canApplySubmissionResult()) return;
      setStatus({
        message: errorText(
          caught,
          t("studio.community.share.publishError"),
        ),
        error: true,
      });
    } finally {
      if (canApplySubmissionResult()) {
        setPublishing(false);
      }
    }
  }

  return (
    <form onSubmit={handlePublish} className="space-y-2">
      <div className="flex items-start gap-2 rounded-lg border border-warn/25 bg-warn/10 p-2.5">
        <ShieldCheck size={15} className="mt-0.5 shrink-0 text-warn" aria-hidden />
        <p className="text-[0.59rem] leading-relaxed text-fg-2">
          {STUDIO_MARKETPLACE_REDISTRIBUTION_NOTICE}
        </p>
      </div>
      {filterLoadError ? (
        <p role="alert" className="rounded-lg border border-bad/25 bg-bad/10 px-2.5 py-2 text-[0.58rem] text-bad">
          필터 카탈로그 SQL을 읽지 못했습니다: {filterLoadError}
        </p>
      ) : null}
      {creativeLoadError ? (
        <p role="alert" className="rounded-lg border border-bad/25 bg-bad/10 px-2.5 py-2 text-[0.58rem] text-bad">
          브러시·팔레트 SQLite를 읽지 못했습니다: {creativeLoadError}
        </p>
      ) : null}
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-1.5">
        <select
          value={candidate ? candidateKey(candidate) : ""}
          onChange={(event) => {
            versionTouchedRef.current = false;
            setSelectedCandidateKey(event.target.value);
            setResourceVersion("1.0.0");
          }}
          aria-label={t("studio.community.share.selectCandidateAria")}
          className={CONTROL}
          disabled={!candidate}
        >
            {candidates.length === 0
                ? <option value="">{t("studio.community.share.noCandidate")}</option>
                : null}
            {candidates.map((item) => (
              <option key={candidateKey(item)} value={candidateKey(item)}>
                [{localizeText(t, SHARE_KIND_LABEL_FALLBACK[item.kind], SHARE_KIND_LABEL[item.kind])}] {item.name}
              </option>
            ))}
        </select>
        <button
          type="button"
          onClick={() => setRefreshToken((value) => value + 1)}
          aria-label={t("studio.community.share.refreshCandidatesAria")}
          className={CONTROL}
          data-studio-share-refresh={refreshToken}
        >
          <RefreshCw size={14} aria-hidden />
        </button>
      </div>
      {ownedHeadStatus === "loading" ? (
        <p role="status" className="rounded-lg border border-line bg-card px-2.5 py-2 text-[0.58rem] text-fg-2">
          이 후보의 현재 릴리스를 확인하는 중…
        </p>
      ) : null}
      {ownedHeadStatus === "error" ? (
        <div role="alert" className="rounded-lg border border-bad/25 bg-bad/10 px-2.5 py-2 text-[0.58rem] text-bad">
          <p>{ownedHeadError}</p>
          <button
            type="button"
            onClick={() => setOwnedHeadRetryToken((value) => value + 1)}
            className={cx("mt-2", CONTROL)}
          >
            현재 릴리스 다시 확인
          </button>
        </div>
      ) : null}
      {ownedHeadStatus === "conflict" ? (
        <p role="alert" className="rounded-lg border border-bad/25 bg-bad/10 px-2.5 py-2 text-[0.58rem] leading-relaxed text-bad">
          {ownedHeadError}
        </p>
      ) : null}
      {ownedHeadStatus === "ready" ? (
        <div className="rounded-lg border border-line bg-card px-2.5 py-2 text-[0.58rem] leading-relaxed text-fg-2">
          {ownedHead ? (
            <>
              <p className="flex flex-wrap items-center gap-1.5">
                <strong className="text-fg">현재 헤드 v{ownedHead.resource.resourceVersion}</strong>
                <StudioOwnedLifecycleBadge release={ownedHead} />
                <span className="text-fg-3">릴리스 #{ownedHead.releaseOrdinal}</span>
              </p>
              <p className="mt-1">
                {ownedHead.hidden
                  ? "관리자 검수로 숨겨진 패키지는 숨김이 해제되기 전까지 다시 공개하거나 새 릴리스를 게시할 수 없습니다."
                  : ownedHead.delistedAt
                    ? "목록에서 내린 현재 헤드여도 더 높은 새 버전을 게시하면 이 패키지의 후속 헤드가 됩니다."
                  : "더 높은 새 버전을 게시하면 이 패키지의 후속 헤드가 됩니다."}
              </p>
            </>
          ) : (
            <p>이 후보와 정확히 일치하는 기존 packageId가 없어 v1.0.0을 첫 릴리스로 제안합니다.</p>
          )}
        </div>
      ) : null}
      <div className="space-y-1">
        <label
          htmlFor={releaseVersionInputId}
          className="block text-[0.58rem] font-semibold text-fg-2"
        >
          릴리스 버전 (SemVer)
        </label>
        <input
          id={releaseVersionInputId}
          value={resourceVersion}
          onChange={(event) => {
            versionTouchedRef.current = true;
            setResourceVersion(event.target.value);
          }}
          maxLength={CREATOR_MARKETPLACE_SEMVER_MAX_CHARACTERS}
          required
          spellCheck={false}
          autoComplete="off"
          aria-invalid={!resourceVersionValid}
          aria-describedby={`${releaseVersionInputId}-help`}
          placeholder="1.0.1"
          className={cx("w-full font-mono", CONTROL)}
        />
        <p
          id={`${releaseVersionInputId}-help`}
          className={cx(
            "text-[0.55rem] leading-relaxed",
            resourceVersionValid ? "text-fg-3" : "text-bad",
          )}
        >
          {resourceVersionValid
            ? "기존 패키지의 새 릴리스는 현재 버전보다 높은 SemVer를 입력하세요."
            : "1.2.3 또는 1.2.3-rc.1+build.7 형식으로 입력하세요."}
        </p>
      </div>
      <textarea
        value={description}
        onChange={(event) => setDescription(event.target.value.slice(0, 1_000))}
        placeholder={t("studio.community.share.descriptionPlaceholder")}
        aria-label={t("studio.community.share.descriptionAria")}
        rows={3}
        className={cx(
          "w-full resize-y rounded-lg border border-line bg-card px-2.5 py-2 text-[0.65rem] text-fg outline-none placeholder:text-fg-3 focus:border-accent",
          FOCUS,
        )}
      />
      <textarea
        value={releaseNotes}
        onChange={(event) => setReleaseNotes(
          event.target.value.slice(0, CREATOR_MARKETPLACE_RESOURCE_RELEASE_NOTES_MAX_CHARACTERS),
        )}
        maxLength={CREATOR_MARKETPLACE_RESOURCE_RELEASE_NOTES_MAX_CHARACTERS}
        placeholder="이번 버전에서 달라진 점 (선택)"
        aria-label="릴리스 노트 (선택)"
        rows={3}
        className={cx(
          "w-full resize-y rounded-lg border border-line bg-card px-2.5 py-2 text-[0.65rem] text-fg outline-none placeholder:text-fg-3 focus:border-accent",
          FOCUS,
        )}
      />
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        <select
          value={license}
          onChange={(event) => setLicense(
            event.target.value as CreatorMarketplaceResourceLicense,
          )}
          aria-label={t("studio.community.share.licenseAria")}
          className={CONTROL}
        >
          {LICENSE_OPTIONS.map((licenseOption) => (
            <option key={licenseOption.value} value={licenseOption.value}>
              {localizeText(t, licenseOption.labelFallback, licenseOption.labelKey)}
            </option>
          ))}
        </select>
        <label className={cx(
          CONTROL,
          "flex cursor-pointer items-center justify-between gap-2",
        )}>
          <span>{t("studio.community.share.aiIncludedLabel")}</span>
          <input
            type="checkbox"
            checked={containsAi}
            onChange={(event) => setContainsAi(event.target.checked)}
            className="size-4 accent-accent"
          />
        </label>
      </div>
      {attributionRequired ? (
        <input
          value={attributionText}
          onChange={(event) => setAttributionText(event.target.value.slice(0, 240))}
          placeholder={t("studio.community.share.attributionPlaceholder")}
          aria-label={t("studio.community.share.attributionAria")}
          className={cx("w-full", CONTROL)}
        />
      ) : null}
      <label className={cx(
        CONTROL,
        "flex cursor-pointer items-start gap-2 py-2 leading-relaxed",
      )}>
        <input
          type="checkbox"
          checked={ownsRights}
          onChange={(event) => setOwnsRights(event.target.checked)}
          className="mt-0.5 size-4 shrink-0 accent-accent"
        />
          <span>{t("studio.community.share.ownershipStatement")}</span>
        </label>
      <label className={cx(
        CONTROL,
        "flex cursor-pointer items-start gap-2 py-2 leading-relaxed",
      )}>
        <input
          type="checkbox"
          checked={notMarketplaceDerivative}
          onChange={(event) => setNotMarketplaceDerivative(event.target.checked)}
          className="mt-0.5 size-4 shrink-0 accent-accent"
        />
          <span>{t("studio.community.share.derivativeStatement")}</span>
        </label>
        <button type="submit" disabled={!ready} className={cx("w-full", PRIMARY)}>
          {publishing
            ? <LoaderCircle size={14} className="mr-1 inline animate-spin" aria-hidden />
            : <Send size={14} className="mr-1 inline" aria-hidden />}
          {t("studio.community.share.submit")}
        </button>
      {status ? (
        <p
          role={status.error ? "alert" : "status"}
          className={cx(
            "rounded-lg border px-2.5 py-2 text-[0.6rem] leading-relaxed",
            status.error
              ? "border-bad/25 bg-bad/10 text-bad"
              : "border-good/25 bg-good/10 text-good",
          )}
        >
          {status.message}
        </p>
      ) : null}
    </form>
  );
}

export function StudioCommunityMarketplacePanel({
  onUseAsset,
  initialOpen = false,
  initialView = "community",
}: {
  readonly onUseAsset?: (asset: StudioAsset) => boolean;
  readonly initialOpen?: boolean;
  readonly initialView?: StudioCommunityMarketplaceView;
}): ReactElement {
  const searchId = useId();
  const tabBaseId = useId();
  const [open, setOpen] = useState(initialOpen);
  const [view, setView] = useState<StudioCommunityMarketplaceView>(initialView);
  const [kind, setKind] = useState<CreatorMarketplaceResourceKind | "all">("all");
  const [queryDraft, setQueryDraft] = useState("");
  const [query, setQuery] = useState("");
  const [records, setRecords] = useState<CreatorMarketplaceResourceRecord[]>([]);
  const [libraryEntries, setLibraryEntries] = useState<
    StudioCloudLibraryEntry[]
  >([]);
  const [libraryView, setLibraryView] = useState<CreatorMarketplaceCloudLibraryView>(
    "active",
  );
  const [libraryMutationId, setLibraryMutationId] = useState<string | null>(null);
  const [ownedReleaseById, setOwnedReleaseById] = useState<
    Readonly<Record<string, CreatorMarketplaceOwnedRelease>>
  >({});
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<{ message: string; error: boolean } | null>(null);
  const [compatibilityContext, setCompatibilityContext] =
    useState<StudioMarketplaceRuntimeCompatibilityContext | null>(null);
  const [compatibilityIssue, setCompatibilityIssue] = useState<string | null>(null);
  const [compatibilityReloadToken, setCompatibilityReloadToken] = useState(0);
  const [reloadToken, setReloadToken] = useState(0);
  const [refreshToken, setRefreshToken] = useState(0);
  const listingRequestGenerationRef = useRef(0);
  const listingRequestControllerRef = useRef<AbortController | null>(null);
  const loadMoreRequestControllerRef = useRef<AbortController | null>(null);
  const libraryMutationControllerRef = useRef<AbortController | null>(null);
  const marketplaceTabRefs = useRef<Partial<
    Record<StudioCommunityMarketplaceView, HTMLButtonElement | null>
  >>({});
  const libraryViewButtonRefs = useRef<Partial<
    Record<CreatorMarketplaceCloudLibraryView, HTMLButtonElement | null>
  >>({});
  const libraryMembershipButtonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const libraryFocusRestoreRef = useRef<LibraryFocusRestoreRequest | null>(null);
  const confirmedPublishedRecordRef = useRef<CreatorMarketplaceResourceRecord | null>(null);
  const t = useT();
  const reportRecordStatus = useCallback((message: string, statusError: boolean) => {
    setStatus({ message, error: statusError });
  }, []);
  const refreshInstallStates = useCallback(() => {
    setRefreshToken((value) => value + 1);
  }, []);

  useEffect(() => () => {
    libraryMutationControllerRef.current?.abort();
    libraryMutationControllerRef.current = null;
    libraryFocusRestoreRef.current = null;
  }, []);

  useEffect(() => {
    const request = libraryFocusRestoreRef.current;
    if (!request || libraryMutationId) return;
    const button = request.target === "action"
      ? libraryMembershipButtonRefs.current.get(request.itemId) ?? null
      : libraryViewButtonRefs.current[request.target] ?? null;
    if (!button?.isConnected || button.disabled) return;
    const active = document.activeElement;
    if (active === request.origin && active !== button) {
      button.focus();
    } else {
      restoreButtonFocusIfUnclaimed(button);
    }
    libraryFocusRestoreRef.current = null;
  }, [libraryEntries, libraryMutationId, libraryView, status]);

  useEffect(() => {
    if (!open || view === "share") return;
    let active = true;
    setCompatibilityContext(null);
    setCompatibilityIssue(null);
    void getProductStudioMarketplaceRuntimeCompatibility()
      .then((context) => {
        if (!active) return;
        setCompatibilityContext(context);
        if (context.supportedEngines === null) {
          setCompatibilityIssue(
            "기기 엔진 측정을 완료하지 못해 설치 호환성을 확인할 수 없어요. 잠시 후 다시 시도해 주세요.",
          );
        } else if (context.unverifiedEngines.length > 0) {
          setCompatibilityIssue(
            context.supportedEngines.length > 0
              ? "일부 기기 엔진 측정을 완료하지 못했어요. 확인된 엔진용 자료는 계속 사용할 수 있고, 측정되지 않은 엔진이 필요한 자료만 설치를 보류합니다."
              : "기기 엔진 측정을 완료하지 못해 설치 호환성을 확인할 수 없어요. 잠시 후 다시 시도해 주세요.",
          );
        }
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setCompatibilityIssue(
          errorText(caught, "기기 엔진 호환성을 확인하지 못했습니다."),
        );
      });
    return () => {
      active = false;
    };
  }, [compatibilityReloadToken, open, view]);

  useEffect(() => {
    const requestGeneration = listingRequestGenerationRef.current + 1;
    listingRequestGenerationRef.current = requestGeneration;
    listingRequestControllerRef.current?.abort();
    listingRequestControllerRef.current = null;
    loadMoreRequestControllerRef.current?.abort();
    loadMoreRequestControllerRef.current = null;
    setLoadingMore(false);
    setNextCursor(null);
    setHasMore(false);
    const confirmedPublishedRecord = view === "mine"
      ? confirmedPublishedRecordRef.current
      : null;
    setRecords(confirmedPublishedRecord ? [confirmedPublishedRecord] : []);
    setLibraryEntries([]);
    setOwnedReleaseById({});
    if (!open || view === "share") {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    listingRequestControllerRef.current = controller;
    const isCurrentRequest = () =>
      !controller.signal.aborted
      && listingRequestGenerationRef.current === requestGeneration;
    setLoading(true);
    setError(null);
    void (async () => {
      const params = {
        limit: 12,
        search: query || undefined,
        kind: kind === "all" ? undefined : kind,
      } as const;
      if (view === "mine") {
        const page = await listCreatorMarketplaceOwnedHeads(params, controller.signal);
        return {
          items: page.items.map((release) => release.resource),
          libraryEntries: [] as StudioCloudLibraryEntry[],
          ownedReleases: page.items,
          nextCursor: page.nextCursor,
          hasMore: page.hasMore,
        };
      }
      if (view === "library") {
        const page = await loadStudioCloudLibraryEntries({
          view: libraryView,
          limit: 12,
        }, controller.signal);
        return {
          items: page.entries.flatMap((entry) => entry.record ? [entry.record] : []),
          libraryEntries: [...page.entries],
          ownedReleases: [] as CreatorMarketplaceOwnedRelease[],
          nextCursor: page.nextCursor,
          hasMore: page.hasMore,
        };
      }
      try {
        const page = await listCreatorMarketplaceResources(params, controller.signal);
        let items = page.items;
        let hasMore = page.hasMore;
        let nextCursor = page.nextCursor;
        if (items.length === 0 && !params.search) {
          const starter = filterStarterMarketplaceResources({
            limit: params.limit,
            search: params.search,
            kind: params.kind,
            sort: "newest",
          });
          if (starter.items.length > 0) {
            items = starter.items;
            hasMore = starter.hasMore;
            nextCursor = null;
          }
        }
        return {
          items,
          libraryEntries: [] as StudioCloudLibraryEntry[],
          ownedReleases: [] as CreatorMarketplaceOwnedRelease[],
          nextCursor,
          hasMore,
        };
      } catch (caught: unknown) {
        if (controller.signal.aborted) throw caught;
        const starter = filterStarterMarketplaceResources({
          limit: params.limit,
          search: params.search,
          kind: params.kind,
          sort: "newest",
        });
        if (starter.items.length > 0) {
          return {
            items: starter.items,
            libraryEntries: [] as StudioCloudLibraryEntry[],
            ownedReleases: [] as CreatorMarketplaceOwnedRelease[],
            nextCursor: null,
            hasMore: starter.hasMore,
          };
        }
        throw caught;
      }
    })()
      .then((page) => {
        if (!isCurrentRequest()) return;
        setRecords(page.items);
        setLibraryEntries(page.libraryEntries);
        setOwnedReleaseById(Object.fromEntries(
          page.ownedReleases.map((release) => [release.resource.id, release]),
        ));
        if (view === "mine") {
          confirmedPublishedRecordRef.current = null;
        }
        setNextCursor(page.nextCursor);
        setHasMore(page.hasMore);
      })
      .catch((caught) => {
        if (!isCurrentRequest()) return;
        const confirmedPublishedRecord = view === "mine"
          ? confirmedPublishedRecordRef.current
          : null;
        setRecords((current) => {
          if (!confirmedPublishedRecord) return [];
          return current.some((record) => record.id === confirmedPublishedRecord.id)
            ? current
            : [confirmedPublishedRecord, ...current];
        });
        setOwnedReleaseById({});
        setLibraryEntries([]);
        setNextCursor(null);
        setHasMore(false);
        setError(
          errorText(
            caught,
            view === "mine"
              ? t("studio.community.error.loadMine")
              : view === "library"
                ? "계정 마켓 라이브러리를 불러오지 못했습니다."
              : t("studio.community.error.loadCommunity"),
          ),
        );
      })
      .finally(() => {
        if (!isCurrentRequest()) return;
        if (listingRequestControllerRef.current === controller) {
          listingRequestControllerRef.current = null;
        }
        setLoading(false);
      });
    return () => {
      controller.abort();
      if (listingRequestControllerRef.current === controller) {
        listingRequestControllerRef.current = null;
      }
      const loadMoreController = loadMoreRequestControllerRef.current;
      loadMoreController?.abort();
      if (loadMoreRequestControllerRef.current === loadMoreController) {
        loadMoreRequestControllerRef.current = null;
      }
      if (listingRequestGenerationRef.current === requestGeneration) {
        listingRequestGenerationRef.current += 1;
      }
    };
  }, [kind, libraryView, open, query, reloadToken, t, view]);

  async function loadMore() {
    const cursor = nextCursor;
    if (!cursor || loading || loadingMore || view === "share") return;
    const requestGeneration = listingRequestGenerationRef.current;
    const controller = new AbortController();
    loadMoreRequestControllerRef.current?.abort();
    loadMoreRequestControllerRef.current = controller;
    const isCurrentRequest = () =>
      !controller.signal.aborted
      && listingRequestGenerationRef.current === requestGeneration;
    setLoadingMore(true);
    setError(null);
    try {
      const params = {
        limit: 12,
        cursor,
        search: query || undefined,
        kind: kind === "all" ? undefined : kind,
      } as const;
      const page = await (async () => {
        if (view === "mine") {
          const ownedPage = await listCreatorMarketplaceOwnedHeads(params, controller.signal);
          return {
            records: ownedPage.items.map((release) => release.resource),
            libraryEntries: [] as StudioCloudLibraryEntry[],
            ownedReleases: ownedPage.items,
            nextCursor: ownedPage.nextCursor,
            hasMore: ownedPage.hasMore,
          };
        }
        if (view === "library") {
          const libraryPage = await loadStudioCloudLibraryEntries({
            view: libraryView,
            limit: 12,
            cursor,
          }, controller.signal);
          return {
            records: libraryPage.entries.flatMap(
              (entry) => entry.record ? [entry.record] : [],
            ),
            libraryEntries: [...libraryPage.entries],
            ownedReleases: [] as CreatorMarketplaceOwnedRelease[],
            nextCursor: libraryPage.nextCursor,
            hasMore: libraryPage.hasMore,
          };
        }
        const publicPage = await listCreatorMarketplaceResources(params, controller.signal);
        return {
          records: publicPage.items,
          libraryEntries: [] as StudioCloudLibraryEntry[],
          ownedReleases: [] as CreatorMarketplaceOwnedRelease[],
          nextCursor: publicPage.nextCursor,
          hasMore: publicPage.hasMore,
        };
      })();
      if (!isCurrentRequest()) return;
      setRecords((current) => [
        ...current,
        ...page.records.filter(
          (item) => !current.some((candidate) => candidate.id === item.id),
        ),
      ]);
      if (page.libraryEntries.length > 0) {
        setLibraryEntries((current) => [
          ...current,
          ...page.libraryEntries.filter(
            (entry) => !current.some(
              (candidate) => candidate.item.id === entry.item.id,
            ),
          ),
        ]);
      }
      if (page.ownedReleases.length > 0) {
        setOwnedReleaseById((current) => ({
          ...current,
          ...Object.fromEntries(
            page.ownedReleases.map((release) => [release.resource.id, release]),
          ),
        }));
      }
      setNextCursor(page.nextCursor);
      setHasMore(page.hasMore);
    } catch (caught) {
      if (!isCurrentRequest()) return;
      setError(errorText(caught, t("studio.community.error.loadMore")));
    } finally {
      if (loadMoreRequestControllerRef.current === controller) {
        loadMoreRequestControllerRef.current = null;
        setLoadingMore(false);
      }
    }
  }

  function transitionMarketplaceView(
    nextView: StudioCommunityMarketplaceView,
    nextRecords: CreatorMarketplaceResourceRecord[] = [],
  ): void {
    libraryFocusRestoreRef.current = null;
    if (nextView === view) {
      setStatus(null);
      setError(null);
      return;
    }
    if (nextView !== "mine") {
      confirmedPublishedRecordRef.current = null;
    }
    listingRequestGenerationRef.current += 1;
    listingRequestControllerRef.current?.abort();
    listingRequestControllerRef.current = null;
    loadMoreRequestControllerRef.current?.abort();
    loadMoreRequestControllerRef.current = null;
    setLoading(nextView !== "share");
    setLoadingMore(false);
    setRecords(nextRecords);
    setLibraryEntries([]);
    setOwnedReleaseById({});
    setNextCursor(null);
    setHasMore(false);
    setView(nextView);
    setStatus(null);
    setError(null);
  }

  function handleMarketplaceTabKeyDown(
    event: ReactKeyboardEvent<HTMLButtonElement>,
    currentView: StudioCommunityMarketplaceView,
  ): void {
    const currentIndex = MARKETPLACE_VIEW_ORDER.indexOf(currentView);
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % MARKETPLACE_VIEW_ORDER.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex = (currentIndex - 1 + MARKETPLACE_VIEW_ORDER.length)
        % MARKETPLACE_VIEW_ORDER.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = MARKETPLACE_VIEW_ORDER.length - 1;
    }
    if (nextIndex === null) return;
    event.preventDefault();
    const nextView = MARKETPLACE_VIEW_ORDER[nextIndex];
    transitionMarketplaceView(nextView);
    marketplaceTabRefs.current[nextView]?.focus();
  }

  async function delistOwnedRelease(
    release: CreatorMarketplaceOwnedRelease,
  ): Promise<boolean> {
    const record = release.resource;
    setStatus(null);
    try {
      await deleteCreatorMarketplaceResource(record.id);
      setOwnedReleaseById((current) => ({
        ...current,
        [record.id]: {
          ...release,
          delistedAt: new Date().toISOString(),
        },
      }));
      setStatus({
        message: `"${record.name}"을(를) 마켓 목록에서 내렸습니다. 카드와 비공개 릴리스 이력은 내 공유 목록에 유지됩니다.`,
        error: false,
      });
      return true;
    } catch (caught) {
      setStatus({
        message: errorText(caught, "공유 리소스를 마켓 목록에서 내리지 못했습니다."),
        error: true,
      });
      return false;
    }
  }

  async function changeCloudLibraryMembership(
    item: CreatorMarketplaceCloudLibraryItem,
    trigger: HTMLButtonElement,
  ): Promise<void> {
    if (libraryMutationId) return;
    libraryFocusRestoreRef.current = document.activeElement === trigger
      ? { itemId: item.id, origin: trigger, target: "action" }
      : null;
    const archived = item.membership === "active";
    const controller = new AbortController();
    libraryMutationControllerRef.current?.abort();
    libraryMutationControllerRef.current = controller;
    setLibraryMutationId(item.id);
    setStatus(null);
    try {
      const receipt = await setCreatorMarketplaceCloudLibraryArchived(
        item.id,
        archived,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      if (
        receipt.libraryItemId !== item.id
        || receipt.logicalPackId !== item.logicalPackId
      ) {
        throw new Error("계정 라이브러리 변경 응답의 패키지 증거가 일치하지 않습니다.");
      }
      setStatus({
        message: receipt.changed
          ? archived
            ? `"${item.name}"을(를) 계정 라이브러리에 보관했습니다. 이 기기의 로컬 설치는 제거하지 않았습니다.`
            : `"${item.name}"을(를) 계정 라이브러리의 활성 목록으로 복원했습니다. 로컬 설치 상태는 별도로 유지됩니다.`
          : archived
            ? `"${item.name}"은(는) 이미 계정 라이브러리에 보관되어 있습니다.`
            : `"${item.name}"은(는) 이미 계정 라이브러리의 활성 목록에 있습니다.`,
        error: false,
      });
      if (receipt.changed && libraryFocusRestoreRef.current) {
        libraryFocusRestoreRef.current = {
          ...libraryFocusRestoreRef.current,
          itemId: item.id,
          target: receipt.membership,
        };
      }
      if (receipt.changed) {
        setReloadToken((value) => value + 1);
      }
    } catch (caught: unknown) {
      if (controller.signal.aborted) return;
      setStatus({
        message: errorText(caught, "계정 라이브러리 보관 상태를 변경하지 못했습니다."),
        error: true,
      });
    } finally {
      if (libraryMutationControllerRef.current === controller) {
        libraryMutationControllerRef.current = null;
        setLibraryMutationId(null);
      }
    }
  }

  function applyRelistReceipt(
    release: CreatorMarketplaceOwnedRelease,
    receipt: CreatorMarketplaceResourceRelistReceipt,
  ): void {
    setOwnedReleaseById((current) => ({
      ...current,
      [release.resource.id]: { ...release, delistedAt: receipt.delistedAt },
    }));
    setStatus({
      message: receipt.changed
        ? `"${release.resource.name}"을(를) 다시 공개했습니다.`
        : `"${release.resource.name}"은(는) 이미 공개 중입니다.`,
      error: false,
    });
  }

  function applySearch(event: FormEvent) {
    event.preventDefault();
    setQuery(queryDraft.trim());
  }

  return (
    <section
      aria-label={t("studio.community.panel.aria")}
      data-studio-community-marketplace
      className="mb-3 overflow-hidden rounded-lg border border-line bg-panel"
    >
      <details
        open={open}
        onToggle={(event) => setOpen(event.currentTarget.open)}
        className="group/community-market"
      >
        <summary className={cx(
          "flex min-h-12 cursor-pointer list-none items-center gap-2.5 px-3 py-2 [&::-webkit-details-marker]:hidden",
          FOCUS,
        )}>
          <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-accent/25 bg-accent-soft text-accent">
            <UserRound size={17} aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <strong className="block text-xs text-fg">{t("studio.community.panel.label")}</strong>
            <span className="mt-0.5 block truncate text-[0.58rem] text-fg-3">
              {t("studio.community.panel.subtitle")}
            </span>
          </span>
          <ChevronDown
            size={15}
            className="shrink-0 text-fg-3 transition-transform group-open/community-market:rotate-180"
            aria-hidden
          />
        </summary>

        {open ? (
          <div className="border-t border-line p-2.5">
            <div role="tablist" aria-label={t("studio.community.panel.tabAria")} className="grid grid-cols-4 gap-1">
              {([
                ["community", t("studio.community.panel.tab.community")],
                ["library", "계정 보관함"],
                ["mine", t("studio.community.panel.tab.mine")],
                ["share", t("studio.community.panel.tab.share")],
              ] as const).map(([id, label]) => (
                <button
                  ref={(button) => {
                    marketplaceTabRefs.current[id] = button;
                  }}
                  key={id}
                  id={`${tabBaseId}-${id}-tab`}
                  type="button"
                  role="tab"
                  aria-selected={view === id}
                  aria-controls={`${tabBaseId}-${id}-panel`}
                  tabIndex={view === id ? 0 : -1}
                  onKeyDown={(event) => handleMarketplaceTabKeyDown(event, id)}
                  onClick={() => {
                    transitionMarketplaceView(id);
                  }}
                  className={cx(
                    "min-h-11 rounded-lg border px-2 text-[0.6rem] font-bold",
                    FOCUS,
                    view === id
                      ? "border-accent bg-accent-soft text-accent"
                      : "border-line bg-card text-fg-2 hover:bg-raised",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            {view === "share" ? (
              <div
                id={`${tabBaseId}-share-panel`}
                role="tabpanel"
                aria-labelledby={`${tabBaseId}-share-tab`}
                className="mt-2"
              >
                <ShareResourceForm
                  onPublished={(published, successMessage) => {
                    confirmedPublishedRecordRef.current = published;
                    transitionMarketplaceView("mine", [published]);
                    setStatus({ message: successMessage, error: false });
                    setReloadToken((value) => value + 1);
                  }}
                />
              </div>
            ) : (
              <div
                id={`${tabBaseId}-${view}-panel`}
                role="tabpanel"
                aria-labelledby={`${tabBaseId}-${view}-tab`}
                className="mt-2"
              >
                {view === "library" ? (
                  <div>
                    <div
                      role="group"
                      aria-label="계정 라이브러리 보기"
                      className="grid grid-cols-2 gap-1"
                    >
                      {([
                        ["active", "활성 항목"],
                        ["archived", "보관 항목"],
                      ] as const).map(([id, label]) => (
                        <button
                          ref={(button) => {
                            libraryViewButtonRefs.current[id] = button;
                          }}
                          key={id}
                          type="button"
                          aria-pressed={libraryView === id}
                          onClick={() => setLibraryView(id)}
                          className={cx(
                            "min-h-11 rounded-lg border px-2 text-[0.6rem] font-bold",
                            FOCUS,
                            libraryView === id
                              ? "border-cool bg-cool/10 text-cool"
                              : "border-line bg-card text-fg-2 hover:bg-raised",
                          )}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <p className="mt-1.5 text-[0.55rem] leading-relaxed text-fg-3">
                      계정 보관 상태는 이 기기의 로컬 설치·제거와 별개입니다. 설치 버튼은 현재 기기의 실제 저장소를 다시 확인합니다.
                    </p>
                  </div>
                ) : (
                  <>
                    <form onSubmit={applySearch} className="grid grid-cols-[minmax(0,1fr)_auto] gap-1.5">
                      <label htmlFor={searchId} className="sr-only">{t("studio.community.panel.searchAria")}</label>
                      <div className="relative">
                        <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-3" aria-hidden />
                        <input
                          id={searchId}
                          type="search"
                          value={queryDraft}
                          onChange={(event) => setQueryDraft(event.target.value)}
                          maxLength={CREATOR_MARKETPLACE_RESOURCE_QUERY_SEARCH_MAX_CHARACTERS}
                          placeholder={t("studio.community.panel.searchPlaceholder")}
                          className={cx("w-full pl-9 pr-11", CONTROL)}
                        />
                        {queryDraft ? (
                          <button
                            type="button"
                            onClick={() => {
                              setQueryDraft("");
                              setQuery("");
                            }}
                            aria-label={t("studio.community.panel.searchClearAria")}
                            className={cx(
                              "absolute right-0 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-lg text-fg-3 hover:bg-raised",
                              FOCUS,
                            )}
                          >
                            <X size={14} aria-hidden />
                          </button>
                        ) : null}
                      </div>
                      <button
                        type="submit"
                        className={PRIMARY}
                      >
                        {t("studio.community.panel.searchAction")}
                      </button>
                    </form>
                    <div className="mt-2 flex gap-1 overflow-x-auto pb-1 [scrollbar-width:thin]">
                      {KIND_OPTIONS.map(({ id, labelKey, labelFallback, Icon }) => (
                        <button
                          key={id}
                          type="button"
                          onClick={() => setKind(id)}
                          aria-pressed={kind === id}
                          className={cx(
                            "inline-flex min-h-11 shrink-0 items-center gap-1 rounded-lg border px-2.5 text-[0.6rem] font-semibold",
                            FOCUS,
                            kind === id
                              ? "border-accent bg-accent-soft text-accent"
                              : "border-line bg-card text-fg-2 hover:bg-raised",
                          )}
                        >
                          <Icon size={12} aria-hidden />
                          {localizeText(t, labelFallback, labelKey)}
                        </button>
                      ))}
                    </div>
                  </>
                )}
                <div className="mt-2 flex items-center justify-between gap-2 text-[0.57rem] text-fg-3">
                  <span>{loading
                    ? t("studio.community.panel.loading")
                    : tText(
                      t,
                      `${view === "library" ? libraryEntries.length : records.length}개 표시`,
                      "studio.community.panel.recordCount",
                      { count: view === "library" ? libraryEntries.length : records.length },
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() => setReloadToken((value) => value + 1)}
                    aria-label={t("studio.community.panel.reloadAria")}
                    className={cx("grid size-11 place-items-center rounded-lg hover:bg-raised", FOCUS)}
                  >
                    <RefreshCw size={14} className={loading ? "animate-spin" : ""} aria-hidden />
                  </button>
                </div>
                {error ? (
                  <div role="alert" className="mt-2 flex items-start gap-2 rounded-lg border border-bad/25 bg-bad/10 p-2.5 text-bad">
                    <CloudOff size={15} className="mt-0.5 shrink-0" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="text-[0.6rem] leading-relaxed">{error}</p>
                      {view === "mine" || view === "library" ? (
                        <p className="mt-1 text-[0.55rem] text-fg-3">{t("studio.community.panel.loginHint")}</p>
                      ) : null}
                    </div>
                  </div>
                ) : null}
                {compatibilityContext === null && !compatibilityIssue ? (
                  <p
                    role="status"
                    className="mt-2 flex items-center gap-2 rounded-lg border border-line bg-card px-2.5 py-2 text-[0.6rem] leading-relaxed text-fg-2"
                  >
                    <LoaderCircle size={14} className="shrink-0 animate-spin" aria-hidden />
                    Studio 버전과 기기 렌더링 엔진을 확인하고 있어요.
                  </p>
                ) : null}
                {compatibilityIssue ? (
                  <div
                    role="alert"
                    className="mt-2 flex items-start gap-2 rounded-lg border border-bad/25 bg-bad/10 p-2.5 text-bad"
                  >
                    <CloudOff size={15} className="mt-0.5 shrink-0" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="text-[0.6rem] leading-relaxed">{compatibilityIssue}</p>
                      <button
                        type="button"
                        onClick={() => setCompatibilityReloadToken((value) => value + 1)}
                        className={cx(
                          "mt-2 min-h-11 rounded-lg border border-current/30 px-3 text-[0.6rem] font-bold hover:bg-bad/10",
                          FOCUS,
                        )}
                      >
                        호환성 다시 확인
                      </button>
                    </div>
                  </div>
                ) : null}
                <div className="mt-2 grid gap-2">
                  {view === "library"
                    ? libraryEntries.map((entry) => entry.record ? (
                        <CommunityRecordCard
                          key={entry.item.id}
                          record={entry.record}
                          cloudLibraryItem={entry.item}
                          compatibilityContext={compatibilityContext}
                          onUseAsset={onUseAsset}
                          refreshToken={refreshToken}
                          onStatus={reportRecordStatus}
                          onInstallStateChanged={refreshInstallStates}
                          onCloudChanged={() => setReloadToken((value) => value + 1)}
                          cloudMembershipPending={libraryMutationId === entry.item.id}
                          cloudMembershipButtonRef={(button) => {
                            if (button) {
                              libraryMembershipButtonRefs.current.set(entry.item.id, button);
                            } else {
                              libraryMembershipButtonRefs.current.delete(entry.item.id);
                            }
                          }}
                          onCloudMembershipChange={(item, trigger) => {
                            void changeCloudLibraryMembership(item, trigger);
                          }}
                        />
                      ) : (
                        <StudioCloudLibraryUnavailableCard
                          key={entry.item.id}
                          entry={entry}
                          membershipPending={libraryMutationId === entry.item.id}
                          membershipButtonRef={(button) => {
                            if (button) {
                              libraryMembershipButtonRefs.current.set(entry.item.id, button);
                            } else {
                              libraryMembershipButtonRefs.current.delete(entry.item.id);
                            }
                          }}
                          onMembershipChange={(item, trigger) => {
                            void changeCloudLibraryMembership(item, trigger);
                          }}
                        />
                      ))
                    : records.map((record) => (
                        <CommunityRecordCard
                          key={record.id}
                          record={record}
                          compatibilityContext={compatibilityContext}
                          onUseAsset={onUseAsset}
                          ownedRelease={ownedReleaseById[record.id]}
                          onDelist={ownedReleaseById[record.id]
                            ? delistOwnedRelease
                            : undefined}
                          onRelisted={ownedReleaseById[record.id]
                            ? applyRelistReceipt
                            : undefined}
                          refreshToken={refreshToken}
                          onStatus={reportRecordStatus}
                          onInstallStateChanged={refreshInstallStates}
                        />
                      ))}
                </div>
                {!loading
                  && !error
                  && (view === "library" ? libraryEntries.length === 0 : records.length === 0) ? (
                  <p role="status" className="mt-2 rounded-lg border border-dashed border-line px-3 py-5 text-center text-xs text-fg-3">
                    {view === "library"
                      ? libraryView === "active"
                        ? "계정 라이브러리의 활성 항목이 없습니다. 공개 마켓 상세에서 먼저 추가하세요."
                        : "계정 라이브러리에 보관된 항목이 없습니다."
                      : t("studio.community.panel.empty")}
                  </p>
                ) : null}
                {hasMore && !loading ? (
                  <button
                    type="button"
                    onClick={() => void loadMore()}
                    disabled={loadingMore}
                    className={cx("mt-2 w-full", CONTROL)}
                  >
                    {loadingMore
                      ? <LoaderCircle size={14} className="mr-1 inline animate-spin" aria-hidden />
                      : null}
                    {t("studio.community.panel.loadMore")}
                  </button>
                ) : null}
              </div>
            )}
            {status ? (
              <p
                role={status.error ? "alert" : "status"}
                className={cx(
                  "mt-2 rounded-lg border px-2.5 py-2 text-[0.6rem] leading-relaxed",
                  status.error
                    ? "border-bad/25 bg-bad/10 text-bad"
                    : "border-good/25 bg-good/10 text-good",
                )}
              >
                {status.message}
              </p>
            ) : null}
          </div>
        ) : null}
      </details>
    </section>
  );
}
