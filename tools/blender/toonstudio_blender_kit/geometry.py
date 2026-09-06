"""Deterministic authored-style toon hair geometry for Blender 5.2+.

The generator creates flattened, tapered clumps with a continuous UV layout,
vertex-colour lighting zones, a scalp shell, and explicit LODs.  It deliberately
avoids sphere/capsule assemblages so the silhouette reads as designed hair.
"""
from __future__ import annotations

from dataclasses import dataclass
import math
from typing import Iterable, Sequence

import bmesh
import bpy
from mathutils import Matrix, Vector

from .contracts import HAIR_STYLE_PRESETS, HairOptions, Palette
from .materials import create_outline_material, create_toon_material


@dataclass(frozen=True)
class HeadFrame:
    center: Vector
    right: Vector
    front: Vector
    up: Vector
    radius_x: float
    radius_y: float
    radius_z: float

    def point(self, x: float, depth: float, height: float) -> Vector:
        return (
            self.center
            + self.right * (x * self.radius_x)
            + self.front * (depth * self.radius_z)
            + self.up * (height * self.radius_y)
        )


@dataclass(frozen=True)
class HairBuildResult:
    lod_objects: tuple[bpy.types.Object, ...]
    outline_objects: tuple[bpy.types.Object, ...]
    triangle_counts: tuple[int, ...]
    style: str


class MeshAccumulator:
    def __init__(self) -> None:
        self.vertices: list[tuple[float, float, float]] = []
        self.faces: list[tuple[int, ...]] = []
        self.uvs: list[tuple[float, float]] = []
        self.colors: list[tuple[float, float, float, float]] = []

    def add_vertex(
        self,
        position: Vector,
        uv: tuple[float, float],
        color: tuple[float, float, float, float],
    ) -> int:
        index = len(self.vertices)
        self.vertices.append(tuple(position))
        self.uvs.append(uv)
        self.colors.append(color)
        return index

    def add_face(self, indices: Iterable[int]) -> None:
        self.faces.append(tuple(indices))


def _rgb(hex_color: str) -> tuple[float, float, float, float]:
    value = hex_color.lstrip("#")
    return (
        int(value[0:2], 16) / 255.0,
        int(value[2:4], 16) / 255.0,
        int(value[4:6], 16) / 255.0,
        1.0,
    )


def _mix(
    left: tuple[float, float, float, float],
    right: tuple[float, float, float, float],
    amount: float,
) -> tuple[float, float, float, float]:
    t = max(0.0, min(1.0, amount))
    return tuple(left[i] * (1.0 - t) + right[i] * t for i in range(4))  # type: ignore[return-value]


def _safe_normalized(value: Vector, fallback: Vector) -> Vector:
    return value.normalized() if value.length_squared > 1e-12 else fallback.copy()


def _bone_world_position(
    armature: bpy.types.Object | None, names: Sequence[str]
) -> Vector | None:
    if armature is None or armature.type != "ARMATURE":
        return None
    for name in names:
        bone = armature.pose.bones.get(name)
        if bone is not None:
            return armature.matrix_world @ bone.head
    return None


def _find_head_bone(armature: bpy.types.Object | None) -> bpy.types.PoseBone | None:
    if armature is None or armature.type != "ARMATURE":
        return None
    exact = ("head", "Head", "J_Bip_C_Head", "mixamorig:Head")
    for name in exact:
        bone = armature.pose.bones.get(name)
        if bone is not None:
            return bone
    for bone in armature.pose.bones:
        normalized = bone.name.lower().replace("_", "").replace(":", "")
        if normalized.endswith("head"):
            return bone
    return None


def _scene_bounds(objects: Sequence[bpy.types.Object]) -> tuple[Vector, Vector]:
    points: list[Vector] = []
    for obj in objects:
        if obj.type != "MESH" or not obj.visible_get():
            continue
        points.extend(obj.matrix_world @ Vector(corner) for corner in obj.bound_box)
    if not points:
        return Vector((-0.1, -0.1, 1.45)), Vector((0.1, 0.1, 1.75))
    minimum = Vector((min(p.x for p in points), min(p.y for p in points), min(p.z for p in points)))
    maximum = Vector((max(p.x for p in points), max(p.y for p in points), max(p.z for p in points)))
    return minimum, maximum


