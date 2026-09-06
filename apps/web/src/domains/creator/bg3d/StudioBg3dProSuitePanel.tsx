import { lazy, Suspense, useState } from "react";

import { useStudioBg3dProSuiteRuntime } from "./studio-bg3d-pro-suite-runtime-context";

import type { StudioBg3dProSuitePanelProps } from "./StudioBg3dProSuitePanelContent";

export type {
  ProSuiteActiveTab,
  ProSuiteCategory,
  StudioBg3dProSuitePanelProps,
} from "./StudioBg3dProSuitePanelContent";

const LazyProSuiteContent = lazy(async () => {
  const module = await import("./StudioBg3dProSuitePanelContent");
  return { default: module.StudioBg3dProSuitePanel };
});

/** Loads specialist tools on their first visible activation, then preserves their local state. */
export function StudioBg3dProSuitePanel(props: StudioBg3dProSuitePanelProps) {
  const runtime = useStudioBg3dProSuiteRuntime();
  const active = runtime?.proSuiteActive ?? true;
  const [hasActivated, setHasActivated] = useState(active);

  // The parent keeps tab panels mounted with `hidden`. Do not import the suite merely because
  // that hidden shell mounted. Once opened, retain it so switching tabs never erases edits.
  if (active && !hasActivated) setHasActivated(true);
  if (!active && !hasActivated) return null;

  return (
    <Suspense
      fallback={
        <p className="min-h-11 p-3 text-sm text-fg-3" role="status" aria-live="polite">
          3D 전문 도구를 불러오는 중입니다.
        </p>
      }
    >
      <LazyProSuiteContent
        {...props}
        disabled={(props.disabled ?? false) || (runtime?.disabled ?? false)}
      />
    </Suspense>
  );
}
