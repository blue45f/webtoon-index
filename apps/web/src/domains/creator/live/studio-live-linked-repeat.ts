import {
  transformStudioBrushSymmetryPoint,
  type StudioBrushSymmetryTransform,
} from "../brush/studio-brush-symmetry";

/**
 * Clean-room live-repeat planner.
 *
 * The planner intentionally owns no canvas or object-model state. A linked repeat keeps one
 * source geometry and a deterministic transform plan; expansion is an explicit, irreversible
 * materialization boundary supplied by a geometry adapter.
 */

export type StudioLinkedRepeatTransform = StudioBrushSymmetryTransform;

export type StudioLinkedRepeatTransformSpace = "local" | "global";
export type StudioLinkedRepeatFlip = "none" | "horizontal" | "vertical";
export type StudioLinkedRepeatGridType = "uniform" | "brick-row" | "brick-column";

interface StudioLinkedRepeatParameterBase {
  readonly repeatId: string;
  readonly transformSpace: StudioLinkedRepeatTransformSpace;
}

export interface StudioLinkedRepeatGridParameters extends StudioLinkedRepeatParameterBase {
  readonly mode: "grid";
  readonly rows: number;
  readonly columns: number;
  readonly spacingX: number;
  readonly spacingY: number;
  readonly gridType: StudioLinkedRepeatGridType;
  /** Alternating rows after the first row are flipped around each instance origin. */
  readonly flipRows: StudioLinkedRepeatFlip;
  /** Alternating columns after the first column are flipped around each instance origin. */
  readonly flipColumns: StudioLinkedRepeatFlip;
}

export interface StudioLinkedRepeatRadialParameters extends StudioLinkedRepeatParameterBase {
  readonly mode: "radial";
  readonly count: number;
  readonly centerX: number;
  readonly centerY: number;
  readonly radius: number;
  readonly startAngleDegrees: number;
  /**
   * A full ±360° sweep excludes a duplicate endpoint. Partial arcs include both endpoints.
   * Negative values produce clockwise ordering.
   */
  readonly sweepAngleDegrees: number;
  readonly rotateInstances: boolean;
  readonly reverseOverlap: boolean;
}

export interface StudioLinkedRepeatMirrorParameters extends StudioLinkedRepeatParameterBase {
  readonly mode: "mirror";
  readonly axisX: number;
  readonly axisY: number;
  readonly angleDegrees: number;
  /** Moves the reflected copy along the positive axis normal after reflection. */
  readonly spacing: number;
}

export type StudioLinkedRepeatParameters =
  | StudioLinkedRepeatGridParameters
  | StudioLinkedRepeatRadialParameters
  | StudioLinkedRepeatMirrorParameters;

export interface StudioLinkedRepeatSource<TGeometry = unknown> {
  readonly id: string;
  readonly geometry: TGeometry;
  /**
   * Intrinsic source-to-document transform. Repeat transforms are composed before it in local
   * space, or after it in global space.
   */
  readonly transform?: StudioLinkedRepeatTransform;
}

export const STUDIO_LINKED_REPEAT_VERSION = 1;
export const STUDIO_LINKED_REPEAT_MAX_INSTANCES = 4_096;
export const STUDIO_LINKED_REPEAT_MAX_ABS_COORDINATE = 10_000_000;
export const STUDIO_LINKED_REPEAT_MAX_ABS_SPACING = 1_000_000;

const STUDIO_LINKED_REPEAT_MAX_ID_LENGTH = 256;
const STUDIO_LINKED_REPEAT_MAX_ABS_ANGLE = 360_000;
const STUDIO_LINKED_REPEAT_MAX_MATRIX_COMPONENT = 1_000_000_000_000;
const STUDIO_LINKED_REPEAT_MIN_DETERMINANT = 1e-12;
const FULL_CIRCLE_DEGREES = 360;
const FULL_CIRCLE_EPSILON = 1e-9;

const IDENTITY_TRANSFORM: StudioLinkedRepeatTransform = Object.freeze({
  a: 1,
  b: 0,
  c: 0,
  d: 1,
  e: 0,
  f: 0,
});

export type StudioLinkedRepeatFailureCode =
  | "invalid-source"
  | "invalid-parameter"
  | "invalid-option"
  | "instance-budget-exceeded"
  | "transform-overflow"
  | "handle-mode-mismatch"
  | "patch-mismatch"
  | "source-mismatch"
  | "geometry-expansion-failed"
  | "geometry-alias";

export interface StudioLinkedRepeatFailure {
  readonly code: StudioLinkedRepeatFailureCode;
  readonly field?: string;
  readonly message: string;
}

export type StudioLinkedRepeatResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: StudioLinkedRepeatFailure };

