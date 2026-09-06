import { describe, expect, it } from "vitest";

import {
  DEFAULT_SKETCH,
  SKETCH_DETAIL_RANGE,
  SKETCH_PRESETS,
  SKETCH_STRENGTH_RANGE,
  SKETCH_TYPES,
  applySketch,
  isIdentitySketch,
  normalizeSketch,
  sketchKonvaFilter,
  type Sketch,
  type SketchType,
} from "./studio-sketch";

import type { StudioImageDataLike } from "./studio-filters";

// ---- 테스트용 가짜 ImageData 빌더 ----

/** [r,g,b,a] 픽셀 배열로 StudioImageDataLike 생성(부분 채움 허용). */
function makeImage(width: number, height: number, pixels: number[][]): StudioImageDataLike {
  const data = new Uint8ClampedArray(width * height * 4);
  pixels.forEach((px, i) => data.set(px, i * 4));
  return { data, width, height };
}

function pixelAt(img: StudioImageDataLike, index: number): number[] {
  return Array.from(img.data.slice(index * 4, index * 4 + 4));
}

/** width*height 균일 단색 이미지 — 모든 픽셀 [r,g,b,a]. */
function makeSolid(width: number, height: number, rgba: [number, number, number, number]): StudioImageDataLike {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set(rgba, i * 4);
  return { data, width, height };
}

/**
 * 좌표 의존 패턴 이미지 — r/g/b가 x,y에 따라 변하는 결정적 그라디언트.
 * 균일색은 외곽선/해치/디더에서 평탄해 변화가 약하므로, 변형 감지는 패턴으로 한다(알파는 인자로).
 */
function makePattern(width: number, height: number, alpha = 255): StudioImageDataLike {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      data[i] = (x * 17 + 13) % 256; // R: 가로 줄무늬
      data[i + 1] = (y * 23 + 7) % 256; // G: 세로 줄무늬
      data[i + 2] = (x * 7 + y * 11) % 256; // B: 대각
      data[i + 3] = alpha;
    }
  }
  return { data, width, height };
}

/**
 * 어두움→밝음 가로 그라디언트 — 휘도가 x에 따라 0..255로 변한다.
 * 휘도 의존 효과(크로스해치/메조틴트/스탬프)가 톤별로 다르게 반응하는지 보기 좋다.
 */
function makeLumaRamp(width: number, height: number, alpha = 255): StudioImageDataLike {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const v = Math.round((x / Math.max(1, width - 1)) * 255);
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = alpha;
    }
  }
  return { data, width, height };
}

/** 두 이미지의 픽셀 데이터가 완전히 같은지. */
function dataEqual(a: StudioImageDataLike, b: StudioImageDataLike): boolean {
  if (a.data.length !== b.data.length) return false;
  for (let i = 0; i < a.data.length; i++) {
    if (a.data[i] !== b.data[i]) return false;
  }
  return true;
}

/** 모든 픽셀의 알파(+3)가 기대 배열과 일치하는지(원본 알파 보존 검증). */
function alphaPreserved(img: StudioImageDataLike, before: StudioImageDataLike): boolean {
  for (let i = 3; i < img.data.length; i += 4) {
    if (img.data[i] !== before.data[i]) return false;
  }
  return true;
}

// 모든 종류(strength>0, opaque)에서 픽셀이 실제로 바뀌는지 검증할 때 쓰는 설정.
const ALL_TYPES: SketchType[] = ["photocopy", "crosshatch", "stamp", "mezzotint"];

// ---------------------------------------------------------------------------

describe("DEFAULT_SKETCH / isIdentitySketch", () => {
  it("기본값은 photocopy·strength0·detail3 항등", () => {
    expect(DEFAULT_SKETCH).toEqual({ type: "photocopy", strength: 0, detail: 3 });
    expect(isIdentitySketch(DEFAULT_SKETCH)).toBe(true);
  });

  it("strength<=0이면 항등, strength>0이면 항등 아님", () => {
    expect(isIdentitySketch({ type: "photocopy", strength: 0, detail: 5 })).toBe(true);
    expect(isIdentitySketch({ type: "crosshatch", strength: -5, detail: 1 })).toBe(true);
    expect(isIdentitySketch({ type: "stamp", strength: 1, detail: 3 })).toBe(false);
    expect(isIdentitySketch({ type: "mezzotint", strength: 90, detail: 4 })).toBe(false);
  });
});

