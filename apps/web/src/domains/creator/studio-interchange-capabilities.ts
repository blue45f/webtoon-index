/**
 * Audited interchange registry for Studio.
 *
 * `engine-ready` means a tested interchange pipeline exists but a visible menu may still need
 * wiring. A browser-provided codec can still be runtime-gated; `implementation` and
 * `externalRequirements` expose that distinction instead of treating a MIME name as a bundled
 * codec. It is kept separate from `available` so product copy never promises a button that does
 * not exist yet.
 */
export type StudioInterchangeCategory =
  | "3d"
  | "animation"
  | "brush"
  | "document"
  | "palette"
  | "publication"
  | "raster"
  | "vector";

export type StudioInterchangeDirectionSupport =
  | "available"
  | "engine-ready"
  | "partial"
  | "unsupported";

export type StudioInterchangeRoundTrip = "lossless" | "none" | "partial" | "rendered";
export type StudioInterchangeStatus =
  | "available"
  | "bridge-only"
  | "engine-ready"
  | "partial"
  | "planned"
  | "unsupported";

export type StudioInterchangeImplementationStatus =
  | "implemented"
  | "not-implemented"
  | "partial"
  | "runtime-dependent";

export type StudioInterchangeUiWiring =
  | "not-applicable"
  | "not-wired"
  | "partial"
  | "wired";

export type StudioInterchangeMetadataPreservation =
  | "discarded"
  | "not-applicable"
  | "not-audited"
  | "partial"
  | "preserved";

export type StudioInterchangePublicSpecConformance =
  | "not-claimed"
  | "project-profile-tested"
  | "runtime-provider-dependent"
  | "tested-public-subset";

export type StudioInterchangeExternalProviderBoundary =
  | "browser-runtime"
  | "bundled-library"
  | "none"
  | "not-audited"
  | "not-selected";

export type StudioInterchangeExternalLicenseBoundary =
  | "bundled-dependency-terms"
  | "external-review-required"
  | "not-audited"
  | "project-implementation-only"
  | "runtime-provider-terms";

export interface StudioInterchangeTechnicalLayers {
  /** 사용자가 파일명/메뉴에서 보는 교환 규격 또는 application profile. */
  readonly format: readonly string[];
  /** 파일을 감싸는 container. 단일 이미지/텍스트 규격처럼 별도 container가 없으면 빈 배열. */
  readonly container: readonly string[];
  /** 압축·영상·오디오 codec. codec이 없거나 아직 선택하지 않았으면 빈 배열. */
  readonly codec: readonly string[];
}

export interface StudioInterchangeImplementation {
  readonly import: StudioInterchangeImplementationStatus;
  readonly export: StudioInterchangeImplementationStatus;
  readonly notes: readonly string[];
}

export interface StudioInterchangeUiAvailability {
  readonly import: StudioInterchangeUiWiring;
  readonly export: StudioInterchangeUiWiring;
  readonly notes: readonly string[];
}

export interface StudioInterchangeMetadataPolicy {
  readonly general: StudioInterchangeMetadataPreservation;
  readonly icc: StudioInterchangeMetadataPreservation;
  readonly notes: readonly string[];
}

export interface StudioInterchangeConformance {
  readonly publicSpec: StudioInterchangePublicSpecConformance;
  /**
   * ToonSpectrum 자체 테스트/서명은 여기에 제3자 인증으로 기록하지 않는다. 인증 기관 또는
   * 권리자가 실제로 발급한 근거가 생기기 전까지 항상 `not-claimed`다.
   */
  readonly thirdPartyCertification: "not-claimed";
  readonly notes: readonly string[];
}

export type StudioInterchangeFirstPartyCodecProviderStatus =
  | "implemented"
  | "not-claimed";

export type StudioInterchangeProductCertificationStatus =
  | "exact-byte-execution-tested"
  | "not-connected"
  | "provider-receipt-bindable";

/**
 * Separates product-owned implementation evidence from claims that only an external rights
 * holder, standards body, or codec vendor can issue.
 */
export interface StudioInterchangeProductAssurance {
  readonly firstPartyCodecProvider: StudioInterchangeFirstPartyCodecProviderStatus;
  readonly firstPartyProviderIds: readonly string[];
  readonly toonSpectrumProductCertification: StudioInterchangeProductCertificationStatus;
  readonly officialThirdPartyCertification: false;
  readonly vendorTrademarkAuthorization: false;
  readonly externalEvidenceRequiredForVendorClaims: true;
  readonly notes: readonly string[];
}

export interface StudioInterchangeExternalRequirements {
  readonly provider: StudioInterchangeExternalProviderBoundary;
  readonly providers: readonly string[];
  readonly license: StudioInterchangeExternalLicenseBoundary;
  readonly notes: readonly string[];
}

export interface StudioInterchangeSizeBudget {
  readonly maxBatchBytes?: number;
  readonly maxDecodedBytes?: number;
  readonly maxDimensionPx?: number;
  readonly maxFileBytes?: number;
  readonly maxFiles?: number;
  readonly maxItems?: number;
  readonly notes?: string;
}

export interface StudioInterchangeCapability {
  readonly id: string;
  readonly label: string;
  readonly extensions: readonly string[];
  readonly mime: readonly string[];
  readonly category: StudioInterchangeCategory;
  readonly import: StudioInterchangeDirectionSupport;
  readonly export: StudioInterchangeDirectionSupport;
  readonly roundTrip: StudioInterchangeRoundTrip;
  readonly lossModel: readonly string[];
  readonly runtimeRequirement: readonly string[];
  readonly sizeBudget: StudioInterchangeSizeBudget;
  readonly status: StudioInterchangeStatus;
  readonly notes: readonly string[];
  readonly technicalLayers: StudioInterchangeTechnicalLayers;
  readonly implementation: StudioInterchangeImplementation;
  readonly uiWiring: StudioInterchangeUiAvailability;
  readonly metadata: StudioInterchangeMetadataPolicy;
  readonly conformance: StudioInterchangeConformance;
  readonly productAssurance: StudioInterchangeProductAssurance;
  readonly externalRequirements: StudioInterchangeExternalRequirements;
  readonly recommendedBridge?: readonly string[];
  readonly proprietary?: boolean;
}

const MiB = 1024 * 1024;

type StudioInterchangeCapabilityDefinition =
  Omit<
    StudioInterchangeCapability,
    | "conformance"
    | "externalRequirements"
    | "implementation"
    | "metadata"
    | "productAssurance"
    | "technicalLayers"
    | "uiWiring"
  > &
  Partial<
    Pick<
      StudioInterchangeCapability,
      | "conformance"
      | "externalRequirements"
      | "implementation"
      | "metadata"
      | "productAssurance"
      | "technicalLayers"
      | "uiWiring"
    >
  >;

