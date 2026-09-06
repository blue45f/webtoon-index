import { useCallback, useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";

import { apiPath } from "../../infrastructure/api";

import { withCsrfProtection } from "@/shared/lib/csrf";

const VISITOR_STORAGE_KEY = "toonspectrum-traffic-visitor-v1";
const SESSION_STORAGE_KEY = "toonspectrum-traffic-session-v1";
const HEARTBEAT_INTERVAL_MS = 60_000;
const MIN_HEARTBEAT_SECONDS = 5;

type NavigatorWithPrivacy = Navigator & {
  globalPrivacyControl?: boolean;
};

let lastPageViewSignature = "";
let lastPageViewAt = 0;
let navigationTimingConsumed = false;

function randomIdentifier(): string {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  const bytes = new Uint8Array(24);
  globalThis.crypto?.getRandomValues?.(bytes);
  if (bytes.some((value) => value !== 0)) {
    return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
  }
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}_${Math.random()
    .toString(36)
    .slice(2)}`;
}

function storageIdentifier(storage: Storage, key: string): string {
  try {
    const existing = storage.getItem(key);
    if (existing && /^[A-Za-z0-9_-]{16,128}$/u.test(existing)) return existing;
    const created = randomIdentifier();
    storage.setItem(key, created);
    return created;
  } catch {
    return randomIdentifier();
  }
}

function browserPrivacyOptOut(): boolean {
  const currentNavigator = navigator as NavigatorWithPrivacy;
  return (
    currentNavigator.globalPrivacyControl === true
    || currentNavigator.doNotTrack === "1"
  );
}

function excludedPath(pathname: string): boolean {
  return (
    pathname === "/admin"
    || pathname.startsWith("/admin/")
    || pathname === "/auth/callback"
    || pathname.startsWith("/auth/callback/")
  );
}

function analyticsEnabled(pathname: string): boolean {
  if (!import.meta.env.PROD) return false;
  if (import.meta.env.VITE_TRAFFIC_ANALYTICS_ENABLED === "false") return false;
  if (excludedPath(pathname)) return false;
  return !browserPrivacyOptOut();
}

function navigationLoadTimeMs(): number | null {
  if (navigationTimingConsumed) return null;
  navigationTimingConsumed = true;
  const entry = performance.getEntriesByType("navigation")[0] as
    | PerformanceNavigationTiming
    | undefined;
  if (!entry) return null;
  return Math.max(0, Math.round(entry.duration)) || null;
}

function coarseScreenClass(): string {
  const longest = Math.max(window.screen.width, window.screen.height);
  const shortest = Math.min(window.screen.width, window.screen.height);
  if (shortest <= 0 || longest <= 0) return "unknown";
  if (shortest < 600) return "small";
  if (shortest < 900) return "medium";
  if (longest >= 1_920) return "large";
  return "desktop";
}

function campaign(search: string): {
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
} {
  const params = new URLSearchParams(search);
  const token = (key: string): string | null => {
    const value = params.get(key)?.trim();
    return value ? value.slice(0, 96) : null;
  };
  return {
    utmSource: token("utm_source"),
    utmMedium: token("utm_medium"),
    utmCampaign: token("utm_campaign"),
  };
}

/**
 * Set once the collector answers 5xx or the request fails outright. Analytics must never keep
 * hammering an endpoint that is not there — a preview build without the Nest API would otherwise
 * emit a browser network error on every single navigation.
 */
let trafficEndpointUnavailable = false;

function postTrafficEvent(
  endpoint: "page-view" | "heartbeat",
  body: Record<string, unknown>,
): void {
  const init = withCsrfProtection({
    method: "POST",
    cache: "no-store",
    credentials: "include",
    keepalive: true,
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (trafficEndpointUnavailable) return;
  void fetch(apiPath(`/api/analytics/traffic/${endpoint}`), init)
    .then((response) => {
      // A 5xx means the collector is not there; it will not be there on the next navigation
      // either. Give up for the session rather than re-firing on every route change.
      if (response.status >= 500) trafficEndpointUnavailable = true;
    })
    .catch(() => {
      // Analytics is fail-soft and never blocks navigation or editing.
      trafficEndpointUnavailable = true;
    });
}

function createRuntimeIdentifiers(): {
  visitorId: string;
  sessionId: string;
} {
  return {
    visitorId: storageIdentifier(localStorage, VISITOR_STORAGE_KEY),
    sessionId: storageIdentifier(sessionStorage, SESSION_STORAGE_KEY),
  };
}

export function TrafficAnalyticsBridge() {
  const location = useLocation();
  const currentPathRef = useRef(location.pathname);
  const identifiersRef =
    useRef<ReturnType<typeof createRuntimeIdentifiers> | null>(null);
  const engagedMsRef = useRef(0);
  // `performance.now()` is impure, so it cannot run during render. Start empty and stamp the clock
  // in an effect — the first visible interval begins when the bridge mounts, which is the moment
  // the old initialiser was trying to capture.
  const visibleSinceRef = useRef<number | null>(null);
  useEffect(() => {
    if (visibleSinceRef.current === null && document.visibilityState === "visible") {
      visibleSinceRef.current = performance.now();
    }
  }, []);

  const accumulateVisibleTime = useCallback(() => {
    const visibleSince = visibleSinceRef.current;
    if (visibleSince === null) return;
    const now = performance.now();
    engagedMsRef.current += Math.max(0, now - visibleSince);
    visibleSinceRef.current = now;
  }, []);

  const sendEngagementSnapshot = useCallback((path: string) => {
    if (!analyticsEnabled(path)) return;
    const engagedSeconds = Math.floor(engagedMsRef.current / 1_000);
    if (engagedSeconds < MIN_HEARTBEAT_SECONDS) return;
    identifiersRef.current ??= createRuntimeIdentifiers();
    postTrafficEvent("heartbeat", {
      ...identifiersRef.current,
      path,
      engagedSeconds,
    });
  }, []);

  useEffect(() => {
    const previousPath = currentPathRef.current;
    const previousEnabled = analyticsEnabled(previousPath);
    const nextEnabled = analyticsEnabled(location.pathname);
    if (previousEnabled) accumulateVisibleTime();
    if (previousEnabled && !nextEnabled) {
      sendEngagementSnapshot(previousPath);
    }
    currentPathRef.current = location.pathname;
    visibleSinceRef.current =
      nextEnabled && document.visibilityState === "visible"
        ? performance.now()
        : null;
  }, [accumulateVisibleTime, location.pathname, sendEngagementSnapshot]);

  useEffect(() => {
    if (!analyticsEnabled(location.pathname)) return;

    identifiersRef.current ??= createRuntimeIdentifiers();
    const identifiers = identifiersRef.current;
    const signature = `${location.key}:${location.pathname}:${location.search}`;
    const now = Date.now();
    if (
      signature === lastPageViewSignature
      && now - lastPageViewAt < 2_000
    ) {
      return;
    }
    lastPageViewSignature = signature;
    lastPageViewAt = now;

    const timer = globalThis.setTimeout(() => {
      postTrafficEvent("page-view", {
        ...identifiers,
        path: location.pathname,
        referrer: document.referrer || null,
        screenClass: coarseScreenClass(),
        loadTimeMs: navigationLoadTimeMs(),
        ...campaign(location.search),
      });
    }, 0);

    return () => globalThis.clearTimeout(timer);
  }, [location.key, location.pathname, location.search]);

  useEffect(() => {
    const sendHeartbeat = () => {
      const path = currentPathRef.current;
      if (!analyticsEnabled(path)) return;
      accumulateVisibleTime();
      sendEngagementSnapshot(path);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        visibleSinceRef.current = analyticsEnabled(currentPathRef.current)
          ? performance.now()
          : null;
        return;
      }
      sendHeartbeat();
      visibleSinceRef.current = null;
    };

    const handlePageHide = () => {
      sendHeartbeat();
    };

    const interval = globalThis.setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    globalThis.addEventListener("pagehide", handlePageHide);

    return () => {
      globalThis.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      globalThis.removeEventListener("pagehide", handlePageHide);
      sendHeartbeat();
    };
  }, [accumulateVisibleTime, sendEngagementSnapshot]);

  return null;
}
