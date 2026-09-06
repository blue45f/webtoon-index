/**
 * Web Worker protocol for background brush stroke processing & dab planning.
 */

export const STUDIO_BRUSH_WORKER_PROTOCOL_VERSION = 1 as const;

export type StudioBrushWorkerPlanRequest = {
  version: typeof STUDIO_BRUSH_WORKER_PROTOCOL_VERSION;
  id: string;
  brushId: string;
  points: readonly number[];
  pressures?: readonly number[] | null;
  strokeWidth: number;
  seed: number;
  sampleSpacing?: number;
};

export type StudioBrushWorkerPlanResponse = {
  version: typeof STUDIO_BRUSH_WORKER_PROTOCOL_VERSION;
  id: string;
  ok: boolean;
  points: number[];
  dabCount: number;
  error?: string;
};
