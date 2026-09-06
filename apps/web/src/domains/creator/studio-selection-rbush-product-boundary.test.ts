import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { readStudioCuttoonEditorSource } from "./studio-cuttoon-editor/read-studio-cuttoon-editor-source";
import {
  pickObjectIdAtPoint,
  selectIdsByMarquee,
} from "./studio-selection";

describe("selection hit helpers used by product marquee / pick paths", () => {
  it("selects marquee hits through selectIdsByMarquee used by StudioPage", () => {
    const items = [
      { id: "a", x: 0, y: 0, w: 10, h: 10 },
      { id: "b", x: 20, y: 20, w: 10, h: 10 },
      { id: "c", x: 5, y: 5, w: 10, h: 10 },
      { id: "far", x: 200, y: 200, w: 5, h: 5 },
    ];
    const hits = selectIdsByMarquee(
      items,
      (item) => ({ x: item.x, y: item.y, w: item.w, h: item.h }),
      { x: 0, y: 0, w: 18, h: 18 },
    );
    expect(hits.sort()).toEqual(["a", "c"]);
  });

  it("picks the topmost document object at a point", () => {
    const items = [
      { id: "back", x: 0, y: 0, w: 100, h: 100 },
      { id: "front", x: 10, y: 10, w: 20, h: 20 },
      { id: "side", x: 80, y: 80, w: 10, h: 10 },
    ];
    const id = pickObjectIdAtPoint(
      items,
      (item) => ({ x: item.x, y: item.y, w: item.w, h: item.h }),
      { x: 15, y: 15 },
    );
    expect(id).toBe("front");
    expect(pickObjectIdAtPoint(
      items,
      (item) => ({ x: item.x, y: item.y, w: item.w, h: item.h }),
      { x: 500, y: 500 },
    )).toBeNull();
  });

  it("StudioPage marquee completion calls selectIdsByMarquee", () => {
    const page = readStudioCuttoonEditorSource();
    expect(page).toContain("selectIdsByMarquee");
    expect(page).toMatch(/const hitIds = selectIdsByMarquee\(/u);
    const selection = readFileSync(new URL("./studio-selection.ts", import.meta.url), "utf8");
    expect(selection).toContain("export function selectIdsByMarquee");
    expect(selection).toContain("export function pickObjectIdAtPoint");
  });

  it("large-doc spatial index remains available on the hybrid object-pick path", () => {
    const hybrid = readFileSync(
      new URL("./hybrid-dcc/studio-hybrid-brush-filter-edit-runtime.ts", import.meta.url),
      "utf8",
    );
    expect(hybrid).toContain('from "../render/studio-engine-scene-spatial-index"');
    expect(hybrid).toContain("createStudioEngineSceneSpatialIndex");
    expect(hybrid).toContain("hitTestPoint");
  });
});
