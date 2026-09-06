/**
 * AI 웹툰 생성 슈퍼 스위트 — 생성형 도구 5종을 한 컴패니언 창에 모은 모달.
 *
 * 셸은 스튜디오의 모달 계약을 그대로 쓴다(useStudioModalSheet + body 포털 + 형제 스크림).
 * 예전에는 useEffect 가 0개라 Escape·포커스 트랩·복귀·배경 스크롤 잠금이 전부 없었고,
 * role/aria-modal 이 스크림 역할을 겸하는 바깥 div 에 붙어 있었다.
 *
 * 탭 스트립·선택 상태 저장·클립보드는 컴패니언 창들이 공유하는 프리미티브를 쓴다:
 *   studio-workbench-tabs      — role=tablist/tab, aria-controls, roving tabIndex, 방향키
 *   studio-workbench-prefs     — 버전 붙은 저장 키로 탭·파라미터 복원
 *   use-studio-copy-feedback   — await·타이머 정리·실패 상태까지 가진 복사(“복사됨”이 거짓말하지 않게)
 */
import {
  AlertTriangle,
  Check,
  Clapperboard,
  Compass,
  Copy,
  MessageCircle,
  Palette,
  Sparkles,
  Sun,
  X,
  Zap,
} from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  STUDIO_EASE,
  STUDIO_FOCUS_RING,
  STUDIO_TOUCH_TARGET,
  StudioEmptyState,
} from "../studio-panel-ui";
import {
  loadStudioWorkbenchPrefs,
  pickStudioWorkbenchOption,
  saveStudioWorkbenchPrefs,
  studioWorkbenchPrefsStorage,
} from "../studio-workbench-prefs";
import {
  StudioWorkbenchTabStrip,
  studioWorkbenchTabPanelProps,
} from "../studio-workbench-tabs";
import { useStudioCopyFeedback } from "../use-studio-copy-feedback";
import { useStudioModalSheet } from "../useStudioModalSheet";

import { StudioAiEmotionBubbleMatcher } from "./studio-ai-emotion-bubble-matcher";
import {
  StudioAiPromptEnhancer,
  type PromptGenreHint,
} from "./studio-ai-prompt-enhancer";
import {
  StudioAiShadingAssistEngine,
  type LightDirectionPreset,
  type AmbientLightingTemperature,
} from "./studio-ai-shading-assist";
import { StudioAiStoryboardDirector } from "./studio-ai-storyboard-director";
import {
  StudioAiWebtoonStyleFilterEngine,
  type WebtoonArtStyleId,
} from "./studio-ai-webtoon-style-filter";

import type { StudioWorkbenchTab } from "../studio-workbench-tabs";
import type { StudioCopyFeedbackStatus } from "../use-studio-copy-feedback";
import type { StudioAiSuitePromptHandoff } from "./studio-ai-suite-handoff";
import type { ReactElement } from "react";

import { cn } from "@/shared/lib/utils";

const AI_SUPER_SUITE_TAB_IDS = [
  "style-filter",
  "shading-assist",
  "prompt-enhancer",
  "storyboard-director",
  "emotion-bubble",
] as const;

export type AiSuperSuiteTab = (typeof AI_SUPER_SUITE_TAB_IDS)[number];

const AI_SUPER_SUITE_TABS: readonly (StudioWorkbenchTab & { readonly id: AiSuperSuiteTab })[] = [
  { id: "style-filter", label: "화풍 변환 툰필터", icon: Palette },
  { id: "shading-assist", label: "AI 음영 어시스트", icon: Sun },
  { id: "prompt-enhancer", label: "프롬프트 증강기", icon: Zap },
  { id: "storyboard-director", label: "콘티 자동 디렉터", icon: Clapperboard },
  { id: "emotion-bubble", label: "감정-말풍선 매처", icon: MessageCircle },
];

const WEBTOON_ART_STYLE_IDS = [
  "romance-manhwa",
  "action-shonen-ink",
  "fantasy-noble-cel",
  "thriller-noir-grit",
] as const satisfies readonly WebtoonArtStyleId[];

const LIGHT_DIRECTION_BUTTONS = [
  { id: "top-left", label: "↖ 좌상단" },
  { id: "top", label: "↑ 상단 정면" },
  { id: "top-right", label: "↗ 우상단" },
  { id: "left", label: "← 좌측광" },
  { id: "backlight-rim", label: "☼ 역광/림" },
  { id: "right", label: "→ 우측광" },
  { id: "bottom-left", label: "↙ 좌하단" },
  { id: "bottom", label: "↓ 하단 언더" },
  { id: "bottom-right", label: "↘ 우하단" },
] as const satisfies readonly { id: LightDirectionPreset; label: string }[];

const LIGHT_DIRECTION_IDS = LIGHT_DIRECTION_BUTTONS.map((button) => button.id);

const AMBIENT_TEMPERATURE_BUTTONS = [
  { id: "warm-dawn", label: "새벽 웜톤" },
  { id: "neutral-day", label: "대낮 뉴트럴" },
  { id: "cool-moon", label: "달빛 쿨톤" },
  { id: "sunset-golden", label: "석양 골든" },
] as const satisfies readonly { id: AmbientLightingTemperature; label: string }[];

const AMBIENT_TEMPERATURE_IDS = AMBIENT_TEMPERATURE_BUTTONS.map((button) => button.id);

