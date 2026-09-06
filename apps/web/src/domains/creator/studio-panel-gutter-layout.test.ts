import { describe, expect, it } from "vitest";

import {
  createPanelLayoutTree,
  evaluateLayoutBounds,
  extractLeafPanelBounds,
  splitPanel,
} from "./studio-panel-gutter-layout";

describe("Studio Responsive Panel Gutter & Frame Layout Solver", () => {
  it("creates root panel and splits vertically with gutter spacing", () => {
    let tree = createPanelLayoutTree({
      id: "tree_1",
      rootBounds: { x: 0, y: 0, width: 800, height: 1000 },
      rootId: "p_root",
    });

    expect(tree.root.id).toBe("p_root");
    expect(tree.root.computedBounds?.height).toBe(1000);

    // Split vertically (Top / Bottom) 50:50 with 20px gutter
    tree = splitPanel(tree, "p_root", "vertical", 0.5, 20);

    const leaves = extractLeafPanelBounds(tree);
    expect(leaves).toHaveLength(2);

    // Usable height = 1000 - 20 = 980 -> 490 each
    expect(leaves[0].panelId).toBe("p_root_a");
    expect(leaves[0].bounds.height).toBe(490);
    expect(leaves[0].bounds.y).toBe(0);

    expect(leaves[1].panelId).toBe("p_root_b");
    expect(leaves[1].bounds.height).toBe(490);
    expect(leaves[1].bounds.y).toBe(510); // 490 + 20 gutter
  });

  it("splits nested panels horizontally and reflows on canvas resize", () => {
    let tree = createPanelLayoutTree({
      id: "tree_2",
      rootBounds: { x: 0, y: 0, width: 800, height: 1000 },
      rootId: "root",
    });

    // Top / Bottom
    tree = splitPanel(tree, "root", "vertical", 0.5, 20);
    // Split bottom panel horizontally (Left / Right) with 20px gutter
    tree = splitPanel(tree, "root_b", "horizontal", 0.5, 20);

    let leaves = extractLeafPanelBounds(tree);
    expect(leaves).toHaveLength(3); // top, bottom-left, bottom-right

    // Bottom-left width = (800 - 20) / 2 = 390
    const bLeft = leaves.find((l) => l.panelId === "root_b_a")!;
    expect(bLeft.bounds.width).toBe(390);

    // Resize canvas to 1200px width
    tree = evaluateLayoutBounds(tree, { x: 0, y: 0, width: 1200, height: 1000 });
    leaves = extractLeafPanelBounds(tree);

    // Bottom-left width after resize = (1200 - 20) / 2 = 590
    const bLeftResized = leaves.find((l) => l.panelId === "root_b_a")!;
    expect(bLeftResized.bounds.width).toBe(590);
  });
});
