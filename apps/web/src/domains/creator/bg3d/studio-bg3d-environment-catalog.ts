/**
 * First-party CC0 environment catalog for Studio BG3D.
 *
 * Entries are immutable deployment metadata. Runtime bytes still pass through the same SHA-256,
 * GLB structure, device-budget, and Three.js admission path as a user-imported model.
 */

export const STUDIO_BG3D_ENVIRONMENT_PACK_ID =
  "toonspectrum-bg3d-environment-pack-v1" as const;
export const STUDIO_BG3D_ENVIRONMENT_PACK_VERSION = 1 as const;

export type StudioBg3dEnvironmentTheme =
  | "home"
  | "hospitality"
  | "urban"
  | "education"
  | "healthcare"
  | "heritage"
  | "retail"
  | "transit"
  | "fantasy"
  | "science-fiction";

export interface StudioBg3dEnvironmentProvenance {
  readonly origin: "original-procedural";
  readonly author: "ToonSpectrum";
  readonly generator:
    | "scripts/blender/generate_environment_pack_v3.py"
    | "scripts/blender/generate_environment_pack_v4.py"
    | "scripts/blender/generate_environment_pack_v5.py";
  readonly blenderVersion: "5.2";
  readonly license: "CC0-1.0";
  readonly licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/";
  readonly attributionRequired: false;
  readonly commercialUse: true;
  readonly externalResources: 0;
}

export interface StudioBg3dEnvironmentAsset {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly theme: StudioBg3dEnvironmentTheme;
  readonly tags: readonly string[];
  readonly fileName: `${string}.glb`;
  readonly url: `/assets/3d/environments/${string}.glb`;
  readonly thumbnailUrl: `/assets/3d/environments/thumbnails/${string}.png`;
  readonly byteSize: number;
  readonly sha256: `sha256:${string}`;
  /** Width, height, and depth in the glTF Y-up metre convention. */
  readonly bounds: readonly [number, number, number];
  readonly camera: {
    readonly position: readonly [number, number, number];
    readonly target: readonly [number, number, number];
    readonly fovDegrees: number;
  };
  readonly normalization: "authored-metres";
  readonly provenance: StudioBg3dEnvironmentProvenance;
}

const V3_PROVENANCE = Object.freeze({
  origin: "original-procedural",
  author: "ToonSpectrum",
  generator: "scripts/blender/generate_environment_pack_v3.py",
  blenderVersion: "5.2",
  license: "CC0-1.0",
  licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
  attributionRequired: false,
  commercialUse: true,
  externalResources: 0,
} as const);

const V4_PROVENANCE = Object.freeze({
  ...V3_PROVENANCE,
  generator: "scripts/blender/generate_environment_pack_v4.py",
} as const);

const V5_PROVENANCE = Object.freeze({
  ...V3_PROVENANCE,
  generator: "scripts/blender/generate_environment_pack_v5.py",
} as const);

function defineEnvironment(
  input: Omit<StudioBg3dEnvironmentAsset, "normalization" | "provenance">,
  provenance: StudioBg3dEnvironmentProvenance = V3_PROVENANCE,
): StudioBg3dEnvironmentAsset {
  return Object.freeze({
    ...input,
    tags: Object.freeze([...input.tags]),
    bounds: Object.freeze([...input.bounds]) as readonly [number, number, number],
    camera: Object.freeze({
      position: Object.freeze([...input.camera.position]) as readonly [number, number, number],
      target: Object.freeze([...input.camera.target]) as readonly [number, number, number],
      fovDegrees: input.camera.fovDegrees,
    }),
    normalization: "authored-metres",
    provenance,
  });
}

