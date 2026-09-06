import { describe, expect, it } from "vitest";

import {
  STUDIO_ADVANCED_RULER_MAX_SERIALIZED_BYTES,
  STUDIO_ADVANCED_RULER_NAME_PREFIXES,
  copyStudioAdvancedRulerAsJson,
  createDefaultStudioAdvancedRulerDocument,
  createStudioAdvancedRulerOfType,
  mirrorStudioAdvancedRulerDocument,
  normalizeStudioAdvancedRulerDocument,
  parseStudioAdvancedRulerDocument,
  resolveActiveStudioAdvancedRuler,
  studioAdvancedRulerAppliesToGroup,
  type StudioAdvancedRuler,
  type StudioAdvancedRulerDocument,
  type StudioAuthoredConcentricRuler,
  type StudioAuthoredCurveRuler,
  type StudioAuthoredFisheyeRuler,
  type StudioAuthoredParallelRuler,
  type StudioAuthoredRadialRuler,
} from "./studio-advanced-ruler-document";

const curve: StudioAuthoredCurveRuler = {
  id: "curve-a",
  type: "curve",
  name: "허리선",
  enabled: true,
  visible: true,
  scope: { kind: "page", groupId: null },
  snapMode: "through-start",
  fixedOffset: 0,
  p0: { x: 10, y: 20 },
  p1: { x: 30, y: 5 },
  p2: { x: 70, y: 5 },
  p3: { x: 90, y: 20 },
};

const fisheye: StudioAuthoredFisheyeRuler = {
  id: "fisheye-a",
  type: "fisheye",
  name: "광각",
  enabled: true,
  visible: true,
  scope: { kind: "group", groupId: "background" },
  guideFamily: "auto",
  centerX: 400,
  centerY: 600,
  radius: 320,
  rotationDeg: 15,
  fovDeg: 180,
  strength: 1,
  outsidePolicy: "clamp",
};

const parallel: StudioAuthoredParallelRuler = {
  id: "parallel-a",
  type: "parallel",
  name: "빗줄기",
  enabled: true,
  visible: true,
  scope: { kind: "page", groupId: null },
  angleDeg: 60,
  originX: 240,
  originY: 480,
  guideSpacing: 96,
};

const concentric: StudioAuthoredConcentricRuler = {
  id: "concentric-a",
  type: "concentric",
  name: "파문",
  enabled: true,
  visible: true,
  scope: { kind: "page", groupId: null },
  centerX: 320,
  centerY: 320,
  guideSpacing: 120,
};

const radial: StudioAuthoredRadialRuler = {
  id: "radial-a",
  type: "radial",
  name: "집중선",
  enabled: true,
  visible: true,
  scope: { kind: "group", groupId: "effects" },
  centerX: 400,
  centerY: 200,
};

function document(): StudioAdvancedRulerDocument {
  return {
    version: 1,
    rulers: [curve, fisheye, parallel, concentric, radial],
    activeSnapRulerId: "fisheye-a",
    selectedRulerId: "curve-a",
  };
}

