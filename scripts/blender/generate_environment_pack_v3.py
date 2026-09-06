"""Generate ToonSpectrum's six CC0 Studio BG3D environments with Blender 5.2.

The generator is deterministic, texture-free, and safe to execute either from
Blender's background CLI or from an MCP-controlled Blender session.  It never
resets factory preferences.  Every exported GLB is self-contained, authored in
metres, grounded on the glTF Y=0 plane, and carries explicit CC0/provenance
extras on its root node.

Example:
  /Applications/Blender.app/Contents/MacOS/Blender --background \
    --python scripts/blender/generate_environment_pack_v3.py -- \
    --output-dir apps/web/public/assets/3d/environments
"""

from __future__ import annotations

import argparse
from math import cos, pi, sin
from pathlib import Path
import sys

import bpy
from mathutils import Vector


GENERATOR = "scripts/blender/generate_environment_pack_v3.py"
CC0_LICENSE_URL = "https://creativecommons.org/publicdomain/zero/1.0/"
ASSETS = (
    "compact_apartment_interior",
    "stylized_cafe_interior",
    "urban_neon_alley",
    "classroom_art_studio",
    "fantasy_ruin_courtyard",
    "scifi_command_corridor",
)


def parse_arguments():
    script_args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", default="apps/web/public/assets/3d/environments")
    parser.add_argument("--thumbnail-dir", default=None)
    parser.add_argument("--only", choices=ASSETS, action="append")
    parser.add_argument("--skip-thumbnails", action="store_true")
    return parser.parse_args(script_args)


ARGS = parse_arguments()
OUTPUT_DIRECTORY = Path(bpy.path.abspath(ARGS.output_dir)).resolve()
THUMBNAIL_DIRECTORY = Path(
    bpy.path.abspath(ARGS.thumbnail_dir)
    if ARGS.thumbnail_dir
    else OUTPUT_DIRECTORY / "thumbnails"
).resolve()


def clear_scene():
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for collection in (
        bpy.data.meshes,
        bpy.data.curves,
        bpy.data.materials,
        bpy.data.cameras,
        bpy.data.lights,
        bpy.data.fonts,
    ):
        for datablock in list(collection):
            if datablock.users == 0:
                collection.remove(datablock)
    scene = bpy.context.scene
    for key in list(scene.keys()):
        del scene[key]
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    scene.unit_settings.length_unit = "METERS"


def material( # NOSONAR python:S3776
    name,
    color,
    *,
    metallic=0.0,
    roughness=0.5,
    emission=None,
    emission_strength=0.0,
    alpha=1.0,
    transmission=0.0,
):
    mat = bpy.data.materials.new(name=name)
    mat.diffuse_color = (*color, alpha)
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get("Principled BSDF")
    if shader:
        shader.inputs["Base Color"].default_value = (*color, alpha)
        shader.inputs["Metallic"].default_value = metallic
        shader.inputs["Roughness"].default_value = roughness
        if "Alpha" in shader.inputs:
            shader.inputs["Alpha"].default_value = alpha
        if "Transmission Weight" in shader.inputs:
            shader.inputs["Transmission Weight"].default_value = transmission
        if emission and emission_strength > 0.0:
            if "Emission Color" in shader.inputs:
                shader.inputs["Emission Color"].default_value = (*emission, 1.0)
            if "Emission Strength" in shader.inputs:
                shader.inputs["Emission Strength"].default_value = emission_strength
    if alpha < 1.0 and hasattr(mat, "surface_render_method"):
        mat.surface_render_method = "DITHERED"
    mat["toonspectrum_pbr"] = True
    return mat


def assign(obj, mat):
    obj.data.materials.clear()
    obj.data.materials.append(mat)


def apply_bevel(obj, width, segments=3):
    if width <= 0.0:
        return obj
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    modifier = obj.modifiers.new(name="EdgeSoftening", type="BEVEL")
    modifier.width = width
    modifier.segments = segments
    modifier.limit_method = "ANGLE"
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    return obj


def smooth(obj):
    if hasattr(obj.data, "polygons"):
        for polygon in obj.data.polygons:
            polygon.use_smooth = True
    return obj


def box(name, dimensions, location, mat, *, edge=0.018, rotation=(0.0, 0.0, 0.0)):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=location)
    obj = bpy.context.active_object
    obj.name = name
    obj.data.name = f"{name}_Mesh"
    obj.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.rotation_euler = rotation
    assign(obj, mat)
    return apply_bevel(obj, min(edge, min(dimensions) * 0.42), 3)


def cylinder(
    name,
    radius,
    depth,
    location,
    mat,
    *,
    vertices=32,
    edge=0.008,
    rotation=(0.0, 0.0, 0.0),
    scale=(1.0, 1.0, 1.0),
):
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices,
        radius=radius,
        depth=depth,
        location=location,
        rotation=rotation,
    )
    obj = bpy.context.active_object
    obj.name = name
    obj.data.name = f"{name}_Mesh"
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    assign(obj, mat)
    apply_bevel(obj, min(edge, radius * 0.3, depth * 0.18), 2)
    return smooth(obj)


def cone(name, radius1, radius2, depth, location, mat, *, vertices=40, edge=0.008):
    bpy.ops.mesh.primitive_cone_add(
        vertices=vertices,
        radius1=radius1,
        radius2=radius2,
        depth=depth,
        location=location,
    )
    obj = bpy.context.active_object
    obj.name = name
    obj.data.name = f"{name}_Mesh"
    assign(obj, mat)
    apply_bevel(obj, min(edge, depth * 0.15, max(radius2, 0.012) * 0.35), 2)
    return smooth(obj)


def sphere(name, radius, location, mat, *, scale=(1.0, 1.0, 1.0), segments=40, rings=20):
    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=segments,
        ring_count=rings,
        radius=radius,
        location=location,
    )
    obj = bpy.context.active_object
    obj.name = name
    obj.data.name = f"{name}_Mesh"
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    assign(obj, mat)
    return smooth(obj)


def ico(name, radius, location, mat, *, subdivisions=3, scale=(1.0, 1.0, 1.0)):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdivisions, radius=radius, location=location)
    obj = bpy.context.active_object
    obj.name = name
    obj.data.name = f"{name}_Mesh"
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    assign(obj, mat)
    return smooth(obj)


def torus(
    name,
    major_radius,
    minor_radius,
    location,
    mat,
    *,
    rotation=(0.0, 0.0, 0.0),
    major_segments=48,
    minor_segments=12,
):
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major_radius,
        minor_radius=minor_radius,
        major_segments=major_segments,
        minor_segments=minor_segments,
        location=location,
        rotation=rotation,
    )
    obj = bpy.context.active_object
    obj.name = name
    obj.data.name = f"{name}_Mesh"
    assign(obj, mat)
    return smooth(obj)


def rod(name, start, end, radius, mat, *, vertices=24, edge=0.005):
    start_vector = Vector(start)
    end_vector = Vector(end)
    direction = end_vector - start_vector
    obj = cylinder(
        name,
        radius,
        direction.length,
        (start_vector + end_vector) * 0.5,
        mat,
        vertices=vertices,
        edge=edge,
    )
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = direction.to_track_quat("Z", "Y")
    return obj


def tube_path(name, points, radius, mat, *, cyclic=False, resolution=2):
    curve = bpy.data.curves.new(f"{name}Curve", type="CURVE")
    curve.dimensions = "3D"
    curve.resolution_u = resolution
    curve.bevel_depth = radius
    curve.bevel_resolution = 3
    spline = curve.splines.new("BEZIER")
    spline.bezier_points.add(len(points) - 1)
    for point, coordinate in zip(spline.bezier_points, points):
        point.co = coordinate
        point.handle_left_type = "AUTO"
        point.handle_right_type = "AUTO"
    spline.use_cyclic_u = cyclic
    obj = bpy.data.objects.new(name, curve)
    bpy.context.scene.collection.objects.link(obj)
    assign(obj, mat)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.convert(target="MESH")
    obj.data.name = f"{name}_Mesh"
    return smooth(obj)


