"""Production character authoring pipeline for Blender 5.2+ and ToonStudio.

The pipeline is deterministic, background-safe, and compatible with a live MCP
session: it never resets Blender preferences, installs packages, runs shell
commands, or evaluates arbitrary code.
"""
from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
import json
from pathlib import Path
import shutil
from typing import Any, Iterable, Mapping, Sequence

import bpy
from mathutils import Vector

from .contracts import (
    BLENDER_MIN_VERSION,
    DEFAULT_VRM_ADDON_VERSION,
    PipelineConfig,
    PipelineReport,
    QualityIssue,
    calculate_score,
    write_json,
)
from .face import FaceBuildResult, create_semantic_face_shape_keys
from .geometry import (
    HairBuildResult,
    build_authored_hair,
    create_reference_head,
    infer_head_frame,
    parent_hair_to_head,
)
from .materials import create_outline_material, create_skin_material, create_toon_material
from .quality import QualityAudit, audit_character
from .render import RenderResult, render_quality_views
from .vrm import VrmExpressionBindingResult, bind_semantic_vrm1_expressions

QUALITY_REPORT_FILENAME = "quality-report.json"


@dataclass(frozen=True)
class PipelineExecution:
    report: PipelineReport
    package_manifest: Mapping[str, Any]
    output_dir: Path


class PipelineFailure(RuntimeError):
    """Raised when a strict Blender package cannot satisfy its contract."""


def _version_text(version: Sequence[int]) -> str:
    return ".".join(str(value) for value in version)


def _assert_blender_version() -> None:
    current = tuple(int(value) for value in bpy.app.version[:3])
    if current < BLENDER_MIN_VERSION:
        raise PipelineFailure(
            f"Blender {_version_text(BLENDER_MIN_VERSION)}+ is required; "
            f"found {_version_text(current)}"
        )


def _operator_kwargs(operator: Any, raw: Mapping[str, Any]) -> dict[str, Any]:
    try:
        identifiers = {
            prop.identifier
            for prop in operator.get_rna_type().properties
            if prop.identifier != "rna_type"
        }
    except (AttributeError, RuntimeError):
        return dict(raw)
    return {key: value for key, value in raw.items() if key in identifiers}


def _call_operator(operator: Any, *args: Any, **kwargs: Any) -> set[str]:
    return operator(*args, **_operator_kwargs(operator, kwargs))


def _clear_scene_objects() -> None:
    """Clear scene data without touching user preferences or MCP extensions."""

    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    # Remove only orphaned local blocks. Add-on/preferences state stays intact.
    for collection in (
        bpy.data.meshes,
        bpy.data.curves,
        bpy.data.armatures,
        bpy.data.materials,
        bpy.data.cameras,
        bpy.data.lights,
    ):
        for datablock in list(collection):
            if datablock.users == 0:
                collection.remove(datablock)


def _resolve_path(root: Path, value: str | None) -> Path | None:
    if not value:
        return None
    candidate = Path(value).expanduser()
    return candidate.resolve() if candidate.is_absolute() else (root / candidate).resolve()


def _safe_output_dir(root: Path, config: PipelineConfig) -> Path:
    output_base = _resolve_path(root, config.output_dir)
    if output_base is None:
        raise PipelineFailure("output_dir could not be resolved")
    allow_external = bool(bpy.context.scene.get("toonstudio_allow_external_output", False))
    try:
        output_base.relative_to(root)
    except ValueError:
        if not allow_external:
            raise PipelineFailure(
                "external output paths are disabled; set scene['toonstudio_allow_external_output']=True "
                "for an explicit trusted MCP session"
            )
    output_dir = output_base / config.character_id
    output_dir.mkdir(parents=True, exist_ok=True)
    return output_dir


def _import_blend(path: Path) -> None:
    with bpy.data.libraries.load(str(path), link=False) as (source, target):
        target.objects = list(source.objects)
    for obj in target.objects:
        if obj is not None and obj.name not in bpy.context.scene.collection.objects:
            bpy.context.scene.collection.objects.link(obj)


