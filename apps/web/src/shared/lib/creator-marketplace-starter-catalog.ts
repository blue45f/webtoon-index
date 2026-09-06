import {
  CREATOR_MARKETPLACE_BUILTIN_PREFIX_BY_KIND,
  CREATOR_MARKETPLACE_RUNTIME_BY_KIND,
  CreatorMarketplaceResourceRecordSchema,
  canonicalizeCreatorMarketplaceJson,
  creatorMarketplaceJsonByteSize,
} from "./creator-marketplace-resource-contract";
import { sha256HexPortable } from "./sha256-portable";

import type {
  CreatorMarketplaceJsonValue,
  CreatorMarketplaceResourceKind,
  CreatorMarketplaceResourceRecord,
} from "./creator-marketplace-resource-contract";

function sha256Hex(value: unknown): string {
  const json = canonicalizeCreatorMarketplaceJson(value);
  return sha256HexPortable(new TextEncoder().encode(json));
}

const OFFICIAL_PUBLISHER = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "ToonSpectrum 공식",
  avatar: "#b4532a",
} as const;

const STARTER_TIMESTAMP = "2026-09-01T00:00:00.000Z";

interface StarterItemDef {
  id: string;
  packageId: string;
  name: string;
  description: string;
  kind: CreatorMarketplaceResourceKind;
  tags: string[];
  entries: Array<{
    id: string;
    name: string;
    delivery:
      | {
          mode: "portable-json";
          definition: Record<string, CreatorMarketplaceJsonValue>;
        }
      | {
          mode: "procedural-recipe";
          recipeId: string;
          parameters?: Record<string, CreatorMarketplaceJsonValue>;
        }
      | {
          mode: "builtin-ref";
          runtimeRef: string;
        };
  }>;
}