describe("범위·종류 상수", () => {
  it("세기 범위는 0..100, step 1", () => {
    expect(SKETCH_STRENGTH_RANGE).toEqual({ min: 0, max: 100, step: 1 });
  });
  it("디테일 범위는 1..10, step 1", () => {
    expect(SKETCH_DETAIL_RANGE).toEqual({ min: 1, max: 10, step: 1 });
  });
  it("SKETCH_TYPES는 4종(photocopy·crosshatch·stamp·mezzotint)과 한글 라벨", () => {
    expect(SKETCH_TYPES.map((t) => t.id)).toEqual(["photocopy", "crosshatch", "stamp", "mezzotint"]);
    const labels = new Map(SKETCH_TYPES.map((t) => [t.id, t.label]));
    expect(labels.get("photocopy")).toBe("포토카피");
    expect(labels.get("crosshatch")).toBe("크로스해치");
    expect(labels.get("stamp")).toBe("스탬프");
    expect(labels.get("mezzotint")).toBe("메조틴트");
  });
});

describe("normalizeSketch", () => {
  it("undefined/null → 기본값", () => {
    expect(normalizeSketch()).toEqual(DEFAULT_SKETCH);
    expect(normalizeSketch(null)).toEqual(DEFAULT_SKETCH);
  });

  it("누락 키는 기본값으로 채운다", () => {
    expect(normalizeSketch({ strength: 40 })).toEqual({ type: "photocopy", strength: 40, detail: 3 });
    expect(normalizeSketch({ type: "mezzotint" })).toEqual({ type: "mezzotint", strength: 0, detail: 3 });
  });

  it("범위 밖 숫자는 각 범위로 클램프", () => {
    expect(normalizeSketch({ type: "crosshatch", strength: 999, detail: 99 })).toEqual({
      type: "crosshatch",
      strength: 100,
      detail: 10,
    });
    expect(normalizeSketch({ strength: -50, detail: -3 })).toEqual({
      type: "photocopy",
      strength: 0,
      detail: 1,
    });
  });

  it("유효하지 않은 type은 기본 'photocopy'로", () => {
    expect(normalizeSketch({ type: "bogus" as unknown as SketchType }).type).toBe("photocopy");
    expect(normalizeSketch({ type: 42 as unknown as SketchType }).type).toBe("photocopy");
    // 유효 type은 그대로 유지.
    for (const t of SKETCH_TYPES) {
      expect(normalizeSketch({ type: t.id }).type).toBe(t.id);
    }
  });

  it("숫자가 아닌 값/NaN/Infinity는 기본값", () => {
    const out = normalizeSketch({
      strength: "50" as unknown as number,
      detail: Number.NaN,
    });
    expect(out).toEqual({ type: "photocopy", strength: 0, detail: 3 });
    expect(normalizeSketch({ strength: Number.POSITIVE_INFINITY, detail: Number.NEGATIVE_INFINITY })).toEqual(
      DEFAULT_SKETCH
    );
  });

  it("소수 detail은 정수로 내림", () => {
    expect(normalizeSketch({ detail: 5.9 }).detail).toBe(5);
    expect(normalizeSketch({ detail: 1.2 }).detail).toBe(1);
  });
});

