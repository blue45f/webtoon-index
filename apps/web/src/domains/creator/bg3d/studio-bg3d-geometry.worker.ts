/// <reference lib="webworker" />

import {
  STUDIO_BG3D_GEOMETRY_WORKER_PROTOCOL_VERSION,
  isStudioBg3dGeometryWorkerRequest,
  studioBg3dGeometryWorkerResponseTransfers,
  type StudioBg3dCanonicalGeometryAttribute,
  type StudioBg3dCanonicalGeometryAttributeName,
  type StudioBg3dCanonicalGeometryIndex,
  type StudioBg3dCanonicalGeometryPayload,
  type StudioBg3dGeometryWorkerFailureCode,
  type StudioBg3dGeometryWorkerParseRequest,
  type StudioBg3dGeometryWorkerResponse,
  type StudioBg3dGeometryWorkerStage,
} from "./studio-bg3d-geometry-worker-protocol";

import type * as THREE from "three";

const scope = self as unknown as DedicatedWorkerGlobalScope;
let activeIdentity: string | null = null;

class GeometryWorkerFailure extends Error {
  constructor(readonly code: StudioBg3dGeometryWorkerFailureCode) {
    super(code);
    this.name = "GeometryWorkerFailure";
  }
}

function identityOf(request: StudioBg3dGeometryWorkerParseRequest): string {
  return `${request.generationId}:${request.requestId}`;
}

function postProgress(
  request: StudioBg3dGeometryWorkerParseRequest,
  stage: StudioBg3dGeometryWorkerStage,
  progress: number,
): void {
  const response: StudioBg3dGeometryWorkerResponse = {
    version: STUDIO_BG3D_GEOMETRY_WORKER_PROTOCOL_VERSION,
    kind: "progress",
    requestId: request.requestId,
    generationId: request.generationId,
    stage,
    progress,
  };
  scope.postMessage(response);
}

function checkedProduct(left: number, right: number): number {
  if (
    !Number.isSafeInteger(left)
    || left < 0
    || !Number.isSafeInteger(right)
    || right < 0
    || (left !== 0 && right > Math.floor(Number.MAX_SAFE_INTEGER / left))
  ) throw new GeometryWorkerFailure("geometry-memory-too-large");
  return left * right;
}

function checkedSum(left: number, right: number, maximum: number): number {
  if (!Number.isSafeInteger(right) || right < 0 || left > maximum - right) {
    throw new GeometryWorkerFailure("geometry-memory-too-large");
  }
  return left + right;
}

function attributeComponent(attribute: THREE.BufferAttribute, index: number, component: number): number {
  if (component === 0) return attribute.getX(index);
  if (component === 1) return attribute.getY(index);
  return attribute.getZ(index);
}

function canonicalAttribute(
  geometry: THREE.BufferGeometry,
  name: StudioBg3dCanonicalGeometryAttributeName,
  vertexCount: number,
  itemSize: 2 | 3,
): StudioBg3dCanonicalGeometryAttribute | null {
  const source = geometry.getAttribute(name);
  if (!source) return null;
  const standalone = source as THREE.BufferAttribute & {
    readonly isBufferAttribute?: boolean;
    readonly isInterleavedBufferAttribute?: boolean;
  };
  if (
    standalone.isBufferAttribute !== true
    || standalone.isInterleavedBufferAttribute === true
    || standalone.count !== vertexCount
    || standalone.itemSize !== itemSize
  ) throw new GeometryWorkerFailure("parse-failed");
  const componentCount = checkedProduct(vertexCount, itemSize);
  const values = new Float32Array(componentCount);
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    for (let component = 0; component < itemSize; component += 1) {
      const value = attributeComponent(standalone, vertex, component);
      if (!Number.isFinite(value)) throw new GeometryWorkerFailure("parse-failed");
      values[vertex * itemSize + component] = value;
    }
  }
  return {
    name,
    itemSize,
    count: vertexCount,
    normalized: false,
    arrayType: "float32",
    buffer: values.buffer,
  };
}

function canonicalIndex(
  geometry: THREE.BufferGeometry,
  vertexCount: number,
  maximumTriangles: number,
): { readonly index: StudioBg3dCanonicalGeometryIndex | null; readonly triangleCount: number } {
  const source = geometry.index;
  if (!source) {
    if (vertexCount % 3 !== 0) throw new GeometryWorkerFailure("parse-failed");
    const triangleCount = vertexCount / 3;
    if (triangleCount > maximumTriangles) throw new GeometryWorkerFailure("triangle-budget-exceeded");
    return { index: null, triangleCount };
  }
  if (source.itemSize !== 1 || source.count <= 0 || source.count % 3 !== 0) {
    throw new GeometryWorkerFailure("parse-failed");
  }
  const triangleCount = source.count / 3;
  if (triangleCount > maximumTriangles) throw new GeometryWorkerFailure("triangle-budget-exceeded");
  const values = new Uint32Array(source.count);
  for (let offset = 0; offset < source.count; offset += 1) {
    const value = source.getX(offset);
    if (!Number.isSafeInteger(value) || value < 0 || value >= vertexCount) {
      throw new GeometryWorkerFailure("parse-failed");
    }
    values[offset] = value;
  }
  return {
    index: { count: values.length, arrayType: "uint32", buffer: values.buffer },
    triangleCount,
  };
}