/** 빈 문자열 = "자동 감지". 엔진의 detectGenre 에 맡긴다는 뜻이라 정당한 저장 값이다. */
const GENRE_HINT_CHOICES = [
  { id: "", label: "자동 감지" },
  { id: "action", label: "액션" },
  { id: "romance", label: "로맨스" },
  { id: "fantasy", label: "판타지" },
  { id: "slice-of-life", label: "일상" },
  { id: "horror", label: "호러" },
] as const satisfies readonly { id: PromptGenreHint | ""; label: string }[];

type GenreHintChoice = (typeof GENRE_HINT_CHOICES)[number]["id"];

const GENRE_HINT_IDS = GENRE_HINT_CHOICES.map((choice) => choice.id);

/**
 * 아이디어 입력의 최소 길이. 이보다 짧으면 화풍 키워드만 남은 "주어 없는 프롬프트"가 나와서
 * 생성기에 넣어도 쓸 수 없다 — 결과를 만들어 보여주는 대신 입력을 요구한다.
 */
const MIN_IDEA_LENGTH = 2;

const PANEL_CARD_CLASS = "flex flex-col gap-2 rounded-xl border border-line bg-card/60 p-3";
const TEXT_FIELD_CLASS = cn(
  "w-full rounded-md border border-line bg-card px-3 py-2 text-xs text-fg",
  STUDIO_EASE,
  STUDIO_FOCUS_RING,
  "aria-[invalid=true]:border-bad/60"
);

/**
 * 복사 버튼 — useStudioCopyFeedback 이 확정한 결과만 표시한다.
 * 클립보드가 막힌 환경에서 "복사됨"을 띄우면 사용자는 붙여넣기가 될 거라 믿고 창을 닫는다.
 */
function StudioCopyTextButton({
  copyKey,
  text,
  statusFor,
  onCopy,
  variant = "solid",
  label,
}: {
  readonly copyKey: string;
  readonly text: string;
  readonly statusFor: (id: string) => StudioCopyFeedbackStatus | null;
  readonly onCopy: (id: string, text: string) => void;
  readonly variant?: "solid" | "quiet";
  readonly label: string;
}): ReactElement {
  const status = statusFor(copyKey);
  const copied = status === "copied";
  const failed = status === "failed";
  const Icon = copied ? Check : failed ? AlertTriangle : Copy;
  return (
    <button
      type="button"
      onClick={() => onCopy(copyKey, text)}
      aria-label={`${label} 복사`}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-lg border px-2.5 text-[0.62rem] font-bold",
        STUDIO_EASE,
        STUDIO_FOCUS_RING,
        STUDIO_TOUCH_TARGET,
        failed
          ? "border-bad/35 bg-bad/10 text-bad"
          : variant === "solid"
            ? "border-transparent bg-accent text-on-accent"
            : "border-line bg-card text-fg hover:bg-raised"
      )}
    >
      <Icon size={12} aria-hidden />
      <span>{copied ? "복사됨" : failed ? "복사 실패" : "복사"}</span>
    </button>
  );
}

/** 입력이 모자랄 때 결과 자리에 세우는 안내. 빈 결과를 그리지 않는다. */
function StudioAiSuiteInputNeeded({
  icon,
  description,
}: {
  readonly icon: ReactElement;
  readonly description: string;
}): ReactElement {
  return <StudioEmptyState icon={icon} title="입력이 더 필요해요" description={description} />;
}

export interface StudioAiSuperSuiteModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onApplyPrompt?: (prompt: string) => void;
  readonly onApplyPromptRecipe?: (handoff: StudioAiSuitePromptHandoff) => void;
}