describe("applySketch — 항등/no-op", () => {
  it("strength0이면 no-op(데이터 불변)", () => {
    const img = makePattern(8, 8);
    const before = makePattern(8, 8);
    applySketch(img, { type: "photocopy", strength: 0, detail: 3 });
    expect(dataEqual(img, before)).toBe(true);
  });

  it("모든 종류가 strength0에서 정확한 no-op(ZERO 픽셀 기록)", () => {
    for (const type of ALL_TYPES) {
      const img = makePattern(8, 8);
      const before = makePattern(8, 8);
      applySketch(img, { type, strength: 0, detail: 4 });
      expect(dataEqual(img, before)).toBe(true);
    }
  });

  it("strength<=0(음수)도 no-op", () => {
    const img = makePattern(6, 6);
    const before = makePattern(6, 6);
    applySketch(img, { type: "mezzotint", strength: -10, detail: 3 });
    expect(dataEqual(img, before)).toBe(true);
  });

  it("폭/높이 0이면 no-op(throw 없음)", () => {
    const img: StudioImageDataLike = { data: new Uint8ClampedArray(0), width: 0, height: 0 };
    expect(() => applySketch(img, { type: "crosshatch", strength: 100, detail: 2 })).not.toThrow();
  });
});

describe("applySketch — 각 종류가 픽셀을 눈에 띄게 바꾼다", () => {
  it("모든 종류가 패턴(불투명)을 실제로 변형한다", () => {
    for (const type of ALL_TYPES) {
      const img = makePattern(16, 16, 255);
      const before = makePattern(16, 16, 255);
      applySketch(img, { type, strength: 100, detail: 3 });
      expect(dataEqual(img, before)).toBe(false);
    }
  });

  it("모든 종류가 결정적 — 같은 입력 두 번이 완전히 동일", () => {
    for (const type of ALL_TYPES) {
      const a = makePattern(20, 16, 255);
      const b = makePattern(20, 16, 255);
      applySketch(a, { type, strength: 70, detail: 4 });
      applySketch(b, { type, strength: 70, detail: 4 });
      expect(dataEqual(a, b)).toBe(true);
    }
  });

  it("모든 종류가 알파(+3)를 보존한다(불투명·반투명 모두)", () => {
    for (const alpha of [255, 120]) {
      for (const type of ALL_TYPES) {
        const img = makePattern(16, 16, alpha);
        const before = makePattern(16, 16, alpha);
        applySketch(img, { type, strength: 90, detail: 3 });
        expect(alphaPreserved(img, before)).toBe(true);
      }
    }
  });

  it("모든 종류가 채널을 유한 0..255로 클램프한다(강한 설정)", () => {
    for (const type of ALL_TYPES) {
      const img = makePattern(16, 16, 255);
      applySketch(img, { type, strength: 100, detail: 10 });
      for (const v of img.data) {
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(255);
      }
    }
  });
});

describe("applySketch — photocopy(포토카피)", () => {
  it("평탄 영역(균일색)은 흰 바탕(255)으로 간다(기울기 0)", () => {
    // 경사 없는 균일색 → 소벨 mag=0 → 잉크 255(흰 바탕).
    const img = makeSolid(8, 8, [60, 90, 120, 255]);
    applySketch(img, { type: "photocopy", strength: 100, detail: 4 });
    const center = pixelAt(img, 4 * 8 + 4);
    expect(center[0]).toBe(255);
    expect(center[1]).toBe(255);
    expect(center[2]).toBe(255);
  });

  it("경계가 있는 패턴은 어두운 잉크 선이 생긴다(흰 바탕보다 어두운 픽셀 존재)", () => {
    const img = makePattern(24, 24, 255);
    applySketch(img, { type: "photocopy", strength: 100, detail: 6 });
    let hasInk = false;
    for (let i = 0; i < img.data.length; i += 4) {
      if (img.data[i]! < 128) {
        hasInk = true;
        break;
      }
    }
    expect(hasInk).toBe(true);
  });

  it("detail이 다르면 결과가 달라진다(임계/선 두께)", () => {
    const a = makePattern(20, 20, 255);
    const b = makePattern(20, 20, 255);
    applySketch(a, { type: "photocopy", strength: 100, detail: 1 });
    applySketch(b, { type: "photocopy", strength: 100, detail: 9 });
    expect(dataEqual(a, b)).toBe(false);
  });

  it("완전 투명(alpha 0) 픽셀은 흰 바탕으로 새지 않고 원본 RGB 그대로다(헤일로 없음)", () => {
    const img = makePattern(6, 6, 0);
    const before = makePattern(6, 6, 0);
    applySketch(img, { type: "photocopy", strength: 100, detail: 4 });
    expect(dataEqual(img, before)).toBe(true);
  });
});

