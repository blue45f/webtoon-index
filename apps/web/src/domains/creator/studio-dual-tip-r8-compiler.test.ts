import { describe, expect, it, vi } from "vitest";

import {
  adaptStudioDualTipR8ToTexturedBrushAsset,
  compileStudioDualTipR8,
} from "./studio-dual-tip-r8-compiler";
import { sha256HexPortable } from "./studio-sha256";

function source(
  assetId: string,
  width: number,
  height: number,
  values: readonly number[],
  overrides: Record<string, unknown> = {},
) {
  const bytes = new Uint8Array(values);
  return {
    kind: "studio-r8-tip-source",
    version: 1,
    assetId,
    contentHash: `sha256:${sha256HexPortable(bytes)}`,
    width,
    height,
    bytes,
    invert: false,
    edgeMode: "transparent",
    transform: {
      m11: 1,
      m12: 0,
      m21: 0,
      m22: 1,
      translateX: 0,
      translateY: 0,
    },
    ...overrides,
  };
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    kind: "studio-dual-tip-r8-compile-request",
    version: 1,
    outputAssetId: "dual-tip:clean-room",
    width: 2,
    height: 2,
    mode: "intersect",
    secondaryOpacity: 1,
    primary: source("primary", 2, 2, [255, 128, 0, 64]),
    secondary: source("secondary", 2, 2, [128, 255, 255, 0]),
    ...overrides,
  };
}

