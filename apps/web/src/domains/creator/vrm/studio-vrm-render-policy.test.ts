import { describe, expect, it } from "vitest";

import {
  resolveStudioVrmFrameLoop,
  type StudioVrmRenderActivity,
} from "./studio-vrm-render-policy";

const STATIC_ACTIVITY: StudioVrmRenderActivity = Object.freeze({
  webcamActive: false,
  idleAnimation: false,
  physicsPreview: false,
  turntable: false,
  viewportHandIkDragging: false,
  jointHandleInteracting: false,
  persistentIkReconciling: false,
  capturing: false,
  sharingPose: false,
  thumbnailCapturing: false,
});

describe("Studio VRM render policy", () => {
  it("uses event-driven frames for a static pose scene", () => {
    expect(resolveStudioVrmFrameLoop(STATIC_ACTIVITY)).toBe("demand");
  });

  it.each(Object.keys(STATIC_ACTIVITY) as Array<keyof StudioVrmRenderActivity>)(
    "keeps continuous frames while %s is active",
    (flag) => {
      expect(resolveStudioVrmFrameLoop({ ...STATIC_ACTIVITY, [flag]: true })).toBe("always");
    },
  );
});
