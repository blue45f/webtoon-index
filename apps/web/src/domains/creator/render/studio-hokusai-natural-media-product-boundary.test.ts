import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  projectStudioHokusaiDirtyLogicalBounds,
} from "./studio-hokusai-natural-media-product";

describe("Studio Hokusai product boundary", () => {
  const source = readFileSync(
    new URL("./studio-hokusai-natural-media-product.ts", import.meta.url),
    "utf8",
  );

  it("keeps the Hokusai runtime behind a literal module Worker boundary", () => {
    expect(source).toContain(
      'new URL("./studio-hokusai-natural-media.worker.ts", import.meta.url)',
    );
    expect(source).toContain('{ type: "module", name: "studio-hokusai-natural-media" }');
    expect(source).not.toContain("studio_hokusai_wasm.js");
    expect(source).not.toContain("new OffscreenCanvas");
  });

  it("verifies PNG SHA-256 before producing a canonical insertion source", () => {
    expect(source).toContain("hashPng(result.pngBytes");
    expect(source).toContain("pngHash !== result.receipt.pngHash");
    expect(source).toContain('startsWith("data:image/png;base64,")');
  });

  it("places a packed dirty crop at its scaled document coordinates", () => {
    const bounds = projectStudioHokusaiDirtyLogicalBounds(
      {
        logicalBounds: {
          x: 10,
          y: 20,
          width: 200,
          height: 100,
        },
        raster: {
          width: 100,
          height: 50,
          scale: 0.5,
          radiusPixels: 4,
        },
      },
      [5, 4, 30, 20],
    );

    expect(bounds).toEqual({
      x: 20,
      y: 28,
      width: 60,
      height: 40,
    });
    expect(Object.isFrozen(bounds)).toBe(true);
  });

  it("rejects dirty crops that escape the planned raster", () => {
    expect(() => projectStudioHokusaiDirtyLogicalBounds(
      {
        logicalBounds: {
          x: 10,
          y: 20,
          width: 200,
          height: 100,
        },
        raster: {
          width: 100,
          height: 50,
          scale: 0.5,
          radiusPixels: 4,
        },
      },
      [90, 40, 20, 20],
    )).toThrow("Hokusai dirty-frame placement is invalid.");
  });
});
