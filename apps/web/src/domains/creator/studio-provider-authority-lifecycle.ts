/**
 * Provider authority lifecycle for Studio capability migrations (V16 §5 / V19 §2.7).
 *
 * Generalizes the vNext quality-shadow posture into an explicit authority ladder. Every stage
 * names exactly how much authority a next-generation provider holds over one capability, the
 * transition table admits a single earned step at a time, and every stage change is receipted
 * with a corpus hash, evidence references and a named rollback provider. Anything malformed or
 * unlisted fails closed: unknown stages have no legal transitions and the receipt constructor
 * rejects instead of coercing. No stage below "canary-presentation" may ever present pixels, and
 * only "next-authoritative" may take an authoritative handoff — a faster path can never displace
 * the texture-authoritative path by skipping rungs.
 */

export const STUDIO_PROVIDER_AUTHORITY_LIFECYCLE_VERSION = 1 as const;

const MAX_IDENTIFIER_CHARACTERS = 160;
const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:@/+~-]*$/u;
const MAX_EVIDENCE_REFERENCES = 64;

export type AuthorityStage =
  | "legacy-authoritative"
  | "observed"
  | "quality-shadow"
  | "dual-publish"
  | "canary-presentation"
  | "next-authoritative"
  | "quarantined";

/**
 * The linear promotion ladder. "quarantined" sits outside the ladder: it is the emergency exit
 * from every stage where the next provider performs real work, and leaving it always re-enters
 * at the bottom of the ladder where the next provider owns nothing.
 */
const AUTHORITY_LADDER: readonly Exclude<AuthorityStage, "quarantined">[] = Object.freeze([
  "legacy-authoritative",
  "observed",
  "quality-shadow",
  "dual-publish",
  "canary-presentation",
  "next-authoritative",
]);

export const AUTHORITY_STAGES: readonly AuthorityStage[] = Object.freeze([
  ...AUTHORITY_LADDER,
  "quarantined",
]);

const EMPTY_STAGES: readonly AuthorityStage[] = Object.freeze([]);

/**
 * Legal transitions. Promotion moves exactly one rung up (every step earns its own evidence),
 * retreat moves exactly one rung down, quarantine is reachable from every stage that executes the
 * next provider, and quarantine exits only onto stages where the next provider holds no authority
 * and performs no work.
 */
const LEGAL_TRANSITIONS: Readonly<Record<AuthorityStage, readonly AuthorityStage[]>> =
  Object.freeze({
    "legacy-authoritative": Object.freeze<AuthorityStage[]>(["observed"]),
    observed: Object.freeze<AuthorityStage[]>(["legacy-authoritative", "quality-shadow"]),
    "quality-shadow": Object.freeze<AuthorityStage[]>([
      "observed",
      "dual-publish",
      "quarantined",
    ]),
    "dual-publish": Object.freeze<AuthorityStage[]>([
      "quality-shadow",
      "canary-presentation",
      "quarantined",
    ]),
    "canary-presentation": Object.freeze<AuthorityStage[]>([
      "dual-publish",
      "next-authoritative",
      "quarantined",
    ]),
    "next-authoritative": Object.freeze<AuthorityStage[]>([
      "canary-presentation",
      "quarantined",
    ]),
    quarantined: Object.freeze<AuthorityStage[]>(["legacy-authoritative", "observed"]),
  });

export function isAuthorityStage(value: unknown): value is AuthorityStage {
  return typeof value === "string" && AUTHORITY_STAGES.includes(value as AuthorityStage);
}

/**
 * Pure legal-transition table lookup. Unknown input owns no transitions — fail closed rather than
 * guessing a lane for a stage the lifecycle never defined.
 */
export function nextStagesOf(stage: AuthorityStage): readonly AuthorityStage[] {
  if (!isAuthorityStage(stage)) return EMPTY_STAGES;
  return LEGAL_TRANSITIONS[stage];
}

export function isLegalAuthorityTransition(from: AuthorityStage, to: AuthorityStage): boolean {
  return isAuthorityStage(to) && nextStagesOf(from).includes(to);
}

function ladderRank(stage: AuthorityStage): number | null {
  const rank = AUTHORITY_LADDER.indexOf(stage as Exclude<AuthorityStage, "quarantined">);
  return rank === -1 ? null : rank;
}

export type AuthorityTransitionClass = "promotion" | "retreat" | "quarantine" | "reentry";

/** Classifies a LEGAL transition; returns null for anything the table does not admit. */
export function classifyAuthorityTransition(
  from: AuthorityStage,
  to: AuthorityStage,
): AuthorityTransitionClass | null {
  if (!isLegalAuthorityTransition(from, to)) return null;
  if (to === "quarantined") return "quarantine";
  if (from === "quarantined") return "reentry";
  const fromRank = ladderRank(from);
  const toRank = ladderRank(to);
  if (fromRank === null || toRank === null) return null;
  return toRank > fromRank ? "promotion" : "retreat";
}

