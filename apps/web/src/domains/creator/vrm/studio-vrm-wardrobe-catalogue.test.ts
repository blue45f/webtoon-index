import { describe, expect, it } from "vitest";

import { classifyMeshName, type CostumeState } from "./studio-vrm-costume";
import {
  DEFAULT_WARDROBE_SLOT_OVERRIDE,
  WARDROBE_CATALOGUE_SLOTS,
  WARDROBE_CATALOGUE_VERSION,
  WARDROBE_OUTFITS,
  applyWardrobeSlotPatch,
  createWardrobeCatalogueState,
  createWardrobeVisibilityLedger,
  isDefaultOverride,
  mergeWardrobeCataloguePlan,
  parseWardrobeCatalogueState,
  resolveWardrobeBindings,
  resolveWardrobeCataloguePlan,
  sanitizeWardrobeCatalogueState,
  serializeWardrobeCatalogueState,
  toggleWardrobeSlot,
  wardrobeOutfitById,
  type WardrobeMeshInput,
} from "./studio-vrm-wardrobe-catalogue";

/** 전형적인 VRoid 씬 구성을 흉내낸 입력. */
const SCENE: WardrobeMeshInput[] = [
  { key: "Tops_Shirt", materialNames: ["M_Shirt"], baseColor: "#b0b0b0" },
  { key: "Outer_Blazer", materialNames: ["M_Blazer"], baseColor: "#808080" },
  { key: "Bottoms_Skirt", materialNames: ["M_Skirt"], baseColor: "#606060" },
  { key: "Shoes_Loafer", materialNames: ["M_Loafer"], baseColor: "#404040" },
  { key: "Accessory_Ribbon", materialNames: ["M_Ribbon"], baseColor: "#909090" },
  // 아래 5개는 반드시 탈락해야 한다(보호 카테고리 / 미분류).
  { key: "Face", materialNames: ["N00_000_00_Face_00_SKIN"] },
  { key: "Body_Skin", materialNames: ["N00_000_00_Body_00_SKIN"] },
  { key: "Hair_Back", materialNames: ["N00_000_Hair_00_HAIR"] },
  { key: "EyeIris", materialNames: ["N00_007_00_EyeIris_00_EYE"] },
  { key: "Node_999", materialNames: ["Material.042"] },
];

describe("워드로브 메시 바인딩", () => {
  it("의상 메시만 슬롯에 바인딩하고 보호 카테고리는 전부 탈락시킨다", () => {
    const bindings = resolveWardrobeBindings(SCENE);
    expect(bindings.map((binding) => binding.key)).toEqual([
      "Tops_Shirt", "Outer_Blazer", "Bottoms_Skirt", "Shoes_Loafer", "Accessory_Ribbon",
    ]);
    expect(bindings.map((binding) => binding.slot)).toEqual([
      "tops", "outer", "bottoms", "shoes", "accessory",
    ]);
  });

  it("헤어 리스 집합과 워드로브 집합은 정의상 서로소다", () => {
    // StudioVrmAvatarForge가 잡는 대상 = protected === "hair".
    // 워드로브가 잡는 대상 = slot !== null && protected === null.
    // 같은 이름이 두 집합에 동시에 들어갈 수 없음을 분류 함수 수준에서 확인한다.
    const names = [
      "Hair_Back", "HairFront", "N00_000_Hair_00_HAIR", "Tops_Shirt", "Outer_Coat",
      "Shoes_Boots", "Accessory_Ribbon", "Face_Hair_Combined", "Body_Skin",
    ];
    for (const name of names) {
      const classification = classifyMeshName(name);
      const hairLease = classification.protected === "hair";
      const wardrobe = classification.slot !== null && classification.protected === null;
      expect(hairLease && wardrobe).toBe(false);
    }

    const bindings = resolveWardrobeBindings(names.map((key) => ({ key })));
    expect(bindings.some((binding) => binding.key.toLowerCase().includes("hair"))).toBe(false);
  });

  it("빈 키·중복 키를 걸러내고 잘못된 baseColor는 중립 회색으로 대체한다", () => {
    const bindings = resolveWardrobeBindings([
      { key: "Tops_Shirt", baseColor: "not-a-color" },
      { key: "Tops_Shirt", baseColor: "#111111" },
      { key: "", baseColor: "#222222" },
      { key: "Outer_Coat" },
    ]);
    expect(bindings).toHaveLength(2);
    expect(bindings[0]).toEqual({ key: "Tops_Shirt", slot: "tops", baseColor: "#808080" });
    expect(bindings[1].baseColor).toBe("#808080");
  });

  it("nodeName과 materialNames를 함께 보고 분류한다", () => {
    const bindings = resolveWardrobeBindings([
      { key: "mesh-0", nodeName: "Node_001", materialNames: ["M_Uniform_Top"] },
    ]);
    expect(bindings).toEqual([{ key: "mesh-0", slot: "tops", baseColor: "#808080" }]);
  });
});

