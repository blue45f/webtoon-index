import { describe, expect, it } from "vitest";

import { searchStudioShortcutBrushes } from "./studio-shortcut-brush-search";
import { STUDIO_SUB_TOOL_PALETTE_CATEGORIES } from "./studio-sub-tool-palette-data";

describe("purpose search does not behave like a former-name redirect", () => {
  it("shows all pen and line-art tools for 선화, even though G-pen has that explicit tag", () => {
    const tools = STUDIO_SUB_TOOL_PALETTE_CATEGORIES.flatMap((category) =>
      category.tools.map((tool) => ({ ...tool, categoryLabel: category.label })),
    );
    const ids = searchStudioShortcutBrushes(tools, "선화").map((tool) => tool.id);
    for (const id of ["gpen", "pen", "fountain-pen"]) expect(ids).toContain(id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("retains other matching tools when a canonical purpose alias happens to match exactly", () => {
    const tools = [
      { id: "inkwash-pen", name: "유체 잉크 펜" },
      { id: "inkwash-water-brush", name: "물 번짐 붓" },
      { id: "custom-wash", name: "나만의 붓", hint: "잉크워시 채색" },
    ];
    expect(searchStudioShortcutBrushes(tools, "잉크워시")).toEqual(tools);
  });

  it("does not hide a matching custom tool when the former-name destination is absent", () => {
    const tools = [{ id: "custom-tone", name: "스크린톤 실험" }];
    expect(searchStudioShortcutBrushes(tools, "스크린톤")).toEqual(tools);
  });
});
