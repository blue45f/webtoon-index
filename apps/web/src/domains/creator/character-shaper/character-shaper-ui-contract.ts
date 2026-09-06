/**
 * Character Shaper — UI/binding contract shared by the shell, the panels, and the host binding.
 *
 * Parallel owners implement against these shapes; do not widen them ad hoc. If a component needs
 * more host data, read it from `h` (the poser host) rather than adding a prop here.
 */

import type {
  CharacterApplyPlan,
  CharacterCapabilityProfile,
  CharacterHandSide,
  CharacterHostSnapshot,
  CharacterRecipe,
  CharacterSlotAvailability,
  CharacterSlotCatalog,
  CharacterSlotEntry,
  CharacterSlotKind,
} from "./character-shaper-contract";
import type { StudioVrmPoserHost } from "../vrm/StudioVrmPoserHost";
import type { ReactNode } from "react";

/* -------------------------------------------------------------------------- */
/* Binding (implemented by useCharacterShaperBinding)                          */
/* -------------------------------------------------------------------------- */

export interface CharacterShaperHistoryState {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  /** Labels of the last few committed steps, newest first (for the summary bar tooltip). */
  readonly recentLabels: readonly string[];
  readonly length: number;
}

export interface CharacterShaperCommitResult {
  readonly ok: boolean;
  readonly plan: CharacterApplyPlan;
  /** Set when `ok` is false: why the host refused (capture in progress, model missing, …). */
  readonly reason: string | null;
}

export interface CharacterShaperBinding {
  readonly catalog: CharacterSlotCatalog;
  readonly profile: CharacterCapabilityProfile;
  readonly snapshot: CharacterHostSnapshot;
  readonly recipe: CharacterRecipe;
  /** Session baseline captured when the dialog opened (used by hold-to-compare and reset). */
  readonly baselineRecipe: CharacterRecipe;
  readonly history: CharacterShaperHistoryState;
  /** Non-null while the host cannot accept mutations; the UI shows this instead of failing silently. */
  readonly busyReason: string | null;
  readonly handSide: CharacterHandSide;
  readonly compareActive: boolean;
  evaluate(entry: CharacterSlotEntry): CharacterSlotAvailability;
  /** Build the plan without executing it (used for tooltips / inspector explanations). */
  plan(entry: CharacterSlotEntry): CharacterApplyPlan;
  commit(entry: CharacterSlotEntry): CharacterShaperCommitResult;
  /** Clear a slot back to "없음 / 원본" where the slot supports it. */
  clear(slot: CharacterSlotKind): CharacterShaperCommitResult | null;
  /** Remove one entry from a multi slot (accessory). */
  remove(slot: CharacterSlotKind, entryId: string): CharacterShaperCommitResult | null;
  setHandSide(side: CharacterHandSide): void;
  undo(): void;
  redo(): void;
  /** Hold-to-compare: `true` temporarily shows the baseline, `false` restores the current state. */
  setCompareActive(active: boolean): void;
  resetToBaseline(): void;
  /** Precision edits from the inspector; each call is one history step. */
  commitFaceParams(face: Partial<CharacterHostSnapshot["forgeFace"]>, label: string): void;
  commitSemanticMorphs(morphs: CharacterHostSnapshot["semanticMorphs"], label: string): void;
  commitHairParams(hair: Record<string, unknown>, label: string): void;
  commitColor(target: keyof CharacterRecipe["colors"], color: string | null): void;
}

/* -------------------------------------------------------------------------- */
/* Shell state                                                                  */
/* -------------------------------------------------------------------------- */

export type CharacterShaperDrawerMode = "reference" | "photo" | "webcam" | null;

export interface CharacterShaperUiState {
  readonly activeSlot: CharacterSlotKind;
  readonly hoveredEntryId: string | null;
  readonly query: string;
  readonly tag: string | null;
  readonly drawer: CharacterShaperDrawerMode;
  readonly paintActive: boolean;
  readonly inspectorOpen: boolean;
  readonly advanced: boolean;
  readonly mobileSheet: "collapsed" | "half" | "full";
}

/* -------------------------------------------------------------------------- */
/* Component props (fixed names; each component lives in the file of its name) */
/* -------------------------------------------------------------------------- */

export interface StudioCharacterShaperDialogProps {
  readonly h: StudioVrmPoserHost;
  readonly binding: CharacterShaperBinding;
  /** Render the legacy builder instead (고급 편집). The shell owns the toggle button. */
  readonly onOpenAdvanced?: () => void;
}

export interface CharacterShaperSummaryBarProps {
  readonly h: StudioVrmPoserHost;
  readonly binding: CharacterShaperBinding;
  readonly advanced: boolean;
  readonly onToggleAdvanced: () => void;
  readonly onClose: () => void;
  readonly titleId: string;
  readonly descriptionId: string;
}

export interface CharacterShaperSlotRailProps {
  readonly binding: CharacterShaperBinding;
  readonly activeSlot: CharacterSlotKind;
  readonly onSelectSlot: (slot: CharacterSlotKind) => void;
  readonly orientation: "vertical" | "horizontal";
}

export interface CharacterShaperShelfProps {
  readonly binding: CharacterShaperBinding;
  readonly slot: CharacterSlotKind;
  readonly query: string;
  readonly tag: string | null;
  readonly onQueryChange: (query: string) => void;
  readonly onTagChange: (tag: string | null) => void;
  readonly onHoverEntry: (entryId: string | null) => void;
  readonly onCommitEntry: (entry: CharacterSlotEntry) => void;
}

export interface CharacterSlotCardProps {
  readonly entry: CharacterSlotEntry;
  readonly availability: CharacterSlotAvailability;
  readonly selected: boolean;
  readonly tabIndex: 0 | -1;
  readonly onCommit: (entry: CharacterSlotEntry) => void;
  readonly onHover: (entryId: string | null) => void;
  readonly onFocus: (entryId: string) => void;
  readonly onKeyNavigate: (direction: "left" | "right" | "up" | "down" | "home" | "end") => void;
}

export interface CharacterShaperInspectorProps {
  readonly h: StudioVrmPoserHost;
  readonly binding: CharacterShaperBinding;
  readonly slot: CharacterSlotKind;
  readonly hoveredEntryId: string | null;
  readonly onClose?: () => void;
}

export interface CharacterShaperReferenceDrawerProps {
  readonly h: StudioVrmPoserHost;
  readonly binding: CharacterShaperBinding;
  readonly mode: Exclude<CharacterShaperDrawerMode, null>;
  readonly onModeChange: (mode: Exclude<CharacterShaperDrawerMode, null>) => void;
  readonly onClose: () => void;
}

export interface CharacterShaperOutputDockProps {
  readonly h: StudioVrmPoserHost;
  readonly binding: CharacterShaperBinding;
  readonly drawer: CharacterShaperDrawerMode;
  readonly onOpenDrawer: (mode: Exclude<CharacterShaperDrawerMode, null>) => void;
  readonly paintActive: boolean;
  readonly onTogglePaint: () => void;
  readonly compact: boolean;
}

export interface CharacterShaperPaintHudProps {
  readonly h: StudioVrmPoserHost;
  readonly onExit: () => void;
}

export interface CharacterShaperViewportHudProps {
  readonly h: StudioVrmPoserHost;
  readonly binding: CharacterShaperBinding;
  readonly compact: boolean;
}

export interface CharacterShaperMobileSheetProps {
  readonly state: CharacterShaperUiState["mobileSheet"];
  readonly onStateChange: (state: CharacterShaperUiState["mobileSheet"]) => void;
  readonly title: string;
  readonly children: ReactNode;
}
