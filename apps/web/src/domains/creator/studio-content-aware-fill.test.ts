import { describe, expect, it } from "vitest";

import {
  CONTENT_AWARE_FILL_TILE_PX_DEFAULT,
  CONTENT_AWARE_FILL_TILE_PX_RANGE,
  bakeContentAwareFillToCanvas,
  bakeContentAwareFillToCanvasAsync,
  contentAwareFillHasWork,
  contentAwareFillPixels,
  contentAwareFillPixelsAsync,
  type ContentAwareFillCanvasFactory,
  type ContentAwareFillCtx2DLike,
} from "./studio-content-aware-fill";

import type { StudioImageDataLike } from "./studio-filters";
import type { MaskCanvasLike, MaskImageSource } from "./studio-selection-tools";

// ---------------------------------------------------------------------------
// 픽스처 헬퍼(studio-heal-clone.test.ts와 동일한 관례 — 파일마다 독립적으로 둔다)
// ---------------------------------------------------------------------------

function solidImage(w: number, h: number, r: number, g: number, b: number, a = 255): StudioImageDataLike {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i += 1) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = a;
  }
  return { data, width: w, height: h };
}

/** 픽셀별 콜백으로 채운 이미지. */
function paintedImage(
  w: number,
  h: number,
  fn: (x: number, y: number) => [number, number, number, number]
): StudioImageDataLike {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const [r, g, b, a] = fn(x, y);
      const idx = (y * w + x) * 4;
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = a;
    }
  }
  return { data, width: w, height: h };
}

/** rasterizeSelectionMask 관례와 동일 — 흰색 알파(255)=선택됨, rect 밖은 알파 0. */
function rectMask(w: number, h: number, rect: { x: number; y: number; w: number; h: number }): StudioImageDataLike {
  return paintedImage(w, h, (x, y) => {
    const inside = x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;
    return [255, 255, 255, inside ? 255 : 0];
  });
}

function pixelAt(img: StudioImageDataLike, x: number, y: number): [number, number, number, number] {
  const idx = (y * img.width + x) * 4;
  return [img.data[idx]!, img.data[idx + 1]!, img.data[idx + 2]!, img.data[idx + 3]!];
}

function averageColor(img: StudioImageDataLike, rect: { x: number; y: number; w: number; h: number }) {
  let sr = 0;
  let sg = 0;
  let sb = 0;
  let count = 0;
  for (let y = rect.y; y < rect.y + rect.h; y += 1) {
    for (let x = rect.x; x < rect.x + rect.w; x += 1) {
      const [r, g, b] = pixelAt(img, x, y);
      sr += r;
      sg += g;
      sb += b;
      count += 1;
    }
  }
  return { r: sr / count, g: sg / count, b: sb / count };
}

// ---------------------------------------------------------------------------
// 상수
// ---------------------------------------------------------------------------

describe("상수", () => {
  it("기본 타일 크기는 범위 안", () => {
    expect(CONTENT_AWARE_FILL_TILE_PX_DEFAULT).toBeGreaterThanOrEqual(CONTENT_AWARE_FILL_TILE_PX_RANGE.min);
    expect(CONTENT_AWARE_FILL_TILE_PX_DEFAULT).toBeLessThanOrEqual(CONTENT_AWARE_FILL_TILE_PX_RANGE.max);
  });
});

// ---------------------------------------------------------------------------
// contentAwareFillHasWork
// ---------------------------------------------------------------------------

