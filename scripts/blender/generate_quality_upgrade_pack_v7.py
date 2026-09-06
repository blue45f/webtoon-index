"""Rebuild the seven remaining low-density live GLB assets at pack-peer quality.

An August 2026 triangle census of every GLB under ``apps/web/public/assets/3d`` found
seven assets still in the live graph below 2k triangles while their own
generation-wave peers sit between 20k and 130k:

    hanging_sign 112 · chair 312 · blackboard 316 · desk 364
    sofa 472 · traffic_light 500 · mailbox 1884

The cause is the same in all seven builders: they emit raw ``box()`` and
low-``verts`` ``cyl()`` primitives and never run a bevel/subdivision pass, so
every silhouette is a hard unshaded block. This wave rebuilds them with real
sub-part breakdowns, mitred mouldings, chamfered hard-surface edges, and
subdivided soft volumes.

Bounding boxes are preserved. ``studio-vrm-props.ts`` fit profiles and the
``studio-multi-object-layout.ts`` scene templates place these assets at fixed
coordinates, so footprint and height must not move.

Run with Blender 5.2::

    blender -b --python scripts/blender/generate_quality_upgrade_pack_v7.py

Optionally restrict the run::

    TS_V7_ONLY=hanging_sign,chair blender -b --python scripts/blender/generate_quality_upgrade_pack_v7.py

Self-contained procedural geometry, CC0, no external resources.
"""

import math
import os

import bpy

OUT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../apps/web/public/assets/3d"))
GENERATOR = "scripts/blender/generate_quality_upgrade_pack_v7.py"

os.makedirs(OUT_DIR, exist_ok=True)


# ───────────────────────────── scene helpers ─────────────────────────────


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


def _auto_smooth(obj, angle_deg=34.0):
    """Crease-preserving shading. Blender 4.1+ replaced mesh auto-smooth with a modifier."""
    bpy.context.view_layer.objects.active = obj
    try:
        bpy.ops.object.shade_auto_smooth(angle=math.radians(angle_deg))
    except (AttributeError, RuntimeError):
        for poly in obj.data.polygons:
            poly.use_smooth = True


def hard(obj, width=0.006, segments=3, angle_deg=34.0):
    """Hard-surface finish: chamfered edges, creases kept crisp."""
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bev = obj.modifiers.new("Bevel", "BEVEL")
    bev.width = width
    bev.segments = segments
    bev.limit_method = "ANGLE"
    bev.angle_limit = math.radians(40)
    bev.harden_normals = False
    _auto_smooth(obj, angle_deg)
    return obj


def soft(obj, levels=2, bevel=0.004):
    """Soft volume finish: subdivided and fully smooth (cushions, organic shells)."""
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        bev = obj.modifiers.new("Bevel", "BEVEL")
        bev.width = bevel
        bev.segments = 2
        bev.limit_method = "ANGLE"
        bev.angle_limit = math.radians(40)
    sub = obj.modifiers.new("Subsurf", "SUBSURF")
    sub.levels = levels
    sub.render_levels = levels
    for poly in obj.data.polygons:
        poly.use_smooth = True
    return obj


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


def tube(name, r, depth, loc, material, verts=32, rot=(0, 0, 0)):
    """Tapering-free round bar with chamfered caps."""
    o = cyl(name, r, depth, loc, material, verts=verts, rot=rot)
    return hard(o, width=min(0.004, r * 0.35), segments=2)


def cone(name, r1, r2, depth, loc, material, verts=32, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cone_add(
        radius1=r1, radius2=r2, depth=depth, vertices=verts, location=loc, rotation=rot
    )
    o = bpy.context.active_object
    o.name = name
    o.data.materials.append(material)
    return o


def sphere(name, r, loc, material, seg=32, ring=16):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, segments=seg, ring_count=ring, location=loc)
    o = bpy.context.active_object
    o.name = name
    o.data.materials.append(material)
    for poly in o.data.polygons:
        poly.use_smooth = True
    return o


def torus(name, r1, r2, loc, material, rot=(math.pi / 2, 0, 0), major=28, minor=10):
    bpy.ops.mesh.primitive_torus_add(
        major_radius=r1,
        minor_radius=r2,
        major_segments=major,
        minor_segments=minor,
        location=loc,
        rotation=rot,
    )
    o = bpy.context.active_object
    o.name = name
    o.data.materials.append(material)
    for poly in o.data.polygons:
        poly.use_smooth = True
    return o


def frame_rails(prefix, half_w, half_h, depth, centre, material, rail, bevel=0.005):
    """Four mitred moulding rails around a panel instead of one oversized slab."""
    cx, cy, cz = centre
    top = box(f"{prefix}_RailTop", (half_w * 2, depth, rail), (cx, cy, cz + half_h - rail / 2), material)
    bottom = box(f"{prefix}_RailBottom", (half_w * 2, depth, rail), (cx, cy, cz - half_h + rail / 2), material)
    made = [top, bottom]
    for sx in (-1, 1):
        made.append(
            box(
                f"{prefix}_RailSide{'L' if sx < 0 else 'R'}",
                (rail, depth, (half_h - rail) * 2),
                (cx + sx * (half_w - rail / 2), cy, cz),
                material,
            )
        )
    for o in made:
        hard(o, width=bevel, segments=3)
    return made


def bolt_ring(prefix, count, radius, z, material, head_r=0.008, head_h=0.006, centre=(0.0, 0.0)):
    for i in range(count):
        a = i / count * math.tau
        cyl(
            f"{prefix}_Bolt_{i}",
            head_r,
            head_h,
            (centre[0] + math.cos(a) * radius, centre[1] + math.sin(a) * radius, z),
            material,
            verts=12,
        )


def export(filename):
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=os.path.join(OUT_DIR, filename),
        export_format="GLB",
        export_apply=True,
    )
    size = os.path.getsize(os.path.join(OUT_DIR, filename))
    print(f"EXPORTED {filename} ({size} bytes)")


# ─────────────────────────────── builders ────────────────────────────────


