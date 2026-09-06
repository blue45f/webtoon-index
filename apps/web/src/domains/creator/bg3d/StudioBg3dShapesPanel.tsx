import { useState } from "react";

import {
  STUDIO_BG3D_CONTROL_BUTTON as CONTROL_BUTTON,
  STUDIO_BG3D_ICON_BUTTON as ICON_BUTTON,
  studioBg3dClassNames as cx,
} from "./studio-bg3d-editor-ui";
import {
  planStudioBg3dPushPull,
  studioBg3dPushPullAxes,
  type StudioBg3dPushPullAxis,
  type StudioBg3dPushPullFace,
} from "./studio-bg3d-push-pull";
import { StudioBg3dProceduralStarterPanel } from "./StudioBg3dProceduralStarterPanel";
import { StudioBg3dTextExtruderPanel } from "./StudioBg3dTextExtruderPanel";

import type { BgCompositeCategory } from "../studio-background-3d-composites";
import type {
  BgCustomModelInstance,
  StudioBg3dThreeJointDescriptor,
  StudioBg3dThreeMorphDescriptor,
} from "../studio-background-3d-model";
import type {
  BgPrimitive,
  BgPrimitiveKind,
} from "../studio-background-3d-primitives";
import type {
  StudioBg3dLayerListItem,
  StudioBg3dSnapSettings,
} from "./studio-bg3d-object-ops";
import type { StudioBg3dProceduralInsertionPlan } from "./studio-bg3d-procedural-starter-pack";
import type { StudioBg3dRigSelectionState } from "./studio-bg3d-rig-selection";
import type {
  StudioBg3dAnimationPlayback,
  StudioBg3dConstraintLayer,
  StudioBg3dMaterialOverride,
  StudioBg3dMorphLayer,
  StudioBg3dPoseLayer,
  StudioBg3dQuaternion,
} from "./studio-bg3d-scene-document";
import type {
  StudioBg3dSemanticMaterialClassificationResult,
  StudioBg3dSemanticMaterialConfidence,
} from "./studio-bg3d-semantic-materials";

type StudioBg3dPanelAnimationClip = Readonly<{
  uuid: string;
  name: string;
  duration: number;
}>;
type BgPanelTab = "shapes" | "templates" | "layers" | "view" | "lt" | "models";

interface StudioBg3dShapesPanelContext {
  readonly Boxes: typeof import("lucide-react").Boxes;
  readonly ADD_BUTTONS: { kind: BgPrimitiveKind; label: string; icon: typeof import("lucide-react").Boxes; }[];
  readonly addPrimitive: (kind: BgPrimitiveKind) => void;
  readonly PRIMITIVE_DEFS: Record<BgPrimitiveKind, import("../studio-background-3d-metadata").BgPrimitiveDef>;
  readonly compositeCategory: BgCompositeCategory | null;
  readonly setCompositeCategory: import("react").Dispatch<import("react").SetStateAction<BgCompositeCategory | null>>;
  readonly COMPOSITE_CATEGORIES: BgCompositeCategory[];
  readonly COMPOSITE_CATEGORY_LABELS: Record<BgCompositeCategory, string>;
  readonly COMPOSITE_PRESETS: import("../studio-background-3d-composites").BgCompositePreset[];
  readonly addComposite: (presetId: string) => void;
  readonly addProceduralStarterAsset: (
    assetId: string,
  ) => StudioBg3dProceduralInsertionPlan;
  readonly proceduralStarterDisabledReason: string | null;
  readonly snapSettings: StudioBg3dSnapSettings;
  readonly setSnapSettings: import("react").Dispatch<import("react").SetStateAction<StudioBg3dSnapSettings>>;
  readonly normalizeStudioBg3dSnapSettings: (raw: unknown) => StudioBg3dSnapSettings;
  readonly Magnet: typeof import("lucide-react").Magnet;
  readonly studioBg3dSnapSettingsSummary: (settings: StudioBg3dSnapSettings) => string;
  readonly STUDIO_BG3D_TRANSLATE_STEP_OPTIONS: readonly [0.05, 0.1, 0.25, 0.5, 1];
  readonly STUDIO_BG3D_ROTATE_STEP_OPTIONS_DEG: readonly [5, 15, 30, 45, 90];
  readonly selectedPrimitive: BgPrimitive | null;
  readonly isBgObjectVisible: (raw: { readonly visible?: unknown; } | null | undefined) => boolean;
  readonly togglePrimitiveFlag: (id: string, flag: "visible" | "locked") => void;
  readonly Eye: typeof import("lucide-react").Eye;
  readonly EyeOff: typeof import("lucide-react").EyeOff;
  readonly isBgObjectLocked: (raw: { readonly locked?: unknown; } | null | undefined) => boolean;
  readonly Lock: typeof import("lucide-react").Lock;
  readonly Unlock: typeof import("lucide-react").Unlock;
  readonly selectedIsLocked: boolean;
  readonly groundSelectedEntity: () => void;
  readonly MoveDown: typeof import("lucide-react").MoveDown;
  readonly centerGroundSelectionDisabledReason: string | undefined;
  readonly centerAndGroundSelectedEntity: () => void;
  readonly LocateFixed: typeof import("lucide-react").LocateFixed;
  readonly focusSelectedEntity: () => void;
  readonly ScanLine: typeof import("lucide-react").ScanLine;
  readonly duplicateSelected: () => void;
  readonly Copy: typeof import("lucide-react").Copy;
  readonly deleteSelected: () => void;
  readonly Trash2: typeof import("lucide-react").Trash2;
  readonly reparentSceneEntity: (id: string, nextParentId: string | null) => void;
  readonly layerListItems: StudioBg3dLayerListItem[];
  readonly canSetStudioBg3dParent: (entities: readonly import( "./studio-bg3d-hierarchy").StudioBg3dHierarchyEntity[], childId: string, proposedParentId: string | null) => boolean;
  readonly Vec3Field: typeof import("./studio-bg3d-control-fields").Vec3Field;
  readonly updateTransform: (id: string, patch: Partial<Pick<BgPrimitive, "position" | "rotation" | "scale">>, options?: { readonly snap?: boolean; }) => void;
  readonly radToDeg: (rad: number) => number;
  readonly degToRad: (deg: number) => number;
  readonly updateColor: (id: string, color: string) => void;
  readonly applySurfacePreset: (id: string, presetId: string | null) => void;
  readonly surfacePresets: readonly import("./studio-bg3d-surface-presets").StudioBg3dSurfacePreset[];
  readonly selectedCustomModel: BgCustomModelInstance | null;
  readonly toggleCustomModelFlag: (id: string, flag: "visible" | "locked") => void;
  readonly canPlaceSelectedModelRecipe: boolean;
  readonly placeSelectedModelRecipe: () => void;
  readonly duplicateSelectedCustomModel: () => void;
  readonly deleteSelectedCustomModel: () => void;
  readonly updateCustomModelTransform: (id: string, patch: Partial<Pick<BgCustomModelInstance, "position" | "rotation" | "scale">>, options?: { readonly snap?: boolean; }) => void;
  readonly updateCustomModelMaterial: (id: string, update: StudioBg3dMaterialOverride | null | ((current: StudioBg3dMaterialOverride) => StudioBg3dMaterialOverride)) => void;
  readonly DEFAULT_STUDIO_BG3D_MATERIAL_OVERRIDE: StudioBg3dMaterialOverride;
  readonly selectedSemanticMaterials: StudioBg3dSemanticMaterialClassificationResult | null;
  readonly selectedCharacterPassPlan: import( "./studio-bg3d-semantic-materials").StudioBg3dSemanticRenderPassResult | null;
  readonly selectedBackgroundPassPlan: import( "./studio-bg3d-semantic-materials").StudioBg3dSemanticRenderPassResult | null;
  readonly selectedSemanticAssignments: readonly import( "./studio-bg3d-semantic-materials").StudioBg3dSemanticMaterialAssignment[];
  readonly SEMANTIC_MATERIAL_SLOT_LABELS: Record<"skin" | "hair" | "eyes" | "clothes" | "accessory" | "background" | "unknown", string>;
  readonly SEMANTIC_MATERIAL_CONFIDENCE_LABELS: Record<StudioBg3dSemanticMaterialConfidence, string>;
  readonly selectedModelJoints: readonly StudioBg3dThreeJointDescriptor[];
  readonly updateCustomModelConstraints: (id: string, update: StudioBg3dConstraintLayer | null | ((current: StudioBg3dConstraintLayer) => StudioBg3dConstraintLayer)) => void;
  readonly DEFAULT_STUDIO_BG3D_CONSTRAINT_LAYER: StudioBg3dConstraintLayer;
  readonly selectedAimConstraints: readonly import( "./studio-bg3d-scene-document").StudioBg3dJointAimConstraint[];
  readonly selectedTwoBoneIkConstraints: readonly import( "./studio-bg3d-scene-document").StudioBg3dTwoBoneIkConstraint[];
  readonly selectedPoseJointKey: string;
  readonly setPoseJointSelection: import("react").Dispatch<import("react").SetStateAction<StudioBg3dRigSelectionState | null>>;
  readonly selectedAimConstraint: import( "./studio-bg3d-scene-document").StudioBg3dJointAimConstraint | undefined;
  readonly commitSelectedAimConstraint: (next: Omit<StudioBg3dConstraintLayer["aims"][number], "jointKey"> | null) => void;
  readonly selectedAimSuppressedByIk: boolean;
  readonly selectedIkEndCandidates: StudioBg3dThreeJointDescriptor[];
  readonly selectedIkEndJointKey: string;
  readonly setIkEndJointSelection: import("react").Dispatch<import("react").SetStateAction<{ readonly modelId: string; readonly jointKey: string; } | null>>;
  readonly selectedIkUpperJoint: StudioBg3dThreeJointDescriptor | undefined;
  readonly selectedIkMiddleJoint: StudioBg3dThreeJointDescriptor | undefined;
  readonly selectedIkEndJoint: StudioBg3dThreeJointDescriptor | undefined;
  readonly selectedTwoBoneIkConstraint: import( "./studio-bg3d-scene-document").StudioBg3dTwoBoneIkConstraint | undefined;
  readonly selectedIkLimitReached: boolean;
  readonly selectedIkHasOverlap: boolean;
  readonly selectedIkTransformSupported: boolean;
  readonly commitSelectedTwoBoneIkConstraint: (next: Omit<StudioBg3dConstraintLayer["twoBoneIks"][number], "endJointKey"> | null) => void;
  readonly selectedIkDefaultTarget: [number, number, number];
  readonly selectedIkDefaultPole: [number, number, number];
  readonly STUDIO_BG3D_MAX_TWO_BONE_IK_CONSTRAINTS: number;
  readonly selectedRigBakeDisabledReason: string | null;
  readonly bakeCustomModelRigConstraints: (id: string) => void;
  readonly selectedModelAnimations: readonly StudioBg3dPanelAnimationClip[];
  readonly updateCustomModelAnimation: (id: string, update: StudioBg3dAnimationPlayback | null | ((current: StudioBg3dAnimationPlayback) => StudioBg3dAnimationPlayback)) => void;
  readonly DEFAULT_STUDIO_BG3D_ANIMATION_PLAYBACK: StudioBg3dAnimationPlayback;
  readonly selectedAnimationClip: StudioBg3dPanelAnimationClip | undefined;
  readonly BgAnimationPlayhead: typeof import("./studio-bg3d-control-fields").BgAnimationPlayhead;
  readonly open: true;
  readonly activePanelTab: BgPanelTab;
  readonly selectedAnimationDuration: number;
  readonly modelAnimationTimeReadersRef: import("react").RefObject<Map<string, () => number>>;
  readonly updateCustomModelPose: (id: string, update: StudioBg3dPoseLayer | null | ((current: StudioBg3dPoseLayer) => StudioBg3dPoseLayer)) => void;
  readonly DEFAULT_STUDIO_BG3D_POSE_LAYER: StudioBg3dPoseLayer;
  readonly selectedPoseJoint: import( "./studio-bg3d-scene-document").StudioBg3dJointPoseOverride | undefined;
  readonly commitSelectedPoseOverride: (next: Omit<StudioBg3dPoseLayer["joints"][number], "jointKey"> | null) => void;
  readonly selectedPoseEulerDegrees: [number, number, number];
  readonly eulerDegreesToQuaternion: (rotation: readonly [number, number, number]) => StudioBg3dQuaternion;
  readonly selectedModelMorphTargets: readonly StudioBg3dThreeMorphDescriptor[];
  readonly updateCustomModelMorph: (id: string, update: StudioBg3dMorphLayer | null | ((current: StudioBg3dMorphLayer) => StudioBg3dMorphLayer)) => void;
  readonly DEFAULT_STUDIO_BG3D_MORPH_LAYER: StudioBg3dMorphLayer;
  readonly selectedMorphTargetKey: string;
  readonly setMorphTargetSelection: import("react").Dispatch<import("react").SetStateAction<{ readonly modelId: string; readonly key: string; } | null>>;
  readonly selectedMorphOverride: import( "./studio-bg3d-scene-document").StudioBg3dMorphWeightOverride | undefined;
}

