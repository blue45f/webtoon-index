import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  STUDIO_CVD_GRAYSCALE_SATURATION,
  STUDIO_CVD_MATRIX,
} from "../studio-color-vision-model";
import {
  STUDIO_TOOL_HINT_PREVIEW_KINDS,
  studioToolHintPreviewSpecFromRuntime,
} from "../studio-tool-hint-preview-kind";

import {
  StudioToolHintPreview,
  type StudioToolHintPreviewProps,
} from "./StudioToolHintPreview";

const PREVIEW_KINDS = STUDIO_TOOL_HINT_PREVIEW_KINDS;

function visualSignature(
  kind: (typeof PREVIEW_KINDS)[number],
  variant?: string
): string {
  const previewSpec = studioToolHintPreviewSpecFromRuntime(kind, variant);
  return renderToStaticMarkup(
    <StudioToolHintPreview {...previewSpec} reducedMotion />
  )
    .replace(/\sdata-(?:studio-tool-hint-preview|preview-kind|preview-variant|preview-operation)="[^"]*"/gu, "")
    .replace(/studio-tool-preview-[^"#)]+/gu, "studio-tool-preview-id");
}

function animatedVisualSignature(
  kind: (typeof PREVIEW_KINDS)[number],
  variant?: string
): string {
  const previewSpec = studioToolHintPreviewSpecFromRuntime(kind, variant);
  return renderToStaticMarkup(
    <StudioToolHintPreview {...previewSpec} reducedMotion={false} />
  )
    .replace(/\sdata-(?:studio-tool-hint-preview|preview-kind|preview-variant|preview-operation)="[^"]*"/gu, "")
    .replace(/studio-tool-preview-[^"#)]+/gu, "studio-tool-preview-id");
}

function semanticVisualSignature(
  kind: (typeof PREVIEW_KINDS)[number],
  variant: string,
  animated = false
): string {
  return (animated
    ? animatedVisualSignature(kind, variant)
    : visualSignature(kind, variant)
  ).replace(/\sdata-[\w:-]+="[^"]*"/gu, "");
}

describe("StudioToolHintPreview", () => {
  it("rejects a variant from another preview family at the renderer boundary", () => {
    const compileTimeInvalidRendererProps = (): void => {
      // @ts-expect-error pause belongs to playback previews, not direct shapes.
      const invalidProps: StudioToolHintPreviewProps = {
        kind: "shape",
        variant: "pause",
      };
      expect(invalidProps).toBeUndefined();
    };

    expect(compileTimeInvalidRendererProps).toBeTypeOf("function");
  });

  it.each(PREVIEW_KINDS)("renders the %s micro-demo with stable integration hooks", (kind) => {
    const previewSpec = studioToolHintPreviewSpecFromRuntime(kind);
    const html = renderToStaticMarkup(
      <StudioToolHintPreview {...previewSpec} reducedMotion />
    );

    expect(html).toContain(`data-studio-tool-hint-preview="${kind}"`);
    expect(html).toContain(`data-preview-kind="${kind}"`);
    expect(html).toContain('data-motion="reduced"');
    expect(html).toContain('viewBox="0 0 216 104"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain("<animate");
  });

  it.each(PREVIEW_KINDS)("animates the %s demonstration when motion is allowed", (kind) => {
    const previewSpec = studioToolHintPreviewSpecFromRuntime(kind);
    const html = renderToStaticMarkup(
      <StudioToolHintPreview {...previewSpec} reducedMotion={false} />
    );

    expect(html).toContain('data-motion="animated"');
    expect(html).toContain("<animate");
  });

  it("keeps every default preview kind visually distinct", () => {
    const signatures = PREVIEW_KINDS.map((kind) => visualSignature(kind));

    expect(new Set(signatures).size).toBe(PREVIEW_KINDS.length);
  });

  it("gives formerly over-shared actions different visual signatures", () => {
    const actionKinds = [
      "pan",
      "transform",
      "crop",
      "comment",
      "perspective",
      "smudge",
      "liquify",
      "reference",
      "rotate-view",
      "frame-capture",
      "frame-playback",
      "frame-duplicate",
      "frame-delete",
    ] as const;
    const signatures = actionKinds.map((kind) => visualSignature(kind));

    expect(new Set(signatures).size).toBe(actionKinds.length);
  });

  it("keeps direct shape drawing visually distinct from smart-shape correction", () => {
    expect(visualSignature("shape")).not.toBe(visualSignature("smart-shape"));
  });

  it("gives every color action its own reduced-motion and animated demonstration", () => {
    const variants = [
      "brush-shape",
      "bubble-fill",
      "recent-swatch",
      "palette-family",
      "palette-swatch",
      "primary-color",
      "secondary-color",
      "swap-colors",
    ] as const;
    const reducedSignatures = variants.map((variant) =>
      visualSignature("color-palette", variant)
    );
    const animatedSignatures = variants.map((variant) =>
      animatedVisualSignature("color-palette", variant)
    );

    expect(new Set(reducedSignatures).size).toBe(variants.length);
    expect(new Set(animatedSignatures).size).toBe(variants.length);

    for (const variant of variants) {
      const html = renderToStaticMarkup(
        <StudioToolHintPreview kind="color-palette" variant={variant} reducedMotion />
      );
      expect(html).toContain(`data-preview-operation="${variant}"`);
    }
  });

  it("renders every authored palette as its own swatch-specific coach", () => {
    const variants = [
      "palette-skin-natural",
      "palette-hair-natural",
      "palette-hair-vivid",
      "palette-sky-hours",
      "palette-nature-green",
      "palette-pastel-mood",
      "palette-neon-cyber",
      "palette-vintage-sepia",
      "palette-mono-ink",
      "palette-romance-pink",
      "palette-autumn-fall",
      "palette-dark-fantasy",
    ] as const;

    expect(
      new Set(variants.map((variant) => semanticVisualSignature("color-palette", variant))).size
    ).toBe(variants.length);
    expect(
      new Set(variants.map((variant) => semanticVisualSignature("color-palette", variant, true))).size
    ).toBe(variants.length);

    for (const variant of variants) {
      const html = renderToStaticMarkup(
        <StudioToolHintPreview kind="color-palette" variant={variant} reducedMotion />
      );
      expect(html).toContain(`data-preview-operation="${variant}"`);
    }
  });

  it.each([
    ["bubble", ["add", "open-library", "fit-text"]],
    ["view-hud", ["zoom-open", "zoom-close", "rotate-open", "rotate-close"]],
    ["layer-visibility", ["show", "hide", "batch-show", "batch-hide"]],
    ["layer-lock", ["lock", "unlock", "batch-lock", "batch-unlock"]],
    ["object-ground", ["ground", "origin-ground"]],
    ["object-snap", ["enable", "disable"]],
    ["camera-zoom", ["zoom-in", "zoom-out", "focus-selection"]],
    ["camera-orbit", ["start", "stop"]],
    ["quad-view", ["open", "close"]],
    ["line-art", ["enable", "disable"]],
  ] as const)(
    "keeps canonical %s actions semantically distinct without data hooks",
    (kind, variants) => {
      expect(
        new Set(variants.map((variant) => semanticVisualSignature(kind, variant))).size
      ).toBe(variants.length);
      expect(
        new Set(variants.map((variant) => semanticVisualSignature(kind, variant, true))).size
      ).toBe(variants.length);
    }
  );

  it.each([
    ["layer-visibility", ["show", "hide", "batch-show", "batch-hide"]],
    ["layer-lock", ["lock", "unlock", "batch-lock", "batch-unlock"]],
    ["layer-merge", ["merge-selected", "flatten-visible"]],
    ["camera-zoom", ["zoom-in", "zoom-out", "focus-selection"]],
    ["frame-reorder", ["frame-reorder-previous", "frame-reorder-next"]],
    ["onion-skin", ["frame-onion-skin", "frame-onion-prev-count", "frame-onion-next-count", "frame-onion-opacity", "frame-onion-tint"]],
    ["stabilizer", ["stabilizer-standard", "stabilizer-adaptive", "stabilizer-precision", "post-correction"]],
    ["pressure", ["pressure-soft", "pressure-linear", "pressure-firm"]],
    ["symmetry", ["symmetry-none", "symmetry-vertical", "symmetry-horizontal", "symmetry-radial", "symmetry-kaleidoscope"]],
    ["shape", ["shape-picker-line", "shape-picker-rect", "shape-picker-ellipse", "shape-picker-star", "shape-picker-arrow", "shape-picker-triangle", "shape-picker-polygon"]],
    ["selection-boundary", ["select-all", "clear", "invert", "remove-last-subpath", "expand", "contract"]],
    ["selection-history", ["undo", "redo"]],
    ["selection-marquee-transform", ["rotate-custom", "rotate-cw-90", "rotate-ccw-90", "rotate-180", "flip-x", "flip-y", "translate-left", "translate-right", "translate-up", "translate-down", "scale-up", "scale-down"]],
    ["selection-content-transform", ["apply-scale-rotate", "rotate-cw-90", "flip-x", "flip-y", "delete", "content-aware-fill"]],
    ["selection-adjust", ["brightness", "hue"]],
    ["selection-layout", ["group", "align-left", "align-hcenter", "align-right", "align-top", "align-vcenter", "align-bottom", "distribute-horizontal", "distribute-vertical"]],
    ["panel-layout", ["add", "split-diagonal", "diagonalize", "straighten"]],
    ["zoom-view", ["zoom-out", "zoom-in", "actual-size", "fit-width", "reset"]],
    ["rotate-view", ["rotate-left", "rotate-right"]],
    ["color-vision", ["original", "grayscale", "protanopia", "deuteranopia", "tritanopia"]],
    ["timeline", ["play", "pause"]],
    ["frame-playback", ["play", "pause"]],
    ["fullscreen", ["maximize-window", "restore-window", "fullscreen", "exit-fullscreen", "canvas-only"]],
    ["workspace-focus", ["focus", "restore"]],
    ["brush-favorite", ["add", "remove"]],
    ["shape-fill", ["enable", "disable"]],
    ["draw-settings", ["expand", "collapse"]],
    ["flip-view", ["flip", "restore"]],
    ["smart-shape", ["enable", "disable"]],
    ["bubble", ["add", "open-library", "fit-text"]],
    ["view-hud", ["zoom-open", "zoom-close", "rotate-open", "rotate-close"]],
    ["object-snap", ["enable", "disable"]],
    ["camera-orbit", ["start", "stop"]],
    ["quad-view", ["open", "close"]],
    ["line-art", ["enable", "disable"]],
    ["brush-size", ["preset-xs", "preset-s", "preset-m", "preset-l", "preset-xl", "preset-xxl", "lock", "unlock"]],
    ["opacity", ["preset-20", "preset-40", "preset-60", "preset-80", "preset-100", "lock", "unlock"]],
  ] as const)("specializes the %s family by stable action identity", (kind, variants) => {
    const signatures = variants.map((variant) => visualSignature(kind, variant));
    expect(new Set(signatures).size).toBe(variants.length);
  });

  it.each([
    ["color-palette", ["primary-color", "secondary-color", "swap-colors"]],
    ["brush-size", ["preset-xs", "preset-s", "preset-m", "preset-l", "preset-xl", "preset-xxl", "lock", "unlock"]],
    ["opacity", ["preset-20", "preset-40", "preset-60", "preset-80", "preset-100", "lock", "unlock"]],
    ["selection-layout", ["group", "align-left", "align-hcenter", "align-right", "align-top", "align-vcenter", "align-bottom", "distribute-horizontal", "distribute-vertical"]],
    ["zoom-view", ["zoom-out", "zoom-in", "actual-size", "fit-width", "reset"]],
    ["rotate-view", ["rotate-left", "rotate-right"]],
    ["color-vision", ["original", "grayscale", "protanopia", "deuteranopia", "tritanopia"]],
    ["timeline", ["play", "pause"]],
    ["frame-playback", ["play", "pause"]],
  ] as const)("keeps every exact %s state distinct with and without motion", (kind, variants) => {
    expect(new Set(variants.map((variant) => visualSignature(kind, variant))).size).toBe(
      variants.length
    );
    expect(
      new Set(variants.map((variant) => animatedVisualSignature(kind, variant))).size
    ).toBe(variants.length);
  });

  it.each([
    ["brush-favorite", ["add", "remove"]],
    ["shape-fill", ["enable", "disable"]],
    ["draw-settings", ["expand", "collapse"]],
    ["flip-view", ["flip", "restore"]],
    ["smart-shape", ["enable", "disable"]],
    ["fullscreen", ["fullscreen", "exit-fullscreen"]],
    ["workspace-focus", ["focus", "restore"]],
  ] as const)("animates opposite %s actions with different directions", (kind, variants) => {
    const signatures = variants.map((variant) => animatedVisualSignature(kind, variant));
    expect(new Set(signatures).size).toBe(variants.length);
  });

  it("scales the canvas and its contents uniformly in opposite zoom directions", () => {
    const zoomIn = animatedVisualSignature("zoom-view", "zoom-in");
    const zoomOut = animatedVisualSignature("zoom-view", "zoom-out");

    expect(zoomIn).toContain('type="scale" dur="2.8s" values=".75;1;1;.75"');
    expect(zoomOut).toContain('type="scale" dur="2.8s" values="1;.75;.75;1"');
  });

  it("fits a portrait canvas to width with one uniform clipped scale", () => {
    const fitWidth = animatedVisualSignature("zoom-view", "fit-width");

    expect(fitWidth).toContain('clip-path="url(#studio-tool-preview-id)"');
    expect(fitWidth).toContain('type="translate" dur="2.8s" values="83 19.5;43 -32.5;43 -32.5;83 19.5"');
    expect(fitWidth).toContain('type="scale" dur="2.8s" values="1;2.6;2.6;1"');
  });

  it("canonicalizes the legacy zoom-fit runtime ID before it reaches the renderer", () => {
    const authoredVariant = visualSignature("zoom-view", "fit-width");
    const stableActionId = visualSignature("zoom-view", "zoom-fit");
    const runtimeSpec = studioToolHintPreviewSpecFromRuntime("zoom-view", "zoom-fit");

    expect(stableActionId).toBe(authoredVariant);
    expect(runtimeSpec).toEqual({ kind: "zoom-view", variant: "fit-width" });
    expect(
      renderToStaticMarkup(
        <StudioToolHintPreview {...runtimeSpec} reducedMotion />
      )
    ).toContain('data-preview-operation="fit-width"');
  });

  it("uses the exact live-canvas color-vision matrices in every CVD coach", () => {
    const original = visualSignature("color-vision", "original");
    const grayscale = visualSignature("color-vision", "grayscale");

    expect(original).toContain(
      `<feColorMatrix type="saturate" values="${STUDIO_CVD_GRAYSCALE_SATURATION}"`
    );
    expect(original.match(/filter="url\(/gu)).toHaveLength(1);
    expect(original).toContain(">ORIGINAL</text>");
    expect(grayscale).toContain(
      `<feColorMatrix type="saturate" values="${STUDIO_CVD_GRAYSCALE_SATURATION}"`
    );
    for (const mode of ["protanopia", "deuteranopia", "tritanopia"] as const) {
      expect(visualSignature("color-vision", mode)).toContain(
        `values="${STUDIO_CVD_MATRIX[mode]}"`
      );
    }
  });

  it.each([
    ["shape-picker-rect", "M58 30 158 76"],
    ["shape-picker-ellipse", "M58 26 158 80"],
    ["shape-picker-star", "M74 20 142 79"],
    ["shape-picker-arrow", "M54 29 163 77"],
    ["shape-picker-triangle", "M54 21 162 79"],
    ["shape-picker-polygon", "M64 20 162 84"],
  ] as const)("demonstrates %s as the editor's bounding-box drag gesture", (variant, path) => {
    const html = animatedVisualSignature("shape", variant);

    expect(html).toContain(`path="${path}"`);
    expect(html).toContain('values=".04 .04;1 1;1 1;.04 .04"');
  });

  it.each([
    ["shape-rect", "rect"],
    ["shape-ellipse", "ellipse"],
  ] as const)("uses the direct %s action ID as the %s bounding-box coach", (actionId, variant) => {
    expect(visualSignature("shape", actionId)).toBe(
      visualSignature("shape", variant)
    );
  });

  it("keeps arrow drawing unfilled because the editor disables arrow fill", () => {
    const html = renderToStaticMarkup(
      <StudioToolHintPreview kind="shape" variant="shape-picker-arrow" reducedMotion />
    );

    expect(html).toMatch(/data-preview-operation="shape-arrow"[^>]*fill="none"/u);
  });

  it("keeps selection scale and scale-rotate animation centered on the selection", () => {
    const marqueeScale = animatedVisualSignature("selection-marquee-transform", "scale-up");
    const contentTransform = animatedVisualSignature("selection-content-transform", "apply-scale-rotate");

    expect(marqueeScale).toContain('transform="translate(108 53)"');
    expect(marqueeScale).toContain('transform="translate(-108 -53)"');
    expect(contentTransform).toContain('values="1;1.18;1.18;1"');
    expect(contentTransform).toContain('values="0;12;12;0"');
    expect(contentTransform).toContain('transform="translate(-108 -53)"');
  });

  it("keeps high-value toolbelt workflows visually distinct", () => {
    const workflowKinds = [
      "panel-layout",
      "character-3d",
      "background-library",
      "style-library",
      "storyboard-grid",
      "review-workflow",
      "team-collaboration",
      "continuity-check",
      "vertical-preview",
      "workspace-focus",
    ] as const;
    const signatures = workflowKinds.map((kind) => visualSignature(kind));

    expect(new Set(signatures).size).toBe(workflowKinds.length);
  });

  it("shows object snapping at a grid intersection", () => {
    const html = renderToStaticMarkup(
      <StudioToolHintPreview kind="object-snap" variant="enable" reducedMotion />
    );

    expect(html).toContain('data-preview-kind="object-snap"');
    expect(html).toContain('data-preview-operation="object-snap-enable"');
    expect(html).toContain('data-motion="reduced"');
  });

  it.each([
    ["object-translate", "translate", 'type="translate" dur="2.7s" values="0 0;18 -9;18 -9;0 0"'],
    ["object-rotate", "rotate", 'type="rotate" dur="2.7s" values="0;28;28;0"'],
    ["object-scale", "scale", 'type="scale" dur="2.7s" values=".86;1.18;1.18;.86"'],
    ["object-ground", "ground", 'type="translate" dur="2.7s" values="0 -18;0 0;0 0;0 -18"'],
  ] as const)("moves the 3D object itself for %s", (kind, transform, motion) => {
    const html = animatedVisualSignature(kind, kind === "object-ground" ? "ground" : undefined);

    expect(html).toContain('data-preview-object="ghost"');
    expect(html).toContain('data-preview-object="live"');
    expect(html).toContain(`data-preview-object-transform="${transform}"`);
    expect(html).toContain(motion);
  });

  it("moves the full 3D origin gizmo onto a revealed ground plane", () => {
    const html = animatedVisualSignature("object-ground", "origin-ground");

    expect(html).toContain('data-preview-ground-plane="live"');
    expect(html).toContain('data-preview-object-origin="ghost"');
    expect(html).toContain('data-preview-object-origin="live"');
    expect(html).toContain('data-preview-origin-guide="ground"');
    expect(html).toContain("M108 48v26M95 61h26M99 70l18-18");
    expect(html).toContain('values="0 0;0 30;0 30;0 0"');
  });

  it.each([
    ["zoom-in", ".76;1.28;1.28;.76"],
    ["zoom-out", "1.25;.72;.72;1.25"],
    ["focus-selection", ".76;1.32;1.32;.76"],
  ] as const)("transforms the 3D camera scene for %s", (variant, scaleValues) => {
    const html = animatedVisualSignature("camera-zoom", variant);

    expect(html).toContain('data-preview-camera-scene="ghost"');
    expect(html).toContain('data-preview-camera-scene="live"');
    expect(html).toContain(`data-preview-camera-transform="${variant}"`);
    expect(html).toContain(`type="scale" dur="2.7s" values="${scaleValues}"`);
  });

  it("orbits a camera body around the 3D subject instead of a generic marker", () => {
    const html = renderToStaticMarkup(
      <StudioToolHintPreview kind="camera-orbit" variant="start" reducedMotion={false} />
    );

    expect(html).toContain('data-preview-operation="camera-orbit-start"');
    expect(html).toContain('data-preview-camera="orbiting"');
    expect(html).toContain('<animateMotion dur="2.8s" path="M43 52a65 32 0 1 0 130 0 65 32 0 1 0-130 0" rotate="auto"');
    expect(html).toContain('<rect x="-11" y="-8" width="22" height="16" rx="4"');
  });

  it("morphs one camera viewport into four labeled orthographic panes", () => {
    const html = renderToStaticMarkup(
      <StudioToolHintPreview kind="quad-view" variant="open" reducedMotion={false} />
    );

    expect(html).toContain('data-preview-operation="quad-view-open"');
    expect(html).toContain('data-preview-camera-layout="single-to-quad"');
    expect(html).toContain('data-preview-camera-layout="quad"');
    expect(html.match(/data-preview-quad-pane=/gu)).toHaveLength(4);
    expect(html).toContain('attributeName="width" dur="2.8s" values="144;56;56;144"');
    expect(html).toContain('attributeName="height" dur="2.8s" values="78;31;31;78"');
  });

  it("keeps the edit workflow distinct from file, insert, draw, and history flows", () => {
    const workflowKinds = [
      "edit-workflow",
      "file-workflow",
      "insert-content",
      "draw-workflow",
      "history",
    ] as const;
    const signatures = workflowKinds.map((kind) => visualSignature(kind));

    expect(new Set(signatures).size).toBe(workflowKinds.length);
  });

  it("canonicalizes a legacy slash-namespaced layer alias before rendering", () => {
    const runtimeSpec = studioToolHintPreviewSpecFromRuntime(
      "layer-lock",
      "plugin/layer/unlock-layer"
    );
    const html = renderToStaticMarkup(
      <StudioToolHintPreview {...runtimeSpec} reducedMotion />
    );

    expect(runtimeSpec).toEqual({ kind: "layer-lock", variant: "unlock" });
    expect(html).toContain('data-preview-operation="unlock"');
    expect(html).toContain("M-7-2v-7a7 7 0 0 1 12-5v7");
  });

  it("renders filter engines as distinct controls instead of one generic wipe", () => {
    const variants = [
      "filter-curves",
      "filter-gradient-map",
      "filter-channel-mixer",
      "filter-invert",
    ] as const;
    const signatures = variants.map((variant) => visualSignature("filter", variant));

    expect(new Set(signatures).size).toBe(variants.length);
  });

  it("normalizes and exposes the preview variant without leaking it as an SVG prop", () => {
    const html = renderToStaticMarkup(
      <StudioToolHintPreview
        kind="camera-zoom"
        variant="vrm:camera:zoom-out"
        reducedMotion
      />
    );

    expect(html).toContain('data-preview-variant="vrm:camera:zoom-out"');
    expect(html).not.toContain(' variant="');
  });

  it("is decorative by default and can become a named image", () => {
    const decorative = renderToStaticMarkup(
      <StudioToolHintPreview kind="ink" reducedMotion />
    );
    const named = renderToStaticMarkup(
      <StudioToolHintPreview
        kind="ink"
        reducedMotion
        aria-label="브러시 획 미리보기"
      />
    );

    expect(decorative).toContain('aria-hidden="true"');
    expect(decorative).not.toContain('role="img"');
    expect(named).toContain('aria-label="브러시 획 미리보기"');
    expect(named).toContain('role="img"');
    expect(named).not.toContain("aria-hidden");
  });

  it("creates collision-free clip and ledger identifiers for sibling previews", () => {
    const html = renderToStaticMarkup(
      <div>
        <StudioToolHintPreview kind="text" reducedMotion />
        <StudioToolHintPreview kind="filter" reducedMotion />
      </div>
    );

    const identifiers = [...html.matchAll(/id="([^"]+(?:ledger|clip))"/g)].map(
      (match) => match[1]
    );

    expect(identifiers.length).toBe(4);
    expect(new Set(identifiers).size).toBe(identifiers.length);
    for (const identifier of identifiers) {
      expect(html).toContain(`url(#${identifier})`);
    }
  });

  it("creates collision-free checker patterns for sibling opacity previews", () => {
    const html = renderToStaticMarkup(
      <div>
        <StudioToolHintPreview kind="opacity" reducedMotion />
        <StudioToolHintPreview kind="opacity" reducedMotion />
      </div>
    );

    const identifiers = [...html.matchAll(/id="([^"]+-opacity-checker)"/g)].map(
      (match) => match[1]
    );

    expect(identifiers).toHaveLength(2);
    expect(new Set(identifiers).size).toBe(2);
    for (const identifier of identifiers) {
      expect(html).toContain(`url(#${identifier})`);
    }
  });
});