def build_hanging_sign():
    """Shop sign on a wall bracket. Baseline bbox 0.500 x 0.449 x 0.039 m."""
    clear_scene()
    wood_m = mat("SignWood", (0.5, 0.34, 0.2), roughness=0.62)
    wood_dark_m = mat("SignWoodDark", (0.36, 0.23, 0.13), roughness=0.7)
    iron_m = mat("ChainIron", (0.28, 0.29, 0.32), metallic=0.88, roughness=0.38)
    brass_m = mat("SignBrass", (0.72, 0.56, 0.24), metallic=0.9, roughness=0.3)
    paint_m = mat("SignPaint", (0.87, 0.77, 0.52), roughness=0.45)

    # Wall mount plate with fixing bolts.
    plate = box("Sign_WallPlate", (0.024, 0.05, 0.11), (0.012, 0, -0.03), iron_m)
    hard(plate, width=0.004)
    for oy, oz in ((-0.016, 0.028), (0.016, 0.028), (-0.016, -0.078), (0.016, -0.078)):
        b = cyl("Sign_WallBolt", 0.006, 0.008, (0.026, oy, oz), brass_m, verts=12, rot=(0, math.pi / 2, 0))
        hard(b, width=0.0015, segments=2)

    # Bracket bar plus diagonal brace.
    tube("Sign_BracketBar", 0.014, 0.49, (0.25, 0, 0), iron_m, verts=32, rot=(0, math.pi / 2, 0))
    tube("Sign_BracketBrace", 0.008, 0.2, (0.093, 0, -0.075), iron_m, verts=20, rot=(0, -math.pi / 4, 0))
    for x in (0.03, 0.485):
        torus(f"Sign_BarCollar_{x:.3f}", 0.019, 0.005, (x, 0, 0), brass_m, rot=(0, math.pi / 2, 0))

    # Real interlocking chain links rather than a solid cylinder.
    for x in (0.075, 0.425):
        torus(f"Sign_Eye_{x:.3f}", 0.012, 0.004, (x, 0, -0.014), iron_m, rot=(0, 0, 0))
        for i in range(5):
            z = -0.038 - i * 0.036
            rot = (math.pi / 2, 0, 0) if i % 2 == 0 else (math.pi / 2, math.pi / 2, 0)
            torus(f"Sign_Link_{x:.3f}_{i}", 0.0125, 0.0034, (x, 0, z), iron_m, rot=rot)
        torus(f"Sign_BoardEye_{x:.3f}", 0.012, 0.004, (x, 0, -0.222), iron_m, rot=(0, 0, 0))

    # Sign board: recessed panel inside a mitred moulding.
    board = box("Sign_Board", (0.42, 0.024, 0.185), (0.25, 0, -0.325), wood_m)
    hard(board, width=0.005)
    frame_rails("Sign", 0.235, 0.11, 0.032, (0.25, 0, -0.325), wood_dark_m, 0.026, bevel=0.005)
    face = box("Sign_Face", (0.35, 0.006, 0.12), (0.25, -0.017, -0.325), paint_m)
    hard(face, width=0.003)
    # Carved lettering strokes on the painted face.
    for i, (lx, lw) in enumerate(((-0.11, 0.05), (-0.03, 0.03), (0.04, 0.06), (0.13, 0.035))):
        stroke = box(f"Sign_Glyph_{i}", (lw, 0.004, 0.052), (0.25 + lx, -0.022, -0.318), wood_dark_m)
        hard(stroke, width=0.002, segments=2)
    for sx in (-1, 1):
        for sz in (-1, 1):
            stud = sphere(
                f"Sign_Stud_{sx}_{sz}",
                0.008,
                (0.25 + sx * 0.2, -0.014, -0.325 + sz * 0.088),
                brass_m,
                seg=20,
                ring=10,
            )
            stud.scale = (1, 0.55, 1)
    export("hanging_sign.glb")


def build_traffic_light():
    """Mast-arm signal head. Baseline bbox 0.640 x 2.760 x 0.280 m, base at z=0."""
    clear_scene()
    pole_m = mat("SignalPole", (0.29, 0.32, 0.3), metallic=0.75, roughness=0.42)
    housing_m = mat("SignalHousing", (0.16, 0.19, 0.17), roughness=0.55)
    visor_m = mat("SignalVisor", (0.1, 0.12, 0.11), roughness=0.62)
    bolt_m = mat("SignalBolt", (0.55, 0.56, 0.58), metallic=0.9, roughness=0.3)
    backplate_m = mat("SignalBackplate", (0.09, 0.1, 0.09), roughness=0.7)
    red_m = mat("SignalRed", (0.85, 0.12, 0.1), roughness=0.18, emission=(1.0, 0.16, 0.1), emission_strength=4.0)
    amber_m = mat("SignalAmber", (0.9, 0.6, 0.1), roughness=0.18, emission=(1.0, 0.62, 0.1), emission_strength=1.2)
    green_m = mat("SignalGreen", (0.12, 0.75, 0.35), roughness=0.18, emission=(0.15, 0.95, 0.4), emission_strength=1.2)

    # Foundation: flange, anchor bolts, fluted pole shaft.
    base = cyl("Signal_BaseFlange", 0.13, 0.05, (0, 0, 0.025), pole_m, verts=40)
    hard(base, width=0.006)
    bolt_ring("Signal_Anchor", 6, 0.098, 0.056, bolt_m, head_r=0.011, head_h=0.014)
    skirt = cone("Signal_BaseSkirt", 0.115, 0.075, 0.16, (0, 0, 0.13), pole_m, verts=40)
    hard(skirt, width=0.005)
    tube("Signal_Pole", 0.055, 2.45, (0, 0, 1.42), pole_m, verts=36)
    for z in (0.62, 1.35, 2.10):
        torus(f"Signal_PoleBand_{z:.2f}", 0.06, 0.007, (0, 0, z), bolt_m, rot=(0, 0, 0))

    # Mast arm reaching out to the signal head.
    tube("Signal_MastArm", 0.036, 0.34, (0.2, 0, 2.62), pole_m, verts=28, rot=(0, math.pi / 2, 0))
    sphere("Signal_MastElbow", 0.045, (0.02, 0, 2.62), pole_m, seg=24, ring=12)
    tube("Signal_MastDrop", 0.03, 0.12, (0.36, 0, 2.57), pole_m, verts=24)

    # Backplate and signal housing.
    backplate = box("Signal_Backplate", (0.34, 0.02, 0.86), (0.36, 0.055, 2.33), backplate_m)
    hard(backplate, width=0.006)
    body = box("Signal_Housing", (0.22, 0.2, 0.78), (0.36, 0, 2.33), housing_m)
    hard(body, width=0.012, segments=4)
    cap = box("Signal_HousingCap", (0.25, 0.23, 0.03), (0.36, 0, 2.735), housing_m)
    hard(cap, width=0.006)
    floorplate = box("Signal_HousingFloor", (0.25, 0.23, 0.03), (0.36, 0, 1.925), housing_m)
    hard(floorplate, width=0.006)
    tube("Signal_HousingHinge", 0.012, 0.74, (0.475, 0.06, 2.33), bolt_m, verts=16)

    # Three lamps: bezel, lens, visor hood.
    for z, lens_m, name in ((2.56, red_m, "Red"), (2.33, amber_m, "Amber"), (2.10, green_m, "Green")):
        bezel = cyl(f"Signal_Bezel{name}", 0.085, 0.03, (0.36, -0.105, z), housing_m, verts=32, rot=(math.pi / 2, 0, 0))
        hard(bezel, width=0.004)
        lens = cyl(f"Signal_Lens{name}", 0.072, 0.022, (0.36, -0.122, z), lens_m, verts=32, rot=(math.pi / 2, 0, 0))
        hard(lens, width=0.005, segments=2)
        visor = cone(f"Signal_Visor{name}", 0.098, 0.088, 0.12, (0.36, -0.155, z + 0.012), visor_m, verts=32,
                     rot=(math.pi / 2, 0, 0))
        hard(visor, width=0.003, segments=2)
        torus(f"Signal_VisorLip{name}", 0.096, 0.005, (0.36, -0.212, z + 0.012), visor_m, rot=(math.pi / 2, 0, 0))
    export("traffic_light.glb")


