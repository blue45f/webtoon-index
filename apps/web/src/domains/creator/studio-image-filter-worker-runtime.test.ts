import { afterEach, describe, expect, it, vi } from "vitest";

import { applyImageFilters, buildImageFilters, registerStudioKonvaFilters, type KonvaLike } from "./render/studio-konva-filters";

import type { ImageFilterFields } from "./render/studio-konva-filter-fields";
import type {
  StudioImageFilterWorkerRequestMessage,
  StudioImageFilterWorkerResponseMessage,
  StudioImageFilterWorkerRunMessage,
} from "./studio-image-filter-worker-protocol";

interface WorkerScopeHarness {
  onmessage: ((event: MessageEvent<StudioImageFilterWorkerRequestMessage>) => void) | null;
  postMessage(message: StudioImageFilterWorkerResponseMessage, transfer: Transferable[]): void;
}

const registry: KonvaLike = { Filters: {} };
registerStudioKonvaFilters(registry);

function imageData() {
  return {
    data: new Uint8ClampedArray([
      10, 40, 80, 255,
      90, 120, 160, 200,
    ]),
    width: 2,
    height: 1,
  };
}

function patternedImageData(width = 12, height = 10) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      data[index] = (x * 41 + y * 13) % 256;
      data[index + 1] = (x * 19 + y * 59) % 256;
      data[index + 2] = (x * 73 + y * 7) % 256;
      data[index + 3] = 211;
    }
  }
  return { data, width, height };
}

