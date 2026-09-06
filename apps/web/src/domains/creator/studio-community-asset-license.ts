import {
  creatorAssetLicenseOf,
  isCreatorAssetLicenseId,
  type CreatorAssetLicenseId,
} from "@/shared/lib/creator-asset-contract";

export interface StudioCommunityAssetCredit {
  assetId: string;
  authorName: string;
  licenseId: CreatorAssetLicenseId;
  licenseLabel: string;
  licenseUrl?: string;
  attributionText: string;
  attributionRequired: boolean;
  commercialUse: boolean;
  containsAi: boolean;
}

export function createStudioCommunityAssetCredit(input: {
  assetId: string;
  authorName: string;
  license: unknown;
  licenseLabel?: unknown;
  licenseUrl?: unknown;
  attributionText?: unknown;
  containsAi?: unknown;
}): StudioCommunityAssetCredit | null {
  if (!isCreatorAssetLicenseId(input.license)) return null;
  const license = creatorAssetLicenseOf(input.license);
  const authorName = input.authorName.trim() || "원저작자";
  const attributionText = typeof input.attributionText === "string"
    ? input.attributionText.trim().slice(0, 160)
    : "";
  const responseUrl = typeof input.licenseUrl === "string" ? input.licenseUrl.trim() : "";
  const licenseUrl = license.url ?? responseUrl;
  return {
    assetId: input.assetId,
    authorName,
    licenseId: license.id,
    licenseLabel: typeof input.licenseLabel === "string" && input.licenseLabel.trim()
      ? input.licenseLabel.trim().slice(0, 80)
      : license.shortLabel,
    ...(licenseUrl ? { licenseUrl } : {}),
    attributionText,
    attributionRequired: license.attributionRequired,
    commercialUse: license.commercialUse,
    containsAi: input.containsAi === true,
  };
}

export function formatStudioCommunityAssetCredit(
  credit: StudioCommunityAssetCredit
): string | null {
  if (!credit.attributionRequired && credit.commercialUse) return null;
  const parts = [
    credit.attributionText || credit.authorName,
    credit.licenseLabel,
    credit.licenseUrl,
    credit.attributionRequired ? "작품 내 편집·사용" : null,
    credit.commercialUse ? null : "비상업 전용",
  ].filter((part): part is string => Boolean(part));
  return parts.join(" · ");
}