const STUDIO_INTERCHANGE_CAPABILITY_DEFINITIONS: readonly StudioInterchangeCapabilityDefinition[] = [
  {
    id: "toonproject-archive",
    label: "ToonSpectrum 프로젝트 아카이브",
    extensions: [".toonproject.zip"],
    mime: ["application/vnd.toonspectrum.project+zip"],
    category: "document",
    import: "available",
    export: "available",
    roundTrip: "lossless",
    lossModel: [],
    runtimeRequirement: ["Web Crypto SHA-256", "Blob", "UTF-8 ZIP32 store subset"],
    sizeBudget: { maxFileBytes: 280_000_000, maxDecodedBytes: 256_000_000, maxFiles: 514 },
    status: "available",
    notes: [
      "프로젝트 JSON과 래스터·마스크·참고 이미지·VRM/GLB·오디오를 해시 기반으로 묶습니다.",
      "현재 writer가 만든 비압축 deterministic ZIP subset만 가져오며 일반 ZIP은 받지 않습니다.",
    ],
  },
  {
    id: "toonproject-json",
    label: "ToonSpectrum 프로젝트 JSON",
    extensions: [".json"],
    mime: ["application/json"],
    category: "document",
    import: "available",
    export: "available",
    roundTrip: "partial",
    lossModel: ["외부 URL/IndexedDB 원본 자산은 JSON 한 파일에 포함되지 않을 수 있음"],
    runtimeRequirement: ["UTF-8", "JSON"],
    sizeBudget: { maxFileBytes: 16 * MiB },
    status: "partial",
    notes: ["가벼운 백업용입니다. 다른 기기로 이동할 때는 프로젝트 아카이브가 우선입니다."],
    recommendedBridge: ["완전한 이동에는 .toonproject.zip 사용"],
  },
  {
    id: "png",
    label: "PNG",
    extensions: [".png"],
    mime: ["image/png"],
    category: "raster",
    import: "available",
    export: "available",
    roundTrip: "rendered",
    lossModel: ["레이어·벡터·텍스트 편집성은 평탄화됨", "ICC/광색역 메타데이터는 보존하지 않음"],
    runtimeRequirement: ["Canvas 2D", "브라우저 PNG decoder/encoder"],
    sizeBudget: { maxFileBytes: 12 * MiB, maxBatchBytes: 48 * MiB, maxDimensionPx: 16_384 },
    status: "available",
    notes: ["투명 배경과 무손실 픽셀을 지원하며 참고 이미지·펜촉에도 사용합니다."],
  },
  {
    id: "jpeg",
    label: "JPEG",
    extensions: [".jpg", ".jpeg"],
    mime: ["image/jpeg"],
    category: "raster",
    import: "available",
    export: "available",
    roundTrip: "rendered",
    lossModel: ["손실 압축", "알파 제거", "레이어·벡터·텍스트 편집성 평탄화"],
    runtimeRequirement: ["Canvas 2D", "브라우저 JPEG decoder/encoder"],
    sizeBudget: { maxFileBytes: 12 * MiB, maxBatchBytes: 48 * MiB, maxDimensionPx: 16_384 },
    status: "available",
    notes: ["내보내기 기본 품질은 0.92입니다."],
  },
  {
    id: "webp",
    label: "WebP",
    extensions: [".webp"],
    mime: ["image/webp"],
    category: "raster",
    import: "available",
    export: "available",
    roundTrip: "rendered",
    lossModel: ["내보내기 설정에 따른 손실 압축", "레이어·벡터·텍스트 편집성 평탄화"],
    runtimeRequirement: ["Canvas 2D", "브라우저 WebP decoder/encoder"],
    sizeBudget: { maxFileBytes: 12 * MiB, maxBatchBytes: 48 * MiB, maxDimensionPx: 16_384 },
    status: "available",
    notes: ["정적 WebP를 안전 검사하며 내보내기 기본 품질은 0.92입니다."],
  },
  {
    id: "avif",
    label: "AVIF",
    extensions: [".avif"],
    mime: ["image/avif"],
    category: "raster",
    import: "engine-ready",
    export: "unsupported",
    roundTrip: "none",
    lossModel: [
      "ImageDecoder가 제공하는 픽셀·프레임 시간만 materialize하며 원본 ISOBMFF item 구조와 metadata는 보존하지 않음",
      "브라우저별 ImageDecoder AVIF 지원 여부가 달라 지원되지 않는 런타임에서는 사용할 수 없음",
    ],
    runtimeRequirement: ["ImageDecoder", "브라우저 AV1/AVIF decoder", "OffscreenCanvas materializer"],
    sizeBudget: { maxItems: 120, notes: "generic frame decode orchestrator의 기본 프레임 상한" },
    status: "engine-ready",
    notes: [
      "프레임 디코드 orchestration과 예산 테스트는 있으나 Studio 가져오기 메뉴에는 연결되지 않았습니다.",
      "ToonSpectrum이 AV1 decoder를 번들하거나 AVIF 규격 적합성을 인증했다는 뜻이 아닙니다.",
    ],
    recommendedBridge: ["현재 사용자 작업 흐름에서는 PNG 또는 WebP로 변환 후 가져오기"],
    technicalLayers: {
      format: ["AVIF"],
      container: ["ISO Base Media File Format / HEIF"],
      codec: ["AV1 image item (browser-provided)"],
    },
    implementation: {
      import: "runtime-dependent",
      export: "not-implemented",
      notes: ["generic ImageDecoder pipeline only; bundled AV1 decoder 없음"],
    },
    uiWiring: {
      import: "not-wired",
      export: "not-applicable",
      notes: ["범용 Studio 파일 가져오기/내보내기 UI에는 노출하지 않음"],
    },
    metadata: {
      general: "discarded",
      icc: "discarded",
      notes: ["materialized frame pixel과 duration 외 AVIF item/property metadata는 전달하지 않음"],
    },
    conformance: {
      publicSpec: "runtime-provider-dependent",
      thirdPartyCertification: "not-claimed",
      notes: ["브라우저 decoder 결과를 소비하며 독립 AVIF conformance를 주장하지 않음"],
    },
    externalRequirements: {
      provider: "browser-runtime",
      providers: ["ImageDecoder implementation"],
      license: "runtime-provider-terms",
      notes: ["AV1 decode 구현·배포 조건은 선택한 브라우저/runtime 제공자 경계에 있음"],
    },
  },
  {
    id: "heic",
    label: "HEIC / HEIF (HEVC image)",
    extensions: [".heic", ".heif"],
    mime: ["image/heic", "image/heif"],
    category: "raster",
    import: "unsupported",
    export: "unsupported",
    roundTrip: "none",
    lossModel: ["decoder·encoder·metadata bridge를 구현하지 않음"],
    runtimeRequirement: [],
    sizeBudget: {},
    status: "bridge-only",
    notes: [
      "MIME/확장자를 인식 가능한 후보로 기록할 뿐 codec 지원으로 표시하지 않습니다.",
      "HEVC codec 배포·특허·라이선스 조건을 검토하고 provider를 선택하기 전에는 제품 codec으로 활성화하지 않습니다.",
    ],
    recommendedBridge: ["PNG, JPEG 또는 AVIF로 외부 변환"],
    technicalLayers: {
      format: ["HEIC / HEIF image profile"],
      container: ["ISO Base Media File Format / HEIF"],
      codec: ["HEVC image item (not implemented)"],
    },
    implementation: {
      import: "not-implemented",
      export: "not-implemented",
      notes: ["container parser와 HEVC codec 모두 제품에 없음"],
    },
    uiWiring: {
      import: "not-applicable",
      export: "not-applicable",
      notes: ["지원 메뉴 없음"],
    },
    metadata: {
      general: "not-applicable",
      icc: "not-applicable",
      notes: ["미구현이므로 보존을 주장하지 않음"],
    },
    conformance: {
      publicSpec: "not-claimed",
      thirdPartyCertification: "not-claimed",
      notes: ["HEIF/HEVC 적합성 또는 상표 인증을 주장하지 않음"],
    },
    externalRequirements: {
      provider: "not-selected",
      providers: [],
      license: "external-review-required",
      notes: ["향후 HEVC codec을 배포하려면 선택 구현과 사용 지역에 맞는 별도 권리 검토가 필요"],
    },
  },
  ...([
    {
      id: "bmp",
      label: "BMP / DIB",
      extensions: [".bmp", ".dib"],
      mime: ["image/bmp", "image/x-ms-bmp"],
      category: "raster",
      import: "available",
      export: "available",
      roundTrip: "rendered",
      lossModel: ["가져오기는 장변 1,280px WebP quality 0.85 표시 프록시로 변환", "24-bit 출력은 알파를 흰색 배경에 합성"],
      runtimeRequirement: ["exact Web Worker provider", "Canvas 2D insertion bridge"],
      sizeBudget: { maxFileBytes: 64 * MiB, maxDecodedBytes: 64 * MiB, maxDimensionPx: 32_768 },
      status: "partial",
      notes: ["압축되지 않은 24/32-bit RGB BMP를 가져오고 24-bit BMP를 내보냅니다."],
    },
    {
      id: "tga",
      label: "TGA true-color",
      extensions: [".tga", ".icb", ".vda", ".vst"],
      mime: ["image/x-tga", "image/x-targa"],
      category: "raster",
      import: "available",
      export: "available",
      roundTrip: "rendered",
      lossModel: ["가져오기는 장변 1,280px WebP quality 0.85 표시 프록시로 변환", "색상표·RLE 등 TGA 변형은 지원하지 않음"],
      runtimeRequirement: ["exact Web Worker provider", "Canvas 2D insertion bridge"],
      sizeBudget: { maxFileBytes: 64 * MiB, maxDecodedBytes: 64 * MiB, maxDimensionPx: 32_768 },
      status: "partial",
      notes: ["압축되지 않은 24/32-bit true-color TGA를 교환합니다."],
    },
    {
      id: "netpbm",
      label: "Netpbm PPM / PAM",
      extensions: [".ppm", ".pam"],
      mime: ["image/x-portable-pixmap", "image/x-portable-arbitrarymap"],
      category: "raster",
      import: "available",
      export: "available",
      roundTrip: "rendered",
      lossModel: ["가져오기는 장변 1,280px WebP quality 0.85 표시 프록시로 변환", "PPM은 알파를 흰색 배경에 합성"],
      runtimeRequirement: ["exact Web Worker provider", "Canvas 2D insertion bridge"],
      sizeBudget: { maxFileBytes: 64 * MiB, maxDecodedBytes: 64 * MiB, maxDimensionPx: 32_768 },
      status: "partial",
      notes: ["8-bit binary P6 PPM과 P7 RGB/RGBA PAM 범위를 교환합니다."],
    },
    {
      id: "qoi",
      label: "Quite OK Image",
      extensions: [".qoi"],
      mime: ["image/qoi"],
      category: "raster",
      import: "available",
      export: "available",
      roundTrip: "rendered",
      lossModel: ["가져오기는 장변 1,280px WebP quality 0.85 표시 프록시로 변환", "원본 colorspace metadata는 보존하지 않음"],
      runtimeRequirement: ["exact Web Worker provider", "Canvas 2D insertion bridge"],
      sizeBudget: { maxFileBytes: 64 * MiB, maxDecodedBytes: 64 * MiB, maxDimensionPx: 32_768 },
      status: "partial",
      notes: ["QOI 3/4-channel sRGB 계열을 교환합니다."],
    },
  ] satisfies readonly StudioInterchangeCapabilityDefinition[]),
  {
    id: "tiff",
    label: "TIFF 6.0 baseline",
    extensions: [".tif", ".tiff"],
    mime: ["image/tiff", "image/x-tiff"],
    category: "raster",
    import: "available",
    export: "available",
    roundTrip: "rendered",
    lossModel: ["가져오기는 장변 1,280px WebP quality 0.85 표시 프록시로 변환", "무압축 8-bit RGB/RGBA baseline 범위", "ICC·광색역·임의 TIFF metadata는 보존하지 않음"],
    runtimeRequirement: ["exact Web Worker provider", "baseline TIFF codec", "Canvas 2D insertion bridge"],
    sizeBudget: { maxFileBytes: 64 * MiB, maxDimensionPx: 32_768, maxDecodedBytes: 64 * MiB },
    status: "partial",
    notes: ["II/MM, chunky 또는 separated multi-strip RGB/RGBA를 가져오고 little-endian TIFF를 내보냅니다."],
  },
  {
    id: "gif",
    label: "GIF",
    extensions: [".gif"],
    mime: ["image/gif"],
    category: "animation",
    import: "available",
    export: "unsupported",
    roundTrip: "none",
    lossModel: ["가져온 GIF는 캔버스 요소/참고 재생용이며 GIF 재인코딩은 제공하지 않음"],
    runtimeRequirement: ["브라우저 GIF decoder"],
    sizeBudget: { maxFileBytes: 12 * MiB, maxBatchBytes: 48 * MiB },
    status: "partial",
    notes: ["서명 검증 뒤 가져옵니다."],
    recommendedBridge: ["애니메이션 출력은 WebM 사용"],
  },
  {
    id: "psd",
    label: "Adobe Photoshop Document",
    extensions: [".psd"],
    mime: ["image/vnd.adobe.photoshop"],
    category: "document",
    import: "partial",
    export: "partial",
    roundTrip: "partial",
    lossModel: [
      "텍스트·벡터·스마트 오브젝트·조정 레이어·일부 효과는 래스터화 또는 생략",
      "래스터 레이어 마스크는 편집 가능한 알파 마스크로 가져오지만 벡터·이중 마스크와 페더는 래스터 근사",
      "그룹과 일부 블렌드 모드는 Canvas 합성 범위로 근사",
    ],
    runtimeRequirement: ["ag-psd lazy chunk", "Canvas 2D"],
    sizeBudget: {
      maxFileBytes: 128 * MiB,
      maxDecodedBytes: 128 * MiB,
      maxDimensionPx: 30_000,
      notes: "공통 손실 미리보기에서 영구 프로젝트 포함 자산을 모바일 64MiB, 데스크톱 128MiB로 제한",
    },
    status: "partial",
    notes: [
      "레이어 기반 교환은 가능하지만 Photoshop/CSP와 완전한 편집 왕복은 아닙니다.",
      "레이어와 마스크는 같은 1,280px 폭 표시 프록시를 사용하며 마스크는 무손실 PNG로 보존합니다.",
      "ag-psd 파싱은 원본 128MiB·누적 디코드 비트맵 128MiB에서 fail-closed하며 thumbnail·linked-file payload는 읽지 않습니다.",
      "ORA/CBZ와 같은 손실 미리보기에서 해상도·레이어·표시 프록시·편집성 변화를 적용 전에 확인합니다.",
    ],
  },
  {
    id: "svg",
    label: "SVG",
    extensions: [".svg"],
    mime: ["image/svg+xml"],
    category: "vector",
    import: "partial",
    export: "available",
    roundTrip: "partial",
    lossModel: [
      "vello_svg native 경로는 path·기본 shape·solid/linear/radial paint·group opacity/blend·단일 user-space clip의 감사된 부분집합만 사용",
      "text·image·pattern·mask·filter·marker·use/symbol·외부 참조·objectBoundingBox 또는 중첩 clip은 선택된 Vello native 요청에서 생략하거나 다른 renderer로 재실행하지 않고 fail-closed하며 원본 SVG를 보존",
      "FormatGateway가 warning 또는 unsupported ledger를 보고한 SVG는 편집 가능한 SceneIR로 과장하지 않고 원본 SVG를 보존한 image-backed 요소로 배치",
      "일부 브러시·필터·래스터 효과는 SVG 내보내기에서 이미지 또는 근사 벡터로 출력",
    ],
    runtimeRequirement: [
      "UTF-8 XML strict audit",
      "vello_svg 0.10 + vello_cpu deterministic preview",
      "FormatGateway SceneIR",
      "CanvasKit SceneIR independent candidate (preselected requests only)",
      "resvg-wasm non-authoritative visual reference",
    ],
    sizeBudget: {
      maxFileBytes: 2 * MiB,
      maxDecodedBytes: 4 * MiB,
      maxDimensionPx: 4_096,
      notes: "Elements 미리보기는 1,048,576 pixel·동시 2건·8MiB pixel cache로 제한",
    },
    status: "partial",
    notes: [
      "/studio 요소 패널이 strict audit와 자산별 resvg 시각 게이트를 통과한 경우에만 vello-svg-native 미리보기를 소비합니다.",
      "클릭·드래그·프로젝트 저장은 항상 원본 SVG data URL을 사용하며 미리보기 pixel은 문서 권위가 아닙니다.",
      "현재 가져오기 UI는 Elements/asset-preview island에 한정되며 임의 SVG 파일의 완전한 DOM 편집 또는 전체 캔버스 primary renderer 전환을 뜻하지 않습니다.",
    ],
    recommendedBridge: ["완전한 SVG 편집은 원본을 보관하고, 작업 전에 Vello·CanvasKit·resvg/reference 중 exact provider를 별도로 선택"],
    technicalLayers: {
      format: ["SVG 2 static safe subset"],
      container: ["UTF-8 XML"],
      codec: ["vello_svg strict subset", "SceneIR", "resvg reference raster"],
    },
    implementation: {
      import: "partial",
      export: "implemented",
      notes: [
        "vello_svg strict audit + vello_cpu render가 단일 선택 provider인 제품 라우터에 연결되고 resvg는 비권위 QA reference로만 사용",
        "FormatGateway SceneIR warning/unsupported가 0일 때만 editable 후보이며 선택된 Vello 또는 CanvasKit 실패는 다른 provider 재시도 없이 fail-closed",
      ],
    },
    uiWiring: {
      import: "partial",
      export: "wired",
      notes: ["StudioAssetToolPopoverBody → StudioElementsPanel → StudioSvgAssetPreview 경로에 한정해 연결됨"],
    },
    metadata: {
      general: "partial",
      icc: "not-audited",
      notes: ["원본 SVG 문자열은 보존하지만 importer가 모든 SVG metadata/ICC 의미를 SceneIR로 왕복하지는 않음"],
    },
    conformance: {
      publicSpec: "tested-public-subset",
      thirdPartyCertification: "not-claimed",
      notes: ["프로젝트 strict subset과 교차 renderer corpus만 검증했으며 SVG 전체 적합성을 주장하지 않음"],
    },
    externalRequirements: {
      provider: "bundled-library",
      providers: ["vello_svg 0.10", "vello_cpu 0.2", "CanvasKit 0.41.1", "resvg-wasm"],
      license: "bundled-dependency-terms",
      notes: ["각 provider의 고지·배포 조건과 WASM integrity pin을 유지해야 함"],
    },
  },
  {
    id: "toonink",
    label: "ToonSpectrum InkEnvelope",
    extensions: [".toonink"],
    mime: ["application/vnd.toonspectrum.ink+json"],
    category: "document",
    import: "engine-ready",
    export: "engine-ready",
    roundTrip: "lossless",
    lossModel: [],
    runtimeRequirement: [
      "canonical UTF-8 JSON",
      "Web Crypto SHA-256",
      "optional ECDSA P-256 or Ed25519 attestation",
    ],
    sizeBudget: {
      maxFileBytes: 32 * MiB + 32 * 1_024,
      notes: "canonical document 32MiB + bounded manifest/attestation overhead 32KiB",
    },
    status: "engine-ready",
    notes: [
      "상용 SDK의 비공개 wire format과 무관한 ToonSpectrum 독자 규격입니다.",
      "정확한 키 순서·필드·버전·SHA-256을 검증하고 변조·미래 버전·비정규 직렬화를 fail-closed로 거부합니다.",
      "조직 소유 키의 ECDSA P-256 또는 Ed25519 서명과 외부 trust-key resolver를 연결할 수 있습니다.",
      "자체 conformance와 서명 신뢰 체계를 제공하지만 제3자 상표 인증을 사칭하지 않습니다.",
    ],
    recommendedBridge: [
      "범용 펜 입력 교환에는 제한형 InkML, 전체 프로젝트 이동에는 .toonproject.zip 사용",
    ],
  },
  {
    id: "inkml",
    label: "InkML (ToonSpectrum 안전 부분집합)",
    extensions: [".inkml"],
    mime: ["application/inkml+xml"],
    category: "vector",
    import: "engine-ready",
    export: "engine-ready",
    roundTrip: "partial",
    lossModel: [
      "좌표·필압·기울기·회전·속도·배럴압은 보존하지만 ToonSpectrum 레이어·그룹·브러시 질감은 네이티브 프로젝트에만 유지",
      "외부 InkML의 상대·미분 압축과 간헐 채널은 안전한 v1 프로필에서 거부",
      "mm·dev 좌표, mapping·canvas transform, current context, traceGroup은 해석하지 않고 fail-closed로 거부",
      "단위 없는 basic X/Y는 제한 프로필의 응용 정의 캔버스 좌표로 가져오며 전체 InkML processor conformance를 주장하지 않음",
    ],
    runtimeRequirement: [
      "W3C DOMParser",
      "bounded clean-room InkML profile codec",
      "Web Crypto SHA-256 conformance receipt",
    ],
    sizeBudget: {
      maxFileBytes: 32 * MiB,
      maxItems: 2_000_000,
      notes: "최대 100,000획, 획당 200,000샘플, 전체 2,000,000샘플",
    },
    status: "engine-ready",
    notes: [
      "상용 잉크 SDK 없이 공개 InkML 사양을 참고한 ToonSpectrum 전용 안전 부분집합을 독립 구현했습니다.",
      "DTD·외부 entity·CDATA·비정규 채널 압축은 fail-closed로 거부합니다.",
      "import→normalize→deterministic export→reimport 채널 오차와 자원 예산을 conformance receipt로 검증합니다.",
      "px·px/ms는 ToonSpectrum v1 프로필의 명시적 응용 단위이며 공식 W3C processor 또는 Wacom .will/UIM 호환을 주장하지 않습니다.",
    ],
    recommendedBridge: ["완전한 편집 왕복에는 .toonproject.zip 사용"],
  },
  {
    id: "will-v1-path-stream",
    label: "WILL v1 Path stream (Annex A 제한 프로필)",
    extensions: [".willpb"],
    mime: ["application/vnd.willfileformat.path+protobuf"],
    category: "vector",
    import: "engine-ready",
    export: "engine-ready",
    roundTrip: "partial",
    lossModel: [
      "좌표와 폭은 파일의 decimal precision에 맞춰 고정소수점으로 양자화됨",
      "시작·끝 매개변수와 색상은 보존하지만 전체 .will 문서의 SVG·배경·메타데이터는 이 스트림에 포함되지 않음",
      "WILL 3/UIM 및 Wacom SDK 객체 모델과의 호환성을 주장하지 않음",
    ],
    runtimeRequirement: [
      "ToonSpectrum clean-room WILL v1 Annex A protobuf codec",
      "canonical Base-128 Path framing",
      "Web Crypto SHA-256 conformance receipt",
    ],
    sizeBudget: {
      maxFileBytes: 32 * MiB,
      maxItems: 100_000,
      notes: "경로당 최대 100,000점, 문서 전체 1,000,000점의 제한 프로필",
    },
    status: "engine-ready",
    notes: [
      "공개 WILL v1 사양의 Annex A Path protobuf와 §5.3.3 Path 목록만 독립 구현했습니다.",
      "확장자 .willpb는 전체 .will OPC 문서와 혼동하지 않기 위한 ToonSpectrum의 명시적 경계입니다.",
      "결정적 encode/decode, 비정규 varint·overflow·자원 예산, 대형 경로를 conformance receipt로 검증합니다.",
      "ToonSpectrum 제품 인증은 Wacom 공식 인증·SDK 출처·상표 허가를 의미하지 않습니다.",
    ],
    recommendedBridge: [
      "전체 프로젝트 이동에는 .toonproject.zip 사용",
      "전체 .will 문서는 Annex B OPC 적합성 프로필을 별도로 사용",
    ],
  },
  {
    id: "will-v1-document",
    label: "WILL v1 문서 (ToonSpectrum Annex B 제한 프로필)",
    extensions: [".will"],
    mime: ["application/vnd.toonspectrum.will-v1-bounded+zip"],
    category: "document",
    import: "available",
    export: "available",
    roundTrip: "partial",
    lossModel: [
      "ToonSpectrum의 결정적 7-part OPC 프로필과 Annex A 획 스트림만 왕복함",
      "임의 vendor extension·추가 section·paint·배경 media·스크립트는 묵시적으로 버리지 않고 가져오기를 거부함",
      "공개 명세에 없는 section relationship Type은 ToonSpectrum 소유 URI를 사용하므로 임의 Wacom 파일 상호운용을 주장하지 않음",
    ],
    runtimeRequirement: [
      "ToonSpectrum bounded OPC/ZIP32 reader/writer",
      "safe XML/SVG profile parser",
      "ToonSpectrum WILL v1 Annex A protobuf codec",
    ],
    sizeBudget: {
      maxFileBytes: 40 * MiB,
      maxFiles: 7,
      maxItems: 1_000_000,
      notes:
        "정확한 7개 part, XML part당 256KiB, 획 stream 32MiB, 문서 전체 1,000,000 source point 제한. Studio 편집 요소 변환은 별도 200,000 sample admission budget 적용",
    },
    status: "partial",
    notes: [
      "공개 WILL v1 Annex B를 바탕으로 결정적 .will 생성과 엄격한 가져오기를 독립 구현했습니다.",
      "공개 v1 명세는 최상위 컨테이너 MIME을 정의하지 않으므로 ToonSpectrum 소유 MIME을 사용합니다.",
      "Content Types, root/section relationship, SVG r:id, CRC와 Path stream을 한 문서 경계에서 검증합니다.",
      "DTD·entity·processing instruction·외부 target·script·foreignObject·경로 순회·압축 폭탄을 fail-closed로 거부합니다.",
      "파일 메뉴에서 전용 Worker 검사, 명시적 새 페이지/현재 페이지 선택, 손실 미리보기 후 가져오며 동일 메뉴에서 내보낼 수 있습니다.",
      "이 구현과 ToonSpectrum 제품 검증은 Wacom SDK 출처·공식 인증·상표 허가를 의미하지 않습니다.",
    ],
    recommendedBridge: [
      "임의 vendor .will 파일은 상호운용 fixture와 별도 프로필 검증 후 가져오기",
      "전체 ToonSpectrum 편집 프로젝트 이동에는 .toonproject.zip 사용",
    ],
  },
  {
    id: "icc-profile",
    label: "ICC 색상 프로파일",
    extensions: [".icc", ".icm"],
    mime: ["application/vnd.iccprofile", "application/octet-stream"],
    category: "publication",
    import: "engine-ready",
    export: "engine-ready",
    roundTrip: "partial",
    lossModel: [
      "RGB matrix/TRC만 Studio 내부 색 변환에 사용하며 LUT·CMYK는 권리가 확인된 검사·원본 임베딩 경계로 제한",
      "프로파일 파싱 결과는 라이선스·재배포·상업 사용 허가로 간주하지 않음",
      "사용자·인쇄소 제공 프로파일은 앱 번들 allowlist로 자동 승격하지 않음",
    ],
    runtimeRequirement: [
      "ICC v2/v4 bounded parser",
      "Web Crypto SHA-256",
      "exact provider manifest and embedding/redistribution rights policy",
    ],
    sizeBudget: {
      maxFileBytes: 16 * MiB,
      notes: "헤더·tag table·reserved 영역·profile ID·checksum·provider 권한을 적용 전에 검증",
    },
    status: "engine-ready",
    notes: [
      "제품 생성 sRGB는 고정 SHA-256 allowlist로 감사하며, 외부 프로파일은 출처·권한·identity가 일치해야 합니다.",
      "성공 영수증은 ToonSpectrum 정책 통과이며 ICC·인쇄소·vendor의 제3자 공식 인증이 아닙니다.",
    ],
    technicalLayers: {
      format: ["ICC.1 v2/v4 bounded profile"],
      container: ["ICC profile byte stream"],
      codec: ["matrix/TRC RGB execution", "LUT/CMYK inspect/embed boundary"],
    },
    implementation: {
      import: "implemented",
      export: "implemented",
      notes: ["원본 검사·권한 정책과 결정적 ToonSpectrum sRGB profile builder 구현"],
    },
    uiWiring: {
      import: "not-wired",
      export: "not-wired",
      notes: ["전문 PDF OutputIntent orchestration에서 engine API를 사용하며 독립 ICC 메뉴는 후속 연결"],
    },
    metadata: {
      general: "preserved",
      icc: "preserved",
      notes: ["원본 bytes를 불변 복사해 identity를 검사하며 허용된 raw embedding은 동일 bytes를 사용"],
    },
    conformance: {
      publicSpec: "tested-public-subset",
      thirdPartyCertification: "not-claimed",
      notes: ["ICC v2/v4 bounded header/tag/profile-ID policy를 테스트하며 전체 CMM 인증은 주장하지 않음"],
    },
    externalRequirements: {
      provider: "none",
      providers: [],
      license: "project-implementation-only",
      notes: ["외부 프로파일 자체의 저작권·재배포 권한은 exact provider manifest에서 별도로 검증"],
    },
  },
  {
    id: "pdf",
    label: "PDF 1.4",
    extensions: [".pdf"],
    mime: ["application/pdf"],
    category: "publication",
    import: "unsupported",
    export: "available",
    roundTrip: "none",
    lossModel: ["각 페이지가 JPEG 이미지로 평탄화됨", "편집 가능한 텍스트/벡터 구조 없음"],
    runtimeRequirement: ["Canvas JPEG encoder"],
    sizeBudget: { maxDimensionPx: 16_384 },
    status: "available",
    notes: ["공유·검토·제출용 이미지 PDF이며 전문 인쇄 PDF/X writer는 아닙니다."],
  },
  {
    id: "pdf-vector",
    label: "PDF 1.7 벡터",
    extensions: [".pdf"],
    mime: ["application/pdf"],
    category: "publication",
    import: "unsupported",
    export: "engine-ready",
    roundTrip: "none",
    lossModel: [
      "지원하지 않는 Studio 브러시·필터·합성 효과는 별도 래스터 자원으로 평탄화해야 함",
      "PDF를 다시 Studio 편집 문서로 가져오는 경로는 제공하지 않음",
    ],
    runtimeRequirement: [
      "deterministic classic-xref PDF writer",
      "embedded TrueType CID font policy",
      "bounded PDF byte scanner",
    ],
    sizeBudget: {
      maxDimensionPx: 32_768,
      notes: "문서 생성 전에 이미지·폰트·페이지 작업 예산을 별도로 적용",
    },
    status: "engine-ready",
    notes: [
      "벡터 path·텍스트·JPEG·알파·ICC OutputIntent를 쓰는 독립 PDF writer가 구현되어 있습니다.",
      "현재 보이는 메뉴의 PDF 버튼은 기존 평탄화 PDF이며 벡터 writer는 전문 출고 UI에 아직 연결하지 않았습니다.",
    ],
    technicalLayers: {
      format: ["PDF 1.7 writer subset"],
      container: ["classic-xref PDF"],
      codec: ["JPEG DCT image embedding", "embedded TrueType CID fonts"],
    },
    implementation: {
      import: "not-implemented",
      export: "implemented",
      notes: ["결정적 writer와 독립 classic-xref scanner 구현"],
    },
    uiWiring: {
      import: "not-applicable",
      export: "not-wired",
      notes: ["전문 출고 패널 연결 전 engine API로만 제공"],
    },
    metadata: {
      general: "partial",
      icc: "preserved",
      notes: ["제목·작성자·XMP·OutputIntent를 지원하며 임의 PDF metadata 왕복은 제공하지 않음"],
    },
    conformance: {
      publicSpec: "tested-public-subset",
      thirdPartyCertification: "not-claimed",
      notes: ["ToonSpectrum writer/scanner 부분집합을 테스트하며 범용 PDF processor 적합성을 주장하지 않음"],
    },
    externalRequirements: {
      provider: "none",
      providers: [],
      license: "project-implementation-only",
      notes: ["외부 PDF SDK 없이 독립 구현"],
    },
  },
  ...([
    {
      id: "pdf-a-2b",
      label: "PDF/A-2b 보존 후보",
      format: "PDF/A-2b bounded candidate",
      profileNotes: [
        "PDF 1.7·XMP pdfaid 2/B·GTS_PDFA1·파일 ID·임베드 글꼴·금지 기능을 출력 바이트에서 다시 검사합니다.",
        "선택적 veraPDF adapter 결과는 정확히 같은 SHA-256 문서에만 결합하며 공식 인증으로 재표시하지 않습니다.",
      ],
    },
    {
      id: "pdf-x-4",
      label: "PDF/X-4 인쇄 후보",
      format: "PDF/X-4 bounded candidate",
      profileNotes: [
        "PDF 1.6·XMP/Info PDF/X-4·Trapped·GTS_PDFX·ICC·Trim/Bleed box·device color를 출력 바이트에서 다시 검사합니다.",
        "인쇄소 승인·ISO 인증·PDF Association 인증은 발급하지 않으며 exact-source 외부 결과 adapter만 수용합니다.",
      ],
    },
  ] as const).map(
    ({ id, label, format, profileNotes }): StudioInterchangeCapabilityDefinition => ({
      id,
      label,
      extensions: [".pdf"],
      mime: ["application/pdf"],
      category: "publication",
      import: "unsupported",
      export: "engine-ready",
      roundTrip: "none",
      lossModel: [
        "지원하지 않는 Studio 효과는 출고 전에 래스터화해야 함",
        "생성 PDF를 편집 가능한 Studio 문서로 다시 가져오지 않음",
      ],
      runtimeRequirement: [
        "deterministic vector PDF writer",
        "ICC provider/rights policy",
        "independent exact-source PDF scanner",
        "SHA-256 conformance receipt",
      ],
      sizeBudget: {
        maxDimensionPx: 32_768,
        notes: "ICC 최대 16MiB와 문서별 이미지·폰트·페이지 사전 예산 적용",
      },
      status: "engine-ready",
      notes: profileNotes,
      technicalLayers: {
        format: [format],
        container: ["classic-xref PDF"],
        codec: ["JPEG DCT image embedding", "embedded TrueType CID fonts"],
      },
      implementation: {
        import: "not-implemented",
        export: "implemented",
        notes: ["writer→ICC audit→byte scanner→profile preflight→receipt integrity 파이프라인 구현"],
      },
      uiWiring: {
        import: "not-applicable",
        export: "not-wired",
        notes: ["전문 출고 프로필 선택 UI는 후속 연결"],
      },
      metadata: {
        general: "partial",
        icc: "preserved",
        notes: ["결정적 XMP·Info·OutputIntent·file ID를 기록하고 exact ICC bytes를 임베드"],
      },
      conformance: {
        publicSpec: "tested-public-subset",
        thirdPartyCertification: "not-claimed",
        notes: ["로컬 성공은 후보 판정이며 외부 검증 결과도 exact-source 증거로만 수용"],
      },
      externalRequirements: {
        provider: "none",
        providers: [],
        license: "project-implementation-only",
        notes: ["로컬 후보 생성에는 외부 SDK가 필요 없고 선택적 공식 validator는 별도 adapter 경계"],
      },
    }),
  ),
  {
    id: "webm",
    label: "WebM",
    extensions: [".webm"],
    mime: ["video/webm", "video/webm;codecs=vp8,opus", "video/webm;codecs=vp9,opus"],
    category: "animation",
    import: "unsupported",
    export: "available",
    roundTrip: "none",
    lossModel: [
      "타임라인 편집 정보가 최종 영상으로 렌더됨",
      "작업 전에 지원 여부를 검사해 하나의 WebM MIME/코덱을 확정하고 녹화 중에는 전환하지 않음",
    ],
    runtimeRequirement: ["MediaRecorder", "Canvas captureStream", "preflight-selected exact WebM codec"],
    sizeBudget: { notes: "해상도·fps 기반 2.5–16 Mbps 비트레이트" },
    status: "available",
    notes: [
      "브라우저가 지원하는 경우에만 동작합니다.",
      "선택된 MediaRecorder 생성·실행 실패 뒤 VP9·VP8·브라우저 기본 코덱으로 재시도하지 않습니다.",
    ],
  },
  {
    id: "dialogue-json",
    label: "ToonSpectrum dialogue JSON",
    extensions: [".dialogue.json", ".json"],
    mime: ["application/json"],
    category: "document",
    import: "available",
    export: "available",
    roundTrip: "lossless",
    lossModel: [],
    runtimeRequirement: ["UTF-8", "JSON"],
    sizeBudget: { maxFileBytes: 8 * MiB, maxItems: 20_000 },
    status: "available",
    notes: ["대사 ID·페이지·컷·화자·메모·시간 정보를 versioned schema로 보존합니다."],
  },
  {
    id: "dialogue-table",
    label: "Dialogue CSV / TSV",
    extensions: [".csv", ".tsv"],
    mime: ["text/csv", "text/tab-separated-values", "text/plain"],
    category: "document",
    import: "available",
    export: "available",
    roundTrip: "partial",
    lossModel: ["스프레드시트 수식 실행 방지를 위해 위험한 셀 시작 문자를 apostrophe로 중립화"],
    runtimeRequirement: ["UTF-8"],
    sizeBudget: { maxFileBytes: 8 * MiB, maxItems: 20_000 },
    status: "partial",
    notes: ["번역표용이며 quoted newline/escaped quote를 검증합니다."],
  },
  {
    id: "dialogue-script-text",
    label: "Dialogue TXT / Markdown / Fountain",
    extensions: [".txt", ".md", ".fountain"],
    mime: ["text/plain", "text/markdown"],
    category: "document",
    import: "available",
    export: "available",
    roundTrip: "partial",
    lossModel: ["TXT/Markdown은 메모·시간을 보존하지 않음", "Fountain은 페이지·컷 주석을 보존하지만 캔버스 좌표는 없음"],
    runtimeRequirement: ["UTF-8"],
    sizeBudget: { maxFileBytes: 8 * MiB, maxItems: 20_000 },
    status: "partial",
    notes: ["대사 일괄 편집 패널에서 가져오기·내보내기가 연결되어 있습니다."],
  },
  {
    id: "dialogue-fdx",
    label: "Final Draft XML (FDX) safe subset",
    extensions: [".fdx"],
    mime: ["application/xml", "text/xml"],
    category: "document",
    import: "available",
    export: "available",
    roundTrip: "partial",
    lossModel: [
      "Scene Heading은 페이지, Action 순서는 컷 문맥으로만 매핑",
      "Character/Dialogue/Parenthetical 외 Paragraph와 서식·제작 메타데이터는 loss preview로 보고 후 제외",
      "출력은 ToonSpectrum 페이지·컷 marker를 사용하는 공개 구조 안전 부분집합",
    ],
    runtimeRequirement: ["fatal UTF-8", "bounded clean-room XML parser"],
    sizeBudget: {
      maxFileBytes: 8 * MiB,
      maxItems: 20_000,
      notes: "XML 요소 100,000개, 깊이 32, Paragraph 60,000개 예산",
    },
    status: "available",
    notes: [
      "공식 공개 XSD가 확인되지 않아 FinalDraft/Content/Paragraph/Text 일반 공개 구조만 처리합니다.",
      "대사 일괄 편집 패널에서 손실 미리보기를 확인한 뒤 가져오며 안전 부분집합으로 내보냅니다.",
    ],
  },
  {
    id: "subtitles",
    label: "SRT / WebVTT subtitles",
    extensions: [".srt", ".vtt"],
    mime: ["application/x-subrip", "text/vtt", "text/plain"],
    category: "animation",
    import: "available",
    export: "available",
    roundTrip: "partial",
    lossModel: ["페이지·컷·캔버스 좌표가 없어 문서 순서로 연결", "시간이 없으면 출력 시 3초 간격 자동 생성"],
    runtimeRequirement: ["UTF-8"],
    sizeBudget: { maxFileBytes: 8 * MiB, maxItems: 20_000 },
    status: "partial",
    notes: ["모션 웹툰 자막/대사 타이밍 bridge입니다."],
  },
  {
    id: "release-calendar",
    label: "iCalendar release schedule",
    extensions: [".ics"],
    mime: ["text/calendar"],
    category: "publication",
    import: "unsupported",
    export: "available",
    roundTrip: "none",
    lossModel: ["명시적으로 허용한 로컬 일정 필드만 RFC 5545 event로 출력", "외부 플랫폼 예약 게시 상태는 포함하지 않음"],
    runtimeRequirement: ["UTF-8"],
    sizeBudget: { maxFileBytes: 2_000_000, maxItems: 500 },
    status: "available",
    notes: ["메모는 사용자가 opt-in한 경우에만 포함합니다."],
  },
  {
    id: "publication-analytics-csv",
    label: "Publication analytics CSV",
    extensions: [".csv"],
    mime: ["text/csv", "text/plain"],
    category: "publication",
    import: "available",
    export: "unsupported",
    roundTrip: "none",
    lossModel: ["외부 플랫폼 원문 대신 허용된 정규화 지표와 출처 라벨만 로컬 저장"],
    runtimeRequirement: ["UTF-8"],
    sizeBudget: { maxItems: 10_000, notes: "최대 2,000,000 UTF-16 code units, 64 columns" },
    status: "partial",
    notes: ["WEBTOON/Tapas API 연동을 가장하지 않는 로컬 CSV 분석 경로입니다."],
  },
  {
    id: "toonaction-json",
    label: "ToonSpectrum Auto Action",
    extensions: [".toonaction.json"],
    mime: ["application/json"],
    category: "document",
    import: "available",
    export: "available",
    roundTrip: "lossless",
    lossModel: [],
    runtimeRequirement: ["UTF-8", "JSON"],
    sizeBudget: { maxItems: 64, notes: "128,000 JSON code units, depth 12, tree nodes 8,000" },
    status: "available",
    notes: ["검증된 명령 집합만 가져오며 실행 전 영향 범위와 복구 지점을 만듭니다."],
  },
  {
    id: "publish-package",
    label: "ToonSpectrum publish package",
    extensions: [".toonpkg.zip"],
    mime: ["application/zip"],
    category: "publication",
    import: "unsupported",
    export: "available",
    roundTrip: "none",
    lossModel: ["게시 목적지용 페이지·review PDF·manifest·공개 AI 요약을 묶은 결과 패키지"],
    runtimeRequirement: ["Blob", "UTF-8 ZIP32 store writer"],
    sizeBudget: { maxFileBytes: 520_000_000, maxDecodedBytes: 512_000_000, maxFiles: 1_100 },
    status: "available",
    notes: ["Studio 편집 프로젝트 복구용이 아니라 검수·제출용입니다."],
  },
  {
    id: "abr",
    label: "Adobe Photoshop Brush",
    extensions: [".abr"],
    mime: ["application/octet-stream", "application/x-photoshop-abr"],
    category: "brush",
    import: "partial",
    export: "unsupported",
    roundTrip: "none",
    lossModel: ["지원하지 않는 Photoshop dynamics/dual brush/texture는 근사 또는 생략"],
    runtimeRequirement: ["Web Worker", "ag-psd ABR parser"],
    sizeBudget: { maxFileBytes: 32 * MiB, maxItems: 256, maxDecodedBytes: 64 * MiB },
    status: "partial",
    notes: ["ABR 6/7/9/10을 검사하고 최대 256개 브러시를 Studio 스냅샷으로 변환합니다."],
  },
  {
    id: "brush-tip-png",
    label: "PNG 브러시 펜촉",
    extensions: [".png"],
    mime: ["image/png"],
    category: "brush",
    import: "available",
    export: "unsupported",
    roundTrip: "none",
    lossModel: ["64×64 이하 알파 마스크로 다운샘플"],
    runtimeRequirement: ["Canvas 2D", "PNG decoder"],
    sizeBudget: { maxFileBytes: 4 * MiB, maxDimensionPx: 4_096, maxDecodedBytes: 16 * MiB },
    status: "available",
    notes: ["투명 알파 또는 흑백 명도를 펜촉 알파 마스크로 변환합니다."],
  },
  ...(["gpl", "ase", "aco", "act", "jasc-pal", "css-palette", "json-palette"] as const).map((id): StudioInterchangeCapabilityDefinition => {
    const spec = {
      gpl: { label: "GIMP Palette", ext: [".gpl"], mime: ["text/plain"] },
      ase: { label: "Adobe Swatch Exchange", ext: [".ase"], mime: ["application/octet-stream"] },
      aco: { label: "Adobe Color Swatch", ext: [".aco"], mime: ["application/octet-stream"] },
      act: { label: "Adobe Color Table", ext: [".act"], mime: ["application/octet-stream"] },
      "jasc-pal": { label: "JASC-PAL", ext: [".pal"], mime: ["text/plain"] },
      "css-palette": { label: "CSS Custom Properties", ext: [".css"], mime: ["text/css"] },
      "json-palette": { label: "ToonSpectrum Palette JSON", ext: [".palette.json", ".json"], mime: ["application/json"] },
    }[id];
    return {
      id,
      label: spec.label,
      extensions: spec.ext,
      mime: spec.mime,
      category: "palette",
      import: "available",
      export: "available",
      roundTrip: "partial",
      lossModel: [
        "Studio 팔레트 모델은 8비트 불투명 sRGB이므로 알파·광색역·spot/global 구분은 경고 후 제거",
        ...(id === "act" || id === "jasc-pal" ? ["256색 한도와 색 이름 미지원 손실을 명시적으로 경고"] : []),
      ],
      runtimeRequirement: id === "ase" || id === "aco" || id === "act" ? ["ArrayBuffer", "DataView"] : ["UTF-8"],
      sizeBudget: { maxFileBytes: 4 * MiB, maxItems: id === "act" || id === "jasc-pal" ? 256 : 1_000 },
      status: "available",
      notes: ["검증된 codec과 팔레트 라이브러리 가져오기·내보내기 UI가 연결되어 있습니다."],
    };
  }),
  ...(["glb", "gltf", "obj", "fbx", "dae", "stl", "ply", "3ds"] as const).map((id): StudioInterchangeCapabilityDefinition => ({
    id: `3d-${id}`,
    label: id === "glb" ? "glTF Binary" : id === "gltf" ? "glTF JSON" : id.toUpperCase(),
    extensions: [`.${id}`],
    mime: id === "glb" ? ["model/gltf-binary"]
      : id === "gltf" ? ["model/gltf+json"]
        : id === "obj" ? ["model/obj", "text/plain"]
          : id === "stl" ? ["model/stl", "application/sla"]
            : ["application/octet-stream"],
    category: "3d",
    import: "available",
    export: "unsupported",
    roundTrip: "none",
    lossModel: id === "glb" ? ["안전 정규화 뒤 self-contained GLB로 보관"] : ["재질·애니메이션 일부를 self-contained GLB로 정규화하며 원본 포맷 구조는 보존하지 않음"],
    runtimeRequirement: ["Three.js lazy loader", "Web Worker for large OBJ/STL/PLY", "WebGL 또는 WebGPU renderer"],
    sizeBudget: { maxFileBytes: id === "glb" ? 100 * MiB : 32 * MiB, maxBatchBytes: 300 * MiB, maxFiles: 256, maxDecodedBytes: 256 * MiB },
    status: "partial",
    notes: ["가져온 모델은 검증된 self-contained GLB로 변환되어 프로젝트에 저장됩니다."],
    recommendedBridge: ["수정 가능한 원본은 Blender/SketchUp 등에 별도 보관"],
  })),
  {
    id: "vrm",
    label: "VRM humanoid avatar",
    extensions: [".vrm"],
    mime: ["model/vrm", "model/gltf-binary"],
    category: "3d",
    import: "available",
    export: "unsupported",
    roundTrip: "none",
    lossModel: ["원본 VRM을 포즈/렌더 소스로 사용하지만 VRM authoring/export는 제공하지 않음"],
    runtimeRequirement: ["@pixiv/three-vrm", "WebGL 또는 WebGPU renderer", "IndexedDB"],
    sizeBudget: { maxFileBytes: 128 * MiB },
    status: "partial",
    notes: ["VRM 파일 업로드와 포즈·표정·소품 결합을 지원합니다."],
    recommendedBridge: ["VRM 제작/재내보내기는 VRoid Studio 또는 Blender 사용"],
  },
  ...([
    ["clip", "CLIP STUDIO FORMAT", [".clip"], ["PSD", "PNG", "SVG"]],
    ["ai", "Adobe Illustrator", [".ai"], ["SVG", "PDF", "PSD", "PNG"]],
  ] as const).map(([id, label, extensions, bridge]): StudioInterchangeCapabilityDefinition => ({
    id,
    label,
    extensions,
    mime: ["application/octet-stream"],
    category: "document",
    import: "unsupported",
    export: "unsupported",
    roundTrip: "none",
    lossModel: ["독점 내부 구조를 직접 해석하거나 쓰지 않음"],
    runtimeRequirement: [],
    sizeBudget: {},
    status: "bridge-only",
    notes: ["직접 호환을 지원한다고 표시하지 않습니다."],
    recommendedBridge: bridge,
    proprietary: true,
  })),
  ...([
    ["sut", "CLIP STUDIO brush", [".sut"]],
    ["sutg", "CLIP STUDIO brush group", [".sutg"]],
  ] as const).map(([id, label, extensions]): StudioInterchangeCapabilityDefinition => ({
    id,
    label,
    extensions,
    mime: ["application/octet-stream"],
    category: "brush",
    import: "partial",
    export: "unsupported",
    roundTrip: "none",
    lossModel: [
      "관측된 SQLite 3 컨테이너와 허용 컬럼만 BrushProgramIR로 낮추며 미매핑 설정은 원본 payload와 unsupported ledger에 보존",
      "공식 CELSYS SUT/SUTG 규격 적합성이나 CLIP STUDIO와 동일한 브러시 손맛·왕복을 주장하지 않음",
      "검증된 프로그램이 없으면 preserve-only로 반환하고 가져오기 성공으로 표시하지 않음",
    ],
    runtimeRequirement: [
      "Dedicated Worker",
      "@sqlite.org/sqlite-wasm read-only snapshot reader",
      "bounded embedded PNG validator",
    ],
    sizeBudget: {
      maxFileBytes: 128_000_000,
      maxDecodedBytes: 32_000_000,
      maxItems: 4_096,
      notes: "128 tables·256 columns/table·64MP embedded PNG hard bounds",
    },
    status: "partial",
    notes: [
      "브러시 가져오기 UI가 검증된 SQLite snapshot을 Worker에서 읽고 공유 V12 SQLite 브러시 카탈로그에 batch commit합니다.",
      "원본 파일과 권리·미매핑 필드는 보존하며 레거시 내부 Studio 데이터 자동 migration에는 사용하지 않습니다.",
    ],
    recommendedBridge: ["미지원 센서·재질은 MYB/KPP/ABR 또는 PNG 펜촉과 Studio 브러시 설정으로 명시 변환"],
    proprietary: true,
    technicalLayers: {
      format: ["observed CLIP STUDIO tool SQLite subset"],
      container: ["SQLite 3 read-only bounded snapshot"],
      codec: ["embedded PNG subset"],
    },
    implementation: {
      import: "partial",
      export: "not-implemented",
      notes: ["clean-room bounded reader; writer와 임의 SQL 실행은 제공하지 않음"],
    },
    uiWiring: {
      import: "wired",
      export: "not-applicable",
      notes: ["Studio brush library와 StudioPage 브러시 가져오기 input에 .sut/.sutg 연결"],
    },
    metadata: {
      general: "partial",
      icc: "not-applicable",
      notes: ["author/license/website/email과 원본 payload를 보존; 미지 컬럼은 해석하지 않음"],
    },
    conformance: {
      publicSpec: "not-claimed",
      thirdPartyCertification: "not-claimed",
      notes: ["CELSYS 공개 컨테이너 명세나 공식 인증이 없으므로 제품 authored fixture와 공격 corpus만 검증"],
    },
    externalRequirements: {
      provider: "bundled-library",
      providers: ["@sqlite.org/sqlite-wasm"],
      license: "bundled-dependency-terms",
      notes: ["SQLite snapshot reader는 sandboxed Worker에서만 실행; CELSYS 코드·SDK를 번들하지 않음"],
    },
  })),
  {
    id: "ora",
    label: "OpenRaster",
    extensions: [".ora"],
    mime: ["image/openraster"],
    category: "document",
    import: "available",
    export: "available",
    roundTrip: "partial",
    lossModel: [
      "OpenRaster가 표현하지 못하는 Studio 전용 요소/효과는 PNG 레이어로 렌더",
      "검증된 중첩 stack은 Studio 적용 시 전체 경로명을 가진 단일 그룹으로 평탄화될 수 있음",
      "그룹 단위 opacity/blend는 자식 레이어 유효 값으로 근사되어 겹침 픽셀이 달라질 수 있음",
    ],
    runtimeRequirement: [
      "bounded ZIP32 STORE/DEFLATE reader/writer",
      "strict UTF-8 XML parser",
      "PNG IHDR validator",
      "순차 browser pixel decode gate",
      "공통 손실 미리보기",
    ],
    sizeBudget: {
      maxFileBytes: 520_000_000,
      maxDecodedBytes: 128 * MiB,
      maxDimensionPx: 32_768,
      maxFiles: 516,
      maxItems: 500,
      notes: "PNG 한 장당 최대 16,777,216픽셀, 전체 디코딩 RGBA 최대 128MiB, 영구 포함 자산 모바일 64MiB/데스크톱 128MiB",
    },
    status: "partial",
    notes: [
      "가져오기는 레이어 순서·좌표·유효 opacity/visibility·지원 blend mode와 PNG 원본을 보존합니다.",
      "중첩 그룹 관계는 검증된 DTO로 유지하지만 현재 Studio 그룹 모델에는 ‘상위 / 하위’ 경로명으로 평탄화해 적용할 수 있습니다.",
      "그룹 단위 opacity/blend 합성은 손실 미리보기에서 경고하고 자식 레이어 유효 값으로 근사합니다.",
      "현재 내보내기 메뉴는 화면과 같은 합성 1레이어 ORA만 저장합니다.",
      "PNG IHDR·개별/누적 예산을 선검증한 뒤 브라우저 픽셀 디코드와 실제 크기 대조를 통과해야 적용하며, ZIP64·암호화·data descriptor·legacy non-UTF-8 경로·STORE/DEFLATE 외 압축은 fail-closed 처리합니다.",
    ],
  },
  {
    id: "cbz",
    label: "Comic Book ZIP",
    extensions: [".cbz"],
    mime: ["application/vnd.comicbook+zip", "application/zip"],
    category: "publication",
    import: "available",
    export: "available",
    roundTrip: "none",
    lossModel: [
      "가져온 각 페이지는 편집 가능한 내부 레이어가 없는 단일 페이지 이미지로 배치됨",
      "ComicInfo.xml 핵심 metadata는 검증·요약하지만 프로젝트 metadata로 완전 왕복하지 않음",
      "내보내기는 Studio 페이지를 순서 지정 PNG/JPEG로 평탄화함",
    ],
    runtimeRequirement: [
      "bounded ZIP32 STORE/DEFLATE reader/writer",
      "strict PNG/JPEG/WebP/GIF header validator",
      "strict UTF-8 ComicInfo.xml parser",
      "순차 browser pixel decode gate",
      "Canvas image encoder",
      "공통 손실 미리보기",
    ],
    sizeBudget: {
      maxFileBytes: 520_000_000,
      maxDecodedBytes: 512 * MiB,
      maxDimensionPx: 131_072,
      maxFiles: 1_163,
      maxItems: 200,
      notes: "codec core의 절대 상한은 1,099페이지지만 Studio는 기존 페이지를 포함해 200페이지, 영구 포함 자산은 모바일 64MiB/데스크톱 128MiB로 제한",
    },
    status: "partial",
    notes: [
      "PNG/JPEG/WebP/GIF 페이지를 strict header·dimension·decoded-memory 검사와 순차 browser pixel decode 후 Unicode natural order로 가져옵니다.",
      "ComicInfo.xml은 구조 복잡도를 제한하고 제목·시리즈·권수·제작진·언어 등 허용된 핵심 metadata만 엄격히 읽습니다.",
      "ZIP64·암호화·data descriptor·legacy non-UTF-8 경로·STORE/DEFLATE 외 압축은 fail-closed 처리합니다.",
      "내보내기는 전체 Studio 페이지를 평탄화하고 ComicInfo.xml과 함께 저장하는 기존 범위를 유지합니다.",
    ],
  },
  {
    id: "gif-apng-export",
    label: "GIF / APNG animation export",
    extensions: [".gif", ".apng"],
    mime: ["image/gif", "image/apng"],
    category: "animation",
    import: "unsupported",
    export: "partial",
    roundTrip: "none",
    lossModel: [
      "GIF는 median-cut ≤256색 양자화와 1비트 투명으로 평탄화됨(선택적 ordered/Floyd–Steinberg 디더링, 지연 시간은 centisecond 정밀도)",
      "APNG는 프레임별 무손실 PNG지만 레이어·벡터·프레임 편집성은 평탄화됨",
    ],
    runtimeRequirement: [
      "Canvas 2D",
      "순수 TS GIF89a encoder(median-cut·LZW·NETSCAPE2.0 무한 루프)",
      "브라우저 PNG encoder + chunk 단위 APNG assembler(acTL/fcTL/fdAT sequence·CRC32)",
    ],
    sizeBudget: {
      maxItems: 60,
      notes: "프레임 애니메이션 패널 기준 요소당 최대 60프레임",
    },
    status: "partial",
    notes: [
      "프레임 애니메이션 패널에서 GIF와 APNG를 무한 반복으로 내보냅니다(프레임별 지연 시간 유지, 투명 배경 지원).",
      "GIF/APNG 가져오기는 이 행에서 지원하지 않으며 별도 정적 GIF 가져오기 행과 혼동하지 않습니다.",
    ],
    technicalLayers: {
      format: ["GIF89a", "APNG"],
      container: ["GIF data stream", "PNG chunk stream"],
      codec: ["GIF LZW + palette quantization", "PNG image data"],
    },
    implementation: {
      import: "not-implemented",
      export: "partial",
      notes: ["GIF/APNG encoder subset만 구현; 범용 animated image importer는 UI 미연결"],
    },
    uiWiring: {
      import: "not-applicable",
      export: "wired",
      notes: ["프레임 애니메이션 패널의 WebM·GIF·APNG 내보내기 선택기에 연결"],
    },
    metadata: {
      general: "discarded",
      icc: "discarded",
      notes: ["프레임 duration·loop·픽셀만 출력하고 편집/저작 metadata와 ICC는 쓰지 않음"],
    },
    conformance: {
      publicSpec: "tested-public-subset",
      thirdPartyCertification: "not-claimed",
      notes: ["GIF89a/APNG chunk subset을 바이트 테스트하지만 제3자 적합성 인증은 없음"],
    },
    externalRequirements: {
      provider: "browser-runtime",
      providers: ["Canvas PNG encoder"],
      license: "runtime-provider-terms",
      notes: ["GIF encoder/APNG assembler는 제품 구현, APNG PNG frame encoding은 browser runtime 제공"],
    },
  },
  {
    id: "mp4",
    label: "MP4 / ISO BMFF video",
    extensions: [".mp4"],
    mime: ["video/mp4"],
    category: "animation",
    import: "unsupported",
    export: "unsupported",
    roundTrip: "none",
    lossModel: ["MP4 muxer와 제품 codec 경로를 구현하지 않음"],
    runtimeRequirement: [],
    sizeBudget: {},
    status: "bridge-only",
    notes: [
      "WebM encoder/muxer가 존재해도 MP4 container 또는 H.264/AAC 지원을 뜻하지 않습니다.",
      "MP4 box writer, codec configuration record, sample table, 실제 codec provider가 모두 미구현입니다.",
    ],
    recommendedBridge: ["영상 출력은 WebM 사용", "필요하면 외부 도구에서 WebM을 MP4로 변환"],
    technicalLayers: {
      format: ["MP4 video file"],
      container: ["ISO Base Media File Format / MP4"],
      codec: [],
    },
    implementation: {
      import: "not-implemented",
      export: "not-implemented",
      notes: ["container와 codec 모두 제품 경로에 없음"],
    },
    uiWiring: {
      import: "not-applicable",
      export: "not-applicable",
      notes: ["MP4 메뉴를 노출하지 않음"],
    },
    metadata: {
      general: "not-applicable",
      icc: "not-applicable",
      notes: ["미구현이므로 metadata/ICC 보존을 주장하지 않음"],
    },
    conformance: {
      publicSpec: "not-claimed",
      thirdPartyCertification: "not-claimed",
      notes: ["ISO BMFF/MP4 적합성 또는 codec 인증을 주장하지 않음"],
    },
    externalRequirements: {
      provider: "not-selected",
      providers: [],
      license: "external-review-required",
      notes: ["향후 선택할 video/audio codec과 배포 지역에 따라 provider·특허·라이선스 검토 필요"],
    },
  },
];

