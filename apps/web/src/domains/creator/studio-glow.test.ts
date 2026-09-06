import { describe, expect, it } from "vitest";

import {
  DEFAULT_GLOW,
  GLOW_PRESETS,
  GLOW_SIZE_RANGE,
  GLOW_STRENGTH_RANGE,
  GLOW_THRESHOLD_RANGE,
  applyGlow,
  glowKonvaFilter,
  isIdentityGlow,
  normalizeGlow,
} from "./studio-glow";

import type { StudioImageDataLike } from "./studio-filters";

// ---- 테스트용 가짜 ImageData 빌더 ----

/** [r,g,b,a] 픽셀 배열로 StudioImageDataLike 생성. */
function makeImage(width: number, height: number, pixels: number[][]): StudioImageDataLike {
  const data = new Uint8ClampedArray(width * height * 4);
  pixels.forEach((px, i) => data.set(px, i * 4));
  return { data, width, height };
}

function pixelAt(img: StudioImageDataLike, index: number): number[] {
  return Array.from(img.data.slice(index * 4, index * 4 + 4));
}

/** 가로 한 줄짜리 그레이 이미지 — x별 휘도값 배열을 [v,v,v,alpha]로 펼친다. */
function makeGrayRow(values: number[], alpha = 255): StudioImageDataLike {
  return makeImage(
    values.length,
    1,
    values.map((v) => [v, v, v, alpha])
  );
}

/** 가운데 한 픽셀만 밝고 나머지는 검정인 가로 줄(번짐/게이팅 테스트용). */
function makeBrightCenterRow(length: number, center: number, value: number): number[] {
  return Array.from({ length }, (_, x) => (x === center ? value : 0));
}

describe("DEFAULT_GLOW / isIdentityGlow", () => {
  it("기본값은 strength 0의 항등(size 12, threshold 60, color auto)", () => {
    expect(DEFAULT_GLOW).toEqual({ strength: 0, size: 12, threshold: 60, color: "auto" });
    expect(isIdentityGlow(DEFAULT_GLOW)).toBe(true);
  });

  it("strength<=0이면 항등, strength>0이면 항등이 아니다", () => {
    expect(isIdentityGlow({ strength: 0, size: 12, threshold: 60, color: "auto" })).toBe(true);
    expect(isIdentityGlow({ strength: -5, size: 12, threshold: 60, color: "auto" })).toBe(true);
    expect(isIdentityGlow({ strength: 1, size: 12, threshold: 60, color: "auto" })).toBe(false);
    expect(isIdentityGlow({ strength: 30, size: 1, threshold: 0, color: "#00e5ff" })).toBe(false);
  });
});

describe("GLOW 범위 상수", () => {
  it("strength 0..100, size 1..40, threshold 0..100 (전부 step 1)", () => {
    expect(GLOW_STRENGTH_RANGE).toEqual({ min: 0, max: 100, step: 1 });
    expect(GLOW_SIZE_RANGE).toEqual({ min: 1, max: 40, step: 1 });
    expect(GLOW_THRESHOLD_RANGE).toEqual({ min: 0, max: 100, step: 1 });
  });
});

describe("normalizeGlow", () => {
  it("undefined/null → 기본값", () => {
    expect(normalizeGlow()).toEqual(DEFAULT_GLOW);
    expect(normalizeGlow(null)).toEqual(DEFAULT_GLOW);
  });

  it("누락 키는 기본값으로 채운다", () => {
    expect(normalizeGlow({ strength: 40 })).toEqual({ strength: 40, size: 12, threshold: 60, color: "auto" });
    expect(normalizeGlow({ size: 20 })).toEqual({ strength: 0, size: 20, threshold: 60, color: "auto" });
  });

  it("범위 밖 숫자는 각 범위로 클램프", () => {
    expect(normalizeGlow({ strength: 999, size: 999, threshold: 999 })).toMatchObject({
      strength: 100,
      size: 40,
      threshold: 100,
    });
    expect(normalizeGlow({ strength: -999, size: -999, threshold: -999 })).toMatchObject({
      strength: 0,
      size: 1, // size 하한 1
      threshold: 0,
    });
  });

  it("숫자가 아닌 값/NaN/Infinity는 기본값", () => {
    const out = normalizeGlow({
      strength: "50" as unknown as number,
      size: Number.NaN,
      threshold: Number.POSITIVE_INFINITY,
    });
    expect(out).toEqual({ strength: 0, size: 12, threshold: 60, color: "auto" });
  });

  it('color는 "auto" 또는 유효 #rrggbb(소문자화)만 인정, 그 외는 "auto"', () => {
    expect(normalizeGlow({ color: "auto" }).color).toBe("auto");
    expect(normalizeGlow({ color: "#00E5FF" }).color).toBe("#00e5ff"); // 소문자화
    expect(normalizeGlow({ color: "#ffcf6b" }).color).toBe("#ffcf6b");
    // 무효: #rgb 축약, 형식 오류, 비문자열 → "auto"
    expect(normalizeGlow({ color: "#abc" }).color).toBe("auto");
    expect(normalizeGlow({ color: "00e5ff" }).color).toBe("auto");
    expect(normalizeGlow({ color: "red" }).color).toBe("auto");
    expect(normalizeGlow({ color: 123 as unknown as string }).color).toBe("auto");
  });
});

