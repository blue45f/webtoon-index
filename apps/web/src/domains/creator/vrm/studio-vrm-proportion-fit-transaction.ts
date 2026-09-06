import { measureVrmPropRigMetrics } from "./studio-vrm-prop-rig";
import { measureStudioVrmWardrobeMetrics } from "./StudioVrmWardrobePropsProjection";

import type { VrmPropRigMetrics } from "./studio-vrm-prop-rig";
import type { WardrobeMetrics } from "./studio-vrm-wardrobe";
import type { VRM } from "@pixiv/three-vrm";

export type StudioVrmProportionFitMeasurements = Readonly<{
  wardrobe: WardrobeMetrics | null;
  props: VrmPropRigMetrics | null;
}>;

/**
 * Measures attachment fit while the proportion runtime owns a rebuilt rest rig, then reapplies
 * the caller's authored pose. Results remain buffered until the caller receives a successful rig
 * receipt, so a failed or recovered transaction can never publish speculative measurements.
 */
export function createStudioVrmProportionFitTransaction(
  vrm: VRM,
  reapplyAuthoredState: () => boolean | void,
) {
  let wardrobe: WardrobeMetrics | null = null;
  let props: VrmPropRigMetrics | null = null;
  return Object.freeze({
    reapply: () => {
      wardrobe = measureStudioVrmWardrobeMetrics(vrm);
      props = measureVrmPropRigMetrics(vrm);
      return reapplyAuthoredState();
    },
    measurements: (): StudioVrmProportionFitMeasurements => ({ wardrobe, props }),
  });
}
