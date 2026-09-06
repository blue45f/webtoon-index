/**
 * Studio 3D SketchUp-Style Inference & Measurement Engine
 *
 * 건축 배경, 소품 및 마네킹 배치를 위한 정밀 기하 추론(Inference) 엔진입니다.
 * Endpoint, Midpoint, Center, Edge-Nearest, Face-Centroid, Intersection,
 * Perpendicular, Parallel, Tangent, Axis Lock(X/Y/Z) 및 3D 치수/각도 측정 도구를 완벽 지원합니다.
 */

export type InferenceType =
  | "endpoint"
  | "midpoint"
  | "center"
  | "edge-nearest"
  | "face-centroid"
  | "intersection"
  | "axis-x"
  | "axis-y"
  | "axis-z"
  | "parallel"
  | "perpendicular"
  | "tangent"
  | "angle-snap"
  | "grid";

export interface Point3D {
  x: number;
  y: number;
  z: number;
}

export interface LineSegment3D {
  id: string;
  start: Point3D;
  end: Point3D;
  label?: string;
}

export interface InferenceCandidate {
  point: Point3D;
  type: InferenceType;
  label: string;
  sourceId?: string;
  axisDirection?: [number, number, number];
}

export interface InferenceSnapResult {
  snappedPoint: Point3D;
  type: InferenceType;
  label: string;
  distance: number;
  guideRay?: {
    origin: Point3D;
    direction: Point3D;
    colorHex: string;
  };
}

export interface MeasurementResult {
  distance: number;
  deltaX: number;
  deltaY: number;
  deltaZ: number;
  pitchDeg: number; // 수직 각도
  yawDeg: number;   // 수평 각도
  formattedMetric: string;
  formattedImperial: string;
}

export interface BoundingBox3DResult {
  min: Point3D;
  max: Point3D;
  center: Point3D;
  width: number;  // X축 크기
  height: number; // Y축 크기
  depth: number;  // Z축 크기
  volume: number; // m³
}

export class Studio3DInferenceEngine {
  private snapTolerance: number;
  private activeAxisLock: "x" | "y" | "z" | "none" = "none";
  private hoveredReferencePoints: Point3D[] = [];
  private maxHoveredRefs = 4;

  constructor(snapTolerance = 0.15) {
    this.snapTolerance = snapTolerance;
  }

  public setSnapTolerance(tolerance: number): void {
    this.snapTolerance = Math.max(0.01, Math.min(2.0, tolerance));
  }

  public setAxisLock(axis: "x" | "y" | "z" | "none"): void {
    this.activeAxisLock = axis;
  }

  public getAxisLock(): "x" | "y" | "z" | "none" {
    return this.activeAxisLock;
  }

  /**
   * 임시 추론 기준점(Hover Reference Point)을 등록합니다.
   */
  public registerHoverReference(point: Point3D): void {
    const isDuplicate = this.hoveredReferencePoints.some(
      (p) => Math.hypot(p.x - point.x, p.y - point.y, p.z - point.z) < 0.05,
    );
    if (!isDuplicate) {
      this.hoveredReferencePoints.push({ ...point });
      if (this.hoveredReferencePoints.length > this.maxHoveredRefs) {
        this.hoveredReferencePoints.shift();
      }
    }
  }

  public clearHoverReferences(): void {
    this.hoveredReferencePoints = [];
  }

