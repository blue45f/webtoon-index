import { describe, expect, it } from "vitest";

import { BRUSH_PRESETS } from "../studio-brush";

import {
  STUDIO_BRUSH_ICON_BY_ID,
  STUDIO_PROCEDURAL_BRUSH_ICON_BY_ID,
  studioBrushIconId,
  type StudioBrushIconId,
} from "./studio-brush-icons";
import { STUDIO_BRUSH_PACK_CATALOG_IDS } from "./studio-brush-pack-id";
import {
  STUDIO_BRUSH_PACK_DESCRIPTORS,
  type StudioBrushPackCategory,
} from "./studio-brush-pack-index";

const ICONS_BY_PROCEDURAL_CATEGORY = {
  ink: new Set<StudioBrushIconId>([
    "circle",
    "pen",
    "pen-line",
    "pen-tool",
    "circle-dot",
    "circle-ellipsis",
    "brush",
    "a-large-small",
  ]),
  sketch: new Set<StudioBrushIconId>(["pencil", "pen-line", "feather", "circle-dashed"]),
  chalk: new Set<StudioBrushIconId>(["circle-dashed", "grip", "square-dashed", "blend"]),
  flat: new Set<StudioBrushIconId>([
    "layers",
    "square",
    "square-dashed",
    "circle-ellipsis",
    "rectangle-horizontal",
    "rectangle-vertical",
    "rows",
    "direction",
  ]),
  marker: new Set<StudioBrushIconId>([
    "highlighter",
    "feather",
    "rectangle-horizontal",
    "blend",
    "circle-ellipsis",
  ]),
  texture: new Set<StudioBrushIconId>([
    "grid-3x3",
    "circle-dashed",
    "asterisk",
    "square-dashed",
    "blend",
    "grip",
    "layers",
    "gem",
    "cloud",
    "circle-dot",
    "waves",
  ]),
  paint: new Set<StudioBrushIconId>([
    "cloud",
    "cloud-fog",
    "circle-dot",
    "brush",
    "blend",
    "droplets",
    "paintbrush",
    "paint-roller",
    "spray-can",
    "wind",
  ]),
  rake: new Set<StudioBrushIconId>(["rows", "align-justify", "fence", "feather", "waves"]),
  foliage: new Set<StudioBrushIconId>(["trees", "wheat", "leaf", "feather", "flower"]),
  pattern: new Set<StudioBrushIconId>([
    "spline",
    "feather",
    "circle-ellipsis",
    "circle",
    "layers",
    "grid-2x2",
    "rows",
    "fence",
  ]),
  stamp: new Set<StudioBrushIconId>(["stamp", "footprints", "heart", "spline"]),
  pixel: new Set<StudioBrushIconId>(["square", "grid-2x2"]),
  tone: new Set<StudioBrushIconId>(["grid-3x3", "rows", "circle-dot"]),
  effect: new Set<StudioBrushIconId>([
    "sparkles",
    "spray-can",
    "star",
    "cloud",
    "cloud-fog",
    "asterisk",
    "flame",
  ]),
} satisfies Readonly<Record<StudioBrushPackCategory, ReadonlySet<StudioBrushIconId>>>;

describe("studio-brush-icons", () => {
  it("maps every built-in brush preset to a non-default icon key when listed", () => {
    for (const preset of BRUSH_PRESETS) {
      const key = studioBrushIconId(preset.id);
      expect(key.length).toBeGreaterThan(0);
      // Known presets should have explicit keys
      expect(STUDIO_BRUSH_ICON_BY_ID[preset.id]).toBeDefined();
      expect(key).not.toBe("default");
    }
  });

  it("falls back for unknown ids", () => {
    expect(studioBrushIconId("unknown-brush")).toBe("default");
    expect(studioBrushIconId(null)).toBe("default");
  });

  it("uses distinctive icons for fx and paint families", () => {
    expect(studioBrushIconId("glitter")).toBe("star");
    expect(studioBrushIconId("glow")).toBe("sparkles");
    expect(studioBrushIconId("watercolor")).toBe("droplets");
    expect(studioBrushIconId("spray")).toBe("spray-can");
    expect(studioBrushIconId("screentone")).toBe("grid-3x3");
  });

  it("maps every procedural catalogue id explicitly without collapsing to the renderer icon", () => {
    expect(Object.keys(STUDIO_PROCEDURAL_BRUSH_ICON_BY_ID)).toEqual(
      STUDIO_BRUSH_PACK_CATALOG_IDS
    );

    const mappedIcons = STUDIO_BRUSH_PACK_CATALOG_IDS.map((brushId) =>
      studioBrushIconId(brushId)
    );
    expect(mappedIcons).not.toContain("default");
    expect(new Set(mappedIcons).size).toBeGreaterThanOrEqual(24);
  });

  it("uses an icon vocabulary that matches every procedural brush's semantic category", () => {
    for (const descriptor of STUDIO_BRUSH_PACK_DESCRIPTORS) {
      const iconId = studioBrushIconId(descriptor.catalogId);
      expect(
        ICONS_BY_PROCEDURAL_CATEGORY[descriptor.category].has(iconId),
        `${descriptor.catalogId} (${descriptor.category}) should not use ${iconId}`
      ).toBe(true);
    }
  });

  it("gives unmistakable motifs their own recognisable symbols", () => {
    expect(studioBrushIconId("heart-stamp")).toBe("heart");
    expect(studioBrushIconId("footstep-stamp")).toBe("footprints");
    expect(studioBrushIconId("checker-grid")).toBe("grid-2x2");
    expect(studioBrushIconId("paint-roller")).toBe("paint-roller");
    expect(studioBrushIconId("fresh-leaf")).toBe("leaf");
    expect(studioBrushIconId("loose-grass")).toBe("wheat");
    expect(studioBrushIconId("hair-fiber")).toBe("feather");
    expect(studioBrushIconId("cloud-soft")).toBe("cloud");
    expect(studioBrushIconId("mist-soft")).toBe("cloud-fog");
    expect(studioBrushIconId("pixel-square")).toBe("square");
    expect(studioBrushIconId("cross-hatch")).toBe("grid-3x3");
    expect(studioBrushIconId("bokeh-scatter")).toBe("sparkles");
    expect(studioBrushIconId("pine-needle-cluster")).toBe("trees");
  });
});
