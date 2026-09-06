import {
  DEFAULT_STUDIO_DRAWING_PALETTE_LAYOUT,
  normalizeStudioDrawingPaletteLayout,
  type StudioDrawingPaletteLayout,
} from "./brush/studio-drawing-palettes";
import {
  DEFAULT_STUDIO_INSPECTOR_LAYOUT,
  STUDIO_INSPECTOR_LAYOUT_STORAGE_KEY,
  STUDIO_DOCUMENT_INSPECTOR_SECTIONS,
  STUDIO_IMAGE_INSPECTOR_SECTIONS,
  STUDIO_INSPECTOR_PRIMARY_SECTIONS,
  normalizeStudioInspectorLayout,
  type StudioInspectorLayout,
} from "./studio-inspector-layout";
import {
  DEFAULT_STUDIO_QUICK_ACTIONS,
  QUICK_ACTION_IDS,
  QUICK_ACTION_SLOTS,
  STUDIO_QUICK_ACTIONS_STORAGE_KEY,
  normalizeStudioQuickActionsPreferences,
  type StudioQuickActionId,
  type StudioQuickActionsPreferences,
} from "./studio-quick-actions";
import {
  STUDIO_WORKSPACE_LEFT_PANEL_DEFAULT_WIDTH,
  STUDIO_WORKSPACE_LEFT_PANEL_MAX_WIDTH,
  STUDIO_WORKSPACE_LEFT_PANEL_MIN_WIDTH,
  STUDIO_WORKSPACE_RIGHT_PANEL_DEFAULT_WIDTH,
  STUDIO_WORKSPACE_RIGHT_PANEL_MAX_WIDTH,
  STUDIO_WORKSPACE_RIGHT_PANEL_MIN_WIDTH,
} from "./studio-workspace-layout-metrics";

export {
  DEFAULT_STUDIO_DRAWING_PALETTE_LAYOUT,
  STUDIO_DRAWING_PALETTE_MAX_PERCENT,
  STUDIO_DRAWING_PALETTE_MIN_PERCENT,
  moveStudioDrawingPalette,
  normalizeStudioDrawingPaletteLayout,
  resizeStudioDrawingPalettes,
  toggleStudioDrawingPalette,
} from "./brush/studio-drawing-palettes";
export type {
  StudioCanonicalDrawingPaletteLayout,
  StudioDrawingPaletteId,
  StudioDrawingPaletteLayout,
  StudioDrawingPaletteLockKind,
  StudioDrawingPaletteLocks,
  StudioDrawingPaletteLockState,
  StudioDrawingPaletteMoveDirection,
} from "./brush/studio-drawing-palettes";

/**
 * Studio workspace persistence intentionally contains UI layout only.
 *
 * Project content, asset payloads, AI requests, provider settings, and credentials do not belong in
 * this model. Normalization rebuilds a field allowlist, so unrelated keys from untrusted storage are
 * discarded before the value can be returned or saved again.
 */

export const STUDIO_WORKSPACE_STATE_VERSION = 4 as const;
/**
 * Compatibility-envelope version for explicitly injected test/rollback adapters.
 * Product code never selects this browser-KV seam; SQLite/OPFS owns V12 workspaces.
 */
export const STUDIO_WORKSPACE_PAYLOAD_VERSION = 4 as const;
export const STUDIO_WORKSPACE_MAX_CUSTOM = 24;
export const STUDIO_WORKSPACE_NAME_MAX_LENGTH = 48;
export const STUDIO_WORKSPACE_RAW_MAX_BYTES = 64 * 1024;
/** @deprecated Explicit compatibility seam only; not a product authority. */
export const STUDIO_WORKSPACE_STORAGE_KEY = "toonspectrum:studio:workspaces-v12";
export const STUDIO_WORKSPACE_LEFT_PANEL_WIDTH = Object.freeze({
  minimum: STUDIO_WORKSPACE_LEFT_PANEL_MIN_WIDTH,
  default: STUDIO_WORKSPACE_LEFT_PANEL_DEFAULT_WIDTH,
  maximum: STUDIO_WORKSPACE_LEFT_PANEL_MAX_WIDTH,
});
export const STUDIO_WORKSPACE_RIGHT_PANEL_WIDTH = Object.freeze({
  minimum: STUDIO_WORKSPACE_RIGHT_PANEL_MIN_WIDTH,
  default: STUDIO_WORKSPACE_RIGHT_PANEL_DEFAULT_WIDTH,
  maximum: STUDIO_WORKSPACE_RIGHT_PANEL_MAX_WIDTH,
});

export const STUDIO_LEGACY_LEFT_PANEL_WIDTH_STORAGE_KEY = "studio:leftW";
export const STUDIO_LEGACY_RIGHT_PANEL_WIDTH_STORAGE_KEY = "studio:rightW";

/** The original six presets remain stable for existing shortcuts, help copy, and saved state. */
export const STUDIO_CLASSIC_WORKSPACE_IDS = [
  "storyboard",
  "lineart",
  "coloring",
  "lettering",
  "review",
  "publish",
] as const;

/**
 * Workspaces added for the twelve-profile catalogue.
 *
 * The seven ids above are never renamed or dropped: a saved `activeWorkspaceId` and every custom
 * workspace derived from one of them must keep resolving after this expansion.
 */
export const STUDIO_EXPANDED_WORKSPACE_IDS = [
  "quick-sketch",
  "csp-migration",
  "pen-display",
  "mobile-draw",
  "photo-edit",
  "vector-design",
  "animation",
  "pose-3d",
] as const;

export const STUDIO_DEFAULT_WORKSPACE_IDS = [
  ...STUDIO_CLASSIC_WORKSPACE_IDS,
  "pro-comic",
  ...STUDIO_EXPANDED_WORKSPACE_IDS,
] as const;

/**
 * Input surfaces a workspace may adapt to.
 *
 * `keyboard` is a genuine surface here rather than a pointing device: a keyboard-driven session
 * navigates by shortcut and wants both docks visible, where a pointer-driven one trades dock width
 * for canvas. The list is closed so persisted overrides can be validated against it.
 */
export const STUDIO_WORKSPACE_DEVICE_KINDS = [
  "pen-display",
  "mobile",
  "keyboard",
  "mouse",
  "touch",
] as const;

export const STUDIO_PRO_COMIC_PALETTE_PRIORITY = [
  "tool-properties",
  "layers",
  "pages",
  "materials-quick-access",
] as const;

export type StudioClassicWorkspaceId = (typeof STUDIO_CLASSIC_WORKSPACE_IDS)[number];
export const STUDIO_MOBILE_CONTROL_SIDES = ["left", "right"] as const;

export type StudioExpandedWorkspaceId = (typeof STUDIO_EXPANDED_WORKSPACE_IDS)[number];
export type StudioDefaultWorkspaceId = (typeof STUDIO_DEFAULT_WORKSPACE_IDS)[number];
export type StudioProComicPalettePriority =
  (typeof STUDIO_PRO_COMIC_PALETTE_PRIORITY)[number];
export type StudioMobileControlSide = (typeof STUDIO_MOBILE_CONTROL_SIDES)[number];
export type StudioWorkspaceDeviceKind = (typeof STUDIO_WORKSPACE_DEVICE_KINDS)[number];
export type StudioWorkspaceId = StudioDefaultWorkspaceId | string;
export type StudioWorkspaceMoveDirection = "up" | "down";
export type StudioWorkspaceLaunchSurface =
  | "vector-design"
  | "animation"
  | "pose-3d";

const STUDIO_WORKSPACE_LAUNCH_SURFACES = Object.freeze({
  "vector-design": "vector-design",
  animation: "animation",
  "pose-3d": "pose-3d",
} as const satisfies Partial<Record<StudioDefaultWorkspaceId, StudioWorkspaceLaunchSurface>>);

/**
 * Returns the concrete production surface a built-in workspace must open after its dock layout is
 * applied. Most workspaces need no one-shot surface; custom ids deliberately return null.
 */
export function studioWorkspaceLaunchSurface(
  workspaceId: StudioWorkspaceId,
): StudioWorkspaceLaunchSurface | null {
  return Object.prototype.hasOwnProperty.call(STUDIO_WORKSPACE_LAUNCH_SURFACES, workspaceId)
    ? STUDIO_WORKSPACE_LAUNCH_SURFACES[
        workspaceId as keyof typeof STUDIO_WORKSPACE_LAUNCH_SURFACES
      ]
    : null;
}

/* ------------------------------------------------------------- command bar */

/**
 * Menubar command bar (§15.3 Window ▸ Action Bar — CSP 커맨드 바 parity).
 *
 * Same shape of pure preference model as `studio-quick-actions.ts`: a fixed slot list, a closed
 * command vocabulary, per-slot recovery from untrusted storage. Every command id here maps onto an
 * executor seam the menubar already owns — the bar never grows its own dispatch path.
 */
export const STUDIO_COMMAND_BAR_SLOT_COUNT = 8;

export const STUDIO_COMMAND_BAR_COMMAND_IDS = [
  "undo",
  "redo",
  "save",
  "publish",
  "download",
  "export-open",
  "zoom-fit",
  "assets",
  "bubbles",
  "project",
] as const;

export type StudioCommandBarCommandId = (typeof STUDIO_COMMAND_BAR_COMMAND_IDS)[number];
/** `null` is an intentionally empty slot, preserved so custom arrangements keep their spacing. */
export type StudioCommandBarSlot = StudioCommandBarCommandId | null;

export interface StudioCommandBarPreferences {
  readonly version: 1;
  /** Whether the slot strip renders. The fixed history/customize controls stay regardless. */
  readonly visible: boolean;
  /** Always exactly `STUDIO_COMMAND_BAR_SLOT_COUNT` entries after normalization. */
  readonly slots: readonly StudioCommandBarSlot[];
}

const COMMAND_BAR_COMMAND_ID_SET = new Set<string>(STUDIO_COMMAND_BAR_COMMAND_IDS);

function freezeCommandBar(
  preferences: StudioCommandBarPreferences
): StudioCommandBarPreferences {
  return Object.freeze({
    version: 1,
    visible: preferences.visible,
    slots: Object.freeze([...preferences.slots]),
  });
}

export const DEFAULT_STUDIO_COMMAND_BAR: StudioCommandBarPreferences = freezeCommandBar({
  version: 1,
  visible: true,
  slots: ["undo", "redo", "save", "export-open", "zoom-fit", null, null, null],
});

/**
 * Normalizes untrusted command bar preferences. Slots recover field by field — one corrupt slot
 * never discards the rest of a customization — and the list is always rebuilt to exactly
 * `STUDIO_COMMAND_BAR_SLOT_COUNT` entries. Duplicate commands across slots are preserved.
 */
export function normalizeStudioCommandBarPreferences(
  raw: unknown,
  fallback: StudioCommandBarPreferences = DEFAULT_STUDIO_COMMAND_BAR
): StudioCommandBarPreferences {
  if (!isRecord(raw) || raw.version !== 1) return freezeCommandBar(fallback);
  const rawSlots = Array.isArray(raw.slots) ? raw.slots : null;
  const slots: StudioCommandBarSlot[] = [];
  for (let index = 0; index < STUDIO_COMMAND_BAR_SLOT_COUNT; index += 1) {
    const candidate = rawSlots?.[index];
    if (candidate === null) {
      slots.push(null);
    } else if (
      typeof candidate === "string"
      && COMMAND_BAR_COMMAND_ID_SET.has(candidate)
    ) {
      slots.push(candidate as StudioCommandBarCommandId);
    } else {
      slots.push(fallback.slots[index] ?? null);
    }
  }
  return freezeCommandBar({
    version: 1,
    visible: typeof raw.visible === "boolean" ? raw.visible : fallback.visible,
    slots,
  });
}

