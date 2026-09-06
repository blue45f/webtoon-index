import { describe, expect, it } from "vitest";

import { createLayerGroup, type LayerGroup } from "../studio-layers";

import {
  DEFAULT_STUDIO_LAYER_NAVIGATOR_FILTERS,
  buildStudioLayerNavigatorNodes,
  countActiveStudioLayerFilters,
  countStudioLayerSelectionOutsideResults,
  filterStudioLayerNavigatorItems,
  normalizeStudioLayerColor,
  normalizeStudioLayerNavigatorFilters,
  normalizeStudioLayerRole,
  reduceStudioLayerSelection,
  selectStudioLayerRange,
  studioLayerKindForType,
  summarizeStudioLayerNavigator,
  toggleStudioLayerSelection,
  type StudioLayerNavigatorFilters,
  type StudioLayerNavigatorItem,
} from "./studio-layer-navigator";

function layer(
  id: string,
  type: string,
  patch: Partial<StudioLayerNavigatorItem> = {}
): StudioLayerNavigatorItem {
  return {
    id,
    type,
    label: patch.label ?? id,
    zIndex: patch.zIndex ?? 0,
    ...patch,
  };
}

const noFilters = (): StudioLayerNavigatorFilters => ({
  ...DEFAULT_STUDIO_LAYER_NAVIGATOR_FILTERS,
  flags: [],
});

describe("studio layer navigator filter normalization", () => {
  it("falls back field-by-field and de-duplicates valid flags", () => {
    expect(
      normalizeStudioLayerNavigatorFilters({
        kind: "image",
        visibility: "wrong",
        lock: "locked",
        role: "lineart",
        color: "blue",
        flags: ["ai", "wrong", "ai", "masked"],
      })
    ).toEqual({
      kind: "image",
      visibility: "all",
      lock: "locked",
      role: "lineart",
      color: "blue",
      flags: ["ai", "masked"],
    });
  });

  it("returns an isolated default for malformed values", () => {
    const first = normalizeStudioLayerNavigatorFilters(null);
    const second = normalizeStudioLayerNavigatorFilters("bad");
    expect(first).toEqual(DEFAULT_STUDIO_LAYER_NAVIGATOR_FILTERS);
    expect(second).toEqual(DEFAULT_STUDIO_LAYER_NAVIGATOR_FILTERS);
    expect(first).not.toBe(second);
  });

  it("counts every active filter dimension and flag", () => {
    expect(
      countActiveStudioLayerFilters({
        kind: "draw",
        visibility: "visible",
        lock: "unlocked",
        role: "lineart",
        color: "none",
        flags: ["reference", "masked"],
      })
    ).toBe(7);
  });

  it("drops unknown persisted production role and color metadata", () => {
    expect(normalizeStudioLayerRole("lineart")).toBe("lineart");
    expect(normalizeStudioLayerRole("admin")).toBeUndefined();
    expect(normalizeStudioLayerRole({ toString: () => "lineart" })).toBeUndefined();
    expect(normalizeStudioLayerColor("violet")).toBe("violet");
    expect(normalizeStudioLayerColor("transparent")).toBeUndefined();
  });
});

