/**
 * ToonSpectrum Storyworld Causality Lab
 *
 * A deterministic, provider-neutral narrative digital twin. It does not generate prose or images;
 * it makes the assumptions behind a long-form story explicit, simulates them in scene order, and
 * returns bounded diagnostics/proposals that a Studio command adapter can commit atomically.
 */

export const STUDIO_STORYWORLD_SCHEMA_VERSION = 1 as const;
export const STUDIO_STORYWORLD_RECEIPT_VERSION = 1 as const;

export type StoryworldPrimitive = string | number | boolean | null;
export type StoryworldSeverity = "info" | "warning" | "error";
export type StoryworldAxisId =
  | "canon"
  | "character-knowledge"
  | "setup-payoff"
  | "spoiler-safety"
  | "emotional-continuity"
  | "production"
  | "localization"
  | "accessibility"
  | "rights-provenance";

export type StoryworldFactComparator =
  | "exists"
  | "not-exists"
  | "equals"
  | "not-equals"
  | "greater-than"
  | "less-than";

export interface StoryworldFactPredicate {
  readonly factId: string;
  readonly comparator?: StoryworldFactComparator;
  readonly value?: StoryworldPrimitive;
}

export interface StoryworldFactDefinition {
  readonly id: string;
  readonly label: string;
  readonly subjectId: string;
  readonly key: string;
  readonly initialValue?: StoryworldPrimitive;
  /** Reader-facing reveal target. Omit when no fixed reveal order exists. */
  readonly intendedReaderRevealOrder?: number;
  /** Canon facts are included in proof receipts even when no scene reads them. */
  readonly canonical?: boolean;
  readonly tags?: readonly string[];
}

export interface StoryworldFactMutation {
  readonly factId: string;
  readonly op: "set" | "delete" | "increment" | "decrement";
  readonly value?: StoryworldPrimitive;
}

export interface StoryworldKnowledgeUse {
  readonly characterId: string;
  readonly factId: string;
  readonly purpose?: string;
}

export interface StoryworldReveal {
  readonly factId: string;
  /** `reader` affects spoiler checks; character ids affect the belief matrix. */
  readonly audiences: readonly ("reader" | string)[];
  readonly certainty?: number;
}

export interface StoryworldEmotionalBeat {
  readonly characterId: string;
  /** -1 (very negative) .. 1 (very positive). */
  readonly valence: number;
  /** 0 (calm) .. 1 (high activation). */
  readonly arousal: number;
  /** Explicit transitions permit a large jump without producing a continuity warning. */
  readonly transitionJustified?: boolean;
  readonly note?: string;
}

export interface StoryworldLocalizationProbe {
  readonly locale: string;
  readonly sourceCharacters: number;
  readonly translatedCharacters: number;
  readonly balloonCapacityCharacters: number;
  readonly allowsReflow?: boolean;
}

export interface StoryworldAccessibilityEvidence {
  readonly logicalReadingOrder?: boolean;
  readonly nonColorCue?: boolean;
  readonly textAlternative?: boolean;
  readonly soundMeaningVisualized?: boolean;
  readonly reducedMotionEquivalent?: boolean;
}

export type StoryworldLicenseStatus =
  | "cleared"
  | "restricted"
  | "unknown"
  | "expired";
export type StoryworldConsentStatus =
  | "not-required"
  | "recorded"
  | "missing"
  | "revoked";

export interface StoryworldAssetUse {
  readonly assetId: string;
  readonly label: string;
  readonly revision?: string;
  readonly licenseStatus: StoryworldLicenseStatus;
  readonly consentStatus?: StoryworldConsentStatus;
  readonly provenanceHash?: string;
  readonly generated?: boolean;
  readonly reusable?: boolean;
}

export interface StoryworldProductionEstimate {
  readonly drawingMinutes?: number;
  readonly letteringMinutes?: number;
  readonly renderMinutes?: number;
  readonly reviewMinutes?: number;
  readonly uniqueAssetCount?: number;
  readonly complexity?: number;
  readonly assigneeIds?: readonly string[];
}

export interface StoryworldScene {
  readonly id: string;
  readonly title: string;
  /** Stable narrative order. Ties are resolved by id for deterministic analysis. */
  readonly order: number;
  readonly timeIndex?: number;
  readonly locationId?: string;
  readonly participantIds?: readonly string[];
  readonly dependsOnSceneIds?: readonly string[];
  readonly preconditions?: readonly StoryworldFactPredicate[];
  readonly effects?: readonly StoryworldFactMutation[];
  readonly knowledgeUses?: readonly StoryworldKnowledgeUse[];
  readonly reveals?: readonly StoryworldReveal[];
  readonly setupIds?: readonly string[];
  readonly payoffIds?: readonly string[];
  readonly motifIds?: readonly string[];
  readonly emotionalBeats?: readonly StoryworldEmotionalBeat[];
  readonly localization?: readonly StoryworldLocalizationProbe[];
  readonly accessibility?: StoryworldAccessibilityEvidence;
  readonly assets?: readonly StoryworldAssetUse[];
  readonly production?: StoryworldProductionEstimate;
  readonly disabled?: boolean;
}

export interface StoryworldCharacter {
  readonly id: string;
  readonly name: string;
  /** Facts known before scene one. */
  readonly initialFactIds?: readonly string[];
  readonly goal?: string;
  readonly secretFactIds?: readonly string[];
}

export interface StoryworldSetupContract {
  readonly id: string;
  readonly label: string;
  /** Warn once the story passes this order without a payoff. */
  readonly payoffDueByOrder?: number;
  readonly requiredPayoffCount?: number;
}

export interface StoryworldMotifDefinition {
  readonly id: string;
  readonly label: string;
  readonly minOccurrences?: number;
  readonly maxGapScenes?: number;
}

export interface StoryworldProject {
  readonly schemaVersion: typeof STUDIO_STORYWORLD_SCHEMA_VERSION;
  readonly id: string;
  readonly title: string;
  readonly characters: readonly StoryworldCharacter[];
  readonly facts: readonly StoryworldFactDefinition[];
  readonly scenes: readonly StoryworldScene[];
  readonly setupContracts?: readonly StoryworldSetupContract[];
  readonly motifs?: readonly StoryworldMotifDefinition[];
  readonly productionCapacityMinutes?: number;
  readonly metadata?: Readonly<Record<string, StoryworldPrimitive>>;
}

export interface StoryworldIssue {
  readonly id: string;
  readonly axis: StoryworldAxisId;
  readonly severity: StoryworldSeverity;
  readonly code:
    | "duplicate-id"
    | "dangling-reference"
    | "dependency-cycle"
    | "dependency-order"
    | "inactive-dependency"
    | "missing-precondition"
    | "contradicted-precondition"
    | "invalid-mutation"
    | "knowledge-leak"
    | "premature-reader-reveal"
    | "reader-reveal-missed"
    | "orphan-payoff"
    | "unpaid-setup"
    | "motif-underused"
    | "motif-gap"
    | "time-regression"
    | "impossible-travel"
    | "emotional-whiplash"
    | "localization-overflow"
    | "accessibility-gap"
    | "rights-risk"
    | "missing-provenance"
    | "production-over-capacity"
    | "production-bottleneck";
  readonly message: string;
  readonly sceneId?: string;
  readonly characterId?: string;
  readonly factId?: string;
  readonly setupId?: string;
  readonly motifId?: string;
  readonly assetId?: string;
  readonly evidence?: Readonly<Record<string, StoryworldPrimitive>>;
}

export interface StoryworldAxisScore {
  readonly axis: StoryworldAxisId;
  readonly score: number;
  readonly errorCount: number;
  readonly warningCount: number;
  readonly infoCount: number;
}

export interface StoryworldWorldFrame {
  readonly sceneId: string;
  readonly order: number;
  readonly facts: Readonly<Record<string, StoryworldPrimitive>>;
  readonly readerFactIds: readonly string[];
}

export interface StoryworldKnowledgeRow {
  readonly characterId: string;
  readonly characterName: string;
  readonly knownFactIds: readonly string[];
  readonly secretFactIds: readonly string[];
}

export interface StoryworldSetupLedgerRow {
  readonly setupId: string;
  readonly label: string;
  readonly setupSceneIds: readonly string[];
  readonly payoffSceneIds: readonly string[];
  readonly dueByOrder?: number;
  readonly status: "unintroduced" | "open" | "paid" | "overdue" | "overpaid";
}

