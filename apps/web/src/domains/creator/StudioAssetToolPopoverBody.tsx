import {
  Bookmark,
  Clapperboard,
  Folder,
  Grid2x2,
  LayoutTemplate,
  Library,
  PenTool,
  ScanLine,
  Search,
  Shapes,
  Sticker as StickerIcon,
  Trash2,
  Wind,
  X,
} from "lucide-react";
import { Suspense } from "react";

import { StudioSceneTemplateBrowser } from "./catalog/studio-catalog-lazy-ui";
import { completeStudioAssetInsertion } from "./studio-asset-insertion-outcome";
import { CANVAS_W, TEMPLATES, groupTemplates } from "./studio-assets";
import { svgToDataUrl } from "./studio-characters";
import { StudioMenuPopoverHeader, StudioMenuSubtabs } from "./studio-chrome-ui";
import { writeStudioInsertDragPayload } from "./studio-insert-drag-writer";
import {
  StudioAssetMenuPanel,
  StudioCollagePanel,
  StudioElementsPanel,
  StudioEmeresLibraryPanel,
  StudioRasterAssetGrid,
  StudioStickerGrid,
  preloadStudioAssetMenuPanel,
} from "./studio-page-lazy-ui";
import { hasSameCategorySiblings } from "./studio-similar-style";
import { StudioPanelLoading } from "./StudioLazySurfaceFallback";
import { useStudioCommunityMarketplaceInitialView } from "./use-studio-community-marketplace-initial-view";

import type { StudioMenu } from "./studio-editor-tool-model";
import type { ImageEl } from "./studio-element-model";
import type {
  FxPickerSection,
  StudioToolBeltContentProps,
} from "./StudioToolBeltContent";

import { cn } from "@/shared/lib/utils";

const TEMPLATE_GROUPS = groupTemplates(TEMPLATES);

const FX_PICKER_SECTIONS: { id: FxPickerSection; label: string }[] = [
  { id: "all", label: "전체" },
  { id: "raster", label: "장면 소품" },
  { id: "sfx", label: "효과음" },
  { id: "emoji", label: "이모지" },
  { id: "comic", label: "만화 스티커" },
  { id: "creature", label: "동물·캐릭터" },
  { id: "prop", label: "소품·오브젝트" },
  { id: "lines", label: "선 효과" },
  { id: "overlay", label: "특수 효과" },
];

export interface StudioAssetToolPopoverBodyProps {
  readonly toolBelt: StudioToolBeltContentProps;
}

