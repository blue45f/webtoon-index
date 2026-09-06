import {
  normalizeStudioBg3dConstraintLayer,
  normalizeStudioBg3dPoseLayer,
  type StudioBg3dJointAimConstraint,
  type StudioBg3dJointPoseOverride,
  type StudioBg3dTwoBoneIkConstraint,
} from "./studio-bg3d-scene-document";

const MAX_RIG_KEY_LENGTH = 128;
const MAX_MODEL_ID_LENGTH = 256;
const MAX_DESCRIPTORS = 4_096;

export interface StudioBg3dRigSelectionState {
  readonly modelId: string;
  readonly key: string;
}

/** Structural subset of the Three joint descriptor, kept engine-neutral to avoid an import cycle. */
export interface StudioBg3dRigSelectionDescriptor {
  readonly key: string;
  readonly canonicalKey: string;
}

export interface StudioBg3dResolvedRigSelection extends StudioBg3dRigSelectionState {
  readonly canonicalKey: string;
}

interface RigDescriptorIndex {
  readonly firstKey: string;
  readonly canonicalByKey: ReadonlyMap<string, string>;
}

function normalizeText(value: unknown, maximumLength: number): string | null {
  if (typeof value !== "string") return null;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x1f || codePoint === 0x7f) return null;
  }
  const normalized = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
  return normalized && Array.from(normalized).length <= maximumLength ? normalized : null;
}

function createDescriptorIndex(
  descriptors: readonly StudioBg3dRigSelectionDescriptor[],
): RigDescriptorIndex | null {
  if (!Array.isArray(descriptors) || descriptors.length === 0 || descriptors.length > MAX_DESCRIPTORS) {
    return null;
  }
  const canonicalByKey = new Map<string, string>();
  let firstKey: string | null = null;
  for (const descriptor of descriptors) {
    if (typeof descriptor !== "object" || descriptor === null) return null;
    const key = normalizeText(descriptor.key, MAX_RIG_KEY_LENGTH);
    const canonicalKey = normalizeText(descriptor.canonicalKey, MAX_RIG_KEY_LENGTH);
    if (!key || !canonicalKey) return null;
    const existing = canonicalByKey.get(key);
    if (existing !== undefined && existing !== canonicalKey) return null;
    if (existing === undefined) {
      canonicalByKey.set(key, canonicalKey);
      firstKey ??= key;
    }
  }
  if (!firstKey) return null;
  for (const canonicalKey of canonicalByKey.values()) {
    if (
      !canonicalByKey.has(canonicalKey) ||
      canonicalByKey.get(canonicalKey) !== canonicalKey
    ) return null;
  }
  return { firstKey, canonicalByKey };
}

function resolveExactSelection(input: {
  readonly modelId: string;
  readonly descriptors: readonly StudioBg3dRigSelectionDescriptor[];
  readonly selection: StudioBg3dRigSelectionState;
}): { readonly index: RigDescriptorIndex; readonly canonicalKey: string } | null {
  const modelId = normalizeText(input.modelId, MAX_MODEL_ID_LENGTH);
  const selectionModelId = normalizeText(input.selection?.modelId, MAX_MODEL_ID_LENGTH);
  const selectionKey = normalizeText(input.selection?.key, MAX_RIG_KEY_LENGTH);
  const index = createDescriptorIndex(input.descriptors);
  if (!modelId || !selectionModelId || modelId !== selectionModelId || !selectionKey || !index) {
    return null;
  }
  const canonicalKey = index.canonicalByKey.get(selectionKey);
  return canonicalKey ? { index, canonicalKey } : null;
}

/**
 * Resolves one model-owned joint selection. A selection from another model is never reused merely
 * because both models expose the same ordinal key. Invalid current state falls back to the supplied
 * model-specific remembered state, then to the first valid descriptor; an empty/hostile descriptor
 * contract clears the selection with `null`.
 */
