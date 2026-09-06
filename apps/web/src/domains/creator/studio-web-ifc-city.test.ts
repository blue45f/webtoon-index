import { afterEach, describe, expect, it, vi } from "vitest";

import {
  importStudioIfcCity,
  installStudioWebIfcRuntimeForTests,
  resetStudioWebIfcForTests,
} from "./studio-web-ifc-city";

type StreamMesh = {
  readonly geometries: {
    size(): number;
    get(index: number): unknown;
    delete(): void;
  };
};

function createApi(stream: (callback: (mesh: StreamMesh) => void) => void) {
  return {
    OpenModel: vi.fn(() => 7),
    CloseModel: vi.fn(),
    Dispose: vi.fn(),
    StreamAllMeshes: vi.fn((_modelId: number, callback: (mesh: StreamMesh) => void) => {
      stream(callback);
    }),
    GetGeometry: vi.fn(),
    GetVertexArray: vi.fn(),
    GetIndexArray: vi.fn(),
    GetLineIDsWithType: vi.fn(() => ({ size: () => 0, delete: vi.fn() })),
  };
}

afterEach(() => {
  resetStudioWebIfcForTests();
});

describe("web-ifc body-geometry authority", () => {
  it("fails closed when StreamAllMeshes emits only an empty callback envelope", async () => {
    const geometries = { size: () => 0, get: vi.fn(), delete: vi.fn() };
    const api = createApi((callback) => callback({ geometries }));
    installStudioWebIfcRuntimeForTests(api);

    const result = await importStudioIfcCity("ISO-10303-21;DATA;ENDSEC;");

    expect(result).toEqual({
      ok: false,
      code: "no-body-geometry",
      detail: "web-ifc StreamAllMeshes produced no triangles",
    });
    expect(api.CloseModel).toHaveBeenCalledWith(7);
    expect(geometries.delete).toHaveBeenCalledOnce();
  });

  it("rejects decoded placements that contain no complete triangle", async () => {
    const placedDelete = vi.fn();
    const geometryDelete = vi.fn();
    const placed = { geometryExpressID: 12, delete: placedDelete };
    const geometries = { size: () => 1, get: vi.fn(() => placed), delete: vi.fn() };
    const api = createApi((callback) => callback({ geometries }));
    api.GetGeometry.mockReturnValue({
      GetVertexData: () => 1,
      GetVertexDataSize: () => 6,
      GetIndexData: () => 2,
      GetIndexDataSize: () => 2,
      delete: geometryDelete,
    });
    api.GetVertexArray.mockReturnValue(new Float32Array([0, 0, 0, 1, 0, 0]));
    api.GetIndexArray.mockReturnValue(new Uint32Array([0, 1]));
    installStudioWebIfcRuntimeForTests(api);

    const result = await importStudioIfcCity(new Uint8Array([1, 2, 3]));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("invalid IFC geometry must not be accepted");
    expect(result.code).toBe("no-body-geometry");
    expect(api.CloseModel).toHaveBeenCalledWith(7);
    expect(placedDelete).toHaveBeenCalledOnce();
    expect(geometryDelete).toHaveBeenCalledOnce();
    expect(geometries.delete).toHaveBeenCalledOnce();
  });
});
