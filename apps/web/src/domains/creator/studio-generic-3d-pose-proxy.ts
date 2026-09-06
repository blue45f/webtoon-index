import type {
  StudioGeneric3dModelManifest,
  StudioGeneric3dRigStatus,
} from "./studio-generic-3d-model-mode";

export type StudioGeneric3dPoseProxyRole =
  | "root"
  | "head"
  | "torso"
  | "pelvis"
  | "left-arm"
  | "right-arm"
  | "left-hand"
  | "right-hand"
  | "left-leg"
  | "right-leg"
  | "left-foot"
  | "right-foot"
  | "custom";

export type StudioGeneric3dPoseProxyKind = "root" | "bone" | "node" | "guide";
export type StudioGeneric3dPoseProxyOperation =
  | "root-transform"
  | "bone-rotate"
  | "node-transform"
  | "guide-only";

export interface StudioGeneric3dPoseNodeEvidence {
  readonly key: string;
  readonly name: string;
  readonly parentKey?: string | null;
  readonly isBone?: boolean;
  readonly hasRenderable?: boolean;
}

export interface StudioGeneric3dPoseProxy {
  readonly id: string;
  readonly role: StudioGeneric3dPoseProxyRole;
  readonly label: string;
  readonly kind: StudioGeneric3dPoseProxyKind;
  readonly operation: StudioGeneric3dPoseProxyOperation;
  readonly targetKey: string | null;
  /** Normalized character-space anchor. It is also useful for overlay hit-target placement. */
  readonly anchor: readonly [number, number, number];
  readonly canApply: boolean;
  readonly deformsMesh: boolean;
  readonly detail: string;
}

export interface StudioGeneric3dProxyTransform {
  readonly translation: readonly [number, number, number];
  readonly rotationDegrees: readonly [number, number, number];
  readonly scale: readonly [number, number, number];
}

export interface StudioGeneric3dProxyTransformCommand {
  readonly target: "model-root" | "bone" | "node";
  readonly targetKey: string | null;
  readonly translation: readonly [number, number, number];
  readonly rotationDegrees: readonly [number, number, number];
  readonly scale: readonly [number, number, number];
  readonly deformsMesh: boolean;
}

const MAX_NODES = 4_096;
const MAX_CUSTOM_PROXIES = 12;
const MAX_KEY_CODE_POINTS = 160;
const ZERO_VECTOR = Object.freeze([0, 0, 0] as const);
const ONE_VECTOR = Object.freeze([1, 1, 1] as const);

const ROLE_LABELS: Readonly<Record<StudioGeneric3dPoseProxyRole, string>> = Object.freeze({
  root: "전체",
  head: "머리",
  torso: "상체",
  pelvis: "골반",
  "left-arm": "왼팔",
  "right-arm": "오른팔",
  "left-hand": "왼손",
  "right-hand": "오른손",
  "left-leg": "왼다리",
  "right-leg": "오른다리",
  "left-foot": "왼발",
  "right-foot": "오른발",
  custom: "사용자 부위",
});

const ROLE_ANCHORS: Readonly<
  Record<Exclude<StudioGeneric3dPoseProxyRole, "custom">, readonly [number, number, number]>
> = Object.freeze({
  root: ZERO_VECTOR,
  head: Object.freeze([0, 0.88, 0] as const),
  torso: Object.freeze([0, 0.62, 0] as const),
  pelvis: Object.freeze([0, 0.38, 0] as const),
  "left-arm": Object.freeze([-0.34, 0.64, 0] as const),
  "right-arm": Object.freeze([0.34, 0.64, 0] as const),
  "left-hand": Object.freeze([-0.56, 0.51, 0] as const),
  "right-hand": Object.freeze([0.56, 0.51, 0] as const),
  "left-leg": Object.freeze([-0.15, 0.2, 0] as const),
  "right-leg": Object.freeze([0.15, 0.2, 0] as const),
  "left-foot": Object.freeze([-0.16, 0.02, 0.07] as const),
  "right-foot": Object.freeze([0.16, 0.02, 0.07] as const),
});

