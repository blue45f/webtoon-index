import {
  STUDIO_FILTER_DIALOG_CATALOG,
  STUDIO_FILTER_GROUP_ORDER,
  studioFilterGroupLabel,
} from "./studio-filter-catalog";

/** A surface offers only groups with reachable dialog kinds, in the shared purpose order. */
export const STUDIO_FILTER_DIALOG_GROUP_ORDER = Object.freeze(
  STUDIO_FILTER_GROUP_ORDER.filter((group) =>
    STUDIO_FILTER_DIALOG_CATALOG.some((entry) => entry.group === group),
  ),
);

type GroupableFilterMenuItem = {
  id: string;
  sectionLabel?: string;
  separatorAfter?: boolean;
};

/** Preserve callbacks, shortcuts, disabled reasons and IDs; change only presentation order. */
export function orderStudioFilterMenuItems<T extends GroupableFilterMenuItem>(
  items: readonly T[],
): T[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const groupedIds = new Set<string>();
  const grouped = STUDIO_FILTER_DIALOG_GROUP_ORDER.flatMap((group) => {
    const rows = STUDIO_FILTER_DIALOG_CATALOG
      .filter((entry) => entry.group === group)
      .flatMap((entry) => {
        const item = byId.get(entry.kind);
        if (!item) return [];
        groupedIds.add(item.id);
        return [item];
      });
    return rows.map((item, index) => ({
      ...item,
      sectionLabel: index === 0 ? studioFilterGroupLabel(group) : undefined,
      separatorAfter: index === rows.length - 1 ? true : undefined,
    }));
  });
  return [
    ...items.filter((item) => item.id === "last-filter"),
    ...grouped,
    ...items.filter((item) => item.id !== "last-filter" && !groupedIds.has(item.id)),
  ];
}
