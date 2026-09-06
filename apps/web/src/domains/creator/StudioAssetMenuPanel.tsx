// "에셋" 툴바 그룹 팝오버 안에 서브탭 콘텐츠로 얹히는 컴포넌트 — 팝오버 위치·z-index·max-height는
// 호출부(StudioPage.tsx의 에셋 그룹 wrapper)가 담당한다(2026-07-05 툴바 그룹화로 이관, 자체 wrapper 없음).
import {
  BadgeCheck,
  Check,
  ChevronDown,
  Flag,
  Globe,
  ImagePlus,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Share2,
  Sparkles,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { Suspense, useEffect, useState } from "react";

import {
  createStudioAssetFavoriteId,
  favoriteFirst,
  favoriteOnly as filterFavoriteOnly,
  isStudioAssetFavorite,
} from "./studio-asset-favorites";
import { writeStudioAssetDragPayload } from "./studio-insert-drag-writer";
import { createStudioIntentLazyLoader } from "./studio-intent-lazy-loader";
import {
  evaluateStudioMarketplacePublishRights,
  type StudioMarketplaceOrigin,
} from "./studio-marketplace-packages";
import {
  serializeStudioCommunityAssetDragPayload,
  serializeStudioLocalAssetDragPayload,
} from "./studio-shared-asset-drag";

import type {
  StudioAssetFavoriteId,
  StudioAssetFavoriteState,
} from "./studio-asset-favorites";
import type { StudioAsset } from "./studio-asset-library";
import type { StudioCommunityMarketplaceView } from "./studio-community-marketplace-view";
import type { CreatorAssetReportReason } from "@/shared/lib/creator-asset-contract";
import type {
  GeneratedAssetQuality,
  GeneratedAssetSize,
  PublishAssetInput,
  SharedAssetCatalogItem,
} from "@/src/infrastructure/creator-client";
import type { ChangeEvent, Dispatch, DragEvent, KeyboardEvent, SetStateAction } from "react";

import {
  CREATOR_ASSET_LICENSES,
  CREATOR_ASSET_REPORT_REASONS,
  creatorAssetLicenseOf,
} from "@/shared/lib/creator-asset-contract";
import { cx } from "@/shared/lib/cx";
import { useT } from "@/shared/lib/i18n";
import { lazyRetry } from "@/shared/lib/lazy-retry";

export type StudioAssetTab = "mine" | "community";
export type StudioAssetSortOrder = "newest" | "recent" | "frequency" | "popular" | "name" | "size";
export type StudioAssetShareOptions = Pick<
  PublishAssetInput,
  "description" | "tags" | "license" | "attributionText" | "containsAi" | "rightsConfirmed"
>;

const CONTROL_FOCUS_CLASS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-panel";
const TOUCH_CONTROL_CLASS = `min-h-11 ${CONTROL_FOCUS_CLASS}`;
const CARD_ACTION_CLASS =
  `flex min-h-11 w-full items-center justify-center gap-1 rounded-md px-1.5 text-[0.62rem] font-semibold transition-colors ${CONTROL_FOCUS_CLASS}`;

function localizeText(
  t: (key: string, params?: Record<string, string | number>) => string,
  fallback: string,
  key: string,
  params?: Record<string, string | number>,
): string {
  const translated = t(key, params);
  return translated === key ? fallback : translated;
}

const studioCc0AssetLibraryLoader = createStudioIntentLazyLoader(() =>
  import("./StudioCc0AssetLibraryPanel").then((module) => ({
    default: module.StudioCc0AssetLibraryPanel,
  }))
);

const studioOriginalAssetMarketplaceLoader = createStudioIntentLazyLoader(() =>
  import("./StudioOriginalAssetMarketplacePanel").then((module) => ({
    default: module.StudioOriginalAssetMarketplacePanel,
  }))
);
const studioCreatorPackMarketplaceLoader = createStudioIntentLazyLoader(() =>
  import("./StudioCreatorPackMarketplacePanel").then((module) => ({
    default: module.StudioCreatorPackMarketplacePanel,
  }))
);
const studioCommunityMarketplaceLoader = createStudioIntentLazyLoader(() =>
  import("./StudioCommunityMarketplacePanel").then((module) => ({
    default: module.StudioCommunityMarketplacePanel,
  }))
);

const LazyStudioCc0AssetLibraryPanel = lazyRetry(
  studioCc0AssetLibraryLoader.load,
  "StudioCc0AssetLibraryPanel"
);

const LazyStudioOriginalAssetMarketplacePanel = lazyRetry(
  studioOriginalAssetMarketplaceLoader.load,
  "StudioOriginalAssetMarketplacePanel"
);
const LazyStudioCreatorPackMarketplacePanel = lazyRetry(
  studioCreatorPackMarketplaceLoader.load,
  "StudioCreatorPackMarketplacePanel"
);
const LazyStudioCommunityMarketplacePanel = lazyRetry(
  studioCommunityMarketplaceLoader.load,
  "StudioCommunityMarketplacePanel"
);

function preloadStudioAssetMarketplacePanels(): void {
  studioCc0AssetLibraryLoader.preload();
  studioOriginalAssetMarketplaceLoader.preload();
  studioCreatorPackMarketplaceLoader.preload();
  studioCommunityMarketplaceLoader.preload();
}

/**
 * 커뮤니티 탭 본문. 탭 버튼 hover/focus 인텐트가 없어도(마켓 딥링크 ?assetMarket=community 가
 * 탭을 프로그램으로 여는 경우) 마운트 즉시 세 패널 청크를 병렬 프리로드한다 — React lazy 는
 * 형제 lazy 를 순차(워터폴)로 깨우므로, 프리로드 없이는 첫 진입이 청크 3개 직렬 로드가 된다.
 */
function StudioAssetMarketplacePanels({
  initialView,
  onUseLocalAsset,
}: {
  initialView: StudioCommunityMarketplaceView;
  onUseLocalAsset: StudioAssetMenuPanelProps["onUseLocalAsset"];
}) {
  useEffect(() => {
    preloadStudioAssetMarketplacePanels();
  }, []);
  return (
    <Suspense fallback={<StudioAssetMarketplaceLoading />}>
      <div data-studio-asset-marketplace-lazy-boundary="true">
        <LazyStudioCc0AssetLibraryPanel onUseAsset={onUseLocalAsset} />
        <LazyStudioOriginalAssetMarketplacePanel onUseAsset={onUseLocalAsset} />
        <LazyStudioCreatorPackMarketplacePanel />
        <LazyStudioCommunityMarketplacePanel
          initialOpen
          initialView={initialView}
          onUseAsset={onUseLocalAsset}
        />
      </div>
    </Suspense>
  );
}

function StudioAssetMarketplaceLoading() {
  const t = useT();

  return (
    <div
      role="status"
      aria-live="polite"
      data-studio-asset-marketplace-loading="true"
      className="mb-2 min-h-[9.75rem] rounded-lg border border-line bg-card/70 p-2"
    >
      <span className="sr-only">
        {localizeText(
          t,
          "커뮤니티 소재를 불러오는 중. 브러시, 필터, 템플릿과 에셋 마켓을 준비하고 있습니다.",
          "studio.assetMenu.loadingCommunityNotice"
        )}
      </span>
      <div aria-hidden className="grid gap-2">
        {(["w-24", "w-32", "w-28"] as const).map((labelWidth, index) => (
          <div
            key={labelWidth}
            data-studio-asset-marketplace-skeleton-row={index + 1}
            className="flex h-11 items-center gap-2.5 rounded-md border border-line/70 bg-canvas/45 px-2.5"
          >
            <span className="size-7 shrink-0 animate-pulse rounded-md bg-raised motion-reduce:animate-none" />
            <span
              className={cx(
                "h-2.5 animate-pulse rounded-full bg-raised motion-reduce:animate-none",
                labelWidth
              )}
            />
            <span className="ml-auto h-2 w-8 animate-pulse rounded-full bg-raised/75 motion-reduce:animate-none" />
          </div>
        ))}
      </div>
    </div>
  );
}

export interface StudioAssetMenuPanelProps {
  assetTab: StudioAssetTab;
  setAssetTab: Dispatch<SetStateAction<StudioAssetTab>>;
  communityMarketplaceInitialView?: StudioCommunityMarketplaceView;
  onUploadAsset: (event: ChangeEvent<HTMLInputElement>) => void;
  assetPrompt: string;
  setAssetPrompt: Dispatch<SetStateAction<string>>;
  assetPromptName: string;
  setAssetPromptName: Dispatch<SetStateAction<string>>;
  assetPromptSize: GeneratedAssetSize;
  setAssetPromptSize: Dispatch<SetStateAction<GeneratedAssetSize>>;
  assetPromptQuality: GeneratedAssetQuality;
  setAssetPromptQuality: Dispatch<SetStateAction<GeneratedAssetQuality>>;
  assetGenerating: boolean;
  onGenerateAsset: () => void;
  assetSearchQuery: string;
  setAssetSearchQuery: Dispatch<SetStateAction<string>>;
  assetSortOrder: StudioAssetSortOrder;
  setAssetSortOrder: Dispatch<SetStateAction<StudioAssetSortOrder>>;
  favoriteState: StudioAssetFavoriteState;
  favoriteOnly: boolean;
  setFavoriteOnly: Dispatch<SetStateAction<boolean>>;
  onToggleFavorite: (id: StudioAssetFavoriteId) => void;
  assets: StudioAsset[];
  assetsLoading: boolean;
  renamingAssetId: string | null;
  setRenamingAssetId: Dispatch<SetStateAction<string | null>>;
  renamingAssetName: string;
  setRenamingAssetName: Dispatch<SetStateAction<string>>;
  handleRenameAsset: (id: string) => void;
  onUseLocalAsset: (asset: StudioAsset) => boolean;
  onShareAsset: (asset: StudioAsset, options: StudioAssetShareOptions) => void;
  onDeleteAsset: (id: string) => void;
  publishingId: string | null;
  shared: SharedAssetCatalogItem[];
  sharedLoading: boolean;
  sharedLoadingMore: boolean;
  sharedHasMore: boolean;
  sharedError: string | null;
  loadSharedAssets: () => void;
  loadMoreSharedAssets: () => void;
  onUseSharedAsset: (asset: SharedAssetCatalogItem) => void | Promise<void>;
  onDeleteSharedAsset: (id: string) => void;
  onReportSharedAsset: (asset: SharedAssetCatalogItem, reason: CreatorAssetReportReason, details: string) => void;
}

function sortLocalAssets(assets: StudioAsset[], query: string, sortOrder: StudioAssetSortOrder): StudioAsset[] {
  let list = assets;
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery) {
    list = list.filter((asset) => asset.name.toLowerCase().includes(normalizedQuery));
  }
  const sorted = list.slice();
  if (sortOrder === "newest" || sortOrder === "recent") {
    sorted.sort((a, b) => b.createdAt - a.createdAt);
  } else if (sortOrder === "popular" || sortOrder === "frequency") {
    sorted.sort((a, b) => b.createdAt - a.createdAt);
  } else if (sortOrder === "name") {
    sorted.sort((a, b) => a.name.localeCompare(b.name, "ko", { sensitivity: "base" }));
  } else {
    sorted.sort((a, b) => b.width * b.height - a.width * a.height);
  }
  return sorted;
}

