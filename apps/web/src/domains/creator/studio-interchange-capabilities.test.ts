import { describe, expect, it } from "vitest";

import { STUDIO_FIRST_PARTY_INK_CODEC_PROVIDERS } from "./studio-first-party-ink-codec-provider";
import { STUDIO_FIRST_PARTY_RASTER_CODEC_PROVIDERS } from "./studio-first-party-raster-codec-provider";
import { STUDIO_FIRST_PARTY_WILL_V1_CODEC_PROVIDER } from "./studio-first-party-will-v1-codec-provider";
import { STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_CODEC_PROVIDER } from "./studio-first-party-will-v1-document-codec-provider";
import {
  STUDIO_INTERCHANGE_CAPABILITIES,
  studioDirectlySupportedInterchangeCapabilities,
  studioInterchangeCapabilitiesForExtension,
  studioInterchangeCapability,
} from "./studio-interchange-capabilities";
import { STUDIO_PRODUCT_CODEC_CERTIFICATION_CLAIMS } from "./studio-product-codec-certification";

describe("Studio interchange capability registry", () => {
  it("id와 extension은 정규화되고 id가 중복되지 않는다", () => {
    const ids = STUDIO_INTERCHANGE_CAPABILITIES.map((capability) => capability.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const capability of STUDIO_INTERCHANGE_CAPABILITIES) {
      expect(capability.id).toMatch(/^[a-z0-9-]+$/u);
      expect(capability.extensions.length).toBeGreaterThan(0);
      expect(capability.extensions.every((extension) => extension.startsWith(".") && extension === extension.toLowerCase())).toBe(true);
      expect(capability.mime.length).toBeGreaterThan(0);
    }
  });

  it("available/engine-ready 상태가 양 방향 모두 unsupported인 모순을 만들지 않는다", () => {
    for (const capability of STUDIO_INTERCHANGE_CAPABILITIES) {
      if (capability.status === "available" || capability.status === "engine-ready") {
        expect(capability.import !== "unsupported" || capability.export !== "unsupported").toBe(true);
      }
      if (capability.roundTrip === "lossless") {
        expect(["available", "engine-ready"]).toContain(capability.import);
        expect(["available", "engine-ready"]).toContain(capability.export);
        expect(capability.lossModel).toEqual([]);
      }
    }
  });

  it("format/container/codec와 구현·UI·metadata·규격·외부 경계를 모든 행에 materialize한다", () => {
    for (const capability of STUDIO_INTERCHANGE_CAPABILITIES) {
      expect(capability.technicalLayers.format.length).toBeGreaterThan(0);
      expect(Array.isArray(capability.technicalLayers.container)).toBe(true);
      expect(Array.isArray(capability.technicalLayers.codec)).toBe(true);
      expect(capability.conformance.thirdPartyCertification).toBe("not-claimed");
      expect(capability.productAssurance.officialThirdPartyCertification).toBe(false);
      expect(capability.productAssurance.vendorTrademarkAuthorization).toBe(false);
      expect(capability.productAssurance.externalEvidenceRequiredForVendorClaims).toBe(true);
      if (capability.productAssurance.firstPartyCodecProvider === "implemented") {
        expect(capability.productAssurance.firstPartyProviderIds.length).toBeGreaterThan(0);
      } else {
        expect(capability.productAssurance.firstPartyProviderIds).toEqual([]);
      }
      if (
        capability.productAssurance.toonSpectrumProductCertification
        !== "not-connected"
      ) {
        expect(capability.productAssurance.firstPartyCodecProvider).toBe("implemented");
      }
      expect(capability.implementation.import).toBeTruthy();
      expect(capability.implementation.export).toBeTruthy();
      expect(capability.uiWiring.import).toBeTruthy();
      expect(capability.uiWiring.export).toBeTruthy();
      expect(capability.metadata.general).toBeTruthy();
      expect(capability.metadata.icc).toBeTruthy();
      expect(capability.externalRequirements.provider).toBeTruthy();
      expect(capability.externalRequirements.license).toBeTruthy();

      if (capability.import === "unsupported") {
        expect(capability.implementation.import).toBe("not-implemented");
        expect(capability.uiWiring.import).toBe("not-applicable");
      }
      if (capability.export === "unsupported") {
        expect(capability.implementation.export).toBe("not-implemented");
        expect(capability.uiWiring.export).toBe("not-applicable");
      }
      if (capability.uiWiring.import === "wired") {
        expect(capability.implementation.import).not.toBe("not-implemented");
      }
      if (capability.uiWiring.export === "wired") {
        expect(capability.implementation.export).not.toBe("not-implemented");
      }
      if (
        capability.externalRequirements.provider === "browser-runtime" ||
        capability.externalRequirements.provider === "bundled-library"
      ) {
        expect(capability.externalRequirements.providers.length).toBeGreaterThan(0);
      }
    }
  });

  it("자체 codec provider와 ToonSpectrum 제품 인증을 외부 공급사 인증과 분리한다", () => {
    const exactByteCertifiedProviders = new Map([
      ["bmp", ["toonspectrum.raster.bmp.v1"]],
      ["tga", ["toonspectrum.raster.tga.v1"]],
      [
        "netpbm",
        ["toonspectrum.raster.ppm.v1", "toonspectrum.raster.pam.v1"],
      ],
      ["qoi", ["toonspectrum.raster.qoi.v1"]],
      ["tiff", ["toonspectrum.raster.tiff.v1"]],
      ["will-v1-path-stream", ["toonspectrum.will-v1-annex-a.v1"]],
      [
        "will-v1-document",
        ["toonspectrum.will-v1-annex-b-document.v1"],
      ],
    ] as const);

    for (const [id, providerIds] of exactByteCertifiedProviders) {
      expect(studioInterchangeCapability(id)?.productAssurance).toEqual(
        expect.objectContaining({
          firstPartyCodecProvider: "implemented",
          firstPartyProviderIds: providerIds,
          toonSpectrumProductCertification: "exact-byte-execution-tested",
          officialThirdPartyCertification: false,
          vendorTrademarkAuthorization: false,
          externalEvidenceRequiredForVendorClaims: true,
        }),
      );
      expect(
        studioInterchangeCapability(id)?.externalRequirements,
      ).toMatchObject({
        provider: "none",
        providers: [],
        license: "project-implementation-only",
      });
    }

    expect(studioInterchangeCapability("toonink")?.productAssurance).toEqual(
      expect.objectContaining({
        firstPartyCodecProvider: "implemented",
        firstPartyProviderIds: ["toonspectrum.ink-envelope.v1"],
        toonSpectrumProductCertification: "exact-byte-execution-tested",
        officialThirdPartyCertification: false,
        vendorTrademarkAuthorization: false,
      }),
    );
    expect(studioInterchangeCapability("inkml")?.productAssurance).toEqual(
      expect.objectContaining({
        firstPartyCodecProvider: "implemented",
        firstPartyProviderIds: ["toonspectrum.public-inkml-subset.v1"],
        toonSpectrumProductCertification: "exact-byte-execution-tested",
        officialThirdPartyCertification: false,
        vendorTrademarkAuthorization: false,
      }),
    );

    const registeredProviderIds = STUDIO_INTERCHANGE_CAPABILITIES.flatMap(
      (capability) => capability.productAssurance.firstPartyProviderIds,
    ).sort();
    const implementedProviderIds = [
      ...STUDIO_FIRST_PARTY_RASTER_CODEC_PROVIDERS,
      ...STUDIO_FIRST_PARTY_INK_CODEC_PROVIDERS,
      STUDIO_FIRST_PARTY_WILL_V1_CODEC_PROVIDER,
      STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_CODEC_PROVIDER,
    ].map((provider) => provider.manifest.providerId).sort();
    expect(registeredProviderIds).toEqual(implementedProviderIds);

    expect(STUDIO_PRODUCT_CODEC_CERTIFICATION_CLAIMS).toMatchObject({
      authority: "ToonSpectrum",
      officialToonSpectrumProductCertification: true,
      thirdPartyCodecCertification: false,
      codecVendorCertification: false,
      officialCodecVendorClaim: false,
      trademarkAuthorization: false,
    });
  });

  it("독점 CLIP/AI를 직접 지원한다고 과장하지 않고 bridge를 제시한다", () => {
    for (const id of ["clip", "ai"]) {
      const capability = studioInterchangeCapability(id)!;
      expect(capability.proprietary).toBe(true);
      expect(capability.import).toBe("unsupported");
      expect(capability.export).toBe("unsupported");
      expect(capability.status).toBe("bridge-only");
      expect(capability.recommendedBridge?.length).toBeGreaterThan(0);
    }
  });

  it("SUT/SUTG는 검증된 Worker 부분 가져오기만 공개하고 공식 호환을 주장하지 않는다", () => {
    for (const id of ["sut", "sutg"]) {
      const capability = studioInterchangeCapability(id)!;
      expect(capability).toMatchObject({
        import: "partial",
        export: "unsupported",
        roundTrip: "none",
        status: "partial",
        proprietary: true,
        implementation: { import: "partial", export: "not-implemented" },
        uiWiring: { import: "wired", export: "not-applicable" },
        conformance: {
          publicSpec: "not-claimed",
          thirdPartyCertification: "not-claimed",
        },
      });
      expect(capability.lossModel.join(" ")).toContain("preserve-only");
      expect(capability.notes.join(" ")).toContain("원본");
      expect(capability.productAssurance.officialThirdPartyCertification).toBe(false);
      expect(capability.productAssurance.vendorTrademarkAuthorization).toBe(false);
    }
    expect(studioInterchangeCapabilitiesForExtension(".sutg").map(({ id }) => id)).toContain("sutg");
  });

  it("PSD는 부분 왕복, PDF/WebM은 출력 전용으로 정직하게 표시한다", () => {
    const psd = studioInterchangeCapability("psd")!;
    expect(psd).toMatchObject({
      import: "partial",
      export: "partial",
      roundTrip: "partial",
    });
    expect(psd.lossModel.join(" ")).toContain("편집 가능한 알파 마스크");
    expect(psd.lossModel.join(" ")).toContain("벡터·이중 마스크");
    expect(psd.lossModel.join(" ")).toContain("페더");
    expect(psd.notes.join(" ")).toContain("무손실 PNG");
    expect(psd.sizeBudget).toMatchObject({
      maxFileBytes: 128 * 1024 * 1024,
      maxDecodedBytes: 128 * 1024 * 1024,
      maxDimensionPx: 30_000,
    });
    expect(psd.notes.join(" ")).toContain("linked-file");
    for (const id of ["pdf", "webm"]) {
      expect(studioInterchangeCapability(id)).toMatchObject({ import: "unsupported", export: "available", roundTrip: "none" });
    }
    const webm = studioInterchangeCapability("webm")!;
    const webmContract = [
      ...webm.lossModel,
      ...webm.runtimeRequirement,
      ...webm.notes,
    ].join(" ");
    expect(webmContract).toContain("작업 전에");
    expect(webmContract).toContain("재시도하지 않습니다");
    expect(webmContract).not.toMatch(/VP9→VP8|폴백/iu);
  });

  it("SVG는 실제 Elements 제품 island의 부분 import와 provider 역할을 정직하게 표시한다", () => {
    const svg = studioInterchangeCapability("svg")!;
    expect(svg).toMatchObject({
      import: "partial",
      export: "available",
      roundTrip: "partial",
      status: "partial",
      implementation: { import: "partial", export: "implemented" },
      uiWiring: { import: "partial", export: "wired" },
      conformance: { publicSpec: "tested-public-subset" },
      externalRequirements: { provider: "bundled-library" },
    });
    expect(svg.uiWiring.notes.join(" ")).toContain("StudioSvgAssetPreview");
    expect(svg.lossModel.join(" ")).toContain("text·image·pattern·mask·filter·marker");
    const svgContract = [
      ...svg.lossModel,
      ...svg.runtimeRequirement,
      ...svg.notes,
      ...svg.implementation.notes,
      ...(svg.recommendedBridge ?? []),
    ].join(" ");
    expect(svgContract).toContain("다른 provider 재시도 없이 fail-closed");
    expect(svgContract).toContain("resvg는 비권위 QA reference");
    expect(svgContract).not.toMatch(/resvg fallback|resvg로 .*우회/iu);
    expect(svg.externalRequirements.providers).toEqual(expect.arrayContaining([
      "vello_svg 0.10",
      "CanvasKit 0.41.1",
      "resvg-wasm",
    ]));
    expect(studioInterchangeCapabilitiesForExtension("svg").map(({ id }) => id)).toContain("svg");
  });

  it("벡터 PDF와 PDF/A-2b·PDF/X-4 후보를 평탄화 PDF와 분리한다", () => {
    expect(studioInterchangeCapability("pdf")).toMatchObject({
      label: "PDF 1.4",
      export: "available",
      uiWiring: { export: "wired" },
    });
    for (const id of ["pdf-vector", "pdf-a-2b", "pdf-x-4"]) {
      expect(studioInterchangeCapability(id)).toMatchObject({
        extensions: [".pdf"],
        import: "unsupported",
        export: "engine-ready",
        status: "engine-ready",
        implementation: {
          import: "not-implemented",
          export: "implemented",
        },
        uiWiring: {
          import: "not-applicable",
          export: "not-wired",
        },
        conformance: {
          publicSpec: "tested-public-subset",
          thirdPartyCertification: "not-claimed",
        },
      });
    }
    expect(
      studioInterchangeCapability("pdf-a-2b")?.notes.join(" "),
    ).toContain("veraPDF");
    expect(
      studioInterchangeCapability("pdf-x-4")?.notes.join(" "),
    ).toContain("인쇄소 승인");
    expect(
      studioInterchangeCapabilitiesForExtension(".pdf").map((item) => item.id),
    ).toEqual(
      expect.arrayContaining(["pdf", "pdf-vector", "pdf-a-2b", "pdf-x-4"]),
    );
  });

  it("ORA와 CBZ import는 실제 UI 계약과 fail-closed ZIP 경계를 공개한다", () => {
    const ora = studioInterchangeCapability("ora")!;
    expect(ora).toMatchObject({
      import: "available",
      export: "available",
      roundTrip: "partial",
      status: "partial",
    });
    expect(ora.lossModel.join(" ")).toContain("단일 그룹");
    expect(ora.notes.join(" ")).toContain("좌표");
    expect(ora.notes.join(" ")).toContain("opacity/visibility");
    expect(ora.runtimeRequirement.join(" ")).toContain("PNG IHDR");

    const cbz = studioInterchangeCapability("cbz")!;
    expect(cbz).toMatchObject({
      import: "available",
      export: "available",
      roundTrip: "none",
      status: "partial",
    });
    expect(cbz.notes.join(" ")).toContain("PNG/JPEG/WebP/GIF");
    expect(cbz.notes.join(" ")).toContain("natural order");
    expect(cbz.notes.join(" ")).toContain("ComicInfo.xml");
    expect(cbz.sizeBudget.maxItems).toBe(200);

    for (const capability of [ora, cbz]) {
      const contract = [...capability.runtimeRequirement, ...capability.notes].join(" ");
      expect(contract).toContain("STORE/DEFLATE");
      expect(contract).toContain("ZIP64");
      expect(contract).toContain("암호화");
      expect(contract).toContain("data descriptor");
      expect(contract).toContain("legacy non-UTF-8");
      expect(contract).toContain("공통 손실 미리보기");
      expect(capability.sizeBudget.notes).toContain("모바일 64MiB/데스크톱 128MiB");
    }
  });

  it("공개 래스터 codec과 1,280px 표시 프록시 손실을 실제 UI 상태로 기록한다", () => {
    for (const id of ["bmp", "tga", "netpbm", "qoi", "tiff"]) {
      const capability = studioInterchangeCapability(id);
      expect(capability).toMatchObject({
        import: "available",
        export: "available",
        roundTrip: "rendered",
        status: "partial",
      });
      expect(capability?.lossModel.join(" ")).toContain("1,280px");
      expect(capability?.runtimeRequirement).toContain("exact Web Worker provider");
      expect(capability?.runtimeRequirement.join(" ")).not.toContain("fallback");
      expect(capability?.sizeBudget.maxFileBytes).toBe(64 * 1024 * 1024);
      expect(capability?.sizeBudget.maxDecodedBytes).toBe(64 * 1024 * 1024);
    }
    expect(studioInterchangeCapabilitiesForExtension(".dib").map((item) => item.id)).toContain("bmp");
    expect(studioInterchangeCapabilitiesForExtension(".pam").map((item) => item.id)).toContain("netpbm");
  });

  it("3D source formats are import-only normalization, not fake round-trip", () => {
    for (const id of ["glb", "gltf", "obj", "fbx", "dae", "stl", "ply", "3ds"]) {
      const capability = studioInterchangeCapability(`3d-${id}`)!;
      expect(capability.import).toBe("available");
      expect(capability.export).toBe("unsupported");
      expect(capability.roundTrip).toBe("none");
      expect(capability.notes.join(" ")).toContain("GLB");
    }
  });

  it("all seven palette codecs are connected to the visible import/export UI", () => {
    for (const id of ["gpl", "ase", "aco", "act", "jasc-pal", "css-palette", "json-palette"]) {
      expect(studioInterchangeCapability(id)).toMatchObject({ import: "available", export: "available", status: "available" });
    }
    expect(studioInterchangeCapability("act")?.sizeBudget.maxItems).toBe(256);
    expect(studioInterchangeCapability("jasc-pal")?.extensions).toEqual([".pal"]);
  });

  it("이미 연결된 대사·연재 운영 포맷을 실제 손실 수준으로 기록한다", () => {
    expect(studioInterchangeCapability("dialogue-json")).toMatchObject({
      import: "available",
      export: "available",
      roundTrip: "lossless",
    });
    for (const id of ["dialogue-table", "dialogue-script-text", "subtitles"]) {
      expect(studioInterchangeCapability(id)).toMatchObject({
        import: "available",
        export: "available",
        roundTrip: "partial",
      });
    }
    expect(studioInterchangeCapability("dialogue-fdx")).toMatchObject({
      import: "available",
      export: "available",
      roundTrip: "partial",
      status: "available",
      sizeBudget: { maxFileBytes: 8 * 1024 * 1024, maxItems: 20_000 },
    });
    expect(studioInterchangeCapabilitiesForExtension(".fdx").map((item) => item.id)).toEqual([
      "dialogue-fdx",
    ]);
    expect(studioInterchangeCapability("release-calendar")).toMatchObject({ import: "unsupported", export: "available" });
    expect(studioInterchangeCapability("publication-analytics-csv")).toMatchObject({ import: "available", export: "unsupported" });
  });

  it("extension lookup accepts dotted/undotted and returns overlapping uses", () => {
    expect(studioInterchangeCapabilitiesForExtension("psd").map((item) => item.id)).toEqual(["psd"]);
    expect(studioInterchangeCapabilitiesForExtension(".png").map((item) => item.id)).toEqual(expect.arrayContaining(["png", "brush-tip-png"]));
    expect(studioInterchangeCapabilitiesForExtension("unknown")).toEqual([]);
  });

  it("direct support filter excludes bridge-only rows and includes only implemented GIF/APNG export", () => {
    const ids = studioDirectlySupportedInterchangeCapabilities().map((capability) => capability.id);
    expect(ids).toContain("toonproject-archive");
    expect(ids).toContain("toonink");
    expect(ids).toContain("inkml");
    expect(ids).toContain("ase");
    expect(ids).toContain("avif");
    expect(ids).not.toContain("clip");
    expect(ids).not.toContain("heic");
    expect(ids).not.toContain("mp4");
    expect(ids).toContain("gif-apng-export");
  });

  it("GIF/APNG 내보내기와 미구현 MP4를 독립 capability로 분리한다", () => {
    const capability = studioInterchangeCapability("gif-apng-export")!;
    expect(capability).toMatchObject({
      import: "unsupported",
      export: "partial",
      roundTrip: "none",
      status: "partial",
      implementation: {
        import: "not-implemented",
        export: "partial",
      },
      uiWiring: {
        import: "not-applicable",
        export: "wired",
      },
    });
    expect(capability.lossModel.join(" ")).toContain("256색");
    expect(capability.lossModel.join(" ")).toContain("1비트 투명");
    expect(capability.runtimeRequirement.join(" ")).toContain("GIF89a");
    expect(capability.runtimeRequirement.join(" ")).toContain("NETSCAPE2.0");
    expect(capability.runtimeRequirement.join(" ")).toContain("acTL/fcTL/fdAT");
    expect(capability.runtimeRequirement.join(" ")).toContain("CRC32");
    expect(capability.notes.join(" ")).toContain("무한 반복");
    expect(capability.sizeBudget.maxItems).toBe(60);
    expect(capability.extensions).not.toContain(".mp4");
    expect(capability.mime).not.toContain("video/mp4");

    expect(studioInterchangeCapability("mp4")).toMatchObject({
      extensions: [".mp4"],
      mime: ["video/mp4"],
      import: "unsupported",
      export: "unsupported",
      status: "bridge-only",
      implementation: {
        import: "not-implemented",
        export: "not-implemented",
      },
      uiWiring: {
        import: "not-applicable",
        export: "not-applicable",
      },
      conformance: {
        publicSpec: "not-claimed",
        thirdPartyCertification: "not-claimed",
      },
      externalRequirements: {
        provider: "not-selected",
        providers: [],
        license: "external-review-required",
      },
    });
    expect(studioInterchangeCapabilitiesForExtension(".mp4").map((item) => item.id)).toEqual([
      "mp4",
    ]);
  });

  it("AVIF browser pipeline과 미구현 HEIC를 같은 지원으로 과장하지 않는다", () => {
    expect(studioInterchangeCapability("avif")).toMatchObject({
      import: "engine-ready",
      export: "unsupported",
      status: "engine-ready",
      technicalLayers: {
        format: ["AVIF"],
        container: ["ISO Base Media File Format / HEIF"],
        codec: ["AV1 image item (browser-provided)"],
      },
      implementation: {
        import: "runtime-dependent",
        export: "not-implemented",
      },
      uiWiring: {
        import: "not-wired",
        export: "not-applicable",
      },
      metadata: {
        general: "discarded",
        icc: "discarded",
      },
      conformance: {
        publicSpec: "runtime-provider-dependent",
        thirdPartyCertification: "not-claimed",
      },
      externalRequirements: {
        provider: "browser-runtime",
        license: "runtime-provider-terms",
      },
    });

    expect(studioInterchangeCapability("heic")).toMatchObject({
      import: "unsupported",
      export: "unsupported",
      status: "bridge-only",
      implementation: {
        import: "not-implemented",
        export: "not-implemented",
      },
      conformance: {
        publicSpec: "not-claimed",
        thirdPartyCertification: "not-claimed",
      },
      externalRequirements: {
        provider: "not-selected",
        license: "external-review-required",
      },
    });
    expect(studioInterchangeCapabilitiesForExtension("heif").map((item) => item.id)).toEqual([
      "heic",
    ]);
  });

  it("ICC 정책 엔진과 InkML 적합성 receipt를 UI 연결 상태와 분리한다", () => {
    expect(studioInterchangeCapability("icc-profile")).toMatchObject({
      extensions: [".icc", ".icm"],
      import: "engine-ready",
      export: "engine-ready",
      status: "engine-ready",
      implementation: {
        import: "implemented",
        export: "implemented",
      },
      uiWiring: {
        import: "not-wired",
        export: "not-wired",
      },
      conformance: {
        publicSpec: "tested-public-subset",
        thirdPartyCertification: "not-claimed",
      },
      externalRequirements: {
        provider: "none",
        license: "project-implementation-only",
      },
    });
    expect(studioInterchangeCapability("icc-profile")?.lossModel.join(" ")).toContain(
      "LUT·CMYK",
    );
    expect(studioInterchangeCapability("icc-profile")?.notes.join(" ")).toContain(
      "고정 SHA-256 allowlist",
    );
    expect(studioInterchangeCapabilitiesForExtension("icm").map((item) => item.id)).toContain(
      "icc-profile",
    );

    const inkml = studioInterchangeCapability("inkml")!;
    expect(inkml.runtimeRequirement.join(" ")).toContain("SHA-256 conformance receipt");
    expect(inkml.notes.join(" ")).toContain("deterministic export");
    expect(inkml.conformance.notes.join(" ")).toContain("Wacom WILL/UIM");
  });

  it("WebM container implementation과 browser codec 제공자를 별도 경계로 기록한다", () => {
    expect(studioInterchangeCapability("webm")).toMatchObject({
      technicalLayers: {
        format: ["WebM video"],
        container: ["Matroska/WebM"],
        codec: ["VP8", "VP9", "AV1 (runtime-dependent WebCodecs path)"],
      },
      implementation: {
        import: "not-implemented",
        export: "runtime-dependent",
      },
      uiWiring: {
        import: "not-applicable",
        export: "wired",
      },
      conformance: {
        publicSpec: "tested-public-subset",
        thirdPartyCertification: "not-claimed",
      },
      externalRequirements: {
        provider: "browser-runtime",
        providers: ["MediaRecorder", "VideoEncoder"],
        license: "runtime-provider-terms",
      },
    });
  });

  it("known hard limits match the audited runtime boundaries", () => {
    expect(studioInterchangeCapability("toonproject-archive")?.sizeBudget.maxFileBytes).toBe(280_000_000);
    expect(studioInterchangeCapability("inkml")).toMatchObject({
      label: "InkML (ToonSpectrum 안전 부분집합)",
      import: "engine-ready",
      export: "engine-ready",
      status: "engine-ready",
      mime: ["application/inkml+xml"],
      sizeBudget: {
        maxFileBytes: 32 * 1024 * 1024,
        maxItems: 2_000_000,
      },
    });
    expect(studioInterchangeCapability("inkml")?.lossModel.join(" ")).toContain(
      "전체 InkML processor conformance를 주장하지 않음",
    );
    expect(studioInterchangeCapability("toonink")).toMatchObject({
      import: "engine-ready",
      export: "engine-ready",
      roundTrip: "lossless",
      status: "engine-ready",
      extensions: [".toonink"],
      mime: ["application/vnd.toonspectrum.ink+json"],
      sizeBudget: {
        maxFileBytes: 32 * 1024 * 1024 + 32 * 1024,
      },
    });
    expect(studioInterchangeCapability("will-v1-path-stream")).toMatchObject({
      import: "engine-ready",
      export: "engine-ready",
      roundTrip: "partial",
      status: "engine-ready",
      extensions: [".willpb"],
      mime: ["application/vnd.willfileformat.path+protobuf"],
      sizeBudget: {
        maxFileBytes: 32 * 1024 * 1024,
        maxItems: 100_000,
      },
    });
    expect(
      studioInterchangeCapability("will-v1-path-stream")?.notes.join(" "),
    ).toContain("전체 .will");
    expect(studioInterchangeCapability("will-v1-document")).toMatchObject({
      import: "available",
      export: "available",
      roundTrip: "partial",
      status: "partial",
      extensions: [".will"],
      mime: ["application/vnd.toonspectrum.will-v1-bounded+zip"],
      sizeBudget: {
        maxFileBytes: 40 * 1024 * 1024,
        maxFiles: 7,
        maxItems: 1_000_000,
      },
      implementation: {
        import: "implemented",
        export: "implemented",
      },
      uiWiring: {
        import: "wired",
        export: "wired",
      },
      conformance: {
        publicSpec: "tested-public-subset",
        thirdPartyCertification: "not-claimed",
      },
    });
    expect(
      studioInterchangeCapability("will-v1-document")?.notes.join(" "),
    ).toContain("Wacom SDK");
    expect(studioInterchangeCapability("abr")?.sizeBudget.maxFileBytes).toBe(32 * 1024 * 1024);
    expect(studioInterchangeCapability("3d-glb")?.sizeBudget.maxFileBytes).toBe(100 * 1024 * 1024);
    expect(studioInterchangeCapability("vrm")?.sizeBudget.maxFileBytes).toBe(128 * 1024 * 1024);
    expect(studioInterchangeCapability("ora")?.sizeBudget).toMatchObject({
      maxFileBytes: 520_000_000,
      maxDecodedBytes: 128 * 1024 * 1024,
      maxDimensionPx: 32_768,
      maxFiles: 516,
      maxItems: 500,
    });
    expect(studioInterchangeCapability("ora")?.sizeBudget.notes).toContain("16,777,216픽셀");
    expect(studioInterchangeCapability("cbz")?.sizeBudget).toMatchObject({
      maxFileBytes: 520_000_000,
      maxDecodedBytes: 512 * 1024 * 1024,
      maxDimensionPx: 131_072,
      maxFiles: 1_163,
      maxItems: 200,
    });
  });
});
