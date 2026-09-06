import { describe, expect, it, vi } from "vitest";

import {
  executeStudioCodecProvider,
  negotiateStudioCodecProvider,
  parseStudioCodecExecutionRequest,
  parseStudioCodecProviderManifest,
  STUDIO_CODEC_DEFAULT_PROVIDERS,
  STUDIO_CODEC_OFFICIAL_CLAIM_BOUNDARY,
  type StudioCodecExecutionRequest,
  type StudioCodecProvider,
  type StudioCodecProviderManifest,
  type StudioCodecProviderRawResult,
} from "./studio-codec-provider-contract";
import { sha256HexPortable } from "./studio-sha256";

const NOW = Date.parse("2026-07-30T00:00:00.000Z");

function hash(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${sha256HexPortable(bytes)}`;
}

function manifest(
  overrides: Partial<StudioCodecProviderManifest> = {}
): StudioCodecProviderManifest {
  return {
    schemaVersion: 1,
    providerId: "codec.public.png",
    mode: "public-clean-room",
    format: "png",
    profile: "rgba8",
    version: "1.0",
    encode: true,
    decode: true,
    mimeTypes: ["image/png"],
    extensions: [".png"],
    maxInputBytes: 1024,
    maxOutputBytes: 2048,
    deterministic: true,
    licenseGrant: {
      id: "spdx.mit.codec.public.png",
      scope: [
        "public-clean-room",
        "encode",
        "decode",
        "commercial-use",
      ],
      expiresAt: null,
    },
    officialClaimPolicy: {
      requiresVerifiedExternalAttestation: true,
      maySelfAssertCertification: false,
      maySelfAssertTrademark: false,
    },
    ...overrides,
  };
}

function request(
  overrides: Partial<StudioCodecExecutionRequest> = {}
): StudioCodecExecutionRequest {
  return {
    schemaVersion: 1,
    direction: "encode",
    format: "png",
    profile: "rgba8",
    version: "1.0",
    mimeType: "image/png",
    extension: ".png",
    allowedModes: [
      "public-clean-room",
      "browser-runtime",
      "licensed-sdk",
      "remote-provider",
    ],
    requireDeterministic: true,
    maxInputBytes: 1024,
    maxOutputBytes: 2048,
    ...overrides,
  };
}

function provider(
  manifestValue = manifest(),
  transform: (bytes: Uint8Array) => Uint8Array = bytes =>
    Uint8Array.from([...bytes, 99])
): StudioCodecProvider {
  return {
    manifest: manifestValue,
    execute(execution): StudioCodecProviderRawResult {
      const bytes = transform(execution.inputBytes);
      return {
        schemaVersion: 1,
        providerId: manifestValue.providerId,
        direction: execution.request.direction,
        format: execution.request.format,
        profile: execution.request.profile,
        version: execution.request.version,
        mimeType: execution.request.mimeType,
        extension: execution.request.extension,
        inputSha256: execution.inputSha256,
        outputSha256: hash(bytes),
        bytes,
      };
    },
  };
}

describe("studio codec provider strict schemas", () => {
  it("accepts the exact manifest and request schemas", () => {
    expect(parseStudioCodecProviderManifest(manifest())).not.toBeNull();
    expect(parseStudioCodecExecutionRequest(request())).not.toBeNull();
  });

  it.each([
    ["unknown manifest field", { ...manifest(), future: true }],
    [
      "future manifest version",
      { ...manifest(), schemaVersion: 2 },
    ],
    [
      "missing manifest field",
      (() => {
        const { profile: _profile, ...rest } = manifest();
        return rest;
      })(),
    ],
    [
      "unsafe official claim policy",
      {
        ...manifest(),
        officialClaimPolicy: {
          requiresVerifiedExternalAttestation: false,
          maySelfAssertCertification: true,
          maySelfAssertTrademark: true,
        },
      },
    ],
    [
      "missing direction grant",
      {
        ...manifest(),
        licenseGrant: {
          id: "grant",
          scope: ["public-clean-room"],
          expiresAt: null,
        },
      },
    ],
  ])("fails closed for %s", (_label, value) => {
    expect(parseStudioCodecProviderManifest(value)).toBeNull();
  });

  it.each([
    ["unknown request field", { ...request(), future: true }],
    ["future request version", { ...request(), schemaVersion: 2 }],
    [
      "missing request field",
      (() => {
        const { profile: _profile, ...rest } = request();
        return rest;
      })(),
    ],
    ["non-canonical MIME", { ...request(), mimeType: "image/png; charset=x" }],
    ["non-canonical extension", { ...request(), extension: "PNG" }],
    [
      "duplicate mode",
      {
        ...request(),
        allowedModes: ["public-clean-room", "public-clean-room"],
      },
    ],
  ])("rejects %s", (_label, value) => {
    expect(parseStudioCodecExecutionRequest(value)).toBeNull();
  });

  it("rejects getters, custom prototypes, sparse arrays, and array properties", () => {
    const withGetter = { ...manifest() };
    Object.defineProperty(withGetter, "profile", {
      enumerable: true,
      get: () => "rgba8",
    });
    expect(parseStudioCodecProviderManifest(withGetter)).toBeNull();

    const inherited = Object.assign(Object.create({ unsafe: true }), manifest());
    expect(parseStudioCodecProviderManifest(inherited)).toBeNull();

    const sparse = Array(2) as string[];
    sparse[0] = "public-clean-room";
    expect(
      parseStudioCodecExecutionRequest({
        ...request(),
        allowedModes: sparse,
      })
    ).toBeNull();

    const decorated = ["image/png"];
    Object.assign(decorated, { future: true });
    expect(
      parseStudioCodecProviderManifest({
        ...manifest(),
        mimeTypes: decorated,
      })
    ).toBeNull();
  });
});

describe("studio codec provider negotiation", () => {
  it("ships with an empty trust/provider registry", () => {
    expect(STUDIO_CODEC_DEFAULT_PROVIDERS).toEqual([]);
    expect(Object.isFrozen(STUDIO_CODEC_DEFAULT_PROVIDERS)).toBe(true);
  });

  it("selects only exact direction/profile/version/MIME/extension matches", () => {
    const selected = provider(
      manifest({
        providerId: "codec.match",
        mode: "licensed-sdk",
        licenseGrant: {
          id: "licensed-match",
          scope: ["licensed-sdk", "encode", "decode"],
          expiresAt: null,
        },
      })
    );
    const result = negotiateStudioCodecProvider(
      request({ allowedModes: ["licensed-sdk"] }),
      [
        provider(manifest({ providerId: "codec.wrong-profile", profile: "rgb8" })),
        selected,
      ],
      NOW
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.manifest.providerId).toBe("codec.match");
  });

  it("uses caller mode preference, then stable provider id ordering", () => {
    const result = negotiateStudioCodecProvider(
      request({ allowedModes: ["remote-provider", "public-clean-room"] }),
      [
        provider(
          manifest({
            providerId: "codec.public",
            mode: "public-clean-room",
          })
        ),
        provider(
          manifest({
            providerId: "codec.remote.z",
            mode: "remote-provider",
            licenseGrant: {
              id: "remote-z",
              scope: ["remote-provider", "encode", "decode"],
              expiresAt: null,
            },
          })
        ),
        provider(
          manifest({
            providerId: "codec.remote.a",
            mode: "remote-provider",
            licenseGrant: {
              id: "remote-a",
              scope: ["remote-provider", "encode", "decode"],
              expiresAt: null,
            },
          })
        ),
      ],
      NOW
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.manifest.providerId).toBe("codec.remote.a");
  });

  it("fails closed for expired grants, insufficient budgets, and non-determinism", () => {
    const expired = negotiateStudioCodecProvider(
      request(),
      [
        provider(
          manifest({
            licenseGrant: {
              ...manifest().licenseGrant,
              expiresAt: "2026-07-29T23:59:59.999Z",
            },
          })
        ),
      ],
      NOW
    );
    expect(expired).toMatchObject({ ok: false, code: "license-expired" });

    const budget = negotiateStudioCodecProvider(
      request({ maxOutputBytes: 2048 }),
      [provider(manifest({ maxOutputBytes: 1024 }))],
      NOW
    );
    expect(budget).toMatchObject({ ok: false, code: "no-provider" });

    const deterministic = negotiateStudioCodecProvider(
      request({ requireDeterministic: true }),
      [provider(manifest({ deterministic: false }))],
      NOW
    );
    expect(deterministic).toMatchObject({ ok: false, code: "no-provider" });
  });

  it("rejects invalid providers and duplicate exact provider identities", () => {
    expect(
      negotiateStudioCodecProvider(request(), [
        { manifest: manifest(), execute: "not-a-function" },
      ])
    ).toMatchObject({ ok: false, code: "invalid-provider" });

    expect(
      negotiateStudioCodecProvider(request(), [
        provider({ ...manifest(), future: true } as StudioCodecProviderManifest),
      ])
    ).toMatchObject({ ok: false, code: "invalid-manifest" });

    expect(
      negotiateStudioCodecProvider(request(), [provider(), provider()])
    ).toMatchObject({ ok: false, code: "ambiguous-provider" });
  });
});

describe("studio codec provider execution boundary", () => {
  it("returns independently copied bytes and exact host-computed SHA-256 receipts", async () => {
    const input = Uint8Array.from([1, 2, 3]);
    const result = await executeStudioCodecProvider(
      request(),
      input,
      [provider()],
      NOW
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bytes).toEqual(Uint8Array.from([1, 2, 3, 99]));
    expect(result.bytes).not.toBe(input);
    expect(result.receipt.input).toEqual({
      byteLength: 3,
      sha256: hash(input),
    });
    expect(result.receipt.output).toEqual({
      byteLength: 4,
      sha256: hash(result.bytes),
    });
    expect(result.receipt.officialClaims).toEqual({
      externalAttestationAccepted: false,
      officialCodec: false,
      certified: false,
      trademarkAuthorized: false,
    });
  });

  it("blocks input mutation even when the provider returns matching-looking output", async () => {
    const mutating = provider(manifest(), bytes => {
      bytes[0] = 255;
      return Uint8Array.from([7]);
    });
    const result = await executeStudioCodecProvider(
      request(),
      Uint8Array.from([1, 2, 3]),
      [mutating],
      NOW
    );
    expect(result).toMatchObject({ ok: false, code: "input-mutated" });
  });

  it.each([
    ["MIME", { mimeType: "image/webp" }],
    ["profile", { profile: "rgb8" }],
    ["version", { version: "2.0" }],
    ["extension", { extension: ".webp" }],
    ["provider", { providerId: "codec.impostor" }],
  ])("blocks a wrong %s result envelope", async (_label, override) => {
    const base = provider();
    const wrong: StudioCodecProvider = {
      manifest: base.manifest,
      async execute(execution) {
        const raw = await base.execute(execution);
        return { ...(raw as StudioCodecProviderRawResult), ...override };
      },
    };
    const result = await executeStudioCodecProvider(
      request(),
      Uint8Array.from([1]),
      [wrong],
      NOW
    );
    expect(result).toMatchObject({
      ok: false,
      code: "provider-result-invalid",
    });
  });

  it("blocks mismatched input and output hashes", async () => {
    const base = provider();
    const wrongHash: StudioCodecProvider = {
      manifest: base.manifest,
      async execute(execution) {
        const raw = (await base.execute(
          execution
        )) as StudioCodecProviderRawResult;
        return {
          ...raw,
          outputSha256: `sha256:${"0".repeat(64)}`,
        };
      },
    };
    const result = await executeStudioCodecProvider(
      request(),
      Uint8Array.from([1]),
      [wrongHash],
      NOW
    );
    expect(result).toMatchObject({ ok: false, code: "receipt-mismatch" });
  });

  it("blocks oversized input before callback and oversized output after callback", async () => {
    const execute = vi.fn(provider().execute);
    const guarded = { manifest: manifest(), execute };
    const input = await executeStudioCodecProvider(
      request({ maxInputBytes: 2 }),
      Uint8Array.from([1, 2, 3]),
      [guarded],
      NOW
    );
    expect(input).toMatchObject({
      ok: false,
      code: "input-budget-exceeded",
    });
    expect(execute).not.toHaveBeenCalled();

    const output = await executeStudioCodecProvider(
      request({ maxOutputBytes: 3 }),
      Uint8Array.from([1, 2, 3]),
      [provider()],
      NOW
    );
    expect(output).toMatchObject({
      ok: false,
      code: "output-budget-exceeded",
    });
  });

  it("normalizes thrown values without exposing provider-controlled messages", async () => {
    const throwing: StudioCodecProvider = {
      manifest: manifest(),
      execute: () => {
        throw new Error("secret remote endpoint and token");
      },
    };
    const result = await executeStudioCodecProvider(
      request(),
      Uint8Array.from([1]),
      [throwing],
      NOW
    );
    expect(result).toEqual({
      ok: false,
      code: "provider-runtime-error",
      stage: "execution",
      providerId: "codec.public.png",
      message: "코덱 공급자 실행이 안전하게 완료되지 않았습니다.",
    });
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("never converts provider execution into an official codec or trademark claim", () => {
    expect(STUDIO_CODEC_OFFICIAL_CLAIM_BOUNDARY).toEqual({
      codecExecutionReceiptIsCertification: false,
      codecExecutionReceiptIsTrademarkAuthorization: false,
      externalAttestationVerificationOwnedByThisModule: false,
      officialClaimsWithoutVerifiedExternalAttestation: false,
    });
  });
});
