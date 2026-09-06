import { StudioBg3dSharedCharacterPlacementPanel } from "./StudioBg3dSharedCharacterPlacementPanel";

import type { StudioBg3dSharedCharacterGroundingResult } from "./studio-bg3d-shared-character-grounding";
import type {
  StudioBg3dSharedStageMaterializationKind,
  StudioBg3dSharedStageMutationKind,
} from "./studio-bg3d-shared-stage-editor-session";
import type {
  StudioShared3dCharacterRuntimeStatus,
  StudioShared3dCharacterSource,
  StudioShared3dCharacterTransformCommitHandler,
} from "../studio-shared-3d-scene-bridge";
import type { StudioShared3dStageResolution } from "../studio-shared-3d-stage-document";

import { cx } from "@/shared/lib/cx";

export interface StudioBg3dSharedStagePanelProps {
  readonly resolution: StudioShared3dStageResolution;
  readonly characters: readonly StudioShared3dCharacterSource[];
  readonly statuses: Readonly<Record<string, StudioShared3dCharacterRuntimeStatus>>;
  readonly selectedElementId: string | null;
  readonly selectedGrounding: StudioBg3dSharedCharacterGroundingResult | undefined;
  readonly captureElementCount: number;
  readonly charactersLinkedToOtherBackgroundCount: number;
  readonly targetHasLinkedCharacters: boolean;
  readonly targetHasSavedSharedScene: boolean;
  readonly includeCharactersInCapture: boolean;
  readonly mutationKind: StudioBg3dSharedStageMutationKind;
  readonly materializationKind: StudioBg3dSharedStageMaterializationKind;
  readonly captureDisabled: boolean;
  readonly placementDisabled: boolean;
  readonly onSelectMutation: (kind: StudioBg3dSharedStageMutationKind) => void;
  readonly onSetMutation: (kind: StudioBg3dSharedStageMutationKind) => void;
  readonly onSetMaterialization: (kind: StudioBg3dSharedStageMaterializationKind) => void;
  readonly onSelectCharacter: (elementId: string) => void;
  readonly onCommitCharacterTransform: StudioShared3dCharacterTransformCommitHandler;
}

interface SharedStageStatusCopy {
  readonly label: string;
  readonly message: string;
}

function resolveSharedStageStatusCopy({
  resolution,
  characters,
  statuses,
  captureElementCount,
  targetHasLinkedCharacters,
  mutationKind,
  captureDisabled,
}: Pick<
  StudioBg3dSharedStagePanelProps,
  | "resolution"
  | "characters"
  | "statuses"
  | "captureElementCount"
  | "targetHasLinkedCharacters"
  | "mutationKind"
  | "captureDisabled"
>): SharedStageStatusCopy {
  if (resolution.phase === "unlinked" && mutationKind === "background-only") {
    return captureDisabled
      ? {
          label: "장면 처리 중",
          message: "3D 배경을 캡처하거나 원본을 복원하는 중이에요. 작업이 끝나기 전에는 적용 방식을 바꿀 수 없어요.",
        }
      : {
          label: "배경만 추가 예정",
          message: "캐릭터는 연결하지 않고 배경만 추가할 예정이에요. 아래 적용을 누르기 전에는 저장되지 않아요.",
        };
  }

  if (
    resolution.phase === "unlinked"
    && mutationKind === "connect"
    && characters.length > 0
  ) {
    let readyCount = 0;
    let loadingCount = 0;
    let unavailableCount = 0;
    for (const character of characters) {
      const status = statuses[character.runtimeKey];
      if (status === "ready") readyCount += 1;
      else if (status === "unavailable") unavailableCount += 1;
      else loadingCount += 1;
    }

    if (unavailableCount > 0) {
      return {
        label: "캐릭터 확인 필요",
        message: `캐릭터 ${unavailableCount}명의 렌더 인스턴스를 준비하지 못했어요. 모델을 확인한 뒤 연결해 주세요.`,
      };
    }
    if (loadingCount > 0) {
      return {
        label: "캐릭터 준비 중",
        message: `캐릭터 렌더 ${readyCount}/${characters.length}명 준비됨 · 모두 준비되면 이 배경과 연결할 수 있어요.`,
      };
    }
    if (captureDisabled) {
      return {
        label: "장면 처리 중",
        message: "배경과 캐릭터 장면을 캡처하거나 원본을 복원하는 중이에요. 작업이 끝나기 전에는 적용 방식을 바꿀 수 없어요.",
      };
    }
    const previewOnlyCount = Math.max(0, readyCount - captureElementCount);
    if (previewOnlyCount > 0) {
      return {
        label: "캐릭터 확인 필요",
        message: `캐릭터 ${previewOnlyCount}명의 현재 설정을 결과에 빠짐없이 담을 수 없어 연결 적용 전 확인이 필요해요.`,
      };
    }
    return {
      label: "연결 예정",
      message: `캐릭터 ${captureElementCount}명을 이 배경과 연결할 예정이에요. 아래 적용을 누르기 전에는 저장되지 않아요.`,
    };
  }

  return {
    label: resolution.phase === "unlinked"
      ? "연결 안 됨"
      : !targetHasLinkedCharacters
        ? "배경만 연결됨"
        : resolution.phase === "ready"
          ? "연결됨"
          : resolution.phase === "live-update"
            ? "원본 변경됨"
            : "연결 확인 필요",
    message: resolution.message,
  };
}

