import { describe, expect, it } from "vitest";

import { resolveStudioInteractiveThreeDSurfaceAdmission } from "./studio-interactive-3d-surface";

describe("Studio interactive 3D surface admission", () => {
  it("rejects every legacy renderer in the same render that a DCC route takes ownership", () => {
    expect(resolveStudioInteractiveThreeDSurfaceAdmission({
      bg3dOpen: true,
      characterShaperOpen: true,
      dccRouteRequested: true,
      mannequinPoserOpen: true,
      poserVrmOpen: true,
    })).toEqual({
      bg3dOpen: false,
      characterShaperOpen: false,
      mannequinPoserOpen: false,
      poserVrmOpen: false,
    });
  });

  it("preserves legacy surface state while the canvas route owns presentation", () => {
    expect(resolveStudioInteractiveThreeDSurfaceAdmission({
      bg3dOpen: true,
      characterShaperOpen: false,
      dccRouteRequested: false,
      mannequinPoserOpen: false,
      poserVrmOpen: false,
    })).toEqual({
      bg3dOpen: true,
      characterShaperOpen: false,
      mannequinPoserOpen: false,
      poserVrmOpen: false,
    });
  });

  it("lets the Character Shaper win over the legacy poser so one VRM runtime owns the document", () => {
    expect(resolveStudioInteractiveThreeDSurfaceAdmission({
      bg3dOpen: false,
      characterShaperOpen: true,
      dccRouteRequested: false,
      mannequinPoserOpen: false,
      poserVrmOpen: true,
    })).toEqual({
      bg3dOpen: false,
      characterShaperOpen: true,
      mannequinPoserOpen: false,
      poserVrmOpen: false,
    });
  });
});