describe("studio advanced ruler document", () => {
  it("creates a bounded empty document", () => {
    expect(createDefaultStudioAdvancedRulerDocument()).toEqual({
      version: 1,
      rulers: [],
      activeSnapRulerId: null,
      selectedRulerId: null,
    });
  });

  it("strictly round-trips multiple scoped rulers", () => {
    expect(parseStudioAdvancedRulerDocument(document())).toEqual(document());
    expect(resolveActiveStudioAdvancedRuler(document(), "background")).toEqual(fisheye);
    expect(resolveActiveStudioAdvancedRuler(document(), "characters")).toBeNull();
    expect(studioAdvancedRulerAppliesToGroup(curve, "characters")).toBe(true);
    expect(studioAdvancedRulerAppliesToGroup(fisheye, "background")).toBe(true);
  });

  it("rejects unknown keys, duplicate ids and an inactive snap owner", () => {
    expect(parseStudioAdvancedRulerDocument({ ...document(), future: true })).toBeNull();
    expect(parseStudioAdvancedRulerDocument({
      ...document(),
      rulers: [curve, { ...fisheye, id: curve.id }],
    })).toBeNull();
    expect(parseStudioAdvancedRulerDocument({
      ...document(),
      rulers: [curve, { ...fisheye, enabled: false }],
    })).toBeNull();
  });

  it("normalizes malformed values and drops unsafe ids deterministically", () => {
    expect(normalizeStudioAdvancedRulerDocument({
      rulers: [
        { ...curve, name: "", fixedOffset: Infinity },
        { ...curve },
        { ...fisheye, id: "bad\u0000id" },
      ],
      activeSnapRulerId: "missing",
      selectedRulerId: curve.id,
    })).toEqual({
      version: 1,
      rulers: [{ ...curve, name: "곡선자", fixedOffset: 0 }],
      activeSnapRulerId: null,
      selectedRulerId: curve.id,
    });
  });

  it("trims tolerant input to the same serialized budget enforced by the strict boundary", () => {
    const rulers = Array.from({ length: 12 }, (_, index): StudioAuthoredCurveRuler => ({
      ...curve,
      id: `curve-${index}-${"x".repeat(140)}`,
      name: "곡".repeat(80),
    }));
    const oversized = {
      version: 1,
      rulers,
      activeSnapRulerId: null,
      selectedRulerId: null,
    };
    expect(parseStudioAdvancedRulerDocument(oversized)).toBeNull();

    const normalized = normalizeStudioAdvancedRulerDocument(oversized);
    expect(normalized.rulers.length).toBeLessThan(rulers.length);
    expect(new TextEncoder().encode(JSON.stringify(normalized)).byteLength)
      .toBeLessThanOrEqual(STUDIO_ADVANCED_RULER_MAX_SERIALIZED_BYTES);
    expect(parseStudioAdvancedRulerDocument(normalized)).toEqual(normalized);
  });

  it("rejects accessor-backed strict input without invoking accessors", () => {
    let getterCalls = 0;
    const hostile = {
      version: 1,
      activeSnapRulerId: null,
      selectedRulerId: null,
      get rulers() {
        getterCalls += 1;
        return [];
      },
    };
    expect(parseStudioAdvancedRulerDocument(hostile)).toBeNull();
    expect(getterCalls).toBe(0);
  });

  it("mirrors curve controls and fisheye center without mutating the source", () => {
    const source = document();
    source.rulers[0] = { ...curve, snapMode: "fixed", fixedOffset: 25 };
    const mirrored = mirrorStudioAdvancedRulerDocument(source, 800);
    expect((mirrored.rulers[0] as StudioAuthoredCurveRuler).p0.x).toBe(790);
    expect((mirrored.rulers[0] as StudioAuthoredCurveRuler).p3.x).toBe(710);
    expect((mirrored.rulers[0] as StudioAuthoredCurveRuler).fixedOffset).toBe(-25);
    expect((mirrored.rulers[1] as StudioAuthoredFisheyeRuler).centerX).toBe(400);
    expect((mirrored.rulers[1] as StudioAuthoredFisheyeRuler).rotationDeg).toBe(165);
    expect(curve.p0.x).toBe(10);
    mirrored.rulers[0]!.scope.kind = "group";
    expect(source.rulers[0]!.scope.kind).toBe("page");
  });

  it("mirrors parallel angle and circle/ray centers", () => {
    const mirrored = mirrorStudioAdvancedRulerDocument(document(), 800);
    expect(mirrored.rulers[2]).toEqual({ ...parallel, angleDeg: 120, originX: 560 });
    expect(mirrored.rulers[3]).toEqual({ ...concentric, centerX: 480 });
    expect(mirrored.rulers[4]).toEqual({ ...radial, centerX: 400 });
    expect(parallel.angleDeg).toBe(60);
  });

  it("normalizes malformed new-kind rulers and rejects invalid ones", () => {
    const normalized = normalizeStudioAdvancedRulerDocument({
      rulers: [
        { ...parallel, name: "", angleDeg: 240, guideSpacing: Number.NaN },
        { ...concentric, centerY: Number.POSITIVE_INFINITY, guideSpacing: 100_000 },
        { ...radial, id: "" },
        { ...radial, type: "spiral" },
      ],
      activeSnapRulerId: parallel.id,
      selectedRulerId: null,
    });
    expect(normalized.rulers).toEqual([
      { ...parallel, name: "평행선자", angleDeg: 60, guideSpacing: 96 },
      { ...concentric, centerY: 0, guideSpacing: 512 },
    ]);
    expect(normalized.activeSnapRulerId).toBe(parallel.id);
  });

  it("strictly rejects unknown keys and drifted values on new kinds", () => {
    expect(parseStudioAdvancedRulerDocument({
      ...document(),
      rulers: [{ ...parallel, future: true }],
      activeSnapRulerId: null,
      selectedRulerId: null,
    })).toBeNull();
    expect(parseStudioAdvancedRulerDocument({
      ...document(),
      rulers: [{ ...parallel, angleDeg: 240 }],
      activeSnapRulerId: null,
      selectedRulerId: null,
    })).toBeNull();
    expect(parseStudioAdvancedRulerDocument({
      ...document(),
      rulers: [{ ...concentric, guideSpacing: 8 }],
      activeSnapRulerId: null,
      selectedRulerId: null,
    })).toBeNull();
    expect(parseStudioAdvancedRulerDocument({
      ...document(),
      rulers: [{ ...radial, centerX: "10" }],
      activeSnapRulerId: null,
      selectedRulerId: null,
    })).toBeNull();
  });

  it("creates canonical defaults for every ruler kind", () => {
    const types = Object.keys(STUDIO_ADVANCED_RULER_NAME_PREFIXES) as StudioAdvancedRuler["type"][];
    for (const type of types) {
      const ruler = createStudioAdvancedRulerOfType(type, {
        id: `${type}-new`,
        name: `${STUDIO_ADVANCED_RULER_NAME_PREFIXES[type]} 1`,
        canvasWidth: 800,
        canvasHeight: 1_200,
      });
      expect(ruler.type).toBe(type);
      const normalized = normalizeStudioAdvancedRulerDocument({
        rulers: [ruler],
        activeSnapRulerId: ruler.id,
        selectedRulerId: ruler.id,
      });
      expect(normalized.rulers).toEqual([ruler]);
      expect(parseStudioAdvancedRulerDocument(normalized)).toEqual(normalized);
    }
    const added = createStudioAdvancedRulerOfType("parallel", {
      id: "p",
      name: "평행선 1",
      canvasWidth: 800,
      canvasHeight: 1_200,
    });
    expect(added).toMatchObject({ originX: 400, originY: 600, angleDeg: 0, guideSpacing: 96 });
  });

  it("copies every ruler kind into a JSON-safe payload", () => {
    for (const ruler of document().rulers) {
      const copy = copyStudioAdvancedRulerAsJson(ruler);
      expect(copy).toEqual(JSON.parse(JSON.stringify(ruler)));
      expect(copy).not.toBe(ruler);
      expect(copy.scope).not.toBe(ruler.scope);
    }
  });
});
