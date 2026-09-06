import type {
  StudioVrmLicenseMetadataReceipt,
} from "./studio-vrm-license-metadata";

export const STUDIO_VRM_LICENSE_ACTIONS = [
  "local-preview",
  "internal-edit",
  "commercial-publish",
  "derivative-export",
  "project-archive-redistribution",
  "marketplace-share",
] as const;

export type StudioVrmLicenseAction = (typeof STUDIO_VRM_LICENSE_ACTIONS)[number];
export type StudioVrmLicenseDecision = "allow" | "warn" | "block" | "unknown";
export type StudioVrmPublisherKind = "individual" | "corporation" | "unknown";
export type StudioVrmAvatarActorBasis =
  | "author"
  | "separately-licensed-person"
  | "other"
  | "unknown";

export interface StudioVrmLicenseActionContext {
  /** Explicit relationship between the acting user and the model license; never inferred by name. */
  readonly avatarActorBasis?: StudioVrmAvatarActorBasis;
  /** Required to distinguish VRM 1.0 personal-profit and corporation grants. */
  readonly publisherKind?: StudioVrmPublisherKind;
  /** Whether a required creator/license credit is included in the outgoing artifact. */
  readonly creditProvided?: boolean | null;
  readonly containsViolentContent?: boolean | null;
  readonly containsSexualContent?: boolean | null;
  readonly containsPoliticalOrReligiousContent?: boolean | null;
  readonly containsAntisocialOrHateContent?: boolean | null;
  /** Archives and marketplace shares conservatively assume a modified model unless set false. */
  readonly containsModifiedModel?: boolean;
  /** Relevant to legacy CC BY-SA / CC BY-NC-SA redistribution. */
  readonly shareAlikeSatisfied?: boolean | null;
}

export type StudioVrmLicensePolicyReasonCode =
  | "local-processing-only"
  | "metadata-nonconformant"
  | "additional-terms-review"
  | "avatar-permission-allowed"
  | "avatar-permission-prohibited"
  | "avatar-permission-unknown"
  | "content-context-unknown"
  | "commercial-use-allowed"
  | "commercial-use-prohibited"
  | "commercial-publisher-unknown"
  | "corporation-use-prohibited"
  | "modification-allowed"
  | "modification-prohibited"
  | "modification-unknown"
  | "modified-redistribution-prohibited"
  | "redistribution-allowed"
  | "redistribution-prohibited"
  | "redistribution-unknown"
  | "credit-required"
  | "credit-confirmed"
  | "credit-missing"
  | "credit-unknown"
  | "violent-use-prohibited"
  | "violent-use-unknown"
  | "sexual-use-prohibited"
  | "sexual-use-unknown"
  | "political-or-religious-use-prohibited"
  | "political-or-religious-use-unknown"
  | "antisocial-or-hate-use-prohibited"
  | "antisocial-or-hate-use-unknown"
  | "share-alike-confirmed"
  | "share-alike-required"
  | "fail-closed-unknown-authority";

export interface StudioVrmLicensePolicyReason {
  readonly code: StudioVrmLicensePolicyReasonCode;
  readonly effect: "information" | "warning" | "uncertainty" | "restriction";
  readonly message: string;
}

export interface StudioVrmLicenseActionPolicy {
  readonly schema: "toonspectrum.vrm-license-action-policy";
  readonly version: 1;
  readonly action: StudioVrmLicenseAction;
  readonly decision: StudioVrmLicenseDecision;
  /** Only `allow` is an unconditional authorization receipt. */
  readonly authorized: boolean;
  readonly reasons: readonly StudioVrmLicensePolicyReason[];
}

const FAIL_CLOSED_ACTIONS = new Set<StudioVrmLicenseAction>([
  "derivative-export",
  "project-archive-redistribution",
  "marketplace-share",
]);

const EXPLICIT_USE_CONTEXT_ACTIONS = new Set<StudioVrmLicenseAction>([
  "commercial-publish",
  "derivative-export",
  "project-archive-redistribution",
  "marketplace-share",
]);

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function evaluateDecision(reasons: readonly StudioVrmLicensePolicyReason[]): StudioVrmLicenseDecision {
  if (reasons.some(({ effect }) => effect === "restriction")) return "block";
  if (reasons.some(({ effect }) => effect === "uncertainty")) return "unknown";
  if (reasons.some(({ effect }) => effect === "warning")) return "warn";
  return "allow";
}

function isOutgoingAction(action: StudioVrmLicenseAction): boolean {
  return action === "commercial-publish"
    || action === "derivative-export"
    || action === "project-archive-redistribution"
    || action === "marketplace-share";
}

function isRedistributionAction(action: StudioVrmLicenseAction): boolean {
  return action === "project-archive-redistribution" || action === "marketplace-share";
}

