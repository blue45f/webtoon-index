import {
  applyStudioVrmAdaptiveFaceMorphs,
  inspectStudioVrmAdaptiveFaceProfile,
} from "./studio-vrm-adaptive-face-deformer";
import {
  sanitizeAvatarForgeSemanticFaceMorphs,
  type AvatarForgeSemanticFaceMorphId,
  type AvatarForgeSemanticFaceMorphState,
} from "./studio-vrm-avatar-forge";

import type { VRM } from "@pixiv/three-vrm";
import type * as THREE from "three";

type MorphMesh = THREE.Mesh & {
  morphTargetDictionary?: Record<string, number>;
  morphTargetInfluences?: number[];
};

type MorphDirection = -1 | 1;

type InternalBinding = Readonly<{
  semanticId: AvatarForgeSemanticFaceMorphId;
  direction: MorphDirection;
  mesh: MorphMesh;
  targetIndex: number;
  targetName: string;
}>;

export type StudioVrmSemanticFaceMorphProvider = "native-morph" | "adaptive-mesh";

export type StudioVrmSemanticFaceMorphControl = Readonly<{
  id: AvatarForgeSemanticFaceMorphId;
  label: string;
  hint: string;
  minimum: -1 | 0;
  maximum: 0 | 1;
  positiveTargetCount: number;
  negativeTargetCount: number;
  targetNames: readonly string[];
  provider: StudioVrmSemanticFaceMorphProvider;
  adaptiveMeshCount: number;
}>;

export type StudioVrmSemanticFaceMorphProfile = Readonly<{
  status: "ready" | "unavailable";
  controls: readonly StudioVrmSemanticFaceMorphControl[];
  /** Backwards-compatible native shape-key target count. */
  targetCount: number;
  nativeTargetCount: number;
  adaptiveMeshCount: number;
  message: string;
}>;

type SemanticSpec = Readonly<{
  id: AvatarForgeSemanticFaceMorphId;
  label: string;
  hint: string;
  positiveAliases: readonly string[];
  negativeAliases: readonly string[];
}>;

const SEMANTIC_SPECS: readonly SemanticSpec[] = Object.freeze([
  {
    id: "eyeSize",
    label: "눈 크기",
    hint: "모델 고유 shape key를 우선 사용하고, 없으면 눈 랜드마크 주변 메시를 부드럽게 조형합니다.",
    positiveAliases: [
      "eyeSizeBig", "eyesBig", "eyeBig", "eyeLarge", "eyesLarge",
      "eyeScaleUp", "eyesScaleUp", "eyeEnlarge",
    ],
    negativeAliases: [
      "eyeSizeSmall", "eyesSmall", "eyeSmall", "eyeScaleDown", "eyesScaleDown",
    ],
  },
  {
    id: "eyeSpacing",
    label: "눈 간격",
    hint: "전용 morph가 없으면 양 눈 랜드마크를 기준으로 좌우 영역을 대칭 이동합니다.",
    positiveAliases: [
      "eyeSpacingWide", "eyesWide", "eyeDistanceWide", "eyesApart",
    ],
    negativeAliases: [
      "eyeSpacingNarrow", "eyesNarrow", "eyeDistanceNarrow", "eyesClose",
    ],
  },
  {
    id: "eyeTilt",
    label: "눈꼬리",
    hint: "표정 morph는 제외하고 고정 눈매 morph 또는 적응형 외안각 조형만 사용합니다.",
    positiveAliases: [
      "eyeTiltUp", "eyesTiltUp", "eyeUpturned", "eyesUpturned", "catEye",
    ],
    negativeAliases: [
      "eyeTiltDown", "eyesTiltDown", "eyeDownturned", "eyesDownturned", "droopyEye",
    ],
  },
  {
    id: "irisSize",
    label: "홍채 크기",
    hint: "홍채 전용 morph 또는 분리된 iris/pupil 메시가 확인된 모델에서 조절합니다.",
    positiveAliases: [
      "irisSizeBig", "irisBig", "irisLarge", "pupilSizeBig", "pupilBig",
    ],
    negativeAliases: [
      "irisSizeSmall", "irisSmall", "pupilSizeSmall", "pupilSmall",
    ],
  },
  {
    id: "noseHeight",
    label: "코 높이",
    hint: "코 위치 전용 morph를 우선하고, 없으면 얼굴 기준점 주변을 제한 범위에서 이동합니다.",
    positiveAliases: [
      "noseHeightHigh", "noseHigh", "noseUp", "nosePositionUp",
    ],
    negativeAliases: [
      "noseHeightLow", "noseLow", "noseDown", "nosePositionDown",
    ],
  },
  {
    id: "noseWidth",
    label: "코 너비",
    hint: "코 폭 shape key 또는 대칭 공간 마스크를 사용합니다.",
    positiveAliases: [
      "noseWidthWide", "noseWide", "noseBig",
    ],
    negativeAliases: [
      "noseWidthNarrow", "noseNarrow", "noseSmall",
    ],
  },
  {
    id: "mouthWidth",
    label: "입 너비",
    hint: "미소·발음 expression을 건드리지 않고 입 폭 전용 morph 또는 입 주변 메시만 조형합니다.",
    positiveAliases: [
      "mouthWidthWide", "mouthWide", "lipWidthWide", "lipsWide",
    ],
    negativeAliases: [
      "mouthWidthNarrow", "mouthNarrow", "lipWidthNarrow", "lipsNarrow",
    ],
  },
  {
    id: "lipFullness",
    label: "입술 볼륨",
    hint: "입술 두께 shape key 또는 입 주변의 깊이·높이 마스크를 사용합니다.",
    positiveAliases: [
      "lipFullnessHigh", "lipFull", "lipsFull", "lipThick", "lipsThick",
    ],
    negativeAliases: [
      "lipFullnessLow", "lipThin", "lipsThin",
    ],
  },
  {
    id: "earSize",
    label: "귀 크기",
    hint: "귀 전용 morph가 없으면 머리 기준 양측 귀 영역만 제한적으로 조형합니다.",
    positiveAliases: [
      "earSizeBig", "earsBig", "earBig", "earLarge", "earsLarge",
    ],
    negativeAliases: [
      "earSizeSmall", "earsSmall", "earSmall",
    ],
  },
]);

