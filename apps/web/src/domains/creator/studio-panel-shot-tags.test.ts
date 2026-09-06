import { describe, it, expect } from "vitest";

import {
  SHOT_TYPES,
  CAMERA_ANGLES,
  isShotTypeId,
  isCameraAngleId,
  shotTypeLabel,
  shotTypeAbbr,
  cameraAngleLabel,
  cameraAngleAbbr,
  normalizeShotTag,
  withShotTag,
  shotTagBadgeText,
  shotTagBadgeTitle,
  type ShotTagCarrier,
} from "./studio-panel-shot-tags";

interface Page extends ShotTagCarrier {
  id: string;
  elements: unknown[];
}

function makePages(): Page[] {
  return [
    { id: "p1", elements: [] },
    { id: "p2", elements: [], shotType: "cu", cameraAngle: "low" },
  ];
}

describe("catalogs", () => {
  it("SHOT_TYPES has 11 unique ids", () => {
    expect(SHOT_TYPES).toHaveLength(11);
    expect(new Set(SHOT_TYPES.map((s) => s.id)).size).toBe(11);
  });

  it("CAMERA_ANGLES has 7 unique ids", () => {
    expect(CAMERA_ANGLES).toHaveLength(7);
    expect(new Set(CAMERA_ANGLES.map((a) => a.id)).size).toBe(7);
  });

  it("every catalog entry has non-empty abbr/label", () => {
    for (const s of SHOT_TYPES) {
      expect(s.abbr.length).toBeGreaterThan(0);
      expect(s.label.length).toBeGreaterThan(0);
    }
    for (const a of CAMERA_ANGLES) {
      expect(a.abbr.length).toBeGreaterThan(0);
      expect(a.label.length).toBeGreaterThan(0);
    }
  });
});

describe("isShotTypeId / isCameraAngleId", () => {
  it("accepts catalog ids", () => {
    expect(isShotTypeId("cu")).toBe(true);
    expect(isCameraAngleId("low")).toBe(true);
  });

  it("rejects unknown ids, non-strings, and empty string", () => {
    expect(isShotTypeId("nope")).toBe(false);
    expect(isShotTypeId("")).toBe(false);
    expect(isShotTypeId(null)).toBe(false);
    expect(isShotTypeId(undefined)).toBe(false);
    expect(isShotTypeId(42)).toBe(false);
    expect(isCameraAngleId("nope")).toBe(false);
    expect(isCameraAngleId(undefined)).toBe(false);
  });
});

describe("lookup helpers", () => {
  it("shotTypeLabel/shotTypeAbbr resolve known ids", () => {
    expect(shotTypeLabel("ecu")).toBe("익스트림 클로즈업");
    expect(shotTypeAbbr("ecu")).toBe("ECU");
  });

  it("cameraAngleLabel/cameraAngleAbbr resolve known ids", () => {
    expect(cameraAngleLabel("pov")).toBe("POV");
    expect(cameraAngleAbbr("dutch")).toBe("더치");
  });

  it("return undefined for unknown/non-string input", () => {
    expect(shotTypeLabel("bogus")).toBeUndefined();
    expect(shotTypeAbbr(123)).toBeUndefined();
    expect(cameraAngleLabel(null)).toBeUndefined();
    expect(cameraAngleAbbr(undefined)).toBeUndefined();
  });
});

describe("normalizeShotTag", () => {
  it("passes through valid ids", () => {
    expect(normalizeShotTag({ shotType: "ws", cameraAngle: "high" })).toEqual({
      shotType: "ws",
      cameraAngle: "high",
    });
  });

  it("drops invalid/unknown values and non-object input", () => {
    expect(normalizeShotTag({ shotType: "bogus", cameraAngle: 5 })).toEqual({});
    expect(normalizeShotTag(null)).toEqual({});
    expect(normalizeShotTag("string")).toEqual({});
    expect(normalizeShotTag(undefined)).toEqual({});
  });

  it("keeps only the valid half when partially valid", () => {
    expect(normalizeShotTag({ shotType: "cu", cameraAngle: "bogus" })).toEqual({ shotType: "cu" });
  });
});