export interface StudioLinkedRepeatInstance {
  readonly id: string;
  readonly sourceId: string;
  readonly linked: true;
  /** Stable generator order, independent of painter stacking order. */
  readonly logicalIndex: number;
  /** Index in the returned painter-order instance list. */
  readonly paintIndex: number;
  readonly row?: number;
  readonly column?: number;
  readonly angleDegrees?: number;
  readonly reflected?: boolean;
  readonly repeatTransform: StudioLinkedRepeatTransform;
  readonly transform: StudioLinkedRepeatTransform;
}

export interface StudioLinkedRepeatPlan {
  readonly version: typeof STUDIO_LINKED_REPEAT_VERSION;
  readonly repeatId: string;
  readonly sourceId: string;
  readonly mode: StudioLinkedRepeatParameters["mode"];
  readonly sourceTransform: StudioLinkedRepeatTransform;
  readonly parameters: StudioLinkedRepeatParameters;
  /** Painter order: earlier entries are painted first. */
  readonly instances: readonly StudioLinkedRepeatInstance[];
}

export interface StudioLinkedRepeatPlanOptions {
  readonly maxInstances?: number;
}

export type StudioLinkedRepeatHandleChange =
  | {
    readonly kind: "grid-count";
    readonly rows: number;
    readonly columns: number;
  }
  | {
    readonly kind: "grid-spacing";
    readonly spacingX: number;
    readonly spacingY: number;
  }
  | {
    readonly kind: "grid-layout";
    readonly gridType: StudioLinkedRepeatGridType;
    readonly flipRows: StudioLinkedRepeatFlip;
    readonly flipColumns: StudioLinkedRepeatFlip;
  }
  | {
    readonly kind: "radial-count";
    readonly count: number;
  }
  | {
    readonly kind: "radial-radius";
    readonly radius: number;
  }
  | {
    readonly kind: "radial-arc";
    readonly centerX: number;
    readonly centerY: number;
    readonly startAngleDegrees: number;
    readonly sweepAngleDegrees: number;
  }
  | {
    readonly kind: "radial-overlap";
    readonly reverseOverlap: boolean;
  }
  | {
    readonly kind: "radial-orientation";
    readonly rotateInstances: boolean;
  }
  | {
    readonly kind: "mirror-axis";
    readonly axisX: number;
    readonly axisY: number;
    readonly angleDegrees: number;
  }
  | {
    readonly kind: "mirror-spacing";
    readonly spacing: number;
  }
  | {
    readonly kind: "transform-space";
    readonly transformSpace: StudioLinkedRepeatTransformSpace;
  };

type StudioLinkedRepeatPatchValue = string | number | boolean;
type StudioLinkedRepeatPatchDelta = Readonly<Record<string, StudioLinkedRepeatPatchValue>>;

export interface StudioLinkedRepeatParameterPatch {
  readonly kind: "studio-linked-repeat-parameter-patch";
  readonly repeatId: string;
  readonly mode: StudioLinkedRepeatParameters["mode"];
  readonly handle: StudioLinkedRepeatHandleChange["kind"];
  /** Stable key lets the history layer coalesce successive pointer-move patches. */
  readonly coalesceKey: string;
  readonly changedFields: readonly string[];
  readonly before: StudioLinkedRepeatParameters;
  readonly after: StudioLinkedRepeatParameters;
  readonly forward: StudioLinkedRepeatPatchDelta;
  readonly inverse: StudioLinkedRepeatPatchDelta;
}

export interface StudioLinkedRepeatExpandedObject<TGeometry> {
  readonly id: string;
  readonly sourceId: string;
  readonly repeatId: string;
  readonly linked: false;
  readonly logicalIndex: number;
  readonly paintIndex: number;
  readonly geometry: TGeometry;
}

export interface StudioLinkedRepeatExpansion<TGeometry> {
  readonly kind: "expanded-linked-repeat";
  readonly repeatId: string;
  readonly sourceId: string;
  readonly objects: readonly StudioLinkedRepeatExpandedObject<TGeometry>[];
}

function success<T>(value: T): StudioLinkedRepeatResult<T> {
  return { ok: true, value };
}

function failure(
  code: StudioLinkedRepeatFailureCode,
  message: string,
  field?: string
): StudioLinkedRepeatResult<never> {
  return {
    ok: false,
    error: {
      code,
      ...(field ? { field } : {}),
      message,
    },
  };
}

function isValidId(value: unknown): value is string {
  return typeof value === "string"
    && value.trim().length > 0
    && value.length <= STUDIO_LINKED_REPEAT_MAX_ID_LENGTH;
}

function isFiniteInRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number"
    && Number.isFinite(value)
    && value >= minimum
    && value <= maximum;
}

function isPositiveIntegerAtMost(value: unknown, maximum: number): value is number {
  return Number.isSafeInteger(value) && typeof value === "number" && value >= 1 && value <= maximum;
}

function isTransformSpace(value: unknown): value is StudioLinkedRepeatTransformSpace {
  return value === "local" || value === "global";
}

function isFlip(value: unknown): value is StudioLinkedRepeatFlip {
  return value === "none" || value === "horizontal" || value === "vertical";
}