def text_mesh(name, body, location, size, depth, mat, *, align="CENTER", rotation=(pi / 2, 0, 0)):
    bpy.ops.object.text_add(location=location, rotation=rotation)
    obj = bpy.context.active_object
    obj.name = name
    obj.data.body = body
    obj.data.align_x = align
    obj.data.align_y = "CENTER"
    obj.data.size = size
    obj.data.extrude = depth
    obj.data.bevel_depth = depth * 0.2
    obj.data.bevel_resolution = 2
    assign(obj, mat)
    bpy.ops.object.convert(target="MESH")
    obj.data.name = f"{name}_Mesh"
    return obj


def chair(prefix, origin, seat_mat, frame_mat, *, yaw=0.0, upholstered=True):
    x, y, z = origin
    if upholstered:
        seat = sphere(
            f"{prefix}_SeatCushion",
            0.34,
            (x, y, z + 0.48),
            seat_mat,
            scale=(1.0, 0.86, 0.20),
        )
    else:
        seat = box(f"{prefix}_Seat", (0.62, 0.54, 0.09), (x, y, z + 0.48), seat_mat)
    seat.rotation_euler[2] = yaw
    back_offset = Vector((-sin(yaw) * 0.28, cos(yaw) * 0.28, 0.88))
    if upholstered:
        back = sphere(
            f"{prefix}_BackCushion",
            0.35,
            (x + back_offset.x, y + back_offset.y, z + back_offset.z),
            seat_mat,
            scale=(0.95, 0.16, 1.15),
        )
    else:
        back = box(
            f"{prefix}_Back",
            (0.58, 0.08, 0.70),
            (x + back_offset.x, y + back_offset.y, z + back_offset.z),
            seat_mat,
        )
    back.rotation_euler[2] = yaw
    for index, (lx, ly) in enumerate(((-0.25, -0.20), (0.25, -0.20), (-0.25, 0.20), (0.25, 0.20)), 1):
        rotated = Vector((lx * cos(yaw) - ly * sin(yaw), lx * sin(yaw) + ly * cos(yaw), 0.0))
        cylinder(
            f"{prefix}_Leg_{index}",
            0.025,
            0.46,
            (x + rotated.x, y + rotated.y, z + 0.23),
            frame_mat,
            vertices=24,
        )


def table(prefix, origin, top_dimensions, top_mat, frame_mat, *, round_top=False):
    x, y, z = origin
    if round_top:
        cylinder(f"{prefix}_Top", top_dimensions[0] / 2, top_dimensions[2], (x, y, z + 0.77), top_mat, vertices=48)
        cylinder(f"{prefix}_Pedestal", 0.08, 0.72, (x, y, z + 0.38), frame_mat, vertices=32)
        cylinder(f"{prefix}_Foot", 0.34, 0.06, (x, y, z + 0.03), frame_mat, vertices=40)
        return
    box(f"{prefix}_Top", top_dimensions, (x, y, z + 0.77), top_mat, edge=0.025)
    hx = top_dimensions[0] * 0.42
    hy = top_dimensions[1] * 0.36
    for index, (lx, ly) in enumerate(((-hx, -hy), (hx, -hy), (-hx, hy), (hx, hy)), 1):
        cylinder(f"{prefix}_Leg_{index}", 0.035, 0.72, (x + lx, y + ly, z + 0.36), frame_mat)


def build_shell(prefix, dimensions, floor_mat, wall_mat, *, ceiling=False):
    width, depth, height = dimensions
    box(f"{prefix}_Floor", (width, depth, 0.12), (0, 0, 0.06), floor_mat, edge=0.012)
    box(f"{prefix}_BackWall", (width, 0.14, height), (0, depth / 2 - 0.07, height / 2), wall_mat, edge=0.012)
    box(f"{prefix}_LeftWall", (0.14, depth, height), (-width / 2 + 0.07, 0, height / 2), wall_mat, edge=0.012)
    box(f"{prefix}_RightWall", (0.14, depth, height), (width / 2 - 0.07, 0, height / 2), wall_mat, edge=0.012)
    if ceiling:
        box(f"{prefix}_Ceiling", (width, depth, 0.10), (0, 0, height - 0.05), wall_mat, edge=0.01)


def add_root_and_export(asset_id, dimensions, semantic_parts):
    root = bpy.data.objects.new(f"TS_ENV_{asset_id}_Root", None)
    root.empty_display_type = "CUBE"
    root["asset_id"] = f"ts-bg3d-{asset_id}-v1"
    root["asset_type"] = "studio-bg3d-environment"
    root["asset_author"] = "ToonSpectrum"
    root["asset_generator"] = GENERATOR
    root["asset_generator_version"] = "3.0.0-blender-5.2"
    root["asset_license"] = "CC0-1.0"
    root["asset_license_url"] = CC0_LICENSE_URL
    root["units"] = "metres"
    root["ground_plane"] = "glTF-Y=0"
    root["ground_y_m"] = 0.0
    root["nominal_width_m"] = dimensions[0]
    root["nominal_depth_m"] = dimensions[1]
    root["nominal_height_m"] = dimensions[2]
    root["semantic_parts"] = semantic_parts
    bpy.context.scene.collection.objects.link(root)
    for obj in tuple(bpy.context.scene.objects):
        if obj is not root and obj.type in {"MESH", "CURVE", "FONT"} and obj.parent is None:
            obj.parent = root
    bpy.context.scene["toonspectrum_asset_id"] = f"ts-bg3d-{asset_id}-v1"
    destination = OUTPUT_DIRECTORY / f"{asset_id}.glb"
    bpy.ops.export_scene.gltf(
        filepath=str(destination),
        export_format="GLB",
        export_apply=True,
        export_extras=True,
        export_materials="EXPORT",
        export_cameras=False,
        export_lights=False,
        export_yup=True,
    )
    print(f"Exported {asset_id}: {destination}")


def render_thumbnail(asset_id, camera_location, camera_target, *, world=(0.035, 0.045, 0.070, 1.0), energy=1300):
    if ARGS.skip_thumbnails:
        return
    scene = bpy.context.scene
    # Blender 5.2 exposes Eevee Next through the stable `BLENDER_EEVEE` enum.
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 640
    scene.render.resolution_y = 400
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.render.filepath = str(THUMBNAIL_DIRECTORY / f"{asset_id}.png")
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    scene.world.color = world[:3]
    scene.world.use_nodes = True
    background = scene.world.node_tree.nodes.get("Background")
    background.inputs["Color"].default_value = world
    background.inputs["Strength"].default_value = 0.35

    bpy.ops.object.camera_add(location=camera_location)
    camera = bpy.context.active_object
    camera.name = f"PreviewCamera_{asset_id}"
    camera.data.lens = 44
    camera.data.sensor_width = 36
    camera.rotation_euler = (Vector(camera_target) - camera.location).to_track_quat("-Z", "Y").to_euler()
    scene.camera = camera

    bpy.ops.object.light_add(type="AREA", location=(camera_location[0] * 0.45, camera_location[1] * 0.35, max(4.5, camera_location[2] + 1)))
    key = bpy.context.active_object
    key.name = "Preview_Key_Area"
    key.data.energy = energy
    key.data.shape = "DISK"
    key.data.size = 6.0
    key.rotation_euler = (Vector(camera_target) - key.location).to_track_quat("-Z", "Y").to_euler()
    bpy.ops.object.light_add(type="AREA", location=(-4.0, -1.5, 3.0))
    fill = bpy.context.active_object
    fill.name = "Preview_Fill_Area"
    fill.data.energy = energy * 0.55
    fill.data.color = (0.42, 0.58, 1.0)
    fill.data.size = 5.0
    fill.rotation_euler = (Vector(camera_target) - fill.location).to_track_quat("-Z", "Y").to_euler()
    bpy.ops.object.light_add(type="SUN", location=(0, 0, 6))
    sun = bpy.context.active_object
    sun.name = "Preview_Rim_Sun"
    sun.data.energy = 1.4
    sun.rotation_euler = (0.5, -0.6, -0.35)
    bpy.ops.render.render(write_still=True)
    print(f"Rendered {asset_id}: {scene.render.filepath}")