describe("applySketch — crosshatch(크로스해치)", () => {
  it("아주 밝은 영역은 해치가 거의 없어 흰 바탕(255)에 가깝다", () => {
    // 흰색(luma 255)은 모든 해치 단계 임계(<=200 등)를 넘어 잉크가 안 깔린다.
    const img = makeSolid(12, 12, [255, 255, 255, 255]);
    applySketch(img, { type: "crosshatch", strength: 100, detail: 3 });
    // 모든 픽셀이 흰색 유지(해치선 0개).
    let allWhite = true;
    for (let i = 0; i < img.data.length; i += 4) {
      if (img.data[i]! !== 255) {
        allWhite = false;
        break;
      }
    }
    expect(allWhite).toBe(true);
  });

  it("어두운 영역은 해치선(검정)이 깔린다", () => {
    // 어두운 단색(luma 낮음)은 해치선 위에서 검정 잉크.
    const img = makeSolid(16, 16, [20, 20, 20, 255]);
    applySketch(img, { type: "crosshatch", strength: 100, detail: 3 });
    let hasInk = false;
    let hasWhite = false;
    for (let i = 0; i < img.data.length; i += 4) {
      if (img.data[i]! === 0) hasInk = true;
      if (img.data[i]! === 255) hasWhite = true;
    }
    // 선은 검정, 선 사이는 흰 바탕 — 둘 다 존재해야 '해치선'이다.
    expect(hasInk).toBe(true);
    expect(hasWhite).toBe(true);
  });

  it("어두울수록 해치 잉크가 더 촘촘하다(교차 방향 추가)", () => {
    // 같은 detail에서 더 어두운 톤이 잉크 픽셀 수가 더 많아야 한다.
    function inkCount(rgb: [number, number, number]): number {
      const img = makeSolid(24, 24, [rgb[0], rgb[1], rgb[2], 255]);
      applySketch(img, { type: "crosshatch", strength: 100, detail: 3 });
      let n = 0;
      for (let i = 0; i < img.data.length; i += 4) if (img.data[i]! === 0) n++;
      return n;
    }
    const lightInk = inkCount([170, 170, 170]); // L1만 켜짐
    const darkInk = inkCount([30, 30, 30]); // L1+L2+L3 켜짐
    expect(darkInk).toBeGreaterThan(lightInk);
  });

  it("detail(간격)이 다르면 결과가 달라진다", () => {
    const a = makeLumaRamp(24, 24, 255);
    const b = makeLumaRamp(24, 24, 255);
    applySketch(a, { type: "crosshatch", strength: 100, detail: 2 });
    applySketch(b, { type: "crosshatch", strength: 100, detail: 8 });
    expect(dataEqual(a, b)).toBe(false);
  });
});

describe("applySketch — stamp(스탬프)", () => {
  it("어두운 단색은 검정(0), 밝은 단색은 흰색(255)으로 하드 2계조", () => {
    const dark = makeSolid(8, 8, [20, 20, 20, 255]);
    const light = makeSolid(8, 8, [230, 230, 230, 255]);
    applySketch(dark, { type: "stamp", strength: 100, detail: 5 });
    applySketch(light, { type: "stamp", strength: 100, detail: 5 });
    expect(pixelAt(dark, 4 * 8 + 4)[0]).toBe(0);
    expect(pixelAt(light, 4 * 8 + 4)[0]).toBe(255);
  });

  it("출력이 순수 흑/백뿐이다(중간 톤 없음, 불투명 strength 100)", () => {
    const img = makeLumaRamp(20, 4, 255);
    applySketch(img, { type: "stamp", strength: 100, detail: 5 });
    for (let i = 0; i < img.data.length; i += 4) {
      const r = img.data[i]!;
      expect(r === 0 || r === 255).toBe(true);
    }
  });

  it("detail이 클수록 임계가 높아 잉크(검정)가 더 넓다", () => {
    function inkCount(detail: number): number {
      const img = makeLumaRamp(40, 4, 255);
      applySketch(img, { type: "stamp", strength: 100, detail });
      let n = 0;
      for (let i = 0; i < img.data.length; i += 4) if (img.data[i]! === 0) n++;
      return n;
    }
    expect(inkCount(9)).toBeGreaterThan(inkCount(1));
  });
});

