import { describe, expect, it, vi } from "vitest";

import {
  createStudioResvgSvgProvider,
  STUDIO_RESVG_BUDGETS,
  StudioResvgProviderError,
  type StudioResvgRuntime,
  type StudioResvgRuntimeOptions,
} from "./studio-resvg-svg-provider";

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<Value>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function fakeRuntime(
  overrides: Readonly<{
    width?: number;
    height?: number;
    unresolvedImages?: readonly string[];
    rgba?: Uint8Array;
    png?: Uint8Array;
  }> = {},
) {
  const width = overrides.width ?? 2;
  const height = overrides.height ?? 2;
  const events: string[] = [];
  const optionsSeen: StudioResvgRuntimeOptions[] = [];
  const svgSeen: string[] = [];
  const runtime: StudioResvgRuntime = {
    version: "fake-resvg-2.6.2",
    createRenderer: vi.fn((svg, options) => {
      events.push("create:renderer");
      svgSeen.push(svg);
      optionsSeen.push(options);
      return { kind: "renderer" };
    }),
    destroyRenderer: vi.fn(() => events.push("destroy:renderer")),
    rendererDimensions: vi.fn(() => ({ width, height })),
    unresolvedImages: vi.fn(() => overrides.unresolvedImages ?? []),
    render: vi.fn(() => {
      events.push("render");
      return { kind: "image" };
    }),
    destroyRenderedImage: vi.fn(() => events.push("destroy:image")),
    renderedDimensions: vi.fn(() => ({ width, height })),
    rgba: vi.fn(() =>
      overrides.rgba
      ?? Uint8Array.from(
        { length: width * height * 4 },
        (_, index) => index,
      )
    ),
    png: vi.fn(() =>
      overrides.png
      ?? Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3)
    ),
    destroy: vi.fn(() => {
      events.push("destroy:runtime");
    }),
  };
  return { runtime, events, optionsSeen, svgSeen };
}

function request(fontBytes: ArrayBuffer | ArrayBufferView = Uint8Array.of(1, 2, 3)) {
  return {
    svg: `
      <svg xmlns="http://www.w3.org/2000/svg" width="2" height="2">
        <defs>
          <linearGradient id="paint"><stop stop-color="#123456"/></linearGradient>
        </defs>
        <rect width="2" height="2" fill="url(#paint)"/>
      </svg>
    `,
    fit: { mode: "width" as const, value: 2 },
    fontPolicy: {
      mode: "custom-only" as const,
      fontBuffers: [fontBytes],
      defaultFontFamily: "Toon Sans",
    },
    imagePolicy: "deny" as const,
    languages: ["ko-KR", "en"],
    background: "#ffffff",
  };
}

