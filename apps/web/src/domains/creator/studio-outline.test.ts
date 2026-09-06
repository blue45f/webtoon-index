import { describe, expect, it } from "vitest";

import {
  DEFAULT_OUTLINE,
  DEFAULT_OUTLINE_SECOND_COLOR,
  OUTLINE_FEATHER_PX,
  OUTLINE_OPACITY_RANGE,
  OUTLINE_PRESETS,
  OUTLINE_WIDTH_RANGE,
  applyOutline,
  isIdentityOutline,
  normalizeOutline,
  outlineCachePad,
  outlineKonvaFilter,
  outlineTotalWidth,
  type Outline,
} from "./studio-outline";

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

/**
 * 가운데 2x2가 불투명(opaqueColor, alpha=255)이고 둘레가 투명한 4x4 이미지.
 * 인덱스: (x,y) → y*4+x. 불투명 블록은 (1,1)(2,1)(1,2)(2,2).
 */
function makeBlockImage(opaqueColor: [number, number, number]): StudioImageDataLike {
  const pixels: number[][] = [];
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const opaque = (x === 1 || x === 2) && (y === 1 || y === 2);
      pixels.push(opaque ? [...opaqueColor, 255] : [0, 0, 0, 0]);
    }
  }
  return makeImage(4, 4, pixels);
}

const at = (x: number, y: number) => y * 4 + x;

describe("DEFAULT_OUTLINE / isIdentityOutline", () => {
  it("기본값은 흰색·두께0·불투명100인 항등(두께0이라 아무것도 안 그림)", () => {
    expect(DEFAULT_OUTLINE).toEqual({ color: "#ffffff", width: 0, opacity: 100 });
    expect(isIdentityOutline(DEFAULT_OUTLINE)).toBe(true);
  });

  it("기본값은 레거시 3키 형태 그대로다(secondColor/secondWidth 키 없음 — 저장본 바이트 동일성)", () => {
    expect(Object.keys(DEFAULT_OUTLINE).sort()).toEqual(["color", "opacity", "width"]);
  });

  it("두께>0이고 불투명도>0이면 항등이 아니다", () => {
    expect(isIdentityOutline({ color: "#ffffff", width: 8, opacity: 100 })).toBe(false);
  });

  it("두께0 또는 불투명도0이면 항등", () => {
    expect(isIdentityOutline({ color: "#ffffff", width: 0, opacity: 100 })).toBe(true);
    expect(isIdentityOutline({ color: "#ffffff", width: 10, opacity: 0 })).toBe(true);
  });

  // 이중 외곽선 — width 0이어도 2차 링이 있으면 그려지므로 항등이 아니다.
  it("width0이어도 secondWidth>0이면 항등이 아니다(2차 링 단독 활성)", () => {
    expect(isIdentityOutline({ color: "#ffffff", width: 0, opacity: 100, secondColor: "#000000", secondWidth: 3 })).toBe(
      false
    );
    expect(isIdentityOutline({ color: "#ffffff", width: 0, opacity: 100, secondColor: "#000000", secondWidth: 0 })).toBe(
      true
    );
    // 불투명도 0이면 링이 몇 개든 항등.
    expect(isIdentityOutline({ color: "#ffffff", width: 4, opacity: 0, secondColor: "#000000", secondWidth: 3 })).toBe(
      true
    );
  });
});

describe("outlineTotalWidth", () => {
  it("1차+2차 링 합계(누락/음수 2차는 0)", () => {
    expect(outlineTotalWidth({ color: "#ffffff", width: 6, opacity: 100 })).toBe(6);
    expect(outlineTotalWidth({ color: "#ffffff", width: 6, opacity: 100, secondColor: "#000000", secondWidth: 3 })).toBe(9);
    expect(outlineTotalWidth({ color: "#ffffff", width: 0, opacity: 100, secondColor: "#000000", secondWidth: 5 })).toBe(5);
  });
});

