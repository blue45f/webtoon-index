/**
 * Every brush that throws its touch-down dab off the pointer must carry the origin anchor.
 *
 * The anchor module's own criterion is a first dab landing "farther than one nib width" from where
 * the artist pressed, but it was wired to `splatter` alone. Nine other brushes measured the same
 * way, and the brush gate surfaced two of them intermittently as "fast short stroke produced no
 * visible pixels" - a flick short enough to be mostly dab zero, depositing its whole mark somewhere
 * else. This test re-derives the criterion from the planner rather than restating a list, so a new
 * brush authored with wide scatter fails here instead of silently shipping the same defect.
 */
import { describe, expect, it } from "vitest";

import {
  planStudioDynamicBrushDabs,
  studioBrushDynamicsSettingsForBrushId,
} from "./brush/studio-brush-dynamics";
import { materializeAllStudioBrushPackSelections } from "./brush/studio-brush-pack-runtime";
import { studioDynamicBrushUsesSplatterOriginAnchor } from "./studio-splatter-origin-anchor";

/** The gate's flick: short enough that dab zero dominates, fast enough to maximise scatter. */
const FLICK_POINTS = [100, 100, 118, 104, 136, 108];
const FLICK_PRESSURES = [0.5, 0.5, 0.5];

function firstDabOffsetInNibRadii(settings: unknown): number | null {
  const dabs = planStudioDynamicBrushDabs({
    points: FLICK_POINTS,
    pressures: FLICK_PRESSURES,
    speeds: [1, 1, 1],
    baseWidth: 24,
    baseOpacity: 1,
    settings,
    seed: 7,
  } as never);
  const first = dabs[0];
  if (!first) return null;
  const radius = first.size / 2;
  if (!(radius > 0)) return null;
  return Math.hypot(first.x - first.sourceX, first.y - first.sourceY) / radius;
}

describe("Studio origin anchor coverage", () => {
  it("anchors every brush whose touch-down dab lands over one nib radius away", () => {
    const offenders: string[] = [];
    const candidates: Array<{ id: string; settings: unknown }> = [];
    for (const selection of materializeAllStudioBrushPackSelections()) {
      const id = (selection as { catalogId?: string }).catalogId;
      const settings = (selection as { brushDynamics?: unknown }).brushDynamics;
      if (id && settings) candidates.push({ id, settings });
    }
    for (const id of ["splatter", "spray", "airbrush", "ink-particle"]) {
      const settings = studioBrushDynamicsSettingsForBrushId(id);
      if (settings) candidates.push({ id, settings });
    }
    expect(candidates.length).toBeGreaterThan(20);

    for (const { id, settings } of candidates) {
      const offset = firstDabOffsetInNibRadii(settings);
      if (offset === null || offset <= 1) continue;
      // A brush this scattered must guarantee a deposit under the cursor.
      if (!studioDynamicBrushUsesSplatterOriginAnchor({ brushId: id } as never)) {
        offenders.push(`${id} (${offset.toFixed(2)} nib radii, unanchored)`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
