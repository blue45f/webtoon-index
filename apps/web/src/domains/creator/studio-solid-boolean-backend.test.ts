import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
  createStudioDefaultSolidBooleanBackend,
  createStudioManifoldSolidBooleanBackend,
  createStudioPureConvexSolidBooleanBackend,
} from "./studio-solid-boolean-backend";

import type {
  StudioManifoldRuntime,
  StudioManifoldTopology,
} from "./studio-manifold-mesh-provider";
import type { StudioSolidBooleanBackend } from "./studio-mesh-modifier-stack";

const tetrahedron = {
  positions: new Float32Array([
    0, 0, 0,
    1, 0, 0,
    0, 1, 0,
    0, 0, 1,
  ]),
  indices: new Uint32Array([
    0, 2, 1,
    0, 1, 3,
    1, 2, 3,
    2, 0, 3,
  ]),
};

const request = {
  left: tetrahedron,
  right: tetrahedron,
  operation: "difference" as const,
};

describe("Studio solid boolean provider selection", () => {
  it("propagates the selected Manifold failure without invoking another backend", async () => {
    const selectedError = new Error("manifold-runtime-unavailable");
    const manifoldBackend: StudioSolidBooleanBackend = {
      boolean: vi.fn(async () => {
        throw selectedError;
      }),
    };
    const backend = createStudioDefaultSolidBooleanBackend({ manifoldBackend });

    await expect(backend.boolean(request)).rejects.toBe(selectedError);
    expect(manifoldBackend.boolean).toHaveBeenCalledOnce();
  });

  it("rejects an abnormal Manifold result without retrying the same request", async () => {
    const manifoldBackend: StudioSolidBooleanBackend = {
      boolean: vi.fn(async () => ({
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        indices: new Uint32Array([0, 1, 2]),
        diagnostic: "manifold:test",
      })),
    };
    const backend = createStudioDefaultSolidBooleanBackend({ manifoldBackend });

    await expect(backend.boolean(request)).rejects.toThrow("Manifold solid is unavailable");
    expect(manifoldBackend.boolean).toHaveBeenCalledOnce();
  });

  it("runs the Manifold provider once even when its output is degenerate", async () => {
    const boolean = vi.fn(() => ({ kind: "result" }));
    const runtime: StudioManifoldRuntime = {
      version: "test-manifold",
      createManifold: vi.fn(() => ({ kind: "input" })),
      status: vi.fn(() => "NoError"),
      boolean,
      getMesh: vi.fn(() => ({
        numProp: 3,
        vertProperties: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        triangleIndices: new Uint32Array([0, 1, 2]),
      })),
      inspectManifold: vi.fn((): StudioManifoldTopology => ({
        status: "NoError",
        empty: false,
        physicalVertexCount: 3,
        triangleCount: 1,
        genus: 0,
        surfaceArea: 0.5,
        volume: 0,
        boundingBox: { min: [0, 0, 0], max: [1, 1, 0] },
      })),
      deleteManifold: vi.fn(),
      destroy: vi.fn(),
    };
    const backend = createStudioManifoldSolidBooleanBackend({
      runtimeLoader: () => runtime,
    });

    await expect(backend.boolean(request)).rejects.toThrow("degenerate solid");
    expect(boolean).toHaveBeenCalledOnce();
  });

  it("keeps pure convex CSG as an explicit API, not inside the default backend", () => {
    expect(createStudioPureConvexSolidBooleanBackend()).toHaveProperty("boolean");
    const source = readFileSync(
      new URL("./studio-solid-boolean-backend.ts", import.meta.url),
      "utf8",
    );
    const defaultStart = source.indexOf("export function createStudioDefaultSolidBooleanBackend(");
    expect(defaultStart).toBeGreaterThanOrEqual(0);
    const defaultBackendSource = source.slice(defaultStart);
    expect(defaultBackendSource).not.toContain("createStudioPureConvexSolidBooleanBackend");
    expect(source).not.toContain("winding-flipped");
    expect(source).not.toContain("manifold-fallback");
  });
});
