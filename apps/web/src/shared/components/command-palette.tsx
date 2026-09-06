import { playSfx } from "@toonspectrum/core/fx";
import { Command } from "cmdk";
import {
  Search,
  CornerDownLeft,
  X,
  Clock,
  ExternalLink,
  Tag,
} from "lucide-react";
import { useEffect, useState, useRef } from "react";

import {
  PALETTE_COMMANDS,
  PALETTE_MODE_TABS,
  PALETTE_PAGES,
  PALETTE_STUDIO_TOOLS,
  TRENDING_TAGS,
} from "./command-palette-data";
import { CommandPalettePreview } from "./command-palette-preview";
import { matchesCommandSearch } from "./command-palette-search";
import { MiniPoster } from "./rank-row";
import { RatingInline } from "./ui/stars";

import type {
  CommandContext,
  PaletteMode,
  PaletteSelectedItem,
} from "./command-palette-types";
import type { Title } from "@/shared/lib/types";

import { statsAreEstimated } from "@/shared/lib/estimate";
import { genreTextColor } from "@/shared/lib/genre-color";
import { useT } from "@/shared/lib/i18n";
import { useApp } from "@/shared/lib/store";
import { TYPE_LABEL } from "@/shared/lib/taxonomy";
import { toast } from "@/shared/lib/toast-store";
import { cn } from "@/shared/lib/utils";
import { useRouter } from "@/src/compat/navigation";
import { useDebouncedValue } from "@/src/hooks/use-debounced-value";
import {
  fetchSearchResponse,
  isSearchAbortError,
} from "@/src/infrastructure/search-client";

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [q, setQ] = useState("");
  const [mode, setMode] = useState<PaletteMode>("all");
  const debouncedQ = useDebouncedValue(q, 140);
  const [results, setResults] = useState<Title[]>([]);
  const [recentTitles, setRecentTitles] = useState<Title[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [activeValue, setActiveValue] = useState<string>("");

  const recentlyViewed = useApp((s) => s.recentlyViewed);
  const recentSearches = useApp((s) => s.recentSearches);
  const addRecentSearch = useApp((s) => s.addRecentSearch);
  const removeRecentSearch = useApp((s) => s.removeRecentSearch);
  const clearRecentSearches = useApp((s) => s.clearRecentSearches);

  const recentKey = recentlyViewed.slice(0, 6).join(",");
  const router = useRouter();
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);

  const trimmedQ = q.trim();
  const debouncedTrimmedQ = debouncedQ.trim();

  // Strip prefix characters like >, @, /, #, ? if present at start for inner searching
  let effectiveQuery = trimmedQ;
  let activePrefix = "";
  if (trimmedQ.startsWith(">")) {
    activePrefix = ">";
    effectiveQuery = trimmedQ.slice(1).trim();
  } else if (trimmedQ.startsWith("@")) {
    activePrefix = "@";
    effectiveQuery = trimmedQ.slice(1).trim();
  } else if (trimmedQ.startsWith("/")) {
    activePrefix = "/";
    effectiveQuery = trimmedQ.slice(1).trim();
  } else if (trimmedQ.startsWith("#")) {
    activePrefix = "#";
    effectiveQuery = trimmedQ.slice(1).trim();
  } else if (trimmedQ.startsWith("?")) {
    activePrefix = "?";
    effectiveQuery = trimmedQ.slice(1).trim();
  }

  const searchSettling = Boolean(effectiveQuery) && effectiveQuery !== debouncedTrimmedQ;
  const isSearching = Boolean(effectiveQuery) && (searchSettling || searchLoading);

  // Sound effects and body overflow management on open/close
  useEffect(() => {
    if (open) {
      playSfx("open");
    } else {
      playSfx("close");
    }
    document.body.style.overflow = open ? "hidden" : "";
    const id = open
      ? undefined
      : setTimeout(() => {
          setQ("");
          setMode("all");
          setActiveValue("");
        }, 0);
    return () => {
      document.body.style.overflow = "";
      if (id) clearTimeout(id);
    };
  }, [open]);

  // Derive active mode synchronously from prefix if present, else fallback to state
  const activeMode: PaletteMode =
    trimmedQ.startsWith(">")
      ? "commands"
      : trimmedQ.startsWith("@")
      ? "titles"
      : trimmedQ.startsWith("/")
      ? "studio"
      : trimmedQ.startsWith("?")
      ? "shortcuts"
      : mode;

  // Fetch search results when in 'all' or 'titles' mode and query exists
  useEffect(() => {
    if (!open || !debouncedTrimmedQ || (activeMode !== "all" && activeMode !== "titles")) {
      setSearchLoading(false);
      return;
    }
    let alive = true;
    const controller = new AbortController();
    setSearchLoading(true);

    const queryToSearch = debouncedTrimmedQ.replace(/^[>@/#?]/, "").trim();
    if (!queryToSearch) {
      setSearchLoading(false);
      setResults([]);
      return;
    }

    fetchSearchResponse(`sort=relevance&q=${encodeURIComponent(queryToSearch)}`, controller.signal)
      .then((data) => {
        if (alive) setResults(data.items.slice(0, 8));
      })
      .catch((error: unknown) => {
        if (isSearchAbortError(error)) return;
        if (alive) setResults([]);
      })
      .finally(() => {
        if (alive) setSearchLoading(false);
      });

    return () => {
      alive = false;
      controller.abort();
    };
  }, [debouncedTrimmedQ, open, activeMode]);

  // Load recently viewed titles when palette is open and query is empty
  useEffect(() => {
    if (!open || effectiveQuery || !recentKey) {
      return;
    }
    let alive = true;
    const controller = new AbortController();
    fetch(`/api/titles?ids=${encodeURIComponent(recentKey)}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : { items: [] }))
      .then((data: { items?: Title[] }) => {
        if (!alive) return;
        const byId = new Map((data.items ?? []).map((item) => [item.id, item]));
        setRecentTitles(
          recentKey
            .split(",")
            .map((id) => byId.get(id))
            .filter((item): item is Title => Boolean(item))
        );
      })
      .catch(() => {
        if (alive) setRecentTitles([]);
      });

    return () => {
      alive = false;
      controller.abort();
    };
  }, [open, recentKey, effectiveQuery]);

  // Command Context builder
  const createContext = (): CommandContext => ({
    router,
    closePalette: () => {
      playSfx("close");
      onOpenChange(false);
    },
    showToast: (msg, opts) => toast(msg, opts),
    playSfx: (name) => playSfx(name),
    currentPath: typeof window !== "undefined" ? window.location.pathname : "/",
  });

  const go = (href: string, searchRecordQuery?: string) => {
    if (searchRecordQuery?.trim()) {
      addRecentSearch(searchRecordQuery.trim());
    }
    playSfx("close");
    onOpenChange(false);
    router.push(href);
  };

  const executeCommand = (cmdId: string) => {
    const command = PALETTE_COMMANDS.find((c) => c.id === cmdId);
    if (!command) return;
    command.action(createContext());
  };

  const executeStudioTool = (toolId: string) => {
    const tool = PALETTE_STUDIO_TOOLS.find((t) => t.id === toolId);
    if (!tool) return;

    // 단축키가 없는 도구(작업실 표면)는 자기 라우트로 간다. 키 이벤트를 흉내 내면
    // 아무 일도 일어나지 않으면서 "선택됨" 토스트만 뜬다.
    if (tool.actionPath) {
      go(tool.actionPath);
      return;
    }

    const currentPath = typeof window !== "undefined" ? window.location.pathname : "";
    if (currentPath.startsWith("/studio")) {
      // Dispatch key event to Studio canvas
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: tool.shortcutKey.toLowerCase(),
          bubbles: true,
        })
      );
      toast(`스튜디오 도구 '${tool.name}' 선택됨 (${tool.shortcutKey})`, { tone: "info" });
      playSfx("tick");
      onOpenChange(false);
    } else {
      go(`/studio?tool=${tool.shortcutKey.toLowerCase()}`);
    }
  };

  // Switch tabs
  const handleSelectTab = (tabId: PaletteMode) => {
    playSfx("pop");
    setMode(tabId);
    inputRef.current?.focus();
  };

  // Keyboard navigation for Tab key cycling modes
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const tabKeys = PALETTE_MODE_TABS.map((t) => t.id);
      const currentIndex = tabKeys.indexOf(mode);
      const nextIndex = e.shiftKey
        ? (currentIndex - 1 + tabKeys.length) % tabKeys.length
        : (currentIndex + 1) % tabKeys.length;
      handleSelectTab(tabKeys[nextIndex]!);
    } else if (e.key === "Backspace" && !q && mode !== "all") {
      setMode("all");
    }
  };

  // Filter commands, studio tools, and pages based on effective query and active mode
  const filteredCommands = PALETTE_COMMANDS.filter((cmd) => {
    if (activeMode !== "all" && activeMode !== "commands") return false;
    return matchesCommandSearch(cmd.title, effectiveQuery, cmd.keywords, cmd.subtitle);
  });

  const filteredStudioTools = PALETTE_STUDIO_TOOLS.filter((tool) => {
    if (activeMode !== "all" && activeMode !== "studio") return false;
    return matchesCommandSearch(tool.name, effectiveQuery, tool.keywords, tool.tip);
  });

  const filteredPages = PALETTE_PAGES.filter((page) => {
    if (activeMode !== "all" && activeMode !== "pages") return false;
    return matchesCommandSearch(page.title, effectiveQuery, page.keywords, page.subtitle);
  });

  // Determine currently selected item for the Live Inspector preview
  let selectedItem: PaletteSelectedItem = null;
  if (activeValue.startsWith("title-")) {
    const titleId = activeValue.replace("title-", "");
    const found = results.find((r) => r.id === titleId) || recentTitles.find((r) => r.id === titleId);
    if (found) selectedItem = { type: "title", title: found };
  } else if (activeValue.startsWith("cmd-")) {
    const found = PALETTE_COMMANDS.find((c) => c.id === activeValue);
    if (found) selectedItem = { type: "command", command: found };
  } else if (activeValue.startsWith("tool-")) {
    const found = PALETTE_STUDIO_TOOLS.find((t) => t.id === activeValue);
    if (found) selectedItem = { type: "studio-tool", tool: found };
  } else if (activeValue.startsWith("page-")) {
    const found = PALETTE_PAGES.find((p) => p.id === activeValue);
    if (found) selectedItem = { type: "page", page: found };
  } else if (activeValue.startsWith("recent-query-")) {
    const query = activeValue.replace("recent-query-", "");
    selectedItem = { type: "recent-query", query };
  }

  // Fallback selected item when nothing is active yet
  if (!selectedItem) {
    if (results.length > 0) {
      selectedItem = { type: "title", title: results[0]! };
    } else if (!effectiveQuery && recentTitles.length > 0) {
      selectedItem = { type: "title", title: recentTitles[0]! };
    } else if (filteredCommands.length > 0) {
      selectedItem = { type: "command", command: filteredCommands[0]! };
    } else if (filteredPages.length > 0) {
      selectedItem = { type: "page", page: filteredPages[0]! };
    }
  }

  const handleExecuteSelected = () => {
    if (!selectedItem) return;
    if (selectedItem.type === "title") {
      go(`/title/${selectedItem.title.slug}`, q);
    } else if (selectedItem.type === "command") {
      selectedItem.command.action(createContext());
    } else if (selectedItem.type === "studio-tool") {
      executeStudioTool(selectedItem.tool.id);
    } else if (selectedItem.type === "page") {
      go(selectedItem.page.href);
    } else if (selectedItem.type === "recent-query") {
      setQ(selectedItem.query);
      setMode("titles");
    }
  };

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("command.palette.label")}
      className="fixed inset-0 z-[100] flex items-start justify-center px-4 pt-[8vh] sm:pt-[10vh]"
    >
      {/* Backdrop */}
      <button
        type="button"
        aria-label={t("common.close")}
        onClick={() => {
          playSfx("close");
          onOpenChange(false);
        }}
        className="absolute inset-0 bg-[oklch(0.12_0.012_70/0.75)] backdrop-blur-md transition-opacity"
        style={{ animation: "fade-up 0.18s ease-out" }}
      />

      {/* Palette Container */}
      <Command
        shouldFilter={false}
        loop
        value={activeValue}
        onValueChange={setActiveValue}
        label={t("command.palette.label")}
        onKeyDown={handleKeyDown}
        className="pf-popup-open relative flex w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-line-strong bg-panel shadow-2xl shadow-[oklch(0.1_0.02_70/0.65)] ring-1 ring-[oklch(0.95_0.01_85/0.08)]"
        style={{ animation: "fade-up 0.22s var(--ease-out-expo)" }}
      >
        {/* Search Header */}
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search size={18} className="text-accent shrink-0" />

          {/* Mode prefix pill if active */}
          {activePrefix && (
            <span className="flex items-center gap-1 rounded border border-accent/40 bg-accent-soft px-1.5 py-0.5 font-mono text-xs font-semibold text-accent">
              {activePrefix}
              <span className="text-[10px] font-normal">
                {activeMode === "commands"
                  ? "명령"
                  : activeMode === "titles"
                  ? "작품"
                  : activeMode === "studio"
                  ? "도구"
                  : "태그"}
              </span>
            </span>
          )}

          <Command.Input
            ref={inputRef}
            value={q}
            onValueChange={(value) => {
              setQ(value);
              setResults([]);
              if (!value.trim()) setSearchLoading(false);
            }}
            placeholder="작품 제목, 작가, 기능 명령, 스튜디오 도구 검색... (Tab으로 탭 전환)"
            className="h-14 flex-1 bg-transparent text-[0.95rem] text-fg outline-none placeholder:text-fg-3"
          />

          {q && (
            <button
              type="button"
              onClick={() => {
                setQ("");
                setResults([]);
                inputRef.current?.focus();
              }}
              className="flex size-7 items-center justify-center rounded-lg text-fg-3 transition-colors hover:bg-raised hover:text-fg"
              title="검색어 지우기"
            >
              <X size={15} />
            </button>
          )}

          <kbd className="hidden rounded-md border border-line bg-card px-2 py-0.5 font-mono text-[0.65rem] font-medium text-fg-3 sm:block">
            ESC
          </kbd>
        </div>

        {/* Category Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto border-b border-line/70 bg-card/40 px-4 py-2 text-xs scrollbar-none">
          {PALETTE_MODE_TABS.map((tab) => {
            const isActive = activeMode === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => handleSelectTab(tab.id)}
                className={cn(
                  "flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1 font-medium transition-all",
                  isActive
                    ? "bg-raised text-accent shadow-sm ring-1 ring-accent/30 font-semibold"
                    : "text-fg-3 hover:bg-card hover:text-fg"
                )}
              >
                <span>{tab.label}</span>
                {tab.prefix && (
                  <span className="font-mono text-[10px] opacity-60">
                    {tab.prefix}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Two-Pane Body */}
        <div className="flex h-[56vh] max-h-[520px] min-h-[380px] divide-x divide-line">
          {/* Left: Command List */}
          <Command.List className="flex-1 overflow-y-auto overscroll-contain p-2 scrollbar-thin">
            {/* Loading Indicator */}
            {effectiveQuery && isSearching && (
              <div
                className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-sm text-fg-3"
                role="status"
                aria-live="polite"
              >
                <div className="size-5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                <span>{t("common.loading.search")}</span>
              </div>
            )}

            {/* Empty Search Result */}
            {effectiveQuery &&
              !isSearching &&
              results.length === 0 &&
              filteredCommands.length === 0 &&
              filteredStudioTools.length === 0 &&
              filteredPages.length === 0 && (
                <div className="px-4 py-12 text-center text-sm text-fg-3">
                  <p>
                    {t("common.notFoundWithQuery").replace(
                      "{query}",
                      `'${effectiveQuery}'`
                    )}
                  </p>
                  <p className="mt-1 text-xs text-fg-3">
                    다른 키워드나 접두사(<code>&gt;</code> 명령어, <code>/</code> 도구)를 시도해보세요.
                  </p>
                  <button
                    type="button"
                    onClick={() => go(`/search?q=${encodeURIComponent(effectiveQuery)}`)}
                    className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-accent/40 bg-accent-soft px-3 py-1.5 text-xs font-semibold text-accent hover:bg-accent hover:text-on-accent"
                  >
                    <span>통합 검색 결과 열기</span>
                    <ExternalLink size={12} />
                  </button>
                </div>
              )}

            {/* Empty Query: Trending Tags */}
            {!effectiveQuery && mode === "all" && (
              <div className="px-3 py-2">
                <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-fg-3">
                  <Tag size={12} className="text-accent" />
                  <span>인기 탐색 태그</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {TRENDING_TAGS.map((item) => (
                    <button
                      key={item.tag}
                      type="button"
                      onClick={() => {
                        playSfx("tick");
                        setQ(item.tag);
                        setMode("titles");
                      }}
                      className="rounded-md border border-line bg-card px-2 py-0.5 text-xs text-fg-2 transition-all hover:border-accent hover:text-accent"
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Empty Query: Recent Searches */}
            {!effectiveQuery && recentSearches.length > 0 && (activeMode === "all" || activeMode === "titles") && (
              <Command.Group
                forceMount
                heading={
                  <div className="flex items-center justify-between px-2 py-1">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-fg-3">
                      최근 검색어
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        clearRecentSearches();
                        playSfx("tick");
                      }}
                      className="text-[10px] text-fg-3 hover:text-red-400"
                    >
                      전체 삭제
                    </button>
                  </div>
                }
              >
                {recentSearches.slice(0, 5).map((searchQuery) => (
                  <Command.Item
                    forceMount
                    key={`search-${searchQuery}`}
                    value={`recent-query-${searchQuery}`}
                    onSelect={() => {
                      setQ(searchQuery);
                      setMode("titles");
                      playSfx("tick");
                    }}
                    className="group flex cursor-pointer items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 text-xs transition-colors data-[selected=true]:bg-raised"
                  >
                    <div className="flex items-center gap-2">
                      <Clock size={13} className="text-fg-3" />
                      <span className="text-fg">{searchQuery}</span>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeRecentSearch(searchQuery);
                        playSfx("tick");
                      }}
                      className="opacity-0 transition-opacity group-hover:opacity-100 hover:text-red-400"
                      title="검색어 삭제"
                    >
                      <X size={13} />
                    </button>
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {/* Empty Query: Recent Viewed Titles */}
            {!effectiveQuery && recentTitles.length > 0 && (activeMode === "all" || activeMode === "titles") && (
              <Command.Group
                forceMount
                heading={
                  <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-fg-3">
                    최근 본 작품
                  </div>
                }
              >
                {recentTitles.map((item) => (
                  <Command.Item
                    forceMount
                    key={`recent-${item.id}`}
                    value={`title-${item.id}`}
                    onSelect={() => go(`/title/${item.slug}`, item.title)}
                    className="flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 transition-colors data-[selected=true]:bg-raised"
                  >
                    <MiniPoster title={item} className="w-8 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-fg">
                        {item.title}
                      </span>
                      <span className="flex items-center gap-1.5 text-xs text-fg-3">
                        <span style={{ color: genreTextColor(item.genres[0] ?? "", 0.8) }}>
                          {TYPE_LABEL[item.type]}
                        </span>
                        · {item.author}
                      </span>
                    </div>
                    <RatingInline
                      value={item.stats.ratingAvg}
                      estimated={statsAreEstimated(item)}
                      size="xs"
                    />
                    <CornerDownLeft
                      size={13}
                      className="text-fg-3 opacity-0 group-data-[selected=true]:opacity-100"
                    />
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {/* Commands Section */}
            {filteredCommands.length > 0 && (
              <Command.Group
                forceMount
                heading={
                  <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-fg-3">
                    시스템 및 명령어
                  </div>
                }
              >
                {filteredCommands.map((cmd) => {
                  const Icon = cmd.icon;
                  const state = cmd.getState?.();
                  return (
                    <Command.Item
                      forceMount
                      key={cmd.id}
                      value={cmd.id}
                      onSelect={() => executeCommand(cmd.id)}
                      className="flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-sm text-fg transition-colors data-[selected=true]:bg-raised"
                    >
                      <div className="flex size-7 items-center justify-center rounded-lg border border-line bg-card text-accent">
                        <Icon size={15} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-fg">{cmd.title}</span>
                          {state && (
                            <span className="rounded bg-panel px-1.5 py-0.5 text-[10px] text-fg-3">
                              {state.label}
                            </span>
                          )}
                        </div>
                        <p className="truncate text-xs text-fg-3">{cmd.subtitle}</p>
                      </div>
                      {cmd.shortcut && (
                        <div className="hidden items-center gap-1 sm:flex">
                          {cmd.shortcut.map((k) => (
                            <kbd
                              key={k}
                              className="rounded border border-line bg-card px-1.5 py-0.5 font-mono text-[10px] text-fg-3"
                            >
                              {k}
                            </kbd>
                          ))}
                        </div>
                      )}
                      <CornerDownLeft
                        size={13}
                        className="text-fg-3 opacity-0 data-[selected=true]:opacity-100"
                      />
                    </Command.Item>
                  );
                })}
              </Command.Group>
            )}

            {/* Studio Tools Section */}
            {filteredStudioTools.length > 0 && (
              <Command.Group
                forceMount
                heading={
                  <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-fg-3">
                    스튜디오 도구
                  </div>
                }
              >
                {filteredStudioTools.map((tool) => {
                  const Icon = tool.icon;
                  return (
                    <Command.Item
                      forceMount
                      key={tool.id}
                      value={tool.id}
                      onSelect={() => executeStudioTool(tool.id)}
                      className="flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-sm text-fg transition-colors data-[selected=true]:bg-raised"
                    >
                      <div className="flex size-7 items-center justify-center rounded-lg border border-line bg-card text-accent">
                        <Icon size={15} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <span className="font-medium text-fg">{tool.name}</span>
                        <p className="truncate text-xs text-fg-3">{tool.tip}</p>
                      </div>
                      {tool.shortcutKey ? (
                        <kbd className="rounded border border-line bg-card px-1.5 py-0.5 font-mono text-[10px] font-semibold text-accent">
                          {tool.shortcutKey}
                        </kbd>
                      ) : null}
                    </Command.Item>
                  );
                })}
              </Command.Group>
            )}

            {/* Search Results (Titles) */}
            {results.length > 0 && (
              <Command.Group
                forceMount
                heading={
                  <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-fg-3">
                    작품 검색 결과 ({results.length})
                  </div>
                }
              >
                {results.map((item) => (
                  <Command.Item
                    forceMount
                    key={`search-res-${item.id}`}
                    value={`title-${item.id}`}
                    onSelect={() => go(`/title/${item.slug}`, item.title)}
                    className="flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 transition-colors data-[selected=true]:bg-raised"
                  >
                    <MiniPoster title={item} className="w-8 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-fg">
                        {item.title}
                      </span>
                      <span className="flex items-center gap-1.5 text-xs text-fg-3">
                        <span style={{ color: genreTextColor(item.genres[0] ?? "", 0.8) }}>
                          {TYPE_LABEL[item.type]}
                        </span>
                        · {item.author}
                      </span>
                    </div>
                    <RatingInline
                      value={item.stats.ratingAvg}
                      estimated={statsAreEstimated(item)}
                      size="xs"
                    />
                    <CornerDownLeft
                      size={13}
                      className="text-fg-3 opacity-0 data-[selected=true]:opacity-100"
                    />
                  </Command.Item>
                ))}

                <Command.Item
                  forceMount
                  value="__all-search"
                  onSelect={() => go(`/search?q=${encodeURIComponent(effectiveQuery)}`, effectiveQuery)}
                  className="mt-1 flex cursor-pointer items-center justify-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-semibold text-accent transition-colors data-[selected=true]:bg-accent-soft"
                >
                  <span>'{effectiveQuery}' 전체 검색 페이지 열기</span>
                  <ExternalLink size={12} />
                </Command.Item>
              </Command.Group>
            )}

            {/* Pages Section */}
            {filteredPages.length > 0 && (
              <Command.Group
                forceMount
                heading={
                  <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-fg-3">
                    페이지 바로가기
                  </div>
                }
              >
                {filteredPages.map((page) => {
                  const Icon = page.icon;
                  return (
                    <Command.Item
                      forceMount
                      key={page.id}
                      value={page.id}
                      onSelect={() => go(page.href)}
                      className="flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-sm text-fg transition-colors data-[selected=true]:bg-raised"
                    >
                      <Icon size={16} className="text-fg-3 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <span className="font-medium text-fg">{page.title}</span>
                        <span className="ml-2 text-xs text-fg-3">{page.subtitle}</span>
                      </div>
                      {page.shortcut && (
                        <div className="hidden items-center gap-1 sm:flex">
                          {page.shortcut.map((k) => (
                            <kbd
                              key={k}
                              className="rounded border border-line bg-card px-1.5 py-0.5 font-mono text-[10px] text-fg-3"
                            >
                              {k}
                            </kbd>
                          ))}
                        </div>
                      )}
                    </Command.Item>
                  );
                })}
              </Command.Group>
            )}
          </Command.List>

          {/* Right: Live Inspector Preview (Hidden on small mobile screens) */}
          <div className="hidden w-[360px] shrink-0 bg-card/25 md:block">
            <CommandPalettePreview
              selectedItem={selectedItem}
              onExecute={handleExecuteSelected}
            />
          </div>
        </div>

        {/* Footer Navigation Bar */}
        <div className="flex items-center justify-between border-t border-line bg-panel/80 px-4 py-2 text-[11px] text-fg-3">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <kbd className="rounded border border-line bg-card px-1 py-0.5 font-mono text-[9px] text-fg-2">
                Tab
              </kbd>
              <span>카테고리 전환</span>
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded border border-line bg-card px-1 py-0.5 font-mono text-[9px] text-fg-2">
                &gt;
              </kbd>
              <kbd className="rounded border border-line bg-card px-1 py-0.5 font-mono text-[9px] text-fg-2">
                /
              </kbd>
              <span>접두사 필터</span>
            </span>
          </div>

          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <kbd className="rounded border border-line bg-card px-1 py-0.5 font-mono text-[9px] text-fg-2">
                ↑↓
              </kbd>
              <span>이동</span>
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded border border-line bg-card px-1 py-0.5 font-mono text-[9px] text-fg-2">
                ↵
              </kbd>
              <span>실행</span>
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded border border-line bg-card px-1 py-0.5 font-mono text-[9px] text-fg-2">
                Esc
              </kbd>
              <span>닫기</span>
            </span>
          </div>
        </div>
      </Command>
    </div>
  );
}
