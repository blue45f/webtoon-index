import { describe, expect, it } from "vitest";

import {
  STUDIO_BG3D_OBJ_WORKER_BUDGETS,
  STUDIO_BG3D_OBJ_WORKER_MAX_MATERIAL_LIBRARIES,
  STUDIO_BG3D_OBJ_WORKER_MAX_MATERIAL_SLOTS,
  STUDIO_BG3D_OBJ_WORKER_MAX_MATERIALS,
  STUDIO_BG3D_OBJ_WORKER_MAX_MESHES,
  STUDIO_BG3D_OBJ_WORKER_MAX_MTL_BYTES,
  STUDIO_BG3D_OBJ_WORKER_MAX_NODES,
  STUDIO_BG3D_OBJ_WORKER_MAX_OBJ_BYTES,
  STUDIO_BG3D_OBJ_WORKER_MAX_OUTPUT_BYTES,
  STUDIO_BG3D_OBJ_WORKER_MAX_RESOURCES,
  STUDIO_BG3D_OBJ_WORKER_MAX_TRIANGLES,
  STUDIO_BG3D_OBJ_WORKER_MAX_VERTICES,
  STUDIO_BG3D_OBJ_WORKER_PROTOCOL_VERSION,
  isCanonicalStudioBg3dObjResourcePath,
  isStudioBg3dObjWorkerRequest,
  isStudioBg3dObjWorkerResponse,
  isStudioBg3dObjWorkerResponseForRequest,
  studioBg3dObjWorkerRequestTransfers,
  studioBg3dObjWorkerResponseTransfers,
  type StudioBg3dObjWorkerParseRequest,
  type StudioBg3dObjWorkerResultResponse,
} from "./studio-bg3d-obj-worker-protocol";

const PRIMARY_PATH = "models/character.obj";
const MTL_PATH = "models/materials/character.mtl";
const TEXTURE_PATH = "models/textures/albedo.png";
const RESOURCE_PATHS = [PRIMARY_PATH, MTL_PATH, TEXTURE_PATH] as const;

function bytes(...values: number[]): ArrayBuffer {
  return Uint8Array.from(values).buffer;
}

function floats(...values: number[]): ArrayBuffer {
  return Float32Array.from(values).buffer;
}

function validRequest(): StudioBg3dObjWorkerParseRequest {
  const source = bytes(0x76, 0x20, 0x30, 0x0a);
  const material = bytes(0x6e, 0x65, 0x77, 0x6d, 0x74, 0x6c);
  return {
    version: STUDIO_BG3D_OBJ_WORKER_PROTOCOL_VERSION,
    kind: "parse",
    requestId: 7,
    generationId: 11,
    primaryPath: PRIMARY_PATH,
    sourceByteLength: source.byteLength,
    bytes: source,
    materialLibraries: [{
      path: MTL_PATH,
      sourceByteLength: material.byteLength,
      bytes: material,
    }],
    resourcePaths: [...RESOURCE_PATHS],
    budgets: { ...STUDIO_BG3D_OBJ_WORKER_BUDGETS },
  };
}

