import type { StudioFloatingSurfaceRect } from "./studio-floating-surface";

export type StudioFloatingSurfaceInteractionKind = "move" | "resize";

export interface StudioFloatingSurfacePointerSession {
  /** Cancels the active or pending interaction and restores the starting rectangle. */
  readonly cancel: () => void;
}

export interface StartStudioFloatingSurfacePointerSessionOptions {
  readonly kind: StudioFloatingSurfaceInteractionKind;
  readonly target: HTMLElement;
  readonly node: HTMLElement;
  readonly pointerId: number;
  readonly pointerType: string;
  readonly clientX: number;
  readonly clientY: number;
  readonly startRect: StudioFloatingSurfaceRect;
  readonly cursor?: string;
  readonly resolveRect: (
    deltaX: number,
    deltaY: number,
    commit: boolean,
  ) => StudioFloatingSurfaceRect;
  readonly onActiveChange: (active: boolean) => void;
  readonly onCommit: (rect: StudioFloatingSurfaceRect) => void;
  readonly onComplete: () => void;
}
