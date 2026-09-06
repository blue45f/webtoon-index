from __future__ import annotations

import json
from pathlib import Path
import re
import tomllib
import unittest


ROOT = Path(__file__).resolve().parents[2]
KIT = ROOT / "tools/blender/toonstudio_blender_kit"


class SourceContractTests(unittest.TestCase):
    def test_extension_manifest_targets_blender_52_without_network_permission(self) -> None:
        manifest = tomllib.loads((KIT / "blender_manifest.toml").read_text())
        self.assertEqual(manifest["id"], "toonstudio_character_pipeline")
        self.assertEqual(manifest["blender_version_min"], "5.2.0")
        self.assertIn("files", manifest["permissions"])
        self.assertNotIn("network", manifest["permissions"])

    def test_pipeline_has_no_arbitrary_execution_or_preferences_reset(self) -> None:
        source = "\n".join(path.read_text() for path in KIT.glob("*.py"))
        self.assertNotIn("read_factory_settings", source, "factory reset")
        self.assertNotRegex(source, re.compile(r"\b(?:eval|exec)\s*\("), "dynamic execution")
        self.assertNotRegex(source, re.compile(r"^\s*(?:from|import)\s+(?:subprocess|requests|socket)\b", re.MULTILINE), "process or network import")
        self.assertNotIn("os.system", source, "system shell")
        self.assertIn("MCP_ALLOWED_COMMANDS", source)
        self.assertIn("bpy.ops.vrm", source)
        self.assertIn("bpy.ops.export_scene.gltf", source)
        self.assertIn("morph_target_binds.add", source)
        self.assertIn("vrmCustomExpressions", (KIT / "pipeline.py").read_text())

    def test_geometry_uses_closed_clumps_and_lods_not_primitive_hair_assemblies(self) -> None:
        geometry = (KIT / "geometry.py").read_text()
        self.assertIn("single crown vertex", geometry)
        self.assertIn("add_clump", geometry)
        self.assertIn("toonstudio_lod", geometry)
        self.assertNotIn("primitive_uv_sphere_add", geometry)
        self.assertNotIn("primitive_capsule", geometry)

    def test_face_authoring_never_relabels_expression_keys(self) -> None:
        face = (KIT / "face.py").read_text()
        for token in ("blink", "phoneme", "viseme", "happy", "angry", "surprised"):
            self.assertIn(token, face.casefold())
        self.assertIn("preserve_expression_shape_keys", face)
        self.assertIn(
            'obj[f"toonstudio_shape_{_normalize(key.name)}_generated"] = True',
            face,
        )
        self.assertNotRegex(face, re.compile(r'\bkey\["toonstudio_'))

    def test_compatibility_entry_point_no_longer_imports_missing_generator(self) -> None:
        source = (ROOT / "scripts/blender/generate_vrm_character.py").read_text()
        self.assertNotIn("from generate_toonspectrum_vrm_pack", source)
        self.assertIn("avatar-orion-production.json", source)

    def test_configs_declare_schema_and_only_relative_outputs(self) -> None:
        for path in sorted((ROOT / "config/blender").glob("*.json")):
            if path.name.endswith("schema.json"):
                continue
            raw = json.loads(path.read_text())
            self.assertEqual(raw["version"], 1)
            self.assertTrue(raw["$schema"].endswith("schema.json"))
            self.assertFalse(Path(raw["outputDir"]).is_absolute())
            self.assertNotIn("..", Path(raw["outputDir"]).parts)

    def test_typescript_package_parser_pins_hash_and_path_safety(self) -> None:
        source = (ROOT / "apps/web/src/domains/creator/vrm/studio-vrm-blender-character-package.ts").read_text()
        self.assertRegex(source, re.compile(r"\^\[0-9a-f\]\{64\}\$"))
        self.assertIn('part === ".."', source)
        self.assertIn("quality.passed", source)
        self.assertIn('["vrm", "glb"]', source)


if __name__ == "__main__":
    unittest.main()
