import {
  STUDIO_BG3D_OBJ_WORKER_MAX_MATERIAL_SLOTS,
  isStudioBg3dObjWorkerRequest,
  type StudioBg3dObjWorkerAttribute,
  type StudioBg3dObjWorkerAttributeName,
  type StudioBg3dObjWorkerCanonicalResult,
  type StudioBg3dObjWorkerFailureCode,
  type StudioBg3dObjWorkerMaterial,
  type StudioBg3dObjWorkerMaterialSlot,
  type StudioBg3dObjWorkerParseRequest,
  type StudioBg3dObjWorkerRenderable,
  type StudioBg3dObjWorkerRenderableKind,
  type StudioBg3dObjWorkerTextureBinding,
  type StudioBg3dObjWorkerTextureSlot,
} from "./studio-bg3d-obj-worker-protocol";

import type * as THREE from "three";

const TEXTURE_SLOT_ORDER: readonly StudioBg3dObjWorkerTextureSlot[] = [
  "ambient",
  "base-color",
  "specular",
  "emissive",
  "normal",
  "bump",
  "displacement",
  "alpha",
  "reflection",
];
const TEXTURE_DIRECTIVE_SLOT: Readonly<Record<string, StudioBg3dObjWorkerTextureSlot>> = {
  map_ka: "ambient",
  map_kd: "base-color",
  map_ks: "specular",
  map_ke: "emissive",
  norm: "normal",
  map_bump: "bump",
  bump: "bump",
  disp: "displacement",
  map_d: "alpha",
  refl: "reflection",
};
const ATTRIBUTE_ORDER: readonly StudioBg3dObjWorkerAttributeName[] = [
  "position",
  "normal",
  "color",
  "uv",
];
const ATTRIBUTE_ITEM_SIZE: Readonly<Record<StudioBg3dObjWorkerAttributeName, 2 | 3>> = {
  position: 3,
  normal: 3,
  color: 3,
  uv: 2,
};
const SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/iu;
const ENCODED_SEPARATOR_PATTERN = /%(?:2f|5c)/iu;
const SUPPORTED_TEXTURE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp"]);
const MAX_LINE_LENGTH = 1024 * 1024;
const MAX_LABEL_LENGTH = 256;
const DEFAULT_SPECULAR = 0x11 / 0xff;

export class StudioBg3dObjWorkerRuntimeError extends Error {
  constructor(readonly code: StudioBg3dObjWorkerFailureCode) {
    super(code);
    this.name = "StudioBg3dObjWorkerRuntimeError";
  }
}

interface MutableTextureOptions {
  offset: [number, number];
  repeat: [number, number];
  bumpScale: number;
  displacementBias: number;
  displacementScale: number;
}

interface MutableMaterial {
  readonly name: string;
  readonly sourceMtlPath: string;
  ambient: [number, number, number];
  diffuse: [number, number, number];
  specular: [number, number, number];
  emissive: [number, number, number];
  shininess: number;
  opacity: number;
  readonly textures: Map<StudioBg3dObjWorkerTextureSlot, StudioBg3dObjWorkerTextureBinding>;
}

interface CanonicalCatalog {
  readonly exact: ReadonlySet<string>;
  readonly pathByFoldedPath: ReadonlyMap<string, string>;
  readonly packageRootSegments: readonly string[];
}

function runtimeError(code: StudioBg3dObjWorkerFailureCode): StudioBg3dObjWorkerRuntimeError {
  return new StudioBg3dObjWorkerRuntimeError(code);
}

function containsControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const point = character.codePointAt(0) ?? 0;
    return point <= 31 || point === 127;
  });
}

function extensionOf(path: string): string {
  const segment = path.slice(path.lastIndexOf("/") + 1);
  const dot = segment.lastIndexOf(".");
  return dot > 0 ? segment.slice(dot + 1).toLowerCase() : "";
}

