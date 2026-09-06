import { getStroke } from "perfect-freehand";
import { describe, expect, it } from "vitest";

import {
  applyStudioCroquisPulledStringPrefilter,
  buildStudioCroquisCapsuleStrokeLoops,
  buildStudioCroquisCapsuleStrokePathData,
  resolveStudioCroquisCapsulePenProgram,
  solveStudioCroquisCapsule,
  STUDIO_CROQUIS_CAPSULE_PEN_PROGRAMS,
  STUDIO_CROQUIS_PULLED_STRING_DEFAULT_LENGTH_PX,
  studioCroquisCapsuleLoop,
  studioCroquisCapsuleLoopsToPathData,
  studioCroquisCapsuleRadiiFromPressures,
  type StudioCroquisCapsuleCircle,
} from "./studio-croquis-capsule-pen-v1";
import { studioOssUnitHash } from "./studio-oss-brush-kernels";
import {
  buildStudioPerfectFreehandOutline,
  STUDIO_PERFECT_FREEHAND_PROFILES,
  type StudioPerfectFreehandStroker,
} from "./studio-perfect-freehand";

const stroker: StudioPerfectFreehandStroker = getStroke;

function distance(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(bx - ax, by - ay);
}

/**
 * Verbatim port of croquis.js brush/simple.ts drawCapsuleCase2 tangent construction
 * (including the `x || 1e-9` vertical hack) — the quad corners it fills are the actual
 * tangent points on both circles. Returns { big: [...2 points], small: [...2 points] }.
 */
function croquisReferenceCase2(
  big: StudioCroquisCapsuleCircle,
  small: StudioCroquisCapsuleCircle,
): { big: Array<[number, number]>; small: Array<[number, number]> } {
  const x = small.x - big.x || 1e-9;
  const y = small.y - big.y;
  const r = big.r - small.r;
  const r2 = r * r;
  const x2 = x * x;
  const x3 = x * x * x;
  const y2 = y * y;
  const root = Math.sqrt(r2 * x2 * (-r2 + x2 + y2));
  const ax = (y * root + r2 * x2) / (x3 + x * y2) + big.x;
  const ay = (r2 * y - root) / (x2 + y2) + big.y;
  const bx = (-(y * root) + r2 * x2) / (x3 + x * y2) + big.x;
  const by = (r2 * y + root) / (x2 + y2) + big.y;
  const i = Math.atan2(ay - big.y, ax - big.x);
  const j = Math.atan2(by - big.y, bx - big.x);
  const idx = Math.cos(i) * small.r;
  const idy = Math.sin(i) * small.r;
  const jdx = Math.cos(j) * small.r;
  const jdy = Math.sin(j) * small.r;
  return {
    big: [
      [ax + idx, ay + idy],
      [bx + jdx, by + jdy],
    ],
    small: [
      [small.x + idx, small.y + idy],
      [small.x + jdx, small.y + jdy],
    ],
  };
}

function matchUnorderedPair(
  actual: ReadonlyArray<readonly [number, number]>,
  expected: Array<[number, number]>,
  tolerance: number,
): void {
  const [a0, a1] = actual;
  const direct =
    Math.max(
      distance(a0![0], a0![1], expected[0]![0], expected[0]![1]),
      distance(a1![0], a1![1], expected[1]![0], expected[1]![1]),
    );
  const swapped =
    Math.max(
      distance(a0![0], a0![1], expected[1]![0], expected[1]![1]),
      distance(a1![0], a1![1], expected[0]![0], expected[0]![1]),
    );
  expect(Math.min(direct, swapped)).toBeLessThanOrEqual(tolerance);
}

/** Max signed distance of outline vertices outside the union of the input pressure discs. */
function maxExcessOutsideDiscs(
  outline: ReadonlyArray<readonly number[]>,
  centers: ReadonlyArray<readonly [number, number]>,
  radii: readonly number[],
): number {
  let maxExcess = -Infinity;
  for (const vertex of outline) {
    let best = Infinity;
    for (let index = 0; index < centers.length; index += 1) {
      const gap =
        distance(vertex[0]!, vertex[1]!, centers[index]![0], centers[index]![1])
        - radii[index]!;
      best = Math.min(best, gap);
    }
    maxExcess = Math.max(maxExcess, best);
  }
  return maxExcess;
}

