import { createContext, useContext } from "react";

/**
 * Document-identity-scoped runtime published by `StudioDocumentLayout`.
 *
 * `StudioDocumentRuntimeContext` (sibling module) answers "which document instance am I?" for the
 * boundary itself. This one answers "what live-session identity does that instance own?" and is the
 * single owner of the `?room=` query for the editor tree — StudioPage no longer parses it.
 */
export interface StudioDocumentLayoutRuntime {
  /** Boundary key of the enclosing `StudioDocumentRuntimeBoundary` (identity + auth + epoch). */
  readonly documentKey: string;
  /** Guest-draft adoption epoch. A bump rotates `documentKey` and remounts this layout. */
  readonly draftSessionEpoch: number;
  /**
   * Per-identity id for an unsaved instant jam. Stable for the life of the boundary, so it survives
   * canvas ↔ comic ↔ animation ↔ dcc surface switches and only rotates with the document identity.
   */
  readonly instantWorkId: string;
  /** `?room=` live-jam identity. The layout is the only reader of this query. */
  readonly liveRoomParam: string | null;
  /** Canonical remix source identity from the route. */
  readonly remixId: string | null;
  /** Canonical saved-work identity from the route. `null` for new drafts and remixes. */
  readonly workId: string | null;
}

export const StudioDocumentLayoutContext =
  createContext<StudioDocumentLayoutRuntime | null>(null);

export function useStudioDocumentLayout(): StudioDocumentLayoutRuntime {
  const runtime = useContext(StudioDocumentLayoutContext);
  if (runtime === null) {
    throw new Error(
      "useStudioDocumentLayout must run inside StudioDocumentLayout.",
    );
  }
  return runtime;
}