describe("OUTLINE_WIDTH_RANGE / OUTLINE_OPACITY_RANGE", () => {
  // 의도적 변경(2026-07): 두께 상한 30→60 — 스티커급 두꺼운 테두리용. 거리 변환이 O(n)이라
  // 두께가 커져도 비용은 선형(성능 회귀 없음). 1차/2차 링이 같은 범위를 공유한다.
  it("두께 범위는 0..60, step 1", () => {
    expect(OUTLINE_WIDTH_RANGE).toEqual({ min: 0, max: 60, step: 1 });
  });
  it("불투명도 범위는 0..100, step 1", () => {
    expect(OUTLINE_OPACITY_RANGE).toEqual({ min: 0, max: 100, step: 1 });
  });
  it("AA 페더는 1px(캐시 패딩에 포함)", () => {
    expect(OUTLINE_FEATHER_PX).toBe(1);
  });
});

describe("normalizeOutline", () => {
  it("undefined/null → 기본값", () => {
    expect(normalizeOutline()).toEqual(DEFAULT_OUTLINE);
    expect(normalizeOutline(null)).toEqual(DEFAULT_OUTLINE);
  });

  it("누락 키는 기본값으로 채운다", () => {
    expect(normalizeOutline({ width: 8 })).toEqual({ color: "#ffffff", width: 8, opacity: 100 });
    expect(normalizeOutline({ color: "#123456" })).toEqual({ color: "#123456", width: 0, opacity: 100 });
  });

  it("범위 밖 width/opacity는 각 범위로 클램프", () => {
    // 의도적 변경(2026-07): 두께 상한 30→60 확장에 맞춰 클램프 상한도 60.
    expect(normalizeOutline({ width: 999, opacity: 999 })).toEqual({ color: "#ffffff", width: 60, opacity: 100 });
    expect(normalizeOutline({ width: -50, opacity: -50 })).toEqual({ color: "#ffffff", width: 0, opacity: 0 });
  });

  // --- 저장본 바이트 동일성 회귀 잠금 — 레거시(3키) 설정은 정규화를 지나도 형태가 그대로다. ---
  it("2차 링 데이터가 없는 레거시 입력은 3키 형태 그대로 반환(새 키 주입 금지)", () => {
    const legacy = { color: "#123456", width: 8, opacity: 50 };
    const out = normalizeOutline(legacy);
    expect(out).toEqual(legacy);
    expect(Object.keys(out).sort()).toEqual(["color", "opacity", "width"]);
    // JSON 직렬화까지 동일 — 문서 저장본/CRDT 패치가 변하지 않는다.
    expect(JSON.stringify(out)).toBe(JSON.stringify({ color: "#123456", width: 8, opacity: 50 }));
  });

  it("secondWidth가 있으면 secondColor/secondWidth 두 키를 모두 채워 반환", () => {
    expect(normalizeOutline({ width: 4, secondWidth: 3 })).toEqual({
      color: "#ffffff",
      width: 4,
      opacity: 100,
      secondColor: DEFAULT_OUTLINE_SECOND_COLOR,
      secondWidth: 3,
    });
  });

  it("secondColor만 있어도 두 키를 채운다(secondWidth 0 — 색 선택을 잃지 않음)", () => {
    expect(normalizeOutline({ secondColor: "#ff0000" })).toEqual({
      color: "#ffffff",
      width: 0,
      opacity: 100,
      secondColor: "#ff0000",
      secondWidth: 0,
    });
  });

  it("무효 secondColor는 기본 검정, 범위 밖 secondWidth는 클램프", () => {
    expect(normalizeOutline({ secondColor: "red", secondWidth: 3 }).secondColor).toBe(DEFAULT_OUTLINE_SECOND_COLOR);
    expect(normalizeOutline({ secondWidth: 999 }).secondWidth).toBe(60);
    expect(normalizeOutline({ secondWidth: -5 }).secondWidth).toBe(0);
    // NaN secondWidth + 무효 secondColor → 2차 링 데이터 없음으로 보고 레거시 형태.
    const out = normalizeOutline({ width: 2, secondWidth: Number.NaN, secondColor: 7 as unknown as string });
    expect(Object.keys(out).sort()).toEqual(["color", "opacity", "width"]);
  });

  it("#rrggbb가 아닌 color는 기본 흰색으로 되돌린다", () => {
    expect(normalizeOutline({ color: "red" }).color).toBe("#ffffff");
    expect(normalizeOutline({ color: "#abc" }).color).toBe("#ffffff"); // 3자리 단축형은 거부
    expect(normalizeOutline({ color: 123 as unknown as string }).color).toBe("#ffffff");
    expect(normalizeOutline({ color: "#AABBCC" }).color).toBe("#AABBCC"); // 대문자 6자리는 허용
  });

  it("숫자가 아닌 width/opacity는 기본값", () => {
    const out = normalizeOutline({
      width: "8" as unknown as number,
      opacity: Number.NaN,
    });
    expect(out).toEqual({ color: "#ffffff", width: 0, opacity: 100 });
    expect(normalizeOutline({ width: Number.POSITIVE_INFINITY }).width).toBe(0);
  });
});

