import type { StudioGpuLiveSourceJournalAdvance } from "../render/studio-webgpu-live-source-journal";
import type { StudioGpuLiveStrokePlan } from "../render/studio-webgpu-live-stroke-plan";

export function initialGpuLiveSourceJournalMatchesPlan(
  advanced: StudioGpuLiveSourceJournalAdvance,
  plan: StudioGpuLiveStrokePlan
): boolean {
  if (
    advanced.status !== "advanced"
    || advanced.state.renderedPointCount !== plan.renderedPointCount
    || advanced.suffixes.length !== plan.strokes.length
  ) return false;
  return advanced.suffixes.every((suffix, variationIndex) => {
    const stroke = plan.strokes[variationIndex];
    if (
      !stroke
      || suffix.id !== stroke.id
      || suffix.previousRenderedPointCount !== 0
      || suffix.nextRenderedPointCount !== plan.renderedPointCount
      || suffix.points.length !== stroke.points.length
      || suffix.pressures.length !== stroke.pressures?.length
    ) return false;
    for (let index = 0; index < suffix.points.length; index += 1) {
      if (!Object.is(suffix.points[index], stroke.points[index])) return false;
    }
    for (let index = 0; index < suffix.pressures.length; index += 1) {
      if (!Object.is(suffix.pressures[index], stroke.pressures?.[index])) return false;
    }
    return true;
  });
}