function addFailClosedUnknown(
  reasons: StudioVrmLicensePolicyReason[],
  action: StudioVrmLicenseAction,
  message: string
): void {
  if (FAIL_CLOSED_ACTIONS.has(action)) {
    reasons.push({
      code: "fail-closed-unknown-authority",
      effect: "restriction",
      message,
    });
  } else if (action === "commercial-publish") {
    reasons.push({
      code: "commercial-publisher-unknown",
      effect: "uncertainty",
      message,
    });
  } else {
    reasons.push({
      code: "additional-terms-review",
      effect: "warning",
      message,
    });
  }
}

function applyMetadataAuthority(
  receipt: StudioVrmLicenseMetadataReceipt,
  action: StudioVrmLicenseAction,
  reasons: StudioVrmLicensePolicyReason[]
): void {
  if (receipt.conformance === "nonconformant") {
    if (FAIL_CLOSED_ACTIONS.has(action)) {
      reasons.push({
        code: "fail-closed-unknown-authority",
        effect: "restriction",
        message: "Malformed or nonconformant VRM metadata cannot authorize export, redistribution, or sharing.",
      });
    } else if (action === "commercial-publish") {
      reasons.push({
        code: "metadata-nonconformant",
        effect: "uncertainty",
        message: "The VRM metadata is nonconformant, so commercial publication is not authorized by this receipt.",
      });
    } else {
      reasons.push({
        code: "metadata-nonconformant",
        effect: "warning",
        message: "The VRM metadata is nonconformant; local work may continue only with a visible rights warning.",
      });
    }
  }

  if (receipt.licenseIdentifier === null || receipt.licenseIdentifier === "Other") {
    addFailClosedUnknown(
      reasons,
      action,
      "No recognized base license identifier is available, so this receipt cannot establish outgoing-use authority."
    );
  }

  if (
    receipt.additionalLicenseUrl
    || receipt.additionalPermissionUrl
    || receipt.thirdPartyLicenses
  ) {
    addFailClosedUnknown(
      reasons,
      action,
      "The model declares additional or third-party license terms that this metadata-only policy has not evaluated."
    );
  }
}

function applyAvatarPermission(
  receipt: StudioVrmLicenseMetadataReceipt,
  action: StudioVrmLicenseAction,
  context: StudioVrmLicenseActionContext,
  reasons: StudioVrmLicensePolicyReason[],
): void {
  if (!EXPLICIT_USE_CONTEXT_ACTIONS.has(action)) return;
  const actor = context.avatarActorBasis ?? "unknown";
  const allowed = receipt.avatarPermission === "everyone"
    ? actor !== "unknown"
    : receipt.avatarPermission === "only-author"
      ? actor === "author"
      : receipt.avatarPermission === "only-separately-licensed-person"
        ? actor === "separately-licensed-person"
        : false;
  if (allowed) {
    reasons.push({
      code: "avatar-permission-allowed",
      effect: "information",
      message: "The acting user's attested relationship satisfies the avatar-permission scope.",
    });
    return;
  }
  if (actor === "unknown" || receipt.avatarPermission === "unknown") {
    reasons.push({
      code: "avatar-permission-unknown",
      effect: "restriction",
      message: "The acting user's avatar-permission scope is unknown, so outgoing use is blocked.",
    });
    return;
  }
  reasons.push({
    code: "avatar-permission-prohibited",
    effect: "restriction",
    message: "The acting user's attested relationship is outside the model's avatar-permission scope.",
  });
}

function applyOneContentClassification(
  action: StudioVrmLicenseAction,
  declared: StudioVrmLicenseMetadataReceipt["violent"],
  present: boolean | null | undefined,
  prohibitedCode: Extract<StudioVrmLicensePolicyReasonCode,
    | "violent-use-prohibited"
    | "sexual-use-prohibited"
    | "political-or-religious-use-prohibited"
    | "antisocial-or-hate-use-prohibited">,
  unknownCode: Extract<StudioVrmLicensePolicyReasonCode,
    | "violent-use-unknown"
    | "sexual-use-unknown"
    | "political-or-religious-use-unknown"
    | "antisocial-or-hate-use-unknown">,
  label: string,
  reasons: StudioVrmLicensePolicyReason[],
): void {
  const outgoing = EXPLICIT_USE_CONTEXT_ACTIONS.has(action);
  if (present === undefined || present === null) {
    if (outgoing) {
      reasons.push({
        code: "content-context-unknown",
        effect: "restriction",
        message: `${label} classification was not explicitly attested, so outgoing use is blocked.`,
      });
    }
    return;
  }
  if (!present) return;
  if (declared === "disallow") {
    reasons.push({
      code: prohibitedCode,
      effect: "restriction",
      message: `The VRM metadata prohibits use in ${label}.`,
    });
  } else if (declared === "unknown") {
    reasons.push({
      code: unknownCode,
      effect: outgoing ? "restriction" : "warning",
      message: `${label} permission is not declared.`,
    });
  }
}