def infer_head_frame( # NOSONAR python:S3776
    armature: bpy.types.Object | None,
    mesh_objects: Sequence[bpy.types.Object],
) -> HeadFrame:
    """Infer a conservative head frame without mutating the source character."""

    head = _find_head_bone(armature)
    if head is not None and armature is not None:
        head_world = armature.matrix_world @ head.head
        tail_world = armature.matrix_world @ head.tail
        up = _safe_normalized(tail_world - head_world, Vector((0, 0, 1)))
        center = head_world + up * max(0.06, (tail_world - head_world).length * 0.55)
    else:
        minimum, maximum = _scene_bounds(mesh_objects)
        total_height = max(0.5, maximum.z - minimum.z)
        up = Vector((0, 0, 1))
        center = Vector(((minimum.x + maximum.x) * 0.5, (minimum.y + maximum.y) * 0.5, maximum.z - total_height * 0.095))

    left_eye = _bone_world_position(
        armature, ("leftEye", "LeftEye", "J_Adj_L_FaceEye", "TS_OrionEye.L")
    )
    right_eye = _bone_world_position(
        armature, ("rightEye", "RightEye", "J_Adj_R_FaceEye", "TS_OrionEye.R")
    )
    if left_eye is not None and right_eye is not None:
        right = _safe_normalized(right_eye - left_eye, Vector((1, 0, 0)))
        eye_distance = max(0.025, (right_eye - left_eye).length)
        radius_x = eye_distance * 1.85
        center = (left_eye + right_eye) * 0.5 + up * eye_distance * 0.34
        front_guess = right.cross(up)
        front = _safe_normalized(front_guess, Vector((0, -1, 0)))
        # Prefer the side of the eyes that sits away from the head-bone centre.
        if head is not None and armature is not None:
            head_origin = armature.matrix_world @ head.head
            eye_center = (left_eye + right_eye) * 0.5
            if (eye_center - head_origin).dot(front) < 0:
                front.negate()
        radius_y = radius_x * 1.22
        radius_z = radius_x * 0.92
    else:
        minimum, maximum = _scene_bounds(mesh_objects)
        total_height = max(0.5, maximum.z - minimum.z)
        radius_y = total_height * 0.072
        radius_x = radius_y * 0.8
        radius_z = radius_x * 0.92
        right = Vector((1, 0, 0))
        front = Vector((0, -1, 0))

    # Re-orthogonalize to limit imported rig skew.
    right = _safe_normalized(right - up * right.dot(up), Vector((1, 0, 0)))
    front = _safe_normalized(right.cross(up), front)
    if left_eye is not None and right_eye is not None and head is not None and armature is not None:
        eye_center = (left_eye + right_eye) * 0.5
        head_origin = armature.matrix_world @ head.head
        if (eye_center - head_origin).dot(front) < 0:
            front.negate()
    return HeadFrame(center, right, front, up, radius_x, radius_y, radius_z)


def _clump_frame(points: Sequence[Vector], index: int, front_hint: Vector) -> tuple[Vector, Vector]:
    previous = points[max(0, index - 1)]
    following = points[min(len(points) - 1, index + 1)]
    tangent = _safe_normalized(following - previous, Vector((0, 0, -1)))
    lateral = tangent.cross(front_hint)
    if lateral.length_squared < 1e-10:
        lateral = tangent.cross(Vector((0, 0, 1)))
    lateral = _safe_normalized(lateral, Vector((1, 0, 0)))
    depth = _safe_normalized(lateral.cross(tangent), front_hint)
    if depth.dot(front_hint) < 0:
        depth.negate()
    return lateral, depth


