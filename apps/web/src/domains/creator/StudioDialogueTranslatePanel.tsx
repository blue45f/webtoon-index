// 대사 번역(BYOK) 패널 — 캔버스의 말풍선·텍스트 요소를 사용자의 API 키로 다른 언어로 일괄
// 번역한다. draft prop 유무로 두 화면을 자동 전환한다: (A) 생성 화면(대상 언어·용어집 입력 →
// 번역 생성), (B) 검토·적용 화면(원문/번역 나란히, 손으로 고친 뒤 적용). 순수 계산은
// studio-dialogue-translate.ts(청크 분할·프롬프트·병합)와 studio-dialogue-batch.ts(목록화),
// 실제 BYOK 호출은 studio-ai-client.ts, 상태·히스토리 커밋은 StudioPage(메인 루프)가 담당한다.
// 자체완결 플로팅 패널: StudioDialogueBatchPanel과 동일한 셸(우측 상단, Esc로 닫힘).
//
// (C) 현지화 QA 화면 — `qaOpen`이 켜지면 두 화면 대신 그려진다. 문체 린트(영문 규칙표)와 말풍선
// 넘침 예측을 같은 큐 위에서 돌려 MQM 차원별 발견 + 품질 점수 하나를 낸다. 조립은 전부
// lettering/studio-localization-qa.ts(순수)가 하고, 여기서는 측정기만 주입한다 — 초안이 있으면
// **적용 전** 초안을, 없으면 지금 문서에 들어 있는 문자열을 검사한다.
// 보고서는 스냅샷이다: 검사 입력(대사·상자·서체·초안·로케일·테마)의 지문을 함께 저장해 두고,
// 지문이 어긋나면 "다시 검사" 배너를 띄운다. 캔버스에서 말풍선 하나를 옮길 때마다 회차 전체를
// 다시 재지 않으려는 선택이다 — 넘침 판정은 큐마다 글자 폭을 재는 이진 탐색이라 공짜가 아니다.
import { BookOpenCheck, Check, Globe2, Languages, Loader2, ScanText, X } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";

import {
  createCanvasBubbleTextMeasurer,
  type BubbleTextMeasurer,
  type BubbleWebtoonTheme,
} from "./lettering/studio-bubble-text-fit";
import {
  collectDialogueItems,
  isDialogueElement,
  type DialogueBatchItem,
  type DialoguePageLike,
} from "./lettering/studio-dialogue-batch";
import { DIALOGUE_LOCALE_PRESETS, SOURCE_LOCALE, localeLabel } from "./lettering/studio-dialogue-translate";
import {
  runStudioLocalizationQa,
  studioLocalizationQaCueIndex,
  studioLocalizationQaGroups,
  type StudioLocalizationQaElementTypography,
  type StudioLocalizationQaReport as QaReport,
} from "./lettering/studio-localization-qa";
import { STUDIO_FOCUS_RING, STUDIO_TOUCH_TARGET } from "./studio-panel-ui";
import {
  StudioLocalizationQaReport,
  type StudioLocalizationQaDimensionSection,
} from "./StudioLocalizationQaReport";

import { cx } from "@/shared/lib/cx";

/**
 * 호스트가 들고 있는 이 패널의 표시 상태. `false`면 닫힘, 아니면 처음 보여 줄 화면이다 —
 * 메뉴의 두 진입점(텍스트 ▸ 대사 번역 / 텍스트 ▸ 현지화 QA)이 이 값 하나로 갈린다.
 * 별도 boolean 을 하나 더 두지 않는 이유: 호스트 세션 백(any 개수)과 뷰포트 prop 묶음이
 * 래칫으로 동결돼 있어, 새 키 하나가 곧 래칫 위반이다.
 */
export type StudioDialogueTranslateSurface = false | "translate" | "qa";

