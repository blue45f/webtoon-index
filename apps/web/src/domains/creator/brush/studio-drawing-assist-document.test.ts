import { describe, expect, it } from "vitest";

import {
  STUDIO_DRAWING_ASSIST_MAX_COORDINATE,
  STUDIO_DRAWING_ASSIST_MAX_SERIALIZED_BYTES,
  areStudioDrawingAssistDocumentsEqual,
  createDefaultStudioDrawingAssistDocument,
  mirrorStudioDrawingAssistDocument,
  normalizeStudioDrawingAssistDocument,
  parseStudioDrawingAssistDocument,
  resolveStudioDrawingAssistPreviewDocument,
  studioDrawingAssistHasContent,
} from "./studio-drawing-assist-document";

const viewport = { canvasWidth: 800, canvasHeight: 1_200 };

describe("studio drawing-assist document", () => {
  it("creates a page-centered, inactive v2 document with an empty advanced-ruler collection", () => {
    expect(createDefaultStudioDrawingAssistDocument(viewport)).toEqual({
      version: 2,
      perspective: { active: false, points: [], eyeLevelY: null, lockHorizon: false },
      isometric: {
        active: false,
        angleDeg: 30,
        cellSize: 40,
        originX: 400,
        originY: 600,
      },
      advanced: {
        version: 1,
        rulers: [],
        activeSnapRulerId: null,
        selectedRulerId: null,
      },
    });
  });

  it("normalizes legacy/malformed values and gives perspective the single snap owner", () => {
    expect(normalizeStudioDrawingAssistDocument({
      perspective: {
        active: true,
        points: [
          { id: "vp-a", x: 10, y: 20 },
          { id: "vp-a", x: 30, y: 40 },
          { id: "broken", x: Number.NaN, y: 1 },
          { id: "vp-b", x: STUDIO_DRAWING_ASSIST_MAX_COORDINATE * 2, y: -30 },
        ],
      },
      isometric: {
        active: true,
        angleDeg: 500,
        cellSize: 1,
        originX: Number.POSITIVE_INFINITY,
        originY: -STUDIO_DRAWING_ASSIST_MAX_COORDINATE * 2,
      },
    }, viewport)).toEqual({
      version: 2,
      perspective: {
        active: true,
        points: [
          { id: "vp-a", x: 10, y: 20 },
          { id: "vp-b", x: STUDIO_DRAWING_ASSIST_MAX_COORDINATE, y: -30 },
        ],
        eyeLevelY: null,
        lockHorizon: false,
      },
      isometric: {
        active: false,
        angleDeg: 89,
        cellSize: 8,
        originX: 400,
        originY: -STUDIO_DRAWING_ASSIST_MAX_COORDINATE,
      },
      advanced: {
        version: 1,
        rulers: [],
        activeSnapRulerId: null,
        selectedRulerId: null,
      },
    });

    expect(normalizeStudioDrawingAssistDocument({
      version: 3,
      perspective: { active: true, points: [{ id: "future", x: 1, y: 2 }] },
    }, viewport)).toEqual(createDefaultStudioDrawingAssistDocument(viewport));
  });

  it("gives one active advanced ruler precedence and rejects ambiguous strict v2 state", () => {
    const document = createDefaultStudioDrawingAssistDocument(viewport);
    document.perspective.active = true;
    document.isometric.active = true;
    document.advanced.rulers.push({
      id: "curve-a",
      type: "curve",
      name: "곡선자",
      enabled: true,
      visible: true,
      scope: { kind: "page", groupId: null },
      snapMode: "on-curve",
      fixedOffset: 0,
      p0: { x: 0, y: 0 },
      p1: { x: 10, y: 0 },
      p2: { x: 20, y: 10 },
      p3: { x: 30, y: 10 },
    });
    document.advanced.activeSnapRulerId = "curve-a";

    const normalized = normalizeStudioDrawingAssistDocument(document, viewport);
    expect(normalized.advanced.activeSnapRulerId).toBe("curve-a");
    expect(normalized.perspective.active).toBe(false);
    expect(normalized.isometric.active).toBe(false);
    expect(parseStudioDrawingAssistDocument(document)).toBeNull();
    expect(parseStudioDrawingAssistDocument(normalized)).toEqual(normalized);
  });

  it("trims tolerant current data to the combined 8 KiB document budget", () => {
    const input = createDefaultStudioDrawingAssistDocument(viewport);
    input.perspective.points = Array.from({ length: 3 }, (_, index) => ({
      id: `${"가".repeat(159)}${index}`,
      x: index,
      y: index,
    }));
    input.advanced.rulers = Array.from({ length: 12 }, (_, index) => ({
      id: `curve-${index}-${"x".repeat(140)}`,
      type: "curve" as const,
      name: "곡".repeat(80),
      enabled: true,
      visible: true,
      scope: { kind: "page" as const, groupId: null },
      snapMode: "on-curve" as const,
      fixedOffset: 0,
      p0: { x: 0, y: index },
      p1: { x: 100, y: index + 20 },
      p2: { x: 200, y: index + 20 },
      p3: { x: 300, y: index },
    }));

    const normalized = normalizeStudioDrawingAssistDocument(input, viewport);
    expect(new TextEncoder().encode(JSON.stringify(normalized)).byteLength)
      .toBeLessThanOrEqual(STUDIO_DRAWING_ASSIST_MAX_SERIALIZED_BYTES);
    expect(normalized.advanced.rulers.length).toBeLessThan(input.advanced.rulers.length);
    expect(parseStudioDrawingAssistDocument(normalized)).toEqual(normalized);
  });

  it("strictly accepts canonical documents and rejects ambiguous or unsafe shared data", () => {
    const document = {
      ...createDefaultStudioDrawingAssistDocument(viewport),
      perspective: {
        active: true,
        points: [{ id: "vp-a", x: 100, y: 200 }],
        eyeLevelY: 200,
        lockHorizon: true,
      },
    };
    expect(parseStudioDrawingAssistDocument(document)).toEqual(document);
    // Legacy active+points envelopes still parse and gain default eye-level fields.
    expect(parseStudioDrawingAssistDocument({
      ...document,
      perspective: { active: true, points: [{ id: "vp-a", x: 100, y: 200 }] },
    })).toEqual({
      ...document,
      perspective: {
        active: true,
        points: [{ id: "vp-a", x: 100, y: 200 }],
        eyeLevelY: null,
        lockHorizon: false,
      },
    });
    expect(parseStudioDrawingAssistDocument({
      ...document,
      isometric: { ...document.isometric, active: true },
    })).toBeNull();
    expect(parseStudioDrawingAssistDocument({
      ...document,
      perspective: {
        active: true,
        points: [{ id: "vp-a", x: Infinity, y: 0 }],
        eyeLevelY: null,
        lockHorizon: false,
      },
    })).toBeNull();
    expect(parseStudioDrawingAssistDocument({ ...document, version: 3 })).toBeNull();
  });

  it("strictly migrates the exact v1 shape to v2 without changing authored guide values", () => {
    const legacy = {
      version: 1,
      perspective: { active: true, points: [{ id: "vp-a", x: -125, y: 240 }] },
      isometric: {
        active: false,
        angleDeg: 45,
        cellSize: 72,
        originX: 321,
        originY: 654,
      },
    };
    expect(parseStudioDrawingAssistDocument(legacy)).toEqual({
      version: 2,
      perspective: {
        active: true,
        points: [{ id: "vp-a", x: -125, y: 240 }],
        eyeLevelY: null,
        lockHorizon: false,
      },
      isometric: legacy.isometric,
      advanced: {
        version: 1,
        rulers: [],
        activeSnapRulerId: null,
        selectedRulerId: null,
      },
    });
    expect(parseStudioDrawingAssistDocument({ ...legacy, future: true })).toBeNull();
  });

  it("normalizes a matching legacy or partial transient preview before the editor reads it", () => {
    const source = createDefaultStudioDrawingAssistDocument(viewport);
    source.isometric.active = true;
    source.isometric.originX = 321;
    source.advanced.selectedRulerId = null;

    const resolved = resolveStudioDrawingAssistPreviewDocument({
      preview: {
        pageId: "page-a",
        source,
        document: {
          version: 2,
          perspective: {
            active: true,
            points: [{ id: "vp-preview", x: 120, y: 240 }],
          },
          // Simulates a stale preview created before isometric/advanced fields were complete.
        },
      },
      pageId: "page-a",
      source,
      fallback: source,
      viewport,
    });

    expect(resolved).toEqual({
      ...source,
      perspective: {
        active: true,
        points: [{ id: "vp-preview", x: 120, y: 240 }],
        eyeLevelY: null,
        lockHorizon: false,
      },
      isometric: { ...source.isometric, active: false },
    });
    expect(resolved.isometric.originX).toBe(321);
    expect(resolved.advanced).toEqual(source.advanced);

    const legacyResolved = resolveStudioDrawingAssistPreviewDocument({
      preview: {
        pageId: "page-a",
        source,
        document: {
          version: 1,
          perspective: { active: false, points: [] },
          isometric: {
            active: true,
            angleDeg: 45,
            cellSize: 72,
            originX: 111,
            originY: 222,
          },
        },
      },
      pageId: "page-a",
      source,
      fallback: source,
      viewport,
    });
    expect(legacyResolved.version).toBe(2);
    expect(legacyResolved.isometric).toEqual({
      active: true,
      angleDeg: 45,
      cellSize: 72,
      originX: 111,
      originY: 222,
    });
    expect(legacyResolved.advanced.rulers).toEqual([]);
  });

  it("ignores stale, absent, and unsupported-future previews", () => {
    const fallback = createDefaultStudioDrawingAssistDocument(viewport);
    const source = { persisted: true };
    const baseOptions = {
      pageId: "page-a",
      source,
      fallback,
      viewport,
    };

    expect(resolveStudioDrawingAssistPreviewDocument({
      ...baseOptions,
      preview: {
        pageId: "page-b",
        source,
        document: { perspective: { active: true } },
      },
    })).toBe(fallback);
    expect(resolveStudioDrawingAssistPreviewDocument({
      ...baseOptions,
      preview: { pageId: "page-a", source, document: undefined },
    })).toBe(fallback);
    expect(resolveStudioDrawingAssistPreviewDocument({
      ...baseOptions,
      preview: { pageId: "page-a", source, document: { version: 999 } },
    })).toBe(fallback);
  });

  it("rejects unknown keys, clamped coordinates, duplicate ids, and excess points", () => {
    const document = createDefaultStudioDrawingAssistDocument(viewport);
    expect(parseStudioDrawingAssistDocument({ ...document, future: true })).toBeNull();
    expect(parseStudioDrawingAssistDocument({
      ...document,
      perspective: { ...document.perspective, future: true },
    })).toBeNull();
    expect(parseStudioDrawingAssistDocument({
      ...document,
      perspective: {
        active: true,
        points: [{
          id: "vp-a",
          x: STUDIO_DRAWING_ASSIST_MAX_COORDINATE + 1,
          y: 0,
        }],
      },
    })).toBeNull();
    expect(parseStudioDrawingAssistDocument({
      ...document,
      perspective: {
        active: true,
        points: [
          { id: "vp-a", x: 0, y: 0 },
          { id: "vp-a", x: 1, y: 1 },
        ],
      },
    })).toBeNull();
    expect(parseStudioDrawingAssistDocument({
      ...document,
      perspective: {
        active: true,
        points: Array.from({ length: 4 }, (_, index) => ({
          id: `vp-${index}`,
          x: index,
          y: index,
        })),
      },
    })).toBeNull();
  });

  it("rejects accessor-backed objects without invoking the accessor", () => {
    const document = createDefaultStudioDrawingAssistDocument(viewport);
    let getterCalls = 0;
    const hostile = {
      version: 1,
      isometric: document.isometric,
      get perspective() {
        getterCalls += 1;
        return document.perspective;
      },
    };
    expect(parseStudioDrawingAssistDocument(hostile)).toBeNull();
    expect(getterCalls).toBe(0);
  });

  it("recognizes authored guide-only content and mirrors horizontal coordinates", () => {
    const empty = createDefaultStudioDrawingAssistDocument(viewport);
    expect(studioDrawingAssistHasContent(undefined, viewport)).toBe(false);
    expect(studioDrawingAssistHasContent(empty, viewport)).toBe(false);

    const authored = {
      ...empty,
      perspective: {
        active: false,
        points: [{ id: "vp-a", x: 100, y: 250 }],
        eyeLevelY: 250,
        lockHorizon: true,
      },
      isometric: { ...empty.isometric, originX: 300 },
    };
    expect(studioDrawingAssistHasContent(authored, viewport)).toBe(true);
    expect(mirrorStudioDrawingAssistDocument(authored, 800)).toEqual({
      ...authored,
      perspective: {
        active: false,
        points: [{ id: "vp-a", x: 700, y: 250 }],
        eyeLevelY: 250,
        lockHorizon: true,
      },
      isometric: { ...authored.isometric, originX: 500 },
      advanced: authored.advanced,
    });
  });

  it("compares every persisted field without relying on object identity", () => {
    const left = createDefaultStudioDrawingAssistDocument(viewport);
    const same = structuredClone(left);
    expect(areStudioDrawingAssistDocumentsEqual(left, same)).toBe(true);
    same.isometric.originX += 1;
    expect(areStudioDrawingAssistDocumentsEqual(left, same)).toBe(false);
    const advancedChanged = structuredClone(left);
    advancedChanged.advanced.rulers.push({
      id: "curve-a",
      type: "curve",
      name: "곡선자",
      enabled: true,
      visible: true,
      scope: { kind: "page", groupId: null },
      snapMode: "on-curve",
      fixedOffset: 0,
      p0: { x: 0, y: 0 },
      p1: { x: 10, y: 0 },
      p2: { x: 20, y: 10 },
      p3: { x: 30, y: 10 },
    });
    expect(areStudioDrawingAssistDocumentsEqual(left, advancedChanged)).toBe(false);
  });
});