def build_mailbox():
    """Post-mounted barrel mailbox. Baseline bbox 0.346 x 1.040 x 0.198 m."""
    clear_scene()
    red_m = mat("MailboxRed", (0.66, 0.11, 0.1), roughness=0.35)
    red_dark_m = mat("MailboxRedDark", (0.44, 0.07, 0.06), roughness=0.42)
    post_m = mat("MailboxPost", (0.42, 0.29, 0.18), roughness=0.68)
    steel_m = mat("MailboxSteel", (0.62, 0.63, 0.66), metallic=0.9, roughness=0.28)
    flag_m = mat("MailboxFlag", (0.9, 0.62, 0.1), roughness=0.4)

    # Timber post with chamfered cap and ground trim.
    post = box("Mailbox_Post", (0.09, 0.09, 0.74), (0, 0, 0.37), post_m)
    hard(post, width=0.008, segments=3)
    cap = box("Mailbox_PostCap", (0.13, 0.13, 0.022), (0, 0, 0.752), post_m)
    hard(cap, width=0.006)
    collar = box("Mailbox_PostCollar", (0.115, 0.115, 0.03), (0, 0, 0.05), post_m)
    hard(collar, width=0.005)
    for sy in (-1, 1):
        brace = box(f"Mailbox_Brace_{sy}", (0.07, 0.02, 0.02), (0, sy * 0.055, 0.7), post_m, rot=(sy * 0.7, 0, 0))
        hard(brace, width=0.004, segments=2)

    # Mounting board under the barrel.
    board = box("Mailbox_MountBoard", (0.33, 0.17, 0.018), (0, 0, 0.775), post_m)
    hard(board, width=0.005)

    # Barrel body: half-cylinder shell with a flat floor.
    body = cyl("Mailbox_Barrel", 0.086, 0.3, (0, 0, 0.87), red_m, verts=48, rot=(0, math.pi / 2, 0))
    hard(body, width=0.006, segments=3, angle_deg=40)
    floor = box("Mailbox_BarrelFloor", (0.3, 0.17, 0.016), (0, 0, 0.792), red_dark_m)
    hard(floor, width=0.004)
    back = cyl("Mailbox_BackWall", 0.086, 0.014, (-0.148, 0, 0.87), red_dark_m, verts=48, rot=(0, math.pi / 2, 0))
    hard(back, width=0.004)

    # Hinged front door with rim, handle and latch.
    door = cyl("Mailbox_Door", 0.082, 0.014, (0.152, 0, 0.87), red_dark_m, verts=48, rot=(0, math.pi / 2, 0))
    hard(door, width=0.005, segments=3)
    torus("Mailbox_DoorRim", 0.084, 0.006, (0.158, 0, 0.87), steel_m, rot=(0, math.pi / 2, 0))
    torus("Mailbox_Handle", 0.026, 0.006, (0.166, 0, 0.845), steel_m, rot=(0, math.pi / 2, 0))
    tube("Mailbox_Hinge", 0.008, 0.09, (0.15, 0, 0.79), steel_m, verts=16, rot=(math.pi / 2, 0, 0))

    # Signal flag on a pivot.
    tube("Mailbox_FlagPost", 0.007, 0.17, (-0.05, -0.09, 0.945), steel_m, verts=16)
    flag = box("Mailbox_Flag", (0.058, 0.011, 0.07), (-0.05, -0.092, 1.005), flag_m)
    hard(flag, width=0.004, segments=2)
    pivot = cyl("Mailbox_FlagPivot", 0.014, 0.012, (-0.05, -0.09, 0.868), steel_m, verts=20, rot=(math.pi / 2, 0, 0))
    hard(pivot, width=0.003, segments=2)

    # Address numerals on the flank.
    for i, dx in enumerate((-0.055, -0.01, 0.035)):
        n = box(f"Mailbox_Numeral_{i}", (0.026, 0.004, 0.04), (dx, -0.085, 0.9), steel_m)
        hard(n, width=0.0015, segments=2)
    export("mailbox.glb")


