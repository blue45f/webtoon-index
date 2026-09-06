// 창작 스튜디오 키보드 단축키 도움말 — "?" 키 또는 단축키 버튼으로 토글.
// StudioPage 내부 상태에 의존하지 않는 자체완결 모달(open/onClose만 받음).
// optional `shortcuts` prop이 있으면 커스터마이즈된 코드를 formatStudioShortcutChord로 표시.
import { Hand, MousePointer2, RotateCcw, Search, X } from "lucide-react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  formatStudioShortcutChord,
  type StudioShortcutActionId,
} from "./studio-app-settings";
import {
  studioSearchTextMatches,
  tokenizeStudioSearchQuery,
} from "./studio-search-text";

import { useI18n, useT } from "@/shared/lib/i18n";


interface ShortcutRow {
  keys: string;
  keysKey?: string;
  labelKey: string;
  /** Korean/common-product synonyms used only by the local help search. */
  searchAliases?: readonly string[];
  /** Single customizable action (replaces keys when remapped). */
  actionId?: StudioShortcutActionId;
  /** Multi-chord rows (e.g. brush smaller/larger). */
  actionIds?: readonly StudioShortcutActionId[];
}

interface ShortcutGroup {
  titleKey: string;
  rows: ShortcutRow[];
}

// 표시는 macOS ⌘ 기준 + Windows/Linux는 Ctrl로 읽으면 됨.
const GROUPS: ShortcutGroup[] = [
  {
    titleKey: "studio.shortcuts.group.drawing",
    rows: [
      {
        keys: "B",
        labelKey: "studio.shortcuts.row.drawing.pen",
        actionId: "tool-pen",
        searchAliases: ["브러시", "붓", "그리기", "brush", "draw"],
      },
      {
        keys: "E",
        labelKey: "studio.shortcuts.row.drawing.eraser",
        actionId: "tool-eraser",
        searchAliases: ["삭제", "지우기", "erase", "delete"],
      },
      {
        keys: "N · ⇧N",
        labelKey: "studio.shortcuts.row.drawing.blendWet",
        actionIds: ["tool-blend", "tool-wet-mix"],
        searchAliases: ["스머지", "문지르기", "혼색", "물감", "색 섞기", "smudge", "blend", "wet mix"],
      },
      {
        keys: "O",
        labelKey: "studio.shortcuts.row.drawing.dodgeBurn",
        actionId: "tool-dodge-burn",
        searchAliases: ["닷지", "번", "스펀지", "밝게", "어둡게", "채도", "dodge", "burn", "sponge"],
      },
      {
        keys: "[ · ]",
        labelKey: "studio.shortcuts.row.drawing.brushSize",
        actionIds: ["brush-smaller", "brush-larger"],
      },
      { keys: "⇧ [ · ⇧ ]", labelKey: "studio.shortcuts.row.drawing.brushSizeStep" },
      { keys: "⌥ [ · ⌥ ]", labelKey: "studio.shortcuts.row.drawing.opacity" },
      { keys: "1–6", labelKey: "studio.shortcuts.row.drawing.recentBrushSlots" },
      { keys: "⇧ 1–6", labelKey: "studio.shortcuts.row.drawing.saveBrushSlot" },
      {
        keys: "⇧ + 드래그",
        keysKey: "studio.shortcuts.keys.shiftDrag",
        labelKey: "studio.shortcuts.row.drawing.straighten",
      },
      { keys: "X", labelKey: "studio.shortcuts.row.drawing.swapColors", actionId: "swap-colors" },
    ],
  },
  {
    titleKey: "studio.shortcuts.group.edit",
    rows: [
      {
        keys: "T",
        labelKey: "studio.shortcuts.row.edit.text",
        actionId: "tool-lettering",
        searchAliases: ["글자", "대사", "텍스트", "text", "lettering", "dialogue"],
      },
      { keys: "⌘ Enter", labelKey: "studio.shortcuts.row.edit.confirmBubble" },
      { keys: "⌘Z", labelKey: "studio.shortcuts.row.edit.undo", actionId: "undo" },
      { keys: "⌘⇧Z · ⌘Y", labelKey: "studio.shortcuts.row.edit.redo", actionId: "redo" },
      { keys: "⌘X · ⌘C", labelKey: "studio.shortcuts.row.edit.cutCopy" },
      { keys: "⌘V · ⌘⇧V", labelKey: "studio.shortcuts.row.edit.paste" },
      { keys: "⌘A", labelKey: "studio.shortcuts.row.edit.selectAll" },
      { keys: "⌘D", labelKey: "studio.shortcuts.row.edit.deselect", actionId: "deselect-pixels" },
      { keys: "⌘⇧I", labelKey: "studio.shortcuts.row.edit.invert", actionId: "invert-pixels" },
      {
        // 단독 `Q` 는 퀵 마스크만의 화음이다. 색각 검수 흑백 명암이 같은 `Q` 를 주장하던
        // 충돌(`q-quickmask-vs-grayscale`)은 2026-08-08 에 grayscale 을 `⌥Q` 로 옮겨
        // 해소했다 — 이 행과 선택 메뉴의 배지가 이제 같은 것을 가리킨다.
        keys: "Q",
        labelKey: "studio.shortcuts.row.edit.quickMask",
        searchAliases: ["퀵 마스크", "퀵마스크", "마스크로 칠하기", "quick mask", "quickmask"],
      },
      { keys: "⌘J", labelKey: "studio.shortcuts.row.edit.duplicate" },
      {
        keys: "G",
        labelKey: "studio.shortcuts.row.edit.fill",
        actionId: "tool-fill",
        searchAliases: ["페인트 버킷", "버킷", "색 채우기", "paint bucket", "fill"],
      },
      { keys: "Delete · ⌫", labelKey: "studio.shortcuts.row.edit.delete" },
      { keys: "Esc", labelKey: "studio.shortcuts.row.edit.cancel" },
    ],
  },
  {
    titleKey: "studio.shortcuts.group.layers",
    rows: [
      { keys: "⌘] · ⌘⇧]", labelKey: "studio.shortcuts.row.layers.forward" },
      { keys: "⌘[ · ⌘⇧[", labelKey: "studio.shortcuts.row.layers.backward" },
      {
        keys: "방향키",
        keysKey: "studio.shortcuts.keys.arrowKeys",
        labelKey: "studio.shortcuts.row.layers.move1px",
      },
      {
        keys: "⇧ + 방향키",
        keysKey: "studio.shortcuts.keys.shiftArrowKeys",
        labelKey: "studio.shortcuts.row.layers.move10px",
      },
    ],
  },
  {
    titleKey: "studio.shortcuts.group.view",
    rows: [
      { keys: "⌘ +", labelKey: "studio.shortcuts.row.view.zoomIn" },
      { keys: "⌘ −", labelKey: "studio.shortcuts.row.view.zoomOut" },
      { keys: "⌘ 0", labelKey: "studio.shortcuts.row.view.zoomFit" },
      {
        keys: "⌘ + 휠",
        keysKey: "studio.shortcuts.keys.commandWheel",
        labelKey: "studio.shortcuts.row.view.zoomAtPointer",
      },
      {
        keys: "Space + 드래그",
        keysKey: "studio.shortcuts.keys.spaceDrag",
        labelKey: "studio.shortcuts.row.view.pan",
      },
      { keys: "`", labelKey: "studio.shortcuts.row.view.toggleCanvas", actionId: "toggle-chrome" },
      { keys: "H", labelKey: "studio.shortcuts.row.view.flipCanvas", actionId: "flip-canvas" },
      { keys: "?", labelKey: "studio.shortcuts.row.view.help", actionId: "shortcuts-help" },
    ],
  },
];