def build_compact_apartment_interior():
    clear_scene()
    oak = material("Apartment_WarmOak", (0.40, 0.19, 0.07), roughness=0.52)
    plaster = material("Apartment_CreamPlaster", (0.76, 0.72, 0.63), roughness=0.88)
    charcoal = material("Apartment_CharcoalMetal", (0.055, 0.065, 0.075), metallic=0.78, roughness=0.24)
    teal = material("Apartment_TealUpholstery", (0.025, 0.28, 0.29), roughness=0.72)
    rust = material("Apartment_RustTextile", (0.60, 0.15, 0.055), roughness=0.80)
    stone = material("Apartment_StoneCounter", (0.46, 0.49, 0.50), roughness=0.32)
    glass = material("Apartment_WindowGlass", (0.20, 0.40, 0.57), roughness=0.08, alpha=0.55, transmission=0.35)
    brass = material("Apartment_BrushedBrass", (0.62, 0.36, 0.10), metallic=0.88, roughness=0.22)
    green = material("Apartment_PlantLeaf", (0.055, 0.34, 0.12), roughness=0.68)
    ceramic = material("Apartment_Ceramic", (0.86, 0.80, 0.68), roughness=0.30)
    warm = material("Apartment_WarmLamp", (0.9, 0.48, 0.10), emission=(1.0, 0.34, 0.04), emission_strength=3.2)
    build_shell("Apartment", (7.0, 6.0, 3.2), oak, plaster)
    box("Apartment_Rug", (3.1, 2.1, 0.035), (1.15, -0.55, 0.14), rust, edge=0.015)
    for wx in (-1.25, 0.0, 1.25):
        box(f"Window_Glass_{wx:+.2f}", (1.05, 0.035, 1.35), (wx, 2.91, 2.02), glass, edge=0.01)
        box(f"Window_FrameTop_{wx:+.2f}", (1.18, 0.08, 0.06), (wx, 2.87, 2.72), charcoal)
        box(f"Window_FrameBottom_{wx:+.2f}", (1.18, 0.08, 0.06), (wx, 2.87, 1.32), charcoal)
        box(f"Window_FrameLeft_{wx:+.2f}", (0.06, 0.08, 1.46), (wx - 0.56, 2.87, 2.02), charcoal)
        box(f"Window_FrameRight_{wx:+.2f}", (0.06, 0.08, 1.46), (wx + 0.56, 2.87, 2.02), charcoal)
    # Kitchen wall and appliance bank.
    for index, y in enumerate((1.85, 1.18, 0.51, -0.16), 1):
        box(f"Kitchen_BaseCabinet_{index}", (0.62, 0.62, 0.78), (-3.08, y, 0.47), oak, edge=0.025)
        cylinder(f"Kitchen_Handle_{index}", 0.012, 0.28, (-2.75, y, 0.58), brass, rotation=(0, pi / 2, 0))
    box("Kitchen_StoneCounter", (0.70, 2.92, 0.12), (-3.05, 0.85, 0.91), stone, edge=0.02)
    box("Kitchen_TallFridge", (0.72, 0.82, 2.20), (-3.02, 2.25, 1.16), charcoal, edge=0.045)
    box("Kitchen_SinkBasin", (0.52, 0.58, 0.14), (-3.0, 1.18, 0.96), charcoal, edge=0.04)
    tube_path("Kitchen_Faucet", [(-3.0, 1.42, 0.98), (-3.0, 1.42, 1.35), (-3.0, 1.18, 1.42)], 0.025, brass)
    # Sofa, coffee table, media unit.
    box("Sofa_Base", (2.45, 0.92, 0.34), (1.45, 0.54, 0.35), teal, edge=0.10)
    box("Sofa_Back", (2.45, 0.28, 1.02), (1.45, 0.92, 0.94), teal, edge=0.10)
    box("Sofa_LeftArm", (0.30, 0.92, 0.70), (0.37, 0.54, 0.63), teal, edge=0.10)
    box("Sofa_RightArm", (0.30, 0.92, 0.70), (2.53, 0.54, 0.63), teal, edge=0.10)
    for index, x in enumerate((0.77, 1.45, 2.13), 1):
        sphere(f"Sofa_SeatCushion_{index}", 0.42, (x, 0.42, 0.64), teal, scale=(0.78, 0.72, 0.20))
        sphere(f"Sofa_BackCushion_{index}", 0.43, (x, 0.77, 1.03), rust if index == 2 else teal, scale=(0.78, 0.18, 0.86))
    table("CoffeeTable", (1.35, -0.72, 0), (1.65, 0.76, 0.10), oak, charcoal)
    for index, (x, y, color_mat) in enumerate(((1.0, -0.72, rust), (1.25, -0.69, plaster), (1.50, -0.74, teal)), 1):
        box(f"CoffeeTable_Book_{index}", (0.42, 0.28, 0.045), (x, y, 0.88 + index * 0.05), color_mat, edge=0.008)
    box("Media_Console", (2.3, 0.42, 0.56), (1.45, 2.38, 0.40), oak, edge=0.035)
    box("Media_Display", (1.85, 0.10, 1.05), (1.45, 2.60, 1.45), charcoal, edge=0.035)
    # Compact sleeping nook and dining corner.
    box("Bed_Platform", (2.15, 2.0, 0.32), (-1.25, -1.85, 0.30), oak, edge=0.05)
    box("Bed_Mattress", (2.02, 1.88, 0.30), (-1.25, -1.85, 0.59), plaster, edge=0.12)
    for index, x in enumerate((-1.73, -0.77), 1):
        sphere(f"Bed_Pillow_{index}", 0.42, (x, -1.25, 0.88), rust, scale=(1.0, 0.62, 0.25))
    box("Bed_Throw", (2.0, 0.92, 0.08), (-1.25, -2.12, 0.79), teal, edge=0.035)
    table("DiningTable", (2.25, -1.70, 0), (1.35, 1.05, 0.10), oak, charcoal, round_top=True)
    for index, (x, y, yaw) in enumerate(((1.45, -1.70, -pi / 2), (3.02, -1.70, pi / 2), (2.25, -2.55, 0), (2.25, -0.85, pi)), 1):
        chair(f"DiningChair_{index}", (x, y, 0), rust, charcoal, yaw=yaw)
    # Plant and floor lamp make the room read at thumbnail scale.
    cone("Plant_Pot", 0.36, 0.29, 0.58, (-2.55, -2.15, 0.35), ceramic)
    for index in range(14):
        angle = index * (2 * pi / 14)
        radius = 0.18 + (index % 3) * 0.08
        z = 0.78 + (index % 5) * 0.17
        rod(f"Plant_Stem_{index+1}", (-2.55, -2.15, 0.58), (-2.55 + cos(angle) * radius, -2.15 + sin(angle) * radius, z), 0.014, green)
        ico(f"Plant_Leaf_{index+1}", 0.16, (-2.55 + cos(angle) * radius, -2.15 + sin(angle) * radius, z), green, subdivisions=2, scale=(1.7, 0.55, 0.35))
    cylinder("Lamp_Stand", 0.025, 1.72, (3.02, 1.65, 0.86), brass)
    cylinder("Lamp_Base", 0.27, 0.05, (3.02, 1.65, 0.025), brass, vertices=48)
    cone("Lamp_Shade", 0.35, 0.21, 0.43, (3.02, 1.65, 1.78), rust)
    sphere("Lamp_Glow", 0.14, (3.02, 1.65, 1.72), warm)
    add_root_and_export("compact_apartment_interior", (7.0, 6.0, 3.2), "shell,kitchen,living,dining,sleeping,lighting,plants")
    render_thumbnail("compact_apartment_interior", (9.1, -10.5, 7.7), (0.0, 0.1, 1.25), world=(0.055, 0.045, 0.038, 1.0), energy=1500)


