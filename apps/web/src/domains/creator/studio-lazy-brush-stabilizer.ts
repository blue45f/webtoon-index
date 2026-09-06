import { LazyBrush } from "lazy-brush";

export const STUDIO_LAZY_BRUSH_DEFAULT_RADIUS_CSS_PX = 30;
export const STUDIO_LAZY_BRUSH_MAX_RADIUS_CSS_PX = 512;
export const STUDIO_LAZY_BRUSH_MIN_COORDINATE_SCALE = 0.01;
export const STUDIO_LAZY_BRUSH_MAX_COORDINATE_SCALE = 64;

export type StudioLazyBrushPointerType = "mouse" | "pen" | "touch" | "unknown";

export interface StudioLazyBrushPointerPolicy {
  readonly mouse: boolean;
  readonly pen: boolean;
  readonly touch: boolean;
  readonly unknown: boolean;
}

export type StudioLazyBrushPointerPolicyInput =
  | "all"
  | "mouse-only"
  | "non-pen"
  | "none"
  | "pen-only"
  | Partial<StudioLazyBrushPointerPolicy>;

/**
 * Mouse and touch input benefit from a lazy radius by default. Pen input is deliberately opt-in:
 * most styluses already provide high-rate coalesced samples and applying an additional spatial
 * leash without an explicit artist choice makes the nib feel detached from the cursor.
 */
export const STUDIO_LAZY_BRUSH_DEFAULT_POINTER_POLICY =
  Object.freeze<StudioLazyBrushPointerPolicy>({
    mouse: true,
    pen: false,
    touch: true,
    unknown: true,
  });

export interface StudioLazyBrushStabilizerOptions {
  readonly enabled?: boolean;
  /** Perceived radius in screen CSS pixels, independent of document zoom. */
  readonly radiusCssPx?: number;
  /** Number of screen CSS pixels occupied by one document-coordinate pixel. */
  readonly coordinateScale?: number;
  /** 0 follows the radius boundary immediately; 1 approaches infinite friction. */
  readonly friction?: number;
  readonly pointerPolicy?: StudioLazyBrushPointerPolicyInput;
}

export interface StudioLazyBrushStabilizerSample {
  readonly x: number;
  readonly y: number;
  readonly pointerType?: StudioLazyBrushPointerType;
  /** A new pointer id starts a new stroke automatically instead of inheriting the prior leash. */
  readonly pointerId?: number;
}

export interface StudioLazyBrushNormalizedOptions {
  readonly enabled: boolean;
  readonly radiusCssPx: number;
  readonly coordinateScale: number;
  readonly radiusDocumentPx: number;
  readonly friction: number;
  readonly pointerPolicy: StudioLazyBrushPointerPolicy;
}

