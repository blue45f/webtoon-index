import {
  getProductStudioVrmAssetSqliteOpfsRepository,
  StudioVrmAssetRepositoryError,
  type StudioVrmAssetSqliteOpfsRepository,
  type StudioVrmModelAsset,
  type StudioVrmModelAssetMetadata,
  type StudioVrmThumbnailAsset,
} from "./studio-vrm-asset-sqlite-opfs-repository";
import {
  getProductStudioVrmLicenseAuthorityStore,
  type StudioVrmLicenseAuthorityStore,
} from "./studio-vrm-license-authority-store";
import {
  inspectStudioVrmLicenseAuthority,
  type StudioVrmLicenseAuthority,
} from "./studio-vrm-license-product-gate";

const DB_NAME = "toonspectrum-studio-vrm-library";
const DB_VERSION = 1;
const MODEL_STORE = "models";
const THUMBNAIL_STORE = "thumbnails";

const SHA256_CONTENT_HASH_PATTERN = /^sha256:([0-9a-f]{64})$/i;
const GLB_HEADER_BYTES = 12;
const GLB_CHUNK_HEADER_BYTES = 8;
const GLB_MAGIC = 0x46546c67;
const GLB_VERSION = 2;
const GLB_JSON_CHUNK_TYPE = 0x4e4f534a;
const MAX_VRM_JSON_CHUNK_BYTES = 8 * 1024 * 1024;

/**
 * 업로드 한 건을 검증·해시할 때 브라우저 메모리에 파일 전체가 한 번 올라간다.
 * 현재 번들 중 가장 큰 모델(약 20 MB)에 충분한 여유를 두되, 무제한 Blob 할당은 막는다.
 */
export const MAX_VRM_UPLOAD_BYTES = 128 * 1024 * 1024;
export const VRM_VALIDATION_VERSION = 1;
export const VRM_LIBRARY_THUMBNAIL_WINDOW_MAX_ITEMS = 12;
export const VRM_LIBRARY_THUMBNAIL_WINDOW_MAX_BYTES = 24 * 1024 * 1024;

export type VrmContentHash = `sha256:${string}`;

export const SAMPLE_VRM_ID = "sample-vrm";
export const SAMPLE_VRM_URL = "/vrm/sample.vrm";

export type VrmStoredModelRecord = {
  id: string;
  name: string;
  blob: Blob;
  thumbnail: string | null;
  createdAt: number;
  updatedAt: number;
  /** DB v1 레거시 행에는 없을 수 있다. */
  contentHash?: VrmContentHash;
  byteSize?: number;
  mimeType?: string;
  validationVersion?: number;
  /** Raw GLB JSON에서 검증한 로컬 action-policy authority. 모델 manifest에는 넣지 않는다. */
  licenseAuthority?: StudioVrmLicenseAuthority;
};

export type VrmStoredModelWithContentIdentity = VrmStoredModelRecord & {
  contentHash: VrmContentHash;
  byteSize: number;
  mimeType: string;
  validationVersion: number;
};

export interface SaveVerifiedVrmBlobDisposition {
  /** Fully verified canonical library row returned by the durable writer. */
  readonly record: VrmStoredModelRecord;
  /** False means the content hash already belonged to an existing shared library row. */
  readonly created: boolean;
}

export type VrmLibraryEntry = {
  id: string;
  name: string;
  source: "memory" | "sample" | "sqlite-opfs";
  thumbnail: string | null;
  createdAt: number;
  updatedAt: number;
  contentHash?: VrmContentHash;
  byteSize?: number;
  mimeType?: string;
  licenseAuthority?: StudioVrmLicenseAuthority;
};

export interface VrmLibraryStorageOptions {
  /** Product default. Tests may inject one repository backed by memory SQLite + fake OPFS. */
  readonly repository?: StudioVrmAssetSqliteOpfsRepository;
  /** Tests/embeds may inject the receipt store without opening the product SQLite runtime. */
  readonly licenseAuthorityStore?: StudioVrmLicenseAuthorityStore;
  /** Explicit pre-V12 test/embed seam. Product code never supplies or probes this value. */
  readonly legacyIndexedDb?: IDBFactory | null;
}

export interface VrmUploadedLibraryEntryPage {
  readonly items: readonly VrmLibraryEntry[];
  readonly cursor: string;
  readonly nextCursor: string | null;
  readonly totalCount: number;
  readonly totalBytes: number;
  readonly generation: number;
}

export type BundledVrmVisibility = "default" | "legacy";

export type BundledVrmLimitation =
  | "no-expressions"
  | "limited-hand-rig"
  | "heavy-payload";

export type SampleVrm = {
  id: string;
  name: string;
  url: string;
  /** Optional same-origin card art for bundled characters. */
  thumbnailUrl?: string;
  /** Legacy models remain resolvable for saved projects but are hidden from the default picker. */
  visibility?: BundledVrmVisibility;
  /** Audited capability or delivery limitations; absence means no catalog-level warning. */
  limitations?: readonly BundledVrmLimitation[];
};

export function buildFallbackVrmLibraryThumbnail(name: string, id: string): string {
  let hash = 0;
  const seed = `${name}:${id}`;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) & 0xffffffff;
  }
  const hue = Math.abs(hash % 360);
  const safeText = (name || "VRM").replace(/[<>]/g, "").slice(0, 10);
  const label = safeText.trim() || "VRM";
  const initials = label.replace(/\s+/g, "").slice(0, 2).toUpperCase();
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180">
  <defs>
    <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="hsl(${hue} 68% 24%)" />
      <stop offset="100%" stop-color="hsl(${(hue + 35) % 360} 78% 40%)" />
    </linearGradient>
    <filter id="glow" x="-40%" y="-40%" width="180%" height="180%">
      <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="white" flood-opacity="0.22" />
    </filter>
  </defs>
  <rect width="320" height="180" rx="20" fill="url(#g)" />
  <circle cx="160" cy="86" r="54" fill="rgba(255,255,255,0.22)" />
  <text x="160" y="110" font-size="44" text-anchor="middle" fill="#f9e7ce" font-family="Arial, 'Malgun Gothic', sans-serif" filter="url(#glow)" font-weight="700">${initials}</text>
  <text x="160" y="156" font-size="20" text-anchor="middle" fill="#f5debe" font-family="Arial, 'Malgun Gothic', sans-serif">${label}</text>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export type BundledVrmRightsBlock = SampleVrm & {
  status: "rights-blocked";
  reasonCode: "redistribution-commercial-restriction";
  notice: string;
};

type VrmThumbnailRecord = {
  id: string;
  thumbnail: string;
  updatedAt: number;
};

/**
 * 과거 번들 감사와 저장 문서 추적을 위해 차단 기록만 남기고, 배포 바이너리·신규
 * 카탈로그 제공·런타임 로드는 모두 차단한 모델. 원 라이선스를 임의로 재분류하지
 * 않고 권리 제한 사실과 사유를 별도 레코드로 보존한다.
 */
export const BUNDLED_VRM_RIGHTS_BLOCKS: readonly BundledVrmRightsBlock[] = [
  {
    id: "meebit",
    name: "미빗 (블록맨)",
    url: "/vrm/meebit_09842.vrm",
    status: "rights-blocked",
    reasonCode: "redistribution-commercial-restriction",
    notice:
      "Meebits 보유자 이용조건은 일반 번들 재배포·상업 서비스 제공 권한으로 간주할 수 없어 카탈로그와 런타임 로드를 차단했습니다.",
  },
] as const;

const BUNDLED_VRM_RIGHTS_BLOCK_BY_ID = new Map(
  BUNDLED_VRM_RIGHTS_BLOCKS.map((record) => [record.id, record] as const),
);

export function bundledVrmRightsBlockById(
  id: string,
): BundledVrmRightsBlock | undefined {
  return BUNDLED_VRM_RIGHTS_BLOCK_BY_ID.get(id);
}

export function isBundledVrmRightsBlocked(id: string): boolean {
  return BUNDLED_VRM_RIGHTS_BLOCK_BY_ID.has(id);
}

