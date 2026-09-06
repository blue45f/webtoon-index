/** Bounded, transactional joint-to-contact refinement, not mesh collision detection. */
export interface StudioVrmContactRefinementInput {
  readonly initial: readonly number[];
  readonly limits: readonly number[];
  readonly goal: number;
  readonly measure: () => number | null;
  readonly apply: (angles: readonly number[]) => void;
  readonly maxPasses?: number;
  readonly minImprovement?: number;
  /** Disjoint groups of joint indices, normally one three-joint chain per finger. */
  readonly groups?: readonly (readonly number[])[];
  /** One distance per group. Replaces measure when supplied; no contact may get worse. */
  readonly measureContacts?: () => readonly number[] | null;
  /** Opt in to measured opening as well as closing; the authored sign never changes. */
  readonly allowRelaxation?: boolean;
  /** Total angular change from the authored pose, not a per-pass allowance (radians). */
  readonly maxAngularChange?: number;
  /** Includes the initial measurement. Hard-capped to bound work on malformed imports. */
  readonly maxEvaluations?: number;
}
export interface StudioVrmContactRefinementResult {
  readonly angles: readonly number[];
  readonly before: number | null;
  readonly after: number | null;
  readonly acceptedPasses: number;
  readonly evaluations: number;
  /** False means the adapter rejected rollback; angles is empty, not a claimed pose. */
  readonly restored: boolean;
  readonly reason: "invalid" | "already-contact" | "improved" | "no-improvement" | "restore-failed";
}
const finiteDistance = (value: unknown): value is number => (
  typeof value === "number" && Number.isFinite(value) && value >= 0
);
const finiteValues = (values: readonly number[]): boolean => Array.from(values).every(Number.isFinite);

export function refineStudioVrmContact(input: StudioVrmContactRefinementInput): StudioVrmContactRefinementResult {
  const initial = [...input.initial];
  let best = [...initial];
  let before: number | null = null;
  let after: number | null = null;
  let acceptedPasses = 0;
  let evaluations = 0;
  let restored = true;
  let reason: StudioVrmContactRefinementResult["reason"] = "invalid";
  const result = (): StudioVrmContactRefinementResult => ({
    angles: [...best], before, after, acceptedPasses, evaluations, restored, reason,
  });
  const passes = input.maxPasses ?? 4;
  const improvement = input.minImprovement ?? 0.0006;
  const angularChange = input.maxAngularChange ?? Math.PI / 9;
  const budget = input.maxEvaluations ?? 64;
  if (!finiteDistance(input.goal) || !finiteDistance(passes)
    || !Number.isFinite(improvement) || improvement <= 0
    || !finiteDistance(angularChange) || angularChange > Math.PI
    || !Number.isSafeInteger(budget) || budget < 1
    || initial.length === 0 || initial.length > 60 || initial.length !== input.limits.length
    || !finiteValues(initial) || !finiteValues(input.limits) || input.limits.some((limit) => limit <= 0)) return result();
  const groups = input.groups ?? [initial.map((_, index) => index)];
  const indices = new Set<number>();
  if (groups.length === 0 || groups.length > 20) return result();
  for (const group of groups) {
    if (!Array.isArray(group) || group.length === 0) return result();
    for (const index of group) {
      if (!Number.isSafeInteger(index) || index < 0 || index >= initial.length || indices.has(index)) return result();
      indices.add(index);
    }
  }
  if (indices.size !== initial.length) return result();
  const maxEvaluations = Math.min(128, budget);
  const measure = (): number[] | null => {
    evaluations += 1;
    const distances = input.measureContacts ? input.measureContacts() : [input.measure()];
    if (!Array.isArray(distances) || distances.length !== (input.measureContacts ? groups.length : 1)
      || !Array.from(distances).every(finiteDistance)) return null;
    return [...distances] as number[];
  };
  const score = (distances: readonly number[]): number => Math.hypot(
    ...distances.map((distance) => Math.max(0, distance - input.goal)),
  );
  // Never let adapter mutation alias the best/initial snapshots used for rollback.
  let dirty = false;
  const apply = (angles: readonly number[]) => {
    dirty = true;
    input.apply(Object.freeze([...angles]));
  };
  try {
    const start = measure();
    if (!start) return result(); // Invalid or absent measurements must cause zero writes.
    let contacts = start;
    before = Math.max(...start);
    after = before;
    let bestScore = score(start);
    if (bestScore === 0) {
      reason = "already-contact";
      return result();
    }
    const factors = input.allowRelaxation ? [1.08, 0.94, 1.18, 0.85, 1.32] : [1.08, 1.18, 1.32];
    for (let pass = 0; pass < Math.min(6, Math.floor(passes)); pass += 1) {
      const previousScore = bestScore;
      for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
        // Do not disturb a finger that already reaches its contact region.
        if (input.measureContacts && contacts[groupIndex] <= input.goal) continue;
        const baseline = [...best];
        for (const factor of factors) {
          if (evaluations >= maxEvaluations) break;
          const candidate = [...baseline];
          for (const index of groups[groupIndex]) {
            const angle = baseline[index];
            if (Math.abs(angle) < 1e-4) continue; // No calibrated bend sign for a zero joint.
            const original = Math.abs(initial[index]);
            const lower = Math.max(0, original - angularChange);
            const upper = Math.min(Math.max(original, input.limits[index]), original + angularChange);
            candidate[index] = Math.sign(angle) * Math.max(lower, Math.min(upper, Math.abs(angle) * factor));
          }
          if (sameStudioVrmContactValues(candidate, baseline, 1e-10)) continue;
          apply(candidate);
          const trial = measure();
          const trialScore = trial ? score(trial) : Infinity;
          const contactSafe = trial && (!input.measureContacts
            || trial.every((distance, index) => distance <= contacts[index] + 1e-9));
          if (trial && contactSafe && trialScore < bestScore - improvement) {
            best = candidate;
            contacts = trial;
            bestScore = trialScore;
            after = Math.max(...trial);
          } else {
            apply(best);
          }
          if (bestScore === 0) break;
        }
        if (bestScore === 0 || evaluations >= maxEvaluations) break;
      }
      if (bestScore >= previousScore - improvement) break;
      acceptedPasses += 1;
      if (bestScore === 0 || evaluations >= maxEvaluations) break;
    }
    reason = acceptedPasses > 0 ? "improved" : "no-improvement";
  } catch {
    best = [...initial];
    after = before;
    acceptedPasses = 0;
    reason = "invalid";
    if (dirty) {
      try {
        input.apply(Object.freeze([...initial]));
      } catch {
        // A broken adapter must not escape into the animation frame or claim restoration.
        best = [];
        after = null;
        restored = false;
        reason = "restore-failed";
      }
    }
  }
  return result();
}

