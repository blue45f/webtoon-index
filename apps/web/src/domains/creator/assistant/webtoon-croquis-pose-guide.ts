/**
 * webtoon-croquis-pose-guide.ts
 *
 * Webtoon Figure Croquis & Dynamic Perspective Pose Assistant.
 * Benchmarks timed gesture-drawing practice and specialized comic composition rules.
 *
 * - 3 Croquis interval training timer presets (30s Gesture, 60s Structure, 180s Detail Anatomy).
 * - 24 curated comic poses across action, emotion, daily life, and fantasy.
 * - Seeded, non-repeating practice sequences and a next-pose selector that avoids immediate repeats.
 * - 4 Perspective guide overlays (Eye Level, Dramatic Low Angle, High Angle Bird's Eye, Dutch Tilt).
 */

export type CroquisTimerIntervalSec = 30 | 60 | 180;

export type PerspectiveGuidePreset =
  | "eye-level" // 아이레벨 (일상/표준 대화)
  | "low-angle" // 로우앵글 (영웅적 위압감/박력)
  | "high-angle" // 하이앵글 (부감/위축/전체 전황)
  | "dutch-tilt"; // 더치 앵글 (위기/불안/박진감)

export type ComicPoseCategory = "action" | "emotion" | "daily" | "fantasy";

export interface ComicPosePromptItem {
  readonly id: string;
  readonly title: string;
  readonly category: ComicPoseCategory;
  readonly lineOfActionCurve: "C-curve" | "S-curve" | "Straight-thrust";
  readonly description: string;
  readonly keyAnatomyFocus: string;
  readonly recommendedIntervalSec: CroquisTimerIntervalSec;
}

export interface PerspectiveGuideConfig {
  readonly preset: PerspectiveGuidePreset;
  readonly label: string;
  readonly horizonRatioY: number; // 0..1 (where the horizon line sits)
  readonly tiltAngleDeg: number;
  readonly vanishingPointCount: 1 | 2 | 3;
  readonly tip: string;
}

export interface CroquisSequenceOptions {
  readonly category?: ComicPoseCategory;
  readonly seed?: number;
  readonly excludeIds?: readonly string[];
}

export const COMIC_POSE_CATEGORY_LABELS: Readonly<Record<ComicPoseCategory, string>> = {
  action: "액션",
  emotion: "감정 연기",
  daily: "일상 동작",
  fantasy: "판타지",
};

