import { describe, expect, it } from "vitest";

import { inspectStudioQualityFinishSupplement } from "./studio-quality-finish-bridge";
import { inspectStudioQuality } from "./studio-quality-inspection";

import type { StudioFinishQualityResult, StudioFinishQualityIssue } from "./studio-finish-quality";

const input = { documentTitle: "검사", pages: [] };
function report(issues: readonly StudioFinishQualityIssue[], truncated = false): StudioFinishQualityResult {
  return { version: 1, status: "needs-work", score: 50, canExport: false, readyForFinalReview: false,
    checkedPageCount: 0, checkedElementCount: 0, checkedDialogueCount: 0, checkedImageCount: 0,
    checkedStrokeCount: 0, openCommentCount: 0,
    counts: { blocker: 0, error: issues.length, warning: 0, info: 0, total: issues.length }, issues, truncated };
}
function issue(code: StudioFinishQualityIssue["code"]): StudioFinishQualityIssue {
  return { id: code, fingerprint: code, code, severity: "error", category: "dialogue",
    title: code, message: "원고 확인", pageId: "p", elementId: "e" };
}
describe("finishing findings in the canonical quality center", () => {
  it("retains unique findings without double-counting existing bubble errors", () => {
    const detail = report([issue("DIALOGUE_PLACEHOLDER"), issue("BUBBLE_TEXT_OVERFLOW")]);
    const result = inspectStudioQualityFinishSupplement(input, () => detail);
    expect(result.detail).toBe(detail);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({ severity: "error", pageId: "p", elementId: "e",
      evidence: { sourceCode: "DIALOGUE_PLACEHOLDER" } });
    expect(inspectStudioQualityFinishSupplement(input, () => detail).issues[0]?.id).toBe(result.issues[0]?.id);
  });
  it("fails closed when the additional inspector throws", () => {
    const result = inspectStudioQualityFinishSupplement(input, () => { throw new Error("private payload"); });
    expect(result.detail).toBeNull();
    expect(result.issues[0]?.severity).toBe("blocking");
    expect(JSON.stringify(result)).not.toContain("private payload");
    expect(inspectStudioQuality({ pages: [], supplementalIssues: result.issues }).canFinalize).toBe(false);
  });
  it("does not acknowledge away truncated additional results", () => {
    expect(inspectStudioQualityFinishSupplement(input, () => report([], true)).issues)
      .toEqual([expect.objectContaining({ severity: "error" })]);
  });
  it("invalidates receipts when additional finding evidence changes", () => {
    const first = inspectStudioQualityFinishSupplement(input, () => report([issue("DIALOGUE_PLACEHOLDER")]));
    const second = first.issues.map((finding) => ({ ...finding, evidence: { sourceCode: "changed" } }));
    expect(inspectStudioQuality({ pages: [], supplementalIssues: first.issues }).revisionKey)
      .not.toBe(inspectStudioQuality({ pages: [], supplementalIssues: second }).revisionKey);
  });
});
