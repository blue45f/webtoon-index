/**
 * Character Shaper — semantic render passes and the layered PSD they assemble into.
 *
 * SHAPER's "layer-separated PSD" is the one output a webtoon studio actually finishes work with:
 * flat colours per body part, a shadow layer to multiply, a highlight layer to screen, and the ink
 * on top. This module produces that from the live VRM scene without a second renderer:
 *
 *  - **beauty** — the viewport as it is, cleared transparent.
 *  - **flat** — the same frame with MToon shading neutralised (`shadeColorFactor` := base colour,
 *    `shadingShiftFactor`/`shadingToonyFactor` := 1). The light rig is untouched, so the only
 *    difference between the two frames is the toon shading itself.
 *  - **shadow** = `max(0, flat − beauty)` → 음영 (multiply) · **highlight** = `max(0, beauty − flat)`
 *    → 하이라이트 (screen).
 *  - **line** — Sobel over the beauty pass (alpha edge ∪ luminance edge) unioned with the near-black
 *    pixels of the flat pass, which is where MToon's outline draw survives shading neutralisation.
 *  - **surface-paint** — only when the paint runtime hands over its paint-only textures.
 *  - **mask-**\* — one alpha silhouette per semantic group, rendered by hiding every other mesh.
 *
 * Honesty rules: a pass that cannot be produced is reported in `skipped` with a Korean reason and
 * never faked, an empty pass never becomes a blank layer, and every mutation the capture makes to
 * the live scene (material factors, mesh visibility, texture bindings) is restored in `finally` —
 * including when a render throws or the caller aborts.
 */

import { writePsd, type BlendMode, type Layer, type Psd } from "ag-psd";

import { classifyMeshName } from "../vrm/studio-vrm-costume";
import { collectStudioVrmCostumeMeshes } from "../vrm/studio-vrm-costume-runtime";
import { isStudioVrmMtoonMaterial } from "../vrm/studio-vrm-mtoon-brand";
import { captureStudioVrmRgba } from "../vrm/studio-vrm-raster-capture";

import {
  CHARACTER_INK_HEX,
  CHARACTER_NEAR_BLACK_THRESHOLD,
  alphaOnly,
  isEmptyPass,
  maskMultiply,
  nearBlackAlpha,
  sobelEdgeAlpha,
  subtractClamped,
  unionAlpha,
} from "./character-shaper-image-math";

import type {
  CharacterPsdExportReceipt,
  CharacterSemanticPass,
  CharacterSemanticPassId,
} from "./character-shaper-contract";
import type { ProtectedCategory } from "../vrm/studio-vrm-costume";
import type { VRM } from "@pixiv/three-vrm";
import type * as THREE from "three";

/* -------------------------------------------------------------------------- */
/* Public shapes                                                               */
/* -------------------------------------------------------------------------- */

export type CharacterSemanticMaskId = Extract<CharacterSemanticPassId, `mask-${string}`>;

export interface CharacterSemanticCaptureState {
  readonly gl: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.Camera;
}

/** Material → paint-only texture. `null` (or an empty map) means nothing has been painted. */
export type CharacterPaintTextureProvider = () => Map<THREE.Material, THREE.Texture> | null;

export interface CaptureCharacterSemanticPassesInput {
  readonly capture: CharacterSemanticCaptureState;
  readonly vrm: VRM;
  readonly width: number;
  readonly height: number;
  readonly signal?: AbortSignal;
  /** Procedural wardrobe mounts; their meshes join 상의/하의/신발 masks. */
  readonly garmentRoots?: readonly THREE.Object3D[];
  /** Procedural prop mounts; their meshes join the 액세서리 mask. */
  readonly propRoots?: readonly THREE.Object3D[];
  readonly paintTextureProvider?: CharacterPaintTextureProvider;
}

export interface CharacterSemanticSkip {
  readonly pass: CharacterSemanticPassId;
  readonly reason: string;
}

export interface CharacterSemanticCaptureResult {
  readonly passes: readonly CharacterSemanticPass[];
  readonly skipped: readonly CharacterSemanticSkip[];
}

export interface BuildCharacterSemanticPsdOptions {
  /** Document title — written as `dc:title` XMP so Photoshop's File Info shows it. */
  readonly title: string;
}

export interface CharacterSemanticPsdResult {
  readonly blob: Blob;
  readonly receipt: CharacterPsdExportReceipt;
}