export function StudioAiSuperSuiteModal({
  open,
  onClose,
  onApplyPrompt,
  onApplyPromptRecipe,
}: StudioAiSuperSuiteModalProps) {
  const rawId = useId();
  const idPrefix = `ai-super-suite-${rawId.replace(/:/gu, "")}`;
  const titleId = `${idPrefix}-title`;
  const descriptionId = `${idPrefix}-description`;

  const dialogRef = useRef<HTMLElement | null>(null);
  const portalRootRef = useRef<HTMLElement | null>(
    typeof document === "undefined" ? null : document.body
  );

  const [activeTab, setActiveTab] = useState<AiSuperSuiteTab>("style-filter");

  // Tab 1: Style Filter
  const styleEngine = useMemo(() => new StudioAiWebtoonStyleFilterEngine(), []);
  const [selectedStyleId, setSelectedStyleId] = useState<WebtoonArtStyleId>("romance-manhwa");
  const [userConceptPrompt, setUserConceptPrompt] = useState(
    "주인공이 신비로운 유적에서 푸른 보석을 발견한다"
  );
  const compiledStylePrompt = useMemo(
    () => styleEngine.compilePrompt(selectedStyleId, userConceptPrompt),
    [styleEngine, selectedStyleId, userConceptPrompt]
  );
  const conceptReady = userConceptPrompt.trim().length >= MIN_IDEA_LENGTH;

  // Tab 2: Shading Assist
  const shadingEngine = useMemo(() => new StudioAiShadingAssistEngine(), []);
  const [lightDirection, setLightDirection] = useState<LightDirectionPreset>("top-left");
  const [lightIntensity, setLightIntensity] = useState(80);
  const [lightTemperature, setLightTemperature] =
    useState<AmbientLightingTemperature>("warm-dawn");
  const [enableRim, setEnableRim] = useState(true);
  const computedShading = useMemo(
    () =>
      shadingEngine.compute({
        direction: lightDirection,
        intensityPercent: lightIntensity,
        softnessPercent: 15,
        temperature: lightTemperature,
        enableRimLight: enableRim,
      }),
    [shadingEngine, lightDirection, lightIntensity, lightTemperature, enableRim]
  );

  // Tab 3: Prompt Enhancer
  const promptEnhancer = useMemo(() => new StudioAiPromptEnhancer(), []);
  const [rawPromptInput, setRawPromptInput] = useState("검을 들고 적진으로 질주하는 소년 검사");
  const [genreHint, setGenreHint] = useState<GenreHintChoice>("");
  const enhancedResult = useMemo(
    () => promptEnhancer.enhance(rawPromptInput, genreHint === "" ? {} : { genre: genreHint }),
    [promptEnhancer, rawPromptInput, genreHint]
  );
  const rawPromptReady = rawPromptInput.trim().length >= MIN_IDEA_LENGTH;

  // Tab 4: Storyboard Director
  const storyboardDirector = useMemo(() => new StudioAiStoryboardDirector(), []);
  const [scriptInput, setScriptInput] = useState(
    `주인공이 무너진 성벽 위에 서서 "드디어 찾았다..."라고 나지막이 읊조린다.
성문 너머에서 거대한 마수가 포효하며 지면을 뒤흔든다.
경악하는 기사단의 흔들리는 동공과 굳어버린 표정.
주인공이 등 뒤의 대검을 뽑아들며 적을 향해 단독 돌진한다.`
  );
  const storyboardResult = useMemo(
    () => storyboardDirector.direct(scriptInput),
    [storyboardDirector, scriptInput]
  );
  const scriptReady = storyboardResult.totalCuts > 0;

  // Tab 5: Emotion Bubble Matcher
  const bubbleMatcher = useMemo(() => new StudioAiEmotionBubbleMatcher(), []);
  const [testDialogue, setTestDialogue] = useState("절대... 용서하지 않을 거야!!");
  const bubbleRecommendation = useMemo(
    () => bubbleMatcher.match(testDialogue),
    [bubbleMatcher, testDialogue]
  );
  const dialogueReady = testDialogue.trim().length > 0;

  // ── 클립보드 ─────────────────────────────────────────────────────────────
  // 훅이 await·타이머 정리·연타 경합·실패 상태를 전부 소유한다. 실패 문구는 읽을 시간이
  // 더 필요해서 기본 1500ms 대신 조금 길게 잡는다.
  const clipboard = useStudioCopyFeedback(2400);
  const copyStatusMessage =
    clipboard.current === null
      ? ""
      : clipboard.current.status === "copied"
        ? "클립보드에 복사했어요."
        : "클립보드에 복사하지 못했어요. 텍스트를 직접 선택해 복사해 주세요.";

  // ── 선택 상태 저장·복원 ──────────────────────────────────────────────────
  const saveArmedRef = useRef(false);

  useEffect(() => {
    const stored = loadStudioWorkbenchPrefs(studioWorkbenchPrefsStorage()).aiSuite;
    // prefs 는 "쓸 수 있는 문자열"까지만 보장한다. 카탈로그 소속은 화면이 직접 거른다.
    setActiveTab(pickStudioWorkbenchOption(stored.activeTab, AI_SUPER_SUITE_TAB_IDS, "style-filter"));
    setSelectedStyleId(
      pickStudioWorkbenchOption(stored.styleId, WEBTOON_ART_STYLE_IDS, "romance-manhwa")
    );
    setLightDirection(
      pickStudioWorkbenchOption(stored.lightDirection, LIGHT_DIRECTION_IDS, "top-left")
    );
    setLightTemperature(
      pickStudioWorkbenchOption(stored.ambientLight, AMBIENT_TEMPERATURE_IDS, "warm-dawn")
    );
    setGenreHint(pickStudioWorkbenchOption(stored.genreHint, GENRE_HINT_IDS, ""));
  }, []);

  useEffect(() => {
    // 첫 실행은 하이드레이션 직후라 아직 사용자의 선택이 아니다 — 기본값을 덮어쓰지 않게 건너뛴다.
    if (!saveArmedRef.current) {
      saveArmedRef.current = true;
      return;
    }
    const storage = studioWorkbenchPrefsStorage();
    // 어시스턴트 창이 같은 키의 다른 절반을 쓴다. 통째로 새로 만들면 그 절반이 날아간다.
    const current = loadStudioWorkbenchPrefs(storage);
    saveStudioWorkbenchPrefs(storage, {
      ...current,
      aiSuite: {
        activeTab,
        styleId: selectedStyleId,
        lightDirection,
        ambientLight: lightTemperature,
        genreHint,
      },
    });
  }, [activeTab, selectedStyleId, lightDirection, lightTemperature, genreHint]);

  // ── 모달 계약 ────────────────────────────────────────────────────────────
  useStudioModalSheet({
    activeKey: open ? "ai-super-suite" : null,
    dialogRef,
    onDismiss: onClose,
    resolveInitialFocus: (dialog) => dialog.querySelector<HTMLElement>("[data-autofocus='true']"),
    rootRef: portalRootRef,
  });

  useEffect(() => {
    if (!open || typeof document === "undefined") return;
    const { body, documentElement } = document;
    const previousBodyOverflow = body.style.overflow;
    const previousRootOverflow = documentElement.style.overflow;
    body.style.overflow = "hidden";
    documentElement.style.overflow = "hidden";
    return () => {
      body.style.overflow = previousBodyOverflow;
      documentElement.style.overflow = previousRootOverflow;
    };
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  const content = (
    <div
      data-studio-ai-super-suite-overlay="true"
      className="fixed inset-0 z-[120] flex items-end justify-center p-0 sm:items-center sm:p-4"
    >
      {/* 스크림은 다이얼로그의 형제다 — 다이얼로그 자신이 스크림을 겸하면 포커스 격리가 자기를 가둔다. */}
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        data-studio-modal-backdrop="true"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-canvas/80 backdrop-blur-sm"
      />
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        data-testid="studio-ai-super-suite-modal"
        data-studio-modal-owner="ai-super-suite"
        data-studio-shortcut-boundary="true"
        tabIndex={-1}
        className="relative z-10 flex max-h-[100dvh] w-full max-w-4xl flex-col overflow-hidden rounded-t-2xl border border-line-strong bg-card text-fg shadow-2xl sm:max-h-[calc(100dvh-2rem)] sm:rounded-2xl"
      >
        {/* Header */}
        <header className="flex shrink-0 items-start justify-between gap-2 border-b border-line bg-raised px-3 py-2.5 sm:px-4 sm:py-3">
          <div className="flex min-w-0 items-start gap-2">
            <Sparkles
              aria-hidden
              className="mt-0.5 size-5 shrink-0 animate-pulse text-accent motion-reduce:animate-none"
            />
            <div className="min-w-0">
              <h2 id={titleId} className="text-sm font-bold tracking-tight text-fg">
                AI 웹툰 생성 슈퍼 스위트 (Webtoon AI Super Suite)
              </h2>
              <p id={descriptionId} className="text-[0.68rem] leading-relaxed text-fg-3">
                네이버 툰필터 화풍 변환 · CSP 음영 어시스트 · 프롬프트 증강 · TooNat 콘티 디렉터 ·
                투닝 감정 말풍선
              </p>
            </div>
          </div>
          <button
            type="button"
            data-autofocus="true"
            onClick={onClose}
            aria-label="슈퍼 스위트 닫기"
            className={cn(
              "inline-flex min-w-11 shrink-0 items-center justify-center rounded-lg px-2 text-fg-3",
              STUDIO_EASE,
              STUDIO_FOCUS_RING,
              STUDIO_TOUCH_TARGET,
              "hover:bg-card hover:text-fg"
            )}
          >
            <X className="size-4" aria-hidden />
          </button>
        </header>

        {/* Tab Bar */}
        <div className="shrink-0 border-b border-line bg-card/60 px-2 py-1">
          <StudioWorkbenchTabStrip
            tabs={AI_SUPER_SUITE_TABS}
            activeId={activeTab}
            onSelect={(id) =>
              setActiveTab(pickStudioWorkbenchOption(id, AI_SUPER_SUITE_TAB_IDS, "style-filter"))
            }
            ariaLabel="AI 슈퍼 스위트 도구"
            idPrefix={idPrefix}
          />
        </div>

        {/* 복사 결과는 시각 뱃지만으로는 스크린리더에 닿지 않는다. */}
        <p className="sr-only" aria-live="polite">
          {copyStatusMessage}
        </p>

        {/* Body Content */}
        <div
          {...studioWorkbenchTabPanelProps(idPrefix, activeTab)}
          className={cn(
            "min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 text-xs text-fg sm:p-4",
            STUDIO_FOCUS_RING
          )}
        >
          {/* TAB 1: Style Filter */}
          {activeTab === "style-filter" && (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {styleEngine.listStyles().map((st) => {
                  const isSelected = selectedStyleId === st.id;
                  return (
                    <button
                      key={st.id}
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() => setSelectedStyleId(st.id)}
                      className={cn(
                        "flex flex-col rounded-xl border p-2.5 text-left",
                        STUDIO_EASE,
                        STUDIO_FOCUS_RING,
                        STUDIO_TOUCH_TARGET,
                        isSelected
                          ? "border-accent bg-accent-soft text-fg shadow-sm"
                          : "border-line bg-card text-fg hover:bg-raised"
                      )}
                    >
                      <span
                        className={cn(
                          "text-[0.72rem] font-bold",
                          isSelected ? "text-accent" : undefined
                        )}
                      >
                        {st.name}
                      </span>
                      <span className="mt-1 line-clamp-2 text-[0.62rem] text-fg-3">
                        {st.description}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Concept Input */}
              <div className={PANEL_CARD_CLASS}>
                <label
                  htmlFor={`${idPrefix}-concept`}
                  className="text-[0.72rem] font-bold text-fg"
                >
                  원하는 장면 아이디어 입력:
                </label>
                <input
                  id={`${idPrefix}-concept`}
                  type="text"
                  value={userConceptPrompt}
                  onChange={(e) => setUserConceptPrompt(e.target.value)}
                  placeholder="예: 주인공이 거대한 용을 마주하고 선다..."
                  aria-invalid={!conceptReady}
                  aria-describedby={conceptReady ? undefined : `${idPrefix}-concept-error`}
                  className={cn(TEXT_FIELD_CLASS, STUDIO_TOUCH_TARGET)}
                />
                {!conceptReady && (
                  <p
                    id={`${idPrefix}-concept-error`}
                    className="rounded-md border border-bad/35 bg-bad/10 px-2 py-1 text-[0.65rem] font-semibold text-bad"
                  >
                    장면 아이디어를 {MIN_IDEA_LENGTH}자 이상 적어 주세요. 지금은 화풍 키워드만 남아
                    생성기에 그대로 넣을 수 없어요.
                  </p>
                )}
              </div>

              {/* Compiled Prompt Card */}
              {conceptReady ? (
                <div className="flex flex-col gap-2 rounded-xl border border-accent/40 bg-accent-soft p-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[0.75rem] font-bold text-accent">
                      생성형 AI 최종 합성 프롬프트
                    </span>
                    <StudioCopyTextButton
                      copyKey="style-positive"
                      label="포지티브 프롬프트"
                      text={compiledStylePrompt.positivePrompt}
                      statusFor={clipboard.statusFor}
                      onCopy={clipboard.copy}
                    />
                  </div>
                  <p className="break-words font-mono text-[0.68rem] leading-relaxed text-fg">
                    {compiledStylePrompt.positivePrompt}
                  </p>

                  <div className="mt-2 border-t border-line/50 pt-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[0.68rem] font-bold text-fg-3">네거티브 프롬프트:</span>
                      <StudioCopyTextButton
                        copyKey="style-negative"
                        label="네거티브 프롬프트"
                        text={compiledStylePrompt.negativePrompt}
                        statusFor={clipboard.statusFor}
                        onCopy={clipboard.copy}
                        variant="quiet"
                      />
                    </div>
                    <p className="mt-0.5 break-words font-mono text-[0.62rem] leading-tight text-fg-3">
                      {compiledStylePrompt.negativePrompt}
                    </p>
                  </div>

                  {/*
                    compilePrompt 는 네거티브·디노이즈·권장 설정까지 돌려주는데 전송 경로는
                    포지티브 한 줄뿐이다(배경 패널에 네거티브 입력이 아직 없음).
                    버려지는 값을 화면에 남겨 최소한 손으로 옮길 수 있게 한다.
                  */}
                  <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 rounded-lg bg-card/70 p-2 font-mono text-[0.62rem] text-fg-2 sm:grid-cols-4">
                    <div className="flex justify-between gap-1">
                      <dt className="text-fg-3">디노이즈</dt>
                      <dd className="font-bold">{compiledStylePrompt.denoiseStrength}</dd>
                    </div>
                    <div className="flex justify-between gap-1">
                      <dt className="text-fg-3">선 두께</dt>
                      <dd className="font-bold">
                        {compiledStylePrompt.recommendedSettings.lineFactor}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-1">
                      <dt className="text-fg-3">대비</dt>
                      <dd className="font-bold">
                        {compiledStylePrompt.recommendedSettings.contrast}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-1">
                      <dt className="text-fg-3">채도</dt>
                      <dd className="font-bold">
                        {compiledStylePrompt.recommendedSettings.saturation}
                      </dd>
                    </div>
                  </dl>

                  {(onApplyPromptRecipe || onApplyPrompt) && (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          if (onApplyPromptRecipe) {
                            onApplyPromptRecipe({
                              version: 1,
                              positivePrompt: compiledStylePrompt.positivePrompt,
                              negativePrompt: compiledStylePrompt.negativePrompt,
                              denoiseStrength: compiledStylePrompt.denoiseStrength,
                              recommendedSettings: compiledStylePrompt.recommendedSettings,
                            });
                            return;
                          }
                          onApplyPrompt?.(compiledStylePrompt.positivePrompt);
                        }}
                        className={cn(
                          "mt-2 flex items-center justify-center gap-1 rounded-lg bg-accent px-3 text-xs font-bold text-on-accent shadow-sm",
                          STUDIO_EASE,
                          STUDIO_FOCUS_RING,
                          STUDIO_TOUCH_TARGET
                        )}
                      >
                        <Sparkles className="size-3.5" aria-hidden />
                        <span>
                          {onApplyPromptRecipe
                            ? "전체 화풍 레시피를 배경 생성기로 전송"
                            : "포지티브 프롬프트만 배경/캐릭터 생성기로 전송"}
                        </span>
                      </button>
                      <p className="text-[0.62rem] leading-relaxed text-fg-3">
                        {onApplyPromptRecipe
                          ? "포지티브·네거티브·디노이즈·선 두께·대비·채도를 제공자 호환 프롬프트로 보존해 전달해요."
                          : "현재 연결은 포지티브 프롬프트만 전달해요. 나머지 값은 위에서 복사해 주세요."}
                      </p>
                    </>
                  )}
                </div>
              ) : (
                <StudioAiSuiteInputNeeded
                  icon={<Palette size={20} aria-hidden />}
                  description="장면 아이디어를 적으면 선택한 화풍의 최종 합성 프롬프트를 만들어 드려요."
                />
              )}
            </div>
          )}

          {/* TAB 2: Shading Assist */}
          {activeTab === "shading-assist" && (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {/* 8-Direction Compass */}
                <div className={PANEL_CARD_CLASS}>
                  <div
                    className="flex items-center gap-1.5 text-[0.75rem] font-bold"
                    id={`${idPrefix}-light-direction`}
                  >
                    <Compass className="size-4 text-accent" aria-hidden />
                    <span>가상 광원 방향 (Light Direction)</span>
                  </div>
                  <div
                    role="group"
                    aria-labelledby={`${idPrefix}-light-direction`}
                    className="grid grid-cols-3 gap-1.5 text-center text-[0.68rem] font-bold"
                  >
                    {LIGHT_DIRECTION_BUTTONS.map((btn) => {
                      const isSelected = lightDirection === btn.id;
                      return (
                        <button
                          key={btn.id}
                          type="button"
                          aria-pressed={isSelected}
                          onClick={() => setLightDirection(btn.id)}
                          className={cn(
                            "rounded-lg border px-2",
                            STUDIO_EASE,
                            STUDIO_FOCUS_RING,
                            STUDIO_TOUCH_TARGET,
                            isSelected
                              ? "border-accent bg-accent text-on-accent shadow-sm"
                              : "border-line bg-card text-fg hover:bg-raised"
                          )}
                        >
                          {btn.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Light Parameters */}
                <div className="flex flex-col gap-3 rounded-xl border border-line bg-card/60 p-3">
                  <span className="text-[0.75rem] font-bold">광원 파라미터 조절</span>

                  <div className="flex flex-col gap-1">
                    <div className="flex justify-between text-[0.68rem]">
                      <label htmlFor={`${idPrefix}-intensity`} className="text-fg-3">
                        빛 강도:
                      </label>
                      <span className="font-mono font-bold tabular-nums">{lightIntensity}%</span>
                    </div>
                    <input
                      id={`${idPrefix}-intensity`}
                      type="range"
                      min={20}
                      max={100}
                      value={lightIntensity}
                      onChange={(e) => setLightIntensity(Number(e.target.value))}
                      className={cn("h-11 w-full accent-accent", STUDIO_FOCUS_RING)}
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <span id={`${idPrefix}-ambient`} className="text-[0.68rem] text-fg-3">
                      환경광 색온도:
                    </span>
                    <div
                      role="group"
                      aria-labelledby={`${idPrefix}-ambient`}
                      className="grid grid-cols-2 gap-1 text-[0.65rem] font-bold sm:grid-cols-4 lg:grid-cols-2"
                    >
                      {AMBIENT_TEMPERATURE_BUTTONS.map((temp) => {
                        const isSelected = lightTemperature === temp.id;
                        return (
                          <button
                            key={temp.id}
                            type="button"
                            aria-pressed={isSelected}
                            onClick={() => setLightTemperature(temp.id)}
                            className={cn(
                              "rounded border px-1.5",
                              STUDIO_EASE,
                              STUDIO_FOCUS_RING,
                              STUDIO_TOUCH_TARGET,
                              isSelected
                                ? "border-accent bg-accent-soft text-accent"
                                : "border-line bg-card text-fg hover:bg-raised"
                            )}
                          >
                            {temp.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <label
                    className={cn(
                      "flex cursor-pointer items-center gap-2 rounded-lg px-1 text-[0.68rem] font-bold",
                      STUDIO_TOUCH_TARGET,
                      "focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent"
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={enableRim}
                      onChange={(e) => setEnableRim(e.target.checked)}
                      className="size-4 accent-accent"
                    />
                    <span>외곽선 림라이트 (Rim Light) 강조 활성화</span>
                  </label>
                </div>
              </div>

              {/* Shading Vector & Swatches Result */}
              <div className="flex flex-col gap-2 rounded-xl border border-line bg-card/60 p-3.5">
                <span className="text-[0.75rem] font-bold">계산된 셀 음영 벡터 &amp; 컬러 스펙</span>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <div className="flex flex-col items-center rounded-lg border border-line bg-card p-2 text-center">
                    <span className="text-[0.62rem] text-fg-3">
                      1차 셀 음영 (투명도 {computedShading.shadow1Opacity})
                    </span>
                    <div
                      aria-hidden
                      className="my-1.5 h-6 w-full rounded border border-line/40"
                      style={{ backgroundColor: computedShading.shadow1ColorHex }}
                    />
                    <span className="font-mono text-[0.62rem] font-bold">
                      {computedShading.shadow1ColorHex}
                    </span>
                  </div>

                  <div className="flex flex-col items-center rounded-lg border border-line bg-card p-2 text-center">
                    <span className="text-[0.62rem] text-fg-3">
                      2차 딥 음영 (투명도 {computedShading.shadow2Opacity})
                    </span>
                    <div
                      aria-hidden
                      className="my-1.5 h-6 w-full rounded border border-line/40"
                      style={{ backgroundColor: computedShading.shadow2ColorHex }}
                    />
                    <span className="font-mono text-[0.62rem] font-bold">
                      {computedShading.shadow2ColorHex}
                    </span>
                  </div>

                  <div className="flex flex-col items-center rounded-lg border border-line bg-card p-2 text-center">
                    <span className="text-[0.62rem] text-fg-3">림라이트 컬러</span>
                    {/*
                      값이 없으면 색을 지어내지 않는다. 예전의 흰색 hex 폴백은 흰 림라이트가
                      계산된 것처럼 보여서, 바로 아래 "없음" 글자와 정면으로 어긋났다.
                    */}
                    {computedShading.rimLightColorHex ? (
                      <div
                        aria-hidden
                        className="my-1.5 h-6 w-full rounded border border-line/40"
                        style={{ backgroundColor: computedShading.rimLightColorHex }}
                      />
                    ) : (
                      <div
                        aria-hidden
                        className="my-1.5 h-6 w-full rounded border border-dashed border-line bg-raised"
                      />
                    )}
                    <span className="font-mono text-[0.62rem] font-bold">
                      {computedShading.rimLightColorHex ?? "없음"}
                    </span>
                  </div>
                </div>

                <p className="mt-2 rounded bg-raised p-2 font-mono text-[0.65rem] text-fg-2">
                  {computedShading.promptInstruction}
                </p>
              </div>
            </div>
          )}

          {/* TAB 3: Prompt Enhancer */}
          {activeTab === "prompt-enhancer" && (
            <div className="flex flex-col gap-4">
              <div className={PANEL_CARD_CLASS}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label
                    htmlFor={`${idPrefix}-raw-prompt`}
                    className="text-[0.75rem] font-bold text-fg"
                  >
                    자연어 아이디어 입력
                  </label>
                  <span className="rounded bg-accent-soft px-2 py-0.5 text-[0.62rem] font-bold text-accent">
                    {genreHint === "" ? "감지된 장르" : "지정 장르"}:{" "}
                    {enhancedResult.detectedGenre.toUpperCase()}
                  </span>
                </div>
                <textarea
                  id={`${idPrefix}-raw-prompt`}
                  rows={3}
                  value={rawPromptInput}
                  onChange={(e) => setRawPromptInput(e.target.value)}
                  placeholder="아이디어를 입력하세요 (예: 빗속에서 마법 지팡이를 들고 결의에 찬 표정으로 서 있는 주인공)..."
                  aria-invalid={!rawPromptReady}
                  aria-describedby={rawPromptReady ? undefined : `${idPrefix}-raw-prompt-error`}
                  className={cn(TEXT_FIELD_CLASS, "resize-none")}
                />
                {!rawPromptReady && (
                  <p
                    id={`${idPrefix}-raw-prompt-error`}
                    className="rounded-md border border-bad/35 bg-bad/10 px-2 py-1 text-[0.65rem] font-semibold text-bad"
                  >
                    아이디어를 {MIN_IDEA_LENGTH}자 이상 적어 주세요. 지금은 장르 키워드만 남아
                    증강할 원문이 없어요.
                  </p>
                )}

                <div className="flex flex-col gap-1">
                  <span id={`${idPrefix}-genre`} className="text-[0.68rem] text-fg-3">
                    장르 힌트 (자동 감지를 덮어씁니다):
                  </span>
                  <div
                    role="group"
                    aria-labelledby={`${idPrefix}-genre`}
                    className="grid grid-cols-2 gap-1 text-[0.65rem] font-bold sm:grid-cols-3 lg:grid-cols-6"
                  >
                    {GENRE_HINT_CHOICES.map((choice) => {
                      const isSelected = genreHint === choice.id;
                      return (
                        <button
                          key={choice.id === "" ? "auto" : choice.id}
                          type="button"
                          aria-pressed={isSelected}
                          onClick={() => setGenreHint(choice.id)}
                          className={cn(
                            "rounded border px-1.5",
                            STUDIO_EASE,
                            STUDIO_FOCUS_RING,
                            STUDIO_TOUCH_TARGET,
                            isSelected
                              ? "border-accent bg-accent-soft text-accent"
                              : "border-line bg-card text-fg hover:bg-raised"
                          )}
                        >
                          {choice.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {rawPromptReady ? (
                <div className="flex flex-col gap-3 rounded-xl border border-accent/40 bg-accent-soft p-3.5">
                  <div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[0.75rem] font-bold text-accent">
                        증강된 포지티브 프롬프트
                      </span>
                      <StudioCopyTextButton
                        copyKey="enhanced-positive"
                        label="증강된 포지티브 프롬프트"
                        text={enhancedResult.enhancedPositivePrompt}
                        statusFor={clipboard.statusFor}
                        onCopy={clipboard.copy}
                      />
                    </div>
                    <p className="mt-1.5 break-words font-mono text-[0.68rem] leading-relaxed text-fg">
                      {enhancedResult.enhancedPositivePrompt}
                    </p>
                  </div>

                  <div className="border-t border-line/40 pt-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[0.75rem] font-bold text-fg-3">
                        작화 붕괴 방지 네거티브 프롬프트
                      </span>
                      <StudioCopyTextButton
                        copyKey="enhanced-negative"
                        label="네거티브 프롬프트"
                        text={enhancedResult.recommendedNegativePrompt}
                        statusFor={clipboard.statusFor}
                        onCopy={clipboard.copy}
                        variant="quiet"
                      />
                    </div>
                    <p className="mt-1 break-words font-mono text-[0.62rem] leading-tight text-fg-3">
                      {enhancedResult.recommendedNegativePrompt}
                    </p>
                  </div>
                </div>
              ) : (
                <StudioAiSuiteInputNeeded
                  icon={<Zap size={20} aria-hidden />}
                  description="원문 아이디어가 있어야 장르 키워드와 품질 앵커를 얹을 수 있어요."
                />
              )}
            </div>
          )}

          {/* TAB 4: Storyboard Director */}
          {activeTab === "storyboard-director" && (
            <div className="flex flex-col gap-4">
              <div className={PANEL_CARD_CLASS}>
                <label
                  htmlFor={`${idPrefix}-script`}
                  className="text-[0.75rem] font-bold text-fg"
                >
                  대본 / 시나리오 줄글 입력
                </label>
                <textarea
                  id={`${idPrefix}-script`}
                  rows={4}
                  value={scriptInput}
                  onChange={(e) => setScriptInput(e.target.value)}
                  placeholder="한 줄이 한 컷이 됩니다. 장면을 줄바꿈으로 나눠 적어 주세요."
                  aria-invalid={!scriptReady}
                  aria-describedby={scriptReady ? undefined : `${idPrefix}-script-error`}
                  className={cn(TEXT_FIELD_CLASS, "resize-none font-mono")}
                />
                {!scriptReady && (
                  <p
                    id={`${idPrefix}-script-error`}
                    className="rounded-md border border-bad/35 bg-bad/10 px-2 py-1 text-[0.65rem] font-semibold text-bad"
                  >
                    대본이 비어 있어요. 컷으로 나눌 문장을 한 줄 이상 적어 주세요.
                  </p>
                )}
              </div>

              {/* Storyboard Cuts Table */}
              {scriptReady ? (
                <div className={PANEL_CARD_CLASS}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[0.75rem] font-bold">
                      자동 생성된 컷별 콘티 ({storyboardResult.totalCuts}개 컷)
                    </span>
                    <span className="font-mono text-[0.65rem] text-fg-3">
                      예상 모바일 완독: 약 {storyboardResult.estimatedEpisodeReadingSec}초
                    </span>
                  </div>

                  <ol className="flex list-none flex-col gap-2 p-0">
                    {storyboardResult.cuts.map((cut) => (
                      <li
                        key={cut.cutNumber}
                        className="flex flex-col gap-1.5 rounded-lg border border-line bg-card p-2.5 text-[0.68rem]"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-1.5">
                          <div className="flex flex-wrap items-center gap-1.5 font-bold">
                            <span className="rounded bg-accent-soft px-1.5 py-0.5 text-accent">
                              컷 #{cut.cutNumber}
                            </span>
                            <span className="rounded bg-raised px-1.5 py-0.5 text-fg-2">
                              {cut.shotScale} · {cut.cameraAngle}
                            </span>
                            <span className="rounded bg-good/10 px-1.5 py-0.5 text-good">
                              감정: {cut.emotion}
                            </span>
                          </div>
                          {cut.suggestedSfx && (
                            <span className="rounded bg-accent-soft px-2 py-0.5 font-black text-accent">
                              효과음: {cut.suggestedSfx}
                            </span>
                          )}
                        </div>

                        <p className="text-fg">{cut.summary}</p>
                        {cut.dialogue && (
                          <p className="border-l-2 border-accent pl-2 font-semibold text-accent">
                            대사: &ldquo;{cut.dialogue}&rdquo;
                          </p>
                        )}
                        <p className="text-[0.62rem] text-fg-3">
                          배경 프롬프트: {cut.backgroundPrompt}
                        </p>
                      </li>
                    ))}
                  </ol>
                </div>
              ) : (
                <StudioAiSuiteInputNeeded
                  icon={<Clapperboard size={20} aria-hidden />}
                  description="대본 한 줄이 한 컷이 됩니다. 문장을 적으면 샷 사이즈·앵글·효과음을 배정해 드려요."
                />
              )}
            </div>
          )}

          {/* TAB 5: Emotion Bubble Matcher */}
          {activeTab === "emotion-bubble" && (
            <div className="flex flex-col gap-4">
              <div className={PANEL_CARD_CLASS}>
                <label
                  htmlFor={`${idPrefix}-dialogue`}
                  className="text-[0.75rem] font-bold text-fg"
                >
                  대사 문장 입력 및 감정 테스트
                </label>
                <input
                  id={`${idPrefix}-dialogue`}
                  type="text"
                  value={testDialogue}
                  onChange={(e) => setTestDialogue(e.target.value)}
                  placeholder="예: 닥쳐! 절대 용서 못 해!!"
                  aria-invalid={!dialogueReady}
                  aria-describedby={dialogueReady ? undefined : `${idPrefix}-dialogue-error`}
                  className={cn(TEXT_FIELD_CLASS, STUDIO_TOUCH_TARGET)}
                />
                {!dialogueReady && (
                  <p
                    id={`${idPrefix}-dialogue-error`}
                    className="rounded-md border border-bad/35 bg-bad/10 px-2 py-1 text-[0.65rem] font-semibold text-bad"
                  >
                    대사를 입력해 주세요. 빈 문장에는 감정이 없어 기본 말풍선만 나옵니다.
                  </p>
                )}
              </div>

              {/* Match Result Display */}
              {dialogueReady ? (
                <div className="flex flex-col items-center justify-center rounded-2xl border border-line bg-card/80 p-4 text-center shadow-inner sm:p-8">
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    <span className="rounded-full bg-accent-soft px-3 py-1 text-xs font-bold text-accent">
                      감정 분석: {bubbleRecommendation.detectedEmotion} (신뢰도{" "}
                      {bubbleRecommendation.confidenceScore}%)
                    </span>
                    <span className="rounded-full bg-raised px-3 py-1 text-xs font-bold text-fg">
                      추천 말풍선: {bubbleRecommendation.recommendedBubbleShape}
                    </span>
                  </div>

                  {/* Visual Bubble Simulation */}
                  <div
                    className="my-6 max-w-sm rounded-2xl p-5 text-center shadow-md"
                    style={{
                      backgroundColor: bubbleRecommendation.fillColor,
                      borderColor: bubbleRecommendation.strokeColor,
                      borderWidth: `${bubbleRecommendation.strokeWidthPx}px`,
                      borderStyle: bubbleRecommendation.isDashedBorder ? "dashed" : "solid",
                    }}
                  >
                    <p
                      className="text-base"
                      style={{
                        color: bubbleRecommendation.textColor,
                        fontWeight: bubbleRecommendation.recommendedFontWeight,
                      }}
                    >
                      {bubbleRecommendation.dialogue}
                    </p>
                  </div>

                  <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-[0.68rem] text-fg-3">
                    <span>선 두께: {bubbleRecommendation.strokeWidthPx}px</span>
                    <span>폰트 굵기: {bubbleRecommendation.recommendedFontWeight}</span>
                    <span>아이콘: {bubbleRecommendation.suggestedEmoteIcon}</span>
                  </div>
                </div>
              ) : (
                <StudioAiSuiteInputNeeded
                  icon={<MessageCircle size={20} aria-hidden />}
                  description="대사를 입력하면 감정을 읽고 말풍선 모양·선 두께·폰트 굵기를 추천해 드려요."
                />
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );

  return createPortal(content, document.body);
}
