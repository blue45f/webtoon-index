import { useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { Group } from "react-konva/lib/ReactKonvaCore";

import { StudioDrawNode } from "./brush/StudioDrawNode";

import type { StudioPaperSurfaceSettings } from "./brush/studio-paper-granulation-runtime";
import type { StudioLiveTransformDraftStore } from "./studio-live-transform-draft-store";
import type Konva from "konva";

export interface StudioLiveTransformDraftNodeProps {
  readonly store: StudioLiveTransformDraftStore;
  readonly scope: string;
  readonly paperSurface?: StudioPaperSurfaceSettings;
}

/**
 * Always-mounted, pixel-empty root inside the existing single-object transform Layer.
 *
 * Keeping the root mounted before an imperative lift preserves ordering: the lifted stroke,
 * proxy and Transformer are appended after this Group, so an exact model draft always paints
 * below the interaction chrome without allocating another full-DPR canvas.
 */
export function StudioLiveTransformDraftNode({
  store,
  scope,
  paperSurface,
}: StudioLiveTransformDraftNodeProps) {
  const rootRef = useRef<Konva.Group | null>(null);
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  const scopedSnapshot = snapshot?.scope === scope ? snapshot : null;
  const entries = scopedSnapshot?.entries ?? null;

  // Active frames are synchronously painted by the gesture adapter after it switches authority.
  // This receipt handles the other direction: ack/scope-change removes the React child first,
  // then clears the retained pixels before the browser can paint the new document surface.
  useLayoutEffect(() => {
    if (entries === null) rootRef.current?.getLayer?.()?.drawScene();
  }, [entries, scope]);

  return (
    <Group ref={rootRef} name="studio-live-transform-draft-root" listening={false}>
      {/* One clipping Group per entry: a multi-selection can straddle panels, so the panel that
          owns each stroke has to clip that stroke and no other. */}
      {entries?.map(({ element, clip }) => (
        <Group
          key={element.id}
          listening={false}
          {...(clip
            ? {
                clipX: clip.x,
                clipY: clip.y,
                clipWidth: clip.width,
                clipHeight: clip.height,
              }
            : {})}
        >
          <StudioDrawNode
            el={element}
            exposeSceneIdentity={false}
            paperSurface={paperSurface}
            renderPurpose="transform-draft"
          />
        </Group>
      )) ?? null}
    </Group>
  );
}
