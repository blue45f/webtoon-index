import {
  StudioBg3dProSuiteRuntimeContext,
  useStudioBg3dProSuiteRuntime,
} from "./studio-bg3d-pro-suite-runtime-context";
import { evaluateStudioBg3dProductionPassReadiness } from "./studio-bg3d-production-pass-readiness";
import { StudioBg3dMultiPassExporterPanel as StudioBg3dMultiPassExporterPanelContent } from "./StudioBg3dMultiPassExporterPanelContent";
import { StudioBg3dProductionMultiPassExporterPanel } from "./StudioBg3dProductionMultiPassExporterPanel";
import { StudioBg3dProductionPassPreflightPanel } from "./StudioBg3dProductionPassPreflightPanel";
import { StudioBg3dProductionWorkflowPanel } from "./StudioBg3dProductionWorkflowBoundary";

import type { StudioBg3dMultiPassExporterPanelProps } from "./StudioBg3dMultiPassExporterPanelContent";

export type { StudioBg3dMultiPassExporterPanelProps } from "./StudioBg3dMultiPassExporterPanelContent";

/**
 * Uses the canonical shot-batch runtime inside the editor and keeps the self-contained planner for
 * stories, tests and standalone embedding. An explicit export callback always selects standalone
 * mode, while editor locks can never be overridden by passing `disabled={false}`.
 */
export function StudioBg3dMultiPassExporterPanel(
  props: StudioBg3dMultiPassExporterPanelProps,
) {
  const runtime = useStudioBg3dProSuiteRuntime();
  const disabled = (props.disabled ?? false) || (runtime?.disabled ?? false);

  if (runtime?.productionBatch && props.onStartMultiPassExport === undefined) {
    const batch = runtime.productionBatch;
    const selectedPassReadiness = batch.look
      ? evaluateStudioBg3dProductionPassReadiness(batch.selectedPasses, batch.look)
      : null;
    const availablePassReadiness = batch.look
      ? evaluateStudioBg3dProductionPassReadiness(batch.availablePasses, batch.look)
      : null;
    const effectiveBatch =
      selectedPassReadiness?.blockingReason && batch.blockedReason === null
        ? { ...batch, blockedReason: selectedPassReadiness.blockingReason }
        : batch;
    const displayBatch =
      availablePassReadiness && availablePassReadiness.issues.length > 0
        ? { ...effectiveBatch, availablePasses: availablePassReadiness.readyPasses }
        : effectiveBatch;
    const effectiveRuntime =
      effectiveBatch === batch
        ? runtime
        : { ...runtime, productionBatch: effectiveBatch };

    return (
      <StudioBg3dProSuiteRuntimeContext.Provider value={effectiveRuntime}>
        <StudioBg3dProductionWorkflowPanel
          variant="export"
          defaultExpanded={false}
        />
        <StudioBg3dProductionPassPreflightPanel />
        <StudioBg3dProductionMultiPassExporterPanel
          disabled={disabled}
          shots={runtime.productionShots}
          batch={displayBatch}
        />
      </StudioBg3dProSuiteRuntimeContext.Provider>
    );
  }

  return (
    <StudioBg3dMultiPassExporterPanelContent
      {...props}
      disabled={disabled}
    />
  );
}
