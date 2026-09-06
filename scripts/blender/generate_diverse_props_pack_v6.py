"""Generate ToonSpectrum's diverse prop pack v6 + furniture quality upgrades.

Adds 16 new first-party GLB props across food/nature/urban/interior/fantasy/
sci-fi themes and rebuilds the five legacy core-furniture assets (blackboard,
desk, chair, round_table, sofa) at higher quality in place.

Run with Blender 5.2::

    blender -b --python scripts/blender/generate_diverse_props_pack_v6.py

Self-contained procedural geometry, CC0, no external resources.
"""

import math
import os

import bpy
from mathutils import Vector

OUT_DIR = bpy.path.abspath("//apps/web/public/assets/3d")
GENERATOR = "scripts/blender/generate_diverse_props_pack_v6.py"


def clear_scene():
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for block in (bpy.data.meshes, bpy.data.materials, bpy.data.curves):
        for item in list(block):
            if item.users == 0:
                block.remove(item)


def mat(name, color, metallic=0.0, roughness=0.55, emission=None, emission_strength=0.0, alpha=1.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes.get("Principled BSDF")
    p.inputs["Base Color"].default_value = (*color, 1.0)
    p.inputs["Metallic"].default_value = metallic
    p.inputs["Roughness"].default_value = roughness
    if emission:
        p.inputs["Emission Color"].default_value = (*emission, 1.0)
        p.inputs["Emission Strength"].default_value = emission_strength
    if alpha < 1.0:
        p.inputs["Alpha"].default_value = alpha
        try:
            m.blend_method = "BLEND"
        except AttributeError:
            pass
    return m


def smooth(obj, levels=2):
    mod = obj.modifiers.new("Subsurf", "SUBSURF")
    mod.levels = levels
    mod.render_levels = levels
    obj.modifiers.new("Bevel", "BEVEL").width = 0.004
    for poly in obj.data.polygons:
        poly.use_smooth = True


def link(obj):
    bpy.context.scene.collection.objects.link(obj)


def box(name, size, loc, material, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.active_object
    o.name = name
    o.scale = size
    o.data.materials.append(material)
    return o


def cyl(name, r, depth, loc, material, verts=32, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=depth, vertices=verts, location=loc, rotation=rot)
    o = bpy.context.active_object
    o.name = name
    o.data.materials.append(material)
    return o


def sphere(name, r, loc, material, seg=32, ring=16):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, segments=seg, ring_count=ring, location=loc)
    o = bpy.context.active_object
    o.name = name
    o.data.materials.append(material)
    smooth(o, 2)
    return o


def torus(name, r1, r2, loc, material, rot=(math.pi / 2, 0, 0)):
    bpy.ops.mesh.primitive_torus_add(major_radius=r1, minor_radius=r2, location=loc, rotation=rot)
    o = bpy.context.active_object
    o.name = name
    o.data.materials.append(material)
    smooth(o, 2)
    return o


def cone(name, r, depth, loc, material, verts=32, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cone_add(radius1=r, radius2=0, depth=depth, vertices=verts, location=loc, rotation=rot)
    o = bpy.context.active_object
    o.name = name
    o.data.materials.append(material)
    return o


def export(filename):
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=os.path.join(OUT_DIR, filename),
        export_format="GLB",
        export_apply=True,
    )
    size = os.path.getsize(os.path.join(OUT_DIR, filename))
    print(f"EXPORTED {filename} ({size} bytes)")


# ───────────────────────── new diverse props ─────────────────────────


def build_ramen_bowl():
    clear_scene()
    bowl_m = mat("BowlCeramic", (0.92, 0.9, 0.86, ), roughness=0.25)
    rim_m = mat("RimRed", (0.75, 0.15, 0.12), roughness=0.35)
    broth_m = mat("Broth", (0.85, 0.55, 0.18), roughness=0.15)
    noodle_m = mat("Noodles", (0.95, 0.82, 0.5), roughness=0.4)
    egg_m = mat("Egg", (0.96, 0.93, 0.85), roughness=0.3)
    nori_m = mat("Nori", (0.08, 0.12, 0.08), roughness=0.6)

    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.055, segments=48, ring_count=24, location=(0, 0, 0.03))
    bowl = bpy.context.active_object
    bowl.name = "Bowl_Body"
    bowl.scale = (1, 1, 0.72)
    bpy.ops.object.transform_apply(scale=True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="DESELECT")
    bpy.ops.object.mode_set(mode="OBJECT")
    bmesh_top_delete(bowl)
    solidify(bowl, 0.004)
    bowl.data.materials.append(bowl_m)

    torus("Bowl_Rim", 0.054, 0.004, (0, 0, 0.058), rim_m)
    cyl("Broth_Surface", 0.05, 0.002, (0, 0, 0.05), broth_m, verts=48)
    for i in range(7):
        a = i / 7 * math.tau
        n = cyl(f"Noodle_{i}", 0.0035, 0.09, (math.cos(a) * 0.02, math.sin(a) * 0.02, 0.052), noodle_m, verts=8,
                rot=(math.pi / 2 - 0.35, a * 0.3, a))
        n.scale = (1, 1, 1)
    half = sphere("Egg_Half", 0.017, (0.028, 0.01, 0.058), egg_m, seg=24, ring=12)
    half.scale = (1, 1, 0.55)
    box("Nori_Sheet", (0.03, 0.001, 0.045), (-0.03, -0.015, 0.07), nori_m, rot=(0.12, 0.1, 0))
    export("ramen_bowl.glb")


def bmesh_top_delete(obj):
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    faces = [f for f in bm.faces if all(v.co.z > 0.048 for v in f.verts)]
    bmesh.ops.delete(bm, geom=faces, context="FACES")
    bm.to_mesh(obj.data)
    bm.free()


def solidify(obj, thickness):
    mod = obj.modifiers.new("Solidify", "SOLIDIFY")
    mod.thickness = thickness
    mod.offset = 1


