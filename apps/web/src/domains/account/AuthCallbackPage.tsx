import { Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { Container } from "@/shared/components/section";
import { useT } from "@/shared/lib/i18n";
import { completeOAuthLogin } from "@/src/compat/auth-session-store";
import Link from "@/src/compat/router-link";
import { api, apiPath } from "@/src/infrastructure/api";

type Phase = "working" | "done" | "error";

type OAuthResult = { user?: { id?: string } | null; error?: string } | null;
type OAuthSessionResult = {
  authenticated?: boolean;
  user?: { id?: string } | null;
  error?: string;
} | null;

const ERROR_LABEL_KEYS: Record<string, string> = {
  bad_state: "auth.callback.error.badState",
  no_code: "auth.callback.error.noCode",
  oauth_failed: "auth.callback.error.oauthFailed",
  oauth_unavailable: "auth.callback.error.oauthFailed",
  unsupported: "auth.callback.error.unsupported",
  access_denied: "auth.callback.error.accessDenied",
};

function parseHash(): Record<string, string> {
  const raw = typeof window !== "undefined" ? globalThis.location.hash.replace(/^#/, "") : "";
  return Object.fromEntries(new URLSearchParams(raw));
}

export function AuthCallbackPage() {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>("working");
  const [messageKey, setMessageKey] = useState("auth.callback.message.working");
  const [demo, setDemo] = useState(false);
  const ran = useRef(false); // 콜백 완료 요청은 한 번만 실행 — StrictMode 이중 실행 방지
  const t = useT();

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    const params = parseHash();

    const finish = (
      user: { id?: string } | null | undefined,
      isDemo: boolean
    ) => {
      if (!user?.id) {
        setPhase("error");
        setMessageKey("auth.callback.error.noUser");
        return;
      }
      completeOAuthLogin(user as never);
      setDemo(isDemo);
      setPhase("done");
      setMessageKey(isDemo ? "auth.callback.message.doneDemo" : "auth.callback.message.done");
      globalThis.setTimeout(() => navigate("/", { replace: true }), isDemo ? 1400 : 700);
    };

    async function run() {
      if (params.error) {
        setPhase("error");
        setMessageKey(ERROR_LABEL_KEYS[params.error] ?? "auth.callback.error.generic");
        return;
      }
      try {
        if (params.session === "1") {
          const res = await api.raw(apiPath("/auth/session"), {
            method: "GET",
            cache: "no-store",
            throwHttpErrors: false,
          });
          const data = await res.json<OAuthSessionResult>().catch(() => null);
          if (!res.ok || data?.authenticated !== true || !data.user) {
            throw new Error(data?.error ?? "session-failed");
          }
          finish(data.user, false);
          return;
        }
        if (params.t) {
          const res = await api.raw(apiPath("/auth/oauth/exchange"), {
            method: "POST",
            throwHttpErrors: false,
            json: { token: params.t },
          });
          const data = await res.json<OAuthResult>().catch(() => null);
          if (!res.ok || !data?.user) throw new Error(data?.error ?? "exchange-failed");
          finish(data.user, false);
          return;
        }
        if (params.demo && (params.demo === "google" || params.demo === "kakao" || params.demo === "naver")) {
          const res = await api.raw(apiPath(`/auth/oauth/${params.demo}/demo`), {
            method: "POST",
            throwHttpErrors: false,
          });
          const data = await res.json<OAuthResult>().catch(() => null);
          if (!res.ok || !data?.user) throw new Error(data?.error ?? "demo-failed");
          finish(data.user, true);
          return;
        }
        setPhase("error");
        setMessageKey("auth.callback.error.invalidAccess");
      } catch {
        setPhase("error");
        setMessageKey("auth.callback.error.failed");
      }
    }
    void run();
  }, [navigate]);

  return (
    <Container size="prose" className="py-24">
      <div className="mx-auto flex max-w-sm flex-col items-center gap-4 text-center">
        {phase === "working" && <Loader2 className="size-8 animate-spin text-accent" />}
        {phase === "done" && <CheckCircle2 className="size-8 text-good" />}
        {phase === "error" && <AlertCircle className="size-8 text-bad" />}
        <p className="text-sm font-medium text-fg">{t(messageKey)}</p>
        {demo && (
          <p className="rounded-lg border border-line bg-card px-3 py-2 text-[0.72rem] leading-relaxed text-fg-3">
            {t("auth.callback.demo.message")}
          </p>
        )}
        {phase === "error" && (
          <Link href="/" className="text-xs font-semibold text-accent hover:underline">
            {t("common.backToHome")}
          </Link>
        )}
      </div>
    </Container>
  );
}
