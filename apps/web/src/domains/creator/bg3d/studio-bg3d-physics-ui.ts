export type StudioBg3dPhysicsPhase =
  | "idle"
  | "loading"
  | "running"
  | "paused"
  | "complete"
  | "baking"
  | "error";

export type StudioBg3dPhysicsGravityPreset = "earth" | "moon" | "zero";

export const STUDIO_BG3D_PHYSICS_GRAVITY: Readonly<
  Record<StudioBg3dPhysicsGravityPreset, readonly [number, number, number]>
> = Object.freeze({
  earth: Object.freeze([0, -9.81, 0] as const),
  moon: Object.freeze([0, -1.62, 0] as const),
  zero: Object.freeze([0, 0, 0] as const),
});

export function isStudioBg3dPhysicsTransientPhase(phase: StudioBg3dPhysicsPhase): boolean {
  return phase === "loading" || phase === "running" || phase === "paused" ||
    phase === "complete" || phase === "baking";
}