/** Returns new preferences with one slot replaced. The input and its slots stay untouched. */
export function updateStudioCommandBarSlot(
  preferences: StudioCommandBarPreferences,
  slotIndex: number,
  command: StudioCommandBarSlot
): StudioCommandBarPreferences {
  if (
    !Number.isInteger(slotIndex)
    || slotIndex < 0
    || slotIndex >= STUDIO_COMMAND_BAR_SLOT_COUNT
  ) {
    throw new RangeError(`Studio command bar slot index is out of range: ${slotIndex}`);
  }
  if (command !== null && !COMMAND_BAR_COMMAND_ID_SET.has(command)) {
    throw new TypeError(`Unknown Studio command bar command: ${String(command)}`);
  }
  const normalized = normalizeStudioCommandBarPreferences(preferences);
  const slots = [...normalized.slots];
  slots[slotIndex] = command;
  return freezeCommandBar({ version: 1, visible: normalized.visible, slots });
}

/** Returns new preferences with visibility set; identical visibility returns the normalized input. */
export function setStudioCommandBarVisible(
  preferences: StudioCommandBarPreferences,
  visible: boolean
): StudioCommandBarPreferences {
  const normalized = normalizeStudioCommandBarPreferences(preferences);
  if (normalized.visible === visible) return normalized;
  return freezeCommandBar({ version: 1, visible, slots: [...normalized.slots] });
}

export interface StudioWorkspaceDesktopLayout {
  readonly leftPanelOpen: boolean;
  readonly rightPanelOpen: boolean;
  readonly leftPanelWidth: number;
  readonly rightPanelWidth: number;
}

/**
 * What one input surface may change about a workspace.
 *
 * Deliberately only the dock geometry and the handedness of the on-canvas controls. Inspector
 * sections, palette order and quick actions stay device-independent so a workspace keeps one
 * muscle memory wherever it is opened; a pen display and a laptop differ in how much room the
 * hand needs, not in which tool lives where.
 */
export interface StudioWorkspaceDeviceOverride {
  readonly desktop: StudioWorkspaceDesktopLayout;
  /** `null` inherits `StudioWorkspaceState.mobileControlSide`. */
  readonly controlSide: StudioMobileControlSide | null;
}

export type StudioWorkspaceDeviceOverrides = Readonly<
  Partial<Record<StudioWorkspaceDeviceKind, StudioWorkspaceDeviceOverride>>
>;

export interface StudioWorkspaceLayout {
  readonly inspector: StudioInspectorLayout;
  readonly desktop: StudioWorkspaceDesktopLayout;
  readonly drawingPalettes: StudioDrawingPaletteLayout;
  readonly quickActions: StudioQuickActionsPreferences;
  /**
   * Menubar command bar — app chrome that rides in the live layout. Device-independent like
   * `quickActions`, so it never folds into `deviceOverrides` and the authored-form invariant
   * holds untouched. Optional only because pre-command-bar payloads and layout literals omit it;
   * every normalized layout carries it (see `normalizeWorkspaceLayout`).
   */
  readonly commandBar?: StudioCommandBarPreferences;
  /** Absent devices fall through to `desktop`; an empty map is the documented default. */
  readonly deviceOverrides: StudioWorkspaceDeviceOverrides;
}

/** Runtime signals a caller can observe without importing any workspace state. */
export interface StudioWorkspaceDeviceSignals {
  /** `PointerEvent.pointerType` of the most recent input, when one is known. */
  readonly pointerType?: "pen" | "touch" | "mouse" | "unknown" | null;
  /** `(pointer: coarse)` — a finger-sized primary pointer. */
  readonly coarsePointer?: boolean;
  readonly maxTouchPoints?: number;
  readonly viewportWidth?: number;
  /** True while the session is being driven by keyboard navigation. */
  readonly keyboardDriven?: boolean;
}

export interface StudioDefaultWorkspace {
  readonly id: StudioDefaultWorkspaceId;
  readonly name: string;
  readonly description: string;
  readonly layout: StudioWorkspaceLayout;
}

export interface StudioCustomWorkspace {
  readonly id: string;
  readonly name: string;
  readonly layout: StudioWorkspaceLayout;
}

export interface StudioWorkspaceState {
  readonly version: typeof STUDIO_WORKSPACE_STATE_VERSION;
  readonly activeWorkspaceId: StudioWorkspaceId;
  readonly liveLayout: StudioWorkspaceLayout;
  readonly customWorkspaces: readonly StudioCustomWorkspace[];
  readonly mobileControlSide: StudioMobileControlSide;
  readonly applyQuickActionsOnSwitch: boolean;
}

/**
 * @deprecated Explicitly injected compatibility codec used by tests and emergency rollback only.
 * The product runtime never obtains ambient localStorage through this interface.
 */
export interface StudioWorkspaceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export type StudioWorkspaceLoadStorage = Pick<StudioWorkspaceStorage, "getItem"> &
  Partial<Pick<StudioWorkspaceStorage, "setItem" | "removeItem">>;

export interface StudioWorkspaceMigrationInput {
  readonly inspector?: unknown;
  readonly quickActions?: unknown;
  readonly leftPanelOpen?: unknown;
  readonly rightPanelOpen?: unknown;
  readonly leftPanelWidth?: unknown;
  readonly rightPanelWidth?: unknown;
  readonly mobileControlSide?: unknown;
  readonly applyQuickActionsOnSwitch?: unknown;
}

export type StudioWorkspacePersistenceStatus = "persisted" | "session-only";
export type StudioWorkspacePersistenceFailure =
  | "storage-unavailable"
  | "ownership-busy"
  | "read-failed"
  | "write-failed"
  | "verification-failed"
  | "owner-mismatch"
  | "invalid-payload"
  | "payload-too-large";

export interface StudioWorkspaceSaveResult {
  readonly state: StudioWorkspaceState;
  readonly ownerScope: string;
  readonly status: StudioWorkspacePersistenceStatus;
  readonly failure: StudioWorkspacePersistenceFailure | null;
}

export type StudioWorkspaceLoadSource =
  | "current"
  | "legacy-v1"
  | "legacy-v2"
  | "legacy-preferences"
  | "default";

export interface StudioWorkspaceLoadResult {
  readonly state: StudioWorkspaceState;
  readonly ownerScope: string;
  readonly source: StudioWorkspaceLoadSource;
  /** Whether an accepted value already resides under the stable owner key. */
  readonly status: StudioWorkspacePersistenceStatus;
  readonly failure: StudioWorkspacePersistenceFailure | null;
}

/** @deprecated Compatibility adapter guard; product writes use StudioWorkspacePersistenceRuntime. */
export interface StudioWorkspaceSaveOptions {
  readonly sourceOwnerScope?: string;
}

const LEGACY_V1_STORAGE_PREFIX = "toonspectrum-studio-workspaces:v1";
const WORKSPACE_ENVELOPE_KIND = "toonspectrum.studio-workspaces";
const STORAGE_KEY_MAX_LENGTH = 160;
const CUSTOM_ID_MAX_LENGTH = 80;
const CUSTOM_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~-]*$/u;