describe("applyOutline — 항등/no-op", () => {
  it("두께0이면 no-op (데이터 불변)", () => {
    const img = makeBlockImage([200, 0, 0]);
    const before = Array.from(img.data);
    applyOutline(img, normalizeOutline({ color: "#00ff00", width: 0, opacity: 100 }));
    expect(Array.from(img.data)).toEqual(before);
  });

  it("불투명도0이면 no-op (데이터 불변)", () => {
    const img = makeBlockImage([200, 0, 0]);
    const before = Array.from(img.data);
    applyOutline(img, normalizeOutline({ color: "#00ff00", width: 6, opacity: 0 }));
    expect(Array.from(img.data)).toEqual(before);
  });

  it("불투명 픽셀이 하나도 없으면 자랄 실루엣이 없어 no-op", () => {
    const img = makeImage(3, 3, Array.from({ length: 9 }, () => [10, 20, 30, 0]));
    const before = Array.from(img.data);
    applyOutline(img, normalizeOutline({ color: "#00ff00", width: 5, opacity: 100 }));
    expect(Array.from(img.data)).toEqual(before);
  });
});

describe("applyOutline — 실루엣 바깥 테두리(알파 팽창)", () => {
  it("width=1은 블록에 바로 붙은 투명 픽셀을 테두리 색으로 채운다(불투명 블록은 불변)", () => {
    const img = makeBlockImage([200, 0, 0]);
    applyOutline(img, normalizeOutline({ color: "#00ff00", width: 1, opacity: 100 }));

    // 불투명 2x2 블록은 r/g/b·alpha 모두 그대로.
    for (const [x, y] of [
      [1, 1],
      [2, 1],
      [1, 2],
      [2, 2],
    ]) {
      expect(pixelAt(img, at(x!, y!))).toEqual([200, 0, 0, 255]);
    }

    // 블록과 변을 맞댄(거리^2=1) 투명 픽셀은 테두리 초록·alpha>0.
    for (const [x, y] of [
      [0, 1],
      [0, 2], // 왼쪽 변
      [3, 1],
      [3, 2], // 오른쪽 변
      [1, 0],
      [2, 0], // 위쪽 변
      [1, 3],
      [2, 3], // 아래쪽 변
    ]) {
      const px = pixelAt(img, at(x!, y!));
      expect(px[0]).toBe(0);
      expect(px[1]).toBe(255);
      expect(px[2]).toBe(0);
      expect(px[3]).toBeGreaterThan(0);
      expect(px[3]).toBe(255); // opacity 100 → alpha 255
    }
  });

  // 의도적 변경(2026-07): 하드 임계 → AA 페더. 코너(dist=√2)는 이제 "반경 밖 미채색"이 아니라
  // 링 바깥 1px 페더 밴드에서 거리 램프 알파(coverage=total+1-dist)를 받는다 — 계단 현상 제거.
  it("width=1에서 대각 코너(dist=√2)는 AA 페더로 부분 알파를 받는다", () => {
    const img = makeBlockImage([200, 0, 0]);
    applyOutline(img, normalizeOutline({ color: "#00ff00", width: 1, opacity: 100 }));
    // coverage = (1+1) - √2 ≈ 0.5858 → alpha = round(255*0.5858) = 149. 색은 테두리 초록.
    const expectedAlpha = Math.round(255 * (2 - Math.SQRT2));
    expect(expectedAlpha).toBe(149);
    for (const [x, y] of [
      [0, 0],
      [3, 0],
      [0, 3],
      [3, 3],
    ]) {
      expect(pixelAt(img, at(x!, y!))).toEqual([0, 255, 0, expectedAlpha]);
    }
  });

  it("width를 키우면 더 멀리(코너까지) 테두리가 자란다", () => {
    const img = makeBlockImage([200, 0, 0]);
    applyOutline(img, normalizeOutline({ color: "#00ff00", width: 2, opacity: 100 }));
    // 거리^2=2 <= 2^2=4 → 코너도 이제 테두리.
    const corner = pixelAt(img, at(0, 0));
    expect(corner[1]).toBe(255);
    expect(corner[3]).toBeGreaterThan(0);
  });

  it("opacity가 테두리 링의 알파를 정한다(255*opacity/100)", () => {
    const img = makeBlockImage([200, 0, 0]);
    applyOutline(img, normalizeOutline({ color: "#00ff00", width: 1, opacity: 40 }));
    // round(255*40/100)=round(102)=102.
    expect(pixelAt(img, at(0, 1))[3]).toBe(102);
    // 불투명 블록의 알파(255)는 영향 없음.
    expect(pixelAt(img, at(1, 1))[3]).toBe(255);
  });

  it("원본 불투명 픽셀의 색·알파를 절대 바꾸지 않는다(알파 보존)", () => {
    // 알파가 정확히 임계(128)인 픽셀도 불투명으로 간주되어 보존된다.
    const img = makeImage(3, 1, [
      [10, 20, 30, 0], // 투명
      [90, 110, 130, 128], // 불투명 경계
      [40, 50, 60, 0], // 투명
    ]);
    applyOutline(img, normalizeOutline({ color: "#ffffff", width: 1, opacity: 100 }));
    // 가운데 불투명(>=128)은 그대로.
    expect(pixelAt(img, 1)).toEqual([90, 110, 130, 128]);
    // 양옆 투명은 테두리 흰색으로.
    expect(pixelAt(img, 0)).toEqual([255, 255, 255, 255]);
    expect(pixelAt(img, 2)).toEqual([255, 255, 255, 255]);
  });

  it("반투명(<128) 픽셀도 테두리 후보다(불투명으로 안 침)", () => {
    const img = makeImage(3, 1, [
      [10, 20, 30, 127], // 반투명(임계 미만) → 후보
      [0, 0, 0, 255], // 불투명 시드
      [40, 50, 60, 100], // 반투명 → 후보
    ]);
    applyOutline(img, normalizeOutline({ color: "#00ff00", width: 1, opacity: 100 }));
    // 불투명 시드는 보존.
    expect(pixelAt(img, 1)).toEqual([0, 0, 0, 255]);
    // 양옆 반투명은 테두리로 덮인다.
    expect(pixelAt(img, 0)).toEqual([0, 255, 0, 255]);
    expect(pixelAt(img, 2)).toEqual([0, 255, 0, 255]);
  });

  it("0 크기 이미지에서도 throw 없이 no-op", () => {
    const img = makeImage(0, 0, []);
    expect(() => applyOutline(img, normalizeOutline({ width: 5, opacity: 100 }))).not.toThrow();
    expect(img.data.length).toBe(0);
  });
});