def _import_source(path: Path) -> None: # NOSONAR python:S3776
    if not path.exists() or not path.is_file():
        raise PipelineFailure(f"input character does not exist: {path}")
    suffix = path.suffix.casefold()
    if suffix == ".vrm":
        operator = getattr(bpy.ops.import_scene, "vrm", None)
        if operator is None:
            raise PipelineFailure(
                "VRM Add-on is required to import .vrm files; install VRM Add-on for Blender 4.5+"
            )
        result = _call_operator(operator, filepath=str(path))
    elif suffix in {".glb", ".gltf"}:
        result = _call_operator(bpy.ops.import_scene.gltf, filepath=str(path))
    elif suffix == ".blend":
        _import_blend(path)
        return
    elif suffix == ".fbx":
        operator = getattr(bpy.ops.import_scene, "fbx", None)
        if operator is None:
            raise PipelineFailure("FBX importer is unavailable in this Blender build")
        result = _call_operator(operator, filepath=str(path), use_anim=True)
    elif suffix == ".obj":
        operator = getattr(bpy.ops.wm, "obj_import", None)
        if operator is None:
            raise PipelineFailure("OBJ importer is unavailable in this Blender build")
        result = _call_operator(operator, filepath=str(path))
    else:
        raise PipelineFailure(f"unsupported input format: {suffix or '<none>'}")
    if "FINISHED" not in result:
        raise PipelineFailure(f"character import failed: {sorted(result)}")


def _find_primary_armature(objects: Iterable[bpy.types.Object]) -> bpy.types.Object | None:
    armatures = [obj for obj in objects if obj.type == "ARMATURE"]
    if not armatures:
        return None
    return max(armatures, key=lambda obj: (len(obj.data.bones), obj.name))


def _mesh_objects(objects: Iterable[bpy.types.Object]) -> list[bpy.types.Object]:
    return [obj for obj in objects if obj.type == "MESH"]


def _reference_eye(
    name: str,
    location: Vector,
    scale: tuple[float, float, float],
    material: bpy.types.Material,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_uv_sphere_add(segments=28, ring_count=18, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(material)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    return obj


def _create_reference_scene() -> None:
    head, frame = create_reference_head()
    head["toonstudio_face_mesh"] = True
    skin = create_skin_material()
    from .contracts import Palette

    eye_palette = Palette(base="#202433", shadow="#080a10", highlight="#708cff", outline="#05060a")
    eye_material = create_toon_material("TS_ReferenceEyes", eye_palette, role="eye", use_vertex_color=False)
    eye_center = frame.center + frame.front * frame.radius_z * 0.88 + frame.up * frame.radius_y * 0.05
    for sign, suffix in ((-1.0, "L"), (1.0, "R")):
        _reference_eye(
            f"TS_ReferenceEye_{suffix}",
            eye_center + frame.right * frame.radius_x * 0.34 * sign,
            (frame.radius_x * 0.18, frame.radius_z * 0.11, frame.radius_y * 0.23),
            eye_material,
        )
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=32,
        radius=0.060,
        depth=0.15,
        location=frame.center - frame.up * (frame.radius_y + 0.065),
    )
    neck = bpy.context.object
    neck.name = "TS_ReferenceNeck"
    neck.data.materials.append(skin)
    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=40,
        ring_count=20,
        location=frame.center - frame.up * (frame.radius_y + 0.20),
    )
    bust = bpy.context.object
    bust.name = "TS_ReferenceBust"
    bust.scale = (0.32, 0.16, 0.22)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bust.data.materials.append(create_toon_material(
        "TS_ReferenceCostume",
        Palette(base="#323d64", shadow="#11162b", highlight="#7387c6", outline="#080b16"),
        role="costume",
        use_vertex_color=False,
    ))


def _object_tokens(obj: bpy.types.Object) -> tuple[str, ...]:
    values = [obj.name]
    if obj.type == "MESH":
        values.extend(material.name for material in obj.data.materials if material)
    return tuple("".join(ch for ch in value.casefold() if ch.isalnum()) for value in values)


def _hide_replaceable_hair(meshes: Sequence[bpy.types.Object]) -> tuple[str, ...]:
    hidden: list[str] = []
    protected = ("face", "skin", "body", "head", "eye", "brow", "cloth", "outfit")
    for obj in meshes:
        tokens = _object_tokens(obj)
        has_hair = any("hair" in token or "kami" in token for token in tokens)
        has_protected = any(any(marker in token for marker in protected) for token in tokens)
        if has_hair and not has_protected and not obj.get("toonstudio_authored_hair"):
            obj.hide_render = True
            obj.hide_set(True)
            obj["toonstudio_replaced_hair"] = True
            hidden.append(obj.name)
    return tuple(sorted(hidden))


