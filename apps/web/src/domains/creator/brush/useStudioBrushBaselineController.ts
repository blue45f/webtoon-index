import { useEffect, useRef, useState } from "react";

import type {
  StudioBrushBaseline,
  StudioBrushBaselineInspection,
  StudioBrushBaselineSelection,
} from "./studio-brush-baseline-contract";
import type {
  StudioBrushDefaultRestoreDirection,
  StudioBrushDefaultRestoreTransaction,
} from "./studio-brush-default-restore";
import type {
  StudioBrushSnapshot,
  StudioSavedBrush,
} from "./studio-brush-library";
import type { StudioBrushCatalogSelection } from "./studio-brush-selection";

type StudioBrushBaselineContractModule =
  typeof import("./studio-brush-baseline-contract");

function loadStudioBrushBaselineContract(): Promise<StudioBrushBaselineContractModule> {
  return import("./studio-brush-baseline-contract");
}

const DEFAULT_STUDIO_BRUSH_BASELINE_RUNTIME: StudioBrushBaselineControllerRuntime =
  Object.freeze({
    loadContract: loadStudioBrushBaselineContract,
  });

export interface StudioBrushBaselineControllerRuntime {
  readonly loadContract: () => Promise<StudioBrushBaselineContractModule>;
}

export interface StudioBrushDefaultRestoreViewState {
  readonly sourceName: string;
  readonly modifiedCount: number;
  readonly loading: boolean;
  readonly available: boolean;
  readonly undoAvailable: boolean;
}

export interface UseStudioBrushBaselineControllerOptions {
  readonly currentSnapshot: StudioBrushSnapshot;
  readonly savedBrushes: readonly StudioSavedBrush[];
  readonly fallbackSourceName: string;
  readonly preserveStrokeWidth: boolean;
  readonly preserveBrushOpacity: boolean;
  readonly materializeCatalogSelection: (
    catalogId: string,
  ) => Promise<StudioBrushCatalogSelection | null>;
  readonly applyRestoreTransaction: (
    transaction: StudioBrushDefaultRestoreTransaction,
    direction: StudioBrushDefaultRestoreDirection,
  ) => void;
  readonly announce: (message: string) => void;
  readonly initialCatalogId?: string;
}

export interface StudioBrushBaselineController {
  readonly activeSavedBrushId: string | null;
  readonly restoreState: StudioBrushDefaultRestoreViewState;
  readonly select: (selection: StudioBrushBaselineSelection) => void;
  readonly selectCatalog: (catalogId: string) => void;
  readonly invalidate: () => void;
  readonly restoreDefaults: () => Promise<void>;
}

interface StudioBrushDefaultRestoreRecord {
  readonly baselineKey: StudioBrushBaseline["identity"]["key"];
  readonly transaction: StudioBrushDefaultRestoreTransaction;
}

/**
 * Owns the async brush-baseline session without pulling the optional baseline contract into the
 * initial Studio chunk. The editor remains responsible for applying a transaction to its canonical
 * brush state; this controller owns selection identity, stale-request invalidation, dirty
 * inspection, and the single safe restore undo.
 */
function brushSnapshotFingerprint(s: StudioBrushSnapshot): string {
  return [
    s.brushId,
    s.sourcePresetId ?? "",
    s.strokeWidth,
    s.brushOpacity,
    s.stabilizer,
    s.stabilizerMode ?? "",
    s.postCorrection,
    s.preserveCorners ? 1 : 0,
    JSON.stringify(s.pressureCurve ?? null),
    s.pressureMinSize,
    s.useVelocityPressure ? 1 : 0,
    s.velocitySensitivity,
    s.tiltEnabled ? 1 : 0,
    s.tipAngle,
    s.tipRoundness,
    JSON.stringify(s.brushDynamics ?? null),
    JSON.stringify(s.stampTuning ?? null),
  ].join("|");
}