export interface ExportCharacterSemanticPsdInput
  extends CaptureCharacterSemanticPassesInput, BuildCharacterSemanticPsdOptions {}

/** Seam for tests: the product path renders through `captureStudioVrmRgba`. */
export interface CharacterSemanticCaptureDependencies {
  readonly captureRgba: (
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    dimensions: { readonly width: number; readonly height: number },
  ) => Uint8ClampedArray;
}

/* -------------------------------------------------------------------------- */
/* Constants                                                                   */
/* -------------------------------------------------------------------------- */

/** Main-thread budget: 14 passes at this edge is the largest we can finish without a Worker. */
export const CHARACTER_SEMANTIC_PASS_MAX_EDGE = 2048;

export const PSD_MIME = "image/vnd.adobe.photoshop";

/** Photoshop top-to-bottom order inside 「밑색」 — detail on top, skin underneath everything. */
export const CHARACTER_SEMANTIC_MASK_ORDER: readonly CharacterSemanticMaskId[] = Object.freeze([
  "mask-eyes",
  "mask-face",
  "mask-hair",
  "mask-accessory",
  "mask-top",
  "mask-bottom",
  "mask-shoes",
  "mask-skin",
]);

export const CHARACTER_SEMANTIC_MASK_LABELS: Readonly<Record<CharacterSemanticMaskId, string>> =
  Object.freeze({
    "mask-face": "얼굴",
    "mask-eyes": "눈",
    "mask-hair": "머리",
    "mask-skin": "피부",
    "mask-top": "상의",
    "mask-bottom": "하의",
    "mask-shoes": "신발",
    "mask-accessory": "액세서리",
  });

/** Group names, and the single layer each non-mask group starts with. */
export const CHARACTER_PSD_GROUP_NAMES = Object.freeze({
  flats: "밑색",
  shadow: "음영",
  highlight: "하이라이트",
  paint: "표면 드로잉",
  line: "주선",
});

/** The colourist keeps adding layers into these groups, so the first child names the pixels. */
const CHARACTER_PSD_CHILD_NAMES = Object.freeze({
  shadow: "어두운 면",
  highlight: "밝은 면",
  paint: "브러시 획",
  line: "윤곽선",
  flatsWhole: "밑색 (전체)",
});

/** Hidden reference frame at the bottom of the stack — what the viewport actually showed. */
export const CHARACTER_PSD_PREVIEW_LAYER_NAME = "미리보기 (Beauty)";

const MASK_NOT_FOUND_REASONS: Readonly<Record<CharacterSemanticMaskId, string>> = Object.freeze({
  "mask-face": "얼굴 메시를 찾지 못했습니다.",
  "mask-eyes": "눈으로 읽히는 메시도 재질도 없습니다. 눈이 얼굴과 한 재질로 합쳐진 모델은 분리할 수 없습니다.",
  "mask-hair": "머리카락 메시를 찾지 못했습니다.",
  "mask-skin": "피부 메시를 찾지 못했습니다.",
  "mask-top": "상의로 분류된 메시가 없습니다.",
  "mask-bottom": "하의로 분류된 메시가 없습니다.",
  "mask-shoes": "신발로 분류된 메시가 없습니다.",
  "mask-accessory": "액세서리·소품으로 분류된 메시가 없습니다.",
});

const PROTECTED_MASK: Readonly<Record<ProtectedCategory, CharacterSemanticMaskId>> = Object.freeze({
  face: "mask-face",
  eye: "mask-eyes",
  hair: "mask-hair",
  skin: "mask-skin",
  body: "mask-skin",
});

const WARDROBE_ROOT_MASK: Readonly<Record<string, CharacterSemanticMaskId>> = Object.freeze({
  outer: "mask-top",
  top: "mask-top",
  bottom: "mask-bottom",
  shoes: "mask-shoes",
});

const COSTUME_SLOT_MASK: Readonly<Record<string, CharacterSemanticMaskId>> = Object.freeze({
  outer: "mask-top",
  tops: "mask-top",
  onepiece: "mask-top",
  innerwear: "mask-top",
  bottoms: "mask-bottom",
  shoes: "mask-shoes",
  accessory: "mask-accessory",
});

const WARDROBE_ROOT_NAME = /^wardrobe:(outer|top|bottom|shoes)\b/u;
const PROP_ROOT_NAME = /^prop:/u;
/** Guard against a cyclic or pathologically deep graph while walking parents. */
const ANCESTRY_DEPTH = 32;

