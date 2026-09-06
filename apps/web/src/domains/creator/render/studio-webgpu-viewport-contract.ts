/** Backend-neutral document-to-presentation transform shared by Studio render surfaces. */
export interface StudioGpuViewTransform {
  readonly scaleX?: number;
  readonly scaleY?: number;
  readonly offsetX?: number;
  readonly offsetY?: number;
  readonly flipX?: boolean;
}

/** Logical document extent plus optional CSS/backing-surface presentation dimensions. */
export interface StudioGpuViewport extends StudioGpuViewTransform {
  readonly logicalWidth: number;
  readonly logicalHeight: number;
  readonly cssWidth?: number;
  readonly cssHeight?: number;
  readonly dpr?: number;
}
