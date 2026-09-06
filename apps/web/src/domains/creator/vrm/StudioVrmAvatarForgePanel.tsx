import {
  ArrowRight,
  ArrowRightLeft,
  CircleUserRound,
  Download,
  Palette,
  PersonStanding,
  RotateCcw,
  Scissors,
  Search,
  SlidersHorizontal,
  Sparkles,
  UserPlus,
  WandSparkles,
} from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";

import {
  AVATAR_FORGE_BANG_STYLE_OPTIONS,
  AVATAR_FORGE_FACE_ACCENT_OPTIONS,
  AVATAR_FORGE_FACE_LIMITS,
  AVATAR_FORGE_HAIR_LIMITS,
  AVATAR_FORGE_HAIR_STYLE_OPTIONS,
  AVATAR_FORGE_PRESETS,
  DEFAULT_AVATAR_FORGE_STATE,
  createAvatarForgeState,
  sanitizeAvatarForgeState,
  serializeAvatarForgeState,
  setAvatarForgeSemanticFaceMorph,
  type AvatarForgeFaceAccentId,
  type AvatarForgeFaceParams,
  type AvatarForgeHairParams,
  type AvatarForgeState,
} from "./studio-vrm-avatar-forge";
import { resolveStudioVrmAvatarForgeVisualProportionMetrics } from "./studio-vrm-avatar-forge-face-controller";
import {
  applyStudioVrmCharacterVariant,
  listStudioVrmCharacterVariantSummaries,
} from "./studio-vrm-character-variants";
import {
  generateStudioVrmCharacter,
  type StudioVrmGenerateResult,
} from "./studio-vrm-generate-mcp";
import { createStudioVrmGenerateRecipe } from "./studio-vrm-generate-recipe";
import {
  formatStudioVrmHeadUnits,
  resolveStudioVrmProportionMetrics,
  STUDIO_VRM_PROPORTION_KEYS,
  STUDIO_VRM_PROPORTION_LIMITS,
  STUDIO_VRM_PROPORTION_PRESETS,
  type StudioVrmProportionKey,
  type StudioVrmProportionMetrics,
} from "./studio-vrm-proportion-core";
import {
  countStudioVrmAvatarForgeChanges,
  describeStudioVrmAvatarForgeState,
  StudioVrmAvatarForgePreview,
} from "./StudioVrmAvatarForgePreview";
import { StudioVrmForgeRangeControl } from "./StudioVrmForgeRangeControl";

import type { StudioVrmSemanticFaceMorphProfile } from "./studio-vrm-semantic-face-morph";

/** 정밀 파라미터 슬라이더 순서 — 라벨/범위는 AVATAR_FORGE_HAIR_LIMITS가 단일 소스. */
const HAIR_DETAIL_KEYS = ["strandWidth", "fringe", "curl", "shine", "wave", "ahoge", "tailHeight"] as const;
const ORDERED_PROPORTION_PRESETS = Object.freeze(
  [...STUDIO_VRM_PROPORTION_PRESETS].sort(
    (left, right) => left.targetHeadUnits - right.targetHeadUnits,
  ),
);

type ForgeView = "presets" | "body" | "hair" | "face";
type ForgePresetFilter = "all" | "romance" | "modern" | "action" | "fantasy";

const FORGE_PRESET_FILTERS: ReadonlyArray<{
  readonly id: ForgePresetFilter;
  readonly label: string;
  readonly keywords: readonly string[];
}> = [
  { id: "all", label: "전체", keywords: [] },
  { id: "romance", label: "로맨스", keywords: ["romance", "soft", "long", "bob", "diva", "로맨스", "소프트"] },
  { id: "modern", label: "현대·학원", keywords: ["natural", "short", "pop", "modern", "senior", "내추럴", "숏", "팝"] },
  { id: "action", label: "액션", keywords: ["action", "pony", "fire", "wolf", "액션", "파이어"] },
  { id: "fantasy", label: "판타지", keywords: ["elegant", "silver", "mint", "gold", "fantasy", "엘리건트", "실버"] },
] as const;

const FACE_SHAPE_PRESETS: ReadonlyArray<{
  readonly id: string;
  readonly label: string;
  readonly hint: string;
  readonly face: AvatarForgeFaceParams;
}> = [
  {
    id: "balanced",
    label: "균형형",
    hint: "대부분의 장르에 맞는 자연스러운 기준형",
    face: { ...DEFAULT_AVATAR_FORGE_STATE.face },
  },
  {
    id: "soft-round",
    label: "부드러운 둥근형",
    hint: "넓은 볼과 짧은 턱의 친근한 인상",
    face: { headWidth: 1.1, headHeight: 0.96, headDepth: 1.02, cheekVolume: 0.72, chinLength: 0.94 },
  },
  {
    id: "oval",
    label: "계란형",
    hint: "세로로 길고 균형 잡힌 로맨스형",
    face: { headWidth: 0.98, headHeight: 1.08, headDepth: 1, cheekVolume: 0.42, chinLength: 1.05 },
  },
  {
    id: "sharp",
    label: "샤프형",
    hint: "좁은 볼과 긴 턱의 선명한 인상",
    face: { headWidth: 0.91, headHeight: 1.05, headDepth: 1.02, cheekVolume: 0.18, chinLength: 1.1 },
  },
  {
    id: "soft-volume",
    label: "볼륨형",
    hint: "볼륨을 살리고 깊이는 부드럽게 정리",
    face: { headWidth: 1.04, headHeight: 1.02, headDepth: 0.96, cheekVolume: 0.66, chinLength: 0.98 },
  },
  {
    id: "chibi",
    label: "SD 치비형",
    hint: "넓고 짧은 얼굴과 풍부한 볼륨",
    face: { headWidth: 1.14, headHeight: 0.93, headDepth: 1.06, cheekVolume: 0.8, chinLength: 0.9 },
  },
] as const;

const HAIR_COLOR_PRESETS = [
  { id: "ink", label: "잉크 블랙", baseColor: "#171515", shadowColor: "#070606", tipColor: "#5d5551" },
  { id: "espresso", label: "에스프레소", baseColor: "#2b1d18", shadowColor: "#110b09", tipColor: "#8d6756" },
  { id: "honey", label: "허니 블론드", baseColor: "#91611f", shadowColor: "#3c260b", tipColor: "#f4d67f" },
  { id: "silver", label: "실버", baseColor: "#777b86", shadowColor: "#30333a", tipColor: "#f0f1f5" },
  { id: "rose", label: "로즈", baseColor: "#713344", shadowColor: "#2b1119", tipColor: "#efa8bb" },
  { id: "violet", label: "바이올렛", baseColor: "#33254f", shadowColor: "#130d20", tipColor: "#aa91dc" },
  { id: "ocean", label: "오션", baseColor: "#173a58", shadowColor: "#071724", tipColor: "#70b9dc" },
  { id: "mint", label: "민트", baseColor: "#174b48", shadowColor: "#071e1d", tipColor: "#8be0d5" },
] as const;

