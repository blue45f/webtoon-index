import { FileArchive, ShieldCheck, TriangleAlert, X } from "lucide-react";
import { useId, useRef, useState, type FormEvent, type ReactElement } from "react";
import { createPortal } from "react-dom";

import { STUDIO_EASE, STUDIO_FOCUS_RING } from "../studio-panel-ui";
import { STUDIO_Z_CLASS } from "../studio-z-index";
import { useStudioModalSheet } from "../useStudioModalSheet";

import type {
  StudioVrmAttestedContentClassification,
  StudioVrmProjectArchiveAttestationPlan,
  StudioVrmProjectArchiveUseContextInput,
} from "./studio-vrm-license-product-gate";

import { cn } from "@/shared/lib/utils";

type ReadyArchiveAttestationPlan = Extract<
  StudioVrmProjectArchiveAttestationPlan,
  { readonly ok: true }
>;

type ArchiveActorBasis = ReadyArchiveAttestationPlan["permittedActorBases"][number];
type ArchiveContentField = keyof Pick<
  StudioVrmProjectArchiveUseContextInput,
  | "excessivelyViolent"
  | "excessivelySexual"
  | "politicalOrReligious"
  | "antisocialOrHate"
>;

export interface StudioVrmProjectArchiveAttestationDialogProps {
  readonly plan: ReadyArchiveAttestationPlan;
  readonly queuedCount?: number;
  readonly onSubmit: (input: StudioVrmProjectArchiveUseContextInput) => void;
  readonly onCancel: () => void;
}

const ACTOR_OPTIONS = Object.freeze({
  author: {
    label: "VRM 저작자 본인",
    description: "프로젝트에 포함된 모든 VRM을 직접 만든 저작자입니다.",
  },
  "separately-licensed-person": {
    label: "별도 이용 허락을 받은 사람",
    description: "모든 VRM 저작자 또는 권리자에게 별도 이용 허락을 받았습니다.",
  },
  other: {
    label: "그 밖의 허용 사용자",
    description: "모든 VRM의 이용 조건이 일반 사용자의 아바타 이용을 허용합니다.",
  },
} satisfies Record<ArchiveActorBasis, { readonly label: string; readonly description: string }>);

const CONTENT_FIELDS = Object.freeze([
  {
    key: "excessivelyViolent",
    label: "과도한 폭력 표현",
    description: "신체 훼손이나 잔혹한 폭력 묘사 등 모델의 제한 대상이 될 수 있는 표현",
  },
  {
    key: "excessivelySexual",
    label: "과도한 성적 표현",
    description: "노골적이거나 과도한 성적 묘사 등 모델의 제한 대상이 될 수 있는 표현",
  },
  {
    key: "politicalOrReligious",
    label: "정치·종교적 표현",
    description: "특정 정치 활동이나 종교 활동을 직접 지지·반대하는 표현",
  },
  {
    key: "antisocialOrHate",
    label: "반사회·혐오 표현",
    description: "차별, 혐오 또는 반사회적 행위를 조장하는 표현",
  },
] as const satisfies readonly {
  readonly key: ArchiveContentField;
  readonly label: string;
  readonly description: string;
}[]);

const CLASSIFICATION_OPTIONS = Object.freeze([
  { value: "absent", label: "포함하지 않음" },
  { value: "present", label: "포함함" },
  { value: "unknown", label: "확인하지 못함" },
] as const satisfies readonly {
  readonly value: StudioVrmAttestedContentClassification;
  readonly label: string;
}[]);

function validationMessage(input: {
  readonly actorBasis: ArchiveActorBasis | null;
  readonly classifications: Partial<Record<ArchiveContentField, StudioVrmAttestedContentClassification>>;
  readonly attributionConfirmed: boolean;
}): { readonly ready: boolean; readonly tone: "neutral" | "blocking" | "ready"; readonly text: string } {
  if (!input.actorBasis) {
    return { ready: false, tone: "neutral", text: "아바타 사용자 관계를 선택해 주세요." };
  }
  const unanswered = CONTENT_FIELDS.filter(({ key }) => input.classifications[key] === undefined);
  if (unanswered.length > 0) {
    return {
      ready: false,
      tone: "neutral",
      text: `콘텐츠 분류 ${unanswered.length}개를 모두 확인해 주세요.`,
    };
  }
  if (CONTENT_FIELDS.some(({ key }) => input.classifications[key] === "unknown")) {
    return {
      ready: false,
      tone: "blocking",
      text: "‘확인하지 못함’이 포함되어 archive 내보내기를 진행할 수 없습니다.",
    };
  }
  if (!input.attributionConfirmed) {
    return {
      ready: false,
      tone: "neutral",
      text: "표시된 크레딧 원문을 그대로 보존한다고 확인해 주세요.",
    };
  }
  return {
    ready: true,
    tone: "ready",
    text: "필수 확인이 완료되었습니다. VRM을 포함한 archive를 만들 수 있습니다.",
  };
}