function sortSharedAssets(
  assets: SharedAssetCatalogItem[],
  query: string,
  sortOrder: StudioAssetSortOrder
): SharedAssetCatalogItem[] {
  let list = assets;
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery) {
    list = list.filter((asset) => asset.name.toLowerCase().includes(normalizedQuery));
  }
  const sorted = list.slice();
  if (sortOrder === "newest" || sortOrder === "recent") {
    sorted.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  } else if (sortOrder === "popular" || sortOrder === "frequency") {
    sorted.sort((a, b) => b.downloads - a.downloads);
  } else if (sortOrder === "name") {
    sorted.sort((a, b) => a.name.localeCompare(b.name, "ko", { sensitivity: "base" }));
  } else {
    sorted.sort((a, b) => b.width * b.height - a.width * a.height);
  }
  return sorted;
}

function dragLocalAssetData(event: DragEvent<HTMLElement>, asset: Pick<StudioAsset, "dataUrl" | "width" | "height">) {
  writeStudioAssetDragPayload(
    event.dataTransfer,
    serializeStudioLocalAssetDragPayload({ src: asset.dataUrl, width: asset.width, height: asset.height })
  );
}

function dragSharedAssetData(event: DragEvent<HTMLElement>, asset: Pick<SharedAssetCatalogItem, "id">) {
  writeStudioAssetDragPayload(event.dataTransfer, serializeStudioCommunityAssetDragPayload(asset.id));
}

