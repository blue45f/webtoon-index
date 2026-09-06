/**
 * Canonical semantic variants understood by each motion-coach visual.
 *
 * This object is the single source for both the closed kind catalog and the
 * kind/variant type contract. An empty tuple means the visual has only its
 * default presentation. Add a variant here before teaching a renderer or a
 * consumer about it so invalid cross-family pairings fail during typecheck.
 */
export const STUDIO_TOOL_HINT_PREVIEW_VARIANTS = {
  select: [],
  transform: [],
  pan: [],
  ink: [],
  "pixel-ink": [],
  erase: [],
  fill: [],
  sample: [],
  "color-palette": [
    "brush-shape",
    "bubble-fill",
    "recent-swatch",
    "palette-family",
    "palette-swatch",
    "palette-skin-natural",
    "palette-hair-natural",
    "palette-hair-vivid",
    "palette-sky-hours",
    "palette-nature-green",
    "palette-pastel-mood",
    "palette-neon-cyber",
    "palette-vintage-sepia",
    "palette-mono-ink",
    "palette-romance-pink",
    "palette-autumn-fall",
    "palette-dark-fantasy",
    "primary-color",
    "secondary-color",
    "swap-colors",
  ],
  shape: ["line", "rect", "ellipse", "star", "arrow", "triangle", "polygon"],
  "smart-shape": ["enable", "disable"],
  "shape-rect": [],
  "shape-ellipse": [],
  "shape-fill": ["enable", "disable"],
  text: [],
  bubble: ["add", "open-library", "fit-text"],
  comment: [],
  image: [],
  reference: [],
  filter: [
    "gaussian-blur",
    "motion-blur",
    "blur",
    "curves",
    "levels",
    "brightness-contrast",
    "hue-saturation",
    "color-balance",
    "channel-mixer",
    "gradient-map",
    "sharpen",
    "noise",
    "invert",
  ],
  smudge: [],
  liquify: [],
  lasso: [],
  "polygon-lasso": [],
  "selection-brush": [],
  "selection-replace": [],
  "selection-add": [],
  "selection-subtract": [],
  "selection-intersect": [],
  "selection-boundary": [
    "select-all",
    "clear",
    "invert",
    "remove-last-subpath",
    "expand",
    "contract",
  ],
  "selection-history": ["undo", "redo"],
  "selection-marquee-transform": [
    "rotate-custom",
    "rotate-cw-90",
    "rotate-ccw-90",
    "rotate-180",
    "flip-x",
    "flip-y",
    "scale-up",
    "scale-down",
    "translate-left",
    "translate-right",
    "translate-up",
    "translate-down",
  ],
  "selection-content-transform": [
    "apply-scale-rotate",
    "rotate-cw-90",
    "flip-x",
    "flip-y",
    "delete",
    "content-aware-fill",
  ],
  "selection-adjust": ["brightness", "hue"],
  "selection-layout": [
    "group",
    "align-left",
    "align-hcenter",
    "align-right",
    "align-top",
    "align-vcenter",
    "align-bottom",
    "distribute-horizontal",
    "distribute-vertical",
    "flip-horizontal",
    "flip-vertical",
  ],
  "lasso-fill": [],
  "marquee-rect": [],
  "marquee-ellipse": [],
  crop: [],
  perspective: [],
  "rotate-view": ["rotate-left", "rotate-right"],
  "flip-view": ["flip", "restore"],
  "brush-size": [
    "preset-xs",
    "preset-s",
    "preset-m",
    "preset-l",
    "preset-xl",
    "preset-xxl",
    "lock",
    "unlock",
  ],
  opacity: [
    "preset-20",
    "preset-40",
    "preset-60",
    "preset-80",
    "preset-100",
    "lock",
    "unlock",
  ],
  stabilizer: ["standard", "adaptive", "precision", "post-correction"],
  pressure: ["linear", "soft", "firm"],
  symmetry: ["none", "vertical", "horizontal", "radial", "kaleidoscope", "silk"],
  "zoom-view": ["zoom-out", "zoom-in", "actual-size", "fit-width", "reset"],
  "view-hud": ["zoom-open", "zoom-close", "rotate-open", "rotate-close"],
  "color-vision": ["original", "grayscale", "protanopia", "deuteranopia", "tritanopia"],
  dismiss: [],
  history: [],
  undo: [],
  redo: [],
  layer: [],
  "layer-visibility": ["show", "hide", "batch-show", "batch-hide"],
  "layer-lock": ["lock", "unlock", "batch-lock", "batch-unlock"],
  "layer-merge": ["merge-selected", "flatten-visible"],
  "layer-actions": [],
  "layer-duplicate": [],
  "layer-reorder-front": [],
  "layer-reorder-back": [],
  "layer-delete": [],
  timeline: ["play", "pause"],
  keyframe: [],
  "frame-sequence": [],
  "frame-capture": [],
  "frame-playback": ["play", "pause"],
  "frame-reorder": ["reorder", "reorder-previous", "reorder-next"],
  "frame-duplicate": [],
  "frame-delete": [],
  "onion-skin": ["onion-prev-count", "onion-next-count", "onion-opacity", "onion-tint"],
  timelapse: [],
  "motion-fx": [],
  "video-export": [],
  audio: [],
  "object-3d": [],
  "object-translate": [],
  "object-rotate": [],
  "object-scale": [],
  "object-ground": ["ground", "origin-ground"],
  "object-snap": ["enable", "disable"],
  "pose-3d": [],
  "camera-3d": [],
  "camera-zoom": ["zoom-in", "zoom-out", "focus-selection"],
  "camera-reset": [],
  "camera-orbit": ["start", "stop"],
  "quad-view": ["open", "close"],
  "lighting-3d": [],
  "line-art": ["enable", "disable"],
  assets: [],
  "panel-layout": ["add", "split-diagonal", "diagonalize", "straighten"],
  "character-3d": [],
  "mannequin-3d": [],
  "background-library": [],
  "style-library": [],
  "storyboard-grid": [],
  "review-workflow": [],
  "team-collaboration": [],
  "continuity-check": [],
  "vertical-preview": [],
  "workspace-focus": ["focus", "restore"],
  "file-workflow": [],
  "edit-workflow": [],
  "insert-content": [],
  "comment-inbox": [],
  "draw-workflow": [],
  "view-workflow": [],
  export: [],
  "export-options": [],
  project: [],
  fullscreen: [
    "maximize-window",
    "restore-window",
    "fullscreen",
    "exit-fullscreen",
    "canvas-only",
  ],
  settings: [],
  save: [],
  publish: [],
  "ai-assist": [],
  "brush-library": [],
  "brush-favorite": ["add", "remove"],
  "brush-slot": [],
  "brush-studio": [],
  "draw-settings": ["expand", "collapse"],
} as const satisfies Readonly<Record<string, readonly string[]>>;

