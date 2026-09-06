"""Repair the bundled Polygonal Mind Orion avatar as a strict VRM 1.0 file.

This script preserves the original authored mesh, textures, skin, Mixamo bone
hierarchy, and facial morphs. It adds only the missing VRM 1.0 contract:

* 53 unique humanoid mappings, including the original finger and toe chains;
* two small eye bones with visibly weighted eye-panel geometry;
* 13 non-empty preset expressions bound to real original/new morph targets;
* audited rights metadata whose only CC0 evidence is the embedded source VRM0
  ``licenseName=CC0`` value (no external source URL is invented);
* export through the official Blender VRM Add-on ``export_scene.vrm`` operator.

The immutable source is ``source_assets/Avatar_Orion_vrm0_source.vrm``. Set
``scene["toonspectrum_orion_source_path"]`` and
``scene["toonspectrum_orion_output_path"]`` to absolute paths for CLI or MCP
execution. The script never calls ``read_factory_settings`` so an MCP bridge
survives execution.

Requirements: Blender 5.2+, VRM Add-on for Blender 4.5+.
"""

import bpy


HEAD_BONE_NAME = "mixamorig:Head"
EYE_BONE_PREFIX = "TS_OrionEye."

SOURCE_PATH = bpy.context.scene.get(
    "toonspectrum_orion_source_path",
    bpy.path.abspath("//scripts/blender/source_assets/Avatar_Orion_vrm0_source.vrm"),
)
OUTPUT_PATH = bpy.context.scene.get(
    "toonspectrum_orion_output_path",
    bpy.path.abspath("//apps/web/public/vrm/Avatar_Orion.vrm"),
)


HUMAN_BONE_MAP = {
    "hips": "mixamorig:Hips",
    "spine": "mixamorig:Spine",
    "chest": "mixamorig:Spine2",
    "neck": "mixamorig:Neck",
    "head": HEAD_BONE_NAME,
    "left_eye": EYE_BONE_PREFIX + "L",
    "right_eye": EYE_BONE_PREFIX + "R",
    "left_upper_leg": "mixamorig:LeftUpLeg",
    "left_lower_leg": "mixamorig:LeftLeg",
    "left_foot": "mixamorig:LeftFoot",
    "left_toes": "mixamorig:LeftToeBase",
    "right_upper_leg": "mixamorig:RightUpLeg",
    "right_lower_leg": "mixamorig:RightLeg",
    "right_foot": "mixamorig:RightFoot",
    "right_toes": "mixamorig:RightToeBase",
    "left_shoulder": "mixamorig:LeftShoulder",
    "left_upper_arm": "mixamorig:LeftArm",
    "left_lower_arm": "mixamorig:LeftForeArm",
    "left_hand": "mixamorig:LeftHand",
    "right_shoulder": "mixamorig:RightShoulder",
    "right_upper_arm": "mixamorig:RightArm",
    "right_lower_arm": "mixamorig:RightForeArm",
    "right_hand": "mixamorig:RightHand",
    "left_thumb_metacarpal": "mixamorig:LeftHandThumb1",
    "left_thumb_proximal": "mixamorig:LeftHandThumb2",
    "left_thumb_distal": "mixamorig:LeftHandThumb3",
    "left_index_proximal": "mixamorig:LeftHandIndex1",
    "left_index_intermediate": "mixamorig:LeftHandIndex2",
    "left_index_distal": "mixamorig:LeftHandIndex3",
    "left_middle_proximal": "mixamorig:LeftHandMiddle1",
    "left_middle_intermediate": "mixamorig:LeftHandMiddle2",
    "left_middle_distal": "mixamorig:LeftHandMiddle3",
    "left_ring_proximal": "mixamorig:LeftHandRing1",
    "left_ring_intermediate": "mixamorig:LeftHandRing2",
    "left_ring_distal": "mixamorig:LeftHandRing3",
    "left_little_proximal": "mixamorig:LeftHandPinky1",
    "left_little_intermediate": "mixamorig:LeftHandPinky2",
    "left_little_distal": "mixamorig:LeftHandPinky3",
    "right_thumb_metacarpal": "mixamorig:RightHandThumb1",
    "right_thumb_proximal": "mixamorig:RightHandThumb2",
    "right_thumb_distal": "mixamorig:RightHandThumb3",
    "right_index_proximal": "mixamorig:RightHandIndex1",
    "right_index_intermediate": "mixamorig:RightHandIndex2",
    "right_index_distal": "mixamorig:RightHandIndex3",
    "right_middle_proximal": "mixamorig:RightHandMiddle1",
    "right_middle_intermediate": "mixamorig:RightHandMiddle2",
    "right_middle_distal": "mixamorig:RightHandMiddle3",
    "right_ring_proximal": "mixamorig:RightHandRing1",
    "right_ring_intermediate": "mixamorig:RightHandRing2",
    "right_ring_distal": "mixamorig:RightHandRing3",
    "right_little_proximal": "mixamorig:RightHandPinky1",
    "right_little_intermediate": "mixamorig:RightHandPinky2",
    "right_little_distal": "mixamorig:RightHandPinky3",
}


