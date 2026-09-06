import { describe, expect, it } from "vitest";

import {
  COSTUME_MANNEQUIN_CLAY_HEX,
  COSTUME_PALETTES,
  COSTUME_SAFE_LIT_BASE_HEX,
  classifyMeshName,
  hexToRgb,
  hslToRgb,
  isCostumeMesh,
  isMannequinClayCostumeHex,
  isNearBlackCostumeHex,
  parseCostumeState,
  resolveCostumeMaterialBaseHex,
  rgbToHex,
  rgbToHsl,
  serializeCostume,
  tintColor,
} from "./studio-vrm-costume";

describe("의상 메시 분류 휴리스틱", () => {
  it("의상 노드를 슬롯으로 분류한다", () => {
    expect(classifyMeshName("Tops_Shirt").slot).toBe("tops");
    expect(classifyMeshName("F_Jacket_01").slot).toBe("outer");
    expect(classifyMeshName("Bottoms_Skirt").slot).toBe("bottoms");
    expect(classifyMeshName("OnePiece_Dress").slot).toBe("onepiece");
    expect(classifyMeshName("Shoes_Boots").slot).toBe("shoes");
    expect(classifyMeshName("Accessory_Ribbon").slot).toBe("accessory");
  });

  it("피부·얼굴·눈·머리는 보호 카테고리로 잡고 의상으로 잡지 않는다", () => {
    expect(classifyMeshName("Face").protected).toBe("face");
    expect(classifyMeshName("EyeIris").protected).toBe("eye");
    expect(classifyMeshName("Body_Skin").protected).toBe("skin");
    expect(classifyMeshName("Hair_Back").protected).toBe("hair");
    for (const name of ["Face", "EyeIris", "Body_Skin", "Hair_Back"]) {
      expect(isCostumeMesh([name])).toBe(false);
    }
  });

  it("보호 패턴이 의상 패턴보다 우선한다(살색 오변경 방지)", () => {
    // 'skin'이 들어가면 cloth 토큰이 있어도 의상으로 잡지 않는다
    expect(classifyMeshName("Body_Skin_cloth").protected).toBe("skin");
    expect(isCostumeMesh(["Body_Skin_cloth"])).toBe(false);
  });

  it("머티리얼 이름과 노드 이름을 함께 본다", () => {
    expect(isCostumeMesh(["Node_001", "M_Uniform_Top"])).toBe(true);
    expect(classifyMeshName("Node_001", "N00_000_Hair_00_HAIR").protected).toBe("hair");
  });

  it("빈 이름은 미분류", () => {
    expect(classifyMeshName("", null, undefined)).toEqual({ slot: null, protected: null });
  });
});

describe("HSL 색 변환", () => {
  it("hex ↔ rgb 라운드트립", () => {
    expect(rgbToHex(hexToRgb("#2b3a5e"))).toBe("#2b3a5e");
  });

  it("rgb ↔ hsl 라운드트립(근사)", () => {
    const rgb = hexToRgb("#6e2434");
    const back = hslToRgb(rgbToHsl(rgb));
    expect(back.r).toBeCloseTo(rgb.r, 2);
    expect(back.g).toBeCloseTo(rgb.g, 2);
    expect(back.b).toBeCloseTo(rgb.b, 2);
  });

  it("회색은 채도 0", () => {
    expect(rgbToHsl({ r: 0.5, g: 0.5, b: 0.5 }).s)
      .toBe(0);
  });
});

describe("틴트(텍스처 음영 보존 리컬러)", () => {
  it("strength 0이면 원본 명도를 거의 유지한다", () => {
    const out = tintColor("#404040", "#ff0000", 0);
    // 색조는 바뀌어도 명도는 원본(어두움)과 가깝다
    const l = rgbToHsl(hexToRgb(out)).l;
    expect(l).toBeLessThan(0.4);
  });

  it("strength 높이면 목표 색조로 이동한다", () => {
    const out = tintColor("#808080", "#2b3a5e", 0.9);
    const h = rgbToHsl(hexToRgb(out)).h;
    const targetH = rgbToHsl(hexToRgb("#2b3a5e")).h;
    expect(Math.abs(h - targetH)).toBeLessThan(20);
  });

  it("어두운 부분과 밝은 부분의 명도 차(음영)가 보존된다", () => {
    const dark = rgbToHsl(hexToRgb(tintColor("#303030", "#2b3a5e", 0.85))).l;
    const light = rgbToHsl(hexToRgb(tintColor("#b0b0b0", "#2b3a5e", 0.85))).l;
    expect(light).toBeGreaterThan(dark); // 주름/그림자 유지
  });
});