def add_clump(
    accumulator: MeshAccumulator,
    points: Sequence[Vector],
    *,
    root_width: float,
    root_depth: float,
    palette: Palette,
    front_hint: Vector,
    u_offset: float,
    u_scale: float,
    wave: float = 0.0,
    sections: int = 16,
) -> None:
    if len(points) < 2:
        return
    base = _rgb(palette.base)
    shadow = _rgb(palette.shadow)
    highlight = _rgb(palette.highlight)
    sampled: list[Vector] = []
    for index in range(sections + 1):
        t = index / sections
        segment = min(len(points) - 2, int(t * (len(points) - 1)))
        local_t = t * (len(points) - 1) - segment
        p0 = points[segment]
        p1 = points[segment + 1]
        point = p0.lerp(p1, local_t)
        if wave > 0:
            point = point + front_hint * (math.sin(t * math.pi * 2.6) * wave * root_depth * t)
        sampled.append(point)

    rings: list[tuple[int, int, int, int, int, int]] = []
    for index, point in enumerate(sampled):
        t = index / sections
        tip = max(0.008, (1.0 - t) ** 0.62)
        root_ease = 0.76 + min(1.0, t / 0.12) * 0.24
        width = root_width * tip * root_ease
        depth_amount = root_depth * max(0.08, tip * (0.82 - 0.25 * t))
        lateral, depth = _clump_frame(sampled, index, front_hint)
        center_ridge = point + depth * depth_amount * 0.96
        left_front = point - lateral * width + depth * depth_amount * 0.45
        right_front = point + lateral * width + depth * depth_amount * 0.45
        right_back = point + lateral * width * 0.76 - depth * depth_amount
        left_back = point - lateral * width * 0.76 - depth * depth_amount
        center_back = point - depth * depth_amount * 1.12
        v = t
        ring = (
            accumulator.add_vertex(left_front, (u_offset, v), _mix(base, highlight, 0.08 + 0.12 * (1 - t))),
            accumulator.add_vertex(center_ridge, (u_offset + u_scale * 0.5, v), _mix(base, highlight, 0.42 + 0.28 * (1 - t))),
            accumulator.add_vertex(right_front, (u_offset + u_scale, v), _mix(base, highlight, 0.12)),
            accumulator.add_vertex(right_back, (u_offset + u_scale, v), _mix(base, shadow, 0.38)),
            accumulator.add_vertex(center_back, (u_offset + u_scale * 0.5, v), _mix(base, shadow, 0.62)),
            accumulator.add_vertex(left_back, (u_offset, v), _mix(base, shadow, 0.44)),
        )
        rings.append(ring)

    for index in range(len(rings) - 1):
        current = rings[index]
        following = rings[index + 1]
        for side in range(6):
            next_side = (side + 1) % 6
            accumulator.add_face(
                (current[side], current[next_side], following[next_side], following[side])
            )
    accumulator.add_face(tuple(reversed(rings[0])))
    accumulator.add_face(rings[-1])


def add_scalp_shell(
    accumulator: MeshAccumulator,
    frame: HeadFrame,
    palette: Palette,
    *,
    volume: float,
    crown_lift: float,
    lon_segments: int,
    lat_segments: int,
) -> None:
    """Add a closed, manifold scalp shell with a single crown pole.

    A repeated pole vertex creates zero-area quads. A single crown vertex in many procedural sphere
    generators.  The production shell uses one crown vertex, regular latitude
    rings, and an internal lower cap so validation can require zero degenerates
    and zero non-manifold edges.
    """

    base = _rgb(palette.base)
    shadow = _rgb(palette.shadow)
    highlight = _rgb(palette.highlight)
    crown = frame.point(0.0, 0.0, 1.0 + crown_lift)
    crown_index = accumulator.add_vertex(crown, (0.5, 0.0), _mix(base, highlight, 0.28))
    rings: list[list[int]] = []
    for lat_index in range(1, lat_segments + 1):
        lat_t = lat_index / lat_segments
        theta = lat_t * math.pi * 0.72
        ring: list[int] = []
        for lon_index in range(lon_segments):
            lon_t = lon_index / lon_segments
            phi = lon_t * math.pi * 2
            x = math.sin(theta) * math.cos(phi)
            depth = math.sin(theta) * math.sin(phi)
            z = math.cos(theta)
            front_amount = max(0.0, depth)
            point = frame.point(
                x * (1.05 + 0.08 * volume),
                depth * (1.04 + 0.05 * volume) - 0.08 * front_amount,
                z * (1.0 + 0.08 * volume) + crown_lift * (1.0 - lat_t) ** 2,
            )
            light = max(0.0, min(1.0, 0.72 * x + 0.45 * z + 0.2))
            color = _mix(_mix(base, shadow, 0.22 * (1.0 - light)), highlight, 0.18 * light)
            ring.append(accumulator.add_vertex(point, (lon_t, lat_t * 0.72), color))
        rings.append(ring)

    first = rings[0]
    for lon_index in range(lon_segments):
        next_lon = (lon_index + 1) % lon_segments
        accumulator.add_face((crown_index, first[lon_index], first[next_lon]))
    for ring_index in range(len(rings) - 1):
        current = rings[ring_index]
        following = rings[ring_index + 1]
        for lon_index in range(lon_segments):
            next_lon = (lon_index + 1) % lon_segments
            accumulator.add_face(
                (
                    current[lon_index],
                    following[lon_index],
                    following[next_lon],
                    current[next_lon],
                )
            )

    lower = rings[-1]
    lower_center = sum((Vector(accumulator.vertices[index]) for index in lower), Vector((0.0, 0.0, 0.0))) / len(lower)
    # Pull the cap inside the skull to keep it invisible while closing topology.
    lower_center -= frame.up * frame.radius_y * 0.12
    lower_center_index = accumulator.add_vertex(
        lower_center,
        (0.5, 0.78),
        _mix(base, shadow, 0.64),
    )
    for lon_index in range(lon_segments):
        next_lon = (lon_index + 1) % lon_segments
        accumulator.add_face((lower_center_index, lower[next_lon], lower[lon_index]))