def build_ice_cream_cone():
    clear_scene()
    cone_m = mat("WaffleCone", (0.78, 0.58, 0.34), roughness=0.6)
    straw_m = mat("Strawberry", (0.94, 0.62, 0.72), roughness=0.35)
    van_m = mat("Vanilla", (0.97, 0.94, 0.84), roughness=0.35)
    mint_m = mat("Mint", (0.7, 0.9, 0.78), roughness=0.35)
    cherry_m = mat("Cherry", (0.8, 0.1, 0.15), roughness=0.2)

    c = cone("Cone_Waffle", 0.026, 0.11, (0, 0, 0.055), cone_m, verts=24)
    smooth(c, 1)
    s1 = sphere("Scoop_Strawberry", 0.027, (0, 0, 0.125), straw_m, seg=28, ring=14)
    s1.scale = (1, 1, 0.85)
    s2 = sphere("Scoop_Vanilla", 0.025, (0.008, 0.004, 0.168), van_m, seg=28, ring=14)
    s2.scale = (1, 1, 0.85)
    s3 = sphere("Scoop_Mint", 0.023, (-0.006, -0.004, 0.205), mint_m, seg=28, ring=14)
    s3.scale = (1, 1, 0.85)
    sphere("Cherry_Top", 0.011, (0, 0, 0.232), cherry_m, seg=20, ring=10)
    export("ice_cream_cone.glb")


def build_bubble_tea():
    clear_scene()
    cup_m = mat("CupPlastic", (0.95, 0.98, 1.0), roughness=0.1, alpha=0.45)
    tea_m = mat("MilkTea", (0.82, 0.64, 0.42), roughness=0.2)
    pearl_m = mat("Pearls", (0.12, 0.08, 0.08), roughness=0.25)
    lid_m = mat("LidFilm", (0.9, 0.92, 0.95), roughness=0.3)
    straw_m = mat("Straw", (0.95, 0.45, 0.6), roughness=0.3)

    cup = cyl("Cup_Body", 0.032, 0.13, (0, 0, 0.065), cup_m, verts=40)
    smooth(cup, 1)
    cyl("Tea_Fill", 0.029, 0.1, (0, 0, 0.06), tea_m, verts=36)
    for i in range(14):
        a = i * 2.399963
        r = 0.021 * math.sqrt(i / 14)
        sphere(f"Pearl_{i}", 0.0055, (math.cos(a) * r, math.sin(a) * r, 0.008 + (i % 3) * 0.004), pearl_m, seg=12, ring=8)
    cyl("Cup_Lid", 0.033, 0.002, (0, 0, 0.131), lid_m, verts=40)
    st = cyl("Straw_Body", 0.005, 0.09, (0.008, 0, 0.165), straw_m, verts=16)
    st.rotation_euler = (0.12, 0.06, 0)
    export("bubble_tea.glb")


def build_paper_lantern():
    clear_scene()
    paper_m = mat("PaperWarm", (1.0, 0.85, 0.6), roughness=0.7, emission=(1.0, 0.75, 0.4), emission_strength=2.2)
    cap_m = mat("CapWood", (0.45, 0.3, 0.18), roughness=0.6)
    tassel_m = mat("TasselRed", (0.8, 0.12, 0.12), roughness=0.6)

    body = sphere("Lantern_Paper", 0.055, (0, 0, 0.09), paper_m, seg=32, ring=20)
    body.scale = (1, 1, 1.25)
    cyl("Lantern_TopCap", 0.02, 0.012, (0, 0, 0.162), cap_m, verts=24)
    cyl("Lantern_BottomCap", 0.02, 0.012, (0, 0, 0.018), cap_m, verts=24)
    for rib_i in range(6):
        a = rib_i / 6 * math.pi
        torus(f"Lantern_Rib_{rib_i}", 0.052 * math.sin(max(a, 0.25)), 0.0015, (0, 0, 0.09), cap_m,
                  rot=(a, 0, 0))
    cyl("Lantern_Tassel", 0.006, 0.05, (0, 0, -0.012), tassel_m, verts=12)
    export("paper_lantern.glb")


def build_potted_monstera():
    clear_scene()
    pot_m = mat("PotTerracotta", (0.72, 0.4, 0.28), roughness=0.65)
    soil_m = mat("Soil", (0.16, 0.11, 0.08), roughness=0.9)
    leaf_m = mat("LeafGreen", (0.16, 0.45, 0.2), roughness=0.45)
    stem_m = mat("StemGreen", (0.3, 0.5, 0.25), roughness=0.5)

    pot = cone("Pot_Body", 0.075, 0.11, (0, 0, 0.055), pot_m, verts=36)
    pot.rotation_euler = (math.pi, 0, 0)
    pot.location.z = 0.115
    cyl("Pot_Rim", 0.078, 0.014, (0, 0, 0.112), pot_m, verts=36)
    cyl("Pot_Soil", 0.068, 0.006, (0, 0, 0.108), soil_m, verts=32)

    leaf_specs = (
        (0.0, 0.19, 0.30, 0.0, 0.0),
        (0.22, 0.16, 0.26, 0.5, 0.4),
        (-0.2, 0.17, 0.24, -0.5, -0.4),
        (0.1, 0.23, 0.2, 0.25, 0.8),
        (-0.12, 0.22, 0.22, -0.3, -0.8),
    )
    for i, (x, z_stem, z_leaf, tilt, yaw) in enumerate(leaf_specs):
        cyl(f"Monstera_Stem_{i}", 0.004, z_stem, (x * 0.4, 0, 0.11 + z_stem / 2), stem_m, verts=8,
            rot=(tilt * 0.4, 0, 0))
        leaf = sphere(f"Monstera_Leaf_{i}", 0.05, (x, 0, 0.11 + z_leaf), leaf_m, seg=20, ring=12)
        leaf.scale = (1.15, 0.75, 0.12)
        leaf.rotation_euler = (tilt, yaw, 0)
    export("potted_monstera.glb")


