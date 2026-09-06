"""Generate ToonSpectrum's second-generation story prop GLB pack.

The source is deliberately self-contained so it can run either from Blender's
command line or through Blender MCP ``execute_blender_code``.  It uses no
factory reset: clearing objects and orphaned local datablocks keeps the MCP
add-on/server alive between exports.

All measurements are metres.  Furniture and the wheelchair rest on Z=0;
hand/head props keep their useful attachment origin at world (0, 0, 0).  Every
GLB is first-party procedural geometry, contains its materials, and has no
external URI.
"""

import bpy
from math import cos, sin
from mathutils import Vector


OUTPUT_DIRECTORY = (
    bpy.context.scene.get("toonspectrum_story_props_output_dir")
    or bpy.path.abspath("//apps/web/public/assets/3d")
)
GENERATOR = "scripts/blender/generate_story_props_pack_v2.py"
CC0_LICENSE_URL = "https://creativecommons.org/publicdomain/zero/1.0/"
PI = 3.141592653589793


ASSETS = (
    ("school_desk_v2", "school_desk.glb"),
    ("vending_machine_v2", "vending_machine.glb"),
    ("fantasy_magic_chest_v2", "fantasy_magic_chest.glb"),
    ("modern_smartphone_prop_v2", "modern_smartphone_prop.glb"),
    ("cyber_glasses_v2", "cyber_glasses.glb"),
    ("adaptive_power_wheelchair", "adaptive_power_wheelchair.glb"),
)


def clear_scene():
    """Delete generated scene data without disabling Blender MCP add-ons."""
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    # Operator deletion skips hidden/select-disabled VRM helpers in a persistent
    # MCP session.  Removing every object datablock also unlinks those helpers,
    # while leaving preferences, extensions and the blend-ai server untouched.
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
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    scene.unit_settings.length_unit = "METERS"


def create_material( # NOSONAR python:S3776
    name,
    base_color,
    metallic=0.0,
    roughness=0.5,
    emission=None,
    emission_strength=0.0,
    alpha=1.0,
    transmission=0.0,
):
    material = bpy.data.materials.new(name=name)
    material.diffuse_color = (
        base_color[0],
        base_color[1],
        base_color[2],
        alpha,
    )
    material.use_nodes = True
    shader = material.node_tree.nodes.get("Principled BSDF")
    if shader is not None:
        shader.inputs["Base Color"].default_value = (
            base_color[0],
            base_color[1],
            base_color[2],
            alpha,
        )
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
    if alpha < 1.0 and hasattr(material, "surface_render_method"):
        material.surface_render_method = "DITHERED"
    material["toonspectrum_pbr"] = True
    return material


def assign_material(obj, material):
    obj.data.materials.clear()
    obj.data.materials.append(material)


def apply_bevel(obj, width, segments=3):
    if width <= 0.0:
        return
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    modifier = obj.modifiers.new(name="EdgeSoftening", type="BEVEL")
    modifier.width = width
    modifier.segments = segments
    modifier.limit_method = "ANGLE"
    bpy.ops.object.modifier_apply(modifier=modifier.name)


def add_box(name, dimensions, location, material, bevel=0.006, rotation=(0.0, 0.0, 0.0)):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=location)
    obj = bpy.context.active_object
    obj.name = name
    obj.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.rotation_euler = rotation
    assign_material(obj, material)
    apply_bevel(obj, min(bevel, min(dimensions) * 0.42))
    return obj


def add_cylinder(
    name,
    radius,
    depth,
    location,
    material,
    vertices=32,
    bevel=0.003,
    rotation=(0.0, 0.0, 0.0),
):
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices,
        radius=radius,
        depth=depth,
        location=location,
    )
    obj = bpy.context.active_object
    obj.name = name
    obj.rotation_euler = rotation
    assign_material(obj, material)
    apply_bevel(obj, min(bevel, radius * 0.32, depth * 0.20), segments=2)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    return obj


def add_sphere(name, radius, location, material, segments=32, rings=16, scale=(1.0, 1.0, 1.0)):
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
    assign_material(obj, material)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    return obj