describe("applyOutline — AA 페더(레거시 추가 전용 회귀 잠금)", () => {
  // 회귀 잠금: AA 페더는 "추가"만 한다 — 레거시 하드 임계 알고리즘(distSq<=width²)이 칠하던
  // 모든 픽셀은 바이트 단위로 동일하고(전부 ringAlpha·테두리 색), 실루엣도 그대로다.
  // 새로 칠해지는 픽셀은 링 바깥 1px 페더 밴드뿐이며 알파가 항상 ringAlpha 미만이다.
  it("레거시가 칠하던 픽셀(dist<=width)·실루엣은 바이트 동일, 페더만 새로 얹힌다", () => {
    const img = makeBlockImage([200, 0, 0]);
    applyOutline(img, normalizeOutline({ color: "#00ff00", width: 1, opacity: 100 }));

    // 실루엣(불투명 2x2): 레거시와 동일하게 완전 보존.
    for (const [x, y] of [[1, 1], [2, 1], [1, 2], [2, 2]] as const) {
      expect(pixelAt(img, at(x, y))).toEqual([200, 0, 0, 255]);
    }
    // 레거시 링(dist=1인 변 8픽셀): 레거시와 동일한 풀 알파 테두리.
    for (const [x, y] of [[0, 1], [0, 2], [3, 1], [3, 2], [1, 0], [2, 0], [1, 3], [2, 3]] as const) {
      expect(pixelAt(img, at(x, y))).toEqual([0, 255, 0, 255]);
    }
    // 페더(코너 4픽셀): 새로 얹힌 픽셀은 전부 알파 < ringAlpha(255).
    for (const [x, y] of [[0, 0], [3, 0], [0, 3], [3, 3]] as const) {
      const px = pixelAt(img, at(x, y));
      expect(px[3]).toBeGreaterThan(0);
      expect(px[3]).toBeLessThan(255);
    }
  });

  it("페더 알파는 opacity에 비례한다(ringAlpha * coverage)", () => {
    const img = makeBlockImage([200, 0, 0]);
    applyOutline(img, normalizeOutline({ color: "#00ff00", width: 1, opacity: 40 }));
    // ringAlpha = round(255*40/100) = 102; 코너 coverage = 2-√2 → round(102*0.5858) = 60.
    expect(pixelAt(img, at(0, 0))[3]).toBe(Math.round(102 * (2 - Math.SQRT2)));
    expect(pixelAt(img, at(0, 0))[3]).toBe(60);
  });

  it("페더는 기존 픽셀 알파가 더 강하면 덮지 않는다(반투명 원본 보존)", () => {
    // 코너(0,0)에 페더 알파(60)보다 강한 반투명(120<128 → 여전히 테두리 후보) 픽셀을 둔다.
    const img = makeBlockImage([200, 0, 0]);
    img.data.set([10, 20, 30, 120], at(0, 0) * 4);
    applyOutline(img, normalizeOutline({ color: "#00ff00", width: 1, opacity: 40 }));
    // 페더 밴드(코너)는 60 <= 120이라 보존, 솔리드 링(변)은 레거시대로 무조건 덮어쓴다.
    expect(pixelAt(img, at(0, 0))).toEqual([10, 20, 30, 120]);
    expect(pixelAt(img, at(0, 1))).toEqual([0, 255, 0, 102]);
  });

  it("페더 경계(dist=total+1)에서는 coverage 0이라 칠하지 않는다", () => {
    // 9x1: 불투명 x=4, width=1·second=2 → total=3. x0/x8은 dist=4=total+1 → 미채색.
    const pixels = Array.from({ length: 9 }, (_, x) => (x === 4 ? [0, 0, 0, 255] : [0, 0, 0, 0]));
    const img = makeImage(9, 1, pixels);
    applyOutline(
      img,
      normalizeOutline({ color: "#ffffff", width: 1, opacity: 100, secondColor: "#000000", secondWidth: 2 })
    );
    expect(pixelAt(img, 0)).toEqual([0, 0, 0, 0]);
    expect(pixelAt(img, 8)).toEqual([0, 0, 0, 0]);
  });
});

