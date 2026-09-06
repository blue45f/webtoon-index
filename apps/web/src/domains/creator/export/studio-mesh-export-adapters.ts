/**
 * Pure mesh export adapters — STL ASCII, OBJ, PLY ASCII from editable half-edge.
 * Complements import adapters; loss-report friendly (no materials/rig).
 */

import {
  studioEditableMeshToTriangleSoup,
  type StudioEditableMesh,
} from "../studio-editable-half-edge-mesh";
import { sha256HexPortable } from "../studio-sha256";

export const STUDIO_MESH_EXPORT_ADAPTERS_REVISION = 1 as const;

export type StudioMeshExportFormat = "stl" | "obj" | "ply";

export type StudioMeshExportResult = {
  readonly format: StudioMeshExportFormat;
  readonly text: string;
  readonly triangleCount: number;
  readonly vertexCount: number;
  readonly contentHash: `sha256:${string}`;
};

function soupStats(mesh: StudioEditableMesh) {
  const soup = studioEditableMeshToTriangleSoup(mesh);
  return {
    soup,
    vertexCount: soup.positions.length / 3,
    triangleCount: soup.indices.length / 3,
  };
}

function finish(
  format: StudioMeshExportFormat,
  text: string,
  vertexCount: number,
  triangleCount: number,
): StudioMeshExportResult {
  return {
    format,
    text,
    vertexCount,
    triangleCount,
    contentHash: `sha256:${sha256HexPortable(new TextEncoder().encode(text))}`,
  };
}

export function exportStudioMeshStlAscii(
  mesh: StudioEditableMesh,
  solidName = "toonspectrum",
): StudioMeshExportResult {
  const { soup, vertexCount, triangleCount } = soupStats(mesh);
  const lines = [`solid ${solidName}`];
  for (let t = 0; t < soup.indices.length; t += 3) {
    const ia = soup.indices[t]!;
    const ib = soup.indices[t + 1]!;
    const ic = soup.indices[t + 2]!;
    const ax = soup.positions[ia * 3]!;
    const ay = soup.positions[ia * 3 + 1]!;
    const az = soup.positions[ia * 3 + 2]!;
    const bx = soup.positions[ib * 3]!;
    const by = soup.positions[ib * 3 + 1]!;
    const bz = soup.positions[ib * 3 + 2]!;
    const cx = soup.positions[ic * 3]!;
    const cy = soup.positions[ic * 3 + 1]!;
    const cz = soup.positions[ic * 3 + 2]!;
    const ux = bx - ax;
    const uy = by - ay;
    const uz = bz - az;
    const vx = cx - ax;
    const vy = cy - ay;
    const vz = cz - az;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl;
    ny /= nl;
    nz /= nl;
    lines.push(` facet normal ${nx} ${ny} ${nz}`);
    lines.push("  outer loop");
    lines.push(`   vertex ${ax} ${ay} ${az}`);
    lines.push(`   vertex ${bx} ${by} ${bz}`);
    lines.push(`   vertex ${cx} ${cy} ${cz}`);
    lines.push("  endloop");
    lines.push(" endfacet");
  }
  lines.push(`endsolid ${solidName}`);
  return finish("stl", lines.join("\n"), vertexCount, triangleCount);
}

export function exportStudioMeshObj(
  mesh: StudioEditableMesh,
  objectName = "mesh",
): StudioMeshExportResult {
  const { soup, vertexCount, triangleCount } = soupStats(mesh);
  const lines = [`# ToonSpectrum OBJ export`, `o ${objectName}`];
  for (let i = 0; i < soup.positions.length; i += 3) {
    lines.push(
      `v ${soup.positions[i]!} ${soup.positions[i + 1]!} ${soup.positions[i + 2]!}`,
    );
  }
  for (let t = 0; t < soup.indices.length; t += 3) {
    // OBJ is 1-based
    lines.push(
      `f ${soup.indices[t]! + 1} ${soup.indices[t + 1]! + 1} ${soup.indices[t + 2]! + 1}`,
    );
  }
  return finish("obj", lines.join("\n"), vertexCount, triangleCount);
}

export function exportStudioMeshPlyAscii(mesh: StudioEditableMesh): StudioMeshExportResult {
  const { soup, vertexCount, triangleCount } = soupStats(mesh);
  const lines = [
    "ply",
    "format ascii 1.0",
    `element vertex ${vertexCount}`,
    "property float x",
    "property float y",
    "property float z",
    `element face ${triangleCount}`,
    "property list uchar int vertex_indices",
    "end_header",
  ];
  for (let i = 0; i < soup.positions.length; i += 3) {
    lines.push(
      `${soup.positions[i]!} ${soup.positions[i + 1]!} ${soup.positions[i + 2]!}`,
    );
  }
  for (let t = 0; t < soup.indices.length; t += 3) {
    lines.push(
      `3 ${soup.indices[t]!} ${soup.indices[t + 1]!} ${soup.indices[t + 2]!}`,
    );
  }
  return finish("ply", lines.join("\n"), vertexCount, triangleCount);
}

export function exportStudioMeshByFormat(
  mesh: StudioEditableMesh,
  format: StudioMeshExportFormat,
): StudioMeshExportResult {
  if (format === "stl") return exportStudioMeshStlAscii(mesh);
  if (format === "obj") return exportStudioMeshObj(mesh);
  return exportStudioMeshPlyAscii(mesh);
}
