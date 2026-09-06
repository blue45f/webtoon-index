import { describe, expect, it } from "vitest";

import {
  HISTORY_BRUSH_HARDNESS_DEFAULT,
  HISTORY_BRUSH_HARDNESS_RANGE,
  HISTORY_BRUSH_OPACITY_DEFAULT,
  HISTORY_BRUSH_OPACITY_RANGE,
  HISTORY_BRUSH_RADIUS_DEFAULT,
  HISTORY_BRUSH_RADIUS_RANGE,
  applyHistoryBrushDabs,
  bakeHistoryBrushStrokeToCanvas,
  computeHistoryBrushAvailability,
  planHistoryBrushDabs,
  resolveHistoryBrushSource,
  stampHistoryBrushDab,
  type HistoryBrushCanvasFactory,
  type HistoryBrushCtx2DLike,
  type HistoryBrushDab,
  type HistoryBrushSnapshot,
} from "./studio-history-brush";

import type { StudioImageDataLike } from "./studio-filters";
import type { MaskCanvasLike, MaskImageSource } from "./studio-selection-tools";

// ---------------------------------------------------------------------------
// 픽스처 헬퍼(studio-heal-clone.test.ts 와 동일 관례)
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

function pixelAt(img: StudioImageDataLike, x: number, y: number): [number, number, number, number] {
  const idx = (y * img.width + x) * 4;
  return [img.data[idx]!, img.data[idx + 1]!, img.data[idx + 2]!, img.data[idx + 3]!];
}

function cloneImage(img: StudioImageDataLike): StudioImageDataLike {
  return { data: img.data.slice() as Uint8ClampedArray, width: img.width, height: img.height };
}

// ---------------------------------------------------------------------------
// 상수 테이블
// ---------------------------------------------------------------------------

describe("상수", () => {
  it("범위·기본값이 서로 정합적이다", () => {
    expect(HISTORY_BRUSH_RADIUS_DEFAULT).toBeGreaterThanOrEqual(HISTORY_BRUSH_RADIUS_RANGE.min);
    expect(HISTORY_BRUSH_RADIUS_DEFAULT).toBeLessThanOrEqual(HISTORY_BRUSH_RADIUS_RANGE.max);
    expect(HISTORY_BRUSH_HARDNESS_DEFAULT).toBeGreaterThanOrEqual(HISTORY_BRUSH_HARDNESS_RANGE.min);
    expect(HISTORY_BRUSH_HARDNESS_DEFAULT).toBeLessThanOrEqual(HISTORY_BRUSH_HARDNESS_RANGE.max);
    expect(HISTORY_BRUSH_OPACITY_DEFAULT).toBeGreaterThanOrEqual(HISTORY_BRUSH_OPACITY_RANGE.min);
    expect(HISTORY_BRUSH_OPACITY_DEFAULT).toBeLessThanOrEqual(HISTORY_BRUSH_OPACITY_RANGE.max);
  });
});

// ---------------------------------------------------------------------------
// (A) 소스 해석
// ---------------------------------------------------------------------------

describe("resolveHistoryBrushSource", () => {
  const snapshot: HistoryBrushSnapshot = [
    { id: "page-1", elements: [{ id: "el-1", type: "image", src: "data:image/png;base64,AAA" }] },
    {
      id: "page-2",
      elements: [
        { id: "el-2", type: "text", src: undefined },
        { id: "el-3", type: "image", src: 123 }, // src 가 string 이 아님(방어적 케이스)
      ],
    },
  ];

  it("페이지+요소 id가 모두 일치하는 이미지면 src를 반환한다", () => {
    expect(resolveHistoryBrushSource(snapshot, "page-1", "el-1")).toEqual({
      ok: true,
      src: "data:image/png;base64,AAA",
    });
  });

  it("페이지 id가 그 시점에 없으면 page-not-found", () => {
    expect(resolveHistoryBrushSource(snapshot, "page-404", "el-1")).toEqual({
      ok: false,
      reason: "page-not-found",
    });
  });

  it("페이지는 있지만 요소 id가 없으면 element-not-found", () => {
    expect(resolveHistoryBrushSource(snapshot, "page-1", "el-404")).toEqual({
      ok: false,
      reason: "element-not-found",
    });
  });

  it("같은 id 요소가 있어도 image 타입이 아니면 not-image", () => {
    expect(resolveHistoryBrushSource(snapshot, "page-2", "el-2")).toEqual({
      ok: false,
      reason: "not-image",
    });
  });

  it("image 타입이어도 src가 string이 아니면 not-image(방어적)", () => {
    expect(resolveHistoryBrushSource(snapshot, "page-2", "el-3")).toEqual({
      ok: false,
      reason: "not-image",
    });
  });
});