export const STUDIO_BG3D_ENVIRONMENT_ASSETS_V3 = Object.freeze([
  defineEnvironment({
    id: "ts-bg3d-compact_apartment_interior-v1",
    name: "콤팩트 아파트",
    description: "주방·거실·침실·식사 공간이 한 프레임에 이어지는 오픈 월 소형 주거 세트",
    theme: "home",
    tags: ["apartment", "interior", "home", "아파트", "원룸", "실내"],
    fileName: "compact_apartment_interior.glb",
    url: "/assets/3d/environments/compact_apartment_interior.glb",
    thumbnailUrl: "/assets/3d/environments/thumbnails/compact_apartment_interior.png",
    byteSize: 1_520_948,
    sha256: "sha256:c5409d3c3050725fa14afc67f5d63168ead262d352bcd7294018dd8cf11cdde9",
    bounds: [7, 3.2, 6],
    camera: { position: [8.8, 6.8, 9.6], target: [0, 1.25, 0], fovDegrees: 44 },
  }),
  defineEnvironment({
    id: "ts-bg3d-stylized_cafe_interior-v1",
    name: "스타일라이즈드 카페",
    description: "서비스 바·에스프레소 머신·진열장·12석 테이블을 갖춘 밝은 카페 세트",
    theme: "hospitality",
    tags: ["cafe", "coffee", "restaurant", "카페", "커피숍", "실내"],
    fileName: "stylized_cafe_interior.glb",
    url: "/assets/3d/environments/stylized_cafe_interior.glb",
    thumbnailUrl: "/assets/3d/environments/thumbnails/stylized_cafe_interior.png",
    byteSize: 2_476_104,
    sha256: "sha256:f0e038d48f6906c1316e3cbb633cb92c72a0053091acdb28a83d11b74e9cee2a",
    bounds: [9, 3.6, 7],
    camera: { position: [11.4, 8.1, 12.8], target: [0, 1.35, 0.4], fovDegrees: 44 },
  }),
  defineEnvironment({
    id: "ts-bg3d-urban_neon_alley-v1",
    name: "어반 네온 골목",
    description: "양면 건물·비상계단·배관·간판·젖은 노면을 따라 전후 이동 가능한 야간 골목",
    theme: "urban",
    tags: ["alley", "neon", "cyberpunk", "street", "골목", "야경", "도시"],
    fileName: "urban_neon_alley.glb",
    url: "/assets/3d/environments/urban_neon_alley.glb",
    thumbnailUrl: "/assets/3d/environments/thumbnails/urban_neon_alley.png",
    byteSize: 2_971_100,
    sha256: "sha256:4506e1d3fe34bfcd2dd754f237047c33d5a749218cdf7fb71266b98374e358e3",
    bounds: [6.8, 7, 14],
    camera: { position: [0, 5.7, 19], target: [0, 2.55, -1], fovDegrees: 44 },
  }),
  defineEnvironment({
    id: "ts-bg3d-classroom_art_studio-v1",
    name: "미술 교실 스튜디오",
    description: "8개 이젤·드로잉 스툴·조각대·물감 수납·개수대를 갖춘 미술 수업 공간",
    theme: "education",
    tags: ["classroom", "art", "studio", "school", "교실", "미술실", "학교"],
    fileName: "classroom_art_studio.glb",
    url: "/assets/3d/environments/classroom_art_studio.glb",
    thumbnailUrl: "/assets/3d/environments/thumbnails/classroom_art_studio.png",
    byteSize: 2_167_224,
    sha256: "sha256:b0e14d9e45b8181798a09fc675d6c3aadf46bae5a2b24200fe751518c55016d8",
    bounds: [10, 4, 8],
    camera: { position: [12.8, 9.4, 14.2], target: [0, 1.45, 0], fovDegrees: 44 },
  }),
  defineEnvironment({
    id: "ts-bg3d-fantasy_ruin_courtyard-v1",
    name: "판타지 유적 안뜰",
    description: "부서진 열주·3개 석조 아치·룬 분수·덩굴이 둘러싼 원형 판타지 코트야드",
    theme: "fantasy",
    tags: ["fantasy", "ruin", "courtyard", "magic", "판타지", "유적", "마법"],
    fileName: "fantasy_ruin_courtyard.glb",
    url: "/assets/3d/environments/fantasy_ruin_courtyard.glb",
    thumbnailUrl: "/assets/3d/environments/thumbnails/fantasy_ruin_courtyard.png",
    byteSize: 2_081_960,
    sha256: "sha256:cd7b7aaa142c473b8373c9d666edc2d130ee0735a2290502489d721f1d87cb22",
    bounds: [11.4, 6, 11.4],
    camera: { position: [14.7, 11.2, 16.5], target: [0, 2, 0], fovDegrees: 44 },
  }),
  defineEnvironment({
    id: "ts-bg3d-scifi_command_corridor-v1",
    name: "SF 커맨드 복도",
    description: "반복 리브·서비스 패널·12석 지휘 베이·홀로그램을 잇는 장거리 우주선 복도",
    theme: "science-fiction",
    tags: ["scifi", "corridor", "command", "spaceship", "SF", "우주선", "복도"],
    fileName: "scifi_command_corridor.glb",
    url: "/assets/3d/environments/scifi_command_corridor.glb",
    thumbnailUrl: "/assets/3d/environments/thumbnails/scifi_command_corridor.png",
    byteSize: 3_486_400,
    sha256: "sha256:a2eff1b6d07f8e09ef2f1deebc240dd5ccb591384bce59d5f092cc4dd0d59821",
    bounds: [7, 4.5, 16],
    camera: { position: [0, 4.9, 20.5], target: [0, 2, -2.8], fovDegrees: 44 },
  }),
] as const satisfies readonly StudioBg3dEnvironmentAsset[]);

