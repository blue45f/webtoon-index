"""Generate all remaining ToonSpectrum mapped Blender prop GLBs at v3 quality.

This source is safe to execute from Blender 5.2 CLI or Blender MCP.  It never
calls ``read_factory_settings``: persistent MCP preferences and the blend-ai
server remain alive while every hidden and visible scene object is removed by
datablock unlinking between assets.

All dimensions use metres.  File names and legacy attachment orientations are
preserved.  Every export is a self-contained GLB with named multi-part geometry,
PBR materials, CC0 metadata extras, and no external URI.
"""

from math import cos, pi, sin

import bpy
from mathutils import Vector


OUTPUT_DIRECTORY = (
    bpy.context.scene.get("toonspectrum_mapped_props_output_dir")
    or bpy.path.abspath("//apps/web/public/assets/3d")
)
GENERATOR = "scripts/blender/generate_mapped_props_pack_v3.py"
CC0_LICENSE_URL = "https://creativecommons.org/publicdomain/zero/1.0/"


ASSETS = (
    ("cyber_katana_v3", "cyber_katana.glb"),
    ("magic_staff_crystal_v3", "magic_staff_crystal.glb"),
    ("scifi_drone_bot_v3", "scifi_drone_bot.glb"),
    ("neon_bench_prop_v3", "neom_bench_prop.glb"),
    ("cyber_helmet_visor_v3", "cyber_helmet_visor.glb"),
    ("hologram_tablet_v3", "hologram_tablet.glb"),
    ("ancient_rune_shield_v3", "ancient_rune_shield.glb"),
    ("arcade_game_cabinet_v3", "arcade_game_cabinet.glb"),
    ("medieval_greatsword_v3", "medieval_greatsword.glb"),
    ("cyberpunk_hoverbike_v3", "cyberpunk_hoverbike.glb"),
    ("cyber_sniper_rifle_v3", "cyber_sniper_rifle.glb"),
    ("fantasy_magic_wand_staff_v3", "fantasy_magic_wand_staff.glb"),
    ("steampunk_airship_v3", "steampunk_airship.glb"),
    ("cyberpunk_motorcycle_v3", "cyberpunk_motorcycle.glb"),
    ("scifi_laser_gun_v3", "scifi_laser_gun.glb"),
    ("magic_grimoire_v3", "magic_grimoire.glb"),
    ("medieval_shield_v3", "medieval_shield.glb"),
    ("street_lamp_v3", "street_lamp.glb"),
    ("royal_throne_v3", "royal_throne.glb"),
    ("crystal_orb_v3", "crystal_orb.glb"),
    ("tactical_helmet_v3", "tactical_helmet.glb"),
)


def clear_scene():
    """Clear all generated data, including hidden VRM helpers, without reset."""
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
    ):
        for datablock in list(collection):
            if datablock.users == 0:
                collection.remove(datablock)
    scene = bpy.context.scene
    output_override = scene.get("toonspectrum_mapped_props_output_dir")
    for key in list(scene.keys()):
        del scene[key]
    if output_override:
        scene["toonspectrum_mapped_props_output_dir"] = output_override
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    scene.unit_settings.length_unit = "METERS"


def material( # NOSONAR python:S3776
    name,
    color,
    metallic=0.0,
    roughness=0.5,
    emission=None,
    emission_strength=0.0,
    alpha=1.0,
    transmission=0.0,
):
    mat = bpy.data.materials.new(name=name)
    mat.diffuse_color = (color[0], color[1], color[2], alpha)
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get("Principled BSDF")
    if shader is not None:
        shader.inputs["Base Color"].default_value = (color[0], color[1], color[2], alpha)
        shader.inputs["Metallic"].default_value = metallic
        shader.inputs["Roughness"].default_value = roughness
        if "Alpha" in shader.inputs:
            shader.inputs["Alpha"].default_value = alpha
        if transmission > 0.0 and "Transmission Weight" in shader.inputs:
            shader.inputs["Transmission Weight"].default_value = transmission
        if emission is not None and emission_strength > 0.0:
            if "Emission Color" in shader.inputs:
                shader.inputs["Emission Color"].default_value = emission
            if "Emission Strength" in shader.inputs:
                shader.inputs["Emission Strength"].default_value = emission_strength
    if alpha < 1.0 and hasattr(mat, "surface_render_method"):
        mat.surface_render_method = "DITHERED"
    mat["toonspectrum_pbr"] = True
    return mat


def assign(obj, mat):
    obj.data.materials.clear()
    obj.data.materials.append(mat)


def bevel(obj, width, segments=3):
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
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    return obj


def box(name, dimensions, location, mat, edge=0.006, rotation=(0.0, 0.0, 0.0)):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=location)
    obj = bpy.context.active_object
    obj.name = name
    obj.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.rotation_euler = rotation
    assign(obj, mat)
    return bevel(obj, min(edge, min(dimensions) * 0.42))


def cylinder(
    name,
    radius,
    depth,
    location,
    mat,
    vertices=32,
    edge=0.003,
    rotation=(0.0, 0.0, 0.0),
    scale=(1.0, 1.0, 1.0),
):
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices,
        radius=radius,
        depth=depth,
        location=location,
    )
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.rotation_euler = rotation
    assign(obj, mat)
    bevel(obj, min(edge, radius * 0.30, depth * 0.18), segments=2)
    return smooth(obj)


def cone(
    name,
    radius1,
    radius2,
    depth,
    location,
    mat,
    vertices=32,
    rotation=(0.0, 0.0, 0.0),
    edge=0.003,
):
    bpy.ops.mesh.primitive_cone_add(
        vertices=vertices,
        radius1=radius1,
        radius2=radius2,
        depth=depth,
        location=location,
    )
    obj = bpy.context.active_object
    obj.name = name
    obj.rotation_euler = rotation
    assign(obj, mat)
    bevel(obj, min(edge, min(radius1, max(radius2, edge)) * 0.25, depth * 0.15), segments=2)
    return smooth(obj)


def sphere(name, radius, location, mat, segments=40, rings=20, scale=(1.0, 1.0, 1.0)):
    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=segments,
        ring_count=rings,
        radius=radius,
        location=location,
    )
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    assign(obj, mat)
    return smooth(obj)


def ico(name, radius, location, mat, subdivisions=3, scale=(1.0, 1.0, 1.0)):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdivisions, radius=radius, location=location)
    obj = bpy.context.active_object
    obj.name = name
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
    rotation=(0.0, 0.0, 0.0),
    major_segments=48,
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
    assign(obj, mat)
    return smooth(obj)


def rod(name, start, end, radius, mat, vertices=24, edge=0.002):
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


