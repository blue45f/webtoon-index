import {
  Bookmark,
  Box,
  Camera,
  ChevronDown,
  ChevronsRight,
  Clapperboard,
  ClipboardCheck,
  Download,
  Files,
  Folder,
  GanttChartSquare,
  History as HistoryIcon,
  Loader2,
  MapPinned,
  Maximize2,
  MessageCircle,
  Minimize2,
  Music4,
  Package,
  PlaySquare,
  Save,
  Scan,
  Send,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Redo2,
  Undo2,
  Upload,
  WandSparkles,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  Suspense,
  memo,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type ComponentProps,
  type Dispatch,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
  type RefObject,
  type SetStateAction,
} from "react";
import { createPortal } from "react-dom";

import { STUDIO_CANVAS_WIDTH as CANVAS_W } from "./canvas/studio-canvas-constants";
import {
  createStudioCommandExecutionBindings,
  installStudioCommandExecutionBindings,
} from "./studio-command-execution-registry";
import { createStudioMainMenuPresentation } from "./studio-main-menu-presentation";
import {
  StudioExportMenuPanel,
  StudioMainMenu,
  preloadStudioAssetMenuPanel,
  preloadStudioExportMenuPanel,
} from "./studio-page-lazy-ui";
import {
  DEFAULT_STUDIO_COMMAND_BAR,
  STUDIO_COMMAND_BAR_COMMAND_IDS,
  normalizeStudioCommandBarPreferences,
  setStudioCommandBarVisible,
  updateStudioCommandBarSlot,
  updateStudioWorkspaceLiveLayout,
} from "./studio-workspaces";
import { studioWriterRoomHasContent } from "./studio-writer-room";
import { StudioProjectCenterSearch, StudioProjectCenterSection } from "./StudioProjectCenterSearch";
import { StudioProjectReviewActions } from "./StudioProjectReviewActions";
import { StudioToolHintTarget } from "./StudioToolHint";
import { StudioWorkspaceMenuGate } from "./StudioWorkspaceMenuGate";

import type { StudioAiProvenanceDocument } from "./ai/studio-ai-provenance";
import type { ExportFormat } from "./export/studio-export";
import type { PsdExportResult } from "./export/studio-psd-export";
import type { SvgExportResult } from "./export/studio-svg-export";
import type { StudioWillV1PageExportResult } from "./export/studio-will-v1-export-bridge";
import type {
  StudioRasterEncoded,
  StudioRasterInterchangeFormat,
} from "./render/studio-raster-interchange";
import type { StudioCharacterBible } from "./studio-character-bible";
import type { StudioMenu } from "./studio-editor-tool-model";
import type { StudioInkMlExportResult } from "./studio-inkml-interchange";
import type { StudioProjectReviewActionHandlers } from "./studio-project-review-actions";
import type { StudioSharedDocument } from "./studio-shared-document-client";
import type { StudioToolHintSpec } from "./studio-tool-hints";
import type { StudioToolbarGroupId } from "./studio-toolbar-groups";
import type { WatermarkSettings } from "./studio-watermark";
import type {
  StudioCommandBarCommandId,
  StudioCommandBarPreferences,
  StudioCommandBarSlot,
  StudioWorkspaceDeviceKind,
  StudioWorkspaceId,
  StudioWorkspaceLayout,
  StudioWorkspaceLoadResult,
  StudioWorkspaceSaveResult,
  StudioWorkspaceState,
} from "./studio-workspaces";
import type { StudioWriterRoomDocument } from "./studio-writer-room";
import type { WorkDetail } from "@/src/infrastructure/creator-client";

import { buttonClass } from "@/shared/components/ui/button-utils";
import { useT } from "@/shared/lib/i18n";
import { cn } from "@/shared/lib/utils";

/**
 * 로케일 팩이 아직 그 키를 싣지 않았으면 저자 한글 문구를 그대로 쓴다.
 * (`resolveTranslation` 은 미등록 키에 대해 키 자체를 돌려준다 — 그게 유일한 "없음" 신호다.)
 * 형제 스튜디오 컴포넌트(`StudioMainMenu`)와 같은 관용구다.
 */
function localizeText(
  t: (key: string) => string,
  fallback: string,
  key: string,
): string {
  const translated = t(key);
  // 한국어 팩에 남은 이전 `임시저장` 번역만 새 서버 초안 용어로 승격한다. 다른 언어의
  // Save draft 번역은 건드리지 않고, 팩이 갱신되면 이 분기는 자연스럽게 타지 않는다.
  if (fallback === "초안 저장" && translated === "임시저장") return fallback;
  return translated === key ? fallback : translated;
}

/** `슬롯 {index}` 처럼 자리표시자를 가진 팩 문구용. 한글 폴백에는 자리표시자가 없어 무해하다. */
function localizeIndexedText(
  t: (key: string) => string,
  fallback: string,
  key: string,
  index: number,
): string {
  return localizeText(t, fallback, key).replaceAll("{index}", String(index));
}

const MENUBAR_HINTS = {
  undo: {
    id: "menubar-undo",
    title: "실행취소",
    description: "가장 최근의 캔버스 또는 선택 편집을 한 단계 되돌립니다.",
    shortcut: "⌘Z",
    preview: "undo",
  },
  redo: {
    id: "menubar-redo",
    title: "다시실행",
    description: "되돌린 캔버스 또는 선택 편집을 다시 적용합니다.",
    shortcut: "⌘⇧Z",
    preview: "redo",
  },
  history: {
    id: "menubar-history",
    title: "작업 내역",
    description: "이 문서의 편집 단계를 확인하고 원하는 시점으로 이동합니다.",
    preview: "history",
    tip: "중요한 시점은 프로젝트 메뉴의 버전 기능으로 별도 복구 지점에 저장할 수 있어요.",
  },
  assets: {
    id: "menubar-assets",
    title: "템플릿·에셋",
    description: "템플릿, 콜라주, 장면, 클립, 효과와 내 에셋 라이브러리를 엽니다.",
    preview: "assets",
    tip: "자주 쓰는 소재는 내 에셋에 모아 반복 작업 시간을 줄여보세요.",
  },
  bubbles: {
    id: "menubar-bubbles",
    title: "말풍선",
    description: "말풍선 라이브러리를 열어 형태를 고르고 현재 장면에 배치합니다.",
    preview: "bubble",
    previewVariant: "open-library",
    tip: "배치 후 우측 속성에서 꼬리, 테두리, 여백과 대사를 정교하게 다듬을 수 있어요.",
  },
  pages: {
    id: "menubar-pages",
    title: "페이지",
    description: "페이지 목록을 열어 추가·복제·순서를 바꿉니다.",
  },
  download: {
    id: "menubar-download",
    title: "현재 페이지 다운로드",
    description: "현재 페이지를 선택한 배율과 이미지 형식으로 즉시 내보냅니다.",
    preview: "export",
    tip: "인쇄·후편집은 고배율, 빠른 검토 공유는 1×를 권장해요.",
  },
  exportOptions: {
    id: "menubar-export-options",
    title: "내보내기 옵션",
    description: "배율, 파일 형식, 투명 배경, 워터마크와 플랫폼 프리셋을 설정합니다.",
    preview: "export-options",
  },
  project: {
    id: "menubar-project",
    title: "프로젝트 센터",
    description: "백업, 기획, 버전, 검수와 게시 도구를 한곳에서 검색해 엽니다.",
    preview: "project",
    tip: "장기 보관이나 다른 기기로 옮길 때는 자산이 포함된 아카이브 백업을 사용하세요.",
  },
  immersive: {
    id: "menubar-immersive",
    title: "전체 화면 드로잉",
    description: "사이트 헤더와 보조 UI를 숨기고 모바일 화면을 캔버스 작업에 집중합니다.",
    preview: "fullscreen",
    previewVariant: "fullscreen",
  },
  immersiveExit: {
    id: "menubar-immersive-exit",
    title: "전체 화면 드로잉 종료",
    description: "캔버스 집중 화면을 닫고 사이트 헤더와 모바일 창작 메뉴가 보이는 일반 작업 화면으로 돌아갑니다.",
    preview: "fullscreen",
    previewVariant: "exit-fullscreen",
  },
  draft: {
    id: "menubar-save-draft",
    title: "초안 저장",
    description: "현재 원고와 편집 상태를 게시하지 않고 서버 초안으로 저장합니다.",
    shortcut: "⌘S",
    preview: "save",
  },
  publish: {
    id: "menubar-publish",
    title: "게시하기",
    description: "현재 원고를 게시 상태로 저장합니다. 게시 전 사전검사에서 구조와 고지를 확인할 수 있어요.",
    preview: "publish",
  },
} satisfies Readonly<Record<string, StudioToolHintSpec>>;

const MENUBAR_OVERFLOW_HINT = {
  id: "menubar-overflow",
  title: "가려진 메뉴",
  description:
    "메뉴바 폭이 모자라 잘린 상위 메뉴 목록입니다. 고르면 그 메뉴가 보이는 위치로 이동하며 바로 열립니다.",
  tip: "폭이 넉넉해지면 이 버튼은 스스로 사라져요.",
} satisfies StudioToolHintSpec;

/** Hints for command-bar-only surfaces. Ids are globally unique across every hint spec. */
const COMMAND_BAR_HINTS = {
  zoomFit: {
    id: "menubar-zoom-fit",
    title: "화면 폭 맞춤",
    description: "캔버스 줌을 현재 작업 창에 맞춰 페이지 전체 폭이 한눈에 보이게 조정합니다.",
  },
  customize: {
    id: "menubar-command-bar-customize",
    title: "명령 바 설정",
    description: "메뉴바 아래 명령 바의 슬롯 구성과 표시 여부를 바꿉니다.",
    tip: "자주 쓰는 명령을 앞쪽 슬롯에 두면 손이 가장 빨리 닿아요.",
  },
} satisfies Readonly<Record<string, StudioToolHintSpec>>;

/**
 * User-facing names of the assignable command-bar commands (slot editor + aria labels).
 * 힌트 제목이 단일 출처다 — 라벨 문자열을 다시 쓰면 툴팁과 aria-label이 서로 어긋난다.
 */
const COMMAND_BAR_COMMAND_LABELS: Readonly<Record<StudioCommandBarCommandId, string>> = {
  undo: MENUBAR_HINTS.undo.title,
  redo: MENUBAR_HINTS.redo.title,
  save: MENUBAR_HINTS.draft.title,
  publish: MENUBAR_HINTS.publish.title,
  download: MENUBAR_HINTS.download.title,
  "export-open": MENUBAR_HINTS.exportOptions.title,
  "zoom-fit": COMMAND_BAR_HINTS.zoomFit.title,
  assets: MENUBAR_HINTS.assets.title,
  bubbles: MENUBAR_HINTS.bubbles.title,
  project: MENUBAR_HINTS.project.title,
};

/**
 * 이 스트립이 화면에서 **유일한** 컨트롤인 명령들.
 *
 * 나머지 명령은 고정 메뉴바 컨트롤과 이름이 그대로 겹친다 — 초안 저장·게시하기는 액션 레인
 * (`data-studio-menubar-actions`), 현재 페이지 다운로드·내보내기 옵션은 내보내기 클러스터,
 * 템플릿·에셋·말풍선은 xl 삽입 바로가기, 프로젝트 센터은 프로젝트 시트 트리거. 한 화면에
 * 같은 접근명이 둘이면 스크린리더는 물론 자동화(`getByRole("button", { name })`)도 갈라내지
 * 못하므로 그쪽 슬롯은 슬롯 번호로 한정한 접근명을 쓴다.
 *
 * 여기 셋은 겹치는 짝이 없어 정식 명령명을 그대로 유지한다. 접두어를 붙이면
 * `scripts/verify-studio-lifecycle.mts` 의 `button[aria-label="실행취소"]` 조회가 0건이 되고,
 * 되돌리기/다시실행은 이제 이 스트립 말고는 어디에도 없다.
 */