describe("studio layer type and text search", () => {
  const groups: LayerGroup[] = [createLayerGroup("g-lines", "주인공 선화")];
  const items = [
    layer("image", "image", { label: "배경 거리", zIndex: 0 }),
    layer("dialogue", "bubble", {
      label: "민수 말풍선",
      textContent: "오늘도 힘내자",
      zIndex: 1,
    }),
    layer("ink", "draw", {
      label: "G펜 얼굴선",
      groupId: "g-lines",
      role: "lineart",
      zIndex: 2,
    }),
    layer("speed", "speedLines", { label: "질주 효과", zIndex: 3 }),
  ];

  it("maps every shipped element type into a stable navigator kind", () => {
    expect(studioLayerKindForType("image")).toBe("image");
    expect(studioLayerKindForType("text")).toBe("text");
    expect(studioLayerKindForType("bubble")).toBe("bubble");
    expect(studioLayerKindForType("draw")).toBe("draw");
    expect(studioLayerKindForType("frame")).toBe("frame");
    expect(studioLayerKindForType("sticker")).toBe("sticker");
    expect(studioLayerKindForType("focusLines")).toBe("effect");
    expect(studioLayerKindForType("speedLines")).toBe("effect");
    expect(studioLayerKindForType("future-layer")).toBe("other");
    expect(studioLayerKindForType(undefined)).toBe("other");
  });

  it("finds names, dialogue text, group path, and Korean/English type aliases", () => {
    expect(filterStudioLayerNavigatorItems(items, groups, "거리", noFilters()).map((r) => r.item.id)).toEqual([
      "image",
    ]);
    expect(filterStudioLayerNavigatorItems(items, groups, "힘내자", noFilters()).map((r) => r.item.id)).toEqual([
      "dialogue",
    ]);
    expect(filterStudioLayerNavigatorItems(items, groups, "주인공 선화", noFilters()).map((r) => r.item.id)).toEqual([
      "ink",
    ]);
    expect(filterStudioLayerNavigatorItems(items, groups, "speech", noFilters()).map((r) => r.item.id)).toEqual([
      "dialogue",
    ]);
    expect(filterStudioLayerNavigatorItems(items, groups, "ＳＰＥＥＣＨ", noFilters()).map((r) => r.item.id)).toEqual([
      "dialogue",
    ]);
    expect(filterStudioLayerNavigatorItems(items, groups, "속도선", noFilters()).map((r) => r.item.id)).toEqual([
      "speed",
    ]);
  });

  it("requires every normalized query term", () => {
    expect(filterStudioLayerNavigatorItems(items, groups, "주인공 G펜", noFilters()).map((r) => r.item.id)).toEqual([
      "ink",
    ]);
    expect(filterStudioLayerNavigatorItems(items, groups, "주인공 배경", noFilters())).toEqual([]);
  });
});

describe("professional state, role, and color filters", () => {
  const hiddenGroup = { ...createLayerGroup("hidden-group", "숨긴 폴더"), hidden: true };
  const lockedGroup = { ...createLayerGroup("locked-group", "잠근 폴더"), locked: true };
  const items = [
    layer("reference", "image", {
      fillReference: true,
      alphaLocked: true,
      masked: true,
      aiGenerated: true,
      role: "lineart",
      color: "blue",
      zIndex: 0,
    }),
    layer("hidden-child", "text", { groupId: hiddenGroup.id, zIndex: 1 }),
    layer("locked-child", "bubble", { groupId: lockedGroup.id, zIndex: 2 }),
    layer("plain", "draw", { role: "rough", clipBelow: true, animated: true, zIndex: 3 }),
  ];
  const groups = [hiddenGroup, lockedGroup];

  it("uses effective group visibility and lock state", () => {
    const hidden = filterStudioLayerNavigatorItems(items, groups, "", {
      ...noFilters(),
      visibility: "hidden",
    });
    const locked = filterStudioLayerNavigatorItems(items, groups, "", {
      ...noFilters(),
      lock: "locked",
    });
    expect(hidden.map((result) => result.item.id)).toEqual(["hidden-child"]);
    expect(locked.map((result) => result.item.id)).toEqual(["locked-child"]);
    expect(hidden[0]?.effectivelyHidden).toBe(true);
    expect(locked[0]?.effectivelyLocked).toBe(true);
  });

  it("combines kind, role, color, and all requested flags with AND semantics", () => {
    expect(
      filterStudioLayerNavigatorItems(items, groups, "", {
        kind: "image",
        visibility: "visible",
        lock: "unlocked",
        role: "lineart",
        color: "blue",
        flags: ["reference", "alpha-locked", "masked", "ai"],
      }).map((result) => result.item.id)
    ).toEqual(["reference"]);
    expect(
      filterStudioLayerNavigatorItems(items, groups, "", {
        ...noFilters(),
        flags: ["clipped", "animated"],
      }).map((result) => result.item.id)
    ).toEqual(["plain"]);
  });

  it("supports explicit unassigned role and no-color filters", () => {
    expect(
      filterStudioLayerNavigatorItems(items, groups, "", {
        ...noFilters(),
        role: "unassigned",
        color: "none",
      }).map((result) => result.item.id)
    ).toEqual(["hidden-child", "locked-child"]);
  });
});

describe("statistics and large documents", () => {
  it("summarizes effective states and 500 layers deterministically", () => {
    const group = { ...createLayerGroup("g", "잠긴 그룹"), locked: true };
    const items = Array.from({ length: 500 }, (_, index) =>
      layer(`layer-${index}`, index % 2 === 0 ? "image" : "draw", {
        groupId: index < 20 ? group.id : undefined,
        hidden: index % 10 === 0,
        fillReference: index % 50 === 0,
        masked: index % 25 === 0,
        aiGenerated: index % 100 === 0,
        zIndex: index,
      })
    );
    const stats = summarizeStudioLayerNavigator(items, [group]);
    expect(stats.total).toBe(500);
    expect(stats.byKind.image).toBe(250);
    expect(stats.byKind.draw).toBe(250);
    expect(stats.byKind.other).toBe(0);
    expect(stats.hidden).toBe(50);
    expect(stats.visible).toBe(450);
    expect(stats.locked).toBe(20);
    expect(stats.referenced).toBe(10);
    expect(stats.masked).toBe(20);
    expect(stats.ai).toBe(5);
    expect(filterStudioLayerNavigatorItems(items, [group], "layer-49", noFilters())).toHaveLength(11);
  });
});

