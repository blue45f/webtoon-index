/**
 * Thin Studio UI surface for Hybrid DCC workspace (product exposure).
 * Pure workspace kernels drive state; this panel is the React shell only.
 */

import { useEffect, useEffectEvent, useRef, useState } from "react";

import {
  createStudioHybridDccComponentSelection,
  mutateStudioHybridDccComponentSelection,
  resolveStudioHybridDccSelectedOrDefaultFaceIds,
  resolveStudioHybridDccSelectedOrDefaultUndirectedEdgeIds,
  type StudioHybridDccComponentMode,
  type StudioHybridDccComponentSelection,
  type StudioHybridDccMeshSelectionSource,
  type StudioHybridDccSelectionMode,
  type StudioHybridDccSelectionOperation,
  type StudioHybridDccSelectionResult,
} from "./studio-hybrid-dcc-component-selection";
import {
  workspaceAddActiveModifier,
  workspaceApplyActiveModifierStack,
  workspaceMoveActiveModifier,
  workspacePatchActiveModifier,
  workspaceRefreshModifierPreviews,
  workspaceRemoveActiveModifier,
  workspaceToggleActiveModifier,
} from "./studio-hybrid-dcc-modifier-workspace";
import { workspaceLoadEditableRoomPreset } from "./studio-hybrid-dcc-room-workspace";
import {
  createStudioHybridDccWorkspace,
  runStudioHybridDccFullEngineSuite,
  workspaceAddArtistInk,
  workspaceAddGeoNodesPrimitive,
  workspaceAddGeoNodesStarter,
  workspaceAddUnitCube,
  workspaceBevelEdgesActive,
  workspaceBendActive,
  workspaceBooleanDifference,
  workspaceCadProp,
  workspaceCadRevolve,
  workspaceClothStep,
  workspaceCollabJoin,
  workspaceCommitObjectTransform,
  workspaceDecimateActive,
  workspaceDeleteActive,
  workspaceDiagnostics,
  workspaceDuplicateActive,
  workspaceDynatopoActive,
  workspaceEnsureShots,
  workspaceExportActiveMesh,
  workspaceExportToon3d,
  workspaceExtrudeActive,
  workspaceExtrudeRegionActive,
  workspaceImportBytes,
  workspaceInsetActive,
  workspaceKnifeActive,
  workspaceLoopCutActive,
  workspaceOrientOutwardActive,
  workspaceImportIfcCity,
  workspaceManifoldBooleanActive,
  workspaceOcctBooleanCut,
  workspaceOcctBox,
  workspaceOcctFillet,
  workspaceOcctLoft,
  workspaceOcctRevolve,
  workspaceOcctSphere,
  workspaceBooleanBetweenAssets,
  workspaceOcctCircularPattern,
  workspaceOcctDraftPrism,
  workspaceOcctFillet2dExtrude,
  workspaceOcctLinearPattern,
  workspaceOcctMirror,
  workspaceOcctOffsetShape,
  workspaceOcctPipe,
  workspaceOcctPipeShell,
  workspaceOcctSection,
  workspaceOcctStepRoundTrip,
  workspaceOcctThickShell,
  workspaceOcctTorus,
  workspaceOcctWedge,
  workspaceOpenNurbsSphere,
  workspaceRebuildBom,
  workspaceReconcileSelectionAfterHistory,
  workspaceRedo,
  workspaceRepairActive,
  workspaceRetopoActive,
  workspaceSelectAsset,
  workspaceSetAssetVisibility,
  workspaceShadeActive,
  workspaceSculptActive,
  workspaceSubdivideActive,
  workspaceUndo,
  workspaceUvUnwrapActive,
  workspaceVoxelRemeshActive,
  workspaceWeldActive,
  type StudioHybridDccWorkspace,
} from "./studio-hybrid-dcc-workspace";
import {
  StudioHybridDccModifierInspector,
  type StudioHybridDccModifierStackView,
  type StudioHybridDccModifierView,
} from "./StudioHybridDccModifierInspector";
import { StudioHybridDccViewport } from "./StudioHybridDccViewport";

import type { StudioHybridDccBg3dHandoffResult } from "./studio-hybrid-dcc-bg3d-handoff";
import type { StudioHybridDccPersistenceReceiptEvidence } from "./studio-hybrid-dcc-persistence";
import type { StudioSculptBrushKind } from "./studio-hybrid-sculpt-kernel";
import type { StudioDccWorkbenchMode } from "../studio-workspace-route";

const STUDIO_HYBRID_DCC_WORKBENCH_MODES = [
  { id: "model", label: "모델링", accessibleLabel: "모델링 작업 모드" },
  { id: "build", label: "공간 제작", accessibleLabel: "공간 제작 작업 모드" },
  { id: "cad", label: "정밀 CAD", accessibleLabel: "정밀 솔리드 작업 모드" },
  { id: "sculpt", label: "조형", accessibleLabel: "조형 작업 모드" },
  { id: "material", label: "재질·UV", accessibleLabel: "재질 작업 모드" },
  { id: "shot", label: "컷·선화", accessibleLabel: "컷과 비사실 렌더 작업 모드" },
] as const;

function friendlyHybridDccAssetName(assetId: string, index: number): string {
  if (/^(?:asset-)?cube(?:-|$)/iu.test(assetId)) return "큐브";
  const roomPart = /-part-(\d+)$/u.exec(assetId);
  if (roomPart) return `방 구성품 ${Number(roomPart[1])}`;
  return `오브젝트 ${index + 1}`;
}

const SCULPT_BRUSH_LABELS: Readonly<Record<StudioSculptBrushKind, string>> = Object.freeze({
  grab: "잡아당기기",
  smooth: "매끈하게",
  inflate: "부풀리기",
  clay: "점토",
  crease: "접힘",
  flatten: "평평하게",
  scrape: "긁어내기",
  snakeHook: "스네이크 훅",
});

const STUDIO_HYBRID_DCC_MODE_GUIDE: Record<
  StudioDccWorkbenchMode,
  { readonly title: string; readonly description: string }
> = {
  model: {
    title: "오브젝트 만들기와 형태 편집",
    description: "기본 도형을 만들고, 면을 밀거나 모서리를 다듬어 소품 형태를 완성합니다.",
  },
  build: {
    title: "방과 배경 세트 만들기",
    description: "공간 프리셋과 건물 데이터를 불러와 웹툰 컷에 쓸 배경을 빠르게 구성합니다.",
  },
  cad: {
    title: "치수가 정확한 솔리드 제작",
    description: "구멍, 라운드, 쉘, 파이프 같은 정밀 형상을 안정적인 CAD 커널로 계산합니다.",
  },
  sculpt: {
    title: "조형 실험실 · voxel-lite",
    description: "검증된 전문 Sculpt provider가 연결되기 전, 제한된 표면 변형과 메시 정리만 실험적으로 제공합니다.",
  },
  material: {
    title: "표면 방향과 UV 준비",
    description: "텍스처가 올바르게 붙도록 UV와 노멀을 정리하고 내보내기 결과를 점검합니다.",
  },
  shot: {
    title: "카메라 컷과 웹툰용 선화 전달",
    description: "여러 컷을 만들고 작가 선을 보존한 채 3D 배경·컷 편집기로 안전하게 넘깁니다.",
  },
};

interface StudioHybridDccQuickTool {
  readonly label: string;
  readonly technical: string;
  readonly description: string;
  readonly requiresAsset?: boolean;
  readonly disabled?: boolean;
  readonly primary?: boolean;
  readonly onClick: () => void;
}

interface StudioHybridDccPanelRunResult {
  readonly workspace: StudioHybridDccWorkspace;
  readonly selection?: StudioHybridDccComponentSelection;
}

function isStudioHybridDccPanelRunResult(
  value: StudioHybridDccWorkspace | StudioHybridDccPanelRunResult,
): value is StudioHybridDccPanelRunResult {
  return Object.hasOwn(value, "workspace");
}

function hybridDccSelectionSource(
  workspace: StudioHybridDccWorkspace,
  assetId = workspace.activeAssetId,
): StudioHybridDccMeshSelectionSource | null {
  if (!assetId) return null;
  const record = workspace.session.state.geometry.records[assetId];
  if (!record) return null;
  return {
    assetId,
    mesh: record.mesh,
    meshRevision: record.revision,
    sourceHash: record.meshHash,
  };
}

function selectionResultValue<T>(result: StudioHybridDccSelectionResult<T>): T {
  if (result.ok) return result.value;
  throw new Error(result.diagnostics.map(({ message }) => message).join(" · "));
}

function alignHybridDccSelectionToWorkspace(
  selection: StudioHybridDccComponentSelection,
  workspace: StudioHybridDccWorkspace,
): StudioHybridDccComponentSelection {
  const source = hybridDccSelectionSource(workspace);
  if (!source) return createStudioHybridDccComponentSelection();
  if (selection.mode === "object") {
    return selectionResultValue(mutateStudioHybridDccComponentSelection(selection, {
      mode: "object",
      operation: "replace",
      ids: [source.assetId],
      activeId: source.assetId,
    }));
  }
  if (selection.provenance?.assetId === source.assetId
    && selection.provenance.meshRevision === source.meshRevision
    && selection.provenance.sourceHash === source.sourceHash) {
    return selection;
  }
  return selectionResultValue(mutateStudioHybridDccComponentSelection(
    createStudioHybridDccComponentSelection(),
    {
      mode: selection.mode,
      operation: "replace",
      ids: [],
      source,
    },
  ));
}