// 전체 번들 VRM 레지스트리. 모든 엔트리는 public/vrm/ 아래 실파일과 1:1 대응한다.
// visibility가 legacy인 모델은 기존 프로젝트 복원을 위해 여기에 남지만 기본 선택 목록에서는 숨긴다.
// A-C는 pixiv VRoidPreset 조건, old beta 샘플 4종은 pixiv CC0 조건을 따른다.
// 모델별 출처 URL·라이선스 요약은 public/vrm/LICENSES.md 참고
// (2026-06: madjin/vrm-samples VRoid 공식 샘플 + UniVRM Alicia Solid,
//  2026-07: github.com/ToxSam/open-source-avatars 레지스트리의 Polygonal Mind
//  100Avatars R1~R3 CC0 모델 71종 — 캐릭터/로봇/동물/판타지/SF/푸드 마스코트,
//  그 중 OldMoustache·Eugenia는 "노인" 카테고리 보강).
export const SAMPLE_VRMS: SampleVrm[] = [
  { id: SAMPLE_VRM_ID, name: "루미", thumbnailUrl: "/assets/3d/characters/thumbnails/sample-vrm.png", url: SAMPLE_VRM_URL },
  { id: "avatar-a", name: "하린", thumbnailUrl: "/assets/3d/characters/thumbnails/avatar-a.png", url: "/vrm/AvatarSample_A.vrm" },
  { id: "avatar-b", name: "세라", thumbnailUrl: "/assets/3d/characters/thumbnails/avatar-b.png", url: "/vrm/AvatarSample_B.vrm" },
  { id: "avatar-c", name: "유나", thumbnailUrl: "/assets/3d/characters/thumbnails/avatar-c.png", url: "/vrm/AvatarSample_C.vrm" },
  { id: "shion", name: "시온", thumbnailUrl: "/assets/3d/characters/thumbnails/shion.png", url: "/vrm/Sendagaya_Shibu.vrm" },
  { id: "vivi", name: "비비", thumbnailUrl: "/assets/3d/characters/thumbnails/vivi.png", url: "/vrm/Vivi.vrm" },
  { id: "vita", name: "비타", thumbnailUrl: "/assets/3d/characters/thumbnails/vita.png", url: "/vrm/Vita.vrm" },
  { id: "rubin", name: "루빈", thumbnailUrl: "/assets/3d/characters/thumbnails/rubin.png", url: "/vrm/Victoria_Rubin.vrm" },
  { id: "orion", name: "오리온 (로봇)", thumbnailUrl: "/assets/3d/characters/thumbnails/orion.png", url: "/vrm/Avatar_Orion.vrm" },
  {
    id: "cryptovoxel",
    name: "크립토 (복셀봇)",
    thumbnailUrl: "/assets/3d/characters/thumbnails/cryptovoxel.png",
    url: "/vrm/cryptovoxels.vrm",
    visibility: "legacy",
    limitations: ["no-expressions"],
  },
  { id: "seedsan", name: "시드상 (마스코트)", thumbnailUrl: "/assets/3d/characters/thumbnails/seedsan.png", url: "/vrm/Seed_san.vrm" },
  { id: "shino", name: "시노", thumbnailUrl: "/assets/3d/characters/thumbnails/shino.png", url: "/vrm/Sendagaya_Shino.vrm" },
  {
    id: "fumi",
    name: "후미",
    thumbnailUrl: "/assets/3d/characters/thumbnails/fumi.png",
    url: "/vrm/Sakurada_Fumiriya.vrm",
    limitations: ["heavy-payload"],
  },
  {
    id: "kage",
    name: "카게 (다크)",
    thumbnailUrl: "/assets/3d/characters/thumbnails/kage.png",
    url: "/vrm/Darkness_Shibu.vrm",
    limitations: ["heavy-payload"],
  },
  { id: "mio", name: "미오", thumbnailUrl: "/assets/3d/characters/thumbnails/mio.png", url: "/vrm/fem_vroid.vrm" },
  { id: "noa", name: "노아", thumbnailUrl: "/assets/3d/characters/thumbnails/noa.png", url: "/vrm/masc_vroid.vrm" },
  { id: "alicia", name: "아리시아", thumbnailUrl: "/assets/3d/characters/thumbnails/alicia.png", url: "/vrm/AliciaSolid.vrm" },
  { id: "devil", name: "데빌 (악마)", thumbnailUrl: "/assets/3d/characters/thumbnails/devil.png", url: "/vrm/Devil.vrm" },
  { id: "polydancer", name: "폴리댄서", thumbnailUrl: "/assets/3d/characters/thumbnails/polydancer.png", url: "/vrm/Polydancer.vrm" },
  { id: "rose", name: "로즈", thumbnailUrl: "/assets/3d/characters/thumbnails/rose.png", url: "/vrm/Rose.vrm" },
  { id: "robert", name: "로버트", thumbnailUrl: "/assets/3d/characters/thumbnails/robert.png", url: "/vrm/Robert.vrm" },
  { id: "bloody", name: "블러디 (빌런)", thumbnailUrl: "/assets/3d/characters/thumbnails/bloody.png", url: "/vrm/Bloody.vrm" },
  { id: "rabbit", name: "래빗 (토끼)", thumbnailUrl: "/assets/3d/characters/thumbnails/rabbit.png", url: "/vrm/Rabbit.vrm" },
  { id: "eggplant", name: "에그플랜트 (가지)", thumbnailUrl: "/assets/3d/characters/thumbnails/eggplant.png", url: "/vrm/Eggplant.vrm" },
  { id: "coolbanana", name: "쿨바나나", thumbnailUrl: "/assets/3d/characters/thumbnails/coolbanana.png", url: "/vrm/CoolBanana.vrm" },
  { id: "skull", name: "스컬 (해골)", thumbnailUrl: "/assets/3d/characters/thumbnails/skull.png", url: "/vrm/Skull.vrm" },
  { id: "cool-alien", name: "쿨에일리언 (외계인)", thumbnailUrl: "/assets/3d/characters/thumbnails/cool-alien.png", url: "/vrm/CoolAlien.vrm" },
  { id: "jimmy", name: "지미", thumbnailUrl: "/assets/3d/characters/thumbnails/jimmy.png", url: "/vrm/Jimmy.vrm" },
  { id: "froggy", name: "프로기 (개구리)", thumbnailUrl: "/assets/3d/characters/thumbnails/froggy.png", url: "/vrm/Froggy.vrm" },
  { id: "teddy", name: "테디 (곰인형)", thumbnailUrl: "/assets/3d/characters/thumbnails/teddy.png", url: "/vrm/Teddy.vrm" },
  { id: "nightmare", name: "나이트메어 (악몽)", thumbnailUrl: "/assets/3d/characters/thumbnails/nightmare.png", url: "/vrm/Nightmare.vrm" },
  { id: "pumpkin", name: "펌킨 (호박)", thumbnailUrl: "/assets/3d/characters/thumbnails/pumpkin.png", url: "/vrm/Pumpkin.vrm" },
  { id: "wizzir", name: "위지르 (마법사)", thumbnailUrl: "/assets/3d/characters/thumbnails/wizzir.png", url: "/vrm/Wizzir.vrm" },
  { id: "clown", name: "클라운 (광대)", thumbnailUrl: "/assets/3d/characters/thumbnails/clown.png", url: "/vrm/Clown.vrm" },
  { id: "wolfman", name: "울프맨 (늑대인간)", thumbnailUrl: "/assets/3d/characters/thumbnails/wolfman.png", url: "/vrm/Wolfman.vrm" },
  { id: "mummy", name: "머미 (미라)", thumbnailUrl: "/assets/3d/characters/thumbnails/mummy.png", url: "/vrm/Mummy.vrm" },
  { id: "kate", name: "케이트", thumbnailUrl: "/assets/3d/characters/thumbnails/kate.png", url: "/vrm/Kate.vrm" },
  { id: "witch", name: "위치 (마녀)", thumbnailUrl: "/assets/3d/characters/thumbnails/witch.png", url: "/vrm/Witch.vrm" },
  { id: "dracula", name: "드라큘라 (뱀파이어)", thumbnailUrl: "/assets/3d/characters/thumbnails/dracula.png", url: "/vrm/Dracula.vrm" },
  { id: "zombie", name: "좀비", thumbnailUrl: "/assets/3d/characters/thumbnails/zombie.png", url: "/vrm/Zombie.vrm" },
  { id: "dino-kid", name: "디노키드 (공룡)", thumbnailUrl: "/assets/3d/characters/thumbnails/dino-kid.png", url: "/vrm/DinoKid.vrm" },
  { id: "astronaut", name: "애스트로넛 (우주비행사)", thumbnailUrl: "/assets/3d/characters/thumbnails/astronaut.png", url: "/vrm/Astronaut.vrm" },
  {
    id: "polybot",
    name: "폴리봇 (로봇)",
    thumbnailUrl: "/assets/3d/characters/thumbnails/polybot.png",
    url: "/vrm/Polybot.vrm",
    limitations: ["limited-hand-rig"],
  },
  { id: "jennifer", name: "제니퍼", thumbnailUrl: "/assets/3d/characters/thumbnails/jennifer.png", url: "/vrm/Jennifer.vrm" },
  { id: "erika", name: "에리카", thumbnailUrl: "/assets/3d/characters/thumbnails/erika.png", url: "/vrm/Erika.vrm" },
  { id: "olivia", name: "올리비아", thumbnailUrl: "/assets/3d/characters/thumbnails/olivia.png", url: "/vrm/Olivia.vrm" },
  { id: "avocado", name: "아보카도", thumbnailUrl: "/assets/3d/characters/thumbnails/avocado.png", url: "/vrm/Avocado.vrm" },
  { id: "ice-cream", name: "아이스크림", thumbnailUrl: "/assets/3d/characters/thumbnails/ice-cream.png", url: "/vrm/IceCream.vrm" },
  { id: "pyre-sorcerer", name: "파이어소서러 (화염술사)", thumbnailUrl: "/assets/3d/characters/thumbnails/pyre-sorcerer.png", url: "/vrm/PyreSorcerer.vrm" },
  { id: "unicorn-person", name: "유니콘퍼슨 (유니콘)", thumbnailUrl: "/assets/3d/characters/thumbnails/unicorn-person.png", url: "/vrm/UnicornPerson.vrm" },
  { id: "lalo-bot", name: "랄로봇 (로봇)", thumbnailUrl: "/assets/3d/characters/thumbnails/lalo-bot.png", url: "/vrm/LaloBot.vrm" },
  { id: "shark-person", name: "샤크퍼슨 (상어)", thumbnailUrl: "/assets/3d/characters/thumbnails/shark-person.png", url: "/vrm/SharkPerson.vrm" },
  { id: "chill-penguin", name: "칠펭귄 (펭귄)", thumbnailUrl: "/assets/3d/characters/thumbnails/chill-penguin.png", url: "/vrm/ChillPenguin.vrm" },
  { id: "cool-turtle", name: "쿨터틀 (거북이)", thumbnailUrl: "/assets/3d/characters/thumbnails/cool-turtle.png", url: "/vrm/CoolTurtle.vrm" },
  { id: "moon-girl", name: "문걸 (달소녀)", thumbnailUrl: "/assets/3d/characters/thumbnails/moon-girl.png", url: "/vrm/MoonGirl.vrm" },
  { id: "eye-wizard", name: "아이위저드 (외눈 마법사)", thumbnailUrl: "/assets/3d/characters/thumbnails/eye-wizard.png", url: "/vrm/EyeWizard.vrm" },
  { id: "cool-pizza", name: "쿨피자", thumbnailUrl: "/assets/3d/characters/thumbnails/cool-pizza.png", url: "/vrm/CoolPizza.vrm" },
  { id: "cool-ramen", name: "쿨라멘", thumbnailUrl: "/assets/3d/characters/thumbnails/cool-ramen.png", url: "/vrm/CoolRamen.vrm" },
  { id: "cool-taco", name: "쿨타코", thumbnailUrl: "/assets/3d/characters/thumbnails/cool-taco.png", url: "/vrm/CoolTaco.vrm" },
  { id: "cool-pirate", name: "쿨파이럿 (해적)", thumbnailUrl: "/assets/3d/characters/thumbnails/cool-pirate.png", url: "/vrm/CoolPirate.vrm" },
  { id: "cosmic-dweller", name: "코스믹드웰러 (우주인)", thumbnailUrl: "/assets/3d/characters/thumbnails/cosmic-dweller.png", url: "/vrm/CosmicDweller.vrm" },
  { id: "chill-palm", name: "칠팜 (야자수)", thumbnailUrl: "/assets/3d/characters/thumbnails/chill-palm.png", url: "/vrm/ChillPalm.vrm" },
  { id: "good-knight", name: "굿나이트 (기사)", thumbnailUrl: "/assets/3d/characters/thumbnails/good-knight.png", url: "/vrm/GoodKnight.vrm" },
  { id: "bad-bot", name: "배드봇 (로봇)", thumbnailUrl: "/assets/3d/characters/thumbnails/bad-bot.png", url: "/vrm/BadBot.vrm" },
  {
    id: "pirate-bot",
    name: "파이럿봇 (해적 로봇)",
    thumbnailUrl: "/assets/3d/characters/thumbnails/pirate-bot.png",
    url: "/vrm/PirateBot.vrm",
    limitations: ["heavy-payload"],
  },
  { id: "cyberpal", name: "사이버팔 (사이보그)", thumbnailUrl: "/assets/3d/characters/thumbnails/cyberpal.png", url: "/vrm/Cyberpal.vrm" },
  { id: "bao-samurai", name: "바오사무라이", thumbnailUrl: "/assets/3d/characters/thumbnails/bao-samurai.png", url: "/vrm/BaoSamurai.vrm" },
  {
    id: "kiba",
    name: "키바 (늑대)",
    thumbnailUrl: "/assets/3d/characters/thumbnails/kiba.png",
    url: "/vrm/Kiba.vrm",
    limitations: ["limited-hand-rig"],
  },
  { id: "stitch-witch", name: "스티치위치 (마녀 인형)", thumbnailUrl: "/assets/3d/characters/thumbnails/stitch-witch.png", url: "/vrm/StitchWitch.vrm" },
  { id: "mega-angel", name: "메가엔젤 (천사)", thumbnailUrl: "/assets/3d/characters/thumbnails/mega-angel.png", url: "/vrm/MegaAngel.vrm" },
  { id: "mushroom-fairy", name: "머시룸페어리 (버섯 요정)", thumbnailUrl: "/assets/3d/characters/thumbnails/mushroom-fairy.png", url: "/vrm/MushroomFairy.vrm" },
  { id: "weird-cat", name: "위어드캣 (고양이)", thumbnailUrl: "/assets/3d/characters/thumbnails/weird-cat.png", url: "/vrm/WeirdCat.vrm" },
  { id: "cute-saurus", name: "큐트사우루스 (공룡)", thumbnailUrl: "/assets/3d/characters/thumbnails/cute-saurus.png", url: "/vrm/CuteSaurus.vrm" },
  { id: "crowley", name: "크롤리", thumbnailUrl: "/assets/3d/characters/thumbnails/crowley.png", url: "/vrm/Crowley.vrm" },
  { id: "lady-koi", name: "레이디코이 (비단잉어)", thumbnailUrl: "/assets/3d/characters/thumbnails/lady-koi.png", url: "/vrm/LadyKoi.vrm" },
  { id: "yeti-dude", name: "예티듀드 (예티)", thumbnailUrl: "/assets/3d/characters/thumbnails/yeti-dude.png", url: "/vrm/YetiDude.vrm" },
  { id: "anna", name: "안나", thumbnailUrl: "/assets/3d/characters/thumbnails/anna.png", url: "/vrm/Anna.vrm" },
  { id: "megan-the-fox", name: "메간 (여우)", thumbnailUrl: "/assets/3d/characters/thumbnails/megan-the-fox.png", url: "/vrm/MeganTheFox.vrm" },
  { id: "cool-tiger", name: "쿨타이거 (호랑이)", thumbnailUrl: "/assets/3d/characters/thumbnails/cool-tiger.png", url: "/vrm/CoolTiger.vrm" },
  { id: "lil-ram", name: "릴램 (양)", thumbnailUrl: "/assets/3d/characters/thumbnails/lil-ram.png", url: "/vrm/LilRam.vrm" },
  { id: "lady-fawn", name: "레이디폰 (아기사슴)", thumbnailUrl: "/assets/3d/characters/thumbnails/lady-fawn.png", url: "/vrm/LadyFawn.vrm" },
  { id: "strawberry-princess", name: "스트로베리 프린세스 (공주)", thumbnailUrl: "/assets/3d/characters/thumbnails/strawberry-princess.png", url: "/vrm/StrawberryPrincess.vrm" },
  { id: "blue-pixie", name: "블루픽시 (요정)", thumbnailUrl: "/assets/3d/characters/thumbnails/blue-pixie.png", url: "/vrm/BluePixie.vrm" },
  { id: "bot-bunny", name: "봇버니 (토끼 로봇)", thumbnailUrl: "/assets/3d/characters/thumbnails/bot-bunny.png", url: "/vrm/BotBunny.vrm" },
  { id: "sport-mecha", name: "스포츠메카 (메카)", thumbnailUrl: "/assets/3d/characters/thumbnails/sport-mecha.png", url: "/vrm/SportMecha.vrm" },
  { id: "cosmic-bot", name: "코스믹봇 (로봇)", thumbnailUrl: "/assets/3d/characters/thumbnails/cosmic-bot.png", url: "/vrm/CosmicBot.vrm" },
  { id: "old-moustache", name: "올드무스타치 (할아버지)", thumbnailUrl: "/assets/3d/characters/thumbnails/old-moustache.png", url: "/vrm/OldMoustache.vrm" },
  { id: "eugenia", name: "유제니아 (할머니)", thumbnailUrl: "/assets/3d/characters/thumbnails/eugenia.png", url: "/vrm/Eugenia.vrm" },
];
export const SAMPLE_VRM_ENTRIES: VrmLibraryEntry[] = SAMPLE_VRMS
  .filter((sample) => sample.visibility !== "legacy")
  .map((sample) => ({
    id: sample.id,
    name: sample.name,
    source: "sample",
    thumbnail: sample.thumbnailUrl ?? `/assets/3d/characters/thumbnails/${sample.id === SAMPLE_VRM_ID ? "sample-vrm" : sample.id}.png`,
    createdAt: 0,
    updatedAt: 0,
  }));
