import { describe, expect, it } from "vitest";

import {
  resolveStudioSelectMatchingOptions,
  selectStudioMatchingElementIds,
} from "./studio-select-matching";

import type { DrawEl, ImageEl, TextEl } from "./studio-element-model";

function image(
  partial: Partial<ImageEl> & Pick<ImageEl, "id" | "src">,
): ImageEl {
  return {
    type: "image",
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    ...partial,
  } as ImageEl;
}

function draw(
  partial: Partial<DrawEl> & Pick<DrawEl, "id">,
): DrawEl {
  return {
    type: "draw",
    mode: "pen",
    kind: "freehand",
    points: [0, 0, 20, 20],
    stroke: "#111111",
    strokeWidth: 4,
    brush: "g-pen",
    ...partial,
  } as DrawEl;
}

function text(
  partial: Partial<TextEl> & Pick<TextEl, "id" | "text">,
): TextEl {
  return {
    type: "text",
    x: 0,
    y: 0,
    width: 160,
    fontSize: 24,
    fill: "#111111",
    rotation: 0,
    font: "Pretendard",
    lineHeight: 1.2,
    align: "center",
    ...partial,
  } as TextEl;
}

describe("studio select matching", () => {
  it("selects the same type in document z-order", () => {
    const elements = [
      image({ id: "image-a", src: "asset:a" }),
      text({ id: "text-a", text: "첫째" }),
      image({ id: "image-b", src: "asset:b" }),
      text({ id: "text-b", text: "둘째" }),
    ];

    expect(selectStudioMatchingElementIds(elements, "text-b", "type")).toEqual([
      "text-a",
      "text-b",
    ]);
  });

  it("matches draw paint semantically and normalizes color casing", () => {
    const source = draw({ id: "source", stroke: "#AABBCC", strokeWidth: 6 });
    const same = draw({
      id: "same",
      stroke: "#aabbcc",
      strokeWidth: 6,
      points: [100, 100, 120, 120],
      opacity: 1,
    });
    const otherWidth = draw({ id: "other-width", stroke: "#aabbcc", strokeWidth: 8 });
    const otherBrush = draw({
      id: "other-brush",
      stroke: "#aabbcc",
      strokeWidth: 6,
      brush: "pencil",
    });
    const otherComposite = draw({
      id: "other-composite",
      stroke: "#aabbcc",
      strokeWidth: 6,
      blendMode: "multiply",
    });

    expect(
      selectStudioMatchingElementIds(
        [source, otherWidth, same, otherBrush, otherComposite],
        "source",
        "paint",
      ),
    ).toEqual(["source", "same"]);
  });

  it("compares the rendered fill and ignores stale lower-priority solid values", () => {
    const gradient = {
      type: "linear",
      angle: 45,
      stops: [
        { offset: 0, color: "#111111" },
        { offset: 1, color: "#eeeeee" },
      ],
    } as unknown as NonNullable<DrawEl["gradient"]>;
    const source = draw({ id: "source", fill: "#ff0000", gradient });
    const sameRenderedFill = draw({ id: "same", fill: "#0000ff", gradient });
    const solidOnly = draw({ id: "solid", fill: "#ff0000" });

    expect(
      selectStudioMatchingElementIds(
        [source, solidOnly, sameRenderedFill],
        "source",
        "paint",
      ),
    ).toEqual(["source", "same"]);
  });

  it("matches typography while ignoring authored text and geometry", () => {
    const source = text({ id: "source", text: "안녕하세요", x: 10, y: 20 });
    const same = text({ id: "same", text: "다른 대사", x: 800, y: 1_200 });
    const otherSize = text({ id: "other-size", text: "크기 다름", fontSize: 30 });

    expect(
      selectStudioMatchingElementIds(
        [source, otherSize, same],
        "source",
        "typography",
      ),
    ).toEqual(["source", "same"]);
  });

  it("prefers stable asset identity over an equal-looking source string", () => {
    const source = image({
      id: "source",
      src: "data:image/png;base64,SAME",
      builtinRasterAssetId: "builtin-raster-hero",
    });
    const sameAsset = image({
      id: "same-asset",
      src: "data:image/png;base64,DIFFERENT-CACHE-COPY",
      builtinRasterAssetId: "builtin-raster-hero",
    });
    const sameBytesWithoutIdentity = image({
      id: "same-bytes",
      src: "data:image/png;base64,SAME",
    });

    expect(
      selectStudioMatchingElementIds(
        [source, sameBytesWithoutIdentity, sameAsset],
        "source",
        "source",
      ),
    ).toEqual(["source", "same-asset"]);
  });

  it("offers only useful criteria and reports their match counts", () => {
    const source = text({ id: "source", text: "A", fill: "#111" });
    const sameTypography = text({ id: "same-typography", text: "B", fill: "#fff" });
    const sameEverything = text({ id: "same-everything", text: "C", fill: "#111" });
    const otherType = image({ id: "image", src: "asset:image" });

    expect(
      resolveStudioSelectMatchingOptions(
        [source, sameTypography, sameEverything, otherType],
        "source",
      ),
    ).toEqual([
      expect.objectContaining({ criterion: "paint", count: 2 }),
      expect.objectContaining({ criterion: "typography", count: 3 }),
      expect.objectContaining({ criterion: "type", count: 3 }),
    ]);
  });

  it("omits options when no second element matches and handles stale source ids", () => {
    const only = image({ id: "only", src: "asset:only" });
    expect(resolveStudioSelectMatchingOptions([only], "only")).toEqual([]);
    expect(resolveStudioSelectMatchingOptions([only], "missing")).toEqual([]);
    expect(selectStudioMatchingElementIds([only], "missing", "type")).toEqual([]);
  });
});
