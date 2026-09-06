import type { StudioAssetRightsUsageInput } from "./studio-asset-rights-manifest";
import type { El } from "./studio-element-model";

export interface StudioAssetRightsProjectionPage {
  readonly id: string;
  readonly elements: readonly El[];
}

function imageUsage(
  pageId: string,
  element: Extract<El, { type: "image" }>
): StudioAssetRightsUsageInput {
  const placement = { pageId, elementId: element.id };
  const community = element.communityAssetCredit;
  if (community) {
    return {
      ...placement,
      assetId: community.assetId,
      source: { kind: "community", id: community.assetId },
      licenseId: community.licenseId,
      licenseLabel: community.licenseLabel,
      licenseUrl: community.licenseUrl,
      attributionRequired: community.attributionRequired,
      attributionText: community.attributionText || community.authorName,
      commercialUse: community.commercialUse,
      aiTraining: "unknown",
      redistribution: "prohibited",
      expiresAt: null,
      scope: ["current-work", "commercial-publication"],
    };
  }
  if (element.builtinRasterAssetId) {
    return {
      ...placement,
      assetId: element.builtinRasterAssetId,
      source: { kind: "builtin", id: element.builtinRasterAssetId },
      licenseId: "toonspectrum-standard",
      attributionRequired: false,
      commercialUse: true,
      aiTraining: "unknown",
      redistribution: "prohibited",
      expiresAt: null,
      scope: ["current-work", "commercial-publication"],
    };
  }
  const stock = element.stockImageCredit;
  if (stock) {
    return {
      ...placement,
      assetId: `unsplash:${stock.unsplashPhotoPageUrl}`,
      source: { kind: "external", id: stock.unsplashPhotoPageUrl },
      licenseId: "custom",
      licenseLabel: "Unsplash License",
      licenseUrl: "https://unsplash.com/license",
      attributionRequired: true,
      attributionText: `${stock.photographerName} · ${stock.photographerProfileUrl}`,
      commercialUse: "allowed",
      aiTraining: "unknown",
      redistribution: "prohibited",
      expiresAt: null,
      scope: ["current-work", "commercial-publication"],
    };
  }
  if (element.aiProvenance) {
    return {
      ...placement,
      assetId: `ai:${element.id}`,
      source: {
        kind: "ai-generated",
        id: `${element.aiProvenance.provider}:${element.aiProvenance.model}`,
      },
      licenseId: "unknown",
      commercialUse: "unknown",
      aiTraining: "unknown",
      redistribution: "unknown",
      scope: ["current-work", "commercial-publication"],
    };
  }
  if (element.bg3dScene || element.vrmScene) {
    return {
      ...placement,
      assetId: `3d:${element.id}`,
      source: { kind: "3d-library", id: element.id },
      licenseId: "unknown",
      commercialUse: "unknown",
      aiTraining: "unknown",
      redistribution: "unknown",
      scope: ["current-work", "commercial-publication"],
    };
  }
  return {
    ...placement,
    assetId: `local:${element.id}`,
    source: { kind: "local-upload", id: element.id },
    licenseId: "unknown",
    commercialUse: "unknown",
    aiTraining: "unknown",
    redistribution: "unknown",
    scope: ["current-work", "commercial-publication"],
  };
}

/**
 * Projects only placed raster assets. Vector text, bubbles, brush strokes and frames are authored
 * document content, so treating them as third-party assets would create false licensing alarms.
 */
export function projectStudioAssetRightsUsages(
  pages: readonly StudioAssetRightsProjectionPage[]
): StudioAssetRightsUsageInput[] {
  return pages.flatMap((page) =>
    page.elements.flatMap((element) =>
      element.type === "image" ? [imageUsage(page.id, element)] : []
    )
  );
}