function validResultResponse(): StudioBg3dObjWorkerResultResponse {
  const position = floats(
    0, 0, 0,
    1, 0, 0,
    0, 1, 0,
  );
  const normal = floats(
    0, 0, 1,
    0, 0, 1,
    0, 0, 1,
  );
  const uv = floats(0, 0, 1, 0, 0, 1);
  return {
    version: STUDIO_BG3D_OBJ_WORKER_PROTOCOL_VERSION,
    kind: "result",
    requestId: 7,
    generationId: 11,
    result: {
      primaryPath: PRIMARY_PATH,
      nodes: [{ name: "triangle", parentIndex: null, renderableIndex: 0 }],
      renderables: [{
        kind: "mesh",
        name: "triangle",
        vertexCount: 3,
        attributes: [
          {
            name: "position",
            itemSize: 3,
            count: 3,
            normalized: false,
            arrayType: "float32",
            buffer: position,
          },
          {
            name: "normal",
            itemSize: 3,
            count: 3,
            normalized: false,
            arrayType: "float32",
            buffer: normal,
          },
          {
            name: "uv",
            itemSize: 2,
            count: 3,
            normalized: false,
            arrayType: "float32",
            buffer: uv,
          },
        ],
        groups: [{ start: 0, count: 3, materialIndex: 0 }],
        materialSlots: [{
          name: "webtoon-red",
          canonicalMaterialIndex: 0,
          flatShading: false,
          vertexColors: false,
        }],
      }],
      materials: [{
        name: "webtoon-red",
        sourceMtlPath: MTL_PATH,
        synthesized: false,
        ambient: [0, 0, 0],
        diffuse: [1, 0, 0],
        specular: [0.25, 0.25, 0.25],
        emissive: [0, 0, 0],
        shininess: 30,
        opacity: 1,
        textures: [{
          slot: "base-color",
          resourcePath: TEXTURE_PATH,
          offset: [0, 0],
          repeat: [1, 1],
          bumpScale: 1,
          displacementBias: 0,
          displacementScale: 1,
        }],
      }],
      usedResourcePaths: [...RESOURCE_PATHS],
      metrics: {
        nodes: 1,
        meshes: 1,
        vertices: 3,
        triangles: 1,
        outputBytes: position.byteLength + normal.byteLength + uv.byteLength,
        materials: 1,
        materialSlots: 1,
        usedResources: 3,
      },
    },
  };
}

describe("Studio OBJ Worker request protocol", () => {
  it("exposes the exact fixed safety budget", () => {
    expect(STUDIO_BG3D_OBJ_WORKER_BUDGETS).toEqual({
      maxObjBytes: STUDIO_BG3D_OBJ_WORKER_MAX_OBJ_BYTES,
      maxMtlBytes: STUDIO_BG3D_OBJ_WORKER_MAX_MTL_BYTES,
      maxMaterialLibraries: STUDIO_BG3D_OBJ_WORKER_MAX_MATERIAL_LIBRARIES,
      maxResources: STUDIO_BG3D_OBJ_WORKER_MAX_RESOURCES,
      maxOutputBytes: STUDIO_BG3D_OBJ_WORKER_MAX_OUTPUT_BYTES,
      maxVertices: STUDIO_BG3D_OBJ_WORKER_MAX_VERTICES,
      maxTriangles: STUDIO_BG3D_OBJ_WORKER_MAX_TRIANGLES,
      maxNodes: STUDIO_BG3D_OBJ_WORKER_MAX_NODES,
      maxMeshes: STUDIO_BG3D_OBJ_WORKER_MAX_MESHES,
      maxMaterialSlots: STUDIO_BG3D_OBJ_WORKER_MAX_MATERIAL_SLOTS,
      maxMaterials: STUDIO_BG3D_OBJ_WORKER_MAX_MATERIALS,
    });
    expect(Object.isFrozen(STUDIO_BG3D_OBJ_WORKER_BUDGETS)).toBe(true);
  });

  it("accepts one exact clone-safe request and emits every source buffer once", () => {
    const request = validRequest();

    expect(isStudioBg3dObjWorkerRequest(request)).toBe(true);
    expect(studioBg3dObjWorkerRequestTransfers(request)).toEqual([
      request.bytes,
      request.materialLibraries[0]?.bytes,
    ]);
    expect(new Set(studioBg3dObjWorkerRequestTransfers(request)).size).toBe(2);
  });

  it("requires canonical paths and deterministic resource ordering", () => {
    expect(isCanonicalStudioBg3dObjResourcePath("package/models/chair.obj")).toBe(true);
    for (const path of [
      "",
      "/absolute/chair.obj",
      "models\\chair.obj",
      "models/../chair.obj",
      "models//chair.obj",
      "https://example.com/chair.obj",
      "models/chair.obj?version=1",
      "models/chair.obj#mesh",
      "models/\u0000chair.obj",
    ]) {
      expect(isCanonicalStudioBg3dObjResourcePath(path), path).toBe(false);
    }

    const request = validRequest();
    expect(isStudioBg3dObjWorkerRequest({
      ...request,
      resourcePaths: [MTL_PATH, PRIMARY_PATH, TEXTURE_PATH],
    })).toBe(false);
    expect(isStudioBg3dObjWorkerRequest({
      ...request,
      resourcePaths: [PRIMARY_PATH, MTL_PATH, MTL_PATH, TEXTURE_PATH],
    })).toBe(false);
    expect(isStudioBg3dObjWorkerRequest({
      ...request,
      resourcePaths: [PRIMARY_PATH, TEXTURE_PATH],
    })).toBe(false);
    expect(isStudioBg3dObjWorkerRequest({
      ...request,
      resourcePaths: ["models/Character.obj", PRIMARY_PATH, MTL_PATH, TEXTURE_PATH].sort(),
    })).toBe(false);
  });

  it("rejects extra keys, altered budgets, length mismatches, and aliased transfer buffers", () => {
    const request = validRequest();
    expect(isStudioBg3dObjWorkerRequest({ ...request, extra: true })).toBe(false);
    expect(isStudioBg3dObjWorkerRequest({
      ...request,
      budgets: { ...request.budgets, extra: 1 },
    })).toBe(false);
    expect(isStudioBg3dObjWorkerRequest({
      ...request,
      budgets: { ...request.budgets, maxVertices: request.budgets.maxVertices - 1 },
    })).toBe(false);
    expect(isStudioBg3dObjWorkerRequest({
      ...request,
      sourceByteLength: request.sourceByteLength + 1,
    })).toBe(false);
    expect(isStudioBg3dObjWorkerRequest({
      ...request,
      materialLibraries: [{ ...request.materialLibraries[0], extra: true }],
    })).toBe(false);
    expect(isStudioBg3dObjWorkerRequest({
      ...request,
      materialLibraries: [{
        path: MTL_PATH,
        sourceByteLength: request.bytes.byteLength,
        bytes: request.bytes,
      }],
    })).toBe(false);
  });

  it("throws instead of returning an unsafe transfer list", () => {
    const request = { ...validRequest(), extra: true };
    expect(() => studioBg3dObjWorkerRequestTransfers(
      request as unknown as StudioBg3dObjWorkerParseRequest,
    )).toThrowError(TypeError);
  });
});

