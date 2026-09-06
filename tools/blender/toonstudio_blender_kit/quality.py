"""Deterministic character quality audit for Blender and CI."""
from __future__ import annotations

from dataclasses import dataclass
import math
from typing import Iterable, Mapping, Sequence

import bmesh
import bpy

from .contracts import PipelineConfig, QualityIssue, calculate_score
from .face import FaceBuildResult, discover_expression_keys
from .geometry import HairBuildResult


@dataclass(frozen=True)
class QualityAudit:
    score: int
    passed: bool
    metrics: Mapping[str, int | float | str | bool | list[str]]
    issues: tuple[QualityIssue, ...]


_REQUIRED_HUMANOID_GROUPS: tuple[tuple[str, ...], ...] = (
    ("hips",),
    ("spine",),
    ("chest", "upperchest"),
    ("neck",),
    ("head",),
    ("leftupperarm", "leftarm"),
    ("leftlowerarm", "leftforearm"),
    ("lefthand",),
    ("rightupperarm", "rightarm"),
    ("rightlowerarm", "rightforearm"),
    ("righthand",),
    ("leftupperleg", "leftupleg", "leftthigh"),
    ("leftlowerleg", "leftleg", "leftshin"),
    ("leftfoot",),
    ("rightupperleg", "rightupleg", "rightthigh"),
    ("rightlowerleg", "rightleg", "rightshin"),
    ("rightfoot",),
)


def _normalize(value: str) -> str:
    return "".join(character for character in value.casefold() if character.isalnum())


def _triangles(obj: bpy.types.Object) -> int:
    if obj.type != "MESH":
        return 0
    return sum(max(0, len(polygon.vertices) - 2) for polygon in obj.data.polygons)


def _mesh_topology_metrics(obj: bpy.types.Object) -> tuple[int, int]:
    mesh = obj.data
    bm = bmesh.new()
    try:
        bm.from_mesh(mesh)
        bm.normal_update()
        non_manifold = sum(1 for edge in bm.edges if not edge.is_manifold)
        scale = max(1e-8, obj.dimensions.length)
        area_epsilon = scale * scale * 1e-12
        degenerate = sum(1 for face in bm.faces if face.calc_area() <= area_epsilon)
        return non_manifold, degenerate
    finally:
        bm.free()


def _vertex_influence_metrics(obj: bpy.types.Object) -> tuple[int, int]:
    if obj.type != "MESH":
        return 0, 0
    maximum = 0
    over_four = 0
    for vertex in obj.data.vertices:
        count = sum(1 for group in vertex.groups if group.weight > 1e-5)
        maximum = max(maximum, count)
        if count > 4:
            over_four += 1
    return maximum, over_four


def _texture_metrics() -> tuple[int, int, list[str]]:
    maximum = 0
    oversized = 0
    names: list[str] = []
    for image in bpy.data.images:
        if image.name == "Render Result":
            continue
        width, height = image.size[:2]
        dimension = max(int(width), int(height))
        maximum = max(maximum, dimension)
        if dimension > 0:
            names.append(f"{image.name}:{width}x{height}")
    return maximum, oversized, names


def _armature_bone_coverage(armature: bpy.types.Object | None) -> tuple[int, list[str]]:
    if armature is None or armature.type != "ARMATURE":
        return 0, [group[0] for group in _REQUIRED_HUMANOID_GROUPS]
    names = {_normalize(bone.name) for bone in armature.data.bones}
    missing: list[str] = []
    covered = 0
    for aliases in _REQUIRED_HUMANOID_GROUPS:
        if any(any(alias in name or name.endswith(alias) for name in names) for alias in aliases):
            covered += 1
        else:
            missing.append(aliases[0])
    return covered, missing


def _issue(
    code: str,
    severity: str,
    message: str,
    *,
    object_name: str | None = None,
    metric: int | float | str | None = None,
    limit: int | float | str | None = None,
    repair_hint: str | None = None,
) -> QualityIssue:
    return QualityIssue(
        code=code,
        severity=severity,  # type: ignore[arg-type]
        message=message,
        object_name=object_name,
        metric=metric,
        limit=limit,
        repair_hint=repair_hint,
    )


