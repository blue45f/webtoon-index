/**
 * 통합 Command Search — 감사 §2.8 이 지적한 네 개의 부분 검색창을 대신하는
 * 단일 표면.
 *
 * 코퍼스는 `studio-command-search.ts` 가 만든 하나의 색인(명령 155 + 속성·패널
 * + 인스펙터 라우트 + 튜토리얼)이고, 타사 용어 별칭은 Wave A 카탈로그의
 * `aliases` 를 그대로 소비한다. "Paint Bucket", "스포이트", "QuickShape",
 * "Inherit Alpha" 같이 CSP·Photoshop·Krita·Procreate 에서 쓰던 이름으로 우리
 * 기능이 나온다.
 *
 * 결과가 쏟아지지 않게 하는 장치는 세 겹이다 — 토큰 AND, 구획별 상한, 전체
 * 상한. 잘린 개수는 감추지 않고 "외 N건"으로 보고한다.
 */

import { Ban, ChevronRight, HelpCircle, Play, Search, X } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import { STUDIO_ICON_SIZE, STUDIO_ICON_STROKE, studioChromeIconClass } from "./studio-chrome-ui";
import {
  getStudioCommandExecutionBindings,
  subscribeStudioCommandExecutionBindings,
  type StudioCommandExecutionBinding,
} from "./studio-command-execution-registry";
import { buildStudioSearchIndex, searchStudio } from "./studio-command-search";
import {
  STUDIO_COMMAND_SEARCH_SCOPE_KINDS,
  STUDIO_COMMAND_SEARCH_SCOPE_LABELS,
  STUDIO_COMMAND_SEARCH_SCOPES,
  type StudioCommandSearchScope,
} from "./studio-command-search-scope";

import type {
  StudioSearchEntry,
  StudioSearchOutcome,
  StudioSearchResult,
} from "./studio-command-search";
import type { StudioInspectorFocusTarget } from "./studio-inspector-focus";
import type {
  StudioInspectorActionContext,
  StudioInspectorRoute,
} from "./studio-inspector-layout";

export type StudioCommandSearchCloseReason = "dismiss" | "action";

export interface StudioCommandSearchDialogProps {
  open: boolean;
  onClose: (reason?: StudioCommandSearchCloseReason) => void;
  /** 인스펙터 라우트로 이동. 없으면 그 행은 이동한다고 광고하지 않는다. */
  onNavigateInspector?: (
    route: StudioInspectorRoute,
    focusTarget?: StudioInspectorFocusTarget,
  ) => void;
  /** 튜토리얼 허브 열기. */
  onOpenTutorial?: (tutorialId: string) => void;
  /** 그리기 팔레트 펼치기. */
  onExpandPalette?: (paletteId: "sub-tools" | "tool-properties") => void;
  /**
   * 명령 도움말 열기. 첫 인자는 Wave A 카탈로그의 `helpNodeId`, 둘째는 그 노드가
   * 딸린 **카탈로그 명령 id** 다 — 도움말 표면이 실제로 렌더할 수 있는 것은
   * 카탈로그 명령뿐이라(`buildStudioToolHelp`) 이 콜백은 명령 행에서만 불린다.
   * 소비자가 없으면 명령 행은 "도움말"이라고 광고하지 않는다.
   */
  onOpenHelp?: (helpNodeId: string, commandId: string) => void;
  /** Live Inspector context keeps selection-only search results honest. */
  inspectorContext?: StudioInspectorActionContext;
  /**
   * 첫 범위. 인스펙터의 찾기는 '현재 패널'로 열고, F1·메뉴·모바일 도크는 '전체'로 연다.
   * 화면당 검색 표면은 하나이고(감사 §5.5) 진입점은 범위만 고른다.
   */
  initialScope?: StudioCommandSearchScope;
}

export type { StudioCommandSearchScope } from "./studio-command-search-scope";

const SCOPE_LABELS = STUDIO_COMMAND_SEARCH_SCOPE_LABELS;

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

function resultKey(result: StudioSearchResult): string {
  return `${result.entry.kind}:${result.entry.id}`;
}

/* ------------------------------------------------------------ activation */