export interface StudioHybridDccPanelProps {
  /** Opens the shipping Shot/NPR editor with verified derivatives of the DCC authority. */
  readonly onOpenInBackground3D?: (result: StudioHybridDccBg3dHandoffResult) => void;
  readonly initialWorkspace?: StudioHybridDccWorkspace;
  readonly workspaceDocumentId?: string;
  readonly onWorkspaceChange?: (workspace: StudioHybridDccWorkspace) => void;
  readonly persistenceReceipt?: StudioHybridDccPersistenceReceiptEvidence;
  readonly persistenceStatus?: StudioHybridDccPersistenceStatus;
  readonly workbenchMode?: StudioDccWorkbenchMode;
  readonly onWorkbenchModeChange?: (mode: StudioDccWorkbenchMode) => void;
}

export type StudioHybridDccPersistenceStatus =
  | "checking"
  | "ready"
  | "saving"
  | "saved"
  | "session-only"
  | "error";

const STUDIO_HYBRID_DCC_PERSISTENCE_LABEL: Record<
  StudioHybridDccPersistenceStatus,
  string
> = {
  checking: "복구 저장 확인 중",
  ready: "3D 자동 저장 준비됨",
  saving: "3D 작업 저장 중",
  saved: "3D 작업 자동 저장됨",
  "session-only": "이번 실행에서만 보관",
  error: "자동 저장 확인 필요",
};

