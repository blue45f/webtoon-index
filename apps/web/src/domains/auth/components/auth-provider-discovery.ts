export type AuthProviderMode = "oauth" | "demo" | "disabled";

export type AuthProviderInfo = {
  label: string;
  mode: AuthProviderMode;
  redirectAvailable: boolean;
  clientId?: string;
  reason?: "missing-client-id" | "invalid-provider-response";
};

export type AuthProviderDiscovery = Partial<
  Record<"google" | "kakao" | "naver", AuthProviderInfo>
>;

const PROVIDER_LABELS = {
  google: "Google",
  kakao: "카카오",
  naver: "네이버",
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isProviderMode(value: unknown): value is AuthProviderMode {
  return value === "oauth" || value === "demo" || value === "disabled";
}

export function isGoogleWebClientId(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const normalized = value.trim();
  return (
    normalized.length <= 512
    && /^[A-Za-z0-9][A-Za-z0-9._-]*\.apps\.googleusercontent\.com$/u.test(
      normalized,
    )
  );
}

/**
 * Provider discovery is an untrusted network response. In particular, Google
 * must never fall back to the legacy redirect flow when its GIS client ID is
 * absent or malformed: render a disabled diagnostic instead.
 */
export function parseAuthProviderDiscovery(
  value: unknown,
): AuthProviderDiscovery {
  if (!isRecord(value)) return {};
  const result: AuthProviderDiscovery = {};

  for (const id of ["google", "kakao", "naver"] as const) {
    const raw = value[id];
    if (!isRecord(raw) || !isProviderMode(raw.mode)) continue;
    const label =
      typeof raw.label === "string" && raw.label.trim().length > 0
        ? raw.label.trim().slice(0, 80)
        : PROVIDER_LABELS[id];

    if (id === "google") {
      if (raw.mode === "oauth" && isGoogleWebClientId(raw.clientId)) {
        result.google = {
          label,
          mode: "oauth",
          clientId: raw.clientId.trim(),
          // Rolling deployments and malformed responses default to false. A
          // redirect fallback is actionable only when the server says true.
          redirectAvailable: raw.redirectAvailable === true,
        };
      } else {
        result.google = {
          label,
          mode: "disabled",
          redirectAvailable: false,
          reason:
            raw.mode === "disabled" && raw.reason === "missing-client-id"
              ? "missing-client-id"
              : "invalid-provider-response",
        };
      }
      continue;
    }

    // Disabled non-Google providers are omitted rather than rendered as an
    // actionable redirect button.
    if (raw.mode !== "disabled") {
      result[id] = {
        label,
        mode: raw.mode,
        redirectAvailable: raw.redirectAvailable === true,
      };
    }
  }

  return result;
}
