export type GeometryAuthority =
  | "editable-mesh"
  | "brep-cad"
  | "manifold-solid"
  | "sculpt-volume"
  | "garment-pattern"
  | "curve-network"
  | "external-reference";

export type FormatCompatibilityGrade = "N" | "A" | "B" | "C" | "D" | "P" | "X";

export interface RightsRecord {
  assetId: string;
  creator: string;
  license: string;
  commercialUse: boolean;
  modificationAllowed: boolean;
  attributionRequired: boolean;
}

export interface GeometryAssetManifest {
  id: string;
  name: string;
  authority: GeometryAuthority;
  sourceFormat: string;
  compatibilityGrade: FormatCompatibilityGrade;
  vertexCount: number;
  faceCount: number;
  hasUV: boolean;
  hasSkinning: boolean;
  hasCADHistory: boolean;
  units: "mm" | "cm" | "m" | "inch";
  upAxis: "Y" | "Z";
  rights: RightsRecord;
}

export interface CompatibilityLossReport {
  format: string;
  grade: FormatCompatibilityGrade;
  preservedFeatures: string[];
  bakedFeatures: string[];
  droppedFeatures: string[];
  warnings: string[];
}

export function evaluateFormatCompatibility(sourceFormat: string): CompatibilityLossReport {
  const formatUpper = sourceFormat.toUpperCase();

  switch (formatUpper) {
    case "GLTF":
    case "GLB":
      return {
        format: "glTF 2.0 / GLB",
        grade: "A",
        preservedFeatures: ["Hierarchy", "PBR Materials", "Skinning", "Morph Targets", "Animation Clips"],
        bakedFeatures: ["CAD Feature History", "Procedural Generators"],
        droppedFeatures: [],
        warnings: [],
      };
    case "VRM":
      return {
        format: "VRM 0.x/1.0 Humanoid Avatar",
        grade: "A",
        preservedFeatures: ["Humanoid Bone Mapping", "Expressions", "MToon Shader Parameters", "SpringBones"],
        bakedFeatures: [],
        droppedFeatures: [],
        warnings: ["Ensure avatar usage rights and commercial license compliance."],
      };
    case "STEP":
    case "STP":
    case "IGES":
    case "IGS":
      return {
        format: "STEP / IGES B-Rep CAD",
        grade: "A",
        preservedFeatures: ["Exact B-Rep Surfaces", "Assembly Tree", "Object Colors", "CAD Names"],
        bakedFeatures: ["Tessellated Render Mesh"],
        droppedFeatures: ["Parametric Feature Tree History"],
        warnings: ["Exact B-Rep geometry is tessellated for WebGPU/WebGL rendering."],
      };
    case "OBJ":
      return {
        format: "Wavefront OBJ",
        grade: "A",
        preservedFeatures: ["Triangle/Quad Mesh", "UV Coordinates", "Normals", "Materials (MTL)"],
        bakedFeatures: [],
        droppedFeatures: ["Rigging Skin Weights", "Animations", "Scene Hierarchy"],
        warnings: ["OBJ does not support skeletal animation or node hierarchies."],
      };
    case "FBX":
      return {
        format: "Autodesk FBX",
        grade: "B",
        preservedFeatures: ["Skeletal Mesh", "Joint Hierarchy", "Skin Weights", "Animation Clips"],
        bakedFeatures: ["Custom Shader Nodes"],
        droppedFeatures: ["Vendor Specific Modifiers"],
        warnings: ["FBX version differences may require transform normalization."],
      };
    case "SKP":
    case "SKETCHUP":
      return {
        format: "Trimble SketchUp (.skp)",
        grade: "C",
        preservedFeatures: ["Component Hierarchy", "Tags/Layers", "Materials", "Scenes/Cameras"],
        bakedFeatures: ["Push/Pull Parametrics"],
        droppedFeatures: ["Native SketchUp Ruby Extensions"],
        warnings: ["Requires source-app bridge plugin or glTF export converter."],
      };
    case "BLEND":
    case "BLENDER":
      return {
        format: "Blender (.blend)",
        grade: "C",
        preservedFeatures: ["Mesh Geometry", "Armatures", "Modifiers (Baked)", "Texture Maps"],
        bakedFeatures: ["Geometry Nodes", "Procedural Shaders"],
        droppedFeatures: ["GPL Internal Python Scripts"],
        warnings: ["Requires Blender Add-on Bridge for loss-free .toon3d interchange."],
      };
    default:
      return {
        format: sourceFormat,
        grade: "B",
        preservedFeatures: ["Mesh Geometry", "Basic Colors"],
        bakedFeatures: ["Advanced Materials"],
        droppedFeatures: ["Native Application State"],
        warnings: ["Generic fallback adapter applied. Inspect geometry for fidelity."],
      };
  }
}
