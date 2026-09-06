/**
 * Atomic 3D line-and-tone (LT) layer bundle planner.
 *
 * StudioPage stores z-order as a flat array (index 0 = back, last = front). This module keeps
 * the page-specific union type out of the dependency graph and only asks for the small structural
 * surface needed to validate and replace a 3D LT bundle. A successful result contains complete
 * next arrays; a failed result contains no partial state.
 */

import { createLayerGroup, type LayerGroup } from "../studio-layers";

export const STUDIO_BG3D_LT_LAYER_ROLES = ["color", "tone", "texture-line", "main-line"] as const;

/** Back-to-front order. The last available role is the editable-scene anchor. */
export type StudioBg3dLtLayerRole = (typeof STUDIO_BG3D_LT_LAYER_ROLES)[number];

export const STUDIO_BG3D_LT_GROUP_NAME = "3D LT 배경";

export const STUDIO_BG3D_LT_LAYER_NAMES: Readonly<Record<StudioBg3dLtLayerRole, string>> =
  Object.freeze({
    color: "3D LT · 컬러 렌더",
    "main-line": "3D LT · 주선",
    "texture-line": "3D LT · 질감선",
    tone: "3D LT · 톤",
  });

export const STUDIO_BG3D_LT_MAX_RASTER_EDGE = 32_768;
export const STUDIO_BG3D_LT_MAX_DATA_URL_LENGTH = 96 * 1024 * 1024;

export type StudioBg3dLtRenderMode = "separated" | "combined";

/** The smallest shape shared by every StudioPage element. */
export interface StudioBg3dLtPageElementLike {
  readonly id: string;
  readonly type: string;
  readonly groupId?: string;
  readonly locked?: boolean;
}

/**
 * Image fields owned by this planner. StudioPage's ImageEl is structurally compatible after it
 * declares the three bg3dLt* metadata fields used for subsequent bundle discovery.
 */
export interface StudioBg3dLtImageElementLike<TScene = unknown>
  extends StudioBg3dLtPageElementLike {
  readonly type: "image";
  readonly src: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rotation?: number;
  readonly flipped?: boolean;
  readonly flippedY?: boolean;
  readonly skewX?: number;
  readonly skewY?: number;
  readonly name?: string;
  readonly layerRole?: string;
  readonly bg3dScene?: TScene;
  readonly bg3dLtBundleId?: string;
  readonly bg3dLtRole?: StudioBg3dLtLayerRole;
  readonly bg3dLtRenderMode?: StudioBg3dLtRenderMode;
}

export interface StudioBg3dLtSeparatedRaster {
  readonly role: StudioBg3dLtLayerRole;
  readonly pngDataUrl: string;
  readonly width: number;
  readonly height: number;
}

/** Current StudioBackground3DInsertResult is structurally compatible with this fallback shape. */
export interface StudioBg3dLtCombinedRender<TScene> {
  readonly kind?: "combined";
  readonly pngDataUrl: string;
  readonly width: number;
  readonly height: number;
  readonly bg3dScene: TScene;
  readonly layers?: undefined;
}

export interface StudioBg3dLtSeparatedRender<TScene> {
  readonly kind: "separated";
  /** Common render dimensions repeated on every raster for defensive cross-checking. */
  readonly width: number;
  readonly height: number;
  readonly layers: readonly StudioBg3dLtSeparatedRaster[];
  readonly bg3dScene: TScene;
  readonly pngDataUrl?: undefined;
}

export type StudioBg3dLtRenderOutput<TScene> =
  | StudioBg3dLtCombinedRender<TScene>
  | StudioBg3dLtSeparatedRender<TScene>;

export interface StudioBg3dLtIdAllocations {
  /** Required for a new or legacy-upgraded bundle. Ignored for an existing metadata bundle. */
  readonly bundleId?: string;
  /** Required for a new or legacy-upgraded bundle. Ignored for an existing metadata bundle. */
  readonly groupId?: string;
  /** Required only for roles that do not already have an element. */
  readonly elementIds?: Partial<Record<StudioBg3dLtLayerRole, string>>;
}

export interface PlanStudioBg3dLtLayersInput<
  TElement extends StudioBg3dLtPageElementLike,
  TScene,
