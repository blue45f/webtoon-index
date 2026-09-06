import { describe, expect, it } from "vitest";

import {
  planStudioVrmTextureStroke,
  resolveStudioVrmTextureStrokeBrush,
  type StudioVrmTextureStrokeSample,
  type StudioVrmTextureStrokeStyle,
} from "./studio-vrm-texture-stroke";

import type { StudioVrmTextureSize } from "./studio-vrm-texture-uv";

const SIZE: StudioVrmTextureSize = { width: 1024, height: 1024 };

const INK: StudioVrmTextureStrokeStyle = {
  kind: "ink",
  color: "#101010",
  sizeTexels: 12,
  opacity: 1,
  blend: "normal",
};

/** u 축을 따라 일정 간격으로 이동하는 히트 시퀀스. */
function line(count: number, step: number, v = 0.5): StudioVrmTextureStrokeSample[] {
  return Array.from({ length: count }, (_, index) => ({
    uv: { u: 0.1 + index * step, v },
    pressure: 1,
  }));
}

function spacings(points: readonly { x: number; y: number }[]): number[] {
  const out: number[] = [];
  for (let index = 1; index < points.length; index += 1) {
    out.push(Math.hypot(points[index]!.x - points[index - 1]!.x, points[index]!.y - points[index - 1]!.y));
  }
  return out;
}

describe("studio-vrm-texture-stroke spacing", () => {
  it("spaces dabs evenly in texture space even when samples are uneven", () => {
    // 화면 입력은 들쭉날쭉하지만(0.01 / 0.09 / 0.02 …) 텍스처 간격은 균일해야 한다.
    const samples: StudioVrmTextureStrokeSample[] = [
      { uv: { u: 0.1, v: 0.5 }, pressure: 1 },
      { uv: { u: 0.11, v: 0.5 }, pressure: 1 },
      { uv: { u: 0.2, v: 0.5 }, pressure: 1 },
      { uv: { u: 0.22, v: 0.5 }, pressure: 1 },
      { uv: { u: 0.4, v: 0.5 }, pressure: 1 },
    ];
    const plan = planStudioVrmTextureStroke(INK, samples, SIZE);
    expect(plan.runs).toBeGreaterThan(0);
    expect(plan.ops.length).toBeGreaterThan(20);

    const gaps = spacings(plan.ops);
    const expected = INK.sizeTexels * 0.32; // ink 의 간격비(엔진 상수)
    for (const gap of gaps) {
      expect(gap).toBeGreaterThan(expected * 0.5);
      expect(gap).toBeLessThan(expected * 1.5);
    }
  });

  it("keeps texture-space spacing constant across a UV density change", () => {
    // 같은 텍스처 좌표 이동량이면 몇 번의 샘플로 쪼개졌든 dab 수가 같아야 한다.
    const coarse = planStudioVrmTextureStroke(INK, line(2, 0.2), SIZE);
    const fine = planStudioVrmTextureStroke(INK, line(11, 0.02), SIZE);
    expect(Math.abs(coarse.ops.length - fine.ops.length)).toBeLessThanOrEqual(2);
  });

  it("scales dab radius with the requested texel size", () => {
    const small = planStudioVrmTextureStroke({ ...INK, sizeTexels: 6 }, line(4, 0.05), SIZE);
    const large = planStudioVrmTextureStroke({ ...INK, sizeTexels: 24 }, line(4, 0.05), SIZE);
    expect(small.ops[0]!.radius).toBeCloseTo(3, 6);
    expect(large.ops[0]!.radius).toBeCloseTo(12, 6);
    expect(large.ops.length).toBeLessThan(small.ops.length);
  });
});

describe("studio-vrm-texture-stroke determinism", () => {
  it("produces byte-identical plans for the same seed", () => {
    const pencil: StudioVrmTextureStrokeStyle = { ...INK, kind: "pencil" };
    const first = planStudioVrmTextureStroke(pencil, line(10, 0.03), SIZE, { seed: 7 });
    const second = planStudioVrmTextureStroke(pencil, line(10, 0.03), SIZE, { seed: 7 });
    expect(second.ops).toEqual(first.ops);
  });

  it("changes grain when the seed changes, but not for grain-free brushes", () => {
    const pencil: StudioVrmTextureStrokeStyle = { ...INK, kind: "pencil" };
    const a = planStudioVrmTextureStroke(pencil, line(10, 0.03), SIZE, { seed: 1 });
    const b = planStudioVrmTextureStroke(pencil, line(10, 0.03), SIZE, { seed: 2 });
    expect(b.ops).not.toEqual(a.ops);
    expect(b.ops.length).toBe(a.ops.length);

    const inkA = planStudioVrmTextureStroke(INK, line(10, 0.03), SIZE, { seed: 1 });
    const inkB = planStudioVrmTextureStroke(INK, line(10, 0.03), SIZE, { seed: 2 });
    expect(inkB.ops).toEqual(inkA.ops);
  });

  it("emits the 2D pencil's main dab plus two grain specks", () => {
    const pencil: StudioVrmTextureStrokeStyle = { ...INK, kind: "pencil" };
    const plan = planStudioVrmTextureStroke(pencil, line(6, 0.03), SIZE);
    expect(plan.ops.length).toBe(plan.dabs * 3);
    const specks = plan.ops.filter((op) => op.radius < plan.ops[0]!.radius * 0.5);
    expect(specks.length).toBe(plan.dabs * 2);
  });
});

