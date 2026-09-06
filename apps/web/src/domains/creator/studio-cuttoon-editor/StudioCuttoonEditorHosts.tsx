/* Extracted render tree from StudioCuttoonEditor.
 * Session props are an `any` bag matching the original editor closure. */
// @ts-nocheck
"use no memo";
// React Compiler 옵트아웃: 가변 호스트 백(h) 을 렌더마다 재대입해 공유하는 추출 패턴이라,
// 컴파일러가 h 참조 동일성만 보고 JSX/계산을 캐시하면 첫 렌더에서 UI 가 영구 동결된다
// (탭 전환 등 커밋된 상태 변경이 화면에 반영되지 않음).
import { STUDIO_BRUSH_PACK_ACCEPT } from "../brush/studio-brush-pack-format";
import { STUDIO_CANVAS_IMAGE_ACCEPT } from "../studio-legacy-editor-runtime-helpers";
import { StudioDestructiveConfirmHost } from "../StudioDestructiveConfirmHost";
import { StudioVrmProjectArchiveAttestationHost } from "../vrm/StudioVrmProjectArchiveAttestationHost";
import type { StudioCuttoonEditorViewSession } from "./StudioCuttoonEditorViewSession";

export function StudioCuttoonEditorHosts(s: StudioCuttoonEditorViewSession) {
  const {
    brushPackImportInputRef,
    brushPackImporting,
    collaborationDocumentLocked,
    editMenuImageInputRef,
    handleBrushPackImportFromMenu,
    handleImportInterchangeArchive,
    handleImportProject,
    handleImportProjectArchive,
    handleImportPsd,
    interchangeImportBusy,
    interchangeImportInputRef,
    onPickImage,
    pagesHistoryDurabilityStatus,
    projectArchiveBusy,
    projectArchiveImportInputRef,
    projectImportInputRef,
    psdImportBusy,
    psdImportInputRef,
    retryStudioHistoryDurability,
    retryWatermarkPreferenceRuntime,
    watermarkPreferenceSnapshot,
  } = s;
  return (
    <>
    {/* 파괴적 명령 승인 표면. body 로 포털되므로 위치는 자유롭지만, 스튜디오 셸 안에 두어
        스튜디오가 살아 있는 동안에만 seam 을 소유하게 한다. */}
    <StudioDestructiveConfirmHost />
    <StudioVrmProjectArchiveAttestationHost />
    {pagesHistoryDurabilityStatus.state === "memory-only" ? (
      <div
        data-studio-pages-history-durability="memory-only"
        role="alert"
        aria-live="assertive"
        className="mx-3 mt-2 flex shrink-0 flex-wrap items-center gap-2 rounded-xl border border-danger/40 bg-danger-soft/20 px-3 py-2 text-xs text-danger"
      >
        <span className="min-w-0 flex-1 font-medium leading-relaxed">
          페이지 실행 취소 기록을 영구 저장하지 못하고 있습니다. 편집은 이 탭의 메모리에서
          계속되지만, 탭을 닫기 전에 프로젝트를 저장하거나 JSON 백업을 만들어 주세요.
        </span>
        <button
          type="button"
          onClick={retryStudioHistoryDurability}
          className="min-h-11 shrink-0 rounded-lg bg-danger/15 px-3 py-2 font-bold hover:bg-danger/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger"
        >
          복구 기록 저장소 다시 연결
        </button>
      </div>
    ) : pagesHistoryDurabilityStatus.state === "retrying" ? (
      <div
        data-studio-pages-history-durability="retrying"
        role="status"
        aria-live="polite"
        className="mx-3 mt-2 shrink-0 rounded-xl border border-warning/35 bg-warning-soft/20 px-3 py-2 text-xs font-medium text-warning"
      >
        복구 기록 저장소에 다시 연결하는 중입니다. 편집은 계속할 수 있습니다.
      </div>
    ) : null}
    {watermarkPreferenceSnapshot.state === "memory-only" ? (
      <div
        data-studio-watermark-persistence-warning="memory-only"
        role="alert"
        aria-live="assertive"
        className="mx-3 mt-2 flex shrink-0 flex-wrap items-center gap-2 rounded-xl border border-danger/40 bg-danger-soft/20 px-3 py-2 text-xs text-danger"
      >
        <span className="min-w-0 flex-1 font-medium leading-relaxed">
          {watermarkPreferenceSnapshot.message}
        </span>
        <button
          type="button"
          onClick={() => void retryWatermarkPreferenceRuntime()}
          className="min-h-11 shrink-0 rounded-lg bg-danger/15 px-3 py-2 font-bold hover:bg-danger/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger"
        >
          워터마크 저장소 다시 연결
        </button>
      </div>
    ) : null}
    <input
      ref={editMenuImageInputRef}
      type="file"
      accept={STUDIO_CANVAS_IMAGE_ACCEPT}
      className="hidden"
      aria-label="편집 메뉴에서 이미지 파일 붙여넣기"
      onChange={onPickImage}
    />
    {/* File-menu import pickers must live outside LazyStudioMenubarContent so clicks work
        even while the menubar chunk is still loading or canvas-only chrome is remounting.
        Same refs are still used by Menubar buttons. */}
    <div data-studio-document-import-inputs="true" className="hidden" aria-hidden>
      <input
        ref={projectImportInputRef}
        type="file"
        accept=".json"
        className="hidden"
        disabled={collaborationDocumentLocked}
        onChange={(event) => {
          void handleImportProject(event);
        }}
        aria-label="프로젝트 JSON 가져오기"
      />
      <input
        ref={projectArchiveImportInputRef}
        type="file"
        accept=".toonproject.zip,.zip,application/zip,application/vnd.toonspectrum.project+zip"
        className="hidden"
        disabled={projectArchiveBusy || collaborationDocumentLocked}
        onChange={(event) => void handleImportProjectArchive(event)}
        aria-label="프로젝트 아카이브 가져오기"
      />
      <input
        ref={brushPackImportInputRef}
        type="file"
        accept={STUDIO_BRUSH_PACK_ACCEPT}
        className="hidden"
        disabled={brushPackImporting}
        onChange={(event) => void handleBrushPackImportFromMenu(event)}
        aria-label="브러시 가져오기 (ABR · MYB · KPP · SUT · SUTG · Krita 번들 · JSON)"
      />
      <input
        ref={psdImportInputRef}
        type="file"
        accept=".psd,image/vnd.adobe.photoshop"
        className="hidden"
        disabled={psdImportBusy || interchangeImportBusy || collaborationDocumentLocked}
        onChange={(event) => void handleImportPsd(event)}
        aria-label="PSD 가져오기"
      />
      <input
        ref={interchangeImportInputRef}
        type="file"
        accept=".ora,.cbz,.will,image/openraster,application/vnd.comicbook+zip,application/vnd.toonspectrum.will-v1-bounded+zip"
        className="hidden"
        disabled={interchangeImportBusy || psdImportBusy || collaborationDocumentLocked}
        onChange={(event) => void handleImportInterchangeArchive(event)}
        aria-label="OpenRaster, CBZ 또는 WILL v1 가져오기"
      />
    </div>
    </>
  );
}
