/**
 * `InspectorSection` — the progressive-disclosure primitive for the right
 * inspector.
 *
 * A direct port of `StudioImageAdjustmentsPanel.tsx:575-621`
 * (`AdjustmentSection`), which `docs/rewrite/ux-audit-v5.md` §2.5 named as the
 * pattern already correct in this repo. Same affordance (a full-width header
 * button carrying `aria-expanded` plus a rotating chevron), same closed-by-
 * default posture, same `Suspense` boundary so a collapsed section costs
 * nothing until it is opened.
 *
 * Two things are added on top of the original:
 *
 * - `sectionId` is checked against `studio-inspector-density.ts`, which is the
 *   declaration of what belongs behind disclosure and why. A section rendered
 *   with an id the table does not know is a bug — the contract tests read that
 *   table, so an unlisted section would be invisible to them.
 * - `activeCount` surfaces "이 안에 값이 설정돼 있다" on the closed header, so
 *   collapsing never hides the fact that something is switched on.
 * - The open/closed choice **survives the tabpanel unmount**
 *   (`studio-inspector-section-state.ts`). The inspector tears whole tabpanels
 *   down as the artist moves between 속성/레이어/페이지/게시, so before this the
 *   disclosure re-charged a click on every round trip; CSP's palettes remember.
 */

import { ChevronDown } from "lucide-react";
import { Suspense, useEffect, useId, useRef, useState } from "react";

import { inspectorSectionLabel } from "./studio-inspector-density";
import { isStudioInspectorFocusTarget } from "./studio-inspector-focus";
import {
  scrollStudioInspectorTargetIntoView,
  useStudioInspectorFocusRequest,
} from "./studio-inspector-focus-effect";
import {
  readStudioInspectorSectionOpen,
  writeStudioInspectorSectionOpen,
} from "./studio-inspector-section-state";

import type { StudioInspectorFocusTarget } from "./studio-inspector-focus";
import type { ReactNode } from "react";

import { cn } from "@/shared/lib/utils";

export interface StudioInspectorSectionProps {
  /** Must exist in `STUDIO_INSPECTOR_DENSITY` as an advanced-tier group id. */
  sectionId: string;
  /** Defaults to the canonical label from the density table. */
  title?: string;
  /** Opens on mount. Reserved for sections a workspace profile promotes. */
  defaultOpen?: boolean;
  /** Forces open — used when search or a deep link points into the section. */
  forceOpen?: boolean;
  /**
   * Number of controls inside that currently hold a non-default value. Shown
   * as a badge so a closed section still admits it is doing something.
   */
  activeCount?: number;
  loadingLabel?: string;
  children: ReactNode;
}

export function StudioInspectorSection({
  sectionId,
  title,
  defaultOpen = false,
  forceOpen = false,
  activeCount = 0,
  loadingLabel = "설정을 여는 중...",
  children,
}: StudioInspectorSectionProps) {
  const [open, setOpen] = useState(
    () =>
      forceOpen || readStudioInspectorSectionOpen(sectionId, defaultOpen),
  );
  const [focusHighlighted, setFocusHighlighted] = useState(false);
  const panelId = useId();
  const rootRef = useRef<HTMLElement>(null);
  const headerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (forceOpen) setOpen(true);
  }, [forceOpen]);

  /**
   * 헤더를 실제로 누른 것만 기록한다. 검색/딥링크가 강제로 연 것까지 선호로
   * 저장하면 "내가 접어 둔 섹션"이 남의 이동 때문에 조용히 바뀐다.
   */
  const toggleOpen = () => {
    const next = !open;
    setOpen(next);
    writeStudioInspectorSectionOpen(sectionId, next);
  };

  // A menu row pointing at this section must land the artist *on the control*,
  // not on a collapsed header they still have to find and click.
  const focusTarget: StudioInspectorFocusTarget | null =
    isStudioInspectorFocusTarget(sectionId) ? sectionId : null;
  useStudioInspectorFocusRequest(focusTarget, () => {
    setOpen(true);
    setFocusHighlighted(true);
    scrollStudioInspectorTargetIntoView(rootRef.current);
    globalThis.requestAnimationFrame?.(() => {
      headerRef.current?.focus({ preventScroll: true });
    });
  });

  useEffect(() => {
    if (!focusHighlighted) return;
    const timeout = globalThis.setTimeout(() => setFocusHighlighted(false), 1_600);
    return () => globalThis.clearTimeout(timeout);
  }, [focusHighlighted]);

  const heading = title ?? inspectorSectionLabel(sectionId) ?? sectionId;

  return (
    <section
      ref={rootRef}
      className={cn(
        "mt-2 rounded-lg border-t border-line/50 pt-2 transition-[background-color,box-shadow] duration-200",
        focusHighlighted && "bg-accent-soft/55 shadow-[0_0_0_2px_oklch(0.72_0.185_42/0.55)]",
      )}
      data-inspector-section={sectionId}
      data-inspector-section-open={open ? "true" : "false"}
      data-inspector-section-highlighted={focusHighlighted ? "true" : undefined}
    >
      <button
        ref={headerRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={toggleOpen}
        // 디스클로저 헤더는 밀도 감사 어휘에서 chrome — 이동 비용이지 속성이 아니다.
        // 선언이 없으면 이 섹션을 마운트하는 모든 감사가 헤더를 unclassified 로 보고한다.
        data-inspector-control-id={`section.${sectionId}`}
        data-inspector-priority="chrome"
        // 터치에서는 44px, 데스크톱 마우스에서는 32px. 이전 min-h-6(24px)은
        // 손가락 대상으로 쓰기에 너무 작았다.
        className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-1.5 py-1 text-left text-xs font-semibold text-fg transition-colors hover:bg-raised/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent lg:min-h-8 pointer-coarse:min-h-11"
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate">{heading}</span>
          {activeCount > 0 && !open ? (
            <>
              {/* 스크린리더가 "가이드선2" 로 붙여 읽지 않도록 숫자는 시각 전용으로
                  두고, 이름에는 문장을 넣는다. */}
              <span
                aria-hidden
                className="shrink-0 rounded-full bg-accent/15 px-1.5 py-px text-[0.6rem] font-bold tabular-nums text-accent"
                title={`${activeCount}개 설정이 켜져 있습니다.`}
              >
                {activeCount}
              </span>
              <span className="sr-only">{`, 설정 ${activeCount}개 켜짐`}</span>
            </>
          ) : null}
        </span>
        <ChevronDown
          size={14}
          aria-hidden
          className={
            open
              ? "shrink-0 rotate-180 transition-transform"
              : "shrink-0 transition-transform"
          }
        />
      </button>
      <div id={panelId} hidden={!open}>
        {open ? (
          <Suspense
            fallback={
              <div className="mt-2 rounded-lg border border-line bg-card/70 px-3 py-2 text-xs text-fg-3">
                {loadingLabel}
              </div>
            }
          >
            <div className="mt-2 space-y-2">{children}</div>
          </Suspense>
        ) : null}
      </div>
    </section>
  );
}