> {
  readonly elements: readonly TElement[];
  readonly groups: readonly LayerGroup[];
  readonly render: StudioBg3dLtRenderOutput<TScene>;
  /** Omit to insert at the front of the page. Pass any member id to update its whole bundle. */
  readonly targetElementId?: string;
  readonly pageLocked?: boolean;
  readonly allocations?: StudioBg3dLtIdAllocations;
  /**
   * A caller-created, default image element. Required only when the plan must create at least one
   * element. Its src must be the anchor raster, preventing a stale render/template pairing.
   */
  readonly newElementTemplate?: TElement & StudioBg3dLtImageElementLike<TScene>;
}

export type StudioBg3dLtLayerPlanErrorCode =
  | "page-locked"
  | "duplicate-element-id"
  | "duplicate-group-id"
  | "invalid-render-mode"
  | "invalid-render-dimensions"
  | "missing-render-layer"
  | "duplicate-render-role"
  | "mismatched-layer-dimensions"
  | "invalid-png-data-url"
  | "missing-scene"
  | "target-not-found"
  | "target-not-image"
  | "target-locked"
  | "invalid-bundle-metadata"
  | "invalid-bundle-element"
  | "duplicate-bundle-role"
  | "noncontiguous-bundle"
  | "inconsistent-bundle-geometry"
  | "inconsistent-bundle-group"
  | "missing-bundle-group"
  | "mixed-bundle-group"
  | "bundle-group-locked"
  | "missing-allocation"
  | "invalid-allocation-id"
  | "allocation-collision"
  | "bundle-id-collision"
  | "group-id-collision"
  | "missing-element-template"
  | "invalid-element-template"
  | "template-source-mismatch"
  | "template-aspect-mismatch";

export interface StudioBg3dLtLayerPlanFailure {
  readonly ok: false;
  readonly code: StudioBg3dLtLayerPlanErrorCode;
  readonly message: string;
}

export interface StudioBg3dLtPlannedLayer {
  readonly role: StudioBg3dLtLayerRole;
  readonly elementId: string;
  readonly name: string;
  readonly pngDataUrl: string;
  readonly created: boolean;
  readonly sceneAnchor: boolean;
}

export interface StudioBg3dLtLayerPlanSuccess<TElement extends StudioBg3dLtPageElementLike> {
  readonly ok: true;
  readonly operation: "insert" | "update" | "upgrade-legacy";
  readonly renderMode: StudioBg3dLtRenderMode;
  readonly bundleId: string;
  readonly groupId: string;
  readonly insertionIndex: number;
  readonly anchorElementId: string;
  readonly layers: readonly StudioBg3dLtPlannedLayer[];
  readonly createdElementIds: readonly string[];
  readonly removedElementIds: readonly string[];
  readonly nextElements: TElement[];
  readonly nextGroups: LayerGroup[];
}

export type StudioBg3dLtLayerPlanResult<TElement extends StudioBg3dLtPageElementLike> =
  | StudioBg3dLtLayerPlanFailure
  | StudioBg3dLtLayerPlanSuccess<TElement>;

/**
 * Keeps a separated bundle editable when its sole scene-anchor layer is deleted but other bundle
 * layers remain. The highest remaining paint role is promoted without mutating either input.
 * Corrupt bundles with zero or multiple source anchors are deliberately left untouched.
 */
export function preserveStudioBg3dLtSceneAnchorAfterRemoval<
  TElement extends StudioBg3dLtPageElementLike,
  TScene,
>(before: readonly TElement[], after: TElement[]): TElement[] {
  const sourceAnchors = new Map<
    string,
    Array<TElement & StudioBg3dLtImageElementLike<TScene>>
  >();
  for (const element of before) {
    if (!isImageElement<TScene>(element) || !isValidId(element.bg3dLtBundleId)) continue;
    if (element.bg3dScene === undefined) continue;
    const anchors = sourceAnchors.get(element.bg3dLtBundleId) ?? [];
    anchors.push(element as TElement & StudioBg3dLtImageElementLike<TScene>);
    sourceAnchors.set(element.bg3dLtBundleId, anchors);
  }

  let next = after;
  for (const [bundleId, anchors] of sourceAnchors) {
    if (anchors.length !== 1) continue;
    const remaining = after
      .map((element, index) => ({ element, index }))
      .filter(
        (entry): entry is {
          element: TElement & StudioBg3dLtImageElementLike<TScene>;
          index: number;
        } =>
          isImageElement<TScene>(entry.element) &&
          entry.element.bg3dLtBundleId === bundleId &&
          isRole(entry.element.bg3dLtRole)
      );
    if (remaining.length === 0 || remaining.some(({ element }) => element.bg3dScene !== undefined)) {
      continue;
    }
    const promoted = remaining.reduce((best, candidate) => {
      const bestPriority = STUDIO_BG3D_LT_LAYER_ROLES.indexOf(best.element.bg3dLtRole!);
      const candidatePriority = STUDIO_BG3D_LT_LAYER_ROLES.indexOf(candidate.element.bg3dLtRole!);
      return candidatePriority >= bestPriority ? candidate : best;
    });
    if (next === after) next = [...after];
    next[promoted.index] = {
      ...promoted.element,
      bg3dScene: anchors[0]!.bg3dScene,
    } as TElement;
  }
  return next;
}