function AssetFavoriteButton({
  assetName,
  favoriteId,
  favoriteState,
  onToggleFavorite,
}: {
  assetName: string;
  favoriteId: StudioAssetFavoriteId;
  favoriteState: StudioAssetFavoriteState;
  onToggleFavorite: (id: StudioAssetFavoriteId) => void;
}) {
  const favorite = isStudioAssetFavorite(favoriteState, favoriteId);
  const t = useT();
  const favoriteAction = favorite
    ? localizeText(t, "에서 제거", "studio.assetMenu.favoriteAction.remove")
    : localizeText(t, "에 추가", "studio.assetMenu.favoriteAction.add");
  const label = `${assetName} ${localizeText(t, "즐겨찾기", "studio.assetMenu.favoriteLabel")}${favoriteAction}`;

  return (
    <button
      type="button"
      draggable={false}
      onPointerDown={(event) => event.stopPropagation()}
      onDragStart={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onClick={(event) => {
        event.stopPropagation();
        onToggleFavorite(favoriteId);
      }}
      aria-label={label}
      aria-pressed={favorite}
      title={label}
      data-favorite-id={favoriteId}
      className={cx(
        "absolute right-1.5 top-1.5 z-10 flex size-11 items-center justify-center rounded-md border shadow-sm transition-colors",
        CONTROL_FOCUS_CLASS,
        favorite
          ? "border-accent bg-panel text-accent"
          : "border-line bg-panel/95 text-fg-2 hover:border-accent/60 hover:text-accent"
      )}
    >
      <Star size={16} className={favorite ? "fill-current" : undefined} aria-hidden />
    </button>
  );
}

export function StudioAssetMenuPanel({
  assetTab,
  setAssetTab,
  communityMarketplaceInitialView = "community",
  onUploadAsset,
  assetPrompt,
  setAssetPrompt,
  assetPromptName,
  setAssetPromptName,
  assetPromptSize,
  setAssetPromptSize,
  assetPromptQuality,
  setAssetPromptQuality,
  assetGenerating,
  onGenerateAsset,
  assetSearchQuery,
  setAssetSearchQuery,
  assetSortOrder,
  setAssetSortOrder,
  favoriteState,
  favoriteOnly,
  setFavoriteOnly,
  onToggleFavorite,
  assets,
  assetsLoading,
  renamingAssetId,
  setRenamingAssetId,
  renamingAssetName,
  setRenamingAssetName,
  handleRenameAsset,
  onUseLocalAsset,
  onShareAsset,
  onDeleteAsset,
  publishingId,
  shared,
  sharedLoading,
  sharedLoadingMore,
  sharedHasMore,
  sharedError,
  loadSharedAssets,
  loadMoreSharedAssets,
  onUseSharedAsset,
  onDeleteSharedAsset,
  onReportSharedAsset,
}: StudioAssetMenuPanelProps) {
  const t = useT();
  const [aiCreatorOpen, setAiCreatorOpen] = useState(false);
  const localFavoriteId = (asset: StudioAsset) => createStudioAssetFavoriteId("local", asset.id);
  const sharedFavoriteId = (asset: SharedAssetCatalogItem) => createStudioAssetFavoriteId("community", asset.id);
  const sortedAssets = favoriteFirst(
    sortLocalAssets(assets, assetSearchQuery, assetSortOrder),
    favoriteState,
    localFavoriteId
  );
  const sortedShared = favoriteFirst(
    sortSharedAssets(shared, assetSearchQuery, assetSortOrder),
    favoriteState,
    sharedFavoriteId
  );
  const filteredAssets = favoriteOnly
    ? filterFavoriteOnly(sortedAssets, favoriteState, localFavoriteId)
    : sortedAssets;
  const filteredShared = favoriteOnly
    ? filterFavoriteOnly(sortedShared, favoriteState, sharedFavoriteId)
    : sortedShared;

  return (
    <>
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-0.5 rounded-lg border border-line bg-card p-0.5">
          <button
            type="button"
            onClick={() => setAssetTab("mine")}
            aria-pressed={assetTab === "mine"}
          className={cx(
            TOUCH_CONTROL_CLASS,
            "rounded-md px-2 text-[0.65rem] font-semibold transition-colors",
            assetTab === "mine" ? "bg-accent text-on-accent shadow-sm" : "text-fg-3 hover:bg-raised"
          )}
        >
            {localizeText(t, "내 에셋", "studio.assetMenu.tab.mine")}
        </button>
          <button
            type="button"
            onClick={() => setAssetTab("community")}
            onPointerEnter={preloadStudioAssetMarketplacePanels}
            onPointerDown={preloadStudioAssetMarketplacePanels}
            onFocus={preloadStudioAssetMarketplacePanels}
            aria-pressed={assetTab === "community"}
            className={cx(
              TOUCH_CONTROL_CLASS,
              "flex items-center gap-1 rounded-md px-2 text-[0.65rem] font-semibold transition-colors",
              assetTab === "community" ? "bg-accent text-on-accent shadow-sm" : "text-fg-3 hover:bg-raised"
            )}
          >
            <Globe size={13} aria-hidden /> {localizeText(t, "커뮤니티", "studio.assetMenu.tab.community")}
          </button>
        </div>
        {assetTab === "mine" && (
          <label
            className={cx(
              "flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg bg-accent px-2.5 text-[0.65rem] font-semibold text-on-accent transition-colors hover:bg-accent/90",
              "focus-within:outline-none focus-within:ring-2 focus-within:ring-accent focus-within:ring-offset-1 focus-within:ring-offset-panel"
            )}
          >
            <ImagePlus size={14} aria-hidden /> {localizeText(t, "업로드", "studio.assetMenu.upload")}
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={onUploadAsset}
              aria-label={localizeText(t, "이미지 에셋 업로드", "studio.assetMenu.uploadAria")}
            />
          </label>
        )}
      </div>

      <div
        data-studio-asset-placement-help="true"
        className="mb-2 grid grid-cols-2 gap-1 rounded-xl border border-accent/20 bg-accent-soft/45 p-1.5 text-[0.58rem] leading-snug text-fg-2"
      >
        <div className="flex min-h-11 items-center gap-1.5 rounded-lg bg-panel/60 px-2">
          <Plus size={12} className="shrink-0 text-accent" aria-hidden />
          <span>
            <strong className="font-bold text-fg">{localizeText(t, "클릭·탭", "studio.assetMenu.helpTapTitle")}</strong>
            <br />
            {localizeText(t, "선택 컷 또는 현재 화면", "studio.assetMenu.helpTapDescription")}
          </span>
        </div>
        <div className="flex min-h-11 items-center gap-1.5 rounded-lg bg-panel/60 px-2">
          <ImagePlus size={12} className="shrink-0 text-accent" aria-hidden />
          <span>
            <strong className="font-bold text-fg">{localizeText(t, "끌어 놓기", "studio.assetMenu.helpDropTitle")}</strong>
            <br />
            {localizeText(t, "정확한 위치 · Esc 취소", "studio.assetMenu.helpDropDescription")}
          </span>
        </div>
      </div>

      {assetTab === "mine" && (
        <div className="mb-2 rounded-xl border border-line bg-card/70 p-1.5">
          <button
            type="button"
            onClick={() => setAiCreatorOpen((current) => !current)}
            aria-expanded={aiCreatorOpen}
            aria-controls="studio-ai-asset-creator"
            aria-label={
              aiCreatorOpen
                ? localizeText(t, "AI 에셋 생성 도구 닫기", "studio.assetMenu.aiCreatorToggleAriaClose")
                : localizeText(t, "AI 에셋 생성 도구 열기", "studio.assetMenu.aiCreatorToggleAriaOpen")
            }
            className={cx(
              TOUCH_CONTROL_CLASS,
              "flex w-full items-center gap-2 rounded-lg px-2 text-left transition-colors hover:bg-raised",
              CONTROL_FOCUS_CLASS
            )}
          >
            {assetGenerating ? (
              <Loader2 size={14} className="shrink-0 animate-spin text-accent" aria-hidden />
            ) : (
              <Sparkles size={14} className="shrink-0 text-accent" aria-hidden />
            )}
            <span className="min-w-0 flex-1">
              <strong className="block text-[0.65rem] font-bold text-fg-2">
                {assetGenerating
                  ? localizeText(t, "AI 에셋 생성 중", "studio.assetMenu.aiCreatorRunning")
                  : localizeText(t, "AI 에셋 생성", "studio.assetMenu.aiCreatorIdle")}
              </strong>
              <span className="block truncate text-[0.55rem] text-fg-3">
                {localizeText(t, "설명으로 나만의 소재 만들기", "studio.assetMenu.aiCreatorSubtext")}
              </span>
            </span>
            <ChevronDown
              size={14}
              className={cx("shrink-0 text-fg-3 transition-transform", aiCreatorOpen && "rotate-180")}
              aria-hidden
            />
          </button>
          <div
            id="studio-ai-asset-creator"
            hidden={!aiCreatorOpen}
            className="border-t border-line/70 px-0.5 pt-2"
          >
          {/* 생성형 AI 고지(정책 필수) — 결과물이 생성형 AI 산출물임을 항상 명시한다. */}
          <p className="mb-1.5 rounded-md border border-line bg-panel/60 px-2 py-1 text-[0.58rem] leading-relaxed text-fg-3">
            {localizeText(t, "생성형 AI(OpenAI)로 이미지를 만들어요.", "studio.assetMenu.aiDisclosureLine1")} <span className="font-semibold text-accent">AI</span>
            {localizeText(t, "배지가 표시되며,", "studio.assetMenu.aiDisclosureLine2")}
            <br />
            {localizeText(t, "타인의 저작물·실존 인물은 생성하지 않아요.", "studio.assetMenu.aiDisclosureLine3")}
          </p>
          <textarea
            value={assetPrompt}
            onChange={(event) => setAssetPrompt(event.target.value.slice(0, 1000))}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") onGenerateAsset();
            }}
            placeholder={localizeText(t, "예: 비 오는 골목 배경, 마법 소품, 놀란 표정 캐릭터", "studio.assetMenu.promptPlaceholder")}
            rows={2}
            aria-label={localizeText(t, "AI 에셋 설명", "studio.assetMenu.promptTextareaAria")}
            className={cx(
              "h-16 w-full resize-none rounded-md border border-line bg-panel px-2 py-2 text-[0.65rem] leading-snug text-fg outline-none transition-colors placeholder:text-fg-3 focus:border-accent",
              CONTROL_FOCUS_CLASS
            )}
          />
          <div className="mt-1.5 grid grid-cols-[1fr_auto] gap-1.5">
            <input
              type="text"
              value={assetPromptName}
              onChange={(event) => setAssetPromptName(event.target.value.slice(0, 60))}
              placeholder={localizeText(t, "이름", "studio.assetMenu.promptNamePlaceholder")}
              aria-label={localizeText(t, "생성할 에셋 이름", "studio.assetMenu.promptNameAria")}
              className={cx(
                TOUCH_CONTROL_CLASS,
                "min-w-0 rounded-md border border-line bg-panel px-2 text-[0.65rem] text-fg outline-none transition-colors placeholder:text-fg-3 focus:border-accent"
              )}
            />
            <button
              type="button"
              onClick={onGenerateAsset}
              disabled={!assetPrompt.trim() || assetGenerating}
              aria-busy={assetGenerating || undefined}
              aria-label={
                assetGenerating
                  ? localizeText(t, "AI 에셋 생성 중", "studio.assetMenu.aiCreatorRunning")
                  : localizeText(t, "AI 에셋 생성", "studio.assetMenu.aiCreatorIdle")
              }
              className={cx(
                TOUCH_CONTROL_CLASS,
                "inline-flex items-center gap-1.5 rounded-md bg-accent px-3 text-[0.65rem] font-semibold text-on-accent transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-55"
              )}
            >
              {assetGenerating ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Sparkles size={14} aria-hidden />}
              {assetGenerating
                ? localizeText(t, "생성 중", "studio.assetMenu.generateRunning")
                : localizeText(t, "생성", "studio.assetMenu.generate")}
            </button>
          </div>
          <div className="mt-1.5 grid grid-cols-2 gap-1.5">
              <select
                value={assetPromptSize}
                onChange={(event) => setAssetPromptSize(event.target.value as GeneratedAssetSize)}
                aria-label={localizeText(t, "생성 이미지 크기", "studio.assetMenu.promptSizeAria")}
                className={cx(
                  TOUCH_CONTROL_CLASS,
                  "rounded-md border border-line bg-panel px-2 text-[0.65rem] text-fg-2 outline-none focus:border-accent"
                )}
              >
                <option value="1024x1024">{localizeText(t, "정사각", "studio.assetMenu.promptSizeSquare")}</option>
                <option value="1536x1024">{localizeText(t, "가로 배경", "studio.assetMenu.promptSizeLandscape")}</option>
                <option value="1024x1536">{localizeText(t, "세로 컷", "studio.assetMenu.promptSizePortrait")}</option>
              </select>
              <select
                value={assetPromptQuality}
                onChange={(event) => setAssetPromptQuality(event.target.value as GeneratedAssetQuality)}
                aria-label={localizeText(t, "생성 이미지 품질", "studio.assetMenu.promptQualityAria")}
                className={cx(
                  TOUCH_CONTROL_CLASS,
                  "rounded-md border border-line bg-panel px-2 text-[0.65rem] text-fg-2 outline-none focus:border-accent"
                )}
              >
                <option value="low">{localizeText(t, "빠르게", "studio.assetMenu.promptQualityFast")}</option>
                <option value="medium">{localizeText(t, "표준", "studio.assetMenu.promptQualityStandard")}</option>
                <option value="high">{localizeText(t, "고품질", "studio.assetMenu.promptQualityHigh")}</option>
                <option value="auto">{localizeText(t, "자동", "studio.assetMenu.promptQualityAuto")}</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {assetTab === "community" ? (
        <StudioAssetMarketplacePanels
          initialView={communityMarketplaceInitialView}
          onUseLocalAsset={onUseLocalAsset}
        />
      ) : null}

      <div className="mb-2 grid grid-cols-2 gap-1.5">
        <div className="relative col-span-2">
          <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-fg-3" />
          <input
            type="text"
            placeholder={localizeText(t, "에셋 검색...", "studio.assetMenu.search.placeholder")}
            value={assetSearchQuery}
            onChange={(event) => setAssetSearchQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && assetTab === "community") loadSharedAssets();
            }}
            aria-label={localizeText(t, "에셋 검색", "studio.assetMenu.search.aria")}
            className={cx(
              TOUCH_CONTROL_CLASS,
              "w-full rounded-lg border border-line bg-card pl-7 pr-11 text-[0.65rem] placeholder:text-fg-3 outline-none transition-colors focus:border-accent"
            )}
          />
          {assetSearchQuery && (
            <button
              type="button"
              onClick={() => setAssetSearchQuery("")}
              className={cx(
                "absolute right-0 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-md text-fg-3 transition-colors hover:bg-raised hover:text-fg-2",
                CONTROL_FOCUS_CLASS
              )}
              aria-label={localizeText(t, "에셋 검색어 지우기", "studio.assetMenu.search.clearAria")}
            >
              <X size={15} aria-hidden />
            </button>
          )}
        </div>
        <select
          value={assetSortOrder}
          onChange={(event) => setAssetSortOrder(event.target.value as StudioAssetSortOrder)}
          aria-label={localizeText(t, "에셋 정렬", "studio.assetMenu.sort.aria")}
          className={cx(
            TOUCH_CONTROL_CLASS,
            "w-full cursor-pointer rounded-lg border border-line bg-card px-2 text-[0.65rem] text-fg-2 outline-none transition-colors focus:border-accent"
          )}
        >
          <option value="newest">{localizeText(t, "최신순", "studio.assetMenu.sort.newest")}</option>
          <option value="recent">{localizeText(t, "최근 사용순", "studio.assetMenu.sort.recent")}</option>
          <option value="frequency">{localizeText(t, "사용 빈도순", "studio.assetMenu.sort.frequency")}</option>
          <option value="popular">{localizeText(t, "인기순", "studio.assetMenu.sort.popular")}</option>
          <option value="name">{localizeText(t, "이름순", "studio.assetMenu.sort.name")}</option>
          <option value="size">{localizeText(t, "크기순", "studio.assetMenu.sort.size")}</option>
        </select>
        <button
          type="button"
          onClick={() => setFavoriteOnly((current) => !current)}
          aria-pressed={favoriteOnly}
          aria-label={localizeText(t, "즐겨찾기만", "studio.assetMenu.filter.favoritesOnly")}
          className={cx(
            TOUCH_CONTROL_CLASS,
            "inline-flex w-full items-center justify-center gap-1.5 rounded-lg border px-2 text-[0.65rem] font-semibold transition-colors",
            favoriteOnly
              ? "border-accent bg-accent-soft text-accent"
              : "border-line bg-card text-fg-2 hover:bg-raised"
          )}
        >
          <Star size={14} className={favoriteOnly ? "fill-current" : undefined} aria-hidden />
          {localizeText(t, "즐겨찾기만", "studio.assetMenu.filter.favoritesOnly")}
        </button>
      </div>

      {assetTab === "community" && (
        <button
          type="button"
          onClick={loadSharedAssets}
          disabled={sharedLoading}
          className={cx(TOUCH_CONTROL_CLASS, "mb-2 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-line bg-card text-[0.65rem] font-semibold text-fg-2 hover:bg-raised disabled:opacity-55")}
        >
          {sharedLoading ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <Search size={13} aria-hidden />}
          {localizeText(t, "전체 카탈로그에서 검색·정렬", "studio.assetMenu.search.refreshCommunity")}
        </button>
      )}

      {assetTab === "mine" ? (
        <LocalAssetGrid
          assets={assets}
          filteredAssets={filteredAssets}
          assetsLoading={assetsLoading}
          renamingAssetId={renamingAssetId}
          setRenamingAssetId={setRenamingAssetId}
          renamingAssetName={renamingAssetName}
          setRenamingAssetName={setRenamingAssetName}
          handleRenameAsset={handleRenameAsset}
          onUseLocalAsset={onUseLocalAsset}
          onShareAsset={onShareAsset}
          onDeleteAsset={onDeleteAsset}
          publishingId={publishingId}
          favoriteState={favoriteState}
          favoriteOnly={favoriteOnly}
          onToggleFavorite={onToggleFavorite}
        />
      ) : (
        <SharedAssetGrid
          shared={shared}
          filteredShared={filteredShared}
          sharedLoading={sharedLoading}
          sharedLoadingMore={sharedLoadingMore}
          sharedHasMore={sharedHasMore}
          sharedError={sharedError}
          loadSharedAssets={loadSharedAssets}
          loadMoreSharedAssets={loadMoreSharedAssets}
          onUseSharedAsset={onUseSharedAsset}
          onDeleteSharedAsset={onDeleteSharedAsset}
          onReportSharedAsset={onReportSharedAsset}
          favoriteState={favoriteState}
          favoriteOnly={favoriteOnly}
          onToggleFavorite={onToggleFavorite}
        />
      )}
    </>
  );
}

