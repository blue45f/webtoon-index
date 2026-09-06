import {
  Armchair,
  Box,
  Building2,
  Check,
  DoorOpen,
  Leaf,
  Route,
  Search,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { useState } from "react";

import {
  STUDIO_BG3D_PROCEDURAL_STARTER_ASSETS,
  STUDIO_BG3D_PROCEDURAL_STARTER_CATEGORY_LABELS,
  STUDIO_BG3D_PROCEDURAL_STARTER_PACK,
  type StudioBg3dProceduralInsertionPlan,
  type StudioBg3dProceduralStarterAsset,
  type StudioBg3dProceduralStarterCategory,
} from "./studio-bg3d-procedural-starter-pack";
import {
  STUDIO_BG3D_PROCEDURAL_STARTER_CATEGORY_FILTERS,
  describeStudioBg3dProceduralInsertionFailure,
  filterStudioBg3dProceduralStarterAssets,
  type StudioBg3dProceduralStarterCategoryFilter,
} from "./studio-bg3d-procedural-starter-ui";

const FIRST_PAGE_SIZE = 6;

const CATEGORY_ICONS: Record<
  StudioBg3dProceduralStarterCategory,
  typeof Building2
> = {
  architecture: Building2,
  opening: DoorOpen,
  furniture: Armchair,
  street: Route,
  nature: Leaf,
};

type InsertNotice = {
  readonly tone: "error" | "success";
  readonly message: string;
};

export interface StudioBg3dProceduralStarterPanelProps {
  readonly disabledReason?: string | null;
  readonly onInsert: (assetId: string) => StudioBg3dProceduralInsertionPlan;
}

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

function assetPreviewColors(asset: StudioBg3dProceduralStarterAsset): readonly string[] {
  return [...new Set(asset.parts.map((part) => part.color))].slice(0, 4);
}

export function StudioBg3dProceduralStarterPanel({
  disabledReason = null,
  onInsert,
}: StudioBg3dProceduralStarterPanelProps) {
  const [query, setQuery] = useState("");
  const [category, setCategory] =
    useState<StudioBg3dProceduralStarterCategoryFilter>("all");
  const [showAll, setShowAll] = useState(false);
  const [notice, setNotice] = useState<InsertNotice | null>(null);

  const filteredAssets = filterStudioBg3dProceduralStarterAssets(
    STUDIO_BG3D_PROCEDURAL_STARTER_ASSETS,
    { query, category },
  );
  const visibleAssets = showAll
    ? filteredAssets
    : filteredAssets.slice(0, FIRST_PAGE_SIZE);
  const hiddenCount = filteredAssets.length - visibleAssets.length;

  const insertAsset = (asset: StudioBg3dProceduralStarterAsset): void => {
    if (disabledReason) return;
    try {
      const result = onInsert(asset.id);
      if (result.ok) {
        setNotice({
          tone: "success",
          message: `${asset.label}을(를) ${result.primitives.length}개 편집 파츠로 추가했습니다.`,
        });
        return;
      }
      setNotice({
        tone: "error",
        message: describeStudioBg3dProceduralInsertionFailure(result.reason),
      });
    } catch {
      setNotice({
        tone: "error",
        message: "3D 스타터 에셋을 추가하지 못했습니다. 장면 상태를 확인한 뒤 다시 시도해 주세요.",
      });
    }
  };

  return (
    <section aria-labelledby="bg3d-procedural-starter-title">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3
            id="bg3d-procedural-starter-title"
            className="flex items-center gap-1.5 text-sm font-bold text-fg"
          >
            <Box size={15} className="shrink-0 text-accent" aria-hidden />
            절차형 무료 에셋
          </h3>
          <p className="mt-1 text-[0.68rem] leading-relaxed text-fg-3">
            외부 파일 없이 기본 도형으로 생성되어 파츠별로 바로 편집할 수 있습니다.
          </p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-good/35 bg-good/10 px-2 py-1 text-[0.62rem] font-bold text-good">
          <ShieldCheck size={12} aria-hidden />
          오리지널 · CC0
        </span>
      </div>

      <div className="relative mt-3">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg-3"
          aria-hidden
        />
        <input
          type="search"
          value={query}
          aria-label="절차형 3D 에셋 검색"
          placeholder="방, 계단, 가구, 거리…"
          spellCheck={false}
          className="min-h-11 w-full rounded-lg border border-line bg-card py-1.5 pl-8 pr-2 text-xs text-fg placeholder:text-fg-3 focus-visible:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:min-h-9"
          onChange={(event) => {
            setQuery(event.target.value);
            setShowAll(false);
            setNotice(null);
          }}
        />
      </div>

      <div
        className="mt-2 grid grid-cols-3 gap-1.5"
        role="radiogroup"
        aria-label="절차형 3D 에셋 카테고리"
      >
        {STUDIO_BG3D_PROCEDURAL_STARTER_CATEGORY_FILTERS.map((option) => (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={category === option.id}
            className={cx(
              "min-h-11 rounded-lg border px-1.5 text-[0.65rem] font-bold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:min-h-9",
              category === option.id
                ? "border-accent/55 bg-accent-soft text-accent"
                : "border-line bg-card text-fg-3 hover:bg-raised hover:text-fg",
            )}
            onClick={() => {
              setCategory(option.id);
              setShowAll(false);
              setNotice(null);
            }}
          >
            {option.label}
          </button>
        ))}
      </div>

      <p className="mt-2 text-[0.64rem] font-medium text-fg-3" aria-live="polite">
        {filteredAssets.length}개 찾음 · WebGL2/WebGPU 공용 · 외부 리소스 0
      </p>

      {disabledReason ? (
        <p className="mt-2 flex items-start gap-1.5 rounded-lg border border-warn/40 bg-warn/10 px-2.5 py-2 text-[0.68rem] leading-relaxed text-warn">
          <TriangleAlert size={13} className="mt-0.5 shrink-0" aria-hidden />
          {disabledReason}
        </p>
      ) : null}

      {notice ? (
        <p
          role={notice.tone === "error" ? "alert" : "status"}
          aria-live={notice.tone === "error" ? "assertive" : "polite"}
          className={cx(
            "mt-2 flex items-start gap-1.5 rounded-lg border px-2.5 py-2 text-[0.68rem] leading-relaxed",
            notice.tone === "success"
              ? "border-good/40 bg-good/10 text-good"
              : "border-bad/40 bg-bad/10 text-bad",
          )}
        >
          {notice.tone === "success" ? (
            <Check size={13} className="mt-0.5 shrink-0" aria-hidden />
          ) : (
            <TriangleAlert size={13} className="mt-0.5 shrink-0" aria-hidden />
          )}
          {notice.message}
        </p>
      ) : null}

      {visibleAssets.length === 0 ? (
        <div className="mt-3 rounded-lg border border-dashed border-line bg-card/45 px-3 py-4 text-center text-xs leading-relaxed text-fg-3">
          검색과 카테고리에 맞는 에셋이 없습니다.
          <button
            type="button"
            className="mt-2 min-h-11 w-full rounded-lg border border-line bg-panel px-3 text-xs font-bold text-fg-2 hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:min-h-9"
            onClick={() => {
              setQuery("");
              setCategory("all");
              setShowAll(false);
            }}
          >
            검색·필터 초기화
          </button>
        </div>
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-2">
          {visibleAssets.map((asset) => {
            const CategoryIcon = CATEGORY_ICONS[asset.category];
            const descriptionId = `bg3d-procedural-description-${asset.id}`;
            return (
              <button
                key={asset.id}
                type="button"
                aria-label={`${asset.label} 장면에 추가`}
                aria-describedby={descriptionId}
                disabled={Boolean(disabledReason)}
                className="group min-h-[9rem] overflow-hidden rounded-lg border border-line bg-card text-left transition-colors hover:border-accent/45 hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => insertAsset(asset)}
              >
                <span className="relative flex h-12 items-center justify-between overflow-hidden border-b border-line/80 bg-panel px-2.5">
                  <CategoryIcon
                    size={20}
                    className="relative z-10 text-fg-2 transition-colors group-hover:text-accent"
                    aria-hidden
                  />
                  <span className="relative z-10 flex -space-x-1" aria-hidden>
                    {assetPreviewColors(asset).map((color) => (
                      <span
                        key={color}
                        className="size-4 rounded-full border-2 border-panel shadow-sm"
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </span>
                </span>
                <span className="block px-2.5 py-2">
                  <span className="block truncate text-xs font-bold text-fg">
                    {asset.label}
                  </span>
                  <span
                    id={descriptionId}
                    className="mt-1 line-clamp-2 block text-[0.64rem] leading-snug text-fg-3"
                  >
                    {asset.description}
                  </span>
                  <span className="mt-2 flex flex-wrap gap-1">
                    <span className="rounded-full bg-raised px-1.5 py-0.5 text-[0.6rem] font-bold text-fg-3">
                      {STUDIO_BG3D_PROCEDURAL_STARTER_CATEGORY_LABELS[asset.category]}
                    </span>
                    <span className="rounded-full bg-accent-soft px-1.5 py-0.5 text-[0.6rem] font-bold text-accent">
                      {asset.budget.nodes} 파츠
                    </span>
                    <span className="rounded-full bg-raised px-1.5 py-0.5 text-[0.6rem] font-bold text-fg-3">
                      {asset.budget.triangles.toLocaleString("ko-KR")}△
                    </span>
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      {hiddenCount > 0 ? (
        <button
          type="button"
          className="mt-3 min-h-11 w-full rounded-lg border border-line bg-card px-3 text-xs font-bold text-fg-2 transition-colors hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:min-h-9"
          onClick={() => setShowAll(true)}
        >
          에셋 {hiddenCount}개 더 보기
        </button>
      ) : showAll && filteredAssets.length > FIRST_PAGE_SIZE ? (
        <button
          type="button"
          className="mt-3 min-h-11 w-full rounded-lg border border-line bg-card px-3 text-xs font-bold text-fg-2 transition-colors hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:min-h-9"
          onClick={() => setShowAll(false)}
        >
          처음 {FIRST_PAGE_SIZE}개만 보기
        </button>
      ) : null}

      <p className="mt-2 text-[0.62rem] leading-relaxed text-fg-3">
        {STUDIO_BG3D_PROCEDURAL_STARTER_PACK.provenance.author} 직접 제작 ·{" "}
        {STUDIO_BG3D_PROCEDURAL_STARTER_PACK.provenance.license.label} · 출처 표기 불필요
      </p>
    </section>
  );
}