describe("applyOutline — 이중 외곽선(2차 링)", () => {
  it("1차 링 안쪽은 color, 그 바깥 2차 링은 secondColor로 칠한다", () => {
    // 7x1: 불투명 x=3. dist: x2/x4=1, x1/x5=2, x0/x6=3. width=1, secondWidth=2 → total=3.
    const pixels = Array.from({ length: 7 }, (_, x) => (x === 3 ? [9, 9, 9, 255] : [0, 0, 0, 0]));
    const img = makeImage(7, 1, pixels);
    applyOutline(
      img,
      normalizeOutline({ color: "#ffffff", width: 1, opacity: 100, secondColor: "#000000", secondWidth: 2 })
    );
    // 실루엣 보존.
    expect(pixelAt(img, 3)).toEqual([9, 9, 9, 255]);
    // 1차 링(dist=1): 흰색 풀 알파.
    expect(pixelAt(img, 2)).toEqual([255, 255, 255, 255]);
    expect(pixelAt(img, 4)).toEqual([255, 255, 255, 255]);
    // 2차 링(dist=2,3): 경계 1px 블렌드 구간(t=min(1,dist-width))을 지나 순수 검정.
    for (const i of [1, 5, 0, 6]) {
      expect(pixelAt(img, i)).toEqual([0, 0, 0, 255]);
    }
  });

  it("링 경계 1px는 color→secondColor 거리 블렌드로 잇는다(코너 dist=√2)", () => {
    // 4x4 블록: 코너 dist=√2 ∈ (1,2] → t=√2-1≈0.414 → 검정→흰 블렌드 회색.
    const img = makeBlockImage([200, 0, 0]);
    applyOutline(
      img,
      normalizeOutline({ color: "#000000", width: 1, opacity: 100, secondColor: "#ffffff", secondWidth: 1 })
    );
    const t = Math.SQRT2 - 1;
    const mixed = Math.round(255 * t);
    expect(mixed).toBe(106);
    expect(pixelAt(img, at(0, 0))).toEqual([mixed, mixed, mixed, 255]);
    // 1차 링(변, dist=1)은 순수 검정.
    expect(pixelAt(img, at(0, 1))).toEqual([0, 0, 0, 255]);
  });

  it("width=0이어도 secondWidth>0이면 실루엣에 붙여 2차 링을 그린다", () => {
    const img = makeBlockImage([200, 0, 0]);
    applyOutline(
      img,
      normalizeOutline({ color: "#ffffff", width: 0, opacity: 100, secondColor: "#112233", secondWidth: 1 })
    );
    // 변 픽셀(dist=1)은 2차 링 색(t=min(1,1-0)=1 → 순수 secondColor).
    expect(pixelAt(img, at(0, 1))).toEqual([0x11, 0x22, 0x33, 255]);
  });

  it("2차 링의 알파도 공통 opacity를 따른다", () => {
    const pixels = Array.from({ length: 7 }, (_, x) => (x === 3 ? [0, 0, 0, 255] : [0, 0, 0, 0]));
    const img = makeImage(7, 1, pixels);
    applyOutline(
      img,
      normalizeOutline({ color: "#ffffff", width: 1, opacity: 40, secondColor: "#000000", secondWidth: 2 })
    );
    // round(255*40/100)=102 — 1차/2차 링 모두 동일.
    expect(pixelAt(img, 2)[3]).toBe(102);
    expect(pixelAt(img, 1)[3]).toBe(102);
  });
});