def _annotate_scene(config: PipelineConfig, source: Path | None) -> None:
    scene = bpy.context.scene
    scene["toonstudio_pipeline_version"] = 1
    scene["toonstudio_character_id"] = config.character_id
    scene["toonstudio_display_name"] = config.display_name
    scene["toonstudio_config_digest"] = config.digest()
    scene["toonstudio_source"] = str(source) if source else "generated-reference"
    for key, value in config.provenance.items():
        scene[f"toonstudio_provenance_{key}"] = value
    for obj in scene.objects:
        if obj.type in {"MESH", "ARMATURE"}:
            obj["toonstudio_character_id"] = config.character_id
            obj["toonstudio_pipeline_version"] = 1


def _selection_export(objects: Sequence[bpy.types.Object], callback: Any) -> set[str]:
    state = [(obj, obj.hide_get(), obj.hide_viewport, obj.select_get()) for obj in bpy.context.scene.objects]
    try:
        bpy.ops.object.select_all(action="DESELECT")
        active: bpy.types.Object | None = None
        allowed = set(objects)
        for obj in bpy.context.scene.objects:
            if obj not in allowed:
                continue
            obj.hide_set(False)
            obj.hide_viewport = False
            obj.select_set(True)
            if active is None or obj.type == "ARMATURE":
                active = obj
        if active is not None:
            bpy.context.view_layer.objects.active = active
        return callback()
    finally:
        bpy.ops.object.select_all(action="DESELECT")
        for obj, hidden, hide_viewport, selected in state:
            if obj.name not in bpy.data.objects:
                continue
            obj.hide_set(hidden)
            obj.hide_viewport = hide_viewport
            obj.select_set(selected)


def _character_export_objects(
    meshes: Sequence[bpy.types.Object],
    armature: bpy.types.Object | None,
    *,
    include_lods: bool,
    include_outlines: bool,
) -> list[bpy.types.Object]:
    result: list[bpy.types.Object] = []
    if armature is not None:
        result.append(armature)
    for obj in meshes:
        if obj.get("toonstudio_replaced_hair"):
            continue
        lod = int(obj.get("toonstudio_lod", 0))
        if lod > 0 and not include_lods:
            continue
        if obj.get("toonstudio_authored_hair_outline") and not include_outlines:
            continue
        result.append(obj)
    return result


def _export_glb(
    path: Path,
    config: PipelineConfig,
    objects: Sequence[bpy.types.Object],
) -> None:
    def export() -> set[str]:
        return _call_operator(
            bpy.ops.export_scene.gltf,
            filepath=str(path),
            export_format="GLB",
            use_selection=True,
            export_extras=True,
            export_yup=True,
            export_apply=config.export.apply_modifiers,
            export_animations=config.export.export_animations,
            export_morph=True,
            export_morph_normal=config.export.export_morph_normals,
            export_morph_tangent=False,
            export_skins=True,
            export_all_influences=False,
            export_cameras=False,
            export_lights=False,
            export_visible=False,
        )

    result = _selection_export(objects, export)
    if "FINISHED" not in result or not path.exists():
        raise PipelineFailure(f"GLB export failed: {sorted(result)}")


def _export_vrm(
    path: Path,
    armature: bpy.types.Object,
    objects: Sequence[bpy.types.Object],
    config: PipelineConfig,
) -> None:
    operator = getattr(bpy.ops.export_scene, "vrm", None)
    validate = getattr(bpy.ops.vrm, "model_validate", None)
    if operator is None or validate is None:
        raise PipelineFailure("official VRM Add-on operators are unavailable")

    def export() -> set[str]:
        validation = _call_operator(
            validate,
            "EXEC_DEFAULT",
            show_successful_message=False,
            armature_object_name=armature.name,
        )
        if "FINISHED" not in validation:
            raise PipelineFailure(f"VRM validation failed: {sorted(validation)}")
        return _call_operator(
            operator,
            filepath=str(path),
            armature_object_name=armature.name,
            use_addon_preferences=False,
            export_invisibles=False,
            export_only_selections=True,
            enable_advanced_preferences=True,
            export_all_influences=False,
            export_lights=False,
            export_gltf_animations=config.export.export_animations,
            export_try_sparse_sk=True,
            ignore_warning=True,
        )

    result = _selection_export(objects, export)
    if "FINISHED" not in result or not path.exists():
        raise PipelineFailure(f"VRM export failed: {sorted(result)}")


def _file_sha256(path: Path) -> str:
    digest = sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _detect_vrm_addon_version() -> str | None:
    if getattr(bpy.ops.import_scene, "vrm", None) is None:
        return None
    for module_name in bpy.context.preferences.addons.keys():
        normalized = module_name.casefold()
        if "vrm" not in normalized:
            continue
        try:
            module = __import__(module_name, fromlist=["bl_info"])
            version = getattr(module, "bl_info", {}).get("version")
            if version:
                return _version_text(version)
        except (ImportError, AttributeError, TypeError):
            continue
    return DEFAULT_VRM_ADDON_VERSION + "+"