def build_bonsai_tree():
    clear_scene()
    pot_m = mat("BonsaiPot", (0.35, 0.22, 0.16), roughness=0.4)
    trunk_m = mat("TrunkBark", (0.38, 0.27, 0.18), roughness=0.8)
    foliage_m = mat("FoliageDeep", (0.12, 0.32, 0.18), roughness=0.55)

    box("Bonsai_Pot", (0.16, 0.11, 0.045), (0, 0, 0.0225), pot_m)
    cyl("Bonsai_Trunk", 0.016, 0.14, (0.01, 0, 0.1), trunk_m, verts=12, rot=(0, 0.18, 0))
    cyl("Bonsai_Branch", 0.008, 0.09, (-0.045, 0.01, 0.15), trunk_m, verts=10, rot=(0, 1.1, 0))
    blob_positions = ((0.02, 0, 0.2, 0.055), (-0.07, 0.01, 0.175, 0.042), (0.07, -0.01, 0.185, 0.04),
                      (0.0, 0.03, 0.235, 0.036))
    for i, (x, y, z, r) in enumerate(blob_positions):
        b = sphere(f"Bonsai_Foliage_{i}", r, (x, y, z), foliage_m, seg=20, ring=12)
        b.scale = (1.2, 1.0, 0.7)
    export("bonsai_tree.glb")


def build_street_food_cart():
    clear_scene()
    wood_m = mat("CartWood", (0.55, 0.36, 0.2), roughness=0.7)
    metal_m = mat("CartSteel", (0.75, 0.76, 0.78), metallic=0.85, roughness=0.3)
    canvas_m = mat("CanvasRoof", (0.85, 0.3, 0.25), roughness=0.8)
    wheel_m = mat("WheelRubber", (0.12, 0.12, 0.13), roughness=0.9)
    glow_m = mat("LanternGlow", (1.0, 0.8, 0.45), emission=(1.0, 0.75, 0.4), emission_strength=3.0)

    box("Cart_Counter", (0.9, 0.55, 0.06), (0, 0, 0.78), wood_m)
    box("Cart_Body", (0.86, 0.5, 0.5), (0, 0, 0.5), wood_m)
    box("Cart_Shelf", (0.8, 0.44, 0.03), (0, 0.02, 0.32), wood_m)
    for x in (-0.38, 0.38):
        cyl(f"Cart_Leg_{x:.2f}", 0.02, 0.52, (x, -0.2, 0.26), metal_m, verts=12)
    for x in (-0.3, 0.3):
        for y in (-0.24, 0.24):
            w = cyl(f"Cart_Wheel_{x:.2f}_{y:.2f}", 0.09, 0.035, (x, y, 0.09), wheel_m, verts=24, rot=(0, math.pi / 2, 0))
            w.data.materials.append(wheel_m)
    for x in (-0.42, 0.42):
        cyl(f"Cart_Pole_{x:.2f}", 0.015, 0.75, (x, -0.24, 1.17), metal_m, verts=10)
    roof = box("Cart_Roof", (1.0, 0.62, 0.03), (0, 0.02, 1.56), canvas_m, rot=(0.08, 0, 0))
    roof.name = "Cart_Roof"
    for x in (-0.3, 0.0, 0.3):
        sphere(f"Cart_Lantern_{x:.1f}", 0.028, (x, -0.2, 1.42), glow_m, seg=16, ring=10)
    export("street_food_cart.glb")


def build_traffic_light():
    clear_scene()
    body_m = mat("HousingYellow", (0.85, 0.65, 0.1), roughness=0.5)
    pole_m = mat("PoleSteel", (0.45, 0.47, 0.5), metallic=0.8, roughness=0.4)
    red_m = mat("LightRed", (0.9, 0.1, 0.08), emission=(1.0, 0.1, 0.05), emission_strength=4.0)
    amber_m = mat("LightAmber", (0.95, 0.6, 0.05), emission=(1.0, 0.6, 0.05), emission_strength=1.2)
    green_m = mat("LightGreen", (0.1, 0.85, 0.25), emission=(0.1, 0.9, 0.2), emission_strength=1.2)

    cyl("Signal_Pole", 0.035, 2.6, (0, 0, 1.3), pole_m, verts=20)
    cyl("Signal_Base", 0.14, 0.05, (0, 0, 0.025), pole_m, verts=24)
    box("Signal_Housing", (0.16, 0.14, 0.52), (0, 0.02, 2.5), body_m)
    cyl("Signal_Lens_Red", 0.05, 0.02, (0, -0.06, 2.66), red_m, verts=24, rot=(math.pi / 2, 0, 0))
    cyl("Signal_Lens_Amber", 0.05, 0.02, (0, -0.06, 2.5), amber_m, verts=24, rot=(math.pi / 2, 0, 0))
    cyl("Signal_Lens_Green", 0.05, 0.02, (0, -0.06, 2.34), green_m, verts=24, rot=(math.pi / 2, 0, 0))
    cyl("Signal_Arm", 0.025, 0.5, (0.25, 0, 2.62), pole_m, verts=12, rot=(0, math.pi / 2, 0))
    export("traffic_light.glb")


def build_mailbox():
    clear_scene()
    body_m = mat("BoxRed", (0.75, 0.15, 0.12), roughness=0.45)
    door_m = mat("DoorDark", (0.2, 0.2, 0.22), roughness=0.4)
    leg_m = mat("LegSteel", (0.4, 0.42, 0.45), metallic=0.8, roughness=0.35)

    body = cyl("Mailbox_Body", 0.09, 0.34, (0, 0, 0.85), body_m, verts=28, rot=(0, math.pi / 2, 0))
    smooth(body, 2)
    half = bpy.data.objects.new("Mailbox_Door", None)
    bpy.data.objects.remove(half)
    cyl("Mailbox_DoorFace", 0.088, 0.015, (0.172, 0, 0.85), door_m, verts=28, rot=(0, math.pi / 2, 0))
    box("Mailbox_Slot", (0.004, 0.11, 0.018), (0.181, 0, 0.88), door_m)
    box("Mailbox_Flag", (0.008, 0.03, 0.12), (-0.05, -0.095, 0.98), door_m, rot=(0, 0, 0.2))
    for x in (-0.08, 0.08):
        cyl(f"Mailbox_Leg_{x:.2f}", 0.012, 0.68, (x, 0, 0.34), leg_m, verts=10)
    export("mailbox.glb")


