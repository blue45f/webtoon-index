export type StudioHybridDccPolygonPoint3 = readonly [number, number, number];

function cross2d(
  a: readonly [number, number],
  b: readonly [number, number],
  c: readonly [number, number],
): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function pointOnSegment2d(
  point: readonly [number, number],
  a: readonly [number, number],
  b: readonly [number, number],
  epsilon: number,
): boolean {
  return Math.abs(cross2d(a, b, point)) <= epsilon
    && point[0] >= Math.min(a[0], b[0]) - epsilon
    && point[0] <= Math.max(a[0], b[0]) + epsilon
    && point[1] >= Math.min(a[1], b[1]) - epsilon
    && point[1] <= Math.max(a[1], b[1]) + epsilon;
}

function segmentsIntersect2d(
  a: readonly [number, number],
  b: readonly [number, number],
  c: readonly [number, number],
  d: readonly [number, number],
  epsilon: number,
): boolean {
  const abC = cross2d(a, b, c);
  const abD = cross2d(a, b, d);
  const cdA = cross2d(c, d, a);
  const cdB = cross2d(c, d, b);
  if (((abC > epsilon && abD < -epsilon) || (abC < -epsilon && abD > epsilon))
    && ((cdA > epsilon && cdB < -epsilon) || (cdA < -epsilon && cdB > epsilon))) {
    return true;
  }
  return (Math.abs(abC) <= epsilon && pointOnSegment2d(c, a, b, epsilon))
    || (Math.abs(abD) <= epsilon && pointOnSegment2d(d, a, b, epsilon))
    || (Math.abs(cdA) <= epsilon && pointOnSegment2d(a, c, d, epsilon))
    || (Math.abs(cdB) <= epsilon && pointOnSegment2d(b, c, d, epsilon));
}

function projectStudioHybridDccPolygon(
  points: readonly StudioHybridDccPolygonPoint3[],
  normal: StudioHybridDccPolygonPoint3,
): readonly (readonly [number, number])[] {
  const [nx, ny, nz] = normal.map(Math.abs) as [number, number, number];
  if (nx >= ny && nx >= nz) return points.map(([, y, z]) => [y, z]);
  if (ny >= nz) return points.map(([x, , z]) => [x, z]);
  return points.map(([x, y]) => [x, y]);
}

/**
 * Validates the exact polygon class supported by the synchronous DCC fan triangulator.
 *
 * Callers enforce their own corner and pair-work budgets before entering this routine. Concave,
 * self-intersecting, non-planar, or degenerate polygons fail closed until a bounded ear-clipping
 * or worker triangulation path is available.
 */
export function validateStudioHybridDccFanPolygon(
  points: readonly StudioHybridDccPolygonPoint3[],
  faceId: number,
): void {
  if (points.length < 3) throw new Error(`면 ${faceId}의 정점이 3개보다 적습니다.`);
  if (points.some((point) => point.some((coordinate) => !Number.isFinite(coordinate)))) {
    throw new Error(`면 ${faceId}에 유효하지 않은 좌표가 있습니다.`);
  }

  // Newell's method gives a stable polygon normal without trusting renderer-derived data.
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!;
    const next = points[(index + 1) % points.length]!;
    nx += (current[1] - next[1]) * (current[2] + next[2]);
    ny += (current[2] - next[2]) * (current[0] + next[0]);
    nz += (current[0] - next[0]) * (current[1] + next[1]);
  }
  const normalLength = Math.hypot(nx, ny, nz);
  if (normalLength <= 1e-10) throw new Error(`면 ${faceId}의 면적이 0입니다.`);
  const normal: StudioHybridDccPolygonPoint3 = [
    nx / normalLength,
    ny / normalLength,
    nz / normalLength,
  ];
  const anchor = points[0]!;
  let span = 0;
  for (const point of points) {
    span = Math.max(
      span,
      Math.abs(point[0] - anchor[0]),
      Math.abs(point[1] - anchor[1]),
      Math.abs(point[2] - anchor[2]),
    );
  }
  const planeTolerance = Math.max(1e-7, span * 1e-5);
  if (points.some((point) => Math.abs(
    (point[0] - anchor[0]) * normal[0]
      + (point[1] - anchor[1]) * normal[1]
      + (point[2] - anchor[2]) * normal[2],
  ) > planeTolerance)) {
    throw new Error(`면 ${faceId}가 평면 다각형이 아닙니다.`);
  }

  const projected = projectStudioHybridDccPolygon(points, normal);
  const epsilon = Math.max(1e-10, span * span * 1e-10);
  let winding = 0;
  for (let index = 0; index < projected.length; index += 1) {
    const turn = cross2d(
      projected[(index + projected.length - 1) % projected.length]!,
      projected[index]!,
      projected[(index + 1) % projected.length]!,
    );
    if (Math.abs(turn) <= epsilon) continue;
    const sign = Math.sign(turn);
    if (winding !== 0 && sign !== winding) {
      throw new Error(`면 ${faceId}는 검증된 오목 다각형 삼각화가 필요합니다.`);
    }
    winding = sign;
  }
  if (winding === 0) throw new Error(`면 ${faceId}의 투영 면적이 0입니다.`);

  for (let left = 0; left < projected.length; left += 1) {
    const leftNext = (left + 1) % projected.length;
    for (let right = left + 1; right < projected.length; right += 1) {
      const rightNext = (right + 1) % projected.length;
      if (left === right || leftNext === right || rightNext === left) continue;
      if (segmentsIntersect2d(
        projected[left]!,
        projected[leftNext]!,
        projected[right]!,
        projected[rightNext]!,
        epsilon,
      )) {
        throw new Error(`면 ${faceId}는 자기 교차 다각형입니다.`);
      }
    }
  }

  // Convexity alone is insufficient when boundary vertices are collinear with the fan anchor:
  // that would still create a zero-area authority triangle.
  for (let index = 1; index + 1 < projected.length; index += 1) {
    const fanArea = cross2d(projected[0]!, projected[index]!, projected[index + 1]!);
    if (Math.abs(fanArea) <= epsilon || Math.sign(fanArea) !== winding) {
      throw new Error(`면 ${faceId}는 안전한 fan 삼각화가 필요합니다.`);
    }
  }
}