function LocalAssetGrid({
  assets,
  filteredAssets,
  assetsLoading,
  renamingAssetId,
  setRenamingAssetId,
  renamingAssetName,
  setRenamingAssetName,
  handleRenameAsset,
  onUseLocalAsset,
  onShareAsset,
  onDeleteAsset,
  publishingId,
  favoriteState,
  favoriteOnly,
  onToggleFavorite,
}: Pick<
  StudioAssetMenuPanelProps,
  | "assets"
  | "assetsLoading"
  | "renamingAssetId"
  | "setRenamingAssetId"
  | "renamingAssetName"
  | "setRenamingAssetName"
  | "handleRenameAsset"
  | "onUseLocalAsset"
  | "onShareAsset"
  | "onDeleteAsset"
  | "publishingId"
  | "favoriteState"
  | "favoriteOnly"
  | "onToggleFavorite"
> & {
  filteredAssets: StudioAsset[];
}) {
  const t = useT();
  const [openActionsId, setOpenActionsId] = useState<string | null>(null);
  const [shareAsset, setShareAsset] = useState<StudioAsset | null>(null);

  if (assetsLoading) {
    return (
      <div className="flex h-32 items-center justify-center text-fg-3">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }
  if (assets.length === 0) {
    return (
      <div
        data-studio-asset-empty="true"
        className="relative flex h-36 flex-col items-center justify-center overflow-hidden rounded-2xl border border-dashed border-line/80 p-4 text-center"
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-50"
          style={{
            backgroundImage:
              "linear-gradient(145deg, oklch(0.24 0.02 42 / 0.12), transparent 55%), radial-gradient(oklch(0.5 0.01 70 / 0.12) 1px, transparent 1px)",
            backgroundSize: "auto, 8px 8px",
          }}
        />
        <span className="relative mb-2 grid size-11 place-items-center rounded-2xl border border-line bg-card text-fg-3 shadow-sm">
          <ImagePlus size={18} aria-hidden />
        </span>
        <p className="relative text-xs font-semibold text-fg-2">{localizeText(t, "업로드한 에셋이 없습니다", "studio.assetMenu.emptyMyAssetsTitle")}</p>
        <p className="relative mt-1 max-w-[28ch] text-[0.6rem] leading-normal text-fg-3">
          {localizeText(t, "자주 쓰는 이미지를 올려 두면 컷에 바로 끌어다 쓸 수 있어요.", "studio.assetMenu.emptyMyAssetsDescription")}
        </p>
      </div>
    );
  }
  if (filteredAssets.length === 0) {
    return favoriteOnly ? <EmptyFavoriteResult /> : <EmptySearchResult />;
  }
  return (
    <>
      {shareAsset && (
        <PublishAssetDialog
          key={shareAsset.id}
          asset={shareAsset}
          publishing={publishingId === shareAsset.id}
          onClose={() => setShareAsset(null)}
          onPublish={(options) => onShareAsset(shareAsset, options)}
        />
      )}
      <div
        data-studio-asset-grid="true"
        className="grid max-h-64 grid-cols-3 gap-2 overflow-y-auto pr-1"
      >
      {filteredAssets.map((asset) => {
        const actionRegionId = `local-asset-actions-${asset.id}`;
        const actionsOpen = openActionsId === asset.id;
        const isRenaming = renamingAssetId === asset.id;
        const favoriteId = createStudioAssetFavoriteId("local", asset.id);

        return (
          <div
            key={asset.id}
            data-studio-asset-card="true"
            className="group relative flex cursor-grab flex-col items-stretch rounded-xl border border-line/80 bg-card p-1.5 shadow-[inset_0_1px_0_oklch(0.97_0.01_85/0.04)] transition-[border-color,box-shadow,transform] duration-150 hover:-translate-y-0.5 hover:border-accent/50 hover:shadow-md focus-within:border-accent/50 active:cursor-grabbing"
            draggable
            onDragStart={(event) => dragLocalAssetData(event, asset)}
          >
            <AssetFavoriteButton
              assetName={asset.name}
              favoriteId={favoriteId}
              favoriteState={favoriteState}
              onToggleFavorite={onToggleFavorite}
            />
            <button
              type="button"
              onClick={() => onUseLocalAsset(asset)}
              className={cx(
                "relative flex h-20 w-full cursor-pointer items-center justify-center overflow-hidden rounded-lg",
                CONTROL_FOCUS_CLASS
              )}
              style={{
                // Warm checkerboard (Canva/Photopea asset preview) — not cold neutral-800.
                backgroundColor: "oklch(0.22 0.01 66)",
                backgroundImage:
                  "linear-gradient(45deg, oklch(0.26 0.01 66) 25%, transparent 25%), linear-gradient(-45deg, oklch(0.26 0.01 66) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, oklch(0.26 0.01 66) 75%), linear-gradient(-45deg, transparent 75%, oklch(0.26 0.01 66) 75%)",
                backgroundSize: "10px 10px",
                backgroundPosition: "0 0, 0 5px, 5px -5px, -5px 0",
              }}
              title={`${asset.name} · ${localizeText(
                t,
                "선택한 컷 또는 현재 보이는 위치에 추가",
                "studio.assetMenu.addToCurrentView"
              )}`}
              aria-label={`${asset.name} ${localizeText(
                t,
                "선택한 컷 또는 현재 보이는 위치에 추가",
                "studio.assetMenu.addToCurrentView"
              )}`}
            >
              <img
                src={asset.dataUrl}
                alt=""
                className="max-h-full max-w-full object-contain drop-shadow-sm transition-transform duration-150 group-hover:scale-105"
              />
              {asset.kind === "ai" && (
                <span className="pointer-events-none absolute left-1 top-1 inline-flex items-center gap-0.5 rounded-md bg-accent px-1 py-px text-[0.5rem] font-bold uppercase leading-none tracking-wide text-on-accent shadow">
                  <Sparkles size={7} aria-hidden /> AI
                </span>
              )}
              {asset.kind === "bg3d" && (
                <span className="pointer-events-none absolute left-1 top-1 inline-flex items-center gap-0.5 rounded-md border border-line/70 bg-panel/90 px-1 py-px text-[0.5rem] font-bold leading-none tracking-wide text-fg-2 shadow backdrop-blur-sm">
                  <BadgeCheck size={8} className="text-good" aria-hidden />
                  {localizeText(t, "권리 인증", "studio.assetMenu.rightsBadge")}
                </span>
              )}
              <span className="pointer-events-none absolute bottom-1 right-1 inline-flex items-center gap-0.5 rounded-md border border-line/40 bg-panel/90 px-1.5 py-0.5 text-[0.55rem] font-semibold text-fg shadow-sm backdrop-blur-sm">
                <Plus size={10} aria-hidden /> {localizeText(t, "추가", "studio.assetMenu.cardAction.add")}
              </span>
            </button>

            {isRenaming ? (
              <RenameAssetInline
                asset={asset}
                renamingAssetName={renamingAssetName}
                setRenamingAssetName={setRenamingAssetName}
                setRenamingAssetId={setRenamingAssetId}
                handleRenameAsset={handleRenameAsset}
              />
            ) : (
              <>
                <span
                  className="mt-1 block w-full cursor-text truncate text-center text-[0.6rem] font-medium text-fg-2"
                  title={asset.name}
                  onDoubleClick={() => {
                    setOpenActionsId(null);
                    setRenamingAssetId(asset.id);
                    setRenamingAssetName(asset.name);
                  }}
                >
                  {asset.name}
                </span>
                <button
                  type="button"
                  onClick={() => setOpenActionsId((current) => (current === asset.id ? null : asset.id))}
                  className={cx(CARD_ACTION_CLASS, "mt-1 border border-line bg-panel text-fg-2 hover:bg-raised")}
                  aria-expanded={actionsOpen}
                  aria-controls={actionRegionId}
                  aria-label={`${asset.name} ${localizeText(
                    t,
                    "관리 작업",
                    "studio.assetMenu.manageActions"
                  )} ${actionsOpen ? t("common.close") : t("common.open")}`}
                >
                  <MoreHorizontal size={15} aria-hidden /> {localizeText(t, "작업", "studio.assetMenu.actions")}
                </button>
                {actionsOpen && (
                  <div
                    id={actionRegionId}
                    role="group"
                    aria-label={`${asset.name} ${localizeText(t, "관리 작업", "studio.assetMenu.manageActions")}`}
                    className="mt-1 space-y-1 border-t border-line/60 pt-1"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setOpenActionsId(null);
                        setRenamingAssetId(asset.id);
                        setRenamingAssetName(asset.name);
                      }}
                      className={cx(CARD_ACTION_CLASS, "bg-panel text-fg-2 hover:bg-raised")}
                      aria-label={`${asset.name} ${localizeText(t, "이름 변경", "studio.assetMenu.renameAsset")}`}
                    >
                      <Pencil size={13} aria-hidden /> {localizeText(t, "이름", "studio.assetMenu.rename")}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setOpenActionsId(null);
                        setShareAsset(asset);
                      }}
                      disabled={publishingId === asset.id}
                      aria-busy={publishingId === asset.id || undefined}
                      className={cx(
                        CARD_ACTION_CLASS,
                        "bg-panel text-fg-2 hover:bg-raised disabled:cursor-not-allowed disabled:opacity-55"
                      )}
                      aria-label={`${asset.name} ${localizeText(
                        t,
                        "커뮤니티에 공유",
                        "studio.assetMenu.shareCommunity"
                      )}`}
                    >
                      {publishingId === asset.id ? (
                        <Loader2 size={13} className="animate-spin" aria-hidden />
                      ) : (
                        <Share2 size={13} aria-hidden />
                      )}
                      {publishingId === asset.id
                        ? localizeText(t, "공유 중", "studio.assetMenu.sharing")
                        : localizeText(t, "공유", "studio.assetMenu.share")}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setOpenActionsId(null);
                        onDeleteAsset(asset.id);
                      }}
                      className={cx(CARD_ACTION_CLASS, "bg-bad/5 text-bad hover:bg-bad/10")}
                      aria-label={`${asset.name} ${localizeText(t, "삭제", "studio.assetMenu.delete")}`}
                    >
                      <Trash2 size={13} aria-hidden /> {localizeText(t, "삭제", "studio.assetMenu.delete")}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        );
      })}
      </div>
    </>
  );
}

