/**
 * Persisted layout for the two drawing palettes that make up the desktop drawing dock.
 *
 * The model intentionally stores only durable presentation state. Active menus, focus, scroll
 * positions, pointer drags, and mobile-sheet state remain transient. Sizes are percentages rather
 * than pixels so a workspace can move between displays without restoring an off-screen palette.
 */

export const STUDIO_DRAWING_PALETTE_IDS = [
  "sub-tools",
  "tool-properties",
] as const;

export type StudioDrawingPaletteId = (typeof STUDIO_DRAWING_PALETTE_IDS)[number];
export type StudioDrawingPaletteMoveDirection = "up" | "down";
export type StudioDrawingPaletteLockKind = "position" | "height";

export const STUDIO_DRAWING_PALETTE_MIN_PERCENT = 20;
export const STUDIO_DRAWING_PALETTE_MAX_PERCENT = 80;

export interface StudioDrawingPaletteLockState {
  readonly position: boolean;
  readonly height: boolean;
}

export type StudioDrawingPaletteLocks = Readonly<
  Record<StudioDrawingPaletteId, StudioDrawingPaletteLockState>
>;

export interface StudioDrawingPaletteLayout {
  readonly order: readonly StudioDrawingPaletteId[];
  readonly collapsed: Readonly<Record<StudioDrawingPaletteId, boolean>>;
  readonly sizes: Readonly<Record<StudioDrawingPaletteId, number>>;
  /**
   * Optional only at the untrusted/migration boundary. Every normalized layout contains this
   * explicit immutable field, while pre-lock workspace snapshots migrate to both flags `false`.
   */
  readonly locks?: StudioDrawingPaletteLocks;
}

export interface StudioCanonicalDrawingPaletteLayout
  extends StudioDrawingPaletteLayout {
  readonly locks: StudioDrawingPaletteLocks;
}

const PALETTE_ID_SET = new Set<string>(STUDIO_DRAWING_PALETTE_IDS);
const CANONICAL_LAYOUTS = new WeakSet<object>();

function registerCanonicalLayout(
  layout: StudioCanonicalDrawingPaletteLayout,
): StudioCanonicalDrawingPaletteLayout {
  CANONICAL_LAYOUTS.add(layout);
  return layout;
}

export const DEFAULT_STUDIO_DRAWING_PALETTE_LAYOUT: StudioCanonicalDrawingPaletteLayout =
  registerCanonicalLayout(Object.freeze({
    order: Object.freeze([...STUDIO_DRAWING_PALETTE_IDS]),
    collapsed: Object.freeze({
      "sub-tools": false,
      "tool-properties": false,
    }),
    sizes: Object.freeze({
      "sub-tools": 36,
      "tool-properties": 64,
    }),
    locks: Object.freeze({
      "sub-tools": Object.freeze({
        position: false,
        height: false,
      }),
      "tool-properties": Object.freeze({
        position: false,
        height: false,
      }),
    }),
  }));

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Recognizes only layouts produced by this boundary. Frozen values reconstructed by storage still
 * pass through the allowlist once; accepting them by shape would need a larger duplicate validator
 * and risks treating accessor-backed input as trusted.
 */
function isCanonicalLayout(
  value: unknown,
): value is StudioCanonicalDrawingPaletteLayout {
  return isRecord(value) && CANONICAL_LAYOUTS.has(value);
}

function clampPercent(value: number): number {
  return Math.min(
    STUDIO_DRAWING_PALETTE_MAX_PERCENT,
    Math.max(STUDIO_DRAWING_PALETTE_MIN_PERCENT, Math.round(value)),
  );
}

