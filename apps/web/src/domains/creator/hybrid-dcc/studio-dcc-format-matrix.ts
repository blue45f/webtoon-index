/**
 * Format compatibility matrix (~80 formats from doc §7) — support grade + implementation path.
 * Does not claim parsers for proprietary X grades.
 */

export const STUDIO_DCC_FORMAT_MATRIX_REVISION = 1 as const;

export type StudioFormatGrade = "N" | "A" | "B" | "C" | "D" | "P" | "X";

export interface StudioFormatEntry {
  readonly id: string;
  readonly extensions: readonly string[];
  readonly category:
    | "mesh"
    | "character"
    | "cad"
    | "bim"
    | "image"
    | "document"
    | "animation"
    | "package";
  readonly grade: StudioFormatGrade;
  readonly path: string;
  readonly priority: "P0" | "P1" | "P2" | "P3" | "P4" | "P5";
  readonly notes: string;
}

export const STUDIO_DCC_FORMAT_MATRIX: readonly StudioFormatEntry[] = [
  // Runtime / mesh
  { id: "gltf", extensions: [".gltf"], category: "mesh", grade: "A", path: "studio-glb-scene-ir + three GLTFLoader", priority: "P0", notes: "canonical runtime IR" },
  { id: "glb", extensions: [".glb"], category: "mesh", grade: "A", path: "studio-glb-scene-ir", priority: "P0", notes: "binary glTF" },
  { id: "obj", extensions: [".obj", ".mtl"], category: "mesh", grade: "A", path: "obj worker + parseStudioObjToSceneIR", priority: "P0", notes: "no rig" },
  { id: "fbx", extensions: [".fbx"], category: "mesh", grade: "B", path: "ASCII pure + binary sniff; ufbx WASM / Assimp bridge", priority: "P1", notes: "vendor variance" },
  { id: "dae", extensions: [".dae"], category: "mesh", grade: "B", path: "Three ColladaLoader", priority: "P2", notes: "legacy" },
  { id: "3ds", extensions: [".3ds"], category: "mesh", grade: "B", path: "Three/Assimp", priority: "P2", notes: "legacy limits" },
  { id: "ply", extensions: [".ply"], category: "mesh", grade: "A", path: "Three PLYLoader", priority: "P1", notes: "vertex color" },
  { id: "stl", extensions: [".stl"], category: "mesh", grade: "A", path: "Three STLLoader", priority: "P1", notes: "print mesh" },
  { id: "3mf", extensions: [".3mf"], category: "mesh", grade: "B", path: "studio-mesh-format-adapters/3mf + lib3mf WASM optional", priority: "P2", notes: "print package XML mesh subset" },
  { id: "off", extensions: [".off"], category: "mesh", grade: "A", path: "studio-mesh-format-adapters/off", priority: "P3", notes: "minimal" },
  { id: "usdz", extensions: [".usdz"], category: "package", grade: "B", path: "Three USDZLoader", priority: "P2", notes: "not full USD" },
  { id: "usd", extensions: [".usd", ".usda", ".usdc"], category: "package", grade: "C", path: "OpenUSD sidecar", priority: "P4", notes: "heavy" },
  { id: "abc", extensions: [".abc"], category: "animation", grade: "C", path: "DCC bridge", priority: "P4", notes: "cache only" },
  // Character
  { id: "vrm", extensions: [".vrm"], category: "character", grade: "A", path: "three-vrm + studio-glb-scene-ir", priority: "P0", notes: "0.x→1.0 IR" },
  { id: "vrma", extensions: [".vrma"], category: "animation", grade: "A", path: "three-vrm-animation", priority: "P2", notes: "humanoid motion" },
  { id: "bvh", extensions: [".bvh"], category: "animation", grade: "B", path: "studio-mesh-format-adapters/bvh + retarget", priority: "P2", notes: "hierarchy + stick preview" },
  { id: "pmx", extensions: [".pmx", ".pmd"], category: "character", grade: "B", path: "Three MMDLoader", priority: "P2", notes: "license" },
  { id: "vmd", extensions: [".vmd"], category: "animation", grade: "B", path: "Three MMDLoader", priority: "P2", notes: "MMD motion" },
  // CAD / BIM
  { id: "step", extensions: [".step", ".stp"], category: "cad", grade: "B", path: "studio-mesh-format-adapters/step shell + occt-import-js optional", priority: "P3", notes: "cartesian/product shell" },
  { id: "iges", extensions: [".iges", ".igs"], category: "cad", grade: "B", path: "studio-mesh-format-adapters/step shell + occt-import-js optional", priority: "P3", notes: "shell path shared" },
  { id: "brep", extensions: [".brep"], category: "cad", grade: "B", path: "OCCT module", priority: "P3", notes: "LGPL" },
  { id: "3dm", extensions: [".3dm"], category: "cad", grade: "A", path: "rhino3dm openNURBS WASM full NURBS eval", priority: "P2", notes: "curve point/tangent/deriv + surface normal + File3dm" },
  { id: "dxf", extensions: [".dxf"], category: "cad", grade: "B", path: "dxf-parser", priority: "P2", notes: "plan import" },
  { id: "dwg", extensions: [".dwg"], category: "cad", grade: "X", path: "LibreDWG GPL converter only", priority: "P4", notes: "not in browser core" },
  { id: "ifc", extensions: [".ifc"], category: "bim", grade: "A", path: "web-ifc city StreamAllMeshes + IFC shell lite", priority: "P2", notes: "multi-building city body geometry grade A" },
  // Documents / images
  { id: "psd", extensions: [".psd", ".psb"], category: "document", grade: "A", path: "ag-psd / @webtoon/psd", priority: "P0", notes: "export report" },
  { id: "png", extensions: [".png"], category: "image", grade: "A", path: "browser codecs", priority: "P0", notes: "source master" },
  { id: "jpeg", extensions: [".jpg", ".jpeg"], category: "image", grade: "A", path: "browser codecs", priority: "P0", notes: "" },
  { id: "webp", extensions: [".webp"], category: "image", grade: "A", path: "browser codecs", priority: "P0", notes: "" },
  { id: "exr", extensions: [".exr"], category: "image", grade: "B", path: "TinyEXR WASM", priority: "P2", notes: "HDR passes" },
  { id: "ktx2", extensions: [".ktx2"], category: "image", grade: "A", path: "basis transcoder", priority: "P1", notes: "runtime derivative" },
  { id: "svg", extensions: [".svg"], category: "document", grade: "A", path: "resvg-js / vector IR", priority: "P1", notes: "MPL notes" },
  { id: "pdf", extensions: [".pdf"], category: "document", grade: "B", path: "PDF.js / CanvasKit", priority: "P2", notes: "preview" },
  { id: "ora", extensions: [".ora"], category: "document", grade: "A", path: "ZIP/XML custom", priority: "P2", notes: "open raster" },
  // Native proprietary — explicit X/C
  { id: "max", extensions: [".max"], category: "mesh", grade: "X", path: "native bridge only", priority: "P4", notes: "no browser parser" },
  { id: "mb", extensions: [".mb", ".ma"], category: "mesh", grade: "C", path: "Maya bridge", priority: "P4", notes: "" },
  { id: "c4d", extensions: [".c4d"], category: "mesh", grade: "X", path: "C4D bridge", priority: "P4", notes: "" },
  { id: "blend", extensions: [".blend"], category: "mesh", grade: "C", path: "Blender exporter bridge", priority: "P3", notes: "" },
  { id: "skp", extensions: [".skp"], category: "mesh", grade: "C", path: "SketchUp bridge", priority: "P3", notes: "" },
  { id: "clip", extensions: [".clip"], category: "document", grade: "X", path: "not reverse-engineered", priority: "P5", notes: "export via CSP" },
  { id: "ztl", extensions: [".ztl"], category: "mesh", grade: "X", path: "ZBrush bridge", priority: "P4", notes: "" },
  { id: "hip", extensions: [".hip"], category: "mesh", grade: "X", path: "Houdini bridge", priority: "P4", notes: "" },
  { id: "sldprt", extensions: [".sldprt", ".sldasm"], category: "cad", grade: "C", path: "OCCT SolidWorks-grade feature parity (not proprietary binary)", priority: "P3", notes: "extrude/revolve/boolean/fillet/chamfer/loft via opencascade.js; .sldprt binary still native bridge" },
  // Package
  { id: "toon3d", extensions: [".toon3d"], category: "package", grade: "N", path: "native Studio package", priority: "P0", notes: "authoring SSOT" },
];

export function lookupStudioFormat(
  extensionOrId: string,
): StudioFormatEntry | null {
  const key = extensionOrId.trim().toLowerCase().replace(/^\./, "");
  return (
    STUDIO_DCC_FORMAT_MATRIX.find(
      (e) =>
        e.id === key
        || e.extensions.some((ext) => ext.replace(/^\./, "") === key),
    ) ?? null
  );
}

export function studioFormatsByPriority(
  priority: StudioFormatEntry["priority"],
): readonly StudioFormatEntry[] {
  return STUDIO_DCC_FORMAT_MATRIX.filter((e) => e.priority === priority);
}

export function studioFormatsByGrade(
  grade: StudioFormatGrade,
): readonly StudioFormatEntry[] {
  return STUDIO_DCC_FORMAT_MATRIX.filter((e) => e.grade === grade);
}

export function assertNoProprietaryInBrowserCore(): readonly string[] {
  return STUDIO_DCC_FORMAT_MATRIX
    .filter((e) => e.grade === "X" || (e.grade === "C" && e.path.includes("bridge")))
    .map((e) => e.id);
}
