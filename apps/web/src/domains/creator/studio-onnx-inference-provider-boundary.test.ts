import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function source(fileName: string): string {
  return readFileSync(new URL(fileName, import.meta.url), "utf8");
}

const provider = source("./studio-onnx-inference-provider.ts");
const registry = source("./studio-onnx-model-registry.ts");
const tests = source("./studio-onnx-inference-provider.test.ts");

describe("Studio ONNX inference provider source boundary", () => {
  it("keeps model descriptors plain-data and AI/runtime neutral", () => {
    expect(registry).not.toMatch(/\bonnxruntime(?:-web)?\b/iu);
    expect(registry).not.toMatch(/\bwebgpu\b/iu);
    expect(registry).not.toMatch(/\bwasm\b/iu);
    expect(registry).not.toMatch(/\bkonva\b/iu);
    expect(registry).toContain("readonly id: string");
    expect(registry).toContain("readonly version: string");
    expect(registry).toContain("readonly sha256:");
    expect(registry).toContain("readonly byteBudget: number");
    expect(registry).toContain("readonly inputs:");
    expect(registry).toContain("readonly outputs:");
  });

  it("uses only a lazy WebGPU-capable runtime import and has no Konva/UI dependency", () => {
    expect(provider).toContain(
      'return await import("onnxruntime-web/webgpu")',
    );
    expect(provider).toMatch(
      /^import type \{ InferenceSession, Tensor \} from "onnxruntime-web";/mu,
    );
    expect(provider).not.toMatch(
      /^import\s+(?!type\b)[^\n]*from "onnxruntime-web(?:\/webgpu)?";/mu,
    );
    expect(provider).not.toMatch(/\bkonva\b/iu);
    expect(provider).not.toMatch(/\breact\b/iu);
  });

  it("binds one explicit execution provider and records fail-closed evidence", () => {
    expect(provider).toContain(
      'STUDIO_ONNX_EXECUTION_PROVIDERS = [\n  "webgpu",\n  "wasm",',
    );
    expect(provider).toContain(': ["wasm"],');
    expect(provider).toContain('name: "webgpu"');
    expect(provider).toContain('attemptCount: 1');
    expect(provider).toContain('failureIsolation: "fail-closed"');
    expect(provider).not.toContain("StudioOnnxFallbackReason");
    expect(provider).toContain(
      "activeExecutionProvider: input.executionProvider",
    );
  });

  it("bounds URL and byte loading without an unbounded arrayBuffer shortcut", () => {
    expect(provider).toContain("resolveStudioOnnxModelUrl");
    expect(provider).toContain('resolved.pathname.toLowerCase().endsWith(".onnx")');
    expect(provider).toContain("allowedOrigins.has(resolved.origin)");
    expect(provider).toContain("response.body.getReader()");
    expect(provider).toContain("byteLength > request.maxBytes");
    expect(provider).not.toContain("response.arrayBuffer()");
    expect(provider).toContain("sha256HexPortable(bytes)");
  });

  it("guards epochs, defensive result copies, and all session/tensor teardown paths", () => {
    expect(provider).toContain("left.request === right.request");
    expect(provider).toContain("this.assertCurrentEpoch(epoch)");
    expect(provider).toContain('"stale-result"');
    expect(provider).toContain("new Float32Array(data as Float32Array)");
    expect(provider).toContain("await created.session.release()");
    expect(provider).toContain("await cached.session.release()");
    expect(provider).toContain("session.release()");
    expect(provider).toContain("tensor.dispose()");
    expect(provider).toContain("disposeOnnxValues(rawOutputs)");
  });

  it("keeps tests offline through injected byte/runtime seams and ships no model artifact", () => {
    expect(tests).toContain("loadModelBytes: loader");
    expect(tests).toContain("loadRuntime: async () =>");
    expect(tests).not.toContain("fetch(");
    expect(provider).not.toMatch(/["'][^"']+\.onnx["']/u);
    expect(registry).not.toMatch(/["'][^"']+\.onnx["']/u);
  });

  it("validates mask dimensions and strides before threshold or stable softmax conversion", () => {
    expect(provider).toContain("validateMaskDimensions");
    expect(provider).toContain("rowStride");
    expect(provider).toContain("pixelStride");
    expect(provider).toContain("classStride");
    expect(provider).toContain("maximum = Math.max(maximum, value)");
    expect(provider).toContain("Math.exp(");
    expect(provider).toContain("new Uint8Array(pixels)");
  });
});
