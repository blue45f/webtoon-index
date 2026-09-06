import {
  STUDIO_BRUSH_PACK_CATALOG_IDS,
  isStudioBrushPackCatalogId,
  type StudioBrushPackCatalogId,
} from "./studio-brush-pack-id";

import type { StudioBrushPreviewStyle } from "./studio-brush-visual";
import type { StudioBrushMediaGroup } from "../studio-creative-ux";

export type StudioBrushPackRuntimeBrushId = "ink-particle" | "airbrush" | "dry-media";

export type StudioBrushPackCategory =
  | "ink"
  | "sketch"
  | "chalk"
  | "flat"
  | "marker"
  | "texture"
  | "paint"
  | "rake"
  | "foliage"
  | "pattern"
  | "stamp"
  | "pixel"
  | "tone"
  | "effect";

/** Display-only catalogue data. The full dynamics snapshot stays in the lazy runtime module. */
export interface StudioBrushPackDescriptor {
  catalogId: StudioBrushPackCatalogId;
  catalogName: string;
  shortName: string;
  hint: string;
  category: StudioBrushPackCategory;
  defaultWidth: number;
  defaultOpacity: number;
  runtimeBrushId: StudioBrushPackRuntimeBrushId;
  mediaGroup: StudioBrushMediaGroup;
  previewStyle: StudioBrushPreviewStyle;
  previewWeight: number;
}

type DescriptorRow = readonly [
  name: string,
  shortName: string,
  hint: string,
  category: StudioBrushPackCategory,
  width: number,
  opacity: number,
  runtime: StudioBrushPackRuntimeBrushId,
  preview: StudioBrushPreviewStyle,
  weight: number,
];

/**
 * 재질은 행에 따로 적지 않고 (카테고리, 런타임 브러시)에서 파생한다. 손으로 적던 `media` 열은
 * 카테고리와 자주 어긋났고 — "수채 평면 워시"가 채색으로, "곱슬 모발 리본"이 선화로 —
 * 같은 재료의 브러시가 서로 다른 탭에 흩어지는 원인이었다.
 *
 * 팩 런타임은 ink-particle / airbrush / dry-media 세 가지뿐이라 진짜 웻엣지 엔진이 없다.
 * 그래서 이름에 "수채"가 들어간 프로 브러시도 수채 탭에 넣지 않는다 — 그 탭은 실제로
 * `watercolor-dabs` 엔진이 번짐을 그리는 코어 브러시의 자리다.
 */
const PACK_CATEGORY_MATERIAL_GROUP: Readonly<
  Record<StudioBrushPackCategory, StudioBrushMediaGroup>
> = Object.freeze({
  ink: "ink",
  sketch: "pencil",
  chalk: "pastel",
  marker: "marker",
  // 평붓·칼끝·블록은 유화/아크릴 몸체 붓과 같은 단단한 자국을 남긴다.
  flat: "oil",
  texture: "texture",
  rake: "texture",
  foliage: "texture",
  pattern: "texture",
  stamp: "texture",
  pixel: "texture",
  tone: "tone",
  effect: "fx",
  // `paint` 만 재료 폭이 넓어 런타임으로 한 번 더 쪼갠다(아래 참조).
  paint: "oil",
});

const PAINT_RUNTIME_MATERIAL_GROUP: Readonly<
  Record<StudioBrushPackRuntimeBrushId, StudioBrushMediaGroup>
> = Object.freeze({
  // 소프트 입자 확산 = 에어브러시. 이름이 "워시"여도 렌더러가 남기는 자국은 에어다.
  airbrush: "airbrush",
  "ink-particle": "oil",
  "dry-media": "oil",
});

export function studioBrushPackMaterialGroup(
  category: StudioBrushPackCategory,
  runtimeBrushId: StudioBrushPackRuntimeBrushId
): StudioBrushMediaGroup {
  return category === "paint"
    ? PAINT_RUNTIME_MATERIAL_GROUP[runtimeBrushId]
    : PACK_CATEGORY_MATERIAL_GROUP[category];
}

/*
 * Original Korean names and descriptions describe behavior, not proprietary brush assets. Rows
 * intentionally align with STUDIO_BRUSH_PACK_CATALOG_IDS so ids and runtime profiles share one
 * compact ordinal without duplicating identity strings in the lazy chunk.
 */
