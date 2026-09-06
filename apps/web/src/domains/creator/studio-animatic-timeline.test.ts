import { describe, expect, it } from "vitest";

import {
  addStudioAnimaticCue,
  createStudioAnimaticFromPages,
  exportStudioAnimaticDocument,
  importStudioAnimaticDocument,
  loadStudioAnimaticDocument,
  patchStudioAnimaticCue,
  planStudioAnimaticPreview,
  removeStudioAnimaticCue,
  sampleStudioAnimaticPreview,
  saveStudioAnimaticDocument,
  setStudioAnimaticCameraEndpoint,
  setStudioAnimaticFps,
  setStudioAnimaticLoop,
  setStudioAnimaticPreviewMode,
  setStudioAnimaticSegmentTiming,
  STUDIO_ANIMATIC_KIND,
  STUDIO_ANIMATIC_MAX_CAMERA_KEYFRAMES,
  STUDIO_ANIMATIC_MAX_IMPORT_BYTES,
  STUDIO_ANIMATIC_MAX_SEGMENTS,
  STUDIO_ANIMATIC_MAX_TOTAL_DURATION_MS,
  STUDIO_ANIMATIC_VERSION,
  studioAnimaticStorageKey,
  validateStudioAnimaticDocument,
  type StudioAnimaticDocument,
  type StudioAnimaticPageLike,
  type StudioAnimaticStorage,
} from "./studio-animatic-timeline";

const PAGES: StudioAnimaticPageLike[] = [
  {
    id: "page-1",
    name: "오프닝",
    canvasH: 1_200,
    elements: [
      {
        id: "frame-bottom",
        type: "frame",
        x: 20,
        y: 600,
        width: 680,
        height: 500,
      },
      {
        id: "bubble-bottom",
        type: "bubble",
        x: 100,
        y: 700,
        width: 200,
        height: 100,
        text: "두 번째 대사",
        speaker: "유나",
      },
      {
        id: "frame-top",
        type: "frame",
        x: 20,
        y: 20,
        width: 680,
        height: 500,
      },
      {
        id: "sfx-top",
        type: "text",
        x: 100,
        y: 120,
        width: 180,
        height: 80,
        text: "쾅!",
        name: "효과음",
      },
    ],
  },
  {
    id: "page-2",
    name: "엔딩",
    canvasH: 900,
    elements: [
      {
        id: "bubble-page",
        type: "bubble",
        text: "마지막 대사",
        speaker: "민수",
      },
    ],
  },
];

function createDocument(): StudioAnimaticDocument {
  const created = createStudioAnimaticFromPages(PAGES, {
    workScope: "episode-01",
  });
  if (!created.ok) throw new Error(created.error);
  return created.document;
}

class MemoryStorage implements StudioAnimaticStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe("studio animatic page/cut projection", () => {
  it("projects frames in reading order and falls back to a page segment", () => {
    const document = createDocument();

    expect(document.segments).toHaveLength(3);
    expect(document.segments.map((segment) => segment.cutId)).toEqual([
      "frame-top",
      "frame-bottom",
      null,
    ]);
    expect(document.segments.map((segment) => segment.label)).toEqual([
      "오프닝 · 1컷",
      "오프닝 · 2컷",
      "엔딩",
    ]);
    expect(document.segments[0].transition).toEqual({
      kind: "cut",
      durationMs: 0,
    });
    expect(document.segments[1].transition).toEqual({
      kind: "fade",
      durationMs: 400,
    });
    expect(document.segments[0].cues).toMatchObject([
      { kind: "sfx", text: "쾅!" },
    ]);
    expect(document.segments[1].cues).toMatchObject([
      { kind: "dialogue", text: "두 번째 대사", speaker: "유나" },
    ]);
    expect(document.segments[2].sourceRect.stripY).toBe(1_200);
  });

  it("creates stable IDs and byte-identical JSON for the same page input", () => {
    const first = createDocument();
    const second = createDocument();
    const firstExport = exportStudioAnimaticDocument(first);
    const secondExport = exportStudioAnimaticDocument(second);

    expect(second).toEqual(first);
    expect(firstExport.ok).toBe(true);
    expect(secondExport.ok).toBe(true);
    if (!firstExport.ok || !secondExport.ok) return;
    expect(firstExport.json).toBe(secondExport.json);
    expect(firstExport.json).not.toMatch(/createdAt|updatedAt|Date/u);
  });
});