def build_blackboard():
    """Rolling classroom blackboard. Baseline bbox 1.900 x 2.060 x 0.170 m."""
    clear_scene()
    frame_m = mat("BoardFrameOak", (0.47, 0.32, 0.18), roughness=0.5)
    frame_dark_m = mat("BoardFrameOakDark", (0.34, 0.22, 0.12), roughness=0.6)
    slate_m = mat("SlateGreen", (0.12, 0.2, 0.16), roughness=0.78)
    chalk_m = mat("ChalkWhite", (0.95, 0.95, 0.92), roughness=0.6)
    tray_m = mat("TrayAlu", (0.74, 0.75, 0.78), metallic=0.85, roughness=0.32)
    leg_m = mat("LegSteel", (0.38, 0.4, 0.43), metallic=0.88, roughness=0.28)
    caster_m = mat("CasterRubber", (0.1, 0.1, 0.11), roughness=0.85)

    # Slate panel, slightly proud of its frame.
    slate = box("Blackboard_Surface", (1.78, 0.04, 1.06), (0, 0.006, 1.45), slate_m)
    hard(slate, width=0.006, segments=3)
    frame_rails("Blackboard", 0.95, 0.61, 0.075, (0, 0, 1.45), frame_m, 0.07, bevel=0.008)
    # Inner bead moulding between frame and slate.
    frame_rails("Blackboard_Bead", 0.9, 0.56, 0.05, (0, -0.016, 1.45), frame_dark_m, 0.018, bevel=0.004)
    for sx in (-1, 1):
        for sz in (-1, 1):
            corner = box(
                f"Blackboard_Corner_{sx}_{sz}",
                (0.09, 0.08, 0.09),
                (sx * 0.905, 0, 1.45 + sz * 0.565),
                frame_dark_m,
            )
            hard(corner, width=0.008, segments=3)

    # Chalk tray with a raised lip, chalk and a felt eraser.
    tray = box("Blackboard_ChalkTray", (1.66, 0.11, 0.026), (0, -0.052, 0.845), tray_m)
    hard(tray, width=0.005, segments=3)
    lip = box("Blackboard_TrayLip", (1.66, 0.016, 0.038), (0, -0.101, 0.866), tray_m)
    hard(lip, width=0.004)
    for i, x in enumerate((-0.62, -0.5, -0.4)):
        stick = cyl(f"Blackboard_Chalk_{i}", 0.0085, 0.07, (x, -0.06, 0.874), chalk_m, verts=16,
                    rot=(0, math.pi / 2, 0))
        hard(stick, width=0.002, segments=2)
    er_body = box("Blackboard_Eraser", (0.13, 0.055, 0.028), (0.42, -0.06, 0.874), frame_dark_m)
    hard(er_body, width=0.005, segments=3)
    er_felt = box("Blackboard_EraserFelt", (0.126, 0.05, 0.016), (0.42, -0.06, 0.855), chalk_m)
    hard(er_felt, width=0.003, segments=2)

    # A-frame stand on casters.
    # Wheel outer radius is 0.029, so the hub sits at z=0.030 and the tyre just touches z=0.001.
    for x in (-0.72, 0.72):
        tube(f"Blackboard_Leg_{x:.2f}", 0.026, 0.73, (x, 0, 0.475), leg_m, verts=24)
        foot = box(f"Blackboard_Foot_{x:.2f}", (0.07, 0.19, 0.04), (x, 0, 0.09), leg_m)
        hard(foot, width=0.008, segments=3)
        for sy in (-1, 1):
            fork = box(f"Blackboard_Fork_{x:.2f}_{sy}", (0.022, 0.028, 0.05), (x, sy * 0.075, 0.062), leg_m)
            hard(fork, width=0.004, segments=2)
            torus(
                f"Blackboard_Caster_{x:.2f}_{sy}", 0.020, 0.009, (x, sy * 0.075, 0.030), caster_m, rot=(0, math.pi / 2, 0)
            )
            cyl(f"Blackboard_CasterHub_{x:.2f}_{sy}", 0.008, 0.018, (x, sy * 0.075, 0.030), leg_m, verts=14,
                rot=(0, math.pi / 2, 0))
    tube("Blackboard_CrossBar", 0.018, 1.4, (0, 0, 0.42), leg_m, verts=20, rot=(0, math.pi / 2, 0))
    export("blackboard.glb")


def build_desk():
    """Classroom/work desk with a drawer pedestal. Baseline bbox 1.200 x 0.750 x 0.600 m."""
    clear_scene()
    top_m = mat("DeskTopOak", (0.63, 0.46, 0.29), roughness=0.42)
    edge_m = mat("DeskTopEdge", (0.5, 0.35, 0.2), roughness=0.5)
    leg_m = mat("DeskLegSteel", (0.34, 0.36, 0.39), metallic=0.85, roughness=0.32)
    drawer_m = mat("DrawerFront", (0.56, 0.4, 0.25), roughness=0.45)
    carcass_m = mat("DrawerCarcass", (0.4, 0.28, 0.17), roughness=0.6)
    handle_m = mat("HandleChrome", (0.8, 0.82, 0.85), metallic=0.92, roughness=0.18)
    rubber_m = mat("DeskFootRubber", (0.12, 0.12, 0.13), roughness=0.85)

    # Worktop: core slab plus a proud edge band, generously chamfered.
    top = box("Desk_Tabletop", (1.18, 0.58, 0.032), (0, 0, 0.732), top_m)
    hard(top, width=0.008, segments=4)
    band = box("Desk_TopEdgeBand", (1.2, 0.6, 0.014), (0, 0, 0.712), edge_m)
    hard(band, width=0.006, segments=3)
    torus("Desk_CableGrommet", 0.032, 0.008, (0.42, 0.21, 0.746), leg_m, rot=(0, 0, 0))
    cyl("Desk_GrommetInner", 0.028, 0.006, (0.42, 0.21, 0.742), carcass_m, verts=24)

    # Modesty panel and stretcher.
    panel = box("Desk_ModestyPanel", (1.02, 0.018, 0.28), (0, 0.235, 0.55), edge_m)
    hard(panel, width=0.005, segments=3)
    tube("Desk_StretcherRail", 0.016, 0.98, (-0.05, 0.2, 0.16), leg_m, verts=20, rot=(0, math.pi / 2, 0))

    # Tapered legs with levelling feet.
    for x, y in ((-0.55, -0.25), (-0.55, 0.25), (0.55, -0.25), (0.55, 0.25)):
        leg = cone(f"Desk_Leg_{x:.2f}_{y:.2f}", 0.028, 0.019, 0.69, (x, y, 0.35), leg_m, verts=24)
        hard(leg, width=0.004, segments=2)
        bracket = box(f"Desk_LegBracket_{x:.2f}_{y:.2f}", (0.075, 0.075, 0.022), (x, y, 0.689), leg_m)
        hard(bracket, width=0.005, segments=3)
        foot = cyl(f"Desk_Foot_{x:.2f}_{y:.2f}", 0.022, 0.012, (x, y, 0.006), rubber_m, verts=20)
        hard(foot, width=0.003, segments=2)

    # Drawer pedestal with recessed fronts and bar pulls.
    carcass = box("Desk_DrawerCarcass", (0.34, 0.5, 0.48), (0.37, 0, 0.45), carcass_m)
    hard(carcass, width=0.006, segments=3)
    for i in range(3):
        z = 0.28 + i * 0.165
        front = box(f"Desk_DrawerFront_{i}", (0.33, 0.022, 0.152), (0.37, -0.257, z), drawer_m)
        hard(front, width=0.006, segments=3)
        reveal = box(f"Desk_DrawerReveal_{i}", (0.28, 0.008, 0.1), (0.37, -0.266, z), carcass_m)
        hard(reveal, width=0.003, segments=2)
        tube(f"Desk_DrawerPull_{i}", 0.008, 0.15, (0.37, -0.283, z), handle_m, verts=16, rot=(0, math.pi / 2, 0))
        for sx in (-1, 1):
            cyl(f"Desk_PullPost_{i}_{sx}", 0.006, 0.024, (0.37 + sx * 0.07, -0.272, z), handle_m, verts=12,
                       rot=(math.pi / 2, 0, 0))
    export("desk.glb")


