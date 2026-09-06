import { Search, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import {
  filterStudio2dScenes,
  getStudio2dAssetMetadata,
  isLargeStudio2dAsset,
  isRecommendedStudio2dScene,
  studio2dDisplayName,
  studio2dResolutionLabel,
} from "./studio-2d-asset-quality";
import { currentStudio2dPreview, studio2dImageSource, studio2dSceneIdentity } from "./studio-2d-image-source";
import { Studio2dContentFilters } from "./Studio2dContentFilters";
import { Studio2dScenePreview } from "./Studio2dScenePreview";
import { useStudio2dImageReadiness } from "./useStudio2dImageReadiness";

import type { Studio2dEnvironment, Studio2dOrientation, Studio2dQualityFilter, Studio2dScene, Studio2dSort, Studio2dTimeOfDay } from "./studio-2d-asset-quality";

import { cn } from "@/shared/lib/utils";

export interface Studio2dSceneBrowserProps {
  readonly groups: readonly { readonly genre: string; readonly scenes: readonly Studio2dScene[] }[];
  readonly query: string;
  readonly onQueryChange: (query: string) => void;
  readonly genre: string;
  readonly onGenreChange: (genre: string) => void;
  readonly loading: boolean;
  readonly error: string | null;
  readonly disabled: boolean;
  readonly onPick: (scene: Studio2dScene) => void;
}

function SceneCard({ scene, disabled, onPick, onPreview }: {
  readonly scene: Studio2dScene;
  readonly disabled: boolean;
  readonly onPick: (scene: Studio2dScene) => void;
  readonly onPreview: (scene: Studio2dScene) => void;
}) {
  const asset = getStudio2dAssetMetadata(scene);
  const title = studio2dDisplayName(scene);
  const source = studio2dImageSource(scene);
  const { imageRef, imageKey, state, retry } = useStudio2dImageReadiness(source, asset);
  const status = state.status;
  return <article className="min-w-0 overflow-hidden rounded-xl border border-line bg-card" data-studio-2d-asset={scene.id}>
    <button type="button" onClick={() => onPreview(scene)} aria-label={`${title} 확대 미리보기`}
      className="relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
      <img key={imageKey} ref={imageRef} src={source} alt={title} loading="lazy" decoding="async"
        className="h-full w-full object-contain" />
      {isRecommendedStudio2dScene(scene) && <span className="absolute left-1.5 top-1.5 rounded bg-card px-1.5 py-0.5 text-[0.65rem] font-semibold text-accent">검수 추천</span>}
    </button>
    <div className="space-y-1.5 p-2">
      <p className="line-clamp-2 min-h-8 text-[0.7rem] font-semibold leading-4 text-fg" title={title}>{title}</p>
      <p className="text-[0.64rem] text-fg-3">{studio2dResolutionLabel(scene)}</p>
      {asset && <p className="text-[0.64rem] text-fg-3">{asset.environment} · {asset.timeOfDay}</p>}
      {asset && (asset.containsPeople || asset.containsText) && <p className="text-[0.64rem] leading-relaxed text-fg-3">
        {[asset.containsPeople ? "인물 포함" : null, asset.containsText ? "문자 형태 포함" : null].filter(Boolean).join(" · ")}
      </p>}
      {asset && !isLargeStudio2dAsset(asset) && <p className="text-[0.64rem] text-fg-3">소형 컷용 · 확대 주의</p>}
      {state.reason === "timeout" && <p className="text-[0.64rem] text-bad">연결이 지연되었습니다. 다시 불러와 주세요.</p>}
      {status === "mismatch" && <p className="text-[0.64rem] text-bad">원본 크기가 검수 기록과 다릅니다.</p>}
      {(status === "error" || status === "mismatch") ? <button type="button" className="w-full rounded-lg border border-bad/40 px-1 py-1.5 text-xs text-bad"
        onClick={retry}>이미지 다시 불러오기</button>
        : <button type="button" aria-label={`${title} 삽입`} disabled={disabled || status !== "ready"}
          onClick={() => { if (!disabled && status === "ready") onPick(scene); }}
          className="w-full rounded-lg border border-line px-2 py-1.5 text-xs font-medium hover:border-accent disabled:cursor-not-allowed disabled:opacity-40">삽입</button>}
    </div>
  </article>;
}

export function Studio2dSceneBrowser({ groups, query, onQueryChange, genre, onGenreChange, loading, error, disabled, onPick }: Studio2dSceneBrowserProps) {
  const id = useId();
  const gridRef = useRef<HTMLDivElement>(null);
  const [quality, setQuality] = useState<Studio2dQualityFilter>("all");
  const [orientation, setOrientation] = useState<Studio2dOrientation>("all");
  const [sort, setSort] = useState<Studio2dSort>("recommended");
  const [emptySceneOnly, setEmptySceneOnly] = useState(false);
  const [environment, setEnvironment] = useState<Studio2dEnvironment>("all");
  const [timeOfDay, setTimeOfDay] = useState<Studio2dTimeOfDay>("all");
  const [textFreeOnly, setTextFreeOnly] = useState(false);
  const [preview, setPreview] = useState<Studio2dScene | null>(null);
  const [visibleCount, setVisibleCount] = useState(48);
  const activePreview = useMemo(() => currentStudio2dPreview(groups, preview), [groups, preview]);
  useEffect(() => {
    if (preview && !activePreview) setPreview(null);
  }, [preview, activePreview]);
  const genres = useMemo(() => [...new Set(groups.map((group) => group.genre))], [groups]);
  // Old sessions may retain the obsolete "추천" genre. Quality and genre are now independent.
  const activeGenre = genres.includes(genre) ? genre : "all";
  const results = useMemo(() => filterStudio2dScenes(groups, { query, genre: activeGenre, quality, orientation, sort, emptySceneOnly, environment, timeOfDay, textFreeOnly }),
    [groups, query, activeGenre, quality, orientation, sort, emptySceneOnly, environment, timeOfDay, textFreeOnly]);
  useEffect(() => {
    setVisibleCount(48);
    if (gridRef.current) gridRef.current.scrollTop = 0;
  }, [query, activeGenre, quality, orientation, sort, emptySceneOnly, environment, timeOfDay, textFreeOnly]);
  const reset = () => { onQueryChange(""); onGenreChange("all"); setQuality("all"); setOrientation("all"); setEmptySceneOnly(false); setSort("recommended"); setEnvironment("all"); setTimeOfDay("all"); setTextFreeOnly(false); };
  const field = "min-w-0 rounded-lg border border-line bg-card px-2 py-1.5 text-xs text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent";

  return <div className="min-w-0 space-y-3" data-studio-2d-browser="true">
    <div className="rounded-xl border border-line bg-card p-3">
      <p className="text-xs font-bold text-fg">2D 장면 라이브러리</p>
      <p className="mt-1 text-[0.7rem] leading-relaxed text-fg-3">이미지를 누르면 확대 미리보기, 삽입 버튼을 누르면 기존 패널 선택 범위에 배치됩니다.</p>
    </div>
    <div className="relative">
      <label htmlFor={`${id}-search`} className="sr-only">배경 이름·장소·분위기 검색</label>
      <Search size={14} aria-hidden className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-3" />
      <input id={`${id}-search`} type="search" placeholder="예: 비 밤, 학교, 판타지 숲" value={query} onChange={(event) => onQueryChange(event.target.value)}
        className={`${field} w-full py-2 pl-8 pr-8`} />
      {query && <button type="button" aria-label="배경 검색어 지우기" onClick={() => onQueryChange("")}
        className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1.5"><X size={14} /></button>}
    </div>
    <div className="flex flex-wrap gap-1.5" aria-label="빠른 배경 검색">
      {["학교", "실내", "밤", "비", "판타지", "로맨스"].map((tag) => <button type="button" key={tag} onClick={() => onQueryChange(tag)}
        className="rounded-full border border-line px-2 py-1 text-[0.68rem] text-fg-3 hover:border-accent">{tag}</button>)}
    </div>
    <div className="grid grid-cols-2 gap-2">
      <div className="flex min-w-0 flex-col gap-1 text-[0.66rem] text-fg-3"><label htmlFor={`${id}-genre`}>장르</label>
        <select id={`${id}-genre`} className={field} value={activeGenre} onChange={(event) => onGenreChange(event.target.value)}>
          <option value="all">전체 장르</option>{genres.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
      </div>
      <div className="flex min-w-0 flex-col gap-1 text-[0.66rem] text-fg-3"><label htmlFor={`${id}-quality`}>소재 구분</label>
        <select id={`${id}-quality`} className={field} value={quality} onChange={(event) => setQuality(event.target.value as Studio2dQualityFilter)}>
          <option value="all">모든 소재</option><option value="recommended">검수 추천</option><option value="large">큰 원본만</option><option value="raster">이미지</option><option value="vector">벡터</option>
        </select>
      </div>
      <div className="flex min-w-0 flex-col gap-1 text-[0.66rem] text-fg-3"><label htmlFor={`${id}-orientation`}>원본 비율</label>
        <select id={`${id}-orientation`} className={field} value={orientation} onChange={(event) => setOrientation(event.target.value as Studio2dOrientation)}>
          <option value="all">모든 비율</option><option value="landscape">가로형</option><option value="portrait">세로형</option><option value="square">정사각형</option>
        </select>
      </div>
      <div className="flex min-w-0 flex-col gap-1 text-[0.66rem] text-fg-3"><label htmlFor={`${id}-sort`}>정렬</label>
        <select id={`${id}-sort`} className={field} value={sort} onChange={(event) => setSort(event.target.value as Studio2dSort)}>
          <option value="recommended">검수 추천 우선</option><option value="resolution">원본 큰 순</option><option value="name">이름순</option>
        </select>
      </div>
    </div>
    <Studio2dContentFilters environment={environment} timeOfDay={timeOfDay} textFreeOnly={textFreeOnly}
      onEnvironmentChange={setEnvironment} onTimeOfDayChange={setTimeOfDay} onTextFreeOnlyChange={setTextFreeOnly} />
    <label htmlFor={`${id}-empty`} className="flex items-center gap-2 text-xs text-fg-2">
      <input id={`${id}-empty`} type="checkbox" checked={emptySceneOnly} onChange={(event) => setEmptySceneOnly(event.target.checked)} />인물 없는 이미지 배경만
    </label>
    <div className="flex items-center justify-between gap-2 text-xs">
      <p role="status" aria-live="polite" className="text-fg-3">{loading ? "배경을 불러오는 중…" : `${results.length}개 장면`}</p>
      <button type="button" className="rounded px-2 py-1 text-fg-3 underline" onClick={reset}>필터 초기화</button>
    </div>
    {error && <p role="alert" className="rounded-lg border border-bad/40 bg-bad/10 p-3 text-xs text-bad">{error}</p>}
    {disabled && <p className="text-xs text-fg-3">현재 편집 상태에서는 삽입할 수 없습니다. 미리보기는 사용할 수 있습니다.</p>}
    {!loading && !error && results.length === 0 && <div className="rounded-xl border border-dashed border-line p-5 text-center text-xs text-fg-3">
      조건에 맞는 배경이 없습니다. 검색어나 필터를 바꿔 주세요.
    </div>}
    <div ref={gridRef} data-studio-2d-grid="true" className={cn("grid max-h-[min(52dvh,32rem)] grid-cols-2 gap-2 overflow-y-auto pr-1", loading && "opacity-70")}>
      {results.slice(0, visibleCount).map((scene) => <SceneCard key={studio2dSceneIdentity(scene)} scene={scene} disabled={disabled} onPick={onPick} onPreview={setPreview} />)}
      {visibleCount < results.length && <button type="button" onClick={() => setVisibleCount((count) => count + 48)}
        className="col-span-2 rounded-lg border border-line p-3 text-xs">장면 더 보기 ({results.length - visibleCount}개 남음)</button>}
    </div>
    {activePreview && <Studio2dScenePreview key={studio2dSceneIdentity(activePreview)} scene={activePreview} disabled={disabled} onPick={onPick} onClose={() => setPreview(null)} />}
  </div>;
}
