/**
 * Studio 핸드 포즈 스캐너 패널(Hand Pose Scanner Panel).
 *
 * 웹캠 실시간/사진 이미지의 MediaPipe 손 랜드마크에서 5개 손가락의 굴곡·벌림 각도를 추출하거나,
 * 프리셋을 선택하여 3D 마네킹/VRM 캐릭터 손 포즈에 적용한다.
 * 각 손가락 Flex(0~1) 및 Spread(-1~1) 슬라이더로 세밀하게 미세 조정 가능.
 */

import { Hand, RotateCcw, Video } from "lucide-react";
import { useState } from "react";

import {
  STUDIO_HAND_PRESETS,
  type StudioFingerName,
  type StudioHandPoseData,
} from "./studio-hand-pose-scanner";
import {
  StudioPanelChip,
  StudioSectionHeader,
  StudioSliderRow,
} from "./studio-panel-ui";

import type { ReactElement } from "react";

import { buttonClass } from "@/shared/components/ui/button-utils";

export interface StudioHandPosePanelProps {
  /** 현재 손 포즈 데이터. */
  readonly handPose: StudioHandPoseData;
  /** 손 포즈 변경 콜백. */
  readonly onHandPoseChange: (pose: StudioHandPoseData) => void;
  /** 웹캠 실시간 핸드 트래킹 활성 여부. */
  readonly webcamActive: boolean;
  /** 웹캠 토글 콜백. */
  readonly onToggleWebcam: () => void;
}

const FINGER_LABELS: Record<StudioFingerName, string> = {
  thumb: "엄지",
  index: "검지",
  middle: "중지",
  ring: "약지",
  little: "소지",
};

const FINGER_KEYS: readonly StudioFingerName[] = [
  "thumb",
  "index",
  "middle",
  "ring",
  "little",
];

export function StudioHandPosePanel({
  handPose,
  onHandPoseChange,
  webcamActive,
  onToggleWebcam,
}: StudioHandPosePanelProps): ReactElement {
  const [expanded, setExpanded] = useState<StudioFingerName | null>(null);

  const handlePresetApply = (presetId: string) => {
    const preset = STUDIO_HAND_PRESETS.find((p) => p.id === presetId);
    if (preset) onHandPoseChange(preset.pose);
  };

  const handleFingerChange = (
    finger: StudioFingerName,
    field: "flex" | "spread",
    value: number,
  ) => {
    onHandPoseChange({
      ...handPose,
      [finger]: {
        ...handPose[finger],
        [field]: value,
      },
    });
  };

  const handleReset = () => {
    onHandPoseChange(STUDIO_HAND_PRESETS[0]!.pose);
  };

  return (
    <div className="space-y-3">
      <StudioSectionHeader
        title="손 포즈 스캐너"
        description="프리셋을 선택하거나 웹캠으로 손 동작을 인식하세요."
        action={
          <button
            type="button"
            onClick={handleReset}
            className={buttonClass({ size: "sm", variant: "quiet", className: "gap-1" })}
            title="손 포즈 초기화"
          >
            <RotateCcw size={13} aria-hidden /> 초기화
          </button>
        }
      />

      {/* 웹캠 핸드 트래킹 */}
      <button
        type="button"
        onClick={onToggleWebcam}
        className={buttonClass({
          size: "sm",
          variant: webcamActive ? "solid" : "quiet",
          className: "w-full justify-center gap-1.5",
        })}
      >
        {webcamActive ? (
          <Hand size={13} aria-hidden />
        ) : (
          <Video size={13} aria-hidden />
        )}
        {webcamActive ? "🔴 손 인식 중지" : "✋ 웹캠 손 인식 시작"}
      </button>

      {/* 프리셋 칩 */}
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="손 포즈 프리셋">
        {STUDIO_HAND_PRESETS.map((preset) => (
          <StudioPanelChip
            key={preset.id}
            onClick={() => handlePresetApply(preset.id)}
            title={`${preset.label} 프리셋 적용`}
          >
            {preset.label}
          </StudioPanelChip>
        ))}
      </div>

      {/* 손가락별 세부 조절 */}
      <div className="space-y-1">
        <span className="text-xs font-semibold text-fg-2">손가락별 세부 조절</span>
        {FINGER_KEYS.map((finger) => (
          <div key={finger} className="space-y-1">
            <button
              type="button"
              onClick={() =>
                setExpanded((prev) => (prev === finger ? null : finger))
              }
              className="flex w-full items-center justify-between rounded-md px-2 py-1 text-xs text-fg-2 hover:bg-card/60"
            >
              <span>{FINGER_LABELS[finger]}</span>
              <span className="text-[0.65rem] tabular-nums text-fg-3">
                flex={handPose[finger].flex.toFixed(2)} spread=
                {handPose[finger].spread.toFixed(2)}
              </span>
            </button>
            {expanded === finger ? (
              <div className="space-y-1 pl-2">
                <StudioSliderRow
                  label="굽힘"
                  min={0}
                  max={100}
                  step={1}
                  value={Math.round(handPose[finger].flex * 100)}
                  onChange={(v) => handleFingerChange(finger, "flex", v / 100)}
                  readout={`${Math.round(handPose[finger].flex * 100)}%`}
                />
                <StudioSliderRow
                  label="벌림"
                  min={-100}
                  max={100}
                  step={1}
                  value={Math.round(handPose[finger].spread * 100)}
                  onChange={(v) => handleFingerChange(finger, "spread", v / 100)}
                  readout={`${Math.round(handPose[finger].spread * 100)}%`}
                />
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
