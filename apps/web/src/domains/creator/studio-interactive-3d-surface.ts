export interface StudioInteractiveThreeDSurfaceState {
  readonly bg3dOpen: boolean;
  readonly characterShaperOpen: boolean;
  readonly dccRouteRequested: boolean;
  readonly mannequinPoserOpen: boolean;
  readonly poserVrmOpen: boolean;
}

export interface StudioInteractiveThreeDSurfaceAdmission {
  readonly bg3dOpen: boolean;
  readonly characterShaperOpen: boolean;
  readonly mannequinPoserOpen: boolean;
  readonly poserVrmOpen: boolean;
}

/**
 * Admits legacy modal 3D surfaces before render. A layout-effect cleanup is too late because
 * mounted WebGL children may already acquire a device or register their focus boundary.
 */
export function resolveStudioInteractiveThreeDSurfaceAdmission({
  bg3dOpen,
  characterShaperOpen,
  dccRouteRequested,
  mannequinPoserOpen,
  poserVrmOpen,
}: StudioInteractiveThreeDSurfaceState): StudioInteractiveThreeDSurfaceAdmission {
  if (dccRouteRequested) {
    return {
      bg3dOpen: false,
      characterShaperOpen: false,
      mannequinPoserOpen: false,
      poserVrmOpen: false,
    };
  }
  // The Character Shaper and the legacy poser both build a VRM runtime over the same document;
  // only one of them may hold a renderer, and the Shaper is the surface the route names.
  return {
    bg3dOpen,
    characterShaperOpen,
    mannequinPoserOpen,
    poserVrmOpen: poserVrmOpen && !characterShaperOpen,
  };
}