async function loadWorkerHarness(): Promise<{
  messages: StudioImageFilterWorkerResponseMessage[];
  scope: WorkerScopeHarness;
}> {
  vi.resetModules();
  const messages: StudioImageFilterWorkerResponseMessage[] = [];
  const postMessage = vi.fn((message: StudioImageFilterWorkerResponseMessage) => {
    messages.push(message);
  });
  vi.stubGlobal("postMessage", postMessage);
  await import("./studio-image-filter.worker");
  return { messages, scope: globalThis as unknown as WorkerScopeHarness };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("studio-image-filter.worker runtime", () => {
  it("announces readiness and returns pixels matching the direct filter chain", async () => {
    const { messages, scope } = await loadWorkerHarness();
    const input = imageData();
    const expected = imageData();
    const el: ImageFilterFields = {
      brightness: 0.25,
      saturation: -0.3,
      temperature: 20,
      exposureAdjustment: { exposure: 0.5, gamma: 0.9, offset: 0.02 },
      pixelOffset: { x: 1, y: 0, edge: "wrap" as const },
      clouds: { amount: 0.2, scale: 32, seed: 42, mode: "overlay" as const },
    };
    const built = buildImageFilters(el, registry);
    applyImageFilters(expected, built.filters, built.attrs);

    scope.onmessage?.({
      data: { type: "studio-image-filter/run", version: 1, request: { imageData: input, el } },
    } as unknown as MessageEvent<StudioImageFilterWorkerRunMessage>);

    expect(messages[0]).toEqual({ type: "studio-image-filter/ready", version: 1 });
    expect(messages[1]?.type).toBe("studio-image-filter/success");
    if (messages[1]?.type !== "studio-image-filter/success") throw new Error("success response expected");
    expect(Array.from(messages[1].imageData.data)).toEqual(Array.from(expected.data));
  });

  it("keeps Worker parity for the new radial, comic, detail and stylize stack", async () => {
    const { messages, scope } = await loadWorkerHarness();
    const input = patternedImageData();
    const expected = patternedImageData();
    const el: ImageFilterFields = {
      smartFilters: {
        version: 1 as const,
        entries: [
          { id: "spin", engine: "spin-blur" as const, enabled: true, params: { radius: 12, strength: 70 } },
          { id: "poster", engine: "posterize" as const, enabled: true, params: { levels: 5 } },
          { id: "halftone", engine: "color-halftone" as const, enabled: true, params: { dotSize: 3, angle: 15, mode: "cmyk", strength: 80 } },
          { id: "chromatic", engine: "chromatic-aberration" as const, enabled: true, params: { offset: 2 } },
          { id: "median", engine: "median-despeckle" as const, enabled: true, params: { amount: 70, radius: 1 } },
          { id: "emboss", engine: "emboss" as const, enabled: true, params: { strength: 55, detail: 1 } },
        ],
      },
    };
    const built = buildImageFilters(el, registry);
    applyImageFilters(expected, built.filters, built.attrs);

    scope.onmessage?.({
      data: { type: "studio-image-filter/run", version: 1, request: { imageData: input, el } },
    } as unknown as MessageEvent<StudioImageFilterWorkerRunMessage>);

    expect(messages[1]?.type).toBe("studio-image-filter/success");
    if (messages[1]?.type !== "studio-image-filter/success") throw new Error("success response expected");
    expect(Array.from(messages[1].imageData.data)).toEqual(Array.from(expected.data));
  });

  it("keeps Worker parity for ordered Filter Gallery composites", async () => {
    const { messages, scope } = await loadWorkerHarness();
    const input = patternedImageData();
    const expected = patternedImageData();
    const el: ImageFilterFields = {
      smartFilters: {
        version: 1,
        entries: [
          { id: "surface", engine: "surface-blur", enabled: true, params: { strength: 50, radius: 1 } },
          { id: "film", engine: "retro-film", enabled: true, params: { grain: 12, grainSize: 1, fade: 8, chromatic: 1, seed: 77 } },
          { id: "water", engine: "watercolor", enabled: true, params: { strength: 35, spread: 2, bleed: 30, granulation: 20, paper: 15, seed: 42 } },
          { id: "glow", engine: "diffuse-glow", enabled: true, params: { strength: 25, radius: 2, threshold: 50, grain: 4, seed: 9 } },
        ],
      },
    };
    const built = buildImageFilters(el, registry);
    applyImageFilters(expected, built.filters, built.attrs);

    scope.onmessage?.({
      data: { type: "studio-image-filter/run", version: 1, request: { imageData: input, el } },
    } as unknown as MessageEvent<StudioImageFilterWorkerRunMessage>);

    expect(messages[1]?.type).toBe("studio-image-filter/success");
    if (messages[1]?.type !== "studio-image-filter/success") throw new Error("success response expected");
    expect(Array.from(messages[1].imageData.data)).toEqual(Array.from(expected.data));
  });

  it("returns a structured failure for malformed pixel memory", async () => {
    const { messages, scope } = await loadWorkerHarness();
    const malformed = {
      data: new Uint8ClampedArray(4),
      width: 2,
      height: 2,
    };

    scope.onmessage?.({
      data: { type: "studio-image-filter/run", version: 1, request: { imageData: malformed, el: {} } },
    } as MessageEvent<StudioImageFilterWorkerRunMessage>);

    expect(messages[1]).toMatchObject({
      type: "studio-image-filter/failure",
      version: 1,
      error: { name: "RangeError" },
    });
  });

  it("keeps one immutable source resident across parameter-only filter runs", async () => {
    const { messages, scope } = await loadWorkerHarness();
    const source = patternedImageData();
    const original = Array.from(source.data);
    const firstEl: ImageFilterFields = { brightness: 0.15 };
    const secondEl: ImageFilterFields = { invert: true, contrast: 20 };

    scope.onmessage?.({
      data: {
        type: "studio-image-filter/load-source",
        version: 1,
        sourceId: "source-a",
        sourceGeneration: 7,
        imageData: source,
      },
    } as MessageEvent<StudioImageFilterWorkerRequestMessage>);
    scope.onmessage?.({
      data: {
        type: "studio-image-filter/run-source",
        version: 1,
        sourceId: "source-a",
        sourceGeneration: 7,
        requestId: 11,
        el: firstEl,
      },
    } as MessageEvent<StudioImageFilterWorkerRequestMessage>);
    scope.onmessage?.({
      data: {
        type: "studio-image-filter/run-source",
        version: 1,
        sourceId: "source-a",
        sourceGeneration: 7,
        requestId: 12,
        el: secondEl,
      },
    } as MessageEvent<StudioImageFilterWorkerRequestMessage>);

    expect(messages[1]).toEqual({
      type: "studio-image-filter/source-loaded",
      version: 1,
      sourceId: "source-a",
      sourceGeneration: 7,
    });
    expect(messages[2]?.type).toBe("studio-image-filter/source-success");
    expect(messages[3]?.type).toBe("studio-image-filter/source-success");
    if (
      messages[2]?.type !== "studio-image-filter/source-success"
      || messages[3]?.type !== "studio-image-filter/source-success"
    ) {
      throw new Error("resident source success responses expected");
    }
    const firstExpected = patternedImageData();
    const firstBuilt = buildImageFilters(firstEl, registry);
    applyImageFilters(firstExpected, firstBuilt.filters, firstBuilt.attrs);
    const secondExpected = patternedImageData();
    const secondBuilt = buildImageFilters(secondEl, registry);
    applyImageFilters(secondExpected, secondBuilt.filters, secondBuilt.attrs);

    expect(messages[2].requestId).toBe(11);
    expect(messages[3].requestId).toBe(12);
    expect(Array.from(messages[2].imageData.data)).toEqual(Array.from(firstExpected.data));
    expect(Array.from(messages[3].imageData.data)).toEqual(Array.from(secondExpected.data));
    expect(Array.from(source.data)).toEqual(original);
  });

  it("fails closed when a run references a stale resident source generation", async () => {
    const { messages, scope } = await loadWorkerHarness();
    scope.onmessage?.({
      data: {
        type: "studio-image-filter/load-source",
        version: 1,
        sourceId: "source-a",
        sourceGeneration: 4,
        imageData: imageData(),
      },
    } as MessageEvent<StudioImageFilterWorkerRequestMessage>);
    scope.onmessage?.({
      data: {
        type: "studio-image-filter/run-source",
        version: 1,
        sourceId: "source-a",
        sourceGeneration: 3,
        requestId: 99,
        el: { brightness: 0.2 },
      },
    } as MessageEvent<StudioImageFilterWorkerRequestMessage>);

    expect(messages[2]).toMatchObject({
      type: "studio-image-filter/source-failure",
      version: 1,
      sourceId: "source-a",
      sourceGeneration: 3,
      requestId: 99,
      error: { name: "Error", message: expect.stringMatching(/정체성/) },
    });
  });
});