ORIGINAL_SHAPES = {
    "aa": "blendShape2.vrc_v_aa",
    "ih": "blendShape8.vrc_v_ih",
    "ou": "blendShape12.vrc_v_ou",
    "ee": "blendShape6.vrc_v_ee",
    "oh": "blendShape11.vrc_v_oh",
    "blink": "blendShape3.vrc_blink",
    "happy": "blendShape6.vrc_v_ee",
    "sad": "blendShape12.vrc_v_ou",
    "angry": "blendShape16.vrc_v_th",
    "relaxed": "blendShape1.vrc_v_sil",
    "surprised": "blendShape11.vrc_v_oh",
}


def clear_scene():
    """Remove the current scene without resetting Blender or its MCP server."""
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


def add_eye_bones(armature):
    bpy.context.view_layer.objects.active = armature
    armature.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    head_bone = armature.data.edit_bones[HEAD_BONE_NAME]
    for suffix, sign in (("L", 1.0), ("R", -1.0)):
        bone = armature.data.edit_bones.new(EYE_BONE_PREFIX + suffix)
        bone.head = (0.017 * sign, -0.125, 1.610)
        bone.tail = (0.017 * sign, -0.125, 1.630)
        bone.parent = head_bone
        bone.use_connect = False
    bpy.ops.object.mode_set(mode="OBJECT")


def make_mtoon_material(name, color, *, emission=0.0, roughness=0.48):
    material = bpy.data.materials.new(name)
    material.diffuse_color = color
    material.use_nodes = True
    shader = material.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = color
    shader.inputs["Roughness"].default_value = roughness
    if emission:
        shader.inputs["Emission Color"].default_value = color
        shader.inputs["Emission Strength"].default_value = emission

    mtoon = material.vrm_addon_extension.mtoon1
    mtoon.enabled = True
    mtoon.pbr_metallic_roughness.base_color_factor = color
    mtoon.emissive_factor = tuple(channel * min(emission, 1.0) for channel in color[:3])
    vrmc = mtoon.extensions.vrmc_materials_mtoon
    vrmc.shade_color_factor = tuple(max(0.0, channel * 0.42) for channel in color[:3])
    vrmc.shading_toony_factor = 0.91
    vrmc.gi_equalization_factor = 0.78
    return material


def rig_primitive(obj, armature, bone_name, material):
    obj.data.materials.append(material)
    group = obj.vertex_groups.new(name=bone_name)
    group.add(list(range(len(obj.data.vertices))), 1.0, "REPLACE")
    modifier = obj.modifiers.new("TS_Orion_Armature", "ARMATURE")
    modifier.object = armature
    obj.parent = armature
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    return obj


def add_shape_key(obj, name, transform):
    if obj.data.shape_keys is None:
        obj.shape_key_add(name="Basis")
    key = obj.shape_key_add(name=name)
    for point in key.data:
        transform(point.co)