describe("contentAwareFillHasWork", () => {
  it("알파가 전부 0이면 false", () => {
    expect(contentAwareFillHasWork(solidImage(10, 10, 0, 0, 0, 0))).toBe(false);
  });
  it("알파가 하나라도 있으면 true", () => {
    expect(contentAwareFillHasWork(rectMask(10, 10, { x: 2, y: 2, w: 3, h: 3 }))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// contentAwareFillPixels — 핵심 결정론 테스트(§design 요구사항: 단색 배경은 완벽하게 채워져야 한다)
// ---------------------------------------------------------------------------

describe("contentAwareFillPixels", () => {
  it("선택이 없으면(마스크 알파 전부 0) 원본을 그대로 복제해 반환한다(no-op)", () => {
    const source = paintedImage(20, 20, (x) => (x < 10 ? [10, 20, 30, 255] : [40, 50, 60, 255]));
    const mask = solidImage(20, 20, 0, 0, 0, 0);
    const out = contentAwareFillPixels(source, mask);
    expect(out.data).toEqual(source.data);
    expect(out.data).not.toBe(source.data); // 새 버퍼(복제) — 참조 동일 아님.
  });

  it("mask 크기가 source와 다르면 원본을 그대로 복제해 반환한다(방어적 no-op)", () => {
    const source = solidImage(20, 20, 1, 2, 3);
    const mask = solidImage(10, 10, 255, 255, 255, 255);
    const out = contentAwareFillPixels(source, mask);
    expect(out.data).toEqual(source.data);
  });

  it("단색 배경 위 선택 영역은 완벽하게(정확히 같은 색으로) 채워진다 — 결정론 핵심 케이스", () => {
    const source = solidImage(60, 60, 120, 180, 90, 255);
    const mask = rectMask(60, 60, { x: 20, y: 20, w: 20, h: 20 });
    const out = contentAwareFillPixels(source, mask);
    // 선택 영역 안쪽 전체가 원본과 동일한 단색이어야 한다(경계 포함).
    for (let y = 20; y < 40; y += 1) {
      for (let x = 20; x < 40; x += 1) {
        expect(pixelAt(out, x, y)).toEqual([120, 180, 90, 255]);
      }
    }
    // 선택 밖(원본 그대로여야 함)도 변하지 않는다.
    expect(pixelAt(out, 0, 0)).toEqual([120, 180, 90, 255]);
    expect(pixelAt(out, 59, 59)).toEqual([120, 180, 90, 255]);
  });

  it("단색 배경 + 페더(부분 알파)도 완벽하게 채워진다(알파가 완전 불투명한 원래 배경과 같은 색이라 블렌드해도 색이 안 변함)", () => {
    const source = solidImage(40, 40, 200, 50, 50, 255);
    const mask = paintedImage(40, 40, (x, y) => {
      const inside = x >= 15 && x < 25 && y >= 15 && y < 25;
      return [255, 255, 255, inside ? 180 : 0]; // 페더로 인한 부분 알파(180/255).
    });
    const out = contentAwareFillPixels(source, mask);
    for (let y = 15; y < 25; y += 1) {
      for (let x = 15; x < 25; x += 1) {
        expect(pixelAt(out, x, y)).toEqual([200, 50, 50, 255]);
      }
    }
  });

  it("이미지 전체가 선택된 극단 케이스도 크래시 없이 채운다(알려진 픽셀이 하나도 없어 폴백 색 사용)", () => {
    const source = solidImage(30, 30, 10, 20, 30, 255);
    const mask = solidImage(30, 30, 255, 255, 255, 255); // 전체 선택.
    expect(() => contentAwareFillPixels(source, mask)).not.toThrow();
    const out = contentAwareFillPixels(source, mask);
    expect(out.width).toBe(30);
    expect(out.height).toBe(30);
    // meanKnownColor는 "선택 안 된(마스크 알파<=EPS)" 픽셀의 평균인데, 전체 선택이면 그런 픽셀이
    // 하나도 없어 count=0 → null → 하드코드 폴백 회색(200,200,200,255)으로 떨어진다(§design §5-4
    // 갱신분 참고 — "이미 알려진 픽셀의 평균"이 아니라 이 경우엔 진짜 이미지에서 유도된 값이 아니다).
    // 원본이 단색이라 이 자체로는 "우연히 원본과 같은 값"과 "진짜 폴백이 작동함"을 구분 못 하므로,
    // 아래 별도 describe 블록(두 가지 색으로 된 소스)이 진짜 회귀 방지 역할을 한다.
    for (let y = 0; y < 30; y += 1) {
      for (let x = 0; x < 30; x += 1) {
        expect(pixelAt(out, x, y)).toEqual([200, 200, 200, 255]);
      }
    }
  });

  it("좌/우 두 색 영역 경계에 걸친 선택 — 채운 결과가 각자 가까운 원래 색 성향을 유지한다(콘텐츠 인식 검증)", () => {
    // 왼쪽(x<30) 빨강, 오른쪽(x>=30) 초록. 선택은 경계를 가로지르는 20x20 사각형(x:20..40).
    const source = paintedImage(60, 60, (x) => (x < 30 ? [220, 20, 20, 255] : [20, 200, 20, 255]));
    const mask = rectMask(60, 60, { x: 20, y: 10, w: 20, h: 20 });
    const out = contentAwareFillPixels(source, mask);

    const leftFilled = averageColor(out, { x: 20, y: 12, w: 8, h: 16 }); // 선택 안, 원래 빨강 쪽.
    const rightFilled = averageColor(out, { x: 32, y: 12, w: 8, h: 16 }); // 선택 안, 원래 초록 쪽.

    expect(leftFilled.r).toBeGreaterThan(leftFilled.g); // 빨강 성향 유지.
    expect(rightFilled.g).toBeGreaterThan(rightFilled.r); // 초록 성향 유지.
  });

  it("결과는 원본 크기와 같고, 원본/마스크 버퍼를 변경하지 않는다", () => {
    const source = solidImage(16, 16, 5, 6, 7);
    const sourceBefore = source.data.slice();
    const mask = rectMask(16, 16, { x: 4, y: 4, w: 4, h: 4 });
    const maskBefore = mask.data.slice();
    const out = contentAwareFillPixels(source, mask);
    expect(out.width).toBe(16);
    expect(out.height).toBe(16);
    expect(source.data).toEqual(sourceBefore);
    expect(mask.data).toEqual(maskBefore);
  });

  it("tilePx 옵션은 범위로 클램프된다(비정상 값도 크래시하지 않는다)", () => {
    const source = solidImage(40, 40, 1, 2, 3);
    const mask = rectMask(40, 40, { x: 10, y: 10, w: 10, h: 10 });
    expect(() => contentAwareFillPixels(source, mask, { tilePx: 0 })).not.toThrow();
    expect(() => contentAwareFillPixels(source, mask, { tilePx: 999 })).not.toThrow();
    expect(() => contentAwareFillPixels(source, mask, { tilePx: Number.NaN })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 문맥 SSD 후보 비교 — 이미지 경계 밖 읽기 방지(손으로 좌표를 추적해 찾은 회귀)
// ---------------------------------------------------------------------------
//
// 타일 그리드 손 계산(width=30, height=10, tilePx=10 명시):
//   bbox: minX=0,maxX=19,minY=0,maxY=9 (tc=0 전체 선택 + tc=1 일부(x13-19) 선택).
//   bx=max(0,0-10)=0, by=max(0,0-10)=0, bx2=min(30,19+1+10)=30, by2=min(10,9+1+10)=10.
//   cols=ceil(30/10)=3, rows=ceil(10/10)=1 → tc=0:x[0,10) tc=1:x[10,20) tc=2:x[20,30), 전부 y[0,10).
//   tc=0,tc=1은 구멍(hole), tc=2는 처음부터 앎(known).
// BFS는 tc=0을 먼저 큐에 넣는다(초기 스캔이 tc 오름차순이고, tc=0은 그리드 밖(패딩 보장)을 이웃으로
// 가져 즉시 준비된다). tc=0을 채울 후보를 CANDIDATE_OFFSETS(8방향×반경1~6) 순서로 찾으면:
//   - 반경1,(1,0): tc=1을 가리키는데 tc=1이 아직 미해결(구멍)이라 제외.
//   - 반경1의 나머지 7방향: height=10(패딩 없음)이라 dy≠0 은 전부 이미지 밖, dx=-1 도 이미지 밖 → 전부 제외.
//   - 반경2,(1,0): cx=20,cy=0 → candCore={20,0,10,10}=tc=2(앎) → **유일하게 유효한 후보**.
//   - 반경2의 나머지·반경3~6: 전부 이미지 밖(dy≠0) 이거나 폭 30을 넘어(dx=3+) 제외.
// 이 유일한 후보를 채점하는 contextWeightedSsd 는 rect={0,0,10,10}(marginLeft=0,marginTop=0,
// marginRight=min(3,30-10)=3,marginBottom=min(3,10-10)=0) 기준 문맥 창을 candX=20,candY=0 에서 읽는다.
// 문맥 열 x=10,11,12(마진 3px, tc=1 안이지만 x13-20만 선택돼 있어 이 열은 선택 안 됨=가중치>0)에서
// cx=candX+x=20+10..12=30..32 — width=30 을 넘는다. y=9(마지막 행)에서 cIdx=(9*30+30)*4=1200 은
// Uint8ClampedArray(길이 1200) 의 **끝을 넘어서** undefined 를 읽어 SSD 가 NaN 이 될 뻔한 자리다(고치지
// 않았다면 NaN<Infinity 는 항상 false 라 pickBestCandidateCore 가 후보를 못 고르고 null 반환 → tc=0 이
// filled=1 로 표시되고도 실제로는 전혀 채워지지 않고 원본(핑크)이 그대로 남았을 것 — 폴백도 filled=1 인
// 타일은 건드리지 않는다). contextWeightedSsd 의 경계 가드가 이 자리를 가중치 0과 동치로 건너뛰게 한다.
describe("contextWeightedSsd — 문맥 여백이 이미지 경계 밖으로 나가는 후보 방어", () => {
  it("타깃 타일에 여백이 남고 유일한 후보가 이미지 오른쪽 경계에 걸치는 배치에서도 실제로 채워진다", () => {
    const width = 30;
    const height = 10;
    // x<10: 제거 대상 "티끌"(선명한 핑크). 그 외: 균일 배경 회색 — 후보가 어디서 오든 채움 색은 회색이어야 한다.
    const source = paintedImage(width, height, (x) => (x < 10 ? [255, 0, 255, 255] : [50, 50, 50, 255]));
    // 선택: x[0,10) 전체(tc=0) + x[13,20) 만(tc=1 일부) — x[10,13)은 일부러 비워 둬 tc=1을
    // "구멍"으로 분류시키면서도(반경1,(1,0) 후보 무효화) 문맥 마진 열(x10-12)엔 가중치가 남게 한다.
    const mask = paintedImage(width, height, (x) => {
      const selected = x < 10 || (x >= 13 && x < 20);
      return [255, 255, 255, selected ? 255 : 0];
    });
    const out = contentAwareFillPixels(source, mask, { tilePx: 10 });
    // tc=0(x0-10, y0-10) 전체가 배경 회색으로 채워져야 한다 — 핑크가 그대로 남으면(경계 밖 읽기 버그) 실패한다.
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < 10; x += 1) {
        expect(pixelAt(out, x, y)).toEqual([50, 50, 50, 255]);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// BFS "filled" 오표시 방지 — best를 못 찾은 타일을 신뢰 가능한 것으로 취급하면 안 된다(회귀)
// ---------------------------------------------------------------------------
//
// 예전 버그: 메인 BFS 루프가 pickBestCandidateCore가 null을 반환해도(=이 타일은 채울 후보를 못
// 찾았다) grid.filled[idx]=1을 무조건 찍었다. 그 결과 (a) resolvedWeightAt/isTileKnownIdx가 이
// 타일을 "신뢰 가능"으로 오판해서, 아직 원본(구멍) 픽셀 그대로인 이 타일의 내용을 이후 다른 타일의
// SSD 비교·복사가 "진짜 문맥"인 것처럼 그대로 베껴가는 연쇄 오염이 발생하고, (b) 맨 마지막 폴백
// 스윕은 filled===0인 타일만 골라내므로 이 타일은 평균색 폴백 대상에서도 영영 빠졌다. 실측 재현:
// 좌/우 두 색으로 된 이미지 전체를 선택하면(design §5-4가 명시한 "이미지 전체 선택" 폴백 시나리오
// 그 자체) 결과가 균일한 폴백 회색이 아니라 원본 좌측 색 하나로 전체가 뒤덮여 버렸다(그리드에서 가장
// 먼저 처리된, 실제로는 하나도 안 채워진 타일의 원본 내용이 그리드 전체로 잘못 전파됨).
describe("BFS filled 플래그 — best를 못 찾은 타일은 신뢰 가능/폴백 대상에서 빠지면 안 된다", () => {
  it("좌/우 두 색 이미지를 전체 선택하면 한쪽 색으로 뒤덮이지 않고 균일한 폴백 색이 된다(연쇄 오염 회귀)", () => {
    const width = 30;
    const height = 30;
    // 왼쪽 절반 빨강, 오른쪽 절반 초록 — 전체 선택이라 "이미 알려진(미선택)" 픽셀이 하나도 없으므로
    // meanKnownColor가 null을 반환해 하드코드 회색(200,200,200)으로 떨어지는 게 올바른 동작이다.
    // 버그가 있으면(연쇄 오염) 결과가 빨강 또는 초록 중 하나로 뒤덮이거나 여러 색이 뒤섞인 채 남는다.
    const source = paintedImage(width, height, (x) => (x < 15 ? [220, 20, 20, 255] : [20, 200, 20, 255]));
    const mask = solidImage(width, height, 255, 255, 255, 255); // 전체 선택.
    const out = contentAwareFillPixels(source, mask);

    const colors = new Set<string>();
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        colors.add(pixelAt(out, x, y).join(","));
      }
    }
    // 결과가 단일 색이어야 하고, 그 색은 원본의 빨강/초록 그 어느 쪽도 아니어야 한다(연쇄 오염이면
    // 원본 색 중 하나 — 대개 그리드에서 가장 먼저 처리되는 타일의 색 — 로 뒤덮인다).
    expect(colors.size).toBe(1);
    expect([...colors][0]).toBe("200,200,200,255");
    expect([...colors][0]).not.toBe("220,20,20,255");
    expect([...colors][0]).not.toBe("20,200,20,255");
  });

  it("선택이 한쪽 가장자리에만 닿아 있으면(다른 3면은 진짜 여백 있음) 회색 폴백이 아니라 실제 배경색으로 채워진다", () => {
    // 대조군 — 위 테스트가 "전체 선택은 항상 회색"을 과잉 일반화해서 통과하는 게 아님을 보장한다.
    // 선택이 좌상단 모서리(0,0)에서 시작해 왼쪽/위쪽 가장자리에는 닿지만, 오른쪽/아래쪽엔 진짜 배경이
    // 넉넉히 남아 있다 — BFS가 그 진짜 배경으로부터 정상 전파해 실제 배경색을 복사해야 한다.
    const width = 60;
    const height = 60;
    const bg: [number, number, number, number] = [40, 90, 180, 255];
    const marker: [number, number, number, number] = [255, 240, 10, 255];
    const source = paintedImage(width, height, (x, y) => (x < 20 && y < 20 ? marker : bg));
    const mask = rectMask(width, height, { x: 0, y: 0, w: 20, h: 20 });
    const out = contentAwareFillPixels(source, mask);
    expect(pixelAt(out, 10, 10)).toEqual(bg);
    expect(pixelAt(out, 0, 0)).toEqual(bg);
    expect(pixelAt(out, 19, 19)).toEqual(bg);
  });
});

// ---------------------------------------------------------------------------
// copyTileFill 블렌드 공식 — 픽셀 자신의 선택 알파로 정확히 블렌드되는지 손 계산 검증
// ---------------------------------------------------------------------------
describe("contentAwareFillPixels — 부분 알파 1픽셀의 블렌드 값을 손으로 계산해 검증", () => {
  it("단색 배경 위 선택 타일 안, 딱 한 픽셀만 부분 알파(128/255)면 그 픽셀만 정확한 블렌드 값이 된다", () => {
    // 배경 전체 (100,150,200,255) 단색 — 어떤 후보가 이기든(균일 배경이라 전부 동점) 채움 색은 항상
    // 이 배경색이다. 선택 타일(x10-20,y10-20) 안의 (15,15) 딱 한 점만 원래 검정(0,0,0,255) "티끌"이자
    // 선택 알파도 128(페더 경계의 부분값 시뮬레이션) — 나머지 선택 픽셀은 전부 알파 255(완전 교체).
    // copyTileFill 공식: out = original*(1-a) + candidate*a, a=128/255.
    //   R: 100*128/255 = 12800/255 = 50.196... → 반올림 50
    //   G: 150*128/255 = 19200/255 = 75.294... → 반올림 75
    //   B: 200*128/255 = 25600/255 = 100.392... → 반올림 100
    //   A: 255*(1-a) + 255*a = 255 (원본·후보 모두 완전 불투명)
    // (15,15)는 타일 경계(로컬 10의 배수) 근방 1px 밴드 밖(로컬 15, 5px 여유)이라 seam 스무딩에
    // 영향받지 않는다 — 이 블렌드 값이 최종 결과에 그대로 남는다.
    const width = 40;
    const height = 40;
    const source = paintedImage(width, height, (x, y) => (x === 15 && y === 15 ? [0, 0, 0, 255] : [100, 150, 200, 255]));
    const mask = paintedImage(width, height, (x, y) => {
      const inHole = x >= 10 && x < 20 && y >= 10 && y < 20;
      if (!inHole) return [255, 255, 255, 0];
      return x === 15 && y === 15 ? [255, 255, 255, 128] : [255, 255, 255, 255];
    });
    const out = contentAwareFillPixels(source, mask, { tilePx: 10 });
    expect(pixelAt(out, 15, 15)).toEqual([50, 75, 100, 255]);
    // 대조군 — 나머지 선택 픽셀(알파 255)은 완벽하게(원본과 똑같이) 채워진다.
    expect(pixelAt(out, 10, 10)).toEqual([100, 150, 200, 255]);
    expect(pixelAt(out, 19, 19)).toEqual([100, 150, 200, 255]);
  });
});

// ---------------------------------------------------------------------------
// (B) bakeContentAwareFillToCanvas — DOM 없는 가짜 팩토리(studio-heal-clone.test.ts와 동일 패턴)
// ---------------------------------------------------------------------------

type FakeCanvas = MaskCanvasLike & MaskImageSource & { id: number };
type FakeSource = MaskImageSource & { testImage: StudioImageDataLike };

function fakeContentAwareFillFactory(
  log: string[],
  buffers: Map<number, StudioImageDataLike>,
  failAt = Infinity
): ContentAwareFillCanvasFactory {
  let count = 0;
  return (width, height) => {
    count += 1;
    if (count >= failAt) return null;
    const id = count;
    const canvas: FakeCanvas = { id, width, height };
    buffers.set(id, { data: new Uint8ClampedArray(width * height * 4), width, height });
    const ctx: ContentAwareFillCtx2DLike = {
      fillStyle: "#fff",
      strokeStyle: "#fff",
      globalCompositeOperation: "source-over",
      filter: "none",
      lineWidth: 1,
      lineCap: "butt",
      lineJoin: "miter",
      beginPath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      closePath: () => {},
      fill: () => {},
      stroke: () => {},
      fillRect: () => {},
      clearRect: () => {},
      drawImage: (image) => {
        log.push(`c${id}:drawImage`);
        const testImage = (image as FakeSource).testImage;
        buffers.set(id, { data: testImage.data.slice() as Uint8ClampedArray, width, height });
      },
      getImageData: (_sx, _sy, sw, sh) => {
        log.push(`c${id}:getImageData`);
        const buf = buffers.get(id)!;
        return { data: buf.data.slice() as Uint8ClampedArray, width: sw, height: sh };
      },
      putImageData: (imageData) => {
        log.push(`c${id}:putImageData`);
        buffers.set(id, { data: imageData.data.slice() as Uint8ClampedArray, width, height });
      },
    };
    return { canvas, ctx };
  };
}

describe("bakeContentAwareFillToCanvas", () => {
  it("source/mask/결과 캔버스 3개를 순서대로 만들고, 결과는 contentAwareFillPixels와 정확히 일치한다", () => {
    const log: string[] = [];
    const buffers = new Map<number, StudioImageDataLike>();
    const factory = fakeContentAwareFillFactory(log, buffers);
    const testImage = solidImage(20, 20, 90, 140, 200, 255);
    const source: FakeSource = { testImage };
    const maskImage = rectMask(20, 20, { x: 5, y: 5, w: 6, h: 6 });
    const mask: FakeSource = { testImage: maskImage };

    const out = bakeContentAwareFillToCanvas(source, mask, 20, 20, undefined, factory);

    expect(out).not.toBeNull();
    expect((out as FakeCanvas).id).toBe(3);
    expect(log).toEqual([
      "c1:drawImage",
      "c2:drawImage",
      "c1:getImageData",
      "c2:getImageData",
      "c3:putImageData",
    ]);

    const expected = contentAwareFillPixels(testImage, maskImage);
    expect(buffers.get(3)!.data).toEqual(expected.data);
  });

  it("width/height가 비정상이면 캔버스를 만들지 않고 null", () => {
    const log: string[] = [];
    const buffers = new Map<number, StudioImageDataLike>();
    const factory = fakeContentAwareFillFactory(log, buffers);
    const source: FakeSource = { testImage: solidImage(10, 10, 1, 1, 1) };
    const mask: FakeSource = { testImage: solidImage(10, 10, 255, 255, 255, 255) };
    expect(bakeContentAwareFillToCanvas(source, mask, 0, 10, undefined, factory)).toBeNull();
    expect(bakeContentAwareFillToCanvas(source, mask, 10, Number.NaN, undefined, factory)).toBeNull();
    expect(log).toEqual([]);
  });

  it("세 번째(결과) 캔버스 생성이 실패하면 null", () => {
    const log: string[] = [];
    const buffers = new Map<number, StudioImageDataLike>();
    const factory = fakeContentAwareFillFactory(log, buffers, 3); // 3번째 생성부터 실패.
    const source: FakeSource = { testImage: solidImage(10, 10, 1, 1, 1) };
    const mask: FakeSource = { testImage: rectMask(10, 10, { x: 2, y: 2, w: 3, h: 3 }) };
    const out = bakeContentAwareFillToCanvas(source, mask, 10, 10, undefined, factory);
    expect(out).toBeNull();
  });
});

describe("contentAwareFillPixelsAsync — cooperative yield parity", () => {
  it("matches the sync pixel result while yielding every tile", async () => {
    const source = solidImage(60, 60, 120, 180, 90, 255);
    const mask = rectMask(60, 60, { x: 20, y: 20, w: 20, h: 20 });
    let yields = 0;
    const asyncOut = await contentAwareFillPixelsAsync(source, mask, {
      yieldEveryTiles: 1,
      yieldControl: async () => {
        yields += 1;
      },
    });
    const syncOut = contentAwareFillPixels(source, mask);
    expect(asyncOut.data).toEqual(syncOut.data);
    expect(yields).toBeGreaterThan(0);
  });

  it("bakeContentAwareFillToCanvasAsync matches sync bake pixels", async () => {
    const log: string[] = [];
    const buffers = new Map<number, StudioImageDataLike>();
    const factory = fakeContentAwareFillFactory(log, buffers);
    const source: FakeSource = { testImage: solidImage(20, 20, 40, 50, 60) };
    const mask: FakeSource = { testImage: rectMask(20, 20, { x: 6, y: 6, w: 8, h: 8 }) };
    const sync = bakeContentAwareFillToCanvas(source, mask, 20, 20, undefined, factory);
    const log2: string[] = [];
    const buffers2 = new Map<number, StudioImageDataLike>();
    const factory2 = fakeContentAwareFillFactory(log2, buffers2);
    const asyncOut = await bakeContentAwareFillToCanvasAsync(
      source,
      mask,
      20,
      20,
      { yieldEveryTiles: 2, yieldControl: async () => undefined },
      factory2,
    );
    expect(asyncOut).not.toBeNull();
    expect(sync).not.toBeNull();
    const syncId = (sync as unknown as FakeSource).testImage;
    const asyncId = (asyncOut as unknown as FakeSource).testImage;
    expect(asyncId?.data).toEqual(syncId?.data);
  });
});