const SHORTCUT_HELP_COPY = {
  ko: {
    subtitle: "기능 이름이나 키를 검색하고, 익숙한 기본 조작부터 바로 확인하세요.",
    searchLabel: "단축키와 조작 검색",
    searchPlaceholder: "예: 채우기, 스머지, 확대, ⌘Z",
    clearSearch: "검색어 지우기",
    familiarTitle: "먼저 알아두면 편한 기본 조작",
    allShortcuts: "전체 단축키",
    result: (count: number) => `검색 결과 ${count}개`,
    toggleHint: "? 키로 열고 닫기",
    emptyTitle: "찾는 조작이 없습니다",
    emptyBody: "도구 이름, 동작, 단축키 중 하나로 다시 검색해 보세요.",
    showAll: "전체 단축키 보기",
    operations: [
      {
        id: "select",
        title: "선택하고 움직이기",
        body: "선택 도구에서 객체를 클릭해 고르고 드래그해 이동해요. 여러 개는 Shift를 누른 채 클릭합니다.",
        keys: "V · Shift",
      },
      {
        id: "view",
        title: "화면만 이동·확대하기",
        body: "Space를 누른 채 드래그하면 화면이 이동하고, ⌘+휠은 포인터 위치를 중심으로 확대해요.",
        keys: "Space · ⌘+휠",
      },
      {
        id: "recover",
        title: "취소하고 되돌리기",
        body: "진행 중인 동작은 Esc로 취소하고, 반영된 작업은 ⌘Z로 한 단계씩 되돌려요.",
        keys: "Esc · ⌘Z",
      },
    ],
  },
  en: {
    subtitle: "Search by feature or key, then start with familiar editor controls.",
    searchLabel: "Search shortcuts and controls",
    searchPlaceholder: "Try fill, smudge, zoom, or ⌘Z",
    clearSearch: "Clear search",
    familiarTitle: "Familiar controls to learn first",
    allShortcuts: "All shortcuts",
    result: (count: number) => `${count} search result${count === 1 ? "" : "s"}`,
    toggleHint: "Press ? to open or close",
    emptyTitle: "No matching control",
    emptyBody: "Search again by tool name, action, or shortcut.",
    showAll: "Show all shortcuts",
    operations: [
      {
        id: "select",
        title: "Select and move",
        body: "Choose the Select tool, click an object, and drag to move it. Shift-click adds more objects.",
        keys: "V · Shift",
      },
      {
        id: "view",
        title: "Pan and zoom the view",
        body: "Hold Space and drag to pan. ⌘+wheel zooms around the pointer position.",
        keys: "Space · ⌘+wheel",
      },
      {
        id: "recover",
        title: "Cancel and undo",
        body: "Press Esc to cancel an action in progress, or ⌘Z to undo a committed change.",
        keys: "Esc · ⌘Z",
      },
    ],
  },
} as const;

