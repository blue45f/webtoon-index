import { useEffect, useRef, useState } from "react";

import {
  loadStudioVrmAvatarReferenceCatalogue,
  type StudioVrmAvatarReferenceCatalogueDiagnosticCode,
  type StudioVrmAvatarReferenceCatalogueLoadOptions,
  type StudioVrmAvatarReferenceCatalogueLoadResult,
} from "./studio-vrm-avatar-reference-catalogue-runtime";

import type { StudioVrmAvatarReferenceCatalogue } from "./studio-vrm-avatar-reference-recommendation";

export type StudioVrmAvatarReferenceCatalogueUiStatus =
  | "idle"
  | "loading"
  | "ready"
  | "unavailable";

export interface StudioVrmAvatarReferenceCatalogueUiSnapshot {
  readonly status: StudioVrmAvatarReferenceCatalogueUiStatus;
  readonly catalogue: StudioVrmAvatarReferenceCatalogue | null;
  readonly catalogueRevision: string | null;
  readonly diagnosticCode: StudioVrmAvatarReferenceCatalogueDiagnosticCode | null;
}

export type StudioVrmAvatarReferenceCatalogueLoader = (
  options?: StudioVrmAvatarReferenceCatalogueLoadOptions,
) => Promise<StudioVrmAvatarReferenceCatalogueLoadResult>;

const IDLE_SNAPSHOT: StudioVrmAvatarReferenceCatalogueUiSnapshot = Object.freeze({
  status: "idle",
  catalogue: null,
  catalogueRevision: null,
  diagnosticCode: null,
});

export function studioVrmAvatarReferenceCatalogueDiagnosticMessage(
  code: StudioVrmAvatarReferenceCatalogueDiagnosticCode | null,
): string {
  if (code === "network" || code === "http" || code === "timeout" || code === "fetch-unavailable") {
    return "추천 기준을 불러오지 못했습니다. 네트워크 상태를 확인한 뒤 다시 시도해 주세요.";
  }
  if (code === "aborted") return "추천 기준 불러오기가 중단되었습니다. 다시 시도해 주세요.";
  return "추천 기준 파일을 안전하게 검증하지 못했습니다. 다시 시도해 주세요.";
}

/**
 * Loads the immutable preset shelf only while the real Forge surface is active.
 *
 * The runtime owns the shared integrity-checked request. This hook owns only a caller-scoped
 * AbortSignal and UI generation fence, so leaving the surface cannot poison another caller or a
 * successful cache. Failed loads remain explicit and retryable instead of falling back to local
 * image heuristics.
 */
export function useStudioVrmAvatarReferenceCatalogue(input: {
  readonly active: boolean;
  readonly load?: StudioVrmAvatarReferenceCatalogueLoader;
}): StudioVrmAvatarReferenceCatalogueUiSnapshot & { readonly retry: () => void } {
  const load = input.load ?? loadStudioVrmAvatarReferenceCatalogue;
  const generationRef = useRef(0);
  const readyRef = useRef<StudioVrmAvatarReferenceCatalogueLoadResult | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [snapshot, setSnapshot] =
    useState<StudioVrmAvatarReferenceCatalogueUiSnapshot>(IDLE_SNAPSHOT);

  useEffect(() => {
    if (!input.active) return;
    const cached = readyRef.current;
    if (cached?.status === "ready") {
      setSnapshot({
        status: "ready",
        catalogue: cached.catalogue,
        catalogueRevision: cached.catalogueRevision,
        diagnosticCode: "ready",
      });
      return;
    }

    const controller = new AbortController();
    generationRef.current += 1;
    const generation = generationRef.current;
    setSnapshot({
      status: "loading",
      catalogue: null,
      catalogueRevision: null,
      diagnosticCode: null,
    });
    void load({ signal: controller.signal }).then((result) => {
      if (controller.signal.aborted || generationRef.current !== generation) return;
      if (result.status === "ready") {
        readyRef.current = result;
        setSnapshot({
          status: "ready",
          catalogue: result.catalogue,
          catalogueRevision: result.catalogueRevision,
          diagnosticCode: "ready",
        });
        return;
      }
      setSnapshot({
        status: "unavailable",
        catalogue: null,
        catalogueRevision: null,
        diagnosticCode: result.diagnostic.code,
      });
    }).catch(() => {
      if (controller.signal.aborted || generationRef.current !== generation) return;
      setSnapshot({
        status: "unavailable",
        catalogue: null,
        catalogueRevision: null,
        diagnosticCode: "network",
      });
    });

    return () => {
      generationRef.current += 1;
      controller.abort();
    };
  }, [attempt, input.active, load]);

  function retry(): void {
    if (!input.active || snapshot.status === "loading" || snapshot.status === "ready") return;
    generationRef.current += 1;
    setSnapshot(IDLE_SNAPSHOT);
    setAttempt((current) => current + 1);
  }

  return { ...snapshot, retry };
}