const COMMAND_BAR_SOLE_AUTHORITY_COMMANDS: ReadonlySet<StudioCommandBarCommandId> = new Set([
  "undo",
  "redo",
  "zoom-fit",
]);

/**
 * 슬롯별 접근명. 같은 명령을 여러 슬롯에 담는 것이 허용되므로(`normalizeStudioCommandBar…`)
 * 유일성의 근거는 **슬롯 번호**다 — 정식 명령명은 "이 스트립이 유일한 주인이고, 그 명령의
 * 첫 슬롯"일 때만 쓰고 나머지는 전부 번호로 갈린다.
 */
function resolveStudioCommandBarSlotNames(
  slots: readonly StudioCommandBarSlot[],
  labelOf: (commandId: StudioCommandBarCommandId) => string,
  slotLabelOf: (slotNumber: number) => string,
): readonly (string | null)[] {
  const claimed = new Set<StudioCommandBarCommandId>();
  return slots.map((slot, index) => {
    if (slot === null) return null;
    const label = labelOf(slot);
    const keepsPlainName =
      COMMAND_BAR_SOLE_AUTHORITY_COMMANDS.has(slot) && !claimed.has(slot);
    claimed.add(slot);
    return keepsPlainName ? label : `${slotLabelOf(index + 1)}: ${label}`;
  });
}

/** One slot command bound to the executor seam the menubar already owns for it. */
interface StudioMenubarCommandBinding {
  label: string;
  /** Locale key for `label`; the Korean literal above stays the fallback. */
  labelKey: string;
  icon: LucideIcon;
  hint: StudioToolHintSpec;
  run: () => void;
  disabled?: boolean;
  unavailableReason?: string;
}

/**
 * §15.3 Window ▸ Action Bar — the fixed undo/redo/history cluster, extended into a
 * user-configurable slotted command strip (CSP 커맨드 바 parity).
 *
 * **메뉴 레인과 다른 행이다.** CSP 의 명령 바가 메뉴 바 아래 자기 줄을 갖는 것과 같고,
 * 그래야 하는 실증적 이유도 있다: 같은 줄에 두면 8개 슬롯이 가로폭을 먹어 1600px 에서도
 * 상위 메뉴 3개가 오버플로로 밀려났다(`verify:studio-icons` 의 2xl chevron 계약 실패).
 * 그래서 이 스트립은 오버플로 실측기가 재는 레인(`data-studio-menubar-primary`) **밖**,
 * 두 번째 행에 산다 — 레인 폭 계산에 아예 참여하지 않는다.
 *
 * Slots execute through the same handler backpack the fixed menubar buttons already use — no
 * second dispatch path. History and the slot editor stay fixed at the strip's end so the desktop
 * history authority and the way back from "slots hidden" can never be customized away.
 */
