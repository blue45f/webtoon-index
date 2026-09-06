/**
 * Coverage queries over the §15.3 spec table.
 *
 * Split out of `studio-main-menu-group-spec.ts` for the same reason as the row
 * constructors: the table's line budget must measure the table, not the readers
 * built on top of it. Nothing here declares coverage — it only counts what the
 * table already says.
 */

import { STUDIO_MENU_GROUP_SPEC } from "./studio-main-menu-group-spec";

import type { StudioMenuGroupSpec } from "./studio-main-menu-group-spec-model";

/** Menubar order. §15.3 order, with the product-only AI group before Window. */
export const STUDIO_MENU_GROUP_ORDER: readonly string[] = Object.freeze(
  STUDIO_MENU_GROUP_SPEC.map((group) => group.id),
);

export function studioMenuGroupSpec(id: string): StudioMenuGroupSpec | undefined {
  return STUDIO_MENU_GROUP_SPEC.find((group) => group.id === id);
}

/** Every qualified item id this table claims for a group, rows first then extras. */
export function studioMenuSpecClaimedItems(groupId: string): readonly string[] {
  const group = studioMenuGroupSpec(groupId);
  if (!group) return [];
  return [
    ...group.rows.flatMap((row) => row.items),
    ...group.extras.map((extra) => extra.item),
  ];
}

export interface StudioMenuSpecCoverageSummary {
  readonly specGroups: number;
  readonly groupsWithItems: number;
  readonly emptyGroupIds: readonly string[];
  readonly specRows: number;
  readonly rowsPresent: number;
  readonly rowsPartial: number;
  readonly rowsAbsent: number;
  readonly extras: number;
}

export function studioMenuSpecCoverageSummary(): StudioMenuSpecCoverageSummary {
  const spec = STUDIO_MENU_GROUP_SPEC.filter((group) => group.inV5Spec);
  const rows = spec.flatMap((group) => group.rows);
  const empty = spec.filter((group) => studioMenuSpecClaimedItems(group.id).length === 0);
  return {
    specGroups: spec.length,
    groupsWithItems: spec.length - empty.length,
    emptyGroupIds: empty.map((group) => group.id),
    specRows: rows.length,
    rowsPresent: rows.filter((row) => row.coverage === "present").length,
    rowsPartial: rows.filter((row) => row.coverage === "partial").length,
    rowsAbsent: rows.filter((row) => row.coverage === "absent").length,
    extras: STUDIO_MENU_GROUP_SPEC.reduce((sum, group) => sum + group.extras.length, 0),
  };
}

/** §15.3 rows we ship nothing for, as `Group ▸ row`. The Wave C shortfall list. */
export function studioMenuSpecMissingRows(): readonly string[] {
  return STUDIO_MENU_GROUP_SPEC.filter((group) => group.inV5Spec).flatMap((group) =>
    group.rows
      .filter((row) => row.coverage === "absent")
      .map((row) => `${group.specName} ▸ ${row.spec}`),
  );
}
