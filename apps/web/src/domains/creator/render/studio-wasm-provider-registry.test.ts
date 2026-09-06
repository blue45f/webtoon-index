import { describe, expect, it, vi } from "vitest";

import {
  STUDIO_SPECIALIST_PROVIDER_REGISTRY_REVISION,
  StudioSpecialistProviderRegistry,
  isStudioSpecialistProviderDescriptor,
  type StudioSpecialistProviderCapability,
  type StudioSpecialistProviderDescriptor,
  type StudioSpecialistRendererAffinity,
} from "./studio-wasm-provider-registry";

function descriptor(
  id: string,
  capability: StudioSpecialistProviderCapability,
  affinity: StudioSpecialistRendererAffinity,
  priority: number,
): StudioSpecialistProviderDescriptor {
  return {
    registryRevision: STUDIO_SPECIALIST_PROVIDER_REGISTRY_REVISION,
    id,
    label: `${id} specialist`,
    version: 1,
    priority,
    implementation:
      affinity === "raw-webgpu" ? "native-browser" : "wasm-library",
    locality: "main-or-worker",
    initialization: "lazy",
    lifecycle: "explicit-destroy",
    capabilities: [capability],
    runtimeDependencies: [id],
    renderer: {
      affinity,
      ownsSurface: affinity !== "none",
    },
    canonicalBoundary: {
      structuredCloneInput: true,
      structuredCloneOutput: true,
      opaqueRuntimeHandles: "forbidden",
    },
  };
}

describe("Studio specialist provider registry", () => {
  it("coexists with renderer specialists without loading any registration", async () => {
    const registry = new StudioSpecialistProviderRegistry();
    const loaders = [
      ["harfbuzz-wasm", "text:opentype-shaping", "none", 100],
      ["canvaskit-wasm", "vector:path-quality", "canvaskit", 90],
      ["pixi-renderer", "raster:composite", "pixi", 80],
      ["raw-webgpu", "raster:gpu-fx", "raw-webgpu", 110],
    ] as const;
    const destroys: string[] = [];
    for (const [id, capability, affinity, priority] of loaders) {
      const providerDescriptor = descriptor(
        id,
        capability,
        affinity,
        priority,
      );
      const loader = vi.fn(async () => ({
        descriptor: providerDescriptor,
        destroy: () => {
          destroys.push(id);
        },
      }));
      registry.register(providerDescriptor, loader);
      expect(loader).not.toHaveBeenCalled();
    }

    expect(
      registry.descriptors().map(({ id }) => id),
    ).toEqual([
      "raw-webgpu",
      "harfbuzz-wasm",
      "canvaskit-wasm",
      "pixi-renderer",
    ]);
    expect(registry.snapshot().providers.every(({ loaded }) => !loaded)).toBe(true);

    const loaded = await registry.load("harfbuzz-wasm");
    expect(loaded.descriptor.id).toBe("harfbuzz-wasm");
    expect((await registry.load("harfbuzz-wasm"))).toBe(loaded);
    expect(
      registry.snapshot().providers.find(({ id }) => id === "harfbuzz-wasm"),
    ).toMatchObject({ loaded: true });

    await registry.destroy();
    expect(destroys).toEqual(["harfbuzz-wasm"]);
    expect(registry.snapshot().state).toBe("destroyed");
  });

  it("validates lifecycle, canonical boundaries, and surface ownership", () => {
    expect(
      isStudioSpecialistProviderDescriptor(
        descriptor("resvg-wasm", "vector:svg-raster-png", "none", 10),
      ),
    ).toBe(true);
    expect(
      isStudioSpecialistProviderDescriptor({
        ...descriptor(
          "broken-surface",
          "vector:svg-raster-rgba",
          "none",
          10,
        ),
        renderer: { affinity: "none", ownsSurface: true },
      }),
    ).toBe(false);
    expect(
      isStudioSpecialistProviderDescriptor({
        ...descriptor("broken-boundary", "image:analysis", "none", 10),
        canonicalBoundary: {
          structuredCloneInput: true,
          structuredCloneOutput: true,
          opaqueRuntimeHandles: "allowed",
        },
      }),
    ).toBe(false);
  });

  it("retries failed lazy loads and rejects mismatched implementations", async () => {
    const registry = new StudioSpecialistProviderRegistry();
    const expected = descriptor(
      "retry-provider",
      "image:analysis",
      "none",
      10,
    );
    const loader = vi.fn()
      .mockRejectedValueOnce(new Error("transient init failure"))
      .mockResolvedValueOnce({
        descriptor: expected,
        destroy: vi.fn(),
      });
    registry.register(expected, loader);

    await expect(registry.load(expected.id)).rejects.toThrow(
      "transient init failure",
    );
    await expect(registry.load(expected.id)).resolves.toMatchObject({
      descriptor: { id: expected.id },
    });
    expect(loader).toHaveBeenCalledTimes(2);

    const mismatchRegistry = new StudioSpecialistProviderRegistry();
    mismatchRegistry.register(expected, () => ({
      descriptor: { ...expected, id: "different-provider" },
      destroy: vi.fn(),
    }));
    await expect(mismatchRegistry.load(expected.id)).rejects.toThrow(
      "does not match",
    );
  });

  it("destroys loaded providers in reverse registration order exactly once", async () => {
    const registry = new StudioSpecialistProviderRegistry();
    const events: string[] = [];
    for (const id of ["first-provider", "second-provider"]) {
      const providerDescriptor = descriptor(
        id,
        "image:analysis",
        "none",
        10,
      );
      registry.register(providerDescriptor, () => ({
        descriptor: providerDescriptor,
        destroy: () => {
          events.push(id);
        },
      }));
      await registry.load(id);
    }
    await Promise.all([registry.destroy(), registry.destroy()]);
    expect(events).toEqual(["second-provider", "first-provider"]);
  });
});
