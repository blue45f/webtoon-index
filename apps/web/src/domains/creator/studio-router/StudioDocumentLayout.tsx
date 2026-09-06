import { useEffect, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";

import {
  createStudioLiveInstantWorkId,
  readStudioLiveRoomQuery,
  shouldPublishStudioLiveJamRoom,
  withStudioLiveJamRoom,
} from "../live/studio-live-jam-session";

import {
  StudioDocumentLayoutContext,
  type StudioDocumentLayoutRuntime,
} from "./studio-document-layout-context";
import { useStudioDocumentRuntime } from "./studio-document-runtime-context";

import type { StudioWorkspaceRoute } from "../studio-workspace-route";

interface StudioDocumentLayoutProps {
  readonly children: ReactNode;
  /** Guest-draft adoption epoch owned by `StudioRouter`; part of the boundary key above. */
  readonly draftSessionEpoch: number;
  readonly studioRoute: StudioWorkspaceRoute;
}

/**
 * Parent layout for one Studio document instance.
 *
 * It renders INSIDE `StudioDocumentRuntimeBoundary` on purpose. The boundary keys by
 * `studioEditorInstanceKey` (identity + auth + draft epoch) and `RouteStage` keys by the route
 * `lifecycleKey` (identity + presentation, no auth/epoch); collapsing those two layers breaks
 * guest-draft adoption. Sitting inside the boundary means this layout — and everything it owns —
 * tears down before the next identity mounts, while surviving every surface switch within one
 * identity, because the boundary key deliberately ignores canvas/comic/animation/dcc.
 */
export function StudioDocumentLayout({
  children,
  draftSessionEpoch,
  studioRoute,
}: StudioDocumentLayoutProps) {
  const { documentKey } = useStudioDocumentRuntime();
  const [params, setSearchParams] = useSearchParams();
  const liveRoomParam = readStudioLiveRoomQuery(params);
  const workId = studioRoute.workId;
  const remixId = studioRoute.remixSourceWorkId;
  // Lazy state instead of a render-phase ref write: react-compiler rejects mutating hook-derived
  // refs during render, and the initializer runs exactly once per mounted boundary either way.
  const [instantWorkId] = useState(createStudioLiveInstantWorkId);
  useEffect(() => {
    if (!shouldPublishStudioLiveJamRoom({
      remixId,
      roomId: liveRoomParam,
      workId,
    })) return;
    // The published id is always the per-tab instant id, never the local draft-collaboration id.
    // That guard holds because the draft identity is `null` on the first commit (it is provisioned
    // asynchronously) and is force-cleared the moment `?room=` exists — so it can never reach the
    // one frame in which this publish runs. Keeping the draft id out of the layout is what lets the
    // room query move up here without dragging the draft-provisioning state out of StudioPage.
    setSearchParams((current) => {
      if (readStudioLiveRoomQuery(current) === instantWorkId) return current;
      return withStudioLiveJamRoom(current, instantWorkId);
    }, { replace: true });
  }, [instantWorkId, liveRoomParam, remixId, setSearchParams, workId]);

  const runtime: StudioDocumentLayoutRuntime = {
    documentKey,
    draftSessionEpoch,
    instantWorkId,
    liveRoomParam,
    remixId,
    workId,
  };

  return (
    <StudioDocumentLayoutContext value={runtime}>
      {children}
    </StudioDocumentLayoutContext>
  );
}