describe("withShotTag", () => {
  it("sets shotType only, leaving cameraAngle untouched", () => {
    const pages = makePages();
    const next = withShotTag(pages, "p1", { shotType: "ecu" });
    expect(next).not.toBe(pages);
    expect(next[0]).toMatchObject({ shotType: "ecu" });
    expect(next[0].cameraAngle).toBeUndefined();
    // untouched page keeps identity
    expect(next[1]).toBe(pages[1]);
  });

  it("sets cameraAngle only", () => {
    const pages = makePages();
    const next = withShotTag(pages, "p1", { cameraAngle: "high" });
    expect(next[0]).toMatchObject({ cameraAngle: "high" });
    expect(next[0].shotType).toBeUndefined();
  });

  it("sets both fields in one patch", () => {
    const pages = makePages();
    const next = withShotTag(pages, "p1", { shotType: "ws", cameraAngle: "pov" });
    expect(next[0]).toMatchObject({ shotType: "ws", cameraAngle: "pov" });
  });

  it("removes an existing field via null", () => {
    const pages = makePages();
    const next = withShotTag(pages, "p2", { shotType: null });
    expect(next[1]).not.toHaveProperty("shotType");
    expect(next[1]).toMatchObject({ cameraAngle: "low" });
  });

  it("removes an existing field via empty string", () => {
    const pages = makePages();
    const next = withShotTag(pages, "p2", { cameraAngle: "" });
    expect(next[1]).not.toHaveProperty("cameraAngle");
    expect(next[1]).toMatchObject({ shotType: "cu" });
  });

  it("treats an unknown catalog id as removal", () => {
    const pages = makePages();
    const next = withShotTag(pages, "p2", { shotType: "not-a-real-id" });
    expect(next[1]).not.toHaveProperty("shotType");
  });

  it("returns the same array reference when the page id is not found", () => {
    const pages = makePages();
    const next = withShotTag(pages, "missing", { shotType: "cu" });
    expect(next).toBe(pages);
  });

  it("returns the same array reference on a true no-op (same value re-applied)", () => {
    const pages = makePages();
    const next = withShotTag(pages, "p2", { shotType: "cu", cameraAngle: "low" });
    expect(next).toBe(pages);
  });

  it("returns the same array reference when clearing an already-absent field", () => {
    const pages = makePages();
    const next = withShotTag(pages, "p1", { shotType: null, cameraAngle: null });
    expect(next).toBe(pages);
  });

  it("leaves fields not present in the patch untouched (partial patch)", () => {
    const pages = makePages();
    const next = withShotTag(pages, "p2", { shotType: "ews" });
    expect(next[1]).toMatchObject({ shotType: "ews", cameraAngle: "low" });
  });

  it("only replaces the target page object, preserving other keys via spread", () => {
    const pages = makePages();
    const next = withShotTag(pages, "p1", { shotType: "cu" });
    expect(next[0].id).toBe("p1");
    expect(next[0].elements).toBe(pages[0].elements);
  });

  it("returns the same array reference for an empty patch object", () => {
    const pages = makePages();
    const next = withShotTag(pages, "p2", {});
    expect(next).toBe(pages);
  });

  it("returns the same (empty) array reference when pages is empty", () => {
    const pages: Page[] = [];
    const next = withShotTag(pages, "p1", { shotType: "cu" });
    expect(next).toBe(pages);
    expect(next).toHaveLength(0);
  });
});

describe("shotTagBadgeText / shotTagBadgeTitle", () => {
  it("returns null when neither field is set", () => {
    expect(shotTagBadgeText({})).toBeNull();
    expect(shotTagBadgeTitle(null)).toBeNull();
    expect(shotTagBadgeText(undefined)).toBeNull();
  });

  it("joins abbr with a middle dot when both set", () => {
    expect(shotTagBadgeText({ shotType: "cu", cameraAngle: "low" })).toBe("CU · 로우");
    expect(shotTagBadgeTitle({ shotType: "cu", cameraAngle: "low" })).toBe("클로즈업 · 로우 앵글");
  });

  it("shows only the set half when the other is missing or invalid", () => {
    expect(shotTagBadgeText({ shotType: "ws" })).toBe("WS");
    expect(shotTagBadgeText({ cameraAngle: "pov", shotType: "bogus" })).toBe("POV");
  });
});