/** Shared Stage relationship and per-background character placement controls. */
export function StudioBg3dSharedStagePanel({
  resolution,
  characters,
  statuses,
  selectedElementId,
  selectedGrounding,
  captureElementCount,
  charactersLinkedToOtherBackgroundCount,
  targetHasLinkedCharacters,
  targetHasSavedSharedScene,
  includeCharactersInCapture,
  mutationKind,
  materializationKind,
  captureDisabled,
  placementDisabled,
  onSelectMutation,
  onSetMutation,
  onSetMaterialization,
  onSelectCharacter,
  onCommitCharacterTransform,
}: StudioBg3dSharedStagePanelProps) {
  const statusCopy = resolveSharedStageStatusCopy({
    resolution,
    characters,
    statuses,
    captureElementCount,
    targetHasLinkedCharacters,
    mutationKind,
    captureDisabled,
  });

  return (
    <>
      <div
        className={cx(
          "mb-4 rounded-xl border px-3 py-2.5 text-[0.68rem] leading-relaxed",
          resolution.phase === "ready"
            ? "border-success/35 bg-success/10 text-success"
            : resolution.phase === "live-update"
              ? "border-accent/35 bg-accent-soft text-accent"
              : resolution.phase === "unlinked"
                ? "border-line bg-raised/60 text-fg-3"
                : "border-warning/40 bg-warning/10 text-warning",
        )}
      >
        <div
          role={resolution.phase === "ready"
            || resolution.phase === "live-update"
            || resolution.phase === "unlinked"
            ? "status"
            : "alert"}
        >
          <div className="flex items-center justify-between gap-2">
            <p className="font-bold">공유 3D 장면</p>
            <span className="rounded-md border border-current/25 px-1.5 py-0.5 text-[0.62rem] font-bold">
              {statusCopy.label}
            </span>
          </div>
          <p className="mt-0.5">{statusCopy.message}</p>
        </div>
        <div
          role="group"
          aria-label="이 배경의 공유 3D 장면 적용 방식"
          className="mt-2 grid grid-cols-1 gap-2 min-[390px]:grid-cols-2"
        >
          {targetHasSavedSharedScene ? (
            <button
              type="button"
              aria-pressed={mutationKind === "refresh"}
              disabled={captureDisabled}
              className={cx(
                "min-h-11 rounded-lg border px-2.5 text-xs font-bold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45 sm:min-h-9",
                mutationKind === "refresh"
                  ? "border-accent bg-accent text-on-accent"
                  : "border-line bg-card text-fg-2 hover:bg-raised",
              )}
              onClick={() => onSelectMutation("refresh")}
            >
              {targetHasLinkedCharacters ? "현재 연결 유지" : "배경 연결 유지"}
            </button>
          ) : null}
          {!targetHasSavedSharedScene || !targetHasLinkedCharacters ? (
            <button
              type="button"
              aria-pressed={mutationKind === "connect"}
              disabled={characters.length === 0 || captureDisabled}
              className={cx(
                "min-h-11 rounded-lg border px-2.5 text-xs font-bold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45 sm:min-h-9",
                mutationKind === "connect"
                  ? "border-accent bg-accent text-on-accent"
                  : "border-line bg-card text-fg-2 hover:bg-raised",
              )}
              onClick={() => onSelectMutation("connect")}
            >
              이 배경에 캐릭터 연결
            </button>
          ) : (
            <button
              type="button"
              aria-pressed={mutationKind === "relink"}
              disabled={(
                characters.length === 0
                && resolution.missingCharacterElementIds.length === 0
              ) || captureDisabled}
              className={cx(
                "min-h-11 rounded-lg border px-2.5 text-xs font-bold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45 sm:min-h-9",
                mutationKind === "relink"
                  ? "border-accent bg-accent text-on-accent"
                  : "border-line bg-card text-fg-2 hover:bg-raised",
              )}
              onClick={() => onSelectMutation("relink")}
            >
              현재 원본으로 다시 연결
            </button>
          )}
          {targetHasSavedSharedScene ? (
            <button
              type="button"
              aria-pressed={mutationKind === "unlink"
                && materializationKind === "editable-lt-bundle"}
              disabled={captureDisabled}
              className={cx(
                "min-h-11 rounded-lg border px-2.5 text-xs font-bold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45 sm:min-h-9",
                "min-[390px]:col-span-2",
                mutationKind === "unlink" && materializationKind === "editable-lt-bundle"
                  ? "border-warning bg-warning/15 text-warning"
                  : "border-line bg-card text-fg-2 hover:bg-raised",
              )}
              onClick={() => onSelectMutation("unlink")}
            >
              {targetHasLinkedCharacters ? "캐릭터 연결 해제" : "배경 연결 해제"}
            </button>
          ) : (
            <button
              type="button"
              aria-pressed={mutationKind === "background-only"}
              disabled={captureDisabled}
              className={cx(
                "min-h-11 rounded-lg border px-2.5 text-xs font-bold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45 sm:min-h-9",
                mutationKind === "background-only"
                  ? "border-accent bg-accent-soft text-accent"
                  : "border-line bg-card text-fg-2 hover:bg-raised",
              )}
              onClick={() => onSelectMutation("background-only")}
            >
              배경만 추가
            </button>
          )}
          {targetHasSavedSharedScene ? (
            <button
              type="button"
              aria-pressed={mutationKind === "unlink"
                && materializationKind === "detached-editable-composite"}
              disabled={captureDisabled}
              className={cx(
                "min-h-11 rounded-lg border px-2.5 text-xs font-bold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45 sm:min-h-9",
                "min-[390px]:col-span-2",
                materializationKind === "detached-editable-composite"
                  ? "border-accent bg-accent text-on-accent"
                  : "border-line bg-card text-fg-2 hover:bg-raised",
              )}
              onClick={() => {
                onSetMutation("unlink");
                onSetMaterialization("detached-editable-composite");
              }}
            >
              3D 원본 유지 · 한 장으로 정리
            </button>
          ) : null}
        </div>
        {charactersLinkedToOtherBackgroundCount > 0 ? (
          <p className="mt-2 font-semibold text-accent">
            다른 배경에서도 쓰는 캐릭터 {charactersLinkedToOtherBackgroundCount}명을 이 배경에 그대로 재사용할 수 있어요. 여기서 바꾼 위치와 방향은 이 배경에만 저장돼요.
          </p>
        ) : null}
        <p className="mt-2 text-[0.65rem] text-fg-3">
          {mutationKind === "unlink"
            ? materializationKind === "detached-editable-composite"
              ? "컬러·톤·선을 한 이미지로 합치고 공유 연결만 끊어요. 캐릭터 원본은 정확히 복원되고, 배경 3D 원본은 남아 나중에 다시 편집할 수 있어요. 한 번의 실행 취소로 되돌릴 수 있어요."
              : targetHasLinkedCharacters
                ? "적용하면 배경은 3D 편집 상태로 남고, Studio가 이 연결에서 숨긴 원본 레이어만 다시 보여요. 직접 숨겼거나 다른 모델로 바뀐 레이어는 그대로예요. 한 번의 실행 취소로 되돌릴 수 있어요."
                : "적용하면 이 배경의 공유 연결만 끊고 3D 편집 원본은 그대로 남겨요. 한 번의 실행 취소로 되돌릴 수 있어요."
            : mutationKind === "relink"
              ? (
                  <span className="block space-y-0.5">
                    <span className="block">
                      현재 결과에 담을 수 있는 {captureElementCount}명만 다시 연결해요.
                    </span>
                    {resolution.missingCharacterElementIds.length > 0 ? (
                      <span className="block font-semibold text-warning">
                        찾지 못한 {resolution.missingCharacterElementIds.length}명은 연결 목록에서 제외해요.
                      </span>
                    ) : null}
                    {resolution.replacedCharacterElementIds.length > 0 ? (
                      <span className="block font-semibold text-warning">
                        모델이 바뀐 {resolution.replacedCharacterElementIds.length}명은 현재 모델로 교체해요.
                      </span>
                    ) : null}
                  </span>
                )
              : includeCharactersInCapture
                ? `적용하면 캐릭터 ${captureElementCount}명이 결과 이미지와 함께 연결돼요.`
                : "캐릭터를 결과에 넣지 않고 배경만 관리해요."}
        </p>
      </div>
      {includeCharactersInCapture && characters.length > 0 ? (
        <StudioBg3dSharedCharacterPlacementPanel
          characters={characters}
          statuses={statuses}
          selectedElementId={selectedElementId}
          grounding={selectedGrounding}
          disabled={placementDisabled}
          onSelect={onSelectCharacter}
          onCommit={onCommitCharacterTransform}
        />
      ) : null}
    </>
  );
}