/**
 * 행 하나가 **실제로** 할 수 있는 일.
 *
 * 감사가 잡은 결함은 "결과를 실행할 수 없다"가 아니라 **"실행할 수 없는데
 * 실행한다고 적혀 있다"** 였다. 푸터는 언제나 `Enter 실행` 이라고 말했지만
 * 명령 행(코퍼스의 대부분)의 활성화 분기는 소비자가 없는 옵셔널 콜백 하나뿐이라
 * 조용히 no-op 이었다. 그래서 이 모듈은 능력을 먼저 계산하고 배지·푸터·비활성
 * 표시를 전부 그 계산에서 파생시킨다 — **배선이 없으면 광고도 없다.**
 */
export type StudioCommandSearchActionKind =
  | "execute"
  | "inspector"
  | "palette"
  | "tutorial"
  | "help"
  | "none";

export interface StudioCommandSearchAction {
  kind: StudioCommandSearchActionKind;
  /** 행 오른쪽 배지 — "이 행에서 Enter 를 누르면 무엇이 되는가". */
  badge: string;
  /** 푸터가 `Enter ` 뒤에 붙이는 문구. */
  hint: string;
}

/** 소비자가 실제로 넘겨 준 핸들러 집합. */
export interface StudioCommandSearchHandlerAvailability {
  inspector: boolean;
  palette: boolean;
  tutorial: boolean;
  help: boolean;
}

const NO_ACTION: StudioCommandSearchAction = Object.freeze({
  kind: "none",
  badge: "열 수 없음",
  hint: "이 항목은 아직 검색에서 열 수 없습니다",
});

const SELECTION_REQUIRED_ACTION: StudioCommandSearchAction = Object.freeze({
  kind: "none",
  badge: "선택 필요",
  hint: "캔버스에서 요소를 먼저 선택하세요",
});

function studioCommandSearchAction(
  entry: StudioSearchEntry,
  available: StudioCommandSearchHandlerAvailability,
  inspectorContext: StudioInspectorActionContext | undefined,
  commandBindings: ReadonlyMap<string, StudioCommandExecutionBinding>,
): StudioCommandSearchAction {
  const target = entry.target;
  switch (target.type) {
    case "inspector":
      if (entry.requiresSelection && inspectorContext?.hasSelection === false) {
        return SELECTION_REQUIRED_ACTION;
      }
      return available.inspector
        ? { kind: "inspector", badge: "이동", hint: "인스펙터로 이동" }
        : NO_ACTION;
    case "palette":
      return available.palette
        ? { kind: "palette", badge: "펼치기", hint: "팔레트 펼치기" }
        : NO_ACTION;
    case "tutorial":
      return available.tutorial
        ? { kind: "tutorial", badge: "튜토리얼", hint: "튜토리얼 열기" }
        : NO_ACTION;
    case "command": {
      const binding = commandBindings.get(target.commandId);
      if (binding) {
        return binding.disabled
          ? {
            kind: "none",
            badge: "사용 불가",
            hint: binding.unavailableReason ?? "현재 상태에서는 이 명령을 사용할 수 없습니다",
          }
          : { kind: "execute", badge: "실행", hint: "명령 실행" };
      }
      // Unreviewed and consequential commands stay help-only until their menu row explicitly
      // opts in. Search never infers safety from a missing `danger` flag.
      return available.help
        ? { kind: "help", badge: "도움말", hint: "도움말 열기" }
        : NO_ACTION;
    }
    default:
      // `panel`(자동 액션)처럼 아직 소비자가 없는 타깃. 열리는 척하지 않는다.
      return NO_ACTION;
  }
}

const ACTION_ICON: Readonly<
  Record<StudioCommandSearchActionKind, typeof ChevronRight>
> = Object.freeze({
  execute: Play,
  inspector: ChevronRight,
  palette: ChevronRight,
  tutorial: ChevronRight,
  help: HelpCircle,
  none: Ban,
});