function deriveHairShadowColor(hex: string): string {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) return "#111111";
  const value = Number.parseInt(match[1], 16);
  const channel = (shift: number) => Math.round(((value >> shift) & 0xff) * 0.38)
    .toString(16)
    .padStart(2, "0");
  return `#${channel(16)}${channel(8)}${channel(0)}`;
}

function presetMatchesFilter(
  preset: (typeof AVATAR_FORGE_PRESETS)[number],
  filter: ForgePresetFilter,
): boolean {
  if (filter === "all") return true;
  const group = FORGE_PRESET_FILTERS.find((candidate) => candidate.id === filter);
  if (!group) return true;
  const haystack = `${preset.id} ${preset.label} ${preset.hint}`.toLocaleLowerCase("ko-KR");
  return group.keywords.some((keyword) => haystack.includes(keyword.toLocaleLowerCase("ko-KR")));
}

function sameFace(left: AvatarForgeFaceParams, right: AvatarForgeFaceParams): boolean {
  return (Object.keys(left) as Array<keyof AvatarForgeFaceParams>)
    .every((key) => Math.abs(left[key] - right[key]) < 1e-6);
}

type StudioVrmAvatarForgePanelProps = {
  state: AvatarForgeState;
  /**
   * 지금 조형 중인 대상의 신원(로드된 모델 id). 바뀌면 패널이 기억하던 편집 의도를 버린다 —
   * 상태 서명만으로는 새 모델 설치를 알아볼 수 없다(둘 다 순정이면 서명이 같다).
   */
  sculptSessionId?: string;
  disabled?: boolean;
  detectedOriginalHairCount?: number;
  proportionMetrics?: StudioVrmProportionMetrics | null;
  proportionMetricsLabel?: string;
  proportionPresetNote?: string | null;
  proportionUnavailableReason?: string | null;
  semanticFaceMorphProfile?: StudioVrmSemanticFaceMorphProfile | null;
  onChange: (state: AvatarForgeState) => void;
  onGeneratedFile?: (file: File) => void;
};

const VIEWS: ReadonlyArray<{
  id: ForgeView;
  label: string;
  hint: string;
  icon: typeof WandSparkles;
}> = [
  { id: "presets", label: "스타일", hint: "완성형 조합으로 시작", icon: WandSparkles },
  { id: "body", label: "체형", hint: "몸의 실루엣과 비율 조절", icon: PersonStanding },
  { id: "hair", label: "헤어", hint: "형태·색·광택 조절", icon: Scissors },
  { id: "face", label: "얼굴", hint: "비율·디테일 조절", icon: CircleUserRound },
];