export function StudioVrmProjectArchiveAttestationDialog({
  plan,
  queuedCount = 0,
  onSubmit,
  onCancel,
}: StudioVrmProjectArchiveAttestationDialogProps): ReactElement | null {
  const id = useId().replace(/:/gu, "");
  const dialogRef = useRef<HTMLFormElement>(null);
  const portalRootRef = useRef<HTMLElement | null>(
    typeof document === "undefined" ? null : document.body,
  );
  const submittedRef = useRef(false);
  const [actorBasis, setActorBasis] = useState<ArchiveActorBasis | null>(null);
  const [classifications, setClassifications] = useState<
    Partial<Record<ArchiveContentField, StudioVrmAttestedContentClassification>>
  >({});
  const [attributionConfirmed, setAttributionConfirmed] = useState(false);
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;
  const statusId = `${id}-status`;
  const validation = validationMessage({ actorBasis, classifications, attributionConfirmed });

  useStudioModalSheet({
    activeKey: `vrm-project-archive-attestation:${plan.schema}:${plan.version}`,
    dialogRef,
    onDismiss: onCancel,
    resolveInitialFocus: (dialog) =>
      dialog.querySelector<HTMLElement>("[data-autofocus='true']"),
    rootRef: portalRootRef,
  });

  if (typeof document === "undefined") return null;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!validation.ready || !actorBasis || submittedRef.current) return;
    const excessivelyViolent = classifications.excessivelyViolent;
    const excessivelySexual = classifications.excessivelySexual;
    const politicalOrReligious = classifications.politicalOrReligious;
    const antisocialOrHate = classifications.antisocialOrHate;
    if (
      excessivelyViolent === undefined
      || excessivelySexual === undefined
      || politicalOrReligious === undefined
      || antisocialOrHate === undefined
      || excessivelyViolent === "unknown"
      || excessivelySexual === "unknown"
      || politicalOrReligious === "unknown"
      || antisocialOrHate === "unknown"
    ) return;
    submittedRef.current = true;
    onSubmit({
      confirmedByUser: true,
      avatarPermissionBasis: actorBasis,
      confirmedAttributionTexts: plan.exactAttributionTexts,
      excessivelyViolent,
      excessivelySexual,
      politicalOrReligious,
      antisocialOrHate,
    });
  };

  return createPortal(
    <div
      className={cn(
        "fixed inset-0 flex items-end justify-center pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] sm:items-center sm:p-4",
        STUDIO_Z_CLASS.legal,
      )}
    >
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        data-studio-modal-backdrop="true"
        onClick={onCancel}
        className="absolute inset-0 cursor-default bg-[oklch(0.08_0.01_70/0.84)] backdrop-blur-sm"
      />

      <form
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={`${descriptionId} ${statusId}`}
        data-studio-vrm-project-archive-attestation="true"
        data-studio-shortcut-boundary="true"
        tabIndex={-1}
        onSubmit={submit}
        className="relative flex max-h-[calc(100dvh-max(0.5rem,env(safe-area-inset-top)))] w-full min-w-0 max-w-3xl flex-col overflow-hidden rounded-t-2xl border border-line-strong bg-panel pb-[env(safe-area-inset-bottom)] text-fg shadow-[0_18px_60px_oklch(0.08_0.01_70/0.48)] sm:max-h-[min(90dvh,52rem)] sm:rounded-2xl sm:pb-0"
      >
        <header className="flex shrink-0 items-start gap-3 border-b border-line px-4 py-3 sm:px-5 sm:py-4">
          <span className="mt-0.5 grid size-10 shrink-0 place-items-center rounded-xl border border-accent/35 bg-accent-soft text-accent">
            <FileArchive size={18} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="rounded-full border border-line bg-card px-2 py-0.5 text-[0.65rem] font-semibold tabular-nums text-fg-2">
                VRM {plan.modelCount}개
              </span>
              {queuedCount > 0 ? (
                <span className="rounded-full border border-line bg-card px-2 py-0.5 text-[0.65rem] font-semibold tabular-nums text-fg-3">
                  뒤에 {queuedCount}건 대기
                </span>
              ) : null}
            </div>
            <h2 id={titleId} className="mt-1.5 text-base font-bold tracking-tight text-fg sm:text-lg">
              VRM archive 이용 조건 확인
            </h2>
            <p id={descriptionId} className="mt-1 max-w-[70ch] text-xs leading-relaxed text-fg-2">
              원본 VRM 파일이 프로젝트 archive에 포함됩니다. 아래 항목은 추정하지 않고,
              현재 프로젝트의 실제 이용 맥락을 직접 확인해야 합니다.
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="VRM archive 이용 조건 확인 취소"
            className={cn(
              "grid size-11 shrink-0 place-items-center rounded-xl border border-line bg-card text-fg-2 hover:bg-raised hover:text-fg",
              STUDIO_EASE,
              STUDIO_FOCUS_RING,
            )}
          >
            <X size={18} aria-hidden />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain px-4 py-5 [scrollbar-width:thin] sm:px-5">
          <fieldset>
            <legend className="text-sm font-bold text-fg">1. 아바타 사용자 관계</legend>
            <p className="mt-1 text-xs leading-relaxed text-fg-3">
              모든 포함 모델에 공통으로 허용되는 관계만 표시됩니다. 자동 선택되지 않습니다.
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {plan.permittedActorBases.map((basis) => {
                const option = ACTOR_OPTIONS[basis];
                return (
                  <label
                    key={basis}
                    aria-label={option.label}
                    className={cn(
                      "flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5",
                      actorBasis === basis
                        ? "border-accent bg-accent-soft text-fg"
                        : "border-line bg-card/55 text-fg-2 hover:border-line-strong hover:bg-card",
                      STUDIO_EASE,
                      STUDIO_FOCUS_RING,
                    )}
                  >
                    <input
                      type="radio"
                      name={`${id}-actor-basis`}
                      value={basis}
                      required
                      checked={actorBasis === basis}
                      onChange={() => setActorBasis(basis)}
                      className="mt-0.5 size-4 shrink-0 accent-accent"
                    />
                    <span className="min-w-0">
                      <span className="block text-xs font-bold text-fg">{option.label}</span>
                      <span className="mt-0.5 block text-[0.68rem] leading-relaxed text-fg-3">
                        {option.description}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <section aria-labelledby={`${id}-content-heading`}>
            <h3 id={`${id}-content-heading`} className="text-sm font-bold text-fg">
              2. 콘텐츠 분류
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-fg-3">
              네 항목을 모두 선택해야 합니다. ‘확인하지 못함’은 안전을 위해 내보내기를 차단합니다.
            </p>
            <div className="mt-3 divide-y divide-line rounded-xl border border-line bg-card/35">
              {CONTENT_FIELDS.map((field) => (
                <fieldset key={field.key} className="min-w-0 px-3 py-3 sm:px-4">
                  <legend className="px-0 text-xs font-bold text-fg">{field.label}</legend>
                  <p id={`${id}-${field.key}-hint`} className="mt-0.5 text-[0.68rem] leading-relaxed text-fg-3">
                    {field.description}
                  </p>
                  <div
                    className="mt-2 grid gap-1.5 min-[420px]:grid-cols-3"
                    aria-describedby={`${id}-${field.key}-hint`}
                  >
                    {CLASSIFICATION_OPTIONS.map((option) => (
                      <label
                        key={option.value}
                        className={cn(
                          "flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold",
                          classifications[field.key] === option.value
                            ? option.value === "unknown"
                              ? "border-warn/55 bg-warn/10 text-warn"
                              : "border-accent bg-accent-soft text-fg"
                            : "border-line bg-panel/45 text-fg-2 hover:border-line-strong hover:bg-raised",
                          STUDIO_EASE,
                          STUDIO_FOCUS_RING,
                        )}
                      >
                        <input
                          type="radio"
                          name={`${id}-${field.key}`}
                          value={option.value}
                          required
                          checked={classifications[field.key] === option.value}
                          onChange={() =>
                            setClassifications((current) => ({
                              ...current,
                              [field.key]: option.value,
                            }))
                          }
                          className="size-4 shrink-0 accent-accent"
                        />
                        <span>{option.label}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              ))}
            </div>
          </section>

          <section aria-labelledby={`${id}-attribution-heading`}>
            <h3 id={`${id}-attribution-heading`} className="text-sm font-bold text-fg">
              3. archive에 보존할 정확한 크레딧
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-fg-3">
              아래 문자열은 모델 이용 조건에서 가져온 원문입니다. 순서와 내용을 바꾸지 않고 그대로 보존합니다.
            </p>
            <ol
              className="mt-3 divide-y divide-line overflow-hidden rounded-xl border border-line bg-canvas/55"
              data-studio-vrm-project-archive-attributions
            >
              {plan.exactAttributionTexts.map((text, index) => (
                <li
                  key={`${index}:${text}`}
                  className="grid min-w-0 grid-cols-[2rem_minmax(0,1fr)] gap-2 px-3 py-3"
                >
                  <span className="font-display text-xs font-semibold tabular-nums text-fg-3" aria-hidden>
                    {index + 1}
                  </span>
                  <span className="min-w-0">
                    <code
                      data-studio-vrm-project-archive-attribution={index}
                      data-empty={text === "" ? "true" : undefined}
                      className="block min-w-0 whitespace-pre-wrap break-words font-sans text-xs leading-relaxed text-fg [overflow-wrap:anywhere]"
                    >
                      {text}
                    </code>
                    {text === "" ? (
                      <span
                        data-studio-vrm-project-archive-empty-attribution-note
                        className="inline-flex min-h-6 items-center rounded-md border border-line bg-card px-2 text-[0.68rem] font-semibold text-fg-2"
                      >
                        빈 문자열 · 추가 크레딧 문구 없음
                      </span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ol>
            <label
              className={cn(
                "mt-3 flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border px-3 py-3",
                attributionConfirmed
                  ? "border-accent bg-accent-soft"
                  : "border-line-strong bg-card/55 hover:bg-card",
                STUDIO_EASE,
                STUDIO_FOCUS_RING,
              )}
            >
              <input
                type="checkbox"
                checked={attributionConfirmed}
                onChange={(event) => setAttributionConfirmed(event.currentTarget.checked)}
                className="mt-0.5 size-4 shrink-0 accent-accent"
              />
              <span className="text-xs font-semibold leading-relaxed text-fg">
                표시된 모든 크레딧 원문을 순서와 내용 변경 없이 archive에 보존합니다.
              </span>
            </label>
          </section>
        </div>

        <footer className="sticky bottom-0 shrink-0 border-t border-line bg-panel/95 px-4 py-3 backdrop-blur sm:px-5">
          <div
            id={statusId}
            aria-live="polite"
            className={cn(
              "mb-3 flex min-h-11 items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold leading-relaxed",
              validation.tone === "blocking"
                ? "border-warn/45 bg-warn/10 text-warn"
                : validation.tone === "ready"
                  ? "border-good/40 bg-good/10 text-good"
                  : "border-line bg-card/50 text-fg-2",
            )}
          >
            {validation.tone === "ready" ? (
              <ShieldCheck size={16} className="shrink-0" aria-hidden />
            ) : (
              <TriangleAlert size={16} className="shrink-0" aria-hidden />
            )}
            <span>{validation.text}</span>
          </div>
          <div className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-2">
            <button
              type="button"
              data-autofocus="true"
              onClick={onCancel}
              data-studio-vrm-project-archive-attestation-cancel
              className={cn(
                "min-h-11 rounded-xl border border-line bg-card px-4 text-xs font-semibold text-fg-2 hover:bg-raised hover:text-fg",
                STUDIO_EASE,
                STUDIO_FOCUS_RING,
              )}
            >
              취소
            </button>
            <button
              type="submit"
              disabled={!validation.ready}
              data-studio-vrm-project-archive-attestation-submit
              className={cn(
                "min-h-11 rounded-xl bg-accent px-4 text-xs font-bold text-on-accent hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-raised disabled:text-fg-3",
                STUDIO_EASE,
                STUDIO_FOCUS_RING,
              )}
            >
              VRM 포함 archive 만들기
            </button>
          </div>
        </footer>
      </form>
    </div>,
    document.body,
  );
}