function isGridType(value: unknown): value is StudioLinkedRepeatGridType {
  return value === "uniform" || value === "brick-row" || value === "brick-column";
}

function copyTransform(transform: StudioLinkedRepeatTransform): StudioLinkedRepeatTransform {
  return Object.freeze({
    a: transform.a,
    b: transform.b,
    c: transform.c,
    d: transform.d,
    e: transform.e,
    f: transform.f,
  });
}

function validateTransform(
  transform: unknown,
  field: string,
  requireInvertible = true
): StudioLinkedRepeatResult<StudioLinkedRepeatTransform> {
  if (typeof transform !== "object" || transform === null) {
    return failure("invalid-source", `${field} must be an affine transform.`, field);
  }
  const candidate = transform as Partial<StudioLinkedRepeatTransform>;
  const values = [candidate.a, candidate.b, candidate.c, candidate.d, candidate.e, candidate.f];
  if (!values.every((value) => (
    typeof value === "number"
    && Number.isFinite(value)
    && Math.abs(value) <= STUDIO_LINKED_REPEAT_MAX_MATRIX_COMPONENT
  ))) {
    return failure("transform-overflow", `${field} contains a non-finite or unsafe component.`, field);
  }
  const typed = candidate as StudioLinkedRepeatTransform;
  const determinant = typed.a * typed.d - typed.b * typed.c;
  if (!Number.isFinite(determinant) || (
    requireInvertible && Math.abs(determinant) < STUDIO_LINKED_REPEAT_MIN_DETERMINANT
  )) {
    return failure("transform-overflow", `${field} is singular or numerically unstable.`, field);
  }
  return success(copyTransform(typed));
}

function validateInstanceLimit(
  options?: StudioLinkedRepeatPlanOptions
): StudioLinkedRepeatResult<number> {
  const requested = options?.maxInstances ?? STUDIO_LINKED_REPEAT_MAX_INSTANCES;
  if (!isPositiveIntegerAtMost(requested, STUDIO_LINKED_REPEAT_MAX_INSTANCES)) {
    return failure(
      "invalid-option",
      `maxInstances must be an integer from 1 to ${STUDIO_LINKED_REPEAT_MAX_INSTANCES}.`,
      "maxInstances"
    );
  }
  return success(requested);
}

function normalizeGridParameters(
  parameters: StudioLinkedRepeatGridParameters,
  maxInstances: number
): StudioLinkedRepeatResult<StudioLinkedRepeatGridParameters> {
  if (!isPositiveIntegerAtMost(parameters.rows, STUDIO_LINKED_REPEAT_MAX_INSTANCES)) {
    return failure("invalid-parameter", "rows is outside the supported range.", "rows");
  }
  if (!isPositiveIntegerAtMost(parameters.columns, STUDIO_LINKED_REPEAT_MAX_INSTANCES)) {
    return failure("invalid-parameter", "columns is outside the supported range.", "columns");
  }
  if (parameters.rows * parameters.columns > maxInstances) {
    return failure(
      "instance-budget-exceeded",
      `Grid repeat exceeds the ${maxInstances}-instance budget.`,
      "rows"
    );
  }
  if (!isFiniteInRange(
    parameters.spacingX,
    -STUDIO_LINKED_REPEAT_MAX_ABS_SPACING,
    STUDIO_LINKED_REPEAT_MAX_ABS_SPACING
  )) {
    return failure("invalid-parameter", "spacingX is outside the supported range.", "spacingX");
  }
  if (!isFiniteInRange(
    parameters.spacingY,
    -STUDIO_LINKED_REPEAT_MAX_ABS_SPACING,
    STUDIO_LINKED_REPEAT_MAX_ABS_SPACING
  )) {
    return failure("invalid-parameter", "spacingY is outside the supported range.", "spacingY");
  }
  if (!isGridType(parameters.gridType)) {
    return failure("invalid-parameter", "gridType is not supported.", "gridType");
  }
  if (!isFlip(parameters.flipRows)) {
    return failure("invalid-parameter", "flipRows is not supported.", "flipRows");
  }
  if (!isFlip(parameters.flipColumns)) {
    return failure("invalid-parameter", "flipColumns is not supported.", "flipColumns");
  }
  return success(Object.freeze({ ...parameters }));
}

