import {
  isStudioBg3dObjPreflightWorkerRequest,
  type StudioBg3dMtlPreflightMetrics,
  type StudioBg3dObjPreflightMetrics,
  type StudioBg3dObjPreflightWorkerFailureCode,
  type StudioBg3dObjPreflightWorkerMtlRequest,
  type StudioBg3dObjPreflightWorkerMtlResult,
  type StudioBg3dObjPreflightWorkerObjRequest,
  type StudioBg3dObjPreflightWorkerObjResult,
  type StudioBg3dObjPreflightWorkerRequest,
  type StudioBg3dObjPreflightWorkerResult,
} from "./studio-bg3d-obj-preflight-worker-protocol";

const MAX_LINE_LENGTH = 1024 * 1024;
const SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/iu;

export class StudioBg3dObjPreflightWorkerRuntimeError extends Error {
  constructor(readonly code: StudioBg3dObjPreflightWorkerFailureCode) {
    super(code);
    this.name = "StudioBg3dObjPreflightWorkerRuntimeError";
  }
}

function runtimeError(
  code: StudioBg3dObjPreflightWorkerFailureCode,
): StudioBg3dObjPreflightWorkerRuntimeError {
  return new StudioBg3dObjPreflightWorkerRuntimeError(code);
}

function containsControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const point = character.codePointAt(0) ?? 0;
    return point <= 31 || point === 127;
  });
}

function safeAdd(
  left: number,
  right: number,
  code: StudioBg3dObjPreflightWorkerFailureCode,
): number {
  if (
    !Number.isSafeInteger(left)
    || left < 0
    || !Number.isSafeInteger(right)
    || right < 0
    || left > Number.MAX_SAFE_INTEGER - right
  ) throw runtimeError(code);
  return left + right;
}

function safeMultiply(
  left: number,
  right: number,
  code: StudioBg3dObjPreflightWorkerFailureCode,
): number {
  if (
    !Number.isSafeInteger(left)
    || left < 0
    || !Number.isSafeInteger(right)
    || right < 0
    || (left !== 0 && right > Math.floor(Number.MAX_SAFE_INTEGER / left))
  ) throw runtimeError(code);
  return left * right;
}

function decodeUtf8(bytes: ArrayBuffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw runtimeError("invalid-text");
  }
}

/** Matches the ECMAScript `\s` set used by Three's OBJLoader without allocating per code unit. */
function isObjWhitespace(code: number): boolean {
  return code === 0x20
    || (code >= 0x09 && code <= 0x0d)
    || code === 0x00a0
    || code === 0x1680
    || (code >= 0x2000 && code <= 0x200a)
    || code === 0x2028
    || code === 0x2029
    || code === 0x202f
    || code === 0x205f
    || code === 0xfeff;
}

function countObjArguments(value: string, start: number): number {
  let count = 0;
  let insideToken = false;
  for (let index = start; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0x23 && !insideToken) break;
    if (isObjWhitespace(code)) {
      insideToken = false;
    } else if (!insideToken) {
      insideToken = true;
      count += 1;
    }
  }
  return count;
}

function scanObj(
  text: string,
  request: StudioBg3dObjPreflightWorkerObjRequest,
): {
  readonly materialLibraryReferences: readonly string[];
  readonly metrics: StudioBg3dObjPreflightMetrics;
} {
  let sourceVertices = 0;
  let sourceAttributeRecords = 0;
  let expandedVertices = 0;
  let triangles = 0;
  let objectNodes = 0;
  let materialSections = 0;
  let materialLibraryDirectives = 0;
  let offset = 0;
  const materialLibraries: string[] = [];
  const seenMaterialLibraryReferences = new Set<string>();

  while (offset <= text.length) {
    const newline = text.indexOf("\n", offset);
    const end = newline < 0 ? text.length : newline;
    if (end - offset > MAX_LINE_LENGTH) throw runtimeError("parse-failed");
    const line = text.slice(offset, end);
    let directiveStart = 0;
    while (directiveStart < line.length && /\s/u.test(line[directiveStart] ?? "")) {
      directiveStart += 1;
    }
    if (directiveStart < line.length && line.charCodeAt(directiveStart) !== 0x23) {
      let directiveEnd = directiveStart;
      while (directiveEnd < line.length && !/\s/u.test(line[directiveEnd] ?? "")) {
        directiveEnd += 1;
      }
      const directive = line.slice(directiveStart, directiveEnd).toLowerCase();
      if (directive === "v" || directive === "vt" || directive === "vn") {
        sourceAttributeRecords = safeAdd(
          sourceAttributeRecords,
          1,
          "vertex-budget-exceeded",
        );
        if (sourceAttributeRecords > request.budgets.maxVertices) {
          throw runtimeError("vertex-budget-exceeded");
        }
        if (directive === "v") sourceVertices += 1;
        if (sourceVertices > request.budgets.maxVertices) {
          throw runtimeError("vertex-budget-exceeded");
        }
      } else if (directive === "f" || directive === "l" || directive === "p") {
        const references = countObjArguments(line, directiveEnd);
        const expandedReferences = directive === "f"
          ? safeMultiply(Math.max(0, references - 2), 3, "vertex-budget-exceeded")
          : references;
        expandedVertices = safeAdd(
          expandedVertices,
          expandedReferences,
          "vertex-budget-exceeded",
        );
        if (expandedVertices > request.budgets.maxVertices) {
          throw runtimeError("vertex-budget-exceeded");
        }
        if (directive === "f") {
          triangles = safeAdd(
            triangles,
            Math.max(0, references - 2),
            "triangle-budget-exceeded",
          );
          if (triangles > request.budgets.maxTriangles) {
            throw runtimeError("triangle-budget-exceeded");
          }
        }
      } else if (directive === "o" || directive === "g") {
        objectNodes = safeAdd(objectNodes, 1, "node-budget-exceeded");
        if (objectNodes > request.budgets.maxNodes) {
          throw runtimeError("node-budget-exceeded");
        }
      } else if (directive === "usemtl") {
        materialSections = safeAdd(materialSections, 1, "mesh-budget-exceeded");
        if (materialSections > request.budgets.maxMeshPrimitives) {
          throw runtimeError("mesh-budget-exceeded");
        }
      } else if (directive === "mtllib") {
        materialLibraryDirectives = safeAdd(
          materialLibraryDirectives,
          1,
          "material-budget-exceeded",
        );
        if (materialLibraryDirectives > request.budgets.maxMtlReferenceDirectives) {
          throw runtimeError("material-budget-exceeded");
        }
        const reference = line.slice(directiveEnd).trim();
        if (
          !reference
          || reference.length > 1_024
          || SCHEME_PATTERN.test(reference)
          || reference.startsWith("//")
          || containsControlCharacter(reference)
        ) throw runtimeError("unsafe-resource-uri");
        if (!seenMaterialLibraryReferences.has(reference)) {
          seenMaterialLibraryReferences.add(reference);
          materialLibraries.push(reference);
          if (materialLibraries.length > request.budgets.maxMaterialLibraries) {
            throw runtimeError("material-budget-exceeded");
          }
        }
      }
    }
    if (newline < 0) break;
    offset = newline + 1;
  }

  return {
    materialLibraryReferences: Object.freeze(materialLibraries),
    metrics: Object.freeze({
      sourceVertices,
      sourceAttributeRecords,
      expandedVertices,
      triangles,
      objectNodes,
      materialSections,
      materialLibraryDirectives,
    }),
  };
}

