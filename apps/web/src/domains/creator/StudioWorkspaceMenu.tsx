import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Hand,
  Keyboard,
  LayoutPanelTop,
  LockKeyhole,
  MessageCircle,
  MoreHorizontal,
  MousePointer2,
  Palette,
  PanelLeft,
  PanelRight,
  PanelsTopLeft,
  PencilLine,
  PenTool,
  RotateCcw,
  Save,
  Scan,
  ScanSearch,
  Search,
  Send,
  Settings2,
  Smartphone,
  SunMedium,
  Tablet,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import {
  STUDIO_ICON_SIZE,
  STUDIO_ICON_STROKE,
  studioChromeIconClass,
} from "./studio-chrome-ui";
import { STUDIO_QUICK_ACTION_PRESENTATION } from "./studio-quick-action-presentation";
import { QUICK_ACTION_SLOTS } from "./studio-quick-actions";
import { studioSearchTextMatches } from "./studio-search-text";
import {
  resolveStudioWorkspaceRecommendation,
  studioWorkspaceSearchAliases,
} from "./studio-workspace-recommendation";
import {
  STUDIO_DEFAULT_WORKSPACES,
  STUDIO_PRO_COMIC_PALETTE_PRIORITY,
  STUDIO_WORKSPACE_DEVICE_KINDS,
  STUDIO_WORKSPACE_MAX_CUSTOM,
  STUDIO_WORKSPACE_NAME_MAX_LENGTH,
  deleteStudioWorkspace,
  duplicateStudioWorkspace,
  isStudioWorkspaceDirty,
  moveStudioWorkspace,
  overwriteStudioWorkspace,
  reloadStudioWorkspace,
  renameStudioWorkspace,
  resolveStudioWorkspace,
  resolveStudioWorkspaceDeviceLayout,
  saveStudioWorkspace,
  setStudioWorkspaceDeviceOverride,
  switchStudioWorkspace,
  updateStudioWorkspaceLiveLayout,
  updateStudioWorkspacePreferences,
  type StudioDefaultWorkspaceId,
  type StudioWorkspaceDeviceKind,
  type StudioWorkspaceId,
  type StudioWorkspaceLayout,
  type StudioWorkspaceMoveDirection,
  type StudioWorkspacePersistenceFailure,
  type StudioWorkspaceSaveResult,
  type StudioWorkspaceState,
} from "./studio-workspaces";
import { StudioWorkspaceRecommendation } from "./StudioWorkspaceRecommendation";

import { cn } from "@/shared/lib/utils";

export interface StudioWorkspaceMenuProps {
  /** Opens the dialog on the first mount. Used by the intent-gated lazy launcher. */
  initialOpen?: boolean;
  /** Notifies the lazy launcher atomically when the initial dialog receives focus. */
  onInitialOpenReady?: (ready: true) => void;
  /** Persisted workspace catalog and preferences. */
  state: StudioWorkspaceState;
  /**
   * Authoritative layout currently rendered by StudioPage, in authored form.
   *
   * StudioPage folds device adaptation back into `deviceOverrides` before handing it over, so this
   * is safe to store into the catalog directly — it is never one device's geometry in disguise.
   */
  liveLayout: StudioWorkspaceLayout;
  /**
   * Samples which input surface the studio is being drawn on right now, or `null` for no adaptation.
   *
   * A function rather than a value so the manager reads it once as it opens. The answer can change
   * mid-session — the first time an artist puts a pen down — and a device editor that re-labelled
   * itself while someone was reading it would be worse than one that answers for the moment it was
   * opened.
   */
  resolveDeviceKind?: () => StudioWorkspaceDeviceKind | null;
  /** Result of loading or most recently persisting this owner's workspace state. */
  persistence: StudioWorkspacePersistenceSnapshot;
  /** Persists catalog, active selection, and device preferences. */
  onStateChange: (state: StudioWorkspaceState) => StudioWorkspacePersistenceSnapshot;
  /** Applies a switched or reloaded layout to the actual Studio controls. */
  onApplyLayout: (
    layout: StudioWorkspaceLayout,
    workspaceId?: StudioWorkspaceId,
  ) => void;
}

export type StudioWorkspacePersistenceSnapshot = Pick<
  StudioWorkspaceSaveResult,
  "status" | "failure"
>;

export interface StudioWorkspaceSearchEntry {
  readonly id?: string;
  readonly name: string;
  readonly description?: string;
}

const DEFAULT_WORKSPACE_ICONS: Record<StudioDefaultWorkspaceId, LucideIcon> = {
  storyboard: LayoutPanelTop,
  lineart: PenTool,
  coloring: Palette,
  lettering: MessageCircle,
  review: ScanSearch,
  publish: Send,
  "pro-comic": PanelsTopLeft,
  "quick-sketch": PencilLine,
  "csp-migration": PanelLeft,
  "pen-display": Tablet,
  "mobile-draw": Smartphone,
  "photo-edit": SunMedium,
  "vector-design": PenTool,
  animation: LayoutPanelTop,
  "pose-3d": Scan,
};

const DEVICE_KIND_LABELS: Record<StudioWorkspaceDeviceKind, string> = {
  "pen-display": "펜 디스플레이",
  mobile: "모바일",
  keyboard: "키보드",
  mouse: "마우스",
  touch: "터치",
};

const DEVICE_KIND_ICONS: Record<StudioWorkspaceDeviceKind, LucideIcon> = {
  "pen-display": Tablet,
  mobile: Smartphone,
  keyboard: Keyboard,
  mouse: MousePointer2,
  touch: Hand,
};

const INSPECTOR_PRIMARY_LABELS: Record<
  StudioWorkspaceLayout["inspector"]["primary"],
  string
> = {
  properties: "대상 속성",
  layers: "레이어",
  document: "문서 설정",
  publish: "작품 정보",
};

const PRO_COMIC_PALETTE_LABELS: Record<
  (typeof STUDIO_PRO_COMIC_PALETTE_PRIORITY)[number],
  string
> = {
  "tool-properties": "도구 속성",
  layers: "레이어",
  pages: "페이지",
  "materials-quick-access": "소재·빠른 실행",
};

const QUICK_ACTION_PREVIEW = STUDIO_QUICK_ACTION_PRESENTATION;

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "a[href]",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

const WORKSPACE_SEARCH_THRESHOLD = 8;
const RECENT_WORKSPACE_LIMIT = 2;
const COPY_SUFFIX = " 사본";
const AUXILIARY_TEXT_CLASS = "text-[0.6875rem]";
const focusClass =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/80 focus-visible:ring-offset-2 focus-visible:ring-offset-panel";

function StudioWorkspaceQuickAccessPreview({
  layout,
  compact = false,
}: {
  readonly layout: StudioWorkspaceLayout;
  readonly compact?: boolean;
}) {
  return (
    <span
      className={cn(
        "flex min-w-0 flex-wrap gap-1",
        compact ? "mt-1.5" : "mt-2"
      )}
      data-quick-access-density="responsive-icon-name"
      aria-label="주요 도구 순서"
    >
      {QUICK_ACTION_SLOTS.map((slot, index) => {
        const action = layout.quickActions.slots[slot];
        const presentation = QUICK_ACTION_PREVIEW[action];
        const Icon = presentation.Icon;
        return (
          <span
            key={slot}
            className={cn(
              "inline-flex min-h-8 min-w-8 items-center justify-center gap-1 rounded-md border border-line bg-raised px-1.5 text-[0.6875rem] font-semibold text-fg-2",
              compact && "min-[360px]:min-h-7"
            )}
            title={`${index + 1}. ${presentation.label}`}
            aria-label={`${index + 1}. ${presentation.label}`}
          >
            <Icon
              size={STUDIO_ICON_SIZE.subtab}
              strokeWidth={STUDIO_ICON_STROKE}
              aria-hidden
              className={studioChromeIconClass({ tone: "default" })}
            />
            <span className="max-[359px]:sr-only">{presentation.label}</span>
          </span>
        );
      })}
    </span>
  );
}

function StudioWorkspaceLayoutPreview({
  layout,
  mobileControlSide,
}: {
  readonly layout: StudioWorkspaceLayout;
  readonly mobileControlSide: StudioWorkspaceState["mobileControlSide"];
}) {
  const desktop = layout.desktop;
  const mobileSide = mobileControlSide === "left" ? "왼손" : "오른손";
  return (
    <span
      className="mt-2 block border-t border-line pt-2"
      data-testid="studio-workspace-layout-preview"
      data-mobile-fallback="canvas-first-sheets"
    >
      <span className="grid min-w-0 grid-cols-2 gap-x-2 gap-y-1 text-[0.6875rem] text-fg-3">
        <span className="inline-flex min-w-0 items-center gap-1">
          <PanelLeft
            size={STUDIO_ICON_SIZE.subtab}
            strokeWidth={STUDIO_ICON_STROKE}
            aria-hidden
            className={studioChromeIconClass({ tone: "default" })}
          />
          <span className="truncate">
            페이지 {desktop.leftPanelOpen ? `${desktop.leftPanelWidth}px` : "접힘"}
          </span>
        </span>
        <span className="inline-flex min-w-0 items-center gap-1">
          <PanelRight
            size={STUDIO_ICON_SIZE.subtab}
            strokeWidth={STUDIO_ICON_STROKE}
            aria-hidden
            className={studioChromeIconClass({ tone: "default" })}
          />
          <span className="truncate">
            {INSPECTOR_PRIMARY_LABELS[layout.inspector.primary]}{" "}
            {desktop.rightPanelOpen ? `${desktop.rightPanelWidth}px` : "접힘"}
          </span>
        </span>
        <span className="col-span-2 inline-flex min-w-0 items-center gap-1">
          <Smartphone
            size={STUDIO_ICON_SIZE.subtab}
            strokeWidth={STUDIO_ICON_STROKE}
            aria-hidden
            className={studioChromeIconClass({ tone: "default" })}
          />
          <span className="truncate">
            모바일은 캔버스 우선 · 페이지/속성 시트 · {mobileSide} 주요 도구
          </span>
        </span>
      </span>
      <span className="mt-2 block text-[0.6875rem] font-bold text-fg-3">
        주요 도구 순서
      </span>
      <StudioWorkspaceQuickAccessPreview layout={layout} />
    </span>
  );
}

function StudioProComicPresetPreview({
  layout,
}: {
  readonly layout: StudioWorkspaceLayout;
}) {
  const desktop = layout.desktop;
  return (
    <span
      className="mt-2 block border-t border-accent/25 pt-2"
      data-testid="studio-pro-comic-palette-plan"
    >
      <span className="flex flex-wrap items-center gap-1">
        <span className="rounded-full bg-accent-soft px-1.5 py-0.5 text-[0.6875rem] font-bold text-accent">
          권장 시작
        </span>
        <span className="text-[0.6875rem] font-bold text-fg-2">
          팔레트 우선순위
        </span>
      </span>
      <span
        className="mt-1.5 flex flex-wrap gap-1"
        aria-label="프로 만화 팔레트 우선순위"
      >
        {STUDIO_PRO_COMIC_PALETTE_PRIORITY.map((priority, index) => (
          <span
            key={priority}
            className="rounded-md bg-raised px-1.5 py-1 text-[0.6875rem] font-semibold text-fg-2"
          >
            {index + 1} {PRO_COMIC_PALETTE_LABELS[priority]}
          </span>
        ))}
      </span>
      <span className="mt-1.5 block text-[0.6875rem] leading-relaxed text-fg-3">
        {`왼쪽 페이지 ${desktop.leftPanelWidth}px · 오른쪽 ${INSPECTOR_PRIMARY_LABELS[layout.inspector.primary]} ${desktop.rightPanelWidth}px · 모바일은 캔버스 우선 시트`}
      </span>
      <StudioWorkspaceQuickAccessPreview layout={layout} compact />
    </span>
  );
}

