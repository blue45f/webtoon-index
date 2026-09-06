import { describe, expect, it } from "vitest";

import {
  applyFilterMaskToPixels,
  blendFilterMaskedPixels,
  canFilterMask,
  computeFilterMaskCoverage,
  filterMaskRenderKey,
  hasFilterMask,
  sampleFilterMaskCoverage,
  shouldApplyFilterMask,
  wrapKonvaFiltersWithFilterMask,
  type FilterMaskCoverage,
  type FilterMaskImageDataLike,
  type FilterMaskLike,
} from "./studio-filter-mask";

const FILTER_MASK_SURFACE_ID =
  "filter-mask:v1:10000000-0000-4000-8000-000000000001" as const;

// ---------------------------------------------------------------------------
// 테스트 픽스처 — RGBA 버퍼/커버리지 헬퍼(순수 모듈 자체 픽스처, 파일 간 import 없음 —
// studio-layer-mask.test.ts와 동일 컨벤션).
// ---------------------------------------------------------------------------

/** [r,g,b,a] 픽셀 목록으로 RGBA 버퍼를 만든다. */
function rgba(...pixels: [number, number, number, number][]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(pixels.length * 4);
  pixels.forEach((pixel, index) => out.set(pixel, index * 4));
  return out;
}

/** 단일 채널 값 목록으로 커버리지를 직접 만든다(디코드 우회 — 샘플/블렌드 단독 검증용). */
function coverageOf(width: number, height: number, values: number[]): FilterMaskCoverage {
  return { width, height, data: new Uint8ClampedArray(values) };
}

/** 모든 픽셀이 같은 RGBA인 w×h 버퍼. */
function solid(width: number, height: number, pixel: [number, number, number, number]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) out.set(pixel, i * 4);
  return out;
}

// ---------------------------------------------------------------------------
// canFilterMask / hasFilterMask / shouldApplyFilterMask / filterMaskRenderKey
// ---------------------------------------------------------------------------

describe("canFilterMask", () => {
  it("image 타입만 true", () => {
    expect(canFilterMask({ type: "image" })).toBe(true);
  });

  it("image가 아니거나 type이 없으면 false", () => {
    const nonImageTypes: FilterMaskLike[] = [
      { type: "text" },
      { type: "draw" },
      { type: "bubble" },
      { type: "sticker" },
      { type: "frame" },
      {},
    ];
    for (const el of nonImageTypes) {
      expect(canFilterMask(el)).toBe(false);
    }
  });
});

describe("hasFilterMask", () => {
  it("filterMaskSrc가 있으면 true(type과 무관 — 존재 술어)", () => {
    expect(hasFilterMask({ type: "image", filterMaskSrc: "data:image/png;base64,x" })).toBe(true);
    expect(hasFilterMask({ filterMaskSrc: "data:image/png;base64,x" })).toBe(true);
  });

  it("filterMaskSrc가 없거나 빈 문자열이면 false", () => {
    expect(hasFilterMask({ type: "image" })).toBe(false);
    expect(hasFilterMask({ type: "image", filterMaskSrc: "" })).toBe(false);
  });

  it("exact immutable surface ID도 마스크 존재로 판정하고 malformed ID는 거부한다", () => {
    expect(hasFilterMask({
      type: "image",
      filterMaskSurfaceId: FILTER_MASK_SURFACE_ID,
    })).toBe(true);
    expect(hasFilterMask({
      type: "image",
      filterMaskSurfaceId: "data:image/png;base64,AA==",
    })).toBe(false);
  });
});

describe("shouldApplyFilterMask", () => {
  it("image + filterMaskSrc 있음 + filterMaskEnabled 미설정(기본 켜짐)이면 true", () => {
    expect(shouldApplyFilterMask({ type: "image", filterMaskSrc: "data:x" })).toBe(true);
  });

  it("filterMaskEnabled:false면 마스크가 있어도 false(비활성화 — 삭제와 구분)", () => {
    expect(
      shouldApplyFilterMask({ type: "image", filterMaskSrc: "data:x", filterMaskEnabled: false })
    ).toBe(false);
  });

  it("filterMaskEnabled:true는 명시적으로 켜짐", () => {
    expect(
      shouldApplyFilterMask({ type: "image", filterMaskSrc: "data:x", filterMaskEnabled: true })
    ).toBe(true);
  });

  it("방어적 — image가 아닌 요소에 filterMaskSrc가 붙어 있어도 무시(false)", () => {
    expect(shouldApplyFilterMask({ type: "text", filterMaskSrc: "data:x" })).toBe(false);
  });

  it("필드 미설정 문서(기존 문서)는 항상 false — 현행 전체 적용과 동일", () => {
    expect(shouldApplyFilterMask({ type: "image" })).toBe(false);
  });

  it("image + immutable surface ID를 적용 대상으로 판정한다", () => {
    expect(shouldApplyFilterMask({
      type: "image",
      filterMaskSurfaceId: FILTER_MASK_SURFACE_ID,
    })).toBe(true);
  });
});