function compareUtf8(left: string, right: string): number {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const count = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < count; index += 1) {
    const difference = (leftBytes[index] ?? 0) - (rightBytes[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return leftBytes.length - rightBytes.length;
}

function safeAdd(left: number, right: number, code: StudioBg3dObjWorkerFailureCode): number {
  if (
    !Number.isSafeInteger(left)
    || left < 0
    || !Number.isSafeInteger(right)
    || right < 0
    || left > Number.MAX_SAFE_INTEGER - right
  ) throw runtimeError(code);
  return left + right;
}

function safeMultiply(left: number, right: number, code: StudioBg3dObjWorkerFailureCode): number {
  if (
    !Number.isSafeInteger(left)
    || left < 0
    || !Number.isSafeInteger(right)
    || right < 0
    || (left !== 0 && right > Math.floor(Number.MAX_SAFE_INTEGER / left))
  ) throw runtimeError(code);
  return left * right;
}

function canonicalLabel(value: string, fallback: string): string {
  const candidate = (value || fallback).normalize("NFC").trim();
  if (
    candidate.length === 0
    || candidate.length > MAX_LABEL_LENGTH
    || containsControlCharacter(candidate)
  ) throw runtimeError("parse-failed");
  return candidate;
}

function modelBaseName(path: string): string {
  const segment = path.slice(path.lastIndexOf("/") + 1);
  const dot = segment.lastIndexOf(".");
  return canonicalLabel(dot > 0 ? segment.slice(0, dot) : segment, "obj-root");
}

function createCatalog(request: StudioBg3dObjWorkerParseRequest): CanonicalCatalog {
  const pathByFoldedPath = new Map<string, string>();
  for (const path of request.resourcePaths) {
    const folded = path.toLocaleLowerCase("en-US");
    if (pathByFoldedPath.has(folded)) throw runtimeError("protocol");
    pathByFoldedPath.set(folded, path);
  }
  const primarySegments = request.primaryPath.split("/");
  return {
    exact: new Set(request.resourcePaths),
    pathByFoldedPath,
    packageRootSegments: primarySegments.length > 1 ? [primarySegments[0] ?? ""] : [],
  };
}

function decodedReference(raw: string): string {
  const trimmed = raw.trim();
  if (
    !trimmed
    || trimmed.length > 1_024
    || trimmed.startsWith("/")
    || trimmed.startsWith("//")
    || trimmed.includes("\\")
    || trimmed.includes("?")
    || trimmed.includes("#")
    || containsControlCharacter(trimmed)
    || SCHEME_PATTERN.test(trimmed)
    || ENCODED_SEPARATOR_PATTERN.test(trimmed)
  ) throw runtimeError("unsafe-resource-uri");
  try {
    const decoded = decodeURIComponent(trimmed).normalize("NFC");
    if (
      !decoded
      || decoded.startsWith("/")
      || decoded.startsWith("//")
      || decoded.includes("\\")
      || decoded.includes("?")
      || decoded.includes("#")
      || containsControlCharacter(decoded)
      || SCHEME_PATTERN.test(decoded)
    ) throw runtimeError("unsafe-resource-uri");
    return decoded;
  } catch (error) {
    if (error instanceof StudioBg3dObjWorkerRuntimeError) throw error;
    throw runtimeError("unsafe-resource-uri");
  }
}

function lookupCatalogPath(catalog: CanonicalCatalog, candidate: string): string | null {
  if (catalog.exact.has(candidate)) return candidate;
  return catalog.pathByFoldedPath.get(candidate.toLocaleLowerCase("en-US")) ?? null;
}

/** Resolve strictly inside the selected virtual package; no global basename guessing is allowed. */
function resolveResourceReference(
  catalog: CanonicalCatalog,
  referrerPath: string,
  rawReference: string,
): string {
  const decoded = decodedReference(rawReference);
  const rootDepth = catalog.packageRootSegments.length;
  const segments = referrerPath.split("/").slice(0, -1);
  for (const segment of decoded.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (segments.length <= rootDepth) throw runtimeError("unsafe-resource-uri");
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  const relativeCandidate = segments.join("/");
  const relative = lookupCatalogPath(catalog, relativeCandidate);
  if (relative) return relative;

  // Some exporters write package-root paths even from nested MTL files. Accept only an exact
  // canonical catalog match; never fall back to a same-named file elsewhere.
  const directSegments: string[] = [];
  for (const segment of decoded.split("/")) {
    if (!segment || segment === "." || segment === "..") {
      if (segment === "..") throw runtimeError("missing-resource");
      continue;
    }
    directSegments.push(segment);
  }
  const direct = lookupCatalogPath(catalog, directSegments.join("/"));
  if (direct) return direct;
  throw runtimeError("missing-resource");
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

function countArguments(line: string, start: number): number {
  let count = 0;
  let insideToken = false;
  for (let index = start; index < line.length; index += 1) {
    const code = line.charCodeAt(index);
    if (code === 0x23 && !insideToken) break;
    if (isObjWhitespace(code)) insideToken = false;
    else if (!insideToken) {
      insideToken = true;
      count += 1;
    }
  }
  return count;
}

function resolveMaterialLibraryDirective(
  raw: string,
  request: StudioBg3dObjWorkerParseRequest,
  catalog: CanonicalCatalog,
): readonly string[] {
  const available = new Set(request.materialLibraries.map((entry) => entry.path));
  try {
    const whole = resolveResourceReference(catalog, request.primaryPath, raw);
    if (extensionOf(whole) === "mtl" && available.has(whole)) return [whole];
  } catch (error) {
    if (
      error instanceof StudioBg3dObjWorkerRuntimeError
      && error.code !== "missing-resource"
    ) throw error;
  }
  const tokens = raw.trim().split(/[\t ]+/u).filter(Boolean);
  if (tokens.length < 2) throw runtimeError("missing-resource");
  const resolved: string[] = [];
  for (const token of tokens) {
    const path = resolveResourceReference(catalog, request.primaryPath, token);
    if (extensionOf(path) !== "mtl" || !available.has(path)) throw runtimeError("missing-resource");
    resolved.push(path);
  }
  return resolved;
}

/** Revalidates expansion budgets before OBJLoader is allowed to allocate non-indexed arrays. */
function preflightObj(
  text: string,
  request: StudioBg3dObjWorkerParseRequest,
  catalog: CanonicalCatalog,
): readonly string[] {
  let sourceVertices = 0;
  let expandedVertices = 0;
  let triangles = 0;
  let nodes = 1;
  let materialSlots = 0;
  let offset = 0;
  let lineNumber = 0;
  const materialLibraries: string[] = [];
  const seenMaterialLibraries = new Set<string>();

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
      if (directive === "v") {
        sourceVertices = safeAdd(sourceVertices, 1, "vertex-budget-exceeded");
        if (sourceVertices > request.budgets.maxVertices) {
          throw runtimeError("vertex-budget-exceeded");
        }
      } else if (directive === "f" || directive === "l" || directive === "p") {
        const references = countArguments(line, directiveEnd);
        const expanded = directive === "f"
          ? safeMultiply(Math.max(0, references - 2), 3, "vertex-budget-exceeded")
          : references;
        expandedVertices = safeAdd(expandedVertices, expanded, "vertex-budget-exceeded");
        if (expandedVertices > request.budgets.maxVertices) {
          throw runtimeError("vertex-budget-exceeded");
        }
        if (directive === "f") {
          triangles = safeAdd(triangles, Math.max(0, references - 2), "triangle-budget-exceeded");
          if (triangles > request.budgets.maxTriangles) {
            throw runtimeError("triangle-budget-exceeded");
          }
        }
      } else if (directive === "o" || directive === "g") {
        nodes = safeAdd(nodes, 1, "node-budget-exceeded");
        if (nodes > request.budgets.maxNodes) throw runtimeError("node-budget-exceeded");
      } else if (directive === "usemtl") {
        materialSlots = safeAdd(materialSlots, 1, "material-budget-exceeded");
        if (materialSlots > request.budgets.maxMaterialSlots) {
          throw runtimeError("material-budget-exceeded");
        }
      } else if (directive === "mtllib") {
        const rawReference = line.slice(directiveEnd).trim();
        for (const path of resolveMaterialLibraryDirective(rawReference, request, catalog)) {
          if (seenMaterialLibraries.has(path)) continue;
          seenMaterialLibraries.add(path);
          materialLibraries.push(path);
          if (materialLibraries.length > request.budgets.maxMaterialLibraries) {
            throw runtimeError("material-budget-exceeded");
          }
        }
      }
    }
    if (newline < 0) break;
    offset = newline + 1;
    lineNumber += 1;
    if (lineNumber > 10_000_000) throw runtimeError("parse-failed");
  }
  return materialLibraries;
}

function decodeUtf8(bytes: ArrayBuffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw runtimeError("parse-failed");
  }
}

function parseFinite(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw runtimeError("parse-failed");
  return parsed;
}

function parseUnitColor(value: string): [number, number, number] {
  const tokens = value.trim().split(/\s+/u);
  if (tokens.length < 3) throw runtimeError("parse-failed");
  const color: [number, number, number] = [
    parseFinite(tokens[0] ?? ""),
    parseFinite(tokens[1] ?? ""),
    parseFinite(tokens[2] ?? ""),
  ];
  if (color.some((component) => component < 0 || component > 1)) {
    throw runtimeError("parse-failed");
  }
  return color;
}

function defaultMutableMaterial(name: string, sourceMtlPath: string): MutableMaterial {
  return {
    name,
    sourceMtlPath,
    ambient: [0, 0, 0],
    diffuse: [1, 1, 1],
    specular: [DEFAULT_SPECULAR, DEFAULT_SPECULAR, DEFAULT_SPECULAR],
    emissive: [0, 0, 0],
    shininess: 30,
    opacity: 1,
    textures: new Map(),
  };
}

function textureOptionArity(option: string): number | null {
  if (["-bm", "-clamp", "-blendu", "-blendv", "-cc", "-texres", "-imfchan", "-type"].includes(option)) {
    return 1;
  }
  if (option === "-mm") return 2;
  if (option === "-s" || option === "-o") return 3;
  return null;
}

function parseTextureBinding(
  slot: StudioBg3dObjWorkerTextureSlot,
  value: string,
  sourceMtlPath: string,
  catalog: CanonicalCatalog,
): StudioBg3dObjWorkerTextureBinding {
  const tokens = value.trim().split(/\s+/u).filter(Boolean);
  const options: MutableTextureOptions = {
    offset: [0, 0],
    repeat: [1, 1],
    bumpScale: 1,
    displacementBias: 0,
    displacementScale: 1,
  };
  let offset = 0;
  while (offset < tokens.length && (tokens[offset] ?? "").startsWith("-")) {
    const option = (tokens[offset] ?? "").toLowerCase();
    const arity = textureOptionArity(option);
    if (arity === null || offset + arity >= tokens.length) throw runtimeError("parse-failed");
    const values = tokens.slice(offset + 1, offset + arity + 1);
    if (option === "-bm") options.bumpScale = parseFinite(values[0] ?? "");
    else if (option === "-mm") {
      options.displacementBias = parseFinite(values[0] ?? "");
      options.displacementScale = parseFinite(values[1] ?? "");
    } else if (option === "-s") {
      options.repeat = [parseFinite(values[0] ?? ""), parseFinite(values[1] ?? "")];
      parseFinite(values[2] ?? "");
    } else if (option === "-o") {
      options.offset = [parseFinite(values[0] ?? ""), parseFinite(values[1] ?? "")];
      parseFinite(values[2] ?? "");
    }
    offset += arity + 1;
  }
  const rawReference = tokens.slice(offset).join(" ");
  if (!rawReference) throw runtimeError("missing-resource");
  const resourcePath = resolveResourceReference(catalog, sourceMtlPath, rawReference);
  if (!SUPPORTED_TEXTURE_EXTENSIONS.has(extensionOf(resourcePath))) {
    throw runtimeError("missing-resource");
  }
  return {
    slot,
    resourcePath,
    offset: options.offset,
    repeat: options.repeat,
    bumpScale: options.bumpScale,
    displacementBias: options.displacementBias,
    displacementScale: options.displacementScale,
  };
}

function parseMtlLibrary(
  text: string,
  sourceMtlPath: string,
  catalog: CanonicalCatalog,
  materialByName: Map<string, MutableMaterial>,
  maximumMaterials: number,
): void {
  let current: MutableMaterial | null = null;
  let offset = 0;
  while (offset <= text.length) {
    const newline = text.indexOf("\n", offset);
    const end = newline < 0 ? text.length : newline;
    if (end - offset > MAX_LINE_LENGTH) throw runtimeError("parse-failed");
    const line = text.slice(offset, end).trim();
    if (line && !line.startsWith("#")) {
      const separator = line.search(/\s/u);
      const directive = (separator < 0 ? line : line.slice(0, separator)).toLowerCase();
      const value = separator < 0 ? "" : line.slice(separator).trim();
      if (directive === "newmtl") {
        const name = canonicalLabel(value, "material");
        if (materialByName.has(name)) throw runtimeError("material-budget-exceeded");
        current = defaultMutableMaterial(name, sourceMtlPath);
        materialByName.set(name, current);
        if (materialByName.size > maximumMaterials) throw runtimeError("material-budget-exceeded");
      } else if (current) {
        if (directive === "ka") current.ambient = parseUnitColor(value);
        else if (directive === "kd") current.diffuse = parseUnitColor(value);
        else if (directive === "ks") current.specular = parseUnitColor(value);
        else if (directive === "ke") current.emissive = parseUnitColor(value);
        else if (directive === "ns") {
          const shininess = parseFinite(value);
          if (shininess < 0 || shininess > 1_000) throw runtimeError("parse-failed");
          current.shininess = shininess;
        } else if (directive === "d") {
          const opacityToken = value.toLowerCase().startsWith("-halo ")
            ? value.slice("-halo ".length).trim()
            : value;
          const opacity = parseFinite(opacityToken);
          if (opacity < 0 || opacity > 1) throw runtimeError("parse-failed");
          current.opacity = opacity;
        } else if (directive === "tr") {
          const transparency = parseFinite(value);
          if (transparency < 0 || transparency > 1) throw runtimeError("parse-failed");
          current.opacity = 1 - transparency;
        } else {
          const slot = TEXTURE_DIRECTIVE_SLOT[directive];
          if (slot) {
            current.textures.set(
              slot,
              parseTextureBinding(slot, value, sourceMtlPath, catalog),
            );
          }
        }
      }
    }
    if (newline < 0) break;
    offset = newline + 1;
  }
}

function canonicalMaterial(material: MutableMaterial): StudioBg3dObjWorkerMaterial {
  const textures = [...material.textures.values()].sort(
    (left, right) => TEXTURE_SLOT_ORDER.indexOf(left.slot) - TEXTURE_SLOT_ORDER.indexOf(right.slot),
  );
  return {
    name: material.name,
    sourceMtlPath: material.sourceMtlPath,
    synthesized: false,
    ambient: material.ambient,
    diffuse: material.diffuse,
    specular: material.specular,
    emissive: material.emissive,
    shininess: material.shininess,
    opacity: material.opacity,
    textures,
  };
}

function synthesizedMaterial(name: string): StudioBg3dObjWorkerMaterial {
  return {
    name,
    sourceMtlPath: null,
    synthesized: true,
    ambient: [0, 0, 0],
    diffuse: [1, 1, 1],
    specular: [DEFAULT_SPECULAR, DEFAULT_SPECULAR, DEFAULT_SPECULAR],
    emissive: [0, 0, 0],
    shininess: 30,
    opacity: 1,
    textures: [],
  };
}

function attributeComponent(
  attribute: THREE.BufferAttribute,
  index: number,
  component: number,
): number {
  if (component === 0) return attribute.getX(index);
  if (component === 1) return attribute.getY(index);
  return attribute.getZ(index);
}

function canonicalAttribute(
  geometry: THREE.BufferGeometry,
  name: StudioBg3dObjWorkerAttributeName,
  vertexCount: number,
): StudioBg3dObjWorkerAttribute | null {
  const source = geometry.getAttribute(name);
  if (!source) return null;
  const standalone = source as THREE.BufferAttribute & {
    readonly isBufferAttribute?: boolean;
    readonly isInterleavedBufferAttribute?: boolean;
  };
  const itemSize = ATTRIBUTE_ITEM_SIZE[name];
  if (
    standalone.isBufferAttribute !== true
    || standalone.isInterleavedBufferAttribute === true
    || standalone.count !== vertexCount
    || standalone.itemSize !== itemSize
  ) throw runtimeError("parse-failed");
  const values = new Float32Array(safeMultiply(vertexCount, itemSize, "geometry-memory-too-large"));
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    for (let component = 0; component < itemSize; component += 1) {
      const value = attributeComponent(standalone, vertex, component);
      if (!Number.isFinite(value)) throw runtimeError("parse-failed");
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

function renderableKind(object: THREE.Object3D): StudioBg3dObjWorkerRenderableKind | null {
  if ((object as THREE.Mesh).isMesh === true) return "mesh";
  if ((object as THREE.LineSegments).isLineSegments === true) return "line-segments";
  if ((object as THREE.Points).isPoints === true) return "points";
  return null;
}

function sourceMaterials(object: THREE.Object3D): readonly THREE.Material[] {
  const material = (object as THREE.Object3D & {
    readonly material?: THREE.Material | readonly THREE.Material[];
  }).material;
  if (!material) throw runtimeError("parse-failed");
  if (Array.isArray(material)) return material;
  return [material as THREE.Material];
}

function renderableObjects(root: THREE.Group): readonly THREE.Object3D[] {
  const renderables: THREE.Object3D[] = [];
  root.traverse((object) => {
    if (object !== root && renderableKind(object)) renderables.push(object);
  });
  return renderables;
}

function materialName(material: THREE.Material): string {
  return canonicalLabel(material.name, "default");
}

function canonicalRenderable(
  object: THREE.Object3D,
  renderableIndex: number,
  canonicalMaterialIndexByName: ReadonlyMap<string, number>,
  request: StudioBg3dObjWorkerParseRequest,
): StudioBg3dObjWorkerRenderable {
  const kind = renderableKind(object);
  const geometry = (object as THREE.Object3D & { readonly geometry?: THREE.BufferGeometry }).geometry;
  if (!kind || !geometry?.isBufferGeometry || geometry.index) throw runtimeError("parse-failed");
  const position = geometry.getAttribute("position");
  if (!position || !Number.isSafeInteger(position.count) || position.count <= 0) {
    throw runtimeError("parse-failed");
  }
  const vertexCount = position.count;
  if (vertexCount > request.budgets.maxVertices) throw runtimeError("vertex-budget-exceeded");
  if (kind === "mesh" && vertexCount % 3 !== 0) throw runtimeError("parse-failed");
  if (kind === "line-segments" && vertexCount % 2 !== 0) throw runtimeError("parse-failed");
  const unknownAttributes = Object.keys(geometry.attributes).filter(
    (name) => !ATTRIBUTE_ORDER.includes(name as StudioBg3dObjWorkerAttributeName),
  );
  if (unknownAttributes.length > 0) throw runtimeError("parse-failed");

  const attributes: StudioBg3dObjWorkerAttribute[] = [];
  for (const name of ATTRIBUTE_ORDER) {
    const attribute = canonicalAttribute(geometry, name, vertexCount);
    if (attribute) attributes.push(attribute);
  }
  if (attributes[0]?.name !== "position") throw runtimeError("parse-failed");
  const hasColor = attributes.some((attribute) => attribute.name === "color");
  const materials = sourceMaterials(object);
  const materialSlots: StudioBg3dObjWorkerMaterialSlot[] = materials.map((material) => {
    const name = materialName(material);
    const canonicalMaterialIndex = canonicalMaterialIndexByName.get(name);
    if (canonicalMaterialIndex === undefined) throw runtimeError("parse-failed");
    return {
      name,
      canonicalMaterialIndex,
      flatShading: (material as THREE.MeshPhongMaterial).flatShading === true,
      vertexColors: hasColor,
    };
  });
  if (materialSlots.length === 0 || materialSlots.length > STUDIO_BG3D_OBJ_WORKER_MAX_MATERIAL_SLOTS) {
    throw runtimeError("material-budget-exceeded");
  }
  const groups = geometry.groups.length > 0
    ? geometry.groups.map((group) => ({
      start: group.start,
      count: group.count,
      materialIndex: group.materialIndex ?? 0,
    }))
    : [{ start: 0, count: vertexCount, materialIndex: 0 }];
  return {
    kind,
    name: canonicalLabel(object.name, `object-${renderableIndex + 1}`),
    vertexCount,
    attributes,
    groups,
    materialSlots,
  };
}

function disposeParsedRoot(root: THREE.Object3D): void {
  root.traverse((object) => {
    const renderable = object as THREE.Object3D & {
      readonly geometry?: THREE.BufferGeometry;
      readonly material?: THREE.Material | readonly THREE.Material[];
    };
    renderable.geometry?.dispose();
    const materials = renderable.material
      ? Array.isArray(renderable.material) ? renderable.material : [renderable.material]
      : [];
    for (const material of materials) material.dispose();
  });
}

function totalAttributeBytes(renderables: readonly StudioBg3dObjWorkerRenderable[]): number {
  let total = 0;
  for (const renderable of renderables) {
    for (const attribute of renderable.attributes) {
      total = safeAdd(total, attribute.buffer.byteLength, "geometry-memory-too-large");
    }
  }
  return total;
}

/** CPU-heavy OBJ/MTL parse entry used by the dedicated Worker and directly by corpus tests. */
export async function parseStudioBg3dObjWorkerRequest(
  request: StudioBg3dObjWorkerParseRequest,
): Promise<StudioBg3dObjWorkerCanonicalResult> {
  if (!isStudioBg3dObjWorkerRequest(request)) throw runtimeError("protocol");
  const catalog = createCatalog(request);
  const objText = decodeUtf8(request.bytes);
  const referencedMaterialPaths = preflightObj(objText, request, catalog);
  const mtlByPath = new Map(request.materialLibraries.map((entry) => [entry.path, entry] as const));
  const parsedMaterialByName = new Map<string, MutableMaterial>();
  for (const path of referencedMaterialPaths) {
    const entry = mtlByPath.get(path);
    if (!entry) throw runtimeError("missing-resource");
    parseMtlLibrary(
      decodeUtf8(entry.bytes),
      path,
      catalog,
      parsedMaterialByName,
      request.budgets.maxMaterials,
    );
  }

  const { OBJLoader } = await import("three/examples/jsm/loaders/OBJLoader.js");
  let root: THREE.Group | null = null;
  try {
    root = new OBJLoader().parse(objText);
    const objects = renderableObjects(root);
    if (objects.length === 0 || objects.length > request.budgets.maxMeshes) {
      throw runtimeError("mesh-budget-exceeded");
    }

    const usedMaterialNames: string[] = [];
    const seenMaterialNames = new Set<string>();
    let materialSlotCount = 0;
    for (const object of objects) {
      const materials = sourceMaterials(object);
      materialSlotCount = safeAdd(materialSlotCount, materials.length, "material-budget-exceeded");
      if (materialSlotCount > request.budgets.maxMaterialSlots) {
        throw runtimeError("material-budget-exceeded");
      }
      for (const material of materials) {
        const name = materialName(material);
        if (!seenMaterialNames.has(name)) {
          seenMaterialNames.add(name);
          usedMaterialNames.push(name);
        }
      }
    }
    if (usedMaterialNames.length > request.budgets.maxMaterials) {
      throw runtimeError("material-budget-exceeded");
    }
    const materials = usedMaterialNames.map((name) => {
      const parsed = parsedMaterialByName.get(name);
      return parsed ? canonicalMaterial(parsed) : synthesizedMaterial(name);
    });
    const canonicalMaterialIndexByName = new Map(
      materials.map((material, index) => [material.name, index] as const),
    );
    const renderables = objects.map((object, index) =>
      canonicalRenderable(object, index, canonicalMaterialIndexByName, request));

    let vertices = 0;
    let triangles = 0;
    for (const renderable of renderables) {
      vertices = safeAdd(vertices, renderable.vertexCount, "vertex-budget-exceeded");
      if (vertices > request.budgets.maxVertices) throw runtimeError("vertex-budget-exceeded");
      if (renderable.kind === "mesh") {
        triangles = safeAdd(triangles, renderable.vertexCount / 3, "triangle-budget-exceeded");
        if (triangles > request.budgets.maxTriangles) throw runtimeError("triangle-budget-exceeded");
      }
    }
    const outputBytes = totalAttributeBytes(renderables);
    if (outputBytes <= 0 || outputBytes > request.budgets.maxOutputBytes) {
      throw runtimeError("geometry-memory-too-large");
    }

    const rootName = modelBaseName(request.primaryPath);
    const nodes = [
      { name: rootName, parentIndex: null, renderableIndex: null },
      ...renderables.map((renderable, index) => ({
        name: renderable.name,
        parentIndex: 0,
        renderableIndex: index,
      })),
    ];
    if (nodes.length > request.budgets.maxNodes) throw runtimeError("node-budget-exceeded");

    const usedResourcePaths = new Set<string>([request.primaryPath, ...referencedMaterialPaths]);
    for (const material of materials) {
      for (const texture of material.textures) usedResourcePaths.add(texture.resourcePath);
    }
    const sortedUsedResourcePaths = [...usedResourcePaths].sort(compareUtf8);
    return {
      primaryPath: request.primaryPath,
      nodes,
      renderables,
      materials,
      usedResourcePaths: sortedUsedResourcePaths,
      metrics: {
        nodes: nodes.length,
        meshes: renderables.length,
        vertices,
        triangles,
        outputBytes,
        materials: materials.length,
        materialSlots: materialSlotCount,
        usedResources: sortedUsedResourcePaths.length,
      },
    };
  } catch (error) {
    if (error instanceof StudioBg3dObjWorkerRuntimeError) throw error;
    throw runtimeError("parse-failed");
  } finally {
    if (root) disposeParsedRoot(root);
  }
}
