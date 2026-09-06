import { useEffect, useRef, useState } from "react";

import { signInWithGoogleIdToken } from "@/src/compat/auth-session-store";

declare global {
  interface Window {
    google?: {
      accounts?: {
        id?: {
          initialize: (config: {
            client_id: string;
            callback: (response: { credential?: string }) => void;
            auto_select?: boolean;
            cancel_on_tap_outside?: boolean;
            use_fedcm_for_button?: boolean;
          }) => void;
          renderButton: (
            parent: HTMLElement,
            options: {
              theme?: "outline" | "filled_blue" | "filled_black";
              size?: "large" | "medium" | "small";
              text?: "signin_with" | "signup_with" | "continue_with" | "signin";
              shape?: "rectangular" | "pill" | "circle" | "square";
              width?: number;
            },
          ) => void;
        };
      };
    };
  }
}

const GIS_SRC = "https://accounts.google.com/gsi/client";
const GIS_LOAD_TIMEOUT_MS = 12_000;
let gisLoader: Promise<void> | null = null;
let initializedClientId: string | null = null;
let activeCredentialHandler: ((credential?: string) => void) | null = null;

function loadGoogleIdentityServices(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Google 로그인은 브라우저에서만 사용할 수 있어요."));
  }
  if (window.google?.accounts?.id) return Promise.resolve();
  if (gisLoader) return gisLoader;

  gisLoader = new Promise<void>((resolve, reject) => {
    let settled = false;
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SRC}"]`);
    const script = existing ?? document.createElement("script");

    const cleanup = () => {
      window.clearTimeout(timeout);
      script.removeEventListener("load", onLoad);
      script.removeEventListener("error", onError);
    };
    const fail = () => {
      if (settled) return;
      settled = true;
      cleanup();
      if (!window.google?.accounts?.id) script.remove();
      gisLoader = null;
      reject(new Error("Google 로그인 모듈을 불러오지 못했어요."));
    };
    const onLoad = () => {
      if (!window.google?.accounts?.id) {
        fail();
        return;
      }
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const onError = () => fail();
    const timeout = window.setTimeout(fail, GIS_LOAD_TIMEOUT_MS);

    script.addEventListener("load", onLoad, { once: true });
    script.addEventListener("error", onError, { once: true });
    if (!existing) {
      script.src = GIS_SRC;
      script.async = true;
      script.defer = true;
      script.referrerPolicy = "strict-origin-when-cross-origin";
      document.head.appendChild(script);
    }
  });

  return gisLoader;
}

function initializeGoogleIdentity(clientId: string): void {
  const api = window.google?.accounts?.id;
  if (!api) throw new Error("Google 로그인 모듈이 준비되지 않았어요.");
  if (initializedClientId && initializedClientId !== clientId) {
    throw new Error("Google 로그인 설정이 변경되어 페이지를 새로고침해야 해요.");
  }
  if (initializedClientId === clientId) return;

  api.initialize({
    client_id: clientId,
    auto_select: false,
    cancel_on_tap_outside: true,
    // Studio의 cross-origin isolation에서도 popup opener 의존도를 낮추도록 FedCM 버튼을 우선한다.
    use_fedcm_for_button: true,
    callback: (response) => activeCredentialHandler?.(response.credential),
  });
  initializedClientId = clientId;
}

type GoogleIdentityButtonProps = {
  clientId: string;
  onSuccess: () => void;
  /** Signed-state authorization-code fallback, supplied only from verified discovery. */
  onRedirectFallback?: () => void;
};

type GoogleIdentityState =
  | { status: "loading" | "ready" | "submitting" }
  | {
      status: "error";
      phase: "load" | "signin";
      message: string;
    };

