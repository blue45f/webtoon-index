/**
 * webtoon-sfx-lexicon.ts
 *
 * Webtoon Comic SFX (Sound Effects) & Korean Onomatopoeia Lexicon.
 *
 * - 48 curated entries balanced across 8 comic-production domains.
 * - Recommended typography, color, stroke, and baseline sizing metadata.
 * - Korean-aware normalized search ranked by exact text, prefix, tags, meaning, and category.
 * - Related-effect recommendations based on shared tags, category, and lettering style.
 */

export type SfxCategory =
  | "impact"
  | "movement"
  | "emotion"
  | "atmosphere"
  | "destruction"
  | "daily"
  | "magic-scifi"
  | "whisper-silence";

export type SfxTypographyStyle =
  | "heavy-impact-sans"
  | "dynamic-action-brush"
  | "emotional-handwrite"
  | "tension-sharp-serif"
  | "scifi-glow-digital";

export interface SfxLexiconItem {
  readonly id: string;
  readonly text: string;
  readonly category: SfxCategory;
  readonly categoryLabel: string;
  readonly meaning: string;
  readonly recommendedStyle: SfxTypographyStyle;
  readonly recommendedColor: string;
  readonly strokeColor: string;
  readonly defaultSizePt: number;
  readonly tags: readonly string[];
}

export const SFX_CATEGORIES: readonly { readonly id: SfxCategory; readonly label: string }[] = [
  { id: "impact", label: "타격/충돌" },
  { id: "movement", label: "속도/이동" },
  { id: "emotion", label: "심리/감정" },
  { id: "atmosphere", label: "날씨/환경" },
  { id: "destruction", label: "파괴/폭발" },
  { id: "daily", label: "일상/사물" },
  { id: "magic-scifi", label: "특수/SF" },
  { id: "whisper-silence", label: "속삭임/정적" },
];

