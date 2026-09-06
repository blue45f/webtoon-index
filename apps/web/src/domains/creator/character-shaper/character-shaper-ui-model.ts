/**
 * Character Shaper — shell state model and pure UI helpers.
 *
 * Everything here is renderer-neutral: reducer-style updaters for `CharacterShaperUiState`,
 * roving-focus math for the 2-column card grid, slot hotkeys, availability badges, icon
 * resolution for slot metas, breakpoints, and the keydown layer registry the shell uses to run
 * ahead of the poser runtime's own window listener. No React, no DOM access except through
 * an `EventTarget` handed in by the caller (so the registry is testable under `environment: node`).
 */
import {
  Activity,
  Aperture,
  Baby,
  Brush,
  Circle,
  CircleDot,
  CircleUserRound,
  Crown,
  Drama,
  Ear,
  Eye,
  Footprints,
  Frown,
  Gem,
  Glasses,
  Hand,
  Heart,
  Laugh,
  Layers,
  Layers2,
  Move,
  Paintbrush,
  Palette,
  Pencil,
  PersonStanding,
  RectangleVertical,
  Ruler,
  Scan,
  ScanFace,
  Scissors,
  Shapes,
  Shirt,
  Smile,
  Sparkle,
  Sparkles,
  Spline,
  Star,
  Triangle,
  User,
  UserRound,
  VenetianMask,
  Wand,
  WandSparkles,
} from "lucide-react";

import { CHARACTER_MULTI_SLOT_KINDS, CHARACTER_SLOT_KINDS } from "./character-shaper-contract";

import type {
  CharacterGenreTag,
  CharacterHandSide,
  CharacterRecipe,
  CharacterSlotAvailability,
  CharacterSlotEntry,
  CharacterSlotKind,
  CharacterSlotMeta,
} from "./character-shaper-contract";
import type { CharacterShaperDrawerMode, CharacterShaperUiState } from "./character-shaper-ui-contract";
import type { LucideIcon } from "lucide-react";

/* -------------------------------------------------------------------------- */
/* Breakpoints                                                                  */
/* -------------------------------------------------------------------------- */

/** Desktop ≥ 1280 keeps four columns; tablet ≥ 768 folds the inspector into a slide-over. */
export const CHARACTER_SHAPER_BREAKPOINTS = Object.freeze({ desktop: 1280, tablet: 768 });

export const CHARACTER_SHAPER_DESKTOP_QUERY = `(min-width: ${CHARACTER_SHAPER_BREAKPOINTS.desktop}px)`;
export const CHARACTER_SHAPER_TABLET_QUERY = `(min-width: ${CHARACTER_SHAPER_BREAKPOINTS.tablet}px)`;

export type CharacterShaperLayout = "desktop" | "tablet" | "mobile";

export function resolveCharacterShaperLayout(width: number): CharacterShaperLayout {
  if (!Number.isFinite(width)) return "desktop";
  if (width >= CHARACTER_SHAPER_BREAKPOINTS.desktop) return "desktop";
  if (width >= CHARACTER_SHAPER_BREAKPOINTS.tablet) return "tablet";
  return "mobile";
}

/* -------------------------------------------------------------------------- */
/* Shell state                                                                  */
/* -------------------------------------------------------------------------- */

export const DEFAULT_CHARACTER_SHAPER_SLOT: CharacterSlotKind = "face-shape";

export type CharacterShaperSheetState = CharacterShaperUiState["mobileSheet"];

export const CHARACTER_SHAPER_SHEET_STATES: readonly CharacterShaperSheetState[] = ["collapsed", "half", "full"];

const SHEET_LABELS: Readonly<Record<CharacterShaperSheetState, string>> = {
  collapsed: "접힘",
  half: "반쯤 열림",
  full: "전체",
};

export function characterSheetStateLabel(state: CharacterShaperSheetState): string {
  return SHEET_LABELS[state];
}

export function characterSheetStateIndex(state: CharacterShaperSheetState): number {
  const index = CHARACTER_SHAPER_SHEET_STATES.indexOf(state);
  return index < 0 ? 0 : index;
}

export function expandCharacterSheet(state: CharacterShaperSheetState): CharacterShaperSheetState {
  const index = characterSheetStateIndex(state);
  return CHARACTER_SHAPER_SHEET_STATES[Math.min(index + 1, CHARACTER_SHAPER_SHEET_STATES.length - 1)] ?? state;
}

export function collapseCharacterSheet(state: CharacterShaperSheetState): CharacterShaperSheetState {
  const index = characterSheetStateIndex(state);
  return CHARACTER_SHAPER_SHEET_STATES[Math.max(index - 1, 0)] ?? state;
}

