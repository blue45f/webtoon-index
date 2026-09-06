// 놀이터 게임 공용 "게임 방법" 안내 — 첫 진입 시 규칙 오버레이를 띄우고,
// 작은 "방법" 칩 버튼으로 언제든 다시 열 수 있게 한다. 게임별로 title+steps만 주입.

import { HelpCircle } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/lib/utils";

export interface HelpStep {
  /** 앞에 붙는 이모지(예: "🎯"). */
  emoji: string;
  /** 단계 제목(예: "목표"). */
  title: string;
  /** 설명(강조는 <b>/<span> 등 ReactNode 허용). */
  desc: ReactNode;
}

/** 첫 진입 안내를 봤는지 기록하는 localStorage 키(게임 id별). */
function seenKey(id: string): string {
  return `play:help-seen:${id}`;
}

/** 이 게임의 안내를 이미 봤는지 — SSR/비공개 모드에서도 안전(미저장=false). */
function hasSeenHelp(id: string): boolean {
  try {
    return localStorage.getItem(seenKey(id)) === "1";
  } catch {
    return false;
  }
}

/** 안내를 봤다고 기록 — 실패(비공개 모드 등) 시 조용히 무시. */
function markHelpSeen(id: string): void {
  try {
    localStorage.setItem(seenKey(id), "1");
  } catch {
    // 비공개 모드 등 — 조용히 무시.
  }
}

/** 다이얼로그 내부에서 포커스 가능한 요소들. */
function focusableIn(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  );
}

/**
 * 자체적으로 "방법" 버튼 + 규칙 오버레이를 렌더한다(여는 상태 직접 관리).
 * 게임 헤더 어딘가에 `<GameHelp id=... title=... steps=... />` 한 줄만 두면 됨.
 *
 * - 첫 진입(게임 id별 localStorage 미기록) 시에만 자동으로 열린다. 이후엔 닫힌 채로
 *   시작하고 "방법" 칩으로 다시 열 수 있다.
 * - 열리면 다이얼로그 안으로 포커스를 옮기고 Tab을 가둔다(focus trap). 닫으면 트리거
 *   칩으로 포커스를 되돌린다. Esc/백드롭으로도 닫힌다.
 */
export function GameHelp({
  id,
  title,
  steps,
  className,
}: {
  /** 게임별 안정적인 고유 id(예: "rps"). 첫 진입 자동 표시 기록에 사용. */
  id: string;
  title: string;
  steps: HelpStep[];
  className?: string;
}) {
  // 첫 렌더에서만 "처음인지"를 평가 — 이후 재마운트에선 다시 자동으로 뜨지 않는다.
  const [open, setOpen] = useState(() => !hasSeenHelp(id));

  const dialogRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const primaryBtnRef = useRef<HTMLButtonElement | null>(null);

  const close = () => {
    markHelpSeen(id);
    setOpen(false);
  };

  const openHelp = () => {
    markHelpSeen(id);
    setOpen(true);
  };

  // 열렸을 때: 안내를 봤다고 기록, 포커스 진입, Esc 닫기 + Tab 트랩.
  useEffect(() => {
    if (!open) return;
    markHelpSeen(id);

    // 기본 액션 버튼(없으면 다이얼로그 컨테이너)으로 포커스 이동.
    (primaryBtnRef.current ?? dialogRef.current)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        return;
      }
      if (e.key !== "Tab") return;
      const root = dialogRef.current;
      if (!root) return;
      const focusable = focusableIn(root);
      if (focusable.length === 0) {
        e.preventDefault();
        root.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeEl = document.activeElement as HTMLElement | null;
      // 트랩 밖(또는 경계)으로 나가려는 Tab을 다이얼로그 안으로 되돌린다.
      if (e.shiftKey && (activeEl === first || !root.contains(activeEl))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (activeEl === last || !root.contains(activeEl))) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, id]);

  // 닫힐 때: 트리거 칩으로 포커스 복원.
  useEffect(() => {
    if (open) return;
    triggerRef.current?.focus();
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={openHelp}
        className={cn(
          "inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-[0.7rem] font-medium text-fg-2 transition hover:border-accent/60 hover:text-accent",
          className,
        )}
        aria-label="게임 방법 보기"
      >
        <HelpCircle className="h-3.5 w-3.5" /> 방법
      </button>

      {open && (
        <div className="fixed inset-0 z-[60] grid place-items-center p-4">
          {/* 백드롭(클릭/Enter/Space로 닫힘 — 실제 button이라 a11y 충족) */}
          <button
            type="button"
            aria-label="닫기"
            onClick={close}
            tabIndex={-1}
            className="absolute inset-0 cursor-default bg-black/70 backdrop-blur-sm"
          />
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={`${title} 게임 방법`}
            tabIndex={-1}
            className="relative w-full max-w-sm rounded-2xl border border-line bg-card p-5 shadow-2xl outline-none"
          >
            <h3 className="mb-3 flex items-center gap-2 text-base font-bold text-fg">
              <HelpCircle className="h-5 w-5 text-accent" /> {title} — 이렇게 해요
            </h3>
            <ul className="space-y-2.5 text-[0.82rem] leading-relaxed text-fg-2">
              {steps.map((s) => (
                <li key={s.title}>
                  <b className="text-fg">
                    {s.emoji} {s.title}
                  </b>{" "}
                  — {s.desc}
                </li>
              ))}
            </ul>
            <Button ref={primaryBtnRef} variant="solid" className="mt-4 w-full" onClick={close}>
              알겠어요, 시작!
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

export default GameHelp;
