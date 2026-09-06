import { AlertTriangle, ImagePlus, Loader2, Save, X } from "lucide-react";

import {
  STUDIO_BG3D_CONTROL_BUTTON as CONTROL_BUTTON,
  studioBg3dClassNames as cx,
} from "./studio-bg3d-editor-ui";

import type {
  StudioBg3dSharedStageMaterializationKind,
  StudioBg3dSharedStageMutationKind,
} from "./studio-bg3d-shared-stage-editor-session";

interface StudioBg3dActionFooterProps {
  readonly sceneRecoveryError: string | null;
  readonly hasCloneFailure: boolean;
  readonly isRestoringScene: boolean;
  readonly hasPendingClone: boolean;
  readonly hasPendingSharedCharacter: boolean;
  readonly hasFilledOutput: boolean;
  readonly onEnableFilledOutput: () => void;
  readonly sharedStageUpdateBlockedReason: string | null;
  readonly onOpenSharedStage: () => void;
  readonly error: string | null;
  readonly isCapturing: boolean;
  readonly deletingModelInProgress: boolean;
  readonly saveDisabled: boolean;
  readonly onClose: () => void;
  readonly onSave: () => void;
  readonly insertDisabled: boolean;
  readonly onInsert: () => void;
  readonly operation: "insert" | "update";
  readonly mutationKind: StudioBg3dSharedStageMutationKind;
  readonly materializationKind: StudioBg3dSharedStageMaterializationKind;
  readonly captureElementCount: number;
  readonly toneOutputType: string;
}

