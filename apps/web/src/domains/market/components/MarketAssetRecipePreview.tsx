import { Boxes, SlidersHorizontal } from "lucide-react";

import type { RecipePreviewData } from "../models/market-preview";

interface MarketAssetRecipePreviewProps {
  readonly recipe: RecipePreviewData;
  className?: string;
}

function formatParameterValue(value: unknown): string {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return "표시할 수 없는 값";
  }
}

/**
 * Asset manifests currently carry a built-in reference or bounded procedural recipe, not a
 * downloadable image thumbnail. Present the real activation metadata without fabricating a visual
 * preview that could differ from Studio output.
 */
export function MarketAssetRecipePreview({
  recipe,
  className,
}: MarketAssetRecipePreviewProps) {
  const parameters = Object.entries(recipe.parameters ?? {}).slice(0, 8);
  const deliveryLabel = recipe.runtimeRef ? "Studio 내장 에셋 참조" : "절차형 에셋 레시피";

  return (
    <section
      aria-labelledby="market-asset-recipe-heading"
      aria-describedby="market-asset-recipe-note"
      className={`overflow-hidden rounded-xl border border-line bg-card ${className ?? ""}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-panel/50 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <Boxes className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
          <h2 id="market-asset-recipe-heading" className="truncate text-xs font-semibold text-fg">
            에셋 적용 정보 · {recipe.name}
          </h2>
        </div>
        <span className="inline-flex min-h-6 items-center rounded bg-raised px-2 text-[0.65rem] text-fg-2">
          {deliveryLabel}
        </span>
      </div>

      <dl className="divide-y divide-line px-4">
        <div className="grid gap-1 py-3 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-4">
          <dt className="text-xs text-fg-3">레시피 식별자</dt>
          <dd className="min-w-0 break-all font-mono text-xs text-fg">{recipe.recipeId}</dd>
        </div>
        <div className="grid gap-2 py-3 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-4">
          <dt className="inline-flex items-center gap-1.5 text-xs text-fg-3">
            <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
            적용 파라미터
          </dt>
          <dd className="min-w-0">
            {parameters.length > 0 ? (
              <ul className="grid gap-1.5 sm:grid-cols-2">
                {parameters.map(([key, value]) => (
                  <li key={key} className="min-w-0 rounded-lg bg-raised px-2.5 py-2 text-xs">
                    <span className="block truncate text-fg-3">{key}</span>
                    <span className="mt-0.5 block break-words font-medium text-fg">
                      {formatParameterValue(value)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <span className="text-xs text-fg-2">기본 설정으로 적용됩니다.</span>
            )}
          </dd>
        </div>
      </dl>

      <p
        id="market-asset-recipe-note"
        className="border-t border-line bg-panel/30 px-4 py-2 text-[0.68rem] leading-relaxed text-fg-3"
      >
        이 정보는 설치 전에 적용 대상을 확인하기 위한 실제 manifest 값입니다. 최종 모습은 Studio 캔버스에서 확인하세요.
      </p>
    </section>
  );
}