function normalizeRadialParameters(
  parameters: StudioLinkedRepeatRadialParameters,
  maxInstances: number
): StudioLinkedRepeatResult<StudioLinkedRepeatRadialParameters> {
  if (!isPositiveIntegerAtMost(parameters.count, maxInstances)) {
    const code = Number.isSafeInteger(parameters.count) && parameters.count > maxInstances
      ? "instance-budget-exceeded"
      : "invalid-parameter";
    return failure(code, `count must be an integer from 1 to ${maxInstances}.`, "count");
  }
  if (!isFiniteInRange(
    parameters.centerX,
    -STUDIO_LINKED_REPEAT_MAX_ABS_COORDINATE,
    STUDIO_LINKED_REPEAT_MAX_ABS_COORDINATE
  )) {
    return failure("invalid-parameter", "centerX is outside the supported range.", "centerX");
  }
  if (!isFiniteInRange(
    parameters.centerY,
    -STUDIO_LINKED_REPEAT_MAX_ABS_COORDINATE,
    STUDIO_LINKED_REPEAT_MAX_ABS_COORDINATE
  )) {
    return failure("invalid-parameter", "centerY is outside the supported range.", "centerY");
  }
  if (!isFiniteInRange(parameters.radius, 0, STUDIO_LINKED_REPEAT_MAX_ABS_SPACING)) {
    return failure("invalid-parameter", "radius is outside the supported range.", "radius");
  }
  if (!isFiniteInRange(
    parameters.startAngleDegrees,
    -STUDIO_LINKED_REPEAT_MAX_ABS_ANGLE,
    STUDIO_LINKED_REPEAT_MAX_ABS_ANGLE
  )) {
    return failure(
      "invalid-parameter",
      "startAngleDegrees is outside the supported range.",
      "startAngleDegrees"
    );
  }
  if (!isFiniteInRange(
    parameters.sweepAngleDegrees,
    -FULL_CIRCLE_DEGREES,
    FULL_CIRCLE_DEGREES
  ) || (parameters.count > 1 && parameters.sweepAngleDegrees === 0)) {
    return failure(
      "invalid-parameter",
      "sweepAngleDegrees must be non-zero for multiple instances and within ±360°.",
      "sweepAngleDegrees"
    );
  }
  if (typeof parameters.rotateInstances !== "boolean") {
    return failure("invalid-parameter", "rotateInstances must be boolean.", "rotateInstances");
  }
  if (typeof parameters.reverseOverlap !== "boolean") {
    return failure("invalid-parameter", "reverseOverlap must be boolean.", "reverseOverlap");
  }
  return success(Object.freeze({ ...parameters }));
}

function normalizeMirrorParameters(
  parameters: StudioLinkedRepeatMirrorParameters,
  maxInstances: number
): StudioLinkedRepeatResult<StudioLinkedRepeatMirrorParameters> {
  if (maxInstances < 2) {
    return failure(
      "instance-budget-exceeded",
      "Mirror repeat requires a two-instance budget.",
      "maxInstances"
    );
  }
  if (!isFiniteInRange(
    parameters.axisX,
    -STUDIO_LINKED_REPEAT_MAX_ABS_COORDINATE,
    STUDIO_LINKED_REPEAT_MAX_ABS_COORDINATE
  )) {
    return failure("invalid-parameter", "axisX is outside the supported range.", "axisX");
  }
  if (!isFiniteInRange(
    parameters.axisY,
    -STUDIO_LINKED_REPEAT_MAX_ABS_COORDINATE,
    STUDIO_LINKED_REPEAT_MAX_ABS_COORDINATE
  )) {
    return failure("invalid-parameter", "axisY is outside the supported range.", "axisY");
  }
  if (!isFiniteInRange(
    parameters.angleDegrees,
    -STUDIO_LINKED_REPEAT_MAX_ABS_ANGLE,
    STUDIO_LINKED_REPEAT_MAX_ABS_ANGLE
  )) {
    return failure("invalid-parameter", "angleDegrees is outside the supported range.", "angleDegrees");
  }
  if (!isFiniteInRange(
    parameters.spacing,
    -STUDIO_LINKED_REPEAT_MAX_ABS_SPACING,
    STUDIO_LINKED_REPEAT_MAX_ABS_SPACING
  )) {
    return failure("invalid-parameter", "spacing is outside the supported range.", "spacing");
  }
  return success(Object.freeze({ ...parameters }));
}

function normalizeParameters(
  parameters: StudioLinkedRepeatParameters,
  maxInstances: number
): StudioLinkedRepeatResult<StudioLinkedRepeatParameters> {
  if (typeof parameters !== "object" || parameters === null) {
    return failure("invalid-parameter", "Repeat parameters are required.");
  }
  if (!isValidId(parameters.repeatId)) {
    return failure("invalid-parameter", "repeatId is required and must be bounded.", "repeatId");
  }
  if (!isTransformSpace(parameters.transformSpace)) {
    return failure(
      "invalid-parameter",
      "transformSpace must be local or global.",
      "transformSpace"
    );
  }
  if (parameters.mode === "grid") {
    return normalizeGridParameters(parameters, maxInstances);
  }
  if (parameters.mode === "radial") {
    return normalizeRadialParameters(parameters, maxInstances);
  }
  if (parameters.mode === "mirror") {
    return normalizeMirrorParameters(parameters, maxInstances);
  }
  return failure("invalid-parameter", "Repeat mode is not supported.", "mode");
}

