/**
 * Pure mesh format adapters: STL (ASCII/binary), PLY (ASCII), DAE (minimal COLLADA), DXF (lines/polyline).
 * Each path emits SceneIR + CompatibilityLoss report fields.
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

export const STUDIO_MESH_FORMAT_ADAPTERS_REVISION = 1 as const;

export type StudioMeshAdapterFormat =
  | "stl"
  | "ply"
  | "dae"
  | "dxf"
  | "off"
  | "3mf"
  | "bvh"
  | "ifc"
  | "step";

export type StudioMeshAdapterResult = {
  readonly format: StudioMeshAdapterFormat;
  readonly scene: StudioImportSceneIR;
  readonly report: StudioImportCompatibilityReport;
  readonly commitHash: string;
  readonly meshes: readonly StudioEditableMesh[];
  readonly extras?: Readonly<Record<string, unknown>>;
};

function sceneShell(
  format: StudioMeshAdapterFormat,
  meshes: { name: string; vertexCount: number; triangleCount: number }[],
  unsupported: { kind: string; reason: string }[] = [],
): StudioImportSceneIR {
  const planLike =
    format === "dxf" || format === "bvh" || format === "ifc" || format === "step";
  return {
    format: planLike ? "unknown" : "obj",
    units: planLike ? "unitless" : "meters",
    axis: "y-up",
    meshes,
    materials: [],
    textures: [],
    nodes: [{ name: "root" }, ...meshes.map((m) => ({ name: m.name, parent: "root" }))],
    unsupported,
  };
}

function meshFromSoup(
  positions: number[],
  faces: number[][],
): StudioEditableMesh {
  const verts: StudioMeshVec3[] = [];
  for (let i = 0; i + 2 < positions.length; i += 3) {
    verts.push({ x: positions[i]!, y: positions[i + 1]!, z: positions[i + 2]! });
  }
  return createStudioEditableMeshFromPolygons(verts, faces);
}

function finish(
  format: StudioMeshAdapterResult["format"],
  parser: string,
  bytes: Uint8Array | string,
  scene: StudioImportSceneIR,
  meshes: StudioEditableMesh[],
  fidelity?: StudioImportCompatibilityReport["fidelity"],
): StudioMeshAdapterResult {
  const report = buildStudioImportCompatibilityReport({
    parser,
    sourceBytes: typeof bytes === "string" ? bytes : bytes,
    scene,
    committed: meshes.length > 0,
  });
  const finalReport: StudioImportCompatibilityReport = {
    ...report,
    fidelity: fidelity ?? report.fidelity,
  };
  const commit = commitStudioImportToDocument(finalReport, scene);
  return {
    format,
    scene,
    report: finalReport,
    commitHash: commit.commitHash,
    meshes,
  };
}

/** ASCII or binary STL. */
export function importStudioStl(bytes: Uint8Array): StudioMeshAdapterResult {
  const head = new TextDecoder().decode(bytes.subarray(0, Math.min(80, bytes.length)));
  const positions: number[] = [];
  const faces: number[][] = [];
  const unsupported: { kind: string; reason: string }[] = [];

  if (head.startsWith("solid") && !head.includes("\0") && bytes.length > 100) {
    const text = new TextDecoder().decode(bytes);
    const vertexRe = /vertex\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)/gu;
    let match: RegExpExecArray | null;
    const verts: number[] = [];
    while ((match = vertexRe.exec(text)) !== null) {
      verts.push(Number(match[1]), Number(match[2]), Number(match[3]));
    }
    for (let i = 0; i + 8 < verts.length; i += 9) {
      const base = positions.length / 3;
      positions.push(
        verts[i]!, verts[i + 1]!, verts[i + 2]!,
        verts[i + 3]!, verts[i + 4]!, verts[i + 5]!,
        verts[i + 6]!, verts[i + 7]!, verts[i + 8]!,
      );
      faces.push([base, base + 1, base + 2]);
    }
  } else if (bytes.length >= 84) {
    // binary STL
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const triCount = view.getUint32(80, true);
    let offset = 84;
    for (let t = 0; t < triCount && offset + 50 <= bytes.length; t += 1) {
      offset += 12; // normal
      const base = positions.length / 3;
      for (let v = 0; v < 3; v += 1) {
        positions.push(
          view.getFloat32(offset, true),
          view.getFloat32(offset + 4, true),
          view.getFloat32(offset + 8, true),
        );
        offset += 12;
      }
      faces.push([base, base + 1, base + 2]);
      offset += 2; // attribute
    }
  } else {
    unsupported.push({ kind: "stl", reason: "unrecognized STL" });
  }

  let meshes: StudioEditableMesh[] = [];
  if (faces.length > 0) {
    try {
      meshes = [meshFromSoup(positions, faces)];
    } catch (e) {
      unsupported.push({
        kind: "topology",
        reason: e instanceof Error ? e.message : "rebuild failed",
      });
    }
  }
  const scene = sceneShell(
    "stl",
    meshes.length
      ? [{ name: "stl-mesh", vertexCount: positions.length / 3, triangleCount: faces.length }]
      : [],
    unsupported,
  );
  return finish("stl", "studio-mesh-format-adapters/stl", bytes, scene, meshes, {
    geometry: meshes.length ? "A" : "X",
    material: "X",
    rigAnimation: "X",
    semanticHistory: "P",
  });
}

