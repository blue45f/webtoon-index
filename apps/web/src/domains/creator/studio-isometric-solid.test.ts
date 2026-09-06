import { describe, expect, it } from "vitest";

import { exportPageToSvg } from "./export/studio-svg-export";
import {
  STUDIO_ISOMETRIC_COORDINATE_MAX,
  createStudioIsometricPrimitiveElements,
  createStudioIsometricSolidElements,
  normalizeStudioIsometricSolidInput,
  planStudioIsometricPrimitive,
  planStudioIsometricSolid,
  projectStudioIsometricPoint,
} from "./studio-isometric-solid";

describe("studio isometric solid", () => {
  it("projects the three drafting axes deterministically", () => {
    const config = { originX: 100, originY: 200, angleDeg: 30 };
    expect(projectStudioIsometricPoint({ x: 10, y: 0, z: 0 }, config)).toEqual({
      x: 100 + 5 * Math.sqrt(3),
      y: 205,
    });
    expect(projectStudioIsometricPoint({ x: 0, y: 10, z: 0 }, config)).toEqual({
      x: 100 - 5 * Math.sqrt(3),
      y: 205,
    });
    expect(projectStudioIsometricPoint({ x: 0, y: 0, z: 10 }, config)).toEqual({
      x: 100,
      y: 190,
    });
  });

  it("plans exactly three visible quad faces with shared vertices", () => {
    const plan = planStudioIsometricSolid({
      originX: 400,
      originY: 500,
      angleDeg: 30,
      width: 120,
      depth: 80,
      height: 160,
    });
    expect(plan.faces.map((face) => face.id)).toEqual(["left", "right", "top"]);
    expect(plan.faces.every((face) => face.points.length === 4)).toBe(true);
    expect(plan.faces[0].points[0]).toBe(plan.vertices.origin);
    expect(plan.faces[1].points[0]).toBe(plan.vertices.origin);
    expect(plan.faces[2].points[0]).toBe(plan.vertices.z);
    expect(plan.bounds.width).toBeGreaterThan(0);
    expect(plan.bounds.height).toBeGreaterThan(0);
  });

  it("normalizes hostile numeric input without producing non-finite geometry", () => {
    const normalized = normalizeStudioIsometricSolidInput({
      originX: Number.POSITIVE_INFINITY,
      originY: Number.NaN,
      angleDeg: -900,
      width: 0,
      depth: -20,
      height: Number.NaN,
    });
    expect(normalized).toEqual({
      originX: 0,
      originY: 0,
      angleDeg: 1,
      width: 1,
      depth: 20,
      height: 1,
    });
    const plan = planStudioIsometricSolid(normalized);
    expect(Object.values(plan.vertices).flatMap((point) => [point.x, point.y]).every(Number.isFinite))
      .toBe(true);
  });

  it("creates independently editable filled vector faces with stable shading", () => {
    const plan = planStudioIsometricSolid({
      originX: 0,
      originY: 0,
      angleDeg: 30,
      width: 40,
      depth: 40,
      height: 40,
    });
    const elements = createStudioIsometricSolidElements(plan, {
      ids: ["left", "right", "top"],
      baseColor: "#6480c8",
      strokeColor: "#111827",
      strokeWidth: 3,
      opacity: 0.8,
    });
    expect(elements).toHaveLength(3);
    expect(elements.map((element) => element.id)).toEqual(["left", "right", "top"]);
    expect(elements.every((element) => (
      element.type === "draw" &&
      element.kind === "freehand" &&
      element.points.length === 8 &&
      element.sampleSpacing === 1 &&
      element.stroke === "#111827" &&
      element.strokeWidth === 3 &&
      element.opacity === 0.8
    ))).toBe(true);
    expect(new Set(elements.map((element) => element.fill)).size).toBe(3);

    const svg = exportPageToSvg({
      width: 800,
      height: 1_200,
      bg: "#ffffff",
      elements,
    }).svg;
    expect((svg.match(/<path d=/g) ?? [])).toHaveLength(3);
    expect(svg).toContain('fill="#5066a0"');
    expect(svg).toContain('stroke="#111827"');
    expect(svg).toMatch(/<path d="M [^"]+ Z" fill=/);
  });

  it("plans a bounded cylinder as shaded side bands and one top face", () => {
    const plan = planStudioIsometricPrimitive({
      kind: "cylinder",
      originX: -240,
      originY: 320,
      angleDeg: 30,
      width: -160,
      depth: 120,
      height: 180,
      segments: 15,
    });

    expect(plan.input).toMatchObject({ width: 160, depth: 120, height: 180, segments: 16 });
    expect(plan.faces).toHaveLength(9);
    expect(plan.faces.filter((face) => face.role === "side")).toHaveLength(8);
    expect(plan.faces.filter((face) => face.role === "top")).toHaveLength(1);
    expect(plan.faces.every((face, index) => (
      index === 0 || plan.faces[index - 1]!.paintDepth >= face.paintDepth
    ))).toBe(true);
    expect(plan.faces.every((face) => signedScreenArea(face.points) > 0)).toBe(true);
    expect(plan.faces.flatMap((face) => face.points).every(({ x, y }) => (
      Number.isFinite(x) && Number.isFinite(y)
    ))).toBe(true);
    expect(plan.bounds.width).toBeGreaterThan(0);
    expect(plan.bounds.height).toBeGreaterThan(0);
  });

  it("paints the front cylinder bands before a cap that remains visible on squat inputs", () => {
    const plan = planStudioIsometricPrimitive({
      kind: "cylinder",
      originX: 0,
      originY: 0,
      angleDeg: 30,
      width: 1_000,
      depth: 1_000,
      height: 1,
      segments: 16,
    });
    const sides = plan.faces.filter((face) => face.role === "side");
    const capCenterY = plan.input.originY - plan.input.height;

    expect(plan.faces.at(-1)?.id).toBe("top");
    expect(sides.flatMap((face) => face.points).every((point) => (
      point.y >= capCenterY - 1e-9
    ))).toBe(true);
    expect(plan.faces.every((face, index) => (
      index === 0 || plan.faces[index - 1]!.paintDepth >= face.paintDepth
    ))).toBe(true);
  });

  it("bounds hostile cylinder segments and stair counts without exploding face count", () => {
    const cylinder = planStudioIsometricPrimitive({
      kind: "cylinder",
      originX: Number.POSITIVE_INFINITY,
      originY: Number.NaN,
      angleDeg: 999,
      width: Number.NaN,
      depth: Number.POSITIVE_INFINITY,
      height: 0,
      segments: Number.POSITIVE_INFINITY,
    });
    const stairs = planStudioIsometricPrimitive({
      kind: "stairs",
      originX: -Number.POSITIVE_INFINITY,
      originY: 0,
      angleDeg: -999,
      width: -0,
      depth: -40,
      height: Number.NaN,
      steps: 999_999,
    });

    expect(cylinder.input).toMatchObject({
      originX: 0,
      originY: 0,
      angleDeg: 89,
      width: 1,
      depth: 1,
      height: 1,
      segments: 24,
    });
    expect(cylinder.faces).toHaveLength(13);
    expect(stairs.input).toMatchObject({
      originX: 0,
      angleDeg: 1,
      width: 1,
      depth: 40,
      height: 1,
      steps: 24,
    });
    expect(stairs.faces).toHaveLength(49);
    expect([...cylinder.faces, ...stairs.faces].flatMap((face) => face.points).every(({ x, y }) => (
      Number.isFinite(x) && Number.isFinite(y)
    ))).toBe(true);
  });

  it("fits every primitive inside the durable CRDT coordinate budget without degenerating faces", () => {
    const common = {
      originX: STUDIO_ISOMETRIC_COORDINATE_MAX,
      originY: STUDIO_ISOMETRIC_COORDINATE_MAX,
      angleDeg: 30,
      width: 1_000_000,
      depth: 1_000_000,
      height: 1_000_000,
    };
    const plans = [
      planStudioIsometricPrimitive({ kind: "box", ...common }),
      planStudioIsometricPrimitive({ kind: "cylinder", ...common, segments: 64 }),
      planStudioIsometricPrimitive({ kind: "stairs", ...common, steps: 24 }),
      planStudioIsometricPrimitive({ kind: "wedge", ...common }),
    ];

    for (const plan of plans) {
      const points = plan.faces.flatMap((face) => face.points);
      expect(points.every(({ x, y }) => (
        Number.isFinite(x)
        && Number.isFinite(y)
        && Math.abs(x) <= STUDIO_ISOMETRIC_COORDINATE_MAX
        && Math.abs(y) <= STUDIO_ISOMETRIC_COORDINATE_MAX
      ))).toBe(true);
      expect(plan.faces.every((face) => signedScreenArea(face.points) > 0)).toBe(true);
    }
  });

  it("plans stairs as far-to-near risers, treads, and one editable profile side", () => {
    const plan = planStudioIsometricPrimitive({
      kind: "stairs",
      originX: 400,
      originY: 700,
      angleDeg: 30,
      width: 240,
      depth: 300,
      height: 180,
      steps: 6,
    });

    expect(plan.faces).toHaveLength(13);
    expect(plan.faces.filter((face) => face.role === "riser")).toHaveLength(6);
    expect(plan.faces.filter((face) => face.role === "tread")).toHaveLength(6);
    const side = plan.faces.find((face) => face.id === "left");
    expect(side?.points).toHaveLength(14);
    expect(plan.faces.every((face, index) => (
      index === 0 || plan.faces[index - 1]!.paintDepth >= face.paintDepth
    ))).toBe(true);
    expect(plan.faces.every((face) => signedScreenArea(face.points) > 0)).toBe(true);
  });

  it("supports box and wedge through the generic painter-order plan", () => {
    const common = {
      originX: 0,
      originY: 0,
      angleDeg: 30,
      width: 120,
      depth: 90,
      height: 80,
    };
    const box = planStudioIsometricPrimitive({ kind: "box", ...common });
    const wedge = planStudioIsometricPrimitive({ kind: "wedge", ...common });

    expect(box.faces).toHaveLength(3);
    expect(box.faces.map((face) => face.id).sort()).toEqual(["left", "right", "top"]);
    expect(wedge.faces).toHaveLength(3);
    expect(wedge.faces.map((face) => face.id).sort()).toEqual(["front", "left", "slope"]);
    expect([...box.faces, ...wedge.faces].every((face) => signedScreenArea(face.points) > 0))
      .toBe(true);
  });

  it("translates every projected primitive face exactly with positive and negative origins", () => {
    const base = planStudioIsometricPrimitive({
      kind: "stairs",
      originX: -500,
      originY: 275,
      angleDeg: 45,
      width: 80,
      depth: 120,
      height: 60,
      steps: 3,
    });
    const translated = planStudioIsometricPrimitive({
      kind: "stairs",
      originX: 700,
      originY: -325,
      angleDeg: 45,
      width: 80,
      depth: 120,
      height: 60,
      steps: 3,
    });

    expect(translated.faces.map((face) => face.id)).toEqual(base.faces.map((face) => face.id));
    translated.faces.forEach((face, faceIndex) => {
      face.points.forEach((point, pointIndex) => {
        const original = base.faces[faceIndex]!.points[pointIndex]!;
        expect(point.x - original.x).toBeCloseTo(1_200, 10);
        expect(point.y - original.y).toBeCloseTo(-600, 10);
      });
    });
  });

  it("creates one closed SVG-compatible batch with deterministic per-face shading", () => {
    const plan = planStudioIsometricPrimitive({
      kind: "cylinder",
      originX: 200,
      originY: 500,
      angleDeg: 30,
      width: 160,
      depth: 120,
      height: 200,
      segments: 12,
    });
    const ids = plan.faces.map((_, index) => `cylinder-face-${index}`);
    const elements = createStudioIsometricPrimitiveElements(plan, {
      ids,
      baseColor: "#6480c8",
      strokeColor: "#111827",
      strokeWidth: 2.5,
      opacity: 0.75,
    });

    expect(elements).toHaveLength(plan.faces.length);
    expect(elements.map((element) => element.id)).toEqual(ids);
    expect(elements.every((element) => (
      element.type === "draw"
      && element.kind === "freehand"
      && element.sampleSpacing === 1
      && element.stroke === "#111827"
      && element.strokeWidth === 2.5
      && element.opacity === 0.75
      && typeof element.fill === "string"
    ))).toBe(true);
    expect(new Set(elements.map((element) => element.fill)).size).toBeGreaterThan(2);

    const svg = exportPageToSvg({
      width: 800,
      height: 1_200,
      bg: "#ffffff",
      elements,
    }).svg;
    expect((svg.match(/<path d=/g) ?? [])).toHaveLength(plan.faces.length);
    expect((svg.match(/ Z" fill="#/g) ?? [])).toHaveLength(plan.faces.length);
    expect(svg).toContain('stroke="#111827"');
  });

  it("rejects incomplete or duplicate face-id batches", () => {
    const plan = planStudioIsometricPrimitive({
      kind: "wedge",
      originX: 0,
      originY: 0,
      angleDeg: 30,
      width: 100,
      depth: 100,
      height: 100,
    });
    expect(() => createStudioIsometricPrimitiveElements(plan, {
      ids: ["one", "two"],
      baseColor: "#ffffff",
    })).toThrow(RangeError);
    expect(() => createStudioIsometricPrimitiveElements(plan, {
      ids: ["same", "same", "same"],
      baseColor: "#ffffff",
    })).toThrow(RangeError);
  });
});

function signedScreenArea(points: readonly { x: number; y: number }[]): number {
  let doubledArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!;
    const next = points[(index + 1) % points.length]!;
    doubledArea += current.x * next.y - next.x * current.y;
  }
  return doubledArea / 2;
}