describe("슬롯 표시/숨김", () => {
  it("기본 상태는 모든 슬롯이 보이고 계획이 비어 있다", () => {
    const state = createWardrobeCatalogueState();
    const plan = resolveWardrobeCataloguePlan(resolveWardrobeBindings(SCENE), state);
    expect(plan.hidden).toEqual([]);
    expect(plan.recolor).toEqual({});
    expect(plan.material).toEqual({});
    expect(plan.bySlot.tops).toEqual(["Tops_Shirt"]);
    expect(plan.bySlot.innerwear).toEqual([]);
  });

  it("슬롯을 숨기면 그 슬롯 메시만 hidden에 들어간다", () => {
    const state = applyWardrobeSlotPatch(createWardrobeCatalogueState(), "outer", { visible: false });
    const plan = resolveWardrobeCataloguePlan(resolveWardrobeBindings(SCENE), state);
    expect(plan.hidden).toEqual(["Outer_Blazer"]);
    expect(plan.bySlot.outer).toEqual(["Outer_Blazer"]);
  });

  it("토글은 왕복하고 계획도 원상복구된다", () => {
    const base = createWardrobeCatalogueState();
    const hidden = toggleWardrobeSlot(base, "shoes");
    const shown = toggleWardrobeSlot(hidden, "shoes");

    expect(hidden.slots.shoes.visible).toBe(false);
    expect(shown.slots.shoes.visible).toBe(true);
    const bindings = resolveWardrobeBindings(SCENE);
    expect(resolveWardrobeCataloguePlan(bindings, hidden).hidden).toEqual(["Shoes_Loafer"]);
    expect(resolveWardrobeCataloguePlan(bindings, shown).hidden).toEqual([]);
  });

  it("여러 슬롯을 숨기면 hidden이 정렬된 결정론적 배열로 나온다", () => {
    let state = createWardrobeCatalogueState();
    for (const slot of ["shoes", "accessory", "outer"] as const) {
      state = applyWardrobeSlotPatch(state, slot, { visible: false });
    }
    const plan = resolveWardrobeCataloguePlan(resolveWardrobeBindings(SCENE), state);
    expect(plan.hidden).toEqual(["Accessory_Ribbon", "Outer_Blazer", "Shoes_Loafer"]);
    // 같은 입력 → 같은 출력.
    expect(resolveWardrobeCataloguePlan(resolveWardrobeBindings(SCENE), state)).toEqual(plan);
  });

  it("숨긴 슬롯에는 색·머티리얼 계산을 하지 않는다", () => {
    const state = applyWardrobeSlotPatch(createWardrobeCatalogueState(), "tops", {
      visible: false,
      color: "#ff0000",
      roughness: 0.2,
    });
    const plan = resolveWardrobeCataloguePlan(resolveWardrobeBindings(SCENE), state);
    expect(plan.hidden).toEqual(["Tops_Shirt"]);
    expect(plan.recolor["Tops_Shirt"]).toBeUndefined();
    expect(plan.material["Tops_Shirt"]).toBeUndefined();
  });

  it("상태 갱신은 불변이다(원본 객체를 변형하지 않는다)", () => {
    const base = createWardrobeCatalogueState();
    const snapshot = JSON.stringify(base);
    applyWardrobeSlotPatch(base, "tops", { visible: false, color: "#123456" });
    toggleWardrobeSlot(base, "shoes");
    expect(JSON.stringify(base)).toBe(snapshot);
  });
});

