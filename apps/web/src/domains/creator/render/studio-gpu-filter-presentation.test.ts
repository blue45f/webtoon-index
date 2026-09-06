import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
  STUDIO_GPU_FILTER_PRESENTATION_ALPHA,
  STUDIO_GPU_FILTER_PRESENTATION_WGSL,
  createStudioGpuFilterPresentationSurface,
} from "./studio-gpu-filter-presentation";

import type {
  StudioGpuFilterPresentationCanvas,
} from "./studio-gpu-filter-presentation";

function harness(options?: { context?: boolean; validationError?: string }) {
  const configure = vi.fn();
  const unconfigure = vi.fn();
  const getCurrentTexture = vi.fn(() => ({ createView: vi.fn(() => ({ view: true })) }));
  const context = options?.context === false ? null : {
    configure,
    getCurrentTexture,
    unconfigure,
  } as unknown as GPUCanvasContext;
  const canvas = {
    height: 1,
    width: 1,
    getContext: vi.fn(() => context),
  } as unknown as StudioGpuFilterPresentationCanvas;
  const destroyUniform = vi.fn();
  const draw = vi.fn();
  const passEnd = vi.fn();
  const beginRenderPass = vi.fn(() => ({
    draw,
    end: passEnd,
    setBindGroup: vi.fn(),
    setPipeline: vi.fn(),
  }));
  const copyTextureToBuffer = vi.fn();
  const finish = vi.fn(() => ({ commands: true }));
  const createCommandEncoder = vi.fn(() => ({
    beginRenderPass,
    copyTextureToBuffer,
    finish,
  }));
  const createRenderPipeline = vi.fn(() => ({
    getBindGroupLayout: vi.fn(() => ({ layout: true })),
  }));
  const createBuffer = vi.fn(() => ({
    destroy: destroyUniform,
    getMappedRange: vi.fn(),
    mapAsync: vi.fn(),
  }));
  const popResults = options?.validationError
    ? [{ message: options.validationError }, null]
    : [null, null];
  const queue = {
    submit: vi.fn(),
    writeBuffer: vi.fn(),
  };
  const device = {
    createBindGroup: vi.fn(() => ({ bindGroup: true })),
    createBuffer,
    createCommandEncoder,
    createRenderPipeline,
    createShaderModule: vi.fn(() => ({ shader: true })),
    limits: { maxTextureDimension2D: 8_192 },
    popErrorScope: vi.fn(async () => popResults.shift() ?? null),
    pushErrorScope: vi.fn(),
    queue,
  } as unknown as GPUDevice;
  return {
    beginRenderPass,
    canvas,
    configure,
    context,
    copyTextureToBuffer,
    createBuffer,
    createRenderPipeline,
    destroyUniform,
    device,
    draw,
    getCurrentTexture,
    queue,
    unconfigure,
  };
}

/**
 * Evaluates the shipped `fragment_main` of the real presentation shader for one packed texel.
 * It parses the WGSL that actually ships rather than restating it, so a shader that stops
 * reconciling the buffer's alpha convention with the swapchain's is caught here.
 */
