import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { DEFAULT_STUDIO_LIVING_INK_MATERIAL_CONTROLS } from "./studio-living-ink-gpu-protocol";
import { STUDIO_LIVING_INK_WGSL_ADMISSION } from "./studio-living-ink-webgpu-pure-runtime";
import { tryCreateStudioLivingInkWebGpuRuntime } from "./studio-living-ink-webgpu-runtime";

import type { StudioLivingInkExecutionConfig } from "./studio-living-ink-execution-protocol";

const config: StudioLivingInkExecutionConfig = {
  displayWidth: 64,
  displayHeight: 48,
  fieldWidth: 64,
  fieldHeight: 48,
  coarseBase: 128,
  seed: 1,
  material: DEFAULT_STUDIO_LIVING_INK_MATERIAL_CONTROLS,
  displayMode: "composite",
};

/**
 * Stubs just enough WebGPU to build the real runtime in Node, with one knob: the RGBA the display
 * readback reports for every cell. That single value decides what the admission proof sees.
 */
function stubWebGpuWithDisplay(cell: readonly [number, number, number, number]): () => void {
  const saved = new Map<string, PropertyDescriptor | undefined>();
  const stub = (name: string, value: unknown) => {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  };
  const readback = new Float32Array(config.displayWidth * config.displayHeight * 4);
  for (let index = 0; index < readback.length; index += 4) readback.set(cell, index);
  const buffer = () => ({
    destroy: () => {},
    mapAsync: async () => {},
    getMappedRange: () => readback.buffer.slice(0),
    unmap: () => {},
  });
  stub("GPUBufferUsage", {
    STORAGE: 0x80, COPY_SRC: 0x04, COPY_DST: 0x08, MAP_READ: 0x01, UNIFORM: 0x40,
  });
  stub("GPUMapMode", { READ: 0x01 });
  stub("ImageData", class { constructor(readonly data: unknown) {} });
  stub("OffscreenCanvas", class {
    constructor(readonly width: number, readonly height: number) {}
    getContext(id: string) { return id === "2d" ? { putImageData: () => {} } : null; }
    transferToImageBitmap() { throw new Error("nothing was painted"); }
  });
  stub("navigator", {
    gpu: {
      requestAdapter: async () => ({
        requestDevice: async () => ({
          createBuffer: buffer,
          createShaderModule: () => ({}),
          createComputePipeline: () => ({ getBindGroupLayout: () => ({}) }),
          createBindGroup: () => ({}),
          createCommandEncoder: () => ({
            beginComputePass: () => ({
              setPipeline: () => {},
              setBindGroup: () => {},
              dispatchWorkgroups: () => {},
              end: () => {},
            }),
            copyBufferToBuffer: () => {},
            finish: () => ({}),
          }),
          queue: { writeBuffer: () => {}, submit: () => {} },
          destroy: () => {},
        }),
      }),
    },
  });
  return () => {
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  };
}

