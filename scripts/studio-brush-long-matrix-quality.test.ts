import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { studioBrushPresetUsesIntentionalDiscreteCarrier } from "../apps/web/src/domains/creator/brush/studio-brush-carrier-quality";
import { STUDIO_ALL_BRUSH_CATALOG_ITEMS } from "../apps/web/src/domains/creator/brush/studio-brush-catalog";
import { studioBrushPackDescriptorById } from "../apps/web/src/domains/creator/brush/studio-brush-pack-index";
import { classifyStudioDryMediaCatalogIdV1 } from "../apps/web/src/domains/creator/brush/studio-dry-media-anisotropic-grain-v1";
import { studioWetInkBrushDepositsPigment } from "../apps/web/src/domains/creator/brush/studio-wet-ink-brush-runtime";

import {
  analyzeStudioLongBrushQuality,
  classifyStudioLongBrushQualityPolicy,
  STUDIO_LONG_BRUSH_QUALITY_REPORT_SCHEMA_VERSION,
  type StudioLongBrushQualityPolicy,
} from "./studio-brush-long-matrix-quality";

const WIDTH = 168;
const HEIGHT = 88;
const ROUTE = {
  points: Array.from({ length: 121 }, (_, index) => ({
    x: 24 + index,
    y: HEIGHT / 2,
  })),
  crossSectionRadius: 20,
  cursorIgnoreRadius: 12,
  nominalWidth: 10,
} as const;

function image(
  painter?: (x: number, y: number) => number,
) {
  const data = new Uint8Array(WIDTH * HEIGHT * 3);
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const value = 255 - (painter?.(x, y) ?? 0);
      const offset = (y * WIDTH + x) * 3;
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
    }
  }
  return { width: WIDTH, height: HEIGHT, channels: 3, data };
}

const baseline = image();
const strictPolicy: StudioLongBrushQualityPolicy = {
  kind: "strict-continuous",
  reason: "test",
};

function stroke(centerY = HEIGHT / 2, periodic = false) {
  return image((x, y) => {
    if (x < 24 || x > 144) return 0;
    const radius = periodic && x % 12 < 5 ? 10 : 5;
    return Math.abs(y - centerY) <= radius ? 150 : 0;
  });
}

