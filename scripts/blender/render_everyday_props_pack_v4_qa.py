"""Render fitted ToonSpectrum everyday props on the bundled reference VRM (Kate).

Each invocation starts from the exported VRM and GLB binaries, applies the
same reference-rig transform receipt as the Three runtime, attaches the
prop root to a real humanoid pose bone, and writes only the requested image.
The two-hand book view additionally uses Blender IK so both wrists meet its
authored cover-edge anchors.

Example::

    blender -b --python scripts/blender/render_everyday_props_pack_v4_qa.py -- \
      --view head --output /tmp/everyday-props-v4-head.png

Supported views are ``head``, ``head-three-quarter``, ``stethoscope``,
``backpack``, ``backpack-front``, ``mug`` and ``book``. This script clears the
current scene safely and never resets Blender preferences or writes into the repository.
"""

import argparse
from math import radians
from pathlib import Path
import sys

import bpy
from mathutils import Matrix, Quaternion, Vector


REPOSITORY = Path(__file__).resolve().parents[2]
# Kate (100Avatars R1 #038, CC0) replaced the retired procedural reference character. HEAD/EYE fit
# scales below were calibrated on that former rig and are approximate for this model.
REFERENCE_VRM = REPOSITORY / "apps/web/public/vrm/Kate.vrm"
ASSET_DIRECTORY = REPOSITORY / "apps/web/public/assets/3d"
HEAD_FIT_SCALE = 0.185916 / 0.18
EYE_FIT_SCALE = (0.185916 * 0.355) / 0.064


def arguments():
    raw = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--view",
        choices=("head", "head-three-quarter", "stethoscope", "backpack", "backpack-front", "mug", "book"),
        required=True,
    )
    parser.add_argument("--output", required=True)
    return parser.parse_args(raw)


def clear_scene():
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for collection in (
        bpy.data.meshes,
        bpy.data.curves,
        bpy.data.armatures,
        bpy.data.materials,
        bpy.data.cameras,
        bpy.data.lights,
    ):
        for datablock in list(collection):
            if datablock.users == 0:
                collection.remove(datablock)