export interface StoryworldMotifLedgerRow {
  readonly motifId: string;
  readonly label: string;
  readonly sceneIds: readonly string[];
  readonly occurrenceCount: number;
  readonly largestGapScenes: number;
}

export interface StoryworldProductionSummary {
  readonly totalMinutes: number;
  readonly drawingMinutes: number;
  readonly letteringMinutes: number;
  readonly renderMinutes: number;
  readonly reviewMinutes: number;
  readonly capacityMinutes: number | null;
  readonly utilizationPercent: number | null;
  readonly criticalSceneIds: readonly string[];
  readonly reusableAssetCount: number;
  readonly uniqueAssetCount: number;
}

export interface StoryworldRepairProposal {
  readonly id: string;
  readonly issueId: string;
  readonly title: string;
  readonly rationale: string;
  readonly risk: "low" | "medium" | "high";
  /** Provider-neutral, reviewable mutation intent. Never applied automatically. */
  readonly intent:
    | { readonly kind: "add-reveal"; readonly sceneId: string; readonly characterId: string; readonly factId: string }
    | { readonly kind: "move-reveal"; readonly factId: string; readonly targetOrder: number }
    | { readonly kind: "add-payoff"; readonly setupId: string; readonly targetOrder: number }
    | { readonly kind: "add-transition"; readonly sceneId: string; readonly characterId: string }
    | { readonly kind: "resize-balloon"; readonly sceneId: string; readonly locale: string }
    | { readonly kind: "add-accessibility-evidence"; readonly sceneId: string }
    | { readonly kind: "replace-asset"; readonly sceneId: string; readonly assetId: string }
    | { readonly kind: "split-production"; readonly sceneId: string }
    | { readonly kind: "review-manually"; readonly sceneId?: string };
}

export interface StoryworldProofReceipt {
  readonly version: typeof STUDIO_STORYWORLD_RECEIPT_VERSION;
  readonly projectId: string;
  readonly projectFingerprint: string;
  readonly generatedAtIso: string;
  readonly deterministic: true;
  readonly sceneCount: number;
  readonly factCount: number;
  readonly issueFingerprint: string;
  readonly axisScores: readonly StoryworldAxisScore[];
  readonly inputSummary: Readonly<Record<string, number>>;
}

export interface StoryworldAnalysisResult {
  readonly projectId: string;
  readonly orderedSceneIds: readonly string[];
  readonly issues: readonly StoryworldIssue[];
  readonly axisScores: readonly StoryworldAxisScore[];
  readonly overallScore: number;
  readonly worldTimeline: readonly StoryworldWorldFrame[];
  readonly knowledgeMatrix: readonly StoryworldKnowledgeRow[];
  readonly setupLedger: readonly StoryworldSetupLedgerRow[];
  readonly motifLedger: readonly StoryworldMotifLedgerRow[];
  readonly production: StoryworldProductionSummary;
  readonly repairProposals: readonly StoryworldRepairProposal[];
  readonly receipt: StoryworldProofReceipt;
}

export type StoryworldBranchMutation =
  | { readonly kind: "disable-scene"; readonly sceneId: string }
  | { readonly kind: "enable-scene"; readonly sceneId: string }
  | { readonly kind: "set-fact"; readonly factId: string; readonly value: StoryworldPrimitive }
  | { readonly kind: "remove-reveal"; readonly sceneId: string; readonly factId: string; readonly audience: "reader" | string }
  | { readonly kind: "move-scene"; readonly sceneId: string; readonly order: number };

export interface StoryworldCounterfactualResult {
  readonly mutation: StoryworldBranchMutation;
  readonly baseline: StoryworldAnalysisResult;
  readonly branch: StoryworldAnalysisResult;
  readonly scoreDelta: number;
  readonly addedIssueIds: readonly string[];
  readonly resolvedIssueIds: readonly string[];
  readonly impactedSceneIds: readonly string[];
}

export interface StoryworldBranchCandidate {
  readonly id: string;
  readonly label: string;
  readonly result: StoryworldAnalysisResult;
}

export interface StoryworldParetoCandidate {
  readonly id: string;
  readonly label: string;
  readonly dominatedByIds: readonly string[];
  readonly dominatesIds: readonly string[];
  readonly frontier: boolean;
  readonly overallScore: number;
}

interface MutableSimulationState {
  readonly factsById: Map<string, StoryworldFactDefinition>;
  readonly worldValues: Map<string, StoryworldPrimitive>;
  readonly readerKnownFacts: Set<string>;
  readonly characterKnownFacts: Map<string, Set<string>>;
  readonly setupScenes: Map<string, string[]>;
  readonly payoffScenes: Map<string, string[]>;
  readonly motifScenes: Map<string, string[]>;
  readonly lastEmotionByCharacter: Map<string, StoryworldEmotionalBeat>;
  readonly timeline: StoryworldWorldFrame[];
  readonly issues: StoryworldIssue[];
}

const AXIS_ORDER: readonly StoryworldAxisId[] = [
  "canon",
  "character-knowledge",
  "setup-payoff",
  "spoiler-safety",
  "emotional-continuity",
  "production",
  "localization",
  "accessibility",
  "rights-provenance",
];

