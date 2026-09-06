import {
  Check,
  ChevronDown,
  ChevronUp,
  Command,
  LayoutGrid,
  List,
  Plus,
  RotateCcw,
  Search,
  Settings2,
  X,
} from "lucide-react";
import {
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";

import {
  STUDIO_EASE,
  STUDIO_FOCUS_RING,
  STUDIO_TOUCH_TARGET,
} from "./studio-panel-ui";
import {
  STUDIO_QUICK_ACCESS_DENSITIES,
  activateStudioQuickAccessSet,
  addStudioQuickAccessCommand,
  configureStudioQuickAccessView,
  normalizeStudioQuickAccessState,
  planStudioQuickAccessExecution,
  projectStudioQuickAccessSet,
  removeStudioQuickAccessCommand,
  reorderStudioQuickAccessCommand,
  restoreActiveStudioQuickAccessSetDefaults,
  searchStudioQuickAccessCommands,
  type StudioQuickAccessCommandMeta,
  type StudioQuickAccessDensity,
  type StudioQuickAccessProjectedCommand,
  type StudioQuickAccessState,
} from "./studio-quick-access";

import { cn } from "@/shared/lib/utils";

export interface StudioQuickAccessPaletteProps {
  readonly state: StudioQuickAccessState;
  readonly catalog: readonly StudioQuickAccessCommandMeta[];
  readonly onStateChange: (state: StudioQuickAccessState) => void;
  readonly onExecute: (commandId: string, setId: string) => void;
  readonly className?: string;
}

const MAX_VISIBLE_CANDIDATES = 48;

const DENSITY_LABELS: Readonly<Record<StudioQuickAccessDensity, string>> = {
  compact: "좁게",
  comfortable: "보통",
  large: "넓게",
};

const commandSurfaceClass =
  "rounded-lg border border-line bg-card text-left text-fg-2 hover:border-line-strong hover:bg-raised hover:text-fg disabled:cursor-not-allowed disabled:border-line/70 disabled:bg-card/55 disabled:text-fg-3";

function densityCommandClass(density: StudioQuickAccessDensity): string {
  if (density === "compact") {
    return "min-h-9 gap-1.5 px-2 py-1.5 text-[0.6875rem]";
  }
  if (density === "large") {
    return "min-h-14 gap-2.5 px-3 py-2.5 text-sm";
  }
  return "min-h-11 gap-2 px-2.5 py-2 text-xs";
}

function commandAriaLabel(command: StudioQuickAccessProjectedCommand): string {
  const suffix = command.available ? "실행" : "사용 불가";
  return `${command.label} ${suffix}`;
}

function nextRovingIndex(
  key: string,
  currentIndex: number,
  length: number,
): number | null {
  if (length <= 0) return null;
  if (key === "Home") return 0;
  if (key === "End") return length - 1;
  if (key === "ArrowRight" || key === "ArrowDown") {
    return (currentIndex + 1 + length) % length;
  }
  if (key === "ArrowLeft" || key === "ArrowUp") {
    return (currentIndex - 1 + length) % length;
  }
  return null;
}

function countQuickAccessGridTracks(template: string): number | null {
  const normalized = template.trim();
  if (!normalized || normalized === "none") return null;
  const tracks: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index <= normalized.length; index += 1) {
    const character = normalized[index];
    if (character === "(" || character === "[") depth += 1;
    if (character === ")" || character === "]") depth = Math.max(0, depth - 1);
    if (
      index === normalized.length
      || (depth === 0 && character !== undefined && /\s/u.test(character))
    ) {
      const track = normalized.slice(start, index).trim();
      if (track) tracks.push(track);
      start = index + 1;
    }
  }
  let count = 0;
  for (const track of tracks) {
    const repeat = /^repeat\(\s*(\d+)\s*,([\s\S]+)\)$/u.exec(track);
    if (!repeat) {
      count += 1;
      continue;
    }
    const repetitions = Number.parseInt(repeat[1] ?? "", 10);
    count += repetitions * (countQuickAccessGridTracks(repeat[2] ?? "") ?? 1);
  }
  return count > 0 ? count : null;
}