export const SAMPLE_VRM_LIBRARY_ENTRY: VrmLibraryEntry = SAMPLE_VRM_ENTRIES[0];

export function sampleVrmUrl(id: string): string {
  return SAMPLE_VRMS.find((s) => s.id === id)?.url ?? SAMPLE_VRM_URL;
}

export function sampleVrmThumbnailUrl(id: string): string {
  const sample = SAMPLE_VRMS.find((s) => s.id === id);
  return sample?.thumbnailUrl ?? `/assets/3d/characters/thumbnails/${id === SAMPLE_VRM_ID ? "sample-vrm" : id}.png`;
}

/**
 * 카탈로그와 저장 장면에서 사용할 fail-closed URL 해석기.
 * 권리 차단·미등록 ID를 기본 모델로 조용히 치환하지 않는다. 레거시 모델은
 * 신규 선택 목록에서만 숨기며 기존 프로젝트 복원을 위해 URL 해석은 유지한다.
 */
export function selectableSampleVrmUrl(id: string): string | null {
  if (isBundledVrmRightsBlocked(id)) return null;
  return SAMPLE_VRMS.find((sample) => sample.id === id)?.url ?? null;
}

function isSampleVrmId(id: string) {
  return SAMPLE_VRMS.some((sample) => sample.id === id);
}

