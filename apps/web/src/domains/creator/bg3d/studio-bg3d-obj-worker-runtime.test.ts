import { describe, expect, it } from "vitest";

import {
  STUDIO_BG3D_OBJ_WORKER_BUDGETS,
  STUDIO_BG3D_OBJ_WORKER_PROTOCOL_VERSION,
  isStudioBg3dObjWorkerResponseForRequest,
  type StudioBg3dObjWorkerMtlEntry,
  type StudioBg3dObjWorkerParseRequest,
} from "./studio-bg3d-obj-worker-protocol";
import {
  StudioBg3dObjWorkerRuntimeError,
  parseStudioBg3dObjWorkerRequest,
} from "./studio-bg3d-obj-worker-runtime";

const encoder = new TextEncoder();

function utf8(value: string): ArrayBuffer {
  return encoder.encode(value).buffer;
}

function requestFor(
  primaryPath: string,
  obj: string,
  materials: readonly { readonly path: string; readonly text: string }[] = [],
  texturePaths: readonly string[] = [],
): StudioBg3dObjWorkerParseRequest {
  const bytes = utf8(obj);
  const materialLibraries: StudioBg3dObjWorkerMtlEntry[] = materials
    .map(({ path, text }) => {
      const materialBytes = utf8(text);
      return { path, sourceByteLength: materialBytes.byteLength, bytes: materialBytes };
    })
    .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  const resourcePaths = [
    primaryPath,
    ...materialLibraries.map(({ path }) => path),
    ...texturePaths,
  ].sort();
  return {
    version: STUDIO_BG3D_OBJ_WORKER_PROTOCOL_VERSION,
    kind: "parse",
    requestId: 1,
    generationId: 1,
    primaryPath,
    sourceByteLength: bytes.byteLength,
    bytes,
    materialLibraries,
    resourcePaths,
    budgets: STUDIO_BG3D_OBJ_WORKER_BUDGETS,
  };
}

function triangleObj(extra: readonly string[] = []): string {
  return [
    ...extra,
    "o triangle",
    "v 0 0 0",
    "v 1 0 0",
    "v 0 1 0",
    "f 1 2 3",
  ].join("\n");
}

