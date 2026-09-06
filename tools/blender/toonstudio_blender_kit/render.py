"""Deterministic Eevee quality renders for character release review."""
from __future__ import annotations

from dataclasses import dataclass
import math
from pathlib import Path
from typing import Iterable, Mapping, Sequence

import bpy
from mathutils import Vector

from .contracts import RenderOptions
from .geometry import HeadFrame


@dataclass(frozen=True)
class RenderResult:
    outputs: Mapping[str, str]
    rendered_views: tuple[str, ...]
    rendered_expressions: tuple[str, ...]


def _normalize(value: str) -> str:
    return "".join(character for character in value.casefold() if character.isalnum())


_EXPRESSION_ALIASES: Mapping[str, tuple[str, ...]] = {
    "happy": ("happy", "joy", "smile", "fun"),
    "angry": ("angry", "anger", "mad", "frown"),
    "surprised": ("surprised", "surprise", "wide", "oh"),
    "blink": ("blink", "eyeclose", "eyesclosed"),
    "sad": ("sad", "sorrow"),
    "relaxed": ("relaxed", "neutralsoft"),
}


def _visible_meshes(objects: Iterable[bpy.types.Object]) -> list[bpy.types.Object]:
    return [
        obj
        for obj in objects
        if obj.type == "MESH" and not obj.hide_render and obj.visible_get()
    ]


def _world_bounds(objects: Sequence[bpy.types.Object]) -> tuple[Vector, Vector]:
    points: list[Vector] = []
    for obj in objects:
        points.extend(obj.matrix_world @ Vector(corner) for corner in obj.bound_box)
    if not points:
        return Vector((-0.5, -0.5, 0.0)), Vector((0.5, 0.5, 1.8))
    return (
        Vector((min(point.x for point in points), min(point.y for point in points), min(point.z for point in points))),
        Vector((max(point.x for point in points), max(point.y for point in points), max(point.z for point in points))),
    )


def _look_at(obj: bpy.types.Object, target: Vector) -> None:
    direction = target - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def _qa_collection() -> bpy.types.Collection:
    existing = bpy.data.collections.get("TS_QualityReview")
    if existing is not None:
        for obj in list(existing.objects):
            bpy.data.objects.remove(obj, do_unlink=True)
        return existing
    collection = bpy.data.collections.new("TS_QualityReview")
    bpy.context.scene.collection.children.link(collection)
    collection["toonstudio_qa_collection"] = True
    return collection


def _new_area_light(
    collection: bpy.types.Collection,
    name: str,
    location: Vector,
    target: Vector,
    *,
    energy: float,
    size: float,
    color: tuple[float, float, float],
) -> bpy.types.Object:
    data = bpy.data.lights.new(name=name, type="AREA")
    data.energy = energy
    data.shape = "DISK"
    data.size = size
    data.color = color
    obj = bpy.data.objects.new(name, data)
    collection.objects.link(obj)
    obj.location = location
    _look_at(obj, target)
    obj["toonstudio_qa_light"] = True
    return obj


def _configure_render(scene: bpy.types.Scene, options: RenderOptions) -> None:
    for engine in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT"):
        try:
            scene.render.engine = engine
            break
        except TypeError:
            continue
    scene.render.resolution_x = options.resolution
    scene.render.resolution_y = options.resolution
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    scene.render.film_transparent = options.transparent
    scene.render.use_file_extension = True
    scene.render.use_overwrite = True
    scene.render.use_placeholder = False
    # Blender 5.2 shortened AgX look identifiers, while older releases used the
    # prefixed spelling. Prefer the older label first so the same kit remains backward compatible.
    for look in ("AgX - Medium High Contrast", "Medium High Contrast"):
        try:
            scene.view_settings.look = look
            break
        except TypeError:
            continue
    if hasattr(scene, "eevee"):
        scene.eevee.taa_render_samples = options.samples
    world = scene.world or bpy.data.worlds.new("TS_QualityWorld")
    scene.world = world
    world.use_nodes = True
    background = world.node_tree.nodes.get("Background") if world.node_tree else None
    if background:
        background.inputs["Color"].default_value = (0.025, 0.028, 0.036, 1.0)
        background.inputs["Strength"].default_value = 0.34


def _is_generated_shape_key(obj: bpy.types.Object, key_name: str) -> bool:
    """Read generator metadata from the owning object, not ShapeKey ID properties.

    Blender 5.2's ShapeKey RNA type does not guarantee ``IDProperty`` access, while
    ``face.py`` deliberately stores the provenance marker on the mesh object.
    """

    marker = f"toonstudio_shape_{_normalize(key_name)}_generated"
    return bool(obj.get(marker, False))


def _set_expression(objects: Sequence[bpy.types.Object], expression: str) -> dict[tuple[str, str], float]: # NOSONAR python:S3776
    snapshot: dict[tuple[str, str], float] = {}
    aliases = _EXPRESSION_ALIASES.get(expression, ())
    for obj in objects:
        shape_keys = getattr(getattr(obj, "data", None), "shape_keys", None)
        if shape_keys is None:
            continue
        for key in shape_keys.key_blocks:
            if key.name == "Basis":
                continue
            snapshot[(obj.name, key.name)] = float(key.value)
            key.value = 0.0
        if not aliases or expression == "neutral":
            continue
        candidates = [
            key
            for key in shape_keys.key_blocks
            if key.name != "Basis"
            and not _is_generated_shape_key(obj, key.name)
            and any(alias in _normalize(key.name) for alias in aliases)
        ]
        # Prefer the most specific/shortest target to avoid stacking aliases from unrelated meshes.
        for key in sorted(candidates, key=lambda candidate: (len(candidate.name), candidate.name))[:2]:
            key.value = 1.0 if expression == "blink" else 0.78
    return snapshot