interface NormalizedRaster {
  readonly role: StudioBg3dLtLayerRole;
  readonly pngDataUrl: string;
}

interface NormalizedRender<TScene> {
  readonly mode: StudioBg3dLtRenderMode;
  readonly width: number;
  readonly height: number;
  readonly layers: readonly NormalizedRaster[];
  readonly anchorRole: StudioBg3dLtLayerRole;
  readonly bg3dScene: TScene;
}

interface CommonGeometry {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rotation: number;
  readonly flipped: boolean;
  readonly flippedY: boolean;
  readonly skewX: number;
  readonly skewY: number;
}

const ROLE_SET = new Set<string>(STUDIO_BG3D_LT_LAYER_ROLES);
const BASE64_BODY_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const ID_PATTERN = /^\S{1,256}$/u;
const MAX_LEGACY_SCENE_FRAGMENT_LENGTH = 2 * 1024 * 1024;

function failure(
  code: StudioBg3dLtLayerPlanErrorCode,
  message: string
): StudioBg3dLtLayerPlanFailure {
  return { ok: false, code, message };
}

function isFailure<TScene>(
  value: NormalizedRender<TScene> | StudioBg3dLtLayerPlanFailure
): value is StudioBg3dLtLayerPlanFailure {
  return "ok" in value && value.ok === false;
}

function isValidId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    ID_PATTERN.test(value) &&
    ![...value].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint < 32 || codePoint === 127;
    })
  );
}

function isRole(value: unknown): value is StudioBg3dLtLayerRole {
  return typeof value === "string" && ROLE_SET.has(value);
}

function isValidRasterDimension(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    value <= STUDIO_BG3D_LT_MAX_RASTER_EDGE
  );
}

export function isStudioBg3dLtPngDataUrl(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length > STUDIO_BG3D_LT_MAX_DATA_URL_LENGTH ||
    !value.startsWith("data:image/png;base64,")
  ) {
    return false;
  }
  const body = value.slice("data:image/png;base64,".length);
  return body.length > 0 && body.length % 4 === 0 && BASE64_BODY_PATTERN.test(body);
}

function isStudioBg3dLtPersistedLayerSource(
  value: unknown,
  role: unknown,
): value is string {
  return isStudioBg3dLtPngDataUrl(value)
    || (
      role === "main-line"
      && typeof value === "string"
      && /^studio-opfs-cas:sha256:[a-f0-9]{64}$/u.test(value)
    );
}

/**
 * Accepts the two historical BG3D fragment forms and returns only the canonical PNG data URL.
 * Fragments are deliberately forbidden everywhere else: new render output and metadata bundles
 * must persist the editable scene in bg3dScene, never in a URL suffix.
 */
export function canonicalizeLegacyStudioBg3dPngDataUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const hashIndex = value.indexOf("#");
  if (hashIndex < 0) return isStudioBg3dLtPngDataUrl(value) ? value : null;
  if (value.indexOf("#", hashIndex + 1) >= 0) return null;

  const pngDataUrl = value.slice(0, hashIndex);
  const fragment = value.slice(hashIndex + 1);
  if (
    !isStudioBg3dLtPngDataUrl(pngDataUrl) ||
    fragment.length === 0 ||
    fragment.length > MAX_LEGACY_SCENE_FRAGMENT_LENGTH
  ) {
    return null;
  }
  if (fragment === "ts3d") return pngDataUrl;

  try {
    const decoded = JSON.parse(decodeURIComponent(fragment)) as unknown;
    if (
      typeof decoded !== "object" ||
      decoded === null ||
      Array.isArray(decoded) ||
      (decoded as { tool?: unknown }).tool !== "bg3d"
    ) {
      return null;
    }
    return pngDataUrl;
  } catch {
    return null;
  }
}

