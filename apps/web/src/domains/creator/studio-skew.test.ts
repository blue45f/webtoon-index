import { describe, expect, it } from "vitest";

import {
  SKEW_MAX_DEG,
  SKEW_MIN_DEG,
  SKEW_RANGE,
  SKEW_SNAP_ANGLES,
  SKEW_SNAP_TOLERANCE_DEG,
  clampSkewDeg,
  isIdentitySkew,
  nearestSkewSnapAngle,
  normalizeSkewPatch,
  serializeSkewValue,
  skewDegToKonva,
  snapSkewDeg,
  toKonvaSkewAttrs,
} from "./studio-skew";

describe("studio-skew: 범위·스냅 상수", () => {
  it("한계각은 ±60°, 슬라이더 범위는 1° 단위다", () => {
    expect(SKEW_MAX_DEG).toBe(60);
    expect(SKEW_MIN_DEG).toBe(-60);
    expect(SKEW_RANGE).toEqual({ min: -60, max: 60, step: 1 });
  });

  it("스냅 각은 0/±15/±30/±45 오름차순 7개다", () => {
    expect(SKEW_SNAP_ANGLES).toEqual([-45, -30, -15, 0, 15, 30, 45]);
    expect([...SKEW_SNAP_ANGLES].sort((a, b) => a - b)).toEqual([...SKEW_SNAP_ANGLES]);
  });
});

describe("clampSkewDeg: 도 단위 클램프·정규화", () => {
  it("범위 안 값은 그대로 통과한다", () => {
    expect(clampSkewDeg(0)).toBe(0);
    expect(clampSkewDeg(15)).toBe(15);
    expect(clampSkewDeg(-45)).toBe(-45);
    expect(clampSkewDeg(60)).toBe(60);
    expect(clampSkewDeg(-60)).toBe(-60);
  });

  it("범위 밖은 ±60으로 클램프한다", () => {
    expect(clampSkewDeg(61)).toBe(60);
    expect(clampSkewDeg(999)).toBe(60);
    expect(clampSkewDeg(-90)).toBe(-60);
  });

  it("비유한수(NaN/±Infinity)는 0(항등)으로 떨어진다", () => {
    expect(clampSkewDeg(Number.NaN)).toBe(0);
    expect(clampSkewDeg(Infinity)).toBe(0);
    expect(clampSkewDeg(-Infinity)).toBe(0);
  });

  it("소수 첫째 자리로 반올림하고 -0은 0으로 정규화한다", () => {
    expect(clampSkewDeg(12.34)).toBe(12.3);
    expect(clampSkewDeg(12.35)).toBe(12.4);
    expect(clampSkewDeg(-0.04)).toBe(0);
    expect(Object.is(clampSkewDeg(-0.04), -0)).toBe(false);
  });
});

describe("skewDegToKonva: 도 → Konva tangent 계수", () => {
  // Konva 10 은 skewX/skewY 를 각도가 아니라 전단(tangent) 계수로 행렬에 그대로 곱한다
  // (Transform.skew — konva/lib/Util.js). CSS skewX(45deg) == Konva skewX: tan(45°)=1.
  it("45° → 1, 30° → tan(30°), 0° → 정확히 0 (tangent 단위 계약)", () => {
    expect(skewDegToKonva(45)).toBeCloseTo(1, 10);
    expect(skewDegToKonva(30)).toBeCloseTo(Math.tan(Math.PI / 6), 10);
    expect(skewDegToKonva(0)).toBe(0);
  });

  it("부호를 보존한다(음수 각 → 음수 계수)", () => {
    expect(skewDegToKonva(-45)).toBeCloseTo(-1, 10);
    expect(skewDegToKonva(-15)).toBeLessThan(0);
  });

  it("범위 밖 각은 클램프 후 변환한다(±60° 초과 발산 방지)", () => {
    expect(skewDegToKonva(89)).toBeCloseTo(Math.tan(Math.PI / 3), 10); // tan(60°) ≈ 1.732
    expect(skewDegToKonva(-999)).toBeCloseTo(-Math.tan(Math.PI / 3), 10);
    expect(skewDegToKonva(Number.NaN)).toBe(0);
  });
});

