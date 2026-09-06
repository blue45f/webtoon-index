import { useId, useRef, useState, type KeyboardEvent } from "react";

import { studioToolSearchTerms } from "../studio-tool-search";

import { searchStudioShortcutBrushes } from "./studio-shortcut-brush-search";
import {
  STUDIO_SUB_TOOL_PALETTE_CATEGORIES,
  type StudioSubToolPaletteCategory,
} from "./studio-sub-tool-palette-data";
import { StudioSubToolPreview } from "./StudioSubToolPreview";

export interface StudioSubToolPaletteProps {
  activeCategory: string;
  activeSubToolId: string;
  onSelectSubTool: (subToolId: string) => void;
  onCategoryChange?: (category: string) => void;
  /** Data injection seam for tests; defaults to the real core-catalogue mapping. */
  categories?: readonly StudioSubToolPaletteCategory[];
  className?: string;
}

const FOCUS = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

export function StudioSubToolPalette({
  activeCategory,
  activeSubToolId,
  onSelectSubTool,
  onCategoryChange,
  categories = STUDIO_SUB_TOOL_PALETTE_CATEGORIES,
  className = "",
}: StudioSubToolPaletteProps) {
  const id = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [focusedToolId, setFocusedToolId] = useState<string | null>(null);
  const [focusedTabId, setFocusedTabId] = useState<string | null>(null);
  const terms = studioToolSearchTerms(query);
  const searching = terms.length > 0;
  const category = categories.find((candidate) => candidate.id === activeCategory);
  const allTools = [...new Map(categories.flatMap((group) => group.tools.map((tool) => [
    tool.id, { ...tool, categoryLabel: group.label },
  ] as const))).values()];
  const currentTools = searching
    ? searchStudioShortcutBrushes(allTools, query)
    : (category?.tools ?? []);
  const tabStopId = categories.some((group) => group.id === focusedTabId)
    ? focusedTabId
    : category?.id ?? categories[0]?.id;
  const toolStopId = currentTools.some((tool) => tool.id === focusedToolId)
    ? focusedToolId
    : currentTools.find((tool) => tool.id === activeSubToolId)?.id ?? currentTools[0]?.id;

  const focusItem = (index: number) => {
    containerRef.current?.querySelectorAll<HTMLElement>('[role="option"]')[index]?.focus();
  };
  const clearQuery = () => {
    setQuery("");
    setFocusedToolId(null);
    searchRef.current?.focus();
  };
  const handleToolKey = (event: KeyboardEvent<HTMLDivElement>, index: number) => {
    if (event.nativeEvent.isComposing || !currentTools.length) return;
    let next: number | null = null;
    if (event.key === "ArrowDown") next = (index + 1) % currentTools.length;
    if (event.key === "ArrowUp") next = (index - 1 + currentTools.length) % currentTools.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = currentTools.length - 1;
    if (next !== null) {
      event.preventDefault();
      event.stopPropagation();
      focusItem(next);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      event.stopPropagation();
      onSelectSubTool(currentTools[index].id);
    }
  };
  const handleTabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.nativeEvent.isComposing) return;
    let next: number | null = null;
    if (event.key === "ArrowRight") next = (index + 1) % categories.length;
    if (event.key === "ArrowLeft") next = (index - 1 + categories.length) % categories.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = categories.length - 1;
    if (next === null) return;
    event.preventDefault();
    event.stopPropagation();
    tabsRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
    // Focus is deliberately not selection: browsing tabs must not arm a different paint/erase tool.
  };

  return (
    <section data-studio-subtool-palette="true" aria-label="빠른 브러시 선택" className={`min-w-0 rounded-xl border border-line bg-card text-fg-2 ${className}`}>
      <div className="space-y-2 border-b border-line p-2.5">
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="font-semibold text-fg">빠른 브러시</span>
          <span className="text-fg-3">대표 {allTools.length}개</span>
        </div>
        <div className="relative">
          <input
            ref={searchRef}
            type="search"
            aria-label="빠른 브러시 검색"
            aria-describedby={`${id}-scope`}
            value={query}
            placeholder="이름·용도 검색 (예: 명암, G펜)"
            autoComplete="off"
            className={`min-h-11 w-full min-w-0 rounded-lg border border-line bg-panel py-2 pl-3 pr-12 text-xs text-fg placeholder:text-fg-3 ${FOCUS}`}
            onChange={(event) => { setQuery(event.target.value); setFocusedToolId(null); }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === "ArrowDown" && currentTools.length) {
                event.preventDefault(); event.stopPropagation(); focusItem(0);
              } else if (event.key === "Escape" && query) {
                event.preventDefault(); event.stopPropagation(); clearQuery();
              }
            }}
          />
          {query ? <button type="button" onClick={clearQuery} aria-label="브러시 검색 지우기" className={`absolute right-0 top-0 grid min-h-11 min-w-11 place-items-center rounded-lg text-xs text-fg-3 hover:text-fg ${FOCUS}`}>지움</button> : null}
        </div>
        <p id={`${id}-scope`} className="text-[0.65rem] leading-relaxed text-fg-3">
          {searching ? "전체 대표 도구에서 검색합니다." : "획 특징 예시와 용도로 선택하세요."}
        </p>
      </div>

      {!searching ? (
        <div ref={tabsRef} role="tablist" aria-label="서브 도구 분류" className="grid grid-cols-3 gap-1 border-b border-line p-1.5">
          {categories.map((group, index) => (
            <button
              key={group.id}
              id={`${id}-tab-${group.id}`}
              type="button"
              role="tab"
              aria-selected={activeCategory === group.id}
              aria-controls={`${id}-panel`}
              tabIndex={group.id === tabStopId ? 0 : -1}
              onFocus={() => setFocusedTabId(group.id)}
              onKeyDown={(event) => handleTabKey(event, index)}
              onClick={() => { setFocusedToolId(null); onCategoryChange?.(group.id); }}
              className={`min-h-11 min-w-0 rounded-lg px-1 py-2 text-xs transition-colors ${FOCUS} ${activeCategory === group.id ? "bg-accent-soft font-semibold text-accent" : "text-fg-3 hover:bg-raised hover:text-fg"}`}
            >
              {group.label}
            </button>
          ))}
        </div>
      ) : null}

      <div id={`${id}-panel`} role={searching || !category ? "region" : "tabpanel"} aria-labelledby={!searching && category ? `${id}-tab-${category.id}` : undefined} aria-label={searching || !category ? "빠른 브러시 검색 결과" : undefined}>
        <p role="status" aria-live="polite" aria-atomic="true" className="px-3 pt-2 text-[0.65rem] text-fg-3">
          {searching ? `검색 결과 ${currentTools.length}개` : `${category?.label ?? "선택한 분류"} · ${currentTools.length}개`}
        </p>
        <div ref={containerRef} role="listbox" aria-label="서브 도구" className="max-h-80 space-y-1 overflow-y-auto overscroll-contain p-2">
          {currentTools.map((tool, index) => {
            const selected = activeSubToolId === tool.id;
            return (
              <div
                key={tool.id}
                role="option"
                aria-label={tool.name}
                aria-describedby={tool.hint ? `${id}-hint-${tool.id}` : undefined}
                aria-selected={selected}
                tabIndex={tool.id === toolStopId ? 0 : -1}
                onFocus={() => setFocusedToolId(tool.id)}
                onClick={() => onSelectSubTool(tool.id)}
                onKeyDown={(event) => handleToolKey(event, index)}
                className={`flex min-h-14 cursor-pointer select-none items-center gap-2 rounded-lg border p-2 transition-colors ${FOCUS} ${selected ? "border-accent/60 bg-accent-soft/60 text-accent" : "border-transparent hover:border-line hover:bg-raised"}`}
              >
                <StudioSubToolPreview brushId={tool.id} />
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-semibold leading-snug">{tool.name}</span>
                  {tool.hint ? <span id={`${id}-hint-${tool.id}`} className="mt-0.5 block text-[0.65rem] leading-relaxed text-fg-3">{tool.hint}</span> : null}
                </span>
                {selected ? <span aria-hidden className="shrink-0 text-sm">✓</span> : null}
                {tool.shortcut ? <span className="rounded border border-line bg-raised px-1.5 py-0.5 text-[0.65rem] text-fg-3">{tool.shortcut}</span> : null}
              </div>
            );
          })}
          {!currentTools.length ? <div className="p-4 text-center text-xs leading-relaxed text-fg-3">{searching ? "일치하는 대표 도구가 없습니다. 다른 표현은 전체 라이브러리에서 찾을 수 있습니다." : "도구가 없습니다."}</div> : null}
        </div>
      </div>
      <p className="border-t border-line px-3 py-2 text-[0.65rem] leading-relaxed text-fg-3">
        {allTools.some((tool) => tool.id === activeSubToolId) ? "세부 변형은 전체 라이브러리에서 선택할 수 있습니다." : "현재 브러시는 전체 라이브러리의 항목입니다. 선택은 그대로 유지됩니다."}
      </p>
    </section>
  );
}