export const COMIC_POSE_LIBRARY: readonly ComicPosePromptItem[] = [
  // Action — silhouette, weight transfer, impact, and foreshortening.
  {
    id: "pose-hero-dash",
    title: "돌진 펀치 / 일도양단 베기",
    category: "action",
    lineOfActionCurve: "Straight-thrust",
    description: "앞으로 강하게 뻗는 일직선 타격선과 뒷다리의 강력한 지지선",
    keyAnatomyFocus: "견갑골의 전진, 골반 반회전, 지면을 미는 뒷발",
    recommendedIntervalSec: 60,
  },
  {
    id: "pose-dramatic-land",
    title: "슈퍼히어로 3점 착지",
    category: "action",
    lineOfActionCurve: "C-curve",
    description: "한 손과 한쪽 무릎이 바닥에 닿으며 충격을 흡수하는 극적인 웅크림",
    keyAnatomyFocus: "골반의 최대 굴곡, 팔의 하중 전달, 목의 반대편 신전",
    recommendedIntervalSec: 180,
  },
  {
    id: "pose-evasive-backbend",
    title: "검날을 피하는 상체 젖히기",
    category: "action",
    lineOfActionCurve: "C-curve",
    description: "발은 지면을 붙잡고 흉곽만 뒤로 크게 빠져 공격선을 간발의 차로 피하는 순간",
    keyAnatomyFocus: "복부 신장, 무릎 굴곡, 중심선이 지지면 밖으로 나가지 않는 균형",
    recommendedIntervalSec: 60,
  },
  {
    id: "pose-aerial-roundhouse",
    title: "공중 회전 발차기",
    category: "action",
    lineOfActionCurve: "S-curve",
    description: "골반 회전이 선행하고 뻗은 다리가 원호를 그리며 화면 앞쪽으로 튀어나오는 동작",
    keyAnatomyFocus: "고관절 외회전, 반대팔의 카운터 밸런스, 발의 원근 단축",
    recommendedIntervalSec: 180,
  },
  {
    id: "pose-shield-impact",
    title: "방패로 폭발 충격 버티기",
    category: "action",
    lineOfActionCurve: "Straight-thrust",
    description: "상체는 뒤로 밀리지만 두 다리는 넓게 벌려 충격을 지면으로 흘려보내는 자세",
    keyAnatomyFocus: "팔꿈치 잠김 방지, 척추 압축, 앞다리와 뒷다리의 하중 차이",
    recommendedIntervalSec: 60,
  },
  {
    id: "pose-grapple-throw",
    title: "상대의 중심을 넘기는 업어치기",
    category: "action",
    lineOfActionCurve: "C-curve",
    description: "낮아진 시전자 골반 위로 상대의 몸통이 큰 원을 그리며 넘어가는 2인 액션",
    keyAnatomyFocus: "두 인물의 무게중심 접점, 당기는 팔, 상대 척추의 연속 곡선",
    recommendedIntervalSec: 180,
  },

  // Emotion — readable body language before facial detail.
  {
    id: "pose-sorrow-sit",
    title: "무릎을 끌어안고 앉은 절망",
    category: "emotion",
    lineOfActionCurve: "C-curve",
    description: "몸을 둥글게 웅크려 외부의 충격을 방어하려는 폐쇄적 자세",
    keyAnatomyFocus: "등 곡선과 이마를 묻은 무릎의 접촉면, 안쪽으로 닫힌 팔꿈치",
    recommendedIntervalSec: 60,
  },
  {
    id: "pose-contained-rage",
    title: "주먹을 쥐고 분노를 참는 정면 자세",
    category: "emotion",
    lineOfActionCurve: "Straight-thrust",
    description: "몸통은 꼿꼿하지만 올라간 어깨와 잠긴 팔, 굳은 손이 폭발 직전의 긴장을 드러냄",
    keyAnatomyFocus: "승모근 수축, 팔뚝 회내, 손가락 관절의 압박",
    recommendedIntervalSec: 60,
  },
  {
    id: "pose-startled-recoil",
    title: "갑작스러운 고백에 뒤로 물러남",
    category: "emotion",
    lineOfActionCurve: "C-curve",
    description: "흉곽과 턱이 뒤로 빠지고 손바닥이 열리며 한쪽 발이 반걸음 물러나는 놀람",
    keyAnatomyFocus: "목과 흉곽 간 거리, 열린 손 실루엣, 앞꿈치에 남은 무게",
    recommendedIntervalSec: 30,
  },
  {
    id: "pose-tearful-reach",
    title: "떠나는 사람을 붙잡으려 손 뻗기",
    category: "emotion",
    lineOfActionCurve: "Straight-thrust",
    description: "몸은 뒤에 남아 있으나 손과 시선만 화면 밖 인물을 향해 급하게 뻗는 이별 장면",
    keyAnatomyFocus: "어깨 전인, 손의 원근 확대, 뒤로 끌리는 골반과 발",
    recommendedIntervalSec: 60,
  },
  {
    id: "pose-confident-lean",
    title: "책상에 기대 상대를 내려다보는 여유",
    category: "emotion",
    lineOfActionCurve: "S-curve",
    description: "한쪽 팔에만 가볍게 체중을 싣고 골반을 비틀어 우위와 자신감을 보이는 자세",
    keyAnatomyFocus: "비대칭 어깨선, 골반 콘트라포스토, 지지 팔의 압축",
    recommendedIntervalSec: 60,
  },
  {
    id: "pose-panic-freeze",
    title: "공포에 굳어 숨을 삼킨 순간",
    category: "emotion",
    lineOfActionCurve: "Straight-thrust",
    description: "뒤로 달아나려는 하체와 정면의 위협에서 눈을 떼지 못하는 상체가 서로 충돌함",
    keyAnatomyFocus: "잠긴 무릎, 올라간 흉곽, 몸통과 발끝이 향하는 방향 차이",
    recommendedIntervalSec: 30,
  },

  // Daily life — natural weight, props, and asymmetry.
  {
    id: "pose-casual-turn",
    title: "뒤돌아보며 눈 마주치기",
    category: "daily",
    lineOfActionCurve: "S-curve",
    description: "걸어가던 중 어깨 너머로 시선이 돌아오는 설레는 비틀림",
    keyAnatomyFocus: "경추 회전, 흉곽과 골반의 반대 방향, 반대쪽 어깨 하강",
    recommendedIntervalSec: 30,
  },
  {
    id: "pose-phone-slouch",
    title: "소파에 비스듬히 누워 휴대폰 보기",
    category: "daily",
    lineOfActionCurve: "C-curve",
    description: "등받이에 체중을 맡긴 채 무릎을 세우고 한 손으로 화면을 가까이 보는 느슨한 자세",
    keyAnatomyFocus: "골반 후방경사, 목의 전방 이동, 쿠션에 눌린 몸의 접촉면",
    recommendedIntervalSec: 60,
  },
  {
    id: "pose-cafe-tray",
    title: "카페 트레이 들고 좁은 길 지나기",
    category: "daily",
    lineOfActionCurve: "S-curve",
    description: "수평을 유지해야 하는 트레이와 장애물을 피하려 비튼 몸통이 대비되는 동작",
    keyAnatomyFocus: "손목 수평, 팔꿈치의 미세 굴곡, 골반의 측면 이동",
    recommendedIntervalSec: 60,
  },
  {
    id: "pose-tie-shoe",
    title: "한쪽 무릎을 세우고 신발끈 묶기",
    category: "daily",
    lineOfActionCurve: "C-curve",
    description: "상체가 신발 쪽으로 접히고 팔이 작은 작업 영역에 모이는 자연스러운 웅크림",
    keyAnatomyFocus: "대퇴와 흉곽의 압축, 발목 각도, 손과 끈의 접촉",
    recommendedIntervalSec: 60,
  },
  {
    id: "pose-grocery-balance",
    title: "장바구니 여러 개를 들고 문 열기",
    category: "daily",
    lineOfActionCurve: "S-curve",
    description: "한쪽 팔의 무거운 짐을 반대쪽 골반으로 상쇄하면서 팔꿈치로 문을 미는 순간",
    keyAnatomyFocus: "좌우 어깨 높이 차, 손가락 장력, 무게 반대편 골반 이동",
    recommendedIntervalSec: 180,
  },
  {
    id: "pose-wake-stretch",
    title: "잠에서 깨 양팔을 크게 뻗는 기지개",
    category: "daily",
    lineOfActionCurve: "C-curve",
    description: "흉곽이 위로 열리고 골반은 침대에 남아 몸 앞면이 길게 늘어나는 이완 동작",
    keyAnatomyFocus: "갈비뼈 확장, 견갑골 상방회전, 손끝부터 발끝까지 이어지는 신장",
    recommendedIntervalSec: 30,
  },

  // Fantasy — levitation, costume mass, supernatural force, and non-realistic balance.
  {
    id: "pose-spell-cast",
    title: "공중 부유 마법 영창",
    category: "fantasy",
    lineOfActionCurve: "S-curve",
    description: "하늘을 향해 활처럼 휘어지는 유려한 허리선과 양손의 마법 전개",
    keyAnatomyFocus: "흉곽 확장, 골반의 부유 방향, 발끝과 의상 자락의 후행",
    recommendedIntervalSec: 180,
  },
  {
    id: "pose-sword-summon",
    title: "빛의 검을 손바닥에서 소환",
    category: "fantasy",
    lineOfActionCurve: "Straight-thrust",
    description: "무기 생성점으로 손과 시선이 모이고 반대팔은 폭발 에너지를 견디며 뒤로 열림",
    keyAnatomyFocus: "손바닥 원근, 쇄골 방향, 광원에 반응하는 얼굴과 흉곽",
    recommendedIntervalSec: 60,
  },
  {
    id: "pose-winged-dive",
    title: "날개를 접고 수직 급강하",
    category: "fantasy",
    lineOfActionCurve: "Straight-thrust",
    description: "머리와 두 손이 낙하 방향을 가리키고 접힌 날개와 다리가 뒤에서 속도선을 만듦",
    keyAnatomyFocus: "등에 연결된 날개 뿌리, 어깨 굴곡, 강한 원근 단축",
    recommendedIntervalSec: 180,
  },
  {
    id: "pose-barrier-brace",
    title: "지팡이로 거대한 방어막 지탱",
    category: "fantasy",
    lineOfActionCurve: "C-curve",
    description: "보이지 않는 압력에 밀려 몸은 휘지만 양손과 지팡이는 방어막 중심을 놓치지 않음",
    keyAnatomyFocus: "두 손의 엇갈린 그립, 척추 압축, 뒤꿈치가 버티는 힘",
    recommendedIntervalSec: 180,
  },
  {
    id: "pose-transformation-recoil",
    title: "변신 에너지에 몸이 뒤틀리는 순간",
    category: "fantasy",
    lineOfActionCurve: "S-curve",
    description: "가슴에서 퍼지는 힘 때문에 팔과 머리카락, 의상이 서로 다른 방향으로 튕겨 나감",
    keyAnatomyFocus: "흉곽 중심의 방사선, 비대칭 사지, 천과 머리카락의 후행",
    recommendedIntervalSec: 60,
  },
  {
    id: "pose-levitating-throne",
    title: "공중 왕좌에 비스듬히 앉은 군주",
    category: "fantasy",
    lineOfActionCurve: "S-curve",
    description: "중력이 약한 공간에서 한쪽 다리를 늘어뜨리고 팔걸이에 기대 압도적 여유를 보임",
    keyAnatomyFocus: "골반 지지점, 늘어진 다리의 원근, 무거운 망토와 장식의 수직감",
    recommendedIntervalSec: 180,
  },
];