describe("filterMaskRenderKey", () => {
  it("적용 중이면 마스크 data URL 자체, 아니면 빈 문자열", () => {
    expect(filterMaskRenderKey({ type: "image", filterMaskSrc: "data:x" })).toBe("data:x");
    expect(filterMaskRenderKey({ type: "image" })).toBe("");
    expect(
      filterMaskRenderKey({ type: "image", filterMaskSrc: "data:x", filterMaskEnabled: false })
    ).toBe("");
    expect(filterMaskRenderKey({ type: "text", filterMaskSrc: "data:x" })).toBe("");
  });

  it("immutable surface ID를 inline projection보다 우선하는 안정적인 정체성으로 사용한다", () => {
    expect(filterMaskRenderKey({
      type: "image",
      filterMaskSurfaceId: FILTER_MASK_SURFACE_ID,
      filterMaskSrc: "blob:https://example.test/transient",
    })).toBe(FILTER_MASK_SURFACE_ID);
  });
});

// ---------------------------------------------------------------------------
// computeFilterMaskCoverage — m = luma × alpha / 255 (두 인코딩 관용 모두 수용)
// ---------------------------------------------------------------------------

describe("computeFilterMaskCoverage", () => {
  it("흰색·불투명=255, 검정·불투명=0(레이어 마스크 알파 인코딩)", () => {
    const coverage = computeFilterMaskCoverage(
      rgba([255, 255, 255, 255], [0, 0, 0, 255]),
      2,
      1
    );
    expect(coverage).not.toBeNull();
    expect([...coverage!.data]).toEqual([255, 0]);
  });

  it("흰색 RGB 고정 + 알파에 값(표준 인코딩)이면 m=alpha 그대로", () => {
    const coverage = computeFilterMaskCoverage(
      rgba([255, 255, 255, 0], [255, 255, 255, 128], [255, 255, 255, 255]),
      3,
      1
    );
    expect([...coverage!.data]).toEqual([0, 128, 255]);
  });

  it("알파 255 + RGB 휘도 인코딩(외부 유입 그레이스케일)이면 m=luma", () => {
    const coverage = computeFilterMaskCoverage(
      rgba([128, 128, 128, 255], [64, 64, 64, 255]),
      2,
      1
    );
    // Rec.709 계수 합=1이라 균일 회색은 그 값 그대로.
    expect([...coverage!.data]).toEqual([128, 64]);
  });

  it("휘도×알파 곱연산 — 반투명 회색은 두 값의 곱", () => {
    const coverage = computeFilterMaskCoverage(rgba([128, 128, 128, 128]), 1, 1);
    // 128×128/255 = 64.25... → 반올림 64.
    expect(coverage!.data[0]).toBe(64);
  });

  it("치수/버퍼 길이 불일치·퇴화 치수는 null(fail-closed)", () => {
    expect(computeFilterMaskCoverage(rgba([255, 255, 255, 255]), 2, 1)).toBeNull();
    expect(computeFilterMaskCoverage(rgba([255, 255, 255, 255]), 0, 1)).toBeNull();
    expect(computeFilterMaskCoverage(rgba([255, 255, 255, 255]), 1.5, 1)).toBeNull();
    expect(computeFilterMaskCoverage(rgba([255, 255, 255, 255]), 1, -1)).toBeNull();
  });

  it("결정적 — 같은 입력이면 항상 같은 출력", () => {
    const input = rgba([200, 40, 90, 210], [12, 250, 3, 77]);
    const first = computeFilterMaskCoverage(input, 2, 1)!;
    const second = computeFilterMaskCoverage(input, 2, 1)!;
    expect([...first.data]).toEqual([...second.data]);
  });
});

// ---------------------------------------------------------------------------
// sampleFilterMaskCoverage — 픽셀 중심 정렬 양선형 + 가장자리 클램프
// ---------------------------------------------------------------------------