/** A handle tap cycles through all three sizes. */
export function cycleCharacterSheet(state: CharacterShaperSheetState): CharacterShaperSheetState {
  const index = characterSheetStateIndex(state);
  return CHARACTER_SHAPER_SHEET_STATES[(index + 1) % CHARACTER_SHAPER_SHEET_STATES.length] ?? state;
}

export function createCharacterShaperUiState(
  overrides: Partial<CharacterShaperUiState> = {},
): CharacterShaperUiState {
  return {
    activeSlot: DEFAULT_CHARACTER_SHAPER_SLOT,
    hoveredEntryId: null,
    query: "",
    tag: null,
    drawer: null,
    paintActive: false,
    inspectorOpen: true,
    advanced: false,
    mobileSheet: "half",
    ...overrides,
  };
}

export type CharacterShaperUiAction =
  | { readonly type: "select-slot"; readonly slot: CharacterSlotKind }
  | { readonly type: "hover-entry"; readonly entryId: string | null }
  | { readonly type: "set-query"; readonly query: string }
  | { readonly type: "set-tag"; readonly tag: string | null }
  | { readonly type: "open-drawer"; readonly mode: Exclude<CharacterShaperDrawerMode, null> }
  | { readonly type: "close-drawer" }
  | { readonly type: "set-paint"; readonly active: boolean }
  | { readonly type: "set-inspector"; readonly open: boolean }
  | { readonly type: "set-advanced"; readonly advanced: boolean }
  | { readonly type: "set-mobile-sheet"; readonly sheet: CharacterShaperSheetState }
  /** Esc: closes the topmost layer (drawer → expanded sheet → paint). Returns the same state when nothing is open. */
  | { readonly type: "escape"; readonly layout: CharacterShaperLayout };

/**
 * Returns the *same* object when an action changes nothing, so callers can detect "no layer was
 * closed" (the dialog then hands Esc to the host close).
 */
export function reduceCharacterShaperUiState(
  state: CharacterShaperUiState,
  action: CharacterShaperUiAction,
): CharacterShaperUiState {
  switch (action.type) {
    case "select-slot":
      if (state.activeSlot === action.slot) return state;
      return {
        ...state,
        activeSlot: action.slot,
        hoveredEntryId: null,
        query: "",
        tag: null,
        mobileSheet: state.mobileSheet === "collapsed" ? "half" : state.mobileSheet,
      };
    case "hover-entry":
      return state.hoveredEntryId === action.entryId ? state : { ...state, hoveredEntryId: action.entryId };
    case "set-query":
      return state.query === action.query ? state : { ...state, query: action.query };
    case "set-tag":
      return state.tag === action.tag ? state : { ...state, tag: action.tag };
    case "open-drawer":
      return state.drawer === action.mode ? state : { ...state, drawer: action.mode };
    case "close-drawer":
      return state.drawer === null ? state : { ...state, drawer: null };
    case "set-paint":
      return state.paintActive === action.active ? state : { ...state, paintActive: action.active };
    case "set-inspector":
      return state.inspectorOpen === action.open ? state : { ...state, inspectorOpen: action.open };
    case "set-advanced":
      return state.advanced === action.advanced ? state : { ...state, advanced: action.advanced };
    case "set-mobile-sheet":
      return state.mobileSheet === action.sheet ? state : { ...state, mobileSheet: action.sheet };
    case "escape":
      if (state.drawer !== null) return { ...state, drawer: null };
      if (action.layout === "mobile" && state.mobileSheet !== "collapsed") {
        return { ...state, mobileSheet: "collapsed" };
      }
      if (state.paintActive) return { ...state, paintActive: false };
      return state;
    default:
      return state;
  }
}

/* -------------------------------------------------------------------------- */
/* Roving focus — 2-column card grid                                           */
/* -------------------------------------------------------------------------- */

export type CharacterGridDirection = "left" | "right" | "up" | "down" | "home" | "end";

export const CHARACTER_SHELF_COLUMNS = 2;

/**
 * Next focus index for arrow/Home/End navigation. Moving down past the last row lands on the last
 * card (never wraps); moving up from the first row stays put. Always returns a valid index.
 */