export function isUsableVrmAssetResponse(response: Pick<Response, "ok" | "headers">) {
  if (!response.ok) return false;

  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  const contentDisposition = response.headers.get("content-disposition")?.toLowerCase() ?? "";

  return !contentType.includes("text/html") && !/filename="?index\.html"?/.test(contentDisposition);
}

export type ValidatedVrmGlb = {
  vrmVersion: 0 | 1;
};

export type InspectedVrmGlb = ValidatedVrmGlb & {
  /** Already decoded, structurally admitted glTF JSON; callers must still bound selected data. */
  json: Record<string, unknown>;
};

export function canonicalizeVrmContentHash(value: unknown): VrmContentHash | null {
  if (typeof value !== "string") return null;
  const match = SHA256_CONTENT_HASH_PATTERN.exec(value.trim());
  return match ? `sha256:${match[1].toLowerCase()}` : null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** GLB 2.0 컨테이너를 검증하고 기존 첫 JSON 청크 decode seam을 함께 반환한다. */
export function inspectVrmGlbBytes(input: ArrayBuffer | Uint8Array): InspectedVrmGlb {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength < GLB_HEADER_BYTES + GLB_CHUNK_HEADER_BYTES) {
    throw new TypeError("VRM 파일이 너무 짧거나 GLB 헤더가 없습니다.");
  }
  if (bytes.byteLength > MAX_VRM_UPLOAD_BYTES) {
    throw new RangeError(`VRM 파일은 ${MAX_VRM_UPLOAD_BYTES / (1024 * 1024)}MB 이하여야 합니다.`);
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== GLB_MAGIC) {
    throw new TypeError("VRM 파일이 아닙니다. GLB 'glTF' 헤더를 확인해 주세요.");
  }
  if (view.getUint32(4, true) !== GLB_VERSION) {
    throw new TypeError("지원하지 않는 GLB 버전입니다. GLB 2.0 기반 VRM만 업로드할 수 있습니다.");
  }
  if (view.getUint32(8, true) !== bytes.byteLength) {
    throw new TypeError("VRM 파일 길이 정보가 실제 바이트 길이와 일치하지 않습니다.");
  }

  let offset = GLB_HEADER_BYTES;
  let json: unknown = null;
  let chunkIndex = 0;
  while (offset < bytes.byteLength) {
    if (bytes.byteLength - offset < GLB_CHUNK_HEADER_BYTES) {
      throw new TypeError("VRM GLB 청크 헤더가 잘렸습니다.");
    }
    const chunkLength = view.getUint32(offset, true);
    const chunkType = view.getUint32(offset + 4, true);
    if (chunkLength % 4 !== 0) {
      throw new TypeError("VRM GLB 청크 길이는 4바이트 경계에 맞아야 합니다.");
    }
    const payloadStart = offset + GLB_CHUNK_HEADER_BYTES;
    const payloadEnd = payloadStart + chunkLength;
    if (payloadEnd > bytes.byteLength) {
      throw new TypeError("VRM GLB 청크 길이가 파일 범위를 벗어납니다.");
    }

    if (chunkIndex === 0) {
      if (chunkType !== GLB_JSON_CHUNK_TYPE) {
        throw new TypeError("VRM GLB의 첫 청크는 JSON이어야 합니다.");
      }
      if (chunkLength === 0 || chunkLength > MAX_VRM_JSON_CHUNK_BYTES) {
        throw new RangeError("VRM 메타데이터(JSON) 크기가 허용 범위를 벗어납니다.");
      }
      let jsonText: string;
      try {
        jsonText = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(payloadStart, payloadEnd));
      } catch {
        throw new TypeError("VRM 메타데이터가 올바른 UTF-8 JSON이 아닙니다.");
      }
      try {
        json = JSON.parse(jsonText.trim());
      } catch {
        throw new TypeError("VRM 메타데이터 JSON을 읽을 수 없습니다.");
      }
    }

    offset = payloadEnd;
    chunkIndex += 1;
  }

  if (offset !== bytes.byteLength || !isPlainObject(json)) {
    throw new TypeError("VRM GLB 구조가 올바르지 않습니다.");
  }
  if (!isPlainObject(json.asset) || json.asset.version !== "2.0") {
    throw new TypeError("VRM 메타데이터의 glTF asset.version은 2.0이어야 합니다.");
  }
  const extensions = json.extensions;
  if (!isPlainObject(extensions)) {
    throw new TypeError("GLB에 VRM 확장(VRM 또는 VRMC_vrm)이 없습니다.");
  }
  const hasVrm1 = Object.prototype.hasOwnProperty.call(extensions, "VRMC_vrm");
  const hasVrm0 = Object.prototype.hasOwnProperty.call(extensions, "VRM");
  if (hasVrm1 && hasVrm0) {
    throw new TypeError("VRM 0.x와 1.x 확장을 동시에 포함한 모호한 파일은 사용할 수 없습니다.");
  }
  if (hasVrm1 && isPlainObject(extensions.VRMC_vrm)) return { vrmVersion: 1, json };
  if (hasVrm0 && isPlainObject(extensions.VRM)) return { vrmVersion: 0, json };
  if (hasVrm1 || hasVrm0) {
    throw new TypeError("VRM 확장 메타데이터가 올바른 객체가 아닙니다.");
  }
  throw new TypeError("GLB에 VRM 확장(VRM 또는 VRMC_vrm)이 없습니다.");
}

/** Compatibility validation facade for callers that do not need the decoded JSON. */
export function validateVrmGlbBytes(input: ArrayBuffer | Uint8Array): ValidatedVrmGlb {
  const { vrmVersion } = inspectVrmGlbBytes(input);
  return { vrmVersion };
}

/**
 * VRM GLB 파일 헤더 및 JSON/BIN 청크에서 내장 썸네일 이미지(PNG/JPEG/WebP) 또는
 * 메인 텍스처 패스 바이트를 파싱하여 추출한다.
 */
export function extractEmbeddedVrmThumbnailBytes(
  input: ArrayBuffer | Uint8Array,
): StudioVrmThumbnailAsset | null {
  try {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (bytes.byteLength < GLB_HEADER_BYTES + GLB_CHUNK_HEADER_BYTES) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (
      view.getUint32(0, true) !== GLB_MAGIC ||
      view.getUint32(4, true) !== GLB_VERSION
    ) return null;

    const offset = GLB_HEADER_BYTES;
    const jsonLength = view.getUint32(offset, true);
    const jsonType = view.getUint32(offset + 4, true);
    if (
      jsonType !== GLB_JSON_CHUNK_TYPE ||
      jsonLength === 0 ||
      jsonLength > MAX_VRM_JSON_CHUNK_BYTES
    ) return null;

    const payloadStart = offset + GLB_CHUNK_HEADER_BYTES;
    const payloadEnd = payloadStart + jsonLength;
    if (payloadEnd > bytes.byteLength) return null;

    const jsonText = new TextDecoder("utf-8").decode(bytes.subarray(payloadStart, payloadEnd));
    const json = JSON.parse(jsonText.trim());
    if (!json || typeof json !== "object" || Array.isArray(json)) return null;

    const binPayloadStart = payloadEnd + GLB_CHUNK_HEADER_BYTES;
    if (binPayloadStart > bytes.byteLength) return null;
    const binPayload = bytes.subarray(binPayloadStart);

    let imageIndex: number | null = null;
    const extensions = (json as { extensions?: Record<string, unknown> }).extensions;
    if (extensions && typeof extensions === "object") {
      const vrm1Meta = (extensions.VRMC_vrm as { meta?: { thumbnailImage?: unknown } } | undefined)?.meta;
      if (typeof vrm1Meta?.thumbnailImage === "number") {
        imageIndex = vrm1Meta.thumbnailImage;
      } else {
        const vrm0Meta = (extensions.VRM as { meta?: { texture?: unknown } } | undefined)?.meta;
        if (typeof vrm0Meta?.texture === "number" && Array.isArray((json as { textures?: unknown[] }).textures)) {
          const textures = (json as { textures: Array<{ source?: unknown }> }).textures;
          const source = textures[vrm0Meta.texture]?.source;
          if (typeof source === "number") imageIndex = source;
        }
      }
    }

    const images = (json as { images?: Array<{ mimeType?: unknown; bufferView?: unknown }> }).images;
    // 내장 VRM 메타 썸네일 링크가 없는 모델은 원시 텍스처 아틀라스(image 0)를 노출하지 않고 null을 반환하여
    // 공식 3D 스튜디오 렌더링 썸네일 또는 안전한 폴백을 사용하도록 한다.

    if (imageIndex === null || !Array.isArray(images)) return null;
    const imageInfo = images[imageIndex];
    if (!imageInfo || typeof imageInfo.bufferView !== "number") return null;

    const bufferViews = (json as { bufferViews?: Array<{ byteOffset?: unknown; byteLength?: unknown }> }).bufferViews;
    if (!Array.isArray(bufferViews)) return null;
    const bufferView = bufferViews[imageInfo.bufferView];
    if (!bufferView || typeof bufferView.byteLength !== "number") return null;

    const byteOffset = typeof bufferView.byteOffset === "number" ? bufferView.byteOffset : 0;
    const byteLength = bufferView.byteLength;
    if (byteOffset + byteLength > binPayload.byteLength) return null;

    const imgBytes = binPayload.subarray(byteOffset, byteOffset + byteLength);
    const rawMime = typeof imageInfo.mimeType === "string" ? imageInfo.mimeType.toLowerCase() : "image/png";
    const mimeType: StudioVrmThumbnailAsset["mimeType"] = rawMime.includes("jpeg") || rawMime.includes("jpg")
      ? "image/jpeg"
      : rawMime.includes("webp")
        ? "image/webp"
        : "image/png";

    return { mimeType, bytes: imgBytes };
  } catch {
    return null;
  }
}