def build_stylized_cafe_interior(): # NOSONAR python:S3776
    clear_scene()
    terrazzo = material("Cafe_TerrazzoFloor", (0.39, 0.31, 0.26), roughness=0.65)
    mint = material("Cafe_MintWall", (0.32, 0.62, 0.54), roughness=0.76)
    walnut = material("Cafe_Walnut", (0.25, 0.085, 0.035), roughness=0.52)
    cream = material("Cafe_Cream", (0.88, 0.76, 0.56), roughness=0.64)
    coral = material("Cafe_Coral", (0.78, 0.15, 0.10), roughness=0.66)
    brass = material("Cafe_Brass", (0.64, 0.34, 0.08), metallic=0.86, roughness=0.22)
    steel = material("Cafe_Steel", (0.22, 0.25, 0.27), metallic=0.84, roughness=0.25)
    dark = material("Cafe_DarkCounter", (0.045, 0.040, 0.050), roughness=0.36)
    glass = material("Cafe_DisplayGlass", (0.35, 0.65, 0.72), roughness=0.08, alpha=0.48, transmission=0.42)
    green = material("Cafe_Plant", (0.045, 0.36, 0.12), roughness=0.74)
    glow = material("Cafe_SignGlow", (0.96, 0.32, 0.13), emission=(1.0, 0.15, 0.03), emission_strength=5.0)
    pastry = material("Cafe_Pastry", (0.68, 0.30, 0.08), roughness=0.78)
    build_shell("Cafe", (9.0, 7.0, 3.6), terrazzo, mint)
    # Service counter, pastry display, menu and espresso hardware.
    box("Cafe_ServiceCounter", (5.4, 0.95, 1.02), (-1.0, 1.72, 0.57), walnut, edge=0.07)
    box("Cafe_CounterTop", (5.6, 1.05, 0.12), (-1.0, 1.72, 1.12), dark, edge=0.035)
    box("Cafe_PastryDisplay_Base", (1.62, 0.88, 0.18), (-2.55, 1.62, 1.30), brass, edge=0.025)
    box("Cafe_PastryDisplay_Glass", (1.58, 0.82, 0.72), (-2.55, 1.62, 1.64), glass, edge=0.035)
    for index, (x, y, z) in enumerate(((-3.0, 1.55, 1.42), (-2.65, 1.55, 1.42), (-2.3, 1.55, 1.42), (-2.82, 1.82, 1.73), (-2.42, 1.82, 1.73), (-2.62, 1.48, 1.88)), 1):
        sphere(f"Pastry_{index}", 0.16, (x, y, z), pastry, scale=(1.15, 0.82, 0.64))
    box("EspressoMachine_Body", (1.20, 0.62, 0.72), (0.55, 1.66, 1.52), steel, edge=0.08)
    for index, x in enumerate((0.24, 0.55, 0.86), 1):
        cylinder(f"Espresso_Dial_{index}", 0.07, 0.05, (x, 1.32, 1.63), brass, rotation=(pi / 2, 0, 0))
    for index, x in enumerate((0.32, 0.78), 1):
        tube_path(f"Espresso_Group_{index}", [(x, 1.35, 1.46), (x, 1.25, 1.37), (x + 0.16, 1.20, 1.32)], 0.025, steel)
    box("Cafe_MenuBoard", (2.7, 0.10, 1.05), (-0.2, 3.34, 2.43), dark, edge=0.025)
    text_mesh("Cafe_MenuText", "CAFE  LATTE  CAKE", (-0.2, 3.26, 2.44), 0.26, 0.015, cream, rotation=(pi / 2, 0, 0))
    text_mesh("Cafe_NeonSign", "MOON CAFE", (2.15, 3.27, 2.75), 0.38, 0.025, glow, rotation=(pi / 2, 0, 0))
    # Four table islands with twelve plush chairs.
    table_positions = ((-2.9, -0.35), (0.0, -0.55), (2.85, -0.25), (0.2, -2.55))
    for table_index, (tx, ty) in enumerate(table_positions, 1):
        table(f"CafeTable_{table_index}", (tx, ty, 0), (1.05, 1.05, 0.10), cream, brass, round_top=True)
        for chair_index, angle in enumerate((0.0, 2.10, 4.20), 1):
            radius = 0.92
            x = tx + cos(angle) * radius
            y = ty + sin(angle) * radius
            chair(f"CafeChair_{table_index}_{chair_index}", (x, y, 0), coral if chair_index == 2 else mint, brass, yaw=angle - pi / 2)
    # Pendant lights, tiled front, plants and cup details.
    for index, x in enumerate((-2.6, -0.8, 1.0, 2.8), 1):
        cylinder(f"Pendant_Cord_{index}", 0.012, 0.78, (x, 0.65, 3.18), dark)
        cone(f"Pendant_Shade_{index}", 0.32, 0.11, 0.34, (x, 0.65, 2.75), brass)
        sphere(f"Pendant_Bulb_{index}", 0.11, (x, 0.65, 2.66), glow)
    for row in range(2):
        for column in range(12):
            box(f"CounterTile_{row+1}_{column+1}", (0.40, 0.025, 0.36), (-3.2 + column * 0.40, 1.23, 0.24 + row * 0.38), cream if (row + column) % 2 else mint, edge=0.012)
    for plant_index, (x, y) in enumerate(((-4.0, -2.8), (3.95, 2.50)), 1):
        cone(f"CafePlant_Pot_{plant_index}", 0.34, 0.27, 0.56, (x, y, 0.34), coral)
        for leaf_index in range(10):
            angle = leaf_index * 2 * pi / 10
            ico(f"CafePlant_{plant_index}_Leaf_{leaf_index+1}", 0.18, (x + cos(angle) * 0.26, y + sin(angle) * 0.26, 0.70 + (leaf_index % 4) * 0.16), green, subdivisions=2, scale=(1.55, 0.58, 0.34))
    add_root_and_export("stylized_cafe_interior", (9.0, 7.0, 3.6), "shell,counter,seating,coffee,pastry,signage,lighting,plants")
    render_thumbnail("stylized_cafe_interior", (11.7, -13.0, 8.8), (0.0, 0.4, 1.35), world=(0.055, 0.040, 0.035, 1.0), energy=1750)