def _build_manifest(
    config: PipelineConfig,
    report: PipelineReport,
    outputs: Mapping[str, str],
    output_dir: Path,
    hair: HairBuildResult | None,
    face: FaceBuildResult | None,
    hidden_hair: Sequence[str],
    vrm_expressions: VrmExpressionBindingResult | None,
    source_sha256: str | None,
) -> dict[str, Any]:
    files: dict[str, Any] = {}
    for role, relative in sorted(outputs.items()):
        path = output_dir / relative
        if path.is_file():
            files[role] = {
                "path": relative,
                "bytes": path.stat().st_size,
                "sha256": _file_sha256(path),
            }
    return {
        "schemaVersion": 1,
        "kind": "toonstudio.character-package",
        "characterId": config.character_id,
        "displayName": config.display_name,
        "configDigest": config.digest(),
        "pipelineVersion": 1,
        "capabilities": {
            "authoredHair": {
                "enabled": hair is not None,
                "style": hair.style if hair else None,
                "lodTriangles": list(hair.triangle_counts) if hair else [],
                "replacedSourceMeshes": list(hidden_hair),
            },
            "semanticFaceShapes": {
                "mode": face.mode if face else "none",
                "confidence": face.confidence if face else 0.0,
                "objects": list(face.object_names) if face else [],
                "shapeKeys": list(face.created_shape_keys) if face else [],
            },
            "mtoonReady": _detect_vrm_addon_version() is not None,
            "vrmCustomExpressions": {
                "status": vrm_expressions.status if vrm_expressions else "unavailable",
                "names": list(vrm_expressions.expression_names) if vrm_expressions else [],
            },
            "lods": bool(hair and len(hair.lod_objects) > 1),
        },
        "quality": {
            "score": report.score,
            "passed": report.passed,
            "minimumScore": config.quality.minimum_score,
            "report": QUALITY_REPORT_FILENAME,
        },
        "files": files,
        "provenance": {
            **dict(sorted(config.provenance.items())),
            **({"sourceActualSha256": source_sha256} if source_sha256 else {}),
        },
    }


def _append_export_issue(issues: list[QualityIssue], code: str, message: str) -> None:
    issues.append(QualityIssue(code=code, severity="error", message=message))