describe("applyGlow — 항등/no-op", () => {
  it("strength 0이면 no-op (데이터 불변)", () => {
    const img = makeImage(2, 1, [
      [10, 20, 30, 40],
      [200, 100, 50, 255],
    ]);
    applyGlow(img, { strength: 0, size: 12, threshold: 60, color: "auto" });
    expect(pixelAt(img, 0)).toEqual([10, 20, 30, 40]);
    expect(pixelAt(img, 1)).toEqual([200, 100, 50, 255]);
  });

  it("밝은 픽셀이 하나도 없으면(전부 threshold 미만) 데이터 불변", () => {
    // 휘도 전부 153(threshold 60 → cut 153) 미만이라 추출 레이어가 비어 글로우 없음.
    const img = makeGrayRow([5, 10, 15, 20, 25, 30, 35, 40, 45]);
    const before = Array.from(img.data);
    applyGlow(img, { strength: 80, size: 5, threshold: 60, color: "auto" });
    expect(Array.from(img.data)).toEqual(before);
  });
});

describe("applyGlow — 밝은 영역은 번지고 어두운 곳은 그대로", () => {
  it("밝은 픽셀은 더 밝아지고 이웃으로 빛이 번지며, 멀리 떨어진 어두운 픽셀은 그대로", () => {
    // 가로 9px: 가운데(4)만 200으로 밝고 나머지는 검정.
    const values = makeBrightCenterRow(9, 4, 200);
    const before = makeGrayRow(values);
    const after = makeGrayRow(values);
    applyGlow(after, { strength: 60, size: 3, threshold: 50, color: "auto" });

    // 밝은 중심은 스크린 합성으로 더 밝아진다.
    expect(pixelAt(after, 4)[0]!).toBeGreaterThan(pixelAt(before, 4)[0]!);
    // 바로 옆 이웃(3,5)은 빛이 번져 0보다 커진다(좌우 대칭).
    expect(pixelAt(after, 3)[0]!).toBeGreaterThan(0);
    expect(pixelAt(after, 5)[0]!).toBeGreaterThan(0);
    expect(pixelAt(after, 3)[0]!).toBe(pixelAt(after, 5)[0]!);
    // 멀리 떨어진 끝 픽셀(0)은 블러가 닿지 않아 그대로 0.
    expect(pixelAt(after, 0)[0]!).toBe(0);
  });
});

describe("applyGlow — threshold 게이팅", () => {
  // [의도적 변경] 소프트 니(knee) 도입 — 임계 바로 아래 휘도도 부분 가중으로 추출된다.
  // 이전에는 임계 미만이 전부 0(하드 컷)이라 high 이웃이 정확히 0이었지만, 이제 니 구간에
  // 걸친 휘도는 아주 약한 글로우를 남긴다(하드 컷 밴딩 제거). 순서 관계와 "훨씬 약함"을 검증한다.
  it("threshold를 높이면 추출 가중이 급감해 이웃 글로우가 크게 약해진다(소프트 니)", () => {
    // 가운데(4) 휘도 150: threshold 40(cut 102)은 완전 통과, threshold 70(cut 178.5)은 니 하단에 살짝 걸침.
    const values = makeBrightCenterRow(9, 4, 150);
    const low = makeGrayRow(values);
    const high = makeGrayRow(values);
    applyGlow(low, { strength: 60, size: 3, threshold: 40, color: "auto" });
    applyGlow(high, { strength: 60, size: 3, threshold: 70, color: "auto" });

    // 임계가 낮을수록 이웃이 받는 빛이 더 크다.
    expect(pixelAt(low, 3)[0]!).toBeGreaterThan(pixelAt(high, 3)[0]!);
    // 임계 70에서 중심(150)은 니 하단에 겨우 걸쳐 글로우가 거의 없다(잔광 ≤ 2).
    expect(pixelAt(high, 3)[0]!).toBeLessThanOrEqual(2);
  });

  it("니 하단(cut-32)보다 어두운 픽셀은 여전히 전혀 추출되지 않는다", () => {
    // 중심 휘도 120, threshold 70 → cut 178.5, 니 시작 146.5 > 120 → 가중 0 → 데이터 불변.
    const values = makeBrightCenterRow(9, 4, 120);
    const img = makeGrayRow(values);
    const before = Array.from(img.data);
    applyGlow(img, { strength: 80, size: 3, threshold: 70, color: "auto" });
    expect(Array.from(img.data)).toEqual(before);
  });
});

