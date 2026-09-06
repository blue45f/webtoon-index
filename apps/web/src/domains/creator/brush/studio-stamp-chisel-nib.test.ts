/**
 * A flat nib must swell and thin with travel direction.
 *
 * `elliptical_dab_ratio` / `elliptical_dab_angle` were transcribed verbatim when the CC0 MyPaint
 * presets were imported but were NOT executed - the module's largest documented down-scope. The
 * consequence was measurable: CC0 calligraphy (ratio 5.46) and the fat marker (ratio 10.0) rendered
 * 0.186 apart on the normalised pixel audit, against a corpus median of 1.04. Flatness is exactly
 * what separates those two media, so dropping it collapsed them onto each other and onto every
 * other round ink nib.
 *
 * The bound below is not a magic constant: a nib's directional swing should equal its own declared
 * ratio, because the ribbon half-width is the ellipse support function and its extremes are the two
 * semi-axes. Measuring on a constant-speed circle isolates direction - `inkVelocityFactor` scales
 * radius with segment speed, so a stroke with varying segment length would confound the two.
 */
import { describe, expect, it } from "vitest";

import {
  planStudioStampBrushDabs,
  resolveStudioStampBrushKind,
  resolveStudioStampBrushStyle,
} from "./studio-brush-stamp-engine";
import { planStudioStampInkRibbon } from "./studio-stamp-ink-ribbon";

/** Every step the same length, so only the travel direction changes between segments. */
function constantSpeedCircle(): { points: number[]; pressures: number[] } {
  const points: number[] = [];
  const pressures: number[] = [];
  const samples = 72;
  for (let index = 0; index < samples; index += 1) {
    const angle = (index / samples) * Math.PI * 2;
    points.push(120 + Math.cos(angle) * 90, 120 + Math.sin(angle) * 90);
    pressures.push(0.7);
  }
  return { points, pressures };
}

function directionalSwing(brushId: string): {
  swing: number;
  chisel: boolean;
} {
  const kind = resolveStudioStampBrushKind(brushId);
  expect(kind, brushId).not.toBeNull();
  const style = resolveStudioStampBrushStyle(
    kind!,
    { color: "#333333", size: 20, opacity: 1 },
    null,
    brushId,
  );
  const { points, pressures } = constantSpeedCircle();
  const dabs = planStudioStampBrushDabs(style, points, pressures);
  const ribbon = planStudioStampInkRibbon(dabs);
  const halfWidths = ribbon.polygons
    .filter((polygon) => polygon.role === "body")
    .map((polygon) => {
      const p = polygon.points;
      return Math.hypot(p[0]! - p[6]!, p[1]! - p[7]!) / 2;
    });
  expect(halfWidths.length, brushId).toBeGreaterThan(8);
  return {
    swing: Math.max(...halfWidths) / Math.max(1e-6, Math.min(...halfWidths)),
    chisel: dabs.some((dab) => dab.radiusY !== undefined),
  };
}

describe("Studio stamp chisel nib", () => {
  it("swells and thins by each nib's own declared ratio", () => {
    // Upstream brushes/classic/calligraphy.myb declares elliptical_dab_ratio 5.46.
    const calligraphy = directionalSwing("mypaint-cc0--calligraphy");
    expect(calligraphy.chisel).toBe(true);
    expect(calligraphy.swing).toBeGreaterThan(5.46 * 0.9);
    expect(calligraphy.swing).toBeLessThan(5.46 * 1.1);

    // brushes/classic/marker_fat.myb declares 10.0 — a markedly flatter nib than the calligraphy.
    const marker = directionalSwing("mypaint-cc0--marker-fat");
    expect(marker.chisel).toBe(true);
    expect(marker.swing).toBeGreaterThan(10 * 0.9);
    expect(marker.swing).toBeLessThan(10 * 1.1);

    // The two media must stay distinguishable from each other, not merely both flat.
    expect(marker.swing).toBeGreaterThan(calligraphy.swing * 1.3);
  });

  it("leaves a round nib perfectly round", () => {
    // kabura declares no elliptical ratio, so it must keep the pre-chisel geometry exactly: no
    // radiusY on any dab, and a ribbon whose width does not depend on where the stroke is going.
    const kabura = directionalSwing("mypaint-cc0--kabura");
    expect(kabura.chisel).toBe(false);
    expect(kabura.swing).toBeLessThan(1.01);
  });
});
