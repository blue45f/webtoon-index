/**
 * Industrial IFC city / multi-building body geometry via ThatOpen web-ifc WASM.
 * Streams tessellated meshes for walls/slabs/spaces/columns — city-scale, not header-only.
 */

import {
  createStudioEditableMeshFromPolygons,
  type StudioEditableMesh,
  type StudioMeshVec3,
} from "./studio-editable-half-edge-mesh";

export const STUDIO_WEB_IFC_CITY_REVISION = 3 as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type WebIfcApi = any;

type StudioWebIfcRuntime = {
  readonly api: WebIfcApi;
  readonly module: Record<string, unknown>;
  readonly loadPath: "browser" | "node";
};

let cachedRuntime: StudioWebIfcRuntime | null = null;
let cachedPromise: Promise<StudioWebIfcRuntime> | null = null;

function isNodeHost(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = (globalThis as any).process?.versions?.node;
    return typeof v === "string" && v.length > 0;
  } catch {
    return false;
  }
}

function disposeWebIfcObject(candidate: unknown): void {
  const disposer = (candidate as { delete?: unknown } | null)?.delete;
  if (typeof disposer !== "function") return;
  try {
    disposer.call(candidate);
  } catch {
    // Best effort for generated WASM wrappers.
  }
}

function v(x: number, y: number, z: number): StudioMeshVec3 {
  return { x, y, z };
}

function soupToMesh(positions: number[], indices: number[]): StudioEditableMesh {
  const verts: StudioMeshVec3[] = [];
  for (let i = 0; i < positions.length; i += 3) {
    verts.push(v(positions[i]!, positions[i + 1]!, positions[i + 2]!));
  }
  const faces: number[][] = [];
  for (let i = 0; i + 2 < indices.length; i += 3) {
    faces.push([indices[i]!, indices[i + 1]!, indices[i + 2]!]);
  }
  return createStudioEditableMeshFromPolygons(verts, faces);
}

/** Load web-ifc runtime (Node uses web-ifc-node.wasm; browser uses web-ifc.wasm). */
async function loadStudioWebIfcRuntime(): Promise<StudioWebIfcRuntime> {
  if (cachedRuntime) return cachedRuntime;
  if (cachedPromise) return cachedPromise;
  cachedPromise = (async () => {
    if (isNodeHost()) {
      // Keep node:* and the node WASM resolver completely outside Vite's browser graph.
      const nodeLoaderModuleId = "./studio-web-ifc-node-loader";
      const { loadStudioWebIfcRuntimeFromNode } = await import(
        /* @vite-ignore */ nodeLoaderModuleId
      ) as typeof import("./studio-web-ifc-node-loader");
      const loaded = await loadStudioWebIfcRuntimeFromNode();
      cachedRuntime = loaded;
      return loaded;
    }
    const WebIFC = await import("web-ifc");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = new (WebIFC as any).IfcAPI();
    let wasmUrl = "/node_modules/web-ifc/web-ifc.wasm";
    try {
      const urlMod = await import("web-ifc/web-ifc.wasm?url");
      const url = (urlMod as { default?: string }).default;
      if (url) {
        wasmUrl = url;
      }
    } catch {
      // keep fallback
    }
    const slash = wasmUrl.lastIndexOf("/");
    const wasmPath = slash >= 0 ? wasmUrl.slice(0, slash + 1) : "/";
    api.SetWasmPath(wasmPath, true);
    await api.Init(
      (file: string) => (file.endsWith("web-ifc.wasm") ? wasmUrl : file),
      true,
    );
    const runtime: StudioWebIfcRuntime = {
      api,
      module: WebIFC as unknown as Record<string, unknown>,
      loadPath: "browser",
    };
    cachedRuntime = runtime;
    return runtime;
  })();
  try {
    return await cachedPromise;
  } catch (error) {
    cachedPromise = null;
    throw error;
  }
}

