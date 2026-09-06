import { useEffect, useRef, useState, type ReactNode } from "react";

import {
  diagnoseStudioCrossOriginIsolationFromGlobals,
  publishStudioCrossOriginIsolationDiagnostic,
  requestStudioCrossOriginIsolationReload,
  type StudioCrossOriginIsolationDiagnostic,
} from "./studio-cross-origin-isolation";

export function StudioCrossOriginIsolationGate({
  pathname,
  documentWasStudio,
  pending,
  children,
}: {
  pathname: string;
  documentWasStudio: boolean;
  pending: ReactNode;
  children: ReactNode;
}) {
  const attemptedPathRef = useRef<string | null>(null);
  const [failedEntry, setFailedEntry] = useState<{
    readonly pathname: string;
    readonly diagnostic: StudioCrossOriginIsolationDiagnostic;
  } | null>(null);
  const detected = diagnoseStudioCrossOriginIsolationFromGlobals(
    pathname,
    globalThis,
    { documentWasStudio },
  );
  const current = failedEntry?.pathname === pathname ? failedEntry.diagnostic : detected;

  useEffect(() => {
    // React Strict Mode can replay effects before a requested document
    // navigation commits. Do not issue the same reload twice in one route.
    if (attemptedPathRef.current === pathname) return;
    attemptedPathRef.current = pathname;
    const result = requestStudioCrossOriginIsolationReload(
      pathname,
      globalThis,
      { documentWasStudio },
    );
    publishStudioCrossOriginIsolationDiagnostic(result.diagnostic);
    if (!result.reloadRequested && (
      result.diagnostic.status === "reload-guard-unavailable"
      || result.diagnostic.status === "reload-failed"
    )) {
      setFailedEntry({ pathname, diagnostic: result.diagnostic });
    } else {
      setFailedEntry(null);
    }
  }, [documentWasStudio, pathname]);

  // An SPA transition must not mount Studio before the isolated document reload. Unsupported
  // environments fail open only after the guarded reload attempt has produced a terminal status.
  if (
    current.status === "reload-required"
    || current.status === "reload-requested"
    || current.status === "public-reload-required"
    || current.status === "public-reload-requested"
    || current.status === "public-reload-attempted"
  ) {
    return pending;
  }
  return children;
}
