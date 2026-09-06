import type { StudioVrmComponentPassKind } from "./studio-vrm-component-psd";

export type StudioVrmCharacterComponentKind =
  | "hair"
  | "skin"
  | "eyes"
  | "clothes"
  | "props"
  | "unclassified";

export type StudioVrmRenderableDescriptor = Readonly<{
  objectId: string;
  objectName: string;
  materialId?: string;
  materialName?: string;
  visible?: boolean;
  objectUserData?: Readonly<Record<string, unknown>>;
  materialUserData?: Readonly<Record<string, unknown>>;
}>;

export type StudioVrmComponentClassification = Readonly<{
  renderableId: string;
  component: StudioVrmCharacterComponentKind;
  confidence: "explicit" | "strong" | "weak" | "unclassified";
  reason: string;
}>;

export type StudioVrmComponentCaptureRequest = Readonly<{
  id: string;
  kind: StudioVrmComponentPassKind;
  label: string;
  includeRenderableIds: readonly string[];
  utility: boolean;
  renderMode:
    | "line"
    | "base-color"
    | "shadow"
    | "highlight"
    | "depth"
    | "material-id";
}>;

export type StudioVrmComponentCapturePlan = Readonly<{
  kind: "toonstudio.vrm-component-capture-plan";
  version: 1;
  renderableCount: number;
  visibleRenderableCount: number;
  classifications: readonly StudioVrmComponentClassification[];
  requests: readonly StudioVrmComponentCaptureRequest[];
  unclassifiedRenderableIds: readonly string[];
  requiresReview: boolean;
  signature: string;
}>;

const MAX_RENDERABLES = 20_000;

const COMPONENTS = new Set<StudioVrmCharacterComponentKind>([
  "hair",
  "skin",
  "eyes",
  "clothes",
  "props",
  "unclassified",
]);

const COMPONENT_LABELS: Readonly<Record<Exclude<StudioVrmCharacterComponentKind, "unclassified">, string>> = Object.freeze({
  hair: "Hair",
  skin: "Skin",
  eyes: "Eyes",
  clothes: "Clothes",
  props: "Props",
});

const EXPLICIT_KEYS = Object.freeze([
  "toonstudioComponent",
  "toonstudio_component",
  "toonstudioRole",
  "toonstudio_role",
]);

const TOKEN_WEIGHTS: Readonly<Record<Exclude<StudioVrmCharacterComponentKind, "unclassified">, Readonly<Record<string, number>>>> = Object.freeze({
  hair: Object.freeze({
    hair: 8, bangs: 8, bang: 7, fringe: 7, ponytail: 8, braid: 7, scalp: 6,
    eyebrow: 4, brow: 3, kami: 8, 머리: 8, 앞머리: 9, 뒷머리: 9, 눈썹: 4,
  }),
  skin: Object.freeze({
    skin: 9, face: 8, facial: 7, head: 5, body: 4, hand: 4, arm: 2, leg: 2,
    피부: 9, 얼굴: 9, 몸: 4, 손: 4,
  }),
  eyes: Object.freeze({
    eye: 8, eyes: 8, iris: 9, pupil: 9, eyeball: 9, cornea: 7,
    눈: 8, 홍채: 9, 동공: 9,
  }),
  clothes: Object.freeze({
    cloth: 7, clothes: 8, clothing: 8, outfit: 9, costume: 8, shirt: 8, jacket: 8,
    coat: 7, dress: 8, skirt: 8, pants: 8, trousers: 8, shoe: 6, shoes: 6, boot: 6,
    uniform: 8, sleeve: 6, 의상: 9, 옷: 8, 치마: 8, 바지: 8, 신발: 7,
  }),
  props: Object.freeze({
    prop: 9, props: 9, accessory: 8, accessories: 8, glasses: 8, eyeglasses: 8,
    hat: 7, bag: 7, weapon: 8, sword: 7, gun: 7, shield: 7, jewelry: 7,
    소품: 9, 안경: 8, 모자: 7, 가방: 7, 무기: 8,
  }),
});

