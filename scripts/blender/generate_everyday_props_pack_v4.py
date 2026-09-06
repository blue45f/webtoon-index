"""Generate ToonSpectrum's production everyday prop pack v4.

The six assets in this pack replace the primitive geometry behind the stable
``mug``, ``book``, ``cap``, ``glasses``, ``backpack`` and ``stethoscope`` IDs.
They are authored in metres for the existing Studio VRM attachment profiles.
Each semantic contact point is represented by a named mesh so automated QA can
prove that the serialized anchor still lands on real geometry.

Run with Blender 5.2 in an isolated background process::

    blender -b --python scripts/blender/generate_everyday_props_pack_v4.py

The script never resets factory preferences and uses no external models,
textures or network resources. Every output is a self-contained CC0 GLB.
"""

from math import cos, pi, sin

import bpy
from mathutils import Vector


OUTPUT_DIRECTORY = (
    bpy.context.scene.get("toonspectrum_everyday_props_output_dir")
    or bpy.path.abspath("//apps/web/public/assets/3d")
)
GENERATOR = "scripts/blender/generate_everyday_props_pack_v4.py"
CC0_LICENSE_URL = "https://creativecommons.org/publicdomain/zero/1.0/"

ASSETS = (
    ("everyday_mug_v4", "everyday_mug.glb"),
    ("everyday_book_v4", "everyday_book.glb"),
    ("everyday_cap_v4", "everyday_cap.glb"),
    ("everyday_glasses_v4", "everyday_glasses.glb"),
    ("everyday_backpack_v4", "everyday_backpack.glb"),
    ("medical_stethoscope_v4", "medical_stethoscope.glb"),
)


def clear_scene():
    """Remove generated datablocks without touching user preferences."""
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
    output_override = scene.get("toonspectrum_everyday_props_output_dir")
    for key in list(scene.keys()):
        del scene[key]
    if output_override:
        scene["toonspectrum_everyday_props_output_dir"] = output_override
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    scene.unit_settings.length_unit = "METERS"


def material(
    name,
    color,
    metallic=0.0,
    roughness=0.5,
    alpha=1.0,
    transmission=0.0,
    emission=None,
    emission_strength=0.0,
    tintable=False,
):
    mat = bpy.data.materials.new(name=name)
    mat.diffuse_color = (*color, alpha)
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get("Principled BSDF")
    if shader is not None:
        shader.inputs["Base Color"].default_value = (*color, alpha)
        shader.inputs["Metallic"].default_value = metallic
        shader.inputs["Roughness"].default_value = roughness
        if "Alpha" in shader.inputs:
            shader.inputs["Alpha"].default_value = alpha
        if "Transmission Weight" in shader.inputs:
            shader.inputs["Transmission Weight"].default_value = transmission
        if emission is not None and "Emission Color" in shader.inputs:
            shader.inputs["Emission Color"].default_value = (*emission, 1.0)
            shader.inputs["Emission Strength"].default_value = emission_strength
    if alpha < 1.0 and hasattr(mat, "surface_render_method"):
        mat.surface_render_method = "DITHERED"
    mat["toonspectrum_pbr"] = True
    mat["toonspectrum_tintable"] = tintable
    return mat


def assign(obj, mat):
    obj.data.materials.clear()
    obj.data.materials.append(mat)


def smooth(obj):
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    return obj


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


def box(name, dimensions, location, mat, edge=0.004, rotation=(0.0, 0.0, 0.0)):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=location)
    obj = bpy.context.active_object
    obj.name = name
    obj.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.rotation_euler = rotation
    assign(obj, mat)
    return bevel(obj, min(edge, min(dimensions) * 0.42), segments=3)