function signedArea(loop: ReadonlyArray<readonly number[]>): number {
  let area = 0;
  for (let index = 0; index < loop.length; index += 1) {
    const current = loop[index]!;
    const next = loop[(index + 1) % loop.length]!;
    area += current[0]! * next[1]! - next[0]! * current[1]!;
  }
  return area / 2;
}

function segmentsCross(
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number,
): boolean {
  const orient = (px: number, py: number, qx: number, qy: number, rx: number, ry: number) =>
    (qx - px) * (ry - py) - (qy - py) * (rx - px);
  const o1 = orient(ax, ay, bx, by, cx, cy);
  const o2 = orient(ax, ay, bx, by, dx, dy);
  const o3 = orient(cx, cy, dx, dy, ax, ay);
  const o4 = orient(cx, cy, dx, dy, bx, by);
  return o1 * o2 < 0 && o3 * o4 < 0;
}

/** Strict ring simplicity: no proper crossing between non-adjacent edges. */
function ringIsSimple(loop: ReadonlyArray<readonly number[]>): boolean {
  const count = loop.length;
  for (let i = 0; i < count; i += 1) {
    const a = loop[i]!;
    const b = loop[(i + 1) % count]!;
    for (let j = i + 1; j < count; j += 1) {
      if (j === i || (j + 1) % count === i || (i + 1) % count === j) continue;
      const c = loop[j]!;
      const d = loop[(j + 1) % count]!;
      if (segmentsCross(a[0]!, a[1]!, b[0]!, b[1]!, c[0]!, c[1]!, d[0]!, d[1]!)) {
        return false;
      }
    }
  }
  return true;
}

/** Total absolute turning angle of a flat polyline, skipping zero-length segments. */
function totalTurnRadians(points: readonly number[]): number {
  const headings: number[] = [];
  for (let index = 2; index < points.length; index += 2) {
    const dx = points[index]! - points[index - 2]!;
    const dy = points[index + 1]! - points[index - 1]!;
    if (dx === 0 && dy === 0) continue;
    headings.push(Math.atan2(dy, dx));
  }
  let total = 0;
  for (let index = 1; index < headings.length; index += 1) {
    let turn = Math.abs(headings[index]! - headings[index - 1]!);
    if (turn > Math.PI) turn = Math.PI * 2 - turn;
    total += turn;
  }
  return total;
}

function deterministicCirclePair(seed: number): {
  c1: StudioCroquisCapsuleCircle;
  c2: StudioCroquisCapsuleCircle;
} {
  const unit = (salt: number) => studioOssUnitHash(seed, salt);
  return {
    c1: {
      x: (unit(1) - 0.5) * 400,
      y: (unit(2) - 0.5) * 400,
      r: unit(3) * 40,
    },
    c2: {
      x: (unit(4) - 0.5) * 400,
      y: (unit(5) - 0.5) * 400,
      r: unit(6) * 40,
    },
  };
}

const SPIKE_ZIGZAG = (() => {
  const points: number[] = [];
  const pressures: number[] = [];
  for (let index = 0; index < 15; index += 1) {
    points.push(index * 12, index % 2 === 0 ? 0 : 24);
    pressures.push(index === 7 ? 1 : 0.35);
  }
  return { points, pressures, strokeWidth: 16 };
})();