function normalizeRender<TScene>(
  render: StudioBg3dLtRenderOutput<TScene>
): NormalizedRender<TScene> | StudioBg3dLtLayerPlanFailure {
  if (render === null || typeof render !== "object") {
    return failure("invalid-render-mode", "3D LT 렌더 결과 형식이 올바르지 않아요.");
  }
  if (!isValidRasterDimension(render.width) || !isValidRasterDimension(render.height)) {
    return failure("invalid-render-dimensions", "3D LT 렌더 크기가 허용 범위를 벗어났어요.");
  }
  if (render.bg3dScene === undefined || render.bg3dScene === null) {
    return failure("missing-scene", "다시 편집할 3D 장면 정보가 없어요.");
  }

  if (render.kind === "separated") {
    if (render.pngDataUrl !== undefined || !Array.isArray(render.layers)) {
      return failure("invalid-render-mode", "분리 렌더와 통합 렌더 값이 섞여 있어요.");
    }
    if (render.layers.length === 0) {
      return failure("missing-render-layer", "삽입할 3D LT 레이어가 없어요.");
    }

    const seenRoles = new Set<StudioBg3dLtLayerRole>();
    const byRole = new Map<StudioBg3dLtLayerRole, NormalizedRaster>();
    for (const layer of render.layers) {
      if (!layer || typeof layer !== "object" || !isRole(layer.role)) {
        return failure("invalid-render-mode", "알 수 없는 3D LT 레이어 역할이 포함되어 있어요.");
      }
      if (seenRoles.has(layer.role)) {
        return failure("duplicate-render-role", "같은 역할의 3D LT 레이어가 중복되었어요.");
      }
      seenRoles.add(layer.role);
      if (layer.width !== render.width || layer.height !== render.height) {
        return failure(
          "mismatched-layer-dimensions",
          "분리된 3D LT 레이어의 렌더 크기가 서로 달라요."
        );
      }
      if (!isStudioBg3dLtPngDataUrl(layer.pngDataUrl)) {
        return failure("invalid-png-data-url", "3D LT 레이어 PNG 데이터가 올바르지 않아요.");
      }
      byRole.set(layer.role, { role: layer.role, pngDataUrl: layer.pngDataUrl });
    }

    const layers = STUDIO_BG3D_LT_LAYER_ROLES.flatMap((role) => {
      const layer = byRole.get(role);
      return layer ? [layer] : [];
    });
    const anchorRole = layers.at(-1)?.role;
    if (!anchorRole) {
      return failure("missing-render-layer", "삽입할 3D LT 레이어가 없어요.");
    }
    return {
      mode: "separated",
      width: render.width,
      height: render.height,
      layers,
      anchorRole,
      bg3dScene: render.bg3dScene,
    };
  }

  if (render.kind !== undefined && render.kind !== "combined") {
    return failure("invalid-render-mode", "지원하지 않는 3D LT 렌더 형식이에요.");
  }
  if (render.layers !== undefined || !isStudioBg3dLtPngDataUrl(render.pngDataUrl)) {
    return failure("invalid-png-data-url", "통합 3D PNG 데이터가 올바르지 않아요.");
  }
  return {
    mode: "combined",
    width: render.width,
    height: render.height,
    layers: [{ role: "main-line", pngDataUrl: render.pngDataUrl }],
    anchorRole: "main-line",
    bg3dScene: render.bg3dScene,
  };
}

function isImageElement<TScene>(
  value: StudioBg3dLtPageElementLike
): value is StudioBg3dLtImageElementLike<TScene> {
  const image = value as Partial<StudioBg3dLtImageElementLike<TScene>>;
  return (
    image.type === "image" &&
    typeof image.src === "string" &&
    typeof image.x === "number" &&
    typeof image.y === "number" &&
    typeof image.width === "number" &&
    typeof image.height === "number"
  );
}