const DEFAULT_ID_SET = new Set<string>(STUDIO_DEFAULT_WORKSPACE_IDS);
const PRIMARY_SECTION_SET = new Set<string>(STUDIO_INSPECTOR_PRIMARY_SECTIONS);
const IMAGE_SECTION_SET = new Set<string>(STUDIO_IMAGE_INSPECTOR_SECTIONS);
const DOCUMENT_SECTION_SET = new Set<string>(STUDIO_DOCUMENT_INSPECTOR_SECTIONS);
const QUICK_ACTION_ID_SET = new Set<string>(QUICK_ACTION_IDS);
const MOBILE_CONTROL_SIDE_SET = new Set<string>(STUDIO_MOBILE_CONTROL_SIDES);
const EMPTY_DEVICE_OVERRIDES: StudioWorkspaceDeviceOverrides = Object.freeze({});
const STATE_OWNER_SCOPES = new WeakMap<object, string>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clampPanelWidth(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

function normalizeDesktopLayout(
  value: unknown,
  fallback: StudioWorkspaceDesktopLayout
): StudioWorkspaceDesktopLayout {
  if (!isRecord(value)) return Object.freeze({ ...fallback });
  return Object.freeze({
    leftPanelOpen:
      typeof value.leftPanelOpen === "boolean"
        ? value.leftPanelOpen
        : fallback.leftPanelOpen,
    rightPanelOpen:
      typeof value.rightPanelOpen === "boolean"
        ? value.rightPanelOpen
        : fallback.rightPanelOpen,
    leftPanelWidth: clampPanelWidth(
      value.leftPanelWidth,
      fallback.leftPanelWidth,
      STUDIO_WORKSPACE_LEFT_PANEL_WIDTH.minimum,
      STUDIO_WORKSPACE_LEFT_PANEL_WIDTH.maximum
    ),
    rightPanelWidth: clampPanelWidth(
      value.rightPanelWidth,
      fallback.rightPanelWidth,
      STUDIO_WORKSPACE_RIGHT_PANEL_WIDTH.minimum,
      STUDIO_WORKSPACE_RIGHT_PANEL_WIDTH.maximum
    ),
  });
}

function normalizeDeviceOverrides(
  value: unknown,
  fallbackDesktop: StudioWorkspaceDesktopLayout,
): StudioWorkspaceDeviceOverrides {
  if (!isRecord(value)) return EMPTY_DEVICE_OVERRIDES;
  const overrides: Record<string, StudioWorkspaceDeviceOverride> = {};
  // Iterating the closed device list (not the payload's own keys) keeps an untrusted payload from
  // introducing a device this build does not understand.
  for (const device of STUDIO_WORKSPACE_DEVICE_KINDS) {
    const candidate = value[device];
    if (!isRecord(candidate)) continue;
    const controlSide =
      typeof candidate.controlSide === "string"
      && MOBILE_CONTROL_SIDE_SET.has(candidate.controlSide)
        ? (candidate.controlSide as StudioMobileControlSide)
        : null;
    overrides[device] = Object.freeze({
      desktop: normalizeDesktopLayout(candidate.desktop, fallbackDesktop),
      controlSide,
    });
  }
  return Object.freeze(overrides);
}

function freezeDeviceOverrides(
  overrides: StudioWorkspaceDeviceOverrides | undefined,
  fallbackDesktop: StudioWorkspaceDesktopLayout,
): StudioWorkspaceDeviceOverrides {
  return overrides ? normalizeDeviceOverrides(overrides, fallbackDesktop) : EMPTY_DEVICE_OVERRIDES;
}

function freezeInspector(layout: StudioInspectorLayout): StudioInspectorLayout {
  return Object.freeze({ ...layout });
}

function freezeQuickActions(
  preferences: StudioQuickActionsPreferences
): StudioQuickActionsPreferences {
  return Object.freeze({
    version: 1,
    slots: Object.freeze({ ...preferences.slots }),
  });
}

function freezeLayout(layout: StudioWorkspaceLayout): StudioWorkspaceLayout {
  const desktop = normalizeDesktopLayout(layout.desktop, {
    leftPanelOpen: true,
    rightPanelOpen: true,
    leftPanelWidth: STUDIO_WORKSPACE_LEFT_PANEL_WIDTH.default,
    rightPanelWidth: STUDIO_WORKSPACE_RIGHT_PANEL_WIDTH.default,
  });
  return Object.freeze({
    inspector: freezeInspector(layout.inspector),
    desktop,
    drawingPalettes: normalizeStudioDrawingPaletteLayout(
      layout.drawingPalettes,
    ),
    quickActions: freezeQuickActions(layout.quickActions),
    commandBar: freezeCommandBar(layout.commandBar ?? DEFAULT_STUDIO_COMMAND_BAR),
    deviceOverrides: freezeDeviceOverrides(layout.deviceOverrides, desktop),
  });
}

function createQuickActions(
  actions: readonly [
    StudioQuickActionId,
    StudioQuickActionId,
    StudioQuickActionId,
    StudioQuickActionId,
    StudioQuickActionId,
    StudioQuickActionId,
  ]
): StudioQuickActionsPreferences {
  return freezeQuickActions({
    version: 1,
    slots: {
      north: actions[0],
      northEast: actions[1],
      southEast: actions[2],
      south: actions[3],
      southWest: actions[4],
      northWest: actions[5],
    },
  });
}

type BuiltinDesktop =
  Pick<StudioWorkspaceDesktopLayout, "leftPanelOpen" | "rightPanelOpen">
  & Partial<Pick<StudioWorkspaceDesktopLayout, "leftPanelWidth" | "rightPanelWidth">>;

function builtinDesktop(desktop: BuiltinDesktop): StudioWorkspaceDesktopLayout {
  return {
    ...desktop,
    leftPanelWidth:
      desktop.leftPanelWidth ?? STUDIO_WORKSPACE_LEFT_PANEL_WIDTH.default,
    rightPanelWidth:
      desktop.rightPanelWidth ?? STUDIO_WORKSPACE_RIGHT_PANEL_WIDTH.default,
  };
}

function createBuiltinLayout(
  inspector: StudioInspectorLayout,
  desktop: BuiltinDesktop,
  actions: Parameters<typeof createQuickActions>[0],
  deviceOverrides: Readonly<Partial<Record<
    StudioWorkspaceDeviceKind,
    Readonly<{ desktop: BuiltinDesktop; controlSide?: StudioMobileControlSide }>
  >>> = {},
): StudioWorkspaceLayout {
  const overrides: Record<string, StudioWorkspaceDeviceOverride> = {};
  for (const device of STUDIO_WORKSPACE_DEVICE_KINDS) {
    const override = deviceOverrides[device];
    if (!override) continue;
    overrides[device] = Object.freeze({
      desktop: Object.freeze(builtinDesktop(override.desktop)),
      controlSide: override.controlSide ?? null,
    });
  }
  return freezeLayout({
    inspector,
    desktop: builtinDesktop(desktop),
    drawingPalettes: DEFAULT_STUDIO_DRAWING_PALETTE_LAYOUT,
    quickActions: createQuickActions(actions),
    deviceOverrides: Object.freeze(overrides),
  });
}

/**
 * Dock geometry shared by the surfaces that trade panel width for canvas and reach.
 *
 * A pen display keeps the inspector reachable but narrow, because the hand rests on the glass and
 * a wide dock pushes the drawing area under the wrist. Mobile and touch close both docks outright:
 * the on-canvas command surfaces own that screen, and a 160px page strip is unusable with a thumb.
 */
const PEN_DISPLAY_DESKTOP: BuiltinDesktop = {
  leftPanelOpen: false,
  rightPanelOpen: true,
  rightPanelWidth: STUDIO_WORKSPACE_RIGHT_PANEL_WIDTH.minimum,
};
const HANDHELD_DESKTOP: BuiltinDesktop = {
  leftPanelOpen: false,
  rightPanelOpen: false,
  leftPanelWidth: STUDIO_WORKSPACE_LEFT_PANEL_WIDTH.minimum,
  rightPanelWidth: STUDIO_WORKSPACE_RIGHT_PANEL_WIDTH.minimum,
};
/** Keyboard navigation wants every landmark present so Tab order reaches the whole editor. */
const KEYBOARD_DESKTOP: BuiltinDesktop = { leftPanelOpen: true, rightPanelOpen: true };

/** The adaptation every drawing-first workspace shares. Review/publish profiles opt out. */
const DRAWING_DEVICE_OVERRIDES = {
  "pen-display": { desktop: PEN_DISPLAY_DESKTOP },
  mobile: { desktop: HANDHELD_DESKTOP },
  touch: { desktop: HANDHELD_DESKTOP },
  keyboard: { desktop: KEYBOARD_DESKTOP },
} as const;

/** Reading-first workspaces keep their docks; only the handheld surfaces reclaim the screen. */
const READING_DEVICE_OVERRIDES = {
  mobile: { desktop: HANDHELD_DESKTOP },
  touch: { desktop: HANDHELD_DESKTOP },
} as const;

/**
 * Immutable, task-oriented workspaces.
 *
 * Every profile places only sections, docks, palettes and quick actions that this build actually
 * renders — an inspector section from `studio-inspector-layout`, the two docks, the two drawing
 * palettes, and the sixteen quick-action ids. Nothing here names a panel that does not exist, so a
 * profile can never resolve to an empty pane. See `STUDIO_WORKSPACE_CATALOGUE_COVERAGE` for the
 * requested profiles that have no addressable counterpart yet.
 */
export const STUDIO_DEFAULT_WORKSPACES: readonly StudioDefaultWorkspace[] = Object.freeze([
  Object.freeze({
    id: "storyboard",
    name: "스토리보드",
    description: "페이지와 컷 흐름을 보며 러프 콘티를 빠르게 구성합니다.",
    layout: createBuiltinLayout(
      { primary: "document", image: "quick", document: "navigator" },
      { leftPanelOpen: true, rightPanelOpen: true },
      ["undo", "redo", "select", "pen", "add-bubble", "fit-width"],
      DRAWING_DEVICE_OVERRIDES,
    ),
  }),
  Object.freeze({
    id: "lineart",
    name: "선화",
    description: "펜, 지우개와 참조 채우기에 집중한 선화 작업공간입니다.",
    layout: createBuiltinLayout(
      { primary: "properties", image: "fill", document: "canvas" },
      { leftPanelOpen: false, rightPanelOpen: true },
      ["undo", "redo", "pen", "eraser", "eyedropper", "advanced-fill"],
      DRAWING_DEVICE_OVERRIDES,
    ),
  }),
  Object.freeze({
    id: "coloring",
    name: "채색",
    description: "참조 채우기, 색 추출과 페이지 색보정을 가까이 둡니다.",
    layout: createBuiltinLayout(
      { primary: "properties", image: "fill", document: "grade" },
      { leftPanelOpen: false, rightPanelOpen: true },
      ["undo", "redo", "eyedropper", "advanced-fill", "select", "eraser"],
      DRAWING_DEVICE_OVERRIDES,
    ),
  }),
  Object.freeze({
    id: "lettering",
    name: "대사·레터링",
    description: "말풍선 추가, 선택, 복제와 정리를 위한 작업공간입니다.",
    layout: createBuiltinLayout(
      { primary: "properties", image: "quick", document: "canvas" },
      { leftPanelOpen: true, rightPanelOpen: true },
      ["undo", "redo", "add-bubble", "select", "duplicate", "delete"],
      READING_DEVICE_OVERRIDES,
    ),
  }),
  Object.freeze({
    id: "review",
    name: "검수",
    description: "긴 페이지 탐색과 요소 속성 확인에 맞춘 검수 작업공간입니다.",
    layout: createBuiltinLayout(
      { primary: "document", image: "retouch", document: "navigator" },
      { leftPanelOpen: true, rightPanelOpen: true },
      ["undo", "redo", "select", "properties", "fit-width", "bring-front"],
      READING_DEVICE_OVERRIDES,
    ),
  }),
  Object.freeze({
    id: "publish",
    name: "게시",
    description: "작품 정보와 최종 화면 맞춤 검사를 바로 엽니다.",
    layout: createBuiltinLayout(
      { primary: "publish", image: "quick", document: "canvas" },
      { leftPanelOpen: false, rightPanelOpen: true },
      ["fit-width", "properties", "select", "undo", "redo", "eyedropper"],
      READING_DEVICE_OVERRIDES,
    ),
  }),
  Object.freeze({
    id: "pro-comic",
    name: "프로 만화",
    description:
      "도구 속성·레이어·페이지 동선을 유지하면서 좌우 도크를 줄여 캔버스 면적을 우선 확보합니다.",
    layout: createBuiltinLayout(
      { primary: "properties", image: "fill", document: "navigator" },
      {
        leftPanelOpen: true,
        rightPanelOpen: true,
        leftPanelWidth: 176,
        rightPanelWidth: 304,
      },
      ["undo", "redo", "pen", "advanced-fill", "add-bubble", "fit-width"],
      DRAWING_DEVICE_OVERRIDES,
    ),
  }),
  Object.freeze({
    id: "quick-sketch",
    name: "빠른 스케치",
    description:
      "패널을 걷어내고 캔버스만 남깁니다. 되돌리기·펜·지우개만 손에 두고 아이디어를 던집니다.",
    layout: createBuiltinLayout(
      { primary: "properties", image: "quick", document: "canvas" },
      { leftPanelOpen: false, rightPanelOpen: false },
      ["undo", "redo", "pen", "eraser", "eyedropper", "fit-width"],
      DRAWING_DEVICE_OVERRIDES,
    ),
  }),
  Object.freeze({
    id: "csp-migration",
    name: "클립 스튜디오형",
    description:
      "CSP·클립 스튜디오에서 넘어온 손에 맞춰 레이어 중심 동선을 유지하되, 좌우 도크를 더 줄여 캔버스 중심으로 바로 작업할 수 있습니다.",
    layout: createBuiltinLayout(
      { primary: "layers", image: "fill", document: "navigator" },
      {
        leftPanelOpen: true,
        rightPanelOpen: true,
        leftPanelWidth: 176,
        rightPanelWidth: 272,
      },
      ["undo", "redo", "pen", "advanced-fill", "eyedropper", "select"],
      DRAWING_DEVICE_OVERRIDES,
    ),
  }),
  Object.freeze({
    id: "pen-display",
    name: "액정 타블렛",
    description:
      "액정 위에 손을 얹고 그릴 때를 위한 배치입니다. 페이지 목록을 접고 인스펙터를 좁혀 손목 아래 캔버스를 넓힙니다.",
    layout: createBuiltinLayout(
      { primary: "properties", image: "quick", document: "canvas" },
      { leftPanelOpen: false, rightPanelOpen: true, rightPanelWidth: 240 },
      ["undo", "redo", "pen", "eraser", "eyedropper", "quick-mask"],
      {
        "pen-display": { desktop: PEN_DISPLAY_DESKTOP, controlSide: "left" },
        mobile: { desktop: HANDHELD_DESKTOP },
        touch: { desktop: HANDHELD_DESKTOP },
        keyboard: { desktop: KEYBOARD_DESKTOP },
      },
    ),
  }),
  Object.freeze({
    id: "mobile-draw",
    name: "모바일 드로잉",
    description:
      "좁은 화면에서 양쪽 도크를 모두 접고 엄지로 닿는 온캔버스 명령만 남깁니다.",
    layout: createBuiltinLayout(
      { primary: "properties", image: "quick", document: "canvas" },
      { leftPanelOpen: false, rightPanelOpen: false, rightPanelWidth: 240 },
      ["undo", "redo", "pen", "eraser", "select", "fit-width"],
      {
        mobile: { desktop: HANDHELD_DESKTOP },
        touch: { desktop: HANDHELD_DESKTOP },
        keyboard: { desktop: KEYBOARD_DESKTOP },
        mouse: { desktop: { leftPanelOpen: true, rightPanelOpen: true } },
      },
    ),
  }),
  Object.freeze({
    id: "photo-edit",
    name: "사진 보정",
    description:
      "사진 리터치와 페이지 색보정을 한 화면에 둡니다. 마스크·닷지번을 손에 두고 톤을 만집니다.",
    layout: createBuiltinLayout(
      { primary: "properties", image: "retouch", document: "grade" },
      { leftPanelOpen: false, rightPanelOpen: true, rightPanelWidth: 344 },
      ["undo", "redo", "dodge-burn", "quick-mask", "eyedropper", "select"],
      READING_DEVICE_OVERRIDES,
    ),
  }),
  Object.freeze({
    id: "vector-design",
    name: "벡터 디자인",
    description:
      "도형·선택·변형과 레이어 구조를 전면에 두고 편집 가능한 벡터 오브젝트를 설계합니다.",
    layout: createBuiltinLayout(
      { primary: "layers", image: "transform", document: "canvas" },
      { leftPanelOpen: true, rightPanelOpen: true, rightPanelWidth: 344 },
      ["undo", "redo", "select", "duplicate", "bring-front", "properties"],
      READING_DEVICE_OVERRIDES,
    ),
  }),
  Object.freeze({
    id: "animation",
    name: "애니메이션",
    description:
      "레이어 타임라인·키프레임·어니언 스킨을 열어 셀과 카메라 움직임을 한 화면에서 다룹니다.",
    layout: createBuiltinLayout(
      { primary: "layers", image: "transform", document: "navigator" },
      {
        leftPanelOpen: true,
        rightPanelOpen: true,
        leftPanelWidth: 216,
        rightPanelWidth: 344,
      },
      ["undo", "redo", "select", "duplicate", "properties", "fit-width"],
      READING_DEVICE_OVERRIDES,
    ),
  }),
  Object.freeze({
    id: "pose-3d",
    name: "포즈 & 3D",
    description:
      "3D 데생 인형 포저를 열고 변형·레이어 인스펙터를 함께 배치해 구도와 자세를 설계합니다.",
    layout: createBuiltinLayout(
      { primary: "properties", image: "transform", document: "canvas" },
      { leftPanelOpen: false, rightPanelOpen: true, rightPanelWidth: 360 },
      ["undo", "redo", "select", "properties", "fit-width", "duplicate"],
      READING_DEVICE_OVERRIDES,
    ),
  }),
]);

/**
 * Where each requested workspace profile landed. `workspaceId: null` remains part of the audit
 * schema so a future unavailable profile cannot be silently omitted; this build ships all twelve.
 * Specialist profiles also have an explicit one-shot product-surface launch contract above.
 */
export interface StudioWorkspaceCatalogueCoverageEntry {
  readonly requirement: string;
  readonly workspaceId: StudioDefaultWorkspaceId | null;
  readonly absence: string | null;
}

export const STUDIO_WORKSPACE_CATALOGUE_COVERAGE: readonly StudioWorkspaceCatalogueCoverageEntry[] = Object.freeze([
  Object.freeze({ requirement: "Quick Sketch", workspaceId: "quick-sketch", absence: null }),
  Object.freeze({ requirement: "CSP Migration", workspaceId: "csp-migration", absence: null }),
  Object.freeze({ requirement: "Pen Display", workspaceId: "pen-display", absence: null }),
  Object.freeze({ requirement: "Mobile Draw", workspaceId: "mobile-draw", absence: null }),
  Object.freeze({ requirement: "Comic Production", workspaceId: "pro-comic", absence: null }),
  Object.freeze({ requirement: "Paint Studio", workspaceId: "coloring", absence: null }),
  Object.freeze({ requirement: "Photo Edit", workspaceId: "photo-edit", absence: null }),
  Object.freeze({ requirement: "Collaboration Review", workspaceId: "review", absence: null }),
  Object.freeze({ requirement: "Presentation/Publish", workspaceId: "publish", absence: null }),
  Object.freeze({ requirement: "Vector Design", workspaceId: "vector-design", absence: null }),
  Object.freeze({ requirement: "Animation", workspaceId: "animation", absence: null }),
  Object.freeze({ requirement: "Pose & 3D", workspaceId: "pose-3d", absence: null }),
]);

/** Requested profiles this build cannot honestly ship, kept machine-readable for future drift. */
export const STUDIO_WORKSPACE_ABSENT_CATALOGUE_REQUIREMENTS = Object.freeze(
  STUDIO_WORKSPACE_CATALOGUE_COVERAGE
    .filter((entry) => entry.workspaceId === null)
    .map((entry) => entry.requirement),
);

function defaultWorkspace(id: StudioDefaultWorkspaceId): StudioDefaultWorkspace {
  const workspace = STUDIO_DEFAULT_WORKSPACES.find((candidate) => candidate.id === id);
  // The exhaustive immutable catalog above guarantees this branch cannot be reached.
  if (!workspace) throw new RangeError(`Unknown default workspace: ${id}`);
  return workspace;
}

function createDefaultState(ownerScope?: string): StudioWorkspaceState {
  return createState({
    version: STUDIO_WORKSPACE_STATE_VERSION,
    activeWorkspaceId: "storyboard",
    liveLayout: defaultWorkspace("storyboard").layout,
    customWorkspaces: [],
    mobileControlSide: "right",
    applyQuickActionsOnSwitch: true,
  }, ownerScope);
}

function createState(
  state: StudioWorkspaceState,
  ownerScope = STATE_OWNER_SCOPES.get(state)
): StudioWorkspaceState {
  const normalized = Object.freeze({
    version: STUDIO_WORKSPACE_STATE_VERSION,
    activeWorkspaceId: state.activeWorkspaceId,
    liveLayout: freezeLayout(state.liveLayout),
    customWorkspaces: Object.freeze(
      state.customWorkspaces.map((workspace) =>
        Object.freeze({
          id: workspace.id,
          name: workspace.name,
          layout: freezeLayout(workspace.layout),
        })
      )
    ),
    mobileControlSide: state.mobileControlSide,
    applyQuickActionsOnSwitch: state.applyQuickActionsOnSwitch,
  });
  if (ownerScope) STATE_OWNER_SCOPES.set(normalized, ownerScope);
  return normalized;
}

function createDerivedState(
  source: StudioWorkspaceState,
  state: StudioWorkspaceState
): StudioWorkspaceState {
  return createState(state, STATE_OWNER_SCOPES.get(source));
}

export const DEFAULT_STUDIO_WORKSPACE_STATE: StudioWorkspaceState = createDefaultState();

function rawUtf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x7f) {
      bytes += 1;
    } else if (code <= 0x7ff) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
    if (bytes > STUDIO_WORKSPACE_RAW_MAX_BYTES) return bytes;
  }
  return bytes;
}