describe("solveStudioCroquisCapsule", () => {
  it("emits tangent points that lie exactly on both circles with perpendicular tangents", () => {
    let capsuleCount = 0;
    for (let seed = 1; seed <= 64; seed += 1) {
      const { c1, c2 } = deterministicCirclePair(seed);
      const solution = solveStudioCroquisCapsule(c1, c2);
      if (solution.kind !== "capsule") continue;
      capsuleCount += 1;
      const { big, small, unitPlus, unitMinus } = solution;
      for (const unit of [unitPlus, unitMinus]) {
        expect(Math.abs(Math.hypot(unit[0], unit[1]) - 1)).toBeLessThanOrEqual(1e-12);
      }
      const pairs = [
        { tangent: solution.bigPlus, circle: big },
        { tangent: solution.bigMinus, circle: big },
        { tangent: solution.smallPlus, circle: small },
        { tangent: solution.smallMinus, circle: small },
      ];
      for (const { tangent, circle } of pairs) {
        const radialError = Math.abs(
          distance(tangent[0], tangent[1], circle.x, circle.y) - circle.r,
        );
        expect(radialError).toBeLessThanOrEqual(1e-9 * Math.max(1, circle.r));
      }
      const edges = [
        { from: solution.bigPlus, to: solution.smallPlus, unit: unitPlus },
        { from: solution.bigMinus, to: solution.smallMinus, unit: unitMinus },
      ];
      for (const { from, to, unit } of edges) {
        const edgeX = to[0] - from[0];
        const edgeY = to[1] - from[1];
        const edgeLength = Math.hypot(edgeX, edgeY);
        const dot = Math.abs(edgeX * unit[0] + edgeY * unit[1]);
        expect(dot).toBeLessThanOrEqual(1e-9 * Math.max(1, edgeLength));
      }
    }
    expect(capsuleCount).toBeGreaterThan(32);
  });

  it("matches the verbatim croquis.js case2 construction, including vertical segments", () => {
    const fixtures: Array<[StudioCroquisCapsuleCircle, StudioCroquisCapsuleCircle]> = [
      [{ x: 10, y: 20, r: 9 }, { x: 64, y: 41, r: 4 }],
      [{ x: -30, y: 5, r: 14 }, { x: 22, y: -48, r: 6.5 }],
      [{ x: 0, y: 0, r: 12 }, { x: 0, y: 55, r: 3 }],
      [{ x: 100, y: -7, r: 2 }, { x: 100.000001, y: 40, r: 11 }],
    ];
    for (const [c1, c2] of fixtures) {
      const solution = solveStudioCroquisCapsule(c1, c2);
      expect(solution.kind).toBe("capsule");
      if (solution.kind !== "capsule") continue;
      const reference = croquisReferenceCase2(solution.big, solution.small);
      matchUnorderedPair([solution.bigPlus, solution.bigMinus], reference.big, 1e-5);
      matchUnorderedPair([solution.smallPlus, solution.smallMinus], reference.small, 1e-5);
    }
  });

  it("matches the croquis.js case1 perpendicular quad for equal radii", () => {
    const c1: StudioCroquisCapsuleCircle = { x: 4, y: -9, r: 7 };
    const c2: StudioCroquisCapsuleCircle = { x: 61, y: 24, r: 7 };
    const solution = solveStudioCroquisCapsule(c1, c2);
    expect(solution.kind).toBe("capsule");
    if (solution.kind !== "capsule") return;
    const heading = Math.atan2(c2.y - c1.y, c2.x - c1.x);
    const angles = [heading - Math.PI / 2, heading + Math.PI / 2];
    const referenceBig = angles.map(
      (angle) => [c1.x + Math.cos(angle) * c1.r, c1.y + Math.sin(angle) * c1.r] as [number, number],
    );
    const referenceSmall = angles.map(
      (angle) => [c2.x + Math.cos(angle) * c2.r, c2.y + Math.sin(angle) * c2.r] as [number, number],
    );
    matchUnorderedPair([solution.bigPlus, solution.bigMinus], referenceBig, 1e-9);
    matchUnorderedPair([solution.smallPlus, solution.smallMinus], referenceSmall, 1e-9);
  });

  it("collapses to the big circle when it swallows the small one, and to empty without ink", () => {
    const swallowed = solveStudioCroquisCapsule(
      { x: 0, y: 0, r: 20 },
      { x: 3, y: 4, r: 2 },
    );
    expect(swallowed).toMatchObject({ kind: "circle", circle: { x: 0, y: 0, r: 20 } });
    const concentric = solveStudioCroquisCapsule(
      { x: 5, y: 5, r: 3 },
      { x: 5, y: 5, r: 8 },
    );
    expect(concentric).toMatchObject({ kind: "circle", circle: { x: 5, y: 5, r: 8 } });
    expect(solveStudioCroquisCapsule({ x: 1, y: 1, r: 0 }, { x: 1, y: 1, r: 0 }).kind)
      .toBe("empty");
    expect(solveStudioCroquisCapsule({ x: 0, y: 0, r: Number.NaN }, { x: 9, y: 0, r: 3 }).kind)
      .toBe("empty");
  });

  it("supports zero-radius taper tips as cone capsules outside the big circle", () => {
    const solution = solveStudioCroquisCapsule(
      { x: 0, y: 0, r: 10 },
      { x: 40, y: 0, r: 0 },
    );
    expect(solution.kind).toBe("capsule");
    if (solution.kind !== "capsule") return;
    expect(distance(solution.smallPlus[0], solution.smallPlus[1], 40, 0)).toBeLessThanOrEqual(1e-9);
    expect(distance(solution.smallMinus[0], solution.smallMinus[1], 40, 0))
      .toBeLessThanOrEqual(1e-9);
  });
});