function quickAccessGridColumnCount(
  grid: HTMLElement | null,
  displayAsTiles: boolean,
): number {
  if (!displayAsTiles) return 1;
  if (grid && typeof globalThis.getComputedStyle === "function") {
    try {
      const count = countQuickAccessGridTracks(
        globalThis.getComputedStyle(grid).gridTemplateColumns,
      );
      if (count) return count;
    } catch {
      // Detached test nodes and older webviews can reject computed-style reads.
    }
  }
  return 2;
}

/**
 * CLIP STUDIO-familiar Quick Access palette.
 *
 * Durable state and command authority remain controlled by the owner. This leaf owns only
 * transient customization/search/focus state and delegates every mutation and execution decision
 * to the pure `studio-quick-access` model.
 */
export function StudioQuickAccessPalette({
  state,
  catalog,
  onStateChange,
  onExecute,
  className,
}: StudioQuickAccessPaletteProps) {
  const current = normalizeStudioQuickAccessState(state);
  const projection = projectStudioQuickAccessSet(current, catalog);
  const activeSet = current.sets.find(({ id }) => id === current.activeSetId)
    ?? current.sets[0]!;
  const [customizing, setCustomizing] = useState(false);
  const [query, setQuery] = useState("");
  const [rovingCommandId, setRovingCommandId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const optionsButtonRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const commandListRef = useRef<HTMLUListElement>(null);
  const commandButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const setTabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const commands = projection?.commands ?? [];
  const focusableCommandIds = commands
    .filter(({ available }) => available)
    .map(({ id }) => id);
  const effectiveRovingCommandId =
    rovingCommandId && focusableCommandIds.includes(rovingCommandId)
      ? rovingCommandId
      : focusableCommandIds[0] ?? null;
  const activeCommandIds = new Set(activeSet.commandIds);
  const candidates = searchStudioQuickAccessCommands(catalog, query)
    .filter(({ id }) => !activeCommandIds.has(id))
    .slice(0, MAX_VISIBLE_CANDIDATES);

  function commitState(
    next: StudioQuickAccessState,
    message?: string,
  ): void {
    if (next === current) return;
    onStateChange(next);
    if (message) setAnnouncement(message);
  }

  function activateSet(setId: string): void {
    const set = current.sets.find(({ id }) => id === setId);
    if (!set) return;
    commitState(
      activateStudioQuickAccessSet(current, setId),
      `${set.name} 세트를 열었습니다.`,
    );
  }

  function changeSet(event: ChangeEvent<HTMLSelectElement>): void {
    activateSet(event.currentTarget.value);
  }

  function moveSetFocus(key: string): void {
    const currentIndex = current.sets.findIndex(
      ({ id }) => id === current.activeSetId,
    );
    const nextIndex = nextRovingIndex(key, currentIndex, current.sets.length);
    if (nextIndex === null) return;
    const nextSet = current.sets[nextIndex];
    if (!nextSet) return;
    activateSet(nextSet.id);
    setTabRefs.current[nextSet.id]?.focus({ preventScroll: true });
  }

  function executeCommand(commandId: string): void {
    const plan = planStudioQuickAccessExecution(
      current,
      catalog,
      commandId,
      activeSet.id,
    );
    if (!plan.ok) {
      setAnnouncement("현재 사용할 수 없는 명령입니다.");
      return;
    }
    onExecute(plan.commandId, plan.setId);
  }

  function spatialCommandId(key: string, commandId: string): string | null {
    const currentIndex = commands.findIndex(({ id }) => id === commandId);
    if (currentIndex < 0) return null;
    if (key === "Home") return focusableCommandIds[0] ?? null;
    if (key === "End") return focusableCommandIds.at(-1) ?? null;
    if (displayAsTiles && (key === "ArrowUp" || key === "ArrowDown")) {
      const columns = quickAccessGridColumnCount(commandListRef.current, true);
      const step = key === "ArrowDown" ? columns : -columns;
      for (
        let index = currentIndex + step;
        index >= 0 && index < commands.length;
        index += step
      ) {
        const candidate = commands[index];
        if (candidate?.available) return candidate.id;
      }
      return null;
    }
    const focusableIndex = focusableCommandIds.indexOf(commandId);
    const nextIndex = nextRovingIndex(
      key,
      Math.max(0, focusableIndex),
      focusableCommandIds.length,
    );
    return nextIndex === null ? null : focusableCommandIds[nextIndex] ?? null;
  }

  function moveCommandFocus(key: string, commandId: string): void {
    const nextId = spatialCommandId(key, commandId);
    if (!nextId) return;
    setRovingCommandId(nextId);
    commandButtonRefs.current[nextId]?.focus({ preventScroll: true });
  }

  function queueCommandFocus(commandId: string | null): void {
    if (commandId) setRovingCommandId(commandId);
    const restoreFocus = () => {
      const command = commandId ? commandButtonRefs.current[commandId] : null;
      if (command?.isConnected && !command.disabled) {
        command.focus({ preventScroll: true });
        command.scrollIntoView?.({ block: "nearest", inline: "nearest" });
        return;
      }
      if (searchInputRef.current?.isConnected) {
        searchInputRef.current.focus({ preventScroll: true });
        return;
      }
      optionsButtonRef.current?.focus({ preventScroll: true });
    };
    if (typeof globalThis.requestAnimationFrame === "function") {
      globalThis.requestAnimationFrame(restoreFocus);
    } else {
      globalThis.setTimeout(restoreFocus, 0);
    }
  }

  function reorderCommand(commandId: string, offset: -1 | 1): void {
    const currentIndex = activeSet.commandIds.indexOf(commandId);
    if (currentIndex < 0) return;
    commitState(
      reorderStudioQuickAccessCommand(
        current,
        activeSet.id,
        commandId,
        currentIndex + offset,
      ),
      offset < 0 ? "명령을 앞으로 옮겼습니다." : "명령을 뒤로 옮겼습니다.",
    );
  }

  function removeCommand(commandId: string, label: string): void {
    const commandIndex = commands.findIndex(({ id }) => id === commandId);
    const nextFocusable = commandIndex < 0
      ? null
      : commands.slice(commandIndex + 1).find(({ available }) => available)
        ?? [...commands.slice(0, commandIndex)].reverse().find(({ available }) => available)
        ?? null;
    commitState(
      removeStudioQuickAccessCommand(current, activeSet.id, commandId),
      `${label} 명령을 세트에서 뺐습니다.`,
    );
    queueCommandFocus(nextFocusable?.id ?? null);
  }

  function addCommand(command: StudioQuickAccessCommandMeta): void {
    commitState(
      addStudioQuickAccessCommand(
        current,
        activeSet.id,
        command.id,
      ),
      `${command.label} 명령을 추가했습니다.`,
    );
    queueCommandFocus(command.id);
  }

  function handleCommandKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    command: StudioQuickAccessProjectedCommand,
  ): void {
    if (
      customizing
      && event.altKey
      && (event.key === "ArrowUp" || event.key === "ArrowLeft")
    ) {
      event.preventDefault();
      reorderCommand(command.id, -1);
      return;
    }
    if (
      customizing
      && event.altKey
      && (event.key === "ArrowDown" || event.key === "ArrowRight")
    ) {
      event.preventDefault();
      reorderCommand(command.id, 1);
      return;
    }
    if (
      customizing
      && (event.key === "Delete" || event.key === "Backspace")
    ) {
      event.preventDefault();
      removeCommand(command.id, command.label);
      return;
    }
    if (
      event.key !== "ArrowLeft"
      && event.key !== "ArrowRight"
      && event.key !== "ArrowUp"
      && event.key !== "ArrowDown"
      && event.key !== "Home"
      && event.key !== "End"
    ) return;
    event.preventDefault();
    moveCommandFocus(event.key, command.id);
  }

  function leaveCustomization(): void {
    if (!customizing) return;
    setCustomizing(false);
    setQuery("");
    setAnnouncement("빠른 액세스 편집을 마쳤습니다.");
    optionsButtonRef.current?.focus({ preventScroll: true });
  }

  const displayAsTiles = current.displayMode === "tiles";

  return (
    <section
      aria-label="빠른 액세스"
      data-studio-quick-access-palette="true"
      data-display-mode={current.displayMode}
      data-density={current.density}
      data-customizing={customizing ? "true" : "false"}
      className={cn(
        "flex w-full min-w-0 max-w-full flex-col overflow-hidden rounded-xl border border-line bg-panel text-fg",
        className,
      )}
      onKeyDownCapture={(event) => {
        if (event.key !== "Escape" || !customizing) return;
        event.preventDefault();
        event.stopPropagation();
        leaveCustomization();
      }}
    >
      <header
        data-testid="studio-quick-access-header"
        className="flex min-w-0 items-center justify-between gap-2 border-b border-line px-2.5 py-2"
      >
        <div className="min-w-0">
          <h2 className="truncate text-xs font-bold text-fg">
            빠른 액세스
          </h2>
          <p className="truncate text-[0.6875rem] text-fg-3">
            {activeSet.name} · {activeSet.commandIds.length}개
          </p>
        </div>
        <button
          ref={optionsButtonRef}
          type="button"
          aria-pressed={customizing}
          aria-label={customizing ? "빠른 액세스 편집 완료" : "빠른 액세스 편집"}
          title={customizing ? "편집 완료" : "명령 편집"}
          className={cn(
            "inline-flex size-9 shrink-0 items-center justify-center rounded-lg border",
            "max-lg:size-11 pointer-coarse:size-11",
            STUDIO_TOUCH_TARGET,
            STUDIO_EASE,
            STUDIO_FOCUS_RING,
            customizing
              ? "border-accent/60 bg-accent-soft text-accent"
              : "border-transparent text-fg-2 hover:border-line hover:bg-raised hover:text-fg",
          )}
          onClick={() => {
            if (customizing) {
              leaveCustomization();
              return;
            }
            setCustomizing(true);
            setQuery("");
            setAnnouncement("빠른 액세스 편집을 시작했습니다.");
          }}
        >
          {customizing
            ? <Check size={16} aria-hidden />
            : <Settings2 size={16} aria-hidden />}
        </button>
      </header>

      <div className="min-w-0 border-b border-line p-2">
        <div
          role="tablist"
          aria-label="빠른 액세스 세트"
          className="hidden min-w-0 gap-1 overflow-x-auto min-[420px]:flex"
        >
          {current.sets.map((set) => {
            const active = set.id === current.activeSetId;
            return (
              <button
                key={set.id}
                ref={(node) => {
                  setTabRefs.current[set.id] = node;
                }}
                type="button"
                role="tab"
                aria-selected={active}
                tabIndex={active ? 0 : -1}
                className={cn(
                  "h-8 min-w-0 shrink-0 rounded-md border px-2.5 text-[0.6875rem] font-semibold",
                  "max-lg:min-h-11 pointer-coarse:min-h-11",
                  STUDIO_EASE,
                  STUDIO_FOCUS_RING,
                  active
                    ? "border-accent/55 bg-accent-soft text-fg"
                    : "border-transparent text-fg-2 hover:border-line hover:bg-raised hover:text-fg",
                )}
                onClick={() => activateSet(set.id)}
                onKeyDown={(event) => {
                  if (
                    ![
                      "ArrowLeft",
                      "ArrowRight",
                      "ArrowUp",
                      "ArrowDown",
                      "Home",
                      "End",
                    ].includes(event.key)
                  ) {
                    return;
                  }
                  event.preventDefault();
                  moveSetFocus(event.key);
                }}
              >
                <span className="block max-w-32 truncate">{set.name}</span>
              </button>
            );
          })}
        </div>
        <label className="block min-w-0 min-[420px]:hidden">
          <span className="sr-only">활성 빠른 액세스 세트</span>
          <select
            aria-label="활성 빠른 액세스 세트"
            value={current.activeSetId}
            onChange={changeSet}
            className={cn(
              "min-h-11 w-full min-w-0 rounded-lg border border-line bg-card px-2.5 text-xs text-fg",
              STUDIO_FOCUS_RING,
            )}
          >
            {current.sets.map((set) => (
              <option key={set.id} value={set.id}>
                {set.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex min-w-0 items-center justify-between gap-2 border-b border-line px-2 py-1.5">
        <div
          role="group"
          aria-label="빠른 액세스 표시 방식"
          className="inline-flex shrink-0 rounded-lg border border-line bg-card p-0.5"
        >
          <button
            type="button"
            aria-pressed={displayAsTiles}
            aria-label="타일 보기"
            className={cn(
              "inline-flex size-8 items-center justify-center rounded-md",
              STUDIO_EASE,
              STUDIO_FOCUS_RING,
              "max-lg:size-11 pointer-coarse:size-11",
              displayAsTiles
                ? "bg-accent-soft text-accent"
                : "text-fg-3 hover:bg-raised hover:text-fg",
            )}
            onClick={() =>
              commitState(
                configureStudioQuickAccessView(current, {
                  displayMode: "tiles",
                }),
              )}
          >
            <LayoutGrid size={14} aria-hidden />
          </button>
          <button
            type="button"
            aria-pressed={!displayAsTiles}
            aria-label="목록 보기"
            className={cn(
              "inline-flex size-8 items-center justify-center rounded-md",
              STUDIO_EASE,
              STUDIO_FOCUS_RING,
              "max-lg:size-11 pointer-coarse:size-11",
              !displayAsTiles
                ? "bg-accent-soft text-accent"
                : "text-fg-3 hover:bg-raised hover:text-fg",
            )}
            onClick={() =>
              commitState(
                configureStudioQuickAccessView(current, {
                  displayMode: "list",
                }),
              )}
          >
            <List size={14} aria-hidden />
          </button>
        </div>
        <label className="flex min-w-0 items-center gap-1.5 text-[0.6875rem] text-fg-3">
          <span className="shrink-0">간격</span>
          <select
            aria-label="빠른 액세스 명령 간격"
            value={current.density}
            onChange={(event) =>
              commitState(
                configureStudioQuickAccessView(current, {
                  density: event.currentTarget.value as StudioQuickAccessDensity,
                }),
              )}
            className={cn(
              "h-8 min-w-0 max-w-24 rounded-md border border-line bg-card px-1.5 text-[0.6875rem] text-fg",
              STUDIO_FOCUS_RING,
              "max-lg:min-h-11 pointer-coarse:min-h-11",
            )}
          >
            {STUDIO_QUICK_ACCESS_DENSITIES.map((density) => (
              <option key={density} value={density}>
                {DENSITY_LABELS[density]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {customizing ? (
        <div className="min-w-0 border-b border-line bg-card/55 p-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <label className="relative min-w-0 flex-1">
              <Search
                size={14}
                aria-hidden
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-3"
              />
              <input
                ref={searchInputRef}
                type="search"
                role="searchbox"
                aria-label="추가할 빠른 액세스 명령 검색"
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
                placeholder="명령 이름·단축키 검색"
                className={cn(
                  "min-h-11 w-full min-w-0 rounded-lg border border-line bg-panel py-2 pl-8 pr-2 text-xs text-fg placeholder:text-fg-2",
                  STUDIO_FOCUS_RING,
                )}
              />
            </label>
            <button
              type="button"
              aria-label={`${activeSet.name} 기본 명령 복원`}
              title="현재 세트 기본 복원"
              className={cn(
                "inline-flex size-11 shrink-0 items-center justify-center rounded-lg border border-line bg-panel text-fg-2 hover:bg-raised hover:text-fg",
                STUDIO_EASE,
                STUDIO_FOCUS_RING,
              )}
              onClick={() =>
                commitState(
                  restoreActiveStudioQuickAccessSetDefaults(current),
                  `${activeSet.name} 세트를 기본 명령으로 복원했습니다.`,
                )}
            >
              <RotateCcw size={15} aria-hidden />
            </button>
          </div>
          <p className="mt-1.5 text-[0.6875rem] leading-4 text-fg-3">
            Alt+방향키로 순서를 바꾸고 Delete로 뺄 수 있어요.
          </p>
        </div>
      ) : null}

      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-2">
        {commands.length > 0 ? (
          <ul
            ref={commandListRef}
            aria-label={`${activeSet.name} 명령`}
            className={cn(
              "min-w-0",
              displayAsTiles
                ? "grid grid-cols-2 gap-1.5 min-[520px]:grid-cols-3"
                : "flex flex-col gap-1",
            )}
          >
            {commands.map((command, index) => {
              const activeRoving =
                command.available
                && command.id === effectiveRovingCommandId;
              return (
                <li
                  key={command.id}
                  data-command-id={command.id}
                  data-command-available={command.available ? "true" : "false"}
                  className={cn(
                    "min-w-0",
                    customizing && "rounded-lg border border-line bg-card p-1",
                  )}
                >
                  <button
                    ref={(node) => {
                      commandButtonRefs.current[command.id] = node;
                    }}
                    type="button"
                    disabled={!command.available}
                    tabIndex={activeRoving ? 0 : -1}
                    aria-label={commandAriaLabel(command)}
                    aria-keyshortcuts={
                      customizing
                        ? "Alt+ArrowUp Alt+ArrowDown Delete"
                        : undefined
                    }
                    title={command.description ?? command.label}
                    className={cn(
                      "flex w-full min-w-0 items-center",
                      commandSurfaceClass,
                      densityCommandClass(current.density),
                      STUDIO_EASE,
                      STUDIO_FOCUS_RING,
                      "max-lg:min-h-11 pointer-coarse:min-h-11",
                      displayAsTiles
                        ? "flex-col justify-center text-center"
                        : "flex-row",
                      customizing && "border-transparent bg-transparent",
                    )}
                    onFocus={() => setRovingCommandId(command.id)}
                    onKeyDown={(event) =>
                      handleCommandKeyDown(event, command)}
                    onClick={() => executeCommand(command.id)}
                  >
                    <span
                      className={cn(
                        "inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-raised text-fg-2",
                        displayAsTiles && "size-7",
                      )}
                    >
                      <Command size={13} aria-hidden />
                    </span>
                    <span
                      className={cn(
                        "min-w-0 flex-1 truncate font-semibold",
                        displayAsTiles && "w-full",
                      )}
                    >
                      {command.label}
                    </span>
                    {command.available && command.shortcut ? (
                      <kbd className="max-w-20 shrink-0 truncate rounded bg-raised px-1 py-0.5 font-sans text-[0.625rem] font-normal text-fg-3">
                        {command.shortcut}
                      </kbd>
                    ) : null}
                    {!command.available ? (
                      <span className="shrink-0 text-[0.625rem] font-semibold text-warn">
                        사용 불가
                      </span>
                    ) : null}
                  </button>
                  {customizing ? (
                    <div
                      role="group"
                      aria-label={`${command.label} 배치 편집`}
                      className="mt-1 grid grid-cols-3 gap-1"
                    >
                      <button
                        type="button"
                        disabled={index === 0}
                        aria-label={`${command.label} 앞으로 이동`}
                        className={cn(
                          "inline-flex size-8 w-full items-center justify-center rounded-md text-fg-3 hover:bg-raised hover:text-fg disabled:opacity-35",
                          STUDIO_EASE,
                          STUDIO_FOCUS_RING,
                          "max-lg:min-h-11 pointer-coarse:min-h-11",
                        )}
                        onClick={() => reorderCommand(command.id, -1)}
                      >
                        <ChevronUp size={14} aria-hidden />
                      </button>
                      <button
                        type="button"
                        disabled={index === commands.length - 1}
                        aria-label={`${command.label} 뒤로 이동`}
                        className={cn(
                          "inline-flex size-8 w-full items-center justify-center rounded-md text-fg-3 hover:bg-raised hover:text-fg disabled:opacity-35",
                          STUDIO_EASE,
                          STUDIO_FOCUS_RING,
                          "max-lg:min-h-11 pointer-coarse:min-h-11",
                        )}
                        onClick={() => reorderCommand(command.id, 1)}
                      >
                        <ChevronDown size={14} aria-hidden />
                      </button>
                      <button
                        type="button"
                        aria-label={`${command.label} 세트에서 제거`}
                        className={cn(
                          "inline-flex size-8 w-full items-center justify-center rounded-md text-fg-3 hover:bg-bad/10 hover:text-bad",
                          STUDIO_EASE,
                          STUDIO_FOCUS_RING,
                          "max-lg:min-h-11 pointer-coarse:min-h-11",
                        )}
                        onClick={() => removeCommand(command.id, command.label)}
                      >
                        <X size={14} aria-hidden />
                      </button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <div
            role="status"
            className="flex min-h-28 flex-col items-center justify-center rounded-lg border border-dashed border-line px-4 text-center"
          >
            <Command size={20} aria-hidden className="text-fg-3" />
            <p className="mt-2 text-xs font-semibold text-fg">
              이 세트가 비어 있어요
            </p>
            <p className="mt-1 text-[0.6875rem] leading-4 text-fg-3">
              편집을 열고 자주 쓰는 명령을 추가해 보세요.
            </p>
          </div>
        )}

        {customizing ? (
          <div className="mt-3 min-w-0 border-t border-line pt-2">
            <div className="flex min-w-0 items-center justify-between gap-2">
              <h3 className="truncate text-[0.6875rem] font-bold text-fg-2">
                추가할 명령
              </h3>
              <span className="shrink-0 text-[0.625rem] tabular-nums text-fg-3">
                {candidates.length}개
              </span>
            </div>
            {candidates.length > 0 ? (
              <ul
                aria-label="추가 가능한 빠른 액세스 명령"
                className="mt-1.5 flex min-w-0 flex-col gap-1"
              >
                {candidates.map((candidate) => (
                  <li key={candidate.id} className="min-w-0">
                    <button
                      type="button"
                      disabled={candidate.available === false}
                      aria-label={`${candidate.label} 세트에 추가`}
                      className={cn(
                        "flex min-h-9 w-full min-w-0 items-center gap-2 rounded-lg border border-transparent px-2 text-left text-xs text-fg-2 hover:border-line hover:bg-raised hover:text-fg disabled:cursor-not-allowed disabled:opacity-50",
                        STUDIO_EASE,
                        STUDIO_FOCUS_RING,
                        "max-lg:min-h-11 pointer-coarse:min-h-11",
                      )}
                      onClick={() =>
                        addCommand(candidate)}
                    >
                      <Plus size={14} aria-hidden className="shrink-0" />
                      <span className="min-w-0 flex-1 truncate font-semibold">
                        {candidate.label}
                      </span>
                      {candidate.shortcut ? (
                        <kbd className="max-w-20 shrink-0 truncate rounded bg-card px-1 py-0.5 font-sans text-[0.625rem] text-fg-3">
                          {candidate.shortcut}
                        </kbd>
                      ) : null}
                      {candidate.available === false ? (
                        <span className="shrink-0 text-[0.625rem] text-warn">
                          사용 불가
                        </span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1.5 rounded-lg border border-dashed border-line px-3 py-3 text-center text-[0.6875rem] text-fg-3">
                {query.trim()
                  ? "일치하는 추가 명령이 없어요."
                  : "모든 등록 명령이 현재 세트에 있어요."}
              </p>
            )}
          </div>
        ) : null}
      </div>

      <span className="sr-only" role="status" aria-live="polite">
        {announcement}
      </span>
    </section>
  );
}
