import { resolveStudioBg3dSceneFog } from "./studio-bg3d-scene-fog";

import type { StudioBg3dBackgroundSettings } from "./studio-bg3d-scene-document";

/** Declarative scene attachment shared by perspective and all-sides viewports. */
export function StudioBg3dSceneFog({
  background,
}: {
  readonly background: StudioBg3dBackgroundSettings;
}) {
  const fog = resolveStudioBg3dSceneFog(background);
  if (!fog) return null;
  return <fog attach="fog" args={[fog.color, fog.near, fog.far]} />;
}
