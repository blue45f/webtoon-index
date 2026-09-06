import { describe, expect, it } from "vitest";

import { doubleBubblePathData } from "./lettering/studio-bubble-path";
import {
  buildThumbNodes,
  bubbleTailSpecOf,
  clampThumbStroke,
  clampThumbTextLines,
  computeDropSlot,
  downsamplePoints,
  dropIndicatorFor,
  dropSlotToReorderTarget,
  flatPointsBounds,
  isNoopDropSlot,
  joinTransforms,
  pointsToSvg,
  regularPolygonPoints,
  seededRandom,
  starPolygonPoints,
  svgFlipTransform,
  svgLocalTransform,
  svgRotateAround,
  type ThumbElement,
  type ThumbNode,
  type ThumbPageLike,
} from "./studio-page-thumbs";
import { reorderPages, type PageLike } from "./studio-pages";

import type { El } from "./studio-element-model";
import type { StudioPageDndItemProps } from "./StudioPageThumbnails";
import type { DragEventHandler } from "react";

function pageWith(elements: ThumbElement[], over: Partial<ThumbPageLike> = {}): ThumbPageLike {
  return {
    id: "page-1",
    elements,
    bg: "#ffffff",
    bgGrad: null,
    canvasH: 1080,
    ...over,
  };
}

describe("studio-page-thumbs — 통합 계약(타입 호환)", () => {
  it("StudioPage 의 El 이 ThumbElement 에 구조적으로 대입 가능해야 한다(썸네일이 실제 요소를 그대로 받음)", () => {
    // 대입 불가로 바뀌면 아래 상수가 false 타입이 되어 tsc 가 실패한다(컴파일 게이트).
    type ElAssignable = El extends ThumbElement ? true : false;
    const ok: ElAssignable = true;
    expect(ok).toBe(true);
  });

  it("DnD itemProps 핸들러가 <div> 드래그 핸들러 시그니처에 대입 가능해야 한다(스프레드 통합 계약)", () => {
    type DivHandler = DragEventHandler<HTMLDivElement>;
    type StartOk = StudioPageDndItemProps["onDragStart"] extends DivHandler ? true : false;
    type OverOk = StudioPageDndItemProps["onDragOver"] extends DivHandler ? true : false;
    type DropOk = StudioPageDndItemProps["onDrop"] extends DivHandler ? true : false;
    const all: [StartOk, OverOk, DropOk] = [true, true, true];
    expect(all.every(Boolean)).toBe(true);
  });
});

describe("studio-page-thumbs — 드롭 슬롯 산술", () => {
  it("computeDropSlot: 카드 위쪽 절반이면 카드 앞, 아래쪽 절반이면 카드 뒤 슬롯", () => {
    expect(computeDropSlot(2, 0.1)).toBe(2);
    expect(computeDropSlot(2, 0.49)).toBe(2);
    expect(computeDropSlot(2, 0.5)).toBe(3);
    expect(computeDropSlot(2, 0.9)).toBe(3);
    expect(computeDropSlot(-1, 0.9)).toBe(0); // 방어적 클램프
  });

  it("isNoopDropSlot: 자기 앞/뒤 슬롯은 제자리 드롭", () => {
    expect(isNoopDropSlot(1, 1)).toBe(true);
    expect(isNoopDropSlot(1, 2)).toBe(true);
    expect(isNoopDropSlot(1, 0)).toBe(false);
    expect(isNoopDropSlot(1, 3)).toBe(false);
  });

  it("dropSlotToReorderTarget + reorderPages: 슬롯 의미가 실제 재배치와 일치(아래로 이동)", () => {
    const pages: PageLike[] = ["A", "B", "C", "D"].map((id) => ({
      id,
      elements: [],
      bg: "#fff",
      bgGrad: null,
      canvasH: 1080,
    }));
    // A(0)를 C와 D 사이 슬롯(3)으로 → [B, C, A, D]
    const to = dropSlotToReorderTarget(0, 3);
    expect(to).toBe(2);
    expect(reorderPages(pages, 0, to).map((p) => p.id)).toEqual(["B", "C", "A", "D"]);
  });

  it("dropSlotToReorderTarget + reorderPages: 위로 이동/맨 끝 이동도 일치", () => {
    const pages: PageLike[] = ["A", "B", "C", "D"].map((id) => ({
      id,
      elements: [],
      bg: "#fff",
      bgGrad: null,
      canvasH: 1080,
    }));
    // D(3)를 A와 B 사이 슬롯(1)으로 → [A, D, B, C]
    expect(reorderPages(pages, 3, dropSlotToReorderTarget(3, 1)).map((p) => p.id)).toEqual(["A", "D", "B", "C"]);
    // B(1)를 맨 끝 슬롯(4)으로 → [A, C, D, B]
    expect(reorderPages(pages, 1, dropSlotToReorderTarget(1, 4)).map((p) => p.id)).toEqual(["A", "C", "D", "B"]);
  });

  it("dropIndicatorFor: 슬롯 앞 카드에 before, 맨 끝 슬롯은 마지막 카드에 after, 제자리는 숨김", () => {
    // 드래그 중 아님 → 항상 null
    expect(dropIndicatorFor(0, 4, null, null)).toBeNull();
    // from=0, slot=2 → 카드2 위에 삽입선
    expect(dropIndicatorFor(2, 4, 0, 2)).toBe("before");
    expect(dropIndicatorFor(1, 4, 0, 2)).toBeNull();
    // 맨 끝 슬롯(4) → 마지막 카드(3) 아래에 삽입선
    expect(dropIndicatorFor(3, 4, 0, 4)).toBe("after");
    expect(dropIndicatorFor(2, 4, 0, 4)).toBeNull();
    // 제자리(자기 앞/뒤)는 표시 안 함
    expect(dropIndicatorFor(1, 4, 1, 1)).toBeNull();
    expect(dropIndicatorFor(1, 4, 1, 2)).toBeNull();
  });
});