const DESCRIPTOR_ROWS: readonly DescriptorRow[] = [
  ["만능 원형", "원형", "고른 가장자리로 선화와 채색을 모두 처리하는 기본 원형 촉", "ink", 8, 1, "ink-particle", "solid", 0.46],
  ["선명 잉크", "선명 잉크", "빠른 획에도 검고 또렷하게 이어지는 잉크 펜", "ink", 6, 1, "ink-particle", "wavy", 0.4],
  ["유연 잉크", "유연 잉크", "필압에 따라 가늘고 굵게 부드럽게 전환되는 잉크", "ink", 9, 0.96, "ink-particle", "calligraphy", 0.52],
  ["구름 소프트", "구름", "넓고 부드러운 가장자리의 저농도 블렌딩 촉", "paint", 36, 0.48, "airbrush", "soft", 0.72],
  ["안개 소프트", "안개", "여러 번 쌓아 은은한 명암을 만드는 초연질 촉", "paint", 52, 0.58, "airbrush", "soft", 0.84],
  ["파우더 스케치", "파우더", "분말이 끊겨 묻는 가벼운 러프 스케치", "sketch", 7, 0.76, "dry-media", "dashed", 0.34],
  ["라운드 스케치", "라운드", "둥근 입자로 매끄럽게 이어지는 스케치 연필", "sketch", 5, 0.84, "dry-media", "dashed", 0.3],
  ["결 스케치", "결 스케치", "종이 결을 드러내는 성긴 스케치 촉", "sketch", 8, 0.7, "dry-media", "texture", 0.39],
  ["정밀 연필", "정밀 연필", "가느다란 선과 작은 명암에 맞춘 단단한 연필", "sketch", 3, 0.88, "dry-media", "dashed", 0.22],
  ["부드러운 명암 촉", "명암 촉", "가장자리가 부드럽게 사라지는 건식 명암 촉 — 겹칠수록 선형으로 쌓이는 넓은 농담", "sketch", 7, 0.68, "dry-media", "texture", 0.38],
  ["극세 흑연", "극세 흑연", "잔털처럼 가는 흑연 결을 겹쳐 묘사하는 촉", "sketch", 3, 0.9, "dry-media", "dashed", 0.16],
  ["원형 농담", "원형 농담", "압력에 따라 투명도가 변하는 둥근 채색 촉", "ink", 18, 0.72, "ink-particle", "soft", 0.58],
  ["타원 농담", "타원 농담", "기울어진 타원 촉으로 넓은 농담을 만드는 붓", "flat", 22, 0.68, "ink-particle", "calligraphy", 0.64],
  ["백묵 가루", "백묵 가루", "곱게 부서지는 분필 가루가 고르게 묻는 촉", "chalk", 14, 0.72, "dry-media", "texture", 0.55],
  ["거친 백묵", "거친 백묵", "큼직한 공극이 남는 칠판용 거친 분필", "chalk", 18, 0.66, "dry-media", "dashed", 0.62],
  ["압착 백묵", "압착 백묵", "단단한 모서리와 잔가루가 함께 남는 압착 분필", "chalk", 11, 0.82, "dry-media", "texture", 0.48],
  ["덩굴 획", "덩굴", "두 줄기가 휘감기듯 반복되는 장식용 획", "pattern", 20, 0.88, "ink-particle", "wavy", 0.66],
  ["버들 결", "버들", "가늘고 긴 섬유가 흐르는 방향성 장식 붓", "pattern", 24, 0.74, "dry-media", "wavy", 0.7],
  ["벨벳 목탄", "벨벳 목탄", "뭉근한 중심과 부서진 가장자리를 가진 목탄", "chalk", 20, 0.62, "dry-media", "soft", 0.68],
  ["선면 블록", "선면 블록", "얇은 선과 넓은 면이 번갈아 나타나는 블록 촉", "flat", 22, 0.9, "ink-particle", "calligraphy", 0.7],
  ["각진 사각", "사각", "정사각형 모서리를 유지하는 픽토리얼 채색 촉", "flat", 18, 0.94, "ink-particle", "solid", 0.6],
  ["수평 칼끝", "수평 칼끝", "가로로 길고 얇은 칼날형 평붓", "flat", 24, 0.96, "ink-particle", "calligraphy", 0.68],
  ["수직 칼끝", "수직 칼끝", "세로로 선 날을 유지하는 레터링 평붓", "flat", 24, 0.96, "ink-particle", "calligraphy", 0.68],
  ["단정 평붓", "평붓", "획 방향을 따라 정렬되는 고른 평면 붓", "flat", 26, 0.92, "ink-particle", "solid", 0.72],
  ["흩어진 평붓", "흩어진 평붓", "평평한 촉 주변으로 미세 입자가 흩어지는 붓", "flat", 28, 0.78, "dry-media", "texture", 0.76],
  ["리듬 평붓", "리듬 평붓", "간격을 두고 반복되는 평면 자국을 만드는 붓", "flat", 30, 0.86, "ink-particle", "dashed", 0.78],
  ["방향성 평붓", "방향 평붓", "진행 방향으로 흩어지는 평면 자국 촉", "flat", 32, 0.8, "dry-media", "texture", 0.8],
  ["클래식 마커", "클래식", "겹칠수록 농도가 쌓이는 둥근 마커", "marker", 18, 0.62, "ink-particle", "solid", 0.64],
  ["섬유 마커", "섬유 마커", "펠트 섬유 결이 보이는 반투명 마커", "marker", 20, 0.56, "dry-media", "texture", 0.68],
  ["단정 평면 마커", "평면 마커", "빈틈 없이 고르게 칠해지는 납작 마커", "marker", 26, 0.7, "ink-particle", "calligraphy", 0.74],
  ["투명 평면", "투명 평면", "넓은 면을 옅게 겹쳐 칠하는 투명 평촉", "marker", 34, 0.38, "airbrush", "soft", 0.82],
  ["단단 타원", "단단 타원", "경계가 선명한 타원형 마커 촉", "marker", 17, 0.92, "ink-particle", "solid", 0.58],
  ["원단 질감", "원단", "촘촘한 직물 섬유가 묻어나는 질감 붓", "texture", 26, 0.7, "dry-media", "texture", 0.72],
  ["거친 결", "거친 결", "작고 불규칙한 공극을 남기는 질감 붓", "texture", 20, 0.72, "dry-media", "dashed", 0.64],
  ["강한 거친 결", "강한 거침", "선명한 입자 대비로 표면을 거칠게 만드는 붓", "texture", 25, 0.78, "dry-media", "texture", 0.72],
  ["두터운 거친 결", "두터운 거침", "큰 덩어리와 균열이 함께 나타나는 두꺼운 촉", "texture", 36, 0.84, "dry-media", "oil", 0.86],
  ["번진 얼룩", "얼룩", "불규칙한 가장자리로 물든 얼룩을 쌓는 촉", "texture", 42, 0.42, "airbrush", "soft", 0.88],
  ["모래 질감", "모래", "미세한 알갱이가 촘촘히 흩어지는 표면 촉", "texture", 24, 0.66, "dry-media", "dots", 0.68],
  ["석고 질감", "석고", "밝고 둔한 덩어리가 겹치는 석고 표면 촉", "texture", 30, 0.72, "dry-media", "texture", 0.78],
  ["암석 결", "암석", "각진 균열과 알갱이로 바위 표면을 만드는 붓", "texture", 38, 0.78, "dry-media", "texture", 0.86],
  ["솜결", "솜결", "가볍고 성긴 섬유가 퍼지는 포근한 질감 촉", "texture", 40, 0.46, "airbrush", "soft", 0.88],
  ["요철 결", "요철", "불규칙한 돌기가 이어지는 입체 표면 촉", "texture", 28, 0.74, "dry-media", "dots", 0.74],
  ["둥근 채색붓", "둥근 붓", "중심 농도가 높은 원형 페인팅 붓", "paint", 24, 0.86, "ink-particle", "oil", 0.7],
  ["물감 잉크", "물감 잉크", "물감의 결에 잉크 선명도를 섞은 방향성 붓", "paint", 20, 0.84, "ink-particle", "oil", 0.68],
  ["페인트 롤러", "롤러", "평행한 롤러 결로 넓은 면을 빠르게 채우는 붓", "paint", 46, 0.76, "dry-media", "texture", 0.92],
  ["입자 흩뿌림", "흩뿌림", "압력과 속도에 따라 입자 반경이 변하는 스프레이", "paint", 44, 0.46, "airbrush", "dots", 0.9],
  ["거친 잉크", "거친 잉크", "마른 공극과 젖은 중심이 공존하는 텍스처 잉크", "ink", 16, 0.86, "dry-media", "texture", 0.58],
  ["가는 갈퀴", "가는 갈퀴", "여러 가는 선을 일정 간격으로 긋는 갈퀴 붓", "rake", 22, 0.82, "dry-media", "dashed", 0.66],
  ["넓은 갈퀴", "넓은 갈퀴", "굵기가 다른 평행 섬유를 넓게 펼치는 붓", "rake", 34, 0.78, "dry-media", "texture", 0.82],
  ["마른 갈퀴", "마른 갈퀴", "중간중간 끊기는 마른 평행 결을 만드는 붓", "rake", 30, 0.68, "dry-media", "dashed", 0.78],
  ["초목 질감", "초목", "작은 줄기와 잎 점을 섞어 숲 바닥을 채우는 촉", "foliage", 38, 0.72, "dry-media", "texture", 0.86],
  ["흩어진 잔디", "성긴 잔디", "긴 풀잎을 넓은 반경에 성기게 흩뿌리는 붓", "foliage", 42, 0.74, "dry-media", "dashed", 0.88],
  ["빽빽한 잔디", "빽빽 잔디", "짧고 많은 풀잎을 밀도 높게 쌓는 붓", "foliage", 38, 0.82, "dry-media", "texture", 0.86],
  ["새잎", "새잎", "작고 뾰족한 잎 자국을 자연스럽게 흩는 촉", "foliage", 20, 0.88, "ink-particle", "dots", 0.62],
  ["긴잎", "긴잎", "가늘고 긴 잎 자국이 방향을 따라 회전하는 촉", "foliage", 26, 0.84, "ink-particle", "wavy", 0.7],
  ["둥근잎", "둥근잎", "둥글고 도톰한 잎 자국을 겹쳐 채우는 촉", "foliage", 24, 0.82, "ink-particle", "dots", 0.68],
  ["잎송이", "잎송이", "크기가 다른 잎을 묶음으로 흩뿌리는 장식 촉", "foliage", 34, 0.78, "ink-particle", "glitter", 0.8],
  ["자유 도장", "자유 도장", "비정형 덩어리를 가볍게 반복하는 장식 스탬프", "stamp", 26, 0.86, "ink-particle", "glitter", 0.72],
  ["흩어진 타원", "흩어진 타원", "작은 타원 자국을 넓게 흩어 배치하는 촉", "pattern", 28, 0.74, "airbrush", "dots", 0.74],
  ["매끈 타원", "매끈 타원", "고른 타원 도장을 리듬 있게 이어 붙이는 촉", "pattern", 22, 0.9, "ink-particle", "solid", 0.66],
  ["겹 타원", "겹 타원", "서로 다른 크기의 타원 자국을 겹치는 촉", "pattern", 30, 0.8, "ink-particle", "glitter", 0.78],
  ["바둑 격자", "격자", "교차하는 칸무늬를 일정하게 이어 그리는 패턴 촉", "pattern", 28, 0.92, "ink-particle", "tone", 0.74],
  ["머리카락 결", "머리카락", "굵기가 다른 여러 모발 선을 한 번에 긋는 붓", "rake", 16, 0.9, "ink-particle", "dashed", 0.56],
  ["고른 줄무늬", "줄무늬", "평행한 굵은 줄을 일정 간격으로 반복하는 붓", "pattern", 30, 0.86, "ink-particle", "dashed", 0.76],
  ["거친 줄무늬", "거친 줄", "끊기고 흔들리는 평행 줄을 겹치는 질감 붓", "pattern", 34, 0.7, "dry-media", "texture", 0.82],
  ["발자국 도장", "발자국", "좌우 발자국이 번갈아 이어지는 장식 스탬프", "stamp", 24, 0.92, "ink-particle", "dots", 0.68],
  ["하트 도장", "하트", "손그림 느낌의 하트 자국을 이어 찍는 스탬프", "stamp", 26, 0.94, "ink-particle", "glitter", 0.72],
  ["초정밀 제도 잉크", "제도 잉크", "극세 제도선과 웹툰 세부 선화를 또렷하게 잇는 단단한 잉킹 촉", "ink", 2, 1, "ink-particle", "solid", 0.2],
  ["마른 깨짐 잉크", "깨짐 잉크", "마른 붓과 닳은 펜촉처럼 공극이 생기는 거친 드라이 잉크", "ink", 11, 0.9, "dry-media", "texture", 0.48],
  ["측면 흑연 음영", "측면 흑연", "연필 측면을 눕힌 듯 넓은 흑연 입자와 종이결을 쌓는 음영 촉", "sketch", 13, 0.58, "dry-media", "texture", 0.58],
  ["압축 목탄 모서리", "압축 목탄", "압축 목탄의 단단한 모서리와 부서지는 가루를 함께 남기는 촉", "chalk", 15, 0.76, "dry-media", "dashed", 0.62],
  ["수채 세필", "수채 세필", "가느다란 수채 세부 묘사와 투명한 농담을 겹쳐 만드는 원형 붓", "paint", 7, 0.62, "ink-particle", "soft", 0.36],
  ["수채 평면 워시", "평면 워시", "넓은 수채 워시와 가장자리 물고임을 만드는 부드러운 평붓", "paint", 42, 0.36, "airbrush", "soft", 0.9],
  ["불투명 구아슈", "구아슈", "매트한 불투명 구아슈 물감을 빈틈 없이 겹쳐 칠하는 채색 붓", "paint", 27, 0.92, "ink-particle", "oil", 0.76],
  ["필버트 유화", "필버트", "둥근 타원 모서리와 굵은 강모 결로 유화 면과 세부를 함께 칠하는 붓", "paint", 31, 0.9, "dry-media", "oil", 0.82],
  ["알코올 사선 마커", "사선 마커", "사선 평촉으로 넓은 알코올 마커 면과 가는 모서리를 전환하는 촉", "marker", 25, 0.52, "ink-particle", "calligraphy", 0.72],
  ["테이퍼 브러시 마커", "브러시 마커", "필압에 따라 시작과 끝이 가늘어지는 섬유형 브러시 마커", "marker", 14, 0.72, "dry-media", "wavy", 0.56],
  ["픽셀 정사각 촉", "픽셀 사각", "각진 정사각 도장을 촘촘히 이어 또렷한 픽셀 계단선을 만드는 촉", "pixel", 8, 1, "ink-particle", "solid", 0.38],
  ["픽셀 디더 패턴", "픽셀 디더", "체커형 픽셀 점을 규칙적으로 쌓아 제한 색 디더링 명암을 만드는 촉", "pixel", 16, 0.9, "ink-particle", "tone", 0.54],
  ["교차 해칭", "교차 해칭", "서로 교차하는 가는 선 묶음으로 만화 음영과 재질을 빠르게 쌓는 촉", "tone", 18, 0.78, "dry-media", "dashed", 0.64],
  ["속도 해칭", "속도 해칭", "진행 방향으로 길게 뻗는 평행 해칭을 이용해 속도감과 그림자를 더하는 촉", "tone", 24, 0.82, "ink-particle", "wavy", 0.72],
  ["고밀도 망점", "고밀도 망점", "촘촘한 원형 망점을 반복해 웹툰 스크린톤 농담을 만드는 패턴 촉", "tone", 22, 0.86, "ink-particle", "tone", 0.68],
  ["보케 빛망울", "보케", "크기와 농도가 다른 부드러운 빛망울을 흩뿌려 배경 보케 효과를 만드는 촉", "effect", 48, 0.5, "airbrush", "glitter", 0.92],
  ["캔버스 직조", "직조", "가로세로 실이 교차하는 캔버스 천 결을 넓게 쌓는 표면 질감 촉", "texture", 32, 0.66, "dry-media", "texture", 0.8],
  ["극세 모발 다발", "극세 모발", "굵기와 흐름이 다른 여러 머리카락을 한 획으로 자연스럽게 잇는 보조 붓", "rake", 12, 0.86, "ink-particle", "dashed", 0.5],
  ["천주름 갈퀴", "천주름", "완만하게 휘는 평행 섬유선으로 옷주름과 천의 흐름을 잡는 보조 붓", "rake", 28, 0.68, "dry-media", "wavy", 0.76],
  ["솔잎 군집", "솔잎", "중심에서 뻗는 가는 솔잎 묶음을 흩어 식생과 침엽수 가지를 채우는 촉", "foliage", 30, 0.8, "ink-particle", "dots", 0.78],
  // ── 2026-07 확장 웨이브(33) — studio-brush-pack-id.ts 뒤 33개 id와 순서 정렬.
  ["4B 거친 연필", "4B 연필", "무른 4B 심이 종이 요철에 굵고 거칠게 갈리는 러프 스케치 연필", "sketch", 9, 0.8, "dry-media", "texture", 0.42],
  ["HB 샤프 연필", "HB 샤프", "필압 변화가 적은 단단한 샤프심으로 밑그림 보조선을 고르게 긋는 연필", "sketch", 2, 0.92, "dry-media", "dashed", 0.14],
  ["부드러운 색연필", "색연필", "칠할 때마다 색상이 미묘하게 흔들리는 왁스심 색연필 특유의 혼색 결", "sketch", 7, 0.78, "dry-media", "texture", 0.36],
  ["목탄 연필", "목탄심", "심이 부서지며 가루가 번지는 목탄 특유의 깊고 어두운 소묘 획", "sketch", 12, 0.7, "dry-media", "texture", 0.5],
  ["기울임 음영 연필", "기울임 음영", "펜을 눕히면 심 측면이 닿듯 획이 넓어지는 틸트 반응 음영 연필", "sketch", 14, 0.6, "dry-media", "soft", 0.55],
  ["탄력 G펜", "G펜", "필압에 따라 극적으로 굵어지고 끝이 길게 빠지는 만화 잉킹 대표 펜촉", "ink", 7, 1, "ink-particle", "calligraphy", 0.44],
  ["마루펜 세필", "마루펜", "약한 필압 반응의 단단한 세필 펜촉으로 머리카락과 배경 선을 잇는 촉", "ink", 3, 1, "ink-particle", "solid", 0.2],
  ["스푼펜 라운드", "스푼펜", "가벼운 힘에도 부드럽게 굵어져 대사 선과 효과선에 두루 쓰는 펜촉", "ink", 5, 1, "ink-particle", "solid", 0.3],
  ["먹 붓펜", "붓펜", "빠르게 그으면 가늘어지고 눌러 끌면 먹이 배어나는 모필 붓펜", "ink", 12, 0.98, "ink-particle", "calligraphy", 0.55],
  ["틸트 캘리그래피 펜", "캘리그래피", "스타일러스 기울기 방위를 따라 납작한 촉이 회전하는 레터링 펜", "ink", 16, 0.96, "ink-particle", "calligraphy", 0.6],
  ["밀리펜 0.5", "밀리펜", "필압을 무시하고 처음부터 끝까지 균일한 굵기를 지키는 제도용 라이너", "ink", 4, 1, "ink-particle", "solid", 0.24],
  ["젖은 수채 번짐", "수채 번짐", "물을 많이 머금은 붓이 종이 위에서 몽글하게 퍼지는 습식 수채 획", "paint", 30, 0.56, "airbrush", "soft", 0.8],
  ["수채 얼룩 가장자리", "얼룩 수채", "마르며 가장자리에 안료가 고이는 워터마크 얼룩을 겹쳐 쌓는 수채 촉", "paint", 38, 0.44, "airbrush", "soft", 0.86],
  ["유화 임파스토", "임파스토", "촘촘한 강모 자국과 두꺼운 물감 융기가 남는 고점도 유화 나이프 붓", "paint", 26, 0.95, "ink-particle", "oil", 0.78],
  ["오일 드라이브러시", "드라이브러시", "빠른 획에서 물감이 갈라지고 끊기는 마른 유화 스컴블 붓", "paint", 22, 0.85, "dry-media", "texture", 0.72],
  ["종이결 파스텔", "파스텔", "캔버스에 고정된 종이 이빨 위로 분이 얹히는 소프트 파스텔", "chalk", 20, 0.72, "dry-media", "soft", 0.68],
  ["왁스 크레용", "크레용", "획을 따라 왁스 줄무늬가 끌리는 어린이 그림책 감성의 크레용", "chalk", 13, 0.9, "dry-media", "texture", 0.56],
  ["대구경 에어브러시", "대구경 에어", "그라데이션과 피부 명암을 한 번에 덮는 초대형 연질 분사 노즐", "paint", 64, 0.58, "airbrush", "soft", 1],
  ["스펀지 스티플", "스티플", "간격을 두고 도장처럼 찍히는 스펀지 두들김으로 질감을 쌓는 촉", "texture", 24, 0.8, "dry-media", "dots", 0.7],
  ["저유량 글레이즈 마커", "글레이즈", "옅은 현재색을 여러 번 겹쳐 경계와 농담을 부드럽게 연결하는 저유량 마커", "marker", 30, 0.4, "airbrush", "soft", 0.8],
  ["광폭 사각 마커", "광폭 마커", "고정 각도의 넓은 사각 촉으로 포스터 면을 단숨에 채우는 마커", "marker", 40, 0.55, "ink-particle", "calligraphy", 0.9],
  ["노이즈 스프레이", "노이즈", "미세 입자를 넓은 반경에 뿌려 노이즈 질감을 만드는 스프레이", "effect", 34, 0.5, "airbrush", "dots", 0.85],
  ["별가루 스캐터", "별가루", "회전과 크기가 제각각인 별 조각을 흩뿌리는 반짝임 장식 촉", "effect", 28, 0.85, "ink-particle", "glitter", 0.76],
  ["낙엽 흩날림", "낙엽", "색이 조금씩 다른 잎이 바람에 구르듯 흩어지는 가을 낙엽 촉", "foliage", 30, 0.82, "ink-particle", "glitter", 0.8],
  ["뭉게구름 스모크", "뭉게구름", "큰 노이즈 덩어리로 구름과 연기 볼륨을 뭉게뭉게 쌓는 초연질 촉", "effect", 56, 0.44, "airbrush", "soft", 0.95],
  ["로프 꼬임 스탬프", "로프", "획 방향을 따라 꼬임 마디가 일정 간격으로 이어지는 밧줄 스탬프", "stamp", 22, 0.94, "ink-particle", "dashed", 0.66],
  ["성긴 망점", "성긴 망점", "필압으로 점 크기가 자라는 성긴 망점으로 밝은 스크린톤 농담을 까는 촉", "tone", 26, 0.9, "ink-particle", "tone", 0.72],
  ["사선 빗줄기", "빗줄기", "고정된 사선 각도로 내리긋는 빗줄기를 속도에 따라 흩는 효과 촉", "effect", 26, 0.62, "ink-particle", "dashed", 0.74],
  ["스파클 글린트", "스파클", "십자 빛이 터지는 반짝임을 드문드문 찍는 하이라이트 장식 촉", "effect", 30, 0.9, "ink-particle", "glitter", 0.8],
  ["눈송이 플러리", "눈송이", "결정 조각이 흔들리며 떨어지는 함박눈을 흩뿌리는 겨울 효과 촉", "effect", 32, 0.75, "ink-particle", "dots", 0.82],
  ["잉크 스플래터", "스플래터", "누를수록 방울이 넓게 터지는 잉크 튀김 얼룩을 뿌리는 촉", "texture", 30, 0.85, "ink-particle", "dots", 0.8],
  ["보송 털뭉치", "털뭉치", "결이 벌어지는 짧은 털 다발로 동물 털과 모피 러프를 잡는 붓", "rake", 18, 0.8, "ink-particle", "dashed", 0.6],
  ["나무결 라이너", "나무결", "굽이치는 섬유선이 나이테처럼 흐르는 목재 표면 묘사 붓", "texture", 28, 0.78, "dry-media", "wavy", 0.76],
  // ── 2026-07 재료·장식·효과 확장 웨이브(40) ───────────────────────────
  ["물먹인 둥근 강모", "둥근 강모", "물감이 실린 둥근 강모 다발이 압력에 따라 풍성하게 벌어지는 채색 붓", "paint", 24, 0.92, "ink-particle", "oil", 0.72],
  ["마른 부채 강모", "부채 강모", "부채꼴로 벌어진 마른 털끝이 표면의 돌출부만 성기게 훑는 질감 붓", "rake", 34, 0.72, "dry-media", "dashed", 0.84],
  ["결무늬 납작 강모", "납작 강모", "서로 다른 굵기의 강모 줄이 납작한 획 안에서 자연스럽게 갈라지는 붓", "paint", 30, 0.88, "dry-media", "texture", 0.78],
  ["팔레트 나이프 날", "나이프 날", "기울어진 얇은 날과 물감이 뭉친 모서리로 능선과 하이라이트를 긁는 도구", "paint", 32, 0.96, "ink-particle", "oil", 0.82],
  ["마른 수채 과립", "마른 수채", "물기가 적은 안료 알갱이가 종이 골을 따라 끊겨 쌓이는 수채 붓", "paint", 25, 0.56, "dry-media", "texture", 0.72],
  ["소금꽃 수채", "소금꽃", "젖은 수채 위에서 소금 결정처럼 밝은 틈과 방사 무늬를 남기는 효과 붓", "paint", 38, 0.42, "airbrush", "glitter", 0.88],
  ["역번짐 고리", "역번짐", "마르는 물웅덩이 가장자리로 안료가 되밀려 불규칙한 고리를 만드는 수채 촉", "paint", 46, 0.38, "airbrush", "soft", 0.92],
  ["습식 넓은 워시", "습식 워시", "넓은 물층이 겹치며 가장자리 농도와 속도별 물감량이 달라지는 워시 붓", "paint", 58, 0.42, "airbrush", "soft", 0.96],
  ["입자 구아슈 평붓", "구아슈 평붓", "매트한 불투명 물감 사이로 미세한 입자 결이 드러나는 평면 채색 붓", "paint", 34, 0.9, "dry-media", "oil", 0.82],
  ["탄성 아크릴 평붓", "아크릴 평붓", "단단한 합성모가 진행 방향을 따라 정렬되며 선명한 모서리를 남기는 붓", "paint", 28, 0.94, "ink-particle", "calligraphy", 0.76],
  ["린넨 유화 필버트", "유화 필버트", "둥근 납작 강모와 캔버스 직조가 겹쳐 두터운 유화 결을 만드는 붓", "paint", 30, 0.94, "dry-media", "oil", 0.8],
  ["먹물 갈라짐 워시", "먹 워시", "속도와 압력에 따라 먹 중심과 갈라진 모필 가장자리가 함께 변하는 붓", "ink", 26, 0.78, "dry-media", "wavy", 0.7],
  ["새틴 접힘 리본", "새틴 리본", "진행 방향을 따라 명암 띠가 접히며 이어지는 윤기 있는 리본 장식 붓", "pattern", 28, 0.94, "ink-particle", "wavy", 0.8],
  ["두 겹 꼬임 끈", "겹 꼬임 끈", "두 가닥의 밝고 어두운 꼬임이 연속적으로 맞물리는 장식용 끈 붓", "pattern", 24, 0.92, "ink-particle", "dashed", 0.72],
  ["교대 사슬 고리", "사슬 고리", "가로와 세로 방향의 금속 고리가 번갈아 연결되는 체인 스탬프", "stamp", 26, 0.96, "ink-particle", "solid", 0.74],
  ["물결 레이스 테두리", "레이스", "반원 물결과 작은 구멍 장식이 일정하게 이어지는 섬세한 레이스 붓", "pattern", 30, 0.9, "ink-particle", "glitter", 0.78],
  ["러닝 스티치 실", "러닝 스티치", "짧은 실땀과 빈 간격이 획 방향을 따라 단정하게 반복되는 봉제 붓", "pattern", 12, 0.96, "ink-particle", "dashed", 0.48],
  ["십자 봉제선", "십자 봉제", "작은 교차 실밥이 균일한 간격으로 이어져 천의 봉제선을 만드는 붓", "pattern", 16, 0.94, "ink-particle", "tone", 0.56],
  ["니트 고리 직조", "니트 고리", "서로 걸린 실 고리와 미세한 섬유 결로 뜨개 표면을 빠르게 채우는 촉", "texture", 28, 0.76, "dry-media", "texture", 0.76],
  ["금속 긁힘 결", "금속 긁힘", "길이와 밝기가 다른 미세한 사선 흠집을 겹쳐 금속 표면을 표현하는 붓", "texture", 24, 0.64, "dry-media", "dashed", 0.68],
  ["겹연기 실루엣", "겹연기", "휘어지는 연기 가닥과 부드러운 입자층을 겹쳐 깊이 있는 연무를 만드는 붓", "effect", 52, 0.36, "airbrush", "soft", 0.96],
  ["불꽃 혀와 불티", "불꽃 불티", "가늘어지는 불꽃 혀와 작은 불티가 속도에 반응하며 함께 솟는 효과 붓", "effect", 34, 0.82, "ink-particle", "glitter", 0.84],
  ["빗줄기 안개 혼합", "비안개", "긴 빗줄기와 옅은 물안개 입자가 한 획에서 층을 이루는 날씨 효과 붓", "effect", 38, 0.5, "airbrush", "dashed", 0.86],
  ["가루눈 포말", "가루눈", "작은 결정과 흐릿한 눈가루가 바람 방향으로 층층이 흩날리는 효과 붓", "effect", 44, 0.52, "airbrush", "dots", 0.9],
  ["원근 먼지 입자", "원근 먼지", "크기와 농도가 다른 먼지 입자로 빛 속의 공간 깊이를 만드는 산란 붓", "effect", 40, 0.36, "airbrush", "dots", 0.88],
  ["무대 잉크 튐", "무대 잉크", "폭력적 소재 없이 연출용 페인트 방울과 꼬리를 안전하게 흩뿌리는 효과 붓", "effect", 32, 0.84, "ink-particle", "dots", 0.82],
  ["고리 빛망울", "고리 빛망울", "속이 비친 원형 빛 테두리를 크기와 밝기 차이로 겹쳐 장면의 심도를 만드는 붓", "effect", 42, 0.48, "airbrush", "glitter", 0.9],
  ["권운 흐름", "권운", "길고 가는 구름 가닥이 획의 흐름을 따라 휘어져 하늘의 방향감을 만드는 붓", "effect", 58, 0.38, "airbrush", "wavy", 0.96],
  ["넓은 수관 잎송이", "넓은 수관", "크기가 다른 넓은 잎송이를 색 변화와 함께 겹쳐 풍성한 수관을 만드는 붓", "foliage", 42, 0.76, "ink-particle", "glitter", 0.9],
  ["나무껍질 균열", "나무껍질", "수직 섬유와 불규칙한 갈라짐을 함께 쌓아 굵은 나무껍질을 표현하는 촉", "texture", 34, 0.8, "dry-media", "texture", 0.8],
  ["꽃잎 흩날림", "꽃잎", "다섯 갈래 꽃잎과 낱잎이 회전하며 흩어지는 계절 장식 붓", "foliage", 28, 0.86, "ink-particle", "glitter", 0.78],
  ["암석 파편 결", "암석 파편", "각진 조각과 작은 균열이 서로 다른 크기로 쌓이는 바위 질감 붓", "texture", 36, 0.82, "dry-media", "texture", 0.84],
  ["엇갈린 벽돌 줄눈", "벽돌 줄눈", "엇갈린 벽돌 면과 가는 모르타르 선을 일정한 간격으로 이어 그리는 패턴", "pattern", 36, 0.9, "ink-particle", "tone", 0.84],
  ["옹이 나무 갈퀴", "옹이 갈퀴", "평행한 목재 섬유가 옹이를 돌아 굽이치며 이어지는 방향성 갈퀴 붓", "rake", 34, 0.76, "dry-media", "wavy", 0.82],
  ["부드러운 속털", "속털", "짧고 흐릿한 속털과 선명한 겉털을 겹쳐 동물의 부피감을 만드는 붓", "rake", 22, 0.66, "airbrush", "soft", 0.68],
  ["곱슬 모발 리본", "곱슬 모발", "굵은 곱슬 가닥과 가는 잔머리를 하나의 흐르는 획으로 묶는 헤어 붓", "rake", 18, 0.88, "ink-particle", "wavy", 0.62],
  ["참깨 토핑 산란", "참깨 토핑", "방향과 색이 조금씩 다른 작은 타원 알갱이를 음식 위에 자연스럽게 뿌리는 붓", "stamp", 20, 0.92, "ink-particle", "dots", 0.6],
  ["점증 망점 그라데이션", "점증 망점", "필압과 속도에 따라 점 크기와 간격이 함께 변해 부드러운 망점 농담을 만드는 촉", "tone", 28, 0.88, "ink-particle", "tone", 0.74],
  ["윤곽 추종 해칭", "윤곽 해칭", "진행 방향과 펜 기울기를 따라 평행선 각도가 자연스럽게 바뀌는 명암 갈퀴", "tone", 26, 0.82, "dry-media", "dashed", 0.7],
  ["집중 방사선", "집중선", "빠른 획에서 중심을 향한 가는 방사선과 잔선을 길게 뽑는 만화 효과 붓", "effect", 30, 0.94, "ink-particle", "wavy", 0.8],
];

