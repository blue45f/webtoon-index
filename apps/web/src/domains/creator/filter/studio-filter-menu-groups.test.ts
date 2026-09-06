import { describe, expect, it, vi } from "vitest";

import { STUDIO_FILTER_DIALOG_CATALOG, studioFilterGroupLabel } from "./studio-filter-catalog";
import { orderStudioFilterMenuItems, STUDIO_FILTER_DIALOG_GROUP_ORDER } from "./studio-filter-menu-groups";

describe("shared filter menu and dialog groups", () => {
  it("does not offer an empty dialog category", () => {
    expect(new Set(STUDIO_FILTER_DIALOG_GROUP_ORDER).size).toBe(STUDIO_FILTER_DIALOG_GROUP_ORDER.length);
    for (const group of STUDIO_FILTER_DIALOG_GROUP_ORDER) {
      expect(STUDIO_FILTER_DIALOG_CATALOG.some((entry) => entry.group === group), group).toBe(true);
    }
    for (const entry of STUDIO_FILTER_DIALOG_CATALOG) {
      expect(STUDIO_FILTER_DIALOG_GROUP_ORDER).toContain(entry.group);
    }
  });

  it("groups every dialog exactly once and preserves each original action and disabled reason", () => {
    const input = STUDIO_FILTER_DIALOG_CATALOG.map((entry) => ({
      id: entry.kind,
      label: entry.title,
      onSelect: vi.fn(),
      disabled: true,
      unavailableReason: "문서 저장 중",
      sectionLabel: "기존 분류",
      separatorAfter: true,
    }));
    const original = input.map((item) => ({ ...item }));
    const actual = orderStudioFilterMenuItems(input);
    expect(input).toEqual(original);
    expect(actual).toHaveLength(input.length);
    expect(new Set(actual.map((item) => item.id)).size).toBe(input.length);
    expect(actual.map((item) => item.id).sort()).toEqual(input.map((item) => item.id).sort());
    const headings: string[] = [];
    let heading: string | undefined;
    for (const item of actual) {
      if (item.sectionLabel) { heading = item.sectionLabel; headings.push(heading); }
      const entry = STUDIO_FILTER_DIALOG_CATALOG.find((candidate) => candidate.kind === item.id)!;
      expect(heading, item.id).toBe(studioFilterGroupLabel(entry.group));
      const source = input.find((candidate) => candidate.id === item.id)!;
      expect(item.onSelect).toBe(source.onSelect);
      expect(item.disabled).toBe(true);
      expect(item.unavailableReason).toBe("문서 저장 중");
      item.onSelect();
      expect(source.onSelect).toHaveBeenCalledOnce();
    }
    expect(headings).toEqual(STUDIO_FILTER_DIALOG_GROUP_ORDER.map(studioFilterGroupLabel));
  });

  it("keeps last-filter first and never drops layer adjustments or future non-dialog commands", () => {
    const actual = orderStudioFilterMenuItems([
      { id: "levels", sectionLabel: "레이어 보정" },
      { id: "gaussian-blur" },
      { id: "last-filter" },
      { id: "tone-curve", separatorAfter: true },
      { id: "future-action" },
    ]);
    expect(actual.map((item) => item.id)).toEqual([
      "last-filter", "gaussian-blur", "levels", "tone-curve", "future-action",
    ]);
    expect(actual.find((item) => item.id === "gaussian-blur")?.sectionLabel).toBe("흐림·초점");
    expect(actual.find((item) => item.id === "levels")?.sectionLabel).toBe("레이어 보정");
  });
});
