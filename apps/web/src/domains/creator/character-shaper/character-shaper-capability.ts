/**
 * Character Shaper — capability profile and per-entry availability.
 *
 * A profile is a cheap, serialisable summary of what the loaded VRM can honour (semantic face
 * morph providers, expression names, costume slots, humanoid bones, iris tintability, …).
 * `evaluateCharacterSlotEntry` turns an entry's requirement list into `available` / `partial` /
 * `unavailable` with a plain Korean reason — the UI never substitutes silently.
 */

import { AVATAR_FORGE_SEMANTIC_FACE_MORPH_IDS } from "../vrm/studio-vrm-avatar-forge";
import { COSTUME_SLOT_LABELS } from "../vrm/studio-vrm-costume";
import { collectStudioVrmCostumeMeshes } from "../vrm/studio-vrm-costume-runtime";
import { inspectStudioVrmSemanticFaceMorphProfile } from "../vrm/studio-vrm-semantic-face-morph";

import { canTintCharacterIris } from "./character-shaper-iris-tint";

import type {
  CharacterCapabilityProfile,
  CharacterCapabilityRequirement,
  CharacterSlotAvailability,
  CharacterSlotAvailabilityStatus,
  CharacterSlotEntry,
} from "./character-shaper-contract";
import type { AvatarForgeSemanticFaceMorphId } from "../vrm/studio-vrm-avatar-forge";
import type { CostumeSlot } from "../vrm/studio-vrm-costume";
import type { StudioVrmSemanticFaceMorphProvider } from "../vrm/studio-vrm-semantic-face-morph";
import type { VRM } from "@pixiv/three-vrm";

/** Korean labels for the semantic morph ids, used in availability reasons. */
export const CHARACTER_SEMANTIC_MORPH_LABELS: Readonly<Record<AvatarForgeSemanticFaceMorphId, string>> = Object.freeze({
  eyeSize: "눈 크기",
  eyeSpacing: "눈 간격",
  eyeTilt: "눈꼬리",
  irisSize: "홍채 크기",
  noseHeight: "코 높이",
  noseWidth: "코 너비",
  mouthWidth: "입 너비",
  lipFullness: "입술 볼륨",
  earSize: "귀 크기",
});

function emptySemanticMorphs(): Record<AvatarForgeSemanticFaceMorphId, StudioVrmSemanticFaceMorphProvider | null> {
  const next = {} as Record<AvatarForgeSemanticFaceMorphId, StudioVrmSemanticFaceMorphProvider | null>;
  for (const id of AVATAR_FORGE_SEMANTIC_FACE_MORPH_IDS) next[id] = null;
  return next;
}

export const EMPTY_CHARACTER_CAPABILITY_PROFILE: CharacterCapabilityProfile = Object.freeze({
  status: "empty",
  modelId: null,
  modelName: "",
  humanoid: false,
  semanticMorphs: Object.freeze(emptySemanticMorphs()),
  expressions: Object.freeze([]),
  costumeSlots: Object.freeze([]),
  wardrobeMetricsReady: false,
  propsReady: false,
  irisTintable: false,
  originalHairMeshCount: 0,
  surfacePaintReady: false,
});

export interface CreateCharacterCapabilityProfileInput {
  readonly vrm: VRM | null;
  readonly status: CharacterCapabilityProfile["status"];
  readonly modelId: string | null;
  readonly modelName: string;
  readonly wardrobeMetricsReady: boolean;
  readonly originalHairMeshCount: number;
  readonly surfacePaintReady: boolean;
}

type HumanoidLike = {
  humanBones?: Partial<Record<string, { node?: unknown } | undefined>>;
  getRawBoneNode?: (name: "hips") => unknown;
};

function detectHumanoid(vrm: VRM): boolean {
  const humanoid = (vrm as { humanoid?: HumanoidLike | null }).humanoid;
  if (!humanoid) return false;
  try {
    if (typeof humanoid.getRawBoneNode === "function" && humanoid.getRawBoneNode("hips")) return true;
  } catch {
    // A partially constructed humanoid must not take the whole profile down; fall through.
  }
  return Boolean(humanoid.humanBones?.hips?.node);
}

