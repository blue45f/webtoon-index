import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  Copy,
  Maximize,
  Palette,
  Pause,
  Play,
  Scissors,
  Search,
  Smartphone,
  Sparkles,
  Timer,
  Type,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  SCENE_MOOD_PALETTES,
  WebtoonColorHarmonyAssistant,
  type SkinToneId,
} from "./assistant/webtoon-color-harmony-assistant";
import {
  PERSPECTIVE_GUIDES,
  WebtoonCroquisPoseGuide,
  type CroquisTimerIntervalSec,
  type PerspectiveGuidePreset,
} from "./assistant/webtoon-croquis-pose-guide";
import {
  POMODORO_CONFIGS,
  PRODUCTION_STAGES,
  WebtoonFocusTimerEngine,
  type PomodoroMode,
  type WebtoonProductionStage,
} from "./assistant/webtoon-focus-timer";
import {
  WEBTOON_PLATFORM_SPECS,
  WebtoonPlatformSpecValidator,
  type WebtoonImageFormat,
  type WebtoonPlatformId,
} from "./assistant/webtoon-platform-spec-validator";
import {
  PACING_BAND_SOURCES,
  WebtoonScrollPacingSimulator,
  type PanelVerticalSpan,
} from "./assistant/webtoon-scroll-pacing-simulator";
import {
  WebtoonSfxLexiconEngine,
  type SfxCategory,
} from "./assistant/webtoon-sfx-lexicon";
import {
  StudioEmptyState,
  STUDIO_EASE,
  STUDIO_FOCUS_RING,
  STUDIO_TOUCH_TARGET,
} from "./studio-panel-ui";
import { studioSfxLetteringStyle } from "./studio-sfx-lettering";
import {
  StudioWorkbenchTabStrip,
  studioWorkbenchTabPanelProps,
  type StudioWorkbenchTab,
} from "./studio-workbench-tabs";
import { useStudioCopyFeedback } from "./use-studio-copy-feedback";

import { cn } from "@/shared/lib/utils";

export type AssistantDisplayTab =
  | "spec-slicer"
  | "scroll-pacing"
  | "sfx-lexicon"
  | "color-harmony"
  | "focus-timer"
  | "croquis-pose";

type AssistantDataSource = "connected" | "manual" | "example";

const TAB_ID_PREFIX = "companion-assistant";
const SFX_PAGE_SIZE = 6;
const EXAMPLE_CANVAS_WIDTH = 690;
const EXAMPLE_CANVAS_HEIGHT = 15_000;
const EXAMPLE_GUTTERS = "150, 300, 600, 800";

const ASSISTANT_TABS: readonly StudioWorkbenchTab[] = [
  { id: "spec-slicer", label: "플랫폼 규격", icon: Scissors },
  { id: "scroll-pacing", label: "스크롤 페이싱", icon: Smartphone },
  { id: "sfx-lexicon", label: "효과음 사전", icon: Type },
  { id: "color-harmony", label: "컬러 조화", icon: Palette },
  { id: "focus-timer", label: "포커스 타이머", icon: Timer },
  { id: "croquis-pose", label: "크로키 가이드", icon: Maximize },
];

const SKIN_TONE_IDS: readonly SkinToneId[] = [
  "warm-fair",
  "cool-pale",
  "blush-peach",
  "sun-kissed-tan",
  "dark-rich",
];

const POMODORO_LABELS: Readonly<Record<PomodoroMode, string>> = {
  "standard-25": "표준 25/5",
  "deep-flow-50": "몰입 50/10",
  "sprint-15": "스프린트 15/3",
};

const SOURCE_LABELS: Readonly<Record<AssistantDataSource, string>> = {
  connected: "현재 원고",
  manual: "직접 입력",
  example: "예시 데이터",
};

const SOURCE_CLASSES: Readonly<Record<AssistantDataSource, string>> = {
  connected: "border-good/35 bg-good/10 text-good",
  manual: "border-accent/35 bg-accent-soft text-accent",
  example: "border-warn/35 bg-warn/10 text-warn",
};

const FIELD_CLASS = cn(
  "min-h-11 w-full rounded-lg border border-line bg-card px-2.5 text-xs text-fg outline-none",
  STUDIO_EASE,
  STUDIO_FOCUS_RING,
);

function isPositiveFinite(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value > 0;
}

function normalizedDimension(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback;
}

function parsePositiveNumberList(value: string): readonly number[] {
  return value
    .split(/[\s,]+/u)
    .map((part) => Number(part.trim()))
    .filter((item) => Number.isFinite(item) && item >= 0)
    .map((item) => Math.round(item));
}

function buildSyntheticPanels(gutters: readonly number[]): readonly PanelVerticalSpan[] {
  const panels: PanelVerticalSpan[] = [];
  let topY = 100;
  for (let index = 0; index < gutters.length + 1; index += 1) {
    const heightPx = 600;
    panels.push({
      id: `manual-panel-${index + 1}`,
      topY,
      bottomY: topY + heightPx,
      heightPx,
      dialogueCount: index % 2 === 0 ? 1 : 2,
    });
    topY += heightPx + (gutters[index] ?? 0);
  }
  return panels;
}