def build_grandfather_clock():
    clear_scene()
    wood_m = mat("ClockWalnut", (0.32, 0.2, 0.12), roughness=0.5)
    face_m = mat("ClockFace", (0.95, 0.93, 0.86), roughness=0.3)
    gold_m = mat("ClockBrass", (0.85, 0.68, 0.3), metallic=0.9, roughness=0.25)
    glass_m = mat("ClockGlass", (0.8, 0.9, 0.95), roughness=0.05, alpha=0.25)
    pend_m = mat("PendulumBrass", (0.9, 0.75, 0.35), metallic=0.95, roughness=0.15)

    box("Clock_Body", (0.42, 0.26, 1.9), (0, 0, 0.95), wood_m)
    box("Clock_Crown", (0.48, 0.3, 0.08), (0, 0, 1.94), wood_m)
    box("Clock_Base", (0.46, 0.3, 0.1), (0, 0, 0.05), wood_m)
    cyl("Clock_FaceDisc", 0.155, 0.02, (0, -0.135, 1.62), face_m, verts=48, rot=(math.pi / 2, 0, 0))
    torus("Clock_FaceRing", 0.157, 0.012, (0, -0.135, 1.62), gold_m, rot=(0, 0, 0))
    box("Clock_HandHour", (0.012, 0.004, 0.07), (0, -0.148, 1.655), gold_m, rot=(0, 0.6, 0))
    box("Clock_HandMinute", (0.008, 0.004, 0.12), (0, -0.148, 1.69), gold_m, rot=(0, -0.25, 0))
    cyl("Clock_PendulumRod", 0.004, 0.7, (0, -0.05, 0.85), gold_m, verts=8)
    cyl("Clock_PendulumBob", 0.055, 0.008, (0, -0.05, 0.5), pend_m, verts=32, rot=(math.pi / 2, 0, 0))
    box("Clock_GlassPane", (0.3, 0.004, 1.0), (0, -0.132, 0.85), glass_m)
    export("grandfather_clock.glb")


def build_fireplace():
    clear_scene()
    brick_m = mat("BrickRed", (0.55, 0.26, 0.2), roughness=0.8)
    stone_m = mat("HearthStone", (0.75, 0.73, 0.68), roughness=0.85)
    wood_m = mat("MantelWood", (0.4, 0.26, 0.15), roughness=0.55)
    fire_m = mat("FireGlow", (1.0, 0.5, 0.1), emission=(1.0, 0.45, 0.08), emission_strength=5.0)
    log_m = mat("LogWood", (0.3, 0.19, 0.1), roughness=0.9)

    box("Fireplace_BackWall", (1.3, 0.18, 1.25), (0, 0.1, 0.625), brick_m)
    box("Fireplace_LeftColumn", (0.22, 0.4, 1.25), (-0.54, 0, 0.625), brick_m)
    box("Fireplace_RightColumn", (0.22, 0.4, 1.25), (0.54, 0, 0.625), brick_m)
    box("Fireplace_Mantel", (1.4, 0.5, 0.09), (0, 0, 1.29), wood_m)
    box("Fireplace_HearthBase", (1.5, 0.62, 0.07), (0, 0, 0.035), stone_m)
    box("Fireplace_FireboxTop", (0.86, 0.4, 0.12), (0, 0, 1.19), stone_m)
    for i, (x, z, r) in enumerate(((-0.12, 0.14, 0.05), (0.05, 0.13, 0.045), (-0.02, 0.2, 0.04))):
        f = sphere(f"Fireplace_Flame_{i}", r, (x, -0.02, z), fire_m, seg=14, ring=10)
        f.scale = (0.7, 0.7, 1.6)
    for i, x in enumerate((-0.16, 0.02, 0.14)):
        cyl(f"Fireplace_Log_{i}", 0.035, 0.5, (x, -0.02, 0.09), log_m, verts=12, rot=(math.pi / 2, 0, 0))
    export("fireplace.glb")


def build_bathtub():
    clear_scene()
    porcelain_m = mat("PorcelainWhite", (0.96, 0.97, 0.98), roughness=0.08)
    water_m = mat("BathWater", (0.55, 0.8, 0.95), roughness=0.05, alpha=0.6)
    faucet_m = mat("FaucetChrome", (0.85, 0.87, 0.9), metallic=0.95, roughness=0.1)

    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0.28))
    tub = bpy.context.active_object
    tub.name = "Bathtub_Shell"
    tub.scale = (0.85, 0.45, 0.56)
    bpy.ops.object.transform_apply(scale=True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="DESELECT")
    bpy.ops.object.mode_set(mode="OBJECT")
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(tub.data)
    top_faces = [f for f in bm.faces if all(v.co.z > 0.27 for v in f.verts)]
    inner_faces = [f for f in bm.faces if any(abs(v.co.x) < 0.33 and abs(v.co.y) < 0.16 and v.co.z > 0.2 for v in f.verts)]
    bmesh.ops.delete(bm, geom=top_faces + inner_faces, context="FACES")
    bm.to_mesh(tub.data)
    bm.free()
    solidify(tub, 0.03)
    tub.data.materials.append(porcelain_m)
    smooth(tub, 2)

    box("Bathtub_WaterSurface", (0.74, 0.36, 0.01), (0, 0, 0.42), water_m)
    cyl("Bathtub_FaucetBase", 0.02, 0.03, (0.36, 0, 0.57), faucet_m, verts=16)
    cyl("Bathtub_FaucetSpout", 0.014, 0.16, (0.29, 0, 0.6), faucet_m, verts=14, rot=(0, 1.35, 0))
    for x in (-0.3, 0.3):
        sphere(f"Bathtub_Foot_{x:.1f}", 0.035, (x, 0, 0.035), faucet_m, seg=16, ring=10)
    export("bathtub.glb")


