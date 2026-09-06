import { useId } from "react";

import {
  STUDIO_VRM_RIG_PROFILES,
  STUDIO_VRM_RIG_PROFILE_IDS,
  normalizeStudioVrmRigProfile,
  type StudioVrmRigProfileId,
} from "./studio-vrm-rig-profile";

import type {
  StudioVrmIkConstraint,
  StudioVrmIkEffector,
  StudioVrmPoseTranslations,
} from "./studio-vrm-scene-document";

const EFFECTOR_LABELS: Record<StudioVrmIkEffector, string> = {
  leftHand: "왼손",
  rightHand: "오른손",
  leftFoot: "왼발",
  rightFoot: "오른발",
};

export interface StudioVrmRigAssistPanelProps {
  readonly disabled: boolean;
  readonly jointProfile: StudioVrmRigProfileId;
  readonly fullBodyIk: boolean;
  readonly footPlant: boolean;
  readonly floorHeight: number;
  readonly rootYOffset: number;
  readonly translations: StudioVrmPoseTranslations;
  readonly ikConstraints: readonly StudioVrmIkConstraint[];
  readonly onJointProfileChange: (profile: StudioVrmRigProfileId) => void;
  readonly onFullBodyIkChange: (enabled: boolean) => void;
  readonly onFootPlantChange: (enabled: boolean) => void;
  readonly onFloorHeightChange: (height: number) => void;
  readonly onResetTranslations: () => void;
  readonly onConstraintEnabledChange: (effector: StudioVrmIkEffector, enabled: boolean) => void;
  readonly onConstraintLockedChange: (effector: StudioVrmIkEffector, locked: boolean) => void;
  readonly onConstraintRemove: (effector: StudioVrmIkEffector) => void;
}

