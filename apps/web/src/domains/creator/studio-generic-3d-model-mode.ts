import type {
  StudioBg3dAssetMetadata,
  StudioBg3dAssetRightsReceipt,
} from "./bg3d/studio-bg3d-asset-metadata";
import type {
  StudioBg3dGlbMetrics,
  StudioBg3dGlbValidationResult,
} from "./bg3d/studio-bg3d-glb-validation";
import type { StudioBg3dObjWorkerCanonicalResult } from "./bg3d/studio-bg3d-obj-worker-protocol";
import type { StudioBg3dAttachmentRights } from "./bg3d/studio-bg3d-scene-document";

/**
 * Renderer-neutral product boundary for imported models which are not VRM avatars.
 *
 * VRM has a separate license, expression, humanoid-bone, and runtime contract. Keeping `vrm` out
 * of this union prevents an ordinary prop/character workflow from silently depending on VRM APIs.
 */
export const STUDIO_GENERIC_3D_SOURCE_FORMATS = [
  "glb",
  "gltf",
  "obj",
  "obj-mtl",
] as const;

export type StudioGeneric3dSourceFormat =
  (typeof STUDIO_GENERIC_3D_SOURCE_FORMATS)[number];
export type StudioGeneric3dClassification = "character" | "creature" | "prop";
export type StudioGeneric3dRigStatus = "skinned" | "rigged" | "static" | "unverified";
export type StudioGeneric3dAdmissionStatus = "ready" | "canonical-validation-pending" | "blocked";
export type StudioGeneric3dCapabilityAvailability = "available" | "limited" | "unavailable";
export type StudioGeneric3dCapabilityId =
  | "root-transform"
  | "part-transform"
  | "bone-pose"
  | "skinned-deformation"
  | "animation-playback"
  | "morph-expression"
  | "pose-proxy"
  | "material-editing"
  | "normal-map"
  | "surface-snap";

export type StudioGeneric3dLimitationCode =
  | "canonical-validation-pending"
  | "validation-blocked"
  | "static-no-deformation"
  | "single-part-model"
  | "part-transform-runtime-unavailable"
  | "missing-animation"
  | "missing-morph-targets"
  | "missing-mtl"
  | "normal-map-unknown"
  | "rights-review"
  | "commercial-use-restricted"
  | "team-share-restricted";

export interface StudioGeneric3dRightsEvidence {
  readonly source: "asset-metadata" | "scene-attachment" | "none";
  readonly status: "owned" | "licensed" | "public-domain" | "unknown";
  readonly commercialUse: boolean;
  readonly teamShareAllowed: boolean | null;
  readonly attributionRequired: boolean;
  readonly provider: string | null;
  readonly author: string | null;
  readonly license: string | null;
  readonly attribution: string | null;
  readonly reviewRequired: boolean;
}

export interface StudioGeneric3dStructuralEvidence {
  readonly nodes: number;
  readonly meshes: number;
  readonly parts: number;
  /** False when a renderer can inspect parts but the scene document cannot persist part transforms. */
  readonly partTransformsSupported: boolean;
  readonly materials: number;
  readonly textures: number;
  readonly triangles: number;
  readonly animations: number;
  readonly skins: number;
  readonly joints: number;
  readonly bones: number;
  readonly skinnedMeshes: number | null;
  readonly morphTargets: number;
  readonly normalMaps: number | null;
  readonly nodeNames: readonly string[];
}

export interface StudioGeneric3dAdmissionManifest {
  readonly status: StudioGeneric3dAdmissionStatus;
  readonly sourceValidation: "passed" | "blocked";
  readonly canonicalValidation: "passed" | "pending" | "blocked";
  readonly profile: "mobile" | "desktop" | null;
  readonly code: string;
  readonly message: string;
  readonly contentHash: `sha256:${string}` | null;
  readonly byteSize: number | null;
}

export interface StudioGeneric3dCapability {
  readonly id: StudioGeneric3dCapabilityId;
  readonly label: string;
  readonly availability: StudioGeneric3dCapabilityAvailability;
  readonly detail: string;
}

export interface StudioGeneric3dLimitation {
  readonly code: StudioGeneric3dLimitationCode;
  readonly severity: "info" | "warning" | "blocking";
  readonly title: string;
  readonly detail: string;
}