function StudioWorkspaceOverlayLayer({
  portal,
  children,
}: {
  portal: boolean;
  children: ReactNode;
}) {
  return portal && typeof document !== "undefined"
    ? createPortal(children, document.body)
    : children;
}

class StudioWorkspaceOwnerChangedError extends Error {}

/**
 * Local AND search shared by the compact workspace picker and its edge-case tests.
 * 폴딩 규칙은 studio-search-text 한 곳만 쓴다 — 스튜디오의 다른 검색창과 같은 질의에
 * 같은 답을 주기 위한 통일이다(docs/rewrite/ux-audit-v5.md §2.8).
 */
function matchesStudioWorkspaceQuery(
  workspace: StudioWorkspaceSearchEntry,
  query: string
): boolean {
  return studioSearchTextMatches(query, [
    workspace.name,
    workspace.description,
    ...(workspace.id ? studioWorkspaceSearchAliases(workspace.id) : []),
  ]);
}

/** Builds a valid copy name without splitting surrogate pairs at the 48-character boundary. */
function createStudioWorkspaceCopyName(name: string): string {
  const suffixLength = Array.from(COPY_SUFFIX).length;
  const maximumBaseLength = STUDIO_WORKSPACE_NAME_MAX_LENGTH - suffixLength;
  const base = Array.from(name.trim()).slice(0, maximumBaseLength).join("").trim();
  return `${base || "작업공간"}${COPY_SUFFIX}`;
}

function focusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => !element.closest("[hidden]") && element.getAttribute("aria-hidden") !== "true"
  );
}

function trapTabKey(event: ReactKeyboardEvent<HTMLElement>, root: HTMLElement | null) {
  if (event.key !== "Tab" || !root) return;
  const focusable = focusableElements(root);
  if (focusable.length === 0) {
    event.preventDefault();
    root.focus({ preventScroll: true });
    return;
  }

  const first = focusable[0];
  const last = focusable.at(-1);
  const active = globalThis.document?.activeElement;
  if (event.shiftKey && (active === first || !root.contains(active))) {
    event.preventDefault();
    last?.focus({ preventScroll: true });
  } else if (!event.shiftKey && (active === last || !root.contains(active))) {
    event.preventDefault();
    first?.focus({ preventScroll: true });
  }
}

function errorText(error: unknown): string {
  if (error instanceof StudioWorkspaceOwnerChangedError) {
    return "로그인 상태가 바뀌어 이전 계정의 작업공간 변경을 적용하지 않았어요. 메뉴를 다시 열어 주세요.";
  }
  if (error instanceof RangeError) {
    return error.message.includes("at most")
      ? "내 작업공간은 최대 24개까지 저장할 수 있어요."
      : "선택한 작업공간을 찾을 수 없어요. 목록을 다시 확인해 주세요.";
  }
  if (error instanceof TypeError) return "이름을 1~48자로 입력해 주세요.";
  return "작업공간을 변경하지 못했어요. 다시 시도해 주세요.";
}

function persistenceFailureText(
  failure: StudioWorkspacePersistenceFailure | null
): string {
  switch (failure) {
    case "storage-unavailable":
      return "브라우저 저장소를 사용할 수 없어";
    case "ownership-busy":
      return "다른 Studio 탭이 로컬 저장소를 사용 중이라";
    case "read-failed":
      return "기존 저장 상태를 확인하지 못해";
    case "write-failed":
      return "브라우저 저장에 실패해";
    case "verification-failed":
      return "저장 결과를 확인하지 못해";
    case "owner-mismatch":
      return "사용자 전환 중 다른 계정의 저장을 막아";
    case "invalid-payload":
      return "저장 데이터가 올바르지 않아";
    case "payload-too-large":
      return "작업공간 설정 용량이 너무 커";
    default:
      return "아직 브라우저에 저장하지 않아";
  }
}

function persistenceNotice(
  actionMessage: string,
  result: StudioWorkspacePersistenceSnapshot
): string {
  const action = actionMessage.replace(/[.!?]+$/u, "");
  if (result.status === "persisted") {
    return `${action} · 이 기기 저장을 확인했어요.`;
  }
  return `${action} · ${persistenceFailureText(result.failure)} 이 세션에서만 유지됩니다.`;
}