describe("dual-tip R8 compiler", () => {
  it("compiles an exact deterministic intersection mask with content identities", () => {
    const first = compileStudioDualTipR8(request());
    const second = compileStudioDualTipR8(request());

    expect(first.status).toBe("compiled");
    expect(second.status).toBe("compiled");
    if (first.status !== "compiled" || second.status !== "compiled") return;
    expect([...first.bytes]).toEqual([128, 128, 0, 0]);
    expect(first.contentHash).toBe(`sha256:${sha256HexPortable(first.bytes)}`);
    expect(first.recipeFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(second).toEqual(first);
    expect(Object.isFrozen(first)).toBe(true);
  });

  it("uses secondary opacity as a non-destructive blend from the primary mask", () => {
    const primaryOnly = compileStudioDualTipR8(request({ secondaryOpacity: 0 }));
    const half = compileStudioDualTipR8(request({ secondaryOpacity: 0.5 }));
    expect(primaryOnly.status).toBe("compiled");
    expect(half.status).toBe("compiled");
    if (primaryOnly.status !== "compiled" || half.status !== "compiled") return;
    expect([...primaryOnly.bytes]).toEqual([255, 128, 0, 64]);
    expect([...half.bytes]).toEqual([192, 128, 0, 32]);
  });

  it.each([
    ["darken", 64],
    ["lighten", 192],
    ["add", 255],
    ["subtract", 0],
    ["difference", 128],
    ["screen", 208],
  ] as const)("implements the %s combination mode", (mode, expected) => {
    const result = compileStudioDualTipR8(request({
      width: 1,
      height: 1,
      mode,
      primary: source("primary", 1, 1, [64]),
      secondary: source("secondary", 1, 1, [192]),
    }));
    expect(result.status).toBe("compiled");
    if (result.status !== "compiled") return;
    expect(result.bytes[0]).toBe(expected);
  });

  it("inverse-maps affine tip transforms and preserves a transparent exterior", () => {
    const result = compileStudioDualTipR8(request({
      width: 4,
      height: 1,
      primary: source("primary", 4, 1, [255, 255, 255, 255]),
      secondary: source("secondary", 2, 1, [255, 255], {
        transform: {
          m11: 0.5,
          m12: 0,
          m21: 0,
          m22: 1,
          translateX: 0.5,
          translateY: 0,
        },
      }),
    }));
    expect(result.status).toBe("compiled");
    if (result.status !== "compiled") return;
    expect(result.bytes[0]).toBe(0);
    expect(result.bytes[1]).toBe(0);
    expect(result.bytes[2]).toBeGreaterThan(0);
    expect(result.bytes[3]).toBeGreaterThan(0);
  });

  it("supports repeat and invert without turning the transparent exterior opaque", () => {
    const repeated = compileStudioDualTipR8(request({
      width: 4,
      height: 1,
      primary: source("primary", 4, 1, [255, 255, 255, 255]),
      secondary: source("secondary", 1, 1, [64], {
        edgeMode: "repeat",
        invert: true,
        transform: {
          m11: 0.25,
          m12: 0,
          m21: 0,
          m22: 1,
          translateX: 0,
          translateY: 0,
        },
      }),
    }));
    expect(repeated.status).toBe("compiled");
    if (repeated.status !== "compiled") return;
    expect([...repeated.bytes]).toEqual([191, 191, 191, 191]);

    const translated = compileStudioDualTipR8(request({
      width: 2,
      height: 1,
      primary: source("primary", 2, 1, [255, 255]),
      secondary: source("secondary", 1, 1, [0], {
        invert: true,
        transform: {
          m11: 0.25,
          m12: 0,
          m21: 0,
          m22: 1,
          translateX: 2,
          translateY: 0,
        },
      }),
    }));
    expect(translated.status).toBe("compiled");
    if (translated.status !== "compiled") return;
    expect([...translated.bytes]).toEqual([0, 0]);
  });

  it("rejects hostile accessors, singular transforms, stale hashes, and pixel overflow", () => {
    const getter = vi.fn(() => "intersect");
    const hostile = request();
    Object.defineProperty(hostile, "mode", { enumerable: true, get: getter });
    expect(compileStudioDualTipR8(hostile)).toMatchObject({
      status: "rejected",
      reason: "invalid-request",
    });
    expect(getter).not.toHaveBeenCalled();

    expect(compileStudioDualTipR8(request({
      primary: source("primary", 1, 1, [255], {
        transform: {
          m11: 1,
          m12: 2,
          m21: 2,
          m22: 4,
          translateX: 0,
          translateY: 0,
        },
      }),
    }))).toMatchObject({
      status: "rejected",
      reason: "singular-transform",
      path: "$.primary.transform",
    });
    expect(compileStudioDualTipR8(request({
      primary: {
        ...source("primary", 1, 1, [255]),
        contentHash: `sha256:${"0".repeat(64)}`,
      },
    }))).toMatchObject({
      status: "rejected",
      reason: "source-content-hash-mismatch",
    });
    expect(compileStudioDualTipR8(request(), { maximumPixels: 3 })).toMatchObject({
      status: "rejected",
      reason: "pixel-budget-exceeded",
    });
  });

  it("cancels at deterministic row boundaries without returning a partial asset", () => {
    const cancel = vi.fn(({ completedRows }: { completedRows: number }) => completedRows === 1);
    const result = compileStudioDualTipR8(request(), { shouldCancel: cancel });
    expect(result).toEqual({
      status: "cancelled",
      completedRows: 1,
      totalRows: 2,
    });
    expect(cancel).toHaveBeenCalledTimes(2);
  });

  it("adapts a compiled mask to the exact content-addressed textured-provider payload", () => {
    const compiled = compileStudioDualTipR8(request());
    expect(compiled.status).toBe("compiled");
    if (compiled.status !== "compiled") return;
    const adapted = adaptStudioDualTipR8ToTexturedBrushAsset(compiled);
    expect(adapted.status).toBe("ready");
    if (adapted.status !== "ready") return;
    expect(adapted.payload).toMatchObject({
      kind: "studio-textured-brush-r8-asset",
      version: 1,
      assetId: compiled.assetId,
      contentHash: compiled.contentHash,
      width: compiled.width,
      height: compiled.height,
      channel: "alpha",
      format: "r8-unorm",
      byteLength: compiled.byteLength,
    });
    expect(adapted.payload.bytes).not.toBe(compiled.bytes);
    compiled.bytes[0] = 0;
    expect(adapted.payload.bytes[0]).toBe(128);

    expect(adaptStudioDualTipR8ToTexturedBrushAsset({
      ...compiled,
      contentHash: `sha256:${"f".repeat(64)}`,
    })).toEqual({ status: "rejected", reason: "content-hash-mismatch" });
  });
});