function PublishAssetDialog({
  asset,
  publishing,
  onClose,
  onPublish,
}: {
  asset: StudioAsset;
  publishing: boolean;
  onClose: () => void;
  onPublish: (options: StudioAssetShareOptions) => void;
}) {
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [license, setLicense] = useState<StudioAssetShareOptions["license"]>("toonspectrum-standard");
  const [attributionText, setAttributionText] = useState("");
  const [containsAi, setContainsAi] = useState(asset.kind === "ai");
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [publishOrigin, setPublishOrigin] = useState<StudioMarketplaceOrigin>(
    "original-handmade"
  );
  const [containsThirdPartyContent, setContainsThirdPartyContent] = useState(false);
  const [marketplaceDerivativeFree, setMarketplaceDerivativeFree] = useState(false);
  const [redistributionPermission, setRedistributionPermission] = useState(false);
  const [sourceReference, setSourceReference] = useState("");
  const [permissionEvidence, setPermissionEvidence] = useState("");
  const selectedLicense = creatorAssetLicenseOf(license);
  const t = useT();
  const externalOrigin = publishOrigin === "cc0"
    || publishOrigin === "permissive"
    || publishOrigin === "explicit-permission";
  const rightsDecision = evaluateStudioMarketplacePublishRights({
    origin: publishOrigin,
    creatorOwnsRights: rightsConfirmed,
    containsThirdPartyContent,
    recognizableMarketplaceDerivative: !marketplaceDerivativeFree,
    redistributionPermission,
    sourceReference,
    permissionEvidence,
  });

  return (
    <div
      className="fixed inset-0 z-[120] grid place-items-center bg-black/55 p-4"
      role="presentation"
    >
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
        aria-label={localizeText(t, "공유 설정 닫기", "studio.assetMenu.publishDialog.close")}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="publish-asset-title"
        className="relative max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-line bg-panel p-4 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 id="publish-asset-title" className="text-sm font-bold text-fg">
              {localizeText(t, "커뮤니티 사용권 설정", "studio.assetMenu.publishDialog.title")}
            </h3>
            <p className="mt-1 text-[0.65rem] leading-relaxed text-fg-3">
              {localizeText(
                t,
                "{assetName}의 조건을 다른 창작자가 재사용할 수 있도록 표시합니다.",
                "studio.assetMenu.publishDialog.subtitle",
                { assetName: asset.name }
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={cx("grid size-11 shrink-0 place-items-center rounded-lg text-fg-3 hover:bg-raised", CONTROL_FOCUS_CLASS)}
            aria-label={localizeText(t, "공유 설정 닫기", "studio.assetMenu.publishDialog.close")}
          >
            <X size={17} aria-hidden />
          </button>
        </div>

        <label className="mt-3 block text-[0.65rem] font-semibold text-fg-2">
          {localizeText(t, "설명", "studio.assetMenu.publishDialog.descriptionLabel")}
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value.slice(0, 500))}
            rows={3}
            placeholder={localizeText(
              t,
              "사용하기 좋은 장면, 편집 팁, 포함 요소",
              "studio.assetMenu.publishDialog.descriptionPlaceholder"
            )}
            className="mt-1 w-full resize-none rounded-lg border border-line bg-card p-2 text-xs font-normal text-fg outline-none focus:border-accent"
          />
        </label>
        <label className="mt-2 block text-[0.65rem] font-semibold text-fg-2">
          {localizeText(t, "태그", "studio.assetMenu.publishDialog.tagsLabel")}
          <input
            value={tags}
            onChange={(event) => setTags(event.target.value.slice(0, 240))}
            placeholder={localizeText(
              t,
              "배경, 골목, 야경 (쉼표로 구분)",
              "studio.assetMenu.publishDialog.tagsPlaceholder"
            )}
            className={cx(TOUCH_CONTROL_CLASS, "mt-1 w-full rounded-lg border border-line bg-card px-2 text-xs font-normal text-fg outline-none focus:border-accent")}
          />
        </label>
        <label className="mt-2 block text-[0.65rem] font-semibold text-fg-2">
          {localizeText(t, "사용권", "studio.assetMenu.publishDialog.licenseLabel")}
          <select
            value={license}
            onChange={(event) => setLicense(event.target.value as StudioAssetShareOptions["license"])}
            className={cx(TOUCH_CONTROL_CLASS, "mt-1 w-full rounded-lg border border-line bg-card px-2 text-xs font-normal text-fg outline-none focus:border-accent")}
          >
            {CREATOR_ASSET_LICENSES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
        <p className="mt-1 rounded-lg bg-raised/70 px-2 py-1.5 text-[0.62rem] leading-relaxed text-fg-3">
          {selectedLicense.description} ·{" "}
          {selectedLicense.commercialUse
            ? localizeText(t, "상업 사용 가능", "studio.assetMenu.publishDialog.licenseCommercialUse")
            : localizeText(t, "비상업 전용", "studio.assetMenu.publishDialog.licenseNonCommercial")}
          {selectedLicense.url && (
            <>
              {" · "}
              <a
                href={selectedLicense.url}
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-accent underline underline-offset-2"
              >
                {localizeText(t, "사용권 원문", "studio.assetMenu.publishDialog.licenseOriginal")}
              </a>
            </>
          )}
        </p>
        {selectedLicense.attributionRequired && (
          <label className="mt-2 block text-[0.65rem] font-semibold text-fg-2">
            {localizeText(t, "표시할 저작자명", "studio.assetMenu.publishDialog.attributionLabel")}
            <input
              value={attributionText}
              onChange={(event) => setAttributionText(event.target.value.slice(0, 160))}
              placeholder={localizeText(
                t,
                "비워 두면 계정 이름 사용",
                "studio.assetMenu.publishDialog.attributionPlaceholder"
              )}
              className={cx(TOUCH_CONTROL_CLASS, "mt-1 w-full rounded-lg border border-line bg-card px-2 text-xs font-normal text-fg outline-none focus:border-accent")}
            />
          </label>
        )}
        <label className="mt-3 flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-line bg-card px-3 text-xs text-fg-2">
          <input type="checkbox" checked={containsAi} onChange={(event) => setContainsAi(event.target.checked)} />
          {localizeText(t, "생성형 AI가 만든 이미지 또는 요소를 포함합니다.", "studio.assetMenu.publishDialog.containsAi")}
        </label>

        <div className="mt-3 rounded-lg border border-warn/30 bg-warn/5 p-3">
          <div className="flex items-start gap-2">
            <BadgeCheck size={15} className="mt-0.5 shrink-0 text-warn" aria-hidden />
            <div>
              <p className="text-xs font-bold text-fg">{localizeText(t, "공유 권리 사전 점검", "studio.assetMenu.publishDialog.rightsCheckTitle")}</p>
              <p className="mt-0.5 text-[0.62rem] leading-relaxed text-fg-3">
                {localizeText(
                  t,
                  "원본·CC0·재배포 허용 라이선스·명시적 허가만 통과합니다. 이 입력은 현재 로컬 정책 점검용이며 증빙 원문을 서버에 저장하지 않습니다.",
                  "studio.assetMenu.publishDialog.rightsCheckDescription"
                )}
              </p>
            </div>
          </div>
          <label className="mt-2 block text-[0.65rem] font-semibold text-fg-2">
            {localizeText(t, "자료 출처", "studio.assetMenu.publishDialog.originLabel")}
            <select
              value={publishOrigin}
              onChange={(event) => setPublishOrigin(
                event.target.value as StudioMarketplaceOrigin
              )}
              className={cx(
                TOUCH_CONTROL_CLASS,
                "mt-1 w-full rounded-lg border border-line bg-card px-2 text-xs font-normal text-fg outline-none focus:border-accent"
              )}
            >
              <option value="original-handmade">{localizeText(t, "직접 만든 원본", "studio.assetMenu.publishOrigin.originalHandmade")}</option>
              <option value="original-procedural">{localizeText(t, "직접 만든 절차형 원본", "studio.assetMenu.publishOrigin.originalProcedural")}</option>
              <option value="cc0">{localizeText(t, "CC0 자료", "studio.assetMenu.publishOrigin.cc0")}</option>
              <option value="permissive">{localizeText(t, "재배포 허용 퍼미시브 라이선스", "studio.assetMenu.publishOrigin.permissive")}</option>
              <option value="explicit-permission">{localizeText(t, "권리자의 명시적 허가", "studio.assetMenu.publishOrigin.explicitPermission")}</option>
            </select>
          </label>
          {externalOrigin ? (
            <>
              <label className="mt-2 block text-[0.65rem] font-semibold text-fg-2">
                {localizeText(t, "라이선스·출처 원문", "studio.assetMenu.publishDialog.originReferenceLabel")}
                <input
                  type="text"
                  value={sourceReference}
                  onChange={(event) => setSourceReference(event.target.value.slice(0, 500))}
                  placeholder={localizeText(
                    t,
                    "원문 URL 또는 출처 식별자",
                    "studio.assetMenu.publishDialog.originReferencePlaceholder"
                  )}
                  className={cx(
                    TOUCH_CONTROL_CLASS,
                    "mt-1 w-full rounded-lg border border-line bg-card px-2 text-xs font-normal text-fg outline-none focus:border-accent"
                  )}
                />
              </label>
              {(publishOrigin === "permissive" || publishOrigin === "explicit-permission") ? (
                <label className="mt-2 block text-[0.65rem] font-semibold text-fg-2">
                  {localizeText(t, "재배포 허가 근거", "studio.assetMenu.publishDialog.permissionEvidenceLabel")}
                  <input
                    type="text"
                    value={permissionEvidence}
                    onChange={(event) => setPermissionEvidence(event.target.value.slice(0, 500))}
                    placeholder={localizeText(
                      t,
                      "원본 파일 재배포 허용 조항·허가 문구",
                      "studio.assetMenu.publishDialog.permissionEvidencePlaceholder"
                    )}
                    className={cx(
                      TOUCH_CONTROL_CLASS,
                      "mt-1 w-full rounded-lg border border-line bg-card px-2 text-xs font-normal text-fg outline-none focus:border-accent"
                    )}
                  />
                </label>
              ) : null}
              <label className="mt-2 flex cursor-pointer items-start gap-2 rounded-lg border border-line bg-card p-2.5 text-xs leading-relaxed text-fg-2">
                <input
                  className="mt-0.5"
                  type="checkbox"
                  checked={redistributionPermission}
                  onChange={(event) => setRedistributionPermission(event.target.checked)}
                />
                <span>{localizeText(t, "라이선스 또는 권리자가 원본 파일의 재배포를 허용합니다.", "studio.assetMenu.publishDialog.redistributionPermissionLabel")}</span>
              </label>
            </>
          ) : null}
          <label className="mt-2 flex cursor-pointer items-start gap-2 rounded-lg border border-line bg-card p-2.5 text-xs leading-relaxed text-fg-2">
            <input
              className="mt-0.5"
              type="checkbox"
              checked={containsThirdPartyContent}
              onChange={(event) => setContainsThirdPartyContent(event.target.checked)}
            />
            <span>{localizeText(t, "제3자가 만든 요소가 포함되어 있습니다.", "studio.assetMenu.publishDialog.thirdPartyContentLabel")}</span>
          </label>
          <label className="mt-2 flex cursor-pointer items-start gap-2 rounded-lg border border-line bg-card p-2.5 text-xs leading-relaxed text-fg-2">
            <input
              className="mt-0.5"
              type="checkbox"
              checked={marketplaceDerivativeFree}
              onChange={(event) => setMarketplaceDerivativeFree(event.target.checked)}
            />
            <span>{localizeText(t, "다른 에셋 마켓의 유·무료 상품을 복제하거나 알아볼 수 있게 변형한 자료가 아닙니다.", "studio.assetMenu.publishDialog.marketplaceDerivativeLabel")}</span>
          </label>
        </div>

        <label className="mt-2 flex cursor-pointer items-start gap-2 rounded-lg border border-line bg-card p-3 text-xs leading-relaxed text-fg-2">
          <input className="mt-0.5" type="checkbox" checked={rightsConfirmed} onChange={(event) => setRightsConfirmed(event.target.checked)} />
          <span>{localizeText(t, "직접 제작했거나 이 조건으로 공유·재배포할 권한이 있으며, 타인의 권리를 침해하지 않음을 확인합니다.", "studio.assetMenu.publishDialog.rightsConfirmedLabel")}</span>
        </label>
        <ul
          className="mt-2 grid gap-1"
          aria-label={localizeText(t, "공유 권리 검사 결과", "studio.assetMenu.publishDialog.rightsChecklistAriaLabel")}
        >
          {rightsDecision.checks.map((check) => (
            <li
              key={check.id}
              className={cx(
                "flex items-start gap-1.5 rounded-md px-2 py-1.5 text-[0.6rem] leading-relaxed",
                check.passed ? "bg-good/8 text-good" : "bg-warn/8 text-warn"
              )}
            >
              {check.passed
                ? <Check size={12} className="mt-0.5 shrink-0" aria-hidden />
                : <Flag size={12} className="mt-0.5 shrink-0" aria-hidden />}
              <span><strong className="font-bold">{check.label}</strong> · {check.message}</span>
            </li>
          ))}
        </ul>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onClose}
            className={cx(TOUCH_CONTROL_CLASS, "rounded-lg border border-line bg-card text-xs font-semibold text-fg-2 hover:bg-raised")}
          >
            {localizeText(t, "취소", "studio.assetMenu.cancel")}
          </button>
          <button
            type="button"
            disabled={!rightsDecision.allowed || publishing}
            onClick={() => onPublish({
              description,
              tags: tags.split(","),
              license,
              attributionText,
              containsAi,
              rightsConfirmed: true,
            })}
            className={cx(TOUCH_CONTROL_CLASS, "inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent text-xs font-bold text-on-accent disabled:cursor-not-allowed disabled:opacity-50")}
          >
            {publishing ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Share2 size={14} aria-hidden />}
            {publishing
              ? localizeText(t, "검증·공유 중", "studio.assetMenu.publishDialog.publishing")
              : localizeText(t, "조건에 동의하고 공유", "studio.assetMenu.publishDialog.publishAction")}
          </button>
        </div>
      </div>
    </div>
  );
}