function multiplyTransforms(
  left: StudioLinkedRepeatTransform,
  right: StudioLinkedRepeatTransform
): StudioLinkedRepeatTransform {
  return {
    a: left.a * right.a + left.c * right.b,
    b: left.b * right.a + left.d * right.b,
    c: left.a * right.c + left.c * right.d,
    d: left.b * right.c + left.d * right.d,
    e: left.a * right.e + left.c * right.f + left.e,
    f: left.b * right.e + left.d * right.f + left.f,
  };
}

function translation(x: number, y: number): StudioLinkedRepeatTransform {
  return { a: 1, b: 0, c: 0, d: 1, e: x, f: y };
}

function rotation(degrees: number): StudioLinkedRepeatTransform {
  const radians = degrees * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return { a: cosine, b: sine, c: -sine, d: cosine, e: 0, f: 0 };
}

function scaling(scaleX: number, scaleY: number): StudioLinkedRepeatTransform {
  return { a: scaleX, b: 0, c: 0, d: scaleY, e: 0, f: 0 };
}

function composeInstanceTransform(
  source: StudioLinkedRepeatTransform,
  repeat: StudioLinkedRepeatTransform,
  space: StudioLinkedRepeatTransformSpace
): StudioLinkedRepeatTransform {
  return space === "global"
    ? multiplyTransforms(repeat, source)
    : multiplyTransforms(source, repeat);
}

function safeInstanceTransform(
  source: StudioLinkedRepeatTransform,
  repeat: StudioLinkedRepeatTransform,
  space: StudioLinkedRepeatTransformSpace,
  field: string
): StudioLinkedRepeatResult<{
  readonly repeatTransform: StudioLinkedRepeatTransform;
  readonly transform: StudioLinkedRepeatTransform;
}> {
  const repeatValidation = validateTransform(repeat, `${field}.repeatTransform`);
  if (!repeatValidation.ok) return repeatValidation;
  const composed = composeInstanceTransform(source, repeatValidation.value, space);
  const composedValidation = validateTransform(composed, `${field}.transform`);
  if (!composedValidation.ok) return composedValidation;
  return success({
    repeatTransform: repeatValidation.value,
    transform: composedValidation.value,
  });
}

function flipScales(
  flipRows: StudioLinkedRepeatFlip,
  flipColumns: StudioLinkedRepeatFlip,
  row: number,
  column: number
): readonly [number, number] {
  let scaleX = 1;
  let scaleY = 1;
  if (row % 2 === 1) {
    if (flipRows === "horizontal") scaleX *= -1;
    if (flipRows === "vertical") scaleY *= -1;
  }
  if (column % 2 === 1) {
    if (flipColumns === "horizontal") scaleX *= -1;
    if (flipColumns === "vertical") scaleY *= -1;
  }
  return [scaleX, scaleY];
}

function gridOffset(
  parameters: StudioLinkedRepeatGridParameters,
  row: number,
  column: number
): readonly [number, number] {
  let x = column * parameters.spacingX;
  let y = row * parameters.spacingY;
  if (parameters.gridType === "brick-row" && row % 2 === 1) {
    x += parameters.spacingX / 2;
  }
  if (parameters.gridType === "brick-column" && column % 2 === 1) {
    y += parameters.spacingY / 2;
  }
  return [x, y];
}

function planGridInstances(
  sourceId: string,
  sourceTransform: StudioLinkedRepeatTransform,
  parameters: StudioLinkedRepeatGridParameters
): StudioLinkedRepeatResult<readonly StudioLinkedRepeatInstance[]> {
  const instances: StudioLinkedRepeatInstance[] = [];
  for (let row = 0; row < parameters.rows; row += 1) {
    for (let column = 0; column < parameters.columns; column += 1) {
      const logicalIndex = row * parameters.columns + column;
      const [x, y] = gridOffset(parameters, row, column);
      const [scaleX, scaleY] = flipScales(
        parameters.flipRows,
        parameters.flipColumns,
        row,
        column
      );
      const repeatTransform = multiplyTransforms(
        translation(x, y),
        scaling(scaleX, scaleY)
      );
      const planned = safeInstanceTransform(
        sourceTransform,
        repeatTransform,
        parameters.transformSpace,
        `instances[${logicalIndex}]`
      );
      if (!planned.ok) return planned;
      instances.push(Object.freeze({
        id: `${parameters.repeatId}:instance:${logicalIndex}`,
        sourceId,
        linked: true,
        logicalIndex,
        paintIndex: logicalIndex,
        row,
        column,
        repeatTransform: planned.value.repeatTransform,
        transform: planned.value.transform,
      }));
    }
  }
  return success(Object.freeze(instances));
}

function radialStepDegrees(parameters: StudioLinkedRepeatRadialParameters): number {
  if (parameters.count <= 1) return 0;
  const isFullCircle = Math.abs(
    Math.abs(parameters.sweepAngleDegrees) - FULL_CIRCLE_DEGREES
  ) <= FULL_CIRCLE_EPSILON;
  return parameters.sweepAngleDegrees / (
    isFullCircle ? parameters.count : parameters.count - 1
  );
}