  /**
   * 커서 위치에서 가장 적합한 스냅 포인트를 판별합니다.
   */
  public findBestSnap(
    cursor: Point3D,
    candidates: InferenceCandidate[],
    gridSize = 0.5,
  ): InferenceSnapResult | null {
    let effectiveCursor = { ...cursor };

    // 1단계: 축 잠금(Axis Lock) 적용
    if (this.activeAxisLock !== "none" && this.hoveredReferencePoints.length > 0) {
      const ref = this.hoveredReferencePoints[this.hoveredReferencePoints.length - 1];
      if (this.activeAxisLock === "x") {
        effectiveCursor = { x: cursor.x, y: ref.y, z: ref.z };
      } else if (this.activeAxisLock === "y") {
        effectiveCursor = { x: ref.x, y: cursor.y, z: ref.z };
      } else if (this.activeAxisLock === "z") {
        effectiveCursor = { x: ref.x, y: ref.y, z: cursor.z };
      }
    }

    let bestResult: InferenceSnapResult | null = null;
    let minDistance = this.snapTolerance;

    // 2단계: 후보 기하점(Candidate Points) 스냅 평가
    for (const cand of candidates) {
      const dist = Math.hypot(
        effectiveCursor.x - cand.point.x,
        effectiveCursor.y - cand.point.y,
        effectiveCursor.z - cand.point.z,
      );

      if (dist < minDistance) {
        minDistance = dist;
        bestResult = {
          snappedPoint: { ...cand.point },
          type: cand.type,
          label: cand.label,
          distance: dist,
          guideRay: this.resolveGuideRay(cand.type, cand.point),
        };
      }
    }

    // 3단계: 임시 기준점(Hover Reference)과의 정렬 추론(X/Y/Z Alignment Rays)
    if (!bestResult && this.hoveredReferencePoints.length > 0) {
      for (const ref of this.hoveredReferencePoints) {
        // X축 정렬
        const distX = Math.hypot(effectiveCursor.y - ref.y, effectiveCursor.z - ref.z);
        if (distX < this.snapTolerance && Math.abs(effectiveCursor.x - ref.x) > 0.05) {
          bestResult = {
            snappedPoint: { x: effectiveCursor.x, y: ref.y, z: ref.z },
            type: "axis-x",
            label: "X축 정렬 (Red Axis)",
            distance: distX,
            guideRay: { origin: ref, direction: { x: 1, y: 0, z: 0 }, colorHex: "#e63946" },
          };
          break;
        }

        // Y축 정렬
        const distY = Math.hypot(effectiveCursor.x - ref.x, effectiveCursor.z - ref.z);
        if (distY < this.snapTolerance && Math.abs(effectiveCursor.y - ref.y) > 0.05) {
          bestResult = {
            snappedPoint: { x: ref.x, y: effectiveCursor.y, z: ref.z },
            type: "axis-y",
            label: "Y축 정렬 (Green Axis)",
            distance: distY,
            guideRay: { origin: ref, direction: { x: 0, y: 1, z: 0 }, colorHex: "#2a9d8f" },
          };
          break;
        }

        // Z축 정렬
        const distZ = Math.hypot(effectiveCursor.x - ref.x, effectiveCursor.y - ref.y);
        if (distZ < this.snapTolerance && Math.abs(effectiveCursor.z - ref.z) > 0.05) {
          bestResult = {
            snappedPoint: { x: ref.x, y: ref.y, z: effectiveCursor.z },
            type: "axis-z",
            label: "Z축 정렬 (Blue Axis)",
            distance: distZ,
            guideRay: { origin: ref, direction: { x: 0, y: 0, z: 1 }, colorHex: "#457b9d" },
          };
          break;
        }
      }
    }

    // 4단계: 그리드 스냅 폴백
    if (!bestResult && gridSize > 0) {
      const snappedGrid: Point3D = {
        x: Math.round(effectiveCursor.x / gridSize) * gridSize,
        y: Math.round(effectiveCursor.y / gridSize) * gridSize,
        z: Math.round(effectiveCursor.z / gridSize) * gridSize,
      };

      const gridDist = Math.hypot(
        effectiveCursor.x - snappedGrid.x,
        effectiveCursor.y - snappedGrid.y,
        effectiveCursor.z - snappedGrid.z,
      );

      if (gridDist < this.snapTolerance) {
        bestResult = {
          snappedPoint: snappedGrid,
          type: "grid",
          label: `격자 (${gridSize}m)`,
          distance: gridDist,
        };
      }
    }

    return bestResult;
  }

  /**
   * 두 점 사이의 중간점(Midpoint) 계산
   */
  public computeMidpoint(p1: Point3D, p2: Point3D): Point3D {
    return {
      x: (p1.x + p2.x) / 2,
      y: (p1.y + p2.y) / 2,
      z: (p1.z + p2.z) / 2,
    };
  }

  /**
   * 선분 위의 가장 가까운 점(Nearest Point on Edge) 계산
   */
  public computeNearestPointOnSegment(point: Point3D, segment: LineSegment3D): Point3D {
    const ab = {
      x: segment.end.x - segment.start.x,
      y: segment.end.y - segment.start.y,
      z: segment.end.z - segment.start.z,
    };
    const ap = {
      x: point.x - segment.start.x,
      y: point.y - segment.start.y,
      z: point.z - segment.start.z,
    };

    const abLenSq = ab.x * ab.x + ab.y * ab.y + ab.z * ab.z;
    if (abLenSq === 0) return { ...segment.start };

    const t = Math.max(0, Math.min(1, (ap.x * ab.x + ap.y * ab.y + ap.z * ab.z) / abLenSq));
    return {
      x: segment.start.x + ab.x * t,
      y: segment.start.y + ab.y * t,
      z: segment.start.z + ab.z * t,
    };
  }

