import { describe, expect, it, vi } from "vitest";

import {
  captureStudioBg3dBabylonNormals,
  STUDIO_BG3D_BABYLON_NORMAL_CAPTURE_MAX_PIXELS,
  StudioBg3dBabylonNormalCaptureError,
  type StudioBg3dBabylonNormalCaptureInput,
  type StudioBg3dBabylonNormalPass,
  type StudioBg3dBabylonNormalPassReadback,
} from "./studio-bg3d-babylon-normal-capture";

import type { Scene } from "@babylonjs/core/scene";

function input(
  overrides: Partial<StudioBg3dBabylonNormalCaptureInput> = {},
): StudioBg3dBabylonNormalCaptureInput {
  return {
    backend: "webgl2",
    depth: new Float32Array([0, 1]),
    height: 2,
    meshes: [],
    scene: {} as Scene,
    signal: new AbortController().signal,
    width: 1,
    ...overrides,
  };
}

function pass(
  data: Float32Array | Uint8Array,
  unsigned = false,
): {
  readonly dispose: ReturnType<typeof vi.fn<() => void>>;
  readonly renderAndRead: ReturnType<
    typeof vi.fn<
      (signal: AbortSignal) => Promise<StudioBg3dBabylonNormalPassReadback>
    >
  >;
} {
  return {
    dispose: vi.fn<() => void>(),
    renderAndRead: vi.fn<
      (signal: AbortSignal) => Promise<StudioBg3dBabylonNormalPassReadback>
    >().mockResolvedValue({ data, unsigned }),
  };
}

function expectCode(
  operation: Promise<unknown>,
  code: StudioBg3dBabylonNormalCaptureError["code"],
): Promise<void> {
  return operation.then(
    () => {
      throw new Error("Expected normal capture to reject");
    },
    (error: unknown) => {
      expect(error).toBeInstanceOf(StudioBg3dBabylonNormalCaptureError);
      expect((error as StudioBg3dBabylonNormalCaptureError).code).toBe(code);
    },
  );
}

describe("captureStudioBg3dBabylonNormals", () => {
  it("flips WebGL rows and masks far-depth background before octahedral packing", async () => {
    const normalPass = pass(new Float32Array([
      // Bottom source row: +X. Canonical depth marks this target row as background.
      1, 0, 0, 1,
      // Top source row: +Y.
      0, 1, 0, 1,
    ]));

    const result = await captureStudioBg3dBabylonNormals(input(), {
      createPass: () => normalPass,
    });

    expect([...result]).toEqual([
      128, 255,
      128, 128,
    ]);
    expect(normalPass.renderAndRead).toHaveBeenCalledOnce();
    expect(normalPass.dispose).toHaveBeenCalledOnce();
  });

  it("keeps WebGPU rows top-down and accepts unsigned attachment values", async () => {
    const normalPass = pass(
      new Float32Array([
        1, 0.5, 0.5, 1,
        0.5, 1, 0.5, 1,
      ]),
      true,
    );

    const result = await captureStudioBg3dBabylonNormals(
      input({
        backend: "webgpu",
        depth: new Float32Array([0, 0]),
      }),
      { createPass: () => normalPass },
    );

    expect([...result]).toEqual([
      255, 128,
      128, 255,
    ]);
    expect(normalPass.dispose).toHaveBeenCalledOnce();
  });

  it("fails readback closed for a non-canonical attachment buffer and still disposes", async () => {
    const normalPass = {
      dispose: vi.fn(),
      renderAndRead: vi.fn().mockResolvedValue({
        data: new Uint16Array(8),
        unsigned: false,
      }),
    } as unknown as StudioBg3dBabylonNormalPass;

    await expectCode(
      captureStudioBg3dBabylonNormals(input(), {
        createPass: () => normalPass,
      }),
      "readback",
    );
    expect(normalPass.dispose).toHaveBeenCalledOnce();
  });

  it("aborts an in-flight read and releases the temporary pass", async () => {
    const controller = new AbortController();
    const normalPass = {
      dispose: vi.fn<() => void>(),
      renderAndRead: vi.fn<
        (signal: AbortSignal) => Promise<StudioBg3dBabylonNormalPassReadback>
      >(() => new Promise(() => undefined)),
    };
    const operation = captureStudioBg3dBabylonNormals(
      input({ signal: controller.signal }),
      { createPass: () => normalPass },
    );

    controller.abort();

    await expectCode(operation, "aborted");
    expect(normalPass.dispose).toHaveBeenCalledOnce();
  });

  it("does not allocate a pass when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const createPass = vi.fn();

    await expectCode(
      captureStudioBg3dBabylonNormals(
        input({ signal: controller.signal }),
        { createPass },
      ),
      "aborted",
    );
    expect(createPass).not.toHaveBeenCalled();
  });

  it.each([
    {
      expectedCode: "unsupported" as const,
      name: "oversized dimensions",
      overrides: {
        depth: new Float32Array(1),
        height: 1,
        width: STUDIO_BG3D_BABYLON_NORMAL_CAPTURE_MAX_PIXELS + 1,
      },
    },
    {
      expectedCode: "readback" as const,
      name: "wrong depth length",
      overrides: {
        depth: new Float32Array(1),
      },
    },
    {
      expectedCode: "readback" as const,
      name: "non-finite depth",
      overrides: {
        depth: new Float32Array([Number.NaN, 1]),
      },
    },
  ])(
    "rejects $name before allocating GPU state",
    async ({ expectedCode, overrides }) => {
      const createPass = vi.fn();

      await expectCode(
        captureStudioBg3dBabylonNormals(input(overrides), { createPass }),
        expectedCode,
      );
      expect(createPass).not.toHaveBeenCalled();
    },
  );

  it("maps setup and disposal faults to the small typed error surface", async () => {
    await expectCode(
      captureStudioBg3dBabylonNormals(input(), {
        createPass: () => {
          throw new Error("unsupported renderer");
        },
      }),
      "unsupported",
    );

    const normalPass = pass(new Float32Array([
      0, 1, 0, 1,
      1, 0, 0, 1,
    ]));
    normalPass.dispose.mockImplementation(() => {
      throw new Error("dispose failed");
    });
    await expectCode(
      captureStudioBg3dBabylonNormals(input(), {
        createPass: () => normalPass,
      }),
      "readback",
    );
  });
});