/* -------------------------------------------------------------------------- */
/* Structural material views (no @pixiv import — MToon is a transitive dep)     */
/* -------------------------------------------------------------------------- */

type ColorLike = { copy(value: ColorLike): unknown; clone(): ColorLike; set(value: number): unknown };

type ShadingMaterial = THREE.Material & {
  color?: ColorLike;
  shadeColorFactor?: ColorLike;
  shadingShiftFactor?: number;
  shadingToonyFactor?: number;
  isOutline?: boolean;
  isMToonMaterial?: boolean;
  isMToonNodeMaterial?: boolean;
};

type PaintableMaterial = THREE.Material & {
  map?: THREE.Texture | null;
  color?: ColorLike;
};

/* -------------------------------------------------------------------------- */
/* Size + abort helpers                                                        */
/* -------------------------------------------------------------------------- */

function abortError(): Error {
  const error = new Error("캐릭터 레이어 캡처를 취소했습니다.");
  error.name = "AbortError";
  return error;
}

/** Clamp to the main-thread budget while keeping the viewport's aspect ratio. */
export function boundCharacterSemanticCaptureSize(
  width: number,
  height: number,
): { readonly width: number; readonly height: number } {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    throw new RangeError("캐릭터 레이어 캡처 크기가 올바르지 않습니다.");
  }
  const scale = Math.min(
    1,
    CHARACTER_SEMANTIC_PASS_MAX_EDGE / width,
    CHARACTER_SEMANTIC_PASS_MAX_EDGE / height,
  );
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
  };
}

/**
 * Yield the main thread between passes. Fourteen 2048² renders back to back would freeze the
 * viewport with no chance to paint progress, and the abort check has to happen somewhere.
 */
async function betweenPasses(signal: AbortSignal | undefined): Promise<void> {
  if (signal?.aborted) throw abortError();
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
  if (signal?.aborted) throw abortError();
}

/* -------------------------------------------------------------------------- */
/* Scene classification                                                        */
/* -------------------------------------------------------------------------- */

function isMesh(object: THREE.Object3D): object is THREE.Mesh {
  return (object as Partial<THREE.Mesh>).isMesh === true;
}

function materialsOf(mesh: THREE.Mesh): THREE.Material[] {
  const value = mesh.material;
  const list = Array.isArray(value) ? value : [value];
  return list.filter((material): material is THREE.Material => Boolean(material));
}

/** Procedural wardrobe / prop mounts name their root `wardrobe:<slot>:<id>` or `prop:<id>`. */
function maskFromAncestry(object: THREE.Object3D): CharacterSemanticMaskId | null {
  let node: THREE.Object3D | null = object;
  for (let depth = 0; node && depth < ANCESTRY_DEPTH; depth += 1) {
    const name = node.name;
    if (name) {
      const wardrobe = WARDROBE_ROOT_NAME.exec(name);
      if (wardrobe) return WARDROBE_ROOT_MASK[wardrobe[1]] ?? null;
      if (PROP_ROOT_NAME.test(name)) return "mask-accessory";
    }
    node = node.parent;
  }
  return null;
}

/**
 * Fall back to the protected-category heuristics the costume system already uses. The mesh's own
 * name wins; material names decide only when they agree and the node name says nothing, so a
 * multi-material "Body" primitive is not mislabelled by one of its materials.
 */
function maskFromNames(mesh: THREE.Mesh): CharacterSemanticMaskId | null {
  const own = classifyMeshName(mesh.name);
  if (own.protected) return PROTECTED_MASK[own.protected];

  const categories = new Set<ProtectedCategory>();
  for (const material of materialsOf(mesh)) {
    const category = classifyMeshName(material.name).protected;
    if (category) categories.add(category);
  }
  if (categories.size !== 1) return null;
  const [only] = [...categories];
  return PROTECTED_MASK[only];
}

/**
 * VRoid 계열은 눈·눈썹·속눈썹·얼굴을 한 메시(대개 이름에 Head가 들어간다)에 재질로만 나눠 담는다.
 * 메시 단위로만 분류하면 그 모델에서는 「눈」 레이어를 영영 만들 수 없으므로, 재질이 서로 다른
 * 부위를 가리키는 메시는 슬롯 단위로 쪼갠다. 재질 이름이 더 구체적이라 메시 이름을 이긴다.
 * 아무 말도 하지 않는 슬롯만 메시 이름의 분류로 되돌린다 — 얼굴을 눈이라 부르느니 그 슬롯을
 * 얼굴에 두는 쪽이 정직하다.
 */
