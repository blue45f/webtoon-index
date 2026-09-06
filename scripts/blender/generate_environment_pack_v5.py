"""Generate ToonSpectrum's three CC0 Studio BG3D Wave 5 environments.

The Blender 5.2 generator is deterministic and safe for background use. It
never loads a factory file: ``clear_scene`` removes only scene objects and
unused data blocks before each asset is authored. Every GLB is built in metres,
grounded at glTF Y=0, self-contained, PBR, and includes two tiny 128 px
procedural detail maps embedded in the binary for mobile-safe surface detail.

Example:
  /Applications/Blender.app/Contents/MacOS/Blender --background \
    --python scripts/blender/generate_environment_pack_v5.py -- \
    --output-dir apps/web/public/assets/3d/environments
"""

from __future__ import annotations

import argparse
from math import cos, pi, sin
from pathlib import Path
import sys

import bpy
from mathutils import Vector


GENERATOR = "scripts/blender/generate_environment_pack_v5.py"
GENERATOR_VERSION = "5.0.0-blender-5.2"
CC0_LICENSE_URL = "https://creativecommons.org/publicdomain/zero/1.0/"
TEXTURE_DIMENSION = 128
ASSETS = (
    "korean_convenience_store_night",
    "seoul_subway_platform",
    "fantasy_alchemist_workshop_library",
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
    """Remove scene-owned data without changing preferences or startup state."""
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
        bpy.data.images,
        bpy.data.textures,
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
    mat["toonspectrum_mtoon_compatible"] = True
    return mat


def _pattern_color(pattern, x, y, base, accent):
    if pattern == "tile":
        grout = x % 16 in (0, 1) or y % 16 in (0, 1)
        checker = ((x // 16) + (y // 16)) % 2
        blend = 0.22 if grout else 0.07 * checker
    elif pattern == "platform":
        joint = y % 24 in (0, 1) or x % 32 in (0, 1)
        blend = 0.30 if joint else 0.035 * ((x // 8 + y // 8) % 2)
    else:
        mortar = x % 32 in (0, 1, 2) or y % 20 in (0, 1)
        deterministic = ((x * 17 + y * 31 + (x // 16) * 13) % 37) / 37.0
        blend = 0.34 if mortar else 0.06 + deterministic * 0.12
    return tuple(base[index] * (1.0 - blend) + accent[index] * blend for index in range(3))


def _create_embedded_image(name, pattern, base, accent, *, normal=False): # NOSONAR python:S3776
    image = bpy.data.images.new(
        name=name,
        width=TEXTURE_DIMENSION,
        height=TEXTURE_DIMENSION,
        alpha=False,
        float_buffer=False,
    )
    pixels = []
    for y in range(TEXTURE_DIMENSION):
        for x in range(TEXTURE_DIMENSION):
            if normal:
                boundary = (
                    (pattern == "tile" and (x % 16 in (0, 1) or y % 16 in (0, 1)))
                    or (pattern == "platform" and (x % 32 in (0, 1) or y % 24 in (0, 1)))
                    or (pattern == "stone" and (x % 32 in (0, 1, 2) or y % 20 in (0, 1)))
                )
                nx = 0.5
                if boundary:
                    nx = 0.44 if x % 2 == 0 else 0.56
                ny = 0.5
                if boundary:
                    ny = 0.44 if y % 2 == 0 else 0.56
                rgb = (nx, ny, 0.985)
            else:
                rgb = _pattern_color(pattern, x, y, base, accent)
            pixels.extend((*rgb, 1.0))
    image.pixels.foreach_set(pixels)
    image.file_format = "PNG"
    image.colorspace_settings.name = "Non-Color" if normal else "sRGB"
    image["toonspectrum_generated"] = True
    image["toonspectrum_mobile_safe"] = True
    image.pack()
    return image


def textured_material(name, base, accent, pattern, *, roughness=0.62, metallic=0.0):
    mat = material(name, base, roughness=roughness, metallic=metallic)
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    shader = nodes.get("Principled BSDF")
    color_image = _create_embedded_image(f"{name}_Color128", pattern, base, accent)
    normal_image = _create_embedded_image(
        f"{name}_Normal128",
        pattern,
        (0.5, 0.5, 1.0),
        (0.5, 0.5, 1.0),
        normal=True,
    )
    color_node = nodes.new("ShaderNodeTexImage")
    color_node.name = f"{name}_EmbeddedColor"
    color_node.image = color_image
    normal_texture = nodes.new("ShaderNodeTexImage")
    normal_texture.name = f"{name}_EmbeddedNormal"
    normal_texture.image = normal_image
    normal_node = nodes.new("ShaderNodeNormalMap")
    normal_node.name = f"{name}_NormalMap"
    normal_node.inputs["Strength"].default_value = 0.32
    links.new(color_node.outputs["Color"], shader.inputs["Base Color"])
    links.new(normal_texture.outputs["Color"], normal_node.inputs["Color"])
    links.new(normal_node.outputs["Normal"], shader.inputs["Normal"])
    mat["embedded_texture_count"] = 2
    mat["embedded_texture_dimension"] = TEXTURE_DIMENSION
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
    return apply_bevel(obj, min(edge, min(dimensions) * 0.42), 2)


def cylinder(
    name,
    radius,
    depth,
    location,
    mat,
    *,
    vertices=24,
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


def cone(name, radius1, radius2, depth, location, mat, *, vertices=24, edge=0.008):
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


def sphere(name, radius, location, mat, *, scale=(1.0, 1.0, 1.0), segments=24, rings=12):
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


def ico(name, radius, location, mat, *, subdivisions=2, scale=(1.0, 1.0, 1.0)):
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
    major_segments=32,
    minor_segments=8,
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


def rod(name, start, end, radius, mat, *, vertices=16, edge=0.004):
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


def bottle(name, location, body_mat, cap_mat, *, scale=1.0):
    x, y, z = location
    cylinder(name, 0.095 * scale, 0.34 * scale, (x, y, z + 0.17 * scale), body_mat, vertices=16)
    cylinder(f"{name}_Cap", 0.058 * scale, 0.085 * scale, (x, y, z + 0.382 * scale), cap_mat, vertices=16)


def consolidate_repeated_meshes(asset_id, preserve_names):
    """Batch repeated props by material while retaining authored semantic landmarks.

    The Studio mobile GLB profile admits at most 256 nodes. Dense shelves, paving studs, books,
    bottles and rail fasteners remain full-resolution geometry, but do not need an object node per
    repeated piece at runtime. Major surfaces and one representative of each scene system keep
    their human-readable names for inspection and downstream tooling.
    """
    preserved = set(preserve_names)
    groups = {}
    for obj in tuple(bpy.context.scene.objects):
        if obj.type != "MESH" or obj.name in preserved:
            continue
        material_names = tuple(material.name for material in obj.data.materials)
        groups.setdefault(material_names, []).append(obj)
    for batch_index, (material_names, objects) in enumerate(sorted(groups.items()), 1):
        objects.sort(key=lambda candidate: candidate.name)
        if len(objects) < 2:
            continue
        bpy.ops.object.select_all(action="DESELECT")
        for obj in objects:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = objects[0]
        bpy.ops.object.join()
        merged = bpy.context.active_object
        # ``object.join`` keeps the active object's transform and converts the remaining meshes
        # into that local space.  Baking rotation and scale here is required because Three.js's
        # default Box3 path expands a rotated local AABB, which otherwise inflates floor placement
        # and physics colliders even though the rendered vertices are unchanged.
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
        material_token = material_names[0] if material_names else "Unmaterialed"
        safe_token = "".join(character if character.isalnum() else "_" for character in material_token)
        merged.name = f"{asset_id}_Batch_{batch_index:02d}_{safe_token}"
        merged.data.name = f"{merged.name}_Mesh"


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
    root["embedded_texture_count"] = 2
    root["embedded_texture_max_dimension"] = TEXTURE_DIMENSION
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
    world=(0.035, 0.045, 0.065, 1.0),
    energy=1500,
    sun_energy=1.15,
    key_color=(1.0, 0.82, 0.68),
    fill_color=(0.32, 0.56, 1.0),
    interior_light_height=None,
    lens=46,
    background_strength=0.38,
    fill_ratio=0.52,
    corridor_lights=False,
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
    background.inputs["Strength"].default_value = background_strength

    bpy.ops.object.camera_add(location=camera_location)
    camera = bpy.context.active_object
    camera.name = f"PreviewCamera_{asset_id}"
    camera.data.lens = lens
    camera.data.sensor_width = 36
    camera.rotation_euler = (Vector(camera_target) - camera.location).to_track_quat("-Z", "Y").to_euler()
    scene.camera = camera

    bpy.ops.object.light_add(
        type="AREA",
        location=(
            camera_location[0] * 0.40,
            camera_location[1] * 0.34,
            interior_light_height
            if interior_light_height is not None
            else max(5.5, camera_location[2] + 1.4),
        ),
    )
    key = bpy.context.active_object
    key.name = "Preview_Key_Area"
    key.data.energy = energy
    key.data.color = key_color
    key.data.shape = "DISK"
    key.data.size = 7.8
    key.rotation_euler = (Vector(camera_target) - key.location).to_track_quat("-Z", "Y").to_euler()
    bpy.ops.object.light_add(
        type="AREA",
        location=(-4.2, -3.0, interior_light_height - 0.35 if interior_light_height is not None else 4.5),
    )
    fill = bpy.context.active_object
    fill.name = "Preview_Fill_Area"
    fill.data.energy = energy * fill_ratio
    fill.data.color = fill_color
    fill.data.size = 7.0
    fill.rotation_euler = (Vector(camera_target) - fill.location).to_track_quat("-Z", "Y").to_euler()
    if corridor_lights:
        for corridor_index, corridor_y in enumerate((-5.8, -0.6, 4.6), 1):
            bpy.ops.object.light_add(type="AREA", location=(-0.2, corridor_y, 3.78))
            corridor = bpy.context.active_object
            corridor.name = f"Preview_Corridor_Area_{corridor_index}"
            corridor.data.energy = energy * 0.46
            corridor.data.color = (0.68, 0.88, 1.0)
            corridor.data.shape = "RECTANGLE"
            corridor.data.size = 4.8
            corridor.data.size_y = 2.4
    bpy.ops.object.light_add(type="SUN", location=(0, 0, 8))
    sun = bpy.context.active_object
    sun.name = "Preview_Rim_Sun"
    sun.data.energy = sun_energy
    sun.rotation_euler = (0.48, -0.58, -0.34)
    bpy.ops.render.render(write_still=True)
    print(f"Rendered {asset_id}: {scene.render.filepath}")


def build_korean_convenience_store_night(): # NOSONAR python:S3776
    clear_scene()
    tile = textured_material(
        "ConvenienceStore_TileDetail",
        (0.62, 0.66, 0.68),
        (0.18, 0.24, 0.27),
        "tile",
        roughness=0.36,
    )
    wall = material("ConvenienceStore_WarmWall", (0.90, 0.88, 0.78), roughness=0.78)
    frame = material("ConvenienceStore_CharcoalFrame", (0.025, 0.035, 0.05), metallic=0.62, roughness=0.29)
    shelf = material("ConvenienceStore_ShelfMetal", (0.52, 0.60, 0.62), metallic=0.52, roughness=0.34)
    glass = material("ConvenienceStore_Glass", (0.38, 0.72, 0.86), roughness=0.10, alpha=0.26, transmission=0.30)
    cyan = material("ConvenienceStore_CyanBrand", (0.02, 0.64, 0.72), roughness=0.32, emission=(0.02, 0.72, 0.82), emission_strength=2.2)
    magenta = material("ConvenienceStore_MagentaBrand", (0.84, 0.05, 0.30), roughness=0.34, emission=(0.95, 0.05, 0.32), emission_strength=1.65)
    warm_light = material("ConvenienceStore_WarmLight", (1.0, 0.84, 0.42), roughness=0.22, emission=(1.0, 0.72, 0.30), emission_strength=4.0)
    product_colors = [
        material("Product_Coral", (0.88, 0.18, 0.12), roughness=0.52),
        material("Product_Yellow", (0.95, 0.66, 0.08), roughness=0.50),
        material("Product_Green", (0.12, 0.60, 0.28), roughness=0.56),
        material("Product_Blue", (0.08, 0.30, 0.78), roughness=0.48),
        material("Product_Purple", (0.48, 0.14, 0.70), roughness=0.50),
    ]
    white = material("ConvenienceStore_WhitePlastic", (0.90, 0.93, 0.91), roughness=0.42)
    wood = material("ConvenienceStore_WoodAccent", (0.34, 0.16, 0.07), roughness=0.62)

    box("Store_Floor", (10.0, 8.0, 0.16), (0, 0, 0.08), tile, edge=0.025)
    box("Store_BackWall", (10.0, 0.18, 3.70), (0, 3.91, 1.85), wall, edge=0.02)
    box("Store_LeftWall", (0.18, 8.0, 3.70), (-4.91, 0, 1.85), wall, edge=0.02)
    box("Store_RightWall", (0.18, 8.0, 3.70), (4.91, 0, 1.85), wall, edge=0.02)
    box("Store_CeilingBand", (10.0, 0.65, 0.32), (0, -3.66, 3.54), frame, edge=0.035)
    box("Store_BrandSign", (6.8, 0.18, 0.72), (0, -3.98, 3.40), cyan, edge=0.09)
    text_mesh("Store_BrandLetters", "24 MART", (0, -4.09, 3.42), 0.54, 0.035, warm_light, rotation=(pi / 2, 0, 0))
    for side, x in (("Left", -4.30), ("Right", 4.30)):
        box(f"Front_{side}_Glass", (0.95, 0.06, 2.70), (x, -3.95, 1.50), glass, edge=0.015)
        box(f"Front_{side}_Frame", (0.09, 0.10, 2.95), (x + (0.50 if side == "Left" else -0.50), -3.93, 1.52), frame, edge=0.012)
    box("Front_EntryDoor_Glass", (1.65, 0.06, 2.75), (2.65, -3.95, 1.48), glass, edge=0.015)
    box("Front_EntryDoor_Handle", (0.05, 0.12, 0.72), (2.12, -4.02, 1.48), frame, edge=0.018)
    box("Store_ExteriorCurb", (10.8, 1.10, 0.22), (0, -4.40, 0.11), frame, edge=0.035)

    # Back-wall refrigerator bank with lit shelves and visible stock.
    for fridge_index in range(5):
        x = -3.72 + fridge_index * 1.86
        box(f"Fridge_{fridge_index+1}_Cabinet", (1.72, 0.62, 2.62), (x, 3.55, 1.48), frame, edge=0.055)
        box(f"Fridge_{fridge_index+1}_GlassDoor", (1.47, 0.055, 2.28), (x, 3.20, 1.48), glass, edge=0.018)
        box(f"Fridge_{fridge_index+1}_Handle", (0.045, 0.09, 1.10), (x + 0.58, 3.14, 1.50), shelf, edge=0.014)
        for shelf_index in range(3):
            shelf_z = 0.70 + shelf_index * 0.58
            box(f"Fridge_{fridge_index+1}_Shelf_{shelf_index+1}", (1.48, 0.42, 0.035), (x, 3.39, shelf_z), shelf, edge=0.006)
            for product_index in range(5):
                px = x - 0.54 + product_index * 0.27
                bottle(
                    f"Fridge_{fridge_index+1}_Drink_{shelf_index+1}_{product_index+1}",
                    (px, 3.14, shelf_z + 0.05),
                    product_colors[(fridge_index + shelf_index + product_index) % len(product_colors)],
                    white,
                    scale=0.72,
                )
        box(f"Fridge_{fridge_index+1}_Light", (1.48, 0.05, 0.07), (x, 3.12, 2.52), warm_light, edge=0.015)

    # Three stocked gondola aisles form a readable convenience-store silhouette.
    for aisle_index, y in enumerate((-1.70, 0.05, 1.72), 1):
        box(f"Aisle_{aisle_index}_Base", (5.55, 0.74, 0.20), (-0.40, y, 0.24), frame, edge=0.05)
        for post_x in (-3.00, 2.20):
            box(f"Aisle_{aisle_index}_Post_{post_x:+.1f}", (0.08, 0.66, 1.52), (post_x, y, 0.92), shelf, edge=0.014)
        for shelf_index in range(4):
            shelf_z = 0.38 + shelf_index * 0.37
            box(f"Aisle_{aisle_index}_Shelf_{shelf_index+1}", (5.30, 0.68, 0.055), (-0.40, y, shelf_z), shelf, edge=0.012)
            for side_index, side_y in enumerate((y - 0.23, y + 0.23), 1):
                for product_index in range(11):
                    px = -2.78 + product_index * 0.48
                    color = product_colors[(aisle_index + shelf_index + product_index + side_index) % len(product_colors)]
                    box(
                        f"Aisle_{aisle_index}_Product_{shelf_index+1}_{side_index}_{product_index+1}",
                        (0.31, 0.18, 0.24 + 0.035 * ((product_index + shelf_index) % 3)),
                        (px, side_y, shelf_z + 0.15),
                        color,
                        edge=0.035,
                    )
        box(f"Aisle_{aisle_index}_EndSign", (0.08, 0.92, 0.42), (2.32, y, 1.72), magenta if aisle_index == 2 else cyan, edge=0.025)

    # Checkout, hot-food corner, microwaves and customer stools.
    box("Checkout_Counter", (3.25, 1.02, 0.92), (3.15, -1.30, 0.54), wood, edge=0.11)
    box("Checkout_CounterTop", (3.42, 1.12, 0.10), (3.15, -1.30, 1.03), frame, edge=0.035)
    box("Checkout_POS_Base", (0.62, 0.40, 0.12), (3.68, -1.34, 1.13), frame, edge=0.035)
    box("Checkout_POS_Screen", (0.52, 0.12, 0.46), (3.68, -1.22, 1.38), cyan, edge=0.045, rotation=(0.15, 0, 0))
    box("Checkout_CardTerminal", (0.24, 0.34, 0.11), (2.92, -1.78, 1.13), frame, edge=0.035, rotation=(0.10, 0, 0))
    for bag_index in range(8):
        box(
            f"Checkout_DisplaySnack_{bag_index+1}",
            (0.24, 0.11, 0.34),
            (2.08 + (bag_index % 4) * 0.29, -1.82, 0.40 + (bag_index // 4) * 0.38),
            product_colors[bag_index % len(product_colors)],
            edge=0.035,
        )
    box("HotFood_Counter", (3.20, 0.72, 0.85), (3.15, 1.40, 0.50), white, edge=0.09)
    for appliance_index in range(2):
        x = 2.35 + appliance_index * 1.15
        box(f"Microwave_{appliance_index+1}_Body", (0.92, 0.55, 0.48), (x, 1.40, 1.12), frame, edge=0.07)
        box(f"Microwave_{appliance_index+1}_Window", (0.58, 0.03, 0.27), (x - 0.07, 1.10, 1.13), glass, edge=0.025)
        cylinder(f"Microwave_{appliance_index+1}_Dial", 0.07, 0.035, (x + 0.35, 1.09, 1.16), warm_light, vertices=20, rotation=(pi / 2, 0, 0))
    box("Ramen_WaterStation", (0.72, 0.62, 0.86), (4.35, 1.36, 0.52), shelf, edge=0.08)
    cylinder("Ramen_WaterSpout", 0.05, 0.45, (4.35, 1.02, 1.18), frame, vertices=16, rotation=(pi / 2, 0, 0))
    for stool_index, x in enumerate((-3.90, -2.95, -2.00), 1):
        cylinder(f"WindowStool_{stool_index}_Seat", 0.30, 0.12, (x, -3.10, 0.72), magenta if stool_index == 2 else cyan, vertices=28)
        rod(f"WindowStool_{stool_index}_Stem", (x, -3.10, 0.10), (x, -3.10, 0.66), 0.055, frame)
        torus(f"WindowStool_{stool_index}_FootRing", 0.21, 0.025, (x, -3.10, 0.30), frame)
    box("Window_EatingBar", (3.20, 0.48, 0.10), (-2.95, -3.47, 1.02), wood, edge=0.04)
    for light_index, x in enumerate((-3.6, -1.2, 1.2, 3.6), 1):
        box(f"CeilingLight_{light_index}", (1.55, 0.24, 0.08), (x, 0, 3.48), warm_light, edge=0.035)

    consolidate_repeated_meshes(
        "korean_convenience_store_night",
        (
            "Store_Floor",
            "Store_BrandSign",
            "Fridge_1_Cabinet",
            "Aisle_1_Base",
            "Checkout_Counter",
            "HotFood_Counter",
            "Window_EatingBar",
        ),
    )
    add_root_and_export(
        "korean_convenience_store_night",
        (10.0, 8.9, 3.8),
        "night-store,glass-front,brand-sign,refrigerators,stocked-aisles,checkout,hot-food,window-bar,embedded-tile-detail",
    )
    render_thumbnail(
        "korean_convenience_store_night",
        (8.8, -17.8, 8.4),
        (0.0, -0.15, 1.35),
        world=(0.008, 0.012, 0.032, 1.0),
        energy=1750,
        sun_energy=0.72,
        key_color=(1.0, 0.74, 0.50),
        fill_color=(0.10, 0.42, 1.0),
        lens=43,
    )


def build_seoul_subway_platform(): # NOSONAR python:S3776
    clear_scene()
    platform = textured_material(
        "Subway_PlatformDetail",
        (0.43, 0.47, 0.49),
        (0.12, 0.16, 0.19),
        "platform",
        roughness=0.50,
    )
    wall = material("Subway_WarmTile", (0.74, 0.77, 0.75), roughness=0.76)
    frame = material("Subway_BlackSteel", (0.025, 0.04, 0.055), metallic=0.78, roughness=0.25)
    steel = material("Subway_BrushedSteel", (0.45, 0.53, 0.56), metallic=0.72, roughness=0.30)
    glass = material("Subway_ScreenDoorGlass", (0.24, 0.50, 0.61), roughness=0.12, alpha=0.25, transmission=0.28)
    yellow = material("Subway_TactileYellow", (0.96, 0.58, 0.02), roughness=0.56)
    green = material("Subway_LineGreen", (0.05, 0.62, 0.32), roughness=0.34, emission=(0.02, 0.66, 0.30), emission_strength=1.8)
    light = material("Subway_CeilingLight", (0.84, 0.94, 1.0), roughness=0.22, emission=(0.75, 0.90, 1.0), emission_strength=3.8)
    blue = material("Subway_WayfindingBlue", (0.03, 0.22, 0.52), roughness=0.40)
    red = material("Subway_EmergencyRed", (0.80, 0.04, 0.04), roughness=0.44)

    box("Platform_Slab", (11.0, 20.0, 0.28), (0, 0, 0.14), platform, edge=0.035)
    box("Platform_BackWall", (0.24, 20.0, 4.40), (5.38, 0, 2.20), wall, edge=0.025)
    box("Platform_Ceiling", (11.0, 20.0, 0.22), (0, 0, 4.38), frame, edge=0.03)
    box("Track_Bed", (3.15, 20.0, 0.18), (-6.35, 0, 0.02), frame, edge=0.015)
    for rail_index, x in enumerate((-5.55, -7.15), 1):
        box(f"Track_Rail_{rail_index}", (0.12, 20.0, 0.16), (x, 0, 0.30), steel, edge=0.025)
    for sleeper_index in range(30):
        y = -9.65 + sleeper_index * 0.665
        box(f"Track_Sleeper_{sleeper_index+1}", (2.75, 0.16, 0.12), (-6.35, y, 0.15), wall, edge=0.025)
        for fastener_index, x in enumerate((-5.75, -5.35, -7.35, -6.95), 1):
            cylinder(f"Track_Fastener_{sleeper_index+1}_{fastener_index}", 0.055, 0.07, (x, y, 0.29), red, vertices=12)

    # Platform screen doors with repeated structural bays and signage.
    for bay_index in range(12):
        y = -9.15 + bay_index * 1.66
        box(f"ScreenDoorBay_{bay_index+1}_Base", (0.24, 1.56, 0.18), (-4.72, y, 0.24), frame, edge=0.025)
        for post_index, py in enumerate((y - 0.75, y + 0.75), 1):
            box(f"ScreenDoorBay_{bay_index+1}_Post_{post_index}", (0.16, 0.12, 3.18), (-4.72, py, 1.82), frame, edge=0.018)
        box(f"ScreenDoorBay_{bay_index+1}_Glass", (0.06, 1.32, 2.48), (-4.72, y, 1.56), glass, edge=0.012)
        box(f"ScreenDoorBay_{bay_index+1}_Header", (0.20, 1.52, 0.38), (-4.72, y, 3.26), green if bay_index in (2, 7) else steel, edge=0.025)
        box(f"ScreenDoorBay_{bay_index+1}_SafetyStripe", (0.065, 1.22, 0.08), (-4.675, y, 1.12), yellow, edge=0.012)
        box(f"ScreenDoorBay_{bay_index+1}_Handle", (0.075, 0.08, 0.58), (-4.64, y + 0.22, 1.44), steel, edge=0.018)
    text_mesh("ScreenDoor_LineNumber", "2", (-4.60, -4.98, 3.28), 0.26, 0.025, light, rotation=(pi / 2, 0, pi / 2))
    text_mesh("ScreenDoor_LineNumberFar", "2", (-4.60, 3.32, 3.28), 0.26, 0.025, light, rotation=(pi / 2, 0, pi / 2))

    # Tactile paving with individual raised studs and longitudinal guide bars.
    box("Tactile_Base", (0.72, 20.0, 0.055), (-3.82, 0, 0.33), yellow, edge=0.012)
    for stud_row in range(2):
        for stud_index in range(50):
            y = -9.70 + stud_index * 0.395
            cylinder(
                f"Tactile_Stud_{stud_row+1}_{stud_index+1}",
                0.055,
                0.035,
                (-3.98 + stud_row * 0.32, y, 0.375),
                yellow,
                vertices=12,
            )

    # Pillars, benches, route maps, CCTV, clocks and ceiling services.
    for pillar_index, y in enumerate((-7.6, -3.8, 0.0, 3.8, 7.6), 1):
        cylinder(f"Platform_Pillar_{pillar_index}", 0.34, 4.05, (1.35, y, 2.15), steel, vertices=32, edge=0.02)
        torus(f"Platform_Pillar_{pillar_index}_Foot", 0.36, 0.055, (1.35, y, 0.30), frame)
        box(f"Platform_Pillar_{pillar_index}_LineBand", (0.72, 0.72, 0.34), (1.35, y, 2.62), green, edge=0.035)
    for bench_index, y in enumerate((-5.7, 1.9, 6.6), 1):
        for seat_index in range(4):
            seat_y = y - 0.96 + seat_index * 0.64
            box(f"Bench_{bench_index}_Seat_{seat_index+1}", (0.72, 0.54, 0.12), (3.52, seat_y, 0.72), blue, edge=0.08)
            box(f"Bench_{bench_index}_Back_{seat_index+1}", (0.14, 0.54, 0.72), (3.82, seat_y, 1.02), blue, edge=0.07, rotation=(0, -0.12, 0))
        for leg_y in (y - 0.96, y + 0.96):
            rod(f"Bench_{bench_index}_Leg_{leg_y:+.1f}", (3.52, leg_y, 0.18), (3.52, leg_y, 0.66), 0.055, frame)
    for sign_index, y in enumerate((-6.0, 0.0, 6.0), 1):
        box(f"Wayfinding_{sign_index}_Panel", (2.65, 0.10, 0.72), (3.95, y, 3.34), blue, edge=0.065)
        box(f"Wayfinding_{sign_index}_Line", (2.20, 0.025, 0.09), (3.89, y - 0.065, 3.22), green, edge=0.016)
        text_mesh(f"Wayfinding_{sign_index}_Text", "SEOUL LINE 2", (3.88, y - 0.075, 3.45), 0.20, 0.018, light, rotation=(pi / 2, 0, pi / 2))
    box("DestinationBoard_Main", (4.70, 0.12, 0.82), (0.15, 1.20, 3.48), blue, edge=0.065)
    box("DestinationBoard_LineBand", (4.18, 0.025, 0.10), (0.15, 1.13, 3.28), green, edge=0.016)
    text_mesh(
        "DestinationBoard_Text",
        "2  SEOUL STATION  >",
        (0.15, 1.12, 3.55),
        0.25,
        0.020,
        light,
        rotation=(pi / 2, 0, pi / 2),
    )
    for support_index, support_x in enumerate((-1.65, 1.95), 1):
        rod(
            f"DestinationBoard_Support_{support_index}",
            (support_x, 1.20, 3.86),
            (support_x, 1.20, 4.20),
            0.035,
            steel,
        )
    box("FarConcourse_EndPanel", (4.70, 0.12, 1.45), (2.55, 9.74, 2.10), wall, edge=0.055)
    box("FarConcourse_Lightbox", (3.88, 0.025, 0.78), (2.55, 9.66, 2.26), blue, edge=0.045)
    box("FarConcourse_LineBand", (3.42, 0.018, 0.09), (2.55, 9.63, 2.06), green, edge=0.014)
    for map_index, y in enumerate((-8.0, 4.5), 1):
        box(f"RouteMap_{map_index}_Panel", (0.10, 3.15, 1.15), (5.22, y, 2.02), wall, edge=0.045)
        box(f"RouteMap_{map_index}_Route", (0.025, 2.58, 0.09), (5.14, y, 2.10), green, edge=0.014)
        for station_index in range(9):
            sphere(f"RouteMap_{map_index}_Station_{station_index+1}", 0.075, (5.11, y - 1.12 + station_index * 0.28, 2.10), light, segments=16, rings=8)
    for camera_index, y in enumerate((-7.8, -1.8, 4.2), 1):
        cylinder(f"CCTV_{camera_index}_Body", 0.12, 0.42, (3.90, y, 3.68), frame, vertices=20, rotation=(0, pi / 2, 0))
        sphere(f"CCTV_{camera_index}_Lens", 0.105, (3.68, y, 3.68), glass, scale=(0.35, 1.0, 1.0), segments=20, rings=10)
        rod(f"CCTV_{camera_index}_Arm", (4.02, y, 3.78), (4.45, y, 4.16), 0.035, steel)
    cylinder("Platform_Clock", 0.48, 0.12, (4.60, -3.0, 3.54), wall, vertices=40, rotation=(pi / 2, 0, 0))
    for angle_index in range(12):
        angle = angle_index * pi / 6
        box(
            f"Clock_Tick_{angle_index+1}",
            (0.035, 0.035, 0.12),
            (4.60 + sin(angle) * 0.36, -3.08, 3.54 + cos(angle) * 0.36),
            frame,
            edge=0.008,
            rotation=(0, angle, 0),
        )
    rod("Clock_HourHand", (4.60, -3.09, 3.54), (4.45, -3.09, 3.72), 0.025, frame)
    rod("Clock_MinuteHand", (4.60, -3.10, 3.54), (4.82, -3.10, 3.80), 0.018, red)
    for light_index, y in enumerate((-8.4, -5.6, -2.8, 0, 2.8, 5.6, 8.4), 1):
        box(f"CeilingLight_{light_index}_Left", (2.3, 0.24, 0.075), (-1.8, y, 4.24), light, edge=0.025)
        box(f"CeilingLight_{light_index}_Right", (2.3, 0.24, 0.075), (2.6, y, 4.24), light, edge=0.025)
        box(f"CeilingBeam_{light_index}", (10.1, 0.13, 0.20), (0, y, 4.08), steel, edge=0.025)

    consolidate_repeated_meshes(
        "seoul_subway_platform",
        (
            "Platform_Slab",
            "Track_Bed",
            "ScreenDoorBay_1_Glass",
            "Tactile_Base",
            "Platform_Pillar_1",
            "Bench_1_Seat_1",
            "RouteMap_1_Panel",
            "Wayfinding_1_Panel",
            "DestinationBoard_Main",
            "CCTV_1_Body",
            "Platform_Clock",
        ),
    )
    add_root_and_export(
        "seoul_subway_platform",
        (13.9, 20.0, 4.5),
        "platform,track,rails,screen-doors,tactile-paving,pillars,benches,route-maps,wayfinding,cctv,clock,embedded-platform-detail",
    )
    render_thumbnail(
        "seoul_subway_platform",
        (-2.30, -9.25, 2.25),
        (0.20, 3.00, 1.75),
        world=(0.055, 0.075, 0.105, 1.0),
        energy=2350,
        sun_energy=1.05,
        key_color=(0.72, 0.90, 1.0),
        fill_color=(0.14, 0.70, 0.42),
        interior_light_height=3.75,
        lens=38,
        background_strength=0.72,
        fill_ratio=0.72,
        corridor_lights=True,
    )


def build_fantasy_alchemist_workshop_library(): # NOSONAR python:S3776
    clear_scene()
    stone = textured_material(
        "Alchemist_StoneDetail",
        (0.28, 0.24, 0.30),
        (0.08, 0.09, 0.12),
        "stone",
        roughness=0.82,
    )
    dark_wood = material("Alchemist_DarkWood", (0.19, 0.075, 0.025), roughness=0.62)
    warm_wood = material("Alchemist_WarmWood", (0.42, 0.18, 0.045), roughness=0.57)
    brass = material("Alchemist_AgedBrass", (0.48, 0.24, 0.055), metallic=0.75, roughness=0.32)
    iron = material("Alchemist_BlackIron", (0.035, 0.035, 0.055), metallic=0.68, roughness=0.38)
    glass = material("Alchemist_BottleGlass", (0.18, 0.58, 0.52), roughness=0.12, alpha=0.33, transmission=0.32)
    parchment = material("Alchemist_Parchment", (0.80, 0.64, 0.34), roughness=0.82)
    green_glow = material("Alchemist_EmeraldGlow", (0.05, 0.78, 0.38), roughness=0.20, emission=(0.02, 0.88, 0.34), emission_strength=3.7)
    violet_glow = material("Alchemist_VioletGlow", (0.48, 0.10, 0.92), roughness=0.18, emission=(0.50, 0.08, 1.0), emission_strength=3.2)
    amber_glow = material("Alchemist_AmberGlow", (0.96, 0.42, 0.05), roughness=0.22, emission=(1.0, 0.34, 0.03), emission_strength=3.4)
    book_colors = [
        material("Book_Claret", (0.42, 0.025, 0.05), roughness=0.70),
        material("Book_Indigo", (0.08, 0.08, 0.36), roughness=0.68),
        material("Book_Forest", (0.025, 0.28, 0.12), roughness=0.72),
        material("Book_Ochre", (0.62, 0.32, 0.04), roughness=0.67),
        material("Book_Leather", (0.29, 0.11, 0.035), roughness=0.73),
    ]

    box("Workshop_Floor", (12.0, 10.0, 0.22), (0, 0, 0.11), stone, edge=0.035)
    box("Workshop_BackWall", (12.0, 0.28, 5.70), (0, 4.86, 2.85), stone, edge=0.035)
    box("Workshop_LeftWall", (0.28, 10.0, 5.70), (-5.86, 0, 2.85), stone, edge=0.035)
    box("Workshop_RightButtress", (0.48, 2.3, 5.70), (5.72, 3.65, 2.85), stone, edge=0.055)
    for block_row in range(4):
        for block_index in range(7):
            x = -5.05 + block_index * 1.68 + (0.78 if block_row % 2 else 0)
            if x > 5.25:
                continue
            box(
                f"BackWall_StoneBlock_{block_row+1}_{block_index+1}",
                (1.48, 0.12, 0.72),
                (x, 4.67, 0.62 + block_row * 1.22),
                stone,
                edge=0.055,
            )

    # Tall library walls with dense, individually readable book spines.
    shelf_specs = [
        ("BackLeft", -3.65, 4.30, 3.2, 0.0),
        ("BackRight", 2.25, 4.30, 3.2, 0.0),
        ("LeftFront", -5.35, -1.65, 3.5, pi / 2),
        ("LeftBack", -5.35, 2.10, 3.5, pi / 2),
    ]
    for shelf_name, cx, cy, span, yaw in shelf_specs:
        if yaw == 0:
            box(f"Library_{shelf_name}_Back", (span, 0.20, 4.30), (cx, cy, 2.40), dark_wood, edge=0.055)
            for side_index, x in enumerate((cx - span / 2 + 0.10, cx + span / 2 - 0.10), 1):
                box(f"Library_{shelf_name}_Side_{side_index}", (0.16, 0.58, 4.45), (x, cy - 0.15, 2.40), warm_wood, edge=0.04)
            for level in range(6):
                z = 0.50 + level * 0.68
                box(f"Library_{shelf_name}_Shelf_{level+1}", (span, 0.56, 0.10), (cx, cy - 0.18, z), warm_wood, edge=0.025)
                for book_index in range(10):
                    x = cx - span / 2 + 0.28 + book_index * ((span - 0.56) / 9)
                    height = 0.43 + 0.08 * ((book_index + level) % 3)
                    box(
                        f"Library_{shelf_name}_Book_{level+1}_{book_index+1}",
                        (0.16, 0.34, height),
                        (x, cy - 0.51, z + 0.07 + height / 2),
                        book_colors[(book_index + level) % len(book_colors)],
                        edge=0.025,
                        rotation=(0, 0.05 * ((book_index % 3) - 1), 0),
                    )
        else:
            box(f"Library_{shelf_name}_Back", (0.20, span, 4.30), (cx, cy, 2.40), dark_wood, edge=0.055)
            for side_index, y in enumerate((cy - span / 2 + 0.10, cy + span / 2 - 0.10), 1):
                box(f"Library_{shelf_name}_Side_{side_index}", (0.58, 0.16, 4.45), (cx + 0.15, y, 2.40), warm_wood, edge=0.04)
            for level in range(6):
                z = 0.50 + level * 0.68
                box(f"Library_{shelf_name}_Shelf_{level+1}", (0.56, span, 0.10), (cx + 0.18, cy, z), warm_wood, edge=0.025)
                for book_index in range(10):
                    y = cy - span / 2 + 0.28 + book_index * ((span - 0.56) / 9)
                    height = 0.43 + 0.08 * ((book_index + level) % 3)
                    box(
                        f"Library_{shelf_name}_Book_{level+1}_{book_index+1}",
                        (0.34, 0.16, height),
                        (cx + 0.51, y, z + 0.07 + height / 2),
                        book_colors[(book_index + level) % len(book_colors)],
                        edge=0.025,
                        rotation=(0.04 * ((book_index % 3) - 1), 0, 0),
                    )

    # Central alchemy island, cauldron and articulated distillation glassware.
    cylinder("Alchemy_TableTop", 2.05, 0.20, (0.15, -0.10, 1.02), warm_wood, vertices=48, edge=0.045)
    cylinder("Alchemy_TableBase", 0.72, 0.94, (0.15, -0.10, 0.52), dark_wood, vertices=36, edge=0.055)
    torus("Alchemy_TableBrassInlay", 1.72, 0.055, (0.15, -0.10, 1.135), brass, major_segments=48, minor_segments=10)
    for rune_index in range(12):
        angle = rune_index * pi / 6
        box(
            f"Alchemy_TableRune_{rune_index+1}",
            (0.25, 0.07, 0.025),
            (0.15 + cos(angle) * 1.42, -0.10 + sin(angle) * 1.42, 1.145),
            green_glow if rune_index % 2 else violet_glow,
            edge=0.012,
            rotation=(0, 0, angle),
        )
    sphere("Cauldron_Bowl", 0.82, (0.15, -0.10, 1.58), iron, scale=(1.0, 1.0, 0.72), segments=36, rings=18)
    torus("Cauldron_Rim", 0.71, 0.085, (0.15, -0.10, 1.91), brass, major_segments=48, minor_segments=12)
    cylinder("Cauldron_GlowingLiquid", 0.66, 0.05, (0.15, -0.10, 1.92), green_glow, vertices=48)
    for leg_index in range(3):
        angle = leg_index * 2 * pi / 3
        rod(
            f"Cauldron_Leg_{leg_index+1}",
            (0.15 + cos(angle) * 0.48, -0.10 + sin(angle) * 0.48, 1.25),
            (0.15 + cos(angle) * 0.72, -0.10 + sin(angle) * 0.72, 0.94),
            0.055,
            iron,
        )
    for flask_index, (x, y, glow) in enumerate(((-1.18, -0.92, violet_glow), (1.45, -0.72, amber_glow), (1.12, 0.95, green_glow), (-1.15, 0.78, amber_glow)), 1):
        sphere(f"Retort_{flask_index}_Bulb", 0.34, (x, y, 1.52), glass, scale=(1.0, 1.0, 1.18), segments=28, rings=14)
        cylinder(f"Retort_{flask_index}_Liquid", 0.25, 0.12, (x, y, 1.38), glow, vertices=28)
        cylinder(f"Retort_{flask_index}_Neck", 0.08, 0.58, (x, y, 1.98), glass, vertices=20)
        tube_path(
            f"Retort_{flask_index}_Tube",
            [(x, y, 2.23), (x * 0.75, y * 0.75, 2.58), (0.45 * cos(flask_index), 0.45 * sin(flask_index), 2.42), (0.15, -0.10, 2.15)],
            0.035,
            brass,
        )

    # Side workbench with ingredients, scrolls, scales and bottle racks.
    box("Ingredient_Workbench", (4.40, 1.05, 0.88), (2.90, 2.65, 0.53), dark_wood, edge=0.09)
    box("Ingredient_WorkbenchTop", (4.55, 1.12, 0.12), (2.90, 2.65, 1.02), warm_wood, edge=0.035)
    for rack_level in range(3):
        z = 1.42 + rack_level * 0.52
        box(f"PotionRack_Shelf_{rack_level+1}", (4.05, 0.44, 0.08), (2.90, 3.02, z), dark_wood, edge=0.025)
        for potion_index in range(9):
            x = 1.18 + potion_index * 0.43
            body = glass
            cap = (green_glow, violet_glow, amber_glow)[(rack_level + potion_index) % 3]
            bottle(f"Potion_{rack_level+1}_{potion_index+1}", (x, 2.76, z + 0.06), body, cap, scale=0.72 + 0.08 * ((potion_index + rack_level) % 2))
    for scroll_index in range(5):
        cylinder(
            f"Scroll_{scroll_index+1}",
            0.11,
            0.72,
            (1.55 + scroll_index * 0.55, 2.45, 1.20),
            parchment,
            vertices=24,
            rotation=(0, pi / 2, 0),
        )
    rod("BalanceScale_Stand", (4.22, 2.58, 1.06), (4.22, 2.58, 2.02), 0.045, brass)
    rod("BalanceScale_Beam", (3.65, 2.58, 1.90), (4.79, 2.58, 1.90), 0.035, brass)
    for side_index, x in enumerate((3.70, 4.74), 1):
        rod(f"BalanceScale_Chain_{side_index}", (x, 2.58, 1.90), (x, 2.58, 1.52), 0.015, brass, vertices=12)
        cone(f"BalanceScale_Pan_{side_index}", 0.31, 0.22, 0.10, (x, 2.58, 1.48), brass, vertices=28)

    # Crystals, hanging herbs, ladder and chandelier finish the storytelling silhouette.
    for crystal_index, (x, y, z, glow) in enumerate(((-3.75, -2.80, 0.56, violet_glow), (-3.15, -2.58, 0.43, green_glow), (3.85, -2.65, 0.62, amber_glow), (4.35, -2.25, 0.42, violet_glow), (-1.70, 2.75, 1.25, green_glow)), 1):
        ico(f"CrystalCluster_{crystal_index}_Core", 0.34, (x, y, z), glow, subdivisions=2, scale=(0.62, 0.62, 1.55))
        for shard_index in range(3):
            angle = shard_index * 2.1
            ico(
                f"CrystalCluster_{crystal_index}_Shard_{shard_index+1}",
                0.20,
                (x + cos(angle) * 0.28, y + sin(angle) * 0.28, z - 0.10),
                glow,
                subdivisions=2,
                scale=(0.55, 0.55, 1.35),
            )
    for herb_index, x in enumerate((-4.50, -3.82, -3.14, 3.20, 3.88, 4.56), 1):
        rod(f"HerbBundle_{herb_index}_Cord", (x, 4.20, 4.78), (x, 4.20, 3.92), 0.022, parchment, vertices=12)
        for leaf_index in range(5):
            sphere(
                f"HerbBundle_{herb_index}_Leaf_{leaf_index+1}",
                0.16,
                (x + 0.09 * ((leaf_index % 2) * 2 - 1), 4.15, 3.72 - leaf_index * 0.14),
                book_colors[2],
                scale=(0.45, 1.0, 1.55),
                segments=16,
                rings=8,
            )
    for rung_index in range(10):
        rod(f"LibraryLadder_Rung_{rung_index+1}", (-4.72, 2.30, 0.45 + rung_index * 0.40), (-4.20, 2.30, 0.45 + rung_index * 0.40), 0.035, brass)
    rod("LibraryLadder_LeftRail", (-4.84, 2.30, 0.22), (-4.55, 2.30, 4.40), 0.055, warm_wood)
    rod("LibraryLadder_RightRail", (-4.32, 2.30, 0.22), (-4.03, 2.30, 4.40), 0.055, warm_wood)
    rod("Chandelier_Drop", (0, 0, 5.62), (0, 0, 4.55), 0.055, brass)
    torus("Chandelier_Ring", 1.24, 0.075, (0, 0, 4.28), brass, major_segments=48, minor_segments=10)
    for lamp_index in range(8):
        angle = lamp_index * pi / 4
        x, y = cos(angle) * 1.24, sin(angle) * 1.24
        rod(f"Chandelier_Arm_{lamp_index+1}", (0, 0, 4.55), (x, y, 4.28), 0.035, brass)
        sphere(f"Chandelier_Lamp_{lamp_index+1}", 0.18, (x, y, 4.12), amber_glow, scale=(0.82, 0.82, 1.30), segments=20, rings=10)

    consolidate_repeated_meshes(
        "fantasy_alchemist_workshop_library",
        (
            "Workshop_Floor",
            "Library_BackLeft_Back",
            "Alchemy_TableBase",
            "Cauldron_Bowl",
            "Retort_1_Bulb",
            "PotionRack_Shelf_1",
            "Ingredient_Workbench",
            "CrystalCluster_1_Core",
            "HerbBundle_1_Cord",
            "LibraryLadder_LeftRail",
            "Chandelier_Ring",
        ),
    )
    add_root_and_export(
        "fantasy_alchemist_workshop_library",
        (12.0, 10.0, 5.8),
        "stone-workshop,tall-library,books,alchemy-island,cauldron,retorts,potion-rack,ingredient-bench,crystals,herbs,ladder,chandelier,embedded-stone-detail",
    )
    render_thumbnail(
        "fantasy_alchemist_workshop_library",
        (15.2, -17.0, 10.6),
        (0.0, 0.25, 2.05),
        world=(0.045, 0.025, 0.065, 1.0),
        energy=1900,
        sun_energy=0.82,
        key_color=(1.0, 0.56, 0.28),
        fill_color=(0.38, 0.16, 1.0),
        background_strength=0.58,
        fill_ratio=0.66,
    )


BUILDERS = {
    "korean_convenience_store_night": build_korean_convenience_store_night,
    "seoul_subway_platform": build_seoul_subway_platform,
    "fantasy_alchemist_workshop_library": build_fantasy_alchemist_workshop_library,
}


def main():
    OUTPUT_DIRECTORY.mkdir(parents=True, exist_ok=True)
    THUMBNAIL_DIRECTORY.mkdir(parents=True, exist_ok=True)
    selected = set(ARGS.only or ASSETS)
    for asset_id in ASSETS:
        if asset_id in selected:
            BUILDERS[asset_id]()
    print(f"Generated {len(selected)} ToonSpectrum Wave 5 environment assets in {OUTPUT_DIRECTORY}")


if __name__ == "__main__":
    main()