describe("Studio OBJ Worker response protocol", () => {
  it("accepts exact progress, controlled error, and canonical result envelopes", () => {
    const request = validRequest();
    const progress = {
      version: STUDIO_BG3D_OBJ_WORKER_PROTOCOL_VERSION,
      kind: "progress",
      requestId: 7,
      generationId: 11,
      stage: "parsing",
      progress: 0.5,
    } as const;
    const error = {
      version: STUDIO_BG3D_OBJ_WORKER_PROTOCOL_VERSION,
      kind: "error",
      requestId: 7,
      generationId: 11,
      code: "parse-failed",
    } as const;
    const result = validResultResponse();

    expect(isStudioBg3dObjWorkerResponse(progress)).toBe(true);
    expect(isStudioBg3dObjWorkerResponse(error)).toBe(true);
    expect(isStudioBg3dObjWorkerResponse(result)).toBe(true);
    expect(isStudioBg3dObjWorkerResponseForRequest(result, request)).toBe(true);
    expect(studioBg3dObjWorkerResponseTransfers(progress)).toEqual([]);
    expect(studioBg3dObjWorkerResponseTransfers(error)).toEqual([]);
  });

  it("returns exact, unique geometry transfers in canonical attribute order", () => {
    const response = validResultResponse();
    const transfers = studioBg3dObjWorkerResponseTransfers(response);
    const attributes = response.result.renderables[0]?.attributes ?? [];

    expect(transfers).toEqual(attributes.map((attribute) => attribute.buffer));
    expect(new Set(transfers).size).toBe(transfers.length);
  });

  it("rejects extra envelope, result, attribute, material, and metric keys", () => {
    const response = validResultResponse();
    expect(isStudioBg3dObjWorkerResponse({ ...response, extra: true })).toBe(false);
    expect(isStudioBg3dObjWorkerResponse({
      ...response,
      result: { ...response.result, extra: true },
    })).toBe(false);
    expect(isStudioBg3dObjWorkerResponse({
      ...response,
      result: {
        ...response.result,
        renderables: [{
          ...response.result.renderables[0],
          attributes: [{ ...response.result.renderables[0]?.attributes[0], extra: true }],
        }],
      },
    })).toBe(false);
    expect(isStudioBg3dObjWorkerResponse({
      ...response,
      result: {
        ...response.result,
        materials: [{ ...response.result.materials[0], extra: true }],
      },
    })).toBe(false);
    expect(isStudioBg3dObjWorkerResponse({
      ...response,
      result: {
        ...response.result,
        metrics: { ...response.result.metrics, extra: true },
      },
    })).toBe(false);
  });

  it("rejects malformed, aliased, and non-finite attribute buffers", () => {
    const malformed = validResultResponse();
    const firstRenderable = malformed.result.renderables[0];
    expect(isStudioBg3dObjWorkerResponse({
      ...malformed,
      result: {
        ...malformed.result,
        renderables: [{
          ...firstRenderable,
          attributes: [
            { ...firstRenderable?.attributes[0], buffer: floats(0, 0, 0) },
            firstRenderable?.attributes[1],
            firstRenderable?.attributes[2],
          ],
        }],
      },
    })).toBe(false);

    const aliased = validResultResponse();
    const aliasedRenderable = aliased.result.renderables[0];
    const shared = aliasedRenderable?.attributes[0]?.buffer;
    expect(isStudioBg3dObjWorkerResponse({
      ...aliased,
      result: {
        ...aliased.result,
        renderables: [{
          ...aliasedRenderable,
          attributes: [
            aliasedRenderable?.attributes[0],
            { ...aliasedRenderable?.attributes[1], buffer: shared },
            aliasedRenderable?.attributes[2],
          ],
        }],
      },
    })).toBe(false);

    const nonFinite = validResultResponse();
    const nonFiniteRenderable = nonFinite.result.renderables[0];
    expect(isStudioBg3dObjWorkerResponse({
      ...nonFinite,
      result: {
        ...nonFinite.result,
        renderables: [{
          ...nonFiniteRenderable,
          attributes: [
            { ...nonFiniteRenderable?.attributes[0], buffer: floats(0, 0, Number.NaN, 1, 0, 0, 0, 1, 0) },
            nonFiniteRenderable?.attributes[1],
            nonFiniteRenderable?.attributes[2],
          ],
        }],
      },
    })).toBe(false);
  });

  it("rejects group gaps, overruns, and out-of-range material slots", () => {
    const response = validResultResponse();
    const renderable = response.result.renderables[0];
    for (const groups of [
      [{ start: 1, count: 2, materialIndex: 0 }],
      [{ start: 0, count: 6, materialIndex: 0 }],
      [{ start: 0, count: 3, materialIndex: 1 }],
    ]) {
      expect(isStudioBg3dObjWorkerResponse({
        ...response,
        result: {
          ...response.result,
          renderables: [{ ...renderable, groups }],
        },
      }), JSON.stringify(groups)).toBe(false);
    }

    expect(isStudioBg3dObjWorkerResponse({
      ...response,
      result: {
        ...response.result,
        renderables: [{
          ...renderable,
          materialSlots: [{
            name: "webtoon-red",
            canonicalMaterialIndex: 1,
            flatShading: false,
            vertexColors: false,
          }],
        }],
      },
    })).toBe(false);
  });

  it("rejects invalid node topology, duplicate renderable ownership, and aggregate drift", () => {
    const response = validResultResponse();
    expect(isStudioBg3dObjWorkerResponse({
      ...response,
      result: {
        ...response.result,
        nodes: [{ name: "triangle", parentIndex: 0, renderableIndex: 0 }],
      },
    })).toBe(false);
    expect(isStudioBg3dObjWorkerResponse({
      ...response,
      result: {
        ...response.result,
        nodes: [
          { name: "root", parentIndex: null, renderableIndex: 0 },
          { name: "duplicate", parentIndex: 0, renderableIndex: 0 },
        ],
        metrics: { ...response.result.metrics, nodes: 2 },
      },
    })).toBe(false);
    expect(isStudioBg3dObjWorkerResponse({
      ...response,
      result: {
        ...response.result,
        metrics: { ...response.result.metrics, triangles: 2 },
      },
    })).toBe(false);
  });

  it("rejects hostile material values, texture order, and resources outside the result closure", () => {
    const response = validResultResponse();
    expect(isStudioBg3dObjWorkerResponse({
      ...response,
      result: {
        ...response.result,
        materials: [{ ...response.result.materials[0], opacity: Number.NaN }],
      },
    })).toBe(false);
    expect(isStudioBg3dObjWorkerResponse({
      ...response,
      result: {
        ...response.result,
        materials: [{
          ...response.result.materials[0],
          textures: [
            {
              slot: "normal",
              resourcePath: TEXTURE_PATH,
              offset: [0, 0],
              repeat: [1, 1],
              bumpScale: 1,
              displacementBias: 0,
              displacementScale: 1,
            },
            response.result.materials[0]?.textures[0],
          ],
        }],
      },
    })).toBe(false);
    expect(isStudioBg3dObjWorkerResponse({
      ...response,
      result: {
        ...response.result,
        materials: [{
          ...response.result.materials[0],
          textures: [{
            ...response.result.materials[0]?.textures[0],
            resourcePath: "models/textures/missing.png",
          }],
        }],
      },
    })).toBe(false);
  });

  it("binds result identity, MTL sources, and used resources to the exact request", () => {
    const request = validRequest();
    const response = validResultResponse();

    expect(isStudioBg3dObjWorkerResponseForRequest({ ...response, requestId: 8 }, request)).toBe(false);
    expect(isStudioBg3dObjWorkerResponseForRequest({
      ...response,
      result: { ...response.result, primaryPath: "models/other.obj" },
    }, request)).toBe(false);

    const unselectedTexture = "models/textures/unselected.png";
    const usedResourcePaths = [PRIMARY_PATH, MTL_PATH, unselectedTexture];
    const withUnselectedTexture = {
      ...response,
      result: {
        ...response.result,
        usedResourcePaths,
        materials: [{
          ...response.result.materials[0],
          textures: [{
            ...response.result.materials[0]?.textures[0],
            resourcePath: unselectedTexture,
          }],
        }],
        metrics: { ...response.result.metrics, usedResources: usedResourcePaths.length },
      },
    };
    expect(isStudioBg3dObjWorkerResponse(withUnselectedTexture)).toBe(true);
    expect(isStudioBg3dObjWorkerResponseForRequest(withUnselectedTexture, request)).toBe(false);

    const unknownMtl = "models/materials/unselected.mtl";
    const pathsWithUnknownMtl = [PRIMARY_PATH, MTL_PATH, unknownMtl, TEXTURE_PATH];
    const withUnknownMtl = {
      ...response,
      result: {
        ...response.result,
        usedResourcePaths: pathsWithUnknownMtl,
        materials: [{ ...response.result.materials[0], sourceMtlPath: unknownMtl }],
        metrics: { ...response.result.metrics, usedResources: pathsWithUnknownMtl.length },
      },
    };
    expect(isStudioBg3dObjWorkerResponse(withUnknownMtl)).toBe(true);
    expect(isStudioBg3dObjWorkerResponseForRequest(withUnknownMtl, request)).toBe(false);
  });

  it("throws rather than transferring duplicate or otherwise hostile result buffers", () => {
    const response = validResultResponse();
    const renderable = response.result.renderables[0];
    const shared = renderable?.attributes[0]?.buffer;
    const hostile = {
      ...response,
      result: {
        ...response.result,
        renderables: [{
          ...renderable,
          attributes: [
            renderable?.attributes[0],
            { ...renderable?.attributes[1], buffer: shared },
            renderable?.attributes[2],
          ],
        }],
      },
    };
    expect(() => studioBg3dObjWorkerResponseTransfers(
      hostile as unknown as StudioBg3dObjWorkerResultResponse,
    )).toThrowError(TypeError);
  });
});