describe("capsule stroke loops", () => {
  it("never bulges past the segment's larger pressure diameter on a straight stroke", () => {
    const points: number[] = [];
    const radii: number[] = [];
    for (let index = 0; index < 13; index += 1) {
      points.push(index * 9, 0);
      radii.push(index === 6 ? 11 : 2.5);
    }
    const loops = buildStudioCroquisCapsuleStrokeLoops({ points, radii });
    expect(loops.length).toBe(12);
    for (let segment = 0; segment < loops.length; segment += 1) {
      const limit = Math.max(radii[segment]!, radii[segment + 1]!);
      for (const vertex of loops[segment]!) {
        // width across the horizontal axis == 2·|y|; must stay within max(2r1, 2r2).
        expect(Math.abs(vertex[1]!)).toBeLessThanOrEqual(limit + 1e-9);
      }
    }
  });

  it("stays inside the pressure discs where the perfect-freehand reference overshoots", () => {
    const { points, pressures, strokeWidth } = SPIKE_ZIGZAG;
    const profile = STUDIO_PERFECT_FREEHAND_PROFILES.gpen;
    const outline = buildStudioPerfectFreehandOutline(stroker, {
      points,
      pressures,
      strokeWidth,
      profile,
    });
    expect(outline.length).toBeGreaterThan(0);
    // perfect-freehand's own pressure→diameter law (see gpen profile comment).
    const radii = pressures.map(
      (pressure) => (strokeWidth / 2) * (1 + 2 * profile.thinning * (pressure - 0.5)),
    );
    const centers: Array<[number, number]> = [];
    for (let index = 0; index < points.length; index += 2) {
      centers.push([points[index]!, points[index + 1]!]);
    }
    const freehandExcess = maxExcessOutsideDiscs(outline, centers, radii);
    expect(freehandExcess).toBeGreaterThan(0.5);

    const loops = buildStudioCroquisCapsuleStrokeLoops({ points, radii });
    expect(loops.length).toBeGreaterThan(0);
    for (const loop of loops) {
      expect(maxExcessOutsideDiscs(loop, centers, radii)).toBeLessThanOrEqual(1e-9);
    }
  });

  it("emits closed, simple, uniformly wound rings for monotonic radius spans", () => {
    const points: number[] = [];
    const radii: number[] = [];
    for (let index = 0; index < 24; index += 1) {
      const angle = index * 0.22;
      points.push(index * 11 + Math.sin(angle) * 4, Math.cos(angle) * 26);
      radii.push(0.5 + index * 0.65);
    }
    const loops = buildStudioCroquisCapsuleStrokeLoops({ points, radii });
    expect(loops.length).toBe(23);
    let sign = 0;
    for (const loop of loops) {
      expect(loop.length).toBeGreaterThanOrEqual(3);
      expect(ringIsSimple(loop)).toBe(true);
      const area = signedArea(loop);
      expect(Math.abs(area)).toBeGreaterThan(0);
      if (sign === 0) sign = Math.sign(area);
      expect(Math.sign(area)).toBe(sign);
    }
    const pathData = studioCroquisCapsuleLoopsToPathData(loops);
    expect(pathData).toMatch(/^(M[^MZ]+Z)( M[^MZ]+Z)*$/u);
    expect(pathData.match(/Z/gu)?.length).toBe(loops.length);
    expect(pathData).toMatch(/^[MLZ0-9 .-]+$/u);
  });

  it("collapses duplicate positions, renders dots, and fails closed on malformed input", () => {
    const duplicated = buildStudioCroquisCapsuleStrokeLoops({
      points: [0, 0, 0, 0, 30, 0, 30, 0],
      radii: [3, 5, 4, 4],
    });
    const collapsed = buildStudioCroquisCapsuleStrokeLoops({
      points: [0, 0, 30, 0],
      radii: [5, 4],
    });
    expect(duplicated).toEqual(collapsed);

    const dot = buildStudioCroquisCapsuleStrokeLoops({ points: [12, -7], radii: [6] });
    expect(dot.length).toBe(1);
    for (const vertex of dot[0]!) {
      expect(Math.abs(distance(vertex[0]!, vertex[1]!, 12, -7) - 6)).toBeLessThanOrEqual(1e-9);
    }

    expect(buildStudioCroquisCapsuleStrokeLoops({ points: [0, 0, 5], radii: [1, 1] }))
      .toEqual([]);
    expect(buildStudioCroquisCapsuleStrokeLoops({ points: [0, 0, 5, 5], radii: [1] }))
      .toEqual([]);
    expect(
      buildStudioCroquisCapsuleStrokeLoops({ points: [0, 0, Number.NaN, 5], radii: [1, 1] }),
    ).toEqual([]);
    expect(buildStudioCroquisCapsuleStrokeLoops({ points: [4, 4, 9, 9], radii: [0, 0] }))
      .toEqual([]);
    expect(buildStudioCroquisCapsuleStrokePathData({ points: [0, 0, 5], radii: [1, 1] }))
      .toBe("");
  });

  it("swallowed joints render as one circle ring instead of a degenerate capsule", () => {
    const loops = buildStudioCroquisCapsuleStrokeLoops({
      points: [0, 0, 2, 0, 60, 0],
      radii: [16, 3, 6],
    });
    expect(loops.length).toBe(2);
    for (const vertex of loops[0]!) {
      expect(Math.abs(distance(vertex[0]!, vertex[1]!, 0, 0) - 16)).toBeLessThanOrEqual(1e-9);
    }
  });

  it("is deterministic across repeated builds", () => {
    const input = {
      points: SPIKE_ZIGZAG.points,
      radii: studioCroquisCapsuleRadiiFromPressures(SPIKE_ZIGZAG.pressures, 14),
    };
    expect(buildStudioCroquisCapsuleStrokeLoops(input))
      .toEqual(buildStudioCroquisCapsuleStrokeLoops(input));
    expect(buildStudioCroquisCapsuleStrokePathData(input))
      .toBe(buildStudioCroquisCapsuleStrokePathData(input));
  });

  /** Per-build current-JavaScript-thread CPU ceiling in one clean, complete warm-process pass. */
  const CROQUIS_LONG_STROKE_CPU_BUDGET_MS = 40;
  /** Every build in a pass is graded so one unusually fast sample cannot hide repeated hitches. */
  const CROQUIS_LONG_STROKE_SAMPLES_PER_PASS = 5;
  /** An apparent violation must repeat across two fresh passes before it can fail the suite. */
  const CROQUIS_LONG_STROKE_CONFIRMATION_PASSES = 2;

  function longStrokeInput(): { points: number[]; radii: readonly number[] } {
    const points: number[] = [];
    const pressures: number[] = [];
    for (let index = 0; index < 2_000; index += 1) {
      points.push(index * 1.8, Math.sin(index * 0.05) * 60);
      pressures.push(0.2 + 0.8 * Math.abs(Math.sin(index * 0.013)));
    }
    return { points, radii: studioCroquisCapsuleRadiiFromPressures(pressures, 12) };
  }

  /**
   * The builder is a pure function of (points, radii), so its emitted command and path-size census
   * is pinnable and holds on every machine with no clock involved. The path is built by walking
   * capsules and emitting their outlines, so finer tessellation, duplicate emitted segments, or
   * lost collinear-run merging moves these receipts. They do not claim full-byte output identity
   * or detect internal work that still emits the same string; the CPU gate below covers the latter
   * once it breaches the product ceiling.
   *
   * Recorded values, exact and reproduced across runs.
   */
  it("pins the emitted command and path-size census for a 2000-point stroke", () => {
    const { points, radii } = longStrokeInput();
    const pathData = buildStudioCroquisCapsuleStrokePathData({ points, radii });
    const occurrences = (pattern: RegExp) => (pathData.match(pattern) ?? []).length;

    expect(radii).toHaveLength(2_000);
    // 2000 points collapse to 1999 capsule segments, each a closed subpath.
    expect(occurrences(/M/gu)).toBe(1_999);
    expect(occurrences(/Z/gu)).toBe(1_999);
    expect(occurrences(/L/gu)).toBe(32_317);
    // Capsule outlines are polygonal: arcs or cubics here would mean a different emitter.
    expect(occurrences(/A/gu)).toBe(0);
    expect(occurrences(/C/gu)).toBe(0);
    expect(pathData.length).toBe(513_581);
  });

  /**
   * CPU, not wall time. The previous synthetic-kernel ratio stopped being a valid machine-speed
   * calibration for this allocating string builder: the same honest path read about 0.5x the
   * reference on Node 24/arm64 and up to 0.835x on the recorded Node 22/x64 runner. The existing
   * 1.20 gate, set with headroom above that runner reading, also sat above a doubled arm64 reading
   * of about 1.0. It could therefore pass while detecting nothing on the faster machine.
   *
   * This assertion makes the narrower product promise the original local gate was actually
   * intended to make: a warm 2000-point path consumes less than 40ms of user + system CPU on the
   * JavaScript worker that synchronously builds it. It deliberately does not claim that every
   * sub-40ms constant-factor slowdown is detectable.
   * The command census and byte length above remain machine-independent receipts for emitted
   * segment, tessellation, and path-size growth. They do not claim full-byte correctness.
   *
   * Five samples make one complete pass and its maximum is graded, so one fast build cannot hide
   * repeated allocation or GC hitches. An apparent violation earns two fresh complete passes; the
   * fastest complete pass decides, rather than splicing the fastest builds from different passes.
   * Vitest's default fork pool isolates this file from other suite workers, but
   * `process.cpuUsage()` still adds sibling V8 helper-thread CPU from parallel or concurrent GC
   * and JIT work. `process.threadCpuUsage()` grades only the current JavaScript worker; the
   * process-wide clock remains in the failure diagnostic. Synchronous allocation, zero-fill and
   * GC work on the current worker remain included. This is not end-to-end browser latency because
   * off-CPU waits and presentation are outside this Node fixture. The claim is one clean
   * warm-process pass with all five builds below 40ms, not a universal worst-case guarantee or
   * detection of every sub-40ms relative slowdown.
   */
  it("builds a 2000-point stroke path inside its main-thread CPU budget", () => {
    const { points, radii } = longStrokeInput();
    let sink = 0;

    const buildPath = () => {
      sink += buildStudioCroquisCapsuleStrokePathData({ points, radii }).length;
    };
    const measurePassCpuMs = (): {
      readonly mainThreadMs: readonly number[];
      readonly processMs: readonly number[];
    } => {
      const mainThreadMs: number[] = [];
      const processMs: number[] = [];
      for (
        let sample = 0;
        sample < CROQUIS_LONG_STROKE_SAMPLES_PER_PASS;
        sample += 1
      ) {
        const processBefore = process.cpuUsage();
        const threadBefore = process.threadCpuUsage();
        buildPath();
        const threadAfter = process.threadCpuUsage(threadBefore);
        const processAfter = process.cpuUsage(processBefore);
        mainThreadMs.push((threadAfter.user + threadAfter.system) / 1_000);
        processMs.push((processAfter.user + processAfter.system) / 1_000);
      }
      return { mainThreadMs, processMs };
    };

    buildPath();
    buildPath();
    const cpuPasses = [measurePassCpuMs()];
    const worstCpuMs = (samples: readonly number[]) => Math.max(...samples);
    if (worstCpuMs(cpuPasses[0]!.mainThreadMs) >= CROQUIS_LONG_STROKE_CPU_BUDGET_MS) {
      for (
        let confirmation = 0;
        confirmation < CROQUIS_LONG_STROKE_CONFIRMATION_PASSES;
        confirmation += 1
      ) {
        cpuPasses.push(measurePassCpuMs());
      }
    }

    const bestCpuPass = cpuPasses.reduce((best, candidate) =>
      worstCpuMs(candidate.mainThreadMs) < worstCpuMs(best.mainThreadMs) ? candidate : best
    );
    const bestPassWorstMainThreadCpuMs = worstCpuMs(bestCpuPass.mainThreadMs);
    expect(
      bestPassWorstMainThreadCpuMs,
      `2000-point croquis capsule path worst build used `
        + `${bestPassWorstMainThreadCpuMs.toFixed(2)}ms main-thread CPU `
        + `(same-pass process CPU max ${worstCpuMs(bestCpuPass.processMs).toFixed(2)}ms; `
        + `main-thread passes: ${cpuPasses
          .map(({ mainThreadMs }) => (
            `[${mainThreadMs.map((value) => value.toFixed(2)).join(", ")}]`
          ))
          .join("; ")})`,
    ).toBeLessThan(CROQUIS_LONG_STROKE_CPU_BUDGET_MS);

    expect(sink).toBeGreaterThan(0);
  });
});

