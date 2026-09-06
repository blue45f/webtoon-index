import {
  parseStudioVrmLicenseMetadata,
  type StudioVrmLicenseMetadataFailureCode,
  type StudioVrmLicenseMetadataReceipt,
} from "./studio-vrm-license-metadata";
import {
  evaluateStudioVrmLicenseAction,
  type StudioVrmLicenseAction,
  type StudioVrmLicenseActionContext,
  type StudioVrmLicenseActionPolicy,
  type StudioVrmAvatarActorBasis,
  type StudioVrmLicensePolicyReason,
  type StudioVrmPublisherKind,
} from "./studio-vrm-license-policy";

import type { CreatorAssetLicenseId } from "../../../shared/lib/creator-asset-contract";

export type StudioVrmLicenseAuthority =
  | {
      readonly status: "verified";
      readonly receipt: StudioVrmLicenseMetadataReceipt;
    }
  | {
      readonly status: "unknown";
      readonly code: StudioVrmLicenseMetadataFailureCode | "not-inspected" | "receipt-unavailable";
      readonly message: string;
    };

export interface StudioVrmLicensePresentation {
  readonly tone: "positive" | "warning" | "blocking";
  readonly badge: string;
  readonly summary: string;
  readonly details: readonly string[];
  readonly licenseUrl: string | null;
  /** Local preview remains selectable for warning/unknown receipts. */
  readonly localPreviewAllowed: boolean;
}

export type StudioVrmAttestedContentClassification = "absent" | "present" | "unknown";

export interface StudioVrmRenderedPoseUseContextReceipt {
  readonly schema: "toonspectrum.vrm-rendered-pose-use-context";
  readonly version: 1;
  /** This receipt is created only after the user explicitly confirms every field in the share UI. */
  readonly confirmedByUser: true;
  readonly actorIdentity: {
    readonly verification: "user-attested";
    readonly avatarPermissionBasis: StudioVrmAvatarActorBasis;
  };
  readonly publisherKind: StudioVrmPublisherKind;
  readonly attribution: {
    readonly verification: "user-attested";
    readonly commitment: "publish-exact-text-unchanged";
    /** Must exactly match the planner's bounded attribution disclosure, including an empty CC0 value. */
    readonly exactText: string;
  };
  readonly containsModifiedModel: boolean;
  readonly content: {
    readonly excessivelyViolent: StudioVrmAttestedContentClassification;
    readonly excessivelySexual: StudioVrmAttestedContentClassification;
    readonly politicalOrReligious: StudioVrmAttestedContentClassification;
    readonly antisocialOrHate: StudioVrmAttestedContentClassification;
  };
  readonly shareAlike: "satisfied" | "not-satisfied" | "unknown";
}

export interface StudioVrmRenderedPoseUseContextInput {
  readonly confirmedByUser: true;
  readonly avatarPermissionBasis: StudioVrmAvatarActorBasis;
  readonly publisherKind: StudioVrmPublisherKind;
  readonly confirmedAttributionText: string;
  readonly containsModifiedModel: boolean;
  readonly excessivelyViolent: StudioVrmAttestedContentClassification;
  readonly excessivelySexual: StudioVrmAttestedContentClassification;
  readonly politicalOrReligious: StudioVrmAttestedContentClassification;
  readonly antisocialOrHate: StudioVrmAttestedContentClassification;
  readonly shareAlike: "satisfied" | "not-satisfied" | "unknown";
}

export interface StudioVrmProjectArchiveUseContextReceipt {
  readonly schema: "toonspectrum.vrm-project-archive-use-context";
  readonly version: 1;
  readonly confirmedByUser: true;
  readonly actorIdentity: {
    readonly verification: "user-attested";
    readonly avatarPermissionBasis: StudioVrmAvatarActorBasis;
  };
  readonly attribution: {
    readonly verification: "user-attested";
    readonly commitment: "retain-exact-embedded-text-unchanged";
    readonly exactTexts: readonly string[];
  };
  readonly content: {
    readonly excessivelyViolent: StudioVrmAttestedContentClassification;
    readonly excessivelySexual: StudioVrmAttestedContentClassification;
    readonly politicalOrReligious: StudioVrmAttestedContentClassification;
    readonly antisocialOrHate: StudioVrmAttestedContentClassification;
  };
}

