import { readFile } from "node:fs/promises";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createStudioBg3dKtx2RendererRuntime,
  resolveStudioBg3dKtx2RendererWorkerLimit,
  StudioBg3dKtx2RendererRuntimeError,
  type StudioBg3dKtx2RendererRuntimeSignals,
} from "./studio-bg3d-ktx2-renderer-runtime";

import type { StudioBg3dKtx2TranscoderAssets } from "./studio-bg3d-ktx2-transcoder-contract";
import type * as THREE from "three";

const INSTALLED_BASIS_DIRECTORY = new URL("../../../../../../node_modules/three/examples/jsm/libs/basis/",
  import.meta.url,
);

const CAPABLE_SIGNALS: StudioBg3dKtx2RendererRuntimeSignals = Object.freeze({
  blobAvailable: true,
  cryptoDigestAvailable: true,
  fetchAvailable: true,
  hardwareConcurrency: 8,
  objectUrlAvailable: true,
  wasmAvailable: true,
  workerAvailable: true,
});

function webgpuRendererStub(
  hasFeature: (name: string) => boolean = () => true,
): THREE.WebGLRenderer {
  return {
    isWebGPURenderer: true,
    hasFeature,
  } as unknown as THREE.WebGLRenderer;
}

function rendererStub(contextLost = false): THREE.WebGLRenderer {
  return {
    isWebGLRenderer: true,
    extensions: {
      has: () => false,
      get: () => null,
    },
    getContext: () => ({ isContextLost: () => contextLost }),
  } as unknown as THREE.WebGLRenderer;
}

async function installedAssets(): Promise<StudioBg3dKtx2TranscoderAssets> {
  const [javascript, wasm] = await Promise.all([
    readFile(new URL("basis_transcoder.js", INSTALLED_BASIS_DIRECTORY)),
    readFile(new URL("basis_transcoder.wasm", INSTALLED_BASIS_DIRECTORY)),
  ]);
  return {
    javascript: Uint8Array.from(javascript),
    wasm: Uint8Array.from(wasm),
  };
}