def build_urban_neon_alley(): # NOSONAR python:S3776
    clear_scene()
    asphalt = material("Alley_WetAsphalt", (0.035, 0.045, 0.058), metallic=0.12, roughness=0.28)
    brick = material("Alley_OldBrick", (0.31, 0.075, 0.045), roughness=0.86)
    concrete = material("Alley_Concrete", (0.23, 0.25, 0.27), roughness=0.82)
    steel = material("Alley_Steel", (0.12, 0.15, 0.18), metallic=0.84, roughness=0.30)
    rust = material("Alley_Rust", (0.42, 0.11, 0.025), metallic=0.48, roughness=0.63)
    cyan = material("Alley_NeonCyan", (0.0, 0.55, 0.78), emission=(0.0, 0.72, 1.0), emission_strength=6.0)
    magenta = material("Alley_NeonMagenta", (0.86, 0.02, 0.31), emission=(1.0, 0.0, 0.22), emission_strength=6.5)
    amber = material("Alley_NeonAmber", (0.88, 0.28, 0.02), emission=(1.0, 0.16, 0.01), emission_strength=5.0)
    glass = material("Alley_WetGlass", (0.09, 0.20, 0.26), roughness=0.06, alpha=0.45, transmission=0.28)
    trash = material("Alley_TrashBag", (0.018, 0.022, 0.028), roughness=0.42)
    green = material("Alley_GrimeGreen", (0.06, 0.24, 0.08), roughness=0.90)
    # Long street canyon, open at both ends and overhead.
    box("Alley_Street", (6.8, 14.0, 0.16), (0, 0, 0.08), asphalt, edge=0.015)
    box("Alley_LeftBuilding", (0.30, 14.0, 7.0), (-3.25, 0, 3.5), brick, edge=0.018)
    box("Alley_RightBuilding", (0.30, 14.0, 7.0), (3.25, 0, 3.5), concrete, edge=0.018)
    for side, x in (("Left", -3.03), ("Right", 3.03)):
        for level, z in enumerate((1.35, 3.0, 4.65, 6.2), 1):
            for bay, y in enumerate((-5.2, -2.6, 0.0, 2.6, 5.2), 1):
                box(f"{side}_Window_{level}_{bay}", (0.08, 1.02, 0.92), (x, y, z), glass, edge=0.02)
                box(f"{side}_WindowTop_{level}_{bay}", (0.11, 1.16, 0.07), (x + (-0.05 if side == "Left" else 0.05), y, z + 0.50), steel)
                box(f"{side}_WindowBottom_{level}_{bay}", (0.11, 1.16, 0.07), (x + (-0.05 if side == "Left" else 0.05), y, z - 0.50), steel)
    # Fire escape, ladders, pipework and AC fans.
    for level, z in enumerate((2.2, 4.1, 6.0), 1):
        box(f"FireEscape_Platform_{level}", (1.35, 2.4, 0.10), (-2.52, -1.8 + level * 0.8, z), steel)
        for bar in range(7):
            rod(f"FireEscape_Rail_{level}_{bar}", (-1.90, -2.85 + level * 0.8 + bar * 0.34, z + 0.08), (-1.90, -2.85 + level * 0.8 + bar * 0.34, z + 0.80), 0.026, steel)
        rod(f"FireEscape_TopRail_{level}", (-1.90, -2.85 + level * 0.8, z + 0.80), (-1.90, -0.82 + level * 0.8, z + 0.80), 0.028, steel)
    for pipe_index, (x, y, height, pipe_mat) in enumerate(((-2.85, 4.5, 6.4, rust), (2.86, -3.6, 5.9, steel), (2.78, 4.9, 4.8, rust)), 1):
        tube_path(f"UtilityPipe_{pipe_index}", [(x, y, 0.22), (x, y, height), (x, y - 1.2, height), (x, y - 1.8, height - 0.6)], 0.085, pipe_mat)
        for ring_index, z in enumerate((1.1, 2.4, 3.7, 5.0), 1):
            torus(f"PipeClamp_{pipe_index}_{ring_index}", 0.10, 0.018, (x, y, z), steel, major_segments=32, minor_segments=8)
    for index, (x, y, z) in enumerate(((2.83, -4.8, 2.0), (2.83, 0.2, 3.1), (-2.83, 3.7, 2.6)), 1):
        box(f"ACUnit_{index}", (0.42, 1.05, 0.82), (x, y, z), steel, edge=0.05)
        torus(f"ACFan_Rim_{index}", 0.31, 0.045, (x + (-0.23 if x < 0 else 0.23), y, z), rust, rotation=(0, pi / 2, 0))
        for blade in range(6):
            angle = blade * pi / 3
            box(f"ACFan_{index}_Blade_{blade+1}", (0.04, 0.28, 0.08), (x + (-0.25 if x < 0 else 0.25), y + cos(angle) * 0.12, z + sin(angle) * 0.12), steel, rotation=(angle, 0, 0))
    # Neon signs and hanging lanterns.
    box("NeonSign_Cyan_Back", (0.16, 2.7, 1.0), (-2.88, -4.2, 3.3), steel, edge=0.04)
    text_mesh("NeonSign_Cyan_Text", "NIGHT", (-2.72, -4.2, 3.3), 0.55, 0.035, cyan, rotation=(pi / 2, 0, -pi / 2))
    box("NeonSign_Magenta_Back", (0.16, 2.0, 0.9), (2.88, 2.5, 4.4), steel, edge=0.04)
    text_mesh("NeonSign_Magenta_Text", "24H", (2.72, 2.5, 4.4), 0.62, 0.035, magenta, rotation=(pi / 2, 0, pi / 2))
    for index, y in enumerate((-5.3, -2.6, 0.1, 2.8, 5.5), 1):
        tube_path(f"OverheadCable_{index}", [(-3.0, y - 0.4, 5.8), (0, y, 5.1 - (index % 2) * 0.35), (3.0, y + 0.35, 5.7)], 0.028, steel)
        cylinder(f"LanternCord_{index}", 0.012, 0.62, (0, y, 4.88), steel)
        sphere(f"LanternGlow_{index}", 0.16, (0, y, 4.54), amber if index % 2 else magenta)
        torus(f"LanternCage_{index}", 0.22, 0.025, (0, y, 4.54), steel, major_segments=36, minor_segments=8)
    # Wet reflections, crates, bins and detailed trash bags.
    for index, (x, y, sx, sy) in enumerate(((-1.5, -4.3, 1.6, 1.1), (1.4, -1.3, 1.2, 2.0), (-0.8, 2.4, 1.8, 1.0), (1.1, 5.2, 1.4, 1.2)), 1):
        box(f"Puddle_{index}", (sx, sy, 0.012), (x, y, 0.17), glass, edge=0.006)
    for index, (x, y) in enumerate(((-2.4, -5.4), (-2.1, -4.9), (2.2, -2.0), (2.45, -1.55), (-2.3, 3.8), (-2.0, 4.25), (2.25, 5.0), (2.5, 5.35)), 1):
        ico(f"TrashBag_{index}", 0.38, (x, y, 0.39), trash, subdivisions=3, scale=(0.78, 0.92, 1.18))
        torus(f"TrashTie_{index}", 0.075, 0.018, (x, y, 0.78), rust, major_segments=24, minor_segments=8)
    for index, (x, y, z) in enumerate(((-2.65, -0.1, 0.42), (-2.3, -0.1, 0.70), (2.65, 3.1, 0.42)), 1):
        box(f"DeliveryCrate_{index}", (0.62, 0.78, 0.62), (x, y, z), rust, edge=0.035)
    for index in range(10):
        ico(f"WallVine_{index+1}", 0.13, (-3.0, 5.4 + sin(index) * 0.35, 0.7 + index * 0.48), green, subdivisions=2, scale=(0.6, 1.8, 0.35))
    add_root_and_export("urban_neon_alley", (6.8, 14.0, 7.0), "street,buildings,fire-escape,utilities,signage,lighting,street-props")
    # Look through the intentionally open street end; a diagonal exterior view would let a full
    # building wall occlude the navigable alley interior in the catalog thumbnail.
    render_thumbnail("urban_neon_alley", (0.0, -19.0, 5.7), (0.0, 1.0, 2.55), world=(0.008, 0.012, 0.030, 1.0), energy=900)


