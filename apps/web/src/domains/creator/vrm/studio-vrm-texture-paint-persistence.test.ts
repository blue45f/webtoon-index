import { describe, expect, it, vi } from "vitest";

import {
  STUDIO_VRM_SURFACE_PAINT_MAX_TEXTURES,
} from "./studio-vrm-scene-document";
import {
  STUDIO_VRM_TEXTURE_PAINT_ARTIFACT_KIND,
  STUDIO_VRM_TEXTURE_PAINT_ARTIFACT_MIME,
  STUDIO_VRM_TEXTURE_PAINT_ARTIFACT_SCHEMA_VERSION,
  type StudioVrmTexturePaintArtifact,
  type StudioVrmTexturePaintArtifactHash,
} from "./studio-vrm-texture-paint-artifact";
import {
  persistStudioVrmTexturePaintRuntime,
  rehydrateStudioVrmTexturePaintRuntime,
} from "./studio-vrm-texture-paint-persistence";

import type { StudioVrmTexturePaintPersistenceDependencies } from "./studio-vrm-texture-paint-persistence";

const hash = `sha256:${"ab".repeat(32)}` as const;
const secondHash = `sha256:${"cd".repeat(32)}` as const;

function artifact(
  bindingKey = "gltf-material-2-baseColor",
  contentHash: StudioVrmTexturePaintArtifactHash = hash,
): StudioVrmTexturePaintArtifact {
  const png = new Blob([new Uint8Array(64)], { type: "image/png" });
  const metadata = {
    schemaVersion: STUDIO_VRM_TEXTURE_PAINT_ARTIFACT_SCHEMA_VERSION,
    kind: STUDIO_VRM_TEXTURE_PAINT_ARTIFACT_KIND,
    bindingKey,
    contentHash,
    mimeType: STUDIO_VRM_TEXTURE_PAINT_ARTIFACT_MIME,
    byteLength: png.size,
    width: 2,
    height: 1,
  } as const;
  return {
    metadata,
    archiveEntry: {
      path: `assets/sha256/${contentHash.slice(7, 9)}/${contentHash.slice(9)}.png`,
      data: png,
      contentHash,
      mimeType: STUDIO_VRM_TEXTURE_PAINT_ARTIFACT_MIME,
      byteLength: png.size,
      width: 2,
      height: 1,
    },
  };
}

function dependencies(
  overrides: Partial<StudioVrmTexturePaintPersistenceDependencies> = {},
): StudioVrmTexturePaintPersistenceDependencies {
  const stored = artifact();
  return {
    encodePng: vi.fn(async () => stored.archiveEntry.data),
    createArtifact: vi.fn(async () => stored),
    saveArtifact: vi.fn(async () => ({
      receipt: stored.metadata,
      deduplicated: false,
      creationReceipt: null,
      mutationGeneration: null,
    })),
    getArtifact: vi.fn(async () => stored),
    decodeArtifact: vi.fn(async () => ({
      width: 2,
      height: 1,
      data: new Uint8ClampedArray(8),
    })),
    ...overrides,
  };
}

