"""Run the ToonStudio Blender character pipeline from CLI or Blender MCP.

Examples:
  blender --background --factory-startup \
    --python scripts/blender/toonstudio_character_pipeline.py -- \
    --config config/blender/reference-character.json

  # From an MCP execute-code tool, without resetting preferences:
  import runpy, bpy
  bpy.context.scene["toonstudio_pipeline_config"] = "/repo/config/blender/avatar-orion-production.json"
  runpy.run_path("/repo/scripts/blender/toonstudio_character_pipeline.py", run_name="__main__")
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

import bpy


ROOT = Path(__file__).resolve().parents[2]
KIT_ROOT = ROOT / "tools" / "blender"
if str(KIT_ROOT) not in sys.path:
    sys.path.insert(0, str(KIT_ROOT))

from toonstudio_blender_kit.contracts import ContractError, load_config  # noqa: E402
from toonstudio_blender_kit.pipeline import PipelineFailure, run_pipeline  # noqa: E402


def _argv() -> list[str]:
    if "--" in sys.argv:
        return sys.argv[sys.argv.index("--") + 1 :]
    return []


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Build a validated ToonStudio character package")
    parser.add_argument("--config", help="Versioned character pipeline JSON config")
    parser.add_argument("--project-root", default=str(ROOT), help="Repository/project root")
    parser.add_argument(
        "--allow-external-output",
        action="store_true",
        help="Permit output outside project-root for a trusted isolated run",
    )
    return parser


def main() -> int:
    args = _parser().parse_args(_argv())
    config_path = args.config or bpy.context.scene.get("toonstudio_pipeline_config")
    if not config_path:
        raise PipelineFailure("--config or scene['toonstudio_pipeline_config'] is required")
    project_root = Path(args.project_root).expanduser().resolve()
    target = Path(str(config_path)).expanduser()
    if not target.is_absolute():
        target = project_root / target
    if args.allow_external_output:
        bpy.context.scene["toonstudio_allow_external_output"] = True
    config = load_config(target.resolve())
    execution = run_pipeline(config, project_root=project_root, clear_before_import=True)
    print(
        "TOONSTUDIO_CHARACTER_PIPELINE_COMPLETE "
        + json.dumps(
            {
                "characterId": execution.report.character_id,
                "passed": execution.report.passed,
                "score": execution.report.score,
                "outputDir": str(execution.output_dir),
                "manifest": str(execution.output_dir / "character-package.json"),
            },
            ensure_ascii=False,
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, RuntimeError, ValueError) as error:
        print(
            "TOONSTUDIO_CHARACTER_PIPELINE_FAILED "
            + json.dumps(
                {"error": str(error), "errorType": type(error).__name__},
                ensure_ascii=False,
                sort_keys=True,
            ),
            file=sys.stderr,
        )
        raise SystemExit(2) from error
