import { describe, expect, it, vi } from "vitest";

import {
  captureStudioBg3dBabylonStableIds,
  getStudioBg3dBabylonStableIdReadbackAllocationByteLength,
  STUDIO_BG3D_BABYLON_STABLE_ID_CAPTURE_MAX_PIXELS,
  StudioBg3dBabylonStableIdCaptureError,
  validateStudioBg3dBabylonStableIdReadback,
  type StudioBg3dBabylonStableIdCaptureInput,
  type StudioBg3dBabylonStableIdPass,
} from "./studio-bg3d-babylon-stable-id-capture";

import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Scene } from "@babylonjs/core/scene";

function fakeMesh(
  scene: Scene,
  disposed = false,
): AbstractMesh {
  return {
    getScene: () => scene,
    isDisposed: () => disposed,
  } as unknown as AbstractMesh;
}

function input(
  overrides: Partial<StudioBg3dBabylonStableIdCaptureInput> = {},
): StudioBg3dBabylonStableIdCaptureInput {
  const scene = overrides.scene ?? ({} as Scene);
  return {
    backend: "webgl2",
    height: 2,
    renderables: [
      {
        descriptor: { stableId: "node:a", label: "A" },
        mesh: fakeMesh(scene),
      },
      {
        descriptor: { stableId: "node:b", label: "B" },
        mesh: fakeMesh(scene),
      },
    ],
    scene,
    signal: new AbortController().signal,
    width: 1,
    ...overrides,
  };
}

function pass(data: Uint8Array): {
  readonly dispose: ReturnType<typeof vi.fn<() => void>>;
  readonly renderAndRead: ReturnType<
    typeof vi.fn<(signal: AbortSignal) => Promise<Uint8Array>>
  >;
} {
  return {
    dispose: vi.fn<() => void>(),
    renderAndRead: vi.fn<
      (signal: AbortSignal) => Promise<Uint8Array>
    >().mockResolvedValue(data),
  };
}

function expectCode(
  operation: Promise<unknown>,
  code: StudioBg3dBabylonStableIdCaptureError["code"],
): Promise<void> {
  return operation.then(
    () => {
      throw new Error("Expected stable-ID capture to reject");
    },
    (error: unknown) => {
      expect(error).toBeInstanceOf(StudioBg3dBabylonStableIdCaptureError);
      expect((error as StudioBg3dBabylonStableIdCaptureError).code).toBe(code);
    },
  );
}

describe("validateStudioBg3dBabylonStableIdReadback", () => {
  it("accepts WebGL identity and WebGPU full-range aliases", () => {
    const destination = new Uint8Array(8);
    const webGpuReadDestination = new Uint8Array(12);
    webGpuReadDestination.set([1, 2, 3, 4, 5, 6, 7, 8]);
    const webGpuAlias = new Uint8Array(webGpuReadDestination.buffer, 0, 8);

    expect(
      validateStudioBg3dBabylonStableIdReadback(
        destination,
        destination,
        destination,
      ),
    ).toBe(destination);
    expect(
      validateStudioBg3dBabylonStableIdReadback(
        webGpuAlias,
        webGpuReadDestination,
        destination,
      ),
    ).toBe(destination);
    expect(destination).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
  });

  it.each([
    {
      name: "non-zero-offset subarray",
      create: (readDestination: Uint8Array, destination: Uint8Array) =>
        new Uint8Array(
          readDestination.buffer,
          1,
          destination.byteLength,
        ),
    },
    {
      name: "short compact view",
      create: (readDestination: Uint8Array, destination: Uint8Array) =>
        new Uint8Array(
          readDestination.buffer,
          0,
          destination.byteLength - 1,
        ),
    },
    {
      name: "different backing buffer",
      create: (_readDestination: Uint8Array, destination: Uint8Array) =>
        new Uint8Array(destination.byteLength),
    },
    {
      name: "typed-array subclass",
      create: (readDestination: Uint8Array, destination: Uint8Array) => {
        class DerivedUint8Array extends Uint8Array {}
        return new DerivedUint8Array(
          readDestination.buffer as ArrayBuffer,
          0,
          destination.byteLength,
        );
      },
    },
  ])("rejects a $name", ({ create }) => {
    const destination = new Uint8Array(8);
    const readDestination = new Uint8Array(16);

    expect(() =>
      validateStudioBg3dBabylonStableIdReadback(
        create(readDestination, destination),
        readDestination,
        destination,
      )
    ).toThrowError(
      expect.objectContaining({
        code: "readback",
      }),
    );
  });

  it("allocates complete WebGPU rows before Babylon compacts the result", () => {
    expect(
      getStudioBg3dBabylonStableIdReadbackAllocationByteLength(
        63,
        2,
        "webgpu",
      ),
    ).toBe(512);
    expect(
      getStudioBg3dBabylonStableIdReadbackAllocationByteLength(
        64,
        2,
        "webgpu",
      ),
    ).toBe(512);
    expect(
      getStudioBg3dBabylonStableIdReadbackAllocationByteLength(
        65,
        2,
        "webgpu",
      ),
    ).toBe(1_024);
    expect(
      getStudioBg3dBabylonStableIdReadbackAllocationByteLength(
        65,
        2,
        "webgl2",
      ),
    ).toBe(520);
  });
});