def _restore_expression(objects: Sequence[bpy.types.Object], snapshot: Mapping[tuple[str, str], float]) -> None:
    by_name = {obj.name: obj for obj in objects}
    for (object_name, key_name), value in snapshot.items():
        obj = by_name.get(object_name)
        shape_keys = getattr(getattr(obj, "data", None), "shape_keys", None) if obj else None
        key = shape_keys.key_blocks.get(key_name) if shape_keys else None
        if key is not None:
            key.value = value


def _write_index(output_dir: Path, outputs: Mapping[str, str]) -> None:
    cards = []
    for key, relative in sorted(outputs.items()):
        if not relative.lower().endswith(".png"):
            continue
        cards.append(
            f'<figure><img loading="lazy" src="{Path(relative).name}" alt="{key}"><figcaption>{key}</figcaption></figure>'
        )
    html = """<!doctype html><meta charset="utf-8"><title>ToonStudio character quality review</title>
<style>body{font:14px system-ui;background:#15161b;color:#eee;margin:24px}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:18px}figure{margin:0;background:#22242c;border:1px solid #383b46;border-radius:14px;overflow:hidden}img{display:block;width:100%;aspect-ratio:1;object-fit:contain;background:linear-gradient(135deg,#30333d,#18191f)}figcaption{padding:10px 12px;font-weight:700}</style>
<h1>ToonStudio character quality review</h1><main>""" + "".join(cards) + "</main>"
    (output_dir / "index.html").write_text(html, encoding="utf-8")


def render_quality_views(
    objects: Sequence[bpy.types.Object],
    frame: HeadFrame,
    options: RenderOptions,
    output_dir: str | Path,
) -> RenderResult:
    if not options.enabled:
        return RenderResult({}, (), ())
    target_dir = Path(output_dir)
    target_dir.mkdir(parents=True, exist_ok=True)
    scene = bpy.context.scene
    _configure_render(scene, options)
    visible = _visible_meshes(objects)
    minimum, maximum = _world_bounds(visible)
    center = (minimum + maximum) * 0.5
    height = max(0.5, maximum.z - minimum.z)
    width = max(0.35, maximum.x - minimum.x, maximum.y - minimum.y)
    target_point = center + frame.up * height * 0.03
    distance = max(height * 1.45, width * 2.15)

    collection = _qa_collection()
    camera_data = bpy.data.cameras.new("TS_QualityCamera")
    camera_data.lens = 68
    camera_data.sensor_width = 36
    camera_data.dof.use_dof = False
    camera = bpy.data.objects.new("TS_QualityCamera", camera_data)
    camera["toonstudio_qa_camera"] = True
    collection.objects.link(camera)
    scene.camera = camera

    key = _new_area_light(
        collection,
        "TS_Key",
        target_point + frame.front * height * 1.1 - frame.right * height * 0.65 + frame.up * height * 0.75,
        target_point,
        energy=980,
        size=height * 0.78,
        color=(1.0, 0.86, 0.76),
    )
    _new_area_light(
        collection,
        "TS_Fill",
        target_point + frame.front * height * 0.55 + frame.right * height * 0.8 + frame.up * height * 0.18,
        target_point,
        energy=480,
        size=height * 1.0,
        color=(0.63, 0.76, 1.0),
    )
    _new_area_light(
        collection,
        "TS_Rim",
        target_point - frame.front * height * 0.85 + frame.up * height * 0.55,
        target_point,
        energy=720,
        size=height * 0.52,
        color=(0.72, 0.78, 1.0),
    )
    # Silence unused-variable analysis while retaining a named key light for Blender debugging.
    key["toonstudio_role"] = "key"

    view_vectors = {
        "front": frame.front,
        "three-quarter": (frame.front + frame.right * 0.68).normalized(),
        "side": frame.right,
        "back": -frame.front,
    }
    outputs: dict[str, str] = {}
    rendered_expressions: list[str] = []
    expression_objects = [obj for obj in objects if obj.type == "MESH"]
    expressions = options.expressions or ("neutral",)
    for expression in expressions:
        snapshot = _set_expression(expression_objects, expression)
        try:
            rendered_expressions.append(expression)
            for view in options.views:
                direction = view_vectors[view]
                camera.location = target_point + direction * distance + frame.up * height * 0.04
                _look_at(camera, target_point)
                camera_data.lens = 72 if view == "front" else 64
                file_name = f"{expression}--{view}.png"
                output_path = target_dir / file_name
                scene.render.filepath = str(output_path)
                bpy.context.view_layer.update()
                bpy.ops.render.render(write_still=True)
                outputs[f"preview:{expression}:{view}"] = file_name
        finally:
            _restore_expression(expression_objects, snapshot)

    _write_index(target_dir, outputs)
    outputs["preview:index"] = "index.html"
    return RenderResult(outputs, tuple(options.views), tuple(rendered_expressions))