const RAW_STARTER_DEFS: readonly StarterItemDef[] = [
  // ── 1. 3D 에셋 (3D Model/Prop Materials) ──
  {
    id: "e0000001-0000-4000-8000-000000000001",
    packageId: "official/3d-asset/anime-humanoid-male",
    name: "애니메 표준 휴머노이드 소체 (3D 남성)",
    description: "웹툰 데생 가이드 및 포즈 설정용 표준 3D 남성 체형 모델. Studio 씬에 드래그하여 즉시 배치하고 다양한 앵글로 구도를 잡을 수 있습니다.",
    kind: "3d-asset",
    tags: ["3D", "인체", "포즈", "소체", "가이드", "남성", "공식"],
    entries: [
      {
        id: "anime-humanoid-male/main",
        name: "표준 남성 소체",
        delivery: {
          mode: "builtin-ref",
          runtimeRef: `${CREATOR_MARKETPLACE_BUILTIN_PREFIX_BY_KIND["3d-asset"]}anime-humanoid-male-v1`,
        },
      },
    ],
  },
  {
    id: "e0000001-0000-4000-8000-000000000002",
    packageId: "official/3d-asset/anime-humanoid-female",
    name: "애니메 표준 휴머노이드 소체 (3D 여성)",
    description: "로맨스·학원물 등 웹툰 데생 가이드 및 포즈 설정용 표준 3D 여성 체형 모델. 관절 회전과 카메라 앵글 회전을 지원합니다.",
    kind: "3d-asset",
    tags: ["3D", "인체", "포즈", "소체", "가이드", "여성", "로판"],
    entries: [
      {
        id: "anime-humanoid-female/main",
        name: "표준 여성 소체",
        delivery: {
          mode: "builtin-ref",
          runtimeRef: `${CREATOR_MARKETPLACE_BUILTIN_PREFIX_BY_KIND["3d-asset"]}anime-humanoid-female-v1`,
        },
      },
    ],
  },
  {
    id: "e0000001-0000-4000-8000-000000000003",
    packageId: "official/3d-asset/classroom-desk-set",
    name: "교실 책상 & 의자 세트 (3D 소품)",
    description: "학원물/학습 배경에 필수적인 한국형 학교 목재 책상과 의자 3D 소품. 크기 조절과 복제 배치를 통해 교실 씬을 손쉽게 완성하세요.",
    kind: "3d-asset",
    tags: ["3D", "소품", "학교", "교실", "책상", "의자"],
    entries: [
      {
        id: "classroom-desk-set/main",
        name: "목재 책상/의자",
        delivery: {
          mode: "procedural-recipe",
          recipeId: "classroom-desk-chair-duo",
          parameters: { scale: 1.0, woodTone: "oak", metalColor: "#334155" },
        },
      },
    ],
  },
  {
    id: "e0000001-0000-4000-8000-000000000004",
    packageId: "official/3d-asset/fantasy-knight-longsword",
    name: "판타지 롱소드 & 방패 (3D 무기)",
    description: "로맨스 판타지 및 액션 장르에 최적화된 기사단 롱소드와 원형 방패 3D 에셋. 손 파츠에 부착하거나 바닥에 거치하여 연출할 수 있습니다.",
    kind: "3d-asset",
    tags: ["3D", "무기", "검", "방패", "판타지", "소품", "로판"],
    entries: [
      {
        id: "fantasy-knight-longsword/main",
        name: "기사단 롱소드",
        delivery: {
          mode: "procedural-recipe",
          recipeId: "knight-longsword-model",
          parameters: { bladeLength: 120, guardType: "cross", metalFinish: "silver" },
        },
      },
    ],
  },
  {
    id: "e0000001-0000-4000-8000-000000000005",
    packageId: "official/3d-asset/modern-smartphone-tablet",
    name: "현대 스마트폰 & 태블릿 세트 (3D 소품)",
    description: "일상·현대물 웹툰에서 컷마다 등장하는 슬림 베젤 스마트폰과 스타일러스 태블릿 3D 소품. 화면 텍스처 교체와 다양한 그립을 지원합니다.",
    kind: "3d-asset",
    tags: ["3D", "소품", "스마트폰", "태블릿", "현대", "일상"],
    entries: [
      {
        id: "modern-smartphone-tablet/main",
        name: "스마트 기기 세트",
        delivery: {
          mode: "procedural-recipe",
          recipeId: "smart-device-bundle",
          parameters: { bezelThickness: "ultra-thin", bodyColor: "#0f172a" },
        },
      },
    ],
  },
  {
    id: "e0000001-0000-4000-8000-000000000006",
    packageId: "official/3d-asset/rofan-tea-table-set",
    name: "로판 엔틱 티테이블 & 찻잔 (3D 소품)",
    description: "로맨스 판타지 티타임 및 귀족 살롱 씬 연출을 위한 금장 티테이블과 로얄 본차이나 찻잔 3D 소품 세트.",
    kind: "3d-asset",
    tags: ["3D", "소품", "로판", "엔틱", "티타임", "디저트"],
    entries: [
      {
        id: "rofan-tea-table-set/main",
        name: "황실 티세트",
        delivery: {
          mode: "procedural-recipe",
          recipeId: "antique-tea-table-and-cup",
          parameters: { goldTrim: true, ceramicColor: "#fffbeb" },
        },
      },
    ],
  },

  // ── 2. 3D 프리셋 (3D Background Presets & Environments) ──
  {
    id: "e0000002-0000-4000-8000-000000000001",
    packageId: "official/3d-preset/sunny-classroom",
    name: "햇살 비치는 오후 교실 (3D 프리셋)",
    description: "칠판, 창문 햇살 조명, 책걸상이 풀세팅된 절차형 3D 교실 배경. 카메라 각도와 조명 강도를 자유롭게 조절하여 웹툰 컷에 바로 적용합니다.",
    kind: "3d-preset",
    tags: ["3D배경", "교실", "학교", "오후", "조명"],
    entries: [
      {
        id: "sunny-classroom/main",
        name: "오후 교실 씬",
        delivery: {
          mode: "procedural-recipe",
          recipeId: "procedural-school-classroom",
          parameters: { timeOfDay: "afternoon", sunlightAngle: 45, windowBloom: true },
        },
      },
    ],
  },
  {
    id: "e0000002-0000-4000-8000-000000000002",
    packageId: "official/3d-preset/rofan-imperial-tearoom",
    name: "햇살 비치는 로판 황실 티룸 (3D 프리셋)",
    description: "아치형 통유리창, 대리석 기둥, 샹들리에 조명이 풀세팅된 로맨스 판타지 황실 티룸 3D 배경 프리셋.",
    kind: "3d-preset",
    tags: ["3D배경", "로판", "황실", "티룸", "궁전", "조명"],
    entries: [
      {
        id: "rofan-imperial-tearoom/main",
        name: "황실 티룸 씬",
        delivery: {
          mode: "procedural-recipe",
          recipeId: "procedural-rofan-tearoom",
          parameters: { windowStyle: "arch-stained-glass", marbleTint: "#f8fafc", chandelierGlow: true },
        },
      },
    ],
  },
  {
    id: "e0000002-0000-4000-8000-000000000003",
    packageId: "official/3d-preset/cyberpunk-rainy-alley",
    name: "비 내리는 사이버 네온 골목 (3D 프리셋)",
    description: "네온사인 반사와 젖은 아스팔트 바닥 효과가 포함된 SF/스릴러 분위기의 3D 골목 씬 프리셋.",
    kind: "3d-preset",
    tags: ["3D배경", "사이버펑크", "골목", "네온", "비", "밤"],
    entries: [
      {
        id: "cyberpunk-rainy-alley/main",
        name: "네온 골목 씬",
        delivery: {
          mode: "procedural-recipe",
          recipeId: "procedural-neon-alleyway",
          parameters: { wetness: 0.85, fogDensity: 0.4, primaryLight: "#06b6d4" },
        },
      },
    ],
  },
  {
    id: "e0000002-0000-4000-8000-000000000004",
    packageId: "official/3d-preset/joseon-hanok-room",
    name: "고즈넉한 조선 한옥 사랑채 (3D 프리셋)",
    description: "창호지 문살과 대청마루, 은은한 자연광이 비치는 사극·동양풍 웹툰 맞춤형 전통 한옥 실내 3D 배경 프리셋.",
    kind: "3d-preset",
    tags: ["3D배경", "한옥", "사극", "동양풍", "조선", "목재"],
    entries: [
      {
        id: "joseon-hanok-room/main",
        name: "한옥 사랑채 씬",
        delivery: {
          mode: "procedural-recipe",
          recipeId: "procedural-joseon-hanok",
          parameters: { woodTone: "traditional-chestnut", paperOpacity: 0.7, morningSun: true },
        },
      },
    ],
  },

  // ── 3. 브러시 (Brushes - Clip Studio Top Materials) ──
  {
    id: "e0000003-0000-4000-8000-000000000001",
    packageId: "official/brush/pro-real-g-pen",
    name: "클립스튜디오 스타일 리얼 G펜",
    description: "섬세한 필압 반응과 날렵한 손떨림 보정이 적용된 웹툰 메인 펜선용 정통 G펜 브러시. 잉크 농담과 테이퍼링이 살아있습니다.",
    kind: "brush",
    tags: ["브러시", "G펜", "펜선", "선화", "필압", "기본", "공식"],
    entries: [
      {
        id: "pro-real-g-pen/main",
        name: "리얼 G펜",
        delivery: {
          mode: "portable-json",
          definition: {
            snapshot: {
              presetId: "real-g-pen",
              family: "pen",
              size: 8,
              opacity: 1,
              flow: 0.95,
              color: "#18181b",
            },
          },
        },
      },
    ],
  },
  {
    id: "e0000003-0000-4000-8000-000000000002",
    packageId: "official/brush/rofan-lace-frills",
    name: "로판 드레스 레이스 & 프릴 브러시",
    description: "로맨스 판타지 귀족 드레스 옷단, 소매, 베일 장식에 슥 긋기만 하면 화려하게 수놓아지는 고해상도 연속 패턴 브러시.",
    kind: "brush",
    tags: ["브러시", "레이스", "프릴", "로판", "드레스", "패턴"],
    entries: [
      {
        id: "rofan-lace-frills/main",
        name: "황실 레이스 브러시",
        delivery: {
          mode: "portable-json",
          definition: {
            snapshot: {
              presetId: "lace-frills-ribbon",
              family: "pattern",
              size: 28,
              opacity: 0.95,
              flow: 1.0,
              color: "#f8fafc",
            },
          },
        },
      },
    ],
  },
  {
    id: "e0000003-0000-4000-8000-000000000003",
    packageId: "official/brush/action-speedlines-dynamic",
    name: "웹툰 액션 집중선 & 속도선 브러시",
    description: "강력한 타격감과 질주감을 한 번의 스트로크로 연출할 수 있는 다이내믹 집중선·속도선 브러시.",
    kind: "brush",
    tags: ["브러시", "집중선", "속도선", "액션", "효과선", "타격감"],
    entries: [
      {
        id: "action-speedlines-dynamic/main",
        name: "액션 속도선 펜",
        delivery: {
          mode: "portable-json",
          definition: {
            snapshot: {
              presetId: "action-speedline-brush",
              family: "fx",
              size: 36,
              opacity: 1,
              flow: 0.9,
              color: "#09090b",
            },
          },
        },
      },
    ],
  },
  {
    id: "e0000003-0000-4000-8000-000000000004",
    packageId: "official/brush/emotional-sparkles-bokeh",
    name: "감정 연출 반짝이 & 보케 파티클",
    description: "인물의 두근거림, 감동, 회상 컷에서 몽환적이고 반짝이는 감성을 극대화해 주는 감성 파티클 브러시.",
    kind: "brush",
    tags: ["브러시", "반짝이", "파티클", "보케", "감정", "로판"],
    entries: [
      {
        id: "emotional-sparkles-bokeh/main",
        name: "스파클 보케 브러시",
        delivery: {
          mode: "portable-json",
          definition: {
            snapshot: {
              presetId: "sparkle-bokeh-scatter",
              family: "particle",
              size: 32,
              opacity: 0.85,
              flow: 0.75,
              color: "#fbbf24",
            },
          },
        },
      },
    ],
  },
  {
    id: "e0000003-0000-4000-8000-000000000005",
    packageId: "official/brush/traditional-ink-wash",
    name: "전통 수묵 잉크 워시 브러시",
    description: "은은한 번짐과 캘리그래피 느낌의 붓결을 표현하는 수묵 채색 브러시. 무협 및 사극 웹툰 분위기 연출에 탁월합니다.",
    kind: "brush",
    tags: ["브러시", "수묵", "동양화", "수채화", "번짐", "무협"],
    entries: [
      {
        id: "traditional-ink-wash/main",
        name: "수묵 먹선 붓",
        delivery: {
          mode: "portable-json",
          definition: {
            snapshot: {
              presetId: "ink-wash-sumi",
              family: "watercolor",
              size: 24,
              opacity: 0.75,
              flow: 0.6,
              color: "#27272a",
            },
          },
        },
      },
    ],
  },

  // ── 4. 팔레트 (Palettes & Webtoon Color Grading) ──
  {
    id: "e0000004-0000-4000-8000-000000000001",
    packageId: "official/palette/pastel-romance-fantasy",
    name: "로맨스 판타지 파스텔 팔레트",
    description: "로맨스 판타지 드레스, 티타임, 꽃 배경 등에 어울리는 부드럽고 화사한 파스텔 톤 8색 세트.",
    kind: "palette",
    tags: ["팔레트", "로판", "파스텔", "화사함", "디저트"],
    entries: [
      {
        id: "pastel-romance-fantasy/main",
        name: "로판 파스텔 세트",
        delivery: {
          mode: "portable-json",
          definition: {
            colors: [
              "#fdf2f8",
              "#fce7f3",
              "#fbcfe8",
              "#f472b6",
              "#fef3c7",
              "#fde68a",
              "#ccfbf1",
              "#99f6e4",
            ],
          },
        },
      },
    ],
  },
  {
    id: "e0000004-0000-4000-8000-000000000002",
    packageId: "official/palette/twilight-neo-tokyo",
    name: "황혼의 네오 도쿄 8색 팔레트",
    description: "도심의 석양과 네온 빛이 어우러지는 감각적인 8색 컬러 세트. 인물 채색과 배경 라이팅 조화에 최적화되었습니다.",
    kind: "palette",
    tags: ["팔레트", "석양", "네온", "시티", "컬러"],
    entries: [
      {
        id: "twilight-neo-tokyo/main",
        name: "네오 도쿄 컬러 세트",
        delivery: {
          mode: "portable-json",
          definition: {
            colors: [
              "#1e1b4b",
              "#4338ca",
              "#7c3aed",
              "#c026d3",
              "#f43f5e",
              "#fb923c",
              "#fde047",
              "#f8fafc",
            ],
          },
        },
      },
    ],
  },
  {
    id: "e0000004-0000-4000-8000-000000000003",
    packageId: "official/palette/morning-classroom-pastel",
    name: "청춘 학원물 아침 햇살 8색 팔레트",
    description: "맑은 아침 등굣길과 따뜻한 교실 풍경에 어울리는 청량하고 산뜻한 청춘물 전용 컬러 세트.",
    kind: "palette",
    tags: ["팔레트", "학원물", "학교", "아침", "청춘"],
    entries: [
      {
        id: "morning-classroom-pastel/main",
        name: "청춘 아침 컬러 세트",
        delivery: {
          mode: "portable-json",
          definition: {
            colors: [
              "#f0f9ff",
              "#e0f2fe",
              "#bae6fd",
              "#38bdf8",
              "#fef9c3",
              "#fde047",
              "#fed7aa",
              "#f43f5e",
            ],
          },
        },
      },
    ],
  },

  // ── 5. 필터 (Filters & Mood Grading) ──
  {
    id: "e0000005-0000-4000-8000-000000000001",
    packageId: "official/filter/golden-hour-cinematic",
    name: "골든 아워 시네마틱 무드 필터",
    description: "따스한 온기와 깊이 있는 명암을 부여해 완성 원고의 감성적인 깊이를 끌어올리는 시네마틱 필터 프리셋.",
    kind: "filter",
    tags: ["필터", "시네마틱", "골든아워", "보정", "대비"],
    entries: [
      {
        id: "golden-hour-cinematic/main",
        name: "골든 아워",
        delivery: {
          mode: "portable-json",
          definition: {
            engine: "studio-filter-stack-v1",
            values: { temperature: 28, contrast: 1.18, vignette: 0.25, saturation: 1.1 },
          },
        },
      },
    ],
  },
  {
    id: "e0000005-0000-4000-8000-000000000002",
    packageId: "official/filter/rofan-dreamy-glow",
    name: "로판 감성 몽환적 소프트 글로우 필터",
    description: "인물의 하이라이트를 부드럽게 확산시켜 순정만화 주인공처럼 돋보이게 만드는 소프트 블룸 필터.",
    kind: "filter",
    tags: ["필터", "로판", "글로우", "블룸", "감성"],
    entries: [
      {
        id: "rofan-dreamy-glow/main",
        name: "소프트 글로우",
        delivery: {
          mode: "portable-json",
          definition: {
            engine: "studio-filter-stack-v1",
            values: { bloom: 0.45, brightness: 1.06, highlights: 1.2, softness: 0.3 },
          },
        },
      },
    ],
  },

  // ── 6. 장면 템플릿 (Scene Templates) ──
  {
    id: "e0000006-0000-4000-8000-000000000001",
    packageId: "official/template/webtoon-vertical-4cut",
    name: "웹툰 표준 세로 스크롤 4단 연출 템플릿",
    description: "모바일 스크롤에 최적화된 여백과 컷 배치가 사전 계산된 표준 연출 가이드 템플릿. 1클릭으로 컷 구성을 로드합니다.",
    kind: "template",
    tags: ["템플릿", "세로스크롤", "4컷", "연출", "모바일"],
    entries: [
      {
        id: "webtoon-vertical-4cut/main",
        name: "표준 4단 레이아웃",
        delivery: {
          mode: "builtin-ref",
          runtimeRef: `${CREATOR_MARKETPLACE_BUILTIN_PREFIX_BY_KIND.template}webtoon-vertical-standard-4cut`,
        },
      },
    ],
  },
  {
    id: "e0000006-0000-4000-8000-000000000002",
    packageId: "official/template/rofan-climax-splash",
    name: "로판 전면 컷 & 대화 클라이맥스 템플릿",
    description: "인물 전신 일러스트 컷과 긴장감 있는 대사 티키타카 컷 배치가 결합된 로맨스 판타지 전용 템플릿.",
    kind: "template",
    tags: ["템플릿", "로판", "클라이맥스", "전신컷", "연출"],
    entries: [
      {
        id: "rofan-climax-splash/main",
        name: "로판 클라이맥스 템플릿",
        delivery: {
          mode: "builtin-ref",
          runtimeRef: `${CREATOR_MARKETPLACE_BUILTIN_PREFIX_BY_KIND.template}rofan-climax-splash-cut`,
        },
      },
    ],
  },

  // ── 7. 에셋 (2D Assets & Speech Bubbles) ──
  {
    id: "e0000007-0000-4000-8000-000000000001",
    packageId: "official/asset/comic-emphasis-bubbles",
    name: "만화 감정 말풍선 & 집중선 팩",
    description: "당황, 외침, 독백 등 다양한 감정 상태를 표현할 수 있는 벡터 기반의 반응형 말풍선 팩.",
    kind: "asset",
    tags: ["에셋", "말풍선", "집중선", "효과", "벡터"],
    entries: [
      {
        id: "comic-emphasis-bubbles/main",
        name: "감정 말풍선 컬렉션",
        delivery: {
          mode: "procedural-recipe",
          recipeId: "comic-speech-bubble-emphasis",
          parameters: { bubbleStyle: "jagged-burst", strokeWidth: 3, tailAngle: 45 },
        },
      },
    ],
  },
];

