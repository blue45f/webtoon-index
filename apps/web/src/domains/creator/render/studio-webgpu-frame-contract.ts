import type {
  StudioGpuReadbackArea,
  StudioGpuReadbackFailureReason,
  StudioGpuReadbackPixelRect,
} from "./studio-webgpu-readback";

export type StudioGpuBackend = "webgpu" | "canvas2d";

export interface StudioGpuFrameReceipt {
  /** Caller-owned identity; stale receipts can never authorize a newer render request. */
  readonly requestId: string;
  /** Deterministic identity of ordered operations, viewport transform, and physical surface size. */
  readonly fingerprint: string;
  readonly backend: StudioGpuBackend;
  readonly complete: true;
  readonly strokeCount: number;
  readonly dabCount: number;
  readonly physicalWidth: number;
  readonly physicalHeight: number;
}

/** Bounded counters for browser profiling without exposing mutable GPU resources. */
export interface StudioGpuPerformanceMetrics {
  readonly instanceBufferAllocations: number;
  readonly presentationBufferAllocations: number;
  readonly presentationBindGroupAllocations: number;
  readonly presentationBindGroupReuses: number;
}

export interface StudioGpuFrameReadbackRequest {
  /** Exact receipt previously emitted by the engine. Older or reconstructed frames fail closed. */
  readonly receipt: StudioGpuFrameReceipt;
  /** Captures either the whole current presentation viewport or one fully-visible document rect. */
  readonly area: StudioGpuReadbackArea;
}

export interface StudioGpuFrameReadback {
  readonly status: "captured";
  readonly receipt: StudioGpuFrameReceipt;
  readonly area: StudioGpuReadbackArea;
  readonly pixelRect: StudioGpuReadbackPixelRect;
  readonly width: number;
  readonly height: number;
  /** Canvas ImageData-compatible, unpremultiplied RGBA bytes. */
  readonly pixels: Uint8ClampedArray;
  readonly format: "rgba8unorm";
  readonly alphaMode: "unpremultiplied";
}

export interface StudioGpuFrameReadbackRejection {
  readonly status: "rejected";
  readonly reason: StudioGpuReadbackFailureReason;
}

export type StudioGpuFrameReadbackResult =
  | StudioGpuFrameReadback
  | StudioGpuFrameReadbackRejection;
