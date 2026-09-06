import { useEffect, useState } from "react";

import { adminFetch, type AdminApiError, type AdminMe } from "./admin-client";

import { useSession } from "@/src/compat/auth-session-store";

// 관리자 콘솔 진입 게이트 — /admin과 분할 라우트(/admin/community, /admin/members)가 공유한다.
export type AdminGate =
  | { kind: "loading" }
  | { kind: "guest" }
  | { kind: "forbidden" }
  | { kind: "error"; message: string }
  | { kind: "admin"; me: AdminMe };

export function useAdminGate(): { gate: AdminGate; uid: string | undefined } {
  const { data: session, status } = useSession();
  const uid = session?.user?.id;
  const [gate, setGate] = useState<AdminGate>({ kind: "loading" });

  useEffect(() => {
    if (status === "unauthenticated") {
      setGate({ kind: "guest" });
      return;
    }
    if (status !== "authenticated" || !uid) {
      setGate({ kind: "loading" });
      return;
    }
    let alive = true;
    setGate({ kind: "loading" });
    adminFetch<AdminMe>("/me", uid)
      .then((me) => alive && setGate({ kind: "admin", me }))
      .catch((e: AdminApiError) => {
        if (!alive) return;
        if (e.status === 401 || e.status === 403) setGate({ kind: "forbidden" });
        else setGate({ kind: "error", message: e.message });
      });
    return () => {
      alive = false;
    };
  }, [status, uid]);

  return { gate, uid };
}