export type StudioToolHintPreviewKind =
  keyof typeof STUDIO_TOOL_HINT_PREVIEW_VARIANTS;

/**
 * Runtime catalog kept beside the type contract so every kind is exercised by
 * the reduced-motion and animation rendering tests.
 */
export const STUDIO_TOOL_HINT_PREVIEW_KINDS = Object.freeze(
  Object.keys(STUDIO_TOOL_HINT_PREVIEW_VARIANTS) as StudioToolHintPreviewKind[]
);

export type StudioToolHintPreviewCanonicalVariant<
  Kind extends StudioToolHintPreviewKind,
> = (typeof STUDIO_TOOL_HINT_PREVIEW_VARIANTS)[Kind][number];

type StudioToolHintPreviewNamespacedVariant<Variant extends string> =
  | Variant
  | `${string}:${Variant}`
  | `${string}/${Variant}`
  | `${string}-${Variant}`;

/**
 * Variants accepted by a kind, including the stable namespace suffix formats
 * supported by the renderer (for example `camera:zoom-out`).
 */
export type StudioToolHintPreviewVariant<
  Kind extends StudioToolHintPreviewKind,
> = StudioToolHintPreviewNamespacedVariant<
  StudioToolHintPreviewCanonicalVariant<Kind>
>;

type StudioToolHintPreviewSpecFor<Kind extends StudioToolHintPreviewKind> =
  [StudioToolHintPreviewCanonicalVariant<Kind>] extends [never]
    ? Readonly<{ kind: Kind; variant?: never }>
    : Readonly<{
        kind: Kind;
        variant?: StudioToolHintPreviewVariant<Kind>;
      }>;

/** Discriminated kind/variant contract; invalid cross-family pairs are rejected. */
export type StudioToolHintPreviewSpec<
  Kind extends StudioToolHintPreviewKind = StudioToolHintPreviewKind,
> = Kind extends StudioToolHintPreviewKind
  ? StudioToolHintPreviewSpecFor<Kind>
  : never;

type StudioToolHintPreviewFieldsFor<Kind extends StudioToolHintPreviewKind> =
  [StudioToolHintPreviewCanonicalVariant<Kind>] extends [never]
    ? Readonly<{ preview: Kind; previewVariant?: never }>
    : Readonly<{
        preview: Kind;
        previewVariant?: StudioToolHintPreviewVariant<Kind>;
      }>;

/**
 * Discriminated form using the existing Studio hint field names. Consumers can
 * intersect this with their title/description fields without losing pairing.
 */
export type StudioToolHintPreviewFields<
  Kind extends StudioToolHintPreviewKind = StudioToolHintPreviewKind,
> = Kind extends StudioToolHintPreviewKind
  ? StudioToolHintPreviewFieldsFor<Kind>
  : never;

type StudioToolHintConsumerPreviewFieldsFor<
  Kind extends StudioToolHintPreviewKind,