function finiteOptionalNumber(value: unknown, fallback = 0): number | null {
  if (value === undefined) return fallback;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function geometryOf<TScene>(image: StudioBg3dLtImageElementLike<TScene>): CommonGeometry | null {
  const rotation = finiteOptionalNumber(image.rotation);
  const skewX = finiteOptionalNumber(image.skewX);
  const skewY = finiteOptionalNumber(image.skewY);
  if (
    !Number.isFinite(image.x) ||
    !Number.isFinite(image.y) ||
    !Number.isFinite(image.width) ||
    !Number.isFinite(image.height) ||
    image.width <= 0 ||
    image.height <= 0 ||
    rotation === null ||
    skewX === null ||
    skewY === null ||
    (image.flipped !== undefined && typeof image.flipped !== "boolean") ||
    (image.flippedY !== undefined && typeof image.flippedY !== "boolean")
  ) {
    return null;
  }
  return {
    x: image.x,
    y: image.y,
    width: image.width,
    height: image.height,
    rotation,
    flipped: image.flipped ?? false,
    flippedY: image.flippedY ?? false,
    skewX,
    skewY,
  };
}

function sameGeometry(left: CommonGeometry, right: CommonGeometry): boolean {
  return (
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height &&
    left.rotation === right.rotation &&
    left.flipped === right.flipped &&
    left.flippedY === right.flippedY &&
    left.skewX === right.skewX &&
    left.skewY === right.skewY
  );
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function setOptionalTransform(
  record: Record<string, unknown>,
  key: "flipped" | "flippedY" | "skewX" | "skewY",
  value: boolean | number,
  identity: boolean | number
): void {
  if (value === identity) {
    Reflect.deleteProperty(record, key);
  } else {
    record[key] = value;
  }
}

function makeLayerElement<
  TElement extends StudioBg3dLtPageElementLike,
  TScene,
>(
  base: TElement & StudioBg3dLtImageElementLike<TScene>,
  layer: NormalizedRaster,
  elementId: string,
  bundleId: string,
  groupId: string,
  mode: StudioBg3dLtRenderMode,
  geometry: CommonGeometry,
  anchorRole: StudioBg3dLtLayerRole,
  scene: TScene
): TElement {
  const next = { ...base } as unknown as Record<string, unknown>;
  Reflect.deleteProperty(next, "bg3dScene");
  next.id = elementId;
  next.type = "image";
  next.src = layer.pngDataUrl;
  next.x = geometry.x;
  next.y = geometry.y;
  next.width = geometry.width;
  next.height = geometry.height;
  next.rotation = geometry.rotation;
  setOptionalTransform(next, "flipped", geometry.flipped, false);
  setOptionalTransform(next, "flippedY", geometry.flippedY, false);
  setOptionalTransform(next, "skewX", geometry.skewX, 0);
  setOptionalTransform(next, "skewY", geometry.skewY, 0);
  next.groupId = groupId;
  next.name = STUDIO_BG3D_LT_LAYER_NAMES[layer.role];
  next.layerRole = layer.role === "color" ? "color" : layer.role === "tone" ? "tone" : "lineart";
  next.bg3dLtBundleId = bundleId;
  next.bg3dLtRole = layer.role;
  next.bg3dLtRenderMode = mode;
  if (layer.role === anchorRole) next.bg3dScene = scene;
  return next as unknown as TElement;
}

function firstDuplicateId(values: readonly string[]): string | null {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) return value;
    seen.add(value);
  }
  return null;
}

/**
 * Plans and applies one atomic page-state transition.
 *
 * - Insert: creates a dedicated group at the front of the z-order.
 * - Legacy update: reuses the selected single PNG id as the highest available role and upgrades it
 *   into a dedicated metadata bundle at the same z-position.
 * - Bundle update: reconciles the role set, recreating missing roles and removing obsolete roles at
 *   the bundle's existing z-position.
 */
export function planStudioBg3dLtLayers<
  TElement extends StudioBg3dLtPageElementLike,
  TScene,