describe("sampleFilterMaskCoverage", () => {
  const gradient = coverageOf(2, 1, [0, 255]);

  it("해상도가 같으면 픽셀 중심 샘플이 원본 값을 그대로 돌려준다", () => {
    // 2px 폭에서 픽셀 중심은 u=0.25, 0.75.
    expect(sampleFilterMaskCoverage(gradient, 0.25, 0.5)).toBe(0);
    expect(sampleFilterMaskCoverage(gradient, 0.75, 0.5)).toBe(255);
  });

  it("픽셀 사이는 양선형 보간(중간=평균)", () => {
    expect(sampleFilterMaskCoverage(gradient, 0.5, 0.5)).toBeCloseTo(127.5, 5);
  });

  it("범위 밖·비유한 u/v는 가장자리 클램프", () => {
    expect(sampleFilterMaskCoverage(gradient, -1, 0.5)).toBe(0);
    expect(sampleFilterMaskCoverage(gradient, 2, 0.5)).toBe(255);
    expect(sampleFilterMaskCoverage(gradient, Number.NaN, 0.5)).toBe(0);
  });

  it("세로 방향도 동일하게 보간·클램프된다", () => {
    const vertical = coverageOf(1, 2, [0, 255]);
    expect(sampleFilterMaskCoverage(vertical, 0.5, 0.25)).toBe(0);
    expect(sampleFilterMaskCoverage(vertical, 0.5, 0.75)).toBe(255);
    expect(sampleFilterMaskCoverage(vertical, 0.5, 0.5)).toBeCloseTo(127.5, 5);
  });
});

// ---------------------------------------------------------------------------
// applyFilterMaskToPixels / blendFilterMaskedPixels — out = filtered·m + original·(1−m)
// ---------------------------------------------------------------------------

