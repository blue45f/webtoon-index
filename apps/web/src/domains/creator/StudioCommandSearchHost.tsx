/**
 * 통합 Command Search 진입점 — 버튼 하나와 **F1** 바인딩.
 *
 * 감사 §2.8 이 "F1 바인딩 없음(`?` 뿐)"을 도움말 결함으로 따로 적었다. 레포
 * 전체에서 `F1` 을 잡는 코드가 0건이었으므로 충돌 없이 새로 잡을 수 있다.
 * 이 호스트는 인스펙터 안에 마운트되지만 리스너는 `window` 에 걸어서, 캔버스에
 * 포커스가 있어도 F1 이 통한다.
 *
 * 다이얼로그 본체는 lazy 로 가져온다 — 검색을 한 번도 열지 않은 세션이 색인과
 * 다이얼로그 코드를 지불하지 않게 하기 위해서다.
 */

import { Search } from "lucide-react";
import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";

import { STUDIO_ICON_SIZE, STUDIO_ICON_STROKE, studioChromeIconClass } from "./studio-chrome-ui";
import {
  subscribeStudioCommandSearchRequests,
  type StudioCommandSearchScope,
} from "./studio-help-center-channel";

import type {
  StudioCommandSearchCloseReason,
  StudioCommandSearchDialogProps,
} from "./StudioCommandSearchDialog";
import type { ReactNode } from "react";

const StudioCommandSearchDialog = lazy(() =>
  import("./StudioCommandSearchDialog").then((module) => ({
    default: module.StudioCommandSearchDialog,
  })),
);

export type StudioCommandSearchHostProps = Omit<
  StudioCommandSearchDialogProps,
  "open" | "onClose" | "initialScope"
> & {
  /** 트리거 버튼을 숨기고 F1 만 남긴다(모바일 등). */
  hideTrigger?: boolean;
  /** Make the owning surface visible before the global search dialog opens. */
  onRequestOpen?: () => void;
  /**
   * 트리거와 같은 줄 오른쪽에 붙는 크롬 버튼(예: 인스펙터 접기).
   *
   * 인스펙터는 이 줄 위에 "인스펙터 / 접기" 전용 캡션 행을 따로 갖고 있었다. 캡션은
   * 바로 아래 탭 스트립이 이미 말해 주는 정보라 세로 공간만 먹었으므로, 접기 버튼을
   * 검색 트리거 옆으로 옮기고 행 하나를 캔버스에 돌려준다.
   */
  trailing?: ReactNode;
};

/**
 * 편집 중인 입력 요소 안에서는 F1 을 가로채지 않는다 — 텍스트 편집기 안에서
 * 브라우저 기본 도움말을 막아 버리면 그게 더 나쁜 놀람이다.
 */
function isEditingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

export function StudioCommandSearchHost({
  hideTrigger = false,
  onRequestOpen,
  trailing,
  ...dialogProps
}: StudioCommandSearchHostProps) {
  const [open, setOpen] = useState(false);
  // 어느 진입점이 열었는지에 따라 첫 범위가 다르다 — 인스펙터의 찾기는 '현재 패널',
  // F1·메뉴·모바일 도크는 '전체'. 다이얼로그 안에서는 언제든 칩으로 바꿀 수 있다.
  const [scope, setScope] = useState<StudioCommandSearchScope>("all");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const close = useCallback((reason: StudioCommandSearchCloseReason = "dismiss") => {
    setOpen(false);
    const restoreTarget = restoreFocusRef.current;
    restoreFocusRef.current = null;
    if (reason === "action" || !restoreTarget) return;
    const restore = () => {
      const target = restoreTarget.isConnected ? restoreTarget : triggerRef.current;
      target?.focus({ preventScroll: true });
    };
    if (globalThis.requestAnimationFrame) {
      globalThis.requestAnimationFrame(restore);
    } else {
      restore();
    }
  }, []);
  const openSearch = useCallback((nextScope: StudioCommandSearchScope = "all") => {
    if (!open && typeof document !== "undefined") {
      const activeElement = document.activeElement;
      restoreFocusRef.current =
        activeElement instanceof HTMLElement && activeElement !== document.body
          ? activeElement
          : triggerRef.current;
    }
    onRequestOpen?.();
    setScope(nextScope);
    setOpen(true);
  }, [onRequestOpen, open]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "F1") return;
      if (event.defaultPrevented) return;
      if (!open && isEditingTarget(event.target)) return;
      event.preventDefault();
      if (open) close();
      else openSearch();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [close, open, openSearch]);

  // 메뉴 › 도움말 › 기능·설정 찾기, 인스펙터 찾기, 모바일 도크 찾기. 그 진입점들은 순수
  // 데이터거나 다른 트리에 있어 이 상태를 직접 만질 수 없으므로 채널로 요청만 받는다
  // (§15.3 Help ▸ Command Search). 요청이 범위를 실어 보내면 그 범위로 연다.
  useEffect(
    () => subscribeStudioCommandSearchRequests((request) => openSearch(request.scope ?? "all")),
    [openSearch],
  );

  return (
    <>
      {hideTrigger && !trailing ? null : (
        <div
          data-studio-command-search-row="true"
          className="flex min-w-0 items-center gap-1 border-b border-line"
        >
          {hideTrigger ? null : (
            <button
              ref={triggerRef}
              type="button"
              onClick={() => openSearch("all")}
              data-testid="studio-command-search-trigger"
              data-inspector-priority="chrome"
              title="기능·설정 찾기 (F1)"
              className="flex min-h-11 min-w-0 flex-1 items-center gap-2 px-3 text-left text-xs text-fg-3 transition-colors hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent lg:min-h-9"
            >
              <Search
                size={STUDIO_ICON_SIZE.contextMenu}
                strokeWidth={STUDIO_ICON_STROKE}
                aria-hidden
                className={studioChromeIconClass({ tone: "default" })}
              />
              <span className="min-w-0 flex-1 truncate">
                기능·설정 찾기 · CSP·Photoshop 용어
              </span>
              <kbd className="shrink-0 rounded border border-line bg-card px-1.5 py-px text-[0.6875rem]">
                F1
              </kbd>
            </button>
          )}
          {trailing}
        </div>
      )}
      {open ? (
        <Suspense fallback={null}>
          <StudioCommandSearchDialog
            {...dialogProps}
            open
            initialScope={scope}
            onClose={close}
          />
        </Suspense>
      ) : null}
    </>
  );
}
