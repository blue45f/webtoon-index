/**
 * Fail-closed publication pipeline for PDF/A-2b and PDF/X-4 candidates.
 *
 * The writer, ICC policy, independent PDF scanner, and optional external validator are deliberately
 * separate. A successful result means that the exact returned bytes passed ToonSpectrum's bounded
 * publication checks. It does not manufacture an ISO, PDF Association, printer, or vendor
 * certification.
 */

import { buildVectorPdf } from "../render/studio-canvaskit-pdf-vector";
import { auditStudioIccProfilePolicy } from "../studio-icc-profile-policy";
import {
  preflightStudioPdfConformance,
  scanStudioPdfConformanceEvidence,
  verifyStudioPdfConformanceReceipt,
} from "../studio-pdf-conformance-profile";

import type { StudioPdfDocument } from "../render/studio-canvaskit-pdf-vector";
import type {
  StudioIccProfilePolicyReceipt,
  StudioIccProviderManifest,
} from "../studio-icc-profile-policy";
import type {
  StudioPdfConformanceProfileId,
  StudioPdfConformanceReceipt,
} from "../studio-pdf-conformance-profile";

export type StudioPdfConformanceExportProfile = Extract<
  StudioPdfConformanceProfileId,
  "pdf-a-2b" | "pdf-x-4"
>;

export interface StudioPdfConformanceExportRequest {
  readonly document: StudioPdfDocument;
  readonly iccManifest: StudioIccProviderManifest;
  /**
   * Optional exact-source validator envelope. PDF/A currently accepts the bounded veraPDF adapter
   * envelope; PDF/X remains a locally checked candidate until a trusted external adapter is added.
   */
  readonly veraPdf?: unknown;
}

export type StudioPdfConformanceExportFailureCode =
  | "conformance-declaration-required"
  | "conformance-rejected"
  | "icc-policy-rejected"
  | "output-intent-required"
  | "pdf-scan-failed"
  | "profile-unsupported"
  | "receipt-integrity-failed"
  | "writer-rejected";

export type StudioPdfConformanceExportResult =
  | Readonly<{
      ok: true;
      bytes: Uint8Array;
      profile: StudioPdfConformanceExportProfile;
      iccPolicy: StudioIccProfilePolicyReceipt;
      conformance: StudioPdfConformanceReceipt;
      certification: Readonly<{
        thirdParty: "not-claimed";
        note: "The receipt verifies ToonSpectrum's bounded pipeline and any imported exact-source validator result; it does not issue official certification.";
      }>;
    }>
  | Readonly<{
      ok: false;
      code: StudioPdfConformanceExportFailureCode;
      error: string;
      iccPolicy: StudioIccProfilePolicyReceipt | null;
      conformance: StudioPdfConformanceReceipt | null;
    }>;

function failure(
  code: StudioPdfConformanceExportFailureCode,
  error: string,
  details: {
    readonly iccPolicy?: StudioIccProfilePolicyReceipt | null;
    readonly conformance?: StudioPdfConformanceReceipt | null;
  } = {},
): StudioPdfConformanceExportResult {
  return Object.freeze({
    ok: false,
    code,
    error,
    iccPolicy: details.iccPolicy ?? null,
    conformance: details.conformance ?? null,
  });
}

/**
 * Produces and independently re-checks the exact publication bytes.
 *
 * ICC rights and identity are checked before the profile is embedded. The completed PDF is then
 * scanned from bytes, preflighted against its declared profile, and its deterministic receipt hash
 * is verified before the bytes are released.
 */
export async function exportStudioPdfConformanceCandidate(
  request: StudioPdfConformanceExportRequest,
): Promise<StudioPdfConformanceExportResult> {
  const declaration = request.document.conformance;
  if (!declaration) {
    return failure(
      "conformance-declaration-required",
      "PDF/A-2b 또는 PDF/X-4 적합성 선언이 필요해요.",
    );
  }
  const profile = declaration.target;
  if (profile !== "pdf-a-2b" && profile !== "pdf-x-4") {
    return failure(
      "profile-unsupported",
      "지원하지 않는 PDF 적합성 프로필이에요.",
    );
  }
  const outputIntent = request.document.outputIntent;
  if (!outputIntent) {
    return failure(
      "output-intent-required",
      "규격 후보 PDF에는 권리가 확인된 ICC OutputIntent가 필요해요.",
    );
  }

  const iccPolicy = await auditStudioIccProfilePolicy({
    bytes: outputIntent.profileBytes,
    requestedUse: "embed",
    manifest: request.iccManifest,
  });
  if (!iccPolicy.ok) {
    return failure(
      "icc-policy-rejected",
      `ICC 프로필 정책 검사에 실패했습니다(${iccPolicy.code}).`,
      { iccPolicy: iccPolicy.receipt },
    );
  }

  let bytes: Uint8Array;
  try {
    bytes = buildVectorPdf(request.document);
  } catch (error) {
    return failure(
      "writer-rejected",
      error instanceof Error ? error.message : "PDF writer가 문서를 거부했어요.",
      { iccPolicy: iccPolicy.receipt },
    );
  }

  const scan = scanStudioPdfConformanceEvidence(bytes);
  if (!scan.ok) {
    return failure(
      "pdf-scan-failed",
      `생성된 PDF를 독립적으로 다시 읽지 못했습니다(${scan.error.code}).`,
      { iccPolicy: iccPolicy.receipt },
    );
  }

  const conformance = preflightStudioPdfConformance(
    request.veraPdf === undefined
      ? { profile, evidence: scan.evidence }
      : { profile, evidence: scan.evidence, veraPdf: request.veraPdf },
  );
  const receiptVerification =
    verifyStudioPdfConformanceReceipt(conformance);
  if (!receiptVerification.valid) {
    return failure(
      "receipt-integrity-failed",
      `PDF 적합성 영수증 무결성 검사에 실패했습니다(${receiptVerification.code}).`,
      { iccPolicy: iccPolicy.receipt, conformance },
    );
  }
  if (conformance.result.decision === "rejected") {
    return failure(
      "conformance-rejected",
      "생성된 PDF가 선택한 적합성 프로필의 출고 조건을 충족하지 못했어요.",
      { iccPolicy: iccPolicy.receipt, conformance },
    );
  }

  return Object.freeze({
    ok: true,
    bytes: bytes.slice(),
    profile,
    iccPolicy: iccPolicy.receipt,
    conformance,
    certification: Object.freeze({
      thirdParty: "not-claimed",
      note: "The receipt verifies ToonSpectrum's bounded pipeline and any imported exact-source validator result; it does not issue official certification.",
    }),
  });
}
