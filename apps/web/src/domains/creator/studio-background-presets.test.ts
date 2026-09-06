import { describe, expect, it } from "vitest";

import {
  findStudioBackgroundPreset,
  listStudioBackgroundPresets,
  planStudioBackgroundApply,
  STUDIO_GRADIENT_BACKGROUNDS,
  STUDIO_SOLID_BACKGROUNDS,
  studioBackgroundGradientColorStops,
  studioBackgroundPreviewCss,
} from "./studio-background-presets";
import {
  loadStudioBackgroundRecent,
  pushStudioBackgroundRecent,
  rememberStudioBackgroundRecent,
} from "./studio-background-recent";

describe("studio-background-presets", () => {
  it("ships solids, multi-stop gradients, patterns and atmospheres", () => {
    const all = listStudioBackgroundPresets("all");
    expect(all.length).toBeGreaterThanOrEqual(30);
    expect(STUDIO_SOLID_BACKGROUNDS.length).toBeGreaterThanOrEqual(12);
    expect(STUDIO_GRADIENT_BACKGROUNDS.some((g) => g.stops.length >= 3)).toBe(true);
    expect(listStudioBackgroundPresets("pattern").length).toBeGreaterThanOrEqual(6);
    expect(listStudioBackgroundPresets("atmosphere").length).toBeGreaterThanOrEqual(4);
    const ids = all.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("filters by search keywords", () => {
    const dusk = listStudioBackgroundPresets("all", "노을");
    expect(dusk.some((p) => p.id === "g-sunset")).toBe(true);
    const dots = listStudioBackgroundPresets("pattern", "도트");
    expect(dots.length).toBeGreaterThan(0);
  });

  it("plans solid and gradient applies", () => {
    const solid = findStudioBackgroundPreset("s-cream")!;
    expect(planStudioBackgroundApply(solid, 720, 1080)).toEqual({
      kind: "solid",
      color: "#fbf3e4",
      presetId: "s-cream",
    });
    const grad = findStudioBackgroundPreset("g-sunrise")!;
    const planned = planStudioBackgroundApply(grad, 720, 900);
    expect(planned.kind).toBe("gradient");
    if (planned.kind === "gradient") {
      expect(planned.stops.length).toBe(3);
    }
  });

  it("builds svg payloads for patterns", () => {
    const pattern = findStudioBackgroundPreset("p-grid")!;
    const planned = planStudioBackgroundApply(pattern, 720, 1080);
    expect(planned.kind).toBe("svg");
    if (planned.kind === "svg") {
      expect(planned.svg).toContain("<svg");
      expect(planned.width).toBe(720);
      expect(planned.height).toBe(1080);
    }
  });

  it("builds Konva multi-stop color stops", () => {
    expect(studioBackgroundGradientColorStops(["#000", "#fff"])).toEqual([0, "#000", 1, "#fff"]);
    expect(studioBackgroundGradientColorStops(["#a", "#b", "#c"])).toEqual([
      0,
      "#a",
      0.5,
      "#b",
      1,
      "#c",
    ]);
    expect(studioBackgroundGradientColorStops(null)).toBeNull();
  });

  it("builds horizontal gradient SVG", async () => {
    const { buildStudioBackgroundGradientSvg, isStudioBackgroundFillLayerName } = await import("./studio-background-presets"
    );
    const svg = buildStudioBackgroundGradientSvg(100, 50, ["#ff0000", "#0000ff"], "horizontal");
    expect(svg).toContain("linearGradient");
    expect(svg).toContain('x2="1"');
    expect(isStudioBackgroundFillLayerName("배경 · 채우기 · 도트")).toBe(true);
    expect(isStudioBackgroundFillLayerName("말풍선")).toBe(false);
  });

  it("preview css for solids and gradients", () => {
    const solid = findStudioBackgroundPreset("s-sky")!;
    expect(studioBackgroundPreviewCss(solid)).toBe("#c8e8ff");
    const grad = findStudioBackgroundPreset("g-side-warm")!;
    expect(studioBackgroundPreviewCss(grad)).toContain("to right");
  });
});

describe("studio-background-recent", () => {
  it("keeps MRU order in injected storage", () => {
    const map = new Map<string, string>();
    const storage = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => {
        map.set(k, v);
      },
    };
    pushStudioBackgroundRecent(storage, "s-white");
    pushStudioBackgroundRecent(storage, "g-sunset");
    expect(loadStudioBackgroundRecent(storage).ids[0]).toBe("g-sunset");
    const remembered = rememberStudioBackgroundRecent(
      { version: 1, ids: ["a", "b"] },
      "a"
    );
    expect(remembered.ids[0]).toBe("a");
  });
});