>(
  input: PlanStudioBg3dLtLayersInput<TElement, TScene>
): StudioBg3dLtLayerPlanResult<TElement> {
  if (input.pageLocked) {
    return failure("page-locked", "검토 잠금된 페이지에는 3D LT 레이어를 적용할 수 없어요.");
  }

  if (firstDuplicateId(input.elements.map((element) => element.id))) {
    return failure("duplicate-element-id", "페이지에 중복된 요소 ID가 있어 안전하게 적용할 수 없어요.");
  }
  if (firstDuplicateId(input.groups.map((group) => group.id))) {
    return failure("duplicate-group-id", "페이지에 중복된 그룹 ID가 있어 안전하게 적용할 수 없어요.");
  }

  const normalized = normalizeRender(input.render);
  if (isFailure(normalized)) return normalized;

  const existingElementIds = new Set(input.elements.map((element) => element.id));
  const groupById = new Map(input.groups.map((group) => [group.id, group] as const));
  const targetIndex =
    input.targetElementId === undefined
      ? -1
      : input.elements.findIndex((element) => element.id === input.targetElementId);

  if (input.targetElementId !== undefined && targetIndex < 0) {
    return failure("target-not-found", "다시 적용할 3D LT 레이어를 찾지 못했어요.");
  }

  let operation: StudioBg3dLtLayerPlanSuccess<TElement>["operation"] = "insert";
  let bundleId: string | undefined;
  let groupId: string | undefined;
  let insertionIndex = input.elements.length;
  let commonGeometry: CommonGeometry | undefined;
  let bundleIndices: number[] = [];
  let bundleElements: Array<TElement & StudioBg3dLtImageElementLike<TScene>> = [];
  const existingByRole = new Map<
    StudioBg3dLtLayerRole,
    TElement & StudioBg3dLtImageElementLike<TScene>
  >();

  if (targetIndex >= 0) {
    const target = input.elements[targetIndex]!;
    if (!isImageElement<TScene>(target)) {
      return failure("target-not-image", "선택한 요소는 3D LT 이미지 레이어가 아니에요.");
    }
    const targetGroup = target.groupId ? groupById.get(target.groupId) : undefined;
    if (target.locked) {
      return failure("target-locked", "잠긴 3D LT 레이어는 변경할 수 없어요.");
    }

    const hasBundleId = hasOwn(target, "bg3dLtBundleId") && target.bg3dLtBundleId !== undefined;
    const hasRole = hasOwn(target, "bg3dLtRole") && target.bg3dLtRole !== undefined;
    const hasMode = hasOwn(target, "bg3dLtRenderMode") && target.bg3dLtRenderMode !== undefined;
    if (hasBundleId || hasRole || hasMode) {
      if (
        !hasBundleId ||
        !hasRole ||
        !hasMode ||
        !isValidId(target.bg3dLtBundleId) ||
        !isRole(target.bg3dLtRole) ||
        (target.bg3dLtRenderMode !== "combined" && target.bg3dLtRenderMode !== "separated")
      ) {
        return failure("invalid-bundle-metadata", "기존 3D LT 번들 메타데이터가 불완전해요.");
      }

      operation = "update";
      bundleId = target.bg3dLtBundleId;
      input.elements.forEach((element, index) => {
        const candidate = element as TElement & Partial<StudioBg3dLtImageElementLike<TScene>>;
        if (candidate.bg3dLtBundleId !== bundleId) return;
        bundleIndices.push(index);
        if (isImageElement<TScene>(element)) {
          bundleElements.push(element as TElement & StudioBg3dLtImageElementLike<TScene>);
        }
      });

      if (bundleElements.length !== bundleIndices.length || bundleElements.length === 0) {
        return failure("invalid-bundle-element", "3D LT 번들에 이미지가 아닌 요소가 섞여 있어요.");
      }
      insertionIndex = bundleIndices[0]!;
      if (bundleIndices.some((index, offset) => index !== insertionIndex + offset)) {
        return failure("noncontiguous-bundle", "3D LT 번들 레이어 사이에 다른 레이어가 끼어 있어요.");
      }

      const first = bundleElements[0]!;
      const firstGeometry = geometryOf(first);
      if (!firstGeometry) {
        return failure("inconsistent-bundle-geometry", "기존 3D LT 번들의 배치 값이 올바르지 않아요.");
      }
      commonGeometry = firstGeometry;
      groupId = first.groupId;
      if (!isValidId(groupId)) {
        return failure("inconsistent-bundle-group", "기존 3D LT 번들에 전용 그룹이 없어요.");
      }

      for (const element of bundleElements) {
        if (
          !isStudioBg3dLtPersistedLayerSource(element.src, element.bg3dLtRole) ||
          !isRole(element.bg3dLtRole) ||
          element.bg3dLtBundleId !== bundleId ||
          (element.bg3dLtRenderMode !== "combined" && element.bg3dLtRenderMode !== "separated")
        ) {
          return failure("invalid-bundle-metadata", "기존 3D LT 번들 메타데이터가 일치하지 않아요.");
        }
        if (existingByRole.has(element.bg3dLtRole)) {
          return failure("duplicate-bundle-role", "기존 3D LT 번들에 같은 역할의 레이어가 중복되었어요.");
        }
        const geometry = geometryOf(element);
        if (!geometry || !sameGeometry(firstGeometry, geometry)) {
          return failure(
            "inconsistent-bundle-geometry",
            "기존 3D LT 번들 레이어의 위치나 크기가 서로 달라요."
          );
        }
        if (element.groupId !== groupId) {
          return failure("inconsistent-bundle-group", "기존 3D LT 번들 레이어의 그룹이 서로 달라요.");
        }
        if (element.locked) {
          return failure("target-locked", "잠긴 3D LT 번들 레이어는 변경할 수 없어요.");
        }
        existingByRole.set(element.bg3dLtRole, element);
      }

      const bundleGroup = groupById.get(groupId);
      if (!bundleGroup) {
        return failure("missing-bundle-group", "기존 3D LT 번들의 전용 그룹을 찾지 못했어요.");
      }
      if (bundleGroup.locked) {
        return failure("bundle-group-locked", "잠긴 3D LT 그룹은 변경할 수 없어요.");
      }
      if (
        input.elements.some(
          (element) =>
            element.groupId === groupId &&
            (element as Partial<StudioBg3dLtImageElementLike<TScene>>).bg3dLtBundleId !== bundleId
        )
      ) {
        return failure("mixed-bundle-group", "3D LT 전용 그룹에 관련 없는 레이어가 섞여 있어요.");
      }
    } else {
      if (targetGroup?.locked) {
        return failure("target-locked", "잠긴 그룹의 기존 3D PNG는 변경할 수 없어요.");
      }
      if (!canonicalizeLegacyStudioBg3dPngDataUrl(target.src)) {
        return failure("invalid-png-data-url", "기존 3D PNG 데이터나 장면 프래그먼트가 올바르지 않아요.");
      }
      operation = "upgrade-legacy";
      insertionIndex = targetIndex;
      bundleIndices = [targetIndex];
      bundleElements = [target as TElement & StudioBg3dLtImageElementLike<TScene>];
      const geometry = geometryOf(target);
      if (!geometry) {
        return failure("inconsistent-bundle-geometry", "기존 3D PNG의 배치 값이 올바르지 않아요.");
      }
      commonGeometry = geometry;
      existingByRole.set(normalized.anchorRole, target as TElement & StudioBg3dLtImageElementLike<TScene>);
    }
  }

  if (operation !== "update") {
    bundleId = input.allocations?.bundleId;
    groupId = input.allocations?.groupId;
    if (!isValidId(bundleId) || !isValidId(groupId)) {
      return failure("missing-allocation", "새 3D LT 번들과 그룹 ID가 필요해요.");
    }
    if (
      input.elements.some(
        (element) =>
          (element as Partial<StudioBg3dLtImageElementLike<TScene>>).bg3dLtBundleId === bundleId
      )
    ) {
      return failure("bundle-id-collision", "새 3D LT 번들 ID가 기존 번들과 겹쳐요.");
    }
    if (groupById.has(groupId)) {
      return failure("group-id-collision", "새 3D LT 그룹 ID가 기존 그룹과 겹쳐요.");
    }
  }

  // TypeScript cannot retain the narrowing through the operation branches above.
  if (!bundleId || !groupId) {
    return failure("missing-allocation", "3D LT 번들 식별자를 결정하지 못했어요.");
  }

  const elementIdByRole = new Map<StudioBg3dLtLayerRole, string>();
  const createdRoles = new Set<StudioBg3dLtLayerRole>();
  for (const layer of normalized.layers) {
    const existing = existingByRole.get(layer.role);
    if (existing) {
      elementIdByRole.set(layer.role, existing.id);
      continue;
    }
    const allocated = input.allocations?.elementIds?.[layer.role];
    if (!isValidId(allocated)) {
      return failure("missing-allocation", `${STUDIO_BG3D_LT_LAYER_NAMES[layer.role]} 레이어 ID가 필요해요.`);
    }
    if (existingElementIds.has(allocated)) {
      return failure("allocation-collision", "새 3D LT 레이어 ID가 기존 요소와 겹쳐요.");
    }
    elementIdByRole.set(layer.role, allocated);
    createdRoles.add(layer.role);
  }

  const plannedIds = normalized.layers.map((layer) => elementIdByRole.get(layer.role)!);
  if (firstDuplicateId(plannedIds)) {
    return failure("allocation-collision", "새 3D LT 레이어 ID가 서로 겹쳐요.");
  }

  const template = input.newElementTemplate;
  if (createdRoles.size > 0) {
    if (!template) {
      return failure("missing-element-template", "새 3D LT 레이어를 만들 이미지 템플릿이 필요해요.");
    }
    if (!isImageElement<TScene>(template) || template.locked) {
      return failure("invalid-element-template", "새 3D LT 이미지 템플릿이 올바르지 않아요.");
    }
    const templateGeometry = geometryOf(template);
    if (!templateGeometry) {
      return failure("invalid-element-template", "새 3D LT 이미지 템플릿의 배치 값이 올바르지 않아요.");
    }
    const anchorRaster = normalized.layers.find((layer) => layer.role === normalized.anchorRole)!;
    if (template.src !== anchorRaster.pngDataUrl) {
      return failure("template-source-mismatch", "이미지 템플릿이 현재 3D LT 렌더와 일치하지 않아요.");
    }
    const expectedHeight = templateGeometry.width * (normalized.height / normalized.width);
    if (Math.abs(templateGeometry.height - expectedHeight) > 1) {
      return failure("template-aspect-mismatch", "이미지 템플릿과 3D LT 렌더의 화면 비율이 달라요.");
    }
    if (!commonGeometry) commonGeometry = templateGeometry;
  }

  if (!commonGeometry) {
    return failure("invalid-element-template", "3D LT 레이어의 공통 배치 값을 결정하지 못했어요.");
  }

  // Updates keep the existing width/position but adopt the new render aspect ratio atomically.
  if (operation !== "insert") {
    commonGeometry = {
      ...commonGeometry,
      height: Math.max(1, Math.round(commonGeometry.width * (normalized.height / normalized.width))),
    };
  }

  const plannedLayers: StudioBg3dLtPlannedLayer[] = normalized.layers.map((layer) => ({
    role: layer.role,
    elementId: elementIdByRole.get(layer.role)!,
    name: STUDIO_BG3D_LT_LAYER_NAMES[layer.role],
    pngDataUrl: layer.pngDataUrl,
    created: createdRoles.has(layer.role),
    sceneAnchor: layer.role === normalized.anchorRole,
  }));

  const nextBundleElements = normalized.layers.map((layer) => {
    const existing = existingByRole.get(layer.role);
    const base = existing ?? template;
    if (!base) {
      // Guarded by createdRoles/template validation; retained as a total-function boundary.
      throw new Error("Invariant violation: missing 3D LT layer base element.");
    }
    return makeLayerElement(
      base,
      layer,
      elementIdByRole.get(layer.role)!,
      bundleId,
      groupId,
      normalized.mode,
      commonGeometry!,
      normalized.anchorRole,
      normalized.bg3dScene
    );
  });

  const removedIdSet = new Set(bundleElements.map((element) => element.id));
  const retainedElements = input.elements.filter((element) => !removedIdSet.has(element.id));
  const adjustedInsertionIndex = input.elements
    .slice(0, insertionIndex)
    .reduce((count, element) => count + (removedIdSet.has(element.id) ? 0 : 1), 0);
  const nextElements = [
    ...retainedElements.slice(0, adjustedInsertionIndex),
    ...nextBundleElements,
    ...retainedElements.slice(adjustedInsertionIndex),
  ];

  let nextGroups: LayerGroup[];
  if (operation === "update") {
    nextGroups = input.groups.map((group) =>
      group.id === groupId && group.name !== STUDIO_BG3D_LT_GROUP_NAME
        ? { ...group, name: STUDIO_BG3D_LT_GROUP_NAME }
        : group
    );
  } else {
    nextGroups = [...input.groups, createLayerGroup(groupId, STUDIO_BG3D_LT_GROUP_NAME)];
  }

  const resultingIds = new Set(nextBundleElements.map((element) => element.id));
  const removedElementIds = bundleElements
    .map((element) => element.id)
    .filter((id) => !resultingIds.has(id));
  const anchorElementId = elementIdByRole.get(normalized.anchorRole)!;

  return {
    ok: true,
    operation,
    renderMode: normalized.mode,
    bundleId,
    groupId,
    insertionIndex: adjustedInsertionIndex,
    anchorElementId,
    layers: plannedLayers,
    createdElementIds: plannedLayers.filter((layer) => layer.created).map((layer) => layer.elementId),
    removedElementIds,
    nextElements,
    nextGroups,
  };
}