export function moveCharacterGridIndex(
  index: number,
  count: number,
  direction: CharacterGridDirection,
  columns: number = CHARACTER_SHELF_COLUMNS,
): number {
  if (count <= 0) return 0;
  const cols = Math.max(1, Math.floor(columns));
  const last = count - 1;
  const current = Math.min(Math.max(0, Math.floor(index)), last);
  switch (direction) {
    case "left":
      return Math.max(0, current - 1);
    case "right":
      return Math.min(last, current + 1);
    case "up":
      return current - cols >= 0 ? current - cols : current;
    case "down":
      return current + cols <= last ? current + cols : Math.max(current, last);
    case "home":
      return 0;
    case "end":
      return last;
    default:
      return current;
  }
}

export function characterGridDirectionForKey(key: string): CharacterGridDirection | null {
  switch (key) {
    case "ArrowLeft":
      return "left";
    case "ArrowRight":
      return "right";
    case "ArrowUp":
      return "up";
    case "ArrowDown":
      return "down";
    case "Home":
      return "home";
    case "End":
      return "end";
    default:
      return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Slot hotkeys — 1–9, 0 → first ten slots (digits only)                       */
/* -------------------------------------------------------------------------- */

export const CHARACTER_SLOT_HOTKEYS: readonly string[] = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];

export function characterSlotHotkeyLabel(index: number): string | null {
  return CHARACTER_SLOT_HOTKEYS[index] ?? null;
}

export function characterSlotForHotkey(
  key: string,
  slots: readonly CharacterSlotKind[] = CHARACTER_SLOT_KINDS,
): CharacterSlotKind | null {
  const index = CHARACTER_SLOT_HOTKEYS.indexOf(key);
  if (index < 0) return null;
  return slots[index] ?? null;
}

/* -------------------------------------------------------------------------- */
/* Availability badge                                                           */
/* -------------------------------------------------------------------------- */

export type CharacterAvailabilityTone = "good" | "warn" | "bad";

export interface CharacterAvailabilityBadge {
  readonly label: string;
  readonly tone: CharacterAvailabilityTone;
  /** Plain-language reason; `null` for fully available entries. */
  readonly detail: string | null;
}

export function describeAvailabilityBadge(availability: CharacterSlotAvailability): CharacterAvailabilityBadge {
  switch (availability.status) {
    case "partial":
      return {
        label: "일부 적용",
        tone: "warn",
        detail: availability.reason ?? "이 모델에서는 일부 값만 적용됩니다.",
      };
    case "unavailable":
      return {
        label: "적용 불가",
        tone: "bad",
        detail: availability.reason ?? "이 모델에서는 적용할 수 없습니다.",
      };
    default:
      return { label: "적용 가능", tone: "good", detail: null };
  }
}

/* -------------------------------------------------------------------------- */
/* Slot icons                                                                    */
/* -------------------------------------------------------------------------- */

const ICON_TABLE: Readonly<Record<string, LucideIcon>> = {
  activity: Activity,
  aperture: Aperture,
  baby: Baby,
  brush: Brush,
  circle: Circle,
  circledot: CircleDot,
  circleuserround: CircleUserRound,
  crown: Crown,
  drama: Drama,
  ear: Ear,
  eye: Eye,
  footprints: Footprints,
  frown: Frown,
  gem: Gem,
  glasses: Glasses,
  hand: Hand,
  heart: Heart,
  laugh: Laugh,
  layers: Layers,
  layers2: Layers2,
  move: Move,
  paintbrush: Paintbrush,
  palette: Palette,
  pencil: Pencil,
  personstanding: PersonStanding,
  rectanglevertical: RectangleVertical,
  ruler: Ruler,
  scan: Scan,
  scanface: ScanFace,
  scissors: Scissors,
  shapes: Shapes,
  shirt: Shirt,
  smile: Smile,
  sparkle: Sparkle,
  sparkles: Sparkles,
  spline: Spline,
  star: Star,
  triangle: Triangle,
  user: User,
  userround: UserRound,
  venetianmask: VenetianMask,
  wand: Wand,
  wandsparkles: WandSparkles,
};

const SLOT_FALLBACK_ICON: Readonly<Record<CharacterSlotKind, LucideIcon>> = {
  "face-shape": ScanFace,
  eyes: Eye,
  irises: CircleDot,
  nose: Triangle,
  mouth: Smile,
  ears: Ear,
  hair: Scissors,
  body: PersonStanding,
  top: Shirt,
  bottom: Layers2,
  shoes: Footprints,
  accessory: Gem,
  expression: Drama,
  pose: Move,
  "hand-pose": Hand,
};

/**
 * Resolves a slot meta's lucide icon name ("ScanFace", "scan-face", "scanFace" all match). Unknown
 * names fall back to a per-slot default so the rail never renders an empty button.
 */
export function characterShaperSlotIcon(name: string | null | undefined, slot?: CharacterSlotKind): LucideIcon {
  const key = (name ?? "").replace(/[^a-z0-9]/giu, "").toLowerCase();
  const icon = key ? ICON_TABLE[key] : undefined;
  if (icon) return icon;
  return slot ? SLOT_FALLBACK_ICON[slot] : Shapes;
}

/* -------------------------------------------------------------------------- */
/* Rail groups                                                                   */
/* -------------------------------------------------------------------------- */

export type CharacterSlotGroup = CharacterSlotMeta["group"];

export const CHARACTER_SLOT_GROUP_LABELS: Readonly<Record<CharacterSlotGroup, string>> = {
  identity: "얼굴",
  figure: "몸·옷",
  performance: "표정·포즈",
};

export interface CharacterSlotMetaGroup {
  readonly group: CharacterSlotGroup;
  readonly label: string;
  readonly metas: readonly CharacterSlotMeta[];
}

/** Groups metas in first-appearance order of their `group`, preserving meta order inside a group. */
export function groupCharacterSlotMetas(metas: readonly CharacterSlotMeta[]): readonly CharacterSlotMetaGroup[] {
  const groups: CharacterSlotMetaGroup[] = [];
  const bucket = new Map<CharacterSlotGroup, CharacterSlotMeta[]>();
  for (const meta of metas) {
    let list = bucket.get(meta.group);
    if (!list) {
      list = [];
      bucket.set(meta.group, list);
      groups.push({ group: meta.group, label: CHARACTER_SLOT_GROUP_LABELS[meta.group], metas: list });
    }
    list.push(meta);
  }
  return groups;
}

/* -------------------------------------------------------------------------- */
/* Recipe helpers                                                               */
/* -------------------------------------------------------------------------- */

export function isCharacterMultiSlot(slot: CharacterSlotKind): boolean {
  return (CHARACTER_MULTI_SLOT_KINDS as readonly CharacterSlotKind[]).includes(slot);
}

/** Selected entry ids for a slot as an array (single slots yield zero or one id). */
export function characterSlotSelection(recipe: CharacterRecipe, slot: CharacterSlotKind): readonly string[] {
  const value: readonly string[] | string | null = recipe.slots[slot];
  if (value === null || value === undefined) return [];
  return typeof value === "string" ? [value] : value;
}

export function isCharacterEntrySelected(recipe: CharacterRecipe, entry: CharacterSlotEntry): boolean {
  return characterSlotSelection(recipe, entry.slot).includes(entry.id);
}

export function characterSlotDiffersFromBaseline(
  recipe: CharacterRecipe,
  baseline: CharacterRecipe,
  slot: CharacterSlotKind,
): boolean {
  const current = characterSlotSelection(recipe, slot);
  const base = characterSlotSelection(baseline, slot);
  if (current.length !== base.length) return true;
  const baseSet = new Set(base);
  return current.some((id) => !baseSet.has(id));
}

export const CHARACTER_HAND_SIDE_OPTIONS: readonly { readonly value: CharacterHandSide; readonly label: string }[] = [
  { value: "left", label: "왼손" },
  { value: "right", label: "오른손" },
  { value: "both", label: "양손" },
];

/* -------------------------------------------------------------------------- */
/* Shelf listing / filtering (through binding.catalog)                          */
/* -------------------------------------------------------------------------- */

export const CHARACTER_GENRE_TAG_ORDER: readonly CharacterGenreTag[] = [
  "romance",
  "school",
  "action",
  "fantasy",
  "modern",
  "comedy",
  "noir",
  "medical",
  "daily",
];

export function listShelfEntries(
  entries: readonly CharacterSlotEntry[],
  slot: CharacterSlotKind,
): readonly CharacterSlotEntry[] {
  return entries
    .filter((entry) => entry.slot === slot)
    .slice()
    .sort((left, right) => left.order - right.order || left.label.localeCompare(right.label, "ko"));
}

export function normalizeShelfQuery(query: string): string {
  return query.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
}

function entryMatchesQuery(
  entry: CharacterSlotEntry,
  query: string,
  tagLabels: Readonly<Partial<Record<CharacterGenreTag, string>>>,
): boolean {
  if (!query) return true;
  const haystack = [
    entry.label,
    entry.labelEn ?? "",
    entry.hint,
    ...entry.keywords,
    ...entry.tags,
    ...entry.tags.map((genre) => tagLabels[genre] ?? ""),
    entry.id.slice(entry.id.indexOf(":") + 1),
  ]
    .join(" ")
    .normalize("NFKC")
    .toLowerCase();
  return query.split(" ").every((term) => haystack.includes(term));
}

/**
 * Case-insensitive AND search over label / hint / keywords / tags (ids and, when given, their
 * Korean labels) plus the id suffix; `tag` narrows to one genre. Mirrors `searchCharacterSlotEntries`
 * but runs over `binding.catalog` so tests can stub the catalog.
 */
export function filterShelfEntries(
  entries: readonly CharacterSlotEntry[],
  query: string,
  tag: string | null,
  tagLabels: Readonly<Partial<Record<CharacterGenreTag, string>>> = {},
): readonly CharacterSlotEntry[] {
  const normalized = normalizeShelfQuery(query);
  return entries.filter(
    (entry) =>
      (tag ? (entry.tags as readonly string[]).includes(tag) : true) && entryMatchesQuery(entry, normalized, tagLabels),
  );
}

/** Genre tags present in the given entries, in canonical order. */
export function collectShelfTags(entries: readonly CharacterSlotEntry[]): readonly CharacterGenreTag[] {
  const present = new Set<CharacterGenreTag>();
  for (const entry of entries) for (const tag of entry.tags) present.add(tag);
  return CHARACTER_GENRE_TAG_ORDER.filter((tag) => present.has(tag));
}

/* -------------------------------------------------------------------------- */
/* Viewport HUD tables                                                          */
/* -------------------------------------------------------------------------- */

/** Subset of `CAMERA_PRESETS` ids shown in the HUD, in display order. */
export const CHARACTER_SHAPER_CAMERA_PRESET_IDS: readonly string[] = ["front", "threeQuarter", "bust", "fullBody", "closeup"];

export interface CharacterShaperLightingTone {
  readonly id: "morning" | "sunset" | "night" | "studio";
  readonly label: string;
}

export const CHARACTER_SHAPER_LIGHTING_TONES: readonly CharacterShaperLightingTone[] = [
  { id: "morning", label: "아침" },
  { id: "sunset", label: "노을" },
  { id: "night", label: "밤" },
  { id: "studio", label: "스튜디오" },
];

export function characterLightingToneLabel(id: string | null | undefined): string {
  return CHARACTER_SHAPER_LIGHTING_TONES.find((tone) => tone.id === id)?.label ?? "아침";
}

export function nextCharacterLightingTone(id: string | null | undefined): CharacterShaperLightingTone["id"] {
  const index = CHARACTER_SHAPER_LIGHTING_TONES.findIndex((tone) => tone.id === id);
  const next = CHARACTER_SHAPER_LIGHTING_TONES[(index + 1) % CHARACTER_SHAPER_LIGHTING_TONES.length];
  return next?.id ?? "morning";
}

/* -------------------------------------------------------------------------- */
/* Typing guard for single-key hotkeys                                          */
/* -------------------------------------------------------------------------- */

export function isCharacterShaperTypingTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object") return false;
  const element = target as { tagName?: unknown; isContentEditable?: unknown };
  const tag = typeof element.tagName === "string" ? element.tagName.toUpperCase() : "";
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return element.isContentEditable === true;
}

