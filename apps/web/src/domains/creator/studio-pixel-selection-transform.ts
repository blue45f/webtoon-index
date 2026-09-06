/**
 * Studio Pixel Selection Transform Engine
 *
 * 선택 영역(PixelSelection)의 마퀴 경계 자체를 변형(이동, 회전, 스케일)하는 엔진입니다.
 * 픽셀 내용을 변형하는 것이 아닌, 선택 영역 궤적(Subpath)의 좌표를 직접 트랜스폼합니다.
 */

import type {
  PixelSelection,
  SelPoint,
  SelectionSubpath,
} from "./studio-selection-tools";

export interface SelectionTransformState {
  translation: [number, number]; // [du, dv] (-1..1 범위)
  rotationAngle: number;         // 회전 각도 (도)
  scale: [number, number];       // [su, sv] (0.1..10 범위)
  origin: SelPoint;              // 변형 중심점 (u, v)
}

export class StudioPixelSelectionTransformEngine {
  /**
   * 주어진 선택 영역의 바운딩 박스 중심점을 계산합니다.
   */
  public static computeSelectionCenter(selection: PixelSelection): SelPoint {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (const subpath of selection.subpaths) {
      for (const pt of subpath.points) {
        minX = Math.min(minX, pt.x);
        maxX = Math.max(maxX, pt.x);
        minY = Math.min(minY, pt.y);
        maxY = Math.max(maxY, pt.y);
      }
    }

    if (!Number.isFinite(minX)) return { x: 0.5, y: 0.5 };
    return {
      x: (minX + maxX) / 2,
      y: (minY + maxY) / 2,
    };
  }

  /**
   * 선택 영역의 모든 서브패스 점에 트랜스폼(이동, 회전, 스케일)을 적용합니다.
   */
  public static transformSelection(
    selection: PixelSelection,
    transform: SelectionTransformState,
  ): PixelSelection {
    const rad = (transform.rotationAngle * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const { origin, translation, scale } = transform;

    const transformedSubpaths: SelectionSubpath[] = selection.subpaths.map((subpath) => {
      const transformedPoints: SelPoint[] = subpath.points.map((pt) => {
        // 1. 원점 기점으로 상대 좌표 이동
        let dx = pt.x - origin.x;
        let dy = pt.y - origin.y;

        // 2. 스케일 적용
        dx *= scale[0];
        dy *= scale[1];

        // 3. 회전 적용
        const rx = dx * cos - dy * sin;
        const ry = dx * sin + dy * cos;

        // 4. 원점 복귀 + 이동 적용
        return {
          x: rx + origin.x + translation[0],
          y: ry + origin.y + translation[1],
        };
      });

      if (subpath.kind === "brush") {
        return {
          ...subpath,
          points: transformedPoints,
          radius: subpath.radius * Math.max(scale[0], scale[1]),
        };
      }

      return {
        ...subpath,
        points: transformedPoints,
      };
    });

    return {
      ...selection,
      subpaths: transformedSubpaths,
    };
  }
}
