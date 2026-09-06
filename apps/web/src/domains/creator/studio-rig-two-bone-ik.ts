import * as THREE from "three";

const LENGTH_EPSILON = 1e-6;

export type TwoBoneLengths = readonly [upper: number, lower: number];

export interface TwoBoneTargetSolution {
  /** Inputs are defensively copied; callers retain ownership of every supplied vector. */
  readonly start: THREE.Vector3;
  readonly target: THREE.Vector3;
  /** Joint positions satisfying the authored lengths and a stable bend plane. */
  readonly elbow: THREE.Vector3;
  readonly end: THREE.Vector3;
  /** Equal to `end`; makes an unreachable target's clamped destination explicit. */
  readonly effectiveTarget: THREE.Vector3;
  readonly poleDirection: THREE.Vector3;
  readonly lengths: TwoBoneLengths;
  readonly inputDistance: number;
  readonly solvedDistance: number;
  readonly reachable: boolean;
  readonly clamped: boolean;
}

function isFiniteVector(vector: THREE.Vector3 | null | undefined): vector is THREE.Vector3 {
  return Boolean(vector)
    && Number.isFinite(vector!.x)
    && Number.isFinite(vector!.y)
    && Number.isFinite(vector!.z);
}

function validLength(value: number): boolean {
  return Number.isFinite(value) && value > LENGTH_EPSILON;
}

/** Normalizes without squaring the original magnitude, avoiding overflow for large finite inputs. */
function safeUnitDirection(candidate: THREE.Vector3): THREE.Vector3 | null {
  if (!isFiniteVector(candidate)) return null;
  const largestComponent = Math.max(
    Math.abs(candidate.x),
    Math.abs(candidate.y),
    Math.abs(candidate.z),
  );
  if (!Number.isFinite(largestComponent) || largestComponent === 0) return null;
  const normalized = candidate.clone().multiplyScalar(1 / largestComponent);
  const length = Math.hypot(normalized.x, normalized.y, normalized.z);
  if (!Number.isFinite(length) || length === 0) return null;
  return normalized.multiplyScalar(1 / length);
}

function perpendicularUnitDirection(
  candidate: THREE.Vector3,
  axis: THREE.Vector3,
): THREE.Vector3 | null {
  const scaled = safeUnitDirection(candidate);
  if (!scaled) return null;
  scaled.addScaledVector(axis, -scaled.dot(axis));
  const perpendicularLength = Math.hypot(scaled.x, scaled.y, scaled.z);
  if (!Number.isFinite(perpendicularLength) || perpendicularLength <= 1e-10) return null;
  return scaled.multiplyScalar(1 / perpendicularLength);
}

/** Chooses a deterministic world axis least parallel to the target direction. */
function deterministicPerpendicular(axis: THREE.Vector3): THREE.Vector3 {
  const abs = [Math.abs(axis.x), Math.abs(axis.y), Math.abs(axis.z)] as const;
  const seed = abs[0] <= abs[1] && abs[0] <= abs[2]
    ? new THREE.Vector3(1, 0, 0)
    : abs[1] <= abs[2]
      ? new THREE.Vector3(0, 1, 0)
      : new THREE.Vector3(0, 0, 1);
  return perpendicularUnitDirection(seed, axis) ?? new THREE.Vector3(0, 1, 0);
}

/**
 * Builds a stable model-local pole point for authoring a new chain. Existing rest-pose bend wins;
 * a straight chain falls back to a deterministic perpendicular instead of an axis-aligned `z + 1`
 * hint that can become collinear for common character rigs.
 */
export function createTwoBoneDefaultPoleTarget(
  start: readonly [number, number, number],
  middle: readonly [number, number, number],
  end: readonly [number, number, number],
): [number, number, number] {
  const startPoint = new THREE.Vector3(...start);
  const middlePoint = new THREE.Vector3(...middle);
  const endPoint = new THREE.Vector3(...end);
  if (![startPoint, middlePoint, endPoint].every(isFiniteVector)) return [0, 0, 1];
  const axis = safeUnitDirection(endPoint.clone().sub(startPoint))
    ?? safeUnitDirection(middlePoint.clone().sub(startPoint))
    ?? new THREE.Vector3(1, 0, 0);
  const bendDirection = perpendicularUnitDirection(middlePoint.clone().sub(startPoint), axis)
    ?? deterministicPerpendicular(axis);
  const upperLength = startPoint.distanceTo(middlePoint);
  const lowerLength = middlePoint.distanceTo(endPoint);
  const offset = Math.max(
    1,
    Number.isFinite(upperLength) ? upperLength : 0,
    Number.isFinite(lowerLength) ? lowerLength : 0,
  );
  const pole = middlePoint.addScaledVector(bendDirection, offset);
  return [pole.x, pole.y, pole.z];
}