const FALLBACK_ROLES: readonly Exclude<StudioGeneric3dPoseProxyRole, "root" | "custom">[] =
  Object.freeze([
    "head",
    "torso",
    "pelvis",
    "left-arm",
    "right-arm",
    "left-leg",
    "right-leg",
  ]);

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) return null;
  }
  const normalized = value.normalize("NFC").trim().replace(/\s+/gu, " ");
  return normalized && Array.from(normalized).length <= MAX_KEY_CODE_POINTS
    ? normalized
    : null;
}

function compact(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}]+/gu, "");
}

function sideMatch(value: string, side: "left" | "right"): boolean {
  if (side === "left") return /(?:left|(^|[^a-z])l($|[^a-z])|좌|왼)/iu.test(value);
  return /(?:right|(^|[^a-z])r($|[^a-z])|우|오른)/iu.test(value);
}

function semanticRole(name: string): Exclude<StudioGeneric3dPoseProxyRole, "root" | "custom"> | null {
  const raw = name.normalize("NFKC").toLocaleLowerCase("en-US");
  const value = compact(raw);
  const left = sideMatch(raw, "left") || value.startsWith("l");
  const right = sideMatch(raw, "right") || value.startsWith("r");
  if (/(?:head|face|skull|머리|얼굴|頭|顔)/iu.test(value)) return "head";
  if (/(?:pelvis|hips?|waist|골반|허리|腰)/iu.test(value)) return "pelvis";
  if (/(?:spine|chest|torso|body|상체|몸통|척추|胸)/iu.test(value)) return "torso";
  if (/(?:hand|wrist|손|手首|手)/iu.test(value)) {
    if (left) return "left-hand";
    if (right) return "right-hand";
  }
  if (/(?:arm|shoulder|elbow|팔|어깨|팔꿈치|腕|肩)/iu.test(value)) {
    if (left) return "left-arm";
    if (right) return "right-arm";
  }
  if (/(?:foot|ankle|toe|발|발목|발가락|足首|足)/iu.test(value)) {
    if (left) return "left-foot";
    if (right) return "right-foot";
  }
  if (/(?:leg|thigh|knee|shin|다리|허벅지|무릎|脚|膝)/iu.test(value)) {
    if (left) return "left-leg";
    if (right) return "right-leg";
  }
  return null;
}

function hasRig(status: StudioGeneric3dRigStatus): boolean {
  return status === "skinned" || status === "rigged";
}

function normalizedNodes(
  manifest: StudioGeneric3dModelManifest,
  nodes: readonly StudioGeneric3dPoseNodeEvidence[] | undefined,
): readonly StudioGeneric3dPoseNodeEvidence[] {
  if (Array.isArray(nodes) && nodes.length <= MAX_NODES) {
    const result: StudioGeneric3dPoseNodeEvidence[] = [];
    const keys = new Set<string>();
    for (const item of nodes) {
      if (typeof item !== "object" || item === null) continue;
      const key = normalizeText(item.key);
      const name = normalizeText(item.name);
      if (!key || !name || keys.has(key)) continue;
      keys.add(key);
      result.push(Object.freeze({
        key,
        name,
        parentKey: normalizeText(item.parentKey) ?? null,
        isBone: item.isBone === true,
        hasRenderable: item.hasRenderable === true,
      }));
    }
    return Object.freeze(result);
  }
  return Object.freeze(manifest.structure.nodeNames.slice(0, MAX_NODES).map((name, index) =>
    Object.freeze({
      key: `name:${index}:${name}`,
      name,
      parentKey: null,
      isBone: hasRig(manifest.rigStatus),
      hasRenderable: !hasRig(manifest.rigStatus),
    }),
  ));
}

function proxy(input: Omit<StudioGeneric3dPoseProxy, "id">): StudioGeneric3dPoseProxy {
  const target = input.targetKey ? compact(input.targetKey).slice(0, 48) : "virtual";
  return Object.freeze({
    ...input,
    id: `${input.kind}:${input.role}:${target}`,
  });
}

