import { readFileSync } from "node:fs";

import { Box3, Vector3 } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { describe, expect, it, vi } from "vitest";

import {
  BLENDER_PROP_GLTF_URLS,
  PROP_ATTACH_BONES,
  VRM_PROPS_VERSION,
  VRM_PROPS,
  buildPropObject,
  createPropInstance,
  inspectVrmPropsDocumentForProjection,
  parseVrmProps,
  propDefById,
  propsByCategory,
  serializeVrmProps,
  type PropDef,
  type PropInstance,
  type ThreeLike,
  type ThreeObject,
} from "./studio-vrm-props";

(globalThis as unknown as { self: typeof globalThis }).self = globalThis;

describe("VRM 소품 카탈로그", () => {
  it("id가 모두 고유하다", () => {
    const ids = VRM_PROPS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("16종 이상이 등록되어 있다", () => {
    expect(VRM_PROPS.length).toBeGreaterThanOrEqual(37);
  });

  it("의료진 역할을 구분할 수 있는 의료 소품 7종을 제공한다", () => {
    const medicalIds = [
      "clipboard",
      "syringe",
      "medicalBag",
      "surgicalCap",
      "faceMask",
      "stethoscope",
      "idBadge",
    ];
    for (const id of medicalIds) {
      expect(propDefById(id), id).toBeDefined();
    }
    expect(propsByCategory("hand").map((prop) => prop.id)).toEqual(
      expect.arrayContaining(["clipboard", "syringe", "medicalBag"])
    );
    expect(propsByCategory("head").map((prop) => prop.id)).toEqual(
      expect.arrayContaining(["surgicalCap", "faceMask"])
    );
    expect(propsByCategory("body").map((prop) => prop.id)).toEqual(
      expect.arrayContaining(["stethoscope", "idBadge"])
    );
  });

  it("모든 기본 부착 본이 부착 가능 본 집합에 속한다", () => {
    for (const p of VRM_PROPS) {
      expect(PROP_ATTACH_BONES).toContain(p.defaultBone);
    }
  });

  it("세 카테고리에 모두 소품이 있다", () => {
    expect(propsByCategory("hand").length).toBeGreaterThan(0);
    expect(propsByCategory("head").length).toBeGreaterThan(0);
    expect(propsByCategory("body").length).toBeGreaterThan(0);
  });

  it("64개 안정 ID를 번들된 first-party GLB 경로에 정확히 연결한다", () => {
    const expected = {
      mic: "/assets/3d/atelier_microphone.glb",
      beret: "/assets/3d/atelier_beret.glb",
      sunglasses: "/assets/3d/atelier_sunglasses.glb",
      headphones: "/assets/3d/atelier_headphones.glb",
      ribbon: "/assets/3d/atelier_ribbon.glb",
      beanie: "/assets/3d/atelier_beanie.glb",
      camera: "/assets/3d/atelier_camera.glb",
      medicalBag: "/assets/3d/atelier_medical_bag.glb",
      shoulderbag: "/assets/3d/atelier_shoulder_bag.glb",
      smartphone: "/assets/3d/modern_smartphone_prop.glb",
      mug: "/assets/3d/everyday_mug.glb",
      book: "/assets/3d/everyday_book.glb",
      cap: "/assets/3d/everyday_cap.glb",
      glasses: "/assets/3d/everyday_glasses.glb",
      backpack: "/assets/3d/everyday_backpack.glb",
      stethoscope: "/assets/3d/medical_stethoscope.glb",
      blender_cyber_katana: "/assets/3d/cyber_katana.glb",
      blender_magic_staff: "/assets/3d/magic_staff_crystal.glb",
      blender_scifi_drone: "/assets/3d/scifi_drone_bot.glb",
      blender_neon_bench: "/assets/3d/neom_bench_prop.glb",
      blender_cyber_visor: "/assets/3d/cyber_helmet_visor.glb",
      blender_holo_tablet: "/assets/3d/hologram_tablet.glb",
      blender_rune_shield: "/assets/3d/ancient_rune_shield.glb",
      blender_arcade_cabinet: "/assets/3d/arcade_game_cabinet.glb",
      blender_medieval_greatsword: "/assets/3d/medieval_greatsword.glb",
      blender_cyber_hoverbike: "/assets/3d/cyberpunk_hoverbike.glb",
      blender_magic_chest: "/assets/3d/fantasy_magic_chest.glb",
      blender_modern_smartphone: "/assets/3d/modern_smartphone_prop.glb",
      blender_cyber_sniper_rifle: "/assets/3d/cyber_sniper_rifle.glb",
      blender_magic_wand_staff: "/assets/3d/fantasy_magic_wand_staff.glb",
      blender_steampunk_airship: "/assets/3d/steampunk_airship.glb",
      blender_cyberpunk_motorcycle: "/assets/3d/cyberpunk_motorcycle.glb",
      blender_scifi_laser_gun: "/assets/3d/scifi_laser_gun.glb",
      blender_magic_grimoire: "/assets/3d/magic_grimoire.glb",
      blender_cyber_glasses: "/assets/3d/cyber_glasses.glb",
      blender_medieval_shield: "/assets/3d/medieval_shield.glb",
      blender_street_lamp: "/assets/3d/street_lamp.glb",
      blender_vending_machine: "/assets/3d/vending_machine.glb",
      blender_royal_throne: "/assets/3d/royal_throne.glb",
      blender_crystal_orb: "/assets/3d/crystal_orb.glb",
      blender_tactical_helmet: "/assets/3d/tactical_helmet.glb",
      blender_school_desk: "/assets/3d/school_desk.glb",
      blender_adaptive_power_wheelchair: "/assets/3d/adaptive_power_wheelchair.glb",
      blender_ramen_bowl: "/assets/3d/ramen_bowl.glb",
      blender_ice_cream_cone: "/assets/3d/ice_cream_cone.glb",
      blender_bubble_tea: "/assets/3d/bubble_tea.glb",
      blender_paper_lantern: "/assets/3d/paper_lantern.glb",
      blender_potted_monstera: "/assets/3d/potted_monstera.glb",
      blender_bonsai_tree: "/assets/3d/bonsai_tree.glb",
      blender_street_food_cart: "/assets/3d/street_food_cart.glb",
      blender_traffic_light: "/assets/3d/traffic_light.glb",
      blender_mailbox: "/assets/3d/mailbox.glb",
      blender_grandfather_clock: "/assets/3d/grandfather_clock.glb",
      blender_fireplace: "/assets/3d/fireplace.glb",
      blender_bathtub: "/assets/3d/bathtub.glb",
      blender_kitchen_stove: "/assets/3d/kitchen_stove.glb",
      blender_campfire: "/assets/3d/campfire.glb",
      blender_wishing_well: "/assets/3d/wishing_well.glb",
      blender_robot_pet: "/assets/3d/robot_pet.glb",
      blender_mech_turret: "/assets/3d/mech_turret.glb",
      blender_fox_mask: "/assets/3d/fox_mask.glb",
      blender_wizard_hat: "/assets/3d/wizard_hat.glb",
      blender_tea_set: "/assets/3d/tea_set.glb",
      blender_hanging_sign: "/assets/3d/hanging_sign.glb",
    } as const;

    expect(BLENDER_PROP_GLTF_URLS).toEqual(expected);
    const blenderDefs = VRM_PROPS.filter((definition) => definition.id.startsWith("blender_"));
    expect(blenderDefs).toHaveLength(48);
    expect(Object.keys(BLENDER_PROP_GLTF_URLS)).toHaveLength(64);

    for (const [id, url] of Object.entries(expected)) {
      expect(propDefById(id)?.geometrySource, id).toEqual({ kind: "gltf", url });
      const bytes = readFileSync(new URL(`../../../../public${url}`, import.meta.url));
      expect(bytes.subarray(0, 4).toString("ascii"), url).toBe("glTF");
    }
  });

  it("업그레이드하지 않은 기존 소품은 명시적인 procedural 출처를 유지한다", () => {
    const proceduralDefs = VRM_PROPS.filter((definition) => definition.geometrySource.kind === "procedural");
    expect(proceduralDefs.length).toBeGreaterThan(0);
    expect(proceduralDefs.every((definition) => definition.geometrySource.kind === "procedural"))
      .toBe(true);
    for (const id of ["smartphone", "mug", "book", "cap", "glasses", "backpack", "stethoscope"]) {
      expect(propDefById(id)?.geometrySource.kind, id).toBe("gltf");
    }
  });

  it("매핑된 first-party GLB 64개가 실제 mesh scene으로 파싱된다", async () => {
    const loader = new GLTFLoader();
    for (const url of Object.values(BLENDER_PROP_GLTF_URLS)) {
      const bytes = readFileSync(new URL(`../../../../public${url}`, import.meta.url));
      const arrayBuffer = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer;
      const gltf = await loader.parseAsync(arrayBuffer, "");
      let meshCount = 0;
      gltf.scene.traverse((object) => {
        if (object.type === "Mesh") meshCount += 1;
      });
      expect(meshCount, url).toBeGreaterThan(0);
    }
  });

  it("Wave 3 손 소품 앵커가 실제 GLB 손잡이 메시 안에 있다", async () => {
    const gates = [
      { id: "blender_cyber_katana", node: "Handle_Core", anchors: ["primary", "secondary"] },
      { id: "blender_magic_staff", node: "Staff_LeatherGrip", anchors: ["primary", "secondary"] },
      { id: "blender_rune_shield", node: "RuneShield_BackGrip", anchors: ["primary", "secondary"] },
      { id: "blender_holo_tablet", node: "Tablet_LeftGrip", anchors: ["primary"] },
      { id: "blender_medieval_greatsword", node: "Greatsword_GripCore", anchors: ["primary"] },
      { id: "blender_cyber_sniper_rifle", node: "Sniper_PistolGrip", anchors: ["primary"] },
      { id: "blender_magic_wand_staff", node: "Wand_GripWrap_5", anchors: ["primary"] },
      { id: "blender_scifi_laser_gun", node: "LaserGun_PistolGrip", anchors: ["primary"] },
      { id: "blender_magic_grimoire", node: "Grimoire_BackCover", anchors: ["primary"] },
      { id: "blender_medieval_shield", node: "MedievalShield_BackHandle", anchors: ["primary"] },
      { id: "blender_crystal_orb", node: "CrystalOrb_Pedestal", anchors: ["primary"] },
    ] as const;
    const loader = new GLTFLoader();
    for (const gate of gates) {
      const def = propDefById(gate.id)!;
      const url = BLENDER_PROP_GLTF_URLS[gate.id];
      const bytes = readFileSync(new URL(`../../../../public${url}`, import.meta.url));
      const arrayBuffer = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer;
      const gltf = await loader.parseAsync(arrayBuffer, "");
      gltf.scene.updateMatrixWorld(true);
      const contact = gltf.scene.getObjectByName(gate.node);
      expect(contact, `${gate.id}: ${gate.node}`).toBeDefined();
      const contactBounds = new Box3().setFromObject(contact!);
      for (const anchorId of gate.anchors) {
        const contactAnchor = def.anchors.find((candidate) => candidate.id === anchorId)!;
        const gap = contactBounds.distanceToPoint(new Vector3(...contactAnchor.position));
        expect(gap, `${gate.id}/${anchorId}: contact gap`).toBeLessThanOrEqual(0.002);
      }
    }
  });

  it("Wave 3 무기 앵커는 GLB의 -Z 날끝·총구 방향을 손가락 전방으로 선언한다", () => {
    for (const id of [
      "blender_cyber_katana",
      "blender_medieval_greatsword",
      "blender_cyber_sniper_rifle",
      "blender_magic_wand_staff",
      "blender_scifi_laser_gun",
    ]) {
      const primary = propDefById(id)!.anchors.find((candidate) => candidate.role === "primary")!;
      expect(primary.forward, id).toEqual([0, 0, -1]);
    }
  });

  it("Wave 3 머리 GLB 기본 배율과 전면 앵커가 실측 VRM 머리 범위에 맞는다", async () => {
    const gates = [
      { id: "blender_cyber_visor", maxScale: 0.68, anchorZ: 0.015 },
      { id: "blender_tactical_helmet", maxScale: 0.48, anchorZ: 0.105 },
    ] as const;
    const loader = new GLTFLoader();
    for (const gate of gates) {
      const def = propDefById(gate.id)!;
      expect(def.defaultScale, gate.id).toBeLessThanOrEqual(gate.maxScale);
      expect(def.anchors[0].position[2], gate.id).toBeCloseTo(gate.anchorZ, 6);

      const url = BLENDER_PROP_GLTF_URLS[gate.id];
      const bytes = readFileSync(new URL(`../../../../public${url}`, import.meta.url));
      const arrayBuffer = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer;
      const gltf = await loader.parseAsync(arrayBuffer, "");
      const size = new Vector3();
      new Box3().setFromObject(gltf.scene).getSize(size);
      // Head metric and bounds calibrated on the retired procedural reference rig.
      const referenceHeadMetric = 0.185916;
      const referenceHeadBounds = new Vector3(0.232394, 0.278873, 0.199859);
      const fittedScale = def.defaultScale * referenceHeadMetric / def.fit.designReference;
      const fitted = size.multiplyScalar(fittedScale);
      expect(fitted.x / referenceHeadBounds.x, `${gate.id}: width`).toBeLessThanOrEqual(1.2);
      expect(fitted.y / referenceHeadBounds.y, `${gate.id}: height`).toBeLessThanOrEqual(1.2);
      expect(fitted.z / referenceHeadBounds.z, `${gate.id}: depth`).toBeLessThanOrEqual(1.35);
    }
  });

  it("좌석·컨트롤 surface 앵커는 실제 접촉면 상단이며 기존 GLB root 배치를 보존한다", async () => {
    const gates = [
      { id: "blender_neon_bench", nodePrefix: "Bench_SeatSlat_", root: [0, -0.85, 0] },
      { id: "blender_arcade_cabinet", nodePrefix: "Arcade_ControlDeck", root: [0, -0.85, -0.2] },
      { id: "blender_cyber_hoverbike", nodePrefix: "Hoverbike_RiderSeat", root: [0, -0.95, 0] },
      { id: "blender_cyberpunk_motorcycle", nodePrefix: "Motorcycle_RiderSeat", root: [0, -0.85, 0] },
      { id: "blender_royal_throne", nodePrefix: "Throne_SeatCushion", root: [0, -1, -0.2] },
    ] as const;
    const loader = new GLTFLoader();
    for (const gate of gates) {
      const def = propDefById(gate.id)!;
      const anchor = def.anchors.find((candidate) => candidate.role === "surface")!;
      const url = BLENDER_PROP_GLTF_URLS[gate.id];
      const bytes = readFileSync(new URL(`../../../../public${url}`, import.meta.url));
      const arrayBuffer = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer;
      const gltf = await loader.parseAsync(arrayBuffer, "");
      gltf.scene.updateMatrixWorld(true);
      const surfaceBounds = new Box3();
      gltf.scene.traverse((object) => {
        if (object.name.startsWith(gate.nodePrefix)) surfaceBounds.expandByObject(object);
      });
      expect(surfaceBounds.isEmpty(), `${gate.id}: contact bounds`).toBe(false);
      expect(anchor.position[1], `${gate.id}: surface top`).toBeCloseTo(surfaceBounds.max.y, 3);
      expect(anchor.position[0]).toBeGreaterThanOrEqual(surfaceBounds.min.x - 0.002);
      expect(anchor.position[0]).toBeLessThanOrEqual(surfaceBounds.max.x + 0.002);
      expect(anchor.position[2]).toBeGreaterThanOrEqual(surfaceBounds.min.z - 0.002);
      expect(anchor.position[2]).toBeLessThanOrEqual(surfaceBounds.max.z + 0.002);
      for (let axis = 0; axis < 3; axis += 1) {
        expect(
          def.defaultPosition[axis]! - anchor.position[axis]!,
          `${gate.id}: preserved root axis ${axis}`,
        ).toBeCloseTo(gate.root[axis]!, 6);
      }
    }
  });

  it("어댑티브 전동휠체어를 별도 body 소품과 실측 좌석 앵커로 제공한다", () => {
    const wheelchair = propDefById("blender_adaptive_power_wheelchair");

    expect(wheelchair).toMatchObject({
      category: "body",
      defaultBone: "hips",
      defaultColor: null,
      defaultPosition: [0, -0.39, 0.02],
      geometrySource: {
        kind: "gltf",
        url: "/assets/3d/adaptive_power_wheelchair.glb",
      },
    });
    expect(wheelchair?.anchors).toEqual([
      expect.objectContaining({
        id: "seat",
        role: "surface",
        position: [0, 0.61, 0.02],
      }),
    ]);
    const seat = wheelchair?.anchors[0];
    expect((wheelchair?.defaultPosition[1] ?? 0) - (seat?.position[1] ?? 0))
      .toBeCloseTo(-1, 6);
  });

  it("등록된 모든 소품이 유효한 접촉 앵커와 자동 맞춤 프로필을 가진다", () => {
    expect(VRM_PROPS.length).toBeGreaterThanOrEqual(37);

    for (const def of VRM_PROPS) {
      expect(def.anchors.length, `${def.id}: anchors`).toBeGreaterThan(0);
      expect(
        def.anchors.some((candidate) => candidate.role === "primary" || candidate.role === "surface"),
        `${def.id}: primary/surface`
      ).toBe(true);
      expect(new Set(def.anchors.map((candidate) => candidate.id)).size, `${def.id}: unique anchor id`).toBe(def.anchors.length);

      for (const candidate of def.anchors) {
        const values = [...candidate.position, ...candidate.forward, ...candidate.up];
        expect(values.every(Number.isFinite), `${def.id}/${candidate.id}: finite`).toBe(true);
        const forwardLength = Math.hypot(...candidate.forward);
        const upLength = Math.hypot(...candidate.up);
        const dot = candidate.forward[0] * candidate.up[0]
          + candidate.forward[1] * candidate.up[1]
          + candidate.forward[2] * candidate.up[2];
        expect(forwardLength, `${def.id}/${candidate.id}: forward`).toBeCloseTo(1, 6);
        expect(upLength, `${def.id}/${candidate.id}: up`).toBeCloseTo(1, 6);
        expect(dot, `${def.id}/${candidate.id}: orthogonal`).toBeCloseTo(0, 6);
        if (candidate.gripRadius !== undefined) {
          expect(candidate.gripRadius, `${def.id}/${candidate.id}: grip radius`).toBeGreaterThan(0);
        }
      }

      expect(Number.isFinite(def.fit.designReference), `${def.id}: design reference`).toBe(true);
      expect(def.fit.designReference, `${def.id}: design reference`).toBeGreaterThan(0);
      expect(def.fit.minScale, `${def.id}: min scale`).toBeGreaterThan(0);
      expect(def.fit.maxScale, `${def.id}: scale range`).toBeGreaterThanOrEqual(def.fit.minScale);
    }
  });

  it("모든 손 소품에 실제 그립 프로필과 primary 앵커가 있다", () => {
    for (const def of propsByCategory("hand")) {
      expect(def.grip, `${def.id}: grip`).toBeDefined();
      expect(def.grip!.radius, `${def.id}: radius`).toBeGreaterThan(0);
      expect(def.grip!.fingerCurlDeg, `${def.id}: finger curl`).toBeGreaterThanOrEqual(0);
      expect(def.grip!.thumbOppositionDeg, `${def.id}: thumb`).toBeGreaterThanOrEqual(0);
      const primary = def.anchors.find((candidate) => candidate.role === "primary");
      expect(primary, `${def.id}: primary`).toBeDefined();
      expect(primary!.gripRadius, `${def.id}: anchor grip radius`).toBeGreaterThan(0);
    }
  });

  it("양손 사용 소품은 secondary 앵커를 명시한다", () => {
    const twoHanded = ["book", "clipboard", "flute", "sword", "staff", "umbrella", "bouquet"];
    for (const id of twoHanded) {
      const def = propDefById(id)!;
      expect(def.anchors.some((candidate) => candidate.role === "secondary"), id).toBe(true);
    }
  });

  it("핵심 소품 앵커가 geometry의 실제 접촉점과 일치한다", () => {
    expect(propDefById("sword")!.anchors.find((candidate) => candidate.id === "primary")!.position).toEqual([0, -0.37, 0]);
    expect(propDefById("mug")!.anchors.find((candidate) => candidate.id === "primary")!.position).toEqual([0.07, 0, 0]);
    expect(propDefById("medicalBag")!.anchors.find((candidate) => candidate.id === "primary")!.position).toEqual([0, 0.155, 0]);
    expect(propDefById("umbrella")!.anchors.find((candidate) => candidate.id === "primary")!.position).toEqual([-0.03, -0.35, 0]);
  });

  it("응급 의료 가방 손잡이 앵커는 가방이 손 아래로 매달리는 방향을 기록한다", () => {
    const handle = propDefById("medicalBag")!.anchors.find((candidate) => candidate.id === "primary")!;
    expect(handle.forward).toEqual([0, -1, 0]);
    expect(handle.up).toEqual([0, 0, 1]);
  });
});

describe("부착 인스턴스 생성·직렬화", () => {
  it("카탈로그 기본값으로 인스턴스를 만든다", () => {
    const inst = createPropInstance("smartphone", "fixed");
    expect(inst).not.toBeNull();
    expect(inst!.propId).toBe("smartphone");
    expect(inst!.uid).toBe("fixed");
    expect(inst!.bone).toBe("rightHand");
    expect(inst!.rig).toEqual({
      version: 2,
      mode: "auto",
      anchorId: "primary",
      autoScale: true,
      autoFingerPose: true,
      gripFit: 1,
      deltaPosition: [0, 0, 0],
      deltaRotationDeg: [0, 0, 0],
      deltaScale: 1,
    });
  });

  it("알 수 없는 propId는 null", () => {
    expect(createPropInstance("nope")).toBeNull();
  });

  it("빈 배열은 직렬화 시 undefined(문서에 키 미생성)", () => {
    expect(serializeVrmProps([])).toBeUndefined();
  });

  it("직렬화 문서는 V2 버전을 명시한다", () => {
    expect(serializeVrmProps([createPropInstance("mug", "v2")!])?.version).toBe(VRM_PROPS_VERSION);
    expect(VRM_PROPS_VERSION).toBe(2);
  });

  it("저장 후 앱을 다시 연 다음 같은 소품을 추가해도 uid가 충돌하지 않는다", async () => {
    vi.resetModules();
    const beforeReload = await import("./studio-vrm-props");
    const saved = beforeReload.serializeVrmProps([beforeReload.createPropInstance("mug")!])!;

    vi.resetModules();
    const afterReload = await import("./studio-vrm-props");
    const loaded = afterReload.parseVrmProps(saved);
    const added = afterReload.createPropInstance("mug")!;

    expect(loaded.items[0].uid).toBe(saved.items[0].uid);
    expect(added.uid).not.toBe(loaded.items[0].uid);
  });

  it("중복·빈 직렬화 uid를 고유한 값으로 재발급하고 첫 유효 uid는 보존한다", () => {
    const parsed = parseVrmProps({
      version: VRM_PROPS_VERSION,
      items: [
        { propId: "mug", uid: "shared" },
        { propId: "book", uid: "shared" },
        { propId: "sword", uid: "" },
        { propId: "cap", uid: "   " },
        { propId: "crown", uid: "keep-me" },
      ],
    });
    const uids = parsed.items.map((item) => item.uid);

    expect(uids[0]).toBe("shared");
    expect(uids[1]).not.toBe("shared");
    expect(uids[4]).toBe("keep-me");
    expect(uids.every((uid) => uid.trim().length > 0)).toBe(true);
    expect(new Set(uids).size).toBe(uids.length);
  });

  it("직렬화 라운드트립이 값을 보존한다", () => {
    const inst = createPropInstance("crown", "c1")!;
    inst.position = [0.1, 0.2, -0.3];
    inst.rotationDeg = [10, 20, 30];
    inst.scale = 1.5;
    inst.color = "#abcdef";
    const ser = serializeVrmProps([inst]);
    const parsed = parseVrmProps(ser);
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0]).toMatchObject({
      propId: "crown",
      uid: "c1",
      position: [0.1, 0.2, -0.3],
      rotationDeg: [10, 20, 30],
      scale: 1.5,
      color: "#abcdef",
    });
  });

  it("범위를 벗어난 값을 클램프한다", () => {
    const parsed = parseVrmProps({
      items: [{ propId: "mug", uid: "m1", bone: "rightHand", position: [99, -99, 0], rotationDeg: [999, 0, 0], scale: 99, color: "#fff" }],
    });
    const item = parsed.items[0];
    expect(item.position[0]).toBeLessThanOrEqual(1);
    expect(item.position[1]).toBeGreaterThanOrEqual(-1);
    expect(Math.abs(item.rotationDeg[0])).toBeLessThanOrEqual(180);
    expect(item.scale).toBeLessThanOrEqual(4);
    expect(item.color).toBe("#e8e2d6"); // 잘못된 6자리 아님(#fff) → 기본색 폴백
  });

  it("알 수 없는 propId 항목은 파싱에서 제거된다", () => {
    const parsed = parseVrmProps({ items: [{ propId: "ghost" }, { propId: "book" }] });
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0].propId).toBe("book");
  });

  it("잘못된 본 이름은 기본 본으로 폴백한다", () => {
    const parsed = parseVrmProps({ items: [{ propId: "cap", bone: "tail" }] });
    expect(parsed.items[0].bone).toBe(propDefById("cap")!.defaultBone);
  });

  it("version 없음 또는 V1 문서는 기존 transform을 보존하고 rig를 해석하지 않는다", () => {
    const legacyItem = {
      uid: "legacy",
      propId: "sword",
      bone: "leftHand",
      position: [0.123, -0.234, 0.345],
      rotationDeg: [11, -22, 33],
      scale: 1.37,
      color: "#ABCDEF",
      rig: createPropInstance("sword")!.rig,
    };

    for (const raw of [{ items: [legacyItem] }, { version: 1, items: [legacyItem] }]) {
      const item = parseVrmProps(raw).items[0];
      expect(item).toMatchObject({
        uid: "legacy",
        propId: "sword",
        bone: "leftHand",
        position: [0.123, -0.234, 0.345],
        rotationDeg: [11, -22, 33],
        scale: 1.37,
        color: "#abcdef",
      });
      expect(item.rig).toBeUndefined();
    }
  });

  it("V2 문서라도 rig가 없는 항목은 레거시 항목으로 유지한다", () => {
    const item = parseVrmProps({
      version: 2,
      items: [{ uid: "legacy-v2", propId: "mug", position: [0.1, 0.2, 0.3] }],
    }).items[0];
    expect(item.position).toEqual([0.1, 0.2, 0.3]);
    expect(item.rig).toBeUndefined();
  });

  it("V2 rig와 양손 보조점을 직렬화 라운드트립한다", () => {
    const book = createPropInstance("book", "book-v2")!;
    book.rig = {
      ...book.rig!,
      mode: "custom",
      deltaPosition: [0.03, -0.02, 0.01],
      deltaRotationDeg: [12, -18, 4],
      deltaScale: 1.2,
      secondary: {
        enabled: true,
        anchorId: "secondary",
        bone: "rightHand",
        influence: 0.75,
        elbowHint: [0.1, 0.2, -0.1],
      },
    };

    const parsed = parseVrmProps(serializeVrmProps([book]));
    expect(parsed.version).toBe(2);
    expect(parsed.items[0].rig).toEqual(book.rig);
  });

  it("손상된 V2 rig를 카탈로그 기본 앵커와 안전 범위로 정규화한다", () => {
    const parsed = parseVrmProps({
      version: 2,
      items: [{
        uid: "bad-rig",
        propId: "book",
        bone: "leftHand",
        rig: {
          version: 2,
          mode: "unexpected",
          anchorId: "missing",
          autoScale: "yes",
          autoFingerPose: null,
          gripFit: 99,
          deltaPosition: [99, -99, Number.NaN],
          deltaRotationDeg: [999, -999, Number.POSITIVE_INFINITY],
          deltaScale: 99,
          secondary: {
            enabled: "yes",
            anchorId: "missing-secondary",
            bone: "leftHand",
            influence: 99,
            elbowHint: [99, -99, Number.NaN],
          },
        },
      }],
    });

    expect(parsed.items[0].rig).toEqual({
      version: 2,
      mode: "auto",
      anchorId: "primary",
      autoScale: true,
      autoFingerPose: true,
      gripFit: 1.3,
      deltaPosition: [1, -1, 0],
      deltaRotationDeg: [180, -180, 0],
      deltaScale: 4,
      secondary: {
        enabled: false,
        anchorId: "secondary",
        bone: "rightHand",
        influence: 1,
        elbowHint: [1, -1, 0],
      },
    });
  });

  it("gripFit이 없던 기존 V2 문서는 기본 100%로 마이그레이션한다", () => {
    const legacy = createPropInstance("mug", "legacy-v2-grip")!;
    const legacyRig = { ...legacy.rig } as Record<string, unknown>;
    delete legacyRig.gripFit;

    const parsed = parseVrmProps({
      version: 2,
      items: [{ ...legacy, rig: legacyRig }],
    });

    expect(parsed.items[0].rig?.gripFit).toBe(1);
  });

  it("양손 소품의 누락된 영향도와 스마트 회전을 소품별 안전 기본값으로 복구한다", () => {
    const parsed = parseVrmProps({
      version: 2,
      items: [{
        uid: "book-safe-defaults",
        propId: "book",
        bone: "leftHand",
        rig: {
          version: 2,
          mode: "auto",
          anchorId: "primary",
          secondary: {
            enabled: true,
            anchorId: "secondary",
            bone: "rightHand",
          },
        },
      }],
    });

    expect(parsed.items[0].rig?.secondary?.influence).toBe(0.65);
    // 책은 XY 평면에 눕는 GLB라 표지 중앙 접점 + 90° 회전이 손바닥 위 얹힘이다.
    expect(propDefById("book")?.smartRotationDeg).toEqual([0, 0, 90]);
  });

  it("V2가 아닌 item rig와 secondary 미지원 소품의 보조점은 제거한다", () => {
    const parsed = parseVrmProps({
      version: 2,
      items: [
        { propId: "sword", rig: { version: 1, anchorId: "primary" } },
        {
          propId: "mug",
          rig: {
            version: 2,
            mode: "auto",
            anchorId: "primary",
            secondary: { enabled: true, anchorId: "secondary", bone: "leftHand", influence: 1 },
          },
        },
      ],
    });

    expect(parsed.items[0].rig).toBeUndefined();
    expect(parsed.items[1].rig).toBeDefined();
    expect(parsed.items[1].rig!.secondary).toBeUndefined();
  });
});

