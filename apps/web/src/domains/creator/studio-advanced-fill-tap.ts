/** Pointer-up tap recognizer for Advanced Fill, isolated from Konva/React for deterministic tests. */

export const STUDIO_ADVANCED_FILL_TAP_MAX_MOVEMENT_PX = 8;

export type StudioAdvancedFillTapPoint = { x: number; y: number };

export type StudioAdvancedFillTapGesture = {
  primaryPointerId: number;
  activePointerIds: readonly number[];
  start: StudioAdvancedFillTapPoint;
  blocked: boolean;
};

export type StudioAdvancedFillPointerStart = {
  pointerId: number;
  point: StudioAdvancedFillTapPoint;
  button?: number;
  isPrimary?: boolean;
};

export function beginStudioAdvancedFillTap(
  current: StudioAdvancedFillTapGesture | null,
  pointer: StudioAdvancedFillPointerStart,
): StudioAdvancedFillTapGesture {
  if (!current) {
    return {
      primaryPointerId: pointer.pointerId,
      activePointerIds: [pointer.pointerId],
      start: pointer.point,
      blocked: pointer.button !== undefined && pointer.button !== 0 || pointer.isPrimary === false,
    };
  }
  if (current.activePointerIds.includes(pointer.pointerId)) return current;
  return {
    ...current,
    activePointerIds: [...current.activePointerIds, pointer.pointerId],
    blocked: true,
  };
}

export function moveStudioAdvancedFillTap(
  current: StudioAdvancedFillTapGesture,
  pointerId: number,
  point: StudioAdvancedFillTapPoint,
): StudioAdvancedFillTapGesture {
  if (current.blocked || pointerId !== current.primaryPointerId) return current;
  const distance = Math.hypot(point.x - current.start.x, point.y - current.start.y);
  return distance > STUDIO_ADVANCED_FILL_TAP_MAX_MOVEMENT_PX
    ? { ...current, blocked: true }
    : current;
}

export function endStudioAdvancedFillTap(
  current: StudioAdvancedFillTapGesture,
  pointerId: number,
  cancelled = false,
): { gesture: StudioAdvancedFillTapGesture | null; execute: boolean } {
  const wasOnlyPointer = current.activePointerIds.length === 1 && current.activePointerIds[0] === pointerId;
  const execute = !cancelled && !current.blocked && pointerId === current.primaryPointerId && wasOnlyPointer;
  const activePointerIds = current.activePointerIds.filter((id) => id !== pointerId);
  if (activePointerIds.length === 0) return { gesture: null, execute };
  return {
    gesture: { ...current, activePointerIds, blocked: true },
    execute: false,
  };
}
