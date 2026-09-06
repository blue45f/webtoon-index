import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  Maximize,
  Palette,
  Pause,
  Play,
  RotateCcw,
  Scissors,
  Search,
  Smartphone,
  Sparkles,
  Timer,
  Type,
  X,
  XCircle,
} from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  STUDIO_EASE,
  STUDIO_FOCUS_RING,
  STUDIO_TOUCH_TARGET,
  StudioEmptyState,
} from "../studio-panel-ui";
import { copyStudioText } from "../studio-workbench-clipboard";
import {
  loadStudioWorkbenchPrefs,
  pickStudioWorkbenchOption,
  saveStudioWorkbenchPrefs,
  studioWorkbenchPrefsStorage,
} from "../studio-workbench-prefs";
import {
  StudioWorkbenchTabStrip,
  studioWorkbenchTabPanelProps,
  type StudioWorkbenchTab,
} from "../studio-workbench-tabs";
import { useStudioModalSheet } from "../useStudioModalSheet";

import {
  WebtoonColorHarmonyAssistant,
  type SkinToneId,
  SCENE_MOOD_PALETTES,
} from "./webtoon-color-harmony-assistant";
import {
  WebtoonCroquisPoseGuide,
  PERSPECTIVE_GUIDES,
  type PerspectiveGuidePreset,
  type CroquisTimerIntervalSec,
} from "./webtoon-croquis-pose-guide";
import {
  WebtoonFocusTimerEngine,
  PRODUCTION_STAGES,
  type PomodoroMode,
  type WebtoonProductionStage,
} from "./webtoon-focus-timer";
import {
  WebtoonPlatformSpecValidator,
  WEBTOON_PLATFORM_SPECS,
  type WebtoonPlatformId,
} from "./webtoon-platform-spec-validator";
import {
  WebtoonScrollPacingSimulator,
  type ReaderScrollSpeedProfile,
} from "./webtoon-scroll-pacing-simulator";
import { WebtoonSfxLexiconEngine, type SfxCategory } from "./webtoon-sfx-lexicon";

import type { ReactNode } from "react";

import { cn } from "@/shared/lib/utils";

export type AssistantActiveTab =
  | "spec-slicer"
  | "scroll-pacing"
  | "sfx-lexicon"
  | "color-harmony"
  | "focus-timer"
  | "croquis-pose";

const TAB_ID_PREFIX = "studio-webtoon-assistant";
const TITLE_ID = `${TAB_ID_PREFIX}-title`;

const ASSISTANT_TABS: readonly StudioWorkbenchTab[] = [
  { id: "spec-slicer", label: "플랫폼 규격 & 슬라이서", icon: Scissors },
  { id: "scroll-pacing", label: "스크롤 페이싱 시뮬레이터", icon: Smartphone },
  { id: "sfx-lexicon", label: "효과음·의성어 사전", icon: Type },
  { id: "color-harmony", label: "피부/그림자 컬러 조화", icon: Palette },
  { id: "focus-timer", label: "마감 & 포커스플로우", icon: Timer },
  { id: "croquis-pose", label: "인체 크로키 & 구도 가이드", icon: Maximize },
];

const ASSISTANT_TAB_IDS = ASSISTANT_TABS.map((tab) => tab.id) as readonly AssistantActiveTab[];
const PLATFORM_IDS = Object.keys(WEBTOON_PLATFORM_SPECS) as readonly WebtoonPlatformId[];
const PRODUCTION_STAGE_IDS = PRODUCTION_STAGES.map(
  (stage) => stage.id,
) as readonly WebtoonProductionStage[];
const SKIN_TONE_IDS: readonly SkinToneId[] = [
  "warm-fair",
  "cool-pale",
  "blush-peach",
  "sun-kissed-tan",
  "dark-rich",
];
const PERSPECTIVE_PRESETS: readonly PerspectiveGuidePreset[] = [
  "eye-level",
  "low-angle",
  "high-angle",
  "dutch-tilt",
];

const POMODORO_MODES: readonly { id: PomodoroMode; label: string }[] = [
  { id: "standard-25", label: "25/5분 표준" },
  { id: "deep-flow-50", label: "50/10분 몰입" },
  { id: "sprint-15", label: "15/3분 스프린트" },
];
const POMODORO_MODE_IDS = POMODORO_MODES.map((mode) => mode.id) as readonly PomodoroMode[];

const READER_SPEED_PROFILES: readonly {
  id: ReaderScrollSpeedProfile;
  label: string;
  hint: string;
}[] = [
  { id: "skimmer", label: "빠른 정주행", hint: "속독 700px/s" },
  { id: "casual", label: "표준 독자", hint: "350px/s" },
  { id: "immersive", label: "작화/대사 몰입", hint: "정독 180px/s" },
];
const READER_SPEED_IDS = READER_SPEED_PROFILES.map(
  (profile) => profile.id,
) as readonly ReaderScrollSpeedProfile[];

const CROQUIS_INTERVALS: readonly CroquisTimerIntervalSec[] = [30, 60, 180];
/** 최소 슬라이스 높이. 0 이 들어가면 planAutoSlices 의 while 루프가 끝나지 않는다. */
const MIN_SLICE_HEIGHT_PX = 1000;

/**
 * 아래 두 묶음은 실제 원고에서 읽어온 값이 아니라 데모용 고정 픽스처다.
 * 화면에서도 "샘플 데이터"라고 명시한다 — 작가가 자기 원고의 분석 결과로 오해하면 안 된다.
 * 실제 문서 배선(studioCanvasSnapshotFromElements) 전까지는 이 표기가 유일한 방어선이다.
 */
const SAMPLE_PROTECTED_REGIONS = [
  { top: 2900, bottom: 3200, label: "인물 얼굴 컷" },
  { top: 6200, bottom: 6600, label: "액션 컷" },
  { top: 9800, bottom: 10200, label: "클리프행어 컷" },
] as const;

const SAMPLE_PANELS = [
  { id: "p1", topY: 100, bottomY: 700, heightPx: 600, dialogueCount: 1 },
  { id: "p2", topY: 850, bottomY: 1400, heightPx: 550, dialogueCount: 2 },
  { id: "p3", topY: 1700, bottomY: 2300, heightPx: 600, dialogueCount: 1 },
  { id: "p4", topY: 2800, bottomY: 3400, heightPx: 600, dialogueCount: 2 },
  { id: "p5", topY: 4200, bottomY: 5000, heightPx: 800, dialogueCount: 1 },
] as const;

function asCroquisInterval(seconds: number): CroquisTimerIntervalSec {
  return seconds === 30 || seconds === 180 ? seconds : 60;
}