export const PERSPECTIVE_GUIDES: Record<PerspectiveGuidePreset, PerspectiveGuideConfig> = {
  "eye-level": {
    preset: "eye-level",
    label: "아이레벨 (1점 투시 · 자연스러운 대화)",
    horizonRatioY: 0.5,
    tiltAngleDeg: 0,
    vanishingPointCount: 1,
    tip: "독자가 인물과 같은 눈높이에서 마주 보며 심리적 친밀감을 느끼게 합니다.",
  },
  "low-angle": {
    preset: "low-angle",
    label: "로우앵글 (3점 투시 · 박력과 위압감)",
    horizonRatioY: 0.8,
    tiltAngleDeg: 0,
    vanishingPointCount: 3,
    tip: "지평선이 화면 아래로 내려가며 인물이 거대해 보이고 영웅적인 존재감을 부여합니다.",
  },
  "high-angle": {
    preset: "high-angle",
    label: "하이앵글 부감 (3점 투시 · 전체 조망과 위축)",
    horizonRatioY: 0.2,
    tiltAngleDeg: 0,
    vanishingPointCount: 3,
    tip: "지평선이 위로 올라가 바닥이 넓게 보이며, 캐릭터의 고독이나 전황의 규모를 보여줍니다.",
  },
  "dutch-tilt": {
    preset: "dutch-tilt",
    label: "더치 앵글 (경사 투시 · 위기와 혼란)",
    horizonRatioY: 0.5,
    tiltAngleDeg: -12,
    vanishingPointCount: 2,
    tip: "카메라를 10~15도 기울여 안정감을 깨고 액션의 격렬함이나 심리적 혼란을 극대화합니다.",
  },
};