describe("Studio OBJ Worker runtime", () => {
  it("parses a plain OBJ into a protocol-valid clone-safe scene IR", async () => {
    const request = requestFor("triangle.obj", triangleObj());
    const result = await parseStudioBg3dObjWorkerRequest(request);

    expect(result).toMatchObject({
      primaryPath: "triangle.obj",
      metrics: {
        nodes: 2,
        meshes: 1,
        vertices: 3,
        triangles: 1,
        materials: 1,
        materialSlots: 1,
        usedResources: 1,
      },
    });
    expect(result.renderables[0]).toMatchObject({
      kind: "mesh",
      name: "triangle",
      vertexCount: 3,
      groups: [{ start: 0, count: 3, materialIndex: 0 }],
    });
    expect(result.materials[0]).toMatchObject({ name: "default", synthesized: true });
    expect(isStudioBg3dObjWorkerResponseForRequest({
      version: STUDIO_BG3D_OBJ_WORKER_PROTOCOL_VERSION,
      kind: "result",
      requestId: 1,
      generationId: 1,
      result,
    }, request)).toBe(true);
  });

  it("keeps Unicode-separated face references inside the canonical parser budget", async () => {
    const request = requestFor(
      "unicode-whitespace.obj",
      triangleObj().replace("f 1 2 3", "f 1\u00a02\u202f3"),
    );
    const result = await parseStudioBg3dObjWorkerRequest(request);

    expect(result.metrics).toMatchObject({ vertices: 3, triangles: 1 });
  });

  it("resolves texture paths relative to their MTL and preserves bounded map options", async () => {
    const request = requestFor(
      "pkg/models/triangle.obj",
      triangleObj(["mtllib ../materials/triangle.mtl", "usemtl webtoon-red"]),
      [{
        path: "pkg/materials/triangle.mtl",
        text: [
          "newmtl webtoon-red",
          "Ka 0.1 0.2 0.3",
          "Kd 1 0 0",
          "Ks 0.4 0.5 0.6",
          "Ke 0.01 0.02 0.03",
          "Ns 120",
          "d 0.75",
          "map_Kd -s 2 3 1 -o 0.25 0.5 0 ../textures/checker.png",
        ].join("\n"),
      }],
      ["pkg/textures/checker.png"],
    );

    const result = await parseStudioBg3dObjWorkerRequest(request);

    expect(result.materials).toEqual([expect.objectContaining({
      name: "webtoon-red",
      sourceMtlPath: "pkg/materials/triangle.mtl",
      synthesized: false,
      ambient: [0.1, 0.2, 0.3],
      diffuse: [1, 0, 0],
      specular: [0.4, 0.5, 0.6],
      emissive: [0.01, 0.02, 0.03],
      shininess: 120,
      opacity: 0.75,
      textures: [expect.objectContaining({
        slot: "base-color",
        resourcePath: "pkg/textures/checker.png",
        repeat: [2, 3],
        offset: [0.25, 0.5],
      })],
    })]);
    expect(result.usedResourcePaths).toEqual([
      "pkg/materials/triangle.mtl",
      "pkg/models/triangle.obj",
      "pkg/textures/checker.png",
    ]);
  });

  it("preserves quad fan expansion plus line and point topology", async () => {
    const request = requestFor("mixed.obj", [
      "o quad",
      "v 0 0 0",
      "v 1 0 0",
      "v 1 1 0",
      "v 0 1 0",
      "f 1 2 3 4",
      "o segment",
      "l 1 2",
      "o marker",
      "p 3",
    ].join("\n"));

    const result = await parseStudioBg3dObjWorkerRequest(request);

    expect(result.renderables.map(({ kind, vertexCount }) => [kind, vertexCount])).toEqual([
      ["mesh", 6],
      ["line-segments", 2],
      ["points", 1],
    ]);
    expect(result.metrics).toMatchObject({ vertices: 9, triangles: 2, meshes: 3 });
  });

  it("fails closed instead of guessing a unique basename outside the MTL directory", async () => {
    const request = requestFor(
      "pkg/models/triangle.obj",
      triangleObj(["mtllib ../materials/triangle.mtl", "usemtl textured"]),
      [{
        path: "pkg/materials/triangle.mtl",
        text: "newmtl textured\nmap_Kd checker.png",
      }],
      ["pkg/unrelated/checker.png"],
    );

    await expect(parseStudioBg3dObjWorkerRequest(request)).rejects.toMatchObject({
      code: "missing-resource",
    });
  });

  it.each([
    ["network texture", "map_Kd https://example.com/checker.png", "unsafe-resource-uri"],
    ["encoded traversal separator", "map_Kd ..%2ftextures/checker.png", "unsafe-resource-uri"],
  ])("rejects %s before OBJ geometry allocation", async (_name, textureLine, code) => {
    const request = requestFor(
      "pkg/models/triangle.obj",
      triangleObj(["mtllib ../materials/triangle.mtl", "usemtl textured"]),
      [{
        path: "pkg/materials/triangle.mtl",
        text: `newmtl textured\n${textureLine}`,
      }],
      ["pkg/textures/checker.png"],
    );

    await expect(parseStudioBg3dObjWorkerRequest(request)).rejects.toMatchObject({ code });
  });

  it("rejects duplicate material ownership across selected MTL libraries", async () => {
    const request = requestFor(
      "pkg/model.obj",
      triangleObj(["mtllib first.mtl", "mtllib second.mtl", "usemtl duplicate"]),
      [
        { path: "pkg/first.mtl", text: "newmtl duplicate\nKd 1 0 0" },
        { path: "pkg/second.mtl", text: "newmtl duplicate\nKd 0 1 0" },
      ],
    );

    await expect(parseStudioBg3dObjWorkerRequest(request)).rejects.toBeInstanceOf(
      StudioBg3dObjWorkerRuntimeError,
    );
    await expect(parseStudioBg3dObjWorkerRequest(request)).rejects.toMatchObject({
      code: "material-budget-exceeded",
    });
  });
});