/** Backward-compatible API-only accessor for existing importers and tests. */
export async function loadStudioWebIfcApi(): Promise<WebIfcApi> {
  return (await loadStudioWebIfcRuntime()).api;
}

export function resetStudioWebIfcForTests(): void {
  try {
    cachedRuntime?.api?.Dispose?.();
  } catch {
    // The runtime may already have been disposed by the host.
  }
  cachedRuntime = null;
  cachedPromise = null;
}

/** Install a deterministic runtime for unit tests without loading the WASM binary. */
export function installStudioWebIfcRuntimeForTests(
  api: WebIfcApi,
  module: Record<string, unknown> = {},
): void {
  resetStudioWebIfcForTests();
  cachedRuntime = { api, module, loadPath: "node" };
}

export type StudioWebIfcCityResult = {
  readonly ok: true;
  readonly backend: "web-ifc";
  readonly modelId: number;
  readonly meshCount: number;
  readonly vertexCount: number;
  readonly triangleCount: number;
  readonly wallCount: number;
  readonly slabCount: number;
  readonly spaceCount: number;
  readonly storeyCount: number;
  readonly buildingCount: number;
  readonly columnCount: number;
  readonly siteCount: number;
  readonly meshes: readonly StudioEditableMesh[];
  readonly geometryGrade: "A";
  readonly cityScale: true;
  readonly bbox: readonly [number, number, number, number, number, number];
  readonly footprintAreaApprox: number;
};

/**
 * Import IFC bytes with full body tessellation (city/building scale).
 * Uses StreamAllMeshes — not cartesian-point AABB proxy.
 * Applies flat transform matrix when web-ifc provides one.
 */