function detectExpressions(vrm: VRM): string[] {
  const manager = (vrm as { expressionManager?: { expressionMap?: Record<string, unknown>; expressions?: { expressionName?: string }[] } | null }).expressionManager;
  if (!manager) return [];
  try {
    const fromMap = Object.keys(manager.expressionMap ?? {});
    if (fromMap.length > 0) return [...new Set(fromMap)].sort();
    const fromList = (manager.expressions ?? [])
      .map((expression) => expression.expressionName)
      .filter((name): name is string => typeof name === "string" && name.length > 0);
    return [...new Set(fromList)].sort();
  } catch {
    return [];
  }
}

function detectSemanticMorphs(vrm: VRM): Record<AvatarForgeSemanticFaceMorphId, StudioVrmSemanticFaceMorphProvider | null> {
  const next = emptySemanticMorphs();
  try {
    for (const control of inspectStudioVrmSemanticFaceMorphProfile(vrm).controls) {
      next[control.id] = control.provider;
    }
  } catch {
    // No shape keys / no face mesh: every id stays null and the entries report it honestly.
  }
  return next;
}

function detectCostumeSlots(vrm: VRM): CostumeSlot[] {
  try {
    const slots = new Set<CostumeSlot>();
    for (const mesh of collectStudioVrmCostumeMeshes(vrm)) slots.add(mesh.slot);
    return [...slots];
  } catch {
    return [];
  }
}

function safeIrisTintable(vrm: VRM): boolean {
  try {
    return canTintCharacterIris(vrm);
  } catch {
    return false;
  }
}

export function createCharacterCapabilityProfile(input: CreateCharacterCapabilityProfileInput): CharacterCapabilityProfile {
  const base = {
    status: input.status,
    modelId: input.modelId,
    modelName: input.modelName,
    wardrobeMetricsReady: input.wardrobeMetricsReady,
    originalHairMeshCount: Math.max(0, Math.floor(Number.isFinite(input.originalHairMeshCount) ? input.originalHairMeshCount : 0)),
    surfacePaintReady: input.surfacePaintReady,
  };
  if (!input.vrm) {
    return Object.freeze({
      ...EMPTY_CHARACTER_CAPABILITY_PROFILE,
      ...base,
      wardrobeMetricsReady: false,
      propsReady: false,
      irisTintable: false,
    });
  }
  const humanoid = detectHumanoid(input.vrm);
  return Object.freeze({
    ...base,
    humanoid,
    semanticMorphs: Object.freeze(detectSemanticMorphs(input.vrm)),
    expressions: Object.freeze(detectExpressions(input.vrm)),
    costumeSlots: Object.freeze(detectCostumeSlots(input.vrm)),
    propsReady: humanoid,
    irisTintable: safeIrisTintable(input.vrm),
  });
}

/* -------------------------------------------------------------------------- */
/* Availability                                                                */
/* -------------------------------------------------------------------------- */

const STATUS_RANK: Readonly<Record<CharacterSlotAvailabilityStatus, number>> = { available: 0, partial: 1, unavailable: 2 };

function worst(a: CharacterSlotAvailabilityStatus, b: CharacterSlotAvailabilityStatus): CharacterSlotAvailabilityStatus {
  return STATUS_RANK[a] >= STATUS_RANK[b] ? a : b;
}

function joinKorean(values: readonly string[]): string {
  return values.join("·");
}

function modelStatusReason(status: CharacterCapabilityProfile["status"]): string {
  switch (status) {
    case "loading":
      return "모델을 불러오는 중입니다.";
    case "error":
      return "모델을 불러오지 못했습니다.";
    case "ready":
      return "";
    default:
      return "모델을 먼저 불러와 주세요.";
  }
}

type Verdict = { readonly status: CharacterSlotAvailabilityStatus; readonly reason: string | null; readonly missing: readonly string[] };

const OK: Verdict = { status: "available", reason: null, missing: [] };

