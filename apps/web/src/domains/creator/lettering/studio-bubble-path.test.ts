import { describe, it, expect } from "vitest";

import {
  bubblePathData,
  bubblePathDataMulti,
  burstStarPathData,
  doubleBubblePathData,
  heartBubblePathData,
  normalizeExtraTails,
  scaredBubblePathData,
  thoughtBubbleBodyPath,
  type BubbleTailSpec,
} from "./studio-bubble-path";

const tail = (over: Partial<BubbleTailSpec> = {}): BubbleTailSpec => ({
  direction: "bottom",
  ratio: 0.35,
  length: 30,
  base: 36,
  side: "center",
  ...over,
});

describe("bubblePathData", () => {
  it("닫힌 path(M…Z)를 만든다", () => {
    const d = bubblePathData(200, 120, 18);
    expect(d.startsWith("M ")).toBe(true);
    expect(d.trim().endsWith("Z")).toBe(true);
  });

  it("꼬리가 없으면 둥근 사각형(바깥으로 안 나감)", () => {
    const d = bubblePathData(200, 120, 18, null);
    // 좌표는 0..200 / 0..120 범위 내(아크 포함)
    const nums = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
    expect(Math.min(...nums)).toBeGreaterThanOrEqual(0);
  });

  it("아래 꼬리는 본체 아래(y>h)로 뻗는다", () => {
    const d = bubblePathData(200, 120, 18, tail({ direction: "bottom" }));
    expect(d).toContain("150"); // tip y = h(120) + length(30)
  });

  it("위 꼬리는 본체 위(y<0)로 뻗는다", () => {
    const d = bubblePathData(200, 120, 18, tail({ direction: "top" }));
    expect(d).toMatch(/-30\b/);
  });

  it("왼쪽 꼬리는 x<0, 오른쪽 꼬리는 x>w로 뻗는다", () => {
    const left = bubblePathData(200, 120, 18, tail({ direction: "left", ratio: 0.5, base: 30 }));
    expect(left).toMatch(/-30\b/);
    const right = bubblePathData(200, 120, 18, tail({ direction: "right", ratio: 0.5, base: 30 }));
    expect(right).toContain("230"); // w(200) + length(30)
  });

  it("같은 입력이면 항상 같은 결과(결정적)", () => {
    const a = bubblePathData(200, 120, 18, tail());
    const b = bubblePathData(200, 120, 18, tail());
    expect(a).toBe(b);
  });

  it("반지름은 (w,h)/2로 클램프돼 깨지지 않는다", () => {
    const d = bubblePathData(80, 60, 9999, tail());
    expect(d.startsWith("M ")).toBe(true);
    expect(d).toContain("Z");
  });

  it("side로 꼬리 끝이 기운다(center와 다름)", () => {
    const center = bubblePathData(200, 120, 18, tail({ side: "center" }));
    const leaned = bubblePathData(200, 120, 18, tail({ side: "right" }));
    expect(center).not.toBe(leaned);
  });

  it("bend로 꼬리 몸통의 곡률을 좌우로 조절한다", () => {
    const straight = bubblePathData(200, 120, 18, tail({ bend: 0 }));
    const leftCurve = bubblePathData(200, 120, 18, tail({ bend: -0.8 }));
    const rightCurve = bubblePathData(200, 120, 18, tail({ bend: 0.8 }));
    expect(leftCurve).not.toBe(straight);
    expect(rightCurve).not.toBe(straight);
    expect(leftCurve).not.toBe(rightCurve);
    expect(leftCurve).not.toContain("NaN");
  });
});

describe("doubleBubblePathData", () => {
  it("위·아래 로브를 내부 이음새 없는 단일 닫힌 path로 만든다", () => {
    const d = doubleBubblePathData(260, 170, null);
    expect(d.startsWith("M ")).toBe(true);
    expect(d.endsWith(" Z")).toBe(true);
    expect(d.match(/M /g)).toHaveLength(1);
    expect(d).not.toContain("NaN");
  });

  it.each(["top", "bottom", "left", "right"] as const)("%s 변 꼬리를 같은 path에 통합한다", (direction) => {
    const withoutTail = doubleBubblePathData(260, 170, null);
    const withTail = doubleBubblePathData(260, 170, tail({ direction, ratio: 0.72, bend: 0.5 }));
    expect(withTail).not.toBe(withoutTail);
    expect(withTail.match(/Q /g)?.length ?? 0).toBeGreaterThan(withoutTail.match(/Q /g)?.length ?? 0);
    expect(withTail).not.toContain("NaN");
  });

  it("극단적인 ratio·base·bend도 유효한 경로로 클램프한다", () => {
    const d = doubleBubblePathData(120, 90, tail({ ratio: 99, base: 999, bend: -99 }));
    expect(d).not.toContain("NaN");
    expect(d.endsWith(" Z")).toBe(true);
  });
});