export type StudioDialogueTranslatePanelProps = {
  /** 전체 페이지(요소·그룹 포함) — StudioPage 의 pages 를 그대로 받는다. */
  pages: readonly DialoguePageLike[];
  /** API 키 설정 완료 여부 — false 면 "번역 생성" 이 비활성화된다(네트워크 요청 없음). */
  configured: boolean;
  providerLabel?: string;
  /** 문서 전체에 지금 "표시 중"인 로케일(SOURCE_LOCALE 포함) — 칩 바 강조 표시 기준. */
  activeLocale: string;
  /** 이미 번역이 하나라도 있는 로케일 코드 목록(등장 순서, SOURCE_LOCALE 제외). */
  availableLocales: string[];
  coverageFor: (locale: string) => { total: number; translated: number };
  targetLocale: string;
  onTargetLocaleChange: (code: string) => void;
  glossary: string;
  onGlossaryChange: (value: string) => void;
  busy: boolean;
  progress: { done: number; total: number } | null;
  error: string | null;
  /** 생성된 번역 초안 — null 이면 생성 화면, 채워지면 검토 화면으로 자동 전환. */
  draft: Map<string, string> | null;
  onGenerate: () => void;
  onDraftChange: (id: string, text: string) => void;
  onApplyDraft: () => void;
  onDiscardDraft: () => void;
  /** 재생성 없이 이미 만들어진 번역 사이를 토글(로케일 칩 클릭). */
  onSwitchLocale: (locale: string) => void;
  onClose: () => void;
  /** Stable local/server document scope used to isolate translation-memory entries. */
  workScope?: string;
  /**
   * 현지화 QA 화면 표시 여부. 넘기면 제어형 — 메뉴(텍스트 ▸ 현지화 QA)가 패널을 QA 화면으로
   * 바로 연다. 안 넘기면 패널이 헤더 토글로 스스로 전환한다(기존 호출부는 그대로 컴파일된다).
   */
  qaOpen?: boolean;
  onQaOpenChange?: (open: boolean) => void;
  /** 말풍선 테마 — 행간·자간 기본값을 고른다. 없으면 리졸버의 안전 기본값을 쓴다. */
  webtoonTheme?: BubbleWebtoonTheme;
  /** 발견 → 캔버스 요소 선택(다른 페이지면 전환). 없으면 초안 화면 안에서만 되짚는다. */
  onRevealCue?: (pageId: string, elId: string) => void;
  /** 글자 폭 측정기 주입 구멍 — 제품 코드는 넘기지 않는다(테스트 seam). */
  measurer?: BubbleTextMeasurer;
};

const StudioDialogueTranslationMemoryPanel = lazy(() =>
  import("./StudioDialogueTranslationMemoryPanel").then((module) => ({
    default: module.StudioDialogueTranslationMemoryPanel,
  }))
);

// select 의 "직접 입력…" 옵션 값 — 실제 로케일 코드로 저장되지 않는 내부 센티널.
const CUSTOM_LOCALE_OPTION = "__custom__";

const inputClass =
  "w-full rounded-lg border border-line bg-card px-2 py-1.5 text-[0.7rem] text-fg outline-none transition-colors placeholder:text-fg-4 focus:border-accent/50";

const localeChipClass = (active: boolean) =>
  cx(
    "rounded-full border px-2 py-0.5 text-[0.62rem] font-medium transition-colors",
    active ? "border-accent bg-accent text-on-accent" : "border-line bg-card text-fg-3 hover:bg-raised"
  );

// ── 현지화 QA 스냅샷 ────────────────────────────────────────────────────────

type QaSnapshot = {
  readonly report: QaReport;
  /** 검사 당시 입력의 지문 — 지금 입력과 다르면 보고서가 낡은 것이다. */
  readonly fingerprint: string;
};