export const STUDIO_BG3D_ENVIRONMENT_ASSETS_V4 = Object.freeze([
  defineEnvironment({
    id: "ts-bg3d-hospital_emergency_nurse_station-v1",
    name: "병원 응급실 · 간호 스테이션",
    description: "중앙 간호 스테이션·3개 응급 베이·환자 침대·바이탈 모니터·IV·약품장을 갖춘 의료 세트",
    theme: "healthcare",
    tags: ["hospital", "emergency", "nurse station", "병원", "응급실", "간호 스테이션"],
    fileName: "hospital_emergency_nurse_station.glb",
    url: "/assets/3d/environments/hospital_emergency_nurse_station.glb",
    thumbnailUrl: "/assets/3d/environments/thumbnails/hospital_emergency_nurse_station.png",
    byteSize: 2_263_556,
    sha256: "sha256:7c08f38b2dfdeb418fadfca4ee24f0e73b92f9b20abcde11f29a67d5dae9a8e6",
    bounds: [12, 4.2, 9],
    camera: { position: [14.2, 9.4, 14.5], target: [0, 1.35, -1], fovDegrees: 46 },
  }, V4_PROVENANCE),
  defineEnvironment({
    id: "ts-bg3d-korean_school_rooftop-v1",
    name: "한국 학교 옥상",
    description: "안전 펜스·계단실·물탱크·태양광 패널·실외기·벤치와 화단이 있는 한국형 학교 옥상",
    theme: "education",
    tags: ["school", "rooftop", "korea", "학교", "옥상", "한국"],
    fileName: "korean_school_rooftop.glb",
    url: "/assets/3d/environments/korean_school_rooftop.glb",
    thumbnailUrl: "/assets/3d/environments/thumbnails/korean_school_rooftop.png",
    byteSize: 1_871_832,
    sha256: "sha256:00a2ca9dd79b1e4957e94df7e2e9824e7c404e85f98bc45dc4691934d3e18115",
    bounds: [15, 4, 12],
    camera: { position: [18, 12, 18.5], target: [0, 1.15, -0.2], fovDegrees: 46 },
  }, V4_PROVENANCE),
  defineEnvironment({
    id: "ts-bg3d-hanok_market_courtyard-v1",
    name: "한옥 장터 안마당",
    description: "삼면 한옥·격자문·기와지붕·장터 좌판·등롱·옹기가 둘러싼 전통 시장 안마당",
    theme: "heritage",
    tags: ["hanok", "market", "courtyard", "korea", "한옥", "장터", "안마당"],
    fileName: "hanok_market_courtyard.glb",
    url: "/assets/3d/environments/hanok_market_courtyard.glb",
    thumbnailUrl: "/assets/3d/environments/thumbnails/hanok_market_courtyard.png",
    byteSize: 2_335_872,
    sha256: "sha256:64540cd8540a6e8768152ae78bb908b97853aea064a263b9c43cd9b2373fe766",
    bounds: [16, 4.2, 13],
    camera: { position: [18.5, 11.8, 19], target: [0, 1.45, -0.7], fovDegrees: 46 },
  }, V4_PROVENANCE),
] as const satisfies readonly StudioBg3dEnvironmentAsset[]);

