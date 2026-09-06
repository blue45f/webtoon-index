import { useFrame, useThree } from "@react-three/fiber";
import { useLayoutEffect } from "react";

import { installStudioBg3dFrameBackpressure } from "./studio-bg3d-frame-backpressure";
import {
  clearStudioBg3dViewFrame,
  STUDIO_BG3D_VIEW_FRAME_CLEAR_PRIORITY,
} from "./studio-bg3d-view-frame-clear";

export function StudioBg3dViewFrameClear() {
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);
  useLayoutEffect(() => installStudioBg3dFrameBackpressure(gl, invalidate), [gl, invalidate]);
  useFrame(({ gl }) => {
    clearStudioBg3dViewFrame(gl);
  }, STUDIO_BG3D_VIEW_FRAME_CLEAR_PRIORITY);

  return null;
}