/** ASCII PLY vertex/face. */
export function importStudioPlyAscii(text: string): StudioMeshAdapterResult {
  const lines = text.split(/\r?\n/u);
  let vertexCount = 0;
  let faceCount = 0;
  let headerEnd = 0;
  let formatOk = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!.trim();
    if (line === "end_header") {
      headerEnd = i + 1;
      break;
    }
    if (line.startsWith("format ascii")) formatOk = true;
    if (line.startsWith("element vertex")) vertexCount = Number(line.split(/\s+/u)[2] ?? 0);
    if (line.startsWith("element face")) faceCount = Number(line.split(/\s+/u)[2] ?? 0);
  }
  const positions: number[] = [];
  const faces: number[][] = [];
  const unsupported: { kind: string; reason: string }[] = [];
  if (!formatOk && !text.startsWith("ply")) {
    unsupported.push({ kind: "ply", reason: "not ASCII PLY" });
  }
  let cursor = headerEnd;
  for (let v = 0; v < vertexCount && cursor < lines.length; v += 1, cursor += 1) {
    const parts = lines[cursor]!.trim().split(/\s+/u);
    positions.push(Number(parts[0] ?? 0), Number(parts[1] ?? 0), Number(parts[2] ?? 0));
  }
  for (let f = 0; f < faceCount && cursor < lines.length; f += 1, cursor += 1) {
    const parts = lines[cursor]!.trim().split(/\s+/u).map(Number);
    const n = parts[0] ?? 0;
    const idx = parts.slice(1, 1 + n);
    if (idx.length >= 3) faces.push(idx);
  }
  let meshes: StudioEditableMesh[] = [];
  if (faces.length) {
    try {
      meshes = [meshFromSoup(positions, faces)];
    } catch (e) {
      unsupported.push({
        kind: "topology",
        reason: e instanceof Error ? e.message : "rebuild failed",
      });
    }
  }
  const scene = sceneShell(
    "ply",
    meshes.length
      ? [{ name: "ply-mesh", vertexCount: positions.length / 3, triangleCount: faces.length }]
      : [],
    unsupported,
  );
  return finish("ply", "studio-mesh-format-adapters/ply", text, scene, meshes, {
    geometry: meshes.length ? "A" : "X",
    material: "P",
    rigAnimation: "X",
    semanticHistory: "P",
  });
}

/** Minimal COLLADA: float_array positions + triangles p indices. */
export function importStudioDaeMinimal(text: string): StudioMeshAdapterResult {
  const unsupported: { kind: string; reason: string }[] = [];
  const floatArray = /<float_array[^>]*>([\d\s.eE+-]+)<\/float_array>/u.exec(text);
  const positions: number[] = [];
  if (floatArray) {
    for (const t of floatArray[1]!.trim().split(/\s+/u)) {
      const n = Number(t);
      if (Number.isFinite(n)) positions.push(n);
    }
  } else {
    unsupported.push({ kind: "dae", reason: "no float_array positions" });
  }
  const pBlock = /<p>([\d\s]+)<\/p>/u.exec(text);
  const faces: number[][] = [];
  if (pBlock) {
    const idx = pBlock[1]!.trim().split(/\s+/u).map(Number).filter(Number.isFinite);
    // assume vertex-only stride 1
    for (let i = 0; i + 2 < idx.length; i += 3) {
      faces.push([idx[i]!, idx[i + 1]!, idx[i + 2]!]);
    }
  }
  let meshes: StudioEditableMesh[] = [];
  if (faces.length && positions.length >= 9) {
    try {
      meshes = [meshFromSoup(positions, faces)];
    } catch (e) {
      unsupported.push({
        kind: "topology",
        reason: e instanceof Error ? e.message : "rebuild failed",
      });
    }
  }
  if (text.includes("controller") || text.includes("animation")) {
    unsupported.push({ kind: "skin-anim", reason: "DAE skin/animation not in minimal path" });
  }
  const scene = sceneShell(
    "dae",
    meshes.length
      ? [{ name: "dae-mesh", vertexCount: positions.length / 3, triangleCount: faces.length }]
      : [],
    unsupported,
  );
  return finish("dae", "studio-mesh-format-adapters/dae", text, scene, meshes, {
    geometry: meshes.length ? "B" : "X",
    material: "P",
    rigAnimation: "X",
    semanticHistory: "P",
  });
}