describe("Studio resvg SVG provider", () => {
  it("rejects accessor-backed font buffers without invoking them or loading WASM", async () => {
    const getter = vi.fn(() => {
      throw new Error("must not run");
    });
    const load = vi.fn(() => fakeRuntime().runtime);
    const provider = createStudioResvgSvgProvider({ runtimeLoader: load });
    const candidate = request();
    const fontPolicy = { mode: "custom-only" };
    Object.defineProperty(fontPolicy, "fontBuffers", {
      enumerable: true,
      get: getter,
    });

    await expect(provider.render({
      ...candidate,
      fontPolicy,
    } as never)).rejects.toMatchObject({ code: "invalid-request" });
    expect(getter).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
  });

  it("stays lazy, detaches fonts, enforces closed resource policies, and returns copied RGBA/PNG receipts", async () => {
    const fake = fakeRuntime();
    const runtimeGate = deferred<StudioResvgRuntime>();
    const load = vi.fn(() => runtimeGate.promise);
    const provider = createStudioResvgSvgProvider({
      runtimeLoader: load,
    });
    expect(load).not.toHaveBeenCalled();

    const backing = Uint8Array.of(99, 1, 2, 3, 88);
    const pending = provider.render(request(backing.subarray(1, 4)));
    backing.fill(7);
    runtimeGate.resolve(fake.runtime);
    const receipt = await pending;

    expect(load).toHaveBeenCalledTimes(1);
    expect(fake.svgSeen[0]).toMatch(/^<svg/u);
    expect(fake.optionsSeen).toHaveLength(1);
    expect(fake.optionsSeen[0]).toMatchObject({
      fit: { mode: "width", value: 2 },
      defaultFontFamily: "Toon Sans",
      languages: ["ko-KR", "en"],
      background: "#ffffff",
      loadSystemFonts: false,
      loadFontFiles: false,
      resolveExternalImages: false,
      shapeRendering: "geometric-precision",
      textRendering: "optimize-legibility",
      imageRendering: "optimize-quality",
    });
    expect([...fake.optionsSeen[0]!.fontBuffers[0]!]).toEqual([1, 2, 3]);
    expect(receipt).toMatchObject({
      kind: "studio-resvg-render-receipt",
      revision: 1,
      providerId: "resvg-wasm",
      runtimeVersion: "fake-resvg-2.6.2",
      width: 2,
      height: 2,
      pixelCount: 4,
      fit: { mode: "width", value: 2 },
      policies: {
        fonts: "custom-only",
        images: "deny",
        systemFonts: false,
        fontFiles: false,
        externalImages: false,
      },
      fonts: [{ byteLength: 3 }],
      rgba: { byteLength: 16 },
      png: { byteLength: 11 },
    });
    expect(receipt.rgba.hash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(receipt.png.hash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(receipt.receiptHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(structuredClone(receipt)).toEqual(receipt);
    expect(fake.events.slice(-2)).toEqual([
      "destroy:image",
      "destroy:renderer",
    ]);
  });

  it("produces identical hashes and byte receipts for identical canonical renders", async () => {
    const fake = fakeRuntime();
    const provider = createStudioResvgSvgProvider({
      runtimeLoader: () => fake.runtime,
    });
    const first = await provider.render(request());
    const second = await provider.render(request());
    expect(second).toEqual(first);
  });

  it.each([
    [
      "active script",
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      "deny",
    ],
    [
      "event handler",
      '<svg xmlns="http://www.w3.org/2000/svg"><rect onload="alert(1)"/></svg>',
      "deny",
    ],
    [
      "external href",
      '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.com/a.png"/></svg>',
      "embedded-raster-data",
    ],
    [
      "encoded active href",
      '<svg xmlns="http://www.w3.org/2000/svg"><a href="java&#x73;cript:alert(1)"/></svg>',
      "deny",
    ],
    [
      "external CSS URL",
      '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="url(https://example.com/p.svg#x)"/></svg>',
      "deny",
    ],
    [
      "doctype",
      '<!DOCTYPE svg><svg xmlns="http://www.w3.org/2000/svg"/>',
      "deny",
    ],
  ] as const)("rejects %s before initializing WASM", async (_label, svg, imagePolicy) => {
    const fake = fakeRuntime();
    const load = vi.fn(() => fake.runtime);
    const provider = createStudioResvgSvgProvider({
      runtimeLoader: load,
    });
    await expect(
      provider.render({
        svg,
        fontPolicy: { mode: "none" },
        imagePolicy,
      }),
    ).rejects.toBeInstanceOf(StudioResvgProviderError);
    expect(load).not.toHaveBeenCalled();
  });

  it("allows bounded embedded raster images only under the explicit image policy", async () => {
    const fake = fakeRuntime();
    const provider = createStudioResvgSvgProvider({
      runtimeLoader: () => fake.runtime,
    });
    const svg = [
      '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2">',
      '<image width="1" height="1" href="data:image/png;base64,iVBORw0KGgo="/>',
      "</svg>",
    ].join("");
    await expect(
      provider.render({
        svg,
        fontPolicy: { mode: "none" },
        imagePolicy: "deny",
      }),
    ).rejects.toMatchObject({ code: "unsafe-svg" });
    await expect(
      provider.render({
        svg,
        fontPolicy: { mode: "none" },
        imagePolicy: "embedded-raster-data",
      }),
    ).resolves.toMatchObject({
      policies: { images: "embedded-raster-data" },
    });
  });

  it("frees the rendered image and renderer when output encoding fails", async () => {
    const fake = fakeRuntime();
    vi.mocked(fake.runtime.png).mockImplementationOnce(() => {
      throw new Error("fake PNG encoder failure");
    });
    const provider = createStudioResvgSvgProvider({
      runtimeLoader: () => fake.runtime,
    });
    await expect(provider.render(request())).rejects.toMatchObject({
      code: "runtime-failed",
    });
    expect(fake.events.slice(-2)).toEqual([
      "destroy:image",
      "destroy:renderer",
    ]);
  });

  it("rejects unresolved runtime images and oversized dimensions with renderer cleanup", async () => {
    const unresolved = fakeRuntime({
      unresolvedImages: ["https://example.com/not-admitted.png"],
    });
    const unresolvedProvider = createStudioResvgSvgProvider({
      runtimeLoader: () => unresolved.runtime,
    });
    await expect(unresolvedProvider.render(request())).rejects.toMatchObject({
      code: "unsafe-svg",
    });
    expect(unresolved.events.at(-1)).toBe("destroy:renderer");

    const oversized = fakeRuntime({
      width: STUDIO_RESVG_BUDGETS.maxDimensionPx + 1,
      height: 1,
    });
    const oversizedProvider = createStudioResvgSvgProvider({
      runtimeLoader: () => oversized.runtime,
    });
    await expect(oversizedProvider.render(request())).rejects.toMatchObject({
      code: "budget-exceeded",
    });
    expect(oversized.events.at(-1)).toBe("destroy:renderer");
  });

  it("enforces backpressure and destroys the loaded runtime exactly once", async () => {
    const fake = fakeRuntime();
    const runtimeGate = deferred<StudioResvgRuntime>();
    const provider = createStudioResvgSvgProvider({
      runtimeLoader: () => runtimeGate.promise,
      maxConcurrentRenders: 1,
    });
    const first = provider.render(request());
    await expect(provider.render(request())).rejects.toMatchObject({
      code: "backpressure",
    });
    runtimeGate.resolve(fake.runtime);
    await first;

    await Promise.all([provider.destroy(), provider.destroy()]);
    expect(fake.runtime.destroy).toHaveBeenCalledTimes(1);
    expect(provider.snapshot()).toEqual({
      state: "destroyed",
      runtimeLoaded: false,
      activeRenders: 0,
    });
    await expect(provider.render(request())).rejects.toMatchObject({
      code: "disposed",
    });
  });

  it("rejects font and source budgets before runtime loading", async () => {
    const fake = fakeRuntime();
    const load = vi.fn(() => fake.runtime);
    const provider = createStudioResvgSvgProvider({
      runtimeLoader: load,
    });
    await expect(
      provider.render({
        ...request(),
        svg: `<svg>${" ".repeat(STUDIO_RESVG_BUDGETS.maxSvgCodeUnits)}</svg>`,
      }),
    ).rejects.toMatchObject({ code: "budget-exceeded" });
    await expect(
      provider.render({
        ...request(),
        fontPolicy: {
          mode: "none",
          fontBuffers: [Uint8Array.of(1)],
        },
      }),
    ).rejects.toMatchObject({ code: "invalid-request" });
    expect(load).not.toHaveBeenCalled();
  });
});