function isTextureDirective(directive: string): boolean {
  return directive.startsWith("map_")
    || directive === "bump"
    || directive === "decal"
    || directive === "disp"
    || directive === "norm"
    || directive === "refl";
}

function scanMtl(
  text: string,
  request: StudioBg3dObjPreflightWorkerMtlRequest,
  metrics: { directives: number; materials: number; textureSlots: number },
): void {
  let offset = 0;
  while (offset <= text.length) {
    const newline = text.indexOf("\n", offset);
    const end = newline < 0 ? text.length : newline;
    if (end - offset > MAX_LINE_LENGTH) throw runtimeError("parse-failed");
    const line = text.slice(offset, end);
    let directiveStart = 0;
    while (directiveStart < line.length && /\s/u.test(line[directiveStart] ?? "")) {
      directiveStart += 1;
    }
    if (directiveStart < line.length && line.charCodeAt(directiveStart) !== 0x23) {
      let directiveEnd = directiveStart;
      while (directiveEnd < line.length && !/\s/u.test(line[directiveEnd] ?? "")) {
        directiveEnd += 1;
      }
      const directive = line.slice(directiveStart, directiveEnd).toLowerCase();
      metrics.directives = safeAdd(
        metrics.directives,
        1,
        "material-budget-exceeded",
      );
      if (metrics.directives > request.budgets.maxMtlDirectives) {
        throw runtimeError("material-budget-exceeded");
      }
      if (directive === "newmtl") {
        metrics.materials = safeAdd(metrics.materials, 1, "material-budget-exceeded");
        if (metrics.materials > request.budgets.maxMaterials) {
          throw runtimeError("material-budget-exceeded");
        }
      }
      if (isTextureDirective(directive)) {
        metrics.textureSlots = safeAdd(
          metrics.textureSlots,
          1,
          "material-budget-exceeded",
        );
        if (metrics.textureSlots > request.budgets.maxMaterialSlots) {
          throw runtimeError("material-budget-exceeded");
        }
        const reference = line.slice(directiveEnd).trim();
        if (SCHEME_PATTERN.test(reference) || reference.startsWith("//")) {
          throw runtimeError("unsafe-resource-uri");
        }
      }
    }
    if (newline < 0) break;
    offset = newline + 1;
  }
}

function preflightObj(
  request: StudioBg3dObjPreflightWorkerObjRequest,
): StudioBg3dObjPreflightWorkerObjResult {
  const scanned = scanObj(decodeUtf8(request.bytes), request);
  return {
    kind: "obj",
    sourceByteLength: request.sourceByteLength,
    bytes: request.bytes,
    materialLibraryReferences: scanned.materialLibraryReferences,
    metrics: scanned.metrics,
  };
}

function preflightMtl(
  request: StudioBg3dObjPreflightWorkerMtlRequest,
): StudioBg3dObjPreflightWorkerMtlResult {
  const mutableMetrics = { directives: 0, materials: 0, textureSlots: 0 };
  for (const entry of request.materialLibraries) {
    scanMtl(decodeUtf8(entry.bytes), request, mutableMetrics);
  }
  const metrics: StudioBg3dMtlPreflightMetrics = Object.freeze({ ...mutableMetrics });
  return {
    kind: "mtl",
    materialLibraries: request.materialLibraries,
    metrics,
  };
}

export function preflightStudioBg3dObjWorkerRequest(
  request: StudioBg3dObjPreflightWorkerRequest,
): StudioBg3dObjPreflightWorkerResult {
  if (!isStudioBg3dObjPreflightWorkerRequest(request)) throw runtimeError("protocol");
  return request.kind === "preflight-obj" ? preflightObj(request) : preflightMtl(request);
}
