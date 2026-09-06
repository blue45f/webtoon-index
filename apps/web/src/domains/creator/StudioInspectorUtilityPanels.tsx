import {
  ChevronDown,
  ChevronUp,
  LayoutGrid,
  MousePointer2,
  Pipette,
} from "lucide-react";
import { Suspense, useId, useLayoutEffect, useState, type RefObject } from "react";

import { DRAW_COLOR_SWATCHES } from "./brush/studio-draw-color-swatches";
import { StudioApproximateColorPanel } from "./color/StudioApproximateColorPanel";
import { StudioColorHistoryPanel } from "./color/StudioColorHistoryPanel";
import { StudioIntermediateColorPanel } from "./color/StudioIntermediateColorPanel";
import { StudioPageGradePanel } from "./studio-page-lazy-ui";
import {
  STUDIO_WORK_DESCRIPTION_MAX_LENGTH,
  STUDIO_WORK_TAG_MAX_COUNT,
  STUDIO_WORK_TAG_MAX_LENGTH,
  STUDIO_WORK_TITLE_MAX_LENGTH,
  parseStudioWorkTagTokens,
} from "./studio-work-metadata";
import { StudioActiveBrushSummary } from "./StudioActiveBrushSummary";
import { StudioPanelLoading } from "./StudioLazySurfaceFallback";

import type { StudioStabilizerMode } from "./brush/studio-stroke-stabilizer";
import type { StudioInspectorInteractionGate } from "./studio-inspector-interaction-policy";
import type { PageGrade } from "./studio-page-grade";

import { buttonClass } from "@/shared/components/ui/button-utils";
import { cn } from "@/shared/lib/utils";

export function StudioInspectorDisabledReasons({
  reasons,
}: {
  reasons: readonly string[];
}) {
  if (reasons.length === 0) return null;

  return (
    <section
      role="status"
      aria-live="polite"
      className="rounded-xl border border-bad/35 bg-bad/10 px-3 py-2 text-[0.64rem] leading-relaxed text-bad"
    >
      <p className="font-semibold">우측 메뉴가 잠긴 이유</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-4">
        {reasons.map((reason) => (
          <li key={reason}>{reason}</li>
        ))}
      </ul>
    </section>
  );
}

export function StudioInspectorCurrentBrushSummary({
  brushId,
  brushName,
  color,
  opacity,
  stabilizer,
  stabilizerMode,
  strokeWidth,
  tipAngle,
  tipRoundness,
  onOpenBrushCatalog,
}: {
  brushId: string;
  brushName: string;
  color: string;
  opacity: number;
  stabilizer: number;
  stabilizerMode: StudioStabilizerMode;
  strokeWidth: number;
  tipAngle: number;
  tipRoundness: number;
  onOpenBrushCatalog?: (trigger: HTMLButtonElement) => void;
}) {
  return (
    <section
      aria-label="현재 기본 프리셋 요약"
      data-studio-inspector-brush-summary="true"
      className="space-y-1.5"
    >
      <StudioActiveBrushSummary
        brushId={brushId}
        brushName={brushName}
        color={color}
        opacity={opacity}
        stabilizer={stabilizer}
        stabilizerMode={stabilizerMode}
        strokeWidth={strokeWidth}
        tipAngle={tipAngle}
        tipRoundness={tipRoundness}
        label="현재 기본 프리셋"
      />
      <div className="flex items-center justify-between gap-2 px-1">
        <p className="min-w-0 text-[0.62rem] leading-relaxed text-fg-3">
          하단 빠른 바와 같은 브러시 목록을 사용합니다. 선화·번짐·에어 모두 크기·농도·색 조작은 같습니다.
        </p>
        {onOpenBrushCatalog ? (
          <button
            type="button"
            onClick={(event) => onOpenBrushCatalog(event.currentTarget)}
            aria-haspopup="dialog"
            className="hidden min-h-9 shrink-0 items-center gap-1 rounded-md border border-line bg-card px-2 text-[0.62rem] font-semibold text-fg-2 transition-colors hover:border-accent/40 hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent lg:inline-flex"
          >
            <LayoutGrid size={13} aria-hidden />
            기본 브러시
          </button>
        ) : null}
      </div>
    </section>
  );
}