def run_pipeline( # NOSONAR python:S3776
    config: PipelineConfig,
    *,
    project_root: str | Path,
    clear_before_import: bool = True,
) -> PipelineExecution:
    config.validate()
    _assert_blender_version()
    root = Path(project_root).resolve()
    output_dir = _safe_output_dir(root, config)
    if output_dir.exists():
        for entry in output_dir.iterdir():
            if entry.is_dir():
                shutil.rmtree(entry)
            else:
                entry.unlink()
    output_dir.mkdir(parents=True, exist_ok=True)

    if clear_before_import:
        _clear_scene_objects()
    source = _resolve_path(root, config.input_path)
    source_sha256: str | None = None
    if source is not None:
        allow_external_input = bool(bpy.context.scene.get("toonstudio_allow_external_input", False))
        try:
            source.relative_to(root)
        except ValueError:
            if not allow_external_input:
                raise PipelineFailure(
                    "external input paths are disabled; set scene['toonstudio_allow_external_input']=True "
                    "only for a trusted isolated MCP session"
                )
        if not source.exists() or not source.is_file():
            raise PipelineFailure(f"input character does not exist: {source}")
        source_sha256 = _file_sha256(source)
        expected_source_sha = config.provenance.get("sourceSha256")
        if expected_source_sha and source_sha256 != expected_source_sha.casefold():
            raise PipelineFailure(
                f"input source SHA-256 mismatch: expected {expected_source_sha}, found {source_sha256}"
            )
    if config.mode == "reference":
        _create_reference_scene()
    elif source is not None:
        _import_source(source)

    scene_objects = list(bpy.context.scene.objects)
    meshes = _mesh_objects(scene_objects)
    armature = _find_primary_armature(scene_objects)
    if not meshes:
        raise PipelineFailure("the imported scene contains no mesh objects")
    frame = infer_head_frame(armature, meshes)
    _annotate_scene(config, source)

    hidden_hair: tuple[str, ...] = ()
    if config.mode != "audit" and config.hair.enabled and config.hair.replace_detected_hair:
        hidden_hair = _hide_replaceable_hair(meshes)

    face_result: FaceBuildResult | None = None
    hair_result: HairBuildResult | None = None
    vrm_expression_result: VrmExpressionBindingResult | None = None
    if config.mode != "audit":
        face_result = create_semantic_face_shape_keys(meshes, frame, config.face)
        vrm_expression_result = bind_semantic_vrm1_expressions(armature, face_result)
        if config.hair.enabled:
            hair_result = build_authored_hair(frame, config.hair)
            parent_hair_to_head(hair_result, armature)
            meshes = _mesh_objects(bpy.context.scene.objects)

    audit: QualityAudit = audit_character(
        config,
        meshes,
        armature,
        hair=hair_result,
        face=face_result,
    )
    issues = list(audit.issues)
    outputs: dict[str, str] = {}

    # Save/export before adding quality-review camera and lights.
    if config.export.blend:
        blend_path = output_dir / f"{config.character_id}.blend"
        try:
            result = _call_operator(bpy.ops.wm.save_as_mainfile, filepath=str(blend_path), copy=True, compress=True)
            if "FINISHED" not in result or not blend_path.exists():
                raise PipelineFailure(f"Blend save failed: {sorted(result)}")
            outputs["blend"] = blend_path.name
        except Exception as error:  # Blender operators expose heterogeneous exceptions.
            _append_export_issue(issues, "export.blend.failed", str(error))

    if config.export.glb:
        glb_path = output_dir / f"{config.character_id}.glb"
        try:
            export_objects = _character_export_objects(
                meshes, armature, include_lods=True, include_outlines=True
            )
            _export_glb(glb_path, config, export_objects)
            outputs["glb"] = glb_path.name
        except Exception as error:
            _append_export_issue(issues, "export.glb.failed", str(error))

    if config.export.vrm:
        vrm_path = output_dir / f"{config.character_id}.vrm"
        try:
            if armature is None:
                raise PipelineFailure("VRM export requires an armature")
            export_objects = _character_export_objects(
                meshes, armature, include_lods=False, include_outlines=False
            )
            _export_vrm(vrm_path, armature, export_objects, config)
            outputs["vrm"] = vrm_path.name
        except Exception as error:
            _append_export_issue(issues, "export.vrm.failed", str(error))

    render_result: RenderResult = render_quality_views(
        list(bpy.context.scene.objects),
        frame,
        config.render,
        output_dir / "previews",
    )
    for role, relative in render_result.outputs.items():
        outputs[role] = str(Path("previews") / relative)
    neutral_front = outputs.get("preview:neutral:front")
    if neutral_front:
        outputs["thumbnail"] = neutral_front

    # Declare stable sibling paths before serialising the report.  The report can
    # reference its manifest without hashing itself; the manifest is written only
    # after the final report bytes exist, so its qualityReport receipt is immutable.
    outputs["qualityReport"] = "quality-report.json"
    outputs["manifest"] = "character-package.json"

    score = calculate_score(issues)
    passed = score >= config.quality.minimum_score and not any(issue.severity == "error" for issue in issues)
    report = PipelineReport(
        character_id=config.character_id,
        config_digest=config.digest(),
        blender_version=_version_text(bpy.app.version[:3]),
        vrm_addon_version=_detect_vrm_addon_version(),
        score=score,
        passed=passed,
        metrics={
            **dict(audit.metrics),
            "hiddenSourceHairMeshes": list(hidden_hair),
            "renderedViews": list(render_result.rendered_views),
            "renderedExpressions": list(render_result.rendered_expressions),
            "outputCount": len(outputs),
            "sourceActualSha256": source_sha256 or "generated-reference",
            "vrmCustomExpressionStatus": (
                vrm_expression_result.status if vrm_expression_result else "unavailable"
            ),
            "vrmCustomExpressionCount": (
                len(vrm_expression_result.expression_names) if vrm_expression_result else 0
            ),
        },
        issues=tuple(issues),
        outputs=dict(outputs),
    )
    write_json(output_dir / QUALITY_REPORT_FILENAME, report.to_mapping())
    manifest = _build_manifest(
        config,
        report,
        outputs,
        output_dir,
        hair_result,
        face_result,
        hidden_hair,
        vrm_expression_result,
        source_sha256,
    )
    write_json(output_dir / "character-package.json", manifest)

    if config.strict and not report.passed:
        errors = [issue.message for issue in report.issues if issue.severity == "error"]
        raise PipelineFailure(
            f"character package failed quality gate with score {report.score}: "
            + ("; ".join(errors[:5]) or "minimum score was not reached")
        )
    return PipelineExecution(report, manifest, output_dir)
