import { Suspense } from "react";

import { StudioRouteLoading } from "../../StudioLazySurfaceFallback";

import { lazyRetry } from "@/shared/lib/lazy-retry";

const StudioStoryworldLabPage = lazyRetry(
  () => import("../../storyworld/StudioStoryworldLabPage").then((module) => ({
    default: module.StudioStoryworldLabPage,
  })),
  "StudioStoryworldLabPage",
);

type StudioStoryworldRouteProps = {
  readonly workId: string | null;
  readonly remixSourceWorkId: string | null;
};

/** The router owns document identity; this leaf owns the asynchronous page boundary. */
export function StudioStoryworldRoute(props: StudioStoryworldRouteProps) {
  return (
    <Suspense fallback={<StudioRouteLoading label="스토리월드 인과관계 랩을 여는 중..." />}>
      <StudioStoryworldLabPage {...props} />
    </Suspense>
  );
}