def build_chair():
    """Classroom/cafe chair. Baseline bbox 0.423 x 0.976 x 0.421 m."""
    clear_scene()
    seat_m = mat("ChairSeatFabric", (0.31, 0.43, 0.56), roughness=0.82)
    piping_m = mat("ChairPiping", (0.22, 0.31, 0.42), roughness=0.75)
    frame_m = mat("ChairFrameWood", (0.51, 0.35, 0.21), roughness=0.5)
    leg_m = mat("ChairLegWood", (0.45, 0.3, 0.18), roughness=0.48)
    glide_m = mat("ChairGlide", (0.13, 0.13, 0.14), roughness=0.85)

    # Contoured upholstered seat with piping.
    pan = box("Chair_SeatPan", (0.4, 0.38, 0.055), (0, 0, 0.452), seat_m)
    soft(pan, levels=2, bevel=0.012)
    welt = torus("Chair_SeatWelt", 0.2, 0.009, (0, 0, 0.427), piping_m, rot=(0, 0, 0), major=36, minor=8)
    welt.scale = (1.0, 0.95, 1.0)
    apron = box("Chair_SeatApron", (0.38, 0.36, 0.028), (0, 0, 0.414), frame_m)
    hard(apron, width=0.006, segments=3)

    # Curved backrest: three shaped slats between two posts.
    for i, z in enumerate((0.62, 0.735, 0.85)):
        slat = box(f"Chair_BackSlat_{i}", (0.35, 0.028, 0.082), (0, 0.176 + i * 0.008, z), seat_m)
        soft(slat, levels=1, bevel=0.008)
    cap = box("Chair_BackrestCap", (0.4, 0.05, 0.038), (0, 0.196, 0.945), frame_m)
    hard(cap, width=0.01, segments=4)
    for x in (-0.175, 0.175):
        post = cone(f"Chair_BackPost_{x:.2f}", 0.021, 0.016, 0.53, (x, 0.185, 0.7), frame_m, verts=20, rot=(0.06, 0, 0))
        hard(post, width=0.004, segments=2)

    # Turned legs, full stretcher set, glides.
    for x in (-0.172, 0.172):
        for y in (-0.165, 0.165):
            leg = cone(f"Chair_Leg_{x:.2f}_{y:.2f}", 0.021, 0.015, 0.44, (x, y, 0.222), leg_m, verts=20)
            leg.rotation_euler = (0.045 if y < 0 else -0.045, -0.045 if x < 0 else 0.045, 0)
            hard(leg, width=0.004, segments=2)
            torus(f"Chair_LegRing_{x:.2f}_{y:.2f}", 0.023, 0.005, (x, y, 0.33), frame_m, rot=(0, 0, 0))
            glide = cyl(f"Chair_Glide_{x:.2f}_{y:.2f}", 0.017, 0.01, (x, y, 0.005), glide_m, verts=16)
            hard(glide, width=0.002, segments=2)
    for y in (-0.16, 0.16):
        tube(f"Chair_StretcherX_{y:.2f}", 0.013, 0.33, (0, y, 0.15), frame_m, verts=16, rot=(0, math.pi / 2, 0))
    for x in (-0.167, 0.167):
        tube(f"Chair_StretcherY_{x:.2f}", 0.012, 0.31, (x, 0, 0.2), frame_m, verts=16, rot=(math.pi / 2, 0, 0))
    for sx in (-1, 1):
        blk = box(f"Chair_CornerBlock_{sx}", (0.05, 0.05, 0.03), (sx * 0.145, 0.14, 0.4), frame_m, rot=(0, 0, sx * 0.78))
        hard(blk, width=0.005, segments=2)
    export("chair.glb")