def add_face_rig(armature):
    eye_material = make_mtoon_material(
        "TS_Orion_EyeGlow", (0.08, 0.72, 1.0, 1.0), emission=0.72, roughness=0.25
    )
    pupil_material = make_mtoon_material(
        "TS_Orion_Pupil", (0.008, 0.018, 0.030, 1.0), roughness=0.20
    )
    brow_material = make_mtoon_material(
        "TS_Orion_Brow", (0.035, 0.075, 0.11, 1.0), roughness=0.36
    )
    targets = {"eyes": [], "brows": []}

    for suffix, sign in (("L", 1.0), ("R", -1.0)):
        x = 0.017 * sign
        bpy.ops.mesh.primitive_uv_sphere_add(
            segments=20,
            ring_count=12,
            location=(x, -0.1515, 1.610),
        )
        eye = bpy.context.object
        eye.name = "TS_Orion_EyePanel_" + suffix
        eye.scale = (0.0135, 0.0040, 0.0055)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        rig_primitive(eye, armature, EYE_BONE_PREFIX + suffix, eye_material)
        add_shape_key(eye, "Blink", lambda coordinate: setattr(coordinate, "z", coordinate.z * 0.08))
        add_shape_key(eye, "Wide", lambda coordinate: setattr(coordinate, "z", coordinate.z * 1.34))
        add_shape_key(eye, "Squint", lambda coordinate: setattr(coordinate, "z", coordinate.z * 0.48))
        targets["eyes"].append(eye)

        bpy.ops.mesh.primitive_uv_sphere_add(
            segments=16,
            ring_count=10,
            location=(x, -0.1555, 1.610),
        )
        pupil = bpy.context.object
        pupil.name = "TS_Orion_Pupil_" + suffix
        pupil.scale = (0.0032, 0.0020, 0.0032)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        rig_primitive(pupil, armature, EYE_BONE_PREFIX + suffix, pupil_material)

        bpy.ops.mesh.primitive_uv_sphere_add(
            segments=16,
            ring_count=8,
            location=(x, -0.1525, 1.622),
        )
        brow = bpy.context.object
        brow.name = "TS_Orion_Brow_" + suffix
        brow.scale = (0.0145, 0.0030, 0.0022)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        rig_primitive(brow, armature, HEAD_BONE_NAME, brow_material)
        add_shape_key(brow, "HappyBrow", lambda coordinate: setattr(coordinate, "z", coordinate.z + abs(coordinate.x) * 0.14))
        add_shape_key(brow, "SadBrow", lambda coordinate: setattr(coordinate, "z", coordinate.z - abs(coordinate.x) * 0.16))
        add_shape_key(brow, "AngryBrow", lambda coordinate, direction=sign: setattr(coordinate, "z", coordinate.z - direction * coordinate.x * 0.20))
        add_shape_key(brow, "RelaxedBrow", lambda coordinate: setattr(coordinate, "z", coordinate.z + 0.002))
        add_shape_key(brow, "SurprisedBrow", lambda coordinate: setattr(coordinate, "z", coordinate.z + 0.010))
        targets["brows"].append(brow)

    return targets


def configure_meta_and_humanoid(armature):
    extension = armature.data.vrm_addon_extension
    extension.spec_version = "1.0"
    meta = extension.vrm1.meta
    meta.vrm_name = "오리온 (로봇)"
    meta.version = "2.0.0-vrm1-repair"
    meta.authors.clear()
    meta.authors.add().value = "Polygonal Mind"
    meta.copyright_information = "Original avatar by Polygonal Mind; VRM 1.0 repair by ToonSpectrum"
    meta.contact_information = "www.PolygonalMind.com"
    meta.references.clear()
    meta.references.add().value = "Immutable source SHA-256: efa262d131a6bd919c1a776f0707c2d358bfb3bf0b82e6886b43d873969574f5"
    meta.references.add().value = "Source VRM0 embedded meta: author=Polygonal Mind; licenseName=CC0"
    meta.references.add().value = "VRM 1.0 rig and expressions repaired by ToonSpectrum with the official Blender VRM Add-on"
    meta.avatar_permission = "everyone"
    meta.commercial_usage = "corporation"
    meta.credit_notation = "unnecessary"
    meta.allow_redistribution = True
    meta.modification = "allowModificationRedistribution"
    # Intentionally blank: the source proves licenseName=CC0 but contains no
    # external license URL. LICENSES.md keeps the exact audit evidence.
    meta.other_license_url = ""
    meta.allow_excessively_violent_usage = True
    meta.allow_excessively_sexual_usage = True
    meta.allow_political_or_religious_usage = True
    meta.allow_antisocial_or_hate_usage = False

    human_bones = extension.vrm1.humanoid.human_bones
    # The VRM0 importer seeds an automatic VRM1 guess in parallel with the
    # source mappings. Clear optional slots so Spine2 cannot remain assigned to
    # both chest and upperChest, then freeze the explicit audited map below.
    human_bones.upper_chest.node.bone_name = ""
    human_bones.jaw.node.bone_name = ""
    human_bones.initial_automatic_bone_assignment = False
    human_bones.filter_by_human_bone_hierarchy = False
    for property_name, bone_name in HUMAN_BONE_MAP.items():
        getattr(human_bones, property_name).node.bone_name = bone_name