def add_torus(
    name,
    major_radius,
    minor_radius,
    location,
    material,
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
    assign_material(obj, material)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    return obj


def add_rod(name, start, end, radius, material, vertices=24, bevel=0.002):
    start_vector = Vector(start)
    end_vector = Vector(end)
    direction = end_vector - start_vector
    obj = add_cylinder(
        name,
        radius,
        direction.length,
        (start_vector + end_vector) * 0.5,
        material,
        vertices=vertices,
        bevel=bevel,
    )
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = direction.to_track_quat("Z", "Y")
    return obj


def add_arch_shell(name, width, radius, centre_z, material, segments=16, thickness=0.035): # NOSONAR python:S3776
    """Create an extruded half-cylinder chest lid with a solid inner shell."""
    outer = radius
    inner = max(radius - thickness, 0.01)
    vertices = []
    faces = []
    for x_value in (-width * 0.5, width * 0.5):
        for ring_radius in (outer, inner):
            for index in range(segments + 1):
                angle = PI * index / segments
                vertices.append((
                    x_value,
                    ring_radius * cos(angle),
                    centre_z + ring_radius * sin(angle),
                ))
    # Index layout: x side -> radius ring -> arc index.
    arc_count = segments + 1
    def vi(x_side, ring, arc):
        return x_side * arc_count * 2 + ring * arc_count + arc

    for x_side in (0, 1):
        for index in range(segments):
            faces.append((vi(x_side, 0, index), vi(x_side, 0, index + 1),
                          vi(x_side, 1, index + 1), vi(x_side, 1, index)))
    for ring in (0, 1):
        for index in range(segments):
            if ring == 0:
                faces.append((vi(0, ring, index), vi(1, ring, index),
                              vi(1, ring, index + 1), vi(0, ring, index + 1)))
            else:
                faces.append((vi(0, ring, index + 1), vi(1, ring, index + 1),
                              vi(1, ring, index), vi(0, ring, index)))
    for arc in (0, segments):
        faces.append((vi(0, 0, arc), vi(0, 1, arc), vi(1, 1, arc), vi(1, 0, arc)))

    mesh = bpy.data.meshes.new(f"{name}Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    assign_material(obj, material)
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    return obj


def add_asset_root(asset_id, attachment_origin, nominal_dimensions):
    root = bpy.data.objects.new(f"TS_{asset_id}_Root", None)
    root.empty_display_type = "PLAIN_AXES"
    root["asset_id"] = asset_id
    root["asset_author"] = "ToonSpectrum"
    root["asset_generator"] = GENERATOR
    root["asset_license"] = "CC0-1.0"
    root["asset_license_url"] = CC0_LICENSE_URL
    root["units"] = "metres"
    root["attachment_origin"] = attachment_origin
    root["nominal_dimensions_m"] = nominal_dimensions
    bpy.context.scene.collection.objects.link(root)
    for obj in tuple(bpy.context.scene.objects):
        if obj is not root and obj.parent is None:
            obj.parent = root
    return root


def export_asset(asset_id, filename, attachment_origin, nominal_dimensions):
    add_asset_root(asset_id, attachment_origin, nominal_dimensions)
    destination = f"{OUTPUT_DIRECTORY}/{filename}"
    bpy.context.scene["toonspectrum_asset_id"] = asset_id
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


def build_school_desk():
    clear_scene()
    oak = create_material("DeskV2_OakTop", (0.55, 0.29, 0.105), roughness=0.42)
    oak_edge = create_material("DeskV2_DarkEdge", (0.16, 0.065, 0.022), roughness=0.50)
    steel = create_material("DeskV2_PowderSteel", (0.10, 0.135, 0.17), metallic=0.72, roughness=0.33)
    shelf = create_material("DeskV2_ShelfBlue", (0.08, 0.24, 0.38), metallic=0.18, roughness=0.48)
    rubber = create_material("DeskV2_RubberFeet", (0.015, 0.018, 0.022), roughness=0.88)

    add_box("Desktop_Oak", (1.10, 0.65, 0.055), (0.0, 0.0, 0.7325), oak, 0.022)
    add_box("Desktop_FrontEdge", (1.04, 0.035, 0.070), (0.0, -0.307, 0.715), oak_edge, 0.010)
    add_box("Desktop_BackEdge", (1.04, 0.030, 0.060), (0.0, 0.31, 0.720), oak_edge, 0.009)
    add_box("BookShelf_Base", (0.88, 0.43, 0.028), (0.0, 0.025, 0.535), shelf, 0.008)
    add_box("BookShelf_Back", (0.88, 0.025, 0.16), (0.0, 0.225, 0.61), shelf, 0.006)
    for side, x_value in (("Left", -0.425), ("Right", 0.425)):
        add_box(f"BookShelf_{side}Wall", (0.030, 0.43, 0.16), (x_value, 0.025, 0.61), shelf, 0.006)

    leg_positions = ((-0.47, -0.25), (0.47, -0.25), (-0.47, 0.25), (0.47, 0.25))
    for index, (x_value, y_value) in enumerate(leg_positions, start=1):
        add_box(f"SteelLeg_{index}", (0.046, 0.046, 0.70), (x_value, y_value, 0.35), steel, 0.008)
        add_box(f"RubberFoot_{index}", (0.065, 0.065, 0.028), (x_value, y_value, 0.014), rubber, 0.007)
    add_rod("LowerBrace_Left", (-0.47, -0.25, 0.18), (-0.47, 0.25, 0.18), 0.018, steel)
    add_rod("LowerBrace_Right", (0.47, -0.25, 0.18), (0.47, 0.25, 0.18), 0.018, steel)
    add_rod("RearCrossBrace", (-0.47, 0.25, 0.31), (0.47, 0.25, 0.31), 0.016, steel)
    add_rod("BagHook", (0.525, 0.18, 0.64), (0.525, 0.18, 0.54), 0.012, steel)
    add_sphere("BagHook_Stop", 0.018, (0.525, 0.18, 0.525), steel, 20, 10)
    export_asset("school_desk_v2", "school_desk.glb", "floor-centre", "1.10 x 0.65 x 0.76")


def build_vending_machine():
    clear_scene()
    navy = create_material("VendingV2_NavyEnamel", (0.035, 0.12, 0.24), metallic=0.36, roughness=0.34)
    trim = create_material("VendingV2_BrushedTrim", (0.34, 0.42, 0.49), metallic=0.78, roughness=0.28)
    glass = create_material("VendingV2_DisplayGlass", (0.18, 0.48, 0.65), roughness=0.08, alpha=0.32, transmission=0.45)
    glow = create_material("VendingV2_DisplayGlow", (0.02, 0.26, 0.50), roughness=0.24,
                           emission=(0.03, 0.58, 1.0, 1.0), emission_strength=3.2)
    red = create_material("VendingV2_RedCan", (0.72, 0.035, 0.025), metallic=0.25, roughness=0.31)
    yellow = create_material("VendingV2_YellowCan", (0.92, 0.56, 0.04), metallic=0.18, roughness=0.34)
    green = create_material("VendingV2_GreenBottle", (0.04, 0.52, 0.25), roughness=0.28)
    dark = create_material("VendingV2_ControlBlack", (0.012, 0.018, 0.028), metallic=0.15, roughness=0.55)
    white = create_material("VendingV2_LitLabel", (0.78, 0.90, 0.98), roughness=0.26,
                            emission=(0.68, 0.88, 1.0, 1.0), emission_strength=1.8)

    add_box("Cabinet_Main", (0.95, 0.70, 1.82), (0.0, 0.0, 0.94), navy, 0.045)
    add_box("Cabinet_TopCap", (0.89, 0.66, 0.085), (0.0, -0.005, 1.85), trim, 0.025)
    add_box("ProductBay_Backlight", (0.61, 0.035, 1.02), (-0.105, -0.356, 1.28), glow, 0.012)
    add_box("ProductBay_Glass", (0.64, 0.025, 1.05), (-0.105, -0.382, 1.28), glass, 0.012)
    add_box("ProductBay_LeftTrim", (0.035, 0.045, 1.10), (-0.44, -0.37, 1.28), trim, 0.008)
    add_box("ProductBay_RightTrim", (0.035, 0.045, 1.10), (0.23, -0.37, 1.28), trim, 0.008)
    add_box("ProductBay_TopTrim", (0.70, 0.045, 0.035), (-0.105, -0.37, 1.845), trim, 0.008)
    for row, z_value in enumerate((0.91, 1.20, 1.49, 1.74), start=1):
        add_box(f"ProductShelf_{row}", (0.59, 0.24, 0.022), (-0.105, -0.29, z_value - 0.105), trim, 0.005)
        for column, x_value in enumerate((-0.33, -0.18, -0.03, 0.12), start=1):
            material = (red, yellow, green)[(row + column) % 3]
            add_cylinder(
                f"Product_R{row}_C{column}",
                0.045,
                0.15,
                (x_value, -0.32, z_value),
                material,
                vertices=20,
                bevel=0.004,
            )
            add_box(f"SelectionLabel_R{row}_C{column}", (0.085, 0.012, 0.026),
                    (x_value, -0.386, z_value - 0.102), white, 0.004)

    add_box("ControlPanel", (0.18, 0.035, 0.65), (0.355, -0.37, 1.31), dark, 0.015)
    add_box("PriceDisplay", (0.13, 0.016, 0.075), (0.355, -0.392, 1.57), glow, 0.008)
    for row, z_value in enumerate((1.42, 1.34, 1.26, 1.18), start=1):
        for column, x_value in enumerate((0.325, 0.385), start=1):
            add_cylinder(f"Keypad_{row}_{column}", 0.014, 0.012, (x_value, -0.397, z_value),
                         white, vertices=16, bevel=0.002, rotation=(PI * 0.5, 0.0, 0.0))
    add_box("CoinSlot", (0.075, 0.015, 0.020), (0.355, -0.396, 1.04), trim, 0.003)
    add_cylinder("CardReader", 0.035, 0.014, (0.355, -0.397, 0.94), trim,
                 vertices=24, bevel=0.002, rotation=(PI * 0.5, 0.0, 0.0))
    add_box("DeliveryDoor", (0.42, 0.05, 0.20), (-0.13, -0.365, 0.39), dark, 0.018)
    add_box("DeliveryDoor_Handle", (0.15, 0.022, 0.025), (-0.13, -0.401, 0.43), trim, 0.005)
    for index, x_value in enumerate((-0.36, 0.36), start=1):
        add_box(f"LevellingFoot_{index}", (0.12, 0.50, 0.06), (x_value, 0.04, 0.03), dark, 0.014)
    export_asset("vending_machine_v2", "vending_machine.glb", "floor-centre", "0.95 x 0.70 x 1.90")


def build_magic_chest():
    clear_scene()
    wood = create_material("ChestV2_AncientWood", (0.29, 0.105, 0.035), roughness=0.66)
    wood_light = create_material("ChestV2_RaisedPlank", (0.50, 0.22, 0.055), roughness=0.56)
    gold = create_material("ChestV2_RuneGold", (0.75, 0.43, 0.08), metallic=0.88, roughness=0.24)
    iron = create_material("ChestV2_DarkIron", (0.045, 0.055, 0.070), metallic=0.82, roughness=0.30)
    rune = create_material("ChestV2_MagicRune", (0.08, 0.34, 0.75), roughness=0.20,
                           emission=(0.08, 0.55, 1.0, 1.0), emission_strength=4.5)
    gem = create_material("ChestV2_SoulGem", (0.20, 0.62, 1.0), roughness=0.08,
                          emission=(0.16, 0.66, 1.0, 1.0), emission_strength=3.3,
                          alpha=0.88, transmission=0.20)

    add_box("Chest_Base", (0.90, 0.58, 0.38), (0.0, 0.0, 0.215), wood, 0.025)
    for index, x_value in enumerate((-0.30, 0.0, 0.30), start=1):
        add_box(f"Front_RaisedPlank_{index}", (0.25, 0.028, 0.29),
                (x_value, -0.303, 0.23), wood_light, 0.012)
    add_box("Base_BottomBand", (0.94, 0.63, 0.055), (0.0, 0.0, 0.0275), iron, 0.012)
    add_box("Base_TopBand", (0.94, 0.63, 0.055), (0.0, 0.0, 0.405), gold, 0.012)
    add_box("Base_LeftBand", (0.055, 0.625, 0.41), (-0.42, 0.0, 0.215), iron, 0.010)
    add_box("Base_RightBand", (0.055, 0.625, 0.41), (0.42, 0.0, 0.215), iron, 0.010)
    add_arch_shell("Lid_ArchedWood", 0.90, 0.285, 0.405, wood_light, segments=20, thickness=0.052)
    for index, x_value in enumerate((-0.31, 0.0, 0.31), start=1):
        band = add_arch_shell(f"Lid_GoldBand_{index}", 0.040, 0.300, 0.405, gold,
                              segments=20, thickness=0.018)
        band.location.x = x_value
    add_box("Lock_Backplate", (0.19, 0.030, 0.22), (0.0, -0.322, 0.43), gold, 0.015)
    add_box("Lock_Body", (0.12, 0.060, 0.12), (0.0, -0.352, 0.38), iron, 0.015)
    add_cylinder("Lock_Rune", 0.030, 0.016, (0.0, -0.391, 0.39), rune,
                 vertices=32, bevel=0.003, rotation=(PI * 0.5, 0.0, 0.0))
    for index, x_value in enumerate((-0.25, 0.25), start=1):
        add_cylinder(f"Rear_Hinge_{index}", 0.035, 0.16, (x_value, 0.315, 0.42), iron,
                     vertices=24, bevel=0.004, rotation=(0.0, PI * 0.5, 0.0))
        add_sphere(f"Corner_SoulGem_{index}", 0.045, (x_value * 1.45, -0.325, 0.20), gem,
                   24, 12, scale=(0.75, 0.45, 1.0))
    for index, x_value in enumerate((-0.16, 0.0, 0.16), start=1):
        add_box(f"Front_RuneMark_{index}", (0.075, 0.012, 0.020),
                (x_value, -0.326, 0.105), rune, 0.004, rotation=(0.0, 0.0, (index - 2) * 0.35))
    export_asset("fantasy_magic_chest_v2", "fantasy_magic_chest.glb",
                 "floor-centre", "0.95 x 0.64 x 0.71")


def build_modern_smartphone():
    clear_scene()
    body = create_material("PhoneV2_AnodizedBody", (0.055, 0.065, 0.085), metallic=0.90, roughness=0.22)
    edge = create_material("PhoneV2_PolishedEdge", (0.24, 0.30, 0.38), metallic=0.93, roughness=0.14)
    screen = create_material("PhoneV2_OledScreen", (0.018, 0.055, 0.11), roughness=0.08,
                             emission=(0.03, 0.26, 0.72, 1.0), emission_strength=2.0)
    ui = create_material("PhoneV2_ScreenUI", (0.12, 0.70, 1.0), roughness=0.12,
                         emission=(0.10, 0.68, 1.0, 1.0), emission_strength=3.5)
    lens = create_material("PhoneV2_CameraGlass", (0.012, 0.018, 0.028), metallic=0.28, roughness=0.06,
                           alpha=0.94, transmission=0.25)
    flash = create_material("PhoneV2_Flash", (0.96, 0.84, 0.56), roughness=0.18,
                            emission=(1.0, 0.84, 0.50, 1.0), emission_strength=1.5)

    add_box("Phone_Chassis", (0.075, 0.009, 0.150), (0.0, 0.0, 0.0), body, 0.004)
    add_box("Phone_FrontEdge", (0.072, 0.002, 0.147), (0.0, -0.0052, 0.0), edge, 0.003)
    add_box("Phone_OLED", (0.068, 0.0012, 0.137), (0.0, -0.0068, 0.0), screen, 0.003)
    add_box("UI_Header", (0.052, 0.0008, 0.006), (0.0, -0.0076, 0.052), ui, 0.002)
    add_box("UI_Card_One", (0.052, 0.0008, 0.021), (0.0, -0.0076, 0.025), ui, 0.003)
    add_box("UI_Card_Two", (0.052, 0.0008, 0.021), (0.0, -0.0076, -0.004), ui, 0.003)
    add_box("UI_GestureBar", (0.025, 0.0008, 0.002), (0.0, -0.0076, -0.061), flash, 0.001)
    add_box("Rear_CameraIsland", (0.030, 0.0025, 0.040), (-0.018, 0.0060, 0.048), edge, 0.005)
    for index, (x_value, z_value) in enumerate(((-0.025, 0.057), (-0.011, 0.057), (-0.018, 0.040)), start=1):
        add_cylinder(f"CameraLens_{index}", 0.0056, 0.0028, (x_value, 0.0084, z_value), lens,
                     vertices=32, bevel=0.001, rotation=(PI * 0.5, 0.0, 0.0))
    add_cylinder("CameraFlash", 0.0030, 0.0025, (-0.029, 0.0083, 0.040), flash,
                 vertices=24, bevel=0.001, rotation=(PI * 0.5, 0.0, 0.0))
    add_box("PowerButton", (0.0022, 0.003, 0.022), (0.0382, 0.0, 0.016), edge, 0.001)
    add_box("VolumeUp", (0.0022, 0.003, 0.014), (-0.0382, 0.0, 0.026), edge, 0.001)
    add_box("VolumeDown", (0.0022, 0.003, 0.014), (-0.0382, 0.0, 0.006), edge, 0.001)
    add_box("SpeakerGrille", (0.020, 0.0012, 0.0015), (0.0, -0.0076, 0.066), edge, 0.0005)
    export_asset("modern_smartphone_prop_v2", "modern_smartphone_prop.glb",
                 "device-centre-hand-grip", "0.075 x 0.012 x 0.150")


def build_cyber_glasses():
    clear_scene()
    frame = create_material("GlassesV2_TitaniumFrame", (0.025, 0.035, 0.060), metallic=0.90, roughness=0.22)
    edge = create_material("GlassesV2_CyanEdge", (0.02, 0.42, 0.68), metallic=0.32, roughness=0.18,
                           emission=(0.0, 0.75, 1.0, 1.0), emission_strength=3.8)
    lens = create_material("GlassesV2_SmartLens", (0.03, 0.30, 0.46), roughness=0.06,
                           emission=(0.02, 0.38, 0.62, 1.0), emission_strength=0.65,
                           alpha=0.34, transmission=0.50)
    hologram = create_material("GlassesV2_HUD", (0.12, 0.82, 1.0), roughness=0.10,
                               emission=(0.05, 0.85, 1.0, 1.0), emission_strength=5.0,
                               alpha=0.72)
    hinge = create_material("GlassesV2_HingeSteel", (0.36, 0.42, 0.48), metallic=0.96, roughness=0.18)
    grip = create_material("GlassesV2_TempleGrip", (0.035, 0.045, 0.055), roughness=0.72)

    for side, x_value in (("Left", -0.081), ("Right", 0.081)):
        add_torus(f"{side}_LensRim", 0.054, 0.005, (x_value, 0.0, 0.0), frame,
                  rotation=(PI * 0.5, 0.0, 0.0), major_segments=40, minor_segments=8)
        add_box(f"{side}_SmartLens", (0.099, 0.003, 0.066), (x_value, 0.002, 0.0), lens, 0.012)
        add_box(f"{side}_HUD_Bar", (0.060, 0.0015, 0.003), (x_value, -0.0003, 0.010), hologram, 0.001)
        add_box(f"{side}_HUD_Cursor", (0.003, 0.0015, 0.025),
                (x_value + (0.012 if side == "Left" else -0.012), -0.0003, -0.006), hologram, 0.001)
        hinge_x = -0.145 if side == "Left" else 0.145
        add_cylinder(f"{side}_Hinge", 0.009, 0.018, (hinge_x, 0.010, 0.0), hinge,
                     vertices=24, bevel=0.002)
        end_x = -0.153 if side == "Left" else 0.153
        add_rod(f"{side}_TempleArm", (hinge_x, 0.014, 0.0), (end_x, 0.145, -0.010),
                0.0055, frame, vertices=20, bevel=0.0015)
        add_rod(f"{side}_TempleGrip", (end_x, 0.130, -0.010),
                (end_x * 0.98, 0.185, -0.033), 0.007, grip, vertices=20, bevel=0.0015)
    add_rod("NoseBridge", (-0.027, 0.0, 0.005), (0.027, 0.0, 0.005), 0.005, edge, vertices=24)
    add_rod("Left_NosePadArm", (-0.020, 0.006, -0.005), (-0.012, -0.015, -0.025),
            0.0025, hinge, vertices=16, bevel=0.0008)
    add_rod("Right_NosePadArm", (0.020, 0.006, -0.005), (0.012, -0.015, -0.025),
            0.0025, hinge, vertices=16, bevel=0.0008)
    add_sphere("Left_NosePad", 0.008, (-0.012, -0.018, -0.028), grip, 20, 10, (0.7, 0.35, 1.0))
    add_sphere("Right_NosePad", 0.008, (0.012, -0.018, -0.028), grip, 20, 10, (0.7, 0.35, 1.0))
    export_asset("cyber_glasses_v2", "cyber_glasses.glb", "bridge-centre-head-anchor",
                 "0.32 x 0.21 x 0.09")


def build_adaptive_power_wheelchair():
    clear_scene()
    frame = create_material("Wheelchair_FrameAlloy", (0.10, 0.16, 0.22), metallic=0.82, roughness=0.28)
    upholstery = create_material("Wheelchair_PressureSeat", (0.045, 0.18, 0.27), roughness=0.76)
    accent = create_material("Wheelchair_ArchitectOrange", (0.96, 0.32, 0.035), metallic=0.12, roughness=0.38)
    tyre = create_material("Wheelchair_NonMarkingTyre", (0.012, 0.015, 0.018), roughness=0.90)
    hub = create_material("Wheelchair_WheelHub", (0.38, 0.46, 0.52), metallic=0.88, roughness=0.24)
    control = create_material("Wheelchair_ControlHousing", (0.025, 0.030, 0.042), metallic=0.25, roughness=0.48)
    display = create_material("Wheelchair_JoystickDisplay", (0.03, 0.32, 0.62), roughness=0.14,
                              emission=(0.04, 0.58, 1.0, 1.0), emission_strength=3.0)

    # Large powered wheels: axes run along X, travel direction is -Y.
    for side, x_value in (("Left", -0.305), ("Right", 0.305)):
        add_torus(f"{side}_DriveTyre", 0.285, 0.025, (x_value, 0.13, 0.31), tyre,
                  rotation=(0.0, PI * 0.5, 0.0), major_segments=56, minor_segments=12)
        add_cylinder(f"{side}_DriveHub", 0.105, 0.052, (x_value, 0.13, 0.31), hub,
                     vertices=40, bevel=0.006, rotation=(0.0, PI * 0.5, 0.0))
        for spoke_index, angle in enumerate((0.0, PI * 0.25, PI * 0.5, PI * 0.75), start=1):
            y_offset = 0.17 * cos(angle)
            z_offset = 0.17 * sin(angle)
            add_rod(f"{side}_Spoke_{spoke_index}",
                    (x_value, 0.13 - y_offset, 0.31 - z_offset),
                    (x_value, 0.13 + y_offset, 0.31 + z_offset), 0.008, hub, vertices=16)
        add_box(f"{side}_MotorHousing", (0.070, 0.18, 0.14),
                (x_value, 0.13, 0.31), control, 0.022)

    # Chassis, pressure-relief seat and back support.
    add_box("BatteryPack", (0.42, 0.34, 0.16), (0.0, 0.08, 0.33), control, 0.025)
    add_box("SeatBaseFrame", (0.51, 0.47, 0.055), (0.0, 0.02, 0.495), frame, 0.012)
    add_box("PressureReliefSeat", (0.49, 0.45, 0.095), (0.0, -0.015, 0.5575), upholstery, 0.035)
    add_box("SeatCentreChannel", (0.045, 0.39, 0.012), (0.0, -0.035, 0.611), accent, 0.006)
    add_box("ErgonomicBackrest", (0.48, 0.095, 0.43), (0.0, 0.255, 0.795), upholstery, 0.045,
            rotation=(-0.10, 0.0, 0.0))
    add_box("LumbarSupport", (0.38, 0.035, 0.11), (0.0, 0.195, 0.705), accent, 0.022)
    for side, x_value in (("Left", -0.245), ("Right", 0.245)):
        add_rod(f"{side}_SeatRail", (x_value, -0.21, 0.49), (x_value, 0.25, 0.49),
                0.020, frame)
        add_rod(f"{side}_BackPost", (x_value, 0.24, 0.49), (x_value, 0.29, 0.99),
                0.018, frame)
        add_rod(f"{side}_PushHandle", (x_value, 0.28, 0.98),
                (x_value, 0.37, 1.025), 0.018, accent)
        add_rod(f"{side}_ArmPostFront", (x_value, -0.16, 0.58), (x_value, -0.16, 0.75),
                0.014, frame)
        add_rod(f"{side}_ArmPostRear", (x_value, 0.18, 0.58), (x_value, 0.18, 0.75),
                0.014, frame)
        add_box(f"{side}_ArmPad", (0.065, 0.39, 0.045), (x_value, 0.01, 0.77),
                upholstery, 0.018)

    # Front caster forks and anti-tip rear rollers.
    for side, x_value in (("Left", -0.205), ("Right", 0.205)):
        add_rod(f"{side}_CasterFork", (x_value, -0.31, 0.26), (x_value, -0.40, 0.11),
                0.016, frame)
        add_torus(f"{side}_FrontCaster", 0.064, 0.016, (x_value, -0.42, 0.080), tyre,
                  rotation=(0.0, PI * 0.5, 0.0), major_segments=32, minor_segments=8)
        add_cylinder(f"{side}_CasterHub", 0.025, 0.045, (x_value, -0.42, 0.080), hub,
                     vertices=24, bevel=0.004, rotation=(0.0, PI * 0.5, 0.0))
        add_rod(f"{side}_FootrestHanger", (x_value, -0.23, 0.47),
                (x_value, -0.43, 0.19), 0.016, frame)
        add_box(f"{side}_Footplate", (0.20, 0.18, 0.025),
                (x_value, -0.49, 0.145), frame, 0.012, rotation=(0.08, 0.0, 0.0))
        add_rod(f"{side}_AntiTip", (x_value, 0.30, 0.20), (x_value, 0.42, 0.10),
                0.012, frame)
        add_torus(f"{side}_AntiTipRoller", 0.028, 0.010, (x_value, 0.435, 0.075), tyre,
                  rotation=(0.0, PI * 0.5, 0.0), major_segments=24, minor_segments=8)

    # Right-hand proportional joystick with visible display and input controls.
    add_rod("Joystick_Mount", (0.245, -0.12, 0.75), (0.290, -0.25, 0.76), 0.014, frame)
    add_box("Joystick_Console", (0.075, 0.13, 0.045), (0.292, -0.285, 0.785), control, 0.014)
    add_box("Joystick_Display", (0.050, 0.055, 0.005), (0.292, -0.318, 0.810), display, 0.006,
            rotation=(0.22, 0.0, 0.0))
    add_rod("Joystick_Stick", (0.292, -0.292, 0.81), (0.292, -0.305, 0.865),
            0.009, accent, vertices=20)
    add_sphere("Joystick_Knob", 0.018, (0.292, -0.308, 0.875), accent, 24, 12)
    add_cylinder("Joystick_PowerButton", 0.010, 0.006, (0.270, -0.326, 0.810), display,
                 vertices=20, bevel=0.002, rotation=(PI * 0.5, 0.0, 0.0))
    export_asset("adaptive_power_wheelchair", "adaptive_power_wheelchair.glb",
                 "floor-centre-seat-facing-negative-y", "0.68 x 1.03 x 1.05")


def generate_story_props_pack_v2():
    builders = {
        "school_desk_v2": build_school_desk,
        "vending_machine_v2": build_vending_machine,
        "fantasy_magic_chest_v2": build_magic_chest,
        "modern_smartphone_prop_v2": build_modern_smartphone,
        "cyber_glasses_v2": build_cyber_glasses,
        "adaptive_power_wheelchair": build_adaptive_power_wheelchair,
    }
    for asset_id, _filename in ASSETS:
        builders[asset_id]()
    print("Generated all six ToonSpectrum story prop v2 assets.")


if __name__ == "__main__":
    generate_story_props_pack_v2()