def _guide(
    frame: HeadFrame, points: Sequence[tuple[float, float, float]], *, asymmetry: float = 0.0
) -> list[Vector]:
    return [
        frame.point(x + asymmetry * index / max(1, len(points) - 1), depth, height)
        for index, (x, depth, height) in enumerate(points)
    ]


def _style_guides( # NOSONAR python:S3776
    frame: HeadFrame, options: HairOptions, *, lod: int
) -> list[tuple[list[Vector], float, float, float]]:
    spec = HAIR_STYLE_PRESETS[options.style]
    back_length = float(spec["backLength"]) * options.length
    side_length = float(spec["sideLength"]) * options.length
    symmetry_break = float(spec["symmetryBreak"])
    density = max(0.5, options.clump_density)
    if lod == 0:
        guide_base = 7
    elif lod == 1:
        guide_base = 5
    else:
        guide_base = 3
    guide_count = max(3, round(guide_base * density))
    guides: list[tuple[list[Vector], float, float, float]] = []
    if lod == 0:
        root_width_factor = 0.24
    elif lod == 1:
        root_width_factor = 0.29
    else:
        root_width_factor = 0.36
    root_width = frame.radius_x * root_width_factor
    root_depth = frame.radius_z * 0.18

    # Back curtain / layered silhouette.
    for index in range(guide_count):
        t = index / max(1, guide_count - 1)
        x = -0.78 + t * 1.56
        side_bias = abs(x) ** 1.5
        tip_x = x * (1.08 + 0.08 * side_bias)
        asym = math.sin((index + 1) * 2.17) * symmetry_break * 0.18
        points = _guide(
            frame,
            (
                (x * 0.78, -0.22, 0.72),
                (x * 0.96, -0.48, 0.16),
                (tip_x + asym, -0.34, 0.15 - back_length),
            ),
        )
        guides.append((points, root_width * (0.88 + 0.22 * (1 - side_bias)), root_depth, options.wave))

    # Side locks frame the face independently from the back mass.
    for sign in (-1.0, 1.0):
        points = _guide(
            frame,
            (
                (0.62 * sign, 0.02, 0.62),
                (0.82 * sign, 0.42, 0.0),
                ((0.72 + 0.08 * side_length) * sign, 0.28, -0.18 - side_length),
            ),
            asymmetry=symmetry_break * 0.08 * sign,
        )
        guides.append((points, root_width * 0.78, root_depth * 0.8, options.wave * 0.65))

    # Bangs are separate pointed clumps with an intentional negative-space split.
    bang_count = 5 if lod == 0 else 3
    for index in range(bang_count):
        t = index / max(1, bang_count - 1)
        x = -0.58 + t * 1.16
        split = 0.09 if options.style in {"romance-long", "action-pony"} else 0.0
        if abs(x) < 0.16:
            x += split if index >= bang_count / 2 else -split
        drop = 0.42 + options.fringe * (0.46 + 0.11 * (1 - abs(x)))
        points = _guide(
            frame,
            (
                (x * 0.65, 0.18, 0.84),
                (x * 0.92, 0.78, 0.34),
                (x * 0.86 + symmetry_break * 0.08 * math.sin(index), 0.94, 0.32 - drop),
            ),
        )
        guides.append((points, root_width * 0.66, root_depth * 0.64, options.wave * 0.22))

    if options.style == "hime-cut":
        for sign in (-1.0, 1.0):
            points = _guide(
                frame,
                (
                    (0.48 * sign, 0.12, 0.58),
                    (0.66 * sign, 0.6, 0.0),
                    (0.64 * sign, 0.52, -0.82 * options.length),
                ),
            )
            guides.append((points, root_width * 0.88, root_depth * 0.55, 0.0))

    if options.style == "wolf-layered":
        for sign in (-1.0, 1.0):
            points = _guide(
                frame,
                (
                    (0.38 * sign, -0.18, 0.68),
                    (0.86 * sign, -0.12, 0.15),
                    (1.06 * sign, 0.05, -0.34 * options.length),
                ),
            )
            guides.append((points, root_width * 0.62, root_depth * 0.72, options.wave * 0.5))

    if bool(spec["tail"]):
        tail_count = 5 if lod == 0 else 3
        for index in range(tail_count):
            angle = (index / max(1, tail_count - 1) - 0.5) * 0.72
            points = _guide(
                frame,
                (
                    (math.sin(angle) * 0.22, -0.92, 0.58),
                    (math.sin(angle) * 0.52, -1.55, 0.08),
                    (math.sin(angle) * 0.72, -1.9, -1.2 * options.length),
                ),
            )
            guides.append((points, root_width * 0.7, root_depth * 0.7, options.wave * 0.8 + 0.08))
    return guides