export const SFX_LEXICON_DATABASE: readonly SfxLexiconItem[] = [
  // 1. Impact — 타격/충돌
  {
    id: "sfx-kung",
    text: "쿵",
    category: "impact",
    categoryLabel: "타격/충돌",
    meaning: "묵직한 물체가 바닥이나 벽에 부딪힐 때의 깊은 충격음",
    recommendedStyle: "heavy-impact-sans",
    recommendedColor: "#facc15",
    strokeColor: "#000000",
    defaultSizePt: 64,
    tags: ["충격", "추락", "타격", "발자국", "무거운"],
  },
  {
    id: "sfx-kwang",
    text: "쾅",
    category: "impact",
    categoryLabel: "타격/충돌",
    meaning: "문이 세게 닫히거나 거대한 폭발 직전의 강렬한 충돌음",
    recommendedStyle: "heavy-impact-sans",
    recommendedColor: "#ef4444",
    strokeColor: "#ffffff",
    defaultSizePt: 72,
    tags: ["강타", "문", "충돌", "폭력", "위기"],
  },
  {
    id: "sfx-puk",
    text: "퍽",
    category: "impact",
    categoryLabel: "타격/충돌",
    meaning: "주먹이나 둔기로 급소를 정확히 가격했을 때의 타격음",
    recommendedStyle: "dynamic-action-brush",
    recommendedColor: "#ffffff",
    strokeColor: "#dc2626",
    defaultSizePt: 48,
    tags: ["주먹", "격투", "맞음", "피격", "클로즈업"],
  },
  {
    id: "sfx-zzeok",
    text: "쩌억",
    category: "impact",
    categoryLabel: "타격/충돌",
    meaning: "벽이나 얼음, 뼈가 강한 압력으로 갈라지는 파열음",
    recommendedStyle: "tension-sharp-serif",
    recommendedColor: "#38bdf8",
    strokeColor: "#000000",
    defaultSizePt: 56,
    tags: ["균열", "갈라짐", "파열", "얼음", "압도"],
  },
  {
    id: "sfx-ppaak",
    text: "빠악",
    category: "impact",
    categoryLabel: "타격/충돌",
    meaning: "단단한 부위에 날카롭게 꽂히는 강한 일격의 순간음",
    recommendedStyle: "dynamic-action-brush",
    recommendedColor: "#fb7185",
    strokeColor: "#450a0a",
    defaultSizePt: 58,
    tags: ["강타", "머리", "격투", "날카로운", "순간"],
  },
  {
    id: "sfx-tak",
    text: "탁",
    category: "impact",
    categoryLabel: "타격/충돌",
    meaning: "손목을 붙잡거나 가벼운 공격을 정확히 막아내는 짧은 접촉음",
    recommendedStyle: "heavy-impact-sans",
    recommendedColor: "#e2e8f0",
    strokeColor: "#1e293b",
    defaultSizePt: 36,
    tags: ["방어", "잡기", "접촉", "짧은", "손"],
  },

  // 2. Movement — 속도/이동
  {
    id: "sfx-shuuk",
    text: "슈욱",
    category: "movement",
    categoryLabel: "속도/이동",
    meaning: "공기를 가르며 고속으로 빠르게 회피하거나 돌진하는 소리",
    recommendedStyle: "dynamic-action-brush",
    recommendedColor: "#ffffff",
    strokeColor: "#0284c7",
    defaultSizePt: 48,
    tags: ["회피", "돌진", "바람", "순간이동", "민첩"],
  },
  {
    id: "sfx-seueuk",
    text: "스윽",
    category: "movement",
    categoryLabel: "속도/이동",
    meaning: "기척 없이 다가오거나 칼을 뽑는 섬뜩하고 매끄러운 움직임",
    recommendedStyle: "tension-sharp-serif",
    recommendedColor: "#94a3b8",
    strokeColor: "#0f172a",
    defaultSizePt: 40,
    tags: ["암살", "접근", "발도", "기척", "긴장"],
  },
  {
    id: "sfx-beonjjeok",
    text: "번쩍",
    category: "movement",
    categoryLabel: "속도/이동",
    meaning: "눈이나 섬광, 검날이 순간적으로 빛을 반사하는 찰나",
    recommendedStyle: "heavy-impact-sans",
    recommendedColor: "#fef08a",
    strokeColor: "#854d0e",
    defaultSizePt: 52,
    tags: ["섬광", "깨달음", "눈빛", "검기", "각성"],
  },
  {
    id: "sfx-hwik",
    text: "휙",
    category: "movement",
    categoryLabel: "속도/이동",
    meaning: "고개나 몸을 빠르게 돌리거나 물체가 시야를 가로지르는 짧은 이동음",
    recommendedStyle: "dynamic-action-brush",
    recommendedColor: "#dbeafe",
    strokeColor: "#1d4ed8",
    defaultSizePt: 42,
    tags: ["회전", "고개", "던지기", "속도", "짧은"],
  },
  {
    id: "sfx-tadadak",
    text: "타다닥",
    category: "movement",
    categoryLabel: "속도/이동",
    meaning: "여러 발걸음이 짧고 빠르게 이어지는 달리기나 도주 소리",
    recommendedStyle: "dynamic-action-brush",
    recommendedColor: "#f8fafc",
    strokeColor: "#334155",
    defaultSizePt: 38,
    tags: ["달리기", "발걸음", "도주", "연속", "급함"],
  },
  {
    id: "sfx-sabun",
    text: "사뿐",
    category: "movement",
    categoryLabel: "속도/이동",
    meaning: "발레처럼 가볍고 조용하게 내려앉거나 착지하는 움직임",
    recommendedStyle: "emotional-handwrite",
    recommendedColor: "#fce7f3",
    strokeColor: "#9d174d",
    defaultSizePt: 30,
    tags: ["착지", "가벼운", "우아함", "발끝", "조용함"],
  },

  // 3. Emotion — 심리/감정
  {
    id: "sfx-dugeun",
    text: "두근",
    category: "emotion",
    categoryLabel: "심리/감정",
    meaning: "심장이 빠르게 뛰거나 로맨스·긴장 상황의 심장 박동음",
    recommendedStyle: "emotional-handwrite",
    recommendedColor: "#f43f5e",
    strokeColor: "#ffe4e6",
    defaultSizePt: 36,
    tags: ["심장", "설렘", "불안", "로맨스", "긴장"],
  },
  {
    id: "sfx-heumchit",
    text: "흠칫",
    category: "emotion",
    categoryLabel: "심리/감정",
    meaning: "예상치 못한 발언이나 인기척에 몸이 굳으며 놀라는 반응",
    recommendedStyle: "emotional-handwrite",
    recommendedColor: "#ffffff",
    strokeColor: "#475569",
    defaultSizePt: 34,
    tags: ["놀람", "경악", "비밀", "들킴", "반응"],
  },
  {
    id: "sfx-ggulkkuk",
    text: "꿀꺽",
    category: "emotion",
    categoryLabel: "심리/감정",
    meaning: "극도의 공포나 탐욕으로 침을 삼키는 순간의 호흡",
    recommendedStyle: "emotional-handwrite",
    recommendedColor: "#e2e8f0",
    strokeColor: "#1e293b",
    defaultSizePt: 32,
    tags: ["침", "공포", "긴장", "욕망", "조용함"],
  },
  {
    id: "sfx-hwadeuljjak",
    text: "화들짝",
    category: "emotion",
    categoryLabel: "심리/감정",
    meaning: "전신이 크게 튈 정도로 갑작스럽고 과장되게 놀라는 반응",
    recommendedStyle: "dynamic-action-brush",
    recommendedColor: "#fde047",
    strokeColor: "#7c2d12",
    defaultSizePt: 46,
    tags: ["깜짝", "놀람", "코미디", "과장", "반응"],
  },
  {
    id: "sfx-budeulbudeul",
    text: "부들부들",
    category: "emotion",
    categoryLabel: "심리/감정",
    meaning: "분노·공포·추위로 몸이나 손끝이 연속해서 떨리는 상태",
    recommendedStyle: "emotional-handwrite",
    recommendedColor: "#c4b5fd",
    strokeColor: "#4c1d95",
    defaultSizePt: 34,
    tags: ["떨림", "분노", "공포", "추위", "연속"],
  },
  {
    id: "sfx-cheolleong",
    text: "철렁",
    category: "emotion",
    categoryLabel: "심리/감정",
    meaning: "나쁜 소식을 듣거나 위험을 직감해 심장이 아래로 떨어지는 듯한 감각",
    recommendedStyle: "tension-sharp-serif",
    recommendedColor: "#93c5fd",
    strokeColor: "#172554",
    defaultSizePt: 40,
    tags: ["심장", "불안", "절망", "위기", "직감"],
  },

  // 4. Atmosphere — 날씨/환경
  {
    id: "sfx-juruk",
    text: "주룩주룩",
    category: "atmosphere",
    categoryLabel: "날씨/환경",
    meaning: "비가 쉼 없이 내리며 감성적이거나 울적한 분위기를 만드는 소리",
    recommendedStyle: "emotional-handwrite",
    recommendedColor: "#60a5fa",
    strokeColor: "#ffffff",
    defaultSizePt: 38,
    tags: ["비", "장마", "눈물", "슬픔", "감성"],
  },
  {
    id: "sfx-kwareureung",
    text: "콰르릉",
    category: "atmosphere",
    categoryLabel: "날씨/환경",
    meaning: "하늘에서 천둥이 길게 울리며 재앙이나 위기를 암시하는 소리",
    recommendedStyle: "heavy-impact-sans",
    recommendedColor: "#eab308",
    strokeColor: "#18181b",
    defaultSizePt: 60,
    tags: ["천둥", "번개", "폭풍", "위기", "자연"],
  },
  {
    id: "sfx-huuung",
    text: "후우웅",
    category: "atmosphere",
    categoryLabel: "날씨/환경",
    meaning: "큰 공간이나 골목을 통과하는 바람이 낮고 길게 우는 소리",
    recommendedStyle: "tension-sharp-serif",
    recommendedColor: "#bae6fd",
    strokeColor: "#0c4a6e",
    defaultSizePt: 44,
    tags: ["바람", "공허", "골목", "저음", "길게"],
  },
  {
    id: "sfx-sswaaa",
    text: "쏴아아",
    category: "atmosphere",
    categoryLabel: "날씨/환경",
    meaning: "폭우·파도·수풀처럼 넓은 면적에서 소리가 한꺼번에 밀려오는 장면",
    recommendedStyle: "dynamic-action-brush",
    recommendedColor: "#7dd3fc",
    strokeColor: "#075985",
    defaultSizePt: 48,
    tags: ["폭우", "파도", "수풀", "물", "넓은"],
  },
  {
    id: "sfx-sagaksagak",
    text: "사각사각",
    category: "atmosphere",
    categoryLabel: "날씨/환경",
    meaning: "눈·낙엽·마른 풀을 밟거나 스치는 가볍고 반복적인 마찰음",
    recommendedStyle: "emotional-handwrite",
    recommendedColor: "#e7e5e4",
    strokeColor: "#57534e",
    defaultSizePt: 30,
    tags: ["눈", "낙엽", "마찰", "겨울", "반복"],
  },
  {
    id: "sfx-jjaekkak",
    text: "째깍째깍",
    category: "atmosphere",
    categoryLabel: "날씨/환경",
    meaning: "조용한 공간에서 시계 초침만 반복돼 긴장과 시간 압박을 만드는 소리",
    recommendedStyle: "tension-sharp-serif",
    recommendedColor: "#d6d3d1",
    strokeColor: "#292524",
    defaultSizePt: 30,
    tags: ["시계", "시간", "초침", "압박", "정적"],
  },

  // 5. Destruction — 파괴/폭발
  {
    id: "sfx-kwagwagwang",
    text: "콰과광",
    category: "destruction",
    categoryLabel: "파괴/폭발",
    meaning: "건물이나 지형이 무너지며 연쇄적으로 폭발하는 대형 파괴음",
    recommendedStyle: "heavy-impact-sans",
    recommendedColor: "#f97316",
    strokeColor: "#000000",
    defaultSizePt: 80,
    tags: ["폭발", "붕괴", "연쇄", "화염", "대파괴"],
  },
  {
    id: "sfx-wareureu",
    text: "와르르",
    category: "destruction",
    categoryLabel: "파괴/폭발",
    meaning: "돌무더기나 성벽이 힘없이 무너져 내리는 소리",
    recommendedStyle: "dynamic-action-brush",
    recommendedColor: "#cbd5e1",
    strokeColor: "#334155",
    defaultSizePt: 54,
    tags: ["낙석", "붕괴", "무너짐", "먼지", "잔해"],
  },
  {
    id: "sfx-kwajik",
    text: "콰직",
    category: "destruction",
    categoryLabel: "파괴/폭발",
    meaning: "단단한 갑옷·기계·뼈가 한 번에 찌그러지며 부서지는 파쇄음",
    recommendedStyle: "heavy-impact-sans",
    recommendedColor: "#fb7185",
    strokeColor: "#450a0a",
    defaultSizePt: 62,
    tags: ["파쇄", "갑옷", "기계", "뼈", "압축"],
  },
  {
    id: "sfx-ujikkeun",
    text: "우지끈",
    category: "destruction",
    categoryLabel: "파괴/폭발",
    meaning: "나무 기둥이나 가구가 버티지 못하고 길게 쪼개지는 소리",
    recommendedStyle: "dynamic-action-brush",
    recommendedColor: "#d97706",
    strokeColor: "#451a03",
    defaultSizePt: 56,
    tags: ["나무", "기둥", "쪼개짐", "가구", "붕괴"],
  },
  {
    id: "sfx-peoeong",
    text: "퍼엉",
    category: "destruction",
    categoryLabel: "파괴/폭발",
    meaning: "압축된 가스·마력·연기가 둔하게 터지며 퍼지는 중형 폭발음",
    recommendedStyle: "heavy-impact-sans",
    recommendedColor: "#fdba74",
    strokeColor: "#7c2d12",
    defaultSizePt: 58,
    tags: ["폭발", "연기", "가스", "마력", "둔탁"],
  },
  {
    id: "sfx-kugugugung",
    text: "쿠구구궁",
    category: "destruction",
    categoryLabel: "파괴/폭발",
    meaning: "지반이나 거대한 구조물이 연속해서 흔들리며 붕괴하기 직전의 저음",
    recommendedStyle: "heavy-impact-sans",
    recommendedColor: "#a8a29e",
    strokeColor: "#1c1917",
    defaultSizePt: 70,
    tags: ["지진", "지반", "거대", "저음", "붕괴"],
  },

  // 6. Daily — 일상/사물
  {
    id: "sfx-dalkak",
    text: "달칵",
    category: "daily",
    categoryLabel: "일상/사물",
    meaning: "방문 잠금장치나 서랍, 기계 부품이 맞물리는 짧은 소리",
    recommendedStyle: "tension-sharp-serif",
    recommendedColor: "#ffffff",
    strokeColor: "#0f172a",
    defaultSizePt: 32,
    tags: ["문", "열쇠", "잠금", "장치", "비밀"],
  },
  {
    id: "sfx-jjalang",
    text: "짤랑",
    category: "daily",
    categoryLabel: "일상/사물",
    meaning: "동전 주머니나 유리잔, 카페 문 앞 풍경이 가볍게 울리는 소리",
    recommendedStyle: "emotional-handwrite",
    recommendedColor: "#fbbf24",
    strokeColor: "#78350f",
    defaultSizePt: 30,
    tags: ["동전", "돈", "유리", "카페", "일상"],
  },
  {
    id: "sfx-ttokttok",
    text: "똑똑",
    category: "daily",
    categoryLabel: "일상/사물",
    meaning: "문이나 창을 손가락 관절로 예의 있게 두드리는 반복음",
    recommendedStyle: "emotional-handwrite",
    recommendedColor: "#f5f5f4",
    strokeColor: "#44403c",
    defaultSizePt: 30,
    tags: ["노크", "문", "방문", "반복", "손가락"],
  },
  {
    id: "sfx-chalcak",
    text: "찰칵",
    category: "daily",
    categoryLabel: "일상/사물",
    meaning: "카메라 셔터나 안전장치가 순간적으로 작동하는 선명한 기계음",
    recommendedStyle: "heavy-impact-sans",
    recommendedColor: "#f8fafc",
    strokeColor: "#1e293b",
    defaultSizePt: 34,
    tags: ["카메라", "셔터", "사진", "장치", "기계"],
  },
  {
    id: "sfx-ttogakttogak",
    text: "또각또각",
    category: "daily",
    categoryLabel: "일상/사물",
    meaning: "구두 굽이 단단한 바닥을 일정한 리듬으로 걷는 발소리",
    recommendedStyle: "tension-sharp-serif",
    recommendedColor: "#e7e5e4",
    strokeColor: "#292524",
    defaultSizePt: 32,
    tags: ["구두", "발걸음", "복도", "리듬", "등장"],
  },
  {
    id: "sfx-bogeulbogeul",
    text: "보글보글",
    category: "daily",
    categoryLabel: "일상/사물",
    meaning: "냄비나 주전자 속 액체가 작게 끓으며 기포가 이어지는 소리",
    recommendedStyle: "emotional-handwrite",
    recommendedColor: "#bfdbfe",
    strokeColor: "#1e3a8a",
    defaultSizePt: 30,
    tags: ["요리", "냄비", "끓음", "기포", "주방"],
  },

  // 7. Magic & Sci-Fi — 특수/SF
  {
    id: "sfx-pajijijik",
    text: "파지지직",
    category: "magic-scifi",
    categoryLabel: "특수/SF",
    meaning: "고전압 전격이나 마력 방전 스파크가 사방으로 튀는 음향",
    recommendedStyle: "scifi-glow-digital",
    recommendedColor: "#38bdf8",
    strokeColor: "#1e1b4b",
    defaultSizePt: 50,
    tags: ["전기", "스파크", "번개", "마법", "SF"],
  },
  {
    id: "sfx-woowoong",
    text: "우웅",
    category: "magic-scifi",
    categoryLabel: "특수/SF",
    meaning: "포탈 가동, 우주선 엔진 또는 강력한 아우라의 공명 진동음",
    recommendedStyle: "scifi-glow-digital",
    recommendedColor: "#a855f7",
    strokeColor: "#3b0764",
    defaultSizePt: 44,
    tags: ["포탈", "공명", "아우라", "엔진", "미스터리"],
  },
  {
    id: "sfx-chijijik",
    text: "치지직",
    category: "magic-scifi",
    categoryLabel: "특수/SF",
    meaning: "통신 장애·홀로그램 오류·약한 전류가 불규칙하게 끊기는 노이즈",
    recommendedStyle: "scifi-glow-digital",
    recommendedColor: "#22d3ee",
    strokeColor: "#164e63",
    defaultSizePt: 38,
    tags: ["노이즈", "통신", "홀로그램", "오류", "전류"],
  },
  {
    id: "sfx-hwaaak",
    text: "화아악",
    category: "magic-scifi",
    categoryLabel: "특수/SF",
    meaning: "불꽃·오라·빛이 한순간 넓게 피어오르며 공간을 덮는 효과",
    recommendedStyle: "dynamic-action-brush",
    recommendedColor: "#fb923c",
    strokeColor: "#7c2d12",
    defaultSizePt: 54,
    tags: ["불꽃", "오라", "각성", "빛", "확산"],
  },
  {
    id: "sfx-kiiing",
    text: "키이잉",
    category: "magic-scifi",
    categoryLabel: "특수/SF",
    meaning: "레이저·충전포·고주파 장치가 발사 직전까지 에너지를 모으는 고음",
    recommendedStyle: "scifi-glow-digital",
    recommendedColor: "#67e8f9",
    strokeColor: "#4c1d95",
    defaultSizePt: 46,
    tags: ["레이저", "충전", "고주파", "무기", "발사"],
  },
  {
    id: "sfx-peong",
    text: "펑",
    category: "magic-scifi",
    categoryLabel: "특수/SF",
    meaning: "순간이동·연막·작은 마법탄이 짧게 터지는 가벼운 폭발 효과",
    recommendedStyle: "scifi-glow-digital",
    recommendedColor: "#d8b4fe",
    strokeColor: "#581c87",
    defaultSizePt: 42,
    tags: ["순간이동", "연막", "마법탄", "짧은", "폭발"],
  },

  // 8. Whisper & Silence — 속삭임/정적
  {
    id: "sfx-sogeunsogeun",
    text: "소근소근",
    category: "whisper-silence",
    categoryLabel: "속삭임/정적",
    meaning: "남몰래 뒤에서 귓속말을 하거나 비밀을 속삭이는 소리",
    recommendedStyle: "emotional-handwrite",
    recommendedColor: "#e2e8f0",
    strokeColor: "#64748b",
    defaultSizePt: 26,
    tags: ["속삭임", "귓속말", "비밀", "소문", "배경"],
  },
  {
    id: "sfx-jeongjeok",
    text: "……",
    category: "whisper-silence",
    categoryLabel: "속삭임/정적",
    meaning: "말문이 막히거나 충격으로 주변의 모든 소리가 사라진 정적",
    recommendedStyle: "tension-sharp-serif",
    recommendedColor: "#94a3b8",
    strokeColor: "#0f172a",
    defaultSizePt: 40,
    tags: ["정적", "침묵", "충격", "망연자실", "말문막힘"],
  },
  {
    id: "sfx-swit",
    text: "쉿",
    category: "whisper-silence",
    categoryLabel: "속삭임/정적",
    meaning: "상대에게 즉시 소리를 낮추거나 숨으라고 요구하는 짧은 제지음",
    recommendedStyle: "tension-sharp-serif",
    recommendedColor: "#f1f5f9",
    strokeColor: "#334155",
    defaultSizePt: 30,
    tags: ["조용", "제지", "비밀", "숨기", "짧은"],
  },
  {
    id: "sfx-salgeumsalgeum",
    text: "살금살금",
    category: "whisper-silence",
    categoryLabel: "속삭임/정적",
    meaning: "들키지 않으려 발소리와 몸짓을 최대한 줄여 이동하는 상태",
    recommendedStyle: "emotional-handwrite",
    recommendedColor: "#cbd5e1",
    strokeColor: "#475569",
    defaultSizePt: 28,
    tags: ["잠입", "발소리", "몰래", "도둑", "조용함"],
  },
  {
    id: "sfx-sugunsugun",
    text: "수군수군",
    category: "whisper-silence",
    categoryLabel: "속삭임/정적",
    meaning: "여러 사람이 낮은 목소리로 소문이나 뒷이야기를 주고받는 배경음",
    recommendedStyle: "emotional-handwrite",
    recommendedColor: "#d8b4fe",
    strokeColor: "#581c87",
    defaultSizePt: 26,
    tags: ["소문", "군중", "뒷말", "속삭임", "배경"],
  },
  {
    id: "sfx-sarak",
    text: "사락",
    category: "whisper-silence",
    categoryLabel: "속삭임/정적",
    meaning: "옷자락·커튼·종이 한 장이 아주 가볍게 스치며 나는 미세한 마찰음",
    recommendedStyle: "emotional-handwrite",
    recommendedColor: "#e7e5e4",
    strokeColor: "#57534e",
    defaultSizePt: 26,
    tags: ["옷자락", "커튼", "종이", "미세", "마찰"],
  },
];