export interface StudioVrmProjectArchiveUseContextInput {
  readonly confirmedByUser: true;
  readonly avatarPermissionBasis: StudioVrmAvatarActorBasis;
  /** Exact bounded disclosure strings shown by the archive confirmation UI. */
  readonly confirmedAttributionTexts: readonly string[];
  readonly excessivelyViolent: StudioVrmAttestedContentClassification;
  readonly excessivelySexual: StudioVrmAttestedContentClassification;
  readonly politicalOrReligious: StudioVrmAttestedContentClassification;
  readonly antisocialOrHate: StudioVrmAttestedContentClassification;
}

export type StudioVrmProjectArchiveAttestationPlan =
  | {
      readonly ok: true;
      readonly schema: "toonspectrum.vrm-project-archive-attestation-plan";
      readonly version: 1;
      readonly modelCount: number;
      readonly exactAttributionTexts: readonly string[];
      readonly permittedActorBases: readonly Exclude<StudioVrmAvatarActorBasis, "unknown">[];
    }
  | {
      readonly ok: false;
      readonly code:
        | "authority-unknown"
        | "avatar-permission-unrepresentable"
        | "credit-unrepresentable";
      readonly message: string;
    };

export interface StudioVrmRenderedPoseMarketplaceShareContext {
  readonly useContextReceipt: StudioVrmRenderedPoseUseContextReceipt | null;
  /**
   * Explicit structural grant for the ToonSpectrum platform license representation. It is valid
   * only for a rendered pose artifact that contains no original/modified VRM binary.
   */
  readonly toonspectrumRenderedPoseGrant?: {
    readonly schema: "toonspectrum.rendered-pose-platform-grant";
    readonly version: 1;
    readonly renderedPoseOnly: true;
    readonly originalVrmBytesExcluded: true;
  };
}

export type StudioVrmRenderedPoseMarketplaceAttestationPlan =
  | {
      readonly ok: true;
      readonly schema: "toonspectrum.vrm-rendered-pose-attestation-plan";
      readonly version: 1;
      /** Exact text the user must see and confirm before creating the use-context receipt. */
      readonly attributionText: string;
      readonly creditRequired: boolean;
      readonly avatarPermission: StudioVrmLicenseMetadataReceipt["avatarPermission"];
      readonly permittedActorBases: readonly Exclude<StudioVrmAvatarActorBasis, "unknown">[];
    }
  | {
      readonly ok: false;
      readonly code:
        | "authority-unknown"
        | "avatar-permission-unrepresentable"
        | "credit-unrepresentable";
      readonly message: string;
    };

export const STUDIO_VRM_RENDERED_POSE_PLATFORM_GRANT = Object.freeze({
  schema: "toonspectrum.rendered-pose-platform-grant" as const,
  version: 1 as const,
  renderedPoseOnly: true as const,
  originalVrmBytesExcluded: true as const,
});

export interface StudioVrmRenderedPoseSharePolicyReceipts {
  readonly commercialPublish: StudioVrmLicenseActionPolicy;
  readonly derivativeExport: StudioVrmLicenseActionPolicy;
}

export type StudioVrmRenderedPoseMarketplaceSharePlan =
  | {
      readonly ok: true;
      readonly rightsConfirmed: true;
      readonly policyReceipts: StudioVrmRenderedPoseSharePolicyReceipts;
      readonly license: CreatorAssetLicenseId;
      readonly attributionText: string;
    }
  | {
      readonly ok: false;
      readonly code:
        | "authority-unknown"
        | "use-context-missing"
        | "use-context-invalid"
        | "policy-blocked"
        | "license-unrepresentable"
        | "credit-unrepresentable"
        | "attribution-not-confirmed";
      readonly message: string;
      readonly reasons: readonly string[];
      readonly policyReceipts: StudioVrmRenderedPoseSharePolicyReceipts;
    };

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

const CONTENT_CLASSIFICATIONS = new Set<StudioVrmAttestedContentClassification>([
  "absent",
  "present",
  "unknown",
]);
const ACTOR_BASES = new Set<StudioVrmAvatarActorBasis>([
  "author",
  "separately-licensed-person",
  "other",
  "unknown",
]);
const PUBLISHER_KINDS = new Set<StudioVrmPublisherKind>([
  "individual",
  "corporation",
  "unknown",
]);
const SHARE_ALIKE_ATTESTATIONS = new Set([
  "satisfied",
  "not-satisfied",
  "unknown",
] as const);

