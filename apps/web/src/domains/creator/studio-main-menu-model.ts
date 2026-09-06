import type { StudioToolHintSpec } from "./studio-tool-hints";
import type { LucideIcon } from "lucide-react";

export type StudioMainMenuHintKey =
  | "color-vision:none"
  | "color-vision:grayscale"
  | "color-vision:protanopia"
  | "color-vision:deuteranopia"
  | "color-vision:tritanopia";

export interface StudioMainMenuItem {
  id: string;
  label: string;
  /**
   * `CommandId` in `studio-command-catalog.ts` this item dispatches. Menu items
   * reference the catalog instead of declaring a second command surface; the
   * `onSelect` closure stays the host-supplied execution path until the registry
   * absorbs it (see `docs/rewrite/command-consolidation-plan.md` §3-2).
   */
  commandId?: string;
  /**
   * `<group>/<item>` the item was declared under before the §15.3 regroup.
   * Localization and disabled-reason lookups use this instead of the live group,
   * so relocating an item cannot silently change its copy in 75 locale packs.
   */
  legacyPath?: string;
  shortcut?: string;
  icon?: LucideIcon;
  hint?: StudioToolHintSpec;
  /** Resolves rich copy inside the lazily loaded menu instead of the eager Studio graph. */
  hintKey?: StudioMainMenuHintKey;
  /** State for non-destructive view toggles such as canvas flip and grayscale preview. */
  checked?: boolean;
  /** Checked menu items default to checkbox semantics; exclusive choices use radio semantics. */
  selectionRole?: "checkbox" | "radio";
  disabled?: boolean;
  unavailableReason?: string;
  danger?: boolean;
  separatorAfter?: boolean;
  /**
   * Explicit opt-in for unified-search direct activation. The default stays help-only:
   * save, publish, delete and other consequential commands must never become executable
   * merely because they gained a menu row. Opted-in rows reuse this item's `onSelect`
   * closure, so menu and search cannot drift into two implementations.
   */
  searchActivation?: "execute";
  /**
   * Caption drawn above this row when a workflow composite presents rows
   * from several catalogue groups. Set by `studio-main-menu-presentation.ts`,
   * never by item modules — the catalogue does not know how it is presented.
   */
  sectionLabel?: string;
  onSelect: () => void;
}

export interface StudioMainMenuGroup {
  id: string;
  label: string;
  /**
   * Locale key to use for the group label instead of the id-derived one. Set for
   * groups the §15.3 regroup renamed (draw → brush) so shipped translations keep
   * resolving.
   */
  labelKey?: string;
  items: readonly StudioMainMenuItem[];
}

export interface StudioMainMenuProps {
  groups: readonly StudioMainMenuGroup[];
  /** First specialist extension group in the already-presented list. */
  specialistBoundaryGroupId?: string | null;
  className?: string;
}
