from __future__ import annotations

from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[2]
KIT = ROOT / "tools" / "blender" / "toonstudio_blender_kit"


class BlenderPipelineRegressionTests(unittest.TestCase):
    def test_expression_preview_reads_mesh_owned_shape_provenance(self) -> None:
        source = (KIT / "render.py").read_text(encoding="utf-8")
        self.assertIn("def _is_generated_shape_key", source)
        self.assertIn("obj.get(marker, False)", source)
        self.assertIn("not _is_generated_shape_key(obj, key.name)", source)
        self.assertNotIn('key.get("toonstudio_generated"', source)

    def test_quality_report_is_final_before_manifest_receipts_are_hashed(self) -> None:
        source = (KIT / "pipeline.py").read_text(encoding="utf-8")
        quality_role = source.index('outputs["qualityReport"] = "quality-report.json"')
        manifest_role = source.index('outputs["manifest"] = "character-package.json"')
        report_build = source.index("report = PipelineReport(", quality_role)
        report_write = source.index('write_json(output_dir / QUALITY_REPORT_FILENAME', report_build)
        manifest_build = source.index("manifest = _build_manifest(", report_write)
        manifest_write = source.index('write_json(output_dir / "character-package.json"', manifest_build)

        self.assertLess(quality_role, report_build)
        self.assertLess(manifest_role, report_build)
        self.assertLess(report_build, report_write)
        self.assertLess(report_write, manifest_build)
        self.assertLess(manifest_build, manifest_write)
        self.assertEqual(source.count('write_json(output_dir / QUALITY_REPORT_FILENAME'), 1)
        self.assertNotIn("replace(report", source)


if __name__ == "__main__":
    unittest.main()
