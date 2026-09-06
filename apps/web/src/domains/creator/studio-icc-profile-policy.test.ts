import { describe, expect, it } from "vitest";

import {
  SRGB_ICC_BUILD_OPTIONS,
  buildMatrixTrcIccProfile,
} from "./render/studio-canvaskit-icc-profile";
import {
  STUDIO_BUNDLED_SRGB_ICC_MANIFEST,
  STUDIO_ICC_MAX_PROFILE_BYTES,
  auditStudioIccProfilePolicy,
  type StudioIccDeclaredCapabilities,
  type StudioIccProfilePolicyRequest,
  type StudioIccProviderManifest,
} from "./studio-icc-profile-policy";

const RGB_CAPABILITIES: StudioIccDeclaredCapabilities = {
  matrixTrcRgb: true,
  trc: true,
  lut: false,
  cmyk: false,
};

const CMYK_LUT_CAPABILITIES: StudioIccDeclaredCapabilities = {
  matrixTrcRgb: false,
  trc: false,
  lut: true,
  cmyk: true,
};

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes));
  return Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}

async function bundledRequest(
  bytes = buildMatrixTrcIccProfile(),
  requestedUse: StudioIccProfilePolicyRequest["requestedUse"] = "transform",
): Promise<StudioIccProfilePolicyRequest> {
  return {
    bytes,
    requestedUse,
    manifest: {
      schemaVersion: 1,
      profileKey: "toonspectrum-srgb-v2",
      source: {
        kind: "bundled",
        providerId: "toonspectrum",
        provenance: "project-generated:studio-canvaskit-icc-profile",
      },
      rights: {
        licenseClass: "project-generated",
        licenseId: "ToonSpectrum-generated-profile-v1",
        redistribution: "allowed",
        embedding: "allowed",
        commercialUse: "allowed",
      },
      expected: {
        sha256: await sha256(bytes),
        versionMajor: 2,
        profileId: null,
        deviceClass: "mntr",
        dataColorSpace: "RGB ",
        pcs: "XYZ ",
        capabilities: RGB_CAPABILITIES,
      },
    },
  };
}

function replaceManifest(
  request: StudioIccProfilePolicyRequest,
  manifest: Partial<StudioIccProviderManifest>,
): StudioIccProfilePolicyRequest {
  return {
    ...request,
    manifest: {
      ...request.manifest,
      ...manifest,
    },
  };
}

function writeAscii(bytes: Uint8Array, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    bytes[offset + index] = value.charCodeAt(index);
  }
}

function buildCmykLutProfile(): Uint8Array {
  const tagData = new Uint8Array(32);
  writeAscii(tagData, 0, "mft2");
  const tagOffset = 144;
  const bytes = new Uint8Array(tagOffset + tagData.byteLength);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, bytes.byteLength);
  view.setUint32(8, 0x02400000);
  writeAscii(bytes, 12, "prtr");
  writeAscii(bytes, 16, "CMYK");
  writeAscii(bytes, 20, "Lab ");
  writeAscii(bytes, 36, "acsp");
  view.setUint32(128, 1);
  writeAscii(bytes, 132, "A2B0");
  view.setUint32(136, tagOffset);
  view.setUint32(140, tagData.byteLength);
  bytes.set(tagData, tagOffset);
  return bytes;
}

async function printerRequest(
  requestedUse: StudioIccProfilePolicyRequest["requestedUse"],
): Promise<StudioIccProfilePolicyRequest> {
  const bytes = buildCmykLutProfile();
  return {
    bytes,
    requestedUse,
    manifest: {
      schemaVersion: 1,
      profileKey: "printer-cmyk-proof",
      source: {
        kind: "printer",
        providerId: "user-selected-printer",
        provenance: "printer-job-ticket:proof-profile",
      },
      rights: {
        licenseClass: "printer-supplied",
        licenseId: "printer-job-profile",
        redistribution: "forbidden",
        embedding: "allowed",
        commercialUse: "allowed",
      },
      expected: {
        sha256: await sha256(bytes),
        versionMajor: 2,
        profileId: null,
        deviceClass: "prtr",
        dataColorSpace: "CMYK",
        pcs: "Lab ",
        capabilities: CMYK_LUT_CAPABILITIES,
      },
    },
  };
}

