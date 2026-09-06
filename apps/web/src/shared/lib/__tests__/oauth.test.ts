import { afterEach, describe, it, expect, vi } from "vitest";

import {
  buildAuthorizeUrl,
  isAuthorizationCodeFlowConfigured,
  issueState,
  verifyState,
  isOAuthProvider,
  providerMode,
  listAuthProviders,
} from "../../../../../../apps/api/src/server/oauth";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("OAuth signed state (CSRF 방어)", () => {
  it("발급한 state는 같은 provider로 검증 통과", () => {
    const s = issueState("google");
    expect(verifyState("google", s)).toBe(true);
  });

  it("다른 provider로는 검증 실패(혼용 방지)", () => {
    const s = issueState("google");
    expect(verifyState("kakao", s)).toBe(false);
  });

  it("변조된 state는 서명 불일치로 실패", () => {
    const s = issueState("kakao");
    expect(verifyState("kakao", s.slice(0, -2) + "xy")).toBe(false);
    expect(verifyState("kakao", "garbage")).toBe(false);
    expect(verifyState("kakao", undefined)).toBe(false);
  });

  it("TTL 경과 state는 실패", () => {
    const s = issueState("google");
    expect(verifyState("google", s, 0)).toBe(false); // maxAge 0 → 즉시 만료
  });

  it("운영에서는 누락·약함·공백 패딩 state HMAC 비밀을 거부한다", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_STATE_SECRET", "");
    expect(() => issueState("google")).toThrow(
      /AUTH_STATE_SECRET must be set/u,
    );

    vi.stubEnv("AUTH_STATE_SECRET", "short");
    expect(() => issueState("google")).toThrow(/32 UTF-8 bytes/u);

    vi.stubEnv(
      "AUTH_STATE_SECRET",
      " production-state-secret-with-at-least-32-bytes ",
    );
    expect(() => issueState("google")).toThrow(/unpadded secret/u);
  });

  it("운영의 강한 state HMAC 비밀은 인스턴스 독립 검증 계약을 유지한다", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv(
      "AUTH_STATE_SECRET",
      "production-state-secret-with-at-least-32-bytes",
    );

    const state = issueState("google");
    expect(verifyState("google", state)).toBe(true);
  });
});

describe("OAuth provider 유틸", () => {
  it("isOAuthProvider는 google/kakao/naver만 허용하고 폐기된 Toss 인증은 거부", () => {
    expect(isOAuthProvider("google")).toBe(true);
    expect(isOAuthProvider("kakao")).toBe(true);
    expect(isOAuthProvider("naver")).toBe(true);
    expect(isOAuthProvider("toss")).toBe(false);
    expect(isOAuthProvider("")).toBe(false);
  });

  it("구글은 항상 노출하되 키 미설정 시 비활성화하고, 카카오·네이버는 기본 비노출", () => {
    // 카카오·네이버는 데모 모드지만 관리자 토글 기본 off라 목록엔 구글만.
    expect(providerMode("google")).toBe("disabled");
    expect(providerMode("kakao")).toBe("demo");
    expect(providerMode("naver")).toBe("demo");
    const list = listAuthProviders();
    expect(list.google.mode).toBe("disabled");
    expect(list.kakao).toBeUndefined();
    expect(list.naver).toBeUndefined();
    // 관리자에서 켜면 노출(데모)
    const enabled = listAuthProviders({ kakao: true, naver: true });
    expect(enabled.kakao?.mode).toBe("demo");
    expect(enabled.naver?.mode).toBe("demo");
  });

  it("GIS client ID만 있는 Google 구성은 redirect code-flow로 오인하지 않는다", () => {
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", "123-client.apps.googleusercontent.com");
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_SECRET", "");

    expect(providerMode("google")).toBe("oauth");
    expect(isAuthorizationCodeFlowConfigured("google")).toBe(false);
    expect(listAuthProviders().google.redirectAvailable).toBe(false);
    expect(buildAuthorizeUrl("google", "unused-state")).toBeNull();
  });

  it("Google redirect code-flow는 client ID와 secret이 모두 있을 때만 URL을 만든다", () => {
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", "123-client.apps.googleusercontent.com");
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_SECRET", "configured-secret");
    vi.stubEnv("OAUTH_REDIRECT_BASE_URL", "https://www.toonstudio.cloud");

    expect(isAuthorizationCodeFlowConfigured("google")).toBe(true);
    expect(listAuthProviders().google.redirectAvailable).toBe(true);
    const url = new URL(buildAuthorizeUrl("google", "signed-state")!);
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://www.toonstudio.cloud/api/auth/oauth/google/callback",
    );
    expect(url.searchParams.get("state")).toBe("signed-state");
  });
});