type StudioInterchangeAuditFields = Pick<
  StudioInterchangeCapability,
  | "conformance"
  | "externalRequirements"
  | "implementation"
  | "metadata"
  | "productAssurance"
  | "technicalLayers"
  | "uiWiring"
>;

const STUDIO_INTERCHANGE_AUDIT_OVERRIDES: Readonly<
  Record<string, Partial<StudioInterchangeAuditFields>>
> = {
  "toonproject-archive": {
    technicalLayers: {
      format: ["ToonSpectrum project archive"],
      container: ["deterministic ZIP32 STORE subset"],
      codec: [],
    },
    metadata: {
      general: "preserved",
      icc: "preserved",
      notes: ["포함 자산 원본 바이트와 프로젝트 metadata를 hash manifest와 함께 보존"],
    },
    conformance: {
      publicSpec: "project-profile-tested",
      thirdPartyCertification: "not-claimed",
      notes: ["ToonSpectrum profile 자체 검증이며 일반 ZIP 또는 제3자 인증을 주장하지 않음"],
    },
    externalRequirements: {
      provider: "none",
      providers: [],
      license: "project-implementation-only",
      notes: ["제품의 bounded ZIP writer/reader만 사용"],
    },
  },
  png: {
    technicalLayers: {
      format: ["PNG"],
      container: ["PNG chunk stream"],
      codec: ["DEFLATE-compressed image data (browser-provided)"],
    },
    metadata: {
      general: "discarded",
      icc: "discarded",
      notes: ["Studio Canvas decode/encode 경로는 ancillary chunk와 ICC profile을 왕복하지 않음"],
    },
    conformance: {
      publicSpec: "runtime-provider-dependent",
      thirdPartyCertification: "not-claimed",
      notes: ["PNG codec 적합성은 browser runtime 경계이며 ToonSpectrum 인증을 주장하지 않음"],
    },
    externalRequirements: {
      provider: "browser-runtime",
      providers: ["browser PNG decoder/encoder"],
      license: "runtime-provider-terms",
      notes: ["제품 bundle에 별도 PNG codec을 포함하지 않음"],
    },
  },
  jpeg: {
    technicalLayers: {
      format: ["JPEG image"],
      container: ["JPEG marker stream"],
      codec: ["JPEG image codec (browser-provided)"],
    },
    metadata: {
      general: "discarded",
      icc: "discarded",
      notes: ["Canvas 경로에서 EXIF/XMP/ICC와 원본 quantization table을 왕복하지 않음"],
    },
    conformance: {
      publicSpec: "runtime-provider-dependent",
      thirdPartyCertification: "not-claimed",
      notes: ["JPEG codec 적합성은 browser runtime 경계"],
    },
    externalRequirements: {
      provider: "browser-runtime",
      providers: ["browser JPEG decoder/encoder"],
      license: "runtime-provider-terms",
      notes: ["제품 bundle에 별도 JPEG codec을 포함하지 않음"],
    },
  },
  webp: {
    technicalLayers: {
      format: ["WebP image"],
      container: ["RIFF/WebP"],
      codec: ["VP8/VP8L image codec (browser-provided)"],
    },
    metadata: {
      general: "discarded",
      icc: "discarded",
      notes: ["Canvas 경로에서 EXIF/XMP/ICC chunk를 왕복하지 않음"],
    },
    conformance: {
      publicSpec: "runtime-provider-dependent",
      thirdPartyCertification: "not-claimed",
      notes: ["WebP codec 적합성은 browser runtime 경계"],
    },
    externalRequirements: {
      provider: "browser-runtime",
      providers: ["browser WebP decoder/encoder"],
      license: "runtime-provider-terms",
      notes: ["제품 bundle에 별도 WebP codec을 포함하지 않음"],
    },
  },
  bmp: {
    technicalLayers: {
      format: ["BMP / DIB subset"],
      container: ["BITMAPFILEHEADER + DIB"],
      codec: ["uncompressed 24/32-bit RGB"],
    },
    conformance: {
      publicSpec: "tested-public-subset",
      thirdPartyCertification: "not-claimed",
      notes: ["지원 header/bit-depth subset만 바이트 테스트"],
    },
    productAssurance: {
      firstPartyCodecProvider: "implemented",
      firstPartyProviderIds: ["toonspectrum.raster.bmp.v1"],
      toonSpectrumProductCertification: "exact-byte-execution-tested",
      officialThirdPartyCertification: false,
      vendorTrademarkAuthorization: false,
      externalEvidenceRequiredForVendorClaims: true,
      notes: [
        "공개 형식의 제한 부분집합을 ToonSpectrum이 독립 구현하고 결정적 conformance evidence와 정확한 실행 바이트를 제품 소유 키로 서명할 수 있습니다.",
        "제품 인증은 BMP 공급사·표준 단체의 공식 인증 또는 상표 허가가 아닙니다.",
      ],
    },
    externalRequirements: {
      provider: "none",
      providers: [],
      license: "project-implementation-only",
      notes: ["codec 실행은 공개 형식 기반 ToonSpectrum 자체 구현이며 외부 codec provider가 필요하지 않음"],
    },
  },
  tga: {
    technicalLayers: {
      format: ["TGA true-color subset"],
      container: ["TGA header + pixel stream"],
      codec: ["uncompressed 24/32-bit true-color"],
    },
    conformance: {
      publicSpec: "tested-public-subset",
      thirdPartyCertification: "not-claimed",
      notes: ["uncompressed true-color subset만 바이트 테스트"],
    },
    productAssurance: {
      firstPartyCodecProvider: "implemented",
      firstPartyProviderIds: ["toonspectrum.raster.tga.v1"],
      toonSpectrumProductCertification: "exact-byte-execution-tested",
      officialThirdPartyCertification: false,
      vendorTrademarkAuthorization: false,
      externalEvidenceRequiredForVendorClaims: true,
      notes: [
        "공개 형식의 제한 부분집합을 ToonSpectrum이 독립 구현하고 결정적 conformance evidence와 정확한 실행 바이트를 제품 소유 키로 서명할 수 있습니다.",
        "제품 인증은 TGA 공급사·표준 단체의 공식 인증 또는 상표 허가가 아닙니다.",
      ],
    },
    externalRequirements: {
      provider: "none",
      providers: [],
      license: "project-implementation-only",
      notes: ["codec 실행은 공개 형식 기반 ToonSpectrum 자체 구현이며 외부 codec provider가 필요하지 않음"],
    },
  },
  netpbm: {
    technicalLayers: {
      format: ["Netpbm P6/P7 subset"],
      container: ["PPM/PAM header + raster"],
      codec: ["uncompressed 8-bit RGB/RGBA"],
    },
    conformance: {
      publicSpec: "tested-public-subset",
      thirdPartyCertification: "not-claimed",
      notes: ["P6/P7 safe subset만 바이트 테스트"],
    },
    productAssurance: {
      firstPartyCodecProvider: "implemented",
      firstPartyProviderIds: [
        "toonspectrum.raster.ppm.v1",
        "toonspectrum.raster.pam.v1",
      ],
      toonSpectrumProductCertification: "exact-byte-execution-tested",
      officialThirdPartyCertification: false,
      vendorTrademarkAuthorization: false,
      externalEvidenceRequiredForVendorClaims: true,
      notes: [
        "PPM과 PAM 각각의 독립 provider를 결정적 conformance evidence 및 정확한 실행 바이트 인증 경계에 연결했습니다.",
        "ToonSpectrum 제품 인증은 Netpbm 프로젝트나 외부 표준 단체의 공식 인증이 아닙니다.",
      ],
    },
    externalRequirements: {
      provider: "none",
      providers: [],
      license: "project-implementation-only",
      notes: ["codec 실행은 공개 형식 기반 ToonSpectrum 자체 구현이며 외부 codec provider가 필요하지 않음"],
    },
  },
  qoi: {
    technicalLayers: {
      format: ["Quite OK Image"],
      container: ["QOI byte stream"],
      codec: ["QOI operation stream"],
    },
    conformance: {
      publicSpec: "tested-public-subset",
      thirdPartyCertification: "not-claimed",
      notes: ["bounded QOI 3/4-channel implementation을 바이트 테스트"],
    },
    productAssurance: {
      firstPartyCodecProvider: "implemented",
      firstPartyProviderIds: ["toonspectrum.raster.qoi.v1"],
      toonSpectrumProductCertification: "exact-byte-execution-tested",
      officialThirdPartyCertification: false,
      vendorTrademarkAuthorization: false,
      externalEvidenceRequiredForVendorClaims: true,
      notes: [
        "공개 형식의 제한 부분집합을 ToonSpectrum이 독립 구현하고 결정적 conformance evidence와 정확한 실행 바이트를 제품 소유 키로 서명할 수 있습니다.",
        "제품 인증은 QOI 권리자·외부 표준 단체의 공식 인증 또는 상표 허가가 아닙니다.",
      ],
    },
    externalRequirements: {
      provider: "none",
      providers: [],
      license: "project-implementation-only",
      notes: ["codec 실행은 공개 형식 기반 ToonSpectrum 자체 구현이며 외부 codec provider가 필요하지 않음"],
    },
  },
  tiff: {
    technicalLayers: {
      format: ["TIFF 6.0 baseline subset"],
      container: ["TIFF IFD / strip layout"],
      codec: ["uncompressed 8-bit RGB/RGBA"],
    },
    metadata: {
      general: "discarded",
      icc: "discarded",
      notes: ["지원 pixel/geometry tag 외 arbitrary metadata와 ICC는 보존하지 않음"],
    },
    conformance: {
      publicSpec: "tested-public-subset",
      thirdPartyCertification: "not-claimed",
      notes: ["baseline RGB/RGBA subset만 바이트 테스트"],
    },
    productAssurance: {
      firstPartyCodecProvider: "implemented",
      firstPartyProviderIds: ["toonspectrum.raster.tiff.v1"],
      toonSpectrumProductCertification: "exact-byte-execution-tested",
      officialThirdPartyCertification: false,
      vendorTrademarkAuthorization: false,
      externalEvidenceRequiredForVendorClaims: true,
      notes: [
        "baseline 제한 부분집합을 ToonSpectrum이 독립 구현하고 결정적 conformance evidence와 정확한 실행 바이트를 제품 소유 키로 서명할 수 있습니다.",
        "제품 인증은 TIFF 공급사·표준 단체의 공식 인증 또는 상표 허가가 아닙니다.",
      ],
    },
    externalRequirements: {
      provider: "none",
      providers: [],
      license: "project-implementation-only",
      notes: ["codec 실행은 공개 형식 기반 ToonSpectrum 자체 구현이며 외부 codec provider가 필요하지 않음"],
    },
  },
  gif: {
    technicalLayers: {
      format: ["GIF image"],
      container: ["GIF data stream"],
      codec: ["GIF LZW (browser-provided decode)"],
    },
    implementation: {
      import: "runtime-dependent",
      export: "not-implemented",
      notes: ["정적/재생 요소 decode는 browser runtime 제공; 이 행은 encoder를 제공하지 않음"],
    },
    metadata: {
      general: "partial",
      icc: "discarded",
      notes: ["원본 재생 bytes는 자산으로 유지할 수 있으나 Studio 편집 metadata/ICC 왕복은 없음"],
    },
    conformance: {
      publicSpec: "runtime-provider-dependent",
      thirdPartyCertification: "not-claimed",
      notes: ["decode conformance는 browser runtime 경계"],
    },
    externalRequirements: {
      provider: "browser-runtime",
      providers: ["browser GIF decoder"],
      license: "runtime-provider-terms",
      notes: ["제품 bundle에 별도 GIF decoder를 포함하지 않음"],
    },
  },
  psd: {
    technicalLayers: {
      format: ["Adobe Photoshop Document subset"],
      container: ["PSD/PSB image resource and layer records"],
      codec: ["ag-psd supported compression modes"],
    },
    metadata: {
      general: "partial",
      icc: "not-audited",
      notes: ["허용 layer/mask 필드만 매핑하고 arbitrary Photoshop resource metadata는 왕복하지 않음"],
    },
    conformance: {
      publicSpec: "not-claimed",
      thirdPartyCertification: "not-claimed",
      notes: ["Adobe 공식 호환성 또는 인증을 주장하지 않음"],
    },
    externalRequirements: {
      provider: "bundled-library",
      providers: ["ag-psd"],
      license: "bundled-dependency-terms",
      notes: ["지원 범위와 배포 조건은 고정된 dependency version 및 해당 라이선스 경계"],
    },
  },
  toonink: {
    technicalLayers: {
      format: ["ToonSpectrum InkEnvelope v1"],
      container: ["canonical UTF-8 JSON envelope"],
      codec: [],
    },
    conformance: {
      publicSpec: "project-profile-tested",
      thirdPartyCertification: "not-claimed",
      notes: ["ToonSpectrum self-conformance/attestation이며 외부 SDK·상표 인증이 아님"],
    },
    productAssurance: {
      firstPartyCodecProvider: "implemented",
      firstPartyProviderIds: ["toonspectrum.ink-envelope.v1"],
      toonSpectrumProductCertification: "exact-byte-execution-tested",
      officialThirdPartyCertification: false,
      vendorTrademarkAuthorization: false,
      externalEvidenceRequiredForVendorClaims: true,
      notes: [
        "결정적 provider 실행, canonical 왕복 conformance evidence, 정확한 출력 바이트를 ToonSpectrum 제품 소유 키로 함께 서명·검증할 수 있습니다.",
        "이 제품 인증은 외부 잉크 SDK·형식 공급사의 공식 인증 또는 상표 허가를 주장하지 않습니다.",
      ],
    },
    externalRequirements: {
      provider: "none",
      providers: [],
      license: "project-implementation-only",
      notes: ["선택 서명 키의 소유·운영 책임은 호출 조직에 있음"],
    },
  },
  inkml: {
    technicalLayers: {
      format: ["ToonSpectrum InkML safe profile"],
      container: ["UTF-8 XML"],
      codec: [],
    },
    conformance: {
      publicSpec: "tested-public-subset",
      thirdPartyCertification: "not-claimed",
      notes: [
        "공개 InkML에서 정의한 제한 profile만 검증하며 full processor conformance는 주장하지 않음",
        "결정적 왕복 오차·보안 예산·SHA-256 receipt는 Wacom WILL/UIM 호환 인증이 아님",
      ],
    },
    productAssurance: {
      firstPartyCodecProvider: "implemented",
      firstPartyProviderIds: ["toonspectrum.public-inkml-subset.v1"],
      toonSpectrumProductCertification: "exact-byte-execution-tested",
      officialThirdPartyCertification: false,
      vendorTrademarkAuthorization: false,
      externalEvidenceRequiredForVendorClaims: true,
      notes: [
        "제한형 InkML provider의 결정적 실행, 다중 채널 왕복 conformance evidence, 정확한 출력 바이트를 ToonSpectrum 제품 소유 키로 함께 서명·검증할 수 있습니다.",
        "이 상태는 W3C 전체 processor 적합성, Wacom WILL/UIM 호환, 공급사 공식 인증 또는 상표 허가를 의미하지 않습니다.",
      ],
    },
    externalRequirements: {
      provider: "browser-runtime",
      providers: ["DOMParser"],
      license: "runtime-provider-terms",
      notes: ["상용 ink SDK 또는 비공개 wire format을 사용하지 않음"],
    },
  },
  "will-v1-path-stream": {
    technicalLayers: {
      format: ["WILL Data Format v1 Annex A Path strict subset"],
      container: ["§5.3.3 Base-128 length-delimited Path sequence"],
      codec: ["proto2 Path fields 1–6 with packed/unpacked sint32"],
    },
    implementation: {
      import: "implemented",
      export: "implemented",
      notes: [
        "공개 v1 명세 기반 clean-room 구현이며 Annex B OPC/ZIP 문서 container는 별도 모듈 경계입니다.",
      ],
    },
    conformance: {
      publicSpec: "tested-public-subset",
      thirdPartyCertification: "not-claimed",
      notes: [
        "공개 WILL v1 Annex A와 §5.3.3의 제한 프로필만 프로젝트 golden vector·대형 경로·공격 벡터로 검증합니다.",
        "Wacom 공식 conformance, SDK provenance, WILL 3/UIM 상호운용을 주장하지 않습니다.",
      ],
    },
    productAssurance: {
      firstPartyCodecProvider: "implemented",
      firstPartyProviderIds: ["toonspectrum.will-v1-annex-a.v1"],
      toonSpectrumProductCertification: "exact-byte-execution-tested",
      officialThirdPartyCertification: false,
      vendorTrademarkAuthorization: false,
      externalEvidenceRequiredForVendorClaims: true,
      notes: [
        "정확한 Path 입력·출력 바이트, provider receipt, deterministic conformance evidence를 ToonSpectrum 제품 소유 키로 함께 서명·검증할 수 있습니다.",
        "이 제품 인증은 Wacom의 공식 인증, SDK 라이선스, 상표 허가 또는 전체 .will 문서 적합성이 아닙니다.",
      ],
    },
    externalRequirements: {
      provider: "none",
      providers: [],
      license: "project-implementation-only",
      notes: [
        "공개 v1 specification과 public patent license 경계의 ToonSpectrum 독립 구현만 사용합니다.",
      ],
    },
  },
  "will-v1-document": {
    technicalLayers: {
      format: ["WILL Data Format v1 Annex B ToonSpectrum bounded profile"],
      container: ["deterministic OPC ZIP32 seven-part package"],
      codec: ["Annex A protobuf Path stream", "strict UTF-8 XML/SVG"],
    },
    implementation: {
      import: "implemented",
      export: "implemented",
      notes: [
        "정확한 7-part bounded profile만 구현하며 extra part와 vendor extension은 거부합니다.",
      ],
    },
    conformance: {
      publicSpec: "tested-public-subset",
      thirdPartyCertification: "not-claimed",
      notes: [
        "공개 Annex B 문서 구조와 Annex A stroke stream을 프로젝트 golden archive·공격 벡터로 검증합니다.",
        "공개 명세에 없는 section relationship Type은 명시적인 ToonSpectrum 프로필이며 Wacom 공식 적합성 주장이 아닙니다.",
      ],
    },
    productAssurance: {
      firstPartyCodecProvider: "implemented",
      firstPartyProviderIds: [
        "toonspectrum.will-v1-annex-b-document.v1",
      ],
      toonSpectrumProductCertification: "exact-byte-execution-tested",
      officialThirdPartyCertification: false,
      vendorTrademarkAuthorization: false,
      externalEvidenceRequiredForVendorClaims: true,
      notes: [
        "결정적 7-part 문서 출력, provider receipt, Annex B conformance evidence와 exact output bytes를 ToonSpectrum 제품 소유 키로 함께 서명·검증합니다.",
        "이 제품 인증은 Wacom 공식 인증·SDK 라이선스·상표 허가 또는 임의 vendor .will 상호운용 인증이 아닙니다.",
      ],
    },
    externalRequirements: {
      provider: "none",
      providers: [],
      license: "project-implementation-only",
      notes: [
        "공개 v1 specification과 public patent license 경계의 ToonSpectrum clean-room 구현만 사용합니다.",
      ],
    },
  },
  pdf: {
    technicalLayers: {
      format: ["PDF 1.4 image publication subset"],
      container: ["PDF object/xref structure"],
      codec: ["JPEG page image"],
    },
    metadata: {
      general: "discarded",
      icc: "discarded",
      notes: ["편집 구조·문서 metadata·output intent/ICC를 쓰지 않는 이미지 PDF"],
    },
    conformance: {
      publicSpec: "tested-public-subset",
      thirdPartyCertification: "not-claimed",
      notes: ["PDF/X·PDF/A 또는 인쇄소 인증을 주장하지 않음"],
    },
  },
  webm: {
    technicalLayers: {
      format: ["WebM video"],
      container: ["Matroska/WebM"],
      codec: ["VP8", "VP9", "AV1 (runtime-dependent WebCodecs path)"],
    },
    implementation: {
      import: "not-implemented",
      export: "runtime-dependent",
      notes: [
        "visible export는 MediaRecorder WebM 경로",
        "first-party EBML muxer + WebCodecs VP8/VP9/AV1 경로는 engine implementation이며 runtime capability gate를 사용",
      ],
    },
    uiWiring: {
      import: "not-applicable",
      export: "wired",
      notes: ["프레임 애니메이션/모션/타임랩스 WebM 내보내기 UI 연결"],
    },
    metadata: {
      general: "discarded",
      icc: "discarded",
      notes: ["타임라인을 최종 영상으로 렌더하며 편집 metadata·ICC를 container에 기록하지 않음"],
    },
    conformance: {
      publicSpec: "tested-public-subset",
      thirdPartyCertification: "not-claimed",
      notes: ["first-party WebM muxer 구조를 테스트하지만 WebM/codec 제3자 인증은 주장하지 않음"],
    },
    externalRequirements: {
      provider: "browser-runtime",
      providers: ["MediaRecorder", "VideoEncoder"],
      license: "runtime-provider-terms",
      notes: ["container muxer는 제품 구현, 실제 video encoder는 browser runtime 제공"],
    },
  },
  ora: {
    technicalLayers: {
      format: ["OpenRaster subset"],
      container: ["ZIP32 STORE/DEFLATE"],
      codec: ["PNG layers"],
    },
    metadata: {
      general: "partial",
      icc: "not-audited",
      notes: ["허용 stack/layer metadata만 보존; 중첩 그룹 효과와 arbitrary metadata는 왕복하지 않음"],
    },
    conformance: {
      publicSpec: "tested-public-subset",
      thirdPartyCertification: "not-claimed",
      notes: ["bounded OpenRaster subset이며 공식 인증을 주장하지 않음"],
    },
  },
  cbz: {
    technicalLayers: {
      format: ["Comic Book ZIP subset"],
      container: ["ZIP32 STORE/DEFLATE"],
      codec: ["PNG", "JPEG", "WebP", "GIF page images"],
    },
    metadata: {
      general: "partial",
      icc: "not-audited",
      notes: ["ComicInfo.xml 허용 필드만 요약하며 page image color metadata는 별도 보존 보장 없음"],
    },
    conformance: {
      publicSpec: "tested-public-subset",
      thirdPartyCertification: "not-claimed",
      notes: ["bounded CBZ/ComicInfo safe subset이며 제3자 인증을 주장하지 않음"],
    },
  },
};

