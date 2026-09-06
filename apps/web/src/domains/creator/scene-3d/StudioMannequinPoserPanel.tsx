/**
 * Studio 3D 데생 인형 포저 패널.
 *
 * 클립스튜디오 데생 인형처럼 외부 모델 파일 없이 절차 생성 마네킹을 체형·포즈·관절·카메라
 * 4개 섹션으로 다루고, 결과를 PNG data URL 로 캔버스에 삽입한다(onInsert 콜백).
 *
 * 확장 지원:
 * - 11가지 다양 체형 프리셋 & 6가지 표면 재질 스타일(목조, 클레이, 와이어프레임, 셀 셰이딩 등).
 * - 카테고리별 다채로운 3D 포즈 프리셋 라이브러리 (기본, 액션, 일상, 스포츠, 웹툰 연출).
 * - 데생 인형 JSON 파일 내보내기/가져오기 & 공유 해시 URL 복사.
 * - 카메라/사진 동작 인식 트래킹 플랜 연동.
 * - 6종 카메라 앵글 프리셋 (정면, 측면, 후면, 탑뷰, 하이앵글, 로우앵글).
 */

import {
  AlertTriangle,
  Camera,
  Check,
  Download,
  FlipHorizontal2,
  ImageIcon,
  Loader2,
  PersonStanding,
  RotateCcw,
  Share2,
  Sliders,
  Upload,
  UserRound,
  Video,
  Wand2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { confirmStudioDestructiveAction } from "../studio-destructive-action-preview";
import { studioDiscardUnpersistedMannequinStateRequest } from "../studio-destructive-command-catalog";
import {
  StudioPanelChip,
  StudioSectionHeader,
  StudioSliderRow,
  StudioToggleChip,
  studioSegmentChipClass,
} from "../studio-panel-ui";
import { copyStudioText } from "../studio-workbench-clipboard";
import {
  StudioVrmPhotoPoseScanner,
  type StudioVrmPhotoPoseApplyPayload,
} from "../vrm/StudioVrmPhotoPoseScanner";

import { getProductStudioMannequinStateSqliteRepository } from "./studio-mannequin-bg3d-preset-sqlite-repository";
import {
  STUDIO_MANNEQUIN_BODY_PRESETS,
  STUDIO_MANNEQUIN_DEFAULT_BODY_PARAMS,
  STUDIO_MANNEQUIN_HEAD_PARAM_RANGES,
  STUDIO_MANNEQUIN_HEAD_PRESETS,
  STUDIO_MANNEQUIN_JOINT_IDS,
  STUDIO_MANNEQUIN_JOINT_LABELS,
  STUDIO_MANNEQUIN_MATERIAL_STYLES,
  STUDIO_MANNEQUIN_PARAM_RANGES,
  buildStudioMannequinSpec,
  clampStudioMannequinBodyParams,
  clampStudioMannequinJointRotation,
  getStudioMannequinJointLimit,
  type StudioMannequinBodyParams,
  type StudioMannequinBodyPresetId,
  type StudioMannequinCoreParamKey,
  type StudioMannequinHeadParamKey,
  type StudioMannequinHeadPresetId,
  type StudioMannequinJointId,
  type StudioMannequinMaterialStyle,
  type StudioMannequinVec3,
} from "./studio-mannequin-model";
import { createStudioMannequinPhotoPoseApplyPlan } from "./studio-mannequin-photo-pose-apply";
import {
  STUDIO_MANNEQUIN_POSE_CATEGORIES,
  STUDIO_MANNEQUIN_POSE_PRESETS,
  createStudioMannequinRestPose,
  encodeStudioMannequinShareHash,
  exportStudioMannequinStateToJSON,
  importStudioMannequinStateFromJSON,
  mirrorStudioMannequinPose,
  normalizeStudioMannequinPose,
  type StudioMannequinPose,
  type StudioMannequinPoseCategory,
} from "./studio-mannequin-poses";
import {
  createStudioMannequinScene,
  type StudioMannequinCaptureResult,
  type StudioMannequinProjection,
  type StudioMannequinSceneHandle,
} from "./studio-mannequin-scene";
import {
  disposeStudioMannequinPoseLandmarker,
  getStudioMannequinWebcamErrorMessage,
  initStudioMannequinPoseLandmarker,
  isStudioMannequinWebcamAbortError,
  requestStudioMannequinCameraStream,
  solvePoseToMannequinJoints,
  stopStudioMannequinMediaStream,
  smoothMannequinJointRotations,
  type StudioMannequinPoseLandmarker,
  type StudioMannequinWebcamErrorStage,
} from "./studio-mannequin-webcam-tracking";
import {
  buildShaperLayeredPsd,
  SHAPER_MANNEQUIN_SUPPORTED_CATEGORIES,
  type ShaperPresetSelection,
} from "./studio-shaper-model";
import { StudioShaperPanel } from "./StudioShaperPanel";

import type { ReactElement } from "react";

import { buttonClass } from "@/shared/components/ui/button-utils";
import { cn } from "@/shared/lib/utils";

export type { StudioMannequinCaptureResult } from "./studio-mannequin-scene";

export interface StudioMannequinPoserPanelProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onInsert: (result: StudioMannequinCaptureResult) => Promise<boolean | void> | boolean | void;
}

type MannequinTabId = "shaper" | "body" | "pose" | "joint" | "camera";
type StudioMannequinWebcamLoadingStage = "engine" | "camera" | null;
type StudioMannequinPersistenceStatus =
  | "idle"
  | "loading"
  | "ready"
  | "saving"
  | "memory-only";

interface StudioMannequinPhotoPoseUndoEntry {
  readonly before: StudioMannequinPose;
  readonly after: StudioMannequinPose;
}

interface StudioMannequinPhotoPoseApplyStatus {
  readonly sourceName: string;
  readonly confidencePercent: number;
  readonly appliedJointCount: number;
}

const RAD_TO_DEG = 180 / Math.PI;
const DEG_TO_RAD = Math.PI / 180;
const CAPTURE_SCALES = [1, 2, 3] as const;
const STUDIO_MANNEQUIN_PHOTO_MIN_APPLIED_JOINTS = 6;

const TABS: readonly { id: MannequinTabId; label: string; icon: ReactElement }[] = Object.freeze([
  { id: "shaper", label: "셰이퍼", icon: <Wand2 size={13} aria-hidden /> },
  { id: "body", label: "체형", icon: <UserRound size={13} aria-hidden /> },
  { id: "pose", label: "포즈", icon: <PersonStanding size={13} aria-hidden /> },
  { id: "joint", label: "관절", icon: <Sliders size={13} aria-hidden /> },
  { id: "camera", label: "카메라·캡처", icon: <Camera size={13} aria-hidden /> },
]);

const BODY_SLIDERS: readonly {
  key: StudioMannequinCoreParamKey;
  label: string;
  step: number;
  format: (v: number) => string;
}[] = Object.freeze([
  { key: "heightCm", label: "신장", step: 1, format: (v) => `${Math.round(v)}cm` },
  { key: "headCount", label: "두신 비율", step: 0.1, format: (v) => `${v.toFixed(1)}등신` },
  { key: "shoulderWidth", label: "어깨 너비", step: 0.02, format: (v) => `${Math.round(v * 100)}%` },
  { key: "pelvisWidth", label: "골반 너비", step: 0.02, format: (v) => `${Math.round(v * 100)}%` },
  { key: "armLength", label: "팔 길이", step: 0.02, format: (v) => `${Math.round(v * 100)}%` },
  { key: "legLength", label: "다리 비율", step: 0.02, format: (v) => `${Math.round(v * 100)}%` },
  {
    key: "build",
    label: "체형 블렌드",
    step: 0.1,
    format: (v) => (v < 0.5 ? "마른" : v < 1.5 ? "표준" : v < 2.5 ? "근육" : "통통"),
  },
]);