describe("OUTLINE_PRESETS", () => {
  it("첫 항목은 none/없음 항등(width0)", () => {
    const first = OUTLINE_PRESETS[0]!;
    expect(first.id).toBe("none");
    expect(first.label).toBe("없음");
    expect(first.value.width).toBe(0);
    expect(isIdentityOutline(first.value)).toBe(true);
  });

  it("나머지 프리셋은 모두 width>0(실제로 테두리가 그려짐)", () => {
    for (const p of OUTLINE_PRESETS.slice(1)) {
      expect(p.value.width).toBeGreaterThan(0);
      expect(isIdentityOutline(p.value)).toBe(false);
    }
  });

  it("프리셋이 6개 내외다", () => {
    expect(OUTLINE_PRESETS.length).toBeGreaterThanOrEqual(6);
  });

  it("id는 모두 고유하다", () => {
    const ids = OUTLINE_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("value도 (색·width·opacity·2차 링 조합으로) 모두 고유하다", () => {
    // 이중 외곽선 프리셋이 생기면서 고유 키에 secondColor/secondWidth도 포함한다.
    const keys = OUTLINE_PRESETS.map(
      (p) => `${p.value.color}|${p.value.width}|${p.value.opacity}|${p.value.secondColor ?? ""}|${p.value.secondWidth ?? 0}`
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("label/tip은 비어있지 않다", () => {
    for (const p of OUTLINE_PRESETS) {
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.tip.length).toBeGreaterThan(0);
    }
  });

  it("모든 value가 normalizeOutline와 동일(색 #rrggbb·범위 안)", () => {
    for (const p of OUTLINE_PRESETS) {
      expect(p.value).toEqual(normalizeOutline(p.value));
      expect(p.value.width).toBeGreaterThanOrEqual(OUTLINE_WIDTH_RANGE.min);
      expect(p.value.width).toBeLessThanOrEqual(OUTLINE_WIDTH_RANGE.max);
      expect(p.value.opacity).toBeGreaterThanOrEqual(OUTLINE_OPACITY_RANGE.min);
      expect(p.value.opacity).toBeLessThanOrEqual(OUTLINE_OPACITY_RANGE.max);
      // 2차 링을 쓰는 프리셋도 같은 두께 범위 안이어야 한다.
      expect(p.value.secondWidth ?? 0).toBeGreaterThanOrEqual(OUTLINE_WIDTH_RANGE.min);
      expect(p.value.secondWidth ?? 0).toBeLessThanOrEqual(OUTLINE_WIDTH_RANGE.max);
    }
  });

  it("명세된 대표 프리셋(흰/검정/두꺼운 흰/스티커/이중/네온/핑크)을 담고 있다", () => {
    const byId = new Map(OUTLINE_PRESETS.map((p) => [p.id, p.value]));
    expect(byId.get("white")).toEqual({ color: "#ffffff", width: 8, opacity: 100 });
    expect(byId.get("black")).toEqual({ color: "#000000", width: 6, opacity: 100 });
    expect(byId.get("thick-white")).toEqual({ color: "#ffffff", width: 14, opacity: 100 });
    expect(byId.get("sticker")).toEqual({ color: "#ffffff", width: 10, opacity: 100 });
    expect(byId.get("neon")?.width).toBe(6);
    expect(byId.get("pink")?.width).toBe(6);
    // 신규: 웹툰 스티커의 흰+검 이중 테두리 프리셋.
    expect(byId.get("double")).toEqual({
      color: "#ffffff",
      width: 6,
      opacity: 100,
      secondColor: "#111111",
      secondWidth: 3,
    });
  });
});

describe("outlineCachePad", () => {
  // 의도적 변경(2026-07): 패딩 = ceil(총 링 두께) + AA 페더 1px. 페더가 링 바깥 1px까지
  // 자라므로 기존 ceil(width)만으로는 페더가 잘린다.
  it("활성(테두리 그려질 때)이면 ceil(총 두께)+페더 1px", () => {
    expect(outlineCachePad(normalizeOutline({ width: 8 }))).toBe(8 + OUTLINE_FEATHER_PX);
    expect(outlineCachePad(normalizeOutline({ width: 14 }))).toBe(14 + OUTLINE_FEATHER_PX);
  });

  it("이중 외곽선은 1차+2차 총 두께를 덮는다", () => {
    expect(outlineCachePad(normalizeOutline({ width: 6, secondColor: "#111111", secondWidth: 3 }))).toBe(
      9 + OUTLINE_FEATHER_PX
    );
    expect(outlineCachePad(normalizeOutline({ width: 0, secondColor: "#111111", secondWidth: 5 }))).toBe(
      5 + OUTLINE_FEATHER_PX
    );
  });

  it("소수 width는 올림(테두리가 잘리지 않게 여유 확보)", () => {
    expect(outlineCachePad({ color: "#ffffff", width: 2.3, opacity: 100 })).toBe(3 + OUTLINE_FEATHER_PX);
    expect(outlineCachePad({ color: "#ffffff", width: 0.1, opacity: 100 })).toBe(1 + OUTLINE_FEATHER_PX);
  });

  it("항등(두께0/불투명0)이면 0", () => {
    expect(outlineCachePad(DEFAULT_OUTLINE)).toBe(0);
    expect(outlineCachePad({ color: "#ffffff", width: 10, opacity: 0 })).toBe(0);
    expect(outlineCachePad({ color: "#ffffff", width: 0, opacity: 100, secondColor: "#000000", secondWidth: 0 })).toBe(0);
  });
});

describe("outlineKonvaFilter", () => {
  it("flat attrs(outlineColor/Width/Opacity)를 읽어 테두리를 그린다", () => {
    const img = makeBlockImage([200, 0, 0]);
    outlineKonvaFilter.call({ attrs: { outlineColor: "#00ff00", outlineWidth: 1, outlineOpacity: 100 } }, img);

    // applyOutline 직접 호출과 동일한 결과여야 한다.
    const ref = makeBlockImage([200, 0, 0]);
    applyOutline(ref, normalizeOutline({ color: "#00ff00", width: 1, opacity: 100 }));
    expect(Array.from(img.data)).toEqual(Array.from(ref.data));
    // 변 픽셀은 초록 테두리.
    expect(pixelAt(img, at(0, 1))).toEqual([0, 255, 0, 255]);
  });

  it("attrs가 비면 no-op(throw 없음)", () => {
    const img = makeBlockImage([200, 0, 0]);
    const before = Array.from(img.data);
    expect(() => outlineKonvaFilter.call({ attrs: {} }, img)).not.toThrow();
    expect(Array.from(img.data)).toEqual(before);
  });

  it("this.attrs 자체가 없어도 no-op", () => {
    const img = makeBlockImage([200, 0, 0]);
    const before = Array.from(img.data);
    expect(() => outlineKonvaFilter.call({}, img)).not.toThrow();
    expect(Array.from(img.data)).toEqual(before);
  });

  it("width0으로 정규화되는 attrs는 no-op", () => {
    const img = makeBlockImage([200, 0, 0]);
    const before = Array.from(img.data);
    outlineKonvaFilter.call({ attrs: { outlineColor: "#00ff00", outlineWidth: 0, outlineOpacity: 100 } }, img);
    expect(Array.from(img.data)).toEqual(before);
  });

  it("무효 attrs(숫자 아님/잘못된 색)는 안전하게 무시되어 no-op", () => {
    const img = makeBlockImage([200, 0, 0]);
    const before = Array.from(img.data);
    const attrs = { outlineColor: 123, outlineWidth: "x", outlineOpacity: Number.NaN };
    expect(() => outlineKonvaFilter.call({ attrs }, img)).not.toThrow();
    // width가 무효→0으로 정규화되어 항등 no-op.
    expect(Array.from(img.data)).toEqual(before);
  });

  it("이중 외곽선 attrs(outlineSecondColor/Width)도 읽어 applyOutline과 동일하게 그린다", () => {
    const img = makeBlockImage([200, 0, 0]);
    outlineKonvaFilter.call(
      {
        attrs: {
          outlineColor: "#ffffff",
          outlineWidth: 1,
          outlineOpacity: 100,
          outlineSecondColor: "#000000",
          outlineSecondWidth: 2,
        },
      },
      img
    );
    const ref = makeBlockImage([200, 0, 0]);
    applyOutline(
      ref,
      normalizeOutline({ color: "#ffffff", width: 1, opacity: 100, secondColor: "#000000", secondWidth: 2 })
    );
    expect(Array.from(img.data)).toEqual(Array.from(ref.data));
  });

  it("무효 타입의 이중 외곽선 attrs는 단일 링과 동일하게 동작", () => {
    const img = makeBlockImage([200, 0, 0]);
    outlineKonvaFilter.call(
      {
        attrs: {
          outlineColor: "#00ff00",
          outlineWidth: 1,
          outlineOpacity: 100,
          outlineSecondColor: 42,
          outlineSecondWidth: "wide",
        },
      },
      img
    );
    const ref = makeBlockImage([200, 0, 0]);
    applyOutline(ref, normalizeOutline({ color: "#00ff00", width: 1, opacity: 100 }));
    expect(Array.from(img.data)).toEqual(Array.from(ref.data));
  });
});

// 미사용 import 방지용 타입 참조.
const _typecheck: Outline = DEFAULT_OUTLINE;
void _typecheck;
