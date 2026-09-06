import { describe, expect, it } from "vitest";

import {
  STUDIO_VRM_BODY_SILHOUETTE_VERSION,
  sampleBodySilhouette,
  type BodySilhouette,
  type BodySilhouetteRing,
} from "./studio-vrm-body-silhouette";
import {
  FALLBACK_WARDROBE_METRICS,
  DEFAULT_WARDROBE_OPTIONS,
  VRM_WARDROBE_VERSION,
  WARDROBE_BONES,
  WARDROBE_FABRICS,
  WARDROBE_FIT_MAX,
  WARDROBE_FIT_MIN,
  WARDROBE_HIDE_COSTUME_SLOTS,
  WARDROBE_ITEMS,
  LEGACY_WARDROBE_REPLACEMENTS,
  SELECTABLE_WARDROBE_SETS,
  WARDROBE_SETS,
  WARDROBE_SLOTS,
  applyWardrobeItemSelection,
  applyWardrobeSet,
  buildGarmentParts,
  createWardrobeEquip,
  mergeWardrobeCostumeVisibility,
  parseWardrobe,
  parseWardrobeDocument,
  sanitizeWardrobeMetrics,
  selectableWardrobeItemsBySlot,
  selectableWardrobeSetById,
  serializeWardrobe,
  wardrobeItemById,
  wardrobeFabricById,
  wardrobeItemsBySlot,
  resolveWardrobeItemForNewSelection,
  type GarmentPart,
  type GarmentShape,
  type WardrobeMetrics,
  type WardrobeState,
} from "./studio-vrm-wardrobe";