function normalizeOrder(
  value: unknown,
  fallback: StudioDrawingPaletteLayout,
): readonly StudioDrawingPaletteId[] {
  const fallbackOrder = [
    ...fallback.order.filter(
      (id, index, order) => PALETTE_ID_SET.has(id) && order.indexOf(id) === index,
    ),
    ...STUDIO_DRAWING_PALETTE_IDS,
  ].filter((id, index, order) => order.indexOf(id) === index);
  const candidates = Array.isArray(value) ? value : fallbackOrder;
  const order = candidates.filter(
    (id, index): id is StudioDrawingPaletteId =>
      typeof id === "string" &&
      PALETTE_ID_SET.has(id) &&
      candidates.indexOf(id) === index,
  );
  for (const id of fallbackOrder) {
    if (!order.includes(id)) order.push(id);
  }
  return Object.freeze(order);
}

function finiteNonNegative(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : fallback;
}

function normalizeSizes(
  value: unknown,
  fallback: StudioDrawingPaletteLayout,
): Readonly<Record<StudioDrawingPaletteId, number>> {
  const candidate = isRecord(value) ? value : {};
  const fallbackSubTools = finiteNonNegative(
    fallback.sizes["sub-tools"],
    DEFAULT_STUDIO_DRAWING_PALETTE_LAYOUT.sizes["sub-tools"],
  );
  const fallbackToolProperties = finiteNonNegative(
    fallback.sizes["tool-properties"],
    DEFAULT_STUDIO_DRAWING_PALETTE_LAYOUT.sizes["tool-properties"],
  );
  let subTools = finiteNonNegative(candidate["sub-tools"], fallbackSubTools);
  let toolProperties = finiteNonNegative(
    candidate["tool-properties"],
    fallbackToolProperties,
  );
  let total = subTools + toolProperties;
  if (!Number.isFinite(total) || total <= 0) {
    subTools = DEFAULT_STUDIO_DRAWING_PALETTE_LAYOUT.sizes["sub-tools"];
    toolProperties =
      DEFAULT_STUDIO_DRAWING_PALETTE_LAYOUT.sizes["tool-properties"];
    total = subTools + toolProperties;
  }

  const normalizedSubTools = clampPercent((subTools / total) * 100);
  return Object.freeze({
    "sub-tools": normalizedSubTools,
    "tool-properties": 100 - normalizedSubTools,
  });
}

function normalizeLocks(value: unknown): StudioDrawingPaletteLocks {
  const candidate = isRecord(value) ? value : {};
  const normalized = Object.fromEntries(
    STUDIO_DRAWING_PALETTE_IDS.map((id) => {
      const lockCandidate = isRecord(candidate[id]) ? candidate[id] : {};
      return [
        id,
        Object.freeze({
          position:
            typeof lockCandidate.position === "boolean"
              ? lockCandidate.position
              : false,
          height:
            typeof lockCandidate.height === "boolean"
              ? lockCandidate.height
              : false,
        }),
      ];
    }),
  ) as Record<StudioDrawingPaletteId, StudioDrawingPaletteLockState>;
  return Object.freeze(normalized);
}

/**
 * Rebuilds the exact allowlist, removes duplicate/unknown IDs, appends missing palettes in fallback
 * order, migrates missing locks to false, and guarantees integer 20..80 shares summing to 100.
 */
export function normalizeStudioDrawingPaletteLayout(
  value: unknown,
  fallback: StudioDrawingPaletteLayout =
    DEFAULT_STUDIO_DRAWING_PALETTE_LAYOUT,
): StudioCanonicalDrawingPaletteLayout {
  if (isCanonicalLayout(value)) return value;

  const candidate = isRecord(value) ? value : {};
  const collapsedCandidate = isRecord(candidate.collapsed)
    ? candidate.collapsed
    : {};

  return registerCanonicalLayout(Object.freeze({
    order: normalizeOrder(candidate.order, fallback),
    collapsed: Object.freeze({
      "sub-tools":
        typeof collapsedCandidate["sub-tools"] === "boolean"
          ? collapsedCandidate["sub-tools"]
          : fallback.collapsed["sub-tools"],
      "tool-properties":
        typeof collapsedCandidate["tool-properties"] === "boolean"
          ? collapsedCandidate["tool-properties"]
          : fallback.collapsed["tool-properties"],
    }),
    sizes: normalizeSizes(candidate.sizes, fallback),
    locks: normalizeLocks(candidate.locks),
  }));
}