> = [StudioToolHintPreviewCanonicalVariant<Kind>] extends [never]
  ? Readonly<{ hintPreview: Kind; hintPreviewVariant?: never }>
  : Readonly<{
      hintPreview: Kind;
      hintPreviewVariant?: StudioToolHintPreviewVariant<Kind>;
    }>;

/**
 * Discriminated preview fields used by reusable Studio chrome controls.
 *
 * The explicit no-preview branch keeps both fields optional for ordinary
 * buttons while preventing a variant from being supplied on its own.
 */
export type StudioToolHintConsumerPreviewFields<
  Kind extends StudioToolHintPreviewKind = StudioToolHintPreviewKind,
> =
  | Readonly<{ hintPreview?: undefined; hintPreviewVariant?: never }>
  | (Kind extends StudioToolHintPreviewKind
      ? StudioToolHintConsumerPreviewFieldsFor<Kind>
      : never);

/**
 * Create a preview contract while inferring the kind only from the first
 * argument. `NoInfer` prevents TypeScript from widening Kind into a union just
 * to make an unrelated second argument compile.
 */
export function studioToolHintPreviewSpec<
  const Kind extends StudioToolHintPreviewKind,
>(
  kind: Kind,
  ...variant: [StudioToolHintPreviewCanonicalVariant<Kind>] extends [never]
    ? []
    : [variant?: NoInfer<StudioToolHintPreviewVariant<Kind>>]
): StudioToolHintPreviewSpec<Kind> {
  const value = (variant as readonly [string?])[0];
  return (value === undefined ? { kind } : { kind, variant: value }) as
    StudioToolHintPreviewSpec<Kind>;
}

function normalizeStudioToolHintPreviewVariant(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("ko-KR")
    .replaceAll("_", "-")
    .replace(/\s+/gu, "-");
}

const STUDIO_TOOL_HINT_RUNTIME_VARIANT_ALIASES: Readonly<
  Partial<Record<StudioToolHintPreviewKind, Readonly<Record<string, string>>>>
> = {
  "zoom-view": { "zoom-fit": "fit-width" },
  "layer-visibility": {
    "show-layer": "show",
    "hide-layer": "hide",
  },
  "layer-lock": {
    "lock-layer": "lock",
    "unlock-layer": "unlock",
  },
};

function matchesStudioToolHintVariantToken(value: string, token: string): boolean {
  return value === token
    || value.endsWith(`:${token}`)
    || value.endsWith(`-${token}`)
    || value.endsWith(`/${token}`);
}

/** Resolve persisted/plugin aliases to one canonical, visually testable action. */
export function studioToolHintPreviewCanonicalVariantFromRuntime<
  Kind extends StudioToolHintPreviewKind,
>(
  kind: Kind,
  value: string,
): StudioToolHintPreviewVariant<Kind> | undefined {
  const normalized = normalizeStudioToolHintPreviewVariant(value);
  const candidates = STUDIO_TOOL_HINT_PREVIEW_VARIANTS[kind];
  const canonical = candidates.find((candidate) => normalized === candidate)
    ?? [...candidates]
      .sort((left, right) => right.length - left.length)
      .find((candidate) =>
        normalized.endsWith(`:${candidate}`)
        || normalized.endsWith(`-${candidate}`)
        || normalized.endsWith(`/${candidate}`)
      );
  if (canonical !== undefined) {
    return canonical as StudioToolHintPreviewVariant<Kind>;
  }

  const aliases = STUDIO_TOOL_HINT_RUNTIME_VARIANT_ALIASES[kind];
  if (!aliases) return undefined;
  for (const [alias, replacement] of Object.entries(aliases)) {
    if (matchesStudioToolHintVariantToken(normalized, alias)) {
      return replacement as StudioToolHintPreviewVariant<Kind>;
    }
  }
  return undefined;
}

/** Runtime companion for untyped plugin or persisted hint data. */
export function isStudioToolHintPreviewVariant<
  Kind extends StudioToolHintPreviewKind,
>(
  kind: Kind,
  value: string
): value is StudioToolHintPreviewVariant<Kind> {
  const normalized = normalizeStudioToolHintPreviewVariant(value);
  return STUDIO_TOOL_HINT_PREVIEW_VARIANTS[kind].some((candidate) =>
    matchesStudioToolHintVariantToken(normalized, candidate)
  );
}

/**
 * Validate untyped persisted/plugin identity before it reaches the renderer.
 * Invalid values deliberately degrade to that family's authored default.
 */
export function studioToolHintPreviewSpecFromRuntime(
  kind: StudioToolHintPreviewKind,
  variant?: string
): StudioToolHintPreviewSpec {
  if (variant !== undefined) {
    const canonicalVariant = studioToolHintPreviewCanonicalVariantFromRuntime(
      kind,
      variant,
    );
    if (canonicalVariant !== undefined) {
      return { kind, variant: canonicalVariant } as StudioToolHintPreviewSpec;
    }
  }
  return { kind } as StudioToolHintPreviewSpec;
}