describe("의상 lit base 안전 해석 (검정 옷 방지)", () => {
  it("detects mannequin clay and near-black hex", () => {
    expect(isMannequinClayCostumeHex(COSTUME_MANNEQUIN_CLAY_HEX)).toBe(true);
    expect(isMannequinClayCostumeHex("#2b3a5e")).toBe(false);
    expect(isNearBlackCostumeHex("#000000")).toBe(true);
    expect(isNearBlackCostumeHex("#010101")).toBe(true);
    expect(isNearBlackCostumeHex("#1c1c22")).toBe(false);
  });

  it("refuses mannequin clay as a cacheable native base", () => {
    const resolved = resolveCostumeMaterialBaseHex(COSTUME_MANNEQUIN_CLAY_HEX, { hasMap: true });
    expect(resolved.hex).toBe(COSTUME_SAFE_LIT_BASE_HEX);
    expect(resolved.cacheable).toBe(false);
  });

  it("refuses near-black×map as a cacheable native base (black × texture = pure black clothes)", () => {
    const resolved = resolveCostumeMaterialBaseHex("#000000", { hasMap: true });
    expect(resolved.hex).toBe(COSTUME_SAFE_LIT_BASE_HEX);
    expect(resolved.cacheable).toBe(false);
  });

  it("keeps legitimate dark untextured bases cacheable", () => {
    const resolved = resolveCostumeMaterialBaseHex("#000000", { hasMap: false });
    expect(resolved.hex).toBe("#000000");
    expect(resolved.cacheable).toBe(true);
  });

  it("prefers a previously cached stable base", () => {
    const resolved = resolveCostumeMaterialBaseHex("#000000", {
      hasMap: true,
      cached: "#2b3a5e",
    });
    expect(resolved.hex).toBe("#2b3a5e");
    expect(resolved.cacheable).toBe(true);
  });

  it("tint from safe white base does not collapse recolor to black", () => {
    const poisoned = tintColor("#000000", "#2b3a5e", 0.85);
    const safe = tintColor(COSTUME_SAFE_LIT_BASE_HEX, "#2b3a5e", 0.85);
    expect(rgbToHsl(hexToRgb(safe)).l).toBeGreaterThan(rgbToHsl(hexToRgb(poisoned)).l);
    expect(rgbToHsl(hexToRgb(safe)).l).toBeGreaterThan(0.15);
  });
});

describe("의상 프리셋 팔레트", () => {
  it("6종 이상이고 모두 유효한 hex", () => {
    expect(COSTUME_PALETTES.length).toBeGreaterThanOrEqual(6);
    for (const p of COSTUME_PALETTES) {
      expect(p.color).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe("의상 상태 직렬화", () => {
  it("빈 상태는 undefined", () => {
    expect(serializeCostume({ hidden: [], recolor: {} })).toBeUndefined();
  });

  it("라운드트립 보존 + 잘못된 색 제거", () => {
    const ser = serializeCostume({ hidden: ["Outer_Jacket"], recolor: { Tops: "#2B3A5E", Bad: "xyz" } });
    const parsed = parseCostumeState(ser);
    expect(parsed.hidden).toEqual(["Outer_Jacket"]);
    expect(parsed.recolor.Tops).toBe("#2b3a5e");
    expect(parsed.recolor.Bad).toBeUndefined();
  });

  it("쓰레기 입력은 빈 상태", () => {
    expect(parseCostumeState(null)).toEqual({ hidden: [], recolor: {} });
    expect(parseCostumeState(42)).toEqual({ hidden: [], recolor: {} });
  });
});
