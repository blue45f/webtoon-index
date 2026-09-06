/**
 * AI Assist UX — tool catalog, prompt presets, recent prompts (PicsArt/Canva-class).
 * Pure data + localStorage helpers. No network / no React.
 */

export type StudioAiAssistToolId =
  | "background"
  | "character"
  | "composition"
  | "dialogue"
  | "palette";

export interface StudioAiAssistToolMeta {
  id: StudioAiAssistToolId;
  label: string;
  shortLabel: string;
  title: string;
  /** Needs BYOK image API (not server text alone). */
  needsImageApi: boolean;
  /** Needs text AI (server or BYOK). */
  needsTextApi: boolean;
}

export const STUDIO_AI_ASSIST_TOOLS: readonly StudioAiAssistToolMeta[] = Object.freeze([
  {
    id: "background",
    label: "배경 생성",
    shortLabel: "배경",
    title: "텍스트로 배경 이미지를 만들어 캔버스에 넣어요",
    needsImageApi: true,
    needsTextApi: false,
  },
  {
    id: "character",
    label: "캐릭터",
    shortLabel: "캐릭터",
    title: "참고 이미지를 바탕으로 캐릭터를 이어서 그려요",
    needsImageApi: true,
    needsTextApi: false,
  },
  {
    id: "composition",
    label: "구도 제안",
    shortLabel: "구도",
    title: "콘티 문장으로 카메라·배치 힌트를 받아요",
    needsImageApi: false,
    needsTextApi: true,
  },
  {
    id: "dialogue",
    label: "대사 제안",
    shortLabel: "대사",
    title: "상황 설명으로 말풍선 대사를 받아 넣어요",
    needsImageApi: false,
    needsTextApi: true,
  },
  {
    id: "palette",
    label: "팔레트",
    shortLabel: "팔레트",
    title: "분위기 문장으로 색 조합을 추천받아요",
    needsImageApi: false,
    needsTextApi: true,
  },
]);

export interface StudioAiPromptPreset {
  id: string;
  label: string;
  prompt: string;
}

export const STUDIO_AI_BG_PROMPT_PRESETS: readonly StudioAiPromptPreset[] = Object.freeze([
  {
    id: "classroom-day",
    label: "교실·낮",
    prompt: "한국 고등학교 교실, 낮, 창문으로 따뜻한 햇살, 칠판과 책상, 웹툰 배경, 깔끔한 선화 느낌",
  },
  {
    id: "street-night",
    label: "거리·밤",
    prompt: "도시 골목 밤거리, 네온 간판, 비 젖은 도로 반사, 영화적 조명, 웹툰 배경",
  },
  {
    id: "cafe",
    label: "카페",
    prompt: "아늑한 카페 내부, 창가 좌석, 따뜻한 조명, 커피잔, 부드러운 파스텔 톤 웹툰 배경",
  },
  {
    id: "rooftop",
    label: "옥상",
    prompt: "학교 옥상, 석양 하늘, 난간과 물탱크, 감성 웹툰 배경, 넓은 시야",
  },
  {
    id: "park",
    label: "공원",
    prompt: "봄 공원 벤치, 벚꽃, 부드러운 햇빛, 평화로운 분위기, 웹툰 배경",
  },
  {
    id: "hallway",
    label: "복도",
    prompt: "학교 복도, 사물함 줄, 형광등, 약간 쓸쓸한 분위기, 만화 배경",
  },
]);

export const STUDIO_AI_CHARACTER_PRESETS: readonly StudioAiPromptPreset[] = Object.freeze([
  {
    id: "character-rain-alley",
    label: "비 오는 골목",
    prompt: "같은 캐릭터가 비 오는 골목에서 우산을 쓰고 서 있는 모습, 전신, 젖은 반사, 웹툰 컷",
  },
  {
    id: "character-cafe-talk",
    label: "카페 대화",
    prompt: "같은 캐릭터가 카페 창가에서 커피잔을 들고 이야기하는 모습, 상반신, 따뜻한 조명, 웹툰 컷",
  },
  {
    id: "character-chase",
    label: "추격 신",
    prompt: "같은 캐릭터가 뛰면서 뒤를 돌아보는 역동적인 모습, 스피드 라인, 웹툰 컷",
  },
  {
    id: "character-closeup",
    label: "표정 클로즈업",
    prompt: "같은 캐릭터의 놀란 표정 클로즈업, 배경은 단순하게, 감정 전달이 잘 보이는 웹툰 컷",
  },
]);

