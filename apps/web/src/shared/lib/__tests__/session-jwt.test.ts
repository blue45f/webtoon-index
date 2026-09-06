import { createHmac } from "node:crypto";

import { afterEach, describe, it, expect, vi } from "vitest";

import {
  SESSION_HMAC_SECRET_MIN_BYTES,
  SESSION_TOKEN_TTL_MS,
  signSession,
  signStudioLiveAdmissionTicket,
  studioLivePrincipalFingerprint,
  verifySession,
  verifySessionToken,
  verifyStudioLiveAdmissionTicket,
} from "../../../../../../apps/api/src/server/session";
import { STUDIO_LIVE_AUTH_TICKET_TTL_MS } from "../studio-live-auth-ticket";

afterEach(() => {
  vi.unstubAllEnvs();
});

const DEV_FALLBACK_SECRET = "toonspectrum-insecure-dev-session-secret";
function sessionSecret(): string {
  return process.env.AUTH_SESSION_SECRET || process.env.AUTH_STATE_SECRET || DEV_FALLBACK_SECRET;
}

// H6: HMAC 세션 → 서명 JWT 마이그레이션. 신규 토큰은 HS256 JWT, 레거시 v2 HMAC 은 만료 전까지 투명 흡수.
describe("세션 JWT(HS256) 발급/검증", () => {
  it("발급한 JWT 는 header.payload.signature 3분절이고 verify 라운드트립한다", () => {
    const token = signSession("user-123", 5);
    expect(token.split(".")).toHaveLength(3);
    expect(verifySession(token)).toBe("user-123");
    expect(verifySessionToken(token)).toMatchObject({ userId: "user-123", sessionVersion: 5 });
  });

  it("payload 는 sub/sv/iss/aud/iat/exp 를 담는다", () => {
    const token = signSession("user-payload", 3, 1_000_000_000_000);
    const [, body] = token.split(".");
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    expect(payload).toMatchObject({
      sub: "user-payload",
      sv: 3,
      iss: "toonspectrum",
      aud: "toonspectrum-web",
    });
    expect(payload.iat).toBe(1_000_000_000);
    expect(payload.exp).toBe(Math.floor((1_000_000_000_000 + SESSION_TOKEN_TTL_MS) / 1000));
  });

  it("서명 변조 토큰은 거부한다(상수 시간 비교)", () => {
    const token = signSession("user-tamper", 1);
    const [h, p, sig] = token.split(".");
    expect(verifySession(`${h}.${p}.${sig.slice(0, -2)}xy`)).toBeNull();
    // payload 변조 → 서명 불일치
    const forgedPayload = Buffer.from(JSON.stringify({ sub: "attacker", sv: 1, iss: "toonspectrum", aud: "toonspectrum-web", iat: 1, exp: 9_999_999_999 })).toString("base64url");
    expect(verifySession(`${h}.${forgedPayload}.${sig}`)).toBeNull();
  });

  it("iss/aud 불일치 토큰은 (서명이 유효해도) 거부한다(토큰 혼용·재사용 방지)", () => {
    // 올바른 비밀로 '제대로 서명된' 토큰이지만 aud 가 다르면 거부돼야 한다(서명 검증을 통과한 뒤 claim 검증).
    const secret = sessionSecret();
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const body = Buffer.from(JSON.stringify({ sub: "user-aud", sv: 1, iss: "toonspectrum", aud: "someone-else", iat: 1, exp: 9_999_999_999 })).toString("base64url");
    const sig = createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
    expect(verifySession(`${header}.${body}.${sig}`)).toBeNull();

    // iss 가 다른 경우도 동일하게 거부.
    const body2 = Buffer.from(JSON.stringify({ sub: "user-iss", sv: 1, iss: "evil", aud: "toonspectrum-web", iat: 1, exp: 9_999_999_999 })).toString("base64url");
    const sig2 = createHmac("sha256", secret).update(`${header}.${body2}`).digest("base64url");
    expect(verifySession(`${header}.${body2}.${sig2}`)).toBeNull();
  });

  it("만료된 JWT 는 거부한다", () => {
    const token = signSession("user-exp", 1, 0); // iat=0
    expect(verifySessionToken(token, SESSION_TOKEN_TTL_MS - 5_000)).toMatchObject({ userId: "user-exp" });
    expect(verifySessionToken(token, SESSION_TOKEN_TTL_MS + 5_000)).toBeNull();
  });

  it("레거시 평문 id·비-JWT 문자열은 거부한다", () => {
    expect(verifySession("user-123")).toBeNull();
    expect(verifySession("user-123.fake")).toBeNull(); // v1 결정적 토큰
    expect(verifySession("garbage.token.value")).toBeNull(); // 임의 3분절(서명 불일치)
    expect(verifySession(null)).toBeNull();
    expect(verifySession(undefined)).toBeNull();
    expect(verifySession("")).toBeNull();
  });

  it("실시간 어댑터에는 사용자 ID 대신 도메인 분리된 불투명 지문만 제공한다", () => {
    const first = studioLivePrincipalFingerprint("user-123");
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(first).not.toContain("user-123");
    expect(studioLivePrincipalFingerprint("user-123")).toBe(first);
    expect(studioLivePrincipalFingerprint("user-456")).not.toBe(first);
  });
});

