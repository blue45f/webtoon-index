import { writePsd } from "ag-psd";

export const STUDIO_VRM_COMPONENT_PSD_VERSION = 1 as const;

export type StudioVrmComponentPassKind =
  | "line"
  | "base-color"
  | "shadow"
  | "highlight"
  | "eyes"
  | "hair"
  | "skin"
  | "clothes"
  | "props"
  | "depth"
  | "material-id";

export type StudioVrmComponentPass = Readonly<{
  id: string;
  kind: StudioVrmComponentPassKind;
  name: string;
  width: number;
  height: number;
  rgba: Uint8Array | Uint8ClampedArray;
  opacity?: number;
  visible?: boolean;
  blendMode?: StudioVrmComponentPsdBlendMode;
}>;

export type StudioVrmComponentPsdBlendMode =
  | "normal"
  | "multiply"
  | "screen"
  | "overlay"
  | "soft light";

export type StudioVrmLinkedSceneDescriptor = Readonly<{
  sceneId: string;
  sceneRevision: number;
  cameraId: string;
  renderPresetId: string;
  width: number;
  height: number;
}>;

export type StudioVrmComponentPassReceipt = Readonly<{
  id: string;
  kind: StudioVrmComponentPassKind;
  layerName: string;
  groupName: string;
  blendMode: StudioVrmComponentPsdBlendMode;
  opacity: number;
  sha256: string;
}>;

export type StudioVrmLinkedRenderManifest = Readonly<{
  kind: "toonstudio.vrm-linked-render";
  version: typeof STUDIO_VRM_COMPONENT_PSD_VERSION;
  scene: StudioVrmLinkedSceneDescriptor;
  sourceDigest: string;
  passes: readonly StudioVrmComponentPassReceipt[];
}>;

export type StudioVrmComponentPsdPackage = Readonly<{
  bytes: Uint8Array;
  manifest: StudioVrmLinkedRenderManifest;
  manifestJson: string;
}>;

type AgPsdDocument = Parameters<typeof writePsd>[0];

type PreparedPass = Readonly<{
  source: StudioVrmComponentPass;
  id: string;
  layerName: string;
  groupName: string;
  blendMode: StudioVrmComponentPsdBlendMode;
  opacity: number;
  visible: boolean;
  rgba: Uint8ClampedArray;
}>;

const GROUP_ORDER: readonly StudioVrmComponentPassKind[] = Object.freeze([
  "line",
  "highlight",
  "props",
  "clothes",
  "hair",
  "eyes",
  "skin",
  "shadow",
  "base-color",
  "material-id",
  "depth",
]);

const GROUP_LABELS: Readonly<Record<StudioVrmComponentPassKind, string>> = Object.freeze({
  line: "01 Line",
  highlight: "02 Highlight",
  props: "03 Props",
  clothes: "04 Clothes",
  hair: "05 Hair",
  eyes: "06 Eyes",
  skin: "07 Skin",
  shadow: "08 Shadow",
  "base-color": "09 Base Color",
  "material-id": "90 Material ID",
  depth: "91 Depth",
});

const DEFAULT_BLEND_MODES: Readonly<Record<StudioVrmComponentPassKind, StudioVrmComponentPsdBlendMode>> = Object.freeze({
  line: "multiply",
  highlight: "screen",
  props: "normal",
  clothes: "normal",
  hair: "normal",
  eyes: "normal",
  skin: "normal",
  shadow: "multiply",
  "base-color": "normal",
  "material-id": "normal",
  depth: "normal",
});