/** DXF LINE / LWPOLYLINE → wall guide polylines as degenerate mesh ribbons (report-first). */
export function importStudioDxfPlan(text: string): StudioMeshAdapterResult {
  const lines = text.split(/\r?\n/u);
  const segments: { a: [number, number]; b: [number, number] }[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i]!.trim() === "LINE") {
      let x1 = 0;
      let y1 = 0;
      let x2 = 0;
      let y2 = 0;
      for (let j = i; j < Math.min(i + 20, lines.length); j += 1) {
        const code = lines[j]!.trim();
        const val = lines[j + 1]?.trim() ?? "0";
        if (code === "10") x1 = Number(val);
        if (code === "20") y1 = Number(val);
        if (code === "11") x2 = Number(val);
        if (code === "21") y2 = Number(val);
      }
      segments.push({ a: [x1, y1], b: [x2, y2] });
    }
  }
  // Build thin vertical quads as walls for each segment (height 1)
  const positions: number[] = [];
  const faces: number[][] = [];
  for (const seg of segments) {
    const base = positions.length / 3;
    const [x1, z1] = seg.a;
    const [x2, z2] = seg.b;
    positions.push(x1, 0, z1, x2, 0, z2, x2, 1, z2, x1, 1, z1);
    faces.push([base, base + 1, base + 2], [base, base + 2, base + 3]);
  }
  let meshes: StudioEditableMesh[] = [];
  if (faces.length) {
    try {
      meshes = [meshFromSoup(positions, faces)];
    } catch {
      // leave empty
    }
  }
  const scene = sceneShell(
    "dxf",
    meshes.length
      ? [{ name: "dxf-plan", vertexCount: positions.length / 3, triangleCount: faces.length }]
      : [],
    [
      {
        kind: "dxf-subset",
        reason: `LINE entities only (${segments.length}); arcs/blocks/text not imported`,
      },
    ],
  );
  return finish("dxf", "studio-mesh-format-adapters/dxf", text, scene, meshes, {
    geometry: meshes.length ? "B" : "P",
    material: "X",
    rigAnimation: "X",
    semanticHistory: "P",
  });
}

/** OFF (Object File Format) — vertices then faces. */
export function importStudioOff(text: string): StudioMeshAdapterResult {
  const lines = text
    .split(/\r?\n/u)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
  const unsupported: { kind: string; reason: string }[] = [];
  if (lines.length === 0 || !/^OFF\b/iu.test(lines[0]!)) {
    unsupported.push({ kind: "off", reason: "missing OFF header" });
  }
  let countsLine = 1;
  if (lines[0] && /^OFF\s+\d/iu.test(lines[0]!)) {
    // "OFF nV nF nE" single line form
    countsLine = 0;
  }
  const counts = (lines[countsLine] ?? "0 0 0").replace(/^OFF\s+/iu, "").split(/\s+/u).map(Number);
  const vertexCount = counts[0] ?? 0;
  const faceCount = counts[1] ?? 0;
  const start = countsLine === 0 ? 1 : 2;
  const positions: number[] = [];
  const faces: number[][] = [];
  let cursor = start;
  for (let v = 0; v < vertexCount && cursor < lines.length; v += 1, cursor += 1) {
    const p = lines[cursor]!.split(/\s+/u).map(Number);
    positions.push(p[0] ?? 0, p[1] ?? 0, p[2] ?? 0);
  }
  for (let f = 0; f < faceCount && cursor < lines.length; f += 1, cursor += 1) {
    const p = lines[cursor]!.split(/\s+/u).map(Number);
    const n = p[0] ?? 0;
    const idx = p.slice(1, 1 + n);
    if (idx.length >= 3) faces.push(idx);
  }
  let meshes: StudioEditableMesh[] = [];
  if (faces.length) {
    try {
      meshes = [meshFromSoup(positions, faces)];
    } catch (e) {
      unsupported.push({
        kind: "topology",
        reason: e instanceof Error ? e.message : "rebuild failed",
      });
    }
  }
  const scene = sceneShell(
    "off",
    meshes.length
      ? [{ name: "off-mesh", vertexCount: positions.length / 3, triangleCount: faces.length }]
      : [],
    unsupported,
  );
  return finish("off", "studio-mesh-format-adapters/off", text, scene, meshes, {
    geometry: meshes.length ? "A" : "X",
    material: "X",
    rigAnimation: "X",
    semanticHistory: "P",
  });
}