function planRadialInstances(
  sourceId: string,
  sourceTransform: StudioLinkedRepeatTransform,
  parameters: StudioLinkedRepeatRadialParameters
): StudioLinkedRepeatResult<readonly StudioLinkedRepeatInstance[]> {
  const step = radialStepDegrees(parameters);
  const generated: StudioLinkedRepeatInstance[] = [];
  for (let logicalIndex = 0; logicalIndex < parameters.count; logicalIndex += 1) {
    const angleDegrees = parameters.startAngleDegrees + step * logicalIndex;
    const radians = angleDegrees * Math.PI / 180;
    const targetX = parameters.centerX + parameters.radius * Math.cos(radians);
    const targetY = parameters.centerY + parameters.radius * Math.sin(radians);
    const orientation = parameters.rotateInstances ? step * logicalIndex : 0;
    const absolutePlacement = multiplyTransforms(
      translation(targetX, targetY),
      rotation(orientation)
    );
    const repeatTransform = parameters.transformSpace === "global"
      ? multiplyTransforms(
        absolutePlacement,
        translation(-sourceTransform.e, -sourceTransform.f)
      )
      : absolutePlacement;
    const planned = safeInstanceTransform(
      sourceTransform,
      repeatTransform,
      parameters.transformSpace,
      `instances[${logicalIndex}]`
    );
    if (!planned.ok) return planned;
    generated.push(Object.freeze({
      id: `${parameters.repeatId}:instance:${logicalIndex}`,
      sourceId,
      linked: true,
      logicalIndex,
      paintIndex: logicalIndex,
      angleDegrees,
      repeatTransform: planned.value.repeatTransform,
      transform: planned.value.transform,
    }));
  }

  const painterOrder = parameters.reverseOverlap ? [...generated].reverse() : generated;
  return success(Object.freeze(painterOrder.map((instance, paintIndex) => Object.freeze({
    ...instance,
    paintIndex,
  }))));
}

function reflectionAroundAxis(
  axisX: number,
  axisY: number,
  angleDegrees: number
): StudioLinkedRepeatTransform {
  const radians = angleDegrees * Math.PI / 180;
  const cosine = Math.cos(2 * radians);
  const sine = Math.sin(2 * radians);
  return {
    a: cosine,
    b: sine,
    c: sine,
    d: -cosine,
    e: axisX - cosine * axisX - sine * axisY,
    f: axisY - sine * axisX + cosine * axisY,
  };
}

function planMirrorInstances(
  sourceId: string,
  sourceTransform: StudioLinkedRepeatTransform,
  parameters: StudioLinkedRepeatMirrorParameters
): StudioLinkedRepeatResult<readonly StudioLinkedRepeatInstance[]> {
  const radians = parameters.angleDegrees * Math.PI / 180;
  const normalX = -Math.sin(radians);
  const normalY = Math.cos(radians);
  const reflected = multiplyTransforms(
    translation(normalX * parameters.spacing, normalY * parameters.spacing),
    reflectionAroundAxis(
      parameters.axisX,
      parameters.axisY,
      parameters.angleDegrees
    )
  );
  const repeatTransforms = [IDENTITY_TRANSFORM, reflected] as const;
  const instances: StudioLinkedRepeatInstance[] = [];
  for (let logicalIndex = 0; logicalIndex < repeatTransforms.length; logicalIndex += 1) {
    const planned = safeInstanceTransform(
      sourceTransform,
      repeatTransforms[logicalIndex],
      parameters.transformSpace,
      `instances[${logicalIndex}]`
    );
    if (!planned.ok) return planned;
    instances.push(Object.freeze({
      id: `${parameters.repeatId}:instance:${logicalIndex}`,
      sourceId,
      linked: true,
      logicalIndex,
      paintIndex: logicalIndex,
      reflected: logicalIndex === 1,
      repeatTransform: planned.value.repeatTransform,
      transform: planned.value.transform,
    }));
  }
  return success(Object.freeze(instances));
}

/**
 * Builds a deterministic painter-order transform plan from one linked source object.
 * Invalid persisted/imported data returns a typed failure and never a partial plan.
 */
export function planStudioLinkedRepeat<TGeometry>(
  source: StudioLinkedRepeatSource<TGeometry>,
  parameters: StudioLinkedRepeatParameters,
  options?: StudioLinkedRepeatPlanOptions
): StudioLinkedRepeatResult<StudioLinkedRepeatPlan> {
  if (typeof source !== "object" || source === null || !isValidId(source.id)) {
    return failure("invalid-source", "Source id is required and must be bounded.", "source.id");
  }
  const limit = validateInstanceLimit(options);
  if (!limit.ok) return limit;
  const normalized = normalizeParameters(parameters, limit.value);
  if (!normalized.ok) return normalized;
  const sourceTransformResult = validateTransform(
    source.transform ?? IDENTITY_TRANSFORM,
    "source.transform"
  );
  if (!sourceTransformResult.ok) return sourceTransformResult;

  let planned: StudioLinkedRepeatResult<readonly StudioLinkedRepeatInstance[]>;
  if (normalized.value.mode === "grid") {
    planned = planGridInstances(source.id, sourceTransformResult.value, normalized.value);
  } else if (normalized.value.mode === "radial") {
    planned = planRadialInstances(source.id, sourceTransformResult.value, normalized.value);
  } else {
    planned = planMirrorInstances(source.id, sourceTransformResult.value, normalized.value);
  }
  if (!planned.ok) return planned;

  return success(Object.freeze({
    version: STUDIO_LINKED_REPEAT_VERSION,
    repeatId: normalized.value.repeatId,
    sourceId: source.id,
    mode: normalized.value.mode,
    sourceTransform: sourceTransformResult.value,
    parameters: normalized.value,
    instances: planned.value,
  }));
}

