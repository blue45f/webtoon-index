import { BadgeCheck, Loader2, Plus, Sparkles, Star } from "lucide-react";

import {
  createStudioAssetFavoriteId,
  favoriteFirst,
  favoriteOnly as filterFavoriteOnly,
  isStudioAssetFavorite,
  type StudioAssetFavoriteId,
  type StudioAssetFavoriteState,
} from "./studio-asset-favorites";

import type { StudioRasterAsset } from "./render/studio-raster-assets";
import type { Dispatch, SetStateAction } from "react";

import { resolveAssetUrl } from "@/src/shared/catalog/catalog-static";

const COLLECTION_LABEL: Record<StudioRasterAsset["collection"], string> = {
  daily: "일상",
  school: "학교",
  fantasy: "판타지",
  urban: "도시",
};

const FOCUS_RING_CLASS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-panel";

function rasterFavoriteId(asset: StudioRasterAsset): StudioAssetFavoriteId {
  return createStudioAssetFavoriteId("raster", asset.id);
}

export interface StudioRasterAssetGridProps {
  /** 이미 검색·분류 필터를 적용한 목록. 이 컴포넌트는 즐겨찾기 정렬만 책임진다. */
  assets: readonly StudioRasterAsset[];
  busyId: string | null;
  onAdd: (asset: StudioRasterAsset) => void;
  favoriteState: StudioAssetFavoriteState;
  favoriteOnly: boolean;
  setFavoriteOnly: Dispatch<SetStateAction<boolean>> | ((value: boolean) => void);
  onToggleFavorite: (id: StudioAssetFavoriteId) => void;
}

export function StudioRasterAssetGrid({
  assets,
  busyId,
  onAdd,
  favoriteState,
  favoriteOnly,
  setFavoriteOnly,
  onToggleFavorite,
}: StudioRasterAssetGridProps) {
  const favoriteSortedAssets = favoriteFirst(assets, favoriteState, rasterFavoriteId);
  const visibleAssets = favoriteOnly
    ? filterFavoriteOnly(favoriteSortedAssets, favoriteState, rasterFavoriteId)
    : favoriteSortedAssets;

  if (assets.length === 0 && !favoriteOnly) return null;

  return (
    <section aria-labelledby="studio-raster-assets-heading" className="mt-2 border-t border-line pt-2">
      <div className="mb-2 flex items-start gap-2">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
          <Sparkles size={15} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h3 id="studio-raster-assets-heading" className="text-xs font-bold text-fg">
            고품질 장면 소품
          </h3>
          <p className="mt-0.5 text-[0.65rem] leading-relaxed text-fg-3">
            투명 배경·권리 메타데이터를 검수한 자체 제작 전경 세트입니다.
          </p>
        </div>
        <button
          type="button"
          aria-pressed={favoriteOnly}
          aria-label={favoriteOnly ? "전체 소품 보기" : "즐겨찾기만"}
          title={favoriteOnly ? "전체 소품 보기" : "즐겨찾기만"}
          onClick={() => setFavoriteOnly(!favoriteOnly)}
          className={`grid size-11 min-h-11 min-w-11 shrink-0 place-items-center rounded-xl border transition-colors ${FOCUS_RING_CLASS} ${
            favoriteOnly
              ? "border-accent bg-accent text-on-accent"
              : "border-line bg-card text-fg-2 hover:border-line-strong hover:bg-raised hover:text-fg"
          }`}
        >
          <Star size={15} fill={favoriteOnly ? "currentColor" : "none"} aria-hidden />
        </button>
      </div>

      {visibleAssets.length === 0 ? (
        <div
          role="status"
          className="rounded-xl border border-dashed border-line bg-card px-3 py-5 text-center"
        >
          <Star size={18} className="mx-auto text-fg-3" aria-hidden />
          <p className="mt-2 text-[0.68rem] font-semibold text-fg-2">아직 즐겨찾기한 소품이 없습니다.</p>
          <p className="mt-1 text-[0.6rem] leading-relaxed text-fg-3">
            별 버튼을 눌러 자주 쓰는 소품을 이곳에 모아보세요.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {visibleAssets.map((asset) => {
            const busy = busyId === asset.id;
            const favoriteId = rasterFavoriteId(asset);
            const isFavorite = isStudioAssetFavorite(favoriteState, favoriteId);

            return (
              <article
                key={asset.id}
                aria-busy={busy || undefined}
                title={asset.description}
                className="group min-h-36 overflow-hidden rounded-xl border border-line bg-card transition-colors hover:border-line-strong focus-within:border-accent/60"
              >
                <div className="relative flex aspect-[3/2] w-full items-center justify-center overflow-hidden bg-canvas/60 p-1.5">
                  <img
                    src={resolveAssetUrl(asset.src)}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="size-full object-contain transition-transform duration-200 group-hover:scale-[1.03] motion-reduce:transition-none"
                  />
                  <span className="absolute left-1.5 top-1.5 inline-flex min-h-6 items-center gap-1 rounded-md border border-line/70 bg-panel/90 px-1.5 text-[0.58rem] font-semibold text-fg-2 shadow-sm">
                    <BadgeCheck size={11} className="text-good" aria-hidden /> 검수됨
                  </span>
                  <button
                    type="button"
                    aria-pressed={isFavorite}
                    aria-label={`${asset.label} ${isFavorite ? "즐겨찾기에서 제거" : "즐겨찾기에 추가"}`}
                    onClick={() => onToggleFavorite(favoriteId)}
                    className={`absolute right-1 top-1 grid size-11 place-items-center rounded-lg border shadow-sm transition-colors ${FOCUS_RING_CLASS} ${
                      isFavorite
                        ? "border-accent/60 bg-accent text-on-accent"
                        : "border-line/80 bg-panel/90 text-fg-2 hover:border-accent/60 hover:text-accent"
                    }`}
                  >
                    <Star size={16} fill={isFavorite ? "currentColor" : "none"} aria-hidden />
                  </button>
                </div>

                <div className="flex min-h-12 items-center gap-1 px-2 py-1.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[0.68rem] font-bold text-fg">{asset.label}</p>
                    <p className="mt-0.5 text-[0.58rem] text-fg-3">
                      {COLLECTION_LABEL[asset.collection]} · AI 생성
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={busyId !== null}
                    aria-label={`${asset.label} 캔버스에 추가`}
                    aria-busy={busy || undefined}
                    onClick={() => onAdd(asset)}
                    className={`grid size-11 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent transition-colors hover:bg-accent hover:text-on-accent disabled:cursor-wait disabled:opacity-55 ${FOCUS_RING_CLASS}`}
                  >
                    {busy ? (
                      <Loader2 size={15} className="animate-spin motion-reduce:animate-none" aria-hidden />
                    ) : (
                      <Plus size={15} aria-hidden />
                    )}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
