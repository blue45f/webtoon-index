import { adjustStudioBrushSize } from "./brush/studio-draw-ux";

import { cn } from "@/shared/lib/utils";

/** CSP식 크기 프리셋 후보 — 렌더 시 STUDIO_BRUSH_SIZE_RANGE로 클램프한 뒤 중복은 하나로 합친다. */
const STUDIO_BRUSH_SIZE_PRESETS = [1, 2, 3, 5, 8, 10, 15, 20, 30, 50, 80, 100] as const;

/** 그리드에 노출하는 "최근 크기" 최대 개수. */
const STUDIO_BRUSH_SIZE_RECENT_LIMIT = 4;

/**
 * CSP식 클릭 크기 프리셋 그리드 — 크기 슬라이더 옆의 보조 진입점.
 * 순수 표현 컴포넌트: 값 소유는 부모(strokeWidth)에 있고, 커밋은 onCommit 한 곳으로만
 * 나간다. 범위 밖 프리셋(예: max 80에서 100)은 클램프 후 중복 제거되어 버튼이 겹치지 않는다.
 */
export function StudioBrushSizePresetGrid({
  activeSize,
  recentSizes,
  onCommit,
}: {
  activeSize: number;
  recentSizes: readonly number[];
  onCommit: (size: number) => void;
}) {
  const presetSizes = [
    ...new Set(STUDIO_BRUSH_SIZE_PRESETS.map((size) => adjustStudioBrushSize(size, 0))),
  ];
  const recentOnly = [
    ...new Set(recentSizes.map((size) => adjustStudioBrushSize(size, 0))),
  ]
    .filter((size) => !presetSizes.includes(size))
    .slice(0, STUDIO_BRUSH_SIZE_RECENT_LIMIT);
  const sizeButtonClass = (active: boolean) =>
    cn(
      "h-7 min-w-7 rounded-md border px-1 text-[0.68rem] tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
      active
        ? "border-accent/60 bg-accent-soft/50 font-semibold text-accent"
        : "border-line bg-card text-fg-2 hover:bg-raised"
    );
  return (
    <div className="space-y-1" role="group" aria-label="브러시 크기 프리셋">
      <div className="grid grid-cols-6 gap-1">
        {presetSizes.map((size) => (
          <button
            key={size}
            type="button"
            aria-pressed={activeSize === size}
            aria-label={`브러시 크기 ${size}px`}
            title={`${size}px`}
            onClick={() => onCommit(size)}
            className={sizeButtonClass(activeSize === size)}
          >
            {size}
          </button>
        ))}
      </div>
      {recentOnly.length > 0 && (
        <div className="flex items-center gap-1">
          <span className="text-[0.62rem] text-fg-3">최근</span>
          <span className="flex flex-wrap gap-1">
            {recentOnly.map((size) => (
              <button
                key={size}
                type="button"
                aria-pressed={activeSize === size}
                aria-label={`최근 브러시 크기 ${size}px`}
                title={`${size}px`}
                onClick={() => onCommit(size)}
                className={sizeButtonClass(activeSize === size)}
              >
                {size}
              </button>
            ))}
          </span>
        </div>
      )}
    </div>
  );
}
