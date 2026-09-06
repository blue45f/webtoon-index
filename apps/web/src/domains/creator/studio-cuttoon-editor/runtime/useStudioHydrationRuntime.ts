import { useLayoutEffect, useState, useSyncExternalStore } from "react";

import { StudioBrushR8GrainHydrator } from "../../brush/studio-brush-r8-grain-hydrator";
import { StudioFilterMaskSurfaceHydrator } from "../../filter/studio-filter-mask-surface-hydrator";
import { StudioWorkAssetAdmissionCoordinator } from "../../studio-work-asset-admission";
import { StudioWorkAssetHydrator } from "../../studio-work-asset-hydrator";

import type { StudioWorkAssetSceneReference } from "../../studio-work-asset-render-projection";

/** Resource hydration owners and their low-frequency observable revisions. */
export function useStudioHydrationRuntime() {
  const [studioBrushR8GrainHydrator] = useState(
    () => new StudioBrushR8GrainHydrator(),
  );
  const studioBrushR8GrainHydrationRevision = useSyncExternalStore(
    studioBrushR8GrainHydrator.subscribe,
    studioBrushR8GrainHydrator.getVersion,
    studioBrushR8GrainHydrator.getVersion,
  );
  const [studioWorkAssetHydrator] = useState(
    () => new StudioWorkAssetHydrator(null),
  );
  const [studioFilterMaskSurfaceHydrator] = useState(
    () => new StudioFilterMaskSurfaceHydrator(),
  );
  const [studioWorkAssetAdmissionCoordinator] = useState(
    () => new StudioWorkAssetAdmissionCoordinator(),
  );
  const studioWorkAssetHydrationRevision = useSyncExternalStore(
    studioWorkAssetHydrator.subscribe,
    studioWorkAssetHydrator.getVersion,
    studioWorkAssetHydrator.getVersion,
  );
  const studioFilterMaskHydrationRevision = useSyncExternalStore(
    studioFilterMaskSurfaceHydrator.subscribe,
    studioFilterMaskSurfaceHydrator.getVersion,
    studioFilterMaskSurfaceHydrator.getVersion,
  );
  const [studioWorkAssetReferences, setStudioWorkAssetReferences] =
    useState<StudioWorkAssetSceneReference[]>([]);
  const [studioWorkAssetLimitExceeded, setStudioWorkAssetLimitExceeded] = useState(false);

  useLayoutEffect(() => () => {
    studioBrushR8GrainHydrator.dispose();
    studioFilterMaskSurfaceHydrator.dispose();
    studioWorkAssetAdmissionCoordinator.dispose();
    studioWorkAssetHydrator.dispose();
  }, [
    studioBrushR8GrainHydrator,
    studioFilterMaskSurfaceHydrator,
    studioWorkAssetAdmissionCoordinator,
    studioWorkAssetHydrator,
  ]);

  return {
    setStudioWorkAssetLimitExceeded,
    setStudioWorkAssetReferences,
    studioBrushR8GrainHydrationRevision,
    studioBrushR8GrainHydrator,
    studioFilterMaskHydrationRevision,
    studioFilterMaskSurfaceHydrator,
    studioWorkAssetAdmissionCoordinator,
    studioWorkAssetHydrationRevision,
    studioWorkAssetHydrator,
    studioWorkAssetLimitExceeded,
    studioWorkAssetReferences,
  } as const;
}