export function StudioInspectorBrushCatalogButton({
  onOpen,
}: {
  onOpen: (trigger: HTMLButtonElement) => void;
}) {
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      // 그리기 ▸ 브러시 프리셋 목록 메뉴 항목이 앵커·복귀 포커스로 되찾는 런처다.
      data-studio-brush-catalog-launcher="true"
      onClick={(event) => onOpen(event.currentTarget)}
      className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-line bg-card px-2.5 text-[0.68rem] font-semibold text-fg-2 transition-colors hover:border-accent/40 hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
    >
      <LayoutGrid size={14} aria-hidden />
      브러시 목록
    </button>
  );
}

export function StudioInspectorDrawColorControls({
  color,
  eyedropperActive,
  onColorChange,
  onEyedropperToggle,
}: {
  color: string;
  eyedropperActive: boolean;
  onColorChange: (color: string) => void;
  onEyedropperToggle: () => void;
}) {
  const [activeCspPalette, setActiveCspPalette] = useState<
    "intermediate" | "approximate" | "history" | null
  >(null);

  return (
    <div className="space-y-1.5 border-t border-line/35 pt-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
          <p className="text-[0.66rem] font-medium text-fg-3 mr-0.5">색상</p>
          <button
            type="button"
            onClick={() =>
              setActiveCspPalette((prev) => (prev === "intermediate" ? null : "intermediate"))
            }
            className={cn(
              "px-1.5 py-0.2 rounded text-[9px] font-medium transition-colors border whitespace-nowrap",
              activeCspPalette === "intermediate"
                ? "bg-indigo-500/20 text-indigo-300 border-indigo-500/40"
                : "text-fg-4 hover:text-fg-2 border-line/40 hover:bg-raised",
            )}
            title="클립스튜디오 4코너 중간색 그리드 팔레트 열기"
          >
            중간색 (CSP)
          </button>
          <button
            type="button"
            onClick={() =>
              setActiveCspPalette((prev) => (prev === "approximate" ? null : "approximate"))
            }
            className={cn(
              "px-1.5 py-0.2 rounded text-[9px] font-medium transition-colors border whitespace-nowrap",
              activeCspPalette === "approximate"
                ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                : "text-fg-4 hover:text-fg-2 border-line/40 hover:bg-raised",
            )}
            title="클립스튜디오 근사색 팔레트 열기"
          >
            근사색 (CSP)
          </button>
          <button
            type="button"
            onClick={() =>
              setActiveCspPalette((prev) => (prev === "history" ? null : "history"))
            }
            className={cn(
              "px-1.5 py-0.2 rounded text-[9px] font-medium transition-colors border whitespace-nowrap",
              activeCspPalette === "history"
                ? "bg-violet-500/20 text-violet-300 border-violet-500/40"
                : "text-fg-4 hover:text-fg-2 border-line/40 hover:bg-raised",
            )}
            title="클립스튜디오 컬러 히스토리 팔레트 열기"
          >
            히스토리 (CSP)
          </button>
        </div>
        <button
          type="button"
          onClick={onEyedropperToggle}
          aria-pressed={eyedropperActive}
          aria-label={
            eyedropperActive
              ? "스포이드 끄기"
              : "스포이드로 캔버스 색상 선택"
          }
          title="스포이드 — 캔버스를 클릭해 그 지점의 색을 그대로 가져와요 (펜 도구 중엔 Alt+클릭으로도 가능)"
          className={cn(
            "grid size-11 place-items-center rounded-lg border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent lg:size-5 lg:rounded",
            eyedropperActive
              ? "border-accent bg-accent/15 text-accent"
              : "border-line text-fg-3 hover:bg-raised"
          )}
        >
          <Pipette className="size-3" aria-hidden />
        </button>
      </div>
      <div className="flex flex-wrap gap-1">
        {DRAW_COLOR_SWATCHES.map((swatch) => (
          <button
            key={swatch}
            type="button"
            onClick={() => onColorChange(swatch)}
            aria-pressed={color.toLowerCase() === swatch.toLowerCase()}
            className="group grid size-11 place-items-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent lg:size-5 lg:rounded"
            title={swatch}
            aria-label={`${swatch} 색상 선택`}
          >
            <span
              aria-hidden
              className={cn(
                "block size-5 rounded border transition-transform group-hover:scale-110",
                color.toLowerCase() === swatch.toLowerCase()
                  ? "ring-2 ring-accent ring-offset-1 ring-offset-panel"
                  : "border-line/60"
              )}
              style={{ background: swatch }}
            />
          </button>
        ))}
        <label
          className="relative grid size-11 cursor-pointer place-items-center rounded-lg focus-within:ring-2 focus-within:ring-accent lg:size-5 lg:rounded"
          title="사용자 정의 색상"
        >
          <input
            type="color"
            value={color}
            onChange={(event) => onColorChange(event.target.value)}
            className="absolute inset-0 size-full cursor-pointer opacity-0"
            aria-label="사용자 정의 색상 선택"
          />
          <span
            aria-hidden
            className="grid size-5 select-none place-items-center overflow-hidden rounded border border-line text-[8px] font-bold text-white shadow-sm"
            style={{ background: color }}
          >
            <span className="mix-blend-difference">C</span>
          </span>
        </label>
      </div>
      {activeCspPalette === "intermediate" && (
        <div className="pt-1">
          <StudioIntermediateColorPanel
            activeColor={color}
            onSelectColor={onColorChange}
          />
        </div>
      )}
      {activeCspPalette === "approximate" && (
        <div className="pt-1">
          <StudioApproximateColorPanel
            activeColor={color}
            onSelectColor={onColorChange}
          />
        </div>
      )}
      {activeCspPalette === "history" && (
        <div className="pt-1">
          <StudioColorHistoryPanel
            activeColor={color}
            onSelectColor={onColorChange}
          />
        </div>
      )}
    </div>
  );
}