describe("studio animatic preview planning and sampling", () => {
  it("plans total hold+transition time and a bounded deterministic frame budget", () => {
    let document = createDocument();
    document = setStudioAnimaticFps(document, 24);
    const planned = planStudioAnimaticPreview(document);

    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(planned.plan.totalDurationMs).toBe(8_000);
    expect(planned.plan.frameCount).toBe(192);
    expect(planned.plan.segments.map((segment) => segment.startMs)).toEqual([
      0,
      2_400,
      5_200,
    ]);
    expect(planned.plan.remainingFrames).toBeGreaterThan(0);
  });

  it("samples transition, camera pan/zoom and continuous vertical scroll", () => {
    let document = createDocument();
    document = setStudioAnimaticPreviewMode(document, "vertical-scroll");
    const secondId = document.segments[1].id;
    document = setStudioAnimaticCameraEndpoint(document, secondId, "end", {
      panXPercent: 20,
      panYPercent: 10,
      zoom: 1.5,
    });
    const planned = planStudioAnimaticPreview(document);
    if (!planned.ok) throw new Error(planned.error);

    const sample = sampleStudioAnimaticPreview(
      document,
      planned.plan,
      3_800
    );
    expect(sample?.segmentIndex).toBe(1);
    expect(sample?.transitionKind).toBe("fade");
    expect(sample?.transitionProgress).toBe(1);
    expect(sample?.camera.zoom).toBeGreaterThan(1);
    expect(sample?.scrollY).toBeGreaterThan(
      planned.plan.segments[1].scrollStartY
    );
  });

  it("removes animated transition/camera/scroll interpolation for reduced motion", () => {
    let document = setStudioAnimaticPreviewMode(
      createDocument(),
      "vertical-scroll"
    );
    const secondId = document.segments[1].id;
    document = setStudioAnimaticCameraEndpoint(document, secondId, "end", {
      panYPercent: 40,
      zoom: 2,
    });
    const planned = planStudioAnimaticPreview(document, true);
    if (!planned.ok) throw new Error(planned.error);
    const sample = sampleStudioAnimaticPreview(
      document,
      planned.plan,
      3_800,
      true
    );

    expect(planned.plan.segments[1].transitionEndMs).toBe(
      planned.plan.segments[1].startMs
    );
    expect(sample).toMatchObject({
      transitionKind: "cut",
      transitionProgress: 1,
      reducedMotion: true,
      camera: { panXPercent: 0, panYPercent: 0, zoom: 1 },
    });
    expect(sample?.scrollY).toBe(planned.plan.segments[1].scrollStartY);
  });

  it("wraps only when loop is explicitly enabled", () => {
    let document = createDocument();
    const planned = planStudioAnimaticPreview(document);
    if (!planned.ok) throw new Error(planned.error);
    expect(
      sampleStudioAnimaticPreview(
        document,
        planned.plan,
        planned.plan.totalDurationMs + 100
      )?.segmentIndex
    ).toBe(2);

    document = setStudioAnimaticLoop(document, true);
    expect(
      sampleStudioAnimaticPreview(
        document,
        planned.plan,
        planned.plan.totalDurationMs + 100
      )?.segmentIndex
    ).toBe(0);
  });
});