/* -------------------------------------------------------------------------- */
/* Keydown layers                                                               */
/* -------------------------------------------------------------------------- */

/** Returns `true` when the layer consumed the event; later (older) layers are then skipped. */
export type CharacterShaperKeyLayer = (event: KeyboardEvent) => boolean;

const keyLayers: CharacterShaperKeyLayer[] = [];
const installedTargets = new WeakSet<EventTarget>();

function dispatchCharacterShaperKeyLayers(event: Event): void {
  for (let index = keyLayers.length - 1; index >= 0; index -= 1) {
    const layer = keyLayers[index];
    if (layer && layer(event as KeyboardEvent)) return;
  }
}

/**
 * Registers a keydown layer (newest first). The capture-phase listener is installed on the target
 * the first time and deliberately never removed: the poser runtime installs its own capture
 * listener when the dialog mounts, and same-phase listeners fire in registration order, so
 * re-installing ours later would put it *behind* the runtime's Esc/⌘Z handling. With no layers
 * registered the listener is a no-op.
 */
export function pushCharacterShaperKeyLayer(layer: CharacterShaperKeyLayer, target: EventTarget): () => void {
  if (!installedTargets.has(target)) {
    installedTargets.add(target);
    target.addEventListener("keydown", dispatchCharacterShaperKeyLayers, true);
  }
  keyLayers.push(layer);
  return () => {
    const index = keyLayers.lastIndexOf(layer);
    if (index >= 0) keyLayers.splice(index, 1);
  };
}

/** Test seam: number of active layers. */
export function countCharacterShaperKeyLayers(): number {
  return keyLayers.length;
}