describe("다중 꼬리(bubblePathDataMulti)", () => {
  const TAIL = (over: Partial<import("./studio-bubble-path").BubbleTailSpec> = {}) => ({
    direction: "bottom" as const,
    ratio: 0.5,
    length: 24,
    base: 18,
    side: "center" as const,
    ...over,
  });

  it("꼬리 0개면 단일 꼬리 없음 경로와 동일하다", () => {
    expect(bubblePathDataMulti(200, 100, 12, [])).toBe(bubblePathData(200, 100, 12, null));
  });

  it("단일 path(M 1회)로 꼬리 수만큼 Q쌍이 들어간다", () => {
    const d = bubblePathDataMulti(240, 120, 12, [
      TAIL({ direction: "bottom", ratio: 0.25 }),
      TAIL({ direction: "bottom", ratio: 0.75 }),
      TAIL({ direction: "top", ratio: 0.5 }),
    ]);
    expect(d.match(/M /g)).toHaveLength(1);
    expect(d.match(/Q /g)).toHaveLength(6); // 꼬리당 2개
    expect(d.endsWith("Z")).toBe(true);
  });

  it("같은 변의 겹치는 꼬리는 진행 방향으로 밀려 겹치지 않는다", () => {
    const d = bubblePathDataMulti(240, 120, 12, [
      TAIL({ ratio: 0.5 }),
      TAIL({ ratio: 0.5 }),
    ]);
    // 아랫변 홈 좌표 추출: "H x Q..." 패턴의 H 값들(아랫변은 x 감소 순회)
    const hs = [...d.matchAll(/H (-?[\d.]+)/g)].map((m) => Number(m[1]));
    expect(hs.length).toBeGreaterThanOrEqual(3);
    // 결과 path에 NaN이 없어야 한다
    expect(d.includes("NaN")).toBe(false);
  });

  it("최대 개수를 넘는 꼬리는 잘린다", () => {
    const d = bubblePathDataMulti(300, 150, 10, [
      TAIL({ ratio: 0.2 }),
      TAIL({ ratio: 0.4 }),
      TAIL({ ratio: 0.6 }),
      TAIL({ ratio: 0.8 }),
    ]);
    expect(d.match(/Q /g)!.length).toBeLessThanOrEqual(6);
  });

  it("네 변 모두에 꼬리를 붙일 수 있고 좌표가 유한하다", () => {
    const d = bubblePathDataMulti(200, 200, 14, [
      TAIL({ direction: "top" }),
      TAIL({ direction: "left" }),
      TAIL({ direction: "right" }),
    ]);
    expect(d.includes("NaN")).toBe(false);
    expect(d.match(/Q /g)).toHaveLength(6);
  });

  it("다중 꼬리마다 독립적인 bend를 보존한다", () => {
    const straight = bubblePathDataMulti(240, 120, 12, [TAIL({ ratio: 0.3 }), TAIL({ ratio: 0.7 })]);
    const curved = bubblePathDataMulti(240, 120, 12, [
      TAIL({ ratio: 0.3, bend: -1 }),
      TAIL({ ratio: 0.7, bend: 1 }),
    ]);
    expect(curved).not.toBe(straight);
    expect(curved.match(/Q /g)).toHaveLength(4);
  });
});

describe("variant body paths", () => {
  it("thought: 타원 본체 닫힌 path", () => {
    const d = thoughtBubbleBodyPath(200, 100);
    expect(d.startsWith("M ")).toBe(true);
    expect(d.trim().endsWith("Z")).toBe(true);
    expect(d.includes("A ")).toBe(true);
  });

  it("scared: 톱니 윤곽 + 꼬리 단일 path", () => {
    const body = scaredBubblePathData(200, 120, null);
    const withTail = scaredBubblePathData(200, 120, tail({ direction: "bottom" }));
    expect(body.startsWith("M ")).toBe(true);
    expect(body.trim().endsWith("Z")).toBe(true);
    expect(withTail).not.toBe(body);
    expect(withTail.includes("Q ")).toBe(true);
    expect(withTail.includes("NaN")).toBe(false);
  });

  it("heart: 스케일된 하트 path", () => {
    const d = heartBubblePathData(120, 100);
    expect(d.startsWith("M ")).toBe(true);
    expect(d.trim().endsWith("Z")).toBe(true);
    expect(d.includes("C ")).toBe(true);
  });

  it("burstStar: 외침/격앙 별 폴리곤", () => {
    const shout = burstStarPathData(136, 136, 20, 36, 68);
    const angry = burstStarPathData(160, 160, 22, 28, 64);
    expect(shout.startsWith("M ")).toBe(true);
    expect(shout.trim().endsWith("Z")).toBe(true);
    expect(angry).not.toBe(shout);
    expect(shout.includes("NaN")).toBe(false);
  });
});

describe("normalizeExtraTails", () => {
  it("쓰레기 입력은 빈 배열", () => {
    expect(normalizeExtraTails(null)).toEqual([]);
    expect(normalizeExtraTails("junk")).toEqual([]);
    expect(normalizeExtraTails([{ direction: "diagonal" }])).toEqual([]);
  });

  it("유효 항목은 클램프되어 최대 2개까지 수용된다", () => {
    const out = normalizeExtraTails([
      { direction: "top", ratio: 9, length: 9999, base: 1, side: "left", bend: 9 },
      { direction: "left", ratio: -1, length: 0.1, base: 999, side: "weird", bend: -9 },
      { direction: "right", ratio: 0.5, length: 20, base: 16, side: "center" },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ direction: "top", ratio: 1, length: 200, base: 4, side: "left", bend: 1 });
    expect(out[1].side).toBe("center");
    expect(out[1].direction).toBe("left");
    expect(out[1].bend).toBe(-1);
  });
});