describe("applyStudioCroquisPulledStringPrefilter", () => {
  const zigzag = (() => {
    const points: number[] = [];
    for (let index = 0; index < 40; index += 1) {
      points.push(index * 7, index % 2 === 0 ? 0 : 26);
    }
    return points;
  })();

  it("preserves endpoints, sample count, and determinism", () => {
    const filtered = applyStudioCroquisPulledStringPrefilter(zigzag);
    expect(filtered.length).toBe(zigzag.length);
    expect(filtered[0]).toBe(zigzag[0]);
    expect(filtered[1]).toBe(zigzag[1]);
    expect(filtered[filtered.length - 2]).toBe(zigzag[zigzag.length - 2]);
    expect(filtered[filtered.length - 1]).toBe(zigzag[zigzag.length - 1]);
    expect(applyStudioCroquisPulledStringPrefilter(zigzag)).toEqual(filtered);
  });

  it("matches the verbatim croquis.js follower rule for interior samples", () => {
    const stringLength = STUDIO_CROQUIS_PULLED_STRING_DEFAULT_LENGTH_PX;
    const filtered = applyStudioCroquisPulledStringPrefilter(zigzag, {
      stringLengthPx: stringLength,
    });
    let followerX = zigzag[0]!;
    let followerY = zigzag[1]!;
    for (let index = 1; index < zigzag.length / 2 - 1; index += 1) {
      const deltaX = zigzag[index * 2]! - followerX;
      const deltaY = zigzag[index * 2 + 1]! - followerY;
      const d = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
      if (d > stringLength) {
        const t = Math.min((d - stringLength) / stringLength, 1);
        followerX += deltaX * t;
        followerY += deltaY * t;
      }
      expect(filtered[index * 2]).toBe(followerX);
      expect(filtered[index * 2 + 1]).toBe(followerY);
    }
  });

  it("reduces zigzag curvature, monotonically with string length", () => {
    const rawTurn = totalTurnRadians(zigzag);
    // Lengths above half the raw step distance — a fully slack string (d > 2L for every
    // sample) passes input through unchanged by construction, which is not a smoothing case.
    const lengths = [25, 50, 100];
    const turns = lengths.map((stringLengthPx) =>
      totalTurnRadians(
        applyStudioCroquisPulledStringPrefilter(zigzag, { stringLengthPx }),
      ),
    );
    for (const turn of turns) {
      expect(turn).toBeLessThan(rawTurn);
    }
    for (let index = 1; index < turns.length; index += 1) {
      expect(turns[index]!).toBeLessThanOrEqual(turns[index - 1]! + 1e-9);
    }
  });

  it("parks the follower while slack, producing collapsible duplicate samples", () => {
    const jitter: number[] = [];
    for (let index = 0; index < 12; index += 1) {
      jitter.push(Math.sin(index) * 4, Math.cos(index) * 4);
    }
    const filtered = applyStudioCroquisPulledStringPrefilter(jitter, { stringLengthPx: 50 });
    let duplicates = 0;
    for (let index = 1; index < filtered.length / 2 - 1; index += 1) {
      if (
        filtered[index * 2] === filtered[(index - 1) * 2]
        && filtered[index * 2 + 1] === filtered[(index - 1) * 2 + 1]
      ) {
        duplicates += 1;
      }
    }
    expect(duplicates).toBeGreaterThan(0);
  });

  it("handles trivial and malformed inputs without throwing", () => {
    expect(applyStudioCroquisPulledStringPrefilter([])).toEqual([]);
    expect(applyStudioCroquisPulledStringPrefilter([3, 4])).toEqual([3, 4]);
    expect(applyStudioCroquisPulledStringPrefilter([0, 1, 2])).toEqual([]);
    const withNaN = applyStudioCroquisPulledStringPrefilter([0, 0, Number.NaN, 9, 200, 0]);
    expect(withNaN.length).toBe(6);
    expect(withNaN[2]).toBe(0);
    expect(withNaN[3]).toBe(0);
    expect(withNaN[4]).toBe(200);
    expect(withNaN[5]).toBe(0);
  });
});