function handleMode(handle: StudioLinkedRepeatHandleChange["kind"]): "grid" | "radial" | "mirror" | null {
  if (handle.startsWith("grid-")) return "grid";
  if (handle.startsWith("radial-")) return "radial";
  if (handle.startsWith("mirror-")) return "mirror";
  return null;
}

function handleDelta(change: StudioLinkedRepeatHandleChange): StudioLinkedRepeatPatchDelta {
  switch (change.kind) {
    case "grid-count":
      return { rows: change.rows, columns: change.columns };
    case "grid-spacing":
      return { spacingX: change.spacingX, spacingY: change.spacingY };
    case "grid-layout":
      return {
        gridType: change.gridType,
        flipRows: change.flipRows,
        flipColumns: change.flipColumns,
      };
    case "radial-count":
      return { count: change.count };
    case "radial-radius":
      return { radius: change.radius };
    case "radial-arc":
      return {
        centerX: change.centerX,
        centerY: change.centerY,
        startAngleDegrees: change.startAngleDegrees,
        sweepAngleDegrees: change.sweepAngleDegrees,
      };
    case "radial-overlap":
      return { reverseOverlap: change.reverseOverlap };
    case "radial-orientation":
      return { rotateInstances: change.rotateInstances };
    case "mirror-axis":
      return {
        axisX: change.axisX,
        axisY: change.axisY,
        angleDegrees: change.angleDegrees,
      };
    case "mirror-spacing":
      return { spacing: change.spacing };
    case "transform-space":
      return { transformSpace: change.transformSpace };
  }
}

function valuesForFields(
  parameters: StudioLinkedRepeatParameters,
  fields: readonly string[]
): StudioLinkedRepeatPatchDelta {
  const values: Record<string, StudioLinkedRepeatPatchValue> = {};
  const record = parameters as unknown as Readonly<Record<string, unknown>>;
  for (const field of fields) {
    const value = record[field];
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      values[field] = value;
    }
  }
  return Object.freeze(values);
}

/**
 * Converts one on-canvas handle state into a reversible, history-coalescible parameter patch.
 * The full before/after snapshots make undo independent of future default changes.
 */
export function createStudioLinkedRepeatHandlePatch(
  current: StudioLinkedRepeatParameters,
  change: StudioLinkedRepeatHandleChange
): StudioLinkedRepeatResult<StudioLinkedRepeatParameterPatch> {
  const currentResult = normalizeParameters(current, STUDIO_LINKED_REPEAT_MAX_INSTANCES);
  if (!currentResult.ok) return currentResult;
  const requiredMode = handleMode(change.kind);
  if (requiredMode !== null && requiredMode !== currentResult.value.mode) {
    return failure(
      "handle-mode-mismatch",
      `${change.kind} cannot edit a ${currentResult.value.mode} repeat.`,
      "handle"
    );
  }
  const requestedDelta = handleDelta(change);
  const candidate = {
    ...currentResult.value,
    ...requestedDelta,
  } as StudioLinkedRepeatParameters;
  const afterResult = normalizeParameters(candidate, STUDIO_LINKED_REPEAT_MAX_INSTANCES);
  if (!afterResult.ok) return afterResult;
  const beforeRecord = currentResult.value as unknown as Readonly<Record<string, unknown>>;
  const afterRecord = afterResult.value as unknown as Readonly<Record<string, unknown>>;
  const changedFields = Object.keys(requestedDelta).filter(
    (field) => !Object.is(beforeRecord[field], afterRecord[field])
  );
  const forward = valuesForFields(afterResult.value, changedFields);
  const inverse = valuesForFields(currentResult.value, changedFields);
  return success(Object.freeze({
    kind: "studio-linked-repeat-parameter-patch",
    repeatId: currentResult.value.repeatId,
    mode: currentResult.value.mode,
    handle: change.kind,
    coalesceKey: `${currentResult.value.repeatId}:handle:${change.kind}`,
    changedFields: Object.freeze(changedFields),
    before: currentResult.value,
    after: afterResult.value,
    forward,
    inverse,
  }));
}