type QaInput = {
  readonly pages: readonly DialoguePageLike[];
  readonly draft: Map<string, string> | null;
  /** 캔버스에 지금 표시 중인 로케일 — 초안 검사 중이고 이 값이 원문이면 요소의 text 가 곧 원문이다. */
  readonly activeLocale: string;
  /** 검사 대상 문자열의 로케일(초안이면 대상 언어, 아니면 표시 중인 언어). */
  readonly locale: string;
  readonly theme: BubbleWebtoonTheme | undefined;
};

/**
 * 검사 입력의 지문. 넘침 판정이 읽는 필드(문자열·상자·서체·세로쓰기·숨김/잠금)를 전부 싣는다 —
 * 하나라도 빠지면 그 필드만 바뀐 회차가 "여전히 통과"로 보인다.
 */
function qaFingerprint(input: QaInput): string {
  const parts: string[] = [input.locale, input.theme ?? ""];
  for (const page of input.pages) {
    for (const el of page.elements) {
      if (!isDialogueElement(el)) continue;
      const typo = el as typeof el & StudioLocalizationQaElementTypography;
      parts.push(
        [
          el.id,
          input.draft?.get(el.id) ?? el.text,
          el.width ?? "",
          el.height ?? "",
          typo.fontSize ?? "",
          typo.font ?? "",
          typo.fontStyle ?? "",
          typo.lineHeight ?? "",
          typo.vertical ? 1 : 0,
          el.hidden ? 1 : 0,
          el.locked ? 1 : 0,
        ].join("\u001f")
      );
    }
  }
  return parts.join("\u001e");
}

/** 순수 조립층을 부르고 지문과 함께 묶는다 — 자동 실행(효과)과 "다시 검사"(클릭)가 같은 길을 탄다. */
function computeQaSnapshot(input: QaInput, measurer: BubbleTextMeasurer): QaSnapshot {
  // 초안 검사 중이고 캔버스가 원문을 보여 주고 있으면 요소의 현재 text 가 원문이다 — 확장률 추정에만
  // 쓰인다. 캔버스가 다른 번역을 보여 주는 중이면 원문을 알 수 없으므로 넘기지 않는다.
  const sourceById =
    input.draft && input.activeLocale === SOURCE_LOCALE
      ? new Map(collectDialogueItems(input.pages).map((item) => [item.id, item.text]))
      : null;
  const report = runStudioLocalizationQa(input.pages, measurer, {
    targetLocale: input.locale,
    ...(input.draft ? { translations: input.draft } : {}),
    ...(sourceById ? { sourceTextFor: (cueId: string) => sourceById.get(cueId) } : {}),
    ...(input.theme === undefined ? {} : { theme: input.theme }),
  });
  return { report, fingerprint: qaFingerprint(input) };
}

function qaSections(report: QaReport): readonly StudioLocalizationQaDimensionSection[] {
  return studioLocalizationQaGroups(report).map((group) => ({
    dimension: group.rollup.dimension,
    label: group.rollup.label,
    penalty: group.rollup.penalty,
    errorCount: group.rollup.errorCount,
    errors: group.errors,
  }));
}

