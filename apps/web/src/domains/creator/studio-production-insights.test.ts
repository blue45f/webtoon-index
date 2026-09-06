import { describe, expect, it } from "vitest";

import {
  computeStudioProductionInsights,
  estimateStudioReadingTime,
  STUDIO_PRODUCTION_INSIGHTS_LIMITS,
  STUDIO_READING_TIME_MODEL,
} from "./studio-production-insights";

describe("computeStudioProductionInsights", () => {
  it("returns transparent zero metrics for an empty local document", () => {
    const result = computeStudioProductionInsights(undefined);

    expect(result).toMatchObject({
      basis: "local-document-structure",
      pages: { totalCount: 0, withFramesCount: 0, emptyCount: 0 },
      frames: { totalCount: 0, averagePerPage: 0 },
      text: {
        dialogue: { textCount: 0, characterCount: 0 },
        narration: { textCount: 0, characterCount: 0 },
        total: { textCount: 0, characterCount: 0 },
      },
      readingTime: { estimatedSeconds: 0, roundedUpMinutes: 0 },
      normalization: { malformedEntryCount: 0, limitsApplied: false, limitedAreas: [] },
    });
    expect(result.review.coverage).toEqual({
      trackedPercent: 0,
      lockedPercent: 0,
      approvedPercent: 0,
      changesRequestedPercent: 0,
    });
  });

  it("computes episode, review, AI asset, and actionable issue metrics", () => {
    const result = computeStudioProductionInsights({
      pages: [
        {
          review: { status: "approved", locked: true },
          assets: [{ aiGenerated: true }],
          frames: [
            {
              dialogue: ["안녕 세상", { text: " 다시\n만나 " }],
              narration: "그날 밤",
              assets: [{ aiEdited: true }, { aiGenerated: true, aiEdited: true }],
            },
            { assets: [{}] },
          ],
        },
        {
          review: { status: "changes-requested", locked: false },
          frames: [{ narration: { text: "끝" } }],
        },
      ],
      issues: [
        { severity: "error" },
        { severity: "warning", resolved: true },
        { severity: "info", actionable: false },
        { severity: "unexpected" },
      ],
    });

    expect(result.pages).toEqual({ totalCount: 2, withFramesCount: 2, emptyCount: 0 });
    expect(result.frames).toEqual({ totalCount: 3, averagePerPage: 1.5 });
    expect(result.text).toEqual({
      dialogue: { textCount: 2, characterCount: 8 },
      narration: { textCount: 2, characterCount: 4 },
      total: { textCount: 4, characterCount: 12 },
    });
    expect(result.readingTime).toMatchObject({ estimatedSeconds: 9, roundedUpMinutes: 1 });
    expect(result.review).toEqual({
      statusCounts: {
        draft: 0,
        "needs-review": 0,
        "changes-requested": 1,
        approved: 1,
        untracked: 0,
      },
      lockedPageCount: 1,
      approvedAndLockedPageCount: 1,
      approvedUnlockedPageCount: 0,
      coverage: {
        trackedPercent: 100,
        lockedPercent: 50,
        approvedPercent: 50,
        changesRequestedPercent: 50,
      },
    });
    expect(result.assets).toEqual({
      totalCount: 4,
      aiGeneratedCount: 2,
      aiEditedCount: 2,
      aiGeneratedAndEditedCount: 1,
      aiAffectedCount: 3,
      aiAffectedPercent: 75,
    });
    expect(result.issues).toEqual({
      totalCount: 4,
      actionableCount: 1,
      blockingCount: 1,
      resolvedCount: 1,
      suppressedCount: 1,
      unclassifiedCount: 1,
      bySeverity: {
        error: { totalCount: 1, actionableCount: 1, resolvedCount: 0, suppressedCount: 0 },
        warning: { totalCount: 1, actionableCount: 0, resolvedCount: 1, suppressedCount: 0 },
        info: { totalCount: 1, actionableCount: 0, resolvedCount: 0, suppressedCount: 1 },
      },
    });
  });

  it("keeps missing and unknown review states untracked instead of guessing drafts", () => {
    const result = computeStudioProductionInsights({
      pages: [
        {},
        { review: { status: "unknown", locked: true } },
        { review: { status: "draft", locked: false } },
        { review: { status: "approved", locked: false } },
      ],
    });

    expect(result.review.statusCounts).toEqual({
      draft: 1,
      "needs-review": 0,
      "changes-requested": 0,
      approved: 1,
      untracked: 2,
    });
    expect(result.review.lockedPageCount).toBe(1);
    expect(result.review.approvedUnlockedPageCount).toBe(1);
    expect(result.review.coverage).toEqual({
      trackedPercent: 50,
      lockedPercent: 25,
      approvedPercent: 25,
      changesRequestedPercent: 0,
    });
  });

  it("normalizes bounded text and counts visible Unicode code points, not UTF-16 units", () => {
    const result = computeStudioProductionInsights({
      pages: [
        {
          frames: [
            {
              dialogue: ["  Ａ\u0000😀  ", " \n\t "],
              narration: [{ text: "한  글" }, { text: null }],
            },
          ],
        },
      ],
    });

    expect(result.text).toEqual({
      dialogue: { textCount: 1, characterCount: 2 },
      narration: { textCount: 1, characterCount: 2 },
      total: { textCount: 2, characterCount: 4 },
    });
  });

  it("counts page-level text that is not attached to a frame without inventing a frame", () => {
    const result = computeStudioProductionInsights({
      pages: [{ dialogue: ["프레임 밖 대사"], narration: "페이지 지문" }],
    });

    expect(result.pages).toEqual({ totalCount: 1, withFramesCount: 0, emptyCount: 1 });
    expect(result.frames.totalCount).toBe(0);
    expect(result.text).toEqual({
      dialogue: { textCount: 1, characterCount: 6 },
      narration: { textCount: 1, characterCount: 5 },
      total: { textCount: 2, characterCount: 11 },
    });
  });

  it("ignores malformed entries, preserves finite outputs, and reports normalization", () => {
    const result = computeStudioProductionInsights({
      pages: [
        null,
        "not-a-page",
        {
          review: "not-review",
          assets: "not-assets",
          frames: [
            null,
            {
              dialogue: [42, { text: "valid" }, { text: 99 }],
              narration: { nope: true },
              assets: [null, { aiGenerated: "true", aiEdited: true }],
            },
          ],
        },
      ],
      issues: [null, "bad", { severity: "error", resolved: "true" }],
    });

    expect(result.pages.totalCount).toBe(1);
    expect(result.frames.totalCount).toBe(1);
    expect(result.text.dialogue).toEqual({ textCount: 1, characterCount: 5 });
    expect(result.assets).toMatchObject({
      totalCount: 1,
      aiGeneratedCount: 0,
      aiEditedCount: 1,
    });
    expect(result.issues).toMatchObject({ totalCount: 1, actionableCount: 1, resolvedCount: 0 });
    expect(result.normalization.malformedEntryCount).toBeGreaterThanOrEqual(10);
    expect(Number.isFinite(result.readingTime.estimatedSeconds)).toBe(true);

    expect(computeStudioProductionInsights("bad-root").normalization).toEqual({
      malformedEntryCount: 1,
      limitsApplied: false,
      limitedAreas: [],
    });
  });

  it("caps every expensive collection and discloses the affected metric areas", () => {
    const limits = STUDIO_PRODUCTION_INSIGHTS_LIMITS;
    const result = computeStudioProductionInsights({
      pages: [
        {
          frames: [
            {
              dialogue: new Array(limits.maxTextSegments + 1).fill("a"),
              assets: new Array(limits.maxAssets + 1).fill({ aiGenerated: true }),
            },
            ...new Array(limits.maxFrames).fill({}),
          ],
        },
        ...new Array(limits.maxPages).fill({}),
      ],
      issues: new Array(limits.maxIssues + 1).fill({ severity: "warning" }),
    });

    expect(result.pages.totalCount).toBe(limits.maxPages);
    expect(result.frames.totalCount).toBe(limits.maxFrames);
    expect(result.text.dialogue.textCount).toBe(limits.maxTextSegments);
    expect(result.assets.totalCount).toBe(limits.maxAssets);
    expect(result.issues.totalCount).toBe(limits.maxIssues);
    expect(result.normalization).toEqual({
      malformedEntryCount: 0,
      limitsApplied: true,
      limitedAreas: ["pages", "frames", "text", "assets", "issues"],
    });
  });

  it("caps oversized individual text before normalization", () => {
    const limit = STUDIO_PRODUCTION_INSIGHTS_LIMITS.maxTextCodeUnitsPerSegment;
    const result = computeStudioProductionInsights({
      pages: [{ frames: [{ narration: "가".repeat(limit + 100) }] }],
    });

    expect(result.text.narration).toEqual({ textCount: 1, characterCount: limit });
    expect(result.normalization).toMatchObject({ limitsApplied: true, limitedAreas: ["text"] });
  });
});

describe("estimateStudioReadingTime", () => {
  it("uses the documented deterministic editorial formula", () => {
    expect(estimateStudioReadingTime(3, 12)).toEqual({
      estimatedSeconds: 9,
      roundedUpMinutes: 1,
      ...STUDIO_READING_TIME_MODEL,
    });
    expect(estimateStudioReadingTime(1.9, 300.9)).toMatchObject({
      estimatedSeconds: 62,
      roundedUpMinutes: 2,
    });
  });

  it("normalizes negative, non-finite, and excessively large numeric inputs", () => {
    expect(estimateStudioReadingTime(Number.NaN, Number.POSITIVE_INFINITY)).toMatchObject({
      estimatedSeconds: 0,
      roundedUpMinutes: 0,
    });
    expect(estimateStudioReadingTime(-10, -1)).toMatchObject({ estimatedSeconds: 0 });

    const capped = STUDIO_PRODUCTION_INSIGHTS_LIMITS.maxNumericMetricInput;
    expect(estimateStudioReadingTime(capped + 1, capped + 1)).toEqual(
      estimateStudioReadingTime(capped, capped)
    );
  });
});