function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const character of text) {
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (character === separator && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}

function balancedSlice(source: string, openIndex: number, open: string, close: string): string {
  let depth = 0;
  for (let index = openIndex; index < source.length; index += 1) {
    if (source[index] === open) depth += 1;
    else if (source[index] === close) {
      depth -= 1;
      if (depth === 0) return source.slice(openIndex + 1, index);
    }
  }
  throw new Error("The WGSL source has unbalanced delimiters.");
}

function fragmentBody(wgsl: string): string {
  const entry = wgsl.indexOf("fn fragment_main");
  if (entry < 0) throw new Error("fragment_main is missing from the presentation shader.");
  return balancedSlice(wgsl, wgsl.indexOf("{", entry), "{", "}");
}

const CHANNEL_CALL = /^channel\(\s*(\w+)\s*,\s*(\d+)u\s*\)$/u;

function evaluateScalar(
  expression: string,
  bindings: ReadonlyMap<string, string>,
  texels: ReadonlyMap<string, number>,
): number {
  const factors = splitTopLevel(expression, "*");
  if (factors.length > 1) {
    return factors.reduce((product, factor) => product * evaluateScalar(factor, bindings, texels), 1);
  }
  const text = factors[0] ?? "";
  const call = CHANNEL_CALL.exec(text);
  if (call) {
    const packed = texels.get(call[1] as string);
    if (packed === undefined) throw new Error(`Unknown texel operand: ${call[1]}`);
    return ((packed >>> Number(call[2])) & 255) / 255;
  }
  if (/^\d+(?:\.\d+)?$/u.test(text)) return Number(text);
  const bound = bindings.get(text);
  if (bound === undefined) throw new Error(`Unsupported WGSL expression: ${text}`);
  return evaluateScalar(bound, bindings, texels);
}

function presentTexel(packed: number): readonly [number, number, number, number] {
  const body = fragmentBody(STUDIO_GPU_FILTER_PRESENTATION_WGSL);
  const bindings = new Map<string, string>();
  for (const match of body.matchAll(/let\s+(\w+)\s*=\s*([^;]+);/gu)) {
    bindings.set(match[1] as string, (match[2] as string).trim());
  }
  const marker = "return vec4<f32>";
  const start = body.indexOf(marker);
  if (start < 0) throw new Error("fragment_main does not return a vec4<f32>.");
  const args = splitTopLevel(balancedSlice(body, body.indexOf("(", start), "(", ")"), ",");
  if (args.length !== 4) throw new Error(`fragment_main returned ${args.length} channels.`);
  const texels = new Map([["packed", packed]]);
  const [red, green, blue, alpha] = args.map((arg) => evaluateScalar(arg, bindings, texels));
  return [red as number, green as number, blue as number, alpha as number];
}

function packStraightRgba(r: number, g: number, b: number, a: number): number {
  return (r | (g << 8) | (b << 16) | (a << 24)) >>> 0;
}

describe("retained GPU filter presentation alpha convention", () => {
  it("presents a straight-alpha texel premultiplied so it composites at the authored value", () => {
    // The packed buffer is straight alpha; the swapchain below is premultiplied.
    expect(STUDIO_GPU_FILTER_PRESENTATION_ALPHA).toEqual({
      buffer: "straight",
      swapchain: "premultiplied",
    });

    const alpha = 128 / 255;
    const presented = presentTexel(packStraightRgba(200, 100, 50, 128));

    expect(presented[3]).toBeCloseTo(alpha, 10);
    expect(presented[0]).toBeCloseTo((200 / 255) * alpha, 10);
    expect(presented[1]).toBeCloseTo((100 / 255) * alpha, 10);
    expect(presented[2]).toBeCloseTo((50 / 255) * alpha, 10);

    // What the premultiplied compositor puts on screen over an opaque white page. Emitting the
    // channels verbatim would land at 1.282/0.890/0.694 here — the red channel blown past white.
    const overWhite = presented.slice(0, 3).map((channel) => channel + (1 - alpha));
    expect(overWhite[0]).toBeCloseTo(0.8917339, 6);
    expect(overWhite[1]).toBeCloseTo(0.6948866, 6);
    expect(overWhite[2]).toBeCloseTo(0.5964629, 6);
  });

  it("leaves a fully opaque texel and a fully transparent texel untouched", () => {
    expect(presentTexel(packStraightRgba(200, 100, 50, 255)).map((c) => Math.round(c * 255)))
      .toEqual([200, 100, 50, 255]);
    expect(presentTexel(packStraightRgba(200, 100, 50, 0))).toEqual([0, 0, 0, 0]);
  });

  it("configures the swapchain with the alpha mode the shader emits", async () => {
    const h = harness();
    const surface = createStudioGpuFilterPresentationSurface({
      createCanvas: () => h.canvas,
      preferredCanvasFormat: () => "bgra8unorm",
    });
    await surface.present({
      device: h.device,
      pixels: {} as GPUBuffer,
      width: 8,
      height: 8,
    });
    expect(h.configure).toHaveBeenCalledWith(
      expect.objectContaining({ alphaMode: STUDIO_GPU_FILTER_PRESENTATION_ALPHA.swapchain }),
    );
  });
});

describe("retained GPU filter presentation", () => {
  it("presents successive filter frames on one retained canvas without a readback command", async () => {
    const h = harness();
    const surface = createStudioGpuFilterPresentationSurface({
      createCanvas: () => h.canvas,
      preferredCanvasFormat: () => "bgra8unorm",
    });
    const pixels = { destroy: vi.fn() } as unknown as GPUBuffer;

    await expect(surface.present({ device: h.device, pixels, width: 64, height: 32 }))
      .resolves.toEqual({ status: "presented", revision: 1 });
    await expect(surface.present({ device: h.device, pixels, width: 64, height: 32 }))
      .resolves.toEqual({ status: "presented", revision: 2 });

    expect(surface.canvas).toBe(h.canvas);
    expect(h.configure).toHaveBeenCalledTimes(1);
    expect(h.createRenderPipeline).toHaveBeenCalledTimes(1);
    expect(h.getCurrentTexture).toHaveBeenCalledTimes(2);
    expect(h.draw).toHaveBeenCalledTimes(2);
    expect(h.queue.submit).toHaveBeenCalledTimes(2);
    expect(h.copyTextureToBuffer).not.toHaveBeenCalled();
    for (const [buffer] of h.createBuffer.mock.results.map((result) => [result.value])) {
      expect(buffer.mapAsync).not.toHaveBeenCalled();
      expect(buffer.getMappedRange).not.toHaveBeenCalled();
    }
  });

  it("reconfigures the same surface on a dimension change and disposes it idempotently", async () => {
    const h = harness();
    const surface = createStudioGpuFilterPresentationSurface({
      createCanvas: () => h.canvas,
      preferredCanvasFormat: () => "bgra8unorm",
    });
    const pixels = {} as GPUBuffer;

    expect((await surface.present({ device: h.device, pixels, width: 20, height: 10 })).status)
      .toBe("presented");
    expect((await surface.present({ device: h.device, pixels, width: 40, height: 30 })).status)
      .toBe("presented");
    expect(h.configure).toHaveBeenCalledTimes(2);
    expect(h.canvas.width).toBe(40);
    expect(h.canvas.height).toBe(30);

    surface.dispose();
    surface.dispose();
    expect(h.unconfigure).toHaveBeenCalledTimes(3);
    await expect(surface.present({ device: h.device, pixels, width: 40, height: 30 }))
      .resolves.toEqual({
        status: "unavailable",
        reason: "The retained GPU filter surface is disposed.",
      });
  });

  it("fails visibly when WebGPU canvas presentation is unavailable or validation fails", async () => {
    const missing = harness({ context: false });
    const missingSurface = createStudioGpuFilterPresentationSurface({
      createCanvas: () => missing.canvas,
      preferredCanvasFormat: () => "bgra8unorm",
    });
    await expect(missingSurface.present({
      device: missing.device,
      pixels: {} as GPUBuffer,
      width: 10,
      height: 10,
    })).resolves.toEqual({ status: "unavailable", reason: "GPUCanvasContext is unavailable." });

    const invalid = harness({ validationError: "shader rejected" });
    const invalidSurface = createStudioGpuFilterPresentationSurface({
      createCanvas: () => invalid.canvas,
      preferredCanvasFormat: () => "bgra8unorm",
    });
    await expect(invalidSurface.present({
      device: invalid.device,
      pixels: {} as GPUBuffer,
      width: 10,
      height: 10,
    })).resolves.toEqual({ status: "unavailable", reason: "shader rejected" });
  });

  it("keeps forbidden GPU/CPU transfer APIs out of the interactive presentation implementation", () => {
    const source = readFileSync(
      new URL("./studio-gpu-filter-presentation.ts", import.meta.url),
      "utf8",
    );
    const executable = source
      .replace(/\/\*[\s\S]*?\*\//gu, "")
      .replace(/\/\/.*$/gmu, "");
    expect(executable).not.toMatch(/\b(?:MAP_READ|getImageData|readPixels|mapAsync)\b/u);
    expect(executable).not.toContain("copyTextureToBuffer");
    expect(executable).not.toContain("copyBufferToBuffer");
  });
});