export function StudioDialogueTranslatePanel({
  pages,
  configured,
  providerLabel = "AI",
  activeLocale,
  availableLocales,
  coverageFor,
  targetLocale,
  onTargetLocaleChange,
  glossary,
  onGlossaryChange,
  busy,
  progress,
  error,
  draft,
  onGenerate,
  onDraftChange,
  onApplyDraft,
  onDiscardDraft,
  onSwitchLocale,
  onClose,
  workScope,
  qaOpen,
  onQaOpenChange,
  webtoonTheme,
  onRevealCue,
  measurer,
}: StudioDialogueTranslatePanelProps) {
  const [memoryEntry, setMemoryEntry] = useState<DialogueBatchItem | null>(null);
  // Esc 로 닫기 — 입력 필드 안의 Esc 는 무시한다(StudioDialogueBatchPanel 과 동일 관례).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "TEXTAREA" || target.tagName === "INPUT" || target.isContentEditable)
      ) {
        return;
      }
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // 대상 언어가 프리셋 코드가 아니면(빈 문자열 포함) "직접 입력" 모드 — 별도 로컬 상태 없이
  // targetLocale 값 자체로부터 화면을 파생시킨다(이 패널은 상태를 소유하지 않는다).
  const isPresetTarget = DIALOGUE_LOCALE_PRESETS.some((p) => p.code === targetLocale);
  const items = collectDialogueItems(pages);
  const draftItems = draft ? items.filter((it) => draft.has(it.id)) : [];

  const grouped: { pageId: string; pageIndex: number; items: typeof draftItems }[] = [];
  for (const it of draftItems) {
    const last = grouped[grouped.length - 1];
    if (last && last.pageId === it.pageId) last.items.push(it);
    else grouped.push({ pageId: it.pageId, pageIndex: it.pageIndex, items: [it] });
  }

  const canGenerate = configured && !busy && items.length > 0;
  const resolvedWorkScope = workScope?.trim() || `local:${pages[0]?.id ?? "untitled"}`;

  // ── 현지화 QA — 제어형/비제어형 화면 전환 + 스냅샷 ─────────────────────────
  const [uncontrolledQaOpen, setUncontrolledQaOpen] = useState(false);
  const qaVisible = qaOpen ?? uncontrolledQaOpen;
  const setQaVisible = (open: boolean) => {
    if (qaOpen === undefined) setUncontrolledQaOpen(open);
    onQaOpenChange?.(open);
  };
  const [qaSnapshot, setQaSnapshot] = useState<QaSnapshot | null>(null);
  // 발견 → 초안 행으로 되짚을 때 포커스할 textarea. QA 화면이 닫히고 초안 행이 다시 그려진 뒤에야
  // 요소가 존재하므로 "포커스 대기" 상태로 한 프레임 넘긴다.
  const [pendingFocusId, setPendingFocusId] = useState<string | null>(null);
  const draftRowRefs = useRef(new Map<string, HTMLTextAreaElement>());
  const resolvedMeasurer = useMemo(() => measurer ?? createCanvasBubbleTextMeasurer(), [measurer]);

  // 검사 로케일: 초안이 있으면 초안의 언어, 없으면 캔버스에 지금 표시 중인 언어(원문 포함).
  const qaLocale = draft ? targetLocale : activeLocale;
  const qaInput: QaInput = { pages, draft, activeLocale, locale: qaLocale, theme: webtoonTheme };
  const qaStale = qaVisible && qaSnapshot !== null && qaSnapshot.fingerprint !== qaFingerprint(qaInput);

  // QA 화면이 열렸는데 보고서가 없으면 한 번 자동 실행한다 — 메뉴에서 열었을 때 버튼을 한 번 더
  // 누르게 하지 않는다. 이후 입력이 바뀌면 자동 재실행이 아니라 "다시 검사" 배너다.
  useEffect(() => {
    if (!qaVisible || qaSnapshot !== null) return;
    setQaSnapshot(
      computeQaSnapshot(
        { pages, draft, activeLocale, locale: qaLocale, theme: webtoonTheme },
        resolvedMeasurer
      )
    );
  }, [qaVisible, qaSnapshot, pages, draft, activeLocale, qaLocale, webtoonTheme, resolvedMeasurer]);

  useEffect(() => {
    if (pendingFocusId === null) return;
    const row = draftRowRefs.current.get(pendingFocusId);
    if (row) {
      row.focus();
      if (typeof row.scrollIntoView === "function") row.scrollIntoView({ block: "nearest" });
    }
    setPendingFocusId(null);
  }, [pendingFocusId]);

  const runQa = () => setQaSnapshot(computeQaSnapshot(qaInput, resolvedMeasurer));
  const qaCueIndex = qaSnapshot ? studioLocalizationQaCueIndex(qaSnapshot.report) : null;
  const revealQaCue = (cueId: string) => {
    const cue = qaCueIndex?.get(cueId);
    if (!cue) return;
    onRevealCue?.(cue.pageId, cue.id);
    if (draft?.has(cue.id)) {
      setQaVisible(false);
      setPendingFocusId(cue.id);
    }
  };
  const qaJumpAvailable = draft !== null || onRevealCue !== undefined;
  const qaTargetLabel = draft
    ? `번역 초안(적용 전) · ${localeLabel(targetLocale)}`
    : activeLocale === SOURCE_LOCALE
      ? "문서 원문"
      : `문서 · ${localeLabel(activeLocale)}`;

  return (
    <section
      aria-label="대사 번역"
      className="absolute right-3 top-3 z-40 flex max-h-[calc(100%-5rem)] w-[min(22rem,calc(100%-1.5rem))] flex-col overflow-hidden rounded-xl border border-line bg-panel/95 shadow-xl backdrop-blur"
    >
      <div className="flex items-center justify-between gap-2 border-b border-line/60 px-3 py-2">
        <p className="flex items-center gap-1.5 text-xs font-bold text-fg">
          <Languages size={13} className="text-accent" aria-hidden />
          대사 번역
          <span className="font-medium text-fg-4">· {providerLabel}</span>
        </p>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setQaVisible(!qaVisible)}
            aria-pressed={qaVisible}
            title="현지화 QA — 말풍선 넘침·영문 레터링 문체·MQM 품질 점수"
            className={cx(
              "inline-flex items-center gap-1 rounded-lg border px-2 text-[0.62rem] font-semibold transition-colors",
              qaVisible
                ? "border-accent/35 bg-accent-soft text-accent"
                : "border-line bg-card text-fg-2 hover:bg-raised",
              STUDIO_FOCUS_RING,
              STUDIO_TOUCH_TARGET
            )}
          >
            <ScanText size={12} aria-hidden />
            현지화 QA
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="대사 번역 닫기"
            className="grid size-6 place-items-center rounded-lg border border-line text-fg-2 transition-colors hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      {/* 로케일 칩 바 — 세 화면 공통. 클릭 시 재생성 없이 이미 만들어진 번역 사이를 즉시 토글한다. */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line/60 px-3 py-2">
        <button
          type="button"
          onClick={() => onSwitchLocale(SOURCE_LOCALE)}
          aria-pressed={activeLocale === SOURCE_LOCALE}
          className={localeChipClass(activeLocale === SOURCE_LOCALE)}
        >
          원문
        </button>
        {availableLocales.map((code) => {
          const coverage = coverageFor(code);
          const pct = coverage.total > 0 ? Math.round((coverage.translated / coverage.total) * 100) : 0;
          return (
            <button
              key={code}
              type="button"
              onClick={() => onSwitchLocale(code)}
              aria-pressed={activeLocale === code}
              title={`${localeLabel(code)} · ${coverage.translated}/${coverage.total} 번역됨`}
              className={localeChipClass(activeLocale === code)}
            >
              {localeLabel(code)} <span className="opacity-70">{pct}%</span>
            </button>
          );
        })}
        {availableLocales.length === 0 && (
          <span className="text-[0.62rem] text-fg-4">아직 번역된 언어가 없어요.</span>
        )}
      </div>

      {qaVisible ? (
        // ── C. 현지화 QA 화면 ─────────────────────────────────────────────
        <div className="flex min-h-0 flex-1 flex-col">
          <p className="border-b border-line/60 px-3 py-1.5 text-[0.62rem] text-fg-3">
            검사 대상: <span className="font-medium text-fg-2">{qaTargetLabel}</span>
          </p>
          {qaSnapshot === null ? (
            <p role="status" className="flex items-center gap-1.5 px-3 py-4 text-[0.66rem] text-fg-3">
              <Loader2 size={11} className="animate-spin text-accent motion-reduce:animate-none" aria-hidden />
              검사 준비 중…
            </p>
          ) : (
            <StudioLocalizationQaReport
              report={qaSnapshot.report}
              sections={qaSections(qaSnapshot.report)}
              cueIndex={qaCueIndex ?? new Map()}
              stale={qaStale}
              onRerun={runQa}
              {...(qaJumpAvailable ? { onSelectCue: revealQaCue } : {})}
              jumpLabel={draft ? "초안에서 고치기" : "캔버스에서 선택"}
            />
          )}
        </div>
      ) : draft === null ? (
        // ── A. 생성 화면 ──────────────────────────────────────────────────
        <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-3 py-2.5">
          <div className="space-y-1">
            <label className="block text-[0.66rem] font-medium text-fg-3" htmlFor="dialogue-translate-target">
              대상 언어
            </label>
            {isPresetTarget ? (
              <select
                id="dialogue-translate-target"
                value={targetLocale}
                onChange={(e) => {
                  if (e.target.value === CUSTOM_LOCALE_OPTION) onTargetLocaleChange("");
                  else onTargetLocaleChange(e.target.value);
                }}
                className={inputClass}
              >
                {DIALOGUE_LOCALE_PRESETS.map((p) => (
                  <option key={p.code} value={p.code}>
                    {p.label}
                  </option>
                ))}
                <option value={CUSTOM_LOCALE_OPTION}>직접 입력…</option>
              </select>
            ) : (
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={targetLocale}
                  onChange={(e) => onTargetLocaleChange(e.target.value)}
                  placeholder="언어 코드 또는 이름(예: pt-BR, 베트남어)"
                  aria-label="대상 언어(직접 입력)"
                  className={inputClass}
                />
                <button
                  type="button"
                  onClick={() => onTargetLocaleChange(DIALOGUE_LOCALE_PRESETS[0].code)}
                  className="shrink-0 whitespace-nowrap text-[0.62rem] font-medium text-accent hover:underline"
                >
                  목록에서 선택
                </button>
              </div>
            )}
          </div>

          <div className="space-y-1">
            <label className="block text-[0.66rem] font-medium text-fg-3" htmlFor="dialogue-translate-glossary">
              용어집(선택)
            </label>
            <textarea
              id="dialogue-translate-glossary"
              value={glossary}
              onChange={(e) => onGlossaryChange(e.target.value)}
              placeholder={'예: 주인공 이름은 항상 "Yuna"로 번역해줘'}
              rows={3}
              className={cx(inputClass, "resize-y leading-snug")}
            />
          </div>

          {!configured && (
            <p className="rounded-lg border border-dashed border-line px-2 py-2 text-[0.66rem] leading-relaxed text-fg-4">
              로그인해 서버 AI를 사용하거나 설정에서 내 API 키를 등록하세요.
            </p>
          )}
          {error && (
            <p
              role="alert"
              className="rounded-lg border border-bad/40 bg-bad/10 px-2 py-1.5 text-[0.66rem] leading-relaxed text-bad"
            >
              {error}
            </p>
          )}
          {busy && progress && (
            <p role="status" className="flex items-center gap-1.5 text-[0.66rem] text-fg-3">
              <Loader2 size={11} className="animate-spin text-accent" aria-hidden />
              {progress.done}/{progress.total} 청크 처리 중…
            </p>
          )}

          <button
            type="button"
            onClick={onGenerate}
            disabled={!canGenerate}
            className={cx(
              "flex w-full items-center justify-center gap-1 rounded-lg py-1.5 text-xs font-semibold transition-colors",
              canGenerate ? "bg-accent text-on-accent hover:opacity-90" : "cursor-not-allowed bg-card text-fg-4"
            )}
          >
            {busy ? <Loader2 size={12} className="animate-spin" aria-hidden /> : <Globe2 size={12} aria-hidden />}
            번역 생성
          </button>
          {items.length === 0 && (
            <p className="text-center text-[0.62rem] text-fg-4">번역할 말풍선·텍스트가 없어요.</p>
          )}
        </div>
      ) : (
        // ── B. 검토·적용 화면 ─────────────────────────────────────────────
        <>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2.5">
            {grouped.length === 0 ? (
              <p className="rounded-lg border border-dashed border-line px-2 py-4 text-center text-[0.66rem] leading-relaxed text-fg-4">
                생성된 번역이 없어요.
              </p>
            ) : (
              <div className="space-y-2.5">
                {grouped.map((group) => (
                  <section key={group.pageId} aria-label={`${group.pageIndex + 1}페이지 번역`}>
                    <p className="mb-1 text-[0.62rem] font-semibold uppercase tracking-wide text-fg-3">
                      {group.pageIndex + 1}페이지
                    </p>
                    <ul className="space-y-1.5">
                      {group.items.map((entry) => (
                        <li key={entry.id} className="rounded-lg border border-line bg-card/45 p-1.5">
                          <div className="mb-1 flex min-w-0 items-center gap-1.5">
                            <p className="min-w-0 flex-1 truncate text-[0.64rem] text-fg-4" title={entry.text}>
                              원문: {entry.text}
                            </p>
                            <button
                              type="button"
                              onClick={() => setMemoryEntry(entry)}
                              className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-lg border border-line bg-panel px-2 text-[0.62rem] font-semibold text-fg-2 transition-colors hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                              title="이 대사와 유사한 검토·승인 번역을 찾거나 현재 번역을 로컬 메모리에 저장"
                            >
                              <BookOpenCheck size={12} aria-hidden />
                              메모리
                            </button>
                          </div>
                          <textarea
                            ref={(node) => {
                              if (node) draftRowRefs.current.set(entry.id, node);
                              else draftRowRefs.current.delete(entry.id);
                            }}
                            value={draft.get(entry.id) ?? entry.text}
                            onChange={(e) => onDraftChange(entry.id, e.target.value)}
                            rows={Math.min(4, Math.max(1, (draft.get(entry.id) ?? entry.text).split("\n").length))}
                            aria-label={`${group.pageIndex + 1}페이지 대사 번역 수정`}
                            className={cx(inputClass, "resize-y py-1 leading-snug")}
                          />
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1.5 border-t border-line/60 px-3 py-2">
            <button
              type="button"
              onClick={onDiscardDraft}
              className="flex-1 rounded-lg border border-line bg-card py-1.5 text-xs font-medium text-fg-2 transition-colors hover:bg-raised"
            >
              취소
            </button>
            <button
              type="button"
              onClick={onApplyDraft}
              className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-accent py-1.5 text-xs font-semibold text-on-accent transition-colors hover:opacity-90"
            >
              <Check size={12} aria-hidden /> 적용
            </button>
          </div>
        </>
      )}
      {memoryEntry && draft ? (
        <div className="absolute inset-0 z-50 overflow-y-auto overscroll-contain bg-panel/98 p-2 backdrop-blur">
          <Suspense
            fallback={
              <div
                role="status"
                className="grid min-h-40 place-items-center text-xs text-fg-3"
              >
                번역 메모리를 여는 중…
              </div>
            }
          >
            <StudioDialogueTranslationMemoryPanel
              workScope={resolvedWorkScope}
              sourceText={memoryEntry.text}
              sourceLocale={SOURCE_LOCALE}
              targetLocale={targetLocale}
              sourceRevision={`${memoryEntry.pageId}:${memoryEntry.id}:${memoryEntry.text}`}
              glossaryText={glossary}
              initialTranslation={draft.get(memoryEntry.id) ?? memoryEntry.text}
              onReuse={(translation) => onDraftChange(memoryEntry.id, translation)}
              onClose={() => setMemoryEntry(null)}
            />
          </Suspense>
        </div>
      ) : null}
    </section>
  );
}
