import { describe, expect, it } from "vitest";

import { shouldOwnStudioCoalescedBatchDraft } from "./studio-coalesced-batch-mutation";

const base = {
  authoritativeSampleCount: 4,
  gpuPinned: false,
  fixedRateFilterActive: false,
  immediateCausalInput: false,
  mutableDirectSurfaceActive: false,
};

describe("studio coalesced batch mutation", () => {
  it("owns one mutable batch for an asynchronous WebGPU suffix feed", () => {
    expect(shouldOwnStudioCoalescedBatchDraft({ ...base, gpuPinned: true })).toBe(true);
  });

  it("does not duplicate the fixed-rate filter's existing owned-array optimization", () => {
    expect(shouldOwnStudioCoalescedBatchDraft({
      ...base,
      gpuPinned: true,
      fixedRateFilterActive: true,
    })).toBe(false);
  });

  it("keeps immediate non-overlay brushes to one clone per browser delivery", () => {
    expect(shouldOwnStudioCoalescedBatchDraft({
      ...base,
      immediateCausalInput: true,
    })).toBe(true);
    expect(shouldOwnStudioCoalescedBatchDraft({
      ...base,
      immediateCausalInput: true,
      mutableDirectSurfaceActive: true,
    })).toBe(false);
  });

  it("owns one batch for a direct-model eraser without a mutable presentation surface", () => {
    expect(shouldOwnStudioCoalescedBatchDraft({
      ...base,
      immediateCausalInput: true,
      mutableDirectSurfaceActive: false,
    })).toBe(true);
  });

  it("owns one immutable publication boundary for a coalesced legacy outline/material suffix", () => {
    expect(shouldOwnStudioCoalescedBatchDraft({
      ...base,
      immediateCausalInput: false,
      authoritativeSampleCount: 4,
    })).toBe(true);
  });

  it("leaves a single legacy sample on its existing one-copy append path", () => {
    expect(shouldOwnStudioCoalescedBatchDraft({
      ...base,
      immediateCausalInput: false,
      authoritativeSampleCount: 1,
    })).toBe(false);
  });

  it("does not mutate a draft already owned by a mutable presentation surface", () => {
    expect(shouldOwnStudioCoalescedBatchDraft({
      ...base,
      authoritativeSampleCount: 4,
      mutableDirectSurfaceActive: true,
    })).toBe(false);
  });

  it("does not allocate an owned batch when no authoritative sample arrived", () => {
    expect(shouldOwnStudioCoalescedBatchDraft({
      ...base,
      authoritativeSampleCount: 0,
      gpuPinned: true,
    })).toBe(false);
  });
});