let blobWorkTail: Promise<void> = Promise.resolve();

function runSerializedBlobWork<T>(work: () => Promise<T>): Promise<T> {
  const result = blobWorkTail.then(work, work);
  blobWorkTail = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

function assertSafeVrmBlobSize(blob: Pick<Blob, "size">) {
  if (!Number.isSafeInteger(blob.size) || blob.size <= 0) {
    throw new TypeError("비어 있거나 길이가 올바르지 않은 VRM 파일입니다.");
  }
  if (blob.size > MAX_VRM_UPLOAD_BYTES) {
    throw new RangeError(`VRM 파일은 ${MAX_VRM_UPLOAD_BYTES / (1024 * 1024)}MB 이하여야 합니다.`);
  }
}

async function readVrmBlobBytes(blob: Blob): Promise<ArrayBuffer> {
  assertSafeVrmBlobSize(blob);
  const buffer = await blob.arrayBuffer();
  if (buffer.byteLength !== blob.size) {
    throw new TypeError("VRM 파일을 완전히 읽지 못했습니다. 파일을 다시 선택해 주세요.");
  }
  return buffer;
}

function digestToContentHash(digest: ArrayBuffer): VrmContentHash {
  if (digest.byteLength !== 32) {
    throw new TypeError("SHA-256 결과 길이가 올바르지 않습니다.");
  }
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `sha256:${hex}`;
}

async function sha256Bytes(bytes: ArrayBuffer): Promise<VrmContentHash> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("이 브라우저에서는 VRM 콘텐츠 해시를 계산할 수 없습니다.");
  return digestToContentHash(await subtle.digest("SHA-256", bytes));
}

/** Blob의 파일명이나 MIME이 아니라 실제 바이트 전체를 SHA-256으로 식별한다. */
export function hashVrmBlob(blob: Blob): Promise<VrmContentHash> {
  return runSerializedBlobWork(async () => sha256Bytes(await readVrmBlobBytes(blob)));
}

async function inspectVrmBlobWithBytes(blob: Blob): Promise<{
  contentHash: VrmContentHash;
  byteSize: number;
  mimeType: string;
  bytes: Uint8Array;
  gltfJson: Record<string, unknown>;
  licenseAuthority: StudioVrmLicenseAuthority;
}> {
  return runSerializedBlobWork(async () => {
    const buffer = await readVrmBlobBytes(blob);
    const inspected = inspectVrmGlbBytes(buffer);
    return {
      contentHash: await sha256Bytes(buffer),
      byteSize: buffer.byteLength,
      // 입력의 Content-Type은 신뢰 경계가 아니다. 구조 검증을 통과한 뒤 안전한 정규 MIME을 부여한다.
      mimeType: "model/gltf-binary",
      bytes: new Uint8Array(buffer),
      gltfJson: inspected.json,
      licenseAuthority: inspectStudioVrmLicenseAuthority(inspected.json),
    };
  });
}

async function inspectVrmBlob(blob: Blob): Promise<{
  contentHash: VrmContentHash;
  byteSize: number;
  mimeType: string;
  licenseAuthority: StudioVrmLicenseAuthority;
}> {
  const {
    bytes: _bytes,
    gltfJson: _gltfJson,
    ...identity
  } = await inspectVrmBlobWithBytes(blob);
  return identity;
}

/** 레거시 DB v1 행을 검증하고 안정적인 콘텐츠 식별 정보로 보강한다. */
export async function ensureStoredVrmContentIdentity(
  record: VrmStoredModelRecord
): Promise<VrmStoredModelWithContentIdentity> {
  const canonicalHash = canonicalizeVrmContentHash(record.contentHash);
  if (
    canonicalHash &&
    record.byteSize === record.blob.size &&
    record.mimeType === "model/gltf-binary" &&
    record.validationVersion === VRM_VALIDATION_VERSION
  ) {
    return {
      ...record,
      contentHash: canonicalHash,
      byteSize: record.blob.size,
      mimeType: "model/gltf-binary",
      validationVersion: VRM_VALIDATION_VERSION,
    };
  }

  const inspected = await inspectVrmBlob(record.blob);
  return {
    ...record,
    ...inspected,
    validationVersion: VRM_VALIDATION_VERSION,
  };
}

function createModelId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `vrm-${Date.now()}-${Math.random().toString(36).slice(2)}`; // NOSONAR S2245 비암호화 용도(시각효과/ID 생성)
}

function normalizeVrmName(fileName: string) {
  const normalized = fileName
    .normalize("NFKC")
    .trim()
    .replace(/\.vrm$/i, "")
    .trim()
    .replace(/\s+/gu, " ");
  if (normalized.length > 120) {
    throw new RangeError("VRM 캐릭터 이름은 120자 이하여야 합니다.");
  }
  if (Array.from(normalized).some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 0x1f || code === 0x7f;
  })) {
    throw new TypeError("VRM 캐릭터 이름에 제어 문자를 사용할 수 없습니다.");
  }
  return normalized || "VRM 캐릭터";
}

function createIndexedDbError() {
  return new Error("이 브라우저에서는 VRM 라이브러리 저장소를 사용할 수 없습니다.");
}

function usesLegacyIndexedDb(options: VrmLibraryStorageOptions): boolean {
  return Object.prototype.hasOwnProperty.call(options, "legacyIndexedDb");
}

function legacyIndexedDb(options: VrmLibraryStorageOptions): IDBFactory {
  if (!usesLegacyIndexedDb(options) || options.legacyIndexedDb === null) {
    throw createIndexedDbError();
  }
  if (options.legacyIndexedDb) return options.legacyIndexedDb;
  throw createIndexedDbError();
}

function productRepository(
  options: VrmLibraryStorageOptions,
): StudioVrmAssetSqliteOpfsRepository {
  return options.repository ?? getProductStudioVrmAssetSqliteOpfsRepository();
}

function licenseAuthorityStore(
  options: VrmLibraryStorageOptions,
): StudioVrmLicenseAuthorityStore | null {
  if (options.licenseAuthorityStore) return options.licenseAuthorityStore;
  // Explicit repositories and legacy IndexedDB are test/embed seams; never open product SQLite
  // behind those callers unless they explicitly provide a matching receipt store.
  if (usesLegacyIndexedDb(options) || options.repository) return null;
  return getProductStudioVrmLicenseAuthorityStore();
}

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? createIndexedDbError());
  });
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? createIndexedDbError());
    transaction.onabort = () => reject(transaction.error ?? createIndexedDbError());
  });
}

function openLibraryDatabase(factory: IDBFactory) {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(MODEL_STORE)) {
        db.createObjectStore(MODEL_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(THUMBNAIL_STORE)) {
        db.createObjectStore(THUMBNAIL_STORE, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? createIndexedDbError());
  });
}

async function withDatabase<T>(
  factory: IDBFactory,
  callback: (db: IDBDatabase) => Promise<T>,
) {
  const db = await openLibraryDatabase(factory);
  try {
    return await callback(db);
  } finally {
    db.close();
  }
}

export function createUploadedVrmRecord(file: File, id = createModelId(), now = Date.now()): VrmStoredModelRecord {
  return {
    id,
    name: normalizeVrmName(file.name),
    blob: file,
    thumbnail: null,
    createdAt: now,
    updatedAt: now,
  };
}

