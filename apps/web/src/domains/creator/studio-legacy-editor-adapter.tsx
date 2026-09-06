import { Profiler } from "react";

import { recordStudioRenderProfile } from "./canvas/studio-canvas-shared-runtime";
import { StudioCuttoonEditor } from "./StudioPage";

import type { StudioWorkspaceRoute } from "./studio-workspace-route";

export interface LegacyStudioEditorAdapterProps {
  /** Canonical path identity supplied by StudioRouter; never re-read from a query alias. */
  readonly remixId: string | null;
  readonly studioRoute: StudioWorkspaceRoute;
}

/**
 * Temporary adapter around the monolithic editor while feature panels are extracted in parallel.
 * URL parsing, canonical navigation, publish routing, and editor instance ownership live in
 * `studio-router`; this module owns editor behavior only.
 */
export function LegacyStudioEditorAdapter({
  remixId,
  studioRoute,
}: LegacyStudioEditorAdapterProps) {
  return (
    <Profiler id="studio:editor" onRender={recordStudioRenderProfile}>
      <StudioCuttoonEditor remixId={remixId} studioRoute={studioRoute} />
    </Profiler>
  );
}