export const STUDIO_BG3D_ENVIRONMENT_ASSETS_V5 = Object.freeze([
  defineEnvironment({
    id: "ts-bg3d-korean_convenience_store_night-v1",
    name: "한국 편의점 · 야간",
    description: "유리 전면·야간 간판·냉장고·진열대·계산대·즉석조리 코너를 갖춘 한국형 편의점 실내",
    theme: "retail",
    tags: ["convenience store", "retail", "night", "korea", "편의점", "야간", "매장"],
    fileName: "korean_convenience_store_night.glb",
    url: "/assets/3d/environments/korean_convenience_store_night.glb",
    thumbnailUrl: "/assets/3d/environments/thumbnails/korean_convenience_store_night.png",
    byteSize: 3_748_664,
    sha256: "sha256:e31665694ca5ab05e09736d24623a4bfe14cc07b9f60bec261445f7dcf6f476e",
    bounds: [10, 3.8, 8.9],
    camera: { position: [8.8, 8.4, 17.8], target: [0, 1.35, 0.15], fovDegrees: 43 },
  }, V5_PROVENANCE),
  defineEnvironment({
    id: "ts-bg3d-seoul_subway_platform-v1",
    name: "서울 지하철 승강장",
    description: "스크린도어·선로·점자 블록·노선 안내·벤치·기둥·CCTV를 따라 깊게 이동 가능한 도시철도 승강장",
    theme: "transit",
    tags: ["subway", "platform", "transit", "seoul", "지하철", "승강장", "서울"],
    fileName: "seoul_subway_platform.glb",
    url: "/assets/3d/environments/seoul_subway_platform.glb",
    thumbnailUrl: "/assets/3d/environments/thumbnails/seoul_subway_platform.png",
    byteSize: 3_734_156,
    sha256: "sha256:d5670f9e0240402fbf69308bbbdfb936775c6a3c30420bd693f5747b71598669",
    bounds: [13.9, 4.5, 20],
    camera: { position: [-2.3, 2.25, 9.25], target: [0.2, 1.75, -3], fovDegrees: 38 },
  }, V5_PROVENANCE),
  defineEnvironment({
    id: "ts-bg3d-fantasy_alchemist_workshop_library-v1",
    name: "판타지 연금술 공방 · 서재",
    description: "벽면 서재·중앙 연금술대·가마솥·증류기·포션 선반·수정과 약초가 채워진 마법 공방",
    theme: "fantasy",
    tags: ["fantasy", "alchemy", "workshop", "library", "연금술", "공방", "서재", "판타지"],
    fileName: "fantasy_alchemist_workshop_library.glb",
    url: "/assets/3d/environments/fantasy_alchemist_workshop_library.glb",
    thumbnailUrl: "/assets/3d/environments/thumbnails/fantasy_alchemist_workshop_library.png",
    byteSize: 3_610_428,
    sha256: "sha256:c8aa1be5f39a09b369f21fef47455f1070117947973fdee73c4b24c7e6bf675c",
    bounds: [12, 5.8, 10],
    camera: { position: [15.2, 10.6, 17], target: [0, 2.05, -0.25], fovDegrees: 46 },
  }, V5_PROVENANCE),
] as const satisfies readonly StudioBg3dEnvironmentAsset[]);

export const STUDIO_BG3D_ENVIRONMENT_ASSETS = Object.freeze([
  ...STUDIO_BG3D_ENVIRONMENT_ASSETS_V3,
  ...STUDIO_BG3D_ENVIRONMENT_ASSETS_V4,
  ...STUDIO_BG3D_ENVIRONMENT_ASSETS_V5,
] as const satisfies readonly StudioBg3dEnvironmentAsset[]);

const ENVIRONMENT_BY_ID = new Map(
  STUDIO_BG3D_ENVIRONMENT_ASSETS.map((asset) => [asset.id, asset] as const),
);
const ENVIRONMENT_BY_HASH = new Map(
  STUDIO_BG3D_ENVIRONMENT_ASSETS.map((asset) => [asset.sha256, asset] as const),
);

export function getStudioBg3dEnvironmentAsset(
  id: string,
): StudioBg3dEnvironmentAsset | null {
  return ENVIRONMENT_BY_ID.get(id) ?? null;
}

export function getStudioBg3dEnvironmentAssetByHash(
  hash: string,
): StudioBg3dEnvironmentAsset | null {
  return ENVIRONMENT_BY_HASH.get(hash as `sha256:${string}`) ?? null;
}

export function isStudioBg3dEnvironmentAssetId(id: string): boolean {
  return ENVIRONMENT_BY_ID.has(id);
}
