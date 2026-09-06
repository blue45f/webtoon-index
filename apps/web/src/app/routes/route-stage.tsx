import { useState, type AnimationEvent, type ReactNode } from "react";

import { cn } from "@/shared/lib/utils";
import { resolveStudioRoute } from "@/src/domains/creator/studio-router/studio-route-manifest";
import {
  isStudioRoutePathname,
  studioRouteStageKey,
} from "@/src/domains/creator/studio-workspace-route";

interface RouteStageProps {
  pathname: string;
  search: string;
  children: ReactNode;
}

/**
 * route-stage-in 애니메이션(560ms)이 끝나면 transform/filter를 완전히 끊는다 — animation-fill-mode:
 * both가 keyframe의 종료값을 계속 유지하는데, 그 값이 identity transform/filter라도 리터럴 none이
 * 아닌 한(Chrome은 이걸 matrix(1,0,0,1,0,0) 등으로 정규화해 반환) 이 요소가 새 containing block이
 * 되어 자손의 position: fixed를 뷰포트가 아닌 이 요소(라우트 전체 콘텐츠) 기준으로 배치해버린다.
 */
export function RouteStage({
  pathname,
  search,
  children,
}: RouteStageProps) {
  const [settled, setSettled] = useState(false);
  const location = { pathname, search };
  const studioResolution = isStudioRoutePathname(pathname)
    ? resolveStudioRoute(location)
    : null;
  const instantEditorEntry = studioResolution?.kind === "editor"
    || studioResolution?.kind === "publish";
  const stageKey = studioResolution?.lifecycleKey ?? studioRouteStageKey(location);
  const onAnimationEnd = (e: AnimationEvent<HTMLDivElement>) => {
    if (e.animationName === "route-stage-in") setSettled(true);
  };
  return (
    <div
      key={stageKey}
      data-route-stage-key={stageKey}
      className={cn(
        "route-stage",
        (settled || instantEditorEntry) && "route-stage--settled",
        instantEditorEntry && "route-stage--instant"
      )}
      onAnimationEnd={onAnimationEnd}
    >
      {children}
    </div>
  );
}