beforeEach(() => {
  if (typeof ProgressEvent !== "function") {
    vi.stubGlobal("ProgressEvent", class TestProgressEvent extends Event {
      readonly lengthComputable: boolean;
      readonly loaded: number;
      readonly total: number;

      constructor(type: string, init: ProgressEventInit = {}) {
        super(type);
        this.lengthComputable = init.lengthComputable ?? false;
        this.loaded = init.loaded ?? 0;
        this.total = init.total ?? 0;
      }
    });
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Studio KTX2 renderer runtime", () => {
  it("bounds decoder workers and fails closed when a required browser primitive is absent", () => {
    expect(resolveStudioBg3dKtx2RendererWorkerLimit(CAPABLE_SIGNALS)).toBe(2);
    expect(resolveStudioBg3dKtx2RendererWorkerLimit({
      ...CAPABLE_SIGNALS,
      hardwareConcurrency: 4,
    })).toBe(1);
    expect(resolveStudioBg3dKtx2RendererWorkerLimit({
      ...CAPABLE_SIGNALS,
      workerAvailable: false,
    })).toBe(0);
    expect(resolveStudioBg3dKtx2RendererWorkerLimit({
      ...CAPABLE_SIGNALS,
      cryptoDigestAvailable: false,
    })).toBe(0);
  });

  it("attests the installed assets, initializes real KTX2Loader support, and disposes once", async () => {
    const runtime = await createStudioBg3dKtx2RendererRuntime({
      renderer: rendererStub(),
      signals: CAPABLE_SIGNALS,
      loadAssets: installedAssets,
    });
    const loaderDispose = vi.spyOn(runtime.loader, "dispose");

    expect(runtime).toMatchObject({
      transcoderId: "three@0.184.0/basis_transcoder",
      workerLimit: 2,
    });
    expect(runtime.loader.manager.resolveURL("blob:https://studio.invalid/verified-ktx2"))
      .toBe("blob:https://studio.invalid/verified-ktx2");
    expect(runtime.hasDecodeFailure()).toBe(false);
    expect(() => runtime.loader.manager.resolveURL("https://untrusted.invalid/texture.ktx2"))
      .toThrow(StudioBg3dKtx2RendererRuntimeError);

    expect(() => runtime.loader.load(
      "https://untrusted.invalid/texture.ktx2",
      vi.fn(),
      undefined,
      vi.fn(),
    )).toThrow(StudioBg3dKtx2RendererRuntimeError);
    expect(runtime.hasDecodeFailure()).toBe(true);

    runtime.dispose();
    runtime.dispose();
    expect(loaderDispose).toHaveBeenCalledOnce();
  });

  it("rejects a tampered transcoder before creating executable object URLs", async () => {
    const assets = await installedAssets();
    const tamperedWasm = Uint8Array.from(assets.wasm);
    tamperedWasm[tamperedWasm.byteLength - 1] ^= 0xff;
    const createObjectUrl = vi.spyOn(URL, "createObjectURL");

    await expect(createStudioBg3dKtx2RendererRuntime({
      renderer: rendererStub(),
      signals: CAPABLE_SIGNALS,
      loadAssets: async () => ({ javascript: assets.javascript, wasm: tamperedWasm }),
    })).rejects.toMatchObject({ code: "asset-integrity" });
    expect(createObjectUrl).not.toHaveBeenCalled();
  });

  it("rejects a lost renderer or missing Worker before reading transcoder assets", async () => {
    const loadAssets = vi.fn(installedAssets);
    await expect(createStudioBg3dKtx2RendererRuntime({
      renderer: rendererStub(true),
      signals: CAPABLE_SIGNALS,
      loadAssets,
    })).rejects.toMatchObject({ code: "renderer-unavailable" });
    await expect(createStudioBg3dKtx2RendererRuntime({
      renderer: rendererStub(),
      signals: { ...CAPABLE_SIGNALS, workerAvailable: false },
      loadAssets,
    })).rejects.toMatchObject({ code: "environment-unavailable" });
    expect(loadAssets).not.toHaveBeenCalled();
  });

  it("admits an initialized WebGPU renderer through its own feature query", async () => {
    const assets = await installedAssets();
    const hasFeature = vi.fn(() => true);
    const runtime = await createStudioBg3dKtx2RendererRuntime({
      renderer: webgpuRendererStub(hasFeature),
      signals: CAPABLE_SIGNALS,
      loadAssets: async () => assets,
    });
    // The admission probe and KTX2Loader's own detectSupport both read GPU feature names.
    expect(hasFeature).toHaveBeenCalled();
    expect(runtime.transcoderId).toBeTruthy();
    runtime.dispose();
  });

  it("refuses a WebGPU renderer that cannot answer feature queries yet", async () => {
    const loadAssets = vi.fn(installedAssets);
    await expect(createStudioBg3dKtx2RendererRuntime({
      renderer: { isWebGPURenderer: true } as unknown as THREE.WebGLRenderer,
      signals: CAPABLE_SIGNALS,
      loadAssets,
    })).rejects.toMatchObject({ code: "renderer-unavailable" });

    await expect(createStudioBg3dKtx2RendererRuntime({
      renderer: webgpuRendererStub(() => { throw new Error("device not ready"); }),
      signals: CAPABLE_SIGNALS,
      loadAssets,
    })).rejects.toMatchObject({ code: "renderer-unavailable" });
    expect(loadAssets).not.toHaveBeenCalled();
  });

  it("refuses a renderer claiming both backends or neither", async () => {
    const loadAssets = vi.fn(installedAssets);
    for (const renderer of [
      { isWebGLRenderer: true, isWebGPURenderer: true },
      { extensions: { has: () => false } },
    ]) {
      await expect(createStudioBg3dKtx2RendererRuntime({
        renderer: renderer as unknown as THREE.WebGLRenderer,
        signals: CAPABLE_SIGNALS,
        loadAssets,
      })).rejects.toMatchObject({ code: "renderer-unavailable" });
    }
    expect(loadAssets).not.toHaveBeenCalled();
  });
});