describe("studio animatic editing and fail-closed budgets", () => {
  it("updates hold/transition, camera endpoints and silent cue metadata", () => {
    let document = createDocument();
    const segmentId = document.segments[0].id;
    document = setStudioAnimaticSegmentTiming(document, segmentId, {
      holdMs: 3_000,
      transitionKind: "pan",
      transitionDurationMs: 600,
    });
    document = setStudioAnimaticCameraEndpoint(document, segmentId, "end", {
      panXPercent: -25,
      zoom: 1.25,
    });
    document = addStudioAnimaticCue(document, segmentId, "dialogue");
    const newCue = document.segments[0].cues.find((cue) =>
      cue.id.startsWith("cue-dialogue")
    );
    if (!newCue) throw new Error("Expected new cue");
    document = patchStudioAnimaticCue(document, segmentId, newCue.id, {
      text: "타이밍 검수용 대사",
      speaker: "조연",
      offsetMs: 1_200,
    });

    expect(document.segments[0]).toMatchObject({
      holdMs: 3_000,
      transition: { kind: "pan", durationMs: 600 },
    });
    expect(document.segments[0].cameraKeyframes.at(-1)).toMatchObject({
      panXPercent: -25,
      zoom: 1.25,
    });
    expect(
      document.segments[0].cues.find((cue) => cue.id === newCue.id)
    ).toMatchObject({
      text: "타이밍 검수용 대사",
      speaker: "조연",
      offsetMs: 1_200,
    });

    document = removeStudioAnimaticCue(document, segmentId, newCue.id);
    expect(
      document.segments[0].cues.some((cue) => cue.id === newCue.id)
    ).toBe(false);
  });

  it("rejects excessive segment/keyframe counts and duration budgets", () => {
    const document = createDocument();
    const excessiveSegments = {
      ...document,
      segments: Array.from(
        { length: STUDIO_ANIMATIC_MAX_SEGMENTS + 1 },
        (_, index) => ({
          ...document.segments[0],
          id: `segment-${index}`,
        })
      ),
    };
    expect(validateStudioAnimaticDocument(excessiveSegments).ok).toBe(false);

    const excessiveKeys = {
      ...document,
      segments: [
        {
          ...document.segments[0],
          cameraKeyframes: Array.from(
            { length: STUDIO_ANIMATIC_MAX_CAMERA_KEYFRAMES + 1 },
            (_, index) => ({
              at: index / STUDIO_ANIMATIC_MAX_CAMERA_KEYFRAMES,
              panXPercent: 0,
              panYPercent: 0,
              zoom: 1,
              easing: "linear",
            })
          ),
        },
      ],
    };
    expect(validateStudioAnimaticDocument(excessiveKeys).ok).toBe(false);

    const excessiveDuration: StudioAnimaticDocument = {
      ...document,
      segments: Array.from({ length: 21 }, (_, index) => ({
        ...document.segments[0],
        id: `duration-${index}`,
        holdMs: 30_000,
      })),
    };
    expect(planStudioAnimaticPreview(excessiveDuration).ok).toBe(false);
    expect(
      STUDIO_ANIMATIC_MAX_TOTAL_DURATION_MS
    ).toBeLessThan(21 * 30_000);
  });
});

describe("studio animatic bounded interchange and local persistence", () => {
  it("round-trips deterministic JSON and rejects malformed or oversized imports", () => {
    const document = createDocument();
    const exported = exportStudioAnimaticDocument(document);
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    expect(JSON.parse(exported.json)).toMatchObject({
      kind: STUDIO_ANIMATIC_KIND,
      version: STUDIO_ANIMATIC_VERSION,
    });
    expect(importStudioAnimaticDocument(exported.json)).toEqual({
      ok: true,
      document,
    });
    expect(importStudioAnimaticDocument("{bad").ok).toBe(false);
    expect(
      importStudioAnimaticDocument(
        "x".repeat(STUDIO_ANIMATIC_MAX_IMPORT_BYTES + 1)
      ).ok
    ).toBe(false);
  });

  it("loads and saves by work scope without throwing on blocked storage", () => {
    const document = createDocument();
    const storage = new MemoryStorage();

    expect(saveStudioAnimaticDocument(storage, document).ok).toBe(true);
    expect(storage.values.has(studioAnimaticStorageKey("episode-01"))).toBe(
      true
    );
    expect(loadStudioAnimaticDocument(storage, "episode-01")).toEqual({
      status: "ok",
      document,
    });
    expect(loadStudioAnimaticDocument(storage, "episode-02").status).toBe(
      "empty"
    );

    const blocked: StudioAnimaticStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(loadStudioAnimaticDocument(blocked, "episode-01").status).toBe(
      "unavailable"
    );
    expect(saveStudioAnimaticDocument(blocked, document).ok).toBe(false);
    expect(loadStudioAnimaticDocument(null, "episode-01").status).toBe(
      "unavailable"
    );
  });
});