def _create_mesh_object(
    name: str,
    accumulator: MeshAccumulator,
    palette: Palette,
    *,
    collection: bpy.types.Collection,
) -> bpy.types.Object:
    mesh = bpy.data.meshes.new(name + "Mesh")
    mesh.from_pydata(accumulator.vertices, [], accumulator.faces)
    mesh.update(calc_edges=True)
    bm = bmesh.new()
    try:
        bm.from_mesh(mesh)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(mesh)
    finally:
        bm.free()
    mesh.update(calc_edges=True)
    uv_layer = mesh.uv_layers.new(name="UVMap")
    for loop in mesh.loops:
        uv_layer.data[loop.index].uv = accumulator.uvs[loop.vertex_index]
    color_layer = mesh.color_attributes.new(name="COLOR_0", type="FLOAT_COLOR", domain="POINT")
    for index, color in enumerate(accumulator.colors):
        color_layer.data[index].color = color
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    mesh.validate(clean_customdata=False)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    obj.data.materials.append(create_toon_material("TS_AuthoredHair", palette))
    obj["toonstudio_authored_hair"] = True
    return obj


def _create_outline_object(
    source: bpy.types.Object,
    palette: Palette,
    *,
    collection: bpy.types.Collection,
    thickness: float,
) -> bpy.types.Object:
    mesh = source.data.copy()
    mesh.name = source.data.name + "Outline"
    mesh.update(calc_edges=True)
    for vertex in mesh.vertices:
        vertex.co += vertex.normal * thickness
    for polygon in mesh.polygons:
        polygon.flip()
    outline = bpy.data.objects.new(source.name + "_Outline", mesh)
    collection.objects.link(outline)
    outline.data.materials.append(create_outline_material("TS_AuthoredHairOutline", palette))
    outline["toonstudio_authored_hair_outline"] = True
    outline.hide_select = True
    return outline


def build_authored_hair(
    frame: HeadFrame,
    options: HairOptions,
    *,
    collection: bpy.types.Collection | None = None,
) -> HairBuildResult:
    target_collection = collection or bpy.context.scene.collection
    lod_objects: list[bpy.types.Object] = []
    outlines: list[bpy.types.Object] = []
    triangle_counts: list[int] = []
    lod_count = 3 if options.generate_lods else 1
    for lod in range(lod_count):
        accumulator = MeshAccumulator()
        if lod == 0:
            detail = (32, 18, 16)
        elif lod == 1:
            detail = (22, 12, 11)
        else:
            detail = (14, 8, 7)
        spec = HAIR_STYLE_PRESETS[options.style]
        add_scalp_shell(
            accumulator,
            frame,
            options.palette,
            volume=options.volume,
            crown_lift=float(spec["crownLift"]),
            lon_segments=detail[0],
            lat_segments=detail[1],
        )
        guides = _style_guides(frame, options, lod=lod)
        u_scale = 1.0 / max(1, len(guides))
        for index, (points, width, depth, wave) in enumerate(guides):
            add_clump(
                accumulator,
                points,
                root_width=width * options.volume,
                root_depth=depth * options.volume,
                palette=options.palette,
                front_hint=frame.front,
                u_offset=index * u_scale,
                u_scale=u_scale,
                wave=wave,
                sections=detail[2],
            )
        obj = _create_mesh_object(
            f"TS_AuthoredHair_{options.style}_LOD{lod}",
            accumulator,
            options.palette,
            collection=target_collection,
        )
        obj["toonstudio_hair_style"] = options.style
        obj["toonstudio_lod"] = lod
        obj["toonstudio_clump_count"] = len(guides)
        obj.hide_render = lod != 0
        obj.hide_viewport = lod != 0
        outline = _create_outline_object(
            obj,
            options.palette,
            collection=target_collection,
            thickness=max(frame.radius_x, frame.radius_y) * (0.009 if lod == 0 else 0.012),
        )
        outline.hide_render = lod != 0
        outline.hide_viewport = lod != 0
        triangles = sum(max(0, len(face) - 2) for face in accumulator.faces)
        triangle_counts.append(triangles)
        lod_objects.append(obj)
        outlines.append(outline)
    return HairBuildResult(
        lod_objects=tuple(lod_objects),
        outline_objects=tuple(outlines),
        triangle_counts=tuple(triangle_counts),
        style=options.style,
    )


