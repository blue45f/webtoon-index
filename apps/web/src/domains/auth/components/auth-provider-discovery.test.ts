import { describe, expect, it } from "vitest";

import { parseAuthProviderDiscovery } from "./auth-provider-discovery";

describe("auth provider discovery", () => {
  it("accepts a configured Google GIS web client", () => {
    expect(
      parseAuthProviderDiscovery({
        google: {
          label: "Google",
          mode: "oauth",
          clientId: " 123-client.apps.googleusercontent.com ",
          redirectAvailable: true,
        },
      }),
    ).toEqual({
      google: {
        label: "Google",
        mode: "oauth",
        clientId: "123-client.apps.googleusercontent.com",
        redirectAvailable: true,
      },
    });
  });

  it.each([
    { mode: "oauth" },
    { mode: "oauth", clientId: "not-a-google-web-client" },
    { mode: "demo", clientId: "123-client.apps.googleusercontent.com" },
  ])("fails closed for malformed or legacy Google discovery: %j", (google) => {
    expect(parseAuthProviderDiscovery({ google })).toEqual({
      google: {
        label: "Google",
        mode: "disabled",
        redirectAvailable: false,
        reason: "invalid-provider-response",
      },
    });
  });

  it("preserves an explicit missing-client-id diagnostic and ignores malformed peers", () => {
    expect(
      parseAuthProviderDiscovery({
        google: { mode: "disabled", reason: "missing-client-id" },
        kakao: { mode: "disabled" },
        naver: { mode: "unexpected" },
      }),
    ).toEqual({
      google: {
        label: "Google",
        mode: "disabled",
        redirectAvailable: false,
        reason: "missing-client-id",
      },
    });
  });

  it("keeps GIS usable but hides redirect fallback unless capability is explicitly true", () => {
    expect(
      parseAuthProviderDiscovery({
        google: {
          label: "Google",
          mode: "oauth",
          clientId: "123-client.apps.googleusercontent.com",
        },
      }),
    ).toEqual({
      google: {
        label: "Google",
        mode: "oauth",
        clientId: "123-client.apps.googleusercontent.com",
        redirectAvailable: false,
      },
    });
  });
});