function visibleString(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  const resolved = value.normalize("NFKC").trim();
  // Rejecting ASCII control bytes is the point: these names reach PSD layer records and a
  // filesystem path.
  // eslint-disable-next-line no-control-regex
  if (!resolved || resolved.length > 240 || /[\u0000-\u001f\u007f]/u.test(resolved)) {
    throw new Error(`${label} must contain 1-240 visible characters`);
  }
  return resolved;
}

function portableId(value: unknown, label: string): string {
  const resolved = visibleString(value, label);
  if (!/^[\p{L}\p{N}][\p{L}\p{N}._:@/-]*$/u.test(resolved)) {
    throw new Error(`${label} contains unsupported identifier characters`);
  }
  return resolved;
}

function normalizeComponent(value: unknown): StudioVrmCharacterComponentKind | null {
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFKC").trim().toLocaleLowerCase("en-US");
  const aliases: Readonly<Record<string, StudioVrmCharacterComponentKind>> = {
    hair: "hair",
    헤어: "hair",
    머리: "hair",
    skin: "skin",
    body: "skin",
    피부: "skin",
    eyes: "eyes",
    eye: "eyes",
    눈: "eyes",
    clothes: "clothes",
    clothing: "clothes",
    outfit: "clothes",
    의상: "clothes",
    옷: "clothes",
    props: "props",
    prop: "props",
    accessory: "props",
    소품: "props",
  };
  const resolved = aliases[normalized] ?? normalized;
  return COMPONENTS.has(resolved as StudioVrmCharacterComponentKind)
    ? resolved as StudioVrmCharacterComponentKind
    : null;
}

function explicitComponent(descriptor: StudioVrmRenderableDescriptor): StudioVrmCharacterComponentKind | null {
  for (const source of [descriptor.objectUserData, descriptor.materialUserData]) {
    if (!source) continue;
    for (const key of EXPLICIT_KEYS) {
      const component = normalizeComponent(source[key]);
      if (component && component !== "unclassified") return component;
    }
  }
  return null;
}

function tokenize(value: string): readonly string[] {
  const expanded = value
    .normalize("NFKC")
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .toLocaleLowerCase("en-US");
  return Object.freeze(expanded.split(/[^\p{L}\p{N}]+/gu).filter(Boolean));
}

