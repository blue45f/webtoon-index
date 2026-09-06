import { lazy } from "react";

export const LazyStudioMenubarContent = lazy(() =>
  import("./StudioMenubarContent").then(({ StudioMenubarContent }) => ({
    default: StudioMenubarContent,
  }))
);

export const LazyStudioInterchangeLossPreviewDialog = lazy(() =>
  import("./StudioInterchangeLossPreviewDialog").then(({
    StudioInterchangeLossPreviewDialog,
  }) => ({
    default: StudioInterchangeLossPreviewDialog,
  }))
);

export const LazyStudioQuickComicWizard = lazy(() =>
  import("./comic/StudioQuickComicWizard").then(({ StudioQuickComicWizard }) => ({
    default: StudioQuickComicWizard,
  }))
);

export const LazyStudioSceneSnapshotDialog = lazy(() =>
  import("./StudioSceneSnapshotDialog").then(({ StudioSceneSnapshotDialog }) => ({
    default: StudioSceneSnapshotDialog,
  }))
);

export const LazyStudioProductionBibleWorkspace = lazy(() =>
  import("./StudioProductionBibleWorkspace").then(({ StudioProductionBibleWorkspace }) => ({
    default: StudioProductionBibleWorkspace,
  }))
);

export const LazyStudioAssetRightsAuditDialog = lazy(() =>
  import("./StudioAssetRightsAuditDialog").then(({ StudioAssetRightsAuditDialog }) => ({
    default: StudioAssetRightsAuditDialog,
  }))
);

export const LazyStudioAnimaticTimelineDialog = lazy(() =>
  import("./StudioAnimaticTimelineDialog").then(({ StudioAnimaticTimelineDialog }) => ({
    default: StudioAnimaticTimelineDialog,
  }))
);

export const LazyStudioHybridDccDialog = lazy(() =>
  import("./hybrid-dcc/StudioHybridDccDialog").then(({ StudioHybridDccDialog }) => ({
    default: StudioHybridDccDialog,
  }))
);

export const LazyStudioQuickAccessSurface = lazy(() =>
  import("./StudioQuickAccessSurface").then(({ StudioQuickAccessSurface }) => ({
    default: StudioQuickAccessSurface,
  }))
);

export const LazyStudioPageListPane = lazy(() =>
  import("./StudioPageListPane").then(({ StudioPageListPane }) => ({
    default: StudioPageListPane,
  }))
);

export const LazyStudioLeftToolRail = lazy(() =>
  import("./StudioLeftToolRail").then(({ StudioLeftToolRail }) => ({
    default: StudioLeftToolRail,
  }))
);