describe("studio-vrm-texture-stroke seams", () => {
  it("breaks the stroke when consecutive hits land on far-apart UV islands", () => {
    const samples: StudioVrmTextureStrokeSample[] = [
      { uv: { u: 0.1, v: 0.1 }, pressure: 1 },
      { uv: { u: 0.12, v: 0.1 }, pressure: 1 },
      // 심 반대편 아일랜드로 점프.
      { uv: { u: 0.85, v: 0.9 }, pressure: 1 },
      { uv: { u: 0.87, v: 0.9 }, pressure: 1 },
    ];
    const plan = planStudioVrmTextureStroke(INK, samples, SIZE);
    expect(plan.seamBreaks).toBe(1);
    expect(plan.runs).toBe(2);

    // 아틀라스를 가로지르는 선분 위(중간 지점)에는 dab 이 하나도 없어야 한다.
    const midpoint = { x: (0.12 + 0.85) / 2, y: (0.1 + 0.9) / 2 };
    const strayed = plan.ops.some(
      (op) =>
        Math.abs(op.x / SIZE.width - midpoint.x) < 0.1 &&
        Math.abs(op.y / SIZE.height - midpoint.y) < 0.1,
    );
    expect(strayed).toBe(false);
  });

  it("always breaks when the island id changes, however small the step", () => {
    const samples: StudioVrmTextureStrokeSample[] = [
      { uv: { u: 0.5, v: 0.5 }, islandId: "head" },
      { uv: { u: 0.501, v: 0.5 }, islandId: "head" },
      { uv: { u: 0.502, v: 0.5 }, islandId: "body" },
    ];
    const plan = planStudioVrmTextureStroke(INK, samples, SIZE);
    expect(plan.seamBreaks).toBe(1);
    expect(plan.runs).toBe(2);
  });

  it("uses world distance × UV density to tell a fast drag from a seam", () => {
    const density = 1024; // 월드 1 단위 = 1024 텍셀
    // 빠른 드래그: 월드로도 실제로 0.2 만큼 움직였다 → 늘어난 게 아니므로 끊지 않는다.
    const fastDrag: StudioVrmTextureStrokeSample[] = [
      {
        uv: { u: 0.1, v: 0.5 },
        world: { x: 0, y: 0, z: 0 },
        texelsPerWorldUnit: density,
      },
      {
        uv: { u: 0.3, v: 0.5 },
        world: { x: 0.2, y: 0, z: 0 },
        texelsPerWorldUnit: density,
      },
    ];
    expect(planStudioVrmTextureStroke(INK, fastDrag, SIZE).seamBreaks).toBe(0);

    // 심: 월드로는 1 mm 밖에 안 움직였는데 텍스처에서는 아틀라스를 가로질렀다.
    const seam: StudioVrmTextureStrokeSample[] = [
      {
        uv: { u: 0.1, v: 0.5 },
        world: { x: 0, y: 0, z: 0 },
        texelsPerWorldUnit: density,
      },
      {
        uv: { u: 0.9, v: 0.5 },
        world: { x: 0.001, y: 0, z: 0 },
        texelsPerWorldUnit: density,
      },
    ];
    expect(planStudioVrmTextureStroke(INK, seam, SIZE).seamBreaks).toBe(1);
  });

  it("skips unresolvable samples without dropping the rest of the stroke", () => {
    const samples: StudioVrmTextureStrokeSample[] = [
      { uv: { u: 0.2, v: 0.5 } },
      { uv: { u: Number.NaN, v: 0.5 } },
      { uv: { u: 0.22, v: 0.5 } },
      { uv: { u: 0.24, v: 0.5 } },
    ];
    const plan = planStudioVrmTextureStroke(INK, samples, SIZE);
    expect(plan.skipped).toBe(1);
    expect(plan.runs).toBe(2);
    expect(plan.ops.length).toBeGreaterThan(0);
  });
});

describe("studio-vrm-texture-stroke guards", () => {
  it("returns an empty plan for empty or unusable input", () => {
    expect(planStudioVrmTextureStroke(INK, [], SIZE).ops).toHaveLength(0);
    expect(planStudioVrmTextureStroke({ ...INK, sizeTexels: 0 }, line(4, 0.05), SIZE).ops).toHaveLength(
      0,
    );
    const bad = planStudioVrmTextureStroke(INK, line(4, 0.05), { width: 0, height: 0 });
    expect(bad.ops).toHaveLength(0);
    expect(bad.skipped).toBe(4);
  });

  it("honours the dab budget", () => {
    const plan = planStudioVrmTextureStroke(INK, line(50, 0.019), SIZE, { maxDabs: 12 });
    expect(plan.dabs).toBeLessThanOrEqual(12);
  });

  it("mirrors the 2D engine's per-kind defaults", () => {
    expect(resolveStudioVrmTextureStrokeBrush(INK).hardness).toBe(1);
    expect(resolveStudioVrmTextureStrokeBrush({ ...INK, kind: "airbrush" }).hardness).toBeCloseTo(
      0.06,
      6,
    );
    expect(
      resolveStudioVrmTextureStrokeBrush({ ...INK, kind: "watercolor", tuning: { hardness: 0.8 } })
        .hardness,
    ).toBeCloseTo(0.8, 6);
  });
});