describe("Studio 실시간 단기 입장권 경계", () => {
  const now = 1_700_000_000_000;
  const principal = {
    userId: "studio-user",
    sessionVersion: 7,
    expiresAt: now + SESSION_TOKEN_TTL_MS,
  };

  it("1분 이하 입장권만 발급하고 원래 세션 만료 경계를 보존한다", () => {
    const signed = signStudioLiveAdmissionTicket(principal, now);
    expect(signed.expiresAt - signed.issuedAt).toBe(STUDIO_LIVE_AUTH_TICKET_TTL_MS);
    expect(verifyStudioLiveAdmissionTicket(signed.ticket, now)).toEqual(principal);

    const [, body] = signed.ticket.split(".");
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    expect(payload).toMatchObject({
      sub: principal.userId,
      sv: principal.sessionVersion,
      iss: "toonspectrum",
      aud: "toonspectrum-studio-live",
      sexp: Math.floor(principal.expiresAt / 1_000),
    });
    expect(payload.jti).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu,
    );
  });

  it("웹 세션과 Studio 입장권을 서로의 검증 경계에서 재사용하지 못한다", () => {
    const webSession = signSession(principal.userId, principal.sessionVersion, now);
    const admission = signStudioLiveAdmissionTicket(principal, now).ticket;

    expect(verifyStudioLiveAdmissionTicket(webSession, now)).toBeNull();
    expect(verifySessionToken(admission, now)).toBeNull();
  });

  it("입장 창이 지나면 거부하고 원래 세션이 곧 만료되면 수명을 더 줄인다", () => {
    const admission = signStudioLiveAdmissionTicket(principal, now);
    expect(
      verifyStudioLiveAdmissionTicket(
        admission.ticket,
        now + STUDIO_LIVE_AUTH_TICKET_TTL_MS,
      ),
    ).toBeNull();

    const shortPrincipal = { ...principal, expiresAt: now + 10_000 };
    const shortAdmission = signStudioLiveAdmissionTicket(shortPrincipal, now);
    expect(shortAdmission.expiresAt).toBe(shortPrincipal.expiresAt);
    expect(shortAdmission.expiresAt - shortAdmission.issuedAt).toBe(10_000);
  });
});

describe("레거시 v2 HMAC 토큰 투명 흡수(락아웃 방지)", () => {
  // 기존 발급된 v2 토큰("v2.<userId>.<sv>.<exp>.<sig>")이 만료 전까지 그대로 검증돼야
  // HMAC→JWT 전환 중 재로그인 강제(락아웃) 없이 흡수된다.
  function makeV2(userId: string, sv: number, expiresAt: number): string {
    // session.ts 와 동일한 비밀(개발 폴백)·payload·HMAC 으로 v2 토큰을 합성한다.
    const payload = `v2.${userId}.${sv}.${expiresAt}`;
    const sig = createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
    return `${payload}.${sig}`;
  }

  it("유효한 v2 토큰은 여전히 검증된다(실시간·고정시각 모두)", () => {
    const now = 1_700_000_000_000;
    const future = Date.now() + 60_000; // 실시간 verifySession 도 통과하도록 미래 만료
    const token = makeV2("legacy-user", 2, future);
    expect(verifySessionToken(token, now)).toMatchObject({ userId: "legacy-user", sessionVersion: 2 });
    expect(verifySession(token)).toBe("legacy-user");
  });

  it("만료된 v2 토큰은 거부된다", () => {
    const now = 1_700_000_000_000;
    const token = makeV2("legacy-expired", 1, now - 1);
    expect(verifySessionToken(token, now)).toBeNull();
  });

  it("서명이 변조된 v2 토큰은 거부된다", () => {
    const now = 1_700_000_000_000;
    const token = makeV2("legacy-tamper", 1, now + 60_000);
    expect(verifySessionToken(`${token.slice(0, -2)}xy`, now)).toBeNull();
  });
});

describe("운영 세션 HMAC 비밀 경계", () => {
  it("운영에서는 누락·공백 패딩·32바이트 미만 비밀을 거부한다", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_SESSION_SECRET", "");
    vi.stubEnv("AUTH_STATE_SECRET", "");
    expect(() => signSession("missing-secret")).toThrow(
      /must be set in production/u,
    );

    vi.stubEnv("AUTH_SESSION_SECRET", "short-secret");
    expect(() => signSession("weak-secret")).toThrow(
      new RegExp(`${SESSION_HMAC_SECRET_MIN_BYTES} UTF-8 bytes`, "u"),
    );

    vi.stubEnv(
      "AUTH_SESSION_SECRET",
      " production-session-secret-with-at-least-32-bytes ",
    );
    expect(() => signSession("padded-secret")).toThrow(
      /unpadded secret/u,
    );
  });

  it("운영의 공백 없는 32바이트 이상 비밀은 발급·검증한다", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv(
      "AUTH_SESSION_SECRET",
      "production-session-secret-with-at-least-32-bytes",
    );
    vi.stubEnv("AUTH_STATE_SECRET", "");

    const token = signSession("production-user");
    expect(verifySession(token)).toBe("production-user");
  });
});