export interface AuthorityStagePosture {
  readonly stage: AuthorityStage;
  /** Whether the next-generation provider executes real capability work at this stage. */
  readonly executesNextProvider: boolean;
  /** Whether the next-generation provider may hand pixels to a presentation surface. */
  readonly presentationPayloadAllowed: boolean;
  /** Whether the next-generation provider may become the authoritative renderer. */
  readonly authoritativeHandoffAllowed: boolean;
  /** Whether the product UI renderer is allowed to differ from the legacy renderer. */
  readonly uiRendererChangeAllowed: boolean;
}

const STAGE_POSTURES: Readonly<Record<AuthorityStage, AuthorityStagePosture>> = Object.freeze({
  "legacy-authoritative": Object.freeze({
    stage: "legacy-authoritative",
    executesNextProvider: false,
    presentationPayloadAllowed: false,
    authoritativeHandoffAllowed: false,
    uiRendererChangeAllowed: false,
  }),
  observed: Object.freeze({
    stage: "observed",
    executesNextProvider: false,
    presentationPayloadAllowed: false,
    authoritativeHandoffAllowed: false,
    uiRendererChangeAllowed: false,
  }),
  "quality-shadow": Object.freeze({
    stage: "quality-shadow",
    executesNextProvider: true,
    presentationPayloadAllowed: false,
    authoritativeHandoffAllowed: false,
    uiRendererChangeAllowed: false,
  }),
  "dual-publish": Object.freeze({
    stage: "dual-publish",
    executesNextProvider: true,
    presentationPayloadAllowed: false,
    authoritativeHandoffAllowed: false,
    uiRendererChangeAllowed: false,
  }),
  "canary-presentation": Object.freeze({
    stage: "canary-presentation",
    executesNextProvider: true,
    presentationPayloadAllowed: true,
    authoritativeHandoffAllowed: false,
    uiRendererChangeAllowed: true,
  }),
  "next-authoritative": Object.freeze({
    stage: "next-authoritative",
    executesNextProvider: true,
    presentationPayloadAllowed: true,
    authoritativeHandoffAllowed: true,
    uiRendererChangeAllowed: true,
  }),
  quarantined: Object.freeze({
    stage: "quarantined",
    executesNextProvider: false,
    presentationPayloadAllowed: false,
    authoritativeHandoffAllowed: false,
    uiRendererChangeAllowed: false,
  }),
});

export function authorityStagePosture(stage: AuthorityStage): AuthorityStagePosture | null {
  if (!isAuthorityStage(stage)) return null;
  return STAGE_POSTURES[stage];
}

/**
 * The literal-typed invariant a quality shadow must uphold: the shadow proves parity only, so its
 * receipts can never carry a presentation payload, an authoritative handoff or a UI renderer
 * change.
 */
export interface QualityShadowStagePosture {
  readonly stage: "quality-shadow";
  readonly presentationPayload: null;
  readonly authoritativeHandoff: false;
  readonly uiRendererChanged: false;
}

const QUALITY_SHADOW_STAGE_POSTURE: QualityShadowStagePosture = Object.freeze({
  stage: "quality-shadow",
  presentationPayload: null,
  authoritativeHandoff: false,
  uiRendererChanged: false,
});

/**
 * Derives the shadow invariant from the lifecycle table. Throws — rather than degrading — when the
 * requested stage is not the quality-shadow stage or the lifecycle table stops guaranteeing that
 * the stage executes without presentation, handoff or UI renderer authority. A module deriving its
 * behavior from this call fails loudly at load instead of silently gaining authority.
 */
export function requireQualityShadowStagePosture(stage: AuthorityStage): QualityShadowStagePosture {
  const posture = authorityStagePosture(stage);
  if (
    stage !== "quality-shadow"
    || posture === null
    || !posture.executesNextProvider
    || posture.presentationPayloadAllowed
    || posture.authoritativeHandoffAllowed
    || posture.uiRendererChangeAllowed
  ) {
    throw new Error(
      `studio-provider-authority-lifecycle: stage "${String(stage)}" is not a valid quality-shadow stage`,
    );
  }
  return QUALITY_SHADOW_STAGE_POSTURE;
}

export interface AuthorityPromotionReceipt {
  readonly kind: "studio-provider-authority-promotion-receipt";
  readonly version: typeof STUDIO_PROVIDER_AUTHORITY_LIFECYCLE_VERSION;
  readonly capabilityId: string;
  readonly from: AuthorityStage;
  readonly to: AuthorityStage;
  readonly transition: AuthorityTransitionClass;
  readonly providerId: string;
  /** Hash of the exact evidence corpus (e.g. shadow-parity sweep manifest) backing this change. */
  readonly corpusHash: string;
  readonly qualityEvidenceRefs: readonly string[];
  readonly performanceEvidenceRefs: readonly string[];
  /** Provider that regains authority if this stage change is reverted. */
  readonly rollbackProviderId: string;
}