export function resolveStudioBg3dRigSelection(input: {
  readonly modelId: string;
  readonly descriptors: readonly StudioBg3dRigSelectionDescriptor[];
  readonly selection?: StudioBg3dRigSelectionState | null;
  readonly rememberedSelection?: StudioBg3dRigSelectionState | null;
}): StudioBg3dResolvedRigSelection | null {
  const modelId = normalizeText(input.modelId, MAX_MODEL_ID_LENGTH);
  const index = createDescriptorIndex(input.descriptors);
  if (!modelId || !index) return null;
  const candidates = [input.selection, input.rememberedSelection];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const candidateModelId = normalizeText(candidate.modelId, MAX_MODEL_ID_LENGTH);
    const candidateKey = normalizeText(candidate.key, MAX_RIG_KEY_LENGTH);
    if (candidateModelId !== modelId || !candidateKey) continue;
    const canonicalKey = index.canonicalByKey.get(candidateKey);
    if (canonicalKey) return Object.freeze({ modelId, key: candidateKey, canonicalKey });
  }
  return Object.freeze({
    modelId,
    key: index.firstKey,
    canonicalKey: index.canonicalByKey.get(index.firstKey)!,
  });
}

function canonicalKey(index: RigDescriptorIndex, key: string): string | null {
  const normalized = normalizeText(key, MAX_RIG_KEY_LENGTH);
  return normalized ? index.canonicalByKey.get(normalized) ?? null : null;
}

/** Upserts or removes the selected physical bone's pose override, deduping aliases first-wins. */
export function mutateStudioBg3dPoseOverride(input: {
  readonly modelId: string;
  readonly descriptors: readonly StudioBg3dRigSelectionDescriptor[];
  readonly selection: StudioBg3dRigSelectionState;
  readonly overrides: readonly StudioBg3dJointPoseOverride[];
  readonly next: Omit<StudioBg3dJointPoseOverride, "jointKey"> | null;
}): readonly StudioBg3dJointPoseOverride[] | null {
  const resolved = resolveExactSelection(input);
  if (!resolved || !Array.isArray(input.overrides)) return null;
  const retained: StudioBg3dJointPoseOverride[] = [];
  const seen = new Set<string>();
  let insertionIndex: number | null = null;
  for (const override of input.overrides) {
    const normalized = normalizeStudioBg3dPoseLayer({ enabled: true, weight: 1, joints: [override] });
    if (!normalized || normalized.joints.length !== 1) return null;
    const item = normalized.joints[0]!;
    const identity = canonicalKey(resolved.index, item.jointKey);
    if (!identity) return null;
    if (identity === resolved.canonicalKey) {
      insertionIndex ??= retained.length;
      continue;
    }
    if (seen.has(identity)) continue;
    seen.add(identity);
    retained.push({ ...item, jointKey: identity });
  }
  if (input.next) {
    const normalized = normalizeStudioBg3dPoseLayer({
      enabled: true,
      weight: 1,
      joints: [{ jointKey: resolved.canonicalKey, ...input.next }],
    });
    if (!normalized || normalized.joints.length !== 1) return null;
    retained.splice(insertionIndex ?? retained.length, 0, normalized.joints[0]!);
  }
  const result = normalizeStudioBg3dPoseLayer({ enabled: true, weight: 1, joints: retained });
  return result && result.joints.length === retained.length ? result.joints : null;
}

