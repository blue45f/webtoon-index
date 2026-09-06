/**
 * Device-local, role-scoped placement persistence for detached Studio companion windows.
 *
 * This model deliberately excludes session, account, project, document, and display-label data.
 * It stores an outer-window size plus a screen-local anchor, then requires one unambiguous
 * topology match before converting that anchor back to global multi-screen coordinates.
 */

export const STUDIO_COMPANION_WINDOW_LAYOUT_VERSION = 1 as const;
export const STUDIO_COMPANION_WINDOW_LAYOUT_KIND =
  "toonspectrum.studio.companion-window-layout" as const;
export const STUDIO_COMPANION_WINDOW_LAYOUT_STORAGE_PREFIX =
  "toonspectrum.studio.companion-window-layout.v1";
export const STUDIO_COMPANION_WINDOW_LAYOUT_MAX_RAW_BYTES = 4 * 1024;
export const STUDIO_COMPANION_WINDOW_LAYOUT_MAX_AGE_MS = 180 * 24 * 60 * 60 * 1_000;
export const STUDIO_COMPANION_WINDOW_LAYOUT_FUTURE_TOLERANCE_MS = 5 * 60 * 1_000;

export const STUDIO_COMPANION_WINDOW_LAYOUT_SURFACES = [
  "workspace",
  "navigator",
  "review",
  "reference",
] as const;

export type StudioCompanionWindowLayoutSurface =
  (typeof STUDIO_COMPANION_WINDOW_LAYOUT_SURFACES)[number];

export type StudioCompanionWindowHorizontalSlot = "left" | "overlap" | "right";
export type StudioCompanionWindowVerticalSlot = "above" | "overlap" | "below";

export interface StudioCompanionWindowScreenHint {
  readonly availWidth: number;
  readonly availHeight: number;
  readonly devicePixelRatio: number | null;
  readonly isPrimary: boolean | null;
  readonly isInternal: boolean | null;
  readonly horizontalSlot: StudioCompanionWindowHorizontalSlot | null;
  readonly verticalSlot: StudioCompanionWindowVerticalSlot | null;
  readonly relativeCenterX: number | null;
  readonly relativeCenterY: number | null;
}

/**
 * A label-free, origin-independent description of one display in the complete topology.
 * Coordinates are relative to the unique primary display when available, otherwise to the
 * topology's upper-left bound. This avoids retaining global desktop coordinates.
 */
export interface StudioCompanionWindowTopologyScreenSignature {
  readonly relativeLeft: number;
  readonly relativeTop: number;
  readonly availWidth: number;
  readonly availHeight: number;
  readonly devicePixelRatio: number | null;
  readonly isPrimary: boolean | null;
  readonly isInternal: boolean | null;
}

export interface StudioCompanionWindowLayoutV1 {
  readonly kind: typeof STUDIO_COMPANION_WINDOW_LAYOUT_KIND;
  readonly version: typeof STUDIO_COMPANION_WINDOW_LAYOUT_VERSION;
  readonly surface: StudioCompanionWindowLayoutSurface;
  readonly savedAt: number;
  readonly outerSize: {
    readonly width: number;
    readonly height: number;
  };
  readonly localAnchor: {
    readonly xRatio: number;
    readonly yRatio: number;
  };
  readonly screenHint: StudioCompanionWindowScreenHint;
  /** Canonically sorted signature for every display observed when this layout was captured. */
  readonly displayTopology: readonly StudioCompanionWindowTopologyScreenSignature[];
}

export interface StudioCompanionWindowScreenLike {
  readonly availLeft: number;
  readonly availTop: number;
  readonly availWidth: number;
  readonly availHeight: number;
  readonly devicePixelRatio: number | null;
  readonly isPrimary: boolean | null;
  readonly isInternal: boolean | null;
}

export interface StudioCompanionWindowPlacement {
  readonly surface: StudioCompanionWindowLayoutSurface;
  readonly left: number;
  readonly top: number;
  /** Outer browser-window width, suitable for Window.resizeTo(). */
  readonly width: number;
  /** Outer browser-window height, suitable for Window.resizeTo(). */
  readonly height: number;
  readonly screen: StudioCompanionWindowScreenLike;
}

export interface StudioCompanionWindowLayoutStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export type StudioCompanionWindowLayoutPersistenceFailure =
  | "storage-unavailable"
  | "read-failed"
  | "write-failed"
  | "verification-failed"
  | "invalid-payload"
  | "payload-too-large";

export type StudioCompanionWindowLayoutLoadResult =
  | {
      readonly status: "persisted";
      readonly layout: StudioCompanionWindowLayoutV1;
      readonly failure: null;
    }
  | {
      readonly status: "missing";
      readonly layout: null;
      readonly failure: null;
    }
  | {
      readonly status: "session-only";
      readonly layout: null;
      readonly failure: StudioCompanionWindowLayoutPersistenceFailure;
    };

export type StudioCompanionWindowLayoutSaveResult =
  | {
      readonly status: "persisted";
      readonly layout: StudioCompanionWindowLayoutV1;
      readonly failure: null;
    }
  | {
      readonly status: "session-only";
      readonly layout: StudioCompanionWindowLayoutV1 | null;
      readonly failure: StudioCompanionWindowLayoutPersistenceFailure;
    };

