/**
 * Structural boundary: 3D residual pure cores remain exported for UI/runtime glue.
 * Does not mount Three/R3F — only checks shipped entry points exist.
 */
import { describe, expect, it } from "vitest";

import {
  buildStudioBg3dLtDepthWidthField,
} from "../bg3d/studio-bg3d-lt-depth-width";
import { planStudioBg3dModelPlacementRecipe } from "../bg3d/studio-bg3d-placement-recipe";
import {
  resolveStudioBg3dShotBatchCaptureSize,
} from "../bg3d/studio-bg3d-shot-batch-plan";
import {
  planStudioBg3dMultiSurfaceSnap,
  resolveStudioBg3dSurfaceSnapOrientation,
} from "../bg3d/studio-bg3d-surface-snap";
import {
  attachStudioGeneric3dWorkflowMetadata,
  parseStudioGeneric3dWorkflowMetadata,
} from "../studio-generic-3d-workflow-metadata";
import {
  blendStudioPoseMaterialMergePlan,
  createStudioPoseMaterialStrengthMergePlan,
} from "../studio-pose-material-blend";
import {
  createStudioVrmExpressionApplyPlan,
} from "../vrm/studio-vrm-expression-apply";
import {
  createStudioVrmPoseApplyPlan,
} from "../vrm/studio-vrm-pose-apply";

describe("studio 3d residual export boundary", () => {
  it("exports VRM lock-aware pose and expression planners", () => {
    expect(typeof createStudioVrmPoseApplyPlan).toBe("function");
    expect(typeof createStudioVrmExpressionApplyPlan).toBe("function");
  });

  it("exports BG3D surface multi-snap, placement recipe, LT depth width, shot aspect", () => {
    expect(typeof resolveStudioBg3dSurfaceSnapOrientation).toBe("function");
    expect(typeof planStudioBg3dMultiSurfaceSnap).toBe("function");
    expect(typeof planStudioBg3dModelPlacementRecipe).toBe("function");
    expect(typeof buildStudioBg3dLtDepthWidthField).toBe("function");
    expect(typeof resolveStudioBg3dShotBatchCaptureSize).toBe("function");
  });

  it("exports pose-material strength blend and generic workflow metadata", () => {
    expect(typeof blendStudioPoseMaterialMergePlan).toBe("function");
    expect(typeof createStudioPoseMaterialStrengthMergePlan).toBe("function");
    expect(typeof attachStudioGeneric3dWorkflowMetadata).toBe("function");
    expect(typeof parseStudioGeneric3dWorkflowMetadata).toBe("function");
  });

  it("shot capture size freezes aspect across viewports", () => {
    const a = resolveStudioBg3dShotBatchCaptureSize({
      sourceWidth: 640,
      sourceHeight: 480,
      requestedHeight: 1024,
      maxPixels: 16_777_216,
      maxEdge: 4_096,
      exportAspectRatio: 0.75,
    });
    const b = resolveStudioBg3dShotBatchCaptureSize({
      sourceWidth: 2560,
      sourceHeight: 1440,
      requestedHeight: 1024,
      maxPixels: 16_777_216,
      maxEdge: 4_096,
      exportAspectRatio: 0.75,
    });
    expect(a).toEqual(b);
  });
});