def build_classroom_art_studio():
    clear_scene()
    wood = material("ArtStudio_BirchWood", (0.48, 0.27, 0.10), roughness=0.62)
    plaster = material("ArtStudio_WhitePlaster", (0.76, 0.77, 0.72), roughness=0.90)
    concrete = material("ArtStudio_ConcreteFloor", (0.30, 0.32, 0.31), roughness=0.80)
    steel = material("ArtStudio_BlackSteel", (0.055, 0.065, 0.070), metallic=0.78, roughness=0.28)
    canvas = material("ArtStudio_Canvas", (0.84, 0.76, 0.62), roughness=0.95)
    blue = material("ArtStudio_CobaltPaint", (0.025, 0.18, 0.70), roughness=0.46)
    red = material("ArtStudio_CadmiumPaint", (0.78, 0.06, 0.035), roughness=0.50)
    yellow = material("ArtStudio_YellowPaint", (0.92, 0.55, 0.015), roughness=0.48)
    green = material("ArtStudio_GreenPaint", (0.04, 0.42, 0.16), roughness=0.52)
    ceramic = material("ArtStudio_SculptureClay", (0.58, 0.42, 0.30), roughness=0.92)
    glass = material("ArtStudio_WindowGlass", (0.35, 0.62, 0.76), roughness=0.08, alpha=0.55, transmission=0.34)
    glow = material("ArtStudio_DaylightPanel", (0.82, 0.90, 1.0), emission=(0.72, 0.86, 1.0), emission_strength=2.8)
    build_shell("ArtStudio", (10.0, 8.0, 4.0), concrete, plaster)
    # Clerestory windows and ceiling lights.
    for index, x in enumerate((-3.6, -1.2, 1.2, 3.6), 1):
        box(f"Clerestory_Glass_{index}", (1.85, 0.04, 1.15), (x, 3.91, 2.85), glass, edge=0.012)
        box(f"Clerestory_Frame_{index}_Top", (2.0, 0.09, 0.07), (x, 3.86, 3.46), steel)
        box(f"Clerestory_Frame_{index}_Bottom", (2.0, 0.09, 0.07), (x, 3.86, 2.24), steel)
    for index, x in enumerate((-3.2, 0.0, 3.2), 1):
        box(f"CeilingLight_{index}", (2.1, 0.72, 0.06), (x, 0.6, 3.82), glow, edge=0.025)
    # Eight individual easel stations and upholstered drafting stools.
    stations = ((-3.5, 1.9), (-1.2, 1.9), (1.2, 1.9), (3.5, 1.9), (-3.5, -1.3), (-1.2, -1.3), (1.2, -1.3), (3.5, -1.3))
    paint_mats = (blue, red, yellow, green)
    for index, (x, y) in enumerate(stations, 1):
        rod(f"Easel_{index}_Left", (x - 0.40, y, 0.05), (x - 0.28, y, 2.55), 0.035, wood)
        rod(f"Easel_{index}_Right", (x + 0.40, y, 0.05), (x + 0.28, y, 2.55), 0.035, wood)
        rod(f"Easel_{index}_Rear", (x, y + 0.36, 0.05), (x, y + 0.08, 2.40), 0.035, wood)
        box(f"Easel_{index}_Canvas", (1.18, 0.075, 1.42), (x, y - 0.03, 1.56), canvas, edge=0.012)
        box(f"Easel_{index}_Shelf", (1.30, 0.34, 0.09), (x, y - 0.18, 0.78), wood, edge=0.018)
        # Abstract raised colour strokes.
        for stroke in range(3):
            box(f"Canvas_{index}_Stroke_{stroke+1}", (0.62 - stroke * 0.12, 0.025, 0.12), (x + (stroke - 1) * 0.10, y - 0.078, 1.25 + stroke * 0.28), paint_mats[(index + stroke) % 4], edge=0.012, rotation=(0, stroke * 0.18, (stroke - 1) * 0.30))
        cylinder(f"Stool_{index}_Post", 0.045, 0.62, (x, y - 1.00, 0.34), steel)
        sphere(f"Stool_{index}_Seat", 0.34, (x, y - 1.00, 0.70), paint_mats[index % 4], scale=(1.0, 1.0, 0.22))
        for leg in range(4):
            angle = leg * pi / 2
            rod(f"Stool_{index}_Leg_{leg+1}", (x, y - 1.00, 0.35), (x + cos(angle) * 0.35, y - 1.00 + sin(angle) * 0.35, 0.02), 0.025, steel)
    # Sculpture platform with a deliberately faceted bust.
    cylinder("Sculpture_Plinth", 0.72, 0.95, (0.0, -3.10, 0.48), plaster, vertices=48)
    ico("Sculpture_Torso", 0.58, (0.0, -3.10, 1.32), ceramic, subdivisions=3, scale=(0.72, 0.48, 1.0))
    ico("Sculpture_Head", 0.38, (0.0, -3.10, 2.03), ceramic, subdivisions=3, scale=(0.78, 0.72, 1.05))
    ico("Sculpture_Hair", 0.41, (0.0, -3.12, 2.23), steel, subdivisions=3, scale=(0.86, 0.72, 0.62))
    cylinder("Sculpture_Neck", 0.18, 0.32, (0.0, -3.10, 1.70), ceramic, vertices=40)
    # Supply wall, paint jars, rolled paper and sink.
    box("Supply_Shelving", (8.6, 0.48, 2.55), (0.0, 3.50, 1.40), wood, edge=0.025)
    for shelf in range(4):
        box(f"Supply_Shelf_{shelf+1}", (8.4, 0.72, 0.08), (0.0, 3.16, 0.36 + shelf * 0.65), steel, edge=0.012)
    for index in range(24):
        x = -3.8 + (index % 12) * 0.68
        z = 0.58 + (index // 12) * 0.65
        cylinder(f"PaintJar_{index+1}", 0.12, 0.28, (x, 3.02, z), paint_mats[index % 4], vertices=32)
        cylinder(f"PaintJarLid_{index+1}", 0.13, 0.035, (x, 3.02, z + 0.16), steel, vertices=32)
    for index in range(8):
        cylinder(f"PaperRoll_{index+1}", 0.10, 1.05, (-4.3 + index * 0.28, 3.0, 1.87), canvas, vertices=32)
    box("UtilitySink_Cabinet", (1.35, 0.65, 0.82), (4.05, 3.18, 0.47), steel, edge=0.035)
    box("UtilitySink_Basin", (1.18, 0.58, 0.16), (4.05, 2.98, 0.94), plaster, edge=0.05)
    tube_path("UtilitySink_Faucet", [(4.05, 3.18, 0.98), (4.05, 3.18, 1.35), (4.05, 2.95, 1.42)], 0.025, steel)
    add_root_and_export("classroom_art_studio", (10.0, 8.0, 4.0), "shell,windows,easels,stools,sculpture,supplies,sink,lighting")
    render_thumbnail("classroom_art_studio", (13.0, -14.8, 9.6), (0.0, 0.1, 1.45), world=(0.045, 0.050, 0.052, 1.0), energy=1900)


def build_fantasy_ruin_courtyard(): # NOSONAR python:S3776
    clear_scene()
    limestone = material("Ruin_Limestone", (0.47, 0.43, 0.32), roughness=0.92)
    mossy = material("Ruin_MossyStone", (0.23, 0.30, 0.13), roughness=0.96)
    darkstone = material("Ruin_DarkStone", (0.16, 0.18, 0.15), roughness=0.90)
    material("Ruin_AncientBronze", (0.32, 0.17, 0.045), metallic=0.72, roughness=0.44)
    moss = material("Ruin_Moss", (0.055, 0.31, 0.08), roughness=0.98)
    vine = material("Ruin_Vines", (0.025, 0.20, 0.055), roughness=0.90)
    crystal = material("Ruin_RuneCrystal", (0.18, 0.10, 0.70), metallic=0.10, roughness=0.10, emission=(0.42, 0.12, 1.0), emission_strength=5.2)
    water = material("Ruin_Water", (0.05, 0.28, 0.38), roughness=0.08, alpha=0.52, transmission=0.38)
    gold = material("Ruin_RuneGold", (0.62, 0.38, 0.08), metallic=0.88, roughness=0.25)
    flower = material("Ruin_Wildflower", (0.66, 0.06, 0.30), roughness=0.62)
    # Courtyard floor and broken perimeter.
    cylinder("Ruin_CourtyardFloor", 5.7, 0.16, (0, 0, 0.08), limestone, vertices=64, edge=0.01)
    for ring_index, radius in enumerate((1.65, 3.45, 5.25), 1):
        torus(f"Courtyard_Inlay_{ring_index}", radius, 0.055, (0, 0, 0.18), gold, major_segments=72, minor_segments=10)
    for index in range(24):
        angle = index * 2 * pi / 24
        radius = 4.35 + sin(index * 1.7) * 0.35
        stone_mat = mossy if index % 3 == 0 else limestone
        ico(f"RubbleStone_{index+1}", 0.42 + (index % 4) * 0.05, (cos(angle) * radius, sin(angle) * radius, 0.40 + (index % 3) * 0.08), stone_mat, subdivisions=3, scale=(1.35, 0.82, 0.72))
    # Six columns at different states of collapse.
    for index, angle in enumerate((0.25, 1.35, 2.45, 3.55, 4.65, 5.75), 1):
        x, y = cos(angle) * 4.55, sin(angle) * 4.55
        height = (4.8, 3.6, 5.4, 2.9, 4.2, 5.1)[index - 1]
        cylinder(f"Column_{index}_Base", 0.62, 0.28, (x, y, 0.22), darkstone, vertices=48)
        cylinder(f"Column_{index}_Shaft", 0.42, height, (x, y, 0.36 + height / 2), limestone if index % 2 else mossy, vertices=48, edge=0.015)
        for band in range(5):
            torus(f"Column_{index}_FluteBand_{band+1}", 0.43, 0.025, (x, y, 0.75 + band * max(0.45, (height - 0.8) / 5)), gold if band == 4 else darkstone, major_segments=40, minor_segments=8)
        cylinder(f"Column_{index}_Capital", 0.62, 0.30, (x, y, 0.42 + height), darkstone, vertices=48)
    # Three arch gateways built from voussoir blocks along a half circle.
    for arch_index, angle in enumerate((0.0, 2.1, 4.2), 1):
        center = Vector((cos(angle) * 4.65, sin(angle) * 4.65, 0.0))
        tangent = Vector((-sin(angle), cos(angle), 0.0))
        for side in (-1, 1):
            foot = center + tangent * side * 1.35
            box(f"Arch_{arch_index}_Pier_{'L' if side < 0 else 'R'}", (0.72, 0.72, 3.0), (foot.x, foot.y, 1.52), limestone, edge=0.06, rotation=(0, 0, angle))
        for block_index in range(13):
            theta = pi - block_index * pi / 12
            point = center + tangent * (cos(theta) * 1.35) + Vector((0, 0, 3.0 + sin(theta) * 1.35))
            box(f"Arch_{arch_index}_Voussoir_{block_index+1}", (0.48, 0.78, 0.54), point, mossy if block_index % 4 == 0 else limestone, edge=0.055, rotation=(0, theta - pi / 2, angle))
    # Central fountain/rune dais.
    cylinder("Fountain_Base", 1.28, 0.34, (0, 0, 0.28), darkstone, vertices=64)
    cylinder("Fountain_Basin", 1.05, 0.22, (0, 0, 0.54), limestone, vertices=64)
    cylinder("Fountain_Water", 0.88, 0.035, (0, 0, 0.67), water, vertices=64)
    cylinder("Fountain_Pedestal", 0.32, 1.42, (0, 0, 1.35), darkstone, vertices=48)
    ico("Fountain_RuneCrystal", 0.48, (0, 0, 2.23), crystal, subdivisions=3, scale=(0.68, 0.68, 1.55))
    for index in range(6):
        angle = index * pi / 3
        ico(f"Fountain_SatelliteCrystal_{index+1}", 0.22, (cos(angle) * 0.68, sin(angle) * 0.68, 0.86), crystal, subdivisions=2, scale=(0.65, 0.65, 1.45))
    # Vines and wildflowers crawl over the far ruins.
    for index in range(14):
        angle = 1.0 + index * 0.20
        base = Vector((cos(angle) * 5.0, sin(angle) * 5.0, 0.25))
        tube_path(f"Vine_{index+1}", [base, base + Vector((0.12, -0.10, 1.1)), base + Vector((-0.18, 0.15, 2.1)), base + Vector((0.10, -0.12, 3.0))], 0.028, vine)
        for leaf in range(3):
            ico(f"Vine_{index+1}_Leaf_{leaf+1}", 0.14, base + Vector(((-1) ** leaf * 0.16, 0.04, 0.72 + leaf * 0.72)), moss, subdivisions=2, scale=(1.65, 0.55, 0.25))
    for index in range(12):
        angle = index * 2 * pi / 12
        stem = (cos(angle) * 3.2, sin(angle) * 3.2, 0.25)
        rod(f"WildflowerStem_{index+1}", stem, (stem[0], stem[1], 0.72), 0.018, moss)
        sphere(f"WildflowerBloom_{index+1}", 0.12, (stem[0], stem[1], 0.76), flower, scale=(1.0, 1.0, 0.55), segments=32, rings=16)
    add_root_and_export("fantasy_ruin_courtyard", (11.4, 11.4, 6.0), "courtyard,rubble,columns,arches,fountain,runes,vines,wildflowers")
    render_thumbnail("fantasy_ruin_courtyard", (15.2, -17.0, 11.8), (0.0, 0.0, 2.0), world=(0.035, 0.050, 0.040, 1.0), energy=1700)


def build_scifi_command_corridor(): # NOSONAR python:S3776
    clear_scene()
    hull = material("Scifi_Hull", (0.11, 0.14, 0.18), metallic=0.78, roughness=0.30)
    panel = material("Scifi_Panel", (0.23, 0.28, 0.33), metallic=0.64, roughness=0.38)
    dark = material("Scifi_DarkFrame", (0.025, 0.035, 0.050), metallic=0.90, roughness=0.20)
    floor = material("Scifi_Deck", (0.055, 0.065, 0.080), metallic=0.72, roughness=0.42)
    cyan = material("Scifi_CyanLight", (0.0, 0.45, 0.78), metallic=0.12, roughness=0.12, emission=(0.0, 0.65, 1.0), emission_strength=5.6)
    orange = material("Scifi_OrangeLight", (0.85, 0.16, 0.02), metallic=0.18, roughness=0.16, emission=(1.0, 0.10, 0.01), emission_strength=5.2)
    white = material("Scifi_WhiteLight", (0.70, 0.86, 1.0), roughness=0.10, emission=(0.62, 0.82, 1.0), emission_strength=3.4)
    glass = material("Scifi_DisplayGlass", (0.04, 0.22, 0.38), metallic=0.18, roughness=0.08, alpha=0.62, transmission=0.18)
    seat = material("Scifi_CommandSeat", (0.16, 0.025, 0.035), roughness=0.66)
    rubber = material("Scifi_Rubber", (0.015, 0.018, 0.024), roughness=0.72)
    gold = material("Scifi_GoldTrace", (0.60, 0.32, 0.06), metallic=0.92, roughness=0.22)
    # Full corridor shell with an open camera end and command bay at the far end.
    box("Scifi_Deck", (7.0, 16.0, 0.18), (0, 0, 0.09), floor, edge=0.015)
    box("Scifi_LeftHull", (0.22, 16.0, 4.5), (-3.39, 0, 2.25), hull, edge=0.025)
    box("Scifi_RightHull", (0.22, 16.0, 4.5), (3.39, 0, 2.25), hull, edge=0.025)
    box("Scifi_Ceiling", (7.0, 16.0, 0.18), (0, 0, 4.41), hull, edge=0.018)
    box("Scifi_CommandBulkhead", (7.0, 0.22, 4.5), (0, 7.89, 2.25), hull, edge=0.02)
    # Repeating structural ribs and floor traces.
    for rib_index, y in enumerate((-6.8, -4.5, -2.2, 0.1, 2.4, 4.7, 7.0), 1):
        box(f"Rib_{rib_index}_Left", (0.38, 0.22, 4.2), (-3.12, y, 2.18), dark, edge=0.045)
        box(f"Rib_{rib_index}_Right", (0.38, 0.22, 4.2), (3.12, y, 2.18), dark, edge=0.045)
        box(f"Rib_{rib_index}_Ceiling", (6.6, 0.22, 0.34), (0, y, 4.16), dark, edge=0.05)
        for side in (-1, 1):
            box(f"Rib_{rib_index}_Light_{'L' if side < 0 else 'R'}", (0.12, 0.28, 1.25), (side * 2.91, y - 0.02, 2.55), cyan if rib_index % 2 else orange, edge=0.04)
        box(f"CeilingLight_{rib_index}", (2.1, 0.42, 0.06), (0, y, 4.28), white, edge=0.03)
    for trace_index, x in enumerate((-2.2, -1.1, 1.1, 2.2), 1):
        box(f"DeckTrace_{trace_index}", (0.06, 14.8, 0.025), (x, 0, 0.20), cyan if trace_index in (1, 4) else gold, edge=0.006)
    # Wall service panels, vents, conduits.
    for side, x in (("Left", -3.22), ("Right", 3.22)):
        face_x = x + (0.13 if x < 0 else -0.13)
        for bay, y in enumerate((-5.65, -3.35, -1.05, 1.25, 3.55, 5.85), 1):
            box(f"{side}_ServicePanel_{bay}", (0.10, 1.62, 1.65), (face_x, y, 1.52), panel, edge=0.05)
            box(f"{side}_Display_{bay}", (0.035, 0.82, 0.46), (face_x + (0.07 if x < 0 else -0.07), y, 1.77), glass, edge=0.035)
            for bar in range(4):
                box(f"{side}_Vent_{bay}_{bar+1}", (0.05, 0.56, 0.055), (face_x + (0.065 if x < 0 else -0.065), y, 1.10 + bar * 0.13), rubber, edge=0.01)
        for conduit_index, z in enumerate((0.55, 3.62), 1):
            tube_path(f"{side}_Conduit_{conduit_index}", [(face_x, -7.4, z), (face_x, -2.0, z + 0.12), (face_x, 2.0, z - 0.08), (face_x, 7.2, z)], 0.065, gold if conduit_index == 1 else dark)
    # Command bay consoles and twelve high-detail seats.
    box("Command_Dais", (6.1, 3.0, 0.28), (0, 6.0, 0.30), panel, edge=0.06)
    for console_index, x in enumerate((-2.35, -1.18, 0.0, 1.18, 2.35), 1):
        box(f"Console_{console_index}_Body", (0.95, 0.78, 0.82), (x, 6.65, 0.83), dark, edge=0.07, rotation=(0.22, 0, 0))
        box(f"Console_{console_index}_Screen", (0.76, 0.06, 0.46), (x, 6.21, 1.20), glass, edge=0.04, rotation=(0.22, 0, 0))
        for key in range(5):
            box(f"Console_{console_index}_Key_{key+1}", (0.10, 0.06, 0.035), (x - 0.28 + key * 0.14, 6.16, 0.96), cyan if key % 2 else orange, edge=0.01)
    seat_positions = ((-2.5, 5.1), (-1.25, 5.1), (0, 5.1), (1.25, 5.1), (2.5, 5.1), (-2.5, 3.4), (-1.25, 3.4), (0, 3.4), (1.25, 3.4), (2.5, 3.4), (-1.6, 1.7), (1.6, 1.7))
    for index, (x, y) in enumerate(seat_positions, 1):
        sphere(f"CommandSeat_{index}_Cushion", 0.40, (x, y, 0.72), seat, scale=(0.78, 0.75, 0.22))
        sphere(f"CommandSeat_{index}_Back", 0.44, (x, y + 0.30, 1.18), seat, scale=(0.76, 0.18, 1.02))
        cylinder(f"CommandSeat_{index}_Post", 0.055, 0.58, (x, y, 0.37), dark)
        cylinder(f"CommandSeat_{index}_Base", 0.34, 0.06, (x, y, 0.03), dark, vertices=40)
        for arm in (-1, 1):
            rod(f"CommandSeat_{index}_Arm_{'L' if arm < 0 else 'R'}", (x + arm * 0.28, y, 0.72), (x + arm * 0.32, y + 0.05, 1.02), 0.025, gold)
    # Panoramic command viewport and central hologram.
    box("Command_Viewport", (5.6, 0.06, 2.25), (0, 7.72, 2.75), glass, edge=0.10)
    for x in (-2.88, -1.45, 0, 1.45, 2.88):
        box(f"Viewport_Mullion_{x:+.2f}", (0.10, 0.14, 2.5), (x, 7.66, 2.75), dark, edge=0.025)
    cylinder("Hologram_Pedestal", 0.62, 0.72, (0, 4.72, 0.58), dark, vertices=48)
    torus("Hologram_BaseRing", 0.58, 0.065, (0, 4.72, 0.98), cyan, major_segments=64, minor_segments=12)
    sphere("Hologram_Core", 0.55, (0, 4.72, 1.82), cyan, scale=(1.0, 1.0, 1.0), segments=48, rings=24)
    for ring_index, rotation in enumerate(((0, 0, 0), (pi / 2, 0, 0), (0, pi / 2, 0)), 1):
        torus(f"Hologram_Orbit_{ring_index}", 0.82, 0.022, (0, 4.72, 1.82), orange if ring_index == 2 else cyan, rotation=rotation, major_segments=64, minor_segments=8)
    add_root_and_export("scifi_command_corridor", (7.0, 16.0, 4.5), "deck,hull,ribs,service-panels,command-bay,seating,viewport,hologram")
    # Frame the open corridor mouth rather than the sealed outer hull so the command bay remains
    # visible and the thumbnail communicates the asset's usable camera path.
    render_thumbnail("scifi_command_corridor", (0.0, -20.5, 4.9), (0.0, 2.8, 2.0), world=(0.005, 0.010, 0.025, 1.0), energy=850)


BUILDERS = {
    "compact_apartment_interior": build_compact_apartment_interior,
    "stylized_cafe_interior": build_stylized_cafe_interior,
    "urban_neon_alley": build_urban_neon_alley,
    "classroom_art_studio": build_classroom_art_studio,
    "fantasy_ruin_courtyard": build_fantasy_ruin_courtyard,
    "scifi_command_corridor": build_scifi_command_corridor,
}


def main():
    OUTPUT_DIRECTORY.mkdir(parents=True, exist_ok=True)
    THUMBNAIL_DIRECTORY.mkdir(parents=True, exist_ok=True)
    selected = set(ARGS.only or ASSETS)
    for asset_id in ASSETS:
        if asset_id in selected:
            BUILDERS[asset_id]()
    print(f"Generated {len(selected)} ToonSpectrum environment assets in {OUTPUT_DIRECTORY}")


if __name__ == "__main__":
    main()