/** Controlled product panel for the versioned VRM drawing-assist rig settings. */
export function StudioVrmRigAssistPanel({
  disabled,
  jointProfile,
  fullBodyIk,
  footPlant,
  floorHeight,
  rootYOffset,
  translations,
  ikConstraints,
  onJointProfileChange,
  onFullBodyIkChange,
  onFootPlantChange,
  onFloorHeightChange,
  onResetTranslations,
  onConstraintEnabledChange,
  onConstraintLockedChange,
  onConstraintRemove,
}: StudioVrmRigAssistPanelProps) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="mb-3 rounded-lg border border-line/60 bg-panel/35 p-2.5"
    >
      <h3 id={headingId} className="text-[0.7rem] font-bold text-fg">
        드로잉 관절 보조
      </h3>
      <p className="mt-1 text-[0.62rem] leading-relaxed text-fg-3">
        스타일화된 그림 참고용 프리셋입니다. 실제 사람의 연령·건강·장애·해부학적 특성이나
        안전한 관절 가동 범위를 판단하는 의료 기능이 아닙니다.
      </p>

      <label className="mt-2.5 block text-[0.68rem] font-semibold text-fg-2">
        관절 드로잉 프로필
        <select
          aria-label="관절 드로잉 프로필"
          className="mt-1 min-h-9 w-full rounded-md border border-line bg-card px-2 text-[0.68rem] text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-45 pointer-coarse:min-h-11"
          disabled={disabled}
          value={jointProfile}
          onChange={(event) => {
            const profile = normalizeStudioVrmRigProfile(event.target.value);
            if (profile) onJointProfileChange(profile.id);
          }}
        >
          {STUDIO_VRM_RIG_PROFILE_IDS.map((id) => (
            <option key={id} value={id}>{STUDIO_VRM_RIG_PROFILES[id].label}</option>
          ))}
        </select>
      </label>

      <div className="mt-2.5 grid gap-2">
        <label className="flex min-h-9 cursor-pointer items-center justify-between gap-3 text-[0.68rem] font-semibold text-fg-2 pointer-coarse:min-h-11">
          <span>
            전신 IK 보조
            <span className="ml-1 font-normal text-fg-3">root·골반·척추와 여러 체인을 반복 계산</span>
          </span>
          <input
            type="checkbox"
            aria-label="전신 IK 보조"
            checked={fullBodyIk}
            disabled={disabled}
            className="size-3.5 accent-accent"
            onChange={(event) => onFullBodyIkChange(event.target.checked)}
          />
        </label>
        <label className="flex min-h-9 cursor-pointer items-center justify-between gap-3 text-[0.68rem] font-semibold text-fg-2 pointer-coarse:min-h-11">
          <span>
            양발 바닥 고정
            <span className="ml-1 font-normal text-fg-3">손·발 편집 중 두 발을 동시 제약</span>
          </span>
          <input
            type="checkbox"
            aria-label="발 바닥 고정"
            checked={footPlant}
            disabled={disabled}
            className="size-3.5 accent-accent"
            onChange={(event) => onFootPlantChange(event.target.checked)}
          />
        </label>
      </div>

      <label className="mt-2.5 block text-[0.68rem] font-semibold text-fg-2">
        <span className="flex items-center justify-between gap-2">
          <span>바닥 높이</span>
          <output className="numeral text-fg-3">{floorHeight.toFixed(2)}m</output>
        </span>
        <input
          type="range"
          aria-label="발 고정 바닥 높이"
          min="-10"
          max="10"
          step="0.01"
          value={floorHeight}
          disabled={disabled || !footPlant}
          className="mt-1.5 h-2 w-full accent-accent disabled:opacity-45"
          onChange={(event) => onFloorHeightChange(Number(event.target.value))}
        />
      </label>
      {fullBodyIk && !footPlant ? (
        <p className="mt-1.5 text-[0.62rem] leading-relaxed text-fg-3" role="status">
          전신 이동은 활성 손·발의 도달 범위를 보조합니다. 양발 고정을 켜면 두 다리까지
          같은 반복 solve에 참여합니다.
        </p>
      ) : null}
      <div className="mt-2.5 rounded-md border border-line/60 bg-card/45 p-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[0.65rem] font-semibold text-fg-2">저장되는 전신 이동</span>
          <button
            type="button"
            disabled={disabled}
            className="min-h-8 rounded-md border border-line px-2 text-[0.62rem] font-semibold text-fg-2 hover:bg-raised disabled:opacity-45 pointer-coarse:min-h-11"
            onClick={onResetTranslations}
          >
            이동 초기화
          </button>
        </div>
        <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-[0.6rem] text-fg-3">
          <dt>Root X/Y/Z</dt>
          <dd className="numeral text-right">{translations.root[0].toFixed(2)} / {rootYOffset.toFixed(2)} / {translations.root[2].toFixed(2)}m</dd>
          <dt>골반 X/Y/Z</dt>
          <dd className="numeral text-right">{translations.hips.map((value) => value.toFixed(2)).join(" / ")}m</dd>
          <dt>척추 X/Y/Z</dt>
          <dd className="numeral text-right">{translations.spine.map((value) => value.toFixed(2)).join(" / ")}m</dd>
        </dl>
        <p className="mt-1.5 text-[0.58rem] leading-relaxed text-fg-3">
          미리보기 동안에는 장면만 바뀌며, 핸들을 놓을 때 포즈와 이동값을 한 번만 저장합니다.
        </p>
      </div>
      <div className="mt-2.5 rounded-md border border-line/60 bg-card/45 p-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[0.65rem] font-semibold text-fg-2">손·발 고정점</span>
          <span className="numeral text-[0.58rem] text-fg-3">{ikConstraints.length}/4</span>
        </div>
        {ikConstraints.length === 0 ? (
          <p className="mt-1.5 text-[0.58rem] leading-relaxed text-fg-3">
            손·발 마름모를 이동하면 장면 좌표에 고정점이 저장됩니다.
          </p>
        ) : (
          <ul className="mt-1.5 grid gap-1.5">
            {ikConstraints.map((constraint) => (
              <li
                key={constraint.effector}
                className="flex min-h-9 items-center gap-2 rounded-md border border-line/50 bg-panel/40 px-2 py-1 pointer-coarse:min-h-11"
              >
                <span className="min-w-10 flex-1 text-[0.62rem] font-semibold text-fg-2">
                  {EFFECTOR_LABELS[constraint.effector]}
                </span>
                <label className="flex items-center gap-1 text-[0.58rem] text-fg-3">
                  <input
                    type="checkbox"
                    aria-label={`${EFFECTOR_LABELS[constraint.effector]} 고정점 사용`}
                    checked={constraint.enabled}
                    disabled={disabled}
                    className="size-3.5 accent-accent"
                    onChange={(event) => onConstraintEnabledChange(
                      constraint.effector,
                      event.target.checked,
                    )}
                  />
                  사용
                </label>
                <label className="flex items-center gap-1 text-[0.58rem] text-fg-3">
                  <input
                    type="checkbox"
                    aria-label={`${EFFECTOR_LABELS[constraint.effector]} 다른 포즈 편집 중 유지`}
                    checked={constraint.locked}
                    disabled={disabled || !constraint.enabled}
                    className="size-3.5 accent-accent"
                    onChange={(event) => onConstraintLockedChange(
                      constraint.effector,
                      event.target.checked,
                    )}
                  />
                  유지
                </label>
                <button
                  type="button"
                  aria-label={`${EFFECTOR_LABELS[constraint.effector]} 고정점 삭제`}
                  disabled={disabled}
                  className="min-h-7 rounded border border-line px-1.5 text-[0.56rem] font-semibold text-fg-3 hover:bg-raised disabled:opacity-45 pointer-coarse:min-h-10"
                  onClick={() => onConstraintRemove(constraint.effector)}
                >
                  삭제
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-1.5 text-[0.58rem] leading-relaxed text-fg-3">
          사용을 끄면 핸들과 계산에서 제외됩니다. ‘유지’는 다른 포즈 편집 중에도 목표를 함께 풉니다.
        </p>
      </div>
    </section>
  );
}