describe("applyFilterMaskToPixels", () => {
  it("전부 흰색(255) 마스크는 필터 결과를 비트 단위로 보존한다(항등)", () => {
    const filtered = rgba([10, 20, 30, 255], [200, 150, 100, 128]);
    const snapshot = new Uint8ClampedArray(filtered);
    const ok = applyFilterMaskToPixels({
      target: filtered,
      original: rgba([1, 1, 1, 1], [2, 2, 2, 2]),
      width: 2,
      height: 1,
      coverage: coverageOf(1, 1, [255]),
    });
    expect(ok).toBe(true);
    expect([...filtered]).toEqual([...snapshot]);
  });

  it("전부 검정(0) 마스크는 원본으로 완전히 되돌린다", () => {
    const filtered = rgba([10, 20, 30, 255], [200, 150, 100, 128]);
    const original = rgba([1, 2, 3, 4], [5, 6, 7, 8]);
    applyFilterMaskToPixels({
      target: filtered,
      original,
      width: 2,
      height: 1,
      coverage: coverageOf(1, 1, [0]),
    });
    expect([...filtered]).toEqual([...original]);
  });

  it("회색 마스크는 선형 블렌드(알파 채널 포함 4채널 전부)", () => {
    const filtered = rgba([255, 0, 255, 255]);
    const original = rgba([0, 255, 0, 0]);
    applyFilterMaskToPixels({
      target: filtered,
      original,
      width: 1,
      height: 1,
      coverage: coverageOf(1, 1, [128]),
    });
    const m = 128 / 255;
    expect(filtered[0]).toBe(Math.round(255 * m));
    expect(filtered[1]).toBe(Math.round(255 * (1 - m)));
    expect(filtered[2]).toBe(Math.round(255 * m));
    expect(filtered[3]).toBe(Math.round(255 * m));
  });

  it("마스크 해상도 != 대상 해상도면 정규화 좌표로 스케일 샘플한다", () => {
    // 2px 마스크[0,255] → 4px 대상: 왼쪽 절반 원본, 오른쪽 절반 필터, 중간은 보간.
    const filtered = solid(4, 1, [255, 255, 255, 255]);
    const original = solid(4, 1, [0, 0, 0, 0]);
    applyFilterMaskToPixels({
      target: filtered,
      original,
      width: 4,
      height: 1,
      coverage: coverageOf(2, 1, [0, 255]),
    });
    expect(filtered[0]).toBe(0); // u=0.125 → 마스크 왼끝 클램프
    expect(filtered[4]).toBe(64); // u=0.375 → 보간 63.75 → 반올림 64
    expect(filtered[8]).toBe(191); // u=0.625 → 보간 191.25 → 반올림 191
    expect(filtered[12]).toBe(255); // u=0.875 → 마스크 오른끝 클램프
  });

  it("flipX 변환은 마스크 u를 거울 반전해 샘플한다(반전 구운 표시 버퍼용)", () => {
    const filtered = solid(2, 1, [255, 255, 255, 255]);
    const original = solid(2, 1, [0, 0, 0, 0]);
    applyFilterMaskToPixels({
      target: filtered,
      original,
      width: 2,
      height: 1,
      coverage: coverageOf(2, 1, [0, 255]),
      transform: { flipX: true },
    });
    // 반전이라 왼쪽 픽셀이 마스크 오른쪽(255=필터), 오른쪽 픽셀이 마스크 왼쪽(0=원본).
    expect(filtered[0]).toBe(255);
    expect(filtered[4]).toBe(0);
  });

  it("flipY 변환은 마스크 v를 거울 반전해 샘플한다", () => {
    const filtered = solid(1, 2, [255, 255, 255, 255]);
    const original = solid(1, 2, [0, 0, 0, 0]);
    applyFilterMaskToPixels({
      target: filtered,
      original,
      width: 1,
      height: 2,
      coverage: coverageOf(1, 2, [0, 255]),
      transform: { flipY: true },
    });
    expect(filtered[3]).toBe(255);
    expect(filtered[7]).toBe(0);
  });

  it("padRatio는 패딩을 걷어낸 콘텐츠 창으로 매핑하고 패딩 영역은 가장자리 클램프", () => {
    // 4px 대상, 양쪽 1px 패딩(padRatio=0.25) → 가운데 2px가 콘텐츠. 마스크[0,255].
    const filtered = solid(4, 1, [255, 255, 255, 255]);
    const original = solid(4, 1, [0, 0, 0, 0]);
    applyFilterMaskToPixels({
      target: filtered,
      original,
      width: 4,
      height: 1,
      coverage: coverageOf(2, 1, [0, 255]),
      transform: { padRatioX: 0.25 },
    });
    expect(filtered[0]).toBe(0); // 왼쪽 패딩 → 콘텐츠 왼끝 클램프(원본)
    expect(filtered[4]).toBe(0); // 콘텐츠 왼쪽 픽셀
    expect(filtered[8]).toBe(255); // 콘텐츠 오른쪽 픽셀
    expect(filtered[12]).toBe(255); // 오른쪽 패딩 → 콘텐츠 오른끝 클램프(필터)
  });

  it("잘못된 padRatio(음수/0.5 이상/비유한)는 0으로 무시된다", () => {
    const expected = solid(2, 1, [255, 255, 255, 255]);
    for (const padRatioX of [-0.2, 0.5, 0.9, Number.NaN]) {
      const filtered = solid(2, 1, [255, 255, 255, 255]);
      applyFilterMaskToPixels({
        target: filtered,
        original: solid(2, 1, [0, 0, 0, 0]),
        width: 2,
        height: 1,
        coverage: coverageOf(1, 1, [255]),
        transform: { padRatioX },
      });
      expect([...filtered]).toEqual([...expected]);
    }
  });

  it("치수/버퍼 불일치·퇴화 치수는 false를 반환하고 target을 건드리지 않는다", () => {
    const target = rgba([9, 9, 9, 9]);
    const snapshot = new Uint8ClampedArray(target);
    const coverage = coverageOf(1, 1, [0]);
    expect(applyFilterMaskToPixels({
      target,
      original: rgba([0, 0, 0, 0], [0, 0, 0, 0]),
      width: 1,
      height: 1,
      coverage,
    })).toBe(false);
    expect(applyFilterMaskToPixels({
      target,
      original: rgba([0, 0, 0, 0]),
      width: 0,
      height: 1,
      coverage,
    })).toBe(false);
    expect(applyFilterMaskToPixels({
      target,
      original: rgba([0, 0, 0, 0]),
      width: 2,
      height: 1,
      coverage,
    })).toBe(false);
    expect([...target]).toEqual([...snapshot]);
  });

  it("original 버퍼는 절대 변형하지 않는다(공유 스냅샷 재사용 안전)", () => {
    const original = rgba([1, 2, 3, 4]);
    const snapshot = new Uint8ClampedArray(original);
    applyFilterMaskToPixels({
      target: rgba([200, 200, 200, 200]),
      original,
      width: 1,
      height: 1,
      coverage: coverageOf(1, 1, [64]),
    });
    expect([...original]).toEqual([...snapshot]);
  });

  it("결정적 — 같은 입력으로 두 번 실행해도 결과가 동일하다", () => {
    const run = () => {
      const target = rgba([255, 128, 3, 250], [17, 210, 90, 40]);
      applyFilterMaskToPixels({
        target,
        original: rgba([0, 60, 200, 10], [255, 5, 5, 255]),
        width: 2,
        height: 1,
        coverage: coverageOf(3, 1, [30, 140, 250]),
      });
      return [...target];
    };
    expect(run()).toEqual(run());
  });
});