function maskSlotsFromMaterials(mesh: THREE.Mesh): Map<number, CharacterSemanticMaskId> | null {
  if (!Array.isArray(mesh.material) || mesh.material.length < 2) return null;
  const own = classifyMeshName(mesh.name).protected;
  const fallback = own ? PROTECTED_MASK[own] : null;
  const slots = new Map<number, CharacterSemanticMaskId>();
  const seen = new Set<CharacterSemanticMaskId>();
  mesh.material.forEach((material, slot) => {
    if (!material) return;
    const category = classifyMeshName(material.name).protected;
    const mask = category ? PROTECTED_MASK[category] : fallback;
    if (!mask) return;
    slots.set(slot, mask);
    seen.add(mask);
  });
  // 슬롯이 전부 같은 마스크를 가리키면 쪼갤 이유가 없다 — 메시 단위 분류가 그대로 맞다.
  return seen.size > 1 ? slots : null;
}

/** 마스크 하나가 붙잡는 대상. `slots`가 있으면 그 메시의 해당 재질 슬롯만 이 마스크의 것이다. */
interface CharacterMaskTarget {
  readonly mesh: THREE.Mesh;
  readonly slots: ReadonlySet<number> | null;
}

interface CharacterMeshIndex {
  /** Every mesh the capture may toggle, in traversal order. */
  readonly meshes: readonly THREE.Mesh[];
  readonly groups: ReadonlyMap<CharacterSemanticMaskId, readonly CharacterMaskTarget[]>;
}

function indexCharacterMeshes(
  vrm: VRM,
  garmentRoots: readonly THREE.Object3D[],
  propRoots: readonly THREE.Object3D[],
): CharacterMeshIndex {
  const meshes: THREE.Mesh[] = [];
  const seen = new Set<THREE.Mesh>();
  const assigned = new Map<THREE.Mesh, CharacterSemanticMaskId>();

  const visit = (root: THREE.Object3D, forced: CharacterSemanticMaskId | null) => {
    root.traverse((object) => {
      if (!isMesh(object) || seen.has(object)) return;
      seen.add(object);
      meshes.push(object);
      const mask = forced ?? maskFromAncestry(object);
      if (mask) assigned.set(object, mask);
    });
  };

  visit(vrm.scene, null);
  for (const root of garmentRoots) visit(root, maskFromAncestry(root));
  for (const root of propRoots) visit(root, maskFromAncestry(root) ?? "mask-accessory");

  // Baked costume meshes are classified by the same collector the wardrobe panel uses.
  for (const entry of collectStudioVrmCostumeMeshes(vrm)) {
    if (assigned.has(entry.mesh)) continue;
    const mask = COSTUME_SLOT_MASK[entry.slot];
    if (mask) assigned.set(entry.mesh, mask);
  }

  const slotAssigned = new Map<THREE.Mesh, Map<number, CharacterSemanticMaskId>>();
  for (const mesh of meshes) {
    if (assigned.has(mesh)) continue;
    // 슬롯 분해가 먼저다. 메시 이름은 합쳐진 머리를 통째로 「얼굴」이라 부르므로, 그 판단을
    // 먼저 받아들이면 눈은 영원히 얼굴 안에 갇힌다.
    const slots = maskSlotsFromMaterials(mesh);
    if (slots) {
      slotAssigned.set(mesh, slots);
      continue;
    }
    const mask = maskFromNames(mesh);
    if (mask) assigned.set(mesh, mask);
  }

  const groups = new Map<CharacterSemanticMaskId, CharacterMaskTarget[]>();
  const push = (mask: CharacterSemanticMaskId, target: CharacterMaskTarget) => {
    const bucket = groups.get(mask) ?? [];
    bucket.push(target);
    groups.set(mask, bucket);
  };
  for (const [mesh, mask] of assigned) push(mask, { mesh, slots: null });
  for (const [mesh, slots] of slotAssigned) {
    const byMask = new Map<CharacterSemanticMaskId, Set<number>>();
    for (const [slot, mask] of slots) {
      const bucket = byMask.get(mask) ?? new Set<number>();
      bucket.add(slot);
      byMask.set(mask, bucket);
    }
    for (const [mask, slotSet] of byMask) push(mask, { mesh, slots: slotSet });
  }
  return { meshes, groups };
}