export function withDefaultVrmEntry(storedModels: VrmStoredModelRecord[], sampleThumbnails: Partial<Record<string, string | null>> = {}): VrmLibraryEntry[] {
  const sampleEntries = SAMPLE_VRM_ENTRIES.map((entry) => ({
    ...entry,
    thumbnail: sampleThumbnails[entry.id] ?? entry.thumbnail,
  }));
  const uploadedEntries = storedModels
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map<VrmLibraryEntry>((model) => {
      const contentHash = canonicalizeVrmContentHash(model.contentHash);
      return {
        id: model.id,
        name: model.name,
        source: "sqlite-opfs",
        thumbnail: model.thumbnail ?? null,
        createdAt: model.createdAt,
        updatedAt: model.updatedAt,
        ...(contentHash ? { contentHash } : {}),
        ...(Number.isSafeInteger(model.byteSize) && (model.byteSize ?? 0) > 0
          ? { byteSize: model.byteSize }
          : {}),
        ...(typeof model.mimeType === "string" && model.mimeType
          ? { mimeType: model.mimeType }
          : {}),
      };
    });

  return [...sampleEntries, ...uploadedEntries];
}

export function getDeletableModelIds(entries: VrmLibraryEntry[]) {
  return entries
    // Durable hashes can be referenced by saved project documents. Until a project-owner index
    // can prove a zero-reference count, the product deletion surface must fail closed.
    .filter((entry) => entry.source === "memory")
    .map((entry) => entry.id);
}

function isStoredVrmModelRecord(value: unknown): value is VrmStoredModelRecord {
  if (!isPlainObject(value)) return false;
  const record = value;
  return (
    typeof record.id === "string" &&
    typeof record.name === "string" &&
    record.blob instanceof Blob &&
    (record.thumbnail === null || typeof record.thumbnail === "string") &&
    typeof record.createdAt === "number" &&
    Number.isFinite(record.createdAt) &&
    typeof record.updatedAt === "number" &&
    Number.isFinite(record.updatedAt) &&
    (record.contentHash === undefined || typeof record.contentHash === "string") &&
    (record.byteSize === undefined || (typeof record.byteSize === "number" && Number.isFinite(record.byteSize))) &&
    (record.mimeType === undefined || typeof record.mimeType === "string") &&
    (record.validationVersion === undefined || (typeof record.validationVersion === "number" && Number.isFinite(record.validationVersion)))
  );
}

type VrmIdentityBackfill = {
  source: VrmStoredModelRecord;
  identity: Pick<
    VrmStoredModelWithContentIdentity,
    "contentHash" | "byteSize" | "mimeType" | "validationVersion"
  >;
};

function hasSameBlobDescriptor(left: Blob, right: Blob): boolean {
  if (left.size !== right.size || left.type !== right.type) return false;
  if (typeof File === "undefined" || !(left instanceof File) || !(right instanceof File)) return true;
  return left.name === right.name && left.lastModified === right.lastModified;
}

function isSameBackfillSource(current: VrmStoredModelRecord, source: VrmStoredModelRecord): boolean {
  return (
    current.id === source.id &&
    current.name === source.name &&
    current.thumbnail === source.thumbnail &&
    current.createdAt === source.createdAt &&
    current.updatedAt === source.updatedAt &&
    current.contentHash === source.contentHash &&
    current.byteSize === source.byteSize &&
    current.mimeType === source.mimeType &&
    current.validationVersion === source.validationVersion &&
    hasSameBlobDescriptor(current.blob, source.blob)
  );
}

async function persistVrmIdentityBackfills(
  db: IDBDatabase,
  backfills: readonly VrmIdentityBackfill[]
): Promise<void> {
  const transaction = db.transaction(MODEL_STORE, "readwrite");
  const done = transactionDone(transaction);
  const store = transaction.objectStore(MODEL_STORE);

  const reconcile = async () => {
    // 모든 get을 먼저 큐에 넣어 transaction이 행 사이에서 inactive가 되지 않게 한다.
    const currentRows = await Promise.all(
      backfills.map(({ source }) => requestResult<unknown>(store.get(source.id)))
    );
    currentRows.forEach((value, index) => {
      if (!isStoredVrmModelRecord(value)) return; // 삭제된 행을 되살리지 않는다.
      const backfill = backfills[index];
      if (!isSameBackfillSource(value, backfill.source)) return;

      const { identity } = backfill;
      if (
        value.contentHash === identity.contentHash &&
        value.byteSize === identity.byteSize &&
        value.mimeType === identity.mimeType &&
        value.validationVersion === identity.validationVersion
      ) {
        return;
      }
      store.put({ ...value, ...identity });
    });
  };

  await Promise.all([reconcile(), done]);
}

async function listLegacyStoredVrmModels(
  factory: IDBFactory,
): Promise<VrmStoredModelRecord[]> {
  return withDatabase(factory, async (db) => {
    const transaction = db.transaction(MODEL_STORE, "readonly");
    const done = transactionDone(transaction);
    const store = transaction.objectStore(MODEL_STORE);
    const storedRows = await requestResult<unknown[]>(store.getAll());
    await done;
    const records = storedRows.filter(isStoredVrmModelRecord);
    const results: VrmStoredModelRecord[] = [];
    const backfills: VrmIdentityBackfill[] = [];

    // 대형 VRM 여러 개의 ArrayBuffer를 동시에 보유하지 않도록 반드시 한 행씩 처리한다.
    for (const record of records) {
      try {
        const ensured = await ensureStoredVrmContentIdentity(record);
        results.push(ensured);
        if (
          ensured.contentHash !== record.contentHash ||
          ensured.byteSize !== record.byteSize ||
          ensured.mimeType !== record.mimeType ||
          ensured.validationVersion !== record.validationVersion
        ) {
          backfills.push({
            source: record,
            identity: {
              contentHash: ensured.contentHash,
              byteSize: ensured.byteSize,
              mimeType: ensured.mimeType,
              validationVersion: ensured.validationVersion,
            },
          });
        }
      } catch {
        // 손상된 레거시 한 행 때문에 나머지 라이브러리를 사용할 수 없게 하지 않는다.
        results.push(record);
      }
    }

    if (backfills.length > 0) {
      try {
        await persistVrmIdentityBackfills(db, backfills);
      } catch {
        // 메모리의 결과는 이미 쓸 수 있다. quota/race/write 실패는 목록 조회를 막지 않는다.
      }
    }

    return results;
  });
}

async function getLegacyStoredVrmModel(
  id: string,
  factory: IDBFactory,
): Promise<VrmStoredModelRecord | null> {
  return withDatabase(factory, async (db) => {
    const transaction = db.transaction(MODEL_STORE, "readonly");
    const done = transactionDone(transaction);
    const store = transaction.objectStore(MODEL_STORE);
    const record = await requestResult<unknown>(store.get(id));
    await done;
    return isStoredVrmModelRecord(record) ? record : null;
  });
}

async function getLegacyCachedVrmThumbnail(
  id: string,
  factory: IDBFactory,
): Promise<string | null> {
  return withDatabase(factory, async (db) => {
    const transaction = db.transaction(THUMBNAIL_STORE, "readonly");
    const done = transactionDone(transaction);
    const store = transaction.objectStore(THUMBNAIL_STORE);
    const record = await requestResult<VrmThumbnailRecord | undefined>(store.get(id));
    await done;
    return record?.thumbnail ?? null;
  });
}

function thumbnailToDataUrl(thumbnail: StudioVrmThumbnailAsset): string {
  let binary = "";
  const chunkSize = 32_768;
  for (let offset = 0; offset < thumbnail.bytes.byteLength; offset += chunkSize) {
    const chunk = thumbnail.bytes.subarray(
      offset,
      Math.min(offset + chunkSize, thumbnail.bytes.byteLength),
    );
    binary += String.fromCharCode(...chunk);
  }
  if (typeof globalThis.btoa !== "function") {
    throw new StudioVrmAssetRepositoryError(
      "unavailable",
      "이 환경에서는 VRM thumbnail base64를 만들 수 없습니다.",
    );
  }
  return `data:${thumbnail.mimeType};base64,${globalThis.btoa(binary)}`;
}

function dataUrlToThumbnail(value: string): StudioVrmThumbnailAsset {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/u.exec(value);
  if (!match || typeof globalThis.atob !== "function") {
    throw new TypeError("VRM thumbnail은 canonical PNG/JPEG/WebP data URL이어야 합니다.");
  }
  let decoded: string;
  try {
    decoded = globalThis.atob(match[2]);
  } catch (cause) {
    throw new TypeError("VRM thumbnail base64가 손상되었습니다.", { cause });
  }
  const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  if (bytes.byteLength < 1 || bytes.byteLength > 2 * 1024 * 1024) {
    throw new RangeError("VRM thumbnail은 2 MiB 이하여야 합니다.");
  }
  return {
    bytes,
    mimeType: match[1] as StudioVrmThumbnailAsset["mimeType"],
  };
}

