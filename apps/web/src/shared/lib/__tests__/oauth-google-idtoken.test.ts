import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// H6: Google GIS ID 토큰 검증. google-auth-library 의 verifyIdToken 을 모킹해
// "우리 client id 를 audience 로 검증" + "정규화 프로필 매핑" + "실패 처리"를 단위 검증한다.
// (handleGoogleIdToken 은 DB upsert 까지 가므로, 여기선 verifyGoogleIdToken/googleClientId 만 검증.)

const verifyIdToken = vi.fn();
const getPayload = vi.fn();
const VALID_ID_TOKEN = "header.payload.signature";

vi.mock("google-auth-library", () => ({
  OAuth2Client: class {
    verifyIdToken = verifyIdToken;
  },
}));

async function freshModule() {
  vi.resetModules();
  return import("../../../../../../apps/api/src/server/oauth");
}

describe("Google GIS ID 토큰 검증(verifyGoogleIdToken)", () => {
  beforeEach(() => {
    verifyIdToken.mockReset();
    getPayload.mockReset();
    verifyIdToken.mockResolvedValue({ getPayload });
    process.env.GOOGLE_OAUTH_CLIENT_ID = "test-client-id.apps.googleusercontent.com";
  });

  afterEach(() => {
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;
  });

  it("우리 client id 를 audience 로 ID 토큰을 검증하고 프로필을 정규화한다", async () => {
    getPayload.mockReturnValue({
      sub: "google-sub-1",
      email: "User@Example.COM",
      name: "테스트 사용자",
      picture: "https://img/avatar.png",
      iss: "https://accounts.google.com",
      email_verified: true,
    });
    const { verifyGoogleIdToken } = await freshModule();

    const profile = await verifyGoogleIdToken(VALID_ID_TOKEN);

    expect(verifyIdToken).toHaveBeenCalledWith({
      idToken: VALID_ID_TOKEN,
      audience: "test-client-id.apps.googleusercontent.com",
    });
    expect(profile).toEqual({
      providerAccountId: "google-sub-1",
      email: "user@example.com", // 소문자 정규화
      emailVerified: true,
      name: "테스트 사용자",
      image: "https://img/avatar.png",
    });
  });

  it("이름이 없으면 given_name 으로, 둘 다 없으면 null 로 폴백한다", async () => {
    getPayload.mockReturnValue({
      sub: "google-sub-2",
      email: "given@example.com",
      email_verified: true,
      given_name: "Given",
      iss: "accounts.google.com",
    });
    const { verifyGoogleIdToken } = await freshModule();
    const profile = await verifyGoogleIdToken(VALID_ID_TOKEN);
    expect(profile.name).toBe("Given");
    expect(profile.email).toBe("given@example.com");
    expect(profile.image).toBeNull();
  });

  it("issuer 가 구글이 아니면 거부한다(방어적 iss 확인)", async () => {
    getPayload.mockReturnValue({
      sub: "google-sub-3",
      email: "artist@example.com",
      email_verified: true,
      iss: "https://evil.example.com",
    });
    const { verifyGoogleIdToken } = await freshModule();
    await expect(verifyGoogleIdToken(VALID_ID_TOKEN)).rejects.toThrow(/issuer/);
  });

  it("payload 에 sub 가 없으면 거부한다", async () => {
    getPayload.mockReturnValue({ iss: "https://accounts.google.com" });
    const { verifyGoogleIdToken } = await freshModule();
    await expect(verifyGoogleIdToken(VALID_ID_TOKEN)).rejects.toThrow(/invalid id_token/);
  });

  it("client id 미설정이면 검증을 거부한다(외부 키 의존 명시)", async () => {
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    const { verifyGoogleIdToken } = await freshModule();
    await expect(verifyGoogleIdToken(VALID_ID_TOKEN)).rejects.toThrow(/client id/);
    expect(verifyIdToken).not.toHaveBeenCalled();
  });

  it("빈 ID 토큰은 거부한다", async () => {
    const { verifyGoogleIdToken } = await freshModule();
    await expect(verifyGoogleIdToken("")).rejects.toThrow(/id_token/);
  });

  it("검증된 이메일이 없는 Google 계정은 기존 이메일 계정 연결 전에 거부한다", async () => {
    getPayload.mockReturnValue({
      sub: "google-sub-unverified",
      email: "artist@example.com",
      email_verified: false,
      iss: "https://accounts.google.com",
    });
    const { verifyGoogleIdToken } = await freshModule();

    await expect(verifyGoogleIdToken(VALID_ID_TOKEN)).rejects.toThrow(/unverified/);
  });

  it("JWT 형태가 아니거나 비정상적으로 큰 토큰은 Google 검증기로 보내지 않는다", async () => {
    const { GOOGLE_ID_TOKEN_MAX_LENGTH, verifyGoogleIdToken } = await freshModule();

    await expect(verifyGoogleIdToken("not-a-jwt")).rejects.toThrow(/format/);
    await expect(
      verifyGoogleIdToken(`a.${"b".repeat(GOOGLE_ID_TOKEN_MAX_LENGTH)}.c`),
    ).rejects.toThrow(/format/);
    expect(verifyIdToken).not.toHaveBeenCalled();
  });
});

describe("Google providerMode/clientId 노출(GIS는 client secret 불필요)", () => {
  afterEach(() => {
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  });

  it("client id 만 있어도 google 은 oauth 모드이고 client id 를 노출한다", async () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = "cid.apps.googleusercontent.com";
    const { providerMode, listAuthProviders, googleClientId } = await freshModule();
    expect(providerMode("google")).toBe("oauth");
    expect(googleClientId()).toBe("cid.apps.googleusercontent.com");
    const list = listAuthProviders();
    expect(list.google.mode).toBe("oauth");
    expect(list.google.clientId).toBe("cid.apps.googleusercontent.com");
    expect(list.google.redirectAvailable).toBe(false);
  });

  it("client id 미설정이면 google 은 안전하게 비활성화되고 client id 를 노출하지 않는다", async () => {
    const { providerMode, listAuthProviders } = await freshModule();
    expect(providerMode("google")).toBe("disabled");
    const list = listAuthProviders();
    expect(list.google.mode).toBe("disabled");
    expect(list.google.reason).toBe("missing-client-id");
    expect(list.google.clientId).toBeUndefined();
    expect(list.google.redirectAvailable).toBe(false);
  });
});
