"""Semantic face-shape generation for Blender character assets.

The module adds *new* authoring shape keys and never rewrites existing expression
keys.  It prefers explicit metadata and head-bone weights, then falls back to a
bounded geometric detector.  Ambiguous meshes fail closed.
"""
from __future__ import annotations

from dataclasses import dataclass
import math
import re
from typing import Callable, Iterable, Sequence

import bpy
from mathutils import Matrix, Vector

from .contracts import FaceOptions
from .geometry import HeadFrame


@dataclass(frozen=True)
class FaceDetection:
    objects: tuple[bpy.types.Object, ...]
    confidence: float
    reasons: tuple[str, ...]


@dataclass(frozen=True)
class FaceBuildResult:
    object_names: tuple[str, ...]
    created_shape_keys: tuple[str, ...]
    skipped_shape_keys: tuple[str, ...]
    confidence: float
    mode: str


@dataclass(frozen=True)
class SemanticShape:
    semantic_id: str
    positive_name: str
    negative_name: str
    positive_label: str
    negative_label: str
    displacement: Callable[[float, float, float], tuple[float, float, float]]
    weight: Callable[[float, float, float], float]


_TOKEN_RE = re.compile(r"[^a-z0-9]+")
_FACE_HINTS = ("face", "head", "skin", "body", "avatar")
_FACE_MATERIAL_HINTS = ("face", "skin", "head")
_EXCLUDE_HINTS = (
    "hair", "brow", "eyebrow", "eyelash", "lash", "eye", "iris", "pupil",
    "teeth", "tooth", "tongue", "mouthinside", "accessory", "cloth", "outfit",
)
_EXPRESSION_HINTS = (
    "blink", "wink", "look", "gaze", "happy", "joy", "angry", "anger", "sad",
    "sorrow", "relaxed", "surprised", "surprise", "fun", "smile", "frown",
    "phoneme", "viseme", "vrcv", "moutha", "mouthi", "mouthu", "mouthe", "moutho",
)


def _normalize(value: str) -> str:
    return _TOKEN_RE.sub("", value.casefold())


def _smoothstep(edge0: float, edge1: float, value: float) -> float:
    if edge0 == edge1:
        return float(value >= edge1)
    t = max(0.0, min(1.0, (value - edge0) / (edge1 - edge0)))
    return t * t * (3.0 - 2.0 * t)


def _bell(value: float, center: float, radius: float) -> float:
    if radius <= 0:
        return 0.0
    normalized = abs(value - center) / radius
    if normalized >= 1:
        return 0.0
    return (1.0 - normalized * normalized) ** 2


def _front_weight(depth: float) -> float:
    return _smoothstep(-0.05, 0.42, depth)


def _eye_weight(x: float, depth: float, z: float) -> float:
    eye_x = 0.36 if x >= 0 else -0.36
    return (
        _bell(x, eye_x, 0.34)
        * _bell(z, 0.12, 0.30)
        * _front_weight(depth)
    )


def _nose_weight(x: float, depth: float, z: float) -> float:
    return _bell(x, 0.0, 0.30) * _bell(z, -0.08, 0.34) * _front_weight(depth)


def _mouth_weight(x: float, depth: float, z: float) -> float:
    return _bell(x, 0.0, 0.52) * _bell(z, -0.40, 0.24) * _front_weight(depth)


def _cheek_weight(x: float, depth: float, z: float) -> float:
    center = 0.48 if x >= 0 else -0.48
    return _bell(x, center, 0.34) * _bell(z, -0.16, 0.36) * _front_weight(depth)


def _jaw_weight(x: float, depth: float, z: float) -> float:
    return _smoothstep(0.18, 0.82, abs(x)) * _smoothstep(-0.10, -0.68, z) * _front_weight(depth)


def _chin_weight(x: float, depth: float, z: float) -> float:
    return _bell(x, 0.0, 0.48) * _smoothstep(-0.30, -0.86, z) * _front_weight(depth)


def _ear_weight(x: float, depth: float, z: float) -> float:
    return _smoothstep(0.66, 0.90, abs(x)) * _bell(depth, 0.0, 0.48) * _bell(z, -0.02, 0.45)