const ALLOWED_PREFIXES = Object.freeze([
  "",
  "face",
  "facial",
  "avatar",
  "character",
  "morph",
  "blendshape",
  "shapekey",
]);

function normalizeTargetName(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]/gu, "");
}

function aliasVariants(aliases: readonly string[]): ReadonlySet<string> {
  const variants = new Set<string>();
  for (const alias of aliases) {
    const normalized = normalizeTargetName(alias);
    for (const prefix of ALLOWED_PREFIXES) variants.add(`${prefix}${normalized}`);
  }
  return variants;
}

const MATCHERS = new Map(
  SEMANTIC_SPECS.map((spec) => [
    spec.id,
    {
      positive: aliasVariants(spec.positiveAliases),
      negative: aliasVariants(spec.negativeAliases),
    },
  ] as const),
);

function morphMesh(object: THREE.Object3D): MorphMesh | null {
  const candidate = object as MorphMesh;
  if (
    !candidate.isMesh
    || !candidate.morphTargetDictionary
    || !Array.isArray(candidate.morphTargetInfluences)
  ) return null;
  return candidate;
}

function discoverBindings(vrm: VRM | null | undefined): readonly InternalBinding[] {
  if (!vrm) return [];
  const bindings: InternalBinding[] = [];
  vrm.scene.traverse((object) => {
    const mesh = morphMesh(object);
    if (!mesh) return;
    const influences = mesh.morphTargetInfluences!;
    const claimed = new Set<number>();
    for (const [targetName, targetIndex] of Object.entries(mesh.morphTargetDictionary!)) {
      if (
        !Number.isSafeInteger(targetIndex)
        || targetIndex < 0
        || targetIndex >= influences.length
        || claimed.has(targetIndex)
      ) continue;
      const normalized = normalizeTargetName(targetName);
      for (const spec of SEMANTIC_SPECS) {
        const matcher = MATCHERS.get(spec.id);
        const direction: MorphDirection | null = matcher?.positive.has(normalized)
          ? 1
          : matcher?.negative.has(normalized)
            ? -1
            : null;
        if (direction === null) continue;
        bindings.push(Object.freeze({
          semanticId: spec.id,
          direction,
          mesh,
          targetIndex,
          targetName,
        }));
        claimed.add(targetIndex);
        break;
      }
    }
  });
  return Object.freeze(bindings);
}