export interface StudioLazyBrushStabilizerResult {
  /** Immutable document-coordinate output suitable for immediate retention by a stroke planner. */
  readonly point: readonly [number, number];
  /** Latest raw pointer coordinate, useful for drawing a leash/guide. */
  readonly pointer: readonly [number, number];
  readonly accepted: boolean;
  readonly initialized: boolean;
  readonly firstPoint: boolean;
  readonly active: boolean;
  readonly moved: boolean;
  readonly pointerType: StudioLazyBrushPointerType;
  readonly pointerId: number | null;
  readonly radiusCssPx: number;
  readonly radiusDocumentPx: number;
  readonly friction: number;
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function normalizePointerType(value: unknown): StudioLazyBrushPointerType {
  return value === "mouse" || value === "pen" || value === "touch"
    ? value
    : "unknown";
}

function normalizePointerId(value: unknown): number | null {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 0
    ? value
    : null;
}

function frozenPoint(x: number, y: number): readonly [number, number] {
  const canonical = (value: number) => Math.abs(value) < 1e-12 ? 0 : value;
  return Object.freeze([canonical(x), canonical(y)] as [number, number]);
}

function normalizePointerPolicy(
  input: StudioLazyBrushPointerPolicyInput | undefined,
): StudioLazyBrushPointerPolicy {
  if (input === "all") {
    return Object.freeze({ mouse: true, pen: true, touch: true, unknown: true });
  }
  if (input === "mouse-only") {
    return Object.freeze({ mouse: true, pen: false, touch: false, unknown: false });
  }
  if (input === "non-pen") {
    return Object.freeze({ mouse: true, pen: false, touch: true, unknown: true });
  }
  if (input === "none") {
    return Object.freeze({ mouse: false, pen: false, touch: false, unknown: false });
  }
  if (input === "pen-only") {
    return Object.freeze({ mouse: false, pen: true, touch: false, unknown: false });
  }
  if (!input || typeof input !== "object") {
    return STUDIO_LAZY_BRUSH_DEFAULT_POINTER_POLICY;
  }
  return Object.freeze({
    mouse: input.mouse ?? STUDIO_LAZY_BRUSH_DEFAULT_POINTER_POLICY.mouse,
    pen: input.pen ?? STUDIO_LAZY_BRUSH_DEFAULT_POINTER_POLICY.pen,
    touch: input.touch ?? STUDIO_LAZY_BRUSH_DEFAULT_POINTER_POLICY.touch,
    unknown: input.unknown ?? STUDIO_LAZY_BRUSH_DEFAULT_POINTER_POLICY.unknown,
  });
}

export function normalizeStudioLazyBrushOptions(
  input: StudioLazyBrushStabilizerOptions = {},
): StudioLazyBrushNormalizedOptions {
  const radiusCssPx = clamp(
    finiteOr(input.radiusCssPx, STUDIO_LAZY_BRUSH_DEFAULT_RADIUS_CSS_PX),
    0,
    STUDIO_LAZY_BRUSH_MAX_RADIUS_CSS_PX,
  );
  const coordinateScale = clamp(
    finiteOr(input.coordinateScale, 1),
    STUDIO_LAZY_BRUSH_MIN_COORDINATE_SCALE,
    STUDIO_LAZY_BRUSH_MAX_COORDINATE_SCALE,
  );
  return Object.freeze({
    enabled: input.enabled !== false,
    radiusCssPx,
    coordinateScale,
    radiusDocumentPx: radiusCssPx / coordinateScale,
    friction: clamp(finiteOr(input.friction, 0), 0, 1),
    pointerPolicy: normalizePointerPolicy(input.pointerPolicy),
  });
}

export function shouldApplyStudioLazyBrush(
  pointerType: StudioLazyBrushPointerType,
  options: StudioLazyBrushNormalizedOptions,
): boolean {
  return options.enabled && options.pointerPolicy[pointerType];
}

/**
 * Stateful adapter around `lazy-brush` with immutable, prefix-stable outputs.
 *
 * The third-party class is intentionally contained here: renderers consume plain tuples and never
 * retain its mutable points. `update()` auto-starts on the first valid sample, while `reset()`
 * guarantees that a new stroke cannot inherit the preceding stroke's radius or trailing position.
 */
export class StudioLazyBrushStabilizer {
  private lazyBrush: LazyBrush | null = null;
  private pointerType: StudioLazyBrushPointerType = "unknown";
  private pointerId: number | null = null;
  private lastOptions = normalizeStudioLazyBrushOptions();

  get initialized(): boolean {
    return this.lazyBrush !== null;
  }

  reset(): void {
    this.lazyBrush = null;
    this.pointerType = "unknown";
    this.pointerId = null;
    this.lastOptions = normalizeStudioLazyBrushOptions();
  }

  begin(
    sample: StudioLazyBrushStabilizerSample,
    options: StudioLazyBrushStabilizerOptions = {},
  ): StudioLazyBrushStabilizerResult {
    const normalized = normalizeStudioLazyBrushOptions(options);
    if (!Number.isFinite(sample.x) || !Number.isFinite(sample.y)) {
      this.reset();
      return this.rejectedResult(normalized);
    }

    const pointerType = normalizePointerType(sample.pointerType);
    const pointerId = normalizePointerId(sample.pointerId);
    const active = shouldApplyStudioLazyBrush(pointerType, normalized);
    const point = { x: sample.x, y: sample.y };
    this.lazyBrush = new LazyBrush({
      enabled: active,
      initialPoint: point,
      // LazyBrush treats a constructor radius of 0 as its default. Set the exact normalized radius
      // immediately below so a zero-radius pass-through remains valid.
      radius: normalized.radiusDocumentPx || 1,
    });
    this.lazyBrush.setRadius(normalized.radiusDocumentPx);
    this.pointerType = pointerType;
    this.pointerId = pointerId;
    this.lastOptions = normalized;
    return this.result({
      accepted: true,
      firstPoint: true,
      active,
      moved: false,
      options: normalized,
    });
  }