export function StudioWorkspaceMenu({
  initialOpen = false,
  onInitialOpenReady,
  state,
  liveLayout,
  resolveDeviceKind,
  persistence,
  onStateChange,
  onApplyLayout,
}: StudioWorkspaceMenuProps) {
  const dialogId = useId();
  const titleId = useId();
  const descriptionId = useId();
  const switchGuardTitleId = useId();
  const switchGuardDescriptionId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const switchGuardRef = useRef<HTMLDivElement>(null);
  const switchGuardCancelRef = useRef<HTMLButtonElement>(null);
  const switchGuardReturnFocusRef = useRef<HTMLElement | null>(null);
  const newNameInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const manageEntryRef = useRef<HTMLButtonElement>(null);
  const manageBackRef = useRef<HTMLButtonElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(initialOpen);
  const [view, setView] = useState<"switch" | "manage">("switch");
  const [manageTab, setManageTab] = useState<"catalog" | "preferences">("catalog");
  const [query, setQuery] = useState("");
  const [builtinsExpanded, setBuiltinsExpanded] = useState(false);
  const [customExpanded, setCustomExpanded] = useState(
    () => state.customWorkspaces.length <= 4
  );
  const [saveFormOpen, setSaveFormOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [actionsWorkspaceId, setActionsWorkspaceId] = useState<string | null>(null);
  const [renameWorkspaceId, setRenameWorkspaceId] = useState<string | null>(null);
  const [renameName, setRenameName] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [pendingWorkspaceId, setPendingWorkspaceId] = useState<StudioWorkspaceId | null>(null);
  const [recentWorkspaceIds, setRecentWorkspaceIds] = useState<readonly string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeTone, setNoticeTone] = useState<"neutral" | "success" | "warning">("neutral");
  const [error, setError] = useState<string | null>(null);

  // Studio controls are authoritative. Fold them into the pure model before every action so an
  // autosaved catalog can never overwrite a more recent panel or quick-action change.
  const syncedState = updateStudioWorkspaceLiveLayout(state, liveLayout);
  const activeWorkspace = resolveStudioWorkspace(
    syncedState,
    syncedState.activeWorkspaceId
  );
  const activeIsCustom = syncedState.customWorkspaces.some(
    (workspace) => workspace.id === syncedState.activeWorkspaceId
  );
  // Sampled once when the dialog mounts — the manager is lazily mounted on the artist's click, so
  // "at mount" is "when they opened it", and a stable answer keeps the editor below from changing
  // which device it is describing while someone is reading it.
  const [deviceKind] = useState<StudioWorkspaceDeviceKind | null>(
    () => resolveDeviceKind?.() ?? null
  );
  // The surface being edited defaults to the one under the artist's hands, which is the only one
  // they can judge by looking. The other four stay reachable for setting up a device in advance.
  const [overrideDevice, setOverrideDevice] = useState<StudioWorkspaceDeviceKind>(
    () => deviceKind ?? "pen-display"
  );
  const activeDeviceOverride = activeWorkspace?.layout.deviceOverrides[overrideDevice];
  const dirty = isStudioWorkspaceDirty(syncedState);
  const atCustomLimit =
    syncedState.customWorkspaces.length >= STUDIO_WORKSPACE_MAX_CUSTOM;
  const showSearch =
    STUDIO_DEFAULT_WORKSPACES.length + syncedState.customWorkspaces.length >=
    WORKSPACE_SEARCH_THRESHOLD;
  const filteredBuiltins = STUDIO_DEFAULT_WORKSPACES.filter((workspace) =>
    matchesStudioWorkspaceQuery(workspace, query)
  );
  const filteredCustom = syncedState.customWorkspaces.filter((workspace) =>
    matchesStudioWorkspaceQuery(workspace, query)
  );
  const normalizedRecentIds = [
    ...recentWorkspaceIds,
    ...syncedState.customWorkspaces.map((workspace) => workspace.id).reverse(),
  ].filter(
    (id, index, ids) =>
      id !== syncedState.activeWorkspaceId &&
      ids.indexOf(id) === index &&
      syncedState.customWorkspaces.some((workspace) => workspace.id === id)
  );
  const recentWorkspaces = normalizedRecentIds
    .slice(0, RECENT_WORKSPACE_LIMIT)
    .map((id) => resolveStudioWorkspace(syncedState, id))
    .filter((workspace) => workspace !== null);
  const pendingWorkspace = pendingWorkspaceId
    ? resolveStudioWorkspace(syncedState, pendingWorkspaceId)
    : null;
  const workspaceRecommendation = query.trim().length === 0
    ? resolveStudioWorkspaceRecommendation(
        STUDIO_DEFAULT_WORKSPACES,
        syncedState.activeWorkspaceId
      )
    : null;
  const builtinListExpanded = query.trim().length > 0 || builtinsExpanded;
  const customListExpanded = query.trim().length > 0 || customExpanded;
  const reorderBlockedBySearch = query.trim().length > 0;
  const searchResultCount =
    view === "manage"
      ? filteredCustom.length
      : filteredBuiltins.length + filteredCustom.length;
  const effectivePersistence = persistence;

  function commitState(next: StudioWorkspaceState): StudioWorkspacePersistenceSnapshot {
    const result = onStateChange(next);
    if (result.failure === "owner-mismatch") {
      throw new StudioWorkspaceOwnerChangedError();
    }
    return result;
  }

  function announceCommitted(
    successMessage: string,
    result: StudioWorkspacePersistenceSnapshot
  ) {
    setNotice(persistenceNotice(successMessage, result));
    setNoticeTone(result.status === "persisted" ? "success" : "warning");
  }

  function resetTransientEditors() {
    setSaveFormOpen(false);
    setNewName("");
    setActionsWorkspaceId(null);
    setRenameWorkspaceId(null);
    setRenameName("");
    setConfirmDeleteId(null);
    setPendingWorkspaceId(null);
  }

  function closeMenu() {
    setOpen(false);
    setView("switch");
    setManageTab("catalog");
    setQuery("");
    resetTransientEditors();
    setError(null);
  }

  function openWorkspaceManager() {
    setQuery("");
    resetTransientEditors();
    setCustomExpanded(true);
    setManageTab("catalog");
    setView("manage");
    setNotice(null);
    setError(null);
    globalThis.requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: 0 });
      manageBackRef.current?.focus({ preventScroll: true });
    });
  }

  function returnToWorkspaceSwitcher() {
    setQuery("");
    resetTransientEditors();
    setManageTab("catalog");
    setView("switch");
    setNotice(null);
    setError(null);
    globalThis.requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: 0 });
      manageEntryRef.current?.focus({ preventScroll: true });
    });
  }

  useLayoutEffect(() => {
    if (!open || typeof globalThis.document === "undefined") return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousFocus =
      globalThis.document.activeElement instanceof HTMLElement
        ? globalThis.document.activeElement
        : null;
    const triggerAtOpen = triggerRef.current;
    const initial = dialog.querySelector<HTMLElement>(
      "[data-workspace-initial-focus]"
    );
    (initial ?? dialog).focus({ preventScroll: true });
    onInitialOpenReady?.(true);

    return () => {
      const returnTarget = triggerAtOpen?.isConnected
        ? triggerAtOpen
        : previousFocus?.isConnected
          ? previousFocus
          : null;
      returnTarget?.focus({ preventScroll: true });
    };
  }, [onInitialOpenReady, open]);

  useEffect(() => {
    if (!open || typeof globalThis.document === "undefined") return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (
        dialogRef.current?.contains(target) ||
        triggerRef.current?.contains(target)
      ) {
        return;
      }
      // A destructive switch choice must be explicit; outside presses do not dismiss its guard.
      if (pendingWorkspaceId) return;
      setOpen(false);
      setQuery("");
      setSaveFormOpen(false);
      setNewName("");
      setActionsWorkspaceId(null);
      setRenameWorkspaceId(null);
      setRenameName("");
      setConfirmDeleteId(null);
      setPendingWorkspaceId(null);
      setError(null);
    }

    globalThis.document.addEventListener("pointerdown", handlePointerDown);
    return () => globalThis.document.removeEventListener("pointerdown", handlePointerDown);
  }, [open, pendingWorkspaceId]);

  useEffect(() => {
    if (!open || !pendingWorkspaceId) return;
    const frame = globalThis.requestAnimationFrame(() => {
      switchGuardCancelRef.current?.focus({ preventScroll: true });
    });
    return () => globalThis.cancelAnimationFrame(frame);
  }, [open, pendingWorkspaceId]);

  useEffect(() => {
    if (!open || (!saveFormOpen && !renameWorkspaceId)) return;
    const frame = globalThis.requestAnimationFrame(() => {
      if (renameWorkspaceId) renameInputRef.current?.focus({ preventScroll: true });
      else newNameInputRef.current?.focus({ preventScroll: true });
    });
    return () => globalThis.cancelAnimationFrame(frame);
  }, [open, renameWorkspaceId, saveFormOpen]);

  function handleTriggerClick() {
    if (open) {
      closeMenu();
      return;
    }
    setView("switch");
    setManageTab("catalog");
    setOpen(true);
    setNotice(null);
    setError(null);
  }

  function rememberRecentWorkspace(id: StudioWorkspaceId) {
    setRecentWorkspaceIds((current) =>
      [syncedState.activeWorkspaceId, ...current]
        .filter((candidate, index, ids) => candidate !== id && ids.indexOf(candidate) === index)
        .slice(0, RECENT_WORKSPACE_LIMIT)
    );
  }

  function completeWorkspaceSwitch(baseState: StudioWorkspaceState, id: StudioWorkspaceId) {
    const next = switchStudioWorkspace(baseState, id);
    rememberRecentWorkspace(id);
    commitState(next);
    onApplyLayout(next.liveLayout, next.activeWorkspaceId);
    closeMenu();
  }

  function requestWorkspaceSwitch(
    id: StudioWorkspaceId,
    returnFocus?: HTMLElement | null
  ) {
    if (id === syncedState.activeWorkspaceId) {
      setNotice(
        dirty
          ? "현재 작업공간입니다. 변경을 버리려면 ‘저장된 배치 다시 불러오기’를 사용하세요."
          : "이미 사용 중인 작업공간입니다."
      );
      setNoticeTone("neutral");
      setError(null);
      return;
    }

    if (dirty) {
      switchGuardReturnFocusRef.current = returnFocus ?? null;
      setPendingWorkspaceId(id);
      setSaveFormOpen(false);
      setActionsWorkspaceId(null);
      setRenameWorkspaceId(null);
      setConfirmDeleteId(null);
      setError(null);
      return;
    }

    try {
      completeWorkspaceSwitch(syncedState, id);
    } catch (actionError) {
      setError(errorText(actionError));
    }
  }

  function cancelPendingSwitch() {
    setPendingWorkspaceId(null);
    const returnTarget = switchGuardReturnFocusRef.current;
    switchGuardReturnFocusRef.current = null;
    globalThis.requestAnimationFrame(() => {
      if (returnTarget?.isConnected) returnTarget.focus({ preventScroll: true });
      else dialogRef.current?.focus({ preventScroll: true });
    });
  }

  function discardAndSwitch() {
    if (!pendingWorkspaceId) return;
    try {
      completeWorkspaceSwitch(syncedState, pendingWorkspaceId);
    } catch (actionError) {
      setError(errorText(actionError));
    }
  }

  function saveAndSwitch() {
    if (!pendingWorkspaceId || !activeWorkspace) return;
    try {
      const saved = activeIsCustom
        ? overwriteStudioWorkspace(
            syncedState,
            syncedState.activeWorkspaceId,
            liveLayout
          )
        : saveStudioWorkspace(
            syncedState,
            createStudioWorkspaceCopyName(activeWorkspace.name),
            liveLayout
          );
      completeWorkspaceSwitch(saved, pendingWorkspaceId);
    } catch (actionError) {
      setError(errorText(actionError));
    }
  }

  function saveCurrentChanges() {
    if (!activeWorkspace) return;
    try {
      const next = activeIsCustom
        ? overwriteStudioWorkspace(
            syncedState,
            syncedState.activeWorkspaceId,
            liveLayout
          )
        : saveStudioWorkspace(
            syncedState,
            createStudioWorkspaceCopyName(activeWorkspace.name),
            liveLayout
          );
      const result = commitState(next);
      announceCommitted(
        activeIsCustom
          ? `“${activeWorkspace.name}”의 배치를 업데이트했어요.`
          : `“${createStudioWorkspaceCopyName(activeWorkspace.name)}” 작업공간을 만들었어요.`,
        result
      );
      setError(null);
    } catch (actionError) {
      setError(errorText(actionError));
    }
  }

  function reloadActiveWorkspace() {
    try {
      const next = reloadStudioWorkspace(syncedState);
      const result = commitState(next);
      onApplyLayout(next.liveLayout, next.activeWorkspaceId);
      announceCommitted(
        `“${activeWorkspace?.name ?? "현재 작업공간"}”의 저장된 배치를 다시 적용했어요.`,
        result
      );
      setError(null);
    } catch (actionError) {
      setError(errorText(actionError));
    }
  }

  function handleEscape() {
    if (pendingWorkspaceId) {
      cancelPendingSwitch();
      return;
    }
    if (renameWorkspaceId) {
      setRenameWorkspaceId(null);
      setRenameName("");
      setError(null);
      return;
    }
    if (confirmDeleteId) {
      setConfirmDeleteId(null);
      return;
    }
    if (saveFormOpen) {
      setSaveFormOpen(false);
      setNewName("");
      setError(null);
      return;
    }
    if (actionsWorkspaceId) {
      setActionsWorkspaceId(null);
      return;
    }
    if (query) {
      setQuery("");
      return;
    }
    if (view === "manage") {
      returnToWorkspaceSwitcher();
      return;
    }
    closeMenu();
  }

  function handleDialogKeyDownCapture(event: ReactKeyboardEvent<HTMLElement>) {
    // StudioPage also protects shortcut boundaries, but consuming here keeps the menu independently
    // safe when embedded in another canvas host. Row reordering is handled at this boundary before
    // propagation is consumed, so the canvas never receives the same Alt+Arrow shortcut.
    const shortcutTarget =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>("[data-workspace-manage-trigger]")
        : null;
    if (
      shortcutTarget?.dataset.workspaceManageTrigger &&
      event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      (event.key === "ArrowUp" || event.key === "ArrowDown")
    ) {
      event.preventDefault();
      event.stopPropagation();
      moveWorkspaceInCatalog(
        shortcutTarget.dataset.workspaceManageTrigger,
        event.key === "ArrowUp" ? "up" : "down"
      );
      return;
    }
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      handleEscape();
      return;
    }
    trapTabKey(
      event,
      pendingWorkspaceId ? switchGuardRef.current : dialogRef.current
    );
  }

  function stopNonDialogShortcutPropagation(event: ReactKeyboardEvent<HTMLDivElement>) {
    const target = event.target;
    if (!(target instanceof Node) || !dialogRef.current?.contains(target)) {
      event.stopPropagation();
    }
  }

  function submitNewWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const next = saveStudioWorkspace(syncedState, newName, liveLayout);
      const result = commitState(next);
      setNewName("");
      setSaveFormOpen(false);
      announceCommitted(
        `“${next.customWorkspaces.at(-1)?.name ?? "내 작업공간"}” 작업공간을 만들었어요.`,
        result
      );
      setError(null);
    } catch (actionError) {
      setError(errorText(actionError));
    }
  }

  function overwriteWorkspace(id: string) {
    if (id !== syncedState.activeWorkspaceId) return;
    try {
      const next = overwriteStudioWorkspace(syncedState, id, liveLayout);
      const workspace = resolveStudioWorkspace(next, id);
      const result = commitState(next);
      announceCommitted(
        `“${workspace?.name ?? "내 작업공간"}”의 배치를 업데이트했어요.`,
        result
      );
      setError(null);
      setConfirmDeleteId(null);
    } catch (actionError) {
      setError(errorText(actionError));
    }
  }

  function reloadWorkspace(id: string, returnFocus?: HTMLElement | null) {
    if (id !== syncedState.activeWorkspaceId) {
      requestWorkspaceSwitch(id, returnFocus);
      return;
    }
    reloadActiveWorkspace();
    setActionsWorkspaceId(null);
  }

  function beginRename(id: string, name: string) {
    setRenameWorkspaceId(id);
    setRenameName(name);
    setConfirmDeleteId(null);
    setError(null);
  }

  function submitRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!renameWorkspaceId) return;
    try {
      const next = renameStudioWorkspace(
        syncedState,
        renameWorkspaceId,
        renameName
      );
      const result = commitState(next);
      setRenameWorkspaceId(null);
      setRenameName("");
      announceCommitted("작업공간 이름을 변경했어요.", result);
      setError(null);
    } catch (actionError) {
      setError(errorText(actionError));
    }
  }

  function focusWorkspaceManagement(id: string) {
    globalThis.requestAnimationFrame(() => {
      const target = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>("[data-workspace-manage-trigger]") ?? []
      ).find((element) => element.dataset.workspaceManageTrigger === id);
      target?.focus({ preventScroll: true });
    });
  }

  function duplicateWorkspace(id: string) {
    try {
      const previousIds = new Set(syncedState.customWorkspaces.map((workspace) => workspace.id));
      const next = duplicateStudioWorkspace(syncedState, id);
      const duplicate = next.customWorkspaces.find((workspace) => !previousIds.has(workspace.id));
      const result = commitState(next);
      announceCommitted(
        `“${duplicate?.name ?? "작업공간 복사본"}”을 만들었어요.`,
        result
      );
      if (duplicate) {
        setActionsWorkspaceId(duplicate.id);
        focusWorkspaceManagement(duplicate.id);
      }
      setConfirmDeleteId(null);
      setRenameWorkspaceId(null);
      setError(null);
    } catch (actionError) {
      setError(errorText(actionError));
    }
  }

  function moveWorkspaceInCatalog(
    id: string,
    direction: StudioWorkspaceMoveDirection
  ) {
    if (reorderBlockedBySearch) {
      setNotice("순서를 바꾸려면 검색어를 먼저 지워 주세요.");
      setNoticeTone("neutral");
      return;
    }
    try {
      const workspace = resolveStudioWorkspace(syncedState, id);
      const next = moveStudioWorkspace(syncedState, id, direction);
      const result = commitState(next);
      announceCommitted(
        `“${workspace?.name ?? "내 작업공간"}”을 ${direction === "up" ? "위" : "아래"}로 옮겼어요.`,
        result
      );
      focusWorkspaceManagement(id);
      setConfirmDeleteId(null);
      setRenameWorkspaceId(null);
      setError(null);
    } catch (actionError) {
      setError(errorText(actionError));
    }
  }

  function confirmDeleteWorkspace(id: string) {
    try {
      const deletingActive = syncedState.activeWorkspaceId === id;
      const workspace = resolveStudioWorkspace(syncedState, id);
      const next = deleteStudioWorkspace(syncedState, id);
      const result = commitState(next);
      if (deletingActive) onApplyLayout(next.liveLayout, next.activeWorkspaceId);
      setActionsWorkspaceId(null);
      setConfirmDeleteId(null);
      setRenameWorkspaceId(null);
      announceCommitted(
        `“${workspace?.name ?? "내 작업공간"}”을 삭제했어요.`,
        result
      );
      setError(null);
    } catch (actionError) {
      setError(errorText(actionError));
    }
  }

  function updateDevicePreferences(
    preferences: Parameters<typeof updateStudioWorkspacePreferences>[1]
  ) {
    try {
      const result = commitState(
        updateStudioWorkspacePreferences(syncedState, preferences)
      );
      announceCommitted("작업공간 전환 설정을 변경했어요.", result);
      setError(null);
    } catch (actionError) {
      setError(errorText(actionError));
    }
  }

  /**
   * Rewrites the active workspace's own layout, then re-applies it through StudioPage.
   *
   * The re-apply is what makes an override take effect now instead of at the next switch: it runs
   * the layout back through the device resolver, so editing the surface you are sitting at shows
   * its result immediately.
   */
  function commitActiveWorkspaceLayout(layout: StudioWorkspaceLayout, message: string) {
    try {
      const next = overwriteStudioWorkspace(
        syncedState,
        syncedState.activeWorkspaceId,
        layout
      );
      const result = commitState(next);
      onApplyLayout(next.liveLayout, next.activeWorkspaceId);
      announceCommitted(message, result);
      setError(null);
    } catch (actionError) {
      setError(errorText(actionError));
    }
  }

  function changeDeviceOverride(
    override: Parameters<typeof setStudioWorkspaceDeviceOverride>[2],
    message: string
  ) {
    if (!activeWorkspace) return;
    commitActiveWorkspaceLayout(
      setStudioWorkspaceDeviceOverride(activeWorkspace.layout, overrideDevice, override),
      message
    );
  }

  return (
    <div
      className={cn("relative inline-flex", open && "z-[100] isolate")}
      data-testid="studio-workspace-menu"
      data-studio-shortcut-boundary="true"
      onKeyDownCapture={stopNonDialogShortcutPropagation}
      onKeyUpCapture={stopNonDialogShortcutPropagation}
    >
      <button
        ref={triggerRef}
        type="button"
        onClick={handleTriggerClick}
        data-testid="studio-workspace-menu-toggle"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={dialogId}
        aria-label={`작업공간: ${activeWorkspace?.name ?? "알 수 없음"}${dirty ? " 변경됨" : ""}${effectivePersistence.status === "session-only" ? " 세션" : ""}${dirty ? ", 저장되지 않은 배치 변경 있음" : ""}${effectivePersistence.status === "session-only" ? ", 변경은 이 세션에서만 유지" : ", 이 기기 저장 확인됨"}`}
        className={cn(
          // StudioWorkspaceMenuGate 트리거와 같은 칩 박스 규약(이름만 shrink, 배지는 shrink-0).
          // `overflow-hidden` 을 더하지 않는 이유는 그쪽 주석 참고 — 배지를 잘리게 만든다.
          "inline-flex min-h-11 max-w-52 items-center gap-2 rounded-lg border border-line bg-card px-3 text-xs font-semibold text-fg-2 transition-colors hover:border-line-strong hover:bg-raised hover:text-fg pointer-coarse:min-h-11 lg:min-h-8",
          open && "border-accent/60 bg-accent-soft text-fg",
          focusClass
        )}
      >
        <LayoutPanelTop
          size={STUDIO_ICON_SIZE.toolCompact}
          strokeWidth={STUDIO_ICON_STROKE}
          aria-hidden
          className={studioChromeIconClass({ tone: "default" })}
        />
        <span className="min-w-0 truncate">{activeWorkspace?.name ?? "작업공간"}</span>
        {" "}
        {dirty ? (
          <span className="shrink-0 rounded-full bg-warn/15 px-1.5 py-0.5 text-[0.6875rem] font-bold text-warn">
            변경됨
          </span>
        ) : null}
        {" "}
        {effectivePersistence.status === "session-only" ? (
          <span className="shrink-0 rounded-full bg-cool/15 px-1.5 py-0.5 text-[0.6875rem] font-bold text-cool">
            세션
          </span>
        ) : null}
        <ChevronDown
          size={STUDIO_ICON_SIZE.contextMenu}
          strokeWidth={STUDIO_ICON_STROKE}
          aria-hidden
          className={cn(
            "ml-auto shrink-0 transition-transform",
            open && "rotate-180",
            studioChromeIconClass({ tone: "default" })
          )}
        />
      </button>

      {/* Always portal: desktop menubar scroll/stacking must not clip the dialog. */}
      <StudioWorkspaceOverlayLayer portal>
        <button
          type="button"
          aria-label="작업공간 메뉴 닫기"
          tabIndex={-1}
          hidden={!open}
          onClick={() => {
            if (!pendingWorkspaceId) closeMenu();
          }}
          className="fixed inset-0 z-[99] cursor-default bg-canvas/75 backdrop-blur-[1px] lg:hidden"
        />

        <section
          ref={dialogRef}
          id={dialogId}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          tabIndex={-1}
          hidden={!open}
          onKeyDownCapture={handleDialogKeyDownCapture}
          onKeyUpCapture={(event) => event.stopPropagation()}
          className={cn(
            // Always fixed so desktop menubar overflow never clips this dialog (portal on mobile already).
            "fixed z-[100] flex max-h-[calc(100dvh-1rem)] min-h-0 flex-col overflow-hidden rounded-lg border border-line-strong bg-panel shadow-xl",
            "inset-x-2 top-[max(0.5rem,env(safe-area-inset-top))] bottom-[max(0.5rem,env(safe-area-inset-bottom))]",
            "lg:inset-x-auto lg:bottom-auto lg:right-3 lg:top-14 lg:h-auto lg:max-h-[min(42rem,calc(100dvh-5rem))] lg:w-96"
          )}
          data-testid="studio-workspace-dialog"
          data-studio-shortcut-boundary="true"
        >
        <div
          className={cn(
            "flex min-h-0 flex-1 flex-col",
            pendingWorkspaceId && "pointer-events-none select-none"
          )}
          aria-hidden={pendingWorkspaceId ? true : undefined}
        >
          <header className="flex shrink-0 items-start gap-2 border-b border-line px-3 py-3">
            <button
              ref={manageBackRef}
              type="button"
              hidden={view !== "manage"}
              onClick={returnToWorkspaceSwitcher}
              aria-label="빠른 작업공간 전환으로 돌아가기"
              className={cn(
                "grid size-11 shrink-0 place-items-center rounded-lg text-fg-3 transition-colors hover:bg-raised hover:text-fg",
                focusClass
              )}
            >
              <ChevronLeft
                size={STUDIO_ICON_SIZE.rail}
                strokeWidth={STUDIO_ICON_STROKE}
                aria-hidden
                className={studioChromeIconClass({ tone: "default" })}
              />
            </button>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2">
                <h2 id={titleId} className="truncate text-sm font-bold text-fg">
                  {view === "manage" ? "작업공간 관리" : "작업공간"}
                </h2>
                <span
                  aria-label={dirty ? "저장된 작업공간 배치와 다름" : "저장된 작업공간 배치와 일치"}
                  className={cn(
                    "shrink-0 rounded-full px-1.5 py-0.5 text-[0.6875rem] font-bold",
                    dirty ? "bg-warn/15 text-warn" : "bg-good/15 text-good"
                  )}
                >
                  {dirty ? "변경됨" : "배치 일치"}
                </span>
              </div>
              <p id={descriptionId} className="mt-1 truncate text-[0.6875rem] text-fg-3">
                {view === "manage"
                  ? "저장·복제·순서·기기 설정"
                  : `${activeWorkspace?.name ?? "작업공간"} · 패널과 주요 도구 배치`}
              </p>
            </div>
            <button
              type="button"
              onClick={closeMenu}
              aria-label="작업공간 메뉴 닫기"
              className={cn(
                "grid size-11 shrink-0 place-items-center rounded-lg text-fg-3 transition-colors hover:bg-raised hover:text-fg",
                focusClass
              )}
            >
              <X
                size={STUDIO_ICON_SIZE.nav}
                strokeWidth={STUDIO_ICON_STROKE}
                aria-hidden
                className={studioChromeIconClass({ tone: "default" })}
              />
            </button>
          </header>

          <div
            id={`${dialogId}-management-tabs`}
            role="group"
            aria-label="작업공간 관리 보기"
            hidden={view !== "manage"}
            className="grid shrink-0 grid-cols-2 gap-1.5 border-b border-line bg-card/50 px-3 py-2"
          >
            {([
              ["catalog", "내 작업공간", LayoutPanelTop],
              ["preferences", "전환 설정", Settings2],
            ] as const).map(([tab, label, Icon]) => {
              const selected = manageTab === tab;
              return (
                <button
                  key={tab}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => {
                    setManageTab(tab);
                    setQuery("");
                    resetTransientEditors();
                    globalThis.requestAnimationFrame(() =>
                      scrollRef.current?.scrollTo({ top: 0 })
                    );
                  }}
                  className={cn(
                    "inline-flex min-h-11 min-w-0 items-center justify-center gap-1.5 rounded-lg border px-2 text-xs font-bold",
                    selected
                      ? "border-accent bg-accent-soft text-accent"
                      : "border-line bg-panel text-fg-2 hover:bg-raised",
                    focusClass
                  )}
                >
                  <Icon
                    size={STUDIO_ICON_SIZE.subtab}
                    strokeWidth={STUDIO_ICON_STROKE}
                    aria-hidden
                    className={studioChromeIconClass({ tone: "default" })}
                  />
                  <span className="truncate">{label}</span>
                </button>
              );
            })}
          </div>

          <div
            ref={scrollRef}
            className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-3 py-3 [scrollbar-gutter:stable]"
          >
            <div aria-live="polite" aria-atomic="true">
              {error ? (
                <p role="alert" className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-xs text-bad">
                  {error}
                </p>
              ) : null}
              {notice && !error ? (
                <p
                  role="status"
                  className={cn(
                    "rounded-lg border px-3 py-2 text-xs",
                    noticeTone === "success" && "border-good/30 bg-good/10 text-good",
                    noticeTone === "warning" && "border-warn/35 bg-warn/10 text-warn",
                    noticeTone === "neutral" && "border-line bg-raised text-fg-2"
                  )}
                >
                  {notice}
                </p>
              ) : null}
            </div>

            <section hidden={view !== "switch"} aria-labelledby={`${titleId}-current`}>
              <h3 id={`${titleId}-current`} className="mb-1.5 text-[0.6875rem] font-bold text-fg-2">
                현재 및 최근
              </h3>
              <article
                tabIndex={-1}
                data-workspace-initial-focus="true"
                aria-label={`현재 작업공간 ${activeWorkspace?.name ?? "알 수 없음"}, ${dirty ? "변경됨" : "저장됨"}`}
                className={cn(
                  "rounded-lg border px-3 py-2.5",
                  dirty ? "border-warn/40 bg-warn/5" : "border-line bg-card",
                  focusClass
                )}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span className="grid size-8 shrink-0 place-items-center rounded-md bg-raised text-accent">
                    <LayoutPanelTop
                      size={STUDIO_ICON_SIZE.context}
                      strokeWidth={STUDIO_ICON_STROKE}
                      aria-hidden
                      className={studioChromeIconClass({ tone: "accent" })}
                    />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-bold text-fg">
                      {activeWorkspace?.name ?? "작업공간"}
                    </span>
                    <span className={cn("mt-0.5 block text-fg-3", AUXILIARY_TEXT_CLASS)}>
                      {activeIsCustom ? "내 작업공간" : "기본 작업공간"} · {dirty ? "저장 전 변경 있음" : "저장된 배치와 같음"}
                    </span>
                  </span>
                  <Check
                    size={STUDIO_ICON_SIZE.contextMenu}
                    strokeWidth={STUDIO_ICON_STROKE}
                    aria-hidden
                    className={studioChromeIconClass({ tone: "accent" })}
                  />
                </div>
                <StudioWorkspaceLayoutPreview
                  layout={syncedState.liveLayout}
                  mobileControlSide={syncedState.mobileControlSide}
                />
                {dirty ? (
                  <div className="mt-2 grid min-w-0 grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={saveCurrentChanges}
                      disabled={!activeIsCustom && atCustomLimit}
                      aria-label={activeIsCustom ? "현재 작업공간 변경 저장" : "현재 배치를 사본으로 저장"}
                      className={cn(
                        "min-h-11 min-w-0 whitespace-normal rounded-lg bg-accent px-2 text-[0.6875rem] font-bold leading-tight text-on-accent hover:bg-accent-2 disabled:cursor-not-allowed disabled:opacity-45",
                        focusClass
                      )}
                    >
                      {activeIsCustom ? "변경 저장" : "사본으로 저장"}
                    </button>
                    <button
                      type="button"
                      onClick={reloadActiveWorkspace}
                      className={cn(
                        "min-h-11 min-w-0 whitespace-normal rounded-lg border border-line px-2 text-[0.6875rem] font-bold leading-tight text-fg-2 hover:bg-raised hover:text-fg",
                        focusClass
                      )}
                    >
                      저장된 배치 다시 불러오기
                    </button>
                  </div>
                ) : null}
              </article>

              {recentWorkspaces.length > 0 ? (
                <div className="mt-1.5 grid min-w-0 grid-cols-2 gap-1.5" aria-label="최근 작업공간">
                  {recentWorkspaces.map((workspace) => (
                    <button
                      key={workspace.id}
                      type="button"
                      onClick={(event) => requestWorkspaceSwitch(workspace.id, event.currentTarget)}
                      aria-label={`최근 작업공간 ${workspace.name}(으)로 전환`}
                      className={cn(
                        "min-h-11 min-w-0 truncate rounded-lg border border-line bg-card px-2 text-[0.6875rem] font-bold text-fg-2 hover:border-line-strong hover:bg-raised hover:text-fg",
                        focusClass
                      )}
                    >
                      {workspace.name}
                    </button>
                  ))}
                </div>
              ) : null}
            </section>

            {view === "switch" && workspaceRecommendation ? (
              <StudioWorkspaceRecommendation
                recommendation={workspaceRecommendation}
                onSelect={(event) =>
                  requestWorkspaceSwitch(
                    workspaceRecommendation.workspace.id,
                    event.currentTarget
                  )
                }
              />
            ) : null}

            {showSearch ? (
              <div
                role="search"
                hidden={view === "manage" && manageTab !== "catalog"}
              >
                <label htmlFor={`${dialogId}-search`} className="sr-only">
                  작업공간 검색
                </label>
                <div className="relative">
                  <Search
                    size={STUDIO_ICON_SIZE.contextMenu}
                    strokeWidth={STUDIO_ICON_STROKE}
                    aria-hidden
                    className={cn(
                      "pointer-events-none absolute left-3 top-1/2 -translate-y-1/2",
                      studioChromeIconClass({ tone: "muted" })
                    )}
                  />
                  <input
                    id={`${dialogId}-search`}
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.currentTarget.value)}
                    maxLength={64}
                    autoComplete="off"
                    placeholder="작업공간 이름 또는 용도 검색"
                    className={cn(
                      "min-h-11 w-full rounded-lg border border-line bg-card pl-9 pr-11 text-xs text-fg outline-none placeholder:text-fg-3",
                      focusClass
                    )}
                  />
                  {query ? (
                    <button
                      type="button"
                      onClick={() => setQuery("")}
                      aria-label="작업공간 검색어 지우기"
                      className={cn(
                        "absolute right-0 top-0 grid size-11 place-items-center rounded-lg text-fg-3 hover:text-fg",
                        focusClass
                      )}
                    >
                      <X
                        size={STUDIO_ICON_SIZE.contextMenu}
                        strokeWidth={STUDIO_ICON_STROKE}
                        aria-hidden
                        className={studioChromeIconClass({ tone: "default" })}
                      />
                    </button>
                  ) : null}
                </div>
                <p className="sr-only" role="status" aria-live="polite">
                  검색 결과 {searchResultCount}개
                </p>
              </div>
            ) : null}

            <section hidden={view !== "switch"} aria-labelledby={`${titleId}-defaults`}>
              <h3 id={`${titleId}-defaults`}>
                <button
                  type="button"
                  onClick={() => setBuiltinsExpanded((current) => !current)}
                  aria-expanded={builtinListExpanded}
                  aria-controls={`${dialogId}-builtin-list`}
                  className={cn(
                    "flex min-h-11 w-full min-w-0 items-center gap-2 rounded-lg px-2 text-left text-xs font-bold text-fg-2 hover:bg-raised hover:text-fg",
                    focusClass
                  )}
                >
                  {builtinListExpanded ? (
                    <ChevronDown
                      size={STUDIO_ICON_SIZE.contextMenu}
                      strokeWidth={STUDIO_ICON_STROKE}
                      aria-hidden
                      className={studioChromeIconClass({ tone: "default" })}
                    />
                  ) : (
                    <ChevronRight
                      size={STUDIO_ICON_SIZE.contextMenu}
                      strokeWidth={STUDIO_ICON_STROKE}
                      aria-hidden
                      className={studioChromeIconClass({ tone: "default" })}
                    />
                  )}
                  <span className="min-w-0 flex-1 truncate">기본 작업공간</span>
                  <span className={cn("inline-flex shrink-0 items-center gap-1 font-normal text-fg-3", AUXILIARY_TEXT_CLASS)}>
                    <LockKeyhole
                      size={STUDIO_ICON_SIZE.subtab}
                      strokeWidth={STUDIO_ICON_STROKE}
                      aria-hidden
                      className={studioChromeIconClass({ tone: "muted" })}
                    /> {filteredBuiltins.length}개 · 수정 불가
                  </span>
                </button>
              </h3>
              <div
                id={`${dialogId}-builtin-list`}
                hidden={!builtinListExpanded}
                className="mt-1.5 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-1"
              >
                {filteredBuiltins.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-line px-3 py-3 text-center text-xs text-fg-3">
                    일치하는 기본 작업공간이 없어요.
                  </p>
                ) : null}
                {filteredBuiltins.map((workspace) => {
                  const Icon = DEFAULT_WORKSPACE_ICONS[workspace.id];
                  const active = syncedState.activeWorkspaceId === workspace.id;
                  return (
                    <button
                      key={workspace.id}
                      type="button"
                      onClick={(event) => requestWorkspaceSwitch(workspace.id, event.currentTarget)}
                      disabled={active}
                      aria-current={active ? "true" : undefined}
                      aria-label={`${workspace.name}${active ? ", 현재 작업공간" : ", 작업공간으로 전환"}`}
                      data-workspace-kind="builtin"
                      data-workspace-id={workspace.id}
                      className={cn(
                        "flex min-h-11 w-full min-w-0 items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors pointer-coarse:min-h-11",
                        active
                          ? "border-accent/60 bg-accent-soft text-fg"
                          : "border-line bg-card text-fg-2 hover:border-line-strong hover:bg-raised",
                        "disabled:cursor-default disabled:opacity-100",
                        focusClass
                      )}
                      >
                      <span className={cn("grid size-8 shrink-0 place-items-center rounded-md bg-raised", active && "text-accent")}>
                        <Icon
                          size={STUDIO_ICON_SIZE.context}
                          strokeWidth={STUDIO_ICON_STROKE}
                          aria-hidden
                          className={studioChromeIconClass({ tone: "default" })}
                        />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex min-w-0 items-center gap-1.5 text-xs font-bold">
                          <span className="truncate">{workspace.name}</span>
                          {active ? (
                            <Check
                              size={STUDIO_ICON_SIZE.contextMenu}
                              strokeWidth={STUDIO_ICON_STROKE}
                              aria-hidden
                              className={studioChromeIconClass({ tone: "accent" })}
                            />
                          ) : null}
                        </span>
                        <span className="mt-0.5 block line-clamp-2 text-[0.6875rem] leading-snug text-fg-3">
                          {workspace.description}
                        </span>
                        {workspace.id === "pro-comic" ? (
                          <StudioProComicPresetPreview layout={workspace.layout} />
                        ) : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>

            <section
              hidden={view !== "switch"}
              aria-labelledby={`${titleId}-quick-custom`}
              data-workspace-view="switch"
            >
              <h3 id={`${titleId}-quick-custom`}>
                <button
                  type="button"
                  onClick={() => setCustomExpanded((current) => !current)}
                  aria-expanded={customListExpanded}
                  aria-controls={`${dialogId}-quick-custom-list`}
                  className={cn(
                    "flex min-h-11 w-full min-w-0 items-center gap-2 rounded-lg px-2 text-left text-xs font-bold text-fg-2 hover:bg-raised hover:text-fg",
                    focusClass
                  )}
                >
                  {customListExpanded ? (
                    <ChevronDown
                      size={STUDIO_ICON_SIZE.contextMenu}
                      strokeWidth={STUDIO_ICON_STROKE}
                      aria-hidden
                      className={studioChromeIconClass({ tone: "default" })}
                    />
                  ) : (
                    <ChevronRight
                      size={STUDIO_ICON_SIZE.contextMenu}
                      strokeWidth={STUDIO_ICON_STROKE}
                      aria-hidden
                      className={studioChromeIconClass({ tone: "default" })}
                    />
                  )}
                  <span className="min-w-0 flex-1 truncate">내 작업공간</span>
                  <span className={cn("shrink-0 tabular-nums font-normal text-fg-3", AUXILIARY_TEXT_CLASS)}>
                    {query
                      ? `${filteredCustom.length}/${syncedState.customWorkspaces.length}개`
                      : `${syncedState.customWorkspaces.length}개`}
                  </span>
                </button>
              </h3>
              <div
                id={`${dialogId}-quick-custom-list`}
                hidden={!customListExpanded}
                className="mt-1.5 space-y-1.5"
              >
                {syncedState.customWorkspaces.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-line px-3 py-3 text-center text-xs text-fg-3">
                    저장한 작업공간이 없어요. 관리에서 현재 배치를 저장할 수 있어요.
                  </p>
                ) : filteredCustom.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-line px-3 py-3 text-center text-xs text-fg-3">
                    일치하는 내 작업공간이 없어요.
                  </p>
                ) : (
                  filteredCustom.map((workspace) => {
                    const active = syncedState.activeWorkspaceId === workspace.id;
                    return (
                      <button
                        key={workspace.id}
                        type="button"
                        onClick={(event) =>
                          requestWorkspaceSwitch(workspace.id, event.currentTarget)
                        }
                        disabled={active}
                        aria-current={active ? "true" : undefined}
                        aria-label={`${workspace.name}${active ? ", 현재 작업공간" : ", 작업공간으로 전환"}`}
                        data-workspace-kind="custom-switch"
                        data-workspace-id={workspace.id}
                        className={cn(
                          "flex min-h-11 w-full min-w-0 items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors",
                          active
                            ? "border-accent/60 bg-accent-soft text-fg"
                            : "border-line bg-card text-fg-2 hover:border-line-strong hover:bg-raised",
                          "disabled:cursor-default disabled:opacity-100",
                          focusClass
                        )}
                      >
                        <LayoutPanelTop
                          size={STUDIO_ICON_SIZE.toolCompact}
                          strokeWidth={STUDIO_ICON_STROKE}
                          aria-hidden
                          className={studioChromeIconClass({
                            tone: "default",
                            active,
                          })}
                        />
                        <span className="min-w-0 flex-1 truncate text-xs font-bold">
                          {workspace.name}
                        </span>
                        {active ? (
                          <Check
                            size={STUDIO_ICON_SIZE.contextMenu}
                            strokeWidth={STUDIO_ICON_STROKE}
                            aria-hidden
                            className={studioChromeIconClass({ tone: "accent", active: true })}
                          />
                        ) : null}
                      </button>
                    );
                  })
                )}
              </div>
            </section>

            <section
              hidden={view !== "manage" || manageTab !== "catalog"}
              aria-labelledby={`${titleId}-custom`}
              data-workspace-view="manage-catalog"
            >
              <h3 id={`${titleId}-custom`}>
                <button
                  type="button"
                  onClick={() => setCustomExpanded((current) => !current)}
                  aria-expanded={customListExpanded}
                  aria-controls={`${dialogId}-custom-list`}
                  className={cn(
                    "flex min-h-11 w-full min-w-0 items-center gap-2 rounded-lg px-2 text-left text-xs font-bold text-fg-2 hover:bg-raised hover:text-fg",
                    focusClass
                  )}
                >
                  {customListExpanded ? (
                    <ChevronDown
                      size={STUDIO_ICON_SIZE.contextMenu}
                      strokeWidth={STUDIO_ICON_STROKE}
                      aria-hidden
                      className={studioChromeIconClass({ tone: "default" })}
                    />
                  ) : (
                    <ChevronRight
                      size={STUDIO_ICON_SIZE.contextMenu}
                      strokeWidth={STUDIO_ICON_STROKE}
                      aria-hidden
                      className={studioChromeIconClass({ tone: "default" })}
                    />
                  )}
                  <span className="min-w-0 flex-1 truncate">내 작업공간</span>
                  <span className={cn("shrink-0 tabular-nums font-normal text-fg-3", AUXILIARY_TEXT_CLASS)}>
                    {query
                      ? `${filteredCustom.length}/${syncedState.customWorkspaces.length}개`
                      : `${syncedState.customWorkspaces.length}/${STUDIO_WORKSPACE_MAX_CUSTOM}`}
                  </span>
                </button>
              </h3>

              <div id={`${dialogId}-custom-list`} hidden={!customListExpanded} className="mt-1.5">
                {reorderBlockedBySearch && syncedState.customWorkspaces.length > 1 ? (
                  <p role="status" className="mb-1.5 rounded-lg border border-line bg-raised px-3 py-2 text-[0.6875rem] text-fg-2">
                    전체 순서를 바꾸려면 검색어를 지워 주세요.
                  </p>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    setSaveFormOpen((current) => !current);
                    setRenameWorkspaceId(null);
                    setConfirmDeleteId(null);
                    setError(null);
                  }}
                  aria-expanded={saveFormOpen}
                  aria-controls={`${dialogId}-save-form`}
                  disabled={atCustomLimit}
                  className={cn(
                    "inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-lg border border-line px-3 text-xs font-bold text-fg-2 transition-colors hover:border-accent/50 hover:bg-accent-soft hover:text-fg disabled:cursor-not-allowed disabled:opacity-45 pointer-coarse:min-h-11 lg:min-h-9",
                    focusClass
                  )}
                >
                  <Save
                    size={STUDIO_ICON_SIZE.toolCompact}
                    strokeWidth={STUDIO_ICON_STROKE}
                    aria-hidden
                    className={studioChromeIconClass({ tone: "default" })}
                  /> 현재 배치를 새 작업공간으로 저장
                </button>

                <form
                  id={`${dialogId}-save-form`}
                  hidden={!saveFormOpen}
                  onSubmit={submitNewWorkspace}
                  className="mt-1.5 rounded-lg border border-accent/35 bg-accent-soft/40 p-2"
                >
                  <label htmlFor={`${dialogId}-new-name`} className="text-[0.6875rem] font-bold text-fg-2">
                    새 작업공간 이름
                  </label>
                  <input
                    ref={newNameInputRef}
                    id={`${dialogId}-new-name`}
                    value={newName}
                    onChange={(event) => setNewName(event.currentTarget.value)}
                    maxLength={STUDIO_WORKSPACE_NAME_MAX_LENGTH}
                    autoComplete="off"
                    placeholder="예: 야간 채색"
                    className={cn(
                      "mt-1 min-h-11 w-full rounded-lg border border-line bg-card px-3 text-sm text-fg outline-none placeholder:text-fg-3",
                      focusClass
                    )}
                  />
                  <div className="mt-2 grid min-w-0 grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setSaveFormOpen(false);
                        setNewName("");
                        setError(null);
                      }}
                      className={cn("min-h-11 min-w-0 rounded-lg text-xs font-bold text-fg-2 hover:bg-raised", focusClass)}
                    >
                      취소
                    </button>
                    <button
                      type="submit"
                      className={cn("min-h-11 min-w-0 rounded-lg bg-accent text-xs font-bold text-on-accent hover:bg-accent-2", focusClass)}
                    >
                      저장
                    </button>
                  </div>
                </form>

                {syncedState.customWorkspaces.length === 0 ? (
                  <div className="mt-1.5 rounded-lg border border-dashed border-line px-3 py-4 text-center">
                    <p className="text-xs font-semibold text-fg-2">저장한 작업공간이 없어요.</p>
                    <p className="mt-1 text-[0.6875rem] leading-relaxed text-fg-3">
                      현재 패널과 주요 도구 배치를 이름 붙여 다시 사용할 수 있어요.
                    </p>
                  </div>
                ) : filteredCustom.length === 0 ? (
                  <p className="mt-1.5 rounded-lg border border-dashed border-line px-3 py-3 text-center text-xs text-fg-3">
                    일치하는 내 작업공간이 없어요.
                  </p>
                ) : (
                  <div className="mt-1.5 space-y-1.5">
                    {filteredCustom.map((workspace) => {
                      const active = syncedState.activeWorkspaceId === workspace.id;
                      const actionsOpen = actionsWorkspaceId === workspace.id;
                      const renaming = renameWorkspaceId === workspace.id;
                      const confirmingDelete = confirmDeleteId === workspace.id;
                      const catalogIndex = syncedState.customWorkspaces.findIndex(
                        (candidate) => candidate.id === workspace.id
                      );
                      const canMoveUp = catalogIndex > 0;
                      const canMoveDown =
                        catalogIndex >= 0 &&
                        catalogIndex < syncedState.customWorkspaces.length - 1;
                      return (
                        <article
                          key={workspace.id}
                          className="min-w-0 rounded-lg border border-line bg-card"
                          data-workspace-kind="custom"
                          data-workspace-id={workspace.id}
                        >
                          <div className="flex min-w-0 items-stretch">
                            <button
                              type="button"
                              onClick={(event) => requestWorkspaceSwitch(workspace.id, event.currentTarget)}
                              disabled={active}
                              aria-current={active ? "true" : undefined}
                              aria-label={`${workspace.name}${active ? ", 현재 작업공간" : ", 작업공간으로 전환"}`}
                              className={cn(
                                "flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-l-lg px-3 py-2 text-left transition-colors hover:bg-raised pointer-coarse:min-h-11",
                                active && "bg-accent-soft/60 text-fg",
                                "disabled:cursor-default disabled:opacity-100",
                                focusClass
                              )}
                            >
                              <LayoutPanelTop
                                size={STUDIO_ICON_SIZE.toolCompact}
                                strokeWidth={STUDIO_ICON_STROKE}
                                aria-hidden
                                className={studioChromeIconClass({
                                  tone: "default",
                                  active,
                                })}
                              />
                              <span className="min-w-0 flex-1 truncate text-xs font-bold text-fg-2">
                                {workspace.name}
                              </span>
                              {active ? (
                                <span className="shrink-0 text-[0.6875rem] font-bold text-accent">
                                  {dirty ? "현재 · 변경됨" : "현재"}
                                </span>
                              ) : null}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setActionsWorkspaceId(actionsOpen ? null : workspace.id);
                                setRenameWorkspaceId(null);
                                setConfirmDeleteId(null);
                                setError(null);
                              }}
                              aria-label={`${workspace.name} 관리`}
                              aria-expanded={actionsOpen}
                              aria-controls={`${dialogId}-${workspace.id}-actions`}
                              aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                              data-workspace-manage-trigger={workspace.id}
                              className={cn(
                                "grid size-11 shrink-0 place-items-center rounded-r-lg border-l border-line text-fg-3 transition-colors hover:bg-raised hover:text-fg",
                                actionsOpen && "bg-raised text-fg",
                                focusClass
                              )}
                            >
                              <MoreHorizontal
                                size={STUDIO_ICON_SIZE.nav}
                                strokeWidth={STUDIO_ICON_STROKE}
                                aria-hidden
                                className={studioChromeIconClass({ tone: "default" })}
                              />
                            </button>
                          </div>

                          <div
                            id={`${dialogId}-${workspace.id}-actions`}
                            hidden={!actionsOpen}
                            className="min-w-0 border-t border-line p-2"
                          >
                            <div className="grid min-w-0 grid-cols-2 gap-1.5">
                              {active ? (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => overwriteWorkspace(workspace.id)}
                                    className={cn("inline-flex min-h-11 min-w-0 items-center justify-center gap-1.5 whitespace-normal rounded-lg bg-raised px-2 text-center text-[0.6875rem] font-bold leading-tight text-fg-2 hover:text-fg", focusClass)}
                                  >
                                    <Save
                                      size={STUDIO_ICON_SIZE.contextMenu}
                                      strokeWidth={STUDIO_ICON_STROKE}
                                      aria-hidden
                                      className={studioChromeIconClass({ tone: "default" })}
                                    /> 변경 저장
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(event) => reloadWorkspace(workspace.id, event.currentTarget)}
                                    className={cn("inline-flex min-h-11 min-w-0 items-center justify-center gap-1.5 whitespace-normal rounded-lg bg-raised px-2 text-center text-[0.6875rem] font-bold leading-tight text-fg-2 hover:text-fg", focusClass)}
                                  >
                                    <RotateCcw
                                      size={STUDIO_ICON_SIZE.contextMenu}
                                      strokeWidth={STUDIO_ICON_STROKE}
                                      aria-hidden
                                      className={studioChromeIconClass({ tone: "default" })}
                                    /> 다시 불러오기
                                  </button>
                                </>
                              ) : (
                                <button
                                  type="button"
                                  onClick={(event) => requestWorkspaceSwitch(workspace.id, event.currentTarget)}
                                  className={cn("col-span-2 inline-flex min-h-11 min-w-0 items-center justify-center gap-1.5 whitespace-normal rounded-lg bg-raised px-2 text-center text-[0.6875rem] font-bold leading-tight text-fg-2 hover:text-fg", focusClass)}
                                >
                                  <LayoutPanelTop
                                    size={STUDIO_ICON_SIZE.contextMenu}
                                    strokeWidth={STUDIO_ICON_STROKE}
                                    aria-hidden
                                    className={studioChromeIconClass({ tone: "default" })}
                                  /> 이 배치로 전환
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => beginRename(workspace.id, workspace.name)}
                                className={cn("inline-flex min-h-11 min-w-0 items-center justify-center gap-1.5 whitespace-normal rounded-lg bg-raised px-2 text-center text-[0.6875rem] font-bold leading-tight text-fg-2 hover:text-fg", focusClass)}
                              >
                                <PencilLine
                                  size={STUDIO_ICON_SIZE.contextMenu}
                                  strokeWidth={STUDIO_ICON_STROKE}
                                  aria-hidden
                                  className={studioChromeIconClass({ tone: "default" })}
                                /> 이름 변경
                              </button>
                              <button
                                type="button"
                                onClick={() => duplicateWorkspace(workspace.id)}
                                disabled={atCustomLimit}
                                aria-label={`${workspace.name} 저장된 배치 복제`}
                                className={cn(
                                  "inline-flex min-h-11 min-w-0 items-center justify-center gap-1.5 whitespace-normal rounded-lg bg-raised px-2 text-center text-[0.6875rem] font-bold leading-tight text-fg-2 hover:text-fg disabled:cursor-not-allowed disabled:opacity-45",
                                  focusClass
                                )}
                              >
                                <Copy
                                  size={STUDIO_ICON_SIZE.contextMenu}
                                  strokeWidth={STUDIO_ICON_STROKE}
                                  aria-hidden
                                  className={studioChromeIconClass({ tone: "default" })}
                                /> 저장 배치 복제
                              </button>
                              <button
                                type="button"
                                onClick={() => moveWorkspaceInCatalog(workspace.id, "up")}
                                disabled={!canMoveUp || reorderBlockedBySearch}
                                aria-label={`${workspace.name} 위로 이동`}
                                aria-keyshortcuts="Alt+ArrowUp"
                                className={cn(
                                  "inline-flex min-h-11 min-w-0 items-center justify-center gap-1.5 rounded-lg bg-raised px-2 text-[0.6875rem] font-bold text-fg-2 hover:text-fg disabled:cursor-not-allowed disabled:opacity-35",
                                  focusClass
                                )}
                              >
                                <ArrowUp
                                  size={STUDIO_ICON_SIZE.contextMenu}
                                  strokeWidth={STUDIO_ICON_STROKE}
                                  aria-hidden
                                  className={studioChromeIconClass({ tone: "default" })}
                                /> 위로
                              </button>
                              <button
                                type="button"
                                onClick={() => moveWorkspaceInCatalog(workspace.id, "down")}
                                disabled={!canMoveDown || reorderBlockedBySearch}
                                aria-label={`${workspace.name} 아래로 이동`}
                                aria-keyshortcuts="Alt+ArrowDown"
                                className={cn(
                                  "inline-flex min-h-11 min-w-0 items-center justify-center gap-1.5 rounded-lg bg-raised px-2 text-[0.6875rem] font-bold text-fg-2 hover:text-fg disabled:cursor-not-allowed disabled:opacity-35",
                                  focusClass
                                )}
                              >
                                <ArrowDown
                                  size={STUDIO_ICON_SIZE.contextMenu}
                                  strokeWidth={STUDIO_ICON_STROKE}
                                  aria-hidden
                                  className={studioChromeIconClass({ tone: "default" })}
                                /> 아래로
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setConfirmDeleteId(workspace.id);
                                  setRenameWorkspaceId(null);
                                  setError(null);
                                }}
                                className={cn("col-span-2 inline-flex min-h-11 min-w-0 items-center justify-center gap-1.5 whitespace-normal rounded-lg bg-bad/10 px-2 text-center text-[0.6875rem] font-bold leading-tight text-bad hover:bg-bad/15", focusClass)}
                              >
                                <Trash2
                                  size={STUDIO_ICON_SIZE.contextMenu}
                                  strokeWidth={STUDIO_ICON_STROKE}
                                  aria-hidden
                                  className={studioChromeIconClass({ tone: "danger" })}
                                /> 삭제
                              </button>
                            </div>

                            <form
                              hidden={!renaming}
                              onSubmit={submitRename}
                              className="mt-2 border-t border-line pt-2"
                            >
                              <label htmlFor={`${dialogId}-${workspace.id}-rename`} className="text-[0.6875rem] font-bold text-fg-2">
                                작업공간 이름 변경
                              </label>
                              <input
                                ref={renaming ? renameInputRef : undefined}
                                id={`${dialogId}-${workspace.id}-rename`}
                                value={renaming ? renameName : workspace.name}
                                onChange={(event) => setRenameName(event.currentTarget.value)}
                                maxLength={STUDIO_WORKSPACE_NAME_MAX_LENGTH}
                                autoComplete="off"
                                className={cn("mt-1 min-h-11 w-full rounded-lg border border-line bg-panel px-3 text-sm text-fg outline-none", focusClass)}
                              />
                              <div className="mt-1.5 grid min-w-0 grid-cols-2 gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setRenameWorkspaceId(null);
                                    setRenameName("");
                                    setError(null);
                                  }}
                                  className={cn("min-h-11 min-w-0 rounded-lg text-xs font-bold text-fg-2 hover:bg-raised", focusClass)}
                                >
                                  취소
                                </button>
                                <button
                                  type="submit"
                                  className={cn("min-h-11 min-w-0 rounded-lg bg-accent text-xs font-bold text-on-accent hover:bg-accent-2", focusClass)}
                                >
                                  이름 저장
                                </button>
                              </div>
                            </form>

                            <div
                              role="alert"
                              hidden={!confirmingDelete}
                              className="mt-2 border-t border-bad/25 pt-2"
                            >
                              <p className="text-[0.6875rem] leading-relaxed text-fg-2">
                                “{workspace.name}”을 삭제할까요? 원고 내용은 삭제되지 않아요.
                                {active && dirty ? " 저장하지 않은 배치 변경도 사라집니다." : ""}
                              </p>
                              <div className="mt-1.5 grid min-w-0 grid-cols-2 gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteId(null)}
                                  className={cn("min-h-11 min-w-0 rounded-lg text-xs font-bold text-fg-2 hover:bg-raised", focusClass)}
                                >
                                  유지
                                </button>
                                <button
                                  type="button"
                                  onClick={() => confirmDeleteWorkspace(workspace.id)}
                                  className={cn("min-h-11 min-w-0 rounded-lg bg-bad text-xs font-bold text-fg hover:brightness-110", focusClass)}
                                >
                                  작업공간 삭제
                                </button>
                              </div>
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </div>
            </section>

            <section
              hidden={view !== "manage" || manageTab !== "preferences"}
              aria-labelledby={`${titleId}-preferences`}
              data-workspace-view="manage-preferences"
            >
              <div className="mb-1.5 flex items-center gap-1.5 text-fg-2">
                <Settings2
                  size={STUDIO_ICON_SIZE.subtab}
                  strokeWidth={STUDIO_ICON_STROKE}
                  aria-hidden
                  className={studioChromeIconClass({ tone: "default" })}
                />
                <h3 id={`${titleId}-preferences`} className="text-[0.6875rem] font-bold">
                  전환 설정
                </h3>
              </div>
              <div className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-card">
                <button
                  type="button"
                  role="switch"
                  aria-checked={syncedState.applyQuickActionsOnSwitch}
                  aria-label={`주요 도구도 함께 전환: ${syncedState.applyQuickActionsOnSwitch ? "켬" : "끔"}`}
                  onClick={() =>
                    updateDevicePreferences({
                      applyQuickActionsOnSwitch:
                        !syncedState.applyQuickActionsOnSwitch,
                    })
                  }
                  className={cn("flex min-h-11 w-full items-center gap-3 px-3 py-2 text-left hover:bg-raised pointer-coarse:min-h-11", focusClass)}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-bold text-fg-2">주요 도구도 함께 전환</span>
                    <span className="mt-0.5 block text-[0.6875rem] leading-relaxed text-fg-3">
                      끄면 현재 6방향 퀵 액션 배치를 유지해요.
                    </span>
                  </span>
                  <span
                    aria-hidden
                    className={cn(
                      "relative h-5 w-9 shrink-0 rounded-full border transition-colors",
                      syncedState.applyQuickActionsOnSwitch
                        ? "border-accent bg-accent"
                        : "border-line-strong bg-raised"
                    )}
                  >
                    <span
                      className={cn(
                        "absolute top-0.5 size-3.5 rounded-full bg-fg transition-transform",
                        syncedState.applyQuickActionsOnSwitch
                          ? "translate-x-[1.125rem]"
                          : "translate-x-0.5"
                      )}
                    />
                  </span>
                </button>

                <div className="px-3 py-2">
                  <p className="text-xs font-bold text-fg-2">모바일 주요 도구 위치</p>
                  <p className="mt-0.5 text-[0.6875rem] text-fg-3">주로 쓰는 손에 가까운 쪽을 선택하세요.</p>
                  <div role="group" aria-label="모바일 주요 도구 위치" className="mt-2 grid min-w-0 grid-cols-2 gap-1.5">
                    {(["left", "right"] as const).map((side) => {
                      const selected = syncedState.mobileControlSide === side;
                      const Icon = side === "left" ? PanelLeft : PanelRight;
                      return (
                        <button
                          key={side}
                          type="button"
                          aria-pressed={selected}
                          aria-label={`모바일 주요 도구 ${side === "left" ? "왼쪽" : "오른쪽"} 배치`}
                          onClick={() => updateDevicePreferences({ mobileControlSide: side })}
                          className={cn(
                            "inline-flex min-h-11 min-w-0 items-center justify-center gap-1.5 rounded-lg border text-xs font-bold transition-colors pointer-coarse:min-h-11",
                            selected
                              ? "border-accent bg-accent-soft text-accent"
                              : "border-line bg-panel text-fg-2 hover:bg-raised",
                            focusClass
                          )}
                        >
                          <Icon
                            size={STUDIO_ICON_SIZE.subtab}
                            strokeWidth={STUDIO_ICON_STROKE}
                            aria-hidden
                            className={studioChromeIconClass({ tone: "default" })}
                          /> {side === "left" ? "왼쪽" : "오른쪽"}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="border-t border-line px-3 py-2">
                  <p className="text-xs font-bold text-fg-2">기기별 배치</p>
                  <p className="mt-0.5 text-[0.6875rem] text-fg-3">
                    {activeIsCustom
                      ? "저장된 배치는 그대로 두고, 기기마다 도크만 다르게 세웁니다."
                      : "기본 작업공간은 고칠 수 없어요. 복사본을 저장한 뒤 조정하세요."}
                  </p>
                  <div
                    role="group"
                    aria-label="조정할 기기"
                    className="mt-2 grid min-w-0 grid-cols-5 gap-1"
                  >
                    {STUDIO_WORKSPACE_DEVICE_KINDS.map((device) => {
                      const Icon = DEVICE_KIND_ICONS[device];
                      const selected = device === overrideDevice;
                      const overridden = Boolean(
                        activeWorkspace?.layout.deviceOverrides[device]
                      );
                      return (
                        <button
                          key={device}
                          type="button"
                          aria-pressed={selected}
                          aria-label={[
                            DEVICE_KIND_LABELS[device],
                            device === deviceKind ? "지금 이 기기" : null,
                            overridden ? "따로 조정됨" : "저장된 배치를 따름",
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                          onClick={() => setOverrideDevice(device)}
                          className={cn(
                            "relative inline-flex min-h-11 min-w-0 items-center justify-center rounded-lg border transition-colors pointer-coarse:min-h-11",
                            selected
                              ? "border-accent bg-accent-soft text-accent"
                              : "border-line bg-panel text-fg-2 hover:bg-raised",
                            focusClass
                          )}
                        >
                          <Icon
                            size={STUDIO_ICON_SIZE.subtab}
                            strokeWidth={STUDIO_ICON_STROKE}
                            aria-hidden
                            className={studioChromeIconClass({ tone: "default" })}
                          />
                          {overridden ? (
                            <span
                              aria-hidden
                              className="absolute right-1 top-1 size-1.5 rounded-full bg-accent"
                            />
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-1.5 text-[0.6875rem] text-fg-3">
                    {[
                      DEVICE_KIND_LABELS[overrideDevice],
                      overrideDevice === deviceKind ? "지금 이 기기" : null,
                      activeDeviceOverride ? "따로 조정됨" : "저장된 배치를 따름",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>

                  <div
                    role="group"
                    aria-label={`${DEVICE_KIND_LABELS[overrideDevice]} 주요 도구 위치`}
                    className="mt-2 grid min-w-0 grid-cols-3 gap-1.5"
                  >
                    {([null, "left", "right"] as const).map((side) => {
                      const selected = (activeDeviceOverride?.controlSide ?? null) === side;
                      const label =
                        side === null ? "기본" : side === "left" ? "왼쪽" : "오른쪽";
                      return (
                        <button
                          key={label}
                          type="button"
                          disabled={!activeIsCustom}
                          aria-pressed={selected}
                          aria-label={
                            side === null
                              ? `${DEVICE_KIND_LABELS[overrideDevice]}는 기본 손 위치를 따름`
                              : `${DEVICE_KIND_LABELS[overrideDevice]} 주요 도구 ${label} 배치`
                          }
                          onClick={() =>
                            changeDeviceOverride(
                              { controlSide: side },
                              `${DEVICE_KIND_LABELS[overrideDevice]} 손 위치를 ${label}으로 바꿨어요.`
                            )
                          }
                          className={cn(
                            "inline-flex min-h-11 min-w-0 items-center justify-center gap-1 rounded-lg border text-[0.6875rem] font-bold transition-colors pointer-coarse:min-h-11",
                            selected
                              ? "border-accent bg-accent-soft text-accent"
                              : "border-line bg-panel text-fg-2 hover:bg-raised",
                            "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-panel",
                            focusClass
                          )}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>

                  <div className="mt-1.5 grid min-w-0 grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      disabled={!activeIsCustom}
                      onClick={() =>
                        changeDeviceOverride(
                          // 화면에 실제로 서 있는 기하 — liveLayout 은 저자형이라 .desktop 을 그대로
                          // 쓰면 지금 보이는 도크가 아니라 저술된 도크를 집는다.
                          {
                            desktop: resolveStudioWorkspaceDeviceLayout(liveLayout, deviceKind)
                              .desktop,
                          },
                          `지금 도크 배치를 ${DEVICE_KIND_LABELS[overrideDevice]} 값으로 저장했어요.`
                        )
                      }
                      className={cn(
                        "inline-flex min-h-11 min-w-0 items-center justify-center gap-1.5 rounded-lg border border-line bg-panel text-[0.6875rem] font-bold text-fg-2 transition-colors hover:bg-raised pointer-coarse:min-h-11",
                        "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-panel",
                        focusClass
                      )}
                    >
                      <Save
                        size={STUDIO_ICON_SIZE.contextMenu}
                        strokeWidth={STUDIO_ICON_STROKE}
                        aria-hidden
                        className={studioChromeIconClass({ tone: "default" })}
                      /> 지금 도크로
                    </button>
                    <button
                      type="button"
                      disabled={!activeIsCustom || !activeDeviceOverride}
                      onClick={() =>
                        changeDeviceOverride(
                          null,
                          `${DEVICE_KIND_LABELS[overrideDevice]} 조정을 지웠어요.`
                        )
                      }
                      className={cn(
                        "inline-flex min-h-11 min-w-0 items-center justify-center gap-1.5 rounded-lg border border-line bg-panel text-[0.6875rem] font-bold text-fg-2 transition-colors hover:bg-raised pointer-coarse:min-h-11",
                        "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-panel",
                        focusClass
                      )}
                    >
                      <RotateCcw
                        size={STUDIO_ICON_SIZE.contextMenu}
                        strokeWidth={STUDIO_ICON_STROKE}
                        aria-hidden
                        className={studioChromeIconClass({ tone: "default" })}
                      /> 조정 지우기
                    </button>
                  </div>
                </div>
              </div>
            </section>
          </div>

          <footer
            className={cn(
              "shrink-0 space-y-2 border-t px-3 py-2.5",
              effectivePersistence.status === "persisted"
                ? "border-line bg-card/70"
                : effectivePersistence.failure
                  ? "border-warn/30 bg-warn/5"
                  : "border-line bg-card/70"
            )}
          >
            <button
              ref={manageEntryRef}
              type="button"
              hidden={view !== "switch"}
              onClick={openWorkspaceManager}
              aria-controls={`${dialogId}-management-tabs`}
              className={cn(
                "flex min-h-11 w-full min-w-0 items-center gap-2 rounded-lg border border-line bg-panel px-3 text-left text-xs font-bold text-fg-2 hover:border-accent/40 hover:bg-raised hover:text-fg",
                focusClass
              )}
            >
              <Settings2
                size={STUDIO_ICON_SIZE.toolCompact}
                strokeWidth={STUDIO_ICON_STROKE}
                aria-hidden
                className={studioChromeIconClass({ tone: "default" })}
              />
              <span className="min-w-0 flex-1 truncate">작업공간 관리</span>
              <ChevronRight
                size={STUDIO_ICON_SIZE.contextMenu}
                strokeWidth={STUDIO_ICON_STROKE}
                aria-hidden
                className={studioChromeIconClass({ tone: "default" })}
              />
            </button>
            <p
              role="status"
              className={cn(
                "text-[0.6875rem] leading-relaxed",
                effectivePersistence.status === "session-only" && effectivePersistence.failure
                  ? "text-warn"
                  : "text-fg-3"
              )}
            >
              {effectivePersistence.status === "persisted"
                ? "이 기기 저장 확인됨"
                : effectivePersistence.failure
                  ? `${persistenceFailureText(effectivePersistence.failure)} 이 세션에서만 유지`
                  : "아직 이 기기에 저장되지 않음 · 변경하면 저장 여부 확인"}
              {" · "}현재 브라우저와 계정 범위 · 원고와 AI 설정은 포함하지 않아요.
            </p>
          </footer>
        </div>

        <div
          ref={switchGuardRef}
          role="alertdialog"
          aria-modal="true"
          aria-labelledby={switchGuardTitleId}
          aria-describedby={switchGuardDescriptionId}
          tabIndex={-1}
          hidden={!pendingWorkspaceId}
          className="absolute inset-0 z-10 grid place-items-center overflow-y-auto overscroll-contain bg-canvas/85 p-3"
          data-testid="studio-workspace-switch-guard"
        >
          <div className="w-full max-w-sm rounded-lg border border-line-strong bg-panel p-4 shadow-xl">
            <span className="grid size-9 place-items-center rounded-lg bg-warn/15 text-warn">
              <Save
                size={STUDIO_ICON_SIZE.nav}
                strokeWidth={STUDIO_ICON_STROKE}
                aria-hidden
                                  className={studioChromeIconClass({ tone: "danger" })}
              />
            </span>
            <h3 id={switchGuardTitleId} className="mt-3 text-sm font-bold text-fg">
              변경을 저장하고 전환할까요?
            </h3>
            <p id={switchGuardDescriptionId} className="mt-1.5 text-xs leading-relaxed text-fg-2">
              “{activeWorkspace?.name ?? "현재 작업공간"}”의 배치가 변경되었습니다. “{pendingWorkspace?.name ?? "선택한 작업공간"}”(으)로 전환하기 전에 저장 방법을 선택하세요.
            </p>
            {!activeIsCustom ? (
              <p className="mt-2 text-[0.6875rem] leading-relaxed text-fg-3">
                기본 작업공간은 수정할 수 없어 “{createStudioWorkspaceCopyName(activeWorkspace?.name ?? "작업공간")}”으로 저장합니다.
              </p>
            ) : null}
            <div className="mt-4 grid min-w-0 gap-1.5">
              <button
                ref={switchGuardCancelRef}
                type="button"
                onClick={cancelPendingSwitch}
                className={cn("min-h-11 min-w-0 rounded-lg border border-line text-xs font-bold text-fg-2 hover:bg-raised hover:text-fg", focusClass)}
              >
                취소
              </button>
              <button
                type="button"
                onClick={discardAndSwitch}
                className={cn("min-h-11 min-w-0 rounded-lg border border-warn/40 bg-warn/10 px-3 text-xs font-bold text-warn hover:bg-warn/15", focusClass)}
              >
                저장하지 않고 전환
              </button>
              <button
                type="button"
                onClick={saveAndSwitch}
                disabled={!activeIsCustom && atCustomLimit}
                aria-describedby={!activeIsCustom && atCustomLimit ? `${switchGuardDescriptionId}-limit` : undefined}
                className={cn("min-h-11 min-w-0 rounded-lg bg-accent px-3 text-xs font-bold text-on-accent hover:bg-accent-2 disabled:cursor-not-allowed disabled:opacity-45", focusClass)}
              >
                {activeIsCustom ? "변경 저장 후 전환" : "사본 저장 후 전환"}
              </button>
            </div>
            {!activeIsCustom && atCustomLimit ? (
              <p id={`${switchGuardDescriptionId}-limit`} className="mt-2 text-[0.6875rem] leading-relaxed text-warn">
                내 작업공간이 24개라 사본을 만들 수 없어요. 취소한 뒤 하나를 삭제하거나 저장하지 않고 전환하세요.
              </p>
            ) : null}
            <p className="mt-3 text-[0.6875rem] text-fg-3">Esc를 누르면 전환을 취소합니다.</p>
          </div>
        </div>
        </section>
      </StudioWorkspaceOverlayLayer>
    </div>
  );
}
