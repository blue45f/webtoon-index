import type { StudioPublishAiProvenance } from "../studio-publish-preflight";

export type StudioAiGeneratedAssetAction = Extract<
  StudioPublishAiProvenance["action"],
  "generated" | "edited"
>;

export interface StudioAiGeneratedAssetProviderContext {
  readonly provider: string;
  readonly model: string;
  readonly transport: "server" | "byok";
}

export type StudioAiGeneratedAssetProvenance = StudioPublishAiProvenance & {
  readonly provider: string;
  readonly model: string;
  readonly transport: "server" | "byok";
  readonly promptVersion: 1;
  readonly createdAt: string;
};

/**
 * Captures the publishable identity of an AI image request before any async boundary.
 *
 * Provider settings can change while a request is in flight. Generated elements must describe
 * the request that produced them, not whichever settings happen to be current when the response
 * is committed to the canvas.
 */
export function captureStudioAiGeneratedAssetProvenance(
  context: StudioAiGeneratedAssetProviderContext,
  action: StudioAiGeneratedAssetAction,
  now: Date = new Date()
): StudioAiGeneratedAssetProvenance {
  return {
    action,
    provider: context.provider,
    model: context.model,
    transport: context.transport,
    promptVersion: 1,
    createdAt: now.toISOString(),
  };
}

/**
 * Reconciles response-authoritative metadata without moving the request-start timestamp.
 * Some server transports choose the concrete model behind an alias only after the response.
 */
export function finalizeStudioAiGeneratedAssetProvenance(
  captured: StudioAiGeneratedAssetProvenance,
  response: { readonly model?: string | null }
): StudioAiGeneratedAssetProvenance {
  const model = response.model?.trim();
  if (!model || model === captured.model) return captured;
  return { ...captured, model };
}