function applyContentRestrictions(
  receipt: StudioVrmLicenseMetadataReceipt,
  action: StudioVrmLicenseAction,
  context: StudioVrmLicenseActionContext,
  reasons: StudioVrmLicensePolicyReason[]
): void {
  applyOneContentClassification(
    action,
    receipt.violent,
    context.containsViolentContent,
    "violent-use-prohibited",
    "violent-use-unknown",
    "excessively violent content",
    reasons,
  );
  applyOneContentClassification(
    action,
    receipt.sexual,
    context.containsSexualContent,
    "sexual-use-prohibited",
    "sexual-use-unknown",
    "excessively sexual content",
    reasons,
  );
  applyOneContentClassification(
    action,
    receipt.politicalOrReligious,
    context.containsPoliticalOrReligiousContent,
    "political-or-religious-use-prohibited",
    "political-or-religious-use-unknown",
    "political or religious content",
    reasons,
  );
  applyOneContentClassification(
    action,
    receipt.antisocialOrHate,
    context.containsAntisocialOrHateContent,
    "antisocial-or-hate-use-prohibited",
    "antisocial-or-hate-use-unknown",
    "antisocial activity or hate content",
    reasons,
  );
}

function applyModificationPermission(
  receipt: StudioVrmLicenseMetadataReceipt,
  action: StudioVrmLicenseAction,
  reasons: StudioVrmLicensePolicyReason[],
  requiresRedistributableDerivative: boolean
): void {
  if (receipt.modification === "prohibited") {
    reasons.push({
      code: "modification-prohibited",
      effect: "restriction",
      message: "The VRM license metadata prohibits creating a derivative model.",
    });
    return;
  }
  if (receipt.modification === "unknown") {
    if (FAIL_CLOSED_ACTIONS.has(action)) {
      reasons.push({
        code: "fail-closed-unknown-authority",
        effect: "restriction",
        message: "Modification permission is unknown, so a derivative export or share is blocked.",
      });
    } else {
      reasons.push({
        code: "modification-unknown",
        effect: "warning",
        message: "Modification permission is unknown; keep edits local until the license is reviewed.",
      });
    }
    return;
  }
  if (
    requiresRedistributableDerivative
    && receipt.modification !== "allow-modification-redistribution"
  ) {
    reasons.push({
      code: "modified-redistribution-prohibited",
      effect: "restriction",
      message: "Modification is allowed, but redistribution of the modified model is not allowed.",
    });
    return;
  }
  reasons.push({
    code: "modification-allowed",
    effect: "information",
    message: requiresRedistributableDerivative
      ? "The metadata allows modification and redistribution of the modified model."
      : "The metadata allows modification for this action.",
  });
}

function applyCommercialPermission(
  receipt: StudioVrmLicenseMetadataReceipt,
  context: StudioVrmLicenseActionContext,
  reasons: StudioVrmLicensePolicyReason[]
): void {
  if (receipt.commercial === "disallow" || receipt.commercial === "personal-nonprofit") {
    reasons.push({
      code: "commercial-use-prohibited",
      effect: "restriction",
      message: "The VRM metadata does not permit this commercial publication.",
    });
    return;
  }
  if (receipt.commercial === "unknown") {
    reasons.push({
      code: "commercial-publisher-unknown",
      effect: "uncertainty",
      message: "Commercial-use authority is not declared or could not be normalized.",
    });
    return;
  }
  if (receipt.commercial === "personal-profit") {
    if ((context.publisherKind ?? "unknown") === "corporation") {
      reasons.push({
        code: "corporation-use-prohibited",
        effect: "restriction",
        message: "VRM 1.0 personal-profit permission does not authorize corporate use.",
      });
      return;
    }
    if ((context.publisherKind ?? "unknown") !== "individual") {
      reasons.push({
        code: "commercial-publisher-unknown",
        effect: "uncertainty",
        message: "Confirm that the publisher is an individual before relying on personal-profit permission.",
      });
      return;
    }
  }
  reasons.push({
    code: "commercial-use-allowed",
    effect: "information",
    message: "The normalized VRM metadata permits this publisher's commercial use.",
  });
}

