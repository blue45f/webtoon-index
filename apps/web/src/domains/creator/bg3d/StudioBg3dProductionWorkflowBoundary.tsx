import { lazy, Suspense } from "react";

import { useStudioBg3dProSuiteRuntime } from "./studio-bg3d-pro-suite-runtime-context";

import type { StudioBg3dProductionWorkflowPanelProps } from "./StudioBg3dProductionWorkflowPanel";

const LazyProductionIntentPanel = lazy(() =>
  import("./StudioBg3dProductionIntentPanel").then((module) => ({
    default: module.StudioBg3dProductionIntentPanel,
  })),
);
const LazyProductionWorkflowPanel = lazy(() =>
  import("./StudioBg3dProductionWorkflowPanel").then((module) => ({
    default: module.StudioBg3dProductionWorkflowPanel,
  })),
);

function ProductionPanelLoading({ label }: { readonly label: string }) {
  return (
    <p className="mx-3 mt-3 rounded-xl border border-line p-3 text-sm text-fg-3" role="status">
      {label}
    </p>
  );
}

/** Load cross-tool presets only when the connected director is actually mounted. */
export function StudioBg3dProductionIntentPanel() {
  const runtime = useStudioBg3dProSuiteRuntime();
  if (!runtime?.sceneSummary) return null;

  return (
    <Suspense fallback={<ProductionPanelLoading label="제작 프리셋 불러오는 중…" />}>
      <LazyProductionIntentPanel />
    </Suspense>
  );
}

/** Keep workflow presentation out of the editor activation graph without deferring export locks. */
export function StudioBg3dProductionWorkflowPanel(props: StudioBg3dProductionWorkflowPanelProps) {
  const runtime = useStudioBg3dProSuiteRuntime();
  if (!runtime?.sceneSummary) return null;

  return (
    <Suspense fallback={<ProductionPanelLoading label="3D 제작 흐름 불러오는 중…" />}>
      <LazyProductionWorkflowPanel {...props} />
    </Suspense>
  );
}