export function inspectStudioVrmSemanticFaceMorphProfile(
  vrm: VRM | null | undefined,
): StudioVrmSemanticFaceMorphProfile {
  const bindings = discoverBindings(vrm);
  const adaptive = inspectStudioVrmAdaptiveFaceProfile(vrm);
  const controls: StudioVrmSemanticFaceMorphControl[] = [];
  for (const spec of SEMANTIC_SPECS) {
    const matching = bindings.filter((binding) => binding.semanticId === spec.id);
    const positiveTargetCount = matching.filter((binding) => binding.direction === 1).length;
    const negativeTargetCount = matching.length - positiveTargetCount;
    if (matching.length > 0) {
      controls.push(Object.freeze({
        id: spec.id,
        label: spec.label,
        hint: spec.hint,
        minimum: negativeTargetCount > 0 ? -1 : 0,
        maximum: positiveTargetCount > 0 ? 1 : 0,
        positiveTargetCount,
        negativeTargetCount,
        targetNames: Object.freeze([...new Set(matching.map((binding) => binding.targetName))].sort()),
        provider: "native-morph",
        adaptiveMeshCount: 0,
      }));
      continue;
    }
    const adaptiveCapability = adaptive.capabilities.find((capability) => capability.id === spec.id);
    if (!adaptiveCapability) continue;
    controls.push(Object.freeze({
      id: spec.id,
      label: spec.label,
      hint: spec.hint,
      minimum: -1,
      maximum: 1,
      positiveTargetCount: 0,
      negativeTargetCount: 0,
      targetNames: Object.freeze([]),
      provider: "adaptive-mesh",
      adaptiveMeshCount: adaptiveCapability.meshCount,
    }));
  }
  const nativeTargetCount = bindings.length;
  const adaptiveMeshCount = adaptive.meshCount;
  const nativeControlCount = controls.filter((control) => control.provider === "native-morph").length;
  const adaptiveControlCount = controls.length - nativeControlCount;
  return Object.freeze({
    status: controls.length > 0 ? "ready" as const : "unavailable" as const,
    controls: Object.freeze(controls),
    targetCount: nativeTargetCount,
    nativeTargetCount,
    adaptiveMeshCount,
    message: controls.length > 0
      ? `모델 morph ${nativeControlCount}종 · 적응형 메시 ${adaptiveControlCount}종을 준비했습니다.`
      : "얼굴 조형에 사용할 shape key, 얼굴 메시, 머리 랜드마크를 찾지 못했습니다. 두상·턱 비율 편집은 계속 사용할 수 있습니다.",
  });
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Applies exact native shape keys first and fills only missing semantics with reversible adaptive
 * mesh deformation. Expression channels (blink, phoneme, joy, etc.) are absent from the alias
 * table, and adaptive deformation restores the original geometry object byte-for-byte on release.
 */
export function applyStudioVrmSemanticFaceMorphs(
  vrm: VRM | null | undefined,
  rawState: AvatarForgeSemanticFaceMorphState | null | undefined,
): () => void {
  if (!vrm) return () => undefined;
  const bindings = discoverBindings(vrm);
  const state = sanitizeAvatarForgeSemanticFaceMorphs(rawState) ?? {};
  const nativeSemanticIds = new Set(bindings.map((binding) => binding.semanticId));
  const adaptiveRelease = applyStudioVrmAdaptiveFaceMorphs(vrm, state, nativeSemanticIds);
  const baselines = bindings.map((binding) => ({
    binding,
    value: binding.mesh.morphTargetInfluences?.[binding.targetIndex] ?? 0,
  }));

  for (const { binding, value: baseline } of baselines) {
    const semanticValue = state[binding.semanticId] ?? 0;
    const amount = binding.direction === 1
      ? Math.max(0, semanticValue)
      : Math.max(0, -semanticValue);
    const influences = binding.mesh.morphTargetInfluences;
    if (!influences) continue;
    influences[binding.targetIndex] = clamp01(
      baseline + (1 - clamp01(baseline)) * clamp01(amount),
    );
  }

  return () => {
    adaptiveRelease();
    for (const { binding, value } of baselines) {
      const influences = binding.mesh.morphTargetInfluences;
      if (!influences || binding.targetIndex >= influences.length) continue;
      influences[binding.targetIndex] = value;
    }
  };
}