/** Upserts or removes the selected physical bone's aim constraint, deduping aliases first-wins. */
export function mutateStudioBg3dAimConstraint(input: {
  readonly modelId: string;
  readonly descriptors: readonly StudioBg3dRigSelectionDescriptor[];
  readonly selection: StudioBg3dRigSelectionState;
  readonly constraints: readonly StudioBg3dJointAimConstraint[];
  readonly next: Omit<StudioBg3dJointAimConstraint, "jointKey"> | null;
}): readonly StudioBg3dJointAimConstraint[] | null {
  const resolved = resolveExactSelection(input);
  if (!resolved || !Array.isArray(input.constraints)) return null;
  const retained: StudioBg3dJointAimConstraint[] = [];
  const seen = new Set<string>();
  let insertionIndex: number | null = null;
  for (const constraint of input.constraints) {
    const normalized = normalizeStudioBg3dConstraintLayer({
      enabled: true,
      aims: [constraint],
      twoBoneIks: [],
    });
    if (!normalized || normalized.aims.length !== 1) return null;
    const item = normalized.aims[0]!;
    const identity = canonicalKey(resolved.index, item.jointKey);
    if (!identity) return null;
    if (identity === resolved.canonicalKey) {
      insertionIndex ??= retained.length;
      continue;
    }
    if (seen.has(identity)) continue;
    seen.add(identity);
    retained.push({ ...item, jointKey: identity });
  }
  if (input.next) {
    const normalized = normalizeStudioBg3dConstraintLayer({
      enabled: true,
      aims: [{ jointKey: resolved.canonicalKey, ...input.next }],
      twoBoneIks: [],
    });
    if (!normalized || normalized.aims.length !== 1) return null;
    retained.splice(insertionIndex ?? retained.length, 0, normalized.aims[0]!);
  }
  const result = normalizeStudioBg3dConstraintLayer({
    enabled: true,
    aims: retained,
    twoBoneIks: [],
  });
  return result && result.aims.length === retained.length ? result.aims : null;
}

function canonicalizeIk(
  index: RigDescriptorIndex,
  constraint: StudioBg3dTwoBoneIkConstraint,
): StudioBg3dTwoBoneIkConstraint | null {
  const normalized = normalizeStudioBg3dConstraintLayer({
    enabled: true,
    aims: [],
    twoBoneIks: [constraint],
  });
  if (!normalized || normalized.twoBoneIks.length !== 1) return null;
  const item = normalized.twoBoneIks[0]!;
  const upperJointKey = canonicalKey(index, item.upperJointKey);
  const middleJointKey = canonicalKey(index, item.middleJointKey);
  const endJointKey = canonicalKey(index, item.endJointKey);
  if (
    !upperJointKey || !middleJointKey || !endJointKey ||
    upperJointKey === middleJointKey || upperJointKey === endJointKey ||
    middleJointKey === endJointKey
  ) return null;
  return { ...item, upperJointKey, middleJointKey, endJointKey };
}

/**
 * Upserts or removes the chain selected by its end bone. Alias-equivalent and overlapping chains are
 * canonicalized with stable first-wins semantics; a new chain that overlaps a retained chain fails
 * closed instead of silently replacing an unrelated IK.
 */
export function mutateStudioBg3dTwoBoneIkConstraint(input: {
  readonly modelId: string;
  readonly descriptors: readonly StudioBg3dRigSelectionDescriptor[];
  readonly selection: StudioBg3dRigSelectionState;
  readonly constraints: readonly StudioBg3dTwoBoneIkConstraint[];
  readonly next: Omit<StudioBg3dTwoBoneIkConstraint, "endJointKey"> | null;
}): readonly StudioBg3dTwoBoneIkConstraint[] | null {
  const resolved = resolveExactSelection(input);
  if (!resolved || !Array.isArray(input.constraints)) return null;
  const retained: StudioBg3dTwoBoneIkConstraint[] = [];
  const claimed = new Set<string>();
  let insertionIndex: number | null = null;
  for (const constraint of input.constraints) {
    const item = canonicalizeIk(resolved.index, constraint);
    if (!item) return null;
    if (item.endJointKey === resolved.canonicalKey) {
      insertionIndex ??= retained.length;
      continue;
    }
    const chain = [item.upperJointKey, item.middleJointKey, item.endJointKey];
    if (chain.some((key) => claimed.has(key))) continue;
    for (const key of chain) claimed.add(key);
    retained.push(item);
  }
  if (input.next) {
    const item = canonicalizeIk(resolved.index, {
      endJointKey: resolved.canonicalKey,
      ...input.next,
    });
    if (!item || item.endJointKey !== resolved.canonicalKey) return null;
    const chain = [item.upperJointKey, item.middleJointKey, item.endJointKey];
    if (chain.some((key) => claimed.has(key))) return null;
    retained.splice(insertionIndex ?? retained.length, 0, item);
  }
  const result = normalizeStudioBg3dConstraintLayer({
    enabled: true,
    aims: [],
    twoBoneIks: retained,
  });
  return result && result.twoBoneIks.length === retained.length ? result.twoBoneIks : null;
}