def bind_expression(expression, obj, shape_name, weight=1.0):
    binding = expression.morph_target_binds.add()
    binding.node.mesh_object_name = obj.name
    binding.index = shape_name
    binding.weight = weight


def configure_expressions(armature, body, targets):
    preset = armature.data.vrm_addon_extension.vrm1.expressions.preset
    left_eye, right_eye = targets["eyes"]
    left_brow, right_brow = targets["brows"]

    bind_expression(preset.blink, left_eye, "Blink")
    bind_expression(preset.blink, right_eye, "Blink")
    bind_expression(preset.blink_left, left_eye, "Blink")
    bind_expression(preset.blink_right, right_eye, "Blink")
    for property_name in ("aa", "ih", "ou", "ee", "oh"):
        bind_expression(getattr(preset, property_name), body, ORIGINAL_SHAPES[property_name])

    emotion_bindings = (
        (preset.happy, "happy", "HappyBrow", "Squint", 0.58),
        (preset.sad, "sad", "SadBrow", None, 0.52),
        (preset.angry, "angry", "AngryBrow", "Squint", 0.46),
        (preset.relaxed, "relaxed", "RelaxedBrow", None, 0.62),
        (preset.surprised, "surprised", "SurprisedBrow", "Wide", 1.0),
    )
    for expression, source_key, brow_key, eye_key, mouth_weight in emotion_bindings:
        bind_expression(expression, body, ORIGINAL_SHAPES[source_key], mouth_weight)
        bind_expression(expression, left_brow, brow_key, 0.86)
        bind_expression(expression, right_brow, brow_key, 0.86)
        if eye_key:
            bind_expression(expression, left_eye, eye_key, 0.68)
            bind_expression(expression, right_eye, eye_key, 0.68)


def repair_orion():
    clear_scene()
    result = bpy.ops.import_scene.vrm(filepath=SOURCE_PATH)
    if result != {"FINISHED"}:
        raise RuntimeError("Orion source import failed: " + repr(result))

    armatures = [obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"]
    bodies = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    if len(armatures) != 1 or len(bodies) != 1:
        raise RuntimeError(
            "Unexpected Orion source structure: "
            + repr((len(armatures), len(bodies)))
        )
    armature = armatures[0]
    body = bodies[0]
    armature.name = "Avatar_Orion_Rig"
    body.name = "Avatar_Orion_Body"
    for obj in list(bpy.context.scene.objects):
        if obj.type == "EMPTY":
            bpy.data.objects.remove(obj, do_unlink=True)

    expected_shapes = set(ORIGINAL_SHAPES.values())
    available_shapes = set(body.data.shape_keys.key_blocks.keys())
    if not expected_shapes.issubset(available_shapes):
        raise RuntimeError(
            "Orion source lost required morphs: "
            + ", ".join(sorted(expected_shapes - available_shapes))
        )

    add_eye_bones(armature)
    configure_meta_and_humanoid(armature)
    targets = add_face_rig(armature)
    configure_expressions(armature, body, targets)

    bpy.ops.object.select_all(action="SELECT")
    bpy.context.view_layer.objects.active = armature
    validation = bpy.ops.vrm.model_validate(
        "EXEC_DEFAULT",
        show_successful_message=False,
        armature_object_name=armature.name,
    )
    if validation != {"FINISHED"}:
        raise RuntimeError("Orion VRM 1.0 validation failed: " + repr(validation))
    result = bpy.ops.export_scene.vrm(
        filepath=OUTPUT_PATH,
        armature_object_name=armature.name,
        use_addon_preferences=False,
        export_invisibles=False,
        export_only_selections=True,
        enable_advanced_preferences=True,
        export_all_influences=False,
        export_lights=False,
        export_gltf_animations=False,
        export_try_sparse_sk=True,
        ignore_warning=True,
    )
    if result != {"FINISHED"}:
        raise RuntimeError("Orion VRM 1.0 export failed: " + repr(result))
    print(
        "ORION_VRM1_REPAIR_COMPLETE",
        len(armature.data.bones),
        len(HUMAN_BONE_MAP),
        OUTPUT_PATH,
    )


if __name__ == "__main__":
    repair_orion()
