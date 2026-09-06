import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  STUDIO_HOKUSAI_WORKER_ADAPTER_VERSION,
  STUDIO_HOKUSAI_WORKER_PROTOCOL_VERSION,
} from "./studio-hokusai-natural-media-worker-protocol";

describe("Studio Hokusai Worker boundary", () => {
  const source = readFileSync(
    new URL("./studio-hokusai-natural-media.worker.ts", import.meta.url),
    "utf8",
  );
  const presetSource = readFileSync(
    new URL("./studio-hokusai-natural-media-presets.ts", import.meta.url),
    "utf8",
  );

  it("loads the pinned local WASM adapter only inside a Dedicated Worker", () => {
    expect(source).toContain(
      "../../../../../packages/studio-hokusai-wasm/pkg/studio_hokusai_wasm.js",
    );
    expect(source).toContain('scopeName !== "DedicatedWorkerGlobalScope"');
    expect(source).toContain("typeof WebAssembly");
    expect(source).not.toContain("document.");
    expect(source).not.toContain("window.");
  });

  it("pins the packed dirty-frame protocol contract", () => {
    expect(STUDIO_HOKUSAI_WORKER_PROTOCOL_VERSION).toBe(3);
    expect(STUDIO_HOKUSAI_WORKER_ADAPTER_VERSION).toBe(
      "0.3.0-packed-dirty-frame-adapter.3-profile-routing",
    );
  });

  it("uses packed dirty RGBA, one-shot requests and PNG transfer", () => {
    expect(source).toContain("canvas.dirtyBounds()");
    expect(source).toContain("canvas.dirtyFrame()");
    expect(source).not.toContain("canvas.fullFrame()");
    expect(source).toContain("requestAccepted");
    expect(source).toContain("studioHokusaiWorkerResultTransfers");
    expect(source).toContain("transparentRgba: true");
    expect(source).toContain("dirtyTiles: true");
    expect(source).toContain("packedDirtyFrame: true");
    expect(source).toContain("outputRasterWidth: output.dirtyBounds[2]");
    expect(source).toContain("outputRasterHeight: output.dirtyBounds[3]");
    expect(source).toContain('pixelLayout: "packed-dirty-rgba8"');
    expect(source).toContain(
      'execution: "dedicated-worker-wasm-packed-dirty-frame"',
    );
    expect(source).toContain("mainThreadFallback: false");
  });

  it("transfers the packed dirty PNG buffer without another full-size copy", () => {
    expect(source).toContain("output.pngBytes.byteOffset === 0");
    expect(source).toContain(
      "output.pngBytes.byteLength === output.pngBytes.buffer.byteLength",
    );
    expect(source).toContain("? output.pngBytes.buffer");
    expect(source).toContain(": output.pngBytes.slice().buffer as ArrayBuffer");
    expect(source).not.toContain(
      "new ArrayBuffer(output.pngBytes.byteLength)",
    );
  });

  it("uses the canonical libmypaint spectral-pigment setting for oil", () => {
    expect(presetSource).toContain("paint_mode: setting(0.88)");
    expect(presetSource).not.toMatch(/\bpaint:\s*setting\(/u);
  });

  it("keeps the marker responsive to pressure for both coverage and width", () => {
    expect(presetSource).toContain(
      "pressure: [[0, -0.24], [0.25, -0.1], [0.65, 0.02], [1, 0.08]]",
    );
    expect(presetSource).toContain(
      "pressure: [[0, -0.22], [0.45, -0.04], [1, 0.18]]",
    );
  });
});
