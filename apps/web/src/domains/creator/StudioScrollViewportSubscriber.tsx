/**
 * Render-prop binding for the live scroll-viewport store.
 *
 * Subtrees that must follow the canvas scroll offset at frame rate render
 * through this subscriber instead of reading a `StudioPage` state value. A pan
 * frame then re-renders only what is inside the render prop — the rulers, the
 * minimap viewport box — rather than the whole editor.
 */


import { useStudioScrollViewport } from "./use-studio-scroll-viewport";

import type { StudioScrollViewport, StudioScrollViewportStore } from "./studio-scroll-viewport-store";
import type { ReactNode } from "react";

export interface StudioScrollViewportSubscriberProps {
  readonly store: StudioScrollViewportStore;
  readonly render: (viewport: StudioScrollViewport) => ReactNode;
}

export function StudioScrollViewportSubscriber({
  store,
  render,
}: StudioScrollViewportSubscriberProps) {
  return <>{render(useStudioScrollViewport(store))}</>;
}