describe("computeHistoryBrushAvailability", () => {
  it("히스토리 목록 각 항목의 지정 가능 여부를 인덱스가 맞는 배열로 반환한다", () => {
    const history: HistoryBrushSnapshot[] = [
      [{ id: "p1", elements: [] }], // 0: 아직 요소가 생기기 전
      [{ id: "p1", elements: [{ id: "el-1", type: "image", src: "data:a" }] }], // 1: 이미지 추가됨
      [{ id: "p1", elements: [{ id: "el-1", type: "text", src: undefined }] }], // 2: 같은 id인데 타입이 바뀜(비정상 케이스지만 방어)
    ];
    expect(computeHistoryBrushAvailability(history, "p1", "el-1")).toEqual([false, true, false]);
  });

  it("빈 히스토리는 빈 배열", () => {
    expect(computeHistoryBrushAvailability([], "p1", "el-1")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// (B) 기하 — planHistoryBrushDabs
// ---------------------------------------------------------------------------

describe("planHistoryBrushDabs", () => {
  it("flip 없이 정규화 점을 디바이스 px 로 환산한다(오프셋 없음 — 소스=목적지 같은 좌표)", () => {
    const dabs = planHistoryBrushDabs([{ x: 0.2, y: 0.3 }], 200, 100);
    expect(dabs).toEqual([{ x: 40, y: 30 }]);
  });

  it("점 여러 개 — 순서대로 도장 목록을 만든다", () => {
    const dabs = planHistoryBrushDabs(
      [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
      100,
      100
    );
    expect(dabs).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 100 },
    ]);
  });

  it("flipX 는 x축을 뒤집는다", () => {
    const dabs = planHistoryBrushDabs([{ x: 0.2, y: 0.3 }], 200, 100, { flipX: true });
    expect(dabs).toEqual([{ x: 160, y: 30 }]); // (1-0.2)*200=160
  });

  it("flipY 는 y축을 뒤집는다", () => {
    const dabs = planHistoryBrushDabs([{ x: 0.2, y: 0.3 }], 200, 100, { flipY: true });
    expect(dabs).toEqual([{ x: 40, y: 70 }]); // (1-0.3)*100=70
  });

  it("flipX+flipY 동시 적용", () => {
    const dabs = planHistoryBrushDabs([{ x: 0.2, y: 0.3 }], 200, 100, { flipX: true, flipY: true });
    expect(dabs).toEqual([{ x: 160, y: 70 }]);
  });

  it("이미지 크기가 0/비유한이면 빈 배열", () => {
    expect(planHistoryBrushDabs([{ x: 0.5, y: 0.5 }], 0, 100)).toEqual([]);
    expect(planHistoryBrushDabs([{ x: 0.5, y: 0.5 }], 100, Number.NaN)).toEqual([]);
  });

  it("빈 목적지 궤적 → 빈 배열", () => {
    expect(planHistoryBrushDabs([], 100, 100)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// (C) stampHistoryBrushDab / applyHistoryBrushDabs
// ---------------------------------------------------------------------------

describe("stampHistoryBrushDab", () => {
  it("hardness=1 + opacity=1: 반경 안 픽셀은 historySrc 로 완전히 교체된다(색 이동 없음)", () => {
    const historySrc = solidImage(20, 20, 200, 100, 50);
    const current = solidImage(20, 20, 10, 10, 10);
    const dab: HistoryBrushDab = { x: 5, y: 5 };
    stampHistoryBrushDab(historySrc, current, dab, 3, 1, 1);
    expect(pixelAt(current, 5, 5)).toEqual([200, 100, 50, 255]);
  });

  it("반경 밖 픽셀은 건드리지 않는다", () => {
    const historySrc = solidImage(20, 20, 255, 255, 255);
    const current = solidImage(20, 20, 10, 10, 10);
    const dab: HistoryBrushDab = { x: 10, y: 10 };
    stampHistoryBrushDab(historySrc, current, dab, 2, 1, 1);
    expect(pixelAt(current, 0, 0)).toEqual([10, 10, 10, 255]);
  });

  it("hardness=0: 중심은 완전 불투명, 가장자리로 갈수록 알파가 줄어든다", () => {
    const historySrc = solidImage(20, 20, 255, 0, 0);
    const current = solidImage(20, 20, 0, 0, 0);
    const dab: HistoryBrushDab = { x: 10, y: 10 };
    stampHistoryBrushDab(historySrc, current, dab, 10, 0, 1);
    const [centerR] = pixelAt(current, 10, 10);
    const [nearEdgeR] = pixelAt(current, 18, 10); // dist=8, edgeStart=0, span=10 → alpha=1-8/10=0.2
    expect(centerR).toBe(255);
    expect(nearEdgeR).toBeGreaterThan(0);
    expect(nearEdgeR).toBeLessThan(centerR);
  });

  it("opacity<1 로 같은 도장을 반복 적용하면 표준 알파 합성으로 누적된다", () => {
    const historySrc = solidImage(4, 4, 255, 255, 255);
    const current = solidImage(4, 4, 0, 0, 0);
    const dab: HistoryBrushDab = { x: 2, y: 2 };
    stampHistoryBrushDab(historySrc, current, dab, 1, 1, 0.5);
    const once = pixelAt(current, 2, 2)[0];
    expect(once).toBeGreaterThanOrEqual(127);
    expect(once).toBeLessThanOrEqual(128);
    stampHistoryBrushDab(historySrc, current, dab, 1, 1, 0.5);
    const twice = pixelAt(current, 2, 2)[0];
    expect(twice).toBeGreaterThan(once);
  });

  it("알파 채널도 시프트 없이 그대로 복사된다 — 과거 시점이 투명이었으면 다시 투명해진다", () => {
    const historySrc = solidImage(10, 10, 200, 200, 200, 0); // 완전 투명(RGB 는 안 보이는 잔여값)
    const current = solidImage(10, 10, 50, 50, 50, 255);
    const dab: HistoryBrushDab = { x: 5, y: 5 };
    // hardness=1,opacity=1,중심(dist=0)이라 블렌드 alpha=1(완전 교체) — RGB도 historySrc 값(200)
    // 그대로, 알파도 historySrc 의 0 그대로 옮겨진다(시프트 없음이 곧 "그대로 복사"라는 의미).
    stampHistoryBrushDab(historySrc, current, dab, 3, 1, 1);
    expect(pixelAt(current, 5, 5)).toEqual([200, 200, 200, 0]);
  });

  it("historySrc/current 폭·높이가 서로 달라도 겹치는 영역만 그려지고 크래시하지 않는다", () => {
    const historySrc = solidImage(6, 6, 255, 0, 0); // 더 좁은 히스토리 소스(과거 크롭 등으로 작아진 경우)
    const current = solidImage(20, 20, 0, 0, 0);
    const dab: HistoryBrushDab = { x: 5, y: 5 };
    expect(() => stampHistoryBrushDab(historySrc, current, dab, 3, 1, 1)).not.toThrow();
    expect(pixelAt(current, 5, 5)).toEqual([255, 0, 0, 255]); // 두 버퍼 안쪽 — 정상 반영.
    // (8,5)는 historySrc(6x6) 밖이라 건드려지지 않아야 한다.
    expect(pixelAt(current, 8, 5)).toEqual([0, 0, 0, 255]);
  });

  it("radiusPx<=0, opacity<=0, 비유한 입력은 아무 변화도 만들지 않는다(무연산)", () => {
    const historySrc = solidImage(10, 10, 255, 255, 255);
    const current = solidImage(10, 10, 0, 0, 0);
    const before = cloneImage(current);
    const dab: HistoryBrushDab = { x: 5, y: 5 };
    stampHistoryBrushDab(historySrc, current, dab, 0, 1, 1);
    stampHistoryBrushDab(historySrc, current, dab, 5, 1, 0);
    stampHistoryBrushDab(historySrc, current, dab, Number.NaN, 1, 1);
    stampHistoryBrushDab(historySrc, current, { x: Number.NaN, y: 5 }, 5, 1, 1);
    expect(current.data).toEqual(before.data);
  });
});

describe("applyHistoryBrushDabs", () => {
  it("도장이 여러 개면 각자 자기 좌표에서 히스토리 픽셀을 읽어 같은 좌표에 그대로 복원한다", () => {
    // 오프셋이 없으므로(소스=목적지 같은 좌표) heal-clone 처럼 "다른 위치에서 복제해와 같은 자리에
    // 겹쳐 칠하는" 시나리오 자체가 성립하지 않는다 — 대신 한 번의 호출에 여러 dab을 넘겼을 때
    // 각각이 독립적으로 자기 좌표의 히스토리 값을 정확히 복원하는지를 검증한다(순서와 무관하게
    // 서로 다른 좌표는 서로 간섭하지 않아야 한다).
    const historySrc = paintedImage(20, 20, (x) => (x < 10 ? [0, 0, 0, 255] : [255, 255, 255, 255]));
    const current = solidImage(20, 20, 128, 128, 128);
    applyHistoryBrushDabs(historySrc, current, [{ x: 2, y: 10 }, { x: 15, y: 10 }], 1, 1, 1);
    expect(pixelAt(current, 2, 10)).toEqual([0, 0, 0, 255]);
    expect(pixelAt(current, 15, 10)).toEqual([255, 255, 255, 255]);
  });

  it("빈 도장 목록은 아무것도 하지 않는다", () => {
    const historySrc = solidImage(4, 4, 1, 2, 3);
    const current = solidImage(4, 4, 9, 9, 9);
    const before = cloneImage(current);
    applyHistoryBrushDabs(historySrc, current, [], 2, 1, 1);
    expect(current.data).toEqual(before.data);
  });
});

// ---------------------------------------------------------------------------
// (D) bakeHistoryBrushStrokeToCanvas — DOM 없는 가짜 팩토리
// ---------------------------------------------------------------------------

type FakeCanvas = MaskCanvasLike & MaskImageSource & { id: number };
type FakeSource = MaskImageSource & { testImage: StudioImageDataLike };

/** 생성 순서대로 id 를 붙이고 drawImage(4-인자 스케일 그리기 포함)/getImageData/putImageData 를
 * 인메모리 버퍼로 흉내내는 가짜 팩토리(studio-heal-clone.test.ts 의 fakeHealCloneFactory 와 동일
 * 관례, drawImage 만 4-인자를 받아 목적지 크기(dw,dh)로 버퍼를 채운다). */
function fakeHistoryBrushFactory(
  log: string[],
  buffers: Map<number, StudioImageDataLike>,
  failAt = Infinity
): HistoryBrushCanvasFactory {
  let count = 0;
  return (width, height) => {
    count += 1;
    if (count >= failAt) return null;
    const id = count;
    const canvas: FakeCanvas = { id, width, height };
    buffers.set(id, { data: new Uint8ClampedArray(width * height * 4), width, height });
    const ctx: HistoryBrushCtx2DLike = {
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
      // dw/dh 를 선택적으로 받는다(실제 CanvasRenderingContext2D.drawImage 의 2/4-인자 오버로드를
      // 하나의 함수 값으로 함께 만족시켜야 HistoryBrushCtx2DLike 의 교차 타입에 대입할 수 있다).
      drawImage: (image: MaskImageSource, _dx: number, _dy: number, dw?: number, dh?: number) => {
        log.push(`c${id}:drawImage`);
        const testImage = (image as FakeSource).testImage;
        // 실제 CanvasRenderingContext2D 의 스케일 그리기를 흉내내되, 테스트 픽스처는 항상 목적지와
        // 같은 크기로만 만들어 늘림/줄임 보간을 검증하지 않는다(원본 그대로 복사) — 크롭 이후처럼
        // 크기가 실제로 다른 시나리오는 "겹치는 영역만 그려진다" stamp 레벨 테스트로 이미 커버된다.
        buffers.set(id, { data: testImage.data.slice() as Uint8ClampedArray, width: dw ?? width, height: dh ?? height });
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

describe("bakeHistoryBrushStrokeToCanvas", () => {
  const brush: import("./studio-history-brush").HistoryBrushSettings = { radiusPx: 3, hardness: 1, opacity: 1 };

  it("도장이 없으면 캔버스를 아예 만들지 않고 null", () => {
    const log: string[] = [];
    const buffers = new Map<number, StudioImageDataLike>();
    const factory = fakeHistoryBrushFactory(log, buffers);
    const historySource: FakeSource = { testImage: solidImage(10, 10, 1, 1, 1) };
    const currentSource: FakeSource = { testImage: solidImage(10, 10, 2, 2, 2) };
    const out = bakeHistoryBrushStrokeToCanvas(historySource, currentSource, 10, 10, [], brush, factory);
    expect(out).toBeNull();
    expect(log).toEqual([]);
  });

  it("frozen(히스토리)/work(현재) 캔버스를 순서대로 만들고, work 만 putImageData 로 갱신해 반환한다", () => {
    const log: string[] = [];
    const buffers = new Map<number, StudioImageDataLike>();
    const factory = fakeHistoryBrushFactory(log, buffers);
    const historyImage = paintedImage(10, 10, () => [255, 255, 255, 255]); // 과거 시점: 전부 흰색
    const currentImage = paintedImage(10, 10, () => [0, 0, 0, 255]); // 지금: 전부 검정(그 부분이 지워짐/변형됨)
    const historySource: FakeSource = { testImage: historyImage };
    const currentSource: FakeSource = { testImage: currentImage };
    const dabs: HistoryBrushDab[] = [{ x: 2, y: 5 }]; // (2,5) 자리만 과거(흰색)로 복원.

    const out = bakeHistoryBrushStrokeToCanvas(historySource, currentSource, 10, 10, dabs, brush, factory);

    expect(out).not.toBeNull();
    expect((out as FakeCanvas).id).toBe(2); // work 캔버스(두 번째 생성)가 반환된다.
    expect(log).toEqual([
      "c1:drawImage",
      "c2:drawImage",
      "c1:getImageData",
      "c2:getImageData",
      "c2:putImageData",
    ]);

    const workBuf = buffers.get(2)!;
    const frozenBuf = buffers.get(1)!;
    expect(pixelAt(workBuf, 2, 5)).toEqual([255, 255, 255, 255]); // 지정한 자리만 과거 픽셀로 복원됨.
    expect(pixelAt(workBuf, 8, 5)).toEqual([0, 0, 0, 255]); // 나머지는 그대로 현재(검정) 유지.
    expect(pixelAt(frozenBuf, 2, 5)).toEqual([255, 255, 255, 255]); // frozen(히스토리)은 절대 변형되지 않는다.

    // 직접 applyHistoryBrushDabs 를 호출한 결과와 정확히 일치해야 한다(오케스트레이션이 알고리즘을 바꾸지 않음).
    const expectedDst = cloneImage(currentImage);
    applyHistoryBrushDabs(historyImage, expectedDst, dabs, brush.radiusPx, brush.hardness, brush.opacity);
    expect(workBuf.data).toEqual(expectedDst.data);
  });

  it("두 번째 캔버스(work) 생성이 실패하면 null(첫 캔버스는 그냥 버려진다)", () => {
    const log: string[] = [];
    const buffers = new Map<number, StudioImageDataLike>();
    const factory = fakeHistoryBrushFactory(log, buffers, 2); // 2번째 생성부터 실패.
    const historySource: FakeSource = { testImage: solidImage(10, 10, 1, 1, 1) };
    const currentSource: FakeSource = { testImage: solidImage(10, 10, 2, 2, 2) };
    const dabs: HistoryBrushDab[] = [{ x: 5, y: 5 }];
    const out = bakeHistoryBrushStrokeToCanvas(historySource, currentSource, 10, 10, dabs, brush, factory);
    expect(out).toBeNull();
  });

  it("width/height 가 비정상이면 캔버스를 만들지 않고 null", () => {
    const log: string[] = [];
    const buffers = new Map<number, StudioImageDataLike>();
    const factory = fakeHistoryBrushFactory(log, buffers);
    const historySource: FakeSource = { testImage: solidImage(10, 10, 1, 1, 1) };
    const currentSource: FakeSource = { testImage: solidImage(10, 10, 2, 2, 2) };
    const dabs: HistoryBrushDab[] = [{ x: 5, y: 5 }];
    expect(bakeHistoryBrushStrokeToCanvas(historySource, currentSource, 0, 10, dabs, brush, factory)).toBeNull();
    expect(
      bakeHistoryBrushStrokeToCanvas(historySource, currentSource, 10, Number.NaN, dabs, brush, factory)
    ).toBeNull();
    expect(log).toEqual([]);
  });
});
