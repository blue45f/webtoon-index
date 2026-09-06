import {
  BookOpen,
  Boxes,
  ChevronDown,
  ChevronRight,
  LayoutTemplate,
  Maximize2,
  MessageCircle,
  MousePointer2,
  Palette,
  Pencil,
  Save,
  Shapes,
  Smile,
  Sparkles,
  Undo2,
  X,
} from "lucide-react";
import { useEffect, useEffectEvent, useRef } from "react";

import {
  formatStudioShortcutChord,
  type StudioShortcutActionId,
} from "./studio-app-settings";
import { studioDialogFocusAnchor } from "./studio-dialog-focus-return";

import { buttonClass } from "@/shared/components/ui/button-utils";
import { useI18n, useT } from "@/shared/lib/i18n";
import { cn } from "@/shared/lib/utils";

function localizeText(
  t: (key: string) => string,
  fallback: string,
  key: string,
): string {
  const translated = t(key);
  return translated === key ? fallback : translated;
}

type StudioQuickStartShortcuts = Partial<Record<StudioShortcutActionId, string>>;

type StudioQuickStartCopy = {
  workflowTitle: string;
  workflowReady: string;
  workflowLabel: string;
  select: string;
  selectHint: (shortcut: string) => string;
  draw: string;
  drawHint: (shortcut: string) => string;
  dialogue: string;
  dialogueHint: (shortcut: string) => string;
  saveUndo: string;
  saveUndoHint: (undoShortcut: string) => string;
  moreTitle: string;
  moreHint: string;
  unassigned: string;
};

const STUDIO_QUICK_START_COPY = {
  ko: {
    workflowTitle: "처음 시작하는 4단계",
    workflowReady: "기능을 열면 바로 작업",
    workflowLabel: "선택, 그리기, 말풍선과 텍스트, 저장과 되돌리기",
    select: "선택",
    selectHint: (shortcut: string) => `${shortcut} · 클릭하거나 드래그해 고르기`,
    draw: "그리기",
    drawHint: (shortcut: string) => `${shortcut} · 펜을 열고 바로 그리기`,
    dialogue: "말풍선·텍스트",
    dialogueHint: (shortcut: string) => `${shortcut} · 도구를 열어 대사 넣기`,
    saveUndo: "저장·되돌리기",
    saveUndoHint: (undoShortcut: string) => `Ctrl/⌘S 저장 · ${undoShortcut} 되돌리기`,
    moreTitle: "다른 작업 바로 열기",
    moreHint: "도형·브러시·컷·캐릭터·3D",
    unassigned: "미지정",
  },
  en: {
    workflowTitle: "Start with these 4 steps",
    workflowReady: "Open a tool and start",
    workflowLabel: "Select, draw, add speech and text, then save or undo",
    select: "Select",
    selectHint: (shortcut: string) => `${shortcut} · Click or drag to select`,
    draw: "Draw",
    drawHint: (shortcut: string) => `${shortcut} · Open the pen and draw`,
    dialogue: "Speech · text",
    dialogueHint: (shortcut: string) => `${shortcut} · Open lettering and add dialogue`,
    saveUndo: "Save · undo",
    saveUndoHint: (undoShortcut: string) => `Ctrl/⌘S save · ${undoShortcut} undo`,
    moreTitle: "Open another tool",
    moreHint: "Shapes · brushes · panels · characters · 3D",
    unassigned: "Unassigned",
  },
} satisfies Record<"ko" | "en", StudioQuickStartCopy>;

function displayQuickStartShortcut(
  shortcuts: StudioQuickStartShortcuts,
  actionId: StudioShortcutActionId,
  defaultChord: string,
  unassignedLabel: string,
): string {
  const chord = shortcuts[actionId];
  if (typeof chord !== "string") return formatStudioShortcutChord(defaultChord);
  const trimmed = chord.trim();
  return trimmed ? formatStudioShortcutChord(trimmed) : unassignedLabel;
}