def _shape_specs(maximum_ratio: float) -> tuple[SemanticShape, ...]:
    amount = maximum_ratio
    return (
        SemanticShape(
            "eyeSize", "faceEyeSizeBig", "faceEyeSizeSmall", "Eye size +", "Eye size -",
            lambda x, _d, z: (math.copysign(abs(x - math.copysign(0.36, x)) * amount * 0.55, x), 0.0, (z - 0.12) * amount * 0.78),
            _eye_weight,
        ),
        SemanticShape(
            "eyeSpacing", "faceEyeSpacingWide", "faceEyeSpacingNarrow", "Eye spacing +", "Eye spacing -",
            lambda x, _d, _z: (math.copysign(amount * 0.34, x), 0.0, 0.0),
            _eye_weight,
        ),
        SemanticShape(
            "eyeTilt", "faceEyeTiltUp", "faceEyeTiltDown", "Eye tilt +", "Eye tilt -",
            lambda x, _d, _z: (0.0, 0.0, math.copysign(amount * 0.28, x) * _smoothstep(0.22, 0.64, abs(x))),
            _eye_weight,
        ),
        SemanticShape(
            "noseHeight", "faceNoseHeightHigh", "faceNoseHeightLow", "Nose height +", "Nose height -",
            lambda _x, _d, _z: (0.0, 0.0, amount * 0.34),
            _nose_weight,
        ),
        SemanticShape(
            "noseWidth", "faceNoseWidthWide", "faceNoseWidthNarrow", "Nose width +", "Nose width -",
            lambda x, _d, _z: (math.copysign(amount * 0.28, x if abs(x) > 1e-6 else 1.0), 0.0, 0.0),
            _nose_weight,
        ),
        SemanticShape(
            "noseDepth", "faceNoseDepthHigh", "faceNoseDepthLow", "Nose depth +", "Nose depth -",
            lambda _x, _d, _z: (0.0, amount * 0.38, 0.0),
            _nose_weight,
        ),
        SemanticShape(
            "mouthWidth", "faceMouthWidthWide", "faceMouthWidthNarrow", "Mouth width +", "Mouth width -",
            lambda x, _d, _z: (math.copysign(amount * 0.42, x if abs(x) > 1e-6 else 1.0), 0.0, 0.0),
            _mouth_weight,
        ),
        SemanticShape(
            "lipFullness", "faceLipFullnessHigh", "faceLipFullnessLow", "Lip fullness +", "Lip fullness -",
            lambda _x, _d, z: (0.0, amount * 0.42, math.copysign(amount * 0.10, z + 0.40)),
            _mouth_weight,
        ),
        SemanticShape(
            "jawWidth", "faceJawWidthWide", "faceJawWidthNarrow", "Jaw width +", "Jaw width -",
            lambda x, _d, _z: (math.copysign(amount * 0.46, x if abs(x) > 1e-6 else 1.0), 0.0, 0.0),
            _jaw_weight,
        ),
        SemanticShape(
            "chinLength", "faceChinLengthLong", "faceChinLengthShort", "Chin length +", "Chin length -",
            lambda _x, _d, _z: (0.0, 0.0, -amount * 0.50),
            _chin_weight,
        ),
        SemanticShape(
            "cheekVolume", "faceCheekVolumeHigh", "faceCheekVolumeLow", "Cheek volume +", "Cheek volume -",
            lambda x, _d, _z: (math.copysign(amount * 0.18, x), amount * 0.44, 0.0),
            _cheek_weight,
        ),
        SemanticShape(
            "earSize", "faceEarSizeBig", "faceEarSizeSmall", "Ear size +", "Ear size -",
            lambda x, _d, z: (math.copysign(amount * 0.34, x), 0.0, z * amount * 0.22),
            _ear_weight,
        ),
    )


def is_expression_shape_key(name: str) -> bool:
    normalized = _normalize(name)
    return any(token in normalized for token in _EXPRESSION_HINTS)


def _material_names(obj: bpy.types.Object) -> tuple[str, ...]:
    if obj.type != "MESH":
        return ()
    return tuple(slot.material.name for slot in obj.material_slots if slot.material)