describe("applyGlow — 블룸 프로파일 품질(3패스 감쇠)", () => {
  it("임펄스 응답이 중심에서 바깥으로 단조 감소하고 계단 없이 부드럽게 감쇠한다", () => {
    // 가운데 한 픽셀만 밝은 긴 행 — 단일 박스 블러라면 플래토(같은 값 평탄 구간) 후 급락하지만,
    // 연속 3패스 블러는 중심에서 매 픽셀 strictly 감소하는 종형 프로파일을 만든다.
    const W = 21;
    const center = 10;
    const values = makeBrightCenterRow(W, center, 255);
    const img = makeGrayRow(values);
    applyGlow(img, { strength: 100, size: 6, threshold: 30, color: "auto" });

    // 중심 → +1 → +2 → +3 순으로 strictly 감소(플래토·계단 없음).
    const v = (x: number) => pixelAt(img, x)[0]!;
    expect(v(center)).toBeGreaterThan(v(center + 1));
    expect(v(center + 1)).toBeGreaterThan(v(center + 2));
    expect(v(center + 2)).toBeGreaterThan(v(center + 3));
    // 좌우 대칭.
    expect(v(center - 1)).toBe(v(center + 1));
    expect(v(center - 2)).toBe(v(center + 2));
    // 도달 거리는 size를 넘지 않는다(합계 반경 = size 계약).
    expect(v(center + 7)).toBe(0);
    expect(v(center - 7)).toBe(0);
  });
});

describe("applyGlow — color 오버라이드 틴트", () => {
  it('color !== "auto"면 글로우를 그 색으로 칠한다(파란색 → 이웃의 B가 R/G보다 커짐)', () => {
    // 흰 중심(255)이지만 글로우는 파란색으로 칠해진다.
    const values = makeBrightCenterRow(9, 4, 255);
    const blue = makeGrayRow(values);
    applyGlow(blue, { strength: 80, size: 3, threshold: 50, color: "#0000ff" });

    const neighbor = pixelAt(blue, 3);
    // 파란 글로우 — B 채널만 번지고 R/G는 거의 안 오른다.
    expect(neighbor[2]!).toBeGreaterThan(0); // B 번짐
    expect(neighbor[2]!).toBeGreaterThan(neighbor[0]!); // B > R
    expect(neighbor[2]!).toBeGreaterThan(neighbor[1]!); // B > G
  });

  it("auto 글로우는 원색을 번지게 한다(흰 중심 → 이웃 채널 균등 상승)", () => {
    const values = makeBrightCenterRow(9, 4, 255);
    const auto = makeGrayRow(values);
    applyGlow(auto, { strength: 80, size: 3, threshold: 50, color: "auto" });
    const n = pixelAt(auto, 3);
    expect(n[0]!).toBeGreaterThan(0);
    expect(n[0]!).toBe(n[1]!); // 무채색 원본이라 R=G=B
    expect(n[1]!).toBe(n[2]!);
  });
});

describe("applyGlow — 알파 보존 / 작은 이미지 안전", () => {
  it("알파 채널은 보존된다", () => {
    const img = makeImage(3, 1, [
      [255, 255, 255, 12],
      [255, 255, 255, 128],
      [10, 10, 10, 200],
    ]);
    applyGlow(img, { strength: 70, size: 5, threshold: 30, color: "#00e5ff" });
    expect(pixelAt(img, 0)[3]).toBe(12);
    expect(pixelAt(img, 1)[3]).toBe(128);
    expect(pixelAt(img, 2)[3]).toBe(200);
  });

  it("1x1 이미지에 큰 반경을 줘도 throw 없이 안전", () => {
    const one = makeImage(1, 1, [[255, 255, 255, 255]]);
    expect(() => applyGlow(one, { strength: 70, size: 40, threshold: 10, color: "auto" })).not.toThrow();
    expect(pixelAt(one, 0)[3]).toBe(255);
  });

  it("0 크기 이미지는 no-op (throw 없음)", () => {
    const empty: StudioImageDataLike = { data: new Uint8ClampedArray(0), width: 0, height: 0 };
    expect(() => applyGlow(empty, { strength: 50, size: 10, threshold: 50, color: "auto" })).not.toThrow();
  });
});