export type StudioCompanionWindowLayoutClearResult =
  | { readonly status: "cleared"; readonly failure: null }
  | {
      readonly status: "session-only";
      readonly failure: StudioCompanionWindowLayoutPersistenceFailure;
    };

export interface StudioCompanionWindowMetricsLike {
  readonly screenX: number;
  readonly screenY: number;
  readonly outerWidth: number;
  readonly outerHeight: number;
}

export interface StudioCompanionWindowLayoutTimeOptions {
  readonly now?: number;
  readonly maximumAgeMs?: number;
  readonly futureToleranceMs?: number;
}

const SURFACE_SET = new Set<string>(STUDIO_COMPANION_WINDOW_LAYOUT_SURFACES);
const HORIZONTAL_SLOT_SET = new Set<string>(["left", "overlap", "right"]);
const VERTICAL_SLOT_SET = new Set<string>(["above", "overlap", "below"]);

const SCREEN_MAX_ABSOLUTE_COORDINATE = 1_000_000;
const SCREEN_MAX_RELATIVE_COORDINATE = SCREEN_MAX_ABSOLUTE_COORDINATE * 2;
const SCREEN_MAX_DIMENSION = 100_000;
const SCREEN_MAX_COUNT = 16;
const WINDOW_MIN_DIMENSION = 100;
const WINDOW_MAX_DIMENSION = 16_384;
const SCREEN_DIMENSION_RELATIVE_TOLERANCE = 0.2;
const SCREEN_DPR_ABSOLUTE_TOLERANCE = 0.26;
const SCREEN_RELATIVE_CENTER_TOLERANCE = 0.35;
const MATCH_SCORE_EPSILON = 1e-6;

const LAYOUT_KEYS = [
  "kind",
  "version",
  "surface",
  "savedAt",
  "outerSize",
  "localAnchor",
  "screenHint",
  "displayTopology",
] as const;
const OUTER_SIZE_KEYS = ["width", "height"] as const;
const LOCAL_ANCHOR_KEYS = ["xRatio", "yRatio"] as const;
const SCREEN_HINT_KEYS = [
  "availWidth",
  "availHeight",
  "devicePixelRatio",
  "isPrimary",
  "isInternal",
  "horizontalSlot",
  "verticalSlot",
  "relativeCenterX",
  "relativeCenterY",
] as const;
const TOPOLOGY_SCREEN_KEYS = [
  "relativeLeft",
  "relativeTop",
  "availWidth",
  "availHeight",
  "devicePixelRatio",
  "isPrimary",
  "isInternal",
] as const;

const SURFACE_MINIMUM_OUTER_SIZE: Readonly<
  Record<StudioCompanionWindowLayoutSurface, { width: number; height: number }>
> = Object.freeze({
  workspace: Object.freeze({ width: 360, height: 480 }),
  navigator: Object.freeze({ width: 320, height: 360 }),
  review: Object.freeze({ width: 360, height: 480 }),
  reference: Object.freeze({ width: 320, height: 360 }),
});

function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function hasExactKeys(record: Record<string, unknown>, expected: readonly string[]): boolean {
  try {
    const keys = Reflect.ownKeys(record);
    return keys.length === expected.length
      && keys.every((key) => typeof key === "string" && expected.includes(key));
  } catch {
    return false;
  }
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function finiteInteger(value: unknown): value is number {
  return finite(value) && Number.isSafeInteger(value);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function rounded(value: number, precision = 4): number {
  const multiplier = 10 ** precision;
  return Math.round(value * multiplier) / multiplier;
}

function normalizedNow(value: unknown): number {
  return finiteInteger(value) && value >= 0 ? value : Date.now();
}

function boundedDuration(value: unknown, fallback: number): number {
  return finite(value) && value >= 0 ? Math.min(value, Number.MAX_SAFE_INTEGER) : fallback;
}

function timeBounds(options: StudioCompanionWindowLayoutTimeOptions = {}) {
  return {
    now: normalizedNow(options.now),
    maximumAgeMs: boundedDuration(options.maximumAgeMs, STUDIO_COMPANION_WINDOW_LAYOUT_MAX_AGE_MS),
    futureToleranceMs: boundedDuration(
      options.futureToleranceMs,
      STUDIO_COMPANION_WINDOW_LAYOUT_FUTURE_TOLERANCE_MS
    ),
  };
}

export function isStudioCompanionWindowLayoutSurface(
  value: unknown
): value is StudioCompanionWindowLayoutSurface {
  return typeof value === "string" && SURFACE_SET.has(value);
}

export function studioCompanionWindowLayoutStorageKey(
  surface: StudioCompanionWindowLayoutSurface
): string {
  if (!isStudioCompanionWindowLayoutSurface(surface)) {
    throw new TypeError("Unknown Studio companion window-layout surface");
  }
  return `${STUDIO_COMPANION_WINDOW_LAYOUT_STORAGE_PREFIX}.${surface}`;
}

function rawUtf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x7f) {
      bytes += 1;
    } else if (code <= 0x7ff) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
    if (bytes > STUDIO_COMPANION_WINDOW_LAYOUT_MAX_RAW_BYTES) return bytes;
  }
  return bytes;
}

