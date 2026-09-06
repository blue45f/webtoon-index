"""VRM 1.0 binding helpers for ToonStudio-authored semantic face controls.

The module uses the official VRM Add-on property groups when they are present. It
never changes humanoid mappings or upgrades a VRM 0.x armature implicitly.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

import bpy

from .face import FaceBuildResult


@dataclass(frozen=True)
class VrmExpressionBindingResult:
    status: str
    expression_names: tuple[str, ...]
    message: str


def _extension(armature: bpy.types.Object | None):
    if armature is None or armature.type != "ARMATURE":
        return None
    return getattr(armature.data, "vrm_addon_extension", None)


def _is_vrm1(extension: object | None) -> bool:
    if extension is None:
        return False
    spec_version = str(getattr(extension, "spec_version", ""))
    if spec_version == "1.0":
        return True
    checker = getattr(extension, "is_vrm1", None)
    if callable(checker):
        try:
            return bool(checker())
        except (RuntimeError, TypeError):
            return False
    return False


def _custom_expression_name(shape_key_name: str) -> str:
    # VRM custom names are deliberately namespaced so they can never collide with
    # preset expressions such as happy, blink, aa, or lookLeft.
    return "ts" + shape_key_name[0].upper() + shape_key_name[1:]


def bind_semantic_vrm1_expressions( # NOSONAR python:S3776
    armature: bpy.types.Object | None,
    face: FaceBuildResult | None,
) -> VrmExpressionBindingResult:
    if face is None or not face.created_shape_keys:
        return VrmExpressionBindingResult("unavailable", (), "No generated semantic face shapes")
    extension = _extension(armature)
    if not _is_vrm1(extension):
        return VrmExpressionBindingResult(
            "unavailable",
            (),
            "The active armature is not an explicitly configured VRM 1.0 model",
        )

    try:
        expressions = extension.vrm1.expressions
    except AttributeError:
        return VrmExpressionBindingResult("unavailable", (), "VRM 1.0 expression properties are unavailable")

    existing = {
        str(custom.custom_name): custom
        for custom in expressions.custom
        if str(custom.custom_name)
    }
    created: list[str] = []
    for receipt in face.created_shape_keys:
        object_name, separator, shape_key_name = receipt.partition(":")
        if not separator or not object_name or not shape_key_name:
            continue
        obj = bpy.data.objects.get(object_name)
        shape_keys = getattr(getattr(obj, "data", None), "shape_keys", None) if obj else None
        if shape_keys is None or shape_keys.key_blocks.get(shape_key_name) is None:
            continue
        custom_name = _custom_expression_name(shape_key_name)
        expression = existing.get(custom_name)
        if expression is None:
            expression = expressions.custom.add()
            expression.custom_name = custom_name
            existing[custom_name] = expression
        else:
            expression.morph_target_binds.clear()
            expression.material_color_binds.clear()
            expression.texture_transform_binds.clear()
        expression.is_binary = False
        expression.override_blink = "none"
        expression.override_look_at = "none"
        expression.override_mouth = "none"
        expression["toonstudio_generated"] = True
        bind = expression.morph_target_binds.add()
        bind.node.mesh_object_name = object_name
        bind.index = shape_key_name
        bind.weight = 1.0
        created.append(custom_name)

    names = tuple(sorted(set(created)))
    return VrmExpressionBindingResult(
        "ready" if names else "unavailable",
        names,
        f"Bound {len(names)} semantic shape keys as VRM 1.0 custom expressions",
    )