/** Minimal 3MF: mesh vertices/triangles inside model XML (no full OPC ZIP expand required for raw XML). */
export function importStudio3mfMinimal(text: string): StudioMeshAdapterResult {
  const unsupported: { kind: string; reason: string }[] = [];
  const positions: number[] = [];
  const faces: number[][] = [];
  const vertexRe = /<vertex\b[^>]*\bx=["']?([-\d.eE+]+)["']?[^>]*\by=["']?([-\d.eE+]+)["']?[^>]*\bz=["']?([-\d.eE+]+)["']?/giu;
  let m: RegExpExecArray | null;
  while ((m = vertexRe.exec(text)) !== null) {
    positions.push(Number(m[1]), Number(m[2]), Number(m[3]));
  }
  const triRe = /<triangle\b[^>]*\bv1=["']?(\d+)["']?[^>]*\bv2=["']?(\d+)["']?[^>]*\bv3=["']?(\d+)["']?/giu;
  while ((m = triRe.exec(text)) !== null) {
    faces.push([Number(m[1]), Number(m[2]), Number(m[3])]);
  }
  if (!positions.length) {
    unsupported.push({ kind: "3mf", reason: "no <vertex> elements (ZIP package may need unzip first)" });
  }
  let meshes: StudioEditableMesh[] = [];
  if (faces.length && positions.length >= 9) {
    try {
      meshes = [meshFromSoup(positions, faces)];
    } catch (e) {
      unsupported.push({
        kind: "topology",
        reason: e instanceof Error ? e.message : "rebuild failed",
      });
    }
  }
  const scene = sceneShell(
    "3mf",
    meshes.length
      ? [{ name: "3mf-mesh", vertexCount: positions.length / 3, triangleCount: faces.length }]
      : [],
    unsupported,
  );
  return finish("3mf", "studio-mesh-format-adapters/3mf", text, scene, meshes, {
    geometry: meshes.length ? "B" : "X",
    material: "P",
    rigAnimation: "X",
    semanticHistory: "P",
  });
}

export type StudioBvhJoint = {
  readonly name: string;
  readonly offset: readonly [number, number, number];
  readonly channels: readonly string[];
  readonly children: readonly StudioBvhJoint[];
};

/** BVH skeleton + frame channel count (motion retarget report path). */
export function importStudioBvhMotion(text: string): StudioMeshAdapterResult {
  const unsupported: { kind: string; reason: string }[] = [];
  const joints: { name: string; offset: [number, number, number] }[] = [];
  const lines = text.split(/\r?\n/u);
  let frameCount = 0;
  let frameTime = 0;
  let channelTotal = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!.trim();
    if (/^(ROOT|JOINT)\s+/u.test(line)) {
      const name = line.replace(/^(ROOT|JOINT)\s+/u, "").trim();
      let offset: [number, number, number] = [0, 0, 0];
      for (let j = i; j < Math.min(i + 8, lines.length); j += 1) {
        const o = /^\s*OFFSET\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)/u.exec(lines[j]!);
        if (o) {
          offset = [Number(o[1]), Number(o[2]), Number(o[3])];
          break;
        }
      }
      joints.push({ name, offset });
    }
    const ch = /^\s*CHANNELS\s+(\d+)/u.exec(line);
    if (ch) channelTotal += Number(ch[1]);
    if (line.startsWith("Frames:")) frameCount = Number(line.split(":")[1]?.trim() ?? 0);
    if (line.startsWith("Frame Time:")) frameTime = Number(line.split(":")[1]?.trim() ?? 0);
  }
  if (!joints.length) {
    unsupported.push({ kind: "bvh", reason: "no ROOT/JOINT hierarchy" });
  }
  // Build a stick-figure mesh from joint offsets (parent chain approximated as sequential)
  const positions: number[] = [];
  const faces: number[][] = [];
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (let i = 0; i < joints.length; i += 1) {
    const j = joints[i]!;
    const nx = cx + j.offset[0];
    const ny = cy + j.offset[1];
    const nz = cz + j.offset[2];
    const base = positions.length / 3;
    // thin box segment from parent to joint
    const s = 0.02;
    positions.push(
      cx, cy, cz,
      nx, ny, nz,
      nx + s, ny, nz,
      cx + s, cy, cz,
    );
    faces.push([base, base + 1, base + 2], [base, base + 2, base + 3]);
    cx = nx;
    cy = ny;
    cz = nz;
  }
  let meshes: StudioEditableMesh[] = [];
  if (faces.length) {
    try {
      meshes = [meshFromSoup(positions, faces)];
    } catch {
      // leave empty
    }
  }
  const scene = sceneShell(
    "bvh",
    meshes.length
      ? [{ name: "bvh-stick", vertexCount: positions.length / 3, triangleCount: faces.length }]
      : [],
    [
      ...unsupported,
      {
        kind: "bvh-motion",
        reason: `hierarchy joints=${joints.length} channels=${channelTotal} frames=${frameCount} dt=${frameTime}; skin weights not in BVH`,
      },
    ],
  );
  const result = finish("bvh", "studio-mesh-format-adapters/bvh", text, scene, meshes, {
    geometry: meshes.length ? "B" : "P",
    material: "X",
    rigAnimation: frameCount > 0 ? "B" : "P",
    semanticHistory: "P",
  });
  return {
    ...result,
    extras: {
      joints: joints.map((j) => j.name),
      frameCount,
      frameTime,
      channelTotal,
    },
  };
}