function isCanonicalAttributionText(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 160) return false;
  if (value === "") return true;
  const canonical = value.normalize("NFC").replace(/\s+/gu, " ").trim();
  if (canonical !== value) return false;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (
      codePoint <= 0x1f
      || (codePoint >= 0x7f && codePoint <= 0x9f)
      || /\p{Cf}/u.test(character)
    ) return false;
  }
  return true;
}

function isCanonicalArchiveAttributionTexts(value: unknown): value is readonly string[] {
  return Array.isArray(value)
    && value.length <= 512
    && value.every(isCanonicalAttributionText)
    && new Set(value).size === value.length;
}

/** Creates the only planner input that can turn UI attestations into outgoing-use context. */
export function createStudioVrmRenderedPoseUseContextReceipt(
  input: StudioVrmRenderedPoseUseContextInput,
): StudioVrmRenderedPoseUseContextReceipt {
  if (
    input.confirmedByUser !== true
    || !ACTOR_BASES.has(input.avatarPermissionBasis)
    || !PUBLISHER_KINDS.has(input.publisherKind)
    || !CONTENT_CLASSIFICATIONS.has(input.excessivelyViolent)
    || !CONTENT_CLASSIFICATIONS.has(input.excessivelySexual)
    || !CONTENT_CLASSIFICATIONS.has(input.politicalOrReligious)
    || !CONTENT_CLASSIFICATIONS.has(input.antisocialOrHate)
    || !isCanonicalAttributionText(input.confirmedAttributionText)
    || typeof input.containsModifiedModel !== "boolean"
    || !SHARE_ALIKE_ATTESTATIONS.has(input.shareAlike)
  ) {
    throw new TypeError("VRM 포즈 공유 이용 맥락 확인값이 올바르지 않습니다.");
  }
  return deepFreeze({
    schema: "toonspectrum.vrm-rendered-pose-use-context" as const,
    version: 1 as const,
    confirmedByUser: true as const,
    actorIdentity: {
      verification: "user-attested" as const,
      avatarPermissionBasis: input.avatarPermissionBasis,
    },
    publisherKind: input.publisherKind,
    attribution: {
      verification: "user-attested" as const,
      commitment: "publish-exact-text-unchanged" as const,
      exactText: input.confirmedAttributionText,
    },
    containsModifiedModel: input.containsModifiedModel,
    content: {
      excessivelyViolent: input.excessivelyViolent,
      excessivelySexual: input.excessivelySexual,
      politicalOrReligious: input.politicalOrReligious,
      antisocialOrHate: input.antisocialOrHate,
    },
    shareAlike: input.shareAlike,
  });
}

function isStudioVrmRenderedPoseUseContextReceipt(
  value: unknown,
): value is StudioVrmRenderedPoseUseContextReceipt {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const receipt = value as Partial<StudioVrmRenderedPoseUseContextReceipt>;
  const actorIdentity = receipt.actorIdentity;
  const attribution = receipt.attribution;
  const content = receipt.content;
  return receipt.schema === "toonspectrum.vrm-rendered-pose-use-context"
    && receipt.version === 1
    && receipt.confirmedByUser === true
    && actorIdentity?.verification === "user-attested"
    && ACTOR_BASES.has(actorIdentity.avatarPermissionBasis)
    && PUBLISHER_KINDS.has(receipt.publisherKind as StudioVrmPublisherKind)
    && attribution?.verification === "user-attested"
    && attribution.commitment === "publish-exact-text-unchanged"
    && isCanonicalAttributionText(attribution.exactText)
    && typeof receipt.containsModifiedModel === "boolean"
    && content !== undefined
    && CONTENT_CLASSIFICATIONS.has(content.excessivelyViolent)
    && CONTENT_CLASSIFICATIONS.has(content.excessivelySexual)
    && CONTENT_CLASSIFICATIONS.has(content.politicalOrReligious)
    && CONTENT_CLASSIFICATIONS.has(content.antisocialOrHate)
    && SHARE_ALIKE_ATTESTATIONS.has(
      receipt.shareAlike as StudioVrmRenderedPoseUseContextReceipt["shareAlike"],
    );
}