/* -------------------------------------------------------------------------- */
/* Reversible scene mutations                                                  */
/* -------------------------------------------------------------------------- */

function uniqueMaterials(meshes: readonly THREE.Mesh[]): THREE.Material[] {
  const seen = new Set<THREE.Material>();
  for (const mesh of meshes) {
    for (const material of materialsOf(mesh)) seen.add(material);
  }
  return [...seen];
}

interface ShadingRestore {
  readonly material: ShadingMaterial;
  readonly shade: ColorLike;
  readonly shift: number | undefined;
  readonly toony: number | undefined;
}

/**
 * Make MToon render its lit colour everywhere: the shade colour becomes the base colour and the
 * shading ramp is pushed fully to the lit side. Outline materials are left alone so the outline
 * draw survives into the flat pass, which is what the line pass harvests.
 */
function neutralizeCharacterShading(meshes: readonly THREE.Mesh[]): {
  readonly restore: () => void;
  readonly count: number;
} {
  const saved: ShadingRestore[] = [];
  for (const raw of uniqueMaterials(meshes)) {
    const material = raw as ShadingMaterial;
    if (!isStudioVrmMtoonMaterial(material)) continue;
    if (material.isOutline === true) continue;
    const shade = material.shadeColorFactor;
    if (!shade) continue;
    saved.push({
      material,
      shade: shade.clone(),
      shift: material.shadingShiftFactor,
      toony: material.shadingToonyFactor,
    });
    if (material.color) shade.copy(material.color);
    else shade.set(0xffffff);
    material.shadingShiftFactor = 1;
    material.shadingToonyFactor = 1;
    material.needsUpdate = true;
  }

  return {
    count: saved.length,
    restore: () => {
      for (const entry of saved) {
        entry.material.shadeColorFactor?.copy(entry.shade);
        entry.material.shadingShiftFactor = entry.shift;
        entry.material.shadingToonyFactor = entry.toony;
        entry.material.needsUpdate = true;
      }
    },
  };
}

/** Run one render with a scene mutation in place, undoing it even when the render throws. */
function withRestore<T>(restore: () => void, run: () => T): T {
  try {
    return run();
  } finally {
    restore();
  }
}

/**
 * Hide everything outside `targets`; the returned closure puts every flag back as it was.
 *
 * 슬롯만 남기는 대상은 메시를 켜 둔 채 나머지 재질의 색 기록만 끈다 — 재질을 갈아 끼우면
 * 셰이더가 다시 컴파일되고 복원이 어긋날 수 있는데, `colorWrite`는 둘 다 일으키지 않는다.
 */
function isolateVisibility(
  meshes: readonly THREE.Mesh[],
  targets: readonly CharacterMaskTarget[],
): () => void {
  const kept = new Map<THREE.Mesh, ReadonlySet<number> | null>();
  for (const target of targets) {
    // 같은 메시를 통째로 요구한 대상이 하나라도 있으면 그쪽이 이긴다.
    if (kept.get(target.mesh) === null) continue;
    if (target.slots === null) {
      kept.set(target.mesh, null);
      continue;
    }
    const merged = new Set(kept.get(target.mesh) ?? []);
    for (const slot of target.slots) merged.add(slot);
    kept.set(target.mesh, merged);
  }

  const previousVisible = meshes.map((mesh) => mesh.visible);
  const muted: { material: THREE.Material; colorWrite: boolean; depthWrite: boolean }[] = [];
  for (const mesh of meshes) {
    if (!kept.has(mesh)) {
      mesh.visible = false;
      continue;
    }
    const slots = kept.get(mesh) ?? null;
    if (slots === null || !Array.isArray(mesh.material)) continue;
    mesh.material.forEach((material, slot) => {
      if (!material || slots.has(slot)) return;
      muted.push({ material, colorWrite: material.colorWrite, depthWrite: material.depthWrite });
      material.colorWrite = false;
      // 깊이까지 꺼야 숨긴 슬롯이 남긴 슬롯을 가리지 않는다 — 메시 통째로 끌 때와 같은 결과다.
      material.depthWrite = false;
    });
  }

  return () => {
    meshes.forEach((mesh, index) => {
      mesh.visible = previousVisible[index];
    });
    for (const entry of muted) {
      entry.material.colorWrite = entry.colorWrite;
      entry.material.depthWrite = entry.depthWrite;
    }
  };
}