function buildStarterRecord(def: StarterItemDef): CreatorMarketplaceResourceRecord {
  const entries = def.entries.map((entry) => {
    if (entry.delivery.mode === "builtin-ref") {
      const payload = {
        schemaVersion: 1 as const,
        resourceKind: def.kind,
        runtime: CREATOR_MARKETPLACE_RUNTIME_BY_KIND[def.kind],
        runtimeRef: entry.delivery.runtimeRef,
      };
      return {
        id: entry.id,
        kind: def.kind,
        name: entry.name,
        delivery: {
          mode: "builtin-ref" as const,
          runtimeRef: entry.delivery.runtimeRef,
          byteSize: 0,
          sha256: sha256Hex(payload),
        },
      };
    }

    if (entry.delivery.mode === "procedural-recipe") {
      const payload = {
        schemaVersion: 1 as const,
        resourceKind: def.kind,
        runtime: CREATOR_MARKETPLACE_RUNTIME_BY_KIND[def.kind],
        definition: {
          recipeId: entry.delivery.recipeId,
          ...(entry.delivery.parameters ? { parameters: entry.delivery.parameters } : {}),
        },
      };
      return {
        id: entry.id,
        kind: def.kind,
        name: entry.name,
        delivery: {
          mode: "procedural-recipe" as const,
          mediaType: `application/vnd.toonspectrum.${def.kind}+json`,
          payload,
          byteSize: creatorMarketplaceJsonByteSize(payload),
          sha256: sha256Hex(payload),
        },
      };
    }

    const payload = {
      schemaVersion: 1 as const,
      resourceKind: def.kind,
      runtime: CREATOR_MARKETPLACE_RUNTIME_BY_KIND[def.kind],
      definition: entry.delivery.definition,
    };
    return {
      id: entry.id,
      kind: def.kind,
      name: entry.name,
      delivery: {
        mode: "portable-json" as const,
        mediaType: `application/vnd.toonspectrum.${def.kind}+json`,
        payload,
        byteSize: creatorMarketplaceJsonByteSize(payload),
        sha256: sha256Hex(payload),
      },
    };
  });

  const manifestToHash = {
    schemaVersion: 1 as const,
    packageId: def.packageId,
    name: def.name,
    description: def.description,
    kind: def.kind,
    resourceVersion: "1.0.0",
    minimumStudioVersion: "0.1.0",
    tags: def.tags,
    license: "toonspectrum-standard" as const,
    attributionText: "",
    containsAi: false,
    rightsConfirmed: true as const,
    provenance: { origin: "original" as const, authoredByPublisher: true as const },
    compatibility: { engines: ["canvas2d" as const, "three" as const] },
    entries,
  };

  const rawRecord = {
    schemaVersion: 1,
    id: def.id,
    packageId: def.packageId,
    name: def.name,
    description: def.description,
    kind: def.kind,
    resourceVersion: "1.0.0",
    minimumStudioVersion: "0.1.0",
    tags: def.tags,
    license: "toonspectrum-standard",
    attributionText: "",
    containsAi: false,
    provenance: { origin: "original", authoredByPublisher: true },
    compatibility: { engines: ["canvas2d", "three"] },
    entries,
    manifestHash: sha256Hex(manifestToHash),
    manifestByteSize: creatorMarketplaceJsonByteSize(manifestToHash),
    publisher: OFFICIAL_PUBLISHER,
    createdAt: STARTER_TIMESTAMP,
    updatedAt: STARTER_TIMESTAMP,
    isOwner: false,
    access: "free" as const,
  };

  return CreatorMarketplaceResourceRecordSchema.parse(rawRecord);
}