function normalizedSeed(seed: number): number {
  if (!Number.isFinite(seed)) return 0;
  return Math.trunc(seed) >>> 0;
}

function seededRandom(seed: number): () => number {
  let state = normalizedSeed(seed);
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function shuffledPoses(
  poses: readonly ComicPosePromptItem[],
  seed: number,
): ComicPosePromptItem[] {
  const random = seededRandom(seed);
  const result = [...poses];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

export class WebtoonCroquisPoseGuide {
  public listPoses(category?: ComicPoseCategory): readonly ComicPosePromptItem[] {
    if (!category) return COMIC_POSE_LIBRARY;
    return COMIC_POSE_LIBRARY.filter((pose) => pose.category === category);
  }

  public getPoseById(id: string): ComicPosePromptItem | undefined {
    return COMIC_POSE_LIBRARY.find((pose) => pose.id === id);
  }

  public getPerspectiveGuide(preset: PerspectiveGuidePreset): PerspectiveGuideConfig {
    return PERSPECTIVE_GUIDES[preset];
  }

  /** Selects a deterministic pose and remains safe for NaN/Infinity seeds. */
  public getRandomPose(seed = Date.now(), category?: ComicPoseCategory): ComicPosePromptItem {
    const candidates = this.listPoses(category);
    const random = seededRandom(seed);
    const index = Math.floor(random() * candidates.length);
    return candidates[index] ?? COMIC_POSE_LIBRARY[0];
  }

  /** Selects another pose while excluding the current prompt whenever alternatives exist. */
  public getNextPose(
    currentPoseId: string,
    seed = Date.now(),
    category?: ComicPoseCategory,
  ): ComicPosePromptItem {
    const alternatives = this.listPoses(category).filter((pose) => pose.id !== currentPoseId);
    if (alternatives.length === 0) {
      return this.getPoseById(currentPoseId) ?? COMIC_POSE_LIBRARY[0];
    }
    const random = seededRandom(seed);
    return alternatives[Math.floor(random() * alternatives.length)] ?? alternatives[0];
  }

  /**
   * Builds a deterministic no-repeat drill. Count is clamped to the number of eligible poses so a
   * "10-pose action drill" never silently repeats when only six action prompts are available.
   */
  public getPracticeSequence(
    count: number,
    options: CroquisSequenceOptions = {},
  ): readonly ComicPosePromptItem[] {
    const excludedIds = new Set(options.excludeIds ?? []);
    const candidates = this.listPoses(options.category).filter((pose) => !excludedIds.has(pose.id));
    const normalizedCount = Number.isFinite(count)
      ? Math.min(candidates.length, Math.max(0, Math.floor(count)))
      : 0;
    return shuffledPoses(candidates, options.seed ?? Date.now()).slice(0, normalizedCount);
  }
}