function finiteInteger(value: number, label: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be a safe integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function finiteUnit(value: number | undefined, fallback: number, label: string): number {
  const resolved = value ?? fallback;
  if (!Number.isFinite(resolved) || resolved < 0 || resolved > 1) {
    throw new Error(`${label} must be a finite number between 0 and 1`);
  }
  return resolved;
}

function safeIdentifier(value: string, label: string): string {
  const resolved = value.normalize("NFKC").trim();
  // Rejecting ASCII control bytes is the point: these names reach PSD layer records and a
  // filesystem path.
  // eslint-disable-next-line no-control-regex
  if (!resolved || resolved.length > 160 || /[\u0000-\u001f\u007f]/u.test(resolved)) {
    throw new Error(`${label} must contain 1-160 visible characters`);
  }
  return resolved;
}

function safeLayerName(value: string): string {
  const normalized = safeIdentifier(value, "pass.name")
    .replace(/[\\/:*?"<>|]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (!normalized) throw new Error("pass.name does not contain a portable PSD layer name");
  return normalized.slice(0, 120);
}

function preparePasses(
  scene: StudioVrmLinkedSceneDescriptor,
  passes: readonly StudioVrmComponentPass[],
): readonly PreparedPass[] {
  if (!passes.length) throw new Error("at least one component pass is required");
  const ids = new Set<string>();
  return Object.freeze(passes.map((pass) => {
    const id = safeIdentifier(pass.id, "pass.id");
    if (ids.has(id)) throw new Error(`duplicate component pass id: ${id}`);
    ids.add(id);
    if (pass.width !== scene.width || pass.height !== scene.height) {
      throw new Error(`component pass ${id} must match the linked scene dimensions`);
    }
    const expectedBytes = scene.width * scene.height * 4;
    if (!(pass.rgba instanceof Uint8Array) || pass.rgba.byteLength !== expectedBytes) {
      throw new Error(`component pass ${id} must contain exactly ${expectedBytes} RGBA bytes`);
    }
    return Object.freeze({
      source: pass,
      id,
      layerName: safeLayerName(pass.name),
      groupName: GROUP_LABELS[pass.kind],
      blendMode: pass.blendMode ?? DEFAULT_BLEND_MODES[pass.kind],
      opacity: finiteUnit(pass.opacity, 1, `component pass ${id} opacity`),
      visible: pass.visible !== false,
      rgba: new Uint8ClampedArray(pass.rgba),
    });
  }));
}

/**
 * Validates and freezes a linked scene descriptor.
 *
 * Exported so the export job can check dimensions *before* it starts rendering. The PSD writer
 * runs this too, but it only sees the scene after every pass has been captured — a zero-width
 * scene would otherwise cost a full set of scene renders before anything complained.
 */
export function validateStudioVrmLinkedScene(
  raw: StudioVrmLinkedSceneDescriptor,
): StudioVrmLinkedSceneDescriptor {
  const scene = Object.freeze({
    sceneId: safeIdentifier(raw.sceneId, "scene.sceneId"),
    sceneRevision: finiteInteger(raw.sceneRevision, "scene.sceneRevision", 0, Number.MAX_SAFE_INTEGER),
    cameraId: safeIdentifier(raw.cameraId, "scene.cameraId"),
    renderPresetId: safeIdentifier(raw.renderPresetId, "scene.renderPresetId"),
    width: finiteInteger(raw.width, "scene.width", 1, 16_384),
    height: finiteInteger(raw.height, "scene.height", 1, 16_384),
  });
  if (scene.width * scene.height > 67_108_864) {
    throw new Error("linked render dimensions exceed the 64-megapixel safety budget");
  }
  return scene;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Accepts either byte view: pass RGBA arrives as `Uint8ClampedArray` from ImageData. */
async function sha256(bytes: Uint8Array | Uint8ClampedArray): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("Web Crypto SHA-256 is required for linked render receipts");
  // Copy into an ArrayBuffer-backed view first. A `Uint8Array` may sit on a SharedArrayBuffer,
  // which `BufferSource` excludes and which Web Crypto rejects at runtime in several engines —
  // and this module runs behind cross-origin isolation, where shared buffers are exactly what
  // the worker hands back.
  const source = new Uint8Array(bytes.byteLength);
  source.set(bytes);
  const digest = await subtle.digest("SHA-256", source);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

function layerFor(pass: PreparedPass, width: number, height: number) {
  return {
    name: pass.layerName,
    left: 0,
    top: 0,
    right: width,
    bottom: height,
    opacity: Math.round(pass.opacity * 255),
    hidden: !pass.visible,
    blendMode: pass.blendMode,
    imageData: {
      width,
      height,
      data: new Uint8ClampedArray(pass.rgba),
    },
  };
}

export function buildStudioVrmComponentPsdDocument(
  rawScene: StudioVrmLinkedSceneDescriptor,
  rawPasses: readonly StudioVrmComponentPass[],
): AgPsdDocument {
  const scene = validateStudioVrmLinkedScene(rawScene);
  const passes = preparePasses(scene, rawPasses);
  const children = GROUP_ORDER.flatMap((kind) => {
    const grouped = passes.filter((pass) => pass.source.kind === kind);
    if (!grouped.length) return [];
    return [{
      name: GROUP_LABELS[kind],
      opened: true,
      children: grouped.map((pass) => layerFor(pass, scene.width, scene.height)),
    }];
  });
  return {
    width: scene.width,
    height: scene.height,
    children: [{ name: "Character", opened: true, children }],
  } as unknown as AgPsdDocument;
}

export async function createStudioVrmLinkedRenderManifest(
  rawScene: StudioVrmLinkedSceneDescriptor,
  rawPasses: readonly StudioVrmComponentPass[],
): Promise<StudioVrmLinkedRenderManifest> {
  const scene = validateStudioVrmLinkedScene(rawScene);
  const passes = preparePasses(scene, rawPasses);
  const receipts = await Promise.all(passes.map(async (pass): Promise<StudioVrmComponentPassReceipt> => Object.freeze({
    id: pass.id,
    kind: pass.source.kind,
    layerName: pass.layerName,
    groupName: pass.groupName,
    blendMode: pass.blendMode,
    opacity: pass.opacity,
    sha256: await sha256(pass.rgba),
  })));
  const sourceDigest = await sha256(new TextEncoder().encode(canonicalJson(scene)));
  return Object.freeze({
    kind: "toonstudio.vrm-linked-render",
    version: STUDIO_VRM_COMPONENT_PSD_VERSION,
    scene,
    sourceDigest,
    passes: Object.freeze(receipts),
  });
}

export async function writeStudioVrmComponentPsd(
  rawScene: StudioVrmLinkedSceneDescriptor,
  rawPasses: readonly StudioVrmComponentPass[],
): Promise<StudioVrmComponentPsdPackage> {
  const document = buildStudioVrmComponentPsdDocument(rawScene, rawPasses);
  const manifest = await createStudioVrmLinkedRenderManifest(rawScene, rawPasses);
  const bytes = new Uint8Array(writePsd(document));
  if (bytes.byteLength < 26 || new TextDecoder("ascii").decode(bytes.subarray(0, 4)) !== "8BPS") {
    throw new Error("ag-psd did not produce a valid PSD signature");
  }
  return Object.freeze({
    bytes,
    manifest,
    manifestJson: `${JSON.stringify(manifest, null, 2)}\n`,
  });
}

export function studioVrmLinkedRenderNeedsRefresh(
  manifest: StudioVrmLinkedRenderManifest | null | undefined,
  next: StudioVrmLinkedSceneDescriptor,
): boolean {
  if (!manifest || manifest.kind !== "toonstudio.vrm-linked-render" || manifest.version !== STUDIO_VRM_COMPONENT_PSD_VERSION) {
    return true;
  }
  const scene = validateStudioVrmLinkedScene(next);
  return (
    manifest.scene.sceneId !== scene.sceneId
    || manifest.scene.sceneRevision !== scene.sceneRevision
    || manifest.scene.cameraId !== scene.cameraId
    || manifest.scene.renderPresetId !== scene.renderPresetId
    || manifest.scene.width !== scene.width
    || manifest.scene.height !== scene.height
  );
}