function recordFromAsset(asset: StudioVrmModelAsset): VrmStoredModelWithContentIdentity {
  return {
    id: asset.id,
    name: asset.name,
    blob: new Blob([Uint8Array.from(asset.bytes).buffer], { type: asset.mimeType }),
    thumbnail: asset.thumbnail ? thumbnailToDataUrl(asset.thumbnail) : null,
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
    contentHash: asset.contentHash,
    byteSize: asset.byteSize,
    mimeType: asset.mimeType,
    validationVersion: asset.validationVersion,
  };
}

function libraryEntryFromMetadata(
  metadata: StudioVrmModelAssetMetadata,
  thumbnail: string | null,
): VrmLibraryEntry {
  return {
    id: metadata.id,
    name: metadata.name,
    source: "sqlite-opfs",
    thumbnail,
    createdAt: metadata.createdAt,
    updatedAt: metadata.updatedAt,
    contentHash: metadata.contentHash,
    byteSize: metadata.byteSize,
    mimeType: metadata.mimeType,
  };
}

function libraryEntryFromLegacyRecord(model: VrmStoredModelRecord): VrmLibraryEntry {
  const contentHash = canonicalizeVrmContentHash(model.contentHash);
  return {
    id: model.id,
    name: model.name,
    source: "sqlite-opfs",
    thumbnail: model.thumbnail ?? null,
    createdAt: model.createdAt,
    updatedAt: model.updatedAt,
    ...(contentHash ? { contentHash } : {}),
    ...(Number.isSafeInteger(model.byteSize) && (model.byteSize ?? 0) > 0
      ? { byteSize: model.byteSize }
      : {}),
    ...(typeof model.mimeType === "string" && model.mimeType
      ? { mimeType: model.mimeType }
      : {}),
  };
}

export function durableVrmLibraryEntry(
  model: VrmStoredModelRecord,
): VrmLibraryEntry {
  const entry = libraryEntryFromLegacyRecord(model);
  return model.licenseAuthority ? { ...entry, licenseAuthority: model.licenseAuthority } : entry;
}

export function memoryVrmLibraryEntry(
  record: VrmStoredModelWithContentIdentity,
): VrmLibraryEntry {
  return {
    id: record.id,
    name: record.name,
    source: "memory",
    thumbnail: record.thumbnail,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    contentHash: record.contentHash,
    byteSize: record.byteSize,
    mimeType: record.mimeType,
    licenseAuthority: record.licenseAuthority,
  };
}

export async function listStoredVrmModels(
  options: VrmLibraryStorageOptions = {},
): Promise<VrmStoredModelRecord[]> {
  if (usesLegacyIndexedDb(options)) {
    return listLegacyStoredVrmModels(legacyIndexedDb(options));
  }
  const repository = productRepository(options);
  const metadata = await repository.listModelMetadata();
  const records: VrmStoredModelRecord[] = [];
  // This compatibility API materializes bytes; product catalog listing uses metadata below.
  for (const entry of metadata) {
    const model = await repository.getModel(entry.id);
    if (model) records.push(recordFromAsset(model));
  }
  return records;
}

export async function getStoredVrmModel(
  id: string,
  options: VrmLibraryStorageOptions = {},
): Promise<VrmStoredModelRecord | null> {
  if (usesLegacyIndexedDb(options)) {
    return getLegacyStoredVrmModel(id, legacyIndexedDb(options));
  }
  const asset = await productRepository(options).getModel(id);
  return asset ? recordFromAsset(asset) : null;
}

export async function getStoredVrmModelByHash(
  value: string,
  options: VrmLibraryStorageOptions = {},
): Promise<VrmStoredModelRecord | null> {
  const contentHash = canonicalizeVrmContentHash(value);
  if (!contentHash) return null;
  if (usesLegacyIndexedDb(options)) {
    const records = await listLegacyStoredVrmModels(legacyIndexedDb(options));
    return records.find(
      (record) => canonicalizeVrmContentHash(record.contentHash) === contentHash,
    ) ?? null;
  }
  const asset = await productRepository(options).getModelByHash(contentHash);
  return asset ? recordFromAsset(asset) : null;
}

export async function getCachedVrmThumbnail(
  id: string,
  options: VrmLibraryStorageOptions = {},
): Promise<string | null> {
  if (usesLegacyIndexedDb(options)) {
    return getLegacyCachedVrmThumbnail(id, legacyIndexedDb(options));
  }
  const thumbnail = await productRepository(options).getThumbnail(id);
  return thumbnail ? thumbnailToDataUrl(thumbnail) : null;
}

/**
 * Compatibility-only all-metadata facade. It never hydrates SQLite/OPFS thumbnails; product UI
 * must use queryUploadedVrmLibraryEntriesPage plus hydrateVrmLibraryThumbnailWindow.
 */
export async function listVrmLibraryEntries(
  options: VrmLibraryStorageOptions = {},
): Promise<VrmLibraryEntry[]> {
  if (usesLegacyIndexedDb(options)) {
    const factory = legacyIndexedDb(options);
    const [storedModels, cachedSampleThumbnails] = await Promise.all([
      listLegacyStoredVrmModels(factory),
      Promise.all(SAMPLE_VRM_ENTRIES.map(async (entry) => [
        entry.id,
        await getLegacyCachedVrmThumbnail(entry.id, factory),
      ] as const)),
    ]);
    return withDefaultVrmEntry(storedModels, Object.fromEntries(cachedSampleThumbnails));
  }
  const repository = productRepository(options);
  const metadata = await repository.listModelMetadata();
  return [
    ...SAMPLE_VRM_ENTRIES,
    ...metadata.map((entry) => libraryEntryFromMetadata(entry, null)),
  ];
}

/**
 * Loads one durable upload metadata page. Thumbnails are deliberately hydrated through the
 * separate byte-bounded window below, and model GLB bytes stay in OPFS until exact selection.
 */
