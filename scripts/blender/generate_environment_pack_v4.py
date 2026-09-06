"""Generate ToonSpectrum's three CC0 Studio BG3D Wave 4 environments.

The generator targets Blender 5.2, is deterministic and texture-free, and is
safe to run in a background process or an already-open Blender session.  It
never loads factory settings: ``clear_scene`` only removes scene-owned objects
and unused data blocks before each asset is authored.  Exported GLBs are
self-contained, PBR, authored in metres, grounded at glTF Y=0, and carry CC0
provenance on their root nodes.

Example:
  /Applications/Blender.app/Contents/MacOS/Blender --background \
    --python scripts/blender/generate_environment_pack_v4.py -- \
    --output-dir apps/web/public/assets/3d/environments
"""

from __future__ import annotations

import argparse
from math import cos, pi, sin
from pathlib import Path
import sys

import bpy
from mathutils import Vector


GENERATOR = "scripts/blender/generate_environment_pack_v4.py"
GENERATOR_VERSION = "4.0.0-blender-5.2"
CC0_LICENSE_URL = "https://creativecommons.org/publicdomain/zero/1.0/"
ASSETS = (
    "hospital_emergency_nurse_station",
    "korean_school_rooftop",
    "hanok_market_courtyard",
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
    """Remove only scene data; never mutate user preferences or factory state."""
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


def cone(name, radius1, radius2, depth, location, mat, *, vertices=32, edge=0.008):
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


def sphere(name, radius, location, mat, *, scale=(1.0, 1.0, 1.0), segments=32, rings=16):
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
    major_segments=40,
    minor_segments=10,
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


def rod(name, start, end, radius, mat, *, vertices=20, edge=0.004):
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


def text_mesh(name, body, location, size, depth, mat, *, rotation=(pi / 2, 0, 0)):
    bpy.ops.object.text_add(location=location, rotation=rotation)
    obj = bpy.context.active_object
    obj.name = name
    obj.data.body = body
    obj.data.align_x = "CENTER"
    obj.data.align_y = "CENTER"
    obj.data.size = size
    obj.data.extrude = depth
    obj.data.bevel_depth = depth * 0.2
    obj.data.bevel_resolution = 2
    assign(obj, mat)
    bpy.ops.object.convert(target="MESH")
    obj.data.name = f"{name}_Mesh"
    return obj


def rolling_bed(prefix, origin, mattress_mat, frame_mat, blanket_mat):
    x, y, z = origin
    box(f"{prefix}_Frame", (2.18, 0.90, 0.13), (x, y, z + 0.61), frame_mat, edge=0.04)
    box(f"{prefix}_Mattress", (2.02, 0.82, 0.22), (x, y, z + 0.78), mattress_mat, edge=0.10)
    box(f"{prefix}_Blanket", (1.12, 0.84, 0.075), (x + 0.35, y, z + 0.94), blanket_mat, edge=0.035)
    sphere(f"{prefix}_Pillow", 0.32, (x - 0.68, y, z + 0.99), mattress_mat, scale=(1.25, 0.82, 0.24))
    for end, ex in (("Head", x - 1.03), ("Foot", x + 1.03)):
        box(f"{prefix}_{end}Rail", (0.07, 0.91, 0.68), (ex, y, z + 0.92), frame_mat, edge=0.025)
    for wheel_index, (wx, wy) in enumerate(((-0.83, -0.34), (-0.83, 0.34), (0.83, -0.34), (0.83, 0.34)), 1):
        rod(f"{prefix}_Leg_{wheel_index}", (x + wx, y + wy, z + 0.17), (x + wx, y + wy, z + 0.58), 0.025, frame_mat)
        torus(
            f"{prefix}_Caster_{wheel_index}",
            0.115,
            0.027,
            (x + wx, y + wy, z + 0.12),
            frame_mat,
            rotation=(pi / 2, 0, 0),
            major_segments=32,
            minor_segments=10,
        )


def add_root_and_export(asset_id, dimensions, semantic_parts):
    root = bpy.data.objects.new(f"TS_ENV_{asset_id}_Root", None)
    root.empty_display_type = "CUBE"
    root["asset_id"] = f"ts-bg3d-{asset_id}-v1"
    root["asset_type"] = "studio-bg3d-environment"
    root["asset_author"] = "ToonSpectrum"
    root["asset_generator"] = GENERATOR
    root["asset_generator_version"] = GENERATOR_VERSION
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


def render_thumbnail(
    asset_id,
    camera_location,
    camera_target,
    *,
    world=(0.04, 0.05, 0.07, 1.0),
    energy=1500,
    sun_energy=1.25,
):
    if ARGS.skip_thumbnails:
        return
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 640
    scene.render.resolution_y = 400
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    scene.render.film_transparent = False
    scene.render.filepath = str(THUMBNAIL_DIRECTORY / f"{asset_id}.png")
    scene.world.color = world[:3]
    scene.world.use_nodes = True
    background = scene.world.node_tree.nodes.get("Background")
    background.inputs["Color"].default_value = world
    background.inputs["Strength"].default_value = 0.42

    bpy.ops.object.camera_add(location=camera_location)
    camera = bpy.context.active_object
    camera.name = f"PreviewCamera_{asset_id}"
    camera.data.lens = 46
    camera.data.sensor_width = 36
    camera.rotation_euler = (Vector(camera_target) - camera.location).to_track_quat("-Z", "Y").to_euler()
    scene.camera = camera

    bpy.ops.object.light_add(type="AREA", location=(camera_location[0] * 0.42, camera_location[1] * 0.35, max(5.2, camera_location[2] + 1.5)))
    key = bpy.context.active_object
    key.name = "Preview_Key_Area"
    key.data.energy = energy
    key.data.shape = "DISK"
    key.data.size = 7.5
    key.rotation_euler = (Vector(camera_target) - key.location).to_track_quat("-Z", "Y").to_euler()
    bpy.ops.object.light_add(type="AREA", location=(-5.0, -2.0, 4.0))
    fill = bpy.context.active_object
    fill.name = "Preview_Fill_Area"
    fill.data.energy = energy * 0.48
    fill.data.color = (0.38, 0.58, 1.0)
    fill.data.size = 6.0
    fill.rotation_euler = (Vector(camera_target) - fill.location).to_track_quat("-Z", "Y").to_euler()
    bpy.ops.object.light_add(type="SUN", location=(0, 0, 8))
    sun = bpy.context.active_object
    sun.name = "Preview_Rim_Sun"
    sun.data.energy = sun_energy
    sun.rotation_euler = (0.5, -0.6, -0.35)
    bpy.ops.render.render(write_still=True)
    print(f"Rendered {asset_id}: {scene.render.filepath}")


def build_hospital_emergency_nurse_station(): # NOSONAR python:S3776
    clear_scene()
    floor = material("Hospital_SeamlessFloor", (0.46, 0.58, 0.60), roughness=0.42)
    wall = material("Hospital_WarmWall", (0.86, 0.88, 0.84), roughness=0.82)
    teal = material("Hospital_TealPanel", (0.02, 0.38, 0.42), roughness=0.55)
    blue = material("Hospital_PrivacyBlue", (0.10, 0.36, 0.68), roughness=0.72)
    steel = material("Hospital_BrushedSteel", (0.35, 0.39, 0.42), metallic=0.82, roughness=0.26)
    white = material("Hospital_CleanWhite", (0.92, 0.94, 0.92), roughness=0.34)
    dark = material("Hospital_DisplayFrame", (0.025, 0.035, 0.045), metallic=0.52, roughness=0.28)
    cyan = material("Hospital_ScreenCyan", (0.01, 0.46, 0.62), emission=(0.0, 0.72, 1.0), emission_strength=3.8, roughness=0.12)
    green = material("Hospital_VitalGreen", (0.04, 0.68, 0.20), emission=(0.02, 1.0, 0.16), emission_strength=3.2, roughness=0.12)
    red = material("Hospital_EmergencyRed", (0.72, 0.035, 0.025), roughness=0.48)
    glass = material("Hospital_Glass", (0.34, 0.62, 0.72), roughness=0.08, alpha=0.42, transmission=0.36)
    rubber = material("Hospital_Rubber", (0.025, 0.035, 0.04), roughness=0.76)
    amber = material("Hospital_WarmLight", (0.95, 0.53, 0.12), emission=(1.0, 0.38, 0.04), emission_strength=3.0)

    box("Hospital_Floor", (12.0, 9.0, 0.14), (0, 0, 0.07), floor, edge=0.012)
    box("Hospital_BackWall", (12.0, 0.16, 4.2), (0, 4.42, 2.1), wall, edge=0.012)
    box("Hospital_LeftWall", (0.16, 9.0, 4.2), (-5.92, 0, 2.1), wall, edge=0.012)
    box("Hospital_RightWall", (0.16, 9.0, 4.2), (5.92, 0, 2.1), wall, edge=0.012)
    for strip_index, x in enumerate((-4.2, -1.4, 1.4, 4.2), 1):
        box(f"Hospital_CeilingLight_{strip_index}", (1.65, 0.64, 0.07), (x, 1.3, 4.02), amber, edge=0.025)
    # Central U-shaped nurse station with six work positions.
    box("NurseStation_Front", (5.8, 0.92, 1.12), (0, 1.30, 0.63), teal, edge=0.10)
    box("NurseStation_LeftWing", (0.92, 2.65, 1.12), (-2.45, 2.14, 0.63), teal, edge=0.10)
    box("NurseStation_RightWing", (0.92, 2.65, 1.12), (2.45, 2.14, 0.63), teal, edge=0.10)
    box("NurseStation_WorktopFront", (6.0, 1.08, 0.12), (0, 1.28, 1.20), white, edge=0.035)
    for side, x in (("Left", -2.45), ("Right", 2.45)):
        box(f"NurseStation_Worktop{side}", (1.08, 2.78, 0.12), (x, 2.12, 1.20), white, edge=0.035)
    for monitor_index, (x, y, yaw) in enumerate(((-1.9, 1.02, 0), (-0.65, 1.02, 0), (0.65, 1.02, 0), (1.9, 1.02, 0), (-2.52, 2.14, pi / 2), (2.52, 2.14, -pi / 2)), 1):
        box(f"NurseMonitor_{monitor_index}_Frame", (0.72, 0.08, 0.48), (x, y, 1.65), dark, edge=0.035, rotation=(0, 0, yaw))
        box(f"NurseMonitor_{monitor_index}_Screen", (0.62, 0.035, 0.38), (x, y - 0.045 * cos(yaw), 1.65), cyan if monitor_index % 2 else green, edge=0.018, rotation=(0, 0, yaw))
        cylinder(f"NurseMonitor_{monitor_index}_Stand", 0.035, 0.35, (x, y, 1.39), steel, vertices=20)
    for stool_index, (x, y) in enumerate(((-1.75, 2.05), (-0.58, 2.05), (0.58, 2.05), (1.75, 2.05)), 1):
        sphere(f"NurseStool_{stool_index}_Seat", 0.30, (x, y, 0.62), blue, scale=(1.0, 1.0, 0.24))
        cylinder(f"NurseStool_{stool_index}_Post", 0.045, 0.52, (x, y, 0.33), steel)
        torus(f"NurseStool_{stool_index}_Foot", 0.28, 0.025, (x, y, 0.23), steel, major_segments=32, minor_segments=8)

    # Three fully equipped emergency bays along the back wall.
    for bay_index, bay_x in enumerate((-4.05, 0.0, 4.05), 1):
        rolling_bed(f"EmergencyBed_{bay_index}", (bay_x, -1.05, 0), white, steel, blue if bay_index != 2 else teal)
        box(f"EmergencyBay_{bay_index}_HeadPanel", (2.65, 0.10, 0.82), (bay_x, 4.24, 2.0), teal, edge=0.05)
        for outlet_index, outlet_x in enumerate((-0.65, -0.25, 0.25, 0.65), 1):
            box(f"EmergencyBay_{bay_index}_Outlet_{outlet_index}", (0.18, 0.045, 0.14), (bay_x + outlet_x, 4.16, 2.0), white, edge=0.02)
        # Vital monitor and articulated support.
        box(f"VitalMonitor_{bay_index}_Frame", (0.74, 0.18, 0.58), (bay_x + 1.18, 3.62, 2.05), dark, edge=0.06)
        box(f"VitalMonitor_{bay_index}_Screen", (0.62, 0.055, 0.44), (bay_x + 1.18, 3.51, 2.05), green, edge=0.025)
        rod(f"VitalMonitor_{bay_index}_Arm", (bay_x + 1.18, 3.78, 1.22), (bay_x + 1.18, 3.70, 1.77), 0.035, steel)
        cylinder(f"VitalMonitor_{bay_index}_Base", 0.30, 0.06, (bay_x + 1.18, 3.78, 0.03), steel, vertices=36)
        rod(f"VitalMonitor_{bay_index}_Pole", (bay_x + 1.18, 3.78, 0.06), (bay_x + 1.18, 3.78, 1.32), 0.032, steel)
        # IV stand with bag and hooks.
        cylinder(f"IVStand_{bay_index}_Base", 0.27, 0.055, (bay_x - 1.18, -0.65, 0.028), steel, vertices=36)
        rod(f"IVStand_{bay_index}_Pole", (bay_x - 1.18, -0.65, 0.06), (bay_x - 1.18, -0.65, 2.15), 0.025, steel)
        rod(f"IVStand_{bay_index}_Hook", (bay_x - 1.18, -0.65, 2.12), (bay_x - 0.93, -0.65, 2.12), 0.018, steel)
        box(f"IVStand_{bay_index}_Bag", (0.28, 0.10, 0.42), (bay_x - 0.91, -0.65, 1.86), glass, edge=0.05)
        tube_path(f"IVStand_{bay_index}_Tube", [(bay_x - 0.91, -0.65, 1.66), (bay_x - 0.82, -0.72, 1.26), (bay_x - 0.58, -0.90, 0.92)], 0.012, glass)
        # Ceiling curtain rail and pleated privacy curtain.
        rod(f"PrivacyRail_{bay_index}", (bay_x - 1.75, -1.95, 3.15), (bay_x + 1.75, -1.95, 3.15), 0.035, steel)
        for panel_index in range(6):
            px = bay_x - 1.48 + panel_index * 0.59
            box(f"PrivacyCurtain_{bay_index}_{panel_index+1}", (0.48, 0.055, 2.12), (px, -1.92, 2.03), blue, edge=0.025, rotation=(0, 0, 0.035 if panel_index % 2 else -0.035))
            torus(f"PrivacyRing_{bay_index}_{panel_index+1}", 0.075, 0.016, (px, -1.92, 3.08), steel, rotation=(pi / 2, 0, 0), major_segments=24, minor_segments=8)

    # Crash cart, supply wall, medication glass cabinet and signage.
    box("CrashCart_Body", (0.92, 0.62, 1.08), (-5.05, 2.82, 0.62), red, edge=0.08)
    for drawer_index in range(4):
        box(f"CrashCart_Drawer_{drawer_index+1}", (0.76, 0.035, 0.18), (-5.05, 2.49, 0.35 + drawer_index * 0.22), white, edge=0.018)
    for wheel_index, (wx, wy) in enumerate(((-0.34, -0.22), (-0.34, 0.22), (0.34, -0.22), (0.34, 0.22)), 1):
        torus(f"CrashCart_Wheel_{wheel_index}", 0.09, 0.025, (-5.05 + wx, 2.82 + wy, 0.10), rubber, rotation=(pi / 2, 0, 0), major_segments=28, minor_segments=8)
    box("MedicationCabinet_Frame", (2.15, 0.34, 1.86), (4.60, 4.04, 2.42), steel, edge=0.05)
    box("MedicationCabinet_Glass", (1.92, 0.055, 1.62), (4.60, 3.84, 2.42), glass, edge=0.04)
    for shelf_index in range(4):
        box(f"MedicationCabinet_Shelf_{shelf_index+1}", (1.86, 0.28, 0.035), (4.60, 4.01, 1.78 + shelf_index * 0.43), white, edge=0.01)
    box("EmergencyExit_Door", (1.32, 0.10, 2.46), (-4.85, 4.30, 1.26), teal, edge=0.035)
    text_mesh("Emergency_Sign", "EMERGENCY", (-3.05, 4.27, 3.25), 0.34, 0.018, red, rotation=(pi / 2, 0, 0))

    add_root_and_export(
        "hospital_emergency_nurse_station",
        (12.0, 9.0, 4.2),
        "shell,nurse-station,emergency-bays,beds,vital-monitors,iv-stands,privacy-curtains,medication,crash-cart",
    )
    render_thumbnail(
        "hospital_emergency_nurse_station",
        (14.2, -14.5, 9.4),
        (0.0, 1.0, 1.35),
        world=(0.045, 0.065, 0.075, 1.0),
        energy=1900,
    )


def build_korean_school_rooftop(): # NOSONAR python:S3776
    clear_scene()
    deck = material("SchoolRoof_BlueDeck", (0.06, 0.22, 0.35), roughness=0.68)
    concrete = material("SchoolRoof_Concrete", (0.48, 0.51, 0.50), roughness=0.88)
    brick = material("SchoolRoof_Brick", (0.48, 0.12, 0.07), roughness=0.82)
    steel = material("SchoolRoof_GalvanizedSteel", (0.28, 0.33, 0.36), metallic=0.78, roughness=0.34)
    dark = material("SchoolRoof_DarkMetal", (0.035, 0.045, 0.055), metallic=0.74, roughness=0.40)
    safety = material("SchoolRoof_SafetyYellow", (0.93, 0.52, 0.03), roughness=0.50)
    white = material("SchoolRoof_LineWhite", (0.90, 0.91, 0.86), roughness=0.62)
    green = material("SchoolRoof_PlantGreen", (0.06, 0.36, 0.12), roughness=0.76)
    wood = material("SchoolRoof_BenchWood", (0.40, 0.18, 0.055), roughness=0.67)
    terracotta = material("SchoolRoof_Planter", (0.62, 0.18, 0.07), roughness=0.82)
    glass = material("SchoolRoof_WindowGlass", (0.12, 0.34, 0.48), roughness=0.10, alpha=0.48, transmission=0.28)
    red = material("SchoolRoof_SignRed", (0.74, 0.035, 0.025), roughness=0.52)

    box("SchoolRooftop_Deck", (15.0, 12.0, 0.18), (0, 0, 0.09), deck, edge=0.015)
    # Parapet and safety fence frame the roof without blocking camera navigation.
    for name, dimensions, location in (
        ("Back", (15.0, 0.28, 1.15), (0, 5.86, 0.66)),
        ("Left", (0.28, 12.0, 1.15), (-7.36, 0, 0.66)),
        ("Right", (0.28, 12.0, 1.15), (7.36, 0, 0.66)),
        ("FrontLeft", (5.6, 0.28, 1.15), (-4.70, -5.86, 0.66)),
        ("FrontRight", (5.6, 0.28, 1.15), (4.70, -5.86, 0.66)),
    ):
        box(f"SchoolRooftop_Parapet{name}", dimensions, location, concrete, edge=0.025)
    fence_segments = (
        ("Back", (-7.0, 5.70, 1.18), (7.0, 5.70, 1.18), "x"),
        ("Left", (-7.20, -5.5, 1.18), (-7.20, 5.5, 1.18), "y"),
        ("Right", (7.20, -5.5, 1.18), (7.20, 5.5, 1.18), "y"),
    )
    for side, start, end, axis in fence_segments:
        rod(f"Fence_{side}_TopRail", (start[0], start[1], 2.72), (end[0], end[1], 2.72), 0.035, steel)
        span = 14 if axis == "x" else 11
        for index in range(span + 1):
            t = index / span
            x = start[0] + (end[0] - start[0]) * t
            y = start[1] + (end[1] - start[1]) * t
            rod(f"Fence_{side}_Post_{index+1}", (x, y, 1.12), (x, y, 2.75), 0.028, steel, vertices=16)
        # Two diagonal wire directions make the fence visibly read as chain-link.
        wire_count = 7 if axis == "x" else 6
        for index in range(wire_count):
            t0 = index / wire_count
            t1 = min(1.0, t0 + 0.28)
            x0 = start[0] + (end[0] - start[0]) * t0
            y0 = start[1] + (end[1] - start[1]) * t0
            x1 = start[0] + (end[0] - start[0]) * t1
            y1 = start[1] + (end[1] - start[1]) * t1
            rod(f"Fence_{side}_WireA_{index+1}", (x0, y0, 1.28), (x1, y1, 2.62), 0.009, steel, vertices=12, edge=0.002)
            rod(f"Fence_{side}_WireB_{index+1}", (x0, y0, 2.62), (x1, y1, 1.28), 0.009, steel, vertices=12, edge=0.002)

    # Brick stairwell, door canopy and recognizable Korean roof signage.
    box("Stairwell_Block", (4.45, 3.35, 3.65), (-4.65, 3.62, 1.92), brick, edge=0.035)
    box("Stairwell_Door", (1.45, 0.12, 2.35), (-4.65, 1.89, 1.28), dark, edge=0.045)
    box("Stairwell_Window", (1.35, 0.08, 0.72), (-2.85, 3.15, 2.22), glass, edge=0.035, rotation=(0, 0, pi / 2))
    box("Stairwell_Canopy", (2.35, 1.05, 0.16), (-4.65, 1.62, 2.65), steel, edge=0.04)
    for support_index, x in enumerate((-5.52, -3.78), 1):
        rod(f"Stairwell_CanopySupport_{support_index}", (x, 1.68, 2.05), (x, 1.68, 2.62), 0.035, steel)
    box("SchoolName_Backboard", (3.35, 0.14, 0.80), (-4.65, 5.58, 3.25), white, edge=0.045)
    text_mesh("SchoolName_Sign", "HANEUL SCHOOL", (-4.65, 5.48, 3.25), 0.28, 0.018, red, rotation=(pi / 2, 0, 0))

    # Twin water tanks with ladders and pipe manifolds.
    for tank_index, tank_x in enumerate((1.65, 4.55), 1):
        cylinder(f"WaterTank_{tank_index}_Body", 1.06, 2.15, (tank_x, 3.95, 1.36), steel, vertices=48, edge=0.025)
        sphere(f"WaterTank_{tank_index}_Top", 1.07, (tank_x, 3.95, 2.42), steel, scale=(1.0, 1.0, 0.26), segments=40, rings=20)
        cylinder(f"WaterTank_{tank_index}_Base", 1.22, 0.16, (tank_x, 3.95, 0.24), dark, vertices=48)
        rod(f"WaterTank_{tank_index}_Pipe", (tank_x, 3.95, 0.30), (tank_x, 2.10, 0.30), 0.09, dark, vertices=24)
        for rung_index in range(7):
            z = 0.52 + rung_index * 0.30
            rod(f"WaterTank_{tank_index}_LadderRung_{rung_index+1}", (tank_x - 0.30, 2.87, z), (tank_x + 0.30, 2.87, z), 0.022, safety, vertices=16)
        rod(f"WaterTank_{tank_index}_LadderLeft", (tank_x - 0.34, 2.87, 0.34), (tank_x - 0.34, 2.87, 2.48), 0.025, safety, vertices=16)
        rod(f"WaterTank_{tank_index}_LadderRight", (tank_x + 0.34, 2.87, 0.34), (tank_x + 0.34, 2.87, 2.48), 0.025, safety, vertices=16)

    # HVAC, solar hot-water array and rotating exhaust details.
    for unit_index, (x, y) in enumerate(((-1.45, -3.85), (1.25, -3.85), (3.95, -3.85)), 1):
        box(f"HVAC_{unit_index}_Body", (1.65, 1.10, 1.18), (x, y, 0.70), concrete, edge=0.08)
        torus(f"HVAC_{unit_index}_FanRim", 0.38, 0.055, (x, y - 0.58, 0.77), dark, rotation=(pi / 2, 0, 0), major_segments=40, minor_segments=10)
        sphere(f"HVAC_{unit_index}_FanHub", 0.13, (x, y - 0.64, 0.77), dark, scale=(1, 0.35, 1))
        for blade_index in range(6):
            angle = blade_index * pi / 3
            box(f"HVAC_{unit_index}_Blade_{blade_index+1}", (0.08, 0.04, 0.34), (x + cos(angle) * 0.17, y - 0.65, 0.77 + sin(angle) * 0.17), steel, edge=0.012, rotation=(0, 0, -angle))
    for panel_index, x in enumerate((-1.8, 0.0, 1.8), 1):
        box(f"SolarPanel_{panel_index}", (1.55, 2.15, 0.10), (x, -0.35, 1.22), glass, edge=0.035, rotation=(0.35, 0, 0))
        rod(f"SolarPanel_{panel_index}_StandLeft", (x - 0.55, -0.72, 0.18), (x - 0.55, -0.35, 1.18), 0.035, dark)
        rod(f"SolarPanel_{panel_index}_StandRight", (x + 0.55, -0.72, 0.18), (x + 0.55, -0.35, 1.18), 0.035, dark)
        for cell_index in range(4):
            box(f"SolarPanel_{panel_index}_Cell_{cell_index+1}", (0.03, 1.92, 0.035), (x - 0.56 + cell_index * 0.37, -0.37, 1.25), white, edge=0.005, rotation=(0.35, 0, 0))

    # Student rest corner, planters and painted activity markings.
    for bench_index, (x, y, yaw) in enumerate(((-4.6, -2.55, 0), (5.3, 0.3, pi / 2)), 1):
        box(f"RoofBench_{bench_index}_Seat", (2.25, 0.52, 0.12), (x, y, 0.62), wood, edge=0.045, rotation=(0, 0, yaw))
        box(f"RoofBench_{bench_index}_Back", (2.25, 0.12, 0.72), (x, y + 0.34 * cos(yaw), 1.02), wood, edge=0.045, rotation=(0, 0, yaw))
        for leg_index, offset in enumerate((-0.78, 0.78), 1):
            dx = offset * cos(yaw)
            dy = offset * sin(yaw)
            rod(f"RoofBench_{bench_index}_Leg_{leg_index}", (x + dx, y + dy, 0.18), (x + dx, y + dy, 0.58), 0.045, dark)
    for planter_index, (x, y) in enumerate(((-6.2, -1.2), (-6.2, 0.4), (6.1, 2.2), (6.1, 3.8)), 1):
        box(f"RoofPlanter_{planter_index}", (1.15, 0.62, 0.54), (x, y, 0.36), terracotta, edge=0.06)
        for plant_index in range(5):
            px = x - 0.40 + plant_index * 0.20
            ico(f"RoofPlanter_{planter_index}_Plant_{plant_index+1}", 0.22, (px, y, 0.78 + (plant_index % 2) * 0.12), green, subdivisions=2, scale=(0.80, 0.65, 1.35))
    box("RoofCourt_CenterLine", (0.07, 5.4, 0.025), (4.6, -1.2, 0.20), white, edge=0.004)
    torus("RoofCourt_Circle", 1.28, 0.035, (4.6, -1.2, 0.20), white, major_segments=64, minor_segments=8)
    box("RoofSafetyZone", (2.10, 0.08, 0.025), (-4.65, 1.72, 0.20), safety, edge=0.004)

    add_root_and_export(
        "korean_school_rooftop",
        (15.0, 12.0, 4.0),
        "roof-deck,parapet,safety-fence,stairwell,water-tanks,hvac,solar-panels,benches,planters,activity-court",
    )
    render_thumbnail(
        "korean_school_rooftop",
        (18.0, -18.5, 12.0),
        (0.0, 0.2, 1.15),
        world=(0.26, 0.42, 0.65, 1.0),
        energy=1550,
        sun_energy=2.1,
    )


def build_hanok_market_courtyard(): # NOSONAR python:S3776
    clear_scene()
    earth = material("Hanok_EarthCourtyard", (0.38, 0.25, 0.13), roughness=0.90)
    stone = material("Hanok_FoundationStone", (0.34, 0.36, 0.34), roughness=0.86)
    plaster = material("Hanok_OchrePlaster", (0.78, 0.66, 0.45), roughness=0.88)
    wood = material("Hanok_WarmTimber", (0.34, 0.095, 0.035), roughness=0.64)
    dark_wood = material("Hanok_DarkTimber", (0.12, 0.035, 0.018), roughness=0.58)
    roof = material("Hanok_CharcoalRoofTile", (0.09, 0.12, 0.13), metallic=0.12, roughness=0.68)
    paper = material("Hanok_HanjiPaper", (0.91, 0.76, 0.48), roughness=0.75, alpha=0.86)
    red = material("Hanok_DancheongRed", (0.62, 0.045, 0.025), roughness=0.58)
    blue = material("Hanok_DancheongBlue", (0.02, 0.24, 0.40), roughness=0.56)
    green = material("Hanok_DancheongGreen", (0.035, 0.33, 0.12), roughness=0.64)
    brass = material("Hanok_Brass", (0.62, 0.31, 0.055), metallic=0.86, roughness=0.24)
    ceramic = material("Hanok_Onggi", (0.30, 0.075, 0.025), roughness=0.58)
    cloth = material("Hanok_MarketCloth", (0.72, 0.16, 0.045), roughness=0.78)
    lantern = material("Hanok_LanternGlow", (0.95, 0.42, 0.08), emission=(1.0, 0.24, 0.025), emission_strength=4.0, roughness=0.28)

    box("HanokMarket_Courtyard", (16.0, 13.0, 0.16), (0, 0, 0.08), earth, edge=0.015)
    # Flagstone walk creates a clear traversable path through the market.
    for stone_index in range(11):
        y = -5.35 + stone_index * 1.02
        x = 0.18 * sin(stone_index * 0.9)
        cylinder(f"Courtyard_SteppingStone_{stone_index+1}", 0.48, 0.07, (x, y, 0.19), stone, vertices=28, scale=(1.35, 0.86, 1.0))

    # Three open-front hanok wings: back, left, and right.
    building_specs = (
        ("Back", (0.0, 5.05), 0.0, 11.8, 3.15),
        ("Left", (-6.45, 0.55), -pi / 2, 8.6, 3.15),
        ("Right", (6.45, 0.55), pi / 2, 8.6, 3.15),
    )
    for building_name, (cx, cy), yaw, span, height in building_specs:
        along_x = abs(cos(yaw)) > 0.5
        foundation_dims = (span, 2.45, 0.34) if along_x else (2.45, span, 0.34)
        wall_dims = (span - 0.3, 0.22, 2.35) if along_x else (0.22, span - 0.3, 2.35)
        # Explicit trigonometry keeps transforms deterministic and readable.
        wx = cx - sin(yaw) * 0.78
        wy = cy + cos(yaw) * 0.78
        box(f"Hanok_{building_name}_Foundation", foundation_dims, (cx, cy, 0.25), stone, edge=0.025)
        box(f"Hanok_{building_name}_PlasterWall", wall_dims, (wx, wy, 1.52), plaster, edge=0.022)
        pillar_count = 7 if span > 10 else 6
        for pillar_index in range(pillar_count):
            offset = -span / 2 + 0.62 + pillar_index * ((span - 1.24) / (pillar_count - 1))
            px = cx + cos(yaw) * offset - sin(yaw) * -0.75
            py = cy + sin(yaw) * offset + cos(yaw) * -0.75
            box(f"Hanok_{building_name}_Pillar_{pillar_index+1}", (0.24, 0.24, 2.75), (px, py, 1.62), wood, edge=0.035, rotation=(0, 0, yaw))
        beam_dims = (span + 0.25, 0.30, 0.30) if along_x else (0.30, span + 0.25, 0.30)
        box(f"Hanok_{building_name}_MainBeam", beam_dims, (cx + sin(yaw) * 0.72, cy - cos(yaw) * 0.72, 2.86), dark_wood, edge=0.035)
        box(f"Hanok_{building_name}_DancheongBeam", beam_dims, (cx + sin(yaw) * 0.72, cy - cos(yaw) * 0.72, 2.56), red if building_name == "Back" else blue, edge=0.025)
        # Lattice doors read as usable rooms rather than a flat facade.
        door_count = 5 if span > 10 else 4
        for door_index in range(door_count):
            offset = -span * 0.34 + door_index * (span * 0.68 / max(1, door_count - 1))
            dx = cx + cos(yaw) * offset - sin(yaw) * 0.69
            dy = cy + sin(yaw) * offset + cos(yaw) * 0.69
            door_dims = (1.45, 0.08, 1.82) if along_x else (0.08, 1.45, 1.82)
            box(f"Hanok_{building_name}_DoorPaper_{door_index+1}", door_dims, (dx, dy, 1.33), paper, edge=0.025)
            for grid_index in range(3):
                grid_offset = -0.48 + grid_index * 0.48
                gx = dx + cos(yaw) * grid_offset
                gy = dy + sin(yaw) * grid_offset
                rod(f"Hanok_{building_name}_DoorV_{door_index+1}_{grid_index+1}", (gx, gy, 0.48), (gx, gy, 2.18), 0.022, dark_wood, vertices=12)
            for grid_index in range(3):
                z = 0.72 + grid_index * 0.50
                start = (dx - cos(yaw) * 0.67, dy - sin(yaw) * 0.67, z)
                end = (dx + cos(yaw) * 0.67, dy + sin(yaw) * 0.67, z)
                rod(f"Hanok_{building_name}_DoorH_{door_index+1}_{grid_index+1}", start, end, 0.022, dark_wood, vertices=12)
        # Layered pitched roof plus rhythmic ceramic tile rolls and end caps.
        roof_center = (cx, cy, 3.34)
        if along_x:
            roof_dims = (span + 1.4, 2.22, 0.20)
            box(
                f"Hanok_{building_name}_RoofFront",
                roof_dims,
                (roof_center[0], roof_center[1] - 0.82, roof_center[2]),
                roof,
                edge=0.035,
                rotation=(-0.30, 0.0, 0.0),
            )
            box(
                f"Hanok_{building_name}_RoofBack",
                roof_dims,
                (roof_center[0], roof_center[1] + 0.82, roof_center[2]),
                roof,
                edge=0.035,
                rotation=(0.30, 0.0, 0.0),
            )
            ridge_rotation = (0.0, pi / 2, 0.0)
            tile_rotation = (pi / 2, 0.0, 0.0)
        else:
            roof_dims = (2.22, span + 1.4, 0.20)
            front_direction = 1.0 if yaw > 0 else -1.0
            box(
                f"Hanok_{building_name}_RoofFront",
                roof_dims,
                (roof_center[0] + front_direction * 0.82, roof_center[1], roof_center[2]),
                roof,
                edge=0.035,
                rotation=(0.0, 0.30 * front_direction, 0.0),
            )
            box(
                f"Hanok_{building_name}_RoofBack",
                roof_dims,
                (roof_center[0] - front_direction * 0.82, roof_center[1], roof_center[2]),
                roof,
                edge=0.035,
                rotation=(0.0, -0.30 * front_direction, 0.0),
            )
            ridge_rotation = (pi / 2, 0.0, 0.0)
            tile_rotation = (0.0, pi / 2, 0.0)
        tile_count = 15 if span > 10 else 12
        for tile_index in range(tile_count):
            offset = -span / 2 + 0.42 + tile_index * ((span - 0.84) / (tile_count - 1))
            tx = cx + cos(yaw) * offset + sin(yaw) * 1.86
            ty = cy + sin(yaw) * offset - cos(yaw) * 1.86
            torus(
                f"Hanok_{building_name}_RoofTileCap_{tile_index+1}",
                0.13,
                0.035,
                (tx, ty, 3.10),
                roof,
                rotation=tile_rotation,
                major_segments=24,
                minor_segments=8,
            )
        cylinder(
            f"Hanok_{building_name}_RoofRidge",
            0.16,
            span + 0.65,
            (cx, cy, 3.72),
            roof,
            vertices=28,
            rotation=ridge_rotation,
        )

    # Market stalls, wares, hanging lanterns, baskets and onggi jars.
    stall_specs = (("Tea", -3.5, -2.7, red), ("Textile", 3.45, -2.45, blue), ("Produce", -3.3, 1.0, green))
    for stall_index, (label, x, y, awning_mat) in enumerate(stall_specs, 1):
        box(f"MarketStall_{label}_Counter", (2.45, 0.88, 0.78), (x, y, 0.52), wood, edge=0.055)
        for post_index, px in enumerate((x - 1.02, x + 1.02), 1):
            rod(f"MarketStall_{label}_Post_{post_index}", (px, y + 0.30, 0.22), (px, y + 0.30, 2.36), 0.055, dark_wood)
        box(f"MarketStall_{label}_Awning", (2.65, 1.32, 0.10), (x, y + 0.12, 2.30), awning_mat, edge=0.035, rotation=(0.10, 0, 0))
        for ware_index in range(7):
            wx = x - 0.82 + (ware_index % 4) * 0.54
            wy = y - 0.18 + (ware_index // 4) * 0.36
            if label == "Tea":
                sphere(f"MarketStall_{label}_Ware_{ware_index+1}", 0.18, (wx, wy, 1.02), ceramic, scale=(1.0, 1.0, 0.78))
            elif label == "Textile":
                cylinder(f"MarketStall_{label}_Ware_{ware_index+1}", 0.16, 0.46, (wx, wy, 1.02), cloth if ware_index % 2 else paper, vertices=28, rotation=(pi / 2, 0, 0))
            else:
                ico(f"MarketStall_{label}_Ware_{ware_index+1}", 0.20, (wx, wy, 1.04), lantern if ware_index % 2 else green, subdivisions=2)
    for lantern_index, (x, y, z) in enumerate(((-5.6, -1.4, 2.55), (5.55, -1.2, 2.55), (-2.0, 4.1, 2.72), (2.0, 4.1, 2.72), (0.0, -4.2, 2.8)), 1):
        rod(f"Lantern_{lantern_index}_Cord", (x, y, z + 0.62), (x, y, z + 0.30), 0.018, dark_wood, vertices=12)
        sphere(f"Lantern_{lantern_index}_Body", 0.34, (x, y, z), lantern, scale=(0.76, 0.76, 1.05), segments=36, rings=18)
        torus(f"Lantern_{lantern_index}_Top", 0.22, 0.035, (x, y, z + 0.32), brass, major_segments=32, minor_segments=8)
        torus(f"Lantern_{lantern_index}_Bottom", 0.22, 0.035, (x, y, z - 0.32), brass, major_segments=32, minor_segments=8)
    for jar_index, (x, y, scale_value) in enumerate(((5.2, 3.4, 1.0), (5.75, 3.3, 0.82), (4.72, 3.55, 0.72), (-5.4, 3.2, 0.90)), 1):
        sphere(f"OnggiJar_{jar_index}", 0.42 * scale_value, (x, y, 0.48 * scale_value), ceramic, scale=(1.0, 1.0, 1.18), segments=36, rings=18)
        torus(f"OnggiJar_{jar_index}_Rim", 0.28 * scale_value, 0.045 * scale_value, (x, y, 0.91 * scale_value), dark_wood, major_segments=32, minor_segments=8)
    text_mesh("Market_HangingSign", "HANOK MARKET", (0.0, 4.10, 3.02), 0.35, 0.022, brass, rotation=(pi / 2, 0, 0))

    add_root_and_export(
        "hanok_market_courtyard",
        (16.0, 13.0, 4.2),
        "courtyard,flagstones,hanok-wings,pillars,dancheong,lattice-doors,tiled-roofs,market-stalls,lanterns,onggi",
    )
    render_thumbnail(
        "hanok_market_courtyard",
        (18.5, -19.0, 11.8),
        (0.0, 0.7, 1.45),
        world=(0.055, 0.035, 0.022, 1.0),
        energy=1800,
        sun_energy=1.6,
    )


BUILDERS = {
    "hospital_emergency_nurse_station": build_hospital_emergency_nurse_station,
    "korean_school_rooftop": build_korean_school_rooftop,
    "hanok_market_courtyard": build_hanok_market_courtyard,
}


def main():
    OUTPUT_DIRECTORY.mkdir(parents=True, exist_ok=True)
    THUMBNAIL_DIRECTORY.mkdir(parents=True, exist_ok=True)
    selected = set(ARGS.only or ASSETS)
    for asset_id in ASSETS:
        if asset_id in selected:
            BUILDERS[asset_id]()
    print(f"Generated {len(selected)} ToonSpectrum Wave 4 environment assets in {OUTPUT_DIRECTORY}")


if __name__ == "__main__":
    main()