function clampSliceHeight(value: number, maxPx: number): number {
  if (!Number.isFinite(value)) return Math.max(MIN_SLICE_HEIGHT_PX, Math.min(10_000, maxPx));
  return Math.round(Math.min(Math.max(value, MIN_SLICE_HEIGHT_PX), Math.max(MIN_SLICE_HEIGHT_PX, maxPx)));
}

/** 픽스처 파생 수치임을 알리는 배지. 경고 토큰을 쓴다 — 신뢰도에 대한 경고이기 때문. */
function SampleDataBadge({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded border border-warn/35 bg-warn/10 px-1.5 py-0.5 text-[0.58rem] font-bold text-warn">
      <AlertTriangle size={11} aria-hidden />
      {children}
    </span>
  );
}

export interface StudioWebtoonAssistantModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly canvasWidth?: number;
  readonly canvasHeight?: number;
  readonly onInsertSfxText?: (text: string) => void;
}

export function StudioWebtoonAssistantModal({
  open,
  onClose,
  canvasWidth = 690,
  canvasHeight = 15000,
  onInsertSfxText,
}: StudioWebtoonAssistantModalProps) {
  // 저장된 선택 상태는 마운트 시 한 번만 읽는다. 화면 카탈로그로 한 번 걸러서
  // 은퇴한 id 가 빈 패널을 만들지 않게 한다(studio-workbench-prefs 계약).
  const [restored] = useState(() => {
    const stored = loadStudioWorkbenchPrefs(studioWorkbenchPrefsStorage()).assistant;
    return {
      activeTab: pickStudioWorkbenchOption(stored.activeTab, ASSISTANT_TAB_IDS, "spec-slicer"),
      platformId: pickStudioWorkbenchOption(stored.platformId, PLATFORM_IDS, "naver-webtoon"),
      readerSpeed: pickStudioWorkbenchOption(stored.readerSpeed, READER_SPEED_IDS, "casual"),
      skinToneId: pickStudioWorkbenchOption(stored.skinToneId, SKIN_TONE_IDS, "warm-fair"),
      focusStage: pickStudioWorkbenchOption(stored.focusStage, PRODUCTION_STAGE_IDS, "storyboard"),
      focusPreset: pickStudioWorkbenchOption(stored.focusPreset, POMODORO_MODE_IDS, "standard-25"),
      croquisIntervalSec: asCroquisInterval(stored.croquisIntervalSec),
    };
  });

  const [activeTab, setActiveTab] = useState<AssistantActiveTab>(restored.activeTab);

  const dialogRef = useRef<HTMLElement | null>(null);
  const rootRef = useRef<HTMLElement | null>(null);

  // Tab 1: Spec & Slicer State
  const specValidator = useMemo(() => new WebtoonPlatformSpecValidator(), []);
  const [selectedPlatform, setSelectedPlatform] = useState<WebtoonPlatformId>(restored.platformId);
  const activeSpec = WEBTOON_PLATFORM_SPECS[selectedPlatform];
  const [sliceTargetHeight, setSliceTargetHeight] = useState(() =>
    clampSliceHeight(
      WEBTOON_PLATFORM_SPECS[restored.platformId].recommendedSliceHeightPx,
      WEBTOON_PLATFORM_SPECS[restored.platformId].maxSliceHeightPx,
    ),
  );
  const auditResult = useMemo(
    () =>
      // 캔버스 크기와 내보내기 포맷만 넘긴다. 예전에는 발명한 컷 간격 배열([150…800])까지
      // 넘겼는데, 리터럴 800px 이 webtoon-canvas 의 maxGutterPx 600 을 항상 넘겨서 그
      // 플랫폼에서는 "컷 간격이 너무 넓다" 경고가 무조건 떴다. 감사는 실제 사실만 본다.
      specValidator.audit(selectedPlatform, {
        width: canvasWidth,
        height: canvasHeight,
        format: "jpg",
      }),
    [specValidator, selectedPlatform, canvasWidth, canvasHeight],
  );
  const slicePlan = useMemo(
    () => specValidator.planAutoSlices(canvasHeight, sliceTargetHeight, SAMPLE_PROTECTED_REGIONS),
    [specValidator, canvasHeight, sliceTargetHeight],
  );

  // Tab 2: Scroll Pacing State
  const scrollSimulator = useMemo(() => new WebtoonScrollPacingSimulator(), []);
  const samplePanels = useMemo(() => SAMPLE_PANELS.map((panel) => ({ ...panel })), []);
  const pacingResult = useMemo(
    () => scrollSimulator.analyze(samplePanels, canvasHeight),
    [scrollSimulator, samplePanels, canvasHeight],
  );
  const [readerSpeed, setReaderSpeed] = useState<ReaderScrollSpeedProfile>(restored.readerSpeed);
  const activeReaderProfile =
    READER_SPEED_PROFILES.find((profile) => profile.id === readerSpeed) ?? READER_SPEED_PROFILES[1];

  // Tab 3: SFX Lexicon State
  const sfxEngine = useMemo(() => new WebtoonSfxLexiconEngine(), []);
  const [sfxQuery, setSfxQuery] = useState("");
  const [sfxCategory, setSfxCategory] = useState<SfxCategory | "all">("all");
  const filteredSfx = useMemo(
    () => sfxEngine.search(sfxQuery, sfxCategory === "all" ? undefined : sfxCategory),
    [sfxEngine, sfxQuery, sfxCategory],
  );
  const [sfxCopyResult, setSfxCopyResult] = useState<{ id: string; ok: boolean } | null>(null);
  const sfxCopyResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Tab 4: Color Harmony State
  const colorAssistant = useMemo(() => new WebtoonColorHarmonyAssistant(), []);
  const [selectedSkinTone, setSelectedSkinTone] = useState<SkinToneId>(restored.skinToneId);
  const [customBaseColor, setCustomBaseColor] = useState(
    () => colorAssistant.getSkinPalette(restored.skinToneId).base,
  );
  const generatedShadows = useMemo(
    () => colorAssistant.generateHueShiftShadow(customBaseColor),
    [colorAssistant, customBaseColor],
  );

  // Tab 5: Focus Timer State
  const [timerEngine] = useState(
    () => new WebtoonFocusTimerEngine(restored.focusStage, restored.focusPreset),
  );
  const [timerState, setTimerState] = useState(() => timerEngine.getState());

  /**
   * 마감 타이머는 모달이 닫혀도 계속 돈다 — 의도된 선택이다.
   * 이 타이머는 "공정별 실작업 시간"을 적립하는 마감 추적기다. 작가는 타이머를 켠 뒤
   * 보조 센터를 닫고 캔버스로 돌아가서 그린다. 닫을 때 멈추면 정확히 작업 중인 시간만
   * 빠져 기록이 항상 0 에 수렴한다. (크로키 메트로놈은 반대 — 아래 참조.)
   * 호스트가 이 모달을 상시 마운트하므로 닫힌 동안에도 컴포넌트 인스턴스는 살아 있다.
   */
  useEffect(() => {
    if (!timerState.isRunning) return;
    const interval = setInterval(() => {
      timerEngine.tick(1);
      setTimerState(timerEngine.getState());
    }, 1000);
    return () => clearInterval(interval);
  }, [timerEngine, timerState.isRunning]);

  // Tab 6: Croquis Pose Guide State
  const croquisGuide = useMemo(() => new WebtoonCroquisPoseGuide(), []);
  const [selectedPerspective, setSelectedPerspective] =
    useState<PerspectiveGuidePreset>("eye-level");
  const [croquisInterval, setCroquisInterval] = useState<CroquisTimerIntervalSec>(
    restored.croquisIntervalSec,
  );
  const [croquisSecondsRemaining, setCroquisSecondsRemaining] = useState<number>(
    restored.croquisIntervalSec,
  );
  const croquisRemainingRef = useRef<number>(restored.croquisIntervalSec);
  const [croquisRunning, setCroquisRunning] = useState(false);
  const [currentPosePrompt, setCurrentPosePrompt] = useState(() => croquisGuide.getRandomPose(1));

  /**
   * 크로키 메트로놈은 모달이 닫히면 반드시 멈춘다 — 보이지 않는 포즈 프롬프트를 넘겨봐야
   * 훈련이 되지 않고, 닫힌 창이 1초마다 상태만 갈아엎는다.
   * 남은 초는 ref 로 추적하고 setState 업데이터 안에서는 어떤 부수효과도 일으키지 않는다.
   * (업데이터는 순수해야 하며 StrictMode 는 이를 두 번 호출한다 — 예전 구현은 그래서
   *  포즈가 한 번에 두 칸씩 넘어갔다.)
   */
  useEffect(() => {
    if (!open || !croquisRunning) return;
    const interval = setInterval(() => {
      const next = croquisRemainingRef.current - 1;
      const value = next > 0 ? next : croquisInterval;
      croquisRemainingRef.current = value;
      setCroquisSecondsRemaining(value);
      if (next <= 0) setCurrentPosePrompt(croquisGuide.getRandomPose(Date.now()));
    }, 1000);
    return () => clearInterval(interval);
  }, [open, croquisRunning, croquisInterval, croquisGuide]);

  // 모달 계약: 포커스 트랩 · Escape · 포커스 복귀 · 배경 inert 를 레포 공용 훅에 위임한다.
  // root 는 body — 포털 컨테이너를 root 로 두면 배경(앱 루트)이 inert 처리되지 않는다.
  useLayoutEffect(() => {
    rootRef.current = typeof document === "undefined" ? null : document.body;
  }, []);
  useStudioModalSheet({
    activeKey: open ? "studio-webtoon-assistant" : null,
    dialogRef,
    onDismiss: onClose,
    resolveInitialFocus: (dialog) => dialog.querySelector<HTMLElement>("[data-autofocus='true']"),
    rootRef,
  });

  // 배경 스크롤 잠금(StudioAnimaticTimelineDialog 규범).
  useEffect(() => {
    if (!open || typeof document === "undefined") return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  // 복사 상태 리셋 타이머는 언마운트 때 반드시 정리한다.
  useEffect(
    () => () => {
      if (sfxCopyResetRef.current) clearTimeout(sfxCopyResetRef.current);
    },
    [],
  );

  // 열려 있는 동안에만 저장한다. aiSuite 구역은 형제 모달이 같은 키에 쓰므로
  // 읽고-병합-쓰기로 남의 구역을 덮어쓰지 않는다.
  useEffect(() => {
    if (!open) return;
    const storage = studioWorkbenchPrefsStorage();
    if (!storage) return;
    const current = loadStudioWorkbenchPrefs(storage);
    saveStudioWorkbenchPrefs(storage, {
      ...current,
      assistant: {
        ...current.assistant,
        activeTab,
        platformId: selectedPlatform,
        readerSpeed,
        skinToneId: selectedSkinTone,
        focusStage: timerState.activeStage,
        focusPreset: timerState.pomodoroMode,
        croquisIntervalSec: croquisInterval,
      },
    });
  }, [
    open,
    activeTab,
    selectedPlatform,
    readerSpeed,
    selectedSkinTone,
    timerState.activeStage,
    timerState.pomodoroMode,
    croquisInterval,
  ]);

  function resetCroquisCountdown(seconds: number) {
    croquisRemainingRef.current = seconds;
    setCroquisSecondsRemaining(seconds);
  }

  async function handleCopySfx(id: string, text: string) {
    const ok = await copyStudioText(text);
    setSfxCopyResult({ id, ok });
    if (sfxCopyResetRef.current) clearTimeout(sfxCopyResetRef.current);
    sfxCopyResetRef.current = setTimeout(() => setSfxCopyResult(null), ok ? 1500 : 2600);
  }

  if (!open || typeof document === "undefined") return null;

  const perspectiveGuide = PERSPECTIVE_GUIDES[selectedPerspective];
  const cardClass = "rounded-xl border border-line bg-card/60 p-3";
  const chipClass = cn(
    "inline-flex items-center justify-center rounded-lg border px-2.5 text-[0.65rem] font-bold",
    STUDIO_EASE,
    STUDIO_FOCUS_RING,
    STUDIO_TOUCH_TARGET,
  );

  return createPortal(
    <div
      data-studio-webtoon-assistant-dialog="true"
      className="fixed inset-0 z-[120] flex items-end justify-center p-0 sm:items-center sm:p-4"
    >
      <button
        type="button"
        aria-hidden="true"
        data-studio-modal-backdrop="true"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-canvas/80 backdrop-blur-sm"
      />
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={TITLE_ID}
        data-testid="studio-webtoon-assistant-modal"
        data-studio-shortcut-boundary="true"
        tabIndex={-1}
        className={cn(
          "relative z-10 flex max-h-[100dvh] w-full flex-col overflow-hidden",
          "border border-line-strong bg-card text-fg shadow-2xl",
          "sm:max-h-[calc(100dvh-2rem)] sm:w-[min(96vw,56rem)] sm:rounded-2xl",
        )}
      >
        {/* Modal Header */}
        <header className="flex shrink-0 items-start justify-between gap-2 border-b border-line bg-raised px-3 py-2.5 sm:px-4 sm:py-3">
          <div className="flex min-w-0 items-center gap-2">
            <Sparkles className="size-5 shrink-0 text-accent" aria-hidden />
            <div className="min-w-0">
              <h2 id={TITLE_ID} className="text-sm font-bold text-fg">
                웹툰 창작 보조 센터 (Webtoon Creator Assistant)
              </h2>
              <p className="text-[0.68rem] text-fg-3">
                플랫폼 규격 검사 · 자동 슬라이서 · 스크롤 페이싱 · 효과음 사전 · 컬러 조화 · 포커스 타이머 · 크로키
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            data-autofocus="true"
            aria-label="보조 센터 닫기"
            className={cn(
              "inline-flex shrink-0 items-center justify-center rounded-lg px-2 text-fg-3",
              "hover:bg-card hover:text-fg",
              STUDIO_EASE,
              STUDIO_FOCUS_RING,
              STUDIO_TOUCH_TARGET,
            )}
          >
            <X className="size-4" aria-hidden />
          </button>
        </header>

        {/* Modal Tabs Rail */}
        <div className="shrink-0 border-b border-line bg-card/60 px-2 py-1">
          <StudioWorkbenchTabStrip
            tabs={ASSISTANT_TABS}
            activeId={activeTab}
            onSelect={(id) => setActiveTab(id as AssistantActiveTab)}
            ariaLabel="웹툰 보조 도구"
            idPrefix={TAB_ID_PREFIX}
          />
        </div>

        {/* Modal Body Content */}
        <div
          {...studioWorkbenchTabPanelProps(TAB_ID_PREFIX, activeTab)}
          className={cn(
            "flex-1 overflow-y-auto overscroll-contain p-3 text-xs text-fg sm:p-4",
            STUDIO_FOCUS_RING,
          )}
        >
          {/* TAB 1: Platform Spec & Auto Slicer */}
          {activeTab === "spec-slicer" && (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {PLATFORM_IDS.map((pid) => {
                  const spec = WEBTOON_PLATFORM_SPECS[pid];
                  const isSelected = selectedPlatform === pid;
                  return (
                    <button
                      key={pid}
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() => {
                        setSelectedPlatform(pid);
                        setSliceTargetHeight(
                          clampSliceHeight(spec.recommendedSliceHeightPx, spec.maxSliceHeightPx),
                        );
                      }}
                      className={cn(
                        "flex flex-col rounded-xl border p-2.5 text-left",
                        STUDIO_EASE,
                        STUDIO_FOCUS_RING,
                        STUDIO_TOUCH_TARGET,
                        isSelected
                          ? "border-accent bg-accent-soft text-accent shadow-sm"
                          : "border-line bg-card text-fg hover:bg-raised",
                      )}
                    >
                      <span className="font-bold">{spec.name}</span>
                      <span className="text-[0.65rem] text-fg-3">
                        가로 {spec.recommendedWidthPx}px · 세로 최대{" "}
                        {spec.maxSliceHeightPx.toLocaleString()}px
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Audit Status Card */}
              <div
                className={cn(
                  "flex items-start gap-3 rounded-xl border p-3.5",
                  auditResult.overallGrade === "pass"
                    ? "border-good/35 bg-good/10 text-good"
                    : auditResult.overallGrade === "warn"
                      ? "border-warn/40 bg-warn/10 text-warn"
                      : "border-bad/40 bg-bad/10 text-bad",
                )}
              >
                {auditResult.overallGrade === "pass" ? (
                  <CheckCircle2 className="size-5 shrink-0" aria-hidden />
                ) : auditResult.overallGrade === "warn" ? (
                  <AlertTriangle className="size-5 shrink-0" aria-hidden />
                ) : (
                  <XCircle className="size-5 shrink-0" aria-hidden />
                )}
                <div className="flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-1">
                    <span className="text-[0.8rem] font-bold">{auditResult.summary}</span>
                    <span className="font-mono text-[0.68rem] text-fg-3">
                      현재 캔버스 {canvasWidth}px × {canvasHeight.toLocaleString()}px · JPG 내보내기 기준
                    </span>
                  </div>
                  {auditResult.issues.length > 0 && (
                    <ul className="mt-2 flex flex-col gap-1 text-[0.68rem]">
                      {auditResult.issues.map((issue, idx) => (
                        <li key={idx} className="flex flex-col">
                          <span className="font-semibold">• {issue.message}</span>
                          <span className="pl-2 text-fg-3">↳ 권장 조치: {issue.recommendation}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              {/* Auto Slicer Plan (ToonSlicer-inspired) */}
              <div className={cn("flex flex-col gap-2 p-3.5", cardClass)}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 font-bold">
                    <Scissors className="size-4 text-accent" aria-hidden />
                    <span>ToonSlicer 컷 안전 분할 계획 (Auto Slice Plan)</span>
                  </div>
                  <span className="rounded bg-accent/20 px-2 py-0.5 font-mono text-[0.68rem] font-bold text-accent">
                    안전 분할 성공률 {slicePlan.safeSplitSuccessRate}%
                  </span>
                </div>
                <p className="text-[0.65rem] text-fg-3">
                  인물 얼굴, 대사 말풍선, 컷 테두리가 절단되지 않도록 컷 사이 빈 여백(Gutter)을 자동 감지하여 분할합니다.
                </p>

                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-card p-2">
                  <label
                    htmlFor="studio-assistant-slice-height"
                    className="text-[0.68rem] font-semibold text-fg-2"
                  >
                    분할 목표 높이
                  </label>
                  <input
                    id="studio-assistant-slice-height"
                    type="range"
                    min={MIN_SLICE_HEIGHT_PX}
                    max={Math.max(MIN_SLICE_HEIGHT_PX, activeSpec.maxSliceHeightPx)}
                    step={100}
                    value={sliceTargetHeight}
                    onChange={(event) =>
                      setSliceTargetHeight(
                        clampSliceHeight(Number(event.target.value), activeSpec.maxSliceHeightPx),
                      )
                    }
                    className={cn(
                      "h-6 min-w-32 flex-1 cursor-pointer accent-accent pointer-coarse:h-11",
                      STUDIO_FOCUS_RING,
                    )}
                  />
                  <span className="font-mono text-[0.68rem] font-bold text-fg">
                    {sliceTargetHeight.toLocaleString()}px · {slicePlan.sliceCount}개 파일
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setSliceTargetHeight(
                        clampSliceHeight(
                          activeSpec.recommendedSliceHeightPx,
                          activeSpec.maxSliceHeightPx,
                        ),
                      )
                    }
                    className={cn(chipClass, "border-line bg-raised text-fg hover:bg-card")}
                  >
                    권장값 {activeSpec.recommendedSliceHeightPx.toLocaleString()}px
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <SampleDataBadge>샘플 보호 영역 {SAMPLE_PROTECTED_REGIONS.length}곳 기준 예시</SampleDataBadge>
                  <span className="text-[0.6rem] text-fg-3">
                    실제 원고의 컷 좌표가 아직 연결되지 않아 성공률과 절단 위치는 예시 값입니다.
                  </span>
                </div>

                <div className="mt-1 grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                  {slicePlan.slices.map((slice) => (
                    <div
                      key={slice.sliceIndex}
                      className="flex items-center justify-between gap-2 rounded-lg border border-line bg-card p-2 text-[0.68rem]"
                    >
                      <div className="flex min-w-0 flex-col">
                        <span className="font-bold">
                          #{slice.sliceIndex} 파일 ({slice.heightPx.toLocaleString()}px)
                        </span>
                        <span className="font-mono text-[0.62rem] text-fg-3">
                          Y: {slice.topY.toLocaleString()} ~ {slice.bottomY.toLocaleString()}
                        </span>
                      </div>
                      <span
                        className={cn(
                          "shrink-0 rounded px-1.5 py-0.5 text-[0.6rem] font-bold",
                          slice.isGutterCut ? "bg-good/10 text-good" : "bg-warn/10 text-warn",
                        )}
                      >
                        {slice.isGutterCut ? "안전 여백 절단" : "비여백 절단"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: Scroll Pacing Simulator */}
          {activeTab === "scroll-pacing" && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <SampleDataBadge>샘플 컷 {SAMPLE_PANELS.length}개 기준 예시</SampleDataBadge>
                <span className="text-[0.6rem] text-fg-3">
                  아래 점수·시간·호흡 분석은 데모용 컷 배치를 분석한 결과입니다. 실제 원고 배선 전까지는 참고용으로만 보세요.
                </span>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="flex flex-col items-center justify-center rounded-xl border border-line bg-card/60 p-3 text-center">
                  <span className="text-[0.68rem] text-fg-3">페이싱 건강도 점수</span>
                  <span className="mt-1 font-mono text-2xl font-black text-accent">
                    {pacingResult.pacingHealthScore}점
                  </span>
                </div>
                <div className="flex flex-col items-center justify-center rounded-xl border border-line bg-card/60 p-3 text-center">
                  <span className="text-[0.68rem] text-fg-3">평균 컷 간격</span>
                  <span className="mt-1 font-mono text-2xl font-black text-fg">
                    {pacingResult.averageGutterPx}px
                  </span>
                </div>
                <div className="flex flex-col items-center justify-center rounded-xl border border-line bg-card/60 p-3 text-center">
                  <span className="text-[0.68rem] text-fg-3">
                    {activeReaderProfile.label} 완독 예상 시간
                  </span>
                  <span className="mt-1 font-mono text-2xl font-black text-fg">
                    약 {pacingResult.estimatedReadingSeconds[readerSpeed]}초
                  </span>
                </div>
              </div>

              {pacingResult.warnings.length > 0 && (
                <ul className="flex flex-col gap-1.5">
                  {pacingResult.warnings.map((warning) => (
                    <li
                      key={warning}
                      className="flex items-start gap-2 rounded-lg border border-warn/35 bg-warn/10 p-2 text-[0.68rem] text-warn"
                    >
                      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                      <span>{warning}</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-[0.65rem] text-fg-3">{pacingResult.summary}</p>

              {/* Reading Profile Comparison */}
              <div className={cardClass}>
                <span className="text-[0.75rem] font-bold">독자 독서 성향별 체감 시간</span>
                <div
                  role="group"
                  aria-label="독자 독서 성향"
                  className="mt-2 grid grid-cols-1 gap-2 text-center text-[0.68rem] sm:grid-cols-3"
                >
                  {READER_SPEED_PROFILES.map((profile) => {
                    const isSelected = readerSpeed === profile.id;
                    return (
                      <button
                        key={profile.id}
                        type="button"
                        aria-pressed={isSelected}
                        onClick={() => setReaderSpeed(profile.id)}
                        className={cn(
                          "flex flex-col items-center justify-center rounded-lg border p-2",
                          STUDIO_EASE,
                          STUDIO_FOCUS_RING,
                          STUDIO_TOUCH_TARGET,
                          isSelected
                            ? "border-accent/40 bg-accent-soft text-accent"
                            : "border-line bg-card text-fg-3 hover:bg-raised hover:text-fg",
                        )}
                      >
                        <span className={cn("font-bold", isSelected ? "text-accent" : undefined)}>
                          {profile.label} ({profile.hint})
                        </span>
                        <span
                          className={cn(
                            "mt-1 font-mono font-black",
                            isSelected ? "text-accent" : "text-fg",
                          )}
                        >
                          {pacingResult.estimatedReadingSeconds[profile.id]}초
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Pacing Beat Visual Breakdown */}
              <div className={cn("flex flex-col gap-2", cardClass)}>
                <span className="text-[0.75rem] font-bold">컷 구간별 호흡 &amp; 리듬 분석</span>
                <div className="flex flex-col gap-1.5">
                  {pacingResult.beats.map((beat, idx) => (
                    <div
                      key={idx}
                      className="flex flex-col gap-1 rounded-lg border border-line bg-card p-2 text-[0.68rem] sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded bg-raised px-1.5 py-0.5 font-mono text-[0.6rem] font-bold">
                          #{beat.fromPanelIndex} → #{beat.toPanelIndex}
                        </span>
                        <span className="font-bold text-fg">{beat.label}</span>
                        <span className="text-fg-3">({beat.gutterDistancePx}px)</span>
                      </div>
                      <span className="text-[0.62rem] text-fg-3">{beat.guidance}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: SFX Lexicon */}
          {activeTab === "sfx-lexicon" && (
            <div className="flex flex-col gap-3">
              {/* Category Filter Pills & Search */}
              <div className="flex flex-col gap-2 rounded-xl border border-line bg-card/60 p-2.5">
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                  {[{ id: "all", label: "전체 효과음" }, ...sfxEngine.listCategories()].map((cat) => (
                    <button
                      key={cat.id}
                      type="button"
                      aria-pressed={sfxCategory === cat.id}
                      onClick={() => setSfxCategory(cat.id as SfxCategory | "all")}
                      className={cn(
                        chipClass,
                        "whitespace-nowrap",
                        sfxCategory === cat.id
                          ? "border-accent/50 bg-accent text-on-accent shadow-sm"
                          : "border-line bg-card text-fg-3 hover:text-fg",
                      )}
                    >
                      {cat.label}
                    </button>
                  ))}
                </div>

                <div className="relative">
                  <Search
                    className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg-3"
                    aria-hidden
                  />
                  <input
                    type="search"
                    value={sfxQuery}
                    onChange={(e) => setSfxQuery(e.target.value)}
                    aria-label="효과음 검색"
                    placeholder="상황별 의성어·의태어 검색 (예: 쿵, 쾅, 심장, 번개, 문, 폭발)..."
                    className={cn(
                      "w-full rounded-md border border-line bg-card pl-8 pr-3 text-xs text-fg",
                      STUDIO_FOCUS_RING,
                      STUDIO_TOUCH_TARGET,
                    )}
                  />
                </div>

                <p aria-live="polite" className="text-[0.62rem] text-fg-3">
                  검색 결과 {filteredSfx.length}건
                </p>
              </div>

              {/* SFX Cards Grid */}
              {filteredSfx.length === 0 ? (
                <StudioEmptyState
                  icon={<Search size={20} aria-hidden />}
                  title="검색 결과가 없습니다"
                  description="카테고리를 '전체 효과음'으로 바꾸거나 다른 낱말로 찾아보세요."
                  action={
                    <button
                      type="button"
                      onClick={() => {
                        setSfxQuery("");
                        setSfxCategory("all");
                      }}
                      className={cn(chipClass, "border-line bg-raised text-fg hover:bg-card")}
                    >
                      검색 조건 초기화
                    </button>
                  }
                />
              ) : (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {filteredSfx.map((item) => {
                    const copyResult =
                      sfxCopyResult?.id === item.id ? sfxCopyResult : null;
                    return (
                      <div
                        key={item.id}
                        className={cn(
                          "flex flex-col justify-between rounded-xl border border-line bg-card p-3",
                          STUDIO_EASE,
                          "hover:border-accent/40",
                        )}
                      >
                        <div>
                          <div className="flex items-center justify-between gap-2">
                            <span
                              className="text-xl font-black tracking-tight"
                              style={{
                                color: item.recommendedColor,
                                textShadow: `0 0 1px ${item.strokeColor}, 1px 1px 0 ${item.strokeColor}`,
                              }}
                            >
                              {item.text}
                            </span>
                            <span className="shrink-0 rounded bg-raised px-1.5 py-0.5 text-[0.6rem] font-bold text-fg-3">
                              {item.categoryLabel}
                            </span>
                          </div>
                          <p className="mt-1.5 text-[0.65rem] text-fg-2">{item.meaning}</p>
                          <div className="mt-2 flex flex-wrap gap-1">
                            {item.tags.map((t) => (
                              <span
                                key={t}
                                className="rounded bg-line/50 px-1 text-[0.58rem] text-fg-3"
                              >
                                #{t}
                              </span>
                            ))}
                          </div>
                        </div>

                        <div className="mt-3 flex items-center gap-1.5 border-t border-line/60 pt-2">
                          <button
                            type="button"
                            onClick={() => {
                              void handleCopySfx(item.id, item.text);
                            }}
                            className={cn(
                              chipClass,
                              "flex-1 gap-1",
                              copyResult && !copyResult.ok
                                ? "border-bad/40 bg-bad/10 text-bad"
                                : "border-line bg-raised text-fg hover:bg-card",
                            )}
                          >
                            {copyResult ? (
                              copyResult.ok ? (
                                <Check className="size-3 text-good" aria-hidden />
                              ) : (
                                <XCircle className="size-3" aria-hidden />
                              )
                            ) : (
                              <Copy className="size-3" aria-hidden />
                            )}
                            <span>
                              {copyResult ? (copyResult.ok ? "복사됨" : "복사 실패") : "텍스트 복사"}
                            </span>
                          </button>
                          {onInsertSfxText && (
                            <button
                              type="button"
                              onClick={() => onInsertSfxText(item.text)}
                              className={cn(
                                chipClass,
                                "gap-1 border-transparent bg-accent text-on-accent shadow-sm hover:opacity-90",
                              )}
                            >
                              <Type className="size-3" aria-hidden />
                              <span>캔버스 삽입</span>
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* TAB 4: Color Harmony & Skin Palette */}
          {activeTab === "color-harmony" && (
            <div className="flex flex-col gap-4">
              {/* 5 Skin Tone Archetypes */}
              <div className={cn("flex flex-col gap-2", cardClass)}>
                <span className="text-[0.75rem] font-bold">웹툰 캐릭터 5대 표준 피부톤 팔레트</span>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {SKIN_TONE_IDS.map((sid) => {
                    const pal = colorAssistant.getSkinPalette(sid);
                    const isSelected = selectedSkinTone === sid;
                    return (
                      <button
                        key={sid}
                        type="button"
                        aria-pressed={isSelected}
                        onClick={() => {
                          setSelectedSkinTone(sid);
                          setCustomBaseColor(pal.base);
                        }}
                        className={cn(
                          "flex flex-col rounded-xl border p-2.5 text-left",
                          STUDIO_EASE,
                          STUDIO_FOCUS_RING,
                          STUDIO_TOUCH_TARGET,
                          isSelected
                            ? "border-accent bg-accent-soft text-accent shadow-sm"
                            : "border-line bg-card text-fg hover:bg-raised",
                        )}
                      >
                        <span className="text-[0.7rem] font-bold">{pal.name}</span>
                        <span className="mt-0.5 text-[0.62rem] text-fg-3">{pal.description}</span>
                        <div className="mt-2 flex h-5 w-full overflow-hidden rounded-md border border-line">
                          <div className="flex-1" style={{ backgroundColor: pal.highlight }} title="하이라이트" />
                          <div className="flex-1" style={{ backgroundColor: pal.base }} title="기본 밑색" />
                          <div className="flex-1" style={{ backgroundColor: pal.shadow1 }} title="1차 셀 음영" />
                          <div className="flex-1" style={{ backgroundColor: pal.shadow2 }} title="2차 딥 음영" />
                          <div className="flex-1" style={{ backgroundColor: pal.blushTint }} title="볼터치 틴트" />
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Algorithmic Hue-Shift Shadow Generator */}
              <div className={cn("flex flex-col gap-2 p-3.5", cardClass)}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 font-bold">
                    <Palette className="size-4 text-accent" aria-hidden />
                    <span>만화 색상환 쿨톤 음영 자동 생성기 (Hue-Shift Shadow Generator)</span>
                  </div>
                  <span className="rounded bg-accent/20 px-2 py-0.5 text-[0.62rem] font-bold text-accent">
                    탁한 회색 방지 (Anti-Muddy)
                  </span>
                </div>
                <p className="text-[0.65rem] text-fg-3">
                  기본 밑색을 기준으로 채도를 올리고 색상환을 파랑/보라 방향으로 자연스럽게 회전시켜 맑은 그림자를 생성합니다.
                </p>

                <div className="mt-2 flex items-center gap-2">
                  <label
                    htmlFor="studio-assistant-base-color"
                    className="text-[0.68rem] font-semibold text-fg-2"
                  >
                    밑색 선택
                  </label>
                  <input
                    id="studio-assistant-base-color"
                    type="color"
                    value={customBaseColor}
                    onChange={(e) => setCustomBaseColor(e.target.value)}
                    className={cn(
                      "w-14 cursor-pointer rounded border border-line bg-card",
                      STUDIO_FOCUS_RING,
                      STUDIO_TOUCH_TARGET,
                    )}
                  />
                  <span className="font-mono text-[0.68rem] font-bold">{customBaseColor}</span>
                </div>

                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {[
                    { label: "하이라이트", value: generatedShadows.highlight },
                    { label: "기본 밑색", value: customBaseColor },
                    { label: "1차 셀 음영 (+25° 쉬프트)", value: generatedShadows.shadow1 },
                    { label: "2차 딥 음영 (+40° 쉬프트)", value: generatedShadows.shadow2 },
                  ].map((swatch) => (
                    <div
                      key={swatch.label}
                      className="flex flex-col rounded-lg border border-line bg-card p-2 text-center"
                    >
                      <span className="text-[0.62rem] text-fg-3">{swatch.label}</span>
                      <div
                        className="my-1.5 h-6 w-full rounded border border-line/40"
                        style={{ backgroundColor: swatch.value }}
                      />
                      <span className="font-mono text-[0.62rem] font-bold">{swatch.value}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* 4 Scene Mood Palettes */}
              <div className={cn("flex flex-col gap-2", cardClass)}>
                <span className="text-[0.75rem] font-bold">장르별 조명 및 환경 무드 팔레트</span>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {SCENE_MOOD_PALETTES.map((mood) => (
                    <div
                      key={mood.id}
                      className="rounded-lg border border-line bg-card p-2 text-[0.68rem]"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-fg">{mood.name}</span>
                        <span className="text-[0.6rem] text-fg-3">{mood.genre}</span>
                      </div>
                      <div className="mt-1.5 flex h-4 w-full overflow-hidden rounded border border-line">
                        <div className="flex-1" style={{ backgroundColor: mood.skyTint }} title="하늘" />
                        <div className="flex-1" style={{ backgroundColor: mood.ambientLight }} title="환경광" />
                        <div className="flex-1" style={{ backgroundColor: mood.directSun }} title="태양광" />
                        <div className="flex-1" style={{ backgroundColor: mood.shadowCast }} title="그림자" />
                        <div className="flex-1" style={{ backgroundColor: mood.rimLight }} title="림라이트" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 5: FocusFlow Pomodoro Timer */}
          {activeTab === "focus-timer" && (
            <div className="flex flex-col gap-4">
              {/* Production Stages Selector */}
              <div className={cn("flex flex-col gap-2", cardClass)}>
                <span className="text-[0.75rem] font-bold">현재 작업 공정 선택</span>
                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-6">
                  {PRODUCTION_STAGES.map((st) => {
                    const isSelected = timerState.activeStage === st.id;
                    return (
                      <button
                        key={st.id}
                        type="button"
                        aria-pressed={isSelected}
                        onClick={() => {
                          timerEngine.setStage(st.id);
                          setTimerState(timerEngine.getState());
                        }}
                        className={cn(
                          "flex flex-col items-center justify-center rounded-lg border p-2 text-center",
                          STUDIO_EASE,
                          STUDIO_FOCUS_RING,
                          STUDIO_TOUCH_TARGET,
                          isSelected
                            ? "border-accent bg-accent-soft font-bold text-accent shadow-sm"
                            : "border-line bg-card text-fg-3 hover:text-fg",
                        )}
                      >
                        <span className="text-[0.68rem]">{st.label}</span>
                        <span className="mt-0.5 font-mono text-[0.6rem]">
                          {Math.floor(timerState.stageSecondsMap[st.id] / 60)}분 기록
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Main Timer Display */}
              <div className="flex flex-col items-center justify-center rounded-2xl border border-line bg-card/70 p-6 text-center shadow-inner">
                <span
                  className={cn(
                    "rounded-full px-2.5 py-0.5 text-[0.68rem] font-bold",
                    timerState.isResting ? "bg-warn/10 text-warn" : "bg-good/10 text-good",
                  )}
                >
                  {timerState.isResting ? "휴식 시간 (Rest Cycle)" : "집중 작업 중 (Focus Mode)"}
                </span>

                <div className="my-3 font-mono text-5xl font-black tracking-wider text-fg">
                  {String(Math.floor(timerState.currentSecondsRemaining / 60)).padStart(2, "0")}:
                  {String(timerState.currentSecondsRemaining % 60).padStart(2, "0")}
                </div>

                <div className="flex flex-wrap items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (timerState.isRunning) {
                        timerEngine.pause();
                      } else {
                        timerEngine.start();
                      }
                      setTimerState(timerEngine.getState());
                    }}
                    className={cn(
                      chipClass,
                      "gap-1.5 border-transparent bg-accent px-4 text-xs text-on-accent shadow-sm hover:opacity-90",
                    )}
                  >
                    {timerState.isRunning ? (
                      <Pause className="size-4" aria-hidden />
                    ) : (
                      <Play className="size-4" aria-hidden />
                    )}
                    <span>{timerState.isRunning ? "일시정지" : "타이머 시작"}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      timerEngine.setPomodoroMode(timerState.pomodoroMode);
                      setTimerState(timerEngine.getState());
                    }}
                    className={cn(chipClass, "gap-1 border-line bg-raised px-3 text-xs text-fg hover:bg-card")}
                  >
                    <RotateCcw className="size-3.5" aria-hidden />
                    <span>리셋</span>
                  </button>
                </div>

                {/* Pomodoro Mode Pills */}
                <div className="mt-4 flex flex-wrap justify-center gap-1.5">
                  {POMODORO_MODES.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      aria-pressed={timerState.pomodoroMode === m.id}
                      onClick={() => {
                        timerEngine.setPomodoroMode(m.id);
                        setTimerState(timerEngine.getState());
                      }}
                      className={cn(
                        chipClass,
                        timerState.pomodoroMode === m.id
                          ? "border-line bg-raised text-fg"
                          : "border-transparent text-fg-3 hover:text-fg",
                      )}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>

                <p className="mt-3 max-w-[38ch] text-[0.6rem] leading-relaxed text-fg-3">
                  타이머는 보조 센터를 닫아도 계속 흘러 공정별 작업 시간을 적립합니다.
                </p>
              </div>
            </div>
          )}

          {/* TAB 6: Croquis & Perspective Pose Guide */}
          {activeTab === "croquis-pose" && (
            <div className="flex flex-col gap-4">
              {/* Croquis Timer Bar */}
              <div className={cn("flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between", cardClass)}>
                <div className="flex flex-wrap items-center gap-2">
                  <Timer className="size-4 text-accent" aria-hidden />
                  <span className="text-[0.75rem] font-bold">인체 크로키 인터벌 트레이닝</span>
                  <div className="flex gap-1">
                    {CROQUIS_INTERVALS.map((sec) => (
                      <button
                        key={sec}
                        type="button"
                        aria-pressed={croquisInterval === sec}
                        onClick={() => {
                          setCroquisInterval(sec);
                          resetCroquisCountdown(sec);
                        }}
                        className={cn(
                          chipClass,
                          "font-mono",
                          croquisInterval === sec
                            ? "border-accent/50 bg-accent text-on-accent"
                            : "border-line bg-card text-fg-3 hover:text-fg",
                        )}
                      >
                        {sec}초
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-base font-black text-accent">
                    {croquisSecondsRemaining}s
                  </span>
                  <button
                    type="button"
                    aria-pressed={croquisRunning}
                    onClick={() => setCroquisRunning((running) => !running)}
                    className={cn(
                      chipClass,
                      "border-transparent bg-accent text-on-accent hover:opacity-90",
                    )}
                  >
                    {croquisRunning ? "정지" : "시작"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCurrentPosePrompt(croquisGuide.getRandomPose(Date.now()));
                      resetCroquisCountdown(croquisInterval);
                    }}
                    className={cn(chipClass, "border-line bg-card text-fg hover:bg-raised")}
                  >
                    다음 포즈
                  </button>
                </div>
              </div>

              {/* Active Pose Prompt Card */}
              <div className="rounded-xl border border-accent/40 bg-accent-soft p-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[0.8rem] font-bold text-accent">
                    추천 크로키 포즈: {currentPosePrompt.title}
                  </span>
                  <span className="rounded bg-card px-2 py-0.5 font-mono text-[0.62rem] font-bold text-fg">
                    핵심 동세선: {currentPosePrompt.lineOfActionCurve}
                  </span>
                </div>
                <p className="mt-1 text-[0.68rem] text-fg">{currentPosePrompt.description}</p>
                <div className="mt-2 text-[0.62rem] text-fg-3">
                  <span className="font-bold text-accent">해부학/구조 주의점:</span>{" "}
                  {currentPosePrompt.keyAnatomyFocus}
                </div>
              </div>

              {/* 4 Perspective Guide Overlays */}
              <div className={cn("flex flex-col gap-2", cardClass)}>
                <span className="text-[0.75rem] font-bold">투시 원근 및 카메라 앵글 가이드</span>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {PERSPECTIVE_PRESETS.map((preset) => {
                    const g = PERSPECTIVE_GUIDES[preset];
                    const isSelected = selectedPerspective === preset;
                    return (
                      <button
                        key={preset}
                        type="button"
                        aria-pressed={isSelected}
                        onClick={() => setSelectedPerspective(preset)}
                        className={cn(
                          "flex flex-col rounded-xl border p-2.5 text-left",
                          STUDIO_EASE,
                          STUDIO_FOCUS_RING,
                          STUDIO_TOUCH_TARGET,
                          isSelected
                            ? "border-accent bg-accent-soft text-accent shadow-sm"
                            : "border-line bg-card text-fg hover:bg-raised",
                        )}
                      >
                        <span className="text-[0.72rem] font-bold">{g.label}</span>
                        <span className="mt-1 text-[0.62rem] text-fg-3">{g.tip}</span>
                      </button>
                    );
                  })}
                </div>

                {/* Selected guide preview — 선택이 실제 출력을 바꾼다 */}
                <div className="mt-1 flex flex-col gap-2 rounded-lg border border-line bg-card p-2.5 sm:flex-row sm:items-center">
                  <svg
                    viewBox="0 0 160 90"
                    role="img"
                    aria-label={`${perspectiveShortLabel(perspectiveGuide.label)} 가이드 미리보기`}
                    className="h-24 w-full shrink-0 rounded border border-line/60 bg-canvas text-accent sm:w-40"
                  >
                    <g
                      transform={`rotate(${perspectiveGuide.tiltAngleDeg} 80 45)`}
                      stroke="currentColor"
                      fill="none"
                    >
                      <line
                        x1={-40}
                        x2={200}
                        y1={90 * perspectiveGuide.horizonRatioY}
                        y2={90 * perspectiveGuide.horizonRatioY}
                        strokeWidth={1.4}
                      />
                      {perspectiveVanishingPoints(perspectiveGuide).map((point) => (
                        <g key={`${point.x}-${point.y}`}>
                          <circle cx={point.x} cy={point.y} r={3} strokeWidth={1.2} />
                          <line
                            x1={point.x}
                            y1={point.y}
                            x2={80}
                            y2={45}
                            strokeWidth={0.6}
                            strokeDasharray="3 3"
                            opacity={0.7}
                          />
                        </g>
                      ))}
                    </g>
                  </svg>
                  <dl className="grid flex-1 grid-cols-3 gap-2 text-center text-[0.62rem]">
                    <div className="rounded border border-line bg-raised p-1.5">
                      <dt className="text-fg-3">지평선 위치</dt>
                      <dd className="mt-0.5 font-mono font-bold text-fg">
                        {Math.round(perspectiveGuide.horizonRatioY * 100)}%
                      </dd>
                    </div>
                    <div className="rounded border border-line bg-raised p-1.5">
                      <dt className="text-fg-3">화면 기울기</dt>
                      <dd className="mt-0.5 font-mono font-bold text-fg">
                        {perspectiveGuide.tiltAngleDeg}°
                      </dd>
                    </div>
                    <div className="rounded border border-line bg-raised p-1.5">
                      <dt className="text-fg-3">소실점</dt>
                      <dd className="mt-0.5 font-mono font-bold text-fg">
                        {perspectiveGuide.vanishingPointCount}점
                      </dd>
                    </div>
                  </dl>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>,
    document.body,
  );
}

/** 라벨 앞머리(괄호 앞)만 뽑아 짧은 접근성 이름으로 쓴다. */
function perspectiveShortLabel(label: string): string {
  const head = label.split("(")[0];
  return head.trim() === "" ? label : head.trim();
}

/** 소실점 좌표. 개수에 따라 수평 2점 + (3점이면) 지평선 반대편 수직 소실점을 얹는다. */
function perspectiveVanishingPoints(guide: {
  horizonRatioY: number;
  vanishingPointCount: 1 | 2 | 3;
}): readonly { x: number; y: number }[] {
  const horizonY = 90 * guide.horizonRatioY;
  if (guide.vanishingPointCount === 1) return [{ x: 80, y: horizonY }];
  const horizontal = [
    { x: 12, y: horizonY },
    { x: 148, y: horizonY },
  ];
  if (guide.vanishingPointCount === 2) return horizontal;
  return [...horizontal, { x: 80, y: guide.horizonRatioY < 0.5 ? 86 : 4 }];
}