function StudioMenubarCommandBar({
  preferences,
  bindings,
  historyPanelOpen,
  onToggleHistoryPanel,
  onPreferencesChange,
  hidden,
}: {
  preferences: StudioCommandBarPreferences;
  bindings: Readonly<Record<StudioCommandBarCommandId, StudioMenubarCommandBinding>>;
  historyPanelOpen: boolean;
  onToggleHistoryPanel: () => void;
  onPreferencesChange: (next: StudioCommandBarPreferences) => void;
  hidden: boolean;
}): ReactElement {
  const t = useT();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsButtonRef = useRef<HTMLButtonElement | null>(null);
  const settingsPanelRef = useRef<HTMLDivElement | null>(null);
  const settingsPanelId = useId();
  const [settingsCoords, setSettingsCoords] = useState({ top: 44, right: 12 });

  const closeSettings = useCallback((restoreFocus: boolean) => {
    setSettingsOpen(false);
    if (restoreFocus) settingsButtonRef.current?.focus({ preventScroll: true });
  }, []);

  const openSettings = useCallback(() => {
    const rect = settingsButtonRef.current?.getBoundingClientRect();
    if (rect && typeof window !== "undefined") {
      setSettingsCoords({
        top: rect.bottom + 6,
        right: Math.max(8, window.innerWidth - rect.right),
      });
    }
    setSettingsOpen(true);
  }, []);

  useEffect(() => {
    if (!settingsOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (
        settingsButtonRef.current?.contains(target)
        || settingsPanelRef.current?.contains(target)
      ) {
        return;
      }
      setSettingsOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      closeSettings(true);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [closeSettings, settingsOpen]);

  const labelOf = (commandId: StudioCommandBarCommandId) =>
    localizeText(t, bindings[commandId].label, bindings[commandId].labelKey);
  const slotLabelOf = (slotNumber: number) =>
    localizeIndexedText(t, `슬롯 ${slotNumber}`, "studio.commandBar.slot", slotNumber);
  const slotNames = resolveStudioCommandBarSlotNames(
    preferences.slots,
    labelOf,
    slotLabelOf
  );
  const settingsLabel = localizeText(t, "명령 바 설정", "studio.commandBar.settings");
  // 힌트 사본도 팩을 따른다 — 툴팁만 한글로 남으면 같은 컨트롤이 두 언어로 말한다.
  const customizeHint: StudioToolHintSpec = {
    ...COMMAND_BAR_HINTS.customize,
    title: settingsLabel,
    description: localizeText(
      t,
      COMMAND_BAR_HINTS.customize.description,
      "studio.commandBar.settingsDescription"
    ),
    tip: localizeText(
      t,
      COMMAND_BAR_HINTS.customize.tip ?? "",
      "studio.commandBar.settingsTip"
    ),
  };

  return (
    <div
      role="group"
      aria-label={localizeText(t, "빠른 명령 바", "studio.commandBar.aria")}
      data-studio-menubar-command-bar="true"
      className={cn(
        // 자기 줄이라 `shrink-0` 도 `flex-1` 도 필요 없다 — 메뉴 레인과 폭을 다투지 않고,
        // 세로 스택의 stretch 로 행 전체를 채운다. 음수 마진이 호스트 셸의 좌우 패딩까지
        // 덮어 구분선이 메뉴바 전폭을 가로지르고, 같은 크기의 패딩을 되돌려 슬롯은 위 행의
        // 컨트롤과 같은 세로선에서 시작한다.
        "hidden min-h-9 items-center gap-0.5 border-t border-line/60 md:flex",
        "-mx-2.5 px-2.5 sm:-mx-3 sm:px-3",
        hidden && "!hidden"
      )}
    >
      {preferences.visible
        ? preferences.slots.map((slot, index) => {
            if (slot === null) return null;
            const binding = bindings[slot];
            const accessibleName = slotNames[index] ?? binding.label;
            return (
              <StudioToolHintTarget
                // Duplicate commands across slots are allowed, so key by position + command.
                key={`${index}:${slot}`}
                hint={binding.hint}
                disabled={binding.disabled}
                unavailableReason={binding.disabled ? binding.unavailableReason : undefined}
                preferredSide="bottom"
              >
                <button
                  type="button"
                  onClick={binding.run}
                  disabled={binding.disabled}
                  // 접근명 규칙은 `resolveStudioCommandBarSlotNames` 참조 — 고정 메뉴바
                  // 컨트롤과 이름이 겹치는 명령만 슬롯 번호로 한정한다. 자동화는 이름 대신
                  // 아래 `data-studio-command-bar-command` 로 명령을 집는 편이 안전하다.
                  aria-label={accessibleName}
                  data-studio-command-bar-slot={index}
                  data-studio-command-bar-command={slot}
                  data-studio-primary-action={slot === "undo" || slot === "redo" ? slot : undefined}
                  className={buttonClass({
                    size: "sm",
                    variant: "quiet",
                    className: "min-h-9 min-w-9 px-0 disabled:opacity-35",
                  })}
                >
                  <binding.icon size={14} aria-hidden />
                </button>
              </StudioToolHintTarget>
            );
          })
        : null}
      {/* The desktop history authority stays fixed: pointer commits, keyboard users, screen
          readers, and automation share this one control even when the slots hide it-alikes. */}
      <StudioToolHintTarget hint={MENUBAR_HINTS.history} preferredSide="bottom">
        <button
          type="button"
          onClick={onToggleHistoryPanel}
          aria-label="작업 내역"
          aria-pressed={historyPanelOpen}
          className={buttonClass({
            size: "sm",
            variant: historyPanelOpen ? "solid" : "quiet",
            className: "min-h-9 min-w-9 px-0",
          })}
        >
          <HistoryIcon size={14} aria-hidden />
        </button>
      </StudioToolHintTarget>
      {/* Fixed as well — hiding the slots must never hide the way to bring them back. */}
      <StudioToolHintTarget hint={customizeHint} preferredSide="bottom">
        <button
          ref={settingsButtonRef}
          type="button"
          onClick={() => (settingsOpen ? closeSettings(true) : openSettings())}
          aria-label={settingsLabel}
          aria-haspopup="dialog"
          aria-expanded={settingsOpen}
          aria-controls={settingsOpen ? settingsPanelId : undefined}
          data-studio-command-bar-settings-trigger="true"
          className={buttonClass({
            size: "sm",
            variant: settingsOpen ? "solid" : "quiet",
            className: "min-h-9 min-w-9 px-0",
          })}
        >
          <Settings2 size={14} aria-hidden />
        </button>
      </StudioToolHintTarget>
      {settingsOpen && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={settingsPanelRef}
              id={settingsPanelId}
              role="dialog"
              aria-label={settingsLabel}
              data-studio-command-bar-settings-panel="true"
              data-studio-shortcut-boundary="true"
              style={{ top: settingsCoords.top, right: settingsCoords.right }}
              className="fixed z-[100] max-h-[min(70dvh,28rem)] w-72 overflow-y-auto overscroll-contain rounded-2xl border border-line bg-panel p-3 shadow-2xl"
            >
              <div className="flex items-center justify-between gap-2 border-b border-line/60 pb-2">
                <span>
                  <span className="block text-xs font-bold text-fg">{settingsLabel}</span>
                  <span className="mt-0.5 block text-[0.65rem] text-fg-3">
                    {localizeText(
                      t,
                      "슬롯 구성은 이 브라우저의 작업공간 설정에 저장돼요.",
                      "studio.commandBar.settingsStorageNote"
                    )}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => closeSettings(true)}
                  aria-label={localizeText(
                    t,
                    "명령 바 설정 닫기",
                    "studio.commandBar.settingsClose"
                  )}
                  className="grid size-9 shrink-0 place-items-center rounded-lg text-fg-3 transition-colors hover:bg-raised hover:text-fg"
                >
                  <X size={15} aria-hidden />
                </button>
              </div>
              <label className="flex min-h-10 cursor-pointer items-center gap-2 border-b border-line/60 py-1 text-[0.75rem] font-medium text-fg-2">
                <input
                  type="checkbox"
                  checked={preferences.visible}
                  onChange={(event) =>
                    onPreferencesChange(
                      setStudioCommandBarVisible(preferences, event.target.checked)
                    )
                  }
                  className="size-4 accent-accent"
                />
                {localizeText(t, "명령 슬롯 표시", "studio.commandBar.showSlots")}
              </label>
              <div className="flex flex-col gap-1 py-2">
                {preferences.slots.map((slot, index) => (
                  <label
                    // Slot rows are positional; the index is the slot's identity.
                    key={index}
                    className="flex min-h-9 items-center justify-between gap-2 text-[0.72rem] text-fg-3"
                  >
                    <span className="shrink-0 tabular-nums">{slotLabelOf(index + 1)}</span>
                    <select
                      value={slot ?? ""}
                      onChange={(event) => {
                        const value = event.target.value;
                        onPreferencesChange(
                          updateStudioCommandBarSlot(
                            preferences,
                            index,
                            value === "" ? null : (value as StudioCommandBarCommandId)
                          )
                        );
                      }}
                      aria-label={localizeIndexedText(
                        t,
                        `명령 슬롯 ${index + 1}`,
                        "studio.commandBar.slotAria",
                        index + 1
                      )}
                      className="min-h-9 w-44 rounded-lg border border-line bg-canvas px-2 text-[0.75rem] text-fg"
                    >
                      <option value="">
                        {localizeText(t, "빈 슬롯", "studio.commandBar.slotEmpty")}
                      </option>
                      {STUDIO_COMMAND_BAR_COMMAND_IDS.map((commandId) => (
                        <option key={commandId} value={commandId}>
                          {labelOf(commandId)}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              <button
                type="button"
                onClick={() => onPreferencesChange(DEFAULT_STUDIO_COMMAND_BAR)}
                className={buttonClass({
                  size: "sm",
                  variant: "quiet",
                  className: "min-h-9 w-full justify-center border border-line/70",
                })}
              >
                {localizeText(
                  t,
                  "기본 구성으로 되돌리기",
                  "studio.commandBar.resetDefaults"
                )}
              </button>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}

/** 메뉴바 가로 레인의 실측 상태 — 폭 브레이크포인트가 아니라 기하로만 판정한다. */
export interface StudioMenubarLaneOverflow {
  /** 오른쪽으로 더 볼 내용이 남아 있는가(페이드 큐의 유일한 근거). */
  scrollable: boolean;
  /** 레인 밖으로 잘려 마우스로 못 누르는 상위 메뉴 그룹 id. */
  hiddenGroupIds: readonly string[];
}

export interface StudioMenubarTriggerBox {
  id: string;
  left: number;
  right: number;
}

const MENUBAR_OVERFLOW_EPSILON = 1;

/**
 * D9 회귀의 근본 원인 교정 — 오버플로 여부는 **폭 브레이크포인트가 아니라 실측**이다.
 *
 * §15.3 메뉴 그룹이 17개(+transform)로 늘어난 뒤로는 1920px에서도 마지막 그룹이 잘린다.
 * `xl:hidden` 같은 폭 게이트는 "데스크톱이면 다 보인다"는 이제 거짓인 가정을 인코딩한 것이라
 * 데스크톱에서 스크롤 단서도, 마우스로 도달할 방법도 함께 사라졌다.
 */
// 이 순수 해석기를 여기 두는 것은 의도적이다 — 오버플로 판정이 이 메뉴바 마크업과 한 몸이라
// 같은 파일에서 회귀 테스트되어야 한다(레이아웃과 판정이 갈라지면 D9 가 조용히 돌아온다).
// eslint-disable-next-line react-refresh/only-export-components
export function resolveStudioMenubarLaneOverflow(
  lane: { left: number; right: number; scrollLeft: number; scrollWidth: number; clientWidth: number; },
  triggers: readonly StudioMenubarTriggerBox[],
): StudioMenubarLaneOverflow {
  const scrollable =
    lane.clientWidth > 0
    && lane.scrollWidth - lane.scrollLeft - lane.clientWidth > MENUBAR_OVERFLOW_EPSILON;
  const hiddenGroupIds = triggers
    .filter((trigger) => trigger.right - trigger.left > 0)
    .filter(
      (trigger) =>
        trigger.left < lane.left - MENUBAR_OVERFLOW_EPSILON
        || trigger.right > lane.right + MENUBAR_OVERFLOW_EPSILON,
    )
    .map((trigger) => trigger.id);
  return { scrollable, hiddenGroupIds };
}

const EMPTY_LANE_OVERFLOW: StudioMenubarLaneOverflow = Object.freeze({
  scrollable: false,
  hiddenGroupIds: Object.freeze([]) as readonly string[],
});

function measureStudioMenubarLaneOverflow(
  lane: HTMLElement | null,
): StudioMenubarLaneOverflow {
  if (!lane) return EMPTY_LANE_OVERFLOW;
  const laneRect = lane.getBoundingClientRect();
  if (laneRect.width <= 0) return EMPTY_LANE_OVERFLOW;
  const triggers: StudioMenubarTriggerBox[] = [];
  for (const node of lane.querySelectorAll<HTMLElement>("[data-studio-main-menu-trigger]")) {
    const id = node.dataset.studioMainMenuTrigger;
    if (!id) continue;
    const rect = node.getBoundingClientRect();
    triggers.push({ id, left: rect.left, right: rect.right });
  }
  return resolveStudioMenubarLaneOverflow(
    {
      left: laneRect.left,
      right: laneRect.right,
      scrollLeft: lane.scrollLeft,
      scrollWidth: lane.scrollWidth,
      clientWidth: lane.clientWidth,
    },
    triggers,
  );
}

function sameGroupIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

/**
 * 잘린 메뉴 그룹으로 가는 정본 진입점. 스크롤 힌트와 달리 Tab 으로 닿고 Enter 로 열리며,
 * 실제 열기는 `StudioMainMenu` 트리거에 위임해 드롭다운 구현을 이중화하지 않는다.
 */
function StudioMenubarOverflowMenu({
  groups,
  onReveal,
}: {
  groups: readonly { id: string; label: string; }[];
  onReveal: (groupId: string) => void;
}): ReactElement | null {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [coords, setCoords] = useState({ top: 44, right: 12 });

  const closeMenu = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) buttonRef.current?.focus({ preventScroll: true });
  }, []);

  const openMenu = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect && typeof window !== "undefined") {
      setCoords({
        top: rect.bottom + 6,
        right: Math.max(8, window.innerWidth - rect.right),
      });
    }
    setOpen(true);
  }, []);

  // 목록은 실측이라 상호작용 도중에도 비워질 수 있다(창을 넓히면 곧바로 0개).
  const hasGroups = groups.length > 0;
  useEffect(() => {
    if (!hasGroups) setOpen(false);
  }, [hasGroups]);

  useEffect(() => {
    if (!open) return;
    itemRefs.current[0]?.focus({ preventScroll: true });
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (buttonRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      closeMenu(true);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [closeMenu, open]);

  const focusItem = (index: number) => {
    if (groups.length === 0) return;
    const next = (index + groups.length) % groups.length;
    itemRefs.current[next]?.focus({ preventScroll: true });
  };

  const handlePanelKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const currentIndex = Number(
      (event.target as HTMLElement | null)?.getAttribute?.("data-studio-menubar-overflow-index"),
    );
    const index = Number.isSafeInteger(currentIndex) ? currentIndex : 0;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusItem(index + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusItem(index - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusItem(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusItem(groups.length - 1);
    }
  };

  if (!hasGroups) return null;

  return (
    <div className="relative flex shrink-0 items-center" data-studio-menubar-overflow="true">
      <StudioToolHintTarget hint={MENUBAR_OVERFLOW_HINT} preferredSide="bottom">
        <button
          ref={buttonRef}
          type="button"
          data-studio-menubar-overflow-menu="true"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          aria-label={`가려진 메뉴 ${groups.length}개`}
          onClick={() => (open ? closeMenu(true) : openMenu())}
          onKeyDown={(event) => {
            if (event.key !== "ArrowDown" || open) return;
            event.preventDefault();
            openMenu();
          }}
          className={cn(
            buttonClass({ size: "sm", variant: open ? "solid" : "quiet" }),
            "min-h-9 shrink-0 gap-0.5 px-1.5 text-[0.72rem] font-semibold tabular-nums"
          )}
        >
          <ChevronsRight size={14} aria-hidden />
          {groups.length}
        </button>
      </StudioToolHintTarget>
      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={panelRef}
              id={panelId}
              role="menu"
              aria-label="가려진 메뉴"
              tabIndex={-1}
              data-studio-menubar-overflow-panel="true"
              data-studio-shortcut-boundary="true"
              onKeyDown={handlePanelKeyDown}
              style={{ top: coords.top, right: coords.right }}
              className="fixed z-[100] max-h-[min(70dvh,26rem)] min-w-44 overflow-y-auto overscroll-contain rounded-2xl border border-line bg-panel py-1.5 shadow-2xl"
            >
              {groups.map((group, index) => (
                <button
                  key={group.id}
                  ref={(node) => {
                    itemRefs.current[index] = node;
                  }}
                  type="button"
                  role="menuitem"
                  tabIndex={index === 0 ? 0 : -1}
                  data-studio-menubar-overflow-item={group.id}
                  data-studio-menubar-overflow-index={index}
                  onClick={() => {
                    setOpen(false);
                    onReveal(group.id);
                  }}
                  className="mx-1 flex w-[calc(100%-0.5rem)] items-center gap-2 rounded-xl px-2.5 py-2 text-left text-[0.78rem] font-medium text-fg-2 transition-colors hover:bg-raised hover:text-fg focus-visible:bg-raised focus-visible:text-fg"
                >
                  {group.label}
                </button>
              ))}
            </div>,
            document.body
          )
        : null}
    </div>
  );
}

/**
 * 검수·미리보기 진입점 7종. 예전에는 툴벨트에만 트리거가 있었는데 벨트 호스트가
 * 전 뷰포트에서 `display:none`이라 도달 불가였다 — `StudioProjectReviewActions` 상단 주석 참조.
 * `useStudioStableHandlers` 계약상 핸들러 백은 평면(함수만)이어야 해서 여기에 펼쳐 둔다.
 */
export interface StudioMenubarContentHandlers extends StudioProjectReviewActionHandlers {
  applyStudioWorkspaceLayout: (
    layout: StudioWorkspaceLayout,
    workspaceId?: StudioWorkspaceId,
  ) => void;
  cancelInterchangeImport: () => void;
  changeMobileImmersiveMode: (enabled: boolean) => void;
  ensureWatermarkLoaded: () => Promise<WatermarkSettings>;
  exportCurrentPageToPsd: () => Promise<PsdExportResult>;
  exportCurrentPageToRasterInterchange: (
    format: StudioRasterInterchangeFormat
  ) => Promise<StudioRasterEncoded>;
  exportCurrentPageToInkMl: () => Promise<StudioInkMlExportResult>;
  exportCurrentPageToWillV1: () => Promise<StudioWillV1PageExportResult>;
  exportCurrentPageToSvg: () => Promise<SvgExportResult>;
  handleCapturePagesForPreset: (scope: "current" | "all") => Promise<HTMLCanvasElement[]>;
  handleCapturePagesForIndices: (indices: number[]) => Promise<HTMLCanvasElement[]>;
  handleCopyToClipboard: () => Promise<void>;
  handleDownload: () => Promise<void>;
  handleDownloadAll: (spacing?: number) => Promise<void>;
  handleExportProject: () => void;
  handleExportProjectArchive: () => Promise<void>;
  handleImportProject: (e: ChangeEvent<HTMLInputElement>) => void;
  handleImportProjectArchive: (e: ChangeEvent<HTMLInputElement>) => Promise<void>;
  handleImportInterchangeArchive: (e: ChangeEvent<HTMLInputElement>) => Promise<void>;
  handleImportPsd: (e: ChangeEvent<HTMLInputElement>) => Promise<void>;
  handleSave: (status: "published" | "draft") => Promise<void>;
  openAutoActions: () => Promise<void>;
  openMannequinPoser?: () => void;
  openOwnerFxPanel: () => Promise<void>;
  redo: () => void;
  persistStudioWorkspaceState: (nextState: StudioWorkspaceState) => StudioWorkspaceSaveResult;
  setWatermark: (next: WatermarkSettings) => void;
  toggleHistoryPanel: () => void;
  undo: () => void;
  /**
   * Optional until StudioPage wires it: fits the canvas zoom to the working width. The command
   * bar's zoom-fit slot disables itself with a reason while the host has not provided it.
   */
  zoomToFit?: () => void;
  togglePageSequence?: () => void;
}

export interface StudioMenubarContentProps {
  activePageLabel: string;
  activeToolbarGroup: StudioToolbarGroupId | null;
  aiProvenance: StudioAiProvenanceDocument;
  canvasH: number;
  characterBible: StudioCharacterBible;
  collaborationDocumentLocked: boolean;
  collaborationLockMessage: () => string;
  currentWorkspaceOwnerScope: string;
  displayLinkedTitleId: string | null | undefined;
  exportFormat: ExportFormat;
  exportMenuOpen: boolean;
  exportMenuRef: RefObject<HTMLDivElement | null>;
  exportPresetId: string | null;
  exportScale: number;
  exportTransparent: boolean;
  fxPanelLoading: boolean;
  isExporting: boolean;
  isMobile: boolean;
  liveWorkspaceLayout: StudioWorkspaceLayout;
  /** Samples the input surface in use, for device-aware workspace resolution. */
  resolveWorkspaceDeviceKind: () => StudioWorkspaceDeviceKind | null;
  loadedWork: WorkDetail | null;
  masterEditMode: boolean;
  menu: StudioMenu | null;
  mobileImmersive: boolean;
  historyPanelOpen: boolean;
  /** 미해결 문서 댓글 수 — 프로젝트 시트의 댓글 진입점 배지. */
  openStudioCommentCount: number;
  pageCount: number;
  /** 현재 페이지가 검토 잠금인지 — 페이지 검토 진입점 라벨에 반영. */
  pageEditLocked: boolean;
  pageLabels: string[];
  /** Optional story pages for dialogue TXT package export preflight. */
  dialoguePages?: readonly import( "./lettering/studio-dialogue-batch").DialoguePageLike[] | null;
  projectActionsOpen: boolean;
  projectActionsRef: RefObject<HTMLDivElement | null>;
  projectArchiveBusy: boolean;
  projectArchiveImportInputRef: RefObject<HTMLInputElement | null>;
  projectArchiveStatus: { tone: "good" | "warn" | "bad"; text: string; } | null;
  projectImportInputRef: RefObject<HTMLInputElement | null>;
  interchangeImportBusy: boolean;
  interchangeImportInputRef: RefObject<HTMLInputElement | null>;
  interchangeImportStatus: { tone: "good" | "warn" | "bad"; text: string; } | null;
  psdImportBusy: boolean;
  psdImportInputRef: RefObject<HTMLInputElement | null>;
  psdImportStatus: { tone: "good" | "warn"; text: string; } | null;
  saving: boolean;
  redoDisabled: boolean;
  setAiProvenanceOpen: Dispatch<SetStateAction<boolean>>;
  setAnimaticTimelineOpen: Dispatch<SetStateAction<boolean>>;
  setAssetRightsAuditOpen: Dispatch<SetStateAction<boolean>>;
  setCharacterBibleOpen: Dispatch<SetStateAction<boolean>>;
  setCheckpointPanelOpen: Dispatch<SetStateAction<boolean>>;
  setProductionBibleOpen: Dispatch<SetStateAction<boolean>>;
  setHybridDccOpen: Dispatch<SetStateAction<boolean>>;
  setSceneSnapshotOpen: Dispatch<SetStateAction<boolean>>;
  setExportFormat: Dispatch<SetStateAction<ExportFormat>>;
  setExportMenuOpen: Dispatch<SetStateAction<boolean>>;
  setExportPresetId: Dispatch<SetStateAction<string | null>>;
  setExportScale: Dispatch<SetStateAction<number>>;
  setExportTransparent: Dispatch<SetStateAction<boolean>>;
  setMenu: Dispatch<SetStateAction<StudioMenu | null>>;
  setProductionInsightsOpen: Dispatch<SetStateAction<boolean>>;
  setProjectActionsOpen: Dispatch<SetStateAction<boolean>>;
  setPublicationOperationsOpen: Dispatch<SetStateAction<boolean>>;
  setPublishPackageOpen: Dispatch<SetStateAction<boolean>>;
  setPublishPreflightOpen: Dispatch<SetStateAction<boolean>>;
  setWriterRoomOpen: Dispatch<SetStateAction<boolean>>;
  sharedDocument: StudioSharedDocument | null;
  studioMainMenuGroups: ComponentProps<typeof StudioMainMenu>["groups"];
  title: string;
  undoDisabled: boolean;
  pageSequenceOpen?: boolean;
  watermark: WatermarkSettings;
  workId: string | null;
  workspaceMenuEpoch: number;
  workspacePersistence: StudioWorkspaceLoadResult;
  workspaceState: StudioWorkspaceState;
  workspaceSyncNotice: string | null;
  writerRoom: StudioWriterRoomDocument;
  stableHandlers: StudioMenubarContentHandlers;
}

export const StudioMenubarContent = memo(function StudioMenubarContent({
  activePageLabel,
  activeToolbarGroup,
  aiProvenance,
  canvasH,
  characterBible,
  collaborationDocumentLocked,
  collaborationLockMessage,
  currentWorkspaceOwnerScope,
  displayLinkedTitleId,
  exportFormat,
  exportMenuOpen,
  exportMenuRef,
  exportPresetId,
  exportScale,
  exportTransparent,
  fxPanelLoading,
  isExporting,
  isMobile,
  liveWorkspaceLayout,
  resolveWorkspaceDeviceKind,
  loadedWork,
  masterEditMode,
  menu,
  mobileImmersive,
  historyPanelOpen,
  openStudioCommentCount,
  pageCount,
  pageEditLocked,
  pageLabels,
  dialoguePages = null,
  projectActionsOpen,
  projectActionsRef,
  projectArchiveBusy,
  projectArchiveImportInputRef,
  projectArchiveStatus,
  projectImportInputRef,
  interchangeImportBusy,
  interchangeImportInputRef,
  interchangeImportStatus,
  psdImportBusy,
  psdImportInputRef,
  psdImportStatus,
  saving,
  redoDisabled,
  setAiProvenanceOpen,
  setAnimaticTimelineOpen,
  setAssetRightsAuditOpen,
  setCharacterBibleOpen,
  setCheckpointPanelOpen,
  setProductionBibleOpen,
  setHybridDccOpen,
  setSceneSnapshotOpen,
  setExportFormat,
  setExportMenuOpen,
  setExportPresetId,
  setExportScale,
  setExportTransparent,
  setMenu,
  setProductionInsightsOpen,
  setProjectActionsOpen,
  setPublicationOperationsOpen,
  setPublishPackageOpen,
  setPublishPreflightOpen,
  setWriterRoomOpen,
  sharedDocument,
  studioMainMenuGroups,
  title,
  undoDisabled,
  pageSequenceOpen = false,
  watermark,
  workId,
  workspaceMenuEpoch,
  workspacePersistence,
  workspaceState,
  workspaceSyncNotice,
  writerRoom,
  stableHandlers,
}: StudioMenubarContentProps) {
  const {
    applyStudioWorkspaceLayout,
    cancelInterchangeImport,
    changeMobileImmersiveMode,
    ensureWatermarkLoaded,
    handleCopyToClipboard,
    handleDownload,
    handleDownloadAll,
    handleExportProject,
    handleExportProjectArchive,
    // Import onChange handlers live on StudioPage root inputs (ref-click only here).
    handleSave,
    openAutoActions,
    openOwnerFxPanel,
    redo,
    persistStudioWorkspaceState,
    setWatermark,
    toggleHistoryPanel,
    undo,
    zoomToFit,
    exportCurrentPageToPsd,
    exportCurrentPageToRasterInterchange,
    exportCurrentPageToInkMl,
    exportCurrentPageToWillV1,
    exportCurrentPageToSvg,
    handleCapturePagesForPreset,
    handleCapturePagesForIndices,
    toggleAnimationTimeline,
    openTimelapse,
    openStoryboardGrid,
    openScrollPreview,
    openContinuityCheck,
    toggleDocumentComments,
    openPageReview,
    togglePageSequence,
  } = stableHandlers;
  const commentsLocked =
    collaborationDocumentLocked && !sharedDocument?.capabilities.view;

  // Composite titles take a shipped translation when the pack has one and fall back to
  // the catalogue's own language otherwise (same escape hatch the Help group uses).
  const menuT = useT();
  const compositeMenuLabel = (id: "insert"): string | undefined => {
    const key = `studio.mainMenu.group.${id}.label`;
    const translated = menuT(key);
    return translated === key ? undefined : translated;
  };
  const mainMenuPresentation = createStudioMainMenuPresentation(studioMainMenuGroups, {
    labels: { insert: compositeMenuLabel("insert") },
  });
  const presentedStudioMainMenuGroups = mainMenuPresentation.groups;

  // Unified search executes only explicitly reviewed rows, using the menu's own closure.
  // This is the first safe slice of the CommandRegistry strangler: no second implementation.
  useEffect(
    () =>
      installStudioCommandExecutionBindings(
        createStudioCommandExecutionBindings(studioMainMenuGroups),
      ),
    [studioMainMenuGroups],
  );

  const menubarLaneRef = useRef<HTMLDivElement | null>(null);
  const [laneOverflow, setLaneOverflow] = useState<StudioMenubarLaneOverflow>(
    EMPTY_LANE_OVERFLOW
  );

  useEffect(() => {
    const lane = menubarLaneRef.current;
    if (!lane) return;
    let frame = 0;
    const sync = () => {
      frame = 0;
      const next = measureStudioMenubarLaneOverflow(lane);
      setLaneOverflow((prev) =>
        prev.scrollable === next.scrollable
        && sameGroupIds(prev.hiddenGroupIds, next.hiddenGroupIds)
          ? prev
          : next
      );
    };
    const schedule = () => {
      if (frame !== 0) return;
      if (typeof requestAnimationFrame === "function") {
        frame = requestAnimationFrame(sync);
        return;
      }
      sync();
    };
    schedule();
    lane.addEventListener("scroll", schedule, { passive: true });
    // Chrome leaves a *partially* visible control where it is when focus lands on it, so a
    // keyboard user could own a menu group whose label was still half outside the lane.
    // Finish the reveal ourselves — focus must never stop on obscured chrome.
    const revealFocusedControl = (event: FocusEvent) => {
      const target = event.target as HTMLElement | null;
      const control = target?.closest?.<HTMLElement>(
        "button,[tabindex]:not([tabindex='-1'])"
      );
      if (!control || !lane.contains(control)) return;
      if (typeof control.scrollIntoView !== "function") return;
      const laneRect = lane.getBoundingClientRect();
      const rect = control.getBoundingClientRect();
      if (
        rect.left >= laneRect.left - MENUBAR_OVERFLOW_EPSILON
        && rect.right <= laneRect.right + MENUBAR_OVERFLOW_EPSILON
      ) {
        return;
      }
      control.scrollIntoView({ block: "nearest", inline: "nearest" });
    };
    lane.addEventListener("focusin", revealFocusedControl);
    // 레인 폭(뷰포트·사이드패널)과 메뉴 콘텐츠(lazy 청크 도착·그룹 증감) 양쪽을 본다.
    const resizeObserver =
      typeof ResizeObserver === "function" ? new ResizeObserver(schedule) : null;
    resizeObserver?.observe(lane);
    const mutationObserver =
      typeof MutationObserver === "function" ? new MutationObserver(schedule) : null;
    mutationObserver?.observe(lane, { childList: true, subtree: true });
    return () => {
      if (frame !== 0 && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(frame);
      }
      lane.removeEventListener("scroll", schedule);
      lane.removeEventListener("focusin", revealFocusedControl);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
    };
  }, [mobileImmersive, studioMainMenuGroups]);

  const overflowMenuGroups = (() => {
    const labels = new Map(
      presentedStudioMainMenuGroups.map((group) => [group.id, group.label])
    );
    return laneOverflow.hiddenGroupIds.flatMap((id) => {
      const label = labels.get(id);
      return label === undefined ? [] : [{ id, label }];
    });
  })();

  /**
   * 오버플로 목록에서 고른 그룹을 레인 안으로 끌어온 뒤 원래 트리거를 그대로 누른다.
   * 드롭다운 구현은 `StudioMainMenu` 하나로 유지된다(두 번째 메뉴 구현 = 두 번째 회귀).
   */
  const revealMenuGroup = useCallback((groupId: string) => {
    const lane = menubarLaneRef.current;
    if (!lane) return;
    for (const node of lane.querySelectorAll<HTMLButtonElement>(
      "[data-studio-main-menu-trigger]"
    )) {
      if (node.dataset.studioMainMenuTrigger !== groupId) continue;
      if (typeof node.scrollIntoView === "function") {
        node.scrollIntoView({ block: "nearest", inline: "center" });
      }
      node.focus({ preventScroll: true });
      node.click();
      return;
    }
  }, []);

  // 명령 바 환경설정은 작업공간 liveLayout(저자형)에 실려 저장된다. liveWorkspaceLayout 프롭이
  // 이미 captureStudioWorkspaceDeviceLayout 을 거친 저자형이라, 그 위에 commandBar 만 바꿔 얹어도
  // 기기 해석 기하가 저자 desktop 으로 접혀 들어갈 일이 없다(작업공간 저자형 불변식).
  const commandBarPreferences = normalizeStudioCommandBarPreferences(
    liveWorkspaceLayout.commandBar
  );
  const changeCommandBarPreferences = (next: StudioCommandBarPreferences) => {
    persistStudioWorkspaceState(
      updateStudioWorkspaceLiveLayout(workspaceState, {
        ...liveWorkspaceLayout,
        commandBar: next,
      })
    );
  };

  const sharedNonOwner = Boolean(sharedDocument && sharedDocument.role !== "owner");
  /** Every slot routes through a handler the fixed menubar controls already own. */
  const commandBarBindings: Readonly<
    Record<StudioCommandBarCommandId, StudioMenubarCommandBinding>
  > = {
    undo: {
      label: COMMAND_BAR_COMMAND_LABELS.undo,
      labelKey: "studio.commandBar.command.undo",
      icon: Undo2,
      hint: MENUBAR_HINTS.undo,
      run: undo,
      disabled: undoDisabled,
      unavailableReason: "되돌릴 편집 작업이 아직 없습니다.",
    },
    redo: {
      label: COMMAND_BAR_COMMAND_LABELS.redo,
      labelKey: "studio.commandBar.command.redo",
      icon: Redo2,
      hint: MENUBAR_HINTS.redo,
      run: redo,
      disabled: redoDisabled,
      unavailableReason: "다시 적용할 편집 작업이 아직 없습니다.",
    },
    save: {
      label: sharedNonOwner ? "공동 저장" : COMMAND_BAR_COMMAND_LABELS.save,
      // 공유 문서의 "공동 저장"은 파일 메뉴가 이미 쓰는 키를 그대로 재사용한다 — 같은 명령이
      // 메뉴에서와 스트립에서 다른 문구로 번역되면 안 된다.
      labelKey: sharedNonOwner
        ? "studio.mainMenu.item.file.save-draft.shared"
        : "studio.commandBar.command.save",
      icon: Save,
      hint: MENUBAR_HINTS.draft,
      run: () => void handleSave("draft"),
      disabled: saving || collaborationDocumentLocked,
      unavailableReason: collaborationDocumentLocked
        ? collaborationLockMessage()
        : "현재 저장 작업이 끝난 뒤 다시 시도하세요.",
    },
    publish: {
      label: workId ? "수정 게시" : COMMAND_BAR_COMMAND_LABELS.publish,
      labelKey: workId
        ? "studio.mainMenu.item.file.publish.has-work"
        : "studio.commandBar.command.publish",
      icon: Send,
      hint: MENUBAR_HINTS.publish,
      run: () => void handleSave("published"),
      disabled: saving || collaborationDocumentLocked || sharedNonOwner,
      unavailableReason: sharedNonOwner
        ? "공유 문서의 게시는 소유자만 할 수 있습니다."
        : collaborationDocumentLocked
          ? collaborationLockMessage()
          : "현재 저장 작업이 끝난 뒤 다시 시도하세요.",
    },
    download: {
      label: COMMAND_BAR_COMMAND_LABELS.download,
      labelKey: "studio.commandBar.command.download",
      icon: Download,
      hint: MENUBAR_HINTS.download,
      run: () => void handleDownload(),
    },
    "export-open": {
      label: COMMAND_BAR_COMMAND_LABELS["export-open"],
      labelKey: "studio.commandBar.command.export-open",
      icon: SlidersHorizontal,
      hint: MENUBAR_HINTS.exportOptions,
      // Open-only on purpose: outside-pointerdown closing already owns dismissal, and a toggle
      // here would race it (close-on-pointerdown then reopen-on-click).
      run: () => {
        preloadStudioExportMenuPanel();
        void ensureWatermarkLoaded().then(() => {
          setProjectActionsOpen(false);
          setExportMenuOpen(true);
        });
      },
    },
    "zoom-fit": {
      label: COMMAND_BAR_COMMAND_LABELS["zoom-fit"],
      labelKey: "studio.commandBar.command.zoom-fit",
      icon: Scan,
      hint: COMMAND_BAR_HINTS.zoomFit,
      run: () => zoomToFit?.(),
      disabled: typeof zoomToFit !== "function",
      unavailableReason: "이 화면에는 화면 맞춤 명령이 아직 연결되지 않았습니다.",
    },
    assets: {
      label: COMMAND_BAR_COMMAND_LABELS.assets,
      labelKey: "studio.commandBar.command.assets",
      icon: Folder,
      hint: MENUBAR_HINTS.assets,
      run: () => {
        preloadStudioAssetMenuPanel();
        setMenu("template");
      },
    },
    bubbles: {
      label: COMMAND_BAR_COMMAND_LABELS.bubbles,
      labelKey: "studio.commandBar.command.bubbles",
      icon: MessageCircle,
      hint: MENUBAR_HINTS.bubbles,
      run: () => setMenu(menu === "bubble" ? null : "bubble"),
    },
    project: {
      label: COMMAND_BAR_COMMAND_LABELS.project,
      labelKey: "studio.commandBar.command.project",
      icon: Folder,
      hint: MENUBAR_HINTS.project,
      run: () => {
        setExportMenuOpen(false);
        setProjectActionsOpen(true);
      },
    },
  };

  return (
    <div
      data-studio-menubar-rows="true"
      className="flex min-w-0 flex-1 flex-col"
    >
      {/* 1행 — 문서 맥락 · 상위 메뉴 · 파일 액션. 여기 폭이 곧 §15.3 메뉴 18개의 가시성이다. */}
      <div className="flex min-w-0 flex-nowrap items-center gap-2">
        {/* 가져오기 파일 입력은 StudioPage 루트(data-studio-document-import-inputs)에 상시 마운트한다.
            메뉴바 lazy 청크/패널 게이트와 무관하게 파일 메뉴·프로젝트 도구 버튼이 같은 ref 를 클릭한다.
            (2026-07-24: 패널 안 조건부 마운트 → 무반응 버그 수정 후, lazy menubar 레이스까지 제거) */}
        <div
          ref={menubarLaneRef}
          data-testid="studio-menubar-primary"
          data-studio-menubar-primary="true"
          className={cn(
            "flex min-w-0 flex-1 items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
            mobileImmersive && "hidden"
          )}
        >
          {/* Keep document/workspace context intact; the primary lane scrolls when commands exceed width. */}
          <div
            className={cn(
              // This lane contains the workspace dialog trigger. Let the primary menubar scroll
              // instead of shrinking this wrapper beneath the adjacent history cluster; after a
              // user traverses all 18 menus at laptop width, a zero-width wrapper otherwise leaves
              // the visible workspace button covered by History and unreachable by pointer.
              "flex min-w-max shrink-0 items-center gap-1.5",
              mobileImmersive && "hidden"
            )}
          >
          <h1
            className="min-w-0 max-w-[8rem] truncate text-[0.8125rem] font-semibold tracking-tight text-fg xl:max-w-[16rem]"
            title={title.trim() || "무제"}
          >
            {title.trim() || "무제"}
          </h1>
          <span className="hidden shrink-0 rounded-md border border-line/60 bg-canvas/40 px-1.5 py-0.5 text-[0.62rem] font-medium tabular-nums text-fg-3 sm:inline">
            {activePageLabel}
          </span>
          {displayLinkedTitleId ? (
            <span className="hidden rounded-full border border-accent/30 bg-accent-soft/40 px-1.5 py-0.5 text-[0.6rem] font-semibold text-accent sm:inline">
              링크됨
            </span>
          ) : null}
          {workspacePersistence.ownerScope === currentWorkspaceOwnerScope ? (
            <StudioWorkspaceMenuGate
              key={`${currentWorkspaceOwnerScope}:${workspaceMenuEpoch}`}
              state={workspaceState}
              liveLayout={liveWorkspaceLayout}
              resolveDeviceKind={resolveWorkspaceDeviceKind}
              persistence={workspacePersistence}
              onStateChange={persistStudioWorkspaceState}
              onApplyLayout={applyStudioWorkspaceLayout}
            />
          ) : (
            <span role="status" className="inline-flex min-h-8 items-center text-[0.65rem] text-fg-3">
              전환 중…
            </span>
          )}
          {workspaceSyncNotice && workspacePersistence.ownerScope === currentWorkspaceOwnerScope ? (
            <span
              role="status"
              title={workspaceSyncNotice}
              className="max-w-40 truncate text-[0.62rem] font-medium text-cool"
            >
              {workspaceSyncNotice}
            </span>
          ) : null}
          </div>
          <span aria-hidden className="mx-0.5 hidden h-4 w-px shrink-0 bg-line md:block" />
          {/* Desktop application commands live in the compressible center lane. */}
          <Suspense fallback={null}>
            <StudioMainMenu
              groups={presentedStudioMainMenuGroups}
              specialistBoundaryGroupId={mainMenuPresentation.specialistBoundaryGroupId}
              className={cn("hidden min-w-max shrink-0 md:flex", mobileImmersive && "!hidden")}
            />
          </Suspense>
          {/* Wide layouts expose high-frequency insert shortcuts; narrower widths use Insert.
              These are fixed-size chips: `min-w-0` made them collapse to 0px and paint on top
              of the menubar instead of taking their turn in the scrollable lane. */}
          <div
            className={cn(
              "hidden shrink-0 items-center gap-0.5 xl:flex",
              mobileImmersive && "!hidden"
            )}
            role="group"
            aria-label="삽입 바로가기"
          >
          <StudioToolHintTarget hint={MENUBAR_HINTS.assets} preferredSide="bottom">
            <button
              type="button"
              onClick={() => {
                preloadStudioAssetMenuPanel();
                setMenu(activeToolbarGroup === "assetGroup" ? null : "template");
              }}
              aria-label="템플릿·에셋"
              aria-haspopup="menu"
              aria-expanded={activeToolbarGroup === "assetGroup"}
              className={cn(
                buttonClass({ size: "sm", variant: activeToolbarGroup === "assetGroup" ? "solid" : "quiet" }),
                "min-h-9 gap-1.5 px-2.5 text-[0.72rem]"
              )}
            >
              <Folder size={14} aria-hidden />
              템플릿·에셋
            </button>
          </StudioToolHintTarget>
          <StudioToolHintTarget hint={MENUBAR_HINTS.bubbles} preferredSide="bottom">
            <button
              type="button"
              onClick={() => setMenu(menu === "bubble" ? null : "bubble")}
              aria-label="말풍선"
              aria-haspopup="menu"
              aria-expanded={menu === "bubble"}
              className={cn(
                buttonClass({ size: "sm", variant: menu === "bubble" ? "solid" : "quiet" }),
                "min-h-9 gap-1.5 px-2.5 text-[0.72rem]"
              )}
            >
              <MessageCircle size={14} aria-hidden />
              말풍선
            </button>
          </StudioToolHintTarget>
          </div>
          <span aria-hidden className="mx-0.5 hidden h-4 w-px shrink-0 bg-line xl:block" />
          {/* 오른쪽 페이드는 **실제로 더 볼 내용이 남았을 때만** 켜진다. 폭 브레이크포인트로
              감추던 예전 방식은 17개 그룹이 1920px에서도 넘치면서 거짓이 됐다(D9).
              레이아웃 진동을 막으려고 언마운트 대신 투명도만 바꾼다. */}
          <span
            aria-hidden
            data-studio-menubar-overflow-cue="true"
            data-overflowing={laneOverflow.scrollable ? "true" : "false"}
            className={cn(
              "pointer-events-none sticky right-0 -mr-2 h-8 w-4 shrink-0 self-center bg-gradient-to-l from-panel to-transparent transition-opacity motion-reduce:transition-none",
              laneOverflow.scrollable ? "opacity-100" : "opacity-0"
            )}
          />
        </div>
        {/* 잘린 그룹으로 가는 정본 경로. 스크롤 레인 밖(형제)이라 절대 같이 잘리지 않는다. */}
        <StudioMenubarOverflowMenu groups={overflowMenuGroups} onReveal={revealMenuGroup} />
        {/* 파일·내보내기 — 드로잉 앱 메뉴바 */}
        <div
          data-testid="studio-menubar-actions"
          data-studio-menubar-actions="true"
          className={cn(
            "flex shrink-0 flex-nowrap items-center gap-1",
            // Immersive pill is content-width only — keep a real 4px gap so buttons never
            // paint under each other (the old sticky canvas ring used to cover "초안 저장").
            mobileImmersive && "min-w-0 gap-1"
          )}
        >
          {isMobile ? (
            <StudioToolHintTarget
              hint={mobileImmersive ? MENUBAR_HINTS.immersiveExit : MENUBAR_HINTS.immersive}
              preferredSide="bottom"
            >
              <button
                type="button"
                onClick={() => changeMobileImmersiveMode(!mobileImmersive)}
                aria-pressed={mobileImmersive}
                aria-label={
                  mobileImmersive
                    ? "전체 화면 드로잉 종료"
                    : "전체 화면 드로잉"
                }
                data-studio-mobile-app-mode
                className={cn(
                  buttonClass({
                    size: "sm",
                    // Quiet exit reads as chrome chrome, not a second primary CTA next to Publish.
                    variant: mobileImmersive ? "quiet" : "quiet",
                    className: "min-h-11 shrink-0 gap-1.5 whitespace-nowrap",
                  }),
                  // Windowed: sticky exit keeps the control reachable while the long title lane
                  // scrolls. Immersive: no sticky/ring — the compact pill has no scroll sibling.
                  // 모바일 폭(≤429px)에서는 아이콘만 남긴다. 예전 359px 경계로는 360~430px 창모드에서
                  // 액션 클러스터가 레인을 넘쳐 게시 버튼이 잘렸다(`verify:studio-mobile-top`, CI 실패).
                  !mobileImmersive &&
                    "sticky left-0 z-20 shadow-[0_0_0_4px_var(--color-canvas)] max-[429px]:size-11 max-[429px]:justify-center max-[429px]:px-0",
                  mobileImmersive &&
                    "rounded-full border border-line/70 bg-raised/80 px-2.5 text-fg"
                )}
              >
                {mobileImmersive ? (
                  <Minimize2 size={15} aria-hidden />
                ) : (
                  <Maximize2 size={15} aria-hidden />
                )}
                <span className={!mobileImmersive ? "max-[429px]:sr-only" : undefined}>
                  {mobileImmersive ? "종료" : "전체화면"}
                </span>
              </button>
            </StudioToolHintTarget>
          ) : null}
          {mobileImmersive ? (
            <>
              <h1 className="sr-only">드로잉 전체화면</h1>
              {/* 몰입 필은 콘텐츠 폭 기반의 컴팩트 플로팅 컨트롤이라 시각적 제목 자리가 없다
                  (기존 flex-1 스팬은 항상 0폭으로 짜부라지며 게시하기 버튼만 잘랐다).
                  문서 맥락은 보조기술에만 그대로 전달한다. */}
              <span className="sr-only">
                {title.trim() || "무제"} · {activePageLabel}
              </span>
            </>
          ) : null}
          {togglePageSequence ? (
            <StudioToolHintTarget
              hint={MENUBAR_HINTS.pages}
              preferredSide="bottom"
            >
              <button
                type="button"
                onClick={() => togglePageSequence()}
                data-studio-primary-action="pages"
                aria-pressed={pageSequenceOpen}
                aria-label={pageSequenceOpen ? "페이지 목록 닫기" : "페이지 목록 열기"}
                className={cn(
                  buttonClass({ size: "sm", variant: "quiet", className: "shrink-0 gap-1.5" }),
                  // 모바일에서는 하단 도크의 드로잉 행이 같은 '페이지' 버튼을 이미 갖는다. 메뉴바 사본까지
                  // 두면 320~430px 액션 클러스터가 44px 버튼 7개(332px)로 레인을 넘친다.
                  isMobile && "hidden",
                )}
              >
                <Files size={14} aria-hidden />
                <span className="max-xl:sr-only">페이지</span>
              </button>
            </StudioToolHintTarget>
          ) : null}
          <div
            ref={exportMenuRef}
            className="relative flex shrink-0 items-center"
            data-studio-primary-action="export"
          >
            <StudioToolHintTarget hint={MENUBAR_HINTS.download} preferredSide="bottom">
              <button
                type="button"
                onClick={() => handleDownload()}
                data-studio-primary-action="export"
                aria-label={`다운로드 ${exportScale}× ${exportFormat.toUpperCase()}${exportTransparent && exportFormat === "png" ? " · 투명" : ""} · 현재 페이지`}
                className={cn(
                  buttonClass({ size: "sm", variant: "quiet", className: "shrink-0 whitespace-nowrap gap-1.5 pr-2" }),
                  // 모바일 도크의 '내보내기' 가 같은 핸들러다. 메뉴바에는 배율·포맷을 고르는
                  // 내보내기 옵션만 남겨 44px 클러스터가 320px 안에 들어오게 한다.
                  isMobile && "hidden"
                )}
              >
                <Download size={14} aria-hidden /> <span className="max-xl:sr-only">다운로드</span>
                {" "}
                <span className="text-[10px] font-semibold tabular-nums text-fg-3 max-xl:hidden">
                  {exportScale}× {exportFormat.toUpperCase()}
                  {exportTransparent && exportFormat === "png" ? " · 투명" : null}
                </span>
              </button>
            </StudioToolHintTarget>
            <StudioToolHintTarget hint={MENUBAR_HINTS.exportOptions} preferredSide="bottom">
              <button
                type="button"
                onClick={async () => {
                  preloadStudioExportMenuPanel();
                  await ensureWatermarkLoaded();
                  setProjectActionsOpen(false);
                  setExportMenuOpen((open) => !open);
                }}
                onMouseEnter={preloadStudioExportMenuPanel}
                onFocus={preloadStudioExportMenuPanel}
                aria-expanded={exportMenuOpen}
                aria-label="내보내기 옵션"
                className={cn(
                  buttonClass({ size: "sm", variant: "quiet", className: "px-1.5" }),
                  isMobile && "min-h-11 min-w-11"
                )}
              >
                <ChevronDown
                  size={13}
                  aria-hidden
                  className={cn(
                    "transition-transform motion-reduce:transition-none",
                    exportMenuOpen && "rotate-180"
                  )}
                />
              </button>
            </StudioToolHintTarget>
            {exportMenuOpen && typeof document !== "undefined"
              ? createPortal(
                  <Suspense
                    fallback={
                      <div
                        data-studio-export-menu-panel="true"
                        className="fixed inset-x-2 top-12 z-[100] max-h-[calc(100dvh-4rem)] overflow-y-auto rounded-xl border border-line bg-panel p-3 text-xs text-fg-3 shadow-2xl sm:inset-x-auto sm:right-3 sm:w-72"
                      >
                        내보내기 옵션을 여는 중...
                      </div>
                    }
                  >
                    <StudioExportMenuPanel
                      canvasWidth={CANVAS_W}
                      canvasHeight={canvasH}
                      exportScale={exportScale}
                      exportFormat={exportFormat}
                      exportTransparent={exportTransparent}
                      exportPresetId={exportPresetId}
                      watermark={watermark}
                      isExporting={isExporting}
                      exportTitle={title}
                      pageCount={pageCount}
                      pageLabels={pageLabels}
                      dialoguePages={dialoguePages}
                      capturePagesForPreset={handleCapturePagesForPreset}
                      capturePagesForIndices={handleCapturePagesForIndices}
                      exportCurrentPageToInkMl={exportCurrentPageToInkMl}
                      exportCurrentPageToWillV1={exportCurrentPageToWillV1}
                      exportCurrentPageToSvg={exportCurrentPageToSvg}
                      exportCurrentPageToPsd={exportCurrentPageToPsd}
                      exportCurrentPageToRasterInterchange={exportCurrentPageToRasterInterchange}
                      setExportScale={setExportScale}
                      setExportFormat={setExportFormat}
                      setExportTransparent={setExportTransparent}
                      setExportPresetId={setExportPresetId}
                      setWatermark={setWatermark}
                      onCopyToClipboard={handleCopyToClipboard}
                    />
                  </Suspense>,
                  document.body
                )
              : null}
          </div>
          {/* 폰 폭에서도 보여야 한다. 이 시트는 검수·미리보기 7종의 유일한 포인터 경로인데
              (`StudioProjectReviewActions` 주석), 430px 기본 상태에서는 앱 메뉴바가
              `md:flex` + 몰입 `!hidden`이고 툴벨트도 몰입에서 숨어 대체 경로가 없다.
              시트 본문은 이미 `grid-cols-2` / `inset-x-2` / safe-area 패딩으로 폰 레이아웃을
              갖고 있었다 — 막고 있던 건 트리거뿐이었다. 라벨은 `max-xl:sr-only`라 좁은 폭에서
              아이콘만 차지한다. */}
          <div ref={projectActionsRef} className="relative shrink-0">
            <StudioToolHintTarget hint={MENUBAR_HINTS.project} preferredSide="bottom">
              <button
                type="button"
                onClick={() => {
                  setExportMenuOpen(false);
                  setProjectActionsOpen((open) => !open);
                }}
                aria-label="프로젝트 센터"
                aria-haspopup="dialog"
                aria-expanded={projectActionsOpen}
                aria-controls="studio-project-actions-menu"
                className={buttonClass({
                  size: "sm",
                  variant: "quiet",
                  // `min-w-11`은 셰브론을 접는 폭에서도 44px 터치 타깃을 지킨다
                  // (`verify:studio-mobile-top`은 메뉴바 컨트롤의 가로·세로 모두 하드 체크).
                  className: "min-h-11 min-w-11 shrink-0 gap-1.5 whitespace-nowrap",
                })}
              >
                <Folder size={14} aria-hidden /> <span className="max-xl:sr-only">프로젝트 센터</span>
                {/* 320px 창모드 메뉴바는 [전체 화면 드로잉][프로젝트][초안 저장][게시하기]로
                    320px를 5px 넘겨 `overflow-hidden` 레인이 게시 버튼을 잘랐다
                    (`verify:studio-mobile-top`의 하드 실패). 셰브론은 순수 장식이고
                    열림 상태는 `aria-expanded`가 이미 전달하므로, 가장 좁은 폭에서만 접는다. */}
                <ChevronDown
                  size={13}
                  className={cn(
                    "transition-transform motion-reduce:transition-none max-sm:hidden",
                    projectActionsOpen && "rotate-180"
                  )}
                  aria-hidden
                />
              </button>
            </StudioToolHintTarget>
            {projectActionsOpen && typeof document !== "undefined"
              ? createPortal(
              <div
                id="studio-project-actions-menu"
                data-studio-project-actions-menu="true"
                role="dialog"
                aria-label="프로젝트 센터"
                onClickCapture={(event) => {
                  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button");
                  if (button && !button.dataset.projectKeepOpen) {
                    globalThis.setTimeout(() => setProjectActionsOpen(false), 0);
                  }
                }}
                className="fixed inset-x-2 top-12 z-[100] grid max-h-[calc(100dvh-4rem)] grid-cols-2 gap-2 overflow-y-auto overscroll-contain rounded-2xl border border-line bg-panel/95 p-2.5 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-2xl backdrop-blur-xl [scrollbar-gutter:stable] sm:grid-cols-3 sm:inset-x-auto sm:right-3 sm:w-[min(44rem,calc(100vw-1.5rem))] [&>button]:min-h-11 [&>button]:justify-start [&>label]:min-h-11 [&>label]:justify-start"
              >
                <div className="sticky top-0 z-20 col-span-full -mx-2.5 -mt-2.5 border-b border-line/70 bg-panel/95 px-3 pb-3 pt-2.5 backdrop-blur-xl">
                  <div className="flex items-start justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block text-sm font-bold tracking-tight text-fg">프로젝트 센터</span>
                      <span className="mt-0.5 block text-[0.67rem] leading-relaxed text-fg-3">백업 · 기획 · 제작 · 검수 · 게시</span>
                    </span>
                    <button
                      type="button"
                      data-project-center-control="true"
                      onClick={() => setProjectActionsOpen(false)}
                      aria-label="프로젝트 센터 닫기"
                      className="grid size-11 shrink-0 place-items-center rounded-xl text-fg-3 transition-colors hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                    >
                      <X size={17} aria-hidden />
                    </button>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5" aria-label="프로젝트 요약">
                    <span className="rounded-full border border-line/70 bg-canvas/55 px-2 py-1 text-[0.62rem] font-semibold tabular-nums text-fg-2">
                      페이지 {pageCount}
                    </span>
                    <span className="rounded-full border border-line/70 bg-canvas/55 px-2 py-1 text-[0.62rem] font-semibold text-fg-2">
                      {workId ? "게시 연결됨" : "로컬 초안"}
                    </span>
                    <span className="rounded-full border border-line/70 bg-canvas/55 px-2 py-1 text-[0.62rem] font-semibold text-fg-2">
                      {sharedDocument
                        ? sharedDocument.role === "owner"
                          ? "공유 · 소유자"
                          : sharedDocument.role === "editor"
                            ? "공유 · 편집자"
                            : "공유 · 보기"
                        : "개인 작업"}
                    </span>
                  </div>
                  <StudioProjectCenterSearch />
                </div>
                <StudioProjectCenterSection
                  title="내보내기 · 백업"
                  description="현재 페이지부터 전체 프로젝트, 장기 보관용 아카이브까지 관리합니다."
                />
          {pageCount > 1 && (
            <button
              type="button"
              onClick={() => handleDownloadAll(24)}
              className={buttonClass({
                size: "sm",
                variant: "quiet",
                className: "shrink-0 whitespace-nowrap gap-1.5 bg-accent/10 text-accent hover:bg-accent/20 border-accent/25 border",
              })}
              title="모든 페이지를 긴 세로 스크롤 웹툰으로 이어 붙여 다운로드 (내보내기 옵션의 배율·포맷 적용)"
            >
              <Download size={14} /> 웹툰 연합 스크롤
            </button>
          )}
          <button type="button" onClick={handleExportProject} className={buttonClass({ size: "sm", variant: "quiet", className: "shrink-0 whitespace-nowrap gap-1.5" })} title="빠른 가독형 백업입니다. 로컬 3D 모델 GLB는 포함되지 않으므로 다른 기기 이동·장기 보관에는 아카이브 백업을 사용하세요.">
            <Download size={14} /> 백업 (.json)
          </button>
          <button
            type="button"
            onClick={() => void handleExportProjectArchive()}
            data-project-keep-open
            disabled={projectArchiveBusy}
            className={buttonClass({
              size: "sm",
              variant: "quiet",
              className: "min-h-11 shrink-0 whitespace-nowrap gap-1.5 disabled:cursor-wait disabled:opacity-60",
            })}
            title="프로젝트 JSON과 이미지·마스크를 SHA-256 중복 제거·무결성 검증형 단일 archive로 저장"
          >
            {projectArchiveBusy ? <Loader2 size={14} className="animate-spin" /> : <Package size={14} />}
            아카이브 백업
          </button>
          <StudioProjectCenterSection
            title="기획 · 제작"
            description="스토리, 캐릭터, 장면, 자동화와 2D·3D 제작 도구를 엽니다."
          />
          <button
            type="button"
            onClick={() => setWriterRoomOpen(true)}
            disabled={collaborationDocumentLocked}
            className={buttonClass({
              size: "sm",
              variant: "quiet",
              className: "shrink-0 whitespace-nowrap gap-1.5 disabled:cursor-not-allowed disabled:opacity-50",
            })}
            title={collaborationDocumentLocked ? collaborationLockMessage() : "한 줄 기획부터 시놉시스·비트·장면·컷·대사까지 한 흐름으로 설계하고 AI 초안을 검토"}
          >
            <Clapperboard size={14} /> Writer Room
            {studioWriterRoomHasContent(writerRoom) ? (
              <span className="rounded-full bg-accent-soft px-1.5 text-[0.65rem] font-bold text-accent">
                {Object.values(writerRoom.completion).filter(Boolean).length}/7
              </span>
            ) : null}
          </button>
          <button
            type="button"
            onClick={() => setAiProvenanceOpen(true)}
            className={buttonClass({
              size: "sm",
              variant: "quiet",
              className: "min-h-11 shrink-0 whitespace-nowrap gap-1.5",
            })}
            title="AI 작업의 공급자·모델·상태·토큰 사용량을 확인하고 공개 가능한 요약만 내보내기"
          >
            <ClipboardCheck size={14} /> AI 작업 이력
            {aiProvenance.operations.length > 0 ? (
              <span className="rounded-full bg-cool/10 px-1.5 text-[0.65rem] font-bold text-cool">
                {aiProvenance.operations.length}
              </span>
            ) : null}
          </button>
          <button
            type="button"
            onClick={() => setAnimaticTimelineOpen(true)}
            className={buttonClass({
              size: "sm",
              variant: "quiet",
              className: "min-h-11 shrink-0 whitespace-nowrap gap-1.5",
            })}
            title="페이지·컷의 무음 타이밍, 전환, 카메라 팬·줌과 대사·효과음 큐를 브라우저에서 검수"
          >
            <PlaySquare size={14} /> 애니매틱
          </button>
          <button
            type="button"
            onClick={() => setAssetRightsAuditOpen(true)}
            className={buttonClass({
              size: "sm",
              variant: "quiet",
              className: "min-h-11 shrink-0 whitespace-nowrap gap-1.5",
            })}
            title="현재 작품에 실제 배치된 에셋의 출처·사용권·페이지 위치를 게시 전에 로컬에서 점검"
          >
            <ShieldCheck size={14} /> 에셋 권리 감사
          </button>
          <button
            type="button"
            onClick={() => setCharacterBibleOpen(true)}
            disabled={collaborationDocumentLocked}
            className={buttonClass({
              size: "sm",
              variant: "quiet",
              className: "shrink-0 whitespace-nowrap gap-1.5 disabled:cursor-not-allowed disabled:opacity-50",
            })}
            title={collaborationDocumentLocked ? collaborationLockMessage() : "캐릭터 외형·의상·말투·관계와 AI 고정 제약을 문서에 저장"}
          >
            <Bookmark size={14} /> 캐릭터 바이블
            {characterBible.characters.length > 0 ? (
              <span className="rounded-full bg-accent-soft px-1.5 text-[0.65rem] font-bold text-accent">
                {characterBible.characters.length}
              </span>
            ) : null}
          </button>
          <button
            type="button"
            onClick={() => setProductionBibleOpen(true)}
            disabled={collaborationDocumentLocked}
            className={buttonClass({
              size: "sm",
              variant: "quiet",
              className: "min-h-11 shrink-0 whitespace-nowrap gap-1.5 disabled:cursor-not-allowed disabled:opacity-50",
            })}
            title={
              collaborationDocumentLocked
                ? collaborationLockMessage()
                : "반복 등장하는 장면·장소·소품의 안정 ID, 빛·색·참고 에셋 연결을 로컬 바이블로 관리"
            }
          >
            <MapPinned size={14} /> 제작 바이블
          </button>
          <button
            type="button"
            onClick={() => setHybridDccOpen(true)}
            disabled={collaborationDocumentLocked}
            className={buttonClass({
              size: "sm",
              variant: "quiet",
              className: "min-h-11 shrink-0 whitespace-nowrap gap-1.5 disabled:cursor-not-allowed disabled:opacity-50",
            })}
            title={
              collaborationDocumentLocked
                ? collaborationLockMessage()
                : "하이브리드 2D·3D DCC: 메시 편집, 불리언, 샷·잉크, CAD/스컬프/클로스, .toon3d"
            }
            data-studio-hybrid-dcc-open="true"
          >
            <Box size={14} /> Hybrid DCC
          </button>
          <StudioProjectCenterSection
            title="버전 · 가져오기"
            description="복구 지점을 만들고 외부 문서와 프로젝트 백업을 안전하게 가져옵니다."
          />
          <button
            type="button"
            onClick={() => setSceneSnapshotOpen(true)}
            className={buttonClass({
              size: "sm",
              variant: "quiet",
              className: "min-h-11 shrink-0 whitespace-nowrap gap-1.5",
            })}
            title="현재 페이지 전체를 이름과 태그가 있는 개인 장면으로 보관하거나 이전 장면을 다시 적용"
          >
            <Camera size={14} /> 장면 스냅샷
          </button>
          <button
            type="button"
            onClick={() => setCheckpointPanelOpen(true)}
            className={buttonClass({
              size: "sm",
              variant: "quiet",
              className: "shrink-0 whitespace-nowrap gap-1.5",
            })}
            title="현재 문서를 이름 있는 복구 지점으로 브라우저에 저장하거나 이전 시점을 복원"
          >
            <HistoryIcon size={14} /> 버전
          </button>
          <button
            type="button"
            onClick={() => void openAutoActions()}
            disabled={collaborationDocumentLocked}
            className={buttonClass({
              size: "sm",
              variant: "quiet",
              className: "min-h-11 shrink-0 whitespace-nowrap gap-1.5 disabled:cursor-not-allowed disabled:opacity-50",
            })}
            title={collaborationDocumentLocked ? collaborationLockMessage() : "허용된 반복 편집 명령을 현재·선택·전체 페이지에 dry run 후 한 번의 실행취소 단계로 적용"}
          >
            <WandSparkles size={14} /> Auto Actions
          </button>
          <button
            type="button"
            data-project-keep-open
            onClick={() => projectImportInputRef.current?.click()}
            disabled={collaborationDocumentLocked}
            className={buttonClass({ size: "sm", variant: "quiet", className: "shrink-0 whitespace-nowrap gap-1.5 disabled:cursor-not-allowed disabled:opacity-50" })}
            title={collaborationDocumentLocked ? collaborationLockMessage() : "빠른 .json 백업을 복구합니다. 포함되지 않은 로컬 3D 모델은 원래 기기의 검증 라이브러리에 있어야 합니다."}
          >
            <Upload size={14} /> 복구 (.json)
          </button>
          <button
            type="button"
            data-project-keep-open
            onClick={() => projectArchiveImportInputRef.current?.click()}
            disabled={projectArchiveBusy || collaborationDocumentLocked}
            className={cn(
              buttonClass({
                size: "sm",
                variant: "quiet",
                className: "min-h-11 shrink-0 whitespace-nowrap gap-1.5",
              }),
              projectArchiveBusy && "cursor-wait opacity-60",
              collaborationDocumentLocked && "cursor-not-allowed opacity-50"
            )}
            title={collaborationDocumentLocked ? collaborationLockMessage() : "무결성 검증형 .toonproject.zip에서 프로젝트와 포함 자산을 복구"}
          >
            <Upload size={14} /> 아카이브 복구
          </button>
          {projectArchiveStatus ? (
            <span
              role="status"
              className={cn(
                "max-w-80 shrink-0 rounded-lg border px-2 py-1 text-[0.68rem] leading-relaxed",
                projectArchiveStatus.tone === "good"
                  ? "border-good/30 bg-good-soft/20 text-good"
                  : projectArchiveStatus.tone === "warn"
                    ? "border-warning/30 bg-warning-soft/20 text-warning"
                    : "border-bad/30 bg-bad-soft/20 text-bad"
              )}
            >
              {projectArchiveStatus.text}
            </span>
          ) : null}
          <button
            type="button"
            data-project-keep-open
            onClick={() => psdImportInputRef.current?.click()}
            disabled={psdImportBusy || interchangeImportBusy || collaborationDocumentLocked}
            className={cn(
              buttonClass({ size: "sm", variant: "quiet", className: "min-h-11 shrink-0 whitespace-nowrap gap-1.5" }),
              (psdImportBusy || interchangeImportBusy) && "cursor-wait opacity-60",
              collaborationDocumentLocked && "cursor-not-allowed opacity-50"
            )}
            title={collaborationDocumentLocked ? collaborationLockMessage() : "포토샵(.psd) 파일의 레이어를 이미지 요소로 가져와요(래스터 평탄화, 편집 가능한 텍스트/조정 레이어는 재현되지 않음)"}
          >
            {psdImportBusy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            PSD 가져오기
          </button>
          {psdImportStatus && (
            <span
              className={cn(
                "shrink-0 whitespace-nowrap rounded-md border px-2 py-1 text-[10px] leading-snug",
                psdImportStatus.tone === "good" && "border-good/40 bg-good/10 text-good",
                psdImportStatus.tone === "warn" && "border-warn/40 bg-warn/10 text-warn"
              )}
            >
              {psdImportStatus.text}
            </span>
          )}
          <button
            type="button"
            data-project-keep-open
            onClick={() => {
              if (interchangeImportBusy) {
                cancelInterchangeImport();
                return;
              }
              interchangeImportInputRef.current?.click();
            }}
            disabled={psdImportBusy || collaborationDocumentLocked}
            className={cn(
              buttonClass({
                size: "sm",
                variant: "quiet",
                className: "min-h-11 shrink-0 whitespace-nowrap gap-1.5",
              }),
              interchangeImportBusy && "border-warn/30 bg-warn/10 text-warn",
              psdImportBusy && "cursor-wait opacity-60",
              collaborationDocumentLocked && "cursor-not-allowed opacity-50",
            )}
            title={
              collaborationDocumentLocked
                ? collaborationLockMessage()
                : interchangeImportBusy
                  ? "현재 OpenRaster/CBZ/WILL v1 안전 검사를 취소합니다."
                  : psdImportBusy
                    ? "PSD 문서 검사가 끝난 뒤 사용할 수 있습니다."
                  : "OpenRaster 레이어, CBZ 페이지 또는 bounded WILL v1 선을 안전 검사하고 손실 미리보기 후 가져옵니다. WILL은 Wacom 공식 SDK·인증 파일 호환을 보증하지 않습니다."
            }
          >
            {interchangeImportBusy
              ? <X size={14} aria-hidden />
              : <Files size={14} aria-hidden />}
            {interchangeImportBusy ? "문서 검사 취소" : "ORA · CBZ · WILL"}
          </button>
          {interchangeImportStatus ? (
            <span
              role="status"
              className={cn(
                "max-w-80 shrink-0 rounded-lg border px-2 py-1 text-[0.68rem] leading-relaxed",
                interchangeImportStatus.tone === "good"
                  ? "border-good/40 bg-good/10 text-good"
                  : interchangeImportStatus.tone === "warn"
                    ? "border-warn/40 bg-warn/10 text-warn"
                    : "border-bad/40 bg-bad/10 text-bad",
              )}
            >
              {interchangeImportStatus.text}
            </span>
          ) : null}
          <StudioProjectCenterSection
            title="연출 · 게시 · 검수"
            description="연출, 운영, 게시 패키지와 품질 검사를 출고 흐름으로 이어갑니다."
          />
          {sharedDocument?.role === "owner" || loadedWork ? (
            <button
              type="button"
              onClick={() => void openOwnerFxPanel()}
              disabled={fxPanelLoading}
              className={buttonClass({ size: "sm", variant: "quiet", className: "shrink-0 whitespace-nowrap gap-1.5 disabled:cursor-wait disabled:opacity-60" })}
              title="이미 게시된 이 작품의 배경음악·스크롤 모션·컷별 애니메이션 연출을 설정합니다"
            >
              {fxPanelLoading ? <Loader2 size={14} className="animate-spin" /> : <Music4 size={14} />}
              애니메이션 연출
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setProductionInsightsOpen(true)}
            className={buttonClass({
              size: "sm",
              variant: "quiet",
              className: "shrink-0 whitespace-nowrap gap-1.5",
            })}
            title="현재 문서 구조에서 제작 분량·검토·AI 에셋·미해결 항목을 계산"
          >
            <GanttChartSquare size={14} /> 제작 인사이트
          </button>
          <button
            type="button"
            onClick={() => setPublicationOperationsOpen(true)}
            disabled={collaborationDocumentLocked}
            className={buttonClass({
              size: "sm",
              variant: "quiet",
              className: "shrink-0 whitespace-nowrap gap-1.5 disabled:cursor-not-allowed disabled:opacity-50",
            })}
            title={collaborationDocumentLocked ? collaborationLockMessage() : "외부 자동 게시 없이 릴리스 일정과 직접 가져온 성과 기록을 관리"}
          >
            <Package size={14} /> 연재 운영
          </button>
          <button
            type="button"
            onClick={() => setPublishPreflightOpen(true)}
            className={buttonClass({
              size: "sm",
              variant: "quiet",
              className: "shrink-0 whitespace-nowrap gap-1.5",
            })}
            title="WEBTOON·Tapas·일반 게시 패키지의 구조와 AI 사용 고지를 미리 검사"
          >
            <ShieldCheck size={14} /> 게시 사전검사
          </button>
          <button
            type="button"
            onClick={() => setPublishPackageOpen(true)}
            className={buttonClass({
              size: "sm",
              variant: "quiet",
              className: "shrink-0 whitespace-nowrap gap-1.5",
            })}
            title="WEBTOON·Tapas·범용 목적지별 이미지 분할·썸네일·크레딧·검증 매니페스트를 계획"
          >
            <Package size={14} /> 게시 패키지
          </button>
          {/* 벨트 전용이던 검수·미리보기 7종의 정본 진입점. 벨트 호스트는 전 뷰포트에서
              display:none이라 여기가 유일한 포인터 경로다(StudioProjectReviewActions 주석). */}
          <StudioProjectReviewActions
            masterEditMode={masterEditMode}
            pageEditLocked={pageEditLocked}
            commentsLocked={commentsLocked}
            commentsLockedReason={commentsLocked ? collaborationLockMessage() : ""}
            openCommentCount={openStudioCommentCount}
            handlers={{
              toggleAnimationTimeline,
              openTimelapse,
              openStoryboardGrid,
              openScrollPreview,
              openContinuityCheck,
              toggleDocumentComments,
              openPageReview,
            }}
          />
              </div>,
              document.body
            )
            : null}
          </div>
          <StudioToolHintTarget
            hint={{
              ...MENUBAR_HINTS.draft,
              title: sharedDocument && sharedDocument.role !== "owner" ? "공동 저장" : "초안 저장",
            }}
            disabled={saving || collaborationDocumentLocked}
            unavailableReason={
              collaborationDocumentLocked
                ? collaborationLockMessage()
                : saving
                  ? "현재 저장 작업이 끝난 뒤 다시 시도하세요."
                  : undefined
            }
            preferredSide="bottom"
          >
            <button
              type="button"
              onClick={() => handleSave("draft")}
              disabled={saving || collaborationDocumentLocked}
              aria-label={sharedDocument && sharedDocument.role !== "owner" ? "공동 저장" : "초안 저장"}
              className={cn(
                buttonClass({
                  size: "sm",
                  variant: "quiet",
                  className: "shrink-0 whitespace-nowrap gap-1.5 disabled:cursor-not-allowed disabled:opacity-50",
                }),
                isMobile &&
                  "min-h-11 max-[429px]:size-11 max-[429px]:justify-center max-[429px]:px-0",
                mobileImmersive && "rounded-full border border-line/70 bg-raised/80 px-2.5 max-[429px]:px-0"
              )}
            >
              {saving ? (
                <Loader2 size={14} className="animate-spin motion-reduce:animate-none" aria-hidden />
              ) : (
                <Save size={14} className="hidden max-[429px]:block" aria-hidden />
              )}
              <span className="max-[429px]:sr-only">
                {sharedDocument && sharedDocument.role !== "owner" ? "공동 저장" : "초안 저장"}
              </span>
            </button>
          </StudioToolHintTarget>
          {!sharedDocument || sharedDocument.role === "owner" ? (
            <StudioToolHintTarget
              hint={{
                ...MENUBAR_HINTS.publish,
                title: workId ? "수정 게시" : "게시하기",
              }}
              disabled={saving || collaborationDocumentLocked}
              unavailableReason={
                collaborationDocumentLocked
                  ? collaborationLockMessage()
                  : saving
                    ? "현재 저장 작업이 끝난 뒤 다시 시도하세요."
                    : undefined
              }
              preferredSide="bottom"
            >
              <button
                type="button"
                data-testid="studio-publish"
                onClick={() => handleSave("published")}
                disabled={saving || collaborationDocumentLocked}
                aria-label={workId ? "수정 게시" : "게시하기"}
                className={cn(
                  buttonClass({
                    size: "sm",
                    variant: "solid",
                    className: "shrink-0 whitespace-nowrap gap-1.5 disabled:cursor-not-allowed disabled:opacity-50",
                  }),
                  isMobile &&
                    "min-h-11 max-[429px]:size-11 max-[429px]:justify-center max-[429px]:px-0",
                  mobileImmersive && "rounded-full px-3 shadow-none max-[429px]:px-0"
                )}
              >
                {saving ? (
                  <Loader2 size={14} className="animate-spin motion-reduce:animate-none" aria-hidden />
                ) : (
                  <Send size={14} className="hidden max-[429px]:block" aria-hidden />
                )}
                <span className="max-[429px]:sr-only">
                  {workId ? "수정 게시" : "게시하기"}
                </span>
              </button>
            </StudioToolHintTarget>
          ) : null}
        </div>
      </div>
      {/* 2행 — §15.3 Window ▸ Action Bar. CSP 처럼 메뉴 바 **아래** 자기 줄에 놓아, 8 슬롯이
          늘어나도 상위 메뉴 18개의 가로 예산을 한 픽셀도 가져가지 않는다. 오버플로 실측기가
          재는 것은 1행의 `data-studio-menubar-primary` 뿐이라 이 줄은 계산에 아예 안 들어온다. */}
      <StudioMenubarCommandBar
        preferences={commandBarPreferences}
        bindings={commandBarBindings}
        historyPanelOpen={historyPanelOpen}
        onToggleHistoryPanel={toggleHistoryPanel}
        onPreferencesChange={changeCommandBarPreferences}
        hidden={mobileImmersive}
      />
    </div>
  );
});
