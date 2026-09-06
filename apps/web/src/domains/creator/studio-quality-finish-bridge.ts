/** Additional finishing rules join the canonical issue and review-receipt model. */
import { inspectStudioFinishQuality } from "./studio-finish-quality";
import { createStudioQualityIssue } from "./studio-quality-inspection";

import type { StudioFinishQualityInput, StudioFinishQualityResult, StudioFinishQualityIssueCode } from "./studio-finish-quality";
import type { StudioQualityCategory, StudioQualityIssue } from "./studio-quality-inspection";

// Preserve canonical IDs/severity for geometry, fitting, decoding and approval checks.
const ADDITIONAL_CODES: ReadonlySet<StudioFinishQualityIssueCode> = new Set([
  "DOCUMENT_TITLE_MISSING", "PAGE_LOCKED_BEFORE_APPROVAL", "PAGE_REVIEW_ASSIGNEE_MISSING",
  "GROUP_ID_MISSING", "ELEMENT_OPACITY_INVALID", "VISIBLE_PRODUCTION_GUIDE",
  "DIALOGUE_PLACEHOLDER", "DIALOGUE_CONTROL_CHARACTER", "ANIMATION_FRAMES_EMPTY",
  "ANIMATION_SOURCE_MISMATCH", "ANIMATION_MODEL_CONFLICT", "STROKE_WIDTH_INVALID",
  "STROKE_SAMPLE_COUNT_MISMATCH", "COMMENT_PAGE_MISSING", "COMMENT_TARGET_MISSING",
  "COMMENT_POINT_INVALID",
]);
const CATEGORY: Readonly<Record<StudioFinishQualityResult["issues"][number]["category"], StudioQualityCategory>> = {
  document: "document", page: "document", review: "workflow", layer: "layer",
  dialogue: "lettering", image: "asset", animation: "asset", stroke: "document", comments: "workflow",
};
export interface StudioQualityFinishBridgeResult {
  readonly detail: StudioFinishQualityResult | null;
  readonly issues: readonly StudioQualityIssue[];
}

/** Exceptions and incomplete coverage are findings, never a successful inspection. */
export function inspectStudioQualityFinishSupplement(
  input: StudioFinishQualityInput,
  inspect: typeof inspectStudioFinishQuality = inspectStudioFinishQuality
): StudioQualityFinishBridgeResult {
  try {
    const detail = inspect(input);
    const issues: StudioQualityIssue[] = detail.issues
      .filter((issue) => ADDITIONAL_CODES.has(issue.code))
      .map((issue) => createStudioQualityIssue({
        code: "FINISH_QUALITY_FINDING",
        severity: issue.severity === "blocker" ? "blocking" : issue.severity === "info" ? "review" : issue.severity,
        category: CATEGORY[issue.category], title: issue.title, message: issue.message,
        remediation: "해당 위치와 세부 검사 근거를 확인한 뒤 수정하거나 의도된 상태인지 판단하세요.",
        pageId: issue.pageId, pageIndex: issue.pageIndex, elementId: issue.elementId,
        idSuffix: issue.fingerprint,
        evidence: { ...issue.evidence, sourceCode: issue.code },
      }));
    if (detail.truncated) issues.push(createStudioQualityIssue({
      code: "FINISH_QUALITY_FINDING", severity: "error", category: "document",
      title: "추가 마감 검사 표시 한도 도달", message: "모든 문제의 상세 결과를 확인하지 못했습니다.",
      remediation: "표시된 문제를 수정하고 다시 검사하세요.", idSuffix: "truncated",
    }));
    return { detail, issues };
  } catch {
    return { detail: null, issues: [createStudioQualityIssue({
      code: "FINISH_QUALITY_FINDING", severity: "blocking", category: "document",
      title: "추가 마감 검사 실행 실패", message: "원고 데이터 또는 측정 환경 때문에 추가 검사를 완료하지 못했습니다.",
      remediation: "문서 무결성 문제를 먼저 수정하고 다시 검사하세요. 실패는 통과로 처리되지 않습니다.",
      idSuffix: "scan-failed",
    })] };
  }
}