export async function queryUploadedVrmLibraryEntriesPage(
  options: VrmLibraryStorageOptions & {
    readonly cursor?: string | null;
    readonly signal?: AbortSignal;
  } = {},
): Promise<VrmUploadedLibraryEntryPage | null> {
  if (usesLegacyIndexedDb(options)) {
    const records = await listLegacyStoredVrmModels(legacyIndexedDb(options));
    if (records.length === 0) return null;
    const cursor = "legacy-upload-page-0";
    if (options.cursor !== undefined && options.cursor !== null && options.cursor !== cursor) {
      return null;
    }
    return Object.freeze({
      items: Object.freeze(records.map(libraryEntryFromLegacyRecord)),
      cursor,
      nextCursor: null,
      totalCount: records.length,
      totalBytes: records.reduce((sum, record) => sum + (record.byteSize ?? record.blob.size), 0),
      generation: 0,
    });
  }
  const repository = productRepository(options);
  const page = await repository.queryModelMetadataPage({
    ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
  if (!page) return null;
  return Object.freeze({
    items: Object.freeze(page.items.map((entry) => libraryEntryFromMetadata(entry, null))),
    cursor: page.cursor,
    nextCursor: page.nextCursor,
    totalCount: page.totalCount,
    totalBytes: page.totalBytes,
    generation: page.generation,
  });
}

/**
 * Hydrates at most one visible catalog window. Raw image bytes are accounted before conversion to
 * data URLs so a caller can never accidentally materialize an entire 513+ thumbnail library.
 */
export async function hydrateVrmLibraryThumbnailWindow(
  entries: readonly VrmLibraryEntry[],
  options: VrmLibraryStorageOptions & { readonly signal?: AbortSignal } = {},
): Promise<readonly VrmLibraryEntry[]> {
  if (entries.length > VRM_LIBRARY_THUMBNAIL_WINDOW_MAX_ITEMS) {
    throw new StudioVrmAssetRepositoryError(
      "limit",
      "VRM thumbnail window exceeds its item limit.",
    );
  }
  const repository = usesLegacyIndexedDb(options) ? null : productRepository(options);
  const authorityStore = licenseAuthorityStore(options);
  let totalBytes = 0;
  const hydrated: VrmLibraryEntry[] = [];
  for (const entry of entries) {
    if (options.signal?.aborted) {
      throw new StudioVrmAssetRepositoryError("aborted", "VRM thumbnail hydration was aborted.");
    }
    let licenseAuthority = entry.licenseAuthority;
    if (!licenseAuthority && entry.contentHash && authorityStore) {
      try {
        licenseAuthority = await authorityStore.get(entry.contentHash) ?? undefined;
      } catch {
        // Receipt storage availability must not turn a local preview warning into a load failure.
      }
    }
    const withAuthority = licenseAuthority && licenseAuthority !== entry.licenseAuthority
      ? { ...entry, licenseAuthority }
      : entry;
    if (entry.thumbnail) {
      hydrated.push(withAuthority);
      continue;
    }
    let thumbnail: string | null = null;
    if (repository) {
      const asset = await repository.getThumbnail(entry.id, options.signal);
      if (asset) {
        if (asset.bytes.byteLength > VRM_LIBRARY_THUMBNAIL_WINDOW_MAX_BYTES - totalBytes) {
          throw new StudioVrmAssetRepositoryError(
            "limit",
            "VRM thumbnail window exceeds its aggregate byte limit.",
          );
        }
        totalBytes += asset.bytes.byteLength;
        thumbnail = thumbnailToDataUrl(asset);
      } else if (entry.source === "sample") {
        const url = sampleVrmUrl(entry.id);
        if (url && typeof fetch === "function") {
          try {
            const response = await fetch(url, { signal: options.signal });
            if (response.ok) {
              const buffer = await response.arrayBuffer();
              const extracted = extractEmbeddedVrmThumbnailBytes(buffer);
              if (extracted) {
                if (extracted.bytes.byteLength <= VRM_LIBRARY_THUMBNAIL_WINDOW_MAX_BYTES - totalBytes) {
                  totalBytes += extracted.bytes.byteLength;
                  thumbnail = thumbnailToDataUrl(extracted);
                  void repository.saveThumbnail(entry.id, extracted, Date.now(), options.signal).catch(() => {});
                }
              }
            }
          } catch {
            // Ignore network errors during sample thumbnail fetch
          }
        }
      }
    } else {
      thumbnail = await getLegacyCachedVrmThumbnail(entry.id, legacyIndexedDb(options));
      if (thumbnail) {
        const estimatedBytes = Math.ceil((thumbnail.length * 3) / 4);
        if (estimatedBytes > VRM_LIBRARY_THUMBNAIL_WINDOW_MAX_BYTES - totalBytes) {
          throw new StudioVrmAssetRepositoryError(
            "limit",
            "VRM thumbnail window exceeds its aggregate byte limit.",
          );
        }
        totalBytes += estimatedBytes;
      }
    }
    hydrated.push(
      thumbnail
        ? { ...withAuthority, thumbnail }
        : { ...withAuthority, thumbnail: buildFallbackVrmLibraryThumbnail(withAuthority.name, withAuthority.id) },
    );
  }
  return Object.freeze(hydrated);
}

let saveWorkTail: Promise<void> = Promise.resolve();

function runSerializedSave<T>(work: () => Promise<T>): Promise<T> {
  const result = saveWorkTail.then(work, work);
  saveWorkTail = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

export async function saveVerifiedVrmBlobWithDisposition(input: {
  name: string;
  blob: Blob;
  expectedHash?: string;
}, options: VrmLibraryStorageOptions = {}): Promise<SaveVerifiedVrmBlobDisposition> {
  return runSerializedSave(async () => {
    const expectedHash = input.expectedHash === undefined
      ? null
      : canonicalizeVrmContentHash(input.expectedHash);
    if (input.expectedHash !== undefined && !expectedHash) {
      throw new TypeError("예상 VRM 해시는 sha256: 뒤에 64자리 16진수여야 합니다.");
    }

    // 검증·해시가 모두 끝나기 전에는 어떤 durable authority도 열거나 변경하지 않는다.
    const inspected = await inspectVrmBlobWithBytes(input.blob);
    const { bytes, gltfJson, ...identity } = inspected;
    if (expectedHash && identity.contentHash !== expectedHash) {
      throw new TypeError("VRM 파일의 SHA-256 해시가 프로젝트에 기록된 값과 일치하지 않습니다.");
    }

    if (!usesLegacyIndexedDb(options)) {
      const timestamp = Date.now();
      const result = await productRepository(options).saveModel({
        id: createModelId(),
        name: normalizeVrmName(input.name),
        bytes,
        expectedHash: identity.contentHash,
        validationVersion: VRM_VALIDATION_VERSION,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      const authorityStore = licenseAuthorityStore(options);
      if (authorityStore) {
        try {
          await authorityStore.put(result.metadata.contentHash, gltfJson);
        } catch {
          // The GLB remains a valid local-preview model. Missing receipt is shown as unknown and
          // every outgoing model-file action remains fail-closed.
        }
      }
      return {
        record: {
          id: result.metadata.id,
          name: result.metadata.name,
          // The caller-supplied immutable Blob has the same fully verified SHA-256 bytes.
          blob: input.blob,
          thumbnail: null,
          createdAt: result.metadata.createdAt,
          updatedAt: result.metadata.updatedAt,
          contentHash: result.metadata.contentHash,
          byteSize: result.metadata.byteSize,
          mimeType: result.metadata.mimeType,
          validationVersion: result.metadata.validationVersion,
          licenseAuthority: identity.licenseAuthority,
        },
        created: !result.deduplicated,
      };
    }

    const factory = legacyIndexedDb(options);
    // Explicit legacy tests may still exercise v1 identity backfill; product never enters here.
    await listLegacyStoredVrmModels(factory);
    return withDatabase(factory, async (db) => {
      const transaction = db.transaction(MODEL_STORE, "readwrite");
      const done = transactionDone(transaction);
      const store = transaction.objectStore(MODEL_STORE);
      const currentRows = await requestResult<unknown[]>(store.getAll());
      const duplicate = currentRows
        .filter(isStoredVrmModelRecord)
        .find((record) => canonicalizeVrmContentHash(record.contentHash) === identity.contentHash);
      if (duplicate) {
        await done;
        // 기존 표시 이름/썸네일을 덮어쓰지 않는다.
        return { record: duplicate, created: false };
      }

      const now = Date.now();
      const record: VrmStoredModelWithContentIdentity = {
        id: createModelId(),
        name: normalizeVrmName(input.name),
        blob: input.blob,
        thumbnail: null,
        createdAt: now,
        updatedAt: now,
        ...identity,
        validationVersion: VRM_VALIDATION_VERSION,
      };
      const authorityStore = licenseAuthorityStore(options);
      if (authorityStore) {
        try {
          await authorityStore.put(identity.contentHash, gltfJson);
        } catch {
          // Explicit legacy/embed receipt persistence is best-effort; policy still fails closed.
        }
      }
      store.put(record);
      await done;
      return { record, created: true };
    });
  });
}

export async function saveVerifiedVrmBlob(input: {
  name: string;
  blob: Blob;
  expectedHash?: string;
}, options: VrmLibraryStorageOptions = {}): Promise<VrmStoredModelRecord> {
  return (await saveVerifiedVrmBlobWithDisposition(input, options)).record;
}

export function saveUploadedVrm(
  file: File,
  options: VrmLibraryStorageOptions = {},
) {
  return saveVerifiedVrmBlob({ name: file.name, blob: file }, options);
}

export async function saveVrmThumbnail(
  id: string,
  thumbnail: string,
  options: VrmLibraryStorageOptions = {},
): Promise<void> {
  if (!usesLegacyIndexedDb(options)) {
    await productRepository(options).saveThumbnail(
      id,
      dataUrlToThumbnail(thumbnail),
      Date.now(),
    );
    return;
  }
  return withDatabase(legacyIndexedDb(options), async (db) => {
    const transaction = db.transaction([MODEL_STORE, THUMBNAIL_STORE], "readwrite");
    const done = transactionDone(transaction);
    const modelStore = transaction.objectStore(MODEL_STORE);
    const existingModel = await requestResult<unknown>(modelStore.get(id));

    if (isStoredVrmModelRecord(existingModel)) {
      modelStore.put({ ...existingModel, thumbnail, updatedAt: Date.now() });
    } else {
      transaction.objectStore(THUMBNAIL_STORE).put({ id, thumbnail, updatedAt: Date.now() } satisfies VrmThumbnailRecord);
    }

    await done;
  });
}

export async function deleteStoredVrmModel(
  id: string,
  _options: VrmLibraryStorageOptions = {},
): Promise<void> {
  if (isSampleVrmId(id)) return;

  throw new StudioVrmAssetRepositoryError(
    "conflict",
    "저장된 VRM은 프로젝트에서 콘텐츠 해시로 참조될 수 있어 현재 삭제할 수 없습니다. 프로젝트 참조 소유권 검사가 제공될 때까지 원본을 보존합니다.",
  );
}

/**
 * Exact failed-import compensation. This is deliberately separate from the user deletion API:
 * callers may pass only a creation receipt's private id + canonical hash, so a pre-existing or
 * deduplicated shared row can never satisfy the compare-and-delete.
 */
export async function deleteStoredVrmModelIfIdentityMatches(
  id: string,
  value: string,
  options: VrmLibraryStorageOptions = {},
): Promise<boolean> {
  if (isSampleVrmId(id)) return false;
  const contentHash = canonicalizeVrmContentHash(value);
  if (!contentHash) return false;

  if (!usesLegacyIndexedDb(options)) {
    return productRepository(options).deleteModelIfIdentityMatches(id, contentHash);
  }
  return withDatabase(legacyIndexedDb(options), async (db) => {
    const transaction = db.transaction([MODEL_STORE, THUMBNAIL_STORE], "readwrite");
    const done = transactionDone(transaction);
    const modelStore = transaction.objectStore(MODEL_STORE);
    const existing = await requestResult<unknown>(modelStore.get(id));
    const matches = isStoredVrmModelRecord(existing)
      && canonicalizeVrmContentHash(existing.contentHash) === contentHash;
    if (matches) {
      modelStore.delete(id);
      transaction.objectStore(THUMBNAIL_STORE).delete(id);
    }
    await done;
    return matches;
  });
}