const FAMILIAR_OPERATION_ICONS = {
  select: MousePointer2,
  view: Hand,
  recover: RotateCcw,
} as const;

function displayKeysForRow(
  row: ShortcutRow,
  shortcuts: Partial<Record<StudioShortcutActionId, string>> | Record<string, string> | undefined
): string {
  if (!shortcuts) return row.keys;
  if (row.actionId) {
    if (!Object.prototype.hasOwnProperty.call(shortcuts, row.actionId)) return row.keys;
    const chord = shortcuts[row.actionId];
    if (typeof chord !== "string") return row.keys;
    return formatStudioShortcutChord(chord);
  }
  if (row.actionIds && row.actionIds.length > 0) {
    const parts = row.actionIds.map((id) => {
      if (!Object.prototype.hasOwnProperty.call(shortcuts, id)) return null;
      const chord = shortcuts[id];
      if (typeof chord !== "string") return null;
      return formatStudioShortcutChord(chord);
    });
    if (parts.every((p) => p !== null)) {
      return parts.join(" · ");
    }
  }
  return row.keys;
}

function isShortcutHelpEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest('input, textarea, select, [role="textbox"]')) return true;
  const contentEditable = target.closest("[contenteditable]");
  return contentEditable !== null
    && contentEditable.getAttribute("contenteditable")?.toLocaleLowerCase() !== "false";
}

