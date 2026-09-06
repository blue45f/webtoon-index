"""Allow-listed Blender MCP facade for the ToonStudio character pipeline.

Official or third-party Blender MCP servers may call ``dispatch`` through their
normal Python execution surface.  The function deliberately exposes no eval,
exec, shell, network, package installation, or arbitrary operator name.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any, Mapping

import bpy

from .contracts import MCP_ALLOWED_COMMANDS, ContractError, load_config
from .face import create_semantic_face_shape_keys, detect_face_meshes
from .geometry import build_authored_hair, infer_head_frame, parent_hair_to_head
from .pipeline import PipelineFailure, run_pipeline
from .quality import audit_character
from .render import render_quality_views
from .vrm import bind_semantic_vrm1_expressions


class McpCommandError(ValueError):
    """Raised when an MCP request is outside the explicit product contract."""


def _payload(value: Mapping[str, Any] | None) -> Mapping[str, Any]:
    if value is None:
        return {}
    if not isinstance(value, Mapping):
        raise McpCommandError("payload must be an object")
    return value


def _required_string(source: Mapping[str, Any], key: str) -> str:
    value = source.get(key)
    if not isinstance(value, str) or not value.strip():
        raise McpCommandError(f"{key} must be a non-empty string")
    if "\x00" in value:
        raise McpCommandError(f"{key} contains a null byte")
    return value.strip()


def _project_root(source: Mapping[str, Any]) -> Path:
    raw = source.get("projectRoot")
    if raw is None:
        return Path.cwd().resolve()
    if not isinstance(raw, str) or not raw.strip():
        raise McpCommandError("projectRoot must be a non-empty string")
    return Path(raw).expanduser().resolve()


def _load_request_config(source: Mapping[str, Any]):
    root = _project_root(source)
    raw_path = _required_string(source, "configPath")
    path = Path(raw_path).expanduser()
    if not path.is_absolute():
        path = root / path
    return root, load_config(path.resolve())


def _scene_objects():
    objects = list(bpy.context.scene.objects)
    meshes = [obj for obj in objects if obj.type == "MESH"]
    armatures = [obj for obj in objects if obj.type == "ARMATURE"]
    armature = max(armatures, key=lambda obj: (len(obj.data.bones), obj.name)) if armatures else None
    if not meshes:
        raise McpCommandError("the current scene contains no mesh objects")
    frame = infer_head_frame(armature, meshes)
    return objects, meshes, armature, frame


def dispatch(command: str, payload: Mapping[str, Any] | None = None) -> dict[str, Any]:
    if command not in MCP_ALLOWED_COMMANDS:
        raise McpCommandError(
            f"command {command!r} is not allowed; expected one of {sorted(MCP_ALLOWED_COMMANDS)}"
        )
    source = _payload(payload)
    try:
        if command == "run_pipeline":
            root, config = _load_request_config(source)
            execution = run_pipeline(config, project_root=root, clear_before_import=True)
            return {
                "ok": True,
                "command": command,
                "outputDir": str(execution.output_dir),
                "report": execution.report.to_mapping(),
            }

        objects, meshes, armature, frame = _scene_objects()
        if command == "inspect_character":
            root, config = _load_request_config(source)
            del root
            detection = detect_face_meshes(meshes, frame, config.face)
            return {
                "ok": True,
                "command": command,
                "objects": len(objects),
                "meshes": len(meshes),
                "armature": armature.name if armature else None,
                "faceMeshes": [obj.name for obj in detection.objects],
                "faceConfidence": detection.confidence,
                "headFrame": {
                    "center": list(frame.center),
                    "radius": [frame.radius_x, frame.radius_y, frame.radius_z],
                },
            }

        root, config = _load_request_config(source)
        if command == "build_authored_hair":
            result = build_authored_hair(frame, config.hair)
            parent_hair_to_head(result, armature)
            return {
                "ok": True,
                "command": command,
                "style": result.style,
                "objects": [obj.name for obj in result.lod_objects],
                "outlines": [obj.name for obj in result.outline_objects],
                "triangles": list(result.triangle_counts),
            }
        if command == "create_semantic_face_shapes":
            result = create_semantic_face_shape_keys(meshes, frame, config.face)
            binding = bind_semantic_vrm1_expressions(armature, result)
            return {
                "ok": bool(result.created_shape_keys),
                "command": command,
                "mode": result.mode,
                "confidence": result.confidence,
                "objects": list(result.object_names),
                "shapeKeys": list(result.created_shape_keys),
                "skipped": list(result.skipped_shape_keys),
                "vrmCustomExpressions": {
                    "status": binding.status,
                    "names": list(binding.expression_names),
                    "message": binding.message,
                },
            }
        if command == "validate_character":
            audit = audit_character(config, meshes, armature)
            return {
                "ok": audit.passed,
                "command": command,
                "score": audit.score,
                "metrics": dict(audit.metrics),
                "issues": [issue.to_mapping() for issue in audit.issues],
            }
        if command == "render_quality_views":
            raw_output = source.get("outputDir")
            output = Path(raw_output).expanduser() if isinstance(raw_output, str) else root / "batch_generated/blender-character/mcp-review"
            if not output.is_absolute():
                output = root / output
            result = render_quality_views(objects, frame, config.render, output.resolve())
            return {
                "ok": True,
                "command": command,
                "outputDir": str(output.resolve()),
                "outputs": dict(result.outputs),
            }
        if command == "export_character_package":
            # Export is intentionally the same validated transaction as the complete pipeline.
            execution = run_pipeline(config, project_root=root, clear_before_import=True)
            return {
                "ok": execution.report.passed,
                "command": command,
                "outputDir": str(execution.output_dir),
                "manifest": execution.package_manifest,
            }
        raise McpCommandError(f"command {command!r} has no implementation")
    except (OSError, RuntimeError, ValueError) as error:
        return {
            "ok": False,
            "command": command,
            "error": str(error),
            "errorType": type(error).__name__,
        }