describe("blendFilterMaskedPixels", () => {
  it("새 버퍼를 돌려주고 입력 두 버퍼 모두 보존한다", () => {
    const filtered = rgba([255, 255, 255, 255]);
    const original = rgba([0, 0, 0, 0]);
    const filteredSnapshot = new Uint8ClampedArray(filtered);
    const out = blendFilterMaskedPixels({
      filtered,
      original,
      width: 1,
      height: 1,
      coverage: coverageOf(1, 1, [0]),
    });
    expect(out).not.toBe(filtered);
    expect([...out]).toEqual([...original]);
    expect([...filtered]).toEqual([...filteredSnapshot]);
  });

  it("퇴화 입력이면 블렌드 없는 filtered 사본(항등 fail-closed)", () => {
    const filtered = rgba([9, 8, 7, 6]);
    const out = blendFilterMaskedPixels({
      filtered,
      original: rgba([0, 0, 0, 0], [0, 0, 0, 0]),
      width: 1,
      height: 1,
      coverage: coverageOf(1, 1, [0]),
    });
    expect([...out]).toEqual([...filtered]);
  });
});

// ---------------------------------------------------------------------------
// wrapKonvaFiltersWithFilterMask — [스냅샷, ...체인, 블렌드] 순차 실행 계약
// ---------------------------------------------------------------------------

describe("wrapKonvaFiltersWithFilterMask", () => {
  const setAll = (value: number) => (imageData: FilterMaskImageDataLike): void => {
    imageData.data.fill(value);
  };

  function runPipeline(
    filters: readonly ((imageData: FilterMaskImageDataLike) => void)[],
    imageData: FilterMaskImageDataLike
  ): void {
    for (const filter of filters) filter(imageData);
  }

  it("빈 체인은 빈 배열 그대로(마스킹할 필터 결과가 없음)", () => {
    expect(wrapKonvaFiltersWithFilterMask([], coverageOf(1, 1, [0]))).toEqual([]);
  });

  it("스냅샷→체인→블렌드 순서로 감싸 마스크 밖 픽셀을 원본으로 되돌린다", () => {
    const wrapped = wrapKonvaFiltersWithFilterMask(
      [setAll(100)],
      coverageOf(2, 1, [255, 0])
    );
    expect(wrapped).toHaveLength(3);
    const imageData = { data: rgba([10, 20, 30, 40], [50, 60, 70, 80]), width: 2, height: 1 };
    runPipeline(wrapped, imageData);
    // 왼쪽(마스크 255)=필터 결과 100, 오른쪽(마스크 0)=체인 실행 전 원본.
    expect([...imageData.data]).toEqual([100, 100, 100, 100, 50, 60, 70, 80]);
  });

  it("체인 여러 개도 마지막 결과 기준으로 블렌드한다", () => {
    const wrapped = wrapKonvaFiltersWithFilterMask(
      [setAll(10), setAll(200)],
      coverageOf(1, 1, [0])
    );
    const imageData = { data: rgba([1, 2, 3, 4]), width: 1, height: 1 };
    runPipeline(wrapped, imageData);
    expect([...imageData.data]).toEqual([1, 2, 3, 4]);
  });

  it("스냅샷과 블렌드 치수가 어긋나면 블렌드를 건너뛴다(방어)", () => {
    const wrapped = wrapKonvaFiltersWithFilterMask([setAll(200)], coverageOf(1, 1, [0]));
    const first = { data: rgba([1, 2, 3, 4]), width: 1, height: 1 };
    wrapped[0]!(first); // 1×1 스냅샷
    const mismatched = { data: rgba([9, 9, 9, 9], [9, 9, 9, 9]), width: 2, height: 1 };
    wrapped[1]!(mismatched);
    wrapped[2]!(mismatched); // 치수 불일치 — 블렌드 없이 체인 결과 유지
    expect([...mismatched.data]).toEqual([200, 200, 200, 200, 200, 200, 200, 200]);
  });

  it("한 파이프라인을 두 번 돌려도(재캐시) 같은 결과 — 스냅샷이 매 실행 갱신된다", () => {
    const wrapped = wrapKonvaFiltersWithFilterMask([setAll(255)], coverageOf(1, 1, [0]));
    const run = () => {
      const imageData = { data: rgba([11, 22, 33, 44]), width: 1, height: 1 };
      runPipeline(wrapped, imageData);
      return [...imageData.data];
    };
    expect(run()).toEqual([11, 22, 33, 44]);
    expect(run()).toEqual([11, 22, 33, 44]);
  });
});