const HEAD_SLIDERS: readonly {
  key: keyof StudioMannequinBodyParams;
  label: string;
  step: number;
  format: (v: number) => string;
}[] = Object.freeze([
  { key: "faceWidth", label: "턱/얼굴 너비", step: 0.02, format: (v) => `${Math.round(v * 100)}%` },
  { key: "chinLength", label: "턱 길이", step: 0.02, format: (v) => `${Math.round(v * 100)}%` },
  { key: "eyeScale", label: "눈 크기/비율", step: 0.02, format: (v) => `${Math.round(v * 100)}%` },
  { key: "noseHeight", label: "코 높이", step: 0.02, format: (v) => `${Math.round(v * 100)}%` },
]);

function getErrorText(cause: unknown, fallback: string): string {
  if (cause instanceof Error && cause.message.trim()) return cause.message;
  return fallback;
}

function createWebcamPreflightError(name: string, message: string): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

export function StudioMannequinBodySection({
  params,
  materialStyle,
  onParamsChange,
  onApplyPreset,
  onMaterialStyleChange,
}: {
  params: StudioMannequinBodyParams;
  materialStyle: StudioMannequinMaterialStyle;
  onParamsChange: (next: StudioMannequinBodyParams) => void;
  onApplyPreset: (presetId: StudioMannequinBodyPresetId) => void;
  onMaterialStyleChange: (style: StudioMannequinMaterialStyle) => void;
}): ReactElement {
  return (
    <div className="space-y-4">
      <StudioSectionHeader
        title="체형 프리셋"
        description="다양한 등신 비율 및 신장 파라미터를 선택하세요."
      />
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="체형 프리셋">
        {(Object.keys(STUDIO_MANNEQUIN_BODY_PRESETS) as StudioMannequinBodyPresetId[]).map(
          (presetId) => (
            <StudioPanelChip
              key={presetId}
              onClick={() => onApplyPreset(presetId)}
              title={`${STUDIO_MANNEQUIN_BODY_PRESETS[presetId].label} 체형 프리셋 적용`}
            >
              {STUDIO_MANNEQUIN_BODY_PRESETS[presetId].label}
            </StudioPanelChip>
          ),
        )}
      </div>

      <div className="space-y-1.5 pt-1">
        <span className="text-xs font-semibold text-fg-2">재질·표면 스타일</span>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="재질 스타일">
          {STUDIO_MANNEQUIN_MATERIAL_STYLES.map((style) => (
            <StudioToggleChip
              key={style.id}
              active={materialStyle === style.id}
              onClick={() => onMaterialStyleChange(style.id)}
              title={style.desc}
            >
              {style.label}
            </StudioToggleChip>
          ))}
        </div>
      </div>

      <div className="space-y-2 pt-1">
        <span className="text-xs font-semibold text-fg-2">세부 체형 조절</span>
        {BODY_SLIDERS.map(({ key, label, step, format }) => {
          const [min, max] = STUDIO_MANNEQUIN_PARAM_RANGES[key];
          return (
            <StudioSliderRow
              key={key}
              label={label}
              min={min}
              max={max}
              step={step}
              value={params[key]}
              onChange={(next) =>
                onParamsChange(clampStudioMannequinBodyParams({ ...params, [key]: next }))
              }
              readout={format(params[key])}
            />
          );
        })}
      </div>

      <div className="space-y-3 pt-3 border-t border-line/60">
        <StudioSectionHeader
          title="3D 헤드 모델 (Face Proportions)"
          description="CSP 2.0 3D 헤드 모델: 웹툰/애니형, 턱선, 눈, 코 비율을 조절합니다."
        />
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="헤드 프리셋">
          {(Object.keys(STUDIO_MANNEQUIN_HEAD_PRESETS) as StudioMannequinHeadPresetId[]).map(
            (headId) => (
              <StudioPanelChip
                key={headId}
                onClick={() =>
                  onParamsChange(
                    clampStudioMannequinBodyParams({
                      ...params,
                      ...STUDIO_MANNEQUIN_HEAD_PRESETS[headId].params,
                    }),
                  )
                }
                title={`${STUDIO_MANNEQUIN_HEAD_PRESETS[headId].label} 헤드 프리셋 적용`}
              >
                {STUDIO_MANNEQUIN_HEAD_PRESETS[headId].label}
              </StudioPanelChip>
            ),
          )}
        </div>
        <div className="space-y-2">
          {HEAD_SLIDERS.map(({ key, label, step, format }) => {
            const [min, max] =
              STUDIO_MANNEQUIN_HEAD_PARAM_RANGES[key as StudioMannequinHeadParamKey];
            const value = (params[key] as number | undefined) ?? 1.0;
            return (
              <StudioSliderRow
                key={key}
                label={label}
                min={min}
                max={max}
                step={step}
                value={value}
                onChange={(next) =>
                  onParamsChange(
                    clampStudioMannequinBodyParams({ ...params, [key]: next }),
                  )
                }
                readout={format(value)}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function StudioMannequinPoseSection({
  selectedCategory,
  onCategorySelect,
  onApplyPreset,
  onMirror,
  onResetJoints,
}: {
  selectedCategory: StudioMannequinPoseCategory | "all";
  onCategorySelect: (category: StudioMannequinPoseCategory | "all") => void;
  onApplyPreset: (presetId: string) => void;
  onMirror: () => void;
  onResetJoints: () => void;
}): ReactElement {
  const filteredPresets = useMemo(() => {
    if (selectedCategory === "all") return STUDIO_MANNEQUIN_POSE_PRESETS;
    return STUDIO_MANNEQUIN_POSE_PRESETS.filter((p) => p.category === selectedCategory);
  }, [selectedCategory]);

  return (
    <div className="space-y-3">
      <StudioSectionHeader
        title="포즈 라이브러리"
        description="카테고리별 프리셋을 고르고 뷰포트에서 핸들을 드래그해 다듬으세요."
        action={
          <div className="flex gap-1">
            <button
              type="button"
              onClick={onMirror}
              className={buttonClass({ size: "sm", variant: "quiet", className: "gap-1 text-[0.7rem]" })}
              title="포즈 좌우 반전"
            >
              <FlipHorizontal2 size={13} aria-hidden /> 미러
            </button>
            <button
              type="button"
              onClick={onResetJoints}
              className={buttonClass({ size: "sm", variant: "quiet", className: "gap-1 text-[0.7rem]" })}
              title="모든 관절 초기화"
            >
              <RotateCcw size={13} aria-hidden /> 초기화
            </button>
          </div>
        }
      />
      <div className="flex flex-wrap gap-1" role="group" aria-label="포즈 카테고리">
        <StudioToggleChip
          active={selectedCategory === "all"}
          onClick={() => onCategorySelect("all")}
        >
          전체
        </StudioToggleChip>
        {STUDIO_MANNEQUIN_POSE_CATEGORIES.map((cat) => (
          <StudioToggleChip
            key={cat.id}
            active={selectedCategory === cat.id}
            onClick={() => onCategorySelect(cat.id)}
          >
            {cat.label}
          </StudioToggleChip>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-1.5" role="group" aria-label="포즈 프리셋">
        {filteredPresets.map((preset) => (
          <StudioPanelChip
            key={preset.id}
            onClick={() => onApplyPreset(preset.id)}
            title={`${preset.label} 포즈 적용`}
          >
            {preset.label}
          </StudioPanelChip>
        ))}
      </div>
    </div>
  );
}

export function StudioMannequinJointSection({
  selectedJointId,
  rotation,
  onSelectJoint,
  onRotate,
  onResetJoint,
}: {
  selectedJointId: StudioMannequinJointId | null;
  rotation: StudioMannequinVec3;
  onSelectJoint: (jointId: StudioMannequinJointId) => void;
  onRotate: (rotation: StudioMannequinVec3) => void;
  onResetJoint: () => void;
}): ReactElement {
  const jointLimit = selectedJointId ? getStudioMannequinJointLimit(selectedJointId) : null;
  const axes: readonly { axis: 0 | 1 | 2; label: string; range: readonly [number, number] }[] =
    jointLimit
      ? [
          { axis: 0, label: "X 회전", range: jointLimit.x },
          { axis: 1, label: "Y 회전", range: jointLimit.y },
          { axis: 2, label: "Z 회전", range: jointLimit.z },
        ]
      : [];
  return (
    <div className="space-y-3">
      <StudioSectionHeader
        title="관절"
        description="뷰포트에서 몸을 클릭하거나 아래에서 관절을 고르세요. 손·발 핸들 드래그 = IK."
        action={
          selectedJointId ? (
            <button
              type="button"
              onClick={onResetJoint}
              className={buttonClass({ size: "sm", variant: "quiet", className: "gap-1" })}
              title="선택한 관절 회전 초기화"
            >
              <RotateCcw size={13} aria-hidden /> 초기화
            </button>
          ) : undefined
        }
      />
      <label className="flex items-center justify-between gap-2 text-xs text-fg-2">
        관절 선택
        <select
          value={selectedJointId ?? ""}
          onChange={(event) => {
            const next = event.target.value;
            if (next) onSelectJoint(next as StudioMannequinJointId);
          }}
          aria-label="편집할 관절 선택"
          className="h-8 min-w-0 flex-1 rounded-md border border-line bg-card px-2 text-[0.72rem] text-fg outline-none focus:border-accent/60 pointer-coarse:min-h-11"
        >
          <option value="" disabled>
            관절을 선택하세요
          </option>
          {STUDIO_MANNEQUIN_JOINT_IDS.map((jointId) => (
            <option key={jointId} value={jointId}>
              {STUDIO_MANNEQUIN_JOINT_LABELS[jointId]}
            </option>
          ))}
        </select>
      </label>
      {selectedJointId && jointLimit ? (
        <div className="space-y-2">
          {axes.map(({ axis, label, range }) => (
            <StudioSliderRow
              key={axis}
              label={label}
              min={Math.round(range[0] * RAD_TO_DEG)}
              max={Math.round(range[1] * RAD_TO_DEG)}
              step={1}
              value={Math.round(rotation[axis] * RAD_TO_DEG)}
              onChange={(nextDeg) => {
                const next: [number, number, number] = [rotation[0], rotation[1], rotation[2]];
                next[axis] = nextDeg * DEG_TO_RAD;
                onRotate(next);
              }}
              readout={`${Math.round(rotation[axis] * RAD_TO_DEG)}°`}
            />
          ))}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-line/70 bg-card/60 p-3 text-[0.7rem] leading-relaxed text-fg-3">
          선택된 관절이 없습니다. 뷰포트의 마네킹을 클릭하면 해당 부위 관절이 선택됩니다.
        </p>
      )}
    </div>
  );
}

export function StudioMannequinCameraSection({
  projection,
  onProjectionChange,
  captureScale,
  onCaptureScaleChange,
  onCameraPreset,
  onResetCamera,
  onCapture,
  capturing,
  captureDisabled = false,
  webcamActive,
  webcamLoadingStage,
  webcamError,
  onToggleWebcam,
  poseFrozen = false,
  onTogglePoseFreeze,
  mirrorMode = true,
  onToggleMirrorMode,
  fingerTracking = true,
  onToggleFingerTracking,
  facialTracking = true,
  onToggleFacialTracking,
}: {
  projection: StudioMannequinProjection;
  onProjectionChange: (projection: StudioMannequinProjection) => void;
  captureScale: number;
  onCaptureScaleChange: (scale: number) => void;
  onCameraPreset: (preset: "front" | "side" | "back" | "top" | "high" | "low") => void;
  onResetCamera: () => void;
  onCapture: () => void;
  capturing: boolean;
  captureDisabled?: boolean;
  webcamActive: boolean;
  webcamLoadingStage: StudioMannequinWebcamLoadingStage;
  webcamError: string | null;
  onToggleWebcam: () => void;
  poseFrozen?: boolean;
  onTogglePoseFreeze?: () => void;
  mirrorMode?: boolean;
  onToggleMirrorMode?: () => void;
  fingerTracking?: boolean;
  onToggleFingerTracking?: () => void;
  facialTracking?: boolean;
  onToggleFacialTracking?: () => void;
}): ReactElement {
  const webcamLoading = webcamLoadingStage !== null;

  return (
    <div className="space-y-3">
      <StudioSectionHeader
        title="카메라·캡처"
        description="드래그 = 회전, 휠 = 줌, 우클릭 드래그 = 이동."
        action={
          <button
            type="button"
            onClick={onResetCamera}
            className={buttonClass({ size: "sm", variant: "quiet", className: "gap-1" })}
            title="카메라 초기 위치로"
          >
            <RotateCcw size={13} aria-hidden /> 리셋
          </button>
        }
      />
      <div className="space-y-1">
        <span className="text-xs text-fg-2">실시간 웹캠 동작 인식 (Live Motion Tracking)</span>
        <button
          type="button"
          onClick={onToggleWebcam}
          aria-pressed={webcamActive}
          aria-busy={webcamLoading}
          className={buttonClass({
            size: "sm",
            variant: webcamActive ? "solid" : "quiet",
            className: "w-full justify-center gap-1.5",
          })}
        >
          {webcamLoading ? (
            <Loader2 size={13} className="animate-spin" aria-hidden />
          ) : (
            <Video size={13} aria-hidden />
          )}
          {webcamLoading
            ? webcamLoadingStage === "engine"
              ? "엔진 준비 취소"
              : "카메라 연결 취소"
            : webcamActive
              ? "실시간 동작 인식 중지"
              : webcamError
                ? "웹캠 동작 인식 다시 시도"
                : "웹캠 실시간 동작 인식 시작"}
        </button>

        {webcamLoadingStage === "engine" ? (
          <p role="status" className="mt-1 text-[0.7rem] leading-relaxed text-fg-3">
            동작 인식 엔진을 준비하고 있습니다. 처음 실행할 때는 모델을 내려받아 잠시 걸릴 수 있습니다.
          </p>
        ) : webcamLoadingStage === "camera" ? (
          <p role="status" className="mt-1 text-[0.7rem] leading-relaxed text-fg-3">
            엔진 준비 완료. 브라우저의 카메라 권한을 허용해 주세요. 권한 창이 보이지 않으면 주소창의 카메라 아이콘을 확인하세요.
          </p>
        ) : null}

        {webcamActive && (
          <div className="grid grid-cols-2 gap-1 pt-1.5" role="group" aria-label="모션 캡처 옵션">
            <button
              type="button"
              onClick={onTogglePoseFreeze}
              className={buttonClass({
                size: "sm",
                variant: poseFrozen ? "solid" : "quiet",
                className: "text-[0.7rem] justify-center gap-1",
              })}
            >
              {poseFrozen ? "🔒 포즈 고정됨" : "🔓 포즈 고정"}
            </button>
            <button
              type="button"
              onClick={onToggleMirrorMode}
              className={buttonClass({
                size: "sm",
                variant: mirrorMode ? "solid" : "quiet",
                className: "text-[0.7rem] justify-center gap-1",
              })}
            >
              {mirrorMode ? "↔️ 좌우 반전 ON" : "↔️ 좌우 반전"}
            </button>
            <button
              type="button"
              onClick={onToggleFingerTracking}
              className={buttonClass({
                size: "sm",
                variant: fingerTracking ? "solid" : "quiet",
                className: "text-[0.7rem] justify-center gap-1",
              })}
            >
              {fingerTracking ? "🖐️ 손가락 솔버 ON" : "🖐️ 손가락 솔버"}
            </button>
            <button
              type="button"
              onClick={onToggleFacialTracking}
              className={buttonClass({
                size: "sm",
                variant: facialTracking ? "solid" : "quiet",
                className: "text-[0.7rem] justify-center gap-1",
              })}
            >
              {facialTracking ? "😀 표정 맵핑 ON" : "😀 표정 맵핑"}
            </button>
          </div>
        )}

        {webcamError ? (
          <p role="alert" className="mt-1 text-[0.7rem] leading-relaxed text-rose-500">
            {webcamError}
          </p>
        ) : null}
      </div>
      <div className="space-y-1">
        <span className="text-xs text-fg-2">카메라 앵글 프리셋</span>
        <div className="grid grid-cols-3 gap-1" role="group" aria-label="카메라 앵글">
          {[
            { id: "front", label: "정면" },
            { id: "side", label: "측면" },
            { id: "back", label: "후면" },
            { id: "top", label: "탑뷰" },
            { id: "high", label: "하이앵글" },
            { id: "low", label: "로우앵글" },
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onCameraPreset(item.id as "front" | "side" | "back" | "top" | "high" | "low")}
              className={buttonClass({ size: "sm", variant: "quiet", className: "text-[0.7rem]" })}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="투영 방식">
        <StudioToggleChip
          active={projection === "perspective"}
          onClick={() => onProjectionChange("perspective")}
        >
          원근
        </StudioToggleChip>
        <StudioToggleChip
          active={projection === "orthographic"}
          onClick={() => onProjectionChange("orthographic")}
        >
          직교
        </StudioToggleChip>
      </div>
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="캡처 배율">
        <span className="text-xs text-fg-2">캡처 배율</span>
        {CAPTURE_SCALES.map((scale) => (
          <StudioToggleChip
            key={scale}
            active={captureScale === scale}
            onClick={() => onCaptureScaleChange(scale)}
          >
            {scale}x
          </StudioToggleChip>
        ))}
      </div>
      <button
        type="button"
        onClick={onCapture}
        disabled={capturing || captureDisabled}
        title={captureDisabled ? "SQLite 저장 상태를 확인한 뒤 캡처할 수 있습니다." : undefined}
        className={buttonClass({ size: "md", variant: "solid", className: "w-full gap-1.5" })}
      >
        {capturing ? (
          <Loader2 size={15} className="animate-spin" aria-hidden />
        ) : (
          <Camera size={15} aria-hidden />
        )}
        캔버스로 캡처
      </button>
    </div>
  );
}

// ── 패널 본체 ────────────────────────────────────────────────────────────────

export function StudioMannequinPoserPanel({
  open,
  onClose,
  onInsert,
}: StudioMannequinPoserPanelProps): ReactElement | null {
  const dialogTitleId = useId();
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<StudioMannequinSceneHandle | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [stateRepository] = useState(getProductStudioMannequinStateSqliteRepository);

  const [params, setParams] = useState<StudioMannequinBodyParams>(
    STUDIO_MANNEQUIN_DEFAULT_BODY_PARAMS,
  );
  const [pose, setPose] = useState<StudioMannequinPose>(createStudioMannequinRestPose);
  const [materialStyle, setMaterialStyle] = useState<StudioMannequinMaterialStyle>("wood");
  const [poseCategory, setPoseCategory] = useState<StudioMannequinPoseCategory | "all">("all");
  const [tab, setTab] = useState<MannequinTabId>("pose");
  const [selectedJointId, setSelectedJointId] = useState<StudioMannequinJointId | null>(null);
  const [projection, setProjection] = useState<StudioMannequinProjection>("perspective");
  const [captureScale, setCaptureScale] = useState<number>(2);
  const [capturing, setCapturing] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sceneError, setSceneError] = useState<string | null>(null);
  const [persistenceStatus, setPersistenceStatus] =
    useState<StudioMannequinPersistenceStatus>("idle");
  const [photoPoseUndoEntry, setPhotoPoseUndoEntry] =
    useState<StudioMannequinPhotoPoseUndoEntry | null>(null);
  const [photoPoseApplyStatus, setPhotoPoseApplyStatus] =
    useState<StudioMannequinPhotoPoseApplyStatus | null>(null);

  const [webcamActive, setWebcamActive] = useState(false);
  const [webcamLoadingStage, setWebcamLoadingStage] =
    useState<StudioMannequinWebcamLoadingStage>(null);
  const [webcamError, setWebcamError] = useState<string | null>(null);
  const [poseFrozen, setPoseFrozen] = useState(false);
  const [mirrorMode, setMirrorMode] = useState(true);
  const [fingerTracking, setFingerTracking] = useState(true);
  const [facialTracking, setFacialTracking] = useState(true);

  const webcamVideoRef = useRef<HTMLVideoElement | null>(null);
  const webcamStreamRef = useRef<MediaStream | null>(null);
  const webcamLandmarkerRef = useRef<StudioMannequinPoseLandmarker | null>(null);
  const webcamFrameRef = useRef<number | null>(null);
  const webcamAbortControllerRef = useRef<AbortController | null>(null);
  const webcamSessionRef = useRef(0);
  const webcamActiveRef = useRef(false);
  const webcamLoadingRef = useRef(false);
  const poseFrozenRef = useRef(false);
  const mirrorModeRef = useRef(true);
  const mountedRef = useRef(false);
  const hydrationGenerationRef = useRef(0);
  const hydrationSafeForFinalFlushRef = useRef(false);
  const persistenceGenerationRef = useRef(0);
  const stateRevisionRef = useRef(0);
  const poseRef = useRef(pose);
  const stateRef = useRef({ params, pose });
  stateRef.current = { params, pose };
  const webcamLoading = webcamLoadingStage !== null;
  webcamActiveRef.current = webcamActive;
  webcamLoadingRef.current = webcamLoading;
  poseFrozenRef.current = poseFrozen;
  mirrorModeRef.current = mirrorMode;

  const commitParams = useCallback((nextParams: StudioMannequinBodyParams) => {
    stateRevisionRef.current += 1;
    stateRef.current = { ...stateRef.current, params: nextParams };
    setParams(nextParams);
  }, []);

  const commitPose = useCallback((nextPose: StudioMannequinPose) => {
    stateRevisionRef.current += 1;
    poseRef.current = nextPose;
    stateRef.current = { ...stateRef.current, pose: nextPose };
    setPose(nextPose);
  }, []);

  const releaseWebcamResources = useCallback(() => {
    webcamSessionRef.current += 1;
    webcamActiveRef.current = false;
    webcamLoadingRef.current = false;

    webcamAbortControllerRef.current?.abort();
    webcamAbortControllerRef.current = null;

    if (webcamFrameRef.current !== null) {
      cancelAnimationFrame(webcamFrameRef.current);
      webcamFrameRef.current = null;
    }

    const video = webcamVideoRef.current;
    if (video) {
      try {
        video.pause();
      } catch {
        // Some embedded browsers do not expose pause() until metadata has loaded.
      }
      video.srcObject = null;
    }

    const stream = webcamStreamRef.current;
    webcamStreamRef.current = null;
    if (stream) stopStudioMannequinMediaStream(stream);

    webcamLandmarkerRef.current = null;
    disposeStudioMannequinPoseLandmarker();
  }, []);

  const stopWebcam = useCallback(() => {
    releaseWebcamResources();
    setWebcamActive(false);
    setWebcamLoadingStage(null);
    setWebcamError(null);
  }, [releaseWebcamResources]);

  const handleToggleWebcam = useCallback(async () => {
    if (webcamActiveRef.current || webcamLoadingRef.current) {
      stopWebcam();
      return;
    }

    const session = webcamSessionRef.current + 1;
    webcamSessionRef.current = session;
    const abortController = new AbortController();
    webcamAbortControllerRef.current = abortController;
    webcamLoadingRef.current = true;
    let failureStage: StudioMannequinWebcamErrorStage = "camera";

    try {
      setWebcamLoadingStage("engine");
      setWebcamError(null);

      if (window.isSecureContext === false) {
        throw createWebcamPreflightError(
          "StudioMannequinInsecureContextError",
          "Camera access requires a secure context.",
        );
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        throw createWebcamPreflightError(
          "StudioMannequinCameraUnavailableError",
          "navigator.mediaDevices.getUserMedia is unavailable.",
        );
      }

      failureStage = "engine";
      const landmarker = await initStudioMannequinPoseLandmarker({
        signal: abortController.signal,
      });
      if (webcamSessionRef.current !== session || abortController.signal.aborted) return;

      failureStage = "camera";
      setWebcamLoadingStage("camera");
      const stream = await requestStudioMannequinCameraStream(
        () => navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            width: { ideal: 640 },
            height: { ideal: 480 },
            facingMode: { ideal: "user" },
          },
        }),
        { signal: abortController.signal },
      );
      if (webcamSessionRef.current !== session || abortController.signal.aborted) {
        stopStudioMannequinMediaStream(stream);
        return;
      }

      webcamStreamRef.current = stream;
      const video = webcamVideoRef.current;
      if (!video) {
        throw createWebcamPreflightError(
          "StudioMannequinCameraUnavailableError",
          "The webcam preview element is unavailable.",
        );
      }

      video.srcObject = stream;
      await video.play();
      if (webcamSessionRef.current !== session || abortController.signal.aborted) {
        stopStudioMannequinMediaStream(stream);
        video.srcObject = null;
        return;
      }

      webcamLandmarkerRef.current = landmarker;
      webcamActiveRef.current = true;
      webcamLoadingRef.current = false;
      setWebcamLoadingStage(null);
      setWebcamActive(true);
    } catch (cause) {
      if (
        webcamSessionRef.current !== session
        || abortController.signal.aborted
        || isStudioMannequinWebcamAbortError(cause)
      ) {
        return;
      }

      console.warn(`Studio mannequin webcam ${failureStage} initialization failed:`, cause);
      releaseWebcamResources();
      setWebcamActive(false);
      setWebcamLoadingStage(null);
      setWebcamError(getStudioMannequinWebcamErrorMessage(failureStage, cause));
    } finally {
      if (webcamSessionRef.current === session) {
        webcamLoadingRef.current = false;
        setWebcamLoadingStage(null);
      }
    }
  }, [releaseWebcamResources, stopWebcam]);

  useEffect(() => {
    if (!open) stopWebcam();
  }, [open, stopWebcam]);

  useEffect(() => () => releaseWebcamResources(), [releaseWebcamResources]);

  poseRef.current = pose;

  useEffect(() => {
    if (!photoPoseUndoEntry || pose === photoPoseUndoEntry.after) return;
    setPhotoPoseUndoEntry(null);
    setPhotoPoseApplyStatus(null);
  }, [photoPoseUndoEntry, pose]);

  useEffect(() => {
    if (!webcamActive) return;
    let lastVideoTime = -1;

    const loop = () => {
      if (!webcamActiveRef.current) return;
      try {
        const video = webcamVideoRef.current;
        const landmarker = webcamLandmarkerRef.current;
        if (
          !poseFrozenRef.current
          && video
          && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
          && video.currentTime !== lastVideoTime
          && landmarker
        ) {
          lastVideoTime = video.currentTime;
          const detection = landmarker.detectForVideo(video, performance.now());
          try {
            if (detection.landmarks && detection.landmarks[0]) {
              const rawJoints = solvePoseToMannequinJoints(detection.landmarks[0], {
                mirrorMode: mirrorModeRef.current,
                smoothing: 0.35,
              });
              const smoothedJoints = smoothMannequinJointRotations(
                poseRef.current.joints,
                rawJoints,
                0.35,
              );
              const updatedPose: StudioMannequinPose = {
                ...poseRef.current,
                joints: {
                  ...poseRef.current.joints,
                  ...smoothedJoints,
                },
              };
              commitPose(updatedPose);
              sceneRef.current?.setPose(updatedPose);
            }
          } finally {
            detection.close?.();
          }
        }
      } catch (cause) {
        console.warn("Studio mannequin webcam frame analysis failed:", cause);
        releaseWebcamResources();
        setWebcamActive(false);
        setWebcamLoadingStage(null);
        setWebcamError(getStudioMannequinWebcamErrorMessage("tracking", cause));
        return;
      }

      webcamFrameRef.current = requestAnimationFrame(loop);
    };
    webcamFrameRef.current = requestAnimationFrame(loop);

    return () => {
      if (webcamFrameRef.current !== null) {
        cancelAnimationFrame(webcamFrameRef.current);
        webcamFrameRef.current = null;
      }
    };
  }, [commitPose, releaseWebcamResources, webcamActive]);

  const spec = useMemo(() => buildStudioMannequinSpec(params), [params]);

  const poseFromSceneRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      // Route/access transitions can unmount this panel without calling closeWithPersist().
      // Queue the latest canonical state before invalidating UI generations. The SQLite
      // repository serializes writes, so this also safely follows an in-flight explicit save.
      // There is no browser-KV/memory fallback: a failed late flush remains an observable
      // repository failure in diagnostics, while the component is already gone and cannot
      // truthfully present a retry UI.
      if (hydrationSafeForFinalFlushRef.current) {
        void stateRepository.save(stateRef.current).catch((cause: unknown) => {
          console.warn("Studio mannequin final SQLite flush failed:", cause);
        });
      }
      mountedRef.current = false;
      hydrationGenerationRef.current += 1;
      persistenceGenerationRef.current += 1;
    };
  }, [stateRepository]);

  const persistState = useCallback(async (): Promise<boolean> => {
    // A save is only authoritative after the prior durable snapshot has been read. Saving while
    // hydration is pending (or after it failed) could replace an unknown existing snapshot with
    // the component's initial defaults.
    if (!hydrationSafeForFinalFlushRef.current) {
      setError(
        persistenceStatus === "memory-only"
          ? "기존 SQLite 상태를 확인하지 못해 저장하거나 닫을 수 없습니다. JSON으로 내보낸 뒤 다시 열어 주세요."
          : "기존 SQLite 상태를 불러오는 중입니다. 완료된 뒤 다시 시도해 주세요.",
      );
      return false;
    }
    const generation = persistenceGenerationRef.current + 1;
    persistenceGenerationRef.current = generation;
    setPersistenceStatus("saving");
    try {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const revision = stateRevisionRef.current;
        await stateRepository.save(stateRef.current);
        if (!mountedRef.current || persistenceGenerationRef.current !== generation) return false;
        if (stateRevisionRef.current === revision) {
          setPersistenceStatus("ready");
          setError(null);
          return true;
        }
      }
      throw new Error("저장 중 포즈가 계속 변경되어 안정된 스냅샷을 만들지 못했습니다.");
    } catch (cause) {
      if (mountedRef.current && persistenceGenerationRef.current === generation) {
        setPersistenceStatus("memory-only");
        setError(
          `SQLite/OPFS에 데생 인형 상태를 저장하지 못했습니다. 현재 탭 메모리 임시 · 새로고침 시 사라짐. JSON 내보내기로 보존한 뒤 다시 닫아 주세요: ${getErrorText(cause, "저장소 오류")}`,
        );
      }
      return false;
    }
  }, [persistenceStatus, stateRepository]);

  const closeWithPersist = useCallback(() => {
    if (!hydrationSafeForFinalFlushRef.current) {
      setError(
        persistenceStatus === "memory-only"
          ? "기존 SQLite 상태를 확인하지 못해 닫기 저장을 수행할 수 없습니다. JSON으로 내보낸 뒤 다시 열어 주세요."
          : "기존 SQLite 상태를 불러오는 중입니다. 완료된 뒤 다시 닫아 주세요.",
      );
      return;
    }
    releaseWebcamResources();
    setWebcamActive(false);
    setWebcamLoadingStage(null);
    void persistState().then((saved) => {
      if (saved && mountedRef.current) onClose();
    });
  }, [onClose, persistState, persistenceStatus, releaseWebcamResources]);

  const closeWithoutPersist = useCallback(async () => {
    if (!(await confirmStudioDestructiveAction(
      studioDiscardUnpersistedMannequinStateRequest(),
    )) || !mountedRef.current) return;
    releaseWebcamResources();
    setWebcamActive(false);
    setWebcamLoadingStage(null);
    onClose();
  }, [onClose, releaseWebcamResources]);

  useEffect(() => {
    if (!open) return;
    const generation = hydrationGenerationRef.current + 1;
    hydrationGenerationRef.current = generation;
    hydrationSafeForFinalFlushRef.current = false;
    const startingRevision = stateRevisionRef.current;
    let active = true;
    setPersistenceStatus("loading");
    setError(null);
    void stateRepository.load().then((stored) => {
      if (
        !active ||
        !mountedRef.current ||
        hydrationGenerationRef.current !== generation
      ) {
        return;
      }
      // A real edit made while the read was pending is newer than the loaded snapshot. Keep the
      // edited state, but mark it safe to flush because the prior durable read completed first.
      if (stateRevisionRef.current !== startingRevision) {
        hydrationSafeForFinalFlushRef.current = true;
        setPersistenceStatus("ready");
        return;
      }
      if (stored) {
        // React may unmount in the same turn before these state updates commit. Advance the
        // synchronous flush authority first so final cleanup can never write initial defaults
        // over the durable snapshot that just finished loading.
        stateRef.current = stored;
        poseRef.current = stored.pose;
        setParams(stored.params);
        setPose(stored.pose);
      }
      hydrationSafeForFinalFlushRef.current = true;
      setPersistenceStatus("ready");
    }).catch((cause: unknown) => {
      if (!active || !mountedRef.current || hydrationGenerationRef.current !== generation) return;
      setPersistenceStatus("memory-only");
      setError(
        `SQLite/OPFS에서 데생 인형 상태를 불러오지 못해 기본값을 현재 탭 메모리에만 유지합니다. 현재 탭 메모리 임시 · 새로고침 시 사라짐: ${getErrorText(cause, "저장소 오류")}`,
      );
    });
    return () => {
      active = false;
      if (hydrationGenerationRef.current === generation) {
        hydrationGenerationRef.current += 1;
      }
    };
  }, [open, stateRepository]);

  useEffect(() => {
    if (!open) return;
    const container = viewportRef.current;
    if (!container) return;

    let handle: StudioMannequinSceneHandle;
    try {
      handle = createStudioMannequinScene({
        container,
        initialSpec: buildStudioMannequinSpec(stateRef.current.params),
        initialPose: stateRef.current.pose,
        onSelectJoint: (jointId) => setSelectedJointId(jointId),
        onPoseEdited: (editedPose) => {
          poseFromSceneRef.current = true;
          commitPose(editedPose);
        },
      });
      sceneRef.current = handle;
      setSceneError(null);
    } catch (cause) {
      setSceneError(getErrorText(cause, "3D 데생 인형 씬을 초기화하지 못했습니다. WebGL 지원을 확인하세요."));
      return;
    }

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      handle.resize(width, height);
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      sceneRef.current = null;
      handle.dispose();
    };
  }, [commitPose, open]);

  useEffect(() => {
    sceneRef.current?.setBodySpec(spec);
  }, [spec]);

  useEffect(() => {
    if (poseFromSceneRef.current) {
      poseFromSceneRef.current = false;
      return;
    }
    sceneRef.current?.setPose(pose);
  }, [pose]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || capturing || persistenceStatus !== "ready") return;
      event.preventDefault();
      closeWithPersist();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, capturing, closeWithPersist, persistenceStatus]);

  const applyPosePreset = useCallback((presetId: string) => {
    const preset = STUDIO_MANNEQUIN_POSE_PRESETS.find((entry) => entry.id === presetId);
    if (preset) commitPose(normalizeStudioMannequinPose(preset.pose));
  }, [commitPose]);

  const handleRotateSelected = useCallback(
    (rotation: StudioMannequinVec3) => {
      if (!selectedJointId) return;
      const clamped = clampStudioMannequinJointRotation(selectedJointId, rotation);
      commitPose(
        normalizeStudioMannequinPose({
          joints: { ...poseRef.current.joints, [selectedJointId]: clamped },
          pelvisOffset: poseRef.current.pelvisOffset,
        }),
      );
    },
    [commitPose, selectedJointId],
  );

  const handleExportJson = useCallback(() => {
    const json = exportStudioMannequinStateToJSON(stateRef.current);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `toonspectrum-mannequin-${Date.now()}.mannequin`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const handleImportJson = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result;
      const imported = importStudioMannequinStateFromJSON(content);
      if (imported) {
        commitParams(imported.params);
        commitPose(imported.pose);
        setError(null);
      } else {
        setError("유효하지 않은 데생 인형 JSON 파일입니다.");
      }
    };
    reader.readAsText(file);
    event.target.value = "";
  }, [commitParams, commitPose]);

  // 인앱 WebView 는 navigator.clipboard 자체를 안 주기도 한다. 그때 프로퍼티 접근이 onClick
  // 안에서 동기 throw 라 에러 바운더리가 3D 패널을 통째로 날렸다. 성공 여부를 기다린 뒤에만
  // "복사됨"을 띄운다 — 링크를 못 받은 사용자에게 받았다고 말하지 않는다.
  const handleCopyShareLink = useCallback(() => {
    const hash = encodeStudioMannequinShareHash(stateRef.current);
    const fullUrl = `${window.location.origin}${window.location.pathname}${hash}`;
    void copyStudioText(fullUrl).then((ok) => {
      if (!ok) return;
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    });
  }, []);

  const handleApplyPhotoPose = useCallback((payload: StudioVrmPhotoPoseApplyPayload): boolean => {
    if (
      payload.confidence.quality === "low"
      || payload.confidence.overall < 0.5
      || payload.confidence.coverage < 0.6
    ) {
      setError("사진 포즈 신뢰도가 낮아 적용하지 않았습니다. 사람이 더 크게 보이는 전신 사진을 선택해 주세요.");
      return false;
    }

    const before = poseRef.current;
    const plan = createStudioMannequinPhotoPoseApplyPlan({
      currentPose: before,
      mediaPipeLandmarks: payload.worldLandmarks,
      mirrorMode: false,
      minimumVisibility: 0.35,
    });

    if (plan.appliedJoints.length < STUDIO_MANNEQUIN_PHOTO_MIN_APPLIED_JOINTS) {
      setError("사진에서 안전하게 적용할 수 있는 관절이 부족해 기존 포즈를 유지했습니다. 팔·다리가 선명한 전신 사진을 다시 선택해 주세요.");
      return false;
    }

    commitPose(plan.pose);
    setPhotoPoseUndoEntry({ before, after: plan.pose });
    setPhotoPoseApplyStatus({
      sourceName: payload.sourceName,
      confidencePercent: Math.round(payload.confidence.overall * 100),
      appliedJointCount: plan.appliedJoints.length,
    });
    setError(null);
    return true;
  }, [commitPose]);

  const handleUndoPhotoPose = useCallback(() => {
    const entry = photoPoseUndoEntry;
    if (!entry || poseRef.current !== entry.after) {
      setPhotoPoseUndoEntry(null);
      setPhotoPoseApplyStatus(null);
      return;
    }
    commitPose(entry.before);
    setPhotoPoseUndoEntry(null);
    setPhotoPoseApplyStatus(null);
    setError(null);
  }, [commitPose, photoPoseUndoEntry]);

  const handleShaperSelectionChange = useCallback((sel: ShaperPresetSelection) => {
    let nextParams = { ...params };
    if (sel.body === "body-chibi") {
      nextParams = { ...nextParams, headCount: 3.5, heightCm: 120, shoulderWidth: 0.8, pelvisWidth: 0.8 };
    } else if (sel.body === "body-tall") {
      nextParams = { ...nextParams, headCount: 8.5, heightCm: 188, shoulderWidth: 1.15, legLength: 1.15 };
    } else if (sel.body === "body-muscular") {
      nextParams = { ...nextParams, headCount: 7.8, heightCm: 184, shoulderWidth: 1.25, build: 2.5 };
    } else if (sel.body === "body-slim-female") {
      nextParams = { ...nextParams, headCount: 7.2, heightCm: 162, shoulderWidth: 0.92, pelvisWidth: 1.05, build: 0.8 };
    } else if (sel.body === "body-slim-male") {
      nextParams = { ...nextParams, headCount: 7.6, heightCm: 176, shoulderWidth: 1.08, pelvisWidth: 0.95, build: 0.9 };
    }

    if (sel.face === "face-sharp") {
      nextParams = { ...nextParams, ...STUDIO_MANNEQUIN_HEAD_PRESETS.sharp.params };
    } else if (sel.face === "face-round") {
      nextParams = { ...nextParams, ...STUDIO_MANNEQUIN_HEAD_PRESETS.round.params };
    } else if (sel.face === "face-square") {
      nextParams = { ...nextParams, faceWidth: 1.15, chinLength: 1.05, eyeScale: 1.0, noseHeight: 1.1 };
    } else if (sel.face === "face-chibi") {
      nextParams = { ...nextParams, ...STUDIO_MANNEQUIN_HEAD_PRESETS.chibi.params };
    } else if (sel.face === "face-oval") {
      nextParams = { ...nextParams, ...STUDIO_MANNEQUIN_HEAD_PRESETS.anime.params };
    }

    if (sel.eye === "eye-romance") {
      nextParams = { ...nextParams, eyeScale: 1.16 };
    } else if (sel.eye === "eye-gentle") {
      nextParams = { ...nextParams, eyeScale: 1.08 };
    } else if (sel.eye === "eye-action") {
      nextParams = { ...nextParams, eyeScale: 0.96 };
    } else if (sel.eye === "eye-cat") {
      nextParams = { ...nextParams, eyeScale: 1.04 };
    }

    if (sel.nose === "nose-dot") {
      nextParams = { ...nextParams, noseHeight: 0.84 };
    } else if (sel.nose === "nose-straight") {
      nextParams = { ...nextParams, noseHeight: 1.04 };
    } else if (sel.nose === "nose-bridge") {
      nextParams = { ...nextParams, noseHeight: 1.14 };
    }
    commitParams(nextParams);

    if (sel.bodypose === "pose-stand") {
      commitPose(createStudioMannequinRestPose());
    } else if (sel.bodypose === "pose-run") {
      applyPosePreset("dash");
    } else if (sel.bodypose === "pose-sit") {
      applyPosePreset("sit-chair");
    } else if (sel.bodypose === "pose-hip") {
      applyPosePreset("cross-arms");
    } else if (sel.bodypose === "pose-sword") {
      applyPosePreset("sword-ready");
    }

    if (sel.handpose) applyPosePreset(sel.handpose);
  }, [applyPosePreset, commitParams, commitPose, params]);

  const handleExportPsdFromScene = useCallback(async () => {
    const handle = sceneRef.current;
    if (!handle) return;
    try {
      setCapturing(true);
      const result = await handle.captureDataUrl(2);
      const img = new Image();
      img.crossOrigin = "anonymous";
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = reject;
        img.src = result.pngDataUrl;
      });

      const offCanvas = document.createElement("canvas");
      offCanvas.width = result.width;
      offCanvas.height = result.height;
      const ctx = offCanvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(img, 0, 0);
      const imgData = ctx.getImageData(0, 0, result.width, result.height);
      const beauty = new Uint8ClampedArray(imgData.data);
      const flatColor = new Uint8ClampedArray(beauty.length);
      const shadowCel = new Uint8ClampedArray(beauty.length);
      const highlights = new Uint8ClampedArray(beauty.length);
      const lineArt = new Uint8ClampedArray(beauty.length);
      const w = result.width;
      const h = result.height;
      const luminanceAt = (pixelIndex: number) => (
        beauty[pixelIndex] * 0.2126
        + beauty[pixelIndex + 1] * 0.7152
        + beauty[pixelIndex + 2] * 0.0722
      );

      for (let y = 0; y < h; y += 1) {
        for (let x = 0; x < w; x += 1) {
          const idx = (y * w + x) * 4;
          const alpha = beauty[idx + 3];
          if (alpha <= 4) continue;
          const red = beauty[idx];
          const green = beauty[idx + 1];
          const blue = beauty[idx + 2];
          const maximum = Math.max(red, green, blue, 1);
          const normalize = Math.min(1.45, Math.max(0.72, 190 / maximum));
          flatColor[idx] = Math.min(255, Math.round(red * normalize));
          flatColor[idx + 1] = Math.min(255, Math.round(green * normalize));
          flatColor[idx + 2] = Math.min(255, Math.round(blue * normalize));
          flatColor[idx + 3] = alpha;

          const luminance = luminanceAt(idx);
          const shadowAmount = Math.min(1, Math.max(0, (172 - luminance) / 105));
          shadowCel[idx] = 48;
          shadowCel[idx + 1] = 36;
          shadowCel[idx + 2] = 52;
          shadowCel[idx + 3] = Math.round(alpha * shadowAmount * 0.76);

          const highlightAmount = Math.min(1, Math.max(0, (luminance - 188) / 67));
          highlights[idx] = 255;
          highlights[idx + 1] = 241;
          highlights[idx + 2] = 219;
          highlights[idx + 3] = Math.round(alpha * highlightAmount * 0.58);
        }
      }

      for (let y = 1; y < h - 1; y += 1) {
        for (let x = 1; x < w - 1; x += 1) {
          const idx = (y * w + x) * 4;
          const alpha = beauty[idx + 3];
          if (alpha <= 20) continue;
          const left = idx - 4;
          const right = idx + 4;
          const up = idx - w * 4;
          const down = idx + w * 4;
          const boundary = Math.max(
            Math.abs(alpha - beauty[left + 3]),
            Math.abs(alpha - beauty[right + 3]),
            Math.abs(alpha - beauty[up + 3]),
            Math.abs(alpha - beauty[down + 3]),
          );
          const formEdge = Math.abs(luminanceAt(left) - luminanceAt(right))
            + Math.abs(luminanceAt(up) - luminanceAt(down));
          const lineAlpha = Math.min(255, Math.round(boundary * 1.4 + Math.max(0, formEdge - 46) * 2.1));
          if (lineAlpha <= 18) continue;
          lineArt[idx] = 24;
          lineArt[idx + 1] = 20;
          lineArt[idx + 2] = 28;
          lineArt[idx + 3] = lineAlpha;
        }
      }

      const psdBlob = buildShaperLayeredPsd({
        width: result.width,
        height: result.height,
        flatColor,
        shadowCel,
        highlights,
        lineArt,
      });

      const url = URL.createObjectURL(psdBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `shaper-webtoon-${Date.now()}.psd`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(getErrorText(cause, "PSD 내보내기를 실패했습니다."));
    } finally {
      setCapturing(false);
    }
  }, []);

  const handleCapture = useCallback(() => {
    const handle = sceneRef.current;
    if (!handle || capturing) return;
    if (!hydrationSafeForFinalFlushRef.current) {
      setError(
        persistenceStatus === "memory-only"
          ? "기존 SQLite 상태를 확인하지 못해 캡처를 삽입할 수 없습니다. JSON으로 내보낸 뒤 다시 열어 주세요."
          : "기존 SQLite 상태를 불러오는 중입니다. 완료된 뒤 다시 캡처해 주세요.",
      );
      return;
    }
    setCapturing(true);
    setError(null);
    void (async () => {
      try {
        const result = await handle.captureDataUrl(captureScale);
        const accepted = await onInsert(result);
        if (accepted === false) {
          throw new Error("편집 중 문서가 바뀌어 캡처를 삽입하지 않았습니다. 현재 페이지에서 다시 시도해 주세요.");
        }
        if (await persistState()) onClose();
      } catch (cause) {
        setError(getErrorText(cause, "3D 데생 인형 캡처를 추가하지 못했습니다."));
      } finally {
        setCapturing(false);
      }
    })();
  }, [captureScale, capturing, onClose, onInsert, persistState, persistenceStatus]);

  if (!open) return null;

  const selectedRotation: StudioMannequinVec3 = selectedJointId
    ? pose.joints[selectedJointId] ?? [0, 0, 0]
    : [0, 0, 0];

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={dialogTitleId}
      data-studio-mannequin-dialog="true"
      className="fixed inset-0 z-[80] isolate flex flex-col overflow-hidden overscroll-none bg-[oklch(0.08_0.01_70/0.86)] p-2 text-fg backdrop-blur-sm sm:p-4"
      style={{
        paddingTop: "max(0.5rem, env(safe-area-inset-top))",
        paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))",
      }}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".mannequin,.json"
        className="hidden"
        onChange={handleImportJson}
      />
      <div className="mx-auto flex h-full w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl">
        <header className="flex items-center justify-between gap-2 border-b border-line/70 px-3 py-2">
          <div className="flex items-center gap-2">
            <h2 id={dialogTitleId} className="flex items-center gap-1.5 text-sm font-bold tracking-tight">
              <PersonStanding size={16} className="text-accent" aria-hidden />
              3D 데생 인형
            </h2>
            <span
              aria-live="polite"
              className={cn(
                "hidden text-[0.66rem] sm:inline",
                persistenceStatus === "memory-only" ? "text-warn" : "text-fg-3",
              )}
            >
              {persistenceStatus === "loading"
                ? "SQLite 불러오는 중"
                : persistenceStatus === "saving"
                  ? "SQLite 저장 중"
                  : persistenceStatus === "memory-only"
                    ? "현재 탭 메모리 임시"
                    : ""}
            </span>
            <div className="hidden items-center gap-1 sm:flex">
              <button
                type="button"
                onClick={handleExportJson}
                className={buttonClass({ size: "sm", variant: "quiet", className: "gap-1 text-[0.7rem]" })}
                title="포즈 및 체형 JSON 다운로드"
              >
                <Download size={13} aria-hidden /> 내보내기
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className={buttonClass({ size: "sm", variant: "quiet", className: "gap-1 text-[0.7rem]" })}
                title="JSON 포즈 파일 불러오기"
              >
                <Upload size={13} aria-hidden /> 가져오기
              </button>
              <button
                type="button"
                onClick={handleCopyShareLink}
                className={buttonClass({ size: "sm", variant: "quiet", className: "gap-1 text-[0.7rem]" })}
                title="공유 해시 URL 복사"
              >
                {copiedLink ? <Check size={13} className="text-accent" /> : <Share2 size={13} />}
                공유
              </button>
              <button
                type="button"
                onClick={() => setTab("pose")}
                className={buttonClass({ size: "sm", variant: "quiet", className: "gap-1 text-[0.7rem]" })}
                title="MediaPipe 사진 포즈 스캐너 열기"
              >
                <ImageIcon size={13} aria-hidden /> 사진 포즈
              </button>
            </div>
          </div>
          <button
            type="button"
            onClick={persistenceStatus === "memory-only" ? closeWithoutPersist : closeWithPersist}
            disabled={
              persistenceStatus === "idle"
              || persistenceStatus === "loading"
              || persistenceStatus === "saving"
            }
            title={
              persistenceStatus === "loading" || persistenceStatus === "idle"
                ? "SQLite 상태를 불러온 뒤 닫을 수 있습니다."
                : persistenceStatus === "memory-only"
                  ? "현재 탭의 변경을 저장하지 않고 닫습니다. 먼저 JSON으로 내보내세요."
                  : undefined
            }
            className={buttonClass({ size: "icon", variant: "quiet" })}
            aria-label="3D 데생 인형 닫기"
          >
            <X size={16} aria-hidden />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          {/* 뷰포트 */}
          <div className="relative min-h-0 flex-1 basis-1/2 bg-[radial-gradient(circle_at_50%_30%,oklch(0.24_0.012_68),oklch(0.14_0.01_70))]">
            {sceneError ? (
              <div className="grid h-full place-items-center p-6 text-center">
                <div className="max-w-xs space-y-2">
                  <AlertTriangle size={22} className="mx-auto text-warn" aria-hidden />
                  <p className="text-xs leading-relaxed text-fg-2">{sceneError}</p>
                </div>
              </div>
            ) : (
              <div
                ref={viewportRef}
                className="h-full w-full"
                data-studio-mannequin-viewport="true"
                aria-label="3D 데생 인형 뷰포트 — 몸 클릭으로 관절 선택, 손·발 핸들 드래그로 IK 포즈"
              />
            )}
            {error ? (
              <p
                role="alert"
                className="absolute inset-x-3 bottom-3 rounded-lg border border-warn/40 bg-panel/95 px-3 py-2 text-[0.72rem] leading-relaxed text-warn shadow-lg"
              >
                {error}
              </p>
            ) : null}
          </div>

          {/* 컨트롤 */}
          <aside className="flex min-h-0 w-full flex-col border-t border-line/70 md:w-[320px] md:border-l md:border-t-0">
            <nav className="flex gap-1 border-b border-line/60 p-2" aria-label="데생 인형 설정 탭">
              {TABS.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => setTab(entry.id)}
                  aria-pressed={tab === entry.id}
                  className={cn(studioSegmentChipClass(tab === entry.id), "gap-1")}
                >
                  {entry.icon}
                  {entry.label}
                </button>
              ))}
            </nav>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {tab === "shaper" ? (
                <StudioShaperPanel
                  supportedCategories={SHAPER_MANNEQUIN_SUPPORTED_CATEGORIES}
                  onSelectionChange={handleShaperSelectionChange}
                  onExportPsd={handleExportPsdFromScene}
                  onTriggerPoseScanner={() => setTab("pose")}
                  onInsertCanvas={handleCapture}
                />
              ) : null}
              {tab === "body" ? (
                <StudioMannequinBodySection
                  params={params}
                  materialStyle={materialStyle}
                  onParamsChange={commitParams}
                  onApplyPreset={(presetId) =>
                    commitParams(STUDIO_MANNEQUIN_BODY_PRESETS[presetId].params)
                  }
                  onMaterialStyleChange={(style) => {
                    setMaterialStyle(style);
                    sceneRef.current?.setMaterialStyle(style);
                  }}
                />
              ) : null}
              {tab === "pose" ? (
                <>
                  <StudioVrmPhotoPoseScanner
                    disabled={webcamActive || webcamLoading || capturing}
                    includeHandDetection={false}
                    minimumApplyQuality="medium"
                    onApply={handleApplyPhotoPose}
                  />
                  {photoPoseApplyStatus ? (
                    <div
                      role="status"
                      aria-live="polite"
                      className="mb-3 rounded-lg border border-accent/35 bg-accent-soft/60 p-2 text-[0.66rem] leading-relaxed text-fg-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate" title={photoPoseApplyStatus.sourceName}>
                          사진 포즈 적용됨 · 관절 {photoPoseApplyStatus.appliedJointCount}개 · 신뢰도 {photoPoseApplyStatus.confidencePercent}%
                        </span>
                        {photoPoseUndoEntry?.after === pose ? (
                          <button
                            type="button"
                            onClick={handleUndoPhotoPose}
                            className={buttonClass({ size: "sm", variant: "quiet", className: "shrink-0 text-[0.66rem]" })}
                          >
                            1단계 실행 취소
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                  <StudioMannequinPoseSection
                    selectedCategory={poseCategory}
                    onCategorySelect={setPoseCategory}
                    onApplyPreset={applyPosePreset}
                    onMirror={() => commitPose(mirrorStudioMannequinPose(poseRef.current))}
                    onResetJoints={() => commitPose(createStudioMannequinRestPose())}
                  />
                </>
              ) : null}
              {tab === "joint" ? (
                <StudioMannequinJointSection
                  selectedJointId={selectedJointId}
                  rotation={selectedRotation}
                  onSelectJoint={(jointId) => {
                    setSelectedJointId(jointId);
                    sceneRef.current?.selectJoint(jointId);
                  }}
                  onRotate={handleRotateSelected}
                  onResetJoint={() => handleRotateSelected([0, 0, 0])}
                />
              ) : null}
              {tab === "camera" ? (
                <StudioMannequinCameraSection
                  projection={projection}
                  onProjectionChange={(next) => {
                    setProjection(next);
                    sceneRef.current?.setProjection(next);
                  }}
                  captureScale={captureScale}
                  onCaptureScaleChange={setCaptureScale}
                  onCameraPreset={(preset) => sceneRef.current?.setCameraPreset(preset)}
                  onResetCamera={() => sceneRef.current?.resetCamera()}
                  onCapture={handleCapture}
                  capturing={capturing}
                  captureDisabled={persistenceStatus !== "ready"}
                  webcamActive={webcamActive}
                  webcamLoadingStage={webcamLoadingStage}
                  webcamError={webcamError}
                  onToggleWebcam={handleToggleWebcam}
                  poseFrozen={poseFrozen}
                  onTogglePoseFreeze={() => setPoseFrozen((prev) => !prev)}
                  mirrorMode={mirrorMode}
                  onToggleMirrorMode={() => setMirrorMode((prev) => !prev)}
                  fingerTracking={fingerTracking}
                  onToggleFingerTracking={() => setFingerTracking((prev) => !prev)}
                  facialTracking={facialTracking}
                  onToggleFacialTracking={() => setFacialTracking((prev) => !prev)}
                />
              ) : null}
              <video ref={webcamVideoRef} className="hidden" playsInline muted />
            </div>
          </aside>
        </div>
      </div>
    </div>,
    document.body,
  );
}