export function sameStudioVrmContactValues(a: readonly number[], b: readonly number[], epsilon = 1e-7): boolean {
  return Number.isFinite(epsilon) && epsilon >= 0 && a.length === b.length
    && Array.from(a).every((value, index) => (
      Number.isFinite(value) && Number.isFinite(b[index]) && Math.abs(value - b[index]) <= epsilon
    ));
}

export interface StudioVrmContactReplay {
  readonly input: readonly number[];
  readonly output: readonly number[];
  /** Non-curl joint rotations, translations and scales: protects newer manual edits. */
  readonly shape: readonly number[];
  /** Hand-relative target plus scale/shear metric; rigid movement does not invalidate it. */
  readonly context: readonly number[];
}
export interface StudioVrmContactReplayPlan {
  readonly kind: "solve" | "replay" | "unchanged";
  readonly angles: readonly number[];
}

export function planStudioVrmContactReplay(
  cache: StudioVrmContactReplay | null,
  current: readonly number[],
  shape: readonly number[],
  context: readonly number[],
): StudioVrmContactReplayPlan {
  if (!cache || !sameStudioVrmContactValues(shape, cache.shape)) return { kind: "solve", angles: [...current] };
  const isInput = sameStudioVrmContactValues(current, cache.input);
  const isOutput = sameStudioVrmContactValues(current, cache.output);
  if ((isInput || isOutput) && sameStudioVrmContactValues(context, cache.context)) {
    return { kind: isOutput ? "unchanged" : "replay", angles: [...cache.output] };
  }
  // Re-solve a moved contact from the original, never from a repeatedly tightened output.
  return { kind: "solve", angles: [...(isOutput ? cache.input : current)] };
}

export function releaseStudioVrmContactReplay(
  cache: StudioVrmContactReplay | null,
  current: readonly number[],
  shape: readonly number[],
): readonly number[] | null {
  if (!cache || !sameStudioVrmContactValues(current, cache.output)
    || !sameStudioVrmContactValues(shape, cache.shape)
    || sameStudioVrmContactValues(cache.input, cache.output)) return null;
  return [...cache.input];
}