def audit_character( # NOSONAR python:S3776
    config: PipelineConfig,
    mesh_objects: Sequence[bpy.types.Object],
    armature: bpy.types.Object | None,
    *,
    hair: HairBuildResult | None = None,
    face: FaceBuildResult | None = None,
) -> QualityAudit:
    budget = config.quality
    issues: list[QualityIssue] = []
    total_triangles = sum(_triangles(obj) for obj in mesh_objects if not obj.hide_render)
    mesh_count = sum(1 for obj in mesh_objects if obj.type == "MESH")
    material_count = len({material.name for obj in mesh_objects for material in obj.data.materials if material})
    hair_lod_triangles = list(hair.triangle_counts if hair else ())
    hair_materials = {
        material.name
        for obj in mesh_objects
        if obj.get("toonstudio_authored_hair") or obj.get("toonstudio_authored_hair_outline")
        for material in obj.data.materials
        if material
    }
    maximum_influences = 0
    vertices_over_influence_limit = 0
    non_manifold_total = 0
    degenerate_total = 0
    unapplied_objects: list[str] = []
    negative_scale_objects: list[str] = []

    for obj in mesh_objects:
        if obj.type != "MESH":
            continue
        non_manifold, degenerate = _mesh_topology_metrics(obj)
        non_manifold_total += non_manifold
        degenerate_total += degenerate
        max_influences, over_four = _vertex_influence_metrics(obj)
        maximum_influences = max(maximum_influences, max_influences)
        vertices_over_influence_limit += over_four
        scale_delta = max(abs(float(axis) - 1.0) for axis in obj.scale)
        if scale_delta > budget.max_unapplied_scale_delta:
            unapplied_objects.append(obj.name)
        if obj.scale.x * obj.scale.y * obj.scale.z < 0:
            negative_scale_objects.append(obj.name)

    texture_max, _, texture_names = _texture_metrics()
    covered_bones, missing_bones = _armature_bone_coverage(armature)
    expressions = discover_expression_keys(mesh_objects)
    shape_key_count = sum(
        max(0, len(obj.data.shape_keys.key_blocks) - 1)
        for obj in mesh_objects
        if obj.type == "MESH" and obj.data.shape_keys is not None
    )

    if total_triangles > budget.max_triangles_lod0:
        issues.append(_issue(
            "triangles.total.exceeded", "error",
            "Visible LOD0 character triangles exceed the production budget.",
            metric=total_triangles, limit=budget.max_triangles_lod0,
            repair_hint="Reduce hidden duplicate meshes or create a production LOD0 retopology.",
        ))
    if len(hair_materials) > budget.max_hair_materials:
        issues.append(_issue(
            "materials.hair.exceeded", "error",
            "Authored hair uses more materials than the portable runtime budget.",
            metric=len(hair_materials), limit=budget.max_hair_materials,
        ))
    if hair_lod_triangles and hair_lod_triangles[0] > budget.max_hair_triangles_lod0:
        issues.append(_issue(
            "triangles.hair.exceeded", "error",
            "Authored hair LOD0 exceeds the dedicated hair budget.",
            metric=hair_lod_triangles[0], limit=budget.max_hair_triangles_lod0,
            repair_hint="Lower clump density or section count; do not decimate facial silhouettes blindly.",
        ))
    if len(hair_lod_triangles) >= 3 and not (
        hair_lod_triangles[2] < hair_lod_triangles[1] < hair_lod_triangles[0]
    ):
        issues.append(_issue(
            "lod.hair.non_descending", "error",
            "Hair LOD triangle counts must strictly descend.",
            metric="/".join(str(value) for value in hair_lod_triangles),
        ))
    if non_manifold_total > budget.max_non_manifold_edges:
        issues.append(_issue(
            "topology.non_manifold", "error",
            "The package contains non-manifold mesh edges.",
            metric=non_manifold_total, limit=budget.max_non_manifold_edges,
            repair_hint="Close boundary holes or explicitly mark intentionally open cards in an authored profile.",
        ))
    if degenerate_total > budget.max_degenerate_faces:
        issues.append(_issue(
            "topology.degenerate", "error",
            "The package contains zero-area or near-zero-area faces.",
            metric=degenerate_total, limit=budget.max_degenerate_faces,
        ))
    if maximum_influences > budget.max_vertex_influences:
        issues.append(_issue(
            "skin.influences.exceeded", "error",
            "One or more vertices exceed the portable skin influence limit.",
            metric=maximum_influences, limit=budget.max_vertex_influences,
            repair_hint="Normalize and limit weights to four influences before VRM/glTF export.",
        ))
    if vertices_over_influence_limit:
        issues.append(_issue(
            "skin.vertices.over_limit", "warning",
            "Vertices with more than four non-zero weights were found.",
            metric=vertices_over_influence_limit, limit=0,
        ))
    if texture_max > budget.max_texture_size:
        issues.append(_issue(
            "texture.dimension.exceeded", "error",
            "At least one texture exceeds the configured maximum dimension.",
            metric=texture_max, limit=budget.max_texture_size,
            repair_hint="Keep archival sources separately and export 1K/2K/4K runtime variants.",
        ))
    if negative_scale_objects:
        issues.append(_issue(
            "transform.negative_scale", "error",
            "Negative object scale can invert tangents and outlines.",
            metric=len(negative_scale_objects),
            repair_hint="Apply transforms and correct normals before export.",
        ))
    if unapplied_objects:
        issues.append(_issue(
            "transform.unapplied_scale", "warning",
            "Objects contain unapplied scale outside the permitted tolerance.",
            metric=len(unapplied_objects),
            limit=budget.max_unapplied_scale_delta,
            repair_hint="Apply scale on authored meshes while preserving armature transforms.",
        ))
    if config.export.vrm:
        if armature is None:
            issues.append(_issue(
                "vrm.armature.missing", "error",
                "VRM export was requested but no armature was detected.",
            ))
        elif missing_bones:
            issues.append(_issue(
                "vrm.humanoid.incomplete", "error",
                "The detected armature is missing portable humanoid bone groups.",
                metric=", ".join(missing_bones),
                repair_hint="Map required humanoid bones with the official VRM Add-on before release.",
            ))
    if config.face.create_semantic_shape_keys:
        if face is None or not face.created_shape_keys:
            issues.append(_issue(
                "face.semantic_shapes.unavailable", "warning" if not config.strict else "error",
                "No safe semantic face-shape keys were created.",
                metric=face.confidence if face else 0,
                limit=config.face.minimum_detection_confidence,
                repair_hint="Tag the intended mesh with toonstudio_face_mesh=true or supply an authored face profile.",
            ))
        elif face.confidence < config.face.minimum_detection_confidence:
            issues.append(_issue(
                "face.detection.low_confidence", "error",
                "Face mesh detection confidence is below the configured threshold.",
                metric=round(face.confidence, 3), limit=config.face.minimum_detection_confidence,
            ))
    if config.hair.enabled and hair is None:
        issues.append(_issue(
            "hair.authored.missing", "error",
            "Authored hair was enabled but no hair result was produced.",
        ))
    if config.hair.enabled and hair and not hair.lod_objects:
        issues.append(_issue(
            "hair.authored.empty", "error",
            "Authored hair generation produced no visible LOD object.",
        ))

    # Informational receipts are useful in machine-readable release reports without lowering quality.
    if expressions:
        issues.append(_issue(
            "face.expression.preserved", "info",
            "Existing expression shape keys remain separate from semantic authoring keys.",
            metric=len(expressions),
        ))

    score = calculate_score(issues)
    passed = score >= budget.minimum_score and not any(issue.severity == "error" for issue in issues)
    metrics: dict[str, int | float | str | bool | list[str]] = {
        "meshCount": mesh_count,
        "materialCount": material_count,
        "visibleTrianglesLod0": total_triangles,
        "hairTriangles": hair_lod_triangles,
        "hairMaterialCount": len(hair_materials),
        "maximumVertexInfluences": maximum_influences,
        "verticesOverFourInfluences": vertices_over_influence_limit,
        "nonManifoldEdges": non_manifold_total,
        "degenerateFaces": degenerate_total,
        "maximumTextureDimension": texture_max,
        "textures": texture_names,
        "unappliedScaleObjects": sorted(unapplied_objects),
        "negativeScaleObjects": sorted(negative_scale_objects),
        "humanoidBoneGroupsCovered": covered_bones,
        "humanoidBoneGroupsTotal": len(_REQUIRED_HUMANOID_GROUPS),
        "missingHumanoidBoneGroups": missing_bones,
        "shapeKeyCount": shape_key_count,
        "expressionShapeKeyCount": len(expressions),
        "semanticFaceShapeCount": len(face.created_shape_keys) if face else 0,
        "faceDetectionConfidence": round(face.confidence, 4) if face else 0.0,
        "hairStyle": hair.style if hair else "none",
        "passed": passed,
    }
    return QualityAudit(score, passed, metrics, tuple(issues))
