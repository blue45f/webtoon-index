import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const required = [
  "tools/blender/toonstudio_blender_kit/blender_manifest.toml",
  "tools/blender/toonstudio_blender_kit/contracts.py",
  "tools/blender/toonstudio_blender_kit/geometry.py",
  "tools/blender/toonstudio_blender_kit/face.py",
  "tools/blender/toonstudio_blender_kit/quality.py",
  "tools/blender/toonstudio_blender_kit/render.py",
  "tools/blender/toonstudio_blender_kit/vrm.py",
  "tools/blender/toonstudio_blender_kit/pipeline.py",
  "tools/blender/toonstudio_blender_kit/mcp.py",
  "scripts/blender/toonstudio_character_pipeline.py",
  "config/blender/reference-character.json",
  "config/blender/avatar-orion-production.json",
  "config/blender/toonstudio-character-pipeline.schema.json",
  "apps/web/src/domains/creator/vrm/studio-vrm-blender-character-package.ts",
];
for (const relative of required) {
  const target = path.join(root, relative);
  if (!(await stat(target)).isFile()) throw new Error(`missing pipeline file: ${relative}`);
}
const sources = await Promise.all(required.filter((value) => value.endsWith(".py")).map((relative) => readFile(path.join(root, relative), "utf8")));
const combined = sources.join("\n");
for (const forbidden of ["read_factory_settings", "subprocess", "os.system", "requests."]) {
  if (combined.includes(forbidden)) throw new Error(`unsafe Blender pipeline token: ${forbidden}`);
}
if (/\b(?:eval|exec)\s*\(/u.test(combined)) throw new Error("dynamic Python execution is forbidden");
for (const marker of [
  "MCP_ALLOWED_COMMANDS",
  "build_authored_hair",
  "create_semantic_face_shape_keys",
  "audit_character",
  "render_quality_views",
  "export_scene.gltf",
  "export_scene, \"vrm\"",
  "character-package.json",
]) {
  if (!combined.includes(marker)) throw new Error(`pipeline marker missing: ${marker}`);
}
const reference = JSON.parse(await readFile(path.join(root, "config/blender/reference-character.json"), "utf8"));
const orion = JSON.parse(await readFile(path.join(root, "config/blender/avatar-orion-production.json"), "utf8"));
if (reference.mode !== "reference" || reference.export.vrm !== false) throw new Error("reference config boundary changed");
if (orion.mode !== "upgrade" || orion.export.vrm !== true) throw new Error("production VRM config boundary changed");
if (orion.inputPath !== "apps/web/public/vrm/Avatar_Orion.vrm") {
  throw new Error("Orion production source must be the repaired VRM 1.0 asset");
}
if (orion.provenance.sourceGitBlob !== "b244cf74aa845e75b33a4e48a962ebd880ec2210") {
  throw new Error("Orion repaired source Git object changed");
}
console.log(`Blender character pipeline static verification passed (${required.length} files)`);