export function StudioInspectorMutationLockNotice({
  gate,
  hasActiveSession,
  onExit,
}: {
  gate: StudioInspectorInteractionGate;
  hasActiveSession: boolean;
  onExit: () => void;
}) {
  if (!gate.disabled || !hasActiveSession) return null;

  return (
    <div
      role="status"
      className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warn/35 bg-warn/10 px-2.5 py-2 text-[0.66rem] text-fg-2"
    >
      <span className="min-w-0 flex-1">{gate.reason}</span>
      <button
        type="button"
        data-studio-inspector-emergency-exit="true"
        onClick={onExit}
        className={buttonClass({
          size: "sm",
          variant: "quiet",
          className: "shrink-0",
        })}
      >
        활성 도구 종료
      </button>
    </div>
  );
}

export function StudioInspectorPageGradeSurface({
  active,
  expanded,
  grade,
  gradeActive,
  gate,
  onApplyPreset,
  onExpandedChange,
  onPatch,
  onReset,
  panelId,
  panelLabelledBy,
}: {
  active: boolean;
  expanded: boolean;
  grade: PageGrade;
  gradeActive: boolean;
  gate: StudioInspectorInteractionGate;
  onApplyPreset: (grade: PageGrade) => void;
  onExpandedChange: (expanded: boolean) => void;
  onPatch: (patch: Partial<PageGrade>) => void;
  onReset: () => void;
  panelId?: string;
  panelLabelledBy?: string;
}) {
  const contentId = useId();

  return (
    <div
      id={panelId}
      role="tabpanel"
      aria-label={panelLabelledBy ? undefined : "페이지 색보정"}
      aria-labelledby={panelLabelledBy}
      hidden={!active}
      className="rounded-xl border border-line bg-panel/40 p-3"
    >
      {expanded ? (
        <>
          <div className="mb-2 flex justify-end">
            <button
              type="button"
              onClick={() => onExpandedChange(false)}
              aria-expanded={true}
              aria-controls={contentId}
              className="inline-flex items-center gap-0.5 rounded text-[0.68rem] text-fg-3 transition-colors hover:text-fg"
              title="색보정 패널 접기"
            >
              접기 <ChevronUp size={13} aria-hidden />
            </button>
          </div>
          <div id={contentId}>
            <Suspense fallback={<StudioPanelLoading label="색보정 패널을 여는 중..." />}>
              <fieldset
                disabled={gate.disabled}
                aria-disabled={gate.disabled}
                title={gate.reason}
                className="m-0 min-w-0 border-0 p-0 disabled:[&_button]:cursor-not-allowed disabled:[&_button]:opacity-50 disabled:[&_input]:cursor-not-allowed disabled:[&_input]:opacity-55"
              >
                <legend className="sr-only">페이지 색보정 설정</legend>
                <StudioPageGradePanel
                  grade={grade}
                  onPatch={onPatch}
                  onApplyPreset={onApplyPreset}
                  onReset={onReset}
                />
              </fieldset>
            </Suspense>
          </div>
        </>
      ) : (
        <>
          <button
            type="button"
            onClick={() => onExpandedChange(true)}
            aria-expanded={false}
            aria-controls={contentId}
            className="flex w-full items-center justify-between gap-3 rounded-xl border border-line/70 bg-card/65 px-3 py-2 text-left transition-colors hover:bg-raised"
          >
            <span className="min-w-0">
              <span className="block text-[0.66rem] font-semibold uppercase tracking-wider text-fg-3">
                페이지 색보정
              </span>
              <span className="mt-0.5 block text-xs text-fg-2">
                {gradeActive ? "보정 적용됨" : "무드 프리셋·밝기·대비"}
              </span>
            </span>
            <ChevronDown size={14} aria-hidden className="shrink-0 text-fg-3" />
          </button>
          <div id={contentId} hidden />
        </>
      )}
    </div>
  );
}

