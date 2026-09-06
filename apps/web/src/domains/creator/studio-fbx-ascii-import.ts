/**
 * FBX mesh import (grade B) — ASCII Geometry::Mesh + binary uncompressed Vertices/PolygonVertexIndex.
 * Produces SceneIR + CompatibilityLoss report. Full skin/anim optional via ufbx WASM (not required for shipped bar).
 */

import {
  createStudioEditableMeshFromPolygons,
  type StudioEditableMesh,
  type StudioMeshVec3,
} from "./studio-editable-half-edge-mesh";
import {
  buildStudioImportCompatibilityReport,
  commitStudioImportToDocument,
  type StudioImportCompatibilityReport,
  type StudioImportSceneIR,
} from "./studio-import-compatibility-report";

export const STUDIO_FBX_ASCII_IMPORT_REVISION = 1 as const;

export type StudioFbxBinarySniff = {
  readonly byteLength: number;
  readonly version: number | null;
  readonly magicOk: boolean;
};

export type StudioFbxImportResult =
  | {
      readonly ok: true;
      readonly scene: StudioImportSceneIR;
      readonly report: StudioImportCompatibilityReport;
      readonly commit: ReturnType<typeof commitStudioImportToDocument>;
      readonly meshes: readonly StudioEditableMesh[];
      readonly header: StudioFbxAsciiHeader;
    }
  | {
      readonly ok: false;
      readonly detail: string;
      readonly report?: StudioImportCompatibilityReport;
      readonly binary?: StudioFbxBinarySniff;
      readonly header?: StudioFbxAsciiHeader;
    };

/** Read Kaydara binary header version field (uint32 LE at offset 23) when magic matches. */
export function sniffStudioFbxBinaryHeader(bytes: Uint8Array): StudioFbxBinarySniff {
  const magicOk = isStudioFbxBinary(bytes);
  let version: number | null = null;
  if (magicOk && bytes.length >= 27) {
    version =
      bytes[23]!
      | (bytes[24]! << 8)
      | (bytes[25]! << 16)
      | (bytes[26]! << 24);
  }
  return { byteLength: bytes.length, version, magicOk };
}