def cylinder(
    name,
    radius,
    depth,
    location,
    mat,
    vertices=48,
    edge=0.002,
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
    bevel(obj, min(edge, radius * 0.28, depth * 0.18), segments=2)
    return smooth(obj)


def sphere(name, radius, location, mat, segments=48, rings=24, scale=(1.0, 1.0, 1.0)):
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


def torus(
    name,
    major_radius,
    minor_radius,
    location,
    mat,
    rotation=(0.0, 0.0, 0.0),
    major_segments=56,
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
    assign(obj, mat)
    return smooth(obj)


def rod(name, start, end, radius, mat, vertices=32, edge=0.0015):
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


def tube(name, points, radius, mat, resolution=3):
    """Create a smooth, capped mesh tube through Blender-space points."""
    curve = bpy.data.curves.new(f"{name}Curve", type="CURVE")
    curve.dimensions = "3D"
    curve.resolution_u = 2
    curve.bevel_depth = radius
    curve.bevel_resolution = resolution
    curve.resolution_u = 2
    curve.use_fill_caps = True
    spline = curve.splines.new("NURBS")
    spline.points.add(len(points) - 1)
    for point, coordinate in zip(spline.points, points):
        point.co = (*coordinate, 1.0)
    spline.order_u = min(3, len(points))
    spline.use_endpoint_u = True
    obj = bpy.data.objects.new(name, curve)
    bpy.context.scene.collection.objects.link(obj)
    assign(obj, mat)
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.convert(target="MESH")
    obj.name = name
    return smooth(obj)


def ellipse_tube(name, radii, z, mat, tube_radius=0.0015, segments=64, start=0.0, sweep=2 * pi):
    points = [
        (radii[0] * cos(start + sweep * index / (segments - 1)),
         radii[1] * sin(start + sweep * index / (segments - 1)),
         z)
        for index in range(segments)
    ]
    return tube(name, points, tube_radius, mat, 2)


def dome(name, radius_x, radius_y, height, location, mat, segments=64, rings=24):
    """Create a clean UV hemisphere with a real open head-contact boundary."""
    vertices = [(0.0, 0.0, height)]
    for ring in range(1, rings + 1):
        theta = (pi * 0.5) * ring / rings
        for segment in range(segments):
            phi = 2 * pi * segment / segments
            vertices.append((
                radius_x * sin(theta) * cos(phi),
                radius_y * sin(theta) * sin(phi),
                height * cos(theta),
            ))
    faces = []
    for segment in range(segments):
        faces.append((0, 1 + segment, 1 + (segment + 1) % segments))
    for ring in range(1, rings):
        previous = 1 + (ring - 1) * segments
        current = 1 + ring * segments
        for segment in range(segments):
            next_segment = (segment + 1) % segments
            faces.append((
                previous + segment,
                current + segment,
                current + next_segment,
                previous + next_segment,
            ))
    mesh = bpy.data.meshes.new(f"{name}Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    obj.location = location
    bpy.context.scene.collection.objects.link(obj)
    assign(obj, mat)
    return smooth(obj)


def root_and_export(asset_id, filename, attachment_origin, dimensions, quality_class):
    root = bpy.data.objects.new(f"TS_{asset_id}_Root", None)
    root.empty_display_type = "PLAIN_AXES"
    root["asset_id"] = asset_id
    root["asset_author"] = "ToonSpectrum"
    root["asset_generator"] = GENERATOR
    root["asset_license"] = "CC0-1.0"
    root["asset_license_url"] = CC0_LICENSE_URL
    root["units"] = "metres"
    root["attachment_origin"] = attachment_origin
    root["nominal_dimensions_m"] = dimensions
    root["quality_class"] = quality_class
    root["forward_axis"] = "+Z"
    root["up_axis"] = "+Y"
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


def build_everyday_mug():
    clear_scene()
    ceramic = material("MugV4_GlazedCeramic", (0.82, 0.76, 0.65), roughness=0.24, tintable=True)
    rim = material("MugV4_RimGlaze", (0.96, 0.93, 0.86), roughness=0.16)
    coffee = material("MugV4_Coffee", (0.12, 0.045, 0.018), roughness=0.20)
    accent = material("MugV4_StudioMark", (0.08, 0.30, 0.42), metallic=0.08, roughness=0.34)
    shadow = material("MugV4_BaseShadow", (0.20, 0.16, 0.13), roughness=0.66)

    # Blender Z becomes runtime +Y. Keep the serialized X=.07 handle contact fixed while
    # moving the vessel 18 mm away from the palm so the reference rig's full hand volume cannot graze it.
    vessel_x = -0.018
    cylinder("Mug_CeramicBody", 0.040, 0.082, (vessel_x, 0.0, 0.0), ceramic, 64, 0.004)
    torus("Mug_Rim", 0.0385, 0.0032, (vessel_x, 0.0, 0.041), rim, (0.0, 0.0, 0.0), 64, 14)
    cylinder("Mug_CoffeeSurface", 0.035, 0.0015, (vessel_x, 0.0, 0.0405), coffee, 64, 0.0003)
    torus("Mug_BaseRing", 0.032, 0.003, (vessel_x, 0.0, -0.040), shadow, (0.0, 0.0, 0.0), 56, 12)
    torus("Mug_HandleLoop", 0.026, 0.0065, (0.045, 0.0, 0.0), ceramic,
          (pi * 0.5, 0.0, 0.0), 64, 14)
    rod("Mug_HandleUpperBridge", (0.020, 0.0, 0.027), (0.049, 0.0, 0.025), 0.007, ceramic, 36)
    rod("Mug_HandleLowerBridge", (0.020, 0.0, -0.027), (0.049, 0.0, -0.025), 0.007, ceramic, 36)
    sphere("Mug_HandleContact", 0.0085, (0.071, 0.0, 0.0), accent, 32, 16, (0.75, 0.65, 1.0))
    box("Mug_StudioBadge", (0.028, 0.0018, 0.014), (vessel_x, -0.0405, 0.004), accent, 0.003)
    root_and_export("everyday_mug_v4", "everyday_mug.glb", "handle-contact", "0.12 x 0.09 x 0.09", "handheld")


def build_everyday_book():
    clear_scene()
    cover = material("BookV4_DyedLeather", (0.38, 0.075, 0.060), roughness=0.52, tintable=True)
    cover_edge = material("BookV4_LeatherEdge", (0.12, 0.025, 0.020), roughness=0.68)
    pages = material("BookV4_WarmPages", (0.92, 0.84, 0.68), roughness=0.78)
    foil = material("BookV4_GoldFoil", (0.72, 0.43, 0.10), metallic=0.82, roughness=0.22)
    ribbon = material("BookV4_Ribbon", (0.04, 0.20, 0.31), roughness=0.62)

    # Runtime dimensions X/Y/Z map to Blender X/Z/-Y.
    box("Book_PageBlock", (0.142, 0.027, 0.194), (0.004, 0.0, 0.0), pages, 0.006)
    box("Book_FrontCover", (0.158, 0.008, 0.214), (0.0, -0.018, 0.0), cover, 0.008)
    box("Book_BackCover", (0.158, 0.008, 0.214), (0.0, 0.018, 0.0), cover, 0.008)
    box("Book_Spine", (0.018, 0.044, 0.214), (-0.075, 0.0, 0.0), cover_edge, 0.007)
    box("Book_ForeEdge", (0.008, 0.029, 0.190), (0.075, 0.0, 0.0), foil, 0.002)
    for index, z_value in enumerate((-0.078, -0.045, -0.012, 0.021, 0.054, 0.087), start=1):
        box(f"Book_PageBand_{index}", (0.136, 0.0012, 0.0013), (0.004, -0.0143, z_value), cover_edge, 0.0004)
    for side, x_value in (("Left", -0.070), ("Right", 0.070)):
        box(f"Book_{side}GripEdge", (0.018, 0.040, 0.048), (x_value, 0.0, -0.045), cover_edge, 0.004)
        for end, z_value in (("Lower", -0.096), ("Upper", 0.096)):
            box(f"Book_{side}{end}Corner", (0.022, 0.046, 0.022), (x_value, 0.0, z_value), foil, 0.004)
    box("Book_FoilTitlePlate", (0.075, 0.002, 0.042), (0.018, -0.0225, 0.024), foil, 0.006)
    for index, z_value in enumerate((0.034, 0.024, 0.014), start=1):
        box(f"Book_TitleLine_{index}", (0.052 - index * 0.006, 0.001, 0.0024),
            (0.018, -0.024, z_value), cover_edge, 0.0005)
    box("Book_RibbonMarker", (0.012, 0.0018, 0.235), (0.030, 0.0188, -0.008), ribbon, 0.002)
    root_and_export("everyday_book_v4", "everyday_book.glb", "two-hand-cover-edges", "0.16 x 0.22 x 0.05", "handheld")


def build_everyday_cap():
    clear_scene()
    fabric = material("CapV4_CottonTwill", (0.055, 0.105, 0.19), roughness=0.82, tintable=True)
    underside = material("CapV4_BrimUnderside", (0.025, 0.037, 0.055), roughness=0.88)
    seam = material("CapV4_ContrastStitch", (0.66, 0.72, 0.76), roughness=0.76)
    hardware = material("CapV4_AdjusterMetal", (0.42, 0.47, 0.52), metallic=0.88, roughness=0.24)
    band = material("CapV4_Sweatband", (0.075, 0.065, 0.055), roughness=0.92)

    # The persisted cap socket is the head-bone forehead contact, not the crown base. A hidden
    # liner post keeps [0,0,0] on real geometry while lifting the visible cap over the reference rig's hair.
    cap_lift = 0.065
    dome("Cap_Crown", 0.105, 0.097, 0.096, (0.0, 0.0, cap_lift), fabric, 64, 24)
    cylinder("Cap_HeadContact", 0.028, cap_lift + 0.003,
             (0.0, 0.0, (cap_lift + 0.003) * 0.5), band, 48, 0.0005)
    ellipse_tube("Cap_Sweatband", (0.098, 0.091), cap_lift + 0.004, band, 0.0045, 72)
    sphere("Cap_Brim", 1.0, (0.0, -0.075, cap_lift + 0.006), fabric, 56, 24, (0.105, 0.090, 0.007))
    sphere("Cap_BrimUnderside", 1.0, (0.0, -0.075, cap_lift + 0.001), underside, 48, 20, (0.100, 0.086, 0.003))
    for index, radius_y in enumerate((0.060, 0.073), start=1):
        points = [
            (0.094 * cos(pi + pi * step / 31), -0.072 + radius_y * sin(pi + pi * step / 31), cap_lift + 0.013)
            for step in range(32)
        ]
        tube(f"Cap_BrimStitch_{index}", points, 0.0012, seam, 1)
    for index, phi in enumerate((-pi * 0.5, -pi * 0.15, pi * 0.15, pi * 0.5), start=1):
        points = []
        for step in range(18):
            theta = 0.10 + (pi * 0.5 - 0.10) * step / 17
            points.append((
                0.105 * sin(theta) * cos(phi),
                0.097 * sin(theta) * sin(phi),
                0.096 * cos(theta) + cap_lift + 0.001,
            ))
        tube(f"Cap_PanelSeam_{index}", points, 0.00125, seam, 1)
    sphere("Cap_TopButton", 0.009, (0.0, 0.0, cap_lift + 0.098), hardware, 32, 16, (1.0, 1.0, 0.55))
    box("Cap_RearAdjuster", (0.060, 0.008, 0.014), (0.0, 0.092, cap_lift + 0.018), band, 0.003)
    box("Cap_RearBuckle", (0.020, 0.010, 0.020), (0.0, 0.097, cap_lift + 0.018), hardware, 0.003)
    root_and_export("everyday_cap_v4", "everyday_cap.glb", "head-contact-centre", "0.22 x 0.27 x 0.17", "headwear")


def build_everyday_glasses():
    clear_scene()
    frame = material("GlassesV4_AcetateFrame", (0.035, 0.026, 0.024), roughness=0.34, tintable=True)
    lens = material("GlassesV4_ClearLens", (0.58, 0.78, 0.88), roughness=0.06, alpha=0.25, transmission=0.72)
    hinge = material("GlassesV4_HingeSteel", (0.42, 0.47, 0.52), metallic=0.92, roughness=0.20)
    grip = material("GlassesV4_TempleGrip", (0.10, 0.075, 0.060), roughness=0.72)
    highlight = material("GlassesV4_LensCoating", (0.10, 0.40, 0.55), metallic=0.10, roughness=0.10, alpha=0.44)

    # Rims lie in Blender XZ, which exports as the runtime XY face plane.
    for side, x_value, sign_value in (("Left", -0.036, -1), ("Right", 0.036, 1)):
        torus(f"Glasses_{side}Rim", 0.031, 0.0036, (x_value, 0.0, 0.0), frame,
              (pi * 0.5, 0.0, 0.0), 56, 12)
        sphere(f"Glasses_{side}Lens", 1.0, (x_value, -0.0015, 0.0), lens, 40, 20,
               (0.0285, 0.0015, 0.022))
        box(f"Glasses_{side}LensHighlight", (0.022, 0.001, 0.0025),
            (x_value - sign_value * 0.004, -0.0032, 0.009), highlight, 0.0006,
            (0.0, sign_value * 0.10, sign_value * 0.18))
        hinge_x = sign_value * 0.068
        cylinder(f"Glasses_{side}Hinge", 0.005, 0.014, (hinge_x, 0.004, 0.0), hinge, 32, 0.001,
                 (0.0, 0.0, 0.0))
        rod(f"Glasses_{side}TempleArm", (hinge_x, 0.003, 0.0),
            (sign_value * 0.073, 0.112, -0.004), 0.0032, frame, 28, 0.0009)
        tube(f"Glasses_{side}TempleGrip", [
            (sign_value * 0.073, 0.104, -0.004),
            (sign_value * 0.074, 0.125, -0.005),
            (sign_value * 0.071, 0.142, -0.013),
            (sign_value * 0.067, 0.148, -0.026),
        ], 0.0041, grip, 3)
        rod(f"Glasses_{side}NosePadArm", (sign_value * 0.015, -0.002, -0.003),
            (sign_value * 0.011, -0.014, -0.012), 0.0015, hinge, 20, 0.0004)
        sphere(f"Glasses_{side}NosePad", 0.0055, (sign_value * 0.011, -0.015, -0.014), grip,
               24, 12, (0.65, 0.38, 1.0))
    rod("Glasses_BridgeContact", (-0.008, 0.0, 0.0), (0.008, 0.0, 0.0), 0.0034, frame, 32, 0.0008)
    root_and_export("everyday_glasses_v4", "everyday_glasses.glb", "nose-bridge-centre", "0.15 x 0.18 x 0.07", "headwear")


def build_everyday_backpack():
    clear_scene()
    canvas = material("BackpackV4_WaxedCanvas", (0.095, 0.19, 0.13), roughness=0.82, tintable=True)
    pocket = material("BackpackV4_PocketCanvas", (0.065, 0.13, 0.095), roughness=0.86)
    webbing = material("BackpackV4_Webbing", (0.025, 0.035, 0.030), roughness=0.92)
    zipper = material("BackpackV4_ZipperMetal", (0.38, 0.42, 0.40), metallic=0.88, roughness=0.26)
    lining = material("BackpackV4_BackMesh", (0.12, 0.14, 0.13), roughness=0.94)
    label = material("BackpackV4_StudioLabel", (0.76, 0.34, 0.08), roughness=0.58)

    # The persisted anchor basis applies a 180-degree runtime turn. Author the pack volume on
    # Blender -Y so that turn lands it behind the contact plane, while the straps sweep around
    # the shoulder toward Blender +Y and finish against the chest.
    box("Backpack_BackContact", (0.225, 0.012, 0.305), (0.0, -0.060, 0.0), lining, 0.012)
    sphere("Backpack_MainShell", 1.0, (0.0, -0.025, 0.0), canvas, 56, 28, (0.145, 0.092, 0.192))
    box("Backpack_MainPanel", (0.260, 0.130, 0.310), (0.0, -0.020, -0.015), canvas, 0.040)
    box("Backpack_FrontPocket", (0.205, 0.070, 0.125), (0.0, -0.112, -0.070), pocket, 0.025)
    box("Backpack_LaptopDivider", (0.205, 0.008, 0.245), (0.0, -0.045, 0.010), lining, 0.008)
    for side, x_value in (("Left", -0.092), ("Right", 0.092)):
        tube(f"Backpack_{side}ShoulderStrap", [
            (x_value * 0.72, -0.055, 0.135),
            (x_value, 0.080, 0.080),
            (x_value * 1.15, 0.190, -0.015),
            (x_value, 0.250, -0.125),
        ], 0.018, webbing, 3)
        box(f"Backpack_{side}StrapPad", (0.042, 0.018, 0.150),
            (x_value, 0.200, 0.025), webbing, 0.015, (0.0, side == "Left" and -0.07 or 0.07, 0.0))
        box(f"Backpack_{side}Adjuster", (0.040, 0.016, 0.028),
            (x_value, 0.245, -0.090), zipper, 0.005)
        box(f"Backpack_{side}SidePocket", (0.048, 0.105, 0.105),
            (x_value * 1.55, -0.030, -0.070), pocket, 0.018)
        tube(f"Backpack_{side}CompressionStrap", [
            (x_value * 1.45, 0.015, 0.060),
            (x_value * 1.58, -0.035, 0.020),
            (x_value * 1.48, -0.075, -0.025),
        ], 0.006, webbing, 2)
    tube("Backpack_TopHandle", [
        (-0.050, -0.030, 0.165),
        (-0.035, -0.045, 0.205),
        (0.035, -0.045, 0.205),
        (0.050, -0.030, 0.165),
    ], 0.008, webbing, 3)
    # Zipper paths are intentionally separate named metal details.
    zipper_points = [
        (0.128 * cos(pi * step / 32), -0.105 - 0.010 * sin(pi * step / 32), 0.095 - 0.185 * step / 32)
        for step in range(33)
    ]
    tube("Backpack_MainZipper", zipper_points, 0.0032, zipper, 2)
    tube("Backpack_PocketZipper", [(-0.082, -0.150, -0.032), (0.0, -0.151, -0.027), (0.082, -0.150, -0.032)],
         0.003, zipper, 2)
    box("Backpack_StudioLabel", (0.060, 0.006, 0.032), (0.0, -0.151, -0.075), label, 0.006)
    root_and_export("everyday_backpack_v4", "everyday_backpack.glb", "padded-back-contact", "0.33 x 0.42 x 0.40", "large-body")


def build_medical_stethoscope():
    clear_scene()
    tubing = material("StethoscopeV4_FlexibleTubing", (0.025, 0.060, 0.105), roughness=0.48, tintable=True)
    steel = material("StethoscopeV4_StainlessSteel", (0.52, 0.58, 0.62), metallic=0.94, roughness=0.18)
    diaphragm = material("StethoscopeV4_Diaphragm", (0.82, 0.86, 0.88), metallic=0.56, roughness=0.22)
    ear = material("StethoscopeV4_SoftEartips", (0.82, 0.78, 0.68), roughness=0.70)
    accent = material("StethoscopeV4_StudioAccent", (0.05, 0.42, 0.56), metallic=0.18, roughness=0.30)

    # The stable profile rotates this source +90 degrees around runtime X.
    # Authoring in runtime XZ at Y=0.105 therefore lands the loop flat on the
    # avatar's XY chest plane while preserving defaultRotationDeg exactly.
    def source_to_blender(x_value, y_value, z_value):
        return (x_value, -z_value, y_value)

    neck_y = 0.105
    wear_y = 0.180
    rod("Stethoscope_NeckContact", source_to_blender(-0.028, neck_y, 0.0),
        source_to_blender(0.028, neck_y, 0.0), 0.0055, tubing, 32, 0.001)
    loop_drop = 0.130
    left_loop = [
        source_to_blender(-0.028 - 0.074 * sin(pi * step / 34), wear_y, loop_drop * step / 34)
        for step in range(35)
    ]
    right_loop = [
        source_to_blender(0.028 + 0.074 * sin(pi * step / 34), wear_y, loop_drop * step / 34)
        for step in range(35)
    ]
    rod("Stethoscope_LeftNeckSpacer", source_to_blender(-0.028, neck_y, 0.0),
        source_to_blender(-0.028, wear_y, 0.0), 0.0055, tubing, 32, 0.001)
    rod("Stethoscope_RightNeckSpacer", source_to_blender(0.028, neck_y, 0.0),
        source_to_blender(0.028, wear_y, 0.0), 0.0055, tubing, 32, 0.001)
    tube("Stethoscope_LeftTubing", left_loop, 0.0055, tubing, 4)
    tube("Stethoscope_RightTubing", right_loop, 0.0055, tubing, 4)
    tube("Stethoscope_LeftYoke", [
        source_to_blender(-0.028, wear_y, loop_drop),
        source_to_blender(-0.014, wear_y, 0.127),
        source_to_blender(0.0, wear_y, 0.124),
    ], 0.0055, tubing, 4)
    tube("Stethoscope_RightYoke", [
        source_to_blender(0.028, wear_y, loop_drop),
        source_to_blender(0.014, wear_y, 0.127),
        source_to_blender(0.0, wear_y, 0.124),
    ], 0.0055, tubing, 4)
    rod("Stethoscope_LeftBinaural", source_to_blender(-0.028, wear_y, 0.0),
        source_to_blender(-0.053, wear_y, -0.082), 0.0034, steel, 32, 0.0008)
    rod("Stethoscope_RightBinaural", source_to_blender(0.028, wear_y, 0.0),
        source_to_blender(0.053, wear_y, -0.082), 0.0034, steel, 32, 0.0008)
    for side, x_value in (("Left", -0.056), ("Right", 0.056)):
        cylinder(f"Stethoscope_{side}Eartip", 0.0065, 0.018,
                 source_to_blender(x_value, wear_y, -0.092), ear, 36, 0.001,
                 (pi * 0.5, 0.0, 0.0))
    tube("Stethoscope_CentreTube", [
        source_to_blender(0.0, wear_y, 0.124),
        source_to_blender(0.020, wear_y, 0.145),
        source_to_blender(0.038, wear_y, 0.165),
    ], 0.005, tubing, 4)
    cylinder("Stethoscope_ChestpieceStem", 0.006, 0.034,
             source_to_blender(0.038, wear_y, 0.173), steel, 32, 0.001,
             (pi * 0.5, 0.0, 0.0))
    cylinder("Stethoscope_Chestpiece", 0.026, 0.010,
             source_to_blender(0.038, wear_y, 0.190), steel, 56, 0.0015,
             (pi * 0.5, 0.0, 0.0))
    cylinder("Stethoscope_Diaphragm", 0.021, 0.012,
             source_to_blender(0.038, wear_y - 0.007, 0.190), diaphragm, 56, 0.0012,
             (pi * 0.5, 0.0, 0.0))
    torus("Stethoscope_ChestpieceAccent", 0.022, 0.0024,
          source_to_blender(0.038, wear_y - 0.014, 0.190), accent,
          (pi * 0.5, 0.0, 0.0), 56, 10)
    root_and_export("medical_stethoscope_v4", "medical_stethoscope.glb", "neck-loop-contact", "0.22 x 0.18 x 0.29", "body-wearable")


def generate_everyday_props_pack_v4():
    builders = {
        "everyday_mug_v4": build_everyday_mug,
        "everyday_book_v4": build_everyday_book,
        "everyday_cap_v4": build_everyday_cap,
        "everyday_glasses_v4": build_everyday_glasses,
        "everyday_backpack_v4": build_everyday_backpack,
        "medical_stethoscope_v4": build_medical_stethoscope,
    }
    for asset_id, _filename in ASSETS:
        builders[asset_id]()
    print("Generated all 6 ToonSpectrum everyday prop v4 assets.")


if __name__ == "__main__":
    generate_everyday_props_pack_v4()