def point_at(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


def import_reference_vrm():
    if not REFERENCE_VRM.is_file():
        raise FileNotFoundError(REFERENCE_VRM)
    if bpy.ops.import_scene.vrm(filepath=str(REFERENCE_VRM)) != {"FINISHED"}:
        raise RuntimeError(f"VRM import failed: {REFERENCE_VRM}")
    armatures = [obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"]
    if len(armatures) != 1:
        raise RuntimeError(f"Expected one reference armature, found {len(armatures)}")
    return armatures[0]


def import_prop(filename, asset_id):
    source = ASSET_DIRECTORY / filename
    if not source.is_file():
        raise FileNotFoundError(source)
    before = set(bpy.context.scene.objects)
    if bpy.ops.import_scene.gltf(filepath=str(source)) != {"FINISHED"}:
        raise RuntimeError(f"GLB import failed: {source}")
    imported = set(bpy.context.scene.objects) - before
    roots = [obj for obj in imported if obj.parent is None and obj.get("asset_id") == asset_id]
    if len(roots) != 1:
        raise RuntimeError(f"Expected one {asset_id!r} root, found {len(roots)}")
    return roots[0]


def gltf_anchor_to_blender(anchor):
    # The Blender glTF importer maps runtime (X, Y-up, Z-forward) to
    # Blender (X, -Z, Y-up).
    return Vector((anchor[0], -anchor[2], anchor[1]))


def place_anchor(root, gltf_anchor, target, scale=1.0, rotation=(0.0, 0.0, 0.0)):
    root.rotation_mode = "XYZ"
    root.scale = (scale, scale, scale)
    root.rotation_euler = tuple(radians(value) for value in rotation)
    root.location = (0.0, 0.0, 0.0)
    bpy.context.view_layer.update()
    transformed_anchor = root.matrix_world @ gltf_anchor_to_blender(gltf_anchor)
    root.location += Vector(target) - transformed_anchor
    bpy.context.view_layer.update()


def place_runtime_transform(root, position, quaternion, scale):
    """Convert a Three.js smart-rig world receipt into Blender world space."""
    conversion = Matrix((
        (1.0, 0.0, 0.0, 0.0),
        (0.0, 0.0, -1.0, 0.0),
        (0.0, 1.0, 0.0, 0.0),
        (0.0, 0.0, 0.0, 1.0),
    ))
    rotation = Quaternion((quaternion[3], quaternion[0], quaternion[1], quaternion[2])).to_matrix().to_4x4()
    three_matrix = (
        Matrix.Translation(Vector(position))
        @ rotation
        @ Matrix.Diagonal((scale, scale, scale, 1.0))
    )
    root.matrix_world = conversion @ three_matrix @ conversion.inverted()
    bpy.context.view_layer.update()


def attach_preserving_world(root, armature, bone_name):
    if bone_name not in armature.pose.bones:
        raise RuntimeError(f"Reference rig has no pose bone {bone_name!r}")
    world = root.matrix_world.copy()
    root.parent = armature
    root.parent_type = "BONE"
    root.parent_bone = bone_name
    root.matrix_world = world
    root["toonspectrum_qa_attachment_bone"] = bone_name


def add_arm_ik(armature, side, wrist_target):
    lower_name = f"lower_arm.{side}"
    lower = armature.pose.bones.get(lower_name)
    if lower is None:
        raise RuntimeError(f"Reference rig has no pose bone {lower_name!r}")

    target = bpy.data.objects.new(f"QA_WristTarget_{side}", None)
    target.location = wrist_target
    target.hide_render = True
    bpy.context.scene.collection.objects.link(target)
    pole = bpy.data.objects.new(f"QA_ElbowPole_{side}", None)
    side_sign = 1.0 if side == "L" else -1.0
    pole.location = (side_sign * 0.58, 0.12, 1.15)
    pole.hide_render = True
    bpy.context.scene.collection.objects.link(pole)

    constraint = lower.constraints.new("IK")
    constraint.name = "ToonSpectrum_QA_ContactIK"
    constraint.target = target
    constraint.pole_target = pole
    constraint.chain_count = 2
    constraint.use_stretch = False
    constraint.pole_angle = radians(-90.0 if side == "L" else 90.0)
    bpy.context.view_layer.update()


def setup_head(armature):
    cap = import_prop("everyday_cap.glb", "everyday_cap_v4")
    place_runtime_transform(
        cap,
        (0.0, 1.5750704574584962, 0.01),
        (-0.06975647374412533, 0.0, 0.0, 0.9975640502598244),
        HEAD_FIT_SCALE,
    )
    attach_preserving_world(cap, armature, "head")

    glasses = import_prop("everyday_glasses.glb", "everyday_glasses_v4")
    place_runtime_transform(
        glasses,
        (0.0, 1.5880282402038575, 0.10783102874755859),
        (0.0, 0.0, 0.0, 1.0),
        EYE_FIT_SCALE,
    )
    attach_preserving_world(glasses, armature, "head")
    return (0.0, -2.10, 1.60), (0.0, -0.01, 1.60), 78


def setup_stethoscope(armature):
    prop = import_prop("medical_stethoscope.glb", "medical_stethoscope_v4")
    place_runtime_transform(
        prop,
        (0.0, 1.2851408195495606, -0.05000000000000001),
        (0.7071067811865475, 0.0, 0.0, 0.7071067811865477),
        1.0,
    )
    attach_preserving_world(prop, armature, "neck")
    return (0.0, -2.65, 1.27), (0.0, -0.01, 1.28), 68


def setup_backpack(armature):
    prop = import_prop("everyday_backpack.glb", "everyday_backpack_v4")
    place_runtime_transform(
        prop,
        (0.0, 1.1530431032180786, -0.0592),
        (0.0, -1.0, 0.0, 0.0),
        0.68,
    )
    attach_preserving_world(prop, armature, "chest")
    return (0.0, 2.75, 1.27), (0.0, 0.02, 1.27), 68


def setup_mug(armature):
    prop = import_prop("everyday_mug.glb", "everyday_mug_v4")
    place_runtime_transform(
        prop,
        (-0.687611322863508, 1.3401408234001835, -0.08809198856991743),
        (1.6384736237970425e-8, -0.6618025644300988, -1.4464154107641065e-8, 0.749678174761507),
        1.3466667162239248,
    )
    attach_preserving_world(prop, armature, "hand.R")
    return (-0.28, -1.20, 1.48), (-0.67, 0.0, 1.34), 78


def setup_book(armature):
    prop = import_prop("everyday_book.glb", "everyday_book_v4")
    place_anchor(prop, (0.0, 0.0, 0.0), (0.0, -0.185, 1.250))
    left = prop.matrix_world @ gltf_anchor_to_blender((-0.07, -0.045, 0.0))
    right = prop.matrix_world @ gltf_anchor_to_blender((0.07, -0.045, 0.0))
    add_arm_ik(armature, "L", left)
    add_arm_ik(armature, "R", right)
    attach_preserving_world(prop, armature, "hand.L")
    return (0.0, -2.85, 1.28), (0.0, -0.02, 1.28), 68


def add_lighting(target, rear_view=False):
    key_y = 2.6 if rear_view else -2.8
    fill_y = -1.8 if rear_view else 1.8
    for location, energy, size, color in (
        ((-2.4, key_y, 3.0), 430, 3.0, (1.0, 0.84, 0.72)),
        ((2.6, fill_y, 2.2), 300, 2.6, (0.60, 0.76, 1.0)),
        ((0.0, 0.8, 3.6), 360, 2.4, (0.76, 0.90, 1.0)),
    ):
        bpy.ops.object.light_add(type="AREA", location=location)
        light = bpy.context.object
        light.data.energy = energy
        light.data.shape = "DISK"
        light.data.size = size
        light.data.color = color
        point_at(light, target)


def add_floor():
    bpy.ops.mesh.primitive_plane_add(size=12, location=(0.0, 0.0, -0.012))
    floor = bpy.context.object
    material = bpy.data.materials.new("EverydayPropsV4QaFloor")
    material.use_nodes = True
    shader = material.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (0.018, 0.028, 0.052, 1.0)
    shader.inputs["Roughness"].default_value = 0.84
    floor.data.materials.append(material)


def main():
    args = arguments()
    output = Path(args.output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)

    clear_scene()
    armature = import_reference_vrm()
    setup_view = {
        "head-three-quarter": "head",
        "backpack-front": "backpack",
    }.get(args.view, args.view)
    camera_location, target, lens = {
        "head": setup_head,
        "stethoscope": setup_stethoscope,
        "backpack": setup_backpack,
        "mug": setup_mug,
        "book": setup_book,
    }[setup_view](armature)
    if args.view == "head-three-quarter":
        camera_location = (1.10, -1.78, 1.64)
    elif args.view == "backpack-front":
        camera_location = (0.0, -2.75, 1.27)
    bpy.context.view_layer.update()

    bpy.ops.object.camera_add(location=camera_location)
    camera = bpy.context.object
    camera.data.lens = lens
    point_at(camera, target)
    bpy.context.scene.camera = camera
    add_lighting(target, rear_view=args.view == "backpack")
    add_floor()

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 900
    scene.render.resolution_y = 900
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.render.filepath = str(output)
    scene.world.color = (0.004, 0.008, 0.018)
    scene.view_settings.look = "Medium High Contrast"
    scene.view_settings.exposure = -0.45
    bpy.ops.render.render(write_still=True)
    print("EVERYDAY_PROPS_V4_QA", args.view, "Kate", str(output))


if __name__ == "__main__":
    main()
