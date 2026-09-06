import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

import {
  createStudioResvgSvgProvider,
  createStudioResvgWasmRuntimeAdapter,
} from "./studio-resvg-svg-provider";

describe("Studio resvg real WASM smoke", () => {
  it("renders one closed-policy SVG through the installed package", async () => {
    const module = await import("@resvg/resvg-wasm");
    const require = createRequire(import.meta.url);
    const wasmPath = require.resolve("@resvg/resvg-wasm/index_bg.wasm");
    await module.initWasm(await readFile(wasmPath));
    const provider = createStudioResvgSvgProvider({
      runtimeLoader: () => createStudioResvgWasmRuntimeAdapter(module),
    });
    try {
      const receipt = await provider.render({
        svg: [
          '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="1">',
          '<rect width="2" height="1" fill="#ff0000"/>',
          "</svg>",
        ].join(""),
        fontPolicy: { mode: "none" },
        imagePolicy: "deny",
      });

      expect(receipt).toMatchObject({
        providerId: "resvg-wasm",
        width: 2,
        height: 1,
        pixelCount: 2,
        rgba: { byteLength: 8 },
      });
      expect([...receipt.rgba.bytes]).toEqual([
        255, 0, 0, 255,
        255, 0, 0, 255,
      ]);
      expect([...receipt.png.bytes.slice(0, 8)]).toEqual([
        137, 80, 78, 71, 13, 10, 26, 10,
      ]);
    } finally {
      await provider.destroy();
    }
  });
});