describe("safe layer display nodes", () => {
  it("keeps corrupted non-contiguous group segments with unique keys and temporarily expands filters", () => {
    const group = { ...createLayerGroup("g", "선화"), collapsed: true };
    const items = [
      layer("a", "draw", { groupId: group.id, zIndex: 2 }),
      layer("outside", "text", { zIndex: 1 }),
      layer("b", "draw", { groupId: group.id, zIndex: 0 }),
    ];
    const entries = filterStudioLayerNavigatorItems(items, [group], "", noFilters());
    const nodes = buildStudioLayerNavigatorNodes(entries, [group], {
      filterActive: true,
    });
    expect(nodes.map((node) => node.key)).toEqual(["group:g:0", "item:outside", "group:g:1"]);
    expect(nodes.filter((node) => node.kind === "group").every((node) => node.expanded)).toBe(true);
    expect(group.collapsed).toBe(true);
  });

  it("shows empty groups only when the unfiltered list is active", () => {
    const empty = createLayerGroup("empty", "빈 폴더");
    expect(
      buildStudioLayerNavigatorNodes([], [empty], { filterActive: false }).map((node) => node.key)
    ).toEqual(["group:empty:empty"]);
    expect(buildStudioLayerNavigatorNodes([], [empty], { filterActive: true })).toEqual([]);
  });
});

describe("layer-list multi selection", () => {
  it("selects an inclusive shift range in current display order", () => {
    expect(selectStudioLayerRange(["front", "middle", "back"], "front", "back")).toEqual([
      "front",
      "middle",
      "back",
    ]);
    expect(selectStudioLayerRange(["front", "middle", "back"], "back", "middle")).toEqual([
      "middle",
      "back",
    ]);
    expect(selectStudioLayerRange(["front", "middle", "back"], null, "middle")).toEqual(["middle"]);
    expect(selectStudioLayerRange(["front"], "front", "missing")).toEqual([]);
  });

  it("toggles unique ids and enforces the supplied selection ceiling", () => {
    expect(toggleStudioLayerSelection(["a", "a", "b"], "a")).toEqual(["b"]);
    expect(toggleStudioLayerSelection(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleStudioLayerSelection(["a", "b"], "c", 2)).toEqual(["a", "b"]);
  });

  it("reduces replace, toggle, range, and additive range modes", () => {
    const visible = ["front", "middle", "back"];
    expect(
      reduceStudioLayerSelection({
        orderedVisibleIds: visible,
        currentIds: ["outside"],
        anchorId: null,
        targetId: "middle",
        mode: "replace",
      })
    ).toEqual({ selectedIds: ["middle"], anchorId: "middle" });
    expect(
      reduceStudioLayerSelection({
        orderedVisibleIds: visible,
        currentIds: ["front"],
        anchorId: "front",
        targetId: "middle",
        mode: "toggle",
      }).selectedIds
    ).toEqual(["front", "middle"]);
    expect(
      reduceStudioLayerSelection({
        orderedVisibleIds: visible,
        currentIds: ["outside"],
        anchorId: "front",
        targetId: "back",
        mode: "range",
      }).selectedIds
    ).toEqual(visible);
    expect(
      reduceStudioLayerSelection({
        orderedVisibleIds: visible,
        currentIds: ["outside"],
        anchorId: "middle",
        targetId: "back",
        mode: "add-range",
      }).selectedIds
    ).toEqual(["outside", "middle", "back"]);
  });

  it("falls back from an out-of-filter anchor and reports hidden selections", () => {
    expect(
      reduceStudioLayerSelection({
        orderedVisibleIds: ["a", "b"],
        currentIds: ["outside"],
        anchorId: "outside",
        targetId: "b",
        mode: "range",
      })
    ).toEqual({ selectedIds: ["b"], anchorId: "b" });
    expect(countStudioLayerSelectionOutsideResults(["a", "outside", "outside"], ["a", "b"])).toBe(1);
  });
});