function applyRedistributionPermission(
  receipt: StudioVrmLicenseMetadataReceipt,
  reasons: StudioVrmLicensePolicyReason[]
): void {
  if (receipt.redistribution === "disallow") {
    reasons.push({
      code: "redistribution-prohibited",
      effect: "restriction",
      message: "The VRM metadata prohibits redistribution of the model file.",
    });
  } else if (receipt.redistribution === "unknown") {
    reasons.push({
      code: "redistribution-unknown",
      effect: "restriction",
      message: "Redistribution permission is unknown, so this action is blocked fail-closed.",
    });
  } else {
    reasons.push({
      code: "redistribution-allowed",
      effect: "information",
      message: "The normalized metadata allows redistribution of the model file.",
    });
  }
}

function applyCreditRequirement(
  receipt: StudioVrmLicenseMetadataReceipt,
  action: StudioVrmLicenseAction,
  context: StudioVrmLicenseActionContext,
  reasons: StudioVrmLicensePolicyReason[]
): void {
  if (!isOutgoingAction(action) || receipt.credit === "unnecessary") return;
  if (receipt.credit === "unknown") {
    if (FAIL_CLOSED_ACTIONS.has(action)) {
      reasons.push({
        code: "fail-closed-unknown-authority",
        effect: "restriction",
        message: "Credit requirements are unknown, so redistribution or sharing is blocked.",
      });
    } else {
      reasons.push({
        code: "credit-unknown",
        effect: "uncertainty",
        message: "The required publication credit could not be determined.",
      });
    }
    return;
  }
  reasons.push({
    code: "credit-required",
    effect: "information",
    message: "This license requires creator and license attribution for the outgoing use.",
  });
  if (context.creditProvided === true) {
    reasons.push({
      code: "credit-confirmed",
      effect: "information",
      message: "The caller confirmed that the outgoing artifact contains the required credit.",
    });
  } else if (context.creditProvided === false) {
    reasons.push({
      code: "credit-missing",
      effect: "restriction",
      message: "Required credit is missing from the outgoing artifact.",
    });
  } else if (FAIL_CLOSED_ACTIONS.has(action)) {
    reasons.push({
      code: "credit-unknown",
      effect: "restriction",
      message: "Credit has not been confirmed, so redistribution or sharing is blocked.",
    });
  } else {
    reasons.push({
      code: "credit-unknown",
      effect: "uncertainty",
      message: "Confirm the required creator and license credit before publication.",
    });
  }
}

function applyShareAlikeRequirement(
  receipt: StudioVrmLicenseMetadataReceipt,
  action: StudioVrmLicenseAction,
  context: StudioVrmLicenseActionContext,
  reasons: StudioVrmLicensePolicyReason[]
): void {
  if (!isRedistributionAction(action) || receipt.shareAlike !== "required") return;
  if (context.shareAlikeSatisfied === true) {
    reasons.push({
      code: "share-alike-confirmed",
      effect: "information",
      message: "The caller confirmed a compatible share-alike license for the redistributed derivative.",
    });
  } else {
    reasons.push({
      code: "share-alike-required",
      effect: "restriction",
      message: "A compatible share-alike license must be confirmed before redistribution.",
    });
  }
}

/**
 * Evaluates one action without claiming that metadata is legal advice or proof of ownership.
 * `unknown` is never an authorization; export, archive redistribution, and marketplace sharing turn
 * unknown authority into an explicit block.
 */
export function evaluateStudioVrmLicenseAction(
  receipt: StudioVrmLicenseMetadataReceipt,
  action: StudioVrmLicenseAction,
  context: StudioVrmLicenseActionContext = {}
): StudioVrmLicenseActionPolicy {
  const reasons: StudioVrmLicensePolicyReason[] = [];
  applyMetadataAuthority(receipt, action, reasons);
  applyAvatarPermission(receipt, action, context, reasons);
  applyContentRestrictions(receipt, action, context, reasons);

  if (action === "local-preview") {
    reasons.push({
      code: "local-processing-only",
      effect: "information",
      message: "Local preview does not itself publish or redistribute the VRM file.",
    });
  } else if (action === "internal-edit") {
    applyModificationPermission(receipt, action, reasons, false);
  } else if (action === "commercial-publish") {
    applyCommercialPermission(receipt, context, reasons);
  } else if (action === "derivative-export") {
    applyModificationPermission(receipt, action, reasons, false);
  } else {
    applyRedistributionPermission(receipt, reasons);
    const containsModifiedModel = context.containsModifiedModel ?? true;
    if (containsModifiedModel) {
      applyModificationPermission(receipt, action, reasons, true);
    }
  }

  applyCreditRequirement(receipt, action, context, reasons);
  applyShareAlikeRequirement(receipt, action, context, reasons);

  const decision = evaluateDecision(reasons);
  return deepFreeze({
    schema: "toonspectrum.vrm-license-action-policy" as const,
    version: 1 as const,
    action,
    decision,
    authorized: decision === "allow",
    reasons: Object.freeze(reasons.map((reason) => Object.freeze(reason))),
  });
}