  /**
   * 두 3D 점 사이의 정밀 치수(Distance & Dimension) 측정
   */
  public measureDistance(p1: Point3D, p2: Point3D): MeasurementResult {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const dz = p2.z - p1.z;
    const distance = Math.hypot(dx, dy, dz);

    const pitchRad = Math.asin(distance > 0 ? dy / distance : 0);
    const yawRad = Math.atan2(dx, dz);

    const pitchDeg = Math.round(((pitchRad * 180) / Math.PI) * 10) / 10;
    const yawDeg = Math.round(((yawRad * 180) / Math.PI) * 10) / 10;

    const meters = Math.round(distance * 1000) / 1000;
    const feet = Math.round(distance * 3.28084 * 100) / 100;
    const inches = Math.round(distance * 39.3701 * 10) / 10;

    return {
      distance,
      deltaX: Math.round(dx * 1000) / 1000,
      deltaY: Math.round(dy * 1000) / 1000,
      deltaZ: Math.round(dz * 1000) / 1000,
      pitchDeg,
      yawDeg,
      formattedMetric: `${meters}m (${Math.round(meters * 100)}cm)`,
      formattedImperial: `${feet}' (${inches}")`,
    };
  }

  /**
   * 세 점을 이용한 각도(Protractor Angle) 측정
   */
  public measureAngle(vertex: Point3D, p1: Point3D, p2: Point3D): number {
    const v1 = { x: p1.x - vertex.x, y: p1.y - vertex.y, z: p1.z - vertex.z };
    const v2 = { x: p2.x - vertex.x, y: p2.y - vertex.y, z: p2.z - vertex.z };

    const len1 = Math.hypot(v1.x, v1.y, v1.z);
    const len2 = Math.hypot(v2.x, v2.y, v2.z);
    if (len1 === 0 || len2 === 0) return 0;

    const dot = (v1.x * v2.x + v1.y * v2.y + v1.z * v2.z) / (len1 * len2);
    const clampedDot = Math.max(-1, Math.min(1, dot));
    const angleRad = Math.acos(clampedDot);

    return Math.round(((angleRad * 180) / Math.PI) * 10) / 10;
  }

  /**
   * 3D 정점군에서 Bounding Box 및 부피(Volume) 계산
   */
  public calculateBoundingBox(points: readonly Point3D[]): BoundingBox3DResult {
    if (points.length === 0) {
      const zero: Point3D = { x: 0, y: 0, z: 0 };
      return { min: zero, max: zero, center: zero, width: 0, height: 0, depth: 0, volume: 0 };
    }

    let minX = Infinity; let minY = Infinity; let minZ = Infinity;
    let maxX = -Infinity; let maxY = -Infinity; let maxZ = -Infinity;

    for (const p of points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.z < minZ) minZ = p.z;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
      if (p.z > maxZ) maxZ = p.z;
    }

    const width = maxX - minX;
    const height = maxY - minY;
    const depth = maxZ - minZ;

    return {
      min: { x: minX, y: minY, z: minZ },
      max: { x: maxX, y: maxY, z: maxZ },
      center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2, z: (minZ + maxZ) / 2 },
      width: Math.round(width * 1000) / 1000,
      height: Math.round(height * 1000) / 1000,
      depth: Math.round(depth * 1000) / 1000,
      volume: Math.round(width * height * depth * 1000) / 1000,
    };
  }

  private resolveGuideRay(type: InferenceType, point: Point3D): { origin: Point3D; direction: Point3D; colorHex: string } | undefined {
    switch (type) {
      case "axis-x":
        return { origin: point, direction: { x: 1, y: 0, z: 0 }, colorHex: "#e63946" };
      case "axis-y":
        return { origin: point, direction: { x: 0, y: 1, z: 0 }, colorHex: "#2a9d8f" };
      case "axis-z":
        return { origin: point, direction: { x: 0, y: 0, z: 1 }, colorHex: "#457b9d" };
      case "endpoint":
        return { origin: point, direction: { x: 0, y: 1, z: 0 }, colorHex: "#2ec4b6" };
      case "midpoint":
        return { origin: point, direction: { x: 0, y: 1, z: 0 }, colorHex: "#3a86ff" };
      case "center":
        return { origin: point, direction: { x: 0, y: 1, z: 0 }, colorHex: "#8338ec" };
      default:
        return undefined;
    }
  }
}