function parseNumberList(body: string): number[] {
  const values: number[] = [];
  const cleaned = body.replace(/^[^{]*\{/u, "").replace(/\}[\s\S]*$/u, "");
  const match = /a:\s*([\d\s,.\-eE]+)/u.exec(cleaned) ?? /:\s*([\d\s,.\-eE]+)/u.exec(cleaned);
  const src = match?.[1] ?? cleaned;
  for (const token of src.split(/[,\s]+/u)) {
    if (!token) continue;
    const n = Number(token);
    if (Number.isFinite(n)) values.push(n);
  }
  return values;
}

export type StudioFbxAsciiHeader = {
  readonly fbxVersion: number | null;
  readonly headerVersion: number | null;
  readonly creator: string | null;
  readonly geometryMeshCount: number;
  readonly modelCount: number;
  readonly hasLayerElementUV: boolean;
  readonly hasDeformer: boolean;
};

/** Pure header/stats scan for ASCII FBX (no mesh rebuild). */
export function parseStudioFbxAsciiHeader(text: string): StudioFbxAsciiHeader {
  const fbxVersion = /FBXVersion:\s*(\d+)/u.exec(text);
  const headerVersion = /FBXHeaderVersion:\s*(\d+)/u.exec(text);
  const creator = /Creator:\s*"([^"]*)"/u.exec(text) ?? /Creator:\s*([^\n\r]+)/u.exec(text);
  const geometryMeshCount = (text.match(/Geometry:\s*\d+,\s*"Geometry::[^"]+",\s*"Mesh"/gu) ?? []).length
    || (text.match(/Geometry:\s*\d+,\s*"[^"]*",\s*"Mesh"/gu) ?? []).length;
  const modelCount = (text.match(/Model:\s*\d+,\s*"Model::/gu) ?? []).length;
  return {
    fbxVersion: fbxVersion ? Number(fbxVersion[1]) : null,
    headerVersion: headerVersion ? Number(headerVersion[1]) : null,
    creator: creator?.[1]?.trim() ?? null,
    geometryMeshCount,
    modelCount,
    hasLayerElementUV: /LayerElementUV\b/u.test(text),
    hasDeformer: /Deformer\b/u.test(text) || /AnimationStack\b/u.test(text),
  };
}

/**
 * Parse ASCII FBX text into triangle meshes (subset of FBX 7.x Geometry Mesh).
 */
export function parseStudioFbxAscii(text: string): {
  readonly positions: number[];
  readonly polygons: number[][];
  readonly modelNames: string[];
  readonly header: StudioFbxAsciiHeader;
  readonly unsupported: readonly { kind: string; reason: string }[];
} {
  const unsupported: { kind: string; reason: string }[] = [];
  const header = parseStudioFbxAsciiHeader(text);
  if (!text.includes("FBX") && !text.includes("Vertices:")) {
    unsupported.push({ kind: "format", reason: "not ASCII FBX mesh text" });
  }
  if (text.includes("\0") || /FBXHeaderVersion:\s*\d+/u.test(text) === false) {
    // binary nulls → not our path
    if (text.includes("\0")) {
      unsupported.push({
        kind: "binary-fbx",
        reason: "Binary FBX requires ufbx/Assimp bridge; use convertStudioBg3dModelFilesToGlb",
      });
    }
  }

  const positions: number[] = [];
  const polygons: number[][] = [];
  const modelNames: string[] = [];

  // Vertices block
  const vertBlock = /Vertices:\s*\*\d+\s*\{([^}]*)\}/u.exec(text)
    ?? /Vertices:\s*\{([^}]*)\}/u.exec(text);
  if (vertBlock) {
    positions.push(...parseNumberList(vertBlock[0]));
  }

  // PolygonVertexIndex: last index of each polygon is bitwise NOT of index
  const polyBlock = /PolygonVertexIndex:\s*\*\d+\s*\{([^}]*)\}/u.exec(text)
    ?? /PolygonVertexIndex:\s*\{([^}]*)\}/u.exec(text);
  if (polyBlock) {
    const raw = parseNumberList(polyBlock[0]);
    let current: number[] = [];
    for (const v of raw) {
      if (v < 0) {
        current.push(~v);
        if (current.length >= 3) polygons.push(current);
        current = [];
      } else {
        current.push(v);
      }
    }
  }

  const modelRe = /Model:\s*\d+,\s*"Model::([^"]+)"/gu;
  let m: RegExpExecArray | null;
  while ((m = modelRe.exec(text)) !== null) {
    modelNames.push(m[1]!);
  }

  if (header.hasDeformer) {
    unsupported.push({
      kind: "animation-or-skin",
      reason: "ASCII FBX skin/animation not imported in lite path",
    });
  }
  if (text.includes("LayerElementMaterial") || text.includes("Material:")) {
    unsupported.push({
      kind: "material",
      reason: "FBX materials partially mapped — appearance may differ",
    });
  }
  if (header.geometryMeshCount > 1) {
    unsupported.push({
      kind: "multi-geometry",
      reason: `ASCII lite imports first Vertices/PolygonVertexIndex only (${header.geometryMeshCount} Geometry::Mesh declared)`,
    });
  }
  if (header.hasLayerElementUV) {
    unsupported.push({
      kind: "uv",
      reason: "LayerElementUV present but not bound on lite path",
    });
  }

  return { positions, polygons, modelNames, header, unsupported };
}

/** Detect Kaydara FBX binary magic (Kaydara FBX Binary  \x00). */
export function isStudioFbxBinary(bytes: Uint8Array): boolean {
  if (bytes.length < 23) return false;
  const magic = "Kaydara FBX Binary  ";
  for (let i = 0; i < magic.length; i += 1) {
    if (bytes[i] !== magic.charCodeAt(i)) return false;
  }
  return true;
}