/**
 * 사전 검증된 공식 스타터 리소스 레코드 목록 (3D 에셋, 3D 프리셋, 브러시, 팔레트, 필터, 템플릿, 에셋 전 7종 구비).
 */
export const CREATOR_MARKETPLACE_STARTER_RECORDS: readonly CreatorMarketplaceResourceRecord[] =
  Object.freeze(RAW_STARTER_DEFS.map(buildStarterRecord));

/**
 * ID로 공식 스타터 리소스 단건 검색
 */
export function findStarterMarketplaceResourceById(
  id: string,
): CreatorMarketplaceResourceRecord | null {
  return (
    CREATOR_MARKETPLACE_STARTER_RECORDS.find((record) => record.id === id) ??
    null
  );
}

export interface FilterStarterRecordsOptions {
  limit?: number;
  search?: string;
  kind?: string;
  license?: string;
  tag?: string;
  publisher?: string;
  sort?: "newest" | "relevance";
}

/**
 * 검색/필터 쿼리에 맞게 공식 스타터 리소스를 필터링하여 페이지 형태로 반환
 */
export function filterStarterMarketplaceResources(
  options: FilterStarterRecordsOptions = {},
): {
  items: CreatorMarketplaceResourceRecord[];
  limit: number;
  hasMore: boolean;
  nextCursor: string | null;
} {
  const limit = Math.max(1, Math.min(options.limit ?? 24, 48));
  let filtered = [...CREATOR_MARKETPLACE_STARTER_RECORDS];

  if (options.kind) {
    filtered = filtered.filter((r) => r.kind === options.kind);
  }
  if (options.license) {
    filtered = filtered.filter((r) => r.license === options.license);
  }
  if (options.tag) {
    const targetTag = options.tag.toLowerCase();
    filtered = filtered.filter((r) =>
      r.tags.some((t) => t.toLowerCase() === targetTag),
    );
  }
  if (options.publisher) {
    filtered = filtered.filter((r) => r.publisher.id === options.publisher);
  }
  if (options.search) {
    const query = options.search.toLowerCase().trim();
    filtered = filtered.filter(
      (r) =>
        r.name.toLowerCase().includes(query) ||
        r.description.toLowerCase().includes(query) ||
        r.packageId.toLowerCase().includes(query) ||
        r.tags.some((t) => t.toLowerCase().includes(query)),
    );
  }

  const items = filtered.slice(0, limit);
  return {
    items,
    limit,
    hasMore: filtered.length > limit,
    nextCursor: null,
  };
}