describe("program pins", () => {
  it("resolves only the two published croquis programs and fails closed otherwise", () => {
    const capsule = resolveStudioCroquisCapsulePenProgram("croquis-capsule-v1");
    expect(capsule).toBe(STUDIO_CROQUIS_CAPSULE_PEN_PROGRAMS["croquis-capsule-v1"]);
    expect(capsule?.pulledStringLengthPx).toBeNull();
    const stabilized = resolveStudioCroquisCapsulePenProgram(
      "croquis-capsule-pulled-string-v1",
    );
    expect(stabilized?.pulledStringLengthPx)
      .toBe(STUDIO_CROQUIS_PULLED_STRING_DEFAULT_LENGTH_PX);
    // Unknown or removed ids must never converge to another renderer.
    expect(resolveStudioCroquisCapsulePenProgram("croquis-capsule-v2")).toBeNull();
    expect(resolveStudioCroquisCapsulePenProgram("pen")).toBeNull();
    expect(resolveStudioCroquisCapsulePenProgram("gpen")).toBeNull();
    expect(resolveStudioCroquisCapsulePenProgram("")).toBeNull();
    expect(resolveStudioCroquisCapsulePenProgram(undefined)).toBeNull();
    expect(Object.isFrozen(STUDIO_CROQUIS_CAPSULE_PEN_PROGRAMS)).toBe(true);
    expect(Object.isFrozen(STUDIO_CROQUIS_CAPSULE_PEN_PROGRAMS["croquis-capsule-v1"]))
      .toBe(true);
  });

  it("maps pressure to radius with the croquis half-size rule", () => {
    expect(studioCroquisCapsuleRadiiFromPressures([0, 0.5, 1], 10)).toEqual([0, 2.5, 5]);
    expect(studioCroquisCapsuleRadiiFromPressures([2, -1, Number.NaN], 10)).toEqual([5, 0, 0]);
    expect(studioCroquisCapsuleRadiiFromPressures([1], Number.NaN)).toEqual([0]);
  });
});

describe("capsule loop geometry helpers", () => {
  it("keeps arc vertices on their source circles", () => {
    const solution = solveStudioCroquisCapsule(
      { x: 0, y: 0, r: 8 },
      { x: 34, y: 13, r: 3 },
    );
    expect(solution.kind).toBe("capsule");
    const loop = studioCroquisCapsuleLoop(solution, 0.05);
    expect(loop.length).toBeGreaterThan(8);
    for (const vertex of loop) {
      const onBig = Math.abs(distance(vertex[0]!, vertex[1]!, 0, 0) - 8);
      const onSmall = Math.abs(distance(vertex[0]!, vertex[1]!, 34, 13) - 3);
      expect(Math.min(onBig, onSmall)).toBeLessThanOrEqual(1e-9);
    }
  });
});
