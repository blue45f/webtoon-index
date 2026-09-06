import { Search, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactElement,
} from "react";

import { StudioSurfaceState } from "./StudioSurfaceState";

import { cn } from "@/shared/lib/utils";

function normalizeProjectQuery(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase();
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(
    target.closest(
      'input,textarea,select,[contenteditable="true"],[role="textbox"]',
    ),
  );
}

export function StudioProjectCenterSection({
  title,
  description,
  className,
}: {
  title: string;
  description: string;
  className?: string;
}): ReactElement {
  return (
    <div
      data-project-center-section="true"
      className={cn(
        "col-span-full flex items-end justify-between gap-3 border-t border-line/60 px-1 pb-1 pt-3 first:border-t-0 first:pt-0",
        className,
      )}
    >
      <div className="min-w-0">
        <h2 className="text-[0.72rem] font-bold tracking-tight text-fg">
          {title}
        </h2>
        <p className="mt-0.5 text-[0.62rem] leading-relaxed text-fg-3 text-pretty">
          {description}
        </p>
      </div>
    </div>
  );
}

/**
 * 프로젝트 센터의 많은 명령을 DOM 텍스트·접근명·설명으로 즉시 필터링한다.
 * 명령 구현은 기존 버튼이 계속 소유하고, 검색은 보이기/숨기기만 담당하므로 두 번째
 * 실행 경로를 만들지 않는다. `/`는 검색으로, Esc는 먼저 검색어 초기화로 동작한다.
 */
export function StudioProjectCenterSearch(): ReactElement {
  const inputId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const originalHiddenRef = useRef(new Map<HTMLButtonElement, boolean>());
  const [query, setQuery] = useState("");
  const [stats, setStats] = useState({ matched: 0, total: 0 });

  const applyFilter = useCallback(() => {
    const root = rootRef.current;
    const panel = root?.closest<HTMLElement>(
      '[data-studio-project-actions-menu="true"]',
    );
    if (!root || !panel) return;
    const normalized = normalizeProjectQuery(query);
    const buttons = Array.from(panel.querySelectorAll<HTMLButtonElement>("button"))
      .filter((button) => !root.contains(button))
      .filter((button) => button.dataset.projectCenterControl !== "true");

    let total = 0;
    let matched = 0;
    for (const button of buttons) {
      if (!originalHiddenRef.current.has(button)) {
        // TypeScript 6 models HTMLElement.hidden as boolean | "until-found".
        // The project center only needs to preserve whether the authored element
        // was hidden at all, so normalize through the attribute contract.
        originalHiddenRef.current.set(button, button.hasAttribute("hidden"));
      }
      const originallyHidden = originalHiddenRef.current.get(button) ?? false;
      const haystack = normalizeProjectQuery([
        button.textContent ?? "",
        button.getAttribute("aria-label") ?? "",
        button.getAttribute("title") ?? "",
      ].join(" "));
      const matches = normalized.length === 0 || haystack.includes(normalized);
      button.hidden = originallyHidden || !matches;
      button.dataset.projectCenterMatch = matches ? "true" : "false";
      if (!originallyHidden) {
        total += 1;
        if (matches) matched += 1;
      }
    }
    setStats((current) =>
      current.matched === matched && current.total === total
        ? current
        : { matched, total },
    );
  }, [query]);

  useEffect(() => {
    applyFilter();
    const panel = rootRef.current?.closest<HTMLElement>(
      '[data-studio-project-actions-menu="true"]',
    );
    if (!panel || typeof MutationObserver !== "function") return;
    const observer = new MutationObserver(() => applyFilter());
    observer.observe(panel, { childList: true, characterData: true, subtree: true });
    return () => observer.disconnect();
  }, [applyFilter]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const panel = rootRef.current?.closest<HTMLElement>(
        '[data-studio-project-actions-menu="true"]',
      );
      if (!panel) return;
      if (
        event.key === "/"
        && !event.metaKey
        && !event.ctrlKey
        && !event.altKey
        && !isEditableTarget(event.target)
      ) {
        event.preventDefault();
        inputRef.current?.focus({ preventScroll: true });
        return;
      }
      if (event.key === "Escape" && query.length > 0) {
        event.preventDefault();
        event.stopPropagation();
        setQuery("");
        inputRef.current?.focus({ preventScroll: true });
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [query]);

  useEffect(() => () => {
    for (const [button, hidden] of originalHiddenRef.current) {
      button.hidden = hidden;
      delete button.dataset.projectCenterMatch;
    }
    originalHiddenRef.current.clear();
  }, []);

  const active = normalizeProjectQuery(query).length > 0;
  return (
    <div
      ref={rootRef}
      data-project-center-search="true"
      className="mt-2"
    >
      <label
        htmlFor={inputId}
        className="flex min-h-11 items-center gap-2 rounded-xl border border-line bg-canvas/70 px-3 shadow-inner transition-colors focus-within:border-accent/60 focus-within:bg-card"
      >
        <Search size={15} aria-hidden className="shrink-0 text-fg-3" />
        <input
          ref={inputRef}
          id={inputId}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="도구 검색 · /"
          aria-label="프로젝트 센터 도구 검색"
          className="min-w-0 flex-1 bg-transparent text-[0.75rem] text-fg outline-none placeholder:text-fg-3"
        />
        <span
          role="status"
          aria-live="polite"
          className="shrink-0 text-[0.62rem] font-semibold tabular-nums text-fg-3"
        >
          {active ? `${stats.matched}/${stats.total}개` : `${stats.total}개`}
        </span>
        {active ? (
          <button
            type="button"
            data-project-keep-open
            data-project-center-control="true"
            onClick={() => {
              setQuery("");
              inputRef.current?.focus({ preventScroll: true });
            }}
            aria-label="프로젝트 센터 검색 초기화"
            className="grid size-8 shrink-0 place-items-center rounded-lg text-fg-3 transition-colors hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <X size={14} aria-hidden />
          </button>
        ) : (
          <kbd className="hidden shrink-0 rounded border border-line/70 bg-card px-1.5 py-0.5 text-[0.58rem] font-semibold text-fg-3 sm:inline-flex">
            /
          </kbd>
        )}
      </label>
      {active && stats.total > 0 && stats.matched === 0 ? (
        <StudioSurfaceState
          state="empty"
          compact
          title="일치하는 프로젝트 도구가 없습니다"
          description="백업, 검수, 게시, 버전처럼 작업 목적을 입력해 보세요."
          className="mt-2"
          action={(
            <button
              type="button"
              data-project-keep-open
              data-project-center-control="true"
              onClick={() => setQuery("")}
              className="min-h-9 rounded-lg border border-line bg-card px-3 text-[0.7rem] font-semibold text-fg-2 hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              전체 도구 보기
            </button>
          )}
        />
      ) : null}
    </div>
  );
}