export function StudioBg3dActionFooter({
  sceneRecoveryError,
  hasCloneFailure,
  isRestoringScene,
  hasPendingClone,
  hasPendingSharedCharacter,
  hasFilledOutput,
  onEnableFilledOutput,
  sharedStageUpdateBlockedReason,
  onOpenSharedStage,
  error,
  isCapturing,
  deletingModelInProgress,
  saveDisabled,
  onClose,
  onSave,
  insertDisabled,
  onInsert,
  operation,
  mutationKind,
  materializationKind,
  captureElementCount,
  toneOutputType,
}: StudioBg3dActionFooterProps) {
  const isPreparing = isCapturing || isRestoringScene || hasPendingClone || hasPendingSharedCharacter;

  return (
    <>
      {sceneRecoveryError || hasCloneFailure ? (
        <div role="alert" className="mx-4 mb-2 flex items-start gap-2 rounded-lg border border-bad/45 bg-[oklch(0.66_0.20_25/0.10)] px-3 py-2 text-xs leading-relaxed text-fg sm:mx-5">
          <AlertTriangle className="mt-0.5 shrink-0 text-bad" size={14} aria-hidden />
          <span>
            {sceneRecoveryError ?? "검증된 모델의 렌더 인스턴스를 만들지 못했습니다. 기존 PNG를 보존하기 위해 저장을 막았습니다."}
          </span>
        </div>
      ) : null}

      {isRestoringScene || hasPendingClone || hasPendingSharedCharacter ? (
        <div aria-live="polite" className="mx-4 mb-2 flex items-center gap-2 rounded-lg border border-line bg-card px-3 py-2 text-xs text-fg-2 sm:mx-5">
          <Loader2 className="shrink-0 animate-spin text-accent" size={14} aria-hidden />
          {isRestoringScene ? "검증된 3D 장면 원본을 복원하는 중입니다." : "모델 렌더 인스턴스를 준비하는 중입니다."}
        </div>
      ) : null}

      {!hasFilledOutput && !isRestoringScene ? (
        <div
          role="status"
          className="mx-4 mb-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warn/45 bg-[oklch(0.82_0.15_80/0.08)] px-3 py-2 text-xs leading-relaxed text-fg sm:mx-5"
        >
          <span className="flex min-w-0 flex-1 items-start gap-2">
            <AlertTriangle className="mt-0.5 shrink-0 text-warn" size={14} aria-hidden />
            <span>현재 설정은 재질색과 명암을 빼고 선화만 추가합니다.</span>
          </span>
          <button
            type="button"
            className="min-h-11 rounded-lg border border-warn/55 bg-panel px-3 text-xs font-bold text-warn transition-colors hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:min-h-9"
            onClick={onEnableFilledOutput}
          >
            컬러 렌더 켜기
          </button>
        </div>
      ) : null}

      {sharedStageUpdateBlockedReason ? (
        <div
          role="alert"
          className="mx-4 mb-2 flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs leading-relaxed text-warning sm:mx-5"
        >
          <AlertTriangle className="mt-0.5 shrink-0" size={14} aria-hidden />
          <div className="min-w-0 flex-1">
            <p>{sharedStageUpdateBlockedReason}</p>
            <button
              type="button"
              className="mt-2 min-h-11 rounded-lg border border-warning/50 bg-panel px-3 text-xs font-bold text-warning transition-colors hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:min-h-9"
              onClick={onOpenSharedStage}
            >
              연결 설정 열기
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="mx-4 mb-2 flex items-start gap-2 rounded-lg border border-line bg-card px-3 py-2 text-xs text-fg-2 sm:mx-5">
          <AlertTriangle className="mt-0.5 shrink-0 text-accent" size={14} aria-hidden />
          {error}
        </div>
      ) : null}

      <footer className="flex shrink-0 items-center justify-between gap-2 border-t border-line px-3 py-3 min-[360px]:px-4 sm:px-5">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            aria-label="3D 배경 편집기 닫기"
            className={cx(
              CONTROL_BUTTON,
              "shrink-0 whitespace-nowrap border-line bg-card text-fg-2 hover:bg-raised hover:text-fg max-[359px]:size-11 max-[359px]:px-0",
            )}
            disabled={isCapturing}
            aria-disabled={deletingModelInProgress || undefined}
            onClick={onClose}
          >
            <X size={14} className="hidden max-[359px]:block" aria-hidden />
            <span className="max-[359px]:sr-only">닫기</span>
          </button>
          <button
            type="button"
            aria-label="3D 소재 저장"
            className={cx(
              CONTROL_BUTTON,
              "shrink-0 whitespace-nowrap border-line bg-card text-fg-2 hover:bg-raised hover:text-fg max-[359px]:size-11 max-[359px]:px-0",
            )}
            disabled={saveDisabled}
            onClick={onSave}
          >
            <Save size={14} className="min-[360px]:mr-1.5" aria-hidden />
            <span className="max-[359px]:sr-only">소재 저장</span>
          </button>
        </div>
        <button
          type="button"
          className={cx(
            CONTROL_BUTTON,
            "min-w-0 shrink whitespace-nowrap border-accent/60 bg-accent text-on-accent hover:bg-accent/90 min-[360px]:min-w-36",
          )}
          disabled={insertDisabled}
          onClick={onInsert}
        >
          {isPreparing ? <Loader2 className="animate-spin" size={14} aria-hidden /> : <ImagePlus size={14} aria-hidden />}
          <span className="max-[359px]:hidden">
            {mutationKind === "unlink"
              ? materializationKind === "detached-editable-composite"
                ? "3D 원본 유지 · 한 장으로 정리"
                : "연결 해제하고 배경 업데이트"
              : mutationKind === "relink"
                ? "원본 다시 연결하고 업데이트"
                : mutationKind === "connect"
                  ? `${captureElementCount}명과 연결해 ${operation === "update" ? "업데이트" : "추가"}`
                  : operation === "update"
                    ? "3D 배경 업데이트"
                    : !hasFilledOutput
                      ? "선화만 추가"
                      : toneOutputType === "color"
                        ? "컬러 배경 추가"
                        : "톤 배경 추가"}
          </span>
          <span className="hidden max-[359px]:inline">
            {mutationKind === "unlink"
              ? materializationKind === "detached-editable-composite"
                ? "한 장 정리"
                : "연결 해제"
              : mutationKind === "relink"
                ? "다시 연결"
                : mutationKind === "connect"
                  ? "연결해 적용"
                  : operation === "update" ? "업데이트" : "배경 추가"}
          </span>
        </button>
      </footer>
    </>
  );
}