export function GoogleIdentityButton({
  clientId,
  onSuccess,
  onRedirectFallback,
}: GoogleIdentityButtonProps) {
  const holderRef = useRef<HTMLDivElement | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<GoogleIdentityState>({ status: "loading" });

  useEffect(() => {
    let active = true;
    let inFlight = false;
    let lastWidth = 0;
    let observer: ResizeObserver | null = null;
    const requestController = new AbortController();

    setState({ status: "loading" });

    const fail = (phase: "load" | "signin", message: string) => {
      if (!active) return;
      setState({ status: "error", phase, message });
    };

    const handleCredential = async (credential?: string) => {
      if (!active || inFlight) return;
      if (!credential) {
        fail("signin", "Google 로그인 응답이 비어 있어요. 다시 시도해 주세요.");
        return;
      }
      inFlight = true;
      setState({ status: "submitting" });
      const result = await signInWithGoogleIdToken(credential, {
        signal: requestController.signal,
      });
      inFlight = false;
      if (!active) return;
      if (result.ok) {
        onSuccess();
        return;
      }
      fail("signin", result.error);
    };

    const renderButton = () => {
      const holder = holderRef.current;
      const api = window.google?.accounts?.id;
      if (!holder || !api) return;
      const availableWidth = holder.parentElement?.clientWidth ?? 320;
      const width = Math.max(200, Math.min(400, Math.floor(availableWidth)));
      if (width === lastWidth && holder.childElementCount > 0) return;
      lastWidth = width;
      holder.replaceChildren();
      api.renderButton(holder, {
        theme: "outline",
        size: "large",
        width,
        text: "continue_with",
        shape: "rectangular",
      });
    };

    void loadGoogleIdentityServices()
      .then(() => {
        if (!active) return;
        initializeGoogleIdentity(clientId);
        activeCredentialHandler = handleCredential;
        renderButton();
        if (typeof ResizeObserver !== "undefined" && holderRef.current?.parentElement) {
          observer = new ResizeObserver(renderButton);
          observer.observe(holderRef.current.parentElement);
        }
        setState({ status: "ready" });
      })
      .catch((error: unknown) => {
        const message =
          error instanceof Error
            ? error.message
            : "Google 로그인을 불러오지 못했어요. 다시 시도해 주세요.";
        fail("load", message);
      });

    return () => {
      active = false;
      requestController.abort();
      observer?.disconnect();
      if (activeCredentialHandler === handleCredential) activeCredentialHandler = null;
    };
  }, [attempt, clientId, onSuccess]);

  const buttonVisible = state.status === "ready" || state.status === "submitting";

  return (
    <div
      className="relative min-h-11 w-full overflow-hidden rounded-xl"
      aria-busy={state.status === "loading" || state.status === "submitting"}
    >
      <div
        ref={holderRef}
        hidden={!buttonVisible}
        className={state.status === "submitting" ? "pointer-events-none flex justify-center opacity-45" : "flex justify-center"}
      />
      {state.status === "loading" && (
        <div
          className="flex h-11 w-full animate-pulse items-center justify-center rounded-xl border border-line bg-card text-xs text-fg-3"
          role="status"
        >
          Google 로그인 준비 중…
        </div>
      )}
      {state.status === "submitting" && (
        <div
          className="absolute inset-0 flex items-center justify-center rounded-xl bg-card/80 text-xs font-semibold text-fg-2 backdrop-blur-[1px]"
          role="status"
        >
          Google 계정 확인 중…
        </div>
      )}
      {state.status === "error" && (
        <div className="rounded-xl border border-bad/35 bg-bad/5 p-3 text-center">
          <p className="text-xs leading-relaxed text-bad" role="alert">
            {state.message}
          </p>
          <button
            type="button"
            onClick={() => setAttempt((value) => value + 1)}
            className="mt-2 min-h-9 rounded-lg border border-line bg-card px-3 text-xs font-semibold text-fg-2 transition-colors hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
          >
            {state.phase === "load"
              ? "Google 로그인 모듈 다시 불러오기"
              : "Google로 다시 시도"}
          </button>
          {onRedirectFallback && (
            <button
              type="button"
              onClick={onRedirectFallback}
              className="mt-2 block min-h-8 w-full text-xs font-semibold text-fg-2 underline decoration-line-strong underline-offset-4 transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
            >
              다른 방식으로 Google 로그인
            </button>
          )}
        </div>
      )}
    </div>
  );
}