function heuristicComponent(descriptor: StudioVrmRenderableDescriptor): StudioVrmComponentClassification {
  const renderableId = descriptor.materialId
    ? `${descriptor.objectId}:${descriptor.materialId}`
    : descriptor.objectId;
  const tokens = tokenize(`${descriptor.objectName} ${descriptor.materialName ?? ""}`);
  const scores = new Map<Exclude<StudioVrmCharacterComponentKind, "unclassified">, number>();
  for (const component of Object.keys(TOKEN_WEIGHTS) as Array<Exclude<StudioVrmCharacterComponentKind, "unclassified">>) {
    const weights = TOKEN_WEIGHTS[component];
    scores.set(component, tokens.reduce((sum, token) => sum + (weights[token] ?? 0), 0));
  }
  const ranked = [...scores.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  const [winner, score] = ranked[0] ?? ["unclassified", 0];
  const runnerUp = ranked[1]?.[1] ?? 0;
  if (score <= 0 || score === runnerUp) {
    return Object.freeze({
      renderableId,
      component: "unclassified",
      confidence: "unclassified",
      reason: score === runnerUp && score > 0
        ? `ambiguous name tokens: ${tokens.join(", ")}`
        : "no explicit component metadata or strong name token",
    });
  }
  const confidence = score >= 8 && score - runnerUp >= 3 ? "strong" : "weak";
  return Object.freeze({
    renderableId,
    component: winner,
    confidence,
    reason: `${confidence} name classification from: ${tokens.join(", ")}`,
  });
}

function classify(descriptor: StudioVrmRenderableDescriptor): StudioVrmComponentClassification {
  const objectId = portableId(descriptor.objectId, "renderable.objectId");
  const materialId = descriptor.materialId
    ? portableId(descriptor.materialId, "renderable.materialId")
    : null;
  const normalized: StudioVrmRenderableDescriptor = {
    ...descriptor,
    objectId,
    objectName: visibleString(descriptor.objectName, "renderable.objectName"),
    ...(materialId ? { materialId } : {}),
    ...(descriptor.materialName
      ? { materialName: visibleString(descriptor.materialName, "renderable.materialName") }
      : {}),
  };
  const renderableId = materialId ? `${objectId}:${materialId}` : objectId;
  const explicit = explicitComponent(normalized);
  if (explicit) {
    return Object.freeze({
      renderableId,
      component: explicit,
      confidence: "explicit",
      reason: "explicit ToonStudio component metadata",
    });
  }
  return heuristicComponent(normalized);
}

function canonicalSignature(classifications: readonly StudioVrmComponentClassification[]): string {
  return classifications
    .map((classification) => [
      classification.renderableId,
      classification.component,
      classification.confidence,
    ].join("="))
    .join("|");
}

function request(
  id: string,
  kind: StudioVrmComponentPassKind,
  label: string,
  renderMode: StudioVrmComponentCaptureRequest["renderMode"],
  ids: readonly string[],
  utility = false,
): StudioVrmComponentCaptureRequest {
  return Object.freeze({
    id,
    kind,
    label,
    renderMode,
    includeRenderableIds: Object.freeze([...ids]),
    utility,
  });
}

export function buildStudioVrmComponentCapturePlan(
  rawDescriptors: readonly StudioVrmRenderableDescriptor[],
): StudioVrmComponentCapturePlan {
  if (!Array.isArray(rawDescriptors) || !rawDescriptors.length) {
    throw new Error("at least one VRM renderable descriptor is required");
  }
  if (rawDescriptors.length > MAX_RENDERABLES) {
    throw new Error(`VRM component capture is limited to ${MAX_RENDERABLES} renderables`);
  }
  const ids = new Set<string>();
  const visibleDescriptors = rawDescriptors.filter((descriptor) => descriptor.visible !== false);
  const classifications = visibleDescriptors.map(classify).sort((left, right) => left.renderableId.localeCompare(right.renderableId));
  for (const classification of classifications) {
    if (ids.has(classification.renderableId)) {
      throw new Error(`duplicate VRM renderable id: ${classification.renderableId}`);
    }
    ids.add(classification.renderableId);
  }
  const all = Object.freeze(classifications.map((classification) => classification.renderableId));
  const requests: StudioVrmComponentCaptureRequest[] = [
    request("line", "line", "Line", "line", all),
    request("highlight", "highlight", "Highlight", "highlight", all),
  ];
  for (const component of ["props", "clothes", "hair", "eyes", "skin"] as const) {
    const matching = classifications
      .filter((classification) => classification.component === component)
      .map((classification) => classification.renderableId);
    if (matching.length) requests.push(request(component, component, COMPONENT_LABELS[component], "base-color", matching));
  }
  requests.push(
    request("shadow", "shadow", "Shadow", "shadow", all),
    request("base-color", "base-color", "Base Color", "base-color", all),
    request("material-id", "material-id", "Material ID", "material-id", all, true),
    request("depth", "depth", "Depth", "depth", all, true),
  );
  const unclassified = Object.freeze(classifications
    .filter((classification) => classification.component === "unclassified")
    .map((classification) => classification.renderableId));
  const weak = classifications.some((classification) => classification.confidence === "weak");
  return Object.freeze({
    kind: "toonstudio.vrm-component-capture-plan",
    version: 1,
    renderableCount: rawDescriptors.length,
    visibleRenderableCount: visibleDescriptors.length,
    classifications: Object.freeze(classifications),
    requests: Object.freeze(requests),
    unclassifiedRenderableIds: unclassified,
    requiresReview: unclassified.length > 0 || weak,
    signature: canonicalSignature(classifications),
  });
}