function formatClock(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(safeSeconds / 60)).padStart(2, "0")}:${String(
    safeSeconds % 60,
  ).padStart(2, "0")}`;
}

function DataSourceBadge({ source }: { readonly source: AssistantDataSource }) {
  return (
    <span
      className={cn(
        "inline-flex min-h-6 items-center rounded-full border px-2 text-[0.62rem] font-bold",
        SOURCE_CLASSES[source],
      )}
    >
      {SOURCE_LABELS[source]}
    </span>
  );
}

export interface StudioCompanionAssistantDisplayProps {
  readonly canvasWidth?: number;
  readonly canvasHeight?: number;
  readonly imageFormat?: WebtoonImageFormat;
  readonly panelGuttersPx?: readonly number[];
  readonly panels?: readonly PanelVerticalSpan[];
  readonly readerViewportHeightPx?: number;
  readonly onInsertSfxText?: (text: string) => void;
  readonly layout?: "embedded" | "dedicated";
}

export function StudioCompanionAssistantDisplay({
  canvasWidth,
  canvasHeight,
  imageFormat,
  panelGuttersPx,
  panels,
  readerViewportHeightPx,
  onInsertSfxText,
  layout = "embedded",
}: StudioCompanionAssistantDisplayProps) {
  const connectedCanvas = isPositiveFinite(canvasWidth) && isPositiveFinite(canvasHeight);
  const [activeTab, setActiveTab] = useState<AssistantDisplayTab>("spec-slicer");

  const specValidator = useMemo(() => new WebtoonPlatformSpecValidator(), []);
  const [selectedPlatform, setSelectedPlatform] = useState<WebtoonPlatformId>("naver-webtoon");
  const [specSource, setSpecSource] = useState<AssistantDataSource>(
    connectedCanvas ? "connected" : "example",
  );
  const [widthInput, setWidthInput] = useState(
    String(connectedCanvas ? Math.round(canvasWidth) : EXAMPLE_CANVAS_WIDTH),
  );
  const [heightInput, setHeightInput] = useState(
    String(connectedCanvas ? Math.round(canvasHeight) : EXAMPLE_CANVAS_HEIGHT),
  );
  const [formatInput, setFormatInput] = useState<WebtoonImageFormat | "">(imageFormat ?? "");
  const [gutterInput, setGutterInput] = useState(panelGuttersPx?.join(", ") ?? "");

  useEffect(() => {
    if (!isPositiveFinite(canvasWidth) || !isPositiveFinite(canvasHeight)) return;
    setWidthInput(String(Math.round(canvasWidth)));
    setHeightInput(String(Math.round(canvasHeight)));
    setSpecSource("connected");
  }, [canvasHeight, canvasWidth]);

  useEffect(() => {
    if (imageFormat) setFormatInput(imageFormat);
  }, [imageFormat]);

  useEffect(() => {
    if (!panelGuttersPx) return;
    setGutterInput(panelGuttersPx.join(", "));
  }, [panelGuttersPx]);

  const effectiveCanvasWidth = normalizedDimension(widthInput, EXAMPLE_CANVAS_WIDTH);
  const effectiveCanvasHeight = normalizedDimension(heightInput, EXAMPLE_CANVAS_HEIGHT);
  const parsedGutters = useMemo(() => parsePositiveNumberList(gutterInput), [gutterInput]);
  const auditResult = useMemo(
    () =>
      specValidator.audit(selectedPlatform, {
        width: effectiveCanvasWidth,
        height: effectiveCanvasHeight,
        ...(formatInput ? { format: formatInput } : {}),
        ...(gutterInput.trim() ? { panelGuttersPx: parsedGutters } : {}),
      }),
    [
      effectiveCanvasHeight,
      effectiveCanvasWidth,
      formatInput,
      gutterInput,
      parsedGutters,
      selectedPlatform,
      specValidator,
    ],
  );

  const scrollSimulator = useMemo(() => new WebtoonScrollPacingSimulator(), []);
  const [pacingSource, setPacingSource] = useState<AssistantDataSource>(
    panels && panels.length > 0 ? "connected" : "example",
  );
  const [pacingGutterInput, setPacingGutterInput] = useState(
    panels && panels.length > 1
      ? panels
          .slice(0, -1)
          .map((panel, index) => Math.max(0, (panels[index + 1]?.topY ?? panel.bottomY) - panel.bottomY))
          .join(", ")
      : EXAMPLE_GUTTERS,
  );
  const [viewportInput, setViewportInput] = useState(
    isPositiveFinite(readerViewportHeightPx) ? String(Math.round(readerViewportHeightPx)) : "",
  );

  useEffect(() => {
    if (!panels || panels.length === 0) return;
    setPacingSource("connected");
  }, [panels]);

  useEffect(() => {
    if (!isPositiveFinite(readerViewportHeightPx)) return;
    setViewportInput(String(Math.round(readerViewportHeightPx)));
  }, [readerViewportHeightPx]);

  const manualPacingGutters = useMemo(
    () => parsePositiveNumberList(pacingGutterInput),
    [pacingGutterInput],
  );
  const effectivePanels = useMemo(
    () =>
      pacingSource === "connected" && panels && panels.length > 0
        ? panels
        : buildSyntheticPanels(manualPacingGutters),
    [manualPacingGutters, pacingSource, panels],
  );
  const lastPanelBottom = effectivePanels.at(-1)?.bottomY ?? 0;
  const effectiveViewport = normalizedDimension(viewportInput, 0);
  const pacingResult = useMemo(
    () =>
      scrollSimulator.analyze(
        effectivePanels,
        Math.max(effectiveCanvasHeight, lastPanelBottom + 100),
        effectiveViewport > 0 ? { readerViewportHeightPx: effectiveViewport } : {},
      ),
    [
      effectiveCanvasHeight,
      effectivePanels,
      effectiveViewport,
      lastPanelBottom,
      scrollSimulator,
    ],
  );

  const sfxEngine = useMemo(() => new WebtoonSfxLexiconEngine(), []);
  const [sfxQuery, setSfxQuery] = useState("");
  const [sfxCategory, setSfxCategory] = useState<SfxCategory | "all">("all");
  const [sfxVisibleCount, setSfxVisibleCount] = useState(SFX_PAGE_SIZE);
  const [insertFeedback, setInsertFeedback] = useState("");
  const sfxCopy = useStudioCopyFeedback();
  const filteredSfx = useMemo(
    () => sfxEngine.search(sfxQuery, sfxCategory === "all" ? undefined : sfxCategory),
    [sfxCategory, sfxEngine, sfxQuery],
  );

  useEffect(() => {
    setSfxVisibleCount(SFX_PAGE_SIZE);
  }, [sfxCategory, sfxQuery]);

  useEffect(() => {
    if (!insertFeedback) return;
    const timeout = globalThis.setTimeout(() => setInsertFeedback(""), 1800);
    return () => globalThis.clearTimeout(timeout);
  }, [insertFeedback]);

  const visibleSfx = filteredSfx.slice(0, sfxVisibleCount);
  const hiddenSfxCount = filteredSfx.length - visibleSfx.length;
  const sfxIsFiltered = sfxQuery.trim().length > 0 || sfxCategory !== "all";
  const copyStatusMessage = !sfxCopy.current
    ? ""
    : `“${sfxEngine.getById(sfxCopy.current.id)?.text ?? sfxCopy.current.id}” ${
        sfxCopy.current.status === "copied"
          ? "복사됨"
          : "복사 실패 — 브라우저가 클립보드를 막았습니다"
      }`;

  const colorAssistant = useMemo(() => new WebtoonColorHarmonyAssistant(), []);
  const [selectedSkinTone, setSelectedSkinTone] = useState<SkinToneId>("warm-fair");
  const [customBase, setCustomBase] = useState("#ffedd5");
  const [selectedMoodId, setSelectedMoodId] = useState(SCENE_MOOD_PALETTES[0]?.id ?? "");
  const colorCopy = useStudioCopyFeedback();
  const customColorValid = /^#[0-9a-f]{6}$/iu.test(customBase);
  const selectedPalette = colorAssistant.getSkinPalette(selectedSkinTone);
  const customHarmony = useMemo(
    () =>
      customColorValid
        ? colorAssistant.generateHueShiftShadow(customBase)
        : colorAssistant.generateHueShiftShadow(selectedPalette.base),
    [colorAssistant, customBase, customColorValid, selectedPalette.base],
  );
  const selectedMood =
    SCENE_MOOD_PALETTES.find((palette) => palette.id === selectedMoodId) ??
    SCENE_MOOD_PALETTES[0];

  const [timerEngine, setTimerEngine] = useState(
    () => new WebtoonFocusTimerEngine("storyboard", "standard-25"),
  );
  const [timerState, setTimerState] = useState(() => timerEngine.getState());

  useEffect(() => {
    if (!timerState.isRunning) return;
    const interval = globalThis.setInterval(() => {
      timerEngine.tick(1);
      setTimerState(timerEngine.getState());
    }, 1000);
    return () => globalThis.clearInterval(interval);
  }, [timerEngine, timerState.isRunning]);

  const timerConfig = POMODORO_CONFIGS[timerState.pomodoroMode];
  const timerTotalSeconds =
    (timerState.isResting ? timerConfig.restMinutes : timerConfig.focusMinutes) * 60;
  const timerProgress = Math.max(
    0,
    Math.min(100, ((timerTotalSeconds - timerState.currentSecondsRemaining) / timerTotalSeconds) * 100),
  );

  const croquisGuide = useMemo(() => new WebtoonCroquisPoseGuide(), []);
  const [currentPosePrompt, setCurrentPosePrompt] = useState(() => croquisGuide.getRandomPose(1));
  const [croquisInterval, setCroquisInterval] = useState<CroquisTimerIntervalSec>(60);
  const [croquisRemaining, setCroquisRemaining] = useState(60);
  const [croquisRunning, setCroquisRunning] = useState(false);
  const [perspectivePreset, setPerspectivePreset] =
    useState<PerspectiveGuidePreset>("eye-level");
  const perspective = PERSPECTIVE_GUIDES[perspectivePreset];

  useEffect(() => {
    if (!croquisRunning) return;
    const interval = globalThis.setInterval(() => {
      setCroquisRemaining((remaining) => Math.max(0, remaining - 1));
    }, 1000);
    return () => globalThis.clearInterval(interval);
  }, [croquisRunning]);

  useEffect(() => {
    if (croquisRemaining === 0) setCroquisRunning(false);
  }, [croquisRemaining]);

  function markSpecManual(): void {
    setSpecSource("manual");
  }

  function resetSpecInputs(): void {
    if (connectedCanvas) {
      setWidthInput(String(Math.round(canvasWidth)));
      setHeightInput(String(Math.round(canvasHeight)));
      setFormatInput(imageFormat ?? "");
      setGutterInput(panelGuttersPx?.join(", ") ?? "");
      setSpecSource("connected");
      return;
    }
    setWidthInput(String(EXAMPLE_CANVAS_WIDTH));
    setHeightInput(String(EXAMPLE_CANVAS_HEIGHT));
    setFormatInput("");
    setGutterInput("");
    setSpecSource("example");
  }

  function insertSfx(text: string): void {
    if (!onInsertSfxText) return;
    try {
      onInsertSfxText(text);
      setInsertFeedback(`“${text}”을 캔버스에 삽입했습니다`);
    } catch {
      setInsertFeedback(`“${text}” 삽입에 실패했습니다`);
    }
  }

  function resetTimer(): void {
    const nextEngine = new WebtoonFocusTimerEngine(
      timerState.activeStage,
      timerState.pomodoroMode,
    );
    setTimerEngine(nextEngine);
    setTimerState(nextEngine.getState());
  }

  function chooseCroquisInterval(interval: CroquisTimerIntervalSec): void {
    setCroquisInterval(interval);
    setCroquisRemaining(interval);
    setCroquisRunning(false);
  }

  function nextPose(): void {
    const next = croquisGuide.getRandomPose(Date.now());
    setCurrentPosePrompt(next);
    setCroquisInterval(next.recommendedIntervalSec);
    setCroquisRemaining(next.recommendedIntervalSec);
    setCroquisRunning(false);
  }

  return (
    <section
      data-testid="studio-companion-assistant-display"
      className={cn(
        "flex min-w-0 flex-col gap-3 rounded-2xl border border-line bg-card p-3 text-xs text-fg",
        layout === "dedicated" ? "min-h-full flex-1" : "",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-line pb-2.5">
        <div className="flex min-w-0 items-start gap-2">
          <Sparkles className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
          <div className="min-w-0">
            <h2 className="truncate text-sm font-bold">웹툰 보조 툴킷</h2>
            <p className="mt-0.5 text-[0.62rem] leading-relaxed text-fg-3">
              검사 근거와 데이터 출처를 구분하고 결과에서 바로 다음 작업으로 이어집니다.
            </p>
          </div>
        </div>
        <DataSourceBadge source={specSource} />
      </div>

      <StudioWorkbenchTabStrip
        tabs={ASSISTANT_TABS}
        activeId={activeTab}
        onSelect={(id) => setActiveTab(id as AssistantDisplayTab)}
        ariaLabel="웹툰 보조 툴킷 탭"
        idPrefix={TAB_ID_PREFIX}
        className="rounded-xl border border-line bg-card/60 p-1"
      />

      {activeTab === "spec-slicer" ? (
        <div
          {...studioWorkbenchTabPanelProps(TAB_ID_PREFIX, "spec-slicer")}
          className={cn("flex flex-col gap-3 outline-none", STUDIO_FOCUS_RING)}
        >
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-raised/45 p-2.5">
            <div>
              <p className="font-bold text-fg">원고 검사 입력</p>
              <p className="mt-0.5 text-[0.62rem] leading-relaxed text-fg-3">
                {specSource === "example"
                  ? "실제 원고가 연결되지 않아 예시값을 보여줍니다. 이 결과는 업로드 차단 판단에 쓰지 않습니다."
                  : specSource === "connected"
                    ? "현재 원고에서 받은 크기 정보입니다. 포맷·컷 간격이 없으면 해당 항목은 검사하지 않습니다."
                    : "직접 입력한 값입니다. 내보내기 파일과 값이 같은지 마지막으로 확인하세요."}
              </p>
            </div>
            <DataSourceBadge source={specSource} />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1 text-[0.62rem] font-semibold text-fg-2">
              원고 폭(px)
              <input
                type="number"
                min={1}
                inputMode="numeric"
                value={widthInput}
                onChange={(event) => {
                  setWidthInput(event.target.value);
                  markSpecManual();
                }}
                className={FIELD_CLASS}
              />
            </label>
            <label className="space-y-1 text-[0.62rem] font-semibold text-fg-2">
              원고 높이(px)
              <input
                type="number"
                min={1}
                inputMode="numeric"
                value={heightInput}
                onChange={(event) => {
                  setHeightInput(event.target.value);
                  markSpecManual();
                }}
                className={FIELD_CLASS}
              />
            </label>
            <label className="space-y-1 text-[0.62rem] font-semibold text-fg-2">
              내보내기 포맷
              <select
                aria-label="내보내기 포맷"
                value={formatInput}
                onChange={(event) => {
                  setFormatInput(event.target.value as WebtoonImageFormat | "");
                  markSpecManual();
                }}
                className={FIELD_CLASS}
              >
                <option value="">미지정 · 검사 안 함</option>
                <option value="jpg">JPG</option>
                <option value="png">PNG</option>
                <option value="webp">WebP</option>
                <option value="gif">GIF</option>
              </select>
            </label>
            <label className="space-y-1 text-[0.62rem] font-semibold text-fg-2">
              컷 사이 여백(px, 쉼표 구분)
              <input
                type="text"
                inputMode="numeric"
                value={gutterInput}
                placeholder="예: 220, 640, 300"
                onChange={(event) => {
                  setGutterInput(event.target.value);
                  markSpecManual();
                }}
                className={FIELD_CLASS}
              />
            </label>
          </div>

          <div className="flex flex-wrap gap-1.5 text-[0.6rem] font-semibold">
            <span className="rounded-full border border-line bg-card px-2 py-1 text-fg-2">
              크기 검사 중
            </span>
            <span
              className={cn(
                "rounded-full border px-2 py-1",
                formatInput
                  ? "border-good/30 bg-good/10 text-good"
                  : "border-line bg-card text-fg-3",
              )}
            >
              {formatInput ? `${formatInput.toUpperCase()} 검사 중` : "포맷 미검사"}
            </span>
            <span
              className={cn(
                "rounded-full border px-2 py-1",
                gutterInput.trim()
                  ? "border-good/30 bg-good/10 text-good"
                  : "border-line bg-card text-fg-3",
              )}
            >
              {gutterInput.trim() ? `${parsedGutters.length}개 여백 검사 중` : "컷 간 여백 미검사"}
            </span>
            <button
              type="button"
              onClick={resetSpecInputs}
              className={cn(
                "rounded-full border border-line bg-card px-2 font-semibold text-fg-2 hover:bg-raised hover:text-fg",
                STUDIO_EASE,
                STUDIO_FOCUS_RING,
                STUDIO_TOUCH_TARGET,
              )}
            >
              입력 초기화
            </button>
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            {(Object.keys(WEBTOON_PLATFORM_SPECS) as WebtoonPlatformId[]).map((platformId) => {
              const platform = WEBTOON_PLATFORM_SPECS[platformId];
              const selected = selectedPlatform === platformId;
              return (
                <button
                  key={platformId}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setSelectedPlatform(platformId)}
                  className={cn(
                    "flex min-w-0 flex-col justify-center rounded-lg border p-2 text-left",
                    STUDIO_EASE,
                    STUDIO_FOCUS_RING,
                    STUDIO_TOUCH_TARGET,
                    selected
                      ? "border-accent bg-accent-soft text-accent shadow-sm"
                      : "border-line bg-card text-fg hover:bg-raised",
                  )}
                >
                  <span className="truncate text-[0.68rem] font-bold">{platform.name}</span>
                  <span className="truncate text-[0.6rem] text-fg-3">
                    폭 {platform.recommendedWidthPx}px 권장
                  </span>
                </button>
              );
            })}
          </div>

          <div
            className={cn(
              "flex items-start gap-2.5 rounded-xl border p-2.5",
              auditResult.overallGrade === "pass"
                ? "border-good/35 bg-good/10 text-good"
                : auditResult.overallGrade === "warn"
                  ? "border-warn/35 bg-warn/10 text-warn"
                  : "border-bad/35 bg-bad/10 text-bad",
            )}
          >
            {auditResult.overallGrade === "pass" ? (
              <CheckCircle2 className="size-4 shrink-0" aria-hidden />
            ) : auditResult.overallGrade === "warn" ? (
              <AlertTriangle className="size-4 shrink-0" aria-hidden />
            ) : (
              <XCircle className="size-4 shrink-0" aria-hidden />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-[0.72rem] font-bold">
                {specSource === "example" ? "예시 판정 · " : ""}
                {auditResult.summary}
              </p>
              <p className="mt-0.5 text-[0.62rem] leading-relaxed opacity-90">
                권장 슬라이스 {auditResult.recommendedSliceCount}장 · 판정 근거는 이슈별 출처 태그를 따릅니다.
              </p>
              {auditResult.issues.slice(0, 4).map((issue, index) => (
                <p key={`${issue.field}-${index}`} className="mt-1 text-[0.62rem] leading-relaxed">
                  • {issue.message}
                </p>
              ))}
              {auditResult.issues.length > 4 ? (
                <p className="mt-1 text-[0.62rem] font-semibold">
                  외 {auditResult.issues.length - 4}건 · 통합 보조 센터에서 전체 근거 확인
                </p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {activeTab === "scroll-pacing" ? (
        <div
          {...studioWorkbenchTabPanelProps(TAB_ID_PREFIX, "scroll-pacing")}
          className={cn("flex flex-col gap-3 outline-none", STUDIO_FOCUS_RING)}
        >
          <div className="flex flex-wrap items-start justify-between gap-2 rounded-xl border border-line bg-raised/45 p-2.5">
            <div>
              <p className="font-bold text-fg">모바일 호흡 간이 시뮬레이션</p>
              <p className="mt-0.5 text-[0.62rem] leading-relaxed text-fg-3">
                {pacingSource === "connected"
                  ? "현재 원고의 패널 위치를 분석합니다."
                  : "입력한 컷 사이 여백과 컷 높이 600px 가정으로 비교합니다. 완독 시간은 추정치입니다."}
              </p>
            </div>
            <DataSourceBadge source={pacingSource} />
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="space-y-1 text-[0.62rem] font-semibold text-fg-2">
              컷 사이 여백(px, 쉼표 구분)
              <input
                type="text"
                inputMode="numeric"
                value={pacingGutterInput}
                disabled={pacingSource === "connected"}
                onChange={(event) => {
                  setPacingGutterInput(event.target.value);
                  setPacingSource("manual");
                }}
                className={cn(FIELD_CLASS, "disabled:cursor-not-allowed disabled:opacity-55")}
              />
            </label>
            <label className="space-y-1 text-[0.62rem] font-semibold text-fg-2">
              독자 화면 높이(px)
              <input
                type="number"
                min={1}
                inputMode="numeric"
                value={viewportInput}
                placeholder="예: 844"
                onChange={(event) => setViewportInput(event.target.value)}
                className={FIELD_CLASS}
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded-full border border-line bg-card px-2 py-1 text-[0.6rem] font-semibold text-fg-2">
              {effectivePanels.length}컷 분석
            </span>
            <span className="rounded-full border border-line bg-card px-2 py-1 text-[0.6rem] font-semibold text-fg-2">
              {effectiveViewport > 0
                ? `화면당 최대 ${pacingResult.maxPanelsPerScreen ?? 0}컷`
                : "화면당 컷수 미검사"}
            </span>
            {pacingSource !== "connected" && panels && panels.length > 0 ? (
              <button
                type="button"
                onClick={() => setPacingSource("connected")}
                className={cn(
                  "rounded-full border border-line bg-card px-2 text-[0.6rem] font-semibold text-fg-2 hover:bg-raised",
                  STUDIO_EASE,
                  STUDIO_FOCUS_RING,
                  STUDIO_TOUCH_TARGET,
                )}
              >
                현재 패널로 복원
              </button>
            ) : null}
            {pacingSource !== "example" ? (
              <button
                type="button"
                onClick={() => {
                  setPacingGutterInput(EXAMPLE_GUTTERS);
                  setPacingSource("example");
                }}
                className={cn(
                  "rounded-full border border-line bg-card px-2 text-[0.6rem] font-semibold text-fg-2 hover:bg-raised",
                  STUDIO_EASE,
                  STUDIO_FOCUS_RING,
                  STUDIO_TOUCH_TARGET,
                )}
              >
                예시로 보기
              </button>
            ) : null}
          </div>

          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="min-w-0 rounded-lg border border-line bg-card/60 p-2">
              <span className="text-[0.6rem] text-fg-3">페이싱 점수</span>
              <p className="font-mono text-lg font-black text-accent">
                {pacingResult.pacingHealthScore}점
              </p>
            </div>
            <div className="min-w-0 rounded-lg border border-line bg-card/60 p-2">
              <span className="text-[0.6rem] text-fg-3">평균 간격</span>
              <p className="font-mono text-lg font-black text-fg">
                {pacingResult.averageGutterPx}px
              </p>
            </div>
            <div className="min-w-0 rounded-lg border border-line bg-card/60 p-2">
              <span className="text-[0.6rem] text-fg-3">예상 완독</span>
              <p className="font-mono text-lg font-black text-fg">
                {pacingResult.estimatedReadingSeconds.casual}초
              </p>
            </div>
          </div>

          {pacingResult.warnings.length > 0 ? (
            <div className="rounded-xl border border-warn/35 bg-warn/10 p-2.5 text-warn">
              <p className="font-bold">먼저 확인할 호흡 {pacingResult.warnings.length}건</p>
              {pacingResult.warnings.slice(0, 3).map((warning) => (
                <p key={warning} className="mt-1 text-[0.62rem] leading-relaxed">
                  • {warning}
                </p>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-good/35 bg-good/10 p-2.5 text-good">
              <p className="font-bold">현재 입력에서는 긴 공백·과밀 경고가 없습니다.</p>
            </div>
          )}

          <div className="space-y-1.5">
            {pacingResult.beats.slice(0, 4).map((beat) => {
              const source = PACING_BAND_SOURCES[beat.beatType];
              return (
                <div
                  key={`${beat.fromPanelIndex}-${beat.toPanelIndex}`}
                  className="flex items-start justify-between gap-2 rounded-lg border border-line bg-card p-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[0.65rem] font-bold text-fg">{beat.label}</p>
                    <p className="text-[0.6rem] text-fg-3">
                      {beat.fromPanelIndex}→{beat.toPanelIndex}컷 · {beat.gutterDistancePx}px
                    </p>
                  </div>
                  <span
                    className={cn(
                      "shrink-0 rounded-full border px-1.5 py-0.5 text-[0.56rem] font-bold",
                      source.sourced
                        ? "border-good/30 bg-good/10 text-good"
                        : "border-warn/30 bg-warn/10 text-warn",
                    )}
                    title={source.basis}
                  >
                    {source.sourced ? "공식 근거" : "휴리스틱"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {activeTab === "sfx-lexicon" ? (
        <div
          {...studioWorkbenchTabPanelProps(TAB_ID_PREFIX, "sfx-lexicon")}
          className={cn("flex flex-col gap-2 outline-none", STUDIO_FOCUS_RING)}
        >
          <div className="flex gap-1 overflow-x-auto pb-1 text-[0.6rem] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {[{ id: "all", label: "전체" }, ...sfxEngine.listCategories()].map((category) => (
              <button
                key={category.id}
                type="button"
                aria-pressed={sfxCategory === category.id}
                onClick={() => setSfxCategory(category.id as SfxCategory | "all")}
                className={cn(
                  "inline-flex shrink-0 items-center whitespace-nowrap rounded px-2 font-semibold",
                  STUDIO_EASE,
                  STUDIO_FOCUS_RING,
                  STUDIO_TOUCH_TARGET,
                  sfxCategory === category.id
                    ? "bg-accent text-on-accent"
                    : "border border-line bg-card text-fg-3 hover:text-fg",
                )}
              >
                {category.label}
              </button>
            ))}
          </div>

          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-3 -translate-y-1/2 text-fg-3"
              aria-hidden
            />
            <input
              type="search"
              value={sfxQuery}
              onChange={(event) => setSfxQuery(event.target.value)}
              aria-label="의성어·의태어 검색"
              placeholder="의성어·의태어 빠른 검색…"
              className={cn(FIELD_CLASS, "pl-7")}
            />
          </div>

          {filteredSfx.length === 0 ? (
            <StudioEmptyState
              icon={<Search className="size-5" aria-hidden />}
              title="검색 결과가 없습니다"
              description="다른 낱말이나 태그로 찾아보세요. 예: 쿵, 심장, 번개, 문, 폭발."
              action={
                sfxIsFiltered ? (
                  <button
                    type="button"
                    onClick={() => {
                      setSfxQuery("");
                      setSfxCategory("all");
                    }}
                    className={cn(
                      "inline-flex items-center rounded-md border border-line bg-card px-3 text-[0.65rem] font-semibold text-fg hover:bg-raised",
                      STUDIO_EASE,
                      STUDIO_FOCUS_RING,
                      STUDIO_TOUCH_TARGET,
                    )}
                  >
                    검색 초기화
                  </button>
                ) : undefined
              }
            />
          ) : (
            <>
              <p className="text-[0.6rem] text-fg-3">
                총 {filteredSfx.length}개 중 {visibleSfx.length}개 표시
              </p>
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {visibleSfx.map((item) => {
                  const copyStatus = sfxCopy.statusFor(item.id);
                  return (
                    <article
                      key={item.id}
                      className="flex min-w-0 items-center gap-2 rounded-lg border border-line bg-card p-2"
                    >
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span
                          className="truncate text-sm font-black"
                          style={studioSfxLetteringStyle(item)}
                        >
                          {item.text}
                        </span>
                        <span className="truncate text-[0.6rem] text-fg-3">{item.meaning}</span>
                      </span>
                      <span className="flex shrink-0 gap-1">
                        {onInsertSfxText ? (
                          <button
                            type="button"
                            aria-label={`${item.text} 캔버스에 삽입`}
                            title="캔버스에 삽입"
                            onClick={() => insertSfx(item.text)}
                            className={cn(
                              "grid min-w-11 place-items-center rounded-md border border-accent/35 bg-accent-soft px-2 text-accent hover:bg-accent/15",
                              STUDIO_EASE,
                              STUDIO_FOCUS_RING,
                              STUDIO_TOUCH_TARGET,
                            )}
                          >
                            <Type className="size-3.5" aria-hidden />
                          </button>
                        ) : null}
                        <button
                          type="button"
                          aria-label={
                            copyStatus === "copied"
                              ? `${item.text} 복사됨`
                              : copyStatus === "failed"
                                ? `${item.text} 복사 실패`
                                : `${item.text} 복사`
                          }
                          title="텍스트 복사"
                          onClick={() => {
                            setInsertFeedback("");
                            void sfxCopy.copy(item.id, item.text);
                          }}
                          className={cn(
                            "grid min-w-11 place-items-center rounded-md border border-line bg-card px-2 text-fg-3 hover:bg-raised hover:text-fg",
                            STUDIO_EASE,
                            STUDIO_FOCUS_RING,
                            STUDIO_TOUCH_TARGET,
                          )}
                        >
                          {copyStatus === "copied" ? (
                            <Check className="size-3.5 text-good" aria-hidden />
                          ) : copyStatus === "failed" ? (
                            <XCircle className="size-3.5 text-bad" aria-hidden />
                          ) : (
                            <Copy className="size-3.5" aria-hidden />
                          )}
                        </button>
                      </span>
                    </article>
                  );
                })}
              </div>
              {hiddenSfxCount > 0 ? (
                <button
                  type="button"
                  onClick={() => setSfxVisibleCount((count) => count + SFX_PAGE_SIZE)}
                  className={cn(
                    "flex w-full items-center justify-center gap-1 rounded-lg border border-line bg-card text-[0.65rem] font-semibold text-fg-2 hover:bg-raised hover:text-fg",
                    STUDIO_EASE,
                    STUDIO_FOCUS_RING,
                    STUDIO_TOUCH_TARGET,
                  )}
                >
                  <ChevronDown className="size-3" aria-hidden />
                  더 보기 (+{hiddenSfxCount})
                </button>
              ) : null}
            </>
          )}

          <p
            role="status"
            aria-live="polite"
            className={cn(
              "min-h-3 text-[0.6rem] font-semibold leading-tight",
              sfxCopy.current?.status === "failed" || insertFeedback.includes("실패")
                ? "text-bad"
                : "text-good",
            )}
          >
            {insertFeedback || copyStatusMessage}
          </p>
        </div>
      ) : null}

      {activeTab === "color-harmony" ? (
        <div
          {...studioWorkbenchTabPanelProps(TAB_ID_PREFIX, "color-harmony")}
          className={cn("flex flex-col gap-3 outline-none", STUDIO_FOCUS_RING)}
        >
          <div>
            <p className="font-bold text-fg">피부톤 프리셋</p>
            <p className="mt-0.5 text-[0.62rem] text-fg-3">
              프리셋 선택 후 밑색을 미세 조정하면 하이라이트와 2단계 음영을 다시 계산합니다.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {SKIN_TONE_IDS.map((skinToneId) => {
              const palette = colorAssistant.getSkinPalette(skinToneId);
              const selected = selectedSkinTone === skinToneId;
              return (
                <button
                  key={skinToneId}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => {
                    setSelectedSkinTone(skinToneId);
                    setCustomBase(palette.base);
                  }}
                  className={cn(
                    "flex min-w-0 flex-col justify-center rounded-lg border p-2 text-left",
                    STUDIO_EASE,
                    STUDIO_FOCUS_RING,
                    STUDIO_TOUCH_TARGET,
                    selected ? "border-accent bg-accent-soft" : "border-line bg-card hover:bg-raised",
                  )}
                >
                  <span className="truncate text-[0.65rem] font-bold">{palette.name}</span>
                  <span
                    role="img"
                    aria-label={`${palette.name} 밑색·1차 음영·2차 음영`}
                    className="mt-1 flex h-3 w-full overflow-hidden rounded border border-line"
                  >
                    <span className="flex-1" style={{ backgroundColor: palette.base }} title="밑색" />
                    <span
                      className="flex-1"
                      style={{ backgroundColor: palette.shadow1 }}
                      title="1차 음영"
                    />
                    <span
                      className="flex-1"
                      style={{ backgroundColor: palette.shadow2 }}
                      title="2차 음영"
                    />
                  </span>
                </button>
              );
            })}
          </div>

          <div className="rounded-xl border border-line bg-raised/45 p-2.5">
            <label className="text-[0.62rem] font-semibold text-fg-2" htmlFor="companion-custom-base">
              밑색 HEX
            </label>
            <div className="mt-1 grid grid-cols-[44px_1fr] gap-2">
              <input
                id="companion-custom-base-picker"
                type="color"
                aria-label="밑색 선택"
                value={customColorValid ? customBase : selectedPalette.base}
                onChange={(event) => setCustomBase(event.target.value)}
                className={cn(
                  "size-11 rounded-lg border border-line bg-card p-1",
                  STUDIO_FOCUS_RING,
                )}
              />
              <input
                id="companion-custom-base"
                type="text"
                value={customBase}
                aria-invalid={!customColorValid}
                onChange={(event) => setCustomBase(event.target.value)}
                className={cn(FIELD_CLASS, !customColorValid && "border-bad text-bad")}
              />
            </div>
            {!customColorValid ? (
              <p role="alert" className="mt-1 text-[0.6rem] font-semibold text-bad">
                #RRGGBB 형식의 6자리 HEX를 입력하세요.
              </p>
            ) : null}

            <div
              role="img"
              aria-label="계산된 하이라이트·밑색·1차 음영·2차 음영"
              className="mt-2 grid grid-cols-4 overflow-hidden rounded-lg border border-line"
            >
              {[
                ["하이라이트", customHarmony.highlight],
                ["밑색", customColorValid ? customBase : selectedPalette.base],
                ["1차 음영", customHarmony.shadow1],
                ["2차 음영", customHarmony.shadow2],
              ].map(([label, color]) => (
                <button
                  key={label}
                  type="button"
                  title={`${label} ${color} 복사`}
                  aria-label={`${label} ${color} 복사`}
                  onClick={() => void colorCopy.copy(`color-${label}`, color)}
                  className={cn(
                    "flex min-w-0 flex-col justify-end border-r border-line/70 p-1 text-left last:border-r-0",
                    STUDIO_EASE,
                    STUDIO_FOCUS_RING,
                    STUDIO_TOUCH_TARGET,
                  )}
                  style={{ backgroundColor: color }}
                >
                  <span className="rounded bg-card/90 px-1 py-0.5 text-[0.52rem] font-bold text-fg shadow-sm">
                    {label}
                  </span>
                </button>
              ))}
            </div>
            <p role="status" aria-live="polite" className="mt-1 min-h-3 text-[0.6rem] font-semibold text-good">
              {colorCopy.current
                ? colorCopy.current.status === "copied"
                  ? "색상 코드를 복사했습니다"
                  : "색상 코드 복사에 실패했습니다"
                : ""}
            </p>
          </div>

          <div>
            <p className="font-bold text-fg">장면 조명 무드</p>
            <div className="mt-1.5 grid grid-cols-2 gap-1.5">
              {SCENE_MOOD_PALETTES.map((mood) => (
                <button
                  key={mood.id}
                  type="button"
                  aria-pressed={selectedMood?.id === mood.id}
                  onClick={() => setSelectedMoodId(mood.id)}
                  className={cn(
                    "min-w-0 rounded-lg border p-2 text-left",
                    STUDIO_EASE,
                    STUDIO_FOCUS_RING,
                    STUDIO_TOUCH_TARGET,
                    selectedMood?.id === mood.id
                      ? "border-accent bg-accent-soft"
                      : "border-line bg-card hover:bg-raised",
                  )}
                >
                  <span className="block truncate text-[0.64rem] font-bold">{mood.name}</span>
                  <span className="mt-1 flex h-2.5 overflow-hidden rounded border border-line">
                    {[mood.skyTint, mood.ambientLight, mood.directSun, mood.shadowCast, mood.rimLight].map(
                      (color, index) => (
                        <span
                          key={`${mood.id}-${index}`}
                          className="flex-1"
                          style={{ backgroundColor: color }}
                        />
                      ),
                    )}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {activeTab === "focus-timer" ? (
        <div
          {...studioWorkbenchTabPanelProps(TAB_ID_PREFIX, "focus-timer")}
          className={cn("flex flex-col gap-3 outline-none", STUDIO_FOCUS_RING)}
        >
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="space-y-1 text-[0.62rem] font-semibold text-fg-2">
              제작 공정
              <select
                aria-label="제작 공정"
                value={timerState.activeStage}
                onChange={(event) => {
                  timerEngine.setStage(event.target.value as WebtoonProductionStage);
                  setTimerState(timerEngine.getState());
                }}
                className={FIELD_CLASS}
              >
                {PRODUCTION_STAGES.map((stage) => (
                  <option key={stage.id} value={stage.id}>
                    {stage.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-[0.62rem] font-semibold text-fg-2">
              집중 모드
              <select
                aria-label="집중 모드"
                value={timerState.pomodoroMode}
                onChange={(event) => {
                  timerEngine.setPomodoroMode(event.target.value as PomodoroMode);
                  setTimerState(timerEngine.getState());
                }}
                className={FIELD_CLASS}
              >
                {(Object.keys(POMODORO_CONFIGS) as PomodoroMode[]).map((mode) => (
                  <option key={mode} value={mode}>
                    {POMODORO_LABELS[mode]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="flex flex-col items-center justify-center rounded-xl border border-line bg-card/60 p-4 text-center">
            <span className="rounded-full border border-accent/30 bg-accent-soft px-2 py-1 text-[0.62rem] font-bold text-accent">
              {timerState.isResting ? "휴식" : "집중"} · {POMODORO_LABELS[timerState.pomodoroMode]}
            </span>
            <div className="my-2 font-mono text-4xl font-black tabular-nums text-fg">
              {formatClock(timerState.currentSecondsRemaining)}
            </div>
            <div
              role="progressbar"
              aria-label="현재 세션 진행률"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(timerProgress)}
              className="h-2 w-full overflow-hidden rounded-full bg-raised"
            >
              <span
                className="block h-full rounded-full bg-accent transition-[width] motion-reduce:transition-none"
                style={{ width: `${timerProgress}%` }}
              />
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5 text-[0.6rem] text-fg-3">
              <span>완료 {timerState.completedPomodoros}회</span>
              <span aria-hidden>·</span>
              <span>누적 {timerEngine.getTotalWorkHours()}시간</span>
            </div>
            <div className="mt-3 flex w-full gap-2">
              <button
                type="button"
                onClick={() => {
                  if (timerState.isRunning) timerEngine.pause();
                  else timerEngine.start();
                  setTimerState(timerEngine.getState());
                }}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1 rounded-lg bg-accent px-3 text-xs font-bold text-on-accent",
                  STUDIO_EASE,
                  STUDIO_FOCUS_RING,
                  STUDIO_TOUCH_TARGET,
                )}
              >
                {timerState.isRunning ? (
                  <Pause className="size-3.5" aria-hidden />
                ) : (
                  <Play className="size-3.5" aria-hidden />
                )}
                {timerState.isRunning ? "일시정지" : "시작"}
              </button>
              <button
                type="button"
                onClick={resetTimer}
                className={cn(
                  "rounded-lg border border-line bg-card px-3 text-xs font-semibold text-fg-2 hover:bg-raised hover:text-fg",
                  STUDIO_EASE,
                  STUDIO_FOCUS_RING,
                  STUDIO_TOUCH_TARGET,
                )}
              >
                세션 초기화
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {activeTab === "croquis-pose" ? (
        <div
          {...studioWorkbenchTabPanelProps(TAB_ID_PREFIX, "croquis-pose")}
          className={cn("flex flex-col gap-3 outline-none", STUDIO_FOCUS_RING)}
        >
          <div className="rounded-xl border border-accent/40 bg-accent-soft p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[0.72rem] font-bold text-accent">
                  추천 포즈 · {currentPosePrompt.title}
                </p>
                <p className="mt-1 text-[0.62rem] leading-relaxed text-fg-2">
                  {currentPosePrompt.description}
                </p>
              </div>
              <span className="shrink-0 rounded-full border border-line bg-card px-2 py-1 font-mono text-[0.62rem] font-bold text-fg">
                {currentPosePrompt.lineOfActionCurve}
              </span>
            </div>
            <p className="mt-2 rounded-lg border border-line/70 bg-card/70 p-2 text-[0.6rem] leading-relaxed text-fg-3">
              해부 포인트 · {currentPosePrompt.keyAnatomyFocus}
            </p>
          </div>

          <div className="grid grid-cols-3 gap-1.5">
            {([30, 60, 180] as const).map((interval) => (
              <button
                key={interval}
                type="button"
                aria-pressed={croquisInterval === interval}
                onClick={() => chooseCroquisInterval(interval)}
                className={cn(
                  "rounded-lg border px-2 text-xs font-bold",
                  STUDIO_EASE,
                  STUDIO_FOCUS_RING,
                  STUDIO_TOUCH_TARGET,
                  croquisInterval === interval
                    ? "border-accent bg-accent-soft text-accent"
                    : "border-line bg-card text-fg-2 hover:bg-raised",
                )}
              >
                {interval}초
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 rounded-xl border border-line bg-card p-2.5">
            <span className="min-w-16 font-mono text-2xl font-black tabular-nums text-fg">
              {formatClock(croquisRemaining)}
            </span>
            <button
              type="button"
              onClick={() => {
                if (croquisRemaining === 0) setCroquisRemaining(croquisInterval);
                setCroquisRunning((running) => !running);
              }}
              className={cn(
                "flex flex-1 items-center justify-center gap-1 rounded-lg bg-accent px-3 text-xs font-bold text-on-accent",
                STUDIO_EASE,
                STUDIO_FOCUS_RING,
                STUDIO_TOUCH_TARGET,
              )}
            >
              {croquisRunning ? (
                <Pause className="size-3.5" aria-hidden />
              ) : (
                <Play className="size-3.5" aria-hidden />
              )}
              {croquisRunning ? "일시정지" : "시작"}
            </button>
            <button
              type="button"
              onClick={() => {
                setCroquisRemaining(croquisInterval);
                setCroquisRunning(false);
              }}
              className={cn(
                "rounded-lg border border-line bg-card px-3 text-xs font-semibold text-fg-2 hover:bg-raised",
                STUDIO_EASE,
                STUDIO_FOCUS_RING,
                STUDIO_TOUCH_TARGET,
              )}
            >
              리셋
            </button>
          </div>

          <label className="space-y-1 text-[0.62rem] font-semibold text-fg-2">
            투시 프리셋
            <select
              aria-label="투시 프리셋"
              value={perspectivePreset}
              onChange={(event) =>
                setPerspectivePreset(event.target.value as PerspectiveGuidePreset)
              }
              className={FIELD_CLASS}
            >
              {(Object.keys(PERSPECTIVE_GUIDES) as PerspectiveGuidePreset[]).map((preset) => (
                <option key={preset} value={preset}>
                  {PERSPECTIVE_GUIDES[preset].label}
                </option>
              ))}
            </select>
          </label>

          <div className="grid grid-cols-[7rem_1fr] gap-2 rounded-xl border border-line bg-raised/45 p-2.5">
            <div className="relative min-h-28 overflow-hidden rounded-lg border border-line bg-card">
              <div
                className="absolute inset-x-0 border-t-2 border-accent"
                style={{
                  top: `${perspective.horizonRatioY * 100}%`,
                  transform: `rotate(${perspective.tiltAngleDeg}deg)`,
                }}
              />
              <div className="absolute inset-0 grid place-items-center text-[0.55rem] font-bold text-fg-3">
                소실점 {perspective.vanishingPointCount}개
              </div>
            </div>
            <div className="min-w-0">
              <p className="text-[0.65rem] font-bold text-fg">{perspective.label}</p>
              <p className="mt-1 text-[0.6rem] leading-relaxed text-fg-3">{perspective.tip}</p>
            </div>
          </div>

          <button
            type="button"
            onClick={nextPose}
            className={cn(
              "rounded-lg border border-line bg-card text-[0.65rem] font-semibold text-fg hover:bg-raised",
              STUDIO_EASE,
              STUDIO_FOCUS_RING,
              STUDIO_TOUCH_TARGET,
            )}
          >
            다음 포즈 · 추천 시간 적용
          </button>
        </div>
      ) : null}
    </section>
  );
}