function rootProxy(manifest: StudioGeneric3dModelManifest): StudioGeneric3dPoseProxy {
  const ready = manifest.admission.status === "ready";
  return proxy({
    role: "root",
    label: ROLE_LABELS.root,
    kind: "root",
    operation: "root-transform",
    targetKey: null,
    anchor: ROLE_ANCHORS.root,
    canApply: ready,
    deformsMesh: false,
    detail: ready
      ? "모델 전체의 위치·회전·크기를 바꿉니다."
      : "최종 안전 검사를 통과한 뒤 전체 변환을 사용할 수 있습니다.",
  });
}

function mappedProxy(input: {
  readonly manifest: StudioGeneric3dModelManifest;
  readonly node: StudioGeneric3dPoseNodeEvidence;
  readonly role: Exclude<StudioGeneric3dPoseProxyRole, "root" | "custom">;
}): StudioGeneric3dPoseProxy {
  const rigged = hasRig(input.manifest.rigStatus);
  const isBone = rigged && input.node.isBone === true;
  const isNode = !isBone
    && input.node.hasRenderable === true
    && input.manifest.structure.parts > 1
    && input.manifest.structure.partTransformsSupported;
  const ready = input.manifest.admission.status === "ready";
  return proxy({
    role: input.role,
    label: ROLE_LABELS[input.role],
    kind: isBone ? "bone" : isNode ? "node" : "guide",
    operation: isBone ? "bone-rotate" : isNode ? "node-transform" : "guide-only",
    targetKey: isBone || isNode ? input.node.key : null,
    anchor: ROLE_ANCHORS[input.role],
    canApply: ready && (isBone || isNode),
    deformsMesh: isBone && input.manifest.rigStatus === "skinned",
    detail: isBone
      ? input.manifest.rigStatus === "skinned"
        ? `${input.node.name} 본을 회전해 연결된 메시를 변형합니다.`
        : `${input.node.name} 본을 회전합니다. 스킨 웨이트 연결 여부를 확인하세요.`
      : isNode
        ? `${input.node.name} 부위를 따로 이동합니다. 이음새가 벌어질 수 있습니다.`
        : "위치 참고용 가이드입니다. 원본 메시를 직접 변형하지 않습니다.",
  });
}

function customProxy(input: {
  readonly manifest: StudioGeneric3dModelManifest;
  readonly node: StudioGeneric3dPoseNodeEvidence;
}): StudioGeneric3dPoseProxy {
  const rigged = hasRig(input.manifest.rigStatus);
  const isBone = rigged && input.node.isBone === true;
  const isNode = !isBone
    && input.node.hasRenderable === true
    && input.manifest.structure.parts > 1
    && input.manifest.structure.partTransformsSupported;
  return proxy({
    role: "custom",
    label: input.node.name,
    kind: isBone ? "bone" : isNode ? "node" : "guide",
    operation: isBone ? "bone-rotate" : isNode ? "node-transform" : "guide-only",
    targetKey: isBone || isNode ? input.node.key : null,
    anchor: Object.freeze([0, 0.5, 0] as const),
    canApply: input.manifest.admission.status === "ready" && (isBone || isNode),
    deformsMesh: isBone && input.manifest.rigStatus === "skinned",
    detail: isBone
      ? `${input.node.name} 본을 직접 선택합니다.`
      : isNode
        ? `${input.node.name} 부위를 따로 변환합니다.`
        : `${input.node.name} 위치를 확인하는 가이드입니다.`,
  });
}

function fallbackGuide(
  manifest: StudioGeneric3dModelManifest,
  role: Exclude<StudioGeneric3dPoseProxyRole, "root" | "custom">,
): StudioGeneric3dPoseProxy {
  return proxy({
    role,
    label: ROLE_LABELS[role],
    kind: "guide",
    operation: "guide-only",
    targetKey: null,
    anchor: ROLE_ANCHORS[role],
    canApply: false,
    deformsMesh: false,
    detail: hasRig(manifest.rigStatus)
      ? "리그는 감지됐지만 이 부위의 본 이름을 매핑하지 못했습니다. 본 목록에서 직접 선택하세요."
      : "정적 모델의 구도 참고용 가이드입니다. 실제 메시를 구부리지는 않습니다.",
  });
}