function isStudioVrmProjectArchiveUseContextReceipt(
  value: unknown,
): value is StudioVrmProjectArchiveUseContextReceipt {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const receipt = value as Partial<StudioVrmProjectArchiveUseContextReceipt>;
  const actorIdentity = receipt.actorIdentity;
  const content = receipt.content;
  return receipt.schema === "toonspectrum.vrm-project-archive-use-context"
    && receipt.version === 1
    && receipt.confirmedByUser === true
    && actorIdentity?.verification === "user-attested"
    && ACTOR_BASES.has(actorIdentity.avatarPermissionBasis)
    && receipt.attribution?.verification === "user-attested"
    && receipt.attribution.commitment === "retain-exact-embedded-text-unchanged"
    && isCanonicalArchiveAttributionTexts(receipt.attribution.exactTexts)
    && content !== undefined
    && CONTENT_CLASSIFICATIONS.has(content.excessivelyViolent)
    && CONTENT_CLASSIFICATIONS.has(content.excessivelySexual)
    && CONTENT_CLASSIFICATIONS.has(content.politicalOrReligious)
    && CONTENT_CLASSIFICATIONS.has(content.antisocialOrHate);
}

export function createStudioVrmProjectArchiveUseContextReceipt(
  input: StudioVrmProjectArchiveUseContextInput,
): StudioVrmProjectArchiveUseContextReceipt {
  if (
    input.confirmedByUser !== true
    || !ACTOR_BASES.has(input.avatarPermissionBasis)
    || !isCanonicalArchiveAttributionTexts(input.confirmedAttributionTexts)
    || !CONTENT_CLASSIFICATIONS.has(input.excessivelyViolent)
    || !CONTENT_CLASSIFICATIONS.has(input.excessivelySexual)
    || !CONTENT_CLASSIFICATIONS.has(input.politicalOrReligious)
    || !CONTENT_CLASSIFICATIONS.has(input.antisocialOrHate)
  ) {
    throw new TypeError("VRM archive 이용 맥락 확인값이 올바르지 않습니다.");
  }
  return deepFreeze({
    schema: "toonspectrum.vrm-project-archive-use-context" as const,
    version: 1 as const,
    confirmedByUser: true as const,
    actorIdentity: {
      verification: "user-attested" as const,
      avatarPermissionBasis: input.avatarPermissionBasis,
    },
    attribution: {
      verification: "user-attested" as const,
      commitment: "retain-exact-embedded-text-unchanged" as const,
      exactTexts: [...input.confirmedAttributionTexts],
    },
    content: {
      excessivelyViolent: input.excessivelyViolent,
      excessivelySexual: input.excessivelySexual,
      politicalOrReligious: input.politicalOrReligious,
      antisocialOrHate: input.antisocialOrHate,
    },
  });
}

function attestedClassificationValue(
  value: StudioVrmAttestedContentClassification,
): boolean | null {
  return value === "present" ? true : value === "absent" ? false : null;
}

export function studioVrmProjectArchiveActionContext(
  useContextReceipt: StudioVrmProjectArchiveUseContextReceipt | null | undefined,
  licenseReceipt: StudioVrmLicenseMetadataReceipt,
): StudioVrmLicenseActionContext {
  if (!isStudioVrmProjectArchiveUseContextReceipt(useContextReceipt)) return {};
  const expectedAttributionText = boundedAttribution(licenseReceipt);
  return {
    avatarActorBasis: useContextReceipt.actorIdentity.avatarPermissionBasis,
    containsModifiedModel: false,
    containsViolentContent: attestedClassificationValue(
      useContextReceipt.content.excessivelyViolent,
    ),
    containsSexualContent: attestedClassificationValue(
      useContextReceipt.content.excessivelySexual,
    ),
    containsPoliticalOrReligiousContent: attestedClassificationValue(
      useContextReceipt.content.politicalOrReligious,
    ),
    containsAntisocialOrHateContent: attestedClassificationValue(
      useContextReceipt.content.antisocialOrHate,
    ),
    creditProvided: expectedAttributionText !== null
      && useContextReceipt.attribution.exactTexts.includes(expectedAttributionText)
      && studioVrmEmbeddedCreditIsRetained(licenseReceipt),
    // The unchanged GLB retains the model's declared share-alike license and notices.
    shareAlikeSatisfied: licenseReceipt.shareAlike === "required" ? true : null,
  };
}

export function inspectStudioVrmLicenseAuthority(
  gltfJson: unknown,
): StudioVrmLicenseAuthority {
  const parsed = parseStudioVrmLicenseMetadata(gltfJson);
  return parsed.ok
    ? deepFreeze({ status: "verified" as const, receipt: parsed.receipt })
    : deepFreeze({
        status: "unknown" as const,
        code: parsed.code,
        message: parsed.message,
      });
}