interface PaintRestore {
  readonly material: PaintableMaterial;
  readonly map: THREE.Texture | null | undefined;
  readonly color: ColorLike | undefined;
  readonly transparent: boolean;
  readonly colorWrite: boolean;
  readonly depthWrite: boolean;
}

/**
 * Bind the paint-only textures and mute every other material. Muting uses `colorWrite`/`depthWrite`
 * rather than mesh visibility because a mesh can mix a painted material with unpainted ones.
 */
function bindPaintTextures(
  meshes: readonly THREE.Mesh[],
  paint: ReadonlyMap<THREE.Material, THREE.Texture>,
): { readonly restore: () => void; readonly painted: number } {
  const saved: PaintRestore[] = [];
  let painted = 0;
  for (const raw of uniqueMaterials(meshes)) {
    const material = raw as PaintableMaterial;
    saved.push({
      material,
      map: material.map,
      color: material.color?.clone(),
      transparent: material.transparent,
      colorWrite: material.colorWrite,
      depthWrite: material.depthWrite,
    });
    const texture = paint.get(raw);
    if (texture) {
      material.map = texture;
      material.color?.set(0xffffff);
      material.transparent = true;
      material.needsUpdate = true;
      painted += 1;
    } else {
      material.colorWrite = false;
      material.depthWrite = false;
    }
  }

  return {
    painted,
    restore: () => {
      for (const entry of saved) {
        entry.material.map = entry.map;
        if (entry.color) entry.material.color?.copy(entry.color);
        entry.material.transparent = entry.transparent;
        entry.material.colorWrite = entry.colorWrite;
        entry.material.depthWrite = entry.depthWrite;
        entry.material.needsUpdate = true;
      }
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Capture                                                                     */
/* -------------------------------------------------------------------------- */

const DEFAULT_DEPENDENCIES: CharacterSemanticCaptureDependencies = {
  captureRgba: (renderer, scene, camera, dimensions) =>
    captureStudioVrmRgba(renderer, scene, camera, dimensions, { alpha: 0 }),
};

/**
 * Render every semantic pass the loaded model can honour. Scene mutations are always undone in
 * `finally`, so an abort or a WebGL failure leaves the viewport exactly as it was found.
 */
export async function captureCharacterSemanticPasses(
  input: CaptureCharacterSemanticPassesInput,
  dependencies: CharacterSemanticCaptureDependencies = DEFAULT_DEPENDENCIES,
): Promise<CharacterSemanticCaptureResult> {
  const { capture, vrm, signal } = input;
  const dimensions = boundCharacterSemanticCaptureSize(input.width, input.height);
  const { width, height } = dimensions;
  const passes: CharacterSemanticPass[] = [];
  const skipped: CharacterSemanticSkip[] = [];
  const record = (id: CharacterSemanticPassId, rgba: Uint8ClampedArray, emptyReason: string) => {
    if (isEmptyPass(rgba)) skipped.push({ pass: id, reason: emptyReason });
    else passes.push({ id, width, height, rgba });
  };
  const render = () =>
    dependencies.captureRgba(capture.gl, capture.scene, capture.camera, dimensions);

  if (signal?.aborted) throw abortError();
  const index = indexCharacterMeshes(vrm, input.garmentRoots ?? [], input.propRoots ?? []);

  const beauty = render();
  record("beauty", beauty, "모델이 화면에 보이지 않아 미리보기 패스를 만들지 못했습니다.");

  await betweenPasses(signal);
  const shading = neutralizeCharacterShading(index.meshes);
  const flat = withRestore(shading.restore, render);
  record("flat", flat, "모델이 화면에 보이지 않아 밑색 패스를 만들지 못했습니다.");

  const shadingReason = shading.count === 0
    ? "MToon(툰) 재질이 없어 음영과 하이라이트를 분리하지 못했습니다."
    : "빛과 그림자 차이가 없어 레이어를 만들지 않았습니다.";
  record("shadow", subtractClamped(flat, beauty), shadingReason);
  record("highlight", subtractClamped(beauty, flat), shadingReason);
  record(
    "line",
    unionAlpha(
      sobelEdgeAlpha(beauty, width, height, { inkColor: CHARACTER_INK_HEX }),
      nearBlackAlpha(flat, CHARACTER_NEAR_BLACK_THRESHOLD),
    ),
    "외곽선으로 뽑을 만한 경계가 없습니다.",
  );

  await betweenPasses(signal);
  const paint = input.paintTextureProvider ? input.paintTextureProvider() : null;
  if (!input.paintTextureProvider) {
    skipped.push({
      pass: "surface-paint",
      reason: "표면 드로잉을 켜지 않아 드로잉 레이어를 만들지 않았습니다.",
    });
  } else if (!paint || paint.size === 0) {
    skipped.push({
      pass: "surface-paint",
      reason: "모델 위에 칠한 획이 없어 드로잉 레이어를 만들지 않았습니다.",
    });
  } else {
    // The drawing layer must carry the strokes, not the strokes with the light rig baked in. Bind
    // the paint textures first so neutralising shading picks up the white base the binding just
    // set; the restores then run in reverse order.
    const bound = bindPaintTextures(index.meshes, paint);
    const paintShading = neutralizeCharacterShading(index.meshes);
    const painted = withRestore(() => {
      paintShading.restore();
      bound.restore();
    }, render);
    record(
      "surface-paint",
      painted,
      bound.painted === 0
        ? "표면 드로잉 텍스처가 현재 모델의 재질과 연결되지 않았습니다."
        : "칠한 획이 현재 시점에서 보이지 않습니다.",
    );
  }

  for (const mask of CHARACTER_SEMANTIC_MASK_ORDER) {
    const keep = index.groups.get(mask);
    if (!keep || keep.length === 0) {
      skipped.push({ pass: mask, reason: MASK_NOT_FOUND_REASONS[mask] });
      continue;
    }
    await betweenPasses(signal);
    const isolated = withRestore(isolateVisibility(index.meshes, keep), render);
    record(
      mask,
      alphaOnly(isolated),
      `${CHARACTER_SEMANTIC_MASK_LABELS[mask]} 영역이 현재 시점에서 보이지 않습니다.`,
    );
  }

  return { passes, skipped };
}

/* -------------------------------------------------------------------------- */
/* PSD assembly                                                                */
/* -------------------------------------------------------------------------- */

function escapeXml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}

function titleXmp(title: string): string {
  return [
    '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>',
    '<x:xmpmeta xmlns:x="adobe:ns:meta/">',
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
    '<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">',
    `<dc:title><rdf:Alt><rdf:li xml:lang="x-default">${escapeXml(title)}</rdf:li></rdf:Alt></dc:title>`,
    "</rdf:Description>",
    "</rdf:RDF>",
    "</x:xmpmeta>",
    '<?xpacket end="w"?>',
  ].join("");
}

function rasterLayer(
  name: string,
  width: number,
  height: number,
  data: Uint8ClampedArray,
  extra: Partial<Layer> = {},
): Layer {
  return {
    name,
    top: 0,
    left: 0,
    bottom: height,
    right: width,
    opacity: 1,
    blendMode: "normal",
    imageData: { width, height, data },
    ...extra,
  };
}

function group(name: string, blendMode: BlendMode, children: Layer[]): Layer {
  return { name, opened: true, blendMode, opacity: 1, children };
}

function collectLayerNames(layers: readonly Layer[]): string[] {
  const names: string[] = [];
  for (const layer of layers) {
    names.push(layer.name ?? "");
    if (layer.children) names.push(...collectLayerNames(layer.children));
  }
  return names;
}

/**
 * Assemble the passes into one PSD in the order a colourist expects to find them:
 * 주선 → 표면 드로잉 → 하이라이트 → 음영 → 밑색 → 미리보기, top to bottom.
 *
 * `ag-psd` writes `children[0]` as the topmost layer, so this array is already in panel order — no
 * reversal. Passes that never arrived, and masks that came back empty, are added to the receipt's
 * `skipped` list instead of becoming blank layers.
 */
export function buildCharacterSemanticPsd(
  passes: readonly CharacterSemanticPass[],
  skipped: readonly CharacterSemanticSkip[],
  options: BuildCharacterSemanticPsdOptions,
): CharacterSemanticPsdResult {
  if (passes.length === 0) throw new Error("PSD로 저장할 렌더 패스가 없습니다.");
  const { width, height } = passes[0];
  const byId = new Map<CharacterSemanticPassId, CharacterSemanticPass>();
  for (const pass of passes) {
    if (pass.width !== width || pass.height !== height || pass.rgba.length !== width * height * 4) {
      throw new TypeError("렌더 패스 크기가 서로 달라 PSD를 만들 수 없습니다.");
    }
    byId.set(pass.id, pass);
  }

  const notes: CharacterSemanticSkip[] = [...skipped];
  const note = (pass: CharacterSemanticPassId, reason: string) => {
    if (notes.some((entry) => entry.pass === pass)) return;
    notes.push({ pass, reason });
  };

  const beauty = byId.get("beauty") ?? null;
  const flat = byId.get("flat") ?? null;
  const base = flat ?? beauty;

  const flatChildren: Layer[] = [];
  for (const mask of CHARACTER_SEMANTIC_MASK_ORDER) {
    const pass = byId.get(mask);
    if (!pass) continue;
    if (isEmptyPass(pass.rgba)) {
      note(mask, `${CHARACTER_SEMANTIC_MASK_LABELS[mask]} 마스크가 비어 있어 레이어를 만들지 않았습니다.`);
      continue;
    }
    const data = base ? maskMultiply(base.rgba, pass.rgba) : pass.rgba;
    flatChildren.push(rasterLayer(CHARACTER_SEMANTIC_MASK_LABELS[mask], width, height, data));
  }

  const children: Layer[] = [];
  const line = byId.get("line");
  if (line) {
    children.push(group(CHARACTER_PSD_GROUP_NAMES.line, "normal", [
      rasterLayer(CHARACTER_PSD_CHILD_NAMES.line, width, height, line.rgba),
    ]));
  }
  const paint = byId.get("surface-paint");
  if (paint) {
    children.push(group(CHARACTER_PSD_GROUP_NAMES.paint, "normal", [
      rasterLayer(CHARACTER_PSD_CHILD_NAMES.paint, width, height, paint.rgba),
    ]));
  }
  const highlight = byId.get("highlight");
  if (highlight) {
    children.push(group(CHARACTER_PSD_GROUP_NAMES.highlight, "screen", [
      rasterLayer(CHARACTER_PSD_CHILD_NAMES.highlight, width, height, highlight.rgba, {
        blendMode: "screen",
      }),
    ]));
  }
  const shadow = byId.get("shadow");
  if (shadow) {
    children.push(group(CHARACTER_PSD_GROUP_NAMES.shadow, "multiply", [
      rasterLayer(CHARACTER_PSD_CHILD_NAMES.shadow, width, height, shadow.rgba, {
        blendMode: "multiply",
      }),
    ]));
  }
  if (flatChildren.length > 0) {
    children.push(group(CHARACTER_PSD_GROUP_NAMES.flats, "normal", flatChildren));
  } else if (base) {
    // No mask separated cleanly — ship the un-split flat instead of an empty group, and say so.
    note("flat", "부위별 마스크를 분리하지 못해 밑색을 한 장으로 저장했습니다.");
    children.push(group(CHARACTER_PSD_GROUP_NAMES.flats, "normal", [
      rasterLayer(CHARACTER_PSD_CHILD_NAMES.flatsWhole, width, height, base.rgba),
    ]));
  }
  if (beauty) {
    children.push(rasterLayer(CHARACTER_PSD_PREVIEW_LAYER_NAME, width, height, beauty.rgba, {
      hidden: true,
    }));
  }
  if (children.length === 0) throw new Error("PSD로 저장할 레이어가 없습니다.");

  const psd: Psd = {
    width,
    height,
    children,
    imageResources: { xmpMetadata: titleXmp(options.title) },
  };

  let buffer: ArrayBuffer;
  try {
    buffer = writePsd(psd, {
      noBackground: true,
      generateThumbnail: false,
      trimImageData: false,
    });
  } catch (error) {
    throw new Error(
      `PSD 파일을 만들지 못했습니다: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }

  return {
    blob: new Blob([buffer], { type: PSD_MIME }),
    receipt: {
      width,
      height,
      layerNames: collectLayerNames(children),
      skipped: notes,
      byteLength: buffer.byteLength,
    },
  };
}

/** Capture the passes and assemble the PSD in one call — what the output dock invokes. */
export async function exportCharacterSemanticPsd(
  input: ExportCharacterSemanticPsdInput,
  dependencies: CharacterSemanticCaptureDependencies = DEFAULT_DEPENDENCIES,
): Promise<CharacterSemanticPsdResult> {
  const { passes, skipped } = await captureCharacterSemanticPasses(input, dependencies);
  return buildCharacterSemanticPsd(passes, skipped, { title: input.title });
}