describe("applySketch — mezzotint(메조틴트)", () => {
  it("중간 회색은 베이어 디더로 흑/백 점이 섞인다(균일색이라도 패턴 발생)", () => {
    // luma 128 균일색 → 베이어 임계에 따라 절반은 검정, 절반은 흰 점.
    const img = makeSolid(8, 8, [128, 128, 128, 255]);
    applySketch(img, { type: "mezzotint", strength: 100, detail: 1 });
    let black = 0;
    let white = 0;
    for (let i = 0; i < img.data.length; i += 4) {
      if (img.data[i]! === 0) black++;
      else if (img.data[i]! === 255) white++;
    }
    expect(black).toBeGreaterThan(0);
    expect(white).toBeGreaterThan(0);
  });

  it("출력이 순수 흑/백뿐이다(ordered dither, 불투명 strength 100)", () => {
    const img = makeLumaRamp(16, 16, 255);
    applySketch(img, { type: "mezzotint", strength: 100, detail: 2 });
    for (let i = 0; i < img.data.length; i += 4) {
      const r = img.data[i]!;
      expect(r === 0 || r === 255).toBe(true);
    }
  });

  it("detail(셀 크기)이 다르면 점 입자 결과가 달라진다", () => {
    const a = makeSolid(16, 16, [128, 128, 128, 255]);
    const b = makeSolid(16, 16, [128, 128, 128, 255]);
    applySketch(a, { type: "mezzotint", strength: 100, detail: 1 });
    applySketch(b, { type: "mezzotint", strength: 100, detail: 4 });
    expect(dataEqual(a, b)).toBe(false);
  });

  it("결정적 — 같은 입력 두 번 동일", () => {
    const a = makeLumaRamp(20, 12, 255);
    const b = makeLumaRamp(20, 12, 255);
    applySketch(a, { type: "mezzotint", strength: 80, detail: 2 });
    applySketch(b, { type: "mezzotint", strength: 80, detail: 2 });
    expect(dataEqual(a, b)).toBe(true);
  });
});

describe("applySketch — 작은 이미지 안전성", () => {
  it("1x1 이미지(가장 작은 케이스)도 throw 없이 안전하고 알파 보존", () => {
    for (const type of ALL_TYPES) {
      const img = makeImage(1, 1, [[130, 90, 60, 200]]);
      expect(() => applySketch(img, { type, strength: 100, detail: 10 })).not.toThrow();
      expect(pixelAt(img, 0)[3]).toBe(200); // 알파 보존
      for (const v of img.data) {
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(255);
      }
    }
  });

  it("2x2 작은 이미지도 모든 종류에서 throw 없이 유한 출력", () => {
    for (const type of ALL_TYPES) {
      const img = makeImage(2, 2, [
        [10, 20, 30, 255],
        [200, 100, 50, 255],
        [80, 160, 240, 255],
        [128, 128, 128, 255],
      ]);
      expect(() => applySketch(img, { type, strength: 100, detail: 8 })).not.toThrow();
      for (const v of img.data) {
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(255);
      }
    }
  });
});