describe("studio VRM texture-paint persistence", () => {
  it("encodes each changed target once while preserving every material binding", async () => {
    const deps = dependencies();
    const runtime = {
      exportPaintedTargets: vi.fn(() => ({
        ok: true as const,
        value: [{
          id: "target-1",
          width: 2,
          height: 1,
          pixels: new Uint8ClampedArray(8),
          bindings: [
            {
              bindingKey: "gltf-material-2-baseColor",
              materialLocator: "gltf-material:2",
              textureSlot: "baseColor" as const,
            },
            {
              bindingKey: "gltf-material-8-baseColor",
              materialLocator: "gltf-material:8",
              textureSlot: "baseColor" as const,
            },
          ],
        }],
      })),
    };

    const result = await persistStudioVrmTexturePaintRuntime(runtime, {
      dependencies: deps,
    });

    expect(deps.encodePng).toHaveBeenCalledOnce();
    expect(deps.createArtifact).toHaveBeenCalledOnce();
    expect(deps.saveArtifact).toHaveBeenCalledOnce();
    expect(result.textures).toEqual([
      expect.objectContaining({
        bindingKey: "gltf-material-2-baseColor",
        materialLocator: "gltf-material:2",
        hash,
      }),
      expect.objectContaining({
        bindingKey: "gltf-material-8-baseColor",
        materialLocator: "gltf-material:8",
        hash,
      }),
    ]);
    expect(Object.isFrozen(result.textures)).toBe(true);
  });

  it("rejects 129 bindings before encoding or publishing any artifact", async () => {
    const deps = dependencies();
    const runtime = {
      exportPaintedTargets: vi.fn(() => ({
        ok: true as const,
        value: [{
          id: "target-overflow",
          width: 1,
          height: 1,
          pixels: new Uint8ClampedArray(4),
          bindings: Array.from(
            { length: STUDIO_VRM_SURFACE_PAINT_MAX_TEXTURES + 1 },
            (_, index) => ({
              bindingKey: `binding-${index}`,
              materialLocator: `gltf-material:${index}`,
              textureSlot: "baseColor" as const,
            }),
          ),
        }],
      })),
    };

    await expect(persistStudioVrmTexturePaintRuntime(runtime, {
      dependencies: deps,
    })).rejects.toMatchObject({ code: "budget-exceeded" });
    expect(deps.encodePng).not.toHaveBeenCalled();
    expect(deps.createArtifact).not.toHaveBeenCalled();
    expect(deps.saveArtifact).not.toHaveBeenCalled();
  });

  it("loads and decodes a shared hash once before rehydrating all bindings", async () => {
    const deps = dependencies();
    const rehydrateTarget = vi.fn(async () => ({ ok: true as const, value: {} as never }));

    const result = await rehydrateStudioVrmTexturePaintRuntime(
      { rehydrateTarget },
      {
        version: 1,
        textures: [
          {
            bindingKey: "face",
            materialLocator: "gltf-material:2",
            textureSlot: "baseColor",
            hash,
            mime: "image/png",
            byteSize: 64,
            width: 2,
            height: 1,
          },
          {
            bindingKey: "coat",
            materialLocator: "gltf-material:8",
            textureSlot: "baseColor",
            hash,
            mime: "image/png",
            byteSize: 64,
            width: 2,
            height: 1,
          },
        ],
      },
      { dependencies: deps },
    );

    expect(deps.getArtifact).toHaveBeenCalledOnce();
    expect(deps.decodeArtifact).toHaveBeenCalledOnce();
    expect(rehydrateTarget).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ artifactCount: 1, bindingCount: 2 });
  });

  it("fetches and decodes every unique artifact before the first runtime mutation", async () => {
    const settings = {
      version: 1 as const,
      textures: [
        {
          bindingKey: "face",
          materialLocator: "gltf-material:2",
          textureSlot: "baseColor" as const,
          hash,
          mime: "image/png" as const,
          byteSize: 64,
          width: 2,
          height: 1,
        },
        {
          bindingKey: "coat",
          materialLocator: "gltf-material:8",
          textureSlot: "baseColor" as const,
          hash: secondHash,
          mime: "image/png" as const,
          byteSize: 64,
          width: 2,
          height: 1,
        },
      ],
    };
    const first = artifact("face", hash);
    const second = artifact("coat", secondHash);

    const fetchRuntime = { rehydrateTarget: vi.fn() };
    const fetchDependencies = dependencies({
      getArtifact: vi.fn(async (contentHash) => {
        if (contentHash === secondHash) throw new Error("missing second artifact");
        return first;
      }),
    });
    await expect(rehydrateStudioVrmTexturePaintRuntime(
      fetchRuntime,
      settings,
      { dependencies: fetchDependencies },
    )).rejects.toThrow("missing second artifact");
    expect(fetchDependencies.decodeArtifact).toHaveBeenCalledOnce();
    expect(fetchRuntime.rehydrateTarget).not.toHaveBeenCalled();

    const decodeRuntime = { rehydrateTarget: vi.fn() };
    const decodeDependencies = dependencies({
      getArtifact: vi.fn(async (contentHash) =>
        contentHash === secondHash ? second : first
      ),
      decodeArtifact: vi.fn(async (metadata) => {
        if (metadata.contentHash === secondHash) throw new Error("decode failed");
        return { width: 2, height: 1, data: new Uint8ClampedArray(8) };
      }),
    });
    await expect(rehydrateStudioVrmTexturePaintRuntime(
      decodeRuntime,
      settings,
      { dependencies: decodeDependencies },
    )).rejects.toThrow("decode failed");
    expect(decodeDependencies.getArtifact).toHaveBeenCalledTimes(2);
    expect(decodeRuntime.rehydrateTarget).not.toHaveBeenCalled();
  });

  it("keeps runtime unchanged when cancellation arrives during the prepare phase", async () => {
    const controller = new AbortController();
    const runtime = { rehydrateTarget: vi.fn() };
    const deps = dependencies({
      decodeArtifact: vi.fn(async () => {
        controller.abort("cancel during decode");
        return { width: 2, height: 1, data: new Uint8ClampedArray(8) };
      }),
    });

    await expect(rehydrateStudioVrmTexturePaintRuntime(
      runtime,
      {
        version: 1,
        textures: [{
          bindingKey: "face",
          materialLocator: "gltf-material:2",
          textureSlot: "baseColor",
          hash,
          mime: "image/png",
          byteSize: 64,
          width: 2,
          height: 1,
        }],
      },
      { signal: controller.signal, dependencies: deps },
    )).rejects.toMatchObject({ name: "AbortError", code: "aborted" });
    expect(runtime.rehydrateTarget).not.toHaveBeenCalled();
  });

  it("preflights idempotent bindings and best-effort rolls back a later apply failure", async () => {
    const preparedPixels = new Uint8ClampedArray(8);
    const idempotentRehydrate = vi.fn();
    const idempotent = await rehydrateStudioVrmTexturePaintRuntime(
      {
        rehydrateTarget: idempotentRehydrate,
        exportPaintedTargets: () => ({
          ok: true as const,
          value: [{
            id: "existing",
            width: 2,
            height: 1,
            pixels: preparedPixels.slice(),
            bindings: [{
              bindingKey: "face",
              materialLocator: "gltf-material:2",
              textureSlot: "baseColor" as const,
            }],
          }],
        }),
      },
      {
        version: 1,
        textures: [{
          bindingKey: "face",
          materialLocator: "gltf-material:2",
          textureSlot: "baseColor",
          hash,
          mime: "image/png",
          byteSize: 64,
          width: 2,
          height: 1,
        }],
      },
      {
        dependencies: dependencies({
          decodeArtifact: vi.fn(async () => ({
            width: 2,
            height: 1,
            data: preparedPixels,
          })),
        }),
      },
    );
    expect(idempotent).toEqual({ artifactCount: 1, bindingCount: 1 });
    expect(idempotentRehydrate).not.toHaveBeenCalled();

    const resetActiveTarget = vi.fn(() => ({ ok: true as const, value: true }));
    const rehydrateTarget = vi.fn(async (
      input: { binding: { materialLocator: string } },
    ) => input.binding.materialLocator === "gltf-material:8"
      ? {
          ok: false as const,
          error: { code: "binding-missing" as const, message: "missing" },
        }
      : { ok: true as const, value: {} as never });
    await expect(rehydrateStudioVrmTexturePaintRuntime(
      {
        rehydrateTarget,
        resetActiveTarget,
        exportPaintedTargets: () => ({ ok: true as const, value: [] }),
      },
      {
        version: 1,
        textures: [
          {
            bindingKey: "face",
            materialLocator: "gltf-material:2",
            textureSlot: "baseColor",
            hash,
            mime: "image/png",
            byteSize: 64,
            width: 2,
            height: 1,
          },
          {
            bindingKey: "coat",
            materialLocator: "gltf-material:8",
            textureSlot: "baseColor",
            hash: secondHash,
            mime: "image/png",
            byteSize: 64,
            width: 2,
            height: 1,
          },
        ],
      },
      {
        dependencies: dependencies({
          getArtifact: vi.fn(async (contentHash) =>
            artifact(
              contentHash === secondHash ? "coat" : "face",
              contentHash as StudioVrmTexturePaintArtifactHash,
            )
          ),
        }),
      },
    )).rejects.toMatchObject({ code: "restore-failed" });
    expect(rehydrateTarget.mock.calls.map(([input]) => input.binding.materialLocator)).toEqual([
      "gltf-material:2",
      "gltf-material:8",
      "gltf-material:2",
    ]);
    expect(resetActiveTarget).toHaveBeenCalledOnce();
  });

  it("fails closed for runtime export and restore errors", async () => {
    await expect(persistStudioVrmTexturePaintRuntime({
      exportPaintedTargets: () => ({
        ok: false,
        error: { code: "pointer-active", message: "active" },
      }),
    })).rejects.toMatchObject({ code: "runtime-export-failed" });

    const deps = dependencies();
    await expect(rehydrateStudioVrmTexturePaintRuntime(
      {
        rehydrateTarget: vi.fn(async () => ({
          ok: false as const,
          error: { code: "binding-missing" as const, message: "missing" },
        })),
      },
      {
        version: 1,
        textures: [{
          bindingKey: "face",
          materialLocator: "gltf-material:2",
          textureSlot: "baseColor",
          hash,
          mime: "image/png",
          byteSize: 64,
          width: 2,
          height: 1,
        }],
      },
      { dependencies: deps },
    )).rejects.toMatchObject({ code: "restore-failed" });
  });

  it("honors an already-aborted operation before touching runtime or storage", async () => {
    const controller = new AbortController();
    controller.abort("cancel");
    const exportPaintedTargets = vi.fn();

    await expect(persistStudioVrmTexturePaintRuntime(
      { exportPaintedTargets },
      { signal: controller.signal },
    )).rejects.toMatchObject({ name: "AbortError", code: "aborted" });
    expect(exportPaintedTargets).not.toHaveBeenCalled();
  });
});
