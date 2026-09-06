/**
 * StudioElementsPanel — PicsArt/Canva-class elements: shapes + 3D object insert rail.
 * 2D: search + category chips + recent MRU. Placement via onAdd(svg, w, h, id).
 * 3D: searchable catalog (primitives / props / scene templates) → openTarget routing.
 */
import { Box, Eye, Grip, MessageCircle, MousePointer2, Search, Sparkles, Star, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type DragEvent, type ReactElement } from "react";

import { queryStudioCatalog, type StudioCatalogOrientation, type StudioCatalogSort } from "./catalog/studio-catalog-query";
import { StudioCatalogControls, StudioCatalogStorageNotice, STUDIO_CATALOG_CONTROL, STUDIO_CATALOG_PRIMARY_CONTROL } from "./catalog/StudioCatalogControls";
import { StudioCatalogPreviewDialog } from "./catalog/StudioCatalogPreviewDialog";
import { useStudioCatalogPreferences } from "./catalog/use-studio-catalog-preferences";
import "./catalog/studio-catalog-browser.css";
import { svgToDataUrl } from "./studio-characters";
import {
  findStudioElement,
  listStudioElementLibrary,
  STUDIO_ELEMENT_CATEGORY_CHIPS,
  type StudioElementCategory,
  type StudioElementItem,
} from "./studio-elements-catalog";
import {
  rememberStudioElementRecent,
} from "./studio-elements-recent";
import { writeStudioAssetDragPayload } from "./studio-insert-drag-writer";
import {
  filterStudioObjectInsertItems,
  listStudioObjectInsertFamilies,
  planStudioObjectInsertPlacement,
  type StudioObjectInsertFamily,
  type StudioObjectInsertItem,
  type StudioObjectInsertPlacementPlan,
} from "./studio-object-insert-catalog";
import { writeStudioObjectInsertDragPayload } from "./studio-object-insert-drag";
import { STUDIO_EASE, STUDIO_FOCUS_RING } from "./studio-panel-ui";
import { serializeStudioLocalAssetDragPayload } from "./studio-shared-asset-drag";
import {
  acquireProductStudioUiPreferencesRepository,
  type StudioUiPreferencesRepository,
} from "./studio-ui-preferences-sqlite";
import { StudioSvgAssetPreview } from "./StudioSvgAssetPreview";

import type { StudioCatalogPreferencesRepository } from "./catalog/studio-catalog-preferences";
import type { StudioSvgProductTournament } from "./studio-svg-vello-product-router";

import { cn } from "@/shared/lib/utils";

export interface StudioElementsObjectInsertRequest {
  readonly item: StudioObjectInsertItem;
  readonly plan: StudioObjectInsertPlacementPlan;
}

export interface StudioElementsPanelProps {
  onAdd: (item: StudioElementItem) => void;
  onOpenBubbles?: () => void;
  /**
   * Canva-style 3D object pick: panel plans placement + openTarget; host opens
   * BG3D / VRM poser / template path. Omit to hide the 3D rail.
   */
  onOpenObjectInsert?: (request: StudioElementsObjectInsertRequest) => void;
  /** Canvas size used only for 3D insert placement planning. */
  canvasWidth?: number;
  canvasHeight?: number;
  previewTournament?: Pick<StudioSvgProductTournament, "resolve">;
  /** Test seam; product defaults to SQLite over OPFS. */
  acquireUiPreferences?: () => Promise<StudioUiPreferencesRepository>;
  acquireCatalogPreferences?: () => Promise<StudioCatalogPreferencesRepository>;
  className?: string;
}