function decodeBoundedRaw(raw: unknown): unknown {
  if (typeof raw === "string") {
    if (rawUtf8ByteLength(raw) > STUDIO_WORKSPACE_RAW_MAX_BYTES) return null;
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  }

  try {
    const encoded = JSON.stringify(raw);
    if (
      typeof encoded !== "string" ||
      rawUtf8ByteLength(encoded) > STUDIO_WORKSPACE_RAW_MAX_BYTES
    ) {
      return null;
    }
  } catch {
    return null;
  }
  return raw;
}

function isExactInspectorLayout(value: unknown): value is StudioInspectorLayout {
  if (!isRecord(value)) return false;
  return (
    typeof value.primary === "string" &&
    PRIMARY_SECTION_SET.has(value.primary) &&
    typeof value.image === "string" &&
    IMAGE_SECTION_SET.has(value.image) &&
    typeof value.document === "string" &&
    DOCUMENT_SECTION_SET.has(value.document)
  );
}

function isExactQuickActions(value: unknown): value is StudioQuickActionsPreferences {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.slots)) return false;
  const slots = value.slots;
  return QUICK_ACTION_SLOTS.every((slot) => {
    const action = slots[slot];
    return typeof action === "string" && QUICK_ACTION_ID_SET.has(action);
  });
}

function normalizeWorkspaceLayout(
  value: unknown,
  fallback: StudioWorkspaceLayout
): StudioWorkspaceLayout {
  if (!isRecord(value)) return freezeLayout(fallback);

  const inspector = isExactInspectorLayout(value.inspector)
    ? normalizeStudioInspectorLayout(value.inspector)
    : fallback.inspector;
  const desktop = normalizeDesktopLayout(value.desktop, fallback.desktop);
  const drawingPalettes = normalizeStudioDrawingPaletteLayout(
    value.drawingPalettes,
    fallback.drawingPalettes,
  );
  const quickActions = isExactQuickActions(value.quickActions)
    ? normalizeStudioQuickActionsPreferences(value.quickActions)
    : fallback.quickActions;
  // Payloads older than the command bar carry no `commandBar` key at all; they inherit the
  // fallback (the previous live layout, or a built-in's default) instead of resetting, exactly
  // like the device axis below. A present key recovers slot by slot.
  const commandBar = "commandBar" in value
    ? normalizeStudioCommandBarPreferences(
        value.commandBar,
        fallback.commandBar ?? DEFAULT_STUDIO_COMMAND_BAR,
      )
    : fallback.commandBar ?? DEFAULT_STUDIO_COMMAND_BAR;
  // A v1-v3 payload has no device overrides at all. Inheriting the fallback's keeps a built-in
  // profile's curated adaptations after migration instead of silently flattening them.
  const deviceOverrides = "deviceOverrides" in value
    ? normalizeDeviceOverrides(value.deviceOverrides, desktop)
    : fallback.deviceOverrides;

  return freezeLayout({
    inspector,
    desktop,
    drawingPalettes,
    quickActions,
    commandBar,
    deviceOverrides,
  });
}

/** Creates a canonical immutable workspace layout from UI state. */
export function normalizeStudioWorkspaceLayout(
  value: unknown,
  fallback: StudioWorkspaceLayout = defaultWorkspace("storyboard").layout
): StudioWorkspaceLayout {
  return normalizeWorkspaceLayout(value, fallback);
}

function validCustomId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= CUSTOM_ID_MAX_LENGTH &&
    CUSTOM_ID_PATTERN.test(value) &&
    !DEFAULT_ID_SET.has(value)
  );
}

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x1f || codePoint === 0x7f) return true;
  }
  return false;
}

function normalizedName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (containsControlCharacter(value)) return null;
  const name = value.trim().replace(/\s+/gu, " ");
  if (
    !name ||
    Array.from(name).length > STUDIO_WORKSPACE_NAME_MAX_LENGTH
  ) {
    return null;
  }
  return name;
}

/** Validates and canonicalizes a user-facing name, throwing before state can be changed. */
export function normalizeStudioWorkspaceName(value: string): string {
  const name = normalizedName(value);
  if (!name) {
    throw new TypeError(
      `Workspace names must contain 1-${STUDIO_WORKSPACE_NAME_MAX_LENGTH} visible characters.`
    );
  }
  return name;
}

function normalizeCustomWorkspaces(
  value: unknown,
  layoutFallback: StudioWorkspaceLayout
): readonly StudioCustomWorkspace[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  const workspaces: StudioCustomWorkspace[] = [];

  for (const candidate of value) {
    if (!isRecord(candidate) || !validCustomId(candidate.id)) continue;
    const name = normalizedName(candidate.name);
    if (!name || ids.has(candidate.id) || !isRecord(candidate.layout)) continue;
    ids.add(candidate.id);
    workspaces.push(
      Object.freeze({
        id: candidate.id,
        name,
        layout: normalizeWorkspaceLayout(candidate.layout, layoutFallback),
      })
    );
    if (workspaces.length >= STUDIO_WORKSPACE_MAX_CUSTOM) break;
  }
  return Object.freeze(workspaces);
}