export function unknownStudioVrmLicenseAuthority(
  code: Extract<StudioVrmLicenseAuthority, { status: "unknown" }>["code"] = "not-inspected",
  message = "VRM 이용 조건을 확인할 수 없습니다.",
): StudioVrmLicenseAuthority {
  return deepFreeze({ status: "unknown" as const, code, message: message.slice(0, 500) });
}

function unknownPolicy(
  action: StudioVrmLicenseAction,
  authority: Extract<StudioVrmLicenseAuthority, { status: "unknown" }>,
): StudioVrmLicenseActionPolicy {
  const failClosed = action === "derivative-export"
    || action === "project-archive-redistribution"
    || action === "marketplace-share";
  const local = action === "local-preview" || action === "internal-edit";
  const reason: StudioVrmLicensePolicyReason = failClosed
    ? {
        code: "fail-closed-unknown-authority",
        effect: "restriction",
        message: `VRM 이용 조건이 확인되지 않아 내보내기·재배포·공유를 차단했습니다: ${authority.message}`,
      }
    : local
      ? {
          code: "additional-terms-review",
          effect: "warning",
          message: `로컬 작업은 계속할 수 있지만 이용 조건을 확인해야 합니다: ${authority.message}`,
        }
      : {
          code: "commercial-publisher-unknown",
          effect: "uncertainty",
          message: `상업 게시 권한을 확인할 수 없습니다: ${authority.message}`,
        };
  const decision = failClosed ? "block" as const : local ? "warn" as const : "unknown" as const;
  return deepFreeze({
    schema: "toonspectrum.vrm-license-action-policy" as const,
    version: 1 as const,
    action,
    decision,
    authorized: false,
    reasons: Object.freeze([Object.freeze(reason)]),
  });
}

export function evaluateStudioVrmLicenseAuthority(
  authority: StudioVrmLicenseAuthority | null | undefined,
  action: StudioVrmLicenseAction,
  context: StudioVrmLicenseActionContext = {},
): StudioVrmLicenseActionPolicy {
  const resolved = authority ?? unknownStudioVrmLicenseAuthority("receipt-unavailable");
  return resolved.status === "verified"
    ? evaluateStudioVrmLicenseAction(resolved.receipt, action, context)
    : unknownPolicy(action, resolved);
}

function sharePolicyContext(
  receipt: StudioVrmRenderedPoseUseContextReceipt,
  expectedAttributionText: string | null,
): StudioVrmLicenseActionContext {
  return {
    avatarActorBasis: receipt.actorIdentity.avatarPermissionBasis,
    publisherKind: receipt.publisherKind,
    creditProvided: expectedAttributionText !== null
      && receipt.attribution.exactText === expectedAttributionText,
    containsModifiedModel: receipt.containsModifiedModel,
    containsViolentContent: attestedClassificationValue(receipt.content.excessivelyViolent),
    containsSexualContent: attestedClassificationValue(receipt.content.excessivelySexual),
    containsPoliticalOrReligiousContent: attestedClassificationValue(
      receipt.content.politicalOrReligious,
    ),
    containsAntisocialOrHateContent: attestedClassificationValue(
      receipt.content.antisocialOrHate,
    ),
    shareAlikeSatisfied: receipt.shareAlike === "satisfied"
      ? true
      : receipt.shareAlike === "not-satisfied"
        ? false
        : null,
  };
}

function platformLicenseForRenderedPose(
  receipt: StudioVrmLicenseMetadataReceipt,
  context: StudioVrmRenderedPoseMarketplaceShareContext,
): CreatorAssetLicenseId | null {
  if (receipt.licenseIdentifier === "CC0") return "cc0-1.0";
  if (receipt.licenseIdentifier === "CC_BY") return "cc-by-4.0";
  if (receipt.licenseIdentifier === "CC_BY_NC") return "cc-by-nc-4.0";
  // CC BY-SA/ND variants cannot be represented by the current marketplace contract. VRM 1.0's
  // public license can use the narrower platform grant only when the caller explicitly guarantees
  // that the shared artifact is a rendered pose and contains no VRM bytes.
  if (
    receipt.licenseIdentifier === "VRM-Public-License-1.0"
    && context.toonspectrumRenderedPoseGrant?.schema
      === "toonspectrum.rendered-pose-platform-grant"
    && context.toonspectrumRenderedPoseGrant.version === 1
    && context.toonspectrumRenderedPoseGrant.renderedPoseOnly === true
    && context.toonspectrumRenderedPoseGrant.originalVrmBytesExcluded === true
  ) {
    return "toonspectrum-standard";
  }
  return null;
}

