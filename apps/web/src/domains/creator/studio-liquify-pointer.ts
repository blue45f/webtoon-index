import { normalizeStudioLiquifyMode, type StudioLiquifyMode } from "./studio-liquify-contract";

import type { SelectionFrame, SelPoint } from "./studio-selection-tools";

export interface StudioLiquifyPointerLike {
  pointerId?: number;
  pointerType?: string;
  isPrimary?: boolean;
  pressure?: number;
}

export type StudioLiquifyPointerPoint = SelPoint & { pressure?: number };

export interface StudioLiquifyPointerSession {
  elId: string;
  frame: SelectionFrame;
  points: StudioLiquifyPointerPoint[];
  pointerId: number;
  pointerType: string;
  /** 포인터다운 순간의 모드 스냅샷 — 제스처 도중 패널 변경이 현재 dab 의미를 바꾸지 않는다. */
  mode: StudioLiquifyMode;
}

export type StudioLiquifyPointerEnd =
  | { kind: "ignored"; session: StudioLiquifyPointerSession }
  | { kind: "cancelled" | "discarded"; session: null }
  | { kind: "apply"; session: null; elId: string; points: StudioLiquifyPointerPoint[] };

function pointerId(pointer: StudioLiquifyPointerLike): number {
  return Number.isFinite(pointer.pointerId) ? Number(pointer.pointerId) : 1;
}

function pointWithPointerPressure(
  point: SelPoint,
  pointer: StudioLiquifyPointerLike
): StudioLiquifyPointerPoint {
  const pressure = pointer.pointerType === "pen" && Number.isFinite(pointer.pressure)
    ? Math.min(1, Math.max(0, Number(pointer.pressure)))
    : undefined;
  return pressure === undefined ? point : { ...point, pressure };
}

export function beginStudioLiquifyPointerSession(input: {
  elId: string;
  frame: SelectionFrame;
  point: SelPoint;
  pointer: StudioLiquifyPointerLike;
  /** 생략하면 기존 호환 동작인 Push. */
  mode?: StudioLiquifyMode;
}): StudioLiquifyPointerSession | null {
  if (input.pointer.isPrimary === false) return null;
  return {
    elId: input.elId,
    frame: input.frame,
    points: [pointWithPointerPressure(input.point, input.pointer)],
    pointerId: pointerId(input.pointer),
    pointerType: input.pointer.pointerType || "mouse",
    mode: normalizeStudioLiquifyMode(input.mode),
  };
}

export function isStudioLiquifyPointerOwner(
  session: StudioLiquifyPointerSession,
  pointer: StudioLiquifyPointerLike
): boolean {
  return session.pointerId === pointerId(pointer);
}

export function appendStudioLiquifyPointerPoint(
  session: StudioLiquifyPointerSession,
  pointer: StudioLiquifyPointerLike,
  point: SelPoint,
  /**
   * Normalized element-space spacing. Prefer radius-based values from
   * {@link studioLiquifyDragMinDistance}; the previous 0.002 floor packed too many dabs.
   */
  minimumDistance = 0.004,
): StudioLiquifyPointerSession {
  if (!isStudioLiquifyPointerOwner(session, pointer)) return session;
  const last = session.points.at(-1);
  if (last && Math.hypot(point.x - last.x, point.y - last.y) < minimumDistance) return session;
  // Cap pathological long strokes so pointerup bake cannot explode dab×cell visits.
  const maxPoints = 4_096;
  if (session.points.length >= maxPoints) {
    session.points[maxPoints - 1] = pointWithPointerPressure(point, pointer);
    return session;
  }
  // 세션은 StudioPage의 ref가 단독 소유하고 points도 공개 타입부터 mutable이다. 매 move마다 누적
  // 배열 전체를 복사하면 n개 점에 O(n²) 복사가 발생하므로 다른 raster brush와 동일하게 제자리 append한다.
  session.points.push(pointWithPointerPressure(point, pointer));
  return session;
}

export function endStudioLiquifyPointerSession(
  session: StudioLiquifyPointerSession,
  pointer: StudioLiquifyPointerLike,
  options: { cancelled: boolean; releasePoint?: SelPoint }
): StudioLiquifyPointerEnd {
  if (!isStudioLiquifyPointerOwner(session, pointer)) return { kind: "ignored", session };
  if (options.cancelled) return { kind: "cancelled", session: null };

  let points = session.points;
  const last = points.at(-1);
  const release = options.releasePoint;
  if (release && (!last || Math.hypot(release.x - last.x, release.y - last.y) > 1e-6)) {
    // The lift sample bypasses move throttling: a quick down→up drag still has a direction vector.
    points = [...points, pointWithPointerPressure(release, pointer)];
  }
  // Push는 이동 방향이 필요하지만, 중심 기반 Twirl/Pinch/Bloat는 포인터다운 한 점 자체가 dab이다.
  if (points.length < (session.mode === "push" ? 2 : 1)) {
    return { kind: "discarded", session: null };
  }
  return { kind: "apply", session: null, elId: session.elId, points };
}