describe("Studio exhaustive long-brush quality policy", () => {
  it("classifies dry/ink as strict, wet/soft as bounded, and authored stamps as record-only", () => {
    expect(classifyStudioLongBrushQualityPolicy({
      id: "g-pen-flex",
      source: "pro",
      runtimeBrushId: "ink-particle",
      mediaGroup: "line",
      previewStyle: "calligraphy",
      intentionalDiscrete: false,
    }).kind).toBe("strict-continuous");
    expect(classifyStudioLongBrushQualityPolicy({
      id: "watercolor-wet-wash",
      source: "pro",
      runtimeBrushId: "airbrush",
      mediaGroup: "paint",
      previewStyle: "soft",
      intentionalDiscrete: false,
    }).kind).toBe("soft-wet-continuous");
    expect(classifyStudioLongBrushQualityPolicy({
      id: "splatter",
      source: "core",
      runtimeBrushId: "splatter",
      mediaGroup: "line",
      previewStyle: "dots",
      intentionalDiscrete: false,
    }).kind).toBe("record-only-discrete");
  });

  it("records the authored dash-stitch motif without exempting ordinary line pens", () => {
    const shared = {
      source: "core" as const,
      runtimeBrushId: "web-dash-stitch",
      mediaGroup: "line" as const,
      previewStyle: "dots",
      intentionalDiscrete: false,
    };

    expect(classifyStudioLongBrushQualityPolicy({
      ...shared,
      id: "web-dash-stitch",
    }).kind).toBe("record-only-discrete");
    expect(classifyStudioLongBrushQualityPolicy({
      ...shared,
      id: "ordinary-line-pen",
      runtimeBrushId: "ink-particle",
      previewStyle: "line",
    }).kind).toBe("strict-continuous");
  });

  it("assigns every shipped brush exactly one policy without hiding continuous dry media", () => {
    const policies = STUDIO_ALL_BRUSH_CATALOG_ITEMS.map((item) => {
      const descriptor = studioBrushPackDescriptorById(item.id);
      const dryMediaClassification = classifyStudioDryMediaCatalogIdV1(item.id);
      return {
        source: item.source,
        kind: classifyStudioLongBrushQualityPolicy({
          id: item.id,
          source: item.source,
          runtimeBrushId: descriptor?.runtimeBrushId ?? item.id,
          mediaGroup: item.mediaGroup,
          previewStyle: item.previewStyle,
          intentionalDiscrete: dryMediaClassification
            ? dryMediaClassification.kind === "intentional-discrete"
            : descriptor
              ? studioBrushPresetUsesIntentionalDiscreteCarrier(descriptor)
              : false,
          depositsPigment: studioWetInkBrushDepositsPigment(descriptor?.runtimeBrushId ?? item.id),
        }).kind,
      };
    });
    expect(policies).toHaveLength(STUDIO_ALL_BRUSH_CATALOG_ITEMS.length);
    const strict = policies.filter(({ kind }) => kind === "strict-continuous");
    const soft = policies.filter(({ kind }) => kind === "soft-wet-continuous");
    const discrete = policies.filter(({ kind }) => kind === "record-only-discrete");
    const transparent = policies.filter(({ kind }) => kind === "record-only-transparent");
    // Catalogue growth (sketchpad + web competitive/coloring) lands mainly in
    // strict-continuous; soft/wet and discrete pro packs stay stable.
    expect(strict.length).toBeGreaterThanOrEqual(119);
    expect(soft.length).toBeGreaterThanOrEqual(36);
    expect(discrete.length).toBeGreaterThanOrEqual(76);
    // Only the water-only wash deposits no pigment.
    expect(transparent).toHaveLength(1);
    expect(strict.length + soft.length + discrete.length + transparent.length).toBe(policies.length);
    expect(policies.filter(({ source }) => source === "core")).toHaveLength(
      STUDIO_ALL_BRUSH_CATALOG_ITEMS.filter(({ source }) => source === "core").length,
    );
    expect(policies.filter(({ source }) => source === "pro")).toHaveLength(160);
  });

  it("accepts a stable continuous carrier and reports exact transition metrics", () => {
    const stable = stroke();
    const result = analyzeStudioLongBrushQuality({
      policy: strictPolicy,
      baseline,
      live: stable,
      released: stable,
      settled: stable,
      route: ROUTE,
    });

    expect(result.ok).toBe(true);
    expect(result.transitions.liveToSettled).toMatchObject({
      energyRatio: 1,
      rawChangedPixels: 0,
      rawChangedPixelRatio: 0,
      maxChannelDelta: 0,
      changedPixels: 0,
      perPixelDifferenceRatio: 0,
      shapeDifferenceRatio: 0,
      boundsDriftPx: 0,
      centroidDriftPx: 0,
      centerlineDriftPx: 0,
    });
  });

  it("uses schema v3 and treats a zero cursor radius as no endpoint exclusion", () => {
    expect(STUDIO_LONG_BRUSH_QUALITY_REPORT_SCHEMA_VERSION).toBe(3);
    const stable = stroke();
    const endpointChanged = image((x, y) => {
      if (x < 24 || x > 144 || Math.abs(y - HEIGHT / 2) > 5) return 0;
      return x === 144 && y === HEIGHT / 2 ? 240 : 150;
    });
    const withoutCursorMask = analyzeStudioLongBrushQuality({
      policy: strictPolicy,
      baseline,
      live: stable,
      released: endpointChanged,
      settled: endpointChanged,
      route: {
        ...ROUTE,
        cursorIgnoreRadius: 0,
      },
    });
    const withExplicitCursorMask = analyzeStudioLongBrushQuality({
      policy: strictPolicy,
      baseline,
      live: stable,
      released: endpointChanged,
      settled: endpointChanged,
      route: {
        ...ROUTE,
        cursorIgnoreRadius: 2,
      },
    });

    expect(withoutCursorMask.transitions.liveToReleased).toMatchObject({
      rawChangedPixels: 1,
      maxChannelDelta: 90,
      changedPixels: 1,
      ignoredCursorRadius: 0,
    });
    expect(withExplicitCursorMask.transitions.liveToReleased).toMatchObject({
      rawChangedPixels: 0,
      maxChannelDelta: 0,
      changedPixels: 0,
      ignoredCursorRadius: 2,
    });
  });

  it("records exact one-code-value live/commit changes below the perceptual threshold", () => {
    const stable = stroke();
    const quantized = {
      ...stable,
      data: Uint8Array.from(stable.data),
    };
    const pixelOffset = ((HEIGHT / 2) * WIDTH + 84) * quantized.channels;
    quantized.data[pixelOffset] = Math.min(
      255,
      (quantized.data[pixelOffset] ?? 0) + 1,
    );

    const result = analyzeStudioLongBrushQuality({
      policy: strictPolicy,
      baseline,
      live: stable,
      released: quantized,
      settled: quantized,
      route: ROUTE,
    });

    expect(result.transitions.liveToReleased).toMatchObject({
      rawChangedPixels: 1,
      maxChannelDelta: 1,
      changedPixels: 0,
    });
    expect(result.transitions.releasedToSettled).toMatchObject({
      rawChangedPixels: 0,
      maxChannelDelta: 0,
      changedPixels: 0,
    });
  });

  it("installs cursor-free Studio settings before navigation while preserving four frames", () => {
    const verifierSource = readFileSync(
      new URL("./verify-studio-brushes.mts", import.meta.url),
      "utf8",
    );
    const initStart = verifierSource.indexOf("async function installCleanStudioState");
    const cursorPreference = verifierSource.indexOf(
      'brushCursorStyle: "none"',
      initStart,
    );
    const studioNavigation = verifierSource.indexOf("await page.goto(", initStart);

    expect(initStart).toBeGreaterThanOrEqual(0);
    expect(cursorPreference).toBeGreaterThan(initStart);
    expect(studioNavigation).toBeGreaterThan(cursorPreference);
    expect(verifierSource).toContain(
      "studioAppSettingsKey: STUDIO_APP_SETTINGS_STORAGE_KEY",
    );
    expect(verifierSource).toContain('"00-baseline"');
    expect(verifierSource).toContain('"01-live-pointer-down"');
    expect(verifierSource).toContain('"02-released-immediate"');
    expect(verifierSource).toContain('"03-settled-autosaved"');
    expect(verifierSource).toContain("const cursorIgnoreRadius = 0;");
  });

  it("fails a committed carrier that jumps away from its live centerline", () => {
    const result = analyzeStudioLongBrushQuality({
      policy: strictPolicy,
      baseline,
      live: stroke(),
      released: stroke(),
      settled: stroke(HEIGHT / 2 + 12),
      route: ROUTE,
    });

    expect(result.ok).toBe(false);
    expect(result.findings.map((entry) => entry.code)).toEqual(expect.arrayContaining([
      "bounds-drift",
      "centroid-drift",
      "centerline-drift",
    ]));
  });

  it("fails an immediate pointer-up jump even when the settled frame later returns", () => {
    const stable = stroke();
    const result = analyzeStudioLongBrushQuality({
      policy: strictPolicy,
      baseline,
      live: stable,
      released: stroke(HEIGHT / 2 + 12),
      settled: stable,
      route: ROUTE,
    });

    expect(result.ok).toBe(false);
    expect(result.transitions.liveToSettled.centerlineDriftPx).toBe(0);
    expect(result.transitions.liveToReleased.centerlineDriftPx).toBeGreaterThan(10);
    expect(result.findings.map((entry) => entry.code)).toContain("centerline-drift");
  });

  it("fails a large live-only circular start deposit while ignoring only the end cursor", () => {
    const settled = stroke();
    const liveWithStartCircle = image((x, y) => {
      const strokeDelta = (
        x >= 24
        && x <= 144
        && Math.abs(y - HEIGHT / 2) <= 5
      ) ? 150 : 0;
      const startCircleDelta = Math.hypot(x - 24, y - HEIGHT / 2) <= 18
        ? 150
        : 0;
      return Math.max(strokeDelta, startCircleDelta);
    });
    const result = analyzeStudioLongBrushQuality({
      policy: strictPolicy,
      baseline,
      live: liveWithStartCircle,
      released: settled,
      settled,
      route: ROUTE,
    });

    expect(result.ok).toBe(false);
    expect(result.transitions.liveToReleased.liveOnlyStartPixels).toBeGreaterThan(12);
    expect(result.findings.map((entry) => entry.code)).toContain("live-only-start-circle");
  });

  it("allows bounded soft/wet edge growth without allowing centerline or bounds jumps", () => {
    const softStroke = (radius: number) => image((x, y) => (
      x >= 24
      && x <= 144
      && Math.abs(y - HEIGHT / 2) <= radius
        ? 96
        : 0
    ));
    const result = analyzeStudioLongBrushQuality({
      policy: {
        kind: "soft-wet-continuous",
        reason: "test wet edge",
      },
      baseline,
      live: softStroke(5),
      released: softStroke(6),
      settled: softStroke(7),
      route: ROUTE,
    });

    expect(result.ok).toBe(true);
    expect(result.transitions.liveToSettled.edgeDensityDelta).toBeGreaterThan(0);
    expect(result.transitions.liveToSettled.centerlineDriftPx).toBe(0);
  });

  it("detects the periodic bulb silhouette produced by spaced circular dabs", () => {
    const periodic = stroke(HEIGHT / 2, true);
    const result = analyzeStudioLongBrushQuality({
      policy: strictPolicy,
      baseline,
      live: periodic,
      released: periodic,
      settled: periodic,
      route: ROUTE,
    });

    expect(result.ok).toBe(false);
    expect(result.frames.settled.edgePeriodicityScore).toBeGreaterThan(0.46);
    expect(result.findings.map((entry) => entry.code)).toContain("edge-periodicity");
  });

  it("does not mistake subpixel edge rasterization for a visible repeated carrier", () => {
    const shallowRasterCycle = image((x, y) => {
      if (x < 24 || x > 144) return 0;
      const edgeNudge = x % 14 === 0 ? 1 : 0;
      return Math.abs(y - HEIGHT / 2) <= 12 + edgeNudge ? 150 : 0;
    });
    const result = analyzeStudioLongBrushQuality({
      policy: strictPolicy,
      baseline,
      live: shallowRasterCycle,
      released: shallowRasterCycle,
      settled: shallowRasterCycle,
      route: ROUTE,
    });

    expect(result.frames.settled.edgePeriodicityScore).toBeGreaterThan(0);
    expect(result.frames.settled.scallopResidualCoefficient).toBeLessThan(0.025);
    expect(result.findings.map((entry) => entry.code)).not.toContain("edge-periodicity");
    expect(result.ok).toBe(true);
  });

  it("records a transparent wash and fails only when ink survives pointer-up", () => {
    const policy = classifyStudioLongBrushQualityPolicy({
      id: "inkwash-water-brush",
      source: "core",
      runtimeBrushId: "inkwash-water-brush",
      mediaGroup: "watercolor",
      previewStyle: "soft",
      intentionalDiscrete: false,
      depositsPigment: false,
    });
    expect(policy.kind).toBe("record-only-transparent");

    const blank = image();
    const wetHint = image((x, y) => (Math.abs(y - HEIGHT / 2) <= 10 && x >= 20 && x <= 200 ? 230 : 255));
    const clean = analyzeStudioLongBrushQuality({
      policy,
      baseline,
      live: wetHint,
      released: blank,
      settled: blank,
      route: ROUTE,
    });
    expect(clean.ok).toBe(true);
    expect(clean.findings).toEqual([]);

    const residue = analyzeStudioLongBrushQuality({
      policy,
      baseline,
      live: wetHint,
      released: wetHint,
      settled: wetHint,
      route: ROUTE,
    });
    expect(residue.ok).toBe(false);
    expect(residue.findings.map((entry) => entry.code)).toEqual([
      "transparent-wash-residue",
      "transparent-wash-residue",
    ]);
  });

  it("records intentional particles without turning continuous-carrier metrics into hard failures", () => {
    const blank = image();
    const result = analyzeStudioLongBrushQuality({
      policy: {
        kind: "record-only-discrete",
        reason: "test stamp",
      },
      baseline,
      live: blank,
      released: blank,
      settled: blank,
      route: ROUTE,
    });

    expect(result.ok).toBe(true);
    expect(result.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ level: "warning", code: "missing-live-ink" }),
      expect.objectContaining({ level: "warning", code: "missing-settled-ink" }),
    ]));
  });
});
