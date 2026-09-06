/**
 * §15.3 coverage table — types and row constructors.
 *
 * Split out of `studio-main-menu-group-spec.ts` when that file passed its line
 * budget. The budget exists to say *the declaration file's size is set by §15.3,
 * not by how much logic we let pile up in it* — so the fix is to take the logic
 * out, not to raise the number. What is left in the spec file is the table.
 *
 * Pure declarations only — no React, no browser, no page state.
 */

export type StudioMenuSpecCoverage = "present" | "partial" | "absent";

export interface StudioMenuSpecRow {
  /** §15.3 wording, verbatim. */
  readonly spec: string;
  readonly coverage: StudioMenuSpecCoverage;
  /** Qualified `<group>/<item>` ids of this group that answer the row. */
  readonly items: readonly string[];
  readonly note?: string;
}

export interface StudioMenuSpecExtra {
  /** Qualified `<group>/<item>` id we ship that §15.3 does not list. */
  readonly item: string;
  readonly note: string;
}

export interface StudioMenuGroupSpec {
  readonly id: string;
  /** Menubar copy (Korean product voice). */
  readonly labelKo: string;
  /** §15.3 heading. */
  readonly specName: string;
  /**
   * Menubar copy for non-Korean locales, for groups the regroup introduced whose
   * `studio.mainMenu.group.<id>.label` key has not shipped yet. Same escape hatch
   * the Help group already used; drop it once the packs carry the key.
   */
  readonly labelEn?: string;
  /**
   * Locale key to reuse for the group label. Set when the regroup renamed a
   * group that already shipped translations (draw → brush) so 75 locale packs
   * keep working.
   */
  readonly labelKey?: string;
  /** `false` for product groups §15.3 does not define. */
  readonly inV5Spec: boolean;
  /** Menubar tooltip copy for groups whose locale packs have not shipped yet. */
  readonly hintKo?: { readonly description: string; readonly tip?: string };
  readonly rows: readonly StudioMenuSpecRow[];
  readonly extras: readonly StudioMenuSpecExtra[];
}

export const has = (spec: string, ...items: string[]): StudioMenuSpecRow =>
  ({ spec, coverage: "present", items });

export const part = (spec: string, note: string, ...items: string[]): StudioMenuSpecRow =>
  ({ spec, coverage: "partial", items, note });

export const gap = (spec: string, note?: string): StudioMenuSpecRow =>
  note === undefined
    ? { spec, coverage: "absent", items: [] }
    : { spec, coverage: "absent", items: [], note };

export const ours = (item: string, note: string): StudioMenuSpecExtra => ({ item, note });
