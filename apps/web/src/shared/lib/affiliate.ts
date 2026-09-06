export interface AffiliateConfig {
  readonly platformId: string;
  readonly trackingParam: string;
  readonly trackingValue: string;
}

// Only platforms where we have an affiliate agreement or tracking parameter
export const AFFILIATE_REGISTRY: Record<string, AffiliateConfig> = {
  ridi: {
    platformId: "ridi",
    trackingParam: "ridi_affiliate",
    trackingValue: "toonspectrum",
  },
  yes24: {
    platformId: "yes24",
    trackingParam: "yes_aff",
    trackingValue: "toonspectrum",
  },
  kyobo: {
    platformId: "kyobo",
    trackingParam: "kb_aff",
    trackingValue: "toonspectrum",
  },
  munpia: {
    platformId: "munpia",
    trackingParam: "munpia_aff",
    trackingValue: "toonspectrum",
  },
  novelpia: {
    platformId: "novelpia",
    trackingParam: "novelpia_aff",
    trackingValue: "toonspectrum",
  },
};

export function isAffiliateSupported(platformId: string): boolean {
  return Object.prototype.hasOwnProperty.call(AFFILIATE_REGISTRY, platformId);
}

export function buildAffiliateUrl(platformId: string, originalUrl: string): string {
  if (!originalUrl) return "";

  const config = AFFILIATE_REGISTRY[platformId];
  if (!config) return originalUrl;

  try {
    const urlObj = new URL(originalUrl);
    urlObj.searchParams.set(config.trackingParam, config.trackingValue);
    return urlObj.toString();
  } catch {
    // Fallback if URL is relative or malformed
    const separator = originalUrl.includes("?") ? "&" : "?";
    return `${originalUrl}${separator}${config.trackingParam}=${config.trackingValue}`;
  }
}
