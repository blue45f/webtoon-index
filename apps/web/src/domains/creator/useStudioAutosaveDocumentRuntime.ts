import { useEffect, useRef, useState, type MutableRefObject } from "react";

type StudioAutosaveDocumentLease =
  import("./studio-autosave-document-leader").StudioAutosaveDocumentLease;
type StudioAutosaveDocumentLeadershipGuard =
  typeof import("./studio-autosave-opfs-session").withStudioAutosaveDocumentLeadership;
type StudioAutosaveDocumentRole =
  import("./studio-autosave-document-leader").StudioAutosaveDocumentRole;
type StudioAutosaveDocumentLeadershipBasis =
  import("./studio-autosave-document-leader").StudioAutosaveDocumentLeadershipBasis;
export type StudioAutosaveOpfsSession = NonNullable<
  Awaited<ReturnType<typeof import("./studio-autosave-opfs-session").createStudioAutosaveOpfsSession>>
>;
export type StudioAutosaveSqlitePort =
  import("./studio-autosave-sqlite-store").StudioAutosaveSqlitePort;

interface UseStudioAutosaveDocumentRuntimeInput {
  readonly autosaveKey: string;
}

interface StudioAutosaveDocumentLeadership {
  readonly role: StudioAutosaveDocumentRole;
  readonly basis: StudioAutosaveDocumentLeadershipBasis;
}

export interface UseStudioAutosaveDocumentRuntimeResult {
  readonly autosaveDocumentLeadership: StudioAutosaveDocumentLeadership | null;
  readonly autosaveDocumentLeaseRef: MutableRefObject<StudioAutosaveDocumentLease | null>;
  readonly autosaveLeadershipGuardRef: MutableRefObject<StudioAutosaveDocumentLeadershipGuard | null>;
  readonly autosaveOpfsSessionRef: MutableRefObject<Promise<StudioAutosaveOpfsSession | null> | null>;
  readonly autosaveSqliteStoreRef: MutableRefObject<Promise<StudioAutosaveSqlitePort | null> | null>;
}

export function useStudioAutosaveDocumentRuntime({
  autosaveKey,
}: UseStudioAutosaveDocumentRuntimeInput): UseStudioAutosaveDocumentRuntimeResult {
  const autosaveOpfsSessionRef =
    useRef<Promise<StudioAutosaveOpfsSession | null> | null>(null);
  const autosaveSqliteStoreRef =
    useRef<Promise<StudioAutosaveSqlitePort | null> | null>(null);
  const autosaveDocumentLeaseRef = useRef<StudioAutosaveDocumentLease | null>(null);
  const autosaveLeadershipGuardRef =
    useRef<StudioAutosaveDocumentLeadershipGuard | null>(null);
  const [autosaveDocumentLeadership, setAutosaveDocumentLeadership] =
    useState<StudioAutosaveDocumentLeadership | null>(null);

  useEffect(() => {
    const storePromise = import("./studio-autosave-sqlite-store")
      .then(({ acquireStudioAutosaveSqliteStore }) =>
        acquireStudioAutosaveSqliteStore()
      )
      .catch((cause: unknown) => {
        if (import.meta.env.DEV) {
          console.warn("Studio SQLite autosave authority is unavailable.", cause);
        }
        return null;
      });
    autosaveSqliteStoreRef.current = storePromise;
    return () => {
      if (autosaveSqliteStoreRef.current === storePromise) {
        autosaveSqliteStoreRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    const openedPromise = import("./studio-autosave-opfs-session")
      .then((studioAutosaveOpfsSessionModule) => {
        const {
          openStudioAutosaveDocumentSession,
          reopenStudioAutosaveDocumentSessionForLeadership,
          withStudioAutosaveDocumentLeadership,
        } = studioAutosaveOpfsSessionModule;
        if (!disposed) {
          autosaveLeadershipGuardRef.current = withStudioAutosaveDocumentLeadership;
        }
        return Promise.resolve(openStudioAutosaveDocumentSession(autosaveKey)).then((opened) => ({
          opened,
          reopenStudioAutosaveDocumentSessionForLeadership,
        }));
      })
      .then(({
        opened,
        reopenStudioAutosaveDocumentSessionForLeadership,
      }) => {
        if (!disposed) {
          autosaveDocumentLeaseRef.current = opened.lease;
          setAutosaveDocumentLeadership({
            role: opened.lease.role,
            basis: opened.lease.basis,
          });
          if (opened.role === "follower") {
            void opened.lease.waitForLeadership().then(async (promoted) => {
              if (!promoted || disposed) return;
              try {
                const promotedSessionPromise =
                  reopenStudioAutosaveDocumentSessionForLeadership({
                    session: opened.session,
                    autosaveKey,
                  });
                autosaveOpfsSessionRef.current = promotedSessionPromise;
                const promotedSession = await promotedSessionPromise;
                if (
                  disposed
                  || autosaveOpfsSessionRef.current !== promotedSessionPromise
                  || autosaveDocumentLeaseRef.current !== opened.lease
                ) {
                  await promotedSession?.dispose();
                  return;
                }
                setAutosaveDocumentLeadership({
                  role: opened.lease.role,
                  basis: opened.lease.basis,
                });
              } catch (cause: unknown) {
                if (import.meta.env.DEV) {
                  console.warn("Studio OPFS autosave leadership migration failed.", cause);
                }
              }
            });
          }
        }
        return opened;
      })
      .catch((cause: unknown) => {
        if (import.meta.env.DEV) {
          console.warn("Studio OPFS autosave session is unavailable.", cause);
        }
        return null;
      });
    const sessionPromise = openedPromise.then((opened) => opened?.session ?? null);
    autosaveOpfsSessionRef.current = sessionPromise;
    return () => {
      disposed = true;
      const activeSessionPromise = autosaveOpfsSessionRef.current;
      if (autosaveOpfsSessionRef.current === sessionPromise) {
        autosaveOpfsSessionRef.current = null;
      }
      autosaveDocumentLeaseRef.current = null;
      void Promise.all([openedPromise, activeSessionPromise]).then(async ([opened, activeSession]) => {
        if (opened?.session !== activeSession) {
          await opened?.session?.dispose();
        }
        await activeSession?.dispose();
        await opened?.lease.release();
      });
    };
  }, [autosaveKey]);

  return {
    autosaveDocumentLeadership,
    autosaveDocumentLeaseRef,
    autosaveLeadershipGuardRef,
    autosaveOpfsSessionRef,
    autosaveSqliteStoreRef,
  };
}
