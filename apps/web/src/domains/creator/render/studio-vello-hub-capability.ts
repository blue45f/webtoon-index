export const STUDIO_VELLO_HUB_PRODUCT_CAPABILITY = Object.freeze({
  id: "studio-vello-hub-document-hybrid-v13",
  enabledByDefault: true,
  scope: "document-vector-hybrid",
  primarySurfaceOwnership: "frame-graph-compositor",
  documentAuthority: true,
  inputAuthority: false,
  brushPixelAuthority: false,
  canonicalDocumentAuthority: false,
  maxCssDimension: 8_192,
  /** Conservative cross-device WebGPU `maxTextureDimension2D` admission. */
  maxBackingDimension: 8_192,
  maxBackingPixelArea: 67_108_864,
  qaVisualMismatchPctGate: 0.6,
  /** One selected GPU provider owns each admitted product render. */
  admissionMode: "selected-gpu-provider",
  persistentWinnerStorage: false,
  productWidePromotionRequiresSoak: true,
});

export const STUDIO_VELLO_HYBRID_SPARSE_CANDIDATE = Object.freeze({
  id: "vello-hybrid-sparse-gpu",
  status: "unavailable-upstream-api" as const,
  eligible: false,
  reason:
    "Upstream vello_hybrid 0.2 sparse-strip GPU is not adopted in the pinned "
    + "vello 0.9 Classic browser artifact. Product Hybrid is the FrameGraph compositor.",
  promotionCondition:
    "Adopt vello_hybrid 0.2 on a wgpu-aligned toon-vello track and pass the "
    + "same SceneIR visual gate, device-loss and product-island tests.",
});

export const STUDIO_VELLO_HYBRID_COMPOSITOR = Object.freeze({
  id: "vello-hybrid-wgpu",
  status: "production-compositor" as const,
  eligible: true,
  reason:
    "V13 Hybrid is Classic path-heavy islands plus external-texture / image "
    + "binding inside StudioFrameGraphCompositor on the single fabric GPUDevice.",
});

export interface StudioVelloHubCapabilityDecision {
  readonly enabled: boolean;
  readonly capabilityId: typeof STUDIO_VELLO_HUB_PRODUCT_CAPABILITY.id;
  readonly scope: typeof STUDIO_VELLO_HUB_PRODUCT_CAPABILITY.scope;
  readonly reason: "product-default" | "emergency-disabled" | "explicit-disabled";
}

interface StudioVelloHubGlobalFlags {
  readonly __TOONSPECTRUM_STUDIO_VELLO_HUB_DISABLED__?: boolean;
}

export function resolveStudioVelloHubProductCapability(options?: {
  readonly enabled?: boolean;
  readonly globalObject?: StudioVelloHubGlobalFlags;
}): StudioVelloHubCapabilityDecision {
  const globalObject = options?.globalObject
    ?? (globalThis as StudioVelloHubGlobalFlags);
  if (options?.enabled === false) {
    return {
      enabled: false,
      capabilityId: STUDIO_VELLO_HUB_PRODUCT_CAPABILITY.id,
      scope: STUDIO_VELLO_HUB_PRODUCT_CAPABILITY.scope,
      reason: "explicit-disabled",
    };
  }
  if (globalObject.__TOONSPECTRUM_STUDIO_VELLO_HUB_DISABLED__ === true) {
    return {
      enabled: false,
      capabilityId: STUDIO_VELLO_HUB_PRODUCT_CAPABILITY.id,
      scope: STUDIO_VELLO_HUB_PRODUCT_CAPABILITY.scope,
      reason: "emergency-disabled",
    };
  }
  return {
    enabled: true,
    capabilityId: STUDIO_VELLO_HUB_PRODUCT_CAPABILITY.id,
    scope: STUDIO_VELLO_HUB_PRODUCT_CAPABILITY.scope,
    reason: "product-default",
  };
}