export function StudioAssetToolPopoverBody({
  toolBelt,
}: StudioAssetToolPopoverBodyProps) {
  const communityMarketplaceInitialView =
    useStudioCommunityMarketplaceInitialView();
  const {
    assetFavoriteOnly,
    assetFavoriteState,
    assetGenerating,
    assetPrompt,
    assetPromptName,
    assetPromptQuality,
    assetPromptSize,
    assets,
    assetSearchQuery,
    assetsLoading,
    assetSortOrder,
    assetTab,
    builtinRasterBusyId,
    clips,
    elements,
    emeresCategoryFilter,
    emeresFlatCatalog,
    emeresSearchQuery,
    emeresSectionsFiltered,
    emeresSimilarAnchor,
    emeresSimilarSiblings,
    emeresTab,
    emeresUnderlayCount,
    fxComicFiltered,
    fxCreatureFiltered,
    fxEmojisFiltered,
    fxLinePresetsFiltered,
    fxOverlaysFiltered,
    fxPickerHasResults,
    fxPickerSection,
    fxPropFiltered,
    fxQuery,
    fxRasterFiltered,
    fxSearchQuery,
    fxSectionVisible,
    fxSfxFiltered,
    menu,
    panelLayoutPresets,
    panelLayoutsError,
    panelLayoutsLoading,
    publishingId,
    rasterFavoriteOnly,
    renamingAssetId,
    renamingAssetName,
    sceneTemplates,
    sceneTemplatesError,
    sceneTemplatesLoading,
    selected,
    setAssetFavoriteOnly,
    setAssetPrompt,
    setAssetPromptName,
    setAssetPromptSize,
    setAssetPromptQuality,
    setAssetSearchQuery,
    setAssetSortOrder,
    setAssetTab,
    setEmeresCategoryFilter,
    setEmeresSearchQuery,
    setEmeresSimilarAnchorId,
    setEmeresTab,
    setFxPickerSection,
    setFxSearchQuery,
    setMenu,
    setRasterFavoriteOnly,
    setRenamingAssetId,
    setRenamingAssetName,
    sfxError,
    sfxLoading,
    sfxPacks,
    shared,
    sharedError,
    sharedHasMore,
    sharedLoading,
    sharedLoadingMore,
    studioEmeresAssetsError,
    studioEmeresAssetsLoaded,
    studioEmeresAssetsLoading,
    studioOptionalAssets,
    studioSfx,
    studioStickerAssetsError,
    studioStickerAssetsLoaded,
    studioStickerAssetsLoading,
  } = toolBelt;
  const {
    addBuiltinRasterAsset,
    addCatalogElement,
    openStudioObjectInsert,
    addEmeresLibraryItem,
    addEmeresTemplate,
    addFocusLines,
    addFxOverlay,
    addRenderedImage,
    addSceneTemplate,
    addSfxPreset,
    addSpeedLines,
    addSticker,
    applyCollage,
    applyPanelLayout,
    applyTemplate,
    deleteClip,
    handleRenameAsset,
    insertClip,
    loadSharedAssets,
    loadMoreSharedAssets,
    onDeleteAsset,
    onDeleteSharedAsset,
    onReportSharedAsset,
    onGenerateAsset,
    onShareAsset,
    onUploadAsset,
    onUseSharedAsset,
    removeEmeresUnderlays,
    saveSelectionAsClip,
    toggleAssetFavorite,
  } = toolBelt.stableHandlers;

  return (
    <>
              <StudioMenuPopoverHeader
                icon={Folder}
                title="템플릿 · 에셋"
                description="컷 템플릿·콜라주·요소·장면·클립·효과·내 에셋을 한 메뉴에서 고릅니다."
              />
              <StudioMenuSubtabs
                aria-label="에셋 메뉴 구역"
                activeId={menu}
                onSelect={(id) => {
                  if (id === "asset") preloadStudioAssetMenuPanel();
                  setMenu(id as StudioMenu);
                }}
                items={[
                  { id: "template", label: "템플릿", icon: LayoutTemplate, title: "캔버스·컷 레이아웃 템플릿" },
                  { id: "collage", label: "콜라주", icon: Grid2x2, title: "이미지 콜라주 배치" },
                  { id: "elements", label: "요소", icon: Shapes, title: "도형·장식 요소" },
                  { id: "emeres", label: "이메레스", icon: PenTool, title: "스케치 밑그림 틀" },
                  { id: "scene", label: "장면", icon: Clapperboard, title: "장면 템플릿" },
                  { id: "clip", label: "클립", icon: Bookmark, title: "저장된 클립" },
                  { id: "sticker", label: "효과", icon: StickerIcon, title: "만화 효과·스티커" },
                  { id: "asset", label: "내 에셋", icon: Library, title: "업로드·생성한 에셋" },
                ]}
              />
              {menu === "template" && (
                <div className="grid gap-1.5 lg:max-h-80 lg:overflow-y-auto lg:pr-1">
                  <p className="px-1 text-[0.66rem] font-medium text-fg-3">캔버스 템플릿</p>
                  <p className="rounded-xl border border-line bg-card/75 px-2.5 py-2 text-[0.62rem] leading-relaxed text-fg-3">
                    캔버스 전체를 바꾸는 템플릿은 <strong className="font-semibold text-fg-2">클릭·탭으로 적용</strong>합니다.
                    위치를 고르는 도형·말풍선·에셋은 각 라이브러리에서 끌어 놓을 수 있어요.
                  </p>
                  {TEMPLATE_GROUPS.map((group) => (
                    <div key={group.group} className="grid gap-1">
                      <p className="px-1 text-[0.66rem] font-semibold uppercase tracking-wide text-fg-3">{group.group}</p>
                      {group.templates.map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => applyTemplate(t)}
                          className="flex min-h-11 items-center justify-between gap-2 rounded-lg px-3 text-left text-xs hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                        >
                          <span className="font-medium text-fg">{t.label}</span>
                          <span className="text-fg-3">{t.hint}</span>
                        </button>
                      ))}
                    </div>
                  ))}
                  {/* 코미Po!식 정형 컷 레이아웃 — 프레임(+말풍선)을 한 번에 배치 */}
                  <div className="grid gap-1 border-t border-line pt-1.5">
                    <p className="px-1 text-[0.66rem] font-semibold uppercase tracking-wide text-fg-3">컷 템플릿 · 정형 레이아웃</p>
                    {panelLayoutsLoading && panelLayoutPresets.length === 0 && (
                      <p className="rounded-lg border border-line bg-card px-2 py-2 text-xs text-fg-3">컷 레이아웃을 불러오는 중...</p>
                    )}
                    {panelLayoutsError && (
                      <p className="rounded-lg border border-bad/40 bg-bad/10 px-2 py-2 text-xs text-bad">{panelLayoutsError}</p>
                    )}
                    {panelLayoutPresets.map((layout) => (
                      <button
                        key={layout.id}
                        type="button"
                        onClick={() => void applyPanelLayout(layout)}
                        className="flex min-h-11 items-center justify-between gap-2 rounded-lg px-3 text-left text-xs hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                      >
                        <span className="font-medium text-fg">{layout.label}</span>
                        <span className="text-fg-3">{layout.hint}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {menu === "collage" && (
                <Suspense fallback={<StudioPanelLoading label="콜라주 패널을 여는 중..." />}>
                  <StudioCollagePanel
                    canvasW={CANVAS_W}
                    availableImages={elements
                      .filter((el): el is ImageEl => el.type === "image" && !el.hidden)
                      .map((el) => ({
                        id: el.id,
                        width: el.width,
                        height: el.height,
                      }))}
                    onApply={applyCollage}
                  />
                </Suspense>
              )}
              {menu === "elements" && (
                <Suspense fallback={<StudioPanelLoading label="요소 패널을 여는 중..." />}>
                  <StudioElementsPanel
                    onAdd={(item) => {
                      addCatalogElement(item);
                    }}
                    onOpenBubbles={() => setMenu("bubble")}
                    canvasWidth={CANVAS_W}
                    canvasHeight={1_200}
                    onOpenObjectInsert={({ plan }) => {
                      // Canva-style Elements → production 3D tools with one-shot seed.
                      setMenu(null);
                      openStudioObjectInsert({
                        openTarget: plan.openTarget,
                        sourceId: plan.sourceId,
                      });
                    }}
                  />
                </Suspense>
              )}
              {menu === "emeres" && (
                <>
                  <p className="mb-1.5 text-[0.66rem] font-medium text-fg-3">이메레스 · 스케치 밑그림 틀</p>
                  <p className="mb-2 rounded-lg border border-line bg-card px-2 py-1.5 text-[0.66rem] leading-snug text-fg-3">
                    선택한 틀이 반투명·잠금 밑그림으로 깔리고 펜 모드로 바뀌어요. 그 위에 따라 그린 뒤, 레이어 패널에서 밑그림을 숨기거나 지우세요.
                  </p>
                  {emeresUnderlayCount > 0 && (
                    <button
                      type="button"
                      onClick={removeEmeresUnderlays}
                      className="mb-2 flex w-full items-center justify-center gap-1 rounded-lg border border-bad/40 py-1 text-[0.64rem] font-semibold text-bad transition-colors hover:bg-bad/10"
                    >
                      <Trash2 size={11} /> 밑그림 전부 지우기 ({emeresUnderlayCount})
                    </button>
                  )}
                  <div className="mb-2 flex rounded-lg border border-line bg-card p-0.5">
                    {(["catalog", "mine"] as const).map((tab) => (
                      <button
                        key={tab}
                        type="button"
                        onClick={() => setEmeresTab(tab)}
                        aria-pressed={emeresTab === tab}
                        className={cn(
                          "flex-1 rounded-md py-1 text-[0.64rem] font-semibold transition-colors",
                          emeresTab === tab ? "bg-accent text-white" : "text-fg-3 hover:bg-raised"
                        )}
                      >
                        {tab === "catalog" ? "기본 틀" : "내가 만든 틀"}
                      </button>
                    ))}
                  </div>
                  {emeresTab === "catalog" ? (
                    <>
                      {emeresSimilarAnchor && (
                        <div id="emeres-similar-strip" className="mb-2 rounded-lg border border-accent/30 bg-accent/5 p-2">
                          <div className="mb-1 flex items-center justify-between gap-2">
                            <p className="truncate text-[0.66rem] font-semibold text-fg-2">
                              &ldquo;{emeresSimilarAnchor.label}&rdquo;과(와) 비슷한 스타일
                            </p>
                            <button
                              type="button"
                              onClick={() => setEmeresSimilarAnchorId(null)}
                              aria-label="비슷한 스타일 닫기"
                              className="shrink-0 p-0.5 text-fg-3 hover:text-fg-2"
                            >
                              <X size={12} />
                            </button>
                          </div>
                          {emeresSimilarSiblings.length === 0 ? (
                            <p className="text-[0.64rem] text-fg-3">같은 카테고리의 다른 틀이 없어요.</p>
                          ) : (
                            <div className="flex gap-1.5 overflow-x-auto pb-1">
                              {emeresSimilarSiblings.map((sib) => (
                                <button
                                  key={sib.id}
                                  type="button"
                                  title={`${sib.label} — ${sib.tip}`}
                                  onClick={() => addEmeresTemplate(sib)}
                                  className="w-16 shrink-0 overflow-hidden rounded-lg border border-line bg-card p-1 hover:border-accent/50"
                                >
                                  <div className="flex h-12 w-full items-center justify-center overflow-hidden rounded bg-[oklch(0.96_0.006_78)]">
                                    <img src={svgToDataUrl(sib.svg)} alt={sib.label} className="h-full w-full object-contain" />
                                  </div>
                                  <span className="mt-0.5 block truncate text-center text-[0.58rem] text-fg-3">{sib.label}</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                      <div className="relative mb-2">
                        <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-fg-3" />
                        <input
                          type="text"
                          placeholder="이메레스 검색..."
                          value={emeresSearchQuery}
                          onChange={(e) => setEmeresSearchQuery(e.target.value)}
                          className="w-full rounded-lg border border-line bg-card py-1 pl-6 pr-5 text-[0.65rem] placeholder:text-fg-3 outline-none focus:border-accent focus:ring-1 focus:ring-accent/40 transition-colors"
                        />
                        {emeresSearchQuery && (
                          <button
                            type="button"
                            onClick={() => setEmeresSearchQuery("")}
                            aria-label="검색어 지우기" className="absolute right-1 top-1/2 -translate-y-1/2 p-1 text-fg-3 hover:text-fg-2 transition-colors"
                          >
                            <X size={12} />
                          </button>
                        )}
                      </div>
                      {studioOptionalAssets.emeresSections.length > 0 && (
                        <div className="mb-2 flex flex-wrap gap-1">
                          {["all", ...studioOptionalAssets.emeresSections.map((section) => section.category)].map((category) => (
                            <button
                              key={category}
                              type="button"
                              onClick={() => setEmeresCategoryFilter(category)}
                              aria-pressed={emeresCategoryFilter === category}
                              className={cn(
                                "rounded-full border px-2 py-0.5 text-[0.66rem] font-medium transition-colors",
                                emeresCategoryFilter === category ? "border-accent bg-accent text-white" : "border-line bg-card text-fg-3 hover:bg-raised"
                              )}
                            >
                              {category === "all" ? "전체" : category}
                            </button>
                          ))}
                        </div>
                      )}
                      <div className="max-h-64 space-y-2.5 overflow-y-auto pr-1">
                        {studioEmeresAssetsLoading && !studioEmeresAssetsLoaded && (
                          <p className="rounded-lg border border-line bg-card px-2 py-2 text-xs text-fg-3">이메레스 틀을 불러오는 중...</p>
                        )}
                        {studioEmeresAssetsError && (
                          <p className="rounded-lg border border-bad/40 bg-bad/10 px-2 py-2 text-xs text-bad">{studioEmeresAssetsError}</p>
                        )}
                        {studioOptionalAssets.emeresSections.length > 0 && emeresSectionsFiltered.length === 0 && (
                          <div className="flex h-32 flex-col items-center justify-center rounded-lg border border-dashed border-line p-4 text-center">
                            <p className="text-xs text-fg-3">검색 결과가 없습니다.</p>
                            <p className="mt-1 text-[0.66rem] text-fg-3 leading-normal">다른 검색어로 찾아보세요.</p>
                          </div>
                        )}
                        {emeresSectionsFiltered.map((section) => (
                          <div key={section.category}>
                            <p className="mb-1 px-0.5 text-[0.66rem] font-semibold uppercase tracking-wide text-fg-3">{section.category}</p>
                            <div className="grid grid-cols-2 gap-1.5">
                              {section.templates.map((t) => (
                                <div
                                  key={t.id}
                                  className="group relative overflow-hidden rounded-lg border border-line bg-card p-1 text-left hover:border-accent/50"
                                >
                                  <button type="button" title={`${t.label} — ${t.tip}`} onClick={() => addEmeresTemplate(t)} className="block w-full">
                                    <div className="flex h-20 w-full items-center justify-center overflow-hidden rounded bg-[oklch(0.96_0.006_78)] p-1">
                                      <img src={svgToDataUrl(t.svg)} alt={t.label} className="h-full w-full object-contain transition-transform group-hover:scale-105" />
                                    </div>
                                    <span className="mt-1 block truncate text-center text-[0.66rem] font-medium text-fg-2">{t.label}</span>
                                  </button>
                                  {hasSameCategorySiblings(emeresFlatCatalog, t.id) && (
                                    <button
                                      type="button"
                                      onClick={() => setEmeresSimilarAnchorId(t.id)}
                                      aria-controls="emeres-similar-strip"
                                      className="mt-0.5 block w-full truncate text-center text-[0.6rem] font-medium text-accent hover:underline"
                                    >
                                      비슷한 스타일 더보기
                                    </button>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <Suspense fallback={<StudioPanelLoading label="내가 만든 틀을 여는 중..." />}>
                      <StudioEmeresLibraryPanel onPickItem={addEmeresLibraryItem} />
                    </Suspense>
                  )}
                </>
              )}
              {menu === "scene" && (
                <Suspense fallback={<StudioPanelLoading label="장면 템플릿을 여는 중…" />}>
                  <StudioSceneTemplateBrowser templates={sceneTemplates.templates} categories={sceneTemplates.categories}
                    loading={sceneTemplatesLoading} error={sceneTemplatesError} onAdd={addSceneTemplate} />
                </Suspense>
              )}
              {menu === "clip" && (
                <>
                  <p className="mb-1.5 text-[0.66rem] font-medium text-fg-3">재사용 클립 보관함</p>
                  <button
                    type="button"
                    onClick={() => void saveSelectionAsClip()}
                    disabled={!selected}
                    className={cn(
                      "mb-2 w-full rounded-lg py-1.5 text-xs font-semibold transition-colors",
                      selected ? "bg-accent text-on-accent hover:opacity-90" : "cursor-not-allowed bg-card text-fg-3"
                    )}
                    title={selected ? "선택한 요소(그룹)를 클립으로 저장" : "먼저 캔버스에서 요소를 선택하세요"}
                  >
                    + 선택을 클립으로 저장
                  </button>
                  {clips.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-line px-2 py-4 text-center text-[0.66rem] leading-relaxed text-fg-3">
                      저장된 클립이 없어요. 포즈 캐릭터나 말풍선 세트를 저장해 다른 컷·회차에서 재사용하세요.
                    </p>
                  ) : (
                    <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
                      {clips.map((c) => (
                        <div key={c.id} className="flex items-center gap-1 rounded-lg border border-line bg-card px-2 py-1.5">
                          <button
                            type="button"
                            onClick={() => insertClip(c)}
                            className="min-w-0 flex-1 truncate text-left text-xs font-medium text-fg transition-colors hover:text-accent"
                            title="이 클립을 캔버스에 넣기"
                          >
                            {c.name}
                            <span className="ml-1 text-[0.66rem] text-fg-3">{(c.els as unknown[]).length}개</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => void deleteClip(c.id)}
                            aria-label={`${c.name} 클립 삭제`}
                            className="shrink-0 text-fg-3 transition-colors hover:text-bad"
                          >
                            <X size={12} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
              {menu === "sticker" && (
                <>
                  <button
                    type="button"
                    onClick={() => setMenu("elements")}
                    className="mb-2 flex w-full items-center justify-between gap-2 rounded-lg border border-line bg-card px-2.5 py-2 text-left text-xs hover:border-accent/40 hover:bg-raised"
                  >
                    <span className="inline-flex items-center gap-1.5 font-semibold text-fg">
                      <Shapes size={13} className="text-accent" aria-hidden />
                      도형 · 프레임 · 배지 요소
                    </span>
                    <span className="text-[0.62rem] text-fg-3">요소 탭 →</span>
                  </button>
                  <div className="relative mb-2">
                    <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-fg-3" />
                    <input
                      type="text"
                      placeholder="효과 검색..."
                      value={fxSearchQuery}
                      onChange={(e) => setFxSearchQuery(e.target.value)}
                      className="min-h-11 w-full rounded-lg border border-line bg-card py-1 pl-8 pr-11 text-xs placeholder:text-fg-3 outline-none transition-colors focus:border-accent focus:ring-1 focus:ring-accent/40"
                    />
                    {fxSearchQuery && (
                      <button
                        type="button"
                        onClick={() => setFxSearchQuery("")}
                        aria-label="검색어 지우기" className="absolute right-0 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-lg text-fg-3 transition-colors hover:bg-raised hover:text-fg-2"
                      >
                        <X size={12} />
                      </button>
                    )}
                  </div>
                  <div className="mb-2 flex flex-wrap gap-1">
                    {FX_PICKER_SECTIONS.map((section) => (
                      <button
                        key={section.id}
                        type="button"
                        onClick={() => setFxPickerSection(section.id)}
                        aria-pressed={fxPickerSection === section.id}
                        className={cn(
                          "min-h-8 rounded-full border px-2 text-[0.66rem] font-medium transition-colors pointer-coarse:min-h-11 pointer-coarse:px-3",
                          fxPickerSection === section.id ? "border-accent bg-accent text-white" : "border-line bg-card text-fg-3 hover:bg-raised"
                        )}
                      >
                        {section.label}
                      </button>
                    ))}
                  </div>
                  {fxSectionVisible("raster") && fxRasterFiltered.length > 0 && (
                    <Suspense fallback={<StudioPanelLoading label="장면 소품을 여는 중..." />}>
                      <StudioRasterAssetGrid
                        assets={fxRasterFiltered}
                        busyId={builtinRasterBusyId}
                        onAdd={(asset) => void addBuiltinRasterAsset(asset)}
                        favoriteState={assetFavoriteState}
                        favoriteOnly={rasterFavoriteOnly}
                        setFavoriteOnly={setRasterFavoriteOnly}
                        onToggleFavorite={toggleAssetFavorite}
                      />
                    </Suspense>
                  )}
                  {sfxLoading && !sfxPacks && fxSectionVisible("sfx") && (
                    <p className="mb-2 rounded-lg border border-line bg-card px-2 py-2 text-xs text-fg-3">효과음을 불러오는 중...</p>
                  )}
                  {sfxError && fxSectionVisible("sfx") && (
                    <p className="mb-2 rounded-lg border border-bad/40 bg-bad/10 px-2 py-2 text-xs text-bad">{sfxError}</p>
                  )}
                  {fxSectionVisible("sfx") && fxSfxFiltered.length > 0 && (
                    <>
                      <p className="mb-1 text-[0.66rem] font-medium text-fg-3">효과음</p>
                      <div className="mb-2 flex flex-wrap gap-1">
                        {fxSfxFiltered.map((s) => (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => void addSfxPreset(s)}
                            title={`${s.label} · ${studioSfx.categories.find((category) => category.id === s.category)?.label ?? ""}`}
                            className="min-h-9 rounded-md border border-line px-2 text-xs font-bold text-fg hover:bg-raised pointer-coarse:min-h-11"
                          >
                            {s.text}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                  {fxSectionVisible("emoji") && fxEmojisFiltered.length > 0 && (
                    <>
                      <p className="mb-1 text-[0.66rem] font-medium text-fg-3">이모지</p>
                      <div className="grid grid-cols-8 gap-1 mb-2">
                        {fxEmojisFiltered.map((em) => (
                          <button
                            key={em}
                            type="button"
                            onClick={() => addSticker(em)}
                            draggable
                            onDragStart={(event) => {
                              writeStudioInsertDragPayload(event.dataTransfer, {
                                kind: "sticker",
                                emoji: em,
                              });
                            }}
                            title="클릭해 추가하거나 캔버스로 끌어다 원하는 위치에 놓으세요"
                            className="grid size-9 place-items-center rounded-md text-lg hover:bg-raised pointer-coarse:size-11"
                          >
                            {em}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                  {studioStickerAssetsLoading && !studioStickerAssetsLoaded && (
                    <p className="mb-2 rounded-lg border border-line bg-card px-2 py-2 text-xs text-fg-3">스티커 에셋을 불러오는 중...</p>
                  )}
                  {studioStickerAssetsError && (
                    <p className="mb-2 rounded-lg border border-bad/40 bg-bad/10 px-2 py-2 text-xs text-bad">
                      {studioStickerAssetsError}
                    </p>
                  )}
                  <Suspense fallback={<StudioPanelLoading label="스티커 패널을 여는 중..." />}>
                    {fxSectionVisible("comic") && fxComicFiltered.length > 0 && (
                      <StudioStickerGrid title="만화 스티커" items={fxComicFiltered} onAdd={addFxOverlay} />
                    )}
                    {fxSectionVisible("creature") && fxCreatureFiltered.length > 0 && (
                      <StudioStickerGrid title="동물·캐릭터" items={fxCreatureFiltered} onAdd={addFxOverlay} />
                    )}
                    {fxSectionVisible("prop") && fxPropFiltered.length > 0 && (
                      <StudioStickerGrid title="소품·오브젝트" items={fxPropFiltered} onAdd={addFxOverlay} />
                    )}
                  </Suspense>
                  {fxSectionVisible("lines") && fxLinePresetsFiltered.length > 0 && (
                    <>
                      <p className="mb-1 mt-2 text-[0.66rem] font-medium text-fg-3 border-t border-line pt-2">만화 선 효과</p>
                      <div className="grid grid-cols-2 gap-2 mb-2">
                        {fxLinePresetsFiltered.map((preset) => (
                          <button
                            key={preset.id}
                            type="button"
                            onClick={() => {
                              if (preset.id === "focus") addFocusLines();
                              else addSpeedLines();
                              setMenu(null);
                            }}
                            className="flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-line bg-card px-2 text-xs font-semibold hover:border-accent/50 hover:bg-raised"
                          >
                            {preset.id === "focus" ? <ScanLine size={15} aria-hidden /> : <Wind size={15} aria-hidden />}
                            {preset.label}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                  {fxSectionVisible("overlay") && fxOverlaysFiltered.length > 0 && (
                    <>
                      <p className="mb-1 mt-2 text-[0.66rem] font-medium text-fg-3 border-t border-line pt-2">만화 특수 효과</p>
                      <div className="grid grid-cols-4 gap-1 max-h-40 overflow-y-auto pr-1">
                        {fxOverlaysFiltered.map((fx) => (
                          <button
                            key={fx.id}
                            type="button"
                            title={fx.label}
                            onClick={() => addFxOverlay(fx.svg, fx.width, fx.height)}
                            className="group flex flex-col items-center justify-center rounded-lg border border-line bg-card p-1 hover:border-accent/50"
                          >
                            <div className="h-10 w-full overflow-hidden bg-neutral-100 dark:bg-neutral-800 rounded flex items-center justify-center p-0.5">
                              <img src={svgToDataUrl(fx.svg)} alt={fx.label} className="h-full w-full object-contain transition-transform group-hover:scale-105" />
                            </div>
                            <span className="block text-center text-[0.55rem] text-fg-3 mt-0.5 truncate w-full">{fx.label}</span>
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                  {!fxPickerHasResults && fxQuery !== "" && (
                    <div className="flex h-32 flex-col items-center justify-center rounded-lg border border-dashed border-line p-4 text-center">
                      <p className="text-xs text-fg-3">검색 결과가 없습니다.</p>
                      <p className="mt-1 text-[0.66rem] text-fg-3 leading-normal">다른 검색어로 찾아보세요.</p>
                    </div>
                  )}
                </>
              )}
              {menu === "asset" && (
                <Suspense fallback={<StudioPanelLoading label="에셋 보관함을 여는 중..." />}>
                  <StudioAssetMenuPanel
                    assetTab={assetTab}
                    setAssetTab={setAssetTab}
                    communityMarketplaceInitialView={communityMarketplaceInitialView}
                    onUploadAsset={onUploadAsset}
                    assetPrompt={assetPrompt}
                    setAssetPrompt={setAssetPrompt}
                    assetPromptName={assetPromptName}
                    setAssetPromptName={setAssetPromptName}
                    assetPromptSize={assetPromptSize}
                    setAssetPromptSize={setAssetPromptSize}
                    assetPromptQuality={assetPromptQuality}
                    setAssetPromptQuality={setAssetPromptQuality}
                    assetGenerating={assetGenerating}
                    onGenerateAsset={onGenerateAsset}
                    assetSearchQuery={assetSearchQuery}
                    setAssetSearchQuery={setAssetSearchQuery}
                    assetSortOrder={assetSortOrder}
                    setAssetSortOrder={setAssetSortOrder}
                    favoriteState={assetFavoriteState}
                    favoriteOnly={assetFavoriteOnly}
                    setFavoriteOnly={setAssetFavoriteOnly}
                    onToggleFavorite={toggleAssetFavorite}
                    assets={assets}
                    assetsLoading={assetsLoading}
                    renamingAssetId={renamingAssetId}
                    setRenamingAssetId={setRenamingAssetId}
                    renamingAssetName={renamingAssetName}
                    setRenamingAssetName={setRenamingAssetName}
                    handleRenameAsset={handleRenameAsset}
                    onUseLocalAsset={(asset) => completeStudioAssetInsertion(
                      () => addRenderedImage(asset.dataUrl, asset.width, asset.height),
                      () => setMenu(null)
                    )}
                    onShareAsset={onShareAsset}
                    onDeleteAsset={onDeleteAsset}
                    publishingId={publishingId}
                    shared={shared}
                    sharedLoading={sharedLoading}
                    sharedLoadingMore={sharedLoadingMore}
                    sharedHasMore={sharedHasMore}
                    sharedError={sharedError}
                    loadSharedAssets={loadSharedAssets}
                    loadMoreSharedAssets={loadMoreSharedAssets}
                    onUseSharedAsset={onUseSharedAsset}
                    onDeleteSharedAsset={onDeleteSharedAsset}
                    onReportSharedAsset={onReportSharedAsset}
                  />
                </Suspense>
              )}

    </>
  );
}
