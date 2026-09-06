import { Eye, Search, Star, X } from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";

import { queryStudioCatalog, type StudioCatalogSort } from "./studio-catalog-query";
import { summarizeStudioSceneTemplate } from "./studio-scene-template-summary";
import { StudioCatalogControls, StudioCatalogStorageNotice, STUDIO_CATALOG_CONTROL, STUDIO_CATALOG_PRIMARY_CONTROL } from "./StudioCatalogControls";
import { StudioCatalogPreviewDialog } from "./StudioCatalogPreviewDialog";
import { StudioSceneTemplateMap } from "./StudioSceneTemplateMap";
import { useStudioCatalogPreferences } from "./use-studio-catalog-preferences";

import type { SceneTemplate } from "../studio-scene-templates";
import type { StudioCatalogPreferencesRepository } from "./studio-catalog-preferences";

import "./studio-catalog-browser.css";

export function StudioSceneTemplateBrowser({ templates, categories, loading, error, onAdd, acquirePreferences }: {
  templates: readonly SceneTemplate[]; categories: readonly { id: string; label: string }[];
  loading: boolean; error: string | null; onAdd: (template: SceneTemplate) => Promise<void>;
  acquirePreferences?: () => Promise<StudioCatalogPreferencesRepository>;
}) {
  const searchId = useId();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [sort, setSort] = useState<StudioCatalogSort>("relevance");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const inserting = useRef(false);
  const [notice, setNotice] = useState("");
  const preferences = useStudioCatalogPreferences("scenes", acquirePreferences);
  const summaries = useMemo(() => new Map(templates.map((template) => [template.id, summarizeStudioSceneTemplate(template)])), [templates]);
  const catalog = useMemo(() => templates.map((template) => ({ ...template,
    keywords: [categories.find((entry) => entry.id === template.category)?.label ?? template.category],
  })), [templates, categories]);
  const visible = queryStudioCatalog(catalog, { query, category, sort, favoritesOnly,
    favoriteIds: preferences.state.favoriteIds, recentIds: preferences.state.recentIds });
  const preview = templates.find((template) => template.id === previewId) ?? null;
  const previewSummary = useMemo(() => preview ? summarizeStudioSceneTemplate(preview) : null, [preview]);
  const favoriteCount = templates.filter((template) => preferences.state.favoriteIds.includes(template.id)).length;

  function toggleFavorite(template: SceneTemplate) {
    preferences.dispatch({ kind: "favorite", id: template.id, value: !preferences.state.favoriteIds.includes(template.id) });
  }
  async function insert(template: SceneTemplate) {
    if (inserting.current) return;
    inserting.current = true; setPendingId(template.id); setNotice("");
    try {
      await onAdd(template);
      preferences.dispatch({ kind: "recent", id: template.id });
      setPreviewId(null);
      setNotice(`${template.label} 적용 요청을 처리했습니다.`);
    } catch {
      setNotice("장면을 추가하지 못했습니다. 화면 상태를 확인한 뒤 다시 시도해 주세요.");
    } finally { inserting.current = false; setPendingId(null); }
  }
  function reset() { setQuery(""); setCategory("all"); setFavoritesOnly(false); setSort("relevance"); }

  return <section className="grid min-w-0 gap-3" aria-label="장면 템플릿 탐색" data-studio-scene-template-browser="true">
    <header><h3 className="text-sm font-semibold text-fg">장면 템플릿 · 구성부터 확인</h3>
      <p className="mt-1 text-xs leading-relaxed text-fg-3">장면을 미리 보고 추가하세요. 추가 후 대사·프레임·효과를 각각 편집할 수 있습니다.</p></header>
    <div className="relative"><Search aria-hidden size={15} className="absolute left-3 top-3.5 text-fg-3" />
      <input id={searchId} type="search" aria-label="장면 템플릿 검색" value={query} onChange={(event) => setQuery(event.target.value.slice(0, 240))}
        placeholder="장면·상황 검색 (회상, 학교, 카페…)" className={`${STUDIO_CATALOG_CONTROL} w-full pl-9 pr-11`} />
      {query && <button type="button" aria-label="장면 검색어 지우기" onClick={() => setQuery("")} className="absolute right-0 top-0 grid size-11 place-items-center rounded-lg focus-visible:ring-2 focus-visible:ring-accent"><X size={15} aria-hidden /></button>}
    </div>
    <div className="flex gap-1 overflow-x-auto overscroll-x-contain pb-1" role="group" aria-label="장면 장르">
      {[{ id: "all", label: "전체" }, ...categories].map((entry) => <button type="button" key={entry.id} aria-pressed={category === entry.id}
        onClick={() => setCategory(entry.id)} className={`${STUDIO_CATALOG_CONTROL} shrink-0 rounded-full ${category === entry.id ? "border-accent text-accent" : ""}`}>{entry.label}</button>)}
    </div>
    <StudioCatalogControls view={preferences.state.view} onView={(value) => preferences.dispatch({ kind: "view", value })}
      sort={sort} onSort={setSort} favoritesOnly={favoritesOnly} onFavoritesOnly={setFavoritesOnly} favoriteCount={favoriteCount} />
    <StudioCatalogStorageNotice authority={preferences.authority} onRetry={preferences.retry} />
    {loading && <p role="status" className="text-xs text-fg-3">장면 템플릿을 불러오는 중…</p>}
    {error && <p role="alert" className="rounded-lg border border-bad/40 p-2 text-xs text-bad">{error}</p>}
    <div className="flex items-center justify-between gap-2"><p role="status" aria-live="polite" className="text-xs text-fg-3">{visible.length}개 장면 · 네이티브 편집형</p>
      {(query || category !== "all" || favoritesOnly) && <button type="button" className={STUDIO_CATALOG_CONTROL} onClick={reset}>필터 초기화</button>}</div>
    {!loading && visible.length === 0 && <div className="rounded-xl border border-dashed border-line p-4 text-center">
      <p className="text-sm font-medium text-fg">조건에 맞는 장면이 없습니다</p><button type="button" onClick={reset} className={`${STUDIO_CATALOG_CONTROL} mt-2`}>전체 장면 보기</button></div>}
    <div className="studio-catalog-grid max-h-96 overflow-y-auto overscroll-contain" data-view={preferences.state.view}>
      {visible.map((template) => <article key={template.id} className="studio-catalog-card rounded-xl border border-line bg-card" data-studio-scene-card={template.id}>
        <button type="button" aria-label={`${template.label} 구성 미리보기`} onClick={() => setPreviewId(template.id)} className="studio-catalog-primary block w-full rounded-lg p-2 text-left focus-visible:ring-2 focus-visible:ring-accent">
          <div className="studio-catalog-thumbnail overflow-hidden rounded-lg bg-white p-1"><StudioSceneTemplateMap summary={summaries.get(template.id)!} label={template.label} /></div>
          <span className="studio-catalog-name mt-2 block truncate text-xs font-semibold text-fg">{template.label}</span>
          <span className="block truncate text-[0.65rem] text-fg-3">{template.description}</span>
        </button>
        <div className="studio-catalog-card-actions flex gap-1 border-t border-line p-1">
          <button type="button" aria-label={`${template.label} 즐겨찾기`} aria-pressed={preferences.state.favoriteIds.includes(template.id)} onClick={() => toggleFavorite(template)} className={`${STUDIO_CATALOG_CONTROL} w-11 shrink-0`}><Star size={14} className="mx-auto" fill={preferences.state.favoriteIds.includes(template.id) ? "currentColor" : "none"} aria-hidden /></button>
          <button type="button" aria-label={`${template.label} 추가`} disabled={pendingId !== null} onClick={() => void insert(template)} className={`${STUDIO_CATALOG_CONTROL} flex-1 disabled:opacity-50`}>{pendingId === template.id ? "추가 중…" : "추가"}</button>
        </div>
      </article>)}
    </div>
    <p className="text-[0.65rem] text-fg-3">카드는 요소 배치 구성도입니다. 글꼴·효과의 최종 모습은 캔버스에서 확인하세요.</p>
    {notice && <p role="status" className="rounded-lg border border-line p-2 text-xs text-fg-2">{notice}</p>}
    {preview && previewSummary && <StudioCatalogPreviewDialog title={preview.label} onClose={() => setPreviewId(null)}
      preview={<StudioSceneTemplateMap summary={previewSummary} label={preview.label} />}
      actions={<>
        <button type="button" className={`${STUDIO_CATALOG_CONTROL} flex-1`} onClick={() => toggleFavorite(preview)} aria-pressed={preferences.state.favoriteIds.includes(preview.id)}>즐겨찾기 {preferences.state.favoriteIds.includes(preview.id) ? "해제" : "추가"}</button>
        <button type="button" disabled={pendingId !== null} className={`${STUDIO_CATALOG_PRIMARY_CONTROL} flex-1 disabled:opacity-50`} onClick={() => void insert(preview)}>{pendingId ? "추가 중…" : "장면 추가"}</button>
      </>}>
      <p className="font-medium text-fg">{preview.description}</p>
      <p>프레임 {previewSummary.frames} · 말풍선 {previewSummary.bubbles} · 텍스트 {previewSummary.texts} · 효과 {previewSummary.effects}</p>
      <p className="inline-flex items-center gap-1 text-xs text-fg-3"><Eye size={14} aria-hidden />원본 구성 {previewSummary.width} × {Math.ceil(previewSummary.height)} · 실제 삽입 시 현재 컷에 맞게 배치됩니다.</p>
      <p className="text-xs text-fg-3">완성 작화가 아닌 배치 구성도입니다. 대사·글꼴·프레임·효과는 추가 후 개별 수정할 수 있습니다.</p>
      {templates.some((item) => item.category === preview.category && item.id !== preview.id) && <div className="mt-1"><h4 className="mb-1 text-xs font-semibold text-fg">같은 장르의 다른 연출</h4><div className="flex flex-wrap gap-1">{templates.filter((item) => item.category === preview.category && item.id !== preview.id).slice(0, 4).map((item) => <button key={item.id} type="button" className={STUDIO_CATALOG_CONTROL} onClick={() => setPreviewId(item.id)}>{item.label}</button>)}</div></div>}
    </StudioCatalogPreviewDialog>}
  </section>;
}
