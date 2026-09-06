"""Generate ToonSpectrum's first-party core furniture pack as self-contained GLBs.

Run this file from the repository root in Blender 5.2 or execute its contents through
the Blender MCP sandbox. It intentionally uses only Blender's Python API for paths so
the same source works in the MCP sandbox without ``os`` or ``pathlib`` imports.

All dimensions are expressed in metres. Every asset is centred around the world
origin in X/Y and rests on the floor plane at Z=0 before Blender's glTF Y-up export.
"""

import bpy


OUTPUT_DIRECTORY = bpy.path.abspath("//apps/web/public/assets/3d")
ASSET_BUILDERS = (
    ("blackboard", "blackboard.glb"),
    ("desk", "desk.glb"),
    ("chair", "chair.glb"),
    ("round_table", "round_table.glb"),
    ("sofa", "sofa.glb"),
)


def reset_scene():
    """Start every export from an empty, metre-based scene."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    scene.unit_settings.length_unit = "METERS"


def create_material(name, base_color, metallic=0.0, roughness=0.5):
    material = bpy.data.materials.new(name=name)
    material.use_nodes = True
    principled = material.node_tree.nodes.get("Principled BSDF")
    if principled is not None:
        principled.inputs["Base Color"].default_value = base_color
        principled.inputs["Metallic"].default_value = metallic
        principled.inputs["Roughness"].default_value = roughness
    return material


def assign_material(obj, material):
    obj.data.materials.clear()
    obj.data.materials.append(material)


def apply_bevel(obj, width, segments=3):
    if width <= 0.0:
        return
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    modifier = obj.modifiers.new(name="EdgeSoftening", type="BEVEL")
    modifier.width = width
    modifier.segments = segments
    modifier.limit_method = "ANGLE"
    bpy.ops.object.modifier_apply(modifier=modifier.name)


def add_box(name, dimensions, location, material, bevel=0.01, rotation=(0.0, 0.0, 0.0)):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=location, rotation=rotation)
    obj = bpy.context.active_object
    obj.name = name
    obj.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    assign_material(obj, material)
    apply_bevel(obj, min(bevel, min(dimensions) * 0.45))
    return obj


def add_cylinder(
    name,
    radius,
    depth,
    location,
    material,
    vertices=48,
    bevel=0.008,
):
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices,
        radius=radius,
        depth=depth,
        location=location,
    )
    obj = bpy.context.active_object
    obj.name = name
    assign_material(obj, material)
    apply_bevel(obj, min(bevel, radius * 0.35, depth * 0.2))
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    return obj


def add_asset_root(asset_id):
    root = bpy.data.objects.new(f"TS_{asset_id}_Root", None)
    root.empty_display_type = "PLAIN_AXES"
    root["asset_id"] = asset_id
    root["asset_author"] = "ToonSpectrum"
    root["asset_source"] = "first-party procedural Blender geometry"
    root["units"] = "metres"
    root["floor_z"] = 0.0
    bpy.context.scene.collection.objects.link(root)
    for obj in tuple(bpy.context.scene.objects):
        if obj is not root and obj.parent is None:
            obj.parent = root
    return root


def export_asset(asset_id, filename):
    add_asset_root(asset_id)
    destination = f"{OUTPUT_DIRECTORY}/{filename}"
    bpy.context.scene["toonspectrum_asset_id"] = asset_id
    bpy.context.scene["toonspectrum_unit_scale_metres"] = 1.0
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


def build_blackboard():
    reset_scene()
    board = create_material("BlackboardSlate", (0.018, 0.085, 0.065, 1.0), roughness=0.82)
    wood = create_material("BlackboardOakFrame", (0.33, 0.14, 0.045, 1.0), roughness=0.48)
    metal = create_material("BlackboardStandMetal", (0.11, 0.13, 0.15, 1.0), metallic=0.72, roughness=0.31)
    chalk = create_material("BlackboardChalk", (0.92, 0.91, 0.82, 1.0), roughness=0.95)

    add_box("Slate", (2.32, 0.045, 1.14), (0.0, 0.0, 1.37), board, bevel=0.012)
    add_box("FrameTop", (2.50, 0.09, 0.075), (0.0, 0.0, 1.9975), wood, bevel=0.012)
    add_box("FrameBottom", (2.50, 0.09, 0.075), (0.0, 0.0, 0.7425), wood, bevel=0.012)
    add_box("FrameLeft", (0.075, 0.09, 1.33), (-1.2125, 0.0, 1.37), wood, bevel=0.012)
    add_box("FrameRight", (0.075, 0.09, 1.33), (1.2125, 0.0, 1.37), wood, bevel=0.012)
    add_box("ChalkTray", (1.65, 0.18, 0.05), (0.0, -0.115, 0.70), metal, bevel=0.012)

    for index, x_position in enumerate((-0.88, 0.88), start=1):
        add_box(
            f"StandPost{index}",
            (0.065, 0.065, 0.69),
            (x_position, 0.035, 0.345),
            metal,
            bevel=0.009,
        )
        add_box(
            f"StandFoot{index}",
            (0.48, 0.44, 0.055),
            (x_position, 0.035, 0.0275),
            metal,
            bevel=0.012,
        )

    for index, (x_position, length) in enumerate(((-0.38, 0.16), (-0.13, 0.11), (0.19, 0.14)), start=1):
        add_box(
            f"ChalkStick{index}",
            (length, 0.025, 0.025),
            (x_position, -0.205, 0.745),
            chalk,
            bevel=0.007,
        )

    export_asset("blackboard", "blackboard.glb")


def build_desk():
    reset_scene()
    wood = create_material("DeskWarmOak", (0.38, 0.16, 0.055, 1.0), roughness=0.43)
    edge = create_material("DeskDarkEdge", (0.075, 0.052, 0.035, 1.0), roughness=0.55)
    metal = create_material("DeskPowderCoatedSteel", (0.095, 0.11, 0.13, 1.0), metallic=0.68, roughness=0.32)
    foot = create_material("DeskRubberFeet", (0.018, 0.021, 0.024, 1.0), roughness=0.82)

    add_box("Desktop", (1.00, 0.60, 0.055), (0.0, 0.0, 0.7325), wood, bevel=0.022)
    add_box("DesktopFrontEdge", (0.92, 0.028, 0.072), (0.0, -0.286, 0.714), edge, bevel=0.010)
    add_box("UnderDeskShelf", (0.80, 0.38, 0.035), (0.0, 0.035, 0.565), metal, bevel=0.012)
    add_box("FrontApron", (0.82, 0.035, 0.16), (0.0, -0.245, 0.61), wood, bevel=0.012)

    leg_positions = (
        (-0.43, -0.235),
        (0.43, -0.235),
        (-0.43, 0.235),
        (0.43, 0.235),
    )
    for index, (x_position, y_position) in enumerate(leg_positions, start=1):
        add_box(
            f"DeskLeg{index}",
            (0.045, 0.045, 0.70),
            (x_position, y_position, 0.35),
            metal,
            bevel=0.008,
        )
        add_box(
            f"DeskFoot{index}",
            (0.06, 0.06, 0.025),
            (x_position, y_position, 0.0125),
            foot,
            bevel=0.008,
        )

    export_asset("desk", "desk.glb")


def build_chair():
    reset_scene()
    wood = create_material("ChairWarmOak", (0.40, 0.18, 0.06, 1.0), roughness=0.46)
    edge = create_material("ChairDarkWood", (0.12, 0.052, 0.022, 1.0), roughness=0.52)
    metal = create_material("ChairPowderCoatedSteel", (0.085, 0.10, 0.12, 1.0), metallic=0.66, roughness=0.34)
    foot = create_material("ChairRubberFeet", (0.017, 0.020, 0.023, 1.0), roughness=0.85)

    add_box("Seat", (0.46, 0.44, 0.052), (0.0, 0.0, 0.446), wood, bevel=0.026)
    add_box("SeatFrontEdge", (0.40, 0.027, 0.065), (0.0, -0.207, 0.425), edge, bevel=0.009)
    add_box("BackRest", (0.44, 0.050, 0.30), (0.0, 0.195, 0.735), wood, bevel=0.028)
    add_box("BackRestInset", (0.32, 0.018, 0.19), (0.0, 0.165, 0.735), edge, bevel=0.010)

    leg_positions = (
        (-0.185, -0.165),
        (0.185, -0.165),
        (-0.185, 0.165),
        (0.185, 0.165),
    )
    for index, (x_position, y_position) in enumerate(leg_positions, start=1):
        add_box(
            f"ChairLeg{index}",
            (0.038, 0.038, 0.42),
            (x_position, y_position, 0.21),
            metal,
            bevel=0.007,
        )
        add_box(
            f"ChairFoot{index}",
            (0.052, 0.052, 0.025),
            (x_position, y_position, 0.0125),
            foot,
            bevel=0.007,
        )

    for index, x_position in enumerate((-0.185, 0.185), start=1):
        add_box(
            f"BackSupport{index}",
            (0.038, 0.038, 0.45),
            (x_position, 0.175, 0.655),
            metal,
            bevel=0.007,
        )

    export_asset("chair", "chair.glb")


def build_round_table():
    reset_scene()
    wood = create_material("RoundTableWalnut", (0.30, 0.105, 0.032, 1.0), roughness=0.39)
    edge = create_material("RoundTableEdge", (0.09, 0.035, 0.018, 1.0), roughness=0.49)
    metal = create_material("RoundTableBrushedSteel", (0.17, 0.19, 0.21, 1.0), metallic=0.78, roughness=0.28)
    foot = create_material("RoundTableFloorPad", (0.018, 0.021, 0.024, 1.0), roughness=0.86)

    add_cylinder("TableTop", 0.55, 0.06, (0.0, 0.0, 0.73), wood, vertices=64, bevel=0.018)
    add_cylinder("TableTopEdge", 0.558, 0.025, (0.0, 0.0, 0.713), edge, vertices=64, bevel=0.008)
    add_cylinder("Pedestal", 0.075, 0.665, (0.0, 0.0, 0.365), metal, vertices=48, bevel=0.012)
    add_cylinder("PedestalCollar", 0.12, 0.075, (0.0, 0.0, 0.66), metal, vertices=48, bevel=0.012)
    add_cylinder("Base", 0.30, 0.045, (0.0, 0.0, 0.0325), metal, vertices=64, bevel=0.014)
    add_cylinder("FloorPad", 0.255, 0.02, (0.0, 0.0, 0.01), foot, vertices=64, bevel=0.006)

    export_asset("round_table", "round_table.glb")


def build_sofa():
    reset_scene()
    fabric = create_material("SofaTealFabric", (0.035, 0.22, 0.22, 1.0), roughness=0.82)
    fabric_light = create_material("SofaTealCushion", (0.052, 0.30, 0.29, 1.0), roughness=0.78)
    seam = create_material("SofaDarkSeam", (0.018, 0.085, 0.085, 1.0), roughness=0.88)
    wood = create_material("SofaWalnutLeg", (0.20, 0.07, 0.024, 1.0), roughness=0.42)

    add_box("SofaBase", (1.80, 0.78, 0.25), (0.0, 0.0, 0.255), fabric, bevel=0.055)
    add_box("SofaBackFrame", (1.80, 0.18, 0.64), (0.0, 0.31, 0.59), fabric, bevel=0.060)
    add_box("LeftArm", (0.20, 0.76, 0.48), (-0.82, 0.0, 0.45), fabric, bevel=0.075)
    add_box("RightArm", (0.20, 0.76, 0.48), (0.82, 0.0, 0.45), fabric, bevel=0.075)

    for index, x_position in enumerate((-0.40, 0.40), start=1):
        add_box(
            f"SeatCushion{index}",
            (0.76, 0.62, 0.18),
            (x_position, -0.035, 0.455),
            fabric_light,
            bevel=0.075,
        )
        add_box(
            f"BackCushion{index}",
            (0.76, 0.16, 0.53),
            (x_position, 0.205, 0.72),
            fabric_light,
            bevel=0.075,
            rotation=(-0.10, 0.0, 0.0),
        )

    add_box("SeatCentreSeam", (0.025, 0.58, 0.015), (0.0, -0.035, 0.5525), seam, bevel=0.006)
    add_box("BackCentreSeam", (0.025, 0.018, 0.48), (0.0, 0.115, 0.72), seam, bevel=0.006)

    leg_positions = (
        (-0.70, -0.27),
        (0.70, -0.27),
        (-0.70, 0.27),
        (0.70, 0.27),
    )
    for index, (x_position, y_position) in enumerate(leg_positions, start=1):
        add_box(
            f"SofaLeg{index}",
            (0.10, 0.10, 0.13),
            (x_position, y_position, 0.065),
            wood,
            bevel=0.014,
        )

    export_asset("sofa", "sofa.glb")


def generate_core_furniture_pack():
    builders = {
        "blackboard": build_blackboard,
        "desk": build_desk,
        "chair": build_chair,
        "round_table": build_round_table,
        "sofa": build_sofa,
    }
    for asset_id, _filename in ASSET_BUILDERS:
        builders[asset_id]()
    print("Generated all five ToonSpectrum core furniture assets.")


if __name__ == "__main__":
    generate_core_furniture_pack()
