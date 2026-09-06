/**
 * Pure UX helpers for Studio VRM poser — recent poses/characters, pose buckets, camera shortcuts.
 * No DOM/Three imports; safe for unit tests and localStorage round-trips.
 */

export const STUDIO_VRM_RECENT_POSES_KEY = "toonspectrum-studio-vrm-recent-poses:v1";
export const STUDIO_VRM_RECENT_CHARACTERS_KEY = "toonspectrum-studio-vrm-recent-characters:v1";
export const STUDIO_VRM_RECENT_MAX = 12;
export const STUDIO_VRM_RECENT_VERSION = 1 as const;

export interface StudioVrmRecentState {
  readonly version: typeof STUDIO_VRM_RECENT_VERSION;
  readonly ids: string[];
}

export type StudioVrmRecentStorage = Pick<Storage, "getItem" | "setItem">;

export type StudioVrmPoseBucketId =
  | "all"
  | "recent"
  | "standing"
  | "action"
  | "sit"
  | "emotion"
  | "hand";

export interface StudioVrmPoseBucket {
  readonly id: StudioVrmPoseBucketId;
  readonly label: string;
  readonly hint: string;
}

export interface StudioVrmPoseListItem {
  readonly id: string;
  readonly label: string;
  readonly tone?: string;
}

export interface StudioVrmCameraShortcut {
  readonly id: string;
  readonly label: string;
  readonly hint: string;
}

export interface StudioVrmLightingQuickPreset {
  readonly id: string;
  readonly label: string;
  readonly hint: string;
  /** Matches `LightingParams` in studio-vrm-poser-utils. */
  readonly intensity: number;
  readonly colorTemp: number;
  readonly directionDeg: number;
  /** Optional mood chip that maps to existing LightingTone buttons. */
  readonly tone?: "morning" | "sunset" | "night" | "studio";
}

const EMPTY_RECENT: StudioVrmRecentState = {
  version: STUDIO_VRM_RECENT_VERSION,
  ids: [],
};

export const STUDIO_VRM_POSE_BUCKETS: readonly StudioVrmPoseBucket[] = Object.freeze([
  { id: "all", label: "전체", hint: "모든 포즈" },
  { id: "recent", label: "최근", hint: "최근에 쓴 포즈" },
  { id: "standing", label: "서기", hint: "대기 · 서 있는 포즈" },
  { id: "action", label: "액션", hint: "달리기 · 점프 · 전투" },
  { id: "sit", label: "앉기", hint: "의자 · 무릎 · 바닥" },
  { id: "emotion", label: "감정", hint: "기쁨 · 놀람 · 슬픔" },
  { id: "hand", label: "손짓", hint: "인사 · 가리키기 · 제스처" },
]);

export const STUDIO_VRM_CAMERA_SHORTCUTS: readonly StudioVrmCameraShortcut[] = Object.freeze([
  { id: "front", label: "정면", hint: "얼굴·전신 정면" },
  { id: "threeQuarter", label: "사선", hint: "웹툰 기본 앵글" },
  { id: "bust", label: "상반신", hint: "대화 컷" },
  { id: "closeup", label: "얼굴", hint: "클로즈업" },
  { id: "low", label: "로우", hint: "아래에서 올려 봄" },
  { id: "high", label: "하이", hint: "위에서 내려 봄" },
  { id: "extremeLow", label: "웅장", hint: "극단 로우 앵글" },
]);

export const STUDIO_VRM_LIGHTING_QUICK_PRESETS: readonly StudioVrmLightingQuickPreset[] = Object.freeze([
  {
    id: "soft_day",
    label: "부드러운 낮",
    hint: "균일한 웹툰 기본 조명",
    intensity: 1.2,
    colorTemp: 0.48,
    directionDeg: 40,
    tone: "morning",
  },
  {
    id: "drama_rim",
    label: "드라마 림",
    hint: "강한 대비 · 연출 컷",
    intensity: 1.7,
    colorTemp: 0.42,
    directionDeg: 110,
    tone: "studio",
  },
  {
    id: "night_mood",
    label: "밤 무드",
    hint: "어두운 분위기 장면",
    intensity: 0.7,
    colorTemp: 0.28,
    directionDeg: -35,
    tone: "night",
  },
  {
    id: "warm_sunset",
    label: "따뜻한 노을",
    hint: "황금빛 측면광",
    intensity: 1.35,
    colorTemp: 0.82,
    directionDeg: 70,
    tone: "sunset",
  },
  {
    id: "flat_cel",
    label: "플랫 셀",
    hint: "그림자 약한 셀 채색",
    intensity: 0.95,
    colorTemp: 0.5,
    directionDeg: 20,
    tone: "studio",
  },
]);

const STANDING_KEYWORDS = ["idle", "relax", "stand", "hip", "대기", "서있", "허리", "기본", "default"];
const ACTION_KEYWORDS = [
  "sprint",
  "run",
  "jump",
  "fight",
  "punch",
  "kick",
  "dash",
  "질주",
  "점프",
  "공격",
  "전투",
  "액션",
  "cheer",
];
const SIT_KEYWORDS = ["sit", "chair", "kneel", "floor", "앉", "무릎", "의자"];
const EMOTION_KEYWORDS = [
  "happy",
  "sad",
  "angry",
  "surprise",
  "cry",
  "fear",
  "기쁨",
  "슬픔",
  "화",
  "놀람",
  "감정",
];
const HAND_KEYWORDS = ["wave", "point", "peace", "thumb", "hand", "손", "인사", "가리", "브이", "따봉", "제스처"];

