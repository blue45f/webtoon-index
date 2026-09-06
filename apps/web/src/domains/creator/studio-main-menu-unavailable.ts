import type { StudioMainMenuBuilderState } from "./studio-main-menu-contract";
import type {
  StudioMainMenuGroup,
  StudioMainMenuItem,
} from "./studio-main-menu-model";

/**
 * Keyed by the item's **authoring** path (`legacyPath` when the §15.3 regroup
 * moved it), so relocating a command never changes the sentence a blocked user
 * reads.
 */
function unavailableReasonForDisabledMainMenuItem(
  groupId: string,
  itemId: string,
  state: StudioMainMenuBuilderState,
): string {
  if (groupId === "file") {
    if (state.collaborationDocumentLocked) {
      return "현재 문서가 협업 잠금 상태라 이 명령을 사용할 수 없습니다.";
    }
    if (itemId === "save-draft" || itemId === "publish") {
      if (state.saving) return "현재 저장 작업이 끝난 뒤 다시 시도하세요.";
      if (itemId === "publish" && state.sharedNonOwnerSave) {
        return "공동 문서의 게시 권한은 소유자에게 있습니다.";
      }
    }
    if (itemId === "export-archive" && state.projectArchiveBusy) {
      return "아카이브 백업을 만드는 중입니다.";
    }
    if (itemId === "import-psd" && state.psdImportBusy) {
      return "PSD 문서를 검사하는 중입니다.";
    }
    if (itemId === "import-ora-cbz" && state.interchangeImportBusy) {
      return "OpenRaster, CBZ 또는 WILL v1 문서를 검사하는 중입니다.";
    }
  }

  if (groupId === "edit") {
    if (itemId === "undo") return "되돌릴 편집 작업이 없거나 문서 편집이 잠겨 있습니다.";
    if (itemId === "redo") return "다시 적용할 편집 작업이 없거나 문서 편집이 잠겨 있습니다.";
    if (itemId === "select-all") {
      return "현재 페이지에 선택할 요소가 없거나 상호작용이 잠겨 있습니다.";
    }
    if (itemId === "deselect") return "현재 해제할 요소 또는 픽셀 선택이 없습니다.";
    if (itemId === "invert-selection") {
      return "편집 가능한 이미지의 픽셀 선택 영역이 필요합니다.";
    }
    if (itemId === "clear-selection") {
      return "지울 요소나 픽셀 선택 영역이 필요하며 진행 중인 픽셀 작업이 없어야 합니다.";
    }
    if (itemId === "crop-layer") return "편집 가능한 이미지 레이어가 필요합니다.";
    if (itemId.startsWith("paste")) {
      return "현재 문서 편집이 잠겨 있어 붙여넣을 수 없습니다.";
    }
    if (
      itemId === "bring-front"
      || itemId === "bring-forward"
      || itemId === "send-back"
      || itemId === "send-backward"
    ) {
      return "순서를 바꿀 요소 하나를 선택하고 문서 편집 잠금을 해제하세요.";
    }
    return "편집할 요소를 선택하거나 현재 문서 잠금을 해제하세요.";
  }

  if (groupId === "insert" && itemId === "page") {
    return "현재 문서가 협업 잠금 상태라 새 페이지를 추가할 수 없습니다.";
  }

  if (groupId === "view") {
    if (state.viewTransformSuppressed) {
      return "재생·캡처 등 보기 변환을 잠근 작업을 먼저 종료하세요.";
    }
    if (itemId === "reset-rotation") return "캔버스 보기가 이미 0°입니다.";
    if (itemId === "restore-view") return "먼저 ‘현재 보기 저장’을 실행하세요.";
    if (itemId === "reset-local-visibility") return "나만 숨긴 레이어가 없습니다.";
    if (itemId === "quick-access-palette") {
      return "빠른 액세스 팔레트를 불러오는 중입니다.";
    }
  }

  return "현재 편집 상태에서는 이 명령을 사용할 수 없습니다.";
}

export function withDisabledMainMenuReasons(
  groups: readonly StudioMainMenuGroup[],
  state: StudioMainMenuBuilderState,
): StudioMainMenuGroup[] {
  return groups.map((group) => ({
    ...group,
    items: group.items.map((item): StudioMainMenuItem => {
      if (!item.disabled || item.unavailableReason) return item;
      const [authoredGroup = group.id, authoredItem = item.id] = item.legacyPath
        ? item.legacyPath.split("/")
        : [];
      return {
        ...item,
        unavailableReason: unavailableReasonForDisabledMainMenuItem(
          authoredGroup,
          authoredItem,
          state,
        ),
      };
    }),
  }));
}