function canonicalizeGeometry(
  request: StudioBg3dGeometryWorkerParseRequest,
  geometry: THREE.BufferGeometry,
): StudioBg3dCanonicalGeometryPayload {
  const sourcePosition = geometry.getAttribute("position");
  if (
    !sourcePosition
    || sourcePosition.itemSize !== 3
    || !Number.isSafeInteger(sourcePosition.count)
    || sourcePosition.count <= 0
  ) throw new GeometryWorkerFailure("parse-failed");
  const vertexCount = sourcePosition.count;
  if (vertexCount > request.budgets.maxVertices) {
    throw new GeometryWorkerFailure("vertex-budget-exceeded");
  }

  const unknownAttributes = Object.keys(geometry.attributes).filter(
    (name) => name !== "position" && name !== "normal" && name !== "color" && name !== "uv",
  );
  if (unknownAttributes.length > 0) throw new GeometryWorkerFailure("parse-failed");

  const kind = request.format === "stl" || geometry.index || geometry.getAttribute("normal")
    ? "mesh"
    : "points";
  if (kind === "mesh" && !geometry.getAttribute("normal")) geometry.computeVertexNormals();

  const attributes: StudioBg3dCanonicalGeometryAttribute[] = [];
  const position = canonicalAttribute(geometry, "position", vertexCount, 3);
  if (!position) throw new GeometryWorkerFailure("parse-failed");
  attributes.push(position);
  for (const [name, itemSize] of [
    ["normal", 3],
    ["color", 3],
    ["uv", 2],
  ] as const) {
    const attribute = canonicalAttribute(geometry, name, vertexCount, itemSize);
    if (attribute) attributes.push(attribute);
  }

  const topology = kind === "mesh"
    ? canonicalIndex(geometry, vertexCount, request.budgets.maxTriangles)
    : { index: null, triangleCount: 0 } as const;
  let byteLength = 0;
  for (const attribute of attributes) {
    byteLength = checkedSum(byteLength, attribute.buffer.byteLength, request.budgets.maxOutputBytes);
  }
  if (topology.index) {
    byteLength = checkedSum(byteLength, topology.index.buffer.byteLength, request.budgets.maxOutputBytes);
  }
  if (byteLength <= 0) throw new GeometryWorkerFailure("parse-failed");

  return {
    format: request.format,
    kind,
    vertexCount,
    triangleCount: topology.triangleCount,
    byteLength,
    attributes,
    index: topology.index,
  };
}

async function parseGeometry(
  request: StudioBg3dGeometryWorkerParseRequest,
): Promise<THREE.BufferGeometry> {
  if (request.format === "stl") {
    const { STLLoader } = await import("three/examples/jsm/loaders/STLLoader.js");
    return new STLLoader().parse(request.bytes);
  }
  const { PLYLoader } = await import("three/examples/jsm/loaders/PLYLoader.js");
  return new PLYLoader().parse(request.bytes);
}

function failureCode(error: unknown): StudioBg3dGeometryWorkerFailureCode {
  return error instanceof GeometryWorkerFailure ? error.code : "parse-failed";
}

async function execute(request: StudioBg3dGeometryWorkerParseRequest): Promise<void> {
  let geometry: THREE.BufferGeometry | null = null;
  try {
    postProgress(request, "parsing", 0.08);
    geometry = await parseGeometry(request);
    postProgress(request, "canonicalizing", 0.72);
    const result = canonicalizeGeometry(request, geometry);
    const response: StudioBg3dGeometryWorkerResponse = {
      version: STUDIO_BG3D_GEOMETRY_WORKER_PROTOCOL_VERSION,
      kind: "result",
      requestId: request.requestId,
      generationId: request.generationId,
      result,
    };
    scope.postMessage(response, studioBg3dGeometryWorkerResponseTransfers(response));
  } catch (error) {
    const response: StudioBg3dGeometryWorkerResponse = {
      version: STUDIO_BG3D_GEOMETRY_WORKER_PROTOCOL_VERSION,
      kind: "error",
      requestId: request.requestId,
      generationId: request.generationId,
      code: failureCode(error),
    };
    scope.postMessage(response);
  } finally {
    geometry?.dispose();
    activeIdentity = null;
  }
}

scope.addEventListener("message", (event: MessageEvent<unknown>) => {
  const request = event.data;
  if (!isStudioBg3dGeometryWorkerRequest(request)) return;
  const identity = identityOf(request);
  if (activeIdentity !== null) return;
  activeIdentity = identity;
  void execute(request);
});