function normalizeDecodedStudioWorkspaceState(
  decoded: unknown,
  ownerScope?: string
): StudioWorkspaceState | null {
  if (
    !isRecord(decoded) ||
    (decoded.version !== 1 &&
      decoded.version !== 2 &&
      decoded.version !== 3 &&
      decoded.version !== STUDIO_WORKSPACE_STATE_VERSION)
  ) {
    return null;
  }

  // Stored payloads older than the device axis are migrated to "no adaptation" rather than
  // inheriting the storyboard profile's adaptations: an artist's own saved layout must not
  // silently gain per-device behaviour they never configured. A current payload always carries
  // the key explicitly, so this fallback only ever applies to v1-v3.
  const fallback = freezeLayout({
    ...defaultWorkspace("storyboard").layout,
    deviceOverrides: EMPTY_DEVICE_OVERRIDES,
  });
  const liveLayout = normalizeWorkspaceLayout(decoded.liveLayout, fallback);
  const customWorkspaces = normalizeCustomWorkspaces(decoded.customWorkspaces, fallback);
  const customIds = new Set(customWorkspaces.map((workspace) => workspace.id));
  const activeWorkspaceId =
    typeof decoded.activeWorkspaceId === "string" &&
    (DEFAULT_ID_SET.has(decoded.activeWorkspaceId) || customIds.has(decoded.activeWorkspaceId))
      ? decoded.activeWorkspaceId
      : "storyboard";
  const mobileControlSide =
    typeof decoded.mobileControlSide === "string" &&
    MOBILE_CONTROL_SIDE_SET.has(decoded.mobileControlSide)
      ? (decoded.mobileControlSide as StudioMobileControlSide)
      : "right";

  return createState({
    version: STUDIO_WORKSPACE_STATE_VERSION,
    activeWorkspaceId,
    liveLayout,
    customWorkspaces,
    mobileControlSide,
    applyQuickActionsOnSwitch:
      typeof decoded.applyQuickActionsOnSwitch === "boolean"
        ? decoded.applyQuickActionsOnSwitch
        : true,
  }, ownerScope);
}

/**
 * Strict state normalizer for untrusted storage and previous workspace payloads.
 *
 * Unknown versions, malformed roots, cyclic values, and values over 64 KiB reset to defaults.
 * Known v1/v2 fields recover independently, while every unrecognized field is deliberately
 * omitted from the returned allowlisted object. Missing palette state receives bounded v3 defaults.
 */
export function normalizeStudioWorkspaceState(raw: unknown): StudioWorkspaceState {
  const ownerScope = isRecord(raw) ? STATE_OWNER_SCOPES.get(raw) : undefined;
  const decoded = decodeBoundedRaw(raw);
  return normalizeDecodedStudioWorkspaceState(decoded, ownerScope) ?? createDefaultState(ownerScope);
}

function ownerHash(value: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return `${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0).toString(16).padStart(8, "0")}`;
}

/** Opaque deterministic namespace used by both the stable key and payload envelope. */
export function studioWorkspaceOwnerScope(userId: string | null | undefined): string {
  const normalizedUserId = userId?.trim() ?? "";
  return normalizedUserId ? `owner-${ownerHash(normalizedUserId)}` : "guest";
}

/** Anonymous and authenticated owners receive stable, version-independent, opaque keys. */
export function studioWorkspaceStorageKey(userId: string | null | undefined): string {
  return `${STUDIO_WORKSPACE_STORAGE_KEY}:${studioWorkspaceOwnerScope(userId)}`.slice(
    0,
    STORAGE_KEY_MAX_LENGTH
  );
}

function legacyV1StorageKey(userId: string | null | undefined): string {
  const normalizedUserId = userId?.trim() ?? "";
  if (!normalizedUserId) return `${LEGACY_V1_STORAGE_PREFIX}:guest`;
  let preview = "invalid-unicode";
  try {
    preview = encodeURIComponent(normalizedUserId).slice(0, 72);
  } catch {
    // Preserve the exact v1 fallback used for invalid Unicode owner identifiers.
  }
  return `${LEGACY_V1_STORAGE_PREFIX}:user:${preview}-${ownerHash(normalizedUserId)}`.slice(
    0,
    STORAGE_KEY_MAX_LENGTH
  );
}

interface StudioWorkspaceEnvelope {
  readonly kind: typeof WORKSPACE_ENVELOPE_KIND;
  readonly payloadVersion: 1 | 2 | 3 | typeof STUDIO_WORKSPACE_PAYLOAD_VERSION;
  readonly ownerScope: string;
  readonly state: unknown;
}

interface DecodedWorkspaceEnvelope {
  readonly state: StudioWorkspaceState;
  readonly needsMigration: boolean;
  readonly migrationSource: Extract<
    StudioWorkspaceLoadSource,
    "legacy-v1" | "legacy-v2"
  > | null;
}

function decodeWorkspaceEnvelope(
  raw: string,
  expectedOwnerScope: string
): DecodedWorkspaceEnvelope | StudioWorkspacePersistenceFailure {
  const decoded = decodeBoundedRaw(raw);
  if (!isRecord(decoded)) return "invalid-payload";

  // Bare prior-version states are accepted only as migration sources. Current storage always
  // writes an owner-scoped envelope and verifies the exact serialized value.
  if (decoded.version === 1 || decoded.version === 2 || decoded.version === 3) {
    const state = normalizeDecodedStudioWorkspaceState(decoded, expectedOwnerScope);
    return state
      ? {
          state,
          needsMigration: true,
          migrationSource: decoded.version === 1 ? "legacy-v1" : "legacy-v2",
        }
      : "invalid-payload";
  }

  if (
    decoded.kind !== WORKSPACE_ENVELOPE_KIND ||
    (decoded.payloadVersion !== 1 &&
      decoded.payloadVersion !== 2 &&
      decoded.payloadVersion !== 3 &&
      decoded.payloadVersion !== STUDIO_WORKSPACE_PAYLOAD_VERSION) ||
    typeof decoded.ownerScope !== "string"
  ) {
    return "invalid-payload";
  }
  if (decoded.ownerScope !== expectedOwnerScope) return "owner-mismatch";

  const state = normalizeDecodedStudioWorkspaceState(decoded.state, expectedOwnerScope);
  if (!state) return "invalid-payload";
  const stateVersion = isRecord(decoded.state) ? decoded.state.version : null;
  const needsMigration =
    decoded.payloadVersion !== STUDIO_WORKSPACE_PAYLOAD_VERSION ||
    stateVersion !== STUDIO_WORKSPACE_STATE_VERSION;
  return {
    state,
    needsMigration,
    migrationSource: needsMigration
      ? decoded.payloadVersion === 1 && stateVersion === 1
        ? "legacy-v1"
        : "legacy-v2"
      : null,
  };
}

function persistenceResult(
  state: StudioWorkspaceState,
  ownerScope: string,
  status: StudioWorkspacePersistenceStatus,
  failure: StudioWorkspacePersistenceFailure | null
): StudioWorkspaceSaveResult {
  return Object.freeze({ state, ownerScope, status, failure });
}

function loadResult(
  state: StudioWorkspaceState,
  ownerScope: string,
  source: StudioWorkspaceLoadSource,
  status: StudioWorkspacePersistenceStatus,
  failure: StudioWorkspacePersistenceFailure | null
): StudioWorkspaceLoadResult {
  return Object.freeze({ state, ownerScope, source, status, failure });
}

function scopedState(state: StudioWorkspaceState, ownerScope: string): StudioWorkspaceState {
  STATE_OWNER_SCOPES.set(state, ownerScope);
  return state;
}

function serializeWorkspaceEnvelope(
  state: StudioWorkspaceState,
  ownerScope: string
): string | null {
  try {
    const envelope: StudioWorkspaceEnvelope = {
      kind: WORKSPACE_ENVELOPE_KIND,
      payloadVersion: STUDIO_WORKSPACE_PAYLOAD_VERSION,
      ownerScope,
      state,
    };
    const serialized = JSON.stringify(envelope);
    return rawUtf8ByteLength(serialized) <= STUDIO_WORKSPACE_RAW_MAX_BYTES
      ? serialized
      : null;
  } catch {
    return null;
  }
}

/**
 * @deprecated Explicit injected compatibility write. Product code uses SQLite/OPFS and never
 * obtains ambient localStorage here. Kept only for bounded rollback/tests.
 */
export function saveStudioWorkspaceState(
  storage: StudioWorkspaceStorage | null | undefined,
  userId: string | null | undefined,
  state: unknown,
  options: StudioWorkspaceSaveOptions = {}
): StudioWorkspaceSaveResult {
  const targetOwnerScope = studioWorkspaceOwnerScope(userId);
  const stateOwnerScope = isRecord(state) ? STATE_OWNER_SCOPES.get(state) : undefined;
  const sourceOwnerScopes = [stateOwnerScope, options.sourceOwnerScope].filter(
    (scope): scope is string => typeof scope === "string"
  );
  const normalized = normalizeStudioWorkspaceState(state);
  if (sourceOwnerScopes.some((scope) => scope !== targetOwnerScope)) {
    return persistenceResult(
      normalized,
      targetOwnerScope,
      "session-only",
      "owner-mismatch"
    );
  }
  scopedState(normalized, targetOwnerScope);
  if (!storage) {
    return persistenceResult(
      normalized,
      targetOwnerScope,
      "session-only",
      "storage-unavailable"
    );
  }

  const serialized = serializeWorkspaceEnvelope(normalized, targetOwnerScope);
  if (!serialized) {
    return persistenceResult(
      normalized,
      targetOwnerScope,
      "session-only",
      "payload-too-large"
    );
  }

  const key = studioWorkspaceStorageKey(userId);
  try {
    storage.setItem(key, serialized);
  } catch {
    return persistenceResult(normalized, targetOwnerScope, "session-only", "write-failed");
  }

  try {
    if (storage.getItem(key) !== serialized) {
      return persistenceResult(
        normalized,
        targetOwnerScope,
        "session-only",
        "verification-failed"
      );
    }
  } catch {
    return persistenceResult(
      normalized,
      targetOwnerScope,
      "session-only",
      "verification-failed"
    );
  }
  return persistenceResult(normalized, targetOwnerScope, "persisted", null);
}

function removeLegacyKeysAfterVerifiedWrite(
  storage: StudioWorkspaceLoadStorage,
  keys: readonly string[],
  write: StudioWorkspaceSaveResult
): void {
  if (write.status !== "persisted" || !storage.removeItem) return;
  for (const key of new Set(keys)) {
    try {
      storage.removeItem(key);
    } catch {
      // Cleanup failure does not invalidate the verified current payload.
    }
  }
}

function loadLegacyPreferences(
  storage: StudioWorkspaceLoadStorage
): { state: StudioWorkspaceState; keys: readonly string[] } | null | "read-failed" {
  const keys = [
    STUDIO_INSPECTOR_LAYOUT_STORAGE_KEY,
    STUDIO_QUICK_ACTIONS_STORAGE_KEY,
    STUDIO_LEGACY_LEFT_PANEL_WIDTH_STORAGE_KEY,
    STUDIO_LEGACY_RIGHT_PANEL_WIDTH_STORAGE_KEY,
  ] as const;
  const values = new Map<string, string>();
  try {
    for (const key of keys) {
      const value = storage.getItem(key);
      if (value !== null) values.set(key, value);
    }
  } catch {
    return "read-failed";
  }
  if (values.size === 0) return null;

  const numericWidth = (key: string): number | undefined => {
    const raw = values.get(key);
    if (raw === undefined || !raw.trim()) return undefined;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : undefined;
  };
  return {
    state: migrateLegacyStudioWorkspaceState({
      inspector: values.get(STUDIO_INSPECTOR_LAYOUT_STORAGE_KEY),
      quickActions: values.get(STUDIO_QUICK_ACTIONS_STORAGE_KEY),
      leftPanelWidth: numericWidth(STUDIO_LEGACY_LEFT_PANEL_WIDTH_STORAGE_KEY),
      rightPanelWidth: numericWidth(STUDIO_LEGACY_RIGHT_PANEL_WIDTH_STORAGE_KEY),
    }),
    keys: [...values.keys()],
  };
}

