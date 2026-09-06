/* Extracted from StudioBackground3D. Closures keep original identifiers via an `any` host bag. */
// @ts-nocheck
"use no memo";
// React Compiler 옵트아웃: 가변 호스트 백(h) 을 렌더마다 재대입해 공유하는 추출 패턴이라,
// 컴파일러가 h 참조 동일성만 보고 JSX/계산을 캐시하면 첫 렌더에서 UI 가 영구 동결된다
// (탭 전환 등 커밋된 상태 변경이 화면에 반영되지 않음).
import * as R from "./studio-bg3d-editor-runtime-bindings";
import { StudioBg3dEditorViewport } from "./StudioBg3dEditorViewport";
import { StudioBg3dEditorSidebar } from "./StudioBg3dEditorSidebar";

export function StudioBg3dEditorModal({ h }) {
  const {
    Boxes, X, CONTROL_BUTTON, ICON_BUTTON, cx,
    open, webXrRendererLifetimeRetained, modalDialogRef, isBatchRenderingShots,
    shotBatchProgress, shotBatchAbortRef, isCapturing, deletingModelId,
    webXrSessionState, requestUserClose,
  } = { ...R, ...h };
  if (!open && !webXrRendererLifetimeRetained) return null;
  // A dense scrim separates workspaces without a full-screen backdrop-filter pass over the
  // underlying 2D GPU canvas. The 3D viewport, resolution and output colour contract are unchanged.
  return (
    <div
      ref={modalDialogRef}
      aria-hidden={!open || undefined}
      aria-modal={open ? "true" : undefined}
      aria-labelledby="studio-bg3d-dialog-title"
      data-testid="studio-bg3d-dialog"
      hidden={!open}
      inert={!open ? true : undefined}
      className="fixed inset-0 z-[80] bg-[oklch(0.08_0.01_70/0.94)] p-2 text-fg sm:p-4"
      role={open ? "dialog" : undefined}
      tabIndex={-1}
      style={{
        paddingTop: "max(0.5rem, env(safe-area-inset-top))",
        paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))",
      }}
    >
      <div className="mx-auto flex h-full max-h-full max-w-[1280px] flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-[0_24px_80px_oklch(0.05_0.01_70/0.55)]">
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <p className="eyebrow flex items-center gap-1.5 text-accent">
              <Boxes size={14} aria-hidden />
              3D 배경
            </p>
            <h2 id="studio-bg3d-dialog-title" className="mt-1 truncate text-lg font-bold tracking-tight text-fg sm:text-xl">3D 장면 스튜디오</h2>
            <p className="mt-1 line-clamp-1 text-xs text-fg-3">캐릭터·배경·소품·조명을 한 장면에서 연출하고 컬러·선화로 추출</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {isBatchRenderingShots ? (
              <>
                <span className="sr-only" role="status" aria-live="polite">
                  {shotBatchProgress?.stage === "render" ? "컷 렌더" : "ZIP 생성"}
                  {" "}{shotBatchProgress?.completed ?? 0}/{shotBatchProgress?.total ?? 0}
                </span>
                <button
                  type="button"
                  className={cx(CONTROL_BUTTON, "border-line bg-card text-fg-2 hover:bg-raised hover:text-fg")}
                  onClick={() => shotBatchAbortRef.current?.abort()}
                >
                  <X size={14} aria-hidden />
                  일괄 렌더 취소
                </button>
              </>
            ) : null}
            <button
              type="button"
              aria-label="닫기"
              data-bg3d-initial-focus="true"
              title={isCapturing || deletingModelId !== null
                ? "진행 중인 작업이 끝난 뒤 닫을 수 있습니다"
                : webXrSessionState.status !== "idle" && webXrSessionState.status !== "error"
                  ? "AR·VR 미리보기를 종료하고 닫기"
                  : "닫기 (Esc)"}
              className={ICON_BUTTON}
              disabled={isCapturing}
              aria-disabled={deletingModelId !== null || undefined}
              onClick={requestUserClose}
            >
              <X size={17} aria-hidden />
            </button>
          </div>
        </header>
        <div
          aria-busy={isCapturing || undefined}
          inert={isCapturing}
          data-destructive-busy={deletingModelId !== null || undefined}
          className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,44dvh)_minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_360px] lg:grid-rows-1"
        >
          <StudioBg3dEditorViewport h={h} />
          <StudioBg3dEditorSidebar h={h} />
        </div>
      </div>
    </div>
  );
}