export function StudioShortcutsHelp({
  open,
  onClose,
  shortcuts,
}: {
  open: boolean;
  onClose: () => void;
  /** Optional app-settings shortcut map; remapped chords are shown via formatStudioShortcutChord. */
  shortcuts?: Partial<Record<StudioShortcutActionId, string>> | Record<string, string>;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const closeFromEffect = useEffectEvent(onClose);
  const t = useT();
  const language = useI18n((state) => state.lang);
  const copy = language.toLocaleLowerCase().startsWith("ko")
    ? SHORTCUT_HELP_COPY.ko
    : SHORTCUT_HELP_COPY.en;
  const [searchQuery, setSearchQuery] = useState("");
  const searching = tokenizeStudioSearchQuery(searchQuery).length > 0;
  // 매칭 규칙은 통합 Command Search 와 같은 `studio-search-text` 를 쓴다.
  // 감사 §2.8 이 "네 검색창이 서로 다르게 판단한다"를 결함으로 셌다.
  const visibleGroups = GROUPS.map((group) => ({
    ...group,
    rows: group.rows.filter((row) =>
      studioSearchTextMatches(searchQuery, [
        t(group.titleKey),
        t(row.labelKey),
        row.keysKey ? t(row.keysKey) : displayKeysForRow(row, shortcuts),
        ...(row.searchAliases ?? []),
      ]),
    ),
  })).filter((group) => group.rows.length > 0);
  const visibleShortcutCount = visibleGroups.reduce((count, group) => count + group.rows.length, 0);

  // 진짜 modal 계약: 포커스 진입·순환·복원, 배경 inert, 스크롤 잠금을 한 생명주기로 관리한다.
  useEffect(() => {
    if (!open || typeof document === "undefined") return;
    openerRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const previousBodyOverflow = document.body.style.overflow;
    const previousRootOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";

    const overlay = overlayRef.current;
    const inertStates: Array<readonly [HTMLElement, boolean]> = [];
    for (const child of document.body.children) {
      if (!(child instanceof HTMLElement) || child === overlay) continue;
      inertStates.push([child, child.inert]);
      child.inert = true;
    }
    const focusFrame = requestAnimationFrame(() => closeButtonRef.current?.focus({ preventScroll: true }));

    const onKeyDown = (event: KeyboardEvent) => {
      const closeShortcutRequested = event.key === "Escape" || event.key === "?";
      if (closeShortcutRequested && (event.isComposing || event.keyCode === 229)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        closeFromEffect();
        return;
      }
      if (event.key === "?" && !isShortcutHelpEditableTarget(event.target)) {
        event.preventDefault();
        closeFromEffect();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ) ?? [])].filter((element) => !element.hidden && element.getClientRects().length > 0);
      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current?.focus({ preventScroll: true });
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousRootOverflow;
      for (const [element, wasInert] of inertStates) element.inert = wasInert;
      const opener = openerRef.current;
      openerRef.current = null;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [open]);

  if (!open) return null;
  const content = (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[110] flex items-end justify-center bg-canvas/75 p-0 backdrop-blur-sm sm:items-center sm:p-6"
    >
      <button
        type="button"
        tabIndex={-1}
        aria-label={t("studio.shortcuts.close")}
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />
      <div
        ref={dialogRef}
        className="relative z-10 flex max-h-[min(92dvh,46rem)] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl border border-line bg-panel pb-[env(safe-area-inset-bottom)] shadow-xl sm:rounded-2xl sm:pb-0"
        role="dialog"
        aria-modal="true"
        aria-labelledby="studio-shortcuts-title"
        data-studio-shortcut-boundary="true"
        tabIndex={-1}
      >
        <div className="shrink-0 border-b border-line/60 bg-gradient-to-br from-accent-soft/30 via-panel to-panel px-4 pb-3 pt-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p id="studio-shortcuts-title" className="text-sm font-bold text-fg">{t("studio.shortcuts.title")}</p>
              <p className="mt-0.5 text-[0.7rem] leading-relaxed text-fg-3">
                {copy.subtitle}
              </p>
            </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="grid size-11 place-items-center rounded-xl border border-line text-fg-2 hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent sm:size-9"
          >
            <X size={14} aria-hidden />
          </button>
          </div>
          <div className="mt-3 flex min-h-11 items-center gap-2 rounded-xl border border-line bg-card px-3 text-fg-2 shadow-sm focus-within:border-accent/60 focus-within:ring-2 focus-within:ring-accent/15">
            <Search className="size-4 shrink-0 text-fg-3" aria-hidden />
            <label htmlFor="studio-shortcuts-search" className="sr-only">{copy.searchLabel}</label>
            <input
              id="studio-shortcuts-search"
              type="search"
              role="searchbox"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.currentTarget.value)}
              placeholder={copy.searchPlaceholder}
              aria-label={copy.searchLabel}
              className="min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-3"
            />
            {searchQuery ? (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="grid size-8 shrink-0 touch-manipulation place-items-center rounded-lg text-fg-3 hover:bg-raised hover:text-fg pointer-coarse:size-11"
                aria-label={copy.clearSearch}
              >
                <X className="size-3.5" aria-hidden />
              </button>
            ) : null}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {!searching ? (
            <section aria-labelledby="studio-familiar-operations-title">
              <h3 id="studio-familiar-operations-title" className="text-[0.68rem] font-semibold text-fg-2">
                {copy.familiarTitle}
              </h3>
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                {copy.operations.map((operation) => {
                  const Icon = FAMILIAR_OPERATION_ICONS[operation.id];
                  return (
                    <article key={operation.id} className="rounded-xl border border-line/60 bg-card/70 p-2.5">
                      <div className="flex items-center gap-2">
                        <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
                          <Icon className="size-3.5" aria-hidden />
                        </span>
                        <h4 className="text-xs font-semibold text-fg">{operation.title}</h4>
                      </div>
                      <p className="mt-2 text-[0.68rem] leading-relaxed text-fg-3">{operation.body}</p>
                      <kbd className="mt-2 inline-flex rounded-md border border-line bg-canvas px-1.5 py-0.5 font-mono text-[0.62rem] text-fg-2">
                        {operation.keys}
                      </kbd>
                    </article>
                  );
                })}
              </div>
            </section>
          ) : null}

          <section aria-labelledby="studio-shortcut-list-title" className={searching ? "" : "mt-4"}>
            <div className="mb-2 flex items-center justify-between gap-3">
              <h3 id="studio-shortcut-list-title" className="text-[0.68rem] font-semibold text-fg-2">
                {searching ? copy.result(visibleShortcutCount) : copy.allShortcuts}
              </h3>
              <span className="text-[0.62rem] text-fg-3">{copy.toggleHint}</span>
            </div>
          {visibleGroups.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2">
          {visibleGroups.map((g) => (
            <div key={g.titleKey}>
              <p className="mb-1.5 text-[0.66rem] font-semibold uppercase tracking-wide text-fg-3">
                {t(g.titleKey)}
              </p>
              <ul className="space-y-1">
                {g.rows.map((r) => (
                  <li key={r.labelKey} className="flex items-center justify-between gap-3 text-xs text-fg-2">
                    <span>{t(r.labelKey)}</span>
                    <kbd className="shrink-0 rounded-md border border-line bg-card px-1.5 py-0.5 font-mono text-[0.66rem] text-fg-3">
                      {r.keysKey && !r.actionId && !r.actionIds
                        ? t(r.keysKey)
                        : displayKeysForRow(r, shortcuts)}
                    </kbd>
                  </li>
                ))}
              </ul>
            </div>
          ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-line bg-card/40 px-4 py-8 text-center">
              <p className="text-sm font-semibold text-fg">{copy.emptyTitle}</p>
              <p className="mt-1 text-xs leading-relaxed text-fg-3">{copy.emptyBody}</p>
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="mt-3 min-h-9 touch-manipulation rounded-xl border border-line bg-card px-3 text-xs font-semibold text-fg-2 hover:bg-raised pointer-coarse:min-h-11"
              >
                {copy.showAll}
              </button>
            </div>
          )}
          </section>
          <p className="mt-4 border-t border-line/50 pt-3 text-[0.62rem] leading-relaxed text-fg-3">
            {t("studio.shortcuts.notice")}
          </p>
        </div>
      </div>
    </div>
  );
  return typeof document === "undefined" ? content : createPortal(content, document.body);
}