function boundedAttribution(
  receipt: StudioVrmLicenseMetadataReceipt,
): string | null {
  if (receipt.credit === "unnecessary") return "";
  if (receipt.credit !== "required" || receipt.authors.length === 0) return null;
  const parts = [
    receipt.title,
    receipt.authors.join(", "),
    receipt.licenseIdentifier,
    receipt.licenseUrl,
  ].filter((part): part is string => Boolean(part));
  const normalized = parts.join(" · ").normalize("NFC").replace(/\s+/gu, " ").trim();
  if (!normalized) return null;
  return normalized.length <= 160 ? normalized : null;
}

function permittedActorBases(
  permission: StudioVrmLicenseMetadataReceipt["avatarPermission"],
): readonly Exclude<StudioVrmAvatarActorBasis, "unknown">[] {
  if (permission === "only-author") return Object.freeze(["author"] as const);
  if (permission === "only-separately-licensed-person") {
    return Object.freeze(["separately-licensed-person"] as const);
  }
  if (permission === "everyone") {
    return Object.freeze(["author", "separately-licensed-person", "other"] as const);
  }
  return Object.freeze([]);
}

/**
 * Builds the exact multi-model disclosure shown before a portable archive redistributes VRM
 * binaries. Actor choices are the intersection allowed by every referenced model.
 */
export function prepareStudioVrmProjectArchiveAttestation(
  authorities: readonly (StudioVrmLicenseAuthority | null | undefined)[],
): StudioVrmProjectArchiveAttestationPlan {
  const exactAttributionTexts: string[] = [];
  let permitted = new Set<Exclude<StudioVrmAvatarActorBasis, "unknown">>([
    "author",
    "separately-licensed-person",
    "other",
  ]);
  for (const authority of authorities) {
    if (!authority || authority.status !== "verified") {
      return deepFreeze({
        ok: false as const,
        code: "authority-unknown" as const,
        message: "프로젝트의 VRM 이용 조건을 모두 확인할 수 없어 archive 확인 단계를 시작할 수 없습니다.",
      });
    }
    const modelActors = new Set(permittedActorBases(authority.receipt.avatarPermission));
    permitted = new Set([...permitted].filter((actor) => modelActors.has(actor)));
    if (permitted.size === 0) {
      return deepFreeze({
        ok: false as const,
        code: "avatar-permission-unrepresentable" as const,
        message: "프로젝트 VRM들의 허용 아바타 사용자 범위가 서로 양립하지 않습니다.",
      });
    }
    const attribution = boundedAttribution(authority.receipt);
    if (attribution === null) {
      return deepFreeze({
        ok: false as const,
        code: "credit-unrepresentable" as const,
        message: "필수 VRM 저작자·라이선스 크레딧을 160자 이내의 archive 고지로 만들 수 없습니다.",
      });
    }
    if (!exactAttributionTexts.includes(attribution)) exactAttributionTexts.push(attribution);
  }
  return deepFreeze({
    ok: true as const,
    schema: "toonspectrum.vrm-project-archive-attestation-plan" as const,
    version: 1 as const,
    modelCount: authorities.length,
    exactAttributionTexts,
    permittedActorBases: [...permitted],
  });
}

/**
 * First pass for share UI. The returned attribution must be shown verbatim and passed back through
 * `createStudioVrmRenderedPoseUseContextReceipt`; the planner rejects any different text.
 */