describe("슬롯 색·머티리얼 오버라이드 훅", () => {
  it("색 오버라이드는 원본 음영을 보존한 틴트로 나온다", () => {
    const state = applyWardrobeSlotPatch(createWardrobeCatalogueState(), "tops", { color: "#2b3a5e" });
    const bindings = resolveWardrobeBindings([
      { key: "Tops_Dark", nodeName: "Tops_Shirt", baseColor: "#303030" },
      { key: "Tops_Light", nodeName: "Tops_Shirt", baseColor: "#b0b0b0" },
    ]);
    const plan = resolveWardrobeCataloguePlan(bindings, state);

    expect(plan.recolor["Tops_Dark"]).toMatch(/^#[0-9a-f]{6}$/);
    expect(plan.recolor["Tops_Light"]).toMatch(/^#[0-9a-f]{6}$/);
    // 어두운 원본은 여전히 더 어둡다 → 주름/그림자 보존.
    const luminance = (hex: string) => parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5, 7), 16);
    expect(luminance(plan.recolor["Tops_Light"])).toBeGreaterThan(luminance(plan.recolor["Tops_Dark"]));
  });

  it("tintStrength가 0이면 색조만 옮기고 원본 명도를 거의 유지한다", () => {
    const bindings = resolveWardrobeBindings([{ key: "Tops_Shirt", baseColor: "#303030" }]);
    const weak = resolveWardrobeCataloguePlan(
      bindings,
      applyWardrobeSlotPatch(createWardrobeCatalogueState(), "tops", { color: "#ff0000", tintStrength: 0 })
    );
    const strong = resolveWardrobeCataloguePlan(
      bindings,
      applyWardrobeSlotPatch(createWardrobeCatalogueState(), "tops", { color: "#ff0000", tintStrength: 1 })
    );
    expect(weak.recolor["Tops_Shirt"]).not.toBe(strong.recolor["Tops_Shirt"]);
  });

  it("roughness/metalness 훅은 지정한 슬롯에만 실린다", () => {
    const state = applyWardrobeSlotPatch(createWardrobeCatalogueState(), "shoes", {
      roughness: 0.25,
      metalness: 0.6,
    });
    const plan = resolveWardrobeCataloguePlan(resolveWardrobeBindings(SCENE), state);
    expect(plan.material).toEqual({ Shoes_Loafer: { roughness: 0.25, metalness: 0.6 } });
    // 색을 안 줬으므로 recolor는 비어 있다(원본 텍스처 유지).
    expect(plan.recolor).toEqual({});
  });

  it("머티리얼 값은 0~1로 잘리고 쓰레기 값은 null(=원본 유지)이 된다", () => {
    const state = sanitizeWardrobeCatalogueState({
      version: WARDROBE_CATALOGUE_VERSION,
      slots: {
        shoes: { roughness: 42, metalness: -5, tintStrength: 9 },
        tops: { roughness: "shiny", metalness: null },
      },
    });
    expect(state.slots.shoes.roughness).toBe(1);
    expect(state.slots.shoes.metalness).toBe(0);
    expect(state.slots.shoes.tintStrength).toBe(1);
    expect(state.slots.tops.roughness).toBeNull();
    expect(state.slots.tops.metalness).toBeNull();
  });
});