describe("studio-page-thumbs — SVG 기하 유틸", () => {
  it("clampThumbStroke: 0 이하는 0, 양수는 최소 두께로 끌어올림", () => {
    expect(clampThumbStroke(0, 5)).toBe(0);
    expect(clampThumbStroke(-2, 5)).toBe(0);
    expect(clampThumbStroke(1.8, 5)).toBe(5);
    expect(clampThumbStroke(8, 5)).toBe(8);
    expect(clampThumbStroke(Number.NaN, 5)).toBe(0);
  });

  it("clampThumbTextLines: 줄 수 제한 + 말줄임", () => {
    expect(clampThumbTextLines("가나\n다라\n마바\n사아", 2, 10)).toEqual(["가나", "다라"]);
    expect(clampThumbTextLines("아주아주아주 긴 대사입니다", 4, 6)).toEqual(["아주아주아…"]);
    expect(clampThumbTextLines("", 4, 10)).toEqual([""]);
  });

  it("downsamplePoints: 상한 이하면 그대로, 초과 시 양 끝점 보존하며 균등 축소", () => {
    const short = [0, 0, 10, 10, 20, 20];
    expect(downsamplePoints(short, 24)).toEqual(short);

    const long: number[] = [];
    for (let i = 0; i < 100; i++) long.push(i, i * 2);
    const down = downsamplePoints(long, 10);
    expect(down).toHaveLength(20);
    expect([down[0], down[1]]).toEqual([0, 0]); // 시작점
    expect([down[18], down[19]]).toEqual([99, 198]); // 끝점
  });

  it("pointsToSvg / flatPointsBounds", () => {
    expect(pointsToSvg([1.234, 2, 3, 4])).toBe("1.23,2 3,4");
    expect(flatPointsBounds([10, 5, 30, 25, 20, 0])).toEqual({ x: 10, y: 0, w: 20, h: 25 });
    expect(flatPointsBounds([])).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });

  it("starPolygonPoints / regularPolygonPoints: 꼭짓점 수와 시작각(위쪽)", () => {
    const star = starPolygonPoints(0, 0, 5, 10, 20);
    expect(star.split(" ")).toHaveLength(10); // 별 5각 = 외/내 10점
    expect(star.split(" ")[0]).toBe("0,-20"); // 위쪽(-90°)에서 시작

    const tri = regularPolygonPoints(0, 0, 3, 10);
    expect(tri.split(" ")).toHaveLength(3);
    expect(tri.split(" ")[0]).toBe("0,-10");
  });

  it("svg 변환 문자열: 로컬 변환·회전·반전·합성", () => {
    expect(svgLocalTransform(10, 20, 0)).toBe("translate(10 20)");
    expect(svgLocalTransform(10, 20, 45)).toBe("translate(10 20) rotate(45)");
    expect(svgRotateAround(0, 5, 5)).toBeNull();
    expect(svgRotateAround(90, 5, 6)).toBe("rotate(90 5 6)");
    expect(svgFlipTransform(false, false, 1, 1)).toBeNull();
    expect(svgFlipTransform(true, false, 50, 40)).toBe("translate(50 40) scale(-1 1) translate(-50 -40)");
    expect(joinTransforms(null, "a", null, "b")).toBe("a b");
    expect(joinTransforms(null, null)).toBeNull();
  });

  it("seededRandom: 같은 시드는 같은 시퀀스(결정적)", () => {
    const a = seededRandom("el-1");
    const b = seededRandom("el-1");
    const seqA = [a(), a(), a()];
    const seqB = [b(), b(), b()];
    expect(seqA).toEqual(seqB);
    for (const v of seqA) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("studio-page-thumbs — buildThumbNodes(요소 프록시)", () => {
  it("frame: 채움 rect(+테두리), 배경 이미지는 커버핏 이미지 노드", () => {
    const plain = buildThumbNodes(
      pageWith([{ id: "f1", type: "frame", x: 10, y: 20, width: 300, height: 200, bgColor: "#eeeeee" }])
    );
    expect(plain.nodes).toHaveLength(1);
    const rect = plain.nodes[0];
    if (rect.kind !== "rect") throw new Error("rect 노드가 아님");
    expect(rect.fill).toBe("#eeeeee");
    expect(rect.stroke).toBe("#222222");
    expect(rect.strokeWidth).toBeGreaterThanOrEqual(5); // 최소 획 두께 보정

    const withImg = buildThumbNodes(
      pageWith([{ id: "f2", type: "frame", x: 0, y: 0, width: 300, height: 200, bg: "https://img.example/x.png" }])
    );
    expect(withImg.nodes.map((n) => n.kind)).toEqual(["rect", "image", "rect"]); // 채움→이미지→테두리
    const img = withImg.nodes[1];
    if (img.kind !== "image") throw new Error("image 노드가 아님");
    expect(img.cover).toBe(true);
    expect(img.src).toBe("https://img.example/x.png");
  });

  it("frame: 비정형(폴리곤) 패널은 로컬 폴리곤 + translate", () => {
    const { nodes } = buildThumbNodes(
      pageWith([
        { id: "f3", type: "frame", x: 5, y: 7, width: 100, height: 100, points: [0, 0, 100, 10, 100, 100, 0, 90] },
      ])
    );
    expect(nodes).toHaveLength(1);
    const poly = nodes[0];
    if (poly.kind !== "polygon") throw new Error("polygon 노드가 아님");
    expect(poly.transform).toBe("translate(5 7)");
    expect(poly.points).toBe("0,0 100,10 100,100 0,90");
  });

  it("image: 회전·반전·CSS 필터 근사를 담은 이미지 노드", () => {
    const { nodes } = buildThumbNodes(
      pageWith([
        {
          id: "i1",
          type: "image",
          src: "data:image/png;base64,x",
          x: 100,
          y: 50,
          width: 200,
          height: 100,
          rotation: 30,
          flipped: true,
          grayscale: true,
          opacity: 0.8,
        },
      ])
    );
    expect(nodes).toHaveLength(1);
    const img = nodes[0];
    if (img.kind !== "image") throw new Error("image 노드가 아님");
    expect(img.cover).toBe(false); // 캔버스처럼 늘려 채움
    expect(img.transform).toBe("rotate(30 100 50) translate(200 100) scale(-1 1) translate(-200 -100)");
    expect(img.filterCss).toBe("grayscale(1)");
    expect(img.opacity).toBe(0.8);
    // src 없는 이미지는 생략
    expect(buildThumbNodes(pageWith([{ id: "i2", type: "image", x: 0, y: 0 }])).nodes).toHaveLength(0);
  });

  it("text: 정렬 앵커·그라디언트 시작색 폴백·여러 줄", () => {
    const { nodes } = buildThumbNodes(
      pageWith([
        {
          id: "t1",
          type: "text",
          text: "첫 줄\n둘째 줄",
          x: 100,
          y: 200,
          width: 300,
          fontSize: 40,
          fill: "#123456",
          align: "center",
          fillType: "gradient",
          gradientColorStart: "#ff0000",
        },
      ])
    );
    expect(nodes).toHaveLength(1);
    const txt = nodes[0];
    if (txt.kind !== "text") throw new Error("text 노드가 아님");
    expect(txt.anchor).toBe("middle");
    expect(txt.x).toBe(250); // x + width/2
    expect(txt.fill).toBe("#ff0000"); // 그라디언트 → 시작색 근사
    expect(txt.lines).toEqual(["첫 줄", "둘째 줄"]);
    expect(txt.bold).toBe(true); // 캔버스 기본 fontStyle="bold"
    // 빈 텍스트는 노드 생략
    expect(
      buildThumbNodes(pageWith([{ id: "t2", type: "text", text: "  ", x: 0, y: 0, width: 10, fontSize: 12 }])).nodes
    ).toHaveLength(0);
  });

  it("bubble(speech): 캔버스와 동일한 bubblePathData 경로(꼬리 포함) + 중앙 텍스트", () => {
    const { nodes } = buildThumbNodes(
      pageWith([
        {
          id: "b1",
          type: "bubble",
          variant: "speech",
          text: "안녕",
          x: 40,
          y: 60,
          width: 220,
          height: 120,
          fill: "#ffffff",
          textFill: "#222222",
          tail: "left",
        },
      ])
    );
    expect(nodes.map((n) => n.kind)).toEqual(["path", "text"]);
    const body = nodes[0];
    if (body.kind !== "path") throw new Error("path 노드가 아님");
    expect(body.transform).toBe("translate(40 60)");
    expect(body.d).toContain("Q"); // 꼬리 테이퍼 곡선 포함(bubblePathData)
    const label = nodes[1];
    if (label.kind !== "text") throw new Error("text 노드가 아님");
    expect(label.anchor).toBe("middle");
    expect(label.x).toBe(110); // 로컬 w/2
    expect(label.fill).toBe("#222222");
  });

  it("bubble(shout): 별 폭발 path 근사, tail=none 은 꼬리 스펙 없음", () => {
    const { nodes } = buildThumbNodes(
      pageWith([{ id: "b2", type: "bubble", variant: "shout", text: "", x: 0, y: 0, width: 136, height: 136 }])
    );
    expect(nodes).toHaveLength(1); // 빈 텍스트 → 본체만
    expect(nodes[0].kind).toBe("path");
    if (nodes[0].kind !== "path") throw new Error("path 노드가 아님");
    expect(nodes[0].d.startsWith("M ")).toBe(true);
    expect(nodes[0].d.trim().endsWith("Z")).toBe(true);
    expect(bubbleTailSpecOf({ id: "b3", type: "bubble", tail: "none" }, 100, 100)).toBeNull();
  });

  it("bubbleTailSpecOf: 오른쪽 화자는 수직 꼬리 ratio 를 대칭 반전", () => {
    const spec = bubbleTailSpecOf(
      { id: "b4", type: "bubble", tail: "right", tailDirection: "bottom", tailXRatio: 0.2 },
      200,
      100
    );
    expect(spec).not.toBeNull();
    expect(spec?.ratio).toBeCloseTo(0.8);
    expect(spec?.direction).toBe("bottom");
    // 잘못된 방향 문자열은 bottom 폴백
    expect(bubbleTailSpecOf({ id: "b5", type: "bubble", tailDirection: "diagonal" }, 100, 100)?.direction).toBe(
      "bottom"
    );
  });

  it("bubbleTailSpecOf: 편집한 밑동 너비와 곡률을 썸네일에도 동일하게 반영한다", () => {
    const spec = bubbleTailSpecOf(
      { id: "b6", type: "bubble", tailBase: 38, tailBend: 0.55 },
      200,
      120
    );
    expect(spec?.base).toBe(38);
    expect(spec?.bend).toBe(0.55);

    const clamped = bubbleTailSpecOf(
      { id: "b7", type: "bubble", tailBase: 999, tailBend: -9 },
      200,
      120
    );
    expect(clamped?.base).toBeCloseTo(74.4);
    expect(clamped?.bend).toBe(-1);
  });

  it("bubble(double): 캔버스와 같은 이중 로브 path를 썸네일에 사용한다", () => {
    const el: ThumbElement = {
      id: "b8",
      type: "bubble",
      variant: "double",
      text: "이어 말하기",
      x: 10,
      y: 20,
      width: 260,
      height: 170,
      tailBase: 36,
      tailBend: 0.25,
    };
    const { nodes } = buildThumbNodes(pageWith([el]));
    const body = nodes[0];
    if (body.kind !== "path") throw new Error("double 말풍선 path 노드가 아님");
    expect(body.d).toBe(doubleBubblePathData(260, 170, bubbleTailSpecOf(el, 260, 170)));
  });

  it("draw: 지우개는 생략, 프리핸드는 다운샘플 폴리라인, 도형은 프리미티브", () => {
    const longPoints: number[] = [];
    for (let i = 0; i < 200; i++) longPoints.push(i, i);
    const page = pageWith([
      { id: "d1", type: "draw", mode: "eraser", points: [0, 0, 10, 10], stroke: "#000", strokeWidth: 4 },
      { id: "d2", type: "draw", points: longPoints, stroke: "#ff0000", strokeWidth: 3 },
      { id: "d3", type: "draw", kind: "rect", points: [10, 10, 110, 60], stroke: "#00ff00", strokeWidth: 2, fill: "#0000ff" },
      { id: "d4", type: "draw", kind: "ellipse", points: [0, 0, 100, 50], stroke: "#000000", strokeWidth: 2 },
    ]);
    const { nodes } = buildThumbNodes(page);
    expect(nodes.map((n) => n.kind)).toEqual(["polyline", "rect", "ellipse"]); // 지우개 생략
    const stroke = nodes[0];
    if (stroke.kind !== "polyline") throw new Error("polyline 노드가 아님");
    expect(stroke.points.split(" ").length).toBeLessThanOrEqual(24); // 다운샘플 상한
    const rect = nodes[1];
    if (rect.kind !== "rect") throw new Error("rect 노드가 아님");
    expect(rect.fill).toBe("#0000ff");
    expect(rect.w).toBe(100);
  });

  it("focusLines/speedLines: 개수 상한이 걸린 결정적 라인 path", () => {
    const { nodes } = buildThumbNodes(
      pageWith([
        {
          id: "fx1",
          type: "focusLines",
          x: 0,
          y: 0,
          width: 400,
          height: 400,
          lineCount: 80,
          innerRadius: 100,
          outerRadius: 200,
          stroke: "#000000",
          strokeWidth: 2,
          rotation: 0,
        },
        {
          id: "fx2",
          type: "speedLines",
          x: 0,
          y: 0,
          width: 400,
          height: 200,
          lineCount: 60,
          direction: "horizontal",
          stroke: "#000000",
          strokeWidth: 2,
          rotation: 0,
        },
      ])
    );
    expect(nodes).toHaveLength(2);
    const focus = nodes[0];
    if (focus.kind !== "path") throw new Error("path 노드가 아님");
    expect(focus.d.split("M").length - 1).toBe(20); // 방사선 상한 20
    const speed = nodes[1];
    if (speed.kind !== "path") throw new Error("path 노드가 아님");
    expect(speed.d.split("M").length - 1).toBe(14); // 속도선 상한 14
  });

  it("focusLines: noise 를 캔버스와 동일하게 반영한다(예전 썸네일은 통째로 무시했다)", () => {
    // 회귀 방지 — 썸네일이 noise 를 안 읽어서 캔버스와 다른 그림을 보여주던 버그.
    const focus = (noise: number) => {
      const { nodes } = buildThumbNodes(
        pageWith([
          {
            id: "fx-noise",
            type: "focusLines",
            x: 0,
            y: 0,
            width: 400,
            height: 400,
            lineCount: 12,
            innerRadius: 100,
            outerRadius: 200,
            noise,
            stroke: "#000000",
            strokeWidth: 2,
            rotation: 0,
          },
        ])
      );
      const node = nodes[0];
      if (node.kind !== "path") throw new Error("path 노드가 아님");
      return node.d;
    };
    const clean = focus(0);
    const noisy = focus(24);
    expect(noisy).not.toBe(clean);
    // 같은 시드(id)면 결정적이어야 재렌더에도 썸네일이 흔들리지 않는다.
    expect(focus(24)).toBe(noisy);
  });

  it("숨김 요소·숨김 그룹 소속 요소는 제외한다", () => {
    const page = pageWith(
      [
        { id: "v1", type: "sticker", text: "😀", x: 0, y: 0, fontSize: 40 },
        { id: "h1", type: "sticker", text: "🙈", x: 0, y: 0, fontSize: 40, hidden: true },
        { id: "g1", type: "sticker", text: "📁", x: 0, y: 0, fontSize: 40, groupId: "grp" },
      ],
      { groups: [{ id: "grp", name: "그룹", hidden: true }] }
    );
    const { nodes, skipped } = buildThumbNodes(page);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].key).toBe("v1");
    expect(skipped).toBe(0); // 숨김은 "생략 배지" 대상이 아님
  });

  it("maxNodes 상한 초과분은 skipped 로 보고한다", () => {
    const many: ThumbElement[] = [];
    for (let i = 0; i < 30; i++) many.push({ id: `s${i}`, type: "sticker", text: "⭐", x: i, y: i, fontSize: 20 });
    const { nodes, skipped } = buildThumbNodes(pageWith(many), { maxNodes: 10 });
    expect(nodes).toHaveLength(10);
    expect(skipped).toBe(20);
  });

  it("StudioPageThumbnail 컴포넌트가 SVG 마크업으로 렌더된다(스모크)", async () => {
    const [{ renderToStaticMarkup }, { createElement }, { StudioPageThumbnail }] = await Promise.all([
      import("react-dom/server"),
      import("react"),
      import("./StudioPageThumbnails"),
    ]);
    const page = pageWith(
      [
        { id: "f1", type: "frame", x: 20, y: 20, width: 680, height: 400 },
        { id: "i1", type: "image", src: "data:image/png;base64,x", x: 40, y: 40, width: 200, height: 150 },
        { id: "b1", type: "bubble", variant: "speech", text: "안녕!", x: 300, y: 80, width: 220, height: 120, textFill: "#222" },
      ],
      { bgGrad: ["#0ea5e9", "#f0abfc"], grade: { brightness: 1.2, vignette: 0.4 } }
    );
    const html = renderToStaticMarkup(createElement(StudioPageThumbnail, { page }));
    expect(html).toContain("<svg");
    expect(html).toContain('viewBox="0 0 720 1080"');
    expect(html).toContain("<image");
    expect(html).toContain("안녕!");
    expect(html).toContain("linearGradient");
    expect(html).toContain("brightness(1.2)"); // 페이지 그레이드 CSS filter
    expect(html).toContain("radial-gradient"); // 비네트 오버레이
  });

  it("연결형 OPFS raster는 검증 lease 전 raw locator를 SVG href로 노출하지 않는다", async () => {
    const [{ renderToStaticMarkup }, { createElement }, { StudioPageThumbnail }] = await Promise.all([
      import("react-dom/server"),
      import("react"),
      import("./StudioPageThumbnails"),
    ]);
    const locator = `studio-opfs-cas:sha256:${"a".repeat(64)}`;
    const page = pageWith([
      { id: "linked", type: "image", src: locator, x: 40, y: 40, width: 200, height: 150 },
    ]);

    const html = renderToStaticMarkup(createElement(StudioPageThumbnail, { page }));
    expect(html).toContain('data-raster-source-placeholder="true"');
    expect(html).not.toContain(`href="${locator}"`);
  });

  it("알 수 없는 요소 타입은 무시(노드 없음)하고, 결과는 결정적이다", () => {
    const page = pageWith([
      { id: "u1", type: "hologram" },
      { id: "b1", type: "bubble", variant: "speech", text: "야!", x: 0, y: 0, width: 200, height: 100 },
    ]);
    const first = buildThumbNodes(page);
    const second = buildThumbNodes(page);
    expect(first.nodes.filter((n: ThumbNode) => n.key.startsWith("u1"))).toHaveLength(0);
    expect(second).toEqual(first); // 순수·결정적
  });
});