export interface StudioBg3dShapesPanelProps {
  readonly hidden: boolean;
  readonly context: StudioBg3dShapesPanelContext;
}

export function StudioBg3dShapesPanel({
  hidden,
  context,
}: StudioBg3dShapesPanelProps) {
  const [pushPullAxis, setPushPullAxis] =
    useState<StudioBg3dPushPullAxis>("y");
  const [pushPullFace, setPushPullFace] =
    useState<StudioBg3dPushPullFace>("positive");
  const [pushPullDistance, setPushPullDistance] = useState(0.5);
  const [pushPullFeedback, setPushPullFeedback] = useState<string | null>(null);
  const {
    Boxes,
    ADD_BUTTONS,
    addPrimitive,
    PRIMITIVE_DEFS,
    compositeCategory,
    setCompositeCategory,
    COMPOSITE_CATEGORIES,
    COMPOSITE_CATEGORY_LABELS,
    COMPOSITE_PRESETS,
    addComposite,
    addProceduralStarterAsset,
    proceduralStarterDisabledReason,
    snapSettings,
    setSnapSettings,
    normalizeStudioBg3dSnapSettings,
    Magnet,
    studioBg3dSnapSettingsSummary,
    STUDIO_BG3D_TRANSLATE_STEP_OPTIONS,
    STUDIO_BG3D_ROTATE_STEP_OPTIONS_DEG,
    selectedPrimitive,
    isBgObjectVisible,
    togglePrimitiveFlag,
    Eye,
    EyeOff,
    isBgObjectLocked,
    Lock,
    Unlock,
    selectedIsLocked,
    groundSelectedEntity,
    MoveDown,
    centerGroundSelectionDisabledReason,
    centerAndGroundSelectedEntity,
    LocateFixed,
    focusSelectedEntity,
    ScanLine,
    duplicateSelected,
    Copy,
    deleteSelected,
    Trash2,
    reparentSceneEntity,
    layerListItems,
    canSetStudioBg3dParent,
    Vec3Field,
    updateTransform,
    radToDeg,
    degToRad,
    updateColor,
    applySurfacePreset,
    surfacePresets,
    selectedCustomModel,
    toggleCustomModelFlag,
    canPlaceSelectedModelRecipe,
    placeSelectedModelRecipe,
    duplicateSelectedCustomModel,
    deleteSelectedCustomModel,
    updateCustomModelTransform,
    updateCustomModelMaterial,
    DEFAULT_STUDIO_BG3D_MATERIAL_OVERRIDE,
    selectedSemanticMaterials,
    selectedCharacterPassPlan,
    selectedBackgroundPassPlan,
    selectedSemanticAssignments,
    SEMANTIC_MATERIAL_SLOT_LABELS,
    SEMANTIC_MATERIAL_CONFIDENCE_LABELS,
    selectedModelJoints,
    updateCustomModelConstraints,
    DEFAULT_STUDIO_BG3D_CONSTRAINT_LAYER,
    selectedAimConstraints,
    selectedTwoBoneIkConstraints,
    selectedPoseJointKey,
    setPoseJointSelection,
    selectedAimConstraint,
    commitSelectedAimConstraint,
    selectedAimSuppressedByIk,
    selectedIkEndCandidates,
    selectedIkEndJointKey,
    setIkEndJointSelection,
    selectedIkUpperJoint,
    selectedIkMiddleJoint,
    selectedIkEndJoint,
    selectedTwoBoneIkConstraint,
    selectedIkLimitReached,
    selectedIkHasOverlap,
    selectedIkTransformSupported,
    commitSelectedTwoBoneIkConstraint,
    selectedIkDefaultTarget,
    selectedIkDefaultPole,
    STUDIO_BG3D_MAX_TWO_BONE_IK_CONSTRAINTS,
    selectedRigBakeDisabledReason,
    bakeCustomModelRigConstraints,
    selectedModelAnimations,
    updateCustomModelAnimation,
    DEFAULT_STUDIO_BG3D_ANIMATION_PLAYBACK,
    selectedAnimationClip,
    BgAnimationPlayhead,
    open,
    activePanelTab,
    selectedAnimationDuration,
    modelAnimationTimeReadersRef,
    updateCustomModelPose,
    DEFAULT_STUDIO_BG3D_POSE_LAYER,
    selectedPoseJoint,
    commitSelectedPoseOverride,
    selectedPoseEulerDegrees,
    eulerDegreesToQuaternion,
    selectedModelMorphTargets,
    updateCustomModelMorph,
    DEFAULT_STUDIO_BG3D_MORPH_LAYER,
    selectedMorphTargetKey,
    setMorphTargetSelection,
    selectedMorphOverride,
  } = context;

  return (
<section hidden={hidden}>
                <h3 className="mb-2 flex items-center gap-1.5 text-sm font-bold text-fg">
                  <Boxes size={15} className="text-accent" aria-hidden />
                  도형 추가
                </h3>
                <div className="grid grid-cols-3 gap-2">
                  {ADD_BUTTONS.map((btn) => {
                    const BtnIcon = btn.icon;
                    return (
                      <button
                        key={btn.kind}
                        type="button"
                        aria-label={btn.label}
                        className={cx(CONTROL_BUTTON, "flex-col gap-1 border-line bg-card text-fg-2 hover:bg-raised hover:text-fg")}
                        onClick={() => addPrimitive(btn.kind)}
                      >
                        <BtnIcon size={16} aria-hidden />
                        <span className="text-[0.65rem]">{PRIMITIVE_DEFS[btn.kind].label}</span>
                      </button>
                    );
                  })}
                </div>

                <div className="mt-5 border-t border-line pt-4">
                  <StudioBg3dProceduralStarterPanel
                    disabledReason={proceduralStarterDisabledReason}
                    onInsert={addProceduralStarterAsset}
                  />
                </div>

                <div className="mt-5 border-t border-line pt-4">
                  <h3 className="mb-2 text-sm font-bold text-fg">3D 텍스트 & 효과음 (SFX)</h3>
                  <StudioBg3dTextExtruderPanel
                    onApplyText={(spec) => {
                      if (spec.characterTransforms.length > 0) {
                        addPrimitive("box");
                      }
                    }}
                  />
                </div>

                <div className="mt-5 border-t border-line pt-4">
                  <h3 className="mb-2 text-sm font-bold text-fg">복합 오브젝트 추가</h3>
                  <p className="mb-2.5 text-[0.68rem] leading-relaxed text-fg-3">
                    건물·나무·차량·소품처럼 도형 여러 개가 조합된 배경 소재입니다. 추가 후에도 각 부품을 따로 선택해 다듬을 수 있어요.
                  </p>
                  <div className="mb-2.5 flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      className={cx(
                        "min-h-11 rounded-full border px-2.5 py-1 text-[0.68rem] font-semibold transition-colors sm:min-h-0",
                        compositeCategory === null
                          ? "border-accent/60 bg-accent-soft text-accent"
                          : "border-line bg-card text-fg-3 hover:bg-raised hover:text-fg"
                      )}
                      onClick={() => setCompositeCategory(null)}
                    >
                      전체
                    </button>
                    {COMPOSITE_CATEGORIES.map((cat) => (
                      <button
                        key={cat}
                        type="button"
                        className={cx(
                          "min-h-11 rounded-full border px-2.5 py-1 text-[0.68rem] font-semibold transition-colors sm:min-h-0",
                          compositeCategory === cat
                            ? "border-accent/60 bg-accent-soft text-accent"
                            : "border-line bg-card text-fg-3 hover:bg-raised hover:text-fg"
                        )}
                        onClick={() => setCompositeCategory(cat)}
                      >
                        {COMPOSITE_CATEGORY_LABELS[cat]}
                      </button>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {COMPOSITE_PRESETS.filter((p) => compositeCategory === null || p.category === compositeCategory).map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        className={cx(
                          CONTROL_BUTTON,
                          "flex-col items-start gap-1 border-line bg-card px-2.5 py-2 text-left text-fg-2 hover:bg-raised hover:text-fg"
                        )}
                        onClick={() => addComposite(preset.id)}
                      >
                        <span className="flex items-center gap-1.5 text-xs font-semibold">
                          <span className="inline-block size-2.5 rounded-full" style={{ backgroundColor: preset.parts[0]?.color }} aria-hidden />
                          {preset.label}
                        </span>
                        <span className="text-[0.65rem] font-normal leading-snug text-fg-3">{preset.description}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="mt-5 border-t border-line pt-4">
                  <div className="mb-4 rounded-xl border border-line/80 bg-card/70 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-bold text-fg">변형 스냅</p>
                      <button
                        type="button"
                        aria-pressed={snapSettings.enabled}
                        className={cx(
                          "inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-2.5 text-[0.68rem] font-semibold transition-colors",
                          snapSettings.enabled
                            ? "border-accent/55 bg-accent text-on-accent"
                            : "border-line bg-panel text-fg-2 hover:bg-accent-soft hover:text-accent"
                        )}
                        onClick={() =>
                          setSnapSettings((prev) =>
                            normalizeStudioBg3dSnapSettings({ ...prev, enabled: !prev.enabled })
                          )
                        }
                      >
                        <Magnet size={13} aria-hidden />
                        {snapSettings.enabled ? "켜짐" : "꺼짐"}
                      </button>
                    </div>
                    <p className="mt-1 text-[0.65rem] leading-relaxed text-fg-3">
                      {studioBg3dSnapSettingsSummary(snapSettings)} · 기즈모·수치 입력 모두 적용
                    </p>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <label className="text-[0.65rem] font-semibold text-fg-3">
                        이동 간격
                        <select
                          className="mt-1 min-h-9 w-full rounded-lg border border-line bg-panel px-2 text-xs font-semibold text-fg"
                          value={snapSettings.translateStep}
                          disabled={!snapSettings.enabled}
                          onChange={(e) =>
                            setSnapSettings((prev) =>
                              normalizeStudioBg3dSnapSettings({
                                ...prev,
                                translateStep: Number(e.target.value),
                              })
                            )
                          }
                        >
                          {STUDIO_BG3D_TRANSLATE_STEP_OPTIONS.map((step) => (
                            <option key={step} value={step}>
                              {step}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="text-[0.65rem] font-semibold text-fg-3">
                        회전 간격
                        <select
                          className="mt-1 min-h-9 w-full rounded-lg border border-line bg-panel px-2 text-xs font-semibold text-fg"
                          value={snapSettings.rotateStepDegrees}
                          disabled={!snapSettings.enabled}
                          onChange={(e) =>
                            setSnapSettings((prev) =>
                              normalizeStudioBg3dSnapSettings({
                                ...prev,
                                rotateStepDegrees: Number(e.target.value),
                              })
                            )
                          }
                        >
                          {STUDIO_BG3D_ROTATE_STEP_OPTIONS_DEG.map((step) => (
                            <option key={step} value={step}>
                              {step}°
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {(
                        [
                          { id: "xyz" as const, label: "XYZ" },
                          { id: "xz" as const, label: "XZ(바닥)" },
                          { id: "none" as const, label: "회전만" },
                        ] as const
                      ).map((axis) => (
                        <button
                          key={axis.id}
                          type="button"
                          disabled={!snapSettings.enabled}
                          aria-pressed={snapSettings.translateAxes === axis.id}
                          className={cx(
                            "min-h-8 rounded-lg border px-2 text-[0.65rem] font-semibold transition-colors disabled:opacity-45",
                            snapSettings.translateAxes === axis.id
                              ? "border-accent/55 bg-accent-soft text-accent"
                              : "border-line bg-panel text-fg-2 hover:bg-raised"
                          )}
                          onClick={() =>
                            setSnapSettings((prev) =>
                              normalizeStudioBg3dSnapSettings({ ...prev, translateAxes: axis.id })
                            )
                          }
                        >
                          {axis.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {selectedPrimitive ? (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="text-sm font-bold text-fg">선택한 도형</h3>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            aria-label={isBgObjectVisible(selectedPrimitive) ? "숨기기" : "보이기"}
                            title={isBgObjectVisible(selectedPrimitive) ? "숨기기" : "보이기"}
                            className={ICON_BUTTON}
                            onClick={() => togglePrimitiveFlag(selectedPrimitive.id, "visible")}
                          >
                            {isBgObjectVisible(selectedPrimitive) ? (
                              <Eye size={14} aria-hidden />
                            ) : (
                              <EyeOff size={14} aria-hidden />
                            )}
                          </button>
                          <button
                            type="button"
                            aria-label={isBgObjectLocked(selectedPrimitive) ? "잠금 해제" : "잠금"}
                            title={isBgObjectLocked(selectedPrimitive) ? "잠금 해제" : "잠금"}
                            className={cx(ICON_BUTTON, isBgObjectLocked(selectedPrimitive) && "border-accent/40 bg-accent-soft text-accent")}
                            onClick={() => togglePrimitiveFlag(selectedPrimitive.id, "locked")}
                          >
                            {isBgObjectLocked(selectedPrimitive) ? (
                              <Lock size={14} aria-hidden />
                            ) : (
                              <Unlock size={14} aria-hidden />
                            )}
                          </button>
                          <button
                            type="button"
                            aria-label="바닥에 접지"
                            title="바닥에 접지"
                            disabled={selectedIsLocked}
                            className={cx(ICON_BUTTON, "disabled:opacity-40")}
                            onClick={groundSelectedEntity}
                          >
                            <MoveDown size={14} aria-hidden />
                          </button>
                          <button
                            type="button"
                            aria-label="원점 · 바닥 정렬"
                            title={centerGroundSelectionDisabledReason ?? "원점 · 바닥 정렬"}
                            disabled={Boolean(centerGroundSelectionDisabledReason)}
                            className={cx(ICON_BUTTON, "disabled:opacity-40")}
                            onClick={centerAndGroundSelectedEntity}
                          >
                            <LocateFixed size={14} aria-hidden />
                          </button>
                          <button
                            type="button"
                            aria-label="초점 맞춤"
                            title="초점 맞춤"
                            className={ICON_BUTTON}
                            onClick={focusSelectedEntity}
                          >
                            <ScanLine size={14} aria-hidden />
                          </button>
                          <button
                            type="button"
                            aria-label="복제"
                            title="복제"
                            className={ICON_BUTTON}
                            onClick={duplicateSelected}
                          >
                            <Copy size={14} aria-hidden />
                          </button>
                          <button
                            type="button"
                            aria-label="삭제"
                            title="삭제 (Delete)"
                            className={cx(ICON_BUTTON, "hover:border-accent/40 hover:bg-accent-soft hover:text-accent")}
                            onClick={deleteSelected}
                          >
                            <Trash2 size={14} aria-hidden />
                          </button>
                        </div>
                      </div>

                      {selectedIsLocked ? (
                        <p className="rounded-lg border border-line bg-raised/60 px-2.5 py-2 text-[0.68rem] leading-relaxed text-fg-3">
                          잠긴 객체입니다. 위치·회전·크기를 바꾸려면 잠금을 해제하세요.
                        </p>
                      ) : null}

                                            <div className="flex flex-col gap-1.5">
                        <label className="flex flex-col gap-1.5 text-xs font-medium text-fg-2">부모 계층 (Parent)
                        <select
                          className="h-9 w-full rounded border border-line bg-card px-2 text-xs text-fg focus:border-accent"
                          disabled={selectedIsLocked}
                          value={selectedPrimitive.parentId || ""}
                          onChange={(e) => {
                            const newParentId = e.target.value || null;
                            reparentSceneEntity(selectedPrimitive.id, newParentId);
                          }}
                        >
                          <option value="">(최상위 / 없음)</option>
                          {layerListItems.filter((item) =>
                            canSetStudioBg3dParent(layerListItems, selectedPrimitive.id, item.id)
                          ).map(item => (
                            <option key={item.id} value={item.id}>
                              {item.label}
                            </option>
                          ))}
                        </select>
                        </label>
                      </div>

                      <Vec3Field
                        label="위치"
                        values={selectedPrimitive.position}
                        step={snapSettings.enabled ? snapSettings.translateStep : 0.1}
                        precision={2}
                        onCommit={(i, v) => {
                          const next: [number, number, number] = [...selectedPrimitive.position];
                          next[i] = v;
                          updateTransform(selectedPrimitive.id, { position: next });
                        }}
                      />
                      <Vec3Field
                        label="회전"
                        values={[radToDeg(selectedPrimitive.rotation[0]), radToDeg(selectedPrimitive.rotation[1]), radToDeg(selectedPrimitive.rotation[2])]}
                        step={snapSettings.enabled ? snapSettings.rotateStepDegrees : 1}
                        precision={0}
                        suffix="°"
                        onCommit={(i, v) => {
                          const nextDeg: [number, number, number] = [
                            radToDeg(selectedPrimitive.rotation[0]),
                            radToDeg(selectedPrimitive.rotation[1]),
                            radToDeg(selectedPrimitive.rotation[2]),
                          ];
                          nextDeg[i] = v;
                          updateTransform(selectedPrimitive.id, { rotation: [degToRad(nextDeg[0]), degToRad(nextDeg[1]), degToRad(nextDeg[2])] });
                        }}
                      />
                      <Vec3Field
                        label="크기"
                        values={selectedPrimitive.scale}
                        step={0.1}
                        precision={2}
                        onCommit={(i, v) => {
                          const next: [number, number, number] = [...selectedPrimitive.scale];
                          next[i] = Math.max(0.01, v);
                          updateTransform(selectedPrimitive.id, { scale: next });
                        }}
                      />

                      <section
                        aria-label="면 밀기·당기기"
                        className="rounded-xl border border-line/80 bg-card/70 p-3"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <h4 className="text-xs font-bold text-fg">
                              면 밀기·당기기
                            </h4>
                            <p className="mt-1 text-[0.65rem] leading-relaxed text-fg-3">
                              선택한 면만 수치만큼 이동하고 반대 면은 그 자리에 고정합니다.
                            </p>
                          </div>
                          <span className="shrink-0 rounded-full border border-accent/25 bg-accent-soft px-2 py-0.5 text-[0.6rem] font-bold text-accent">
                            Push/Pull
                          </span>
                        </div>

                        {studioBg3dPushPullAxes(selectedPrimitive.kind).length > 0 ? (
                          <>
                            <div className="mt-3 grid grid-cols-3 gap-1.5">
                              {(["x", "y", "z"] as const).map((axis) => {
                                const available = studioBg3dPushPullAxes(
                                  selectedPrimitive.kind,
                                ).includes(axis);
                                return (
                                  <button
                                    key={axis}
                                    type="button"
                                    disabled={!available || selectedIsLocked}
                                    aria-pressed={pushPullAxis === axis}
                                    className={cx(
                                      "min-h-9 rounded-lg border text-[0.68rem] font-bold uppercase transition-colors disabled:cursor-not-allowed disabled:opacity-35",
                                      pushPullAxis === axis && available
                                        ? "border-accent/55 bg-accent-soft text-accent"
                                        : "border-line bg-panel text-fg-2 hover:bg-raised",
                                    )}
                                    onClick={() => {
                                      setPushPullAxis(axis);
                                      setPushPullFeedback(null);
                                    }}
                                  >
                                    {axis}축
                                  </button>
                                );
                              })}
                            </div>

                            <div className="mt-2 grid grid-cols-2 gap-1.5">
                              {(
                                [
                                  ["negative", "− 면"],
                                  ["positive", "+ 면"],
                                ] as const
                              ).map(([face, label]) => (
                                <button
                                  key={face}
                                  type="button"
                                  disabled={selectedIsLocked}
                                  aria-pressed={pushPullFace === face}
                                  className={cx(
                                    "min-h-9 rounded-lg border text-[0.68rem] font-semibold transition-colors disabled:opacity-35",
                                    pushPullFace === face
                                      ? "border-accent/55 bg-accent-soft text-accent"
                                      : "border-line bg-panel text-fg-2 hover:bg-raised",
                                  )}
                                  onClick={() => {
                                    setPushPullFace(face);
                                    setPushPullFeedback(null);
                                  }}
                                >
                                  {label}
                                </button>
                              ))}
                            </div>

                            <div className="mt-2">
                              <label
                                htmlFor="studio-bg3d-push-pull-distance"
                                className="block text-[0.65rem] font-semibold text-fg-3"
                              >
                                이동 거리
                              </label>
                              <div className="mt-1 flex gap-1.5">
                                <span className="flex min-h-10 flex-1 items-center overflow-hidden rounded-lg border border-line bg-panel focus-within:border-accent">
                                  <input
                                    id="studio-bg3d-push-pull-distance"
                                    type="number"
                                    min={-1_000}
                                    max={1_000}
                                    step={
                                      snapSettings.enabled
                                        ? snapSettings.translateStep
                                        : 0.1
                                    }
                                    value={pushPullDistance}
                                    disabled={selectedIsLocked}
                                    aria-label="Push/Pull 이동 거리"
                                    className="min-w-0 flex-1 bg-transparent px-2.5 text-xs font-semibold text-fg outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40"
                                    onChange={(event) => {
                                      setPushPullDistance(
                                        event.currentTarget.valueAsNumber,
                                      );
                                      setPushPullFeedback(null);
                                    }}
                                  />
                                  <span className="pr-2.5 text-[0.65rem] text-fg-3">
                                    m
                                  </span>
                                </span>
                                <button
                                  type="button"
                                  disabled={selectedIsLocked}
                                  className={cx(
                                    CONTROL_BUTTON,
                                    "min-h-10 shrink-0 border-accent/45 bg-accent px-3 text-on-accent hover:brightness-105 disabled:opacity-40",
                                  )}
                                  onClick={() => {
                                    const availableAxes =
                                      studioBg3dPushPullAxes(
                                        selectedPrimitive.kind,
                                      );
                                    const effectiveAxis =
                                      availableAxes.includes(pushPullAxis)
                                        ? pushPullAxis
                                        : availableAxes[0];
                                    if (!effectiveAxis) return;
                                    const result = planStudioBg3dPushPull(
                                      selectedPrimitive,
                                      {
                                        axis: effectiveAxis,
                                        face: pushPullFace,
                                        distance: pushPullDistance,
                                        snapStep: snapSettings.enabled
                                          ? snapSettings.translateStep
                                          : undefined,
                                      },
                                    );
                                    if (!result.ok) {
                                      setPushPullFeedback(result.message);
                                      return;
                                    }
                                    updateTransform(
                                      selectedPrimitive.id,
                                      result.patch,
                                      { snap: false },
                                    );
                                    setPushPullFeedback(
                                      `${effectiveAxis.toUpperCase()}${pushPullFace === "positive" ? "+" : "−"} 면 ${result.appliedDistance >= 0 ? "+" : ""}${result.appliedDistance.toFixed(2)}m · 반대 면 고정`,
                                    );
                                  }}
                                >
                                  적용
                                </button>
                              </div>
                            </div>

                            <p
                              aria-live="polite"
                              className="mt-2 min-h-4 text-[0.62rem] leading-relaxed text-fg-3"
                            >
                              {pushPullFeedback
                                ?? (snapSettings.enabled
                                  ? `${snapSettings.translateStep}m 스냅 적용 · 음수는 안쪽으로 당깁니다.`
                                  : "음수는 안쪽으로 당기며 최소 두께는 0.01m입니다.")}
                            </p>
                          </>
                        ) : (
                          <p className="mt-2 rounded-lg border border-line bg-panel px-2.5 py-2 text-[0.65rem] leading-relaxed text-fg-3">
                            곡면·테이퍼 도형은 형태를 속이지 않도록 비활성화했습니다.
                            현재 상자 전 방향과 기둥·파이프의 높이 면을 지원합니다.
                          </p>
                        )}
                      </section>

                      <label className="flex items-center gap-2 text-xs font-medium text-fg-2">
                        색상(셰이딩 미리보기 전용)
                        <input
                          type="color"
                          value={selectedPrimitive.color}
                          onChange={(e) => updateColor(selectedPrimitive.id, e.target.value)}
                          className="h-11 w-11 cursor-pointer rounded border border-line bg-card sm:h-7 sm:w-10"
                        />
                      </label>

                      <div>
                        <p className="text-[0.65rem] font-semibold text-fg-3">표면 프리셋</p>
                        <div className="mt-1.5 flex flex-wrap gap-1.5" role="group" aria-label="표면 프리셋">
                          {surfacePresets.map((preset) => (
                            <button
                              key={preset.id}
                              type="button"
                              title={preset.description}
                              className="min-h-8 rounded-full border border-line bg-card px-2 py-0.5 text-[0.62rem] font-semibold text-fg-2 transition-colors hover:bg-raised hover:text-fg"
                              onClick={() => applySurfacePreset(selectedPrimitive.id, preset.id)}
                            >
                              {preset.label}
                            </button>
                          ))}
                          <button
                            type="button"
                            aria-label="표면 프리셋 해제"
                            className="min-h-8 rounded-full border border-line bg-panel px-2 py-0.5 text-[0.62rem] font-semibold text-fg-3 transition-colors hover:bg-raised hover:text-fg"
                            onClick={() => applySurfacePreset(selectedPrimitive.id, null)}
                          >
                            해제
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : selectedCustomModel ? (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="text-sm font-bold text-fg">선택한 모델</h3>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            aria-label={isBgObjectVisible(selectedCustomModel) ? "숨기기" : "보이기"}
                            title={isBgObjectVisible(selectedCustomModel) ? "숨기기" : "보이기"}
                            className={ICON_BUTTON}
                            onClick={() => toggleCustomModelFlag(selectedCustomModel.id, "visible")}
                          >
                            {isBgObjectVisible(selectedCustomModel) ? (
                              <Eye size={14} aria-hidden />
                            ) : (
                              <EyeOff size={14} aria-hidden />
                            )}
                          </button>
                          <button
                            type="button"
                            aria-label={isBgObjectLocked(selectedCustomModel) ? "잠금 해제" : "잠금"}
                            title={isBgObjectLocked(selectedCustomModel) ? "잠금 해제" : "잠금"}
                            className={cx(ICON_BUTTON, isBgObjectLocked(selectedCustomModel) && "border-accent/40 bg-accent-soft text-accent")}
                            onClick={() => toggleCustomModelFlag(selectedCustomModel.id, "locked")}
                          >
                            {isBgObjectLocked(selectedCustomModel) ? (
                              <Lock size={14} aria-hidden />
                            ) : (
                              <Unlock size={14} aria-hidden />
                            )}
                          </button>
                          <button
                            type="button"
                            aria-label="바닥에 접지"
                            title="바닥에 접지"
                            disabled={selectedIsLocked}
                            className={cx(ICON_BUTTON, "disabled:opacity-40")}
                            onClick={groundSelectedEntity}
                          >
                            <MoveDown size={14} aria-hidden />
                          </button>
                          <button
                            type="button"
                            aria-label="배치 정리"
                            title="자동 맞춤 후 바닥에 붙입니다 (다중 선택 지원)"
                            disabled={!canPlaceSelectedModelRecipe}
                            className={cx(
                              "inline-flex min-h-11 items-center justify-center rounded-lg border border-line bg-card px-2 text-[0.65rem] font-semibold text-fg-3 transition-colors",
                              "hover:bg-accent-soft hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                              "disabled:opacity-40 sm:min-h-9",
                            )}
                            onClick={placeSelectedModelRecipe}
                          >
                            배치 정리
                          </button>
                          <button
                            type="button"
                            aria-label="원점 · 바닥 정렬"
                            title={centerGroundSelectionDisabledReason ?? "원점 · 바닥 정렬"}
                            disabled={Boolean(centerGroundSelectionDisabledReason)}
                            className={cx(ICON_BUTTON, "disabled:opacity-40")}
                            onClick={centerAndGroundSelectedEntity}
                          >
                            <LocateFixed size={14} aria-hidden />
                          </button>
                          <button
                            type="button"
                            aria-label="초점 맞춤"
                            title="초점 맞춤"
                            className={ICON_BUTTON}
                            onClick={focusSelectedEntity}
                          >
                            <ScanLine size={14} aria-hidden />
                          </button>
                          <button
                            type="button"
                            aria-label="복제"
                            title="복제"
                            className={ICON_BUTTON}
                            onClick={duplicateSelectedCustomModel}
                          >
                            <Copy size={14} aria-hidden />
                          </button>
                          <button
                            type="button"
                            aria-label="삭제"
                            title="삭제 (Delete)"
                            className={cx(ICON_BUTTON, "hover:border-accent/40 hover:bg-accent-soft hover:text-accent")}
                            onClick={deleteSelectedCustomModel}
                          >
                            <Trash2 size={14} aria-hidden />
                          </button>
                        </div>
                      </div>

                      {selectedIsLocked ? (
                        <p className="rounded-lg border border-line bg-raised/60 px-2.5 py-2 text-[0.68rem] leading-relaxed text-fg-3">
                          잠긴 객체입니다. 위치·회전·크기를 바꾸려면 잠금을 해제하세요.
                        </p>
                      ) : null}

                                            <div className="flex flex-col gap-1.5">
                        <label className="flex flex-col gap-1.5 text-xs font-medium text-fg-2">부모 계층 (Parent)
                        <select
                          className="h-9 w-full rounded border border-line bg-card px-2 text-xs text-fg focus:border-accent"
                          disabled={selectedIsLocked}
                          value={selectedCustomModel.parentId || ""}
                          onChange={(e) => {
                            const newParentId = e.target.value || null;
                            reparentSceneEntity(selectedCustomModel.id, newParentId);
                          }}
                        >
                          <option value="">(최상위 / 없음)</option>
                          {layerListItems.filter((item) =>
                            canSetStudioBg3dParent(layerListItems, selectedCustomModel.id, item.id)
                          ).map(item => (
                            <option key={item.id} value={item.id}>
                              {item.label}
                            </option>
                          ))}
                        </select>
                        </label>
                      </div>

                      <Vec3Field
                        label="위치"
                        values={selectedCustomModel.position}
                        step={snapSettings.enabled ? snapSettings.translateStep : 0.1}
                        precision={2}
                        onCommit={(i, v) => {
                          const next: [number, number, number] = [...selectedCustomModel.position];
                          next[i] = v;
                          updateCustomModelTransform(selectedCustomModel.id, { position: next });
                        }}
                      />
                      <Vec3Field
                        label="회전"
                        values={[radToDeg(selectedCustomModel.rotation[0]), radToDeg(selectedCustomModel.rotation[1]), radToDeg(selectedCustomModel.rotation[2])]}
                        step={snapSettings.enabled ? snapSettings.rotateStepDegrees : 1}
                        precision={0}
                        suffix="°"
                        onCommit={(i, v) => {
                          const nextDeg: [number, number, number] = [
                            radToDeg(selectedCustomModel.rotation[0]),
                            radToDeg(selectedCustomModel.rotation[1]),
                            radToDeg(selectedCustomModel.rotation[2]),
                          ];
                          nextDeg[i] = v;
                          updateCustomModelTransform(selectedCustomModel.id, { rotation: [degToRad(nextDeg[0]), degToRad(nextDeg[1]), degToRad(nextDeg[2])] });
                        }}
                      />
                      <Vec3Field
                        label="크기"
                        values={selectedCustomModel.scale}
                        step={0.1}
                        precision={2}
                        onCommit={(i, v) => {
                          const next: [number, number, number] = [...selectedCustomModel.scale];
                          next[i] = Math.max(0.01, v);
                          updateCustomModelTransform(selectedCustomModel.id, { scale: next });
                        }}
                      />

                      <div className="space-y-2 rounded-xl border border-line bg-card/55 p-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <label className="flex items-center gap-2 text-xs font-semibold text-fg-2">
                            <input
                              type="checkbox"
                              checked={Boolean(selectedCustomModel.materialOverride)}
                              onChange={(event) => updateCustomModelMaterial(
                                selectedCustomModel.id,
                                event.target.checked ? { ...DEFAULT_STUDIO_BG3D_MATERIAL_OVERRIDE } : null,
                              )}
                            />
                            인스턴스 재질 편집
                          </label>
                          {selectedCustomModel.materialOverride ? (
                            <button
                              type="button"
                              className="text-[0.68rem] font-semibold text-accent hover:underline"
                              onClick={() => updateCustomModelMaterial(selectedCustomModel.id, null)}
                            >
                              원본 복원
                            </button>
                          ) : null}
                        </div>

                        {selectedCustomModel.materialOverride ? (
                          <div className="space-y-2 border-t border-line/70 pt-2">
                            <label className="grid grid-cols-[4.5rem_1fr] items-center gap-2 text-[0.68rem] text-fg-3">
                              색상 방식
                              <select
                                className="h-8 rounded-lg border border-line bg-panel px-2 text-xs text-fg"
                                value={selectedCustomModel.materialOverride.colorMode}
                                onChange={(event) => updateCustomModelMaterial(
                                  selectedCustomModel.id,
                                  (current) => ({
                                    ...current,
                                    colorMode: event.target.value as StudioBg3dMaterialOverride["colorMode"],
                                  }),
                                )}
                              >
                                <option value="original">원본</option>
                                <option value="multiply">곱하기</option>
                                <option value="replace">교체</option>
                              </select>
                            </label>
                            <label className="grid grid-cols-[4.5rem_2.75rem_1fr] items-center gap-2 text-[0.68rem] text-fg-3">
                              재질 색
                              <input
                                type="color"
                                className="h-8 w-11 cursor-pointer rounded border border-line bg-panel"
                                disabled={selectedCustomModel.materialOverride.colorMode === "original"}
                                value={selectedCustomModel.materialOverride.color}
                                onChange={(event) => updateCustomModelMaterial(
                                  selectedCustomModel.id,
                                  (current) => ({ ...current, color: event.target.value }),
                                )}
                              />
                              <input
                                aria-label="재질 색상 혼합 강도"
                                type="range"
                                min="0"
                                max="1"
                                step="0.01"
                                disabled={selectedCustomModel.materialOverride.colorMode === "original"}
                                value={selectedCustomModel.materialOverride.colorStrength}
                                onChange={(event) => updateCustomModelMaterial(
                                  selectedCustomModel.id,
                                  (current) => ({ ...current, colorStrength: Number(event.target.value) }),
                                )}
                              />
                            </label>
                            <label className="grid grid-cols-[4.5rem_1fr_2.5rem] items-center gap-2 text-[0.68rem] text-fg-3">
                              불투명도
                              <input
                                type="range"
                                min="0"
                                max="1"
                                step="0.01"
                                value={selectedCustomModel.materialOverride.opacityMultiplier}
                                onChange={(event) => updateCustomModelMaterial(
                                  selectedCustomModel.id,
                                  (current) => ({ ...current, opacityMultiplier: Number(event.target.value) }),
                                )}
                              />
                              <span className="text-right tabular-nums text-fg-2">
                                {Math.round(selectedCustomModel.materialOverride.opacityMultiplier * 100)}%
                              </span>
                            </label>
                            <div className="flex flex-wrap gap-x-4 gap-y-2 text-[0.68rem] text-fg-2">
                              <label className="flex items-center gap-1.5">
                                <input
                                  type="checkbox"
                                  checked={selectedCustomModel.materialOverride.wireframe}
                                  onChange={(event) => updateCustomModelMaterial(
                                    selectedCustomModel.id,
                                    (current) => ({ ...current, wireframe: event.target.checked }),
                                  )}
                                />
                                와이어프레임
                              </label>
                              <label className="flex items-center gap-1.5">
                                <input
                                  type="checkbox"
                                  checked={selectedCustomModel.materialOverride.doubleSided}
                                  onChange={(event) => updateCustomModelMaterial(
                                    selectedCustomModel.id,
                                    (current) => ({ ...current, doubleSided: event.target.checked }),
                                  )}
                                />
                                양면 렌더링
                              </label>
                            </div>
                          </div>
                        ) : (
                          <p className="text-[0.68rem] leading-relaxed text-fg-3">
                            원본 재질과 텍스처는 보존한 채 이 배치에만 색·투명도·와이어 설정을 적용합니다.
                          </p>
                        )}
                      </div>

                      <div className="space-y-2 rounded-xl border border-line bg-card/55 p-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <h4 className="text-xs font-semibold text-fg-2">의미 재질 분석</h4>
                            <p className="mt-0.5 text-[0.64rem] leading-relaxed text-fg-3">
                              재질·메시 이름을 로컬에서 분석해 캐릭터/배경 분리 패스 후보를 만듭니다.
                            </p>
                          </div>
                          {selectedSemanticMaterials?.ok ? (
                            <span className="shrink-0 rounded-full border border-line bg-panel px-2 py-1 text-[0.6rem] font-semibold tabular-nums text-fg-3">
                              {selectedSemanticMaterials.counts.total} 재질
                            </span>
                          ) : null}
                        </div>

                        {selectedSemanticMaterials?.ok ? (
                          <>
                            <div className="grid grid-cols-2 gap-1.5 text-[0.65rem]">
                              <div className="rounded-lg border border-line/70 bg-panel px-2 py-1.5 text-fg-3">
                                캐릭터 후보
                                <strong className="ml-1 text-fg">
                                  {selectedCharacterPassPlan?.ok
                                    ? selectedCharacterPassPlan.plan.counts.included
                                    : 0}
                                </strong>
                              </div>
                              <div className="rounded-lg border border-line/70 bg-panel px-2 py-1.5 text-fg-3">
                                배경 후보
                                <strong className="ml-1 text-fg">
                                  {selectedBackgroundPassPlan?.ok
                                    ? selectedBackgroundPassPlan.plan.counts.included
                                    : 0}
                                </strong>
                              </div>
                            </div>
                            {selectedSemanticAssignments.length > 0 ? (
                              <ul
                                aria-label="의미 재질 자동 분류"
                                className="max-h-40 space-y-1 overflow-y-auto overscroll-contain pr-1"
                              >
                                {selectedSemanticAssignments.slice(0, 24).map((assignment, index) => (
                                  <li
                                    key={assignment.materialKey}
                                    className="flex items-center gap-2 rounded-lg border border-line/60 bg-panel px-2 py-1.5 text-[0.65rem]"
                                  >
                                    <span className="w-12 shrink-0 truncate text-fg-3">
                                      재질 {index + 1}
                                    </span>
                                    <span className="min-w-0 flex-1 truncate font-semibold text-fg-2">
                                      {SEMANTIC_MATERIAL_SLOT_LABELS[assignment.slot]}
                                    </span>
                                    <span className={cx(
                                      "shrink-0 rounded-full px-1.5 py-0.5 text-[0.56rem] font-bold",
                                      assignment.confidence === "high" || assignment.confidence === "medium"
                                        ? "bg-accent-soft text-accent"
                                        : "bg-raised text-fg-3",
                                    )}>
                                      {SEMANTIC_MATERIAL_CONFIDENCE_LABELS[assignment.confidence]}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <p className="rounded-lg border border-dashed border-line px-2 py-2 text-[0.65rem] text-fg-3">
                                이 모델에는 분류할 렌더 재질이 없습니다.
                              </p>
                            )}
                            {selectedSemanticAssignments.length > 24 ? (
                              <p className="text-[0.62rem] text-fg-3">
                                성능을 위해 앞의 24개만 표시합니다. 전체 {selectedSemanticAssignments.length}개는 패스 계획에 반영됩니다.
                              </p>
                            ) : null}
                            <p className="text-[0.62rem] leading-relaxed text-fg-3">
                              자동 제안은 원본 모델이나 장면 문서에 덮어쓰지 않습니다. 낮은 신뢰도의 재질은 분리 출력 전에 사용자 검토 대상으로 유지됩니다.
                            </p>
                          </>
                        ) : selectedSemanticMaterials ? (
                          <p className="rounded-lg border border-dashed border-line px-2 py-2 text-[0.65rem] leading-relaxed text-fg-3">
                            안전한 이름·개수 예산 안에서 재질을 분석할 수 없어 자동 분류를 건너뛰었습니다.
                          </p>
                        ) : (
                          <p className="rounded-lg border border-dashed border-line px-2 py-2 text-[0.65rem] leading-relaxed text-fg-3">
                            모델 렌더 준비가 끝나면 의미 재질 분석 결과가 표시됩니다.
                          </p>
                        )}
                      </div>

                      <div className="space-y-2 rounded-xl border border-line bg-card/55 p-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <label className="flex min-h-11 items-center gap-2 text-xs font-semibold text-fg-2 sm:min-h-8 pointer-coarse:min-h-11">
                            <input
                              type="checkbox"
                              disabled={selectedModelJoints.length === 0}
                              checked={Boolean(selectedCustomModel.constraints)}
                              onChange={(event) => updateCustomModelConstraints(
                                selectedCustomModel.id,
                                event.target.checked ? { ...DEFAULT_STUDIO_BG3D_CONSTRAINT_LAYER } : null,
                              )}
                            />
                            리그 제약
                          </label>
                          <span className="text-[0.68rem] tabular-nums text-fg-3">
                            {selectedAimConstraints.length} 에임 · {selectedTwoBoneIkConstraints.length} IK
                          </span>
                        </div>

                        {selectedCustomModel.constraints && selectedModelJoints.length > 0 ? (
                          <div className="space-y-2 border-t border-line/70 pt-2">
                            <div className="grid grid-cols-[1fr_auto] gap-2">
                              <select
                                aria-label="에임 조인트"
                                className="h-11 min-w-0 rounded-lg border border-line bg-panel px-2 text-xs text-fg sm:h-8 pointer-coarse:h-11"
                                value={selectedPoseJointKey}
                                onChange={(event) => setPoseJointSelection({
                                  modelId: selectedCustomModel.id,
                                  key: event.target.value,
                                })}
                              >
                                {selectedModelJoints.map((joint) => (
                                  <option key={joint.key} value={joint.key}>
                                    {joint.name} · S{joint.skinIndex + 1}/J{joint.jointIndex + 1}
                                  </option>
                                ))}
                              </select>
                              <button
                                type="button"
                                className="h-11 rounded-lg border border-line bg-panel px-2 text-[0.68rem] font-semibold text-fg-2 hover:bg-raised disabled:opacity-50 sm:h-8 pointer-coarse:h-11"
                                disabled={!selectedAimConstraint}
                                onClick={() => commitSelectedAimConstraint(null)}
                              >
                                에임 해제
                              </button>
                            </div>
                            <Vec3Field
                              label="모델 로컬 타깃"
                              values={[...(selectedAimConstraint?.target ?? [0, 1, 1])]}
                              step={0.1}
                              precision={2}
                              disabled={selectedAimSuppressedByIk}
                              touchFriendly
                              onCommit={(axis, value) => {
                                const target: [number, number, number] = [
                                  ...(selectedAimConstraint?.target ?? [0, 1, 1]),
                                ];
                                target[axis] = Math.max(-10_000, Math.min(10_000, value));
                                commitSelectedAimConstraint({
                                  target,
                                  axis: selectedAimConstraint?.axis ?? "+z",
                                  weight: selectedAimConstraint?.weight ?? 1,
                                });
                              }}
                            />
                            <div className="grid grid-cols-2 gap-2">
                              <label className="space-y-1 text-[0.68rem] text-fg-3">
                                향할 로컬 축
                                <select
                                  className="h-11 w-full rounded-lg border border-line bg-panel px-2 text-xs text-fg sm:h-8 pointer-coarse:h-11"
                                  disabled={selectedAimSuppressedByIk}
                                  value={selectedAimConstraint?.axis ?? "+z"}
                                  onChange={(event) => commitSelectedAimConstraint({
                                    target: [...(selectedAimConstraint?.target ?? [0, 1, 1])],
                                    axis: event.target.value as "+x" | "-x" | "+y" | "-y" | "+z" | "-z",
                                    weight: selectedAimConstraint?.weight ?? 1,
                                  })}
                                >
                                  <option value="+x">+X</option><option value="-x">−X</option>
                                  <option value="+y">+Y</option><option value="-y">−Y</option>
                                  <option value="+z">+Z</option><option value="-z">−Z</option>
                                </select>
                              </label>
                              <label className="space-y-1 text-[0.68rem] text-fg-3">
                                강도 · {Math.round((selectedAimConstraint?.weight ?? 1) * 100)}%
                                <input
                                  className="block h-11 w-full sm:h-8 pointer-coarse:h-11"
                                  type="range"
                                  disabled={selectedAimSuppressedByIk}
                                  min="0"
                                  max="1"
                                  step="0.01"
                                  value={selectedAimConstraint?.weight ?? 1}
                                  onChange={(event) => commitSelectedAimConstraint({
                                    target: [...(selectedAimConstraint?.target ?? [0, 1, 1])],
                                    axis: selectedAimConstraint?.axis ?? "+z",
                                    weight: Number(event.target.value),
                                  })}
                                />
                              </label>
                            </div>
                            {selectedAimSuppressedByIk ? (
                              <p className="rounded-lg border border-warning/30 bg-warning/10 px-2 py-1.5 text-[0.64rem] leading-relaxed text-warning">
                                이 조인트의 에임은 손·발 타깃을 보존하기 위해 활성 IK 뒤에서 자동 중지됩니다. 에임을 사용하려면 겹치는 IK를 먼저 해제해 주세요.
                              </p>
                            ) : null}
                            <div className="space-y-2 border-t border-line/70 pt-2">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-[0.68rem] font-semibold text-fg-2">
                                  2본 IK · 손/발 위치
                                </span>
                                <span className="text-[0.64rem] text-fg-3">
                                  팔꿈치·무릎 자동 계산
                                </span>
                              </div>
                              {selectedIkEndCandidates.length > 0 ? (
                                <>
                                  <div className="grid grid-cols-[1fr_auto] gap-2">
                                    <select
                                      aria-label="IK 끝 조인트"
                                      className="h-11 min-w-0 rounded-lg border border-line bg-panel px-2 text-xs text-fg sm:h-8 pointer-coarse:h-11"
                                      value={selectedIkEndJointKey}
                                      onChange={(event) => setIkEndJointSelection({
                                        modelId: selectedCustomModel.id,
                                        jointKey: event.target.value,
                                      })}
                                    >
                                      {selectedIkEndCandidates.map((joint) => (
                                        <option key={joint.key} value={joint.key}>
                                          {joint.name} · S{joint.skinIndex + 1}/J{joint.jointIndex + 1}
                                        </option>
                                      ))}
                                    </select>
                                    <button
                                      type="button"
                                      className="h-11 rounded-lg border border-line bg-panel px-2 text-[0.68rem] font-semibold text-fg-2 hover:bg-raised disabled:opacity-50 sm:h-8 pointer-coarse:h-11"
                                      disabled={
                                        !selectedIkUpperJoint || !selectedIkMiddleJoint || !selectedIkEndJoint ||
                                        (!selectedTwoBoneIkConstraint && (
                                          selectedIkLimitReached || selectedIkHasOverlap ||
                                          !selectedIkTransformSupported
                                        ))
                                      }
                                      onClick={() => {
                                        if (selectedTwoBoneIkConstraint) {
                                          commitSelectedTwoBoneIkConstraint(null);
                                          return;
                                        }
                                        if (!selectedIkUpperJoint || !selectedIkMiddleJoint) return;
                                        commitSelectedTwoBoneIkConstraint({
                                          upperJointKey: selectedIkUpperJoint.key,
                                          middleJointKey: selectedIkMiddleJoint.key,
                                          target: [...selectedIkDefaultTarget],
                                          poleTarget: [...selectedIkDefaultPole],
                                          weight: 1,
                                        });
                                      }}
                                    >
                                      {selectedTwoBoneIkConstraint ? "IK 해제" : "IK 적용"}
                                    </button>
                                  </div>
                                  <p className="text-[0.64rem] leading-relaxed text-fg-3">
                                    {selectedIkUpperJoint?.name ?? "상위"} →{
                                      selectedIkMiddleJoint?.name ?? "중간"
                                    } → {selectedIkEndJoint?.name ?? "끝"}
                                  </p>
                                  {!selectedIkTransformSupported ? (
                                    <p className="rounded-lg border border-warning/30 bg-warning/10 px-2 py-1.5 text-[0.64rem] leading-relaxed text-warning">
                                      현재 부모·모델·관절의 월드 변환에 비균일 크기, 반전 또는 전단이 있어 IK가 일시 중지됩니다. 계층 전체를 균일 크기로 맞춰 주세요.
                                    </p>
                                  ) : selectedIkHasOverlap ? (
                                    <p className="rounded-lg border border-warning/30 bg-warning/10 px-2 py-1.5 text-[0.64rem] leading-relaxed text-warning">
                                      다른 IK와 조인트를 공유하는 체인은 동시에 적용할 수 없습니다.
                                    </p>
                                  ) : selectedIkLimitReached && !selectedTwoBoneIkConstraint ? (
                                    <p className="rounded-lg border border-warning/30 bg-warning/10 px-2 py-1.5 text-[0.64rem] leading-relaxed text-warning">
                                      모델당 IK는 최대 {STUDIO_BG3D_MAX_TWO_BONE_IK_CONSTRAINTS}개까지 저장할 수 있습니다.
                                    </p>
                                  ) : null}
                                  <Vec3Field
                                    label="끝 위치 타깃"
                                    values={[
                                      ...(selectedTwoBoneIkConstraint?.target ?? selectedIkDefaultTarget),
                                    ]}
                                    step={0.05}
                                    precision={2}
                                    disabled={!selectedTwoBoneIkConstraint}
                                    touchFriendly
                                    onCommit={(axis, value) => {
                                      if (!selectedTwoBoneIkConstraint) return;
                                      const target: [number, number, number] = [
                                        ...selectedTwoBoneIkConstraint.target,
                                      ];
                                      target[axis] = Math.max(-10_000, Math.min(10_000, value));
                                      commitSelectedTwoBoneIkConstraint({
                                        upperJointKey: selectedTwoBoneIkConstraint.upperJointKey,
                                        middleJointKey: selectedTwoBoneIkConstraint.middleJointKey,
                                        target,
                                        poleTarget: [...selectedTwoBoneIkConstraint.poleTarget],
                                        weight: selectedTwoBoneIkConstraint.weight,
                                      });
                                    }}
                                  />
                                  <Vec3Field
                                    label="굽힘 폴 타깃"
                                    values={[
                                      ...(selectedTwoBoneIkConstraint?.poleTarget ?? selectedIkDefaultPole),
                                    ]}
                                    step={0.05}
                                    precision={2}
                                    disabled={!selectedTwoBoneIkConstraint}
                                    touchFriendly
                                    onCommit={(axis, value) => {
                                      if (!selectedTwoBoneIkConstraint) return;
                                      const poleTarget: [number, number, number] = [
                                        ...selectedTwoBoneIkConstraint.poleTarget,
                                      ];
                                      poleTarget[axis] = Math.max(-10_000, Math.min(10_000, value));
                                      commitSelectedTwoBoneIkConstraint({
                                        upperJointKey: selectedTwoBoneIkConstraint.upperJointKey,
                                        middleJointKey: selectedTwoBoneIkConstraint.middleJointKey,
                                        target: [...selectedTwoBoneIkConstraint.target],
                                        poleTarget,
                                        weight: selectedTwoBoneIkConstraint.weight,
                                      });
                                    }}
                                  />
                                  <label className="grid grid-cols-[4.5rem_1fr_2.5rem] items-center gap-2 text-[0.68rem] text-fg-3">
                                    IK 강도
                                    <input
                                      className="h-11 w-full sm:h-8 pointer-coarse:h-11"
                                      type="range"
                                      min="0"
                                      max="1"
                                      step="0.01"
                                      disabled={!selectedTwoBoneIkConstraint}
                                      value={selectedTwoBoneIkConstraint?.weight ?? 1}
                                      onChange={(event) => {
                                        if (!selectedTwoBoneIkConstraint) return;
                                        commitSelectedTwoBoneIkConstraint({
                                          upperJointKey: selectedTwoBoneIkConstraint.upperJointKey,
                                          middleJointKey: selectedTwoBoneIkConstraint.middleJointKey,
                                          target: [...selectedTwoBoneIkConstraint.target],
                                          poleTarget: [...selectedTwoBoneIkConstraint.poleTarget],
                                          weight: Number(event.target.value),
                                        });
                                      }}
                                    />
                                    <span className="text-right tabular-nums text-fg-2">
                                      {Math.round((selectedTwoBoneIkConstraint?.weight ?? 1) * 100)}%
                                    </span>
                                  </label>
                                </>
                              ) : (
                                <p className="text-[0.66rem] leading-relaxed text-fg-3">
                                  같은 스킨에서 부모 → 중간 → 끝으로 이어지는 3개 조인트 체인이 없습니다.
                                </p>
                              )}
                            </div>
                            <label className="flex min-h-11 items-center gap-1.5 text-[0.68rem] text-fg-2 sm:min-h-8 pointer-coarse:min-h-11">
                              <input
                                type="checkbox"
                                checked={selectedCustomModel.constraints.enabled}
                                onChange={(event) => updateCustomModelConstraints(
                                  selectedCustomModel.id,
                                  (current) => ({ ...current, enabled: event.target.checked }),
                                )}
                              />
                              애니메이션·포즈 뒤에 제약 적용
                            </label>
                            <button
                              type="button"
                              aria-describedby={
                                selectedRigBakeDisabledReason
                                  ? "bg3d-rig-bake-disabled-reason"
                                  : "bg3d-rig-bake-description"
                              }
                              className="min-h-11 w-full rounded-lg border border-accent/35 bg-accent-soft px-3 text-[0.7rem] font-semibold text-accent hover:bg-accent/15 disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-9 pointer-coarse:min-h-11"
                              disabled={selectedRigBakeDisabledReason !== null}
                              onClick={() => bakeCustomModelRigConstraints(selectedCustomModel.id)}
                            >
                              현재 IK·에임을 포즈로 굽기
                            </button>
                            {selectedRigBakeDisabledReason ? (
                              <p
                                id="bg3d-rig-bake-disabled-reason"
                                className="rounded-lg border border-warning/30 bg-warning/10 px-2 py-1.5 text-[0.64rem] leading-relaxed text-warning"
                              >
                                {selectedRigBakeDisabledReason}
                              </p>
                            ) : null}
                            <p id="bg3d-rig-bake-description" className="text-[0.64rem] leading-relaxed text-fg-3">
                              지금 보이는 한 프레임을 weight 1 포즈로 고정하고 모든 리그 제약을 제거합니다.
                              애니메이션은 비본 트랙을 보존한 채 현재 시각에서 일시정지되며, 3D 실행 취소로
                              원래 포즈와 제약을 되돌릴 수 있습니다.
                            </p>
                            <p className="text-[0.66rem] leading-relaxed text-fg-3">
                              에임은 눈·머리·무기 방향을, 2본 IK는 손·발 위치와 굽힘 평면을 비파괴
                              혼합합니다. 원본 스켈레톤과 애니메이션 키는 수정하지 않습니다.
                            </p>
                          </div>
                        ) : (
                          <p className="text-[0.68rem] leading-relaxed text-fg-3">
                            모델에 스킨 조인트가 있으면 시선·머리 에임과 손·발 2본 IK를 추가할 수 있습니다.
                          </p>
                        )}
                      </div>

                      <div className="space-y-2 rounded-xl border border-line bg-card/55 p-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <label className="flex items-center gap-2 text-xs font-semibold text-fg-2">
                            <input
                              type="checkbox"
                              disabled={selectedModelAnimations.length === 0}
                              checked={Boolean(selectedCustomModel.animation)}
                              onChange={(event) => updateCustomModelAnimation(
                                selectedCustomModel.id,
                                event.target.checked ? { ...DEFAULT_STUDIO_BG3D_ANIMATION_PLAYBACK } : null,
                              )}
                            />
                            모델 애니메이션
                          </label>
                          <span className="text-[0.68rem] tabular-nums text-fg-3">
                            {selectedModelAnimations.length}개 클립
                          </span>
                        </div>

                        {selectedCustomModel.animation && selectedAnimationClip ? (
                          <div className="space-y-2 border-t border-line/70 pt-2">
                            <label className="grid grid-cols-[4.5rem_1fr] items-center gap-2 text-[0.68rem] text-fg-3">
                              클립
                              <select
                                className="h-8 min-w-0 rounded-lg border border-line bg-panel px-2 text-xs text-fg"
                                value={Math.min(
                                  selectedCustomModel.animation.clipIndex,
                                  Math.max(0, selectedModelAnimations.length - 1),
                                )}
                                onChange={(event) => updateCustomModelAnimation(
                                  selectedCustomModel.id,
                                  (current) => ({
                                    ...current,
                                    clipIndex: Number(event.target.value),
                                    timeSeconds: 0,
                                  }),
                                )}
                              >
                                {selectedModelAnimations.map((clip, index) => (
                                  <option key={`${index}-${clip.uuid}`} value={index}>
                                    {(clip.name || `클립 ${index + 1}`).slice(0, 80)} · {clip.duration.toFixed(2)}s
                                  </option>
                                ))}
                              </select>
                            </label>
                            <div className="grid grid-cols-[4.5rem_1fr] items-center gap-2">
                              <button
                                type="button"
                                className="h-11 rounded-lg border border-line bg-panel px-2 text-[0.68rem] font-semibold text-fg-2 hover:bg-raised sm:h-8 pointer-coarse:h-11"
                                onClick={() => updateCustomModelAnimation(
                                  selectedCustomModel.id,
                                  (current) => ({ ...current, playing: !current.playing }),
                                )}
                              >
                                {selectedCustomModel.animation.playing ? "일시정지" : "재생"}
                              </button>
                              <BgAnimationPlayhead
                                active={open && activePanelTab === "models"}
                                modelId={selectedCustomModel.id}
                                playback={selectedCustomModel.animation}
                                durationSeconds={selectedAnimationDuration}
                                readLiveTime={() => modelAnimationTimeReadersRef.current.get(
                                  selectedCustomModel.id,
                                )?.()}
                                onCommit={(timeSeconds) => updateCustomModelAnimation(
                                  selectedCustomModel.id,
                                  (current) => ({ ...current, timeSeconds }),
                                )}
                              />
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <label className="space-y-1 text-[0.68rem] text-fg-3">
                                반복
                                <select
                                  className="h-8 w-full rounded-lg border border-line bg-panel px-2 text-xs text-fg"
                                  value={selectedCustomModel.animation.loop}
                                  onChange={(event) => updateCustomModelAnimation(
                                    selectedCustomModel.id,
                                    (current) => ({
                                      ...current,
                                      loop: event.target.value as StudioBg3dAnimationPlayback["loop"],
                                    }),
                                  )}
                                >
                                  <option value="once">한 번</option>
                                  <option value="repeat">반복</option>
                                  <option value="ping-pong">왕복</option>
                                </select>
                              </label>
                              <label className="space-y-1 text-[0.68rem] text-fg-3">
                                속도 · {selectedCustomModel.animation.timeScale.toFixed(1)}×
                                <input
                                  className="block h-8 w-full"
                                  type="range"
                                  min="-2"
                                  max="2"
                                  step="0.1"
                                  value={selectedCustomModel.animation.timeScale}
                                  onChange={(event) => updateCustomModelAnimation(
                                    selectedCustomModel.id,
                                    (current) => ({ ...current, timeScale: Number(event.target.value) }),
                                  )}
                                />
                              </label>
                            </div>
                          </div>
                        ) : (
                          <p className="text-[0.68rem] leading-relaxed text-fg-3">
                            {selectedModelAnimations.length > 0
                              ? "활성화하면 클립 선택·재생·스크럽·반복·역재생 속도를 이 배치에 저장합니다."
                              : "이 모델에는 재생 가능한 glTF 애니메이션 클립이 없습니다."}
                          </p>
                        )}
                      </div>

                      <div className="space-y-2 rounded-xl border border-line bg-card/55 p-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <label className="flex items-center gap-2 text-xs font-semibold text-fg-2">
                            <input
                              type="checkbox"
                              disabled={selectedModelJoints.length === 0}
                              checked={Boolean(selectedCustomModel.pose)}
                              onChange={(event) => updateCustomModelPose(
                                selectedCustomModel.id,
                                event.target.checked ? { ...DEFAULT_STUDIO_BG3D_POSE_LAYER } : null,
                              )}
                            />
                            비파괴 포즈 레이어
                          </label>
                          <span className="text-[0.68rem] tabular-nums text-fg-3">
                            {selectedModelJoints.length}개 조인트
                          </span>
                        </div>

                        {selectedCustomModel.pose && selectedModelJoints.length > 0 ? (
                          <div className="space-y-2 border-t border-line/70 pt-2">
                            <div className="grid grid-cols-[1fr_auto] gap-2">
                              <select
                                aria-label="포즈 조인트"
                                className="h-11 min-w-0 rounded-lg border border-line bg-panel px-2 text-xs text-fg sm:h-8 pointer-coarse:h-11"
                                value={selectedPoseJointKey}
                                onChange={(event) => setPoseJointSelection({
                                  modelId: selectedCustomModel.id,
                                  key: event.target.value,
                                })}
                              >
                                {selectedModelJoints.map((joint) => (
                                  <option key={joint.key} value={joint.key}>
                                    {joint.name} · S{joint.skinIndex + 1}/J{joint.jointIndex + 1}
                                  </option>
                                ))}
                              </select>
                              <button
                                type="button"
                                className="h-11 rounded-lg border border-line bg-panel px-2 text-[0.68rem] font-semibold text-fg-2 hover:bg-raised disabled:opacity-50 sm:h-8 pointer-coarse:h-11"
                                disabled={!selectedPoseJoint}
                                onClick={() => commitSelectedPoseOverride(null)}
                              >
                                조인트 초기화
                              </button>
                            </div>
                            <Vec3Field
                              label="회전 오프셋"
                              values={selectedPoseEulerDegrees}
                              step={1}
                              precision={1}
                              suffix="°"
                              onCommit={(axis, value) => {
                                const nextEuler: [number, number, number] = [...selectedPoseEulerDegrees];
                                nextEuler[axis] = Math.max(-180, Math.min(180, value));
                                const rotationOffset = eulerDegreesToQuaternion(nextEuler);
                                commitSelectedPoseOverride({ rotationOffset });
                              }}
                            />
                            <label className="grid grid-cols-[4.5rem_1fr_2.5rem] items-center gap-2 text-[0.68rem] text-fg-3">
                              강도
                              <input
                                type="range"
                                min="0"
                                max="1"
                                step="0.01"
                                value={selectedCustomModel.pose.weight}
                                onChange={(event) => updateCustomModelPose(
                                  selectedCustomModel.id,
                                  (current) => ({ ...current, weight: Number(event.target.value) }),
                                )}
                              />
                              <span className="text-right tabular-nums text-fg-2">
                                {Math.round(selectedCustomModel.pose.weight * 100)}%
                              </span>
                            </label>
                            <div className="flex items-center justify-between gap-2">
                              <label className="flex items-center gap-1.5 text-[0.68rem] text-fg-2">
                                <input
                                  type="checkbox"
                                  checked={selectedCustomModel.pose.enabled}
                                  onChange={(event) => updateCustomModelPose(
                                    selectedCustomModel.id,
                                    (current) => ({ ...current, enabled: event.target.checked }),
                                  )}
                                />
                                레이어 적용
                              </label>
                              <button
                                type="button"
                                className="text-[0.68rem] font-semibold text-accent hover:underline"
                                onClick={() => updateCustomModelPose(
                                  selectedCustomModel.id,
                                  { ...DEFAULT_STUDIO_BG3D_POSE_LAYER },
                                )}
                              >
                                전체 포즈 초기화
                              </button>
                            </div>
                            <p className="text-[0.66rem] leading-relaxed text-fg-3">
                              애니메이션 또는 원본 휴지 자세를 먼저 계산한 뒤 로컬 회전 오프셋을 더합니다.
                              원본 리깅과 클립은 변경하지 않습니다.
                            </p>
                          </div>
                        ) : (
                          <p className="text-[0.68rem] leading-relaxed text-fg-3">
                            {selectedModelJoints.length > 0
                              ? "활성화하면 본별 회전 오프셋과 혼합 강도를 이 배치에 저장합니다."
                              : "이 모델에는 편집 가능한 스킨 조인트가 없습니다."}
                          </p>
                        )}
                      </div>

                      <div className="space-y-2 rounded-xl border border-line bg-card/55 p-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <label className="flex items-center gap-2 text-xs font-semibold text-fg-2">
                            <input
                              type="checkbox"
                              disabled={selectedModelMorphTargets.length === 0}
                              checked={Boolean(selectedCustomModel.morph)}
                              onChange={(event) => updateCustomModelMorph(
                                selectedCustomModel.id,
                                event.target.checked ? { ...DEFAULT_STUDIO_BG3D_MORPH_LAYER } : null,
                              )}
                            />
                            표정·모프 레이어
                          </label>
                          <span className="text-[0.68rem] tabular-nums text-fg-3">
                            {selectedModelMorphTargets.length}개 타깃
                          </span>
                        </div>

                        {selectedCustomModel.morph && selectedModelMorphTargets.length > 0 ? (
                          <div className="space-y-2 border-t border-line/70 pt-2">
                            <div className="grid grid-cols-[1fr_auto] gap-2">
                              <select
                                aria-label="모프 타깃"
                                className="h-8 min-w-0 rounded-lg border border-line bg-panel px-2 text-xs text-fg"
                                value={selectedMorphTargetKey}
                                onChange={(event) => setMorphTargetSelection({
                                  modelId: selectedCustomModel.id,
                                  key: event.target.value,
                                })}
                              >
                                {selectedModelMorphTargets.map((target) => (
                                  <option key={target.key} value={target.key}>
                                    {target.name} · M{target.meshIndex + 1}/T{target.targetIndex + 1}
                                  </option>
                                ))}
                              </select>
                              <button
                                type="button"
                                className="h-8 rounded-lg border border-line bg-panel px-2 text-[0.68rem] font-semibold text-fg-2 hover:bg-raised disabled:opacity-50"
                                disabled={!selectedMorphOverride}
                                onClick={() => updateCustomModelMorph(
                                  selectedCustomModel.id,
                                  (current) => ({
                                    ...current,
                                    targets: current.targets.filter((target) => target.targetKey !== selectedMorphTargetKey),
                                  }),
                                )}
                              >
                                타깃 초기화
                              </button>
                            </div>
                            <label className="grid grid-cols-[4.5rem_1fr_3rem] items-center gap-2 text-[0.68rem] text-fg-3">
                              오프셋
                              <input
                                type="range"
                                min="-1"
                                max="1"
                                step="0.01"
                                value={selectedMorphOverride?.weightOffset ?? 0}
                                onChange={(event) => updateCustomModelMorph(
                                  selectedCustomModel.id,
                                  (current) => ({
                                    ...current,
                                    targets: [
                                      ...current.targets.filter((target) => target.targetKey !== selectedMorphTargetKey),
                                      {
                                        targetKey: selectedMorphTargetKey,
                                        weightOffset: Number(event.target.value),
                                      },
                                    ],
                                  }),
                                )}
                              />
                              <span className="text-right tabular-nums text-fg-2">
                                {(selectedMorphOverride?.weightOffset ?? 0).toFixed(2)}
                              </span>
                            </label>
                            <label className="grid grid-cols-[4.5rem_1fr_2.5rem] items-center gap-2 text-[0.68rem] text-fg-3">
                              전체 강도
                              <input
                                type="range"
                                min="0"
                                max="1"
                                step="0.01"
                                value={selectedCustomModel.morph.weight}
                                onChange={(event) => updateCustomModelMorph(
                                  selectedCustomModel.id,
                                  (current) => ({ ...current, weight: Number(event.target.value) }),
                                )}
                              />
                              <span className="text-right tabular-nums text-fg-2">
                                {Math.round(selectedCustomModel.morph.weight * 100)}%
                              </span>
                            </label>
                            <div className="flex items-center justify-between gap-2">
                              <label className="flex items-center gap-1.5 text-[0.68rem] text-fg-2">
                                <input
                                  type="checkbox"
                                  checked={selectedCustomModel.morph.enabled}
                                  onChange={(event) => updateCustomModelMorph(
                                    selectedCustomModel.id,
                                    (current) => ({ ...current, enabled: event.target.checked }),
                                  )}
                                />
                                레이어 적용
                              </label>
                              <button
                                type="button"
                                className="text-[0.68rem] font-semibold text-accent hover:underline"
                                onClick={() => updateCustomModelMorph(
                                  selectedCustomModel.id,
                                  { ...DEFAULT_STUDIO_BG3D_MORPH_LAYER },
                                )}
                              >
                                전체 모프 초기화
                              </button>
                            </div>
                            <p className="text-[0.66rem] leading-relaxed text-fg-3">
                              애니메이션이 만든 모프 값에 오프셋을 더하고 0–1 범위로 제한합니다.
                            </p>
                          </div>
                        ) : (
                          <p className="text-[0.68rem] leading-relaxed text-fg-3">
                            {selectedModelMorphTargets.length > 0
                              ? "활성화하면 표정·립싱크·변형 타깃을 배치별로 조절할 수 있습니다."
                              : "이 모델에는 편집 가능한 모프 타깃이 없습니다."}
                          </p>
                        )}
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs leading-relaxed text-fg-3">도형이나 모델을 추가하거나 뷰포트·레이어 목록에서 선택하면 여기서 위치·회전·크기를 정확한 수치로 조정할 수 있습니다.</p>
                  )}
                </div>
              </section>
  );
}