def tapered_blade(name, base_y, tip_y, half_width, thickness, mat):
    shoulder_y = tip_y - (tip_y - base_y) * 0.16
    vertices = [
        (-half_width, base_y, -thickness),
        (half_width, base_y, -thickness),
        (-half_width, base_y, thickness),
        (half_width, base_y, thickness),
        (-half_width, shoulder_y, -thickness),
        (half_width, shoulder_y, -thickness),
        (-half_width, shoulder_y, thickness),
        (half_width, shoulder_y, thickness),
        (0.0, tip_y, -thickness * 0.35),
        (0.0, tip_y, thickness * 0.35),
    ]
    faces = [
        (0, 1, 3, 2),
        (0, 4, 5, 1),
        (2, 3, 7, 6),
        (0, 2, 6, 4),
        (1, 5, 7, 3),
        (4, 6, 9, 8),
        (5, 8, 9, 7),
        (4, 8, 5),
        (6, 7, 9),
    ]
    mesh = bpy.data.meshes.new(f"{name}Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    assign(obj, mat)
    return bevel(obj, min(thickness * 0.45, 0.006), segments=2)


def root_and_export(asset_id, filename, origin, dimensions, quality_class):
    root = bpy.data.objects.new(f"TS_{asset_id}_Root", None)
    root.empty_display_type = "PLAIN_AXES"
    root["asset_id"] = asset_id
    root["asset_author"] = "ToonSpectrum"
    root["asset_generator"] = GENERATOR
    root["asset_license"] = "CC0-1.0"
    root["asset_license_url"] = CC0_LICENSE_URL
    root["units"] = "metres"
    root["attachment_origin"] = origin
    root["nominal_dimensions_m"] = dimensions
    root["quality_class"] = quality_class
    bpy.context.scene.collection.objects.link(root)
    for obj in tuple(bpy.context.scene.objects):
        if obj is not root and obj.parent is None:
            obj.parent = root
    bpy.context.scene["toonspectrum_asset_id"] = asset_id
    destination = f"{OUTPUT_DIRECTORY}/{filename}"
    bpy.ops.export_scene.gltf(
        filepath=destination,
        export_format="GLB",
        export_apply=True,
        export_extras=True,
        export_materials="EXPORT",
        export_cameras=False,
        export_lights=False,
        export_yup=True,
    )
    print(f"Exported {asset_id}: {destination}")


# -- handheld, headwear, and first environment builders ---------------------


def build_cyber_katana():
    clear_scene()
    steel = material("KatanaV3_BlackSteel", (0.13, 0.18, 0.24), 0.94, 0.16)
    edge_glow = material("KatanaV3_PlasmaEdge", (0.01, 0.45, 0.82), 0.24, 0.12,
                         (0.0, 0.78, 1.0, 1.0), 5.0)
    guard = material("KatanaV3_TitaniumGuard", (0.30, 0.34, 0.40), 0.88, 0.22)
    grip = material("KatanaV3_GripWrap", (0.025, 0.030, 0.040), 0.08, 0.78)
    accent = material("KatanaV3_RedCore", (0.65, 0.025, 0.035), 0.42, 0.20,
                      (1.0, 0.02, 0.03, 1.0), 2.4)

    tapered_blade("Blade_TaperedCore", -0.03, 1.13, 0.060, 0.014, steel)
    box("Blade_LeftPlasmaEdge", (0.010, 1.00, 0.014), (-0.055, 0.49, 0.0), edge_glow, 0.003)
    box("Blade_RightPlasmaEdge", (0.010, 1.00, 0.014), (0.055, 0.49, 0.0), edge_glow, 0.003)
    box("Blade_Fuller", (0.018, 0.90, 0.009), (0.0, 0.43, 0.017), accent, 0.003)
    torus("Guard_EnergyRing", 0.105, 0.010, (0.0, -0.055, 0.0), guard,
          (pi * 0.5, 0.0, 0.0), 48, 10)
    rod("Guard_LeftQuillon", (0.0, -0.06, 0.0), (-0.16, -0.06, 0.015), 0.014, guard)
    rod("Guard_RightQuillon", (0.0, -0.06, 0.0), (0.16, -0.06, 0.015), 0.014, guard)
    cylinder("Handle_Core", 0.026, 0.42, (0.0, -0.285, 0.0), grip, 36, 0.004,
             (pi * 0.5, 0.0, 0.0))
    for index, y_value in enumerate((-0.11, -0.17, -0.23, -0.29, -0.35, -0.41), start=1):
        torus(f"GripWrap_{index}", 0.029, 0.0045, (0.0, y_value, 0.0), accent,
              (pi * 0.5, 0.0, 0.0), 32, 8)
    cylinder("Pommel_Collar", 0.040, 0.028, (0.0, -0.505, 0.0), guard, 36, 0.004,
             (pi * 0.5, 0.0, 0.0))
    ico("Pommel_Reactor", 0.045, (0.0, -0.545, 0.0), edge_glow, 2, (0.75, 1.0, 0.75))
    root_and_export("cyber_katana_v3", "cyber_katana.glb", "primary-grip-y=-0.35",
                    "0.32 x 1.72 x 0.12", "handheld")


def build_magic_staff():
    clear_scene()
    wood = material("StaffV3_Runewood", (0.22, 0.075, 0.025), 0.04, 0.78)
    gold = material("StaffV3_AntiqueGold", (0.72, 0.40, 0.07), 0.90, 0.24)
    leather = material("StaffV3_LeatherGrip", (0.075, 0.025, 0.015), 0.02, 0.86)
    crystal = material("StaffV3_CrystalCore", (0.20, 0.08, 0.78), 0.12, 0.06,
                       (0.55, 0.12, 1.0, 1.0), 5.5, 0.86, 0.22)

    cylinder("Staff_RunewoodShaft", 0.030, 1.60, (0.0, 0.0, 0.80), wood, 36, 0.004)
    cylinder("Staff_LeatherGrip", 0.036, 0.34, (0.0, 0.0, 0.34), leather, 36, 0.004)
    for index, z_value in enumerate((0.18, 0.29, 0.40, 0.51, 1.46, 1.55), start=1):
        torus(f"Staff_Collar_{index}", 0.038, 0.006, (0.0, 0.0, z_value), gold,
              major_segments=36, minor_segments=8)
    for index, angle in enumerate((0.0, pi * 0.5, pi, pi * 1.5), start=1):
        rod(f"Crystal_Prongs_{index}",
            (0.050 * cos(angle), 0.050 * sin(angle), 1.53),
            (0.085 * cos(angle), 0.085 * sin(angle), 1.70), 0.010, gold, 20)
    ico("Crystal_FacetedCore", 0.112, (0.0, 0.0, 1.72), crystal, 3, (0.78, 0.78, 1.22))
    torus("Crystal_Orbit_A", 0.145, 0.009, (0.0, 0.0, 1.72), gold,
          (0.55, 0.25, 0.0), 48, 10)
    torus("Crystal_Orbit_B", 0.145, 0.009, (0.0, 0.0, 1.72), gold,
          (-0.45, 0.80, 0.0), 48, 10)
    torus("Crystal_Orbit_Glow", 0.126, 0.006, (0.0, 0.0, 1.72), crystal,
          (0.15, -0.65, 0.2), 48, 8)
    cone("Staff_Ferrule", 0.045, 0.024, 0.12, (0.0, 0.0, 0.06), gold, 32)
    root_and_export("magic_staff_crystal_v3", "magic_staff_crystal.glb",
                    "lower-shaft-hand-grip", "0.31 x 0.31 x 1.86", "handheld")


def build_scifi_drone():
    clear_scene()
    shell = material("DroneV3_CeramicShell", (0.72, 0.78, 0.84), 0.55, 0.24)
    chassis = material("DroneV3_CarbonChassis", (0.025, 0.040, 0.060), 0.72, 0.30)
    lens = material("DroneV3_SensorLens", (0.03, 0.20, 0.42), 0.18, 0.05,
                    (0.02, 0.55, 1.0, 1.0), 4.6, 0.84, 0.24)
    thruster = material("DroneV3_ThrusterGlow", (0.02, 0.50, 0.75), 0.20, 0.12,
                        (0.0, 0.82, 1.0, 1.0), 5.0)
    warning = material("DroneV3_WarningOrange", (0.94, 0.20, 0.025), 0.30, 0.28,
                       (1.0, 0.10, 0.01, 1.0), 1.8)

    sphere("Drone_CentralShell", 0.245, (0.0, 0.0, 0.0), shell, 48, 24, (1.0, 0.86, 0.72))
    box("Drone_VentralChassis", (0.34, 0.30, 0.10), (0.0, 0.0, -0.16), chassis, 0.025)
    cylinder("Drone_MainEyeHousing", 0.105, 0.075, (0.0, 0.215, 0.015), chassis, 48, 0.006,
             (pi * 0.5, 0.0, 0.0))
    sphere("Drone_MainEyeLens", 0.080, (0.0, 0.258, 0.015), lens, 40, 20, (1.0, 0.34, 1.0))
    for index, (x_value, y_value) in enumerate(((-0.34, -0.28), (0.34, -0.28),
                                                (-0.34, 0.28), (0.34, 0.28)), start=1):
        rod(f"Drone_Arm_{index}", (0.12 if x_value > 0 else -0.12,
                                    0.10 if y_value > 0 else -0.10, -0.02),
            (x_value, y_value, -0.02), 0.030, chassis, 28, 0.004)
        cylinder(f"Drone_RotorPod_{index}", 0.090, 0.085, (x_value, y_value, -0.02),
                 shell, 36, 0.006)
        torus(f"Drone_ThrusterRing_{index}", 0.102, 0.014, (x_value, y_value, -0.070),
              thruster, major_segments=44, minor_segments=10)
        cylinder(f"Drone_ThrusterCore_{index}", 0.052, 0.018, (x_value, y_value, -0.078),
                 lens, 32, 0.003)
    box("Drone_TopAntennaBase", (0.12, 0.08, 0.045), (0.0, -0.03, 0.215), chassis, 0.012)
    rod("Drone_TopAntenna", (0.0, -0.03, 0.22), (0.0, -0.03, 0.37), 0.009, warning, 20)
    sphere("Drone_AntennaBeacon", 0.027, (0.0, -0.03, 0.39), warning, 24, 12)
    for side, x_value in (("Left", -0.17), ("Right", 0.17)):
        box(f"Drone_{side}StatusPanel", (0.085, 0.018, 0.035),
            (x_value, 0.206, -0.09), warning, 0.007)
    root_and_export("scifi_drone_bot_v3", "scifi_drone_bot.glb", "body-centre-hover",
                    "0.90 x 0.78 x 0.49", "large-body")


def build_neon_bench():
    clear_scene()
    carbon = material("BenchV3_CarbonComposite", (0.025, 0.040, 0.060), 0.48, 0.38)
    cushion = material("BenchV3_WeatherSeat", (0.075, 0.16, 0.20), 0.05, 0.72)
    alloy = material("BenchV3_FrameAlloy", (0.28, 0.34, 0.40), 0.82, 0.25)
    neon = material("BenchV3_NeonMint", (0.0, 0.48, 0.30), 0.15, 0.12,
                    (0.0, 1.0, 0.52, 1.0), 4.8)

    for index, x_value in enumerate((-0.72, -0.36, 0.0, 0.36, 0.72), start=1):
        box(f"Bench_SeatSlat_{index}", (0.31, 0.54, 0.075),
            (x_value, -0.02, 0.47), cushion, 0.025)
    box("Bench_SeatFrameFront", (1.92, 0.065, 0.12), (0.0, -0.285, 0.42), carbon, 0.020)
    box("Bench_SeatFrameRear", (1.92, 0.065, 0.12), (0.0, 0.245, 0.42), carbon, 0.020)
    for index, x_value in enumerate((-0.66, -0.22, 0.22, 0.66), start=1):
        box(f"Bench_BackPanel_{index}", (0.39, 0.075, 0.47),
            (x_value, 0.265, 0.78), carbon, 0.035, (-0.12, 0.0, 0.0))
        sphere(f"Bench_BackBolt_{index}_L", 0.022, (x_value - 0.12, 0.219, 0.65), alloy, 20, 10)
        sphere(f"Bench_BackBolt_{index}_R", 0.022, (x_value + 0.12, 0.219, 0.89), alloy, 20, 10)
    for side, x_value in (("Left", -0.78), ("Right", 0.78)):
        rod(f"Bench_{side}FrontLeg", (x_value, -0.22, 0.0), (x_value, -0.22, 0.43), 0.040, alloy, 32)
        rod(f"Bench_{side}RearLeg", (x_value, 0.20, 0.0), (x_value, 0.20, 0.44), 0.040, alloy, 32)
        rod(f"Bench_{side}ArmPost", (x_value, -0.18, 0.48), (x_value, -0.18, 0.76), 0.035, alloy, 32)
        box(f"Bench_{side}ArmPad", (0.12, 0.48, 0.065), (x_value, -0.01, 0.78),
            cushion, 0.022)
    box("Bench_NeonFront", (1.78, 0.018, 0.030), (0.0, -0.322, 0.43), neon, 0.007)
    box("Bench_NeonBack", (1.74, 0.018, 0.030), (0.0, 0.218, 0.97), neon, 0.007)
    box("Bench_FloorRail", (1.55, 0.075, 0.055), (0.0, 0.0, 0.045), alloy, 0.014)
    root_and_export("neon_bench_prop_v3", "neom_bench_prop.glb", "floor-centre-seat-y=0.45",
                    "1.98 x 0.68 x 1.04", "large-body")


def build_cyber_visor():
    clear_scene()
    frame = material("VisorV3_TitaniumFrame", (0.025, 0.035, 0.055), 0.92, 0.20)
    visor = material("VisorV3_AmberGlass", (0.86, 0.18, 0.025), 0.16, 0.06,
                     (1.0, 0.22, 0.01, 1.0), 2.8, 0.40, 0.42)
    hud = material("VisorV3_HUD", (0.10, 0.72, 1.0), 0.08, 0.10,
                   (0.02, 0.75, 1.0, 1.0), 5.0, 0.72)
    padding = material("VisorV3_HeadPadding", (0.025, 0.030, 0.035), 0.02, 0.86)
    hardware = material("VisorV3_Hardware", (0.34, 0.40, 0.46), 0.88, 0.24)

    sphere("Visor_CurvedShield", 0.165, (0.0, -0.015, 0.0), visor, 48, 24, (1.0, 0.25, 0.55))
    torus("Visor_OuterFrame", 0.155, 0.010, (0.0, 0.0, 0.0), frame,
          (pi * 0.5, 0.0, 0.0), 48, 10)
    box("Visor_TopBrow", (0.29, 0.045, 0.040), (0.0, 0.0, 0.082), frame, 0.015)
    for side, x_value in (("Left", -0.163), ("Right", 0.163)):
        cylinder(f"Visor_{side}Hinge", 0.036, 0.045, (x_value, 0.025, 0.0), hardware,
                 36, 0.005, (0.0, pi * 0.5, 0.0))
        sphere(f"Visor_{side}Sensor", 0.028, (x_value, -0.005, 0.0), hud, 28, 14,
               (0.45, 1.0, 1.0))
        rod(f"Visor_{side}Temple", (x_value, 0.025, 0.0),
            (x_value * 0.94, 0.19, -0.025), 0.009, frame, 24)
        box(f"Visor_{side}TemplePad", (0.045, 0.09, 0.035),
            (x_value * 0.92, 0.19, -0.035), padding, 0.012)
    box("Visor_HUD_Horizon", (0.17, 0.003, 0.004), (0.015, -0.060, 0.008), hud, 0.001)
    box("Visor_HUD_ReticleX", (0.040, 0.003, 0.003), (0.045, -0.061, -0.018), hud, 0.001)
    box("Visor_HUD_ReticleZ", (0.003, 0.003, 0.040), (0.045, -0.061, -0.018), hud, 0.001)
    root_and_export("cyber_helmet_visor_v3", "cyber_helmet_visor.glb",
                    "head-centre-forward-negative-y", "0.37 x 0.25 x 0.18", "headwear")


def build_hologram_tablet():
    clear_scene()
    frame = material("TabletV3_AlloyFrame", (0.075, 0.10, 0.14), 0.88, 0.22)
    glass = material("TabletV3_HoloGlass", (0.02, 0.30, 0.48), 0.08, 0.06,
                     (0.02, 0.62, 1.0, 1.0), 1.4, 0.34, 0.48)
    holo = material("TabletV3_Hologram", (0.06, 0.72, 1.0), 0.04, 0.08,
                    (0.02, 0.82, 1.0, 1.0), 5.5, 0.68)
    grip = material("TabletV3_RubberGrip", (0.018, 0.026, 0.036), 0.04, 0.86)
    accent = material("TabletV3_StatusOrange", (0.92, 0.22, 0.025), 0.22, 0.26,
                      (1.0, 0.08, 0.01, 1.0), 2.0)

    box("Tablet_Backplate", (0.40, 0.018, 0.26), (0.0, 0.0, 0.0), frame, 0.018)
    box("Tablet_HoloScreen", (0.35, 0.006, 0.215), (0.0, -0.014, 0.0), glass, 0.014)
    for side, x_value in (("Left", -0.205), ("Right", 0.205)):
        box(f"Tablet_{side}Grip", (0.045, 0.035, 0.20), (x_value, 0.0, 0.0), grip, 0.014)
        for index, z_value in enumerate((-0.075, 0.0, 0.075), start=1):
            cylinder(f"Tablet_{side}Button_{index}", 0.010, 0.009,
                     (x_value, -0.023, z_value), accent, 20, 0.002,
                     (pi * 0.5, 0.0, 0.0))
    for index, (x_value, z_value) in enumerate(((-0.15, -0.10), (0.15, -0.10),
                                                (-0.15, 0.10), (0.15, 0.10)), start=1):
        cylinder(f"Tablet_CornerFastener_{index}", 0.012, 0.009,
                 (x_value, -0.024, z_value), frame, 24, 0.002, (pi * 0.5, 0.0, 0.0))
    sphere("Tablet_HologramCore", 0.052, (0.0, -0.080, 0.0), holo, 36, 18)
    torus("Tablet_HologramOrbitA", 0.086, 0.004, (0.0, -0.080, 0.0), holo,
          (pi * 0.5, 0.25, 0.0), 40, 8)
    torus("Tablet_HologramOrbitB", 0.086, 0.004, (0.0, -0.080, 0.0), accent,
          (0.6, pi * 0.5, 0.0), 40, 8)
    box("Tablet_UI_Header", (0.13, 0.002, 0.012), (-0.07, -0.020, 0.078), holo, 0.002)
    box("Tablet_UI_DataBar", (0.18, 0.002, 0.009), (0.04, -0.020, -0.077), accent, 0.002)
    root_and_export("hologram_tablet_v3", "hologram_tablet.glb", "device-centre-left-hand",
                    "0.45 x 0.17 x 0.27", "handheld")


def build_ancient_rune_shield():
    clear_scene()
    steel = material("RuneShieldV3_DarkSteel", (0.11, 0.14, 0.18), 0.90, 0.30)
    gold = material("RuneShieldV3_AntiqueGold", (0.72, 0.43, 0.08), 0.88, 0.25)
    wood = material("RuneShieldV3_OakBack", (0.28, 0.10, 0.025), 0.04, 0.72)
    rune = material("RuneShieldV3_RuneGlow", (0.05, 0.40, 0.78), 0.14, 0.12,
                    (0.02, 0.68, 1.0, 1.0), 4.5)
    leather = material("RuneShieldV3_LeatherGrip", (0.065, 0.020, 0.012), 0.02, 0.86)

    cylinder("RuneShield_WoodCore", 0.39, 0.045, (0.0, 0.0, 0.0), wood, 64, 0.007,
             scale=(1.0, 0.82, 1.0))
    cylinder("RuneShield_SteelFace", 0.35, 0.050, (0.0, 0.0, 0.028), steel, 64, 0.006,
             scale=(1.0, 0.82, 1.0))
    torus("RuneShield_OuterRim", 0.365, 0.020, (0.0, 0.0, 0.056), gold,
          major_segments=56, minor_segments=12)
    sphere("RuneShield_CentreBoss", 0.125, (0.0, 0.0, 0.075), gold, 40, 20,
           (1.0, 0.82, 0.38))
    torus("RuneShield_RuneCircle", 0.225, 0.010, (0.0, 0.0, 0.084), rune,
          major_segments=48, minor_segments=8)
    for index, angle in enumerate((0.0, pi * 0.25, pi * 0.5, pi * 0.75,
                                   pi, pi * 1.25, pi * 1.5, pi * 1.75), start=1):
        x0, y0 = 0.155 * cos(angle), 0.128 * sin(angle)
        x1, y1 = 0.275 * cos(angle), 0.226 * sin(angle)
        rod(f"RuneShield_RuneRay_{index}", (x0, y0, 0.088), (x1, y1, 0.088),
            0.008, rune, 16, 0.0015)
        sphere(f"RuneShield_Rivet_{index}", 0.016, (0.31 * cos(angle),
               0.254 * sin(angle), 0.079), gold, 18, 9)
    box("RuneShield_BackGrip", (0.055, 0.24, 0.050), (0.0, 0.0, -0.055), leather, 0.014)
    box("RuneShield_BackBrace", (0.44, 0.055, 0.035), (0.0, 0.0, -0.050), steel, 0.010)
    root_and_export("ancient_rune_shield_v3", "ancient_rune_shield.glb",
                    "centre-back-primary-grip", "0.80 x 0.66 x 0.18", "handheld")


# -- cabinet, large weapons, and vehicle builders ---------------------------


def build_arcade_cabinet():
    clear_scene()
    body = material("ArcadeV3_CabinetMagenta", (0.58, 0.025, 0.16), 0.20, 0.42)
    trim = material("ArcadeV3_BlackTrim", (0.018, 0.025, 0.038), 0.42, 0.36)
    screen = material("ArcadeV3_CRTScreen", (0.02, 0.22, 0.40), 0.06, 0.08,
                      (0.02, 0.58, 1.0, 1.0), 3.8)
    marquee = material("ArcadeV3_Marquee", (0.95, 0.44, 0.035), 0.10, 0.18,
                       (1.0, 0.30, 0.02, 1.0), 4.5)
    chrome = material("ArcadeV3_Chrome", (0.42, 0.48, 0.55), 0.92, 0.18)
    control = material("ArcadeV3_ControlCyan", (0.015, 0.58, 0.72), 0.22, 0.24,
                       (0.0, 0.76, 1.0, 1.0), 2.5)

    box("Arcade_LowerCabinet", (0.76, 0.70, 0.88), (0.0, 0.0, 0.44), body, 0.045)
    box("Arcade_UpperCabinet", (0.76, 0.60, 0.78), (0.0, -0.035, 1.24), body, 0.045,
        (0.06, 0.0, 0.0))
    box("Arcade_BasePlinth", (0.82, 0.74, 0.10), (0.0, 0.0, 0.05), trim, 0.022)
    box("Arcade_ScreenBezel", (0.62, 0.075, 0.48), (0.0, 0.304, 1.30), trim, 0.025,
        (-0.18, 0.0, 0.0))
    box("Arcade_CRTGlass", (0.54, 0.025, 0.39), (0.0, 0.350, 1.30), screen, 0.040,
        (-0.18, 0.0, 0.0))
    box("Arcade_MarqueeHousing", (0.74, 0.12, 0.23), (0.0, 0.285, 1.72), trim, 0.026)
    box("Arcade_LitMarquee", (0.63, 0.025, 0.14), (0.0, 0.354, 1.72), marquee, 0.020)
    box("Arcade_ControlDeck", (0.72, 0.32, 0.12), (0.0, 0.315, 0.96), trim, 0.022,
        (-0.18, 0.0, 0.0))
    cylinder("Arcade_JoystickStem", 0.018, 0.13, (-0.20, 0.41, 1.05), chrome, 28, 0.003,
             (0.20, 0.0, 0.0))
    sphere("Arcade_JoystickBall", 0.050, (-0.20, 0.43, 1.11), control, 28, 14)
    for row, z_value in enumerate((1.015, 1.075), start=1):
        for column, x_value in enumerate((0.02, 0.12, 0.22), start=1):
            cylinder(f"Arcade_ActionButton_{row}_{column}", 0.026, 0.018,
                     (x_value, 0.445, z_value), control if (row + column) % 2 else marquee,
                     24, 0.003, (pi * 0.5, 0.0, 0.0))
    for side, x_value in (("Left", -0.22), ("Right", 0.22)):
        torus(f"Arcade_{side}SpeakerRim", 0.070, 0.010, (x_value, 0.356, 0.72), chrome,
              (pi * 0.5, 0.0, 0.0), 36, 8)
        cylinder(f"Arcade_{side}SpeakerCone", 0.058, 0.018, (x_value, 0.366, 0.72), trim,
                 32, 0.002, (pi * 0.5, 0.0, 0.0))
    box("Arcade_CoinDoor", (0.28, 0.025, 0.30), (0.0, 0.363, 0.38), trim, 0.016)
    for index, x_value in enumerate((-0.07, 0.07), start=1):
        box(f"Arcade_CoinSlot_{index}", (0.045, 0.010, 0.085),
            (x_value, 0.383, 0.44), chrome, 0.006)
        cylinder(f"Arcade_CoinLight_{index}", 0.018, 0.010, (x_value, 0.384, 0.31), marquee,
                 20, 0.002, (pi * 0.5, 0.0, 0.0))
    for index, x_value in enumerate((-0.29, 0.29), start=1):
        box(f"Arcade_SideRail_{index}", (0.055, 0.72, 1.65), (x_value, 0.0, 0.88),
            chrome, 0.012)
    root_and_export("arcade_game_cabinet_v3", "arcade_game_cabinet.glb",
                    "floor-centre-control-height=0.96", "0.82 x 0.82 x 1.84", "large-body")


def build_medieval_greatsword():
    clear_scene()
    steel = material("GreatswordV3_ForgedSteel", (0.42, 0.47, 0.53), 0.92, 0.24)
    fuller = material("GreatswordV3_DarkFuller", (0.07, 0.09, 0.12), 0.75, 0.32)
    bronze = material("GreatswordV3_RoyalBronze", (0.56, 0.28, 0.055), 0.86, 0.28)
    leather = material("GreatswordV3_LeatherGrip", (0.095, 0.028, 0.012), 0.03, 0.86)
    rune = material("GreatswordV3_RuneGlow", (0.04, 0.42, 0.70), 0.10, 0.12,
                    (0.02, 0.72, 1.0, 1.0), 4.2)

    tapered_blade("Greatsword_TaperedBlade", 0.34, 1.78, 0.105, 0.024, steel)
    box("Greatsword_Fuller", (0.032, 1.18, 0.012), (0.0, 0.96, 0.026), fuller, 0.004)
    for index, y_value in enumerate((0.58, 0.84, 1.10, 1.36), start=1):
        box(f"Greatsword_Rune_{index}", (0.040, 0.10, 0.010),
            (0.0, y_value, 0.035), rune, 0.004, (0.0, 0.0, (-1) ** index * 0.35))
    rod("Greatsword_LeftGuard", (0.0, 0.31, 0.0), (-0.30, 0.23, 0.025), 0.026, bronze, 32)
    rod("Greatsword_RightGuard", (0.0, 0.31, 0.0), (0.30, 0.23, 0.025), 0.026, bronze, 32)
    cone("Greatsword_LeftGuardTip", 0.040, 0.012, 0.14, (-0.34, 0.22, 0.025), bronze, 28,
         (0.0, pi * 0.5, 0.0))
    cone("Greatsword_RightGuardTip", 0.040, 0.012, 0.14, (0.34, 0.22, 0.025), bronze, 28,
         (0.0, -pi * 0.5, 0.0))
    cylinder("Greatsword_GripCore", 0.038, 0.48, (0.0, 0.06, 0.0), leather, 40, 0.005,
             (pi * 0.5, 0.0, 0.0))
    for index, y_value in enumerate((0.25, 0.18, 0.11, 0.04, -0.03, -0.10, -0.17), start=1):
        torus(f"Greatsword_GripWrap_{index}", 0.041, 0.005, (0.0, y_value, 0.0), bronze,
              (pi * 0.5, 0.0, 0.0), 32, 8)
    torus("Greatsword_PommelRing", 0.065, 0.012, (0.0, -0.22, 0.0), bronze,
          (pi * 0.5, 0.0, 0.0), 40, 8)
    ico("Greatsword_PommelGem", 0.060, (0.0, -0.29, 0.0), rune, 2, (0.76, 1.0, 0.76))
    root_and_export("medieval_greatsword_v3", "medieval_greatsword.glb",
                    "primary-grip-y=0.15", "0.76 x 2.09 x 0.18", "handheld")


def build_cyber_hoverbike():
    clear_scene()
    body = material("HoverbikeV3_Armour", (0.055, 0.075, 0.105), 0.86, 0.22)
    accent = material("HoverbikeV3_Crimson", (0.72, 0.025, 0.055), 0.62, 0.24)
    seat = material("HoverbikeV3_Seat", (0.018, 0.022, 0.030), 0.04, 0.82)
    glow = material("HoverbikeV3_ThrusterGlow", (0.02, 0.40, 0.70), 0.12, 0.10,
                    (0.0, 0.78, 1.0, 1.0), 5.2)
    alloy = material("HoverbikeV3_FrameAlloy", (0.32, 0.38, 0.44), 0.90, 0.20)

    sphere("Hoverbike_MainFuselage", 0.43, (0.0, 0.0, 0.46), body, 56, 28,
           (0.72, 1.85, 0.50))
    sphere("Hoverbike_NoseCowling", 0.29, (0.0, -0.78, 0.49), accent, 44, 22,
           (0.72, 1.30, 0.58))
    box("Hoverbike_RiderSeat", (0.42, 0.70, 0.105), (0.0, 0.20, 0.71), seat, 0.038,
        (-0.08, 0.0, 0.0))
    box("Hoverbike_RearCowl", (0.50, 0.46, 0.23), (0.0, 0.70, 0.58), body, 0.065)
    for side, x_value in (("Left", -0.42), ("Right", 0.42)):
        rod(f"Hoverbike_{side}FrameRail", (x_value * 0.42, -0.52, 0.50),
            (x_value, 0.58, 0.44), 0.035, alloy, 32)
        torus(f"Hoverbike_{side}FrontLiftRing", 0.155, 0.026,
              (x_value, -0.54, 0.31), glow, (0.0, pi * 0.5, 0.0), 48, 12)
        torus(f"Hoverbike_{side}RearLiftRing", 0.190, 0.030,
              (x_value, 0.62, 0.36), glow, (0.0, pi * 0.5, 0.0), 48, 12)
        cylinder(f"Hoverbike_{side}FrontPod", 0.115, 0.19,
                 (x_value, -0.54, 0.31), body, 36, 0.009, (0.0, pi * 0.5, 0.0))
        cylinder(f"Hoverbike_{side}RearPod", 0.145, 0.22,
                 (x_value, 0.62, 0.36), accent, 40, 0.010, (0.0, pi * 0.5, 0.0))
    rod("Hoverbike_Handlebar", (-0.31, -0.43, 0.78), (0.31, -0.43, 0.78), 0.025, alloy, 32)
    for side, x_value in (("Left", -0.33), ("Right", 0.33)):
        cylinder(f"Hoverbike_{side}Grip", 0.035, 0.14, (x_value, -0.43, 0.78), seat,
                 28, 0.004, (0.0, pi * 0.5, 0.0))
        box(f"Hoverbike_{side}Footrest", (0.22, 0.34, 0.035),
            (x_value * 0.84, 0.10, 0.30), alloy, 0.014)
    sphere("Hoverbike_Dashboard", 0.11, (0.0, -0.48, 0.76), glow, 36, 18,
           (1.25, 0.36, 0.62))
    root_and_export("cyberpunk_hoverbike_v3", "cyberpunk_hoverbike.glb",
                    "floor-centre-seat-y-up=0.71", "1.12 x 2.02 x 0.87", "large-body")


def build_cyber_sniper_rifle():
    clear_scene()
    metal = material("SniperV3_Gunmetal", (0.055, 0.075, 0.10), 0.92, 0.20)
    polymer = material("SniperV3_GripPolymer", (0.018, 0.024, 0.034), 0.10, 0.78)
    rail = material("SniperV3_TitaniumRail", (0.30, 0.36, 0.43), 0.88, 0.24)
    optic = material("SniperV3_OpticGlass", (0.18, 0.025, 0.035), 0.18, 0.06,
                     (1.0, 0.015, 0.025, 1.0), 3.8, 0.84, 0.26)
    accent = material("SniperV3_SafetyOrange", (0.92, 0.18, 0.015), 0.32, 0.28)

    box("Sniper_Receiver", (0.18, 0.66, 0.18), (0.0, 0.45, 0.02), metal, 0.025)
    box("Sniper_Stock", (0.24, 0.56, 0.20), (0.0, -0.18, -0.01), polymer, 0.045,
        (0.12, 0.0, 0.0))
    box("Sniper_CheekRest", (0.18, 0.32, 0.075), (0.0, -0.08, 0.16), polymer, 0.025)
    box("Sniper_ButtPad", (0.25, 0.07, 0.26), (0.0, -0.50, -0.015), accent, 0.022)
    cylinder("Sniper_Barrel", 0.036, 1.22, (0.0, 1.22, 0.04), metal, 40, 0.005,
             (pi * 0.5, 0.0, 0.0))
    cylinder("Sniper_MuzzleBrake", 0.066, 0.20, (0.0, 1.88, 0.04), rail, 40, 0.008,
             (pi * 0.5, 0.0, 0.0))
    for index, y_value in enumerate((1.82, 1.88, 1.94), start=1):
        box(f"Sniper_MuzzlePort_{index}", (0.10, 0.026, 0.025),
            (0.0, y_value, 0.082), polymer, 0.005)
    box("Sniper_TopRail", (0.11, 0.94, 0.035), (0.0, 0.73, 0.135), rail, 0.009)
    for index, y_value in enumerate((0.32, 0.47, 0.62, 0.77, 0.92, 1.07), start=1):
        box(f"Sniper_RailSlot_{index}", (0.13, 0.035, 0.025),
            (0.0, y_value, 0.165), polymer, 0.005)
    cylinder("Sniper_ScopeTube", 0.055, 0.62, (0.0, 0.62, 0.25), metal, 40, 0.006,
             (pi * 0.5, 0.0, 0.0))
    for index, y_value in enumerate((0.32, 0.52, 0.72, 0.92), start=1):
        torus(f"Sniper_ScopeRing_{index}", 0.062, 0.009, (0.0, y_value, 0.25), rail,
              (pi * 0.5, 0.0, 0.0), 36, 8)
    sphere("Sniper_ScopeLens", 0.050, (0.0, 0.947, 0.25), optic, 32, 16,
           (1.0, 0.30, 1.0))
    box("Sniper_PistolGrip", (0.12, 0.18, 0.29), (0.0, 0.22, -0.19), polymer, 0.028,
        (-0.35, 0.0, 0.0))
    box("Sniper_TriggerGuard", (0.10, 0.16, 0.035), (0.0, 0.36, -0.10), rail, 0.012)
    rod("Sniper_BipodLeft", (-0.055, 1.10, -0.02), (-0.24, 1.10, -0.48), 0.014, rail, 24)
    rod("Sniper_BipodRight", (0.055, 1.10, -0.02), (0.24, 1.10, -0.48), 0.014, rail, 24)
    root_and_export("cyber_sniper_rifle_v3", "cyber_sniper_rifle.glb",
                    "pistol-grip-y=0.20", "0.50 x 2.48 x 0.78", "handheld")


def build_magic_wand_staff():
    clear_scene()
    wood = material("WandV3_Moonwood", (0.24, 0.075, 0.030), 0.04, 0.74)
    gold = material("WandV3_StarlightGold", (0.78, 0.46, 0.08), 0.86, 0.23)
    ribbon = material("WandV3_Ribbon", (0.54, 0.035, 0.30), 0.06, 0.58)
    glow = material("WandV3_StarGlow", (0.80, 0.64, 0.06), 0.08, 0.10,
                    (1.0, 0.72, 0.05, 1.0), 5.5)
    gem = material("WandV3_Crystal", (0.20, 0.50, 0.95), 0.06, 0.06,
                   (0.12, 0.62, 1.0, 1.0), 3.6, 0.86, 0.20)

    cylinder("Wand_Handle", 0.020, 1.05, (0.0, 0.33, 0.0), wood, 32, 0.003,
             (pi * 0.5, 0.0, 0.0))
    for index, y_value in enumerate((-0.16, -0.07, 0.02, 0.11, 0.20), start=1):
        torus(f"Wand_GripWrap_{index}", 0.024, 0.004, (0.0, y_value, 0.0), ribbon,
              (pi * 0.5, 0.0, 0.0), 32, 8)
    cylinder("Wand_CrownCollar", 0.050, 0.065, (0.0, 0.88, 0.0), gold, 36, 0.005,
             (pi * 0.5, 0.0, 0.0))
    ico("Wand_StarCore", 0.082, (0.0, 0.98, 0.0), glow, 3)
    for index, angle in enumerate((0.0, pi * 0.4, pi * 0.8, pi * 1.2, pi * 1.6), start=1):
        x_value = 0.16 * cos(angle)
        z_value = 0.16 * sin(angle)
        rod(f"Wand_StarRay_{index}", (0.0, 0.98, 0.0),
            (x_value, 0.98, z_value), 0.014, gold, 20)
        ico(f"Wand_StarTip_{index}", 0.030, (x_value, 0.98, z_value), glow, 2)
    torus("Wand_OrbitRing", 0.190, 0.008, (0.0, 0.98, 0.0), gem,
          (pi * 0.5, 0.0, 0.0), 48, 8)
    ico("Wand_PommelGem", 0.042, (0.0, -0.22, 0.0), gem, 2, (0.72, 1.0, 0.72))
    root_and_export("fantasy_magic_wand_staff_v3", "fantasy_magic_wand_staff.glb",
                    "primary-grip-y=0.20", "0.40 x 1.24 x 0.40", "handheld")


def build_steampunk_airship():
    clear_scene()
    canvas = material("AirshipV3_CanvasEnvelope", (0.48, 0.29, 0.13), 0.05, 0.70)
    brass = material("AirshipV3_Brass", (0.67, 0.39, 0.075), 0.90, 0.24)
    wood = material("AirshipV3_WalnutGondola", (0.21, 0.065, 0.020), 0.04, 0.64)
    steel = material("AirshipV3_Iron", (0.075, 0.09, 0.11), 0.84, 0.32)
    glow = material("AirshipV3_AetherGlow", (0.02, 0.35, 0.60), 0.10, 0.12,
                    (0.0, 0.68, 1.0, 1.0), 4.0)

    sphere("Airship_MainEnvelope", 0.52, (0.0, 0.50, 0.42), canvas, 64, 32,
           (0.82, 2.05, 0.82))
    for index, y_value in enumerate((-0.25, 0.10, 0.45, 0.80, 1.15), start=1):
        torus(f"Airship_EnvelopeBand_{index}", 0.425, 0.014,
              (0.0, y_value, 0.42), brass, (pi * 0.5, 0.0, 0.0), 44, 8)
    box("Airship_GondolaHull", (0.42, 0.95, 0.26), (0.0, 0.48, -0.28), wood, 0.055)
    box("Airship_GondolaDeck", (0.48, 0.88, 0.045), (0.0, 0.48, -0.115), brass, 0.012)
    box("Airship_PilotCabin", (0.30, 0.32, 0.28), (0.0, 0.18, -0.08), steel, 0.040)
    box("Airship_CabinWindow", (0.24, 0.018, 0.12), (0.0, 0.008, -0.06), glow, 0.016)
    for side, x_value in (("Left", -0.32), ("Right", 0.32)):
        rod(f"Airship_{side}FrontStrut", (x_value * 0.50, 0.14, -0.12),
            (x_value, 0.12, 0.28), 0.012, brass, 20)
        rod(f"Airship_{side}RearStrut", (x_value * 0.50, 0.82, -0.12),
            (x_value, 0.90, 0.28), 0.012, brass, 20)
        cylinder(f"Airship_{side}Engine", 0.095, 0.30, (x_value, 0.66, -0.22), steel,
                 36, 0.007, (0.0, pi * 0.5, 0.0))
        torus(f"Airship_{side}EngineGlow", 0.095, 0.015,
              (x_value + (-0.16 if side == "Left" else 0.16), 0.66, -0.22), glow,
              (0.0, pi * 0.5, 0.0), 40, 10)
    cylinder("Airship_RearPropellerHub", 0.075, 0.15, (0.0, 1.60, 0.16), brass, 32, 0.006,
             (pi * 0.5, 0.0, 0.0))
    for index, angle in enumerate((0.0, pi * 0.5, pi, pi * 1.5), start=1):
        x_value, z_value = 0.32 * cos(angle), 0.32 * sin(angle)
        rod(f"Airship_PropellerBlade_{index}", (0.0, 1.68, 0.16),
            (x_value, 1.68, 0.16 + z_value), 0.035, wood, 28)
    box("Airship_TailFinTop", (0.055, 0.34, 0.28), (0.0, 1.39, 0.72), canvas, 0.025)
    box("Airship_TailFinLeft", (0.30, 0.34, 0.055), (-0.17, 1.39, 0.42), canvas, 0.025)
    box("Airship_TailFinRight", (0.30, 0.34, 0.055), (0.17, 1.39, 0.42), canvas, 0.025)
    root_and_export("steampunk_airship_v3", "steampunk_airship.glb",
                    "envelope-centre-y=0.50", "1.12 x 2.30 x 1.40", "large-body")


def build_cyberpunk_motorcycle():
    clear_scene()
    tyre = material("MotorcycleV3_Tyre", (0.012, 0.015, 0.020), 0.18, 0.86)
    frame = material("MotorcycleV3_Frame", (0.055, 0.075, 0.10), 0.90, 0.23)
    red = material("MotorcycleV3_CandyRed", (0.68, 0.018, 0.045), 0.76, 0.20)
    seat = material("MotorcycleV3_Seat", (0.018, 0.022, 0.030), 0.04, 0.82)
    glow = material("MotorcycleV3_WheelGlow", (0.04, 0.36, 0.72), 0.14, 0.10,
                    (0.0, 0.65, 1.0, 1.0), 4.2)
    alloy = material("MotorcycleV3_Alloy", (0.36, 0.42, 0.48), 0.92, 0.19)

    for side, y_value in (("Front", -0.68), ("Rear", 0.68)):
        torus(f"Motorcycle_{side}Tyre", 0.30, 0.065, (0.0, y_value, 0.32), tyre,
              (0.0, pi * 0.5, 0.0), 56, 14)
        torus(f"Motorcycle_{side}NeonRim", 0.235, 0.016, (0.0, y_value, 0.32), glow,
              (0.0, pi * 0.5, 0.0), 48, 10)
        cylinder(f"Motorcycle_{side}Hub", 0.105, 0.16, (0.0, y_value, 0.32), alloy,
                 40, 0.008, (0.0, pi * 0.5, 0.0))
        for spoke_index, angle in enumerate((0.0, pi * 0.25, pi * 0.5, pi * 0.75), start=1):
            y_offset, z_offset = 0.19 * cos(angle), 0.19 * sin(angle)
            rod(f"Motorcycle_{side}Spoke_{spoke_index}",
                (0.0, y_value - y_offset, 0.32 - z_offset),
                (0.0, y_value + y_offset, 0.32 + z_offset), 0.010, alloy, 18)
    sphere("Motorcycle_FuelTank", 0.30, (0.0, -0.05, 0.67), red, 48, 24,
           (0.74, 1.15, 0.62))
    box("Motorcycle_RiderSeat", (0.40, 0.55, 0.095), (0.0, 0.36, 0.68), seat, 0.035,
        (-0.09, 0.0, 0.0))
    box("Motorcycle_TailCowl", (0.38, 0.38, 0.18), (0.0, 0.68, 0.71), red, 0.055)
    box("Motorcycle_EngineBlock", (0.42, 0.48, 0.34), (0.0, 0.08, 0.38), frame, 0.045)
    for index, x_value in enumerate((-0.13, 0.13), start=1):
        cylinder(f"Motorcycle_EngineCylinder_{index}", 0.095, 0.30,
                 (x_value, 0.03, 0.40), alloy, 36, 0.007, (0.0, pi * 0.5, 0.0))
    rod("Motorcycle_FrameTop", (0.0, -0.48, 0.48), (0.0, 0.48, 0.64), 0.034, frame, 32)
    rod("Motorcycle_FrameLower", (0.0, -0.40, 0.35), (0.0, 0.48, 0.30), 0.034, frame, 32)
    rod("Motorcycle_FrontForkLeft", (-0.10, -0.25, 0.72), (-0.10, -0.68, 0.32), 0.025, alloy, 28)
    rod("Motorcycle_FrontForkRight", (0.10, -0.25, 0.72), (0.10, -0.68, 0.32), 0.025, alloy, 28)
    rod("Motorcycle_Handlebar", (-0.34, -0.32, 0.84), (0.34, -0.32, 0.84), 0.022, alloy, 28)
    sphere("Motorcycle_Headlamp", 0.095, (0.0, -0.51, 0.69), glow, 36, 18,
           (1.0, 0.42, 0.72))
    box("Motorcycle_Exhaust", (0.10, 0.72, 0.10), (0.27, 0.28, 0.26), alloy, 0.025)
    root_and_export("cyberpunk_motorcycle_v3", "cyberpunk_motorcycle.glb",
                    "floor-centre-seat-y-up=0.68", "0.78 x 2.10 x 0.93", "large-body")


# -- final handheld, environment, and headwear builders ---------------------


def build_scifi_laser_gun():
    clear_scene()
    metal = material("LaserGunV3_Gunmetal", (0.055, 0.085, 0.12), 0.90, 0.20)
    polymer = material("LaserGunV3_GripPolymer", (0.018, 0.026, 0.038), 0.08, 0.80)
    alloy = material("LaserGunV3_Alloy", (0.34, 0.42, 0.50), 0.88, 0.22)
    plasma = material("LaserGunV3_Plasma", (0.03, 0.52, 0.78), 0.10, 0.08,
                      (0.0, 0.85, 1.0, 1.0), 5.2)
    warning = material("LaserGunV3_Warning", (0.94, 0.18, 0.02), 0.30, 0.28,
                       (1.0, 0.06, 0.01, 1.0), 1.8)

    box("LaserGun_MainReceiver", (0.18, 0.62, 0.20), (0.0, 0.31, 0.04), metal, 0.030)
    box("LaserGun_RearBattery", (0.22, 0.28, 0.24), (0.0, -0.13, 0.03), alloy, 0.040)
    cylinder("LaserGun_BarrelShroud", 0.060, 0.76, (0.0, 0.94, 0.04), metal, 40, 0.006,
             (pi * 0.5, 0.0, 0.0))
    cylinder("LaserGun_PlasmaCore", 0.027, 0.82, (0.0, 0.94, 0.04), plasma, 36, 0.004,
             (pi * 0.5, 0.0, 0.0))
    for index, y_value in enumerate((0.62, 0.80, 0.98, 1.16, 1.34), start=1):
        torus(f"LaserGun_FieldCoil_{index}", 0.068, 0.009, (0.0, y_value, 0.04),
              alloy if index % 2 else plasma, (pi * 0.5, 0.0, 0.0), 36, 8)
    cylinder("LaserGun_Muzzle", 0.090, 0.18, (0.0, 1.40, 0.04), alloy, 40, 0.008,
             (pi * 0.5, 0.0, 0.0))
    torus("LaserGun_MuzzleGlow", 0.072, 0.012, (0.0, 1.50, 0.04), plasma,
          (pi * 0.5, 0.0, 0.0), 44, 10)
    box("LaserGun_PistolGrip", (0.13, 0.19, 0.32), (0.0, 0.10, -0.20), polymer, 0.032,
        (-0.30, 0.0, 0.0))
    box("LaserGun_TriggerGuard", (0.10, 0.17, 0.035), (0.0, 0.24, -0.095), alloy, 0.012)
    box("LaserGun_TopSightRail", (0.11, 0.50, 0.035), (0.0, 0.43, 0.165), alloy, 0.009)
    sphere("LaserGun_TargetSensor", 0.052, (0.0, 0.31, 0.205), warning, 32, 16,
           (1.0, 0.42, 0.72))
    for side, x_value in (("Left", -0.13), ("Right", 0.13)):
        box(f"LaserGun_{side}CoolingFin", (0.045, 0.48, 0.14),
            (x_value, 0.74, 0.04), metal, 0.014)
        box(f"LaserGun_{side}GlowStrip", (0.010, 0.38, 0.025),
            (x_value + (0.025 if side == "Left" else -0.025), 0.74, 0.04), plasma, 0.004)
    root_and_export("scifi_laser_gun_v3", "scifi_laser_gun.glb",
                    "pistol-grip-y=0.05", "0.32 x 1.65 x 0.58", "handheld")


def build_magic_grimoire():
    clear_scene()
    leather = material("GrimoireV3_Leather", (0.24, 0.030, 0.055), 0.03, 0.70)
    pages = material("GrimoireV3_Pages", (0.72, 0.61, 0.43), 0.0, 0.88)
    gold = material("GrimoireV3_Gold", (0.74, 0.43, 0.08), 0.88, 0.24)
    rune = material("GrimoireV3_RuneGlow", (0.32, 0.07, 0.72), 0.10, 0.10,
                    (0.62, 0.12, 1.0, 1.0), 4.8)
    gem = material("GrimoireV3_SoulGem", (0.05, 0.48, 0.78), 0.08, 0.06,
                   (0.02, 0.72, 1.0, 1.0), 3.6, 0.88, 0.20)

    box("Grimoire_PageBlock", (0.34, 0.48, 0.075), (0.0, 0.0, 0.0), pages, 0.018)
    box("Grimoire_FrontCover", (0.38, 0.52, 0.035), (0.0, 0.0, 0.057), leather, 0.022)
    box("Grimoire_BackCover", (0.38, 0.52, 0.035), (0.0, 0.0, -0.057), leather, 0.022)
    box("Grimoire_Spine", (0.055, 0.54, 0.13), (-0.19, 0.0, 0.0), leather, 0.025)
    for index, y_value in enumerate((-0.18, -0.06, 0.06, 0.18), start=1):
        torus(f"Grimoire_SpineBand_{index}", 0.071, 0.007, (-0.19, y_value, 0.0), gold,
              (0.0, pi * 0.5, 0.0), 32, 8)
    torus("Grimoire_CoverRuneOuter", 0.115, 0.010, (0.025, 0.0, 0.080), gold,
          major_segments=48, minor_segments=10)
    torus("Grimoire_CoverRuneInner", 0.075, 0.008, (0.025, 0.0, 0.083), rune,
          major_segments=44, minor_segments=8)
    ico("Grimoire_CentreGem", 0.045, (0.025, 0.0, 0.102), gem, 3,
        (1.0, 1.0, 0.45))
    for index, angle in enumerate((pi * 0.25, pi * 0.75, pi * 1.25, pi * 1.75), start=1):
        x_value, y_value = 0.145 * cos(angle) + 0.025, 0.145 * sin(angle)
        box(f"Grimoire_RuneRay_{index}", (0.015, 0.070, 0.009),
            (x_value, y_value, 0.085), rune, 0.003, (0.0, 0.0, -angle))
    for corner_index, (x_value, y_value) in enumerate(((-0.15, -0.22), (0.15, -0.22),
                                                       (-0.15, 0.22), (0.15, 0.22)), start=1):
        box(f"Grimoire_CornerGuard_{corner_index}", (0.075, 0.075, 0.018),
            (x_value, y_value, 0.083), gold, 0.012)
    box("Grimoire_Clasp", (0.075, 0.12, 0.06), (0.20, 0.0, 0.0), gold, 0.014)
    root_and_export("magic_grimoire_v3", "magic_grimoire.glb", "book-centre-left-hand",
                    "0.46 x 0.56 x 0.15", "handheld")


def build_medieval_shield():
    clear_scene()
    iron = material("MedievalShieldV3_Iron", (0.24, 0.29, 0.35), 0.90, 0.30)
    wood = material("MedievalShieldV3_Oak", (0.30, 0.105, 0.025), 0.04, 0.72)
    crest = material("MedievalShieldV3_CrimsonCrest", (0.58, 0.025, 0.035), 0.18, 0.42)
    brass = material("MedievalShieldV3_Brass", (0.65, 0.36, 0.06), 0.86, 0.26)
    leather = material("MedievalShieldV3_LeatherGrip", (0.065, 0.020, 0.012), 0.02, 0.86)

    cylinder("MedievalShield_WoodCore", 0.36, 0.050, (0.0, 0.0, 0.0), wood, 64, 0.007,
             (pi * 0.5, 0.0, 0.0), (1.0, 1.38, 1.0))
    cylinder("MedievalShield_IronFace", 0.33, 0.055, (0.0, -0.030, 0.0), iron, 64, 0.006,
             (pi * 0.5, 0.0, 0.0), (1.0, 1.38, 1.0))
    rim = torus("MedievalShield_OuterRim", 0.345, 0.020, (0.0, -0.062, 0.0), brass,
                (pi * 0.5, 0.0, 0.0), 56, 12)
    rim.scale = (1.0, 1.38, 1.0)
    bpy.context.view_layer.objects.active = rim
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    sphere("MedievalShield_Boss", 0.120, (0.0, -0.078, 0.0), brass, 40, 20,
           (1.0, 0.36, 1.0))
    box("MedievalShield_CrestVertical", (0.075, 0.025, 0.70),
        (0.0, -0.081, 0.0), crest, 0.014)
    box("MedievalShield_CrestHorizontal", (0.52, 0.025, 0.075),
        (0.0, -0.081, 0.03), crest, 0.014)
    for index, angle in enumerate((0.0, pi * 0.25, pi * 0.5, pi * 0.75,
                                   pi, pi * 1.25, pi * 1.5, pi * 1.75), start=1):
        sphere(f"MedievalShield_Rivet_{index}", 0.018,
               (0.275 * cos(angle), -0.082, 0.38 * sin(angle)), brass, 20, 10)
    box("MedievalShield_BackHandle", (0.055, 0.10, 0.30), (0.0, 0.075, 0.0), leather, 0.016)
    box("MedievalShield_BackBrace", (0.48, 0.045, 0.055), (0.0, 0.055, 0.0), iron, 0.012)
    root_and_export("medieval_shield_v3", "medieval_shield.glb",
                    "back-handle-centre-face-xz", "0.76 x 0.20 x 1.04", "handheld")


def build_street_lamp():
    clear_scene()
    iron = material("StreetLampV3_Iron", (0.045, 0.060, 0.080), 0.88, 0.34)
    brass = material("StreetLampV3_Brass", (0.58, 0.31, 0.055), 0.86, 0.28)
    glass = material("StreetLampV3_Glass", (0.40, 0.55, 0.62), 0.04, 0.08,
                     None, 0.0, 0.32, 0.48)
    light = material("StreetLampV3_WarmLight", (0.95, 0.68, 0.30), 0.02, 0.12,
                     (1.0, 0.58, 0.20, 1.0), 6.0)
    stone = material("StreetLampV3_BaseStone", (0.16, 0.18, 0.21), 0.04, 0.76)

    cylinder("StreetLamp_StonePlinth", 0.29, 0.16, (0.0, 0.0, 0.08), stone, 56, 0.018)
    cylinder("StreetLamp_IronBase", 0.20, 0.28, (0.0, 0.0, 0.28), iron, 48, 0.012)
    cone("StreetLamp_BaseTaper", 0.15, 0.065, 0.42, (0.0, 0.0, 0.61), iron, 48, edge=0.008)
    cylinder("StreetLamp_MainPole", 0.055, 2.20, (0.0, 0.0, 1.91), iron, 48, 0.007)
    for index, z_value in enumerate((0.50, 0.82, 1.10, 2.68, 2.92), start=1):
        torus(f"StreetLamp_PoleCollar_{index}", 0.072, 0.012,
              (0.0, 0.0, z_value), brass, major_segments=40, minor_segments=8)
    for side, x_value in (("Left", -0.45), ("Right", 0.45)):
        rod(f"StreetLamp_{side}Arm", (0.0, 0.0, 2.82), (x_value, 0.0, 3.05),
            0.035, iron, 32)
        torus(f"StreetLamp_{side}ArmScroll", 0.12, 0.016,
              (x_value * 0.48, 0.0, 2.82), brass, (pi * 0.5, 0.0, 0.0), 40, 8)
        cylinder(f"StreetLamp_{side}LanternCap", 0.19, 0.065,
                 (x_value, 0.0, 3.06), brass, 48, 0.007)
        sphere(f"StreetLamp_{side}GlassGlobe", 0.18, (x_value, 0.0, 2.87), glass,
               48, 24, (0.88, 0.88, 1.10))
        sphere(f"StreetLamp_{side}LightCore", 0.095, (x_value, 0.0, 2.87), light,
               36, 18, (0.80, 0.80, 1.0))
        cone(f"StreetLamp_{side}Finial", 0.075, 0.0, 0.16,
             (x_value, 0.0, 3.17), brass, 32)
    cylinder("StreetLamp_TopCrown", 0.11, 0.08, (0.0, 0.0, 3.03), brass, 40, 0.006)
    cone("StreetLamp_TopSpear", 0.08, 0.0, 0.28, (0.0, 0.0, 3.20), brass, 36)
    root_and_export("street_lamp_v3", "street_lamp.glb", "floor-centre-base",
                    "1.30 x 0.58 x 3.34", "large-body")


def build_royal_throne():
    clear_scene()
    gold = material("ThroneV3_RoyalGold", (0.70, 0.40, 0.07), 0.90, 0.23)
    velvet = material("ThroneV3_CrimsonVelvet", (0.44, 0.012, 0.035), 0.04, 0.82)
    wood = material("ThroneV3_DarkWood", (0.16, 0.040, 0.012), 0.04, 0.68)
    jewel = material("ThroneV3_Ruby", (0.65, 0.015, 0.035), 0.10, 0.08,
                     (0.90, 0.015, 0.025, 1.0), 2.4, 0.90, 0.18)
    trim = material("ThroneV3_BlackTrim", (0.028, 0.032, 0.042), 0.68, 0.30)

    box("Throne_BasePlinth", (1.08, 0.92, 0.16), (0.0, 0.0, 0.08), wood, 0.035)
    box("Throne_SeatFrame", (0.82, 0.74, 0.20), (0.0, 0.0, 0.40), gold, 0.040)
    box("Throne_SeatCushion", (0.70, 0.62, 0.18), (0.0, -0.03, 0.54), velvet, 0.060)
    box("Throne_BackFrame", (0.84, 0.16, 1.42), (0.0, 0.29, 1.25), gold, 0.055)
    box("Throne_BackCushion", (0.66, 0.11, 1.08), (0.0, 0.18, 1.24), velvet, 0.075)
    box("Throne_BackCentreTrim", (0.10, 0.035, 1.00), (0.0, 0.105, 1.24), trim, 0.022)
    for side, x_value in (("Left", -0.49), ("Right", 0.49)):
        box(f"Throne_{side}ArmSupport", (0.18, 0.72, 0.58),
            (x_value, 0.0, 0.63), gold, 0.050)
        box(f"Throne_{side}ArmCushion", (0.15, 0.58, 0.10),
            (x_value, -0.03, 0.94), velvet, 0.045)
        cylinder(f"Throne_{side}FrontColumn", 0.095, 0.82,
                 (x_value, -0.31, 0.49), gold, 40, 0.009)
        cylinder(f"Throne_{side}BackColumn", 0.095, 1.74,
                 (x_value, 0.30, 1.03), gold, 40, 0.009)
        for index, z_value in enumerate((0.14, 0.88, 1.82), start=1):
            torus(f"Throne_{side}ColumnRing_{index}", 0.105, 0.014,
                  (x_value, 0.30 if z_value > 1.0 else -0.31, z_value),
                  trim, major_segments=40, minor_segments=8)
        sphere(f"Throne_{side}Finial", 0.125, (x_value, 0.30, 2.02), gold, 32, 16)
        ico(f"Throne_{side}FinialJewel", 0.052, (x_value, 0.30, 2.07), jewel, 2)
    torus("Throne_CrownArch", 0.36, 0.035, (0.0, 0.28, 1.82), gold,
          (pi * 0.5, 0.0, 0.0), 48, 10)
    ico("Throne_CrownJewel", 0.10, (0.0, 0.20, 1.91), jewel, 3,
        (0.82, 0.46, 1.12))
    for index, x_value in enumerate((-0.28, -0.14, 0.0, 0.14, 0.28), start=1):
        cone(f"Throne_CrownSpike_{index}", 0.055, 0.0,
             0.24 + 0.08 * (1.0 - abs(x_value) / 0.28),
             (x_value, 0.28, 2.03), gold, 28)
    root_and_export("royal_throne_v3", "royal_throne.glb",
                    "floor-centre-seat-y-up=0.54", "1.20 x 1.00 x 2.22", "large-body")


def build_crystal_orb():
    clear_scene()
    base = material("CrystalOrbV3_ObsidianBase", (0.035, 0.025, 0.060), 0.64, 0.28)
    gold = material("CrystalOrbV3_GoldFiligree", (0.70, 0.40, 0.07), 0.90, 0.22)
    glass = material("CrystalOrbV3_OrbGlass", (0.10, 0.36, 0.72), 0.05, 0.05,
                     (0.12, 0.48, 1.0, 1.0), 2.5, 0.52, 0.46)
    core = material("CrystalOrbV3_CoreGlow", (0.42, 0.10, 0.80), 0.04, 0.08,
                    (0.65, 0.12, 1.0, 1.0), 5.4, 0.80)
    rune = material("CrystalOrbV3_Rune", (0.02, 0.58, 0.78), 0.10, 0.10,
                    (0.0, 0.82, 1.0, 1.0), 4.0)

    cylinder("CrystalOrb_Base", 0.15, 0.075, (0.0, 0.0, 0.0375), base, 48, 0.010)
    cone("CrystalOrb_Pedestal", 0.13, 0.085, 0.15, (0.0, 0.0, 0.145), gold, 40, edge=0.006)
    torus("CrystalOrb_CradleRing", 0.115, 0.016, (0.0, 0.0, 0.22), gold,
          major_segments=48, minor_segments=10)
    sphere("CrystalOrb_OuterGlass", 0.185, (0.0, 0.0, 0.37), glass, 64, 32)
    ico("CrystalOrb_InnerCore", 0.085, (0.0, 0.0, 0.37), core, 3)
    torus("CrystalOrb_OrbitA", 0.225, 0.008, (0.0, 0.0, 0.37), gold,
          (0.35, 0.72, 0.0), 48, 8)
    torus("CrystalOrb_OrbitB", 0.225, 0.008, (0.0, 0.0, 0.37), rune,
          (-0.65, 0.24, 0.30), 48, 8)
    for index, angle in enumerate((0.0, pi * 0.5, pi, pi * 1.5), start=1):
        ico(f"CrystalOrb_Satellite_{index}", 0.028,
            (0.25 * cos(angle), 0.25 * sin(angle), 0.37), rune, 2)
    root_and_export("crystal_orb_v3", "crystal_orb.glb", "pedestal-centre-hand-pinch",
                    "0.54 x 0.54 x 0.59", "handheld")


def build_tactical_helmet():
    clear_scene()
    shell = material("HelmetV3_CompositeShell", (0.045, 0.065, 0.080), 0.66, 0.38)
    armour = material("HelmetV3_ArmourPlate", (0.12, 0.16, 0.20), 0.82, 0.28)
    visor = material("HelmetV3_AmberVisor", (0.76, 0.16, 0.02), 0.12, 0.06,
                     (1.0, 0.20, 0.01, 1.0), 2.8, 0.38, 0.42)
    padding = material("HelmetV3_Padding", (0.018, 0.024, 0.030), 0.02, 0.88)
    signal = material("HelmetV3_Signal", (0.02, 0.52, 0.70), 0.12, 0.10,
                      (0.0, 0.78, 1.0, 1.0), 3.6)
    hardware = material("HelmetV3_Hardware", (0.34, 0.40, 0.46), 0.90, 0.22)

    sphere("Helmet_MainShell", 0.19, (0.0, 0.025, 0.015), shell, 56, 28,
           (1.0, 1.08, 0.92))
    sphere("Helmet_FrontVisor", 0.175, (0.0, -0.105, -0.005), visor, 48, 24,
           (0.92, 0.28, 0.44))
    box("Helmet_BrowArmour", (0.30, 0.075, 0.060), (0.0, -0.125, 0.085), armour, 0.020)
    box("Helmet_TopRail", (0.10, 0.25, 0.045), (0.0, 0.005, 0.185), hardware, 0.014)
    for index, y_value in enumerate((-0.08, -0.01, 0.06, 0.13), start=1):
        box(f"Helmet_TopRailSlot_{index}", (0.075, 0.030, 0.018),
            (0.0, y_value, 0.212), padding, 0.005)
    for side, x_value in (("Left", -0.185), ("Right", 0.185)):
        box(f"Helmet_{side}SidePlate", (0.075, 0.18, 0.18),
            (x_value, 0.015, -0.035), armour, 0.030)
        cylinder(f"Helmet_{side}EarModule", 0.055, 0.045, (x_value, 0.010, -0.025),
                 hardware, 36, 0.006, (0.0, pi * 0.5, 0.0))
        torus(f"Helmet_{side}EarLight", 0.045, 0.008,
              (x_value + (-0.027 if side == "Left" else 0.027), 0.010, -0.025), signal,
              (0.0, pi * 0.5, 0.0), 36, 8)
        rod(f"Helmet_{side}JawRail", (x_value, -0.02, -0.07),
            (x_value * 0.72, -0.145, -0.15), 0.014, hardware, 22)
        box(f"Helmet_{side}JawPad", (0.060, 0.10, 0.09),
            (x_value * 0.72, -0.145, -0.16), padding, 0.020)
    box("Helmet_RearBattery", (0.22, 0.10, 0.105), (0.0, 0.205, 0.01), armour, 0.025)
    box("Helmet_RearSignal", (0.13, 0.015, 0.026), (0.0, 0.263, 0.02), signal, 0.006)
    cylinder("Helmet_CameraHousing", 0.040, 0.095, (0.085, -0.16, 0.12), hardware,
             32, 0.005, (pi * 0.5, 0.0, 0.0))
    sphere("Helmet_CameraLens", 0.032, (0.085, -0.213, 0.12), signal, 28, 14,
           (1.0, 0.35, 1.0))
    root_and_export("tactical_helmet_v3", "tactical_helmet.glb",
                    "head-centre-face-negative-y", "0.43 x 0.48 x 0.43", "headwear")


def generate_mapped_props_pack_v3():
    builders = {
        "cyber_katana_v3": build_cyber_katana,
        "magic_staff_crystal_v3": build_magic_staff,
        "scifi_drone_bot_v3": build_scifi_drone,
        "neon_bench_prop_v3": build_neon_bench,
        "cyber_helmet_visor_v3": build_cyber_visor,
        "hologram_tablet_v3": build_hologram_tablet,
        "ancient_rune_shield_v3": build_ancient_rune_shield,
        "arcade_game_cabinet_v3": build_arcade_cabinet,
        "medieval_greatsword_v3": build_medieval_greatsword,
        "cyberpunk_hoverbike_v3": build_cyber_hoverbike,
        "cyber_sniper_rifle_v3": build_cyber_sniper_rifle,
        "fantasy_magic_wand_staff_v3": build_magic_wand_staff,
        "steampunk_airship_v3": build_steampunk_airship,
        "cyberpunk_motorcycle_v3": build_cyberpunk_motorcycle,
        "scifi_laser_gun_v3": build_scifi_laser_gun,
        "magic_grimoire_v3": build_magic_grimoire,
        "medieval_shield_v3": build_medieval_shield,
        "street_lamp_v3": build_street_lamp,
        "royal_throne_v3": build_royal_throne,
        "crystal_orb_v3": build_crystal_orb,
        "tactical_helmet_v3": build_tactical_helmet,
    }
    for asset_id, _filename in ASSETS:
        builders[asset_id]()
    print("Generated all 21 ToonSpectrum mapped prop v3 assets.")


def render_preview(filename, output_path, view_direction=(1.6, -2.2, 1.4)):
    """Import one generated GLB and render a neutral QA preview without MCP reset."""
    clear_scene()
    bpy.ops.import_scene.gltf(filepath=f"{OUTPUT_DIRECTORY}/{filename}")
    bpy.context.view_layer.update()
    mesh_objects = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    if not mesh_objects:
        raise RuntimeError(f"No mesh objects found in {filename}")
    points = [obj.matrix_world @ Vector(corner) for obj in mesh_objects for corner in obj.bound_box]
    minimum = Vector((
        min(point.x for point in points),
        min(point.y for point in points),
        min(point.z for point in points),
    ))
    maximum = Vector((
        max(point.x for point in points),
        max(point.y for point in points),
        max(point.z for point in points),
    ))
    centre = (minimum + maximum) * 0.5
    extent = max(maximum.x - minimum.x, maximum.y - minimum.y, maximum.z - minimum.z, 0.25)

    floor_mat = material("PreviewFloor", (0.045, 0.055, 0.070), 0.05, 0.74)
    bpy.ops.mesh.primitive_plane_add(size=extent * 4.5, location=(centre.x, centre.y, minimum.z - 0.012))
    floor = bpy.context.active_object
    floor.name = "Preview_Ground"
    assign(floor, floor_mat)

    bpy.ops.object.camera_add()
    camera = bpy.context.active_object
    camera.name = "Preview_Camera"
    camera.location = centre + Vector(view_direction) * extent
    camera.rotation_euler = (centre - camera.location).to_track_quat("-Z", "Y").to_euler()
    camera.data.lens = 58
    bpy.context.scene.camera = camera

    light_specs = (
        ("Preview_Key", (1.8, -1.6, 2.6), 450.0, extent * 1.5),
        ("Preview_Fill", (-1.8, -0.5, 1.2), 220.0, extent * 1.8),
        ("Preview_Rim", (0.6, 2.0, 2.1), 320.0, extent * 1.2),
    )
    for name, offset, energy, size in light_specs:
        bpy.ops.object.light_add(type="AREA", location=centre + Vector(offset) * extent)
        lamp = bpy.context.active_object
        lamp.name = name
        lamp.data.energy = energy * extent * extent
        lamp.data.shape = "DISK"
        lamp.data.size = size
        lamp.rotation_euler = (centre - lamp.location).to_track_quat("-Z", "Y").to_euler()

    world = bpy.context.scene.world or bpy.data.worlds.new("PreviewWorld")
    bpy.context.scene.world = world
    world.use_nodes = True
    background = world.node_tree.nodes.get("Background")
    if background is not None:
        background.inputs["Color"].default_value = (0.010, 0.014, 0.024, 1.0)
        background.inputs["Strength"].default_value = 0.12

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 640
    scene.render.resolution_y = 640
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.render.filepath = output_path
    for look in ("AgX - Medium High Contrast", "Medium High Contrast"):
        try:
            scene.view_settings.look = look
            break
        except TypeError:
            continue
    bpy.ops.render.render(write_still=True)
    print(f"Rendered {filename}: {output_path}")


if __name__ == "__main__":
    generate_mapped_props_pack_v3()