export function useStudioBrushBaselineController(
  options: UseStudioBrushBaselineControllerOptions,
  runtime: StudioBrushBaselineControllerRuntime =
    DEFAULT_STUDIO_BRUSH_BASELINE_RUNTIME,
): StudioBrushBaselineController {
  const [selectedSavedBrushId, setSelectedSavedBrushId] = useState<string | null>(
    null,
  );
  const [activeBaseline, setActiveBaseline] =
    useState<StudioBrushBaseline | null>(null);
  const [inspection, setInspection] =
    useState<StudioBrushBaselineInspection | null>(null);
  const [restoreLoading, setRestoreLoading] = useState(true);
  const [lastRestore, setLastRestore] =
    useState<StudioBrushDefaultRestoreRecord | null>(null);
  const baselineRequestRef = useRef(0);
  const inspectionRequestRef = useRef(0);
  const latestOptionsRef = useRef(options);
  const runtimeRef = useRef(runtime);
  latestOptionsRef.current = options;
  runtimeRef.current = runtime;

  const activeSavedBrush =
    selectedSavedBrushId === null
      ? null
      : options.savedBrushes.find(
          (brush) => brush.id === selectedSavedBrushId,
        ) ?? null;
  const activeSavedBrushId = activeSavedBrush?.id ?? null;

  function invalidate(): void {
    baselineRequestRef.current += 1;
    inspectionRequestRef.current += 1;
    setSelectedSavedBrushId(null);
    setLastRestore(null);
    setActiveBaseline(null);
    setInspection(null);
    setRestoreLoading(false);
  }

  function select(selection: StudioBrushBaselineSelection): void {
    const requestId = baselineRequestRef.current + 1;
    baselineRequestRef.current = requestId;
    setSelectedSavedBrushId(
      selection.kind === "saved" ? selection.brush.id : null,
    );
    setLastRestore(null);
    setRestoreLoading(true);
    void runtimeRef.current
      .loadContract()
      .then((contract) => {
        if (baselineRequestRef.current !== requestId) return;
        setActiveBaseline(contract.createStudioBrushBaseline(selection));
        setInspection(null);
        setRestoreLoading(false);
      })
      .catch(() => {
        if (baselineRequestRef.current !== requestId) return;
        setActiveBaseline(null);
        setInspection(null);
        setRestoreLoading(false);
      });
  }

  function selectCatalog(catalogId: string): void {
    const requestId = baselineRequestRef.current + 1;
    baselineRequestRef.current = requestId;
    setSelectedSavedBrushId(null);
    setLastRestore(null);
    setRestoreLoading(true);
    void Promise.all([
      runtimeRef.current.loadContract(),
      latestOptionsRef.current.materializeCatalogSelection(catalogId),
    ])
      .then(([contract, selection]) => {
        if (baselineRequestRef.current !== requestId) return;
        if (!selection) {
          setActiveBaseline(null);
          setInspection(null);
          setRestoreLoading(false);
          return;
        }
        setActiveBaseline(
          contract.createStudioCatalogBrushBaseline(selection),
        );
        setInspection(null);
        setRestoreLoading(false);
      })
      .catch(() => {
        if (baselineRequestRef.current !== requestId) return;
        setActiveBaseline(null);
        setInspection(null);
        setRestoreLoading(false);
      });
  }

  useEffect(() => {
    selectCatalog(latestOptionsRef.current.initialCatalogId ?? "pen");
  }, []);

  useEffect(() => {
    return () => {
      baselineRequestRef.current += 1;
      inspectionRequestRef.current += 1;
    };
  }, []);

  useEffect(() => {
    if (!selectedSavedBrushId || activeSavedBrush) return;
    invalidate();
  }, [activeSavedBrush, selectedSavedBrushId]);

  useEffect(() => {
    const baseline = activeBaseline;
    if (baseline?.identity.kind !== "saved") return;
    const requestId = baselineRequestRef.current;
    void runtimeRef.current
      .loadContract()
      .then((contract) => {
        if (baselineRequestRef.current !== requestId) return;
        const next = contract.transitionStudioBrushBaseline(baseline, {
          type: "saved-library-reconciled",
          brushes: options.savedBrushes,
        });
        if (next === baseline) return;
        if (!next) {
          invalidate();
          return;
        }
        setActiveBaseline(next);
      })
      .catch(() => {
        // A failed optional contract chunk must not erase a valid in-memory baseline.
      });
  }, [activeBaseline, options.savedBrushes]);

  const snapshotFingerprint = brushSnapshotFingerprint(options.currentSnapshot);

  useEffect(() => {
    const requestId = inspectionRequestRef.current + 1;
    inspectionRequestRef.current = requestId;
    if (!activeBaseline) {
      setInspection(null);
      return;
    }
    void runtimeRef.current
      .loadContract()
      .then((contract) => {
        if (inspectionRequestRef.current !== requestId) return;
        const current = latestOptionsRef.current;
        setInspection(
          contract.inspectStudioBrushBaseline(
            activeBaseline,
            current.currentSnapshot,
            {
              preserveStrokeWidth: current.preserveStrokeWidth,
              preserveBrushOpacity: current.preserveBrushOpacity,
            },
          ),
        );
      })
      .catch(() => {
        if (inspectionRequestRef.current === requestId) {
          setInspection(null);
        }
      });
    return () => {
      if (inspectionRequestRef.current === requestId) {
        inspectionRequestRef.current += 1;
      }
    };
  }, [
    activeBaseline,
    snapshotFingerprint,
    options.preserveStrokeWidth,
    options.preserveBrushOpacity,
  ]);

  useEffect(() => {
    if (inspection?.status === "modified") {
      setLastRestore(null);
    }
  }, [inspection]);

  async function restoreDefaults(): Promise<void> {
    const baseline = activeBaseline;
    const requestId = baselineRequestRef.current;
    const previousRestore = lastRestore;
    const requestedUndo =
      previousRestore !== null
      && baseline !== null
      && previousRestore.baselineKey === baseline.identity.key
      && inspection?.status === "clean";
    if (!baseline || restoreLoading) {
      latestOptionsRef.current.announce(
        "브러시 기본값을 확인하는 중이에요.",
      );
      return;
    }

    setRestoreLoading(true);
    try {
      const contract = await runtimeRef.current.loadContract();
      if (baselineRequestRef.current !== requestId) return;
      const current = latestOptionsRef.current;
      const freshInspection = contract.inspectStudioBrushBaseline(
        baseline,
        current.currentSnapshot,
        {
          preserveStrokeWidth: current.preserveStrokeWidth,
          preserveBrushOpacity: current.preserveBrushOpacity,
        },
      );
      if (requestedUndo && previousRestore) {
        if (freshInspection.status === "clean") {
          current.applyRestoreTransaction(
            previousRestore.transaction,
            "undo",
          );
          setLastRestore(null);
          return;
        }
        setLastRestore(null);
        if (freshInspection.status === "invalid") {
          invalidate();
          current.announce(
            "브러시가 바뀌어 복원 되돌리기를 취소했어요.",
          );
          return;
        }
        setInspection(freshInspection);
        current.announce(
          "브러시 설정이 바뀌어 이전 복원 되돌리기를 취소했어요.",
        );
        return;
      }
      if (freshInspection.status === "invalid") {
        invalidate();
        current.announce(
          "브러시가 바뀌어 기본값을 다시 확인해야 해요.",
        );
        return;
      }
      if (freshInspection.status === "clean") {
        current.announce(
          `${baseline.profile.sourceName} 브러시는 이미 기본값이에요.`,
        );
        return;
      }
      current.applyRestoreTransaction(freshInspection.transaction, "redo");
      setLastRestore({
        baselineKey: baseline.identity.key,
        transaction: freshInspection.transaction,
      });
    } catch {
      latestOptionsRef.current.announce(
        "브러시 기본값을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.",
      );
    } finally {
      if (baselineRequestRef.current === requestId) {
        setRestoreLoading(false);
      }
    }
  }

  return {
    activeSavedBrushId,
    restoreState: {
      sourceName: activeBaseline?.profile.sourceName
        ?? options.fallbackSourceName,
      modifiedCount:
        inspection?.status === "modified" ? inspection.dirtyCount : 0,
      loading:
        restoreLoading || Boolean(activeBaseline && !inspection),
      available:
        activeBaseline !== null
        && inspection !== null
        && inspection.status !== "invalid",
      undoAvailable:
        lastRestore !== null
        && activeBaseline !== null
        && lastRestore.baselineKey === activeBaseline.identity.key
        && inspection?.status === "clean",
    },
    select,
    selectCatalog,
    invalidate,
    restoreDefaults,
  };
}