def build_kitchen_stove():
    clear_scene()
    body_m = mat("StoveCream", (0.92, 0.9, 0.84), roughness=0.4)
    top_m = mat("CooktopSteel", (0.78, 0.8, 0.83), metallic=0.85, roughness=0.25)
    burner_m = mat("BurnerBlack", (0.1, 0.1, 0.11), roughness=0.6)
    knob_m = mat("KnobRed", (0.75, 0.15, 0.12), roughness=0.4)
    grate_m = mat("GrateIron", (0.2, 0.2, 0.22), metallic=0.6, roughness=0.5)

    box("Stove_Body", (0.6, 0.6, 0.85), (0, 0, 0.425), body_m)
    box("Stove_Cooktop", (0.62, 0.62, 0.04), (0, 0, 0.87), top_m)
    box("Stove_OvenDoor", (0.5, 0.02, 0.45), (0, -0.31, 0.38), top_m)
    cyl("Stove_OvenHandle", 0.012, 0.5, (0, -0.33, 0.63), top_m, verts=12, rot=(0, math.pi / 2, 0))
    for i, (x, y) in enumerate(((-0.15, 0.15), (0.15, 0.15), (-0.15, -0.15), (0.15, -0.15))):
        cyl(f"Stove_Burner_{i}", 0.07, 0.012, (x, y, 0.895), burner_m, verts=24)
        torus(f"Stove_Grate_{i}", 0.06, 0.006, (x, y, 0.905), grate_m)
    for i, x in enumerate((-0.18, -0.06, 0.06, 0.18)):
        cyl(f"Stove_Knob_{i}", 0.02, 0.02, (x, -0.315, 0.79), knob_m, verts=16, rot=(math.pi / 2, 0, 0))
    export("kitchen_stove.glb")


def build_campfire():
    clear_scene()
    log_m = mat("CampLog", (0.35, 0.22, 0.12), roughness=0.9)
    flame_m = mat("FlameOrange", (1.0, 0.45, 0.08), emission=(1.0, 0.4, 0.05), emission_strength=6.0)
    flame_core_m = mat("FlameCore", (1.0, 0.85, 0.3), emission=(1.0, 0.8, 0.25), emission_strength=8.0)
    stone_m = mat("FireRingStone", (0.5, 0.48, 0.45), roughness=0.9)

    for i in range(8):
        a = i / 8 * math.tau
        s = sphere(f"Campfire_Stone_{i}", 0.055, (math.cos(a) * 0.32, math.sin(a) * 0.32, 0.03), stone_m, seg=12, ring=8)
        s.scale = (1, 0.85, 0.6)
    for i in range(5):
        a = i / 5 * math.pi
        cyl(f"Campfire_Log_{i}", 0.045, 0.55, (0, 0, 0.07), log_m, verts=10, rot=(math.pi / 2 - 0.25, 0, a))
    cone("Campfire_FlameOuter", 0.16, 0.42, (0, 0, 0.24), flame_m, verts=16)
    cone("Campfire_FlameInner", 0.09, 0.26, (0, 0, 0.2), flame_core_m, verts=12)
    export("campfire.glb")


def build_wishing_well():
    clear_scene()
    stone_m = mat("WellStone", (0.6, 0.58, 0.55), roughness=0.9)
    wood_m = mat("WellTimber", (0.42, 0.28, 0.16), roughness=0.75)
    roof_m = mat("WellShingle", (0.5, 0.2, 0.16), roughness=0.7)
    rope_m = mat("WellRope", (0.7, 0.6, 0.4), roughness=0.9)
    bucket_m = mat("WellBucket", (0.45, 0.32, 0.2), roughness=0.6)
    water_m = mat("WellWater", (0.2, 0.45, 0.6), roughness=0.1)

    cyl("Well_StoneRing", 0.55, 0.7, (0, 0, 0.35), stone_m, verts=36)
    cyl("Well_Hollow", 0.42, 0.72, (0, 0, 0.35), stone_m, verts=32)
    cyl("Well_WaterSurface", 0.43, 0.01, (0, 0, 0.62), water_m, verts=32)
    for x in (-0.5, 0.5):
        cyl(f"Well_Post_{x:.1f}", 0.05, 1.5, (x, 0, 1.45), wood_m, verts=12)
    cyl("Well_Axle", 0.04, 1.1, (0, 0, 2.1), wood_m, verts=14, rot=(0, math.pi / 2, 0))
    cone("Well_Roof", 0.85, 0.45, (0, 0, 2.5), roof_m, verts=4, rot=(0, 0, math.pi / 4))
    cyl("Well_RopeLine", 0.008, 0.75, (0, 0, 1.72), rope_m, verts=6)
    cyl("Well_Bucket", 0.11, 0.14, (0, 0, 1.28), bucket_m, verts=20)
    torus("Well_BucketHandle", 0.11, 0.008, (0, 0, 1.35), rope_m, rot=(0, 0, 0))
    export("wishing_well.glb")


def build_robot_pet():
    clear_scene()
    shell_m = mat("PetShellWhite", (0.92, 0.93, 0.95), roughness=0.3)
    accent_m = mat("PetAccentBlue", (0.2, 0.55, 0.95), roughness=0.35)
    joint_m = mat("PetJointDark", (0.18, 0.18, 0.2), roughness=0.45)
    eye_m = mat("PetEyeCyan", (0.1, 0.95, 1.0), emission=(0.1, 0.9, 1.0), emission_strength=4.0)

    head = sphere("RobotPet_Head", 0.09, (0, 0, 0.31), shell_m, seg=28, ring=16)
    head.scale = (1.15, 1, 0.9)
    body = sphere("RobotPet_Body", 0.11, (0, 0, 0.15), shell_m, seg=28, ring=16)
    body.scale = (1.25, 1, 0.85)
    for i, x in enumerate((-0.05, 0.05)):
        sphere(f"RobotPet_Eye_{i}", 0.016, (x, -0.082, 0.33), eye_m, seg=14, ring=8)
    sphere("RobotPet_Nose", 0.014, (0, -0.095, 0.28), accent_m, seg=12, ring=8)
    for i, (x, y) in enumerate(((-0.06, -0.06), (0.06, -0.06), (-0.06, 0.06), (0.06, 0.06))):
        cyl(f"RobotPet_Leg_{i}", 0.018, 0.09, (x, y, 0.045), joint_m, verts=10)
        foot = sphere(f"RobotPet_Foot_{i}", 0.024, (x, y, 0.012), joint_m, seg=12, ring=8)
        foot.scale = (1, 1.2, 0.5)
    cyl("RobotPet_Tail", 0.012, 0.1, (0, 0.13, 0.2), joint_m, verts=8, rot=(1.0, 0, 0))
    sphere("RobotPet_TailTip", 0.02, (0, 0.17, 0.26), accent_m, seg=12, ring=8)
    for i, x in enumerate((-0.045, 0.045)):
        cone(f"RobotPet_Ear_{i}", 0.025, 0.05, (x, 0, 0.41), accent_m, verts=12)
    export("robot_pet.glb")


