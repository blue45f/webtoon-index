import { describe, expect, it } from "vitest";

import { studioHokusaiSourceRevision } from "./studio-hokusai-natural-media-contract";
import { planStudioHokusaiNaturalMediaReplacement } from "./studio-hokusai-natural-media-replacement";

import type { DrawEl, El, ImageEl } from "../studio-element-model";
import type { LayerGroup } from "../studio-layers";
import type { StudioHokusaiNaturalMediaProductResult } from "./studio-hokusai-natural-media-product";

function drawEl(overrides: Partial<DrawEl> = {}): DrawEl {
  return {
    id: "draw-1",
    type: "draw",
    kind: "freehand",
    points: [0, 0, 10, 10],
    stroke: "#111111",
    strokeWidth: 4,
    ...overrides,
  };
}

function productResult(
  source: DrawEl,
  overrides: Partial<StudioHokusaiNaturalMediaProductResult> = {},
): StudioHokusaiNaturalMediaProductResult {
  return {
    src: "data:image/png;base64,iVBORw0KGgo=",
    rasterWidth: 32,
    rasterHeight: 24,
    logicalBounds: { x: 8, y: 9, width: 24, height: 18 },
    sourceElementId: source.id,
    sourceRevision: studioHokusaiSourceRevision(source),
    name: "Hokusai 연필",
    message: "Hokusai 자연매체 변환 완료",
    receipt: {} as StudioHokusaiNaturalMediaProductResult["receipt"],
    ...overrides,
  };
}

const NO_GROUPS: LayerGroup[] = [];

describe("planStudioHokusaiNaturalMediaReplacement", () => {
  it("원본 벡터를 숨겨 보존하고 그 바로 위에 래스터를 끼운다", () => {
    const source = drawEl({ name: "선화 A" });
    const other: El = drawEl({ id: "draw-2" });
    const elements: El[] = [source, other];

    const plan = planStudioHokusaiNaturalMediaReplacement(
      elements,
      NO_GROUPS,
      productResult(source),
    );

    expect(plan).not.toBeNull();
    const { nextElements, rasterId } = plan!;
    expect(nextElements).toHaveLength(3);

    // 원본은 제자리에 남되 숨김 + 이름 표식.
    const hidden = nextElements[0] as DrawEl;
    expect(hidden.id).toBe("draw-1");
    expect(hidden.hidden).toBe(true);
    expect(hidden.name).toBe("선화 A · Hokusai 원본 벡터");

    // 래스터는 원본 바로 위(index+1).
    const raster = nextElements[1] as ImageEl;
    expect(raster.id).toBe(rasterId);
    expect(raster.type).toBe("image");
    expect(raster).toMatchObject({ x: 8, y: 9, width: 24, height: 18, rotation: 0 });

    // 뒤 요소는 밀리기만 하고 그대로.
    expect(nextElements[2]).toBe(other);
    // 입력 배열은 변형하지 않는다.
    expect(elements).toHaveLength(2);
    expect(elements[0]).toBe(source);
  });

  it("이름이 없으면 브러시명, 그마저 없으면 기본 라벨로 표식한다", () => {
    const brushed = drawEl({ name: undefined, brush: "pencil" });
    expect(
      (planStudioHokusaiNaturalMediaReplacement(
        [brushed],
        NO_GROUPS,
        productResult(brushed),
      )!.nextElements[0] as DrawEl).name,
    ).toBe("pencil · Hokusai 원본 벡터");

    const bare = drawEl({ name: undefined, brush: undefined });
    expect(
      (planStudioHokusaiNaturalMediaReplacement(
        [bare],
        NO_GROUPS,
        productResult(bare),
      )!.nextElements[0] as DrawEl).name,
    ).toBe("선화 · Hokusai 원본 벡터");
  });

  it("원본의 레이어 귀속 메타데이터만 골라 래스터에 옮긴다", () => {
    const source = drawEl({
      groupId: "group-1",
      blendMode: "multiply",
      alphaLocked: true,
      layerRole: "lineart",
      layerColor: "red",
    });

    const raster = planStudioHokusaiNaturalMediaReplacement(
      [source],
      NO_GROUPS,
      productResult(source),
    )!.nextElements[1] as ImageEl;

    expect(raster).toMatchObject({
      groupId: "group-1",
      blendMode: "multiply",
      alphaLocked: true,
      layerRole: "lineart",
      layerColor: "red",
      lockAspect: true,
    });
    // 미설정 광학 속성은 키 자체를 만들지 않는다.
    expect("noClip" in raster).toBe(false);
    expect("clipBelow" in raster).toBe(false);
  });

  it("원본이 사라졌거나 draw 가 아니면 반영하지 않는다", () => {
    const source = drawEl();
    expect(
      planStudioHokusaiNaturalMediaReplacement([], NO_GROUPS, productResult(source)),
    ).toBeNull();

    const notDraw: El = {
      id: "draw-1",
      type: "image",
      src: "data:image/png;base64,AA==",
      x: 0,
      y: 0,
      width: 4,
      height: 4,
      rotation: 0,
    };
    expect(
      planStudioHokusaiNaturalMediaReplacement(
        [notDraw],
        NO_GROUPS,
        productResult(source),
      ),
    ).toBeNull();
  });

  it("잠긴 원본은 직접 잠금이든 그룹 상속이든 반영하지 않는다", () => {
    const locked = drawEl({ locked: true });
    expect(
      planStudioHokusaiNaturalMediaReplacement(
        [locked],
        NO_GROUPS,
        productResult(locked),
      ),
    ).toBeNull();

    const inGroup = drawEl({ groupId: "group-1" });
    expect(
      planStudioHokusaiNaturalMediaReplacement(
        [inGroup],
        [{ id: "group-1", name: "잠긴 그룹", locked: true }],
        productResult(inGroup),
      ),
    ).toBeNull();
  });

  it("워커가 도는 사이 원본이 바뀌면(리비전 불일치) 반영하지 않는다", () => {
    const source = drawEl();
    const staleResult = productResult(source);
    // 같은 id, 다른 기하 — 낙관적 동시성 가드가 잡아야 한다.
    const mutated = drawEl({ points: [0, 0, 99, 99] });

    expect(studioHokusaiSourceRevision(mutated)).not.toBe(staleResult.sourceRevision);
    expect(
      planStudioHokusaiNaturalMediaReplacement([mutated], NO_GROUPS, staleResult),
    ).toBeNull();
  });

  it("PNG data URL 이 아니거나 기하가 유효하지 않으면 반영하지 않는다", () => {
    const source = drawEl();
    const rejected: Partial<StudioHokusaiNaturalMediaProductResult>[] = [
      { src: "https://evil.example/x.png" as StudioHokusaiNaturalMediaProductResult["src"] },
      { logicalBounds: { x: Number.NaN, y: 0, width: 4, height: 4 } },
      { logicalBounds: { x: 0, y: Number.POSITIVE_INFINITY, width: 4, height: 4 } },
      { logicalBounds: { x: 0, y: 0, width: 0, height: 4 } },
      { logicalBounds: { x: 0, y: 0, width: 4, height: -1 } },
    ];

    for (const overrides of rejected) {
      expect(
        planStudioHokusaiNaturalMediaReplacement(
          [source],
          NO_GROUPS,
          productResult(source, overrides),
        ),
      ).toBeNull();
    }
  });
});