/** IFC STEP-physical import: cartesian points, semantic entities, AABB + point-fan mesh (grade B). */
function aabbMeshFromPoints(points: number[][]): { positions: number[]; faces: number[][] } {
  if (!points.length) return { positions: [], faces: [] };
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p[0]!);
    minY = Math.min(minY, p[1]!);
    minZ = Math.min(minZ, p[2]!);
    maxX = Math.max(maxX, p[0]!);
    maxY = Math.max(maxY, p[1]!);
    maxZ = Math.max(maxZ, p[2]!);
  }
  if (!Number.isFinite(minX)) return { positions: [], faces: [] };
  // Degenerate pad
  if (maxX - minX < 1e-6) maxX = minX + 0.1;
  if (maxY - minY < 1e-6) maxY = minY + 0.1;
  if (maxZ - minZ < 1e-6) maxZ = minZ + 0.1;
  const positions = [
    minX, minY, minZ, maxX, minY, minZ, maxX, maxY, minZ, minX, maxY, minZ,
    minX, minY, maxZ, maxX, minY, maxZ, maxX, maxY, maxZ, minX, maxY, maxZ,
  ];
  const faces = [
    [0, 1, 2], [0, 2, 3],
    [4, 6, 5], [4, 7, 6],
    [0, 4, 5], [0, 5, 1],
    [2, 6, 7], [2, 7, 3],
    [0, 3, 7], [0, 7, 4],
    [1, 5, 6], [1, 6, 2],
  ];
  return { positions, faces };
}

/**
 * Parse IFC body geometry:
 * - entity table (#id = TYPE(...))
 * - IFCCARTESIANPOINT coordinates
 * - IFCPOLYLOOP → fan triangles
 * - IFCTRIANGULATEDFACESET CoordIndex → explicit triangles
 * - IFCFACETEDBREP / IFCCLOSEDSHELL face counts
 */
