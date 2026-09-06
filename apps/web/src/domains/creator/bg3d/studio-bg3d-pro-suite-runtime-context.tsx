import { createContext, useContext } from "react";

import type { StudioBg3dProductionLookState } from "./studio-bg3d-production-pass-readiness";
import type { StudioBg3dProductionSceneSummary } from "./studio-bg3d-production-workflow";
import type {
  StudioBg3dCameraSettings,
  StudioBg3dShot,
} from "./studio-bg3d-scene-document";
import type { StudioBg3dShotBatchPass } from "./studio-bg3d-shot-batch-pass-catalog";

export interface StudioBg3dProductionBatchProgress {
  readonly stage: "render" | "contact" | "archive";
  readonly completed: number;
  readonly total: number;
  readonly label: string;
}

export interface StudioBg3dProductionBatchRecoverySummary {
  readonly completedShots: number;
  readonly totalShots: number;
  readonly mode: "durable" | "memory";
  readonly downloadRequested?: boolean;
  readonly degradedReason?: string | null;
}

/**
 * Command-shaped projection of the canonical shot-batch state. Callers cannot mutate editor Sets
 * directly or bypass the batch recovery and archive integrity path.
 */
export interface StudioBg3dProductionBatchRuntime {
  readonly selectedShotIds: readonly string[];
  readonly availablePasses: readonly StudioBg3dShotBatchPass[];
  readonly selectedPasses: readonly StudioBg3dShotBatchPass[];
  readonly passLabels: Readonly<Record<StudioBg3dShotBatchPass, string>>;
  /** Active SceneDocument LT settings used to prevent presets from promising skipped artifacts. */
  readonly look?: StudioBg3dProductionLookState;
  readonly exportHeight: number | "per-shot";
  readonly exportHeightOptions: readonly number[];
  readonly includeLayeredPsd: boolean;
  readonly includeContactSheet: boolean;
  readonly recoveryReady: boolean;
  readonly blockedReason: string | null;
  readonly isRendering: boolean;
  readonly progress: StudioBg3dProductionBatchProgress | null;
  readonly recoverySummary: StudioBg3dProductionBatchRecoverySummary | null;
  readonly selectAllShots: () => void;
  readonly clearShotSelection: () => void;
  readonly setShotSelected: (shotId: string, selected: boolean) => void;
  readonly setSelectedPasses: (passes: readonly StudioBg3dShotBatchPass[]) => void;
  readonly setPassSelected: (pass: StudioBg3dShotBatchPass, selected: boolean) => void;
  readonly setExportHeight: (height: number | "per-shot") => void;
  readonly setIncludeLayeredPsd: (included: boolean) => void;
  readonly setIncludeContactSheet: (included: boolean) => void;
  readonly startExport: () => Promise<void>;
}

/**
 * Runtime-only bridge between the production 3D editor shell and deeply nested Pro Suite tools.
 *
 * The canonical scene document remains owned by the editor. This context only carries the exact
 * read model and commands already exposed by StudioBg3dViewPanel, so specialist panels do not
 * create a second store or bypass undo/redo, capture locks, or AI consent gates.
 */
export interface StudioBg3dProSuiteRuntimeValue {
  readonly disabled: boolean;
  /** Actual view-tab visibility; hidden, never-opened specialist tools must not load. */
  readonly proSuiteActive?: boolean;
  readonly baseCamera: StudioBg3dCameraSettings;
  readonly productionShots: readonly StudioBg3dShot[];
  readonly productionBatch?: StudioBg3dProductionBatchRuntime;
  /** Bounded projection used by the connected production workflow UI. */
  readonly sceneSummary?: StudioBg3dProductionSceneSummary;
  readonly onSetLineArtPreview?: (enabled: boolean) => void;
  readonly onSetTransparentBackground?: (transparent: boolean) => void;
  readonly onApplyCameraView: (camera: StudioBg3dCameraSettings) => void;
  readonly onPreviewCameraView?: (camera: StudioBg3dCameraSettings) => void;
  readonly onFinishCameraViewPreview?: () => void;
  readonly onCaptureCurrentShot: () => void;
  readonly onApplyProductionShot: (shotId: string) => void;
  readonly onMoveProductionShot: (shotId: string, targetIndex: number) => void;
  readonly onRemoveProductionShot: (shotId: string) => void;
  readonly onUseCurrentFrameAsAiReference: (() => void) | undefined;
  readonly aiReferenceBusy: boolean;
  readonly aiReferenceDisabled: boolean;
}

export const StudioBg3dProSuiteRuntimeContext =
  createContext<StudioBg3dProSuiteRuntimeValue | null>(null);

export function useStudioBg3dProSuiteRuntime(): StudioBg3dProSuiteRuntimeValue | null {
  return useContext(StudioBg3dProSuiteRuntimeContext);
}