export function StudioInspectorEmptySelection({
  visible,
}: {
  visible: boolean;
}) {
  if (!visible) return null;

  return (
    <div
      role="tabpanel"
      aria-label="선택 요소 속성"
      className="rounded-xl border border-line bg-panel/40 px-4 py-8 text-center"
    >
      <div className="mx-auto mb-2 grid size-11 place-items-center rounded-xl border border-line bg-card text-fg-3">
        <MousePointer2 size={20} aria-hidden />
      </div>
      <p className="text-pretty text-xs font-semibold text-fg-2">
        편집할 요소를 선택하세요
      </p>
      <p className="mx-auto mt-1.5 max-w-[30ch] text-pretty text-[0.68rem] leading-relaxed text-fg-3">
        캔버스에서 프레임·말풍선·획을 고르면 여기에 기본·전문 설정이 나타납니다. 펜 도구(B)로
        바로 그릴 수도 있어요.
      </p>
      <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5 text-[0.62rem] text-fg-3">
        <span className="rounded-full border border-line bg-card px-2 py-1 font-semibold">
          레이어 탭 · 순서
        </span>
        <span className="rounded-full border border-line bg-card px-2 py-1 font-semibold">
          검색 · 채우기/마스크
        </span>
        <span className="rounded-full border border-line bg-card px-2 py-1 font-semibold">
          게시 · 내보내기
        </span>
      </div>
    </div>
  );
}

