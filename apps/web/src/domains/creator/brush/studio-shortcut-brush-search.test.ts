import { describe, expect, it } from "vitest";

import { searchStudioShortcutBrushes } from "./studio-shortcut-brush-search";
import { STUDIO_SUB_TOOL_PALETTE_CATEGORIES } from "./studio-sub-tool-palette-data";

const realTools = STUDIO_SUB_TOOL_PALETTE_CATEGORIES.flatMap((category) =>
  category.tools.map((tool) => ({ ...tool, categoryLabel: category.label })),
);

describe("shortcut brush search specificity", () => {
  it("resolves the former screentone name to its exact stable ID", () => {
    const tools = [
      ...realTools,
      { id: "unrelated-hatch", name: "해칭", hint: "스크린톤 대신 선으로 음영", categoryLabel: "만화·톤", searchAliases: ["스크린톤 표현"] },
    ];
    expect(searchStudioShortcutBrushes(tools, "스크린톤").map((tool) => tool.id)).toEqual(["screentone"]);
  });

  it("keeps generic pencil and manga queries broad rather than treating a current label as a unique alias", () => {
    const pencilIds = searchStudioShortcutBrushes(realTools, "연필").map((tool) => tool.id);
    expect(pencilIds).toContain("pencil");
    expect(pencilIds).toContain("pencil--side-shade");
    const mangaIds = searchStudioShortcutBrushes(realTools, "만화").map((tool) => tool.id);
    for (const id of ["screentone", "web-cross-hatch-pen", "web-radial-burst"]) expect(mangaIds).toContain(id);
  });

  it("normalizes full-width aliases and preserves literal AND-search of usage and old names", () => {
    expect(searchStudioShortcutBrushes(realTools, "  ＣＡＬＬＩＧＲＡＰＨＹ  ").map((tool) => tool.id)).toEqual(["fountain-pen"]);
    expect(searchStudioShortcutBrushes(realTools, "ＧＰＥＮ 선화").map((tool) => tool.id)).toEqual(["gpen"]);
    const tools = [{ id: "custom", name: "새 이름", searchAliases: ["예전(이름)"], hint: "옅은 명암" }];
    expect(searchStudioShortcutBrushes(tools, "예전(이름) 명암")).toEqual(tools);
    expect(searchStudioShortcutBrushes(tools, "예전.*")).toEqual([]);
  });

  it("returns each genuine canonical alias collision rather than silently dropping a matching tool", () => {
    const tools = [
      { id: "inkwash-pen", name: "유체 잉크 펜" },
      { id: "inkwash-water-brush", name: "물 번짐 붓" },
    ];
    expect(searchStudioShortcutBrushes(tools, "잉크워시")).toEqual(tools);
  });

  it("does not mutate the inventory or select a fallback for an empty result", () => {
    const frozen = Object.freeze([...realTools]);
    expect(searchStudioShortcutBrushes(frozen, " ")).toEqual(realTools);
    expect(searchStudioShortcutBrushes(frozen, "no-such-paint-tool")).toEqual([]);
    expect(frozen).toEqual(realTools);
  });
});