export interface AuthorityPromotionReceiptInput {
  readonly capabilityId: string;
  readonly from: AuthorityStage;
  readonly to: AuthorityStage;
  readonly providerId: string;
  readonly corpusHash: string;
  readonly qualityEvidenceRefs?: readonly string[];
  readonly performanceEvidenceRefs?: readonly string[];
  readonly rollbackProviderId: string;
}

export type AuthorityPromotionReceiptResult =
  | Readonly<{ status: "created"; receipt: AuthorityPromotionReceipt }>
  | Readonly<{
      status: "rejected";
      reason:
        | "invalid-input"
        | "unknown-stage"
        | "illegal-transition"
        | "invalid-capability-id"
        | "invalid-provider-id"
        | "invalid-rollback-provider-id"
        | "invalid-corpus-hash"
        | "invalid-evidence-refs"
        | "missing-quality-evidence"
        | "missing-performance-evidence";
      detail?: string;
    }>;

/** Promotions landing on this rung or above require quality evidence. */
const QUALITY_EVIDENCE_REQUIRED_FROM_RANK = AUTHORITY_LADDER.indexOf("dual-publish");
/** Promotions landing on this rung or above additionally require performance evidence. */
const PERFORMANCE_EVIDENCE_REQUIRED_FROM_RANK = AUTHORITY_LADDER.indexOf("canary-presentation");

function identifier(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= MAX_IDENTIFIER_CHARACTERS
    && SAFE_IDENTIFIER.test(value);
}

const EMPTY_REFS: readonly string[] = Object.freeze([]);

function evidenceRefs(value: unknown): readonly string[] | null {
  if (value === undefined) return EMPTY_REFS;
  if (!Array.isArray(value) || value.length > MAX_EVIDENCE_REFERENCES) return null;
  const seen = new Set<string>();
  for (const ref of value) {
    if (!identifier(ref) || seen.has(ref)) return null;
    seen.add(ref);
  }
  return Object.freeze([...value] as string[]);
}

function rejected(
  reason: Extract<AuthorityPromotionReceiptResult, { readonly status: "rejected" }>["reason"],
  detail?: string,
): AuthorityPromotionReceiptResult {
  return Object.freeze({
    status: "rejected",
    reason,
    ...(detail ? { detail } : {}),
  });
}

/**
 * Validated receipt constructor. Fails closed on illegal transitions, malformed identities and
 * missing evidence: promotions into "dual-publish" or above demand at least one quality evidence
 * reference, and promotions into a presentation-granting stage additionally demand performance
 * evidence — quality evidence can never be substituted by a performance argument.
 */
export function createAuthorityPromotionReceipt(
  input: AuthorityPromotionReceiptInput,
): AuthorityPromotionReceiptResult {
  if (typeof input !== "object" || input === null) return rejected("invalid-input");
  if (!isAuthorityStage(input.from) || !isAuthorityStage(input.to)) {
    return rejected("unknown-stage");
  }
  if (!isLegalAuthorityTransition(input.from, input.to)) {
    return rejected("illegal-transition", `${input.from}->${input.to}`);
  }
  const transition = classifyAuthorityTransition(input.from, input.to);
  if (transition === null) return rejected("illegal-transition", `${input.from}->${input.to}`);
  if (!identifier(input.capabilityId)) return rejected("invalid-capability-id");
  if (!identifier(input.providerId)) return rejected("invalid-provider-id");
  if (!identifier(input.rollbackProviderId)) return rejected("invalid-rollback-provider-id");
  if (!identifier(input.corpusHash)) return rejected("invalid-corpus-hash");
  const qualityEvidence = evidenceRefs(input.qualityEvidenceRefs);
  const performanceEvidence = evidenceRefs(input.performanceEvidenceRefs);
  if (!qualityEvidence || !performanceEvidence) return rejected("invalid-evidence-refs");
  if (transition === "promotion") {
    const toRank = ladderRank(input.to);
    if (toRank === null) return rejected("illegal-transition", `${input.from}->${input.to}`);
    if (toRank >= QUALITY_EVIDENCE_REQUIRED_FROM_RANK && qualityEvidence.length === 0) {
      return rejected("missing-quality-evidence", input.to);
    }
    if (toRank >= PERFORMANCE_EVIDENCE_REQUIRED_FROM_RANK && performanceEvidence.length === 0) {
      return rejected("missing-performance-evidence", input.to);
    }
  }
  return Object.freeze({
    status: "created",
    receipt: Object.freeze({
      kind: "studio-provider-authority-promotion-receipt",
      version: STUDIO_PROVIDER_AUTHORITY_LIFECYCLE_VERSION,
      capabilityId: input.capabilityId,
      from: input.from,
      to: input.to,
      transition,
      providerId: input.providerId,
      corpusHash: input.corpusHash,
      qualityEvidenceRefs: qualityEvidence,
      performanceEvidenceRefs: performanceEvidence,
      rollbackProviderId: input.rollbackProviderId,
    }),
  });
}
