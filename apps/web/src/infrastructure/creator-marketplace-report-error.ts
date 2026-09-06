export const CREATOR_MARKETPLACE_REPORT_ERROR_CODES = [
  "creator_marketplace_report_target_not_found",
  "creator_marketplace_self_report_forbidden",
  "creator_marketplace_report_duplicate",
  "creator_marketplace_report_rate_limited",
  "creator_marketplace_report_unavailable",
] as const;

export type CreatorMarketplaceReportErrorCode =
  (typeof CREATOR_MARKETPLACE_REPORT_ERROR_CODES)[number] | "unknown";

const CREATOR_MARKETPLACE_REPORT_ERROR_CODE_SET = new Set<string>(
  CREATOR_MARKETPLACE_REPORT_ERROR_CODES,
);

function codeFromPayload(payload: unknown): CreatorMarketplaceReportErrorCode {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "unknown";
  const code = (payload as { code?: unknown }).code;
  return typeof code === "string" && CREATOR_MARKETPLACE_REPORT_ERROR_CODE_SET.has(code)
    ? code as CreatorMarketplaceReportErrorCode
    : "unknown";
}
export function creatorMarketplaceReportErrorCode(
  error: unknown,
): CreatorMarketplaceReportErrorCode {
  if (error instanceof CreatorMarketplaceReportError) return error.code;
  if (!error || typeof error !== "object") return "unknown";

  const direct = codeFromPayload(error);
  if (direct !== "unknown") return direct;

  if ("data" in error) {
    const dataCode = codeFromPayload((error as { data?: unknown }).data);
    if (dataCode !== "unknown") return dataCode;
  }
  if ("cause" in error) {
    return creatorMarketplaceReportErrorCode((error as { cause?: unknown }).cause);
  }
  return "unknown";
}

export class CreatorMarketplaceReportError extends Error {
  readonly code: CreatorMarketplaceReportErrorCode;

  constructor(
    code: CreatorMarketplaceReportErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, { cause });
    this.name = "CreatorMarketplaceReportError";
    this.code = code;
  }
}
