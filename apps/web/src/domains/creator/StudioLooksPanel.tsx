/**
 * Studio Looks Panel
 * 원클릭 룩 인스펙터 — 검색·즐겨찾기·최근 적용 + 카테고리 칩.
 * 상태(즐겨찾기)는 부모가 localStorage 와 동기화해 넘긴다.
 */
import { RotateCcw, Search, Star } from "lucide-react";
import { useState } from "react";

import {
  createStudioEffectId,
  isStudioEffectFavorite,
  type StudioEffectFavoriteState,
  type StudioEffectId,
} from "./studio-effect-favorites";
import { STUDIO_LOOKS, type StudioLook, type StudioLookCategory } from "./studio-looks";

import { buttonClass } from "@/shared/components/ui/button-utils";
import { cn } from "@/shared/lib/utils";

const CHIP_CLASS =
  "rounded-md border border-line bg-card px-2 py-0.5 text-[0.6rem] text-fg-2 transition-colors hover:bg-raised hover:text-fg";

const CATEGORY_ORDER: StudioLookCategory[] = ["만화", "시네마틱", "빈티지", "감성", "흑백", "실험"];

function lookEffectId(lookId: string): StudioEffectId {
  return createStudioEffectId("look", lookId);
}

export function StudioLooksPanel({
  onApplyLook,
  onCopy,
  onPaste,
  onResetAll,
  canPaste,
  favoriteState,
  onToggleFavorite,
}: {
  onApplyLook: (look: StudioLook) => void;
  onCopy: () => void;
  onPaste: () => void;
  onResetAll: () => void;
  canPaste: boolean;
  favoriteState: StudioEffectFavoriteState;
  onToggleFavorite: (effectId: StudioEffectId) => void;
}): React.ReactElement {
  const [query, setQuery] = useState("");
  const [favoritesOnly, setFavoritesOnly] = useState(false);

  const q = query.trim().toLocaleLowerCase("ko-KR");
  const filtered = STUDIO_LOOKS.filter((look) => {
    const effectId = lookEffectId(look.id);
    if (favoritesOnly && !isStudioEffectFavorite(favoriteState, effectId)) return false;
    if (!q) return true;
    return (
      look.label.toLocaleLowerCase("ko-KR").includes(q) ||
      look.tip.toLocaleLowerCase("ko-KR").includes(q) ||
      look.category.toLocaleLowerCase("ko-KR").includes(q) ||
      look.id.toLocaleLowerCase("ko-KR").includes(q)
    );
  });

  const recentLooks = favoriteState.recent
    .map((id) => {
      if (!id.startsWith("look:")) return null;
      const raw = id.slice("look:".length);
      return STUDIO_LOOKS.find((look) => look.id === raw) ?? null;
    })
    .filter((look): look is StudioLook => Boolean(look))
    .slice(0, 8);

  return (
    <div className="space-y-2">
      <p className="text-[0.66rem] font-semibold text-fg-3 uppercase tracking-wider">원클릭 룩 (Looks)</p>

      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={onCopy}
          className={buttonClass({ size: "sm", variant: "quiet" })}
          title="현재 요소의 필터를 클립보드에 복사합니다."
        >
          필터 복사
        </button>
        <button
          type="button"
          onClick={onPaste}
          disabled={!canPaste}
          className={buttonClass({ size: "sm", variant: "quiet" })}
          title="복사한 필터를 현재 요소에 붙여넣습니다."
        >
          붙여넣기
        </button>
        <button
          type="button"
          onClick={onResetAll}
          className={buttonClass({ size: "sm", variant: "quiet" })}
          title="현재 요소의 모든 필터를 제거합니다."
        >
          <RotateCcw className="size-3.5" />
          전체 초기화
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">룩 검색</span>
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-fg-3" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="룩 검색…"
            className="min-h-9 w-full rounded-lg border border-line bg-card py-1.5 pl-7 pr-2 text-[0.7rem] text-fg placeholder:text-fg-3"
          />
        </label>
        <button
          type="button"
          aria-pressed={favoritesOnly}
          onClick={() => setFavoritesOnly((value) => !value)}
          className={cn(
            "inline-flex min-h-9 items-center gap-1 rounded-lg border px-2 text-[0.65rem] font-semibold",
            favoritesOnly
              ? "border-accent/50 bg-accent-soft text-accent"
              : "border-line bg-card text-fg-3 hover:bg-raised hover:text-fg"
          )}
        >
          <Star className="size-3.5" aria-hidden fill={favoritesOnly ? "currentColor" : "none"} />
          즐겨찾기
        </button>
      </div>

      {recentLooks.length > 0 && !favoritesOnly && !q ? (
        <div className="space-y-1">
          <p className="text-[0.6rem] font-medium text-fg-3 uppercase tracking-wide">최근</p>
          <div className="flex flex-wrap gap-1.5">
            {recentLooks.map((look) => (
              <button
                key={`recent-${look.id}`}
                type="button"
                onClick={() => onApplyLook(look)}
                title={look.tip}
                className={CHIP_CLASS}
              >
                {look.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {filtered.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line bg-card/40 px-3 py-4 text-center text-[0.7rem] text-fg-3">
          {favoritesOnly ? "즐겨찾기한 룩이 없어요. 별 아이콘으로 추가해 보세요." : "검색 결과가 없어요."}
        </p>
      ) : (
        CATEGORY_ORDER.map((category) => {
          const looks = filtered.filter((look) => look.category === category);
          if (looks.length === 0) return null;
          return (
            <div key={category} className="space-y-1">
              <p className="text-[0.6rem] font-medium text-fg-3 uppercase tracking-wide">{category}</p>
              <div className="flex flex-wrap gap-1.5">
                {looks.map((look) => {
                  const effectId = lookEffectId(look.id);
                  const favorited = isStudioEffectFavorite(favoriteState, effectId);
                  return (
                    <div key={look.id} className="inline-flex items-center gap-0.5">
                      <button
                        type="button"
                        onClick={() => onApplyLook(look)}
                        title={look.tip}
                        className={CHIP_CLASS}
                      >
                        {look.label}
                      </button>
                      <button
                        type="button"
                        aria-label={favorited ? `${look.label} 즐겨찾기 해제` : `${look.label} 즐겨찾기`}
                        aria-pressed={favorited}
                        onClick={() => onToggleFavorite(effectId)}
                        className={cn(
                          "grid size-7 place-items-center rounded-md border border-transparent text-fg-3 transition-colors hover:border-line hover:bg-raised hover:text-fg",
                          favorited && "text-accent"
                        )}
                      >
                        <Star className="size-3" fill={favorited ? "currentColor" : "none"} aria-hidden />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