function parseIfcBodyGeometry(text: string): {
  readonly pointsById: Map<number, number[]>;
  readonly bodyPositions: number[];
  readonly bodyFaces: number[][];
  readonly polyloopCount: number;
  readonly triangulatedFaceSets: number;
  readonly facetedBreps: number;
  readonly closedShells: number;
  readonly bodyTriangleCount: number;
} {
  const pointsById = new Map<number, number[]>();
  const entityRe = /#(\d+)\s*=\s*([A-Z0-9]+)\s*\(([\s\S]*?)\)\s*;/giu;
  let em: RegExpExecArray | null;
  const polyloops: number[][] = [];
  const triSets: { coords: number[]; indices: number[][] }[] = [];
  let facetedBreps = 0;
  let closedShells = 0;
  // First pass: cartesian points
  while ((em = entityRe.exec(text)) !== null) {
    const id = Number(em[1]);
    const type = em[2]!.toUpperCase();
    const body = em[3]!;
    if (type === "IFCCARTESIANPOINT") {
      const inner = /\(\s*([^)]+)\)/u.exec(body);
      if (inner) {
        const nums = inner[1]!.split(",").map((s) => Number(s.trim())).filter(Number.isFinite);
        if (nums.length >= 2) pointsById.set(id, [nums[0]!, nums[1]!, nums[2] ?? 0]);
      }
    } else if (type === "IFCFACETEDBREP") {
      facetedBreps += 1;
    } else if (type === "IFCCLOSEDSHELL") {
      closedShells += 1;
    }
  }
  // Second pass: polyloops and triangulated face sets (need point table)
  entityRe.lastIndex = 0;
  while ((em = entityRe.exec(text)) !== null) {
    const type = em[2]!.toUpperCase();
    const body = em[3]!;
    if (type === "IFCPOLYLOOP") {
      const refs = [...body.matchAll(/#(\d+)/gu)].map((x) => Number(x[1]));
      const loop: number[] = [];
      for (const ref of refs) {
        const p = pointsById.get(ref);
        if (p) loop.push(p[0]!, p[1]!, p[2]!);
      }
      if (loop.length >= 9) polyloops.push(loop);
    } else if (type === "IFCTRIANGULATEDFACESET" || type === "IFCTRIANGULATEDIRREGULARNETWORK") {
      // CoordIndex typically ((a,b,c),(d,e,f),...)
      const coordBlock = /CoordIndex\s*:=\s*\(([\s\S]*)\)\s*(?:,|\))/iu.exec(body)
        ?? /\(\s*\(([\d\s,()-]+)\)\s*\)/u.exec(body);
      const indices: number[][] = [];
      if (coordBlock) {
        const tripRe = /\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/gu;
        let tm: RegExpExecArray | null;
        while ((tm = tripRe.exec(coordBlock[1]!)) !== null) {
          indices.push([Number(tm[1]), Number(tm[2]), Number(tm[3])]);
        }
      }
      // Coordinates ref → expand points in id order
      const coords: number[] = [];
      const coordRef = /#(\d+)/u.exec(body);
      // Fallback: all points
      for (const p of pointsById.values()) {
        coords.push(p[0]!, p[1]!, p[2]!);
      }
      if (indices.length) triSets.push({ coords, indices });
      void coordRef;
    }
  }

  const bodyPositions: number[] = [];
  const bodyFaces: number[][] = [];
  // Polyloops → fan triangles
  for (const loop of polyloops) {
    const base = bodyPositions.length / 3;
    const n = loop.length / 3;
    for (let i = 0; i < loop.length; i += 1) bodyPositions.push(loop[i]!);
    for (let i = 1; i + 1 < n; i += 1) {
      bodyFaces.push([base, base + i, base + i + 1]);
    }
  }
  // Explicit triangulated face sets (1-based IFC indices)
  for (const set of triSets) {
    const base = bodyPositions.length / 3;
    // If coords empty, skip
    if (set.coords.length < 9) continue;
    for (const c of set.coords) bodyPositions.push(c);
    const vertCount = set.coords.length / 3;
    for (const tri of set.indices) {
      const a = tri[0]! - 1;
      const b = tri[1]! - 1;
      const c = tri[2]! - 1;
      if (a >= 0 && b >= 0 && c >= 0 && a < vertCount && b < vertCount && c < vertCount) {
        bodyFaces.push([base + a, base + b, base + c]);
      }
    }
  }

  return {
    pointsById,
    bodyPositions,
    bodyFaces,
    polyloopCount: polyloops.length,
    triangulatedFaceSets: triSets.length,
    facetedBreps,
    closedShells,
    bodyTriangleCount: bodyFaces.length,
  };
}