def build_mech_turret():
    clear_scene()
    armor_m = mat("TurretArmor", (0.35, 0.4, 0.45), metallic=0.7, roughness=0.4)
    dark_m = mat("TurretDark", (0.15, 0.16, 0.18), metallic=0.5, roughness=0.5)
    energy_m = mat("TurretEnergy", (0.2, 0.9, 1.0), emission=(0.2, 0.85, 1.0), emission_strength=5.0)

    cyl("Turret_Base", 0.28, 0.12, (0, 0, 0.06), dark_m, verts=32)
    dome = sphere("Turret_Dome", 0.2, (0, 0, 0.16), armor_m, seg=28, ring=16)
    dome.scale = (1, 1, 0.6)
    cyl("Turret_Ring", 0.14, 0.1, (0, 0, 0.28), dark_m, verts=24)
    cyl("Turret_Barrel", 0.035, 0.55, (0, -0.3, 0.36), armor_m, verts=16, rot=(math.pi / 2 - 0.12, 0, 0))
    cyl("Turret_Muzzle", 0.05, 0.06, (0, -0.56, 0.42), dark_m, verts=16, rot=(math.pi / 2 - 0.12, 0, 0))
    sphere("Turret_EnergyCore", 0.05, (0, -0.1, 0.4), energy_m, seg=16, ring=10)
    for i, a in enumerate((0.8, 2.4, 4.0)):
        cyl(f"Turret_Sensor_{i}", 0.012, 0.1, (math.cos(a) * 0.12, math.sin(a) * 0.12, 0.34), energy_m, verts=8,
                     rot=(0.5, 0, a))
    export("mech_turret.glb")


def build_fox_mask():
    clear_scene()
    fur_m = mat("MaskFurOrange", (0.9, 0.5, 0.15), roughness=0.6)
    cream_m = mat("MaskCream", (0.95, 0.9, 0.8), roughness=0.6)
    ink_m = mat("MaskInk", (0.1, 0.1, 0.12), roughness=0.5)

    face = sphere("FoxMask_Face", 0.105, (0, 0, 0), fur_m, seg=32, ring=20)
    face.scale = (1, 0.55, 1.15)
    cone("FoxMask_Snout", 0.035, 0.07, (0, -0.055, -0.045), cream_m, verts=16, rot=(-1.9, 0, 0))
    sphere("FoxMask_NoseTip", 0.014, (0, -0.075, -0.075), ink_m, seg=12, ring=8)
    for i, x in enumerate((-0.055, 0.055)):
        cone(f"FoxMask_Ear_{i}", 0.032, 0.09, (x, 0, 0.12), fur_m, verts=12, rot=(0, 0.12 if x > 0 else -0.12, 0))
        cone(f"FoxMask_EarInner_{i}", 0.018, 0.05, (x, -0.008, 0.115), cream_m, verts=10,
                     rot=(0, 0.12 if x > 0 else -0.12, 0))
    for i, x in enumerate((-0.042, 0.042)):
        eye = sphere(f"FoxMask_Eye_{i}", 0.016, (x, -0.052, 0.015), ink_m, seg=12, ring=8)
        eye.scale = (1, 0.5, 1.4)
    box("FoxMask_WhiskerMark", (0.05, 0.004, 0.008), (0, -0.058, -0.03), ink_m)
    export("fox_mask.glb")


def build_wizard_hat():
    clear_scene()
    cloth_m = mat("HatClothPurple", (0.35, 0.18, 0.55), roughness=0.7)
    band_m = mat("HatBandGold", (0.85, 0.68, 0.25), metallic=0.8, roughness=0.3)
    star_m = mat("HatStarGlow", (1.0, 0.9, 0.4), emission=(1.0, 0.85, 0.3), emission_strength=2.5)

    brim = cyl("WizardHat_Brim", 0.13, 0.012, (0, 0, 0.006), cloth_m, verts=40)
    smooth(brim, 2)
    bpy.ops.mesh.primitive_cone_add(radius1=0.115, radius2=0.008, depth=0.34, vertices=40, location=(0, 0, 0.17))
    cone_obj = bpy.context.active_object
    cone_obj.name = "WizardHat_Cone"
    cone_obj.rotation_euler = (0.1, 0.08, 0)
    cone_obj.data.materials.append(cloth_m)
    smooth(cone_obj, 2)
    cone("WizardHat_Tip", 0.02, 0.08, (0.035, 0.03, 0.36), cloth_m, verts=12, rot=(0.5, 0.4, 0))
    torus("WizardHat_Band", 0.107, 0.012, (0, 0, 0.045), band_m)
    for i, (x, y, z) in enumerate(((0.05, 0.04, 0.14), (-0.05, 0.02, 0.2), (0.02, -0.05, 0.26))):
        sphere(f"WizardHat_Star_{i}", 0.012, (x, y, z), star_m, seg=10, ring=6)
    export("wizard_hat.glb")