describe("Living Ink WebGPU runtime", () => {
  it("fails closed when navigator.gpu is unavailable (CI/Node)", async () => {
    const previous = (globalThis as { navigator?: unknown }).navigator;
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {},
    });
    try {
      await expect(tryCreateStudioLivingInkWebGpuRuntime(config)).resolves.toBeNull();
    } finally {
      Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: previous,
      });
    }
  });

  it("never hands out a WGSL runtime that resolves blank frames", async () => {
    /*
     * A selected WGSL path that computes nothing must not reach the user as a blank canvas.
     * Admission is by demonstration: a runtime whose display buffer stays empty is disposed, and
     * the WebGPU factory returns null without constructing another provider.
     */
    const saved = new Map<string, PropertyDescriptor | undefined>();
    const stub = (name: string, value: unknown) => {
      saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
      Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
    };
    const emptyReadback = new Float32Array(config.fieldWidth * config.fieldHeight * 4);
    const buffer = () => ({
      destroy: () => {},
      mapAsync: async () => {},
      getMappedRange: () => emptyReadback.buffer.slice(0),
      unmap: () => {},
    });
    stub("GPUBufferUsage", {
      STORAGE: 0x80, COPY_SRC: 0x04, COPY_DST: 0x08, MAP_READ: 0x01, UNIFORM: 0x40,
    });
    stub("GPUMapMode", { READ: 0x01 });
    stub("ImageData", class { constructor(readonly data: unknown) {} });
    stub("OffscreenCanvas", class {
      constructor(readonly width: number, readonly height: number) {}
      getContext(id: string) { return id === "2d" ? { putImageData: () => {} } : null; }
      transferToImageBitmap() { throw new Error("nothing was painted"); }
    });
    stub("navigator", {
      gpu: {
        requestAdapter: async () => ({
          requestDevice: async () => ({
            createBuffer: buffer,
            createShaderModule: () => ({}),
            createComputePipeline: () => ({ getBindGroupLayout: () => ({}) }),
            createBindGroup: () => ({}),
            createCommandEncoder: () => ({
              beginComputePass: () => ({
                setPipeline: () => {},
                setBindGroup: () => {},
                dispatchWorkgroups: () => {},
                end: () => {},
              }),
              copyBufferToBuffer: () => {},
              finish: () => ({}),
            }),
            queue: { writeBuffer: () => {}, submit: () => {} },
            destroy: () => {},
          }),
        }),
      },
    });
    try {
      await expect(tryCreateStudioLivingInkWebGpuRuntime(config)).resolves.toBeNull();
    } finally {
      for (const [name, descriptor] of saved) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      }
    }
  });

  /*
   * The WebGPU admission contract, stated as a test.
   *
   * The WGSL runtime is the faster of the two shipped backends, and this is the seam where a user
   * with a WebGPU adapter gets it. The material policy ranks handfeel and texture above throughput
   * and lets performance veto only — so "an adapter exists" is not a sufficient reason to prefer
   * it, and neither is "it rendered something". A resolve that has lost the paper and optical
   * density model still renders: uniformly, brightly, and wrongly. This test pins that such a
   * runtime is refused, which leaves the selected WebGPU provider unavailable.
   */
  it("refuses a WGSL runtime that renders flat, untextured paper even though it is not blank", async () => {
    // Uniform paper white everywhere: non-blank, zero texture standard deviation, zero ink
    // darkness — precisely the signature of a bare `exp(-density)` display resolve.
    const restore = stubWebGpuWithDisplay([0.965, 0.956, 0.932, 1]);
    try {
      // Admission fails, the runtime is disposed, and null reports WebGPU unavailable.
      await expect(tryCreateStudioLivingInkWebGpuRuntime(config)).resolves.toBeNull();
    } finally {
      restore();
    }
  });

  it("keeps the admission floors above zero so the quality gate cannot be silently disabled", () => {
    expect(STUDIO_LIVING_INK_WGSL_ADMISSION.minimumPaperLuminanceStandardDeviation)
      .toBeGreaterThan(0);
    expect(STUDIO_LIVING_INK_WGSL_ADMISSION.minimumProbeStrokeDarkness).toBeGreaterThan(0);
  });

  it("exports a WebGPU-only runtime helper used by the Worker", async () => {
    // Without a real adapter the helper returns null; presence of the export is the product seam.
    const runtime = await tryCreateStudioLivingInkWebGpuRuntime(config);
    if (runtime) {
      expect(runtime.capabilities.backend).toBe("webgpu-offscreen-half-float");
      expect(runtime.capabilities.webgpu).toBe(true);
      runtime.dispose();
    } else {
      expect(runtime).toBeNull();
    }
  });

  it("does not import, construct, or relabel the independent WebGL2 provider", () => {
    const source = readFileSync(
      new URL("./studio-living-ink-webgpu-runtime.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toContain("StudioLivingInkWebGl2Runtime");
    expect(source).not.toContain('backend: "webgpu-offscreen-half-float" as const');
    expect(source).not.toContain("Object.defineProperty(webgl");
  });
});