export function StudioHybridDccPanel({
  initialWorkspace,
  onOpenInBackground3D,
  onWorkspaceChange,
  onWorkbenchModeChange,
  persistenceReceipt,
  persistenceStatus,
  workbenchMode: controlledWorkbenchMode,
  workspaceDocumentId,
}: StudioHybridDccPanelProps) {
  const [ws, setWs] = useState<StudioHybridDccWorkspace>(() =>
    initialWorkspace ?? createStudioHybridDccWorkspace(workspaceDocumentId ?? "ui-workspace"),
  );
  const [componentSelection, setComponentSelection] =
    useState<StudioHybridDccComponentSelection>(() => alignHybridDccSelectionToWorkspace(
      createStudioHybridDccComponentSelection(),
      ws,
    ));
  const [log, setLog] = useState<string>(
    "준비됨 · 큐브를 추가하거나 모델을 가져와 3D 제작을 시작하세요.",
  );
  const [busy, setBusy] = useState(false);
  const [localWorkbenchMode, setLocalWorkbenchMode] =
    useState<StudioDccWorkbenchMode>("model");
  const workbenchMode = controlledWorkbenchMode ?? localWorkbenchMode;
  const changeWorkbenchMode = (mode: StudioDccWorkbenchMode) => {
    if (controlledWorkbenchMode === undefined) setLocalWorkbenchMode(mode);
    onWorkbenchModeChange?.(mode);
  };
  const [modifierError, setModifierError] = useState<string | null>(null);
  const [sculptBrushKind, setSculptBrushKind] = useState<StudioSculptBrushKind>("inflate");
  const [sculptDig, setSculptDig] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const mountedRef = useRef(true);
  const runGenerationRef = useRef(0);
  const handoffAbortRef = useRef<AbortController | null>(null);
  const previewRestoreLeaseRef = useRef<{
    readonly workspace: StudioHybridDccWorkspace;
    promise: Promise<StudioHybridDccWorkspace> | null;
  } | null>(null);
  if (!previewRestoreLeaseRef.current) {
    previewRestoreLeaseRef.current = { workspace: ws, promise: null };
  }
  const lastEmittedWorkspaceRef = useRef(ws);
  const emitWorkspaceChange = useEffectEvent((workspace: StudioHybridDccWorkspace) => {
    onWorkspaceChange?.(workspace);
  });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      runGenerationRef.current += 1;
      handoffAbortRef.current?.abort();
      handoffAbortRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (lastEmittedWorkspaceRef.current === ws) return;
    lastEmittedWorkspaceRef.current = ws;
    emitWorkspaceChange(ws);
  }, [ws]);

  useEffect(() => {
    const lease = previewRestoreLeaseRef.current!;
    lease.promise ??= workspaceRefreshModifierPreviews(lease.workspace);
    let cancelled = false;
    void lease.promise
      .then((next) => {
        if (cancelled || next === lease.workspace) return;
        setWs((current) => current === lease.workspace ? next : current);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : String(error);
        setModifierError(message);
        setLog(`비파괴 변형 미리보기 복구 실패 · ${message}`);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const run = async (
    label: string,
    fn: () =>
      | StudioHybridDccWorkspace
      | StudioHybridDccPanelRunResult
      | Promise<StudioHybridDccWorkspace | StudioHybridDccPanelRunResult>,
  ) => {
    const generation = ++runGenerationRef.current;
    setBusy(true);
    try {
      const result = await fn();
      const raw = isStudioHybridDccPanelRunResult(result) ? result.workspace : result;
      const requestedSelection = isStudioHybridDccPanelRunResult(result)
        ? result.selection
        : undefined;
      const next = await workspaceRefreshModifierPreviews(raw);
      if (!mountedRef.current || generation !== runGenerationRef.current) return;
      setWs(next);
      setComponentSelection((current) => alignHybridDccSelectionToWorkspace(
        requestedSelection ?? current,
        next,
      ));
      setLog(
        `${label} 완료 · 오브젝트 ${Object.keys(next.session.state.geometry.records).length}개 · 컷 ${next.bridge.shots.length}개 · UV ${next.lastUvMap?.mode ?? "없음"} · 오류 ${workspaceDiagnostics(next).errorCount}개`,
      );
    } catch (error) {
      if (!mountedRef.current || generation !== runGenerationRef.current) return;
      setLog(`${label} 실패 · ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      if (mountedRef.current && generation === runGenerationRef.current) setBusy(false);
    }
  };

  const runModifier = (
    label: string,
    fn: () => StudioHybridDccWorkspace | Promise<StudioHybridDccWorkspace>,
  ) => {
    setModifierError(null);
    void run(label, async () => {
      try {
        return await fn();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setModifierError(message);
        throw error;
      }
    });
  };

  const diag = workspaceDiagnostics(ws);
  const authorityRecords = Object.values(ws.session.state.geometry.records)
    .toSorted((left, right) =>
      left.assetId < right.assetId ? -1 : left.assetId > right.assetId ? 1 : 0);
  const activeRecord = ws.activeAssetId
    ? ws.session.state.geometry.records[ws.activeAssetId] ?? null
    : null;
  const activeRights = ws.activeAssetId
    ? ws.session.state.rightsBom.find(({ assetId }) => assetId === ws.activeAssetId) ?? null
    : null;
  const activeTransform = ws.activeAssetId
    ? ws.session.state.objectTransforms[ws.activeAssetId] ?? null
    : null;
  const modifierStackView: StudioHybridDccModifierStackView = {
    modifiers: activeRecord
      ? activeRecord.modifierStack.modifiers.map((modifier): StudioHybridDccModifierView => {
          switch (modifier.kind) {
            case "mirror":
              return {
                id: modifier.id,
                kind: modifier.kind,
                enabled: modifier.enabled,
                axis: modifier.axis,
                merge: modifier.merge,
                mergeThreshold: modifier.mergeThreshold,
                bisect: modifier.bisect,
                clip: modifier.clip,
              };
            case "array":
              return {
                id: modifier.id,
                kind: modifier.kind,
                enabled: modifier.enabled,
                count: modifier.count,
                offset: modifier.offset,
                mode: modifier.mode,
                radialAngleRad: modifier.radialAngleRad,
                realizeInstances: modifier.realizeInstances,
              };
            case "boolean":
              return {
                id: modifier.id,
                kind: modifier.kind,
                enabled: modifier.enabled,
                operation: modifier.operation,
                operandId: modifier.operandAssetId ?? null,
                operandOptions: authorityRecords
                  .filter(({ assetId }) => assetId !== activeRecord.assetId)
                  .map(({ assetId }, index) => ({
                    id: assetId,
                    label: `${friendlyHybridDccAssetName(assetId, index)} · ${assetId}`,
                  })),
              };
            case "solidify":
              return {
                id: modifier.id,
                kind: modifier.kind,
                enabled: modifier.enabled,
                thickness: modifier.thickness,
                evenThickness: modifier.evenThickness,
                rim: modifier.rim,
              };
            case "bevel":
              return {
                id: modifier.id,
                kind: modifier.kind,
                enabled: modifier.enabled,
                amount: modifier.amount,
                segments: modifier.segments,
                angleLimitRad: modifier.angleLimitRad,
                weightInfluence: modifier.weightInfluence,
              };
            case "subdivision":
              return {
                id: modifier.id,
                kind: modifier.kind,
                enabled: modifier.enabled,
                levels: modifier.levels,
                smooth: modifier.smooth,
              };
            case "weld":
              return {
                id: modifier.id,
                kind: modifier.kind,
                enabled: modifier.enabled,
                quantum: modifier.quantum,
              };
            case "decimate":
              return {
                id: modifier.id,
                kind: modifier.kind,
                enabled: modifier.enabled,
                ratio: modifier.ratio,
              };
            case "simple-deform":
              return {
                id: modifier.id,
                kind: modifier.kind,
                enabled: modifier.enabled,
                mode: modifier.mode,
                axis: modifier.axis,
                angleRad: modifier.angleRad,
                factor: modifier.factor,
              };
          }
        })
      : [],
  };

  const resolveSelectedFaces = (): readonly number[] => {
    const source = hybridDccSelectionSource(ws);
    if (!source) throw new Error("먼저 오브젝트를 선택하세요.");
    if (componentSelection.mode !== "object" && componentSelection.mode !== "face") {
      throw new Error("면 편집 도구입니다. 3번 키 또는 ‘면’을 누른 뒤 면을 선택하세요.");
    }
    if (componentSelection.mode === "face" && componentSelection.elementIds.length === 0) {
      throw new Error("선택한 면이 없습니다. 3D 화면에서 편집할 면을 먼저 선택하세요.");
    }
    return selectionResultValue(
      resolveStudioHybridDccSelectedOrDefaultFaceIds(componentSelection, source),
    ).ids;
  };
  const resolveSelectedEdge = (): number => {
    const source = hybridDccSelectionSource(ws);
    if (!source) throw new Error("먼저 오브젝트를 선택하세요.");
    if (componentSelection.mode !== "object" && componentSelection.mode !== "edge") {
      throw new Error("모서리 편집 도구입니다. 2번 키 또는 ‘선’을 누른 뒤 모서리를 선택하세요.");
    }
    if (componentSelection.mode === "edge" && componentSelection.elementIds.length === 0) {
      throw new Error("선택한 모서리가 없습니다. 3D 화면에서 편집할 모서리를 먼저 선택하세요.");
    }
    return selectionResultValue(
      resolveStudioHybridDccSelectedOrDefaultUndirectedEdgeIds(componentSelection, source),
    ).activeId;
  };
  const resolveSelectedEdges = (): readonly number[] => {
    const source = hybridDccSelectionSource(ws);
    if (!source) throw new Error("먼저 오브젝트를 선택하세요.");
    if (componentSelection.mode !== "object" && componentSelection.mode !== "edge") {
      throw new Error("모서리 편집 도구입니다. 2번 키 또는 ‘선’을 누른 뒤 모서리를 선택하세요.");
    }
    if (componentSelection.mode === "edge" && componentSelection.elementIds.length === 0) {
      throw new Error("선택한 모서리가 없습니다. 3D 화면에서 편집할 모서리를 먼저 선택하세요.");
    }
    return selectionResultValue(
      resolveStudioHybridDccSelectedOrDefaultUndirectedEdgeIds(componentSelection, source),
    ).ids;
  };

  const selectWorkspaceAsset = (assetId: string | null) => {
    try {
      const next = workspaceSelectAsset(ws, assetId);
      setWs(next);
      setComponentSelection((current) => alignHybridDccSelectionToWorkspace(current, next));
    } catch (error) {
      setLog(`오브젝트 선택 실패 · ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const changeComponentSelectionMode = (mode: StudioHybridDccSelectionMode) => {
    try {
      if (mode === "object") {
        const ids = ws.activeAssetId ? [ws.activeAssetId] : [];
        setComponentSelection((current) => selectionResultValue(
          mutateStudioHybridDccComponentSelection(current, {
            mode: "object",
            operation: "replace",
            ids,
            activeId: ws.activeAssetId,
          }),
        ));
        return;
      }
      const source = hybridDccSelectionSource(ws);
      if (!source) throw new Error("점·선·면 편집을 시작할 오브젝트를 먼저 선택하세요.");
      setComponentSelection((current) => selectionResultValue(
        mutateStudioHybridDccComponentSelection(current, {
          mode,
          operation: "replace",
          ids: [],
          source,
        }),
      ));
    } catch (error) {
      setLog(`편집 선택 모드 변경 실패 · ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const selectMeshComponent = (
    assetId: string,
    mode: StudioHybridDccComponentMode,
    elementId: number,
    operation: StudioHybridDccSelectionOperation,
  ) => {
    try {
      const nextWorkspace = workspaceSelectAsset(ws, assetId);
      const source = hybridDccSelectionSource(nextWorkspace, assetId);
      if (!source) throw new Error("선택한 메시 원본을 찾지 못했습니다.");
      setWs(nextWorkspace);
      setComponentSelection((current) => {
        const base = current.mode === mode && current.provenance?.assetId === assetId
          ? current
          : createStudioHybridDccComponentSelection();
        return selectionResultValue(mutateStudioHybridDccComponentSelection(base, {
          mode,
          operation,
          ids: [elementId],
          activeId: operation === "replace" || operation === "add" ? elementId : undefined,
          source,
        }));
      });
    } catch (error) {
      setLog(`메시 요소 선택 실패 · ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const clearMeshComponentSelection = () => {
    const source = hybridDccSelectionSource(ws);
    if (!source || componentSelection.mode === "object") return;
    try {
      setComponentSelection((current) => selectionResultValue(
        mutateStudioHybridDccComponentSelection(current, {
          mode: current.mode as StudioHybridDccComponentMode,
          operation: "replace",
          ids: [],
          source,
        }),
      ));
    } catch (error) {
      setLog(`선택 해제 실패 · ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const openInBackground3d = async () => {
    if (!onOpenInBackground3D || busy) return;
    const generation = ++runGenerationRef.current;
    const controller = new AbortController();
    handoffAbortRef.current?.abort();
    handoffAbortRef.current = controller;
    setBusy(true);
    try {
      const { handoffStudioHybridDccWorkspaceToBg3d } = await import( "./studio-hybrid-dcc-bg3d-handoff"
      );
      const result = await handoffStudioHybridDccWorkspaceToBg3d(ws, {
        signal: controller.signal,
      });
      if (
        controller.signal.aborted ||
        !mountedRef.current ||
        generation !== runGenerationRef.current
      ) return;
      setLog(
        `3D 배경 편집기로 전달 완료 · 모델 ${result.assets.length}개 · 컷 ${result.shots.length}개 · 보존 보고 ${result.losses.length}개`,
      );
      onOpenInBackground3D(result);
    } catch (error) {
      if (
        controller.signal.aborted ||
        !mountedRef.current ||
        generation !== runGenerationRef.current
      ) return;
      setLog(
        `3D 배경 편집기 전달 실패 · ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      if (handoffAbortRef.current === controller) handoffAbortRef.current = null;
      if (mountedRef.current && generation === runGenerationRef.current) setBusy(false);
    }
  };

  const quickTools: readonly StudioHybridDccQuickTool[] = workbenchMode === "model" ? [
    {
      label: "큐브 추가",
      technical: "Primitive",
      description: "소품 제작을 시작할 기본 상자를 원점에 만듭니다.",
      onClick: () => { void run("큐브 추가", () => workspaceAddUnitCube(ws)); },
    },
    {
      label: "선택 복제",
      technical: "Duplicate",
      description: "선택한 오브젝트의 편집 가능한 복사본을 옆에 만들고 바로 선택합니다.",
      requiresAsset: true,
      onClick: () => { void run("오브젝트 복제", () => workspaceDuplicateActive(ws)); },
    },
    {
      label: "선택 삭제",
      technical: "Delete · undoable",
      description: "선택 오브젝트를 장면에서 지웁니다. 되돌리기로 원본과 위치를 복구할 수 있습니다.",
      requiresAsset: true,
      onClick: () => { void run("오브젝트 삭제", () => workspaceDeleteActive(ws)); },
    },
    {
      label: "면 밀어내기",
      technical: "Extrude",
      description: "선택한 면을 바깥으로 뽑아 형태를 늘립니다. 오브젝트 모드에서는 첫 면으로 빠르게 시작합니다.",
      requiresAsset: true,
      onClick: () => {
        void run("면 밀어내기", () => {
          const faceIds = resolveSelectedFaces();
          return componentSelection.mode === "face"
            ? workspaceExtrudeRegionActive(ws, componentSelection, 0.25)
            : workspaceExtrudeActive(ws, 0.25, faceIds);
        });
      },
    },
    {
      label: "모서리 둥글리기",
      technical: "Bevel",
      description: "날카로운 모서리를 한 단계 깎아 빛이 자연스럽게 맺히게 합니다.",
      requiresAsset: true,
      onClick: () => {
        void run("모서리 둥글리기", () => workspaceBevelEdgesActive(ws, 0.12, resolveSelectedEdges()));
      },
    },
    {
      label: "면 안쪽 테두리",
      technical: "Inset",
      description: "선택 면 안에 작은 면과 둘레 테두리를 만들어 창·패널 작업을 준비합니다.",
      requiresAsset: true,
      onClick: () => {
        void run("면 안쪽 테두리", () => workspaceInsetActive(ws, 0.2, resolveSelectedFaces()));
      },
    },
    {
      label: "가운데 절단선",
      technical: "Loop cut",
      description: "이어진 면 흐름에 새 절단선을 넣어 변형할 구간을 나눕니다.",
      requiresAsset: true,
      onClick: () => {
        void run("가운데 절단선", () => workspaceLoopCutActive(ws, 0.5, resolveSelectedEdge()));
      },
    },
    {
      label: "좌우 대칭",
      technical: "Mirror · non-destructive",
      description: "원본을 바꾸지 않고 X축 반대편 결과를 미리 보며, 아래 변형 스택에서 축과 합치기 값을 조절합니다.",
      requiresAsset: true,
      onClick: () => runModifier("비파괴 좌우 대칭", () => workspaceAddActiveModifier(ws, "mirror")),
    },
    {
      label: "두께 만들기",
      technical: "Solidify · non-destructive",
      description: "얇은 표면의 두께를 미리 조절하고, 만족할 때만 원본 메시로 확정합니다.",
      requiresAsset: true,
      onClick: () => runModifier("비파괴 두께", () => workspaceAddActiveModifier(ws, "solidify")),
    },
    {
      label: "메시 자동 정리",
      technical: "Repair",
      description: "중복·깨진 방향 등 흔한 메시 문제를 진단하고 복구합니다.",
      requiresAsset: true,
      onClick: () => { void run("메시 자동 정리", () => workspaceRepairActive(ws)); },
    },
    {
      label: "겹친 점 합치기",
      technical: "Merge by distance",
      description: "거의 같은 위치의 점을 합쳐 미세한 틈과 중복을 정리합니다.",
      requiresAsset: true,
      onClick: () => { void run("겹친 점 합치기", () => workspaceWeldActive(ws)); },
    },
    {
      label: "모델 가져오기",
      technical: "Import",
      description: "GLB, OBJ, FBX, VRM, STEP 등 지원 파일을 작업 공간에 엽니다.",
      onClick: () => fileRef.current?.click(),
    },
  ] : workbenchMode === "build" ? [
    {
      label: "교실 세트 만들기",
      technical: "Room preset",
      description: "벽·바닥·천장·창문·가구가 각각 선택되고 움직이는 실제 편집 오브젝트로 교실을 만듭니다.",
      onClick: () => { void run("편집 가능한 교실 세트", () => workspaceLoadEditableRoomPreset(ws, "classroom")); },
    },
    {
      label: "IFC 건물 불러오기",
      technical: "IFC",
      description: "건축 IFC 데이터를 장면용 메시와 구조 정보로 변환합니다.",
      onClick: () => { void run("IFC 건물", () => workspaceImportIfcCity(ws)); },
    },
    {
      label: "절차형 배경 시작",
      technical: "Geometry Nodes",
      description: "수정 가능한 절차형 노드 예제로 반복 구조를 빠르게 만듭니다.",
      onClick: () => { void run("절차형 배경", () => workspaceAddGeoNodesStarter(ws)); },
    },
    {
      label: "8개 카메라 컷",
      technical: "Shot set",
      description: "한 배경을 여러 구도로 재사용할 기본 8컷 보드를 만듭니다.",
      onClick: () => { void run("8개 카메라 컷", () => workspaceEnsureShots(ws, 8)); },
    },
    {
      label: "부품 목록 만들기",
      technical: "BOM",
      description: "장면의 소품·부품과 권리 정보를 목록으로 다시 계산합니다.",
      onClick: () => { void run("부품 목록", () => workspaceRebuildBom(ws)); },
    },
  ] : workbenchMode === "cad" ? [
    {
      label: "정밀 박스",
      technical: "OCCT Box",
      description: "치수가 정확한 솔리드 박스를 만들고 화면용 메시를 함께 생성합니다.",
      onClick: () => { void run("정밀 박스", () => workspaceOcctBox(ws)); },
    },
    {
      label: "정밀 구",
      technical: "OCCT Sphere",
      description: "곡면이 정확한 솔리드 구를 생성합니다.",
      onClick: () => { void run("정밀 구", () => workspaceOcctSphere(ws)); },
    },
    {
      label: "구멍 빼기",
      technical: "Boolean Cut",
      description: "두 솔리드의 차집합을 계산해 구멍이나 홈을 만듭니다.",
      onClick: () => { void run("구멍 빼기", () => workspaceOcctBooleanCut(ws)); },
    },
    {
      label: "모서리 라운드",
      technical: "Fillet",
      description: "정밀 솔리드의 모서리에 반지름을 적용합니다.",
      onClick: () => { void run("모서리 라운드", () => workspaceOcctFillet(ws)); },
    },
    {
      label: "단면 회전",
      technical: "Revolve",
      description: "2D 단면을 축 둘레로 돌려 병·기둥 같은 솔리드를 만듭니다.",
      onClick: () => { void run("단면 회전", () => workspaceOcctRevolve(ws)); },
    },
    {
      label: "파이프 만들기",
      technical: "Pipe",
      description: "경로를 따라 단면을 이동해 관·손잡이 형상을 만듭니다.",
      onClick: () => { void run("파이프", () => workspaceOcctPipe(ws)); },
    },
    {
      label: "속 비우기",
      technical: "Thick shell",
      description: "솔리드 내부를 비워 일정한 벽 두께를 만듭니다.",
      onClick: () => { void run("속 비우기", () => workspaceOcctThickShell(ws)); },
    },
    {
      label: "STEP 왕복 점검",
      technical: "STEP",
      description: "표준 CAD 형식으로 내보냈다가 다시 읽어 형상 손실을 점검합니다.",
      onClick: () => { void run("STEP 왕복", () => workspaceOcctStepRoundTrip(ws)); },
    },
  ] : workbenchMode === "sculpt" ? [
    {
      label: `브러시 조형 · ${SCULPT_BRUSH_LABELS[sculptBrushKind]}${sculptDig ? " (깎기)" : ""}`,
      technical: `${sculptBrushKind} · experimental`,
      description: "선택한 브러시 종류로 오브젝트 중심을 조형합니다. 깎기 토글로 방향을 반전합니다.",
      requiresAsset: true,
      primary: true,
      onClick: () => {
        void run("브러시 조형", () => workspaceSculptActive(ws, {
          kind: sculptBrushKind,
          strength: sculptDig ? -0.25 : 0.25,
        }));
      },
    },
    {
      label: "필요한 곳만 세분화",
      technical: "Dyntopo",
      description: "브러시 주변에만 면을 추가해 세부 조형 여유를 만듭니다.",
      requiresAsset: true,
      onClick: () => { void run("동적 세분화", () => workspaceDynatopoActive(ws, "refine")); },
    },
    {
      label: "복셀 리메시",
      technical: "Voxel remesh",
      description: "뒤엉킨 표면을 균일한 밀도의 닫힌 메시로 다시 만듭니다.",
      requiresAsset: true,
      onClick: () => { void run("복셀 리메시", () => workspaceVoxelRemeshActive(ws)); },
    },
    {
      label: "편집용 면 정리",
      technical: "Retopology",
      description: "조형 결과를 더 적은 면과 읽기 좋은 흐름으로 다시 구성합니다.",
      requiresAsset: true,
      onClick: () => { void run("리토폴로지", () => workspaceRetopoActive(ws, 8)); },
    },
    {
      label: "부드럽게 세분화",
      technical: "Subdivision",
      description: "전체 표면을 한 단계 부드럽게 나눕니다.",
      requiresAsset: true,
      onClick: () => { void run("부드럽게 세분화", () => workspaceSubdivideActive(ws, 1)); },
    },
    {
      label: "휘기",
      technical: "Bend",
      description: "선택 메시를 곡선 방향으로 휘어 자연스러운 실루엣을 만듭니다.",
      requiresAsset: true,
      onClick: () => { void run("휘기", () => workspaceBendActive(ws)); },
    },
  ] : workbenchMode === "material" ? [
    {
      label: "UV 자동 펼치기",
      technical: "UV unwrap",
      description: "표면을 2D 텍스처 좌표로 펼쳐 겹침 없는 기본 UV를 만듭니다.",
      requiresAsset: true,
      onClick: () => { void run("UV 자동 펼치기", () => workspaceUvUnwrapActive(ws)); },
    },
    {
      label: "겉면 방향 맞추기",
      technical: "Recalculate normals",
      description: "뒤집힌 면 방향을 바깥쪽으로 통일해 음영 오류를 줄입니다.",
      requiresAsset: true,
      onClick: () => { void run("겉면 방향", () => workspaceOrientOutwardActive(ws)); },
    },
    {
      label: "부드러운 음영",
      technical: "Shade smooth",
      description: "면 사이 노멀을 부드럽게 이어 곡면이 매끈하게 보이게 합니다.",
      requiresAsset: true,
      onClick: () => { void run("부드러운 음영", () => workspaceShadeActive(ws, true)); },
    },
    {
      label: "단단한 면 음영",
      technical: "Shade flat",
      description: "각 면의 방향을 분리해 박스·기계 부품의 모서리를 선명하게 보입니다.",
      requiresAsset: true,
      onClick: () => { void run("단단한 면 음영", () => workspaceShadeActive(ws, false)); },
    },
    {
      label: "가볍게 만들기",
      technical: "Decimate",
      description: "실루엣을 최대한 유지하면서 면 수를 절반 수준으로 줄입니다.",
      requiresAsset: true,
      onClick: () => { void run("메시 경량화", () => workspaceDecimateActive(ws, 0.5)); },
    },
    {
      label: "OBJ 내보내기 점검",
      technical: "OBJ export",
      description: "현재 메시를 범용 OBJ로 변환하고 손실 보고서를 확인합니다.",
      requiresAsset: true,
      onClick: () => { void run("OBJ 내보내기", () => workspaceExportActiveMesh(ws, "obj")); },
    },
  ] : [
    {
      label: "8개 카메라 컷",
      technical: "Shot set",
      description: "한 장면을 여러 구도로 재사용할 컷 보드를 만듭니다.",
      onClick: () => { void run("8개 카메라 컷", () => workspaceEnsureShots(ws, 8)); },
    },
    {
      label: "작가 선 보존 테스트",
      technical: "Artist delta",
      description: "3D가 바뀌어도 작가가 손으로 고친 선화 정보가 남도록 연결합니다.",
      requiresAsset: true,
      onClick: () => { void run("작가 선 보존", () => workspaceAddArtistInk(ws, "shot-1")); },
    },
    {
      label: "3D 배경·컷 편집기로 열기",
      technical: "Verified GLB handoff",
      description: "현재 편집 원본을 별도 작업 프로세스에서 검증된 GLB로 만든 뒤 실제 배경 편집기에 엽니다.",
      requiresAsset: true,
      primary: true,
      disabled: !onOpenInBackground3D,
      onClick: () => { void openInBackground3d(); },
    },
    {
      label: ".toon3d 작업 파일",
      technical: "Authoring package",
      description: "메시·컷·권리 정보를 다시 편집 가능한 ToonSpectrum 패키지로 묶습니다.",
      onClick: () => {
        const pkg = workspaceExportToon3d(ws);
        setLog(`.toon3d 준비 완료 · ${Object.keys(pkg.files).length}개 파일 · ${pkg.manifest.packageHash.slice(0, 18)}…`);
      },
    },
  ];

  const commitTransformComponent = (
    channel: "position" | "rotationEulerRad" | "scale",
    axis: 0 | 1 | 2,
    displayValue: string,
  ) => {
    if (!ws.activeAssetId || !activeTransform) return;
    const parsed = Number(displayValue);
    if (!Number.isFinite(parsed)) {
      setLog("숫자 변환 실패: 유효한 숫자를 입력해 주세요.");
      return;
    }
    const value = channel === "rotationEulerRad" ? parsed * Math.PI / 180 : parsed;
    if (Math.abs(value - activeTransform[channel][axis]) <= 1e-12) return;
    const nextChannel = [...activeTransform[channel]] as [number, number, number];
    nextChannel[axis] = value;
    const next = { ...activeTransform, [channel]: nextChannel };
    const assetId = ws.activeAssetId;
    void run("숫자 변환", () => workspaceCommitObjectTransform(ws, assetId, next));
  };

  return (
    <section
      className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto bg-canvas/35 p-3 text-sm [&>*]:shrink-0 sm:p-4"
      data-studio-hybrid-dcc-panel="true"
      data-workbench-mode={workbenchMode}
      aria-label="전문 3D 제작 작업 공간"
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold tracking-tight text-fg">전문 3D 제작 스튜디오</h3>
          <p className="mt-0.5 text-xs text-fg-3">
            편집 가능한 3D 원본 → 안전한 미리보기·내보내기 → 웹툰 컷과 선화
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-1.5 text-[11px]">
          {persistenceStatus ? (
            <span
              className={persistenceStatus === "saved"
                ? "rounded-full border border-good/35 bg-good/10 px-2 py-1 text-good"
                : persistenceStatus === "error"
                  ? "rounded-full border border-warn/45 bg-warn/10 px-2 py-1 text-warn"
                  : "rounded-full border border-line bg-panel px-2 py-1 text-fg-2"}
              role="status"
              data-studio-hybrid-dcc-persistence={persistenceStatus}
              data-studio-hybrid-dcc-persistence-sequence={persistenceReceipt?.sequence}
              data-studio-hybrid-dcc-persistence-source-hash={persistenceReceipt?.sourceHash}
              data-studio-hybrid-dcc-persistence-document-state-hash={
                persistenceReceipt?.documentStateHash ?? undefined
              }
            >
              {STUDIO_HYBRID_DCC_PERSISTENCE_LABEL[persistenceStatus]}
            </span>
          ) : null}
          <button
            type="button"
            className="min-h-11 rounded-lg border border-line bg-card px-3 font-semibold text-fg-2 hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40"
            disabled={busy || ws.session.undoStack.length === 0}
            aria-label="마지막 3D 편집 되돌리기"
            onClick={() => {
              void run("되돌리기", () => {
                const workspace = workspaceUndo(ws);
                return {
                  workspace,
                  selection: workspaceReconcileSelectionAfterHistory(
                    workspace,
                    componentSelection,
                  ),
                };
              });
            }}
          >
            ↶ 되돌리기
          </button>
          <button
            type="button"
            className="min-h-11 rounded-lg border border-line bg-card px-3 font-semibold text-fg-2 hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40"
            disabled={busy || ws.session.redoStack.length === 0}
            aria-label="되돌린 3D 편집 다시 실행"
            onClick={() => {
              void run("다시 실행", () => {
                const workspace = workspaceRedo(ws);
                return {
                  workspace,
                  selection: workspaceReconcileSelectionAfterHistory(
                    workspace,
                    componentSelection,
                  ),
                };
              });
            }}
          >
            ↷ 다시 실행
          </button>
          <span className="rounded-full border border-good/35 bg-good/10 px-2 py-1 text-good">
            편집 원본 보호
          </span>
          <span className="rounded-full border border-line bg-panel px-2 py-1 text-fg-2">
            오브젝트 {authorityRecords.length}개
          </span>
          <span className="rounded-full border border-line bg-panel px-2 py-1 text-fg-2">
            컷 {ws.bridge.shots.length}개
          </span>
        </div>
      </header>
      <nav
        className="flex max-w-full gap-1 overflow-x-auto rounded-xl border border-line bg-panel p-1"
        aria-label="DCC 작업 모드"
      >
        {STUDIO_HYBRID_DCC_WORKBENCH_MODES.map((mode) => (
          <button
            key={mode.id}
            type="button"
            aria-label={mode.accessibleLabel}
            aria-pressed={workbenchMode === mode.id}
            className={
              workbenchMode === mode.id
                ? "min-h-11 shrink-0 rounded-lg bg-accent px-3 text-xs font-semibold text-on-accent shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                : "min-h-11 shrink-0 rounded-lg px-3 text-xs font-medium text-fg-2 hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            }
            onClick={() => changeWorkbenchMode(mode.id)}
          >
            {mode.label}
          </button>
        ))}
      </nav>
      <input
        ref={fileRef}
        type="file"
        accept=".stl,.ply,.dae,.dxf,.off,.3mf,.bvh,.ifc,.obj,.glb,.gltf,.vrm,.fbx,.3dm,.step,.stp"
        className="sr-only"
        data-studio-hybrid-dcc-import="true"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          void run(`모델 가져오기 · ${file.name}`, async () => {
            const buf = new Uint8Array(await file.arrayBuffer());
            return workspaceImportBytes(ws, file.name, buf);
          });
        }}
      />
      <section
        className="rounded-2xl border border-line bg-panel p-3 sm:p-4"
        aria-labelledby="studio-dcc-quick-tools-title"
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h4 id="studio-dcc-quick-tools-title" className="text-sm font-semibold text-fg">
              {STUDIO_HYBRID_DCC_MODE_GUIDE[workbenchMode].title}
            </h4>
            <p className="mt-1 max-w-3xl text-xs leading-relaxed text-fg-3">
              {STUDIO_HYBRID_DCC_MODE_GUIDE[workbenchMode].description}
            </p>
          </div>
          <span className="rounded-full border border-line bg-raised px-2 py-1 text-[10px] text-fg-2">
            {quickTools.length}개 추천 도구
          </span>
        </div>
        {workbenchMode === "sculpt" ? (
          <div
            role="radiogroup"
            aria-label="조형 브러시 종류"
            className="mt-3 flex flex-wrap gap-1.5 rounded-xl border border-line/70 bg-canvas/35 p-2"
          >
            {(Object.keys(SCULPT_BRUSH_LABELS) as readonly StudioSculptBrushKind[]).map((kind) => (
              <button
                key={kind}
                type="button"
                role="radio"
                aria-checked={sculptBrushKind === kind}
                onClick={() => setSculptBrushKind(kind)}
                className={`min-h-9 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                  sculptBrushKind === kind
                    ? "border-accent bg-accent-soft text-accent"
                    : "border-line bg-card text-fg-2 hover:bg-raised hover:text-fg"
                }`}
              >
                {SCULPT_BRUSH_LABELS[kind]}
              </button>
            ))}
            <button
              type="button"
              aria-pressed={sculptDig}
              onClick={() => setSculptDig((current) => !current)}
              className={`min-h-9 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                sculptDig
                  ? "border-warn bg-warn/10 text-warn"
                  : "border-line bg-card text-fg-2 hover:bg-raised hover:text-fg"
              }`}
            >
              {sculptDig ? "깎기 모드 ON" : "깎기 모드 OFF"}
            </button>
          </div>
        ) : null}
        <div
          className="mt-3 grid gap-2 max-sm:-mx-1 max-sm:flex max-sm:snap-x max-sm:overflow-x-auto max-sm:px-1 max-sm:pb-1 sm:grid-cols-2 xl:grid-cols-4"
          aria-label="추천 3D 도구"
        >
          {quickTools.map((tool) => {
            const disabled = busy || tool.disabled || (tool.requiresAsset && !ws.activeAssetId);
            return (
              <button
                key={`${workbenchMode}:${tool.technical}`}
                type="button"
                disabled={disabled}
                onClick={tool.onClick}
                className={tool.primary
                  ? "group min-h-28 rounded-xl border border-accent/55 bg-accent-soft p-3 text-left shadow-sm transition-colors hover:bg-accent/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45 motion-reduce:transition-none max-sm:min-w-[82%] max-sm:snap-start"
                  : "group min-h-28 rounded-xl border border-line bg-card p-3 text-left transition-colors hover:border-accent/40 hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45 motion-reduce:transition-none max-sm:min-w-[82%] max-sm:snap-start"}
              >
                <span className="flex items-start justify-between gap-2">
                  <span className={tool.primary ? "font-semibold text-accent" : "font-semibold text-fg"}>
                    {tool.label}
                  </span>
                  <span className="shrink-0 rounded bg-raised px-1.5 py-0.5 font-mono text-[9px] text-fg-3">
                    {tool.technical}
                  </span>
                </span>
                <span className="mt-2 block text-[11px] leading-relaxed text-fg-3">
                  {tool.description}
                </span>
                {tool.requiresAsset && !ws.activeAssetId ? (
                  <span className="mt-2 block text-[10px] font-medium text-warn">
                    먼저 오브젝트를 선택하세요
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </section>
      <div className="grid min-w-0 gap-3 xl:grid-cols-[minmax(180px,220px)_minmax(0,1fr)_minmax(220px,280px)]">
        <aside className="order-2 min-w-0 rounded-2xl border border-line bg-panel p-2 xl:order-1" aria-label="DCC 아웃라이너">
          <div className="flex items-center justify-between gap-2 px-2 py-1.5">
            <h4 className="text-xs font-semibold uppercase tracking-[0.12em] text-fg-2">장면 오브젝트</h4>
            <span className="text-[10px] tabular-nums text-fg-3">{authorityRecords.length}</span>
          </div>
          <div className="max-h-none space-y-1 overflow-visible xl:max-h-[31rem] xl:overflow-y-auto">
            {authorityRecords.length > 0 ? authorityRecords.map((record, recordIndex) => {
              const selected = record.assetId === ws.activeAssetId;
              const sharedObject = ws.bridge.set.objects.find(({ id }) => id === record.assetId);
              const visible = sharedObject?.visible !== false;
              return (
                <div
                  key={record.assetId}
                  className={selected
                    ? "flex min-h-11 w-full items-stretch rounded-lg border border-accent/45 bg-accent-soft text-accent"
                    : "flex min-h-11 w-full items-stretch rounded-lg border border-transparent text-fg-2 hover:border-line hover:bg-raised hover:text-fg"}
                >
                  <button
                    type="button"
                    aria-pressed={selected}
                    disabled={busy}
                    className="min-h-11 min-w-0 flex-1 px-2.5 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45"
                    onClick={() => selectWorkspaceAsset(record.assetId)}
                  >
                    <span className="block truncate text-xs font-medium">
                      {friendlyHybridDccAssetName(record.assetId, recordIndex)}
                    </span>
                    <span className="block truncate text-[10px] opacity-70">
                      {record.assetId} · 버전 {record.revision}
                    </span>
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    aria-label={`${record.assetId} ${visible ? "숨기기" : "보이기"}`}
                    title={visible ? "뷰포트에서 잠시 숨기기" : "뷰포트에 다시 보이기"}
                    className="min-h-11 min-w-14 shrink-0 border-l border-current/15 px-2 text-[10px] font-semibold opacity-75 hover:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-35"
                    onClick={() => {
                      try {
                        setWs(workspaceSetAssetVisibility(ws, record.assetId, !visible));
                        setLog(`${record.assetId} ${visible ? "숨김" : "표시"} · 원본은 그대로 보존됩니다.`);
                      } catch (error) {
                        setLog(`표시 상태 변경 실패 · ${error instanceof Error ? error.message : String(error)}`);
                      }
                    }}
                  >
                    {visible ? "표시 중" : "숨김"}
                  </button>
                </div>
              );
            }) : (
              <p className="rounded-lg border border-dashed border-line px-3 py-6 text-center text-xs leading-relaxed text-fg-3">
                큐브 또는 정밀 솔리드를 만들면 편집 가능한 오브젝트가 여기에 표시됩니다.
              </p>
            )}
          </div>
        </aside>

        <div className="order-1 min-w-0 xl:order-2">
          <StudioHybridDccViewport
            workspace={ws}
            componentSelection={componentSelection}
            editingDisabled={busy}
            onCommitAssetTransform={(assetId, transform) => {
              void run("오브젝트 변형", () => workspaceCommitObjectTransform(ws, assetId, transform));
            }}
            onComponentSelectionError={(message) => {
              setLog(`메시 요소 선택 실패 · ${message}`);
            }}
            onComponentSelectionModeChange={changeComponentSelectionMode}
            onClearComponentSelection={clearMeshComponentSelection}
            onDuplicateSelected={() => {
              if (!busy) void run("오브젝트 복제", () => workspaceDuplicateActive(ws));
            }}
            onDeleteSelected={() => {
              if (!busy) void run("오브젝트 삭제", () => workspaceDeleteActive(ws));
            }}
            onSelectAsset={selectWorkspaceAsset}
            onSelectComponent={selectMeshComponent}
            onSculptStroke={workbenchMode === "sculpt" && !busy
              ? (assetId, localPoint) => {
                  void run("브러시 조형", () => workspaceSculptActive(ws, {
                    kind: sculptBrushKind,
                    center: localPoint,
                    radius: 0.45,
                    strength: sculptDig ? -0.2 : 0.2,
                    ...(sculptBrushKind === "grab" || sculptBrushKind === "snakeHook"
                      ? { direction: { x: 0, y: 0.15, z: 0 } }
                      : {}),
                  }));
                }
              : undefined}
          />
        </div>

        <aside className="order-3 min-w-0 rounded-2xl border border-line bg-panel p-3" aria-label="DCC 인스펙터">
          <div className="flex items-center justify-between gap-2 border-b border-line pb-2">
            <h4 className="text-xs font-semibold uppercase tracking-[0.12em] text-fg-2">선택 정보</h4>
            <span className="rounded-md bg-raised px-1.5 py-0.5 text-[10px] text-fg-3">
              {STUDIO_HYBRID_DCC_WORKBENCH_MODES.find(({ id }) => id === workbenchMode)?.label}
            </span>
          </div>
          {activeRecord ? (
            <div className="space-y-3 pt-3">
              <div>
                <p className="truncate text-sm font-semibold text-fg">{activeRecord.assetId}</p>
                <p className="mt-0.5 font-mono text-[10px] text-fg-3">
                  {activeRecord.meshHash.slice(0, 18)}…
                </p>
              </div>
              <div
                className="rounded-lg border border-accent/25 bg-accent-soft px-2.5 py-2 text-[11px] leading-relaxed text-fg-2"
                data-studio-hybrid-dcc-component-selection-summary="true"
              >
                <p className="font-semibold text-accent">
                  {componentSelection.mode === "object"
                    ? "오브젝트 편집"
                    : componentSelection.mode === "vertex"
                      ? `꼭짓점 ${componentSelection.elementIds.length}개 선택`
                      : componentSelection.mode === "edge"
                        ? `모서리 ${componentSelection.elementIds.length}개 선택`
                        : `면 ${componentSelection.elementIds.length}개 선택`}
                </p>
                <p className="mt-0.5 text-[10px] text-fg-3">
                  {componentSelection.mode === "object"
                    ? "위치·회전·크기를 바꾸거나 1·2·3 키로 메시 요소 편집을 시작하세요."
                    : "3D 화면에서 클릭해 선택합니다. Shift 추가 · Ctrl 전환 · Alt 빼기"}
                </p>
              </div>
              <dl className="grid grid-cols-2 gap-1.5 text-xs">
                <div className="rounded-lg bg-raised p-2">
                  <dt className="text-[10px] text-fg-3">꼭짓점</dt>
                  <dd className="mt-0.5 font-semibold tabular-nums text-fg">{activeRecord.mesh.vertices.length}</dd>
                </div>
                <div className="rounded-lg bg-raised p-2">
                  <dt className="text-[10px] text-fg-3">면</dt>
                  <dd className="mt-0.5 font-semibold tabular-nums text-fg">{activeRecord.mesh.faces.length}</dd>
                </div>
                <div className="rounded-lg bg-raised p-2">
                  <dt className="text-[10px] text-fg-3">방향 모서리</dt>
                  <dd className="mt-0.5 font-semibold tabular-nums text-fg">{activeRecord.mesh.halfEdges.length}</dd>
                </div>
                <div className="rounded-lg bg-raised p-2">
                  <dt className="text-[10px] text-fg-3">편집 버전</dt>
                  <dd className="mt-0.5 font-semibold tabular-nums text-fg">{activeRecord.revision}</dd>
                </div>
              </dl>
              {activeTransform && componentSelection.mode === "object" ? (
                <fieldset
                  key={`${activeRecord.assetId}:${ws.session.state.stateHash}`}
                  className="rounded-xl border border-line p-2.5"
                  disabled={busy}
                >
                  <legend className="px-1 text-[10px] font-semibold uppercase tracking-wide text-fg-3">
                    위치 · 회전 · 크기
                  </legend>
                  <p className="mb-2 text-[10px] leading-relaxed text-fg-3">
                    기즈모로 움직이거나 숫자를 입력하세요. Enter 또는 포커스 이동 시 한 번의 되돌리기 명령으로 저장됩니다.
                  </p>
                  {([
                    { key: "position", label: "위치", unit: "m", step: 0.1 },
                    { key: "rotationEulerRad", label: "회전", unit: "°", step: 1 },
                    { key: "scale", label: "크기", unit: "×", step: 0.1 },
                  ] as const).map((row) => (
                    <div key={row.key} className="mb-2 last:mb-0">
                      <div className="mb-1 flex items-center justify-between text-[10px] text-fg-3">
                        <span>{row.label}</span><span>{row.unit}</span>
                      </div>
                      <div className="grid grid-cols-3 gap-1">
                        {(["X", "Y", "Z"] as const).map((axisLabel, axis) => {
                          const stored = activeTransform[row.key][axis]!;
                          const shown = row.key === "rotationEulerRad"
                            ? stored * 180 / Math.PI
                            : stored;
                          return (
                            <label key={axisLabel} className="relative">
                              <span className={axisLabel === "X"
                                ? "absolute left-2 top-1/2 -translate-y-1/2 text-[9px] font-bold text-bad"
                                : axisLabel === "Y"
                                  ? "absolute left-2 top-1/2 -translate-y-1/2 text-[9px] font-bold text-good"
                                  : "absolute left-2 top-1/2 -translate-y-1/2 text-[9px] font-bold text-accent"}>
                                {axisLabel}
                              </span>
                              <input
                                aria-label={`${row.label} ${axisLabel}`}
                                type="number"
                                step={row.step}
                                defaultValue={Number(shown.toFixed(4))}
                                className="min-h-11 w-full rounded-md border border-line bg-canvas pl-6 pr-1 text-right font-mono text-[10px] tabular-nums text-fg focus:border-accent focus:outline-none"
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") event.currentTarget.blur();
                                }}
                                onBlur={(event) => commitTransformComponent(
                                  row.key,
                                  axis as 0 | 1 | 2,
                                  event.currentTarget.value,
                                )}
                              />
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </fieldset>
              ) : null}
              <div className="rounded-lg border border-line p-2 text-[11px] leading-relaxed text-fg-2">
                <p>권리: {activeRights ? `${activeRights.license} · ${activeRights.creator}` : "미확인"}</p>
                <p>UV: {ws.lastUvMap?.mode ?? "미생성"}</p>
                <p>화면용 메시: {activeRecord.renderCache ? "비파괴 결과 표시 중" : "원본 직접 표시"}</p>
              </div>
            </div>
          ) : (
            <div className="grid min-h-52 place-items-center text-center">
              <p className="max-w-48 text-xs leading-relaxed text-fg-3">
                3D 화면이나 장면 목록에서 오브젝트를 선택하면 원본 메시와 변형 상태를 보여 줍니다.
              </p>
            </div>
          )}
        </aside>
      </div>

      {activeRecord ? (
        <StudioHybridDccModifierInspector
          stack={modifierStackView}
          busy={busy}
          error={modifierError}
          onAdd={(kind) => runModifier(
            `${kind} 변형 추가`,
            () => workspaceAddActiveModifier(ws, kind),
          )}
          onToggle={(modifierId) => runModifier(
            "변형 켜기·끄기",
            () => workspaceToggleActiveModifier(ws, modifierId),
          )}
          onMove={(modifierId, direction) => runModifier(
            "변형 순서 변경",
            () => workspaceMoveActiveModifier(ws, modifierId, direction),
          )}
          onRemove={(modifierId) => runModifier(
            "변형 삭제",
            () => workspaceRemoveActiveModifier(ws, modifierId),
          )}
          onPatch={(modifierId, patch) => runModifier(
            "변형 값 변경",
            () => workspacePatchActiveModifier(ws, modifierId, patch),
          )}
          onApply={() => runModifier(
            "변형을 원본 메시로 확정",
            () => workspaceApplyActiveModifierStack(ws),
          )}
        />
      ) : null}

      <details className="rounded-2xl border border-line bg-panel">
        <summary className="flex min-h-11 cursor-pointer select-none items-center px-3 py-2.5 text-xs font-semibold text-fg-2 marker:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
          전문가용 전체 엔진 도구 · 이름과 동작을 알고 있을 때 펼치기
        </summary>
        <div className="flex flex-wrap gap-2 border-t border-line p-3 [&>button]:min-h-11 [&>button]:border-line [&>button]:bg-card [&>button]:text-fg-2 [&>button]:hover:bg-raised [&>button]:hover:text-fg [&>button]:focus-visible:outline [&>button]:focus-visible:outline-2 [&>button]:focus-visible:outline-offset-2 [&>button]:focus-visible:outline-accent">
        <button
          type="button"
          className="rounded border px-2 py-1"
          disabled={busy}
          onClick={() => run("Add cube", () => workspaceAddUnitCube(ws))}
        >
          Add cube
        </button>
        <button
          type="button"
          className="rounded border px-2 py-1"
          disabled={busy}
          onClick={() => run("Geo sphere", () => workspaceAddGeoNodesPrimitive(ws, "sphere"))}
        >
          Geo sphere
        </button>
        <button
          type="button"
          className="rounded border px-2 py-1"
          disabled={busy}
          onClick={() => run("Geo starter", () => workspaceAddGeoNodesStarter(ws))}
        >
          Geo starter
        </button>
        <button
          type="button"
          className="rounded border px-2 py-1"
          disabled={busy || !ws.activeAssetId}
          onClick={() => runModifier("Solidify 변형 추가", () => workspaceAddActiveModifier(ws, "solidify"))}
        >
          Solidify
        </button>
        <button
          type="button"
          className="rounded border px-2 py-1"
          disabled={busy}
          onClick={() => run("CAD revolve", () => workspaceCadRevolve(ws))}
        >
          CAD revolve
        </button>
        <button
          type="button"
          className="rounded border px-2 py-1"
          disabled={busy}
          data-studio-hybrid-dcc-action="opennurbs-sphere"
          onClick={() => run("openNURBS sphere", () => workspaceOpenNurbsSphere(ws))}
        >
          openNURBS sphere
        </button>
        <button
          type="button"
          className="rounded border px-2 py-1"
          disabled={busy}
          data-studio-hybrid-dcc-action="ifc-city"
          onClick={() => run("IFC city", () => workspaceImportIfcCity(ws))}
        >
          IFC city
        </button>
        <button
          type="button"
          className="rounded border px-2 py-1"
          disabled={busy}
          data-studio-hybrid-dcc-action="occt-box"
          onClick={() => run("OCCT box", () => workspaceOcctBox(ws))}
        >
          OCCT box
        </button>
        <button
          type="button"
          className="rounded border px-2 py-1"
          disabled={busy}
          data-studio-hybrid-dcc-action="occt-cut"
          onClick={() => run("OCCT cut", () => workspaceOcctBooleanCut(ws))}
        >
          OCCT boolean
        </button>
        <button
          type="button"
          className="rounded border px-2 py-1"
          disabled={busy}
          data-studio-hybrid-dcc-action="occt-revolve"
          onClick={() => run("OCCT revolve", () => workspaceOcctRevolve(ws))}
        >
          OCCT revolve
        </button>
        <button
          type="button"
          className="rounded border px-2 py-1"
          disabled={busy}
          data-studio-hybrid-dcc-action="occt-sphere"
          onClick={() => run("OCCT sphere", () => workspaceOcctSphere(ws))}
        >
          OCCT sphere
        </button>
        <button
          type="button"
          className="rounded border px-2 py-1"
          disabled={busy}
          data-studio-hybrid-dcc-action="occt-torus"
          onClick={() => run("OCCT torus", () => workspaceOcctTorus(ws))}
        >
          OCCT torus
        </button>
        <button
          type="button"
          className="rounded border px-2 py-1"
          disabled={busy}
          data-studio-hybrid-dcc-action="occt-pipe"
          onClick={() => run("OCCT pipe", () => workspaceOcctPipe(ws))}
        >
          OCCT pipe
        </button>
        <button
          type="button"
          className="rounded border px-2 py-1"
          disabled={busy}
          data-studio-hybrid-dcc-action="occt-mirror"
          onClick={() => run("OCCT mirror", () => workspaceOcctMirror(ws))}
        >
          OCCT mirror
        </button>
        <button
          type="button"
          className="rounded border px-2 py-1"
          disabled={busy}
          data-studio-hybrid-dcc-action="occt-thick"
          onClick={() => run("OCCT thick shell", () => workspaceOcctThickShell(ws))}
        >
          OCCT thick
        </button>
        <button
          type="button"
          className="rounded border px-2 py-1"
          disabled={busy}
          data-studio-hybrid-dcc-action="occt-wedge"
          onClick={() => run("OCCT wedge", () => workspaceOcctWedge(ws))}
        >
          OCCT wedge
        </button>
        <button
          type="button"
          className="rounded border px-2 py-1"
          disabled={busy}
          data-studio-hybrid-dcc-action="occt-offset"
          onClick={() => run("OCCT offset", () => workspaceOcctOffsetShape(ws))}
        >
          OCCT offset
        </button>
        <button
          type="button"
          className="rounded border px-2 py-1"
          disabled={busy}
          data-studio-hybrid-dcc-action="occt-fillet2d"
          onClick={() => run("OCCT fillet2d extrude", () => workspaceOcctFillet2dExtrude(ws))}
        >
          OCCT fillet2d
        </button>
        <button
          type="button"
          className="rounded border px-2 py-1"
          disabled={busy}
          data-studio-hybrid-dcc-action="occt-pipeshell"
          onClick={() => run("OCCT pipe shell", () => workspaceOcctPipeShell(ws))}
        >
          OCCT pipe shell
        </button>
        <button
          type="button"
          className="rounded border px-2 py-1"
          disabled={busy}
          data-studio-hybrid-dcc-action="occt-section"
          onClick={() => run("OCCT section", () => workspaceOcctSection(ws))}
        >
          OCCT section
        </button>
        <button
          type="button"
          className="rounded border px-2 py-1"
          disabled={busy}
          data-studio-hybrid-dcc-action="occt-dprism"
          onClick={() => run("OCCT draft prism", () => workspaceOcctDraftPrism(ws))}
        >
          OCCT draft prism
        </button>
        <button
          type="button"
          className="rounded border px-2 py-1"
          disabled={busy}
          data-studio-hybrid-dcc-action="occt-pattern"
          onClick={() => run("OCCT linear pattern", () => workspaceOcctLinearPattern(ws))}
        >
          OCCT pattern
        </button>
        <button
          type="button"
          className="rounded border px-2 py-1"
          disabled={busy}
          data-studio-hybrid-dcc-action="occt-circular"
          onClick={() => run("OCCT circular pattern", () => workspaceOcctCircularPattern(ws))}
        >
          OCCT circular
        </button>
        <button
          type="button"
          className="rounded border px-2 py-1"
          disabled={busy}
          data-studio-hybrid-dcc-action="occt-step"
          onClick={() => run("OCCT STEP round-trip", () => workspaceOcctStepRoundTrip(ws))}
        >
          OCCT STEP
        </button>
        <button
          type="button"
          className="rounded border px-2 py-1"
          disabled={busy}
          data-studio-hybrid-dcc-action="boolean-two-assets"
          onClick={() =>
            run("Boolean two assets", async () => {
              let next = workspaceAddUnitCube(ws);
              next = await workspaceOcctBox(next, "occt-cutter", [0.6, 0.6, 0.6]);
              const ids = Object.keys(next.session.state.geometry.records);
              const left = ids.find((id) => id !== "occt-cutter") ?? ids[0]!;
              return workspaceBooleanBetweenAssets(next, left, "occt-cutter", "difference");
            })
          }
        >
          Boolean 2 assets
        </button>
        <button
          type="button"
          className="rounded border px-2 py-1"
          disabled={busy}
          data-studio-hybrid-dcc-action="occt-fillet"
          onClick={() => run("OCCT fillet", () => workspaceOcctFillet(ws))}
        >
          OCCT fillet
        </button>
        <button
          type="button"
          className="rounded border px-2 py-1"
          disabled={busy}
          data-studio-hybrid-dcc-action="occt-loft"
          onClick={() => run("OCCT loft", () => workspaceOcctLoft(ws))}
        >
          OCCT loft
        </button>
        <button
          type="button"
          className="rounded border px-2 py-1"
          disabled={busy || !ws.activeAssetId}
          data-studio-hybrid-dcc-action="manifold-boolean"
          onClick={() => run("Manifold boolean", () => workspaceManifoldBooleanActive(ws))}
        >
          Manifold boolean
        </button>
        <button
          type="button"
          className="rounded border px-2 py-1"
          disabled={busy || !ws.activeAssetId}
          data-studio-hybrid-dcc-action="dynatopo"
          onClick={() => run("Dynatopo", () => workspaceDynatopoActive(ws, "refine"))}
        >
          Dynatopo
        </button>
        <button
          type="button"
          className="rounded border px-2 py-1"
          disabled={busy || !ws.activeAssetId}
          data-studio-hybrid-dcc-action="retopo"
          onClick={() => run("Retopo", () => workspaceRetopoActive(ws, 8))}
        >
          Retopo
        </button>
        <button
          type="button"
          className="rounded border px-2 py-1"
          disabled={busy || !ws.activeAssetId}
          onClick={() => run("Export OBJ", () => workspaceExportActiveMesh(ws, "obj"))}
        >
          Export OBJ
        </button>
        <button
          type="button"
          className="rounded border px-2 py-1"
          disabled={busy}
          onClick={() =>
            run("Full engine suite", async () => {
              const result = await runStudioHybridDccFullEngineSuite("ui-suite");
              setLog(
                `Suite engines=${result.metrics.engines.length} export=${result.metrics.exportFormat} hash=${result.metrics.packageHash.slice(0, 18)}…`,
              );
              return result.workspace;
            })
          }
        >
          Full engines
        </button>
        <button
          type="button"
          className="rounded border px-2 py-1"
          disabled={busy || !ws.activeAssetId}
          onClick={() => run("Decimate", () => workspaceDecimateActive(ws, 0.5))}
        >
          Decimate
        </button>
        <button
          type="button"
          className="rounded border px-2 py-1"
          disabled={busy || !ws.activeAssetId}
          data-studio-hybrid-dcc-action="orient-outward"
          onClick={() => run("Orient outward", () => workspaceOrientOutwardActive(ws))}
        >
          Orient outward
        </button>
        <button
          type="button"
          className="rounded border px-2 py-1"
          disabled={busy || !ws.activeAssetId}
          onClick={() => run("Extrude", () => {
            const faceIds = resolveSelectedFaces();
            return componentSelection.mode === "face"
              ? workspaceExtrudeRegionActive(ws, componentSelection, 0.25)
              : workspaceExtrudeActive(ws, 0.25, faceIds);
          })}
        >
          Extrude
        </button>
        <button
          type="button"
          className="rounded border px-2 py-1"
          disabled={busy || !ws.activeAssetId}
          onClick={() => run("Knife", () => workspaceKnifeActive(ws))}
        >
          Knife
        </button>
        <button
          type="button"
          className="rounded border px-2 py-1"
          disabled={busy || !ws.activeAssetId}
          onClick={() => run("Boolean", () => workspaceBooleanDifference(ws))}
        >
          Boolean −
        </button>
        <button
          type="button"
          className="rounded border px-2 py-1"
          disabled={busy || !ws.activeAssetId}
          onClick={() => runModifier("Mirror 변형 추가", () => workspaceAddActiveModifier(ws, "mirror"))}
        >
          Mirror
        </button>
        <button
          type="button"
          className="rounded border px-2 py-1"
          disabled={busy || !ws.activeAssetId}
          onClick={() => run("Subdiv", () => workspaceSubdivideActive(ws, 1))}
        >
          Subdiv
        </button>
        <button
          type="button"
          className="rounded border px-2 py-1"
          disabled={busy || !ws.activeAssetId}
          onClick={() => runModifier("Array 변형 추가", () => workspaceAddActiveModifier(ws, "array"))}
        >
          Array
        </button>
        <button
          type="button"
          className="rounded border px-2 py-1"
          disabled={busy}
          onClick={() => run("BOM", () => workspaceRebuildBom(ws))}
        >
          BOM
        </button>
        <button
          type="button"
          className="rounded border px-2 py-1"
          disabled={busy || !ws.activeAssetId}
          onClick={() => run("UV", () => workspaceUvUnwrapActive(ws))}
        >
          UV unwrap
        </button>
        <button
          type="button"
          className="rounded border px-2 py-1"
          disabled={busy || !ws.activeAssetId}
          title="검증된 전문 Sculpt provider 연결 전의 voxel-lite 실험 기능"
          onClick={() => run("Sculpt", () => workspaceSculptActive(ws))}
        >
          Sculpt · voxel-lite 실험
        </button>
        <button
          type="button"
          className="rounded border px-2 py-1"
          disabled={busy}
          onClick={() => run("CAD prop", () => workspaceCadProp(ws))}
        >
          CAD prop
        </button>
        <button
          type="button"
          className="rounded border px-2 py-1"
          disabled={busy || !ws.activeAssetId}
          title="1/120초 고정 스텝 · 구조/굽힘/봉제/충돌을 계산하는 XPBD v2"
          onClick={() => run("천 시뮬레이션", () => workspaceClothStep(ws))}
        >
          천 시뮬레이션 1스텝
        </button>
        <button
          type="button"
          className="rounded border px-2 py-1"
          disabled={busy}
          onClick={() => run("Collab join", () => workspaceCollabJoin(ws, "peer-local", "Artist"))}
        >
          Collab
        </button>
        <button
          type="button"
          className="rounded border px-2 py-1"
          disabled={busy}
          onClick={() => run("8 shots", () => workspaceEnsureShots(ws, 8))}
        >
          8 shots
        </button>
        <button
          type="button"
          className="rounded border px-2 py-1"
          disabled={busy}
          onClick={() => run("Artist ink", () => workspaceAddArtistInk(ws, "shot-1"))}
        >
          Artist ink
        </button>
        <button
          type="button"
          className="rounded border px-2 py-1"
          disabled={busy}
          onClick={() => run("Room", () => workspaceLoadEditableRoomPreset(ws, "classroom"))}
        >
          Room
        </button>
        <button
          type="button"
          className="rounded border px-2 py-1"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
        >
          Import mesh…
        </button>
        <button
          type="button"
          className="rounded border px-2 py-1"
          disabled={busy}
          onClick={() => run("Undo", () => workspaceUndo(ws))}
        >
          Undo
        </button>
        <button
          type="button"
          className="rounded border px-2 py-1"
          disabled={busy}
          onClick={() => run("Redo", () => workspaceRedo(ws))}
        >
          Redo
        </button>
        <button
          type="button"
          className="rounded border px-2 py-1"
          disabled={busy}
          onClick={() => {
            const pkg = workspaceExportToon3d(ws);
            setLog(
              `.toon3d packed hash=${pkg.manifest.packageHash.slice(0, 18)}… files=${Object.keys(pkg.files).length}`,
            );
          }}
        >
          Export .toon3d
        </button>
        <button
          type="button"
          className="rounded border border-accent/60 bg-accent px-3 py-1 font-medium text-on-accent shadow-sm hover:bg-accent-2 disabled:opacity-50"
          disabled={busy || !ws.activeAssetId || !onOpenInBackground3D}
          data-studio-hybrid-dcc-action="open-bg3d"
          onClick={() => void openInBackground3d()}
        >
          3D 배경 · 컷 편집기로 열기
        </button>
      </div>
      </details>
      <footer className="sticky bottom-0 z-10 min-w-0 rounded-xl border border-line bg-panel/95 px-3 py-2 shadow-lg backdrop-blur [overflow-wrap:anywhere]">
        <p className="min-w-0 break-words text-xs text-fg [overflow-wrap:anywhere]" data-studio-hybrid-dcc-log="true" aria-live="polite">
          {busy ? "작업 처리 중… " : ""}{log}
        </p>
        <p
          className="mt-1 min-w-0 break-words text-[10px] text-fg-3 [overflow-wrap:anywhere]"
          data-studio-hybrid-dcc-stats="true"
          data-studio-hybrid-dcc-state-hash={ws.session.state.stateHash}
          data-assets={Object.keys(ws.session.state.geometry.records).length}
          data-active={ws.activeAssetId ?? "none"}
          data-shots={ws.bridge.shots.length}
          data-ink={ws.bridge.artistCorrections.deltas.length}
          data-uv={ws.lastUvMap?.mode ?? ""}
          data-collab={ws.collab.peers.length}
          data-cloth-step={ws.clothStep}
          data-bom={ws.bom.lines.length}
          data-occt-tris={ws.lastOcct?.triangleCount ?? 0}
          data-occt-path={ws.lastOcct?.loadPath ?? ""}
          data-occt-op={ws.lastOcct?.operation ?? ""}
          data-dynatopo-faces={ws.lastDynatopo?.facesAfter ?? 0}
          data-retopo-faces={ws.lastRetopo?.facesAfter ?? 0}
        >
          상태 점검 · 오류 {diag.errorCount}개 · 경고 {diag.warningCount}개 · 선택 {ws.activeAssetId ?? "없음"} · 오브젝트 {authorityRecords.length}개
        </p>
      </footer>
    </section>
  );
}