export async function importStudioIfcCity(
  source: string | Uint8Array,
): Promise<StudioWebIfcCityResult | { readonly ok: false; readonly code: string; readonly detail: string }> {
  let api: WebIfcApi | null = null;
  let openedModelId: number | null = null;
  try {
    const runtime = await loadStudioWebIfcRuntime();
    const webIfcApi = runtime.api;
    api = webIfcApi;
    const bytes =
      typeof source === "string" ? new TextEncoder().encode(source) : source;
    const modelId = webIfcApi.OpenModel(bytes) as number;
    openedModelId = modelId;
    const meshes: StudioEditableMesh[] = [];
    let vertexCount = 0;
    let triangleCount = 0;
    let meshCount = 0;
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;

    const applyFlatMatrix = (
      x: number,
      y: number,
      z: number,
      m: ArrayLike<number> | null,
    ): [number, number, number] => {
      if (!m || m.length < 16) return [x, y, z];
      // column-major 4x4
      const nx = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!;
      const ny = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!;
      const nz = m[2]! * x + m[6]! * y + m[10]! * z + m[14]!;
      return [nx, ny, nz];
    };

    webIfcApi.StreamAllMeshes(modelId, (mesh: {
      geometries: {
        size: () => number;
        get: (i: number) => {
          geometryExpressID: number;
          flatTransformation?: ArrayLike<number>;
          color?: { x: number; y: number; z: number; w: number };
        };
      };
    }) => {
      meshCount += 1;
      const geoms = mesh.geometries;
      try {
        const n = geoms.size();
        for (let i = 0; i < n; i += 1) {
          const placed = geoms.get(i);
          const geom = webIfcApi.GetGeometry(modelId, placed.geometryExpressID);
          try {
            const verts = webIfcApi.GetVertexArray(
              geom.GetVertexData(),
              geom.GetVertexDataSize(),
            ) as Float32Array | number[];
            const indices = webIfcApi.GetIndexArray(
              geom.GetIndexData(),
              geom.GetIndexDataSize(),
            ) as Uint32Array | number[];
            const pos: number[] = [];
            const arr = verts instanceof Float32Array ? verts : Float32Array.from(verts);
            const stride = arr.length % 6 === 0
              && arr.length % 3 === 0
              && arr.length / 6 >= 3
              ? 6
              : 3;
            const flat = placed.flatTransformation
              ?? (placed as { transformation?: ArrayLike<number> }).transformation
              ?? null;
            for (let k = 0; k + 2 < arr.length; k += stride) {
              const [x, y, z] = applyFlatMatrix(
                arr[k]!,
                arr[k + 1]!,
                arr[k + 2]!,
                flat as ArrayLike<number> | null,
              );
              pos.push(x, y, z);
              if (x < minX) minX = x;
              if (y < minY) minY = y;
              if (z < minZ) minZ = z;
              if (x > maxX) maxX = x;
              if (y > maxY) maxY = y;
              if (z > maxZ) maxZ = z;
            }
            const idx = indices instanceof Uint32Array ? Array.from(indices) : [...indices];
            if (pos.length >= 9 && idx.length >= 3) {
              const m = soupToMesh(pos, idx);
              meshes.push(m);
              vertexCount += m.vertices.length;
              triangleCount += m.faces.length;
            }
          } finally {
            disposeWebIfcObject(geom);
            disposeWebIfcObject(placed);
          }
        }
      } finally {
        disposeWebIfcObject(geoms);
      }
    });

    // Semantic counts
    const WebIFC = runtime.module as Record<string, number>;
    const countType = (typeConst: number): number => {
      try {
        const lines = webIfcApi.GetLineIDsWithType(modelId, typeConst);
        try {
          return typeof lines.size === "function" ? lines.size() : 0;
        } finally {
          disposeWebIfcObject(lines);
        }
      } catch {
        return 0;
      }
    };
    const wallCount =
      countType(WebIFC.IFCWALL ?? 0) + countType(WebIFC.IFCWALLSTANDARDCASE ?? 0);
    const slabCount = countType(WebIFC.IFCSLAB ?? 0);
    const spaceCount = countType(WebIFC.IFCSPACE ?? 0);
    const storeyCount = countType(WebIFC.IFCBUILDINGSTOREY ?? 0);
    const buildingCount = countType(WebIFC.IFCBUILDING ?? 0);
    const columnCount = countType(WebIFC.IFCCOLUMN ?? 0);
    const siteCount = countType(WebIFC.IFCSITE ?? 0);

    // A StreamAllMeshes callback is only an envelope. It is not body-geometry
    // evidence until at least one valid triangle survives decoding.
    if (triangleCount < 1) {
      return {
        ok: false,
        code: "no-body-geometry",
        detail: "web-ifc StreamAllMeshes produced no triangles",
      };
    }

    if (!Number.isFinite(minX)) {
      minX = minY = minZ = 0;
      maxX = maxY = maxZ = 0;
    }
    const footprintAreaApprox = Math.max(0, maxX - minX) * Math.max(0, maxY - minY);

    return {
      ok: true,
      backend: "web-ifc",
      modelId,
      meshCount,
      vertexCount,
      triangleCount,
      wallCount,
      slabCount,
      spaceCount,
      storeyCount,
      buildingCount,
      columnCount,
      siteCount,
      meshes,
      geometryGrade: "A",
      cityScale: true,
      bbox: [minX, minY, minZ, maxX, maxY, maxZ],
      footprintAreaApprox,
    };
  } catch (error) {
    return {
      ok: false,
      code: "web-ifc-unavailable",
      detail: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (api && openedModelId !== null) {
      try {
        api.CloseModel(openedModelId);
      } catch {
        // Model may have failed during OpenModel or already been closed by WASM.
      }
    }
  }
}

/**
 * City-scale fixture: multi-building campus with storeys, walls, slabs, columns, street slab.
 * Valid IFC4 CoordinationView-style DATA section.
 */
export function createStudioIfcCityFixture(options?: {
  readonly buildings?: number;
  readonly storeysPerBuilding?: number;
}): string {
  const buildingCount = Math.max(1, Math.min(6, options?.buildings ?? 2));
  const storeys = Math.max(1, Math.min(8, options?.storeysPerBuilding ?? 3));
  const lines: string[] = [
    "ISO-10303-21;",
    "HEADER;",
    "FILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');",
    "FILE_NAME('city.ifc','2026-08-02T00:00:00',('ToonSpectrum'),('ToonSpectrum'),'web-ifc','web-ifc','');",
    "FILE_SCHEMA(('IFC4'));",
    "ENDSEC;",
    "DATA;",
    "#1=IFCPERSON($,$,'Author',$,$,$,$,$);",
    "#2=IFCORGANIZATION($,'ToonSpectrum',$,$,$);",
    "#3=IFCPERSONANDORGANIZATION(#1,#2,$);",
    "#4=IFCAPPLICATION(#2,'1.0','ToonSpectrum','ts');",
    "#5=IFCOWNERHISTORY(#3,#4,$,.ADDED.,$,#3,#4,0);",
    "#6=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.0E-05,#7,$);",
    "#7=IFCAXIS2PLACEMENT3D(#8,$,$);",
    "#8=IFCCARTESIANPOINT((0.,0.,0.));",
    "#10=IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);",
    "#11=IFCUNITASSIGNMENT((#10));",
    "#12=IFCPROJECT('2O2Fr$t4X7Zf8NOew3FPRJ',#5,'CityProject',$,$,$,$,(#6),#11);",
    "#13=IFCLOCALPLACEMENT($,#7);",
    "#14=IFCSITE('2O2Fr$t4X7Zf8NOew3FSIT',#5,'CitySite',$,$,#13,$,$,.ELEMENT.,$,$,$,$,$);",
    "#15=IFCRELAGGREGATES('2O2Fr$t4X7Zf8NOew3FRA1',#5,$,$,#12,(#14));",
  ];
  let next = 20;
  const buildingIds: number[] = [];

  for (let b = 0; b < buildingCount; b += 1) {
    const ox = b * 25;
    const oy = (b % 2) * 18;
    const bPt = next++;
    const bAxis = next++;
    const bPlace = next++;
    const buildingId = next++;
    lines.push(`#${bPt}=IFCCARTESIANPOINT((${ox}.,${oy}.,0.));`);
    lines.push(`#${bAxis}=IFCAXIS2PLACEMENT3D(#${bPt},$,$);`);
    lines.push(`#${bPlace}=IFCLOCALPLACEMENT(#13,#${bAxis});`);
    lines.push(
      `#${buildingId}=IFCBUILDING('2O2Fr$t4X7Zf8NOew3FB${b}',#5,'Tower${b}',$,$,#${bPlace},$,$,.ELEMENT.,$,$,$);`,
    );
    buildingIds.push(buildingId);

    const storeyEntityIds: number[] = [];
    for (let s = 0; s < storeys; s += 1) {
      const elev = s * 3;
      const placeId = next++;
      const axisId = next++;
      const ptId = next++;
      const storeyId = next++;
      lines.push(`#${ptId}=IFCCARTESIANPOINT((${ox}.,${oy}.,${elev}.));`);
      lines.push(`#${axisId}=IFCAXIS2PLACEMENT3D(#${ptId},$,$);`);
      lines.push(`#${placeId}=IFCLOCALPLACEMENT(#${bPlace},#${axisId});`);
      lines.push(
        `#${storeyId}=IFCBUILDINGSTOREY('2O2Fr$t4X7Zf8NOew3FS${b}${s}',#5,'B${b}L${s}',$,$,#${placeId},$,$,.ELEMENT.,${elev}.);`,
      );
      storeyEntityIds.push(storeyId);

      // Wall extruded solid
      const profId = next++;
      const profPlId = next++;
      const profPtId = next++;
      const dirId = next++;
      const solidId = next++;
      const shapeId = next++;
      const pdsId = next++;
      const wallId = next++;
      lines.push(`#${profPtId}=IFCCARTESIANPOINT((0.,0.));`);
      lines.push(`#${profPlId}=IFCAXIS2PLACEMENT2D(#${profPtId},$);`);
      lines.push(`#${profId}=IFCRECTANGLEPROFILEDEF(.AREA.,$,#${profPlId},${10 + s}.,0.3);`);
      lines.push(`#${dirId}=IFCDIRECTION((0.,0.,1.));`);
      lines.push(`#${solidId}=IFCEXTRUDEDAREASOLID(#${profId},#${axisId},#${dirId},2.8);`);
      lines.push(`#${shapeId}=IFCSHAPEREPRESENTATION(#6,'Body','SweptSolid',(#${solidId}));`);
      lines.push(`#${pdsId}=IFCPRODUCTDEFINITIONSHAPE($,$,(#${shapeId}));`);
      lines.push(
        `#${wallId}=IFCWALL('2O2Fr$t4X7Zf8NOew3FW${b}${s}',#5,'Wall${b}_${s}',$,$,#${placeId},#${pdsId},$,$);`,
      );

      // Cross wall for city block volume
      const wall2Prof = next++;
      const wall2Solid = next++;
      const wall2Shape = next++;
      const wall2Pds = next++;
      const wall2Id = next++;
      const wall2Dir = next++;
      lines.push(`#${wall2Prof}=IFCRECTANGLEPROFILEDEF(.AREA.,$,#${profPlId},0.3,${8 + s}.);`);
      lines.push(`#${wall2Dir}=IFCDIRECTION((0.,0.,1.));`);
      lines.push(`#${wall2Solid}=IFCEXTRUDEDAREASOLID(#${wall2Prof},#${axisId},#${wall2Dir},2.8);`);
      lines.push(`#${wall2Shape}=IFCSHAPEREPRESENTATION(#6,'Body','SweptSolid',(#${wall2Solid}));`);
      lines.push(`#${wall2Pds}=IFCPRODUCTDEFINITIONSHAPE($,$,(#${wall2Shape}));`);
      lines.push(
        `#${wall2Id}=IFCWALL('2O2Fr$t4X7Zf8NOew3FX${b}${s}',#5,'WallX${b}_${s}',$,$,#${placeId},#${wall2Pds},$,$);`,
      );

      // Slab
      const slabProf = next++;
      const slabSolid = next++;
      const slabShape = next++;
      const slabPds = next++;
      const slabId = next++;
      const slabDir = next++;
      lines.push(`#${slabProf}=IFCRECTANGLEPROFILEDEF(.AREA.,$,#${profPlId},12.,12.);`);
      lines.push(`#${slabDir}=IFCDIRECTION((0.,0.,1.));`);
      lines.push(`#${slabSolid}=IFCEXTRUDEDAREASOLID(#${slabProf},#${axisId},#${slabDir},0.25);`);
      lines.push(`#${slabShape}=IFCSHAPEREPRESENTATION(#6,'Body','SweptSolid',(#${slabSolid}));`);
      lines.push(`#${slabPds}=IFCPRODUCTDEFINITIONSHAPE($,$,(#${slabShape}));`);
      lines.push(
        `#${slabId}=IFCSLAB('2O2Fr$t4X7Zf8NOew3FL${b}${s}',#5,'Slab${b}_${s}',$,$,#${placeId},#${slabPds},$,.FLOOR.);`,
      );

      // Column
      const colProf = next++;
      const colSolid = next++;
      const colShape = next++;
      const colPds = next++;
      const colId = next++;
      const colDir = next++;
      lines.push(`#${colProf}=IFCRECTANGLEPROFILEDEF(.AREA.,$,#${profPlId},0.4,0.4);`);
      lines.push(`#${colDir}=IFCDIRECTION((0.,0.,1.));`);
      lines.push(`#${colSolid}=IFCEXTRUDEDAREASOLID(#${colProf},#${axisId},#${colDir},2.8);`);
      lines.push(`#${colShape}=IFCSHAPEREPRESENTATION(#6,'Body','SweptSolid',(#${colSolid}));`);
      lines.push(`#${colPds}=IFCPRODUCTDEFINITIONSHAPE($,$,(#${colShape}));`);
      lines.push(
        `#${colId}=IFCCOLUMN('2O2Fr$t4X7Zf8NOew3FC${b}${s}',#5,'Col${b}_${s}',$,$,#${placeId},#${colPds},$,$);`,
      );

      // Space
      const spaceId = next++;
      lines.push(
        `#${spaceId}=IFCSPACE('2O2Fr$t4X7Zf8NOew3FP${b}${s}',#5,'Room${b}_${s}',$,$,#${placeId},$,$,.ELEMENT.,.INTERNAL.,$);`,
      );

      const contId = next++;
      lines.push(
        `#${contId}=IFCRELCONTAINEDINSPATIALSTRUCTURE('2O2Fr$t4X7Zf8NOew3FR${b}${s}',#5,$,$,(#${wallId},#${wall2Id},#${slabId},#${colId}),#${storeyId});`,
      );
    }
    const aggStoreys = next++;
    lines.push(
      `#${aggStoreys}=IFCRELAGGREGATES('2O2Fr$t4X7Zf8NOew3FAS${b}',#5,$,$,#${buildingId},(${storeyEntityIds.map((x) => `#${x}`).join(",")}));`,
    );
  }

  // Street / plaza slab connecting buildings (city public realm)
  const streetPt = next++;
  const streetAxis = next++;
  const streetPlace = next++;
  const streetProf = next++;
  const streetProfPl = next++;
  const streetProfPt = next++;
  const streetDir = next++;
  const streetSolid = next++;
  const streetShape = next++;
  const streetPds = next++;
  const streetId = next++;
  lines.push(`#${streetPt}=IFCCARTESIANPOINT((0.,-5.,0.));`);
  lines.push(`#${streetAxis}=IFCAXIS2PLACEMENT3D(#${streetPt},$,$);`);
  lines.push(`#${streetPlace}=IFCLOCALPLACEMENT(#13,#${streetAxis});`);
  lines.push(`#${streetProfPt}=IFCCARTESIANPOINT((0.,0.));`);
  lines.push(`#${streetProfPl}=IFCAXIS2PLACEMENT2D(#${streetProfPt},$);`);
  lines.push(`#${streetProf}=IFCRECTANGLEPROFILEDEF(.AREA.,$,#${streetProfPl},${buildingCount * 25 + 10}.,6.);`);
  lines.push(`#${streetDir}=IFCDIRECTION((0.,0.,1.));`);
  lines.push(`#${streetSolid}=IFCEXTRUDEDAREASOLID(#${streetProf},#${streetAxis},#${streetDir},0.15);`);
  lines.push(`#${streetShape}=IFCSHAPEREPRESENTATION(#6,'Body','SweptSolid',(#${streetSolid}));`);
  lines.push(`#${streetPds}=IFCPRODUCTDEFINITIONSHAPE($,$,(#${streetShape}));`);
  lines.push(
    `#${streetId}=IFCSLAB('2O2Fr$t4X7Zf8NOew3FST0',#5,'Street',$,$,#${streetPlace},#${streetPds},$,.BASESLAB.);`,
  );

  // Site contains buildings + street
  const siteCont = next++;
  lines.push(
    `#${siteCont}=IFCRELCONTAINEDINSPATIALSTRUCTURE('2O2Fr$t4X7Zf8NOew3FSC0',#5,$,$,(#${streetId}),#14);`,
  );
  lines.push(
    `#${next}=IFCRELAGGREGATES('2O2Fr$t4X7Zf8NOew3FRA2',#5,$,$,#14,(${buildingIds.map((x) => `#${x}`).join(",")}));`,
  );
  lines.push("ENDSEC;");
  lines.push("END-ISO-10303-21;");
  return lines.join("\n");
}
