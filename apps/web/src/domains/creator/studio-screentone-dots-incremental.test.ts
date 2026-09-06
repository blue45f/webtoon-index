import { describe, expect, it } from "vitest";

import {
  createStudioIncrementalScreentoneDotsBuilder,
  screentoneDotsForStroke,
} from "./studio-brush";

/** 결정적 의사난수 — 테스트 재현성. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function growingStroke(random: () => number, pointCount: number): number[] {
  const points: number[] = [];
  let x = 60;
  let y = 90;
  let heading = 0.2;
  for (let index = 0; index < pointCount; index += 1) {
    if (random() < 0.07 && index > 0) {
      // 길이 0 세그먼트: carried/prev 미갱신 분기.
      points.push(points[points.length - 2]!, points[points.length - 1]!);
      continue;
    }
    heading += (random() - 0.45) * 0.7;
    x += Math.cos(heading) * (1 + random() * 9);
    y += Math.sin(heading) * (1 + random() * 9);
    points.push(x, y);
  }
  return points;
}

describe("createStudioIncrementalScreentoneDotsBuilder", () => {
  it("matches the batch walk exactly (values AND order) across point-by-point growth", () => {
    const random = mulberry32(0x70e5);
    const points = growingStroke(random, 160);
    const builder = createStudioIncrementalScreentoneDotsBuilder();
    for (let pairCount = 1; pairCount <= 160; pairCount += 1) {
      const prefix = points.slice(0, pairCount * 2);
      // 끝점 도장의 중복제거 상호작용까지 순서 동일해야 한다 — toEqual 은 순서를 본다.
      expect(builder.plan(prefix, 12, Math.max(3, 24 * 0.42))).toEqual(
        screentoneDotsForStroke(prefix, 12, Math.max(3, 24 * 0.42)),
      );
    }
  });

  it("rebuilds on undo shrink, last-point rewrite and radius/pitch change", () => {
    const random = mulberry32(0x0dd5);
    const points = growingStroke(random, 80);
    const builder = createStudioIncrementalScreentoneDotsBuilder();
    builder.plan(points, 12, 10);
    const shrunk = points.slice(0, 40 * 2);
    expect(builder.plan(shrunk, 12, 10)).toEqual(screentoneDotsForStroke(shrunk, 12, 10));
    const rewritten = shrunk.slice();
    rewritten[78] = rewritten[78]! + 31;
    expect(builder.plan(rewritten, 12, 10)).toEqual(
      screentoneDotsForStroke(rewritten, 12, 10),
    );
    expect(builder.plan(rewritten, 9, 10)).toEqual(
      screentoneDotsForStroke(rewritten, 9, 10),
    );
    expect(builder.plan(rewritten, 9, 14)).toEqual(
      screentoneDotsForStroke(rewritten, 9, 14),
    );
  });

  it("keeps single-pair and empty inputs in parity", () => {
    const builder = createStudioIncrementalScreentoneDotsBuilder();
    expect(builder.plan([], 12, 10)).toEqual(screentoneDotsForStroke([], 12, 10));
    expect(builder.plan([5], 12, 10)).toEqual(screentoneDotsForStroke([5], 12, 10));
    expect(builder.plan([40, 40], 12, 10)).toEqual(
      screentoneDotsForStroke([40, 40], 12, 10),
    );
    // 같은 입력 반복(리렌더): 끝점 도장 되돌리기/재도장이 멱등이어야 한다.
    expect(builder.plan([40, 40], 12, 10)).toEqual(
      screentoneDotsForStroke([40, 40], 12, 10),
    );
  });
});
