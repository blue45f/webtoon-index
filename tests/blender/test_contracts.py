from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import sys
import unittest


ROOT = Path(__file__).resolve().parents[2]
KIT = ROOT / "tools" / "blender"
if str(KIT) not in sys.path:
    sys.path.insert(0, str(KIT))

from toonstudio_blender_kit.contracts import (  # noqa: E402
    ContractError,
    HAIR_STYLE_PRESETS,
    MCP_ALLOWED_COMMANDS,
    PipelineConfig,
    QualityIssue,
    calculate_score,
    load_config,
    parse_config,
)


class ContractTests(unittest.TestCase):
    def test_reference_config_is_valid_and_deterministic(self) -> None:
        config = load_config(ROOT / "config/blender/reference-character.json")
        self.assertEqual(config.mode, "reference")
        self.assertEqual(config.hair.style, "soft-bob")
        self.assertEqual(len(config.digest()), 64)
        raw = json.loads((ROOT / "config/blender/reference-character.json").read_text())
        reordered = dict(reversed(list(raw.items())))
        self.assertEqual(parse_config(raw).digest(), parse_config(reordered).digest())

    def test_orion_config_preserves_explicit_provenance(self) -> None:
        config = load_config(ROOT / "config/blender/avatar-orion-production.json")
        self.assertEqual(config.mode, "upgrade")
        self.assertTrue(config.export.vrm)
        self.assertEqual(config.input_path, "apps/web/public/vrm/Avatar_Orion.vrm")
        self.assertEqual(
            config.provenance["sourceGitBlob"],
            "b244cf74aa845e75b33a4e48a962ebd880ec2210",
        )

    def test_unsafe_paths_and_unbounded_face_displacement_fail_closed(self) -> None:
        raw = json.loads((ROOT / "config/blender/reference-character.json").read_text())
        raw["outputDir"] = "../outside"
        with self.assertRaisesRegex(ContractError, "parent traversal"):
            parse_config(raw)
        raw["outputDir"] = "batch_generated/blender-character"
        raw["face"]["maximumDisplacementRatio"] = 0.5
        with self.assertRaisesRegex(ContractError, "between 0.005 and 0.08"):
            parse_config(raw)

    def test_quality_score_does_not_penalize_information_receipts(self) -> None:
        issues = [
            QualityIssue("notice", "info", "preserved"),
            QualityIssue("warn", "warning", "review"),
            QualityIssue("error", "error", "block"),
        ]
        self.assertEqual(calculate_score(issues), 76)

    def test_all_public_hair_styles_have_release_parameters(self) -> None:
        self.assertEqual(
            set(HAIR_STYLE_PRESETS),
            {
                "short-layered",
                "soft-bob",
                "romance-long",
                "action-pony",
                "hime-cut",
                "wolf-layered",
            },
        )
        for value in HAIR_STYLE_PRESETS.values():
            self.assertGreater(float(value["backLength"]), 0)
            self.assertIn("symmetryBreak", value)

    def test_mcp_contract_is_allowlist_only(self) -> None:
        self.assertEqual(
            MCP_ALLOWED_COMMANDS,
            {
                "inspect_character",
                "build_authored_hair",
                "create_semantic_face_shapes",
                "render_quality_views",
                "validate_character",
                "export_character_package",
                "run_pipeline",
            },
        )


if __name__ == "__main__":
    unittest.main()