export function StudioInspectorPublishPanel({
  active,
  autoFocusTitle,
  description,
  pendingSaveIntent,
  readOnly,
  saving,
  tags,
  title,
  titleInputRef,
  onContinuePendingSave,
  onDescriptionChange,
  onTagsChange,
  onTitleChange,
  panelId,
  panelLabelledBy,
}: {
  active: boolean;
  autoFocusTitle: boolean;
  description: string;
  pendingSaveIntent: "draft" | "published" | null;
  readOnly: boolean;
  saving: boolean;
  tags: string;
  title: string;
  titleInputRef: RefObject<HTMLInputElement | null>;
  onContinuePendingSave: () => void;
  onDescriptionChange: (value: string) => void;
  onTagsChange: (value: string) => void;
  onTitleChange: (value: string) => void;
  panelId?: string;
  panelLabelledBy?: string;
}) {
  const fieldId = useId();
  const titleId = `${fieldId}-title`;
  const titleHelpId = `${titleId}-help`;
  const descriptionId = `${fieldId}-description`;
  const descriptionHelpId = `${descriptionId}-help`;
  const tagsId = `${fieldId}-tags`;
  const tagsHelpId = `${tagsId}-help`;
  const parsedTags = parseStudioWorkTagTokens(tags);
  const titleOverLength = title.length > STUDIO_WORK_TITLE_MAX_LENGTH;
  const descriptionOverLength =
    description.length > STUDIO_WORK_DESCRIPTION_MAX_LENGTH;
  const titleInvalid =
    titleOverLength || (pendingSaveIntent !== null && !title.trim());
  const tagsOverCount = parsedTags.length > STUDIO_WORK_TAG_MAX_COUNT;
  const tagsOverLength = parsedTags.some(
    (tag) => tag.length > STUDIO_WORK_TAG_MAX_LENGTH,
  );
  const tagsInvalid = tagsOverCount || tagsOverLength;
  const continueLabel =
    pendingSaveIntent === "published" ? "게시 계속" : "초안 저장 계속";

  useLayoutEffect(() => {
    if (!active || !autoFocusTitle) return;
    titleInputRef.current?.focus({ preventScroll: true });
  }, [active, autoFocusTitle, titleInputRef]);

  return (
    <form
      id={panelId}
      role="tabpanel"
      aria-label={panelLabelledBy ? undefined : "작품 정보"}
      aria-labelledby={panelLabelledBy}
      hidden={!active}
      className="rounded-xl border border-line bg-panel/40 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (
          pendingSaveIntent === null
          || readOnly
          || saving
          || titleInvalid
          || descriptionOverLength
          || tagsInvalid
        ) return;
        onContinuePendingSave();
      }}
    >
      <p className="text-xs font-semibold text-fg">작품 정보</p>
      <p className="mt-0.5 text-[0.65rem] leading-relaxed text-fg-3">
        초안 저장과 게시에 함께 쓰는 기본 정보입니다.
      </p>
      <label
        htmlFor={titleId}
        className="mt-3 block text-[0.7rem] font-semibold text-fg-2"
      >
        작품 제목 (필수)
      </label>
      <input
        id={titleId}
        ref={titleInputRef}
        value={title}
        onChange={(event) => onTitleChange(event.target.value)}
        aria-describedby={titleHelpId}
        aria-invalid={titleInvalid || undefined}
        aria-required="true"
        placeholder="작품 제목"
        required
        maxLength={STUDIO_WORK_TITLE_MAX_LENGTH}
        spellCheck
        readOnly={readOnly}
        className="mt-1 w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-fg focus-visible:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent read-only:cursor-default read-only:text-fg-2"
      />
      <p
        id={titleHelpId}
        className={cn("mt-1 text-[0.62rem]", titleOverLength ? "text-bad" : "text-fg-3")}
      >
        {titleOverLength
          ? `${title.length}/${STUDIO_WORK_TITLE_MAX_LENGTH}자 · ${STUDIO_WORK_TITLE_MAX_LENGTH}자 이하로 줄여 주세요.`
          : `초안 저장과 게시에 공통으로 사용됩니다. ${title.length}/${STUDIO_WORK_TITLE_MAX_LENGTH}자`}
      </p>

      <fieldset className="mt-3 border-t border-line/70 pt-3">
        <legend className="pr-2 text-[0.7rem] font-semibold text-fg-2">
          게시용 정보 (선택)
        </legend>
        <label
          htmlFor={descriptionId}
          className="mt-1 block text-[0.68rem] font-medium text-fg-2"
        >
          게시용 설명
        </label>
        <textarea
          id={descriptionId}
          value={description}
          onChange={(event) => onDescriptionChange(event.target.value)}
          aria-describedby={descriptionHelpId}
          aria-invalid={descriptionOverLength || undefined}
          placeholder="작품을 소개해 주세요."
          maxLength={STUDIO_WORK_DESCRIPTION_MAX_LENGTH}
          spellCheck
          rows={3}
          readOnly={readOnly}
          className="mt-1 w-full resize-y rounded-lg border border-line bg-card px-3 py-2 text-sm text-fg focus-visible:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent read-only:cursor-default read-only:text-fg-2"
        />
        <p
          id={descriptionHelpId}
          className={cn(
            "mt-1 text-right text-[0.62rem]",
            descriptionOverLength ? "text-bad" : "text-fg-3",
          )}
        >
          {description.length.toLocaleString("ko-KR")}/{STUDIO_WORK_DESCRIPTION_MAX_LENGTH.toLocaleString("ko-KR")}자
          {descriptionOverLength ? " · 입력 제한 이하로 줄여 주세요." : null}
        </p>

        <label
          htmlFor={tagsId}
          className="mt-2 block text-[0.68rem] font-medium text-fg-2"
        >
          게시용 태그
        </label>
        <input
          id={tagsId}
          value={tags}
          onChange={(event) => onTagsChange(event.target.value)}
          aria-describedby={tagsHelpId}
          aria-invalid={tagsInvalid || undefined}
          placeholder="로맨스, 일상"
          readOnly={readOnly}
          className="mt-1 w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-fg focus-visible:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent read-only:cursor-default read-only:text-fg-2"
        />
        <p
          id={tagsHelpId}
          className={cn("mt-1 text-[0.62rem]", tagsInvalid ? "text-bad" : "text-fg-3")}
        >
          {tagsOverCount
            ? `${parsedTags.length}개 입력됨 · 최대 ${STUDIO_WORK_TAG_MAX_COUNT}개까지 입력할 수 있어요.`
            : tagsOverLength
              ? `태그 하나는 ${STUDIO_WORK_TAG_MAX_LENGTH}자 이하여야 합니다.`
              : `최대 ${STUDIO_WORK_TAG_MAX_COUNT}개 · 태그당 ${STUDIO_WORK_TAG_MAX_LENGTH}자 · 쉼표 또는 공백으로 구분`}
        </p>
      </fieldset>

      {pendingSaveIntent ? (
        <div className="mt-3 rounded-lg border border-accent/35 bg-accent-soft/45 p-2.5">
          <p className="text-[0.65rem] leading-relaxed text-fg-2">
            필수 정보와 입력 제한을 확인하면 요청한 저장 흐름을 여기서 바로 이어갈 수 있어요.
          </p>
          <button
            type="submit"
            disabled={
              readOnly
              || saving
              || !title.trim()
              || titleOverLength
              || descriptionOverLength
              || tagsInvalid
            }
            className={buttonClass({
              size: "md",
              variant: "solid",
              className: "mt-2 w-full pointer-coarse:min-h-11",
            })}
          >
            {saving ? "저장 중…" : continueLabel}
          </button>
        </div>
      ) : null}
    </form>
  );
}
