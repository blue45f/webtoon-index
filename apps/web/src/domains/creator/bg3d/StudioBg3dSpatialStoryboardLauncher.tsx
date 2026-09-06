import { lazy, Suspense, useId, useState } from "react";

const SpatialStoryboardPanel = lazy(() => import("./StudioBg3dSpatialStoryboardPanel"));

/** No heavyweight renderer, session request or eager specialist chunk on studio startup. */
export function StudioBg3dSpatialStoryboardLauncher({ hidden = false }: { readonly hidden?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const contentId = useId();
  return (
    <section hidden={hidden} className="mt-4 border-t border-line pt-4">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={contentId}
        className="min-h-11 w-full rounded-lg border border-line bg-card px-3 text-left text-xs font-bold text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        onClick={() => setExpanded((value) => !value)}
      >
        공간 콘티 · XR 배치 계획 {expanded ? "접기" : "열기"}
      </button>
      <div id={contentId} hidden={!expanded}>
        {expanded && !hidden ? (
          <Suspense fallback={<p role="status" className="py-3 text-xs text-fg-3">공간 콘티 도구를 불러오는 중입니다.</p>}>
            <SpatialStoryboardPanel />
          </Suspense>
        ) : null}
      </div>
    </section>
  );
}