def _head_group_weight_ratio(obj: bpy.types.Object) -> float:
    if obj.type != "MESH" or not obj.vertex_groups or not obj.data.vertices:
        return 0.0
    head_groups = {
        group.index
        for group in obj.vertex_groups
        if any(token in _normalize(group.name) for token in ("head", "face", "neck"))
    }
    if not head_groups:
        return 0.0
    step = max(1, len(obj.data.vertices) // 1200)
    sampled = 0
    weighted = 0
    for index in range(0, len(obj.data.vertices), step):
        vertex = obj.data.vertices[index]
        sampled += 1
        if any(group.group in head_groups and group.weight > 0.04 for group in vertex.groups):
            weighted += 1
    return weighted / max(1, sampled)


def _head_region_ratio(obj: bpy.types.Object, frame: HeadFrame) -> float:
    if obj.type != "MESH" or not obj.data.vertices:
        return 0.0
    step = max(1, len(obj.data.vertices) // 1200)
    sampled = 0
    inside = 0
    for index in range(0, len(obj.data.vertices), step):
        vertex = obj.data.vertices[index]
        world = obj.matrix_world @ vertex.co
        delta = world - frame.center
        x = delta.dot(frame.right) / max(1e-6, frame.radius_x)
        depth = delta.dot(frame.front) / max(1e-6, frame.radius_z)
        z = delta.dot(frame.up) / max(1e-6, frame.radius_y)
        sampled += 1
        if x * x + (depth * 0.82) ** 2 + (z * 0.88) ** 2 <= 1.7:
            inside += 1
    return inside / max(1, sampled)


def detect_face_meshes( # NOSONAR python:S3776
    mesh_objects: Sequence[bpy.types.Object],
    frame: HeadFrame,
    options: FaceOptions,
) -> FaceDetection:
    candidates: list[tuple[float, bpy.types.Object, tuple[str, ...]]] = []
    for obj in mesh_objects:
        if obj.type != "MESH" or len(obj.data.vertices) < 120:
            continue
        name = _normalize(obj.name)
        materials = tuple(_normalize(value) for value in _material_names(obj))
        if obj.get("toonstudio_authored_hair") or any(token in name for token in _EXCLUDE_HINTS):
            continue
        if any(any(token in material for token in _EXCLUDE_HINTS) for material in materials):
            continue

        score = 0.0
        reasons: list[str] = []
        if obj.get("toonstudio_face_mesh") is True:
            score += 0.58
            reasons.append("explicit toonstudio_face_mesh metadata")
        if any(token in name for token in _FACE_HINTS):
            score += 0.18
            reasons.append("face-like object name")
        if any(any(token in material for token in _FACE_MATERIAL_HINTS) for material in materials):
            score += 0.16
            reasons.append("face-like material name")
        group_ratio = _head_group_weight_ratio(obj)
        if group_ratio > 0.01:
            score += min(0.30, 0.11 + group_ratio * 1.8)
            reasons.append(f"head-bone weighted vertices {group_ratio:.1%}")
        region_ratio = _head_region_ratio(obj, frame)
        if region_ratio > 0.01:
            score += min(0.28, 0.08 + region_ratio * 0.9)
            reasons.append(f"head-region vertices {region_ratio:.1%}")
        if len(obj.data.vertices) >= 800:
            score += 0.04
        if score >= options.minimum_detection_confidence:
            candidates.append((min(1.0, score), obj, tuple(reasons)))

    candidates.sort(key=lambda item: (-item[0], -len(item[1].data.vertices), item[1].name))
    if not candidates:
        return FaceDetection((), 0.0, ("no mesh crossed the conservative face threshold",))
    # One combined body mesh or up to three explicitly split skin/face meshes.
    best_score = candidates[0][0]
    admitted = [item for item in candidates if item[0] >= max(options.minimum_detection_confidence, best_score - 0.12)][:3]
    if options.require_explicit_face_mesh:
        admitted = [item for item in admitted if item[1].get("toonstudio_face_mesh") is True]
        if not admitted:
            return FaceDetection((), 0.0, ("explicit face mesh metadata was required",))
    return FaceDetection(
        tuple(item[1] for item in admitted),
        min(item[0] for item in admitted),
        tuple(reason for item in admitted for reason in item[2]),
    )


def _ensure_basis(obj: bpy.types.Object) -> None:
    if obj.data.shape_keys is None:
        obj.shape_key_add(name="Basis", from_mix=False)


def _shape_key(obj: bpy.types.Object, name: str) -> bpy.types.ShapeKey:
    _ensure_basis(obj)
    existing = obj.data.shape_keys.key_blocks.get(name)
    if existing is not None:
        return existing
    key = obj.shape_key_add(name=name, from_mix=False)
    key.slider_min = 0.0
    key.slider_max = 1.0
    return key


def _frame_coordinates(world: Vector, frame: HeadFrame) -> tuple[float, float, float]:
    delta = world - frame.center
    return (
        delta.dot(frame.right) / max(1e-6, frame.radius_x),
        delta.dot(frame.front) / max(1e-6, frame.radius_z),
        delta.dot(frame.up) / max(1e-6, frame.radius_y),
    )


def _local_delta(
    obj: bpy.types.Object,
    frame: HeadFrame,
    normalized_delta: tuple[float, float, float],
) -> Vector:
    dx, depth, dz = normalized_delta
    world_delta = (
        frame.right * (dx * frame.radius_x)
        + frame.front * (depth * frame.radius_z)
        + frame.up * (dz * frame.radius_y)
    )
    inverse = obj.matrix_world.to_3x3().inverted_safe()
    return inverse @ world_delta


def _write_shape(
    obj: bpy.types.Object,
    key: bpy.types.ShapeKey,
    frame: HeadFrame,
    spec: SemanticShape,
    direction: float,
) -> int:
    basis = obj.data.shape_keys.key_blocks.get("Basis")
    if basis is None:
        return 0
    changed = 0
    for index, point in enumerate(basis.data):
        world = obj.matrix_world @ point.co
        x, depth, z = _frame_coordinates(world, frame)
        weight = spec.weight(x, depth, z)
        if weight <= 1e-5:
            key.data[index].co = point.co
            continue
        displacement = spec.displacement(x, depth, z)
        key.data[index].co = point.co + _local_delta(obj, frame, displacement) * (weight * direction)
        changed += 1
    obj[f"toonstudio_shape_{_normalize(key.name)}_semantic_id"] = spec.semantic_id
    obj[f"toonstudio_shape_{_normalize(key.name)}_direction"] = (
        "positive" if direction > 0 else "negative"
    )
    obj["toonstudio_generated"] = True
    obj[f"toonstudio_shape_{_normalize(key.name)}_generated"] = True
    return changed


def create_semantic_face_shape_keys( # NOSONAR python:S3776
    mesh_objects: Sequence[bpy.types.Object],
    frame: HeadFrame,
    options: FaceOptions,
) -> FaceBuildResult:
    if not options.create_semantic_shape_keys:
        return FaceBuildResult((), (), (), 0.0, "disabled")
    detection = detect_face_meshes(mesh_objects, frame, options)
    if not detection.objects:
        return FaceBuildResult((), (), (), detection.confidence, "unavailable")

    created: list[str] = []
    skipped: list[str] = []
    specs = _shape_specs(options.maximum_displacement_ratio)
    for obj in detection.objects:
        for spec in specs:
            for name, label, direction in (
                (spec.positive_name, spec.positive_label, 1.0),
                (spec.negative_name, spec.negative_label, -1.0),
            ):
                if options.preserve_expression_shape_keys and is_expression_shape_key(name):
                    skipped.append(name)
                    continue
                key = _shape_key(obj, name)
                key.name = name
                obj[f"toonstudio_shape_{_normalize(name)}_label"] = label
                changed = _write_shape(obj, key, frame, spec, direction)
                if changed >= 8:
                    created.append(f"{obj.name}:{name}")
                else:
                    key.value = 0.0
                    skipped.append(f"{obj.name}:{name}")
        obj["toonstudio_face_shape_profile"] = "semantic-v1"
        obj["toonstudio_face_detection_confidence"] = detection.confidence

    return FaceBuildResult(
        tuple(obj.name for obj in detection.objects),
        tuple(sorted(set(created))),
        tuple(sorted(set(skipped))),
        detection.confidence,
        "semantic-shape-keys" if created else "unavailable",
    )


def discover_expression_keys(objects: Iterable[bpy.types.Object]) -> tuple[str, ...]:
    names: set[str] = set()
    for obj in objects:
        shape_keys = getattr(getattr(obj, "data", None), "shape_keys", None)
        if shape_keys is None:
            continue
        for key in shape_keys.key_blocks:
            if key.name != "Basis" and is_expression_shape_key(key.name):
                names.add(key.name)
    return tuple(sorted(names))