function RenameAssetInline({
  asset,
  renamingAssetName,
  setRenamingAssetName,
  setRenamingAssetId,
  handleRenameAsset,
}: {
  asset: StudioAsset;
  renamingAssetName: string;
  setRenamingAssetName: Dispatch<SetStateAction<string>>;
  setRenamingAssetId: Dispatch<SetStateAction<string | null>>;
  handleRenameAsset: (id: string) => void;
}) {
  const t = useT();
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      handleRenameAsset(asset.id);
    } else if (event.key === "Escape") {
      setRenamingAssetId(null);
    }
  };

  return (
    <div className="mt-1 flex w-full flex-col gap-1">
      <input
        type="text"
        value={renamingAssetName}
        onChange={(event) => setRenamingAssetName(event.target.value)}
        aria-label={`${asset.name} ${localizeText(t, "새 이름", "studio.assetMenu.renameAssetNewName")}`}
        className={cx(
          TOUCH_CONTROL_CLASS,
          "w-full min-w-0 rounded-md border border-accent bg-panel px-2 text-[0.62rem] text-fg-1 outline-none"
        )}
        // eslint-disable-next-line jsx-a11y/no-autofocus -- inline rename field opens only on user action; focusing it immediately is correct edit-on-demand UX
        autoFocus
        onKeyDown={onKeyDown}
      />
      <div className="grid grid-cols-2 gap-1">
        <button
          type="button"
          onClick={() => handleRenameAsset(asset.id)}
          disabled={!renamingAssetName.trim()}
          className={cx(
            "flex min-h-11 items-center justify-center rounded-md bg-accent text-on-accent transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-55",
            CONTROL_FOCUS_CLASS
          )}
          title={localizeText(t, "이름 저장", "studio.assetMenu.renameAssetSave")}
          aria-label={`${asset.name} ${localizeText(t, "이름 저장", "studio.assetMenu.renameAssetSave")}`}
        >
          <Check size={15} aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => setRenamingAssetId(null)}
          className={cx(
            "flex min-h-11 items-center justify-center rounded-md border border-line bg-panel text-fg-3 transition-colors hover:bg-raised",
            CONTROL_FOCUS_CLASS
          )}
          title={localizeText(t, "이름 변경 취소", "studio.assetMenu.renameAssetCancel")}
          aria-label={`${asset.name} ${localizeText(t, "이름 변경 취소", "studio.assetMenu.renameAssetCancel")}`}
        >
          <X size={15} aria-hidden />
        </button>
      </div>
    </div>
  );
}