function evaluateRequirement(requirement: CharacterCapabilityRequirement, profile: CharacterCapabilityProfile): Verdict {
  switch (requirement.kind) {
    case "model-loaded":
      return profile.status === "ready" ? OK : { status: "unavailable", reason: modelStatusReason(profile.status), missing: [] };
    case "semantic-morph": {
      const missing = requirement.ids.filter((id) => !profile.semanticMorphs[id]);
      if (missing.length === 0) return OK;
      const labels = joinKorean(missing.map((id) => CHARACTER_SEMANTIC_MORPH_LABELS[id]));
      if (missing.length === requirement.ids.length) {
        return {
          status: "unavailable",
          reason: `이 모델에는 ${labels} shape key와 적응형 얼굴 메시가 없어 적용할 수 없습니다.`,
          missing,
        };
      }
      return { status: "partial", reason: `${labels} 조절은 이 모델에서 지원되지 않아 나머지만 적용됩니다.`, missing };
    }
    case "iris-tint":
      return profile.irisTintable
        ? OK
        : { status: "unavailable", reason: "이 모델에서 눈동자 메시를 찾지 못해 색을 입힐 수 없습니다.", missing: [] };
    case "expression": {
      if (requirement.names.length === 0) return OK;
      if (profile.expressions.length === 0) {
        return { status: "unavailable", reason: "이 모델에는 표정(expression) 데이터가 없습니다.", missing: [...requirement.names] };
      }
      const present = new Set(profile.expressions);
      const missing = requirement.names.filter((name) => !present.has(name));
      if (missing.length === 0) return OK;
      const labels = joinKorean(missing);
      if (missing.length === requirement.names.length) {
        return { status: "unavailable", reason: `이 모델에 ${labels} 표정이 없어 적용할 수 없습니다.`, missing };
      }
      return { status: "partial", reason: `${labels} 표정이 없어 일부만 적용됩니다.`, missing };
    }
    case "wardrobe-metrics":
      return profile.wardrobeMetricsReady
        ? OK
        : { status: "unavailable", reason: "골격 치수를 아직 재지 못해 의상을 입힐 수 없습니다.", missing: [] };
    case "costume-slot": {
      const present = new Set(profile.costumeSlots);
      const missing = requirement.slots.filter((slot) => !present.has(slot));
      if (missing.length < requirement.slots.length) return OK;
      const labels = joinKorean(missing.map((slot) => COSTUME_SLOT_LABELS[slot]));
      return { status: "partial", reason: `이 모델에서 ${labels} 의상 메시를 찾지 못했습니다. 절차형 의상만 해제됩니다.`, missing };
    }
    case "props":
      return profile.propsReady
        ? OK
        : { status: "unavailable", reason: "소품을 붙일 humanoid 본을 찾지 못했습니다.", missing: [] };
    case "humanoid":
      return profile.humanoid
        ? OK
        : { status: "unavailable", reason: "humanoid 본이 없는 모델에는 포즈를 적용할 수 없습니다.", missing: [] };
    case "hair-original":
      return profile.originalHairMeshCount > 0
        ? OK
        : { status: "unavailable", reason: "이 모델에서 원본 헤어 메시를 찾지 못했습니다.", missing: [] };
    default:
      return OK;
  }
}

/**
 * Availability of one entry for the current model. A model that is not `ready` makes every entry
 * unavailable; otherwise the worst requirement verdict wins and reasons are concatenated.
 */
export function evaluateCharacterSlotEntry(
  entry: CharacterSlotEntry,
  profile: CharacterCapabilityProfile,
): CharacterSlotAvailability {
  if (profile.status !== "ready") {
    return Object.freeze({ status: "unavailable", reason: modelStatusReason(profile.status), missing: Object.freeze([]) });
  }
  let status: CharacterSlotAvailabilityStatus = "available";
  const reasons: string[] = [];
  const missing: string[] = [];
  for (const requirement of entry.requires) {
    let verdict = evaluateRequirement(requirement, profile);
    // A mouth entry's expression floor is secondary to its rest-shape morphs: a model without the
    // floor expression still gets the morph part, so the verdict is partial rather than unavailable.
    if (requirement.kind === "expression" && entry.apply.kind === "mouth" && verdict.status === "unavailable") {
      verdict = {
        status: "partial",
        reason: `${joinKorean(verdict.missing)} 표정이 없어 입모양 morph만 적용됩니다.`,
        missing: verdict.missing,
      };
    }
    status = worst(status, verdict.status);
    if (verdict.reason && !reasons.includes(verdict.reason)) reasons.push(verdict.reason);
    for (const id of verdict.missing) if (!missing.includes(id)) missing.push(id);
  }
  return Object.freeze({
    status,
    reason: reasons.length > 0 ? reasons.join(" ") : null,
    missing: Object.freeze(missing),
  });
}
