/**
 * StudioMainMenu — ToonStudio's desktop application menubar.
 *
 * The workflow presentation supplies ten titles in one row:
 * 파일 · 편집 · 보기 · 삽입 · 레이어 · 그리기 · 만화 · 효과 · AI · 도움말.
 * File, Edit, View, Insert, Comic and Effects are workflow composites whose source
 * catalogue groups remain visible as named role="group" sections. AI remains a
 * first-class title because its assist, stock and integration commands are broader
 * than visual effects. Rows keep one flat menuitem order for predictable arrows.
 *
 * Menus portal to document.body with fixed coordinates, switch on neighbouring-title
 * hover/click like a desktop editor, and implement a WAI-ARIA menubar with one roving
 * tab stop. Help remains last; unknown future catalogue groups appear before it.
 */
import { Check, ChevronDown } from "lucide-react";
import {
  Fragment,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import {
  STUDIO_ICON_SIZE,
  STUDIO_ICON_STROKE,
  StudioKbdBadge,
  studioChromeIconClass,
} from "./studio-chrome-ui";
import { STUDIO_COLOR_VISION_HINTS } from "./studio-color-vision-coach";
import { STUDIO_MENU_GROUP_SPEC } from "./studio-main-menu-group-spec";
import { preloadStudioMainMenuGroupRuntime } from "./studio-main-menu-intent-preload";
import {
  readStudioMainMenuViewport,
  resolveStudioMainMenuCoords,
  revealStudioMainMenuItem,
  studioMainMenuCoordsEqual,
  type StudioMainMenuCoords,
} from "./studio-main-menu-viewport";
import { STUDIO_EASE, STUDIO_FOCUS_RING } from "./studio-panel-ui";
import { STUDIO_Z } from "./studio-z-index";
import { StudioToolHintTarget } from "./StudioToolHint";

import type {
  StudioMainMenuGroup,
  StudioMainMenuHintKey,
  StudioMainMenuItem,
  StudioMainMenuProps,
} from "./studio-main-menu-model";
import type { StudioToolHintSpec } from "./studio-tool-hints";

import { useT } from "@/shared/lib/i18n";
import { cn } from "@/shared/lib/utils";

export type {
  StudioMainMenuGroup,
  StudioMainMenuItem,
  StudioMainMenuProps,
} from "./studio-main-menu-model";

function localizeText(
  t: (key: string) => string,
  fallback: string,
  key: string,
): string {
  const translated = t(key);
  return translated === key ? fallback : translated;
}

type MenuCoords = StudioMainMenuCoords;
type MenuOpenFocusIntent = "first" | "last" | "preserve";
type MenuGroupNavigationDirection = "next" | "previous";
export type StudioMainMenuNavigationCommand = "first" | "last" | "next" | "previous";

type StudioMainMenuHintMeta = Omit<StudioToolHintSpec, "title" | "description" | "tip"> & {
  titleKey: string;
  descriptionKey: string;
  tipKey?: string;
  titleFallback?: string;
  descriptionFallback?: string;
  tipFallback?: string;
};

/**
 * §15.3 groups the regroup introduced have no shipped locale keys yet, so their
 * Korean copy comes from the pure spec table and the keys resolve when the packs
 * catch up.
 */
const SPEC_GROUP_HINTS: Readonly<Record<string, StudioMainMenuHintMeta>> =
  Object.fromEntries(
    STUDIO_MENU_GROUP_SPEC.filter((group) => group.hintKo).map((group) => [
      group.id,
      {
        id: `main-menu-${group.id}`,
        titleKey: `studio.mainMenu.group.${group.id}.label`,
        titleFallback: group.labelKo,
        descriptionKey: `studio.mainMenu.hint.${group.id}.description`,
        descriptionFallback: group.hintKo?.description ?? "",
        ...(group.hintKo?.tip
          ? {
            tipKey: `studio.mainMenu.hint.${group.id}.tip`,
            tipFallback: group.hintKo.tip,
          }
          : {}),
      },
    ]),
  );

const MAIN_MENU_HINTS: Readonly<Record<string, StudioMainMenuHintMeta>> = {
  ...SPEC_GROUP_HINTS,
  file: {
    id: "main-menu-file",
    titleKey: "studio.mainMenu.hint.file.title",
    descriptionKey: "studio.mainMenu.hint.file.description",
    tipKey: "studio.mainMenu.hint.file.tip",
    preview: "file-workflow",
  },
  edit: {
    id: "main-menu-edit",
    titleKey: "studio.mainMenu.hint.edit.title",
    descriptionKey: "studio.mainMenu.hint.edit.description",
    tipKey: "studio.mainMenu.hint.edit.tip",
    preview: "edit-workflow",
  },
  view: {
    id: "main-menu-view",
    titleKey: "studio.mainMenu.hint.view.title",
    descriptionKey: "studio.mainMenu.hint.view.description",
    tipKey: "studio.mainMenu.hint.view.tip",
    preview: "view-workflow",
  },
  filter: {
    id: "main-menu-filter",
    titleKey: "studio.mainMenu.hint.filter.title",
    descriptionKey: "studio.mainMenu.hint.filter.description",
    tipKey: "studio.mainMenu.hint.filter.tip",
    preview: "filter",
  },
  // §15.3 renamed the group to Brush; the shipped `draw` locale keys stay.
  brush: {
    id: "main-menu-draw",
    titleKey: "studio.mainMenu.hint.draw.title",
    descriptionKey: "studio.mainMenu.hint.draw.description",
    tipKey: "studio.mainMenu.hint.draw.tip",
    preview: "draw-workflow",
  },
  ai: {
    id: "main-menu-ai",
    titleKey: "studio.mainMenu.hint.ai.title",
    descriptionKey: "studio.mainMenu.hint.ai.description",
    tipKey: "studio.mainMenu.hint.ai.tip",
    preview: "ai-assist",
  },
  help: {
    id: "main-menu-help",
    titleKey: "studio.mainMenu.hint.help.title",
    descriptionKey: "studio.mainMenu.hint.help.description",
    tipKey: "studio.mainMenu.hint.help.tip",
    descriptionFallback: "기능 사용법과 단계별 튜토리얼을 찾거나 익숙한 기본 조작과 단축키를 확인합니다.",
    tipFallback: "‘채우기’, ‘색 섞기’, ‘확대’처럼 하고 싶은 결과로 검색해 보세요.",
    preview: "settings",
  },
};

const MAIN_MENU_ITEM_HINTS: Readonly<Record<StudioMainMenuHintKey, StudioToolHintSpec>> = {
  "color-vision:none": STUDIO_COLOR_VISION_HINTS.none,
  "color-vision:grayscale": STUDIO_COLOR_VISION_HINTS.grayscale,
  "color-vision:protanopia": STUDIO_COLOR_VISION_HINTS.protanopia,
  "color-vision:deuteranopia": STUDIO_COLOR_VISION_HINTS.deuteranopia,
  "color-vision:tritanopia": STUDIO_COLOR_VISION_HINTS.tritanopia,
};

function resolveMainMenuHint(
  group: StudioMainMenuGroup,
  t: (key: string) => string,
): StudioToolHintSpec {
  const hint = MAIN_MENU_HINTS[group.id];
  if (!hint) {
    return {
      id: `main-menu-${group.id}`,
      title: localizeText(t, group.label, `studio.mainMenu.group.${group.id}.label`),
      description: localizeText(
        t,
        "",
        `studio.mainMenu.item.${group.id}.fallbackDescription`,
      ),
    };
  }
  const isKoreanHelp = group.id === "help" && group.label === "도움말";
  const descriptionFallback = group.id === "help" && !isKoreanHelp
    ? "Find step-by-step feature guides, familiar editor controls, and keyboard shortcuts."
    : hint.descriptionFallback ?? "";
  const tipFallback = group.id === "help" && !isKoreanHelp
    ? "Search for the result you want, such as fill, blend color, or zoom."
    : hint.tipFallback ?? "";
  const localizedHint = {
    ...hint,
    title: group.id === "filter"
      ? group.label
      : localizeText(
          t,
          hint.titleFallback
            ?? localizeText(t, group.label, `studio.mainMenu.group.${group.id}.label`),
          hint.titleKey,
        ),
    description: localizeText(
      t,
      descriptionFallback,
      hint.descriptionKey,
    ),
    ...(hint.tipKey
      ? {
        tip: group.id === "file"
          ? localizeText(t, tipFallback, hint.tipKey).replaceAll("임시저장", "초안 저장")
          : localizeText(t, tipFallback, hint.tipKey),
      }
      : {}),
  };
  // `hint` is a valid discriminated StudioToolHintSpec with only its localized
  // copy fields replaced. TypeScript widens the preview/variant correlation
  // when spreading the union, so restore that correlation at this boundary.
  return localizedHint as StudioToolHintSpec;
}

/** Pure APG roving-index resolver; disabled commands remain discoverable by arrow navigation. */
// This colocated export is intentional: the parent task limits the APG change to this component
// and its test, while the pure resolver keeps disabled-item navigation independently verifiable.
// eslint-disable-next-line react-refresh/only-export-components
export function resolveStudioMainMenuItemIndex(
  items: readonly Pick<StudioMainMenuItem, "disabled">[],
  currentIndex: number,
  command: StudioMainMenuNavigationCommand,
): number {
  if (items.length === 0) return -1;
  if (command === "first") return 0;
  if (command === "last") return items.length - 1;
  const currentPosition = currentIndex >= 0 && currentIndex < items.length
    ? currentIndex
    : command === "previous"
      ? 0
      : -1;
  const offset = command === "next" ? 1 : -1;
  return (currentPosition + offset + items.length) % items.length;
}

type MenuSectionRow = { readonly item: StudioMainMenuItem; readonly index: number };
type MenuSection = { readonly label?: string; readonly rows: readonly MenuSectionRow[] };

/**
 * Splits a dropdown's rows into the captioned sections the presentation built.
 * A workflow composite title concatenates several catalogue groups and marks the
 * first row of each with `sectionLabel`, so every row up to the next caption belongs
 * to the section that caption names. Rows are carried with their panel-wide index so
 * the roving-tabindex refs and `data-studio-main-menu-item-index` stay flat.
 */
function splitStudioMainMenuSections(
  items: readonly StudioMainMenuItem[],
): readonly MenuSection[] {
  const sections: { label?: string; rows: MenuSectionRow[] }[] = [];
  items.forEach((item, index) => {
    const current = sections.at(-1);
    if (!current || item.sectionLabel) {
      sections.push({
        ...(item.sectionLabel ? { label: item.sectionLabel } : {}),
        rows: [{ item, index }],
      });
      return;
    }
    current.rows.push({ item, index });
  });
  return sections;
}

/** Fit the actual visible viewport, including pinch zoom and on-screen keyboards. */
function measureTrigger(btn: HTMLButtonElement | null): MenuCoords {
  return resolveStudioMainMenuCoords(
    btn?.getBoundingClientRect() ?? { left: 8, top: 10, bottom: 42, width: 0 },
    readStudioMainMenuViewport(btn?.ownerDocument.defaultView),
  );
}

function MenuDropdown({
  group,
  open,
  onOpen,
  onClose,
  onNavigateGroup,
  barActive,
  isTabStop,
  onFocusTrigger,
  t,
}: {
  group: StudioMainMenuGroup;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onNavigateGroup: (
    direction: MenuGroupNavigationDirection,
    openNextMenu: boolean,
  ) => void;
  barActive: boolean;
  /** True for the single group that carries the menubar's roving tab stop. */
  isTabStop: boolean;
  onFocusTrigger: () => void;
  t: (key: string) => string;
}): ReactElement {
  const unavailableReasonLabel = localizeText(t, "Unavailable condition", "studio.mainMenu.unavailableReason");
  const panelId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const openedRef = useRef(false);
  // Desktop hover switching opens this menu the moment the cursor crosses the title,
  // which lands *before* the click that carried the cursor there. Without this flag the
  // trigger's toggle sees `open === true` and closes the menu the artist just asked for,
  // so clicking neighbouring titles alternates open/closed instead of switching.
  const hoverOpenedRef = useRef(false);
  const openFocusIntentRef = useRef<MenuOpenFocusIntent>("first");
  const closeMenuRef = useRef<(restoreFocus?: boolean) => void>(() => undefined);
  // Keep last coords so the panel can paint on the same frame as open=true
  // (do not gate portal on a second useState tick).
  const [coords, setCoords] = useState<MenuCoords>(() => measureTrigger(null));
  const [activeItemIndex, setActiveItemIndex] = useState(() =>
    resolveStudioMainMenuItemIndex(group.items, -1, "first")
  );

  const updateCoords = () => {
    const next = measureTrigger(buttonRef.current);
    setCoords((current) => studioMainMenuCoordsEqual(current, next) ? current : next);
  };

  const closeMenu = (restoreFocus = true) => {
    onClose();
    // Escape and explicit menu actions return to the owning trigger. Pointer dismissal must leave
    // focus on the control the artist just clicked; pulling it back makes form fields require a
    // second click and breaks the expected desktop-app menu contract.
    if (restoreFocus) buttonRef.current?.focus({ preventScroll: true });
  };

  const openMenu = (focusIntent: MenuOpenFocusIntent) => {
    openFocusIntentRef.current = focusIntent;
    setCoords(measureTrigger(buttonRef.current));
    onOpen();
  };

  const focusMenuItem = (
    command: StudioMainMenuNavigationCommand,
    currentIndex = activeItemIndex,
  ) => {
    const nextIndex = resolveStudioMainMenuItemIndex(group.items, currentIndex, command);
    if (nextIndex < 0) return;
    setActiveItemIndex(nextIndex);
    itemRefs.current[nextIndex]?.focus({ preventScroll: true });
    revealStudioMainMenuItem(itemRefs.current[nextIndex] ?? null, menuRef.current);
  };

  useEffect(() => {
    closeMenuRef.current = closeMenu;
  });

  useLayoutEffect(() => {
    if (!open) {
      openedRef.current = false;
      hoverOpenedRef.current = false;
      return;
    }
    if (openedRef.current) return;
    openedRef.current = true;
    updateCoords();
    const initialIndex = resolveStudioMainMenuItemIndex(
      group.items, -1, openFocusIntentRef.current === "last" ? "last" : "first",
    );
    setActiveItemIndex(initialIndex);
    if (openFocusIntentRef.current !== "preserve" && initialIndex >= 0) {
      itemRefs.current[initialIndex]?.focus({ preventScroll: true });
    } else if (openFocusIntentRef.current !== "preserve") {
      menuRef.current?.focus({ preventScroll: true });
    }
    openFocusIntentRef.current = "first";
  }, [group.items, open]);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    const focused = menu?.ownerDocument.activeElement;
    if (open && menu && focused instanceof HTMLElement && menu.contains(focused)) {
      revealStudioMainMenuItem(focused, menu);
    }
  }, [coords, open]);

  useEffect(() => {
    if (!open) return;
    // Defer outside-dismiss so the opening click cannot immediately close the panel.
    let remove: (() => void) | undefined;
    let repositionFrame: number | null = null;
    const visualViewport = window.visualViewport;
    const attachTimer = window.setTimeout(() => {
      function onDoc(e: PointerEvent) {
        const t = e.target as Node | null;
        if (!t) return;
        if (buttonRef.current?.contains(t) || menuRef.current?.contains(t)) return;
        const otherTrigger = (e.target as HTMLElement | null)?.closest?.(
          "[data-studio-main-menu-trigger]"
        );
        if (otherTrigger) return;
        closeMenuRef.current(false);
      }
      function onKey(e: KeyboardEvent) {
        if (e.key !== "Escape" || e.defaultPrevented || e.isComposing || e.keyCode === 229) return;
        e.preventDefault();
        closeMenuRef.current();
      }
      function onReposition(event: Event) {
        // Scrolling menu rows does not move the trigger. Coalesce external
        // viewport changes instead of re-rendering once per scroll event.
        if (event.target === menuRef.current || repositionFrame !== null) return;
        repositionFrame = window.requestAnimationFrame(() => {
          repositionFrame = null;
          updateCoords();
        });
      }
      document.addEventListener("pointerdown", onDoc, true);
      document.addEventListener("keydown", onKey);
      window.addEventListener("resize", onReposition);
      window.addEventListener("scroll", onReposition, true);
      visualViewport?.addEventListener("resize", onReposition);
      visualViewport?.addEventListener("scroll", onReposition);
      remove = () => {
        document.removeEventListener("pointerdown", onDoc, true);
        document.removeEventListener("keydown", onKey);
        window.removeEventListener("resize", onReposition);
        window.removeEventListener("scroll", onReposition, true);
        visualViewport?.removeEventListener("resize", onReposition);
        visualViewport?.removeEventListener("scroll", onReposition);
      };
    }, 0);
    return () => {
      window.clearTimeout(attachTimer);
      if (repositionFrame !== null) window.cancelAnimationFrame(repositionFrame);
      remove?.();
    };
  }, [open]);

  const handleMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    if (event.key === "Tab") {
      // The panel is portalled to <body>, so sequential focus from inside it has nowhere
      // to go: the browser drops focus on BODY and leaves the menu open. Dismiss the menu
      // and hand focus back to its owning title, which is the menubar's single tab stop.
      event.preventDefault();
      event.stopPropagation();
      closeMenu();
      return;
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      event.stopPropagation();
      onNavigateGroup(event.key === "ArrowRight" ? "next" : "previous", true);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeMenu();
      return;
    }
    const command: StudioMainMenuNavigationCommand | null =
      event.key === "ArrowDown"
        ? "next"
        : event.key === "ArrowUp"
          ? "previous"
          : event.key === "Home"
            ? "first"
            : event.key === "End"
              ? "last"
              : null;
    if (!command) return;
    event.preventDefault();
    event.stopPropagation();
    const itemElement = (event.target as HTMLElement | null)?.closest?.(
      "[data-studio-main-menu-item-index]"
    );
    const itemIndex = Number(itemElement?.getAttribute("data-studio-main-menu-item-index"));
    focusMenuItem(command, Number.isSafeInteger(itemIndex) ? itemIndex : activeItemIndex);
  };

  const renderMenuItem = (item: StudioMainMenuItem, itemIndex: number): ReactElement => {
    const Icon = item.icon;
    const hint = item.hint
      ?? (item.hintKey ? MAIN_MENU_ITEM_HINTS[item.hintKey] : undefined)
      ?? (item.unavailableReason
            ? {
              id: `main-menu-item-${group.id}-${item.id}`,
              title: item.label,
              description: localizeText(
                t,
                "Check why this item is unavailable in the current state.",
                "studio.mainMenu.itemUnavailableHint",
              ),
            }
        : undefined);
    const unavailableReasonId = item.unavailableReason
      ? `${panelId}-item-${itemIndex}-unavailable-reason`
      : undefined;
    return (
      // Composite titles (삽입·도구) concatenate rows from several catalogue
      // groups; ids are only unique per source group, so the key carries the index.
      <div key={`${item.id}:${itemIndex}`}>
        <StudioToolHintTarget
          hint={hint}
          unavailableReason={item.unavailableReason}
          preferredSide="right"
          className="flex w-full"
        >
          <button
            ref={(node) => {
              itemRefs.current[itemIndex] = node;
            }}
            type="button"
            role={
              item.checked === undefined
                ? "menuitem"
                : item.selectionRole === "radio"
                  ? "menuitemradio"
                  : "menuitemcheckbox"
            }
            aria-checked={item.checked === undefined ? undefined : item.checked}
            aria-disabled={item.disabled || undefined}
            aria-describedby={unavailableReasonId}
            tabIndex={itemIndex !== activeItemIndex ? -1 : 0}
            data-studio-main-menu-item-index={itemIndex}
            data-studio-menu-item-id={item.id}
            onFocus={() => {
              setActiveItemIndex(itemIndex);
              revealStudioMainMenuItem(itemRefs.current[itemIndex] ?? null, menuRef.current);
            }}
            onClick={() => {
              if (item.disabled) return;
              try {
                item.onSelect();
              } finally {
                closeMenu();
              }
            }}
            className={cn(
              "mx-1 flex w-[calc(100%-0.5rem)] items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[0.78rem] font-medium pointer-coarse:min-h-11",
              STUDIO_EASE,
              STUDIO_FOCUS_RING,
              item.danger && "text-bad",
              item.disabled
                ? "cursor-not-allowed opacity-40"
                : "text-fg-2 hover:bg-raised hover:text-fg"
            )}
          >
            {Icon ? (
              <Icon
                size={STUDIO_ICON_SIZE.subtab}
                strokeWidth={STUDIO_ICON_STROKE}
                aria-hidden
                className={studioChromeIconClass({
                  tone: item.disabled ? "muted" : item.checked ? "accent" : "default",
                  active: item.checked,
                  disabled: item.disabled,
                })}
              />
            ) : (
              <span aria-hidden className="size-[15px] shrink-0" />
            )}
            <span className="min-w-0 flex-1 truncate tracking-tight">{item.label}</span>
            {item.checked ? (
              <Check
                size={STUDIO_ICON_SIZE.subtab}
                strokeWidth={STUDIO_ICON_STROKE}
                aria-hidden
                className={studioChromeIconClass({ tone: "accent", active: true })}
              />
            ) : null}
            {item.shortcut ? <StudioKbdBadge>{item.shortcut}</StudioKbdBadge> : null}
          </button>
        </StudioToolHintTarget>
        {item.unavailableReason ? (
          <span
            id={unavailableReasonId}
            data-studio-main-menu-unavailable-reason="true"
            className="sr-only"
          >
            {unavailableReasonLabel}: {item.unavailableReason}
          </span>
        ) : null}
        {item.separatorAfter ? (
          <div role="separator" className="mx-3 my-1.5 h-px bg-line/60" />
        ) : null}
      </div>
    );
  };

  const menu =
    open && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={menuRef}
            id={panelId}
            role="menu"
            aria-label={group.label}
            tabIndex={-1}
            data-studio-main-menu-panel="true"
            data-studio-main-menu-side={coords.side}
            data-studio-shortcut-boundary="true"
            onKeyDown={handleMenuKeyDown}
            className={cn(
              "fixed overflow-y-auto overscroll-contain rounded-2xl border border-line bg-panel py-1.5 shadow-2xl",
              "[scrollbar-width:thin]"
            )}
            style={{
              top: coords.top,
              left: coords.left,
              minWidth: coords.minWidth,
              maxWidth: coords.maxWidth,
              transform: coords.side === "top" ? "translateY(-100%)" : undefined,
              maxHeight: coords.maxHeight,
              // Body-level: beat studio shell / overflow chrome (options strip, absolute leftovers).
              zIndex: STUDIO_Z.workspace,
            }}
          >
            {splitStudioMainMenuSections(group.items).map((section, sectionIndex) => {
              const rows = section.rows.map(({ item, index }) => renderMenuItem(item, index));
              if (!section.label) return <Fragment key={`section:${sectionIndex}`}>{rows}</Fragment>;
              const captionId = `${panelId}-section-${sectionIndex}`;
              // A composite dropdown is one flat list of ~15 rows unless the caption
              // naming the source catalogue group reaches assistive tech too. `group`
              // is the ARIA pattern for a labelled section inside a `menu`: the caption
              // stays visible, labels the wrapper, and the rows keep their own
              // `menuitem` roles, flat indices and roving tabindex.
              return (
                <div
                  key={`section:${sectionIndex}`}
                  role="group"
                  aria-labelledby={captionId}
                  data-studio-main-menu-section-group={section.label}
                >
                  <div
                    id={captionId}
                    data-studio-main-menu-section={section.label}
                    className="mx-3 mb-0.5 mt-1.5 truncate text-[0.6875rem] font-bold uppercase tracking-wider text-fg-3 first:mt-0.5"
                  >
                    {section.label}
                  </div>
                  {rows}
                </div>
              );
            })}
          </div>,
          document.body
        )
      : null;

  return (
    <div
      // Presentational: the menubar owns the `menuitem` trigger, not this positioning shell.
      role="none"
      className="relative shrink-0"
      onMouseEnter={() => {
        if (barActive && !open) {
          // Desktop hover switching should not yank keyboard focus into the newly revealed menu.
          hoverOpenedRef.current = true;
          openMenu("preserve");
        }
      }}
      onMouseLeave={() => {
        // The pointer left both the title and its panel, so a later click is an ordinary
        // toggle rather than the tail of the hover that revealed this menu.
        hoverOpenedRef.current = false;
      }}
    >
      <StudioToolHintTarget
        hint={barActive ? null : resolveMainMenuHint(group, t)}
        preferredSide="bottom"
        className="shrink-0"
      >
        <button
          ref={buttonRef}
          type="button"
          data-studio-main-menu-trigger={group.id}
          role="menuitem"
          // APG roving tabindex: the menubar is one tab stop, and arrows move between the
          // 18 groups. Before this, reaching the canvas by keyboard cost 18 Tab presses.
          tabIndex={isTabStop ? 0 : -1}
          onPointerEnter={() => preloadStudioMainMenuGroupRuntime(group.id)}
          onFocus={() => {
            preloadStudioMainMenuGroupRuntime(group.id);
            onFocusTrigger();
          }}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          onPointerDown={(e) => {
            // Capture coords before open so the first paint is already positioned.
            if (e.button !== 0) return;
            if (!open) setCoords(measureTrigger(buttonRef.current));
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
            if (event.key === "Escape" && open) {
              event.preventDefault();
              event.stopPropagation();
              closeMenu();
              return;
            }
            if (event.key === "Tab" && open) {
              // Leaving the menubar must not strand an open panel over the canvas. Do not
              // preventDefault: the browser still performs its own move to the next stop.
              closeMenu(false);
              return;
            }
            if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
              event.preventDefault();
              event.stopPropagation();
              onNavigateGroup(
                event.key === "ArrowRight" ? "next" : "previous",
                barActive,
              );
              return;
            }
            if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
            event.preventDefault();
            event.stopPropagation();
            const intent = event.key === "ArrowUp" ? "last" : "first";
            if (open) {
              focusMenuItem(intent, -1);
            } else {
              openMenu(intent);
            }
          }}
          onClick={() => {
            if (!open) {
              openMenu("first");
              return;
            }
            if (hoverOpenedRef.current) {
              // This menu was revealed by the same cursor trip that produced the click.
              // Treat the click as the artist committing to it, not as a toggle-off.
              hoverOpenedRef.current = false;
              return;
            }
            closeMenu();
          }}
          className={cn(
            // Keep the full familiar core + specialist vocabulary reachable at laptop widths.
            // The chevron is decorative (aria-haspopup owns the affordance), so compact it
            // before allowing labels to collide inside the compressible menubar lane.
            "inline-flex h-8 items-center gap-1 rounded-lg px-1.5 text-[0.75rem] font-semibold tracking-tight xl:px-2 2xl:px-2.5 2xl:text-[0.78rem] pointer-coarse:h-11 pointer-coarse:px-2",
            STUDIO_EASE,
            STUDIO_FOCUS_RING,
            open
              ? "bg-raised text-fg shadow-[inset_0_0_0_1px_oklch(0.45_0.014_64/0.4)]"
              : "text-fg-2 hover:bg-raised/80 hover:text-fg"
          )}
        >
          {group.label}
          <ChevronDown
            size={STUDIO_ICON_SIZE.contextMenu}
            aria-hidden
            data-studio-main-menu-chevron="true"
            className={cn(
              "hidden opacity-50 transition-transform duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] 2xl:block motion-reduce:transition-none",
              open && "rotate-180 opacity-90"
            )}
          />
        </button>
      </StudioToolHintTarget>
      {menu}
    </div>
  );
}