describe("Studio ICC provider/license policy", () => {
  it("제품 기본 sRGB manifest가 결정적 builder 바이트와 일치하고 embed 승인을 받는다", async () => {
    const bytes = buildMatrixTrcIccProfile();
    const result = await auditStudioIccProfilePolicy({
      bytes,
      requestedUse: "embed",
      manifest: STUDIO_BUNDLED_SRGB_ICC_MANIFEST,
    });

    expect(result.ok).toBe(true);
    expect(await sha256(bytes)).toBe(STUDIO_BUNDLED_SRGB_ICC_MANIFEST.expected.sha256);
    expect(result.receipt.checksum.matched).toBe(true);
  });

  it("project-generated bundled RGB profile을 고정 checksum과 권한으로 승인한다", async () => {
    const request = await bundledRequest();
    const result = await auditStudioIccProfilePolicy(request);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.receipt).toMatchObject({
      schema: "toonspectrum-icc-profile-policy/v1",
      policyVersion: 1,
      verdict: "accepted",
      rejectionCode: null,
      requestedUse: "transform",
      profileKey: "toonspectrum-srgb-v2",
      checksum: {
        algorithm: "SHA-256",
        expected: request.manifest.expected.sha256,
        matched: true,
      },
      header: {
        version: "2.4.0",
        versionMajor: 2,
        profileId: null,
        profileIdVerification: "v2-reserved-zero",
        deviceClass: "mntr",
        dataColorSpace: "RGB ",
        pcs: "XYZ ",
      },
      capabilities: {
        matrixTrcRgb: true,
        trc: true,
        lut: false,
        cmyk: false,
        studioTransform: "rgb-matrix-trc",
      },
      certification: {
        thirdParty: "not-claimed",
      },
    });
  });

  it("같은 bytes와 manifest는 timestamp 없는 동일 영수증을 만든다", async () => {
    const request = await bundledRequest();
    const first = await auditStudioIccProfilePolicy(request);
    const second = await auditStudioIccProfilePolicy(request);
    expect(first.receipt).toEqual(second.receipt);
    expect(JSON.stringify(first.receipt)).not.toMatch(/timestamp|createdAt|Date/u);
  });

  it("임의 commercial/restricted profile은 권한 플래그를 allowed로 위조해도 bundle하지 않는다", async () => {
    const request = await bundledRequest();
    for (const licenseClass of ["commercial", "restricted"] as const) {
      const result = await auditStudioIccProfilePolicy(
        replaceManifest(request, {
          rights: {
            ...request.manifest.rights,
            licenseClass,
            licenseId: `unverified-${licenseClass}`,
          },
        }),
      );
      expect(result).toMatchObject({ ok: false, code: "SOURCE_POLICY_DENIED" });
    }
  });

  it("bundled/public/printer source는 provenance와 고정 SHA-256 없이는 승인하지 않는다", async () => {
    const request = await bundledRequest();
    const noProvenance = await auditStudioIccProfilePolicy(
      replaceManifest(request, {
        source: { ...request.manifest.source, provenance: null },
      }),
    );
    expect(noProvenance).toMatchObject({ ok: false, code: "SOURCE_POLICY_DENIED" });

    const noChecksum = await auditStudioIccProfilePolicy(
      replaceManifest(request, {
        expected: { ...request.manifest.expected, sha256: null },
      }),
    );
    expect(noChecksum).toMatchObject({ ok: false, code: "SOURCE_POLICY_DENIED" });
  });

  it("user-supplied commercial profile은 검사만 가능하고 금지된 embedding은 거절한다", async () => {
    const base = await bundledRequest();
    const userManifest: StudioIccProviderManifest = {
      ...base.manifest,
      source: {
        kind: "user",
        providerId: "local-user-upload",
        provenance: "user-selected-file",
      },
      rights: {
        licenseClass: "commercial",
        licenseId: "user-declared-local-license",
        redistribution: "forbidden",
        embedding: "forbidden",
        commercialUse: "allowed",
      },
      expected: { ...base.manifest.expected, sha256: null },
    };
    const inspect = await auditStudioIccProfilePolicy({
      ...base,
      requestedUse: "inspect",
      manifest: userManifest,
    });
    expect(inspect.ok).toBe(true);

    const embed = await auditStudioIccProfilePolicy({
      ...base,
      requestedUse: "embed",
      manifest: userManifest,
    });
    expect(embed).toMatchObject({ ok: false, code: "RIGHTS_DENIED" });
  });

  it("printer-supplied CMYK LUT는 raw embedding/검사는 허용해도 Studio transform은 거절한다", async () => {
    const embed = await auditStudioIccProfilePolicy(await printerRequest("embed"));
    expect(embed.ok).toBe(true);
    if (embed.ok) {
      expect(embed.receipt.capabilities).toEqual({
        matrixTrcRgb: false,
        trc: false,
        lut: true,
        cmyk: true,
        studioTransform: "inspect-only",
      });
    }

    const transform = await auditStudioIccProfilePolicy(await printerRequest("transform"));
    expect(transform).toMatchObject({ ok: false, code: "CAPABILITY_UNSUPPORTED" });
  });

  it("ICC v4는 non-zero profile ID와 manifest 일치를 요구한다", async () => {
    const bytes = buildMatrixTrcIccProfile({
      ...SRGB_ICC_BUILD_OPTIONS,
      description: "ToonSpectrum v4 test",
    });
    bytes[8] = 4;
    bytes[9] = 0x30;
    const profileIdBytes = Uint8Array.from(
      { length: 16 },
      (_, index) => index + 1,
    );
    bytes.set(profileIdBytes, 84);
    const profileId = Array.from(profileIdBytes, (value) =>
      value.toString(16).padStart(2, "0"),
    ).join("");
    const base = await bundledRequest(bytes);
    const request = replaceManifest(base, {
      source: {
        kind: "user",
        providerId: "local-v4-profile",
        provenance: "user-selected-file",
      },
      rights: {
        licenseClass: "user-authorized",
        licenseId: "user-declared-v4-profile",
        redistribution: "forbidden",
        embedding: "allowed",
        commercialUse: "allowed",
      },
      expected: {
        ...base.manifest.expected,
        sha256: await sha256(bytes),
        versionMajor: 4,
        profileId,
      },
    });

    const result = await auditStudioIccProfilePolicy(request);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.receipt.header).toMatchObject({
        version: "4.3.0",
        profileId,
        profileIdVerification: "header-matched-manifest",
      });
    }

    const mismatch = await auditStudioIccProfilePolicy(
      replaceManifest(request, {
        expected: {
          ...request.manifest.expected,
          profileId: "ff".repeat(16),
        },
      }),
    );
    expect(mismatch).toMatchObject({ ok: false, code: "MANIFEST_MISMATCH" });
  });

  it("allowlist에 없는 bytes를 project-generated로 재라벨링해 bundle할 수 없다", async () => {
    const bytes = buildMatrixTrcIccProfile({
      ...SRGB_ICC_BUILD_OPTIONS,
      description: "Relabelled vendor-like profile",
    });
    const request = await bundledRequest(bytes);
    const result = await auditStudioIccProfilePolicy(
      replaceManifest(request, {
        expected: {
          ...request.manifest.expected,
          sha256: await sha256(bytes),
        },
      }),
    );
    expect(result).toMatchObject({ ok: false, code: "SOURCE_POLICY_DENIED" });
  });

  it("v4 zero profile ID와 v2 non-zero 예약 영역을 각각 fail-closed로 거절한다", async () => {
    const v4 = buildMatrixTrcIccProfile();
    v4[8] = 4;
    v4[9] = 0x30;
    const v4Base = await bundledRequest(v4);
    const missingId = await auditStudioIccProfilePolicy(
      replaceManifest(v4Base, {
        expected: {
          ...v4Base.manifest.expected,
          sha256: await sha256(v4),
          versionMajor: 4,
          profileId: null,
        },
      }),
    );
    expect(missingId).toMatchObject({ ok: false, code: "PROFILE_ID_REQUIRED" });

    const v2 = buildMatrixTrcIccProfile();
    v2.fill(0x11, 84, 100);
    const v2ProfileId = "11".repeat(16);
    const v2Base = await bundledRequest(v2);
    const reservedId = await auditStudioIccProfilePolicy(
      replaceManifest(v2Base, {
        expected: {
          ...v2Base.manifest.expected,
          sha256: await sha256(v2),
          profileId: v2ProfileId,
        },
      }),
    );
    expect(reservedId).toMatchObject({ ok: false, code: "PROFILE_ID_RESERVED" });
  });

  it("unknown/future version과 reserved header bytes/flags를 거절한다", async () => {
    const future = buildMatrixTrcIccProfile();
    future[8] = 5;
    const futureRequest = await bundledRequest(future);
    expect(
      await auditStudioIccProfilePolicy(
        replaceManifest(futureRequest, {
          expected: {
            ...futureRequest.manifest.expected,
            sha256: await sha256(future),
          },
        }),
      ),
    ).toMatchObject({ ok: false, code: "UNSUPPORTED_VERSION" });

    for (const mutate of [
      (bytes: Uint8Array) => {
        bytes[100] = 1;
      },
      (bytes: Uint8Array) => {
        new DataView(bytes.buffer).setUint32(44, 4);
      },
    ]) {
      const bytes = buildMatrixTrcIccProfile();
      mutate(bytes);
      const request = await bundledRequest(bytes);
      const result = await auditStudioIccProfilePolicy(
        replaceManifest(request, {
          expected: {
            ...request.manifest.expected,
            sha256: await sha256(bytes),
          },
        }),
      );
      expect(result).toMatchObject({ ok: false, code: "RESERVED_HEADER" });
    }
  });

  it("등록되지 않은 device class/color space/PCS는 manifest 추측 전에 거절한다", async () => {
    const cases = [
      { offset: 12, signature: "link", code: "UNKNOWN_DEVICE_CLASS" },
      { offset: 16, signature: "2CLR", code: "UNKNOWN_COLOR_SPACE" },
      { offset: 20, signature: "RGB ", code: "UNKNOWN_PCS" },
    ] as const;
    for (const item of cases) {
      const bytes = buildMatrixTrcIccProfile();
      writeAscii(bytes, item.offset, item.signature);
      const request = await bundledRequest(bytes);
      const result = await auditStudioIccProfilePolicy(
        replaceManifest(request, {
          expected: {
            ...request.manifest.expected,
            sha256: await sha256(bytes),
          },
        }),
      );
      expect(result).toMatchObject({ ok: false, code: item.code });
    }
  });

  it("header identity, checksum, capability mismatch를 서로 다른 사유로 보고한다", async () => {
    const request = await bundledRequest();
    expect(
      await auditStudioIccProfilePolicy(
        replaceManifest(request, {
          expected: { ...request.manifest.expected, deviceClass: "scnr" },
        }),
      ),
    ).toMatchObject({ ok: false, code: "MANIFEST_MISMATCH" });

    expect(
      await auditStudioIccProfilePolicy(
        replaceManifest(request, {
          expected: { ...request.manifest.expected, sha256: "00".repeat(32) },
        }),
      ),
    ).toMatchObject({ ok: false, code: "CHECKSUM_MISMATCH" });

    expect(
      await auditStudioIccProfilePolicy(
        replaceManifest(request, {
          expected: {
            ...request.manifest.expected,
            capabilities: { ...RGB_CAPABILITIES, matrixTrcRgb: false },
          },
        }),
      ),
    ).toMatchObject({ ok: false, code: "CAPABILITY_MISMATCH" });
  });

  it("unknown manifest key/enum과 oversized input을 코드 실행 전에 거절한다", async () => {
    const request = await bundledRequest();
    const extraKey = {
      ...request,
      unofficialCertification: true,
    } as unknown as StudioIccProfilePolicyRequest;
    expect(await auditStudioIccProfilePolicy(extraKey)).toMatchObject({
      ok: false,
      code: "INVALID_REQUEST",
    });

    const badPermission = {
      ...request,
      manifest: {
        ...request.manifest,
        rights: {
          ...request.manifest.rights,
          embedding: "unknown",
        },
      },
    } as unknown as StudioIccProfilePolicyRequest;
    expect(await auditStudioIccProfilePolicy(badPermission)).toMatchObject({
      ok: false,
      code: "INVALID_REQUEST",
    });

    const oversized = {
      ...request,
      bytes: new Uint8Array(STUDIO_ICC_MAX_PROFILE_BYTES + 1),
    };
    expect(await auditStudioIccProfilePolicy(oversized)).toMatchObject({
      ok: false,
      code: "INPUT_TOO_LARGE",
    });
  });
});