/**
 * Sets one palette's absolute percentage share. The other palette receives the exact complement,
 * so callers should pass `layout.order[0]` when wiring a separator between the ordered palettes.
 */
export function resizeStudioDrawingPalettes(
  layout: StudioDrawingPaletteLayout,
  firstId: StudioDrawingPaletteId,
  sizePercent: number,
): StudioCanonicalDrawingPaletteLayout {
  const normalized = normalizeStudioDrawingPaletteLayout(layout);
  if (
    !PALETTE_ID_SET.has(firstId) ||
    !Number.isFinite(sizePercent) ||
    STUDIO_DRAWING_PALETTE_IDS.some((id) => normalized.locks[id].height)
  ) {
    return normalized;
  }
  const secondId = STUDIO_DRAWING_PALETTE_IDS.find((id) => id !== firstId)!;
  const firstSize = clampPercent(sizePercent);
  return normalizeStudioDrawingPaletteLayout({
    ...normalized,
    sizes: {
      [firstId]: firstSize,
      [secondId]: 100 - firstSize,
    },
  });
}

export function toggleStudioDrawingPalette(
  layout: StudioDrawingPaletteLayout,
  id: StudioDrawingPaletteId,
): StudioCanonicalDrawingPaletteLayout {
  const normalized = normalizeStudioDrawingPaletteLayout(layout);
  if (!PALETTE_ID_SET.has(id)) return normalized;
  return normalizeStudioDrawingPaletteLayout({
    ...normalized,
    collapsed: {
      ...normalized.collapsed,
      [id]: !normalized.collapsed[id],
    },
  });
}

export function moveStudioDrawingPalette(
  layout: StudioDrawingPaletteLayout,
  id: StudioDrawingPaletteId,
  direction: StudioDrawingPaletteMoveDirection,
): StudioCanonicalDrawingPaletteLayout {
  const normalized = normalizeStudioDrawingPaletteLayout(layout);
  const index = normalized.order.indexOf(id);
  const targetIndex = direction === "up" ? index - 1 : index + 1;
  if (
    index < 0 ||
    (direction !== "up" && direction !== "down") ||
    targetIndex < 0 ||
    targetIndex >= normalized.order.length ||
    normalized.locks[id].position ||
    normalized.locks[normalized.order[targetIndex]!].position
  ) {
    return normalized;
  }
  const order = [...normalized.order];
  [order[index], order[targetIndex]] = [order[targetIndex]!, order[index]!];
  return normalizeStudioDrawingPaletteLayout({ ...normalized, order });
}

export function setStudioDrawingPaletteLock(
  layout: StudioDrawingPaletteLayout,
  id: StudioDrawingPaletteId,
  kind: StudioDrawingPaletteLockKind,
  locked: boolean,
): StudioCanonicalDrawingPaletteLayout {
  const normalized = normalizeStudioDrawingPaletteLayout(layout);
  if (
    !PALETTE_ID_SET.has(id) ||
    (kind !== "position" && kind !== "height") ||
    typeof locked !== "boolean" ||
    normalized.locks[id][kind] === locked
  ) {
    return normalized;
  }
  return normalizeStudioDrawingPaletteLayout({
    ...normalized,
    locks: {
      ...normalized.locks,
      [id]: {
        ...normalized.locks[id],
        [kind]: locked,
      },
    },
  });
}

export function toggleStudioDrawingPaletteLock(
  layout: StudioDrawingPaletteLayout,
  id: StudioDrawingPaletteId,
  kind: StudioDrawingPaletteLockKind,
): StudioCanonicalDrawingPaletteLayout {
  const normalized = normalizeStudioDrawingPaletteLayout(layout);
  if (
    !PALETTE_ID_SET.has(id) ||
    (kind !== "position" && kind !== "height")
  ) {
    return normalized;
  }
  return setStudioDrawingPaletteLock(
    normalized,
    id,
    kind,
    !normalized.locks[id][kind],
  );
}