def build_sofa():
    """Two/three-seat fabric sofa. Baseline bbox 1.840 x 0.895 x 0.810 m."""
    clear_scene()
    fabric_m = mat("SofaFabricCharcoal", (0.28, 0.3, 0.33), roughness=0.88)
    cushion_m = mat("SofaCushion", (0.34, 0.36, 0.4), roughness=0.9)
    welt_m = mat("SofaWelting", (0.21, 0.23, 0.26), roughness=0.8)
    leg_m = mat("SofaLegBrass", (0.74, 0.59, 0.29), metallic=0.92, roughness=0.28)
    glide_m = mat("SofaGlide", (0.12, 0.12, 0.13), roughness=0.85)

    # Frame: plinth, back, rolled arms.
    base = box("Sofa_Base", (1.78, 0.8, 0.2), (0, 0, 0.24), fabric_m)
    hard(base, width=0.014, segments=4)
    deck = box("Sofa_SeatDeck", (1.42, 0.68, 0.05), (0, -0.03, 0.355), welt_m)
    hard(deck, width=0.008, segments=3)
    back = box("Sofa_Backrest", (1.8, 0.2, 0.55), (0, 0.3, 0.625), fabric_m)
    soft(back, levels=1, bevel=0.018)
    for x in (-0.82, 0.82):
        arm = box(f"Sofa_Armrest_{x:.2f}", (0.19, 0.8, 0.3), (x, 0, 0.5), fabric_m)
        soft(arm, levels=2, bevel=0.02)
        roll = cyl(f"Sofa_ArmRoll_{x:.2f}", 0.095, 0.8, (x, 0, 0.62), fabric_m, verts=32, rot=(math.pi / 2, 0, 0))
        soft(roll, levels=1, bevel=0.006)
        panel = box(f"Sofa_ArmPanel_{x:.2f}", (0.02, 0.7, 0.24), (x + (0.096 if x > 0 else -0.096), 0, 0.49), welt_m)
        hard(panel, width=0.006, segments=3)

    # Cushions with welted seams and tufting.
    for i in range(3):
        x = -0.585 + i * 0.585
        seat = box(f"Sofa_SeatCushion_{i}", (0.55, 0.62, 0.14), (x, -0.045, 0.45), cushion_m)
        soft(seat, levels=2, bevel=0.018)
        seam = torus(f"Sofa_SeatWelt_{i}", 0.28, 0.008, (x, -0.045, 0.45), welt_m, rot=(0, 0, 0), major=36, minor=8)
        seam.scale = (1.0, 1.1, 1.0)
        backc = box(f"Sofa_BackCushion_{i}", (0.55, 0.16, 0.4), (x, 0.245, 0.685), cushion_m)
        soft(backc, levels=2, bevel=0.016)
        for sx in (-1, 1):
            for sz in (-1, 1):
                tuft = sphere(
                    f"Sofa_Tuft_{i}_{sx}_{sz}", 0.016, (x + sx * 0.14, 0.162, 0.685 + sz * 0.1), welt_m, seg=16, ring=8
                )
                tuft.scale = (1, 0.45, 1)

    # Tapered brass legs.
    for x in (-0.78, -0.26, 0.26, 0.78):
        for y in (-0.31, 0.31):
            leg = cone(f"Sofa_Leg_{x:.2f}_{y:.2f}", 0.028, 0.016, 0.13, (x, y, 0.07), leg_m, verts=20)
            leg.rotation_euler = (0.06 if y < 0 else -0.06, 0, 0)
            hard(leg, width=0.004, segments=3)
            cyl(f"Sofa_LegCollar_{x:.2f}_{y:.2f}", 0.032, 0.016, (x, y, 0.135), leg_m, verts=20)
            glide = cyl(f"Sofa_Glide_{x:.2f}_{y:.2f}", 0.015, 0.008, (x, y, 0.004), glide_m, verts=14)
            hard(glide, width=0.002, segments=2)
    export("sofa.glb")



def half_shell(name, scale, loc, material, *, keep="front", thickness=0.006, seg=40, ring=24):
    """A hollow shell: a UV sphere with one half's geometry removed and the rest
    solidified. Needed for anything worn over a face, where a solid blob is the
    wrong shape no matter how many triangles it has."""
    import bmesh

    bpy.ops.mesh.primitive_uv_sphere_add(radius=1.0, segments=seg, ring_count=ring, location=loc)
    o = bpy.context.active_object
    o.name = name
    o.scale = scale
    bpy.ops.object.transform_apply(scale=True)

    bm = bmesh.new()
    bm.from_mesh(o.data)
    drop = [v for v in bm.verts if (v.co.y > 0.0 if keep == "front" else v.co.y < 0.0)]
    bmesh.ops.delete(bm, geom=drop, context="VERTS")
    bm.to_mesh(o.data)
    bm.free()

    mod = o.modifiers.new("Solidify", "SOLIDIFY")
    mod.thickness = thickness
    mod.offset = 1.0
    o.data.materials.append(material)
    for poly in o.data.polygons:
        poly.use_smooth = True
    return o


def build_bubble_tea():
    """Pearl bubble tea in a tapered cup. Baseline bbox 0.066 x 0.208 x 0.066 m."""
    clear_scene()
    cup_m = mat("BobaCup", (0.93, 0.95, 0.97), roughness=0.12, alpha=0.42)
    tea_m = mat("BobaMilkTea", (0.72, 0.53, 0.36), roughness=0.22)
    pearl_m = mat("BobaPearl", (0.10, 0.07, 0.06), roughness=0.30)
    lid_m = mat("BobaLid", (0.90, 0.92, 0.94), roughness=0.20, alpha=0.55)
    straw_m = mat("BobaStraw", (0.88, 0.24, 0.36), roughness=0.35)
    band_m = mat("BobaBand", (0.16, 0.42, 0.34), roughness=0.45)

    # Tapered cup wall, wider at the rim like a real boba cup.
    wall = cone("Boba_Cup", 0.032, 0.023, 0.155, (0, 0, 0.080), cup_m, verts=48)
    hard(wall, width=0.002, segments=2)
    tea = cone("Boba_Tea", 0.029, 0.021, 0.118, (0, 0, 0.062), tea_m, verts=48)
    hard(tea, width=0.002, segments=2)
    # Tapioca settled in the base.
    for i in range(11):
        a = i / 11.0 * math.tau * 2.7
        r = 0.014 * (0.35 + 0.65 * ((i % 4) / 3.0))
        sphere(f"Boba_Pearl_{i}", 0.0055, (math.cos(a) * r, math.sin(a) * r, 0.012 + (i % 3) * 0.008),
               pearl_m, seg=16, ring=10)
    seal = cyl("Boba_SealFilm", 0.032, 0.003, (0, 0, 0.158), lid_m, verts=48)
    hard(seal, width=0.001, segments=2)
    dome = sphere("Boba_Lid", 0.032, (0, 0, 0.158), lid_m, seg=48, ring=20)
    dome.scale = (1.0, 1.0, 0.42)
    torus("Boba_LidRim", 0.033, 0.004, (0, 0, 0.156), lid_m, rot=(0, 0, 0))
    straw = cyl("Boba_Straw", 0.0072, 0.145, (0.006, 0, 0.145), straw_m, verts=20, rot=(0.16, 0, 0))
    hard(straw, width=0.0015, segments=2)
    band = cyl("Boba_Band", 0.0305, 0.030, (0, 0, 0.070), band_m, verts=48)
    hard(band, width=0.002, segments=2)
    export("bubble_tea.glb")