describe("toKonvaSkewAttrs: El 필드 → 노드 attrs", () => {
  it("미설정 필드는 0으로 명시 반환한다(리셋 잔존 방지)", () => {
    expect(toKonvaSkewAttrs({})).toEqual({ skewX: 0, skewY: 0 });
    expect(toKonvaSkewAttrs({ skewX: undefined, skewY: undefined })).toEqual({ skewX: 0, skewY: 0 });
  });

  it("각 축을 독립적으로 tangent 로 변환한다", () => {
    const attrs = toKonvaSkewAttrs({ skewX: 45, skewY: -30 });
    expect(attrs.skewX).toBeCloseTo(1, 10);
    expect(attrs.skewY).toBeCloseTo(-Math.tan(Math.PI / 6), 10);
  });
});

describe("isIdentitySkew: 항등 판정", () => {
  it("미설정/0/반올림상 0은 모두 항등이다", () => {
    expect(isIdentitySkew({})).toBe(true);
    expect(isIdentitySkew({ skewX: 0, skewY: 0 })).toBe(true);
    expect(isIdentitySkew({ skewX: 0.04 })).toBe(true); // 0.1° 미만은 반올림상 0
  });

  it("한 축이라도 기울면 항등이 아니다", () => {
    expect(isIdentitySkew({ skewX: 15 })).toBe(false);
    expect(isIdentitySkew({ skewY: -1 })).toBe(false);
  });
});

describe("serializeSkewValue / normalizeSkewPatch: 직렬화 옵셔널 필드 규약", () => {
  it("0(항등)은 undefined — 문서에 저장하지 않는다", () => {
    expect(serializeSkewValue(0)).toBeUndefined();
    expect(serializeSkewValue(Number.NaN)).toBeUndefined();
    expect(serializeSkewValue(15)).toBe(15);
    expect(serializeSkewValue(999)).toBe(60);
    expect(serializeSkewValue(-999)).toBe(-60);
  });

  it("normalizeSkewPatch 는 들어온 축만 정규화한다(부분 패치 보존)", () => {
    expect(normalizeSkewPatch({ skewX: 30 })).toEqual({ skewX: 30 });
    expect("skewY" in normalizeSkewPatch({ skewX: 30 })).toBe(false);
    expect(normalizeSkewPatch({ skewX: 75, skewY: -75 })).toEqual({ skewX: 60, skewY: -60 });
  });

  it("항등(0) 축은 키를 유지한 채 undefined 로 비운다 — 스프레드 병합에서 기존 값을 지운다", () => {
    const patch = normalizeSkewPatch({ skewX: 0 });
    expect("skewX" in patch).toBe(true);
    expect(patch.skewX).toBeUndefined();
    // patchEl 의 { ...el, ...patch } 병합 계약: 기존 skewX 가 undefined 로 덮인다.
    const merged = { skewX: 30, skewY: 10, ...patch };
    expect(merged.skewX).toBeUndefined();
    expect(merged.skewY).toBe(10);
    // JSON 직렬화 시 undefined 키는 떨어진다(문서 하위 호환).
    expect(JSON.parse(JSON.stringify(merged))).toEqual({ skewY: 10 });
  });
});

describe("nearestSkewSnapAngle / snapSkewDeg: 스냅 헬퍼", () => {
  it("가장 가까운 스냅 각을 찾는다", () => {
    expect(nearestSkewSnapAngle(14)).toBe(15);
    expect(nearestSkewSnapAngle(-29)).toBe(-30);
    expect(nearestSkewSnapAngle(2)).toBe(0);
    expect(nearestSkewSnapAngle(60)).toBe(45);
  });

  it("허용 오차(기본 4°) 안이면 흡착, 밖이면 원값을 유지한다", () => {
    expect(SKEW_SNAP_TOLERANCE_DEG).toBe(4);
    expect(snapSkewDeg(14)).toBe(15);
    expect(snapSkewDeg(-43)).toBe(-45);
    expect(snapSkewDeg(3)).toBe(0);
    expect(snapSkewDeg(22)).toBe(22); // 15와 30 모두 7° 밖 — 자유 조작 보존
    expect(snapSkewDeg(60)).toBe(60); // 45에서 15° 밖
  });

  it("tolerance 를 넓히면 더 멀리서도 흡착한다", () => {
    expect(snapSkewDeg(22, 8)).toBe(15); // 15가 7°로 30(8°)보다 가깝다
    expect(snapSkewDeg(52, 8)).toBe(45);
    expect(snapSkewDeg(52, 4)).toBe(52);
  });

  it("스냅 입력도 먼저 클램프한다", () => {
    expect(snapSkewDeg(999)).toBe(60);
    expect(snapSkewDeg(Number.NaN)).toBe(0); // 비유한수 → 0(항등) → 스냅 0
  });
});
