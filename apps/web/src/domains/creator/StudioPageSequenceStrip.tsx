/**
 * Studio Page Sequence Strip — 캔버스 하단에서 페이지를 빠르게 오가는 탐색 전용 필름스트립.
 *
 * 페이지 편집·삭제·복제·재정렬은 기존 페이지 관리 패널의 책임으로 남겨 둔다. 이 컴포넌트는
 * 현재 위치를 확인하고 다른 페이지로 이동하거나 새 페이지를 추가하는 짧은 동선만 제공한다.
 * 호스트가 position:relative인 캔버스 셸 안에 마운트하는 것을 전제로 하며, 작은 가용 폭에서는
 * 가운데 목록만 수평 스크롤되고 추가/닫기 타일은 목록의 양 끝에서 안정적으로 접근할 수 있다.
 */
import { Files, FileText, Plus, X } from "lucide-react";
import { useEffect, useRef, type ReactElement } from "react";

import { cn } from "@/shared/lib/utils";

export interface StudioPageSequenceStripPage {
  id: string;
  label: string;
  thumbnailUrl?: string | null;
}

export interface StudioPageSequenceStripProps {
  open: boolean;
  pages: readonly StudioPageSequenceStripPage[];
  currentPageId: string;
  onSelectPage: (pageId: string) => void;
  onAddPage?: () => void;
  onClose: () => void;
}

/** 현재 페이지를 갑자기 중앙으로 당기지 않고, 잘린 경우에만 가장 가까운 가장자리로 드러낸다. */
function revealStudioPageSequenceItem(
  target: Pick<Element, "scrollIntoView"> | null
): void {
  target?.scrollIntoView({
    behavior: "auto",
    block: "nearest",
    inline: "nearest",
  });
}