/** 어떤 이름으로 맞았는지 — 타사 용어로 찾아온 사람에게 확인을 준다. */
function matchNote(result: StudioSearchResult): string | null {
  if (result.matchedOn === "alias" && result.matchedAlias) {
    const vendor = result.matchedAlias.vendor;
    const vendorLabel =
      vendor === "csp"
        ? "CSP"
        : vendor === "photoshop"
          ? "Photoshop"
          : vendor === "krita"
            ? "Krita"
            : vendor === "procreate"
              ? "Procreate"
              : "이전 이름";
    return `${vendorLabel} "${result.matchedAlias.term}"`;
  }
  return null;
}

export function StudioCommandSearchDialog({
  open,
  onClose,
  onNavigateInspector,
  onOpenTutorial,
  onExpandPalette,
  onOpenHelp,
  inspectorContext,
  initialScope = "all",
}: StudioCommandSearchDialogProps) {
  const titleId = useId();
  const inputId = useId();
  const listboxId = useId();
  const scopeGroupId = useId();
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<StudioCommandSearchScope>(initialScope);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const commandExecutionBindings = useSyncExternalStore(
    subscribeStudioCommandExecutionBindings,
    getStudioCommandExecutionBindings,
    getStudioCommandExecutionBindings,
  );

  const searchIndex = useMemo(
    () => buildStudioSearchIndex(inspectorContext),
    [inspectorContext],
  );
  const scopeKinds = STUDIO_COMMAND_SEARCH_SCOPE_KINDS[scope];
  const outcome: StudioSearchOutcome = useMemo(
    () => searchStudio(query, scopeKinds ? { kinds: scopeKinds } : {}, searchIndex),
    [query, scopeKinds, searchIndex],
  );
  /**
   * 좁힌 범위에서 아무것도 안 맞을 때 전체에서는 몇 건이 맞는지 — "현재 패널에는 없지만
   * 명령에는 있다"를 말해 주지 않으면 좁은 범위가 곧 막다른 길이 된다(감사 §5.5).
   */
  const fallbackOutcome: StudioSearchOutcome | null = useMemo(
    () =>
      scopeKinds && query.trim().length > 0 && outcome.totalMatched === 0
        ? searchStudio(query, {}, searchIndex)
        : null,
    [outcome.totalMatched, query, scopeKinds, searchIndex],
  );

  const available = useMemo<StudioCommandSearchHandlerAvailability>(
    () => ({
      inspector: Boolean(onNavigateInspector),
      palette: Boolean(onExpandPalette),
      tutorial: Boolean(onOpenTutorial),
      help: Boolean(onOpenHelp),
    }),
    [onExpandPalette, onNavigateInspector, onOpenHelp, onOpenTutorial],
  );

  /**
   * 구획 구조를 유지한 채 행마다 평면 인덱스·option id·실제 능력을 미리 붙인다.
   * `aria-activedescendant` 가 가리킬 id 와 `data-active` 가 붙을 행이 같은 곳에서
   * 나와야 둘이 어긋나지 않는다.
   */
  const grouped = useMemo(() => {
    const groups: {
      section: (typeof outcome.sections)[number];
      rows: readonly {
        result: StudioSearchResult;
        index: number;
        optionId: string;
        action: StudioCommandSearchAction;
      }[];
    }[] = [];
    let consumed = 0;
    for (const section of outcome.sections) {
      const base = consumed;
      groups.push({
        section,
        rows: section.results.map((result, offset) => ({
          result,
          index: base + offset,
          optionId: `${listboxId}-option-${base + offset}`,
          action: studioCommandSearchAction(
            result.entry,
            available,
            inspectorContext,
            commandExecutionBindings,
          ),
        })),
      });
      consumed = base + section.results.length;
    }
    return groups;
  }, [available, commandExecutionBindings, inspectorContext, listboxId, outcome]);

  const flat = useMemo(() => grouped.flatMap((group) => group.rows), [grouped]);
  const activeRow = flat[activeIndex];

  useEffect(() => {
    setActiveIndex(0);
  }, [query, scope]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setScope(initialScope);
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [initialScope, open]);

  // 활성 행을 시야에 유지한다. 포커스는 combobox 에 남으므로 브라우저가 자동으로
  // 스크롤해 주지 않는다 — activedescendant 패턴에서는 우리가 해야 한다.
  useEffect(() => {
    if (!open || !activeRow) return;
    const node = document.getElementById(activeRow.optionId);
    node?.scrollIntoView?.({ block: "nearest" });
  }, [activeRow, open]);

  const activate = useCallback(
    (result: StudioSearchResult) => {
      const target = result.entry.target;
      const action = studioCommandSearchAction(
        result.entry,
        available,
        inspectorContext,
        commandExecutionBindings,
      );
      switch (action.kind) {
        case "inspector": {
          if (target.type !== "inspector") return;
          // 행이 광고한 목적지를 통째로 넘긴다. 서브탭(`image`/`document`)을
          // 빼면 탭만 맞고 화면은 직전 서브탭에 남는다.
          const route: StudioInspectorRoute = {
            primary: target.primary,
            ...(target.image ? { image: target.image } : {}),
            ...(target.document ? { document: target.document } : {}),
          };
          if (target.focusTarget) onNavigateInspector?.(route, target.focusTarget);
          else onNavigateInspector?.(route);
          onClose("action");
          return;
        }
        case "tutorial": {
          if (target.type !== "tutorial") return;
          onOpenTutorial?.(target.tutorialId);
          onClose("action");
          return;
        }
        case "palette": {
          if (target.type !== "palette") return;
          onExpandPalette?.(target.paletteId);
          onClose("action");
          return;
        }
        case "execute": {
          if (target.type !== "command") return;
          const binding = commandExecutionBindings.get(target.commandId);
          if (!binding || binding.disabled) return;
          binding.execute();
          onClose("action");
          return;
        }
        case "help": {
          if (target.type !== "command") return;
          // 도움말 표면도 모달이다. 검색을 열어 둔 채 겹치면 Esc 가 어느 쪽을
          // 닫는지 알 수 없으므로 검색은 닫고 넘긴다.
          onOpenHelp?.(result.entry.helpNodeId, target.commandId);
          onClose("action");
          return;
        }
        default:
          // 능력이 없는 행. 행 배지와 푸터가 이미 그렇게 말하고 있으므로
          // 여기서 조용히 아무것도 하지 않는 것이 계약대로다.
          return;
      }
    },
    [
      available,
      commandExecutionBindings,
      inspectorContext,
      onClose,
      onExpandPalette,
      onNavigateInspector,
      onOpenHelp,
      onOpenTutorial,
    ],
  );

  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.isComposing) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        if (flat.length === 0) return;
        setActiveIndex((previous) => {
          const step = event.key === "ArrowDown" ? 1 : -1;
          return (previous + step + flat.length) % flat.length;
        });
        return;
      }
      if (event.key === "Enter") {
        const row = flat[activeIndex];
        if (row) {
          event.preventDefault();
          activate(row.result);
        }
        return;
      }
      if (event.key !== "Tab") return;
      // aria-modal 계약을 지키는 포커스 트랩. 감사 §2.9 가 온로드 모달에서
      // 트랩 부재를 심각 결함으로 판정했으므로 새 모달은 처음부터 가둔다.
      const root = dialogRef.current;
      if (!root) return;
      // 결과 행은 `role="option"` + `tabIndex=-1` 이라 탭 순서에 없다(콤보박스
      // 계약). 트랩 후보에서도 같은 기준으로 빼지 않으면 Tab 이 옵션에 갇힌다.
      const focusables = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (node) => node.tabIndex >= 0,
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [activate, activeIndex, flat, onClose],
  );

  // 키 처리는 JSX prop 대신 노드 리스너로 건다. `role="dialog"` 컨테이너는
  // 비인터랙티브 요소라 핸들러를 prop 으로 붙이면 a11y 규칙에 걸린다.
  useEffect(() => {
    const node = dialogRef.current;
    if (!open || !node) return;
    node.addEventListener("keydown", onKeyDown);
    return () => node.removeEventListener("keydown", onKeyDown);
  }, [open, onKeyDown]);

  if (!open || typeof document === "undefined") return null;

  const hasResults = flat.length > 0;
  const footerHint = hasResults
    ? `↑↓ 이동 · Enter ${activeRow?.action.hint ?? "열기"} · Esc 닫기`
    : "Esc 닫기";

  return createPortal(
    <div
      className="fixed inset-0 z-[120] flex items-start justify-center bg-black/45 px-4 pt-[12vh] backdrop-blur-sm"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl"
      >
        <div className="flex items-center gap-2 border-b border-line px-3">
          <Search
            size={STUDIO_ICON_SIZE.context}
            strokeWidth={STUDIO_ICON_STROKE}
            aria-hidden
            className={studioChromeIconClass({ tone: "muted" })}
          />
          <h2 id={titleId} className="sr-only">
            기능·설정 찾기
          </h2>
          {/*
            콤보박스 계약(WAI-ARIA APG). `role="searchbox"` 였을 때는 결과 목록이
            보조기술에 아예 존재하지 않았고 ↑↓ 하이라이트도 `data-active` 라는
            시각 전용 속성으로만 움직였다 — 스크린리더 사용자에게는 검색 결과가
            없는 화면이었다. 이제 포커스는 입력에 남고 활성 행은
            `aria-activedescendant` 로 전달된다.
          */}
          <input
            ref={inputRef}
            id={inputId}
            type="search"
            role="combobox"
            aria-labelledby={titleId}
            aria-autocomplete="list"
            aria-expanded={hasResults}
            aria-controls={listboxId}
            {...(activeRow
              ? { "aria-activedescendant": activeRow.optionId }
              : {})}
            value={query}
            autoComplete="off"
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="기능 이름 또는 CSP·Photoshop 용어 (예: Paint Bucket, 레벨, 서브 도구)"
            className="min-h-11 min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-3"
          />
          <button
            type="button"
            onClick={() => onClose()}
            title="닫기 (Esc)"
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-fg-3 transition-colors hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <X
              size={STUDIO_ICON_SIZE.context}
              strokeWidth={STUDIO_ICON_STROKE}
              aria-hidden
              className={studioChromeIconClass({ tone: "default" })}
            />
            <span className="sr-only">검색 닫기</span>
          </button>
        </div>

        {/*
          범위 칩. 검색 표면은 하나이고 여기서 범위만 바꾼다 — 인스펙터 안의 "패널 찾기"와
          전역 검색이 따로 있던 것을 대신한다.
        */}
        <div
          role="radiogroup"
          aria-label="검색 범위"
          id={scopeGroupId}
          data-studio-command-search-scope={scope}
          className="flex flex-wrap items-center gap-1 border-b border-line px-3 py-1.5"
        >
          {STUDIO_COMMAND_SEARCH_SCOPES.map((candidate) => {
            const checked = candidate === scope;
            return (
              <button
                key={candidate}
                type="button"
                role="radio"
                aria-checked={checked}
                data-scope={candidate}
                onClick={() => setScope(candidate)}
                className={`min-h-8 rounded-full border px-2.5 text-[0.6875rem] font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                  checked
                    ? "border-accent bg-accent-soft text-accent"
                    : "border-line text-fg-3 hover:bg-raised hover:text-fg"
                }`}
              >
                {SCOPE_LABELS[candidate]}
              </button>
            );
          })}
        </div>

        <p role="status" aria-live="polite" className="sr-only">
          {query.trim().length === 0
            ? "검색어를 입력하세요."
            : `${outcome.totalMatched}개 중 ${outcome.totalShown}개를 표시합니다.`}
        </p>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
          {query.trim().length === 0 ? (
            <p className="px-2 py-6 text-center text-xs leading-relaxed text-fg-3">
              쓰던 프로그램의 이름 그대로 찾아보세요.
              <br />
              CSP·Photoshop·Krita·Procreate 용어를 우리 기능으로 이어 줍니다.
            </p>
          ) : outcome.sections.length === 0 ? (
            <div className="px-2 py-6 text-center text-xs text-fg-3">
              <p>
                {scopeKinds
                  ? `${SCOPE_LABELS[scope]} 범위에서 “${query}” 와 맞는 항목이 없습니다.`
                  : `“${query}” 와 맞는 기능을 찾지 못했습니다.`}
              </p>
              {fallbackOutcome && fallbackOutcome.totalMatched > 0 ? (
                <button
                  type="button"
                  onClick={() => setScope("all")}
                  data-studio-command-search-widen="true"
                  className="mt-2 inline-flex min-h-9 items-center rounded-lg border border-accent/40 bg-accent-soft px-3 text-xs font-semibold text-accent transition-colors hover:border-accent/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  전체에서 {fallbackOutcome.totalMatched}건 보기
                </button>
              ) : null}
            </div>
          ) : null}
          {/*
            콤보박스의 `aria-controls` 는 언제나 실재하는 id 를 가리켜야 하므로
            목록 컨테이너는 항상 남기고, 결과가 없을 때만 `hidden` 으로 접근성
            트리에서 뺀다(APG collapsed combobox 와 같은 처리).
          */}
          <div
            id={listboxId}
            role="listbox"
            aria-labelledby={titleId}
            hidden={!hasResults}
          >
            {grouped.map(({ section, rows }) => {
                const groupHeadingId = `${listboxId}-group-${section.kind}`;
                return (
                  <section
                    key={section.kind}
                    role="group"
                    aria-labelledby={groupHeadingId}
                    className="mb-2 last:mb-0"
                  >
                    <div className="flex items-baseline justify-between gap-2 px-2 py-1">
                      <h3
                        id={groupHeadingId}
                        className="text-[0.66rem] font-semibold uppercase tracking-wider text-fg-3"
                      >
                        {section.label}
                      </h3>
                      {section.truncated ? (
                        <span className="text-[0.62rem] tabular-nums text-fg-3">
                          외 {section.matched - section.results.length}건
                        </span>
                      ) : null}
                    </div>
                    {/*
                      DOM 은 목록으로 두되 ARIA 트리는 listbox › group › option 이
                      되도록 중간 래퍼를 presentation 으로 지운다.
                    */}
                    <ul role="presentation" className="space-y-0.5">
                      {rows.map(({ result, index, optionId, action }) => {
                        const note = matchNote(result);
                        const inert = action.kind === "none";
                        const ActionIcon = ACTION_ICON[action.kind];
                        return (
                          <li key={resultKey(result)} role="presentation">
                            <button
                              type="button"
                              id={optionId}
                              role="option"
                              tabIndex={-1}
                              aria-selected={index === activeIndex}
                              {...(inert ? { "aria-disabled": true } : {})}
                              data-active={index === activeIndex ? "true" : undefined}
                              data-action={action.kind}
                              onPointerEnter={() => setActiveIndex(index)}
                              onClick={() => activate(result)}
                              className={`flex min-h-11 w-full min-w-0 items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-left transition-colors data-[active=true]:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                                inert
                                  ? "cursor-not-allowed opacity-55"
                                  : "hover:bg-raised"
                              }`}
                            >
                              <span className="min-w-0">
                                <span className="block truncate text-sm text-fg">
                                  {result.entry.label}
                                </span>
                                <span className="block truncate text-[0.66rem] text-fg-3">
                                  {result.entry.location}
                                  {note ? ` · ${note}` : ""}
                                </span>
                              </span>
                              <span className="flex shrink-0 items-center gap-1.5">
                                {result.entry.shortcut ? (
                                  <kbd className="rounded border border-line bg-card px-1.5 py-px text-[0.66rem] text-fg-3">
                                    {result.entry.shortcut}
                                  </kbd>
                                ) : null}
                                {/*
                                  행마다 "Enter 를 누르면 무엇이 되는지"를 글자로
                                  적는다. 명령 행은 "도움말"이라고 적히므로
                                  실행되는 척하지 않는다.
                                */}
                                <span className="rounded-full border border-line px-1.5 py-px text-[0.6rem] text-fg-3">
                                  {action.badge}
                                </span>
                                <ActionIcon
                                  size={STUDIO_ICON_SIZE.subtab}
                                  strokeWidth={STUDIO_ICON_STROKE}
                                  aria-hidden
                                  className={studioChromeIconClass({ tone: "muted" })}
                                />
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                );
            })}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-line px-3 py-1.5 text-[0.62rem] text-fg-3">
          <span>{footerHint}</span>
          {outcome.truncated ? (
            <span className="tabular-nums">
              {outcome.totalMatched}건 중 {outcome.totalShown}건 표시
            </span>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
