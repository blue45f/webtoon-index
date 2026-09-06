import type { StudioShared3dStageResolution } from "../studio-shared-3d-stage-document";

import { cx } from "@/shared/lib/cx";

export interface StudioBg3dSharedCharacterStatusOverlayProps {
  totalCount: number;
  readyCount: number;
  unavailableCount: number;
  previewOmissionCount: number;
  capacityOmissionCount: number;
  includeInCapture: boolean;
  relationshipLabel?: string;
  stageResolution?: StudioShared3dStageResolution;
}

/** Product-facing status for VRM layers linked into the background scene at runtime. */
export function StudioBg3dSharedCharacterStatusOverlay({
  totalCount,
  readyCount,
  unavailableCount,
  previewOmissionCount,
  capacityOmissionCount,
  includeInCapture,
  relationshipLabel,
  stageResolution,
}: StudioBg3dSharedCharacterStatusOverlayProps) {
  if (totalCount === 0) return null;
  const headline = relationshipLabel ?? (unavailableCount > 0
    ? `공유 캐릭터 ${readyCount}/${totalCount}명 · ${unavailableCount}명 확인 필요`
    : readyCount === totalCount
      ? `공유 캐릭터 ${totalCount}명 연결됨`
      : `공유 캐릭터 ${readyCount}/${totalCount}명 불러오는 중`);

  return (
    <div
      aria-live="polite"
      data-testid="studio-bg3d-shared-characters-status"
      className="pointer-events-none absolute left-2 top-2 z-30 max-w-[min(88%,24rem)] rounded-lg border border-line/80 bg-panel/92 px-2.5 py-2 text-[0.68rem] leading-relaxed text-fg-2 shadow-lg backdrop-blur max-sm:max-w-[calc(100%-1rem)] max-sm:py-1.5 sm:left-3 sm:top-3"
    >
      {stageResolution ? (
        <p
          data-testid="studio-bg3d-shared-stage-status"
          className={cx(
            "mb-0.5 font-bold max-sm:line-clamp-1",
            stageResolution.phase === "ready"
              ? "text-success"
              : stageResolution.phase === "live-update"
                ? "text-accent"
                : stageResolution.phase === "unlinked"
                  ? "text-fg-3"
                  : "text-warning",
          )}
        >
          {stageResolution.message}
        </p>
      ) : null}
      <p className="font-bold text-fg">{headline}</p>
      <p className="max-sm:hidden">
        {includeInCapture
          ? "배경 카메라·조명을 함께 사용하며, 포즈 원본은 각 캐릭터 레이어에 그대로 보존돼요."
          : "배치 참고용으로만 보여요. 결과 이미지와 공유 연결에는 포함되지 않아요."}
      </p>
      {includeInCapture && previewOmissionCount > 0 ? (
        <p className="mt-0.5 text-warning">
          현재 배경 캡처에서 지원하지 않는 캐릭터 설정이 {previewOmissionCount}개 있어요.
          이 설정이 있는 캐릭터는 원본을 지키기 위해 결과에서 제외돼요.
        </p>
      ) : null}
      {capacityOmissionCount > 0 ? (
        <p className="mt-0.5 text-warning">
          기기 보호를 위해 나머지 {capacityOmissionCount}명은 이번 미리보기에서 제외했어요.
        </p>
      ) : null}
    </div>
  );
}