export function prepareStudioVrmRenderedPoseMarketplaceAttestation(
  authority: StudioVrmLicenseAuthority | null | undefined,
): StudioVrmRenderedPoseMarketplaceAttestationPlan {
  if (!authority || authority.status !== "verified") {
    return deepFreeze({
      ok: false as const,
      code: "authority-unknown" as const,
      message: "이 VRM의 이용 조건을 확인할 수 없어 공유 확인 단계를 시작할 수 없습니다.",
    });
  }
  const actors = permittedActorBases(authority.receipt.avatarPermission);
  if (actors.length === 0) {
    return deepFreeze({
      ok: false as const,
      code: "avatar-permission-unrepresentable" as const,
      message: "이 VRM의 아바타 사용자 범위를 확인할 수 없어 포즈 공유를 차단했습니다.",
    });
  }
  const attributionText = boundedAttribution(authority.receipt);
  if (attributionText === null) {
    return deepFreeze({
      ok: false as const,
      code: "credit-unrepresentable" as const,
      message: "필수 저작자·라이선스 크레딧을 160자 이내의 공유 정보로 만들 수 없습니다.",
    });
  }
  return deepFreeze({
    ok: true as const,
    schema: "toonspectrum.vrm-rendered-pose-attestation-plan" as const,
    version: 1 as const,
    attributionText,
    creditRequired: authority.receipt.credit === "required",
    avatarPermission: authority.receipt.avatarPermission,
    permittedActorBases: actors,
  });
}

/**
 * Plans marketplace publication of a rendered pose only. It deliberately does not evaluate the
 * binary-redistribution action: a successful caller must publish only the rendered pose payload
 * and must pass the returned license/attribution/rightsConfirmed fields without substitution.
 */
export function planStudioVrmRenderedPoseMarketplaceShare(
  authority: StudioVrmLicenseAuthority | null | undefined,
  context: StudioVrmRenderedPoseMarketplaceShareContext,
): StudioVrmRenderedPoseMarketplaceSharePlan {
  const suppliedUseContextReceipt = context.useContextReceipt;
  const useContextReceipt = isStudioVrmRenderedPoseUseContextReceipt(suppliedUseContextReceipt)
    ? suppliedUseContextReceipt
    : null;
  const expectedAttributionText = authority?.status === "verified"
    ? boundedAttribution(authority.receipt)
    : null;
  const actionContext = useContextReceipt
    ? sharePolicyContext(useContextReceipt, expectedAttributionText)
    : {};
  const policyReceipts = deepFreeze({
    commercialPublish: evaluateStudioVrmLicenseAuthority(
      authority,
      "commercial-publish",
      actionContext,
    ),
    derivativeExport: evaluateStudioVrmLicenseAuthority(
      authority,
      "derivative-export",
      actionContext,
    ),
  });
  const reasons = Object.freeze([
    ...policyReceipts.commercialPublish.reasons.map(({ message }) => message),
    ...policyReceipts.derivativeExport.reasons.map(({ message }) => message),
  ]);
  if (suppliedUseContextReceipt !== null && !useContextReceipt) {
    return deepFreeze({
      ok: false as const,
      code: "use-context-invalid" as const,
      message: "포즈 공유 이용 맥락 receipt가 손상되었거나 지원되지 않는 형식입니다.",
      reasons,
      policyReceipts,
    });
  }
  if (!useContextReceipt) {
    return deepFreeze({
      ok: false as const,
      code: "use-context-missing" as const,
      message: "사용자 정체성과 콘텐츠 이용 맥락 확인이 없어 포즈 공유를 차단했습니다.",
      reasons,
      policyReceipts,
    });
  }
  if (!authority || authority.status !== "verified") {
    return deepFreeze({
      ok: false as const,
      code: "authority-unknown" as const,
      message: "이 VRM의 이용 조건을 확인할 수 없어 포즈 공유를 차단했습니다.",
      reasons,
      policyReceipts,
    });
  }
  if (expectedAttributionText === null) {
    return deepFreeze({
      ok: false as const,
      code: "credit-unrepresentable" as const,
      message: "필수 저작자·라이선스 크레딧을 포즈 공유 정보로 만들 수 없습니다.",
      reasons,
      policyReceipts,
    });
  }
  if (useContextReceipt.attribution.exactText !== expectedAttributionText) {
    return deepFreeze({
      ok: false as const,
      code: "attribution-not-confirmed" as const,
      message: "현재 VRM의 정확한 크레딧 문구가 사용자 확인 receipt와 일치하지 않습니다.",
      reasons,
      policyReceipts,
    });
  }
  if (!policyReceipts.commercialPublish.authorized || !policyReceipts.derivativeExport.authorized) {
    return deepFreeze({
      ok: false as const,
      code: "policy-blocked" as const,
      message: "이 VRM의 상업 게시 또는 파생물 내보내기 조건이 포즈 공유를 허용하지 않습니다.",
      reasons,
      policyReceipts,
    });
  }
  const license = platformLicenseForRenderedPose(authority.receipt, context);
  if (!license) {
    return deepFreeze({
      ok: false as const,
      code: "license-unrepresentable" as const,
      message: "이 VRM의 라이선스를 현재 포즈 마켓의 사용권으로 정확히 표시할 수 없습니다.",
      reasons,
      policyReceipts,
    });
  }
  return deepFreeze({
    ok: true as const,
    rightsConfirmed: true as const,
    policyReceipts,
    license,
    attributionText: expectedAttributionText,
  });
}