if (DESCRIPTOR_ROWS.length !== STUDIO_BRUSH_PACK_CATALOG_IDS.length) {
  throw new Error("Studio procedural brush descriptor table is out of sync with its stable ids");
}

export const STUDIO_BRUSH_PACK_DESCRIPTORS: readonly StudioBrushPackDescriptor[] =
  STUDIO_BRUSH_PACK_CATALOG_IDS.map((catalogId, index) => {
    const row = DESCRIPTOR_ROWS[index]!;
    return Object.freeze({
      catalogId,
      catalogName: row[0],
      shortName: row[1],
      hint: row[2],
      category: row[3],
      defaultWidth: row[4],
      defaultOpacity: row[5],
      runtimeBrushId: row[6],
      mediaGroup: studioBrushPackMaterialGroup(row[3], row[6]),
      previewStyle: row[7],
      previewWeight: row[8],
    });
  });

const DESCRIPTOR_BY_ID: ReadonlyMap<StudioBrushPackCatalogId, StudioBrushPackDescriptor> = new Map(
  STUDIO_BRUSH_PACK_DESCRIPTORS.map((descriptor) => [descriptor.catalogId, descriptor])
);

export function studioBrushPackDescriptorById(value: unknown): StudioBrushPackDescriptor | null {
  return isStudioBrushPackCatalogId(value) ? DESCRIPTOR_BY_ID.get(value) ?? null : null;
}
