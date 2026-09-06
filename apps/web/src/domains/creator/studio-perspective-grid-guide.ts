/**
 * Studio 3D/2D 지능형 투시(Perspective) 가이드 수식 모듈.
 *
 * 1점, 2점, 3점 및 어골(Fisheye) 원근 소점(Vanishing Point) 좌표를 기반으로
 * 드로잉 펜 포인터를 가장 가까운 투시 방사선에 자석처럼 스냅(Snap)시키는 연산 모듈.
 */

export type StudioPerspectiveType = "1point" | "2point" | "3point" | "fisheye";

export interface StudioVanishingPoint {
  readonly x: number;
  readonly y: number;
}

export interface StudioPerspectiveGuideConfig {
  readonly type: StudioPerspectiveType;
  readonly vanishingPoints: readonly StudioVanishingPoint[];
  readonly horizonY: number;
  readonly snapRadiusPx?: number;
}

export interface StudioPerspectiveSnapResult {
  readonly snappedX: number;
  readonly snappedY: number;
  readonly activeVanishingPointIndex: number;
  readonly distance: number;
}

/**
 * 펜 입력 좌표 (x, y)를 가장 가까운 투시 방사선으로 자석 스냅(Snap)시킨다.
 */
export function snapToStudioPerspectiveGrid(
  x: number,
  y: number,
  config: StudioPerspectiveGuideConfig,
): StudioPerspectiveSnapResult {
  const { vanishingPoints, snapRadiusPx = 24 } = config;

  if (vanishingPoints.length === 0) {
    return { snappedX: x, snappedY: y, activeVanishingPointIndex: -1, distance: 0 };
  }

  let minDistance = Infinity;
  let bestX = x;
  let bestY = y;
  let bestVpIndex = 0;

  for (let vpIndex = 0; vpIndex < vanishingPoints.length; vpIndex += 1) {
    const vp = vanishingPoints[vpIndex]!;
    const dx = x - vp.x;
    const dy = y - vp.y;
    const angle = Math.atan2(dy, dx);

    // 15도 간격 방사선 정류
    const rayAngleStep = (15 * Math.PI) / 180;
    const quantizedAngle = Math.round(angle / rayAngleStep) * rayAngleStep;

    const rayDx = Math.cos(quantizedAngle);
    const rayDy = Math.sin(quantizedAngle);

    // 포인터 좌표에서 방사선 수선 발(projection point) 계산
    const dot = dx * rayDx + dy * rayDy;
    const projX = vp.x + rayDx * dot;
    const projY = vp.y + rayDy * dot;

    const dist = Math.sqrt((x - projX) ** 2 + (y - projY) ** 2);
    if (dist < minDistance) {
      minDistance = dist;
      bestX = projX;
      bestY = projY;
      bestVpIndex = vpIndex;
    }
  }

  if (minDistance <= snapRadiusPx) {
    return {
      snappedX: bestX,
      snappedY: bestY,
      activeVanishingPointIndex: bestVpIndex,
      distance: minDistance,
    };
  }

  return { snappedX: x, snappedY: y, activeVanishingPointIndex: -1, distance: minDistance };
}