export const STUDIO_AI_COLORIZE_PRESETS: readonly StudioAiPromptPreset[] = Object.freeze([
  {
    id: "pastel-cel",
    label: "파스텔 셀",
    prompt: "파스텔톤 웹툰 셀 채색, 부드러운 그림자, 깨끗한 하이라이트, 선화 유지",
  },
  {
    id: "vivid-anime",
    label: "선명 애니",
    prompt: "선명한 애니메이션 채색, 또렷한 그림자, 채도 높은 피부·의상, 선화 보존",
  },
  {
    id: "soft-watercolor",
    label: "수채",
    prompt: "수채화 느낌 채색, 은은한 번짐, 부드러운 가장자리, 선화는 약하게 유지",
  },
  {
    id: "mono-gray",
    label: "그레이",
    prompt: "흑백 웹툰 그레이 스케일 채색, 스크린톤 느낌의 명암, 선화 선명",
  },
]);

export const STUDIO_AI_COMPOSITION_PRESETS: readonly StudioAiPromptPreset[] = Object.freeze([
  {
    id: "entrance",
    label: "등장",
    prompt: "주인공이 교실 문을 벌컥 열고 들어와 반 아이들과 눈이 마주친다. \"나 전학 왔어.\"",
  },
  {
    id: "confession",
    label: "고백",
    prompt: "옥상에서 두 사람이 마주 본다. 석양. 주인공이 조심스레 고백을 시작한다.",
  },
  {
    id: "chase",
    label: "추격",
    prompt: "비 오는 골목. 주인공이 뒤를 쫓아 달린다. 빠른 속도감, 로우앵글.",
  },
  {
    id: "quiet",
    label: "정적",
    prompt: "빈 교실. 주인공 혼자 창가에 앉아 창밖을 본다. 고요하고 쓸쓸한 분위기.",
  },
]);

export const STUDIO_AI_DIALOGUE_PRESETS: readonly StudioAiPromptPreset[] = Object.freeze([
  { id: "awkward", label: "어색", prompt: "처음 만난 사이, 어색한 인사, 가벼운 유머" },
  { id: "fight", label: "말다툼", prompt: "친구와 오해로 다투는 장면, 감정선 뚜렷하게" },
  { id: "comfort", label: "위로", prompt: "슬퍼하는 상대를 다정하게 위로하는 대사" },
  { id: "gag", label: "개그", prompt: "가벼운 개그 컷, 짧은 리액션 대사 위주" },
]);

export const STUDIO_AI_PALETTE_PRESETS: readonly StudioAiPromptPreset[] = Object.freeze([
  { id: "spring", label: "봄", prompt: "봄 벚꽃, 부드러운 파스텔, 따뜻한 햇살" },
  { id: "noir", label: "느와르", prompt: "밤거리 느와르, 대비 강한 그림자, 네온 포인트" },
  { id: "school", label: "청춘", prompt: "청춘 학원물, 밝은 주간, 교복 톤에 맞는 색" },
  { id: "fantasy", label: "판타지", prompt: "판타지 마법, 신비로운 보라·청록 포인트" },
]);

export function presetsForAssistTool(tool: StudioAiAssistToolId): readonly StudioAiPromptPreset[] {
  switch (tool) {
    case "background":
      return STUDIO_AI_BG_PROMPT_PRESETS;
    case "character":
      return STUDIO_AI_CHARACTER_PRESETS;
    case "composition":
      return STUDIO_AI_COMPOSITION_PRESETS;
    case "dialogue":
      return STUDIO_AI_DIALOGUE_PRESETS;
    case "palette":
      return STUDIO_AI_PALETTE_PRESETS;
    default:
      return [];
  }
}

// ── Recent prompts ─────────────────────────────────────────────────────────

export const STUDIO_AI_RECENT_PROMPTS_KEY = "toonspectrum-studio-ai-recent-prompts:v1";
export const STUDIO_AI_RECENT_PROMPTS_MAX = 12;
export const STUDIO_AI_RECENT_PROMPTS_VERSION = 1 as const;

export interface StudioAiRecentPromptEntry {
  tool: StudioAiAssistToolId;
  prompt: string;
  at: number;
}

export interface StudioAiRecentPromptsState {
  version: typeof STUDIO_AI_RECENT_PROMPTS_VERSION;
  entries: StudioAiRecentPromptEntry[];
}