export interface StudioGeneric3dModelManifest {
  readonly version: 1;
  readonly kind: "generic-3d-model";
  readonly isVrm: false;
  readonly name: string;
  readonly sourceFormat: StudioGeneric3dSourceFormat;
  readonly canonicalFormat: "glb";
  readonly convertedToCanonicalGlb: boolean;
  readonly classification: StudioGeneric3dClassification;
  readonly classificationSource: "manual" | "heuristic" | "fallback";
  readonly classificationConfidence: "high" | "medium" | "low";
  readonly rigStatus: StudioGeneric3dRigStatus;
  readonly structure: StudioGeneric3dStructuralEvidence;
  readonly admission: StudioGeneric3dAdmissionManifest;
  readonly rights: StudioGeneric3dRightsEvidence;
  readonly capabilities: readonly StudioGeneric3dCapability[];
  readonly limitations: readonly StudioGeneric3dLimitation[];
}

export interface StudioGeneric3dManifestHints {
  readonly classification?: StudioGeneric3dClassification;
  readonly tags?: readonly string[];
  readonly nodeNames?: readonly string[];
  /** Optional renderer scan evidence which is more precise than validator aggregate metrics. */
  readonly bones?: number;
  readonly skinnedMeshes?: number;
  readonly parts?: number;
  readonly partTransformsSupported?: boolean;
  readonly normalMaps?: number;
}

export interface StudioGeneric3dGlbManifestInput extends StudioGeneric3dManifestHints {
  readonly name: string;
  readonly sourceFormat?: "glb" | "gltf";
  readonly validation: StudioBg3dGlbValidationResult;
  readonly rights?: StudioGeneric3dRightsEvidence;
}

export interface StudioGeneric3dObjManifestInput extends StudioGeneric3dManifestHints {
  readonly name: string;
  readonly parsed: StudioBg3dObjWorkerCanonicalResult;
  /** OBJ Worker validation is only the first gate; the canonical exported GLB must also pass. */
  readonly canonicalValidation?: StudioBg3dGlbValidationResult;
  readonly rights?: StudioGeneric3dRightsEvidence;
}

/** Trusted persisted evidence after the canonical GLB validator and storage admission both pass. */
export interface StudioGeneric3dVerifiedManifestInput extends StudioGeneric3dManifestHints {
  readonly name: string;
  readonly sourceFormat: StudioGeneric3dSourceFormat;
  readonly profile: "mobile" | "desktop";
  readonly contentHash: `sha256:${string}`;
  readonly metrics: StudioBg3dGlbMetrics;
  readonly message?: string;
  readonly rights?: StudioGeneric3dRightsEvidence;
}

const SOURCE_FORMATS = new Set<string>(STUDIO_GENERIC_3D_SOURCE_FORMATS);
const MAX_TEXT_CODE_POINTS = 160;
const MAX_HINTS = 4_096;

const CAPABILITY_LABELS: Readonly<Record<StudioGeneric3dCapabilityId, string>> = Object.freeze({
  "root-transform": "전체 이동·회전·크기",
  "part-transform": "부위별 조작",
  "bone-pose": "본 포즈",
  "skinned-deformation": "스킨 변형",
  "animation-playback": "애니메이션 재생",
  "morph-expression": "표정·모프",
  "pose-proxy": "포즈 프록시",
  "material-editing": "재질 편집",
  "normal-map": "노멀맵 표현",
  "surface-snap": "표면 스냅",
});

export const STUDIO_GENERIC_3D_CLASSIFICATION_LABELS: Readonly<
  Record<StudioGeneric3dClassification, string>
> = Object.freeze({
  character: "캐릭터",
  creature: "크리처",
  prop: "소품",
});

export const STUDIO_GENERIC_3D_RIG_LABELS: Readonly<Record<StudioGeneric3dRigStatus, string>> =
  Object.freeze({
    skinned: "스킨 리그",
    rigged: "본 리그",
    static: "정적 모델",
    unverified: "구조 확인 전",
  });

function normalizeText(value: unknown, fallback: string | null = null): string | null {
  if (typeof value !== "string") return fallback;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) return fallback;
  }
  const normalized = value.normalize("NFC").trim().replace(/\s+/gu, " ");
  if (!normalized || Array.from(normalized).length > MAX_TEXT_CODE_POINTS) return fallback;
  return normalized;
}