describe("captureStudioBg3dBabylonStableIds", () => {
  it("flips WebGL rows and returns the deterministic canonical legend", async () => {
    const stableIdPass = pass(new Uint8Array([
      // Bottom source row: B.
      2, 0, 0, 255,
      // Top source row: A.
      1, 0, 0, 255,
    ]));

    const result = await captureStudioBg3dBabylonStableIds(input(), {
      createPass: (_captureInput, plan) => {
        expect(plan.legend).toEqual([
          { id: 1, stableId: "node:a", label: "A" },
          { id: 2, stableId: "node:b", label: "B" },
        ]);
        return stableIdPass;
      },
    });

    expect(result.data).toEqual(new Uint32Array([1, 2]));
    expect(result.legend).toEqual([
      { id: 1, stableId: "node:a", label: "A" },
      { id: 2, stableId: "node:b", label: "B" },
    ]);
    expect(stableIdPass.renderAndRead).toHaveBeenCalledOnce();
    expect(stableIdPass.dispose).toHaveBeenCalledOnce();
  });

  it("flips WebGPU rows and deduplicates repeated descriptors", async () => {
    const scene = {} as Scene;
    const stableIdPass = pass(new Uint8Array([
      // Bottom source row: B.
      2, 0, 0, 255,
      // Top source row: A.
      1, 0, 0, 255,
    ]));

    const result = await captureStudioBg3dBabylonStableIds(
      input({
        backend: "webgpu",
        renderables: [
          {
            descriptor: { stableId: "node:a", label: "A" },
            mesh: fakeMesh(scene),
          },
          {
            descriptor: { stableId: "node:a", label: "A" },
            mesh: fakeMesh(scene),
          },
          {
            descriptor: { stableId: "node:b", label: "B" },
            mesh: fakeMesh(scene),
          },
        ],
        scene,
      }),
      {
        createPass: (_captureInput, plan) => {
          expect(plan.legend).toHaveLength(2);
          return stableIdPass;
        },
      },
    );

    expect(result.data).toEqual(new Uint32Array([1, 2]));
    expect(result.legend).toEqual([
      { id: 1, stableId: "node:a", label: "A" },
      { id: 2, stableId: "node:b", label: "B" },
    ]);
    expect(stableIdPass.dispose).toHaveBeenCalledOnce();
  });

  it("fails unknown and blended palette colors closed and still disposes", async () => {
    for (const data of [
      new Uint8Array([
        3, 0, 0, 255,
        1, 0, 0, 255,
      ]),
      new Uint8Array([
        1, 0, 0, 128,
        2, 0, 0, 255,
      ]),
    ]) {
      const stableIdPass = pass(data);
      await expectCode(
        captureStudioBg3dBabylonStableIds(input(), {
          createPass: () => stableIdPass,
        }),
        "readback",
      );
      expect(stableIdPass.dispose).toHaveBeenCalledOnce();
    }
  });

  it("rejects malformed or aliased readback and always releases the pass", async () => {
    const backing = new Uint8Array(12);
    backing.set([
      2, 0, 0, 255,
      1, 0, 0, 255,
    ], 2);
    const stableIdPass = pass(backing.subarray(2, 10));

    await expectCode(
      captureStudioBg3dBabylonStableIds(input(), {
        createPass: () => stableIdPass,
      }),
      "readback",
    );
    expect(stableIdPass.dispose).toHaveBeenCalledOnce();
  });

  it("aborts an in-flight read and releases the temporary pass", async () => {
    const controller = new AbortController();
    const stableIdPass = {
      dispose: vi.fn<() => void>(),
      renderAndRead: vi.fn<
        (signal: AbortSignal) => Promise<Uint8Array>
      >(() => new Promise(() => undefined)),
    };
    const operation = captureStudioBg3dBabylonStableIds(
      input({ signal: controller.signal }),
      { createPass: () => stableIdPass },
    );

    controller.abort();

    await expectCode(operation, "aborted");
    expect(stableIdPass.dispose).toHaveBeenCalledOnce();
  });

  it("does not allocate a pass when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const createPass = vi.fn();

    await expectCode(
      captureStudioBg3dBabylonStableIds(
        input({ signal: controller.signal }),
        { createPass },
      ),
      "aborted",
    );
    expect(createPass).not.toHaveBeenCalled();
  });

  it.each([
    {
      code: "readback" as const,
      name: "invalid dimensions",
      makeInput: () => input({ width: 0 }),
    },
    {
      code: "unsupported" as const,
      name: "oversized dimensions",
      makeInput: () => input({
        height: 1,
        width: STUDIO_BG3D_BABYLON_STABLE_ID_CAPTURE_MAX_PIXELS + 1,
      }),
    },
    {
      code: "readback" as const,
      name: "disposed mesh",
      makeInput: () => {
        const scene = {} as Scene;
        return input({
          height: 1,
          renderables: [{
            descriptor: { stableId: "node:a", label: "A" },
            mesh: fakeMesh(scene, true),
          }],
          scene,
        });
      },
    },
    {
      code: "readback" as const,
      name: "mesh from another scene",
      makeInput: () => {
        const scene = {} as Scene;
        return input({
          height: 1,
          renderables: [{
            descriptor: { stableId: "node:a", label: "A" },
            mesh: fakeMesh({} as Scene),
          }],
          scene,
        });
      },
    },
    {
      code: "unsupported" as const,
      name: "conflicting labels for one stable identity",
      makeInput: () => {
        const scene = {} as Scene;
        return input({
          renderables: [
            {
              descriptor: { stableId: "node:a", label: "A" },
              mesh: fakeMesh(scene),
            },
            {
              descriptor: { stableId: "node:a", label: "Different" },
              mesh: fakeMesh(scene),
            },
          ],
          scene,
        });
      },
    },
    {
      code: "unsupported" as const,
      name: "two identities assigned to one mesh",
      makeInput: () => {
        const scene = {} as Scene;
        const mesh = fakeMesh(scene);
        return input({
          renderables: [
            {
              descriptor: { stableId: "node:a", label: "A" },
              mesh,
            },
            {
              descriptor: { stableId: "node:b", label: "B" },
              mesh,
            },
          ],
          scene,
        });
      },
    },
  ])(
    "rejects $name before allocating GPU state",
    async ({ code, makeInput }) => {
      const createPass = vi.fn();

      await expectCode(
        captureStudioBg3dBabylonStableIds(makeInput(), { createPass }),
        code,
      );
      expect(createPass).not.toHaveBeenCalled();
    },
  );

  it("maps setup and disposal faults to the small typed error surface", async () => {
    await expectCode(
      captureStudioBg3dBabylonStableIds(input(), {
        createPass: () => {
          throw new Error("unsupported renderer");
        },
      }),
      "unsupported",
    );

    const stableIdPass = pass(new Uint8Array([
      2, 0, 0, 255,
      1, 0, 0, 255,
    ]));
    stableIdPass.dispose.mockImplementation(() => {
      throw new Error("dispose failed");
    });
    await expectCode(
      captureStudioBg3dBabylonStableIds(input(), {
        createPass: () => stableIdPass,
      }),
      "readback",
    );
  });

  it("rejects a malformed injected pass before readback", async () => {
    const malformed = {
      dispose: vi.fn(),
    } as unknown as StudioBg3dBabylonStableIdPass;

    await expectCode(
      captureStudioBg3dBabylonStableIds(input(), {
        createPass: () => malformed,
      }),
      "unsupported",
    );
    expect(malformed.dispose).not.toHaveBeenCalled();
  });
});
