/** Capability/readout resolution for the production precision transform panel. */

import {
  resolveStudioFigmaSelectionLayoutMetrics as resolveLegacySelectionLayoutMetrics,
} from "./studio-figma-selection-ux";
import { studioGroupUniformResizeMemberCanRotate } from "./studio-group-uniform-resize";
import {
  hasStrokeWidthSensitiveMember,
  supportsPersistentAspectLock,
  type StudioFigmaSelectionLayoutMetrics,
} from "./studio-selection-transform-contract";

import type { El } from "./studio-element-model";

export function resolveStudioFigmaSelectionLayoutMetrics(
  elements: readonly El[],
): StudioFigmaSelectionLayoutMetrics | null {
  const legacy = resolveLegacySelectionLayoutMetrics(elements);
  if (!legacy) return null;
  const multi = elements.length > 1;
  const single = elements.length === 1 ? elements[0]! : null;
  const supportsWidth = multi || legacy.supportsWidth;
  const supportsHeight = multi || legacy.supportsHeight;
  const supportsRotation = multi
    ? elements.every(studioGroupUniformResizeMemberCanRotate)
    : legacy.supportsRotation;
  const supportsAspectLock = Boolean(
    single && supportsPersistentAspectLock(single, legacy),
  );
  const aspectLocked = multi || Boolean(single?.lockAspect);

  return {
    ...legacy,
    precisionControls: true,
    width: legacy.width,
    height: legacy.height,
    supportsWidth,
    supportsHeight,
    hasFixedSize: supportsWidth && supportsHeight,
    supportsRotation,
    rotation: multi ? 0 : legacy.rotation,
    rotationIsRelative: multi || legacy.rotationIsRelative,
    sizeDisabledReason:
      supportsWidth && supportsHeight ? null : legacy.sizeDisabledReason,
    widthDisabledReason: supportsWidth ? null : legacy.widthDisabledReason,
    heightDisabledReason: supportsHeight ? null : legacy.heightDisabledReason,
    rotationDisabledReason: supportsRotation
      ? null
      : multi
        ? "선택 안에 함께 회전할 수 없는 요소가 있어요 — 패널·도형·대칭 획은 각도를 저장할 수 없습니다. 해당 요소를 빼거나 개별 회전해 주세요."
        : legacy.rotationDisabledReason,
    aspectLocked,
    supportsAspectLock,
    showAspectLockControl:
      multi
      || Boolean(
        supportsAspectLock
        && single
        && single.type !== "image"
        && single.type !== "bubble",
      ),
    hasStrokeWidthSensitiveMember: hasStrokeWidthSensitiveMember(elements),
  };
}