function normalizeNames(values: readonly string[] | undefined): readonly string[] {
  if (!Array.isArray(values) || values.length > MAX_HINTS) return Object.freeze([]);
  const names = new Set<string>();
  for (const value of values) {
    const normalized = normalizeText(value);
    if (normalized) names.add(normalized);
  }
  return Object.freeze([...names]);
}

function safeCount(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : fallback;
}

function optionalSafeCount(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function rightsText(value: unknown): string | null {
  return normalizeText(value);
}

const EMPTY_RIGHTS: StudioGeneric3dRightsEvidence = Object.freeze({
  source: "none",
  status: "unknown",
  commercialUse: false,
  teamShareAllowed: null,
  attributionRequired: false,
  provider: null,
  author: null,
  license: null,
  attribution: null,
  reviewRequired: true,
});

/** Links the searchable asset record to the generic model mode without copying local DB IDs. */
export function createStudioGeneric3dRightsFromAssetMetadata(
  metadata: Pick<StudioBg3dAssetMetadata, "rights">,
): StudioGeneric3dRightsEvidence {
  const rights: StudioBg3dAssetRightsReceipt = metadata.rights;
  return Object.freeze({
    source: "asset-metadata",
    status: rights.status,
    commercialUse: rights.commercialUse,
    teamShareAllowed: rights.teamShareAllowed,
    attributionRequired: false,
    provider: rightsText(rights.provider),
    author: rightsText(rights.author),
    license: rightsText(rights.license),
    attribution: null,
    reviewRequired: rights.status === "unknown",
  });
}

/** Links the persisted scene attachment receipt to the same renderer-neutral rights summary. */
export function createStudioGeneric3dRightsFromAttachment(
  rights: StudioBg3dAttachmentRights,
): StudioGeneric3dRightsEvidence {
  return Object.freeze({
    source: "scene-attachment",
    status: rights.status,
    commercialUse: rights.commercialUse,
    teamShareAllowed: null,
    attributionRequired: rights.attributionRequired,
    provider: null,
    author: null,
    license: rightsText(rights.licenseName),
    attribution: rightsText(rights.attribution),
    reviewRequired:
      rights.status === "unknown"
      || (rights.status === "licensed" && !rightsText(rights.licenseName))
      || (rights.attributionRequired && !rightsText(rights.attribution)),
  });
}

export function isStudioGeneric3dSourceFormat(
  value: unknown,
): value is StudioGeneric3dSourceFormat {
  return typeof value === "string" && SOURCE_FORMATS.has(value);
}

function foldedSearchText(input: {
  readonly name: string;
  readonly tags: readonly string[];
  readonly nodeNames: readonly string[];
}): string {
  return [input.name, ...input.tags, ...input.nodeNames]
    .join(" ")
    .normalize("NFKC")
    .toLocaleLowerCase("en-US");
}

function classify(input: {
  readonly name: string;
  readonly tags: readonly string[];
  readonly nodeNames: readonly string[];
  readonly manual?: StudioGeneric3dClassification;
}): Pick<
  StudioGeneric3dModelManifest,
  "classification" | "classificationSource" | "classificationConfidence"
> {
  if (input.manual) {
    return {
      classification: input.manual,
      classificationSource: "manual",
      classificationConfidence: "high",
    };
  }
  const search = foldedSearchText(input);
  const creature = /(?:creature|monster|dragon|animal|dog|cat|wolf|horse|bird|beast|크리처|몬스터|괴물|동물|용|고양이|강아지|늑대|말|새)/iu;
  const character = /(?:character|human|humanoid|person|avatar|woman|female|girl|man|male|boy|student|doctor|캐릭터|사람|인간|휴머노이드|여자|여성|소녀|남자|남성|소년|학생|의사)/iu;
  if (creature.test(search)) {
    return {
      classification: "creature",
      classificationSource: "heuristic",
      classificationConfidence: "medium",
    };
  }
  if (character.test(search)) {
    return {
      classification: "character",
      classificationSource: "heuristic",
      classificationConfidence: "medium",
    };
  }
  return {
    classification: "prop",
    classificationSource: "fallback",
    classificationConfidence: "low",
  };
}

function rigStatus(
  structure: StudioGeneric3dStructuralEvidence,
  admission: StudioGeneric3dAdmissionManifest,
): StudioGeneric3dRigStatus {
  if (admission.status === "blocked") return "unverified";
  if (structure.skins > 0 || (structure.skinnedMeshes ?? 0) > 0) return "skinned";
  if (structure.bones > 0 || structure.joints > 0) return "rigged";
  return "static";
}

function capability(
  id: StudioGeneric3dCapabilityId,
  availability: StudioGeneric3dCapabilityAvailability,
  detail: string,
): StudioGeneric3dCapability {
  return Object.freeze({ id, label: CAPABILITY_LABELS[id], availability, detail });
}

function createCapabilities(
  structure: StudioGeneric3dStructuralEvidence,
  rig: StudioGeneric3dRigStatus,
  admission: StudioGeneric3dAdmissionManifest,
): readonly StudioGeneric3dCapability[] {
  if (admission.status !== "ready") {
    const reason = admission.status === "blocked"
      ? "안전 검사를 통과해야 사용할 수 있습니다."
      : "변환된 GLB의 최종 안전 검사를 기다리고 있습니다.";
    return Object.freeze(
      (Object.keys(CAPABILITY_LABELS) as StudioGeneric3dCapabilityId[]).map((id) =>
        capability(id, "unavailable", reason),
      ),
    );
  }

  const hasRig = rig === "skinned" || rig === "rigged";
  return Object.freeze([
    capability("root-transform", "available", "모델 전체를 이동·회전·크기 조절할 수 있습니다."),
    capability(
      "part-transform",
      structure.parts > 1 && structure.partTransformsSupported ? "available" : "unavailable",
      structure.parts > 1 && structure.partTransformsSupported
        ? `${structure.parts.toLocaleString("ko-KR")}개 부위를 개별 선택할 수 있습니다.`
        : structure.parts > 1
          ? `${structure.parts.toLocaleString("ko-KR")}개 부위를 감지했지만 이 장면 형식은 부위별 변환을 아직 저장하지 않습니다.`
        : "분리된 부위가 없어 전체 모델만 조작할 수 있습니다.",
    ),
    capability(
      "bone-pose",
      hasRig ? "available" : "unavailable",
      hasRig
        ? `${structure.bones.toLocaleString("ko-KR")}개 본을 포즈 대상으로 사용할 수 있습니다.`
        : "본 구조가 없어 메시를 관절처럼 구부릴 수 없습니다.",
    ),
    capability(
      "skinned-deformation",
      rig === "skinned" ? "available" : "unavailable",
      rig === "skinned"
        ? "스킨 웨이트가 연결되어 본 회전이 메시를 변형합니다."
        : "스킨 웨이트가 확인되지 않았습니다.",
    ),
    capability(
      "animation-playback",
      structure.animations > 0 ? "available" : "unavailable",
      structure.animations > 0
        ? `${structure.animations.toLocaleString("ko-KR")}개 애니메이션 클립을 재생할 수 있습니다.`
        : "내장 애니메이션 클립이 없습니다.",
    ),
    capability(
      "morph-expression",
      structure.morphTargets > 0 ? "available" : "unavailable",
      structure.morphTargets > 0
        ? `${structure.morphTargets.toLocaleString("ko-KR")}개 모프 타깃을 조절할 수 있습니다.`
        : "표정 또는 형태용 모프 타깃이 없습니다.",
    ),
    capability(
      "pose-proxy",
      hasRig ? "available" : "limited",
      hasRig
        ? "본 프록시가 실제 리그를 조작합니다."
        : structure.parts > 1 && structure.partTransformsSupported
          ? "부위 노드를 프록시로 움직일 수 있지만 스킨 변형은 적용되지 않습니다."
          : structure.parts > 1
            ? "부위 구조는 감지됐지만 현재 장면 형식에서는 가이드로만 표시합니다."
            : "가이드 프록시만 제공됩니다. 단일 정적 메시는 변형되지 않습니다.",
    ),
    capability(
      "material-editing",
      structure.materials > 0 ? "available" : "unavailable",
      structure.materials > 0
        ? `${structure.materials.toLocaleString("ko-KR")}개 재질을 조정할 수 있습니다.`
        : "편집 가능한 재질이 확인되지 않았습니다.",
    ),
    capability(
      "normal-map",
      (structure.normalMaps ?? 0) > 0
        ? "available"
        : structure.normalMaps === null
          ? "limited"
          : "unavailable",
      (structure.normalMaps ?? 0) > 0
        ? "노멀 또는 범프 텍스처를 유지합니다."
        : structure.normalMaps === null
          ? "검증 메트릭만으로 노멀맵 슬롯을 확정할 수 없어 렌더러 로드 후 확인합니다."
          : "노멀 또는 범프 텍스처가 없습니다.",
    ),
    capability("surface-snap", "available", "바닥과 다른 3D 표면에 모델을 스냅할 수 있습니다."),
  ]);
}

function limitation(
  code: StudioGeneric3dLimitationCode,
  severity: StudioGeneric3dLimitation["severity"],
  title: string,
  detail: string,
): StudioGeneric3dLimitation {
  return Object.freeze({ code, severity, title, detail });
}

function createLimitations(input: {
  readonly structure: StudioGeneric3dStructuralEvidence;
  readonly rig: StudioGeneric3dRigStatus;
  readonly admission: StudioGeneric3dAdmissionManifest;
  readonly rights: StudioGeneric3dRightsEvidence;
  readonly sourceFormat: StudioGeneric3dSourceFormat;
}): readonly StudioGeneric3dLimitation[] {
  const result: StudioGeneric3dLimitation[] = [];
  if (input.admission.status === "blocked") {
    result.push(limitation(
      "validation-blocked",
      "blocking",
      "안전 검사 실패",
      input.admission.message,
    ));
  } else if (input.admission.status === "canonical-validation-pending") {
    result.push(limitation(
      "canonical-validation-pending",
      "blocking",
      "최종 GLB 검사 대기",
      "OBJ 구조 검사는 통과했지만 변환된 GLB의 해시·기기 예산 검사가 남아 있습니다.",
    ));
  }
  if (input.rig === "static") {
    result.push(limitation(
      "static-no-deformation",
      "info",
      "정적 모델",
      "루트·분리 부위는 조작할 수 있지만 관절 기반 메시 변형은 지원하지 않습니다.",
    ));
  }
  if (input.structure.parts <= 1) {
    result.push(limitation(
      "single-part-model",
      "info",
      "단일 부위",
      "모델 내부에 따로 선택할 부위가 없어 전체 변환만 적용됩니다.",
    ));
  } else if (!input.structure.partTransformsSupported) {
    result.push(limitation(
      "part-transform-runtime-unavailable",
      "info",
      "부위 구조는 읽기 전용",
      "부위는 감지했지만 현재 장면 문서가 내부 노드 변환을 저장하지 않아 전체 모델과 본만 조작합니다.",
    ));
  }
  if (input.structure.animations === 0) {
    result.push(limitation(
      "missing-animation",
      "info",
      "애니메이션 없음",
      "재생 가능한 내장 애니메이션 클립이 없습니다.",
    ));
  }
  if (input.structure.morphTargets === 0) {
    result.push(limitation(
      "missing-morph-targets",
      "info",
      "표정 모프 없음",
      "표정이나 형태를 바꾸는 모프 타깃이 없습니다.",
    ));
  }
  if (input.sourceFormat === "obj") {
    result.push(limitation(
      "missing-mtl",
      "warning",
      "MTL 미연결",
      "OBJ와 함께 MTL·텍스처를 선택해야 원본 재질을 보존할 수 있습니다.",
    ));
  }
  if (input.structure.normalMaps === null) {
    result.push(limitation(
      "normal-map-unknown",
      "info",
      "노멀맵 로드 후 확인",
      "GLB 검증기는 텍스처 예산만 확인하므로 실제 재질 슬롯은 렌더러 로드 후 판별합니다.",
    ));
  }
  if (input.rights.reviewRequired) {
    result.push(limitation(
      "rights-review",
      "warning",
      "이용 권리 확인 필요",
      "상업 공개나 팀 공유 전에 원본 모델의 라이선스와 출처를 확인해 주세요.",
    ));
  }
  if (!input.rights.commercialUse) {
    result.push(limitation(
      "commercial-use-restricted",
      "warning",
      "상업 이용 미확인",
      "이 권리 기록으로는 상업 작품 사용을 승인하지 않습니다.",
    ));
  }
  if (input.rights.teamShareAllowed === false) {
    result.push(limitation(
      "team-share-restricted",
      "warning",
      "팀 원본 공유 제한",
      "협업자에게 원본 모델 파일을 재배포할 수 없는 권리 기록입니다.",
    ));
  }
  return Object.freeze(result);
}

function metricsStructure(
  metrics: StudioBg3dGlbMetrics | null,
  hints: StudioGeneric3dManifestHints,
): StudioGeneric3dStructuralEvidence {
  const nodeNames = normalizeNames(hints.nodeNames);
  const joints = safeCount(metrics?.joints);
  const parts = safeCount(hints.parts, safeCount(metrics?.meshes));
  return Object.freeze({
    nodes: safeCount(metrics?.nodes),
    meshes: safeCount(metrics?.meshes),
    parts,
    partTransformsSupported: hints.partTransformsSupported ?? parts > 1,
    materials: safeCount(metrics?.materials),
    textures: safeCount(metrics?.textures),
    triangles: safeCount(metrics?.triangles),
    animations: safeCount(metrics?.animations),
    skins: safeCount(metrics?.skins),
    joints,
    bones: safeCount(hints.bones, joints),
    skinnedMeshes: optionalSafeCount(hints.skinnedMeshes),
    morphTargets: safeCount(metrics?.morphTargets),
    normalMaps: optionalSafeCount(hints.normalMaps),
    nodeNames,
  });
}

function buildManifest(input: {
  readonly name: string;
  readonly sourceFormat: StudioGeneric3dSourceFormat;
  readonly structure: StudioGeneric3dStructuralEvidence;
  readonly admission: StudioGeneric3dAdmissionManifest;
  readonly rights: StudioGeneric3dRightsEvidence;
  readonly hints: StudioGeneric3dManifestHints;
}): StudioGeneric3dModelManifest {
  const name = normalizeText(input.name, "이름 없는 3D 모델")!;
  const tags = normalizeNames(input.hints.tags);
  const classification = classify({
    name,
    tags,
    nodeNames: input.structure.nodeNames,
    manual: input.hints.classification,
  });
  const rig = rigStatus(input.structure, input.admission);
  const capabilities = createCapabilities(input.structure, rig, input.admission);
  const limitations = createLimitations({
    structure: input.structure,
    rig,
    admission: input.admission,
    rights: input.rights,
    sourceFormat: input.sourceFormat,
  });
  return Object.freeze({
    version: 1,
    kind: "generic-3d-model",
    isVrm: false,
    name,
    sourceFormat: input.sourceFormat,
    canonicalFormat: "glb",
    convertedToCanonicalGlb: input.sourceFormat !== "glb",
    ...classification,
    rigStatus: rig,
    structure: input.structure,
    admission: input.admission,
    rights: input.rights,
    capabilities,
    limitations,
  });
}

function glbAdmission(validation: StudioBg3dGlbValidationResult): StudioGeneric3dAdmissionManifest {
  if (!validation.ok) {
    return Object.freeze({
      status: "blocked",
      sourceValidation: "blocked",
      canonicalValidation: "blocked",
      profile: null,
      code: validation.code,
      message: validation.message,
      contentHash: null,
      byteSize: null,
    });
  }
  return Object.freeze({
    status: "ready",
    sourceValidation: "passed",
    canonicalValidation: "passed",
    profile: validation.profile,
    code: validation.code,
    message: validation.message,
    contentHash: validation.verifiedSha256,
    byteSize: validation.metrics.byteSize,
  });
}

export function createStudioGeneric3dGlbManifest(
  input: StudioGeneric3dGlbManifestInput,
): StudioGeneric3dModelManifest {
  if (
    input.sourceFormat !== undefined
    && input.sourceFormat !== "glb"
    && input.sourceFormat !== "gltf"
  ) {
    throw new TypeError("Generic 3D GLB manifests cannot use VRM or an unsupported source format.");
  }
  const admission = glbAdmission(input.validation);
  const structure = metricsStructure(input.validation.ok ? input.validation.metrics : null, input);
  return buildManifest({
    name: input.name,
    sourceFormat: input.sourceFormat ?? "glb",
    structure,
    admission,
    rights: input.rights ?? EMPTY_RIGHTS,
    hints: input,
  });
}

/**
 * Rebuilds the same capability document from a verified IndexedDB record without fabricating the
 * validator-owned byte snapshot required by `StudioBg3dGlbValidationSuccess`.
 */
export function createStudioGeneric3dVerifiedManifest(
  input: StudioGeneric3dVerifiedManifestInput,
): StudioGeneric3dModelManifest {
  if (!isStudioGeneric3dSourceFormat(input.sourceFormat)) {
    throw new TypeError("Verified generic 3D manifests cannot use VRM or an unsupported format.");
  }
  if (
    !/^sha256:[a-f0-9]{64}$/iu.test(input.contentHash)
    || input.metrics.byteSize < 1
    || (input.profile !== "mobile" && input.profile !== "desktop")
  ) {
    throw new TypeError("Verified generic 3D manifest evidence is invalid.");
  }
  const admission: StudioGeneric3dAdmissionManifest = Object.freeze({
    status: "ready",
    sourceValidation: "passed",
    canonicalValidation: "passed",
    profile: input.profile,
    code: "valid",
    message: input.message ?? "저장된 GLB의 무결성·구조·기기 예산 검사를 통과했습니다.",
    contentHash: input.contentHash,
    byteSize: input.metrics.byteSize,
  });
  return buildManifest({
    name: input.name,
    sourceFormat: input.sourceFormat,
    structure: metricsStructure(input.metrics, input),
    admission,
    rights: input.rights ?? EMPTY_RIGHTS,
    hints: input,
  });
}

function objHasMtl(parsed: StudioBg3dObjWorkerCanonicalResult): boolean {
  return parsed.materials.some(
    (material) => material.sourceMtlPath !== null && !material.synthesized,
  );
}

function objNormalMapCount(parsed: StudioBg3dObjWorkerCanonicalResult): number {
  return parsed.materials.reduce(
    (count, material) => count + (material.textures.some(
      (texture) => texture.slot === "normal" || texture.slot === "bump",
    ) ? 1 : 0),
    0,
  );
}

function objAdmission(
  validation: StudioBg3dGlbValidationResult | undefined,
): StudioGeneric3dAdmissionManifest {
  if (!validation) {
    return Object.freeze({
      status: "canonical-validation-pending",
      sourceValidation: "passed",
      canonicalValidation: "pending",
      profile: null,
      code: "canonical-validation-pending",
      message: "OBJ 구조 검사를 통과했습니다. 변환된 GLB의 최종 안전 검사가 필요합니다.",
      contentHash: null,
      byteSize: null,
    });
  }
  const canonical = glbAdmission(validation);
  return Object.freeze({
    ...canonical,
    sourceValidation: "passed",
  });
}

export function createStudioGeneric3dObjManifest(
  input: StudioGeneric3dObjManifestInput,
): StudioGeneric3dModelManifest {
  const canonicalMetrics = input.canonicalValidation?.ok
    ? input.canonicalValidation.metrics
    : null;
  const inferredParts = input.parsed.nodes.filter((node) => node.renderableIndex !== null).length;
  const structure: StudioGeneric3dStructuralEvidence = Object.freeze({
    nodes: safeCount(input.parsed.metrics.nodes),
    meshes: safeCount(input.parsed.metrics.meshes),
    parts: safeCount(input.parts, inferredParts),
    partTransformsSupported: input.partTransformsSupported ?? inferredParts > 1,
    materials: safeCount(input.parsed.metrics.materials),
    textures: new Set(input.parsed.materials.flatMap((material) =>
      material.textures.map((texture) => texture.resourcePath),
    )).size,
    triangles: safeCount(input.parsed.metrics.triangles),
    animations: safeCount(canonicalMetrics?.animations),
    skins: 0,
    joints: 0,
    bones: 0,
    skinnedMeshes: 0,
    morphTargets: 0,
    normalMaps: safeCount(input.normalMaps, objNormalMapCount(input.parsed)),
    nodeNames: normalizeNames([
      ...input.parsed.nodes.map((node) => node.name),
      ...(input.nodeNames ?? []),
    ]),
  });
  const sourceFormat: StudioGeneric3dSourceFormat = objHasMtl(input.parsed)
    ? "obj-mtl"
    : "obj";
  return buildManifest({
    name: input.name,
    sourceFormat,
    structure,
    admission: objAdmission(input.canonicalValidation),
    rights: input.rights ?? EMPTY_RIGHTS,
    hints: input,
  });
}

export function getStudioGeneric3dCapability(
  manifest: StudioGeneric3dModelManifest,
  id: StudioGeneric3dCapabilityId,
): StudioGeneric3dCapability {
  return manifest.capabilities.find((item) => item.id === id)
    ?? capability(id, "unavailable", "이 모델의 기능 정보를 확인할 수 없습니다.");
}
