import {
  Check,
  ChevronLeft,
  ChevronRight,
  LayoutPanelTop,
  MessageSquareText,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { cn } from "../../../shared/lib/utils";
import { PANEL_LAYOUTS, type PanelLayoutPreset } from "../studio-panel-layouts";
import {
  SCENE_TEMPLATE_CATEGORIES,
  SCENE_TEMPLATES,
} from "../studio-scene-templates";

import {
  clampQuickComicStep,
  createQuickComicDraft,
  createQuickComicPreview,
  QUICK_COMIC_STEPS,
  type QuickComicDraft,
} from "./studio-quick-comic-plan";

import type { ComipoAssemblyInput } from "../studio-comipo-assembly";

export interface StudioQuickComicWizardProps {
  onApply: (input: ComipoAssemblyInput) => void;
  onCancel: () => void;
}

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

function LayoutThumbnail({
  layout,
  className,
}: {
  layout: PanelLayoutPreset;
  className?: string;
}) {
  return (
    <svg
      viewBox={`0 0 720 ${Math.max(1, layout.canvasH)}`}
      preserveAspectRatio="xMidYMid meet"
      className={cn("h-20 w-16 shrink-0 rounded-md bg-canvas p-1", className)}
      aria-hidden="true"
      focusable="false"
    >
      {layout.frames.map((frame, index) => (
        <rect
          key={`${frame.x}-${frame.y}-${index}`}
          x={frame.x}
          y={frame.y}
          width={frame.width}
          height={frame.height}
          rx="8"
          className="fill-panel stroke-fg-3"
          strokeWidth="8"
        />
      ))}
    </svg>
  );
}

export function StudioQuickComicWizard({
  onApply,
  onCancel,
}: StudioQuickComicWizardProps) {
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<QuickComicDraft>(createQuickComicDraft);
  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  const preview = createQuickComicPreview(draft);
  const currentStep = QUICK_COMIC_STEPS[step]!;
  const selectedLayout =
    PANEL_LAYOUTS.find((layout) => layout.id === draft.layoutId) ?? PANEL_LAYOUTS[0]!;
  const selectedScene =
    draft.sceneTemplateId
      ? SCENE_TEMPLATES.find((scene) => scene.id === draft.sceneTemplateId) ?? null
      : null;
  const canApply = Boolean(preview?.assembly.composable);

  const cancelFromEffect = useEffectEvent(onCancel);
  const applyFromEffect = useEffectEvent(() => {
    if (step === QUICK_COMIC_STEPS.length - 1 && preview?.assembly.composable) {
      onApply(preview.input);
    }
  });

  useEffect(() => {
    if (typeof document === "undefined") return;
    openerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousBodyOverflow = document.body.style.overflow;
    const previousRootOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";

    const overlay = overlayRef.current;
    const inertStates: Array<readonly [HTMLElement, boolean]> = [];
    for (const child of document.body.children) {
      if (!(child instanceof HTMLElement) || child === overlay) continue;
      inertStates.push([child, child.inert]);
      child.inert = true;
    }

    const focusFrame = requestAnimationFrame(() => {
      closeButtonRef.current?.focus({ preventScroll: true });
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        cancelFromEffect();
        return;
      }
      if (event.altKey && event.key === "ArrowLeft") {
        event.preventDefault();
        setStep((current) => clampQuickComicStep(current - 1));
        return;
      }
      if (event.altKey && event.key === "ArrowRight") {
        event.preventDefault();
        setStep((current) => clampQuickComicStep(current + 1));
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        applyFromEffect();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = [
        ...(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? []),
      ].filter((element) => !element.hidden);
      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current?.focus({ preventScroll: true });
        return;
      }
      const first = focusable[0]!;
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown, true);
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousRootOverflow;
      for (const [element, wasInert] of inertStates) element.inert = wasInert;
      const opener = openerRef.current;
      openerRef.current = null;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  function selectLayout(layout: PanelLayoutPreset): void {
    setDraft((current) => ({
      ...current,
      layoutId: layout.id,
      sceneFrameIndex: Math.min(
        current.sceneFrameIndex,
        Math.max(0, layout.frames.length - 1)
      ),
    }));
  }

  function goBack(): void {
    setStep((current) => clampQuickComicStep(current - 1));
  }

  function goNext(): void {
    setStep((current) => clampQuickComicStep(current + 1));
  }

  function applyPlan(): void {
    if (preview?.assembly.composable) onApply(preview.input);
  }

  const content = (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[110] flex items-end justify-center bg-canvas/80 sm:items-center sm:p-5"
      data-studio-quick-comic-overlay="true"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="studio-quick-comic-title"
        aria-describedby="studio-quick-comic-description"
        data-studio-modal-owner="quick-comic"
        data-studio-shortcut-boundary="true"
        tabIndex={-1}
        className="relative flex max-h-[calc(100dvh-env(safe-area-inset-top))] min-h-0 w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl border border-line bg-panel text-fg shadow-2xl sm:max-h-[min(46rem,calc(100dvh-2.5rem))] sm:rounded-2xl"
      >
        <header className="shrink-0 border-b border-line bg-panel px-4 pb-3 pt-3 sm:px-5 sm:pt-4">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
              <Sparkles size={19} aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 id="studio-quick-comic-title" className="text-base font-bold text-fg">
                빠른 웹툰 조립
              </h2>
              <p
                id="studio-quick-comic-description"
                className="mt-0.5 max-w-[65ch] text-xs leading-relaxed text-fg-3"
              >
                컷·장면 연출·대사를 순서대로 골라 한 페이지를 만듭니다. 캐릭터 생성은
                포함하지 않아요.
              </p>
            </div>
            <button
              ref={closeButtonRef}
              type="button"
              onClick={onCancel}
              className="grid size-11 shrink-0 place-items-center rounded-xl border border-line bg-card text-fg-2 transition-colors hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              aria-label="빠른 웹툰 조립 취소"
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>

          <div className="mt-3 flex items-center gap-3">
            <div
              role="progressbar"
              aria-label="빠른 웹툰 조립 진행률"
              aria-valuemin={1}
              aria-valuemax={QUICK_COMIC_STEPS.length}
              aria-valuenow={step + 1}
              aria-valuetext={`${step + 1}단계, ${currentStep.label}`}
              className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-card"
            >
              <span
                className="block h-full rounded-full bg-accent transition-[width] duration-200 ease-out-expo motion-reduce:transition-none"
                style={{ width: `${((step + 1) / QUICK_COMIC_STEPS.length) * 100}%` }}
              />
            </div>
            <p className="shrink-0 text-xs font-semibold text-fg-2" aria-live="polite">
              {step + 1}/{QUICK_COMIC_STEPS.length} · {currentStep.label}
            </p>
          </div>
        </header>

        <main
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5"
          data-studio-quick-comic-scroll-body="true"
        >
          {step === 0 ? (
            <section aria-labelledby="quick-comic-layout-heading">
              <div className="mb-4">
                <h3 id="quick-comic-layout-heading" className="text-sm font-bold text-fg">
                  컷 흐름을 고르세요
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-fg-3">
                  적용하면 현재 페이지 크기와 컷 구성이 선택한 레이아웃으로 바뀝니다.
                </p>
              </div>
              <fieldset className="grid gap-2 sm:grid-cols-2">
                <legend className="sr-only">컷 레이아웃</legend>
                {PANEL_LAYOUTS.map((layout) => {
                  const selected = layout.id === draft.layoutId;
                  return (
                    <label
                      key={layout.id}
                      className={cn(
                        "flex min-h-24 cursor-pointer items-center gap-3 rounded-xl border p-3 transition-colors focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent",
                        selected
                          ? "border-accent bg-accent-soft"
                          : "border-line bg-card hover:border-line-strong hover:bg-raised"
                      )}
                    >
                      <input
                        type="radio"
                        name="quick-comic-layout"
                        value={layout.id}
                        checked={selected}
                        onChange={() => selectLayout(layout)}
                        className="sr-only"
                      />
                      <LayoutThumbnail layout={layout} />
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5 text-sm font-semibold text-fg">
                          {layout.label}
                          {selected ? <Check size={15} className="text-accent" aria-hidden="true" /> : null}
                        </span>
                        <span className="mt-1 block text-xs leading-relaxed text-fg-3">
                          {layout.hint} · {layout.frames.length}컷
                        </span>
                      </span>
                    </label>
                  );
                })}
              </fieldset>
            </section>
          ) : null}

          {step === 1 ? (
            <section aria-labelledby="quick-comic-scene-heading">
              <div className="mb-4">
                <h3 id="quick-comic-scene-heading" className="text-sm font-bold text-fg">
                  장면 연출을 더할까요?
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-fg-3">
                  효과선·예시 말풍선·효과음으로 구성된 연출 템플릿입니다. 캐릭터나 3D
                  배경을 자동 생성하지 않습니다.
                </p>
              </div>

              <fieldset>
                <legend className="sr-only">장면 연출 템플릿</legend>
                <label
                  className={cn(
                    "flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent",
                    draft.sceneTemplateId === null
                      ? "border-accent bg-accent-soft"
                      : "border-line bg-card hover:border-line-strong hover:bg-raised"
                  )}
                >
                  <input
                    type="radio"
                    name="quick-comic-scene"
                    checked={draft.sceneTemplateId === null}
                    onChange={() =>
                      setDraft((current) => ({
                        ...current,
                        sceneTemplateId: null,
                        sceneFrameIndex: 0,
                      }))
                    }
                    className="sr-only"
                  />
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-panel text-fg-3">
                    <LayoutPanelTop size={18} aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-fg">장면 없음</span>
                    <span className="mt-0.5 block text-xs text-fg-3">
                      빈 컷과 입력한 대사만 배치
                    </span>
                  </span>
                  {draft.sceneTemplateId === null ? (
                    <Check size={16} className="shrink-0 text-accent" aria-hidden="true" />
                  ) : null}
                </label>

                {SCENE_TEMPLATE_CATEGORIES.map((category) => {
                  const scenes = SCENE_TEMPLATES.filter(
                    (scene) => scene.category === category.id
                  );
                  return (
                    <div key={category.id} className="mt-4">
                      <p className="mb-2 text-xs font-bold text-fg-2">{category.label}</p>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {scenes.map((scene) => {
                          const selected = scene.id === draft.sceneTemplateId;
                          return (
                            <label
                              key={scene.id}
                              className={cn(
                                "flex min-h-20 cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent",
                                selected
                                  ? "border-accent bg-accent-soft"
                                  : "border-line bg-card hover:border-line-strong hover:bg-raised"
                              )}
                            >
                              <input
                                type="radio"
                                name="quick-comic-scene"
                                value={scene.id}
                                checked={selected}
                                onChange={() =>
                                  setDraft((current) => ({
                                    ...current,
                                    sceneTemplateId: scene.id,
                                  }))
                                }
                                className="sr-only"
                              />
                              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-panel text-accent">
                                <Sparkles size={17} aria-hidden="true" />
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="flex items-center gap-1.5 text-sm font-semibold text-fg">
                                  {scene.label}
                                  {selected ? (
                                    <Check size={15} className="text-accent" aria-hidden="true" />
                                  ) : null}
                                </span>
                                <span className="mt-1 block text-xs leading-relaxed text-fg-3">
                                  {scene.description}
                                </span>
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </fieldset>

              {selectedScene ? (
                <label className="mt-4 block rounded-xl border border-line bg-card p-3">
                  <span className="block text-xs font-semibold text-fg-2">
                    장면을 넣을 컷
                  </span>
                  <select
                    value={draft.sceneFrameIndex}
                    onChange={(event) => {
                      const sceneFrameIndex = Number(event.currentTarget.value);
                      setDraft((current) => ({
                        ...current,
                        sceneFrameIndex,
                      }));
                    }}
                    className="mt-2 min-h-11 w-full rounded-xl border border-line-strong bg-panel px-3 text-sm font-semibold text-fg outline-none focus:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    {selectedLayout.frames.map((_, index) => (
                      <option key={index} value={index}>
                        {index + 1}번째 컷
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </section>
          ) : null}

          {step === 2 ? (
            <section aria-labelledby="quick-comic-dialogue-heading">
              <div className="mb-4 flex items-start gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
                  <MessageSquareText size={19} aria-hidden="true" />
                </span>
                <div>
                  <h3 id="quick-comic-dialogue-heading" className="text-sm font-bold text-fg">
                    대사를 붙여 넣으세요
                  </h3>
                  <p className="mt-1 text-xs leading-relaxed text-fg-3">
                    한 줄에 한 대사씩 입력하세요. ‘이름: 대사’는 화자별 좌우를 유지하고,
                    [나레이션]은 박스형으로 배치합니다.
                  </p>
                </div>
              </div>
              <label className="block">
                <span className="sr-only">웹툰 대사</span>
                <textarea
                  value={draft.dialogueScript}
                  onChange={(event) => {
                    const dialogueScript = event.currentTarget.value;
                    setDraft((current) => ({
                      ...current,
                      dialogueScript,
                    }));
                  }}
                  rows={11}
                  spellCheck={false}
                  placeholder={"민수: 늦어서 미안해.\n지영: 무슨 일 있었어?\n[잠시 후]"}
                  className="min-h-52 w-full resize-y rounded-xl border border-line-strong bg-card px-3 py-3 text-sm leading-relaxed text-fg outline-none placeholder:text-fg-3 focus:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                />
              </label>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-fg-3">
                <p>대사를 비워 두어도 다음 단계로 갈 수 있어요.</p>
                <p aria-live="polite">
                  인식된 대사 <strong className="text-fg">{preview?.dialogueCount ?? 0}개</strong>
                </p>
              </div>
              {selectedScene && draft.dialogueScript.trim() ? (
                <p className="mt-3 rounded-xl border border-line bg-card px-3 py-2.5 text-xs leading-relaxed text-fg-2">
                  대사를 입력하면 ‘{selectedScene.label}’의 예시 말풍선 대신 입력한 대사가 컷
                  순서대로 배치됩니다.
                </p>
              ) : null}
            </section>
          ) : null}

          {step === 3 ? (
            <section aria-labelledby="quick-comic-review-heading">
              <div className="mb-4">
                <h3 id="quick-comic-review-heading" className="text-sm font-bold text-fg">
                  적용할 페이지를 확인하세요
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-fg-3">
                  적용 후에도 캔버스에서 컷, 말풍선, 효과를 각각 편집할 수 있습니다.
                </p>
              </div>

              {preview ? (
                <div className="grid gap-4 sm:grid-cols-[11rem_minmax(0,1fr)]">
                  <div className="flex min-h-56 items-center justify-center rounded-xl border border-line bg-canvas p-4">
                    <LayoutThumbnail
                      layout={preview.layout}
                      className="h-48 w-36 bg-panel shadow-sm"
                    />
                  </div>
                  <dl className="divide-y divide-line rounded-xl border border-line bg-card px-3">
                    <div className="flex min-h-11 items-center justify-between gap-4 py-2">
                      <dt className="text-xs text-fg-3">레이아웃</dt>
                      <dd className="text-right text-sm font-semibold text-fg">
                        {preview.layout.label}
                      </dd>
                    </div>
                    <div className="flex min-h-11 items-center justify-between gap-4 py-2">
                      <dt className="text-xs text-fg-3">컷</dt>
                      <dd className="text-sm font-semibold text-fg">
                        {preview.assembly.frameCount}개
                      </dd>
                    </div>
                    <div className="flex min-h-11 items-center justify-between gap-4 py-2">
                      <dt className="text-xs text-fg-3">장면 연출</dt>
                      <dd className="text-right text-sm font-semibold text-fg">
                        {preview.scene
                          ? `${preview.scene.label} · ${(preview.input.sceneFrameIndex ?? 0) + 1}번째 컷`
                          : "없음"}
                      </dd>
                    </div>
                    <div className="flex min-h-11 items-center justify-between gap-4 py-2">
                      <dt className="text-xs text-fg-3">대사</dt>
                      <dd className="text-sm font-semibold text-fg">
                        {preview.dialogueCount}개
                      </dd>
                    </div>
                    <div className="flex min-h-11 items-center justify-between gap-4 py-2">
                      <dt className="text-xs text-fg-3">말풍선 결과</dt>
                      <dd className="text-sm font-semibold text-fg">
                        {preview.assembly.bubbleCount}개
                      </dd>
                    </div>
                    <div className="flex min-h-11 items-center justify-between gap-4 py-2">
                      <dt className="text-xs text-fg-3">페이지 높이</dt>
                      <dd className="text-sm font-semibold tabular-nums text-fg">
                        {preview.assembly.canvasH.toLocaleString("ko-KR")}px
                      </dd>
                    </div>
                  </dl>
                </div>
              ) : (
                <p role="alert" className="rounded-xl border border-danger/45 bg-danger/10 p-3 text-sm text-danger">
                  선택한 구성을 읽지 못했습니다. 이전 단계에서 레이아웃을 다시 골라 주세요.
                </p>
              )}

              {preview && !preview.assembly.composable ? (
                <p role="alert" className="mt-4 rounded-xl border border-warning/45 bg-warning/10 p-3 text-xs leading-relaxed text-fg">
                  현재 대사와 장면이 컷 안에서 겹칠 수 있습니다. 대사를 줄이거나 더 여유 있는
                  레이아웃을 골라 주세요.
                </p>
              ) : null}
            </section>
          ) : null}
        </main>

        <footer
          className="flex shrink-0 items-center gap-2 border-t border-line bg-panel px-4 py-3 sm:px-5"
          style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
        >
          <button
            type="button"
            onClick={goBack}
            disabled={step === 0}
            className="inline-flex min-h-11 min-w-24 items-center justify-center gap-1 rounded-xl border border-line bg-card px-3 text-sm font-semibold text-fg-2 transition-colors hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45"
          >
            <ChevronLeft size={17} aria-hidden="true" />
            이전
          </button>
          <p className="hidden min-w-0 flex-1 text-center text-[0.68rem] text-fg-3 sm:block">
            Esc 취소 · Alt + ←/→ 이동
            {step === QUICK_COMIC_STEPS.length - 1 ? " · Ctrl/⌘ + Enter 적용" : ""}
          </p>
          {step < QUICK_COMIC_STEPS.length - 1 ? (
            <button
              type="button"
              onClick={goNext}
              className="ml-auto inline-flex min-h-11 min-w-24 items-center justify-center gap-1 rounded-xl bg-accent px-4 text-sm font-bold text-on-accent transition-colors hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              다음
              <ChevronRight size={17} aria-hidden="true" />
            </button>
          ) : (
            <button
              type="button"
              onClick={applyPlan}
              disabled={!canApply}
              className="ml-auto inline-flex min-h-11 min-w-28 items-center justify-center gap-1.5 rounded-xl bg-accent px-4 text-sm font-bold text-on-accent transition-colors hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45"
            >
              <Check size={17} aria-hidden="true" />
              페이지 적용
            </button>
          )}
        </footer>
      </div>
    </div>
  );

  return typeof document === "undefined" ? content : createPortal(content, document.body);
}