  update(
    sample: StudioLazyBrushStabilizerSample,
    options: StudioLazyBrushStabilizerOptions = {},
  ): StudioLazyBrushStabilizerResult {
    const normalized = normalizeStudioLazyBrushOptions(options);
    if (!Number.isFinite(sample.x) || !Number.isFinite(sample.y)) {
      return this.rejectedResult(normalized);
    }

    const pointerType = normalizePointerType(sample.pointerType);
    const pointerId = normalizePointerId(sample.pointerId);
    if (
      !this.lazyBrush
      || pointerType !== this.pointerType
      || (pointerId !== null && this.pointerId !== null && pointerId !== this.pointerId)
    ) {
      return this.begin(sample, options);
    }

    const active = shouldApplyStudioLazyBrush(pointerType, normalized);
    this.configure(active, normalized.radiusDocumentPx);
    const before = this.lazyBrush.getBrushCoordinates();

    if (active && normalized.radiusDocumentPx <= 0) {
      this.lazyBrush.update(sample, { both: true });
    } else if (active) {
      if (normalized.friction <= 0) {
        this.lazyBrush.update(sample);
      } else {
        // lazy-brush 2.x interprets exactly `1` as an omitted value. Keep the public meaning
        // (effectively infinite friction) without triggering that dependency edge case.
        const dependencyFriction = normalized.friction >= 1
          ? 1 - Number.EPSILON
          : normalized.friction;
        this.lazyBrush.update(sample, { friction: dependencyFriction });
      }
    } else {
      this.lazyBrush.update(sample);
    }

    const after = this.lazyBrush.getBrushCoordinates();
    this.pointerType = pointerType;
    this.pointerId = pointerId;
    this.lastOptions = normalized;
    return this.result({
      accepted: true,
      firstPoint: false,
      active,
      moved: before.x !== after.x || before.y !== after.y,
      options: normalized,
    });
  }

  /**
   * Resolves the intentional lazy-radius trail to the latest raw endpoint on pointer-up.
   * The returned endpoint is a new immutable value and cannot revise earlier emitted samples.
   */
  flush(): StudioLazyBrushStabilizerResult | null {
    if (!this.lazyBrush) return null;
    const before = this.lazyBrush.getBrushCoordinates();
    const pointer = this.lazyBrush.getPointerCoordinates();
    this.lazyBrush.update(pointer, { both: true });
    const after = this.lazyBrush.getBrushCoordinates();
    return this.result({
      accepted: true,
      firstPoint: false,
      active: shouldApplyStudioLazyBrush(this.pointerType, this.lastOptions),
      moved: before.x !== after.x || before.y !== after.y,
      options: this.lastOptions,
    });
  }

  private configure(active: boolean, radiusDocumentPx: number): void {
    if (!this.lazyBrush) return;
    this.lazyBrush.setRadius(radiusDocumentPx);
    if (active) this.lazyBrush.enable();
    else this.lazyBrush.disable();
  }

  private rejectedResult(
    options: StudioLazyBrushNormalizedOptions,
  ): StudioLazyBrushStabilizerResult {
    if (this.lazyBrush) {
      return this.result({
        accepted: false,
        firstPoint: false,
        active: shouldApplyStudioLazyBrush(this.pointerType, options),
        moved: false,
        options,
      });
    }
    return Object.freeze({
      point: frozenPoint(0, 0),
      pointer: frozenPoint(0, 0),
      accepted: false,
      initialized: false,
      firstPoint: false,
      active: false,
      moved: false,
      pointerType: "unknown",
      pointerId: null,
      radiusCssPx: options.radiusCssPx,
      radiusDocumentPx: options.radiusDocumentPx,
      friction: options.friction,
    });
  }

  private result(input: {
    readonly accepted: boolean;
    readonly firstPoint: boolean;
    readonly active: boolean;
    readonly moved: boolean;
    readonly options: StudioLazyBrushNormalizedOptions;
  }): StudioLazyBrushStabilizerResult {
    const brush = this.lazyBrush?.getBrushCoordinates() ?? { x: 0, y: 0 };
    const pointer = this.lazyBrush?.getPointerCoordinates() ?? brush;
    return Object.freeze({
      point: frozenPoint(brush.x, brush.y),
      pointer: frozenPoint(pointer.x, pointer.y),
      accepted: input.accepted,
      initialized: this.lazyBrush !== null,
      firstPoint: input.firstPoint,
      active: input.active,
      moved: input.moved,
      pointerType: this.pointerType,
      pointerId: this.pointerId,
      radiusCssPx: input.options.radiusCssPx,
      radiusDocumentPx: input.options.radiusDocumentPx,
      friction: input.options.friction,
    });
  }
}

export function createStudioLazyBrushStabilizer(): StudioLazyBrushStabilizer {
  return new StudioLazyBrushStabilizer();
}