function SharedAssetGrid({
  shared,
  filteredShared,
  sharedLoading,
  sharedLoadingMore,
  sharedHasMore,
  sharedError,
  loadSharedAssets,
  loadMoreSharedAssets,
  onUseSharedAsset,
  onDeleteSharedAsset,
  onReportSharedAsset,
  favoriteState,
  favoriteOnly,
  onToggleFavorite,
}: Pick<
  StudioAssetMenuPanelProps,
  "shared" | "sharedLoading" | "sharedLoadingMore" | "sharedHasMore" | "sharedError" | "loadSharedAssets" | "loadMoreSharedAssets" | "onUseSharedAsset" | "onDeleteSharedAsset" | "onReportSharedAsset"
  | "favoriteState"
  | "favoriteOnly"
  | "onToggleFavorite"
> & {
  filteredShared: SharedAssetCatalogItem[];
}) {
  const [openActionsId, setOpenActionsId] = useState<string | null>(null);
  const [reportAsset, setReportAsset] = useState<SharedAssetCatalogItem | null>(null);
  const t = useT();

  if (sharedLoading) {
    return (
      <div className="flex h-32 items-center justify-center text-fg-3">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }
  if (sharedError) {
    return (
      <div className="flex h-32 flex-col items-center justify-center rounded-lg border border-dashed border-line p-4 text-center">
        <p className="text-xs text-fg-3">{sharedError}</p>
        <button
          type="button"
          onClick={loadSharedAssets}
          className={cx(
            TOUCH_CONTROL_CLASS,
            "mt-2 rounded-md border border-line px-3 text-[0.65rem] font-semibold text-fg-2 transition-colors hover:bg-raised"
          )}
        >
          {localizeText(t, "다시 시도", "studio.assetMenu.retry")}
        </button>
      </div>
    );
  }
  if (shared.length === 0) {
    return (
      <div
        data-studio-asset-empty="true"
        className="relative flex h-36 flex-col items-center justify-center overflow-hidden rounded-2xl border border-dashed border-line/80 p-4 text-center"
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            backgroundImage:
              "radial-gradient(oklch(0.72 0.185 42 / 0.08) 0.7px, transparent 0.8px)",
            backgroundSize: "9px 9px",
          }}
        />
        <p className="relative text-xs font-semibold text-fg-2">
          {localizeText(t, "아직 공유된 에셋이 없어요", "studio.assetMenu.emptySharedAssetsTitle")}
        </p>
        <p className="relative mt-1 max-w-[28ch] text-[0.6rem] leading-normal text-fg-3">
          {localizeText(t, "내 에셋 탭에서 공유 버튼을 눌러 첫 에셋을 올려보세요.", "studio.assetMenu.emptySharedAssetsDescription")}
        </p>
      </div>
    );
  }
  if (filteredShared.length === 0) {
    return favoriteOnly ? <EmptyFavoriteResult /> : <EmptySearchResult />;
  }
  return (
    <>
      {reportAsset && (
        <ReportAssetDialog
          asset={reportAsset}
          onClose={() => setReportAsset(null)}
          onReport={(reason, details) => {
            onReportSharedAsset(reportAsset, reason, details);
            setReportAsset(null);
          }}
        />
      )}
      <div data-studio-asset-grid="true" className="grid max-h-64 grid-cols-3 gap-2 overflow-y-auto pr-1">
      {filteredShared.map((asset) => {
        const actionRegionId = `shared-asset-actions-${asset.id}`;
        const actionsOpen = openActionsId === asset.id;
        const favoriteId = createStudioAssetFavoriteId("community", asset.id);

        return (
          <div
            key={asset.id}
            data-studio-asset-card="true"
            className="group relative flex cursor-grab flex-col items-stretch rounded-xl border border-line/80 bg-card p-1.5 shadow-[inset_0_1px_0_oklch(0.97_0.01_85/0.04)] transition-[border-color,box-shadow,transform] duration-150 hover:-translate-y-0.5 hover:border-accent/50 hover:shadow-md focus-within:border-accent/50 active:cursor-grabbing"
            draggable
            onDragStart={(event) => dragSharedAssetData(event, asset)}
          >
            <AssetFavoriteButton
              assetName={asset.name}
              favoriteId={favoriteId}
              favoriteState={favoriteState}
              onToggleFavorite={onToggleFavorite}
            />
            <button
              type="button"
              onClick={() => void onUseSharedAsset(asset)}
              className={cx(
                "relative flex h-20 w-full cursor-pointer items-center justify-center overflow-hidden rounded-lg",
                CONTROL_FOCUS_CLASS
              )}
              style={{
                backgroundColor: "oklch(0.22 0.01 66)",
                backgroundImage:
                  "linear-gradient(45deg, oklch(0.26 0.01 66) 25%, transparent 25%), linear-gradient(-45deg, oklch(0.26 0.01 66) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, oklch(0.26 0.01 66) 75%), linear-gradient(-45deg, transparent 75%, oklch(0.26 0.01 66) 75%)",
                backgroundSize: "10px 10px",
                backgroundPosition: "0 0, 0 5px, 5px -5px, -5px 0",
              }}
              title={`${asset.name} · ${asset.author.name} · ${localizeText(
                t,
                "선택한 컷 또는 현재 보이는 위치에 추가",
                "studio.assetMenu.addToCurrentView"
              )}`}
              aria-label={`${asset.name} ${localizeText(
                t,
                "선택한 컷 또는 현재 보이는 위치에 추가",
                "studio.assetMenu.addToCurrentView"
              )}`}
            >
              <img
                src={asset.previewDataUrl}
                alt=""
                className="max-h-full max-w-full object-contain drop-shadow-sm transition-transform duration-150 group-hover:scale-105"
              />
              {asset.containsAi && (
                <span className="pointer-events-none absolute left-1 top-1 inline-flex items-center gap-0.5 rounded-md bg-accent px-1 py-px text-[0.5rem] font-bold text-on-accent shadow">
                  <Sparkles size={7} aria-hidden /> AI
                </span>
              )}
              <span className="pointer-events-none absolute bottom-1 right-1 inline-flex items-center gap-0.5 rounded-md border border-line/40 bg-panel/90 px-1.5 py-0.5 text-[0.55rem] font-semibold text-fg shadow-sm backdrop-blur-sm">
                <Plus size={10} aria-hidden /> {localizeText(t, "추가", "studio.assetMenu.cardAction.add")}
              </span>
            </button>
            <span className="mt-1 block w-full truncate text-center text-[0.6rem] font-medium text-fg-2" title={asset.name}>
              {asset.name}
            </span>
            <span className="block w-full truncate text-center text-[0.55rem] text-fg-3">{asset.author.name}</span>
            <span className="mt-1 block truncate rounded bg-raised px-1 py-0.5 text-center text-[0.52rem] font-semibold text-fg-3" title={creatorAssetLicenseOf(asset.license).label}>
              {asset.licenseLabel ?? creatorAssetLicenseOf(asset.license).shortLabel}
              {asset.commercialUse === false ? ` · ${localizeText(t, "비상업", "studio.assetMenu.commerciality.nonCommercial")}` : ""}
            </span>
            {asset.isOwner && asset.moderationStatus && asset.moderationStatus !== "published" && (
              <span className="mt-1 text-center text-[0.52rem] font-semibold text-warn">
                {asset.moderationStatus === "under_review"
                  ? localizeText(t, "검수 중", "studio.assetMenu.moderationStatus.underReview")
                  : localizeText(t, "게시 거절", "studio.assetMenu.moderationStatus.rejected")}
              </span>
            )}
            <button
              type="button"
              onClick={() => setOpenActionsId((current) => (current === asset.id ? null : asset.id))}
              className={cx(CARD_ACTION_CLASS, "mt-1 border border-line bg-panel text-fg-2 hover:bg-raised")}
              aria-expanded={actionsOpen}
              aria-controls={actionRegionId}
              aria-label={`${asset.name} ${asset.isOwner
                ? localizeText(t, "공유 관리 작업", "studio.assetMenu.manageSharedActions")
                : localizeText(t, "공유 작업", "studio.assetMenu.shareActions")
              } ${actionsOpen ? t("common.close") : t("common.open")}`}
            >
              <MoreHorizontal size={15} aria-hidden /> {localizeText(t, "작업", "studio.assetMenu.actions")}
            </button>
            {actionsOpen && (
              <div
                id={actionRegionId}
                role="group"
                aria-label={`${asset.name} ${asset.isOwner ? localizeText(t, "공유 관리 작업", "studio.assetMenu.manageSharedActions") : localizeText(t, "공유 작업", "studio.assetMenu.shareActions")}`}
                className="mt-1 border-t border-line/60 pt-1"
              >
                {asset.isOwner ? (
                    <button
                      type="button"
                      onClick={() => {
                        setOpenActionsId(null);
                        onDeleteSharedAsset(asset.id);
                      }}
                      className={cx(CARD_ACTION_CLASS, "bg-bad/5 text-bad hover:bg-bad/10")}
                      aria-label={`${asset.name} ${localizeText(t, "공유 취소", "studio.assetMenu.deleteSharedAsset")}`}
                    >
                      <Trash2 size={13} aria-hidden /> {localizeText(t, "공유 취소", "studio.assetMenu.deleteSharedAsset")}
                    </button>
                ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setOpenActionsId(null);
                        setReportAsset(asset);
                      }}
                      className={cx(CARD_ACTION_CLASS, "bg-bad/5 text-bad hover:bg-bad/10")}
                      aria-label={`${asset.name} ${localizeText(t, "신고", "studio.assetMenu.report")}`}
                    >
                      <Flag size={13} aria-hidden /> {localizeText(t, "신고", "studio.assetMenu.report")}
                    </button>
                )}
              </div>
            )}
          </div>
        );
      })}
      </div>
      {sharedHasMore && (
        <button
          type="button"
          onClick={loadMoreSharedAssets}
          disabled={sharedLoadingMore}
          className={cx(TOUCH_CONTROL_CLASS, "mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-line bg-card text-[0.65rem] font-semibold text-fg-2 hover:bg-raised disabled:opacity-55")}
        >
          {sharedLoadingMore && <Loader2 size={13} className="animate-spin" aria-hidden />}
          {sharedLoadingMore
            ? localizeText(t, "다음 에셋 불러오는 중", "studio.assetMenu.loadMore.loading")
            : localizeText(t, "더 보기", "studio.assetMenu.loadMore")}
        </button>
      )}
    </>
  );
}