function persistMigratedWorkspace(
  storage: StudioWorkspaceLoadStorage,
  userId: string | null | undefined,
  state: StudioWorkspaceState,
  ownerScope: string
): StudioWorkspaceSaveResult {
  if (!storage.setItem) {
    return persistenceResult(state, ownerScope, "session-only", "storage-unavailable");
  }
  return saveStudioWorkspaceState(
    {
      getItem: storage.getItem.bind(storage),
      setItem: storage.setItem.bind(storage),
      ...(storage.removeItem ? { removeItem: storage.removeItem.bind(storage) } : {}),
    },
    userId,
    state,
    { sourceOwnerScope: ownerScope }
  );
}

/**
 * @deprecated Explicit injected compatibility read. Pre-V12 discovery is disabled unless a
 * caller opts into the test/rollback import path; product boot never calls this function.
 */
export function loadStudioWorkspacePersistence(
  storage: StudioWorkspaceLoadStorage | null | undefined,
  userId: string | null | undefined,
  options: { readonly legacyDataPolicy?: "discard" | "import-explicit" } = {},
): StudioWorkspaceLoadResult {
  const ownerScope = studioWorkspaceOwnerScope(userId);
  const fallback = createDefaultState(ownerScope);
  if (!storage) {
    return loadResult(
      fallback,
      ownerScope,
      "default",
      "session-only",
      "storage-unavailable"
    );
  }

  const currentKey = studioWorkspaceStorageKey(userId);
  let invalidPayloadFound = false;
  let currentRaw: string | null;
  try {
    currentRaw = storage.getItem(currentKey);
  } catch {
    return loadResult(fallback, ownerScope, "default", "session-only", "read-failed");
  }
  if (currentRaw !== null) {
    const decoded = decodeWorkspaceEnvelope(currentRaw, ownerScope);
    if (typeof decoded === "string") {
      if (decoded === "owner-mismatch") {
        return loadResult(fallback, ownerScope, "default", "session-only", decoded);
      }
      invalidPayloadFound = true;
    } else {
      if (!decoded.needsMigration) {
        return loadResult(decoded.state, ownerScope, "current", "persisted", null);
      }
      const write = persistMigratedWorkspace(storage, userId, decoded.state, ownerScope);
      return loadResult(
        write.state,
        ownerScope,
        decoded.migrationSource ?? "legacy-v1",
        write.status,
        write.failure
      );
    }
  }

  if (options.legacyDataPolicy !== "import-explicit") {
    return loadResult(
      fallback,
      ownerScope,
      "default",
      "session-only",
      invalidPayloadFound ? "invalid-payload" : null,
    );
  }

  const legacyKey = legacyV1StorageKey(userId);
  let legacyRaw: string | null;
  try {
    legacyRaw = storage.getItem(legacyKey);
  } catch {
    return loadResult(fallback, ownerScope, "default", "session-only", "read-failed");
  }
  if (legacyRaw !== null) {
    const decodedLegacy = decodeBoundedRaw(legacyRaw);
    const legacyState =
      isRecord(decodedLegacy) && decodedLegacy.version === 1
        ? normalizeDecodedStudioWorkspaceState(decodedLegacy, ownerScope)
        : null;
    if (legacyState) {
      const write = persistMigratedWorkspace(storage, userId, legacyState, ownerScope);
      removeLegacyKeysAfterVerifiedWrite(storage, [legacyKey], write);
      return loadResult(
        write.state,
        ownerScope,
        "legacy-v1",
        write.status,
        write.failure
      );
    }
    invalidPayloadFound = true;
  }

  // Pre-workspace inspector/quick-action/resize keys were global, so only the guest scope may
  // claim them. Authenticated owners start clean instead of inheriting another session's layout.
  if (ownerScope === "guest") {
    const legacyPreferences = loadLegacyPreferences(storage);
    if (legacyPreferences === "read-failed") {
      return loadResult(fallback, ownerScope, "default", "session-only", "read-failed");
    }
    if (legacyPreferences) {
      scopedState(legacyPreferences.state, ownerScope);
      const write = persistMigratedWorkspace(
        storage,
        userId,
        legacyPreferences.state,
        ownerScope
      );
      removeLegacyKeysAfterVerifiedWrite(storage, legacyPreferences.keys, write);
      return loadResult(
        write.state,
        ownerScope,
        "legacy-preferences",
        write.status,
        write.failure
      );
    }
  }

  return loadResult(
    fallback,
    ownerScope,
    "default",
    "session-only",
    invalidPayloadFound ? "invalid-payload" : null
  );
}

/** Backwards-compatible state-only loader. Use loadStudioWorkspacePersistence for status/source. */
export function loadStudioWorkspaceState(
  storage: StudioWorkspaceLoadStorage | null | undefined,
  userId: string | null | undefined
): StudioWorkspaceState {
  return loadStudioWorkspacePersistence(storage, userId).state;
}

const OWNER_SCOPE_PATTERN = /^(?:guest|owner-[0-9a-f]{16})$/u;

/** Returns a fresh immutable default tagged for one owner-scoped persistence session. */
export function createStudioWorkspaceDefaultState(
  userId: string | null | undefined,
): StudioWorkspaceState {
  return createDefaultState(studioWorkspaceOwnerScope(userId));
}

/**
 * Canonicalizes an untrusted value and binds every derived state to one opaque owner scope.
 * SQLite repositories use this boundary after validating their envelope. It performs no legacy
 * browser-KV discovery or migration.
 */
export function normalizeStudioWorkspaceStateForOwner(
  raw: unknown,
  ownerScope: string,
): StudioWorkspaceState {
  if (!OWNER_SCOPE_PATTERN.test(ownerScope)) {
    throw new TypeError("Studio workspace owner scope is invalid.");
  }
  const normalized = normalizeStudioWorkspaceState(raw);
  STATE_OWNER_SCOPES.set(normalized, ownerScope);
  return normalized;
}

/** Owner provenance is intentionally process-local and never serialized outside its envelope. */
export function studioWorkspaceStateOwnerScope(
  state: StudioWorkspaceState,
): string | null {
  return STATE_OWNER_SCOPES.get(state) ?? null;
}

export function resolveStudioWorkspace(
  state: StudioWorkspaceState,
  id: StudioWorkspaceId
): StudioDefaultWorkspace | StudioCustomWorkspace | null {
  if (DEFAULT_ID_SET.has(id)) {
    return STUDIO_DEFAULT_WORKSPACES.find((workspace) => workspace.id === id) ?? null;
  }
  return state.customWorkspaces.find((workspace) => workspace.id === id) ?? null;
}

export function listStudioWorkspaces(
  state: StudioWorkspaceState
): readonly (StudioDefaultWorkspace | StudioCustomWorkspace)[] {
  const normalized = normalizeStudioWorkspaceState(state);
  return Object.freeze([...STUDIO_DEFAULT_WORKSPACES, ...normalized.customWorkspaces]);
}

function nextCustomId(workspaces: readonly StudioCustomWorkspace[]): string {
  const ids = new Set(workspaces.map((workspace) => workspace.id));
  let sequence = 1;
  while (ids.has(`custom-${sequence}`)) sequence += 1;
  return `custom-${sequence}`;
}

const DUPLICATE_NAME_SUFFIX_PATTERN = / 복사본(?: [1-9][0-9]*)?$/u;

function workspaceNameCollisionKey(name: string): string {
  return name.normalize("NFKC").toLowerCase();
}

/**
 * Truncates by the model's code-point limit without cutting a user-perceived grapheme in half.
 * The code-point fallback still preserves surrogate pairs in engines without Intl.Segmenter.
 */
function truncateWorkspaceNameBase(name: string, maximumCodePoints: number): string {
  if (maximumCodePoints <= 0) return "";
  if (typeof Intl.Segmenter !== "function") {
    return Array.from(name).slice(0, maximumCodePoints).join("");
  }

  let result = "";
  let codePointCount = 0;
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  for (const { segment } of segmenter.segment(name)) {
    const segmentCodePoints = Array.from(segment).length;
    if (codePointCount + segmentCodePoints > maximumCodePoints) break;
    result += segment;
    codePointCount += segmentCodePoints;
  }
  return result;
}

function duplicateWorkspaceName(
  sourceName: string,
  customWorkspaces: readonly StudioCustomWorkspace[]
): string {
  const occupiedNames = new Set(
    [...STUDIO_DEFAULT_WORKSPACES, ...customWorkspaces].map((workspace) =>
      workspaceNameCollisionKey(workspace.name)
    )
  );
  const strippedBase = sourceName.replace(DUPLICATE_NAME_SUFFIX_PATTERN, "").trim();
  const base = strippedBase || sourceName;

  // There are at most 30 occupied built-in/custom names. Since every suffix is distinct,
  // one more candidate than the occupied-key count guarantees a collision-free result.
  for (let sequence = 1; sequence <= occupiedNames.size + 1; sequence += 1) {
    const suffix = sequence === 1 ? " 복사본" : ` 복사본 ${sequence}`;
    const availableBaseLength =
      STUDIO_WORKSPACE_NAME_MAX_LENGTH - Array.from(suffix).length;
    const candidate = normalizeStudioWorkspaceName(
      `${truncateWorkspaceNameBase(base, availableBaseLength)}${suffix}`
    );
    if (!occupiedNames.has(workspaceNameCollisionKey(candidate))) return candidate;
  }

  // The finite catalog bound makes this unreachable, but fail closed if that invariant changes.
  throw new RangeError("Unable to create a unique Studio workspace name.");
}

/** Captures the current live layout as a new custom workspace and activates it. */
export function saveStudioWorkspace(
  state: StudioWorkspaceState,
  name: string,
  layout: StudioWorkspaceLayout = state.liveLayout
): StudioWorkspaceState {
  const normalized = normalizeStudioWorkspaceState(state);
  if (normalized.customWorkspaces.length >= STUDIO_WORKSPACE_MAX_CUSTOM) {
    throw new RangeError(`Studio supports at most ${STUDIO_WORKSPACE_MAX_CUSTOM} custom workspaces.`);
  }
  const workspace: StudioCustomWorkspace = Object.freeze({
    id: nextCustomId(normalized.customWorkspaces),
    name: normalizeStudioWorkspaceName(name),
    layout: normalizeWorkspaceLayout(layout, normalized.liveLayout),
  });
  return createDerivedState(normalized, {
    ...normalized,
    activeWorkspaceId: workspace.id,
    liveLayout: workspace.layout,
    customWorkspaces: [...normalized.customWorkspaces, workspace],
  });
}

function requireCustomWorkspaceIndex(state: StudioWorkspaceState, id: string): number {
  if (DEFAULT_ID_SET.has(id)) throw new TypeError("Built-in workspaces are immutable.");
  const index = state.customWorkspaces.findIndex((workspace) => workspace.id === id);
  if (index < 0) throw new RangeError(`Unknown custom workspace: ${id}`);
  return index;
}

/**
 * Duplicates a custom workspace's saved snapshot directly beside its source.
 * Catalog duplication is intentionally non-destructive: the active id and current live (including
 * dirty) layout are preserved. Use switchStudioWorkspace explicitly to activate the new copy.
 */
