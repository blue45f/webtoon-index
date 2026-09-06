"""Blender material helpers for portable toon character assets."""
from __future__ import annotations

from typing import Any

import bpy

from .contracts import Palette


def _rgba(hex_color: str, alpha: float = 1.0) -> tuple[float, float, float, float]:
    value = hex_color.lstrip("#")
    return (
        int(value[0:2], 16) / 255.0,
        int(value[2:4], 16) / 255.0,
        int(value[4:6], 16) / 255.0,
        alpha,
    )


def _set_input(node: Any, name: str, value: Any) -> None:
    socket = node.inputs.get(name) if node is not None else None
    if socket is not None:
        socket.default_value = value


def create_toon_material( # NOSONAR python:S3776
    name: str,
    palette: Palette,
    *,
    role: str = "hair",
    use_vertex_color: bool = True,
) -> bpy.types.Material:
    """Create an MToon-ready material with a standards-based fallback graph.

    The glTF fallback uses vertex colours multiplied by the palette base.  When
    the VRM add-on is available the same material is promoted to MToon 1.0.
    """

    material = bpy.data.materials.get(name) or bpy.data.materials.new(name=name)
    material.use_nodes = True
    material.diffuse_color = _rgba(palette.base)
    material.metallic = 0.0
    material.roughness = 0.52 if role == "hair" else 0.62
    material["toonstudio_role"] = role
    material["toonstudio_palette_base"] = palette.base
    material["toonstudio_palette_shadow"] = palette.shadow
    material["toonstudio_palette_highlight"] = palette.highlight
    material["toonstudio_palette_outline"] = palette.outline

    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    output.location = (420, 0)
    principled = nodes.new("ShaderNodeBsdfPrincipled")
    principled.location = (100, 0)
    _set_input(principled, "Base Color", _rgba(palette.base))
    _set_input(principled, "Roughness", 0.48 if role == "hair" else 0.62)
    _set_input(principled, "Metallic", 0.0)
    _set_input(principled, "Specular IOR Level", 0.32 if role == "hair" else 0.25)
    _set_input(principled, "Coat Weight", 0.08 if role == "hair" else 0.0)

    if use_vertex_color:
        vertex = nodes.new("ShaderNodeVertexColor")
        vertex.layer_name = "COLOR_0"
        vertex.location = (-420, 20)
        multiply = nodes.new("ShaderNodeMixRGB")
        multiply.blend_type = "MULTIPLY"
        multiply.inputs[0].default_value = 1.0
        multiply.inputs[2].default_value = _rgba(palette.base)
        multiply.location = (-140, 20)
        links.new(vertex.outputs["Color"], multiply.inputs[1])
        links.new(multiply.outputs["Color"], principled.inputs["Base Color"])

    links.new(principled.outputs["BSDF"], output.inputs["Surface"])

    extension = getattr(material, "vrm_addon_extension", None)
    mtoon = getattr(extension, "mtoon1", None) if extension is not None else None
    if mtoon is not None:
        try:
            mtoon.enabled = True
            mtoon.pbr_metallic_roughness.base_color_factor = _rgba(palette.base)
            mtoon.emissive_factor = tuple(
                channel * (0.028 if role == "hair" else 0.012)
                for channel in _rgba(palette.highlight)[:3]
            )
            vrmc = mtoon.extensions.vrmc_materials_mtoon
            vrmc.shade_color_factor = _rgba(palette.shadow)[:3]
            vrmc.shading_toony_factor = 0.93 if role == "hair" else 0.86
            vrmc.shading_shift_factor = -0.08 if role == "hair" else -0.03
            vrmc.gi_equalization_factor = 0.82
            if hasattr(vrmc, "outline_width_mode"):
                vrmc.outline_width_mode = "worldCoordinates"
            if hasattr(vrmc, "outline_width_factor"):
                vrmc.outline_width_factor = 0.0022 if role == "hair" else 0.0012
            if hasattr(vrmc, "outline_color_factor"):
                vrmc.outline_color_factor = _rgba(palette.outline)[:3]
        except (AttributeError, TypeError, ValueError):
            # Add-on minor releases sometimes rename optional outline fields.
            # The portable Principled graph remains valid and deterministic.
            material["toonstudio_mtoon_partial"] = True
    return material


def create_skin_material(name: str = "TS_Skin") -> bpy.types.Material:
    return create_toon_material(
        name,
        Palette(
            base="#efc4ad",
            shadow="#b97965",
            highlight="#ffe7d8",
            outline="#6b4039",
        ),
        role="skin",
        use_vertex_color=False,
    )


def create_outline_material(name: str, palette: Palette) -> bpy.types.Material:
    material = bpy.data.materials.get(name) or bpy.data.materials.new(name=name)
    material.use_nodes = True
    material.diffuse_color = _rgba(palette.outline)
    material.use_backface_culling = False
    material["toonstudio_role"] = "outline"
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    shader = nodes.new("ShaderNodeEmission")
    shader.inputs["Color"].default_value = _rgba(palette.outline)
    shader.inputs["Strength"].default_value = 0.18
    links.new(shader.outputs["Emission"], output.inputs["Surface"])
    return material