export type StudioAiRecentStorage = Pick<Storage, "getItem" | "setItem">;

const EMPTY_RECENT: StudioAiRecentPromptsState = {
  version: STUDIO_AI_RECENT_PROMPTS_VERSION,
  entries: [],
};

const TOOL_IDS = new Set<string>(STUDIO_AI_ASSIST_TOOLS.map((t) => t.id));

export function normalizeStudioAiRecentPrompts(raw: unknown): StudioAiRecentPromptsState {
  let decoded = raw;
  if (typeof raw === "string") {
    try {
      decoded = JSON.parse(raw) as unknown;
    } catch {
      return { ...EMPTY_RECENT, entries: [] };
    }
  }
  if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded)) {
    return { ...EMPTY_RECENT, entries: [] };
  }
  const candidate = decoded as { version?: unknown; entries?: unknown };
  if (candidate.version !== STUDIO_AI_RECENT_PROMPTS_VERSION || !Array.isArray(candidate.entries)) {
    return { ...EMPTY_RECENT, entries: [] };
  }
  const entries: StudioAiRecentPromptEntry[] = [];
  const seen = new Set<string>();
  for (const item of candidate.entries) {
    if (typeof item !== "object" || item === null) continue;
    const row = item as Record<string, unknown>;
    const tool = typeof row.tool === "string" && TOOL_IDS.has(row.tool) ? (row.tool as StudioAiAssistToolId) : null;
    const prompt = typeof row.prompt === "string" ? row.prompt.trim() : "";
    const at = typeof row.at === "number" && Number.isFinite(row.at) ? row.at : 0;
    if (!tool || !prompt || prompt.length > 800) continue;
    const key = `${tool}:${prompt}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({ tool, prompt, at });
    if (entries.length >= STUDIO_AI_RECENT_PROMPTS_MAX) break;
  }
  return { version: STUDIO_AI_RECENT_PROMPTS_VERSION, entries };
}

export function loadStudioAiRecentPrompts(
  storage: StudioAiRecentStorage | null | undefined
): StudioAiRecentPromptsState {
  if (!storage) return { ...EMPTY_RECENT, entries: [] };
  try {
    return normalizeStudioAiRecentPrompts(storage.getItem(STUDIO_AI_RECENT_PROMPTS_KEY));
  } catch {
    return { ...EMPTY_RECENT, entries: [] };
  }
}

export function rememberStudioAiRecentPrompt(
  state: StudioAiRecentPromptsState,
  tool: StudioAiAssistToolId,
  prompt: string,
  at = 0
): StudioAiRecentPromptsState {
  const trimmed = prompt.trim();
  if (!trimmed || trimmed.length > 800) return state;
  const nextEntry: StudioAiRecentPromptEntry = { tool, prompt: trimmed, at };
  const rest = state.entries.filter((e) => !(e.tool === tool && e.prompt === trimmed));
  return {
    version: STUDIO_AI_RECENT_PROMPTS_VERSION,
    entries: [nextEntry, ...rest].slice(0, STUDIO_AI_RECENT_PROMPTS_MAX),
  };
}

export function saveStudioAiRecentPrompts(
  storage: StudioAiRecentStorage | null | undefined,
  state: StudioAiRecentPromptsState
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(
      STUDIO_AI_RECENT_PROMPTS_KEY,
      JSON.stringify(normalizeStudioAiRecentPrompts(state))
    );
    return true;
  } catch {
    return false;
  }
}

export function pushStudioAiRecentPrompt(
  storage: StudioAiRecentStorage | null | undefined,
  tool: StudioAiAssistToolId,
  prompt: string,
  at = Date.now()
): StudioAiRecentPromptsState {
  const next = rememberStudioAiRecentPrompt(loadStudioAiRecentPrompts(storage), tool, prompt, at);
  saveStudioAiRecentPrompts(storage, next);
  return next;
}

export function recentPromptsForTool(
  state: StudioAiRecentPromptsState,
  tool: StudioAiAssistToolId,
  limit = 5
): string[] {
  return state.entries
    .filter((e) => e.tool === tool)
    .slice(0, limit)
    .map((e) => e.prompt);
}

export function findStudioAiAssistTool(id: unknown): StudioAiAssistToolMeta | null {
  if (typeof id !== "string") return null;
  return STUDIO_AI_ASSIST_TOOLS.find((t) => t.id === id) ?? null;
}