describe("SKETCH_PRESETS", () => {
  it("첫 항목이 '없음/기본' 항등이 아니다(바로 효과)", () => {
    const first = SKETCH_PRESETS[0]!;
    expect(isIdentitySketch(first.value)).toBe(false);
    expect(first.id).not.toBe("none");
  });

  it("전부 실효(strength>0) 프리셋이고 5개 내외다", () => {
    expect(SKETCH_PRESETS.length).toBeGreaterThanOrEqual(4);
    expect(SKETCH_PRESETS.length).toBeLessThanOrEqual(8);
    for (const p of SKETCH_PRESETS) {
      expect(isIdentitySketch(p.value)).toBe(false);
      expect(p.value.strength).toBeGreaterThan(0);
    }
  });

  it("id는 모두 고유하다", () => {
    const ids = SKETCH_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("label/tip은 비어있지 않다", () => {
    for (const p of SKETCH_PRESETS) {
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.tip.length).toBeGreaterThan(0);
    }
  });

  it("모든 value가 normalizeSketch와 동일(범위 안·type 유효)", () => {
    for (const p of SKETCH_PRESETS) {
      expect(p.value).toEqual(normalizeSketch(p.value));
      expect(p.value.strength).toBeGreaterThanOrEqual(SKETCH_STRENGTH_RANGE.min);
      expect(p.value.strength).toBeLessThanOrEqual(SKETCH_STRENGTH_RANGE.max);
      expect(p.value.detail).toBeGreaterThanOrEqual(SKETCH_DETAIL_RANGE.min);
      expect(p.value.detail).toBeLessThanOrEqual(SKETCH_DETAIL_RANGE.max);
      expect(SKETCH_TYPES.some((t) => t.id === p.value.type)).toBe(true);
    }
  });

  it("명세된 대표 프리셋 값을 담고 있다(포토카피/연한 해치/진한 해치/스탬프/메조틴트)", () => {
    const byId = new Map(SKETCH_PRESETS.map((p) => [p.id, p.value]));
    expect(byId.get("photocopy")!.type).toBe("photocopy");
    const hatchLight = byId.get("hatch-light")!;
    expect(hatchLight.type).toBe("crosshatch");
    const hatchDense = byId.get("hatch-dense")!;
    expect(hatchDense.type).toBe("crosshatch");
    // 진한 해치는 더 촘촘(작은 detail=간격).
    expect(hatchDense.detail).toBeLessThan(hatchLight.detail);
    expect(byId.get("stamp")!.type).toBe("stamp");
    expect(byId.get("mezzotint")!.type).toBe("mezzotint");
  });
});

describe("sketchKonvaFilter", () => {
  it("flat attrs(skType/skStrength/skDetail)를 읽어 applySketch와 동일하게 변형", () => {
    const img = makePattern(16, 16, 255);
    sketchKonvaFilter.call({ attrs: { skType: "photocopy", skStrength: 100, skDetail: 4 } }, img);

    // applySketch 직접 호출과 동일해야 한다.
    const ref = makePattern(16, 16, 255);
    applySketch(ref, normalizeSketch({ type: "photocopy", strength: 100, detail: 4 }));
    expect(dataEqual(img, ref)).toBe(true);
    // 실제로 변형됐는지.
    expect(dataEqual(img, makePattern(16, 16, 255))).toBe(false);
  });

  it("mezzotint attrs도 동일하게 적용", () => {
    const img = makeLumaRamp(20, 20, 255);
    sketchKonvaFilter.call({ attrs: { skType: "mezzotint", skStrength: 90, skDetail: 2 } }, img);
    const ref = makeLumaRamp(20, 20, 255);
    applySketch(ref, normalizeSketch({ type: "mezzotint", strength: 90, detail: 2 }));
    expect(dataEqual(img, ref)).toBe(true);
  });

  it("attrs가 비면 no-op(throw 없음)", () => {
    const img = makeImage(2, 2, [[10, 20, 30, 40]]);
    const before = Array.from(img.data);
    expect(() => sketchKonvaFilter.call({ attrs: {} }, img)).not.toThrow();
    expect(Array.from(img.data)).toEqual(before);
  });

  it("this.attrs 자체가 없어도 no-op", () => {
    const img = makeImage(2, 2, [[10, 20, 30, 40]]);
    const before = Array.from(img.data);
    expect(() => sketchKonvaFilter.call({}, img)).not.toThrow();
    expect(Array.from(img.data)).toEqual(before);
  });

  it("strength0으로 정규화되는 attrs는 no-op", () => {
    const img = makePattern(8, 8);
    const before = Array.from(img.data);
    sketchKonvaFilter.call({ attrs: { skType: "stamp", skStrength: 0, skDetail: 4 } }, img);
    expect(Array.from(img.data)).toEqual(before);
  });

  it("무효 attrs(숫자 아님)는 안전하게 무시 — type만 유효해도 strength 누락이면 항등 no-op", () => {
    const img = makePattern(8, 8);
    const before = Array.from(img.data);
    const attrs = { skType: "mezzotint", skStrength: Number.NaN, skDetail: "x" };
    expect(() => sketchKonvaFilter.call({ attrs }, img)).not.toThrow();
    expect(Array.from(img.data)).toEqual(before);
  });
});

// 모든 종류가 완전 투명(알파 0) 픽셀의 RGB까지 보존하는지(헤일로 없음) — 알파 가드 회귀 방지.
// 잉크 효과는 평탄/임계 영역을 흰색(255)·검정(0)으로 보내므로 알파 가드가 없으면 투명 영역이 샌다.
describe("applySketch — 완전 투명 픽셀 RGB 보존(전 종류)", () => {
  it("알파 0 패턴은 모든 종류에서 RGB까지 그대로다", () => {
    for (const type of ALL_TYPES) {
      const img = makePattern(8, 8, 0); // 알파 0(투명)
      const before = makePattern(8, 8, 0);
      applySketch(img, { type, strength: 100, detail: 3 });
      expect(dataEqual(img, before)).toBe(true);
    }
  });

  it("알파 0 균일 회색도 메조틴트/스탬프에서 흑백으로 새지 않는다", () => {
    for (const type of ["mezzotint", "stamp"] as SketchType[]) {
      const img = makeSolid(8, 8, [128, 128, 128, 0]);
      const before = makeSolid(8, 8, [128, 128, 128, 0]);
      applySketch(img, { type, strength: 100, detail: 2 });
      expect(dataEqual(img, before)).toBe(true);
    }
  });
});

// 정규화를 안 거친 직접 applySketch 호출에서 strength/detail이 비유한(NaN/±Infinity)이어도
// 픽셀이 검게(0) 뭉개지지 않는다(잉크값 NaN→Uint8Clamped 0 오염 차단). 라이브 경로는 normalizeSketch가 막는다.
describe("applySketch — 비유한 입력 방어(검은 픽셀 회귀 방지)", () => {
  const anyNonBlack = (img: StudioImageDataLike): boolean => {
    for (let i = 0; i < img.data.length; i += 4)
      if (img.data[i] || img.data[i + 1] || img.data[i + 2]) return true;
    return false;
  };

  it("비유한 strength는 이미지를 손대지 않는다(t=0)", () => {
    for (const strength of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const img = makePattern(8, 8, 255);
      const before = makePattern(8, 8, 255);
      expect(() => applySketch(img, { type: "photocopy", strength, detail: 3 })).not.toThrow();
      expect(dataEqual(img, before)).toBe(true);
    }
  });

  it("비유한 detail이어도 알파 보존 + 검은 오염 없음(모든 종류)", () => {
    for (const type of ALL_TYPES) {
      const img = makePattern(8, 8, 255);
      const before = makePattern(8, 8, 255);
      expect(() => applySketch(img, { type, strength: 100, detail: Number.NaN })).not.toThrow();
      expect(alphaPreserved(img, before)).toBe(true);
      expect(anyNonBlack(img)).toBe(true);
    }
  });
});

// 미사용 import 방지용 타입 참조.
const _typecheck: Sketch = DEFAULT_SKETCH;
void _typecheck;
