export interface StudioVrmExpressionApplyInput {
  readonly current: Readonly<Record<string, number>>;
  readonly incoming: Readonly<Record<string, number>>;
  /** When set, names outside this allowlist are dropped/skipped. */
  readonly availableNames?: readonly string[];
  /** 0 = keep current; 1 = full replace toward incoming. Default 1. */
  readonly blend?: number;
}

export interface StudioVrmExpressionApplyPlan {
  readonly weights: Readonly<Record<string, number>>;
  readonly applied: readonly string[];
  readonly skippedUnavailable: readonly string[];
  readonly skippedInvalid: readonly string[];
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function clampBlend(value: number | undefined): number {
  if (value === undefined) return 1;
  if (!Number.isFinite(value)) return 1;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function isValidWeight(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Plans one expression-weight merge without mutating inputs or the live VRM.
 * Weights are clamped to 0..1. When `availableNames` is provided, unknown expression
 * names are reported and omitted. `blend` lerps current→incoming for the union of keys
 * present in either map (missing side treated as 0).
 */
export function createStudioVrmExpressionApplyPlan(
  input: StudioVrmExpressionApplyInput,
): StudioVrmExpressionApplyPlan {
  const blend = clampBlend(input.blend);
  const allowlist = input.availableNames
    ? new Set(input.availableNames)
    : null;

  const weights: Record<string, number> = {};
  const applied: string[] = [];
  const skippedUnavailable: string[] = [];
  const skippedInvalid: string[] = [];
  const seen = new Set<string>();

  const visit = (name: string, currentRaw: unknown, incomingRaw: unknown) => {
    if (seen.has(name)) return;
    seen.add(name);

    if (allowlist && !allowlist.has(name)) {
      skippedUnavailable.push(name);
      return;
    }

    const hasCurrent = currentRaw !== undefined;
    const hasIncoming = incomingRaw !== undefined;

    if (hasCurrent && !isValidWeight(currentRaw)) {
      skippedInvalid.push(name);
      return;
    }
    if (hasIncoming && !isValidWeight(incomingRaw)) {
      skippedInvalid.push(name);
      return;
    }

    const current = hasCurrent && isValidWeight(currentRaw) ? clamp01(currentRaw) : 0;
    const incoming = hasIncoming && isValidWeight(incomingRaw) ? clamp01(incomingRaw) : 0;
    const next = clamp01(current + (incoming - current) * blend);
    weights[name] = next;
    applied.push(name);
  };

  for (const [name, value] of Object.entries(input.current)) {
    visit(name, value, input.incoming[name]);
  }
  for (const [name, value] of Object.entries(input.incoming)) {
    visit(name, input.current[name], value);
  }

  return Object.freeze({
    weights: Object.freeze(weights),
    applied: Object.freeze(applied),
    skippedUnavailable: Object.freeze(skippedUnavailable),
    skippedInvalid: Object.freeze(skippedInvalid),
  });
}