function legacyProjectionItem(propId: string, uid: string): PropInstance {
  const item = createPropInstance(propId, uid)!;
  const { rig: _rig, ...legacy } = item;
  return legacy;
}

function freezeTestValue<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) freezeTestValue(child);
  return Object.freeze(value);
}

function expectDeeplyFrozen(value: unknown, seen = new WeakSet<object>()): void {
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectDeeplyFrozen(child, seen);
}

describe("Shared Stage 소품 문서 엄격 검사", () => {
  it("absent·legacy·V1·V2를 기존 스키마 의미에 맞게 구분한다", () => {
    const legacyItem = legacyProjectionItem("mug", "legacy-mug");
    const v2Item = createPropInstance("smartphone", "v2-phone")!;

    expect(inspectVrmPropsDocumentForProjection(undefined)).toEqual({
      status: "ready",
      sourceVersion: "absent",
      document: { version: 2, items: [] },
    });
    expect(inspectVrmPropsDocumentForProjection({ items: [legacyItem] })).toMatchObject({
      status: "ready",
      sourceVersion: "legacy",
      document: { items: [{ uid: "legacy-mug", propId: "mug" }] },
    });
    expect(inspectVrmPropsDocumentForProjection({ version: 1, items: [legacyItem] })).toMatchObject({
      status: "ready",
      sourceVersion: 1,
      document: { items: [{ uid: "legacy-mug", propId: "mug" }] },
    });
    expect(inspectVrmPropsDocumentForProjection({ version: 2, items: [v2Item] })).toMatchObject({
      status: "ready",
      sourceVersion: 2,
      document: { items: [{ uid: "v2-phone", propId: "smartphone", rig: { version: 2 } }] },
    });
  });

  it("시간·난수·crypto 없이 결정적으로 검사하고 입력을 변경하지 않는다", () => {
    const input = {
      version: 2,
      items: [createPropInstance("book", "deterministic-book")!],
    };
    const before = structuredClone(input);
    freezeTestValue(input);
    const random = vi.spyOn(Math, "random");
    const now = vi.spyOn(Date, "now");
    const randomUUID = vi.fn(() => "inspector-must-not-request-a-uuid");
    vi.stubGlobal("crypto", { randomUUID });

    try {
      const first = inspectVrmPropsDocumentForProjection(input);
      const second = inspectVrmPropsDocumentForProjection(input);

      expect(first).toEqual(second);
      expect(input).toEqual(before);
      expect(random).not.toHaveBeenCalled();
      expect(now).not.toHaveBeenCalled();
      expect(randomUUID).not.toHaveBeenCalled();
      expectDeeplyFrozen(first);
      if (first.status === "ready") {
        expect(first.document.items[0]).not.toBe(input.items[0]);
        expect(first.document.items[0].rig).not.toBe(input.items[0].rig);
      }
    } finally {
      random.mockRestore();
      now.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it("검사가 전역 UID 카운터나 발급 레지스트리를 예약하지 않는다", async () => {
    vi.stubGlobal("crypto", { randomUUID: () => "projection-registry" });

    try {
      vi.resetModules();
      const baseline = await import("./studio-vrm-props");
      const expectedNextUid = baseline.nextPropUid("mug");

      vi.resetModules();
      const inspected = await import("./studio-vrm-props");
      const def = inspected.propDefById("mug")!;
      const result = inspected.inspectVrmPropsDocumentForProjection({
        version: 2,
        items: [{
          uid: expectedNextUid,
          propId: def.id,
          bone: def.defaultBone,
          position: def.defaultPosition,
          rotationDeg: def.defaultRotationDeg,
          scale: def.defaultScale,
          color: def.defaultColor,
          rig: {
            version: 2,
            mode: "auto",
            anchorId: "primary",
            autoScale: true,
            autoFingerPose: true,
            gripFit: 1,
            deltaPosition: [0, 0, 0],
            deltaRotationDeg: [0, 0, 0],
            deltaScale: 1,
          },
        }],
      });

      expect(result.status).toBe("ready");
      expect(inspected.nextPropUid("mug")).toBe(expectedNextUid);
    } finally {
      vi.resetModules();
      vi.unstubAllGlobals();
    }
  });

  it("미래·알 수 없는 문서 버전을 명시적으로 전체 거부한다", () => {
    const result = inspectVrmPropsDocumentForProjection({
      version: VRM_PROPS_VERSION + 1,
      items: [legacyProjectionItem("mug", "future-mug")],
    });

    expect(result).toEqual({
      status: "rejected",
      sourceVersion: "unknown",
      issues: [{ reason: "unsupported-version", path: "version" }],
    });
    expectDeeplyFrozen(result);
  });

  it("알 수 없는 루트·항목 필드를 조용히 무시하지 않고 정확한 경로로 거부한다", () => {
    const rootResult = inspectVrmPropsDocumentForProjection({
      version: 2,
      items: [],
      futureRuntime: { enabled: true },
    });
    expect(rootResult).toEqual({
      status: "rejected",
      sourceVersion: 2,
      issues: [{ reason: "unsupported-document-field", path: "futureRuntime" }],
    });

    const itemResult = inspectVrmPropsDocumentForProjection({
      version: 1,
      items: [{ ...legacyProjectionItem("mug", "future-item"), futureSocket: "tail" }],
    });
    expect(itemResult).toEqual({
      status: "rejected",
      sourceVersion: 1,
      issues: [{
        reason: "unsupported-item-field",
        path: "items[0].futureSocket",
        itemIndex: 0,
        uid: "future-item",
        propId: "mug",
      }],
    });
  });

  it("알 수 없는 propId를 조용히 제거하지 않고 정확한 항목으로 거부한다", () => {
    const result = inspectVrmPropsDocumentForProjection({
      version: 1,
      items: [{
        uid: "unknown-prop",
        propId: "future-laser-sword",
        bone: "rightHand",
        position: [0, 0, 0],
        rotationDeg: [0, 0, 0],
        scale: 1,
        color: "#ffffff",
      }],
    });

    expect(result).toEqual({
      status: "rejected",
      sourceVersion: 1,
      issues: [{
        reason: "unknown-prop-id",
        path: "items[0].propId",
        itemIndex: 0,
        uid: "unknown-prop",
        propId: "future-laser-sword",
      }],
    });
  });

  it("중복·누락·빈 UID를 재발급하지 않고 항목별로 모두 보고한다", () => {
    const first = legacyProjectionItem("mug", "duplicate");
    const missing = { ...legacyProjectionItem("book", "remove-me") } as Partial<PropInstance>;
    delete missing.uid;
    const invalid = { ...legacyProjectionItem("sword", "") };
    const duplicate = legacyProjectionItem("cap", "duplicate");

    const result = inspectVrmPropsDocumentForProjection({
      version: 1,
      items: [first, missing, invalid, duplicate],
    });
    expect(result).toMatchObject({
      status: "rejected",
      sourceVersion: 1,
      issues: [
        { reason: "missing-uid", path: "items[1].uid", itemIndex: 1, propId: "book" },
        { reason: "invalid-uid", path: "items[2].uid", itemIndex: 2, uid: "", propId: "sword" },
        { reason: "duplicate-uid", path: "items[3].uid", itemIndex: 3, uid: "duplicate", propId: "cap" },
      ],
    });
  });

  it("지원하지 않는 본과 손상·미지원 rig 필드를 정확한 경로로 거부한다", () => {
    const invalidBone = { ...legacyProjectionItem("cap", "bad-bone"), bone: "tail" };
    const book = createPropInstance("book", "bad-rig")!;
    book.rig = {
      ...book.rig!,
      anchorId: "missing-primary",
      gripFit: 99,
      secondary: {
        enabled: true,
        anchorId: "secondary",
        bone: "leftHand",
        influence: 2,
      },
    };
    const rigWithUnknownField = { ...book.rig, futureConstraint: true };

    const result = inspectVrmPropsDocumentForProjection({
      version: 2,
      items: [invalidBone, { ...book, rig: rigWithUnknownField }],
    });
    expect(result).toMatchObject({ status: "rejected", sourceVersion: 2 });
    if (result.status !== "rejected") throw new Error("손상된 본/rig 문서가 승인되었습니다.");
    expect(result.issues).toEqual([
      {
        reason: "invalid-bone",
        path: "items[0].bone",
        itemIndex: 0,
        uid: "bad-bone",
        propId: "cap",
      },
      {
        reason: "unsupported-rig-field",
        path: "items[1].rig.futureConstraint",
        itemIndex: 1,
        uid: "bad-rig",
        propId: "book",
      },
      {
        reason: "invalid-rig-anchor",
        path: "items[1].rig.anchorId",
        itemIndex: 1,
        uid: "bad-rig",
        propId: "book",
      },
      {
        reason: "invalid-rig-grip-fit",
        path: "items[1].rig.gripFit",
        itemIndex: 1,
        uid: "bad-rig",
        propId: "book",
      },
      {
        reason: "invalid-secondary-bone",
        path: "items[1].rig.secondary.bone",
        itemIndex: 1,
        uid: "bad-rig",
        propId: "book",
      },
      {
        reason: "invalid-secondary-influence",
        path: "items[1].rig.secondary.influence",
        itemIndex: 1,
        uid: "bad-rig",
        propId: "book",
      },
    ]);
    expectDeeplyFrozen(result);
  });

  it("기존 V2의 누락 gripFit·보조 손 influence만 결정적 기본값으로 승격한다", () => {
    const book = createPropInstance("book", "legacy-v2-rig-defaults")!;
    const legacyRig = {
      ...book.rig!,
      secondary: {
        enabled: true,
        anchorId: "secondary",
        bone: "rightHand",
      },
    } as Record<string, unknown>;
    delete legacyRig.gripFit;

    const result = inspectVrmPropsDocumentForProjection({
      version: 2,
      items: [{ ...book, rig: legacyRig }],
    });

    expect(result).toMatchObject({
      status: "ready",
      sourceVersion: 2,
      document: {
        items: [{
          uid: "legacy-v2-rig-defaults",
          rig: { gripFit: 1, secondary: { influence: 0.65 } },
        }],
      },
    });
    expectDeeplyFrozen(result);
  });

  it("유효한 한손·양손 소품을 원문과 분리된 깊은 불변 V2 문서로 승인한다", () => {
    const mug = createPropInstance("mug", "hand-mug")!;
    const book = createPropInstance("book", "two-hand-book")!;
    book.rig = {
      ...book.rig!,
      secondary: {
        enabled: true,
        anchorId: "secondary",
        bone: "rightHand",
        influence: 0.65,
        elbowHint: [0.1, 0.2, -0.1],
      },
    };
    const input = { version: 2, items: [mug, book] };

    const result = inspectVrmPropsDocumentForProjection(input);

    expect(result).toEqual({
      status: "ready",
      sourceVersion: 2,
      document: { version: 2, items: [mug, book] },
    });
    expectDeeplyFrozen(result);
    if (result.status === "ready") {
      expect(result.document.items[0]).not.toBe(mug);
      expect(result.document.items[1].rig?.secondary).not.toBe(book.rig?.secondary);
    }
  });

  it("legacy/V1에 섞인 rig를 새 의미로 해석하거나 조용히 제거하지 않는다", () => {
    const item = createPropInstance("mug", "legacy-rig")!;
    const result = inspectVrmPropsDocumentForProjection({ version: 1, items: [item] });

    expect(result).toMatchObject({
      status: "rejected",
      sourceVersion: 1,
      issues: [{
        reason: "rig-not-supported-for-source-version",
        path: "items[0].rig",
        itemIndex: 0,
        uid: "legacy-rig",
        propId: "mug",
      }],
    });
  });
});

/* three 목 — 메시 빌더가 three 없이도 동작하는지 검증 */
function makeThreeMock(): { three: ThreeLike; created: string[]; meshObjects: ThreeObject[] } {
  const created: string[] = [];
  const meshObjects: ThreeObject[] = [];
  class Obj implements ThreeObject {
    name = "";
    children: Obj[] = [];
    position = { set() {} };
    rotation = { set() {} };
    scale = { setScalar() {} };
    add(child: ThreeObject) {
      this.children.push(child as Obj);
    }
  }
  const three: ThreeLike = {
    Group: Obj as unknown as ThreeLike["Group"],
    Mesh: class {
      constructor() {
        created.push("mesh");
        const object = new Obj();
        meshObjects.push(object);
        return object;
      }
    } as unknown as ThreeLike["Mesh"],
    MeshStandardMaterial: class {} as unknown as ThreeLike["MeshStandardMaterial"],
    BoxGeometry: class {} as unknown as ThreeLike["BoxGeometry"],
    CylinderGeometry: class {} as unknown as ThreeLike["CylinderGeometry"],
    SphereGeometry: class {} as unknown as ThreeLike["SphereGeometry"],
    ConeGeometry: class {} as unknown as ThreeLike["ConeGeometry"],
    TorusGeometry: class {} as unknown as ThreeLike["TorusGeometry"],
    Color: class {} as unknown as ThreeLike["Color"],
    DoubleSide: 2,
  };
  return { three, created, meshObjects };
}

describe("소품 메시 빌더", () => {
  it("모든 절차형 소품이 에러 없이 메시 그룹을 만든다", () => {
    for (const def of VRM_PROPS.filter((definition) => definition.geometrySource.kind === "procedural") as readonly PropDef[]) {
      const { three } = makeThreeMock();
      const obj = buildPropObject(three, def, def.defaultColor);
      expect(obj.name).toBe(`prop:${def.id}`);
    }
  });

  it("색상 인스턴스 오버라이드를 수용한다", () => {
    const { three } = makeThreeMock();
    const def = propDefById("cape")!;
    const obj = buildPropObject(three, def, "#123456");
    expect(obj.name).toBe("prop:cape");
  });

  it("모든 절차형 소품 표면이 캐릭터 장면의 그림자에 참여한다", () => {
    for (const def of VRM_PROPS.filter((definition) => definition.geometrySource.kind === "procedural") as readonly PropDef[]) {
      const { three, meshObjects } = makeThreeMock();
      buildPropObject(three, def, def.defaultColor);
      expect(meshObjects.length, def.id).toBeGreaterThan(0);
      expect(meshObjects.every((object) => object.castShadow && object.receiveShadow), def.id)
        .toBe(true);
    }
  });

  it("GLB 소품을 5cm 절차형 fallback 큐브로 위장하지 않는다", () => {
    for (const def of VRM_PROPS.filter((definition) => definition.geometrySource.kind === "gltf")) {
      const { three, created } = makeThreeMock();
      expect(() => buildPropObject(three, def, null), def.id).toThrow(/must be loaded from/u);
      expect(created, def.id).toEqual([]);
    }
  });

  it("프로덕션 품질 어댑터가 있으면 날카로운 박스를 안전 반경의 둥근 모서리로 바꾼다", () => {
    const { three } = makeThreeMock();
    const roundedBox = vi.fn((
      _width: number,
      _height: number,
      _depth: number,
      _radius: number,
    ) => ({ kind: "rounded-box" }));
    buildPropObject(
      three,
      propDefById("cape")!,
      null,
      { roundedBox },
    );

    expect(roundedBox).toHaveBeenCalled();
    for (const [width, height, depth, radius] of roundedBox.mock.calls) {
      expect(radius).toBeGreaterThan(0);
      expect(radius).toBeLessThanOrEqual(Math.min(width, height, depth) / 2);
    }
  });
});