export function duplicateStudioWorkspace(
  state: StudioWorkspaceState,
  id: string
): StudioWorkspaceState {
  const normalized = normalizeStudioWorkspaceState(state);
  const sourceIndex = requireCustomWorkspaceIndex(normalized, id);
  if (normalized.customWorkspaces.length >= STUDIO_WORKSPACE_MAX_CUSTOM) {
    throw new RangeError(`Studio supports at most ${STUDIO_WORKSPACE_MAX_CUSTOM} custom workspaces.`);
  }

  const source = normalized.customWorkspaces[sourceIndex]!;
  const duplicate: StudioCustomWorkspace = Object.freeze({
    id: nextCustomId(normalized.customWorkspaces),
    name: duplicateWorkspaceName(source.name, normalized.customWorkspaces),
    layout: freezeLayout(source.layout),
  });
  const customWorkspaces = [...normalized.customWorkspaces];
  customWorkspaces.splice(sourceIndex + 1, 0, duplicate);
  return createDerivedState(normalized, { ...normalized, customWorkspaces });
}

/**
 * Moves a custom workspace to an exact final index in the custom-only catalog.
 * Built-ins remain immutable and outside this index space. Active/live state is never changed.
 */
export function reorderStudioWorkspace(
  state: StudioWorkspaceState,
  id: string,
  targetIndex: number
): StudioWorkspaceState {
  const normalized = normalizeStudioWorkspaceState(state);
  const sourceIndex = requireCustomWorkspaceIndex(normalized, id);
  if (!Number.isInteger(targetIndex)) {
    throw new TypeError("Studio workspace target index must be an integer.");
  }
  if (targetIndex < 0 || targetIndex >= normalized.customWorkspaces.length) {
    throw new RangeError(`Studio workspace target index is out of range: ${targetIndex}`);
  }
  if (targetIndex === sourceIndex) return normalized;

  const customWorkspaces = [...normalized.customWorkspaces];
  const workspace = customWorkspaces[sourceIndex]!;
  customWorkspaces.splice(sourceIndex, 1);
  customWorkspaces.splice(targetIndex, 0, workspace);
  return createDerivedState(normalized, { ...normalized, customWorkspaces });
}

/** Moves a custom workspace by one position; first-up and last-down are canonical no-ops. */
export function moveStudioWorkspace(
  state: StudioWorkspaceState,
  id: string,
  direction: StudioWorkspaceMoveDirection
): StudioWorkspaceState {
  const normalized = normalizeStudioWorkspaceState(state);
  const sourceIndex = requireCustomWorkspaceIndex(normalized, id);
  if (direction !== "up" && direction !== "down") {
    throw new TypeError(`Unknown Studio workspace move direction: ${String(direction)}`);
  }
  const targetIndex = sourceIndex + (direction === "up" ? -1 : 1);
  if (targetIndex < 0 || targetIndex >= normalized.customWorkspaces.length) {
    return normalized;
  }
  return reorderStudioWorkspace(normalized, id, targetIndex);
}

/** Replaces a custom workspace snapshot with the current live layout. */
export function overwriteStudioWorkspace(
  state: StudioWorkspaceState,
  id: string,
  layout: StudioWorkspaceLayout = state.liveLayout
): StudioWorkspaceState {
  const normalized = normalizeStudioWorkspaceState(state);
  const index = requireCustomWorkspaceIndex(normalized, id);
  const existing = normalized.customWorkspaces[index];
  const nextLayout = normalizeWorkspaceLayout(layout, normalized.liveLayout);
  const customWorkspaces = normalized.customWorkspaces.map((workspace, candidateIndex) =>
    candidateIndex === index
      ? Object.freeze({ ...existing, layout: nextLayout })
      : workspace
  );
  return createDerivedState(normalized, {
    ...normalized,
    activeWorkspaceId: id,
    liveLayout: nextLayout,
    customWorkspaces,
  });
}

export function renameStudioWorkspace(
  state: StudioWorkspaceState,
  id: string,
  name: string
): StudioWorkspaceState {
  const normalized = normalizeStudioWorkspaceState(state);
  const index = requireCustomWorkspaceIndex(normalized, id);
  const normalizedName = normalizeStudioWorkspaceName(name);
  return createDerivedState(normalized, {
    ...normalized,
    customWorkspaces: normalized.customWorkspaces.map((workspace, candidateIndex) =>
      candidateIndex === index
        ? Object.freeze({ ...workspace, name: normalizedName })
        : workspace
    ),
  });
}

function applyWorkspaceLayout(
  liveLayout: StudioWorkspaceLayout,
  workspaceLayout: StudioWorkspaceLayout,
  applyQuickActions: boolean
): StudioWorkspaceLayout {
  return freezeLayout({
    inspector: workspaceLayout.inspector,
    desktop: workspaceLayout.desktop,
    drawingPalettes: workspaceLayout.drawingPalettes,
    quickActions: applyQuickActions
      ? workspaceLayout.quickActions
      : liveLayout.quickActions,
    // The command bar is app chrome, not task layout: an artist arranges it once and expects it
    // wherever they work, so switching (and reloading) a workspace never rewrites it from the
    // target profile's snapshot.
    commandBar: liveLayout.commandBar ?? workspaceLayout.commandBar,
    // Device adaptations belong to the workspace being switched to, never to the live layout the
    // artist is leaving: keeping the old ones would silently apply one profile's pen-display
    // geometry to another profile's docks.
    deviceOverrides: workspaceLayout.deviceOverrides,
  });
}

/** Switches the active workspace, optionally preserving the user's live radial quick actions. */
export function switchStudioWorkspace(
  state: StudioWorkspaceState,
  id: StudioWorkspaceId
): StudioWorkspaceState {
  const normalized = normalizeStudioWorkspaceState(state);
  const workspace = resolveStudioWorkspace(normalized, id);
  if (!workspace) throw new RangeError(`Unknown workspace: ${id}`);
  // Re-selecting the current workspace is non-destructive. Reload is the explicit discard action.
  if (workspace.id === normalized.activeWorkspaceId) return normalized;
  return createDerivedState(normalized, {
    ...normalized,
    activeWorkspaceId: workspace.id,
    liveLayout: applyWorkspaceLayout(
      normalized.liveLayout,
      workspace.layout,
      normalized.applyQuickActionsOnSwitch
    ),
  });
}

/** Reloads the saved snapshot of the active workspace and discards unsaved layout changes. */
export function reloadStudioWorkspace(state: StudioWorkspaceState): StudioWorkspaceState {
  const normalized = normalizeStudioWorkspaceState(state);
  const workspace = resolveStudioWorkspace(normalized, normalized.activeWorkspaceId);
  if (!workspace) return normalized;
  return createDerivedState(normalized, {
    ...normalized,
    liveLayout: applyWorkspaceLayout(
      normalized.liveLayout,
      workspace.layout,
      normalized.applyQuickActionsOnSwitch
    ),
  });
}

export function deleteStudioWorkspace(
  state: StudioWorkspaceState,
  id: string
): StudioWorkspaceState {
  const normalized = normalizeStudioWorkspaceState(state);
  const index = requireCustomWorkspaceIndex(normalized, id);
  const customWorkspaces = normalized.customWorkspaces.filter(
    (_, candidateIndex) => candidateIndex !== index
  );
  if (normalized.activeWorkspaceId !== id) {
    return createDerivedState(normalized, { ...normalized, customWorkspaces });
  }

  const fallback = defaultWorkspace("storyboard");
  return createDerivedState(normalized, {
    ...normalized,
    activeWorkspaceId: fallback.id,
    liveLayout: applyWorkspaceLayout(
      normalized.liveLayout,
      fallback.layout,
      normalized.applyQuickActionsOnSwitch
    ),
    customWorkspaces,
  });
}

export function updateStudioWorkspaceLiveLayout(
  state: StudioWorkspaceState,
  liveLayout: StudioWorkspaceLayout
): StudioWorkspaceState {
  const normalized = normalizeStudioWorkspaceState(state);
  return createDerivedState(normalized, {
    ...normalized,
    liveLayout: normalizeWorkspaceLayout(liveLayout, normalized.liveLayout),
  });
}

export function updateStudioWorkspacePreferences(
  state: StudioWorkspaceState,
  preferences: {
    readonly mobileControlSide?: StudioMobileControlSide;
    readonly applyQuickActionsOnSwitch?: boolean;
  }
): StudioWorkspaceState {
  const normalized = normalizeStudioWorkspaceState(state);
  return createDerivedState(normalized, {
    ...normalized,
    mobileControlSide: MOBILE_CONTROL_SIDE_SET.has(preferences.mobileControlSide ?? "")
      ? (preferences.mobileControlSide as StudioMobileControlSide)
      : normalized.mobileControlSide,
    applyQuickActionsOnSwitch:
      typeof preferences.applyQuickActionsOnSwitch === "boolean"
        ? preferences.applyQuickActionsOnSwitch
        : normalized.applyQuickActionsOnSwitch,
  });
}

function sameDesktopLayout(
  left: StudioWorkspaceDesktopLayout,
  right: StudioWorkspaceDesktopLayout,
): boolean {
  return left.leftPanelOpen === right.leftPanelOpen
    && left.rightPanelOpen === right.rightPanelOpen
    && left.leftPanelWidth === right.leftPanelWidth
    && left.rightPanelWidth === right.rightPanelWidth;
}

function sameDeviceOverrides(
  left: StudioWorkspaceDeviceOverrides,
  right: StudioWorkspaceDeviceOverrides,
): boolean {
  return STUDIO_WORKSPACE_DEVICE_KINDS.every((device) => {
    const first = left[device];
    const second = right[device];
    if (!first || !second) return !first && !second;
    return first.controlSide === second.controlSide
      && sameDesktopLayout(first.desktop, second.desktop);
  });
}

/**
 * Resolve the dock geometry a workspace should present on one input surface.
 *
 * Returns the layout unchanged when the device has no override, so a caller can always render the
 * result without asking whether an override existed. Passing no device is the desktop default.
 */
export function resolveStudioWorkspaceDeviceLayout(
  layout: StudioWorkspaceLayout,
  device?: StudioWorkspaceDeviceKind | null,
): StudioWorkspaceLayout {
  const normalized = normalizeWorkspaceLayout(layout, defaultWorkspace("storyboard").layout);
  const override = device ? normalized.deviceOverrides[device] : undefined;
  if (!override || sameDesktopLayout(override.desktop, normalized.desktop)) return normalized;
  return freezeLayout({ ...normalized, desktop: override.desktop });
}

/**
 * Which side the on-canvas command surfaces belong on for one input surface.
 *
 * `StudioWorkspaceState.mobileControlSide` stays the owner-wide preference; a device override only
 * wins where a workspace deliberately set one (a left-handed pen-display grip, for instance).
 */
export function resolveStudioWorkspaceControlSide(
  state: StudioWorkspaceState,
  layout: StudioWorkspaceLayout,
  device?: StudioWorkspaceDeviceKind | null,
): StudioMobileControlSide {
  const normalized = normalizeWorkspaceLayout(layout, defaultWorkspace("storyboard").layout);
  const override = device ? normalized.deviceOverrides[device] : undefined;
  return override?.controlSide
    ?? (MOBILE_CONTROL_SIDE_SET.has(state.mobileControlSide) ? state.mobileControlSide : "right");
}

/**
 * Fold a layout as it was presented on one device back into the layout an artist authored.
 *
 * "Save this arrangement" means the arrangement on screen — but on a device that overrides the docks
 * the screen is showing the override, not the authored geometry. Writing what is on screen straight
 * back is what permanently overwrites a workspace with whatever device it was last opened on: save
 * once from a pen display and the desktop docks the artist authored are gone for good. The presented
 * dock geometry lands in that device's override slot instead, leaving the authored `desktop`
 * untouched, while everything deliberately device-independent — inspector, palettes, quick actions —
 * saves exactly as presented.
 *
 * Returns the presented layout unchanged when there was nothing to undo — no device, or a device
 * this profile does not override — because then the screen was already showing authored geometry.
 */