def create_reference_head(
    *,
    collection: bpy.types.Collection | None = None,
) -> tuple[bpy.types.Object, HeadFrame]:
    """Create a closed neutral audit head with non-degenerate pole topology."""

    target_collection = collection or bpy.context.scene.collection
    mesh = bpy.data.meshes.new("TS_ReferenceHeadMesh")
    vertices: list[tuple[float, float, float]] = []
    faces: list[tuple[int, ...]] = []
    lon_segments = 48
    lat_segments = 32
    center = Vector((0, 0, 1.62))
    radii = Vector((0.102, 0.09, 0.126))

    def shaped_point(theta: float, phi: float) -> Vector:
        point = Vector(
            (
                math.sin(theta) * math.cos(phi) * radii.x,
                math.sin(theta) * math.sin(phi) * radii.y,
                math.cos(theta) * radii.z,
            )
        )
        # Gently flatten the face plane and taper the lower jaw while preserving
        # a closed surface suitable for strict non-manifold/degenerate checks.
        if point.y < -0.02:
            point.y *= 0.82
        jaw = max(0.72, 1.0 - max(0.0, -point.z / radii.z) * 0.2)
        point.x *= jaw
        return center + point

    top_index = len(vertices)
    vertices.append(tuple(shaped_point(0.0, 0.0)))
    rings: list[list[int]] = []
    for lat_index in range(1, lat_segments):
        theta = lat_index / lat_segments * math.pi
        ring: list[int] = []
        for lon_index in range(lon_segments):
            phi = lon_index / lon_segments * math.pi * 2
            ring.append(len(vertices))
            vertices.append(tuple(shaped_point(theta, phi)))
        rings.append(ring)
    bottom_index = len(vertices)
    vertices.append(tuple(shaped_point(math.pi, 0.0)))

    first = rings[0]
    for lon_index in range(lon_segments):
        next_lon = (lon_index + 1) % lon_segments
        faces.append((top_index, first[lon_index], first[next_lon]))
    for ring_index in range(len(rings) - 1):
        current = rings[ring_index]
        following = rings[ring_index + 1]
        for lon_index in range(lon_segments):
            next_lon = (lon_index + 1) % lon_segments
            faces.append(
                (
                    current[lon_index],
                    following[lon_index],
                    following[next_lon],
                    current[next_lon],
                )
            )
    last = rings[-1]
    for lon_index in range(lon_segments):
        next_lon = (lon_index + 1) % lon_segments
        faces.append((bottom_index, last[next_lon], last[lon_index]))

    mesh.from_pydata(vertices, [], faces)
    mesh.update(calc_edges=True)
    bm = bmesh.new()
    try:
        bm.from_mesh(mesh)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(mesh)
    finally:
        bm.free()
    mesh.validate(clean_customdata=False)
    mesh.update(calc_edges=True)

    obj = bpy.data.objects.new("TS_ReferenceHead", mesh)
    target_collection.objects.link(obj)
    from .materials import create_skin_material

    obj.data.materials.append(create_skin_material())
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    frame = HeadFrame(
        center=center + Vector((0, 0, 0.02)),
        right=Vector((1, 0, 0)),
        front=Vector((0, -1, 0)),
        up=Vector((0, 0, 1)),
        radius_x=0.105,
        radius_y=0.132,
        radius_z=0.094,
    )
    obj["toonstudio_reference_head"] = True
    obj["toonstudio_face_mesh"] = True
    return obj, frame


def parent_hair_to_head(
    result: HairBuildResult,
    armature: bpy.types.Object | None,
) -> None:
    if armature is None or armature.type != "ARMATURE":
        return
    head = _find_head_bone(armature)
    if head is None:
        return
    for obj in (*result.lod_objects, *result.outline_objects):
        world = obj.matrix_world.copy()
        obj.parent = armature
        obj.parent_type = "BONE"
        obj.parent_bone = head.name
        obj.matrix_parent_inverse = Matrix.Identity(4)
        obj.matrix_world = world