function ReportAssetDialog({
  asset,
  onClose,
  onReport,
}: {
  asset: SharedAssetCatalogItem;
  onClose: () => void;
  onReport: (reason: CreatorAssetReportReason, details: string) => void;
}) {
  const [reason, setReason] = useState<CreatorAssetReportReason>("copyright");
  const [details, setDetails] = useState("");
  const t = useT();
  return (
    <div
      className="fixed inset-0 z-[120] grid place-items-center bg-black/55 p-4"
      role="presentation"
    >
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
        aria-label={localizeText(t, "신고 닫기", "studio.assetMenu.reportDialog.close")}
      />
      <div role="dialog" aria-modal="true" aria-labelledby="report-asset-title" className="relative w-full max-w-sm rounded-2xl border border-line bg-panel p-4 shadow-2xl">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 id="report-asset-title" className="text-sm font-bold text-fg">
              {localizeText(t, "에셋 신고", "studio.assetMenu.reportDialog.title")}
            </h3>
            <p className="mt-1 text-[0.65rem] text-fg-3">
              {localizeText(
                t,
                "{assetName}의 문제를 검수자에게 전달합니다.",
                "studio.assetMenu.reportDialog.subtitle",
                { assetName: asset.name }
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={cx("grid size-11 place-items-center rounded-lg text-fg-3 hover:bg-raised", CONTROL_FOCUS_CLASS)}
            aria-label={localizeText(t, "신고 닫기", "studio.assetMenu.reportDialog.close")}
          >
            <X size={17} aria-hidden />
          </button>
        </div>
        <label className="mt-3 block text-[0.65rem] font-semibold text-fg-2">
          {localizeText(t, "사유", "studio.assetMenu.reportDialog.reasonLabel")}
          <select value={reason} onChange={(event) => setReason(event.target.value as CreatorAssetReportReason)} className={cx(TOUCH_CONTROL_CLASS, "mt-1 w-full rounded-lg border border-line bg-card px-2 text-xs font-normal text-fg outline-none focus:border-accent")}>
            {CREATOR_ASSET_REPORT_REASONS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
        <label className="mt-2 block text-[0.65rem] font-semibold text-fg-2">
          {localizeText(t, "상세 설명", "studio.assetMenu.reportDialog.detailsLabel")}
          <textarea
            value={details}
            onChange={(event) => setDetails(event.target.value.slice(0, 500))}
            rows={4}
            placeholder={localizeText(t, "검수에 필요한 구체적인 내용을 적어 주세요.", "studio.assetMenu.reportDialog.detailsPlaceholder")}
            className="mt-1 w-full resize-none rounded-lg border border-line bg-card p-2 text-xs font-normal text-fg outline-none focus:border-accent"
          />
        </label>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onClose}
            className={cx(TOUCH_CONTROL_CLASS, "rounded-lg border border-line bg-card text-xs font-semibold text-fg-2 hover:bg-raised")}
          >
            {localizeText(t, "취소", "studio.assetMenu.cancel")}
          </button>
          <button
            type="button"
            onClick={() => onReport(reason, details)}
            className={cx(TOUCH_CONTROL_CLASS, "inline-flex items-center justify-center gap-1.5 rounded-lg bg-bad text-xs font-bold text-white")}
          >
            <Flag size={14} aria-hidden />
            {localizeText(t, "신고 제출", "studio.assetMenu.reportSubmit")}
          </button>
        </div>
      </div>
    </div>
  );
}

function EmptySearchResult() {
  const t = useT();
  return (
    <div className="flex h-32 flex-col items-center justify-center rounded-lg border border-dashed border-line p-4 text-center">
      <p className="text-xs text-fg-3">{localizeText(t, "검색 결과가 없습니다.", "studio.assetMenu.emptySearchResultTitle")}</p>
      <p className="mt-1 text-[0.6rem] leading-normal text-fg-3">
        {localizeText(t, "다른 검색어로 찾아보세요.", "studio.assetMenu.emptySearchResultDescription")}
      </p>
    </div>
  );
}

function EmptyFavoriteResult() {
  const t = useT();
  return (
    <div
      role="status"
      className="flex h-32 flex-col items-center justify-center rounded-lg border border-dashed border-line p-4 text-center"
    >
      <Star size={18} className="text-fg-3" aria-hidden />
      <p className="mt-2 text-xs font-semibold text-fg-2">
        {localizeText(t, "조건에 맞는 즐겨찾기가 없습니다.", "studio.assetMenu.emptyFavoriteResultTitle")}
      </p>
      <p className="mt-1 text-[0.6rem] leading-normal text-fg-3">
        {localizeText(t, "별표를 추가하거나 검색 조건을 바꿔보세요.", "studio.assetMenu.emptyFavoriteResultDescription")}
      </p>
    </div>
  );
}