export function StudioVrmAvatarForgePanel({
  state,
  sculptSessionId,
  disabled = false,
  detectedOriginalHairCount = 0,
  proportionMetrics: runtimeProportionMetrics = null,
  proportionMetricsLabel = "모델 실측",
  proportionPresetNote = null,
  proportionUnavailableReason = null,
  semanticFaceMorphProfile = null,
  onChange,
  onGeneratedFile,
}: StudioVrmAvatarForgePanelProps) {
  const controlId = useId();
  const [view, setView] = useState<ForgeView>("presets");
  const [presetQuery, setPresetQuery] = useState("");
  const [presetFilter, setPresetFilter] = useState<ForgePresetFilter>("all");
  const [precisionMode, setPrecisionMode] = useState(false);
  const [generateResult, setGenerateResult] = useState<StudioVrmGenerateResult | null>(null);
  const [generateBusy, setGenerateBusy] = useState(false);
  // 헤어 실루엣을 **직접 골랐는지**를 기억한다. 기본값이 이미 "없음"이라 목록에서 "없음"을
  // 눌러도 상태가 그대로여서, 상태 비교만으로는 의도한 민머리를 알아볼 수 없다.
  const [hairStyleChosen, setHairStyleChosen] = useState(false);
  const baselineRef = useRef({
    sessionId: sculptSessionId,
    state: sanitizeAvatarForgeState(state),
  });
  if (baselineRef.current.sessionId !== sculptSessionId) {
    baselineRef.current = {
      sessionId: sculptSessionId,
      state: sanitizeAvatarForgeState(state),
    };
  }

  // 이 의도는 **지금 편집 중인 조형 상태**에만 붙는다. 새 VRM 을 설치하면 부모가 조형 상태를
  // 통째로 초기화하는데(useStudioVrmPoserInstall) 패널은 마운트된 채로 남으므로, 그대로 두면
  // 이전 캐릭터에서 고른 헤어 의도가 살아남아 새 캐릭터를 민머리로 생성한다. 패널이 방금
  // 내보낸 값이 아닌 상태가 들어오면 외부 교체로 보고 의도를 지운다.
  //
  // 부모가 `parseAvatarForgeState` 로 정규화해 되돌려 주므로 객체 동일성으로는 우리 편집을
  // 알아볼 수 없다. 같은 정규화를 거친 서명으로 비교한다.
  const forgeSignature = useMemo(() => JSON.stringify(serializeAvatarForgeState(state)), [state]);
  const emittedSignatureRef = useRef<string | null>(null);
  const seenSignatureRef = useRef(forgeSignature);
  const seenSessionRef = useRef(sculptSessionId);
  if (seenSessionRef.current !== sculptSessionId) {
    // 다른 모델로 갈아탔다. 서명 비교로는 못 잡는 경우가 있다 — 순정 상태에서 "헤어 없음"을
    // 고른 뒤 새 모델이 설치되면 양쪽 상태가 모두 순정이라 서명이 같다.
    seenSessionRef.current = sculptSessionId;
    seenSignatureRef.current = forgeSignature;
    emittedSignatureRef.current = null;
    if (hairStyleChosen) setHairStyleChosen(false);
  } else if (seenSignatureRef.current !== forgeSignature) {
    const mine = emittedSignatureRef.current === forgeSignature;
    seenSignatureRef.current = forgeSignature;
    emittedSignatureRef.current = null;
    if (!mine && hairStyleChosen) setHairStyleChosen(false);
  }

  /** 조형 상태를 부모로 올린다. 되돌아온 상태가 우리 것인지 알아보려고 서명을 남긴다. */
  const emit = (next: AvatarForgeState) => {
    emittedSignatureRef.current = JSON.stringify(serializeAvatarForgeState(next));
    onChange(next);
  };

  const previewRecipe = createStudioVrmGenerateRecipe({
    presetId: state.presetId,
    state,
    allowDefaultPreset: !hairStyleChosen,
  });

  const updateFace = <K extends keyof AvatarForgeFaceParams>(key: K, value: AvatarForgeFaceParams[K]) => {
    emit({ ...state, presetId: undefined, face: { ...state.face, [key]: value } });
  };

  const updateSemanticFaceMorph = (
    id: Parameters<typeof setAvatarForgeSemanticFaceMorph>[1],
    value: number,
  ) => {
    emit(setAvatarForgeSemanticFaceMorph(state, id, value));
  };

  const updateProportion = (key: StudioVrmProportionKey, value: number) => {
    emit(sanitizeAvatarForgeState({
      ...state,
      presetId: undefined,
      bodyPresetId: undefined,
      proportions: {
        ...state.proportions,
        presetId: undefined,
        [key]: value,
      },
    }));
  };

  const updateHair = <K extends keyof AvatarForgeHairParams>(key: K, value: AvatarForgeHairParams[K]) => {
    emit({ ...state, presetId: undefined, hair: { ...state.hair, [key]: value } });
  };

  const updateAccent = (
    id: AvatarForgeFaceAccentId,
    patch: Partial<NonNullable<AvatarForgeState["faceAccents"]>[number]>
  ) => {
    emit({
      ...state,
      presetId: undefined,
      faceAccents: (state.faceAccents ?? []).map((accent) =>
        accent.id === id ? { ...accent, ...patch } : accent
      ),
    });
  };
  const proportionMetrics = runtimeProportionMetrics
    ?? resolveStudioVrmProportionMetrics(state.proportions);
  const visualProportionMetrics = resolveStudioVrmAvatarForgeVisualProportionMetrics(
    proportionMetrics,
    state.face,
  );
  const visualHeadUnitsDiffer = Math.abs(
    visualProportionMetrics.headUnits - proportionMetrics.headUnits,
  ) >= 0.05;
  const proportionControlsDisabled = disabled || Boolean(proportionUnavailableReason);
  const selectedProportionPreset = STUDIO_VRM_PROPORTION_PRESETS.find(
    (preset) => preset.id === state.proportions.presetId,
  );
  const visualSummary = describeStudioVrmAvatarForgeState(state, baselineRef.current.state);
  const changedControlCount = countStudioVrmAvatarForgeChanges(
    state,
    baselineRef.current.state,
  );
  const normalizedPresetQuery = presetQuery.trim().toLocaleLowerCase("ko-KR");
  const filteredPresets = useMemo(
    () => AVATAR_FORGE_PRESETS.filter((preset) => {
      if (!presetMatchesFilter(preset, presetFilter)) return false;
      if (!normalizedPresetQuery) return true;
      return `${preset.label} ${preset.hint} ${preset.id}`
        .toLocaleLowerCase("ko-KR")
        .includes(normalizedPresetQuery);
    }),
    [normalizedPresetQuery, presetFilter],
  );

  return (
    <section className="overflow-hidden rounded-2xl border border-accent/30 bg-[linear-gradient(145deg,var(--color-card),color-mix(in_oklch,var(--color-accent)_7%,var(--color-panel)))] shadow-[0_12px_36px_oklch(0_0_0/0.12)]">
      <div className="border-b border-line/70 px-3.5 pb-3 pt-3.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <h3 className="flex items-center gap-1.5 text-sm font-extrabold text-fg">
                <Sparkles size={15} className="text-accent" aria-hidden />
                아바타 조형
              </h3>
              <span className="rounded-full border border-accent/30 bg-accent-soft px-1.5 py-0.5 text-[0.6rem] font-extrabold tracking-wide text-accent">
                LIVE 3D
              </span>
            </div>
            <p className="mt-1 max-w-[34rem] text-[0.68rem] leading-relaxed text-fg-3">
              스타일 프리셋과 슬라이더로 새 VRM을 만들거나, 불러온 모델의 체형·헤어·얼굴을 비파괴로 조형합니다.
            </p>
          </div>
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              // 조형 상태를 통째로 되돌리면 "머리 없음을 골랐다"는 의도도 같이 사라져야 한다.
              // 남겨 두면 초기화한 패널이 기본 프리셋 대신 대머리를 만든다.
              setHairStyleChosen(false);
              emit(createAvatarForgeState());
            }}
            className="grid size-11 shrink-0 place-items-center rounded-xl border border-line bg-card text-fg-3 transition-colors hover:bg-raised hover:text-fg disabled:opacity-40"
            aria-label="아바타 조형 초기화"
            title="기본 조형으로 초기화"
          >
            <RotateCcw size={16} aria-hidden />
          </button>
        </div>

        <div className="mt-3 grid grid-cols-[7.4rem_minmax(0,1fr)] gap-3 rounded-2xl border border-line/70 bg-card/75 p-3 shadow-sm">
          <div className="overflow-hidden rounded-xl border border-line/80 bg-panel/70">
            <StudioVrmAvatarForgePreview
              state={state}
              variant="hero"
              label="현재 아바타 조형 미리보기"
            />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="rounded-full border border-accent/30 bg-accent-soft px-2 py-0.5 text-[0.6rem] font-extrabold text-accent">
                실시간 조합
              </span>
              <span className="rounded-full border border-line bg-panel px-2 py-0.5 text-[0.6rem] font-bold text-fg-3">
                변경 {changedControlCount}개
              </span>
            </div>
            <p className="mt-2 text-[0.72rem] font-extrabold text-fg">
              {visualSummary.face} · {visualSummary.hair}
            </p>
            <p className="mt-0.5 text-[0.62rem] leading-relaxed text-fg-3">
              {visualSummary.bangs} · {visualSummary.body}. 카드로 큰 방향을 정한 뒤 숫자 입력으로 마무리하세요.
            </p>
            <div className="mt-2 grid grid-cols-2 gap-1.5">
              <button
                type="button"
                aria-pressed={precisionMode}
                className="inline-flex min-h-10 items-center justify-center gap-1 rounded-lg border border-line bg-panel px-2 text-[0.61rem] font-bold text-fg-2 hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                onClick={() => setPrecisionMode((active) => !active)}
              >
                <SlidersHorizontal size={12} aria-hidden />
                {precisionMode ? "빠른 편집" : "정밀 편집"}
              </button>
              <button
                type="button"
                disabled={disabled || changedControlCount === 0}
                className="inline-flex min-h-10 items-center justify-center gap-1 rounded-lg border border-line bg-panel px-2 text-[0.61rem] font-bold text-fg-2 hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-35"
                onClick={() => emit(sanitizeAvatarForgeState(baselineRef.current.state))}
              >
                <RotateCcw size={12} aria-hidden />
                시작 상태
              </button>
            </div>
          </div>
        </div>

        <div role="tablist" aria-label="아바타 조형 단계" className="mt-3 grid grid-cols-4 gap-1 rounded-xl border border-line/70 bg-panel/65 p-1">
          {VIEWS.map((item) => {
            const Icon = item.icon;
            const selected = item.id === view;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={selected}
                title={item.hint}
                onClick={() => setView(item.id)}
                className={`flex min-h-11 min-w-0 items-center justify-center gap-1 rounded-lg border px-1 text-[0.66rem] font-bold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${
                  selected
                    ? "border-accent/45 bg-accent-soft text-accent shadow-sm"
                    : "border-transparent text-fg-3 hover:bg-raised hover:text-fg"
                }`}
              >
                <Icon size={14} className="shrink-0 max-[360px]:hidden" aria-hidden />
                <span className="min-w-0 truncate">{item.label}</span>
                <span aria-hidden="true" className="sr-only">{item.hint}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="p-3.5">
        {view === "presets" ? (
          <div role="tabpanel" aria-label="아바타 스타일 프리셋" className="space-y-3.5">
            <div>
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="text-[0.7rem] font-extrabold text-fg">완성형 스타일</p>
                  <p className="mt-0.5 text-[0.6rem] text-fg-3">실제 얼굴·헤어·색 조합을 보고 시작점을 고릅니다.</p>
                </div>
                <span className="text-[0.6rem] tabular-nums text-fg-3">{filteredPresets.length}개</span>
              </div>
              <label className="relative mt-2 block">
                <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-3" aria-hidden />
                <input
                  type="search"
                  value={presetQuery}
                  aria-label="아바타 스타일 검색"
                  placeholder="분위기·장르·헤어 검색"
                  className="min-h-11 w-full rounded-xl border border-line bg-card pl-9 pr-3 text-xs text-fg placeholder:text-fg-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                  onChange={(event) => setPresetQuery(event.currentTarget.value)}
                />
              </label>
              <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:thin]" role="radiogroup" aria-label="스타일 장르 필터">
                {FORGE_PRESET_FILTERS.map((filter) => (
                  <button
                    key={filter.id}
                    type="button"
                    role="radio"
                    aria-checked={presetFilter === filter.id}
                    className={`min-h-9 shrink-0 rounded-full border px-3 text-[0.61rem] font-bold transition-colors ${
                      presetFilter === filter.id
                        ? "border-accent/60 bg-accent-soft text-accent"
                        : "border-line bg-card text-fg-3 hover:bg-raised hover:text-fg"
                    }`}
                    onClick={() => setPresetFilter(filter.id)}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>
            </div>

            {filteredPresets.length > 0 ? (
              <div className="grid grid-cols-2 gap-2">
                {filteredPresets.map((preset) => {
                  const selected = state.presetId === preset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      disabled={disabled}
                      aria-pressed={selected}
                      aria-label={`${preset.label} 스타일 적용: ${preset.hint}`}
                      onClick={() => {
                        setHairStyleChosen(false);
                        emit(createAvatarForgeState(preset.id));
                      }}
                      className={`group min-h-[10.5rem] overflow-hidden rounded-2xl border text-left transition-[border-color,background-color,transform] focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40 ${
                        selected
                          ? "border-accent bg-accent-soft text-accent shadow-sm"
                          : "border-line bg-card text-fg hover:-translate-y-0.5 hover:bg-raised"
                      }`}
                    >
                      <span className="block h-[6.4rem] overflow-hidden border-b border-line/60 bg-panel/60 px-1 pt-1">
                        <StudioVrmAvatarForgePreview
                          state={preset.state}
                          variant="card"
                          showBody
                          label={`${preset.label} 조합 미리보기`}
                        />
                      </span>
                      <span className="block p-2.5">
                        <span className="block truncate text-[0.7rem] font-extrabold">{preset.label}</span>
                        <span className="mt-0.5 line-clamp-2 block text-[0.59rem] leading-relaxed text-fg-3">{preset.hint}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-line bg-card/55 p-4 text-center text-[0.65rem] text-fg-3">
                검색 조건과 일치하는 스타일이 없습니다.
              </div>
            )}

            <details className="group rounded-xl border border-line bg-card/55 p-3">
              <summary className="flex min-h-9 cursor-pointer list-none items-center text-[0.68rem] font-bold text-fg-2 [&::-webkit-details-marker]:hidden">
                캐릭터 베리언트
                <span className="ml-auto text-[0.6rem] text-fg-3">얼굴 유지 · 실루엣 교체</span>
              </summary>
              <div className="mt-3 grid grid-cols-2 gap-2 border-t border-line/60 pt-3">
                {listStudioVrmCharacterVariantSummaries().map((variant) => {
                  const previewState = applyStudioVrmCharacterVariant(state, variant.id);
                  return (
                    <button
                      key={variant.id}
                      type="button"
                      disabled={disabled}
                      aria-label={`${variant.label} 베리언트: ${variant.description}`}
                      title={variant.tags.join(" · ")}
                      onClick={() => emit(previewState)}
                      className="overflow-hidden rounded-xl border border-line bg-card text-left text-fg transition-colors hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40"
                    >
                      <span className="block h-20 overflow-hidden border-b border-line/60 bg-panel/60 px-1">
                        <StudioVrmAvatarForgePreview state={previewState} variant="compact" label={`${variant.label} 미리보기`} />
                      </span>
                      <span className="block p-2.5">
                        <span className="block truncate text-[0.67rem] font-extrabold">{variant.label}</span>
                        <span className="mt-0.5 line-clamp-2 block text-[0.58rem] leading-relaxed text-fg-3">{variant.description}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </details>

            <div className="grid grid-cols-3 gap-1.5 rounded-xl border border-accent/25 bg-accent-soft/30 p-2">
              {([
                ["face", "얼굴형"],
                ["hair", "헤어"],
                ["body", "체형"],
              ] as const).map(([target, label]) => (
                <button
                  key={target}
                  type="button"
                  className="inline-flex min-h-11 items-center justify-center gap-1 rounded-lg border border-line bg-card px-2 text-[0.62rem] font-bold text-fg-2 hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                  onClick={() => setView(target)}
                >
                  {label}
                  <ArrowRight size={11} aria-hidden />
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {view === "body" ? (
          <div role="tabpanel" aria-label="체형 실루엣 편집" className="space-y-3.5">
            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-[0.68rem] font-bold text-fg-2">두신 비율 프리셋</p>
                <span className="text-[0.6rem] text-fg-3">3~9두신 · 얼굴·헤어 유지</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {ORDERED_PROPORTION_PRESETS.map((preset) => {
                  const selected = state.proportions.presetId === preset.id;
                  const previewState = sanitizeAvatarForgeState({
                    ...state,
                    presetId: undefined,
                    bodyPresetId: undefined,
                    proportions: preset.proportions,
                  });
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      disabled={proportionControlsDisabled}
                      aria-pressed={selected}
                      aria-label={`${preset.label} 체형: ${preset.hint}`}
                      onClick={() => emit(previewState)}
                      className={`min-h-[8.5rem] overflow-hidden rounded-xl border text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40 ${
                        selected
                          ? "border-accent bg-accent-soft text-accent"
                          : "border-line bg-card text-fg hover:bg-raised"
                      }`}
                    >
                      <span className="block h-[5.2rem] overflow-hidden border-b border-line/60 bg-panel/60 px-1">
                        <StudioVrmAvatarForgePreview state={previewState} variant="compact" label={`${preset.label} 체형 미리보기`} />
                      </span>
                      <span className="block p-2">
                        <span className="block truncate text-[0.67rem] font-extrabold">{preset.label}</span>
                        <span className="mt-0.5 line-clamp-2 block text-[0.58rem] leading-snug text-fg-3">{preset.hint}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="rounded-lg border border-line bg-card/70 p-3">
              <div className="mb-1 flex items-center justify-between gap-2">
                <p className="text-[0.68rem] font-bold text-fg-2">리그 안전 체형 비율</p>
                <span className="rounded-full border border-accent/25 bg-accent-soft px-1.5 py-0.5 text-[0.58rem] font-bold text-accent">
                  관절 이동 방식
                </span>
              </div>
              <p className="mb-3 text-[0.62rem] leading-relaxed text-fg-3">
                본을 찌그러뜨리지 않고 관절 사이 거리를 rest 자세 기준으로 다시 계산합니다. 포즈·IK·의상·소품은 같은 리그를 계속 따라가요.
              </p>
              <div className="space-y-3">
                {STUDIO_VRM_PROPORTION_KEYS.map((key) => {
                  const limit = STUDIO_VRM_PROPORTION_LIMITS[key];
                  return (
                    <StudioVrmForgeRangeControl
                      key={key}
                      label={limit.label}
                      hint={limit.hint}
                      value={state.proportions[key]}
                      minimum={limit.min}
                      maximum={limit.max}
                      step={limit.step}
                      defaultValue={DEFAULT_AVATAR_FORGE_STATE.proportions[key]}
                      unit={limit.unit ?? "%"}
                      disabled={proportionControlsDisabled}
                      onChange={(value) => updateProportion(key, value)}
                    />
                  );
                })}
              </div>
            </div>

            <p
              role="status"
              aria-live="polite"
              className="rounded-lg border border-line/70 bg-panel/55 px-3 py-2 text-[0.62rem] leading-relaxed text-fg-3"
            >
              <span className="font-bold text-fg-2">
                골격 {formatStudioVrmHeadUnits(proportionMetrics.headUnits)} · {runtimeProportionMetrics ? proportionMetricsLabel : "비율 기준 예상"} 신장 {proportionMetrics.totalHeight.toFixed(2)}m
              </span>
              {visualHeadUnitsDiffer
                ? ` · 현재 얼굴 조형 ${formatStudioVrmHeadUnits(visualProportionMetrics.headUnits)}`
                : ""}
              {selectedProportionPreset
                ? proportionPresetNote
                  ? ` · ${proportionPresetNote}`
                  : ` · ${selectedProportionPreset.label} 적용 중입니다. 슬라이더를 움직이면 직접 조절로 전환돼요.`
                : " · 직접 조절 중입니다. 실제 모델의 원래 키를 기준으로 같은 비율이 적용돼요."}
            </p>
            {proportionUnavailableReason ? (
              <p role="alert" className="rounded-lg border border-danger/35 bg-danger/10 px-3 py-2 text-[0.62rem] leading-relaxed text-danger">
                {disabled
                  ? `리그를 안전한 상태로 확인할 때까지 아바타 조형을 잠시 중단했습니다. ${proportionUnavailableReason}`
                  : `이 모델은 리그 안전 체형 편집을 사용할 수 없습니다. ${proportionUnavailableReason} 헤어·얼굴 편집은 계속 사용할 수 있어요.`}
              </p>
            ) : null}
          </div>
        ) : null}

        {view === "hair" ? (
          <div role="tabpanel" aria-label="프로시저럴 헤어 편집" className="space-y-3.5">
            <div>
              <p className="mb-2 text-[0.68rem] font-bold text-fg-2">헤어 실루엣</p>
              <div className="grid grid-cols-3 gap-1.5">
                {AVATAR_FORGE_HAIR_STYLE_OPTIONS.map((option) => {
                  const selected = state.hair.style === option.id;
                  const previewState = sanitizeAvatarForgeState({
                    ...state,
                    presetId: undefined,
                    hair: { ...state.hair, style: option.id },
                  });
                  return (
                    <button
                      key={option.id}
                      type="button"
                      disabled={disabled}
                      aria-label={option.label}
                      aria-pressed={selected}
                      title={option.hint}
                      onClick={() => {
                        setHairStyleChosen(true);
                        updateHair("style", option.id);
                      }}
                      className={`min-h-[7.5rem] overflow-hidden rounded-xl border text-[0.62rem] font-bold transition-colors disabled:opacity-40 ${
                        selected ? "border-accent bg-accent-soft text-accent" : "border-line bg-card text-fg-2 hover:bg-raised"
                      }`}
                    >
                      <span className="block h-[4.8rem] overflow-hidden border-b border-line/60 bg-panel/60 px-1">
                        <StudioVrmAvatarForgePreview state={previewState} variant="compact" showBody={false} label={`${option.label} 헤어 미리보기`} />
                      </span>
                      <span className="block truncate px-1.5 py-2 text-center">{option.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <p className="mb-2 text-[0.68rem] font-bold text-fg-2">앞머리 형태</p>
              <div className="grid grid-cols-3 gap-1.5">
                {AVATAR_FORGE_BANG_STYLE_OPTIONS.map((option) => {
                  const selected = state.hair.bangStyle === option.id;
                  const previewState = sanitizeAvatarForgeState({
                    ...state,
                    presetId: undefined,
                    hair: { ...state.hair, bangStyle: option.id },
                  });
                  return (
                    <button
                      key={option.id}
                      type="button"
                      disabled={disabled || state.hair.style === "none"}
                      aria-label={option.label}
                      aria-pressed={selected}
                      title={option.hint}
                      onClick={() => updateHair("bangStyle", option.id)}
                      className={`min-h-[6.8rem] overflow-hidden rounded-xl border text-[0.62rem] font-bold transition-colors disabled:opacity-40 ${
                        selected ? "border-accent bg-accent-soft text-accent" : "border-line bg-card text-fg-2 hover:bg-raised"
                      }`}
                    >
                      <span className="block h-[4.1rem] overflow-hidden border-b border-line/60 bg-panel/60 px-1">
                        <StudioVrmAvatarForgePreview state={previewState} variant="compact" showBody={false} label={`${option.label} 앞머리 미리보기`} />
                      </span>
                      <span className="block truncate px-1.5 py-1.5 text-center">{option.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-[0.68rem] font-bold text-fg-2">헤어 컬러 조합</p>
                <button
                  type="button"
                  disabled={disabled || state.hair.style === "none"}
                  className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-line bg-card px-2 text-[0.59rem] font-bold text-fg-3 hover:bg-raised hover:text-fg disabled:opacity-35"
                  onClick={() => emit({
                    ...state,
                    presetId: undefined,
                    hair: {
                      ...state.hair,
                      baseColor: state.hair.tipColor,
                      tipColor: state.hair.baseColor,
                    },
                  })}
                >
                  <ArrowRightLeft size={11} aria-hidden />
                  기본·하이라이트 교체
                </button>
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                {HAIR_COLOR_PRESETS.map((palette) => {
                  const selected = state.hair.baseColor === palette.baseColor
                    && (state.hair.shadowColor ?? deriveHairShadowColor(state.hair.baseColor)) === palette.shadowColor
                    && state.hair.tipColor === palette.tipColor;
                  return (
                    <button
                      key={palette.id}
                      type="button"
                      disabled={disabled || state.hair.style === "none"}
                      aria-label={`${palette.label} 헤어 컬러 적용`}
                      aria-pressed={selected}
                      title={palette.label}
                      className={`min-h-12 rounded-xl border p-1 transition-colors disabled:opacity-35 ${
                        selected ? "border-accent bg-accent-soft" : "border-line bg-card hover:bg-raised"
                      }`}
                      onClick={() => emit({
                        ...state,
                        presetId: undefined,
                        hair: {
                          ...state.hair,
                          baseColor: palette.baseColor,
                          shadowColor: palette.shadowColor,
                          tipColor: palette.tipColor,
                        },
                      })}
                    >
                      <span
                        aria-hidden
                        className="block h-7 rounded-lg border border-white/15"
                        style={{ background: `linear-gradient(135deg, ${palette.baseColor}, ${palette.tipColor})` }}
                      />
                      <span className="sr-only">{palette.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {([
                ["baseColor", "기본색"],
                ["shadowColor", "그림자색"],
                ["tipColor", "하이라이트"],
              ] as const).map(([key, label]) => {
                const value = key === "shadowColor"
                  ? state.hair.shadowColor ?? deriveHairShadowColor(state.hair.baseColor)
                  : state.hair[key];
                return (
                  <label key={key} className="flex min-h-12 min-w-0 flex-col justify-center gap-1 rounded-xl border border-line bg-card px-2 text-[0.58rem] font-bold text-fg-2">
                    <span className="flex items-center gap-1 truncate">
                      <Palette size={11} className="shrink-0 text-fg-3" aria-hidden />
                      {label}
                    </span>
                    <input
                      type="color"
                      value={value}
                      disabled={disabled || state.hair.style === "none"}
                      onChange={(event) => updateHair(key, event.target.value)}
                      className="h-8 w-full cursor-pointer rounded-lg border border-line bg-transparent p-0 disabled:opacity-35 pointer-coarse:h-11"
                      aria-label={`헤어 ${label}`}
                    />
                  </label>
                );
              })}
            </div>

            <div className="space-y-3 rounded-xl border border-line bg-card/70 p-3">
              {(["volume", "length"] as const).map((key) => {
                const limit = AVATAR_FORGE_HAIR_LIMITS[key];
                return (
                  <StudioVrmForgeRangeControl
                    key={key}
                    label={limit.label}
                    value={state.hair[key]}
                    minimum={limit.min}
                    maximum={limit.max}
                    step={limit.step}
                    defaultValue={DEFAULT_AVATAR_FORGE_STATE.hair[key]}
                    unit={limit.unit ?? "%"}
                    disabled={disabled || state.hair.style === "none"}
                    onChange={(value) => updateHair(key, value)}
                  />
                );
              })}
            </div>

            {precisionMode ? (
              <div className="space-y-3 rounded-xl border border-accent/25 bg-accent-soft/20 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-[0.68rem] font-bold text-fg-2">정밀 헤어 파라미터</p>
                    <p className="mt-0.5 text-[0.58rem] text-fg-3">가닥 두께·웨이브·광택·묶음 위치를 숫자로 마감합니다.</p>
                  </div>
                  <span className="rounded-full border border-accent/30 bg-card px-2 py-0.5 text-[0.58rem] font-bold text-accent">
                    {HAIR_DETAIL_KEYS.length}개
                  </span>
                </div>
                {HAIR_DETAIL_KEYS.map((key) => {
                  const limit = AVATAR_FORGE_HAIR_LIMITS[key];
                  return (
                    <StudioVrmForgeRangeControl
                      key={key}
                      label={limit.label}
                      value={state.hair[key]}
                      minimum={limit.min}
                      maximum={limit.max}
                      step={limit.step}
                      defaultValue={DEFAULT_AVATAR_FORGE_STATE.hair[key]}
                      unit={limit.unit ?? "%"}
                      disabled={disabled || state.hair.style === "none"}
                      onChange={(value) => updateHair(key, value)}
                    />
                  );
                })}
              </div>
            ) : (
              <button
                type="button"
                className="flex min-h-12 w-full items-center justify-between rounded-xl border border-dashed border-line bg-card/55 px-3 text-left text-[0.66rem] font-bold text-fg-2 hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                onClick={() => setPrecisionMode(true)}
              >
                <span>
                  정밀 헤어 조절
                  <span className="mt-0.5 block text-[0.58rem] font-normal text-fg-3">가닥·웨이브·광택 등 {HAIR_DETAIL_KEYS.length}개</span>
                </span>
                <SlidersHorizontal size={15} className="text-accent" aria-hidden />
              </button>
            )}

            <div className="flex min-h-12 items-center gap-2.5 rounded-xl border border-line bg-panel/55 px-3">
              <input
                id={`${controlId}-replace-original`}
                type="checkbox"
                checked={state.hair.replaceOriginal}
                disabled={disabled || detectedOriginalHairCount === 0}
                onChange={(event) => updateHair("replaceOriginal", event.target.checked)}
                className="size-4 accent-accent pointer-coarse:size-5"
              />
              <label htmlFor={`${controlId}-replace-original`} className="min-w-0 flex-1 cursor-pointer">
                <span className="block text-[0.68rem] font-bold text-fg-2">분리 가능한 원본 헤어 숨기기</span>
                <span className="block text-[0.6rem] text-fg-3">
                  {detectedOriginalHairCount > 0
                    ? `${detectedOriginalHairCount}개 메시를 안전하게 탐지했어요.`
                    : "이 모델은 머리와 헤어가 한 메시라 원본을 유지합니다."}
                </span>
              </label>
            </div>
          </div>
        ) : null}

        {view === "face" ? (
          <div role="tabpanel" aria-label="얼굴 비율과 디테일 편집" className="space-y-3.5">
            <div>
              <div className="mb-2 flex items-end justify-between gap-2">
                <div>
                  <p className="text-[0.68rem] font-bold text-fg-2">얼굴형 프리셋</p>
                  <p className="mt-0.5 text-[0.58rem] text-fg-3">원본 눈·코·입 리그를 유지하면서 두상과 턱 실루엣만 안전하게 조절합니다.</p>
                </div>
                <span className="text-[0.58rem] text-fg-3">{FACE_SHAPE_PRESETS.length}종</span>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {FACE_SHAPE_PRESETS.map((preset) => {
                  const selected = sameFace(state.face, preset.face);
                  const previewState = sanitizeAvatarForgeState({
                    ...state,
                    presetId: undefined,
                    face: preset.face,
                  });
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      disabled={disabled}
                      aria-label={`${preset.label} 얼굴형 적용: ${preset.hint}`}
                      aria-pressed={selected}
                      title={preset.hint}
                      className={`min-h-[7.4rem] overflow-hidden rounded-xl border text-[0.61rem] font-bold transition-colors disabled:opacity-40 ${
                        selected ? "border-accent bg-accent-soft text-accent" : "border-line bg-card text-fg-2 hover:bg-raised"
                      }`}
                      onClick={() => emit({
                        ...state,
                        presetId: undefined,
                        face: { ...preset.face },
                      })}
                    >
                      <span className="block h-[4.7rem] overflow-hidden border-b border-line/60 bg-panel/60 px-1">
                        <StudioVrmAvatarForgePreview state={previewState} variant="compact" showBody={false} label={`${preset.label} 얼굴형 미리보기`} />
                      </span>
                      <span className="block truncate px-1 py-1.5 text-center">{preset.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="rounded-xl border border-line bg-card/70 p-3">
              <p className="mb-1 text-[0.68rem] font-bold text-fg-2">리그 보존 얼굴 비율</p>
              <p className="mb-3 text-[0.62rem] leading-relaxed text-fg-3">
                머리 본의 안전 범위 안에서 실루엣을 조절합니다. 표정·립싱크·시선 리그는 그대로 유지돼요.
              </p>
              <div className="space-y-3">
                {(Object.keys(AVATAR_FORGE_FACE_LIMITS) as Array<keyof AvatarForgeFaceParams>).map((key) => {
                  const limit = AVATAR_FORGE_FACE_LIMITS[key];
                  return (
                    <StudioVrmForgeRangeControl
                      key={key}
                      label={limit.label}
                      value={state.face[key]}
                      minimum={limit.min}
                      maximum={limit.max}
                      step={limit.step}
                      defaultValue={DEFAULT_AVATAR_FORGE_STATE.face[key]}
                      unit={limit.unit ?? "%"}
                      disabled={disabled}
                      onChange={(value) => updateFace(key, value)}
                    />
                  );
                })}
              </div>
            </div>

            <div
              className="rounded-xl border border-accent/25 bg-accent-soft/20 p-3"
              data-studio-vrm-semantic-face-morphs={semanticFaceMorphProfile?.status ?? "unavailable"}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-[0.68rem] font-bold text-fg-2">적응형 얼굴 디테일</p>
                  <p className="mt-0.5 text-[0.58rem] leading-relaxed text-fg-3">
                    모델 고유 shape key를 먼저 사용하고, 없는 항목은 머리·눈 랜드마크와 얼굴 메시를 기반으로 부드럽게 조형합니다. 표정·립싱크 채널은 제외합니다.
                  </p>
                </div>
                <span className="shrink-0 rounded-full border border-accent/30 bg-card px-2 py-0.5 text-[0.57rem] font-bold text-accent">
                  {semanticFaceMorphProfile?.controls.length ?? 0}종
                </span>
              </div>
              {semanticFaceMorphProfile?.status === "ready" ? (
                <div className="mt-3 space-y-3">
                  {semanticFaceMorphProfile.controls.map((control) => (
                    <StudioVrmForgeRangeControl
                      key={control.id}
                      label={control.label}
                      hint={`${control.provider === "native-morph" ? "모델 morph" : `적응형 mesh ${control.adaptiveMeshCount}개`} · ${control.hint}`}
                      value={state.semanticFaceMorphs?.[control.id] ?? 0}
                      minimum={control.minimum}
                      maximum={control.maximum}
                      step={0.01}
                      defaultValue={0}
                      unit="%"
                      disabled={disabled}
                      onChange={(value) => updateSemanticFaceMorph(control.id, value)}
                    />
                  ))}
                  <details className="rounded-lg border border-line/70 bg-card/60 p-2.5">
                    <summary className="min-h-8 cursor-pointer text-[0.59rem] font-bold text-fg-2">
                      조형 공급자 확인
                    </summary>
                    <div className="mt-2 space-y-1 border-t border-line/60 pt-2">
                      {semanticFaceMorphProfile.controls.map((control) => (
                        <p key={control.id} className="break-all text-[0.55rem] leading-relaxed text-fg-3">
                          <b className="text-fg-2">{control.label}</b> · {control.provider === "native-morph"
                            ? `모델 morph · ${control.targetNames.join(" · ")}`
                            : `적응형 mesh · 얼굴 메시 ${control.adaptiveMeshCount}개`}
                        </p>
                      ))}
                    </div>
                  </details>
                </div>
              ) : (
                <p className="mt-3 rounded-lg border border-line bg-card/60 px-3 py-2 text-[0.6rem] leading-relaxed text-fg-3">
                  {semanticFaceMorphProfile?.message
                    ?? "모델을 불러오면 native morph와 적응형 얼굴 메시를 함께 검사합니다."}
                </p>
              )}
            </div>

            <div>
              <p className="mb-2 text-[0.68rem] font-bold text-fg-2">얼굴 디테일</p>
              <div className="space-y-2">
                {AVATAR_FORGE_FACE_ACCENT_OPTIONS.map((option) => {
                  const accent = state.faceAccents?.find((entry) => entry.id === option.id);
                  if (!accent) return null;
                  return (
                    <div key={option.id} className="rounded-xl border border-line bg-card p-2.5">
                      <div className="flex min-h-9 items-center gap-2">
                        <div className="flex min-w-0 flex-1 items-center gap-2">
                          <input
                            id={`${controlId}-${option.id}`}
                            type="checkbox"
                            checked={accent.enabled}
                            disabled={disabled}
                            onChange={(event) => updateAccent(option.id, { enabled: event.target.checked })}
                            className="size-4 accent-accent pointer-coarse:size-5"
                          />
                          <label htmlFor={`${controlId}-${option.id}`} className="min-w-0 cursor-pointer">
                            <span className="block text-[0.67rem] font-bold text-fg-2">{option.label}</span>
                            <span className="block truncate text-[0.58rem] text-fg-3">{option.hint}</span>
                          </label>
                        </div>
                        <input
                          type="color"
                          value={accent.color}
                          disabled={disabled || !accent.enabled}
                          onChange={(event) => updateAccent(option.id, { color: event.target.value })}
                          className="size-8 cursor-pointer rounded-lg border border-line bg-transparent p-0 pointer-coarse:size-11"
                          aria-label={`${option.label} 색상`}
                        />
                      </div>
                      {accent.enabled ? (
                        <label className="mt-2 flex items-center gap-2 text-[0.62rem] text-fg-3">
                          강도
                          <input
                            type="range"
                            min={0}
                            max={1}
                            step={0.01}
                            value={accent.intensity}
                            disabled={disabled}
                            onChange={(event) => updateAccent(option.id, { intensity: Number(event.target.value) })}
                            className="h-2 flex-1 accent-accent"
                          />
                          <output className="w-9 text-right tabular-nums">{Math.round(accent.intensity * 100)}%</output>
                        </label>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <div
        data-studio-vrm-generate=""
        className="space-y-2.5 border-t border-line/70 px-3.5 py-3"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[0.72rem] font-extrabold text-fg">
              <UserPlus size={14} className="text-accent" aria-hidden />
              새 VRM 캐릭터
            </p>
            <p className="mt-0.5 text-[0.62rem] leading-relaxed text-fg-3">
              위 프리셋·슬라이더를 레시피로 써서 휴머노이드 VRM을 생성합니다. 불러온 모델을 덮어쓰지 않아요.
            </p>
          </div>
          <span
            data-studio-vrm-generate-preset={previewRecipe.presetId ?? "custom"}
            className="shrink-0 rounded-full border border-line bg-card px-2 py-0.5 text-[0.6rem] font-bold text-fg-2"
          >
            {previewRecipe.label}
          </span>
        </div>

        {/* 미리보기는 편집 중인 상태가 아니라 **실제로 생성될 상태**를 보여준다. 아무것도 고르지
            않았을 때 기본 프리셋이 대신 들어가므로 둘이 갈릴 수 있다. */}
        <div
          data-studio-vrm-generate-preview=""
          className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-3 overflow-hidden rounded-xl border border-line bg-card/70 p-2.5"
        >
          <span className="block h-20 overflow-hidden rounded-lg border border-line/70 bg-panel/60 px-1">
            <StudioVrmAvatarForgePreview
              state={previewRecipe.state}
              variant="compact"
              label={`${previewRecipe.label} 생성 결과 미리보기`}
            />
          </span>
          <span className="min-w-0 text-[0.62rem] leading-relaxed text-fg-3">
            <span className="flex items-center gap-1.5">
              <span
                className="size-3 rounded-full border border-line shrink-0"
                style={{ background: previewRecipe.state.hair.baseColor }}
                aria-hidden
              />
              <span className="truncate text-[0.69rem] font-extrabold text-fg-2">{previewRecipe.label}</span>
            </span>
            <span className="mt-0.5 block">{describeStudioVrmAvatarForgeState(previewRecipe.state).face} · {describeStudioVrmAvatarForgeState(previewRecipe.state).hair}</span>
            <span className="block">{formatStudioVrmHeadUnits(resolveStudioVrmProportionMetrics(previewRecipe.state.proportions).headUnits)} · {describeStudioVrmAvatarForgeState(previewRecipe.state).body}</span>
            <span className="mt-1 flex items-center gap-1.5">
              <span
                aria-hidden
                className="size-3 shrink-0 rounded-full border border-line/70 shadow-inner"
                style={{ backgroundColor: previewRecipe.state.hair.baseColor }}
              />
              <span className="truncate">헤어 컬러 {previewRecipe.state.hair.baseColor.toUpperCase()}</span>
            </span>
          </span>
        </div>

        {previewRecipe.appliedDefaultPresetId ? (
          <p
            data-studio-vrm-generate-default-preset={previewRecipe.appliedDefaultPresetId}
            className="rounded-xl border border-line bg-raised/60 px-3 py-2 text-[0.66rem] leading-relaxed text-fg-3"
          >
            아직 고른 스타일이 없어 기본 스타일 <b className="text-fg-2">{previewRecipe.label}</b>로
            생성됩니다. 위에서 다른 스타일을 고르거나 슬라이더를 조절하면 그 설정이 그대로 쓰입니다.
          </p>
        ) : null}

        {generateResult?.status === "unavailable" ? (
          <p
            data-studio-vrm-generate-unavailable=""
            data-studio-vrm-generate-status="unavailable"
            role="status"
            className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-[0.66rem] leading-relaxed text-danger"
          >
            {generateResult.message}
          </p>
        ) : null}

        {generateResult?.status === "ok" ? (
          <p
            data-studio-vrm-generate-status="ok"
            role="status"
            className="rounded-xl border border-accent/30 bg-accent-soft px-3 py-2 text-[0.66rem] text-accent"
          >
            {generateResult.recipe.label} VRM을 만들었습니다. 라이브러리에 넣고 뷰포트에서 미리볼 수 있어요.
          </p>
        ) : null}

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            data-studio-vrm-generate-submit=""
            disabled={generateBusy}
            onClick={() => {
              setGenerateBusy(true);
              void generateStudioVrmCharacter({
                presetId: state.presetId,
                state,
                allowDefaultPreset: !hairStyleChosen,
              }).then((result) => {
                setGenerateResult(result);
                setGenerateBusy(false);
                if (result.status !== "ok") return;
                const file = new File(
                  [result.bytes],
                  `${result.recipe.label}.vrm`,
                  { type: "model/gltf-binary" },
                );
                onGeneratedFile?.(file);
              });
            }}
            className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-accent/40 bg-accent-soft px-2 text-[0.7rem] font-extrabold text-accent transition-colors hover:bg-accent/15 disabled:opacity-40"
          >
            <Sparkles size={14} aria-hidden />
            {generateBusy ? "생성 중…" : "VRM 생성"}
          </button>
          <button
            type="button"
            data-studio-vrm-generate-export=""
            disabled={generateBusy || generateResult?.status !== "ok"}
            onClick={() => {
              if (generateResult?.status !== "ok") return;
              const blob = new Blob([generateResult.bytes], { type: "model/gltf-binary" });
              const url = URL.createObjectURL(blob);
              const link = document.createElement("a");
              link.href = url;
              link.download = `${generateResult.recipe.label}.vrm`;
              link.click();
              URL.revokeObjectURL(url);
            }}
            className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-line bg-card px-2 text-[0.7rem] font-extrabold text-fg-2 transition-colors hover:bg-raised disabled:opacity-40"
          >
            <Download size={14} aria-hidden />
            VRM 내보내기
          </button>
        </div>
      </div>
    </section>
  );
}