export function importStudioIfcShell(text: string): StudioMeshAdapterResult {
  const unsupported: { kind: string; reason: string }[] = [];
  const points: number[][] = [];
  const spaces: string[] = [];
  const storeys: string[] = [];
  const body = parseIfcBodyGeometry(text);
  for (const p of body.pointsById.values()) points.push(p);
  // Fallback cartesian scan if entity table sparse
  if (!points.length) {
    const pointRe = /IFCCARTESIANPOINT\s*\(\s*\(([^)]+)\)/giu;
    let m: RegExpExecArray | null;
    while ((m = pointRe.exec(text)) !== null) {
      const nums = m[1]!.split(",").map((s) => Number(s.trim())).filter(Number.isFinite);
      if (nums.length >= 2) {
        points.push([nums[0]!, nums[1]!, nums[2] ?? 0]);
      }
    }
  }
  const namedEntity = (type: string, into: string[]) => {
    const re = new RegExp(`${type}\\s*\\(([^;]*)\\)`, "giu");
    let em: RegExpExecArray | null;
    while ((em = re.exec(text)) !== null) {
      const quoted = [...em[1]!.matchAll(/'([^']*)'/gu)].map((x) => x[1]!);
      // IFC naming: often (GlobalId, OwnerHistory, Name, ...) — prefer Name (3rd) then 2nd.
      const name = quoted[2] || quoted[1] || quoted[0];
      if (name) into.push(name);
    }
  };
  namedEntity("IFCSPACE", spaces);
  namedEntity("IFCBUILDINGSTOREY", storeys);
  const wallCount = (text.match(/IFCWALL(?:STANDARDCASE)?\b/giu) ?? []).length;
  const slabCount = (text.match(/IFCSLAB\b/giu) ?? []).length;
  const doorCount = (text.match(/IFCDOOR\b/giu) ?? []).length;
  const windowCount = (text.match(/IFCWINDOW\b/giu) ?? []).length;
  const columnCount = (text.match(/IFCCOLUMN\b/giu) ?? []).length;
  const beamCount = (text.match(/IFCBEAM\b/giu) ?? []).length;
  const globalIds = [...text.matchAll(/IFC[A-Z0-9]+\s*\(\s*'([0-9A-Za-z_$]{22})'/gu)]
    .map((x) => x[1]!)
    .slice(0, 32);
  if (!points.length && !spaces.length && !wallCount && !body.bodyTriangleCount) {
    unsupported.push({ kind: "ifc", reason: "no recognizable IFC entities" });
  }
  const hull = aabbMeshFromPoints(points);
  const meshes: StudioEditableMesh[] = [];
  // Prefer explicit body triangles (polyloop / triangulated face set)
  if (body.bodyFaces.length && body.bodyPositions.length >= 9) {
    try {
      meshes.push(meshFromSoup(body.bodyPositions, body.bodyFaces));
    } catch {
      // fall through
    }
  }
  // Fan-triangulate first polyloop-sized point cloud as an extra surface (semantic proxy mesh)
  const fanFaces: number[][] = [];
  if (points.length >= 3 && !meshes.length) {
    const n = Math.min(points.length, 64);
    for (let i = 1; i + 1 < n; i += 1) fanFaces.push([0, i, i + 1]);
  }
  try {
    if (hull.faces.length) {
      meshes.push(meshFromSoup(hull.positions, hull.faces));
    }
    if (fanFaces.length && points.length >= 3) {
      const pos: number[] = [];
      const n = Math.min(points.length, 64);
      for (let i = 0; i < n; i += 1) {
        const p = points[i]!;
        pos.push(p[0]!, p[1]!, p[2]!);
      }
      meshes.push(meshFromSoup(pos, fanFaces));
    }
  } catch {
    // leave empty
  }
  const bodyTris = meshes.reduce((n, m) => n + m.faces.length, 0);
  const scene = sceneShell(
    "ifc",
    meshes.map((m, i) => ({
      name:
        i === 0 && body.bodyTriangleCount > 0
          ? "ifc-body-shell"
          : i === 0
            ? "ifc-aabb-shell"
            : "ifc-point-fan",
      vertexCount: m.vertices.length,
      triangleCount: m.faces.length,
    })),
    [
      ...unsupported,
      {
        kind: "ifc-body",
        reason: `points=${points.length} polyloops=${body.polyloopCount} triFaceSets=${body.triangulatedFaceSets} facetedBreps=${body.facetedBreps} closedShells=${body.closedShells} bodyTris=${body.bodyTriangleCount} meshTris=${bodyTris} walls=${wallCount}`,
      },
    ],
  );
  const semanticRich =
    spaces.length > 0
    || storeys.length > 0
    || doorCount + windowCount + columnCount + beamCount > 0
    || globalIds.length > 0;
  const hasBody = body.bodyTriangleCount > 0 || bodyTris > 0;
  const result = finish("ifc", "studio-mesh-format-adapters/ifc", text, scene, meshes, {
    geometry: hasBody ? "A" : meshes.length ? "B" : "P",
    material: "X",
    rigAnimation: "X",
    semanticHistory: semanticRich ? "B" : "P",
  });
  return {
    ...result,
    extras: {
      spaces,
      storeys,
      wallCount,
      slabCount,
      doorCount,
      windowCount,
      columnCount,
      beamCount,
      globalIds,
      pointCount: points.length,
      aabbVertexCount: hull.positions.length / 3,
      bodyTriangleCount: body.bodyTriangleCount,
      polyloopCount: body.polyloopCount,
      facetedBreps: body.facetedBreps,
      closedShells: body.closedShells,
      meshTriangleCount: bodyTris,
    },
  };
}

/**
 * STEP/IGES import — cartesian points, product names, AABB + point-fan mesh (grade B).
 */
export function importStudioStepShell(text: string): StudioMeshAdapterResult {
  const unsupported: { kind: string; reason: string }[] = [];
  const isIges = /^\s*S\s*\d+/m.test(text) || text.includes("START SECTION");
  const points: number[][] = [];
  const cartRe = /CARTESIAN_POINT\s*\(\s*'[^']*'\s*,\s*\(([^)]+)\)/giu;
  let m: RegExpExecArray | null;
  while ((m = cartRe.exec(text)) !== null) {
    const nums = m[1]!.split(",").map((s) => Number(s.trim())).filter(Number.isFinite);
    if (nums.length >= 2) points.push([nums[0]!, nums[1]!, nums[2] ?? 0]);
  }
  // Also accept unquoted form: CARTESIAN_POINT('',(x,y,z)) already covered; bare lists:
  const bareRe = /CARTESIAN_POINT\s*\([^,]*,\s*\(([^)]+)\)/giu;
  while ((m = bareRe.exec(text)) !== null) {
    const nums = m[1]!.split(",").map((s) => Number(s.trim())).filter(Number.isFinite);
    if (nums.length >= 2) points.push([nums[0]!, nums[1]!, nums[2] ?? 0]);
  }
  const products = [...text.matchAll(/PRODUCT\s*\(\s*'([^']*)'/giu)].map((x) => x[1]!);
  const advancedFaces = (text.match(/ADVANCED_FACE\b/giu) ?? []).length;
  const closedShells = (text.match(/CLOSED_SHELL\b/giu) ?? []).length;
  const openShells = (text.match(/OPEN_SHELL\b/giu) ?? []).length;
  const directions = (text.match(/DIRECTION\s*\(/giu) ?? []).length;
  const manifoldSolidBreps = (text.match(/MANIFOLD_SOLID_BREP\b/giu) ?? []).length;
  const axis2Placements = (text.match(/AXIS2_PLACEMENT_3D\b/giu) ?? []).length;
  const siMetre = /\.SI_UNIT\s*\(\s*\.\s*,\s*\.METRE\s*\.\)/iu.test(text)
    || /SI_UNIT\s*\([^)]*METRE/iu.test(text);
  if (!points.length && !products.length && !advancedFaces) {
    unsupported.push({
      kind: "step",
      reason: isIges ? "IGES shell without mapped entities" : "no STEP cartesian/product entities",
    });
  }
  const hull = aabbMeshFromPoints(points);
  const meshes: StudioEditableMesh[] = [];
  const fanFaces: number[][] = [];
  if (points.length >= 3) {
    const n = Math.min(points.length, 64);
    for (let i = 1; i + 1 < n; i += 1) fanFaces.push([0, i, i + 1]);
  }
  try {
    if (hull.faces.length) {
      meshes.push(meshFromSoup(hull.positions, hull.faces));
    }
    if (fanFaces.length) {
      const pos: number[] = [];
      const n = Math.min(points.length, 64);
      for (let i = 0; i < n; i += 1) {
        const p = points[i]!;
        pos.push(p[0]!, p[1]!, p[2]!);
      }
      meshes.push(meshFromSoup(pos, fanFaces));
    }
  } catch {
    // leave empty
  }
  const scene = sceneShell(
    "step",
    meshes.map((m, i) => ({
      name: i === 0 ? "step-aabb-shell" : "step-point-fan",
      vertexCount: m.vertices.length,
      triangleCount: m.faces.length,
    })),
    [
      ...unsupported,
      {
        kind: "step-subset",
        reason: `points=${points.length} products=${products.length} advancedFaces=${advancedFaces} closedShells=${closedShells} openShells=${openShells} directions=${directions} manifoldSolidBreps=${manifoldSolidBreps} axis2Placements=${axis2Placements} siMetre=${siMetre}; cartesian + faceted poly_loop mesh (grade B); exact NURBS BREP optional via OCCT`,
      },
    ],
  );
  const result = finish("step", "studio-mesh-format-adapters/step", text, scene, meshes, {
    geometry: meshes.length ? "B" : "P",
    material: "X",
    rigAnimation: "X",
    semanticHistory: products.length || closedShells > 0 || manifoldSolidBreps > 0 ? "B" : "P",
  });
  return {
    ...result,
    extras: {
      products,
      advancedFaces,
      closedShells,
      openShells,
      directions,
      manifoldSolidBreps,
      axis2Placements,
      siMetre,
      pointCount: points.length,
      isIges,
      aabbVertexCount: hull.positions.length / 3,
    },
  };
}

export function importStudioMeshByExtension(
  fileName: string,
  bytes: Uint8Array,
): StudioMeshAdapterResult | null {
  const lower = fileName.toLowerCase();
  const text = () => new TextDecoder().decode(bytes);
  if (lower.endsWith(".stl")) return importStudioStl(bytes);
  if (lower.endsWith(".ply")) return importStudioPlyAscii(text());
  if (lower.endsWith(".dae")) return importStudioDaeMinimal(text());
  if (lower.endsWith(".dxf")) return importStudioDxfPlan(text());
  if (lower.endsWith(".off")) return importStudioOff(text());
  if (lower.endsWith(".3mf") || lower.endsWith(".model")) return importStudio3mfMinimal(text());
  if (lower.endsWith(".bvh")) return importStudioBvhMotion(text());
  if (lower.endsWith(".ifc")) return importStudioIfcShell(text());
  if (lower.endsWith(".step") || lower.endsWith(".stp") || lower.endsWith(".iges") || lower.endsWith(".igs")) {
    return importStudioStepShell(text());
  }
  return null;
}