def build_tea_set():
    clear_scene()
    porcelain_m = mat("TeaPorcelain", (0.96, 0.95, 0.92), roughness=0.15)
    tea_m = mat("TeaAmber", (0.7, 0.45, 0.15), roughness=0.2)
    tray_m = mat("TrayBamboo", (0.72, 0.58, 0.35), roughness=0.6)

    box("TeaSet_Tray", (0.34, 0.22, 0.015), (0, 0, 0.0075), tray_m)
    pot_body = sphere("Teapot_Body", 0.06, (-0.09, 0, 0.075), porcelain_m, seg=32, ring=18)
    pot_body.scale = (1.1, 1, 0.85)
    cyl("Teapot_Spout", 0.012, 0.08, (-0.16, 0, 0.09), porcelain_m, verts=10, rot=(0, 1.0, 0))
    torus("Teapot_Handle", 0.035, 0.007, (-0.02, 0, 0.08), porcelain_m, rot=(0, 1.57, 0))
    cyl("Teapot_Lid", 0.032, 0.015, (-0.09, 0, 0.128), porcelain_m, verts=24)
    sphere("Teapot_Knob", 0.012, (-0.09, 0, 0.142), porcelain_m, seg=12, ring=8)
    for i, x in enumerate((0.04, 0.12)):
        cup = cyl(f"Teacup_{i}_Body", 0.032, 0.045, (x, 0, 0.045), porcelain_m, verts=28)
        smooth(cup, 1)
        cyl(f"Teacup_{i}_Tea", 0.027, 0.004, (x, 0, 0.062), tea_m, verts=24)
    export("tea_set.glb")


def build_hanging_sign():
    clear_scene()
    wood_m = mat("SignWood", (0.5, 0.34, 0.2), roughness=0.65)
    chain_m = mat("ChainIron", (0.3, 0.3, 0.32), metallic=0.85, roughness=0.4)
    paint_m = mat("SignPaint", (0.85, 0.75, 0.5), roughness=0.5)

    cyl("Sign_BracketBar", 0.015, 0.5, (0.25, 0, 0), chain_m, verts=10, rot=(0, math.pi / 2, 0))
    for x in (0.05, 0.45):
        cyl(f"Sign_Chain_{x:.2f}", 0.006, 0.22, (x, 0, -0.11), chain_m, verts=6)
    box("Sign_Board", (0.44, 0.03, 0.2), (0.25, 0, -0.32), wood_m)
    box("Sign_Frame", (0.47, 0.02, 0.23), (0.25, -0.012, -0.32), wood_m)
    box("Sign_Plate", (0.36, 0.005, 0.12), (0.25, -0.022, -0.32), paint_m)
    export("hanging_sign.glb")


# ─────────────────── legacy furniture quality upgrades ───────────────────


def build_blackboard_upgrade():
    clear_scene()
    frame_m = mat("BoardFrameOak", (0.45, 0.3, 0.17), roughness=0.55)
    slate_m = mat("SlateGreen", (0.12, 0.2, 0.16), roughness=0.75)
    chalk_m = mat("ChalkWhite", (0.95, 0.95, 0.92), roughness=0.6)
    tray_m = mat("TrayAlu", (0.75, 0.76, 0.78), metallic=0.8, roughness=0.35)
    leg_m = mat("LegSteel", (0.4, 0.42, 0.45), metallic=0.85, roughness=0.3)

    box("Blackboard_Surface", (1.8, 0.05, 1.1), (0, 0, 1.45), slate_m)
    box("Blackboard_FrameTop", (1.9, 0.08, 0.06), (0, 0, 2.03), frame_m)
    box("Blackboard_FrameBottom", (1.9, 0.08, 0.06), (0, 0, 0.87), frame_m)
    for x in (-0.92, 0.92):
        box(f"Blackboard_FrameSide_{x:.2f}", (0.06, 0.08, 1.22), (x, 0, 1.45), frame_m)
    box("Blackboard_ChalkTray", (1.7, 0.12, 0.03), (0, -0.06, 0.83), tray_m)
    for i, x in enumerate((-0.5, -0.3)):
        cyl(f"Blackboard_Chalk_{i}", 0.008, 0.06, (x, -0.06, 0.855), chalk_m, verts=8, rot=(0, math.pi / 2, 0))
    box("Blackboard_Eraser", (0.12, 0.05, 0.03), (0.4, -0.06, 0.855), frame_m)
    for x in (-0.7, 0.7):
        cyl(f"Blackboard_Leg_{x:.2f}", 0.025, 0.9, (x, 0, 0.45), leg_m, verts=12)
        cyl(f"Blackboard_Foot_{x:.2f}", 0.05, 0.03, (x, 0, 0.015), leg_m, verts=12)
    export("blackboard.glb")


def build_desk_upgrade():
    clear_scene()
    top_m = mat("DeskTopOak", (0.62, 0.45, 0.28), roughness=0.5)
    leg_m = mat("DeskLegSteel", (0.35, 0.37, 0.4), metallic=0.8, roughness=0.35)
    drawer_m = mat("DrawerFront", (0.55, 0.39, 0.24), roughness=0.45)
    handle_m = mat("HandleChrome", (0.8, 0.82, 0.85), metallic=0.9, roughness=0.2)

    box("Desk_Tabletop", (1.2, 0.6, 0.04), (0, 0, 0.73), top_m)
    box("Desk_ModestyPanel", (1.1, 0.02, 0.3), (0, 0.24, 0.55), top_m)
    for x in (-0.55, 0.55):
        for y in (-0.25, 0.25):
            cyl(f"Desk_Leg_{x:.2f}_{y:.2f}", 0.022, 0.71, (x, y, 0.355), leg_m, verts=14)
    box("Desk_DrawerUnit", (0.35, 0.5, 0.5), (0.38, 0, 0.48), drawer_m)
    for i in range(3):
        box(f"Desk_DrawerFront_{i}", (0.33, 0.02, 0.13), (0.38, -0.26, 0.31 + i * 0.17), drawer_m)
        cyl(f"Desk_DrawerHandle_{i}", 0.008, 0.12, (0.38, -0.275, 0.31 + i * 0.17), handle_m, verts=8,
                rot=(0, math.pi / 2, 0))
    export("desk.glb")