export function StudioQuickStartPanel({
  onDismiss,
  onQuickComic,
  onExample,
  onOpenTemplate,
  onOpenCharacter,
  onOpenBackground3d,
  onOpenBubble,
  onSmartShape,
  onStartDraw,
  onBrushKit,
  onCollabFocus,
  onOpenTutorials,
  shortcuts,
}: {
  onDismiss: () => void;
  onQuickComic: () => void;
  onExample: () => void;
  onOpenTemplate: () => void;
  onOpenCharacter: () => void;
  onOpenBackground3d: () => void;
  onOpenBubble: () => void;
  onSmartShape: () => void;
  onStartDraw: () => void;
  onBrushKit: (trigger: HTMLButtonElement) => void;
  onCollabFocus: () => void;
  onOpenTutorials: () => void;
  shortcuts: StudioQuickStartShortcuts;
}) {
  const translate = useT();
  const language = useI18n((state) => state.lang);
  const korean = language.toLocaleLowerCase().startsWith("ko");
  const copy = korean ? STUDIO_QUICK_START_COPY.ko : STUDIO_QUICK_START_COPY.en;
  const t = (key: string) => (korean ? key : translate(key));
  const selectShortcut = displayQuickStartShortcut(shortcuts, "tool-select", "V", copy.unassigned);
  const drawShortcut = displayQuickStartShortcut(shortcuts, "tool-pen", "B", copy.unassigned);
  const dialogueShortcut = displayQuickStartShortcut(
    shortcuts,
    "tool-lettering",
    "T",
    copy.unassigned,
  );
  const undoShortcut = displayQuickStartShortcut(shortcuts, "undo", "Mod+Z", copy.unassigned);
  const rootRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLElement>(null);

  // 이 코치는 **모달이 아니다.**
  //
  // 감사 근거(docs/rewrite/ux-audit-v5.md §2.1 · 2026-09-02 아키텍처 리뷰 P0): 손님은 첫 획을
  // 긋기 전에 두 번 조작해야 했다 — 코치를 닫고, 도구를 바꾸고. `aria-modal="true"` + 전면
  // 배경 + 포커스 루프는 그 첫 조작을 **강제**하는 장치였다. 이제 코치는 캔버스 위에 떠 있는
  // 카드일 뿐이라: 마운트할 때 포커스를 가져가지 않고, Tab 을 가두지 않고, 자기 상자 밖의
  // 포인터 이벤트를 먹지 않는다. 남의 모달 위로 뒤늦게 떠도 아무것도 빼앗지 않으므로
  // 예전의 "양보하고 즉시 dismiss" 경로(`yieldToOpenModal`)도 필요 없어졌다.
  //
  // 대신 두 가지는 남는다.
  //   · Esc 는 **포커스가 카드 안에 있을 때만** 닫는다. 빈 캔버스에서 누른 Esc 가 코치를
  //     지우면 "아무것도 안 했는데 뭔가 사라진" 상태가 되고, 그건 비모달의 계약이 아니다.
  //   · 키보드로 카드 안에 들어와 있다가 닫으면 포커스가 `document.body` 로 떨어진다.
  //     그때만 메뉴바 착지점으로 옮겨 준다 — 스스로 뜬 코치에는 돌려줄 트리거가 없다.
  const releaseFocusFromCard = () => {
    const card = cardRef.current;
    const ownerDocument = card?.ownerDocument ?? null;
    if (!card || !ownerDocument) return;
    const active = ownerDocument.activeElement;
    if (!active || !card.contains(active)) return;
    // 스스로 뜬 코치에는 "열어 준 컨트롤"이 없다 — 메뉴바 첫 트리거가 유일한 착지점이다.
    // (비모달이 된 뒤로는 `resolveStudioDialogOpener` 가 카드 안 버튼 자신을 후보로 돌려주어
    //  아무 데도 못 옮긴다. 그 헬퍼는 모달 전용 계약이다.)
    studioDialogFocusAnchor(ownerDocument)?.focus({ preventScroll: true });
  };
  const dismissFromCard = () => {
    releaseFocusFromCard();
    onDismiss();
  };

  const dismissFromEscape = useEffectEvent(() => dismissFromCard());
  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const ownerDocument = card.ownerDocument;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const active = ownerDocument.activeElement;
      const inside =
        (event.target instanceof Node && card.contains(event.target))
        || (active !== null && card.contains(active));
      if (!inside) return;
      // 캡처 단계에서 관찰하되, 카드 안에서 눌렸을 때만 소비한다 — 그래야 같은 Esc 가
      // 스튜디오 전역 단축키(획 취소·선택 해제)로 두 번 해석되지 않는다.
      event.preventDefault();
      event.stopPropagation();
      dismissFromEscape();
    };
    ownerDocument.addEventListener("keydown", onKeyDown, true);
    return () => {
      ownerDocument.removeEventListener("keydown", onKeyDown, true);
    };
  }, []);

  // 코치는 바깥에서 벌어지는 첫 실제 조작에 자리를 내준다.
  //
  // 실측(2026-08-08): 코치가 떠 있는 채로 메뉴바 `텍스트 ▸ 말풍선`을 열면 코치가 사라졌다가,
  // 그 패널을 Esc 로 닫는 순간 **다시 나타났다**. 표시 조건이 파생 상태(`!menu` 등)라 메뉴를
  // 여는 경로는 코치를 *가리기*만 하고 dismiss 상태를 남기지 않기 때문이다. 이 한 줄이
  // dismiss 를 진짜 상태로 기록하게 만들어 재등장 경로를 닫는다.
  //
  // "언제" 닫느냐는 실측으로 두 번 고쳐서 얻었다. 코치가 사라지면 메뉴바가 다시 배치되고
  // React 가 트리거 DOM 노드를 재활용하기 때문에, 클릭이 처리되는 도중에 닫으면 사용자가
  // 겨눈 대상이 발밑에서 바뀐다:
  //   · `pointerdown` 에서 닫음 → mouseup 이 옆 트리거 위에서 떨어져 브라우저가 click 을
  //     공통 조상(DIV)으로 올림 → 트리거 onClick 이 아예 안 돌아 첫 클릭이 먹통.
  //   · `click` 캡처에서 즉시 닫음 → 같은 노드가 다른 그룹으로 재활용된 뒤 React 가
  //     dispatch → `텍스트` 를 눌렀는데 `Draw` 메뉴가 열림.
  // 그래서 관찰은 캡처 단계에서(중간 stopPropagation 에 가려지지 않게), 실행은 dispatch 가
  // 완전히 끝난 뒤 마이크로태스크에서 한다. 코치의 재배치가 사용자의 클릭을 건드리지 않는다.
  const dismissFromOutsideClick = useEffectEvent(() => onDismiss());
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const ownerDocument = root.ownerDocument;
    const onClick = (event: Event) => {
      const target = event.target as Node | null;
      if (target && root.contains(target)) return;
      queueMicrotask(dismissFromOutsideClick);
    };
    ownerDocument.addEventListener("click", onClick, true);
    return () => {
      ownerDocument.removeEventListener("click", onClick, true);
    };
  }, []);

  // 캔버스로 향한 첫 pointerdown 은 **그리려는 동작**이다 — click 까지 기다리면 그 획의 시작점을
  // 잃는다. 그래서 캔버스에 닿는 순간에는 예외적으로 pointerdown 에서 비킨다.
  //
  // 위 경로가 click 을 기다리는 이유(메뉴바 재배치가 사용자가 겨눈 트리거를 바꿔치기함)는 여기에
  // 해당하지 않는다. 코치는 캔버스의 형제 오버레이라 사라져도 캔버스가 재배치되지 않고, 카드
  // 바깥에는 이제 아무 표면도 없어서 이 pointerdown 은 이미 캔버스가 받은 이벤트다. 우리는 그
  // 이벤트를 가로채지 않고(preventDefault·stopPropagation 없음) 코치만 치운다.
  const dismissFromCanvasPointerDown = useEffectEvent(() => onDismiss());
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const ownerDocument = root.ownerDocument;
    const onPointerDown = (event: Event) => {
      const target = event.target as Element | null;
      if (!target || root.contains(target)) return;
      if (typeof target.closest !== "function") return;
      if (!target.closest("[data-studio-canvas-viewport]")) return;
      queueMicrotask(dismissFromCanvasPointerDown);
    };
    ownerDocument.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      ownerDocument.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, []);

  const quickTools: {
    id: "smart-shape" | "brush-kit" | "template" | "character" | "background-3d" | "collab-focus";
    label: string;
    hint: string;
    icon: typeof Pencil;
    onClick: (trigger: HTMLButtonElement) => void;
  }[] = [
    {
      id: "smart-shape",
      label: localizeText(t, "선·도형 다듬기", "studio.quickStart.step.smart-shape.label"),
      hint: localizeText(t, "그린 선을 반듯하게", "studio.quickStart.step.smart-shape.hint"),
      icon: Shapes,
      onClick: onSmartShape,
    },
    {
      id: "brush-kit",
      label: localizeText(t, "브러시 골라 그리기", "studio.quickStart.step.brush-kit.label"),
      hint: localizeText(t, "연필·마커·붓", "studio.quickStart.step.brush-kit.hint"),
      icon: Palette,
      onClick: onBrushKit,
    },
    {
      id: "template",
      label: localizeText(t, "컷 나누기", "studio.quickStart.step.template.label"),
      hint: localizeText(t, "웹툰 칸을 빠르게 배치", "studio.quickStart.step.template.hint"),
      icon: LayoutTemplate,
      onClick: onOpenTemplate,
    },
    {
      id: "character",
      label: localizeText(t, "캐릭터·포즈", "studio.quickStart.step.character.label"),
      hint: localizeText(t, "2D·3D 인물 배치", "studio.quickStart.step.character.hint"),
      icon: Smile,
      onClick: onOpenCharacter,
    },
    {
      id: "background-3d",
      label: localizeText(t, "3D 배경 열기", "studio.quickStart.step.background3d.label"),
      hint: localizeText(t, "장면과 소품 배치", "studio.quickStart.step.background3d.hint"),
      icon: Boxes,
      onClick: onOpenBackground3d,
    },
    {
      id: "collab-focus",
      label: localizeText(t, "캔버스 넓게 보기", "studio.quickStart.step.collab-focus.label"),
      hint: localizeText(t, "패널을 접고 집중", "studio.quickStart.step.collab-focus.hint"),
      icon: Maximize2,
      onClick: onCollabFocus,
    },
  ];

  return (
    // 배치: 작은 화면은 위(하단 모바일 독과 겹치지 않게), ≥sm 은 캔버스 우하단 카드.
    // 그리기 옵션 바가 떠 있으면 그 높이만큼 밀어 올려 도구 옵션을 가리지 않는다 —
    // 코치가 이제 그리기 도구와 공존하기 때문에(자동 표시 조건에서 `tool !== "draw"` 제거)
    // 이 오프셋이 없으면 첫 획을 그으려는 손을 정확히 그 자리에서 막는다.
    <div
      ref={rootRef}
      data-studio-creative-starter="true"
      className="pointer-events-none absolute inset-x-2 top-16 z-[58] mx-auto max-w-[34rem] p-2 text-fg sm:inset-x-auto sm:right-4 sm:top-auto sm:bottom-[calc(var(--studio-draw-options-height,0px)+1rem)] sm:mx-0 sm:w-[min(22rem,calc(100%-2rem))] sm:max-w-none sm:p-0"
    >
      {/* 이름이 붙은 `<section>` 은 그 자체로 `region` 랜드마크다(명시 role 은 중복). 모달이
          아니므로 스크린리더는 코치를 "지나갈 수 있는 한 구역"으로 읽고 캔버스에 그대로 닿는다. */}
      <section
        ref={cardRef}
        data-studio-shortcut-boundary="true"
        aria-labelledby="studio-quick-start-title"
        aria-describedby="studio-quick-start-description"
        className="pointer-events-auto flex max-h-[min(60dvh,calc(100svh-5rem))] flex-col overflow-hidden rounded-lg border border-line bg-panel/95 shadow-xl backdrop-blur-md sm:max-h-[min(66dvh,calc(100svh-2rem))]"
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-3 py-2.5">
          <div className="min-w-0">
            <p
              id="studio-quick-start-title"
              className="text-sm font-bold tracking-tight text-fg"
            >
              {localizeText(t, "처음이라면 이 순서로 시작하세요", "studio.quickStart.title")}
            </p>
            <p
              id="studio-quick-start-description"
              className="mt-0.5 max-w-[48ch] text-[0.7rem] leading-snug text-fg-3"
            >
              {localizeText(
                t,
                "도구를 열면 바로 캔버스에서 작업해요. 캔버스를 누르거나 ✕로 닫을 수 있어요.",
                "studio.quickStart.subtitle",
              )}
            </p>
          </div>
          <button
            type="button"
            data-studio-quickstart-dismiss="true"
            // 전면 스크림이 사라지면서 `data-studio-quickstart-backdrop` 의 소유자도 옮겼다.
            // 그 선택자는 여러 Playwright 검증 스크립트가 "코치가 떠 있는가 · 눌러서 닫기"의
            // 단일 신호로 쓰고 있어서(예: verify-studio-brushes · verify-studio-bg3d-physics),
            // 이름은 유지하되 이제 진짜 닫기 버튼을 가리킨다 — 캔버스를 덮는 오버레이가 아니다.
            data-studio-quickstart-backdrop="true"
            onClick={dismissFromCard}
            className="grid size-11 shrink-0 touch-manipulation place-items-center rounded-lg border border-line text-fg-2 transition-colors duration-150 hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent motion-reduce:transition-none"
            aria-label={localizeText(t, "빠른 시작 닫기 (Esc)", "studio.quickStart.dismiss")}
            title={localizeText(t, "빠른 시작 닫기 (Esc)", "studio.quickStart.dismiss")}
          >
            <X size={16} aria-hidden />
          </button>
        </header>

        <div
          data-studio-quickstart-scroll="true"
          className="min-h-0 overflow-y-auto overscroll-contain p-3 [scrollbar-gutter:stable]"
        >
          <div className="mb-2 flex flex-wrap items-center justify-between gap-1.5">
            <h2 className="text-xs font-bold text-fg">
              {copy.workflowTitle}
            </h2>
            <span className="rounded-md bg-accent-soft px-2 py-1 text-[0.65rem] font-semibold text-accent ring-1 ring-accent/15">
              {copy.workflowReady}
            </span>
          </div>

          <ol
            data-studio-quickstart-workflow="true"
            aria-label={copy.workflowLabel}
            className="grid grid-cols-2 gap-1.5"
          >
            <li
              data-studio-quickstart-step="select"
              className="flex min-h-[4.5rem] items-start gap-2 rounded-lg border border-line bg-card p-2.5"
            >
              <span className="grid size-7 shrink-0 place-items-center rounded-md bg-raised text-fg-2">
                <MousePointer2 size={14} aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block text-xs font-bold text-fg">1. {copy.select}</span>
                <span className="mt-1 block text-[0.66rem] leading-snug text-fg-3">
                  {copy.selectHint(selectShortcut)}
                </span>
              </span>
            </li>

            <li data-studio-quickstart-step="draw">
              <button
                type="button"
                onClick={onStartDraw}
                className="group flex min-h-[4.5rem] w-full touch-manipulation items-start gap-2 rounded-lg border border-accent/35 bg-accent-soft p-2.5 text-left transition-[border-color,background] duration-150 hover:border-accent/70 hover:bg-accent-soft/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent motion-reduce:transition-none"
              >
                <span className="grid size-7 shrink-0 place-items-center rounded-md bg-accent text-on-accent">
                  <Pencil size={14} aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-bold text-fg">2. {copy.draw}</span>
                  <span className="mt-1 block text-[0.66rem] leading-snug text-fg-2">
                    {copy.drawHint(drawShortcut)}
                  </span>
                </span>
                <ChevronRight className="mt-1 shrink-0 text-accent" size={14} aria-hidden />
              </button>
            </li>

            <li data-studio-quickstart-step="dialogue">
              <button
                type="button"
                onClick={onOpenBubble}
                className="group flex min-h-[4.5rem] w-full touch-manipulation items-start gap-2 rounded-lg border border-line bg-card p-2.5 text-left transition-[border-color,background] duration-150 hover:border-accent/55 hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent motion-reduce:transition-none"
              >
                <span className="grid size-7 shrink-0 place-items-center rounded-md bg-raised text-fg-2 group-hover:text-accent">
                  <MessageCircle size={14} aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-bold text-fg">3. {copy.dialogue}</span>
                  <span className="mt-1 block text-[0.66rem] leading-snug text-fg-3">
                    {copy.dialogueHint(dialogueShortcut)}
                  </span>
                </span>
                <ChevronRight className="mt-1 shrink-0 text-fg-3 group-hover:text-accent" size={14} aria-hidden />
              </button>
            </li>

            <li
              data-studio-quickstart-step="save-undo"
              className="flex min-h-[4.5rem] items-start gap-2 rounded-lg border border-line bg-card p-2.5"
            >
              <span className="grid size-7 shrink-0 place-items-center rounded-md bg-raised text-fg-2">
                <Save size={14} aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-1 text-xs font-bold text-fg">
                  4. {copy.saveUndo}
                  <Undo2 size={12} className="text-fg-3" aria-hidden />
                </span>
                <span className="mt-1 block text-[0.66rem] leading-snug text-fg-3">
                  {copy.saveUndoHint(undoShortcut)}
                </span>
              </span>
            </li>
          </ol>

          <div className="mt-2.5 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            <button
              type="button"
              onClick={onQuickComic}
              className={cn(
                buttonClass({ size: "sm", variant: "solid" }),
                "col-span-2 min-h-11 touch-manipulation justify-center gap-1.5 px-3 text-xs sm:col-span-1",
              )}
            >
              <Sparkles size={15} aria-hidden />
              {localizeText(t, "웹툰 흐름으로 시작", "studio.quickStart.quickComic")}
            </button>
            <button
              type="button"
              onClick={onExample}
              className={cn(
                buttonClass({ size: "sm", variant: "quiet" }),
                "min-h-11 touch-manipulation justify-center gap-1.5 px-2 text-xs",
              )}
            >
              <LayoutTemplate size={15} aria-hidden />
              {localizeText(t, "예시로 익히기", "studio.quickStart.exampleCanvas")}
            </button>
            <button
              type="button"
              onClick={onOpenTutorials}
              className={cn(
                buttonClass({ size: "sm", variant: "outline" }),
                "min-h-11 touch-manipulation justify-center gap-1.5 px-2 text-xs",
              )}
            >
              <BookOpen size={15} aria-hidden />
              {localizeText(t, "전체 기능 안내", "studio.quickStart.tutorial")}
            </button>
          </div>

          <details
            data-studio-quickstart-more="true"
            className="group mt-2.5 border-t border-line pt-1.5"
          >
            <summary className="flex min-h-11 cursor-pointer touch-manipulation list-none items-center gap-2 rounded-lg px-2 text-left text-xs text-fg-2 transition-colors duration-150 hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent motion-reduce:transition-none [&::-webkit-details-marker]:hidden">
              <Shapes size={15} className="shrink-0 text-accent" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block font-bold text-fg">
                  {copy.moreTitle}
                </span>
                <span className="mt-0.5 block truncate text-[0.65rem] text-fg-3">
                  {copy.moreHint}
                </span>
              </span>
              <ChevronDown
                size={15}
                className="shrink-0 transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none"
                aria-hidden
              />
            </summary>

            <div className="grid grid-cols-2 gap-1.5 pt-1.5">
              {quickTools.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={(event) => item.onClick(event.currentTarget)}
                    data-studio-quick-tool={item.id}
                    className="group flex min-h-12 touch-manipulation items-center gap-2 rounded-lg border border-line bg-card px-2.5 py-2 text-left transition-[border-color,background] duration-150 hover:border-accent/55 hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent motion-reduce:transition-none"
                  >
                    <span className="grid size-7 shrink-0 place-items-center rounded-md bg-raised text-fg-2 group-hover:text-accent">
                      <Icon size={14} aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[0.7rem] font-bold leading-tight text-fg">{item.label}</span>
                      <span className="mt-0.5 block truncate text-[0.62rem] text-fg-3">{item.hint}</span>
                    </span>
                    <ChevronRight size={13} className="shrink-0 text-fg-3 group-hover:text-accent" aria-hidden />
                  </button>
                );
              })}
            </div>
          </details>
        </div>
      </section>
    </div>
  );
}