function readProperty(record: object, key: string): unknown {
  try {
    return (record as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

function optionalBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : value === null ? null : null;
}

function normalizedDpr(value: unknown): number | null {
  return finite(value) && value >= 0.25 && value <= 16 ? rounded(value, 3) : null;
}

function sanitizeScreen(value: unknown): StudioCompanionWindowScreenLike | null {
  if (!value || (typeof value !== "object" && typeof value !== "function")) return null;
  const availLeft = readProperty(value, "availLeft");
  const availTop = readProperty(value, "availTop");
  const availWidth = readProperty(value, "availWidth");
  const availHeight = readProperty(value, "availHeight");
  if (
    !finite(availLeft)
    || !finite(availTop)
    || !finite(availWidth)
    || !finite(availHeight)
    || Math.abs(availLeft) > SCREEN_MAX_ABSOLUTE_COORDINATE
    || Math.abs(availTop) > SCREEN_MAX_ABSOLUTE_COORDINATE
    || availWidth < 1
    || availHeight < 1
    || availWidth > SCREEN_MAX_DIMENSION
    || availHeight > SCREEN_MAX_DIMENSION
    || Math.abs(availLeft + availWidth) > SCREEN_MAX_ABSOLUTE_COORDINATE
    || Math.abs(availTop + availHeight) > SCREEN_MAX_ABSOLUTE_COORDINATE
  ) return null;

  return Object.freeze({
    availLeft: rounded(availLeft),
    availTop: rounded(availTop),
    availWidth: rounded(availWidth),
    availHeight: rounded(availHeight),
    devicePixelRatio: normalizedDpr(readProperty(value, "devicePixelRatio")),
    isPrimary: optionalBoolean(readProperty(value, "isPrimary")),
    isInternal: optionalBoolean(readProperty(value, "isInternal")),
  });
}

function screenGeometryKey(screen: StudioCompanionWindowScreenLike): string {
  return `${screen.availLeft}:${screen.availTop}:${screen.availWidth}:${screen.availHeight}`;
}

function sanitizeScreens(values: readonly unknown[]): StudioCompanionWindowScreenLike[] | null {
  if (values.length < 1 || values.length > SCREEN_MAX_COUNT) return null;
  const screens: StudioCompanionWindowScreenLike[] = [];
  const geometryKeys = new Set<string>();
  for (const value of values) {
    const screen = sanitizeScreen(value);
    if (!screen) return null;
    const key = screenGeometryKey(screen);
    if (geometryKeys.has(key)) return null;
    geometryKeys.add(key);
    screens.push(screen);
  }
  return screens;
}

function sameScreenGeometry(
  left: StudioCompanionWindowScreenLike,
  right: StudioCompanionWindowScreenLike
): boolean {
  return screenGeometryKey(left) === screenGeometryKey(right);
}

function uniquePrimaryScreen(
  screens: readonly StudioCompanionWindowScreenLike[]
): StudioCompanionWindowScreenLike | null {
  const primaries = screens.filter((screen) => screen.isPrimary === true);
  return primaries.length === 1 ? primaries[0] ?? null : null;
}

function horizontalSlot(
  screen: StudioCompanionWindowScreenLike,
  anchor: StudioCompanionWindowScreenLike
): StudioCompanionWindowHorizontalSlot {
  if (screen.availLeft + screen.availWidth <= anchor.availLeft) return "left";
  if (screen.availLeft >= anchor.availLeft + anchor.availWidth) return "right";
  return "overlap";
}

function verticalSlot(
  screen: StudioCompanionWindowScreenLike,
  anchor: StudioCompanionWindowScreenLike
): StudioCompanionWindowVerticalSlot {
  if (screen.availTop + screen.availHeight <= anchor.availTop) return "above";
  if (screen.availTop >= anchor.availTop + anchor.availHeight) return "below";
  return "overlap";
}

function screenHint(
  screen: StudioCompanionWindowScreenLike,
  screens: readonly StudioCompanionWindowScreenLike[]
): StudioCompanionWindowScreenHint {
  const primary = uniquePrimaryScreen(screens);
  const screenCenterX = screen.availLeft + screen.availWidth / 2;
  const screenCenterY = screen.availTop + screen.availHeight / 2;
  const relativeCenterX = primary
    ? rounded(
        (screenCenterX - (primary.availLeft + primary.availWidth / 2))
          / Math.max(1, primary.availWidth)
      )
    : null;
  const relativeCenterY = primary
    ? rounded(
        (screenCenterY - (primary.availTop + primary.availHeight / 2))
          / Math.max(1, primary.availHeight)
      )
    : null;

  return Object.freeze({
    availWidth: screen.availWidth,
    availHeight: screen.availHeight,
    devicePixelRatio: screen.devicePixelRatio,
    isPrimary: screen.isPrimary,
    isInternal: screen.isInternal,
    horizontalSlot: primary ? horizontalSlot(screen, primary) : null,
    verticalSlot: primary ? verticalSlot(screen, primary) : null,
    relativeCenterX,
    relativeCenterY,
  });
}

function topologyGeometryKey(screen: StudioCompanionWindowTopologyScreenSignature): string {
  return [
    screen.relativeLeft,
    screen.relativeTop,
    screen.availWidth,
    screen.availHeight,
  ].join(":");
}

function topologyScreenKey(screen: StudioCompanionWindowTopologyScreenSignature): string {
  return [
    topologyGeometryKey(screen),
    screen.devicePixelRatio ?? "null",
    screen.isPrimary === null ? "null" : String(screen.isPrimary),
    screen.isInternal === null ? "null" : String(screen.isInternal),
  ].join(":");
}

function compareTopologyScreens(
  left: StudioCompanionWindowTopologyScreenSignature,
  right: StudioCompanionWindowTopologyScreenSignature
): number {
  const leftKey = topologyScreenKey(left);
  const rightKey = topologyScreenKey(right);
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

function createDisplayTopologySignature(
  screens: readonly StudioCompanionWindowScreenLike[]
): readonly StudioCompanionWindowTopologyScreenSignature[] | null {
  if (screens.length < 1 || screens.length > SCREEN_MAX_COUNT) return null;
  const primaries = screens.filter((screen) => screen.isPrimary === true);
  if (primaries.length > 1) return null;
  const primary = primaries[0] ?? null;
  const originLeft = primary?.availLeft ?? Math.min(...screens.map((screen) => screen.availLeft));
  const originTop = primary?.availTop ?? Math.min(...screens.map((screen) => screen.availTop));
  const geometryKeys = new Set<string>();
  const topology: StudioCompanionWindowTopologyScreenSignature[] = [];

  for (const screen of screens) {
    const signature = Object.freeze({
      relativeLeft: rounded(screen.availLeft - originLeft),
      relativeTop: rounded(screen.availTop - originTop),
      availWidth: screen.availWidth,
      availHeight: screen.availHeight,
      devicePixelRatio: screen.devicePixelRatio,
      isPrimary: screen.isPrimary,
      isInternal: screen.isInternal,
    });
    const geometryKey = topologyGeometryKey(signature);
    if (geometryKeys.has(geometryKey)) return null;
    geometryKeys.add(geometryKey);
    topology.push(signature);
  }

  topology.sort(compareTopologyScreens);
  return Object.freeze(topology);
}

function normalizedBooleanOrNull(value: unknown): boolean | null | undefined {
  return typeof value === "boolean" ? value : value === null ? null : undefined;
}

function normalizeDisplayTopologySignature(
  value: unknown,
  strictKeys: boolean
): readonly StudioCompanionWindowTopologyScreenSignature[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > SCREEN_MAX_COUNT) return null;
  const topology: StudioCompanionWindowTopologyScreenSignature[] = [];
  const geometryKeys = new Set<string>();
  let primaryCount = 0;

  for (const candidate of value) {
    if (!isRecord(candidate)) return null;
    if (strictKeys && !hasExactKeys(candidate, TOPOLOGY_SCREEN_KEYS)) return null;
    const relativeLeft = readProperty(candidate, "relativeLeft");
    const relativeTop = readProperty(candidate, "relativeTop");
    const availWidth = readProperty(candidate, "availWidth");
    const availHeight = readProperty(candidate, "availHeight");
    const rawDpr = readProperty(candidate, "devicePixelRatio");
    const isPrimary = normalizedBooleanOrNull(readProperty(candidate, "isPrimary"));
    const isInternal = normalizedBooleanOrNull(readProperty(candidate, "isInternal"));
    const devicePixelRatio = rawDpr === null ? null : normalizedDpr(rawDpr);
    if (
      !finite(relativeLeft)
      || !finite(relativeTop)
      || Math.abs(relativeLeft) > SCREEN_MAX_RELATIVE_COORDINATE
      || Math.abs(relativeTop) > SCREEN_MAX_RELATIVE_COORDINATE
      || !finite(availWidth)
      || !finite(availHeight)
      || availWidth < 1
      || availHeight < 1
      || availWidth > SCREEN_MAX_DIMENSION
      || availHeight > SCREEN_MAX_DIMENSION
      || (rawDpr !== null && devicePixelRatio === null)
      || isPrimary === undefined
      || isInternal === undefined
    ) return null;

    const signature = Object.freeze({
      relativeLeft: rounded(relativeLeft),
      relativeTop: rounded(relativeTop),
      availWidth: rounded(availWidth),
      availHeight: rounded(availHeight),
      devicePixelRatio,
      isPrimary,
      isInternal,
    });
    const geometryKey = topologyGeometryKey(signature);
    if (geometryKeys.has(geometryKey)) return null;
    geometryKeys.add(geometryKey);
    if (signature.isPrimary === true) primaryCount += 1;
    if (primaryCount > 1) return null;
    topology.push(signature);
  }

  const sorted = [...topology].sort(compareTopologyScreens);
  if (
    strictKeys
    && sorted.some((screen, index) => topologyScreenKey(screen) !== topologyScreenKey(topology[index]!))
  ) return null;
  return Object.freeze(sorted);
}

function displayTopologiesMatch(
  stored: readonly StudioCompanionWindowTopologyScreenSignature[],
  current: readonly StudioCompanionWindowTopologyScreenSignature[]
): boolean {
  return stored.length === current.length
    && stored.every((screen, index) => topologyScreenKey(screen) === topologyScreenKey(current[index]!));
}

function screenHintKey(hint: StudioCompanionWindowScreenHint): string {
  return [
    hint.availWidth,
    hint.availHeight,
    hint.devicePixelRatio ?? "null",
    hint.isPrimary === null ? "null" : String(hint.isPrimary),
    hint.isInternal === null ? "null" : String(hint.isInternal),
    hint.horizontalSlot ?? "null",
    hint.verticalSlot ?? "null",
    hint.relativeCenterX ?? "null",
    hint.relativeCenterY ?? "null",
  ].join(":");
}

function topologyHasUniqueScreenHint(
  topology: readonly StudioCompanionWindowTopologyScreenSignature[],
  hint: StudioCompanionWindowScreenHint
): boolean {
  const screens: StudioCompanionWindowScreenLike[] = topology.map((screen) => ({
    availLeft: screen.relativeLeft,
    availTop: screen.relativeTop,
    availWidth: screen.availWidth,
    availHeight: screen.availHeight,
    devicePixelRatio: screen.devicePixelRatio,
    isPrimary: screen.isPrimary,
    isInternal: screen.isInternal,
  }));
  const expectedKey = screenHintKey(hint);
  return screens.filter((screen) => screenHintKey(screenHint(screen, screens)) === expectedKey).length === 1;
}

function normalizedSlot<T extends string>(
  value: unknown,
  allowed: ReadonlySet<string>
): T | null | undefined {
  if (value === null) return null;
  return typeof value === "string" && allowed.has(value) ? value as T : undefined;
}

function normalizeScreenHint(
  value: unknown,
  strictKeys: boolean
): StudioCompanionWindowScreenHint | null {
  if (!isRecord(value)) return null;
  if (strictKeys && !hasExactKeys(value, SCREEN_HINT_KEYS)) return null;
  const availWidth = readProperty(value, "availWidth");
  const availHeight = readProperty(value, "availHeight");
  const devicePixelRatio = readProperty(value, "devicePixelRatio");
  const isPrimary = readProperty(value, "isPrimary");
  const isInternal = readProperty(value, "isInternal");
  const horizontal = normalizedSlot<StudioCompanionWindowHorizontalSlot>(
    readProperty(value, "horizontalSlot"),
    HORIZONTAL_SLOT_SET
  );
  const vertical = normalizedSlot<StudioCompanionWindowVerticalSlot>(
    readProperty(value, "verticalSlot"),
    VERTICAL_SLOT_SET
  );
  const relativeCenterX = readProperty(value, "relativeCenterX");
  const relativeCenterY = readProperty(value, "relativeCenterY");
  const topologyFieldsAreAllNull = horizontal === null
    && vertical === null
    && relativeCenterX === null
    && relativeCenterY === null;
  const topologyFieldsAreAllPresent = horizontal !== null
    && vertical !== null
    && relativeCenterX !== null
    && relativeCenterY !== null;
  if (
    !finite(availWidth)
    || !finite(availHeight)
    || availWidth < 1
    || availHeight < 1
    || availWidth > SCREEN_MAX_DIMENSION
    || availHeight > SCREEN_MAX_DIMENSION
    || (devicePixelRatio !== null && normalizedDpr(devicePixelRatio) === null)
    || (isPrimary !== null && typeof isPrimary !== "boolean")
    || (isInternal !== null && typeof isInternal !== "boolean")
    || horizontal === undefined
    || vertical === undefined
    || (relativeCenterX !== null && (!finite(relativeCenterX) || Math.abs(relativeCenterX) > 64))
    || (relativeCenterY !== null && (!finite(relativeCenterY) || Math.abs(relativeCenterY) > 64))
    || (!topologyFieldsAreAllNull && !topologyFieldsAreAllPresent)
  ) return null;

  return Object.freeze({
    availWidth: rounded(availWidth),
    availHeight: rounded(availHeight),
    devicePixelRatio: devicePixelRatio === null ? null : normalizedDpr(devicePixelRatio),
    isPrimary: isPrimary as boolean | null,
    isInternal: isInternal as boolean | null,
    horizontalSlot: horizontal,
    verticalSlot: vertical,
    relativeCenterX: relativeCenterX === null ? null : rounded(relativeCenterX),
    relativeCenterY: relativeCenterY === null ? null : rounded(relativeCenterY),
  });
}

function normalizeLayoutObject(
  value: unknown,
  expectedSurface: StudioCompanionWindowLayoutSurface,
  options: StudioCompanionWindowLayoutTimeOptions = {},
  strictKeys = false
): StudioCompanionWindowLayoutV1 | null {
  if (!isRecord(value)) return null;
  if (strictKeys && !hasExactKeys(value, LAYOUT_KEYS)) return null;
  const bounds = timeBounds(options);
  const kind = readProperty(value, "kind");
  const version = readProperty(value, "version");
  const surface = readProperty(value, "surface");
  const savedAt = readProperty(value, "savedAt");
  const outerSize = readProperty(value, "outerSize");
  const localAnchor = readProperty(value, "localAnchor");
  const hint = normalizeScreenHint(readProperty(value, "screenHint"), strictKeys);
  const displayTopology = normalizeDisplayTopologySignature(
    readProperty(value, "displayTopology"),
    strictKeys
  );
  if (
    kind !== STUDIO_COMPANION_WINDOW_LAYOUT_KIND
    || version !== STUDIO_COMPANION_WINDOW_LAYOUT_VERSION
    || surface !== expectedSurface
    || !finiteInteger(savedAt)
    || savedAt < 0
    || savedAt > bounds.now + bounds.futureToleranceMs
    || bounds.now - savedAt > bounds.maximumAgeMs
    || !isRecord(outerSize)
    || !isRecord(localAnchor)
    || !hint
    || !displayTopology
    || !topologyHasUniqueScreenHint(displayTopology, hint)
    || (strictKeys && !hasExactKeys(outerSize, OUTER_SIZE_KEYS))
    || (strictKeys && !hasExactKeys(localAnchor, LOCAL_ANCHOR_KEYS))
  ) return null;

  const width = readProperty(outerSize, "width");
  const height = readProperty(outerSize, "height");
  const xRatio = readProperty(localAnchor, "xRatio");
  const yRatio = readProperty(localAnchor, "yRatio");
  if (
    !finite(width)
    || !finite(height)
    || width < WINDOW_MIN_DIMENSION
    || height < WINDOW_MIN_DIMENSION
    || width > WINDOW_MAX_DIMENSION
    || height > WINDOW_MAX_DIMENSION
    || !finite(xRatio)
    || !finite(yRatio)
    || xRatio < 0
    || xRatio > 1
    || yRatio < 0
    || yRatio > 1
  ) return null;

  return Object.freeze({
    kind: STUDIO_COMPANION_WINDOW_LAYOUT_KIND,
    version: STUDIO_COMPANION_WINDOW_LAYOUT_VERSION,
    surface: expectedSurface,
    savedAt,
    outerSize: Object.freeze({ width: Math.round(width), height: Math.round(height) }),
    localAnchor: Object.freeze({ xRatio: rounded(xRatio), yRatio: rounded(yRatio) }),
    screenHint: hint,
    displayTopology,
  });
}

export function parseStudioCompanionWindowLayout(
  raw: string,
  expectedSurface: StudioCompanionWindowLayoutSurface,
  options: StudioCompanionWindowLayoutTimeOptions = {}
): StudioCompanionWindowLayoutV1 | null {
  if (
    typeof raw !== "string"
    || !isStudioCompanionWindowLayoutSurface(expectedSurface)
    || rawUtf8ByteLength(raw) > STUDIO_COMPANION_WINDOW_LAYOUT_MAX_RAW_BYTES
  ) return null;
  try {
    return normalizeLayoutObject(JSON.parse(raw) as unknown, expectedSurface, options, true);
  } catch {
    return null;
  }
}

export function loadStudioCompanionWindowLayout(
  storage: Pick<StudioCompanionWindowLayoutStorage, "getItem"> | null | undefined,
  surface: StudioCompanionWindowLayoutSurface,
  options: StudioCompanionWindowLayoutTimeOptions = {}
): StudioCompanionWindowLayoutLoadResult {
  if (!storage) {
    return Object.freeze({ status: "session-only", layout: null, failure: "storage-unavailable" });
  }
  let raw: string | null;
  try {
    raw = storage.getItem(studioCompanionWindowLayoutStorageKey(surface));
  } catch {
    return Object.freeze({ status: "session-only", layout: null, failure: "read-failed" });
  }
  if (raw === null) return Object.freeze({ status: "missing", layout: null, failure: null });
  const layout = parseStudioCompanionWindowLayout(raw, surface, options);
  return layout
    ? Object.freeze({ status: "persisted", layout, failure: null })
    : Object.freeze({ status: "session-only", layout: null, failure: "invalid-payload" });
}

export function saveStudioCompanionWindowLayout(
  storage: StudioCompanionWindowLayoutStorage | null | undefined,
  surface: StudioCompanionWindowLayoutSurface,
  candidate: unknown,
  options: StudioCompanionWindowLayoutTimeOptions = {}
): StudioCompanionWindowLayoutSaveResult {
  const layout = normalizeLayoutObject(candidate, surface, options);
  if (!layout) {
    return Object.freeze({ status: "session-only", layout: null, failure: "invalid-payload" });
  }
  if (!storage) {
    return Object.freeze({ status: "session-only", layout, failure: "storage-unavailable" });
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(layout);
  } catch {
    return Object.freeze({ status: "session-only", layout: null, failure: "invalid-payload" });
  }
  if (rawUtf8ByteLength(serialized) > STUDIO_COMPANION_WINDOW_LAYOUT_MAX_RAW_BYTES) {
    return Object.freeze({ status: "session-only", layout, failure: "payload-too-large" });
  }
  const key = studioCompanionWindowLayoutStorageKey(surface);
  try {
    storage.setItem(key, serialized);
  } catch {
    return Object.freeze({ status: "session-only", layout, failure: "write-failed" });
  }
  try {
    if (storage.getItem(key) !== serialized) {
      return Object.freeze({ status: "session-only", layout, failure: "verification-failed" });
    }
  } catch {
    return Object.freeze({ status: "session-only", layout, failure: "verification-failed" });
  }
  return Object.freeze({ status: "persisted", layout, failure: null });
}

export function clearStudioCompanionWindowLayout(
  storage: StudioCompanionWindowLayoutStorage | null | undefined,
  surface: StudioCompanionWindowLayoutSurface
): StudioCompanionWindowLayoutClearResult {
  if (!storage?.removeItem) {
    return Object.freeze({ status: "session-only", failure: "storage-unavailable" });
  }
  const key = studioCompanionWindowLayoutStorageKey(surface);
  try {
    storage.removeItem(key);
  } catch {
    return Object.freeze({ status: "session-only", failure: "write-failed" });
  }
  try {
    return storage.getItem(key) === null
      ? Object.freeze({ status: "cleared", failure: null })
      : Object.freeze({ status: "session-only", failure: "verification-failed" });
  } catch {
    return Object.freeze({ status: "session-only", failure: "verification-failed" });
  }
}

function findCaptureScreen(
  screens: readonly StudioCompanionWindowScreenLike[],
  currentScreen: unknown,
  metrics: StudioCompanionWindowMetricsLike
): StudioCompanionWindowScreenLike | null {
  const current = sanitizeScreen(currentScreen);
  const currentMatches = current
    ? screens.filter((screen) => sameScreenGeometry(screen, current))
    : [];
  const uniqueCurrent = currentMatches.length === 1 ? currentMatches[0] ?? null : null;

  const windowRight = metrics.screenX + metrics.outerWidth;
  const windowBottom = metrics.screenY + metrics.outerHeight;
  let maximumArea = 0;
  let matches: StudioCompanionWindowScreenLike[] = [];
  for (const screen of screens) {
    const intersectionWidth = Math.max(
      0,
      Math.min(windowRight, screen.availLeft + screen.availWidth)
        - Math.max(metrics.screenX, screen.availLeft)
    );
    const intersectionHeight = Math.max(
      0,
      Math.min(windowBottom, screen.availTop + screen.availHeight)
        - Math.max(metrics.screenY, screen.availTop)
    );
    const area = intersectionWidth * intersectionHeight;
    if (area > maximumArea) {
      maximumArea = area;
      matches = [screen];
    } else if (area > 0 && area === maximumArea) {
      matches.push(screen);
    }
  }
  if (maximumArea <= 0) return null;
  if (matches.length === 1) return matches[0] ?? null;
  // ScreenDetails.currentScreen may lag while a titlebar drag crosses displays. It can only
  // disambiguate screens that share the same maximum observed window intersection.
  return uniqueCurrent && matches.some((screen) => sameScreenGeometry(screen, uniqueCurrent))
    ? uniqueCurrent
    : null;
}

function readWindowMetrics(value: unknown): StudioCompanionWindowMetricsLike | null {
  if (!value || (typeof value !== "object" && typeof value !== "function")) return null;
  try {
    const candidate = value as Partial<StudioCompanionWindowMetricsLike>;
    const { screenX, screenY, outerWidth, outerHeight } = candidate;
    if (
      !finite(screenX)
      || !finite(screenY)
      || !finite(outerWidth)
      || !finite(outerHeight)
      || Math.abs(screenX) > SCREEN_MAX_ABSOLUTE_COORDINATE
      || Math.abs(screenY) > SCREEN_MAX_ABSOLUTE_COORDINATE
      || outerWidth < 1
      || outerHeight < 1
      || outerWidth > WINDOW_MAX_DIMENSION
      || outerHeight > WINDOW_MAX_DIMENSION
    ) return null;
    return { screenX, screenY, outerWidth, outerHeight };
  } catch {
    return null;
  }
}

function clampOuterSize(
  surface: StudioCompanionWindowLayoutSurface,
  width: number,
  height: number,
  screen: StudioCompanionWindowScreenLike
): { width: number; height: number } {
  const minimum = SURFACE_MINIMUM_OUTER_SIZE[surface];
  const minimumWidth = Math.min(minimum.width, screen.availWidth);
  const minimumHeight = Math.min(minimum.height, screen.availHeight);
  return {
    width: Math.round(clamp(width, minimumWidth, screen.availWidth)),
    height: Math.round(clamp(height, minimumHeight, screen.availHeight)),
  };
}

export function captureStudioCompanionWindowLayout(input: {
  readonly surface: StudioCompanionWindowLayoutSurface;
  readonly windowMetrics: unknown;
  readonly screens: readonly unknown[];
  readonly currentScreen?: unknown;
  readonly now?: number;
}): StudioCompanionWindowLayoutV1 | null {
  if (!isStudioCompanionWindowLayoutSurface(input.surface) || !Array.isArray(input.screens)) {
    return null;
  }
  const metrics = readWindowMetrics(input.windowMetrics);
  if (!metrics) return null;
  const screens = sanitizeScreens(input.screens);
  if (!screens) return null;
  const displayTopology = createDisplayTopologySignature(screens);
  if (!displayTopology) return null;
  const screen = findCaptureScreen(screens, input.currentScreen, metrics);
  if (!screen) return null;
  const size = clampOuterSize(
    input.surface,
    metrics.outerWidth,
    metrics.outerHeight,
    screen
  );
  const horizontalTravel = Math.max(0, screen.availWidth - size.width);
  const verticalTravel = Math.max(0, screen.availHeight - size.height);
  const localLeft = clamp(metrics.screenX - screen.availLeft, 0, horizontalTravel);
  const localTop = clamp(metrics.screenY - screen.availTop, 0, verticalTravel);
  const layout: StudioCompanionWindowLayoutV1 = {
    kind: STUDIO_COMPANION_WINDOW_LAYOUT_KIND,
    version: STUDIO_COMPANION_WINDOW_LAYOUT_VERSION,
    surface: input.surface,
    savedAt: normalizedNow(input.now),
    outerSize: size,
    localAnchor: {
      xRatio: horizontalTravel > 0 ? rounded(localLeft / horizontalTravel) : 0,
      yRatio: verticalTravel > 0 ? rounded(localTop / verticalTravel) : 0,
    },
    screenHint: screenHint(screen, screens),
    displayTopology,
  };
  return normalizeLayoutObject(layout, input.surface, { now: layout.savedAt });
}

function relativeDifference(left: number, right: number): number {
  return Math.abs(left - right) / Math.max(1, Math.abs(left), Math.abs(right));
}

function screenMatchScore(
  stored: StudioCompanionWindowScreenHint,
  candidate: StudioCompanionWindowScreenHint
): number | null {
  if (stored.isPrimary !== null && stored.isPrimary !== candidate.isPrimary) return null;
  if (stored.isInternal !== null && stored.isInternal !== candidate.isInternal) return null;
  if (
    stored.horizontalSlot !== null
    && candidate.horizontalSlot !== stored.horizontalSlot
  ) return null;
  if (
    stored.verticalSlot !== null
    && candidate.verticalSlot !== stored.verticalSlot
  ) return null;

  const widthDifference = relativeDifference(stored.availWidth, candidate.availWidth);
  const heightDifference = relativeDifference(stored.availHeight, candidate.availHeight);
  if (
    widthDifference > SCREEN_DIMENSION_RELATIVE_TOLERANCE
    || heightDifference > SCREEN_DIMENSION_RELATIVE_TOLERANCE
  ) return null;

  let score = widthDifference + heightDifference;
  if (stored.devicePixelRatio !== null) {
    if (candidate.devicePixelRatio === null) return null;
    const difference = Math.abs(stored.devicePixelRatio - candidate.devicePixelRatio);
    if (difference > SCREEN_DPR_ABSOLUTE_TOLERANCE) return null;
    score += difference / SCREEN_DPR_ABSOLUTE_TOLERANCE;
  }

  if (stored.relativeCenterX !== null && stored.relativeCenterY !== null) {
    if (candidate.relativeCenterX === null || candidate.relativeCenterY === null) return null;
    const xDifference = Math.abs(stored.relativeCenterX - candidate.relativeCenterX);
    const yDifference = Math.abs(stored.relativeCenterY - candidate.relativeCenterY);
    if (
      xDifference > SCREEN_RELATIVE_CENTER_TOLERANCE
      || yDifference > SCREEN_RELATIVE_CENTER_TOLERANCE
    ) return null;
    score += xDifference + yDifference;
  }
  return score;
}

export function matchStudioCompanionWindowLayoutScreen(
  layout: StudioCompanionWindowLayoutV1,
  rawScreens: readonly unknown[]
): StudioCompanionWindowScreenLike | null {
  const screens = sanitizeScreens(rawScreens);
  if (!screens) return null;
  const currentTopology = createDisplayTopologySignature(screens);
  if (!currentTopology || !displayTopologiesMatch(layout.displayTopology, currentTopology)) return null;
  let bestScore = Number.POSITIVE_INFINITY;
  let bestScreens: StudioCompanionWindowScreenLike[] = [];
  for (const screen of screens) {
    const score = screenMatchScore(layout.screenHint, screenHint(screen, screens));
    if (score === null) continue;
    if (score + MATCH_SCORE_EPSILON < bestScore) {
      bestScore = score;
      bestScreens = [screen];
    } else if (Math.abs(score - bestScore) <= MATCH_SCORE_EPSILON) {
      bestScreens.push(screen);
    }
  }
  return bestScreens.length === 1 ? bestScreens[0] ?? null : null;
}

export function resolveStudioCompanionWindowPlacement(input: {
  readonly layout: unknown;
  readonly surface: StudioCompanionWindowLayoutSurface;
  readonly screens: readonly unknown[];
  readonly now?: number;
}): StudioCompanionWindowPlacement | null {
  if (!isStudioCompanionWindowLayoutSurface(input.surface) || !Array.isArray(input.screens)) {
    return null;
  }
  const layout = normalizeLayoutObject(input.layout, input.surface, { now: input.now }, true);
  if (!layout) return null;
  const screen = matchStudioCompanionWindowLayoutScreen(layout, input.screens);
  if (!screen) return null;
  const size = clampOuterSize(
    input.surface,
    layout.outerSize.width,
    layout.outerSize.height,
    screen
  );
  const horizontalTravel = Math.max(0, screen.availWidth - size.width);
  const verticalTravel = Math.max(0, screen.availHeight - size.height);
  const left = Math.round(screen.availLeft + layout.localAnchor.xRatio * horizontalTravel);
  const top = Math.round(screen.availTop + layout.localAnchor.yRatio * verticalTravel);
  return Object.freeze({
    surface: input.surface,
    left: clamp(left, screen.availLeft, screen.availLeft + horizontalTravel),
    top: clamp(top, screen.availTop, screen.availTop + verticalTravel),
    width: size.width,
    height: size.height,
    screen,
  });
}