/**
 * An unchanged VRM file carries its own author/license metadata into an archive. This is evidence
 * that the embedded notice is retained, not a claim that every external attribution format is met.
 */
export function studioVrmEmbeddedCreditIsRetained(
  receipt: StudioVrmLicenseMetadataReceipt,
): boolean {
  return receipt.authors.length > 0
    && (receipt.licenseIdentifier !== null || receipt.licenseUrl !== null);
}

function commercialLabel(receipt: StudioVrmLicenseMetadataReceipt): string {
  const labels: Record<StudioVrmLicenseMetadataReceipt["commercial"], string> = {
    allow: "상업 이용 허용",
    disallow: "상업 이용 금지",
    "personal-nonprofit": "개인 비영리 전용",
    "personal-profit": "개인 수익 활동 허용",
    corporation: "법인 상업 이용 허용",
    unknown: "상업 이용 미확인",
  };
  return labels[receipt.commercial];
}

function modificationLabel(receipt: StudioVrmLicenseMetadataReceipt): string {
  const labels: Record<StudioVrmLicenseMetadataReceipt["modification"], string> = {
    prohibited: "모델 개조 금지",
    "allow-modification": "개조 허용·개조본 재배포 금지",
    "allow-modification-redistribution": "개조 및 개조본 재배포 허용",
    unknown: "개조 권한 미확인",
  };
  return labels[receipt.modification];
}

export function presentStudioVrmLicenseAuthority(
  authority: StudioVrmLicenseAuthority | null | undefined,
): StudioVrmLicensePresentation {
  const localPolicy = evaluateStudioVrmLicenseAuthority(authority, "local-preview");
  if (!authority || authority.status === "unknown") {
    return deepFreeze({
      tone: "warning" as const,
      badge: "권리 미확인",
      summary: "로컬 미리보기만 가능하며 내보내기·재배포·공유는 차단됩니다.",
      details: Object.freeze([authority?.message ?? "저장된 이용 조건 receipt가 없습니다."]),
      licenseUrl: null,
      localPreviewAllowed: true,
    });
  }
  const receipt = authority.receipt;
  const redistributionPolicy = evaluateStudioVrmLicenseAuthority(
    authority,
    "project-archive-redistribution",
    {
      containsModifiedModel: false,
      creditProvided: studioVrmEmbeddedCreditIsRetained(receipt),
      shareAlikeSatisfied: receipt.shareAlike === "required" ? true : null,
    },
  );
  const redistribution = receipt.redistribution === "allow"
    ? "원본 파일 재배포 허용"
    : receipt.redistribution === "disallow"
      ? "원본 파일 재배포 금지"
      : "재배포 권한 미확인";
  const credit = receipt.credit === "required"
    ? "크레딧 필수"
    : receipt.credit === "unnecessary"
      ? "크레딧 선택"
      : "크레딧 조건 미확인";
  const tone = localPolicy.decision === "allow" && redistributionPolicy.decision === "allow"
    ? "positive" as const
    : localPolicy.decision === "block" || redistributionPolicy.decision === "block"
      ? "blocking" as const
      : "warning" as const;
  return deepFreeze({
    tone,
    badge: receipt.conformance !== "conformant"
      ? "조건 오류"
      : redistributionPolicy.authorized
        ? "이용 조건 확인"
        : "재배포 제한",
    summary: receipt.title
      ? `${receipt.title} · ${receipt.spec === "vrm1" ? "VRM 1.0" : "VRM 0.x"}`
      : receipt.spec === "vrm1" ? "VRM 1.0 이용 조건" : "VRM 0.x 이용 조건",
    details: Object.freeze([
      commercialLabel(receipt),
      modificationLabel(receipt),
      redistribution,
      credit,
    ]),
    licenseUrl: receipt.additionalLicenseUrl ?? receipt.licenseUrl,
    localPreviewAllowed: localPolicy.decision !== "block",
  });
}