def build_ice_cream_cone():
    """Three scoops on a waffle cone. Baseline bbox 0.061 x 0.241 x 0.055 m."""
    clear_scene()
    cone_m = mat("WaffleCone", (0.80, 0.58, 0.30), roughness=0.62)
    waffle_m = mat("WaffleRidge", (0.64, 0.43, 0.20), roughness=0.68)
    v_m = mat("ScoopVanilla", (0.97, 0.93, 0.83), roughness=0.42)
    s_m = mat("ScoopStrawberry", (0.93, 0.55, 0.60), roughness=0.42)
    c_m = mat("ScoopChocolate", (0.42, 0.26, 0.17), roughness=0.44)
    cherry_m = mat("Cherry", (0.80, 0.10, 0.16), roughness=0.28)
    stem_m = mat("CherryStem", (0.30, 0.42, 0.18), roughness=0.6)

    body = cone("Cone_Body", 0.0295, 0.004, 0.105, (0, 0, 0.054), cone_m, verts=40)
    hard(body, width=0.0015, segments=2)
    # Waffle lattice: two crossed helical bands rather than a smooth taper.
    for direction in (1, -1):
        for i in range(7):
            a = i / 7.0 * math.tau
            ridge = box(f"Cone_Waffle_{direction}_{i}", (0.062, 0.0022, 0.0022),
                        (0, 0, 0.054), waffle_m, rot=(0, 0, a))
            ridge.rotation_euler = (direction * 0.9, 0, a)
    torus("Cone_Rim", 0.0292, 0.0035, (0, 0, 0.106), cone_m, rot=(0, 0, 0))
    for i, (z, r, m) in enumerate(((0.128, 0.0285, s_m), (0.168, 0.0265, v_m), (0.203, 0.0235, c_m))):
        scoop = sphere(f"Cone_Scoop_{i}", r, (0, 0, z), m, seg=40, ring=22)
        scoop.scale = (1.0, 1.0, 0.92)
        # Soft-serve lobes keep the scoop from reading as a plain ball.
        for k in range(6):
            a = k / 6.0 * math.tau + i * 0.4
            sphere(f"Cone_Lobe_{i}_{k}", r * 0.42,
                   (math.cos(a) * r * 0.72, math.sin(a) * r * 0.72, z - r * 0.22), m, seg=16, ring=10)
    cone("Cone_Drip", 0.010, 0.002, 0.030, (0.020, 0.012, 0.108), s_m, verts=16, rot=(math.pi, 0, 0))
    sphere("Cone_Cherry", 0.0092, (0, 0, 0.231), cherry_m, seg=20, ring=12)
    cyl("Cone_CherryStem", 0.0018, 0.016, (0.002, 0, 0.240), stem_m, verts=8, rot=(0.3, 0.2, 0))
    export("ice_cream_cone.glb")


def build_fox_mask():
    """A worn fox mask, not an animal head. Baseline bbox 0.208 x 0.289 x 0.157 m,
    hanging from z=-0.121 to +0.169 with the concave side toward the wearer."""
    clear_scene()
    white_m = mat("MaskLacquer", (0.95, 0.93, 0.89), roughness=0.24)
    red_m = mat("MaskRed", (0.80, 0.14, 0.12), roughness=0.30)
    black_m = mat("MaskInk", (0.07, 0.06, 0.07), roughness=0.35)
    gold_m = mat("MaskGold", (0.80, 0.62, 0.24), metallic=0.85, roughness=0.28)
    cord_m = mat("MaskCord", (0.55, 0.10, 0.12), roughness=0.7)

    # Face plate: a forward-facing shell, hollow behind.
    half_shell("FoxMask_Plate", (0.100, 0.072, 0.132), (0, 0.012, 0.022), white_m,
               keep="front", thickness=0.005, seg=44, ring=26)
    # Muzzle pushed forward from the plate.
    muzzle = sphere("FoxMask_Muzzle", 1.0, (0, -0.048, -0.030), white_m, seg=32, ring=18)
    muzzle.scale = (0.040, 0.036, 0.030)
    bpy.context.view_layer.objects.active = muzzle
    bpy.ops.object.transform_apply(scale=True)
    sphere("FoxMask_Nose", 0.011, (0, -0.078, -0.024), black_m, seg=18, ring=12)
    # Ears.
    for sx in (-1, 1):
        ear = cone(f"FoxMask_Ear_{sx}", 0.030, 0.002, 0.078, (sx * 0.058, 0.020, 0.140), white_m, verts=24,
                   rot=(-0.18, sx * 0.22, 0))
        hard(ear, width=0.002, segments=2)
        cone(f"FoxMask_EarInner_{sx}", 0.018, 0.001, 0.050, (sx * 0.058, 0.006, 0.138), red_m, verts=20,
                     rot=(-0.18, sx * 0.22, 0))
    # Eye openings with a painted rim: the read that makes it a mask.
    for sx in (-1, 1):
        eye = sphere(f"FoxMask_EyeHole_{sx}", 1.0, (sx * 0.042, -0.052, 0.036), black_m, seg=22, ring=14)
        eye.scale = (0.023, 0.013, 0.013)
        bpy.context.view_layer.objects.active = eye
        bpy.ops.object.transform_apply(scale=True)
        brow = box(f"FoxMask_Brow_{sx}", (0.044, 0.010, 0.008), (sx * 0.044, -0.050, 0.058), red_m,
                   rot=(0, 0, -sx * 0.32))
        hard(brow, width=0.002, segments=2)
        cheek = box(f"FoxMask_CheekMark_{sx}", (0.030, 0.008, 0.010), (sx * 0.058, -0.038, -0.004), red_m,
                    rot=(0, 0, sx * 0.5))
        hard(cheek, width=0.002, segments=2)
    crest = box("FoxMask_Crest", (0.016, 0.010, 0.052), (0, -0.046, 0.096), red_m)
    hard(crest, width=0.002, segments=2)
    torus("FoxMask_ForeheadSeal", 0.014, 0.004, (0, -0.050, 0.128), gold_m, rot=(math.pi / 2, 0, 0))
    # Side cords, which is why the baseline bbox reaches below the plate.
    for sx in (-1, 1):
        cyl(f"FoxMask_Cord_{sx}", 0.004, 0.135, (sx * 0.086, 0.030, -0.052), cord_m, verts=12,
                       rot=(0.18, sx * 0.18, 0))
        sphere(f"FoxMask_CordKnot_{sx}", 0.009, (sx * 0.082, 0.026, 0.012), cord_m, seg=16, ring=10)
    export("fox_mask.glb")