const ERROR_PENALTY = 22;
const WARNING_PENALTY = 9;
const INFO_PENALTY = 2;
const MAX_EMOTION_DISTANCE_WITHOUT_TRANSITION = 0.95;
const MAX_SCENE_COMPLEXITY = 8;
const DEFAULT_SETUP_PAYOFF_COUNT = 1;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function finiteOr(value: number | undefined, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function compareScene(a: StoryworldScene, b: StoryworldScene): number {
  return a.order - b.order || a.id.localeCompare(b.id);
}

function compareIssue(a: StoryworldIssue, b: StoryworldIssue): number {
  const severityRank: Record<StoryworldSeverity, number> = { error: 0, warning: 1, info: 2 };
  return severityRank[a.severity] - severityRank[b.severity]
    || (a.sceneId ?? "").localeCompare(b.sceneId ?? "")
    || a.axis.localeCompare(b.axis)
    || a.code.localeCompare(b.code)
    || a.id.localeCompare(b.id);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const objectValue = value as Record<string, unknown>;
  return `{${Object.keys(objectValue)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(objectValue[key])}`)
    .join(",")}}`;
}

/** Small deterministic FNV-1a receipt hash; this is an integrity fingerprint, not a signature. */
export function fingerprintStoryworldValue(value: unknown): string {
  const text = canonicalJson(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function issueId(
  code: StoryworldIssue["code"],
  parts: readonly (string | number | undefined)[],
): string {
  return `${code}:${parts.filter((part) => part !== undefined).join(":")}`;
}

function pushIssue(
  state: MutableSimulationState,
  issue: Omit<StoryworldIssue, "id"> & { readonly id?: string },
): void {
  state.issues.push({
    ...issue,
    id: issue.id ?? issueId(issue.code, [
      issue.sceneId,
      issue.characterId,
      issue.factId,
      issue.setupId,
      issue.motifId,
      issue.assetId,
      fingerprintStoryworldValue(issue.evidence ?? issue.message),
    ]),
  });
}

function predicateMatches(
  predicate: StoryworldFactPredicate,
  worldValues: ReadonlyMap<string, StoryworldPrimitive>,
): boolean {
  const exists = worldValues.has(predicate.factId);
  const actual = worldValues.get(predicate.factId);
  const comparator = predicate.comparator ?? "equals";
  switch (comparator) {
    case "exists":
      return exists;
    case "not-exists":
      return !exists;
    case "equals":
      return exists && Object.is(actual, predicate.value);
    case "not-equals":
      return !exists || !Object.is(actual, predicate.value);
    case "greater-than":
      return typeof actual === "number"
        && typeof predicate.value === "number"
        && actual > predicate.value;
    case "less-than":
      return typeof actual === "number"
        && typeof predicate.value === "number"
        && actual < predicate.value;
  }
}

function isMissingPredicate(
  predicate: StoryworldFactPredicate,
  worldValues: ReadonlyMap<string, StoryworldPrimitive>,
): boolean {
  const comparator = predicate.comparator ?? "equals";
  return !worldValues.has(predicate.factId)
    && comparator !== "not-exists"
    && comparator !== "not-equals";
}

function applyMutation(
  scene: StoryworldScene,
  mutation: StoryworldFactMutation,
  state: MutableSimulationState,
): void {
  if (!state.factsById.has(mutation.factId)) {
    pushIssue(state, {
      axis: "canon",
      severity: "error",
      code: "dangling-reference",
      message: `장면 ‘${scene.title}’의 효과가 정의되지 않은 사실 ${mutation.factId}을(를) 가리킵니다.`,
      sceneId: scene.id,
      factId: mutation.factId,
    });
    return;
  }
  if (mutation.op === "delete") {
    state.worldValues.delete(mutation.factId);
    return;
  }
  if (mutation.op === "set") {
    state.worldValues.set(mutation.factId, mutation.value ?? null);
    return;
  }
  const previous = state.worldValues.get(mutation.factId);
  const delta = mutation.value === undefined ? 1 : mutation.value;
  if (typeof previous !== "number" || typeof delta !== "number") {
    pushIssue(state, {
      axis: "canon",
      severity: "error",
      code: "invalid-mutation",
      message: `장면 ‘${scene.title}’에서 숫자가 아닌 사실 ${mutation.factId}에 증감 연산을 시도했습니다.`,
      sceneId: scene.id,
      factId: mutation.factId,
    });
    return;
  }
  state.worldValues.set(
    mutation.factId,
    mutation.op === "increment" ? previous + delta : previous - delta,
  );
}

function detectDuplicateIds(project: StoryworldProject, state: MutableSimulationState): void {
  const families: readonly [string, readonly { readonly id: string }[]][] = [
    ["character", project.characters],
    ["fact", project.facts],
    ["scene", project.scenes],
    ["setup", project.setupContracts ?? []],
    ["motif", project.motifs ?? []],
  ];
  for (const [family, values] of families) {
    const seen = new Set<string>();
    for (const value of values) {
      if (!seen.has(value.id)) {
        seen.add(value.id);
        continue;
      }
      pushIssue(state, {
        axis: "canon",
        severity: "error",
        code: "duplicate-id",
        message: `${family} id ‘${value.id}’가 중복됩니다.`,
        evidence: { family, duplicateId: value.id },
      });
    }
  }
}

function detectDependencyCycles(
  scenes: readonly StoryworldScene[],
  state: MutableSimulationState,
): void {
  const scenesById = new Map(scenes.map((scene) => [scene.id, scene]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];
  const reported = new Set<string>();

  const visit = (sceneId: string): void => {
    if (visited.has(sceneId)) return;
    if (visiting.has(sceneId)) {
      const start = stack.indexOf(sceneId);
      const cycle = [...stack.slice(Math.max(0, start)), sceneId];
      const key = [...new Set(cycle)].sort().join("|");
      if (!reported.has(key)) {
        reported.add(key);
        pushIssue(state, {
          axis: "canon",
          severity: "error",
          code: "dependency-cycle",
          message: `장면 의존성이 순환합니다: ${cycle.join(" → ")}`,
          sceneId,
          evidence: { cycle: cycle.join(" -> ") },
        });
      }
      return;
    }
    const scene = scenesById.get(sceneId);
    if (!scene) return;
    visiting.add(sceneId);
    stack.push(sceneId);
    for (const dependencyId of scene.dependsOnSceneIds ?? []) {
      if (!scenesById.has(dependencyId)) {
        pushIssue(state, {
          axis: "canon",
          severity: "error",
          code: "dangling-reference",
          message: `장면 ‘${scene.title}’이 존재하지 않는 선행 장면 ${dependencyId}을(를) 요구합니다.`,
          sceneId: scene.id,
          evidence: { dependencyId },
        });
      } else {
        const dependency = scenesById.get(dependencyId)!;
        if (!scene.disabled && dependency.disabled) {
          pushIssue(state, {
            axis: "canon",
            severity: "error",
            code: "inactive-dependency",
            message: `활성 장면 ‘${scene.title}’이 비활성 선행 장면 ‘${dependency.title}’에 의존합니다.`,
            sceneId: scene.id,
            evidence: { dependencyId },
          });
        } else if (
          !scene.disabled
          && !dependency.disabled
          && (dependency.order > scene.order
            || (dependency.order === scene.order && dependency.id.localeCompare(scene.id) >= 0))
        ) {
          pushIssue(state, {
            axis: "canon",
            severity: "error",
            code: "dependency-order",
            message: `장면 ‘${scene.title}’의 선행 장면 ‘${dependency.title}’이 현재 장면보다 뒤에 배치되어 있습니다.`,
            sceneId: scene.id,
            evidence: {
              dependencyId,
              dependencyOrder: dependency.order,
              sceneOrder: scene.order,
            },
          });
        }
        visit(dependencyId);
      }
    }
    stack.pop();
    visiting.delete(sceneId);
    visited.add(sceneId);
  };

  for (const scene of scenes) visit(scene.id);
}

function validateProjectReferences(
  project: StoryworldProject,
  state: MutableSimulationState,
): void {
  const characterIds = new Set(project.characters.map((character) => character.id));
  const factIds = new Set(project.facts.map((fact) => fact.id));

  for (const character of project.characters) {
    for (const factId of [...(character.initialFactIds ?? []), ...(character.secretFactIds ?? [])]) {
      if (factIds.has(factId)) continue;
      pushIssue(state, {
        axis: "character-knowledge",
        severity: "error",
        code: "dangling-reference",
        message: `인물 ‘${character.name}’이 정의되지 않은 사실 ${factId}을(를) 참조합니다.`,
        characterId: character.id,
        factId,
      });
    }
  }

  for (const scene of project.scenes) {
    for (const characterId of scene.participantIds ?? []) {
      if (characterIds.has(characterId)) continue;
      pushIssue(state, {
        axis: "canon",
        severity: "error",
        code: "dangling-reference",
        message: `장면 ‘${scene.title}’의 참여 인물 ${characterId}이(가) 존재하지 않습니다.`,
        sceneId: scene.id,
        characterId,
      });
    }
    for (const assigneeId of scene.production?.assigneeIds ?? []) {
      if (characterIds.has(assigneeId)) continue;
      pushIssue(state, {
        axis: "production",
        severity: "warning",
        code: "dangling-reference",
        message: `장면 ‘${scene.title}’의 담당자 ${assigneeId}이(가) 프로젝트 인물/역할 목록에 없습니다.`,
        sceneId: scene.id,
        characterId: assigneeId,
      });
    }
  }
}

function analyzeSceneContinuity(
  scene: StoryworldScene,
  previousScene: StoryworldScene | undefined,
  state: MutableSimulationState,
): void {
  if (
    previousScene?.timeIndex !== undefined
    && scene.timeIndex !== undefined
    && scene.timeIndex < previousScene.timeIndex
  ) {
    pushIssue(state, {
      axis: "canon",
      severity: "warning",
      code: "time-regression",
      message: `‘${scene.title}’의 시간 인덱스가 직전 장면보다 뒤로 이동합니다. 회상 표식이 필요합니다.`,
      sceneId: scene.id,
      evidence: {
        previousTimeIndex: previousScene.timeIndex,
        currentTimeIndex: scene.timeIndex,
      },
    });
  }

  if (
    previousScene?.locationId
    && scene.locationId
    && previousScene.locationId !== scene.locationId
    && previousScene.timeIndex !== undefined
    && scene.timeIndex !== undefined
    && scene.timeIndex === previousScene.timeIndex
    && (previousScene.participantIds ?? []).some((id) => (scene.participantIds ?? []).includes(id))
  ) {
    const shared = (previousScene.participantIds ?? []).filter((id) =>
      (scene.participantIds ?? []).includes(id),
    );
    pushIssue(state, {
      axis: "canon",
      severity: "warning",
      code: "impossible-travel",
      message: `같은 시간에 ${shared.join(", ")}이(가) ${previousScene.locationId}에서 ${scene.locationId}(으)로 이동합니다.`,
      sceneId: scene.id,
      evidence: {
        from: previousScene.locationId,
        to: scene.locationId,
        sharedCharacters: shared.join(","),
      },
    });
  }

  for (const predicate of scene.preconditions ?? []) {
    if (!state.factsById.has(predicate.factId)) {
      pushIssue(state, {
        axis: "canon",
        severity: "error",
        code: "dangling-reference",
        message: `장면 ‘${scene.title}’이 정의되지 않은 사실 ${predicate.factId}을(를) 전제로 사용합니다.`,
        sceneId: scene.id,
        factId: predicate.factId,
      });
      continue;
    }
    if (predicateMatches(predicate, state.worldValues)) continue;
    const missing = isMissingPredicate(predicate, state.worldValues);
    pushIssue(state, {
      axis: "canon",
      severity: missing ? "error" : "warning",
      code: missing ? "missing-precondition" : "contradicted-precondition",
      message: missing
        ? `‘${scene.title}’에 필요한 사실 ${predicate.factId}이 아직 성립하지 않았습니다.`
        : `‘${scene.title}’의 전제 ${predicate.factId}이 현재 세계 상태와 모순됩니다.`,
      sceneId: scene.id,
      factId: predicate.factId,
      evidence: {
        comparator: predicate.comparator ?? "equals",
        expected: predicate.value ?? null,
        actual: state.worldValues.get(predicate.factId) ?? null,
      },
    });
  }
}

function analyzeKnowledge(scene: StoryworldScene, state: MutableSimulationState): void {
  for (const use of scene.knowledgeUses ?? []) {
    const knownFacts = state.characterKnownFacts.get(use.characterId);
    if (!knownFacts) {
      pushIssue(state, {
        axis: "character-knowledge",
        severity: "error",
        code: "dangling-reference",
        message: `장면 ‘${scene.title}’이 존재하지 않는 인물 ${use.characterId}의 지식을 사용합니다.`,
        sceneId: scene.id,
        characterId: use.characterId,
        factId: use.factId,
      });
      continue;
    }
    if (!state.factsById.has(use.factId)) {
      pushIssue(state, {
        axis: "character-knowledge",
        severity: "error",
        code: "dangling-reference",
        message: `장면 ‘${scene.title}’이 정의되지 않은 사실 ${use.factId}을(를) 지식으로 사용합니다.`,
        sceneId: scene.id,
        characterId: use.characterId,
        factId: use.factId,
      });
      continue;
    }
    if (knownFacts.has(use.factId)) continue;
    pushIssue(state, {
      axis: "character-knowledge",
      severity: "error",
      code: "knowledge-leak",
      message: `‘${scene.title}’에서 ${use.characterId}이(가) 아직 알 수 없는 사실 ${use.factId}을(를) 사용합니다.`,
      sceneId: scene.id,
      characterId: use.characterId,
      factId: use.factId,
      evidence: { purpose: use.purpose ?? "unspecified" },
    });
  }

  for (const reveal of scene.reveals ?? []) {
    const fact = state.factsById.get(reveal.factId);
    if (!fact) {
      pushIssue(state, {
        axis: "canon",
        severity: "error",
        code: "dangling-reference",
        message: `장면 ‘${scene.title}’의 공개가 정의되지 않은 사실 ${reveal.factId}을(를) 가리킵니다.`,
        sceneId: scene.id,
        factId: reveal.factId,
      });
      continue;
    }
    for (const audience of reveal.audiences) {
      if (audience === "reader") {
        if (
          fact.intendedReaderRevealOrder !== undefined
          && scene.order < fact.intendedReaderRevealOrder
        ) {
          pushIssue(state, {
            axis: "spoiler-safety",
            severity: "warning",
            code: "premature-reader-reveal",
            message: `사실 ${fact.label}이(가) 계획보다 일찍 독자에게 노출됩니다.`,
            sceneId: scene.id,
            factId: fact.id,
            evidence: {
              currentOrder: scene.order,
              intendedOrder: fact.intendedReaderRevealOrder,
            },
          });
        }
        state.readerKnownFacts.add(fact.id);
        continue;
      }
      const knownFacts = state.characterKnownFacts.get(audience);
      if (!knownFacts) {
        pushIssue(state, {
          axis: "character-knowledge",
          severity: "error",
          code: "dangling-reference",
          message: `장면 ‘${scene.title}’의 공개 대상 인물 ${audience}이(가) 존재하지 않습니다.`,
          sceneId: scene.id,
          characterId: audience,
          factId: fact.id,
        });
      } else {
        knownFacts.add(fact.id);
      }
    }
  }
}

function analyzeEmotion(scene: StoryworldScene, state: MutableSimulationState): void {
  for (const beat of scene.emotionalBeats ?? []) {
    if (!state.characterKnownFacts.has(beat.characterId)) {
      pushIssue(state, {
        axis: "emotional-continuity",
        severity: "error",
        code: "dangling-reference",
        message: `장면 ‘${scene.title}’의 감정 비트가 존재하지 않는 인물 ${beat.characterId}을(를) 가리킵니다.`,
        sceneId: scene.id,
        characterId: beat.characterId,
      });
      continue;
    }
    const previous = state.lastEmotionByCharacter.get(beat.characterId);
    if (previous && !beat.transitionJustified) {
      const valenceDistance = Math.abs(clamp(beat.valence, -1, 1) - clamp(previous.valence, -1, 1));
      const arousalDistance = Math.abs(clamp(beat.arousal, 0, 1) - clamp(previous.arousal, 0, 1));
      const distance = Math.hypot(valenceDistance, arousalDistance);
      if (distance > MAX_EMOTION_DISTANCE_WITHOUT_TRANSITION) {
        pushIssue(state, {
          axis: "emotional-continuity",
          severity: "warning",
          code: "emotional-whiplash",
          message: `‘${scene.title}’에서 ${beat.characterId}의 감정이 연결 비트 없이 크게 점프합니다.`,
          sceneId: scene.id,
          characterId: beat.characterId,
          evidence: { distance: Number(distance.toFixed(3)) },
        });
      }
    }
    state.lastEmotionByCharacter.set(beat.characterId, beat);
  }
}

function analyzeLocalization(scene: StoryworldScene, state: MutableSimulationState): void {
  for (const probe of scene.localization ?? []) {
    const capacity = Math.max(0, finiteOr(probe.balloonCapacityCharacters));
    const translated = Math.max(0, finiteOr(probe.translatedCharacters));
    if (translated <= capacity || probe.allowsReflow) continue;
    const overflow = translated - capacity;
    pushIssue(state, {
      axis: "localization",
      severity: overflow / Math.max(1, capacity) > 0.35 ? "error" : "warning",
      code: "localization-overflow",
      message: `‘${scene.title}’의 ${probe.locale} 번역이 말풍선 용량을 ${overflow}자 초과합니다.`,
      sceneId: scene.id,
      evidence: {
        locale: probe.locale,
        translatedCharacters: translated,
        capacityCharacters: capacity,
        expansionRatio: Number((translated / Math.max(1, probe.sourceCharacters)).toFixed(3)),
      },
    });
  }
}

function analyzeAccessibility(scene: StoryworldScene, state: MutableSimulationState): void {
  const evidence = scene.accessibility;
  if (!evidence) {
    pushIssue(state, {
      axis: "accessibility",
      severity: "info",
      code: "accessibility-gap",
      message: `‘${scene.title}’에 접근성 근거가 기록되지 않았습니다.`,
      sceneId: scene.id,
      evidence: { missing: "all" },
    });
    return;
  }
  const missing = [
    ["logicalReadingOrder", evidence.logicalReadingOrder],
    ["nonColorCue", evidence.nonColorCue],
    ["textAlternative", evidence.textAlternative],
    ["soundMeaningVisualized", evidence.soundMeaningVisualized],
    ["reducedMotionEquivalent", evidence.reducedMotionEquivalent],
  ].filter(([, value]) => value !== true).map(([key]) => key);
  if (missing.length === 0) return;
  pushIssue(state, {
    axis: "accessibility",
    severity: missing.length >= 3 ? "warning" : "info",
    code: "accessibility-gap",
    message: `‘${scene.title}’의 접근성 증거가 ${missing.length}개 부족합니다.`,
    sceneId: scene.id,
    evidence: { missing: missing.join(",") },
  });
}

function analyzeAssets(scene: StoryworldScene, state: MutableSimulationState): void {
  for (const asset of scene.assets ?? []) {
    if (asset.licenseStatus !== "cleared") {
      pushIssue(state, {
        axis: "rights-provenance",
        severity: asset.licenseStatus === "unknown" ? "warning" : "error",
        code: "rights-risk",
        message: `‘${scene.title}’의 자산 ‘${asset.label}’ 사용 권리가 ${asset.licenseStatus} 상태입니다.`,
        sceneId: scene.id,
        assetId: asset.assetId,
        evidence: {
          licenseStatus: asset.licenseStatus,
          consentStatus: asset.consentStatus ?? "not-required",
        },
      });
    }
    if (asset.consentStatus === "missing" || asset.consentStatus === "revoked") {
      pushIssue(state, {
        axis: "rights-provenance",
        severity: "error",
        code: "rights-risk",
        message: `‘${scene.title}’의 자산 ‘${asset.label}’에 필요한 동의가 ${asset.consentStatus} 상태입니다.`,
        sceneId: scene.id,
        assetId: asset.assetId,
        evidence: { consentStatus: asset.consentStatus },
      });
    }
    if (asset.generated && !asset.provenanceHash) {
      pushIssue(state, {
        axis: "rights-provenance",
        severity: "warning",
        code: "missing-provenance",
        message: `생성 자산 ‘${asset.label}’의 모델·입력·원본 해시 영수증이 없습니다.`,
        sceneId: scene.id,
        assetId: asset.assetId,
      });
    }
  }
}

function collectSetupAndMotifs(scene: StoryworldScene, state: MutableSimulationState): void {
  for (const setupId of scene.setupIds ?? []) {
    const rows = state.setupScenes.get(setupId) ?? [];
    rows.push(scene.id);
    state.setupScenes.set(setupId, rows);
  }
  for (const setupId of scene.payoffIds ?? []) {
    const rows = state.payoffScenes.get(setupId) ?? [];
    rows.push(scene.id);
    state.payoffScenes.set(setupId, rows);
  }
  for (const motifId of scene.motifIds ?? []) {
    const rows = state.motifScenes.get(motifId) ?? [];
    rows.push(scene.id);
    state.motifScenes.set(motifId, rows);
  }
}

function finalizeReaderReveals(project: StoryworldProject, state: MutableSimulationState): void {
  const finalOrder = Math.max(0, ...project.scenes.filter((scene) => !scene.disabled).map((scene) => scene.order));
  for (const fact of project.facts) {
    if (
      fact.intendedReaderRevealOrder !== undefined
      && fact.intendedReaderRevealOrder <= finalOrder
      && !state.readerKnownFacts.has(fact.id)
    ) {
      pushIssue(state, {
        axis: "spoiler-safety",
        severity: "warning",
        code: "reader-reveal-missed",
        message: `사실 ‘${fact.label}’의 예정 공개 시점이 지났지만 독자 공개 장면이 없습니다.`,
        factId: fact.id,
        evidence: { intendedOrder: fact.intendedReaderRevealOrder, finalOrder },
      });
    }
  }
}

function buildSetupLedger(
  project: StoryworldProject,
  sceneById: ReadonlyMap<string, StoryworldScene>,
  state: MutableSimulationState,
): readonly StoryworldSetupLedgerRow[] {
  const contracts = new Map((project.setupContracts ?? []).map((contract) => [contract.id, contract]));
  const allIds = new Set<string>([
    ...contracts.keys(),
    ...state.setupScenes.keys(),
    ...state.payoffScenes.keys(),
  ]);
  const finalOrder = Math.max(0, ...project.scenes.filter((scene) => !scene.disabled).map((scene) => scene.order));
  const rows: StoryworldSetupLedgerRow[] = [];
  for (const setupId of [...allIds].sort()) {
    const contract = contracts.get(setupId);
    const setupSceneIds = [...(state.setupScenes.get(setupId) ?? [])];
    const payoffSceneIds = [...(state.payoffScenes.get(setupId) ?? [])];
    const required = Math.max(1, contract?.requiredPayoffCount ?? DEFAULT_SETUP_PAYOFF_COUNT);
    let status: StoryworldSetupLedgerRow["status"];
    if (setupSceneIds.length === 0 && payoffSceneIds.length > 0) {
      status = "unintroduced";
      for (const sceneId of payoffSceneIds) {
        pushIssue(state, {
          axis: "setup-payoff",
          severity: "error",
          code: "orphan-payoff",
          message: `복선 ${contract?.label ?? setupId}의 회수가 설치보다 먼저 또는 설치 없이 등장합니다.`,
          sceneId,
          setupId,
        });
      }
    } else if (setupSceneIds.length === 0) {
      status = "unintroduced";
    } else if (payoffSceneIds.length >= required) {
      status = payoffSceneIds.length > required ? "overpaid" : "paid";
    } else if (contract?.payoffDueByOrder !== undefined && finalOrder >= contract.payoffDueByOrder) {
      status = "overdue";
      pushIssue(state, {
        axis: "setup-payoff",
        severity: "error",
        code: "unpaid-setup",
        message: `복선 ${contract.label}의 회수가 ${contract.payoffDueByOrder}화 순서까지 완료되지 않았습니다.`,
        sceneId: setupSceneIds.at(-1),
        setupId,
        evidence: {
          requiredPayoffCount: required,
          actualPayoffCount: payoffSceneIds.length,
          dueByOrder: contract.payoffDueByOrder,
        },
      });
    } else {
      status = "open";
    }
    const firstPayoffOrder = payoffSceneIds
      .map((id) => sceneById.get(id)?.order)
      .filter((value): value is number => value !== undefined)
      .sort((a, b) => a - b)[0];
    const firstSetupOrder = setupSceneIds
      .map((id) => sceneById.get(id)?.order)
      .filter((value): value is number => value !== undefined)
      .sort((a, b) => a - b)[0];
    if (
      firstPayoffOrder !== undefined
      && firstSetupOrder !== undefined
      && firstPayoffOrder < firstSetupOrder
    ) {
      status = "unintroduced";
      pushIssue(state, {
        axis: "setup-payoff",
        severity: "error",
        code: "orphan-payoff",
        message: `복선 ${contract?.label ?? setupId}의 첫 회수가 첫 설치보다 앞섭니다.`,
        sceneId: payoffSceneIds[0],
        setupId,
      });
    }
    rows.push({
      setupId,
      label: contract?.label ?? setupId,
      setupSceneIds,
      payoffSceneIds,
      ...(contract?.payoffDueByOrder === undefined ? {} : { dueByOrder: contract.payoffDueByOrder }),
      status,
    });
  }
  return rows;
}

function buildMotifLedger(
  project: StoryworldProject,
  sceneById: ReadonlyMap<string, StoryworldScene>,
  state: MutableSimulationState,
): readonly StoryworldMotifLedgerRow[] {
  const definitions = new Map((project.motifs ?? []).map((motif) => [motif.id, motif]));
  const allIds = new Set([...definitions.keys(), ...state.motifScenes.keys()]);
  const rows: StoryworldMotifLedgerRow[] = [];
  for (const motifId of [...allIds].sort()) {
    const definition = definitions.get(motifId);
    const sceneIds = [...(state.motifScenes.get(motifId) ?? [])].sort((a, b) =>
      (sceneById.get(a)?.order ?? 0) - (sceneById.get(b)?.order ?? 0),
    );
    const activeSceneIds = project.scenes
      .filter((scene) => !scene.disabled)
      .sort(compareScene)
      .map((scene) => scene.id);
    const activeSceneIndex = new Map(activeSceneIds.map((id, index) => [id, index]));
    const occurrenceIndexes = sceneIds
      .map((id) => activeSceneIndex.get(id))
      .filter((value): value is number => value !== undefined);
    let largestGapScenes = 0;
    for (let index = 1; index < occurrenceIndexes.length; index += 1) {
      largestGapScenes = Math.max(
        largestGapScenes,
        occurrenceIndexes[index] - occurrenceIndexes[index - 1] - 1,
      );
    }
    if (sceneIds.length < (definition?.minOccurrences ?? 0)) {
      pushIssue(state, {
        axis: "setup-payoff",
        severity: "warning",
        code: "motif-underused",
        message: `모티프 ${definition?.label ?? motifId}이(가) 목표 횟수보다 적게 등장합니다.`,
        motifId,
        evidence: {
          minimum: definition?.minOccurrences ?? 0,
          actual: sceneIds.length,
        },
      });
    }
    if (
      definition?.maxGapScenes !== undefined
      && largestGapScenes > definition.maxGapScenes
    ) {
      pushIssue(state, {
        axis: "setup-payoff",
        severity: "warning",
        code: "motif-gap",
        message: `모티프 ${definition.label}의 등장 간격이 ${largestGapScenes}개 장면까지 벌어집니다.`,
        motifId,
        evidence: { largestGapScenes, maximum: definition.maxGapScenes },
      });
    }
    rows.push({
      motifId,
      label: definition?.label ?? motifId,
      sceneIds,
      occurrenceCount: sceneIds.length,
      largestGapScenes,
    });
  }
  return rows;
}

function buildProductionSummary(
  project: StoryworldProject,
  activeScenes: readonly StoryworldScene[],
  state: MutableSimulationState,
): StoryworldProductionSummary {
  let drawingMinutes = 0;
  let letteringMinutes = 0;
  let renderMinutes = 0;
  let reviewMinutes = 0;
  const assetIds = new Set<string>();
  const reusableAssetIds = new Set<string>();
  const critical: { id: string; minutes: number }[] = [];

  for (const scene of activeScenes) {
    const production = scene.production;
    const minutes = finiteOr(production?.drawingMinutes)
      + finiteOr(production?.letteringMinutes)
      + finiteOr(production?.renderMinutes)
      + finiteOr(production?.reviewMinutes);
    drawingMinutes += finiteOr(production?.drawingMinutes);
    letteringMinutes += finiteOr(production?.letteringMinutes);
    renderMinutes += finiteOr(production?.renderMinutes);
    reviewMinutes += finiteOr(production?.reviewMinutes);
    critical.push({ id: scene.id, minutes });
    for (const asset of scene.assets ?? []) {
      assetIds.add(asset.assetId);
      if (asset.reusable) reusableAssetIds.add(asset.assetId);
    }
    if (finiteOr(production?.complexity) > MAX_SCENE_COMPLEXITY) {
      pushIssue(state, {
        axis: "production",
        severity: "warning",
        code: "production-bottleneck",
        message: `‘${scene.title}’의 제작 복잡도 ${production?.complexity}가 병목 경고선 ${MAX_SCENE_COMPLEXITY}을 넘습니다.`,
        sceneId: scene.id,
        evidence: { complexity: production?.complexity ?? 0 },
      });
    }
  }

  const totalMinutes = drawingMinutes + letteringMinutes + renderMinutes + reviewMinutes;
  const capacityMinutes = project.productionCapacityMinutes === undefined
    ? null
    : Math.max(0, project.productionCapacityMinutes);
  const utilizationPercent = capacityMinutes === null || capacityMinutes === 0
    ? null
    : Math.round((totalMinutes / capacityMinutes) * 100);
  if (capacityMinutes !== null && totalMinutes > capacityMinutes) {
    pushIssue(state, {
      axis: "production",
      severity: totalMinutes > capacityMinutes * 1.25 ? "error" : "warning",
      code: "production-over-capacity",
      message: `예상 제작 시간 ${totalMinutes}분이 가용 시간 ${capacityMinutes}분을 초과합니다.`,
      evidence: { totalMinutes, capacityMinutes },
    });
  }

  critical.sort((a, b) => b.minutes - a.minutes || a.id.localeCompare(b.id));
  return {
    totalMinutes,
    drawingMinutes,
    letteringMinutes,
    renderMinutes,
    reviewMinutes,
    capacityMinutes,
    utilizationPercent,
    criticalSceneIds: critical.slice(0, Math.min(5, critical.length)).map((entry) => entry.id),
    reusableAssetCount: reusableAssetIds.size,
    uniqueAssetCount: assetIds.size,
  };
}

function buildAxisScores(issues: readonly StoryworldIssue[]): readonly StoryworldAxisScore[] {
  return AXIS_ORDER.map((axis) => {
    const axisIssues = issues.filter((issue) => issue.axis === axis);
    const errorCount = axisIssues.filter((issue) => issue.severity === "error").length;
    const warningCount = axisIssues.filter((issue) => issue.severity === "warning").length;
    const infoCount = axisIssues.filter((issue) => issue.severity === "info").length;
    const score = clamp(
      100 - errorCount * ERROR_PENALTY - warningCount * WARNING_PENALTY - infoCount * INFO_PENALTY,
      0,
      100,
    );
    return { axis, score, errorCount, warningCount, infoCount };
  });
}

function buildRepairProposals(
  issues: readonly StoryworldIssue[],
  project: StoryworldProject,
): readonly StoryworldRepairProposal[] {
  const orderedScenes = project.scenes.filter((scene) => !scene.disabled).sort(compareScene);
  const finalOrder = orderedScenes.at(-1)?.order ?? 0;
  return issues.map((issue): StoryworldRepairProposal => {
    const prefix = `repair:${issue.id}`;
    switch (issue.code) {
      case "knowledge-leak":
        return {
          id: prefix,
          issueId: issue.id,
          title: "지식 획득 비트 제안",
          rationale: "사용 장면보다 앞선 장면에 명시적 전달·목격·추론 공개를 추가합니다.",
          risk: "medium",
          intent: {
            kind: "add-reveal",
            sceneId: issue.sceneId ?? orderedScenes[0]?.id ?? "",
            characterId: issue.characterId ?? "",
            factId: issue.factId ?? "",
          },
        };
      case "premature-reader-reveal":
        return {
          id: prefix,
          issueId: issue.id,
          title: "독자 공개 시점 복원",
          rationale: "시각·대사·메타데이터에서 해당 사실을 계획된 공개 순서까지 숨깁니다.",
          risk: "medium",
          intent: {
            kind: "move-reveal",
            factId: issue.factId ?? "",
            targetOrder: Number(issue.evidence?.intendedOrder ?? finalOrder),
          },
        };
      case "unpaid-setup":
        return {
          id: prefix,
          issueId: issue.id,
          title: "최소 회수 장면 제안",
          rationale: "기존 설정을 폐기하지 않고 가장 가까운 장면에 짧은 시각·행동 회수를 배치합니다.",
          risk: "medium",
          intent: {
            kind: "add-payoff",
            setupId: issue.setupId ?? "",
            targetOrder: Number(issue.evidence?.dueByOrder ?? finalOrder),
          },
        };
      case "emotional-whiplash":
        return {
          id: prefix,
          issueId: issue.id,
          title: "감정 연결 비트 추가",
          rationale: "표정·행동·침묵·컷 여백 중 하나로 변화 원인을 독자가 관찰할 수 있게 합니다.",
          risk: "low",
          intent: {
            kind: "add-transition",
            sceneId: issue.sceneId ?? "",
            characterId: issue.characterId ?? "",
          },
        };
      case "localization-overflow":
        return {
          id: prefix,
          issueId: issue.id,
          title: "번역 레이아웃 안전 영역 확대",
          rationale: "원문을 훼손하지 않고 말풍선 재배치·자동 행갈이·대체 짧은 번역을 비교합니다.",
          risk: "low",
          intent: {
            kind: "resize-balloon",
            sceneId: issue.sceneId ?? "",
            locale: String(issue.evidence?.locale ?? "unknown"),
          },
        };
      case "accessibility-gap":
        return {
          id: prefix,
          issueId: issue.id,
          title: "접근성 증거 채우기",
          rationale: "읽기 순서·비색상 단서·대체 텍스트·동작 대체를 장면 체크리스트로 기록합니다.",
          risk: "low",
          intent: { kind: "add-accessibility-evidence", sceneId: issue.sceneId ?? "" },
        };
      case "rights-risk":
      case "missing-provenance":
        return {
          id: prefix,
          issueId: issue.id,
          title: "권리 안전 자산으로 교체",
          rationale: "정확한 리비전과 사용 근거가 있는 자산으로 분기 교체하고 원본은 보존합니다.",
          risk: "high",
          intent: {
            kind: "replace-asset",
            sceneId: issue.sceneId ?? "",
            assetId: issue.assetId ?? "",
          },
        };
      case "production-over-capacity":
      case "production-bottleneck":
        return {
          id: prefix,
          issueId: issue.id,
          title: "제작 단위 분할",
          rationale: "장면을 배경·인물·레터링·검수 작업으로 분리해 병렬화와 자산 재사용을 검토합니다.",
          risk: "medium",
          intent: { kind: "split-production", sceneId: issue.sceneId ?? "" },
        };
      default:
        return {
          id: prefix,
          issueId: issue.id,
          title: "근거와 함께 수동 검토",
          rationale: "자동 수정은 적용하지 않고 문제 장면과 현재 세계 상태를 함께 엽니다.",
          risk: "low",
          intent: { kind: "review-manually", ...(issue.sceneId ? { sceneId: issue.sceneId } : {}) },
        };
    }
  });
}

function receiptTimestamp(project: StoryworldProject): string {
  const value = project.metadata?.receiptTimestampIso;
  return typeof value === "string" && !Number.isNaN(Date.parse(value))
    ? new Date(value).toISOString()
    : "1970-01-01T00:00:00.000Z";
}

export function analyzeStoryworldProject(project: StoryworldProject): StoryworldAnalysisResult {
  const factsById = new Map(project.facts.map((fact) => [fact.id, fact]));
  const worldValues = new Map<string, StoryworldPrimitive>();
  for (const fact of project.facts) {
    if (Object.prototype.hasOwnProperty.call(fact, "initialValue")) {
      worldValues.set(fact.id, fact.initialValue ?? null);
    }
  }
  const characterKnownFacts = new Map<string, Set<string>>();
  for (const character of project.characters) {
    characterKnownFacts.set(character.id, new Set(character.initialFactIds ?? []));
  }
  const state: MutableSimulationState = {
    factsById,
    worldValues,
    readerKnownFacts: new Set<string>(),
    characterKnownFacts,
    setupScenes: new Map<string, string[]>(),
    payoffScenes: new Map<string, string[]>(),
    motifScenes: new Map<string, string[]>(),
    lastEmotionByCharacter: new Map<string, StoryworldEmotionalBeat>(),
    timeline: [],
    issues: [],
  };

  detectDuplicateIds(project, state);
  validateProjectReferences(project, state);
  detectDependencyCycles(project.scenes, state);

  const orderedScenes = project.scenes.filter((scene) => !scene.disabled).sort(compareScene);
  const sceneById = new Map(project.scenes.map((scene) => [scene.id, scene]));
  let previousScene: StoryworldScene | undefined;
  for (const scene of orderedScenes) {
    analyzeSceneContinuity(scene, previousScene, state);
    analyzeKnowledge(scene, state);
    analyzeEmotion(scene, state);
    analyzeLocalization(scene, state);
    analyzeAccessibility(scene, state);
    analyzeAssets(scene, state);
    collectSetupAndMotifs(scene, state);
    for (const mutation of scene.effects ?? []) applyMutation(scene, mutation, state);
    state.timeline.push({
      sceneId: scene.id,
      order: scene.order,
      facts: Object.fromEntries([...state.worldValues.entries()].sort(([a], [b]) => a.localeCompare(b))),
      readerFactIds: [...state.readerKnownFacts].sort(),
    });
    previousScene = scene;
  }

  finalizeReaderReveals(project, state);
  const setupLedger = buildSetupLedger(project, sceneById, state);
  const motifLedger = buildMotifLedger(project, sceneById, state);
  const production = buildProductionSummary(project, orderedScenes, state);
  const issues = [...state.issues].sort(compareIssue);
  const axisScores = buildAxisScores(issues);
  const overallScore = Math.round(
    axisScores.reduce((sum, row) => sum + row.score, 0) / Math.max(1, axisScores.length),
  );
  const knowledgeMatrix: StoryworldKnowledgeRow[] = project.characters
    .map((character) => ({
      characterId: character.id,
      characterName: character.name,
      knownFactIds: [...(state.characterKnownFacts.get(character.id) ?? [])].sort(),
      secretFactIds: [...(character.secretFactIds ?? [])].sort(),
    }))
    .sort((a, b) => a.characterName.localeCompare(b.characterName) || a.characterId.localeCompare(b.characterId));
  const repairProposals = buildRepairProposals(issues, project);
  const issueFingerprint = fingerprintStoryworldValue(issues.map((issue) => ({
    axis: issue.axis,
    code: issue.code,
    id: issue.id,
    severity: issue.severity,
  })));
  const receipt: StoryworldProofReceipt = {
    version: STUDIO_STORYWORLD_RECEIPT_VERSION,
    projectId: project.id,
    projectFingerprint: fingerprintStoryworldValue(project),
    generatedAtIso: receiptTimestamp(project),
    deterministic: true,
    sceneCount: orderedScenes.length,
    factCount: project.facts.length,
    issueFingerprint,
    axisScores,
    inputSummary: {
      characters: project.characters.length,
      facts: project.facts.length,
      scenes: project.scenes.length,
      activeScenes: orderedScenes.length,
      setupContracts: project.setupContracts?.length ?? 0,
      motifs: project.motifs?.length ?? 0,
    },
  };

  return {
    projectId: project.id,
    orderedSceneIds: orderedScenes.map((scene) => scene.id),
    issues,
    axisScores,
    overallScore,
    worldTimeline: state.timeline,
    knowledgeMatrix,
    setupLedger,
    motifLedger,
    production,
    repairProposals,
    receipt,
  };
}

function applyBranchMutation(
  project: StoryworldProject,
  mutation: StoryworldBranchMutation,
): StoryworldProject {
  switch (mutation.kind) {
    case "disable-scene":
    case "enable-scene":
      return {
        ...project,
        scenes: project.scenes.map((scene) => scene.id === mutation.sceneId
          ? { ...scene, disabled: mutation.kind === "disable-scene" }
          : scene),
      };
    case "move-scene":
      return {
        ...project,
        scenes: project.scenes.map((scene) => scene.id === mutation.sceneId
          ? { ...scene, order: mutation.order }
          : scene),
      };
    case "set-fact":
      return {
        ...project,
        facts: project.facts.map((fact) => fact.id === mutation.factId
          ? { ...fact, initialValue: mutation.value }
          : fact),
      };
    case "remove-reveal":
      return {
        ...project,
        scenes: project.scenes.map((scene) => {
          if (scene.id !== mutation.sceneId) return scene;
          return {
            ...scene,
            reveals: (scene.reveals ?? [])
              .map((reveal) => reveal.factId === mutation.factId
                ? { ...reveal, audiences: reveal.audiences.filter((audience) => audience !== mutation.audience) }
                : reveal)
              .filter((reveal) => reveal.audiences.length > 0),
          };
        }),
      };
  }
}

function collectImpactedSceneIds(
  project: StoryworldProject,
  mutation: StoryworldBranchMutation,
): readonly string[] {
  const seedIds = new Set<string>();
  if ("sceneId" in mutation) seedIds.add(mutation.sceneId);
  if (mutation.kind === "set-fact") {
    for (const scene of project.scenes) {
      const touchesFact = (scene.preconditions ?? []).some((predicate) => predicate.factId === mutation.factId)
        || (scene.effects ?? []).some((effect) => effect.factId === mutation.factId)
        || (scene.knowledgeUses ?? []).some((use) => use.factId === mutation.factId)
        || (scene.reveals ?? []).some((reveal) => reveal.factId === mutation.factId);
      if (touchesFact) seedIds.add(scene.id);
    }
  }
  const reverseDependencies = new Map<string, string[]>();
  for (const scene of project.scenes) {
    for (const dependency of scene.dependsOnSceneIds ?? []) {
      const dependentIds = reverseDependencies.get(dependency) ?? [];
      dependentIds.push(scene.id);
      reverseDependencies.set(dependency, dependentIds);
    }
  }
  const queue = [...seedIds];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const dependent of reverseDependencies.get(current) ?? []) {
      if (seedIds.has(dependent)) continue;
      seedIds.add(dependent);
      queue.push(dependent);
    }
  }
  const sceneById = new Map(project.scenes.map((scene) => [scene.id, scene]));
  return [...seedIds].sort((a, b) =>
    (sceneById.get(a)?.order ?? 0) - (sceneById.get(b)?.order ?? 0)
      || a.localeCompare(b),
  );
}

export function simulateStoryworldCounterfactual(
  project: StoryworldProject,
  mutation: StoryworldBranchMutation,
): StoryworldCounterfactualResult {
  const baseline = analyzeStoryworldProject(project);
  const branchProject = applyBranchMutation(project, mutation);
  const branch = analyzeStoryworldProject(branchProject);
  const baselineIssueIds = new Set(baseline.issues.map((issue) => issue.id));
  const branchIssueIds = new Set(branch.issues.map((issue) => issue.id));
  return {
    mutation,
    baseline,
    branch,
    scoreDelta: branch.overallScore - baseline.overallScore,
    addedIssueIds: [...branchIssueIds].filter((id) => !baselineIssueIds.has(id)).sort(),
    resolvedIssueIds: [...baselineIssueIds].filter((id) => !branchIssueIds.has(id)).sort(),
    impactedSceneIds: collectImpactedSceneIds(project, mutation),
  };
}

function dominates(
  left: StoryworldAnalysisResult,
  right: StoryworldAnalysisResult,
): boolean {
  const leftScores = new Map(left.axisScores.map((row) => [row.axis, row.score]));
  const rightScores = new Map(right.axisScores.map((row) => [row.axis, row.score]));
  let strictlyBetter = false;
  for (const axis of AXIS_ORDER) {
    const leftScore = leftScores.get(axis) ?? 0;
    const rightScore = rightScores.get(axis) ?? 0;
    if (leftScore < rightScore) return false;
    if (leftScore > rightScore) strictlyBetter = true;
  }
  return strictlyBetter;
}

/** Non-dominated branch ranking. No hidden aggregate weights decide the creative trade-off. */
export function rankStoryworldParetoFrontier(
  candidates: readonly StoryworldBranchCandidate[],
): readonly StoryworldParetoCandidate[] {
  return candidates.map((candidate) => {
    const dominatedByIds: string[] = [];
    const dominatesIds: string[] = [];
    for (const other of candidates) {
      if (other.id === candidate.id) continue;
      if (dominates(other.result, candidate.result)) dominatedByIds.push(other.id);
      if (dominates(candidate.result, other.result)) dominatesIds.push(other.id);
    }
    return {
      id: candidate.id,
      label: candidate.label,
      dominatedByIds: dominatedByIds.sort(),
      dominatesIds: dominatesIds.sort(),
      frontier: dominatedByIds.length === 0,
      overallScore: candidate.result.overallScore,
    };
  }).sort((a, b) => Number(b.frontier) - Number(a.frontier)
    || b.overallScore - a.overallScore
    || a.id.localeCompare(b.id));
}

export const STORYWORLD_DEMO_PROJECT: StoryworldProject = {
  schemaVersion: STUDIO_STORYWORLD_SCHEMA_VERSION,
  id: "storyworld-demo",
  title: "기억을 파는 도시",
  productionCapacityMinutes: 720,
  metadata: { receiptTimestampIso: "2026-09-05T00:00:00.000Z" },
  characters: [
    { id: "haeun", name: "하은", goal: "사라진 동생의 기억 찾기", initialFactIds: ["city-rains-at-night"] },
    { id: "dojin", name: "도진", goal: "기억 시장 보호", secretFactIds: ["dojin-is-brother"] },
  ],
  facts: [
    { id: "city-rains-at-night", label: "도시는 밤마다 비가 온다", subjectId: "city", key: "night-rain", initialValue: true, canonical: true },
    { id: "key-owned", label: "하은이 기억 금고 열쇠를 가진다", subjectId: "haeun", key: "owns-key", initialValue: false, canonical: true },
    { id: "dojin-is-brother", label: "도진은 사라진 동생이다", subjectId: "dojin", key: "identity", initialValue: true, intendedReaderRevealOrder: 40, canonical: true },
    { id: "vault-open", label: "기억 금고가 열린다", subjectId: "vault", key: "open", initialValue: false },
  ],
  setupContracts: [
    { id: "red-umbrella", label: "붉은 우산의 흠집", payoffDueByOrder: 40 },
  ],
  motifs: [
    { id: "rain-bell", label: "빗소리 속 종", minOccurrences: 3, maxGapScenes: 2 },
  ],
  scenes: [
    {
      id: "s10",
      title: "비 내리는 시장",
      order: 10,
      timeIndex: 10,
      locationId: "memory-market",
      participantIds: ["haeun"],
      setupIds: ["red-umbrella"],
      motifIds: ["rain-bell"],
      reveals: [{ factId: "city-rains-at-night", audiences: ["reader"] }],
      emotionalBeats: [{ characterId: "haeun", valence: -0.2, arousal: 0.4 }],
      localization: [{ locale: "en-US", sourceCharacters: 18, translatedCharacters: 31, balloonCapacityCharacters: 28 }],
      accessibility: { logicalReadingOrder: true, nonColorCue: true, textAlternative: true, soundMeaningVisualized: true, reducedMotionEquivalent: true },
      assets: [{ assetId: "market-bg", label: "기억 시장 배경", revision: "sha256:demo", licenseStatus: "cleared", reusable: true }],
      production: { drawingMinutes: 110, letteringMinutes: 15, reviewMinutes: 20, complexity: 7 },
    },
    {
      id: "s20",
      title: "열쇠 거래",
      order: 20,
      timeIndex: 20,
      locationId: "memory-market",
      participantIds: ["haeun", "dojin"],
      dependsOnSceneIds: ["s10"],
      effects: [{ factId: "key-owned", op: "set", value: true }],
      reveals: [{ factId: "key-owned", audiences: ["haeun", "reader"] }],
      motifIds: ["rain-bell"],
      emotionalBeats: [
        { characterId: "haeun", valence: 0.2, arousal: 0.55 },
        { characterId: "dojin", valence: -0.1, arousal: 0.5 },
      ],
      accessibility: { logicalReadingOrder: true, nonColorCue: true, textAlternative: true, soundMeaningVisualized: true, reducedMotionEquivalent: true },
      assets: [{ assetId: "red-umbrella", label: "붉은 우산", revision: "sha256:demo2", licenseStatus: "cleared", reusable: true }],
      production: { drawingMinutes: 130, letteringMinutes: 22, reviewMinutes: 18, complexity: 6 },
    },
    {
      id: "s30",
      title: "금고 앞의 거짓말",
      order: 30,
      timeIndex: 30,
      locationId: "vault",
      participantIds: ["haeun", "dojin"],
      dependsOnSceneIds: ["s20"],
      preconditions: [{ factId: "key-owned", comparator: "equals", value: true }],
      knowledgeUses: [{ characterId: "haeun", factId: "dojin-is-brother", purpose: "도진의 본명을 부른다" }],
      effects: [{ factId: "vault-open", op: "set", value: true }],
      emotionalBeats: [{ characterId: "haeun", valence: -0.9, arousal: 0.95 }],
      localization: [{ locale: "de-DE", sourceCharacters: 24, translatedCharacters: 46, balloonCapacityCharacters: 30 }],
      accessibility: { logicalReadingOrder: true, nonColorCue: false, textAlternative: true },
      assets: [{ assetId: "vault-texture", label: "금고 문양", licenseStatus: "unknown", generated: true }],
      production: { drawingMinutes: 220, letteringMinutes: 30, renderMinutes: 40, reviewMinutes: 35, complexity: 9 },
    },
    {
      id: "s40",
      title: "붉은 우산의 주인",
      order: 40,
      timeIndex: 40,
      locationId: "vault",
      participantIds: ["haeun", "dojin"],
      dependsOnSceneIds: ["s30"],
      preconditions: [{ factId: "vault-open", comparator: "equals", value: true }],
      payoffIds: ["red-umbrella"],
      motifIds: ["rain-bell"],
      reveals: [{ factId: "dojin-is-brother", audiences: ["haeun", "reader"] }],
      emotionalBeats: [{ characterId: "haeun", valence: 0.1, arousal: 0.75, transitionJustified: true }],
      accessibility: { logicalReadingOrder: true, nonColorCue: true, textAlternative: true, soundMeaningVisualized: true, reducedMotionEquivalent: true },
      assets: [{ assetId: "red-umbrella", label: "붉은 우산", revision: "sha256:demo2", licenseStatus: "cleared", reusable: true }],
      production: { drawingMinutes: 140, letteringMinutes: 20, reviewMinutes: 20, complexity: 7 },
    },
  ],
};
