import { describe, expect, it } from "vitest";

import { studioLiveTransformPreviewBlockedForElement } from "./studio-live-transform-preview-eligibility";
import { STUDIO_WEB_DRAWING_ALL_BRUSH_IDS } from "./studio-web-drawing-stroke-bridge";

import type { El } from "./studio-element-model";

function draw(overrides: Record<string, unknown> = {}): El {
  return {
    id: "draw-1",
    type: "draw",
    points: [0, 0, 10, 10],
    stroke: "#101010",
    strokeWidth: 4,
    // "pen" is causal-ink, one of the audited exact-draft-safe engines, so the base fixture
    // exercises the allowed path and each test below varies exactly one thing.
    brush: "pen",
    // A stored sampleSpacing is required for the preview: legacy strokes without one are
    // reprocessed against a fixed 3px distance that does not scale.
    sampleSpacing: 2,
    ...overrides,
  } as unknown as El;
}

describe("studioLiveTransformPreviewBlockedForElement", () => {
  it("allows an ordinary freehand stroke", () => {
    expect(studioLiveTransformPreviewBlockedForElement(draw(), false)).toBe(false);
  });

  it("refuses bound-derived shapes, whose commit rebuilds them axis-aligned", () => {
    // StudioDrawNode reconstructs rect/ellipse/star/triangle/polygon from drawBounds(points), so a
    // rotation shown in the preview is discarded and the commit lands an unrotated shape sized to
    // the rotated points' bounding box.
    expect(studioLiveTransformPreviewBlockedForElement(draw(), true)).toBe(true);
  });

  it("refuses symmetry strokes, whose copies regenerate about world axes", () => {
    expect(
      studioLiveTransformPreviewBlockedForElement(
        draw({ symmetry: { type: "vertical", centerX: 0, centerY: 0 } }),
        false,
      ),
    ).toBe(true);
    // "none" is not symmetry and must keep its preview.
    expect(
      studioLiveTransformPreviewBlockedForElement(
        draw({ symmetry: { type: "none", centerX: 0, centerY: 0 } }),
        false,
      ),
    ).toBe(false);
  });

  it("stands down when the catalogue id disagrees with a safe runtime id", () => {
    // The two are stored independently and often disagree -- pack presets persist
    // runtimeBrushId: "dry-media" beside an unrelated catalogue name -- so a catalogue id
    // resolving to an unsafe engine wins over a runtime id that looks fine.
    expect(
      studioLiveTransformPreviewBlockedForElement(
        draw({ brush: "pen", brushCatalogId: "dry-media" }),
        false,
      ),
    ).toBe(true);
    // A catalogue id that resolves to nothing is not a disqualification on its own; plenty of
    // pack presets carry a display name here.
    expect(
      studioLiveTransformPreviewBlockedForElement(
        draw({ brush: "pen", brushCatalogId: "정밀 펜" }),
        false,
      ),
    ).toBe(false);
  });


  it("keeps render-time eligibility O(1) and defers orientation samples to gesture admission", () => {
    // This helper runs for every DrawEl in every Stage React render. Even non-zero calligraphy
    // arrays are deliberately not scanned here; the gesture adapter scans only after a 256-sample
    // O(1) preflight. Zero-filled browser/CRDT channels remain eligible there as well.
    expect(studioLiveTransformPreviewBlockedForElement(
      draw({ brush: "calligraphy", tiltXs: [0], tiltYs: [0], twists: [0] }),
      false,
    )).toBe(false);
    expect(studioLiveTransformPreviewBlockedForElement(
      draw({ brush: "calligraphy", twists: [30] }),
      false,
    )).toBe(false);
    expect(studioLiveTransformPreviewBlockedForElement(
      draw({ brush: "calligraphy", tiltXs: [20], tiltYs: [Number.NaN] }),
      false,
    )).toBe(false);
    expect(studioLiveTransformPreviewBlockedForElement(
      draw({
        brush: "calligraphy",
        brushTip: { tiltEnabled: false, angleDeg: -30, roundness: 0.35 },
        tiltXs: [20],
        tiltYs: [10],
        twists: [30],
      }),
      false,
    )).toBe(false);
    // Mouse-authored causal/perfect strokes persist the same zero channels, but those renderers
    // never read them; they remain eligible for affine/exact capability routing.
    expect(studioLiveTransformPreviewBlockedForElement(
      draw({ brush: "pen", tiltXs: [0], tiltYs: [0], twists: [0] }),
      false,
    )).toBe(false);
    expect(studioLiveTransformPreviewBlockedForElement(
      draw({ brush: "gpen", tiltXs: [0], tiltYs: [0], twists: [0] }),
      false,
    )).toBe(false);
    // Empty channels are not stylus data and must not cost an ordinary stroke its preview.
    expect(
      studioLiveTransformPreviewBlockedForElement(
        draw({ tiltXs: [], tiltYs: [], twists: [] }),
        false,
      ),
    ).toBe(false);
  });







  it("refuses sketch-styled lines and arrows, whose Rough.js wobble is replanned", () => {
    // buildStudioRoughShapeRenderPlan derives its perturbations from the points it is handed, so
    // the commit's replan wobbles differently from the previewed path even with the seed,
    // roughness and bowing untouched.
    expect(
      studioLiveTransformPreviewBlockedForElement(
        draw({ kind: "line", sketch: { enabled: true, roughness: 1.2, bowing: 1 } }),
        false,
      ),
    ).toBe(true);
    expect(
      studioLiveTransformPreviewBlockedForElement(
        draw({ kind: "arrow", sketch: { enabled: true } }),
        false,
      ),
    ).toBe(true);
    // A disabled sketch style renders through the clean primitive branch and keeps its preview.
    expect(
      studioLiveTransformPreviewBlockedForElement(
        draw({ kind: "line", sketch: { enabled: false, roughness: 1.2 } }),
        false,
      ),
    ).toBe(false);
    // StudioDrawNode never builds a sketch plan for freehand strokes, so a stray style on one
    // must not cost it the preview.
    expect(
      studioLiveTransformPreviewBlockedForElement(draw({ sketch: { enabled: true } }), false),
    ).toBe(false);
  });

  it("allows only the audited exact-draft-safe engines", () => {
    // pen/g-pen are causal-ink and calligraphy is calligraphy-segments -- each checked against its
    // planner for world constants, index-derived noise and document-grid snapping.
    // `brush`/`flat-brush` are angled-ribbon: one quadrilateral per segment about a world-fixed
    // -30deg nib, planned by a pure function with no seed, clock or coordinate hash, and painted
    // source-over through a scratch surface that is cleared per mark rather than cached per element.
    for (const brush of ["pen", "calligraphy", "brush", "flat-brush"]) {
      expect(studioLiveTransformPreviewBlockedForElement(draw({ brush }), false), brush).toBe(false);
    }
  });

  it("refuses subtractive strokes, which an isolated draft Layer cannot show at all", () => {
    // `destination-out` on the lifted, initially empty draft Layer removes nothing, while hiding
    // the authoritative source restores the erased region: the hole fills in for the whole drag
    // and snaps back open at release. Both the explicit eraser mode and an erase-operation brush
    // reach that composite, and both take `causal-ink` -- an audited engine -- so the check has to
    // precede the allowlist rather than live inside it.
    expect(
      studioLiveTransformPreviewBlockedForElement(draw({ mode: "eraser" }), false),
    ).toBe(true);
    for (const brush of ["standard-eraser", "kneaded-eraser"]) {
      expect(
        studioLiveTransformPreviewBlockedForElement(draw({ brush }), false),
        brush,
      ).toBe(true);
    }
    // A paint-operation brush on the same engine is untouched.
    expect(studioLiveTransformPreviewBlockedForElement(draw({ brush: "pen" }), false)).toBe(false);
  });

  it("refuses blended strokes, which composite against the document rather than themselves", () => {
    // Most blended strokes are already caught by the cached-ancestor check, because the document
    // layer flattens them through a self-caching BlendIsolationGroup. `destination-out` is the
    // exception that wrapper deliberately leaves uncached, and it is the one that subtracts.
    for (const blendMode of ["destination-out", "multiply", "screen", "overlay"]) {
      expect(
        studioLiveTransformPreviewBlockedForElement(draw({ blendMode }), false),
        blendMode,
      ).toBe(true);
    }
    // Both spellings of "no blend" keep their preview.
    for (const blendMode of ["source-over", "normal", undefined]) {
      expect(
        studioLiveTransformPreviewBlockedForElement(draw({ blendMode }), false),
        String(blendMode),
      ).toBe(false);
    }
  });

  it("refuses every renderer that has not been audited, which is what makes this fail closed", () => {
    // Six review rounds each found one more resampling renderer the old denylist had missed, and
    // every miss shipped a visible snap. Inverted, an unlisted engine simply keeps commit-at-
    // release. These are the ones review confirmed, plus the families found along the way.
    const unsafe = [
      "watercolor", "ink-wash", "gouache", "inkwash-bleed-wash",
      "dry-media", "crayon", "chalk", "charcoal", "pastel", "oil-pastel",
      "screentone", "crosshatch", "glitter", "star-dust", "sparkle-star",
      "pencil", "pencil-2b", "soft-pencil", "colored-pencil",
      "oil-paint", "klecks-stamp",
    ];
    for (const brush of unsafe) {
      expect(studioLiveTransformPreviewBlockedForElement(draw({ brush }), false), brush).toBe(true);
    }
    // The whole web drawing kit union, world-parameterized by construction.
    for (const brush of STUDIO_WEB_DRAWING_ALL_BRUSH_IDS) {
      expect(studioLiveTransformPreviewBlockedForElement(draw({ brush }), false), brush).toBe(true);
    }
  });

  it("refuses anything with no runtime contract at all", () => {
    // The shape the denylist could never catch: a persisted render mode that is not an engine
    // (pixel-grid-v1 floors cells onto the document grid), an unknown id, a preset from a pack
    // this build does not know, or no brush recorded at all.
    for (const brush of ["pixel-grid-v1", "some-future-brush", ""]) {
      expect(studioLiveTransformPreviewBlockedForElement(draw({ brush }), false), brush).toBe(true);
    }
    expect(
      studioLiveTransformPreviewBlockedForElement(draw({ brush: undefined }), false),
    ).toBe(true);
  });

  it("still refuses a safe engine when an O(1) element property disqualifies it", () => {
    // The allowlist is the last word on the renderer; it does not override the element checks.
    expect(studioLiveTransformPreviewBlockedForElement(draw({ brush: "pen" }), true)).toBe(true);
  });

  it("refuses legacy strokes that carry no sampleSpacing", () => {
    // resolveStudioFreehandRenderPath reprocesses those points against a FIXED 3px legacy
    // distance, so enlarging a densely sampled stroke keeps points the source render discarded
    // and the committed centerline is not the previewed one scaled. A stored sampleSpacing scales
    // with the transform, which is what makes the two resamplings agree.
    expect(
      studioLiveTransformPreviewBlockedForElement(draw({ sampleSpacing: undefined }), false),
    ).toBe(true);
  });

  it("no longer previews capsule outlines or highlighters, whose clamps it cannot model", () => {
    // The croquis capsule reruns a pulled-string follower against a persisted length clamped to
    // 1-512px; the highlighter wash picks its subdivision count from an absolute 0.1-0.55px
    // flattening tolerance and derives rim detail from the resulting section indices. Neither
    // reduces to a threshold the route check can compare before and after.
    for (const brush of ["highlighter", "croquis-capsule"]) {
      expect(studioLiveTransformPreviewBlockedForElement(draw({ brush }), false), brush).toBe(true);
    }
  });

  it("ignores non-draw elements entirely", () => {
    // Coordinate elements carry their transform in the document, so this guard has no say on them.
    expect(
      studioLiveTransformPreviewBlockedForElement({ id: "i", type: "image" } as unknown as El, true),
    ).toBe(false);
  });
});