const SFX_BY_ID = new Map(SFX_LEXICON_DATABASE.map((item) => [item.id, item] as const));

function normalizeSearchText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("ko-KR").replace(/\s+/gu, "");
}

function searchScore(item: SfxLexiconItem, query: string): number {
  const text = normalizeSearchText(item.text);
  if (text === query) return 1_000;
  if (text.startsWith(query)) return 850;
  if (text.includes(query)) return 750;

  const tags = item.tags.map(normalizeSearchText);
  if (tags.some((tag) => tag === query)) return 650;
  if (tags.some((tag) => tag.startsWith(query))) return 550;
  if (tags.some((tag) => tag.includes(query))) return 450;

  const meaning = normalizeSearchText(item.meaning);
  if (meaning.includes(query)) return 300;

  const categoryLabel = normalizeSearchText(item.categoryLabel);
  if (categoryLabel.includes(query)) return 200;
  return 0;
}

export class WebtoonSfxLexiconEngine {
  /** Searches by text, tag, meaning, or category label and returns most relevant matches first. */
  public search(query: string, category?: SfxCategory): readonly SfxLexiconItem[] {
    const normalizedQuery = normalizeSearchText(query.trim());
    const categoryItems = category
      ? SFX_LEXICON_DATABASE.filter((item) => item.category === category)
      : SFX_LEXICON_DATABASE;

    if (!normalizedQuery) return categoryItems;

    return categoryItems
      .map((item, originalIndex) => ({
        item,
        originalIndex,
        score: searchScore(item, normalizedQuery),
      }))
      .filter((candidate) => candidate.score > 0)
      .sort((a, b) => b.score - a.score || a.originalIndex - b.originalIndex)
      .map((candidate) => candidate.item);
  }

