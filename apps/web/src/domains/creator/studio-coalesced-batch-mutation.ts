export interface StudioCoalescedBatchMutationInput {
  readonly authoritativeSampleCount: number;
  readonly gpuPinned: boolean;
  readonly fixedRateFilterActive: boolean;
  readonly immediateCausalInput: boolean;
  readonly mutableDirectSurfaceActive: boolean;
}

/**
 * Decides when one browser delivery should clone a private stroke draft exactly once and then
 * mutate it for every coalesced hardware sample. Fixed-rate input already owns an equivalent
 * array reuse contract and must not pay a redundant outer clone.
 */
export function shouldOwnStudioCoalescedBatchDraft(
  input: StudioCoalescedBatchMutationInput
): boolean {
  if (!Number.isFinite(input.authoritativeSampleCount) || input.authoritativeSampleCount < 1) {
    return false;
  }
  if (input.fixedRateFilterActive) return false;
  if (input.gpuPinned) return true;
  if (input.mutableDirectSurfaceActive) return false;
  // Legacy outline/material brushes (G-pen, perfect ink, calligraphy and dynamic dabs) can receive
  // several 120/240Hz hardware samples in one browser delivery too. Letting each sample clone the
  // complete accumulated draft made a long stroke O(samples × points) before the next paint. Own a
  // private batch whenever there is a real coalesced suffix; a single legacy sample already pays
  // exactly one immutable append in appendFreehandStrokePoint and needs no extra outer clone.
  return input.immediateCausalInput || input.authoritativeSampleCount > 1;
}
