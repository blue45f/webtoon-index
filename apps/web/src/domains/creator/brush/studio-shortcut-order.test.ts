import { describe, expect, it } from "vitest";

import { studioBrushCatalogItemById } from "./studio-brush-catalog";
import { STUDIO_SUB_TOOL_PALETTE_CATEGORIES } from "./studio-sub-tool-palette-data";

describe("compact palette purpose order", () => {
  it("keeps the six explicit groups and eighteen intentional shortcut positions", () => {
    expect(STUDIO_SUB_TOOL_PALETTE_CATEGORIES.map((category) => ({
      id: category.id,
      tools: category.tools.map((tool) => tool.id),
    }))).toEqual([
      { id: "pen", tools: ["gpen", "pen", "fountain-pen"] },
      { id: "pencil", tools: ["pencil", "pencil--side-shade", "charcoal--compressed-edge"] },
      { id: "brush", tools: ["watercolor", "marker", "gouache--matte-body", "oil--filbert-ribbon"] },
      { id: "airbrush", tools: ["airbrush", "spray", "splatter"] },
      { id: "eraser", tools: ["standard-eraser", "kneaded-eraser"] },
      { id: "manga", tools: ["screentone", "web-cross-hatch-pen", "web-radial-burst"] },
    ]);
  });

  it("resolves every displayed shortcut through the existing full catalogue ID", () => {
    const tools = STUDIO_SUB_TOOL_PALETTE_CATEGORIES.flatMap((category) => category.tools);
    expect(new Set(tools.map((tool) => tool.id)).size).toBe(18);
    for (const tool of tools) {
      const registered = studioBrushCatalogItemById(tool.id);
      expect(registered, tool.id).not.toBeNull();
      expect(registered?.name, tool.id).toBe(tool.name);
    }
  });
});