export function StudioPageSequenceStrip({
  open,
  pages,
  currentPageId,
  onSelectPage,
  onAddPage,
  onClose,
}: StudioPageSequenceStripProps): ReactElement | null {
  const pageRefs = useRef(new Map<string, HTMLButtonElement>());
  const currentPageIndex = pages.findIndex((page) => page.id === currentPageId);

  useEffect(() => {
    if (!open || currentPageIndex < 0) return;
    revealStudioPageSequenceItem(pageRefs.current.get(currentPageId) ?? null);
  }, [currentPageId, currentPageIndex, open]);

  if (!open) return null;

  return (
    <nav
      aria-label="페이지 시퀀스"
      data-studio-page-sequence-strip="true"
      className={cn(
        "absolute inset-x-2 bottom-[max(0.5rem,env(safe-area-inset-bottom))] z-40",
        "hidden min-w-0 items-stretch gap-2 overflow-hidden rounded-2xl border border-line",
        "bg-panel/95 p-2 text-fg shadow-[0_14px_42px_oklch(0.08_0.01_70/0.48)] backdrop-blur-md",
        "lg:flex"
      )}
    >
      <span className="sr-only">총 {pages.length}페이지</span>

      <div
        aria-hidden="true"
        className="hidden shrink-0 items-center gap-2 border-r border-line/70 px-1 pr-3 xl:flex"
      >
        <span className="grid size-8 place-items-center rounded-lg bg-accent-soft text-accent">
          <Files size={15} aria-hidden />
        </span>
        <span className="min-w-0">
          <span className="block text-[0.65rem] font-bold text-fg-2">시퀀스</span>
          <span className="block text-[0.625rem] tabular-nums text-fg-3">{pages.length}페이지</span>
        </span>
      </div>

      <div
        data-studio-page-sequence-scroller="true"
        className="min-w-0 flex-1 touch-pan-x overflow-x-auto overscroll-x-contain scroll-px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <ol className="flex w-max min-w-full items-stretch gap-2 py-0.5 pr-4">
          {pages.length === 0 ? (
            <li
              role="status"
              className="flex h-[4.75rem] min-w-44 items-center justify-center rounded-xl border border-dashed border-line bg-card/55 px-4 text-center text-xs text-fg-3"
            >
              페이지가 아직 없어요.
            </li>
          ) : null}

          {pages.map((page, index) => {
            const active = page.id === currentPageId;
            const label = page.label.trim() || `${index + 1}페이지`;
            return (
              <li key={page.id} className="shrink-0">
                <button
                  ref={(element) => {
                    if (element) pageRefs.current.set(page.id, element);
                    else pageRefs.current.delete(page.id);
                  }}
                  type="button"
                  data-studio-page-sequence-item="true"
                  aria-current={active ? "page" : undefined}
                  aria-label={`${index + 1}번 페이지, ${label}${active ? ", 현재 페이지" : ""}`}
                  title={`${index + 1}. ${label}`}
                  onClick={() => onSelectPage(page.id)}
                  className={cn(
                    "group flex h-[4.75rem] w-32 min-h-11 min-w-11 shrink-0 items-center gap-2 rounded-xl border px-2 py-1.5 text-left",
                    "transition-colors duration-150 motion-reduce:transition-none",
                    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                    active
                      ? "border-accent bg-accent-soft/70 text-fg shadow-[inset_0_0_0_1px_oklch(0.72_0.185_42/0.18)]"
                      : "border-line bg-card/85 text-fg-2 hover:border-line-strong hover:bg-raised hover:text-fg"
                  )}
                >
                  <span className="relative h-14 w-10 shrink-0 overflow-hidden rounded-md border border-line/70 bg-raised">
                    <span
                      data-studio-sequence-thumbnail-placeholder="true"
                      className="absolute inset-0 grid place-items-center text-fg-3"
                    >
                      <FileText size={15} aria-hidden />
                    </span>
                    {page.thumbnailUrl ? (
                      <img
                        key={page.thumbnailUrl}
                        src={page.thumbnailUrl}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        draggable={false}
                        onError={(event) => {
                          event.currentTarget.hidden = true;
                        }}
                        className="relative size-full bg-card object-contain"
                      />
                    ) : null}
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1 text-[0.625rem] font-semibold tabular-nums text-fg-3">
                      <span
                        aria-hidden="true"
                        className={cn(
                          "size-1.5 shrink-0 rounded-full",
                          active ? "bg-accent" : "bg-transparent"
                        )}
                      />
                      페이지 {index + 1}
                    </span>
                    <span className="mt-1 line-clamp-2 text-xs font-semibold leading-tight text-fg [overflow-wrap:anywhere]">
                      {label}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}

          {onAddPage ? (
            <li className="shrink-0">
              <button
                type="button"
                data-studio-page-sequence-add="true"
                aria-label="새 페이지 추가"
                onClick={onAddPage}
                className={cn(
                  "flex h-[4.75rem] w-24 min-h-11 min-w-11 shrink-0 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-line bg-card/55 px-2 text-xs font-semibold text-fg-2",
                  "transition-colors duration-150 hover:border-accent/60 hover:bg-accent-soft/45 hover:text-accent motion-reduce:transition-none",
                  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                )}
              >
                <Plus size={17} aria-hidden />
                페이지 추가
              </button>
            </li>
          ) : null}
        </ol>
      </div>

      <div className="flex shrink-0 items-center border-l border-line/70 pl-2">
        <button
          type="button"
          data-studio-page-sequence-close="true"
          aria-label="페이지 시퀀스 닫기"
          title="페이지 시퀀스 닫기"
          onClick={onClose}
          className={cn(
            "grid size-11 min-h-11 min-w-11 place-items-center rounded-xl border border-line bg-card text-fg-3",
            "transition-colors duration-150 hover:border-line-strong hover:bg-raised hover:text-fg motion-reduce:transition-none",
            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          )}
        >
          <X size={17} aria-hidden />
        </button>
      </div>
    </nav>
  );
}