function implementationStatusFor(
  direction: StudioInterchangeDirectionSupport
): StudioInterchangeImplementationStatus {
  if (direction === "available" || direction === "engine-ready") return "implemented";
  if (direction === "partial") return "partial";
  return "not-implemented";
}

function uiWiringFor(direction: StudioInterchangeDirectionSupport): StudioInterchangeUiWiring {
  if (direction === "available") return "wired";
  if (direction === "engine-ready") return "not-wired";
  if (direction === "partial") return "partial";
  return "not-applicable";
}

function auditedCapability(
  definition: StudioInterchangeCapabilityDefinition
): StudioInterchangeCapability {
  const override = STUDIO_INTERCHANGE_AUDIT_OVERRIDES[definition.id];
  const proprietaryExternalRequirements: StudioInterchangeExternalRequirements | undefined =
    definition.proprietary
      ? {
          provider: "not-selected",
          providers: [],
          license: "external-review-required",
          notes: ["직접 codec/provider를 선택하지 않았으며 권리자 공식 지원·인증을 주장하지 않음"],
        }
      : undefined;
  const metadata: StudioInterchangeMetadataPolicy =
    definition.metadata ??
    override?.metadata ?? {
      general: "not-audited",
      icc: "not-audited",
      notes: ["metadata/ICC 왕복 여부를 별도 검증하기 전에는 보존을 주장하지 않음"],
    };
  const conformance: StudioInterchangeConformance =
    definition.conformance ??
    override?.conformance ?? {
      publicSpec: "not-claimed",
      thirdPartyCertification: "not-claimed",
      notes: ["공개 규격 전체 적합성 또는 제3자 인증을 주장하지 않음"],
    };
  const productAssurance: StudioInterchangeProductAssurance =
    definition.productAssurance ??
    override?.productAssurance ?? {
      firstPartyCodecProvider: "not-claimed",
      firstPartyProviderIds: [],
      toonSpectrumProductCertification: "not-connected",
      officialThirdPartyCertification: false,
      vendorTrademarkAuthorization: false,
      externalEvidenceRequiredForVendorClaims: true,
      notes: [
        "ToonSpectrum 자체 codec provider 또는 제품 인증 연결을 이 capability 행에서 주장하지 않습니다.",
        "외부 공급사 인증·상표 허가는 해당 권리자가 발급한 별도 증명이 필요합니다.",
      ],
    };
  const externalRequirements: StudioInterchangeExternalRequirements =
    definition.externalRequirements ??
    override?.externalRequirements ??
    proprietaryExternalRequirements ?? {
      provider: "not-audited",
      providers: [],
      license: "not-audited",
      notes: ["provider/배포 라이선스 경계를 감사하기 전에는 자유로운 사용을 주장하지 않음"],
    };

  return Object.freeze({
    ...definition,
    technicalLayers:
      definition.technicalLayers ??
      override?.technicalLayers ?? {
        format: [definition.label],
        container: [],
        codec: [],
      },
    implementation:
      definition.implementation ??
      override?.implementation ?? {
        import: implementationStatusFor(definition.import),
        export: implementationStatusFor(definition.export),
        notes: [],
      },
    uiWiring:
      definition.uiWiring ??
      override?.uiWiring ?? {
        import: uiWiringFor(definition.import),
        export: uiWiringFor(definition.export),
        notes: [],
      },
    metadata,
    conformance,
    productAssurance,
    externalRequirements,
  });
}

export const STUDIO_INTERCHANGE_CAPABILITIES: readonly StudioInterchangeCapability[] =
  Object.freeze(STUDIO_INTERCHANGE_CAPABILITY_DEFINITIONS.map(auditedCapability));

export function studioInterchangeCapability(id: string): StudioInterchangeCapability | undefined {
  return STUDIO_INTERCHANGE_CAPABILITIES.find((capability) => capability.id === id);
}

export function studioInterchangeCapabilitiesForExtension(extension: string): readonly StudioInterchangeCapability[] {
  const normalized = extension.trim().toLowerCase();
  const withDot = normalized.startsWith(".") ? normalized : `.${normalized}`;
  return STUDIO_INTERCHANGE_CAPABILITIES.filter((capability) => capability.extensions.includes(withDot));
}

export function studioDirectlySupportedInterchangeCapabilities(): readonly StudioInterchangeCapability[] {
  return STUDIO_INTERCHANGE_CAPABILITIES.filter((capability) =>
    capability.import !== "unsupported" || capability.export !== "unsupported"
  );
}