def build_chair_upgrade():
    clear_scene()
    seat_m = mat("ChairSeatFabric", (0.3, 0.42, 0.55), roughness=0.8)
    frame_m = mat("ChairFrameWood", (0.5, 0.34, 0.2), roughness=0.55)
    leg_m = mat("ChairLegWood", (0.45, 0.3, 0.18), roughness=0.5)

    box("Chair_SeatPan", (0.42, 0.4, 0.05), (0, 0, 0.45), seat_m)
    box("Chair_Backrest", (0.4, 0.04, 0.45), (0, 0.19, 0.72), seat_m)
    box("Chair_BackrestCap", (0.42, 0.06, 0.04), (0, 0.19, 0.955), frame_m)
    for x in (-0.18, 0.18):
        cyl(f"Chair_BackPost_{x:.2f}", 0.018, 0.5, (x, 0.17, 0.7), frame_m, verts=12, rot=(0.12, 0, 0))
    for x in (-0.18, 0.18):
        for y in (-0.17, 0.17):
            leg = cyl(f"Chair_Leg_{x:.2f}_{y:.2f}", 0.018, 0.45, (x, y, 0.225), leg_m, verts=12)
            leg.rotation_euler = (0.06 if y < 0 else -0.06, 0.06 if x < 0 else -0.06, 0)
    box("Chair_Stretcher", (0.36, 0.02, 0.02), (0, 0, 0.14), frame_m)
    export("chair.glb")


def build_round_table_upgrade():
    clear_scene()
    top_m = mat("TableTopWalnut", (0.5, 0.33, 0.2), roughness=0.4)
    leg_m = mat("TableLegWood", (0.42, 0.27, 0.16), roughness=0.5)
    base_m = mat("TableBaseIron", (0.25, 0.25, 0.27), metallic=0.7, roughness=0.4)

    top = cyl("RoundTable_Tabletop", 0.55, 0.045, (0, 0, 0.73), top_m, verts=64)
    smooth(top, 2)
    cyl("RoundTable_Apron", 0.5, 0.06, (0, 0, 0.68), top_m, verts=48)
    cyl("RoundTable_Column", 0.06, 0.66, (0, 0, 0.37), leg_m, verts=24)
    foot = cone("RoundTable_Foot", 0.3, 0.08, (0, 0, 0.04), base_m, verts=48)
    smooth(foot, 1)
    for i in range(4):
        a = i / 4 * math.tau + 0.4
        box(f"RoundTable_Spoke_{i}", (0.26, 0.04, 0.03), (math.cos(a) * 0.15, math.sin(a) * 0.15, 0.05),
                    base_m, rot=(0, 0, a))
    export("round_table.glb")


def build_sofa_upgrade():
    clear_scene()
    fabric_m = mat("SofaFabricCharcoal", (0.28, 0.3, 0.33), roughness=0.85)
    cushion_m = mat("SofaCushion", (0.34, 0.36, 0.4), roughness=0.9)
    leg_m = mat("SofaLegBrass", (0.75, 0.6, 0.3), metallic=0.9, roughness=0.3)

    box("Sofa_Base", (1.8, 0.8, 0.25), (0, 0, 0.225), fabric_m)
    box("Sofa_Backrest", (1.8, 0.22, 0.55), (0, 0.3, 0.62), fabric_m)
    for x in (-0.83, 0.83):
        box(f"Sofa_Armrest_{x:.2f}", (0.18, 0.8, 0.35), (x, 0, 0.52), fabric_m)
    for i in range(3):
        box(f"Sofa_SeatCushion_{i}", (0.53, 0.62, 0.14), (-0.59 + i * 0.59, -0.04, 0.42), cushion_m)
        box(f"Sofa_BackCushion_{i}", (0.53, 0.14, 0.4), (-0.59 + i * 0.59, 0.26, 0.68), cushion_m)
    for x in (-0.8, -0.27, 0.27, 0.8):
        for y in (-0.32, 0.32):
            cyl(f"Sofa_Leg_{x:.2f}_{y:.2f}", 0.025, 0.1, (x, y, 0.05), leg_m, verts=12)
    export("sofa.glb")


BUILDERS = {
    "ramen_bowl": ("ramen_bowl.glb", build_ramen_bowl),
    "ice_cream_cone": ("ice_cream_cone.glb", build_ice_cream_cone),
    "bubble_tea": ("bubble_tea.glb", build_bubble_tea),
    "paper_lantern": ("paper_lantern.glb", build_paper_lantern),
    "potted_monstera": ("potted_monstera.glb", build_potted_monstera),
    "bonsai_tree": ("bonsai_tree.glb", build_bonsai_tree),
    "street_food_cart": ("street_food_cart.glb", build_street_food_cart),
    "traffic_light": ("traffic_light.glb", build_traffic_light),
    "mailbox": ("mailbox.glb", build_mailbox),
    "grandfather_clock": ("grandfather_clock.glb", build_grandfather_clock),
    "fireplace": ("fireplace.glb", build_fireplace),
    "bathtub": ("bathtub.glb", build_bathtub),
    "kitchen_stove": ("kitchen_stove.glb", build_kitchen_stove),
    "campfire": ("campfire.glb", build_campfire),
    "wishing_well": ("wishing_well.glb", build_wishing_well),
    "robot_pet": ("robot_pet.glb", build_robot_pet),
    "mech_turret": ("mech_turret.glb", build_mech_turret),
    "fox_mask": ("fox_mask.glb", build_fox_mask),
    "wizard_hat": ("wizard_hat.glb", build_wizard_hat),
    "tea_set": ("tea_set.glb", build_tea_set),
    "hanging_sign": ("hanging_sign.glb", build_hanging_sign),
    "blackboard": ("blackboard.glb", build_blackboard_upgrade),
    "desk": ("desk.glb", build_desk_upgrade),
    "chair": ("chair.glb", build_chair_upgrade),
    "round_table": ("round_table.glb", build_round_table_upgrade),
    "sofa": ("sofa.glb", build_sofa_upgrade),
}

ONLY = os.environ.get("TS_V6_ONLY")

for asset_name, (filename, builder) in BUILDERS.items():
    if ONLY and asset_name not in ONLY.split(","):
        continue
    try:
        builder()
    except Exception as error:  # noqa: BLE001
        print(f"FAILED {asset_name}: {error}")
        raise
print("PACK V6 COMPLETE")