/** Application menu bar — top-bar menu section. */
export function StudioMainMenu({
  groups,
  specialistBoundaryGroupId = null,
  className,
}: StudioMainMenuProps): ReactElement {
  const t = useT();
  const [openId, setOpenId] = useState<string | null>(null);
  // APG roving tabindex: exactly one trigger stays in the sequential tab order and the
  // arrow keys move that stop, so the menubar costs one Tab press to skip, not one per group.
  const [tabStopIndex, setTabStopIndex] = useState(0);
  const menuBarRef = useRef<HTMLDivElement>(null);
  const barActive = openId !== null;
  const activeTabStopIndex =
    tabStopIndex >= 0 && tabStopIndex < groups.length ? tabStopIndex : 0;

  const navigateGroup = (
    currentIndex: number,
    direction: MenuGroupNavigationDirection,
    openNextMenu: boolean,
  ) => {
    if (groups.length === 0) return;
    const offset = direction === "next" ? 1 : -1;
    const nextIndex = (currentIndex + offset + groups.length) % groups.length;
    const nextGroup = groups[nextIndex];
    if (!nextGroup) return;
    setTabStopIndex(nextIndex);
    if (openNextMenu) {
      setOpenId(nextGroup.id);
      return;
    }
    const triggers = menuBarRef.current?.querySelectorAll<HTMLButtonElement>(
      "[data-studio-main-menu-trigger]"
    );
    triggers?.[nextIndex]?.focus({ preventScroll: true });
  };

  return (
    // A `nav` landmark cannot carry `menubar` (jsx-a11y/no-noninteractive-element-to-
    // interactive-role), and an application menu is not site navigation anyway: the
    // arrow-key group traversal this bar already implements only becomes discoverable to
    // assistive tech once it announces itself as a menubar.
    <div
      ref={menuBarRef}
      role="menubar"
      aria-label={localizeText(t, "Main menu", "studio.mainMenu.aria")}
      data-studio-main-menu="true"
      data-studio-shortcut-boundary="true"
      className={cn("flex min-w-max shrink-0 flex-nowrap items-center gap-0.5", className)}
    >
      {groups.map((group, groupIndex) => (
        <Fragment key={group.id}>
          {group.id === specialistBoundaryGroupId ? (
            <span
              role="separator"
              aria-orientation="vertical"
              aria-label="전문 도구 메뉴"
              title="전문 도구"
              data-studio-main-menu-specialist-boundary="true"
              className="mx-1 inline-flex h-6 shrink-0 items-center gap-1 text-[0.6rem] font-bold text-fg-3"
            >
              <span aria-hidden className="h-4 w-px bg-line-strong" />
              <span aria-hidden className="hidden 2xl:inline">전문</span>
            </span>
          ) : null}
          <MenuDropdown
            group={group}
            open={openId === group.id}
            barActive={barActive}
            isTabStop={groupIndex === activeTabStopIndex}
            onFocusTrigger={() => setTabStopIndex(groupIndex)}
            onOpen={() => setOpenId(group.id)}
            onClose={() => setOpenId((id) => (id === group.id ? null : id))}
            onNavigateGroup={(direction, openNextMenu) =>
              navigateGroup(groupIndex, direction, openNextMenu)
            }
            t={t}
          />
        </Fragment>
      ))}
    </div>
  );
}

/** Thin label for menu sections (optional). */
export function StudioMainMenuHint({ children }: { children: ReactNode }): ReactElement {
  return <span className="hidden text-[0.6rem] text-fg-3 xl:inline">{children}</span>;
}