/**
 * Pure-TS binary FBX mesh lite (Geometry Vertices + PolygonVertexIndex).
 * Skin/animation still deferred (grade B/C subset) — not a full ufbx clone.
 */
export function parseStudioFbxBinaryMeshLite(bytes: Uint8Array): {
  readonly positions: number[];
  readonly polygons: number[][];
  readonly version: number | null;
  readonly nodeCount: number;
  readonly unsupported: readonly { kind: string; reason: string }[];
} {
  const unsupported: { kind: string; reason: string }[] = [];
  if (!isStudioFbxBinary(bytes)) {
    return { positions: [], polygons: [], version: null, nodeCount: 0, unsupported: [{ kind: "format", reason: "not binary FBX" }] };
  }
  const sniff = sniffStudioFbxBinaryHeader(bytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // After 23-byte magic + 2 nulls + version(4) ≈ offset 27; some files pad to 27.
  let offset = 27;
  if (bytes.length > 26 && bytes[23] === 0x1a && bytes[24] === 0x00) {
    offset = 27;
  }
  let nodeCount = 0;
  let positions: number[] = [];
  let polygons: number[][] = [];

  /** FBX property type codes (common): Y/C/I/F/D/L/f/d/l/i/b/S/R */
  const readProperty = (o: number): { value: unknown; next: number } | null => {
    if (o >= bytes.length) return null;
    const type = String.fromCharCode(bytes[o]!);
    let p = o + 1;
    try {
      switch (type) {
        case "Y": // int16
          return { value: view.getInt16(p, true), next: p + 2 };
        case "C": // bool
          return { value: bytes[p] === 1, next: p + 1 };
        case "I": // int32
          return { value: view.getInt32(p, true), next: p + 4 };
        case "F": // float32
          return { value: view.getFloat32(p, true), next: p + 4 };
        case "D": // float64
          return { value: view.getFloat64(p, true), next: p + 8 };
        case "L": // int64
          return { value: Number(view.getBigInt64(p, true)), next: p + 8 };
        case "S":
        case "R": {
          const len = view.getUint32(p, true);
          p += 4;
          const raw = bytes.subarray(p, p + len);
          const value = type === "S" ? new TextDecoder().decode(raw) : raw;
          return { value, next: p + len };
        }
        case "f":
        case "d":
        case "l":
        case "i":
        case "b": {
          // array: length(u32), encoding(u32), compressedLen(u32), data
          const arrayLen = view.getUint32(p, true);
          const encoding = view.getUint32(p + 4, true);
          const compLen = view.getUint32(p + 8, true);
          p += 12;
          const elemSize = type === "f" || type === "i" ? 4 : type === "d" || type === "l" ? 8 : 1;
          const data = bytes.subarray(p, p + (encoding === 0 ? arrayLen * elemSize : compLen));
          p += encoding === 0 ? arrayLen * elemSize : compLen;
          if (encoding !== 0) {
            // zlib compressed arrays — leave as unsupported for lite path unless we inflate
            unsupported.push({
              kind: "fbx-binary-zlib",
              reason: `compressed ${type} array len=${arrayLen} (need inflate for full mesh)`,
            });
            return { value: [], next: p };
          }
          const out: number[] = [];
          const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
          for (let i = 0; i < arrayLen; i += 1) {
            if (type === "f") out.push(dv.getFloat32(i * 4, true));
            else if (type === "d") out.push(dv.getFloat64(i * 8, true));
            else if (type === "i") out.push(dv.getInt32(i * 4, true));
            else if (type === "l") out.push(Number(dv.getBigInt64(i * 8, true)));
            else out.push(data[i]!);
          }
          return { value: out, next: p };
        }
        default:
          return null;
      }
    } catch {
      return null;
    }
  };

  const parseNode = (o: number, depth: number): number => {
    if (o + 13 > bytes.length || depth > 64) return bytes.length;
    // FBX 7500+ uses 64-bit offsets; older 32-bit. Heuristic: version >= 7500 → 25-byte header.
    const version = sniff.version ?? 0;
    const large = version >= 7500;
    let endOffset: number;
    let numProps: number;
    let propListLen: number;
    let nameLen: number;
    let p: number;
    if (large) {
      if (o + 25 > bytes.length) return bytes.length;
      endOffset = Number(view.getBigUint64(o, true));
      numProps = Number(view.getBigUint64(o + 8, true));
      propListLen = Number(view.getBigUint64(o + 16, true));
      nameLen = bytes[o + 24]!;
      p = o + 25;
    } else {
      endOffset = view.getUint32(o, true);
      numProps = view.getUint32(o + 4, true);
      propListLen = view.getUint32(o + 8, true);
      nameLen = bytes[o + 12]!;
      p = o + 13;
    }
    // Null record terminator
    if (endOffset === 0) return o + (large ? 25 : 13);
    if (endOffset <= o || endOffset > bytes.length) return bytes.length;
    const name = new TextDecoder().decode(bytes.subarray(p, p + nameLen));
    p += nameLen;
    nodeCount += 1;
    const props: unknown[] = [];
    const propEnd = p + propListLen;
    for (let i = 0; i < numProps && p < propEnd; i += 1) {
      const pr = readProperty(p);
      if (!pr) break;
      props.push(pr.value);
      p = pr.next;
    }
    // Children until endOffset
    while (p + (large ? 25 : 13) < endOffset) {
      const before = p;
      p = parseNode(p, depth + 1);
      if (p <= before) break;
    }

    // Capture mesh arrays by property name conventions in nested Properties70 / direct Vertices nodes
    if (name === "Vertices" && Array.isArray(props[0])) {
      positions = props[0] as number[];
    }
    if ((name === "PolygonVertexIndex" || name === "Edges") && Array.isArray(props[0]) && name === "PolygonVertexIndex") {
      const idx = props[0] as number[];
      const poly: number[] = [];
      const polys: number[][] = [];
      for (const raw of idx) {
        if (raw < 0) {
          poly.push(~raw);
          if (poly.length >= 3) polys.push([...poly]);
          poly.length = 0;
        } else {
          poly.push(raw);
        }
      }
      if (polys.length) polygons = polys;
    }
    // Some exporters nest name as first string prop of a node named Geometry
    return endOffset;
  };

  // Walk top-level nodes
  while (offset + 13 < bytes.length) {
    const before = offset;
    offset = parseNode(offset, 0);
    if (offset <= before) break;
    // safety
    if (nodeCount > 50_000) break;
  }

  if (!positions.length || !polygons.length) {
    unsupported.push({
      kind: "fbx-binary-mesh",
      reason: `nodes=${nodeCount} verts=${positions.length / 3} polys=${polygons.length}; uncompressed Vertices/PolygonVertexIndex not found (zlib or exotic layout)`,
    });
  }
  if (bytes.length > 100) {
    // Always note skin/anim ceiling as grade note, not hard fail when mesh found
    unsupported.push({
      kind: "fbx-skin-anim",
      reason: "binary FBX skin/animation not imported in pure-TS lite (mesh path only)",
    });
  }

  return {
    positions,
    polygons,
    version: sniff.version,
    nodeCount,
    unsupported,
  };
}

/**
 * Unified FBX entry: ASCII mesh path, or binary mesh lite (uncompressed Vertices).
 */
export function importStudioFbxDocument(
  source: string | Uint8Array,
  options: { readonly parser?: string } = {},
): StudioFbxImportResult {
  if (typeof source !== "string" && isStudioFbxBinary(source)) {
    const sniff = sniffStudioFbxBinaryHeader(source);
    const parsed = parseStudioFbxBinaryMeshLite(source);
    if (parsed.positions.length >= 9 && parsed.polygons.length > 0) {
      const verts: StudioMeshVec3[] = [];
      for (let i = 0; i + 2 < parsed.positions.length; i += 3) {
        verts.push({
          x: parsed.positions[i]!,
          y: parsed.positions[i + 1]!,
          z: parsed.positions[i + 2]!,
        });
      }
      try {
        const mesh = createStudioEditableMeshFromPolygons(verts, parsed.polygons);
        const scene: StudioImportSceneIR = {
          format: "unknown",
          units: "cm",
          axis: "y-up",
          meshes: [
            {
              name: "fbx-binary-mesh",
              vertexCount: mesh.vertices.length,
              triangleCount: mesh.faces.length,
            },
          ],
          materials: [],
          textures: [],
          nodes: [{ name: "RootNode" }, { name: "fbx-binary-mesh", parent: "RootNode" }],
          bones: [],
          animations: [],
          morphTargets: [],
          unsupported: [...parsed.unsupported],
        };
        const report = buildStudioImportCompatibilityReport({
          parser: options.parser ?? "studio-fbx-binary-mesh-lite",
          sourceBytes: source,
          scene,
          committed: true,
        });
        const reportFbx: StudioImportCompatibilityReport = {
          ...report,
          fidelity: {
            ...report.fidelity,
            geometry: "B",
            material: "X",
            rigAnimation: "X",
            semanticHistory: "P",
          },
          warnings: [
            ...report.warnings,
            `Binary FBX v${sniff.version ?? "?"} mesh lite; skin/anim not imported`,
          ],
        };
        const header: StudioFbxAsciiHeader = {
          fbxVersion: sniff.version,
          headerVersion: null,
          creator: "binary-mesh-lite",
          geometryMeshCount: 1,
          modelCount: 1,
          hasLayerElementUV: false,
          hasDeformer: false,
        };
        return {
          ok: true,
          scene,
          report: reportFbx,
          commit: commitStudioImportToDocument(reportFbx, scene),
          meshes: [mesh],
          header,
        };
      } catch {
        // fall through to report-only failure path
      }
    }
    const report = buildStudioImportCompatibilityReport({
      parser: options.parser ?? "studio-fbx-binary-mesh-lite",
      sourceBytes: source,
      scene: {
        format: "unknown",
        units: "cm",
        axis: "y-up",
        meshes: [],
        materials: [],
        textures: [],
        nodes: [{ name: "RootNode" }],
        bones: [],
        animations: [],
        morphTargets: [],
        unsupported: [
          ...parsed.unsupported,
          {
            kind: "fbx-binary",
            reason: `Binary FBX v${sniff.version ?? "?"} nodes=${parsed.nodeCount}; mesh arrays missing or zlib-only`,
          },
        ],
      },
      committed: false,
    });
    return {
      ok: false,
      detail: `binary-fbx:${report.sourceHash}`,
      report: {
        ...report,
        fidelity: {
          ...report.fidelity,
          geometry: "P",
          material: "X",
          rigAnimation: "X",
          semanticHistory: "P",
        },
      },
      binary: sniff,
    };
  }
  return importStudioFbxAsciiDocument(source, options);
}

export function importStudioFbxAsciiDocument(
  source: string | Uint8Array,
  options: { readonly parser?: string } = {},
): StudioFbxImportResult {
  const text =
    typeof source === "string"
      ? source
      : new TextDecoder().decode(source);
  if (typeof source !== "string" && isStudioFbxBinary(source)) {
    return importStudioFbxDocument(source, options);
  }
  const parsed = parseStudioFbxAscii(text);
  if (parsed.positions.length < 9 || parsed.polygons.length === 0) {
    return {
      ok: false,
      detail: "ASCII FBX contained no importable mesh polygons",
      header: parsed.header,
    };
  }

  const verts: StudioMeshVec3[] = [];
  for (let i = 0; i + 2 < parsed.positions.length; i += 3) {
    verts.push({
      x: parsed.positions[i]!,
      y: parsed.positions[i + 1]!,
      z: parsed.positions[i + 2]!,
    });
  }

  const meshes: StudioEditableMesh[] = [];
  try {
    meshes.push(createStudioEditableMeshFromPolygons(verts, parsed.polygons));
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : "mesh rebuild failed",
    };
  }

  const triCount = parsed.polygons.reduce(
    (n, p) => n + Math.max(0, p.length - 2),
    0,
  );
  const scene: StudioImportSceneIR = {
    format: "unknown",
    units: "cm", // FBX often cm
    axis: "y-up",
    meshes: [
      {
        name: parsed.modelNames[0] ?? "fbx-mesh",
        vertexCount: verts.length,
        triangleCount: triCount,
      },
    ],
    materials: [],
    textures: [],
    nodes: [
      { name: "RootNode" },
      ...(parsed.modelNames.length
        ? parsed.modelNames.map((name) => ({ name, parent: "RootNode" }))
        : [{ name: "fbx-mesh", parent: "RootNode" }]),
    ],
    bones: [],
    animations: [],
    morphTargets: [],
    unsupported: [
      ...parsed.unsupported,
      {
        kind: "format-grade",
        reason: "ASCII FBX lite import — grade B; binary FBX uses Three FBXLoader bridge",
      },
    ],
  };
  // Tag as fbx-compatible for report: use format unknown → force via cast by setting meshes
  const sceneTagged = { ...scene, format: "obj" as const }; // closest mesh-only grade until format enum extended

  const report = buildStudioImportCompatibilityReport({
    parser: options.parser ?? "studio-fbx-ascii-import",
    sourceBytes: text,
    scene: {
      ...sceneTagged,
      format: "obj",
      unsupported: [
        ...(scene.unsupported ?? []),
        { kind: "fbx", reason: "Imported via ASCII FBX subset (not full FBX SDK)" },
      ],
    },
    committed: true,
  });
  // Override format label for consumers
  const reportFbx: StudioImportCompatibilityReport = {
    ...report,
    format: "unknown",
    warnings: [
      ...report.warnings,
      "FBX ASCII lite path (grade B). Binary FBX: convertStudioBg3dModelFilesToGlb / Three FBXLoader.",
      `ASCII header fbxVersion=${parsed.header.fbxVersion ?? "?"} geometryMeshCount=${parsed.header.geometryMeshCount} modelCount=${parsed.header.modelCount}`,
    ],
    fidelity: {
      ...report.fidelity,
      geometry: "B",
      material: "P",
      rigAnimation: parsed.header.hasDeformer ? "X" : "P",
      semanticHistory: "P",
    },
  };

  return {
    ok: true,
    scene: { ...scene, format: "unknown" },
    report: reportFbx,
    commit: commitStudioImportToDocument(reportFbx, { ...scene, format: "unknown" }),
    meshes,
    header: parsed.header,
  };
}

/** Minimal ASCII FBX triangle fixture generator for tests. */
export function createStudioAsciiFbxTriangleFixture(): string {
  return [
    "; FBX 7.4.0 project file",
    "FBXHeaderExtension:  {",
    "\tFBXHeaderVersion: 1003",
    "\tFBXVersion: 7400",
    "}",
    "Objects:  {",
    "\tGeometry: 1, \"Geometry::Triangle\", \"Mesh\" {",
    "\t\tVertices: *9 {",
    "\t\t\ta: 0,0,0,1,0,0,0,1,0",
    "\t\t}",
    "\t\tPolygonVertexIndex: *3 {",
    "\t\t\ta: 0,1,-3",
    "\t\t}",
    "\t}",
    "\tModel: 2, \"Model::Triangle\", \"Mesh\" {",
    "\t\tVersion: 232",
    "\t}",
    "}",
    "Connections:  {",
    "\tC: \"OO\",1,2",
    "\tC: \"OO\",2,0",
    "}",
  ].join("\n");
}