function textBlob(item: StudioVrmPoseListItem): string {
  return `${item.id} ${item.label} ${item.tone ?? ""}`.toLowerCase();
}

function matchesAny(blob: string, keywords: readonly string[]): boolean {
  return keywords.some((keyword) => blob.includes(keyword.toLowerCase()));
}

export function classifyStudioVrmPoseBucket(item: StudioVrmPoseListItem): Exclude<StudioVrmPoseBucketId, "all" | "recent"> {
  const blob = textBlob(item);
  if (matchesAny(blob, ACTION_KEYWORDS)) return "action";
  if (matchesAny(blob, SIT_KEYWORDS)) return "sit";
  if (matchesAny(blob, EMOTION_KEYWORDS)) return "emotion";
  if (matchesAny(blob, HAND_KEYWORDS)) return "hand";
  if (matchesAny(blob, STANDING_KEYWORDS)) return "standing";
  return "standing";
}

export function filterStudioVrmPosesByBucket(
  items: readonly StudioVrmPoseListItem[],
  bucket: StudioVrmPoseBucketId,
  recentIds: readonly string[] = []
): StudioVrmPoseListItem[] {
  if (bucket === "all") return [...items];
  if (bucket === "recent") {
    const byId = new Map(items.map((item) => [item.id, item]));
    const ordered: StudioVrmPoseListItem[] = [];
    for (const id of recentIds) {
      const hit = byId.get(id);
      if (hit) ordered.push(hit);
    }
    return ordered;
  }
  return items.filter((item) => classifyStudioVrmPoseBucket(item) === bucket);
}

export function filterStudioVrmPosesByQuery(
  items: readonly StudioVrmPoseListItem[],
  query: string
): StudioVrmPoseListItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...items];
  return items.filter((item) => textBlob(item).includes(q));
}

export function normalizeStudioVrmRecentState(raw: unknown): StudioVrmRecentState {
  let decoded = raw;
  if (typeof raw === "string") {
    try {
      decoded = JSON.parse(raw) as unknown;
    } catch {
      return { ...EMPTY_RECENT, ids: [] };
    }
  }
  if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded)) {
    return { ...EMPTY_RECENT, ids: [] };
  }
  const candidate = decoded as { version?: unknown; ids?: unknown };
  if (candidate.version !== STUDIO_VRM_RECENT_VERSION || !Array.isArray(candidate.ids)) {
    return { ...EMPTY_RECENT, ids: [] };
  }
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const value of candidate.ids) {
    if (typeof value !== "string" || !value || value.length > 120) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    ids.push(value);
    if (ids.length >= STUDIO_VRM_RECENT_MAX) break;
  }
  return { version: STUDIO_VRM_RECENT_VERSION, ids };
}

export function loadStudioVrmRecent(
  storage: StudioVrmRecentStorage | null | undefined,
  key: string
): StudioVrmRecentState {
  if (!storage) return { ...EMPTY_RECENT, ids: [] };
  try {
    return normalizeStudioVrmRecentState(storage.getItem(key));
  } catch {
    return { ...EMPTY_RECENT, ids: [] };
  }
}

export function rememberStudioVrmRecent(
  state: StudioVrmRecentState,
  id: string
): StudioVrmRecentState {
  const nextId = typeof id === "string" ? id.trim() : "";
  if (!nextId || nextId.length > 120) return state;
  const ids = [nextId, ...state.ids.filter((value) => value !== nextId)].slice(0, STUDIO_VRM_RECENT_MAX);
  return { version: STUDIO_VRM_RECENT_VERSION, ids };
}

export function saveStudioVrmRecent(
  storage: StudioVrmRecentStorage | null | undefined,
  key: string,
  state: StudioVrmRecentState
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(key, JSON.stringify(normalizeStudioVrmRecentState(state)));
    return true;
  } catch {
    return false;
  }
}

export function loadStudioVrmRecentPoses(
  storage: StudioVrmRecentStorage | null | undefined
): StudioVrmRecentState {
  return loadStudioVrmRecent(storage, STUDIO_VRM_RECENT_POSES_KEY);
}

export function loadStudioVrmRecentCharacters(
  storage: StudioVrmRecentStorage | null | undefined
): StudioVrmRecentState {
  return loadStudioVrmRecent(storage, STUDIO_VRM_RECENT_CHARACTERS_KEY);
}

export function saveStudioVrmRecentPoses(
  storage: StudioVrmRecentStorage | null | undefined,
  state: StudioVrmRecentState
): boolean {
  return saveStudioVrmRecent(storage, STUDIO_VRM_RECENT_POSES_KEY, state);
}

export function saveStudioVrmRecentCharacters(
  storage: StudioVrmRecentStorage | null | undefined,
  state: StudioVrmRecentState
): boolean {
  return saveStudioVrmRecent(storage, STUDIO_VRM_RECENT_CHARACTERS_KEY, state);
}

export function findStudioVrmLightingQuickPreset(
  id: string
): StudioVrmLightingQuickPreset {
  return (
    STUDIO_VRM_LIGHTING_QUICK_PRESETS.find((preset) => preset.id === id) ??
    STUDIO_VRM_LIGHTING_QUICK_PRESETS[0]
  );
}

export function studioVrmPoseBucketCountLabel(
  bucket: StudioVrmPoseBucketId,
  count: number
): string {
  if (bucket === "recent" && count === 0) return "최근 없음";
  return `${count}개`;
}