/**
 * Builds a stable overlay/control plan. Static models still get root and body-space guides; models
 * with separately named renderable nodes get cautious part transforms instead of fake deformation.
 */
export function createStudioGeneric3dPoseProxies(input: {
  readonly manifest: StudioGeneric3dModelManifest;
  readonly nodes?: readonly StudioGeneric3dPoseNodeEvidence[];
}): readonly StudioGeneric3dPoseProxy[] {
  const nodes = normalizedNodes(input.manifest, input.nodes);
  const result: StudioGeneric3dPoseProxy[] = [rootProxy(input.manifest)];
  const mappedKeys = new Set<string>();
  const mappedRoles = new Set<StudioGeneric3dPoseProxyRole>();

  for (const node of nodes) {
    const role = semanticRole(node.name);
    if (!role || mappedRoles.has(role)) continue;
    if (hasRig(input.manifest.rigStatus) && node.isBone !== true) continue;
    if (!hasRig(input.manifest.rigStatus) && node.hasRenderable !== true) continue;
    result.push(mappedProxy({ manifest: input.manifest, node, role }));
    mappedKeys.add(node.key);
    mappedRoles.add(role);
  }

  for (const role of FALLBACK_ROLES) {
    if (!mappedRoles.has(role)) result.push(fallbackGuide(input.manifest, role));
  }

  const customCandidates = nodes.filter((node) => {
    if (mappedKeys.has(node.key)) return false;
    return hasRig(input.manifest.rigStatus)
      ? node.isBone === true
      : node.hasRenderable === true
        && input.manifest.structure.parts > 1
        && input.manifest.structure.partTransformsSupported;
  });
  for (const node of customCandidates.slice(0, MAX_CUSTOM_PROXIES)) {
    result.push(customProxy({ manifest: input.manifest, node }));
  }
  return Object.freeze(result);
}

function finiteClamped(value: unknown, minimum: number, maximum: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(maximum, Math.max(minimum, value));
}

function vector(
  value: readonly number[],
  minimum: number,
  maximum: number,
): readonly [number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const result = value.map((item) => finiteClamped(item, minimum, maximum));
  if (result.some((item) => item === null)) return null;
  return Object.freeze(result) as readonly [number, number, number];
}

/**
 * Converts a proxy gesture into a bounded, engine-neutral command. Guide-only proxies fail closed;
 * bone commands intentionally ignore translation/scale so an accidental drag cannot tear a rig.
 */
export function createStudioGeneric3dProxyTransformCommand(input: {
  readonly proxy: StudioGeneric3dPoseProxy;
  readonly transform: StudioGeneric3dProxyTransform;
}): StudioGeneric3dProxyTransformCommand | null {
  if (!input.proxy.canApply || input.proxy.operation === "guide-only") return null;
  const translation = vector(input.transform.translation, -10_000, 10_000);
  const rotationDegrees = vector(input.transform.rotationDegrees, -3_600, 3_600);
  const scale = vector(input.transform.scale, 0.01, 100);
  if (!translation || !rotationDegrees || !scale) return null;
  if (input.proxy.operation === "bone-rotate") {
    if (!input.proxy.targetKey) return null;
    return Object.freeze({
      target: "bone",
      targetKey: input.proxy.targetKey,
      translation: ZERO_VECTOR,
      rotationDegrees,
      scale: ONE_VECTOR,
      deformsMesh: input.proxy.deformsMesh,
    });
  }
  if (input.proxy.operation === "node-transform") {
    if (!input.proxy.targetKey) return null;
    return Object.freeze({
      target: "node",
      targetKey: input.proxy.targetKey,
      translation,
      rotationDegrees,
      scale,
      deformsMesh: false,
    });
  }
  return Object.freeze({
    target: "model-root",
    targetKey: null,
    translation,
    rotationDegrees,
    scale,
    deformsMesh: false,
  });
}