function ElementTile({
  item,
  onPick,
  placementHelpId,
  previewTournament,
  onPreview,
  favorite,
  onFavorite,
}: {
  item: StudioElementItem;
  onPick: (item: StudioElementItem) => void;
  onPreview: (item: StudioElementItem) => void;
  favorite: boolean;
  onFavorite: (item: StudioElementItem) => void;
  placementHelpId: string;
  previewTournament?: Pick<StudioSvgProductTournament, "resolve">;
}): ReactElement {
  const [previewRequested, setPreviewRequested] = useState(false);

  function handleDragStart(event: DragEvent<HTMLButtonElement>) {
    writeStudioAssetDragPayload(
      event.dataTransfer,
      serializeStudioLocalAssetDragPayload({
        src: svgToDataUrl(item.svg),
        width: item.width,
        height: item.height,
      })
    );
  }

  return (
    <article className="studio-catalog-card rounded-xl border border-line bg-card">
    <button
      type="button"
      title={item.label}
      aria-label={item.label}
      aria-describedby={placementHelpId}
      onClick={() => onPick(item)}
      onFocus={() => setPreviewRequested(true)}
      onPointerEnter={() => setPreviewRequested(true)}
      onPointerDown={() => setPreviewRequested(true)}
      draggable
      onDragStart={handleDragStart}
      data-studio-element={item.id}
      className={cn(
        "studio-catalog-primary group flex min-h-[4.75rem] w-full flex-col items-center justify-center rounded-lg p-1.5",
        STUDIO_EASE,
        STUDIO_FOCUS_RING,
        "hover:border-accent/50 hover:bg-raised active:scale-[0.98]"
      )}
    >
      <div className="studio-catalog-thumbnail relative flex w-full items-center justify-center overflow-hidden rounded-lg bg-[oklch(0.94_0.01_78)] p-2">
        <StudioSvgAssetPreview
          assetId={item.id}
          svg={item.svg}
          width={item.width}
          height={item.height}
          requested={previewRequested}
          tournament={previewTournament}
        />
        <Grip
          size={11}
          aria-hidden
          className="absolute right-0.5 top-0.5 text-[oklch(0.35_0.02_65/0.55)] opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
        />
      </div>
      <span className="studio-catalog-name mt-1 block w-full truncate text-center text-xs font-medium text-fg-2">
        {item.label}
      </span>
    </button>
    <div className="studio-catalog-card-actions grid grid-cols-2 gap-1 border-t border-line/60 p-1">
      <button type="button" aria-label={`${item.label} 상세 미리보기`} onClick={() => onPreview(item)} className={STUDIO_CATALOG_CONTROL}><Eye size={14} className="mx-auto" aria-hidden /></button>
      <button type="button" aria-label={`${item.label} 즐겨찾기`} aria-pressed={favorite} onClick={() => onFavorite(item)} className={`${STUDIO_CATALOG_CONTROL} ${favorite ? "text-accent" : ""}`}><Star size={14} className="mx-auto" fill={favorite ? "currentColor" : "none"} aria-hidden /></button>
    </div>
    </article>
  );
}
export function StudioElementsPanel({
  onAdd,
  onOpenBubbles,
  onOpenObjectInsert,
  canvasWidth = 800,
  canvasHeight = 1200,
  previewTournament,
  acquireUiPreferences = acquireProductStudioUiPreferencesRepository,
  acquireCatalogPreferences,
  className,
}: StudioElementsPanelProps): ReactElement {
  const resultsId = useId();
  const placementHelpId = useId();
  const [surface, setSurface] = useState<"vector" | "object3d">("vector");
  const [category, setCategory] = useState<StudioElementCategory | "all">("shape");
  const [objectFamily, setObjectFamily] = useState<StudioObjectInsertFamily | "all">("all");
  const [query, setQuery] = useState("");
  const catalog = useStudioCatalogPreferences("elements", acquireCatalogPreferences);
  const [sort, setSort] = useState<StudioCatalogSort>("relevance");
  const [orientation, setOrientation] = useState<StudioCatalogOrientation>("all");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [previewItem, setPreviewItem] = useState<StudioElementItem | null>(null);
  const [visibleLimit, setVisibleLimit] = useState(60);
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const [preferenceAuthority, setPreferenceAuthority] = useState<
    "loading" | "sqlite-opfs" | "memory-only"
  >("loading");
  const preferenceRepositoryRef = useRef<StudioUiPreferencesRepository | null>(null);
  const recentDirtyRef = useRef(false);
  const mountedRef = useRef(true);
  const showObject3d = typeof onOpenObjectInsert === "function";

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    let active = true;
    void acquireUiPreferences()
      .then(async (repository) => {
        preferenceRepositoryRef.current = repository;
        const recent = await repository.loadElementsRecent();
        if (!active) return;
        setPreferenceAuthority("sqlite-opfs");
        if (!recentDirtyRef.current) setRecentIds(recent.ids);
      })
      .catch(() => {
        if (active) setPreferenceAuthority("memory-only");
      });
    return () => { active = false; };
  }, [acquireUiPreferences]);

  const items = queryStudioCatalog(listStudioElementLibrary(), {
    category, query, sort, orientation, favoritesOnly,
    favoriteIds: catalog.state.favoriteIds, recentIds,
  });
  const visibleItems = items.slice(0, visibleLimit);
  const favoriteCount = listStudioElementLibrary().filter((item) => catalog.state.favoriteIds.includes(item.id)).length;
  function toggleFavorite(item: StudioElementItem) {
    catalog.dispatch({ kind: "favorite", id: item.id, value: !catalog.state.favoriteIds.includes(item.id) });
  }
  function resetCatalogFilters() { setQuery(""); setCategory("all"); setOrientation("all"); setFavoritesOnly(false); setVisibleLimit(60); }
  useEffect(() => { setVisibleLimit(60); }, [category, query, sort, orientation, favoritesOnly]);
  const objectFamilies = listStudioObjectInsertFamilies();
  const objectItems = showObject3d
    ? filterStudioObjectInsertItems({
        query,
        family: objectFamily,
        limit: 120,
      })
    : [];
  const recentItems = recentIds
    .map((id) => findStudioElement(id))
    .filter((el): el is StudioElementItem => el !== null && el.category !== "bubble");

  function handlePickObject(item: StudioObjectInsertItem) {
    if (!onOpenObjectInsert) return;
    const plan = planStudioObjectInsertPlacement({
      itemId: item.id,
      canvasWidth,
      canvasHeight,
      existingCount: 0,
    });
    if (!plan) return;
    onOpenObjectInsert({ item, plan });
  }

  function handleObjectDragStart(
    event: DragEvent<HTMLButtonElement>,
    item: StudioObjectInsertItem,
  ) {
    const plan = planStudioObjectInsertPlacement({
      itemId: item.id,
      canvasWidth,
      canvasHeight,
      existingCount: 0,
    });
    if (!plan) {
      event.preventDefault();
      return;
    }
    writeStudioObjectInsertDragPayload(event.dataTransfer, { item, plan });
  }

  function handlePick(item: StudioElementItem) {
    recentDirtyRef.current = true;
    setRecentIds((current) => {
      const next = rememberStudioElementRecent({ version: 1, ids: current }, item.id);
      const save = preferenceRepositoryRef.current
        ? preferenceRepositoryRef.current.saveElementsRecent(next)
        : acquireUiPreferences().then((repository) => {
            preferenceRepositoryRef.current = repository;
            return repository.saveElementsRecent(next);
          });
      void save
        .then(() => {
          if (mountedRef.current) setPreferenceAuthority("sqlite-opfs");
        })
        .catch(() => {
          if (mountedRef.current) setPreferenceAuthority("memory-only");
        });
      return next.ids;
    });
    onAdd(item);
  }

  return (
    <div
      className={cn("grid gap-2", className)}
      data-studio-elements-panel="true"
      data-studio-ui-preferences-authority={preferenceAuthority}
    >
      <div className="flex items-start gap-2 rounded-lg border border-line bg-card px-2 py-1.5">
        <Sparkles size={14} className="mt-0.5 shrink-0 text-accent" aria-hidden />
        <div className="min-w-0">
          <p className="text-[0.72rem] font-semibold text-fg">
            {surface === "object3d" ? "요소 · 3D 오브젝트" : "요소 · 도형"}
          </p>
          <p className="text-[0.62rem] leading-snug text-fg-3">
            {surface === "object3d"
              ? "기본 입체·소품·씬 템플릿을 검색해 BG3D·VRM 도구로 바로 엽니다."
              : "고급 도형·컷 패널·효과음·효과선·배경 패턴을 검색해 바로 배치합니다."}
          </p>
        </div>
      </div>

      {showObject3d ? (
        <div
          className="grid grid-cols-2 gap-1 rounded-xl border border-line bg-card p-1"
          role="tablist"
          aria-label="요소 표면"
          data-studio-elements-surface={surface}
        >
          <button
            type="button"
            role="tab"
            aria-selected={surface === "vector"}
            onClick={() => setSurface("vector")}
            className={cn(
              "min-h-10 min-h-11 rounded-lg text-[0.64rem] font-semibold",
              STUDIO_EASE,
              STUDIO_FOCUS_RING,
              surface === "vector"
                ? "bg-accent text-on-accent"
                : "text-fg-3 hover:bg-raised",
            )}
          >
            2D 도형
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={surface === "object3d"}
            onClick={() => setSurface("object3d")}
            className={cn(
              "inline-flex min-h-10 min-h-11 items-center justify-center gap-1 rounded-lg text-[0.64rem] font-semibold",
              STUDIO_EASE,
              STUDIO_FOCUS_RING,
              surface === "object3d"
                ? "bg-accent text-on-accent"
                : "text-fg-3 hover:bg-raised",
            )}
          >
            <Box size={12} aria-hidden />
            3D 오브젝트
          </button>
        </div>
      ) : null}

      {preferenceAuthority === "memory-only" ? (
        <p role="status" className="rounded-lg border border-warning/40 bg-warning/10 px-2 py-1 text-[0.62rem] text-fg-2">
          최근 요소는 저장소를 다시 연결하기 전까지 이번 탭에서만 유지됩니다.
        </p>
      ) : null}

      <div
        id={placementHelpId}
        className="grid grid-cols-2 gap-1 rounded-xl border border-accent/20 bg-accent-soft/35 p-1.5 text-[0.58rem] leading-snug text-fg-2"
      >
        <span className="flex min-h-11 items-center gap-1.5 rounded-lg bg-panel/65 px-2">
          <MousePointer2 size={12} className="shrink-0 text-accent" aria-hidden />
          <span><strong className="font-bold text-fg">클릭·탭</strong><br />선택 컷·현재 화면</span>
        </span>
        <span className="flex min-h-11 items-center gap-1.5 rounded-lg bg-panel/65 px-2">
          <Grip size={12} className="shrink-0 text-accent" aria-hidden />
          <span><strong className="font-bold text-fg">끌어 놓기</strong><br />정확한 위치 · Esc 취소</span>
        </span>
      </div>

      {onOpenBubbles ? (
        <button
          type="button"
          onClick={onOpenBubbles}
          className={cn(
            "flex min-h-11 w-full items-center justify-between gap-2 rounded-xl border border-line bg-card px-2.5 text-left text-[0.66rem] text-fg-2 hover:border-accent/45 hover:bg-raised",
            STUDIO_EASE,
            STUDIO_FOCUS_RING
          )}
        >
          <span className="inline-flex min-w-0 items-center gap-2">
            <MessageCircle size={14} className="shrink-0 text-accent" aria-hidden />
            <span>
              <strong className="block font-semibold text-fg">편집 가능한 말풍선</strong>
              <span className="block text-[0.58rem] text-fg-3">대사·꼬리·모양은 전용 도구에서</span>
            </span>
          </span>
          <span className="shrink-0 font-semibold text-accent">열기 →</span>
        </button>
      ) : null}

      {surface === "vector" && <>
        <StudioCatalogControls view={catalog.state.view} onView={(value) => catalog.dispatch({ kind: "view", value })}
          sort={sort} onSort={setSort} orientation={orientation} onOrientation={setOrientation}
          favoritesOnly={favoritesOnly} onFavoritesOnly={setFavoritesOnly} favoriteCount={favoriteCount} />
        <StudioCatalogStorageNotice authority={catalog.authority} onRetry={catalog.retry} />
      </>}
      <div className="relative">
        <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-fg-3" aria-hidden />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value.slice(0, 240))}
          placeholder={
            surface === "object3d"
              ? "3D 검색 (검, 교실, 상자…)"
              : "이름·용도 검색 (나선, 4컷, 집중선…)"
          }
          className="min-h-10 min-h-11 w-full rounded-lg border border-line bg-card py-1 pl-8 pr-10 text-xs placeholder:text-fg-3 outline-none focus:border-accent focus:ring-1 focus:ring-accent/40"
          aria-label={surface === "object3d" ? "3D 오브젝트 검색" : "요소 검색"}
        />
        {query ? (
          <button
            type="button"
              onClick={() => setQuery("")}
              aria-label="검색어 지우기"
              className="absolute right-0 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-lg text-fg-3 hover:bg-raised"
            >
              <X size={12} aria-hidden />
            </button>
          ) : null}
      </div>

      {surface === "object3d" && showObject3d ? (
        <>
          <div
            className="flex max-w-full gap-1 overflow-x-auto overscroll-x-contain pb-0.5 [scrollbar-width:thin]"
            role="tablist"
            aria-label="3D 오브젝트 분류"
          >
            <button
              type="button"
              role="tab"
              aria-selected={objectFamily === "all"}
              onClick={() => setObjectFamily("all")}
              className={cn(
                "min-h-10 min-h-11 shrink-0 rounded-full border px-2.5 text-[0.64rem] font-medium pointer-coarse:min-h-11",
                STUDIO_EASE,
                STUDIO_FOCUS_RING,
                objectFamily === "all"
                  ? "border-accent bg-accent text-on-accent"
                  : "border-line bg-card text-fg-3 hover:bg-raised",
              )}
            >
              전체
            </button>
            {objectFamilies.map((family) => (
              <button
                key={family.id}
                type="button"
                role="tab"
                aria-selected={objectFamily === family.id}
                onClick={() => setObjectFamily(family.id)}
                className={cn(
                  "min-h-10 min-h-11 shrink-0 rounded-full border px-2.5 text-[0.64rem] font-medium pointer-coarse:min-h-11",
                  STUDIO_EASE,
                  STUDIO_FOCUS_RING,
                  objectFamily === family.id
                    ? "border-accent bg-accent text-on-accent"
                    : "border-line bg-card text-fg-3 hover:bg-raised",
                )}
              >
                {family.label}
                <span className="ml-1 tabular-nums opacity-80">{family.count}</span>
              </button>
            ))}
          </div>
          <p className="text-[0.64rem] font-medium text-fg-3" role="status" aria-live="polite">
            {objectFamily === "all"
              ? "전체 3D"
              : objectFamilies.find((family) => family.id === objectFamily)?.label}
            <span className="ml-1 tabular-nums text-fg-3/80">{objectItems.length}개</span>
          </p>
          <div
            id={resultsId}
            role="tabpanel"
            data-studio-elements-3d-results="true"
            className="grid max-h-72 grid-cols-2 gap-1.5 overflow-y-auto overscroll-contain pr-0.5 [scrollbar-width:thin]"
          >
            {objectItems.length === 0 ? (
              <div className="col-span-2 flex h-24 flex-col items-center justify-center rounded-lg border border-dashed border-line text-center">
                <p className="text-xs font-semibold text-fg-2">검색 결과가 없습니다</p>
                <p className="mt-1 text-[0.62rem] text-fg-3">
                  ‘검’, ‘교실’, ‘상자’처럼 소품·씬·도형 이름으로 찾아보세요.
                </p>
              </div>
            ) : (
              objectItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  title={item.hint ?? item.label}
                  aria-label={`${item.label}, ${item.familyLabel}`}
                  data-studio-object-insert={item.id}
                  data-studio-object-open-target={item.openTarget}
                  draggable
                  onDragStart={(event) => handleObjectDragStart(event, item)}
                  onClick={() => handlePickObject(item)}
                  className={cn(
                    "group flex min-h-[4.5rem] flex-col items-start justify-center gap-0.5 rounded-lg border border-line bg-card px-2 py-1.5 text-left",
                    STUDIO_EASE,
                    STUDIO_FOCUS_RING,
                    "hover:border-accent/45 hover:bg-raised",
                  )}
                >
                  <span className="text-[0.68rem] font-semibold text-fg">{item.label}</span>
                  <span className="text-[0.55rem] text-fg-3">{item.familyLabel}</span>
                  <span className="inline-flex w-full items-center justify-between gap-1 text-[0.52rem] font-medium text-accent">
                    <span>
                      {item.openTarget === "vrm-poser"
                        ? "VRM 포저 열기"
                        : item.openTarget === "bg3d-templates"
                          ? "BG3D 템플릿"
                          : "BG3D 편집기"}
                    </span>
                    <Grip
                      size={10}
                      aria-hidden
                      className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                    />
                  </span>
                </button>
              ))
            )}
          </div>
        </>
      ) : (
        <>
          <div
            className="flex max-w-full gap-1 overflow-x-auto overscroll-x-contain pb-0.5 [scrollbar-width:thin]"
            role="tablist"
            tabIndex={-1}
            aria-label="요소 카테고리"
            onKeyDown={(event) => {
              if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key) || event.nativeEvent.isComposing) return;
              const tabs = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
              const current = tabs.indexOf((event.target as Element).closest<HTMLButtonElement>('[role="tab"]')!);
              if (current < 0) return;
              event.preventDefault(); event.stopPropagation();
              const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
              tabs[next]?.focus(); tabs[next]?.click();
            }}
          >
            {STUDIO_ELEMENT_CATEGORY_CHIPS.map((chip) => (
              <button
                key={chip.id}
                type="button"
                id={`${resultsId}-${chip.id}`}
                role="tab"
                aria-selected={category === chip.id}
                tabIndex={category === chip.id ? 0 : -1}
                aria-controls={resultsId}
                onClick={() => setCategory(chip.id)}
                className={cn(
                  "min-h-10 min-h-11 shrink-0 rounded-full border px-2.5 text-[0.64rem] font-medium pointer-coarse:min-h-11",
                  STUDIO_EASE,
                  STUDIO_FOCUS_RING,
                  category === chip.id
                    ? "border-accent bg-accent text-on-accent"
                    : "border-line bg-card text-fg-3 hover:bg-raised"
                )}
              >
                {chip.label}
              </button>
            ))}
          </div>

          {recentItems.length > 0 && !query && !favoritesOnly ? (
            <>
              <p className="text-[0.64rem] font-medium text-fg-3">최근 사용</p>
              <div className="studio-catalog-grid" data-view="compact">
                {recentItems.slice(0, 8).map((item) => (
                  <ElementTile
                    key={`recent-${item.id}`}
                    item={item}
                    onPick={handlePick}
                    onPreview={setPreviewItem}
                    favorite={catalog.state.favoriteIds.includes(item.id)}
                    onFavorite={toggleFavorite}
                    placementHelpId={placementHelpId}
                    previewTournament={previewTournament}
                  />
                ))}
              </div>
            </>
          ) : null}

          <p className="text-[0.64rem] font-medium text-fg-3" role="status" aria-live="polite">
            {category === "all" ? "전체 요소" : STUDIO_ELEMENT_CATEGORY_CHIPS.find((c) => c.id === category)?.label}
            <span className="ml-1 tabular-nums text-fg-3/80">{items.length}개</span>
          </p>
          <div id={resultsId} role="tabpanel" aria-labelledby={`${resultsId}-${category}`}>
            {items.length === 0 ? (
              <div className="flex h-24 flex-col items-center justify-center rounded-lg border border-dashed border-line text-center">
                <p className="text-xs font-semibold text-fg-2">검색 결과가 없습니다</p>
                <p className="mt-1 text-xs text-fg-3">검색어·형태·즐겨찾기 조건을 줄여보세요.</p>
                <button type="button" onClick={resetCatalogFilters} className={`${STUDIO_CATALOG_CONTROL} mt-2`}>필터 초기화 · 전체 보기</button>
              </div>
            ) : (
              <div className="studio-catalog-grid max-h-96 overflow-y-auto overscroll-contain pr-0.5 [scrollbar-width:thin]" data-view={catalog.state.view}>
                {visibleItems.map((item) => (
                  <ElementTile
                    key={item.id}
                    item={item}
                    onPick={handlePick}
                    onPreview={setPreviewItem}
                    favorite={catalog.state.favoriteIds.includes(item.id)}
                    onFavorite={toggleFavorite}
                    placementHelpId={placementHelpId}
                    previewTournament={previewTournament}
                  />
                ))}
              </div>
            )}
          </div>
          {items.length > visibleItems.length && <button type="button" className={STUDIO_CATALOG_CONTROL} onClick={() => setVisibleLimit((limit) => limit + 60)}>더 보기 ({visibleItems.length}/{items.length})</button>}
          {(query || category !== "shape" || orientation !== "all" || favoritesOnly) && <button type="button" className={STUDIO_CATALOG_CONTROL} onClick={resetCatalogFilters}>필터 초기화</button>}
        </>
      )}
      {previewItem && <StudioCatalogPreviewDialog title={previewItem.label} onClose={() => setPreviewItem(null)}
        preview={<StudioSvgAssetPreview assetId={previewItem.id} svg={previewItem.svg} width={previewItem.width} height={previewItem.height} requested tournament={previewTournament} />}
        actions={<>
          <button type="button" className={`${STUDIO_CATALOG_CONTROL} flex-1`} aria-pressed={catalog.state.favoriteIds.includes(previewItem.id)} onClick={() => toggleFavorite(previewItem)}>즐겨찾기 {catalog.state.favoriteIds.includes(previewItem.id) ? "해제" : "추가"}</button>
          <button type="button" className={`${STUDIO_CATALOG_PRIMARY_CONTROL} flex-1`} onClick={() => { handlePick(previewItem); setPreviewItem(null); }}>캔버스에 추가</button>
        </>}>
        <p className="font-medium text-fg">{STUDIO_ELEMENT_CATEGORY_CHIPS.find((chip) => chip.id === previewItem.category)?.label} · {previewItem.width} × {previewItem.height} 기준 크기</p>
        <p>내장 SVG 원본 · 캔버스에는 이미지 요소로 삽입됩니다. 내부 대사·선·도형은 개별 편집되지 않습니다.</p>
        <p className="text-xs text-fg-3">미리보기 배경과 확대는 캔버스 원본에 영향을 주지 않습니다.</p>
        <div className="flex flex-wrap gap-1">{previewItem.keywords.slice(0, 8).map((keyword) => <span key={keyword} className="rounded-full border border-line px-2 py-1 text-xs">{keyword}</span>)}</div>
      </StudioCatalogPreviewDialog>}
    </div>
  );
}