function choosePoleDirection(
  start: THREE.Vector3,
  currentElbow: THREE.Vector3,
  axis: THREE.Vector3,
  pole?: THREE.Vector3,
): THREE.Vector3 {
  if (isFiniteVector(pole)) {
    const fromPole = perpendicularUnitDirection(pole.clone().sub(start), axis);
    if (fromPole) return fromPole;
  }

  const fromCurrentBend = perpendicularUnitDirection(currentElbow.clone().sub(start), axis);
  if (fromCurrentBend) return fromCurrentBend;
  return deterministicPerpendicular(axis);
}

/**
 * Engine-neutral analytic two-bone position solver expressed with Three's math value objects.
 *
 * `pole` is a point in the same coordinate space as the chain. Unreachable and over-folded
 * targets are clamped to the nearest stable triangle while preserving both authored lengths.
 * The function never mutates caller-owned vectors and performs no scene-graph writes.
 */
export function solveTwoBoneTarget(
  start: THREE.Vector3,
  elbow: THREE.Vector3,
  end: THREE.Vector3,
  target: THREE.Vector3,
  pole?: THREE.Vector3,
  lengths?: TwoBoneLengths,
): TwoBoneTargetSolution | null {
  if (![start, elbow, end, target].every(isFiniteVector)) return null;

  const measuredUpper = start.distanceTo(elbow);
  const measuredLower = elbow.distanceTo(end);
  const upperLength = lengths?.[0] ?? measuredUpper;
  const lowerLength = lengths?.[1] ?? measuredLower;
  if (!validLength(upperLength) || !validLength(lowerLength)) return null;

  const originalTargetOffset = target.clone().sub(start);
  const inputDistance = Math.hypot(
    originalTargetOffset.x,
    originalTargetOffset.y,
    originalTargetOffset.z,
  );
  if (!Number.isFinite(inputDistance)) return null;

  const targetAxis = safeUnitDirection(originalTargetOffset)
    ?? safeUnitDirection(end.clone().sub(start))
    ?? safeUnitDirection(elbow.clone().sub(start))
    ?? new THREE.Vector3(1, 0, 0);

  const totalLength = upperLength + lowerLength;
  const rawMinimum = Math.abs(upperLength - lowerLength);
  // Perfect extension/folding removes the bend plane, so retain a scale-aware epsilon.
  const bendEpsilon = Math.min(
    Math.min(upperLength, lowerLength) * 0.25,
    Math.max(LENGTH_EPSILON, totalLength * 1e-6),
  );
  const minimumDistance = rawMinimum + bendEpsilon;
  const maximumDistance = totalLength - bendEpsilon;
  if (!(maximumDistance > minimumDistance)) return null;

  const solvedDistance = THREE.MathUtils.clamp(inputDistance, minimumDistance, maximumDistance);
  const distanceTolerance = Math.max(LENGTH_EPSILON, totalLength * 1e-7);
  const reachable = inputDistance >= rawMinimum - distanceTolerance
    && inputDistance <= totalLength + distanceTolerance;
  const clamped = Math.abs(solvedDistance - inputDistance) > distanceTolerance;
  const effectiveTarget = start.clone().addScaledVector(targetAxis, solvedDistance);
  const poleDirection = choosePoleDirection(start, elbow, targetAxis, pole);

  // Work in a normalized length domain. Directly subtracting `upper² - along²` loses most of the
  // short segment when a valid rig has a very large length ratio (for example 10,000 : 0.00001).
  // The factored projection and Heron product retain those small terms without overflowing.
  const lengthScale = Math.max(upperLength, lowerLength, solvedDistance);
  const normalizedUpper = upperLength / lengthScale;
  const normalizedLower = lowerLength / lengthScale;
  const normalizedDistance = solvedDistance / lengthScale;
  if (
    ![normalizedUpper, normalizedLower, normalizedDistance].every(Number.isFinite) ||
    normalizedDistance <= 0
  ) return null;
  const normalizedAlong = (
    normalizedDistance * normalizedDistance +
    (normalizedUpper - normalizedLower) * (normalizedUpper + normalizedLower)
  ) / (2 * normalizedDistance);
  const heronProduct = Math.max(
    0,
    (normalizedUpper + normalizedLower + normalizedDistance) *
    (-normalizedUpper + normalizedLower + normalizedDistance) *
    (normalizedUpper - normalizedLower + normalizedDistance) *
    (normalizedUpper + normalizedLower - normalizedDistance),
  );
  const along = normalizedAlong * lengthScale;
  const height = Math.sqrt(heronProduct) * lengthScale / (2 * normalizedDistance);
  if (!Number.isFinite(along) || !Number.isFinite(height)) return null;
  const solvedElbow = start.clone()
    .addScaledVector(targetAxis, along)
    .addScaledVector(poleDirection, height);

  if (!isFiniteVector(solvedElbow) || !isFiniteVector(effectiveTarget)) return null;
  return Object.freeze({
    start: start.clone(),
    target: target.clone(),
    elbow: solvedElbow,
    end: effectiveTarget.clone(),
    effectiveTarget,
    poleDirection,
    lengths: Object.freeze([upperLength, lowerLength]) as TwoBoneLengths,
    inputDistance,
    solvedDistance,
    reachable,
    clamped,
  });
}