function patchMatchesCurrent(
  current: StudioLinkedRepeatParameters,
  expected: StudioLinkedRepeatParameters,
  fields: readonly string[]
): boolean {
  const currentRecord = current as unknown as Readonly<Record<string, unknown>>;
  const expectedRecord = expected as unknown as Readonly<Record<string, unknown>>;
  return fields.every((field) => Object.is(currentRecord[field], expectedRecord[field]));
}

/** Applies a patch strictly: stale or cross-repeat history entries fail closed. */
export function applyStudioLinkedRepeatParameterPatch(
  current: StudioLinkedRepeatParameters,
  patch: StudioLinkedRepeatParameterPatch,
  direction: "forward" | "inverse"
): StudioLinkedRepeatResult<StudioLinkedRepeatParameters> {
  const currentResult = normalizeParameters(current, STUDIO_LINKED_REPEAT_MAX_INSTANCES);
  if (!currentResult.ok) return currentResult;
  if (
    patch.kind !== "studio-linked-repeat-parameter-patch"
    || patch.repeatId !== currentResult.value.repeatId
    || patch.mode !== currentResult.value.mode
  ) {
    return failure("patch-mismatch", "Patch belongs to another repeat.", "patch");
  }
  const expected = direction === "forward" ? patch.before : patch.after;
  if (!patchMatchesCurrent(currentResult.value, expected, patch.changedFields)) {
    return failure("patch-mismatch", "Patch is stale for the current repeat state.", "patch");
  }
  const delta = direction === "forward" ? patch.forward : patch.inverse;
  return normalizeParameters(
    { ...currentResult.value, ...delta } as StudioLinkedRepeatParameters,
    STUDIO_LINKED_REPEAT_MAX_INSTANCES
  );
}

function sameTransform(
  left: StudioLinkedRepeatTransform,
  right: StudioLinkedRepeatTransform
): boolean {
  return left.a === right.a
    && left.b === right.b
    && left.c === right.c
    && left.d === right.d
    && left.e === right.e
    && left.f === right.f;
}

function isReference(value: unknown): value is object {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}

/**
 * Breaks the live link by baking each affine transform into a fresh geometry object.
 *
 * The adapter must return an independent value for every instance. Throwing, returning the
 * source object, or reusing an earlier result rejects the whole expansion with no partial output.
 */
export function expandStudioLinkedRepeat<TGeometry>(
  source: StudioLinkedRepeatSource<TGeometry>,
  plan: StudioLinkedRepeatPlan,
  cloneAndTransform: (
    geometry: TGeometry,
    transform: StudioLinkedRepeatTransform,
    instance: StudioLinkedRepeatInstance
  ) => TGeometry
): StudioLinkedRepeatResult<StudioLinkedRepeatExpansion<TGeometry>> {
  if (
    typeof source !== "object"
    || source === null
    || source.id !== plan.sourceId
    || plan.repeatId !== plan.parameters.repeatId
  ) {
    return failure("source-mismatch", "Source and repeat plan do not match.", "source.id");
  }
  const currentTransform = validateTransform(
    source.transform ?? IDENTITY_TRANSFORM,
    "source.transform"
  );
  if (!currentTransform.ok) return currentTransform;
  if (!sameTransform(currentTransform.value, plan.sourceTransform)) {
    return failure(
      "source-mismatch",
      "Source transform changed after planning; replan before expansion.",
      "source.transform"
    );
  }
  if (typeof cloneAndTransform !== "function") {
    return failure(
      "geometry-expansion-failed",
      "A clone-and-transform geometry adapter is required.",
      "cloneAndTransform"
    );
  }

  const seen = new WeakSet<object>();
  const expanded: StudioLinkedRepeatExpandedObject<TGeometry>[] = [];
  try {
    for (const instance of plan.instances) {
      const geometry = cloneAndTransform(source.geometry, instance.transform, instance);
      if (isReference(geometry)) {
        if (geometry === source.geometry || seen.has(geometry)) {
          return failure(
            "geometry-alias",
            "Expanded geometry must be independent for every instance.",
            "geometry"
          );
        }
        seen.add(geometry);
      }
      expanded.push(Object.freeze({
        id: `${plan.repeatId}:expanded:${instance.logicalIndex}`,
        sourceId: source.id,
        repeatId: plan.repeatId,
        linked: false,
        logicalIndex: instance.logicalIndex,
        paintIndex: instance.paintIndex,
        geometry,
      }));
    }
  } catch {
    return failure(
      "geometry-expansion-failed",
      "Geometry adapter failed; no partial expansion was returned.",
      "geometry"
    );
  }

  return success(Object.freeze({
    kind: "expanded-linked-repeat",
    repeatId: plan.repeatId,
    sourceId: source.id,
    objects: Object.freeze(expanded),
  }));
}

/** Shared affine point convention used by brush symmetry and object-repeat geometry adapters. */
export function transformStudioLinkedRepeatPoint(
  x: number,
  y: number,
  transform: StudioLinkedRepeatTransform
): readonly [number, number] {
  return transformStudioBrushSymmetryPoint(x, y, transform);
}