describe("코디 세트 카탈로그", () => {
  it("세트가 8종 이상이고 id·색이 모두 유효하다", () => {
    expect(WARDROBE_OUTFITS.length).toBeGreaterThanOrEqual(8);
    expect(new Set(WARDROBE_OUTFITS.map((outfit) => outfit.id)).size).toBe(WARDROBE_OUTFITS.length);
    for (const outfit of WARDROBE_OUTFITS) {
      expect(outfit.label.length).toBeGreaterThan(0);
      expect(outfit.hint.length).toBeGreaterThan(0);
      for (const [slot, patch] of Object.entries(outfit.slots)) {
        expect(WARDROBE_CATALOGUE_SLOTS).toContain(slot);
        if (patch?.color) expect(patch.color).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });

  it("세트를 적용하면 슬롯 오버라이드가 실리고 outfitId가 기록된다", () => {
    const state = createWardrobeCatalogueState("office-mono");
    expect(state.outfitId).toBe("office-mono");
    expect(state.slots.accessory.visible).toBe(false);
    expect(state.slots.bottoms.color).toBe("#1c1c22");
    expect(state.slots.innerwear).toEqual(DEFAULT_WARDROBE_SLOT_OVERRIDE);

    const plan = resolveWardrobeCataloguePlan(resolveWardrobeBindings(SCENE), state);
    expect(plan.hidden).toEqual(["Accessory_Ribbon"]);
    expect(Object.keys(plan.recolor).sort()).toEqual(["Bottoms_Skirt", "Outer_Blazer", "Shoes_Loafer", "Tops_Shirt"]);
    expect(plan.material["Shoes_Loafer"]).toEqual({ roughness: 0.28, metalness: null });
  });

  it("원본 그대로 세트는 아무 계획도 만들지 않는다", () => {
    const plan = resolveWardrobeCataloguePlan(
      resolveWardrobeBindings(SCENE),
      createWardrobeCatalogueState("as-authored")
    );
    expect(plan.hidden).toEqual([]);
    expect(plan.recolor).toEqual({});
    expect(plan.material).toEqual({});
  });

  it("슬롯을 직접 편집하면 outfitId가 해제된다", () => {
    const edited = applyWardrobeSlotPatch(createWardrobeCatalogueState("school-navy"), "tops", { color: "#ff00ff" });
    expect(edited.outfitId).toBeNull();
    expect(edited.slots.tops.color).toBe("#ff00ff");
    // 편집하지 않은 슬롯은 세트 값을 유지한다.
    expect(edited.slots.bottoms.color).toBe("#1e293b");
  });

  it("모르는 세트 id는 기본 상태로 떨어진다", () => {
    const state = createWardrobeCatalogueState("does-not-exist");
    expect(state.outfitId).toBeNull();
    expect(wardrobeOutfitById("does-not-exist")).toBeUndefined();
    for (const slot of WARDROBE_CATALOGUE_SLOTS) expect(isDefaultOverride(state.slots[slot])).toBe(true);
  });
});

describe("직렬화", () => {
  it("기본 상태는 문서에 키를 남기지 않는다", () => {
    expect(serializeWardrobeCatalogueState(createWardrobeCatalogueState())).toBeUndefined();
  });

  it("라운드트립에서 모든 값이 보존된다", () => {
    let state = createWardrobeCatalogueState("knight-steel");
    state = applyWardrobeSlotPatch(state, "innerwear", { visible: false, color: "#ABCDEF", tintStrength: 0.4 });
    const serialized = serializeWardrobeCatalogueState(state);
    expect(serialized).toBeDefined();

    const restored = parseWardrobeCatalogueState(JSON.stringify(serialized));
    expect(restored).toEqual(state);
    expect(restored.slots.innerwear.color).toBe("#abcdef");
    expect(restored.slots.outer.metalness).toBe(0.75);
  });

  it("손상된 JSON·잘못된 타입은 안전한 기본 상태가 된다", () => {
    for (const input of ["{broken", null, 42, [], "null", undefined]) {
      const state = parseWardrobeCatalogueState(input);
      expect(state.version).toBe(WARDROBE_CATALOGUE_VERSION);
      expect(state.outfitId).toBeNull();
      for (const slot of WARDROBE_CATALOGUE_SLOTS) expect(isDefaultOverride(state.slots[slot])).toBe(true);
    }
  });

  it("미지의 슬롯·필드는 버리고 알려진 슬롯만 남긴다", () => {
    const state = sanitizeWardrobeCatalogueState({
      version: 999,
      outfitId: "school-navy",
      nonsense: "dropped",
      slots: {
        tops: { visible: false, color: "#123456", injected: "<script>" },
        cape: { visible: false },
        __proto__: { visible: false },
      },
    });

    expect(state.version).toBe(WARDROBE_CATALOGUE_VERSION);
    expect(Object.keys(state.slots).sort()).toEqual([...WARDROBE_CATALOGUE_SLOTS].sort());
    expect(state.slots.tops.visible).toBe(false);
    expect(state.slots.tops.color).toBe("#123456");
    expect("injected" in state.slots.tops).toBe(false);
    expect("nonsense" in state).toBe(false);
    expect("cape" in state.slots).toBe(false);
    // 알려지지 않은 outfitId는 버려지지만, 유효한 id는 유지된다.
    expect(state.outfitId).toBe("school-navy");
    expect(sanitizeWardrobeCatalogueState({ outfitId: "☠" }).outfitId).toBeNull();
  });

  it("잘못된 색은 '원본 유지'(null)로 떨어지고 XSS 문자열이 살아남지 않는다", () => {
    const state = sanitizeWardrobeCatalogueState({
      slots: {
        tops: { color: "javascript:alert(1)" },
        outer: { color: "#GGGGGG" },
        shoes: { color: "#AABBCC" },
      },
    });
    expect(state.slots.tops.color).toBeNull();
    expect(state.slots.outer.color).toBeNull();
    expect(state.slots.shoes.color).toBe("#aabbcc");
  });

  it("visible은 명시적 false일 때만 숨긴다", () => {
    const state = sanitizeWardrobeCatalogueState({
      slots: { tops: { visible: false }, outer: { visible: "false" }, shoes: {} },
    });
    expect(state.slots.tops.visible).toBe(false);
    expect(state.slots.outer.visible).toBe(true);
    expect(state.slots.shoes.visible).toBe(true);
  });
});

describe("기존 CostumeState와의 합성", () => {
  it("사용자가 수동으로 숨긴 항목을 지우지 않는다", () => {
    const costume: CostumeState = { hidden: ["Custom_Cape"], recolor: { Custom_Cape: "#111111" } };
    const plan = resolveWardrobeCataloguePlan(
      resolveWardrobeBindings(SCENE),
      applyWardrobeSlotPatch(createWardrobeCatalogueState(), "outer", { visible: false })
    );
    const merged = mergeWardrobeCataloguePlan(costume, plan);
    expect(merged.hidden).toEqual(["Custom_Cape", "Outer_Blazer"]);
    expect(merged.recolor["Custom_Cape"]).toBe("#111111");
  });

  it("겹치는 키는 워드로브가 이기고 중복 없이 정렬된다", () => {
    const costume: CostumeState = { hidden: ["Outer_Blazer"], recolor: { Tops_Shirt: "#000000" } };
    const plan = resolveWardrobeCataloguePlan(
      resolveWardrobeBindings(SCENE),
      applyWardrobeSlotPatch(
        applyWardrobeSlotPatch(createWardrobeCatalogueState(), "outer", { visible: false }),
        "tops",
        { color: "#ffffff" }
      )
    );
    const merged = mergeWardrobeCataloguePlan(costume, plan);
    expect(merged.hidden).toEqual(["Outer_Blazer"]);
    expect(merged.recolor["Tops_Shirt"]).toBe(plan.recolor["Tops_Shirt"]);
    expect(merged.recolor["Tops_Shirt"]).not.toBe("#000000");
  });
});

describe("가시성 리스 장부 (HAIR_VISIBILITY_LEASES 규약)", () => {
  it("중첩 획득은 카운트만 올리고 마지막 반납에서만 원복한다", () => {
    const ledger = createWardrobeVisibilityLedger();

    expect(ledger.acquire("Outer_Blazer", true)).toBe(false);
    expect(ledger.count("Outer_Blazer")).toBe(1);

    expect(ledger.acquire("Outer_Blazer", true)).toBe(false);
    expect(ledger.count("Outer_Blazer")).toBe(2);

    expect(ledger.release("Outer_Blazer")).toBe(false); // 아직 다른 소유자가 있다
    expect(ledger.count("Outer_Blazer")).toBe(1);

    expect(ledger.release("Outer_Blazer")).toBe(true); // 마지막 반납 → 원래 값 복구
    expect(ledger.count("Outer_Blazer")).toBe(0);
    expect(ledger.keys()).toEqual([]);
  });

  it("첫 획득 시점의 원래 값만 기억한다", () => {
    const ledger = createWardrobeVisibilityLedger();
    ledger.acquire("Hidden_Mesh", false); // 원래도 숨어 있던 메시
    ledger.acquire("Hidden_Mesh", true); // 뒤늦은 잘못된 값은 무시돼야 한다
    ledger.release("Hidden_Mesh");
    expect(ledger.release("Hidden_Mesh")).toBe(false); // 원래 값(false)으로 복구
  });

  it("리스가 없는 키의 반납은 안전하게 무시된다", () => {
    const ledger = createWardrobeVisibilityLedger();
    expect(ledger.release("never-acquired")).toBe(true);
    expect(ledger.count("never-acquired")).toBe(0);
  });

  it("여러 키를 동시에 추적하고 키 목록은 정렬돼 나온다", () => {
    const ledger = createWardrobeVisibilityLedger();
    for (const key of ["Shoes_Loafer", "Accessory_Ribbon", "Outer_Blazer"]) ledger.acquire(key, true);
    expect(ledger.keys()).toEqual(["Accessory_Ribbon", "Outer_Blazer", "Shoes_Loafer"]);
    ledger.release("Outer_Blazer");
    expect(ledger.keys()).toEqual(["Accessory_Ribbon", "Shoes_Loafer"]);
  });
});