export function captureStudioWorkspaceDeviceLayout(
  authored: StudioWorkspaceLayout,
  presented: StudioWorkspaceLayout,
  device?: StudioWorkspaceDeviceKind | null,
): StudioWorkspaceLayout {
  const base = normalizeWorkspaceLayout(authored, defaultWorkspace("storyboard").layout);
  const shown = normalizeWorkspaceLayout(presented, base);
  // A device the profile does not override showed the authored geometry unchanged, so what came
  // back is authored geometry too — editing docks on a plain desktop must still move the profile,
  // not quietly mint an override for a surface nobody adapted.
  if (!device || !base.deviceOverrides[device]) return shown;
  const overrides: Record<string, StudioWorkspaceDeviceOverride> = {};
  for (const kind of STUDIO_WORKSPACE_DEVICE_KINDS) {
    // The presented layout carries the authored overrides through `resolveStudioWorkspaceDeviceLayout`,
    // but preferring it keeps an override the artist edited in this same session from being reverted.
    const existing = shown.deviceOverrides[kind] ?? base.deviceOverrides[kind];
    if (existing) overrides[kind] = existing;
  }
  if (sameDesktopLayout(shown.desktop, base.desktop)) {
    // Docks dragged back to the authored geometry read as clearing the override, not as pinning a
    // duplicate of it — otherwise a device could never return to inheriting. A handedness override
    // is a separate deliberate choice and survives: geometry matching again is not a reason to
    // un-flip the grip someone set for this device.
    const controlSide = overrides[device]?.controlSide ?? null;
    if (controlSide === null) delete overrides[device];
    else overrides[device] = Object.freeze({ desktop: base.desktop, controlSide });
  } else {
    overrides[device] = Object.freeze({
      desktop: shown.desktop,
      controlSide: overrides[device]?.controlSide ?? null,
    });
  }
  return freezeLayout({
    ...shown,
    desktop: base.desktop,
    deviceOverrides: Object.freeze(overrides),
  });
}

/**
 * Write one device's override onto a layout, or clear it so the device inherits again.
 *
 * The editing counterpart to `captureStudioWorkspaceDeviceLayout`: that one infers an override from
 * what happened to be on screen, this one takes a deliberate choice from the workspace menu. Passing
 * `null` removes the override rather than storing a copy of the authored geometry, so "inherits" and
 * "pinned to the same values" stay distinguishable.
 */
export function setStudioWorkspaceDeviceOverride(
  layout: StudioWorkspaceLayout,
  device: StudioWorkspaceDeviceKind,
  override: {
    readonly desktop?: StudioWorkspaceDesktopLayout;
    readonly controlSide?: StudioMobileControlSide | null;
  } | null,
): StudioWorkspaceLayout {
  const normalized = normalizeWorkspaceLayout(layout, defaultWorkspace("storyboard").layout);
  const overrides: Record<string, StudioWorkspaceDeviceOverride> = {};
  for (const kind of STUDIO_WORKSPACE_DEVICE_KINDS) {
    const existing = normalized.deviceOverrides[kind];
    if (existing) overrides[kind] = existing;
  }
  if (override === null) {
    delete overrides[device];
  } else {
    const existing = overrides[device];
    const controlSide = override.controlSide === undefined
      ? existing?.controlSide ?? null
      : override.controlSide;
    overrides[device] = Object.freeze({
      desktop: normalizeDesktopLayout(
        override.desktop ?? existing?.desktop ?? normalized.desktop,
        normalized.desktop,
      ),
      controlSide,
    });
  }
  return freezeLayout({ ...normalized, deviceOverrides: Object.freeze(overrides) });
}

/**
 * Classify the current input surface from observable runtime signals.
 *
 * Order matters and is deliberate: an explicit keyboard-driven session wins because it is a stated
 * intent rather than a hardware guess; a pen on a large coarse-pointer screen is a pen display; a
 * narrow viewport is mobile before it is merely touch. `null` means "no adaptation" and leaves the
 * workspace on its desktop geometry.
 */
export function resolveStudioWorkspaceDeviceKind(
  signals: StudioWorkspaceDeviceSignals,
): StudioWorkspaceDeviceKind | null {
  if (signals.keyboardDriven === true) return "keyboard";
  const touchCapable = (signals.maxTouchPoints ?? 0) > 0 || signals.coarsePointer === true;
  const narrow = typeof signals.viewportWidth === "number"
    && Number.isFinite(signals.viewportWidth)
    && signals.viewportWidth < 1_024;
  if (signals.pointerType === "pen") return narrow ? "mobile" : "pen-display";
  if (narrow && touchCapable) return "mobile";
  // An observed press outranks the hardware census. `maxTouchPoints > 0` says the panel *can* be
  // touched, which is true of most laptops now; believing it over a mouse the artist just clicked
  // handed every touchscreen laptop the handheld layout with both docks shut.
  if (signals.pointerType === "touch") return "touch";
  if (signals.pointerType === "mouse") return "mouse";
  // With nothing observed yet, only a coarse *primary* pointer is evidence of a finger-first
  // surface; touch points alone are not, and guessing wrong here lands on first paint.
  if (signals.coarsePointer === true) return "touch";
  return null;
}

/**
 * Layout equality for workspace dirtiness and autosave guards.
 *
 * `commandBar` is deliberately not compared: switching a workspace never rewrites it (see
 * `applyWorkspaceLayout`), so a customized bar must not make every workspace read as modified —
 * that badge sits in front of a button that overwrites the authored profile.
 */
export function areStudioWorkspaceLayoutsEqual(
  first: StudioWorkspaceLayout,
  second: StudioWorkspaceLayout,
  includeQuickActions = true
): boolean {
  const left = normalizeWorkspaceLayout(first, defaultWorkspace("storyboard").layout);
  const right = normalizeWorkspaceLayout(second, defaultWorkspace("storyboard").layout);
  if (!sameDeviceOverrides(left.deviceOverrides, right.deviceOverrides)) return false;
  if (
    left.inspector.primary !== right.inspector.primary ||
    left.inspector.image !== right.inspector.image ||
    left.inspector.document !== right.inspector.document ||
    left.desktop.leftPanelOpen !== right.desktop.leftPanelOpen ||
    left.desktop.rightPanelOpen !== right.desktop.rightPanelOpen ||
    left.desktop.leftPanelWidth !== right.desktop.leftPanelWidth ||
    left.desktop.rightPanelWidth !== right.desktop.rightPanelWidth ||
    left.drawingPalettes.order.some(
      (id, index) => right.drawingPalettes.order[index] !== id
    ) ||
    left.drawingPalettes.collapsed["sub-tools"] !==
      right.drawingPalettes.collapsed["sub-tools"] ||
    left.drawingPalettes.collapsed["tool-properties"] !==
      right.drawingPalettes.collapsed["tool-properties"] ||
    left.drawingPalettes.sizes["sub-tools"] !==
      right.drawingPalettes.sizes["sub-tools"] ||
    left.drawingPalettes.sizes["tool-properties"] !==
      right.drawingPalettes.sizes["tool-properties"] ||
    left.drawingPalettes.locks?.["sub-tools"].position !==
      right.drawingPalettes.locks?.["sub-tools"].position ||
    left.drawingPalettes.locks?.["sub-tools"].height !==
      right.drawingPalettes.locks?.["sub-tools"].height ||
    left.drawingPalettes.locks?.["tool-properties"].position !==
      right.drawingPalettes.locks?.["tool-properties"].position ||
    left.drawingPalettes.locks?.["tool-properties"].height !==
      right.drawingPalettes.locks?.["tool-properties"].height
  ) {
    return false;
  }
  if (!includeQuickActions) return true;
  return QUICK_ACTION_SLOTS.every(
    (slot) => left.quickActions.slots[slot] === right.quickActions.slots[slot]
  );
}

/**
 * Whether the live layout has drifted from the workspace it was applied from.
 *
 * Both sides are authored-form layouts: the live layout keeps device adaptation in its own
 * `deviceOverrides` slot rather than folded into `desktop` (see
 * `captureStudioWorkspaceDeviceLayout`), so this compares like with like. Were the live layout ever
 * stored device-resolved, every workspace would read as modified the moment it was opened on a pen
 * display — an edit nobody made, in front of a button that writes it over the authored docks.
 */
export function isStudioWorkspaceDirty(state: StudioWorkspaceState): boolean {
  const normalized = normalizeStudioWorkspaceState(state);
  const active = resolveStudioWorkspace(normalized, normalized.activeWorkspaceId);
  if (!active) return true;
  return !areStudioWorkspaceLayoutsEqual(
    normalized.liveLayout,
    active.layout,
    normalized.applyQuickActionsOnSwitch
  );
}

/**
 * One-time bridge from the pre-workspace inspector and quick-action storage values.
 * The legacy values become live layout only; no document or provider data is accepted.
 */
export function migrateLegacyStudioWorkspaceState(
  input: StudioWorkspaceMigrationInput
): StudioWorkspaceState {
  const decodedInspector = decodeBoundedRaw(
    input.inspector ?? DEFAULT_STUDIO_INSPECTOR_LAYOUT
  );
  const decodedQuickActions = decodeBoundedRaw(
    input.quickActions ?? DEFAULT_STUDIO_QUICK_ACTIONS
  );
  const inspector = normalizeStudioInspectorLayout(
    decodedInspector ?? DEFAULT_STUDIO_INSPECTOR_LAYOUT
  );
  const quickActions = normalizeStudioQuickActionsPreferences(
    decodedQuickActions ?? DEFAULT_STUDIO_QUICK_ACTIONS
  );
  const lineart = defaultWorkspace("lineart");

  return createState({
    version: STUDIO_WORKSPACE_STATE_VERSION,
    activeWorkspaceId: lineart.id,
    liveLayout: freezeLayout({
      inspector,
      desktop: {
        leftPanelOpen:
          typeof input.leftPanelOpen === "boolean" ? input.leftPanelOpen : true,
        rightPanelOpen:
          typeof input.rightPanelOpen === "boolean" ? input.rightPanelOpen : true,
        leftPanelWidth: clampPanelWidth(
          input.leftPanelWidth,
          STUDIO_WORKSPACE_LEFT_PANEL_WIDTH.default,
          STUDIO_WORKSPACE_LEFT_PANEL_WIDTH.minimum,
          STUDIO_WORKSPACE_LEFT_PANEL_WIDTH.maximum
        ),
        rightPanelWidth: clampPanelWidth(
          input.rightPanelWidth,
          STUDIO_WORKSPACE_RIGHT_PANEL_WIDTH.default,
          STUDIO_WORKSPACE_RIGHT_PANEL_WIDTH.minimum,
          STUDIO_WORKSPACE_RIGHT_PANEL_WIDTH.maximum
        ),
      },
      drawingPalettes: DEFAULT_STUDIO_DRAWING_PALETTE_LAYOUT,
      quickActions,
      // Pre-workspace preferences predate the device axis entirely, so the migrated live layout
      // starts with no per-device adaptation and inherits whichever profile the artist switches to.
      deviceOverrides: EMPTY_DEVICE_OVERRIDES,
    }),
    customWorkspaces: [],
    mobileControlSide:
      typeof input.mobileControlSide === "string" &&
      MOBILE_CONTROL_SIDE_SET.has(input.mobileControlSide)
        ? (input.mobileControlSide as StudioMobileControlSide)
        : "right",
    applyQuickActionsOnSwitch:
      typeof input.applyQuickActionsOnSwitch === "boolean"
        ? input.applyQuickActionsOnSwitch
        : true,
  });
}