  public getById(id: string): SfxLexiconItem | undefined {
    return SFX_BY_ID.get(id);
  }

  public listCategories(): readonly { readonly id: SfxCategory; readonly label: string }[] {
    return SFX_CATEGORIES;
  }

  /**
   * Finds alternatives for a selected effect. Shared semantic tags dominate, followed by category
   * and lettering style. The selected item itself is never returned.
   */
  public getRelated(id: string, limit = 4): readonly SfxLexiconItem[] {
    const source = this.getById(id);
    if (!source || !Number.isFinite(limit) || limit <= 0) return [];
    const sourceTags = new Set(source.tags.map(normalizeSearchText));

    return SFX_LEXICON_DATABASE.filter((item) => item.id !== id)
      .map((item, originalIndex) => {
        const sharedTagCount = item.tags.reduce(
          (count, tag) => count + (sourceTags.has(normalizeSearchText(tag)) ? 1 : 0),
          0,
        );
        const score =
          sharedTagCount * 100 +
          (item.category === source.category ? 35 : 0) +
          (item.recommendedStyle === source.recommendedStyle ? 15 : 0);
        return { item, originalIndex, score };
      })
      .filter((candidate) => candidate.score > 0)
      .sort((a, b) => b.score - a.score || a.originalIndex - b.originalIndex)
      .slice(0, Math.floor(limit))
      .map((candidate) => candidate.item);
  }
}