describe("워드로브 카탈로그", () => {
  it("id가 모두 고유하다", () => {
    const ids = WARDROBE_ITEMS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("슬롯별 7종씩 28종이 등록되어 있다", () => {
    expect(WARDROBE_ITEMS.length).toBe(28);
    for (const slot of WARDROBE_SLOTS) {
      expect(wardrobeItemsBySlot(slot).length).toBe(7);
    }
  });

  it("의료 가운·스크럽·팬츠·클로그를 실제 파츠로 제공한다", () => {
    expect(wardrobeItemById("labcoat")?.slot).toBe("outer");
    expect(wardrobeItemById("scrubs")?.slot).toBe("top");
    expect(wardrobeItemById("scrubpants")?.slot).toBe("bottom");
    expect(wardrobeItemById("clogs")?.slot).toBe("shoes");
    for (const id of ["labcoat", "scrubs", "scrubpants", "clogs"]) {
      expect(buildGarmentParts(id, FALLBACK_WARDROBE_METRICS).length, id).toBeGreaterThan(1);
    }
  });

  it("모든 아이템이 라벨·힌트·기본색을 가진다", () => {
    for (const item of WARDROBE_ITEMS) {
      expect(item.label.length).toBeGreaterThan(0);
      expect(item.hint.length).toBeGreaterThan(0);
      expect(item.defaultColor).toMatch(/^#[0-9a-f]{6}$/i);
      expect(wardrobeFabricById(item.defaultFabricId)).toBeDefined();
      expect(item.fitProfile.version).toBe(1);
      expect(item.fitProfile.regions.length).toBeGreaterThan(0);
      expect(item.geometrySource).toBe(
        item.id === "pleated" || item.id === "longskirt"
          ? "xpbd-skirt-v1"
          : item.slot === "shoes"
            ? "rigid-procedural"
            : "skinned-procedural-v1",
      );
    }
  });

  it("플리츠·롱스커트의 XPBD 범위와 자기 충돌 미지원을 과장 없이 안내한다", () => {
    for (const itemId of ["pleated", "longskirt"] as const) {
      const item = wardrobeItemById(itemId);
      expect(item?.geometrySource).toBe("xpbd-skirt-v1");
      expect(item?.hint).toContain("신체");
      expect(item?.hint).toContain("자기 충돌은 아직 지원하지 않습니다");
      expect(item?.hint).not.toContain("절대 뚫리지 않");
    }
  });

  it("직물 프리셋은 유효한 물성과 쉬운 설명을 제공한다", () => {
    expect(WARDROBE_FABRICS.length).toBeGreaterThanOrEqual(8);
    for (const fabric of WARDROBE_FABRICS) {
      expect(fabric.label.length).toBeGreaterThan(0);
      expect(fabric.hint.length).toBeGreaterThan(0);
      expect(fabric.roughness).toBeGreaterThanOrEqual(0);
      expect(fabric.roughness).toBeLessThanOrEqual(1);
      expect(fabric.metalness).toBeGreaterThanOrEqual(0);
      expect(fabric.metalness).toBeLessThanOrEqual(1);
      expect(fabric.weaveStrength).toBeGreaterThanOrEqual(0);
    }
  });

  it("wardrobeItemById는 미지의 id에 undefined를 준다", () => {
    expect(wardrobeItemById("no-such-item")).toBeUndefined();
    expect(wardrobeItemById("blazer")?.slot).toBe("outer");
  });

  it("Wave 3에서 저품질 10종을 다중 파츠 본 추종형 의상으로 승격한다", () => {
    const upgradedIds = [
      "tank",
      "tshirt",
      "shorts",
      "scrubs",
      "sailor",
      "dress",
      "cardigan",
      "pants",
      "wide",
      "scrubpants",
    ].sort();

    expect(LEGACY_WARDROBE_REPLACEMENTS).toEqual({});
    expect(
      WARDROBE_ITEMS.filter((item) => item.catalogStatus === "legacy-only")
        .map((item) => item.id)
        .sort(),
    ).toEqual([]);

    for (const id of upgradedIds) {
      const item = wardrobeItemById(id);
      const resolved = resolveWardrobeItemForNewSelection(id);
      const parts = buildGarmentParts(id, FALLBACK_WARDROBE_METRICS);
      expect(item?.quality, id).toBe("standard-procedural");
      expect(item?.catalogStatus, id).toBe("selectable");
      expect(item?.replacementId, id).toBeNull();
      expect(item?.geometrySource, id).toBe("skinned-procedural-v1");
      expect(resolved?.id, id).toBe(id);
      expect(parts.length, id).toBeGreaterThanOrEqual(5);
      expect(new Set(parts.map((part) => part.shape.kind)).size, id).toBeGreaterThanOrEqual(2);
    }
  });

  it("신규 선택 목록과 세트에는 legacy-only ID가 없고 승격 ID를 그대로 쓴다", () => {
    const legacyIds = new Set(Object.keys(LEGACY_WARDROBE_REPLACEMENTS));
    for (const slot of WARDROBE_SLOTS) {
      const selectable = selectableWardrobeItemsBySlot(slot);
      expect(selectable.length).toBeGreaterThan(0);
      for (const item of selectable) {
        expect(item.catalogStatus).toBe("selectable");
        expect(legacyIds.has(item.id), item.id).toBe(false);
      }
    }

    expect(SELECTABLE_WARDROBE_SETS).toHaveLength(WARDROBE_SETS.length);
    for (const set of SELECTABLE_WARDROBE_SETS) {
      expect(selectableWardrobeSetById(set.id)).toEqual(set);
      for (const pick of Object.values(set.equips)) {
        expect(legacyIds.has(pick.itemId), `${set.id}.${pick.itemId}`).toBe(
          false,
        );
      }
    }
  });
});

describe("베이크드 의상 자동 숨김", () => {
  const meshes = [
    { key: "shirt-mesh", slot: "tops" as const },
    { key: "coat-mesh", slot: "outer" as const },
    { key: "pants-mesh", slot: "bottoms" as const },
    { key: "dress-mesh", slot: "onepiece" as const },
    { key: "shoes-mesh", slot: "shoes" as const },
    { key: "accessory-mesh", slot: "accessory" as const },
  ];

  it("복원된 워드로브와 겹치는 원본 의상만 숨긴다", () => {
    const wardrobe = applyWardrobeSet(WARDROBE_SETS.find((set) => set.id === "doctor")!);
    const result = mergeWardrobeCostumeVisibility(
      { hidden: ["manual-hidden"], recolor: { "shirt-mesh": "#123456" } },
      wardrobe,
      meshes,
      true,
    );

    expect(result.hidden).toEqual(expect.arrayContaining([
      "manual-hidden",
      "shirt-mesh",
      "coat-mesh",
      "pants-mesh",
      "dress-mesh",
      "shoes-mesh",
    ]));
    expect(result.hidden).not.toContain("accessory-mesh");
    expect(result.recolor).toEqual({ "shirt-mesh": "#123456" });
  });

  it("자동 숨김을 끄면 사용자 상태만 복제해 반환한다", () => {
    const original = { hidden: ["manual-hidden"], recolor: { "shirt-mesh": "#123456" } };
    const result = mergeWardrobeCostumeVisibility(
      original,
      applyWardrobeSet(WARDROBE_SETS.find((set) => set.id === "doctor")!),
      meshes,
      false,
    );

    expect(result).toEqual(original);
    expect(result).not.toBe(original);
    expect(result.hidden).not.toBe(original.hidden);
    expect(result.recolor).not.toBe(original.recolor);
  });

  it("빈 워드로브는 원본 의상 가시성을 바꾸지 않고 중복 숨김 키를 제거한다", () => {
    expect(mergeWardrobeCostumeVisibility(
      { hidden: ["shirt-mesh", "shirt-mesh"], recolor: {} },
      {},
      meshes,
      true,
    )).toEqual({ hidden: ["shirt-mesh"], recolor: {} });
  });

  it("equip→unequip 뒤에도 사용자가 직접 숨긴 원본 의상은 그대로 숨긴다", () => {
    const authored = { hidden: ["shirt-mesh"], recolor: {} };
    const equipped = { top: createWardrobeEquip("shirt")! };
    expect(mergeWardrobeCostumeVisibility(authored, equipped, meshes, true).hidden)
      .toContain("shirt-mesh");
    expect(mergeWardrobeCostumeVisibility(authored, {}, meshes, true).hidden)
      .toEqual(["shirt-mesh"]);
    expect(authored.hidden).toEqual(["shirt-mesh"]);
  });

  it("top과 bottom 중 하나를 해제해도 남은 슬롯이 onepiece 숨김 소유권을 유지한다", () => {
    const both: WardrobeState = {
      top: createWardrobeEquip("shirt")!,
      bottom: createWardrobeEquip("jeans")!,
    };
    const bottomOnly: WardrobeState = { bottom: both.bottom };
    expect(mergeWardrobeCostumeVisibility({ hidden: [], recolor: {} }, both, meshes, true).hidden)
      .toContain("dress-mesh");
    expect(mergeWardrobeCostumeVisibility({ hidden: [], recolor: {} }, bottomOnly, meshes, true).hidden)
      .toContain("dress-mesh");
  });

  it("세트 교체는 현재 전체 슬롯에서 다시 파생해 이전 자동 숨김을 남기지 않는다", () => {
    const full = applyWardrobeSet(WARDROBE_SETS.find((set) => set.id === "school")!);
    const shoesOnly: WardrobeState = { shoes: createWardrobeEquip("heels")! };
    expect(mergeWardrobeCostumeVisibility({ hidden: [], recolor: {} }, full, meshes, true).hidden)
      .toEqual(expect.arrayContaining(["shirt-mesh", "coat-mesh", "pants-mesh", "shoes-mesh"]));
    expect(mergeWardrobeCostumeVisibility({ hidden: [], recolor: {} }, shoesOnly, meshes, true).hidden)
      .toEqual(["shoes-mesh"]);
  });
});

describe("파츠 빌더", () => {
  const collectDims = (part: GarmentPart): number[] => {
    switch (part.shape.kind) {
      case "cylinder":
        return [part.shape.rTop, part.shape.rBottom, part.shape.h];
      case "lathe": {
        const ys = part.shape.profile.map((point) => point.y);
        return [
          ...part.shape.profile.map((point) => point.radius),
          Math.max(...ys) - Math.min(...ys),
        ];
      }
      case "box":
        return [part.shape.w, part.shape.h, part.shape.d];
      case "sphere":
        return [part.shape.r];
      case "torus":
        return [part.shape.r, part.shape.tube];
    }
  };

  it("모든 아이템이 1개 이상의 파츠를 만들고 치수가 양수·유한하다", () => {
    for (const item of WARDROBE_ITEMS) {
      const parts = buildGarmentParts(item.id, FALLBACK_WARDROBE_METRICS);
      expect(parts.length, item.id).toBeGreaterThan(0);
      for (const part of parts) {
        expect(WARDROBE_BONES).toContain(part.bone);
        for (const dim of collectDims(part)) {
          expect(Number.isFinite(dim), `${item.id} dim`).toBe(true);
          expect(dim, `${item.id} dim`).toBeGreaterThan(0);
        }
        for (const off of part.offset) {
          expect(Number.isFinite(off), `${item.id} offset`).toBe(true);
        }
      }
    }
  });

  it("신발은 좌우 발 본에 대칭으로 파츠를 만든다", () => {
    for (const item of wardrobeItemsBySlot("shoes")) {
      const parts = buildGarmentParts(item.id, FALLBACK_WARDROBE_METRICS);
      const bones = new Set(parts.map((p) => p.bone));
      expect(bones.has("leftFoot") || bones.has("leftLowerLeg"), item.id).toBe(true);
      expect(bones.has("rightFoot") || bones.has("rightLowerLeg"), item.id).toBe(true);
    }
  });

  it("fit 배율은 반경을 키운다", () => {
    const base = buildGarmentParts("blazer", FALLBACK_WARDROBE_METRICS, 1);
    const loose = buildGarmentParts("blazer", FALLBACK_WARDROBE_METRICS, 1.4);
    const baseTorso = base.find((p) => p.bone === "spine" && p.shape.kind === "lathe");
    const looseTorso = loose.find((p) => p.bone === "spine" && p.shape.kind === "lathe");
    if (baseTorso?.shape.kind !== "lathe" || looseTorso?.shape.kind !== "lathe") {
      throw new Error("torso silhouette part missing");
    }
    expect(Math.max(...looseTorso.shape.profile.map((point) => point.radius)))
      .toBeGreaterThan(Math.max(...baseTorso.shape.profile.map((point) => point.radius)));
  });

  it("치수는 체형을 따른다 — 작은 골격이면 파츠도 작아진다", () => {
    const small: WardrobeMetrics = sanitizeWardrobeMetrics({
      ...FALLBACK_WARDROBE_METRICS,
      shoulderW: 0.16,
      hipW: 0.09,
      hipsToSpine: 0.05,
      spineToNeck: 0.16,
    });
    const bigTorso = buildGarmentParts("tshirt", FALLBACK_WARDROBE_METRICS)[0];
    const smallTorso = buildGarmentParts("tshirt", small)[0];
    if (bigTorso.shape.kind !== "lathe" || smallTorso.shape.kind !== "lathe") {
      throw new Error("unexpected torso shape");
    }
    expect(Math.max(...smallTorso.shape.profile.map((point) => point.radius)))
      .toBeLessThan(Math.max(...bigTorso.shape.profile.map((point) => point.radius)));
    const bigYs = bigTorso.shape.profile.map((point) => point.y);
    const smallYs = smallTorso.shape.profile.map((point) => point.y);
    expect(Math.max(...smallYs) - Math.min(...smallYs))
      .toBeLessThan(Math.max(...bigYs) - Math.min(...bigYs));
  });

  it("몸통과 스커트는 직선 원통 대신 곡선 실루엣 프로필을 만든다", () => {
    const blazerTorso = buildGarmentParts("blazer", FALLBACK_WARDROBE_METRICS)
      .find((part) => part.bone === "spine" && part.shape.kind === "lathe");
    const skirt = buildGarmentParts("pleated", FALLBACK_WARDROBE_METRICS)
      .find((part) => part.bone === "hips" && part.shape.kind === "lathe");
    if (blazerTorso?.shape.kind !== "lathe" || skirt?.shape.kind !== "lathe") {
      throw new Error("curved garment profiles missing");
    }

    expect(blazerTorso.shape.profile).toHaveLength(6);
    const torsoRadii = blazerTorso.shape.profile.map((point) => point.radius);
    expect(torsoRadii[2]).toBeLessThan(torsoRadii[0]);
    expect(torsoRadii[2]).toBeLessThan(torsoRadii[4]);
    expect(new Set(torsoRadii.map((radius) => radius.toFixed(6))).size).toBeGreaterThan(3);

    expect(skirt.shape.profile).toHaveLength(5);
    expect(skirt.shape.profile[0]!.radius).toBeGreaterThan(skirt.shape.profile.at(-1)!.radius);
    expect(skirt.shape.profile.every((point, index, points) => (
      index === 0 || point.y > points[index - 1]!.y
    ))).toBe(true);
  });

  it("미지의 아이템은 빈 배열을 준다", () => {
    expect(buildGarmentParts("no-such-item", FALLBACK_WARDROBE_METRICS)).toEqual([]);
  });
});

describe("실측 몸통 재단", () => {
  // 합성 실측 몸 — 골반이 넓고, 허리가 잘록하고, 가슴은 넓으면서 얕다.
  // 어깨 폭 배수로 재단하면 절대 만들 수 없는 조합이라 "원통이 사라졌는가"를 이 몸으로 판정한다.
  const HIP_T = 0.05;
  const WAIST_T = 0.35;
  const CHEST_T = 0.7;
  const BODY_RINGS: readonly BodySilhouetteRing[] = [
    { t: HIP_T, halfWidth: 0.15, halfDepth: 0.115, centerX: 0, centerZ: 0 },
    { t: 0.2, halfWidth: 0.14, halfDepth: 0.108, centerX: 0, centerZ: 0 },
    { t: WAIST_T, halfWidth: 0.108, halfDepth: 0.1, centerX: 0, centerZ: 0 },
    { t: 0.5, halfWidth: 0.12, halfDepth: 0.098, centerX: 0, centerZ: 0 },
    { t: CHEST_T, halfWidth: 0.165, halfDepth: 0.098, centerX: 0, centerZ: 0 },
    { t: 0.85, halfWidth: 0.158, halfDepth: 0.096, centerX: 0, centerZ: 0 },
    { t: 0.95, halfWidth: 0.12, halfDepth: 0.09, centerX: 0, centerZ: 0 },
  ];

  const silhouette = (rings: readonly BodySilhouetteRing[] = BODY_RINGS): BodySilhouette => ({
    version: STUDIO_VRM_BODY_SILHOUETTE_VERSION,
    source: "measured",
    rings,
    sampleCount: 4200,
    measuredRingCount: rings.length,
  });

  const measured = (rings: readonly BodySilhouetteRing[] = BODY_RINGS): WardrobeMetrics =>
    sanitizeWardrobeMetrics({ ...FALLBACK_WARDROBE_METRICS, torso: silhouette(rings) });

  /** 아이템이 스스로 신고한 여유분. 테스트가 상수를 새로 지어내지 않게 카탈로그에서 읽는다. */
  const clearanceBand = (itemId: string): { min: number; max: number } => {
    const item = wardrobeItemById(itemId);
    if (!item) throw new Error(`unknown item ${itemId}`);
    const { baseBodyClearanceM, motionAllowanceM, layerClearanceM } = item.fitProfile;
    // 최소: 아이템이 약속한 몸 여유. 최대: 세 여유를 다 더한 값 + 품 배율 여유(≤1.25).
    return { min: baseBodyClearanceM, max: (baseBodyClearanceM + motionAllowanceM + layerClearanceM) * 1.25 };
  };

  const torsoShellOf = (parts: readonly GarmentPart[]) => {
    const shell = parts.find((part) => part.bone === "spine" && part.shape.kind === "lathe");
    if (shell?.shape.kind !== "lathe") throw new Error("torso shell missing");
    return { shell, profile: shell.shape.profile };
  };

  /** 파츠 로컬 y → 실측 링. up이 +Y인 폴백 골격을 쓰므로 offset[1]이 그대로 셸 중심 높이다. */
  const ringAtProfileY = (
    m: WardrobeMetrics,
    shell: GarmentPart,
    y: number,
  ): BodySilhouetteRing => {
    const spineY = y + shell.offset[1];
    const t = (spineY + m.hipsToSpine) / (m.hipsToSpine + m.spineToNeck);
    return sampleBodySilhouette(silhouette(), t);
  };

  const nearestPointToT = (
    m: WardrobeMetrics,
    shell: GarmentPart,
    profile: readonly { radius: number; y: number; depth?: number }[],
    t: number,
  ) => {
    const span = m.hipsToSpine + m.spineToNeck;
    const targetY = t * span - m.hipsToSpine - shell.offset[1];
    return profile.reduce((best, point) => (
      Math.abs(point.y - targetY) < Math.abs(best.y - targetY) ? point : best
    ));
  };

  it("티셔츠 몸통은 어깨 폭 배수가 아니라 실측 링 위에 아이템 여유분만 얹는다", () => {
    const m = measured();
    const { shell, profile } = torsoShellOf(buildGarmentParts("tshirt", m, 1));
    const band = clearanceBand("tshirt");

    // 5점 프로파일로는 허리와 가슴이 한 링에 뭉친다 — 링이 충분히 많아야 둘이 분리된다.
    expect(profile.length).toBeGreaterThanOrEqual(12);
    for (const point of profile) {
      const ring = ringAtProfileY(m, shell, point.y);
      const gap = point.radius - ring.halfWidth;
      expect(gap, `radius@${point.y}`).toBeGreaterThanOrEqual(band.min);
      expect(gap, `radius@${point.y}`).toBeLessThanOrEqual(band.max);
      // 앞뒤 반지름도 같은 띠 안에 있어야 링마다 다른 타원이 실제로 몸을 감싼다.
      const depthGap = point.radius * (point.depth ?? 1) - ring.halfDepth;
      expect(depthGap, `depth@${point.y}`).toBeGreaterThanOrEqual(band.min);
      expect(depthGap, `depth@${point.y}`).toBeLessThanOrEqual(band.max);
    }
  });

  it("겉옷도 같은 규칙으로 재단된다 — 여유분만 아이템에 따라 커진다", () => {
    const m = measured();
    const coat = torsoShellOf(buildGarmentParts("coat", m, 1));
    const tshirt = torsoShellOf(buildGarmentParts("tshirt", m, 1));
    const band = clearanceBand("coat");

    for (const point of coat.profile) {
      const ring = ringAtProfileY(m, coat.shell, point.y);
      const gap = point.radius - ring.halfWidth;
      expect(gap).toBeGreaterThanOrEqual(band.min);
      expect(gap).toBeLessThanOrEqual(band.max);
    }
    expect(Math.max(...coat.profile.map((point) => point.radius)))
      .toBeGreaterThan(Math.max(...tshirt.profile.map((point) => point.radius)));
  });

  it("허리는 가슴보다 좁고 두 링의 깊이비가 다르다 — 원통이 사라졌다", () => {
    const m = measured();
    const { shell, profile } = torsoShellOf(buildGarmentParts("tshirt", m, 1));
    const waist = nearestPointToT(m, shell, profile, WAIST_T);
    const chest = nearestPointToT(m, shell, profile, CHEST_T);

    expect(waist.radius).toBeLessThan(chest.radius * 0.85);
    // 하나의 squash로는 표현할 수 없는 차이 — 가슴은 넓고 얕게, 허리는 좁고 둥글게 남는다.
    expect(chest.depth).toBeLessThan(0.75);
    expect(waist.depth).toBeGreaterThan((chest.depth ?? 1) + 0.1);
    expect(shell.squash).toBeUndefined();
  });

  it("fit을 최소로 줄여도 셸은 실측 표면 바깥에 남는다 — 줄어드는 것은 여유분뿐", () => {
    const m = measured();
    for (const itemId of ["tshirt", "hoodie", "coat", "dress"]) {
      const tight = torsoShellOf(buildGarmentParts(itemId, m, WARDROBE_FIT_MIN));
      const loose = torsoShellOf(buildGarmentParts(itemId, m, WARDROBE_FIT_MAX));
      for (const point of tight.profile) {
        const ring = ringAtProfileY(m, tight.shell, point.y);
        expect(point.radius, `${itemId} radius@${point.y}`).toBeGreaterThan(ring.halfWidth);
        expect(point.radius * (point.depth ?? 1), `${itemId} depth@${point.y}`).toBeGreaterThan(ring.halfDepth);
      }
      expect(Math.max(...tight.profile.map((point) => point.radius)), itemId)
        .toBeLessThan(Math.max(...loose.profile.map((point) => point.radius)));
    }
  });

  it("실측 몸이 굵어지면 셸도 굵어진다 — fit이 아니라 몸이 치수를 정한다", () => {
    const wider = BODY_RINGS.map((ring) => ({ ...ring, halfWidth: ring.halfWidth * 1.3 }));
    const slim = torsoShellOf(buildGarmentParts("tshirt", measured(), 1));
    const broad = torsoShellOf(buildGarmentParts("tshirt", measured(wider), 1));
    expect(Math.max(...broad.profile.map((point) => point.radius)))
      .toBeGreaterThan(Math.max(...slim.profile.map((point) => point.radius)) * 1.2);
  });

  it("어깨 브리지가 몸통 셸에서 양쪽 어깨 관절까지 이어지고 소매는 진동 안으로 들어간다", () => {
  const m = measured();
  const parts = buildGarmentParts("tshirt", m, 1);
  const bridges = parts.filter((part) => (
    part.bone === "spine" && part.shape.kind === "lathe" && part.align && Math.abs(part.align[0]) > 0.9
  ));
  const leftBridge = bridges.find((part) => (part.align?.[0] ?? 0) > 0);
  const sleeve = parts.find((part) => part.bone === "leftUpperArm");
  if (leftBridge?.shape.kind !== "lathe" || sleeve?.shape.kind !== "cylinder" || !leftBridge.align) {
    throw new Error("shoulder bridge or sleeve missing");
  }

  expect(bridges).toHaveLength(2);
  const bridgeYs = leftBridge.shape.profile.map((point) => point.y);
  const outerEdge = leftBridge.offset[0] + Math.max(...bridgeYs);
  expect(outerEdge).toBeGreaterThanOrEqual(m.shoulderW * 0.5);
  expect(Math.max(...leftBridge.shape.profile.map((point) => point.radius))).toBeGreaterThanOrEqual(sleeve.shape.rTop);
  expect(leftBridge.squash?.[2]).toBeLessThan(1);

  const measuredStart = sleeve.offset[0] - sleeve.shape.h / 2;
  const measuredEnd = sleeve.offset[0] + sleeve.shape.h / 2;
  const fallback = buildGarmentParts("tshirt", FALLBACK_WARDROBE_METRICS, 1)
    .find((part) => part.bone === "leftUpperArm");
  if (fallback?.shape.kind !== "cylinder") throw new Error("fallback sleeve missing");
  expect(measuredStart).toBeLessThan(0);
  expect(fallback.offset[0] - fallback.shape.h / 2).toBeCloseTo(0, 10);
  expect(measuredEnd).toBeCloseTo(fallback.offset[0] + fallback.shape.h / 2, 10);
});

it("양쪽 어깨 브리지의 전체 폭은 실측 어깨에서 나온다", () => {
  const wider = BODY_RINGS.map((ring) => ({ ...ring, halfWidth: ring.halfWidth * 1.4 }));
  const spanOf = (m: WardrobeMetrics): number => {
    const bridges = buildGarmentParts("tshirt", m, 1).filter((part) => (
      part.bone === "spine" && part.shape.kind === "lathe" && part.align && Math.abs(part.align[0]) > 0.9
    ));
    if (bridges.length !== 2) throw new Error("shoulder bridges missing");
    const xs: number[] = [];
    for (const bridge of bridges) {
      if (bridge.shape.kind !== "lathe" || !bridge.align) throw new Error("invalid shoulder bridge");
      for (const point of bridge.shape.profile) xs.push(bridge.offset[0] + bridge.align[0] * point.y);
    }
    return Math.max(...xs) - Math.min(...xs);
  };
  expect(spanOf(measured(wider))).toBeGreaterThan(spanOf(measured()));
});

  it("스커트 허리는 실측 골반 링에서 나오고 밑단은 그대로 완만하다", () => {
    const m = measured();
    const skirt = buildGarmentParts("pleated", m, 1)
      .find((part) => part.bone === "hips" && part.shape.kind === "lathe");
    if (skirt?.shape.kind !== "lathe") throw new Error("skirt cone missing");
    const profile = skirt.shape.profile;
    const rTop = profile[profile.length - 1]!.radius;
    const band = clearanceBand("pleated");
    const hip = BODY_RINGS.find((ring) => ring.t === HIP_T)!;

    expect(rTop - hip.halfWidth).toBeGreaterThanOrEqual(band.min);
    expect(rTop - hip.halfWidth).toBeLessThanOrEqual(band.max);
    // 골격 폴백은 골반 "관절 거리"를 썼기 때문에 살보다 좁았다.
    expect(rTop).toBeGreaterThan(Math.max(m.hipW * 0.95, m.shoulderW * 0.42));
    expect(profile).toHaveLength(5);
    expect(profile[0]!.radius).toBeGreaterThan(rTop);
    expect(profile.every((point, index, points) => index === 0 || point.y > points[index - 1]!.y)).toBe(true);
  });

  it("실측 골반이 넓어지면 스커트 허리도 넓어진다", () => {
    const rTopOf = (m: WardrobeMetrics): number => {
      const skirt = buildGarmentParts("longskirt", m, 1)
        .find((part) => part.bone === "hips" && part.shape.kind === "lathe");
      if (skirt?.shape.kind !== "lathe") throw new Error("skirt cone missing");
      return skirt.shape.profile[skirt.shape.profile.length - 1]!.radius;
    };
    const wider = BODY_RINGS.map((ring) => ({ ...ring, halfWidth: ring.halfWidth * 1.25 }));
    expect(rTopOf(measured(wider))).toBeGreaterThan(rTopOf(measured()));
  });

  it("같은 몸이면 같은 파츠를 준다(결정론)", () => {
    const m = measured();
    for (const itemId of ["tshirt", "coat", "pleated"]) {
      expect(buildGarmentParts(itemId, m, 1)).toEqual(buildGarmentParts(itemId, m, 1));
    }
  });
});

describe("실측이 없을 때의 골격 폴백", () => {
  const fmt = (value: number): string => value.toFixed(6);
  const vec = (values: readonly number[] | undefined): string => (values ? values.map(fmt).join(",") : "-");
  const shapeFingerprint = (shape: GarmentShape): string => {
    switch (shape.kind) {
      case "cylinder":
        return `cylinder(${fmt(shape.rTop)},${fmt(shape.rBottom)},${fmt(shape.h)},${shape.open ?? false})`;
      case "lathe":
        return `lathe(${shape.segments ?? "-"};${shape.profile
          .map((point) => `${fmt(point.radius)}@${fmt(point.y)}${point.depth === undefined ? "" : `*${fmt(point.depth)}`}`)
          .join(" ")})`;
      case "box":
        return `box(${fmt(shape.w)},${fmt(shape.h)},${fmt(shape.d)})`;
      case "sphere":
        return `sphere(${fmt(shape.r)})`;
      case "torus":
        return `torus(${fmt(shape.r)},${fmt(shape.tube)},${shape.arc === undefined ? "-" : fmt(shape.arc)})`;
    }
  };
  const fingerprint = (part: GarmentPart): string => [
    part.bone,
    part.skinMode ?? "-",
    shapeFingerprint(part.shape),
    `off(${vec(part.offset)})`,
    `align(${vec(part.align)})`,
    `squash(${vec(part.squash)})`,
    part.color ?? "-",
    part.roughness === undefined ? "-" : fmt(part.roughness),
    part.metalness === undefined ? "-" : fmt(part.metalness),
  ].join(" ");

  const fallbackParts = (itemId: string): string[] =>
    buildGarmentParts(itemId, FALLBACK_WARDROBE_METRICS, 1).map(fingerprint);

  it("측정이 없으면 실루엣이 생기기 전 파츠를 그대로 만든다", () => {
    // 이 스냅샷은 실측 재단이 들어오기 전 출력이다. 실측 없는 캐릭터에서 옷이 바뀌면
    // 그건 개선이 아니라 회귀다 — 정직 규칙(측정 실패 시 골격 폴백 무변경).
    expect({
      tshirt: fallbackParts("tshirt"),
      hoodie: fallbackParts("hoodie"),
      coat: fallbackParts("coat"),
      pleated: fallbackParts("pleated"),
    }).toMatchInlineSnapshot(`
      {
        "coat": [
          "spine - lathe(32;0.188190@-0.255200 0.192031@-0.193952 0.165146@-0.030624 0.192031@0.122496 0.204288@0.204160 0.159345@0.255200) off(0.000000,0.039200,0.000000) align(0.000000,1.000000,0.000000) squash(1.000000,1.000000,0.850000) - 0.780000 -",
          "hips lower-body-drape lathe(32;0.247289@-0.148750 0.239870@-0.124950 0.222110@-0.023800 0.191087@0.119000 0.187340@0.148750) off(0.000000,-0.099250,0.000000) align(0.000000,1.000000,0.000000) squash(1.000000,1.000000,0.880000) - - -",
          "leftUpperArm - cylinder(0.056012,0.056012,0.224400,true) off(0.112200,0.000000,0.000000) align(1.000000,0.000000,0.000000) squash(-) - 0.780000 -",
          "leftLowerArm - cylinder(0.050996,0.050996,0.211200,true) off(0.105600,0.000000,0.000000) align(1.000000,0.000000,0.000000) squash(-) - 0.780000 -",
          "rightUpperArm - cylinder(0.056012,0.056012,0.224400,true) off(-0.112200,0.000000,0.000000) align(-1.000000,0.000000,0.000000) squash(-) - 0.780000 -",
          "rightLowerArm - cylinder(0.050996,0.050996,0.211200,true) off(-0.105600,0.000000,0.000000) align(-1.000000,0.000000,0.000000) squash(-) - 0.780000 -",
          "spine - torus(0.099200,0.019200,-) off(0.000000,0.288000,0.000000) align(0.000000,1.000000,0.000000) squash(1.000000,1.000000,0.740000) - 0.780000 -",
        ],
        "hoodie": [
          "spine - lathe(32;0.210739@-0.255200 0.215040@-0.193952 0.184934@-0.030624 0.202138@0.122496 0.215040@0.204160 0.167731@0.255200) off(0.000000,0.039200,0.000000) align(0.000000,1.000000,0.000000) squash(1.000000,1.000000,0.850000) - 0.850000 -",
          "leftUpperArm - cylinder(0.059356,0.059356,0.224400,true) off(0.112200,0.000000,0.000000) align(1.000000,0.000000,0.000000) squash(-) - 0.850000 -",
          "leftLowerArm - cylinder(0.054340,0.054340,0.211200,true) off(0.105600,0.000000,0.000000) align(1.000000,0.000000,0.000000) squash(-) - 0.850000 -",
          "rightUpperArm - cylinder(0.059356,0.059356,0.224400,true) off(-0.112200,0.000000,0.000000) align(-1.000000,0.000000,0.000000) squash(-) - 0.850000 -",
          "rightLowerArm - cylinder(0.054340,0.054340,0.211200,true) off(-0.105600,0.000000,0.000000) align(-1.000000,0.000000,0.000000) squash(-) - 0.850000 -",
          "spine - sphere(0.108800) off(0.000000,0.262400,-0.096000) align(-) squash(0.900000,0.820000,0.720000) - 0.850000 -",
        ],
        "pleated": [
          "hips lower-body-drape lathe(32;0.274550@-0.101500 0.266313@-0.085260 0.227069@-0.016240 0.164730@0.081200 0.161500@0.101500) off(0.000000,-0.052000,0.000000) align(0.000000,1.000000,0.000000) squash(1.000000,1.000000,0.880000) - - -",
          "hips - torus(0.161500,0.012000,-) off(0.000000,0.049500,0.000000) align(0.000000,1.000000,0.000000) squash(1.000000,1.000000,0.780000) - 0.700000 -",
        ],
        "tshirt": [
          "spine - lathe(32;0.171682@-0.255200 0.175186@-0.193952 0.150660@-0.030624 0.175186@0.122496 0.186368@0.204160 0.145367@0.255200) off(0.000000,0.039200,0.000000) align(0.000000,1.000000,0.000000) squash(1.000000,1.000000,0.850000) - 0.820000 -",
          "leftUpperArm - cylinder(0.052668,0.052668,0.092400,true) off(0.046200,0.000000,0.000000) align(1.000000,0.000000,0.000000) squash(-) - 0.820000 -",
          "rightUpperArm - cylinder(0.052668,0.052668,0.092400,true) off(-0.046200,0.000000,0.000000) align(-1.000000,0.000000,0.000000) squash(-) - 0.820000 -",
          "spine - torus(0.073600,0.012000,-) off(0.000000,0.291200,0.000000) align(0.000000,1.000000,0.000000) squash(1.000000,1.000000,0.740000) - 0.860000 -",
          "hips - torus(0.170000,0.011000,-) off(0.000000,0.045000,0.000000) align(0.000000,1.000000,0.000000) squash(1.000000,1.000000,0.840000) - 0.860000 -",
          "spine - box(0.051200,0.051200,0.012000) off(0.048000,0.121600,0.172800) align(-) squash(-) - 0.860000 -",
        ],
      }
    `);
  });

  it("폴백 파츠에는 링별 깊이도, 어깨 요크도, 진동에 파고든 소매도 없다", () => {
    for (const item of WARDROBE_ITEMS) {
      const parts = buildGarmentParts(item.id, FALLBACK_WARDROBE_METRICS, 1);
      for (const part of parts) {
        if (part.shape.kind === "lathe") {
          expect(part.shape.profile.every((point) => point.depth === undefined), item.id).toBe(true);
        }
        // 좌우 축으로 누운 spine 실린더는 요크뿐이다.
        const lateral = part.bone === "spine" && part.shape.kind === "cylinder" && part.align?.[0] === 1;
        expect(lateral, item.id).toBe(false);
      }
      for (const part of parts) {
        if (part.bone !== "leftUpperArm" && part.bone !== "rightUpperArm") continue;
        if (part.shape.kind !== "cylinder") continue;
        const axis = part.bone === "leftUpperArm" ? 1 : -1;
        expect(part.offset[0] * axis - part.shape.h / 2, item.id).toBeCloseTo(0, 10);
      }
    }
  });

  it("몸통 셸은 폴백에서 여전히 6점 프로파일과 고정 타원을 쓴다", () => {
    const shell = buildGarmentParts("tshirt", FALLBACK_WARDROBE_METRICS, 1)[0];
    if (shell?.shape.kind !== "lathe") throw new Error("torso shell missing");
    expect(shell.shape.profile).toHaveLength(6);
    expect(shell.squash).toEqual([1, 1, 0.85]);
  });
});

describe("측정값 정규화", () => {
  it("NaN·0·비정상 값은 폴백으로 대체된다", () => {
    const m = sanitizeWardrobeMetrics({
      shoulderW: Number.NaN,
      hipW: 0,
      up: [0, 0, 0],
      upperArm: { left: { len: Number.POSITIVE_INFINITY, axis: [0, 0, 0] }, right: { len: -1, axis: [0, 1, 0] } },
    });
    expect(m.shoulderW).toBe(FALLBACK_WARDROBE_METRICS.shoulderW);
    expect(m.hipW).toBeGreaterThan(0);
    expect(m.up).toEqual(FALLBACK_WARDROBE_METRICS.up);
    expect(Number.isFinite(m.upperArm.left.len)).toBe(true);
    expect(m.upperArm.left.len).toBeGreaterThan(0);
    expect(m.upperArm.right.len).toBeGreaterThan(0);
  });

  it("null 입력은 폴백 전체를 준다", () => {
    expect(sanitizeWardrobeMetrics(null)).toEqual(FALLBACK_WARDROBE_METRICS);
  });

  it("방향 벡터는 단위 벡터로 정규화된다", () => {
    const m = sanitizeWardrobeMetrics({ up: [0, 4, 0] });
    expect(m.up[1]).toBeCloseTo(1);
  });
});

describe("장착 상태 직렬화", () => {
  it("원피스와 하의는 신규 선택에서 상호 배타적으로 장착된다", () => {
    const pants = createWardrobeEquip("pants")!;
    const dress = applyWardrobeItemSelection({ bottom: pants }, "top", "dress");
    expect(dress.top?.itemId).toBe("dress");
    expect(dress.bottom).toBeUndefined();

    const nextPants = applyWardrobeItemSelection(dress, "bottom", "pants");
    expect(nextPants.top).toBeUndefined();
    expect(nextPants.bottom?.itemId).toBe("pants");
    expect(applyWardrobeItemSelection(nextPants, "top", null).bottom).toEqual(nextPants.bottom);
  });

  it("과거 저장·공유 문서의 원피스와 하의 중첩도 복원·직렬화 경계에서 제거한다", () => {
    const dress = createWardrobeEquip("dress")!;
    const pants = createWardrobeEquip("pants")!;
    const conflicting = { top: dress, bottom: pants } satisfies WardrobeState;

    expect(parseWardrobeDocument({
      version: VRM_WARDROBE_VERSION,
      slots: conflicting,
    }).slots).toEqual({ top: dress });
    expect(serializeWardrobe(conflicting)?.slots).toEqual({ top: dress });
  });

  it("정상 상태를 왕복 직렬화한다", () => {
    const state: WardrobeState = {
      outer: { itemId: "blazer", color: "#123456", fit: 1.2, fitMode: "manual", fabricId: "wool" },
      shoes: { itemId: "sneakers", color: "#ffffff", fit: 0.9, fitMode: "auto", fabricId: "jersey" },
    };
    const serialized = serializeWardrobe(state, { autoHideOriginal: false });
    expect(serialized?.version).toBe(VRM_WARDROBE_VERSION);
    expect(serialized?.options.autoHideOriginal).toBe(false);
    const parsed = parseWardrobe(serialized);
    expect(parsed).toEqual(state);
  });

  it("Wave 3 승격 의상 ID는 기존 저장 문서 복원과 렌더 호환을 유지한다", () => {
    const parsed = parseWardrobe({
      version: 1,
      slots: {
        outer: { itemId: "cardigan", color: "#112233", fit: 1.1 },
        top: { itemId: "tshirt", color: "#445566", fit: 1 },
        bottom: { itemId: "pants", color: "#778899", fit: 0.95 },
      },
    });

    expect(parsed).toEqual({
      outer: { itemId: "cardigan", color: "#112233", fit: 1.1, fitMode: "auto", fabricId: "knit" },
      top: { itemId: "tshirt", color: "#445566", fit: 1, fitMode: "auto", fabricId: "jersey" },
      bottom: { itemId: "pants", color: "#778899", fit: 0.95, fitMode: "auto", fabricId: "denim" },
    });
    expect(buildGarmentParts("cardigan", FALLBACK_WARDROBE_METRICS)).not.toEqual(
      [],
    );
    expect(serializeWardrobe(parsed)?.slots).toEqual(parsed);
  });

  it("빈 상태는 undefined로 직렬화된다(문서 하위호환)", () => {
    expect(serializeWardrobe({})).toBeUndefined();
  });

  it("v1 문서는 v2 기본 옵션·핏 방식·직물로 결정론적으로 마이그레이션한다", () => {
    const parsed = parseWardrobeDocument({
      version: 1,
      slots: { top: { itemId: "shirt", color: "#ABCDEF", fit: 1.05 } },
    });
    expect(parsed.sourceVersion).toBe(1);
    expect(parsed.supported).toBe(true);
    expect(parsed.options).toEqual(DEFAULT_WARDROBE_OPTIONS);
    expect(parsed.slots.top).toEqual({
      itemId: "shirt",
      color: "#abcdef",
      fit: 1.05,
      fitMode: "auto",
      fabricId: "cotton",
    });
  });

  it("빈 워드로브라도 auto-hide OFF는 v2 문서로 보존한다", () => {
    const serialized = serializeWardrobe({}, { autoHideOriginal: false });
    expect(serialized).toEqual({
      version: VRM_WARDROBE_VERSION,
      slots: {},
      options: { autoHideOriginal: false },
    });
    expect(parseWardrobeDocument(serialized).options.autoHideOriginal).toBe(false);
  });

  it("알 수 없는 미래 버전은 v1처럼 추측하지 않고 fail-closed 한다", () => {
    const parsed = parseWardrobeDocument({
      version: 999,
      slots: { top: { itemId: "shirt", color: "#ffffff", fit: 1 } },
    });
    expect(parsed.supported).toBe(false);
    expect(parsed.slots).toEqual({});
  });

  it("미지의 아이템·슬롯 불일치 장착은 버린다", () => {
    const parsed = parseWardrobe({
      version: 1,
      slots: {
        outer: { itemId: "no-such", color: "#000000", fit: 1 },
        top: { itemId: "blazer", color: "#000000", fit: 1 }, // blazer는 outer 슬롯
        bottom: { itemId: "pleated", color: "#101010", fit: 1 },
      },
    });
    expect(parsed.outer).toBeUndefined();
    expect(parsed.top).toBeUndefined();
    expect(parsed.bottom?.itemId).toBe("pleated");
  });

  it("fit은 허용 범위로, 색상은 hex로 클램프된다", () => {
    const parsed = parseWardrobe({
      slots: { bottom: { itemId: "pants", color: "red", fit: 99 } },
    });
    expect(parsed.bottom?.fit).toBe(WARDROBE_FIT_MAX);
    expect(parsed.bottom?.color).toBe(wardrobeItemById("pants")?.defaultColor);
    const parsed2 = parseWardrobe({ slots: { bottom: { itemId: "pants", fit: 0.1 } } });
    expect(parsed2.bottom?.fit).toBe(WARDROBE_FIT_MIN);
  });

  it("쓰레기 입력은 빈 상태를 준다", () => {
    expect(parseWardrobe(null)).toEqual({});
    expect(parseWardrobe("junk")).toEqual({});
    expect(parseWardrobe({ slots: "junk" })).toEqual({});
  });

  it("createWardrobeEquip은 카탈로그 기본값을 쓴다", () => {
    const equip = createWardrobeEquip("heels");
    expect(equip).toEqual({
      itemId: "heels",
      color: wardrobeItemById("heels")?.defaultColor,
      fit: 1,
      fitMode: "auto",
      fabricId: "leather",
    });
    expect(createWardrobeEquip("no-such")).toBeNull();
  });
});

describe("테마 세트", () => {
  it("모든 세트가 유효한 아이템만 참조하고 슬롯이 일치한다", () => {
    for (const set of WARDROBE_SETS) {
      const state = applyWardrobeSet(set);
      const equipped = Object.keys(state);
      expect(equipped.length, set.id).toBeGreaterThan(0);
      for (const slot of WARDROBE_SLOTS) {
        const pick = set.equips[slot];
        if (!pick) continue;
        expect(wardrobeItemById(pick.itemId)?.slot, `${set.id}.${slot}`).toBe(slot);
        expect(state[slot]?.itemId).toBe(pick.itemId);
      }
      // 세트 상태는 파서를 그대로 통과해야 한다.
      expect(parseWardrobe({ version: 1, slots: state })).toEqual(state);
    }
  });

  it("세트 id가 고유하다", () => {
    const ids = WARDROBE_SETS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("기존 의상 자동 숨김 매핑", () => {
  it("모든 슬롯에 매핑이 있고 유효한 의상 슬롯만 가리킨다", () => {
    const validCostumeSlots = ["outer", "tops", "bottoms", "onepiece", "shoes", "accessory", "innerwear"];
    for (const slot of WARDROBE_SLOTS) {
      const mapped = WARDROBE_HIDE_COSTUME_SLOTS[slot];
      expect(mapped.length).toBeGreaterThan(0);
      for (const cs of mapped) expect(validCostumeSlots).toContain(cs);
    }
  });
});
