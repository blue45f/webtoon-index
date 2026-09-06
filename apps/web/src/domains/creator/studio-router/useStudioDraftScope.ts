import { useRef } from "react";

import {
  advanceStudioDraftIdentityScope,
  createStudioDraftIdentityScope,
  type StudioDraftIdentityScope,
} from "../studio-editor-scope";

/**
 * Maintains the draft epoch for one canonical route/auth identity. Route components use the epoch
 * as a document-runtime key so switching documents tears down side effects without coupling the
 * pure route resolver to React state.
 */
export function useStudioDraftScope(
  routeKey: string,
  authScopeKey: string | null,
): StudioDraftIdentityScope {
  const scopeRef = useRef(createStudioDraftIdentityScope(routeKey, authScopeKey));
  scopeRef.current = advanceStudioDraftIdentityScope(
    scopeRef.current,
    routeKey,
    authScopeKey,
  );
  return scopeRef.current;
}
