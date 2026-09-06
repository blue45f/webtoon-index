import { describe, expect, it } from "vitest";

import { planStudioEmeresUnderlayElement } from "./studio-emeres-underlay-placement";

import type { StudioEmeresUnderlayInput } from "./studio-emeres-underlay-placement";

/**
 * 카탈로그 틀(addEmeresTemplate)과 개인 보관함 항목(addEmeresLibraryItem)은 이 계획기를 공유한다.
 * 두 경로가 갈라지지 않는지가 이 파일의 관심사이므로, 기본 입력은 하나만 두고 각 케이스가
 * 검사하려는 값만 덮어쓴다.
 */
function input(overrides: Partial<StudioEmeresUnderlayInput> = {}): StudioEmeresUnderlayInput {
  return {
    id: "underlay-1",
    src: "data:image/svg+xml;base64,PHN2Zy8+",
    sourceWidth: 100,
    sourceHeight: 100,
    opacity: 0.42,
    emeresSourceId: "emeres_face_each_other",
    frame: null,
    canvasWidth: 1000,
    canvasHeight: 1400,
    placement: { anchor: { x: 500, y: 700 } },
    ...overrides,
  };
}

describe("planStudioEmeresUnderlayElement — 칸이 선택된 경로", () => {
  it("칸 안에 6% 여백을 남기고 중앙에 세운다", () => {
    // 밑그림이 칸선까지 꽉 차면 그 위에 펜으로 그릴 여지가 사라진다. 0.94 축소는 그 여백이고,
    // 좁은 쪽(width 333 → 3.33배 vs height 222 → 2.22배)이 배율을 정한다는 것도 함께 못박는다.
    const el = planStudioEmeresUnderlayElement(
      input({ frame: { x: 7, y: 11, width: 333, height: 222 } }),
    );
    // fit = min(3.33, 2.22) * 0.94 = 2.0868 → 100 * 2.0868 = 208.68
    expect(el.width).toBe(209);
    expect(el.height).toBe(209);
    // 중앙 정렬 결과가 반픽셀(17.5)로 떨어져도 정수 좌표로 반올림돼야 Konva 렌더가 흐려지지 않는다.
    expect(el.x).toBe(69);
    expect(el.y).toBe(18);
    expect(el.rotation).toBe(0);
  });

  it("가로가 넘치는 밑그림은 넓은 쪽이 아니라 가로가 배율을 정한다", () => {
    // 위 케이스는 둘 다 세로가 좁은 칸이라, 배율이 min()이 아니라 그냥 height 비율이어도
    // 통과해 버린다. 가로로 긴 밑그림(1000x100)을 좁은 칸(110)에 넣어 반대 축이 배율을
    // 잡는 경우를 따로 못박는다 — height 비율만 봤다면 3.76배로 부풀어 칸 밖으로 튄다.
    const el = planStudioEmeresUnderlayElement(
      input({
        sourceWidth: 1000,
        sourceHeight: 100,
        frame: { x: 0, y: 0, width: 110, height: 400 },
      }),
    );
    // fit = min(110/1000, 400/100) * 0.94 = 0.1034 → 1000 * 0.1034 = 103.4
    expect(el.width).toBe(103);
    expect(el.height).toBe(10);
    // 가로 중앙 정렬이 반픽셀(3.5)로 떨어지는 배치라, x 쪽 반올림도 여기서 함께 잡힌다.
    expect(el.x).toBe(4);
    expect(el.y).toBe(195);
  });

  it("칸이 있으면 캔버스 크기와 placement를 쳐다보지 않는다", () => {
    // 호스트는 칸이 선택되면 placement를 아예 만들지 않고(삽입 캐스케이드 순번을 아끼려고)
    // undefined를 넘긴다. 그 호출이 캔버스 배치로 새지 않는다는 보장이 필요하다.
    const frame = { x: 100, y: 50, width: 400, height: 300 };
    const withPlacement = planStudioEmeresUnderlayElement(input({ frame }));
    const withoutPlacement = planStudioEmeresUnderlayElement(
      input({ frame, placement: undefined, canvasWidth: 1, canvasHeight: 1 }),
    );
    expect(withoutPlacement).toEqual(withPlacement);
    // fit = min(400/100, 300/100) * 0.94 = 2.82
    expect(withPlacement).toMatchObject({ x: 159, y: 59, width: 282, height: 282 });
  });
});

describe("planStudioEmeresUnderlayElement — 칸이 없는 경로", () => {
  it("건네받은 placement의 경계·앵커 안에서 자리를 잡는다", () => {
    // placement는 "지금 작업 중인 문서/칸 + 반복 삽입 캐스케이드"를 담은 호스트 상태다.
    // 계획기가 이 값을 무시하면 연속 삽입이 같은 자리에 겹쳐 쌓인다.
    const el = planStudioEmeresUnderlayElement(
      input({
        sourceWidth: 400,
        sourceHeight: 200,
        placement: {
          anchor: { x: 300, y: 400 },
          bounds: { x: 100, y: 100, width: 600, height: 600 },
          inset: 20,
        },
      }),
    );
    expect(el).toMatchObject({ width: 400, height: 200 });
    // 앵커 기준 좌상단은 x=100이지만 inset 20이 만든 안쪽 경계(120)로 밀려난다.
    expect(el).toMatchObject({ x: 120, y: 300 });
  });

  it("placement가 없으면 좌우 여백 80px로 캔버스에 맞춘다", () => {
    // 밑그림은 일반 소재보다 크게 깔아야 밑그림 구실을 한다 —
    // createCanvasImageElement 기본 여백(120)이 아니라 80을 쓴다는 뜻이고,
    // 기본값이었다면 width는 920이 아니라 880이 된다.
    const el = planStudioEmeresUnderlayElement(
      input({ sourceWidth: 1200, sourceHeight: 600, placement: undefined }),
    );
    expect(el).toMatchObject({ x: 40, y: 470, width: 920, height: 460 });
  });
});

describe("planStudioEmeresUnderlayElement — 두 경로가 공유하는 표식", () => {
  const frame = { x: 0, y: 0, width: 500, height: 500 };

  it("불투명도와 잠금을 양쪽 경로에 그대로 싣는다", () => {
    // 반투명(작가가 그 위에 그림을 그린다)과 잠금(밑그림이 포인터에 잡히면 안 된다)은
    // 이메레스 밑그림의 정의 그 자체라, 배치 분기와 무관하게 항상 붙어야 한다.
    for (const frameOrNull of [frame, null]) {
      const el = planStudioEmeresUnderlayElement(input({ frame: frameOrNull, opacity: 0.31 }));
      expect(el.opacity).toBe(0.31);
      expect(el.locked).toBe(true);
      expect(el.id).toBe("underlay-1");
      expect(el.type).toBe("image");
    }
  });

  it("카탈로그 id와 custom: 접두사 id를 그대로 emeresSourceId에 싣는다", () => {
    // "이메레스 밑그림 일괄 삭제"는 emeresSourceId 존재 여부만 본다. 두 출처가 서로 다른
    // 표식을 쓰되 둘 다 이 필드에 도달해야 한 번의 삭제로 함께 걷힌다.
    const catalog = planStudioEmeresUnderlayElement(
      input({ frame, emeresSourceId: "emeres_face_each_other" }),
    );
    const library = planStudioEmeresUnderlayElement(
      input({ frame: null, emeresSourceId: "custom:saved-1" }),
    );
    expect(catalog.emeresSourceId).toBe("emeres_face_each_other");
    expect(library.emeresSourceId).toBe("custom:saved-1");
  });
});
