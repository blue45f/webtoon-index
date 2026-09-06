import {
  BadgeCheck,
  Check,
  ChevronDown,
  CloudOff,
  Eye,
  FileJson2,
  Filter,
  Grip,
  Library,
  PackageOpen,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import {
  useId,
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type ReactElement,
  type RefObject,
} from "react";

import { writeStudioAssetDragPayload } from "./studio-insert-drag-writer";
import {
  getProductStudioMarketplaceLibrarySqliteRepository,
  type StudioMarketplaceLibrarySqliteRepository,
} from "./studio-marketplace-library-sqlite-repository";
import {
  STUDIO_MARKETPLACE_REDISTRIBUTION_NOTICE,
  cloneStudioMarketplacePackageToLibrary,
  createStudioMarketplaceShareManifest,
  filterStudioMarketplacePackages,
  removeStudioMarketplacePackageFromLibrary,
  resolveStudioMarketplaceImport,
  type StudioMarketplaceAccessModel,
  type StudioMarketplaceLibraryState,
} from "./studio-marketplace-packages";
import {
  STUDIO_ORIGINAL_FREE_ASSET_PACKAGES,
  createStudioOriginalFreeAssetRecord,
  encodeStudioOriginalAssetSvg,
  filterStudioOriginalFreeAssets,
  findStudioOriginalFreeAssetPackage,
  type StudioOriginalFreeAsset,
  type StudioOriginalFreeAssetCategory,
  type StudioOriginalFreeAssetPackage,
} from "./studio-original-free-asset-packs";
import { serializeStudioLocalAssetDragPayload } from "./studio-shared-asset-drag";
import { useStudioModalSheet } from "./useStudioModalSheet";

import type { StudioAsset } from "./studio-asset-library";

import { cx } from "@/shared/lib/cx";

const CONTROL_FOCUS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-panel";
const CONTROL =
  `min-h-11 rounded-lg border border-line bg-card px-2.5 text-[0.65rem] font-semibold text-fg-2 transition-colors hover:border-line-strong hover:bg-raised ${CONTROL_FOCUS}`;
const PRIMARY_CONTROL =
  `min-h-11 rounded-lg bg-accent px-3 text-[0.65rem] font-bold text-on-accent transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50 ${CONTROL_FOCUS}`;

const CATEGORY_FILTERS: readonly {
  id: StudioOriginalFreeAssetCategory;
  label: string;
}[] = [
  { id: "modern-background", label: "현대 배경" },
  { id: "daily-prop", label: "생활 소품" },
  { id: "atmosphere-fx", label: "자연·효과" },
  { id: "genre-prop", label: "장르 소품" },
];

const ACCESS_FILTERS: readonly {
  id: StudioMarketplaceAccessModel | "all";
  label: string;
}[] = [
  { id: "all", label: "전체" },
  { id: "free", label: "무료" },
  { id: "paid", label: "유료" },
  { id: "subscription", label: "구독" },
];

type LibraryView = "catalog" | "library" | "updates";
interface MarketplaceStatus {
  readonly message: string;
  readonly error: boolean;
}

export interface StudioOriginalAssetMarketplacePanelProps {
  readonly onUseAsset: (asset: StudioAsset) => boolean;
  /** Useful for a dedicated asset-market route; compact toolbar embedding stays lazy by default. */
  readonly initialOpen?: boolean;
  /** Test/embed seam. Product code leaves this undefined and uses shared V12 SQLite/OPFS. */
  readonly libraryRepository?: StudioMarketplaceLibrarySqliteRepository;
}

function dragOriginalAsset(
  event: DragEvent<HTMLElement>,
  asset: StudioOriginalFreeAsset
) {
  writeStudioAssetDragPayload(
    event.dataTransfer,
    serializeStudioLocalAssetDragPayload({
      src: encodeStudioOriginalAssetSvg(asset.svg),
      width: asset.width,
      height: asset.height,
    })
  );
}

function PackageAccessBadge({
  pkg,
}: {
  readonly pkg: StudioOriginalFreeAssetPackage;
}) {
  return (
    <span className="inline-flex min-h-6 items-center rounded-full border border-good/35 bg-good/10 px-2 text-[0.58rem] font-bold text-good">
      {pkg.accessLabel}
    </span>
  );
}

function PackageLibraryButton({
  pkg,
  library,
  onLibraryChange,
}: {
  readonly pkg: StudioOriginalFreeAssetPackage;
  readonly library: StudioMarketplaceLibraryState;
  readonly onLibraryChange: (state: StudioMarketplaceLibraryState, message: string) => void;
}) {
  const installed = library.packages.find((entry) => entry.packageId === pkg.id);
  const resolution = resolveStudioMarketplaceImport(pkg, installed);
  const installedExact = resolution.status === "duplicate";

  if (installedExact) {
    return (
      <button
        type="button"
        onClick={() => onLibraryChange(
          removeStudioMarketplacePackageFromLibrary(library, pkg.id),
          `${pkg.name}을(를) 이 기기의 스타터 라이브러리에서 제거했습니다.`
        )}
        className={cx(CONTROL, "inline-flex flex-1 items-center justify-center gap-1.5")}
        aria-label={`${pkg.name} 로컬 라이브러리에서 제거`}
      >
        <Trash2 size={13} aria-hidden />
        저장됨 · 제거
      </button>
    );
  }

  return (
    <button
      type="button"
      disabled={resolution.recommendedAction === "block"}
      title={resolution.message}
      onClick={() => onLibraryChange(
        cloneStudioMarketplacePackageToLibrary(library, pkg),
        resolution.status === "update"
          ? `${pkg.name}을(를) ${pkg.version}(으)로 업데이트했습니다.`
          : `${pkg.name}을(를) 이 기기의 스타터 라이브러리에 추가했습니다.`
      )}
      className={cx(
        PRIMARY_CONTROL,
        "inline-flex flex-1 items-center justify-center gap-1.5"
      )}
      aria-label={`${pkg.name} ${resolution.status === "update" ? "업데이트" : "로컬 라이브러리에 추가"}`}
    >
      {resolution.status === "update"
        ? <RefreshCw size={13} aria-hidden />
        : <Library size={13} aria-hidden />}
      {resolution.status === "update" ? "업데이트" : "내 라이브러리"}
    </button>
  );
}

function OriginalAssetTile({
  asset,
  onUse,
  onPreview,
  helpId,
}: {
  readonly asset: StudioOriginalFreeAsset;
  readonly onUse: (asset: StudioOriginalFreeAsset) => void;
  readonly onPreview: (asset: StudioOriginalFreeAsset) => void;
  readonly helpId: string;
}) {
  return (
    <article
      data-studio-original-asset={asset.id}
      className="group min-w-0 overflow-hidden rounded-lg border border-line bg-card transition-colors hover:border-accent/45"
    >
      <button
        type="button"
        onClick={() => onPreview(asset)}
        draggable
        onDragStart={(event) => dragOriginalAsset(event, asset)}
        aria-describedby={helpId}
        aria-label={`${asset.name} 상세 미리보기. 캔버스로 끌어 배치할 수 있습니다.`}
        className={cx(
          "relative block aspect-[4/3] w-full overflow-hidden bg-[oklch(0.94_0.01_78)]",
          CONTROL_FOCUS
        )}
      >
        <img
          src={encodeStudioOriginalAssetSvg(asset.svg)}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          className="size-full object-contain transition-transform duration-200 group-hover:scale-[1.025] motion-reduce:transition-none"
        />
        <span className="absolute left-1.5 top-1.5 inline-flex min-h-6 items-center rounded-full border border-good/35 bg-panel/95 px-2 text-[0.55rem] font-black text-good">
          FREE
        </span>
        <span className="absolute right-1.5 top-1.5 grid size-8 place-items-center rounded-md border border-line bg-panel/95 text-fg-2">
          <Eye size={13} aria-hidden />
        </span>
        <span className="absolute bottom-1.5 right-1.5 inline-flex min-h-7 items-center gap-1 rounded-md border border-line bg-panel/95 px-2 text-[0.55rem] font-semibold text-fg-2">
          <Grip size={11} aria-hidden />
          끌어 놓기
        </span>
      </button>
      <div className="p-2">
        <p className="truncate text-[0.66rem] font-bold text-fg">{asset.name}</p>
        <p className="mt-0.5 truncate text-[0.55rem] text-fg-3">
          원본 절차형 · CC0 · SVG
        </p>
        <button
          type="button"
          onClick={() => onUse(asset)}
          aria-label={`${asset.name} 선택한 컷 또는 현재 보이는 위치에 추가`}
          className={cx(
            PRIMARY_CONTROL,
            "mt-2 inline-flex w-full items-center justify-center gap-1.5"
          )}
        >
          <Plus size={13} aria-hidden />
          현재 화면에 추가
        </button>
      </div>
    </article>
  );
}

function AssetPreviewDialog({
  asset,
  pkg,
  dialogRef,
  onUse,
  onClose,
}: {
  readonly asset: StudioOriginalFreeAsset;
  readonly pkg: StudioOriginalFreeAssetPackage;
  readonly dialogRef: RefObject<HTMLElement | null>;
  readonly onUse: (asset: StudioOriginalFreeAsset) => boolean;
  readonly onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[130] grid place-items-center bg-[oklch(0.10_0.008_70/0.78)] p-3">
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        data-studio-modal-backdrop="true"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="original-asset-preview-title"
        tabIndex={-1}
        className="relative max-h-[92dvh] w-full max-w-xl overflow-y-auto rounded-lg border border-line bg-panel shadow-2xl"
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-line bg-panel/95 px-4 py-3 backdrop-blur">
          <div className="min-w-0">
            <h3 id="original-asset-preview-title" className="truncate text-sm font-black text-fg">
              {asset.name}
            </h3>
            <p className="mt-0.5 truncate text-[0.65rem] text-fg-3">
              {pkg.name} · v{pkg.version}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            data-autofocus="true"
            className={cx(CONTROL, "grid size-11 shrink-0 place-items-center p-0")}
            aria-label="무료 에셋 상세 미리보기 닫기"
          >
            <X size={16} aria-hidden />
          </button>
        </div>

        <div className="grid gap-4 p-4 sm:grid-cols-[minmax(0,1.35fr)_minmax(12rem,.65fr)]">
          <div
            draggable
            onDragStart={(event) => dragOriginalAsset(event, asset)}
            className="relative grid min-h-64 place-items-center overflow-hidden rounded-lg border border-line bg-[oklch(0.94_0.01_78)] p-3"
          >
            <img
              src={encodeStudioOriginalAssetSvg(asset.svg)}
              alt={`${asset.name} 벡터 미리보기`}
              draggable={false}
              className="max-h-[28rem] size-full object-contain"
            />
            <span className="absolute bottom-2 right-2 inline-flex min-h-8 items-center gap-1 rounded-md border border-line bg-panel/95 px-2 text-[0.6rem] font-semibold text-fg-2">
              <Grip size={12} aria-hidden />
              포인터 위치로 끌기
            </span>
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap gap-1.5">
              <PackageAccessBadge pkg={pkg} />
              <span className="inline-flex min-h-6 items-center rounded-full border border-line bg-card px-2 text-[0.58rem] font-bold text-fg-2">
                CC0
              </span>
              <span className="inline-flex min-h-6 items-center rounded-full border border-line bg-card px-2 text-[0.58rem] font-bold text-fg-2">
                SVG
              </span>
            </div>
            <dl className="mt-3 grid gap-2 text-[0.65rem]">
              <div>
                <dt className="font-semibold text-fg-3">제작·출처</dt>
                <dd className="mt-0.5 text-fg-2">ToonSpectrum Lab · original-procedural</dd>
              </div>
              <div>
                <dt className="font-semibold text-fg-3">사용권</dt>
                <dd className="mt-0.5 leading-relaxed text-fg-2">
                  상업 작품 사용·수정·재배포 가능, 저작자 표시 불필요
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-fg-3">호환</dt>
                <dd className="mt-0.5 text-fg-2">Canvas 2D · SVG · 데스크톱·태블릿·모바일</dd>
              </div>
              <div>
                <dt className="font-semibold text-fg-3">권장 배치</dt>
                <dd className="mt-0.5 text-fg-2">
                  {asset.placementPresets.includes("background-cover")
                    ? "배경 덮기 또는 현재 화면"
                    : "포인터 위치 또는 현재 화면"}
                </dd>
              </div>
            </dl>
            <button
              type="button"
              onClick={() => onUse(asset)}
              className={cx(
                PRIMARY_CONTROL,
                "mt-4 inline-flex w-full items-center justify-center gap-1.5"
              )}
            >
              <Plus size={14} aria-hidden />
              현재 화면에 추가
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

export function StudioOriginalAssetMarketplacePanel({
  onUseAsset,
  initialOpen = false,
  libraryRepository,
}: StudioOriginalAssetMarketplacePanelProps): ReactElement {
  const marketplaceRootRef = useRef<HTMLElement>(null);
  const previewDialogRef = useRef<HTMLElement>(null);
  const operationGenerationRef = useRef(0);
  const [repository] = useState(
    () => libraryRepository ?? getProductStudioMarketplaceLibrarySqliteRepository(),
  );
  const placementHelpId = useId();
  const statusId = useId();
  const [query, setQuery] = useState("");
  const [marketOpen, setMarketOpen] = useState(initialOpen);
  const [selectedPackageId, setSelectedPackageId] = useState<string>("all");
  const [selectedCategories, setSelectedCategories] = useState<
    StudioOriginalFreeAssetCategory[]
  >([]);
  const [access, setAccess] = useState<StudioMarketplaceAccessModel | "all">("all");
  const [libraryView, setLibraryView] = useState<LibraryView>("catalog");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [previewAsset, setPreviewAsset] = useState<StudioOriginalFreeAsset | null>(null);
  const [library, setLibrary] = useState<StudioMarketplaceLibraryState>({
    version: 1,
    packages: [],
  });
  const [status, setStatus] = useState<MarketplaceStatus | null>(null);

  useEffect(() => {
    const generation = ++operationGenerationRef.current;
    void repository.list().then((persisted) => {
      if (operationGenerationRef.current !== generation) return;
      setLibrary(persisted);
    }).catch((error: unknown) => {
      if (operationGenerationRef.current !== generation) return;
      setStatus({
        message: `SQLite 라이브러리를 열지 못했습니다. 설치 상태를 저장 가능한 것으로 표시하지 않습니다: ${
          error instanceof Error ? error.message : String(error)
        }`,
        error: true,
      });
    });
    return () => {
      if (operationGenerationRef.current === generation) {
        operationGenerationRef.current += 1;
      }
    };
  }, [repository]);

  useStudioModalSheet({
    activeKey: previewAsset ? `original-asset-preview:${previewAsset.id}` : null,
    dialogRef: previewDialogRef,
    onDismiss: () => setPreviewAsset(null),
    resolveInitialFocus: (dialog) =>
      dialog.querySelector<HTMLElement>("[data-autofocus='true']"),
    rootRef: marketplaceRootRef,
  });

  const libraryPackageIds = library.packages.map((entry) => entry.packageId);
  const filteredPackages = filterStudioMarketplacePackages(
    STUDIO_ORIGINAL_FREE_ASSET_PACKAGES,
    {
      query,
      access: access === "all" ? [] : [access],
      libraryPackageIds,
      libraryOnly: libraryView === "library",
      updateOnly: libraryView === "updates",
      installed: library.packages,
    }
  ) as StudioOriginalFreeAssetPackage[];
  const visiblePackageIds = filteredPackages
    .map((pkg) => pkg.id)
    .filter((id) => selectedPackageId === "all" || id === selectedPackageId);
  const visibleAssets = filterStudioOriginalFreeAssets({
    query,
    packageIds: visiblePackageIds.length > 0
      ? visiblePackageIds
      : selectedPackageId === "all"
        ? filteredPackages.map((pkg) => pkg.id)
        : ["__no-match__"],
    categories: selectedCategories,
  });
  const previewPackage = previewAsset
    ? findStudioOriginalFreeAssetPackage(previewAsset.packageId)
    : null;
  const updateCount = STUDIO_ORIGINAL_FREE_ASSET_PACKAGES.filter((pkg) => {
    const installed = library.packages.find((entry) => entry.packageId === pkg.id);
    return resolveStudioMarketplaceImport(pkg, installed).status === "update";
  }).length;

  const handleLibraryChange = (
    nextState: StudioMarketplaceLibraryState,
    message: string
  ) => {
    const nextIds = new Set(nextState.packages.map((entry) => entry.packageId));
    const removedPackageIds = library.packages
      .filter((entry) => !nextIds.has(entry.packageId))
      .map((entry) => entry.packageId);
    const previous = library;
    const generation = ++operationGenerationRef.current;
    setLibrary(nextState);
    void repository.save(nextState, { removedPackageIds }).then((persisted) => {
      if (operationGenerationRef.current !== generation) return;
      setLibrary(persisted);
      setStatus({ message, error: false });
    }).catch((error: unknown) => {
      if (operationGenerationRef.current !== generation) return;
      setLibrary(previous);
      setStatus({
        message: `SQLite/OPFS에 기록하지 못해 설치 상태를 되돌렸습니다: ${
          error instanceof Error ? error.message : String(error)
        }`,
        error: true,
      });
    });
  };

  const handleUse = (asset: StudioOriginalFreeAsset): boolean => {
    const added = onUseAsset(createStudioOriginalFreeAssetRecord(asset));
    setStatus({
      message: added
        ? `${asset.name}을(를) 선택한 컷 또는 현재 보이는 위치에 추가했습니다.`
        : `${asset.name}을(를) 추가하지 못했습니다. 캔버스 상태를 확인하고 다시 시도하세요.`,
      error: !added,
    });
    return added;
  };

  const toggleCategory = (category: StudioOriginalFreeAssetCategory) => {
    setSelectedCategories((current) => current.includes(category)
      ? current.filter((candidate) => candidate !== category)
      : [...current, category]);
  };

  const downloadManifest = (pkg: StudioOriginalFreeAssetPackage) => {
    if (typeof document === "undefined" || typeof URL === "undefined") return;
    let url: string | null = null;
    let anchor: HTMLAnchorElement | null = null;
    try {
      const manifest = createStudioMarketplaceShareManifest(pkg);
      const blob = new Blob([JSON.stringify(manifest, null, 2)], {
        type: "application/json",
      });
      url = URL.createObjectURL(blob);
      anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${pkg.id}-${pkg.version}.manifest.json`;
      document.body.append(anchor);
      anchor.click();
      setStatus({
        message: `${pkg.name}의 메타데이터 전용 로컬 명세를 내보냈습니다. 에셋 파일은 포함되지 않습니다.`,
        error: false,
      });
    } catch {
      setStatus({
        message: `${pkg.name} 명세를 내보내지 못했습니다. 브라우저 다운로드 권한을 확인하고 다시 시도하세요.`,
        error: true,
      });
    } finally {
      anchor?.remove();
      if (url) URL.revokeObjectURL(url);
    }
  };

  return (
    <section
      ref={marketplaceRootRef}
      aria-label="ToonSpectrum 독자 무료 스타터 마켓"
      data-studio-original-marketplace="local-phase-1"
      className="mb-3 overflow-hidden rounded-lg border border-line bg-panel"
    >
      <details
        open={marketOpen}
        onToggle={(event) => {
          const open = event.currentTarget.open;
          setMarketOpen(open);
          if (!open) setPreviewAsset(null);
        }}
        className="group/market"
      >
        <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2.5 px-3 py-2 [&::-webkit-details-marker]:hidden">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-accent/25 bg-accent-soft text-accent">
            <PackageOpen size={17} aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-1.5">
              <strong className="text-xs text-fg">독자 무료 스타터 마켓</strong>
              <span className="rounded-full border border-good/35 bg-good/10 px-2 py-0.5 text-[0.55rem] font-black text-good">
                {`${STUDIO_ORIGINAL_FREE_ASSET_PACKAGES.reduce((count, pkg) => count + pkg.includedItems.length, 0)} FREE`}
              </span>
            </span>
            <span className="mt-0.5 block truncate text-[0.58rem] text-fg-3">
              ToonSpectrum 원본 SVG · 기기 로컬
            </span>
          </span>
          <ChevronDown
            size={15}
            className="shrink-0 text-fg-3 transition-transform group-open/market:rotate-180 motion-reduce:transition-none"
            aria-hidden
          />
        </summary>

      {marketOpen ? (
        <>
      <header className="border-t border-line px-3 py-3">
        <div className="flex items-start gap-2.5">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-good/25 bg-good/10 text-good">
            <ShieldCheck size={17} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <h3 className="text-xs font-black text-fg">로컬 원본 카탈로그</h3>
              <span className="rounded-full border border-line bg-card px-2 py-0.5 text-[0.55rem] font-semibold text-fg-3">
                LOCAL PHASE 1
              </span>
            </div>
            <p className="mt-1 text-[0.62rem] leading-relaxed text-fg-3">
              선택 가능한 원본 SVG는 외부 마켓 상품을 복제하지 않은 ToonSpectrum 자체 에셋입니다. 결제·클라우드 동기화 없이 이 기기에서 즉시 배치합니다.
            </p>
          </div>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-1 rounded-lg border border-accent/20 bg-accent-soft/35 p-1.5 text-[0.58rem] leading-snug text-fg-2">
          <span id={placementHelpId} className="flex min-h-11 items-center gap-1.5 rounded-md bg-panel/70 px-2">
            <Plus size={12} className="shrink-0 text-accent" aria-hidden />
            <span><strong className="font-bold text-fg">클릭·탭</strong><br />선택 컷·현재 화면</span>
          </span>
          <span className="flex min-h-11 items-center gap-1.5 rounded-md bg-panel/70 px-2">
            <Grip size={12} className="shrink-0 text-accent" aria-hidden />
            <span><strong className="font-bold text-fg">끌어 놓기</strong><br />포인터 위치에 배치</span>
          </span>
        </div>
      </header>

      <div className="border-b border-line p-2.5">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-1.5">
          <div className="relative">
            <Search
              size={13}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-3"
              aria-hidden
            />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value.slice(0, 120))}
              placeholder="배경·소품·날씨·장르 검색"
              aria-label="독자 무료 스타터 에셋 검색"
              className={cx(
                CONTROL,
                "w-full pl-8 pr-10 font-normal text-fg placeholder:text-fg-3"
              )}
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                className={cx(
                  "absolute right-0 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-lg text-fg-3 hover:bg-raised",
                  CONTROL_FOCUS
                )}
                aria-label="독자 무료 스타터 에셋 검색어 지우기"
              >
                <X size={14} aria-hidden />
              </button>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => setFiltersOpen((current) => !current)}
            aria-expanded={filtersOpen}
            aria-controls="studio-original-marketplace-filters"
            className={cx(
              CONTROL,
              "inline-flex items-center justify-center gap-1.5",
              filtersOpen && "border-accent bg-accent-soft text-accent"
            )}
          >
            <Filter size={13} aria-hidden />
            필터
            {selectedCategories.length > 0 ? (
              <span className="grid size-5 place-items-center rounded-full bg-accent text-[0.55rem] text-on-accent">
                {selectedCategories.length}
              </span>
            ) : null}
          </button>
        </div>

        <div
          id="studio-original-marketplace-filters"
          hidden={!filtersOpen}
          className="mt-2 rounded-lg border border-line bg-card p-2"
        >
          <p className="text-[0.58rem] font-bold text-fg-3">카테고리 · 복수 선택</p>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {CATEGORY_FILTERS.map((category) => {
              const selected = selectedCategories.includes(category.id);
              return (
                <button
                  key={category.id}
                  type="button"
                  onClick={() => toggleCategory(category.id)}
                  aria-pressed={selected}
                  className={cx(
                    "inline-flex min-h-11 items-center gap-1 rounded-md border px-2 text-[0.6rem] font-semibold transition-colors",
                    CONTROL_FOCUS,
                    selected
                      ? "border-accent bg-accent-soft text-accent"
                      : "border-line bg-panel text-fg-2 hover:bg-raised"
                  )}
                >
                  {selected ? <Check size={11} aria-hidden /> : null}
                  {category.label}
                </button>
              );
            })}
          </div>
          <label className="mt-2 block text-[0.58rem] font-bold text-fg-3">
            이용 방식
            <select
              value={access}
              onChange={(event) => setAccess(
                event.target.value as StudioMarketplaceAccessModel | "all"
              )}
              className={cx(CONTROL, "mt-1 w-full font-normal")}
            >
              {ACCESS_FILTERS.map((option) => {
                const count = option.id === "all"
                  ? STUDIO_ORIGINAL_FREE_ASSET_PACKAGES.length
                  : STUDIO_ORIGINAL_FREE_ASSET_PACKAGES.filter(
                    (pkg) => pkg.access === option.id
                  ).length;
                return (
                  <option key={option.id} value={option.id}>
                    {option.label} ({count})
                  </option>
                );
              })}
            </select>
          </label>
          <p className="mt-1 text-[0.55rem] leading-relaxed text-fg-3">
            유료·구독 필터는 공통 마켓 모델과 배지 규칙만 준비되어 있습니다. 현재 번들에는 결제 상품이 없으며 결제 기능도 비활성입니다.
          </p>
        </div>

        <div className="mt-2 grid grid-cols-3 gap-1 rounded-lg border border-line bg-card p-1">
          {([
            ["catalog", "전체", STUDIO_ORIGINAL_FREE_ASSET_PACKAGES.length],
            ["library", "내 라이브러리", library.packages.length],
            ["updates", "업데이트", updateCount],
          ] as const).map(([id, label, count]) => (
            <button
              key={id}
              type="button"
              onClick={() => setLibraryView(id)}
              aria-pressed={libraryView === id}
              className={cx(
                "min-h-11 rounded-md px-1 text-[0.58rem] font-semibold transition-colors",
                CONTROL_FOCUS,
                libraryView === id
                  ? "bg-raised text-fg"
                  : "text-fg-3 hover:bg-raised/70"
              )}
            >
              {label} <span className="tabular-nums">({count})</span>
            </button>
          ))}
        </div>
      </div>

      <div className="border-b border-line p-2.5">
        <div className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:thin]">
          <button
            type="button"
            onClick={() => setSelectedPackageId("all")}
            aria-pressed={selectedPackageId === "all"}
            className={cx(
              "min-h-11 shrink-0 rounded-lg border px-3 text-[0.62rem] font-semibold transition-colors",
              CONTROL_FOCUS,
              selectedPackageId === "all"
                ? "border-accent bg-accent-soft text-accent"
                : "border-line bg-card text-fg-2 hover:bg-raised"
            )}
          >
            모든 팩 · {filteredPackages.length}
          </button>
          {filteredPackages.map((pkg) => (
            <button
              key={pkg.id}
              type="button"
              onClick={() => setSelectedPackageId(pkg.id)}
              aria-pressed={selectedPackageId === pkg.id}
              className={cx(
                "min-h-11 shrink-0 rounded-lg border px-3 text-left transition-colors",
                CONTROL_FOCUS,
                selectedPackageId === pkg.id
                  ? "border-accent bg-accent-soft"
                  : "border-line bg-card hover:bg-raised"
              )}
            >
              <span className="block text-[0.62rem] font-bold text-fg">{pkg.name}</span>
              <span className="mt-0.5 block text-[0.54rem] text-fg-3">
                {pkg.includedItems.length}개 · v{pkg.version}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="p-2.5">
        {filteredPackages.map((pkg) => {
          if (selectedPackageId !== "all" && selectedPackageId !== pkg.id) return null;
          const installed = library.packages.find((entry) => entry.packageId === pkg.id);
          const importResolution = resolveStudioMarketplaceImport(pkg, installed);
          return (
            <details
              key={pkg.id}
              open={selectedPackageId === pkg.id}
              className="group/package mb-2 rounded-lg border border-line bg-card last:mb-0"
            >
              <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-2.5 py-2 [&::-webkit-details-marker]:hidden">
                <span className="grid size-8 shrink-0 place-items-center rounded-md bg-raised text-accent">
                  <PackageOpen size={14} aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <strong className="truncate text-[0.66rem] text-fg">{pkg.name}</strong>
                    <PackageAccessBadge pkg={pkg} />
                    {installed ? (
                      <span className="inline-flex min-h-6 items-center gap-1 rounded-full border border-cool/35 bg-cool/10 px-2 text-[0.55rem] font-semibold text-cool">
                        <Check size={10} aria-hidden />
                        로컬
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-0.5 block truncate text-[0.55rem] text-fg-3">
                    ToonSpectrum Lab · v{pkg.version} · {pkg.includedItems.length}개
                  </span>
                </span>
                <ChevronDown
                  size={14}
                  className="shrink-0 text-fg-3 transition-transform group-open/package:rotate-180 motion-reduce:transition-none"
                  aria-hidden
                />
              </summary>
              <div className="border-t border-line p-2.5">
                <p className="text-[0.62rem] leading-relaxed text-fg-2">{pkg.summary}</p>
                <dl className="mt-2 grid grid-cols-2 gap-1 text-[0.57rem]">
                  <div className="rounded-md bg-panel px-2 py-1.5">
                    <dt className="font-semibold text-fg-3">출처·라이선스</dt>
                    <dd className="mt-0.5 text-fg-2">original-procedural · CC0</dd>
                  </div>
                  <div className="rounded-md bg-panel px-2 py-1.5">
                    <dt className="font-semibold text-fg-3">호환</dt>
                    <dd className="mt-0.5 text-fg-2">Canvas 2D · SVG · 모든 기기</dd>
                  </div>
                  <div className="rounded-md bg-panel px-2 py-1.5">
                    <dt className="font-semibold text-fg-3">업데이트 상태</dt>
                    <dd className="mt-0.5 text-fg-2">
                      {importResolution.status === "duplicate"
                        ? "최신"
                        : importResolution.status === "update"
                          ? `${installed?.version} → ${pkg.version}`
                          : "미설치"}
                    </dd>
                  </div>
                  <div className="rounded-md bg-panel px-2 py-1.5">
                    <dt className="font-semibold text-fg-3">저장 경계</dt>
                    <dd className="mt-0.5 text-fg-2">기기 로컬 · 클라우드 미지원</dd>
                  </div>
                </dl>
                <div className="mt-2 rounded-md bg-panel px-2 py-1.5">
                  <p className="text-[0.57rem] font-semibold text-fg-3">v{pkg.version} 변경 사항</p>
                  <p className="mt-0.5 text-[0.57rem] leading-relaxed text-fg-2">
                    {pkg.changelog[0]?.changes.join(" · ")}
                  </p>
                </div>
                <div className="mt-2 flex gap-1.5">
                  <PackageLibraryButton
                    pkg={pkg}
                    library={library}
                    onLibraryChange={handleLibraryChange}
                  />
                  <button
                    type="button"
                    onClick={() => downloadManifest(pkg)}
                    title="에셋 파일이 아닌 버전·권리·호환 메타데이터만 JSON으로 내보냅니다."
                    className={cx(CONTROL, "inline-flex items-center justify-center gap-1.5")}
                    aria-label={`${pkg.name} 메타데이터 전용 로컬 명세 내보내기`}
                  >
                    <FileJson2 size={13} aria-hidden />
                    명세
                  </button>
                </div>
              </div>
            </details>
          );
        })}

        {visibleAssets.length > 0 ? (
          <>
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-[0.62rem] font-bold text-fg-2">
                배치 가능한 원본 <span className="tabular-nums text-accent">{visibleAssets.length}</span>
              </p>
              <p className="text-[0.55rem] text-fg-3">클릭 또는 드래그</p>
            </div>
            <div className="grid max-h-[30rem] grid-cols-2 gap-2 overflow-y-auto overscroll-contain pr-0.5 [scrollbar-width:thin]">
              {visibleAssets.map((asset) => (
                <OriginalAssetTile
                  key={asset.id}
                  asset={asset}
                  onUse={handleUse}
                  onPreview={setPreviewAsset}
                  helpId={placementHelpId}
                />
              ))}
            </div>
          </>
        ) : (
          <div
            role="status"
            className="grid min-h-32 place-items-center rounded-lg border border-dashed border-line bg-card/55 px-4 text-center"
          >
            <div>
              <Search size={20} className="mx-auto text-fg-3" aria-hidden />
              <p className="mt-2 text-xs font-bold text-fg-2">
                조건에 맞는 원본 에셋이 없습니다
              </p>
              <p className="mt-1 text-[0.6rem] leading-relaxed text-fg-3">
                검색어·카테고리·라이브러리 보기를 바꿔보세요.
              </p>
            </div>
          </div>
        )}

        <details className="group/rights mt-3 rounded-lg border border-warn/25 bg-warn/5">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-2.5 text-[0.62rem] font-bold text-warn [&::-webkit-details-marker]:hidden">
            <ShieldCheck size={14} aria-hidden />
            업로드·공유 권리 체크
            <ChevronDown size={13} className="ml-auto transition-transform group-open/rights:rotate-180" aria-hidden />
          </summary>
          <div className="border-t border-warn/20 px-2.5 py-2 text-[0.58rem] leading-relaxed text-fg-2">
            <ul className="grid gap-1">
              <li className="flex gap-1.5"><BadgeCheck size={12} className="mt-0.5 shrink-0 text-good" aria-hidden />직접 만든 원본·절차형 자료</li>
              <li className="flex gap-1.5"><BadgeCheck size={12} className="mt-0.5 shrink-0 text-good" aria-hidden />CC0 또는 재배포를 명시적으로 허용한 라이선스</li>
              <li className="flex gap-1.5"><BadgeCheck size={12} className="mt-0.5 shrink-0 text-good" aria-hidden />권리자의 명시적 재배포 허가와 증빙이 있는 자료</li>
            </ul>
            <p className="mt-2 border-t border-warn/20 pt-2 text-warn">
              {STUDIO_MARKETPLACE_REDISTRIBUTION_NOTICE}
            </p>
            <p className="mt-1 text-fg-3">
              현재 체크는 로컬 사전 점검입니다. 서버 판매·정산·권리 인증 기능은 아직 제공하지 않습니다.
            </p>
          </div>
        </details>

        <div className="mt-2 flex items-start gap-1.5 rounded-lg border border-line bg-card px-2.5 py-2 text-[0.57rem] leading-relaxed text-fg-3">
          <CloudOff size={13} className="mt-0.5 shrink-0" aria-hidden />
          <span>
            패키지 획득 상태는 이 브라우저에만 저장됩니다. 로그인 동기화·결제·구독·판매자 정산은 Phase 1 범위에 포함되지 않습니다.
          </span>
        </div>

        {status ? (
          <p
            id={statusId}
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

      {previewAsset && previewPackage ? (
        <AssetPreviewDialog
          asset={previewAsset}
          pkg={previewPackage}
          dialogRef={previewDialogRef}
          onUse={(asset) => {
            const inserted = handleUse(asset);
            if (inserted) setPreviewAsset(null);
            return inserted;
          }}
          onClose={() => setPreviewAsset(null)}
        />
      ) : null}
        </>
      ) : null}
      </details>
    </section>
  );
}