describe("GLOW_PRESETS", () => {
  it("첫 항목은 기본(항등) 프리셋", () => {
    expect(GLOW_PRESETS.length).toBeGreaterThan(0);
    expect(isIdentityGlow(GLOW_PRESETS[0]!.value)).toBe(true);
  });

  it("id가 모두 고유하다", () => {
    const ids = GLOW_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("모든 value가 범위 안이고 color는 auto/#rrggbb (normalizeGlow 통과)", () => {
    for (const preset of GLOW_PRESETS) {
      const v = preset.value;
      expect(v.strength).toBeGreaterThanOrEqual(GLOW_STRENGTH_RANGE.min);
      expect(v.strength).toBeLessThanOrEqual(GLOW_STRENGTH_RANGE.max);
      expect(v.size).toBeGreaterThanOrEqual(GLOW_SIZE_RANGE.min);
      expect(v.size).toBeLessThanOrEqual(GLOW_SIZE_RANGE.max);
      expect(v.threshold).toBeGreaterThanOrEqual(GLOW_THRESHOLD_RANGE.min);
      expect(v.threshold).toBeLessThanOrEqual(GLOW_THRESHOLD_RANGE.max);
      expect(v.color === "auto" || /^#[0-9a-f]{6}$/.test(v.color)).toBe(true);
      // 정규화 멱등: 프리셋 value는 이미 normalizeGlow를 통과한 형태.
      expect(normalizeGlow(v)).toEqual(v);
    }
  });

  it("기대한 프리셋(은은한 빛/강한 광채/네온/드림/햇살)이 사양대로 들어 있다", () => {
    const byId = Object.fromEntries(GLOW_PRESETS.map((p) => [p.id, p.value]));
    expect(byId.subtle).toMatchObject({ strength: 30 });
    expect(byId.radiant).toMatchObject({ strength: 70, size: 20 });
    expect(byId.neon).toMatchObject({ strength: 60, color: "#00e5ff" });
    expect(byId.dream).toMatchObject({ strength: 45, size: 28, threshold: 45 });
    expect(byId.sunshine).toMatchObject({ strength: 50, color: "#ffcf6b" });
  });
});

describe("glowKonvaFilter", () => {
  it("attrs의 glow* 값을 읽어 ImageData를 실제로 변형한다(이웃으로 번짐)", () => {
    const values = makeBrightCenterRow(9, 4, 200);
    const img = makeGrayRow(values);
    glowKonvaFilter.call(
      { attrs: { glowStrength: 60, glowSize: 3, glowThreshold: 50, glowColor: "auto" } },
      img
    );
    expect(pixelAt(img, 3)[0]!).toBeGreaterThan(0); // 번짐 발생
    expect(pixelAt(img, 4)[0]!).toBeGreaterThan(200); // 중심 밝아짐
  });

  it("glowColor 틴트도 attrs 경로로 반영된다", () => {
    const values = makeBrightCenterRow(9, 4, 255);
    const img = makeGrayRow(values);
    glowKonvaFilter.call(
      { attrs: { glowStrength: 80, glowSize: 3, glowThreshold: 50, glowColor: "#0000ff" } },
      img
    );
    const n = pixelAt(img, 3);
    expect(n[2]!).toBeGreaterThan(n[0]!); // B > R
  });

  it("attrs 누락 / strength 0 / 무효 strength면 no-op", () => {
    const values = makeBrightCenterRow(9, 4, 200);

    // attrs 자체 없음
    const a = makeGrayRow(values);
    const aBefore = Array.from(a.data);
    glowKonvaFilter.call({}, a);
    expect(Array.from(a.data)).toEqual(aBefore);

    // strength 0
    const b = makeGrayRow(values);
    const bBefore = Array.from(b.data);
    glowKonvaFilter.call({ attrs: { glowStrength: 0, glowSize: 3, glowThreshold: 50 } }, b);
    expect(Array.from(b.data)).toEqual(bBefore);

    // strength 무효(숫자 아님) → 기본 strength 0 → no-op
    const c = makeGrayRow(values);
    const cBefore = Array.from(c.data);
    glowKonvaFilter.call({ attrs: { glowStrength: "60" as unknown as number, glowSize: 3 } }, c);
    expect(Array.from(c.data)).toEqual(cBefore);
  });
});