def build_robot_pet():
    """A quadruped robot dog. Baseline bbox 0.271 x 0.435 x 0.297 m, standing on z=0."""
    clear_scene()
    shell_m = mat("PetShell", (0.88, 0.89, 0.92), roughness=0.30, metallic=0.15)
    dark_m = mat("PetChassis", (0.16, 0.18, 0.22), roughness=0.42, metallic=0.35)
    joint_m = mat("PetJoint", (0.42, 0.45, 0.50), metallic=0.80, roughness=0.28)
    accent_m = mat("PetAccent", (0.10, 0.72, 0.92), roughness=0.20,
                   emission=(0.15, 0.85, 1.0), emission_strength=3.0)
    pad_m = mat("PetPad", (0.20, 0.21, 0.24), roughness=0.75)

    # Torso: a segmented shell over a dark chassis.
    body = sphere("Pet_Torso", 1.0, (0, 0.010, 0.300), shell_m, seg=40, ring=24)
    body.scale = (0.072, 0.115, 0.062)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.transform_apply(scale=True)
    spine = box("Pet_Chassis", (0.086, 0.190, 0.052), (0, 0.010, 0.292), dark_m)
    hard(spine, width=0.008, segments=3)
    for i, y in enumerate((-0.052, 0.010, 0.072)):
        torus(f"Pet_ShellSeam_{i}", 0.070, 0.005, (0, y, 0.300), joint_m, rot=(math.pi / 2, 0, 0))
    strip = box("Pet_DorsalStrip", (0.020, 0.150, 0.006), (0, 0.010, 0.360), accent_m)
    hard(strip, width=0.002, segments=2)

    # Head on a short neck, with a visor instead of eyes.
    neck = cyl("Pet_Neck", 0.026, 0.058, (0, -0.098, 0.335), joint_m, verts=20, rot=(0.7, 0, 0))
    hard(neck, width=0.004, segments=2)
    head = box("Pet_Head", (0.090, 0.104, 0.072), (0, -0.140, 0.352), shell_m)
    hard(head, width=0.014, segments=4)
    muzzle = box("Pet_Muzzle", (0.056, 0.052, 0.040), (0, -0.184, 0.336), dark_m)
    hard(muzzle, width=0.008, segments=3)
    visor = box("Pet_Visor", (0.074, 0.016, 0.026), (0, -0.190, 0.368), accent_m)
    hard(visor, width=0.004, segments=3)
    for sx in (-1, 1):
        ear = box(f"Pet_Ear_{sx}", (0.020, 0.016, 0.048), (sx * 0.034, -0.126, 0.398), dark_m,
                  rot=(0, sx * 0.24, 0))
        hard(ear, width=0.004, segments=3)
        cyl(f"Pet_EarPivot_{sx}", 0.010, 0.014, (sx * 0.034, -0.126, 0.376), joint_m, verts=12,
            rot=(0, math.pi / 2, 0))

    # Four legs: hip block, thigh, shin, paw.
    for sx in (-1, 1):
        for sy, tag in ((-0.078, "F"), (0.086, "R")):
            sphere(f"Pet_Hip_{tag}_{sx}", 0.026, (sx * 0.062, sy, 0.286), joint_m, seg=18, ring=12)
            thigh = cyl(f"Pet_Thigh_{tag}_{sx}", 0.019, 0.110, (sx * 0.072, sy - 0.012, 0.232), shell_m,
                        verts=18, rot=(0.22, 0, sx * 0.10))
            hard(thigh, width=0.004, segments=2)
            sphere(f"Pet_Knee_{tag}_{sx}", 0.020, (sx * 0.078, sy - 0.024, 0.176), joint_m, seg=16, ring=10)
            shin = cyl(f"Pet_Shin_{tag}_{sx}", 0.014, 0.140, (sx * 0.078, sy - 0.010, 0.104), dark_m,
                       verts=16, rot=(-0.18, 0, 0))
            hard(shin, width=0.003, segments=2)
            paw = box(f"Pet_Paw_{tag}_{sx}", (0.040, 0.054, 0.026), (sx * 0.078, sy + 0.004, 0.014), shell_m)
            hard(paw, width=0.008, segments=3)
            pad = box(f"Pet_Pad_{tag}_{sx}", (0.032, 0.044, 0.008), (sx * 0.078, sy + 0.004, 0.004), pad_m)
            hard(pad, width=0.002, segments=2)

    # Tail, antenna and a rear status light.
    for i, (y, z, r) in enumerate(((0.116, 0.320, 0.013), (0.150, 0.356, 0.011), (0.172, 0.400, 0.008))):
        sphere(f"Pet_Tail_{i}", r, (0, y, z), joint_m, seg=16, ring=10)
    sphere("Pet_TailTip", 0.012, (0, 0.182, 0.424), accent_m, seg=18, ring=12)
    cyl("Pet_Antenna", 0.003, 0.052, (0.030, -0.104, 0.410), joint_m, verts=10, rot=(0.2, 0.18, 0))
    sphere("Pet_AntennaBead", 0.008, (0.036, -0.098, 0.434), accent_m, seg=14, ring=10)
    export("robot_pet.glb")


BUILDERS = {
    "hanging_sign": ("hanging_sign.glb", build_hanging_sign),
    "traffic_light": ("traffic_light.glb", build_traffic_light),
    "mailbox": ("mailbox.glb", build_mailbox),
    "blackboard": ("blackboard.glb", build_blackboard),
    "desk": ("desk.glb", build_desk),
    "chair": ("chair.glb", build_chair),
    "sofa": ("sofa.glb", build_sofa),
    "bubble_tea": ("bubble_tea.glb", build_bubble_tea),
    "ice_cream_cone": ("ice_cream_cone.glb", build_ice_cream_cone),
    "fox_mask": ("fox_mask.glb", build_fox_mask),
    "robot_pet": ("robot_pet.glb", build_robot_pet),
}

ONLY = os.environ.get("TS_V7_ONLY")

for asset_name, (filename, builder) in BUILDERS.items():
    if ONLY and asset_name not in ONLY.split(","):
        continue
    try:
        builder()
    except Exception as error:  # noqa: BLE001
        print(f"FAILED {asset_name}: {error}")
        raise
print("PACK V7 COMPLETE")
